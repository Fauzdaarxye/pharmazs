import { Principal } from '../types';
import * as repo from '../repositories/dashboard.repo';
import { mlClient } from '../ml/client';

export interface DashFilters {
  from?: string;
  to?: string;
  regionIds: number[];
  taId?: number;
  drugId?: number;
}

export const getKpis = (p: Principal, f: DashFilters) => repo.getKpis(p, f);

export const getRevenueTrend = (
  p: Principal,
  f: DashFilters & { granularity: 'monthly' | 'daily' },
) => repo.getRevenueTrend(p, f);

export const getTherapeuticAreas = (p: Principal, f: DashFilters) => repo.getTherapeuticAreas(p, f);

export const getRegionalPerformance = (p: Principal, f: DashFilters) =>
  repo.getRegionalPerformance(p, f);

export const getTopProducts = (p: Principal, f: DashFilters & { limit: number }) =>
  repo.getTopProducts(p, f);

export const getTopHcps = (p: Principal, f: DashFilters & { limit: number }) =>
  repo.getTopHcps(p, f);

/** Alerts are ML-derived. Passthrough to FastAPI (as anomalies), scoped by role. */
export async function getAlerts(p: Principal, limit: number) {
  const payload = { entityType: 'DRUG', metric: 'revenue', lookbackMonths: 12 };
  const anomalies = await mlClient.anomalies(payload);
  return anomalies
    .filter((a) => (p.role === 'MANAGER' && p.regionId != null && a.entityType === 'REGION' ? a.entityId === p.regionId : true))
    .slice(0, limit);
}
