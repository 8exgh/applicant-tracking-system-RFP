import { withTenant, Tx } from '@/lib/db/pool';
import { StaffPrincipal, processAccess } from '@/lib/commands/authz';
import { loadApplication, loadOrganization, loadProcess } from '@/lib/app/context';
import { decryptField } from '@/lib/crypto/pii';
import { NotFoundError, ForbiddenError } from '@/lib/domain/errors';
import { can } from '@/lib/auth/permissions';
import { accessLog } from '@/lib/security';
import { currentOffer, PlainAnswers, nonConflictedAssessors, ApplicationState } from '@/lib/domain/application';
import { HiringProcessState } from '@/lib/domain/hiring-process';
import { buildProcessContext } from '@/lib/app/context';
import { streamIds } from '@/types/events';
import { loadStream } from '@/lib/db/event-store';
import { daysBetween } from '@/lib/i18n/format';
import { now } from '@/lib/clock';

export async function listProcesses(staff: StaffPrincipal) {
  return withTenant(staff.tenantId, async tx => {
    const { rows } = await tx.query('select * from process_summary where tenant_id = $1 order by created_at desc', [staff.tenantId]);
    const visible = rows.filter(r => {
      if (staff.roles.some(x => ['org_admin', 'hr_advisor', 'auditor'].includes(x))) return true;
      const onBoard = (r.board as Array<{ userId: string }>).some(b => b.userId === staff.userId);
      if (staff.roles.includes('hiring_manager') && (r.hiring_manager_id === staff.userId || onBoard)) return true;
      return staff.roles.includes('assessor') && onBoard;
    });
    const counts = await tx.query('select process_id, status, count(*)::int as n from application_summary where tenant_id = $1 group by process_id, status', [staff.tenantId]);
    return visible.map(r => ({
      processId: r.id, reference: r.reference, slug: r.slug, title: r.title, status: r.status, location: r.location, closeAt: r.close_at, publishedAt: r.published_at,
      hiringManagerId: r.hiring_manager_id, hrAdvisorId: r.hr_advisor_id, version: r.version, createdAt: r.created_at,
      applications: Object.fromEntries(counts.rows.filter(c => c.process_id === r.id).map(c => [c.status, c.n]))
    }));
  });
}

export async function processDetail(staff: StaffPrincipal, processId: string) {
  return withTenant(staff.tenantId, async tx => {
    const { state, version } = await loadProcess(tx, staff.tenantId, processId);
    const access = processAccess(staff, state);
    const org = await loadOrganization(tx, staff.tenantId);
    const { rows } = await tx.query('select status, count(*)::int as n from application_summary where tenant_id = $1 and process_id = $2 group by status', [staff.tenantId, processId]);
    const summary = Object.fromEntries(rows.map(r => [r.status, r.n]));
    const users = Object.values(org.users).map(u => ({ userId: u.userId, displayName: u.displayName || u.email, email: u.email, roles: u.roles, status: u.status }));
    return { ...state, version, access, counts: summary, users, org: { languages: org.languages, timeZone: org.timeZone, name: org.name, featureFlags: org.featureFlags, settings: org.settings } };
  });
}

export async function pipelineBoard(staff: StaffPrincipal, processId: string, filters: { source?: string; tag?: string } = {}) {
  return withTenant(staff.tenantId, async tx => {
    const { state } = await loadProcess(tx, staff.tenantId, processId);
    const access = processAccess(staff, state);
    const { rows } = await tx.query('select * from application_summary where tenant_id = $1 and process_id = $2 order by created_at', [staff.tenantId, processId]);
    const at = now();
    const cards = [];
    for (const r of rows) {
      if (filters.source && r.source?.source !== filters.source) continue;
      if (filters.tag && !(r.tags as string[]).includes(filters.tag)) continue;
      if (access === 'board' && !['Active', 'NotQualified', 'Hired'].includes(r.status)) continue;
      const cand = (await tx.query('select profile_enc, email_bounced, status from candidates where tenant_id = $1 and id = $2', [staff.tenantId, r.candidate_id])).rows[0];
      const profile = cand?.status === 'Removed' ? null : await decryptField<{ name?: string }>(tx, staff.tenantId, cand?.profile_enc);
      cards.push({
        applicationId: r.id, candidateId: r.candidate_id, name: cand?.status === 'Removed' ? 'Candidate (removed)' : (profile?.name || 'Candidate'), status: r.status, stage: r.stage,
        daysInStage: r.stage_entered_at ? daysBetween(r.stage_entered_at, at) : null, tags: r.tags, source: r.source?.source ?? null, qualified: r.qualified,
        offer: r.offer, emailBounced: r.email_bounced, version: r.stream_version, submittedAt: r.submitted_at, screening: r.screening
      });
    }
    return { processId, reference: state.reference, title: state.title, status: state.status, stages: state.stages, screeningOpen: state.screeningOpen, cards, access };
  });
}

