import { query, queryOne, RowDataPacket } from '../db/pool';
import { Principal } from '../types';
import { buildWhere, frag, ScopeClause } from '../http/scope';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const INVENTORY_SORT: Record<string, string> = {
  drugName: 'd.drug_name',
  closingStock: 'inv.closing_stock',
  coverMonths: '(inv.closing_stock / NULLIF(inv.units_out,0))',
  stockoutDays: 'inv.stockout_days',
};

export interface InventoryItem {
  drugId: number;
  drugName: string;
  regionId: number;
  regionName: string;
  snapshotMonth: string;
  closingStock: number;
  unitsOut: number;
  coverMonths: number;
  stockoutDays: number;
  riskFlag: 'HIGH' | 'MEDIUM' | 'LOW';
}

function regionScope(p: Principal): ScopeClause {
  return p.role === 'MANAGER' && p.regionId != null ? frag('inv.region_id = ?', p.regionId) : frag('');
}

function mapRow(r: RowDataPacket & InventoryItem & { unitsOut: number }): InventoryItem {
  const cover = Number(r.unitsOut) > 0 ? Number(r.closingStock) / Number(r.unitsOut) : 999;
  const risk: 'HIGH' | 'MEDIUM' | 'LOW' =
    Number(r.stockoutDays) > 5 || cover < 1 ? 'HIGH' : cover < 2 ? 'MEDIUM' : 'LOW';
  return {
    drugId: r.drugId,
    drugName: r.drugName,
    regionId: r.regionId,
    regionName: r.regionName,
    snapshotMonth: r.snapshotMonth,
    closingStock: Number(r.closingStock),
    unitsOut: Number(r.unitsOut),
    coverMonths: round1(cover === 999 ? 0 : cover),
    stockoutDays: Number(r.stockoutDays),
    riskFlag: risk,
  };
}

const LATEST = "inv.snapshot_month = (SELECT MAX(snapshot_month) FROM inventory_snapshots)";

const SELECT = `
  SELECT inv.drug_id AS drugId, d.drug_name AS drugName, inv.region_id AS regionId, r.region_name AS regionName,
         DATE_FORMAT(inv.snapshot_month,'%Y-%m') AS snapshotMonth, inv.closing_stock AS closingStock,
         inv.units_out AS unitsOut, inv.stockout_days AS stockoutDays
    FROM inventory_snapshots inv
    JOIN drugs d ON d.drug_id = inv.drug_id
    JOIN regions r ON r.region_id = inv.region_id`;

export async function listInventory(
  p: Principal,
  opts: { regionIds: number[]; drugId?: number; sortColumn: string; sortDir: 'ASC' | 'DESC'; limit: number; offset: number },
): Promise<{ items: InventoryItem[]; total: number }> {
  const filters: ScopeClause[] = [frag(LATEST), regionScope(p)];
  if (opts.regionIds.length) filters.push(frag(`inv.region_id IN (${opts.regionIds.map(() => '?').join(',')})`, ...opts.regionIds));
  if (opts.drugId) filters.push(frag('inv.drug_id = ?', opts.drugId));
  const where = buildWhere(filters);

  const total = (await queryOne<RowDataPacket & { n: number }>(`SELECT COUNT(*) AS n FROM inventory_snapshots inv ${where.sql}`, where.params))?.n ?? 0;
  const rows = await query<RowDataPacket & InventoryItem & { unitsOut: number }>(
    `${SELECT} ${where.sql} ORDER BY ${opts.sortColumn} ${opts.sortDir} LIMIT ? OFFSET ?`,
    [...where.params, opts.limit, opts.offset],
  );
  return { items: rows.map(mapRow), total };
}

export async function atRisk(p: Principal, limit: number): Promise<InventoryItem[]> {
  const where = buildWhere([frag(LATEST), regionScope(p)]);
  const rows = await query<RowDataPacket & InventoryItem & { unitsOut: number }>(
    `${SELECT} ${where.sql}
      ORDER BY inv.stockout_days DESC, (inv.closing_stock / NULLIF(inv.units_out,0)) ASC
      LIMIT ?`,
    [...where.params, limit],
  );
  return rows.map(mapRow).filter((r) => r.riskFlag !== 'LOW');
}
