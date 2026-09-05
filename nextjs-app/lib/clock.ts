// Server time is authoritative for every deadline (spec §9.8). Tests set
// ATS_FAKE_CLOCK=1 and drive time with setFakeNow(); production never does.
let fakeNow: Date | null = null;

export function now(): Date {
  if (process.env.ATS_FAKE_CLOCK === '1' && fakeNow) return new Date(fakeNow.getTime());
  return new Date();
}

export function nowIso(): string {
  return now().toISOString();
}

export function setFakeNow(date: Date | string | null): void {
  if (process.env.ATS_FAKE_CLOCK !== '1') {
    throw new Error('setFakeNow requires ATS_FAKE_CLOCK=1');
  }
  fakeNow = date === null ? null : new Date(date);
}

// Interprets a wall-clock time ("2027-01-19 23:59") in an IANA zone and
// returns the instant. Intl has no inverse of formatToParts, so iterate once:
// guess UTC, measure the zone offset at that guess, correct, re-check (DST).
export function zonedTimeToUtc(wallClock: string, timeZone: string): Date {
  const m = wallClock.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) throw new Error(`Invalid wall-clock time: ${wallClock}`);
  const [, y, mo, d, h, mi, s] = m;
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0));
  const offset1 = zoneOffsetMs(new Date(asUtc), timeZone);
  let guess = asUtc - offset1;
  const offset2 = zoneOffsetMs(new Date(guess), timeZone);
  if (offset2 !== offset1) guess = asUtc - offset2;
  return new Date(guess);
}

export function zoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map(p => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - date.getTime();
}

export function zoneAbbreviation(date: Date, timeZone: string, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' }).formatToParts(date);
  return parts.find(p => p.type === 'timeZoneName')?.value || timeZone;
}
