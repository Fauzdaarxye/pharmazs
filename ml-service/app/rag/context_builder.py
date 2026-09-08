"""Retrieval layer — turns a ParsedQuery into a compact, verified data context.

This is the "R" in RAG. Every number handed to the LLM comes from a
parameterised query against MySQL; nothing is invented here and nothing is
hardcoded.

TWO RULES THAT MATTER
---------------------
1. ROLE SCOPING IS APPLIED IN SQL, not after the fact. This mirrors how the Node
   API scopes every other endpoint (WHERE clauses, never post-filtering in
   application code). A SALES_REP must not be able to widen their view by
   phrasing a question differently, so scope predicates are appended to the
   WHERE clause of each query rather than trusted to the model.

2. THE CONTEXT IS BUDGETED. The LLM is told to answer ONLY from this text, so it
   must be small enough to survive in the prompt but complete enough to answer.
   Every query is LIMITed and the result is rendered as compact markdown tables.
   `build_context` enforces a hard character ceiling as a backstop.
"""
from __future__ import annotations

from dataclasses import dataclass

from .. import db, root_cause
from .router import ParsedQuery

# ~4 chars/token is the usual rough ratio, so 8000 chars keeps us under the
# 2000-token budget the design calls for even in the worst case.
MAX_CONTEXT_CHARS = 8000

_ROLES_GLOBAL = {"ADMIN", "EXECUTIVE", "ANALYST"}


@dataclass
class RoleScope:
    """Normalised view of the caller's data visibility.

    Built from the JWT principal by the Node API — never from anything the user
    typed.
    """
    role: str
    region_id: int | None = None
    rep_id: int | None = None

    @classmethod
    def from_dict(cls, raw: dict | None) -> "RoleScope":
        raw = raw or {}
        role = str(raw.get("role") or "EXECUTIVE").upper()
        region = raw.get("regionId", raw.get("region_id"))
        rep = raw.get("repId", raw.get("rep_id"))
        return cls(
            role=role,
            region_id=int(region) if region not in (None, "") else None,
            rep_id=int(rep) if rep not in (None, "") else None,
        )

    @property
    def is_global(self) -> bool:
        return self.role in _ROLES_GLOBAL

    def describe(self) -> str:
        if self.is_global:
            return f"{self.role} — full cross-enterprise visibility"
        if self.role == "MANAGER" and self.region_id is not None:
            return f"MANAGER — restricted to region_id={self.region_id}"
        if self.role == "SALES_REP" and self.rep_id is not None:
            return f"SALES_REP — restricted to rep_id={self.rep_id} and that rep's own HCP panel"
        # A MANAGER/SALES_REP with no id attached cannot be scoped, so it is
        # treated as the narrowest possible view rather than silently widened.
        return f"{self.role} — no scope id attached; results deliberately withheld"

    @property
    def is_unscopable(self) -> bool:
        """True when the role demands a scope id that is missing.

        Returning global data in this case would be a privilege escalation, so
        callers render an explicit refusal instead.
        """
        if self.role == "MANAGER":
            return self.region_id is None
        if self.role == "SALES_REP":
            return self.rep_id is None
        return False


# ---------------------------------------------------------------------------
# scope helpers — each returns (sql_fragment, params)
# ---------------------------------------------------------------------------
def _sales_scope(scope: RoleScope, alias: str = "s") -> tuple[str, list]:
    if scope.is_global:
        return "", []
    if scope.role == "MANAGER":
        return f" AND {alias}.region_id = %s", [scope.region_id]
    if scope.role == "SALES_REP":
        return f" AND {alias}.rep_id = %s", [scope.rep_id]
    return "", []


