import { withTenant, Tx } from '@/lib/db/pool';
import { loadApplication, loadProcess, loadOrganization, loadCandidate, resolveTenantById } from '@/lib/app/context';
import { decryptField } from '@/lib/crypto/pii';
import { pickLang } from '@/lib/domain/lang';
import { formatDateTime } from '@/lib/i18n/format';
import { NotFoundError } from '@/lib/domain/errors';
import { loadStream } from '@/lib/db/event-store';
import { streamIds } from '@/types/events';
import { currentOffer, PlainAnswers } from '@/lib/domain/application';
import { Locale } from '@/types/shared';
import { accessLog } from '@/lib/security';

export async function myProfile(tenantId: string, candidateId: string) {
  return withTenant(tenantId, async tx => {
    const { state } = await loadCandidate(tx, tenantId, candidateId);
    const org = await resolveTenantById(tx, tenantId);
    return {
      candidateId, locale: state.locale, marketingOptOut: state.marketingOptOut,
      email: await decryptField<string>(tx, tenantId, state.email as never),
      profile: (await decryptField<Record<string, string>>(tx, tenantId, state.profile as never)) ?? {},
      deletionDeferredUntil: state.deletionDeferredUntil ?? null, org
    };
  });
}

export async function myApplications(tenantId: string, candidateId: string, locale: Locale) {
  return withTenant(tenantId, async tx => {
    const org = await loadOrganization(tx, tenantId);
    const { rows } = await tx.query(
      `select a.*, p.title, p.reference, p.slug, p.stages, p.close_at, p.status as process_status from application_summary a join process_summary p on p.id = a.process_id
       where a.tenant_id = $1 and a.candidate_id = $2 order by a.created_at desc`, [tenantId, candidateId]
    );
    return rows.map(r => {
      const stage = (r.stages as Array<{ stageId: string; candidateLabel: Record<string, string> }>).find(s => s.stageId === r.stage);
      const offer = r.offer as { status?: string; expiresAt?: string } | null;
      return {
        applicationId: r.id, processId: r.process_id, title: pickLang(r.title, locale).text, reference: r.reference, slug: r.slug,
        status: r.status, stageLabel: stage && r.status === 'Active' ? pickLang(stage.candidateLabel, locale).text : null,
        closeAt: r.close_at, closeAtText: r.close_at ? formatDateTime(r.close_at, locale, org.timeZone) : '', processStatus: r.process_status,
        offer: offer ? { status: offer.status, expiresAt: offer.expiresAt } : null, version: r.version, updatedAt: r.updated_at
      };
    });
  });
}

