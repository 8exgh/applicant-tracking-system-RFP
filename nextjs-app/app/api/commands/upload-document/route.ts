import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth/middleware';
import { requireCandidate, candidateEnv } from '@/lib/commands/authz';
import { attachDocument, MAX_UPLOAD_BYTES } from '@/lib/commands/application';
import { errorResponse } from '@/lib/api/handler';
import { DomainError } from '@/lib/domain/errors';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

// Multipart upload: type/size/content checks, then scanned before staff can open it (F07)
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    const principal = await authenticate(request);
    const c = requireCandidate(principal);
    const form = await request.formData();
    const applicationId = String(form.get('applicationId') ?? '');
    const file = form.get('file');
    if (!/^[0-9a-f-]{36}$/.test(applicationId)) throw new DomainError('validation_failed', 'applicationId is required', undefined, 400);
    if (!(file instanceof File)) throw new DomainError('validation_failed', 'file is required', undefined, 400);
    if (file.size > MAX_UPLOAD_BYTES) throw new DomainError('file_too_large', 'Files must be 10 MB or smaller', undefined, 400);
    const content = Buffer.from(await file.arrayBuffer());
    const result = await attachDocument(candidateEnv(c), applicationId, { filename: file.name, mime: file.type || 'application/octet-stream', content, kind: String(form.get('kind') ?? 'resume') });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
