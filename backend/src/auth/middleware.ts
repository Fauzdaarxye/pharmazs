import { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifyAccessToken } from './token';
import { ApiError } from '../http/envelope';
import { Principal, Role } from '../types';

/** Require a valid Bearer access token; attaches req.principal. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Missing bearer token');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) throw ApiError.unauthorized('Missing bearer token');
  req.principal = verifyAccessToken(token);
  next();
}

/** Require the principal's role to be in the allowed set. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const p = req.principal;
    if (!p) throw ApiError.unauthorized();
    if (!roles.includes(p.role)) throw ApiError.forbidden(`Requires role: ${roles.join(' or ')}`);
    next();
  };
}

/** Guaranteed-present principal accessor for handlers behind `authenticate`. */
export function principal(req: Request): Principal {
  if (!req.principal) throw ApiError.unauthorized();
  return req.principal;
}
