import { NextRequest, NextResponse } from 'next/server';
import { getPoster } from '@/lib/queries/public';
import { publicRateLimit } from '../route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, ctx: { params: Promise<{ org: string; slug: string }> }) {
  const limited = await publicRateLimit(request);
  if (limited) return limited;
  const { org, slug } = await ctx.params;
  const lang = request.nextUrl.searchParams.get('lang') === 'fr' ? 'fr' : 'en';
  const result = await getPoster(org, slug, lang);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(result.posting, { headers: { 'Cache-Control': 'public, max-age=60', ETag: `"${result.posting.processId}-${result.posting.version}"` } });
}
