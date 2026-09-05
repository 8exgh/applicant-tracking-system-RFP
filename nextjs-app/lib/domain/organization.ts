import { DomainError } from './errors';
import { ReplayEvent, DecidedEvent } from '@/types/events';
import { LanguageSetting, Locale, Stage, StaffRole, STAFF_ROLES, DEFAULT_STAGES } from '@/types/shared';
import { contrastRatio, formatRatio, parseHex } from './contrast';
import { missingLanguages } from './lang';

export interface OrgSettings {
  suppressionThreshold: number;
  privacyNoticeVersion: number;
  idleTimeoutMinutes: number;
  referencePrefix: string;
  offerApprovalRequired: boolean;
  rescheduleCutoffHours: number;
  disagreementThreshold: number;
}

export interface Branding {
  logo?: string;
  primary: string;
  secondary: string;
  surface: string;
  text: string;
  footer?: string;
}

export interface OrgUser {
  userId: string;
  email: string;
  displayName: string;
  roles: StaffRole[];
  language: Locale;
  status: 'Invited' | 'Active' | 'Deactivated';
}

export interface OrganizationState {
  exists: boolean;
  id: string;
  slug: string;
  name: string;
  timeZone: string;
  languages: LanguageSetting[];
  settings: OrgSettings;
  branding: Branding;
  featureFlags: Record<string, boolean>;
  users: Record<string, OrgUser>;
  stageTemplate: Stage[];
  version: number;
}

export const DEFAULT_SETTINGS: OrgSettings = {
  suppressionThreshold: 5,
  privacyNoticeVersion: 1,
  idleTimeoutMinutes: 30,
  referencePrefix: 'HR',
  offerApprovalRequired: true,
  rescheduleCutoffHours: 24,
  disagreementThreshold: 3
};

export const DEFAULT_BRANDING: Branding = { primary: '#1A4480', secondary: '#005EA2', surface: '#FFFFFF', text: '#1B1B1B' };

export function initialOrganizationState(): OrganizationState {
  return {
    exists: false, id: '', slug: '', name: '', timeZone: 'America/Toronto',
    languages: [{ code: 'en', required: true }, { code: 'fr', required: true }],
    settings: { ...DEFAULT_SETTINGS }, branding: { ...DEFAULT_BRANDING }, featureFlags: {}, users: {},
    stageTemplate: DEFAULT_STAGES, version: 0
  };
}

export function evolveOrganization(state: OrganizationState, event: ReplayEvent): OrganizationState {
  const p = event.payload as Record<string, any>;
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case 'OrganizationCreated':
      return {
        ...next, exists: true, id: p.tenantId, slug: p.slug, name: p.name, timeZone: p.timeZone,
        languages: p.languages ?? next.languages,
        settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
        stageTemplate: p.stageTemplate ?? DEFAULT_STAGES
      };
    case 'OrganizationSettingsUpdated':
      return {
        ...next,
        languages: p.languages ?? state.languages,
        timeZone: p.timeZone ?? state.timeZone,
        name: p.name ?? state.name,
        settings: { ...state.settings, ...(p.settings ?? {}) }
      };
    case 'BrandingUpdated':
      return { ...next, branding: { ...state.branding, ...p } };
    case 'FeatureFlagChanged':
      return { ...next, featureFlags: { ...state.featureFlags, [p.flag]: !!p.enabled } };
    case 'StageTemplateUpdated':
      return { ...next, stageTemplate: p.stages };
    case 'UserInvited':
      return { ...next, users: { ...state.users, [p.userId]: { userId: p.userId, email: p.email, displayName: p.displayName ?? '', roles: p.roles ?? [], language: p.language ?? 'en', status: 'Invited' } } };
    case 'UserActivated':
      return state.users[p.userId] ? { ...next, users: { ...state.users, [p.userId]: { ...state.users[p.userId], status: 'Active' } } } : next;
    case 'UserRoleAssigned': {
      const u = state.users[p.userId];
      if (!u) return next;
      return { ...next, users: { ...state.users, [p.userId]: { ...u, roles: Array.from(new Set([...u.roles, p.role])) } } };
    }
    case 'UserRoleRevoked': {
      const u = state.users[p.userId];
      if (!u) return next;
      return { ...next, users: { ...state.users, [p.userId]: { ...u, roles: u.roles.filter(r => r !== p.role) } } };
    }
    case 'UserDeactivated':
      return state.users[p.userId] ? { ...next, users: { ...state.users, [p.userId]: { ...state.users[p.userId], status: 'Deactivated' } } } : next;
    default:
      return next;
  }
}

