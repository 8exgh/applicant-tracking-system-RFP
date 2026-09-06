import { randomUUID } from 'crypto';
import { executeCommand, CommandEnv } from './execute';
import { loadOrganization, loadProcess } from '@/lib/app/context';
import { streamIds } from '@/types/events';
import { AssessmentMethod, BoardMember, CriterionType, LangMap, Locale, Rubric, Stage } from '@/types/shared';
import {
  decideCreateProcess, decideUpdateDetails, decideAddCriterion, decideUpdateCriterion, decideRemoveCriterion, decideReorderCriteria, decideAssignMethod, decideRemoveMethod,
  decideDefineRubric, decideSetStages, decideSetBoard, decideDeclareConflict, decideAddKnockout, decideRemoveKnockout, decideDraftPoster, decideRequestApproval, decideApprove,
  decideReject, decideReturnToDraft, decidePublish, decideSchedule, decideAmend, decideExtend, decideClose, decideCancel, decideComplete, decideReleaseScreeningResults,
  decidePublishSlots, HiringProcessState, ProcessOrgContext
} from '@/lib/domain/hiring-process';
import { OrganizationState } from '@/lib/domain/organization';
import { slugify } from '@/lib/domain/lang';
import { now, zonedTimeToUtc } from '@/lib/clock';
import { DomainError, ConcurrencyError } from '@/lib/domain/errors';
import { Tx } from '@/lib/db/pool';

function orgCtx(org: OrganizationState): ProcessOrgContext {
  return { languages: org.languages, timeZone: org.timeZone, rollingScreening: !!org.featureFlags.rolling_screening };
}

// References are sequential per organization per year (F05): RB-2027-0001
async function nextReference(tx: Tx, tenantId: string, prefix: string, at: Date, timeZone: string): Promise<string> {
  const year = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(at);
  const { rows } = await tx.query("select reference from process_summary where tenant_id = $1 and reference like $2 order by reference desc limit 1", [tenantId, `${prefix}-${year}-%`]);
  const last = rows[0]?.reference ? parseInt(rows[0].reference.split('-').pop(), 10) : 0;
  return `${prefix}-${year}-${String(last + 1).padStart(4, '0')}`;
}

export interface Expected { expectedVersion?: number }

function expected(version: number, e?: Expected): number {
  if (e?.expectedVersion !== undefined && e.expectedVersion !== version) throw new ConcurrencyError(version);
  return version;
}

export async function createProcess(env: CommandEnv, cmd: { title: LangMap; hiringManager: string; hrAdvisor: string; location: string; classification?: string; cloneOf?: string }): Promise<{ processId: string; reference: string; slug: string }> {
  return executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    for (const id of [cmd.hiringManager, cmd.hrAdvisor]) if (!org.users[id]) throw new DomainError('user_not_found', 'Hiring manager and HR advisor must be users of the organization', undefined, 400);
    const processId = randomUUID();
    const at = now();
    const reference = await nextReference(tx, env.tenantId, org.settings.referencePrefix, at, org.timeZone);
    const title = cmd.title.en || cmd.title.fr || '';
    const slug = `${slugify(title)}-${reference.toLowerCase()}`;
    let clone: Parameters<typeof decideCreateProcess>[1]['clone'];
    let stages: Stage[] = org.stageTemplate;
    if (cmd.cloneOf) {
      const { state: source } = await loadProcess(tx, env.tenantId, cmd.cloneOf);
      clone = { criteria: source.criteria, plan: source.plan, rubrics: source.rubrics, knockouts: source.knockouts, poster: source.poster };
      stages = source.stages;
    }
    await append(streamIds.process(processId), 'none', decideCreateProcess({ exists: false } as HiringProcessState, { processId, reference, slug, title: cmd.title, hiringManager: cmd.hiringManager, hrAdvisor: cmd.hrAdvisor, location: cmd.location, classification: cmd.classification, stages, clone }));
    return { processId, reference, slug };
  });
}

type Loaded = { state: HiringProcessState; version: number; org: OrganizationState };

async function load(tx: Tx, env: CommandEnv, processId: string): Promise<Loaded> {
  const org = await loadOrganization(tx, env.tenantId);
  const { state, version } = await loadProcess(tx, env.tenantId, processId);
  return { state, version, org };
}

