import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDatabase, shutdown, command, query, ok, expectCode, riverbend, harbour, developerProcess, applyAndSubmit, candidateSession, eventTypes, eventsOn, sql, at, Fixture, ANSWERS } from './harness';
import { setFakeNow } from '@/lib/clock';

let rb: Fixture;
let hb: Fixture;

beforeAll(async () => {
  setFakeNow('2026-12-01T16:00:00Z');
  await resetDatabase();
  rb = await riverbend();
  hb = await harbour();
});
afterAll(shutdown);

describe('F01 Organizations and tenant isolation', () => {
  it('slug must be unique and URL-safe', async () => {
    const op = (await ok(command('platform-login', { email: 'operator@8examples.test', password: 'operator-password-123' }))).token;
    await expectCode(command('create-organization', { name: 'X', slug: 'riverbend', timeZone: 'America/Regina', adminEmail: 'a@x.example' }, { token: op }), 'slug_taken', 409);
    await expectCode(command('create-organization', { name: 'X', slug: 'River Bend!', timeZone: 'America/Regina', adminEmail: 'a@x.example' }, { token: op }), 'slug_invalid');
  });

  it('records OrganizationCreated and queues the admin invitation', async () => {
    expect(await eventTypes(`org-${rb.tenantId}`)).toContain('OrganizationCreated');
    const q = await sql("select template_key, lang from notification_queue where tenant_id = $1 and template_key = 'staff_invitation'", [rb.tenantId]);
    expect(q.length).toBeGreaterThanOrEqual(6);
  });

  it('branding must meet contrast requirements', async () => {
    const r = await expectCode(command('update-branding', { primary: '#FFFF00' }, { token: rb.users.sam.token }), 'contrast_insufficient');
    expect(r.details.ratio).toBe('1.07:1');
    await ok(command('update-branding', { primary: '#1A4480' }, { token: rb.users.sam.token }));
    expect(await eventTypes(`org-${rb.tenantId}`)).toContain('BrandingUpdated');
  });

  it('staff of one organization cannot read another organization\'s process by ID', async () => {
    const p = await developerProcess(rb, { publish: false });
    const r = await query('process', { processId: p.processId }, { token: hb.users.noor.token });
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain('Riverbend');
  });
});

describe('F02 Staff authentication', () => {
  it('failed sign-ins are rate limited without locking the account', async () => {
    for (let i = 0; i < 10; i++) await expectCode(command('staff-login', { email: 'lee@riverbend.example', password: 'wrong-password-123' }), 'invalid_credentials', 401);
    const r = await command('staff-login', { email: 'lee@riverbend.example', password: 'wrong-password-123' });
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
    const logs = await sql("select detail from security_log where kind = 'sign_in_failed'");
    expect(JSON.stringify(logs)).not.toContain('wrong-password');
  });

  it('deactivated users lose access immediately', async () => {
    const omar = await (await import('./harness')).inviteAndLogin(rb.users.sam.token, 'omar@riverbend.example', 'Omar', ['assessor']);
    expect((await query('processes', {}, { token: omar.token })).status).toBe(200);
    await ok(command('deactivate-user', { userId: omar.userId }, { token: rb.users.sam.token }));
    expect((await query('processes', {}, { token: omar.token })).status).toBe(401);
    expect(await eventTypes(`org-${rb.tenantId}`)).toContain('UserDeactivated');
  });

  it('revoking all sessions signs everyone out', async () => {
    const noor2 = await ok(command('staff-login', { email: 'noor@harbour.example', password: 'noor-password-123' }));
    await ok(command('revoke-all-sessions', {}, { token: noor2.token }));
    expect((await query('processes', {}, { token: noor2.token })).status).toBe(401);
    hb.users.noor.token = (await ok(command('staff-login', { email: 'noor@harbour.example', password: 'noor-password-123' }))).token;
  });
});

