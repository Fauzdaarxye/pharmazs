-- ============================================================================
-- 02_revenue_trend.sql — Revenue performance vs target, over time
-- SRS §7 (revenue performance chart), Contract §5 GET /api/dashboard/revenue-trend
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Q02.1 — Monthly actual revenue vs monthly target, with MoM growth (LAG)
-- Business question: How is monthly revenue tracking against the summed rep
--   targets, and what is the month-over-month change?
-- Serves: SRS §7 revenue chart (blue actual line + green dashed target line)
-- Techniques: two CTEs joined with LEFT JOIN (targets may be sparse), LAG()
--   window function, CASE for MoM %, date bucketing, ORDER BY.
-- Talking point: LAG(revenue) OVER (ORDER BY period) gives the previous month
--   in the same row so the MoM delta needs no self-join. LEFT JOIN keeps a month
--   visible even if no target was set for it, which is exactly what the chart
--   needs — a missing target must not drop the actual bar.
-- ----------------------------------------------------------------------------
WITH monthly_actual AS (
    SELECT DATE_FORMAT(s.sale_date, '%Y-%m-01') AS period,
           SUM(s.revenue) AS revenue,
           SUM(s.units_sold) AS units
    FROM sales s
    WHERE s.sale_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)
    GROUP BY DATE_FORMAT(s.sale_date, '%Y-%m-01')
),
monthly_target AS (
    SELECT period_month AS period, SUM(target_revenue) AS target
    FROM rep_targets
    GROUP BY period_month
)
SELECT
    DATE_FORMAT(a.period, '%Y-%m') AS period,
    ROUND(a.revenue, 2)            AS revenue,
    ROUND(t.target, 2)             AS target,
    a.units                        AS units,
    ROUND(LAG(a.revenue) OVER (ORDER BY a.period), 2) AS prev_month_revenue,
    CASE
        WHEN LAG(a.revenue) OVER (ORDER BY a.period) IS NULL THEN NULL
        ELSE ROUND(100 * (a.revenue - LAG(a.revenue) OVER (ORDER BY a.period))
                       / LAG(a.revenue) OVER (ORDER BY a.period), 1)
    END AS mom_growth_pct,
    CASE WHEN t.target IS NULL OR t.target = 0 THEN NULL
         ELSE ROUND(100 * a.revenue / t.target, 1)
    END AS target_attainment_pct
FROM monthly_actual a
LEFT JOIN monthly_target t ON t.period = a.period
ORDER BY a.period;

-- ----------------------------------------------------------------------------
-- Q02.2 — Rolling 3-month average revenue and cumulative YTD-style running total
-- Business question: Smoothing out monthly noise, what is the underlying revenue
--   trajectory and the running cumulative total across the trailing window?
-- Serves: SRS §7 (trend smoothing) / analytics support for §23 forecasting.
-- Techniques: window frame AVG() OVER (ROWS BETWEEN 2 PRECEDING AND CURRENT ROW),
--   running SUM() OVER (... UNBOUNDED PRECEDING), CTE, ORDER BY.
-- Talking point: the explicit ROWS frame is the point here — a default RANGE
--   frame would collapse ties and give the wrong rolling average. This is the
--   difference between "3 rows" and "3 date-values" that trips people up in
--   interviews.
-- ----------------------------------------------------------------------------
WITH monthly AS (
    SELECT DATE_FORMAT(s.sale_date, '%Y-%m-01') AS period,
           SUM(s.revenue) AS revenue
    FROM sales s
    WHERE s.sale_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)
    GROUP BY DATE_FORMAT(s.sale_date, '%Y-%m-01')
)
SELECT
    DATE_FORMAT(period, '%Y-%m') AS period,
    ROUND(revenue, 2)            AS revenue,
    ROUND(AVG(revenue) OVER (ORDER BY period
                             ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS rolling_3m_avg,
    ROUND(SUM(revenue) OVER (ORDER BY period
                             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2) AS cumulative_revenue
FROM monthly
ORDER BY period;

-- ----------------------------------------------------------------------------
-- Q02.3 — Best and worst revenue month in the trailing year (LEAD look-ahead)
-- Business question: Which month peaked, which troughed, and what happened the
--   month after each — did a spike hold or immediately give back?
-- Serves: SRS §7 / anomaly narrative support (§25).
-- Techniques: CTE, RANK() over descending revenue, LEAD() look-ahead, WHERE on
--   a window result via an outer wrapper, ORDER BY.
-- Talking point: window functions cannot appear in WHERE, so the RANK is computed
--   in an inner query and filtered in the outer one — the canonical "filter on a
--   window function" pattern. LEAD shows the following month's revenue on the
--   same row so we can see whether a peak sustained.
-- ----------------------------------------------------------------------------
WITH monthly AS (
    SELECT DATE_FORMAT(s.sale_date, '%Y-%m-01') AS period,
           SUM(s.revenue) AS revenue
    FROM sales s
    WHERE s.sale_date > (SELECT MAX(sale_date) - INTERVAL 12 MONTH FROM sales)
    GROUP BY DATE_FORMAT(s.sale_date, '%Y-%m-01')
),
ranked AS (
    SELECT period, revenue,
           RANK() OVER (ORDER BY revenue DESC) AS rev_rank_high,
           RANK() OVER (ORDER BY revenue ASC)  AS rev_rank_low,
           LEAD(revenue) OVER (ORDER BY period) AS next_month_revenue
    FROM monthly
)
SELECT
    DATE_FORMAT(period, '%Y-%m') AS period,
    ROUND(revenue, 2)            AS revenue,
    ROUND(next_month_revenue, 2) AS next_month_revenue,
    CASE WHEN rev_rank_high = 1 THEN 'PEAK'
         WHEN rev_rank_low  = 1 THEN 'TROUGH' END AS marker
FROM ranked
WHERE rev_rank_high = 1 OR rev_rank_low = 1
ORDER BY revenue DESC;
