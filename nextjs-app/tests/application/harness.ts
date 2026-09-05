import { execFileSync } from 'child_process';
import path from 'path';
import { NextRequest } from 'next/server';
import { Client } from 'pg';
import { getPool, closePool } from '@/lib/db/pool';
import { setFakeNow } from '@/lib/clock';
import { clearDekCache } from '@/lib/crypto/pii';

// Application scenarios (spec §16): the API against a real PostgreSQL with a
// fake clock, a fake email provider (the queue itself) and deterministic IDs.
export async function resetDatabase(): Promise<void> {
  const admin = new Client({ connectionString: process.env.TEST_ADMIN_DATABASE_URL });
  await admin.connect();
  await admin.query('drop schema public cascade; create schema public;');
  await admin.query("do $$ begin if not exists (select 1 from pg_roles where rolname = 'ats_app') then create role ats_app login password 'ats' nosuperuser nobypassrls; end if; end $$;");
  await admin.query('grant all on schema public to ats_app');
  await admin.end();
  execFileSync('node', [path.join(process.cwd(), 'scripts/migrate.js')], { env: process.env, stdio: 'pipe' });
  clearDekCache();
}

export async function shutdown(): Promise<void> { await closePool(); }

export interface Auth { token?: string; cookie?: string; apiKey?: boolean; }

// Moves the fake clock. Sessions are kept "continuously active" across the
// jump so scenarios can span weeks; F02 covers expiry explicitly.
export async function at(iso: string): Promise<void> {
  setFakeNow(iso);
  const t = new Date(iso);
  await getPool().query('update sessions set last_seen_at = $1, expires_at = $2 where revoked_at is null', [t, new Date(t.getTime() + 12 * 3_600_000)]);
}

function headers(auth: Auth, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json', ...extra };
  if (auth.token) h.authorization = `Bearer ${auth.token}`;
  if (auth.cookie) h.cookie = `ats_candidate=${auth.cookie}`;
  if (auth.apiKey) h['x-api-key'] = process.env.BACKGROUND_PROCESSOR_API_KEY!;
  return h;
}

export async function command(name: string, body: unknown, auth: Auth = {}, extra: Record<string, string> = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const { POST } = await import('@/app/api/commands/[command]/route');
  const req = new NextRequest(`http://ats.test/api/commands/${name}`, { method: 'POST', headers: headers(auth, extra), body: JSON.stringify(body) });
  const res = await POST(req, { params: Promise.resolve({ command: name }) });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

export async function query(name: string, params: Record<string, string> = {}, auth: Auth = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const { GET } = await import('@/app/api/queries/[query]/route');
  const qs = new URLSearchParams(params).toString();
  const req = new NextRequest(`http://ats.test/api/queries/${name}${qs ? `?${qs}` : ''}`, { method: 'GET', headers: headers(auth) });
  const res = await GET(req, { params: Promise.resolve({ query: name }) });
  // Keep a leading BOM visible (TextDecoder strips it by default)
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* csv or xml */ }
  return { status: res.status, body, headers: res.headers };
}

