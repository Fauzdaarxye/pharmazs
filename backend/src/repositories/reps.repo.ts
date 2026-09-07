import { query, queryOne, RowDataPacket } from '../db/pool';
import { Principal } from '../types';
import { buildWhere, frag, ScopeClause } from '../http/scope';
import { resolveWindow } from './common.repo';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const REP_SORT: Record<string, string> = {
  fullName: 'fullName',
  revenue: 'revenue',
  target: 'target',
  achievementPct: 'achievementPct',
  visits: 'visits',
  hcpCount: 'hcpCount',
};

function repScope(p: Principal): ScopeClause {
  if (p.role === 'SALES_REP' && p.repId != null) return frag('sr.rep_id = ?', p.repId);
  if (p.role === 'MANAGER' && p.regionId != null) return frag('sr.region_id = ?', p.regionId);
  return frag('');
}

export interface RepListItem {
  repId: number;
  repCode: string;
  fullName: string;
  regionId: number;
  regionName: string;
  territory: string | null;
  revenue: number;
  target: number;
  achievementPct: number;
  visits: number;
  hcpCount: number;
  rank: number;
}

export async function listReps(
  p: Principal,
  opts: { from?: string; to?: string; regionIds: number[]; sortColumn: string; sortDir: 'ASC' | 'DESC'; limit: number; offset: number },
): Promise<{ items: RepListItem[]; total: number }> {
  const { from, to } = await resolveWindow(opts.from, opts.to);
  const filters: ScopeClause[] = [
    repScope(p),
    frag('sr.is_active = 1'),
    // Quota-carrying FIELD reps only. Managers (manager_id IS NULL) hold zone
    // targets rather than monthly quotas, so they joined the leaderboard with
    // target = 0 and achievement = 0 — ten phantom bottom-rankers that dragged
    // team attainment from 100.9% down to 86.5% and made the whole column
    // look broken. A manager belongs in a team roster, not a quota ranking.
    frag('sr.manager_id IS NOT NULL'),
  ];
  if (opts.regionIds.length) filters.push(frag(`sr.region_id IN (${opts.regionIds.map(() => '?').join(',')})`, ...opts.regionIds));
  const where = buildWhere(filters);

  const total = (await queryOne<RowDataPacket & { n: number }>(`SELECT COUNT(*) AS n FROM sales_reps sr ${where.sql}`, where.params))?.n ?? 0;

  const sql = `
    SELECT sr.rep_id AS repId, sr.rep_code AS repCode, sr.full_name AS fullName, sr.region_id AS regionId,
           r.region_name AS regionName, sr.territory AS territory,
           COALESCE(sal.revenue,0) AS revenue,
           COALESCE(tg.target,0) AS target,
           ROUND(CASE WHEN COALESCE(tg.target,0)=0 THEN 0 ELSE COALESCE(sal.revenue,0)/tg.target*100 END,1) AS achievementPct,
           COALESCE(vis.visits,0) AS visits,
           COALESCE(hc.n,0) AS hcpCount
      FROM sales_reps sr
      JOIN regions r ON r.region_id = sr.region_id
      LEFT JOIN (SELECT rep_id, SUM(revenue) revenue FROM sales WHERE sale_date BETWEEN ? AND ? GROUP BY rep_id) sal ON sal.rep_id = sr.rep_id
      LEFT JOIN (SELECT rep_id, SUM(target_revenue) target FROM rep_targets WHERE period_month BETWEEN ? AND ? GROUP BY rep_id) tg ON tg.rep_id = sr.rep_id
      LEFT JOIN (SELECT rep_id, COUNT(*) visits FROM visits WHERE visit_date BETWEEN ? AND ? GROUP BY rep_id) vis ON vis.rep_id = sr.rep_id
      LEFT JOIN (SELECT rep_id, COUNT(*) n FROM rep_hcp_assignments WHERE assigned_to IS NULL GROUP BY rep_id) hc ON hc.rep_id = sr.rep_id
      ${where.sql}
      ORDER BY ${opts.sortColumn} ${opts.sortDir}
      LIMIT ? OFFSET ?`;
  const rows = await query<RowDataPacket & RepListItem>(sql, [from, to, from, to, from, to, ...where.params, opts.limit, opts.offset]);

  // rank by revenue over the full (scoped) population, independent of pagination.
  const rankRows = await query<RowDataPacket & { repId: number; revenue: number }>(
    `SELECT sr.rep_id AS repId, COALESCE(sal.revenue,0) AS revenue
       FROM sales_reps sr
       LEFT JOIN (SELECT rep_id, SUM(revenue) revenue FROM sales WHERE sale_date BETWEEN ? AND ? GROUP BY rep_id) sal ON sal.rep_id = sr.rep_id
       ${where.sql}
      ORDER BY revenue DESC`,
    [from, to, ...where.params],
  );
  const rankMap = new Map<number, number>();
  rankRows.forEach((r, i) => rankMap.set(r.repId, i + 1));

  const items = rows.map((r) => ({
    repId: r.repId,
    repCode: r.repCode,
    fullName: r.fullName,
    regionId: r.regionId,
    regionName: r.regionName,
    territory: r.territory,
    revenue: round2(Number(r.revenue)),
    target: round2(Number(r.target)),
    achievementPct: Number(r.achievementPct),
    visits: Number(r.visits),
    hcpCount: Number(r.hcpCount),
    rank: rankMap.get(r.repId) ?? 0,
  }));
  return { items, total };
}

