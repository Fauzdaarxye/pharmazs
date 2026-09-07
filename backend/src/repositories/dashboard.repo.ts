import { query, queryOne, RowDataPacket } from '../db/pool';
import { Principal } from '../types';
import { scopeSales, scopeByHcp, buildWhere, frag, ScopeClause } from '../http/scope';
import { resolveWindow,
  priorWindow, monthSpan, minusMonths, dataDateRange } from './common.repo';

/**
 * All dashboard aggregates. SQL is parameterised; role scoping is applied in the
 * WHERE clause via the scope module. snake_case -> camelCase happens here.
 */

interface KpiRow extends RowDataPacket {
  revenue: number | null;
  units: number | null;
}
interface CountRow extends RowDataPacket {
  n: number;
}

export interface Kpis {
  totalRevenue: number;
  revenueGrowthPct: number;
  totalPrescriptions: number;
  activeHcps: number;
  marketSharePct: number;
  inventoryAvailabilityPct: number;
  totalProducts: number;
  totalReps: number;
  deltas: {
    totalRevenue: number;
    revenueGrowthPct: number;
    totalPrescriptions: number;
    activeHcps: number;
    marketSharePct: number;
    inventoryAvailabilityPct: number;
  };
  sparklines: { totalRevenue: number[] };
}