// One application, with everything the caller's role may see (F04, F08)
export async function applicationDetail(staff: StaffPrincipal, applicationId: string) {
  return withTenant(staff.tenantId, async tx => {
    const { state: app, version } = await loadApplication(tx, staff.tenantId, applicationId);
    const { state: process } = await loadProcess(tx, staff.tenantId, app.processId);
    const access = processAccess(staff, process);
    const org = await loadOrganization(tx, staff.tenantId);
    await accessLog(tx, { tenantId: staff.tenantId, actorType: 'staff', actorId: staff.userId, resource: 'application', subjectId: app.candidateId, purpose: 'view' });
    const cand = (await tx.query('select email_enc, profile_enc, locale, email_bounced, status from candidates where tenant_id = $1 and id = $2', [staff.tenantId, app.candidateId])).rows[0];
    const removed = cand?.status === 'Removed';
    const profile = removed ? {} : (await decryptField<Record<string, string>>(tx, staff.tenantId, cand?.profile_enc)) ?? {};
    const email = removed ? null : await decryptField<string>(tx, staff.tenantId, cand?.email_enc);
    const answers = removed ? {} : (await decryptField<PlainAnswers>(tx, staff.tenantId, app.answers as never)) ?? {};
    const versions = [];
    for (const s of app.submissions) versions.push({ version: s.version, at: s.at, answers: removed ? {} : (await decryptField<PlainAnswers>(tx, staff.tenantId, s.answers as never)) ?? {} });
    const documents = [];
    for (const d of app.documents.filter(d => !d.removed)) documents.push({ documentId: d.documentId, filename: removed ? 'removed' : (await decryptField<string>(tx, staff.tenantId, d.filename as never)) ?? 'document', size: d.size, sha256: d.sha256, scanStatus: d.scanStatus, mime: d.mime });
    const isHr = can(staff.roles, 'note.hr_only');
    const notes = app.notes.filter(n => n.visibility === 'candidate' || n.visibility === 'process_team' || (n.visibility === 'hr_only' && isHr));
    // Assessors see other assessors' scores only after submitting their own (invariant 6)
    const mineSubmitted = app.submittedAssessors.includes(staff.userId) || access === 'full' || access === 'read' || (access === 'manager' && process.board.find(b => b.userId === staff.userId)?.role === 'chair');
    const scores = Object.fromEntries(Object.entries(app.scores).filter(([assessorId]) => assessorId === staff.userId || mineSubmitted));
    const offer = currentOffer(app);
    const offerView = offer ? { ...offer, fields: removed ? {} : await decryptField(tx, staff.tenantId, offer.fields as never), typedName: offer.typedName ? await decryptField(tx, staff.tenantId, offer.typedName as never) : null } : null;
    let accommodations: unknown[] | undefined;
    if (can(staff.roles, 'accommodation.view')) {
      const { rows } = await tx.query('select * from accommodations where tenant_id = $1 and application_id = $2 order by created_at', [staff.tenantId, applicationId]);
      accommodations = [];
      for (const r of rows) accommodations.push({ requestId: r.id, text: await decryptField<string>(tx, staff.tenantId, r.text_enc), contactPreference: r.contact_preference, stage: r.stage, arrangement: r.arrangement, createdAt: r.created_at });
    }
    // Everyone on the board may know an accommodation is in place, never the reason (F08)
    const { rows: arr } = await tx.query('select arrangement from accommodations where tenant_id = $1 and application_id = $2 and arrangement is not null', [staff.tenantId, applicationId]);
    const accommodationInPlace = arr.length > 0 ? { adjustments: arr.map(a => a.arrangement.adjustments) } : null;
    const ctx = buildProcessContext(process, org);
    return {
      applicationId, version, access, status: app.status, stage: app.stage, stageEnteredAt: app.stageEnteredAt, applicationVersion: app.version, locale: app.locale,
      candidate: { candidateId: app.candidateId, name: removed ? 'Candidate (removed)' : profile.name || 'Candidate', email, phone: profile.phone ?? null, locale: cand?.locale, emailBounced: cand?.email_bounced ?? false, removed },
      answers, versions, documents, consentNoticeVersion: app.consentNoticeVersion ?? null, source: app.source ?? null, screening: app.screening ?? null, screeningHistory: app.screeningHistory,
      tags: app.tags, notes, scores, submittedAssessors: app.submittedAssessors, consensus: app.consensus, disagreements: app.disagreements, qualified: app.qualified, failedCriteria: app.failedCriteria,
      exam: app.exam ? { ...app.exam, answers: app.exam.answers && (app.exam.released || access === 'full') ? await decryptField(tx, staff.tenantId, app.exam.answers as never) : undefined } : null,
      interview: app.interview ?? null, invitationSent: app.invitationSent, offer: offerView, offers: app.offers.map(o => ({ offerId: o.offerId, status: o.status })), hiredAt: app.hiredAt ?? null, withdrawnAt: app.withdrawnAt ?? null,
      accommodations, accommodationInPlace, myConflictDeclared: staff.userId in process.conflicts, myConflict: (process.conflicts[staff.userId] ?? []).includes(applicationId),
      process: { processId: process.id, reference: process.reference, title: process.title, status: process.status, criteria: process.criteria, plan: process.plan, rubrics: process.rubrics, stages: process.stages, board: process.board, screeningOpen: process.screeningOpen, knockouts: process.knockouts, offerApprovalRequired: ctx.offerApprovalRequired, timeZone: org.timeZone },
      requiredAssessors: nonConflictedAssessors(app, ctx)
    };
  });
}