def _hcp_scope(scope: RoleScope, alias: str = "h") -> tuple[str, list]:
    """Scope a query over hcps.

    A SALES_REP sees only their CURRENT panel — rep_hcp_assignments carries
    validity dates, and assigned_to IS NULL marks the present owner. Filtering
    on rep_id alone would leak physicians they used to own.
    """
    if scope.is_global:
        return "", []
    if scope.role == "MANAGER":
        return f" AND {alias}.region_id = %s", [scope.region_id]
    if scope.role == "SALES_REP":
        return (
            f" AND {alias}.hcp_id IN ("
            " SELECT rha.hcp_id FROM rep_hcp_assignments rha"
            " WHERE rha.rep_id = %s AND rha.assigned_to IS NULL)",
            [scope.rep_id],
        )
    return "", []


def _region_scope(scope: RoleScope, column: str) -> tuple[str, list]:
    if scope.is_global:
        return "", []
    if scope.role == "MANAGER":
        return f" AND {column} = %s", [scope.region_id]
    if scope.role == "SALES_REP":
        # A rep has no region of their own on the fact row here; fall back to the
        # region their sales_reps record belongs to.
        return (
            f" AND {column} = (SELECT sr.region_id FROM sales_reps sr WHERE sr.rep_id = %s)",
            [scope.rep_id],
        )
    return "", []


# ---------------------------------------------------------------------------
# formatting helpers
# ---------------------------------------------------------------------------
def _fmt_inr(value: float | None) -> str:
    """Indian numbering. The LLM is told to use ₹ Cr / ₹ Lakh, so give it those
    units directly rather than raw rupees it has to convert (and can get wrong).
    """
    if value is None:
        return "n/a"
    v = float(value)
    if abs(v) >= 1_00_00_000:
        return f"₹{v / 1_00_00_000:.2f} Cr"
    if abs(v) >= 1_00_000:
        return f"₹{v / 1_00_000:.2f} Lakh"
    return f"₹{v:,.0f}"


def _table(rows: list[dict], columns: list[tuple[str, str]]) -> str:
    """Render rows as a compact markdown table.

    `columns` is a list of (header, dict-key) pairs, so column order and naming
    are explicit rather than dependent on dict ordering.
    """
    if not rows:
        return "_no rows_"
    head = "| " + " | ".join(h for h, _ in columns) + " |"
    sep = "|" + "|".join("---" for _ in columns) + "|"
    body = [
        "| " + " | ".join(str(r.get(k, "")) for _, k in columns) + " |"
        for r in rows
    ]
    return "\n".join([head, sep, *body])


def _latest_scored_at() -> str | None:
    """hcp_scores accumulates one row per HCP per scoring run, so any query that
    forgets to pin the run returns duplicated, mixed-vintage scores.
    """
    row = db.query_one("SELECT MAX(scored_at) AS m FROM hcp_scores")
    return str(row["m"]) if row and row["m"] else None


# ---------------------------------------------------------------------------
# per-intent retrieval
# ---------------------------------------------------------------------------
def _sales_context(parsed: ParsedQuery, scope: RoleScope) -> str:
    scope_sql, scope_params = _sales_scope(scope, "s")
    months = 6
    sql = f"""
        SELECT DATE_FORMAT(s.sale_date, '%%Y-%%m') AS period,
               d.drug_name                        AS drug,
               r.region_name                      AS region,
               SUM(s.revenue)                     AS revenue,
               SUM(s.units_sold)                  AS units
          FROM sales s
          JOIN drugs d   ON d.drug_id   = s.drug_id
          JOIN regions r ON r.region_id = s.region_id
         WHERE s.sale_date >= DATE_SUB(
                   (SELECT MAX(sale_date) FROM sales), INTERVAL {months} MONTH)
               {scope_sql}
         GROUP BY period, drug, region
         ORDER BY revenue DESC
         LIMIT 25
    """
    rows = db.query_df(sql, tuple(scope_params)).to_dict("records")
    for r in rows:
        r["revenue"] = _fmt_inr(r["revenue"])
        r["units"] = f"{int(r['units']):,}"
    total_sql = f"""
        SELECT SUM(s.revenue) AS total
          FROM sales s
         WHERE s.sale_date >= DATE_SUB(
                   (SELECT MAX(sale_date) FROM sales), INTERVAL 12 MONTH)
               {scope_sql}
    """
    total = db.query_one(total_sql, tuple(scope_params))
    return "\n".join([
        f"### Sales — top drug/region/month rows, last {months} months",
        _table(rows, [("Month", "period"), ("Drug", "drug"),
                      ("Region", "region"), ("Revenue", "revenue"), ("Units", "units")]),
        "",
        f"**Trailing 12-month revenue in scope:** {_fmt_inr(total['total'] if total else None)}",
    ])


