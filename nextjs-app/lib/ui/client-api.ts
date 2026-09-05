'use client';

// Browser-side API client. Staff pages carry a bearer token in localStorage
// (same shape as inventory-shopify); candidate pages rely on the session cookie.
export interface ApiError { error: string; message?: string; details?: any; status: number; currentVersion?: number; }

export function staffToken(): string | null {
  try { return localStorage.getItem('ats_staff_token'); } catch { return null; }
}

export function setStaffToken(token: string | null): void {
  try { token ? localStorage.setItem('ats_staff_token', token) : localStorage.removeItem('ats_staff_token'); } catch { /* ignore */ }
}

async function call(path: string, init: RequestInit, auth: 'staff' | 'cookie'): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> ?? {}) };
  if (auth === 'staff') {
    const token = staffToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw { status: res.status, ...(typeof body === 'object' && body ? body : { error: 'request_failed', message: text }) } as ApiError;
  return body;
}

export const staffApi = {
  command: (name: string, body: unknown, opts: { expectedVersion?: number; idempotencyKey?: string } = {}) =>
    call(`/api/commands/${name}`, { method: 'POST', body: JSON.stringify(body), headers: { ...(opts.expectedVersion !== undefined ? { 'If-Match': String(opts.expectedVersion) } : {}), ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}) } }, 'staff'),
  query: (name: string, params: Record<string, string> = {}) => call(`/api/queries/${name}?${new URLSearchParams(params)}`, { method: 'GET' }, 'staff')
};

export const candidateApi = {
  command: (name: string, body: unknown) => call(`/api/commands/${name}`, { method: 'POST', body: JSON.stringify(body) }, 'cookie'),
  query: (name: string, params: Record<string, string> = {}) => call(`/api/queries/${name}?${new URLSearchParams(params)}`, { method: 'GET' }, 'cookie')
};

export function errorMessage(e: unknown): string {
  const err = e as ApiError;
  if (!err) return 'Unknown error';
  const details = err.details ? ` (${JSON.stringify(err.details)})` : '';
  return `${err.error ?? 'error'}${err.message ? `: ${err.message}` : ''}${details}`;
}