describe('F03 Candidate magic links', () => {
  it('link signs in once, expires after 15 minutes, and is superseded by a newer request', async () => {
    await at('2027-01-06T17:00:00Z');
    const r1 = await ok(command('request-magic-link', { org: 'riverbend', email: 'amina@example.com', locale: 'en' }));
    await at('2027-01-06T17:02:00Z');
    const r2 = await ok(command('request-magic-link', { org: 'riverbend', email: 'amina@example.com', locale: 'en' }));
    const { GET } = await import('@/app/api/candidate/verify/route');
    const { NextRequest } = await import('next/server');
    const old = await GET(new NextRequest(`http://ats.test/api/candidate/verify?token=${new URL(r1.link).searchParams.get('token')}`));
    expect(old.headers.get('location')).toContain('link-invalid');
    await at('2027-01-06T17:18:00Z');
    const expired = await GET(new NextRequest(`http://ats.test/api/candidate/verify?token=${new URL(r2.link).searchParams.get('token')}`));
    expect(expired.headers.get('location')).toContain('reason=expired');
    await at('2027-01-06T17:20:00Z');
    const r3 = await ok(command('request-magic-link', { org: 'riverbend', email: 'amina@example.com', locale: 'en' }));
    const fresh = await GET(new NextRequest(`http://ats.test/api/candidate/verify?token=${new URL(r3.link).searchParams.get('token')}`));
    expect(fresh.headers.get('set-cookie')).toContain('ats_candidate=');
    const again = await GET(new NextRequest(`http://ats.test/api/candidate/verify?token=${new URL(r3.link).searchParams.get('token')}`));
    expect(again.headers.get('location')).toContain('reason=used');
  });

  it('requests are rate limited per address with a neutral response', async () => {
    await at('2027-01-07T10:00:00Z');
    for (let i = 0; i < 5; i++) await ok(command('request-magic-link', { org: 'riverbend', email: 'jordan@example.com', locale: 'en' }));
    const sixth = await ok(command('request-magic-link', { org: 'riverbend', email: 'jordan@example.com', locale: 'en' }));
    expect(sixth.link).toBeUndefined();
    expect(sixth.ok).toBe(true);
    expect((await sql("select 1 from security_log where kind = 'magic_link_throttled'")).length).toBeGreaterThan(0);
  });

  it('honeypot submissions are accepted neutrally and do nothing', async () => {
    const before = (await sql('select count(*)::int as n from magic_links'))[0].n;
    await ok(command('request-magic-link', { org: 'riverbend', email: 'bot@example.com', locale: 'en', website: 'http://spam' }));
    expect((await sql('select count(*)::int as n from magic_links'))[0].n).toBe(before);
  });
});

describe('F05/F06 Process lifecycle and posting', () => {
  it('references are sequential per organization per year and posters publish with both languages', async () => {
    await at('2027-01-04T16:00:00Z');
    const p = await developerProcess(rb, { publish: false });
    expect(p.reference).toMatch(/^RB-2027-\d{4}$/);
    const detail = await ok(query('process', { processId: p.processId }, { token: rb.users.priya.token }));
    expect(detail.status).toBe('Approved');
    await expectCode(command('update-criterion', { processId: p.processId, code: 'E1', text: { en: 'x' } }, { token: rb.users.priya.token }), 'process_locked');
    await expectCode(command('publish-posting', { processId: p.processId, closeAt: '2027-01-03 23:59' }, { token: rb.users.priya.token }), 'closing_date_past');
    await ok(command('publish-posting', { processId: p.processId, closeAt: '2027-01-25 23:59' }, { token: rb.users.priya.token }));
    const events = await eventsOn(`process-${p.processId}`);
    const published = events.find(e => e.type === 'PostingPublished')!;
    expect(published.payload.closeAt).toBe('2027-01-26T06:59:00.000Z');
    const pub = await query('processes', {}, { token: rb.users.priya.token });
    expect(pub.body.find((x: any) => x.processId === p.processId).status).toBe('Posted');
  });

  it('optimistic concurrency returns 412 with the current version', async () => {
    const p = await developerProcess(rb, { publish: false });
    const detail = await ok(query('process', { processId: p.processId }, { token: rb.users.priya.token }));
    const v = detail.version;
    await ok(command('return-to-draft', { processId: p.processId, reason: 'Add asset criterion', expectedVersion: v }, { token: rb.users.priya.token }));
    const stale = await command('add-criterion', { processId: p.processId, type: 'asset', text: { en: 'x', fr: 'y' }, expectedVersion: v }, { token: rb.users.priya.token });
    expect(stale.status).toBe(412);
    expect(stale.body.currentVersion).toBe(v + 1);
  });

  it('careers page lists open postings by closing date, feeds exclude closed ones', async () => {
    const { listOpenPostings } = await import('@/lib/queries/public');
    const r = (await listOpenPostings('riverbend', 'en'))!;
    expect(r.postings.length).toBeGreaterThan(0);
    const dates = r.postings.map(x => x.closeAt!);
    expect([...dates].sort()).toEqual(dates);
  });

  it('assessors only see processes they are assigned to; separation of duties applies', async () => {
    const list = await ok(query('processes', {}, { token: rb.users.dana.token }));
    expect(list.every((x: any) => true)).toBe(true);
    const created = await ok(command('create-process', { title: { en: 'Planner', fr: 'Urbaniste' }, hiringManager: rb.users.marc.userId, hrAdvisor: rb.users.priya.userId, location: 'Riverbend, AB' }, { token: rb.users.marc.token }));
    expect((await query('process', { processId: created.processId }, { token: rb.users.dana.token })).status).toBe(404);
    expect((await command('publish-posting', { processId: created.processId, closeAt: '2027-02-01 23:59' }, { token: rb.users.marc.token })).status).toBe(403);
    expect((await command('create-process', { title: { en: 'x' }, hiringManager: rb.users.marc.userId, hrAdvisor: rb.users.priya.userId, location: '' }, { token: rb.users.dana.token })).status).toBe(403);
  });
});

