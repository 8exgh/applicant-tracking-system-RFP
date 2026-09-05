import { randomUUID } from 'crypto';
import { Tx } from './pool';
import { ConcurrencyError } from '@/lib/domain/errors';
import { now } from '@/lib/clock';

// Metadata every event carries (spec §6)
export interface Actor {
  type: 'staff' | 'candidate' | 'system' | 'api' | 'platform';
  id: string;
}

export interface EventMetadata {
  eventId: string;
  tenantId: string;
  streamId: string;
  actor: Actor;
  role?: string;
  correlationId: string;
  causationId?: string;
  reason?: string;
  locale?: string;
  requestId?: string;
  clientHash?: string;
}

export interface NewEvent<TPayload = Record<string, unknown>> {
  type: string;
  payload: TPayload;
  schemaVersion?: number;
  reason?: string;
  causationId?: string;
  occurredAt?: Date;
}

export interface StoredEvent<TPayload = Record<string, unknown>> {
  globalPosition: number;
  tenantId: string;
  streamId: string;
  streamVersion: number;
  type: string;
  schemaVersion: number;
  payload: TPayload;
  metadata: EventMetadata;
  occurredAt: Date;
}

export type ExpectedVersion = number | 'any' | 'none';

export interface AppendContext {
  tenantId: string;
  actor: Actor;
  role?: string;
  correlationId?: string;
  causationId?: string;
  locale?: string;
  requestId?: string;
  clientHash?: string;
}

function rowToEvent(row: Record<string, unknown>): StoredEvent {
  return {
    globalPosition: Number(row.global_position),
    tenantId: row.tenant_id as string,
    streamId: row.stream_id as string,
    streamVersion: row.stream_version as number,
    type: row.event_type as string,
    schemaVersion: row.schema_version as number,
    payload: row.payload as Record<string, unknown>,
    metadata: row.metadata as EventMetadata,
    occurredAt: new Date(row.occurred_at as string)
  };
}

export async function loadStream(tx: Tx, tenantId: string, streamId: string): Promise<StoredEvent[]> {
  const { rows } = await tx.query(
    'select * from events where tenant_id = $1 and stream_id = $2 order by stream_version asc',
    [tenantId, streamId]
  );
  return rows.map(rowToEvent);
}

export async function loadStreamsByPrefix(tx: Tx, tenantId: string, prefix: string): Promise<Map<string, StoredEvent[]>> {
  const { rows } = await tx.query(
    'select * from events where tenant_id = $1 and stream_id like $2 order by global_position asc',
    [tenantId, `${prefix}%`]
  );
  const byStream = new Map<string, StoredEvent[]>();
  for (const row of rows) {
    const e = rowToEvent(row);
    if (!byStream.has(e.streamId)) byStream.set(e.streamId, []);
    byStream.get(e.streamId)!.push(e);
  }
  return byStream;
}

export async function readFromPosition(tx: Tx, fromExclusive: number, limit = 500): Promise<StoredEvent[]> {
  const { rows } = await tx.query(
    'select * from events where global_position > $1 order by global_position asc limit $2',
    [fromExclusive, limit]
  );
  return rows.map(rowToEvent);
}

export async function readAllForTenant(tx: Tx, tenantId: string): Promise<StoredEvent[]> {
  const { rows } = await tx.query('select * from events where tenant_id = $1 order by global_position asc', [tenantId]);
  return rows.map(rowToEvent);
}

export async function headPosition(tx: Tx): Promise<number> {
  const { rows } = await tx.query('select coalesce(max(global_position), 0) as p from events');
  return Number(rows[0].p);
}

// Append is a single transaction: lock the stream, check expectedVersion,
// insert contiguous versions, keep occurred_at monotonic within the stream.
export async function appendToStream(
  tx: Tx,
  streamId: string,
  expectedVersion: ExpectedVersion,
  events: NewEvent[],
  ctx: AppendContext
): Promise<StoredEvent[]> {
  if (events.length === 0) return [];
  await tx.query('select pg_advisory_xact_lock(hashtext($1))', [streamId]);
  const { rows } = await tx.query(
    'select coalesce(max(stream_version), 0) as v, max(occurred_at) as t, max(tenant_id::text) as tenant from events where stream_id = $1',
    [streamId]
  );
  const currentVersion = Number(rows[0].v);
  if (rows[0].tenant && rows[0].tenant !== ctx.tenantId) {
    // A stream belongs to exactly one tenant; any other tenant sees nothing.
    throw new ConcurrencyError(currentVersion);
  }
  if (expectedVersion === 'none' && currentVersion !== 0) throw new ConcurrencyError(currentVersion);
  if (typeof expectedVersion === 'number' && expectedVersion !== currentVersion) throw new ConcurrencyError(currentVersion);

  const lastAt: Date | null = rows[0].t ? new Date(rows[0].t) : null;
  const correlationId = ctx.correlationId || randomUUID();
  const stored: StoredEvent[] = [];
  let version = currentVersion;
  let previousAt = lastAt;
  for (const e of events) {
    version += 1;
    const metadata: EventMetadata = {
      eventId: randomUUID(),
      tenantId: ctx.tenantId,
      streamId,
      actor: ctx.actor,
      role: ctx.role,
      correlationId,
      causationId: e.causationId ?? ctx.causationId,
      reason: e.reason,
      locale: ctx.locale,
      requestId: ctx.requestId,
      clientHash: ctx.clientHash
    };
    let occurredAt = e.occurredAt ?? now();
    if (previousAt && occurredAt < previousAt) occurredAt = previousAt; // never earlier than the previous event (F17)
    previousAt = occurredAt;
    const inserted = await tx.query(
      `insert into events (tenant_id, stream_id, stream_version, event_type, schema_version, payload, metadata, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [ctx.tenantId, streamId, version, e.type, e.schemaVersion ?? 1, JSON.stringify(e.payload), JSON.stringify(metadata), occurredAt]
    );
    stored.push(rowToEvent(inserted.rows[0]));
  }
  return stored;
}

export async function streamVersion(tx: Tx, tenantId: string, streamId: string): Promise<number> {
  const { rows } = await tx.query(
    'select coalesce(max(stream_version), 0) as v from events where tenant_id = $1 and stream_id = $2',
    [tenantId, streamId]
  );
  return Number(rows[0].v);
}

// Idempotency: same key within a tenant returns the original response (F27)
export async function findIdempotent(tx: Tx, tenantId: string, key: string): Promise<{ status: number; response: unknown } | null> {
  const { rows } = await tx.query(
    "select status, response from idempotency_keys where tenant_id = $1 and key = $2 and created_at > now() - interval '7 days'",
    [tenantId, key]
  );
  return rows[0] ? { status: rows[0].status, response: rows[0].response } : null;
}

export async function rememberIdempotent(tx: Tx, tenantId: string, key: string, status: number, response: unknown): Promise<void> {
  await tx.query(
    'insert into idempotency_keys (tenant_id, key, status, response) values ($1, $2, $3, $4) on conflict do nothing',
    [tenantId, key, status, JSON.stringify(response)]
  );
}
