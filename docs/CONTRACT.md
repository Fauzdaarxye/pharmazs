# PharmaZs — Integration Contract

**This file is the single source of truth for anyone building a layer of PharmaZs.**
Backend, ML service and frontend are developed in parallel, so every cross-layer
detail must be settled here rather than discovered at integration time. If you
need to deviate, change this file in the same commit.

---

## 1. Topology

```
Browser
  └─> Next.js 15 (App Router)         http://localhost:3000
        └─> Node.js + Express API     http://localhost:4000/api
              ├─> MySQL 8             127.0.0.1:3307/pharmazs
              └─> Python FastAPI      http://localhost:8000     (ML / analytics only)
```

The frontend NEVER talks to MySQL and NEVER talks to FastAPI directly (SRS §5, §28).
Node is the only thing holding DB credentials. FastAPI is reachable only from Node.

### Local MySQL

This machine already had an unrelated MySQL 9.7 system daemon on port 3306. Ours is a
**separate Homebrew instance on port 3307** with its own socket, deliberately isolated
so we never touch the pre-existing server.

```
host      127.0.0.1
port      3307
socket    /opt/homebrew/var/mysql/pharmazs.sock
database  pharmazs
user      pharmazs
password  pharmazs_dev_2026
```

Start it with `database/mysql-start.sh`.

### Ports summary

| Service   | Port | Env var                 |
|-----------|------|-------------------------|
| Frontend  | 3000 | —                       |
| Node API  | 4000 | `PORT`                  |
| FastAPI   | 8000 | `ML_PORT`               |
| MySQL     | 3307 | `DB_PORT`               |

---

## 2. Response envelope

Every Node endpoint returns this shape. No endpoint returns a bare array.

```jsonc
// success
{ "success": true, "data": <payload>, "meta": { /* optional: pagination, timings */ } }

// failure
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [] } }
```

Error codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `RATE_LIMITED` (429), `ML_UNAVAILABLE` (503), `INTERNAL` (500).

Paginated endpoints put pagination in `meta`:

```jsonc
"meta": { "page": 1, "pageSize": 25, "total": 2000, "totalPages": 80 }
```

### Money and percentages

- Revenue is returned as a **number of rupees** (not a string, not paise): `18452310.55`.
- Percentages are returned as numbers in percent units: `-15.3` means −15.3%.
- Percentage-point deltas use the suffix `Pp`: `competitorSharePp: 7.0`.
- The frontend does all currency formatting (`₹1.85 Cr`, `₹18.4 L`). The API never
  returns pre-formatted display strings.

### Field naming

MySQL uses `snake_case`; the API returns **`camelCase`**. Convert in the repository
layer, not in the controller, so the shape is consistent everywhere.

---

## 3. Auth (SRS §6, §38)

- `POST /api/auth/register` → `{ fullName, email, password, role }`
- `POST /api/auth/login` → `{ email, password }` → `{ accessToken, refreshToken, user }`
- `POST /api/auth/refresh` → `{ refreshToken }` → `{ accessToken }`
- `POST /api/auth/logout` → revokes the refresh token
- `GET  /api/auth/me` → current user

Access token: JWT, HS256, 15 min, payload `{ sub, email, role, repId, regionId }`.
Refresh token: opaque random, 7 days, **sha256 hash** stored in `refresh_tokens`.
Passwords: bcrypt, cost 10. Never log a token or a password.

### Roles and scoping

`ADMIN`, `EXECUTIVE`, `MANAGER`, `SALES_REP`, `ANALYST`.

| Role       | Scope enforced server-side                                  |
|------------|-------------------------------------------------------------|
| ADMIN      | everything, plus user management                            |
| EXECUTIVE  | everything, read-only                                       |
| ANALYST    | everything, read-only                                       |
| MANAGER    | own region only (`region_id` from the user row)             |
| SALES_REP  | own assigned HCP panel only (`sales_rep_id` from the row)   |

Scoping is applied in SQL, not by filtering after the fact. A SALES_REP asking for
`/api/hcps` must not receive another rep's panel in the JSON at all.

### Demo accounts

Password for all five: `PharmaZs@2026`

