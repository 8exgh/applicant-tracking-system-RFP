import { NextRequest, NextResponse } from 'next/server';
import { listOpenPostings, feedJson } from '@/lib/queries/public';
import { publicRateLimit } from '../postings/route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, ctx: { params: Promise<{ org: string }> }) {
  const limited = await publicRateLimit(request);
  if (limited) return limited;
  const { org } = await ctx.params;
  const result = await listOpenPostings(org, 'en');
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const base = (process.env.APP_BASE_URL || request.nextUrl.origin).replace(/\/$/, '');
  return NextResponse.json(feedJson(result.org, result.postings, base), { headers: { 'Cache-Control': 'public, max-age=300' } });
}
