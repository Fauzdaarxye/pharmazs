"""HCP scoring (CONTRACT.md §6, SRS §13).

Weights are MANDATED and must sum to 1.0:
  Rx volume 40, Rx growth 25, engagement 15, TA relevance 10, competitor opp 10.

Each component is a 0-100 percentile within the comparable cohort (same specialty),
so the total is a COMMERCIAL PRIORITISATION, not a medical judgement — the payload
says so explicitly.

Bands: 80-100 HIGH, 50-79 MEDIUM, 0-49 LOW.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import db

WEIGHTS = {
    "rxVolume": 0.40,
    "rxGrowth": 0.25,
    "engagement": 0.15,
    "taRelevance": 0.10,
    "competitorOpportunity": 0.10,
}

DISCLAIMER = (
    "This is a COMMERCIAL prioritisation score for sales targeting, computed as a "
    "percentile ranking within the physician's specialty cohort. It is NOT a medical "
    "or clinical judgement about the physician or their patients."
)


def band(total: float) -> str:
    if total >= 80:
        return "HIGH"
    if total >= 50:
        return "MEDIUM"
    return "LOW"


def _percentile_rank(series: pd.Series) -> pd.Series:
    """0-100 percentile within the series. rank(pct) handles ties; scaled x100."""
    if series.nunique() <= 1:
        return pd.Series(50.0, index=series.index)  # no signal in cohort -> neutral
    return series.rank(pct=True) * 100.0


def _load_hcp_features() -> pd.DataFrame:
    """One row per HCP with the raw drivers behind each component.

    Windows derive from MAX(sale_date): 'recent' = last 3 months, 'prev' = the 3
    before. 'now' = month after max date.
    """
    max_d = db.max_sale_date()
    y, m = int(max_d[:4]), int(max_d[5:7])
    idx = y * 12 + (m - 1)

    def to_date(i: int) -> str:
        yy, mm = divmod(i, 12)
        return f"{yy:04d}-{mm + 1:02d}-01"

    recent_start = to_date(idx - 2)      # last 3 full months
    upper = to_date(idx + 1)
    prev_start = to_date(idx - 5)

    sql = """
    SELECT
      h.hcp_id, h.full_name, h.specialty, h.region_id, h.monthly_patient_volume,
      COALESCE(rx.recent_units,0)  AS recent_units,
      COALESCE(rx.prev_units,0)    AS prev_units,
      COALESCE(vs.recent_visits,0) AS recent_visits,
      COALESCE(cs.our_share,NULL)  AS our_share
    FROM hcps h
    LEFT JOIN (
      SELECT hcp_id,
        SUM(CASE WHEN prescription_date>=%s AND prescription_date<%s THEN units END) recent_units,
        SUM(CASE WHEN prescription_date>=%s AND prescription_date<%s THEN units END) prev_units
      FROM prescriptions GROUP BY hcp_id
    ) rx ON rx.hcp_id=h.hcp_id
    LEFT JOIN (
      SELECT hcp_id, COUNT(*) recent_visits
      FROM visits WHERE visit_date>=%s AND visit_date<%s GROUP BY hcp_id
    ) vs ON vs.hcp_id=h.hcp_id
    LEFT JOIN (
      SELECT ms.region_id, AVG(ms.our_share_pct) our_share
      FROM market_share ms GROUP BY ms.region_id
    ) cs ON cs.region_id=h.region_id
    WHERE h.is_active=1
    """
    params = (recent_start, upper, prev_start, recent_start, recent_start, upper)
    df = db.query_df(sql, params)
    if df.empty:
        return df

    for c in ["recent_units", "prev_units", "recent_visits", "monthly_patient_volume"]:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)
    df["our_share"] = pd.to_numeric(df["our_share"], errors="coerce").fillna(0.0)

    # Rx growth %: recent vs prev (guard divide-by-zero)
    df["rx_growth"] = np.where(
        df["prev_units"] > 0,
        (df["recent_units"] - df["prev_units"]) / df["prev_units"] * 100.0,
        np.where(df["recent_units"] > 0, 100.0, 0.0),
    )
    # Competitor opportunity: lower OUR share in the region = more headroom to win.
    df["competitor_gap"] = 100.0 - df["our_share"]
    return df


def _score_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Compute component percentiles WITHIN specialty cohort, then the weighted total."""
    out = df.copy()

    def by_cohort(col: str) -> pd.Series:
        return out.groupby("specialty")[col].transform(_percentile_rank)

    out["rxVolume"] = by_cohort("recent_units")
    out["rxGrowth"] = by_cohort("rx_growth")
    out["engagement"] = by_cohort("recent_visits")
    # TA relevance: patient volume is the proxy for how central this specialty's
    # therapeutic area is to the physician's practice.
    out["taRelevance"] = by_cohort("monthly_patient_volume")
    out["competitorOpportunity"] = by_cohort("competitor_gap")

    out["totalScore"] = (
        out["rxVolume"] * WEIGHTS["rxVolume"]
        + out["rxGrowth"] * WEIGHTS["rxGrowth"]
        + out["engagement"] * WEIGHTS["engagement"]
        + out["taRelevance"] * WEIGHTS["taRelevance"]
        + out["competitorOpportunity"] * WEIGHTS["competitorOpportunity"]
    )
    out["priority"] = out["totalScore"].apply(band)
    return out