function simple<TCmd>(decide: (l: Loaded, cmd: TCmd) => ReturnType<typeof decideUpdateDetails>) {
  return async (env: CommandEnv, processId: string, cmd: TCmd & Expected): Promise<{ version: number }> => {
    return executeCommand(env, async (tx, append) => {
      const l = await load(tx, env, processId);
      const stored = await append(streamIds.process(processId), expected(l.version, cmd), decide(l, cmd));
      return { version: stored.length ? stored[stored.length - 1].streamVersion : l.version };
    });
  };
}

export const updateDetails = simple<{ title?: LangMap; hiringManager?: string; hrAdvisor?: string; location?: string; classification?: string }>((l, cmd) => decideUpdateDetails(l.state, cmd));
export const addCriterion = simple<{ type: CriterionType; text: LangMap }>((l, cmd) => decideAddCriterion(l.state, cmd));
export const updateCriterion = simple<{ code: string; text: LangMap }>((l, cmd) => decideUpdateCriterion(l.state, cmd));
export const removeCriterion = simple<{ code: string }>((l, cmd) => decideRemoveCriterion(l.state, cmd));
export const reorderCriteria = simple<{ codes: string[] }>((l, cmd) => decideReorderCriteria(l.state, cmd));
export const assignMethod = simple<{ criterionCode: string; method: AssessmentMethod; rubricId?: string }>((l, cmd) => decideAssignMethod(l.state, cmd));
export const removeMethod = simple<{ criterionCode: string; method: AssessmentMethod }>((l, cmd) => decideRemoveMethod(l.state, cmd));
export const defineRubric = simple<Rubric>((l, cmd) => decideDefineRubric(l.state, cmd, orgCtx(l.org)));
export const setBoard = simple<{ board: BoardMember[] }>((l, cmd) => {
  for (const b of cmd.board) if (!l.org.users[b.userId]) throw new DomainError('user_not_found', 'Board members must be users of the organization', undefined, 400);
  return decideSetBoard(l.state, cmd);
});
export const declareConflict = simple<{ userId: string; conflictedApplicationIds: string[] }>((l, cmd) => decideDeclareConflict(l.state, cmd));
export const addKnockout = simple<{ question: LangMap; expected: 'yes' | 'no' }>((l, cmd) => decideAddKnockout(l.state, cmd));
export const removeKnockout = simple<{ code: string }>((l, cmd) => decideRemoveKnockout(l.state, cmd));
export const draftPoster = simple<{ lang: Locale; body: string }>((l, cmd) => decideDraftPoster(l.state, cmd));
export const requestApproval = simple<{ by: string }>((l, cmd) => decideRequestApproval(l.state, cmd));
export const approveProcess = simple<{ by: string; comment?: string }>((l, cmd) => decideApprove(l.state, cmd));
export const rejectProcess = simple<{ by: string; reason: string }>((l, cmd) => decideReject(l.state, cmd));
export const returnToDraft = simple<{ by: string; reason: string }>((l, cmd) => decideReturnToDraft(l.state, cmd));
export const cancelProcess = simple<{ reason: string }>((l, cmd) => decideCancel(l.state, cmd));
export const completeProcess = simple<Record<string, never>>((l) => decideComplete(l.state, { now: now() }));
export const amendPoster = simple<{ poster: LangMap; reason: string }>((l, cmd) => decideAmend(l.state, cmd, orgCtx(l.org)));

export async function setStages(env: CommandEnv, processId: string, cmd: { stages: Stage[] } & Expected): Promise<{ version: number }> {
  return executeCommand(env, async (tx, append) => {
    const l = await load(tx, env, processId);
    const { rows } = await tx.query("select distinct stage from application_summary where tenant_id = $1 and process_id = $2 and status in ('Submitted', 'Active') and stage is not null", [env.tenantId, processId]);
    const stored = await append(streamIds.process(processId), expected(l.version, cmd), decideSetStages(l.state, { stages: cmd.stages, stagesInUse: rows.map(r => r.stage) }, orgCtx(l.org)));
    return { version: stored.length ? stored[stored.length - 1].streamVersion : l.version };
  });
}

