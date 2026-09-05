import { randomUUID } from 'crypto';
import { Tx, withPlatform } from '@/lib/db/pool';
import { now } from '@/lib/clock';
import { signSession, verifySession } from './jwt';

export const STAFF_ABSOLUTE_HOURS = 12;
export const CANDIDATE_HOURS = 24;

export interface SessionRow {
  id: string; tenant_id: string | null; subject_id: string; kind: 'staff' | 'candidate' | 'platform';
  created_at: Date; last_seen_at: Date; expires_at: Date; revoked_at: Date | null;
}

export async function createSession(tx: Tx, params: { kind: 'staff' | 'candidate' | 'platform'; subjectId: string; tenantId?: string; hours: number }): Promise<{ token: string; sessionId: string }> {
  const sessionId = randomUUID();
  const at = now();
  const expiresAt = new Date(at.getTime() + params.hours * 3_600_000);
  await tx.query(
    'insert into sessions (id, tenant_id, subject_id, kind, created_at, last_seen_at, expires_at) values ($1, $2, $3, $4, $5, $5, $6)',
    [sessionId, params.tenantId ?? null, params.subjectId, params.kind, at, expiresAt]
  );
  const token = signSession({ sid: sessionId, kind: params.kind, sub: params.subjectId, tenantId: params.tenantId }, params.hours * 3600);
  return { token, sessionId };
}

// Validates a bearer token against its session row: revoked, expired
// (absolute lifetime) or idle sessions are rejected. Touches last_seen.
export async function resolveSession(token: string, idleMinutes: number | null): Promise<SessionRow | null> {
  const claims = verifySession(token);
  if (!claims?.sid) return null;
  return withPlatform(async tx => {
    const { rows } = await tx.query('select * from sessions where id = $1', [claims.sid]);
    const row = rows[0] as SessionRow | undefined;
    if (!row || row.revoked_at || row.subject_id !== claims.sub || row.kind !== claims.kind) return null;
    const at = now();
    if (row.expires_at.getTime() <= at.getTime()) return null;
    if (idleMinutes !== null && at.getTime() - row.last_seen_at.getTime() > idleMinutes * 60_000) {
      await tx.query('update sessions set revoked_at = $2 where id = $1', [row.id, at]);
      return null;
    }
    if (at.getTime() - row.last_seen_at.getTime() > 30_000) {
      await tx.query('update sessions set last_seen_at = $2 where id = $1', [row.id, at]);
    }
    return row;
  });
}

export async function extendSession(tx: Tx, sessionId: string): Promise<void> {
  await tx.query('update sessions set last_seen_at = $2 where id = $1', [sessionId, now()]);
}

export async function revokeSession(tx: Tx, sessionId: string): Promise<void> {
  await tx.query('update sessions set revoked_at = $2 where id = $1 and revoked_at is null', [sessionId, now()]);
}

export async function revokeSessionsForSubject(tx: Tx, subjectId: string): Promise<void> {
  await tx.query('update sessions set revoked_at = $2 where subject_id = $1 and revoked_at is null', [subjectId, now()]);
}

export async function revokeSessionsForTenant(tx: Tx, tenantId: string): Promise<number> {
  const r = await tx.query('update sessions set revoked_at = $2 where tenant_id = $1 and revoked_at is null', [tenantId, now()]);
  return r.rowCount ?? 0;
}
