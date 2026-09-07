"""Anomaly detection (CONTRACT.md §6, SRS §24).

Method
------
1. Deseasonalise each (drug, region) monthly series against a robust seasonal
   baseline: the MEDIAN of the same calendar month across years. Median (not mean)
   keeps a single freak month from distorting the baseline.
2. Score each point with a robust z-score (0.6745 * (x - median) / MAD) on BOTH:
     - the additive residual  (value − baseline)      → catches absolute shocks
     - the multiplicative ratio (value / baseline)     → catches relative shocks
   and take the stronger of the two. A point is anomalous if it is extreme on
   either scale, which is what makes a small-but-proportionally-large swing in a
   noisy series (RespiCare/East) surface alongside a large absolute one.
3. Severity from |z|: >= 3.5 CRITICAL, >= 2.5 HIGH, >= 2.0 MEDIUM (else not an
   anomaly). Direction: SPIKE above baseline, DROP below.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import db

THRESHOLDS = [(3.5, "CRITICAL"), (2.5, "HIGH"), (2.0, "MEDIUM")]


def _severity(z: float) -> str | None:
    az = abs(z)
    for t, label in THRESHOLDS:
        if az >= t:
            return label
    return None


def _robust_z(values: np.ndarray) -> np.ndarray:
    med = np.median(values)
    mad = np.median(np.abs(values - med))
    if mad == 0:
        std = np.std(values)
        if std == 0:
            return np.zeros_like(values)
        return (values - values.mean()) / std
    return 0.6745 * (values - med) / mad


def _seasonal_baseline(values: np.ndarray, months: np.ndarray) -> np.ndarray:
    """Median of the same calendar month across the history."""
    return np.array([np.median(values[months == m]) for m in months], dtype=float)


def _drug_region_monthly(metric: str) -> pd.DataFrame:
    col = "SUM(revenue)" if metric == "revenue" else "SUM(units_sold)"
    sql = (
        f"SELECT s.drug_id, s.region_id, DATE_FORMAT(s.sale_date,'%%Y-%%m-01') period, "
        f"{col} value FROM sales s GROUP BY s.drug_id, s.region_id, period ORDER BY period"
    )
    df = db.query_df(sql)
    df["value"] = pd.to_numeric(df["value"], errors="coerce").fillna(0.0)
    return df


def _level_shift(vals: np.ndarray, periods: list, k: int) -> tuple[float, float, float, float] | None:
    """
    Detect a SUSTAINED level shift: the mean of the last `k` months against the mean
    of the `k` months before it, scored against how volatile that comparison has
    been historically for this series.

    A point detector cannot see this shape, which is exactly the shape a business
    cares about ("revenue is down 27% this quarter"). Worse, a same-calendar-month
    baseline is *contaminated* by a sustained shift — the shifted months become part
    of their own expectation — so a real quarter-long decline can score |z| < 1.
    Measured on the seeded data, RespiCare/East fell 26.9% over two months while no
    individual month exceeded |z| = 0.83, and the drop went unreported.

    Returns (recent_mean, prior_mean, change_pct, z) or None when there is not
    enough history to judge.
    """
    n = len(vals)
    if n < 4 * k:
        return None
    # Distribution of every historical k-vs-k relative change, so the threshold is
    # calibrated to this series' own volatility rather than a global constant.
    changes: list[float] = []
    for end in range(2 * k, n + 1):
        prior = vals[end - 2 * k: end - k].mean()
        recent = vals[end - k: end].mean()
        if prior > 0:
            changes.append((recent - prior) / prior)
    if len(changes) < 4:
        return None
    arr = np.asarray(changes[:-1], dtype=float)      # exclude the window being tested
    current = changes[-1]
    med = float(np.median(arr))
    mad = float(np.median(np.abs(arr - med)))
    scale = mad * 1.4826 if mad > 0 else (float(arr.std()) or 1e-9)
    z = (current - med) / scale
    prior_mean = float(vals[n - 2 * k: n - k].mean())
    recent_mean = float(vals[n - k: n].mean())
    return recent_mean, prior_mean, current * 100.0, z


def detect_anomalies(entity_type: str = "DRUG", metric: str = "revenue",
                     lookback_months: int = 24) -> list[dict]:
    monthly = _drug_region_monthly(metric)
    if monthly.empty:
        return []

    drug_names = {r["drug_id"]: r["drug_name"] for r in db.query_df(
        "SELECT drug_id, drug_name FROM drugs").to_dict("records")}
    region_names = {r["region_id"]: r["region_name"] for r in db.query_df(
        "SELECT region_id, region_name FROM regions").to_dict("records")}

    results = []
    for (drug_id, region_id), g in monthly.groupby(["drug_id", "region_id"]):
        g = g.sort_values("period")
        if lookback_months:
            g = g.tail(lookback_months)
        if len(g) < 6:
            continue
        vals = g["value"].to_numpy(dtype=float)
        months = pd.to_datetime(g["period"]).dt.month.to_numpy()
        base = _seasonal_baseline(vals, months)

        z_add = _robust_z(vals - base)
        # multiplicative ratio (guard divide-by-zero)
        safe_base = np.where(base == 0, np.nan, base)
        ratio = np.where(np.isnan(safe_base), 1.0, vals / safe_base)
        z_mul = _robust_z(ratio)

        for i in range(len(g)):
            # stronger of the two scales, keeping the sign of the residual
            z = z_add[i] if abs(z_add[i]) >= abs(z_mul[i]) else z_mul[i]
            sev = _severity(z)
            if sev is None:
                continue
            actual = float(vals[i])
            expected = float(base[i])
            dev = (actual - expected) / expected * 100.0 if expected else 0.0
            results.append({
                "entityType": "DRUG",
                "entityId": int(drug_id),
                "entityName": f"{drug_names.get(drug_id, drug_id)} — {region_names.get(region_id, region_id)}",
                "periodMonth": str(g.iloc[i]["period"])[:10],
                "metric": metric,
                "actual": round(actual, 2),
                "expected": round(expected, 2),
                "deviationPct": round(dev, 1),
                "zScore": round(float(z), 3),
                "severity": sev,
                "direction": "SPIKE" if z > 0 else "DROP",
            })

        # --- sustained level shifts over the most recent 2- and 3-month windows ---
        # Reported alongside point anomalies because they are a different phenomenon:
        # a point anomaly is "this month was odd", a level shift is "the run rate
        # moved". Both belong on an anomalies page; only the second one catches a
        # quarter-long slide.
        label = f"{drug_names.get(drug_id, drug_id)} — {region_names.get(region_id, region_id)}"
        for k in (2, 3):
            shift = _level_shift(vals, g["period"].tolist(), k)
            if shift is None:
                continue
            recent_mean, prior_mean, change_pct, zs = shift
            sev = _severity(zs)
            if sev is None or abs(change_pct) < 10.0:
                continue          # ignore statistically odd but commercially trivial moves
            results.append({
                "entityType": "DRUG",
                "entityId": int(drug_id),
                "entityName": label,
                "periodMonth": str(g.iloc[-1]["period"])[:10],
                "metric": f"{metric}_{k}m_level",
                "actual": round(recent_mean, 2),
                "expected": round(prior_mean, 2),
                "deviationPct": round(change_pct, 1),
                "zScore": round(float(zs), 3),
                "severity": sev,
                "direction": "SPIKE" if change_pct > 0 else "DROP",
            })

    order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    results.sort(key=lambda a: (order[a["severity"]], -_period_key(a["periodMonth"])))
    return results


def _period_key(p: str) -> int:
    return int(p[:4]) * 12 + int(p[5:7])