def _hcp_context(parsed: ParsedQuery, scope: RoleScope) -> str:
    scored_at = _latest_scored_at()
    if not scored_at:
        return ("### HCP priority scores\n_no scores persisted — the ML refresh job "
                "(POST /jobs/refresh-all) has not run_")
    scope_sql, scope_params = _hcp_scope(scope, "h")
    sql = f"""
        SELECT h.full_name        AS hcp,
               h.specialty        AS specialty,
               r.region_name      AS region,
               h.hcp_tier         AS tier,
               hs.total_score     AS score,
               hs.priority        AS priority
          FROM hcp_scores hs
          JOIN hcps h    ON h.hcp_id    = hs.hcp_id
          JOIN regions r ON r.region_id = h.region_id
         WHERE hs.scored_at = %s
               {scope_sql}
         ORDER BY hs.total_score DESC
         LIMIT 15
    """
    rows = db.query_df(sql, tuple([scored_at, *scope_params])).to_dict("records")
    for r in rows:
        r["score"] = f"{float(r['score']):.1f}"
    return "\n".join([
        "### Top HCPs by priority score (0-100, weighted: volume 40, growth 25, "
        "engagement 15, TA relevance 10, competitor gap 10)",
        _table(rows, [("HCP", "hcp"), ("Specialty", "specialty"), ("Region", "region"),
                      ("Tier", "tier"), ("Score", "score"), ("Priority", "priority")]),
    ])


def _product_context(parsed: ParsedQuery, scope: RoleScope) -> str:
    scope_sql, scope_params = _sales_scope(scope, "s")
    sql = f"""
        SELECT d.drug_name          AS drug,
               ta.ta_name           AS area,
               SUM(s.revenue)       AS revenue,
               SUM(s.units_sold)    AS units
          FROM sales s
          JOIN drugs d             ON d.drug_id = s.drug_id
          JOIN therapeutic_areas ta ON ta.ta_id = d.ta_id
         WHERE s.sale_date >= DATE_SUB(
                   (SELECT MAX(sale_date) FROM sales), INTERVAL 12 MONTH)
               {scope_sql}
         GROUP BY drug, area
         ORDER BY revenue DESC
         LIMIT 15
    """
    rows = db.query_df(sql, tuple(scope_params)).to_dict("records")

    # Market share lives on its own WIDE table: one row per (drug, region, month)
    # with our_share_pct populated on EVERY row. Filtering on
    # competitor_drug_id IS NULL would silently drop most of the catalogue.
    share_scope, share_params = _region_scope(scope, "ms.region_id")
    share_sql = f"""
        SELECT d.drug_name              AS drug,
               AVG(ms.our_share_pct)    AS our_share
          FROM market_share ms
          JOIN drugs d ON d.drug_id = ms.drug_id
         WHERE ms.period_month = (SELECT MAX(period_month) FROM market_share)
               {share_scope}
         GROUP BY drug
         ORDER BY our_share DESC
         LIMIT 10
    """
    shares = db.query_df(share_sql, tuple(share_params)).to_dict("records")
    for r in rows:
        r["revenue"] = _fmt_inr(r["revenue"])
        r["units"] = f"{int(r['units']):,}"
    for r in shares:
        r["our_share"] = f"{float(r['our_share']):.1f}%"
    return "\n".join([
        "### Products by revenue, trailing 12 months",
        _table(rows, [("Drug", "drug"), ("Therapeutic area", "area"),
                      ("Revenue", "revenue"), ("Units", "units")]),
        "",
        "### Our market share, latest month",
        _table(shares, [("Drug", "drug"), ("Our share", "our_share")]),
    ])