// The application form model: questions generated from the criteria (F07)
export async function applicationForm(tenantId: string, candidateId: string, applicationId: string, locale: Locale) {
  return withTenant(tenantId, async tx => {
    const { state: app, version } = await loadApplication(tx, tenantId, applicationId);
    if (app.candidateId !== candidateId) throw new NotFoundError('application_not_found');
    const org = await loadOrganization(tx, tenantId);
    const { state: process } = await loadProcess(tx, tenantId, app.processId);
    const answers = (await decryptField<PlainAnswers>(tx, tenantId, app.answers as never)) ?? {};
    const documents = [];
    for (const d of app.documents.filter(d => !d.removed)) {
      documents.push({ documentId: d.documentId, filename: (await decryptField<string>(tx, tenantId, d.filename as never)) ?? 'document', size: d.size, scanStatus: d.scanStatus });
    }
    const selfDecl = await loadStream(tx, tenantId, streamIds.selfDeclaration(applicationId));
    const hasSelfDeclaration = selfDecl.length > 0 && selfDecl[selfDecl.length - 1].type === 'SelfDeclarationRecorded';
    const { rows: notes } = await tx.query("select * from audit_timeline where tenant_id = $1 and application_id = $2 and event_type = 'NoteAdded' and summary->>'visibility' = 'candidate' order by global_position", [tenantId, applicationId]);
    const closeAt = process.closeAt ? new Date(process.closeAt) : null;
    const acceptingEdits = process.status === 'Posted' && !!closeAt && closeAt.getTime() > Date.now() && ['Draft', 'Submitted'].includes(app.status);
    const { rows: history } = await tx.query('select template_key, lang, status, queued_at, sent_at from notification_queue where tenant_id = $1 and recipient_ref = $2 and template_key <> $3 order by queued_at desc limit 50', [tenantId, candidateId, 'magic_link']);
    const stage = process.stages.find(s => s.stageId === app.stage);
    return {
      applicationId, version, status: app.status, applicationVersion: app.version, answers, documents, hasSelfDeclaration, acceptingEdits,
      consentGiven: app.consentNoticeVersion === org.settings.privacyNoticeVersion, privacyNoticeVersion: org.settings.privacyNoticeVersion,
      process: {
        processId: process.id, title: pickLang(process.title, locale).text, reference: process.reference, slug: process.slug, status: process.status,
        closeAt: process.closeAt, closeAtText: process.closeAt ? formatDateTime(process.closeAt, locale, org.timeZone) : '',
        criteria: process.criteria.map(c => ({ code: c.code, type: c.type, text: pickLang(c.text, locale), required: c.type === 'essential' })),
        knockouts: process.knockouts.map(k => ({ code: k.code, question: pickLang(k.question, locale) }))
      },
      stageLabel: stage && app.status === 'Active' ? pickLang(stage.candidateLabel, locale).text : null,
      candidateNotes: notes.map(n => ({ text: n.summary.text, at: n.occurred_at })),
      notifications: history,
      interview: app.interview ? { slotId: app.interview.slotId, at: app.interview.at, status: app.interview.status, atText: formatDateTime(app.interview.at, locale, org.timeZone) } : null,
      invitationSent: app.invitationSent,
      exam: app.exam ? { criterionCode: app.exam.criterionCode, windowStart: app.exam.windowStart, windowEnd: app.exam.windowEnd, limitMinutes: app.exam.limitMinutes, startedAt: app.exam.startedAt ?? null, deadline: app.exam.deadline ?? null, submittedAt: app.exam.submittedAt ?? null } : null,
      offer: await offerView(tx, tenantId, app, locale, org.timeZone),
      org: { name: org.name, timeZone: org.timeZone, slug: org.slug }
    };
  });
}

async function offerView(tx: Tx, tenantId: string, app: import('@/lib/domain/application').ApplicationState, locale: Locale, timeZone: string) {
  const offer = currentOffer(app);
  if (!offer || !['Sent', 'Accepted', 'Declined', 'Expired', 'Rescinded'].includes(offer.status)) return null;
  const fields = (await decryptField<Record<string, string>>(tx, tenantId, offer.fields as never)) ?? {};
  return {
    offerId: offer.offerId, status: offer.status, fields, expiresAt: offer.expiresAt ?? null, expiresAtText: offer.expiresAt ? formatDateTime(offer.expiresAt, locale, timeZone) : '',
    acceptedAt: offer.acceptedAt ?? null, acceptedAtText: offer.acceptedAt ? formatDateTime(offer.acceptedAt, locale, timeZone) : ''
  };
}

export async function candidateSlots(tenantId: string, candidateId: string, applicationId: string) {
  return withTenant(tenantId, async tx => {
    const { state: app } = await loadApplication(tx, tenantId, applicationId);
    if (app.candidateId !== candidateId) throw new NotFoundError('application_not_found');
    const org = await loadOrganization(tx, tenantId);
    const { rows } = await tx.query("select id, starts_at, ends_at from interview_slots where tenant_id = $1 and process_id = $2 and status = 'open' and starts_at > now() order by starts_at", [tenantId, app.processId]);
    return { slots: rows.map(r => ({ slotId: r.id, startsAt: new Date(r.starts_at).toISOString(), endsAt: new Date(r.ends_at).toISOString() })), orgTimeZone: org.timeZone, current: app.interview?.status === 'booked' ? { slotId: app.interview.slotId, at: app.interview.at } : null, rescheduleCutoffHours: org.settings.rescheduleCutoffHours, hrContact: org.users[(await loadProcess(tx, tenantId, app.processId)).state.hrAdvisorId]?.email ?? null };
  });
}

export async function logCandidateSelfRead(tenantId: string, candidateId: string, resource: string): Promise<void> {
  await withTenant(tenantId, tx => accessLog(tx, { tenantId, actorType: 'candidate', actorId: candidateId, resource, subjectId: candidateId, purpose: 'self' }));
}
