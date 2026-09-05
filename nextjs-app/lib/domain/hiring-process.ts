import { DomainError } from './errors';
import { ReplayEvent, DecidedEvent } from '@/types/events';
import {
  AssessmentMethod, BoardMember, Criterion, CriterionType, CRITERION_PREFIX, InterviewSlot, Knockout, LangMap,
  LanguageSetting, Locale, PlanEntry, ProcessStatus, Rubric, Stage, SCORED_METHODS
} from '@/types/shared';
import { missingLanguages } from './lang';
import { validateStages } from './organization';

export interface HiringProcessState {
  exists: boolean;
  id: string;
  reference: string;
  slug: string;
  title: LangMap;
  hiringManagerId: string;
  hrAdvisorId: string;
  location: string;
  classification?: string;
  status: ProcessStatus;
  criteria: Criterion[];
  plan: PlanEntry[];
  rubrics: Rubric[];
  stages: Stage[];
  board: BoardMember[];
  conflicts: Record<string, string[]>;   // userId -> application ids
  knockouts: Knockout[];
  poster: LangMap;
  posterVersion: number;
  posterHistory: Array<{ version: number; poster: LangMap; at: string; reason?: string }>;
  approval: { requestedBy?: string; approvedBy?: string; comment?: string };
  publishAt?: string;
  closeAt?: string;
  publishedAt?: string;
  closedAt?: string;
  cancelledAt?: string;
  completedAt?: string;
  screeningOpen: boolean;
  resultsReleased: boolean;
  slots: InterviewSlot[];
  createdBy?: string;
  createdAt?: string;
  version: number;
}

export function initialProcessState(): HiringProcessState {
  return {
    exists: false, id: '', reference: '', slug: '', title: {}, hiringManagerId: '', hrAdvisorId: '', location: '',
    status: 'Draft', criteria: [], plan: [], rubrics: [], stages: [], board: [], conflicts: {}, knockouts: [],
    poster: {}, posterVersion: 0, posterHistory: [], approval: {}, screeningOpen: false, resultsReleased: false, slots: [], version: 0
  };
}