| Email                  | Role      |
|------------------------|-----------|
| admin@pharmazs.io      | ADMIN     |
| exec@pharmazs.io       | EXECUTIVE |
| manager@pharmazs.io    | MANAGER   |
| rep@pharmazs.io        | SALES_REP |
| analyst@pharmazs.io    | ANALYST   |

---

## 4. Common query parameters

All analytics endpoints accept these. Unknown params are ignored, invalid values are
a `VALIDATION_ERROR`.

| Param      | Example        | Notes                                            |
|------------|----------------|--------------------------------------------------|
| `from`     | `2026-03-01`   | inclusive; defaults to 12 months before `to`     |
| `to`       | `2026-08-31`   | inclusive; defaults to the latest data date      |
| `regionId` | `1`            | repeatable → `regionId=1&regionId=2`             |
| `taId`     | `2`            | therapeutic area                                 |
| `drugId`   | `1`            |                                                  |
| `repId`    | `14`           |                                                  |
| `specialty`| `Cardiologist` |                                                  |
| `page`     | `1`            | 1-based, default 1                               |
| `pageSize` | `25`           | default 25, max 200                              |
| `sort`     | `-revenue`     | `-` prefix = descending                          |
| `q`        | `sharma`       | free-text search where the endpoint supports it  |

**Filtering is always server-side** (SRS §32). Never return a full table for the
browser to filter.

The dataset spans **2024-09-01 .. 2026-08-31**. "Now" for the product is 2026-09.
Do not hardcode dates in queries — derive from `MAX(sale_date)` or the params.

---

## 5. Node API surface

`✱` = calls FastAPI internally.

### Dashboard / overview
- `GET /api/dashboard/kpis` → the six KPI cards.
  **Every figure honours the resolved [from,to] window** (default: the trailing 12 whole
  months, month-aligned). Totals must reconcile with `/dashboard/regional-performance`
  for the same window — a headline total spanning a different period from the table under
  it is a bug, not a feature. `totalPrescriptions` COUNTS scripts; it never sums units.
  `meta.highlights` values are region NAME strings, not objects
  ```jsonc
  { "totalRevenue": 1787183606, "revenueGrowthPct": 27.6, "totalPrescriptions": 159438,
    "activeHcps": 2000, "marketSharePct": 27.8, "inventoryAvailabilityPct": 94.2,
    "totalProducts": 38, "totalReps": 60,
    "deltas": { "totalRevenue": 12.4, "revenueGrowthPct": 3.2, "totalPrescriptions": 8.7,
                "activeHcps": 5.3, "marketSharePct": 1.8, "inventoryAvailabilityPct": -1.4 },
    "sparklines": { "totalRevenue": [1.2, 1.3, …] } }
  ```
- `GET /api/dashboard/revenue-trend?granularity=monthly|daily&metric=revenue|units`
  → `[{ "period": "2026-08", "revenue": 812340000, "target": 790000000, "units": 41233 }]`
- `GET /api/dashboard/therapeutic-areas`
  → `[{ "taId": 1, "taName": "Cardiology", "revenue": 3240000000, "growthPct": 18.2, "sharePct": 31.2 }]`
- `GET /api/dashboard/regional-performance`
  → `[{ "regionId": 1, "regionName": "North", "revenue": …, "growthPct": …, "marketSharePct": …, "prescriptions": …, "hcpCount": …, "repCount": … }]`
  plus `meta.highlights: { topRegion, fastestGrowing, atRisk }`
- `GET /api/dashboard/top-products?limit=5`
  → `[{ "rank": 1, "drugId": 1, "drugName": "CardioMax", "taName": "Cardiology", "revenue": …, "growthPct": …, "prescriptions": …, "marketSharePct": … }]`
- `GET /api/dashboard/top-hcps?limit=5`
- `GET /api/dashboard/alerts?limit=10` ✱

### Products (SRS §11)
- `GET /api/products` — paginated, filterable, sortable
- `GET /api/products/:drugId` — detail: price, units, revenue, Rx, growth, competitors
- `GET /api/products/:drugId/trend`
- `GET /api/products/:drugId/regional`
- `GET /api/products/:drugId/forecast` ✱
- `GET /api/products/:drugId/competitors`

