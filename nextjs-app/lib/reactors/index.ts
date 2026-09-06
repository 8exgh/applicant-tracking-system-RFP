import { Tx } from '@/lib/db/pool';
import { StoredEvent } from '@/lib/db/event-store';
import { CommandEnv, makeAppender } from '@/lib/commands/execute';
import { streamType, streamEntityId } from '@/types/events';
import { queueNotification, QueueParams } from '@/lib/notifications/queue';
import { loadOrganization, loadProcess } from '@/lib/app/context';
import { OrganizationState } from '@/lib/domain/organization';
import { HiringProcessState } from '@/lib/domain/hiring-process';
import { formatDateTime } from '@/lib/i18n/format';
import { pickLang } from '@/lib/domain/lang';
import { decryptField } from '@/lib/crypto/pii';
import { Locale } from '@/types/shared';
import { getLogger } from '@/lib/logger';

const log = getLogger('reactors');

// Process managers (spec §9.4): turn domain events into notifications. They
// run once, inline, in the command transaction, keyed on the causing event.
export async function runReactors(tx: Tx, events: StoredEvent[], env: CommandEnv): Promise<void> {
  const sink: StoredEvent[] = [];
  for (const event of events) {
    const kind = streamType(event.streamId);
    if (!['process', 'application', 'accommodation', 'candidate'].includes(kind)) continue;
    const append = makeAppender(tx, { ...env, actor: { type: 'system', id: 'reactor' }, role: undefined, causationId: event.metadata.eventId }, sink);
    try {
      await react(tx, event, append);
    } catch (err) {
      log.error(`reactor failed for ${event.type} at ${event.globalPosition}`, err);
      throw err;
    }
  }
}

function baseUrl(): string { return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''); }

async function candidateName(tx: Tx, tenantId: string, candidateId: string, locale: Locale): Promise<string> {
  const { rows } = await tx.query('select profile_enc from candidates where tenant_id = $1 and id = $2', [tenantId, candidateId]);
  const profile = await decryptField<{ name?: string }>(tx, tenantId, rows[0]?.profile_enc);
  return profile?.name?.trim() || (locale === 'fr' ? 'Candidat·e' : 'Candidate');
}

interface Ctx { org: OrganizationState; process: HiringProcessState; }

async function processValues(tx: Tx, ctx: Ctx, locale: Locale, extra: Record<string, string | undefined> = {}): Promise<Record<string, string | undefined>> {
  return {
    process_title: pickLang(ctx.process.title, locale).text,
    reference: ctx.process.reference,
    closing_time: ctx.process.closeAt ? formatDateTime(ctx.process.closeAt, locale, ctx.org.timeZone) : '',
    link: `${baseUrl()}/${locale}/me`,
    ...extra
  };
}

async function toCandidate(tx: Tx, append: ReturnType<typeof makeAppender>, ctx: Ctx, event: StoredEvent, templateKey: QueueParams['templateKey'], candidateId: string, applicationId: string, extra: Record<string, string | undefined> = {}): Promise<void> {
  const { rows } = await tx.query('select locale from candidates where tenant_id = $1 and id = $2', [event.tenantId, candidateId]);
  const locale: Locale = rows[0]?.locale ?? 'en';
  const values = await processValues(tx, ctx, locale, { candidate_name: await candidateName(tx, event.tenantId, candidateId, locale), ...extra });
  await queueNotification(tx, append, {
    tenantId: event.tenantId, templateKey, recipient: { kind: 'candidate', candidateId }, values,
    causation: { eventType: event.type, eventId: event.metadata.eventId }, processId: ctx.process.id, applicationId,
    languages: ctx.org.languages, organizationName: ctx.org.name
  });
}

type Extra = Record<string, string | undefined> | ((locale: Locale) => Record<string, string | undefined>);

async function toStaff(tx: Tx, append: ReturnType<typeof makeAppender>, ctx: Ctx, event: StoredEvent, templateKey: QueueParams['templateKey'], userIds: string[], extra: Extra = {}): Promise<void> {
  for (const userId of Array.from(new Set(userIds.filter(Boolean)))) {
    const user = ctx.org.users[userId];
    const locale: Locale = user?.language ?? 'en';
    const values = await processValues(tx, ctx, locale, { link: `${baseUrl()}/staff/processes/${ctx.process.id}`, ...(typeof extra === 'function' ? extra(locale) : extra) });
    await queueNotification(tx, append, {
      tenantId: event.tenantId, templateKey, recipient: { kind: 'staff', userId }, values,
      causation: { eventType: event.type, eventId: event.metadata.eventId }, processId: ctx.process.id,
      languages: ctx.org.languages, organizationName: ctx.org.name
    });
  }
}

