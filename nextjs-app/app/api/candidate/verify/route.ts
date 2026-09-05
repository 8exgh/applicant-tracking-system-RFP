import { NextRequest, NextResponse } from 'next/server';
import { consumeCandidateLink } from '@/lib/commands/auth';
import { candidateCookie } from '@/lib/api/commands-registry';
import { confirmEmailChange } from '@/lib/commands/candidate';
import { decryptField } from '@/lib/crypto/pii';
import { withTenant } from '@/lib/db/pool';
import { errorResponse } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

// Magic-link landing: single use, sets the candidate session cookie (F03)
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const lang = request.nextUrl.searchParams.get('lang') === 'fr' ? 'fr' : 'en';
  try {
    const result = await consumeCandidateLink({ token });
    if (!result.ok) return NextResponse.redirect(new URL(`/${lang}/candidate/link-invalid?reason=${result.reason}`, request.url));
    const res = NextResponse.redirect(new URL(result.next && result.next.startsWith('/') ? result.next : `/${result.locale}/me`, request.url), 303);
    res.headers.set('Set-Cookie', candidateCookie(result.token));
    if (result.purpose === 'email_change') {
      const newEmail = await withTenant(result.tenantId, async tx => {
        const { rows } = await tx.query('select payload from events where tenant_id = $1 and stream_id = $2 and event_type = $3 order by stream_version desc limit 1', [result.tenantId, `candidate-${result.candidateId}`, 'CandidateEmailChangeRequested']);
        return decryptField<string>(tx, result.tenantId, rows[0]?.payload?.newEmail);
      });
      if (newEmail) await confirmEmailChange({ tenantId: result.tenantId, actor: { type: 'candidate', id: result.candidateId } }, { newEmail });
    }
    if (result.purpose === 'data_export') res.headers.set('Location', new URL(`/${result.locale}/me/export`, request.url).toString());
    return res;
  } catch (err) {
    return errorResponse(err, 'verify');
  }
}
