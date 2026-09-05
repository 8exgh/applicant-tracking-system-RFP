import { DomainError, ForbiddenError } from './errors';
import { ReplayEvent, DecidedEvent } from '@/types/events';
import { Actor } from '@/lib/db/event-store';
import {
  ApplicationStatus, AssessmentMethod, BoardMember, Criterion, InterviewSlot, Knockout, Locale, OfferStatus, PlanEntry,
  ProcessStatus, Rubric, ScanStatus, Stage, SCORED_METHODS
} from '@/types/shared';
import { requireReason } from './hiring-process';

// What the application decider needs to know about its process and organization
export interface ProcessContext {
  processId: string;
  status: ProcessStatus;
  closeAt?: string;
  criteria: Criterion[];
  plan: PlanEntry[];
  rubrics: Rubric[];
  stages: Stage[];
  board: BoardMember[];
  conflicts: Record<string, string[]>;
  knockouts: Knockout[];
  screeningOpen: boolean;
  slots: InterviewSlot[];
  privacyNoticeVersion: number;
  offerApprovalRequired: boolean;
  rescheduleCutoffHours: number;
  disagreementThreshold: number;
}

export interface Score { score: number; evidence: string; method: AssessmentMethod; at: string; amendments: Array<{ previous: number; reason: string; at: string }>; }
export interface Consensus { criterionCode: string; score: number; pass: boolean; note?: string; supersedes?: number; at: string; by?: string; originalScores: Record<string, number>; }
export interface DocumentRef { documentId: string; kind: string; filename: unknown; size: number; sha256: string; mime: string; scanStatus: ScanStatus; removed: boolean; }
export interface Offer {
  offerId: string; status: OfferStatus; templateId?: string; fields: unknown; draftedBy: string; requestedBy?: string; approvedBy?: string;
  expiresAt?: string; sentAt?: string; acceptedAt?: string; typedName?: unknown; clientHash?: string; declineReason?: string; rescindReason?: string; startDate?: string;
}
export interface Exam { criterionCode: string; windowStart: string; windowEnd: string; limitMinutes: number; startedAt?: string; deadline?: string; submittedAt?: string; late?: boolean; released?: boolean; answers?: unknown; }
export interface Interview { slotId: string; at: string; status: 'booked' | 'cancelled'; bookedBy: string; history: Array<{ from?: string; to: string; at: string; reason?: string }>; }

export interface ApplicationState {
  exists: boolean;
  id: string;
  processId: string;
  candidateId: string;
  locale: Locale;
  status: ApplicationStatus;
  stage?: string;
  stageEnteredAt?: string;
  version: number;
  answers: unknown;                 // ciphertext envelope while stored; decrypted by queries
  answerKeys: string[];             // which questions have answers (not the content)
  documents: DocumentRef[];
  consentNoticeVersion?: number;
  source?: { source: string; medium?: string; campaign?: string };
  screening?: { result: 'in' | 'out'; marks: Record<string, string>; rationale?: string; automatic: boolean; knockoutCode?: string; at: string; by?: string };
  screeningHistory: Array<Record<string, unknown>>;
  scores: Record<string, Record<string, Score>>;   // assessorId -> criterionCode -> score
  submittedAssessors: string[];
  consensus: Record<string, Consensus[]>;          // criterionCode -> history (last = current)
  disagreements: string[];
  qualified: boolean | null;
  failedCriteria: string[];
  tags: string[];
  notes: Array<{ noteId: string; text: string; visibility: string; by: string; at: string }>;
  exam?: Exam;
  interview?: Interview;
  invitationSent: boolean;
  offers: Offer[];
  hiredAt?: string;
  withdrawnAt?: string;
  submittedAt?: string;
  submissions: Array<{ version: number; at: string; answers: unknown }>;
  startedAt?: string;
  streamVersion: number;
}

export function initialApplicationState(): ApplicationState {
  return {
    exists: false, id: '', processId: '', candidateId: '', locale: 'en', status: 'Draft', version: 0, answers: null, answerKeys: [],
    documents: [], screeningHistory: [], scores: {}, submittedAssessors: [], consensus: {}, disagreements: [], qualified: null,
    failedCriteria: [], tags: [], notes: [], invitationSent: false, offers: [], submissions: [], streamVersion: 0
  };
}

export function currentOffer(state: ApplicationState): Offer | undefined {
  return state.offers[state.offers.length - 1];
}

export function currentConsensus(state: ApplicationState, criterionCode: string): Consensus | undefined {
  const list = state.consensus[criterionCode];
  return list?.[list.length - 1];
}

