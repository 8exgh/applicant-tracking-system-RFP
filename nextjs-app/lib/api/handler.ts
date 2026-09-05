import { NextRequest, NextResponse } from 'next/server';
import { z, ZodType } from 'zod';
import { randomUUID } from 'crypto';
import { authenticate, Principal } from '@/lib/auth/middleware';
import { DomainError, isDomainError } from '@/lib/domain/errors';
import { withTenant } from '@/lib/db/pool';
import { findIdempotent, rememberIdempotent } from '@/lib/db/event-store';
import { securityLog } from '@/lib/security';
import { getLogger } from '@/lib/logger';

const log = getLogger('api');

export interface HandlerContext<TBody> {
  request: NextRequest;
  principal: Principal | null;
  body: TBody;
  requestId: string;
  expectedVersion?: number;
  ip: string;
  params: Record<string, string>;
}

export function clientIp(request: NextRequest): string {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '0.0.0.0';
}

export function errorResponse(err: unknown, requestId: string): NextResponse {
  if (isDomainError(err)) {
    const e = err as DomainError;
    const body: Record<string, unknown> = { error: e.code, message: e.message, requestId };
    if (e.details !== undefined) body.details = e.details;
    if (e.code === 'version_conflict') body.currentVersion = (e as { currentVersion?: number }).currentVersion;
    const res = NextResponse.json(body, { status: e.status });
    if (e.status === 429) res.headers.set('Retry-After', String((e.details as { retryAfterSeconds?: number })?.retryAfterSeconds ?? 60));
    if (e.code === 'version_conflict') res.headers.set('ETag', `"${(e as { currentVersion?: number }).currentVersion}"`);
    return res;
  }
  log.error(`unhandled (${requestId})`, err);
  return NextResponse.json({ error: 'internal_error', message: 'Internal server error', requestId }, { status: 500 });
}

// Input validation rejects unknown fields and wrong types with a machine-readable list (F26)
export function parseBody<T>(schema: ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new DomainError('validation_failed', 'Request body is invalid', { issues: result.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })) }, 400);
  }
  return result.data;
}

// Wraps a route: auth, JSON parsing, zod validation, If-Match, Idempotency-Key, error mapping
export function route<TBody = unknown>(options: { schema?: ZodType<TBody>; idempotent?: boolean }, fn: (ctx: HandlerContext<TBody>) => Promise<NextResponse | Record<string, unknown> | { status: number; body: unknown }>) {
  return async (request: NextRequest, routeCtx?: { params: Promise<Record<string, string>> }): Promise<NextResponse> => {
    const requestId = request.headers.get('x-request-id') || randomUUID();
    try {
      const params = routeCtx?.params ? await routeCtx.params : {};
      let raw: unknown = undefined;
      if (request.method !== 'GET' && request.method !== 'HEAD' && (request.headers.get('content-type') || '').includes('application/json')) {
        try { raw = await request.json(); } catch { throw new DomainError('invalid_json', 'Request body must be JSON', undefined, 400); }
      }
      const body = options.schema ? parseBody(options.schema, raw ?? {}) : (raw as TBody);
      const principal = await authenticate(request);
      const ifMatch = request.headers.get('if-match');
      const expectedVersion = ifMatch ? parseInt(ifMatch.replace(/"/g, ''), 10) : undefined;
      const ctx: HandlerContext<TBody> = { request, principal, body, requestId, expectedVersion: Number.isFinite(expectedVersion) ? expectedVersion : undefined, ip: clientIp(request), params };

      const key = request.headers.get('idempotency-key');
      const tenantId = principal && 'tenantId' in principal ? principal.tenantId : null;
      if (options.idempotent && key && tenantId) {
        const prior = await withTenant(tenantId, tx => findIdempotent(tx, tenantId, key));
        if (prior) return NextResponse.json(prior.response, { status: prior.status, headers: { 'Idempotent-Replayed': 'true' } });
      }
      const out = await fn(ctx);
      let res: NextResponse;
      if (out instanceof NextResponse) res = out;
      else if (typeof out === 'object' && out !== null && 'status' in out && 'body' in out && typeof (out as { status: unknown }).status === 'number') res = NextResponse.json((out as { body: unknown }).body, { status: (out as { status: number }).status });
      else res = NextResponse.json(out);
      if (options.idempotent && key && tenantId && res.status < 500) {
        const cloned = await res.clone().json().catch(() => null);
        if (cloned) await withTenant(tenantId, tx => rememberIdempotent(tx, tenantId, key, res.status, cloned));
      }
      res.headers.set('X-Request-Id', requestId);
      return res;
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

// DELETE is never allowed on records (invariant 11, F17): 405 and a security log entry
export function methodNotAllowed(resource: string) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const principal = await authenticate(request).catch(() => null);
    await securityLog(null, { kind: 'delete_attempt', resource, actorId: principal && 'userId' in principal ? principal.userId : null, tenantId: principal && 'tenantId' in principal ? principal.tenantId : null });
    return NextResponse.json({ error: 'method_not_allowed', message: 'Records are never deleted' }, { status: 405, headers: { Allow: 'GET, POST' } });
  };
}

export const zLang = z.enum(['en', 'fr']);
export const zLangMap = z.object({ en: z.string().max(20000).optional(), fr: z.string().max(20000).optional() }).strict();
export const zUuid = z.string().uuid();