export function evolveProcess(state: HiringProcessState, event: ReplayEvent): HiringProcessState {
  const p = event.payload as Record<string, any>;
  const s: HiringProcessState = { ...state, version: state.version + 1 };
  const at = event.occurredAt.toISOString();
  switch (event.type) {
    case 'HiringProcessCreated':
      return {
        ...s, exists: true, id: p.processId, reference: p.reference, slug: p.slug, title: p.title, hiringManagerId: p.hiringManager,
        hrAdvisorId: p.hrAdvisor, location: p.location ?? '', classification: p.classification, stages: p.stages ?? [],
        criteria: p.criteria ?? [], plan: p.plan ?? [], rubrics: p.rubrics ?? [], knockouts: p.knockouts ?? [], poster: p.poster ?? {},
        createdBy: event.actor?.id, createdAt: at
      };
    case 'HiringProcessDetailsUpdated':
      return { ...s, title: p.title ?? s.title, hiringManagerId: p.hiringManager ?? s.hiringManagerId, hrAdvisorId: p.hrAdvisor ?? s.hrAdvisorId, location: p.location ?? s.location, classification: p.classification ?? s.classification };
    case 'MeritCriterionAdded':
      return { ...s, criteria: [...s.criteria, { code: p.code, type: p.type, text: p.text, order: p.order }].sort((a, b) => a.order - b.order) };
    case 'MeritCriterionUpdated':
      if (p.criteria) return { ...s, criteria: p.criteria, plan: p.plan ?? s.plan };
      return { ...s, criteria: s.criteria.map(c => c.code === p.code ? { ...c, text: p.text ?? c.text, type: p.type ?? c.type } : c) };
    case 'MeritCriterionRemoved':
      return { ...s, criteria: s.criteria.filter(c => c.code !== p.code), plan: s.plan.filter(e => e.criterionCode !== p.code) };
    case 'AssessmentMethodAssigned':
      return { ...s, plan: [...s.plan.filter(e => !(e.criterionCode === p.criterionCode && e.method === p.method)), { criterionCode: p.criterionCode, method: p.method, rubricId: p.rubricId }] };
    case 'AssessmentMethodRemoved':
      return { ...s, plan: s.plan.filter(e => !(e.criterionCode === p.criterionCode && e.method === p.method)) };
    case 'RubricDefined':
      return { ...s, rubrics: [...s.rubrics.filter(r => r.rubricId !== p.rubricId), { rubricId: p.rubricId, name: p.name, scale: p.scale, passMark: p.passMark, descriptors: p.descriptors ?? {} }] };
    case 'StageAdded':
      return { ...s, stages: [...s.stages.filter(x => x.stageId !== p.stageId), { stageId: p.stageId, name: p.name, candidateLabel: p.candidateLabel, notifies: !!p.notifies, requiresConsensus: !!p.requiresConsensus, order: p.order, ageingThresholdDays: p.ageingThresholdDays }].sort((a, b) => a.order - b.order) };
    case 'StageRenamed':
      return { ...s, stages: s.stages.map(x => x.stageId === p.stageId ? { ...x, name: p.name ?? x.name, candidateLabel: p.candidateLabel ?? x.candidateLabel, notifies: p.notifies ?? x.notifies, requiresConsensus: p.requiresConsensus ?? x.requiresConsensus, order: p.order ?? x.order, ageingThresholdDays: p.ageingThresholdDays ?? x.ageingThresholdDays } : x).sort((a, b) => a.order - b.order) };
    case 'StageRemoved':
      return { ...s, stages: s.stages.filter(x => x.stageId !== p.stageId) };
    case 'BoardMemberAssigned':
      return { ...s, board: [...s.board.filter(b => b.userId !== p.userId), { userId: p.userId, role: p.role }] };
    case 'BoardMemberRemoved':
      return { ...s, board: s.board.filter(b => b.userId !== p.userId) };
    case 'ConflictOfInterestDeclared':
      return { ...s, conflicts: { ...s.conflicts, [p.userId]: p.conflictedApplicationIds ?? [] } };
    case 'KnockoutQuestionAdded':
      return { ...s, knockouts: [...s.knockouts.filter(k => k.code !== p.code), { code: p.code, question: p.question, expected: p.expected }] };
    case 'KnockoutQuestionRemoved':
      return { ...s, knockouts: s.knockouts.filter(k => k.code !== p.code) };
    case 'ApprovalRequested':
      return { ...s, status: 'PendingApproval', approval: { requestedBy: p.by } };
    case 'ProcessApproved':
      return { ...s, status: 'Approved', approval: { ...s.approval, approvedBy: p.by, comment: p.comment } };
    case 'ProcessApprovalRejected':
      return { ...s, status: 'Draft', approval: {} };
    case 'ProcessReturnedToDraft':
      return { ...s, status: 'Draft', approval: {} };
    case 'PosterDrafted':
      return { ...s, poster: { ...s.poster, [p.lang]: p.body } };
    case 'PostingScheduled':
      return { ...s, status: 'Scheduled', publishAt: p.publishAt, closeAt: p.closeAt };
    case 'PostingPublished':
      return { ...s, status: 'Posted', posterVersion: p.version, publishedAt: p.publishedAt, closeAt: p.closeAt, publishAt: undefined, posterHistory: [...s.posterHistory, { version: p.version, poster: s.poster, at }], screeningOpen: s.screeningOpen || !!p.rollingScreening };
    case 'PostingAmended':
      return { ...s, poster: { ...s.poster, ...(p.poster ?? {}) }, posterVersion: p.version, posterHistory: [...s.posterHistory, { version: p.version, poster: { ...s.poster, ...(p.poster ?? {}) }, at, reason: p.reason }] };
    case 'ClosingDateExtended':
      return { ...s, closeAt: p.to };
    case 'PostingClosed':
      return { ...s, status: 'Closed', closedAt: p.closedAt };
    case 'ScreeningOpened':
      return { ...s, screeningOpen: true };
    case 'ScreeningResultsReleased':
      return { ...s, resultsReleased: true };
    case 'ProcessCompleted':
      return { ...s, status: 'Completed', completedAt: at };
    case 'ProcessCancelled':
      return { ...s, status: 'Cancelled', cancelledAt: at };
    case 'InterviewSlotsPublished':
      return { ...s, slots: [...s.slots, ...(p.slots as InterviewSlot[]).map(x => ({ ...x, status: 'open' as const }))].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) };
    case 'InterviewSlotBooked':
      return { ...s, slots: s.slots.map(x => x.slotId === p.slotId ? { ...x, status: 'booked', applicationId: p.applicationId } : x) };
    case 'InterviewSlotReleased':
      return { ...s, slots: s.slots.map(x => x.slotId === p.slotId ? { ...x, status: 'open', applicationId: undefined } : x) };
    default:
      return s;
  }
}

