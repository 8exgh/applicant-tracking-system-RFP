import { describe, it, expect } from 'vitest';
import { given, types, expectError } from './helpers';
import {
  replayApplication, decideStartApplication, decideSubmit, decideScreenIn, decideScreenOut, decideReverseScreening, decideMoveToStage,
  decideRecordScore, decideSubmitScores, decideRecordConsensus, decideDraftOffer, decideApproveOffer, decideAcceptOffer, decideExpireOffer,
  decideBookInterview, decideStartExam, decideRemoveDocument, decideWithdraw, ProcessContext
} from '@/lib/domain/application';
import { DEFAULT_STAGES } from '@/types/shared';

const closeAt = '2027-01-20T06:59:00.000Z'; // 2027-01-19 23:59 America/Edmonton
const ctx = (over: Partial<ProcessContext> = {}): ProcessContext => ({
  processId: 'p1', status: 'Posted', closeAt,
  criteria: [
    { code: 'E1', type: 'essential', text: { en: 'Experience developing web applications' }, order: 1 },
    { code: 'E2', type: 'essential', text: { en: 'Experience applying accessibility standards' }, order: 2 },
    { code: 'A1', type: 'asset', text: { en: 'Experience in the public sector' }, order: 3 }
  ],
  plan: [
    { criterionCode: 'E1', method: 'application' }, { criterionCode: 'E1', method: 'interview', rubricId: 'r1' },
    { criterionCode: 'E2', method: 'application' }, { criterionCode: 'E2', method: 'written_exam', rubricId: 'r1' },
    { criterionCode: 'A1', method: 'application' }
  ],
  rubrics: [{ rubricId: 'r1', name: '0-5', scale: { min: 0, max: 5 }, passMark: 3, descriptors: {} }],
  stages: DEFAULT_STAGES,
  board: [{ userId: 'marc', role: 'chair' }, { userId: 'dana', role: 'assessor' }, { userId: 'kai', role: 'assessor' }],
  conflicts: { marc: [], dana: [], kai: [] },
  knockouts: [{ code: 'K1', question: { en: 'Are you legally entitled to work in Canada?' }, expected: 'yes' }],
  screeningOpen: false, slots: [], privacyNoticeVersion: 3, offerApprovalRequired: true, rescheduleCutoffHours: 24, disagreementThreshold: 3,
  ...over
});
const started = { type: 'ApplicationStarted', payload: { applicationId: 'a1', candidateId: 'amina', processId: 'p1', locale: 'en' } };
const consent = { type: 'ConsentRecorded', payload: { noticeVersion: 3 } };
const submitted = { type: 'ApplicationSubmitted', payload: { version: 1, answers: null, answerKeys: ['E1', 'E2', 'K1'], stage: 'applied' } };
const screenedIn = { type: 'ApplicationScreenedIn', payload: { marks: { E1: 'met', E2: 'met' }, stage: 'assessment' } };
const answers = { E1: 'Built three sites', E2: 'WCAG audits', K1: 'yes' };
const before = new Date('2027-01-20T06:58:59Z');

