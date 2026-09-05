import jwt from 'jsonwebtoken';

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not defined');
  return s;
}

export interface SessionClaims {
  sid: string;                      // session id (rotated at every sign-in)
  kind: 'staff' | 'candidate' | 'platform';
  sub: string;                      // user id / candidate id / operator id
  tenantId?: string;
  exp?: number;
}

export function signSession(claims: Omit<SessionClaims, 'exp'>, expiresInSeconds: number): string {
  return jwt.sign(claims, secret(), { expiresIn: expiresInSeconds });
}

export function verifySession(token: string): SessionClaims | null {
  try {
    return jwt.verify(token, secret()) as SessionClaims;
  } catch {
    return null;
  }
}
