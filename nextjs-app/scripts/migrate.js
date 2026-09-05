#!/usr/bin/env node
/**
 * Applies SQL migrations in scripts/migrations in filename order, then
 * bootstraps the platform operator from the environment. Runs at container
 * startup before the app boots (see Dockerfile CMD). Safe to run repeatedly:
 * a __db_migration_history row means the migration ran; the row is inserted
 * in the same transaction as the migration itself.
 *
 * Local dev: node scripts/migrate.js
 */
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const client = new Client({ connectionString });
  await client.connect();

  await client.query(`
    create table if not exists __db_migration_history (
      id text primary key,
      applied_at timestamptz not null default now()
    )`);

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const { rows } = await client.query('select 1 from __db_migration_history where id = $1', [file]);
    if (rows.length) { console.log(`[migrate] ${file}: already applied`); continue; }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into __db_migration_history (id) values ($1)', [file]);
      await client.query('commit');
      console.log(`[migrate] ${file}: applied`);
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  }

  const email = process.env.PLATFORM_OPERATOR_EMAIL;
  const password = process.env.PLATFORM_OPERATOR_PASSWORD;
  if (email && password) {
    if (password.length < 12) throw new Error('PLATFORM_OPERATOR_PASSWORD must be at least 12 characters');
    const hash = await bcrypt.hash(password, 12);
    await client.query(`
      insert into platform_operators (id, email, password_hash) values ($1, $2, $3)
      on conflict (email) do update set password_hash = excluded.password_hash`,
      [crypto.randomUUID(), email.toLowerCase(), hash]);
    console.log(`[migrate] platform operator ensured`);
  }

  await client.end();
}

main().catch(err => { console.error('[migrate] failed:', err); process.exit(1); });