export function replayOrganization(events: ReplayEvent[]): OrganizationState {
  return events.reduce(evolveOrganization, initialOrganizationState());
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function decideCreateOrganization(state: OrganizationState, cmd: {
  tenantId: string; name: string; slug: string; timeZone: string; languages?: LanguageSetting[]; referencePrefix?: string;
}): DecidedEvent[] {
  if (state.exists) throw new DomainError('organization_exists');
  if (!SLUG_PATTERN.test(cmd.slug) || cmd.slug.length > 40) throw new DomainError('slug_invalid', 'Slug must be lowercase letters, digits and single hyphens');
  if (!cmd.name.trim()) throw new DomainError('name_required');
  try { new Intl.DateTimeFormat('en-CA', { timeZone: cmd.timeZone }); } catch { throw new DomainError('time_zone_invalid'); }
  const languages = cmd.languages ?? [{ code: 'en', required: true }, { code: 'fr', required: true }];
  validateLanguages(languages);
  const prefix = (cmd.referencePrefix || cmd.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'HR';
  return [{ type: 'OrganizationCreated', payload: { tenantId: cmd.tenantId, name: cmd.name.trim(), slug: cmd.slug, timeZone: cmd.timeZone, languages, settings: { referencePrefix: prefix }, stageTemplate: DEFAULT_STAGES } }];
}

function validateLanguages(languages: LanguageSetting[]): void {
  if (!languages.length || !languages.some(l => l.required)) throw new DomainError('language_required', 'At least one language must be required');
  for (const l of languages) if (l.code !== 'en' && l.code !== 'fr') throw new DomainError('language_unsupported');
}

export function decideUpdateSettings(state: OrganizationState, cmd: {
  languages?: LanguageSetting[]; timeZone?: string; name?: string; settings?: Partial<OrgSettings>;
}): DecidedEvent[] {
  requireExists(state);
  if (cmd.languages) validateLanguages(cmd.languages);
  if (cmd.timeZone) { try { new Intl.DateTimeFormat('en-CA', { timeZone: cmd.timeZone }); } catch { throw new DomainError('time_zone_invalid'); } }
  if (cmd.settings?.suppressionThreshold !== undefined && cmd.settings.suppressionThreshold < 1) throw new DomainError('suppression_threshold_invalid');
  return [{ type: 'OrganizationSettingsUpdated', payload: { languages: cmd.languages, timeZone: cmd.timeZone, name: cmd.name, settings: cmd.settings } }];
}

export function decideUpdateBranding(state: OrganizationState, cmd: Partial<Branding>): DecidedEvent[] {
  requireExists(state);
  const merged = { ...state.branding, ...cmd };
  for (const [k, v] of Object.entries({ primary: merged.primary, secondary: merged.secondary, surface: merged.surface, text: merged.text })) {
    if (!parseHex(v)) throw new DomainError('colour_invalid', `${k} must be a hex colour`);
  }
  const checks: Array<[string, string, string, number]> = [
    ['primary', merged.primary, merged.surface, 4.5],
    ['text', merged.text, merged.surface, 4.5],
    ['secondary', merged.secondary, merged.surface, 3]
  ];
  for (const [name, fg, bg, min] of checks) {
    const ratio = contrastRatio(fg, bg)!;
    if (ratio < min) {
      throw new DomainError('contrast_insufficient', `${name} against surface is ${formatRatio(ratio)}; ${min}:1 required`, { field: name, ratio: formatRatio(ratio), required: `${min}:1` });
    }
  }
  return [{ type: 'BrandingUpdated', payload: cmd }];
}

export function decideInviteUser(state: OrganizationState, cmd: { userId: string; email: string; displayName: string; roles: StaffRole[]; language: Locale }): DecidedEvent[] {
  requireExists(state);
  const email = cmd.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError('email_invalid');
  if (Object.values(state.users).some(u => u.email === email && u.status !== 'Deactivated')) throw new DomainError('email_taken');
  for (const r of cmd.roles) if (!STAFF_ROLES.includes(r)) throw new DomainError('role_invalid', `Unknown role ${r}`);
  return [{ type: 'UserInvited', payload: { userId: cmd.userId, email, displayName: cmd.displayName.trim(), roles: cmd.roles, language: cmd.language } }];
}

export function decideActivateUser(state: OrganizationState, cmd: { userId: string }): DecidedEvent[] {
  const u = state.users[cmd.userId];
  if (!u) throw new DomainError('user_not_found', 'User not found', undefined, 404);
  if (u.status === 'Deactivated') throw new DomainError('user_deactivated');
  if (u.status === 'Active') return [];
  return [{ type: 'UserActivated', payload: { userId: cmd.userId } }];
}

export function decideAssignRole(state: OrganizationState, cmd: { userId: string; role: StaffRole }): DecidedEvent[] {
  const u = state.users[cmd.userId];
  if (!u) throw new DomainError('user_not_found', 'User not found', undefined, 404);
  if (!STAFF_ROLES.includes(cmd.role)) throw new DomainError('role_invalid');
  if (u.roles.includes(cmd.role)) return [];
  return [{ type: 'UserRoleAssigned', payload: { userId: cmd.userId, role: cmd.role, scope: 'organization' } }];
}

export function decideRevokeRole(state: OrganizationState, cmd: { userId: string; role: StaffRole; reason?: string }): DecidedEvent[] {
  const u = state.users[cmd.userId];
  if (!u) throw new DomainError('user_not_found', 'User not found', undefined, 404);
  if (!u.roles.includes(cmd.role)) return [];
  return [{ type: 'UserRoleRevoked', payload: { userId: cmd.userId, role: cmd.role, reason: cmd.reason }, reason: cmd.reason }];
}

export function decideDeactivateUser(state: OrganizationState, cmd: { userId: string; actorUserId?: string }): DecidedEvent[] {
  const u = state.users[cmd.userId];
  if (!u) throw new DomainError('user_not_found', 'User not found', undefined, 404);
  if (cmd.actorUserId && cmd.actorUserId === cmd.userId) throw new DomainError('cannot_deactivate_self');
  if (u.status === 'Deactivated') return [];
  return [{ type: 'UserDeactivated', payload: { userId: cmd.userId } }];
}

export function decideSetFeatureFlag(state: OrganizationState, cmd: { flag: string; enabled: boolean }): DecidedEvent[] {
  requireExists(state);
  if (!/^[a-z_]{2,40}$/.test(cmd.flag)) throw new DomainError('flag_invalid');
  if ((state.featureFlags[cmd.flag] ?? false) === cmd.enabled) return [];
  return [{ type: 'FeatureFlagChanged', payload: { flag: cmd.flag, enabled: cmd.enabled } }];
}

export function decideUpdateStageTemplate(state: OrganizationState, cmd: { stages: Stage[] }): DecidedEvent[] {
  requireExists(state);
  validateStages(cmd.stages, state.languages);
  return [{ type: 'StageTemplateUpdated', payload: { stages: cmd.stages } }];
}

export function validateStages(stages: Stage[], languages: LanguageSetting[]): void {
  if (!stages.length) throw new DomainError('stages_required');
  const ids = new Set<string>();
  const missing: string[] = [];
  for (const s of stages) {
    if (!/^[a-z0-9_]{1,40}$/.test(s.stageId)) throw new DomainError('stage_id_invalid', `Invalid stage id ${s.stageId}`);
    if (ids.has(s.stageId)) throw new DomainError('stage_duplicate', `Duplicate stage ${s.stageId}`);
    ids.add(s.stageId);
    missing.push(...missingLanguages(s.name, languages, `stage ${s.stageId} name`));
    missing.push(...missingLanguages(s.candidateLabel, languages, `stage ${s.stageId} candidate label`));
  }
  if (missing.length) throw new DomainError('missing_language_content', 'Content missing in a required language', { missing });
}

function requireExists(state: OrganizationState): void {
  if (!state.exists) throw new DomainError('organization_not_found', 'Organization not found', undefined, 404);
}

export function hasRole(user: OrgUser | undefined, ...roles: StaffRole[]): boolean {
  return !!user && user.status === 'Active' && roles.some(r => user.roles.includes(r));
}
