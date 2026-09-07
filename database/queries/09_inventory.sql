-- ============================================================================
-- 09_inventory.sql — Stock cover, stockout risk, at-risk view
-- SRS §25 (inventory contributor), Contract §5 GET /api/inventory, /at-risk
-- inventory_snapshots is a monthly stock snapshot per (drug, region).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Q09.1 — Current inventory position with months-of-cover and risk flag
-- Business question: For each drug×region, what is closing stock this month, how
--   many months of cover does it represent given recent outflow, and is it at risk?
-- Serves: SRS §25 / GET /api/inventory rows.
-- Techniques: scalar subquery for latest month, INNER JOIN inventory→drug→region,
--   months-of-cover ratio with NULLIF guard, CASE risk banding, ORDER BY. No
--   SELECT * — only the columns the card needs.
-- Talking point: months-of-cover = closing_stock / units_out with NULLIF on the
--   denominator so a zero-outflow row yields NULL (infinite cover) instead of a
--   divide-by-zero. Risk banding is a single CASE the UI maps straight to a pill.
-- ----------------------------------------------------------------------------
WITH latest AS (SELECT MAX(snapshot_month) AS m FROM inventory_snapshots)
SELECT
    d.drug_name, r.region_name,
    i.closing_stock,
    i.units_out                                            AS monthly_outflow,
    i.stockout_days,
    ROUND(i.closing_stock / NULLIF(i.units_out, 0), 1)     AS months_of_cover,
    CASE
        WHEN i.stockout_days > 0                                   THEN 'STOCKOUT'
        WHEN i.closing_stock / NULLIF(i.units_out, 0) < 1          THEN 'HIGH_RISK'
        WHEN i.closing_stock / NULLIF(i.units_out, 0) < 2          THEN 'WATCH'
        ELSE 'HEALTHY'
    END AS risk_flag
FROM inventory_snapshots i
INNER JOIN drugs   d ON d.drug_id   = i.drug_id
INNER JOIN regions r ON r.region_id = i.region_id
CROSS JOIN latest l
WHERE i.snapshot_month = l.m
ORDER BY months_of_cover ASC
LIMIT 30;

-- ----------------------------------------------------------------------------
-- Q09.2 — At-risk ranking: worst cover per drug across regions (partitioned rank)
-- Business question: Which drug×region combinations are the most exposed to a
--   stockout right now, ranked worst-first, and how does each rank within its drug?
-- Serves: SRS §25 / GET /api/inventory/at-risk.
-- Techniques: CTE, ROW_NUMBER() PARTITION BY drug ORDER BY cover ASC, global
--   RANK for the overall board, CASE, outer WHERE on the derived cover value.
-- Talking point: two window functions from one scan — a per-drug ROW_NUMBER
--   (which region of this drug is worst) and a global RANK (where this sits on
--   the company-wide risk board) — so the UI can show both "worst in its line"
--   and "top-N overall" without re-querying.
-- ----------------------------------------------------------------------------
WITH latest AS (SELECT MAX(snapshot_month) AS m FROM inventory_snapshots),
cover AS (
    SELECT
        i.drug_id, i.region_id, i.closing_stock, i.units_out, i.stockout_days,
        i.closing_stock / NULLIF(i.units_out, 0) AS moc
    FROM inventory_snapshots i
    CROSS JOIN latest l
    WHERE i.snapshot_month = l.m
)
SELECT
    d.drug_name, r.region_name,
    c.closing_stock, c.stockout_days,
    ROUND(c.moc, 2)                                                    AS months_of_cover,
    ROW_NUMBER() OVER (PARTITION BY c.drug_id ORDER BY c.moc ASC)      AS worst_region_for_drug,
    RANK()       OVER (ORDER BY c.moc ASC)                             AS overall_risk_rank
FROM cover c
INNER JOIN drugs   d ON d.drug_id   = c.drug_id
INNER JOIN regions r ON r.region_id = c.region_id
WHERE c.moc IS NOT NULL AND c.moc < 2
ORDER BY c.moc ASC
LIMIT 25;

-- ----------------------------------------------------------------------------
-- Q09.3 — Stockout-day trend per drug (LAG month-over-month deterioration)
-- Business question: For drugs with recent stockouts, are stockout days getting
--   worse month over month — an early supply-chain warning?
-- Serves: SRS §25 (inventory deterioration feeding alerts).
-- Techniques: multi-CTE, aggregation to drug×month, LAG() PARTITION BY drug,
--   CASE deterioration flag, HAVING on total stockouts, ORDER BY.
-- Talking point: LAG(stockout_days) PARTITION BY drug ORDER BY month surfaces a
--   worsening trajectory directly; HAVING filters to drugs that actually stocked
--   out at all, so the alert list is not padded with permanently-healthy lines.
-- ----------------------------------------------------------------------------
WITH by_month AS (
    SELECT i.drug_id, i.snapshot_month, SUM(i.stockout_days) AS stockout_days
    FROM inventory_snapshots i
    WHERE i.snapshot_month > (SELECT MAX(snapshot_month) - INTERVAL 6 MONTH FROM inventory_snapshots)
    GROUP BY i.drug_id, i.snapshot_month
    HAVING stockout_days >= 0
),
trend AS (
    SELECT drug_id, snapshot_month, stockout_days,
           LAG(stockout_days) OVER (PARTITION BY drug_id ORDER BY snapshot_month) AS prev_stockout_days
    FROM by_month
)
SELECT
    d.drug_name,
    DATE_FORMAT(t.snapshot_month, '%Y-%m') AS month,
    t.stockout_days,
    t.prev_stockout_days,
    CASE WHEN t.prev_stockout_days IS NULL THEN 'NO_PRIOR'
         WHEN t.stockout_days > t.prev_stockout_days THEN 'WORSENING'
         WHEN t.stockout_days < t.prev_stockout_days THEN 'IMPROVING'
         ELSE 'FLAT' END AS trend
FROM trend t
INNER JOIN drugs d ON d.drug_id = t.drug_id
WHERE t.snapshot_month = (SELECT MAX(snapshot_month) FROM inventory_snapshots)
  AND t.stockout_days > 0
ORDER BY t.stockout_days DESC
LIMIT 20;
