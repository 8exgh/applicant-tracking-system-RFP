import { randomUUID } from 'crypto';
import { executeCommand, CommandEnv } from './execute';
import { loadCandidate, loadOrganization, loadApplication } from '@/lib/app/context';
import { streamIds } from '@/types/events';
import { Locale } from '@/types/shared';
import {
  decideRegisterCandidate, decideUpdateProfile, decideChangeLocale, decideSetMarketingOptOut, decideRequestExport, decideCompleteExport,
  decideRequestDeletion, decideRecordShredded, decideRequestEmailChange, decideConfirmEmailChange, CandidateState
} from '@/lib/domain/candidate';
import { candidateKeyId, selfDeclarationKeyId, accommodationKeyId, encryptField, decryptField, hashEmail, destroyDataKeys } from '@/lib/crypto/pii';
import { Tx } from '@/lib/db/pool';
import { now } from '@/lib/clock';
import { DomainError } from '@/lib/domain/errors';
import { issueMagicLink } from '@/lib/auth/magic-link';
import { queueNotification } from '@/lib/notifications/queue';
import { readAllForTenant } from '@/lib/db/event-store';

function baseUrl(): string { return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''); }

// Finds or registers the candidate for an email within one organization
export async function ensureCandidate(tx: Tx, appendEnv: CommandEnv, append: import('./execute').Appender, email: string, locale: Locale): Promise<{ candidateId: string; created: boolean }> {
  const emailHash = hashEmail(appendEnv.tenantId, email);
  const { rows } = await tx.query("select id from candidates where tenant_id = $1 and email_hash = $2 and status <> 'Removed'", [appendEnv.tenantId, emailHash]);
  if (rows[0]) return { candidateId: rows[0].id, created: false };
  const candidateId = randomUUID();
  const enc = await encryptField(tx, appendEnv.tenantId, candidateKeyId(candidateId), email.trim().toLowerCase());
  const events = decideRegisterCandidate({ exists: false } as CandidateState, { candidateId, email: enc, locale });
  events[0].payload.emailHash = emailHash;
  await append(streamIds.candidate(candidateId), 'none', events);
  return { candidateId, created: true };
}

export async function updateProfile(env: CommandEnv, cmd: { name?: string; phone?: string }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const { state, version } = await loadCandidate(tx, env.tenantId, env.actor.id);
    const current = (await decryptField<Record<string, string>>(tx, env.tenantId, state.profile as never)) ?? {};
    const next = { ...current, ...Object.fromEntries(Object.entries(cmd).filter(([, v]) => v !== undefined)) };
    const changed = Object.keys(cmd).filter(k => (cmd as Record<string, string | undefined>)[k] !== undefined && current[k] !== (cmd as Record<string, string | undefined>)[k]);
    if (!changed.length) return;
    const fields = await encryptField(tx, env.tenantId, candidateKeyId(env.actor.id), next);
    await append(streamIds.candidate(env.actor.id), version, decideUpdateProfile(state, { fields, changed }));
  });
}

export async function changeLocale(env: CommandEnv, cmd: { locale: Locale }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const { state, version } = await loadCandidate(tx, env.tenantId, env.actor.id);
    await append(streamIds.candidate(env.actor.id), version, decideChangeLocale(state, cmd));
  });
}

export async function setMarketingOptOut(env: CommandEnv, cmd: { value: boolean }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const { state, version } = await loadCandidate(tx, env.tenantId, env.actor.id);
    await append(streamIds.candidate(env.actor.id), version, decideSetMarketingOptOut(state, cmd));
  });
}

export async function requestEmailChange(env: CommandEnv, cmd: { newEmail: string }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    const { state, version } = await loadCandidate(tx, env.tenantId, env.actor.id);
    const enc = await encryptField(tx, env.tenantId, candidateKeyId(env.actor.id), cmd.newEmail.trim().toLowerCase());
    await append(streamIds.candidate(env.actor.id), version, decideRequestEmailChange(state, { newEmail: enc }));
    const { token } = await issueMagicLink(tx, { tenantId: env.tenantId, email: cmd.newEmail, locale: state.locale, purpose: 'email_change', payload: { candidateId: env.actor.id } });
    await queueNotification(tx, append, {
      tenantId: env.tenantId, templateKey: 'email_change', recipient: { kind: 'email', address: cmd.newEmail.trim().toLowerCase(), locale: state.locale, ref: env.actor.id, keyId: candidateKeyId(env.actor.id) },
      values: { link: `${baseUrl()}/${state.locale}/candidate/verify?token=${token}` }, causation: { eventType: 'CandidateEmailChangeRequested' }, languages: org.languages, organizationName: org.name
    });
  });
}

export async function confirmEmailChange(env: CommandEnv, cmd: { newEmail: string }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const { state, version } = await loadCandidate(tx, env.tenantId, env.actor.id);
    const enc = await encryptField(tx, env.tenantId, candidateKeyId(env.actor.id), cmd.newEmail.trim().toLowerCase());
    const events = decideConfirmEmailChange(state, { newEmail: enc });
    events[0].payload.emailHash = hashEmail(env.tenantId, cmd.newEmail);
    await append(streamIds.candidate(env.actor.id), version, events);
  });
}