export function replayProcess(events: ReplayEvent[]): HiringProcessState {
  return events.reduce(evolveProcess, initialProcessState());
}

export interface ProcessOrgContext {
  languages: LanguageSetting[];
  timeZone: string;
  rollingScreening: boolean;
}

const EDITABLE: ProcessStatus[] = ['Draft'];

function requireExists(s: HiringProcessState): void {
  if (!s.exists) throw new DomainError('process_not_found', 'Process not found', undefined, 404);
}

function requireEditable(s: HiringProcessState): void {
  requireExists(s);
  if (!EDITABLE.includes(s.status)) throw new DomainError('process_locked', `Process is ${s.status}; criteria and plan are locked from approval onward`);
}

export function nextCriterionCode(criteria: Criterion[], type: CriterionType): string {
  const prefix = CRITERION_PREFIX[type];
  const n = criteria.filter(c => c.type === type).length + 1;
  return `${prefix}${n}`;
}

export function decideCreateProcess(state: HiringProcessState, cmd: {
  processId: string; reference: string; slug: string; title: LangMap; hiringManager: string; hrAdvisor: string; location: string;
  classification?: string; stages: Stage[];
  clone?: { criteria: Criterion[]; plan: PlanEntry[]; rubrics: Rubric[]; knockouts: Knockout[]; poster: LangMap };
}): DecidedEvent[] {
  if (state.exists) throw new DomainError('process_exists');
  const hasTitle = Object.values(cmd.title).some(t => t && t.trim());
  if (!hasTitle) throw new DomainError('title_required', 'A title in at least one language is required');
  if (!cmd.hiringManager || !cmd.hrAdvisor) throw new DomainError('owners_required', 'Hiring manager and HR advisor are required');
  return [{
    type: 'HiringProcessCreated',
    payload: {
      processId: cmd.processId, reference: cmd.reference, slug: cmd.slug, title: cmd.title, hiringManager: cmd.hiringManager,
      hrAdvisor: cmd.hrAdvisor, location: cmd.location, classification: cmd.classification, stages: cmd.stages,
      criteria: cmd.clone?.criteria ?? [], plan: cmd.clone?.plan ?? [], rubrics: cmd.clone?.rubrics ?? [],
      knockouts: cmd.clone?.knockouts ?? [], poster: cmd.clone?.poster ?? {}, clonedFrom: cmd.clone ? true : undefined
    }
  }];
}

export function decideUpdateDetails(state: HiringProcessState, cmd: { title?: LangMap; hiringManager?: string; hrAdvisor?: string; location?: string; classification?: string }): DecidedEvent[] {
  requireExists(state);
  if (!['Draft', 'PendingApproval'].includes(state.status)) {
    // Only the title/location may change after approval? No: details are locked with the plan.
    throw new DomainError('process_locked');
  }
  return [{ type: 'HiringProcessDetailsUpdated', payload: cmd }];
}

export function decideAddCriterion(state: HiringProcessState, cmd: { type: CriterionType; text: LangMap }): DecidedEvent[] {
  requireEditable(state);
  if (!Object.values(cmd.text).some(t => t && t.trim())) throw new DomainError('text_required');
  const code = nextCriterionCode(state.criteria, cmd.type);
  const order = state.criteria.length + 1;
  return [{ type: 'MeritCriterionAdded', payload: { code, type: cmd.type, text: cmd.text, order } }];
}

export function decideUpdateCriterion(state: HiringProcessState, cmd: { code: string; text: LangMap }): DecidedEvent[] {
  requireEditable(state);
  if (!state.criteria.some(c => c.code === cmd.code)) throw new DomainError('criterion_not_found', 'Criterion not found', undefined, 404);
  return [{ type: 'MeritCriterionUpdated', payload: { code: cmd.code, text: cmd.text } }];
}

export function decideRemoveCriterion(state: HiringProcessState, cmd: { code: string }): DecidedEvent[] {
  requireEditable(state);
  if (!state.criteria.some(c => c.code === cmd.code)) throw new DomainError('criterion_not_found', 'Criterion not found', undefined, 404);
  return [{ type: 'MeritCriterionRemoved', payload: { code: cmd.code } }];
}

