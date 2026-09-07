import { query, queryOne, RowDataPacket } from '../db/pool';
import { Principal } from '../types';
import { scopeByHcp, buildWhere, frag, ScopeClause } from '../http/scope';
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

export const HCP_SORT: Record<string, string> = {
  fullName: 'fullName',
  rxVolume: 'rxVolume',
  rxGrowthPct: 'rxGrowthPct',
  revenue: 'revenue',
  score: 'potentialScore',
  visits: 'visits',
  daysSinceLastVisit: 'daysSinceLastVisit',
  potentialScore: 'potentialScore',
};

export interface HcpListItem {
  hcpId: number;
  hcpCode: string;
  fullName: string;
  specialty: string;
  hospital: string | null;
  city: string;
  regionName: string;
  rxVolume: number;
  rxGrowthPct: number;
  revenue: number;
  visits: number;
  lastVisitDate: string | null;
  daysSinceLastVisit: number | null;
  potentialScore: number;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  competitorUsagePct: number;
}

interface HcpDirParams {
  from?: string;
  to?: string;
  regionIds: number[];
  specialty?: string;
  q?: string;
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  minScore?: number;
  sortColumn: string;
  sortDir: 'ASC' | 'DESC';
  limit: number;
  offset: number;
}

/**
 * The HCP directory. Score/priority come from the latest hcp_scores row per HCP when the
 * ML service has produced one; when absent we fall back to a deterministic heuristic score
 * derived from Rx volume percentile so the page is never empty before ML runs.
 */
