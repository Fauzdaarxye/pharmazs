import { Principal } from '../types';
import { mlClient } from '../ml/client';
import * as anomaliesRepo from '../repositories/alerts.repo';

/** Company/drug/region/TA forecast — ML passthrough. */
export function forecast(entityType: string, entityId: number | null, horizon: number) {
  return mlClient.forecast(entityType, entityId, horizon);
}

export function anomalies(
  p: Principal,
  opts: { severity?: string; from?: string; to?: string; direction?: string; limit: number; offset: number },
) {
  // Reads the persisted `anomalies` table (254 rows) rather than recomputing.
  // The live call scanned one entity type over one metric and returned 2 rows, and
  // severity was filtered in JS afterwards - so ?severity=HIGH answered empty while
  // 80 HIGH anomalies sat in the table.
  return anomaliesRepo.listAnomalies(p, opts);
}

export function whyDidSalesChange(payload: { drugId: number; regionId: number; periodMonths: number }) {
  return mlClient.rootCause(payload);
}

export function recommendations(p: Principal, role: string | undefined, limit: number) {
  // Scope: managers/reps get recommendations for their own region/rep.
  return mlClient.recommendations({
    role: role ?? p.role,
    regionId: p.role === 'MANAGER' && p.regionId != null ? p.regionId : undefined,
    repId: p.role === 'SALES_REP' && p.repId != null ? p.repId : undefined,
    limit,
  });
}
