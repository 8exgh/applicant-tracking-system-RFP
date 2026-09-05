import { executeCommand } from './execute';
import { systemEnv } from './authz';
import { streamIds } from '@/types/events';
import { loadStream } from '@/lib/db/event-store';
import { decryptField } from '@/lib/crypto/pii';
import { withPlatform } from '@/lib/db/pool';
import { now } from '@/lib/clock';
import { DomainError } from '@/lib/domain/errors';

export const MAX_ATTEMPTS = 3;

export interface OutboundMessage { id: string; tenantId: string; templateKey: string; lang: string; to: string; subject: string; body: string; attempts: number; }

// The processor's todo list: queued messages whose next attempt is due.
// Decrypted here, sent by the processor, never logged in full (F16).
export async function notificationsToSend(limit = 50): Promise<OutboundMessage[]> {
  return withPlatform(async tx => {
    const { rows } = await tx.query(
      "select * from notification_queue where status = 'queued' and (next_attempt_at is null or next_attempt_at <= $1) order by queued_at asc limit $2",
      [now(), limit]
    );
    const out: OutboundMessage[] = [];
    for (const r of rows) {
      const to = await decryptField<string>(tx, r.tenant_id, r.address_enc);
      const subject = await decryptField<string>(tx, r.tenant_id, r.subject_enc);
      const body = await decryptField<string>(tx, r.tenant_id, r.body_enc);
      if (!to || subject === null || body === null) {
        // Keys destroyed (candidate shredded): nothing can be sent
        await tx.query("update notification_queue set status = 'failed', last_error = 'recipient_removed' where id = $1", [r.id]);
        continue;
      }
      out.push({ id: r.id, tenantId: r.tenant_id, templateKey: r.template_key, lang: r.lang, to, subject, body, attempts: r.attempts });
    }
    return out;
  });
}

export async function recordSent(cmd: { tenantId: string; notificationId: string; providerMessageId?: string }): Promise<void> {
  await executeCommand(systemEnv(cmd.tenantId, 'dispatcher'), async (tx, append) => {
    const streamId = streamIds.notification(cmd.notificationId);
    const events = await loadStream(tx, cmd.tenantId, streamId);
    if (!events.length) throw new DomainError('notification_not_found', undefined, undefined, 404);
    if (events.some(e => e.type === 'NotificationSent')) return; // duplicate delivery report (F16)
    await append(streamId, events.length, [{ type: 'NotificationSent', payload: { providerMessageId: cmd.providerMessageId ?? null } }]);
  });
}

export async function recordFailed(cmd: { tenantId: string; notificationId: string; error: string }): Promise<{ final: boolean }> {
  return executeCommand(systemEnv(cmd.tenantId, 'dispatcher'), async (tx, append) => {
    const streamId = streamIds.notification(cmd.notificationId);
    const events = await loadStream(tx, cmd.tenantId, streamId);
    if (!events.length) throw new DomainError('notification_not_found', undefined, undefined, 404);
    if (events.some(e => e.type === 'NotificationSent')) return { final: false };
    const attempts = events.filter(e => e.type === 'NotificationDeliveryFailed').length + 1;
    const final = attempts >= MAX_ATTEMPTS;
    const backoffMs = Math.min(60_000 * 2 ** (attempts - 1), 15 * 60_000); // exponential backoff
    await append(streamId, events.length, [{ type: 'NotificationDeliveryFailed', payload: { attempts, error: cmd.error.slice(0, 200), final, nextAttemptAt: final ? null : new Date(now().getTime() + backoffMs).toISOString() } }]);
    return { final };
  });
}

export async function recordBounce(cmd: { tenantId: string; notificationId: string; type: 'hard' | 'soft' }): Promise<void> {
  await executeCommand(systemEnv(cmd.tenantId, 'provider-webhook'), async (tx, append) => {
    const streamId = streamIds.notification(cmd.notificationId);
    const events = await loadStream(tx, cmd.tenantId, streamId);
    if (!events.length) throw new DomainError('notification_not_found', undefined, undefined, 404);
    if (cmd.type !== 'hard') return;
    const queued = events[0].payload as { recipientKind?: string; recipientRef?: string };
    await append(streamId, events.length, [{ type: 'NotificationBounced', payload: { type: cmd.type, recipientKind: queued.recipientKind, recipientRef: queued.recipientRef } }]);
  });
}