export function evolveApplication(state: ApplicationState, event: ReplayEvent): ApplicationState {
  const p = event.payload as Record<string, any>;
  const at = event.occurredAt.toISOString();
  const s: ApplicationState = { ...state, streamVersion: state.streamVersion + 1 };
  const updateOffer = (fn: (o: Offer) => Offer): ApplicationState => {
    const offers = [...s.offers];
    const last = offers.length - 1;
    if (last >= 0) offers[last] = fn(offers[last]);
    return { ...s, offers };
  };
  switch (event.type) {
    case 'ApplicationStarted':
      return { ...s, exists: true, id: p.applicationId, processId: p.processId, candidateId: p.candidateId, locale: p.locale ?? 'en', status: 'Draft', startedAt: at };
    case 'ApplicationSourceAttributed':
      return { ...s, source: { source: p.source, medium: p.medium, campaign: p.campaign } };
    case 'ApplicationAnswersSaved':
      return { ...s, answers: p.answers, answerKeys: p.answerKeys ?? s.answerKeys };
    case 'DocumentAttached':
      return { ...s, documents: [...s.documents, { documentId: p.documentId, kind: p.kind, filename: p.filename, size: p.size, sha256: p.sha256, mime: p.mime, scanStatus: 'PendingScan', removed: false }] };
    case 'DocumentScanned':
      return { ...s, documents: s.documents.map(d => d.documentId === p.documentId ? { ...d, scanStatus: p.result === 'clean' ? 'Available' : 'Quarantined' } : d) };
    case 'DocumentQuarantined':
      return { ...s, documents: s.documents.map(d => d.documentId === p.documentId ? { ...d, scanStatus: 'Quarantined' } : d) };
    case 'DocumentRemoved':
      return { ...s, documents: s.documents.map(d => d.documentId === p.documentId ? { ...d, removed: true } : d) };
    case 'ConsentRecorded':
      return { ...s, consentNoticeVersion: p.noticeVersion };
    case 'ApplicationSubmitted':
      return { ...s, status: 'Submitted', version: p.version, stage: p.stage ?? 'applied', stageEnteredAt: at, submittedAt: at, answers: p.answers ?? s.answers, submissions: [...s.submissions, { version: p.version, at, answers: p.answers ?? s.answers }] };
    case 'ApplicationResubmitted':
      return { ...s, version: p.version, answers: p.answers ?? s.answers, submissions: [...s.submissions, { version: p.version, at, answers: p.answers ?? s.answers }] };
    case 'ApplicationWithdrawn':
      return { ...s, status: 'Withdrawn', withdrawnAt: at };
    case 'ApplicationScreenedIn':
      return { ...s, status: 'Active', stage: p.stage, stageEnteredAt: at, screening: { result: 'in', marks: p.marks, automatic: false, at, by: event.actor?.id }, screeningHistory: [...s.screeningHistory, { result: 'in', marks: p.marks, at, by: event.actor?.id }] };
    case 'ApplicationScreenedOut':
      return { ...s, status: 'ScreenedOut', screening: { result: 'out', marks: p.marks, rationale: p.rationale, automatic: !!p.automatic, knockoutCode: p.knockoutCode, at, by: event.actor?.id }, screeningHistory: [...s.screeningHistory, { result: 'out', marks: p.marks, rationale: p.rationale, automatic: !!p.automatic, knockoutCode: p.knockoutCode, at, by: event.actor?.id }] };
    case 'ScreeningReversed':
      return { ...s, status: 'Submitted', stage: 'applied', stageEnteredAt: at, screening: undefined, screeningHistory: [...s.screeningHistory, { result: 'reversed', reason: p.reason, at, by: event.actor?.id }] };
    case 'ApplicationMovedToStage':
      return { ...s, stage: p.to, stageEnteredAt: at };
    case 'ApplicationTagged':
      return { ...s, tags: p.tags };
    case 'NoteAdded':
      return { ...s, notes: [...s.notes, { noteId: p.noteId, text: p.text, visibility: p.visibility, by: event.actor?.id ?? '', at }] };
    case 'ScoreRecorded': {
      const mine = { ...(s.scores[p.assessorId] ?? {}) };
      mine[p.criterionCode] = { score: p.score, evidence: p.evidence, method: p.method, at, amendments: [] };
      return { ...s, scores: { ...s.scores, [p.assessorId]: mine } };
    }
    case 'ScoreAmended': {
      const mine = { ...(s.scores[p.assessorId] ?? {}) };
      const prev = mine[p.criterionCode];
      mine[p.criterionCode] = { score: p.score, evidence: p.evidence ?? prev?.evidence ?? '', method: p.method ?? prev?.method, at, amendments: [...(prev?.amendments ?? []), { previous: prev?.score, reason: p.reason, at }] };
      return { ...s, scores: { ...s.scores, [p.assessorId]: mine } };
    }
    case 'ScoresSubmitted':
      return { ...s, submittedAssessors: Array.from(new Set([...s.submittedAssessors, p.assessorId])) };
    case 'DisagreementFlagged':
      return { ...s, disagreements: Array.from(new Set([...s.disagreements, p.criterionCode])) };
    case 'ConsensusRecorded': {
      const list = [...(s.consensus[p.criterionCode] ?? []), { criterionCode: p.criterionCode, score: p.score, pass: !!p.pass, note: p.note, supersedes: p.supersedes, at, by: event.actor?.id, originalScores: p.originalScores ?? {} }];
      return { ...s, consensus: { ...s.consensus, [p.criterionCode]: list } };
    }
    case 'CandidateQualified':
      return { ...s, qualified: true, failedCriteria: [] };
    case 'CandidateNotQualified':
      return { ...s, qualified: false, failedCriteria: p.failedCriteria ?? [], status: s.status === 'Active' ? 'NotQualified' : s.status };
    case 'ExamAssigned':
      return { ...s, exam: { criterionCode: p.criterionCode, windowStart: p.windowStart, windowEnd: p.windowEnd, limitMinutes: p.limitMinutes } };
    case 'ExamStarted':
      return { ...s, exam: s.exam ? { ...s.exam, startedAt: at, deadline: p.deadline } : s.exam };
    case 'ExamSubmitted':
      return { ...s, exam: s.exam ? { ...s.exam, submittedAt: at, late: !!p.late, released: !p.late, answers: p.answers } : s.exam };
    case 'ExamReleasedLate':
      return { ...s, exam: s.exam ? { ...s.exam, released: true } : s.exam };
    case 'InterviewInvitationSent':
      return { ...s, invitationSent: true };
    case 'InterviewBooked':
      return { ...s, interview: { slotId: p.slotId, at: p.at, status: 'booked', bookedBy: event.actor?.id ?? '', history: [{ to: p.at, at, reason: p.reason }] } };
    case 'InterviewRescheduled':
      return { ...s, interview: { slotId: p.slotId, at: p.to, status: 'booked', bookedBy: event.actor?.id ?? '', history: [...(s.interview?.history ?? []), { from: p.from, to: p.to, at, reason: p.reason }] } };
    case 'InterviewCancelled':
      return { ...s, interview: s.interview ? { ...s.interview, status: 'cancelled' } : undefined };
    case 'OfferDrafted':
      return { ...s, offers: [...s.offers, { offerId: p.offerId, status: 'Draft', templateId: p.templateId, fields: p.fields, draftedBy: event.actor?.id ?? '', startDate: p.startDate }] };
    case 'OfferApprovalRequested':
      return updateOffer(o => ({ ...o, status: 'PendingApproval', requestedBy: p.by }));
    case 'OfferApproved':
      return updateOffer(o => ({ ...o, status: 'Approved', approvedBy: p.by }));
    case 'OfferApprovalRejected':
      return updateOffer(o => ({ ...o, status: 'Draft', requestedBy: undefined }));
    case 'OfferSent':
      return updateOffer(o => ({ ...o, status: 'Sent', expiresAt: p.expiresAt, sentAt: at }));
    case 'OfferAccepted':
      return updateOffer(o => ({ ...o, status: 'Accepted', acceptedAt: at, typedName: p.typedName, clientHash: p.clientHash }));
    case 'OfferDeclined':
      return updateOffer(o => ({ ...o, status: 'Declined', declineReason: p.reason }));
    case 'OfferExpired':
      return updateOffer(o => ({ ...o, status: 'Expired' }));
    case 'OfferRescinded':
      return updateOffer(o => ({ ...o, status: 'Rescinded', rescindReason: p.reason }));
    case 'CandidateHired':
      return { ...s, status: 'Hired', stage: 'hired', stageEnteredAt: at, hiredAt: at };
    default:
      return s;
  }
}

