import { Tx } from '@/lib/db/pool';
import { loadStream, StoredEvent } from '@/lib/db/event-store';
import { ReplayEvent, streamIds } from '@/types/events';
import { OrganizationState, replayOrganization } from '@/lib/domain/organization';
import { HiringProcessState, replayProcess } from '@/lib/domain/hiring-process';
import { ApplicationState, replayApplication, ProcessContext } from '@/lib/domain/application';
import { CandidateState, replayCandidate } from '@/lib/domain/candidate';
import { NotFoundError } from '@/lib/domain/errors';

export function toReplay(events: StoredEvent[]): ReplayEvent[] {
  return events.map(e => ({
    type: e.type, payload: e.payload, occurredAt: e.occurredAt, actor: e.metadata?.actor, role: e.metadata?.role,
    reason: e.metadata?.reason, causationId: e.metadata?.causationId, globalPosition: e.globalPosition, streamVersion: e.streamVersion
  }));
}

export async function loadOrganization(tx: Tx, tenantId: string): Promise<OrganizationState> {
  const events = await loadStream(tx, tenantId, streamIds.org(tenantId));
  const state = replayOrganization(toReplay(events));
  if (!state.exists) throw new NotFoundError('organization_not_found');
  return state;
}

export async function loadProcess(tx: Tx, tenantId: string, processId: string): Promise<{ state: HiringProcessState; version: number }> {
  const events = await loadStream(tx, tenantId, streamIds.process(processId));
  const state = replayProcess(toReplay(events));
  if (!state.exists) throw new NotFoundError('process_not_found');
  return { state, version: events.length };
}

export async function loadApplication(tx: Tx, tenantId: string, applicationId: string): Promise<{ state: ApplicationState; version: number; events: StoredEvent[] }> {
  const events = await loadStream(tx, tenantId, streamIds.application(applicationId));
  const state = replayApplication(toReplay(events));
  if (!state.exists) throw new NotFoundError('application_not_found');
  return { state, version: events.length, events };
}

export async function loadCandidate(tx: Tx, tenantId: string, candidateId: string): Promise<{ state: CandidateState; version: number }> {
  const events = await loadStream(tx, tenantId, streamIds.candidate(candidateId));
  const state = replayCandidate(toReplay(events));
  if (!state.exists) throw new NotFoundError('candidate_not_found');
  return { state, version: events.length };
}

export function buildProcessContext(process: HiringProcessState, org: OrganizationState): ProcessContext {
  return {
    processId: process.id,
    status: process.status,
    closeAt: process.closeAt,
    criteria: process.criteria,
    plan: process.plan,
    rubrics: process.rubrics,
    stages: process.stages,
    board: process.board,
    conflicts: process.conflicts,
    knockouts: process.knockouts,
    screeningOpen: process.screeningOpen,
    slots: process.slots,
    privacyNoticeVersion: org.settings.privacyNoticeVersion,
    offerApprovalRequired: org.settings.offerApprovalRequired,
    rescheduleCutoffHours: org.settings.rescheduleCutoffHours,
    disagreementThreshold: org.settings.disagreementThreshold
  };
}

export interface TenantDirectoryEntry { tenantId: string; slug: string; name: string; timeZone: string; languages: Array<{ code: 'en' | 'fr'; required: boolean }>; branding: Record<string, string>; featureFlags: Record<string, boolean>; settings: Record<string, unknown>; }

export async function resolveTenantBySlug(tx: Tx, slug: string): Promise<TenantDirectoryEntry | null> {
  const { rows } = await tx.query('select * from org_settings where slug = $1', [slug]);
  return rows[0] ? rowToEntry(rows[0]) : null;
}

export async function resolveTenantById(tx: Tx, tenantId: string): Promise<TenantDirectoryEntry | null> {
  const { rows } = await tx.query('select * from org_settings where tenant_id = $1', [tenantId]);
  return rows[0] ? rowToEntry(rows[0]) : null;
}

function rowToEntry(r: Record<string, any>): TenantDirectoryEntry {
  return { tenantId: r.tenant_id, slug: r.slug, name: r.name, timeZone: r.time_zone, languages: r.languages, branding: r.branding, featureFlags: r.feature_flags, settings: r.settings };
}