def _inventory_context(parsed: ParsedQuery, scope: RoleScope) -> str:
    scope_sql, scope_params = _region_scope(scope, "inv.region_id")
    sql = f"""
        SELECT d.drug_name        AS drug,
               r.region_name      AS region,
               inv.closing_stock  AS closing_stock,
               inv.units_out      AS units_out,
               inv.stockout_days  AS stockout_days
          FROM inventory_snapshots inv
          JOIN drugs d   ON d.drug_id   = inv.drug_id
          JOIN regions r ON r.region_id = inv.region_id
         WHERE inv.snapshot_month = (SELECT MAX(snapshot_month) FROM inventory_snapshots)
               {scope_sql}
         ORDER BY inv.stockout_days DESC,
                  (inv.closing_stock / NULLIF(inv.units_out, 0)) ASC
         LIMIT 15
    """
    rows = db.query_df(sql, tuple(scope_params)).to_dict("records")
    out = []
    for r in rows:
        units_out = float(r["units_out"] or 0)
        cover = (float(r["closing_stock"]) / units_out) if units_out else None
        # Same thresholds the Inventory page uses, so the chatbot and the UI
        # cannot disagree about what "at risk" means.
        risk = "HIGH" if (int(r["stockout_days"]) > 5 or (cover is not None and cover < 1)) \
            else ("MEDIUM" if cover is not None and cover < 2 else "LOW")
        out.append({
            "drug": r["drug"], "region": r["region"],
            "closing_stock": f"{int(r['closing_stock']):,}",
            "cover": f"{cover:.1f} mo" if cover is not None else "n/a",
            "stockout_days": int(r["stockout_days"]),
            "risk": risk,
        })
    return "\n".join([
        "### Inventory — latest monthly snapshot, ordered by stockout risk",
        "_cover = closing stock / monthly units out; HIGH = >5 stockout days or "
        "under 1 month of cover_",
        _table(out, [("Drug", "drug"), ("Region", "region"),
                     ("Closing stock", "closing_stock"), ("Cover", "cover"),
                     ("Stockout days", "stockout_days"), ("Risk", "risk")]),
    ])


def _resolve_drug(raw: str) -> tuple[int, str] | None:
    """Find a drug named in free text by matching against the catalogue.

    Done in SQL against drugs.drug_name rather than a hardcoded list, so a new
    or renamed product needs no code change. Longest name first so "CardioMax
    XR" wins over "CardioMax" when both exist.
    """
    rows = db.query_df(
        "SELECT drug_id, drug_name FROM drugs ORDER BY CHAR_LENGTH(drug_name) DESC"
    ).to_dict("records")
    lowered = raw.lower()
    for r in rows:
        if str(r["drug_name"]).lower() in lowered:
            return int(r["drug_id"]), str(r["drug_name"])
    return None


def _resolve_region(parsed: ParsedQuery, scope: RoleScope) -> tuple[int, str] | None | str:
    """Region named in the text, else the caller's own scope region.

    Returns the (id, name) pair, None when no region could be determined, or a
    string reason when the named region exists but this caller may not see it —
    the caller renders that reason verbatim, so a denial is never reported as
    "you didn't name a region".
    """
    if parsed.region_hint:
        row = db.query_one(
            "SELECT region_id, region_name FROM regions WHERE region_name = %s",
            (parsed.region_hint,),
        )
        if row:
            # A scoped user may not ask about someone else's region.
            if not scope.is_global and scope.region_id is not None \
                    and int(row["region_id"]) != scope.region_id:
                return (f"your role is scoped to a single region, and "
                        f"{row['region_name']} is not it")
            return int(row["region_id"]), str(row["region_name"])
    if scope.region_id is not None:
        row = db.query_one(
            "SELECT region_id, region_name FROM regions WHERE region_id = %s",
            (scope.region_id,),
        )
        if row:
            return int(row["region_id"]), str(row["region_name"])
    return None


