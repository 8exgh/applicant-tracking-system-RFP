import { randomUUID } from 'crypto';
import { Tx } from '@/lib/db/pool';
import { hashEmail, hashToken, randomToken } from '@/lib/crypto/pii';
import { now } from '@/lib/clock';
import { Locale } from '@/types/shared';

export const MAGIC_LINK_MINUTES = 15;

// Single-use, 15-minute links; requesting a new one supersedes the previous
// (F03). The token itself is never stored, only its hash.
export async function issueMagicLink(tx: Tx, params: { tenantId: string; email: string; locale: Locale; purpose?: string; payload?: Record<string, unknown> }): Promise<{ token: string; expiresAt: Date }> {
  const at = now();
  const emailHash = hashEmail(params.tenantId, params.email);
  const purpose = params.purpose ?? 'sign_in';
  await tx.query('update magic_links set superseded_at = $3 where tenant_id = $1 and email_hash = $2 and purpose = $4 and used_at is null and superseded_at is null', [params.tenantId, emailHash, at, purpose]);
  const token = randomToken(32);
  const expiresAt = new Date(at.getTime() + MAGIC_LINK_MINUTES * 60_000);
  await tx.query(
    'insert into magic_links (id, tenant_id, email_hash, token_hash, locale, purpose, payload, created_at, expires_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [randomUUID(), params.tenantId, emailHash, hashToken(token), params.locale, purpose, JSON.stringify(params.payload ?? {}), at, expiresAt]
  );
  return { token, expiresAt };
}

export type MagicLinkResult =
  | { ok: true; tenantId: string; emailHash: string; locale: Locale; purpose: string; payload: Record<string, unknown> }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' };

export async function consumeMagicLink(tx: Tx, token: string): Promise<MagicLinkResult> {
  const { rows } = await tx.query('select * from magic_links where token_hash = $1 for update', [hashToken(token)]);
  const row = rows[0];
  if (!row) return { ok: false, reason: 'invalid' };
  const at = now();
  if (row.used_at) return { ok: false, reason: 'used' };
  if (row.superseded_at) return { ok: false, reason: 'invalid' };
  if (new Date(row.expires_at).getTime() < at.getTime()) return { ok: false, reason: 'expired' };
  await tx.query('update magic_links set used_at = $2 where id = $1', [row.id, at]);
  return { ok: true, tenantId: row.tenant_id, emailHash: row.email_hash, locale: row.locale, purpose: row.purpose, payload: row.payload ?? {} };
}
