"""jobs.refresh_all — recompute analytics and PERSIST into hcp_scores, forecasts,
anomalies and alerts so dashboards can read precomputed values (task requirement).

Writes are idempotent per run: we clear the tables we own and re-insert. We never
touch transactional/fact data.
"""
from __future__ import annotations

import datetime as dt
import json
import time

from . import anomalies, db, forecasting, hcp_scoring, queries


def _now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _persist_hcp_scores() -> int:
    scored = hcp_scoring.score_all_frame()
    if scored.empty:
        return 0
    db.execute("DELETE FROM hcp_scores")
    rows = []
    now = _now()
    from .hcp_scoring import WEIGHTS  # noqa

    for _, r in scored.iterrows():
        reasons = hcp_scoring._reasons(r)
        rows.append((
            int(r["hcp_id"]), now,
            round(float(r["rxVolume"]), 2), round(float(r["rxGrowth"]), 2),
            round(float(r["engagement"]), 2), round(float(r["taRelevance"]), 2),
            round(float(r["competitorOpportunity"]), 2),
            round(float(r["totalScore"]), 2), r["priority"],
            json.dumps(reasons),
        ))
    db.executemany(
        "INSERT INTO hcp_scores (hcp_id, scored_at, rx_volume_score, rx_growth_score, "
        "engagement_score, ta_relevance_score, competitor_opportunity_score, total_score, "
        "priority, reasons_json) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", rows)
    return len(rows)


def _next_periods(n: int) -> list[str]:
    max_d = db.max_sale_date()
    y, m = int(max_d[:4]), int(max_d[5:7])
    idx = y * 12 + (m - 1)
    out = []
    for h in range(1, n + 1):
        yy, mm = divmod(idx + h, 12)
        out.append(f"{yy:04d}-{mm + 1:02d}-01")
    return out


def _persist_forecasts(horizon: int = 6) -> int:
    db.execute("DELETE FROM forecasts")
    now = _now()
    rows = []
    # COMPANY + each DRUG + each REGION + each TA
    targets: list[tuple[str, int | None]] = [("COMPANY", None)]
    for r in db.query_df("SELECT drug_id FROM drugs WHERE is_active=1").to_dict("records"):
        targets.append(("DRUG", int(r["drug_id"])))
    for r in db.query_df("SELECT region_id FROM regions").to_dict("records"):
        targets.append(("REGION", int(r["region_id"])))
    for r in db.query_df("SELECT ta_id FROM therapeutic_areas").to_dict("records"):
        targets.append(("TA", int(r["ta_id"])))

    periods = _next_periods(horizon)
    for etype, eid in targets:
        hist = queries.monthly_revenue_series(etype, eid)
        if hist.empty or len(hist) < 6:
            continue
        fc, model, mape, resid_std = forecasting.forecast_series(hist["value"].tolist(), horizon)
        import numpy as np
        for h, period in enumerate(periods, start=1):
            pred = float(fc[h - 1])
            band = 1.96 * resid_std * (h ** 0.5)
            rows.append((
                etype, eid, period, round(pred, 2),
                round(pred - band, 2), round(pred + band, 2),
                model, None if mape != mape else round(mape, 2), now,
            ))
    if rows:
        db.executemany(
            "INSERT INTO forecasts (entity_type, entity_id, period_month, predicted_revenue, "
            "lower_bound, upper_bound, model_name, mape, generated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)", rows)
    return len(rows)


def _persist_anomalies() -> int:
    db.execute("DELETE FROM anomalies")
    now = _now()
    anoms = anomalies.detect_anomalies(metric="revenue")
    if not anoms:
        return 0
    rows = [(
        a["entityType"], a["entityId"], a["periodMonth"], a["metric"],
        a["actual"], a["expected"], a["deviationPct"], a["zScore"],
        a["severity"], a["direction"], now,
    ) for a in anoms]
    db.executemany(
        "INSERT INTO anomalies (entity_type, entity_id, period_month, metric, actual_value, "
        "expected_value, deviation_pct, z_score, severity, direction, detected_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", rows)
    return len(rows)


def _persist_alerts() -> int:
    """Derive business alerts from the anomalies we just detected + stockout risk."""
    db.execute("DELETE FROM alerts")
    now = _now()
    rows = []
    anoms = anomalies.detect_anomalies(metric="revenue")
    for a in anoms[:30]:
        atype = "REVENUE_SPIKE" if a["direction"] == "SPIKE" else "REVENUE_DROP"
        verb = "surged" if a["direction"] == "SPIKE" else "dropped"
        rows.append((
            atype, a["severity"],
            f"{a['entityName']} revenue {verb} {abs(a['deviationPct']):.0f}%",
            f"{a['periodMonth'][:7]}: actual ₹{a['actual']:,.0f} vs expected ₹{a['expected']:,.0f} "
            f"(robust z={a['zScore']:.1f}).",
            "DRUG", a["entityId"], "ALL", now,
        ))
    # stockout alerts
    inv = db.query_df(
        "SELECT d.drug_id, d.drug_name, r.region_name, SUM(i.stockout_days) sd "
        "FROM inventory_snapshots i JOIN drugs d ON d.drug_id=i.drug_id "
        "JOIN regions r ON r.region_id=i.region_id "
        "WHERE i.snapshot_month >= DATE_SUB((SELECT MAX(snapshot_month) FROM inventory_snapshots), INTERVAL 2 MONTH) "
        "GROUP BY d.drug_id, d.drug_name, r.region_name HAVING sd > 5 ORDER BY sd DESC LIMIT 20")
    for r in inv.to_dict("records"):
        rows.append((
            "STOCKOUT_RISK", "HIGH",
            f"Stockout risk: {r['drug_name']} in {r['region_name']}",
            f"{int(r['sd'])} stockout day(s) in the last two months — supply is capping realisable revenue.",
            "DRUG", int(r["drug_id"]), "ALL", now,
        ))
    if rows:
        db.executemany(
            "INSERT INTO alerts (alert_type, severity, title, message, entity_type, entity_id, "
            "audience_role, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)", rows)
    return len(rows)


def refresh_all() -> dict:
    t0 = time.time()
    db.max_sale_date(refresh=True)
    persisted = {
        "hcp_scores": _persist_hcp_scores(),
        "forecasts": _persist_forecasts(),
        "anomalies": _persist_anomalies(),
        "alerts": _persist_alerts(),
    }
    return {"ok": True, "persisted": persisted, "tookMs": int((time.time() - t0) * 1000)}
