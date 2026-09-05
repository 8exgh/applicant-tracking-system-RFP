import { z, ZodType } from 'zod';
import { NextResponse } from 'next/server';
import { HandlerContext, zLang, zLangMap, zUuid } from './handler';
import { requireStaff, requireCandidate, requirePlatform, requireApi, requireProcessWrite, staffEnv, candidateEnv, platformEnv, processAccess } from '@/lib/commands/authz';
import * as org from '@/lib/commands/organization';
import * as proc from '@/lib/commands/process';
import * as app from '@/lib/commands/application';
import * as cand from '@/lib/commands/candidate';
import * as auth from '@/lib/commands/auth';
import * as notif from '@/lib/commands/notification';
import * as ops from '@/lib/commands/ops';
import { runDueSchedulers } from '@/lib/commands/scheduler';
import { withTenant, withPlatform } from '@/lib/db/pool';
import { loadProcess, loadApplication } from '@/lib/app/context';
import { DomainError, NotFoundError, ForbiddenError } from '@/lib/domain/errors';
import { securityLog } from '@/lib/security';
import { can } from '@/lib/auth/permissions';
import { randomUUID } from 'crypto';
import { CANDIDATE_COOKIE } from '@/lib/auth/middleware';
import { setFakeNow } from '@/lib/clock';
import { TEMPLATE_KEYS } from '@/lib/domain/notification';

type Ctx<T> = HandlerContext<T>;
export interface CommandDef<T = unknown> { schema: ZodType<T>; idempotent?: boolean; run: (ctx: Ctx<T>) => Promise<unknown>; }

const def = <T>(schema: ZodType<T>, run: (ctx: Ctx<T>) => Promise<unknown>, idempotent = true): CommandDef<T> => ({ schema, run, idempotent });

const zStage = z.object({ stageId: z.string().regex(/^[a-z0-9_]{1,40}$/), name: zLangMap, candidateLabel: zLangMap, notifies: z.boolean(), requiresConsensus: z.boolean(), order: z.number().int(), ageingThresholdDays: z.number().int().positive().optional() }).strict();
const zRole = z.enum(['org_admin', 'hr_advisor', 'hiring_manager', 'assessor', 'auditor']);
const zMarks = z.record(z.string(), z.enum(['met', 'not_met']));
const zMethod = z.enum(['application', 'written_exam', 'interview', 'reference_check', 'portfolio', 'sle', 'other']);
const withVersion = <T extends z.ZodRawShape>(shape: T) => z.object({ ...shape, expectedVersion: z.number().int().nonnegative().optional() }).strict();

// Resolves the staff caller and checks process-scoped access before a process command
async function staffOnProcess(ctx: Ctx<{ processId: string }>, action: Parameters<typeof requireProcessWrite>[2]) {
  const staff = requireStaff(ctx.principal, action);
  await withTenant(staff.tenantId, async tx => {
    const { state } = await loadProcess(tx, staff.tenantId, ctx.body.processId);
    requireProcessWrite(staff, state, action);
  });
  return staff;
}

async function staffOnApplication(ctx: Ctx<{ applicationId: string }>, action: Parameters<typeof requireProcessWrite>[2]) {
  const staff = requireStaff(ctx.principal, action);
  await withTenant(staff.tenantId, async tx => {
    const { state: a } = await loadApplication(tx, staff.tenantId, ctx.body.applicationId).catch(() => { throw new NotFoundError('application_not_found'); });
    const { state } = await loadProcess(tx, staff.tenantId, a.processId);
    requireProcessWrite(staff, state, action);
  });
  return staff;
}

async function candidateOwns(ctx: Ctx<{ applicationId: string }>) {
  const c = requireCandidate(ctx.principal);
  await withTenant(c.tenantId, async tx => {
    const { state } = await loadApplication(tx, c.tenantId, ctx.body.applicationId).catch(() => { throw new NotFoundError('application_not_found'); });
    if (state.candidateId !== c.candidateId) throw new NotFoundError('application_not_found');
  });
  return c;
}

const ev = (ctx: Ctx<{ expectedVersion?: number }>) => ({ expectedVersion: ctx.body.expectedVersion ?? ctx.expectedVersion });

