import { randomUUID } from 'crypto';
import { executeCommand, CommandEnv, Appender } from './execute';
import { buildProcessContext, loadApplication, loadOrganization, loadProcess } from '@/lib/app/context';
import { streamIds } from '@/types/events';
import { AssessmentMethod, Locale } from '@/types/shared';
import {
  decideStartApplication, decideSaveAnswers, decideAttachDocument, decideRecordScan, decideRemoveDocument, decideRecordConsent, decideSubmit, decideWithdraw,
  decideScreenIn, decideScreenOut, decideReverseScreening, decideMoveToStage, decideTag, decideAddNote, decideRecordScore, decideSubmitScores, decideRecordConsensus,
  decideAssignExam, decideStartExam, decideSubmitExam, decideReleaseExamLate, decideSendInterviewInvitation, decideBookInterview, decideCancelInterview,
  decideRecordInterviewNotes, decideDraftOffer, decideRequestOfferApproval, decideApproveOffer, decideRejectOffer, decideSendOffer, decideAcceptOffer, decideDeclineOffer,
  decideRescindOffer, ApplicationState, PlainAnswers, ProcessContext, currentOffer
} from '@/lib/domain/application';
import { decideBookSlot, decideReleaseSlot } from '@/lib/domain/hiring-process';
import { DomainError, ConcurrencyError } from '@/lib/domain/errors';
import { candidateKeyId, selfDeclarationKeyId, accommodationKeyId, encryptField, decryptField, sha256 } from '@/lib/crypto/pii';
import { now, zonedTimeToUtc } from '@/lib/clock';
import { Tx } from '@/lib/db/pool';
import { Expected } from './process';
import { loadStream } from '@/lib/db/event-store';
import { toReplay } from '@/lib/app/context';

interface Loaded { app: ApplicationState; version: number; ctx: ProcessContext; timeZone: string; processVersion: number; }

async function load(tx: Tx, tenantId: string, applicationId: string): Promise<Loaded> {
  const { state: app, version } = await loadApplication(tx, tenantId, applicationId);
  const org = await loadOrganization(tx, tenantId);
  const { state: process, version: processVersion } = await loadProcess(tx, tenantId, app.processId);
  return { app, version, ctx: buildProcessContext(process, org), timeZone: org.timeZone, processVersion };
}

function expected(version: number, e?: Expected): number {
  if (e?.expectedVersion !== undefined && e.expectedVersion !== version) throw new ConcurrencyError(version);
  return version;
}

function simple<TCmd>(decide: (l: Loaded, cmd: TCmd, env: CommandEnv) => ReturnType<typeof decideTag>) {
  return async (env: CommandEnv, applicationId: string, cmd: TCmd & Expected): Promise<{ version: number }> => {
    return executeCommand(env, async (tx, append) => {
      const l = await load(tx, env.tenantId, applicationId);
      const stored = await append(streamIds.application(applicationId), expected(l.version, cmd), decide(l, cmd, env));
      return { version: stored.length ? stored[stored.length - 1].streamVersion : l.version };
    });
  };
}

// ---- Candidate side ----

// One application per candidate per process (invariant 4): returns the
// existing one instead of creating a second.
export async function startApplication(env: CommandEnv, cmd: { processId: string; candidateId: string; locale: Locale; source?: { source: string; medium?: string; campaign?: string } }): Promise<{ applicationId: string; existing: boolean }> {
  return executeCommand(env, async (tx, append) => {
    const { rows } = await tx.query('select id from application_summary where tenant_id = $1 and process_id = $2 and candidate_id = $3', [env.tenantId, cmd.processId, cmd.candidateId]);
    if (rows[0]) return { applicationId: rows[0].id, existing: true };
    const org = await loadOrganization(tx, env.tenantId);
    const { state: process } = await loadProcess(tx, env.tenantId, cmd.processId);
    const applicationId = randomUUID();
    await append(streamIds.application(applicationId), 'none', decideStartApplication({ exists: false } as ApplicationState, { applicationId, candidateId: cmd.candidateId, locale: cmd.locale, now: now(), source: cmd.source }, buildProcessContext(process, org)));
    return { applicationId, existing: false };
  });
}