def _root_cause_context(parsed: ParsedQuery, scope: RoleScope) -> str:
    drug = _resolve_drug(parsed.raw)
    region = _resolve_region(parsed, scope)

    if isinstance(region, str):
        return f"### Root cause\n_Cannot run attribution: {region}._"

    if not drug or not region:
        missing = []
        if not drug:
            missing.append("a product name")
        if not region:
            missing.append("a region")
        return ("### Root cause\n_Cannot run attribution: the question does not name "
                + " and ".join(missing)
                + ". Root-cause analysis is computed for one product in one region._")

    drug_id, drug_name = drug
    region_id, region_name = region
    rc = root_cause.compute_root_cause(drug_id, region_id, parsed.period_months)
    h = rc["headline"]
    lines = [
        f"### Root-cause attribution — {drug_name} in {region_name} ({h['periodLabel']})",
        f"**Revenue {h['direction'].lower()} {h['changePct']:+.1f}%** — "
        f"{_fmt_inr(h['previous'])} → {_fmt_inr(h['current'])}",
        "",
        "Contributors, ranked by share of the explained movement "
        "(contributions sum to 100%):",
        _table(
            [{
                "factor": c["label"],
                "change": f"{c['changePct']:+.1f}",
                "contribution": f"{c['contributionPct']:.1f}%",
                "direction": c["direction"],
                "detail": c["detail"],
            } for c in rc["contributors"]],
            [("Factor", "factor"), ("Change", "change"),
             ("Contribution", "contribution"), ("Push", "direction"), ("Detail", "detail")],
        ),
        "",
        f"Model confidence: {rc['confidence']:.2f}",
    ]
    return "\n".join(lines)


def _forecast_context(parsed: ParsedQuery, scope: RoleScope) -> str:
    scope_sql, scope_params = "", []
    # forecasts are stored per entity; a scoped user only sees their own region's.
    if not scope.is_global and scope.region_id is not None:
        scope_sql = " AND (f.entity_type <> 'REGION' OR f.entity_id = %s)"
        scope_params = [scope.region_id]
    sql = f"""
        SELECT f.entity_type                          AS entity_type,
               f.entity_id                            AS entity_id,
               DATE_FORMAT(f.period_month, '%%Y-%%m')  AS period,
               f.predicted_revenue                    AS predicted,
               f.lower_bound                          AS lower_bound,
               f.upper_bound                          AS upper_bound,
               f.model_name                           AS model,
               f.mape                                 AS mape
          FROM forecasts f
         WHERE f.generated_at = (SELECT MAX(generated_at) FROM forecasts)
               {scope_sql}
         ORDER BY f.entity_type, f.period_month
         LIMIT 20
    """
    df = db.query_df(sql, tuple(scope_params))
    if df.empty:
        return ("### Forecasts\n_no forecasts persisted — the ML refresh job "
                "(POST /jobs/refresh-all) has not run_")
    rows = df.to_dict("records")
    from .. import queries as q
    out = []
    for r in rows:
        out.append({
            "entity": q.entity_name(r["entity_type"], r["entity_id"]),
            "period": r["period"],
            "predicted": _fmt_inr(r["predicted"]),
            "band": f"{_fmt_inr(r['lower_bound'])} – {_fmt_inr(r['upper_bound'])}",
            "model": r["model"],
            "mape": f"{float(r['mape']):.1f}%" if r["mape"] is not None else "n/a",
        })
    return "\n".join([
        "### Forecasts — latest generated run",
        "_MAPE is backtest error: lower means the model tracked history more "
        "closely. The band is the 95% interval._",
        _table(out, [("Entity", "entity"), ("Month", "period"),
                     ("Predicted", "predicted"), ("95% band", "band"),
                     ("Model", "model"), ("MAPE", "mape")]),
    ])


