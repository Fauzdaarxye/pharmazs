"""Pydantic models mirroring the exact shapes in CONTRACT.md §6.

The FastAPI (ML) surface is plain JSON in/out, no envelope, no auth.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

EntityType = Literal["COMPANY", "DRUG", "REGION", "TA"]


# ---- /forecast ----------------------------------------------------------
class ForecastRequest(BaseModel):
    entityType: EntityType
    entityId: Optional[int] = None
    horizon: int = Field(6, ge=1, le=24)


class HistoryPoint(BaseModel):
    period: str
    value: float


class ForecastPoint(BaseModel):
    period: str
    predicted: float
    lower: float
    upper: float


class ForecastResponse(BaseModel):
    entityType: EntityType
    entityId: Optional[int]
    horizon: int
    history: list[HistoryPoint]
    forecast: list[ForecastPoint]
    model: str
    mape: Optional[float]


# ---- /hcp-score ---------------------------------------------------------
class HcpScoreRequest(BaseModel):
    hcpIds: Optional[list[int]] = None
    regionId: Optional[int] = None
    limit: Optional[int] = Field(None, ge=1, le=2000)


class HcpScoreComponents(BaseModel):
    rxVolume: float
    rxGrowth: float
    engagement: float
    taRelevance: float
    competitorOpportunity: float


class HcpScore(BaseModel):
    hcpId: int
    hcpName: str
    totalScore: float
    priority: Literal["HIGH", "MEDIUM", "LOW"]
    components: HcpScoreComponents
    weights: dict[str, float]
    reasons: list[str]
    disclaimer: str


# ---- /anomalies ---------------------------------------------------------
class AnomalyRequest(BaseModel):
    entityType: Literal["DRUG", "REGION", "TA", "COMPANY"] = "DRUG"
    metric: Literal["revenue", "units"] = "revenue"
    lookbackMonths: int = Field(24, ge=6, le=24)


class Anomaly(BaseModel):
    entityType: str
    entityId: Optional[int]
    entityName: str
    periodMonth: str
    metric: str
    actual: float
    expected: float
    deviationPct: float
    zScore: float
    severity: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    direction: Literal["DROP", "SPIKE"]


# ---- /root-cause --------------------------------------------------------
class RootCauseRequest(BaseModel):
    drugId: int
    regionId: int
    periodMonths: int = Field(3, ge=1, le=6)


class Headline(BaseModel):
    metric: str
    changePct: float
    direction: Literal["DROP", "SPIKE", "FLAT"]
    current: float
    previous: float
    periodLabel: str


class Contributor(BaseModel):
    factor: str
    label: str
    changePct: float
    contributionPct: float
    direction: Literal["POSITIVE", "NEGATIVE"]
    detail: str


class Recommendation(BaseModel):
    recType: str
    title: str
    rationale: str
    expectedImpact: str
    priority: Literal["HIGH", "MEDIUM", "LOW"]
    confidence: float
    targetEntityType: Optional[str] = None
    targetEntityId: Optional[int] = None


class RootCauseResponse(BaseModel):
    headline: Headline
    contributors: list[Contributor]
    recommendations: list[Recommendation]
    confidence: float


# ---- /recommendations ---------------------------------------------------
class RecommendationsRequest(BaseModel):
    role: str = "ALL"
    regionId: Optional[int] = None
    repId: Optional[int] = None
    limit: int = Field(10, ge=1, le=50)


# ---- /jobs/refresh-all --------------------------------------------------
class RefreshResult(BaseModel):
    ok: bool
    persisted: dict[str, int]
    tookMs: int