// Data export (F18): everything about the candidate, decrypted where keys
// exist, delivered as a JSON document behind a magic link.
export async function requestDataExport(env: CommandEnv): Promise<{ exportId: string }> {
  return executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    const { state, version } = await loadCandidate(tx, env.tenantId, env.actor.id);
    await append(streamIds.candidate(env.actor.id), version, decideRequestExport(state));
    const exportId = randomUUID();
    const expiresAt = new Date(now().getTime() + 72 * 3_600_000).toISOString();
    await append(streamIds.candidate(env.actor.id), version + 1, decideCompleteExport(state, { exportId, expiresAt }));
    const email = await decryptField<string>(tx, env.tenantId, state.email as never);
    if (email) {
      const { token } = await issueMagicLink(tx, { tenantId: env.tenantId, email, locale: state.locale, purpose: 'data_export', payload: { candidateId: env.actor.id, exportId } });
      await queueNotification(tx, append, {
        tenantId: env.tenantId, templateKey: 'data_export_ready', recipient: { kind: 'candidate', candidateId: env.actor.id },
        values: { link: `${baseUrl()}/${state.locale}/candidate/verify?token=${token}`, offer_expiry: expiresAt.slice(0, 10) },
        causation: { eventType: 'CandidateDataExportCompleted' }, languages: org.languages, organizationName: org.name
      });
    }
    return { exportId };
  });
}

export async function buildCandidateExport(tx: Tx, tenantId: string, candidateId: string): Promise<Record<string, unknown>> {
  const all = await readAllForTenant(tx, tenantId);
  const { rows } = await tx.query('select id from application_summary where tenant_id = $1 and candidate_id = $2', [tenantId, candidateId]);
  const appIds = new Set(rows.map(r => r.id));
  const mine = all.filter(e => e.streamId === streamIds.candidate(candidateId) || appIds.has(e.streamId.replace(/^(application|selfdeclaration|accommodation)-/, '')) || ((e.payload as { recipientRef?: string }).recipientRef === candidateId && e.streamId.startsWith('notification-')));
  const decrypt = async (v: unknown): Promise<unknown> => {
    if (v && typeof v === 'object' && 'kid' in (v as object) && 'ct' in (v as object)) return await decryptField(tx, tenantId, v as never);
    if (Array.isArray(v)) return Promise.all(v.map(decrypt));
    if (v && typeof v === 'object') return Object.fromEntries(await Promise.all(Object.entries(v as Record<string, unknown>).map(async ([k, x]) => [k, await decrypt(x)])));
    return v;
  };
  const events = [];
  for (const e of mine) events.push({ stream: e.streamId, version: e.streamVersion, type: e.type, occurredAt: e.occurredAt, payload: await decrypt(e.payload) });
  return { candidateId, generatedAt: now().toISOString(), events };
}

// Deletion (F18): deferred while any application sits in an active process;
// otherwise fulfilled by crypto-shredding.
export async function requestDeletion(env: CommandEnv): Promise<{ deferredUntil?: string; shredded: boolean }> {
  return executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    const { state, version } = await loadCandidate(tx, env.tenantId, env.actor.id);
    const { rows } = await tx.query(
      `select a.process_id, p.status, p.completed_at from application_summary a join process_summary p on p.id = a.process_id
       where a.tenant_id = $1 and a.candidate_id = $2`, [env.tenantId, env.actor.id]
    );
    const retentionYears = Number((org.settings as unknown as { retentionYearsUnsuccessful?: number }).retentionYearsUnsuccessful ?? 2);
    const active = rows
      .filter(r => !['Completed', 'Cancelled'].includes(r.status) || (r.completed_at && new Date(r.completed_at).getTime() + retentionYears * 365 * 86_400_000 > now().getTime()))
      .map(r => {
        const base = r.completed_at ? new Date(r.completed_at) : now();
        return { processId: r.process_id, retentionUntil: new Date(base.getTime() + retentionYears * 365 * 86_400_000).toISOString() };
      });
    const events = decideRequestDeletion(state, { activeProcesses: active });
    await append(streamIds.candidate(env.actor.id), version, events);
    if (active.length) return { deferredUntil: events[1].payload.until as string, shredded: false };
    await shredCandidate(tx, append, env.tenantId, env.actor.id, 'deletion_request', version + events.length);
    return { shredded: true };
  });
}

export async function shredCandidate(tx: Tx, append: import('./execute').Appender, tenantId: string, candidateId: string, reason: string, version?: number): Promise<void> {
  const { rows } = await tx.query('select id from application_summary where tenant_id = $1 and candidate_id = $2', [tenantId, candidateId]);
  const keyIds = [candidateKeyId(candidateId), ...rows.flatMap(r => [selfDeclarationKeyId(r.id), accommodationKeyId(r.id)])];
  const { state, version: v } = await loadCandidate(tx, tenantId, candidateId);
  const events = decideRecordShredded(state, { reason, keyIds });
  if (!events.length) return;
  await destroyDataKeys(tx, tenantId, keyIds);
  await append(streamIds.candidate(candidateId), version ?? v, events);
  // Sessions of a removed candidate end immediately
  await tx.query('update sessions set revoked_at = $2 where subject_id = $1 and revoked_at is null', [candidateId, now()]);
}

export async function exportApplicationForCandidate(tx: Tx, tenantId: string, candidateId: string, applicationId: string): Promise<boolean> {
  const { state } = await loadApplication(tx, tenantId, applicationId);
  if (state.candidateId !== candidateId) throw new DomainError('application_not_found', 'Application not found', undefined, 404);
  return true;
}
