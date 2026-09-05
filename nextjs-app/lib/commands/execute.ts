import { randomUUID } from 'crypto';
import { Tx, withTenant, withPlatform } from '@/lib/db/pool';
import { appendToStream, AppendContext, Actor, StoredEvent, ExpectedVersion } from '@/lib/db/event-store';
import { DecidedEvent } from '@/types/events';
import { DecidedWithActor } from '@/lib/domain/application';
import { runProjections } from '@/lib/projections';
import { runReactors } from '@/lib/reactors';

export interface CommandEnv {
  tenantId: string;
  actor: Actor;
  role?: string;
  correlationId?: string;
  causationId?: string;
  requestId?: string;
  locale?: string;
  clientHash?: string;
}

// Every command runs in one transaction under a global advisory lock so
// projections are applied in global_position order without gaps, then
// reactors turn the new events into follow-up commands (notifications, ...).
export async function executeCommand<T>(env: CommandEnv, fn: (tx: Tx, append: Appender) => Promise<T>): Promise<T> {
  const runner = env.tenantId ? (f: (tx: Tx) => Promise<T>) => withTenant(env.tenantId, f) : withPlatform;
  return runner(async tx => {
    await tx.query("select pg_advisory_xact_lock(hashtext('ats:commands'))");
    const appended: StoredEvent[] = [];
    const append = makeAppender(tx, env, appended);
    const result = await fn(tx, append);
    if (appended.length) {
      await runProjections(tx);
      await runReactors(tx, appended, env);
      await runProjections(tx);
    }
    return result;
  });
}

export type Appender = (streamId: string, expectedVersion: ExpectedVersion, events: Array<DecidedEvent | DecidedWithActor>, override?: Partial<AppendContext>) => Promise<StoredEvent[]>;

export function makeAppender(tx: Tx, env: CommandEnv, sink: StoredEvent[]): Appender {
  const correlationId = env.correlationId ?? randomUUID();
  return async (streamId, expectedVersion, events, override) => {
    const stored: StoredEvent[] = [];
    // Events that must be attributed to the system (e.g. automatic knockout)
    // are appended right after the actor's own events, on the same stream.
    let batch: DecidedEvent[] = [];
    let batchActor: Actor | undefined;
    let version = expectedVersion;
    const flush = async () => {
      if (!batch.length) return;
      const ctx: AppendContext = { tenantId: env.tenantId, actor: batchActor ?? env.actor, role: batchActor ? undefined : env.role, correlationId, causationId: env.causationId, requestId: env.requestId, locale: env.locale, clientHash: env.clientHash, ...override };
      const out = await appendToStream(tx, streamId, version, batch, ctx);
      // Project immediately so the rest of the command reads consistent tables
      await runProjections(tx);
      stored.push(...out);
      version = out.length ? out[out.length - 1].streamVersion : version;
      batch = [];
    };
    for (const e of events) {
      const actorOverride = (e as DecidedWithActor).actorOverride;
      if (actorOverride !== batchActor) { await flush(); batchActor = actorOverride; }
      batch.push({ type: e.type, payload: e.payload, reason: e.reason, causationId: e.causationId });
    }
    await flush();
    sink.push(...stored);
    return stored;
  };
}
