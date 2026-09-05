import { NextRequest, NextResponse } from 'next/server';
import { listOpenPostings } from '@/lib/queries/public';
import { withPlatform } from '@/lib/db/pool';
import { hitRateLimit } from '@/lib/auth/rate-limit';
import { clientIp } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

// Public endpoints are rate limited per client: 60/min → 429 with Retry-After (F26)
export async function publicRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const r = await withPlatform(tx => hitRateLimit(tx, `public:${clientIp(request)}`, 60, 60));
  if (r.limited) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(r.retryAfterSeconds) } });
  return null;
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ org: string }> }) {
  const limited = await publicRateLimit(request);
  if (limited) return limited;
  const { org } = await ctx.params;
  const lang = request.nextUrl.searchParams.get('lang') === 'fr' ? 'fr' : 'en';
  const result = await listOpenPostings(org, lang);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ organization: { name: result.org.name, slug: result.org.slug, timeZone: result.org.timeZone }, postings: result.postings }, { headers: { 'Cache-Control': 'public, max-age=60' } });
}