export function replayApplication(events: ReplayEvent[]): ApplicationState {
  return events.reduce(evolveApplication, initialApplicationState());
}

function requireExists(s: ApplicationState): void {
  if (!s.exists) throw new DomainError('application_not_found', 'Application not found', undefined, 404);
}

function requireNotWithdrawn(s: ApplicationState): void {
  if (s.status === 'Withdrawn') throw new DomainError('application_withdrawn', 'The application was withdrawn');
}

function beforeClose(ctx: ProcessContext, now: Date): boolean {
  return ctx.status === 'Posted' && !!ctx.closeAt && now.getTime() < new Date(ctx.closeAt).getTime();
}

function stageById(ctx: ProcessContext, id: string | undefined): Stage | undefined {
  return ctx.stages.find(s => s.stageId === id);
}

function screeningTargetStage(ctx: ProcessContext): string {
  return ctx.stages.find(s => s.stageId === 'assessment')?.stageId ?? ctx.stages[2]?.stageId ?? ctx.stages[0]?.stageId ?? 'assessment';
}

export interface DecidedWithActor extends DecidedEvent { actorOverride?: Actor; }

export function decideStartApplication(state: ApplicationState, cmd: {
  applicationId: string; candidateId: string; locale: Locale; now: Date; source?: { source: string; medium?: string; campaign?: string };
}, ctx: ProcessContext): DecidedEvent[] {
  if (state.exists) throw new DomainError('application_exists', 'An application already exists', undefined, 409);
  if (!beforeClose(ctx, cmd.now)) throw new DomainError('posting_closed', 'This posting is not accepting applications');
  const events: DecidedEvent[] = [{ type: 'ApplicationStarted', payload: { applicationId: cmd.applicationId, candidateId: cmd.candidateId, processId: ctx.processId, locale: cmd.locale } }];
  if (cmd.source?.source) events.push({ type: 'ApplicationSourceAttributed', payload: { ...cmd.source } });
  return events;
}

export function decideSaveAnswers(state: ApplicationState, cmd: { answers: unknown; answerKeys: string[]; now: Date }, ctx: ProcessContext): DecidedEvent[] {
  requireExists(state);
  requireNotWithdrawn(state);
  if (!['Draft', 'Submitted'].includes(state.status)) throw new DomainError('application_locked', 'Answers cannot change once screening has started');
  if (!beforeClose(ctx, cmd.now)) throw new DomainError('posting_closed', 'The posting is closed; attach a note instead');
  return [{ type: 'ApplicationAnswersSaved', payload: { answers: cmd.answers, answerKeys: cmd.answerKeys } }];
}

export function decideAttachDocument(state: ApplicationState, cmd: { documentId: string; kind: string; filename: unknown; size: number; sha256: string; mime: string; now: Date }, ctx: ProcessContext): DecidedEvent[] {
  requireExists(state);
  requireNotWithdrawn(state);
  if (!['Draft', 'Submitted'].includes(state.status)) throw new DomainError('application_locked');
  if (!beforeClose(ctx, cmd.now)) throw new DomainError('posting_closed');
  return [{ type: 'DocumentAttached', payload: { documentId: cmd.documentId, kind: cmd.kind, filename: cmd.filename, size: cmd.size, sha256: cmd.sha256, mime: cmd.mime } }];
}

