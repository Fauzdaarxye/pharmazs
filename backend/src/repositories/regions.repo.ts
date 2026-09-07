import { query, queryOne, RowDataPacket } from '../db/pool';
import { Principal } from '../types';
import { buildWhere, frag, scopeSales } from '../http/scope';
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

export interface RegionItem {
  regionId: number;
  regionName: string;
  zoneHead: string | null;
  revenue: number;
  growthPct: number;
  marketSharePct: number;
  prescriptions: number;
  hcpCount: number;
  repCount: number;
}

/** Managers only see their own region; everyone else sees all. */
function regionRestrict(p: Principal) {
  return p.role === 'MANAGER' && p.regionId != null ? frag('r.region_id = ?', p.regionId) : frag('');
}

export async function listRegions(p: Principal, from?: string, to?: string): Promise<RegionItem[]> {
  const range = await resolveWindow(from, to);
  const prevFrom = minusMonths(range.from, 12);
  const prevTo = minusMonths(range.to, 12);
  const salesScope = scopeSales(p, 's');
  const where = buildWhere([regionRestrict(p)]);

  const rows = await query<RowDataPacket & RegionItem>(
    `SELECT r.region_id AS regionId, r.region_name AS regionName, r.zone_head AS zoneHead,
            COALESCE(cur.revenue,0) AS revenue,
            COALESCE(rx.rx,0) AS prescriptions,
            COALESCE(hc.n,0) AS hcpCount, COALESCE(rc.n,0) AS repCount,
            COALESCE(ms.share,0) AS marketSharePct,
            ROUND(CASE WHEN COALESCE(prev.revenue,0)=0 THEN 0 ELSE (COALESCE(cur.revenue,0)-COALESCE(prev.revenue,0))/COALESCE(prev.revenue,0)*100 END,1) AS growthPct
       FROM regions r
       LEFT JOIN (SELECT s.region_id, SUM(s.revenue) revenue FROM sales s WHERE s.sale_date BETWEEN ? AND ?${salesScope.sql ? ' AND (' + salesScope.sql + ')' : ''} GROUP BY s.region_id) cur ON cur.region_id = r.region_id
       LEFT JOIN (SELECT s.region_id, SUM(s.revenue) revenue FROM sales s WHERE s.sale_date BETWEEN ? AND ?${salesScope.sql ? ' AND (' + salesScope.sql + ')' : ''} GROUP BY s.region_id) prev ON prev.region_id = r.region_id
       LEFT JOIN (SELECT region_id, SUM(units) rx FROM prescriptions WHERE prescription_date BETWEEN ? AND ? GROUP BY region_id) rx ON rx.region_id = r.region_id
       LEFT JOIN (SELECT region_id, COUNT(*) n FROM hcps WHERE is_active=1 GROUP BY region_id) hc ON hc.region_id = r.region_id
       LEFT JOIN (SELECT region_id, COUNT(*) n FROM sales_reps WHERE is_active=1 GROUP BY region_id) rc ON rc.region_id = r.region_id
       LEFT JOIN (SELECT region_id, AVG(our_share_pct) share FROM market_share WHERE period_month=(SELECT MAX(period_month) FROM market_share) GROUP BY region_id) ms ON ms.region_id = r.region_id
       ${where.sql}
      ORDER BY revenue DESC`,
    [range.from, range.to, ...salesScope.params, prevFrom, prevTo, ...salesScope.params, range.from, range.to, ...where.params],
  );
  return rows.map((r) => ({
    regionId: r.regionId,
    regionName: r.regionName,
    zoneHead: r.zoneHead,
    revenue: round2(Number(r.revenue)),
    growthPct: Number(r.growthPct),
    marketSharePct: round1(Number(r.marketSharePct)),
    prescriptions: Number(r.prescriptions),
    hcpCount: Number(r.hcpCount),
    repCount: Number(r.repCount),
  }));
}

export async function getRegion(p: Principal, regionId: number): Promise<RegionItem | null> {
  const all = await listRegions(p);
  return all.find((r) => r.regionId === regionId) ?? null;
}

export async function drilldown(
  p: Principal,
  regionId: number,
  level: 'city' | 'ta' | 'product',
  from?: string,
  to?: string,
): Promise<{ id: number; name: string; revenue: number; units: number }[]> {
  const range = await resolveWindow(from, to);
  const salesScope = scopeSales(p, 's');
  const base = buildWhere([frag('s.region_id = ?', regionId), frag('s.sale_date BETWEEN ? AND ?', range.from, range.to), salesScope]);

  if (level === 'city') {
    return (
      await query<RowDataPacket & { id: number; name: string; revenue: number; units: number }>(
        `SELECT s.city_id AS id, c.city_name AS name, SUM(s.revenue) revenue, SUM(s.units_sold) units
           FROM sales s JOIN cities c ON c.city_id = s.city_id ${base.sql}
          GROUP BY s.city_id, c.city_name ORDER BY revenue DESC`,
        base.params,
      )
    ).map((r) => ({ id: r.id, name: r.name, revenue: round2(Number(r.revenue)), units: Number(r.units) }));
  }
  if (level === 'ta') {
    return (
      await query<RowDataPacket & { id: number; name: string; revenue: number; units: number }>(
        `SELECT ta.ta_id AS id, ta.ta_name AS name, SUM(s.revenue) revenue, SUM(s.units_sold) units
           FROM sales s JOIN drugs d ON d.drug_id = s.drug_id JOIN therapeutic_areas ta ON ta.ta_id = d.ta_id ${base.sql}
          GROUP BY ta.ta_id, ta.ta_name ORDER BY revenue DESC`,
        base.params,
      )
    ).map((r) => ({ id: r.id, name: r.name, revenue: round2(Number(r.revenue)), units: Number(r.units) }));
  }
  return (
    await query<RowDataPacket & { id: number; name: string; revenue: number; units: number }>(
      `SELECT s.drug_id AS id, d.drug_name AS name, SUM(s.revenue) revenue, SUM(s.units_sold) units
         FROM sales s JOIN drugs d ON d.drug_id = s.drug_id ${base.sql}
        GROUP BY s.drug_id, d.drug_name ORDER BY revenue DESC`,
      base.params,
    )
  ).map((r) => ({ id: r.id, name: r.name, revenue: round2(Number(r.revenue)), units: Number(r.units) }));
}

export async function regionExists(regionId: number): Promise<boolean> {
  const r = await queryOne<RowDataPacket>('SELECT region_id FROM regions WHERE region_id = ?', [regionId]);
  return !!r;
}
