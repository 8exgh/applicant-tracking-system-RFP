import { cookies } from 'next/headers';
import { resolveSession } from '@/lib/auth/sessions';
import { withPlatform } from '@/lib/db/pool';
import { CANDIDATE_COOKIE } from '@/lib/auth/middleware';
import { Locale } from '@/types/shared';

export interface CandidateSession { tenantId: string; candidateId: string; locale: Locale; }

// Server components read the candidate session from the HttpOnly cookie
export async function candidateSession(): Promise<CandidateSession | null> {
  const jar = await cookies();
  const token = jar.get(CANDIDATE_COOKIE)?.value;
  if (!token) return null;
  const session = await resolveSession(token, null);
  if (!session || session.kind !== 'candidate' || !session.tenant_id) return null;
  const locale = await withPlatform(async tx => (await tx.query('select locale from candidates where id = $1', [session.subject_id])).rows[0]?.locale ?? 'en');
  return { tenantId: session.tenant_id, candidateId: session.subject_id, locale };
}
