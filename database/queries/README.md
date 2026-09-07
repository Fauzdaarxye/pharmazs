# PharmaZs — Analytical SQL Query Library

A documented, verification-backed SQL library for the PharmaZs commercial-intelligence
platform (SRS §16). **28 distinct analytical queries** across 10 files, each executed
against the live database and confirmed to return plausible rows.

## Layout

| File | Focus | SRS / Contract |
|------|-------|----------------|
| `01_kpis.sql` | Dashboard headline KPIs & sparkline | §7 / `GET /api/dashboard/kpis` |
| `02_revenue_trend.sql` | Revenue vs target, rolling avg, peak/trough | §7 / `revenue-trend` |
| `03_therapeutic_areas.sql` | TA contribution matrix, leaders, materiality | §7 / `therapeutic-areas` |
| `04_regional.sql` | Regional scorecard & city drill-down | §15 / `regional-performance` |
| `05_products.sql` | Product leaderboard, trend, price bands | §11 / `top-products`, `products/:id` |
| `06_hcps.sql` | HCP directory, prioritisation score, summary | §12/§13 / `hcps` |
| `07_sales_reps.sql` | Rep leaderboard, relative overperformers, effectiveness | §14 / `reps` |
| `08_competitors.sql` | Market share, movers, TA competitor threats | §11/§15/§25 / `competitors` |
| `09_inventory.sql` | Stock cover, at-risk ranking, stockout trend | §25 / `inventory` |
| `10_root_cause.sql` | "Why did sales change?" decomposition, anomalies, mix shift | §25/§26 / `why-did-sales-change` |

## Conventions (all queries)

- **No hardcoded dates.** Every window is derived from `(SELECT MAX(sale_date) FROM sales)`
  (or the equivalent for `prescriptions` / `market_share` / `inventory_snapshots`), so the
  library survives a full data regeneration.
- **No `SELECT *` on a fact table** — every projection names its columns.
- Every query carries a header comment: the business question, the SRS section it serves,
  the techniques it demonstrates, and a substantive interview talking point.
- Money is `DECIMAL(14,2)`; percentages are numbers in percent units; share deltas are in
  percentage points (`_pp`), matching Contract §2.

## Query catalogue

### 01_kpis.sql
- **Q01.1** — Six KPI cards with period-over-period deltas. *Multi-CTE chain, scalar subquery, SUM(CASE WHEN…) conditional aggregation, CASE growth guard, CROSS JOIN of single-row CTEs, INTERVAL date math.*
- **Q01.2** — 12-month revenue sparkline series. *GROUP BY on DATE_FORMAT bucket, scalar subquery window anchor, ORDER BY.*

### 02_revenue_trend.sql
- **Q02.1** — Monthly actual vs target revenue with MoM growth. *Two CTEs, LEFT JOIN, LAG() window, CASE, date bucketing.*
- **Q02.2** — Rolling 3-month average & cumulative running total. *Window frame AVG() ROWS BETWEEN 2 PRECEDING…, running SUM() UNBOUNDED PRECEDING, CTE.*
- **Q02.3** — Best/worst revenue month with next-month look-ahead. *CTE, RANK() asc & desc, LEAD(), filter-on-window via outer wrapper.*

### 03_therapeutic_areas.sql
- **Q03.1** — TA revenue, growth %, share-of-total. *Multi-CTE, INNER JOIN fact→drug→ta, conditional aggregation, SUM() OVER () for share, RANK.*
- **Q03.2** — Top drug per therapeutic area. *ROW_NUMBER() PARTITION BY ta (top-N-per-group), INNER JOIN chain, outer filter.*
- **Q03.3** — TAs above the data-derived average monthly revenue. *GROUP BY + HAVING against a scalar subquery threshold, INNER JOIN, date window.*

### 04_regional.sql
- **Q04.1** — Regional scorecard: revenue, growth, share, Rx, HCP & rep counts. *LEFT JOIN from region dimension, correlated scalar subqueries, conditional aggregation, RANK.*
- **Q04.2** — Region→City drill-down with share-within-region. *PARTITION BY region for share & AVG baseline, DENSE_RANK, CASE, INNER JOIN.*

### 05_products.sql
- **Q05.1** — Top products leaderboard (revenue, units, Rx, growth). *Multi-CTE, conditional aggregation, correlated subquery for Rx, DENSE_RANK, CASE.*
- **Q05.2** — Single-product monthly trend with MoM change. *Scalar subquery to pick the leader (no literal id), LAG window, CASE, INNER JOIN.*
- **Q05.3** — Price-band segmentation of the catalogue. *CASE bucketing in SELECT & GROUP BY, conditional aggregation, AVG discount.*