describe('F07 Applying', () => {
  it('Start an application records the locale and source', () => {
    const ev = decideStartApplication(replayApplication([]), { applicationId: 'a1', candidateId: 'amina', locale: 'en', now: before, source: { source: 'linkedin', medium: 'social' } }, ctx());
    expect(types(ev)).toEqual(['ApplicationStarted', 'ApplicationSourceAttributed']);
    expect(ev[1].payload).toMatchObject({ source: 'linkedin', medium: 'social' });
  });

  it('Validation errors list the missing fields', () => {
    const state = replayApplication(given([started]));
    const err = expectError(() => decideSubmit(state, { now: before, plainAnswers: { E1: 'x', K1: 'yes' }, encryptedAnswers: null, consent: false }, ctx()), 'answers_incomplete');
    expect(err.details).toEqual({ fields: ['E2', 'consent'] });
  });

  it('Consent is required and versioned', () => {
    const state = replayApplication(given([started]));
    const ev = decideSubmit(state, { now: before, plainAnswers: answers, encryptedAnswers: null, consent: true }, ctx());
    expect(types(ev)).toEqual(['ConsentRecorded', 'ApplicationSubmitted']);
    expect(ev[0].payload).toEqual({ noticeVersion: 3 });
  });

  it('Submission at or after the closing time is rejected; just before is accepted', () => {
    const state = replayApplication(given([started, consent]));
    expectError(() => decideSubmit(state, { now: new Date('2027-01-20T06:59:00Z'), plainAnswers: answers, encryptedAnswers: null, consent: true }, ctx()), 'posting_closed');
    expect(types(decideSubmit(state, { now: before, plainAnswers: answers, encryptedAnswers: null, consent: true }, ctx()))).toEqual(['ApplicationSubmitted']);
  });

  it('Editing after submission before the closing time creates version 2', () => {
    const state = replayApplication(given([started, consent, submitted]));
    const ev = decideSubmit(state, { now: before, plainAnswers: answers, encryptedAnswers: null, consent: true }, ctx());
    expect(ev[0]).toMatchObject({ type: 'ApplicationResubmitted', payload: { version: 2 } });
  });

  it('Knockout answers screen out automatically at submission', () => {
    const state = replayApplication(given([started, consent]));
    const ev = decideSubmit(state, { now: before, plainAnswers: { ...answers, K1: 'no' }, encryptedAnswers: null, consent: true }, ctx());
    expect(types(ev)).toEqual(['ApplicationSubmitted', 'ApplicationScreenedOut']);
    expect(ev[1]).toMatchObject({ payload: { automatic: true, knockoutCode: 'K1' }, actorOverride: { type: 'system' } });
  });

  it('A submitted document cannot be removed', () => {
    const doc = { type: 'DocumentAttached', payload: { documentId: 'd1', kind: 'resume', filename: null, size: 10, sha256: 'x', mime: 'application/pdf' } };
    expect(types(decideRemoveDocument(replayApplication(given([started, doc])), { documentId: 'd1' }))).toEqual(['DocumentRemoved']);
    expectError(() => decideRemoveDocument(replayApplication(given([started, doc, consent, submitted])), { documentId: 'd1' }), 'application_submitted');
  });

  it('Withdrawing an application', () => {
    expect(types(decideWithdraw(replayApplication(given([started, consent, submitted])), { reason: 'Accepted another role' }))).toEqual(['ApplicationWithdrawn']);
  });
});

describe('F09 Screening', () => {
  const closed = ctx({ status: 'Closed', screeningOpen: true });
  const sub = () => replayApplication(given([started, consent, submitted]));

  it('Screening before close is blocked by default', () => {
    expectError(() => decideScreenIn(sub(), { marks: { E1: 'met', E2: 'met' } }, ctx()), 'screening_not_open');
  });

  it('Screen in requires every essential criterion to be met', () => {
    const ev = decideScreenIn(sub(), { marks: { E1: 'met', E2: 'met' } }, closed);
    expect(ev[0]).toMatchObject({ type: 'ApplicationScreenedIn', payload: { stage: 'assessment' } });
    expect(replayApplication(given([started, consent, submitted, ...ev]))).toMatchObject({ status: 'Active', stage: 'assessment' });
    expectError(() => decideScreenIn(sub(), { marks: { E1: 'met', E2: 'not_met' } }, closed), 'essential_criteria_unmet');
  });

  it('Screen out requires an unmet criterion and a substantive rationale', () => {
    expectError(() => decideScreenOut(sub(), { marks: { E1: 'met', E2: 'not_met' }, rationale: '' }, closed), 'rationale_required');
    expectError(() => decideScreenOut(sub(), { marks: { E1: 'met', E2: 'not_met' }, rationale: 'no' }, closed), 'rationale_too_short');
    expectError(() => decideScreenOut(sub(), { marks: { E1: 'met', E2: 'met' }, rationale: 'No evidence of accessibility experience' }, closed), 'unmet_criterion_required');
    expect(types(decideScreenOut(sub(), { marks: { E1: 'met', E2: 'not_met' }, rationale: 'No evidence of accessibility experience in application or résumé' }, closed))).toEqual(['ApplicationScreenedOut']);
  });

  it('Withdrawn applications are not screened', () => {
    const state = replayApplication(given([started, consent, submitted, { type: 'ApplicationWithdrawn', payload: {} }]));
    expectError(() => decideScreenIn(state, { marks: { E1: 'met', E2: 'met' } }, closed), 'application_withdrawn');
  });

  it('HR can reverse an automatic knockout', () => {
    const state = replayApplication(given([started, consent, submitted, { type: 'ApplicationScreenedOut', payload: { marks: {}, automatic: true, knockoutCode: 'K1' } }]));
    expectError(() => decideReverseScreening(state, { reason: '' }), 'reason_required');
    const ev = decideReverseScreening(state, { reason: 'Candidate contacted; answered in error' });
    expect(replayApplication(given([started, consent, submitted, { type: 'ApplicationScreenedOut', payload: { marks: {}, automatic: true } }, ...ev])).status).toBe('Submitted');
  });
});

