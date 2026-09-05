import { NextRequest, NextResponse } from 'next/server';
import { route, methodNotAllowed } from '@/lib/api/handler';
import { queries } from '@/lib/api/queries-registry';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, ctx: { params: Promise<{ query: string }> }) {
  const { query } = await ctx.params;
  const q = queries[query];
  if (!q) return NextResponse.json({ error: 'unknown_query', message: `Unknown query ${query}` }, { status: 404 });
  return route({}, async hctx => (await q(hctx)) as Record<string, unknown>)(request, ctx as never);
}

export const DELETE = methodNotAllowed('query');