// Closing times arrive as wall-clock strings interpreted in the organization's zone (F01)
function toInstant(value: string, timeZone: string): Date {
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) return new Date(value);
  return zonedTimeToUtc(value, timeZone);
}

export const publishPosting = simple<{ closeAt: string }>((l, cmd) => decidePublish(l.state, { closeAt: toInstant(cmd.closeAt, l.org.timeZone), now: now() }, orgCtx(l.org)));
export const schedulePosting = simple<{ publishAt: string; closeAt: string }>((l, cmd) => decideSchedule(l.state, { publishAt: toInstant(cmd.publishAt, l.org.timeZone), closeAt: toInstant(cmd.closeAt, l.org.timeZone), now: now() }, orgCtx(l.org)));
export const extendClosing = simple<{ closeAt: string; reason: string }>((l, cmd) => decideExtend(l.state, { to: toInstant(cmd.closeAt, l.org.timeZone), reason: cmd.reason, now: now() }));
export const closeEarly = simple<{ reason: string }>((l, cmd) => decideClose(l.state, { now: now(), reason: 'early', text: cmd.reason }));

export async function releaseScreeningResults(env: CommandEnv, processId: string, cmd: Expected): Promise<{ counts: Record<string, number> }> {
  return executeCommand(env, async (tx, append) => {
    const l = await load(tx, env, processId);
    const { rows } = await tx.query('select status, count(*)::int as n from application_summary where tenant_id = $1 and process_id = $2 group by status', [env.tenantId, processId]);
    const n = (s: string) => rows.find(r => r.status === s)?.n ?? 0;
    const counts = { screenedIn: n('Active') + n('NotQualified') + n('Hired'), screenedOut: n('ScreenedOut'), withdrawn: n('Withdrawn'), notScreened: n('Submitted') };
    await append(streamIds.process(processId), expected(l.version, cmd), decideReleaseScreeningResults(l.state, { counts }));
    return { counts };
  });
}

export interface SlotRange { start: string; end: string; minutes: number; bufferMinutes: number; boardUserIds: string[]; }

// Ranges arrive as wall-clock times in the organization's zone; they are
// converted to instants before slots are cut (never parsed in server-local time).
export async function publishInterviewSlots(env: CommandEnv, processId: string, cmd: { ranges: SlotRange[] } & Expected): Promise<{ slotIds: string[] }> {
  return executeCommand(env, async (tx, append) => {
    const l = await load(tx, env, processId);
    const instants = cmd.ranges.map(r => ({ ...r, start: toInstant(r.start, l.org.timeZone).toISOString(), end: toInstant(r.end, l.org.timeZone).toISOString() }));
    const slots = expandSlotRanges(instants).map(s => ({ slotId: randomUUID(), ...s }));
    if (!slots.length) throw new DomainError('slot_invalid', 'No slots fit the ranges', undefined, 400);
    await append(streamIds.process(processId), expected(l.version, cmd), decidePublishSlots(l.state, { slots }));
    return { slotIds: slots.map(s => s.slotId) };
  });
}

// Cuts slots of `minutes` with `bufferMinutes` between them from ISO instant ranges (F12)
export function expandSlotRanges(ranges: SlotRange[]): Array<{ startsAt: string; endsAt: string; boardUserIds: string[] }> {
  const out: Array<{ startsAt: string; endsAt: string; boardUserIds: string[] }> = [];
  for (const r of ranges) {
    let cursor = new Date(r.start).getTime();
    const end = new Date(r.end).getTime();
    while (cursor + r.minutes * 60_000 <= end) {
      out.push({ startsAt: new Date(cursor).toISOString(), endsAt: new Date(cursor + r.minutes * 60_000).toISOString(), boardUserIds: r.boardUserIds });
      cursor += (r.minutes + r.bufferMinutes) * 60_000;
    }
  }
  return out;
}

export async function cloneProcess(env: CommandEnv, processId: string, cmd: { title: LangMap }): Promise<{ processId: string; reference: string; slug: string }> {
  const { state } = await executeCommand(env, async tx => loadProcess(tx, env.tenantId, processId));
  return createProcess(env, { title: cmd.title, hiringManager: state.hiringManagerId, hrAdvisor: state.hrAdvisorId, location: state.location, classification: state.classification, cloneOf: processId });
}
