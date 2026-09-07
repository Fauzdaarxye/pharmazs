"""All SQL lives here, always parameterised (CONTRACT.md §8).

Dates are derived from MAX(sale_date); we never hardcode 'now'.
"""
from __future__ import annotations

import pandas as pd

from . import db


def monthly_revenue_series(entity_type: str, entity_id: int | None) -> pd.DataFrame:
    """Monthly revenue for COMPANY / DRUG / REGION / TA. Returns period(str), value."""
    base = (
        "SELECT DATE_FORMAT(s.sale_date,'%%Y-%%m') AS period, "
        "ROUND(SUM(s.revenue),2) AS value "
        "FROM sales s "
    )
    if entity_type == "COMPANY":
        sql = base + "GROUP BY period ORDER BY period"
        params: tuple = ()
    elif entity_type == "DRUG":
        sql = base + "WHERE s.drug_id=%s GROUP BY period ORDER BY period"
        params = (entity_id,)
    elif entity_type == "REGION":
        sql = base + "WHERE s.region_id=%s GROUP BY period ORDER BY period"
        params = (entity_id,)
    elif entity_type == "TA":
        sql = (
            "SELECT DATE_FORMAT(s.sale_date,'%%Y-%%m') AS period, "
            "ROUND(SUM(s.revenue),2) AS value "
            "FROM sales s JOIN drugs d ON d.drug_id=s.drug_id "
            "WHERE d.ta_id=%s GROUP BY period ORDER BY period"
        )
        params = (entity_id,)
    else:
        raise ValueError(f"bad entity_type {entity_type}")
    df = db.query_df(sql, params)
    if not df.empty:
        df["value"] = df["value"].astype(float)
    return df


def monthly_units_series(entity_type: str, entity_id: int | None) -> pd.DataFrame:
    col = "SUM(s.units_sold)"
    if entity_type == "COMPANY":
        sql = f"SELECT DATE_FORMAT(s.sale_date,'%%Y-%%m') period, {col} value FROM sales s GROUP BY period ORDER BY period"
        params: tuple = ()
    elif entity_type == "DRUG":
        sql = f"SELECT DATE_FORMAT(s.sale_date,'%%Y-%%m') period, {col} value FROM sales s WHERE s.drug_id=%s GROUP BY period ORDER BY period"
        params = (entity_id,)
    elif entity_type == "REGION":
        sql = f"SELECT DATE_FORMAT(s.sale_date,'%%Y-%%m') period, {col} value FROM sales s WHERE s.region_id=%s GROUP BY period ORDER BY period"
        params = (entity_id,)
    elif entity_type == "TA":
        sql = (
            f"SELECT DATE_FORMAT(s.sale_date,'%%Y-%%m') period, {col} value "
            "FROM sales s JOIN drugs d ON d.drug_id=s.drug_id WHERE d.ta_id=%s GROUP BY period ORDER BY period"
        )
        params = (entity_id,)
    else:
        raise ValueError(entity_type)
    df = db.query_df(sql, params)
    if not df.empty:
        df["value"] = df["value"].astype(float)
    return df


# ---------- Root-cause window aggregates ---------------------------------
def _window_bounds(period_months: int) -> tuple[str, str, str]:
    """Return (recent_start, split, prev_start) as YYYY-MM-01 strings.

    'now' = the month AFTER max(sale_date). recent window = last `period_months`
    full months; previous window = the `period_months` before that.
    """
    max_d = db.max_sale_date()  # e.g. 2026-08-31
    y, m = int(max_d[:4]), int(max_d[5:7])
    # month index of the last full month
    idx = y * 12 + (m - 1)  # zero-based month index

    def to_date(i: int) -> str:
        yy, mm = divmod(i, 12)
        return f"{yy:04d}-{mm + 1:02d}-01"

    split = to_date(idx - period_months + 1)      # first month of recent window
    recent_end_next = to_date(idx + 1)            # exclusive upper bound
    prev_start = to_date(idx - 2 * period_months + 1)
    return split, recent_end_next, prev_start


def revenue_window(drug_id: int, region_id: int, period_months: int) -> tuple[float, float]:
    split, upper, prev_start = _window_bounds(period_months)
    row = db.query_one(
        "SELECT "
        "COALESCE(SUM(CASE WHEN sale_date>=%s AND sale_date<%s THEN revenue END),0) recent, "
        "COALESCE(SUM(CASE WHEN sale_date>=%s AND sale_date<%s THEN revenue END),0) prev "
        "FROM sales WHERE drug_id=%s AND region_id=%s",
        (split, upper, prev_start, split, drug_id, region_id),
    )
    return float(row["recent"]), float(row["prev"])


def units_window(drug_id: int, region_id: int, period_months: int) -> tuple[float, float]:
    split, upper, prev_start = _window_bounds(period_months)
    row = db.query_one(
        "SELECT "
        "COALESCE(SUM(CASE WHEN prescription_date>=%s AND prescription_date<%s THEN units END),0) recent, "
        "COALESCE(SUM(CASE WHEN prescription_date>=%s AND prescription_date<%s THEN units END),0) prev "
        "FROM prescriptions WHERE drug_id=%s AND region_id=%s",
        (split, upper, prev_start, split, drug_id, region_id),
    )
    return float(row["recent"]), float(row["prev"])


