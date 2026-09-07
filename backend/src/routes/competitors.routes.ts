import { Router, Request, Response } from 'express';
import * as repo from '../repositories/competitors.repo';
import { ok } from '../http/envelope';
import { asyncHandler } from '../http/middleware';
import { authenticate, principal } from '../auth/middleware';
import { optIntParam } from '../http/query';

export const competitorsRouter = Router();
competitorsRouter.use(authenticate);

competitorsRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(ok(await repo.listCompetitors()));
  }),
);

competitorsRouter.get(
  '/market-share',
  asyncHandler(async (req: Request, res: Response) => {
    const drugId = optIntParam(req, 'drugId');
    const regionId = optIntParam(req, 'regionId');
    const data = await repo.marketShare(principal(req), drugId, regionId);
    res.json(ok(data));
  }),
);
