import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as service from '../services/analytics.service';
import { ok } from '../http/envelope';
import { asyncHandler } from '../http/middleware';
import { authenticate, principal } from '../auth/middleware';
import { enumParam, intParam, optIntParam, dateParam, strParam, parseBody, parsePagination } from '../http/query';

export const analyticsRouter = Router();
analyticsRouter.use(authenticate);

// GET /api/forecast
analyticsRouter.get(
  '/forecast',
  asyncHandler(async (req: Request, res: Response) => {
    const entityType = enumParam(req, 'entityType', ['COMPANY', 'DRUG', 'REGION', 'TA'] as const) ?? 'COMPANY';
    const entityId = optIntParam(req, 'entityId') ?? null;
    const horizon = intParam(req, 'horizon', 6, { min: 1, max: 24 });
    res.json(ok(await service.forecast(entityType, entityId, horizon)));
  }),
);

// GET /api/anomalies
analyticsRouter.get(
  '/anomalies',
  asyncHandler(async (req: Request, res: Response) => {
    const severity = enumParam(req, 'severity', ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const);
    const direction = enumParam(req, 'direction', ['DROP', 'SPIKE'] as const);
    const from = dateParam(req, 'from');
    const to = dateParam(req, 'to');
    const { page, pageSize, offset } = parsePagination(req);
    const { items, total } = await service.anomalies(principal(req), {
      severity, direction, from, to, limit: pageSize, offset,
    });
    res.json(ok(items, { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }));
  }),
);

// POST /api/analytics/why-did-sales-change
const rootCauseSchema = z.object({
  drugId: z.number().int().positive(),
  regionId: z.number().int().positive(),
  periodMonths: z.number().int().min(1).max(24).optional(),
});
analyticsRouter.post(
  '/analytics/why-did-sales-change',
  asyncHandler(async (req: Request, res: Response) => {
    const body = parseBody(rootCauseSchema, req.body);
    res.json(ok(await service.whyDidSalesChange({ ...body, periodMonths: body.periodMonths ?? 3 })));
  }),
);

// GET /api/recommendations
analyticsRouter.get(
  '/recommendations',
  asyncHandler(async (req: Request, res: Response) => {
    const role = strParam(req, 'role');
    const limit = intParam(req, 'limit', 10, { min: 1, max: 50 });
    res.json(ok(await service.recommendations(principal(req), role, limit)));
  }),
);