export async function timeline(staff: StaffPrincipal, filters: { processId?: string; applicationId?: string; category?: string; candidateId?: string }) {
  return withTenant(staff.tenantId, async tx => {
    if (filters.processId) { const { state } = await loadProcess(tx, staff.tenantId, filters.processId); processAccess(staff, state); }
    if (!can(staff.roles, 'timeline.view')) throw new ForbiddenError();
    const org = await loadOrganization(tx, staff.tenantId);
    const conds = ['tenant_id = $1'];
    const args: unknown[] = [staff.tenantId];
    if (filters.processId) { args.push(filters.processId); conds.push(`process_id = $${args.length}`); }
    if (filters.applicationId) { args.push(filters.applicationId); conds.push(`application_id = $${args.length}`); }
    if (filters.category) { args.push(filters.category); conds.push(`category = $${args.length}`); }
    if (filters.candidateId) { args.push(filters.candidateId); conds.push(`application_id in (select id from application_summary where tenant_id = $1 and candidate_id = $${args.length})`); }
    if (!filters.processId && !filters.applicationId) conds.push("stream_type = 'org'");
    const { rows } = await tx.query(`select * from audit_timeline where ${conds.join(' and ')} order by global_position asc limit 2000`, args);
    const shredded = new Set((await tx.query("select id from candidates where tenant_id = $1 and status = 'Removed'", [staff.tenantId])).rows.map(r => r.id));
    const appCandidate = new Map((await tx.query('select id, candidate_id from application_summary where tenant_id = $1', [staff.tenantId])).rows.map(r => [r.id, r.candidate_id]));
    return {
      timeZone: org.timeZone,
      entries: rows.map(r => ({
        position: Number(r.global_position), stream: r.stream_id, type: r.event_type, category: r.category, actor: r.actor, reason: r.reason, causationId: r.causation_id,
        summary: r.summary, occurredAt: r.occurred_at, processId: r.process_id, applicationId: r.application_id,
        subject: r.application_id ? (shredded.has(appCandidate.get(r.application_id)) ? 'Candidate (removed)' : r.application_id) : null
      }))
    };
  });
}

export async function screeningWorklist(staff: StaffPrincipal, processId: string) {
  const board = await pipelineBoard(staff, processId);
  const groups = { notScreened: board.cards.filter(c => c.status === 'Submitted'), screenedIn: board.cards.filter(c => ['Active', 'NotQualified', 'Hired'].includes(c.status)), screenedOut: board.cards.filter(c => c.status === 'ScreenedOut'), automatic: board.cards.filter(c => c.status === 'ScreenedOut' && c.screening?.automatic), withdrawn: board.cards.filter(c => c.status === 'Withdrawn') };
  return { ...board, groups, summary: `Screened in ${groups.screenedIn.length} · Screened out ${groups.screenedOut.length} · Withdrawn ${groups.withdrawn.length} · Not screened ${groups.notScreened.length}` };
}

export async function orgSettingsView(staff: StaffPrincipal) {
  return withTenant(staff.tenantId, async tx => {
    const org = await loadOrganization(tx, staff.tenantId);
    const { rows } = await tx.query('select distinct on (key, lang) key, lang, version, subject, body, active from notification_templates where tenant_id = $1 order by key, lang, version desc', [staff.tenantId]);
    return { ...org, users: Object.values(org.users), templates: rows };
  });
}

export async function interviewSlots(staff: StaffPrincipal, processId: string) {
  return withTenant(staff.tenantId, async tx => {
    const { state } = await loadProcess(tx, staff.tenantId, processId);
    processAccess(staff, state);
    const { rows } = await tx.query('select * from interview_slots where tenant_id = $1 and process_id = $2 order by starts_at', [staff.tenantId, processId]);
    return rows.map(r => ({ slotId: r.id, startsAt: r.starts_at, endsAt: r.ends_at, board: r.board, status: r.status, applicationId: r.application_id }));
  });
}

