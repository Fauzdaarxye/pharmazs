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
  const region = await repo.repRegion(repId);
  return mlClient.hcpScore({ regionId: region ?? undefined, limit });
}