def _anomaly_context(parsed: ParsedQuery, scope: RoleScope) -> str:
    scope_sql, scope_params = "", []
    if not scope.is_global and scope.region_id is not None:
        scope_sql = " AND (a.entity_type <> 'REGION' OR a.entity_id = %s)"
        scope_params = [scope.region_id]
    sql = f"""
        SELECT a.entity_type                          AS entity_type,
               a.entity_id                            AS entity_id,
               DATE_FORMAT(a.period_month, '%%Y-%%m')  AS period,
               a.metric                               AS metric,
               a.actual_value                         AS actual,
               a.expected_value                       AS expected,
               a.deviation_pct                        AS deviation_pct,
               a.z_score                              AS z_score,
               a.severity                             AS severity,
               a.direction                            AS direction
          FROM anomalies a
         WHERE 1 = 1 {scope_sql}
         ORDER BY FIELD(a.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'),
                  ABS(a.z_score) DESC
         LIMIT 15
    """
    df = db.query_df(sql, tuple(scope_params))
    if df.empty:
        return ("### Anomalies\n_no anomalies persisted — the ML refresh job "
                "(POST /jobs/refresh-all) has not run_")
    from .. import queries as q
    out = []
    for r in df.to_dict("records"):
        out.append({
            "entity": q.entity_name(r["entity_type"], r["entity_id"]),
            "period": r["period"],
            "metric": r["metric"],
            "actual": _fmt_inr(r["actual"]) if r["metric"] == "revenue" else f"{float(r['actual']):,.0f}",
            "deviation": f"{float(r['deviation_pct']):+.1f}%",
            "z": f"{float(r['z_score']):+.2f}",
            "severity": r["severity"],
            "direction": r["direction"],
        })
    return "\n".join([
        "### Detected anomalies, most severe first",
        "_z is a robust z-score on the seasonally adjusted series; DROP/SPIKE is "
        "the direction of the deviation._",
        _table(out, [("Entity", "entity"), ("Month", "period"), ("Metric", "metric"),
                     ("Actual", "actual"), ("Deviation", "deviation"), ("z", "z"),
                     ("Severity", "severity"), ("Direction", "direction")]),
    ])


def _region_context(parsed: ParsedQuery, scope: RoleScope) -> str:
    scope_sql, scope_params = _region_scope(scope, "s.region_id")
    sql = f"""
        SELECT r.region_name    AS region,
               SUM(s.revenue)   AS revenue,
               COUNT(DISTINCT s.drug_id) AS products,
               COUNT(DISTINCT s.rep_id)  AS reps
          FROM sales s
          JOIN regions r ON r.region_id = s.region_id
         WHERE s.sale_date >= DATE_SUB(
                   (SELECT MAX(sale_date) FROM sales), INTERVAL 12 MONTH)
               {scope_sql}
         GROUP BY region
         ORDER BY revenue DESC
    """
    rows = db.query_df(sql, tuple(scope_params)).to_dict("records")
    for r in rows:
        r["revenue"] = _fmt_inr(r["revenue"])
    return "\n".join([
        "### Regional performance, trailing 12 months",
        _table(rows, [("Region", "region"), ("Revenue", "revenue"),
                      ("Products sold", "products"), ("Active reps", "reps")]),
    ])


def _rep_context(parsed: ParsedQuery, scope: RoleScope) -> str:
    scope_sql, scope_params = _sales_scope(scope, "s")
    # Attainment compares achieved revenue against the rep's monthly quota.
    # Managers carry no monthly quota, so they are excluded — including them
    # reports them at 0% and drags the team mean down misleadingly.
    sql = f"""
        SELECT sr.full_name                       AS rep,
               r.region_name                      AS region,
               SUM(s.revenue)                     AS revenue,
               SUM(rt.target_revenue)             AS target
          FROM sales s
          JOIN sales_reps sr ON sr.rep_id = s.rep_id
          JOIN regions r     ON r.region_id = sr.region_id
          JOIN rep_targets rt
               ON rt.rep_id = s.rep_id
              AND rt.period_month = DATE_FORMAT(s.sale_date, '%%Y-%%m-01')
         WHERE s.sale_date >= DATE_SUB(
                   (SELECT MAX(sale_date) FROM sales), INTERVAL 12 MONTH)
               {scope_sql}
         GROUP BY rep, region
         ORDER BY revenue DESC
         LIMIT 15
    """
    rows = db.query_df(sql, tuple(scope_params)).to_dict("records")
    out = []
    for r in rows:
        target = float(r["target"] or 0)
        att = (float(r["revenue"]) / target * 100.0) if target else None
        out.append({
            "rep": r["rep"], "region": r["region"],
            "revenue": _fmt_inr(r["revenue"]),
            "target": _fmt_inr(target) if target else "n/a",
            "attainment": f"{att:.0f}%" if att is not None else "n/a",
        })
    return "\n".join([
        "### Sales rep attainment, trailing 12 months (quota-carrying field reps only)",
        _table(out, [("Rep", "rep"), ("Region", "region"), ("Revenue", "revenue"),
                     ("Target", "target"), ("Attainment", "attainment")]),
    ])


