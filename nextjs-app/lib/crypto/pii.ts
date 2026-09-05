import crypto from 'crypto';
import { Tx } from '@/lib/db/pool';
import { now } from '@/lib/clock';

// Envelope encryption for personal information (spec §9.6). Each subject
// (candidate, self-declaration, accommodation request) has its own data key,
// wrapped by the master key. Destroying the data key makes every field it
// encrypted permanently unreadable ("crypto-shredding") while the event
// history itself stays intact and verifiable.

export interface Envelope {
  kid: string;
  iv: string;
  ct: string;
  tag: string;
}

const dekCache = new Map<string, Buffer | null>();

function masterKey(): Buffer {
  const raw = process.env.ATS_MASTER_KEY;
  if (!raw) throw new Error('ATS_MASTER_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('ATS_MASTER_KEY must be 32 bytes (base64)');
  return key;
}

function aesEncrypt(key: Buffer, plaintext: Buffer): { iv: Buffer; ct: Buffer; tag: Buffer } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, ct, tag: cipher.getAuthTag() };
}

function aesDecrypt(key: Buffer, iv: Buffer, ct: Buffer, tag: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function wrapDek(dek: Buffer): string {
  const { iv, ct, tag } = aesEncrypt(masterKey(), dek);
  return `${iv.toString('base64')}.${ct.toString('base64')}.${tag.toString('base64')}`;
}

function unwrapDek(wrapped: string): Buffer {
  const [iv, ct, tag] = wrapped.split('.').map(p => Buffer.from(p, 'base64'));
  return aesDecrypt(masterKey(), iv, ct, tag);
}

export function candidateKeyId(candidateId: string): string { return `candidate:${candidateId}`; }
export function selfDeclarationKeyId(applicationId: string): string { return `selfdeclaration:${applicationId}`; }
export function accommodationKeyId(applicationId: string): string { return `accommodation:${applicationId}`; }

export async function ensureDataKey(tx: Tx, tenantId: string, keyId: string): Promise<void> {
  const existing = await tx.query('select 1 from data_keys where key_id = $1', [keyId]);
  if (existing.rows.length) return;
  const dek = crypto.randomBytes(32);
  await tx.query(
    'insert into data_keys (key_id, tenant_id, encrypted_dek, status) values ($1, $2, $3, $4) on conflict do nothing',
    [keyId, tenantId, wrapDek(dek), 'active']
  );
  dekCache.delete(keyId);
}

async function loadDek(tx: Tx, tenantId: string, keyId: string): Promise<Buffer | null> {
  if (dekCache.has(keyId)) return dekCache.get(keyId)!;
  const { rows } = await tx.query('select encrypted_dek, status from data_keys where key_id = $1 and tenant_id = $2', [keyId, tenantId]);
  if (!rows.length || rows[0].status !== 'active' || !rows[0].encrypted_dek) {
    dekCache.set(keyId, null);
    return null;
  }
  const dek = unwrapDek(rows[0].encrypted_dek);
  dekCache.set(keyId, dek);
  return dek;
}

export async function encryptField(tx: Tx, tenantId: string, keyId: string, value: unknown): Promise<Envelope> {
  await ensureDataKey(tx, tenantId, keyId);
  const dek = await loadDek(tx, tenantId, keyId);
  if (!dek) throw new Error(`Data key ${keyId} is destroyed`);
  const { iv, ct, tag } = aesEncrypt(dek, Buffer.from(JSON.stringify(value), 'utf8'));
  return { kid: keyId, iv: iv.toString('base64'), ct: ct.toString('base64'), tag: tag.toString('base64') };
}

// Returns null when the key is destroyed: the field reads as removed.
export async function decryptField<T = unknown>(tx: Tx, tenantId: string, envelope: Envelope | null | undefined): Promise<T | null> {
  if (!envelope || !envelope.kid) return null;
  const dek = await loadDek(tx, tenantId, envelope.kid);
  if (!dek) return null;
  try {
    const plain = aesDecrypt(dek, Buffer.from(envelope.iv, 'base64'), Buffer.from(envelope.ct, 'base64'), Buffer.from(envelope.tag, 'base64'));
    return JSON.parse(plain.toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function isEnvelope(value: unknown): value is Envelope {
  return typeof value === 'object' && value !== null && 'kid' in value && 'ct' in value && 'iv' in value && 'tag' in value;
}

export async function destroyDataKeys(tx: Tx, tenantId: string, keyIds: string[]): Promise<void> {
  for (const keyId of keyIds) {
    await tx.query(
      "update data_keys set encrypted_dek = null, status = 'destroyed', destroyed_at = $3 where key_id = $1 and tenant_id = $2",
      [keyId, tenantId, now()]
    );
    dekCache.set(keyId, null);
  }
}

export async function dataKeyStatus(tx: Tx, tenantId: string, keyId: string): Promise<'active' | 'destroyed' | 'missing'> {
  const { rows } = await tx.query('select status from data_keys where key_id = $1 and tenant_id = $2', [keyId, tenantId]);
  return rows[0]?.status ?? 'missing';
}

// Deterministic lookup hash so a candidate can be found by email without
// storing the address in clear (per organization: same email at two
// organizations is two candidates, spec §5.1).
export function hashEmail(tenantId: string, email: string): string {
  return crypto.createHmac('sha256', masterKey()).update(`${tenantId}:${email.trim().toLowerCase()}`).digest('hex');
}

export function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function clearDekCache(): void {
  dekCache.clear();
}