// Reordering recodes criteria within each type (E1, E2, ...) and rewrites the
// plan so every assessment method follows its criterion (F05).
export function decideReorderCriteria(state: HiringProcessState, cmd: { codes: string[] }): DecidedEvent[] {
  requireEditable(state);
  const existing = new Map(state.criteria.map(c => [c.code, c]));
  if (cmd.codes.length !== state.criteria.length || cmd.codes.some(c => !existing.has(c))) throw new DomainError('reorder_invalid');
  const counters: Partial<Record<CriterionType, number>> = {};
  const recode = new Map<string, string>();
  const criteria: Criterion[] = cmd.codes.map((old, i) => {
    const c = existing.get(old)!;
    counters[c.type] = (counters[c.type] ?? 0) + 1;
    const code = `${CRITERION_PREFIX[c.type]}${counters[c.type]}`;
    recode.set(old, code);
    return { ...c, code, order: i + 1 };
  });
  const plan = state.plan.map(e => ({ ...e, criterionCode: recode.get(e.criterionCode) ?? e.criterionCode }));
  return [{ type: 'MeritCriterionUpdated', payload: { criteria, plan, recoded: Object.fromEntries(recode) } }];
}

export function decideAssignMethod(state: HiringProcessState, cmd: { criterionCode: string; method: AssessmentMethod; rubricId?: string }): DecidedEvent[] {
  requireEditable(state);
  if (!state.criteria.some(c => c.code === cmd.criterionCode)) throw new DomainError('criterion_not_found', 'Criterion not found', undefined, 404);
  if (cmd.rubricId && !state.rubrics.some(r => r.rubricId === cmd.rubricId)) throw new DomainError('rubric_not_found', 'Rubric not found', undefined, 404);
  return [{ type: 'AssessmentMethodAssigned', payload: { criterionCode: cmd.criterionCode, method: cmd.method, rubricId: cmd.rubricId } }];
}

export function decideRemoveMethod(state: HiringProcessState, cmd: { criterionCode: string; method: AssessmentMethod }): DecidedEvent[] {
  requireEditable(state);
  return [{ type: 'AssessmentMethodRemoved', payload: cmd }];
}

export function decideDefineRubric(state: HiringProcessState, cmd: Rubric, org: ProcessOrgContext): DecidedEvent[] {
  requireEditable(state);
  if (cmd.scale.min >= cmd.scale.max) throw new DomainError('rubric_scale_invalid');
  if (cmd.passMark < cmd.scale.min || cmd.passMark > cmd.scale.max) throw new DomainError('rubric_pass_mark_invalid');
  const missing = missingLanguages(cmd.descriptors, org.languages, 'rubric descriptors');
  if (missing.length) throw new DomainError('missing_language_content', 'Rubric descriptors missing in a required language', { missing });
  return [{ type: 'RubricDefined', payload: { ...cmd } }];
}

export function decideSetStages(state: HiringProcessState, cmd: { stages: Stage[]; stagesInUse: string[] }, org: ProcessOrgContext): DecidedEvent[] {
  requireExists(state);
  if (['Completed', 'Cancelled'].includes(state.status)) throw new DomainError('process_locked');
  validateStages(cmd.stages, org.languages);
  const events: DecidedEvent[] = [];
  const nextIds = new Set(cmd.stages.map(s => s.stageId));
  for (const old of state.stages) {
    if (!nextIds.has(old.stageId)) {
      if (cmd.stagesInUse.includes(old.stageId)) throw new DomainError('stage_in_use', `Stage ${old.stageId} has applications in it`, { stageId: old.stageId });
      events.push({ type: 'StageRemoved', payload: { stageId: old.stageId } });
    }
  }
  for (const stage of cmd.stages) {
    const old = state.stages.find(s => s.stageId === stage.stageId);
    if (!old) events.push({ type: 'StageAdded', payload: { ...stage } });
    else if (JSON.stringify(old) !== JSON.stringify(stage)) events.push({ type: 'StageRenamed', payload: { ...stage } });
  }
  return events;
}

export function decideSetBoard(state: HiringProcessState, cmd: { board: BoardMember[] }): DecidedEvent[] {
  requireExists(state);
  if (['Completed', 'Cancelled'].includes(state.status)) throw new DomainError('process_locked');
  if (cmd.board.filter(b => b.role === 'chair').length > 1) throw new DomainError('one_chair_only');
  const events: DecidedEvent[] = [];
  const nextIds = new Set(cmd.board.map(b => b.userId));
  for (const old of state.board) if (!nextIds.has(old.userId)) events.push({ type: 'BoardMemberRemoved', payload: { userId: old.userId } });
  for (const b of cmd.board) {
    const old = state.board.find(x => x.userId === b.userId);
    if (!old || old.role !== b.role) events.push({ type: 'BoardMemberAssigned', payload: { userId: b.userId, role: b.role } });
  }
  return events;
}

