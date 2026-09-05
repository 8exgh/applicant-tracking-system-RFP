import { executeCommand } from './execute';
import { systemEnv } from './authz';
import { loadOrganization, loadProcess, loadApplication } from '@/lib/app/context';
import { streamIds } from '@/types/events';
import { decidePublish, decideClose } from '@/lib/domain/hiring-process';
import { expireDueOffers } from './application';
import { queueNotification } from '@/lib/notifications/queue';
import { formatDateTime } from '@/lib/i18n/format';
import { pickLang } from '@/lib/domain/lang';
import { decryptField } from '@/lib/crypto/pii';
import { now } from '@/lib/clock';
import { withPlatform } from '@/lib/db/pool';
import { getLogger } from '@/lib/logger';

const log = getLogger('scheduler');

function baseUrl(): string { return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''); }

// Process managers driven by time (spec §9.4): scheduled publish, automatic
// close, offer expiry, interview reminders. Idempotent: each pass only acts
// on what is due and not yet done. The background processor calls this.
export async function runDueSchedulers(): Promise<Record<string, number>> {
  const at = now();
  const counts = { published: 0, closed: 0, offersExpired: 0, reminders: 0 };
  const tenants = await withPlatform(async tx => (await tx.query('select tenant_id from org_settings')).rows.map(r => r.tenant_id as string));
  for (const tenantId of tenants) {
    const env = systemEnv(tenantId, 'scheduler');
    // Scheduled postings due to publish
    const due = await withPlatform(async tx => (await tx.query("select id from process_summary where tenant_id = $1 and status = 'Scheduled' and publish_at <= $2", [tenantId, at])).rows);
    for (const r of due) {
      try {
        await executeCommand({ ...env, causationId: 'PostingScheduled' }, async (tx, append) => {
          const org = await loadOrganization(tx, tenantId);
          const { state, version } = await loadProcess(tx, tenantId, r.id);
          if (state.status !== 'Scheduled') return;
          await append(streamIds.process(r.id), version, decidePublish(state, { closeAt: new Date(state.closeAt!), now: at, causationId: 'PostingScheduled' }, { languages: org.languages, timeZone: org.timeZone, rollingScreening: !!org.featureFlags.rolling_screening }));
          counts.published++;
        });
      } catch (err) { log.error(`publish ${r.id} failed`, err); }
    }
    // Postings past their closing time
    const closing = await withPlatform(async tx => (await tx.query("select id from process_summary where tenant_id = $1 and status = 'Posted' and close_at <= $2", [tenantId, at])).rows);
    for (const r of closing) {
      try {
        await executeCommand({ ...env, causationId: 'PostingPublished (closeAt)' }, async (tx, append) => {
          const { state, version } = await loadProcess(tx, tenantId, r.id);
          if (state.status !== 'Posted') return;
          await append(streamIds.process(r.id), version, decideClose(state, { now: at, reason: 'scheduled', causationId: 'PostingPublished (closeAt)' }));
          counts.closed++;
        });
      } catch (err) { log.error(`close ${r.id} failed`, err); }
    }
    // Offers past expiry
    try {
      await executeCommand({ ...env, causationId: 'OfferSent (expiresAt)' }, async (tx, append) => { counts.offersExpired += await expireDueOffers(tx, append, tenantId); });
    } catch (err) { log.error('offer expiry failed', err); }
    // Interview reminders 24h before
    try {
      await executeCommand({ ...env, causationId: 'InterviewBooked (reminder)' }, async (tx, append) => {
        const org = await loadOrganization(tx, tenantId);
        const { rows } = await tx.query(
          `select s.id, s.application_id, s.starts_at, s.process_id from interview_slots s
           where s.tenant_id = $1 and s.status = 'booked' and s.starts_at between $2 and $3
             and not exists (select 1 from notification_queue q where q.tenant_id = s.tenant_id and q.template_key = 'interview_reminder' and q.causation_id = s.id::text)`,
          [tenantId, at, new Date(at.getTime() + 24 * 3_600_000)]
        );
        for (const s of rows) {
          const { state } = await loadApplication(tx, tenantId, s.application_id);
          const { state: process } = await loadProcess(tx, tenantId, s.process_id);
          const cand = (await tx.query('select locale, profile_enc from candidates where tenant_id = $1 and id = $2', [tenantId, state.candidateId])).rows[0];
          const locale = cand?.locale ?? 'en';
          const profile = await decryptField<{ name?: string }>(tx, tenantId, cand?.profile_enc);
          const id = await queueNotification(tx, append, {
            tenantId, templateKey: 'interview_reminder', recipient: { kind: 'candidate', candidateId: state.candidateId },
            values: { candidate_name: profile?.name || (locale === 'fr' ? 'Candidat·e' : 'Candidate'), process_title: pickLang(process.title, locale).text, reference: process.reference, interview_time: formatDateTime(s.starts_at, locale, org.timeZone), link: `${baseUrl()}/${locale}/me/interviews/${s.application_id}` },
            causation: { eventType: 'InterviewBooked', eventId: s.id }, processId: s.process_id, applicationId: s.application_id, languages: org.languages, organizationName: org.name
          });
          if (id) counts.reminders++;
        }
      });
    } catch (err) { log.error('reminders failed', err); }
  }
  return counts;
}
