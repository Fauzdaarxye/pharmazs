import { Router, Request, Response } from 'express';
import * as service from '../services/dashboard.service';
import { ok } from '../http/envelope';
import { asyncHandler } from '../http/middleware';
import { authenticate, principal } from '../auth/middleware';
import { commonFilters, limitParam } from '../http/filters';
import { enumParam, parsePagination } from '../http/query';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

dashboardRouter.get(
  '/kpis',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getKpis(principal(req), commonFilters(req));
    res.json(ok(data));
  }),
);

dashboardRouter.get(
  '/revenue-trend',
  asyncHandler(async (req: Request, res: Response) => {
    const granularity = enumParam(req, 'granularity', ['monthly', 'daily'] as const) ?? 'monthly';
    const data = await service.getRevenueTrend(principal(req), { ...commonFilters(req), granularity });
    res.json(ok(data));
  }),
);

dashboardRouter.get(
  '/therapeutic-areas',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getTherapeuticAreas(principal(req), commonFilters(req));
    res.json(ok(data));
  }),
);

dashboardRouter.get(
  '/regional-performance',
  asyncHandler(async (req: Request, res: Response) => {
    const { rows, highlights } = await service.getRegionalPerformance(principal(req), commonFilters(req));
    res.json(ok(rows, { highlights }));
  }),
);

dashboardRouter.get(
  '/top-products',
  asyncHandler(async (req: Request, res: Response) => {
    const limit = limitParam(req, 5, 50);
    const data = await service.getTopProducts(principal(req), { ...commonFilters(req), limit });
    res.json(ok(data));
  }),
);

dashboardRouter.get(
  '/top-hcps',
  asyncHandler(async (req: Request, res: Response) => {
    const limit = limitParam(req, 5, 50);
    const data = await service.getTopHcps(principal(req), { ...commonFilters(req), limit });
    res.json(ok(data));
  }),
);

dashboardRouter.get(
  '/alerts',
  asyncHandler(async (req: Request, res: Response) => {
    const severity = enumParam(req, 'severity', ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const);
    const isReadRaw = req.query.isRead;
    const isRead = isReadRaw === undefined ? undefined : isReadRaw === 'true' || isReadRaw === '1';
    const { page, pageSize, offset } = parsePagination(req);
    const { items, total } = await service.getAlerts(principal(req), {
      severity, isRead, limit: pageSize, offset,
    });
    res.json(ok(items, { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }));
  }),
);