export function decideRecordScan(state: ApplicationState, cmd: { documentId: string; result: 'clean' | 'infected' | 'error' }): DecidedEvent[] {
  requireExists(state);
  const doc = state.documents.find(d => d.documentId === cmd.documentId);
  if (!doc) throw new DomainError('document_not_found', 'Document not found', undefined, 404);
  if (doc.scanStatus !== 'PendingScan') return [];
  if (cmd.result === 'clean') return [{ type: 'DocumentScanned', payload: { documentId: cmd.documentId, result: 'clean' } }];
  return [
    { type: 'DocumentScanned', payload: { documentId: cmd.documentId, result: cmd.result } },
    { type: 'DocumentQuarantined', payload: { documentId: cmd.documentId } }
  ];
}

export function decideRemoveDocument(state: ApplicationState, cmd: { documentId: string }): DecidedEvent[] {
  requireExists(state);
  const doc = state.documents.find(d => d.documentId === cmd.documentId && !d.removed);
  if (!doc) throw new DomainError('document_not_found', 'Document not found', undefined, 404);
  if (state.status !== 'Draft') throw new DomainError('application_submitted', 'Documents on a submitted application cannot be removed');
  return [{ type: 'DocumentRemoved', payload: { documentId: cmd.documentId } }];
}

export function decideRecordConsent(state: ApplicationState, cmd: { noticeVersion: number }): DecidedEvent[] {
  requireExists(state);
  requireNotWithdrawn(state);
  if (state.consentNoticeVersion === cmd.noticeVersion) return [];
  return [{ type: 'ConsentRecorded', payload: { noticeVersion: cmd.noticeVersion } }];
}

export interface PlainAnswers { [questionCode: string]: string | undefined; }

// Submission (F07): server clock strictly before closing, required answers
// present, consent recorded for the current notice, knockouts evaluated.
export function decideSubmit(state: ApplicationState, cmd: { now: Date; plainAnswers: PlainAnswers; encryptedAnswers: unknown; consent: boolean }, ctx: ProcessContext): DecidedWithActor[] {
  requireExists(state);
  requireNotWithdrawn(state);
  if (!['Draft', 'Submitted'].includes(state.status)) throw new DomainError('application_locked');
  if (ctx.status !== 'Posted' || !ctx.closeAt || cmd.now.getTime() >= new Date(ctx.closeAt).getTime()) {
    throw new DomainError('posting_closed', 'The posting closed before this submission arrived', { closeAt: ctx.closeAt });
  }
  const fields: string[] = [];
  for (const c of ctx.criteria) {
    if (c.type === 'essential' && !(cmd.plainAnswers[c.code] ?? '').trim()) fields.push(c.code);
  }
  for (const k of ctx.knockouts) {
    const v = (cmd.plainAnswers[k.code] ?? '').trim().toLowerCase();
    if (v !== 'yes' && v !== 'no') fields.push(k.code);
  }
  if (!cmd.consent && state.consentNoticeVersion !== ctx.privacyNoticeVersion) fields.push('consent');
  if (fields.length) throw new DomainError('answers_incomplete', 'Required answers are missing', { fields }, 400);

  const events: DecidedWithActor[] = [];
  if (cmd.consent && state.consentNoticeVersion !== ctx.privacyNoticeVersion) {
    events.push({ type: 'ConsentRecorded', payload: { noticeVersion: ctx.privacyNoticeVersion } });
  }
  const answerKeys = Object.keys(cmd.plainAnswers).filter(k => (cmd.plainAnswers[k] ?? '').trim());
  const version = state.version + 1;
  if (state.status === 'Draft') {
    events.push({ type: 'ApplicationSubmitted', payload: { version, answers: cmd.encryptedAnswers, answerKeys, stage: ctx.stages[0]?.stageId ?? 'applied' } });
    const failed = ctx.knockouts.find(k => (cmd.plainAnswers[k.code] ?? '').trim().toLowerCase() !== k.expected);
    if (failed) {
      events.push({
        type: 'ApplicationScreenedOut',
        payload: { marks: {}, rationale: `Knockout question ${failed.code} answered "${cmd.plainAnswers[failed.code]}"`, automatic: true, knockoutCode: failed.code },
        actorOverride: { type: 'system', id: 'knockout' }
      });
    }
  } else {
    events.push({ type: 'ApplicationResubmitted', payload: { version, answers: cmd.encryptedAnswers, answerKeys } });
  }
  return events;
}

export function decideWithdraw(state: ApplicationState, cmd: { reason?: string }): DecidedEvent[] {
  requireExists(state);
  if (!['Draft', 'Submitted', 'Active'].includes(state.status)) throw new DomainError('invalid_status', `Cannot withdraw a ${state.status} application`);
  return [{ type: 'ApplicationWithdrawn', payload: { reason: cmd.reason }, reason: cmd.reason }];
}

function requireScreeningOpen(ctx: ProcessContext): void {
  if (!ctx.screeningOpen) throw new DomainError('screening_not_open', 'Screening opens when the posting closes');
}

export function decideScreenIn(state: ApplicationState, cmd: { marks: Record<string, 'met' | 'not_met'> }, ctx: ProcessContext): DecidedEvent[] {
  requireExists(state);
  requireNotWithdrawn(state);
  requireScreeningOpen(ctx);
  if (state.status !== 'Submitted') throw new DomainError('already_screened', `Application is ${state.status}`);
  const unmet = ctx.criteria.filter(c => c.type === 'essential' && cmd.marks[c.code] !== 'met').map(c => c.code);
  if (unmet.length) throw new DomainError('essential_criteria_unmet', 'Every essential criterion must be met to screen in', { unmet });
  return [{ type: 'ApplicationScreenedIn', payload: { marks: cmd.marks, stage: screeningTargetStage(ctx) } }];
}

