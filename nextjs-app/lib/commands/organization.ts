import { randomUUID } from 'crypto';
import { executeCommand, CommandEnv } from './execute';
import { loadOrganization } from '@/lib/app/context';
import { streamIds } from '@/types/events';
import { LanguageSetting, Locale, Stage, StaffRole } from '@/types/shared';
import {
  decideCreateOrganization, decideUpdateSettings, decideUpdateBranding, decideInviteUser, decideActivateUser, decideAssignRole, decideRevokeRole,
  decideDeactivateUser, decideSetFeatureFlag, decideUpdateStageTemplate, decideChangeUserLanguage, Branding, OrgSettings, replayOrganization
} from '@/lib/domain/organization';
import { decideSaveTemplate, decideActivateTemplate, evolveTemplate, initialTemplateState, TemplateKey, TEMPLATE_KEYS } from '@/lib/domain/notification';
import { DomainError } from '@/lib/domain/errors';
import { hashToken, randomToken } from '@/lib/crypto/pii';
import { hashPassword, validatePassword } from '@/lib/auth/password';
import { revokeSessionsForSubject, revokeSessionsForTenant } from '@/lib/auth/sessions';
import { queueNotification } from '@/lib/notifications/queue';
import { loadStream } from '@/lib/db/event-store';
import { toReplay } from '@/lib/app/context';
import { now } from '@/lib/clock';
import { withPlatform } from '@/lib/db/pool';

function baseUrl(): string { return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''); }

export async function createOrganization(env: CommandEnv, cmd: { name: string; slug: string; timeZone: string; languages?: LanguageSetting[]; adminEmail: string; adminName?: string; referencePrefix?: string }): Promise<{ tenantId: string; inviteLink: string }> {
  const tenantId = env.tenantId;
  return executeCommand(env, async (tx, append) => {
    const taken = await tx.query('select 1 from org_settings where slug = $1', [cmd.slug]);
    if (taken.rows.length) throw new DomainError('slug_taken', 'That slug is already in use', undefined, 409);
    const events = decideCreateOrganization(replayOrganization([]), { tenantId, name: cmd.name, slug: cmd.slug, timeZone: cmd.timeZone, languages: cmd.languages, referencePrefix: cmd.referencePrefix });
    await append(streamIds.org(tenantId), 'none', events);
    const org = replayOrganization(toReplay(await loadStream(tx, tenantId, streamIds.org(tenantId))));
    const userId = randomUUID();
    const invite = decideInviteUser(org, { userId, email: cmd.adminEmail, displayName: cmd.adminName ?? '', roles: ['org_admin'], language: (org.languages[0]?.code ?? 'en') as Locale });
    await append(streamIds.org(tenantId), 'any', invite);
    const link = await issueInvite(tx, userId);
    await queueNotification(tx, append, {
      tenantId, templateKey: 'staff_invitation', recipient: { kind: 'email', address: cmd.adminEmail.toLowerCase(), locale: org.languages[0]?.code ?? 'en', ref: userId, keyId: `tenant:${tenantId}` },
      values: { link }, causation: { eventType: 'UserInvited' }, languages: org.languages, organizationName: cmd.name
    });
    return { tenantId, inviteLink: link };
  });
}

async function issueInvite(tx: import('@/lib/db/pool').Tx, userId: string): Promise<string> {
  const token = randomToken(32);
  const expires = new Date(now().getTime() + 7 * 86_400_000);
  await tx.query('insert into credentials (user_id, invite_token_hash, invite_expires_at) values ($1, $2, $3) on conflict (user_id) do update set invite_token_hash = excluded.invite_token_hash, invite_expires_at = excluded.invite_expires_at', [userId, hashToken(token), expires]);
  return `${baseUrl()}/staff/accept-invite?token=${token}`;
}

export async function updateSettings(env: CommandEnv, cmd: { languages?: LanguageSetting[]; timeZone?: string; name?: string; settings?: Partial<OrgSettings> }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    await append(streamIds.org(env.tenantId), org.version, decideUpdateSettings(org, cmd));
  });
}

export async function updateBranding(env: CommandEnv, cmd: Partial<Branding>): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    await append(streamIds.org(env.tenantId), org.version, decideUpdateBranding(org, cmd));
  });
}