function pctChange(cur: number, prev: number): number {
  if (prev === 0) return cur === 0 ? 0 : 100;
  return round1(((cur - prev) / prev) * 100);
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getKpis(
  p: Principal,
  filters: { from?: string; to?: string; regionIds: number[]; taId?: number; drugId?: number },
): Promise<Kpis> {
  const range = await dataDateRange();
  // ONE window governs both the headline totals and the deltas. Previously the
  // totals spanned the whole dataset while the deltas compared trailing periods,
  // so the card read ₹1892 Cr (all 24 months) directly beneath a "Last 12 Months"
  // filter chip, and the regional table underneath it summed to ₹1088 Cr. A KPI
  // that disagrees with the filter above it and the table below it is worse than
  // no KPI.
  const { from, to } = await resolveWindow(filters.from, filters.to);
  const prevWin = priorWindow(from, to);
  const prevFrom = prevWin.from;
  const prevTo = prevWin.to;
  const totalFrom = from;
  const totalTo = to;
  void range;

  const salesScope = scopeSales(p, 's');

  const salesFrags = (f: string, t: string): ScopeClause[] => [
    frag('s.sale_date BETWEEN ? AND ?', f, t),
    salesScope,
    ...(filters.regionIds.length ? [frag(`s.region_id IN (${filters.regionIds.map(() => '?').join(',')})`, ...filters.regionIds)] : []),
    ...(filters.drugId ? [frag('s.drug_id = ?', filters.drugId)] : []),
    ...(filters.taId ? [frag('s.drug_id IN (SELECT drug_id FROM drugs WHERE ta_id = ?)', filters.taId)] : []),
  ];

  const totalWhere = buildWhere(salesFrags(totalFrom, totalTo));
  const curWhere = buildWhere(salesFrags(from, to));
  const prevWhere = buildWhere(salesFrags(prevFrom, prevTo));

  const [totalSales, cur, prev] = await Promise.all([
    queryOne<KpiRow>(`SELECT SUM(s.revenue) AS revenue, SUM(s.units_sold) AS units FROM sales s ${totalWhere.sql}`, totalWhere.params),
    queryOne<KpiRow>(`SELECT SUM(s.revenue) AS revenue, SUM(s.units_sold) AS units FROM sales s ${curWhere.sql}`, curWhere.params),
    queryOne<KpiRow>(`SELECT SUM(s.revenue) AS revenue, SUM(s.units_sold) AS units FROM sales s ${prevWhere.sql}`, prevWhere.params),
  ]);

  const totalRevenue = Number(totalSales?.revenue ?? 0);
  const curRevenue = Number(cur?.revenue ?? 0);
  const prevRevenue = Number(prev?.revenue ?? 0);

  // Prescriptions in window (scoped): reps -> their panel's HCPs; managers -> region.
  const rxScope = scopeByHcp(p, 'rx.hcp_id', 'rx.region_id');
  const rxTotalFrags: ScopeClause[] = [
    frag('rx.prescription_date BETWEEN ? AND ?', totalFrom, totalTo),
    rxScope,
    ...(filters.regionIds.length ? [frag(`rx.region_id IN (${filters.regionIds.map(() => '?').join(',')})`, ...filters.regionIds)] : []),
    ...(filters.drugId ? [frag('rx.drug_id = ?', filters.drugId)] : []),
    ...(filters.taId ? [frag('rx.drug_id IN (SELECT drug_id FROM drugs WHERE ta_id = ?)', filters.taId)] : []),
  ];
  const rxTotalWhere = buildWhere(rxTotalFrags);
  const rxRow = await queryOne<RowDataPacket & { rx: number }>(
    `SELECT COUNT(*) AS rx FROM prescriptions rx ${rxTotalWhere.sql}`  /* COUNT: a prescription is a script, not a tablet */,
    rxTotalWhere.params,
  );
  // trailing + prior period Rx for the delta.
  const curRxWhere = buildWhere([frag('rx.prescription_date BETWEEN ? AND ?', from, to), rxScope]);
  const curRxRow = await queryOne<RowDataPacket & { rx: number }>(
    `SELECT COUNT(*) AS rx FROM prescriptions rx ${curRxWhere.sql}`,
    curRxWhere.params,
  );
  const prevRxWhere = buildWhere([frag('rx.prescription_date BETWEEN ? AND ?', prevFrom, prevTo), rxScope]);
  const prevRxRow = await queryOne<RowDataPacket & { rx: number }>(
    `SELECT COUNT(*) AS rx FROM prescriptions rx ${prevRxWhere.sql}`,
    prevRxWhere.params,
  );

  // Active HCPs (those with a prescription in the total window), scoped.
  const activeHcpWhere = buildWhere([frag('rx.prescription_date BETWEEN ? AND ?', totalFrom, totalTo), rxScope]);
  const activeHcpRow = await queryOne<CountRow>(
    `SELECT COUNT(DISTINCT rx.hcp_id) AS n FROM prescriptions rx ${activeHcpWhere.sql}`,
    activeHcpWhere.params,
  );
  // Prior-window active HCPs, so the delta is measured rather than reported as 0.
  const prevActiveHcpWhere = buildWhere([frag('rx.prescription_date BETWEEN ? AND ?', prevFrom, prevTo), rxScope]);
  const prevActiveHcpRow = await queryOne<CountRow>(
    `SELECT COUNT(DISTINCT rx.hcp_id) AS n FROM prescriptions rx ${prevActiveHcpWhere.sql}`,
    prevActiveHcpWhere.params,
  );

  // Market share: latest month average of our_share_pct (scoped by region for managers).
  const msScope = p.role === 'MANAGER' && p.regionId != null ? frag('region_id = ?', p.regionId) : frag('');
  const msWhere = buildWhere([
    frag('period_month = (SELECT MAX(period_month) FROM market_share)'),
    msScope,
    ...(filters.regionIds.length ? [frag(`region_id IN (${filters.regionIds.map(() => '?').join(',')})`, ...filters.regionIds)] : []),
  ]);
  const msRow = await queryOne<RowDataPacket & { share: number }>(
    `SELECT AVG(our_share_pct) AS share FROM market_share ${msWhere.sql}`,
    msWhere.params,
  );
  const prevMsWhere = buildWhere([
    frag('period_month = (SELECT MAX(period_month) FROM market_share WHERE period_month < (SELECT MAX(period_month) FROM market_share))'),
    msScope,
  ]);
  const prevMsRow = await queryOne<RowDataPacket & { share: number }>(
    `SELECT AVG(our_share_pct) AS share FROM market_share ${prevMsWhere.sql}`,
    prevMsWhere.params,
  );

  // Inventory availability = 1 - stockout_days/days_in_month, latest month.
  const invScope = p.role === 'MANAGER' && p.regionId != null ? frag('region_id = ?', p.regionId) : frag('');
  const invWhere = buildWhere([
    frag('snapshot_month = (SELECT MAX(snapshot_month) FROM inventory_snapshots)'),
    invScope,
  ]);
  const invRow = await queryOne<RowDataPacket & { avail: number }>(
    `SELECT (1 - AVG(stockout_days) / 30) * 100 AS avail FROM inventory_snapshots ${invWhere.sql}`,
    invWhere.params,
  );
  const prevInvWhere = buildWhere([
    frag('snapshot_month = (SELECT MAX(snapshot_month) FROM inventory_snapshots WHERE snapshot_month < (SELECT MAX(snapshot_month) FROM inventory_snapshots))'),
    invScope,
  ]);
  const prevInvRow = await queryOne<RowDataPacket & { avail: number }>(
    `SELECT (1 - AVG(stockout_days) / 30) * 100 AS avail FROM inventory_snapshots ${prevInvWhere.sql}`,
    prevInvWhere.params,
  );

  const [products, reps] = await Promise.all([
    queryOne<CountRow>('SELECT COUNT(*) AS n FROM drugs WHERE is_active = 1'),
    p.role === 'MANAGER' && p.regionId != null
      ? queryOne<CountRow>('SELECT COUNT(*) AS n FROM sales_reps WHERE is_active = 1 AND region_id = ?', [p.regionId])
      : queryOne<CountRow>('SELECT COUNT(*) AS n FROM sales_reps WHERE is_active = 1'),
  ]);

  // Sparkline: monthly revenue over the trailing window (scoped).
  const sparkWhere = buildWhere(salesFrags(from, to));
  const spark = await query<RowDataPacket & { m: string; rev: number }>(
    `SELECT DATE_FORMAT(s.sale_date, '%Y-%m') AS m, SUM(s.revenue) AS rev
       FROM sales s ${sparkWhere.sql}
      GROUP BY m ORDER BY m`,
    sparkWhere.params,
  );

  const curAvail = Number(invRow?.avail ?? 0);
  const prevAvail = Number(prevInvRow?.avail ?? 0);
  const curShare = Number(msRow?.share ?? 0);
  const prevShare = Number(prevMsRow?.share ?? 0);
  // Trailing-vs-prior revenue growth drives the Revenue Growth KPI + its delta.
  const revenueGrowthPct = pctChange(curRevenue, prevRevenue);

  return {
    totalRevenue: round2(totalRevenue),
    revenueGrowthPct,
    totalPrescriptions: Number(rxRow?.rx ?? 0),
    activeHcps: activeHcpRow?.n ?? 0,
    marketSharePct: round1(curShare),
    inventoryAvailabilityPct: round1(curAvail),
    totalProducts: products?.n ?? 0,
    totalReps: reps?.n ?? 0,
    deltas: {
      totalRevenue: revenueGrowthPct,
      revenueGrowthPct: revenueGrowthPct,
      totalPrescriptions: pctChange(Number(curRxRow?.rx ?? 0), Number(prevRxRow?.rx ?? 0)),
      activeHcps: pctChange(activeHcpRow?.n ?? 0, prevActiveHcpRow?.n ?? 0),
      marketSharePct: round1(curShare - prevShare),
      inventoryAvailabilityPct: round1(curAvail - prevAvail),
    },
    sparklines: { totalRevenue: spark.map((r) => round2(Number(r.rev))) },
  };
}


export interface RevenueTrendPoint {
  period: string;
  revenue: number;
  target: number | null;
  units: number;
}

export async function getRevenueTrend(
  p: Principal,
  filters: { from?: string; to?: string; regionIds: number[]; granularity: 'monthly' | 'daily' },
): Promise<RevenueTrendPoint[]> {
  const { from, to } = await resolveWindow(filters.from, filters.to);
  const fmt = filters.granularity === 'daily' ? '%Y-%m-%d' : '%Y-%m';
  const salesScope = scopeSales(p, 's');
  const where = buildWhere([
    frag('s.sale_date BETWEEN ? AND ?', from, to),
    salesScope,
    ...(filters.regionIds.length ? [frag(`s.region_id IN (${filters.regionIds.map(() => '?').join(',')})`, ...filters.regionIds)] : []),
  ]);
  const rows = await query<RowDataPacket & { period: string; revenue: number; units: number }>(
    `SELECT DATE_FORMAT(s.sale_date, ?) AS period, SUM(s.revenue) AS revenue, SUM(s.units_sold) AS units
       FROM sales s ${where.sql}
      GROUP BY period ORDER BY period`,
    [fmt, ...where.params],
  );

  // Targets are monthly per rep; aggregate to the period. For daily granularity we
  // spread the monthly target evenly. Manager scope: their region's reps only.
  const targetScope = p.role === 'MANAGER' && p.regionId != null ? frag('sr.region_id = ?', p.regionId) : (p.role === 'SALES_REP' && p.repId != null ? frag('rt.rep_id = ?', p.repId) : frag(''));
  const targetWhere = buildWhere([frag('rt.period_month BETWEEN ? AND ?', from, to), targetScope]);
  const targetRows = await query<RowDataPacket & { m: string; target: number }>(
    `SELECT DATE_FORMAT(rt.period_month, '%Y-%m') AS m, SUM(rt.target_revenue) AS target
       FROM rep_targets rt JOIN sales_reps sr ON sr.rep_id = rt.rep_id
       ${targetWhere.sql}
      GROUP BY m`,
    targetWhere.params,
  );
  const targetByMonth = new Map(targetRows.map((r) => [r.m, Number(r.target)]));

  return rows.map((r) => {
    const month = r.period.slice(0, 7);
    const monthlyTarget = targetByMonth.get(month) ?? null;
    const target = monthlyTarget == null ? null : filters.granularity === 'daily' ? round2(monthlyTarget / 30) : round2(monthlyTarget);
    return { period: r.period, revenue: round2(Number(r.revenue)), target, units: Number(r.units) };
  });
}

export interface TaPerf {
  taId: number;
  taName: string;
  revenue: number;
  growthPct: number;
  sharePct: number;
}

export async function getTherapeuticAreas(
  p: Principal,
  filters: { from?: string; to?: string; regionIds: number[] },
): Promise<TaPerf[]> {
  const { from, to } = await resolveWindow(filters.from, filters.to);
  const span = monthSpan(from, to);
  const prevFrom = minusMonths(from, span);
  const prevTo = minusMonths(to, span);
  const salesScope = scopeSales(p, 's');
  const regionFrag = filters.regionIds.length ? frag(`s.region_id IN (${filters.regionIds.map(() => '?').join(',')})`, ...filters.regionIds) : frag('');

  const curWhere = buildWhere([frag('s.sale_date BETWEEN ? AND ?', from, to), salesScope, regionFrag]);
  const prevWhere = buildWhere([frag('s.sale_date BETWEEN ? AND ?', prevFrom, prevTo), salesScope, regionFrag]);

  const cur = await query<RowDataPacket & { taId: number; taName: string; revenue: number }>(
    `SELECT ta.ta_id AS taId, ta.ta_name AS taName, SUM(s.revenue) AS revenue
       FROM sales s JOIN drugs d ON d.drug_id = s.drug_id JOIN therapeutic_areas ta ON ta.ta_id = d.ta_id
       ${curWhere.sql}
      GROUP BY ta.ta_id, ta.ta_name ORDER BY revenue DESC`,
    curWhere.params,
  );
  const prev = await query<RowDataPacket & { taId: number; revenue: number }>(
    `SELECT ta.ta_id AS taId, SUM(s.revenue) AS revenue
       FROM sales s JOIN drugs d ON d.drug_id = s.drug_id JOIN therapeutic_areas ta ON ta.ta_id = d.ta_id
       ${prevWhere.sql}
      GROUP BY ta.ta_id`,
    prevWhere.params,
  );
  const prevMap = new Map(prev.map((r) => [r.taId, Number(r.revenue)]));
  const total = cur.reduce((s, r) => s + Number(r.revenue), 0) || 1;
  return cur.map((r) => ({
    taId: r.taId,
    taName: r.taName,
    revenue: round2(Number(r.revenue)),
    growthPct: pctChange(Number(r.revenue), prevMap.get(r.taId) ?? 0),
    sharePct: round1((Number(r.revenue) / total) * 100),
  }));
}

export interface RegionalPerf {
  regionId: number;
  regionName: string;
  revenue: number;
  growthPct: number;
  marketSharePct: number;
  prescriptions: number;
  hcpCount: number;
  repCount: number;
}

export async function getRegionalPerformance(
  p: Principal,
  filters: { from?: string; to?: string },
): Promise<{ rows: RegionalPerf[]; highlights: { topRegion: string | null; fastestGrowing: string | null; atRisk: string | null } }> {
  const { from, to } = await resolveWindow(filters.from, filters.to);
  const span = monthSpan(from, to);
  const prevFrom = minusMonths(from, span);
  const prevTo = minusMonths(to, span);
  // Managers only see their own region.
  const regionRestrict = p.role === 'MANAGER' && p.regionId != null ? frag('r.region_id = ?', p.regionId) : frag('');
  const salesScope = scopeSales(p, 's');

  const rWhere = buildWhere([regionRestrict]);
  const regions = await query<RowDataPacket & { regionId: number; regionName: string }>(
    `SELECT r.region_id AS regionId, r.region_name AS regionName FROM regions r ${rWhere.sql} ORDER BY r.region_id`,
    rWhere.params,
  );

  const curW = buildWhere([frag('s.sale_date BETWEEN ? AND ?', from, to), salesScope]);
  const cur = await query<RowDataPacket & { regionId: number; revenue: number }>(
    `SELECT s.region_id AS regionId, SUM(s.revenue) AS revenue FROM sales s ${curW.sql} GROUP BY s.region_id`,
    curW.params,
  );
  const prevW = buildWhere([frag('s.sale_date BETWEEN ? AND ?', prevFrom, prevTo), salesScope]);
  const prev = await query<RowDataPacket & { regionId: number; revenue: number }>(
    `SELECT s.region_id AS regionId, SUM(s.revenue) AS revenue FROM sales s ${prevW.sql} GROUP BY s.region_id`,
    prevW.params,
  );
  const rxW = buildWhere([frag('rx.prescription_date BETWEEN ? AND ?', from, to), scopeByHcp(p, 'rx.hcp_id', 'rx.region_id')]);
  const rx = await query<RowDataPacket & { regionId: number; rx: number }>(
    `SELECT rx.region_id AS regionId, COUNT(*) AS rx /* COUNT(*): a prescription is a script written, not a tablet dispensed */ FROM prescriptions rx ${rxW.sql} GROUP BY rx.region_id`,
    rxW.params,
  );
  const hcpCounts = await query<RowDataPacket & { regionId: number; n: number }>(
    'SELECT region_id AS regionId, COUNT(*) AS n FROM hcps WHERE is_active = 1 GROUP BY region_id',
  );
  const repCounts = await query<RowDataPacket & { regionId: number; n: number }>(
    'SELECT region_id AS regionId, COUNT(*) AS n FROM sales_reps WHERE is_active = 1 GROUP BY region_id',
  );
  const shareRows = await query<RowDataPacket & { regionId: number; share: number }>(
    `SELECT region_id AS regionId, AVG(our_share_pct) AS share FROM market_share
      WHERE period_month = (SELECT MAX(period_month) FROM market_share) GROUP BY region_id`,
  );

  const curMap = new Map(cur.map((r) => [r.regionId, Number(r.revenue)]));
  const prevMap = new Map(prev.map((r) => [r.regionId, Number(r.revenue)]));
  const rxMap = new Map(rx.map((r) => [r.regionId, Number(r.rx)]));
  const hcpMap = new Map(hcpCounts.map((r) => [r.regionId, r.n]));
  const repMap = new Map(repCounts.map((r) => [r.regionId, r.n]));
  const shareMap = new Map(shareRows.map((r) => [r.regionId, Number(r.share)]));

  const rows: RegionalPerf[] = regions.map((r) => ({
    regionId: r.regionId,
    regionName: r.regionName,
    revenue: round2(curMap.get(r.regionId) ?? 0),
    growthPct: pctChange(curMap.get(r.regionId) ?? 0, prevMap.get(r.regionId) ?? 0),
    marketSharePct: round1(shareMap.get(r.regionId) ?? 0),
    prescriptions: rxMap.get(r.regionId) ?? 0,
    hcpCount: hcpMap.get(r.regionId) ?? 0,
    repCount: repMap.get(r.regionId) ?? 0,
  }));

  const byRevenue = [...rows].sort((a, b) => b.revenue - a.revenue);
  const byGrowth = [...rows].sort((a, b) => b.growthPct - a.growthPct);
  return {
    rows,
    highlights: {
      topRegion: byRevenue[0]?.regionName ?? null,
      fastestGrowing: byGrowth[0]?.regionName ?? null,
      atRisk: byGrowth[byGrowth.length - 1]?.regionName ?? null,
    },
  };
}

export interface TopProduct {
  rank: number;
  drugId: number;
  drugName: string;
  taName: string;
  revenue: number;
  growthPct: number;
  prescriptions: number;
  marketSharePct: number;
}

export async function getTopProducts(
  p: Principal,
  filters: { from?: string; to?: string; regionIds: number[]; limit: number },
): Promise<TopProduct[]> {
  const { from, to } = await resolveWindow(filters.from, filters.to);
  const span = monthSpan(from, to);
  const prevFrom = minusMonths(from, span);
  const prevTo = minusMonths(to, span);
  const salesScope = scopeSales(p, 's');
  const regionFrag = filters.regionIds.length ? frag(`s.region_id IN (${filters.regionIds.map(() => '?').join(',')})`, ...filters.regionIds) : frag('');

  const curW = buildWhere([frag('s.sale_date BETWEEN ? AND ?', from, to), salesScope, regionFrag]);
  const cur = await query<RowDataPacket & { drugId: number; drugName: string; taName: string; revenue: number }>(
    `SELECT s.drug_id AS drugId, d.drug_name AS drugName, ta.ta_name AS taName, SUM(s.revenue) AS revenue
       FROM sales s JOIN drugs d ON d.drug_id = s.drug_id JOIN therapeutic_areas ta ON ta.ta_id = d.ta_id
       ${curW.sql}
      GROUP BY s.drug_id, d.drug_name, ta.ta_name ORDER BY revenue DESC LIMIT ?`,
    [...curW.params, filters.limit],
  );
  const prevW = buildWhere([frag('s.sale_date BETWEEN ? AND ?', prevFrom, prevTo), salesScope, regionFrag]);
  const prev = await query<RowDataPacket & { drugId: number; revenue: number }>(
    `SELECT s.drug_id AS drugId, SUM(s.revenue) AS revenue FROM sales s ${prevW.sql} GROUP BY s.drug_id`,
    prevW.params,
  );
  const prevMap = new Map(prev.map((r) => [r.drugId, Number(r.revenue)]));

  const drugIds = cur.map((r) => r.drugId);
  const rxMap = new Map<number, number>();
  const shareMap = new Map<number, number>();
  if (drugIds.length) {
    const ph = drugIds.map(() => '?').join(',');
    const rxScope = scopeByHcp(p, 'rx.hcp_id', 'rx.region_id');
    const rxW = buildWhere([frag(`rx.drug_id IN (${ph})`, ...drugIds), frag('rx.prescription_date BETWEEN ? AND ?', from, to), rxScope]);
    const rx = await query<RowDataPacket & { drugId: number; rx: number }>(
      `SELECT rx.drug_id AS drugId, COUNT(*) AS rx
         /* The Top Products column is labelled "Prescriptions", so it must COUNT
            scripts. Summing units put RespiCare at 195,240 on a dashboard whose own
            Total Prescriptions KPI read 159K for the same window. (HCP "Rx Volume"
            legitimately stays a unit sum - different metric, different label.) */
       FROM prescriptions rx ${rxW.sql} GROUP BY rx.drug_id`,
      rxW.params,
    );
    rx.forEach((r) => rxMap.set(r.drugId, Number(r.rx)));
    const share = await query<RowDataPacket & { drugId: number; share: number }>(
      `SELECT drug_id AS drugId, AVG(our_share_pct) AS share FROM market_share
        WHERE drug_id IN (${ph}) AND period_month = (SELECT MAX(period_month) FROM market_share)
        GROUP BY drug_id`,
      drugIds,
    );
    share.forEach((r) => shareMap.set(r.drugId, Number(r.share)));
  }

  return cur.map((r, i) => ({
    rank: i + 1,
    drugId: r.drugId,
    drugName: r.drugName,
    taName: r.taName,
    revenue: round2(Number(r.revenue)),
    growthPct: pctChange(Number(r.revenue), prevMap.get(r.drugId) ?? 0),
    prescriptions: rxMap.get(r.drugId) ?? 0,
    marketSharePct: round1(shareMap.get(r.drugId) ?? 0),
  }));
}

export interface TopHcp {
  rank: number;
  hcpId: number;
  hcpCode: string;
  fullName: string;
  specialty: string;
  regionName: string;
  revenue: number;
  rxVolume: number;
}

export async function getTopHcps(
  p: Principal,
  filters: { from?: string; to?: string; limit: number },
): Promise<TopHcp[]> {
  const { from, to } = await resolveWindow(filters.from, filters.to);
  const hcpScope = scopeByHcp(p, 'h.hcp_id', 'h.region_id');
  const where = buildWhere([hcpScope]);
  const rows = await query<
    RowDataPacket & {
      hcpId: number;
      hcpCode: string;
      fullName: string;
      specialty: string;
      regionName: string;
      revenue: number;
      rxVolume: number;
    }
  >(
    `SELECT h.hcp_id AS hcpId, h.hcp_code AS hcpCode, h.full_name AS fullName, h.specialty AS specialty,
            r.region_name AS regionName,
            COALESCE((SELECT SUM(s.revenue) FROM sales s WHERE s.hcp_id = h.hcp_id AND s.sale_date BETWEEN ? AND ?),0) AS revenue,
            COALESCE((SELECT SUM(rx.units) FROM prescriptions rx WHERE rx.hcp_id = h.hcp_id AND rx.prescription_date BETWEEN ? AND ?),0) AS rxVolume
       FROM hcps h JOIN regions r ON r.region_id = h.region_id
       ${where.sql}
      ORDER BY revenue DESC LIMIT ?`,
    [from, to, from, to, ...where.params, filters.limit],
  );
  return rows.map((r, i) => ({
    rank: i + 1,
    hcpId: r.hcpId,
    hcpCode: r.hcpCode,
    fullName: r.fullName,
    specialty: r.specialty,
    regionName: r.regionName,
    revenue: round2(Number(r.revenue)),
    rxVolume: Number(r.rxVolume),
  }));
}
