import { Router, Request, Response } from 'express';
import * as service from '../services/products.service';
import { ok } from '../http/envelope';
import { asyncHandler } from '../http/middleware';
import { authenticate, principal } from '../auth/middleware';
import { commonFilters } from '../http/filters';
import { parsePagination, parseSort, strParam, intParam } from '../http/query';
import { PRODUCT_SORT } from '../repositories/products.repo';
import { ApiError } from '../http/envelope';

export const productsRouter = Router();
productsRouter.use(authenticate);

function drugIdParam(req: Request): number {
  const n = Number(req.params.drugId);
  if (!Number.isInteger(n) || n <= 0) throw ApiError.validation('drugId must be a positive integer');
  return n;
}

productsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const f = commonFilters(req);
    const { page, pageSize, offset } = parsePagination(req);
    const sort = parseSort(req, PRODUCT_SORT, { column: 'revenue', direction: 'DESC' });
    const { items, total } = await service.listProducts(principal(req), {
      from: f.from,
      to: f.to,
      regionIds: f.regionIds,
      taId: f.taId,
      q: strParam(req, 'q'),
      sortColumn: sort.column,
      sortDir: sort.direction,
      limit: pageSize,
      offset,
    });
    res.json(ok(items, { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }));
  }),
);

productsRouter.get(
  '/:drugId',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getProductDetail(principal(req), drugIdParam(req));
    res.json(ok(data));
  }),
);

productsRouter.get(
  '/:drugId/trend',
  asyncHandler(async (req: Request, res: Response) => {
    const f = commonFilters(req);
    await service.ensureProduct(drugIdParam(req));
    const data = await service.getProductTrend(principal(req), drugIdParam(req), f.from, f.to);
    res.json(ok(data));
  }),
);

productsRouter.get(
  '/:drugId/regional',
  asyncHandler(async (req: Request, res: Response) => {
    const f = commonFilters(req);
    await service.ensureProduct(drugIdParam(req));
    const data = await service.getProductRegional(principal(req), drugIdParam(req), f.from, f.to);
    res.json(ok(data));
  }),
);

productsRouter.get(
  '/:drugId/forecast',
  asyncHandler(async (req: Request, res: Response) => {
    const horizon = intParam(req, 'horizon', 6, { min: 1, max: 24 });
    const data = await service.getProductForecast(drugIdParam(req), horizon);
    res.json(ok(data));
  }),
);

productsRouter.get(
  '/:drugId/competitors',
  asyncHandler(async (req: Request, res: Response) => {
    await service.ensureProduct(drugIdParam(req));
    const data = await service.getProductCompetitors(drugIdParam(req));
    res.json(ok(data));
  }),
);