describe('F10 Pipeline stages', () => {
  const active = () => replayApplication(given([started, consent, submitted, screenedIn]));
  const c = ctx({ status: 'Closed', screeningOpen: true });

  it('Leaving a scored stage requires consensus', () => {
    const err = expectError(() => decideMoveToStage(active(), { to: 'interview' }, c), 'consensus_required');
    expect(err.details).toEqual({ missing: ['E1', 'E2'] });
  });

  it('Moving backward requires a reason', () => {
    const state = replayApplication(given([started, consent, submitted, screenedIn, { type: 'ApplicationMovedToStage', payload: { from: 'assessment', to: 'interview' } }]));
    expectError(() => decideMoveToStage(state, { to: 'assessment' }, c), 'reason_required');
    expect(decideMoveToStage(state, { to: 'assessment', reason: 'Additional written assessment needed' }, c)[0].payload).toMatchObject({ from: 'interview', to: 'assessment' });
  });

  it('Only qualified candidates can enter Qualified', () => {
    const state = replayApplication(given([started, consent, submitted, screenedIn, { type: 'ApplicationMovedToStage', payload: { from: 'assessment', to: 'interview' } }]));
    expectError(() => decideMoveToStage(state, { to: 'qualified' }, c), 'candidate_not_qualified');
  });
});