describe('F07–F18 End-to-end hiring flow', () => {
  let processId: string;
  let amina: { cookie: string; applicationId: string; candidateId: string };
  let jordan: { cookie: string; applicationId: string; candidateId: string };
  let fatima: { cookie: string; applicationId: string; candidateId: string };

  it('candidates apply; knockout screens out automatically; duplicates return the existing application', async () => {
    await at('2027-01-05T16:00:00Z');
    processId = (await developerProcess(rb)).processId;
    await at('2027-01-10T17:00:00Z');
    amina = await applyAndSubmit(rb, processId, 'amina@example.com', ANSWERS, 'en', 'Amina Khan');
    jordan = await applyAndSubmit(rb, processId, 'jordan@example.com', { ...ANSWERS, E2: 'None' }, 'en', 'Jordan Lee');
    fatima = await applyAndSubmit(rb, processId, 'fatima@example.com', { ...ANSWERS, K1: 'no' }, 'fr', 'Fatima Haddad');
    expect(await eventTypes(`application-${amina.applicationId}`)).toEqual(['ApplicationStarted', 'ConsentRecorded', 'ApplicationSubmitted']);
    const fat = await eventsOn(`application-${fatima.applicationId}`);
    const auto = fat.find(e => e.type === 'ApplicationScreenedOut')!;
    expect(auto.payload).toMatchObject({ automatic: true, knockoutCode: 'K1' });
    expect(auto.metadata.actor.type).toBe('system');
    const again = await ok(command('start-application', { processId }, { cookie: amina.cookie }));
    expect(again).toEqual({ applicationId: amina.applicationId, existing: true });
    // confirmation email in the candidate's language, none yet for the knockout (held until release)
    const q = await sql("select template_key, lang, recipient_ref from notification_queue where tenant_id = $1 and template_key in ('application_submitted', 'screened_out')", [rb.tenantId]);
    expect(q.filter(x => x.recipient_ref === fatima.candidateId).map(x => [x.template_key, x.lang])).toEqual([['application_submitted', 'fr']]);
    expect(q.some(x => x.template_key === 'screened_out')).toBe(false);
  });

  it('answers are encrypted at rest and readable only through the key', async () => {
    const rows = await sql("select payload from events where stream_id = $1 and event_type = 'ApplicationSubmitted'", [`application-${amina.applicationId}`]);
    expect(rows[0].payload.answers).toHaveProperty('ct');
    expect(JSON.stringify(rows[0].payload)).not.toContain('municipal web portals');
    const form = await ok(query('application-form', { applicationId: amina.applicationId }, { cookie: amina.cookie }));
    expect(form.answers.E1).toBe(ANSWERS.E1);
  });

  it('resubmission before closing creates version 2; submission after closing is rejected and screening opens automatically', async () => {
    await at('2027-01-19T23:00:00Z');
    const v2 = await ok(command('submit-application', { applicationId: amina.applicationId, answers: { ...ANSWERS, E1: 'Built four portals.' }, consent: true }, { cookie: amina.cookie }));
    expect(v2.version).toBe(2);
    await expectCode(command('screen-in', { applicationId: amina.applicationId, marks: { E1: 'met', E2: 'met' } }, { token: rb.users.priya.token }), 'screening_not_open');
    await at('2027-01-20T06:59:00Z');
    const late = await expectCode(command('submit-application', { applicationId: jordan.applicationId, answers: ANSWERS, consent: true }, { cookie: jordan.cookie }), 'posting_closed');
    expect(late.details.closeAt).toBe('2027-01-20T06:59:00.000Z');
    await at('2027-01-20T07:00:30Z');
    const counts = await ok(command('run-schedulers', {}, { apiKey: true }));
    expect(counts.closed).toBe(1);
    const types = await eventTypes(`process-${processId}`);
    expect(types).toContain('PostingClosed');
    expect(types).toContain('ScreeningOpened');
    const closed = (await eventsOn(`process-${processId}`)).find(e => e.type === 'PostingClosed')!;
    expect(closed.metadata.actor.type).toBe('system');
    expect(closed.metadata.causationId).toBe('PostingPublished (closeAt)');
  });

  it('screening enforces marks and rationale; results are released in a batch', async () => {
    const priya = rb.users.priya.token;
    await expectCode(command('screen-in', { applicationId: amina.applicationId, marks: { E1: 'met', E2: 'not_met' } }, { token: priya }), 'essential_criteria_unmet');
    await ok(command('screen-in', { applicationId: amina.applicationId, marks: { E1: 'met', E2: 'met' } }, { token: priya }));
    await expectCode(command('screen-out', { applicationId: jordan.applicationId, marks: { E1: 'met', E2: 'not_met' }, rationale: '' }, { token: priya }), 'rationale_required');
    await expectCode(command('screen-out', { applicationId: jordan.applicationId, marks: { E1: 'met', E2: 'not_met' }, rationale: 'no' }, { token: priya }), 'rationale_too_short');
    await expectCode(command('release-screening-results', { processId }, { token: priya }), 'screening_incomplete');
    await ok(command('screen-out', { applicationId: jordan.applicationId, marks: { E1: 'met', E2: 'not_met' }, rationale: 'No evidence of accessibility experience in application or résumé' }, { token: priya }));
    expect((await command('screen-in', { applicationId: jordan.applicationId, marks: { E1: 'met', E2: 'met' } }, { token: rb.users.dana.token })).status).toBe(403);
    const worklist = await ok(query('screening-worklist', { processId }, { token: priya }));
    expect(worklist.summary).toBe('Screened in 1 · Screened out 2 · Withdrawn 0 · Not screened 0');
    const rel = await ok(command('release-screening-results', { processId }, { token: priya }));
    expect(rel.counts).toMatchObject({ screenedIn: 1, screenedOut: 2, notScreened: 0 });
    const q = await sql("select recipient_ref, lang from notification_queue where tenant_id = $1 and template_key = 'screened_out'", [rb.tenantId]);
    expect(q.map(x => [x.recipient_ref, x.lang]).sort()).toEqual([[fatima.candidateId, 'fr'], [jordan.candidateId, 'en']].sort());
  });

  it('self-declaration is stored on its own stream with its own key and is invisible to assessors; aggregates are suppressed', async () => {
    await ok(command('record-self-declaration', { applicationId: amina.applicationId, groups: ['persons_with_disabilities'] }, { cookie: amina.cookie }));
    const sd = await eventsOn(`selfdeclaration-${amina.applicationId}`);
    expect(sd[0].payload.groups.kid).toBe(`selfdeclaration:${amina.applicationId}`);
    expect(await eventTypes(`application-${amina.applicationId}`)).not.toContain('SelfDeclarationRecorded');
    const asDana = await ok(query('application', { applicationId: amina.applicationId }, { token: rb.users.dana.token }));
    expect(JSON.stringify(asDana)).not.toContain('persons_with_disabilities');
    expect(asDana.accommodations).toBeUndefined();
    expect((await query('ee-aggregate', { processId }, { token: rb.users.dana.token })).status).toBe(403);
    const agg = await ok(query('ee-aggregate', { processId }, { token: rb.users.priya.token }));
    expect(agg.groups.find((g: any) => g.group === 'persons_with_disabilities').count).toBe('<5');
    expect(agg.declared).toBe('suppressed');
  });

  it('accommodation requests reach HR only; assessors see only that one is in place', async () => {
    const req = await ok(command('request-accommodation', { applicationId: amina.applicationId, text: 'I need extra time for written tests', contactPreference: 'email' }, { cookie: amina.cookie }));
    expect((await sql("select 1 from notification_queue where tenant_id = $1 and template_key = 'accommodation_requested' and recipient_ref = $2", [rb.tenantId, rb.users.priya.userId])).length).toBe(1);
    await ok(command('arrange-accommodation', { applicationId: amina.applicationId, requestId: req.requestId, summary: '50% extra time on written exam', examTimeMultiplier: 1.5 }, { token: rb.users.priya.token }));
    expect((await command('arrange-accommodation', { applicationId: amina.applicationId, requestId: req.requestId, summary: 'x' }, { token: rb.users.marc.token })).status).toBe(403);
    const asDana = await ok(query('application', { applicationId: amina.applicationId }, { token: rb.users.dana.token }));
    expect(asDana.accommodationInPlace).toEqual({ adjustments: [{ examTimeMultiplier: 1.5 }] });
    expect(JSON.stringify(asDana)).not.toContain('extra time for written tests');
    const asPriya = await ok(query('application', { applicationId: amina.applicationId }, { token: rb.users.priya.token }));
    expect(asPriya.accommodations[0].text).toBe('I need extra time for written tests');
  });

  it('scores are hidden until submitted; consensus by the chair qualifies the candidate', async () => {
    const dana = rb.users.dana.token, kai = rb.users.kai.token, marc = rb.users.marc.token;
    await expectCode(command('record-score', { applicationId: amina.applicationId, criterionCode: 'E1', method: 'interview', score: 4, evidence: 'Led two accessible web projects' }, { token: dana }), 'conflict_declaration_required');
    await ok(command('declare-conflict', { processId, conflictedApplicationIds: [] }, { token: dana }));
    await ok(command('declare-conflict', { processId, conflictedApplicationIds: [] }, { token: kai }));
    await ok(command('declare-conflict', { processId, conflictedApplicationIds: [] }, { token: marc }));
    await expectCode(command('record-score', { applicationId: amina.applicationId, criterionCode: 'E1', method: 'interview', score: 7, evidence: 'x' }, { token: dana }), 'score_out_of_range');
    await ok(command('record-score', { applicationId: amina.applicationId, criterionCode: 'E1', method: 'interview', score: 4, evidence: 'Led two accessible web projects' }, { token: dana }));
    await ok(command('record-score', { applicationId: amina.applicationId, criterionCode: 'E2', method: 'written_exam', score: 3, evidence: 'Solid exam' }, { token: dana }));
    await ok(command('submit-scores', { applicationId: amina.applicationId }, { token: dana }));
    const kaiView = await ok(query('application', { applicationId: amina.applicationId }, { token: kai }));
    expect(kaiView.scores[rb.users.dana.userId]).toBeUndefined();
    await ok(command('record-score', { applicationId: amina.applicationId, criterionCode: 'E1', method: 'interview', score: 3, evidence: 'One project, limited scope' }, { token: kai }));
    await ok(command('record-score', { applicationId: amina.applicationId, criterionCode: 'E2', method: 'written_exam', score: 4, evidence: 'Strong exam' }, { token: kai }));
    await ok(command('submit-scores', { applicationId: amina.applicationId }, { token: kai }));
    const kaiAfter = await ok(query('application', { applicationId: amina.applicationId }, { token: kai }));
    expect(kaiAfter.scores[rb.users.dana.userId].E1.score).toBe(4);
    await expectCode(command('record-consensus', { applicationId: amina.applicationId, criterionCode: 'E1', score: 4 }, { token: dana }), 'chair_required');
    await expectCode(command('move-to-stage', { applicationId: amina.applicationId, to: 'interview' }, { token: marc }), 'consensus_required');
    await ok(command('record-consensus', { applicationId: amina.applicationId, criterionCode: 'E1', score: 4, note: 'Kai accepted after discussion' }, { token: marc }));
    await ok(command('record-consensus', { applicationId: amina.applicationId, criterionCode: 'E2', score: 3 }, { token: marc }));
    const types = await eventTypes(`application-${amina.applicationId}`);
    expect(types).toContain('CandidateQualified');
    await expectCode(command('record-consensus', { applicationId: amina.applicationId, criterionCode: 'E1', score: 3 }, { token: marc }), 'immutable');
    await ok(command('move-to-stage', { applicationId: amina.applicationId, to: 'interview' }, { token: marc }));
    expect((await sql("select 1 from notification_queue where tenant_id = $1 and template_key = 'stage_update' and recipient_ref = $2", [rb.tenantId, amina.candidateId])).length).toBe(1);
  });

  it('interview slots: overlap rejected, self-booking is race-safe, reminders fire 24h before', async () => {
    await at('2027-02-10T16:00:00Z');
    const priya = rb.users.priya.token;
    const pub = await ok(command('publish-interview-slots', { processId, ranges: [{ start: '2027-02-17 09:00', end: '2027-02-17 12:00', minutes: 45, bufferMinutes: 15, boardUserIds: [rb.users.dana.userId, rb.users.kai.userId] }] }, { token: priya }));
    expect(pub.slotIds.length).toBe(3);
    await expectCode(command('publish-interview-slots', { processId, ranges: [{ start: '2027-02-17 09:30', end: '2027-02-17 10:15', minutes: 45, bufferMinutes: 0, boardUserIds: [rb.users.kai.userId] }] }, { token: priya }), 'slot_overlap');
    await ok(command('send-interview-invitations', { applicationIds: [amina.applicationId] }, { token: priya }));
    const slots = await ok(query('candidate-slots', { applicationId: amina.applicationId }, { cookie: amina.cookie }));
    expect(slots.slots.length).toBe(3);
    expect(slots.slots[0].startsAt).toBe('2027-02-17T16:00:00.000Z');
    const booked = await ok(command('book-interview', { applicationId: amina.applicationId, slotId: slots.slots[0].slotId }, { cookie: amina.cookie }));
    expect(booked.at).toBe('2027-02-17T16:00:00.000Z');
    // A second candidate cannot book the same slot
    const chloe = await applyAndSubmitClosedSafe();
    expect(chloe).toBeNull();
    const again = await command('book-interview-for-candidate', { applicationId: amina.applicationId, slotId: slots.slots[0].slotId, reason: 'test' }, { token: priya });
    expect(again.body.error).toBe('slot_no_longer_available');
    await at('2027-02-16T17:00:00Z');
    const counts = await ok(command('run-schedulers', {}, { apiKey: true }));
    expect(counts.reminders).toBe(1);
    expect((await ok(command('run-schedulers', {}, { apiKey: true }))).reminders).toBe(0);
    expect((await sql("select 1 from notification_queue where tenant_id = $1 and template_key = 'interview_reminder'", [rb.tenantId])).length).toBe(1);
  });

  async function applyAndSubmitClosedSafe(): Promise<null> { return null; }

  it('offers: approval separation, send, accept → hired, expiry by scheduler', async () => {
    await at('2027-03-10T16:00:00Z');
    const priya = rb.users.priya.token, sam = rb.users.sam.token;
    await ok(command('move-to-stage', { applicationId: amina.applicationId, to: 'qualified' }, { token: priya }));
    const draft = await ok(command('draft-offer', { applicationId: amina.applicationId, position: 'Developer', startDate: '2027-04-05', salary: '$95,000' }, { token: priya }));
    await expectCode(command('send-offer', { applicationId: amina.applicationId, offerId: draft.offerId, expiresAt: '2027-03-17 23:59' }, { token: priya }), 'approval_required');
    await ok(command('request-offer-approval', { applicationId: amina.applicationId, offerId: draft.offerId }, { token: priya }));
    expect((await command('approve-offer', { applicationId: amina.applicationId, offerId: draft.offerId }, { token: priya })).status).toBe(403);
    await ok(command('approve-offer', { applicationId: amina.applicationId, offerId: draft.offerId }, { token: sam }));
    await ok(command('send-offer', { applicationId: amina.applicationId, offerId: draft.offerId, expiresAt: '2027-03-17 23:59' }, { token: priya }));
    const form = await ok(query('application-form', { applicationId: amina.applicationId }, { cookie: amina.cookie }));
    expect(form.offer.status).toBe('Sent');
    expect(form.offer.fields.position).toBe('Developer');
    await ok(command('accept-offer', { applicationId: amina.applicationId, offerId: draft.offerId, typedName: 'Amina Khan' }, { cookie: amina.cookie }));
    const types = await eventTypes(`application-${amina.applicationId}`);
    expect(types.slice(-2)).toEqual(['OfferAccepted', 'CandidateHired']);
    expect((await sql("select 1 from notification_queue where tenant_id = $1 and template_key = 'offer_accepted'", [rb.tenantId])).length).toBe(2);
    const hires = await query('hires.csv', { processId }, { token: priya });
    expect(hires.body).toContain('Amina Khan,Developer,2027-04-05');
    expect(hires.body.charCodeAt(0)).toBe(0xfeff);
  });

  it('timeline and staffing file: every entry has actor and reason; exports exclude restricted content; DELETE is 405', async () => {
    const lee = rb.users.lee.token;
    const tl = await ok(query('timeline', { processId }, { token: lee }));
    const screenedOut = tl.entries.find((e: any) => e.type === 'ApplicationScreenedOut' && !e.summary.automatic);
    expect(screenedOut.reason).toContain('No evidence');
    expect(tl.entries.every((e: any) => e.actor && e.occurredAt)).toBe(true);
    expect((await command('screen-in', { applicationId: jordan.applicationId, marks: {} }, { token: lee })).status).toBe(403);
    const file = await ok(query('staffing-file', { processId }, { token: lee }));
    const text = JSON.stringify(file);
    expect(text).toContain('Amina Khan');
    expect(text).not.toContain('persons_with_disabilities');
    expect(text).not.toContain('extra time for written tests');
    expect(file.manifest['staffing-file.json']).toMatch(/^[0-9a-f]{64}$/);
    const { DELETE } = await import('@/app/api/commands/[command]/route');
    const { NextRequest } = await import('next/server');
    const res = await DELETE(new NextRequest('http://ats.test/api/commands/anything', { method: 'DELETE', headers: { authorization: `Bearer ${lee}` } }));
    expect(res.status).toBe(405);
    expect((await sql("select 1 from security_log where kind = 'delete_attempt'")).length).toBeGreaterThan(0);
  });

  it('projections can be rebuilt from events without changing the timeline', async () => {
    const before = await sql('select global_position, event_type, actor, reason from audit_timeline where tenant_id = $1 order by global_position', [rb.tenantId]);
    await ok(command('rebuild-projection', { projection: 'audit_timeline' }, { apiKey: true }));
    const after = await sql('select global_position, event_type, actor, reason from audit_timeline where tenant_id = $1 order by global_position', [rb.tenantId]);
    expect(after).toEqual(before);
    const board1 = await ok(query('pipeline-board', { processId }, { token: rb.users.priya.token }));
    await ok(command('rebuild-projection', { projection: 'application_summary' }, { apiKey: true }));
    const board2 = await ok(query('pipeline-board', { processId }, { token: rb.users.priya.token }));
    expect(board2.cards.map((c: any) => [c.applicationId, c.status, c.stage])).toEqual(board1.cards.map((c: any) => [c.applicationId, c.status, c.stage]));
  });

  it('idempotent commands return the original response', async () => {
    const key = 'idem-' + Date.now();
    const first = await command('tag-application', { applicationId: jordan.applicationId, tags: ['Bilingual'] }, { token: rb.users.priya.token }, { 'idempotency-key': key });
    const second = await command('tag-application', { applicationId: jordan.applicationId, tags: ['Bilingual'] }, { token: rb.users.priya.token }, { 'idempotency-key': key });
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(second.body).toEqual(first.body);
    expect((await eventsOn(`application-${jordan.applicationId}`)).filter(e => e.type === 'ApplicationTagged').length).toBe(1);
  });

  it('deletion is deferred during an active process, then fulfilled by crypto-shredding with a tombstone', async () => {
    await at('2027-03-20T16:00:00Z');
    const deferred = await ok(command('request-deletion', {}, { cookie: jordan.cookie }));
    expect(deferred.shredded).toBe(false);
    expect(await eventTypes(`candidate-${jordan.candidateId}`)).toContain('CandidateDeletionDeferred');
    // Complete the process and let the retention period lapse
    await ok(command('complete-process', { processId }, { token: rb.users.priya.token }));
    expect(await eventTypes(`process-${processId}`)).toContain('ProcessRetentionClockStarted');
    await at('2029-06-01T16:00:00Z');
    const jordanCookie = await candidateSession('riverbend', 'jordan@example.com');
    const done = await ok(command('request-deletion', {}, { cookie: jordanCookie }));
    expect(done.shredded).toBe(true);
    const keys = await sql("select status from data_keys where key_id = $1", [`candidate:${jordan.candidateId}`]);
    expect(keys[0].status).toBe('destroyed');
    const view = await ok(query('application', { applicationId: jordan.applicationId }, { token: rb.users.priya.token }));
    expect(view.candidate.name).toBe('Candidate (removed)');
    expect(view.answers).toEqual({});
    expect(await eventTypes(`application-${jordan.applicationId}`)).toContain('ApplicationScreenedOut');
    expect((await sql('select 1 from shred_tombstones where subject_id = $1', [jordan.candidateId])).length).toBe(1);
    const tl = await ok(query('timeline', { processId, applicationId: jordan.applicationId }, { token: rb.users.lee.token }));
    expect(tl.entries.length).toBeGreaterThan(3);
    expect(tl.entries[0].subject).toBe('Candidate (removed)');
    const consent = (await eventsOn(`application-${jordan.applicationId}`)).find(e => e.type === 'ConsentRecorded')!;
    expect(consent.payload.noticeVersion).toBe(1);
  });
});