export const commands: Record<string, CommandDef<any>> = {
  // ---- auth ----
  'staff-login': def(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).strict(), async ctx => auth.staffLogin({ ...ctx.body, ip: ctx.ip }), false),
  'platform-login': def(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).strict(), async ctx => auth.platformLogin(ctx.body), false),
  'sign-out': def(z.object({}).strict(), async ctx => { if (ctx.principal && 'sessionId' in ctx.principal) await auth.signOut(ctx.principal.sessionId); return { ok: true }; }, false),
  'accept-invite': def(z.object({ token: z.string().min(10), password: z.string().min(1).max(200), displayName: z.string().max(120).optional() }).strict(), async ctx => org.acceptInvite(ctx.body), false),
  'request-magic-link': def(z.object({ org: z.string().min(1).max(40), email: z.string().max(254), locale: zLang, next: z.string().max(400).optional(), website: z.string().max(200).optional() }).strict(), async ctx => {
    // Honeypot: bots fill "website"; respond neutrally and do nothing (F07)
    if (ctx.body.website) { await securityLog(null, { kind: 'honeypot', resource: 'magic_link' }); return { ok: true }; }
    const r = await auth.requestMagicLink({ orgSlug: ctx.body.org, email: ctx.body.email, locale: ctx.body.locale, ip: ctx.ip, next: ctx.body.next });
    return { ok: true, ...(r.link ? { link: r.link } : {}) };
  }, false),

  // ---- platform ----
  'create-organization': def(z.object({ name: z.string().min(1).max(120), slug: z.string().min(1).max(40), timeZone: z.string().min(1), languages: z.array(z.object({ code: zLang, required: z.boolean() })).optional(), adminEmail: z.string().email(), adminName: z.string().max(120).optional(), referencePrefix: z.string().max(4).optional() }).strict(), async ctx => {
    const op = requirePlatform(ctx.principal);
    return org.createOrganization(platformEnv(randomUUID(), op.operatorId), ctx.body);
  }),
  'set-feature-flag': def(z.object({ tenantId: zUuid, flag: z.string(), enabled: z.boolean() }).strict(), async ctx => {
    const op = requirePlatform(ctx.principal);
    await org.setFeatureFlag(platformEnv(ctx.body.tenantId, op.operatorId), ctx.body);
    return { ok: true };
  }),
  'rebuild-projection': def(z.object({ projection: z.string() }).strict(), async ctx => {
    if (!ctx.principal || (ctx.principal.kind !== 'platform' && ctx.principal.kind !== 'api')) throw new DomainError('unauthorized', undefined, undefined, 401);
    if (!ops.projectionNames.includes(ctx.body.projection)) throw new DomainError('projection_unknown', undefined, { projections: ops.projectionNames }, 404);
    return { applied: await ops.rebuild(ctx.body.projection) };
  }, false),
  'run-projections': def(z.object({}).strict(), async ctx => { requireApi(ctx.principal); return { applied: await ops.catchUpProjections() }; }, false),
  'run-schedulers': def(z.object({}).strict(), async ctx => { requireApi(ctx.principal); return runDueSchedulers(); }, false),
  'set-fake-clock': def(z.object({ now: z.string().nullable() }).strict(), async ctx => {
    if (process.env.ATS_FAKE_CLOCK !== '1') throw new NotFoundError();
    requireApi(ctx.principal); setFakeNow(ctx.body.now); return { ok: true };
  }, false),

  // ---- organization admin ----
  'update-organization-settings': def(z.object({ languages: z.array(z.object({ code: zLang, required: z.boolean() })).optional(), timeZone: z.string().optional(), name: z.string().max(120).optional(), settings: z.object({ suppressionThreshold: z.number().int().min(1).optional(), privacyNoticeVersion: z.number().int().min(1).optional(), idleTimeoutMinutes: z.number().int().min(5).optional(), referencePrefix: z.string().max(4).optional(), offerApprovalRequired: z.boolean().optional(), rescheduleCutoffHours: z.number().int().min(0).optional(), disagreementThreshold: z.number().int().min(1).optional() }).strict().optional() }).strict(), async ctx => {
    const staff = requireStaff(ctx.principal, 'org.settings'); await org.updateSettings(staffEnv(staff), ctx.body); return { ok: true };
  }),
  'update-branding': def(z.object({ logo: z.string().max(2000).optional(), primary: z.string().optional(), secondary: z.string().optional(), surface: z.string().optional(), text: z.string().optional(), footer: z.string().max(500).optional() }).strict(), async ctx => {
    const staff = requireStaff(ctx.principal, 'org.settings'); await org.updateBranding(staffEnv(staff), ctx.body); return { ok: true };
  }),
  'invite-user': def(z.object({ email: z.string().email(), displayName: z.string().max(120), roles: z.array(zRole).min(1), language: zLang }).strict(), async ctx => {
    const staff = requireStaff(ctx.principal, 'org.users'); return org.inviteUser(staffEnv(staff), ctx.body);
  }),
  'assign-role': def(z.object({ userId: zUuid, role: zRole }).strict(), async ctx => { const staff = requireStaff(ctx.principal, 'org.users'); await org.assignRole(staffEnv(staff), ctx.body); return { ok: true }; }),
  'revoke-role': def(z.object({ userId: zUuid, role: zRole, reason: z.string().max(300).optional() }).strict(), async ctx => { const staff = requireStaff(ctx.principal, 'org.users'); await org.revokeRole(staffEnv(staff), ctx.body); return { ok: true }; }),
  'deactivate-user': def(z.object({ userId: zUuid }).strict(), async ctx => { const staff = requireStaff(ctx.principal, 'org.users'); await org.deactivateUser(staffEnv(staff), ctx.body); return { ok: true }; }),
  'revoke-all-sessions': def(z.object({}).strict(), async ctx => { const staff = requireStaff(ctx.principal, 'org.sessions'); const revoked = await org.revokeAllSessions(staffEnv(staff)); await securityLog(null, { tenantId: staff.tenantId, kind: 'sessions_revoked', actorId: staff.userId, detail: { revoked } }); return { revoked }; }),
  'update-stage-template': def(z.object({ stages: z.array(zStage).min(1) }).strict(), async ctx => { const staff = requireStaff(ctx.principal, 'org.settings'); await org.updateStageTemplate(staffEnv(staff), ctx.body); return { ok: true }; }),
  'save-template': def(z.object({ key: z.enum(TEMPLATE_KEYS), lang: zLang, subject: z.string().max(300), body: z.string().max(20000) }).strict(), async ctx => { const staff = requireStaff(ctx.principal, 'org.templates'); await org.saveTemplate(staffEnv(staff), ctx.body); return { ok: true }; }),
  'activate-template': def(z.object({ key: z.enum(TEMPLATE_KEYS) }).strict(), async ctx => { const staff = requireStaff(ctx.principal, 'org.templates'); await org.activateTemplate(staffEnv(staff), ctx.body); return { ok: true }; }),

  // ---- hiring process ----
  'create-process': def(z.object({ title: zLangMap, hiringManager: zUuid, hrAdvisor: zUuid, location: z.string().max(200), classification: z.string().max(100).optional() }).strict(), async ctx => {
    const staff = requireStaff(ctx.principal, 'process.create'); return proc.createProcess(staffEnv(staff), ctx.body);
  }),
  'clone-process': def(z.object({ processId: zUuid, title: zLangMap }).strict(), async ctx => { const staff = await staffOnProcess(ctx, 'process.create'); return proc.cloneProcess(staffEnv(staff), ctx.body.processId, { title: ctx.body.title }); }),
  'update-process-details': def(withVersion({ processId: zUuid, title: zLangMap.optional(), hiringManager: zUuid.optional(), hrAdvisor: zUuid.optional(), location: z.string().max(200).optional(), classification: z.string().max(100).optional() }), async ctx => { const staff = await staffOnProcess(ctx, 'process.edit'); const { processId, ...rest } = ctx.body; return proc.updateDetails(staffEnv(staff), processId, { ...rest, ...ev(ctx) }); }),
  'add-criterion': def(withVersion({ processId: zUuid, type: z.enum(['essential', 'asset', 'organizational_need', 'operational_requirement', 'condition_of_employment']), text: zLangMap }), async ctx => { const staff = await staffOnProcess(ctx, 'process.edit'); return proc.addCriterion(staffEnv(staff), ctx.body.processId, { type: ctx.body.type, text: ctx.body.text, ...ev(ctx) }); }),
  'update-criterion': def(withVersion({ processId: zUuid, code: z.string(), text: zLangMap }), async ctx => { const staff = await staffOnProcess(ctx, 'process.edit'); return proc.updateCriterion(staffEnv(staff), ctx.body.processId, { code: ctx.body.code, text: ctx.body.text, ...ev(ctx) }); }),
  'remove-criterion': def(withVersion({ processId: zUuid, code: z.string() }), async ctx => { const staff = await staffOnProcess(ctx, 'process.edit'); return proc.removeCriterion(staffEnv(staff), ctx.body.processId, { code: ctx.body.code, ...ev(ctx) }); }),
  'reorder-criteria': def(withVersion({ processId: zUuid, codes: z.array(z.string()) }), async ctx => { const staff = await staffOnProcess(ctx, 'process.edit'); return proc.reorderCriteria(staffEnv(staff), ctx.body.processId, { codes: ctx.body.codes, ...ev(ctx) }); }),
  'assign-assessment-method': def(withVersion({ processId: zUuid, criterionCode: z.string(), method: zMethod, rubricId: z.string().optional() }), async ctx => { const staff = await staffOnProcess(ctx, 'process.edit'); return proc.assignMethod(staffEnv(staff), ctx.body.processId, { criterionCode: ctx.body.criterionCode, method: ctx.body.method, rubricId: ctx.body.rubricId, ...ev(ctx) }); }),
  'remove-assessment-method': def(withVersion({ processId: zUuid, criterionCode: z.string(), method: zMethod }), async ctx => { const staff = await staffOnProcess(ctx, 'process.edit'); return proc.removeMethod(staffEnv(staff), ctx.body.processId, { criterionCode: ctx.body.criterionCode, method: ctx.body.method, ...ev(ctx) }); }),
  'define-rubric': def(withVersion({ processId: zUuid, rubricId: z.string().min(1).max(40), name: z.string().max(100), scale: z.object({ min: z.number().int(), max: z.number().int() }).strict(), passMark: z.number().int(), descriptors: zLangMap }), async ctx => { const staff = await staffOnProcess(ctx, 'process.edit'); const { processId, expectedVersion, ...rubric } = ctx.body; return proc.defineRubric(staffEnv(staff), processId, { ...rubric, expectedVersion: expectedVersion ?? ctx.expectedVersion }); }),
  'set-stages': def(withVersion({ processId: zUuid, stages: z.array(zStage).min(1) }), async ctx => { const staff = await staffOnProcess(ctx, 'process.edit'); return proc.setStages(staffEnv(staff), ctx.body.processId, { stages: ctx.body.stages, ...ev(ctx) }); }),
  'set-board': def(withVersion({ processId: zUuid, board: z.array(z.object({ userId: zUuid, role: z.enum(['chair', 'assessor']) }).strict()) }), async ctx => { const staff = await staffOnProcess(ctx, 'process.board'); return proc.setBoard(staffEnv(staff), ctx.body.processId, { board: ctx.body.board, ...ev(ctx) }); }),
  'declare-conflict': def(withVersion({ processId: zUuid, conflictedApplicationIds: z.array(zUuid) }), async ctx => { const staff = requireStaff(ctx.principal); return proc.declareConflict(staffEnv(staff), ctx.body.processId, { userId: staff.userId, conflictedApplicationIds: ctx.body.conflictedApplicationIds, ...ev(ctx) }); }),
  'add-knockout': def(withVersion({ processId: zUuid, question: zLangMap, expected: z.enum(['yes', 'no']) }), async ctx => { const staff = await staffOnProcess(ctx, 'process.edit'); return proc.addKnockout(staffEnv(staff), ctx.body.processId, { question: ctx.body.question, expected: ctx.body.expected, ...ev(ctx) }); }),
  'remove-knockout': def(withVersion({ processId: zUuid, code: z.string() }), async ctx => { const staff = await staffOnProcess(ctx, 'process.edit'); return proc.removeKnockout(staffEnv(staff), ctx.body.processId, { code: ctx.body.code, ...ev(ctx) }); }),
  'draft-poster': def(withVersion({ processId: zUuid, lang: zLang, body: z.string().max(50000) }), async ctx => { const staff = await staffOnProcess(ctx, 'process.edit'); return proc.draftPoster(staffEnv(staff), ctx.body.processId, { lang: ctx.body.lang, body: ctx.body.body, ...ev(ctx) }); }),
  'request-approval': def(withVersion({ processId: zUuid }), async ctx => { const staff = await staffOnProcess(ctx, 'process.edit'); return proc.requestApproval(staffEnv(staff), ctx.body.processId, { by: staff.userId, ...ev(ctx) }); }),
  'approve-process': def(withVersion({ processId: zUuid, comment: z.string().max(1000).optional() }), async ctx => { const staff = requireStaff(ctx.principal, 'process.approve'); return proc.approveProcess(staffEnv(staff), ctx.body.processId, { by: staff.userId, comment: ctx.body.comment, ...ev(ctx) }); }),
  'reject-process': def(withVersion({ processId: zUuid, reason: z.string().max(1000) }), async ctx => { const staff = requireStaff(ctx.principal, 'process.approve'); return proc.rejectProcess(staffEnv(staff), ctx.body.processId, { by: staff.userId, reason: ctx.body.reason, ...ev(ctx) }); }),
  'return-to-draft': def(withVersion({ processId: zUuid, reason: z.string().max(1000) }), async ctx => { const staff = await staffOnProcess(ctx, 'process.publish'); return proc.returnToDraft(staffEnv(staff), ctx.body.processId, { by: staff.userId, reason: ctx.body.reason, ...ev(ctx) }); }),
  'publish-posting': def(withVersion({ processId: zUuid, closeAt: z.string() }), async ctx => { const staff = await staffOnProcess(ctx, 'process.publish'); return proc.publishPosting(staffEnv(staff), ctx.body.processId, { closeAt: ctx.body.closeAt, ...ev(ctx) }); }),
  'schedule-posting': def(withVersion({ processId: zUuid, publishAt: z.string(), closeAt: z.string() }), async ctx => { const staff = await staffOnProcess(ctx, 'process.publish'); return proc.schedulePosting(staffEnv(staff), ctx.body.processId, { publishAt: ctx.body.publishAt, closeAt: ctx.body.closeAt, ...ev(ctx) }); }),
  'amend-poster': def(withVersion({ processId: zUuid, poster: zLangMap, reason: z.string().max(1000) }), async ctx => { const staff = await staffOnProcess(ctx, 'process.publish'); return proc.amendPoster(staffEnv(staff), ctx.body.processId, { poster: ctx.body.poster, reason: ctx.body.reason, ...ev(ctx) }); }),
  'extend-closing': def(withVersion({ processId: zUuid, closeAt: z.string(), reason: z.string().max(1000) }), async ctx => { const staff = await staffOnProcess(ctx, 'process.publish'); return proc.extendClosing(staffEnv(staff), ctx.body.processId, { closeAt: ctx.body.closeAt, reason: ctx.body.reason, ...ev(ctx) }); }),
  'close-early': def(withVersion({ processId: zUuid, reason: z.string().max(1000) }), async ctx => { const staff = await staffOnProcess(ctx, 'process.publish'); return proc.closeEarly(staffEnv(staff), ctx.body.processId, { reason: ctx.body.reason, ...ev(ctx) }); }),
  'cancel-process': def(withVersion({ processId: zUuid, reason: z.string().max(1000) }), async ctx => { const staff = await staffOnProcess(ctx, 'process.cancel'); return proc.cancelProcess(staffEnv(staff), ctx.body.processId, { reason: ctx.body.reason, ...ev(ctx) }); }),
  'complete-process': def(withVersion({ processId: zUuid }), async ctx => { const staff = await staffOnProcess(ctx, 'process.publish'); return proc.completeProcess(staffEnv(staff), ctx.body.processId, { ...ev(ctx) } as never); }),
  'release-screening-results': def(withVersion({ processId: zUuid }), async ctx => { const staff = await staffOnProcess(ctx, 'application.screen'); return proc.releaseScreeningResults(staffEnv(staff), ctx.body.processId, ev(ctx)); }),
  'publish-interview-slots': def(withVersion({ processId: zUuid, ranges: z.array(z.object({ start: z.string(), end: z.string(), minutes: z.number().int().min(5).max(480), bufferMinutes: z.number().int().min(0).max(120), boardUserIds: z.array(zUuid).min(1) }).strict()).min(1) }), async ctx => {
    const staff = await staffOnProcess(ctx, 'interview.schedule');
    const slots = proc.expandSlotRanges(ctx.body.ranges);
    if (!slots.length) throw new DomainError('slot_invalid', 'No slots fit the ranges', undefined, 400);
    return proc.publishInterviewSlots(staffEnv(staff), ctx.body.processId, { slots, ...ev(ctx) });
  }),

  // ---- applications: candidate ----
  'start-application': def(z.object({ processId: zUuid, source: z.object({ source: z.string().max(100), medium: z.string().max(100).optional(), campaign: z.string().max(100).optional() }).strict().optional() }).strict(), async ctx => {
    const c = requireCandidate(ctx.principal); return app.startApplication(candidateEnv(c), { processId: ctx.body.processId, candidateId: c.candidateId, locale: c.locale, source: ctx.body.source });
  }),
  'save-answers': def(z.object({ applicationId: zUuid, answers: z.record(z.string().max(20), z.string().max(4000)) }).strict(), async ctx => { const c = await candidateOwns(ctx); await app.saveAnswers(candidateEnv(c), ctx.body.applicationId, { answers: ctx.body.answers }); return { ok: true }; }),
  'remove-document': def(z.object({ applicationId: zUuid, documentId: zUuid }).strict(), async ctx => { const c = await candidateOwns(ctx); return app.removeDocument(candidateEnv(c), ctx.body.applicationId, { documentId: ctx.body.documentId }); }),
  'submit-application': def(z.object({ applicationId: zUuid, answers: z.record(z.string().max(20), z.string().max(4000)), consent: z.boolean(), website: z.string().max(200).optional() }).strict(), async ctx => {
    if (ctx.body.website) { await securityLog(null, { kind: 'honeypot', resource: 'submit_application' }); return { ok: true }; }
    const c = await candidateOwns(ctx); return app.submitApplication(candidateEnv(c, { clientHash: ctx.request.headers.get('user-agent') ? undefined : undefined }), ctx.body.applicationId, { answers: ctx.body.answers, consent: ctx.body.consent });
  }),
  'withdraw-application': def(z.object({ applicationId: zUuid, reason: z.string().max(500).optional() }).strict(), async ctx => { const c = await candidateOwns(ctx); return app.withdrawApplication(candidateEnv(c), ctx.body.applicationId, { reason: ctx.body.reason }); }),
  'record-self-declaration': def(z.object({ applicationId: zUuid, groups: z.array(z.enum(['women', 'indigenous_peoples', 'persons_with_disabilities', 'visible_minorities'])) }).strict(), async ctx => { const c = await candidateOwns(ctx); await app.recordSelfDeclaration(candidateEnv(c), ctx.body.applicationId, { groups: ctx.body.groups }); return { ok: true }; }),
  'withdraw-self-declaration': def(z.object({ applicationId: zUuid }).strict(), async ctx => { const c = await candidateOwns(ctx); await app.withdrawSelfDeclaration(candidateEnv(c), ctx.body.applicationId); return { ok: true }; }),
  'request-accommodation': def(z.object({ applicationId: zUuid, text: z.string().min(1).max(4000), contactPreference: z.enum(['email', 'phone']) }).strict(), async ctx => { const c = await candidateOwns(ctx); return app.requestAccommodation(candidateEnv(c), ctx.body.applicationId, ctx.body); }),
  'add-candidate-note': def(z.object({ applicationId: zUuid, text: z.string().min(1).max(4000) }).strict(), async ctx => { const c = await candidateOwns(ctx); return app.addNote(candidateEnv(c), ctx.body.applicationId, { text: ctx.body.text, visibility: 'candidate' }); }),
  'book-interview': def(z.object({ applicationId: zUuid, slotId: zUuid }).strict(), async ctx => { const c = await candidateOwns(ctx); return app.bookInterview(candidateEnv(c), ctx.body.applicationId, { slotId: ctx.body.slotId }); }),
  'start-exam': def(z.object({ applicationId: zUuid }).strict(), async ctx => { const c = await candidateOwns(ctx); return app.startExam(candidateEnv(c), ctx.body.applicationId); }),
  'submit-exam': def(z.object({ applicationId: zUuid, answers: z.record(z.string().max(40), z.string().max(20000)) }).strict(), async ctx => { const c = await candidateOwns(ctx); return app.submitExam(candidateEnv(c), ctx.body.applicationId, { answers: ctx.body.answers }); }),
  'accept-offer': def(z.object({ applicationId: zUuid, offerId: zUuid, typedName: z.string().min(1).max(200) }).strict(), async ctx => {
    const c = await candidateOwns(ctx);
    const { sha256 } = await import('@/lib/crypto/pii');
    const clientHash = sha256(`${ctx.ip}|${ctx.request.headers.get('user-agent') ?? ''}`);
    await app.acceptOffer(candidateEnv(c, { clientHash }), ctx.body.applicationId, { offerId: ctx.body.offerId, typedName: ctx.body.typedName, clientHash });
    return { ok: true };
  }),
  'decline-offer': def(z.object({ applicationId: zUuid, offerId: zUuid, reason: z.string().max(500).optional() }).strict(), async ctx => { const c = await candidateOwns(ctx); return app.declineOffer(candidateEnv(c), ctx.body.applicationId, { offerId: ctx.body.offerId, reason: ctx.body.reason }); }),
  'update-profile': def(z.object({ name: z.string().max(200).optional(), phone: z.string().max(40).optional() }).strict(), async ctx => { const c = requireCandidate(ctx.principal); await cand.updateProfile(candidateEnv(c), ctx.body); return { ok: true }; }),
  'change-locale': def(z.object({ locale: zLang }).strict(), async ctx => { const c = requireCandidate(ctx.principal); await cand.changeLocale(candidateEnv(c), ctx.body); return { ok: true }; }),
  'set-marketing-opt-out': def(z.object({ value: z.boolean() }).strict(), async ctx => { const c = requireCandidate(ctx.principal); await cand.setMarketingOptOut(candidateEnv(c), ctx.body); return { ok: true }; }),
  'request-email-change': def(z.object({ newEmail: z.string().email() }).strict(), async ctx => { const c = requireCandidate(ctx.principal); await cand.requestEmailChange(candidateEnv(c), ctx.body); return { ok: true }; }),
  'request-data-export': def(z.object({}).strict(), async ctx => { const c = requireCandidate(ctx.principal); return cand.requestDataExport(candidateEnv(c)); }),
  'request-deletion': def(z.object({}).strict(), async ctx => { const c = requireCandidate(ctx.principal); return cand.requestDeletion(candidateEnv(c)); }),

  // ---- applications: staff ----
  'screen-in': def(withVersion({ applicationId: zUuid, marks: zMarks }), async ctx => { const staff = await staffOnApplication(ctx, 'application.screen'); return app.screenIn(staffEnv(staff), ctx.body.applicationId, { marks: ctx.body.marks, ...ev(ctx) }); }),
  'screen-out': def(withVersion({ applicationId: zUuid, marks: zMarks, rationale: z.string().max(4000) }), async ctx => { const staff = await staffOnApplication(ctx, 'application.screen'); return app.screenOut(staffEnv(staff), ctx.body.applicationId, { marks: ctx.body.marks, rationale: ctx.body.rationale, ...ev(ctx) }); }),
  'bulk-screen-out': def(z.object({ applicationIds: z.array(zUuid).min(1).max(200), marks: zMarks, rationale: z.string().max(4000) }).strict(), async ctx => {
    const staff = requireStaff(ctx.principal, 'application.screen');
    const correlationId = randomUUID();
    const results = [];
    for (const applicationId of ctx.body.applicationIds) {
      await staffOnApplication({ ...ctx, body: { applicationId } } as never, 'application.screen');
      results.push(await app.screenOut(staffEnv(staff, { correlationId }), applicationId, { marks: ctx.body.marks, rationale: ctx.body.rationale }));
    }
    return { correlationId, results };
  }),
  'reverse-screening': def(withVersion({ applicationId: zUuid, reason: z.string().max(1000) }), async ctx => { const staff = await staffOnApplication(ctx, 'application.screen'); return app.reverseScreening(staffEnv(staff), ctx.body.applicationId, { reason: ctx.body.reason, ...ev(ctx) }); }),
  'move-to-stage': def(withVersion({ applicationId: zUuid, to: z.string(), reason: z.string().max(1000).optional() }), async ctx => { const staff = await staffOnApplication(ctx, 'application.move'); return app.moveToStage(staffEnv(staff), ctx.body.applicationId, { to: ctx.body.to, reason: ctx.body.reason, ...ev(ctx) }); }),
  'tag-application': def(withVersion({ applicationId: zUuid, tags: z.array(z.string().max(40)) }), async ctx => { const staff = await staffOnApplication(ctx, 'application.tag'); return app.tagApplication(staffEnv(staff), ctx.body.applicationId, { tags: ctx.body.tags, ...ev(ctx) }); }),
  'add-note': def(withVersion({ applicationId: zUuid, text: z.string().min(1).max(4000), visibility: z.enum(['hr_only', 'process_team']) }), async ctx => {
    const staff = await staffOnApplication(ctx, 'application.note');
    if (ctx.body.visibility === 'hr_only' && !can(staff.roles, 'note.hr_only')) throw new ForbiddenError();
    return app.addNote(staffEnv(staff), ctx.body.applicationId, { text: ctx.body.text, visibility: ctx.body.visibility, ...ev(ctx) });
  }),
  'record-score': def(withVersion({ applicationId: zUuid, criterionCode: z.string(), method: zMethod, score: z.number(), evidence: z.string().max(4000), reason: z.string().max(1000).optional() }), async ctx => { const staff = await staffOnApplication(ctx, 'score.record'); const { applicationId, ...rest } = ctx.body; return app.recordScore(staffEnv(staff), applicationId, { ...rest, ...ev(ctx) }); }),
  'submit-scores': def(withVersion({ applicationId: zUuid }), async ctx => { const staff = await staffOnApplication(ctx, 'score.record'); return app.submitScores(staffEnv(staff), ctx.body.applicationId, { ...ev(ctx) } as never); }),
  'record-consensus': def(withVersion({ applicationId: zUuid, criterionCode: z.string(), score: z.number(), note: z.string().max(2000).optional(), reason: z.string().max(1000).optional() }), async ctx => { const staff = await staffOnApplication(ctx, 'consensus.record'); const { applicationId, ...rest } = ctx.body; return app.recordConsensus(staffEnv(staff), applicationId, { ...rest, ...ev(ctx) }); }),
  'assign-exam': def(withVersion({ applicationId: zUuid, criterionCode: z.string(), windowStart: z.string(), windowEnd: z.string(), limitMinutes: z.number().int().min(1).max(600) }), async ctx => { const staff = await staffOnApplication(ctx, 'exam.administer'); const { applicationId, ...rest } = ctx.body; return app.assignExam(staffEnv(staff), applicationId, { ...rest, ...ev(ctx) }); }),
  'release-exam-late': def(withVersion({ applicationId: zUuid, reason: z.string().max(1000) }), async ctx => { const staff = await staffOnApplication(ctx, 'exam.administer'); return app.releaseExamLate(staffEnv(staff), ctx.body.applicationId, { reason: ctx.body.reason, ...ev(ctx) }); }),
  'send-interview-invitations': def(z.object({ applicationIds: z.array(zUuid).min(1).max(200) }).strict(), async ctx => {
    const staff = requireStaff(ctx.principal, 'interview.schedule');
    const results = [];
    for (const applicationId of ctx.body.applicationIds) { await staffOnApplication({ ...ctx, body: { applicationId } } as never, 'interview.schedule'); results.push(await app.sendInterviewInvitation(staffEnv(staff), applicationId, {} as never)); }
    return { results };
  }),
  'book-interview-for-candidate': def(z.object({ applicationId: zUuid, slotId: zUuid, reason: z.string().max(500) }).strict(), async ctx => { const staff = await staffOnApplication(ctx, 'interview.schedule'); return app.bookInterview(staffEnv(staff), ctx.body.applicationId, { slotId: ctx.body.slotId, reason: ctx.body.reason }); }),
  'cancel-interview': def(z.object({ applicationId: zUuid, reason: z.string().max(500) }).strict(), async ctx => { const staff = await staffOnApplication(ctx, 'interview.schedule'); await app.cancelInterview(staffEnv(staff), ctx.body.applicationId, { reason: ctx.body.reason }); return { ok: true }; }),
  'record-interview-notes': def(withVersion({ applicationId: zUuid, criterionCode: z.string().optional(), notes: z.string().min(1).max(8000) }), async ctx => { const staff = await staffOnApplication(ctx, 'interview.notes'); return app.recordInterviewNotes(staffEnv(staff), ctx.body.applicationId, { criterionCode: ctx.body.criterionCode, notes: ctx.body.notes, ...ev(ctx) }); }),
  'arrange-accommodation': def(z.object({ applicationId: zUuid, requestId: zUuid, summary: z.string().min(1).max(2000), examTimeMultiplier: z.number().min(1).max(5).optional() }).strict(), async ctx => { const staff = requireStaff(ctx.principal, 'accommodation.view'); await app.arrangeAccommodation(staffEnv(staff), ctx.body.applicationId, ctx.body); return { ok: true }; }),
  'draft-offer': def(z.object({ applicationId: zUuid, position: z.string().min(1).max(200), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), salary: z.string().max(60), templateId: z.string().max(60).optional(), letter: z.string().max(20000).optional() }).strict(), async ctx => { const staff = await staffOnApplication(ctx, 'offer.draft'); const { applicationId, ...rest } = ctx.body; return app.draftOffer(staffEnv(staff), applicationId, rest); }),
  'request-offer-approval': def(withVersion({ applicationId: zUuid, offerId: zUuid }), async ctx => { const staff = await staffOnApplication(ctx, 'offer.draft'); return app.requestOfferApproval(staffEnv(staff), ctx.body.applicationId, { offerId: ctx.body.offerId, ...ev(ctx) }); }),
  'approve-offer': def(withVersion({ applicationId: zUuid, offerId: zUuid, comment: z.string().max(1000).optional() }), async ctx => { const staff = requireStaff(ctx.principal, 'offer.approve'); return app.approveOffer(staffEnv(staff), ctx.body.applicationId, { offerId: ctx.body.offerId, comment: ctx.body.comment, ...ev(ctx) }); }),
  'reject-offer': def(withVersion({ applicationId: zUuid, offerId: zUuid, reason: z.string().max(1000) }), async ctx => { const staff = requireStaff(ctx.principal, 'offer.approve'); return app.rejectOffer(staffEnv(staff), ctx.body.applicationId, { offerId: ctx.body.offerId, reason: ctx.body.reason, ...ev(ctx) }); }),
  'send-offer': def(withVersion({ applicationId: zUuid, offerId: zUuid, expiresAt: z.string() }), async ctx => { const staff = await staffOnApplication(ctx, 'offer.send'); return app.sendOffer(staffEnv(staff), ctx.body.applicationId, { offerId: ctx.body.offerId, expiresAt: ctx.body.expiresAt, ...ev(ctx) }); }),
  'rescind-offer': def(withVersion({ applicationId: zUuid, offerId: zUuid, reason: z.string().max(1000) }), async ctx => { const staff = await staffOnApplication(ctx, 'offer.send'); return app.rescindOffer(staffEnv(staff), ctx.body.applicationId, { offerId: ctx.body.offerId, reason: ctx.body.reason, ...ev(ctx) }); }),

  // ---- processor (API key) ----
  'record-document-scanned': def(z.object({ tenantId: zUuid, applicationId: zUuid, documentId: zUuid, result: z.enum(['clean', 'infected', 'error']) }).strict(), async ctx => {
    requireApi(ctx.principal); return app.recordScan({ tenantId: ctx.body.tenantId, actor: { type: 'system', id: 'scanner' } }, ctx.body.applicationId, { documentId: ctx.body.documentId, result: ctx.body.result });
  }, false),
  'record-notification-sent': def(z.object({ tenantId: zUuid, notificationId: zUuid, providerMessageId: z.string().max(200).optional() }).strict(), async ctx => { requireApi(ctx.principal); await notif.recordSent(ctx.body); return { ok: true }; }, false),
  'record-notification-failed': def(z.object({ tenantId: zUuid, notificationId: zUuid, error: z.string().max(500) }).strict(), async ctx => { requireApi(ctx.principal); return notif.recordFailed(ctx.body); }, false),
  'record-notification-bounced': def(z.object({ tenantId: zUuid, notificationId: zUuid, type: z.enum(['hard', 'soft']) }).strict(), async ctx => { requireApi(ctx.principal); await notif.recordBounce(ctx.body); return { ok: true }; }, false)
};

export function candidateCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${CANDIDATE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${24 * 3600}${secure}`;
}

export function json(body: unknown, status = 200): NextResponse { return NextResponse.json(body, { status }); }
export { withPlatform, processAccess };