export async function saveAnswers(env: CommandEnv, applicationId: string, cmd: { answers: PlainAnswers }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const l = await load(tx, env.tenantId, applicationId);
    const encrypted = await encryptField(tx, env.tenantId, candidateKeyId(l.app.candidateId), cmd.answers);
    const answerKeys = Object.keys(cmd.answers).filter(k => (cmd.answers[k] ?? '').trim());
    await append(streamIds.application(applicationId), l.version, decideSaveAnswers(l.app, { answers: encrypted, answerKeys, now: now() }, l.ctx));
  });
}

const ALLOWED_MIME: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx']
};
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Content sniffing (F07): the bytes must match the declared type
export function sniffType(buffer: Buffer): 'pdf' | 'docx' | 'doc' | 'unknown' {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return 'docx';
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) return 'doc';
  return 'unknown';
}

export async function attachDocument(env: CommandEnv, applicationId: string, cmd: { filename: string; mime: string; content: Buffer; kind?: string }): Promise<{ documentId: string }> {
  const ext = cmd.filename.toLowerCase().split('.').pop() ?? '';
  const allowedExts = ALLOWED_MIME[cmd.mime];
  if (!allowedExts || !allowedExts.includes(ext)) throw new DomainError('file_type_not_allowed', 'Only PDF and Word documents are accepted', undefined, 400);
  if (cmd.content.length > MAX_UPLOAD_BYTES) throw new DomainError('file_too_large', 'Files must be 10 MB or smaller', undefined, 400);
  if (cmd.content.length === 0) throw new DomainError('file_empty', undefined, undefined, 400);
  const sniffed = sniffType(cmd.content);
  if (sniffed === 'unknown' || !allowedExts.includes(sniffed)) throw new DomainError('file_content_mismatch', 'The file content does not match its type', undefined, 400);
  return executeCommand(env, async (tx, append) => {
    const l = await load(tx, env.tenantId, applicationId);
    const documentId = randomUUID();
    const keyId = candidateKeyId(l.app.candidateId);
    const filenameEnc = await encryptField(tx, env.tenantId, keyId, cmd.filename);
    const hash = sha256(cmd.content);
    await append(streamIds.application(applicationId), l.version, decideAttachDocument(l.app, { documentId, kind: cmd.kind ?? 'resume', filename: filenameEnc, size: cmd.content.length, sha256: hash, mime: cmd.mime, now: now() }, l.ctx));
    await tx.query(
      'insert into documents (id, tenant_id, application_id, candidate_id, kind, filename_enc, key_id, mime, size, sha256, content, scan_status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
      [documentId, env.tenantId, applicationId, l.app.candidateId, cmd.kind ?? 'resume', JSON.stringify(filenameEnc), keyId, cmd.mime, cmd.content.length, hash, cmd.content, 'PendingScan', now()]
    );
    return { documentId };
  });
}

export const removeDocument = simple<{ documentId: string }>((l, cmd) => decideRemoveDocument(l.app, cmd));
export const recordScan = simple<{ documentId: string; result: 'clean' | 'infected' | 'error' }>((l, cmd) => decideRecordScan(l.app, cmd));
export const recordConsent = simple<{ noticeVersion: number }>((l, cmd) => decideRecordConsent(l.app, cmd));

export async function submitApplication(env: CommandEnv, applicationId: string, cmd: { answers: PlainAnswers; consent: boolean }): Promise<{ version: number; screenedOut: boolean }> {
  return executeCommand(env, async (tx, append) => {
    const l = await load(tx, env.tenantId, applicationId);
    const encrypted = await encryptField(tx, env.tenantId, candidateKeyId(l.app.candidateId), cmd.answers);
    const events = decideSubmit(l.app, { now: now(), plainAnswers: cmd.answers, encryptedAnswers: encrypted, consent: cmd.consent }, l.ctx);
    await append(streamIds.application(applicationId), l.version, events);
    return { version: events.find(e => e.type === 'ApplicationSubmitted' || e.type === 'ApplicationResubmitted')?.payload.version as number, screenedOut: events.some(e => e.type === 'ApplicationScreenedOut') };
  });
}

export const withdrawApplication = simple<{ reason?: string }>((l, cmd) => decideWithdraw(l.app, cmd));

