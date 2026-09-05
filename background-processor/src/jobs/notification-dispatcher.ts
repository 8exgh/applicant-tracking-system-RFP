import { query, command } from '../utils/api-client.js';
import { EmailProvider } from '../utils/email-provider.js';

interface Outbound { id: string; tenantId: string; templateKey: string; lang: string; to: string; subject: string; body: string; attempts: number; }

// Drains the notification todo list: at-least-once delivery from the queue,
// with the app recording the outcome (retries with backoff, final failure).
export async function runNotificationDispatcher(provider: EmailProvider, limit = 50): Promise<{ sent: number; failed: number }> {
  const todo = await query<Outbound[]>('notifications-to-send', { limit: String(limit) });
  let sent = 0, failed = 0;
  for (const m of todo) {
    try {
      const result = await provider.send({ id: m.id, to: m.to, subject: m.subject, text: m.body });
      await command('record-notification-sent', { tenantId: m.tenantId, notificationId: m.id, providerMessageId: result.providerMessageId });
      console.log(`[dispatcher] sent ${m.id} template=${m.templateKey} lang=${m.lang} provider=${provider.name}`);
      sent++;
    } catch (err: any) {
      const r = await command<{ final: boolean }>('record-notification-failed', { tenantId: m.tenantId, notificationId: m.id, error: String(err?.message ?? err).slice(0, 200) }).catch(() => ({ final: false }));
      console.error(`[dispatcher] failed ${m.id} attempt=${m.attempts + 1} final=${r.final}: ${String(err?.message ?? err).slice(0, 120)}`);
      failed++;
    }
  }
  return { sent, failed };
}
