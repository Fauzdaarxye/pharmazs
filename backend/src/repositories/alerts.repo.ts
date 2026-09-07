import { query, queryOne, RowDataPacket } from '../db/pool';
import { Principal } from '../types';
import { buildWhere, frag, ScopeClause } from '../http/scope';

/**
 * Reads the `alerts` and `anomalies` tables that the Python service populates via
 * POST /jobs/refresh-all.
 *
 * Both endpoints previously called the ML service LIVE on every request and threw
 * the persisted rows away. That was wrong in three separate ways:
 *   * it returned 2 rows where the tables hold 32 alerts and 254 anomalies, because
 *     the live call only scans one entity type over one metric;
 *   * /dashboard/alerts returned ANOMALY-shaped objects (zScore, deviationPct)
 *     rather than alerts (title, message, isRead), so the Alerts page had no title
 *     to render and no read state to toggle;
 *   * severity filtering was applied in JS after the fact, so `?severity=HIGH`
 *     returned nothing whenever the live sample happened to contain no HIGH rows —
 *     even though 80 HIGH anomalies were sitting in the table.
 *
 * Precomputing is also the documented design (CONTRACT §6: "so the dashboards can
 * read precomputed values instead of recomputing on every request").
 */

export interface AlertItem {
  alertId: number;
  alertType: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  message: string;
  entityType: string | null;
  entityId: number | null;
  audienceRole: string;
  isRead: boolean;
  createdAt: string;
}

export interface AnomalyItem {
  anomalyId: number;
  entityType: string;
  entityId: number | null;
  entityName: string | null;
  periodMonth: string;
  metric: string;
  actual: number;
  expected: number;
  deviationPct: number;
  zScore: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  direction: 'DROP' | 'SPIKE';
  detectedAt: string;
}

const SEVERITY_ORDER = `FIELD(severity,'CRITICAL','HIGH','MEDIUM','LOW')`;

/** Role scoping: a MANAGER only sees alerts for their own region. */
function regionScope(p: Principal, col: string): ScopeClause {
  if (p.role === 'MANAGER' && p.regionId != null) {
    return frag(`(entity_type <> 'REGION' OR ${col} = ?)`, p.regionId);
  }
  return frag('');
}

export async function listAlerts(
  p: Principal,
  opts: { severity?: string; isRead?: boolean; limit: number; offset: number },
): Promise<{ items: AlertItem[]; total: number }> {
  const clauses: ScopeClause[] = [
    // An EXECUTIVE should not be shown rep-only chatter and vice versa.
    frag(`(audience_role = 'ALL' OR audience_role = ?)`, p.role),
    regionScope(p, 'entity_id'),
    ...(opts.severity ? [frag('severity = ?', opts.severity)] : []),
    ...(opts.isRead !== undefined ? [frag('is_read = ?', opts.isRead ? 1 : 0)] : []),
  ];
  const w = buildWhere(clauses);

  const countRow = await queryOne<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM alerts ${w.sql}`,
    w.params,
  );
  const rows = await query<RowDataPacket & AlertItem>(
    `SELECT alert_id AS alertId, alert_type AS alertType, severity, title, message,
            entity_type AS entityType, entity_id AS entityId,
            audience_role AS audienceRole, is_read AS isRead, created_at AS createdAt
       FROM alerts ${w.sql}
      ORDER BY ${SEVERITY_ORDER}, created_at DESC
      LIMIT ? OFFSET ?`,
    [...w.params, opts.limit, opts.offset],
  );
  return {
    items: rows.map((r) => ({ ...r, isRead: Boolean(r.isRead) })),
    total: Number(countRow?.n ?? 0),
  };
}

export async function markAlertRead(alertId: number, isRead: boolean): Promise<boolean> {
  const row = await queryOne<RowDataPacket>('SELECT alert_id FROM alerts WHERE alert_id = ?', [alertId]);
  if (!row) return false;
  await query('UPDATE alerts SET is_read = ? WHERE alert_id = ?', [isRead ? 1 : 0, alertId]);
  return true;
}

export async function listAnomalies(
  p: Principal,
  opts: { severity?: string; from?: string; to?: string; direction?: string; limit: number; offset: number },
): Promise<{ items: AnomalyItem[]; total: number }> {
  // Clauses are written pre-qualified with the `a.` alias used below. An earlier
  // version built them unqualified and then string-replaced column names into the
  // alias form, which is the kind of SQL-by-regex that breaks the moment a value
  // happens to contain a column name.
  const clauses: ScopeClause[] = [
    p.role === 'MANAGER' && p.regionId != null
      ? frag(`(a.entity_type <> 'REGION' OR a.entity_id = ?)`, p.regionId)
      : frag(''),
    ...(opts.severity ? [frag('a.severity = ?', opts.severity)] : []),
    ...(opts.direction ? [frag('a.direction = ?', opts.direction)] : []),
    ...(opts.from ? [frag('a.period_month >= ?', opts.from)] : []),
    ...(opts.to ? [frag('a.period_month <= ?', opts.to)] : []),
  ];
  const w = buildWhere(clauses);

  const countRow = await queryOne<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM anomalies a ${w.sql}`,
    w.params,
  );
  // entity_name is not stored, so resolve a display label per entity type.
  const rows = await query<RowDataPacket & AnomalyItem>(
    `SELECT a.anomaly_id AS anomalyId, a.entity_type AS entityType, a.entity_id AS entityId,
            CASE a.entity_type
              WHEN 'DRUG'   THEN (SELECT drug_name   FROM drugs   d WHERE d.drug_id   = a.entity_id)
              WHEN 'REGION' THEN (SELECT region_name FROM regions r WHERE r.region_id = a.entity_id)
              WHEN 'TA'     THEN (SELECT ta_name     FROM therapeutic_areas t WHERE t.ta_id = a.entity_id)
              WHEN 'REP'    THEN (SELECT full_name   FROM sales_reps s WHERE s.rep_id   = a.entity_id)
              WHEN 'HCP'    THEN (SELECT full_name   FROM hcps      h WHERE h.hcp_id   = a.entity_id)
              ELSE 'Company'
            END AS entityName,
            a.period_month AS periodMonth, a.metric, a.actual_value AS actual,
            a.expected_value AS expected, a.deviation_pct AS deviationPct,
            a.z_score AS zScore, a.severity, a.direction, a.detected_at AS detectedAt
       FROM anomalies a ${w.sql}
      ORDER BY FIELD(a.severity,'CRITICAL','HIGH','MEDIUM','LOW'), ABS(a.z_score) DESC
      LIMIT ? OFFSET ?`,
    [...w.params, opts.limit, opts.offset],
  );
  return { items: rows, total: Number(countRow?.n ?? 0) };
}
