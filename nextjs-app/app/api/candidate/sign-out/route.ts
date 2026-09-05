import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth/middleware';
import { signOut } from '@/lib/commands/auth';
import { candidateCookie } from '@/lib/api/commands-registry';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const principal = await authenticate(request).catch(() => null);
  if (principal && 'sessionId' in principal) await signOut(principal.sessionId);
  const lang = request.nextUrl.searchParams.get('lang') === 'fr' ? 'fr' : 'en';
  const res = NextResponse.redirect(new URL(`/${lang}/jobs`, request.url), 303);
  res.headers.set('Set-Cookie', candidateCookie('').replace('Max-Age=86400', 'Max-Age=0'));
  return res;
}
