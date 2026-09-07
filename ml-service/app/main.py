"""PharmaIQ ML / analytics FastAPI service (CONTRACT.md §6).

Internal only — bound to 127.0.0.1:8000, reached solely by the Node API. Plain
JSON in/out, no envelope, no auth.
"""
from __future__ import annotations

import numpy as np
from fastapi import FastAPI, HTTPException

from . import anomalies as anom_mod
from . import hcp_scoring, jobs, queries, recommendations, root_cause
from .forecasting import forecast_series
from .models_schema import (
    Anomaly, AnomalyRequest, ForecastRequest, ForecastResponse, HcpScore,
    HcpScoreRequest, RecommendationsRequest, RefreshResult, RootCauseRequest,
    RootCauseResponse,
)

app = FastAPI(title="PharmaIQ ML Service", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok", "modelsLoaded": True}


@app.post("/forecast", response_model=ForecastResponse)
def forecast(req: ForecastRequest):
    if req.entityType != "COMPANY" and req.entityId is None:
        raise HTTPException(400, "entityId required for non-COMPANY forecast")
    hist = queries.monthly_revenue_series(req.entityType, req.entityId)
    if hist.empty or len(hist) < 6:
        raise HTTPException(404, "not enough history to forecast")

    values = hist["value"].tolist()
    fc, model, mape, resid_std = forecast_series(values, req.horizon)

    # next periods
    last = hist["period"].iloc[-1]
    y, m = int(last[:4]), int(last[5:7])
    idx = y * 12 + (m - 1)
    fc_points = []
    for h in range(1, req.horizon + 1):
        yy, mm = divmod(idx + h, 12)
        period = f"{yy:04d}-{mm + 1:02d}"
        pred = float(fc[h - 1])
        band = 1.96 * resid_std * (h ** 0.5)
        fc_points.append({
            "period": period,
            "predicted": round(pred, 2),
            "lower": round(pred - band, 2),
            "upper": round(pred + band, 2),
        })

    return {
        "entityType": req.entityType,
        "entityId": req.entityId,
        "horizon": req.horizon,
        "history": [{"period": p, "value": round(float(v), 2)}
                    for p, v in zip(hist["period"], hist["value"])],
        "forecast": fc_points,
        "model": model,
        "mape": None if (mape != mape) else round(mape, 2),
    }


@app.post("/hcp-score", response_model=list[HcpScore])
def hcp_score(req: HcpScoreRequest):
    return hcp_scoring.score_hcps(req.hcpIds, req.regionId, req.limit)


@app.post("/anomalies", response_model=list[Anomaly])
def anomalies(req: AnomalyRequest):
    return anom_mod.detect_anomalies(req.entityType, req.metric, req.lookbackMonths)


@app.post("/root-cause", response_model=RootCauseResponse)
def root_cause_endpoint(req: RootCauseRequest):
    rc = root_cause.compute_root_cause(req.drugId, req.regionId, req.periodMonths)
    # attach data-driven recommendations scoped to this region
    recs = recommendations.build_recommendations(
        role="ALL", region_id=req.regionId, limit=3)
    rc["recommendations"] = recs
    return rc


@app.post("/recommendations")
def recs(req: RecommendationsRequest):
    return recommendations.build_recommendations(req.role, req.regionId, req.repId, req.limit)


@app.post("/jobs/refresh-all", response_model=RefreshResult)
def refresh_all():
    return jobs.refresh_all()
