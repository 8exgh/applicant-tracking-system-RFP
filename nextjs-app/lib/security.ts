import { Tx, withPlatform } from '@/lib/db/pool';
import { now } from '@/lib/clock';
import { getLogger } from '@/lib/logger';

const log = getLogger('security');

export type SecurityKind =
  | 'sign_in_failed' | 'sign_in_succeeded' | 'sign_out' | 'rate_limited' | 'tenant_mismatch' | 'access_denied'
  | 'sessions_revoked' | 'delete_attempt' | 'honeypot' | 'magic_link_throttled' | 'break_glass' | 'input_rejected';

// Security log entries carry identifiers only: never passwords, tokens or
// candidate content (F02, F26).
export async function securityLog(tx: Tx | null, entry: { tenantId?: string | null; kind: SecurityKind; actorId?: string | null; resource?: string; detail?: Record<string, unknown> }): Promise<void> {
  const write = async (t: Tx) => {
    await t.query(
      'insert into security_log (tenant_id, kind, actor_id, resource, detail, occurred_at) values ($1, $2, $3, $4, $5, $6)',
      [entry.tenantId ?? null, entry.kind, entry.actorId ?? null, entry.resource ?? null, JSON.stringify(entry.detail ?? {}), now()]
    );
  };
  try {
    if (tx) await write(tx); else await withPlatform(write);
  } catch (err) {
    log.error('security log write failed', err);
  }
  log.info(`${entry.kind} actor=${entry.actorId ?? '-'} resource=${entry.resource ?? '-'} tenant=${entry.tenantId ?? '-'}`);
}

// Every read of candidate personal information is logged (spec §9.11)
export async function accessLog(tx: Tx, entry: { tenantId: string; actorType: string; actorId?: string | null; resource: string; subjectId?: string | null; purpose: string; reason?: string }): Promise<void> {
  await tx.query(
    'insert into access_log (tenant_id, actor_type, actor_id, resource, subject_id, purpose, reason, occurred_at) values ($1, $2, $3, $4, $5, $6, $7, $8)',
    [entry.tenantId, entry.actorType, entry.actorId ?? null, entry.resource, entry.subjectId ?? null, entry.purpose, entry.reason ?? null, now()]
  );
}