export async function recordSelfDeclaration(env: CommandEnv, applicationId: string, cmd: { groups: string[] }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const l = await load(tx, env.tenantId, applicationId);
    if (l.app.candidateId !== env.actor.id) throw new DomainError('application_not_found', 'Application not found', undefined, 404);
    const streamId = streamIds.selfDeclaration(applicationId);
    const events = await loadStream(tx, env.tenantId, streamId);
    const groups = await encryptField(tx, env.tenantId, selfDeclarationKeyId(applicationId), cmd.groups);
    await append(streamId, events.length, [{ type: 'SelfDeclarationRecorded', payload: { groups, processId: l.app.processId } }]);
  });
}

export async function withdrawSelfDeclaration(env: CommandEnv, applicationId: string): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const l = await load(tx, env.tenantId, applicationId);
    if (l.app.candidateId !== env.actor.id) throw new DomainError('application_not_found', 'Application not found', undefined, 404);
    const streamId = streamIds.selfDeclaration(applicationId);
    const events = await loadStream(tx, env.tenantId, streamId);
    if (!events.length) throw new DomainError('no_self_declaration', undefined, undefined, 404);
    await append(streamId, events.length, [{ type: 'SelfDeclarationWithdrawn', payload: { processId: l.app.processId } }]);
  });
}

export async function requestAccommodation(env: CommandEnv, applicationId: string, cmd: { text: string; contactPreference: 'email' | 'phone' }): Promise<{ requestId: string }> {
  return executeCommand(env, async (tx, append) => {
    const l = await load(tx, env.tenantId, applicationId);
    if (l.app.candidateId !== env.actor.id) throw new DomainError('application_not_found', 'Application not found', undefined, 404);
    if (!cmd.text.trim()) throw new DomainError('text_required', undefined, undefined, 400);
    const streamId = streamIds.accommodation(applicationId);
    const events = await loadStream(tx, env.tenantId, streamId);
    const requestId = randomUUID();
    const text = await encryptField(tx, env.tenantId, accommodationKeyId(applicationId), cmd.text.trim());
    await append(streamId, events.length, [{ type: 'AccommodationRequested', payload: { requestId, text, contactPreference: cmd.contactPreference, stage: l.app.stage ?? null, processId: l.app.processId } }]);
    return { requestId };
  });
}

export async function arrangeAccommodation(env: CommandEnv, applicationId: string, cmd: { requestId: string; summary: string; examTimeMultiplier?: number }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const streamId = streamIds.accommodation(applicationId);
    const events = await loadStream(tx, env.tenantId, streamId);
    if (!events.some(e => (e.payload as { requestId?: string }).requestId === cmd.requestId)) throw new DomainError('request_not_found', undefined, undefined, 404);
    if (!cmd.summary.trim()) throw new DomainError('text_required', undefined, undefined, 400);
    await append(streamId, events.length, [{ type: 'AccommodationArranged', payload: { requestId: cmd.requestId, summary: cmd.summary.trim(), adjustments: cmd.examTimeMultiplier ? { examTimeMultiplier: cmd.examTimeMultiplier } : {} } }]);
  });
}

async function examTimeMultiplier(tx: Tx, tenantId: string, applicationId: string): Promise<number> {
  const { rows } = await tx.query('select arrangement from accommodations where tenant_id = $1 and application_id = $2 and arrangement is not null order by updated_at desc', [tenantId, applicationId]);
  for (const r of rows) {
    const m = r.arrangement?.adjustments?.examTimeMultiplier;
    if (typeof m === 'number' && m > 0) return m;
  }
  return 1;
}

// ---- Staff side ----

