import { Principal } from '../types';

export interface ScopeClause {
  /** SQL fragment to AND into a WHERE clause, already using `?` placeholders. Empty = no restriction. */
  sql: string;
  params: unknown[];
}

const NONE: ScopeClause = { sql: '', params: [] };

/**
 * Role scoping enforced IN SQL (never post-filtered):
 *   ADMIN / EXECUTIVE / ANALYST  -> unrestricted
 *   MANAGER                      -> restricted to their own region_id
 *   SALES_REP                    -> restricted to their own assigned HCP panel / own rep rows
 *
 * The caller passes the SQL expression that identifies the region / hcp / rep on the
 * current query (e.g. an aliased column `s.region_id`). We return a fragment to AND in.
 */

/** Scope by a region_id column. Managers see only their region; reps see only their region too
 * (their panel lives in one region), but reps are further constrained by HCP panel where relevant. */
export function scopeByRegion(p: Principal, regionExpr: string): ScopeClause {
  if (p.role === 'MANAGER') {
    if (p.regionId == null) return { sql: '1 = 0', params: [] }; // misconfigured manager sees nothing
    return { sql: `${regionExpr} = ?`, params: [p.regionId] };
  }
  return NONE;
}

/**
 * Scope by an hcp_id column. A SALES_REP is restricted to the HCPs currently assigned
 * to them (rep_hcp_assignments where assigned_to IS NULL). A MANAGER is restricted to
 * HCPs in their region.
 */
export function scopeByHcp(p: Principal, hcpExpr: string, regionExpr?: string): ScopeClause {
  if (p.role === 'SALES_REP') {
    if (p.repId == null) return { sql: '1 = 0', params: [] };
    return {
      sql: `${hcpExpr} IN (SELECT rha.hcp_id FROM rep_hcp_assignments rha WHERE rha.rep_id = ? AND rha.assigned_to IS NULL)`,
      params: [p.repId],
    };
  }
  if (p.role === 'MANAGER' && regionExpr) {
    if (p.regionId == null) return { sql: '1 = 0', params: [] };
    return { sql: `${regionExpr} = ?`, params: [p.regionId] };
  }
  return NONE;
}

/** Scope by a rep_id column. A SALES_REP sees only their own rep rows; a MANAGER sees reps in their region. */
export function scopeByRep(p: Principal, repExpr: string, regionExpr?: string): ScopeClause {
  if (p.role === 'SALES_REP') {
    if (p.repId == null) return { sql: '1 = 0', params: [] };
    return { sql: `${repExpr} = ?`, params: [p.repId] };
  }
  if (p.role === 'MANAGER' && regionExpr) {
    if (p.regionId == null) return { sql: '1 = 0', params: [] };
    return { sql: `${regionExpr} = ?`, params: [p.regionId] };
  }
  return NONE;
}

/**
 * Scope sales-fact rows (which have both region_id, rep_id and hcp_id).
 * SALES_REP -> their own rep_id; MANAGER -> their region.
 */
export function scopeSales(p: Principal, alias = 's'): ScopeClause {
  return scopeByRep(p, `${alias}.rep_id`, `${alias}.region_id`);
}

/** Combine multiple scope clauses (AND). */
export function andScopes(...clauses: ScopeClause[]): ScopeClause {
  const parts = clauses.filter((c) => c.sql).map((c) => `(${c.sql})`);
  const params = clauses.flatMap((c) => c.params);
  return { sql: parts.join(' AND '), params };
}

/** Build a WHERE clause string from fragments + a scope clause. */
export function buildWhere(fragments: ScopeClause[]): ScopeClause {
  const active = fragments.filter((f) => f.sql);
  if (active.length === 0) return NONE;
  return {
    sql: 'WHERE ' + active.map((f) => `(${f.sql})`).join(' AND '),
    params: active.flatMap((f) => f.params),
  };
}

export function frag(sql: string, ...params: unknown[]): ScopeClause {
  return { sql, params };
}

export { NONE as NO_SCOPE };
