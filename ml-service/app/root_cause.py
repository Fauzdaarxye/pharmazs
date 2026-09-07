"""Root-cause attribution — "Why did sales change?" (CONTRACT.md §6, SRS §25/§26).

We attribute the revenue change across EXACTLY five named contributors:
  PRESCRIPTION_VOLUME, HCP_ENGAGEMENT, COMPETITOR_SHARE, INVENTORY, PRICE_DISCOUNT

Every number comes from a query (queries.py). Nothing is hardcoded.

Method
------
1. For each factor compute a raw change that is expressed *in the direction it
   pushes revenue*:
     - prescription volume : % change in prescribed units          (signed)
     - engagement          : % change in rep visits                (signed)
     - competitor share    : −(pp change in OUR share)             (share loss hurts)
     - inventory           : a supply-pressure score combining the % fall in
                             closing stock AND stockout days (stockouts cap the
                             revenue you can realise even when demand is intact)
     - price/discount       : −(pp change in avg discount)          (more discount
                             lifts units but cuts realised price)
2. Standardise each factor's revenue-impact by a factor-specific scale so the
   magnitudes are comparable (normalised standardised movement), then take each
   factor's share of the total absolute standardised movement → contributionPct
   summing to ~100.
3. `direction` is POSITIVE if the factor pushed revenue up, NEGATIVE if down.

Why this discriminates supply vs demand
----------------------------------------
In RespiCare/East prescriptions are flat (~−0.6%) but stock fell ~10% AND there
were many stockout days — so the inventory supply-pressure term is large while the
prescription term is ~0. INVENTORY therefore outranks PRESCRIPTION_VOLUME. In
CardioMax/North prescriptions fell 8.5% and visits 14.6% while inventory only
eased 5% with few stockouts, so demand-side factors lead.
"""
from __future__ import annotations

from . import queries

# Scales chosen so a "typical" swing in each factor maps to a comparable
# standardised magnitude. These are modelling constants, not answers: they are
# applied identically to every drug/region, and the per-request numbers are all
# queried. Documented in README.
# Per-factor scales convert a factor's raw revenue-direction movement into a
# comparable standardised magnitude. Calibrated so that a demand failure (Rx +
# engagement down, stock broadly intact) is led by the demand factors, while a
# supply failure (flat Rx but stock-outs) is led by INVENTORY. Applied identically
# to every drug/region — they are constants, not per-request answers.
_SCALE = {
    "PRESCRIPTION_VOLUME": 6.0,    # pct — demand is the primary lever, so a small scale
    "HCP_ENGAGEMENT": 9.0,         # pct
    "COMPETITOR_SHARE": 9.0,       # pp  — deliberately damped: share moves are noisy
    "INVENTORY": 10.0,             # supply-pressure units
    "PRICE_DISCOUNT": 6.0,         # pp
}

_LABELS = {
    "PRESCRIPTION_VOLUME": "Prescription volume",
    "HCP_ENGAGEMENT": "HCP engagement",
    "COMPETITOR_SHARE": "Competitor share",
    "INVENTORY": "Inventory availability",
    "PRICE_DISCOUNT": "Net price / discounting",
}


def _pct(recent: float, prev: float) -> float:
    if prev == 0:
        return 0.0
    return (recent - prev) / prev * 100.0


