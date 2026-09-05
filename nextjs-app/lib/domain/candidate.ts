import { DomainError } from './errors';
import { ReplayEvent, DecidedEvent } from '@/types/events';
import { Locale } from '@/types/shared';

export interface CandidateState {
  exists: boolean;
  id: string;
  email: unknown;          // envelope
  locale: Locale;
  profile: unknown;        // envelope
  marketingOptOut: boolean;
  pendingEmailChange?: unknown;
  exportRequestedAt?: string;
  exportCompletedAt?: string;
  deletionRequestedAt?: string;
  deletionDeferredUntil?: string;
  shredded: boolean;
  version: number;
}

export function initialCandidateState(): CandidateState {
  return { exists: false, id: '', email: null, locale: 'en', profile: null, marketingOptOut: false, shredded: false, version: 0 };
}

export function evolveCandidate(state: CandidateState, event: ReplayEvent): CandidateState {
  const p = event.payload as Record<string, any>;
  const at = event.occurredAt.toISOString();
  const s = { ...state, version: state.version + 1 };
  switch (event.type) {
    case 'CandidateRegistered': return { ...s, exists: true, id: p.candidateId, email: p.email, locale: p.locale ?? 'en' };
    case 'CandidateProfileUpdated': return { ...s, profile: p.fields };
    case 'CandidateLocaleChanged': return { ...s, locale: p.locale };
    case 'CandidateEmailChangeRequested': return { ...s, pendingEmailChange: p.newEmail };
    case 'CandidateEmailChangeConfirmed': return { ...s, email: p.newEmail, pendingEmailChange: undefined };
    case 'MarketingOptOutSet': return { ...s, marketingOptOut: !!p.value };
    case 'CandidateDataExportRequested': return { ...s, exportRequestedAt: at };
    case 'CandidateDataExportCompleted': return { ...s, exportCompletedAt: at };
    case 'CandidateDeletionRequested': return { ...s, deletionRequestedAt: at };
    case 'CandidateDeletionDeferred': return { ...s, deletionDeferredUntil: p.until };
    case 'CandidateDataShredded': return { ...s, shredded: true, email: null, profile: null };
    default: return s;
  }
}

export function replayCandidate(events: ReplayEvent[]): CandidateState {
  return events.reduce(evolveCandidate, initialCandidateState());
}

export function decideRegisterCandidate(state: CandidateState, cmd: { candidateId: string; email: unknown; locale: Locale }): DecidedEvent[] {
  if (state.exists) throw new DomainError('candidate_exists');
  return [{ type: 'CandidateRegistered', payload: { candidateId: cmd.candidateId, email: cmd.email, locale: cmd.locale } }];
}

export function decideUpdateProfile(state: CandidateState, cmd: { fields: unknown; changed: string[] }): DecidedEvent[] {
  requireLive(state);
  return [{ type: 'CandidateProfileUpdated', payload: { fields: cmd.fields, changed: cmd.changed } }];
}

export function decideChangeLocale(state: CandidateState, cmd: { locale: Locale }): DecidedEvent[] {
  requireLive(state);
  if (state.locale === cmd.locale) return [];
  return [{ type: 'CandidateLocaleChanged', payload: { locale: cmd.locale } }];
}

export function decideRequestEmailChange(state: CandidateState, cmd: { newEmail: unknown }): DecidedEvent[] {
  requireLive(state);
  return [{ type: 'CandidateEmailChangeRequested', payload: { newEmail: cmd.newEmail } }];
}

export function decideConfirmEmailChange(state: CandidateState, cmd: { newEmail: unknown }): DecidedEvent[] {
  requireLive(state);
  if (!state.pendingEmailChange) throw new DomainError('no_pending_change');
  return [{ type: 'CandidateEmailChangeConfirmed', payload: { newEmail: cmd.newEmail } }];
}

export function decideSetMarketingOptOut(state: CandidateState, cmd: { value: boolean }): DecidedEvent[] {
  requireLive(state);
  if (state.marketingOptOut === cmd.value) return [];
  return [{ type: 'MarketingOptOutSet', payload: { value: cmd.value } }];
}

export function decideRequestExport(state: CandidateState): DecidedEvent[] {
  requireLive(state);
  return [{ type: 'CandidateDataExportRequested', payload: {} }];
}

export function decideCompleteExport(state: CandidateState, cmd: { exportId: string; expiresAt: string }): DecidedEvent[] {
  requireLive(state);
  return [{ type: 'CandidateDataExportCompleted', payload: { exportId: cmd.exportId, expiresAt: cmd.expiresAt } }];
}

// Deletion is fulfilled now, or deferred to the applicable retention date
// while any of the candidate's applications is in an active process (F18).
export function decideRequestDeletion(state: CandidateState, cmd: { activeProcesses: Array<{ processId: string; retentionUntil: string }> }): DecidedEvent[] {
  requireLive(state);
  const events: DecidedEvent[] = [{ type: 'CandidateDeletionRequested', payload: {} }];
  if (cmd.activeProcesses.length) {
    const until = cmd.activeProcesses.map(p => p.retentionUntil).sort().reverse()[0];
    events.push({ type: 'CandidateDeletionDeferred', payload: { until, reason: 'active_process', processIds: cmd.activeProcesses.map(p => p.processId) } });
  }
  return events;
}

export function decideRecordShredded(state: CandidateState, cmd: { reason: string; keyIds: string[] }): DecidedEvent[] {
  if (!state.exists) throw new DomainError('candidate_not_found', 'Candidate not found', undefined, 404);
  if (state.shredded) return [];
  return [{ type: 'CandidateDataShredded', payload: { reason: cmd.reason, keyIds: cmd.keyIds } }];
}

function requireLive(state: CandidateState): void {
  if (!state.exists) throw new DomainError('candidate_not_found', 'Candidate not found', undefined, 404);
  if (state.shredded) throw new DomainError('candidate_removed', 'This candidate record was removed', undefined, 410);
}
