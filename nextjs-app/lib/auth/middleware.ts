import { withPlatform } from '@/lib/db/pool';
import { resolveSession } from './sessions';
import { Locale, StaffRole } from '@/types/shared';
import { getLogger } from '@/lib/logger';

const log = getLogger('auth/middleware');

export type Principal =
  | { kind: 'staff'; userId: string; tenantId: string; roles: StaffRole[]; sessionId: string; displayName: string; language: Locale; email: string }
  | { kind: 'candidate'; candidateId: string; tenantId: string; sessionId: string; locale: Locale }
  | { kind: 'platform'; operatorId: string; sessionId: string }
  | { kind: 'api' };

export const CANDIDATE_COOKIE = 'ats_candidate';

function apiKey(): string {
  const key = process.env.BACKGROUND_PROCESSOR_API_KEY;
  if (!key) throw new Error('BACKGROUND_PROCESSOR_API_KEY environment variable must be set');
  return key;
}

function idleMinutes(): number {
  return parseInt(process.env.STAFF_IDLE_MINUTES || '30', 10);
}

export function bearer(request: Request): string | null {
  const h = request.headers.get('authorization');
  return h && h.startsWith('Bearer ') ? h.slice(7) : null;
}

export function cookieValue(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Resolves the caller: processor API key, staff bearer session, platform
// operator bearer session, or candidate cookie session.
export async function authenticate(request: Request): Promise<Principal | null> {
  const key = request.headers.get('x-api-key');
  if (key) {
    if (key === apiKey()) return { kind: 'api' };
    log.debug('Auth failed: bad API key');
    return null;
  }
  const token = bearer(request);
  if (token) {
    const session = await resolveSession(token, idleMinutes());
    if (!session) return null;
    if (session.kind === 'platform') return { kind: 'platform', operatorId: session.subject_id, sessionId: session.id };
    if (session.kind === 'staff') {
      // Roles are re-read on every request so revocations and deactivation apply immediately (F02)
      const user = await withPlatform(async tx => (await tx.query('select * from users where id = $1', [session.subject_id])).rows[0]);
      if (!user || user.status !== 'Active') return null;
      return { kind: 'staff', userId: user.id, tenantId: user.tenant_id, roles: user.roles as StaffRole[], sessionId: session.id, displayName: user.display_name, language: user.language, email: user.email };
    }
    if (session.kind === 'candidate') {
      return { kind: 'candidate', candidateId: session.subject_id, tenantId: session.tenant_id!, sessionId: session.id, locale: 'en' };
    }
  }
  const cookie = cookieValue(request, CANDIDATE_COOKIE);
  if (cookie) {
    const session = await resolveSession(cookie, null);
    if (session && session.kind === 'candidate') {
      const cand = await withPlatform(async tx => (await tx.query('select locale from candidates where id = $1', [session.subject_id])).rows[0]);
      return { kind: 'candidate', candidateId: session.subject_id, tenantId: session.tenant_id!, sessionId: session.id, locale: (cand?.locale ?? 'en') as Locale };
    }
  }
  return null;
}
