import { Router, Request, Response } from 'express';
import * as service from '../services/hcps.service';
import { ok } from '../http/envelope';
import { asyncHandler } from '../http/middleware';
import { authenticate, principal } from '../auth/middleware';
import { commonFilters } from '../http/filters';
import { parsePagination, parseSort, strParam, optIntParam, enumParam } from '../http/query';
import { HCP_SORT } from '../repositories/hcps.repo';
import { ApiError } from '../http/envelope';

export const hcpsRouter = Router();
hcpsRouter.use(authenticate);

function hcpIdParam(req: Request): number {
  const n = Number(req.params.hcpId);
  if (!Number.isInteger(n) || n <= 0) throw ApiError.validation('hcpId must be a positive integer');
  return n;
}

hcpsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const f = commonFilters(req);
    const { page, pageSize, offset } = parsePagination(req);
    const sort = parseSort(req, HCP_SORT, { column: 'potentialScore', direction: 'DESC' });
    const priority = enumParam(req, 'priority', ['HIGH', 'MEDIUM', 'LOW'] as const);
    const { items, total } = await service.listHcps(principal(req), {
      from: f.from,
      to: f.to,
      regionIds: f.regionIds,
      specialty: f.specialty,
      q: strParam(req, 'q'),
      priority,
      minScore: optIntParam(req, 'minScore'),
      sortColumn: sort.column,
      sortDir: sort.direction,
      limit: pageSize,
      offset,
    });
    res.json(ok(items, { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }));
  }),
);

hcpsRouter.get(
  '/summary',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getHcpSummary(principal(req));
    res.json(ok(data));
  }),
);

hcpsRouter.get(
  '/:hcpId',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getHcpDetail(principal(req), hcpIdParam(req));
    res.json(ok(data));
  }),
);

hcpsRouter.get(
  '/:hcpId/trend',
  asyncHandler(async (req: Request, res: Response) => {
    await service.ensureHcpVisible(principal(req), hcpIdParam(req));
    const data = await service.getHcpTrend(principal(req), hcpIdParam(req));
    res.json(ok(data));
  }),
);

hcpsRouter.get(
  '/:hcpId/score',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getHcpScore(principal(req), hcpIdParam(req));
    res.json(ok(data));
  }),
);