### HCPs (SRS §12, §13)
- `GET /api/hcps` — paginated directory; supports `q`, `specialty`, `regionId`,
  `priority=HIGH|MEDIUM|LOW`, `minScore`, `sort=-score|-rxVolume|-revenue`
  ```jsonc
  { "hcpId": 1, "hcpCode": "HCP-00001", "fullName": "Dr. Rajesh Sharma",
    "specialty": "Cardiologist", "hospital": "Apollo Hospital", "city": "Delhi",
    "regionName": "North", "rxVolume": 1240, "rxGrowthPct": 14.2, "revenue": 4820000,
    "visits": 4, "lastVisitDate": "2026-08-19", "daysSinceLastVisit": 19,
    "potentialScore": 94, "priority": "HIGH", "competitorUsagePct": 22.4 }
  ```
- `GET /api/hcps/summary` → the 5 KPI cards on the HCP page
  `{ "totalHcps", "highPotentialHcps", "highPotentialSharePct", "avgRxVolumePerHcp", "engagementRatePct", "avgPotentialScore" }`
- `GET /api/hcps/:hcpId` — detail incl. score breakdown and reasons
- `GET /api/hcps/:hcpId/trend`
- `GET /api/hcps/:hcpId/score` ✱ — live recompute with component sub-scores

### Sales reps (SRS §14)
- `GET /api/reps` — paginated; revenue, target, achievementPct, visits, hcpCount, rank
- `GET /api/reps/:repId`
- `GET /api/reps/:repId/hcps`
- `GET /api/reps/:repId/recommended-hcps` ✱ (SRS §27)

### Regions (SRS §15)
- `GET /api/regions`
- `GET /api/regions/:regionId`
- `GET /api/regions/:regionId/drilldown?level=city|ta|product` (SRS §15 hierarchy)

### Competitors, inventory
- `GET /api/competitors`
- `GET /api/competitors/market-share?drugId=&regionId=`
- `GET /api/inventory` — paginated; stock, cover months, stockout days, risk flag
- `GET /api/inventory/at-risk`

### Analytics / ML passthrough ✱
- `GET  /api/forecast?entityType=COMPANY|DRUG|REGION|TA&entityId=&horizon=6`
- `GET  /api/anomalies?severity=&from=&to=`
- `POST /api/analytics/why-did-sales-change`
  ```jsonc
  // request
  { "drugId": 1, "regionId": 1, "periodMonths": 3 }
  // response — contributors are COMPUTED, never hardcoded (SRS §25, §26)
  { "headline": { "metric": "revenue", "changePct": -15.3, "direction": "DROP",
                  "current": 30800000, "previous": 36400000,
                  "periodLabel": "Jun–Aug 2026 vs Mar–May 2026" },
    "contributors": [
      { "factor": "PRESCRIPTION_VOLUME", "label": "Prescription volume",
        "changePct": -8.5, "contributionPct": 42.1, "direction": "NEGATIVE",
        "detail": "Prescribed units fell from 21,400 to 19,580" },
      { "factor": "HCP_ENGAGEMENT",   "label": "HCP engagement", "changePct": -14.6, … },
      { "factor": "COMPETITOR_SHARE", "label": "Competitor share", "changePct": 7.0, … },
      { "factor": "INVENTORY",        "label": "Inventory availability", "changePct": -5.0, … },
      { "factor": "PRICE_DISCOUNT",   "label": "Net price / discounting", "changePct": …, … }
    ],
    "recommendations": [ /* same shape as /api/recommendations */ ],
    "confidence": 0.78 }
  ```
- `GET /api/recommendations?role=&limit=`
  ```jsonc
  { "recId": 12, "recType": "HCP_PRIORITY", "title": "Prioritise 8 high-potential cardiologists in North",
    "rationale": "…computed from data…", "expectedImpact": "≈₹42L incremental revenue",
    "priority": "HIGH", "confidence": 0.72, "targetEntityType": "REGION", "targetEntityId": 1 }
  ```

### Reference data (for filter dropdowns)
- `GET /api/meta/filters` → `{ regions[], therapeuticAreas[], products[], reps[], specialties[], dateRange:{min,max} }`

---

