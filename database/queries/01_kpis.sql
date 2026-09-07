-- ============================================================================
-- 01_kpis.sql — Dashboard headline KPI cards
-- SRS §7 (dashboard KPIs), Contract §5 GET /api/dashboard/kpis
-- All windows are derived from (SELECT MAX(sale_date) FROM sales); no date
-- literal appears anywhere in this file, so the library survives a reseed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Q01.1 — Six KPI cards with period-over-period deltas
-- Business question: What are the six headline numbers on the dashboard, and
--   how does each compare to the equivalent prior 12-month window?
-- Serves: SRS §7 / GET /api/dashboard/kpis
-- Techniques: multi-CTE chain, scalar subquery (anchor date), conditional
--   aggregation with SUM(CASE WHEN ...), CASE for growth %, INNER JOIN of two
--   single-row CTEs, date arithmetic (INTERVAL).
-- Talking point: the "current vs prior" split is done in ONE pass over the fact
--   table using SUM(CASE WHEN ...) rather than two separate scans — the whole
--   KPI strip is a single index range on idx_sale_date. Growth is guarded
--   against a zero prior period so a newly launched slice never divides by 0.
-- ----------------------------------------------------------------------------
WITH anchor AS (
    SELECT MAX(sale_date) AS max_d FROM sales
),
bounds AS (
    SELECT
        max_d,
        max_d - INTERVAL 12 MONTH AS cur_start,       -- last 12 months
        max_d - INTERVAL 24 MONTH AS prev_start       -- the 12 months before that
    FROM anchor
),
rev AS (
    SELECT
        SUM(CASE WHEN s.sale_date >  b.cur_start  THEN s.revenue ELSE 0 END) AS cur_rev,
        SUM(CASE WHEN s.sale_date <= b.cur_start
                  AND s.sale_date >  b.prev_start THEN s.revenue ELSE 0 END) AS prev_rev,
        SUM(CASE WHEN s.sale_date >  b.cur_start  THEN s.units_sold ELSE 0 END) AS cur_units
    FROM sales s
    CROSS JOIN bounds b
    WHERE s.sale_date > b.prev_start
),
rx AS (
    SELECT COUNT(*) AS total_rx
    FROM prescriptions p
    CROSS JOIN bounds b
    WHERE p.prescription_date > b.cur_start
),
inv AS (   -- inventory availability = 1 - stockout_days share, latest month
    SELECT ROUND(100 * (1 - SUM(i.stockout_days) / (COUNT(*) * 30)), 1) AS avail_pct
    FROM inventory_snapshots i
    WHERE i.snapshot_month = (SELECT MAX(snapshot_month) FROM inventory_snapshots)
),
share AS (  -- company market share = avg of our_share_pct across all tracked cells
    -- NOTE: do NOT filter on `competitor_drug_id IS NULL` here. market_share is a
    -- WIDE table (one row per drug/region/month, our_share_pct always populated);
    -- that filter would restrict this KPI to the 10 drugs with no tracked rival
    -- and under-report company share across the other 28.
    SELECT ROUND(AVG(m.our_share_pct), 1) AS mkt_share_pct
    FROM market_share m
    WHERE m.period_month = (SELECT MAX(period_month) FROM market_share)
)
SELECT
    ROUND(rev.cur_rev, 2)                                            AS total_revenue,
    CASE WHEN rev.prev_rev = 0 THEN NULL
         ELSE ROUND(100 * (rev.cur_rev - rev.prev_rev) / rev.prev_rev, 1)
    END                                                             AS revenue_growth_pct,
    rx.total_rx                                                     AS total_prescriptions,
    (SELECT COUNT(*) FROM hcps WHERE is_active = 1)                 AS active_hcps,
    share.mkt_share_pct                                             AS market_share_pct,
    inv.avail_pct                                                   AS inventory_availability_pct,
    (SELECT COUNT(*) FROM drugs WHERE is_active = 1)                AS total_products,
    (SELECT COUNT(*) FROM sales_reps WHERE is_active = 1)           AS total_reps
FROM rev
CROSS JOIN rx
CROSS JOIN inv
CROSS JOIN share;

-- ----------------------------------------------------------------------------
-- Q01.2 — 12-month revenue sparkline series
-- Business question: What is the month-by-month revenue trace that backs the
--   Total Revenue KPI sparkline?
-- Serves: SRS §7 / kpis.sparklines.totalRevenue
-- Techniques: GROUP BY on a date-truncated expression, DATE_FORMAT, ORDER BY,
--   scalar subquery to anchor the 12-month window, WHERE range filter.
-- Talking point: DATE_FORMAT(..., '%Y-%m-01') buckets to the first of the month
--   so the group key is a real date the API can serialise, not a display string.
-- ----------------------------------------------------------------------------
SELECT
    DATE_FORMAT(s.sale_date, '%Y-%m') AS period,
    ROUND(SUM(s.revenue), 2)          AS revenue,
    SUM(s.units_sold)                 AS units
FROM sales s
WHERE s.sale_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)
GROUP BY DATE_FORMAT(s.sale_date, '%Y-%m')
ORDER BY period;
