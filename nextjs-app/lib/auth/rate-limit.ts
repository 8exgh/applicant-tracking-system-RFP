import { Tx } from '@/lib/db/pool';
import { now } from '@/lib/clock';

// Fixed-window counters in the database so limits hold across processes.
// Returns true when the caller is over the limit (F02, F03, F26).
export async function hitRateLimit(tx: Tx, key: string, limit: number, windowSeconds: number): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const at = now();
  const { rows } = await tx.query('select window_start, count from rate_limits where key = $1 for update', [key]);
  const row = rows[0];
  if (!row || at.getTime() - new Date(row.window_start).getTime() >= windowSeconds * 1000) {
    await tx.query('insert into rate_limits (key, window_start, count) values ($1, $2, 1) on conflict (key) do update set window_start = $2, count = 1', [key, at]);
    return { limited: false, retryAfterSeconds: 0 };
  }
  if (row.count >= limit) {
    const retry = Math.ceil((windowSeconds * 1000 - (at.getTime() - new Date(row.window_start).getTime())) / 1000);
    return { limited: true, retryAfterSeconds: Math.max(1, retry) };
  }
  await tx.query('update rate_limits set count = count + 1 where key = $1', [key]);
  return { limited: false, retryAfterSeconds: 0 };
}

// Non-incrementing check: is the caller currently over the limit?
export async function checkRateLimit(tx: Tx, key: string, limit: number, windowSeconds: number): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const at = now();
  const { rows } = await tx.query('select window_start, count from rate_limits where key = $1', [key]);
  const row = rows[0];
  if (!row || at.getTime() - new Date(row.window_start).getTime() >= windowSeconds * 1000 || row.count < limit) return { limited: false, retryAfterSeconds: 0 };
  const retry = Math.ceil((windowSeconds * 1000 - (at.getTime() - new Date(row.window_start).getTime())) / 1000);
  return { limited: true, retryAfterSeconds: Math.max(1, retry) };
}

export async function resetRateLimit(tx: Tx, key: string): Promise<void> {
  await tx.query('delete from rate_limits where key = $1', [key]);
}