export async function ok<T = any>(p: Promise<{ status: number; body: any }>): Promise<T> {
  const r = await p;
  if (r.status >= 400) throw new Error(`Expected success, got ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body as T;
}

export async function expectCode(p: Promise<{ status: number; body: any }>, code: string, status?: number): Promise<any> {
  const r = await p;
  if (r.body?.error !== code) throw new Error(`Expected error ${code}, got ${r.status}: ${JSON.stringify(r.body)}`);
  if (status !== undefined && r.status !== status) throw new Error(`Expected status ${status}, got ${r.status}`);
  return r.body;
}

export async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.tenant_scope', 'platform', true)");
    const r = await client.query(text, params);
    await client.query('commit');
    return r.rows;
  } finally { client.release(); }
}

export async function eventsOn(streamId: string): Promise<Array<{ type: string; payload: any; metadata: any }>> {
  return (await sql('select event_type as type, payload, metadata from events where stream_id = $1 order by stream_version', [streamId]));
}

export async function eventTypes(streamId: string): Promise<string[]> { return (await eventsOn(streamId)).map(e => e.type); }

// Fixtures (spec §16)
export interface Fixture { tenantId: string; slug: string; users: Record<string, { token: string; userId: string }>; }

export async function platformToken(): Promise<string> {
  return (await ok(command('platform-login', { email: 'operator@8examples.test', password: 'operator-password-123' }))).token;
}

export async function createOrg(op: string, name: string, slug: string, timeZone: string, languages: Array<{ code: 'en' | 'fr'; required: boolean }>, adminEmail: string, prefix: string): Promise<{ tenantId: string; inviteLink: string }> {
  return ok(command('create-organization', { name, slug, timeZone, languages, adminEmail, adminName: 'Admin', referencePrefix: prefix }, { token: op }));
}

export async function acceptInviteAndLogin(inviteLink: string, email: string, displayName: string): Promise<{ token: string; userId: string }> {
  const token = new URL(inviteLink).searchParams.get('token')!;
  await ok(command('accept-invite', { token, password: `${displayName.toLowerCase()}-password-123`, displayName }));
  const login = await ok(command('staff-login', { email, password: `${displayName.toLowerCase()}-password-123` }));
  return { token: login.token, userId: login.user.id };
}

export async function inviteAndLogin(adminToken: string, email: string, displayName: string, roles: string[], language: 'en' | 'fr' = 'en'): Promise<{ token: string; userId: string }> {
  const invite = await ok(command('invite-user', { email, displayName, roles, language }, { token: adminToken }));
  return acceptInviteAndLogin(invite.inviteLink, email, displayName);
}

export async function riverbend(): Promise<Fixture> {
  const op = await platformToken();
  const org = await createOrg(op, 'Riverbend Municipality', 'riverbend', 'America/Edmonton', [{ code: 'en', required: true }, { code: 'fr', required: true }], 'sam@riverbend.example', 'RB');
  const sam = await acceptInviteAndLogin(org.inviteLink, 'sam@riverbend.example', 'Sam');
  const users: Fixture['users'] = { sam };
  users.priya = await inviteAndLogin(sam.token, 'priya@riverbend.example', 'Priya', ['hr_advisor']);
  users.marc = await inviteAndLogin(sam.token, 'marc@riverbend.example', 'Marc', ['hiring_manager'], 'fr');
  users.dana = await inviteAndLogin(sam.token, 'dana@riverbend.example', 'Dana', ['assessor']);
  users.kai = await inviteAndLogin(sam.token, 'kai@riverbend.example', 'Kai', ['assessor']);
  users.lee = await inviteAndLogin(sam.token, 'lee@riverbend.example', 'Lee', ['auditor']);
  return { tenantId: org.tenantId, slug: 'riverbend', users };
}

export async function harbour(): Promise<Fixture> {
  const op = await platformToken();
  const org = await createOrg(op, 'Harbour Community Services', 'harbour', 'America/Vancouver', [{ code: 'en', required: true }, { code: 'fr', required: false }], 'noor@harbour.example', 'HC');
  const noor = await acceptInviteAndLogin(org.inviteLink, 'noor@harbour.example', 'Noor');
  await ok(command('assign-role', { userId: noor.userId, role: 'hr_advisor' }, { token: noor.token }));
  const login = await ok(command('staff-login', { email: 'noor@harbour.example', password: 'noor-password-123' }));
  return { tenantId: org.tenantId, slug: 'harbour', users: { noor: { token: login.token, userId: noor.userId } } };
}

// The process "Developer 2027-01" (spec §16): E1 application+interview, E2 application+written_exam, A1 application, rubric 0-5 pass 3, K1 expects yes
export async function developerProcess(f: Fixture, opts: { publish?: boolean } = { publish: true }): Promise<{ processId: string; slug: string; reference: string }> {
  const priya = f.users.priya.token;
  const created = await ok(command('create-process', { title: { en: 'Developer', fr: 'Développeur' }, hiringManager: f.users.marc.userId, hrAdvisor: f.users.priya.userId, location: 'Riverbend, AB' }, { token: priya }));
  const id = created.processId;
  await ok(command('define-rubric', { processId: id, rubricId: 'r1', name: '0-5', scale: { min: 0, max: 5 }, passMark: 3, descriptors: { en: '0 none … 5 expert', fr: '0 aucun … 5 expert' } }, { token: priya }));
  await ok(command('add-criterion', { processId: id, type: 'essential', text: { en: 'Experience developing web applications', fr: 'Expérience en développement d’applications Web' } }, { token: priya }));
  await ok(command('add-criterion', { processId: id, type: 'essential', text: { en: 'Experience applying accessibility standards', fr: 'Expérience en application des normes d’accessibilité' } }, { token: priya }));
  await ok(command('add-criterion', { processId: id, type: 'asset', text: { en: 'Experience in the public sector', fr: 'Expérience dans le secteur public' } }, { token: priya }));
  for (const [c, m, r] of [['E1', 'application', undefined], ['E1', 'interview', 'r1'], ['E2', 'application', undefined], ['E2', 'written_exam', 'r1'], ['A1', 'application', undefined]] as const) {
    await ok(command('assign-assessment-method', { processId: id, criterionCode: c, method: m, rubricId: r }, { token: priya }));
  }
  await ok(command('add-knockout', { processId: id, question: { en: 'Are you legally entitled to work in Canada?', fr: 'Êtes-vous légalement autorisé·e à travailler au Canada?' }, expected: 'yes' }, { token: priya }));
  await ok(command('set-board', { processId: id, board: [{ userId: f.users.marc.userId, role: 'chair' }, { userId: f.users.dana.userId, role: 'assessor' }, { userId: f.users.kai.userId, role: 'assessor' }] }, { token: priya }));
  await ok(command('draft-poster', { processId: id, lang: 'en', body: 'Join Riverbend as a Developer.' }, { token: priya }));
  await ok(command('draft-poster', { processId: id, lang: 'fr', body: 'Joignez-vous à Riverbend comme développeur.' }, { token: priya }));
  await ok(command('request-approval', { processId: id }, { token: f.users.marc.token }));
  await ok(command('approve-process', { processId: id, comment: 'OK to post' }, { token: f.users.sam.token }));
  if (opts.publish !== false) {
    await at('2027-01-05T16:00:00Z');
    await ok(command('publish-posting', { processId: id, closeAt: '2027-01-19 23:59' }, { token: priya }));
  }
  return { processId: id, slug: created.slug, reference: created.reference };
}

export async function candidateSession(orgSlug: string, email: string, locale: 'en' | 'fr' = 'en'): Promise<string> {
  const r = await ok(command('request-magic-link', { org: orgSlug, email, locale }));
  const token = new URL(r.link).searchParams.get('token')!;
  const { GET } = await import('@/app/api/candidate/verify/route');
  const res = await GET(new NextRequest(`http://ats.test/api/candidate/verify?token=${token}`));
  const cookie = res.headers.get('set-cookie') ?? '';
  const m = cookie.match(/ats_candidate=([^;]+)/);
  if (!m) throw new Error(`No candidate cookie: ${res.status} ${cookie}`);
  return decodeURIComponent(m[1]);
}

export async function applyAndSubmit(f: Fixture, processId: string, email: string, answers: Record<string, string>, locale: 'en' | 'fr' = 'en', name = 'Candidate'): Promise<{ cookie: string; applicationId: string; candidateId: string }> {
  const cookie = await candidateSession(f.slug, email, locale);
  await ok(command('update-profile', { name }, { cookie }));
  const started = await ok(command('start-application', { processId }, { cookie }));
  await ok(command('submit-application', { applicationId: started.applicationId, answers, consent: true }, { cookie }));
  const me = await ok(query('me', {}, { cookie }));
  return { cookie, applicationId: started.applicationId, candidateId: me.candidateId };
}

export const ANSWERS = { E1: 'Built three municipal web portals over five years.', E2: 'Led WCAG 2.1 AA audits and remediation.', A1: 'Six years in a school board.', K1: 'yes' };
