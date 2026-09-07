import { Principal } from '../types';
import * as repo from '../repositories/reps.repo';
import { mlClient } from '../ml/client';
import { ApiError } from '../http/envelope';

export const listReps = repo.listReps;
export const getRepHcps = repo.getRepHcps;

export async function getRepDetail(p: Principal, repId: number) {
  if (!(await repo.repExists(repId))) throw ApiError.notFound(`Rep ${repId} not found`);
  const detail = await repo.getRepDetail(p, repId);
  if (!repo.repVisibleToPrincipal(p, detail)) throw ApiError.forbidden('This rep is outside your scope');
  return detail;
}

export async function ensureRepVisible(p: Principal, repId: number): Promise<void> {
  if (!(await repo.repExists(repId))) throw ApiError.notFound(`Rep ${repId} not found`);
  if (p.role === 'SALES_REP' && p.repId !== repId) throw ApiError.forbidden('This rep is outside your scope');
  if (p.role === 'MANAGER') {
    const region = await repo.repRegion(repId);
    if (region !== p.regionId) throw ApiError.forbidden('This rep is outside your region');
  }
}

/** Recommended HCPs for a rep — ML passthrough (SRS §27). */
export async function getRecommendedHcps(p: Principal, repId: number, limit: number) {
  await ensureRepVisible(p, repId);
  // Rank the rep's OWN panel, not their whole region.
  //
  // This previously passed only `regionId`, so the ML service scored every
  // physician in the region and returned the region's top scorers — none of whom
  // were necessarily this rep's to call on. Measured against rep 11: zero of the
  // ten "recommended" HCPs were in their 48-physician panel, and the list opened
  // at a score of 89.6 while the panel's own best was 79.6.
  //
  // That inverts the point of SRS §27, which is "a rep has more doctors than time,
  // so rank the ones they own". A recommendation for someone else's physician is
  // not a prioritisation, it is a distraction.
  const { items } = await repo.getRepHcps(repId, { limit: 1000, offset: 0 });
  const hcpIds = items.map((h) => h.hcpId);
  if (hcpIds.length === 0) return [];
  return mlClient.hcpScore({ hcpIds, limit });
}
