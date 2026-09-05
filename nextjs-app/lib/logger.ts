// Leveled logger. Level comes from LOG_LEVEL (error, warn, info, debug);
// default info. One line per entry so docker logs stay grep-able:
//   2027-01-19T23:59:00.000Z INFO  [api/commands/submit-application] ...
// Never log personal information: identifiers only (spec §9.7, F16).
type Level = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function configuredLevel(): number {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase() as Level;
  return LEVEL_ORDER[raw] ?? LEVEL_ORDER.info;
}

function serialize(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'object' && value !== null) {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function write(level: Level, scope: string, message: string, extras: unknown[]): void {
  if (LEVEL_ORDER[level] > configuredLevel()) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const rest = extras.map(serialize).join(' ');
  const method = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  method(rest ? `${line} ${rest}` : line);
}

export interface Logger {
  error: (message: string, ...extras: unknown[]) => void;
  warn: (message: string, ...extras: unknown[]) => void;
  info: (message: string, ...extras: unknown[]) => void;
  debug: (message: string, ...extras: unknown[]) => void;
}

export function getLogger(scope: string): Logger {
  return {
    error: (m, ...e) => write('error', scope, m, e),
    warn: (m, ...e) => write('warn', scope, m, e),
    info: (m, ...e) => write('info', scope, m, e),
    debug: (m, ...e) => write('debug', scope, m, e)
  };
}
