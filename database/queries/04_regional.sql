-- ============================================================================
-- 04_regional.sql — Regional performance comparison & drill-down
-- SRS §15 (regions), Contract §5 GET /api/dashboard/regional-performance,
-- GET /api/regions, GET /api/regions/:id/drilldown
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Q04.1 — Regional scorecard: revenue, growth, share, Rx, HCP & rep counts
-- Business question: How do the five regions compare on revenue, growth, market
--   share, prescription volume, and field coverage (HCPs and reps)?
-- Serves: SRS §15 / regional-performance cards + StatTiles.
-- Techniques: LEFT JOIN from the region dimension (so a region with no sales
--   still appears), correlated scalar subqueries for counts, conditional
--   aggregation for current-vs-prior, CASE growth guard, RANK, ORDER BY.
-- Talking point: driving from regions with LEFT JOIN guarantees all five rows
--   even at zero activity — the opposite of driving from the fact, which would
--   silently drop a dark region. The HCP/rep counts are correlated subqueries
--   so they are not inflated by the sales fan-out.
-- ----------------------------------------------------------------------------
WITH bounds AS (
    SELECT MAX(sale_date) - INTERVAL 12 MONTH AS cur_start,
           MAX(sale_date) - INTERVAL 24 MONTH AS prev_start
    FROM sales
)
SELECT
    r.region_id,
    r.region_name,
    ROUND(SUM(CASE WHEN s.sale_date > b.cur_start THEN s.revenue ELSE 0 END), 2) AS revenue,
    CASE WHEN SUM(CASE WHEN s.sale_date <= b.cur_start AND s.sale_date > b.prev_start
                       THEN s.revenue ELSE 0 END) = 0 THEN NULL
         ELSE ROUND(100 *
              (SUM(CASE WHEN s.sale_date > b.cur_start THEN s.revenue ELSE 0 END)
             - SUM(CASE WHEN s.sale_date <= b.cur_start AND s.sale_date > b.prev_start THEN s.revenue ELSE 0 END))
            / SUM(CASE WHEN s.sale_date <= b.cur_start AND s.sale_date > b.prev_start THEN s.revenue ELSE 0 END), 1)
    END AS growth_pct,
    (SELECT ROUND(AVG(m.our_share_pct), 1) FROM market_share m
      WHERE m.region_id = r.region_id
        AND m.period_month = (SELECT MAX(period_month) FROM market_share)) AS market_share_pct,
    (SELECT COUNT(*) FROM prescriptions p
      WHERE p.region_id = r.region_id
        AND p.prescription_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)) AS prescriptions,
    (SELECT COUNT(*) FROM hcps h  WHERE h.region_id = r.region_id AND h.is_active = 1)     AS hcp_count,
    (SELECT COUNT(*) FROM sales_reps sr WHERE sr.region_id = r.region_id AND sr.is_active = 1) AS rep_count,
    RANK() OVER (ORDER BY SUM(CASE WHEN s.sale_date > b.cur_start THEN s.revenue ELSE 0 END) DESC) AS revenue_rank
FROM regions r
CROSS JOIN bounds b
LEFT JOIN sales s ON s.region_id = r.region_id AND s.sale_date > b.prev_start
GROUP BY r.region_id, r.region_name
ORDER BY revenue DESC;

-- ----------------------------------------------------------------------------
-- Q04.2 — Region → City drill-down: revenue and share within one region's cities
-- Business question: Inside a region, which cities carry the revenue and how is
--   each city trending against the region's own average?
-- Serves: SRS §15 drill-down (Region → City level).
-- Techniques: INNER JOIN fact→city, PARTITION BY region for share-within-region,
--   window AVG for the region baseline, CASE for above/below flag, ORDER BY.
-- Talking point: PARTITION BY region_id makes every window figure "within this
--   region", so the same query serves the drill-down for ANY region without a
--   hardcoded region_id — the API just filters the output (or adds a WHERE).
-- ----------------------------------------------------------------------------
WITH city_rev AS (
    SELECT
        r.region_id, r.region_name, c.city_id, c.city_name, c.tier,
        SUM(s.revenue) AS revenue
    FROM sales s
    INNER JOIN cities  c ON c.city_id   = s.city_id
    INNER JOIN regions r ON r.region_id = c.region_id
    WHERE s.sale_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)
    GROUP BY r.region_id, r.region_name, c.city_id, c.city_name, c.tier
)
SELECT
    region_id, region_name, city_id, city_name, tier,
    ROUND(revenue, 2) AS revenue,
    ROUND(100 * revenue / SUM(revenue) OVER (PARTITION BY region_id), 1) AS pct_of_region,
    DENSE_RANK() OVER (PARTITION BY region_id ORDER BY revenue DESC)     AS rank_in_region,
    CASE WHEN revenue >= AVG(revenue) OVER (PARTITION BY region_id)
         THEN 'ABOVE_REGION_AVG' ELSE 'BELOW_REGION_AVG' END            AS vs_region_avg
FROM city_rev
ORDER BY region_id, revenue DESC;