export async function inviteUser(env: CommandEnv, cmd: { email: string; displayName: string; roles: StaffRole[]; language: Locale }): Promise<{ userId: string; inviteLink: string }> {
  return executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    const userId = randomUUID();
    await append(streamIds.org(env.tenantId), org.version, decideInviteUser(org, { userId, ...cmd }));
    const link = await issueInvite(tx, userId);
    await queueNotification(tx, append, {
      tenantId: env.tenantId, templateKey: 'staff_invitation', recipient: { kind: 'email', address: cmd.email.toLowerCase(), locale: cmd.language, ref: userId, keyId: `tenant:${env.tenantId}` },
      values: { link }, causation: { eventType: 'UserInvited' }, languages: org.languages, organizationName: org.name
    });
    return { userId, inviteLink: link };
  });
}

// Invitation acceptance sets the password and activates the user
export async function acceptInvite(cmd: { token: string; password: string; displayName?: string }): Promise<{ userId: string; tenantId: string }> {
  validatePassword(cmd.password);
  const found = await withPlatform(async tx => {
    const { rows } = await tx.query('select c.user_id, u.tenant_id from credentials c join users u on u.id = c.user_id where c.invite_token_hash = $1 and c.invite_expires_at > $2', [hashToken(cmd.token), now()]);
    return rows[0] as { user_id: string; tenant_id: string } | undefined;
  });
  if (!found) throw new DomainError('invite_invalid', 'This invitation is invalid or expired', undefined, 400);
  const hash = await hashPassword(cmd.password);
  const env: CommandEnv = { tenantId: found.tenant_id, actor: { type: 'staff', id: found.user_id } };
  await executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    await tx.query('update credentials set password_hash = $2, invite_token_hash = null, invite_expires_at = null, updated_at = $3 where user_id = $1', [found.user_id, hash, now()]);
    if (cmd.displayName) await tx.query('update users set display_name = $2 where id = $1', [found.user_id, cmd.displayName]);
    await append(streamIds.org(env.tenantId), org.version, decideActivateUser(org, { userId: found.user_id }));
  });
  return { userId: found.user_id, tenantId: found.tenant_id };
}

export async function assignRole(env: CommandEnv, cmd: { userId: string; role: StaffRole }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    await append(streamIds.org(env.tenantId), org.version, decideAssignRole(org, cmd));
  });
}

export async function revokeRole(env: CommandEnv, cmd: { userId: string; role: StaffRole; reason?: string }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    await append(streamIds.org(env.tenantId), org.version, decideRevokeRole(org, cmd));
  });
}

export async function deactivateUser(env: CommandEnv, cmd: { userId: string }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    await append(streamIds.org(env.tenantId), org.version, decideDeactivateUser(org, { userId: cmd.userId, actorUserId: env.actor.id }));
    await revokeSessionsForSubject(tx, cmd.userId);
  });
}

export async function changeMyLanguage(env: CommandEnv, cmd: { language: Locale }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    await append(streamIds.org(env.tenantId), org.version, decideChangeUserLanguage(org, { userId: env.actor.id, language: cmd.language }));
  });
}

export async function revokeAllSessions(env: CommandEnv): Promise<number> {
  return executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    const count = await revokeSessionsForTenant(tx, env.tenantId);
    await append(streamIds.org(env.tenantId), org.version, [{ type: 'SessionsRevoked', payload: { count } }]);
    return count;
  });
}

export async function setFeatureFlag(env: CommandEnv, cmd: { flag: string; enabled: boolean }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    await append(streamIds.org(env.tenantId), org.version, decideSetFeatureFlag(org, cmd));
  });
}

export async function updateStageTemplate(env: CommandEnv, cmd: { stages: Stage[] }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    await append(streamIds.org(env.tenantId), org.version, decideUpdateStageTemplate(org, cmd));
  });
}

export async function saveTemplate(env: CommandEnv, cmd: { key: TemplateKey; lang: Locale; subject: string; body: string }): Promise<void> {
  if (!TEMPLATE_KEYS.includes(cmd.key)) throw new DomainError('template_unknown', 'Unknown template', undefined, 404);
  await executeCommand(env, async (tx, append) => {
    const streamId = streamIds.template(env.tenantId, cmd.key);
    const events = await loadStream(tx, env.tenantId, streamId);
    const state = toReplay(events).reduce(evolveTemplate, initialTemplateState(cmd.key));
    await append(streamId, events.length, decideSaveTemplate(state, cmd));
  });
}

export async function activateTemplate(env: CommandEnv, cmd: { key: TemplateKey }): Promise<void> {
  await executeCommand(env, async (tx, append) => {
    const org = await loadOrganization(tx, env.tenantId);
    const streamId = streamIds.template(env.tenantId, cmd.key);
    const events = await loadStream(tx, env.tenantId, streamId);
    const state = toReplay(events).reduce(evolveTemplate, initialTemplateState(cmd.key));
    await append(streamId, events.length, decideActivateTemplate(state, org.languages));
  });
}