def engagement_window(region_id: int, period_months: int) -> tuple[float, float]:
    """Rep visit count to HCPs in the region — the engagement signal."""
    split, upper, prev_start = _window_bounds(period_months)
    row = db.query_one(
        "SELECT "
        "COALESCE(SUM(CASE WHEN v.visit_date>=%s AND v.visit_date<%s THEN 1 END),0) recent, "
        "COALESCE(SUM(CASE WHEN v.visit_date>=%s AND v.visit_date<%s THEN 1 END),0) prev "
        "FROM visits v JOIN hcps h ON h.hcp_id=v.hcp_id WHERE h.region_id=%s",
        (split, upper, prev_start, split, region_id),
    )
    return float(row["recent"]), float(row["prev"])


def inventory_window(drug_id: int, region_id: int, period_months: int) -> tuple[float, float, int]:
    """Closing stock recent vs prev, plus stockout days in the recent window."""
    split, upper, prev_start = _window_bounds(period_months)
    row = db.query_one(
        "SELECT "
        "COALESCE(SUM(CASE WHEN snapshot_month>=%s AND snapshot_month<%s THEN closing_stock END),0) recent, "
        "COALESCE(SUM(CASE WHEN snapshot_month>=%s AND snapshot_month<%s THEN closing_stock END),0) prev, "
        "COALESCE(SUM(CASE WHEN snapshot_month>=%s AND snapshot_month<%s THEN stockout_days END),0) stockout "
        "FROM inventory_snapshots WHERE drug_id=%s AND region_id=%s",
        (split, upper, prev_start, split, split, upper, drug_id, region_id),
    )
    return float(row["recent"]), float(row["prev"]), int(row["stockout"])


def competitor_share_window(drug_id: int, region_id: int, period_months: int) -> tuple[float, float]:
    """Average OUR share in recent vs prev window. A fall in our share = a rise in
    competitor share (in percentage points)."""
    split, upper, prev_start = _window_bounds(period_months)
    row = db.query_one(
        "SELECT "
        "AVG(CASE WHEN period_month>=%s AND period_month<%s THEN our_share_pct END) recent_ours, "
        "AVG(CASE WHEN period_month>=%s AND period_month<%s THEN our_share_pct END) prev_ours "
        "FROM market_share WHERE drug_id=%s AND region_id=%s",
        (split, upper, prev_start, split, drug_id, region_id),
    )
    recent = float(row["recent_ours"]) if row["recent_ours"] is not None else 0.0
    prev = float(row["prev_ours"]) if row["prev_ours"] is not None else 0.0
    return recent, prev


def discount_window(drug_id: int, region_id: int, period_months: int) -> tuple[float, float]:
    """Volume-weighted average discount pct, recent vs prev."""
    split, upper, prev_start = _window_bounds(period_months)
    row = db.query_one(
        "SELECT "
        "SUM(CASE WHEN sale_date>=%s AND sale_date<%s THEN discount_pct*units_sold END)/"
        "NULLIF(SUM(CASE WHEN sale_date>=%s AND sale_date<%s THEN units_sold END),0) recent, "
        "SUM(CASE WHEN sale_date>=%s AND sale_date<%s THEN discount_pct*units_sold END)/"
        "NULLIF(SUM(CASE WHEN sale_date>=%s AND sale_date<%s THEN units_sold END),0) prev "
        "FROM sales WHERE drug_id=%s AND region_id=%s",
        (split, upper, split, upper, prev_start, split, prev_start, split, drug_id, region_id),
    )
    recent = float(row["recent"]) if row["recent"] is not None else 0.0
    prev = float(row["prev"]) if row["prev"] is not None else 0.0
    return recent, prev


def period_label(period_months: int) -> str:
    split, upper, prev_start = _window_bounds(period_months)
    import datetime as dt

    def fmt(d: str) -> str:
        return dt.date.fromisoformat(d).strftime("%b %Y")

    def month_before(d: str) -> str:
        y, m = int(d[:4]), int(d[5:7])
        i = y * 12 + (m - 1) - 1
        yy, mm = divmod(i, 12)
        return f"{yy:04d}-{mm + 1:02d}-01"

    recent_last = month_before(upper)
    prev_last = month_before(split)
    if period_months == 1:
        return f"{fmt(split)} vs {fmt(prev_start)}"
    return f"{fmt(split)}–{fmt(recent_last)} vs {fmt(prev_start)}–{fmt(prev_last)}"


def drug_region_name(drug_id: int, region_id: int) -> tuple[str, str]:
    d = db.query_one("SELECT drug_name FROM drugs WHERE drug_id=%s", (drug_id,))
    r = db.query_one("SELECT region_name FROM regions WHERE region_id=%s", (region_id,))
    return (d["drug_name"] if d else str(drug_id), r["region_name"] if r else str(region_id))


def entity_name(entity_type: str, entity_id: int | None) -> str:
    if entity_type == "COMPANY" or entity_id is None:
        return "Company (all products)"
    if entity_type == "DRUG":
        r = db.query_one("SELECT drug_name AS n FROM drugs WHERE drug_id=%s", (entity_id,))
    elif entity_type == "REGION":
        r = db.query_one("SELECT region_name AS n FROM regions WHERE region_id=%s", (entity_id,))
    elif entity_type == "TA":
        r = db.query_one("SELECT ta_name AS n FROM therapeutic_areas WHERE ta_id=%s", (entity_id,))
    else:
        r = None
    return r["n"] if r else str(entity_id)
