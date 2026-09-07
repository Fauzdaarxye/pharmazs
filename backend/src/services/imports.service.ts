import { logger } from '../logger';
import { query as dbQuery, execute as dbExecute, pool } from '../db/pool';
import { RowDataPacket } from 'mysql2/promise';

// ============================================================================
// TYPES
// ============================================================================

export interface SalesImportRow {
  drugCode: string;
  repCode: string;
  regionName: string;
  cityName: string;
  saleDate: string;
  unitsSold: number;
  unitPrice: number;
  discountPct: number;
  channel: 'RETAIL' | 'HOSPITAL' | 'INSTITUTIONAL' | 'ONLINE';
  hcpCode?: string;
}

export interface InventoryImportRow {
  drugCode: string;
  regionName: string;
  snapshotMonth: string;
  openingStock: number;
  unitsIn: number;
  unitsOut: number;
  closingStock: number;
  stockoutDays?: number;
}

export interface RowValidationResult {
  rowNumber: number;
  status: 'valid' | 'invalid';
  error?: string;
}

export interface ImportResult {
  importedCount: number;
  failedCount: number;
  rowResults: RowValidationResult[];
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

function validateDateFormat(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function validateChannel(channel: string): boolean {
  return ['RETAIL', 'HOSPITAL', 'INSTITUTIONAL', 'ONLINE'].includes(channel);
}

function validateMonthFormat(monthStr: string): boolean {
  if (!monthStr || typeof monthStr !== 'string') return false;
  return /^\d{4}-\d{2}$/.test(monthStr);
}

// ============================================================================
// LOOKUP CACHES
// ============================================================================

interface LookupCache {
  drugs: Map<string, number>;
  reps: Map<string, number>;
  regions: Map<string, number>;
  cities: Map<string, { id: number; regionId: number }>;
  hcps: Map<string, number>;
}

async function buildLookupCache(): Promise<LookupCache> {
  const [drugs, reps, regions, cities, hcps] = await Promise.all([
    dbQuery<RowDataPacket & { drugCode: string; drugId: number }>(
      'SELECT drug_code AS drugCode, drug_id AS drugId FROM drugs WHERE is_active = 1'
    ),
    dbQuery<RowDataPacket & { repCode: string; repId: number }>(
      'SELECT rep_code AS repCode, rep_id AS repId FROM sales_reps WHERE is_active = 1'
    ),
    dbQuery<RowDataPacket & { regionName: string; regionId: number }>(
      'SELECT region_name AS regionName, region_id AS regionId FROM regions'
    ),
    dbQuery<RowDataPacket & { cityName: string; cityId: number; regionId: number }>(
      'SELECT city_name AS cityName, city_id AS cityId, region_id AS regionId FROM cities'
    ),
    dbQuery<RowDataPacket & { hcpCode: string; hcpId: number }>(
      'SELECT hcp_code AS hcpCode, hcp_id AS hcpId FROM hcps WHERE is_active = 1'
    ),
  ]);

  return {
    drugs: new Map(drugs.map(r => [r.drugCode, r.drugId])),
    reps: new Map(reps.map(r => [r.repCode, r.repId])),
    regions: new Map(regions.map(r => [r.regionName, r.regionId])),
    cities: new Map(cities.map(r => [r.cityName, { id: r.cityId, regionId: r.regionId }])),
    hcps: new Map(hcps.map(r => [r.hcpCode, r.hcpId])),
  };
}

// ============================================================================
// SALES IMPORT
// ============================================================================

export interface ValidatedSalesRow extends SalesImportRow {
  drugId: number;
  repId: number;
  regionId: number;
  cityId: number;
  hcpId: number | null;
}

async function validateSalesRow(
  row: SalesImportRow,
  rowNum: number,
  cache: LookupCache
): Promise<{ validated: ValidatedSalesRow | null; error?: string }> {
  // Required fields
  if (!row.drugCode) return { validated: null, error: 'drugCode is required' };
  if (!row.repCode) return { validated: null, error: 'repCode is required' };
  if (!row.regionName) return { validated: null, error: 'regionName is required' };
  if (!row.cityName) return { validated: null, error: 'cityName is required' };
  if (!row.saleDate) return { validated: null, error: 'saleDate is required' };
  if (row.unitsSold == null) return { validated: null, error: 'unitsSold is required' };
  if (row.unitPrice == null) return { validated: null, error: 'unitPrice is required' };
  if (row.discountPct == null) return { validated: null, error: 'discountPct is required' };
  if (!row.channel) return { validated: null, error: 'channel is required' };

  // Type checks
  const unitsSold = Number(row.unitsSold);
  const unitPrice = Number(row.unitPrice);
  const discountPct = Number(row.discountPct);

  if (!Number.isInteger(unitsSold) || unitsSold <= 0) {
    return { validated: null, error: 'unitsSold must be a positive integer' };
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return { validated: null, error: 'unitPrice must be non-negative' };
  }
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
    return { validated: null, error: 'discountPct must be between 0 and 100' };
  }

  // Format validation
  if (!validateDateFormat(row.saleDate)) {
    return { validated: null, error: 'saleDate must be YYYY-MM-DD format' };
  }
  if (!validateChannel(row.channel)) {
    return { validated: null, error: 'channel must be RETAIL, HOSPITAL, INSTITUTIONAL, or ONLINE' };
  }

  // Foreign key lookup
  const drugId = cache.drugs.get(row.drugCode);
  if (!drugId) return { validated: null, error: `drug_code '${row.drugCode}' not found` };

  const repId = cache.reps.get(row.repCode);
  if (!repId) return { validated: null, error: `rep_code '${row.repCode}' not found` };

  const regionId = cache.regions.get(row.regionName);
  if (!regionId) return { validated: null, error: `region_name '${row.regionName}' not found` };

  const city = cache.cities.get(row.cityName);
  if (!city) return { validated: null, error: `city_name '${row.cityName}' not found` };
  if (city.regionId !== regionId) {
    return { validated: null, error: `city_name '${row.cityName}' is not in region '${row.regionName}'` };
  }

  let hcpId: number | null = null;
  if (row.hcpCode) {
    hcpId = cache.hcps.get(row.hcpCode) ?? null;
    if (!hcpId) {
      return { validated: null, error: `hcp_code '${row.hcpCode}' not found` };
    }
  }

  return {
    validated: {
      ...row,
      drugId,
      repId,
      regionId,
      cityId: city.id,
      hcpId,
      unitsSold,
      unitPrice,
      discountPct,
    },
  };
}

export async function validateAndInsertSales(rows: SalesImportRow[]): Promise<ImportResult> {
  const cache = await buildLookupCache();
  const validated: ValidatedSalesRow[] = [];
  const rowResults: RowValidationResult[] = [];

  // Validate all rows first
  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // +1 for 0-index, +1 for header row
    const { validated: v, error } = await validateSalesRow(rows[i], rowNum, cache);

    if (error) {
      rowResults.push({ rowNumber: rowNum, status: 'invalid', error });
    } else if (v) {
      validated.push(v);
      rowResults.push({ rowNumber: rowNum, status: 'valid' });
    }
  }

