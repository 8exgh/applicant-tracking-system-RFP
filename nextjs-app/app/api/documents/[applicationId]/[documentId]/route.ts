import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth/middleware';
import { requireStaff } from '@/lib/commands/authz';
import { documentForDownload } from '@/lib/queries/staff';
import { errorResponse, methodNotAllowed } from '@/lib/api/handler';
import { hashToken } from '@/lib/crypto/pii';
import { now } from '@/lib/clock';
import { DomainError } from '@/lib/domain/errors';
import crypto from 'crypto';
import { securityLog } from '@/lib/security';

export const dynamic = 'force-dynamic';

// Signed, short-lived (5 min) download links (F26). A staff session mints
// the signature; the link itself carries no session.
export function signDownload(tenantId: string, applicationId: string, documentId: string, expires: number): string {
  return crypto.createHmac('sha256', process.env.JWT_SECRET || '').update(`${tenantId}|${applicationId}|${documentId}|${expires}`).digest('hex');
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ applicationId: string; documentId: string }> }) {
  const { applicationId, documentId } = await ctx.params;
  try {
    const principal = await authenticate(request);
    const staff = requireStaff(principal, 'application.view');
    const exp = request.nextUrl.searchParams.get('exp');
    const sig = request.nextUrl.searchParams.get('sig');
    if (exp && sig) {
      if (parseInt(exp, 10) < now().getTime() || sig !== signDownload(staff.tenantId, applicationId, documentId, parseInt(exp, 10))) throw new DomainError('link_expired', 'Download link expired', undefined, 410);
    }
    const doc = await documentForDownload(staff, applicationId, documentId).catch(async err => {
      if (err?.status === 404) await securityLog(null, { tenantId: staff.tenantId, kind: 'tenant_mismatch', actorId: staff.userId, resource: `document:${documentId}` });
      throw err;
    });
    if (!doc) throw new DomainError('document_not_found', undefined, undefined, 404);
    return new NextResponse(new Uint8Array(doc.content), {
      headers: {
        'Content-Type': doc.mime,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.filename)}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (err) {
    return errorResponse(err, hashToken(applicationId).slice(0, 8));
  }
}

export const DELETE = methodNotAllowed('document');