## 6. FastAPI (ML) surface

Internal only. Plain JSON in/out, no envelope, no auth (bound to localhost).

- `GET  /health` → `{ "status": "ok", "modelsLoaded": true }`
- `POST /forecast` → `{ entityType, entityId, horizon }` →
  `{ history: [{period, value}], forecast: [{period, predicted, lower, upper}], model, mape }`
- `POST /hcp-score` → `{ hcpIds?: [], regionId?, limit? }` →
  `[{ hcpId, totalScore, priority, components: {rxVolume, rxGrowth, engagement, taRelevance, competitorOpportunity}, reasons: [] }]`
- `POST /anomalies` → `{ entityType, metric, lookbackMonths }` →
  `[{ entityType, entityId, entityName, periodMonth, metric, actual, expected, deviationPct, zScore, severity, direction }]`
- `POST /root-cause` → `{ drugId, regionId, periodMonths }` → the `why-did-sales-change` payload above
- `POST /recommendations` → `{ role, regionId?, repId?, limit }` → recommendation list

### Modelling rules

- **Forecast**: Holt-Winters / additive-trend + seasonal on ≥18 monthly points; fall back
  to a damped linear trend when history is short. Report backtest MAPE. Never present a
  forecast as certain (SRS §23).
- **HCP score** (SRS §13): weights **must** be Rx volume 40%, Rx growth 25%, engagement
  15%, TA relevance 10%, competitor opportunity 10%. Bands: 80–100 HIGH, 50–79 MEDIUM,
  0–49 LOW. Each component is a 0–100 percentile within the comparable cohort, so the
  score is a *commercial prioritisation*, not a medical judgement — say so in the payload.
- **Anomaly**: robust z-score (median / MAD) on the seasonally-adjusted series. `|z| ≥ 3.5`
  CRITICAL, `≥ 2.5` HIGH, `≥ 2.0` MEDIUM. Report direction.
- **Root cause**: attribute the revenue change across the five contributors by their
  normalised standardised movement; `contributionPct` must sum to ~100. Every number
  must come from a query. **No hardcoded sentences** (SRS §26).

---

## 7. Design system (from Figma)

Enterprise analytics look: dense, calm, information-first. Not a colourful SaaS toy.

### Palette

```css
--sidebar:        #0B1F3A;   /* dark navy rail */
--sidebar-hover:  #16305A;
--sidebar-active: #2563EB;   /* filled rounded rect behind the active item */
--sidebar-muted:  #8CA3C4;   /* inactive nav label */
--accent-teal:    #22D3EE;   /* logo mark + "COMMERCIAL INTELLIGENCE" subtitle */

--bg:             #F6F8FB;   /* page background */
--card:           #FFFFFF;
--border:         #E5E9F0;
--text:           #0F172A;
--text-muted:     #64748B;

--primary:        #2563EB;
--primary-hover:  #1D4ED8;

--success:        #16A34A;  --success-bg: #DCFCE7;
--danger:         #DC2626;  --danger-bg:  #FEE2E2;
--warning:        #F59E0B;  --warning-bg: #FEF3C7;
--violet:         #7C3AED;  --violet-bg:  #F5F3FF;   /* AI insight banners */
```

Therapeutic-area series colours (charts, pills, progress bars — keep them stable
across every page so a colour always means the same area):

| Area              | Colour    |
|-------------------|-----------|
| Cardiology        | `#2563EB` |
| Diabetes          | `#10B981` |
| Oncology          | `#8B5CF6` |
| Respiratory       | `#F59E0B` |
| Neurology         | `#94A3B8` |
| Gastroenterology  | `#EC4899` |

### Type & metrics

- Font: **Inter** (`next/font`), tabular numerals for all figures (`font-variant-numeric: tabular-nums`) — columns of numbers must align.
- H1 page title 28px/700; card title 16px/600; KPI value 30px/700; body 14px; muted label 13px.
- Card: `bg-white rounded-xl border border-[--border] shadow-[0_1px_2px_rgba(16,24,40,0.05)] p-5`
- Sidebar 264px fixed. Content max-width 1440px, gutter 24px, grid gap 20px.
- Radius: cards 12px, buttons/inputs 8px, pills full.