export function decideScreenOut(state: ApplicationState, cmd: { marks: Record<string, 'met' | 'not_met'>; rationale: string }, ctx: ProcessContext): DecidedEvent[] {
  requireExists(state);
  requireNotWithdrawn(state);
  requireScreeningOpen(ctx);
  if (state.status !== 'Submitted') throw new DomainError('already_screened', `Application is ${state.status}`);
  const rationale = (cmd.rationale ?? '').trim();
  if (!rationale) throw new DomainError('rationale_required', 'A rationale is required to screen out');
  if (rationale.length < 20) throw new DomainError('rationale_too_short', 'The rationale must be at least 20 characters');
  const unmet = ctx.criteria.filter(c => c.type === 'essential' && cmd.marks[c.code] === 'not_met');
  if (!unmet.length) throw new DomainError('unmet_criterion_required', 'Screen-out needs at least one essential criterion not met');
  return [{ type: 'ApplicationScreenedOut', payload: { marks: cmd.marks, rationale, automatic: false }, reason: rationale }];
}

export function decideReverseScreening(state: ApplicationState, cmd: { reason: string }): DecidedEvent[] {
  requireExists(state);
  requireReason(cmd.reason);
  if (!state.screening) throw new DomainError('not_screened');
  if (!['ScreenedOut', 'Active'].includes(state.status)) throw new DomainError('invalid_status');
  if (state.status === 'Active' && (Object.keys(state.scores).length || state.stage !== screeningTargetStageId(state))) {
    throw new DomainError('assessment_started', 'Screening cannot be reversed once assessment has started');
  }
  return [{ type: 'ScreeningReversed', payload: { reason: cmd.reason }, reason: cmd.reason }];
}

function screeningTargetStageId(state: ApplicationState): string | undefined {
  return state.stage;
}

function consensusMissingFor(state: ApplicationState, ctx: ProcessContext): string[] {
  return ctx.criteria
    .filter(c => c.type === 'essential' && ctx.plan.some(e => e.criterionCode === c.code && SCORED_METHODS.includes(e.method)))
    .filter(c => !currentConsensus(state, c.code))
    .map(c => c.code);
}

export function decideMoveToStage(state: ApplicationState, cmd: { to: string; reason?: string }, ctx: ProcessContext): DecidedEvent[] {
  requireExists(state);
  requireNotWithdrawn(state);
  if (state.status !== 'Active') throw new DomainError('invalid_status', `Only active applications move between stages (status ${state.status})`);
  const from = stageById(ctx, state.stage);
  const to = stageById(ctx, cmd.to);
  if (!to) throw new DomainError('stage_not_found', 'Stage not found', undefined, 404);
  if (to.stageId === state.stage) return [];
  if (to.stageId === 'hired') throw new DomainError('use_offer', 'Candidates are hired by accepting an offer');
  if (from && to.order < from.order && !(cmd.reason ?? '').trim()) throw new DomainError('reason_required', 'Moving backward requires a reason');
  if (from?.requiresConsensus && to.order > from.order) {
    const missing = consensusMissingFor(state, ctx);
    if (missing.length) throw new DomainError('consensus_required', 'Consensus is required before leaving this stage', { missing });
  }
  if (to.stageId === 'qualified' && state.qualified !== true) throw new DomainError('candidate_not_qualified', 'Only qualified candidates enter this stage');
  return [{ type: 'ApplicationMovedToStage', payload: { from: state.stage, to: to.stageId, reason: cmd.reason }, reason: cmd.reason }];
}

export function decideTag(state: ApplicationState, cmd: { tags: string[] }): DecidedEvent[] {
  requireExists(state);
  const tags = Array.from(new Set(cmd.tags.map(t => t.trim()).filter(Boolean))).slice(0, 20);
  return [{ type: 'ApplicationTagged', payload: { tags } }];
}

export function decideAddNote(state: ApplicationState, cmd: { noteId: string; text: string; visibility: 'hr_only' | 'process_team' | 'candidate' }): DecidedEvent[] {
  requireExists(state);
  if (!cmd.text.trim()) throw new DomainError('text_required');
  return [{ type: 'NoteAdded', payload: { noteId: cmd.noteId, text: cmd.text.trim(), visibility: cmd.visibility } }];
}

function rubricFor(ctx: ProcessContext, criterionCode: string, method: AssessmentMethod): Rubric {
  const entry = ctx.plan.find(e => e.criterionCode === criterionCode && e.method === method);
  if (!entry) throw new DomainError('method_not_in_plan', `${criterionCode} is not assessed by ${method}`);
  const rubric = ctx.rubrics.find(r => r.rubricId === entry.rubricId);
  if (!rubric) throw new DomainError('rubric_missing', undefined, { missing: [`${criterionCode}: ${method}`] });
  return rubric;
}

function requireAssessor(state: ApplicationState, ctx: ProcessContext, assessorId: string): void {
  if (!ctx.board.some(b => b.userId === assessorId)) throw new ForbiddenError('not_on_board', 'Not a member of this board');
  if ((ctx.conflicts[assessorId] ?? []).includes(state.id)) throw new DomainError('conflict_of_interest', 'A declared conflict of interest bars scoring this candidate');
  if (!(assessorId in ctx.conflicts)) throw new DomainError('conflict_declaration_required', 'Declare conflicts of interest before scoring');
}