export const screenIn = simple<{ marks: Record<string, 'met' | 'not_met'> }>((l, cmd) => decideScreenIn(l.app, cmd, l.ctx));
export const screenOut = simple<{ marks: Record<string, 'met' | 'not_met'>; rationale: string }>((l, cmd) => decideScreenOut(l.app, cmd, l.ctx));
export const reverseScreening = simple<{ reason: string }>((l, cmd) => decideReverseScreening(l.app, cmd));
export const moveToStage = simple<{ to: string; reason?: string }>((l, cmd) => decideMoveToStage(l.app, cmd, l.ctx));
export const tagApplication = simple<{ tags: string[] }>((l, cmd) => decideTag(l.app, cmd));
export const addNote = simple<{ text: string; visibility: 'hr_only' | 'process_team' | 'candidate' }>((l, cmd) => decideAddNote(l.app, { noteId: randomUUID(), ...cmd }));
export const recordScore = simple<{ criterionCode: string; method: AssessmentMethod; score: number; evidence: string; reason?: string }>((l, cmd, env) => decideRecordScore(l.app, { assessorId: env.actor.id, ...cmd }, l.ctx));
export const submitScores = simple<Record<string, never>>((l, _cmd, env) => decideSubmitScores(l.app, { assessorId: env.actor.id }, l.ctx));
export const recordConsensus = simple<{ criterionCode: string; score: number; note?: string; reason?: string }>((l, cmd, env) => decideRecordConsensus(l.app, { by: env.actor.id, ...cmd }, l.ctx));
export const assignExam = simple<{ criterionCode: string; windowStart: string; windowEnd: string; limitMinutes: number }>((l, cmd) => decideAssignExam(l.app, { ...cmd, windowStart: toIso(cmd.windowStart, l.timeZone), windowEnd: toIso(cmd.windowEnd, l.timeZone) }, l.ctx));
export const releaseExamLate = simple<{ reason: string }>((l, cmd) => decideReleaseExamLate(l.app, cmd));
export const sendInterviewInvitation = simple<Record<string, never>>((l) => decideSendInterviewInvitation(l.app));
export const recordInterviewNotes = simple<{ criterionCode?: string; notes: string }>((l, cmd, env) => decideRecordInterviewNotes(l.app, { assessorId: env.actor.id, ...cmd }, l.ctx));
export const requestOfferApproval = simple<{ offerId: string }>((l, cmd, env) => decideRequestOfferApproval(l.app, { offerId: cmd.offerId, by: env.actor.id }));
export const approveOffer = simple<{ offerId: string; comment?: string }>((l, cmd, env) => decideApproveOffer(l.app, { offerId: cmd.offerId, by: env.actor.id, comment: cmd.comment }));
export const rejectOffer = simple<{ offerId: string; reason: string }>((l, cmd, env) => decideRejectOffer(l.app, { offerId: cmd.offerId, by: env.actor.id, reason: cmd.reason }));
export const sendOffer = simple<{ offerId: string; expiresAt: string }>((l, cmd) => decideSendOffer(l.app, { offerId: cmd.offerId, expiresAt: toIso(cmd.expiresAt, l.timeZone), now: now() }, l.ctx));
export const declineOffer = simple<{ offerId: string; reason?: string }>((l, cmd) => decideDeclineOffer(l.app, cmd));
export const rescindOffer = simple<{ offerId: string; reason: string }>((l, cmd) => decideRescindOffer(l.app, cmd));

function toIso(value: string, timeZone: string): string {
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) return new Date(value).toISOString();
  return zonedTimeToUtc(value, timeZone).toISOString();
}

export async function startExam(env: CommandEnv, applicationId: string): Promise<{ deadline?: string }> {
  return executeCommand(env, async (tx, append) => {
    const l = await load(tx, env.tenantId, applicationId);
    const multiplier = await examTimeMultiplier(tx, env.tenantId, applicationId);
    const events = decideStartExam(l.app, { now: now(), timeMultiplier: multiplier });
    await append(streamIds.application(applicationId), l.version, events);
    return { deadline: (events[0]?.payload.deadline as string) ?? l.app.exam?.deadline };
  });
}

export async function submitExam(env: CommandEnv, applicationId: string, cmd: { answers: Record<string, string> }): Promise<{ late: boolean }> {
  return executeCommand(env, async (tx, append) => {
    const l = await load(tx, env.tenantId, applicationId);
    const answers = await encryptField(tx, env.tenantId, candidateKeyId(l.app.candidateId), cmd.answers);
    const events = decideSubmitExam(l.app, { now: now(), answers });
    await append(streamIds.application(applicationId), l.version, events);
    return { late: !!events[0].payload.late };
  });
}

