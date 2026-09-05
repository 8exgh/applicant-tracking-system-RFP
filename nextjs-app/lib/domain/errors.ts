// Stable machine-readable error codes are the contract Part B asserts on
// (spec §7, Appendix B). Domain code throws these; the API maps them to HTTP.
export class DomainError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly status: number;
  constructor(code: string, message?: string, details?: unknown, status = 422) {
    super(message || code);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export class NotFoundError extends DomainError {
  constructor(what = 'not_found') { super(what, 'Not found', undefined, 404); }
}

export class ConcurrencyError extends DomainError {
  readonly currentVersion: number;
  constructor(currentVersion: number) {
    super('version_conflict', 'Stream version conflict', { currentVersion }, 412);
    this.currentVersion = currentVersion;
  }
}

export class ForbiddenError extends DomainError {
  constructor(code = 'forbidden', message = 'Forbidden') { super(code, message, undefined, 403); }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'DomainError');
}
