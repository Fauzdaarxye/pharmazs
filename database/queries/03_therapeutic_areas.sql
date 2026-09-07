-- ============================================================================
-- 03_therapeutic_areas.sql — Therapeutic-area performance & contribution matrix
-- SRS §7 (TA performance), Contract §5 GET /api/dashboard/therapeutic-areas
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Q03.1 — TA revenue, growth %, and share of total (contribution matrix)
-- Business question: Which therapeutic areas drive revenue, how fast is each
--   growing YoY, and what fraction of the company total does each represent?
-- Serves: SRS §7 TA performance panel (name, revenue, growth %, progress bar).
-- Techniques: multi-CTE chain, INNER JOIN fact→drug→ta, conditional aggregation
--   (current vs prior 12m in one pass), window SUM() OVER () for share-of-total,
--   CASE growth guard, ORDER BY.
-- Talking point: share-of-total uses SUM(revenue) OVER () — an empty OVER()
--   partitions across ALL rows, giving each TA's slice of the whole without a
--   second aggregate query or a self-join to a grand total.
-- ----------------------------------------------------------------------------
WITH bounds AS (
    SELECT MAX(sale_date) AS max_d,
           MAX(sale_date) - INTERVAL 12 MONTH AS cur_start,
           MAX(sale_date) - INTERVAL 24 MONTH AS prev_start
    FROM sales
),
ta_rev AS (
    SELECT
        ta.ta_id,
        ta.ta_name,
        SUM(CASE WHEN s.sale_date > b.cur_start THEN s.revenue ELSE 0 END)  AS cur_rev,
        SUM(CASE WHEN s.sale_date <= b.cur_start
                  AND s.sale_date > b.prev_start THEN s.revenue ELSE 0 END) AS prev_rev
    FROM sales s
    INNER JOIN drugs d            ON d.drug_id = s.drug_id
    INNER JOIN therapeutic_areas ta ON ta.ta_id = d.ta_id
    CROSS JOIN bounds b
    WHERE s.sale_date > b.prev_start
    GROUP BY ta.ta_id, ta.ta_name
)
SELECT
    ta_id,
    ta_name,
    ROUND(cur_rev, 2) AS revenue,
    CASE WHEN prev_rev = 0 THEN NULL
         ELSE ROUND(100 * (cur_rev - prev_rev) / prev_rev, 1) END AS growth_pct,
    ROUND(100 * cur_rev / SUM(cur_rev) OVER (), 1)               AS share_pct,
    RANK() OVER (ORDER BY cur_rev DESC)                          AS revenue_rank
FROM ta_rev
ORDER BY revenue DESC;

-- ----------------------------------------------------------------------------
-- Q03.2 — Top drug within each therapeutic area (partitioned ranking)
-- Business question: For each therapeutic area, which single product is the
--   commercial leader in the trailing 12 months?
-- Serves: SRS §9/§11 (product leadership within a TA).
-- Techniques: CTE, ROW_NUMBER() OVER (PARTITION BY ta ORDER BY revenue DESC),
--   INNER JOIN chain, outer filter on the ranked column.
-- Talking point: ROW_NUMBER over a PARTITION BY ta_id is the "top-N-per-group"
--   workhorse — one pass, no correlated subquery. ROW_NUMBER (not RANK) is
--   deliberate so a tie still yields exactly one leader per area.
-- ----------------------------------------------------------------------------
WITH drug_rev AS (
    SELECT
        ta.ta_id, ta.ta_name, d.drug_id, d.drug_name,
        SUM(s.revenue) AS revenue,
        ROW_NUMBER() OVER (PARTITION BY ta.ta_id ORDER BY SUM(s.revenue) DESC) AS rn
    FROM sales s
    INNER JOIN drugs d              ON d.drug_id = s.drug_id
    INNER JOIN therapeutic_areas ta ON ta.ta_id = d.ta_id
    WHERE s.sale_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)
    GROUP BY ta.ta_id, ta.ta_name, d.drug_id, d.drug_name
)
SELECT ta_id, ta_name, drug_id, drug_name, ROUND(revenue, 2) AS revenue
FROM drug_rev
WHERE rn = 1
ORDER BY revenue DESC;

-- ----------------------------------------------------------------------------
-- Q03.3 — TAs whose average monthly revenue clears a data-derived threshold
-- Business question: Which therapeutic areas are "material" — i.e. average more
--   per month than the company-wide per-TA average monthly revenue?
-- Serves: SRS §7 (materiality filtering for the TA panel).
-- Techniques: GROUP BY + HAVING against a correlated/scalar subquery threshold,
--   INNER JOIN, date window, no hardcoded cutoff.
-- Talking point: the HAVING threshold is itself a subquery over the same data,
--   so "material" is defined relative to the dataset rather than a magic number
--   — the query stays correct after a reseed that changes the revenue scale.
-- ----------------------------------------------------------------------------
SELECT
    ta.ta_id,
    ta.ta_name,
    ROUND(SUM(s.revenue) / COUNT(DISTINCT DATE_FORMAT(s.sale_date, '%Y-%m')), 2) AS avg_monthly_revenue
FROM sales s
INNER JOIN drugs d              ON d.drug_id = s.drug_id
INNER JOIN therapeutic_areas ta ON ta.ta_id = d.ta_id
WHERE s.sale_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)
GROUP BY ta.ta_id, ta.ta_name
HAVING avg_monthly_revenue > (
    SELECT SUM(s2.revenue) / (COUNT(DISTINCT s2.drug_id) * 12)
    FROM sales s2
    WHERE s2.sale_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)
)
ORDER BY avg_monthly_revenue DESC;
