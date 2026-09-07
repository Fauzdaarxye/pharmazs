import { Principal } from '../types';
import { mlClient } from '../ml/client';

/** Company/drug/region/TA forecast — ML passthrough. */
export function forecast(entityType: string, entityId: number | null, horizon: number) {
  return mlClient.forecast(entityType, entityId, horizon);
}

export function anomalies(severity: string | undefined, from: string | undefined, to: string | undefined) {
  // lookback derived from the requested window when provided, else 12 months.
  let lookback = 12;
  if (from && to) {
    const a = new Date(from + 'T00:00:00Z');
    const b = new Date(to + 'T00:00:00Z');
    lookback = Math.max(1, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1);
  }
  return mlClient.anomalies({ entityType: 'DRUG', metric: 'revenue', lookbackMonths: lookback }).then((rows) =>
    severity ? rows.filter((r) => r.severity === severity) : rows,
  );
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