describe('F11 Assessment and scoring', () => {
  const active = () => replayApplication(given([started, consent, submitted, screenedIn]));
  const c = ctx({ status: 'Closed', screeningOpen: true });
  const dana4 = { type: 'ScoreRecorded', payload: { assessorId: 'dana', criterionCode: 'E1', method: 'interview', score: 4, evidence: 'Led two accessible web projects' } };
  const kai3 = { type: 'ScoreRecorded', payload: { assessorId: 'kai', criterionCode: 'E1', method: 'interview', score: 3, evidence: 'One project, limited scope' } };
  const danaSub = { type: 'ScoresSubmitted', payload: { assessorId: 'dana' } };
  const kaiSub = { type: 'ScoresSubmitted', payload: { assessorId: 'kai' } };

  it('Board members declare conflicts before scoring; a conflicted assessor cannot score', () => {
    expectError(() => decideRecordScore(active(), { assessorId: 'kai', criterionCode: 'E1', method: 'interview', score: 3, evidence: 'x' }, ctx({ ...c, conflicts: { marc: [], dana: [] } })), 'conflict_declaration_required');
    expectError(() => decideRecordScore(active(), { assessorId: 'kai', criterionCode: 'E1', method: 'interview', score: 3, evidence: 'x' }, ctx({ ...c, conflicts: { marc: [], dana: [], kai: ['a1'] } })), 'conflict_of_interest');
  });

  it('Scores require evidence and must be on the rubric scale', () => {
    expectError(() => decideRecordScore(active(), { assessorId: 'dana', criterionCode: 'E1', method: 'interview', score: 4, evidence: '' }, c), 'evidence_required');
    expectError(() => decideRecordScore(active(), { assessorId: 'dana', criterionCode: 'E1', method: 'interview', score: 7, evidence: 'x' }, c), 'score_out_of_range');
  });

  it('An assessor may amend her own score before consensus', () => {
    const state = replayApplication(given([started, consent, submitted, screenedIn, dana4]));
    expectError(() => decideRecordScore(state, { assessorId: 'dana', criterionCode: 'E1', method: 'interview', score: 3, evidence: 'Re-read' }, c), 'reason_required');
    const ev = decideRecordScore(state, { assessorId: 'dana', criterionCode: 'E1', method: 'interview', score: 3, evidence: 'Re-read', reason: 'Re-read the evidence' }, c);
    expect(ev[0]).toMatchObject({ type: 'ScoreAmended', payload: { previous: 4, score: 3 } });
  });

  it('Large disagreements are flagged', () => {
    const state = replayApplication(given([started, consent, submitted, screenedIn, { type: 'ScoreRecorded', payload: { assessorId: 'dana', criterionCode: 'E2', method: 'written_exam', score: 5, evidence: 'x' } }]));
    const ev = decideRecordScore(state, { assessorId: 'kai', criterionCode: 'E2', method: 'written_exam', score: 1, evidence: 'y' }, c);
    expect(types(ev)).toEqual(['ScoreRecorded', 'DisagreementFlagged']);
  });

  it('Consensus requires all non-conflicted assessors to have submitted', () => {
    const state = replayApplication(given([started, consent, submitted, screenedIn, dana4, danaSub]));
    const err = expectError(() => decideRecordConsensus(state, { by: 'marc', criterionCode: 'E1', score: 4 }, c), 'scores_incomplete');
    expect(err.details).toEqual({ missing: ['kai'] });
    expectError(() => decideRecordConsensus(state, { by: 'dana', criterionCode: 'E1', score: 4 }, c), 'chair_required');
  });

  it('Consensus is recorded by the chair with both original scores', () => {
    const state = replayApplication(given([started, consent, submitted, screenedIn, dana4, kai3, danaSub, kaiSub]));
    const ev = decideRecordConsensus(state, { by: 'marc', criterionCode: 'E1', score: 4, note: 'Kai accepted after discussion' }, c);
    expect(ev[0]).toMatchObject({ type: 'ConsensusRecorded', payload: { pass: true, originalScores: { dana: 4, kai: 3 } } });
    expect(types(ev)).toEqual(['ConsensusRecorded']); // E2 still undecided
  });

  it('Consensus is immutable; corrections create a new consensus with a reason', () => {
    const cons = { type: 'ConsensusRecorded', payload: { criterionCode: 'E1', score: 4, pass: true, originalScores: {} } };
    const state = replayApplication(given([started, consent, submitted, screenedIn, dana4, kai3, danaSub, kaiSub, cons]));
    expectError(() => decideRecordConsensus(state, { by: 'marc', criterionCode: 'E1', score: 3 }, c), 'immutable');
    const ev = decideRecordConsensus(state, { by: 'marc', criterionCode: 'E1', score: 3, reason: 'Evidence re-checked' }, c);
    expect(ev[0].payload).toMatchObject({ supersedes: 0, score: 3 });
  });

  it('Candidate is qualified when all essential criteria pass; fails otherwise', () => {
    const e2scores = [
      { type: 'ScoreRecorded', payload: { assessorId: 'dana', criterionCode: 'E2', method: 'written_exam', score: 3, evidence: 'x' } },
      { type: 'ScoreRecorded', payload: { assessorId: 'kai', criterionCode: 'E2', method: 'written_exam', score: 2, evidence: 'y' } }
    ];
    const cons = { type: 'ConsensusRecorded', payload: { criterionCode: 'E1', score: 4, pass: true, originalScores: {} } };
    const state = replayApplication(given([started, consent, submitted, screenedIn, dana4, kai3, ...e2scores, danaSub, kaiSub, cons]));
    expect(types(decideRecordConsensus(state, { by: 'marc', criterionCode: 'E2', score: 3 }, c))).toEqual(['ConsensusRecorded', 'CandidateQualified']);
    const failed = decideRecordConsensus(state, { by: 'marc', criterionCode: 'E2', score: 2 }, c);
    expect(failed[1]).toMatchObject({ type: 'CandidateNotQualified', payload: { failedCriteria: ['E2'] } });
  });

  it('Exam cannot be started outside the window; accommodation extends time', () => {
    const state = replayApplication(given([started, consent, submitted, screenedIn, { type: 'ExamAssigned', payload: { criterionCode: 'E2', windowStart: '2027-02-01T16:00:00Z', windowEnd: '2027-02-04T00:00:00Z', limitMinutes: 90 } }]));
    expectError(() => decideStartExam(state, { now: new Date('2027-02-04T00:01:00Z'), timeMultiplier: 1 }), 'exam_window_closed');
    const ev = decideStartExam(state, { now: new Date('2027-02-02T17:00:00Z'), timeMultiplier: 1.5 });
    expect(ev[0].payload).toMatchObject({ deadline: '2027-02-02T19:15:00.000Z', limitMinutes: 135 });
  });
});