export function decideRecordScore(state: ApplicationState, cmd: { assessorId: string; criterionCode: string; method: AssessmentMethod; score: number; evidence: string; reason?: string }, ctx: ProcessContext): DecidedEvent[] {
  requireExists(state);
  requireNotWithdrawn(state);
  if (state.status !== 'Active') throw new DomainError('invalid_status', 'Only active applications are scored');
  requireAssessor(state, ctx, cmd.assessorId);
  const rubric = rubricFor(ctx, cmd.criterionCode, cmd.method);
  if (!Number.isFinite(cmd.score) || cmd.score < rubric.scale.min || cmd.score > rubric.scale.max) {
    throw new DomainError('score_out_of_range', `Score must be between ${rubric.scale.min} and ${rubric.scale.max}`, { min: rubric.scale.min, max: rubric.scale.max });
  }
  if (!(cmd.evidence ?? '').trim()) throw new DomainError('evidence_required', 'Evidence is required with every score');
  if (currentConsensus(state, cmd.criterionCode)) throw new DomainError('consensus_recorded', 'Consensus exists for this criterion; scores are frozen');
  const existing = state.scores[cmd.assessorId]?.[cmd.criterionCode];
  const events: DecidedEvent[] = [];
  if (existing) {
    requireReason(cmd.reason);
    events.push({ type: 'ScoreAmended', payload: { assessorId: cmd.assessorId, criterionCode: cmd.criterionCode, method: cmd.method, score: cmd.score, evidence: cmd.evidence.trim(), previous: existing.score, reason: cmd.reason }, reason: cmd.reason });
  } else {
    events.push({ type: 'ScoreRecorded', payload: { assessorId: cmd.assessorId, criterionCode: cmd.criterionCode, method: cmd.method, score: cmd.score, evidence: cmd.evidence.trim() } });
  }
  // Large disagreements are flagged as soon as they appear (F11)
  const all = Object.entries(state.scores).filter(([id]) => id !== cmd.assessorId).map(([, m]) => m[cmd.criterionCode]?.score).filter((v): v is number => typeof v === 'number');
  all.push(cmd.score);
  if (all.length >= 2 && Math.max(...all) - Math.min(...all) >= ctx.disagreementThreshold && !state.disagreements.includes(cmd.criterionCode)) {
    events.push({ type: 'DisagreementFlagged', payload: { criterionCode: cmd.criterionCode, spread: Math.max(...all) - Math.min(...all) } });
  }
  return events;
}

export function decideSubmitScores(state: ApplicationState, cmd: { assessorId: string }, ctx: ProcessContext): DecidedEvent[] {
  requireExists(state);
  requireAssessor(state, ctx, cmd.assessorId);
  if (!Object.keys(state.scores[cmd.assessorId] ?? {}).length) throw new DomainError('scores_required', 'Record at least one score before submitting');
  if (state.submittedAssessors.includes(cmd.assessorId)) return [];
  return [{ type: 'ScoresSubmitted', payload: { assessorId: cmd.assessorId } }];
}

export function nonConflictedAssessors(state: ApplicationState, ctx: ProcessContext): string[] {
  return ctx.board.filter(b => !(ctx.conflicts[b.userId] ?? []).includes(state.id)).map(b => b.userId);
}

export function decideRecordConsensus(state: ApplicationState, cmd: { by: string; criterionCode: string; score: number; note?: string; reason?: string }, ctx: ProcessContext): DecidedEvent[] {
  requireExists(state);
  requireNotWithdrawn(state);
  if (state.status !== 'Active' && state.status !== 'NotQualified') throw new DomainError('invalid_status');
  const chair = ctx.board.find(b => b.role === 'chair');
  if (!chair || chair.userId !== cmd.by) throw new ForbiddenError('chair_required', 'Only the board chair records consensus');
  const criterion = ctx.criteria.find(c => c.code === cmd.criterionCode);
  if (!criterion) throw new DomainError('criterion_not_found', 'Criterion not found', undefined, 404);
  const entry = ctx.plan.find(e => e.criterionCode === cmd.criterionCode && SCORED_METHODS.includes(e.method));
  if (!entry) throw new DomainError('method_not_in_plan', 'This criterion is not scored');
  const rubric = ctx.rubrics.find(r => r.rubricId === entry.rubricId);
  if (!rubric) throw new DomainError('rubric_missing');
  const required = nonConflictedAssessors(state, ctx).filter(id => id !== chair.userId || state.scores[chair.userId]);
  const missing = required.filter(id => !state.submittedAssessors.includes(id) || state.scores[id]?.[cmd.criterionCode] === undefined);
  if (missing.length) throw new DomainError('scores_incomplete', 'Every assessor must submit before consensus', { missing });
  if (cmd.score < rubric.scale.min || cmd.score > rubric.scale.max) throw new DomainError('score_out_of_range');
  const existing = state.consensus[cmd.criterionCode] ?? [];
  if (existing.length && !(cmd.reason ?? '').trim()) throw new DomainError('immutable', 'Consensus is immutable; record a new consensus with a reason');
  const pass = cmd.score >= rubric.passMark;
  const originalScores = Object.fromEntries(required.map(id => [id, state.scores[id][cmd.criterionCode].score]));
  const events: DecidedEvent[] = [{
    type: 'ConsensusRecorded',
    payload: { criterionCode: cmd.criterionCode, score: cmd.score, pass, note: cmd.note, supersedes: existing.length ? existing.length - 1 : undefined, originalScores, reason: cmd.reason },
    reason: cmd.reason
  }];
  // Qualified <=> all essential criteria pass at current consensus (invariant 8)
  const after: ApplicationState = evolveApplication(state, { type: 'ConsensusRecorded', payload: events[0].payload, occurredAt: new Date() });
  const scoredEssentials = ctx.criteria.filter(c => c.type === 'essential' && ctx.plan.some(e => e.criterionCode === c.code && SCORED_METHODS.includes(e.method)));
  const allDecided = scoredEssentials.every(c => currentConsensus(after, c.code));
  if (allDecided) {
    const failed = scoredEssentials.filter(c => !currentConsensus(after, c.code)!.pass).map(c => c.code);
    const qualified = failed.length === 0;
    if (qualified !== state.qualified || (!qualified && failed.join() !== state.failedCriteria.join())) {
      events.push(qualified ? { type: 'CandidateQualified', payload: {} } : { type: 'CandidateNotQualified', payload: { failedCriteria: failed } });
    }
  }
  return events;
}

