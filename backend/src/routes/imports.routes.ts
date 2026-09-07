import { Router, Request, Response } from 'express';
import multer from 'multer';
import { Readable } from 'stream';
import csv from 'csv-parser';
import { ok, fail } from '../http/envelope';
import { asyncHandler } from '../http/middleware';
import { authenticate } from '../auth/middleware';
import { mlClient } from '../ml/client';
import { logger } from '../logger';
import * as importsService from '../services/imports.service';
import { query as dbQuery } from '../db/pool';
import { RowDataPacket } from 'mysql2/promise';

export const importsRouter = Router();
importsRouter.use(authenticate);

// File size: 10 MB max. Row count limits enforced during parsing.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ============================================================================
// SALES API
// ============================================================================

/**
 * POST /api/sales/manual
 * Accept one sale JSON object, validate, and insert.
 */
importsRouter.post(
  '/sales/manual',
  asyncHandler(async (req: Request, res: Response) => {
    const row: importsService.SalesImportRow = req.body;

    try {
      const result = await importsService.insertSaleManual(row);
      res.json(ok({ ...result, message: 'Sale record created successfully' }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err }, 'Manual sale insertion failed');
      res.status(400).json(fail('VALIDATION_ERROR', msg));
    }
  })
);

/**
 * POST /api/sales/upload-csv
 * Accept CSV file, validate all rows, insert valid ones transactionally.
 * Trigger ML refresh asynchronously after successful commit.
 */
importsRouter.post(
  '/sales/upload-csv',
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json(fail('VALIDATION_ERROR', 'No file provided'));
    }

    const rows: importsService.SalesImportRow[] = [];
    const MAX_ROWS = 50000;

    // Parse CSV from buffer
    await new Promise<void>((resolve, reject) => {
      Readable.from([req.file!.buffer])
        .pipe(csv())
        .on('data', (row: Record<string, unknown>) => {
          if (rows.length >= MAX_ROWS) {
            reject(new Error(`CSV exceeds maximum row count of ${MAX_ROWS}`));
            return;
          }
          // Normalize header case
          const normalized: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(row)) {
            normalized[key.trim().toLowerCase()] = val;
          }
          rows.push({
            drugCode: String(normalized.drug_code ?? '').trim(),
            repCode: String(normalized.rep_code ?? '').trim(),
            regionName: String(normalized.region_name ?? '').trim(),
            cityName: String(normalized.city_name ?? '').trim(),
            saleDate: String(normalized.sale_date ?? '').trim(),
            unitsSold: normalized.units_sold != null ? Number(normalized.units_sold) : NaN,
            unitPrice: normalized.unit_price != null ? Number(normalized.unit_price) : NaN,
            discountPct: normalized.discount_pct != null ? Number(normalized.discount_pct) : NaN,
            channel: (String(normalized.channel ?? '').trim().toUpperCase() as any) ?? 'RETAIL',
            hcpCode: normalized.hcp_code ? String(normalized.hcp_code).trim() : undefined,
          });
        })
        .on('end', resolve)
        .on('error', reject);
    });

    if (rows.length === 0) {
      return res.status(400).json(fail('VALIDATION_ERROR', 'CSV file contains no data rows'));
    }

    const importResult = await importsService.validateAndInsertSales(rows);
    const failedCount = importResult.rowResults.filter(r => r.status === 'invalid').length;
    const failedRows = importResult.rowResults.filter(r => r.status === 'invalid');

    // Log in background; don't block response
    if (importResult.importedCount > 0) {
      mlClient.refreshAll?.().catch(err => {
        logger.error({ err }, 'ML refresh failed after sales import');
      });
    }

    res.json(
      ok({
        importedCount: importResult.importedCount,
        failedCount,
        totalRows: rows.length,
        failedRows: failedRows.slice(0, 100), // Cap error list to first 100
      })
    );
  })
);

// ============================================================================
// INVENTORY API
// ============================================================================

/**
 * POST /api/inventory/manual
 * Accept one inventory record, validate, and upsert it.
 */
importsRouter.post(
  '/inventory/manual',
  asyncHandler(async (req: Request, res: Response) => {
    const row: importsService.InventoryImportRow = req.body;

    try {
      const result = await importsService.insertInventoryManual(row);
      res.json(ok({ ...result, message: 'Inventory snapshot created/updated successfully' }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err }, 'Manual inventory insertion failed');
      res.status(400).json(fail('VALIDATION_ERROR', msg));
    }
  })
);

/**
 * POST /api/inventory/upload-csv
 * Accept CSV file, validate all rows, upsert valid ones transactionally.
 * Trigger ML refresh asynchronously after successful commit.
 */