export async function listHcps(p: Principal, opts: HcpDirParams): Promise<{ items: HcpListItem[]; total: number }> {
  const { from, to } = await resolveWindow(opts.from, opts.to);
  const span = 12;
  const prevFrom = minusMonths(from, span);
  const prevTo = minusMonths(to, span);
  const hcpScope = scopeByHcp(p, 'h.hcp_id', 'h.region_id');

  const filters: ScopeClause[] = [hcpScope, frag('h.is_active = 1')];
  if (opts.regionIds.length) filters.push(frag(`h.region_id IN (${opts.regionIds.map(() => '?').join(',')})`, ...opts.regionIds));
  if (opts.specialty) filters.push(frag('h.specialty = ?', opts.specialty));
  if (opts.q) filters.push(frag('(h.full_name LIKE ? OR h.hcp_code LIKE ? OR h.hospital LIKE ?)', `%${opts.q}%`, `%${opts.q}%`, `%${opts.q}%`));
  const where = buildWhere(filters);

  const total =
    (await queryOne<RowDataPacket & { n: number }>(`SELECT COUNT(*) AS n FROM hcps h ${where.sql}`, where.params))?.n ?? 0;

  // latest score per hcp
  const scoreJoin = `
    LEFT JOIN (
      SELECT hs.hcp_id, hs.total_score, hs.priority, hs.competitor_opportunity_score
        FROM hcp_scores hs
        JOIN (SELECT hcp_id, MAX(scored_at) AS mx FROM hcp_scores GROUP BY hcp_id) latest
          ON latest.hcp_id = hs.hcp_id AND latest.mx = hs.scored_at
    ) sc ON sc.hcp_id = h.hcp_id`;

  const havingFilters: string[] = [];
  const havingParams: unknown[] = [];
  if (opts.minScore != null) {
    havingFilters.push('potentialScore >= ?');
    havingParams.push(opts.minScore);
  }
  if (opts.priority) {
    havingFilters.push('priority = ?');
    havingParams.push(opts.priority);
  }
  const having = havingFilters.length ? 'HAVING ' + havingFilters.join(' AND ') : '';

  const sql = `
    SELECT h.hcp_id AS hcpId, h.hcp_code AS hcpCode, h.full_name AS fullName, h.specialty AS specialty,
           h.hospital AS hospital, c.city_name AS city, r.region_name AS regionName,
           COALESCE(rxc.rx,0) AS rxVolume,
           ROUND(CASE WHEN COALESCE(rxp.rx,0)=0 THEN (CASE WHEN COALESCE(rxc.rx,0)=0 THEN 0 ELSE 100 END)
                      ELSE (COALESCE(rxc.rx,0)-COALESCE(rxp.rx,0))/COALESCE(rxp.rx,0)*100 END,1) AS rxGrowthPct,
           COALESCE(sal.revenue,0) AS revenue,
           COALESCE(vis.visits,0) AS visits,
           vis.lastVisit AS lastVisitDate,
           CASE WHEN vis.lastVisit IS NULL THEN NULL ELSE DATEDIFF(?, vis.lastVisit) END AS daysSinceLastVisit,
           COALESCE(sc.total_score, LEAST(100, ROUND(COALESCE(rxc.rx,0) / NULLIF((SELECT MAX(t.rx) FROM (SELECT SUM(units) rx FROM prescriptions GROUP BY hcp_id) t),0) * 100))) AS potentialScore,
           COALESCE(sc.priority,
             CASE WHEN COALESCE(sc.total_score, LEAST(100, ROUND(COALESCE(rxc.rx,0) / NULLIF((SELECT MAX(t.rx) FROM (SELECT SUM(units) rx FROM prescriptions GROUP BY hcp_id) t),0) * 100))) >= 80 THEN 'HIGH'
                  WHEN COALESCE(sc.total_score, LEAST(100, ROUND(COALESCE(rxc.rx,0) / NULLIF((SELECT MAX(t.rx) FROM (SELECT SUM(units) rx FROM prescriptions GROUP BY hcp_id) t),0) * 100))) >= 50 THEN 'MEDIUM'
                  ELSE 'LOW' END) AS priority,
           COALESCE(sc.competitor_opportunity_score, 0) AS competitorUsagePct
      FROM hcps h
      JOIN cities c ON c.city_id = h.city_id
      JOIN regions r ON r.region_id = h.region_id
      LEFT JOIN (SELECT hcp_id, SUM(units) rx FROM prescriptions WHERE prescription_date BETWEEN ? AND ? GROUP BY hcp_id) rxc ON rxc.hcp_id = h.hcp_id
      LEFT JOIN (SELECT hcp_id, SUM(units) rx FROM prescriptions WHERE prescription_date BETWEEN ? AND ? GROUP BY hcp_id) rxp ON rxp.hcp_id = h.hcp_id
      LEFT JOIN (SELECT hcp_id, SUM(revenue) revenue FROM sales WHERE sale_date BETWEEN ? AND ? AND hcp_id IS NOT NULL GROUP BY hcp_id) sal ON sal.hcp_id = h.hcp_id
      LEFT JOIN (SELECT hcp_id, COUNT(*) visits, MAX(visit_date) lastVisit FROM visits WHERE visit_date BETWEEN ? AND ? GROUP BY hcp_id) vis ON vis.hcp_id = h.hcp_id
      ${scoreJoin}
      ${where.sql}
      ${having}
      ORDER BY ${opts.sortColumn} ${opts.sortDir}
      LIMIT ? OFFSET ?`;

  const params = [to, from, to, prevFrom, prevTo, from, to, from, to, ...where.params, ...havingParams, opts.limit, opts.offset];
  const rows = await query<RowDataPacket & HcpListItem>(sql, params);

  const items = rows.map((r) => ({
    hcpId: r.hcpId,
    hcpCode: r.hcpCode,
    fullName: r.fullName,
    specialty: r.specialty,
    hospital: r.hospital,
    city: r.city,
    regionName: r.regionName,
    rxVolume: Number(r.rxVolume),
    rxGrowthPct: Number(r.rxGrowthPct),
    revenue: round2(Number(r.revenue)),
    visits: Number(r.visits),
    lastVisitDate: r.lastVisitDate,
    daysSinceLastVisit: r.daysSinceLastVisit == null ? null : Number(r.daysSinceLastVisit),
    potentialScore: Number(r.potentialScore),
    priority: r.priority,
    competitorUsagePct: round1(Number(r.competitorUsagePct)),
  }));

  // total after HAVING filters (score/priority) — recount if such filters applied.
  let effectiveTotal = total;
  if (having) {
    const countSql = `SELECT COUNT(*) AS n FROM (${sql.replace(/ORDER BY[\s\S]*$/, '')}) t`;
    const cParams = [to, from, to, prevFrom, prevTo, from, to, from, to, ...where.params, ...havingParams];
    const cr = await queryOne<RowDataPacket & { n: number }>(countSql, cParams);
    effectiveTotal = cr?.n ?? items.length;
  }

  return { items, total: effectiveTotal };
}