export function decideDeclareConflict(state: HiringProcessState, cmd: { userId: string; conflictedApplicationIds: string[] }): DecidedEvent[] {
  requireExists(state);
  if (!state.board.some(b => b.userId === cmd.userId)) throw new DomainError('not_on_board', 'Only board members declare conflicts', undefined, 403);
  return [{ type: 'ConflictOfInterestDeclared', payload: { userId: cmd.userId, conflictedApplicationIds: cmd.conflictedApplicationIds } }];
}

export function decideAddKnockout(state: HiringProcessState, cmd: { question: LangMap; expected: 'yes' | 'no' }): DecidedEvent[] {
  requireEditable(state);
  const code = `K${state.knockouts.length + 1}`;
  return [{ type: 'KnockoutQuestionAdded', payload: { code, question: cmd.question, expected: cmd.expected } }];
}

export function decideRemoveKnockout(state: HiringProcessState, cmd: { code: string }): DecidedEvent[] {
  requireEditable(state);
  return [{ type: 'KnockoutQuestionRemoved', payload: { code: cmd.code } }];
}

export function decideDraftPoster(state: HiringProcessState, cmd: { lang: Locale; body: string }): DecidedEvent[] {
  requireExists(state);
  if (!['Draft', 'PendingApproval', 'Approved', 'Scheduled'].includes(state.status)) throw new DomainError('use_amend', 'Posted posters change through an amendment with a reason');
  return [{ type: 'PosterDrafted', payload: { lang: cmd.lang, body: cmd.body } }];
}

// Approval gates (F05): every essential criterion assessed, every scored method has a rubric
export function approvalBlockers(state: HiringProcessState): { code: string; details: string[] } | null {
  const unassessed = state.criteria.filter(c => c.type === 'essential' && !state.plan.some(e => e.criterionCode === c.code)).map(c => c.code);
  if (unassessed.length) return { code: 'assessment_plan_incomplete', details: unassessed };
  const noRubric = state.plan.filter(e => SCORED_METHODS.includes(e.method) && !e.rubricId).map(e => `${e.criterionCode}: ${e.method}`);
  if (noRubric.length) return { code: 'rubric_missing', details: noRubric };
  return null;
}

export function decideRequestApproval(state: HiringProcessState, cmd: { by: string }): DecidedEvent[] {
  requireExists(state);
  if (state.status !== 'Draft') throw new DomainError('invalid_status', `Cannot request approval while ${state.status}`);
  if (!state.criteria.some(c => c.type === 'essential')) throw new DomainError('essential_criteria_required');
  const blocker = approvalBlockers(state);
  if (blocker) throw new DomainError(blocker.code, undefined, { missing: blocker.details });
  return [{ type: 'ApprovalRequested', payload: { by: cmd.by } }];
}

export function decideApprove(state: HiringProcessState, cmd: { by: string; comment?: string }): DecidedEvent[] {
  requireExists(state);
  if (state.status !== 'PendingApproval') throw new DomainError('invalid_status', 'Nothing awaiting approval');
  if (state.approval.requestedBy === cmd.by) throw new DomainError('cannot_approve_own_request', 'Requester and approver must differ');
  return [{ type: 'ProcessApproved', payload: { by: cmd.by, comment: cmd.comment } }];
}

export function decideReject(state: HiringProcessState, cmd: { by: string; reason: string }): DecidedEvent[] {
  requireExists(state);
  if (state.status !== 'PendingApproval') throw new DomainError('invalid_status');
  requireReason(cmd.reason);
  return [{ type: 'ProcessApprovalRejected', payload: { by: cmd.by, reason: cmd.reason }, reason: cmd.reason }];
}

export function decideReturnToDraft(state: HiringProcessState, cmd: { by: string; reason: string }): DecidedEvent[] {
  requireExists(state);
  if (!['PendingApproval', 'Approved'].includes(state.status)) throw new DomainError('invalid_status');
  requireReason(cmd.reason);
  return [{ type: 'ProcessReturnedToDraft', payload: { by: cmd.by, reason: cmd.reason }, reason: cmd.reason }];
}