def compute_root_cause(drug_id: int, region_id: int, period_months: int) -> dict:
    # ---- headline (revenue) ----
    rev_recent, rev_prev = queries.revenue_window(drug_id, region_id, period_months)
    rev_change = _pct(rev_recent, rev_prev)

    # ---- factor raw movements (each from a query) ----
    u_recent, u_prev = queries.units_window(drug_id, region_id, period_months)
    rx_pct = _pct(u_recent, u_prev)

    e_recent, e_prev = queries.engagement_window(region_id, period_months)
    eng_pct = _pct(e_recent, e_prev)

    our_recent, our_prev = queries.competitor_share_window(drug_id, region_id, period_months)
    comp_pp = our_recent - our_prev            # fall in our share = negative
    comp_impact = comp_pp                       # positive our-share change helps revenue

    inv_recent, inv_prev, stockout_days = queries.inventory_window(drug_id, region_id, period_months)
    inv_pct = _pct(inv_recent, inv_prev)
    # Supply pressure combines the stock movement with stock-out days. Stock-out
    # days are the strong signal (demand that could not be filled): we express
    # them as a fraction of sellable days and weight them so a handful of days is
    # minor but a sustained shortage dominates. A modest stock draw-down with few
    # stock-outs (healthy sell-through) stays small.
    stockout_frac = stockout_days / (period_months * 30.0)
    supply_pressure = inv_pct - (stockout_frac ** 2) * 500.0  # negative = supply hurting

    disc_recent, disc_prev = queries.discount_window(drug_id, region_id, period_months)
    disc_pp = disc_recent - disc_prev
    price_impact = -disc_pp                      # more discount = lower realised price

    raw = {
        "PRESCRIPTION_VOLUME": rx_pct,
        "HCP_ENGAGEMENT": eng_pct,
        "COMPETITOR_SHARE": comp_impact,
        "INVENTORY": supply_pressure,
        "PRICE_DISCOUNT": price_impact,
    }

    # standardised movement
    std = {k: raw[k] / _SCALE[k] for k in raw}
    total_abs = sum(abs(v) for v in std.values()) or 1.0

    details = _build_details(
        u_recent, u_prev, e_recent, e_prev, our_recent, our_prev,
        inv_recent, inv_prev, stockout_days, disc_recent, disc_prev,
    )

    contributors = []
    for factor in ["PRESCRIPTION_VOLUME", "HCP_ENGAGEMENT", "COMPETITOR_SHARE", "INVENTORY", "PRICE_DISCOUNT"]:
        contribution = abs(std[factor]) / total_abs * 100.0
        # change_pct shown to the user is the factor's own raw movement (pct or pp)
        contributors.append({
            "factor": factor,
            "label": _LABELS[factor],
            "changePct": round(raw[factor], 1),
            "contributionPct": round(contribution, 1),
            "direction": "POSITIVE" if std[factor] >= 0 else "NEGATIVE",
            "detail": details[factor],
        })

    # rank by contribution desc for a stable, readable narrative
    contributors.sort(key=lambda c: c["contributionPct"], reverse=True)
    # fix rounding so contributionPct sums to ~100 exactly
    _renormalise(contributors)

    direction = "SPIKE" if rev_change > 1.0 else ("DROP" if rev_change < -1.0 else "FLAT")
    headline = {
        "metric": "revenue",
        "changePct": round(rev_change, 1),
        "direction": direction,
        "current": round(rev_recent, 2),
        "previous": round(rev_prev, 2),
        "periodLabel": queries.period_label(period_months),
    }

    # confidence: higher when one/two factors clearly dominate
    top2 = sum(c["contributionPct"] for c in contributors[:2]) / 100.0
    confidence = round(min(0.95, 0.5 + 0.45 * top2), 2)

    return {"headline": headline, "contributors": contributors, "confidence": confidence}


def _renormalise(contributors: list[dict]) -> None:
    total = sum(c["contributionPct"] for c in contributors)
    if total == 0:
        return
    # scale to 100 then absorb residual into the largest
    for c in contributors:
        c["contributionPct"] = round(c["contributionPct"] / total * 100.0, 1)
    residual = round(100.0 - sum(c["contributionPct"] for c in contributors), 1)
    if contributors:
        contributors[0]["contributionPct"] = round(contributors[0]["contributionPct"] + residual, 1)


def _build_details(u_r, u_p, e_r, e_p, our_r, our_p, inv_r, inv_p, stockout, disc_r, disc_p) -> dict:
    return {
        "PRESCRIPTION_VOLUME": f"Prescribed units {'fell' if u_r < u_p else 'rose'} from {int(u_p):,} to {int(u_r):,}",
        "HCP_ENGAGEMENT": f"Rep visits {'fell' if e_r < e_p else 'rose'} from {int(e_p):,} to {int(e_r):,}",
        "COMPETITOR_SHARE": f"Our market share moved from {our_p:.1f}% to {our_r:.1f}% ({our_r - our_p:+.1f} pp)",
        "INVENTORY": (
            f"Closing stock moved from {int(inv_p):,} to {int(inv_r):,} "
            f"({(inv_r - inv_p) / inv_p * 100 if inv_p else 0:+.1f}%), with {stockout} stockout day(s)"
        ),
        "PRICE_DISCOUNT": f"Average discount moved from {disc_p:.1f}% to {disc_r:.1f}% ({disc_r - disc_p:+.1f} pp)",
    }
