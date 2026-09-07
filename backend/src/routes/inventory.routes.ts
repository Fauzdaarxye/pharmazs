import { Router, Request, Response } from 'express';
import * as repo from '../repositories/inventory.repo';
import { ok } from '../http/envelope';
import { asyncHandler } from '../http/middleware';
import { authenticate, principal } from '../auth/middleware';
import { commonFilters, limitParam } from '../http/filters';
import { parsePagination, parseSort } from '../http/query';
import { INVENTORY_SORT } from '../repositories/inventory.repo';

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);

inventoryRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const f = commonFilters(req);
    const { page, pageSize, offset } = parsePagination(req);
    const sort = parseSort(req, INVENTORY_SORT, { column: 'inv.stockout_days', direction: 'DESC' });
    const { items, total } = await repo.listInventory(principal(req), {
      regionIds: f.regionIds,
      drugId: f.drugId,
      sortColumn: sort.column,
      sortDir: sort.direction,
      limit: pageSize,
      offset,
    });
    res.json(ok(items, { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }));
  }),
);

inventoryRouter.get(
  '/at-risk',
  asyncHandler(async (req: Request, res: Response) => {
    const limit = limitParam(req, 20, 200);
    res.json(ok(await repo.atRisk(principal(req), limit)));
  }),
);
