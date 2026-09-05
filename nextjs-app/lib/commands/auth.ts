import { withPlatform, withTenant } from '@/lib/db/pool';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, revokeSession, STAFF_ABSOLUTE_HOURS, CANDIDATE_HOURS } from '@/lib/auth/sessions';
import { hitRateLimit, checkRateLimit } from '@/lib/auth/rate-limit';
import { issueMagicLink, consumeMagicLink } from '@/lib/auth/magic-link';
import { securityLog } from '@/lib/security';
import { DomainError } from '@/lib/domain/errors';
import { executeCommand } from './execute';
import { ensureCandidate } from './candidate';
import { loadOrganization, resolveTenantBySlug } from '@/lib/app/context';
import { queueNotification } from '@/lib/notifications/queue';
import { candidateKeyId, hashEmail, encryptField, decryptField } from '@/lib/crypto/pii';
import { Locale } from '@/types/shared';
import { now } from '@/lib/clock';

function baseUrl(): string { return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''); }

// Staff sign-in: rate limited per address (10 per 5 min → 429 for 15 min),
// neutral failure messages, session id rotated at every sign-in (F02).
export async function staffLogin(cmd: { email: string; password: string; ip: string }): Promise<{ token: string; user: { id: string; tenantId: string; roles: string[]; displayName: string; language: string; email: string; orgSlug: string } }> {
  const email = cmd.email.trim().toLowerCase();
  // Only failures count (F02); the counter commits on its own transaction
  const limitKey = `staff-login:${hashEmail('platform', email)}`;
  const limit = await withPlatform(tx => checkRateLimit(tx, limitKey, 10, 15 * 60));
  if (limit.limited) {
    await securityLog(null, { kind: 'rate_limited', resource: 'staff_login', detail: { retryAfter: limit.retryAfterSeconds } });
    throw new DomainError('rate_limited', 'Too many attempts; try again later', { retryAfterSeconds: limit.retryAfterSeconds }, 429);
  }
  return withPlatform(async tx => {
    const { rows } = await tx.query(
      `select u.*, c.password_hash, o.slug from users u left join credentials c on c.user_id = u.id join org_settings o on o.tenant_id = u.tenant_id where lower(u.email) = $1 and u.status = 'Active' order by u.activated_at desc limit 1`,
      [email]
    );
    const user = rows[0];
    const ok = await verifyPassword(cmd.password, user?.password_hash);
    if (!user || !ok) {
      await withPlatform(t => hitRateLimit(t, limitKey, 10, 15 * 60));
      await securityLog(null, { tenantId: user?.tenant_id ?? null, kind: 'sign_in_failed', actorId: user?.id ?? null, resource: 'staff_login' });
      throw new DomainError('invalid_credentials', 'Incorrect email or password', undefined, 401);
    }
    const { token } = await createSession(tx, { kind: 'staff', subjectId: user.id, tenantId: user.tenant_id, hours: STAFF_ABSOLUTE_HOURS });
    await securityLog(tx, { tenantId: user.tenant_id, kind: 'sign_in_succeeded', actorId: user.id, resource: 'staff_login' });
    return { token, user: { id: user.id, tenantId: user.tenant_id, roles: user.roles, displayName: user.display_name, language: user.language, email: user.email, orgSlug: user.slug } };
  });
}

export async function platformLogin(cmd: { email: string; password: string }): Promise<{ token: string }> {
  const email = cmd.email.trim().toLowerCase();
  const platformKey = `platform-login:${hashEmail('platform', email)}`;
  const limit = await withPlatform(tx => checkRateLimit(tx, platformKey, 10, 15 * 60));
  if (limit.limited) throw new DomainError('rate_limited', 'Too many attempts', { retryAfterSeconds: limit.retryAfterSeconds }, 429);
  return withPlatform(async tx => {
    const { rows } = await tx.query('select * from platform_operators where email = $1', [email]);
    const op = rows[0];
    const ok = await verifyPassword(cmd.password, op?.password_hash);
    if (!op || !ok) {
      await withPlatform(t => hitRateLimit(t, platformKey, 10, 15 * 60));
      await securityLog(null, { kind: 'sign_in_failed', resource: 'platform_login' });
      throw new DomainError('invalid_credentials', 'Incorrect email or password', undefined, 401);
    }
    const { token } = await createSession(tx, { kind: 'platform', subjectId: op.id, hours: STAFF_ABSOLUTE_HOURS });
    await securityLog(tx, { kind: 'sign_in_succeeded', actorId: op.id, resource: 'platform_login' });
    return { token };
  });
}

