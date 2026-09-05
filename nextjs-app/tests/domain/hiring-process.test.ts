import { describe, it, expect } from 'vitest';
import { given, types, expectError } from './helpers';
import {
  replayProcess, decideAddCriterion, decideRequestApproval, decideApprove, decideUpdateCriterion, decideReturnToDraft, decidePublish,
  decideExtend, decideClose, decideCancel, decideReorderCriteria, decideAssignMethod, decidePublishSlots, decideBookSlot, decideSchedule, decideComplete
} from '@/lib/domain/hiring-process';
import { DEFAULT_STAGES } from '@/types/shared';

const org = { languages: [{ code: 'en' as const, required: true }, { code: 'fr' as const, required: true }], timeZone: 'America/Edmonton', rollingScreening: false };
const createdEvent = { type: 'HiringProcessCreated', payload: { processId: 'p1', reference: 'RB-2026-0002', slug: 'planner-rb-2026-0002', title: { en: 'Planner', fr: 'Urbaniste' }, hiringManager: 'marc', hrAdvisor: 'priya', location: 'Riverbend, AB', stages: DEFAULT_STAGES } };
const rubric = { type: 'RubricDefined', payload: { rubricId: 'r1', name: '0-5', scale: { min: 0, max: 5 }, passMark: 3, descriptors: { en: 'levels', fr: 'niveaux' } } };
const e1 = { type: 'MeritCriterionAdded', payload: { code: 'E1', type: 'essential', text: { en: 'Experience in land-use planning', fr: 'Expérience en aménagement' }, order: 1 } };
const e2 = { type: 'MeritCriterionAdded', payload: { code: 'E2', type: 'essential', text: { en: 'Experience writing reports', fr: 'Rédaction' }, order: 2 } };
const planE1 = { type: 'AssessmentMethodAssigned', payload: { criterionCode: 'E1', method: 'application' } };
const planE2 = { type: 'AssessmentMethodAssigned', payload: { criterionCode: 'E2', method: 'interview', rubricId: 'r1' } };
const posterEn = { type: 'PosterDrafted', payload: { lang: 'en', body: 'Join us' } };
const posterFr = { type: 'PosterDrafted', payload: { lang: 'fr', body: 'Joignez-vous' } };
const requested = { type: 'ApprovalRequested', payload: { by: 'marc' } };
const approved = { type: 'ProcessApproved', payload: { by: 'sam', comment: 'OK to post' } };
const now = new Date('2027-01-04T16:00:00Z');
const closeAt = new Date('2027-01-26T06:59:00Z');
const published = { type: 'PostingPublished', payload: { version: 1, publishedAt: now.toISOString(), closeAt: closeAt.toISOString() } };

