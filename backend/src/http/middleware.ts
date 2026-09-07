import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ApiError, fail } from './envelope';
import { logger } from '../logger';

/** Wrap an async route handler so thrown errors reach the central error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json(fail('NOT_FOUND', 'Route not found'));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    if (err.status >= 500) logger.error({ err, path: req.path }, 'ApiError');
    res.status(err.status).json(fail(err.code, err.message, err.details));
    return;
  }

  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({ path: e.path.join('.'), message: e.message }));
    res.status(400).json(fail('VALIDATION_ERROR', 'Request validation failed', details));
    return;
  }

  // Unknown / unexpected error — never leak internals to the client.
  logger.error({ err, path: req.path }, 'Unhandled error');
  res.status(500).json(fail('INTERNAL', 'An unexpected error occurred'));
}