  if (validated.length === 0) {
    return { importedCount: 0, failedCount: rows.length, rowResults };
  }

  // Insert valid rows transactionally
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const row of validated) {
      await conn.execute(
        `INSERT INTO sales (drug_id, rep_id, region_id, city_id, hcp_id, sale_date, units_sold, unit_price, discount_pct, channel)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` as never,
        [
          row.drugId,
          row.repId,
          row.regionId,
          row.cityId,
          row.hcpId ?? null,
          row.saleDate,
          row.unitsSold,
          row.unitPrice,
          row.discountPct,
          row.channel,
        ] as never
      );
    }

    await conn.commit();
    logger.info({ importedCount: validated.length }, 'Sales import committed');
  } catch (err) {
    await conn.rollback();
    logger.error({ err }, 'Sales import transaction failed');
    throw err;
  } finally {
    conn.release();
  }

  return { importedCount: validated.length, failedCount: rows.length - validated.length, rowResults };
}

// ============================================================================
// INVENTORY IMPORT
// ============================================================================

export interface ValidatedInventoryRow extends InventoryImportRow {
  drugId: number;
  regionId: number;
}

async function validateInventoryRow(
  row: InventoryImportRow,
  rowNum: number,
  cache: LookupCache
): Promise<{ validated: ValidatedInventoryRow | null; error?: string }> {
  // Required fields
  if (!row.drugCode) return { validated: null, error: 'drugCode is required' };
  if (!row.regionName) return { validated: null, error: 'regionName is required' };
  if (!row.snapshotMonth) return { validated: null, error: 'snapshotMonth is required' };
  if (row.openingStock == null) return { validated: null, error: 'openingStock is required' };
  if (row.unitsIn == null) return { validated: null, error: 'unitsIn is required' };
  if (row.unitsOut == null) return { validated: null, error: 'unitsOut is required' };
  if (row.closingStock == null) return { validated: null, error: 'closingStock is required' };

  // Type checks
  const openingStock = Number(row.openingStock);
  const unitsIn = Number(row.unitsIn);
  const unitsOut = Number(row.unitsOut);
  const closingStock = Number(row.closingStock);
  const stockoutDays = row.stockoutDays != null ? Number(row.stockoutDays) : 0;

  if (!Number.isInteger(openingStock) || openingStock < 0) {
    return { validated: null, error: 'openingStock must be a non-negative integer' };
  }
  if (!Number.isInteger(unitsIn) || unitsIn < 0) {
    return { validated: null, error: 'unitsIn must be a non-negative integer' };
  }
  if (!Number.isInteger(unitsOut) || unitsOut < 0) {
    return { validated: null, error: 'unitsOut must be a non-negative integer' };
  }
  if (!Number.isInteger(closingStock) || closingStock < 0) {
    return { validated: null, error: 'closingStock must be a non-negative integer' };
  }
  if (!Number.isInteger(stockoutDays) || stockoutDays < 0) {
    return { validated: null, error: 'stockoutDays must be a non-negative integer' };
  }

  // Format validation
  if (!validateMonthFormat(row.snapshotMonth)) {
    return { validated: null, error: 'snapshotMonth must be YYYY-MM format' };
  }

  // Foreign key lookup
  const drugId = cache.drugs.get(row.drugCode);
  if (!drugId) return { validated: null, error: `drug_code '${row.drugCode}' not found` };

  const regionId = cache.regions.get(row.regionName);
  if (!regionId) return { validated: null, error: `region_name '${row.regionName}' not found` };

  return {
    validated: {
      ...row,
      drugId,
      regionId,
      openingStock,
      unitsIn,
      unitsOut,
      closingStock,
      stockoutDays,
    },
  };
}