export function decideAssignExam(state: ApplicationState, cmd: { criterionCode: string; windowStart: string; windowEnd: string; limitMinutes: number }, ctx: ProcessContext): DecidedEvent[] {
  requireExists(state);
  requireNotWithdrawn(state);
  if (state.status !== 'Active') throw new DomainError('invalid_status');
  if (!ctx.plan.some(e => e.criterionCode === cmd.criterionCode && e.method === 'written_exam')) throw new DomainError('method_not_in_plan', 'No written exam in the plan for this criterion');
  if (new Date(cmd.windowStart) >= new Date(cmd.windowEnd)) throw new DomainError('window_invalid');
  if (cmd.limitMinutes < 1) throw new DomainError('limit_invalid');
  return [{ type: 'ExamAssigned', payload: { criterionCode: cmd.criterionCode, windowStart: cmd.windowStart, windowEnd: cmd.windowEnd, limitMinutes: cmd.limitMinutes } }];
}

export function decideStartExam(state: ApplicationState, cmd: { now: Date; timeMultiplier: number }): DecidedEvent[] {
  requireExists(state);
  const exam = state.exam;
  if (!exam) throw new DomainError('exam_not_assigned', 'No exam assigned', undefined, 404);
  if (exam.startedAt) return [];
  if (cmd.now < new Date(exam.windowStart) || cmd.now > new Date(exam.windowEnd)) throw new DomainError('exam_window_closed', 'The exam window is not open');
  const minutes = Math.round(exam.limitMinutes * (cmd.timeMultiplier || 1));
  const deadline = new Date(cmd.now.getTime() + minutes * 60_000).toISOString();
  return [{ type: 'ExamStarted', payload: { deadline, limitMinutes: minutes, accommodated: cmd.timeMultiplier !== 1 } }];
}

export function decideSubmitExam(state: ApplicationState, cmd: { now: Date; answers: unknown }): DecidedEvent[] {
  requireExists(state);
  const exam = state.exam;
  if (!exam || !exam.startedAt) throw new DomainError('exam_not_started');
  if (exam.submittedAt) throw new DomainError('exam_submitted');
  const late = cmd.now.getTime() > new Date(exam.deadline!).getTime();
  return [{ type: 'ExamSubmitted', payload: { late, answers: cmd.answers } }];
}

export function decideReleaseExamLate(state: ApplicationState, cmd: { reason: string }): DecidedEvent[] {
  requireExists(state);
  requireReason(cmd.reason);
  if (!state.exam?.submittedAt || !state.exam.late) throw new DomainError('exam_not_late');
  if (state.exam.released) return [];
  return [{ type: 'ExamReleasedLate', payload: { reason: cmd.reason }, reason: cmd.reason }];
}

export function decideSendInterviewInvitation(state: ApplicationState): DecidedEvent[] {
  requireExists(state);
  requireNotWithdrawn(state);
  if (state.status !== 'Active') throw new DomainError('invalid_status');
  return [{ type: 'InterviewInvitationSent', payload: {} }];
}

export function decideBookInterview(state: ApplicationState, cmd: { slotId: string; now: Date; byStaff: boolean; reason?: string }, ctx: ProcessContext): DecidedEvent[] {
  requireExists(state);
  requireNotWithdrawn(state);
  if (state.status !== 'Active') throw new DomainError('invalid_status');
  const slot = ctx.slots.find(s => s.slotId === cmd.slotId);
  if (!slot || slot.status !== 'open') throw new DomainError('slot_no_longer_available', 'That slot is no longer available', undefined, 409);
  if (cmd.byStaff) requireReason(cmd.reason);
  const existing = state.interview?.status === 'booked' ? state.interview : undefined;
  if (existing) {
    const cutoff = new Date(existing.at).getTime() - ctx.rescheduleCutoffHours * 3_600_000;
    if (!cmd.byStaff && cmd.now.getTime() > cutoff) throw new DomainError('reschedule_cutoff_passed', 'The reschedule cut-off has passed; contact HR');
    return [{ type: 'InterviewRescheduled', payload: { from: existing.at, to: slot.startsAt, slotId: slot.slotId, previousSlotId: existing.slotId, reason: cmd.reason }, reason: cmd.reason }];
  }
  return [{ type: 'InterviewBooked', payload: { slotId: slot.slotId, at: slot.startsAt, reason: cmd.reason }, reason: cmd.reason }];
}

export function decideCancelInterview(state: ApplicationState, cmd: { reason: string }): DecidedEvent[] {
  requireExists(state);
  requireReason(cmd.reason);
  if (!state.interview || state.interview.status !== 'booked') throw new DomainError('no_interview');
  return [{ type: 'InterviewCancelled', payload: { slotId: state.interview.slotId, reason: cmd.reason }, reason: cmd.reason }];
}

