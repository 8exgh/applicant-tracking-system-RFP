import { command } from '../utils/api-client.js';

// Time-driven process managers live in the app; the processor is the clock
// that ticks them (scheduled publish, automatic close, offer expiry, reminders).
export async function runSchedulerTick(): Promise<Record<string, number>> {
  const counts = await command<Record<string, number>>('run-schedulers', {});
  const active = Object.entries(counts).filter(([, n]) => n > 0);
  if (active.length) console.log(`[scheduler] ${active.map(([k, n]) => `${k}=${n}`).join(' ')}`);
  return counts;
}

export async function runProjectionCatchUp(): Promise<number> {
  const r = await command<{ applied: number }>('run-projections', {});
  if (r.applied) console.log(`[projections] caught up ${r.applied} event(s)`);
  return r.applied;
}