export async function validateAndInsertInventory(rows: InventoryImportRow[]): Promise<ImportResult> {
  const cache = await buildLookupCache();
  const validated: ValidatedInventoryRow[] = [];
  const rowResults: RowValidationResult[] = [];

  // Validate all rows first
  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // +1 for 0-index, +1 for header row
    const { validated: v, error } = await validateInventoryRow(rows[i], rowNum, cache);

    if (error) {
      rowResults.push({ rowNumber: rowNum, status: 'invalid', error });
    } else if (v) {
      validated.push(v);
      rowResults.push({ rowNumber: rowNum, status: 'valid' });
    }
  }

  if (validated.length === 0) {
    return { importedCount: 0, failedCount: rows.length, rowResults };
  }

  // Upsert valid rows transactionally with ON DUPLICATE KEY UPDATE
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const row of validated) {
      // Convert YYYY-MM to YYYY-MM-01 for the DATE column
      const snapshotDate = `${row.snapshotMonth}-01`;
      await conn.execute(
        `INSERT INTO inventory_snapshots (drug_id, region_id, snapshot_month, opening_stock, units_in, units_out, closing_stock, stockout_days)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           opening_stock = VALUES(opening_stock),
           units_in = VALUES(units_in),
           units_out = VALUES(units_out),
           closing_stock = VALUES(closing_stock),
           stockout_days = VALUES(stockout_days)` as never,
        [
          row.drugId,
          row.regionId,
          snapshotDate,
          row.openingStock,
          row.unitsIn,
          row.unitsOut,
          row.closingStock,
          row.stockoutDays,
        ] as never
      );
    }

    await conn.commit();
    logger.info({ upsertedCount: validated.length }, 'Inventory import committed');
  } catch (err) {
    await conn.rollback();
    logger.error({ err }, 'Inventory import transaction failed');
    throw err;
  } finally {
    conn.release();
  }

  return { importedCount: validated.length, failedCount: rows.length - validated.length, rowResults };
}

// ============================================================================
// MANUAL INSERTION
// ============================================================================

export async function insertSaleManual(row: SalesImportRow): Promise<{ saleId: number }> {
  const cache = await buildLookupCache();
  const { validated, error } = await validateSalesRow(row, 1, cache);

  if (error) {
    throw new Error(`Validation failed: ${error}`);
  }
  if (!validated) {
    throw new Error('Validation failed');
  }

  const result = await dbExecute(
    `INSERT INTO sales (drug_id, rep_id, region_id, city_id, hcp_id, sale_date, units_sold, unit_price, discount_pct, channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      validated.drugId,
      validated.repId,
      validated.regionId,
      validated.cityId,
      validated.hcpId ?? null,
      validated.saleDate,
      validated.unitsSold,
      validated.unitPrice,
      validated.discountPct,
      validated.channel,
    ]
  );

  return { saleId: result.insertId as number };
}

export async function insertInventoryManual(row: InventoryImportRow): Promise<{ snapshotId: number }> {
  const cache = await buildLookupCache();
  const { validated, error } = await validateInventoryRow(row, 1, cache);

  if (error) {
    throw new Error(`Validation failed: ${error}`);
  }
  if (!validated) {
    throw new Error('Validation failed');
  }

  const snapshotDate = `${validated.snapshotMonth}-01`;
  const result = await dbExecute(
    `INSERT INTO inventory_snapshots (drug_id, region_id, snapshot_month, opening_stock, units_in, units_out, closing_stock, stockout_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       opening_stock = VALUES(opening_stock),
       units_in = VALUES(units_in),
       units_out = VALUES(units_out),
       closing_stock = VALUES(closing_stock),
       stockout_days = VALUES(stockout_days)`,
    [
      validated.drugId,
      validated.regionId,
      snapshotDate,
      validated.openingStock,
      validated.unitsIn,
      validated.unitsOut,
      validated.closingStock,
      validated.stockoutDays ?? 0,
    ] as unknown[]
  );

  return { snapshotId: result.insertId as number };
}
