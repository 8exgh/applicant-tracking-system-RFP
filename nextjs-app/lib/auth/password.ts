import bcrypt from 'bcrypt';
import { DomainError } from '@/lib/domain/errors';

// A short breached-password list stands in for a full k-anonymity check (F26)
const BREACHED = new Set(['password1234', 'passwordpassword', '123456789012', 'qwertyuiop12', 'letmeinletmein', 'welcome12345', 'adminadmin12']);

export function validatePassword(password: string): void {
  if (typeof password !== 'string' || password.length < 12) throw new DomainError('password_too_short', 'Use at least 12 characters', undefined, 400);
  if (BREACHED.has(password.toLowerCase())) throw new DomainError('password_breached', 'That password appears in breach lists; choose another', undefined, 400);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    // Constant-ish time: hash anyway so unknown accounts take as long as known ones
    await bcrypt.compare(password, '$2b$12$C6UzMDM.H6dfI/f/IKcEeO5aZcT0Cw3zTrbp9K6yZq3Yt4Yv7JzGa');
    return false;
  }
  return bcrypt.compare(password, hash);
}
