import { Principal } from '../types';
import * as alertsRepo from '../repositories/alerts.repo';
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
export async function getAlerts(
  p: Principal,
  opts: { severity?: string; isRead?: boolean; limit: number; offset?: number },
) {
  // Reads the `alerts` table populated by the ML service's /jobs/refresh-all.
  // Calling the ML service live here returned 2 ANOMALY-shaped rows out of 32
  // stored alerts, so the Alerts page had no title, message or read state.
  return alertsRepo.listAlerts(p, {
    severity: opts.severity,
    isRead: opts.isRead,
    limit: opts.limit,
    offset: opts.offset ?? 0,
  });
}

export async function setAlertRead(alertId: number, isRead: boolean) {
  return alertsRepo.markAlertRead(alertId, isRead);
}
