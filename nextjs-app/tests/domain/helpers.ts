import { ReplayEvent, DecidedEvent } from '@/types/events';
import { Actor } from '@/lib/db/event-store';
import { DomainError } from '@/lib/domain/errors';
import { expect } from 'vitest';

let clock = new Date('2026-12-01T16:00:00Z');

export function at(iso: string): void { clock = new Date(iso); }

export function given(events: Array<DecidedEvent | ReplayEvent | { type: string; payload: Record<string, unknown>; actor?: Actor }>): ReplayEvent[] {
  return events.map((e, i) => ({
    type: e.type,
    payload: e.payload,
    occurredAt: 'occurredAt' in e && e.occurredAt ? e.occurredAt : new Date(clock.getTime() + i * 1000),
    actor: 'actor' in e ? e.actor : undefined,
    reason: (e as DecidedEvent).reason
  }));
}

export function types(events: DecidedEvent[]): string[] { return events.map(e => e.type); }

export function expectError(fn: () => unknown, code: string): DomainError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    return e as DomainError;
  }
  throw new Error(`Expected error ${code} but the command succeeded`);
}
