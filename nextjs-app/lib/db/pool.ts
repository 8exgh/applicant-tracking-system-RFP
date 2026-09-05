import { Pool, PoolClient } from 'pg';
import { getLogger } from '@/lib/logger';

const log = getLogger('db/pool');

// One pool per process. Next.js dev reloads modules, so keep it on globalThis.
const globalForPg = globalThis as unknown as { __atsPool?: Pool };

export function getPool(): Pool {
  if (!globalForPg.__atsPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    globalForPg.__atsPool = new Pool({ connectionString, max: 10 });
    globalForPg.__atsPool.on('error', err => log.error('Idle client error', err));
  }
  return globalForPg.__atsPool;
}

export type Tx = PoolClient;

// The only way to touch projection tables. Every query runs inside a
// transaction whose tenant context feeds the row-level security policies
// (spec §9.5, F26): a query without a tenant context cannot read tenant rows.
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!tenantId) throw new Error('Tenant context is required');
  return withScope({ tenantId }, fn);
}

// Platform scope: cross-tenant work (projectors, schedulers, the operator).
export async function withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withScope({ platform: true }, fn);
}

async function withScope<T>(scope: { tenantId?: string; platform?: boolean }, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (scope.platform) {
      await client.query("SELECT set_config('app.tenant_scope', 'platform', true)");
    } else {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [scope.tenantId]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (globalForPg.__atsPool) {
    await globalForPg.__atsPool.end();
    globalForPg.__atsPool = undefined;
  }
}
