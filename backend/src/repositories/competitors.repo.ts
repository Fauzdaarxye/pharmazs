import { query, RowDataPacket } from '../db/pool';
import { Principal } from '../types';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface CompetitorItem {
  competitorId: number;
  companyName: string;
  hqCountry: string | null;
  drugCount: number;
  avgSharePct: number;
}

export async function listCompetitors(): Promise<CompetitorItem[]> {
  const rows = await query<RowDataPacket & CompetitorItem>(
    `SELECT c.competitor_id AS competitorId, c.company_name AS companyName, c.hq_country AS hqCountry,
            COUNT(DISTINCT cd.competitor_drug_id) AS drugCount,
            COALESCE(AVG(ms.competitor_share_pct),0) AS avgSharePct
       FROM competitors c
       LEFT JOIN competitor_drugs cd ON cd.competitor_id = c.competitor_id
       LEFT JOIN market_share ms ON ms.competitor_drug_id = cd.competitor_drug_id
            AND ms.period_month=(SELECT MAX(period_month) FROM market_share)
      GROUP BY c.competitor_id, c.company_name, c.hq_country
      ORDER BY avgSharePct DESC`,
  );
  return rows.map((r) => ({
    competitorId: r.competitorId,
    companyName: r.companyName,
    hqCountry: r.hqCountry,
    drugCount: Number(r.drugCount),
    avgSharePct: round1(Number(r.avgSharePct)),
  }));
}

export interface MarketSharePoint {
  period: string;
  ourSharePct: number;
  competitorSharePct: number;
}

export async function marketShare(
  p: Principal,
  drugId?: number,
  regionId?: number,
): Promise<MarketSharePoint[]> {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (drugId) {
    filters.push('drug_id = ?');
    params.push(drugId);
  }
  // Managers are limited to their region unless a narrower regionId is passed.
  const effectiveRegion = p.role === 'MANAGER' && p.regionId != null ? p.regionId : regionId;
  if (effectiveRegion) {
    filters.push('region_id = ?');
    params.push(effectiveRegion);
  }
  const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';
  const rows = await query<RowDataPacket & { period: string; ourSharePct: number; competitorSharePct: number }>(
    `SELECT DATE_FORMAT(period_month,'%Y-%m') AS period,
            AVG(our_share_pct) AS ourSharePct,
            AVG(competitor_share_pct) AS competitorSharePct
       FROM market_share ${where}
      GROUP BY period ORDER BY period`,
    params,
  );
  return rows.map((r) => ({
    period: r.period,
    ourSharePct: round1(Number(r.ourSharePct)),
    competitorSharePct: round1(Number(r.competitorSharePct ?? 0)),
  }));
}
