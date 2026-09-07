-- ============================================================================
-- 07_sales_reps.sql — Sales rep leaderboard, target attainment, activity
-- SRS §14 (sales reps), Contract §5 GET /api/reps, /api/reps/:id
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Q07.1 — Rep leaderboard: revenue, target, attainment %, visits, panel size
-- Business question: Ranked by trailing-12-month revenue, how is each rep doing
--   against target, how active are they, and how large is their HCP panel?
-- Serves: SRS §14 / GET /api/reps leaderboard.
-- Techniques: INNER JOIN rep→region, LEFT JOIN to sales fact, correlated
--   subqueries for target sum / visits / panel size, RANK window, CASE, HAVING
--   is avoided in favour of GROUP BY + window rank, ORDER BY.
-- Talking point: attainment divides trailing revenue by the SUM of monthly
--   rep_targets over the same window, so a rep with sparse target rows is handled
--   correctly; RANK() OVER (ORDER BY revenue DESC) gives the leaderboard position
--   in the same pass.
-- ----------------------------------------------------------------------------
WITH cur AS (SELECT MAX(sale_date) - INTERVAL 12 MONTH AS cur_start FROM sales)
SELECT
    sr.rep_id, sr.rep_code, sr.full_name, r.region_name,
    ROUND(COALESCE(SUM(s.revenue), 0), 2) AS revenue,
    (SELECT ROUND(SUM(rt.target_revenue), 2) FROM rep_targets rt
      WHERE rt.rep_id = sr.rep_id
        AND rt.period_month > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)) AS target,
    CASE WHEN (SELECT SUM(rt.target_revenue) FROM rep_targets rt
                WHERE rt.rep_id = sr.rep_id
                  AND rt.period_month > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)) IN (0, NULL)
         THEN NULL
         ELSE ROUND(100 * COALESCE(SUM(s.revenue), 0) /
             (SELECT SUM(rt.target_revenue) FROM rep_targets rt
               WHERE rt.rep_id = sr.rep_id
                 AND rt.period_month > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)), 1)
    END AS achievement_pct,
    (SELECT COUNT(*) FROM visits v WHERE v.rep_id = sr.rep_id
        AND v.visit_date > c.cur_start)                                        AS visits,
    (SELECT COUNT(*) FROM rep_hcp_assignments a
       WHERE a.rep_id = sr.rep_id AND a.assigned_to IS NULL)                   AS hcp_count,
    RANK() OVER (ORDER BY COALESCE(SUM(s.revenue), 0) DESC)                    AS `rank`
FROM sales_reps sr
INNER JOIN regions r ON r.region_id = sr.region_id
CROSS JOIN cur c
LEFT JOIN sales s ON s.rep_id = sr.rep_id AND s.sale_date > c.cur_start
WHERE sr.is_active = 1
GROUP BY sr.rep_id, sr.rep_code, sr.full_name, r.region_name, c.cur_start
ORDER BY revenue DESC
LIMIT 25;

-- ----------------------------------------------------------------------------
-- Q07.2 — Reps beating their region's average attainment (HAVING + subquery)
-- Business question: Which reps are outperforming the *average* attainment of
--   their own region — i.e. relative overperformers, not just absolute leaders?
-- Serves: SRS §14 (relative performance, manager scoping).
-- Techniques: multi-CTE, correlated subquery over a peer CTE in WHERE, INNER
--   JOIN, ratio metric, CASE guard, ORDER BY.
-- Talking point: each rep is compared to a correlated subquery that averages
--   attainment across ONLY that rep's own region (a2.region_id = a.region_id).
--   That is the honest way to ask "above average for their context" rather than
--   "above the global average", which would just re-list the biggest regions'
--   reps. (HAVING is demonstrated in Q03.3 and Q07.3.)
-- ----------------------------------------------------------------------------
WITH rep_perf AS (
    SELECT
        sr.rep_id, sr.full_name, sr.region_id,
        COALESCE(SUM(s.revenue), 0) AS revenue,
        (SELECT SUM(rt.target_revenue) FROM rep_targets rt
          WHERE rt.rep_id = sr.rep_id
            AND rt.period_month > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)) AS target
    FROM sales_reps sr
    LEFT JOIN sales s ON s.rep_id = sr.rep_id
        AND s.sale_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)
    WHERE sr.is_active = 1
    GROUP BY sr.rep_id, sr.full_name, sr.region_id
),
attain AS (
    SELECT rep_id, full_name, region_id,
           CASE WHEN target IN (0, NULL) THEN NULL ELSE 100 * revenue / target END AS attainment_pct
    FROM rep_perf
)
SELECT a.rep_id, a.full_name, a.region_id, ROUND(a.attainment_pct, 1) AS attainment_pct
FROM attain a
WHERE a.attainment_pct IS NOT NULL
  AND a.attainment_pct > (
      SELECT AVG(a2.attainment_pct) FROM attain a2 WHERE a2.region_id = a.region_id
  )
ORDER BY a.attainment_pct DESC;

-- ----------------------------------------------------------------------------
-- Q07.3 — Rep visit-effectiveness: outcome mix and revenue per visit
-- Business question: Beyond raw activity, how effective is each rep's field work
--   — what share of visits land POSITIVE, and how much revenue per visit?
-- Serves: SRS §14 (activity quality, not just quantity).
-- Techniques: INNER JOIN rep→visits, conditional aggregation over the outcome
--   enum, correlated subquery for revenue, ratio, ORDER BY, HAVING on min volume.
-- Talking point: SUM(CASE WHEN outcome='POSITIVE' ...) / COUNT(*) turns an enum
--   column into a success-rate percentage; HAVING COUNT(*) >= a floor keeps a rep
--   with two lucky visits off the top of the effectiveness board.
-- ----------------------------------------------------------------------------
SELECT
    sr.rep_id, sr.full_name,
    COUNT(v.visit_id)                                                          AS total_visits,
    ROUND(100 * SUM(CASE WHEN v.outcome = 'POSITIVE' THEN 1 ELSE 0 END)
             / COUNT(v.visit_id), 1)                                           AS positive_rate_pct,
    SUM(v.samples_given)                                                       AS samples_given,
    (SELECT ROUND(COALESCE(SUM(s.revenue), 0), 2) FROM sales s
      WHERE s.rep_id = sr.rep_id
        AND s.sale_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)) AS revenue,
    ROUND((SELECT COALESCE(SUM(s.revenue), 0) FROM sales s
            WHERE s.rep_id = sr.rep_id
              AND s.sale_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales))
          / NULLIF(COUNT(v.visit_id), 0), 2)                                   AS revenue_per_visit
FROM sales_reps sr
INNER JOIN visits v ON v.rep_id = sr.rep_id
    AND v.visit_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)
WHERE sr.is_active = 1
GROUP BY sr.rep_id, sr.full_name
HAVING total_visits >= 10
ORDER BY revenue_per_visit DESC
LIMIT 25;
