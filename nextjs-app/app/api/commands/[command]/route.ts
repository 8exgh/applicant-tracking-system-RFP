import { NextRequest, NextResponse } from 'next/server';
import { route, methodNotAllowed } from '@/lib/api/handler';
import { commands, candidateCookie } from '@/lib/api/commands-registry';
import { authenticate } from '@/lib/auth/middleware';
import { DomainError } from '@/lib/domain/errors';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, ctx: { params: Promise<{ command: string }> }) {
  const { command } = await ctx.params;
  const def = commands[command];
  if (!def) return NextResponse.json({ error: 'unknown_command', message: `Unknown command ${command}` }, { status: 404 });
  return route({ schema: def.schema, idempotent: def.idempotent }, async hctx => {
    const result = await def.run(hctx);
    if (command === 'sign-out' && hctx.principal?.kind === 'candidate') {
      const res = NextResponse.json(result);
      res.headers.set('Set-Cookie', candidateCookie('').replace('Max-Age=86400', 'Max-Age=0'));
      return res;
    }
    return result as Record<string, unknown>;
  })(request, ctx as never);
}

export const DELETE = methodNotAllowed('command');
export const PUT = methodNotAllowed('command');

export async function GET(request: NextRequest) {
  const principal = await authenticate(request).catch(() => null);
  if (!principal) throw new DomainError('unauthorized', undefined, undefined, 401);
  return NextResponse.json({ commands: Object.keys(commands) });
}