describe('F05 Hiring process lifecycle', () => {
  it('Adding merit criteria of each type codes them E1, A1, O1, R1, C1', () => {
    let state = replayProcess(given([createdEvent]));
    const codes: string[] = [];
    for (const type of ['essential', 'essential', 'asset', 'organizational_need', 'operational_requirement', 'condition_of_employment'] as const) {
      const ev = decideAddCriterion(state, { type, text: { en: 'x', fr: 'y' } });
      codes.push(ev[0].payload.code as string);
      state = replayProcess(given([createdEvent, ...codes.map((c, i) => ({ type: 'MeritCriterionAdded', payload: { code: c, type: ['essential', 'essential', 'asset', 'organizational_need', 'operational_requirement', 'condition_of_employment'][i], text: {}, order: i + 1 } }))]));
    }
    expect(codes).toEqual(['E1', 'E2', 'A1', 'O1', 'R1', 'C1']);
  });

  it('Criteria can be reordered and are recoded', () => {
    const state = replayProcess(given([createdEvent, e1, e2, planE1]));
    const ev = decideReorderCriteria(state, { codes: ['E2', 'E1'] });
    const criteria = ev[0].payload.criteria as Array<{ code: string; text: { en: string } }>;
    expect(criteria[0]).toMatchObject({ code: 'E1', text: { en: 'Experience writing reports' } });
    expect(criteria[1]).toMatchObject({ code: 'E2', text: { en: 'Experience in land-use planning' } });
    expect((ev[0].payload.plan as Array<{ criterionCode: string }>)[0].criterionCode).toBe('E2');
  });

  it('Every essential criterion needs an assessment method before approval can be requested', () => {
    const state = replayProcess(given([createdEvent, e1, e2, planE1]));
    const err = expectError(() => decideRequestApproval(state, { by: 'marc' }), 'assessment_plan_incomplete');
    expect(err.details).toEqual({ missing: ['E2'] });
  });

  it('Every scored method needs a rubric', () => {
    const state = replayProcess(given([createdEvent, e1, e2, planE1, { type: 'AssessmentMethodAssigned', payload: { criterionCode: 'E2', method: 'interview' } }]));
    const err = expectError(() => decideRequestApproval(state, { by: 'marc' }), 'rubric_missing');
    expect(err.details).toEqual({ missing: ['E2: interview'] });
  });

  it('Approver approves; separation of duties applies', () => {
    const state = replayProcess(given([createdEvent, rubric, e1, e2, planE1, planE2, requested]));
    expectError(() => decideApprove(state, { by: 'marc' }), 'cannot_approve_own_request');
    const ev = decideApprove(state, { by: 'sam', comment: 'OK to post' });
    expect(ev[0]).toMatchObject({ type: 'ProcessApproved', payload: { comment: 'OK to post' } });
  });

  it('Approved process is locked; returning to draft requires a reason and re-approval', () => {
    const state = replayProcess(given([createdEvent, rubric, e1, e2, planE1, planE2, requested, approved]));
    expectError(() => decideUpdateCriterion(state, { code: 'E1', text: { en: 'changed' } }), 'process_locked');
    expectError(() => decideReturnToDraft(state, { by: 'priya', reason: '' }), 'reason_required');
    const back = replayProcess(given([createdEvent, rubric, e1, e2, planE1, planE2, requested, approved, ...decideReturnToDraft(state, { by: 'priya', reason: 'Add asset criterion' })]));
    expect(back.status).toBe('Draft');
    expectError(() => decidePublish(back, { closeAt, now }, org), 'approval_required');
  });

  it('Cancellation requires a reason', () => {
    const state = replayProcess(given([createdEvent, rubric, e1, e2, planE1, planE2, requested, approved, posterEn, posterFr, published]));
    expectError(() => decideCancel(state, { reason: '' }), 'reason_required');
    expect(types(decideCancel(state, { reason: 'Position eliminated' }))).toEqual(['ProcessCancelled']);
  });

  it('Completing a process starts the retention clock', () => {
    const state = replayProcess(given([createdEvent, rubric, e1, e2, planE1, planE2, requested, approved, posterEn, posterFr, published, { type: 'PostingClosed', payload: { closedAt: closeAt.toISOString(), reason: 'scheduled' } }]));
    expect(types(decideComplete(state, { now }))).toEqual(['ProcessCompleted', 'ProcessRetentionClockStarted']);
  });
});