### Shell

- **Sidebar** (navy): logo mark + `PharmaZs` + teal `COMMERCIAL INTELLIGENCE`; nav items with
  a 20px lucide icon; active item = solid `--sidebar-active` rounded rect, white label.
  Pinned to the bottom: divider, `Settings`, `Help & Support`, then a user card with avatar,
  name and role.
- **Topbar** (white, 1px bottom border, 64px): breadcrumb `PharmaZs / <Section>` with the
  current crumb in `--text` semibold; centre search input (`Search products, HCPs, regions…`);
  date-range picker with a calendar icon; `AI Insights Active` pill (violet border, violet
  tint, sparkle icon); bell with a red count badge; help icon.

### Nav (exact order and routes)

| Label                 | Route              |
|-----------------------|--------------------|
| Overview              | `/overview`        |
| Dashboard             | `/dashboard`       |
| Products              | `/products`        |
| HCP Intelligence      | `/hcps`            |
| Sales Representatives | `/sales-reps`      |
| Regions               | `/regions`         |
| Competitors           | `/competitors`     |
| Inventory             | `/inventory`       |
| Forecasting           | `/forecasting`     |
| Alerts                | `/alerts`          |
| Recommendations       | `/recommendations` |
| Reports               | `/reports`         |

`/login` has no shell.

### Shared components (build these once, in `frontend/components/ui/`)

`Card`, `KpiCard` (label, value, delta badge, `vs last period`, optional sparkline),
`KpiCardSimple` (label, value, muted sub-note — the HCP-page variant), `DeltaBadge`
(green `+x%` / red `−x%` pill), `Pill` / `TaBadge`, `ScoreBadge` (green ≥80, amber 50–79,
grey <50), `PriorityBadge`, `SegmentedControl` (`Revenue|Units`, `Monthly|Daily`),
`FilterChipBar` (removable chips + `Reset` + `Apply Filters`), `FilterSelectBar`
(labelled dropdowns — `Specialty: All`), `DataTable` (sticky header, sortable, paginated,
loading skeleton, empty state), `AiInsightBanner` (violet) / `AiAlertBanner` (red),
`StatTile` (Top Region / Fastest Growing / At Risk), `ChartCard`, `Breadcrumb`, `Spinner`,
`ErrorState`.

Every data surface must have **loading, empty and error** states (SRS §40). A chart that
renders nothing on failure is a bug.

### Charts

Recharts. Line for trends (2px stroke, no dots, dashed green target line), horizontal bars
for TA contribution, grouped bars for regional comparison, area+band for forecast
confidence intervals. Grid: horizontal lines only, `#EEF2F7`. Tooltips: white card, 1px
border, formatted currency. No 3-D, no gradients-for-decoration.

---

## 8. Conventions

- TypeScript everywhere on the JS side; no `any` in exported signatures.
- Backend: layered `routes → controllers → services → repositories`. SQL lives only in
  repositories, always **parameterised** — string-concatenated SQL is a defect (SRS §38).
- `.env` for every secret; commit `.env.example` only.
- Frontend data access goes through one typed `lib/api.ts` client. No `fetch` in components.
- Server-side pagination and filtering everywhere; no `SELECT *` on a fact table.
- Tests: Jest + Supertest (Node), pytest (Python), Vitest + Testing Library (frontend).

---

## 9. Page specifications

Every page renders inside the shell (§7) with the correct breadcrumb, an H1 and a muted
subtitle. Every data surface needs **loading / empty / error** states.

### `/login` — no shell
Professional split layout. Posts to `/api/auth/login`, stores both tokens, redirects to
`/dashboard`. Displays a failed login clearly. Lists the five demo accounts from §3 for
convenience (all password `PharmaZs@2026`).

### `/dashboard` — the primary Figma screen, build pixel-faithfully
H1 `Commercial Intelligence Overview`, subtitle
`Monitor pharmaceutical performance, growth opportunities and emerging risks.`

1. `FilterChipBar` — removable chips (`Last 12 Months`, `All Regions`, `All Therapeutic
   Areas`, `All Products`, `All Sales Reps`) with `Reset` and a solid blue `Apply Filters`.