// Booking touches two streams in one transaction: the process (slot
// availability, race-safe through its stream version) and the application.
export async function bookInterview(env: CommandEnv, applicationId: string, cmd: { slotId: string; reason?: string }): Promise<{ at: string }> {
  return executeCommand(env, async (tx, append) => {
    const l = await load(tx, env.tenantId, applicationId);
    const byStaff = env.actor.type === 'staff';
    const appEvents = decideBookInterview(l.app, { slotId: cmd.slotId, now: now(), byStaff, reason: cmd.reason }, l.ctx);
    const { state: process, version: pv } = await loadProcess(tx, env.tenantId, l.app.processId);
    const previous = appEvents[0].type === 'InterviewRescheduled' ? (appEvents[0].payload.previousSlotId as string) : undefined;
    await append(streamIds.process(l.app.processId), pv, decideBookSlot(process, { slotId: cmd.slotId, applicationId, previousSlotId: previous }));
    await append(streamIds.application(applicationId), l.version, appEvents);
    return { at: (appEvents[0].payload.at ?? appEvents[0].payload.to) as string };
  });
}

export async function cancelInterview(env: CommandEnv, applicationId: string, cmd: { reason: string }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const l = await load(tx, env.tenantId, applicationId);
    const events = decideCancelInterview(l.app, cmd);
    const { state: process, version: pv } = await loadProcess(tx, env.tenantId, l.app.processId);
    await append(streamIds.process(l.app.processId), pv, decideReleaseSlot(process, { slotId: l.app.interview!.slotId }));
    await append(streamIds.application(applicationId), l.version, events);
  });
}

export async function draftOffer(env: CommandEnv, applicationId: string, cmd: { position: string; startDate: string; salary: string; templateId?: string; letter?: string }): Promise<{ offerId: string }> {
  return executeCommand(env, async (tx, append) => {
    const l = await load(tx, env.tenantId, applicationId);
    const offerId = randomUUID();
    const fields = await encryptField(tx, env.tenantId, candidateKeyId(l.app.candidateId), { position: cmd.position, startDate: cmd.startDate, salary: cmd.salary, letter: cmd.letter ?? '' });
    await append(streamIds.application(applicationId), l.version, decideDraftOffer(l.app, { offerId, templateId: cmd.templateId, fields, startDate: cmd.startDate }));
    return { offerId };
  });
}

export async function acceptOffer(env: CommandEnv, applicationId: string, cmd: { offerId: string; typedName: string; clientHash: string }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const l = await load(tx, env.tenantId, applicationId);
    if (l.app.candidateId !== env.actor.id) throw new DomainError('application_not_found', 'Application not found', undefined, 404);
    if (!cmd.typedName.trim()) throw new DomainError('typed_name_required', 'Type your full name to accept', undefined, 400);
    const typedName = await encryptField(tx, env.tenantId, candidateKeyId(l.app.candidateId), cmd.typedName.trim());
    await append(streamIds.application(applicationId), l.version, decideAcceptOffer(l.app, { offerId: cmd.offerId, typedName, clientHash: cmd.clientHash, now: now() }));
  });
}

export async function expireDueOffers(tx: Tx, append: Appender, tenantId: string): Promise<number> {
  const at = now();
  const { rows } = await tx.query("select id from application_summary where tenant_id = $1 and offer->>'status' = 'Sent' and (offer->>'expiresAt')::timestamptz < $2", [tenantId, at]);
  let n = 0;
  for (const r of rows) {
    const { state, version } = await loadApplication(tx, tenantId, r.id);
    const offer = currentOffer(state);
    const events = decideExpireOfferSafe(state, at, offer?.offerId);
    if (events.length) { await append(streamIds.application(r.id), version, events); n++; }
  }
  return n;
}

function decideExpireOfferSafe(state: ApplicationState, at: Date, offerId?: string) {
  if (!offerId) return [];
  const offer = currentOffer(state);
  if (!offer || offer.status !== 'Sent' || at.getTime() <= new Date(offer.expiresAt!).getTime()) return [];
  return [{ type: 'OfferExpired', payload: { offerId: offer.offerId }, causationId: 'OfferSent' }];
}

export async function decryptedAnswers(tx: Tx, tenantId: string, app: ApplicationState): Promise<PlainAnswers> {
  return (await decryptField<PlainAnswers>(tx, tenantId, app.answers as never)) ?? {};
}