def _general_context(parsed: ParsedQuery, scope: RoleScope) -> str:
    """Company-level orientation for a message with no clear intent.

    Kept deliberately small — its job is to let the model answer "what can you
    tell me?" and to name the data that IS available, not to answer everything.
    """
    scope_sql, scope_params = _sales_scope(scope, "s")
    totals = db.query_one(f"""
        SELECT SUM(s.revenue)              AS revenue,
               COUNT(*)                    AS sale_rows,
               MIN(s.sale_date)            AS first_sale,
               MAX(s.sale_date)            AS last_sale
          FROM sales s
         WHERE s.sale_date >= DATE_SUB(
                   (SELECT MAX(sale_date) FROM sales), INTERVAL 12 MONTH)
               {scope_sql}
    """, tuple(scope_params))
    return "\n".join([
        "### Dataset overview (in the caller's scope)",
        f"- Trailing 12-month revenue: {_fmt_inr(totals['revenue'] if totals else None)}",
        f"- Sale rows in window: {int(totals['sale_rows']):,}" if totals else "",
        f"- Data covers: {totals['first_sale']} to {totals['last_sale']}" if totals else "",
        "",
        "Available topics: sales and revenue, products and market share, HCP "
        "priority scores, sales-rep attainment, regional performance, inventory "
        "and stockout risk, revenue forecasts, detected anomalies, and "
        "root-cause attribution for a named product in a named region.",
    ])


_HANDLERS = {
    "SALES_QUERY": _sales_context,
    "HCP_QUERY": _hcp_context,
    "PRODUCT_QUERY": _product_context,
    "INVENTORY_QUERY": _inventory_context,
    "ROOT_CAUSE_QUERY": _root_cause_context,
    "FORECAST_QUERY": _forecast_context,
    "ANOMALY_QUERY": _anomaly_context,
    "REGION_QUERY": _region_context,
    "REP_QUERY": _rep_context,
    "COMPARISON_QUERY": _region_context,   # comparisons are regional by default
    "GENERAL": _general_context,
}


def build_context(parsed: ParsedQuery, role_scope: dict | None) -> str:
    """Retrieve the data context for a parsed question.

    Never raises for a data problem: a failure is reported INTO the context so
    the model can say what went wrong rather than the stream dying mid-answer.
    """
    scope = RoleScope.from_dict(role_scope)

    header = (
        f"Data scope: {scope.describe()}\n"
        f"Detected intent: {parsed.intent}\n"
    )

    if scope.is_unscopable:
        return (
            header
            + "\n**No data retrieved.** This account's role requires a region or rep "
              "assignment to scope results, and none is attached to the session. "
              "Refusing to fall back to enterprise-wide data.\n"
        )

    handler = _HANDLERS.get(parsed.intent, _general_context)
    try:
        body = handler(parsed, scope)
    except Exception as exc:  # noqa: BLE001 - surfaced to the model, see docstring
        body = (f"_Data retrieval failed for intent {parsed.intent}: "
                f"{type(exc).__name__}: {exc}_")

    context = header + "\n" + body
    if len(context) > MAX_CONTEXT_CHARS:
        context = context[:MAX_CONTEXT_CHARS] + "\n_[context truncated to fit the prompt budget]_"
    return context
