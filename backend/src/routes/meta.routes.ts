import { Router, Request, Response } from 'express';
import * as metaRepo from '../repositories/meta.repo';
import { ok } from '../http/envelope';
import { asyncHandler } from '../http/middleware';
import { authenticate, principal } from '../auth/middleware';

export const metaRouter = Router();
metaRouter.use(authenticate);

metaRouter.get(
  '/filters',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(ok(await metaRepo.getFilters(principal(req))));
  }),
);