2. A row of **six** `KpiCard`s, each with a sparkline and a delta badge + `vs last period`:
   Total Revenue, Revenue Growth, Total Prescriptions, Active HCPs, Market Share,
   Inventory Availability.
3. **Revenue Performance** (2/3 width) — subtitle `Tracking actual revenue against target
   goals.`; two `SegmentedControl`s (`Revenue|Units`, `Monthly|Daily`); a violet
   `AiInsightBanner`; a line chart with a blue actual line and a **green dashed target
   line**.
4. **Therapeutic Area Performance** (1/3 width) — subtitle `Revenue contribution & growth
   matrix.`; one row per area: name, revenue, coloured growth %, and a horizontal progress
   bar in that area's fixed colour.
5. **Regional Performance** — subtitle `Comparison across core geographical markets.`;
   three `StatTile`s (`Top Region`, `Fastest Growing` on green, `At Risk` on red); a region
   list showing `MS: nn%` and revenue; a red `AiAlertBanner` at the bottom.
6. **Top Performing Products** — subtitle `Clinical leaders ranked by current commercial
   impact.`; a `View All Products` link to `/products`; table columns Rank (`#1`), Product,
   Therapeutic Area (`TaBadge`), Revenue, Growth, Prescriptions, Mkt Share.

### `/hcps` — the second Figma screen, build pixel-faithfully
H1 `Healthcare Professional (HCP) Intelligence`, subtitle
`Identify and prioritize high-value commercial opportunities.`

1. **Five** `KpiCardSimple` cards (big value + muted sub-note, no sparkline): Total HCPs
   Tracked (`+4.2% Growth`), High-Potential HCPs (`12.6% of active base`), Avg. Rx Volume /
   HCP (`Monthly average`), HCP Engagement Rate (`+2.1% improvement`), Average Potential
   Score (`Weighted scoring`, rendered `82.4/100`).
2. A `FilterSelectBar` labelled `Segment Filters:` with dropdowns `Specialty: All`,
   `Region: All`, `Potential Score: All`, `Prescription Growth: All`, `Engagement: All`.
3. **HCP Performance Directory** `DataTable`, server-side paginated and sortable: HCP Name
   (semibold), Specialty, Hospital / Institution, Region, Rx Volume, Rx Growth
   (green/red), Visits, Last Visit (relative — `5 days ago`, `Yesterday`), Score
   (`ScoreBadge`), Priority (`PriorityBadge`).

### `/overview`
Executive landing: headline revenue + growth, the top three alerts, the top three
recommendations, a compact TA breakdown and a regional mini-map/list. Deliberately
higher-level and shorter than `/dashboard`.

### `/products`
Filterable, sortable, paginated product table (drug, brand/generic, TA, price, units sold,
revenue, Rx volume, growth, market share). Row click → product detail with a revenue
trend, a regional split, a forecast chart with confidence band, and a competitor
comparison (SRS §11).

### `/sales-reps`
Rep leaderboard: revenue, target, achievement % (with a progress bar), visits, HCP count,
rank. Rep detail shows their panel and their recommended HCPs (SRS §14, §27).

### `/regions`
Regional comparison table + chart, and the SRS §15 drill-down
`Region → City → Therapeutic Area → Product`, ending on the relevant HCPs.

### `/competitors`
Our share vs competitor share by product and region, with share movement over time and the
biggest share losses highlighted.

### `/inventory`
Stock by product and region: closing stock, months of cover, stockout days, and an at-risk
view sorted by risk.

### `/forecasting`
Entity picker (Company / Drug / Region / TA) plus a horizon control; renders history, point
forecast and a confidence band, and shows the backtest MAPE. Must be worded as an estimate,
never a guarantee (SRS §23).

### `/alerts`
Business alerts grouped by severity, filterable, with a read/unread state.

### `/recommendations`
The decision-support payoff. Recommendation cards showing title, computed rationale,
expected impact, priority and confidence. Each card links to the entity it is about, and
where relevant exposes the **"Why did sales change?"** panel: the headline change, the five
ranked contributors with their contribution %, and the recommended actions (SRS §25, §26).

### `/reports`
Saved/exportable views; CSV export of the current filtered table.

