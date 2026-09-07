import { Principal } from '../types';
import * as repo from '../repositories/hcps.repo';
import { mlClient } from '../ml/client';
import { ApiError } from '../http/envelope';

export const listHcps = repo.listHcps;
export const getHcpSummary = repo.getHcpSummary;
export const getHcpTrend = repo.getHcpTrend;

export async function getHcpDetail(p: Principal, hcpId: number) {
  if (!(await repo.hcpExists(hcpId))) throw ApiError.notFound(`HCP ${hcpId} not found`);
  const detail = await repo.getHcpDetail(p, hcpId);
  if (!detail) throw ApiError.forbidden('This HCP is not in your panel');
  return detail;
}

export async function ensureHcpVisible(p: Principal, hcpId: number): Promise<void> {
  if (!(await repo.hcpExists(hcpId))) throw ApiError.notFound(`HCP ${hcpId} not found`);
  if (!(await repo.hcpVisibleToPrincipal(p, hcpId))) throw ApiError.forbidden('This HCP is not in your panel');
}

/** Live score recompute — ML passthrough. Scope-checked before calling FastAPI. */
export async function getHcpScore(p: Principal, hcpId: number) {
  await ensureHcpVisible(p, hcpId);
  const result = await mlClient.hcpScore({ hcpIds: [hcpId] });
  return result[0] ?? null;
}