describe('F15 Offers', () => {
  const qualified = { type: 'CandidateQualified', payload: {} };
  const inQualified = { type: 'ApplicationMovedToStage', payload: { from: 'assessment', to: 'qualified' } };
  const base = [started, consent, submitted, screenedIn, qualified, inQualified];
  const c = ctx({ status: 'Closed', screeningOpen: true });

  it('Offers can only be drafted for qualified candidates', () => {
    expectError(() => decideDraftOffer(replayApplication(given([started, consent, submitted, screenedIn])), { offerId: 'o1', fields: null }), 'candidate_not_qualified');
    expect(types(decideDraftOffer(replayApplication(given(base)), { offerId: 'o1', fields: null }))).toEqual(['OfferDrafted']);
  });

  it('The requester cannot approve their own offer', () => {
    const state = replayApplication(given([...base, { type: 'OfferDrafted', payload: { offerId: 'o1', fields: null }, actor: { type: 'staff', id: 'sam' } }, { type: 'OfferApprovalRequested', payload: { offerId: 'o1', by: 'sam' } }]));
    expectError(() => decideApproveOffer(state, { offerId: 'o1', by: 'sam' }), 'cannot_approve_own_request');
    expect(types(decideApproveOffer(state, { offerId: 'o1', by: 'noor' }))).toEqual(['OfferApproved']);
  });

  it('Candidate accepts in the portal and is hired', () => {
    const state = replayApplication(given([...base, { type: 'OfferDrafted', payload: { offerId: 'o1', fields: null, startDate: '2027-04-05' } }, { type: 'OfferApproved', payload: { offerId: 'o1', by: 'sam' } }, { type: 'OfferSent', payload: { offerId: 'o1', expiresAt: '2027-03-18T06:59:00Z' } }]));
    const ev = decideAcceptOffer(state, { offerId: 'o1', typedName: 'enc', clientHash: 'h', now: new Date('2027-03-12T00:00:00Z') });
    expect(types(ev)).toEqual(['OfferAccepted', 'CandidateHired']);
    expect(replayApplication(given([...base, { type: 'OfferDrafted', payload: { offerId: 'o1', fields: null } }, { type: 'OfferSent', payload: { offerId: 'o1', expiresAt: '2027-03-18T06:59:00Z' } }, ...ev])).status).toBe('Hired');
  });

  it('Offer expires', () => {
    const state = replayApplication(given([...base, { type: 'OfferDrafted', payload: { offerId: 'o1', fields: null } }, { type: 'OfferSent', payload: { offerId: 'o1', expiresAt: '2027-03-18T06:59:00Z' } }]));
    expect(decideExpireOffer(state, { now: new Date('2027-03-18T06:00:00Z') })).toEqual([]);
    expect(types(decideExpireOffer(state, { now: new Date('2027-03-18T07:00:00Z') }))).toEqual(['OfferExpired']);
    expect(c.offerApprovalRequired).toBe(true);
  });
});

describe('F12 Interview booking', () => {
  const active = [started, consent, submitted, screenedIn, { type: 'ApplicationMovedToStage', payload: { from: 'assessment', to: 'interview' } }];
  const slots = [
    { slotId: 's1', startsAt: '2027-02-17T16:00:00Z', endsAt: '2027-02-17T16:45:00Z', boardUserIds: ['dana'], status: 'open' as const },
    { slotId: 's3', startsAt: '2027-02-18T20:00:00Z', endsAt: '2027-02-18T20:45:00Z', boardUserIds: ['dana'], status: 'open' as const }
  ];
  const c = ctx({ status: 'Closed', screeningOpen: true, slots });

  it('Candidate books a slot; reschedule past the cut-off goes through HR', () => {
    const state = replayApplication(given(active));
    const ev = decideBookInterview(state, { slotId: 's1', now: new Date('2027-02-10T16:00:00Z'), byStaff: false }, c);
    expect(ev[0]).toMatchObject({ type: 'InterviewBooked', payload: { slotId: 's1', at: '2027-02-17T16:00:00Z' } });
    const booked = replayApplication(given([...active, ...ev]));
    expectError(() => decideBookInterview(booked, { slotId: 's3', now: new Date('2027-02-17T14:00:00Z'), byStaff: false }, c), 'reschedule_cutoff_passed');
    expect(types(decideBookInterview(booked, { slotId: 's3', now: new Date('2027-02-15T16:00:00Z'), byStaff: false }, c))).toEqual(['InterviewRescheduled']);
    expect(types(decideBookInterview(booked, { slotId: 's3', now: new Date('2027-02-17T14:00:00Z'), byStaff: true, reason: 'Candidate phoned' }, c))).toEqual(['InterviewRescheduled']);
  });
});