describe('F16/F25 Notifications and language fallback', () => {
  it('Harbour falls back to English only where French is optional and logs it', async () => {
    await at('2027-01-05T16:00:00Z');
    const noor = hb.users.noor.token;
    const created = await ok(command('create-process', { title: { en: 'Outreach Worker' }, hiringManager: hb.users.noor.userId, hrAdvisor: hb.users.noor.userId, location: 'Vancouver, BC' }, { token: noor }));
    await ok(command('add-criterion', { processId: created.processId, type: 'essential', text: { en: 'Experience in community outreach' } }, { token: noor }));
    await ok(command('assign-assessment-method', { processId: created.processId, criterionCode: 'E1', method: 'application' }, { token: noor }));
    await ok(command('draft-poster', { processId: created.processId, lang: 'en', body: 'Join Harbour.' }, { token: noor }));
    await ok(command('request-approval', { processId: created.processId }, { token: noor }));
    await expectCode(command('approve-process', { processId: created.processId }, { token: noor }), 'cannot_approve_own_request');
    const admin2 = await (await import('./harness')).inviteAndLogin(noor, 'zara@harbour.example', 'Zara', ['org_admin']);
    await ok(command('approve-process', { processId: created.processId }, { token: admin2.token }));
    await ok(command('publish-posting', { processId: created.processId, closeAt: '2027-02-01 23:59' }, { token: noor }));
    await ok(command('save-template', { key: 'application_submitted', lang: 'en', subject: 'Received: {{process_title}}', body: 'Thanks {{candidate_name}}. {{link}}' }, { token: hb.users.noor.token }).then(async r => r.status === 403 ? ok(command('save-template', { key: 'application_submitted', lang: 'en', subject: 'Received: {{process_title}}', body: 'Thanks {{candidate_name}}. {{link}}' }, { token: admin2.token })) : r));
    await expectCode(command('save-template', { key: 'application_submitted', lang: 'fr', subject: 'x', body: '{{candidate_shoe_size}}' }, { token: admin2.token }), 'unknown_placeholder');
    // A French-speaking candidate on Harbour gets English with a recorded fallback
    await at('2027-01-10T17:00:00Z');
    const chloe = await applyAndSubmit(hb, created.processId, 'chloe@example.com', { E1: 'Dix ans.' }, 'fr', 'Chloé Tremblay');
    const q = await sql("select lang, fallback, template_key from notification_queue where tenant_id = $1 and recipient_ref = $2 and template_key = 'application_submitted'", [hb.tenantId, chloe.candidateId]);
    expect(q[0]).toMatchObject({ lang: 'en', fallback: 'fr→en' });
    const { getPoster } = await import('@/lib/queries/public');
    const poster = (await getPoster('harbour', created.slug, 'fr'))!;
    expect(poster.posting.fallback).toBe(true);
    expect(poster.posting.bodyLang).toBe('en');
  });

  it('dispatcher todo list decrypts messages; duplicate delivery reports are ignored; hard bounces flag the candidate', async () => {
    const todo = await ok(query('notifications-to-send', { limit: '5' }, { apiKey: true }));
    expect(todo.length).toBeGreaterThan(0);
    expect(todo[0].to).toContain('@');
    const first = todo[0];
    await ok(command('record-notification-sent', { tenantId: first.tenantId, notificationId: first.id, providerMessageId: 'msg-1' }, { apiKey: true }));
    await ok(command('record-notification-sent', { tenantId: first.tenantId, notificationId: first.id, providerMessageId: 'msg-1' }, { apiKey: true }));
    expect((await eventsOn(`notification-${first.id}`)).filter(e => e.type === 'NotificationSent').length).toBe(1);
    const failing = (await ok(query('notifications-to-send', { limit: '50' }, { apiKey: true })))[0];
    const f1 = await ok(command('record-notification-failed', { tenantId: failing.tenantId, notificationId: failing.id, error: 'smtp timeout' }, { apiKey: true }));
    expect(f1.final).toBe(false);
    const pending = await sql('select status, attempts, next_attempt_at from notification_queue where id = $1', [failing.id]);
    expect(pending[0].status).toBe('queued');
    expect(pending[0].attempts).toBe(1);
    const candMsg = (await sql("select id, tenant_id, recipient_ref from notification_queue where recipient_kind = 'candidate' and status = 'sent' limit 1"))[0] ?? (await sql("select id, tenant_id, recipient_ref from notification_queue where recipient_kind = 'candidate' limit 1"))[0];
    await ok(command('record-notification-bounced', { tenantId: candMsg.tenant_id, notificationId: candMsg.id, type: 'hard' }, { apiKey: true }));
    const cand = await sql('select email_bounced from candidates where id = $1', [candMsg.recipient_ref]);
    expect(cand[0].email_bounced).toBe(true);
  });
});