export async function documentForDownload(staff: StaffPrincipal, applicationId: string, documentId: string): Promise<{ content: Buffer; filename: string; mime: string } | null> {
  return withTenant(staff.tenantId, async tx => {
    const { state: app } = await loadApplication(tx, staff.tenantId, applicationId);
    const { state: process } = await loadProcess(tx, staff.tenantId, app.processId);
    processAccess(staff, process);
    const { rows } = await tx.query('select * from documents where tenant_id = $1 and id = $2 and application_id = $3', [staff.tenantId, documentId, applicationId]);
    const d = rows[0];
    if (!d || d.removed) throw new NotFoundError('document_not_found');
    if (d.scan_status !== 'Available') throw new ForbiddenError('document_not_available', `Document is ${d.scan_status}`);
    await accessLog(tx, { tenantId: staff.tenantId, actorType: 'staff', actorId: staff.userId, resource: 'document', subjectId: app.candidateId, purpose: 'download' });
    return { content: d.content as Buffer, filename: (await decryptField<string>(tx, staff.tenantId, d.filename_enc)) ?? 'document', mime: d.mime };
  });
}

export async function assessmentWorkbook(staff: StaffPrincipal, processId: string) {
  return withTenant(staff.tenantId, async tx => {
    const { state: process } = await loadProcess(tx, staff.tenantId, processId);
    const access = processAccess(staff, process);
    const { rows } = await tx.query("select id from application_summary where tenant_id = $1 and process_id = $2 and status in ('Active', 'NotQualified') order by created_at", [staff.tenantId, processId]);
    const items = [];
    for (const r of rows) {
      const { state: app } = await loadApplication(tx, staff.tenantId, r.id);
      const conflicted = (process.conflicts[staff.userId] ?? []).includes(app.id);
      if (access === 'board' && conflicted) continue;
      const cand = (await tx.query('select profile_enc, status from candidates where tenant_id = $1 and id = $2', [staff.tenantId, app.candidateId])).rows[0];
      const profile = cand?.status === 'Removed' ? null : await decryptField<{ name?: string }>(tx, staff.tenantId, cand?.profile_enc);
      items.push({ applicationId: app.id, name: profile?.name || 'Candidate', stage: app.stage, status: app.status, mine: app.scores[staff.userId] ?? {}, submitted: app.submittedAssessors.includes(staff.userId), consensus: Object.fromEntries(Object.entries(app.consensus).map(([k, v]) => [k, v[v.length - 1]])), qualified: app.qualified, disagreements: app.disagreements, assessorsSubmitted: app.submittedAssessors, assessorsRequired: nonConflictedAssessors(app, buildProcessContext(process, await loadOrganization(tx, staff.tenantId))) });
    }
    return { processId, reference: process.reference, title: process.title, criteria: process.criteria, plan: process.plan, rubrics: process.rubrics, board: process.board, conflictDeclared: staff.userId in process.conflicts, items, access };
  });
}

export async function hrAccommodations(staff: StaffPrincipal, processId: string) {
  if (!can(staff.roles, 'accommodation.view')) throw new NotFoundError('not_found');
  return withTenant(staff.tenantId, async tx => {
    const { rows } = await tx.query('select * from accommodations where tenant_id = $1 and process_id = $2 order by created_at desc', [staff.tenantId, processId]);
    const out = [];
    for (const r of rows) out.push({ requestId: r.id, applicationId: r.application_id, text: await decryptField<string>(tx, staff.tenantId, r.text_enc), contactPreference: r.contact_preference, stage: r.stage, arrangement: r.arrangement, createdAt: r.created_at });
    await accessLog(tx, { tenantId: staff.tenantId, actorType: 'staff', actorId: staff.userId, resource: 'accommodation', purpose: 'view' });
    return out;
  });
}

export async function applicationsToScan(): Promise<Array<{ tenantId: string; applicationId: string; documentId: string }>> {
  const { withPlatform } = await import('@/lib/db/pool');
  return withPlatform(async tx => {
    const { rows } = await tx.query("select tenant_id, application_id, id from documents where scan_status = 'PendingScan' and not removed order by created_at limit 20");
    return rows.map(r => ({ tenantId: r.tenant_id, applicationId: r.application_id, documentId: r.id }));
  });
}

export async function documentBytesForScan(tenantId: string, documentId: string): Promise<Buffer | null> {
  const { withPlatform } = await import('@/lib/db/pool');
  return withPlatform(async tx => (await tx.query('select content from documents where tenant_id = $1 and id = $2', [tenantId, documentId])).rows[0]?.content ?? null);
}

export type { ApplicationState, HiringProcessState, Tx };
export { loadStream, streamIds };