export async function getRepDetail(p: Principal, repId: number): Promise<RepListItem | null> {
  const { items } = await listReps(p, { regionIds: [], sortColumn: 'revenue', sortDir: 'DESC', limit: 1000, offset: 0 });
  return items.find((r) => r.repId === repId) ?? null;
}

export interface RepPanelHcp {
  hcpId: number;
  hcpCode: string;
  fullName: string;
  specialty: string;
  hospital: string;
  regionName: string;
  potentialScore: number | null;
  priority: string | null;
  lastVisitDate: string | null;
}

/**
 * A rep's current HCP panel, PAGINATED. This previously ignored pageSize entirely
 * and returned all 48 rows with no `meta`, so the caller had no total to page with.
 * Panel size is unbounded in principle (a territory reshuffle can attach hundreds),
 * so an unpaginated list is a latent payload problem, not just a cosmetic one.
 */
export async function getRepHcps(
  repId: number,
  opts: { limit: number; offset: number } = { limit: 25, offset: 0 },
): Promise<{ items: RepPanelHcp[]; total: number }> {
  const countRow = await queryOne<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM rep_hcp_assignments
      WHERE rep_id = ? AND assigned_to IS NULL`,
    [repId],
  );
  const rows = await query<RowDataPacket & RepPanelHcp>(
    `SELECT h.hcp_id AS hcpId, h.hcp_code AS hcpCode, h.full_name AS fullName,
            h.specialty AS specialty, h.hospital AS hospital, r.region_name AS regionName,
            s.total_score AS potentialScore, s.priority AS priority,
            (SELECT MAX(v.visit_date) FROM visits v WHERE v.hcp_id = h.hcp_id) AS lastVisitDate
       FROM rep_hcp_assignments rha
       JOIN hcps h    ON h.hcp_id = rha.hcp_id
       JOIN regions r ON r.region_id = h.region_id
       LEFT JOIN hcp_scores s ON s.hcp_id = h.hcp_id
      WHERE rha.rep_id = ? AND rha.assigned_to IS NULL
      ORDER BY s.total_score DESC, h.full_name
      LIMIT ? OFFSET ?`,
    [repId, opts.limit, opts.offset],
  );
  return { items: rows, total: Number(countRow?.n ?? 0) };
}

export function repVisibleToPrincipal(p: Principal, rep: RepListItem | null): boolean {
  if (!rep) return false;
  if (p.role === 'SALES_REP') return p.repId === rep.repId;
  if (p.role === 'MANAGER') return p.regionId === rep.regionId;
  return true;
}

export async function repExists(repId: number): Promise<boolean> {
  const r = await queryOne<RowDataPacket>('SELECT rep_id FROM sales_reps WHERE rep_id = ?', [repId]);
  return !!r;
}

export async function repRegion(repId: number): Promise<number | null> {
  const r = await queryOne<RowDataPacket & { region_id: number }>('SELECT region_id FROM sales_reps WHERE rep_id = ?', [repId]);
  return r?.region_id ?? null;
}