export function decideRecordInterviewNotes(state: ApplicationState, cmd: { assessorId: string; criterionCode?: string; notes: string }, ctx: ProcessContext): DecidedEvent[] {
  requireExists(state);
  if (!ctx.board.some(b => b.userId === cmd.assessorId)) throw new ForbiddenError('not_on_board');
  if (!cmd.notes.trim()) throw new DomainError('text_required');
  return [{ type: 'InterviewNotesRecorded', payload: { assessorId: cmd.assessorId, criterionCode: cmd.criterionCode, notes: cmd.notes.trim() } }];
}

const OPEN_OFFER: OfferStatus[] = ['Draft', 'PendingApproval', 'Approved', 'Sent'];

export function decideDraftOffer(state: ApplicationState, cmd: { offerId: string; templateId?: string; fields: unknown; startDate?: string }): DecidedEvent[] {
  requireExists(state);
  requireNotWithdrawn(state);
  if (state.qualified !== true) throw new DomainError('candidate_not_qualified', 'Offers can only be drafted for qualified candidates');
  if (state.status !== 'Active') throw new DomainError('invalid_status');
  const open = currentOffer(state);
  if (open && OPEN_OFFER.includes(open.status)) throw new DomainError('offer_open', 'An offer is already in progress');
  return [{ type: 'OfferDrafted', payload: { offerId: cmd.offerId, templateId: cmd.templateId, fields: cmd.fields, startDate: cmd.startDate } }];
}

function requireOffer(state: ApplicationState, offerId: string, ...statuses: OfferStatus[]): Offer {
  const offer = currentOffer(state);
  if (!offer || offer.offerId !== offerId) throw new DomainError('offer_not_found', 'Offer not found', undefined, 404);
  if (statuses.length && !statuses.includes(offer.status)) throw new DomainError('invalid_status', `Offer is ${offer.status}`);
  return offer;
}

export function decideRequestOfferApproval(state: ApplicationState, cmd: { offerId: string; by: string }): DecidedEvent[] {
  requireOffer(state, cmd.offerId, 'Draft');
  return [{ type: 'OfferApprovalRequested', payload: { offerId: cmd.offerId, by: cmd.by } }];
}

export function decideApproveOffer(state: ApplicationState, cmd: { offerId: string; by: string; comment?: string }): DecidedEvent[] {
  const offer = requireOffer(state, cmd.offerId, 'PendingApproval');
  if (offer.requestedBy === cmd.by || offer.draftedBy === cmd.by) throw new DomainError('cannot_approve_own_request');
  return [{ type: 'OfferApproved', payload: { offerId: cmd.offerId, by: cmd.by, comment: cmd.comment } }];
}

export function decideRejectOffer(state: ApplicationState, cmd: { offerId: string; by: string; reason: string }): DecidedEvent[] {
  requireOffer(state, cmd.offerId, 'PendingApproval');
  requireReason(cmd.reason);
  return [{ type: 'OfferApprovalRejected', payload: { offerId: cmd.offerId, by: cmd.by, reason: cmd.reason }, reason: cmd.reason }];
}

export function decideSendOffer(state: ApplicationState, cmd: { offerId: string; expiresAt: string; now: Date }, ctx: ProcessContext): DecidedEvent[] {
  const offer = requireOffer(state, cmd.offerId);
  if (ctx.offerApprovalRequired && offer.status !== 'Approved') throw new DomainError('approval_required', 'The offer must be approved before sending');
  if (!ctx.offerApprovalRequired && !['Draft', 'Approved'].includes(offer.status)) throw new DomainError('invalid_status');
  if (new Date(cmd.expiresAt).getTime() <= cmd.now.getTime()) throw new DomainError('expiry_past');
  return [{ type: 'OfferSent', payload: { offerId: cmd.offerId, expiresAt: cmd.expiresAt } }];
}

export function decideAcceptOffer(state: ApplicationState, cmd: { offerId: string; typedName: unknown; clientHash: string; now: Date }): DecidedEvent[] {
  const offer = requireOffer(state, cmd.offerId, 'Sent');
  if (cmd.now.getTime() > new Date(offer.expiresAt!).getTime()) throw new DomainError('offer_expired');
  if (!cmd.typedName) throw new DomainError('typed_name_required');
  return [
    { type: 'OfferAccepted', payload: { offerId: cmd.offerId, typedName: cmd.typedName, clientHash: cmd.clientHash } },
    { type: 'CandidateHired', payload: { offerId: cmd.offerId, startDate: offer.startDate } }
  ];
}

export function decideDeclineOffer(state: ApplicationState, cmd: { offerId: string; reason?: string }): DecidedEvent[] {
  requireOffer(state, cmd.offerId, 'Sent');
  return [{ type: 'OfferDeclined', payload: { offerId: cmd.offerId, reason: cmd.reason }, reason: cmd.reason }];
}

export function decideExpireOffer(state: ApplicationState, cmd: { now: Date; causationId?: string }): DecidedEvent[] {
  const offer = currentOffer(state);
  if (!offer || offer.status !== 'Sent') return [];
  if (cmd.now.getTime() <= new Date(offer.expiresAt!).getTime()) return [];
  return [{ type: 'OfferExpired', payload: { offerId: offer.offerId }, causationId: cmd.causationId }];
}

export function decideRescindOffer(state: ApplicationState, cmd: { offerId: string; reason: string }): DecidedEvent[] {
  requireOffer(state, cmd.offerId, 'Sent', 'Approved', 'PendingApproval', 'Draft');
  requireReason(cmd.reason);
  return [{ type: 'OfferRescinded', payload: { offerId: cmd.offerId, reason: cmd.reason }, reason: cmd.reason }];
}
