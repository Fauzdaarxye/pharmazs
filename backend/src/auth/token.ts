import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { Principal, Role } from '../types';
import { ApiError } from '../http/envelope';

export interface AccessClaims {
  sub: number;
  email: string;
  role: Role;
  repId: number | null;
  regionId: number | null;
}

export function signAccessToken(claims: AccessClaims): string {
  const opts: SignOptions = { algorithm: 'HS256', expiresIn: config.jwt.accessTtl as SignOptions['expiresIn'] };
  return jwt.sign(claims, config.jwt.accessSecret, opts);
}

export function verifyAccessToken(token: string): Principal {
  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] }) as unknown as AccessClaims;
    return {
      userId: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      repId: decoded.repId ?? null,
      regionId: decoded.regionId ?? null,
    };
  } catch {
    throw ApiError.unauthorized('Invalid or expired access token');
  }
}

/** Opaque refresh token (random) + its sha256 hash for storage. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString('hex');
  const hash = hashToken(token);
  return { token, hash };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function refreshExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + config.jwt.refreshTtlDays);
  return d;
}