export function publishBlockers(state: HiringProcessState, org: ProcessOrgContext, closeAt: Date, now: Date): void {
  if (state.status === 'Draft' || state.status === 'PendingApproval') throw new DomainError('approval_required', 'The process must be approved before publishing');
  if (!['Approved', 'Scheduled'].includes(state.status)) throw new DomainError('invalid_status', `Cannot publish while ${state.status}`);
  const missing = [...missingLanguages(state.title, org.languages, 'title'), ...missingLanguages(state.poster, org.languages, 'poster body')];
  if (missing.length) throw new DomainError('missing_language_content', 'Poster content missing in a required language', { missing });
  const unassessed = state.criteria.filter(c => c.type === 'essential' && !state.plan.some(e => e.criterionCode === c.code)).map(c => c.code);
  if (unassessed.length) throw new DomainError('assessment_plan_incomplete', undefined, { missing: unassessed });
  if (!(closeAt.getTime() > now.getTime())) throw new DomainError('closing_date_past', 'The closing time must be in the future');
}

export function decidePublish(state: HiringProcessState, cmd: { closeAt: Date; now: Date; causationId?: string }, org: ProcessOrgContext): DecidedEvent[] {
  requireExists(state);
  publishBlockers(state, org, cmd.closeAt, cmd.now);
  const events: DecidedEvent[] = [{
    type: 'PostingPublished',
    payload: { version: state.posterVersion + 1, publishedAt: cmd.now.toISOString(), closeAt: cmd.closeAt.toISOString(), rollingScreening: org.rollingScreening },
    causationId: cmd.causationId
  }];
  if (org.rollingScreening) events.push({ type: 'ScreeningOpened', payload: { rolling: true } });
  return events;
}

export function decideSchedule(state: HiringProcessState, cmd: { publishAt: Date; closeAt: Date; now: Date }, org: ProcessOrgContext): DecidedEvent[] {
  requireExists(state);
  publishBlockers(state, org, cmd.closeAt, cmd.now);
  if (cmd.publishAt.getTime() <= cmd.now.getTime()) throw new DomainError('publish_date_past');
  if (cmd.publishAt.getTime() >= cmd.closeAt.getTime()) throw new DomainError('closing_before_publish');
  return [{ type: 'PostingScheduled', payload: { publishAt: cmd.publishAt.toISOString(), closeAt: cmd.closeAt.toISOString() } }];
}

export function decideAmend(state: HiringProcessState, cmd: { poster: LangMap; reason: string }, org: ProcessOrgContext): DecidedEvent[] {
  requireExists(state);
  if (state.status !== 'Posted') throw new DomainError('invalid_status', 'Only posted posters are amended');
  requireReason(cmd.reason);
  const merged = { ...state.poster, ...cmd.poster };
  const missing = missingLanguages(merged, org.languages, 'poster body');
  if (missing.length) throw new DomainError('missing_language_content', undefined, { missing });
  return [{ type: 'PostingAmended', payload: { version: state.posterVersion + 1, poster: cmd.poster, reason: cmd.reason }, reason: cmd.reason }];
}

export function decideExtend(state: HiringProcessState, cmd: { to: Date; reason: string; now: Date }): DecidedEvent[] {
  requireExists(state);
  if (state.status !== 'Posted') throw new DomainError('invalid_status');
  requireReason(cmd.reason);
  const current = new Date(state.closeAt!);
  if (cmd.to.getTime() <= current.getTime()) throw new DomainError('use_close_early', 'The closing date cannot be shortened after publication; close early instead');
  return [{ type: 'ClosingDateExtended', payload: { from: state.closeAt, to: cmd.to.toISOString(), reason: cmd.reason }, reason: cmd.reason }];
}

export function decideClose(state: HiringProcessState, cmd: { now: Date; reason: 'scheduled' | 'early'; text?: string; causationId?: string }): DecidedEvent[] {
  requireExists(state);
  if (state.status !== 'Posted') throw new DomainError('invalid_status', `Cannot close while ${state.status}`);
  if (cmd.reason === 'early') requireReason(cmd.text);
  if (cmd.reason === 'scheduled' && cmd.now.getTime() < new Date(state.closeAt!).getTime()) throw new DomainError('not_due');
  const events: DecidedEvent[] = [{ type: 'PostingClosed', payload: { closedAt: cmd.now.toISOString(), reason: cmd.reason, text: cmd.text }, reason: cmd.text, causationId: cmd.causationId }];
  if (!state.screeningOpen) events.push({ type: 'ScreeningOpened', payload: {}, causationId: cmd.causationId });
  return events;
}

