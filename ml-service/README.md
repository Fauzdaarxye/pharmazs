# PharmaZs — ML / Analytics Service

FastAPI service providing forecasting, HCP scoring, anomaly detection, root-cause
attribution and recommendations for PharmaZs. **Internal only** — bound to
`127.0.0.1:8000`, reached solely by the Node API (never the browser, never
directly). Plain JSON in/out, no response envelope, no auth (CONTRACT.md §1, §6).

## Run

```bash
cd ml-service
python3.14 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env         # DB creds for the isolated MySQL on :3307
./run.sh                     # uvicorn on 127.0.0.1:8000
```

Requires the isolated Homebrew MySQL on `127.0.0.1:3307` (db `pharmazs`) to be
running. The service reads fact data and writes only to the ML output tables
(`hcp_scores`, `forecasts`, `anomalies`, `alerts`); it never mutates
transactional data or the schema.

### Environment

Python **3.14**. Verified cp314 wheels: numpy 2.5.3, pandas **3.0.5** (v3, not v2),
scikit-learn 1.9.0. `statsmodels` 0.15.0 also installed cleanly on cp314, but the
forecaster does **not** depend on it — Holt-Winters is implemented directly in
numpy so the service runs even where no statsmodels wheel exists.

All SQL is parameterised (CONTRACT.md §8). "Now" is never hardcoded — every window
is derived from `MAX(sale_date)` (dataset span 2024-09-01 .. 2026-08-31).

## Endpoints (CONTRACT.md §6)

| Method | Path                 | Purpose |
|--------|----------------------|---------|
| GET    | `/health`            | `{status, modelsLoaded}` |
| POST   | `/forecast`          | history + point forecast + confidence band + backtest MAPE |
| POST   | `/hcp-score`         | weighted commercial priority score per HCP with component sub-scores + reasons |
| POST   | `/anomalies`         | robust-z anomalies per drug×region, with severity + direction |
| POST   | `/root-cause`        | "Why did sales change?" — five ranked contributors + recommendations |
| POST   | `/recommendations`   | computed, data-driven recommendation list |
| POST   | `/jobs/refresh-all`  | recompute + **persist** hcp_scores, forecasts, anomalies, alerts |

---

## Models & assumptions

### 1. Forecast — `app/forecasting.py`

- **Model:** additive **Holt-Winters** (level + trend + seasonal, 12-month season)
  implemented in numpy, used when history has ≥ 18 monthly points. Smoothing
  constants α=0.4, β=0.1, γ=0.2.
- **Fallback:** a **damped linear trend** (φ=0.9) when history is short (< 18
  points), so short/new series still forecast without over-extrapolating.
- **Confidence band:** ±1.96·σ_resid·√h — widens with horizon `h`. A forecast is
  **never presented as certain** (SRS §23); the band and the backtest **MAPE** are
  always returned so the UI can show confidence.
- **Assumptions:** monthly grain, additive seasonality, residuals roughly
  symmetric. MAPE is in-sample over the fitted region (skipping the first season).

### 2. HCP score — `app/hcp_scoring.py`

- **Mandated weights (sum = 1.0):** Rx volume **40%**, Rx growth **25%**,
  engagement **15%**, TA relevance **10%**, competitor opportunity **10%**
  (SRS §13). Enforced and unit-tested.
