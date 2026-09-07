import { Router, Request, Response } from 'express';
import * as service from '../services/reps.service';
import { ok, ApiError } from '../http/envelope';
import { asyncHandler } from '../http/middleware';
import { authenticate, principal } from '../auth/middleware';
import { commonFilters, limitParam } from '../http/filters';
import { parsePagination, parseSort } from '../http/query';
import { REP_SORT } from '../repositories/reps.repo';

export const repsRouter = Router();
repsRouter.use(authenticate);

function repIdParam(req: Request): number {
  const n = Number(req.params.repId);
  if (!Number.isInteger(n) || n <= 0) throw ApiError.validation('repId must be a positive integer');
  return n;
}

repsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const f = commonFilters(req);
    const { page, pageSize, offset } = parsePagination(req);
    const sort = parseSort(req, REP_SORT, { column: 'revenue', direction: 'DESC' });
    const { items, total } = await service.listReps(principal(req), {
      from: f.from,
      to: f.to,
      regionIds: f.regionIds,
      sortColumn: sort.column,
      sortDir: sort.direction,
      limit: pageSize,
      offset,
    });
    res.json(ok(items, { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }));
  }),
);

repsRouter.get(
  '/:repId',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getRepDetail(principal(req), repIdParam(req));
    res.json(ok(data));
  }),
);

repsRouter.get(
  '/:repId/hcps',
  asyncHandler(async (req: Request, res: Response) => {
    await service.ensureRepVisible(principal(req), repIdParam(req));
    const data = await service.getRepHcps(repIdParam(req));
    res.json(ok(data));
  }),
);

repsRouter.get(
  '/:repId/recommended-hcps',
  asyncHandler(async (req: Request, res: Response) => {
    const limit = limitParam(req, 10, 50);
    const data = await service.getRecommendedHcps(principal(req), repIdParam(req), limit);
    res.json(ok(data));
  }),
);
