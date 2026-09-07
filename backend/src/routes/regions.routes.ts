import { Router, Request, Response } from 'express';
import * as repo from '../repositories/regions.repo';
import { ok, ApiError } from '../http/envelope';
import { asyncHandler } from '../http/middleware';
import { authenticate, principal } from '../auth/middleware';
import { commonFilters } from '../http/filters';
import { enumParam } from '../http/query';

export const regionsRouter = Router();
regionsRouter.use(authenticate);

function regionIdParam(req: Request): number {
  const n = Number(req.params.regionId);
  if (!Number.isInteger(n) || n <= 0) throw ApiError.validation('regionId must be a positive integer');
  return n;
}

async function ensureVisible(req: Request, regionId: number): Promise<void> {
  if (!(await repo.regionExists(regionId))) throw ApiError.notFound(`Region ${regionId} not found`);
  const p = principal(req);
  if (p.role === 'MANAGER' && p.regionId !== regionId) throw ApiError.forbidden('This region is outside your scope');
}

regionsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const f = commonFilters(req);
    const data = await repo.listRegions(principal(req), f.from, f.to);
    res.json(ok(data));
  }),
);

regionsRouter.get(
  '/:regionId',
  asyncHandler(async (req: Request, res: Response) => {
    await ensureVisible(req, regionIdParam(req));
    const data = await repo.getRegion(principal(req), regionIdParam(req));
    if (!data) throw ApiError.notFound(`Region ${regionIdParam(req)} not found`);
    res.json(ok(data));
  }),
);

regionsRouter.get(
  '/:regionId/drilldown',
  asyncHandler(async (req: Request, res: Response) => {
    await ensureVisible(req, regionIdParam(req));
    const level = enumParam(req, 'level', ['city', 'ta', 'product'] as const) ?? 'city';
    const f = commonFilters(req);
    const data = await repo.drilldown(principal(req), regionIdParam(req), level, f.from, f.to);
    res.json(ok(data, { level }));
  }),
);