export interface HcpSummary {
  totalHcps: number;
  highPotentialHcps: number;
  highPotentialSharePct: number;
  avgRxVolumePerHcp: number;
  engagementRatePct: number;
  avgPotentialScore: number;
}

export async function getHcpSummary(p: Principal): Promise<HcpSummary> {
  const { from, to } = await resolveWindow(undefined, undefined);
  const hcpScope = scopeByHcp(p, 'h.hcp_id', 'h.region_id');
  const where = buildWhere([hcpScope, frag('h.is_active = 1')]);

  const totalRow = await queryOne<RowDataPacket & { n: number }>(`SELECT COUNT(*) AS n FROM hcps h ${where.sql}`, where.params);
  const total = totalRow?.n ?? 0;

  // high-potential from hcp_scores if present, else heuristic on rx volume percentile.
  const highRow = await queryOne<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM hcps h
       JOIN (SELECT hs.hcp_id, hs.priority FROM hcp_scores hs
              JOIN (SELECT hcp_id, MAX(scored_at) mx FROM hcp_scores GROUP BY hcp_id) l
                ON l.hcp_id=hs.hcp_id AND l.mx=hs.scored_at) sc ON sc.hcp_id = h.hcp_id AND sc.priority='HIGH'
      ${where.sql}`,
    where.params,
  );
  const high = highRow?.n ?? 0;

  const rxRow = await queryOne<RowDataPacket & { avgRx: number }>(
    `SELECT AVG(t.rx) AS avgRx FROM (
        SELECT h.hcp_id, COALESCE(SUM(rx.units),0)/12 AS rx
          FROM hcps h LEFT JOIN prescriptions rx ON rx.hcp_id=h.hcp_id AND rx.prescription_date BETWEEN ? AND ?
          ${where.sql}
         GROUP BY h.hcp_id
     ) t`,
    [from, to, ...where.params],
  );

  // engagement = share of HCPs with >=1 visit in window
  const engRow = await queryOne<RowDataPacket & { engaged: number }>(
    `SELECT COUNT(DISTINCT v.hcp_id) AS engaged FROM visits v
       JOIN hcps h ON h.hcp_id = v.hcp_id
      ${where.sql ? where.sql + ' AND' : 'WHERE'} v.visit_date BETWEEN ? AND ?`,
    [...where.params, from, to],
  );
  const engaged = engRow?.engaged ?? 0;

  const avgScoreRow = await queryOne<RowDataPacket & { avg: number }>(
    `SELECT AVG(sc.total_score) AS avg FROM hcps h
       JOIN (SELECT hs.hcp_id, hs.total_score FROM hcp_scores hs
              JOIN (SELECT hcp_id, MAX(scored_at) mx FROM hcp_scores GROUP BY hcp_id) l
                ON l.hcp_id=hs.hcp_id AND l.mx=hs.scored_at) sc ON sc.hcp_id = h.hcp_id
      ${where.sql}`,
    where.params,
  );

  return {
    totalHcps: total,
    highPotentialHcps: high,
    highPotentialSharePct: total ? round1((high / total) * 100) : 0,
    avgRxVolumePerHcp: round1(Number(rxRow?.avgRx ?? 0)),
    engagementRatePct: total ? round1((engaged / total) * 100) : 0,
    avgPotentialScore: round1(Number(avgScoreRow?.avg ?? 0)),
  };
}

export async function getHcpDetail(p: Principal, hcpId: number): Promise<(HcpListItem & { qualification: string | null; hcpTier: string; yearsExperience: number | null; scoreBreakdown: unknown }) | null> {
  const hcpScope = scopeByHcp(p, 'h.hcp_id', 'h.region_id');
  const where = buildWhere([hcpScope, frag('h.hcp_id = ?', hcpId)]);
  const base = await listHcpsById(p, hcpId);
  if (!base) return null;
  // ensure scope allows it
  const allowed = await queryOne<RowDataPacket>(`SELECT h.hcp_id FROM hcps h ${where.sql}`, where.params);
  if (!allowed) return null;

  const extra = await queryOne<RowDataPacket & { qualification: string | null; hcpTier: string; yearsExperience: number | null }>(
    'SELECT qualification, hcp_tier AS hcpTier, years_experience AS yearsExperience FROM hcps WHERE hcp_id = ?',
    [hcpId],
  );
  const score = await queryOne<RowDataPacket & Record<string, number>>(
    `SELECT rx_volume_score AS rxVolume, rx_growth_score AS rxGrowth, engagement_score AS engagement,
            ta_relevance_score AS taRelevance, competitor_opportunity_score AS competitorOpportunity,
            total_score AS total, priority, reasons_json AS reasons
       FROM hcp_scores WHERE hcp_id = ? ORDER BY scored_at DESC LIMIT 1`,
    [hcpId],
  );
  return {
    ...base,
    qualification: extra?.qualification ?? null,
    hcpTier: extra?.hcpTier ?? 'B',
    yearsExperience: extra?.yearsExperience ?? null,
    scoreBreakdown: score ?? null,
  };
}

async function listHcpsById(p: Principal, hcpId: number): Promise<HcpListItem | null> {
  // Reuse the directory query but constrained to a single hcp_id so scoring/growth
  // are computed identically to the list view.
  const { from, to } = await resolveWindow(undefined, undefined);
  const prevFrom = minusMonths(from, 12);
  const prevTo = minusMonths(to, 12);
  const hcpScope = scopeByHcp(p, 'h.hcp_id', 'h.region_id');
  const where = buildWhere([hcpScope, frag('h.hcp_id = ?', hcpId)]);

  const scoreJoin = `
    LEFT JOIN (
      SELECT hs.hcp_id, hs.total_score, hs.priority, hs.competitor_opportunity_score
        FROM hcp_scores hs
        JOIN (SELECT hcp_id, MAX(scored_at) AS mx FROM hcp_scores GROUP BY hcp_id) latest
          ON latest.hcp_id = hs.hcp_id AND latest.mx = hs.scored_at
    ) sc ON sc.hcp_id = h.hcp_id`;
  const maxRx = `NULLIF((SELECT MAX(t.rx) FROM (SELECT SUM(units) rx FROM prescriptions GROUP BY hcp_id) t),0)`;
  const scoreExpr = `LEAST(100, ROUND(COALESCE(rxc.rx,0) / ${maxRx} * 100))`;

  const row = await queryOne<RowDataPacket & HcpListItem>(
    `SELECT h.hcp_id AS hcpId, h.hcp_code AS hcpCode, h.full_name AS fullName, h.specialty AS specialty,
            h.hospital AS hospital, c.city_name AS city, r.region_name AS regionName,
            COALESCE(rxc.rx,0) AS rxVolume,
            ROUND(CASE WHEN COALESCE(rxp.rx,0)=0 THEN (CASE WHEN COALESCE(rxc.rx,0)=0 THEN 0 ELSE 100 END)
                       ELSE (COALESCE(rxc.rx,0)-COALESCE(rxp.rx,0))/COALESCE(rxp.rx,0)*100 END,1) AS rxGrowthPct,
            COALESCE(sal.revenue,0) AS revenue,
            COALESCE(vis.visits,0) AS visits, vis.lastVisit AS lastVisitDate,
            CASE WHEN vis.lastVisit IS NULL THEN NULL ELSE DATEDIFF(?, vis.lastVisit) END AS daysSinceLastVisit,
            COALESCE(sc.total_score, ${scoreExpr}) AS potentialScore,
            COALESCE(sc.priority, CASE WHEN COALESCE(sc.total_score, ${scoreExpr}) >= 80 THEN 'HIGH'
                                       WHEN COALESCE(sc.total_score, ${scoreExpr}) >= 50 THEN 'MEDIUM' ELSE 'LOW' END) AS priority,
            COALESCE(sc.competitor_opportunity_score, 0) AS competitorUsagePct
       FROM hcps h
       JOIN cities c ON c.city_id = h.city_id
       JOIN regions r ON r.region_id = h.region_id
       LEFT JOIN (SELECT hcp_id, SUM(units) rx FROM prescriptions WHERE prescription_date BETWEEN ? AND ? GROUP BY hcp_id) rxc ON rxc.hcp_id = h.hcp_id
       LEFT JOIN (SELECT hcp_id, SUM(units) rx FROM prescriptions WHERE prescription_date BETWEEN ? AND ? GROUP BY hcp_id) rxp ON rxp.hcp_id = h.hcp_id
       LEFT JOIN (SELECT hcp_id, SUM(revenue) revenue FROM sales WHERE sale_date BETWEEN ? AND ? AND hcp_id IS NOT NULL GROUP BY hcp_id) sal ON sal.hcp_id = h.hcp_id
       LEFT JOIN (SELECT hcp_id, COUNT(*) visits, MAX(visit_date) lastVisit FROM visits WHERE visit_date BETWEEN ? AND ? GROUP BY hcp_id) vis ON vis.hcp_id = h.hcp_id
       ${scoreJoin}
       ${where.sql}`,
    [to, from, to, prevFrom, prevTo, from, to, from, to, ...where.params],
  );
  if (!row) return null;
  return {
    hcpId: row.hcpId,
    hcpCode: row.hcpCode,
    fullName: row.fullName,
    specialty: row.specialty,
    hospital: row.hospital,
    city: row.city,
    regionName: row.regionName,
    rxVolume: Number(row.rxVolume),
    rxGrowthPct: Number(row.rxGrowthPct),
    revenue: round2(Number(row.revenue)),
    visits: Number(row.visits),
    lastVisitDate: row.lastVisitDate,
    daysSinceLastVisit: row.daysSinceLastVisit == null ? null : Number(row.daysSinceLastVisit),
    potentialScore: Number(row.potentialScore),
    priority: row.priority,
    competitorUsagePct: round1(Number(row.competitorUsagePct)),
  };
}

export async function getHcpTrend(
  p: Principal,
  hcpId: number,
): Promise<{ period: string; rxVolume: number; revenue: number; visits: number }[]> {
  const hcpScope = scopeByHcp(p, 'rx.hcp_id', 'rx.region_id');
  const { from, to } = await resolveWindow(undefined, undefined);
  const where = buildWhere([hcpScope, frag('rx.hcp_id = ?', hcpId), frag('rx.prescription_date BETWEEN ? AND ?', from, to)]);
  const rx = await query<RowDataPacket & { period: string; rxVolume: number }>(
    `SELECT DATE_FORMAT(rx.prescription_date,'%Y-%m') AS period, SUM(rx.units) AS rxVolume
       FROM prescriptions rx ${where.sql} GROUP BY period ORDER BY period`,
    where.params,
  );
  const sal = await query<RowDataPacket & { period: string; revenue: number }>(
    `SELECT DATE_FORMAT(sale_date,'%Y-%m') AS period, SUM(revenue) AS revenue
       FROM sales WHERE hcp_id = ? AND sale_date BETWEEN ? AND ? GROUP BY period`,
    [hcpId, from, to],
  );
  const vis = await query<RowDataPacket & { period: string; visits: number }>(
    `SELECT DATE_FORMAT(visit_date,'%Y-%m') AS period, COUNT(*) AS visits
       FROM visits WHERE hcp_id = ? AND visit_date BETWEEN ? AND ? GROUP BY period`,
    [hcpId, from, to],
  );
  const salMap = new Map(sal.map((r) => [r.period, Number(r.revenue)]));
  const visMap = new Map(vis.map((r) => [r.period, Number(r.visits)]));
  return rx.map((r) => ({
    period: r.period,
    rxVolume: Number(r.rxVolume),
    revenue: round2(salMap.get(r.period) ?? 0),
    visits: visMap.get(r.period) ?? 0,
  }));
}

export async function hcpVisibleToPrincipal(p: Principal, hcpId: number): Promise<boolean> {
  const hcpScope = scopeByHcp(p, 'h.hcp_id', 'h.region_id');
  const where = buildWhere([hcpScope, frag('h.hcp_id = ?', hcpId)]);
  const r = await queryOne<RowDataPacket>(`SELECT h.hcp_id FROM hcps h ${where.sql}`, where.params);
  return !!r;
}

export async function hcpExists(hcpId: number): Promise<boolean> {
  const r = await queryOne<RowDataPacket>('SELECT hcp_id FROM hcps WHERE hcp_id = ?', [hcpId]);
  return !!r;
}