export async function signOut(sessionId: string): Promise<void> {
  await withPlatform(tx => revokeSession(tx, sessionId));
}

// Candidate magic link (F03): neutral response, 5 per address per 10 minutes,
// 30 per client per 10 minutes, honeypot handled by the route.
export async function requestMagicLink(cmd: { orgSlug: string; email: string; locale: Locale; ip: string; next?: string }): Promise<{ sent: boolean; link?: string }> {
  const email = cmd.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { sent: false };
  const org = await withPlatform(tx => resolveTenantBySlug(tx, cmd.orgSlug));
  if (!org) throw new DomainError('organization_not_found', 'Organization not found', undefined, 404);
  const throttled = await withPlatform(async tx => {
    const byAddress = await hitRateLimit(tx, `magic:${hashEmail(org.tenantId, email)}`, 5, 10 * 60);
    const byClient = await hitRateLimit(tx, `magic-ip:${cmd.ip}`, 30, 10 * 60);
    if (byAddress.limited || byClient.limited) {
      await securityLog(tx, { tenantId: org.tenantId, kind: 'magic_link_throttled', resource: byAddress.limited ? 'address' : 'client' });
      return true;
    }
    return false;
  });
  if (throttled) return { sent: false };
  return executeCommand({ tenantId: org.tenantId, actor: { type: 'candidate', id: 'anonymous' }, locale: cmd.locale }, async (tx, append) => {
    const orgState = await loadOrganization(tx, org.tenantId);
    // The address rides along encrypted under the tenant key so a brand-new candidate can be registered when the link is used
    const emailEnc = await encryptField(tx, org.tenantId, `tenant:${org.tenantId}`, email);
    const { token } = await issueMagicLink(tx, { tenantId: org.tenantId, email, locale: cmd.locale, payload: { next: cmd.next ?? null, email: emailEnc } });
    const link = `${baseUrl()}/${cmd.locale}/candidate/verify?token=${token}`;
    await queueNotification(tx, append, {
      tenantId: org.tenantId, templateKey: 'magic_link',
      recipient: { kind: 'email', address: email, locale: cmd.locale, ref: hashEmail(org.tenantId, email).slice(0, 16), keyId: `tenant:${org.tenantId}` },
      values: { link }, causation: { eventType: 'MagicLinkRequested' }, languages: orgState.languages, organizationName: orgState.name
    });
    return { sent: true, link: process.env.NODE_ENV === 'test' || process.env.ATS_EXPOSE_MAGIC_LINKS === '1' ? link : undefined };
  });
}

export async function consumeCandidateLink(cmd: { token: string }): Promise<{ ok: true; token: string; tenantId: string; candidateId: string; locale: Locale; next: string | null; purpose: string; payload: Record<string, unknown> } | { ok: false; reason: 'invalid' | 'expired' | 'used' }> {
  const result = await withPlatform(tx => consumeMagicLink(tx, cmd.token));
  if (!result.ok) return result;
  const tenantId = result.tenantId;
  // Sign in: find or register the candidate for that address hash
  const candidateId = await executeCommand({ tenantId, actor: { type: 'candidate', id: 'anonymous' }, locale: result.locale }, async (tx, append) => {
    const { rows } = await tx.query("select id from candidates where tenant_id = $1 and email_hash = $2 and status <> 'Removed'", [tenantId, result.emailHash]);
    if (rows[0]) return rows[0].id as string;
    if (result.purpose !== 'sign_in') throw new DomainError('candidate_not_found', undefined, undefined, 404);
    // The address itself is not stored on the link; the sign-in route passes it through the payload
    const email = await decryptField<string>(tx, tenantId, result.payload.email as never);
    if (!email) throw new DomainError('link_invalid', undefined, undefined, 400);
    const created = await ensureCandidate(tx, { tenantId, actor: { type: 'candidate', id: 'anonymous' } }, append, email, result.locale);
    return created.candidateId;
  });
  const { token } = await withTenant(tenantId, tx => createSession(tx, { kind: 'candidate', subjectId: candidateId, tenantId, hours: CANDIDATE_HOURS }));
  await securityLog(null, { tenantId, kind: 'sign_in_succeeded', actorId: candidateId, resource: 'candidate_magic_link' });
  return { ok: true, token, tenantId, candidateId, locale: result.locale, next: (result.payload.next as string) ?? null, purpose: result.purpose, payload: result.payload };
}

export const candidateKey = candidateKeyId;
export const clock = now;
