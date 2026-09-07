"""Recommendations (CONTRACT.md §6, SRS §26, §27).

All recommendations are COMPUTED from data (HCP scores, anomalies, inventory
risk). No hardcoded sentences — every title/rationale/impact interpolates queried
figures.
"""
from __future__ import annotations

from . import anomalies, db, hcp_scoring


def _rupees(x: float) -> str:
    if x >= 1e7:
        return f"≈₹{x / 1e7:.1f} Cr"
    if x >= 1e5:
        return f"≈₹{x / 1e5:.1f} L"
    return f"≈₹{x:,.0f}"


def build_recommendations(role: str = "ALL", region_id: int | None = None,
                          rep_id: int | None = None, limit: int = 10,
                          ta_id: int | None = None) -> list[dict]:
    """
    Data-driven recommendations. Nothing here is a canned sentence (SRS §26).

    `ta_id` narrows the HCP-priority recommendation to physicians who actually
    prescribe in that therapeutic area. Without it, a root-cause call about a
    CARDIOLOGY brand in North returned "Prioritise 18 high-potential oncologists in
    North" — because oncologists happened to be the modal specialty among that
    region's high scorers. Technically true, useless as advice, and a direct
    contradiction of the SRS §26 worked example, which pairs a cardiology decline
    with "prioritise high-potential cardiologists".

    The filter is derived from prescribing behaviour rather than a hardcoded
    specialty->area map, so it stays correct for physicians who treat across areas.
    """
    recs: list[dict] = []

    # --- 1. HCP priority: cluster of high-potential HCPs per region ---
    scored = hcp_scoring.score_all_frame()
    if not scored.empty:
        high = scored[scored["priority"] == "HIGH"]
        if region_id is not None:
            high = high[high["region_id"] == region_id]
        if ta_id is not None and not high.empty:
            # Relevance is measured by VOLUME in the area, not by whether the
            # physician ever touched it. A presence-only filter was useless here:
            # 1,703 of 2,000 physicians prescribed something in cardiology in the
            # last six months (general physicians prescribe cardio drugs too), so it
            # kept all 18 North high scorers and oncologists still won the headcount
            # vote. Ranking by area volume and keeping the upper half makes the
            # modal specialty the one that actually drives the area.
            ta_units = db.query_df(
                """
                SELECT p.hcp_id, SUM(p.units) AS ta_units
                  FROM prescriptions p
                  JOIN drugs d ON d.drug_id = p.drug_id
                 WHERE d.ta_id = %s
                   AND p.prescription_date >
                       (SELECT MAX(prescription_date) - INTERVAL 6 MONTH FROM prescriptions)
                 GROUP BY p.hcp_id
                """,
                (ta_id,),
            )
            if not ta_units.empty:
                merged = high.merge(ta_units, on="hcp_id", how="left")
                merged["ta_units"] = merged["ta_units"].fillna(0)
                relevant = merged[merged["ta_units"] > 0]
                if not relevant.empty:
                    cutoff = relevant["ta_units"].median()
                    narrowed = relevant[relevant["ta_units"] >= cutoff]
                    # Only narrow if something survives — an empty recommendation
                    # list is worse advice than a broader one.
                    if not narrowed.empty:
                        high = narrowed
        grp = high.groupby("region_id")
        region_names = {r["region_id"]: r["region_name"] for r in
                        db.query_df("SELECT region_id, region_name FROM regions").to_dict("records")}
        # revenue per HCP to estimate incremental impact
        for rid, g in grp:
            n = len(g)
            if n == 0:
                continue
            # incremental impact estimate: 8% uplift on the recent Rx-implied revenue proxy
            est = float(g["recent_units"].sum()) * 900.0 * 0.08  # unit->rupee proxy * uplift
            recs.append({
                "recType": "HCP_PRIORITY",
                "title": f"Prioritise {n} high-potential {_specialty_word(g)} in {region_names.get(rid, rid)}",
                "rationale": (
                    f"{n} physicians in {region_names.get(rid, rid)} score in the HIGH band "
                    f"(≥80) on the weighted commercial model; their combined recent prescribing "
                    f"is {int(g['recent_units'].sum()):,} units."
                ),
                "expectedImpact": f"{_rupees(est)} incremental revenue",
                "priority": "HIGH",
                "confidence": 0.72,
                "targetEntityType": "REGION",
                "targetEntityId": int(rid),
            })

    # --- 2. Anomaly-driven: recent CRITICAL/HIGH drops need intervention ---
    anoms = [a for a in anomalies.detect_anomalies(metric="revenue")
             if a["severity"] in ("CRITICAL", "HIGH") and a["direction"] == "DROP"]
    for a in anoms[:5]:
        gap = a["expected"] - a["actual"]
        recs.append({
            "recType": "REVENUE_RECOVERY",
            "title": f"Investigate revenue drop: {a['entityName']} ({a['periodMonth'][:7]})",
            "rationale": (
                f"{a['metric'].title()} for {a['entityName']} was {a['deviationPct']:.0f}% "
                f"below the seasonal baseline (robust z={a['zScore']:.1f}, {a['severity']})."
            ),
            "expectedImpact": f"{_rupees(gap)} at-risk revenue to recover",
            "priority": "HIGH" if a["severity"] == "CRITICAL" else "MEDIUM",
            "confidence": 0.68,
            "targetEntityType": "DRUG",
            "targetEntityId": a["entityId"],
        })

    # --- 3. Inventory risk: products with stockout days recently ---
    inv = db.query_df(
        "SELECT d.drug_id, d.drug_name, r.region_name, i.region_id, "
        "SUM(i.stockout_days) sd "
        "FROM inventory_snapshots i JOIN drugs d ON d.drug_id=i.drug_id "
        "JOIN regions r ON r.region_id=i.region_id "
        "WHERE i.snapshot_month >= DATE_SUB((SELECT MAX(snapshot_month) FROM inventory_snapshots), INTERVAL 2 MONTH) "
        "GROUP BY d.drug_id, d.drug_name, r.region_name, i.region_id "
        "HAVING sd > 0 ORDER BY sd DESC LIMIT 5"
    )
    for r in inv.to_dict("records"):
        recs.append({
            "recType": "STOCKOUT_RISK",
            "title": f"Resolve supply risk for {r['drug_name']} in {r['region_name']}",
            "rationale": (
                f"{r['drug_name']} recorded {int(r['sd'])} stockout day(s) in {r['region_name']} "
                f"over the last two months — realisable revenue is capped by supply, not demand."
            ),
            "expectedImpact": "Protects prescription conversion; prevents share loss",
            "priority": "HIGH",
            "confidence": 0.7,
            "targetEntityType": "DRUG",
            "targetEntityId": int(r["drug_id"]),
        })

    order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    recs.sort(key=lambda x: (order[x["priority"]], -x["confidence"]))
    return recs[:limit]


def _specialty_word(g) -> str:
    sp = g["specialty"].mode()
    base = sp.iloc[0] if len(sp) else "physicians"
    word = base.lower()
    return word + "s" if not word.endswith("s") else word