def _reasons(row) -> list[str]:
    r = []
    comp = {
        "prescription volume": row["rxVolume"],
        "prescription growth": row["rxGrowth"],
        "rep engagement": row["engagement"],
        "therapeutic-area relevance": row["taRelevance"],
        "competitive headroom": row["competitorOpportunity"],
    }
    top = sorted(comp.items(), key=lambda kv: kv[1], reverse=True)[:2]
    for name, pct in top:
        r.append(f"Top-tier {name} for this specialty ({pct:.0f}th percentile)")
    if row["rx_growth"] >= 10:
        r.append(f"Prescriptions up {row['rx_growth']:.0f}% vs the prior quarter")
    elif row["rx_growth"] <= -10:
        r.append(f"Prescriptions down {abs(row['rx_growth']):.0f}% — retention risk")
    if row["competitorOpportunity"] >= 70:
        r.append("Large competitor-held share to convert in this region")
    if row["recent_visits"] == 0:
        r.append("No rep visit in the last quarter — engagement gap")
    return r[:4]


def score_hcps(hcp_ids: list[int] | None = None, region_id: int | None = None,
               limit: int | None = None) -> list[dict]:
    """Score the requested HCPs. Percentiles are ALWAYS computed against the full
    active cohort (so ranking is stable); filtering is applied afterwards."""
    df = _load_hcp_features()
    if df.empty:
        return []
    scored = _score_frame(df)

    sel = scored
    if hcp_ids:
        sel = sel[sel["hcp_id"].isin(hcp_ids)]
    if region_id is not None:
        sel = sel[sel["region_id"] == region_id]
    sel = sel.sort_values("totalScore", ascending=False)
    if limit:
        sel = sel.head(limit)

    results = []
    for _, row in sel.iterrows():
        results.append({
            "hcpId": int(row["hcp_id"]),
            "hcpName": row["full_name"],
            "totalScore": round(float(row["totalScore"]), 1),
            "priority": row["priority"],
            "components": {
                "rxVolume": round(float(row["rxVolume"]), 1),
                "rxGrowth": round(float(row["rxGrowth"]), 1),
                "engagement": round(float(row["engagement"]), 1),
                "taRelevance": round(float(row["taRelevance"]), 1),
                "competitorOpportunity": round(float(row["competitorOpportunity"]), 1),
            },
            "weights": WEIGHTS,
            "reasons": _reasons(row),
            "disclaimer": DISCLAIMER,
        })
    return results


def score_all_frame() -> pd.DataFrame:
    """Full scored frame, for the persistence job."""
    df = _load_hcp_features()
    if df.empty:
        return df
    return _score_frame(df)