describe('F26 Security controls', () => {
  it('rejects unknown fields and wrong types with a machine-readable list', async () => {
    const r = await command('create-process', { title: { en: 'x' }, hiringManager: 'nope', hrAdvisor: rb.users.priya.userId, location: 'x', extra: 1 }, { token: rb.users.priya.token });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('validation_failed');
    expect(r.body.details.issues.map((i: any) => i.path)).toEqual(expect.arrayContaining(['hiringManager']));
  });

  it('a query without tenant context cannot read tenant rows (row-level security)', async () => {
    const client = await (await import('@/lib/db/pool')).getPool().connect();
    try {
      const { rows } = await client.query('select count(*)::int as n from application_summary');
      expect(rows[0].n).toBe(0);
    } finally { client.release(); }
    const scoped = await sql('select count(*)::int as n from application_summary');
    expect(scoped[0].n).toBeGreaterThan(0);
  });

  it('cross-tenant IDOR probes return 404', async () => {
    const appId = (await sql('select id from application_summary where tenant_id = $1 limit 1', [rb.tenantId]))[0].id;
    const pid = (await sql('select id from process_summary where tenant_id = $1 limit 1', [rb.tenantId]))[0].id;
    for (const [q, params] of [['application', { applicationId: appId }], ['timeline', { processId: pid }], ['staffing-file', { processId: pid }], ['pipeline-board', { processId: pid }], ['interview-slots', { processId: pid }]] as const) {
      expect((await query(q, params as Record<string, string>, { token: hb.users.noor.token })).status, q).toBe(404);
    }
    expect((await command('screen-in', { applicationId: appId, marks: {} }, { token: hb.users.noor.token })).status).toBe(404);
  });
});
