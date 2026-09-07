-- ============================================================================
-- 05_products.sql — Product performance, ranking, trend and regional split
-- SRS §11 (products), Contract §5 GET /api/products, /top-products,
-- /products/:id/trend, /products/:id/regional
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Q05.1 — Top products leaderboard: revenue, units, Rx, growth, share
-- Business question: Which products are the clinical/commercial leaders right
--   now, ranked by trailing-12-month revenue, and how fast is each growing?
-- Serves: SRS §11 / GET /api/dashboard/top-products.
-- Techniques: multi-CTE, INNER JOIN fact→drug→ta, conditional aggregation,
--   correlated scalar subquery for Rx count, DENSE_RANK, CASE growth guard.
-- Talking point: revenue, units and both period windows come from a single scan
--   via SUM(CASE WHEN ...); only the Rx count (a different fact table) is pulled
--   with a correlated subquery, keeping the join graph free of a fan-out that
--   would double-count sales rows.
-- ----------------------------------------------------------------------------
WITH bounds AS (
    SELECT MAX(sale_date) - INTERVAL 12 MONTH AS cur_start,
           MAX(sale_date) - INTERVAL 24 MONTH AS prev_start FROM sales
),
prod AS (
    SELECT
        d.drug_id, d.drug_name, ta.ta_name,
        SUM(CASE WHEN s.sale_date > b.cur_start THEN s.revenue ELSE 0 END)    AS cur_rev,
        SUM(CASE WHEN s.sale_date <= b.cur_start AND s.sale_date > b.prev_start
                 THEN s.revenue ELSE 0 END)                                   AS prev_rev,
        SUM(CASE WHEN s.sale_date > b.cur_start THEN s.units_sold ELSE 0 END) AS cur_units
    FROM sales s
    INNER JOIN drugs d              ON d.drug_id = s.drug_id
    INNER JOIN therapeutic_areas ta ON ta.ta_id = d.ta_id
    CROSS JOIN bounds b
    WHERE s.sale_date > b.prev_start
    GROUP BY d.drug_id, d.drug_name, ta.ta_name
)
SELECT
    DENSE_RANK() OVER (ORDER BY cur_rev DESC) AS `rank`,
    drug_id, drug_name, ta_name,
    ROUND(cur_rev, 2)   AS revenue,
    cur_units           AS units,
    (SELECT COUNT(*) FROM prescriptions p
      WHERE p.drug_id = prod.drug_id
        AND p.prescription_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)) AS prescriptions,
    CASE WHEN prev_rev = 0 THEN NULL
         ELSE ROUND(100 * (cur_rev - prev_rev) / prev_rev, 1) END AS growth_pct
FROM prod
ORDER BY cur_rev DESC
LIMIT 10;

-- ----------------------------------------------------------------------------
-- Q05.2 — Single-product monthly trend with MoM change (parameter-free demo)
-- Business question: For the current #1 product, what does its monthly revenue
--   and unit trajectory look like, with month-over-month movement?
-- Serves: SRS §11 / GET /api/products/:id/trend.
-- Techniques: scalar subquery to pick the leading drug (so no drug_id literal),
--   INNER JOIN, LAG window, CASE, GROUP BY, date bucketing.
-- Talking point: the product is chosen by a scalar subquery rather than hardcoded
--   — the app substitutes :drugId, but the library itself is self-contained and
--   still runs standalone against whatever the current top seller is.
-- ----------------------------------------------------------------------------
WITH top_drug AS (
    SELECT s.drug_id
    FROM sales s
    WHERE s.sale_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)
    GROUP BY s.drug_id
    ORDER BY SUM(s.revenue) DESC
    LIMIT 1
),
monthly AS (
    SELECT DATE_FORMAT(s.sale_date, '%Y-%m-01') AS period,
           SUM(s.revenue) AS revenue, SUM(s.units_sold) AS units
    FROM sales s
    INNER JOIN top_drug td ON td.drug_id = s.drug_id
    WHERE s.sale_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)
    GROUP BY DATE_FORMAT(s.sale_date, '%Y-%m-01')
)
SELECT
    DATE_FORMAT(period, '%Y-%m') AS period,
    ROUND(revenue, 2) AS revenue,
    units,
    CASE WHEN LAG(revenue) OVER (ORDER BY period) IS NULL THEN NULL
         ELSE ROUND(100 * (revenue - LAG(revenue) OVER (ORDER BY period))
                        / LAG(revenue) OVER (ORDER BY period), 1) END AS mom_growth_pct
FROM monthly
ORDER BY period;

-- ----------------------------------------------------------------------------
-- Q05.3 — Price-band segmentation of the catalogue (CASE bucketing)
-- Business question: How does the product catalogue split across price bands,
--   and what revenue and average discount does each band contribute?
-- Serves: SRS §11 (pricing analysis) / product portfolio view.
-- Techniques: CASE-defined buckets in both SELECT and GROUP BY, INNER JOIN,
--   conditional aggregation, AVG of a discount, ORDER BY on a derived band order.
-- Talking point: bucketing on d.unit_price via CASE turns a continuous price into
--   a categorical band, and grouping by the SAME expression keeps the buckets
--   coherent — a classic "segment a continuous measure" pattern.
-- ----------------------------------------------------------------------------
SELECT
    CASE
        WHEN d.unit_price < 50   THEN '1_UNDER_50'
        WHEN d.unit_price < 150  THEN '2_50_TO_150'
        WHEN d.unit_price < 400  THEN '3_150_TO_400'
        ELSE '4_400_PLUS'
    END AS price_band,
    COUNT(DISTINCT d.drug_id)          AS products,
    ROUND(SUM(s.revenue), 2)           AS revenue,
    SUM(s.units_sold)                  AS units,
    ROUND(AVG(s.discount_pct), 2)      AS avg_discount_pct
FROM sales s
INNER JOIN drugs d ON d.drug_id = s.drug_id
WHERE s.sale_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)
GROUP BY price_band
ORDER BY price_band;
