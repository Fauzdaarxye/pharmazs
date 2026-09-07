import { Router, Request, Response } from 'express';
import { ping } from '../db/pool';
import { mlReachable } from '../ml/client';
import { ok } from '../http/envelope';
import { asyncHandler } from '../http/middleware';

export const healthRouter = Router();

healthRouter.get(
  '/health',
  asyncHandler(async (_req: Request, res: Response) => {
    const [db, ml] = await Promise.all([
      ping().then(() => true).catch(() => false),
      mlReachable(),
    ]);
    const status = db ? 'ok' : 'degraded';
    res.status(db ? 200 : 503).json(
      ok({
        status,
        db: db ? 'up' : 'down',
        ml: ml ? 'up' : 'down',
        time: new Date().toISOString(),
      }),
    );
  }),
);