describe('F06 Posting', () => {
  const approvedState = () => replayProcess(given([createdEvent, rubric, e1, e2, planE1, planE2, requested, approved, posterEn, posterFr]));

  it('Publish a poster', () => {
    const ev = decidePublish(approvedState(), { closeAt, now }, org);
    expect(ev[0]).toMatchObject({ type: 'PostingPublished', payload: { version: 1, closeAt: '2027-01-26T06:59:00.000Z' } });
  });

  it('Publishing requires all required languages', () => {
    const state = replayProcess(given([createdEvent, rubric, e1, e2, planE1, planE2, requested, approved, posterEn]));
    const err = expectError(() => decidePublish(state, { closeAt, now }, org), 'missing_language_content');
    expect(err.details).toEqual({ missing: ['fr: poster body'] });
  });

  it('Publishing does not require optional languages', () => {
    const state = replayProcess(given([createdEvent, rubric, e1, e2, planE1, planE2, requested, approved, posterEn]));
    const harbour = { ...org, languages: [{ code: 'en' as const, required: true }, { code: 'fr' as const, required: false }] };
    expect(types(decidePublish(state, { closeAt, now }, harbour))).toEqual(['PostingPublished']);
  });

  it('Closing date must be in the future', () => {
    expectError(() => decidePublish(approvedState(), { closeAt: new Date('2027-01-04T06:59:00Z'), now }, org), 'closing_date_past');
  });

  it('Publishing requires approval', () => {
    const draft = replayProcess(given([createdEvent, rubric, e1, e2, planE1, planE2, posterEn, posterFr]));
    expectError(() => decidePublish(draft, { closeAt, now }, org), 'approval_required');
  });

  it('Scheduled publishing', () => {
    const ev = decideSchedule(approvedState(), { publishAt: new Date('2027-01-06T15:00:00Z'), closeAt, now }, org);
    expect(types(ev)).toEqual(['PostingScheduled']);
  });

  it('Closing date cannot be shortened after publication', () => {
    const state = replayProcess(given([createdEvent, rubric, e1, e2, planE1, planE2, requested, approved, posterEn, posterFr, published]));
    expectError(() => decideExtend(state, { to: new Date('2027-01-20T06:59:00Z'), reason: 'x', now }), 'use_close_early');
    const ev = decideExtend(state, { to: new Date('2027-02-02T06:59:00Z'), reason: 'Low volume', now });
    expect(ev[0].payload).toMatchObject({ from: closeAt.toISOString(), to: '2027-02-02T06:59:00.000Z', reason: 'Low volume' });
  });

  it('Automatic close at the closing time opens screening', () => {
    const state = replayProcess(given([createdEvent, rubric, e1, e2, planE1, planE2, requested, approved, posterEn, posterFr, published]));
    expectError(() => decideClose(state, { now: new Date('2027-01-25T06:59:00Z'), reason: 'scheduled' }), 'not_due');
    const ev = decideClose(state, { now: new Date('2027-01-26T07:00:00Z'), reason: 'scheduled', causationId: 'PostingPublished' });
    expect(types(ev)).toEqual(['PostingClosed', 'ScreeningOpened']);
    expect(ev[0].payload).toMatchObject({ reason: 'scheduled' });
  });

  it('Closing early records the reason', () => {
    const state = replayProcess(given([createdEvent, rubric, e1, e2, planE1, planE2, requested, approved, posterEn, posterFr, published]));
    expectError(() => decideClose(state, { now, reason: 'early', text: '' }), 'reason_required');
    expect(decideClose(state, { now, reason: 'early', text: 'Sufficient applications' })[0].payload).toMatchObject({ reason: 'early', text: 'Sufficient applications' });
  });
});

describe('F12 Interview slots', () => {
  const posted = () => replayProcess(given([createdEvent, rubric, e1, e2, planE1, planE2, requested, approved, posterEn, posterFr, published]));

  it('Slots cannot overlap for the same board', () => {
    const state = replayProcess(given([...given([createdEvent, rubric, e1, e2, planE1, planE2, requested, approved, posterEn, posterFr, published]), { type: 'InterviewSlotsPublished', payload: { slots: [{ slotId: 's1', startsAt: '2027-02-17T16:00:00Z', endsAt: '2027-02-17T16:45:00Z', boardUserIds: ['dana', 'kai'] }] } }]));
    expectError(() => decidePublishSlots(state, { slots: [{ slotId: 's2', startsAt: '2027-02-17T16:30:00Z', endsAt: '2027-02-17T17:15:00Z', boardUserIds: ['kai'] }] }), 'slot_overlap');
    expect(types(decidePublishSlots(state, { slots: [{ slotId: 's3', startsAt: '2027-02-17T16:30:00Z', endsAt: '2027-02-17T17:15:00Z', boardUserIds: ['marc'] }] }))).toEqual(['InterviewSlotsPublished']);
  });

  it('Two candidates cannot book the same slot', () => {
    const base = [...given([createdEvent, rubric, e1, e2, planE1, planE2, requested, approved, posterEn, posterFr, published]), ...given([{ type: 'InterviewSlotsPublished', payload: { slots: [{ slotId: 's1', startsAt: '2027-02-17T16:00:00Z', endsAt: '2027-02-17T16:45:00Z', boardUserIds: ['dana'] }] } }])];
    const state = replayProcess(base);
    const booked = decideBookSlot(state, { slotId: 's1', applicationId: 'chloe' });
    expect(types(booked)).toEqual(['InterviewSlotBooked']);
    const after = replayProcess([...base, ...given(booked)]);
    expectError(() => decideBookSlot(after, { slotId: 's1', applicationId: 'amina' }), 'slot_no_longer_available');
    expect(posted().slots).toEqual([]);
  });
});
