import { query, queryOne, RowDataPacket } from '../db/pool';
import { Principal } from '../types';
import { scopeSales, buildWhere, frag } from '../http/scope';
import { resolveWindow, minusMonths } from './common.repo';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function pctChange(cur: number, prev: number): number {
  if (prev === 0) return cur === 0 ? 0 : 100;
  return round1(((cur - prev) / prev) * 100);
}
function monthsBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z');
  const b = new Date(to + 'T00:00:00Z');
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1;
}

export interface ProductListItem {
  drugId: number;
  drugCode: string;
  drugName: string;
  genericName: string;
  taId: number;
  taName: string;
  unitPrice: number;
  dosageForm: string | null;
  strength: string | null;
  unitsSold: number;
  revenue: number;
  rxVolume: number;
  growthPct: number;
  marketSharePct: number;
}

// Allow-list mapping public sort field -> safe DB expression (already aliased in the query).
export const PRODUCT_SORT: Record<string, string> = {
  drugName: 'drugName',
  revenue: 'revenue',
  unitsSold: 'unitsSold',
  rxVolume: 'rxVolume',
  growthPct: 'growthPct',
  marketSharePct: 'marketSharePct',
  unitPrice: 'unitPrice',
};

export async function listProducts(
  p: Principal,
  opts: {
    from?: string;
    to?: string;
    regionIds: number[];
    taId?: number;
    q?: string;
    sortColumn: string;
    sortDir: 'ASC' | 'DESC';
    limit: number;
    offset: number;
  },
): Promise<{ items: ProductListItem[]; total: number }> {
  const { from, to } = await resolveWindow(opts.from, opts.to);
  const span = monthsBetween(from, to);
  const prevFrom = minusMonths(from, span);
  const prevTo = minusMonths(to, span);
  const salesScope = scopeSales(p, 's');
  const regionParams = opts.regionIds;
  const regionFrag = regionParams.length ? ` AND s.region_id IN (${regionParams.map(() => '?').join(',')})` : '';
  const scopeSql = salesScope.sql ? ` AND (${salesScope.sql})` : '';

  const drugFilters: string[] = [];
  const drugParams: unknown[] = [];
  if (opts.taId) {
    drugFilters.push('d.ta_id = ?');
    drugParams.push(opts.taId);
  }
  if (opts.q) {
    drugFilters.push('(d.drug_name LIKE ? OR d.generic_name LIKE ? OR d.drug_code LIKE ?)');
    const like = `%${opts.q}%`;
    drugParams.push(like, like, like);
  }
  const drugWhere = drugFilters.length ? 'WHERE ' + drugFilters.join(' AND ') : '';

  // Aggregate current + previous revenue/units per drug via scoped subqueries.
  const baseSql = `
    SELECT d.drug_id AS drugId, d.drug_code AS drugCode, d.drug_name AS drugName, d.generic_name AS genericName,
           d.ta_id AS taId, ta.ta_name AS taName, d.unit_price AS unitPrice, d.dosage_form AS dosageForm, d.strength AS strength,
           COALESCE(cur.revenue,0) AS revenue, COALESCE(cur.units,0) AS unitsSold,
           COALESCE(rx.rx,0) AS rxVolume, COALESCE(prev.revenue,0) AS prevRevenue,
           COALESCE(ms.share,0) AS marketSharePct,
           ROUND(CASE WHEN COALESCE(prev.revenue,0)=0 THEN (CASE WHEN COALESCE(cur.revenue,0)=0 THEN 0 ELSE 100 END)
                      ELSE (COALESCE(cur.revenue,0)-COALESCE(prev.revenue,0))/COALESCE(prev.revenue,0)*100 END,1) AS growthPct
      FROM drugs d
      JOIN therapeutic_areas ta ON ta.ta_id = d.ta_id
      LEFT JOIN (
        SELECT s.drug_id, SUM(s.revenue) AS revenue, SUM(s.units_sold) AS units
          FROM sales s WHERE s.sale_date BETWEEN ? AND ?${scopeSql}${regionFrag}
         GROUP BY s.drug_id
      ) cur ON cur.drug_id = d.drug_id
      LEFT JOIN (
        SELECT s.drug_id, SUM(s.revenue) AS revenue
          FROM sales s WHERE s.sale_date BETWEEN ? AND ?${scopeSql}${regionFrag}
         GROUP BY s.drug_id
      ) prev ON prev.drug_id = d.drug_id
      LEFT JOIN (
        SELECT rx.drug_id, SUM(rx.units) AS rx
          FROM prescriptions rx WHERE rx.prescription_date BETWEEN ? AND ?
         GROUP BY rx.drug_id
      ) rx ON rx.drug_id = d.drug_id
      LEFT JOIN (
        SELECT drug_id, AVG(our_share_pct) AS share FROM market_share
         WHERE period_month = (SELECT MAX(period_month) FROM market_share) GROUP BY drug_id
      ) ms ON ms.drug_id = d.drug_id
      ${drugWhere}`;

  const scopeParamsCur = salesScope.params;
  const params: unknown[] = [
    from, to, ...scopeParamsCur, ...regionParams,
    prevFrom, prevTo, ...scopeParamsCur, ...regionParams,
    from, to,
    ...drugParams,
  ];

  // total = count of drugs matching the drug-level filter (product catalogue is the population).
  const countRow = await queryOne<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM drugs d ${drugWhere}`,
    drugParams,
  );
  const total = countRow?.n ?? 0;

  const rows = await query<RowDataPacket & ProductListItem & { prevRevenue: number }>(
    `${baseSql} ORDER BY ${opts.sortColumn} ${opts.sortDir} LIMIT ? OFFSET ?`,
    [...params, opts.limit, opts.offset],
  );

  const items: ProductListItem[] = rows.map((r) => ({
    drugId: r.drugId,
    drugCode: r.drugCode,
    drugName: r.drugName,
    genericName: r.genericName,
    taId: r.taId,
    taName: r.taName,
    unitPrice: round2(Number(r.unitPrice)),
    dosageForm: r.dosageForm,
    strength: r.strength,
    unitsSold: Number(r.unitsSold),
    revenue: round2(Number(r.revenue)),
    rxVolume: Number(r.rxVolume),
    growthPct: Number(r.growthPct),
    marketSharePct: round1(Number(r.marketSharePct)),
  }));
  return { items, total };
}

export async function getProductDetail(p: Principal, drugId: number): Promise<ProductListItem | null> {
  const range = await resolveWindow(undefined, undefined);
  return listOneProduct(p, drugId, range.from, range.to);
}

async function listOneProduct(p: Principal, drugId: number, from: string, to: string): Promise<ProductListItem | null> {
  const salesScope = scopeSales(p, 's');
  const scopeSql = salesScope.sql ? ` AND (${salesScope.sql})` : '';
  const span = monthsBetween(from, to);
  const prevFrom = minusMonths(from, span);
  const prevTo = minusMonths(to, span);
  const row = await queryOne<RowDataPacket & ProductListItem>(
    `SELECT d.drug_id AS drugId, d.drug_code AS drugCode, d.drug_name AS drugName, d.generic_name AS genericName,
            d.ta_id AS taId, ta.ta_name AS taName, d.unit_price AS unitPrice, d.dosage_form AS dosageForm, d.strength AS strength,
            COALESCE((SELECT SUM(s.units_sold) FROM sales s WHERE s.drug_id=d.drug_id AND s.sale_date BETWEEN ? AND ?${scopeSql}),0) AS unitsSold,
            COALESCE((SELECT SUM(s.revenue) FROM sales s WHERE s.drug_id=d.drug_id AND s.sale_date BETWEEN ? AND ?${scopeSql}),0) AS revenue,
            COALESCE((SELECT SUM(rx.units) FROM prescriptions rx WHERE rx.drug_id=d.drug_id AND rx.prescription_date BETWEEN ? AND ?),0) AS rxVolume,
            COALESCE((SELECT AVG(our_share_pct) FROM market_share WHERE drug_id=d.drug_id AND period_month=(SELECT MAX(period_month) FROM market_share)),0) AS marketSharePct
       FROM drugs d JOIN therapeutic_areas ta ON ta.ta_id = d.ta_id
      WHERE d.drug_id = ?`,
    [from, to, ...salesScope.params, from, to, ...salesScope.params, from, to, drugId],
  );
  if (!row) return null;
  const prevRev = await queryOne<RowDataPacket & { r: number }>(
    `SELECT COALESCE(SUM(s.revenue),0) AS r FROM sales s WHERE s.drug_id=? AND s.sale_date BETWEEN ? AND ?${scopeSql}`,
    [drugId, prevFrom, prevTo, ...salesScope.params],
  );
  return {
    drugId: row.drugId,
    drugCode: row.drugCode,
    drugName: row.drugName,
    genericName: row.genericName,
    taId: row.taId,
    taName: row.taName,
    unitPrice: round2(Number(row.unitPrice)),
    dosageForm: row.dosageForm,
    strength: row.strength,
    unitsSold: Number(row.unitsSold),
    revenue: round2(Number(row.revenue)),
    rxVolume: Number(row.rxVolume),
    growthPct: pctChange(Number(row.revenue), Number(prevRev?.r ?? 0)),
    marketSharePct: round1(Number(row.marketSharePct)),
  };
}

export async function getProductTrend(
  p: Principal,
  drugId: number,
  from?: string,
  to?: string,
): Promise<{ period: string; revenue: number; units: number }[]> {
  const range = await resolveWindow(from, to);
  const salesScope = scopeSales(p, 's');
  const where = buildWhere([frag('s.drug_id = ?', drugId), frag('s.sale_date BETWEEN ? AND ?', range.from, range.to), salesScope]);
  const rows = await query<RowDataPacket & { period: string; revenue: number; units: number }>(
    `SELECT DATE_FORMAT(s.sale_date, '%Y-%m') AS period, SUM(s.revenue) AS revenue, SUM(s.units_sold) AS units
       FROM sales s ${where.sql} GROUP BY period ORDER BY period`,
    where.params,
  );
  return rows.map((r) => ({ period: r.period, revenue: round2(Number(r.revenue)), units: Number(r.units) }));
}

export async function getProductRegional(
  p: Principal,
  drugId: number,
  from?: string,
  to?: string,
): Promise<{ regionId: number; regionName: string; revenue: number; units: number; marketSharePct: number }[]> {
  const range = await resolveWindow(from, to);
  const salesScope = scopeSales(p, 's');
  const where = buildWhere([frag('s.drug_id = ?', drugId), frag('s.sale_date BETWEEN ? AND ?', range.from, range.to), salesScope]);
  const rows = await query<RowDataPacket & { regionId: number; regionName: string; revenue: number; units: number }>(
    `SELECT s.region_id AS regionId, r.region_name AS regionName, SUM(s.revenue) AS revenue, SUM(s.units_sold) AS units
       FROM sales s JOIN regions r ON r.region_id = s.region_id
       ${where.sql} GROUP BY s.region_id, r.region_name ORDER BY revenue DESC`,
    where.params,
  );
  const share = await query<RowDataPacket & { regionId: number; share: number }>(
    `SELECT region_id AS regionId, AVG(our_share_pct) AS share FROM market_share
      WHERE drug_id = ? AND period_month=(SELECT MAX(period_month) FROM market_share) GROUP BY region_id`,
    [drugId],
  );
  const shareMap = new Map(share.map((s) => [s.regionId, Number(s.share)]));
  return rows.map((r) => ({
    regionId: r.regionId,
    regionName: r.regionName,
    revenue: round2(Number(r.revenue)),
    units: Number(r.units),
    marketSharePct: round1(shareMap.get(r.regionId) ?? 0),
  }));
}

export async function getProductCompetitors(
  drugId: number,
): Promise<{ competitorDrugId: number; competitorName: string; companyName: string; unitPrice: number | null; competitorSharePct: number | null }[]> {
  const rows = await query<
    RowDataPacket & { competitorDrugId: number; competitorName: string; companyName: string; unitPrice: number | null; competitorSharePct: number | null }
  >(
    `SELECT cd.competitor_drug_id AS competitorDrugId, cd.drug_name AS competitorName, c.company_name AS companyName,
            cd.unit_price AS unitPrice,
            (SELECT AVG(ms.competitor_share_pct) FROM market_share ms
              WHERE ms.competitor_drug_id = cd.competitor_drug_id
                AND ms.period_month=(SELECT MAX(period_month) FROM market_share)) AS competitorSharePct
       FROM competitor_drugs cd JOIN competitors c ON c.competitor_id = cd.competitor_id
      WHERE cd.rival_drug_id = ?`,
    [drugId],
  );
  return rows.map((r) => ({
    competitorDrugId: r.competitorDrugId,
    competitorName: r.competitorName,
    companyName: r.companyName,
    unitPrice: r.unitPrice == null ? null : round2(Number(r.unitPrice)),
    competitorSharePct: r.competitorSharePct == null ? null : round1(Number(r.competitorSharePct)),
  }));
}

export async function productExists(drugId: number): Promise<boolean> {
  const r = await queryOne<RowDataPacket>('SELECT drug_id FROM drugs WHERE drug_id = ?', [drugId]);
  return !!r;
}