importsRouter.post(
  '/inventory/upload-csv',
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json(fail('VALIDATION_ERROR', 'No file provided'));
    }

    const rows: importsService.InventoryImportRow[] = [];
    const MAX_ROWS = 10000;

    // Parse CSV from buffer
    await new Promise<void>((resolve, reject) => {
      Readable.from([req.file!.buffer])
        .pipe(csv())
        .on('data', (row: Record<string, unknown>) => {
          if (rows.length >= MAX_ROWS) {
            reject(new Error(`CSV exceeds maximum row count of ${MAX_ROWS}`));
            return;
          }
          // Normalize header case
          const normalized: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(row)) {
            normalized[key.trim().toLowerCase()] = val;
          }
          rows.push({
            drugCode: String(normalized.drug_code ?? '').trim(),
            regionName: String(normalized.region_name ?? '').trim(),
            snapshotMonth: String(normalized.snapshot_month ?? '').trim(),
            openingStock: normalized.opening_stock != null ? Number(normalized.opening_stock) : NaN,
            unitsIn: normalized.units_in != null ? Number(normalized.units_in) : NaN,
            unitsOut: normalized.units_out != null ? Number(normalized.units_out) : NaN,
            closingStock: normalized.closing_stock != null ? Number(normalized.closing_stock) : NaN,
            stockoutDays: normalized.stockout_days != null ? Number(normalized.stockout_days) : undefined,
          });
        })
        .on('end', resolve)
        .on('error', reject);
    });

    if (rows.length === 0) {
      return res.status(400).json(fail('VALIDATION_ERROR', 'CSV file contains no data rows'));
    }

    const importResult = await importsService.validateAndInsertInventory(rows);
    const failedCount = importResult.rowResults.filter(r => r.status === 'invalid').length;
    const failedRows = importResult.rowResults.filter(r => r.status === 'invalid');

    // Log in background; don't block response
    if (importResult.importedCount > 0) {
      mlClient.refreshAll?.().catch(err => {
        logger.error({ err }, 'ML refresh failed after inventory import');
      });
    }

    res.json(
      ok({
        importedCount: importResult.importedCount,
        failedCount,
        totalRows: rows.length,
        failedRows: failedRows.slice(0, 100), // Cap error list to first 100
      })
    );
  })
);

// ============================================================================
// TEMPLATE GENERATION
// ============================================================================

/**
 * GET /api/imports/template/:type
 * Generate a CSV template with valid examples/structure.
 * Supports 'sales' and 'inventory'.
 */
importsRouter.get(
  '/template/:type',
  asyncHandler(async (req: Request, res: Response) => {
    const typeParam = req.params.type;
    const type = Array.isArray(typeParam) ? typeParam[0] : typeParam;
    const typeStr = type?.toLowerCase() ?? '';

    if (typeStr === 'sales') {
      const [drugs, reps, regions, cities] = await Promise.all([
        dbQuery<RowDataPacket & { drugCode: string; drugName: string }>(
          'SELECT drug_code AS drugCode, drug_name AS drugName FROM drugs WHERE is_active = 1 LIMIT 5'
        ),
        dbQuery<RowDataPacket & { repCode: string; fullName: string }>(
          'SELECT rep_code AS repCode, full_name AS fullName FROM sales_reps WHERE is_active = 1 LIMIT 5'
        ),
        dbQuery<RowDataPacket & { regionName: string }>(
          'SELECT DISTINCT region_name AS regionName FROM regions LIMIT 5'
        ),
        dbQuery<RowDataPacket & { cityName: string }>(
          'SELECT DISTINCT city_name AS cityName FROM cities LIMIT 5'
        ),
      ]);

      const headers = ['drug_code', 'rep_code', 'region_name', 'city_name', 'sale_date', 'units_sold', 'unit_price', 'discount_pct', 'channel', 'hcp_code'];
      const drugCode = drugs[0]?.drugCode ?? 'DRUG001';
      const repCode = reps[0]?.repCode ?? 'REP001';
      const regionName = regions[0]?.regionName ?? 'North';
      const cityName = cities[0]?.cityName ?? 'Delhi';

      const csv = [
        headers.join(','),
        `${drugCode},${repCode},${regionName},${cityName},2026-09-01,100,500.00,10,RETAIL,`,
        `${drugCode},${repCode},${regionName},${cityName},2026-09-02,50,500.00,5,HOSPITAL,`,
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="sales_template.csv"');
      return res.send(csv);
    }

    if (typeStr === 'inventory') {
      const [drugs, regions] = await Promise.all([
        dbQuery<RowDataPacket & { drugCode: string; drugName: string }>(
          'SELECT drug_code AS drugCode, drug_name AS drugName FROM drugs WHERE is_active = 1 LIMIT 5'
        ),
        dbQuery<RowDataPacket & { regionName: string }>(
          'SELECT DISTINCT region_name AS regionName FROM regions LIMIT 5'
        ),
      ]);

      const headers = ['drug_code', 'region_name', 'snapshot_month', 'opening_stock', 'units_in', 'units_out', 'closing_stock', 'stockout_days'];
      const drugCode = drugs[0]?.drugCode ?? 'DRUG001';
      const regionName = regions[0]?.regionName ?? 'North';

      const csv = [
        headers.join(','),
        `${drugCode},${regionName},2026-09,1000,500,300,1200,0`,
        `${drugCode},${regionName},2026-08,800,400,350,850,2`,
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="inventory_template.csv"');
      return res.send(csv);
    }

    res.status(400).json(fail('VALIDATION_ERROR', "type must be 'sales' or 'inventory'"));
  })
);
