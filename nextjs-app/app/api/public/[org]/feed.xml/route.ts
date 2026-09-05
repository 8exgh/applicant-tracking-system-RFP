import { NextRequest, NextResponse } from 'next/server';
import { listOpenPostings, feedRss } from '@/lib/queries/public';
import { publicRateLimit } from '../postings/route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, ctx: { params: Promise<{ org: string }> }) {
  const limited = await publicRateLimit(request);
  if (limited) return limited;
  const { org } = await ctx.params;
  const lang = request.nextUrl.searchParams.get('lang') === 'fr' ? 'fr' : 'en';
  const result = await listOpenPostings(org, lang);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const base = (process.env.APP_BASE_URL || request.nextUrl.origin).replace(/\/$/, '');
  return new NextResponse(feedRss(result.org, result.postings, base, lang), { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}