async function applicantsOf(tx: Tx, tenantId: string, processId: string, statuses: string[]): Promise<Array<{ id: string; candidate_id: string; stage: string | null }>> {
  const { rows } = await tx.query('select id, candidate_id, stage from application_summary where tenant_id = $1 and process_id = $2 and status = any($3)', [tenantId, processId, statuses]);
  return rows;
}

async function react(tx: Tx, event: StoredEvent, append: ReturnType<typeof makeAppender>): Promise<void> {
  const kind = streamType(event.streamId);
  const p = event.payload as Record<string, any>;
  const tenantId = event.tenantId;

  if (kind === 'process') {
    const processId = streamEntityId(event.streamId);
    const org = await loadOrganization(tx, tenantId);
    const { state: process } = await loadProcess(tx, tenantId, processId);
    const ctx = { org, process };
    switch (event.type) {
      case 'ApprovalRequested': {
        const admins = Object.values(org.users).filter(u => u.status === 'Active' && u.roles.includes('org_admin')).map(u => u.userId);
        await toStaff(tx, append, ctx, event, 'approval_requested', admins);
        break;
      }
      case 'ProcessApproved':
        await toStaff(tx, append, ctx, event, 'approval_decided', [process.hiringManagerId, process.hrAdvisorId], locale => ({ reason: `${locale === 'fr' ? 'Approuvé' : 'Approved'}${p.comment ? ` : ${p.comment}` : ''}` }));
        break;
      case 'ProcessApprovalRejected':
        await toStaff(tx, append, ctx, event, 'approval_decided', [process.hiringManagerId], locale => ({ reason: `${locale === 'fr' ? 'Refusé' : 'Rejected'} : ${p.reason}` }));
        break;
      case 'ClosingDateExtended':
        for (const a of await applicantsOf(tx, tenantId, processId, ['Draft', 'Submitted', 'Active'])) await toCandidate(tx, append, ctx, event, 'closing_date_extended', a.candidate_id, a.id);
        break;
      case 'PostingAmended':
        for (const a of await applicantsOf(tx, tenantId, processId, ['Draft', 'Submitted', 'Active'])) await toCandidate(tx, append, ctx, event, 'posting_amended', a.candidate_id, a.id, { reason: p.reason, link: `${baseUrl()}/en/jobs/${process.slug}` });
        break;
      case 'ProcessCancelled':
        for (const a of await applicantsOf(tx, tenantId, processId, ['Draft', 'Submitted', 'Active', 'ScreenedOut', 'NotQualified'])) await toCandidate(tx, append, ctx, event, 'process_cancelled', a.candidate_id, a.id);
        break;
      case 'ScreeningResultsReleased': {
        // Batched: one message per decision, only now (F09, F16)
        for (const a of await applicantsOf(tx, tenantId, processId, ['ScreenedOut'])) await toCandidate(tx, append, ctx, event, 'screened_out', a.candidate_id, a.id);
        const target = process.stages.find(s => s.stageId === 'assessment') ?? process.stages[2];
        if (target?.notifies) {
          for (const a of await applicantsOf(tx, tenantId, processId, ['Active'])) {
            const { rows } = await tx.query('select locale from candidates where tenant_id = $1 and id = $2', [tenantId, a.candidate_id]);
            await toCandidate(tx, append, ctx, event, 'screened_in', a.candidate_id, a.id, { stage_label: pickLang(target.candidateLabel, rows[0]?.locale ?? 'en').text });
          }
        }
        break;
      }
    }
    return;
  }

  if (kind === 'application') {
    const applicationId = streamEntityId(event.streamId);
    const { rows } = await tx.query('select process_id, candidate_id, stage from application_summary where tenant_id = $1 and id = $2', [tenantId, applicationId]);
    const row = rows[0];
    if (!row) return;
    const org = await loadOrganization(tx, tenantId);
    const { state: process } = await loadProcess(tx, tenantId, row.process_id);
    const ctx = { org, process };
    const cand = row.candidate_id as string;
    const localeRow = await tx.query('select locale from candidates where tenant_id = $1 and id = $2', [tenantId, cand]);
    const locale: Locale = localeRow.rows[0]?.locale ?? 'en';
    switch (event.type) {
      case 'ApplicationSubmitted': await toCandidate(tx, append, ctx, event, 'application_submitted', cand, applicationId); break;
      case 'ApplicationWithdrawn': await toCandidate(tx, append, ctx, event, 'application_withdrawn', cand, applicationId); break;
      case 'ApplicationMovedToStage': {
        const stage = process.stages.find(s => s.stageId === p.to);
        if (stage?.notifies) await toCandidate(tx, append, ctx, event, 'stage_update', cand, applicationId, { stage_label: pickLang(stage.candidateLabel, locale).text });
        break;
      }
      case 'InterviewInvitationSent': await toCandidate(tx, append, ctx, event, 'interview_invitation', cand, applicationId, { link: `${baseUrl()}/${locale}/me/interviews/${applicationId}` }); break;
      case 'InterviewBooked': await toCandidate(tx, append, ctx, event, 'interview_confirmation', cand, applicationId, { interview_time: formatDateTime(p.at, locale, org.timeZone), link: `${baseUrl()}/${locale}/me/interviews/${applicationId}` }); break;
      case 'InterviewRescheduled': await toCandidate(tx, append, ctx, event, 'interview_rescheduled', cand, applicationId, { interview_time: formatDateTime(p.to, locale, org.timeZone) }); break;
      case 'InterviewCancelled': await toCandidate(tx, append, ctx, event, 'interview_cancelled', cand, applicationId, { reason: p.reason }); break;
      case 'ExamAssigned': await toCandidate(tx, append, ctx, event, 'exam_assigned', cand, applicationId, { window_start: formatDateTime(p.windowStart, locale, org.timeZone), window_end: formatDateTime(p.windowEnd, locale, org.timeZone), link: `${baseUrl()}/${locale}/me/exams/${applicationId}` }); break;
      case 'OfferSent': {
        const fields = await decryptField<{ position?: string }>(tx, tenantId, (await tx.query("select payload from events where tenant_id = $1 and stream_id = $2 and event_type = 'OfferDrafted' order by stream_version desc limit 1", [tenantId, event.streamId])).rows[0]?.payload?.fields);
        await toCandidate(tx, append, ctx, event, 'offer_sent', cand, applicationId, { position: fields?.position ?? '', offer_expiry: formatDateTime(p.expiresAt, locale, org.timeZone), link: `${baseUrl()}/${locale}/me/offers/${applicationId}` });
        break;
      }
      case 'OfferAccepted': {
        const name = await candidateName(tx, tenantId, cand, 'en');
        await toStaff(tx, append, ctx, event, 'offer_accepted', [process.hrAdvisorId, process.hiringManagerId], { candidate_name: name, position: '', start_date: '' });
        break;
      }
      case 'OfferRescinded': await toCandidate(tx, append, ctx, event, 'offer_rescinded', cand, applicationId, { reason: p.reason, position: '' }); break;
    }
    return;
  }

  if (kind === 'accommodation' && event.type === 'AccommodationRequested') {
    const org = await loadOrganization(tx, tenantId);
    const { state: process } = await loadProcess(tx, tenantId, p.processId);
    await toStaff(tx, append, { org, process }, event, 'accommodation_requested', [process.hrAdvisorId], { link: `${baseUrl()}/staff/applications/${streamEntityId(event.streamId)}` });
    return;
  }

  if (kind === 'candidate' && event.type === 'CandidateDeletionDeferred') {
    const candidateId = streamEntityId(event.streamId);
    const org = await loadOrganization(tx, tenantId);
    const { rows } = await tx.query('select locale from candidates where tenant_id = $1 and id = $2', [tenantId, candidateId]);
    const locale: Locale = rows[0]?.locale ?? 'en';
    await queueNotification(tx, append, {
      tenantId, templateKey: 'deletion_deferred', recipient: { kind: 'candidate', candidateId },
      values: { candidate_name: await candidateName(tx, tenantId, candidateId, locale), closing_time: formatDateTime(p.until, locale, org.timeZone), link: `${baseUrl()}/${locale}/me` },
      causation: { eventType: event.type, eventId: event.metadata.eventId }, languages: org.languages, organizationName: org.name
    });
  }
}