export function decideCancel(state: HiringProcessState, cmd: { reason: string }): DecidedEvent[] {
  requireExists(state);
  if (!['Approved', 'Scheduled', 'Posted', 'Closed', 'Draft', 'PendingApproval'].includes(state.status)) throw new DomainError('invalid_status', `Cannot cancel while ${state.status}`);
  requireReason(cmd.reason);
  return [{ type: 'ProcessCancelled', payload: { reason: cmd.reason }, reason: cmd.reason }];
}

export function decideComplete(state: HiringProcessState, cmd: { now: Date }): DecidedEvent[] {
  requireExists(state);
  if (state.status !== 'Closed') throw new DomainError('invalid_status', 'Only closed processes can be completed');
  return [
    { type: 'ProcessCompleted', payload: {} },
    { type: 'ProcessRetentionClockStarted', payload: { date: cmd.now.toISOString().slice(0, 10) } }
  ];
}

export function decideReleaseScreeningResults(state: HiringProcessState, cmd: { counts: { screenedIn: number; screenedOut: number; withdrawn: number; notScreened: number } }): DecidedEvent[] {
  requireExists(state);
  if (!state.screeningOpen) throw new DomainError('screening_not_open');
  if (cmd.counts.notScreened > 0) throw new DomainError('screening_incomplete', `${cmd.counts.notScreened} application(s) not screened`, { notScreened: cmd.counts.notScreened });
  return [{ type: 'ScreeningResultsReleased', payload: { counts: cmd.counts } }];
}

export function decidePublishSlots(state: HiringProcessState, cmd: { slots: Array<{ slotId: string; startsAt: string; endsAt: string; boardUserIds: string[] }> }): DecidedEvent[] {
  requireExists(state);
  if (!['Posted', 'Closed'].includes(state.status)) throw new DomainError('invalid_status');
  const all = [...state.slots.filter(s => s.status !== 'cancelled'), ...cmd.slots];
  for (const a of cmd.slots) {
    if (new Date(a.startsAt) >= new Date(a.endsAt)) throw new DomainError('slot_invalid');
    for (const b of all) {
      if (a === b || a.slotId === b.slotId) continue;
      const overlaps = new Date(a.startsAt) < new Date(b.endsAt) && new Date(b.startsAt) < new Date(a.endsAt);
      const sharesBoard = a.boardUserIds.some(u => b.boardUserIds.includes(u));
      if (overlaps && sharesBoard) throw new DomainError('slot_overlap', 'A slot overlaps an existing one for the same board members', { slotId: a.slotId, with: b.slotId });
    }
  }
  return [{ type: 'InterviewSlotsPublished', payload: { slots: cmd.slots } }];
}

export function decideBookSlot(state: HiringProcessState, cmd: { slotId: string; applicationId: string; previousSlotId?: string }): DecidedEvent[] {
  requireExists(state);
  const slot = state.slots.find(s => s.slotId === cmd.slotId);
  if (!slot || slot.status !== 'open') throw new DomainError('slot_no_longer_available', 'That slot is no longer available', undefined, 409);
  const events: DecidedEvent[] = [];
  if (cmd.previousSlotId) events.push({ type: 'InterviewSlotReleased', payload: { slotId: cmd.previousSlotId } });
  events.push({ type: 'InterviewSlotBooked', payload: { slotId: cmd.slotId, applicationId: cmd.applicationId } });
  return events;
}

export function decideReleaseSlot(state: HiringProcessState, cmd: { slotId: string }): DecidedEvent[] {
  requireExists(state);
  const slot = state.slots.find(s => s.slotId === cmd.slotId);
  if (!slot || slot.status !== 'booked') return [];
  return [{ type: 'InterviewSlotReleased', payload: { slotId: cmd.slotId } }];
}

export function requireReason(reason: string | undefined): void {
  if (!reason || !reason.trim()) throw new DomainError('reason_required', 'A reason is required');
}

export function acceptsApplications(state: HiringProcessState, now: Date): boolean {
  return state.status === 'Posted' && !!state.closeAt && now.getTime() < new Date(state.closeAt).getTime();
}