### 06_hcps.sql
- **Q06.1** — HCP performance directory. *LEFT JOIN across three facts, conditional aggregation, correlated subqueries for recency, DATEDIFF, CASE.*
- **Q06.2** — HCP prioritisation score (SRS §13 weights) with priority band. *Multi-CTE, PERCENT_RANK() percentiles, weighted CASE composition, DENSE_RANK.*
- **Q06.3** — HCP summary KPI cards. *CTE, conditional aggregation, correlated subquery denominators, ratio-to-percentage.*

### 07_sales_reps.sql
- **Q07.1** — Rep leaderboard: revenue, target, attainment %, visits, panel. *INNER JOIN, LEFT JOIN to fact, correlated subqueries, RANK, CASE guard.*
- **Q07.2** — Reps beating their region's average attainment. *Multi-CTE, correlated subquery over a peer CTE in WHERE, ratio metric.*
- **Q07.3** — Rep visit-effectiveness (outcome mix, revenue per visit). *Conditional aggregation over the outcome enum, correlated subquery, HAVING floor.*

### 08_competitors.sql
- **Q08.1** — Our share vs total competitor share per drug (latest month). *Conditional aggregation to split row types, INNER JOIN, CASE lead/behind.*
- **Q08.2** — Biggest share movers vs 6 months ago. *Multi-CTE, LAG(…,6) PARTITION BY drug, share-point delta, CASE direction.*
- **Q08.3** — Top competitor threat per therapeutic area vs our TA share. *Multi-CTE, INNER JOIN chain to competitors, ROW_NUMBER per TA, correlated subquery, CASE.*

### 09_inventory.sql
- **Q09.1** — Current stock position, months-of-cover, risk flag. *Scalar subquery for latest month, INNER JOIN, NULLIF guard, CASE risk banding.*
- **Q09.2** — At-risk ranking: worst cover per drug. *CTE, ROW_NUMBER PARTITION BY drug + global RANK from one scan, CASE, outer filter.*
- **Q09.3** — Stockout-day MoM deterioration trend. *Multi-CTE, LAG() PARTITION BY drug, CASE deterioration flag, HAVING.*

### 10_root_cause.sql
- **Q10.1** — Revenue change decomposed into five contributors. *9-CTE chain (one per contributor), conditional aggregation across three facts, INNER/LEFT JOIN, normalised contribution % via SUM() OVER (), CASE direction.*
- **Q10.2** — Anomaly detection via trailing z-score. *Multi-CTE, AVG & STDDEV_POP OVER a trailing ROWS frame (excludes current month), z-score, CASE severity banding.*
- **Q10.3** — New- vs repeat-patient revenue mix shift. *Conditional aggregation on `is_new_patient`, INNER JOIN drug→ta, YoY share via two conditional windows, NULLIF, CASE.*

## Verification

```bash
cd database/queries
./run_all.sh
```

`run_all.sh` explodes each `.sql` file into individual statements (splitting in Python —
BSD awk on macOS does not emit a real NUL for `\0`, which silently breaks a
`read -d ''` loop), runs each against the live DB, and reports **pass/fail per query**.
A query passes only if it runs without error **and** returns ≥1 row. Current status:

```
SUMMARY: 28 queries — 28 passed, 0 failed.
ALL QUERIES PASS ✓
```

### Technique coverage (grep-verified across the files)

`SELECT`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `INNER JOIN`, `LEFT JOIN`, `CASE`,
scalar **and** correlated subqueries, CTEs (incl. multi-CTE chains up to 9 CTEs in
`10_root_cause.sql`), window functions **RANK / DENSE_RANK / ROW_NUMBER / LAG / LEAD**,
`PARTITION BY`, date functions (`DATE_FORMAT`, `DATEDIFF`, `INTERVAL`), and conditional
aggregation (`SUM(CASE WHEN …)`) — all present.

## Data notes discovered during verification

- `hcp_scores` is empty (populated by the ML service); the HCP prioritisation in `06`
  computes the SRS §13-weighted score directly from facts so the library stands alone.
- `market_share` is a WIDE table: exactly one row per (drug, region, month), with
  `our_share_pct` populated on EVERY row and `competitor_drug_id` /
  `competitor_share_pct` populated only for the 28 drugs that have a tracked rival.
  `WHERE competitor_drug_id IS NULL` therefore selects the 10 rival-less drugs, NOT
  "our share rows" — building a share KPI on that filter under-reports company share
  (6.0% instead of the correct 8.9%). Read `our_share_pct` with no competitor filter.

## Connection

```bash
export PATH="/opt/homebrew/opt/mysql/bin:$PATH"
mysql --socket=/opt/homebrew/var/mysql/pharmazs.sock -u root -D pharmazs -e "<sql>"
```

Isolated Homebrew MySQL 26.7 on the `pharmazs.sock` socket (port 3307) — **not** the
system MySQL on 3306.
