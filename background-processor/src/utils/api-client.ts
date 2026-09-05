// Thin client for the app's API-key endpoints (the processor's todo lists).
function baseUrl(): string {
  const url = process.env.NEXTJS_API_URL;
  if (!url) throw new Error('NEXTJS_API_URL is not set');
  return url.replace(/\/$/, '');
}

function apiKey(): string {
  const key = process.env.NEXTJS_API_KEY;
  if (!key) throw new Error('NEXTJS_API_KEY is not set');
  return key;
}

export async function query<T>(name: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${baseUrl()}/api/queries/${name}${qs ? `?${qs}` : ''}`, { headers: { 'X-API-Key': apiKey() } });
  if (!res.ok) throw new Error(`query ${name} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function queryBytes(name: string, params: Record<string, string>): Promise<Buffer> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${baseUrl()}/api/queries/${name}?${qs}`, { headers: { 'X-API-Key': apiKey() } });
  if (!res.ok) throw new Error(`query ${name} failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function command<T>(name: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}/api/commands/${name}`, { method: 'POST', headers: { 'X-API-Key': apiKey(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`command ${name} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}
