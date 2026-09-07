"""pytest suite for the PharmaIQ ML service.

Covers the modelling contract (weights, bands, anomaly thresholds,
contributionPct sum, forecast horizon) AND the three ground-truth narratives
from docs/GROUND_TRUTH.md, which prove the analytics are real, not decorative.

Requires the isolated MySQL on 127.0.0.1:3307 to be running (as the task
environment provides).
"""
from __future__ import annotations

import math

import pytest

from app import anomalies, forecasting, hcp_scoring, root_cause

# Ground-truth entity ids (verified against the DB)
CARDIOMAX, RESPICARE, DAPAGLYN = 1, 21, 10
NORTH, WEST, EAST = 1, 3, 4


# ---- HCP scoring: weights & bands ---------------------------------------
def test_score_weights_sum_to_one():
    assert math.isclose(sum(hcp_scoring.WEIGHTS.values()), 1.0, abs_tol=1e-9)


def test_mandated_weight_values():
    w = hcp_scoring.WEIGHTS
    assert w["rxVolume"] == 0.40
    assert w["rxGrowth"] == 0.25
    assert w["engagement"] == 0.15
    assert w["taRelevance"] == 0.10
    assert w["competitorOpportunity"] == 0.10


@pytest.mark.parametrize("score,expected", [
    (100, "HIGH"), (80, "HIGH"), (79.99, "MEDIUM"),
    (50, "MEDIUM"), (49.99, "LOW"), (0, "LOW"),
])
def test_band_boundaries(score, expected):
    assert hcp_scoring.band(score) == expected


# ---- Anomaly severity thresholds ----------------------------------------
@pytest.mark.parametrize("z,expected", [
    (3.5, "CRITICAL"), (3.49, "HIGH"), (2.5, "HIGH"),
    (2.49, "MEDIUM"), (2.0, "MEDIUM"), (1.99, None), (-3.6, "CRITICAL"),
])
def test_anomaly_severity_thresholds(z, expected):
    assert anomalies._severity(z) == expected


# ---- Forecast horizon ----------------------------------------------------
@pytest.mark.parametrize("horizon", [1, 3, 6, 12])
def test_forecast_returns_requested_horizon(horizon):
    values = [100 + 5 * i + (10 if i % 12 < 6 else -10) for i in range(24)]
    fc, model, mape, resid_std = forecasting.forecast_series(values, horizon)
    assert len(fc) == horizon
    assert model in ("holt_winters_additive", "damped_linear_trend")


def test_forecast_short_history_falls_back():
    fc, model, mape, resid_std = forecasting.forecast_series([100, 110, 120, 130, 140, 150], 4)
    assert model == "damped_linear_trend"
    assert len(fc) == 4


# ---- Root-cause: contributionPct sums to ~100 ---------------------------
@pytest.mark.parametrize("drug,region,months", [
    (CARDIOMAX, NORTH, 3), (RESPICARE, EAST, 2), (DAPAGLYN, WEST, 4),
])
def test_contribution_pct_sums_to_100(drug, region, months):
    rc = root_cause.compute_root_cause(drug, region, months)
    total = sum(c["contributionPct"] for c in rc["contributors"])
    assert math.isclose(total, 100.0, abs_tol=0.2)


def test_root_cause_has_exactly_five_named_contributors():
    rc = root_cause.compute_root_cause(CARDIOMAX, NORTH, 3)
    factors = {c["factor"] for c in rc["contributors"]}
    assert factors == {
        "PRESCRIPTION_VOLUME", "HCP_ENGAGEMENT", "COMPETITOR_SHARE",
        "INVENTORY", "PRICE_DISCOUNT",
    }


# ---- Ground truth 1: CardioMax / North — demand failure -----------------
def test_gt1_cardiomax_north_headline_about_minus_15():
    rc = root_cause.compute_root_cause(CARDIOMAX, NORTH, 3)
    assert rc["headline"]["direction"] == "DROP"
    assert -16.0 <= rc["headline"]["changePct"] <= -14.5


def test_gt1_cardiomax_north_demand_leads():
    rc = root_cause.compute_root_cause(CARDIOMAX, NORTH, 3)
    top2 = {c["factor"] for c in rc["contributors"][:2]}
    assert "PRESCRIPTION_VOLUME" in top2
    assert "HCP_ENGAGEMENT" in top2


# ---- Ground truth 2: RespiCare / East — supply failure ------------------
def test_gt2_respicare_east_inventory_outranks_prescriptions():
    rc = root_cause.compute_root_cause(RESPICARE, EAST, 2)
    ranks = {c["factor"]: i for i, c in enumerate(rc["contributors"])}
    assert ranks["INVENTORY"] < ranks["PRESCRIPTION_VOLUME"]


# ---- Ground truth 3: anomalies surface both events ----------------------
def test_gt3_anomalies_surface_respicare_drop_and_dapaglyn_spike():
    anoms = anomalies.detect_anomalies(metric="revenue")
    respi_drop = [a for a in anoms if "RespiCare" in a["entityName"]
                  and "East" in a["entityName"] and a["direction"] == "DROP"
                  and a["periodMonth"].startswith("2026-07")]
    dapa_spike = [a for a in anoms if "Dapaglyn" in a["entityName"]
                  and "West" in a["entityName"] and a["direction"] == "SPIKE"
                  and a["periodMonth"].startswith("2026-06")]
    assert respi_drop, "RespiCare East 2026-07 drop not surfaced"
    assert dapa_spike, "Dapaglyn West 2026-06 spike not surfaced"


# ---- HCP score payload contract -----------------------------------------
def test_hcp_score_payload_is_commercial_not_medical():
    scored = hcp_scoring.score_hcps(hcp_ids=[1])
    assert scored, "expected hcp_id=1 to score"
    h = scored[0]
    assert "COMMERCIAL" in h["disclaimer"]
    assert "NOT a medical" in h["disclaimer"]
    assert h["priority"] in ("HIGH", "MEDIUM", "LOW")
    assert h["reasons"]
    assert set(h["components"]) == {
        "rxVolume", "rxGrowth", "engagement", "taRelevance", "competitorOpportunity"}
