import { Principal } from '@/lib/auth/middleware';
import { Action, can } from '@/lib/auth/permissions';
import { DomainError, ForbiddenError, NotFoundError } from '@/lib/domain/errors';
import { HiringProcessState } from '@/lib/domain/hiring-process';
import { Actor } from '@/lib/db/event-store';
import { CommandEnv } from './execute';

export type StaffPrincipal = Extract<Principal, { kind: 'staff' }>;
export type CandidatePrincipal = Extract<Principal, { kind: 'candidate' }>;

export function requireStaff(principal: Principal | null, action?: Action): StaffPrincipal {
  if (!principal || principal.kind !== 'staff') throw new DomainError('unauthorized', 'Sign in required', undefined, 401);
  if (action && !can(principal.roles, action)) throw new ForbiddenError('forbidden', `Role cannot ${action}`);
  return principal;
}

export function requireCandidate(principal: Principal | null): CandidatePrincipal {
  if (!principal || principal.kind !== 'candidate') throw new DomainError('unauthorized', 'Sign in required', undefined, 401);
  return principal;
}

export function requirePlatform(principal: Principal | null): Extract<Principal, { kind: 'platform' }> {
  if (!principal || principal.kind !== 'platform') throw new DomainError('unauthorized', 'Platform operator sign in required', undefined, 401);
  return principal;
}

export function requireApi(principal: Principal | null): void {
  if (!principal || principal.kind !== 'api') throw new DomainError('unauthorized', 'Valid API key required', undefined, 401);
}

// Hiring managers see their own processes; assessors see processes they sit
// on; auditors, HR advisors and admins see all. Others get 404, not 403 (§9.5).
export type ProcessAccess = 'full' | 'manager' | 'board' | 'read';

export function processAccess(staff: StaffPrincipal, process: HiringProcessState): ProcessAccess {
  if (staff.roles.includes('org_admin') || staff.roles.includes('hr_advisor')) return 'full';
  if (staff.roles.includes('auditor')) return 'read';
  const onBoard = process.board.some(b => b.userId === staff.userId);
  const isManager = process.hiringManagerId === staff.userId;
  if (staff.roles.includes('hiring_manager') && (isManager || onBoard)) return 'manager';
  if (staff.roles.includes('assessor') && onBoard) return 'board';
  throw new NotFoundError('process_not_found');
}

export function requireProcessWrite(staff: StaffPrincipal, process: HiringProcessState, action: Action): ProcessAccess {
  const access = processAccess(staff, process);
  if (access === 'read') throw new ForbiddenError('forbidden', 'Auditors are read-only');
  if (!can(staff.roles, action)) throw new ForbiddenError('forbidden', `Role cannot ${action}`);
  // Board members act only on their own scoring; the chair rule for consensus is a domain invariant
  if (!['score.record', 'interview.notes', 'application.note', 'consensus.record'].includes(action) && access === 'board') throw new ForbiddenError('forbidden', 'Assessors cannot do that');
  return access;
}

export function staffEnv(staff: StaffPrincipal, extra?: Partial<CommandEnv>): CommandEnv {
  return { tenantId: staff.tenantId, actor: { type: 'staff', id: staff.userId }, role: staff.roles.join(','), locale: staff.language, ...extra };
}

export function candidateEnv(candidate: CandidatePrincipal, extra?: Partial<CommandEnv>): CommandEnv {
  return { tenantId: candidate.tenantId, actor: { type: 'candidate', id: candidate.candidateId }, locale: candidate.locale, ...extra };
}

export function systemEnv(tenantId: string, id = 'scheduler', extra?: Partial<CommandEnv>): CommandEnv {
  return { tenantId, actor: { type: 'system', id }, ...extra };
}

export function platformEnv(tenantId: string, operatorId: string): CommandEnv {
  const actor: Actor = { type: 'platform', id: operatorId };
  return { tenantId, actor, role: 'platform_operator' };
}