- **Components:** each is a **0–100 percentile within the physician's specialty
  cohort**, so the score is a *relative commercial ranking*, not an absolute
  clinical measure:
  - *Rx volume* — recent 3-month prescribed units.
  - *Rx growth* — % change in units, recent 3 months vs the prior 3.
  - *Engagement* — rep visit count to the HCP in the recent window.
  - *TA relevance* — monthly patient volume (how central the therapeutic area is
    to the physician's practice).
  - *Competitor opportunity* — headroom `100 − our regional share`; more
    competitor-held share = more to convert.
- **Bands:** 80–100 **HIGH**, 50–79 **MEDIUM**, 0–49 **LOW**.
- **`reasons`:** human-readable, computed from the top components and growth/
  engagement/headroom signals — these drive the sales-rep UI.
- **Disclaimer (in every payload):** the score is a **COMMERCIAL prioritisation**
  for sales targeting, **not a medical or clinical judgement**.
- **Assumption:** percentiles are always computed over the full active cohort so
  the ranking is stable; the `regionId`/`hcpIds`/`limit` filters are applied
  *after* scoring.

### 3. Anomaly detection — `app/anomalies.py`

- **Series:** monthly revenue (or units) per drug×region.
- **Seasonal baseline:** the **median of the same calendar month** across the
  history (median, not mean, so one freak month does not distort it).
- **Score:** robust z-score `0.6745·(x − median)/MAD`, computed on **both** the
  additive residual (`value − baseline`, catches absolute shocks) and the
  multiplicative ratio (`value / baseline`, catches proportional shocks in noisy
  series). The **stronger of the two** is used — this is why a proportionally
  large swing in the small, seasonal East region surfaces alongside big absolute
  moves elsewhere.
- **Severity:** `|z| ≥ 3.5` CRITICAL, `≥ 2.5` HIGH, `≥ 2.0` MEDIUM (else not an
  anomaly). **Direction:** SPIKE above baseline, DROP below.
- **Assumption:** ≥ 6 monthly points per series; MAD falls back to std when zero.

### 4. Root cause — `app/root_cause.py`

"Why did sales change?" attributes the revenue change across **exactly five named
contributors**, every figure from a query, nothing hardcoded (SRS §25, §26):

`PRESCRIPTION_VOLUME`, `HCP_ENGAGEMENT`, `COMPETITOR_SHARE`, `INVENTORY`,
`PRICE_DISCOUNT`.

- Each factor's **raw movement** is measured in the direction it pushes revenue
  (Rx % change, visit % change, +our-share pp, a supply-pressure term, −discount
  pp).
- The **inventory supply-pressure** term combines the stock-level % change with
  stock-out days: `inv_pct − (stockout_fraction)²·500`. The **quadratic** stock-out
  penalty is the key to discrimination — a handful of stock-out days (≈13% of the
  window) stays minor, but a sustained shortage (≈37%) dominates. This is what lets
  the engine tell a **supply** failure (RespiCare/East: flat Rx, heavy stock-outs)
  from a **demand** failure (CardioMax/North: Rx + engagement down, stock broadly
  intact).
- Each raw movement is divided by a factor-specific **scale** (a fixed modelling
  constant applied identically everywhere) to make magnitudes comparable, then each
  factor's share of the total absolute standardised movement gives
  **`contributionPct`**, which sums to ~100 (renormalised so rounding still totals
  100).
- **`confidence`** rises when one or two factors clearly dominate.
- **Assumption:** the scales are modelling priors, not answers — they are the same
  for every drug/region and all per-request numbers are queried.

### 5. Recommendations — `app/recommendations.py`

Computed from data (no hardcoded sentences, SRS §26): HCP-priority clusters from
the scored frame, revenue-recovery items from recent CRITICAL/HIGH anomaly drops,
and stockout-risk items from recent stock-out days. Every title / rationale /
impact interpolates queried figures.

### `jobs/refresh-all` — `app/jobs.py`

Recomputes everything and **persists** it so dashboards read precomputed values:
`hcp_scores` (all active HCPs), `forecasts` (COMPANY + every drug/region/TA, 6-month
horizon), `anomalies`, and `alerts` (derived from anomalies + stockout risk). Writes
are idempotent per run (clear-and-insert on the ML-owned tables only).

---

## Ground truth verification (docs/GROUND_TRUTH.md)

The dataset has three deliberately planted narratives. The service rediscovers all
three (see `tests/test_ml_service.py`):

| Narrative | Check | Result |
|-----------|-------|--------|
| **CardioMax / North** (3mo) | headline ≈ −15%, `PRESCRIPTION_VOLUME` + `HCP_ENGAGEMENT` lead | −15.3% DROP; engagement 29.6% + Rx 25.9% are the top two ✓ |
| **RespiCare / East** (2mo) | `INVENTORY` ranks **above** `PRESCRIPTION_VOLUME` (supply, not demand) | −26.6% DROP; INVENTORY 77% ≫ Rx 1% ✓ |
| **Dapaglyn / West** (4mo) | anomaly detection flags a **SPIKE** | +34.5% SPIKE; 2026-06 flagged (z ≈ +2.1) ✓ |
| **RespiCare / East** | recent DROP surfaced by `/anomalies` | 2026-07 flagged (z ≈ −2.3) ✓ |

## Tests

```bash
source .venv/bin/activate
python -m pytest tests/ -q
```

29 tests: weights sum to 1.0 and match the mandate; band boundaries (80/50);
anomaly severity thresholds (3.5/2.5/2.0); `contributionPct` sums to ~100; forecast
returns the requested horizon (and the short-history fallback); the three ground-
truth narratives; and the commercial-not-medical HCP payload contract.
