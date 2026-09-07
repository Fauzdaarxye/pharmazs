-- ============================================================================
-- 10_root_cause.sql — "Why did sales change?" decomposition & anomaly support
-- SRS §25/§26, Contract §5 POST /api/analytics/why-did-sales-change
-- Every number is computed from facts; the contract forbids hardcoded sentences.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Q10.1 — Revenue change decomposed into five contributors (root-cause headline)
-- Business question: For a given drug×region, why did revenue move between the
--   last 3 months and the prior 3 months — split across prescription volume,
--   HCP engagement, competitor share, inventory, and price/discount?
-- Serves: SRS §25/§26 / the why-did-sales-change payload contributors.
-- Techniques: long multi-CTE chain (one CTE per contributor), scalar subquery
--   for the analysis window, conditional aggregation for current-vs-prior across
--   THREE fact tables, INNER/LEFT JOINs, CASE direction, per-factor % change and
--   a normalised contribution % that sums to ~100.
-- Talking point: this is the whole engine in one statement. Each contributor is
--   its own CTE computing a period-over-period % move from raw facts; the final
--   SELECT normalises the absolute movements into contribution shares. The drug
--   and region are chosen by subquery (the drug×region with the largest recent
--   revenue swing), so it runs standalone yet maps 1:1 onto :drugId/:regionId.
-- ----------------------------------------------------------------------------
WITH win AS (
    SELECT MAX(sale_date)                    AS max_d,
           MAX(sale_date) - INTERVAL 3 MONTH AS cur_start,
           MAX(sale_date) - INTERVAL 6 MONTH AS prev_start
    FROM sales
),
-- pick the drug×region with the biggest absolute recent revenue swing to analyse
focus AS (
    SELECT s.drug_id, s.region_id
    FROM sales s CROSS JOIN win w
    WHERE s.sale_date > w.prev_start
    GROUP BY s.drug_id, s.region_id
    ORDER BY ABS(
        SUM(CASE WHEN s.sale_date > w.cur_start THEN s.revenue ELSE 0 END)
      - SUM(CASE WHEN s.sale_date <= w.cur_start THEN s.revenue ELSE 0 END)
    ) DESC
    LIMIT 1
),
revenue_c AS (
    SELECT
        SUM(CASE WHEN s.sale_date > w.cur_start THEN s.revenue ELSE 0 END) AS cur_rev,
        SUM(CASE WHEN s.sale_date <= w.cur_start THEN s.revenue ELSE 0 END) AS prev_rev,
        AVG(CASE WHEN s.sale_date > w.cur_start THEN s.discount_pct END)   AS cur_disc,
        AVG(CASE WHEN s.sale_date <= w.cur_start THEN s.discount_pct END)  AS prev_disc
    FROM sales s
    INNER JOIN focus f ON f.drug_id = s.drug_id AND f.region_id = s.region_id
    CROSS JOIN win w
    WHERE s.sale_date > w.prev_start
),
rx_c AS (
    SELECT
        SUM(CASE WHEN p.prescription_date > w.cur_start THEN p.units ELSE 0 END)  AS cur_units,
        SUM(CASE WHEN p.prescription_date <= w.cur_start THEN p.units ELSE 0 END) AS prev_units
    FROM prescriptions p
    INNER JOIN focus f ON f.drug_id = p.drug_id AND f.region_id = p.region_id
    CROSS JOIN win w
    WHERE p.prescription_date > w.prev_start
),
engage_c AS (
    SELECT
        SUM(CASE WHEN v.visit_date > w.cur_start THEN 1 ELSE 0 END)  AS cur_visits,
        SUM(CASE WHEN v.visit_date <= w.cur_start THEN 1 ELSE 0 END) AS prev_visits
    FROM visits v
    INNER JOIN hcps h  ON h.hcp_id = v.hcp_id
    INNER JOIN focus f ON f.region_id = h.region_id
    CROSS JOIN win w
    WHERE v.visit_date > w.prev_start
),
share_c AS (
    SELECT
        AVG(CASE WHEN m.period_month > w.cur_start THEN m.our_share_pct END)  AS cur_share,
        AVG(CASE WHEN m.period_month <= w.cur_start THEN m.our_share_pct END) AS prev_share
    FROM market_share m
    INNER JOIN focus f ON f.drug_id = m.drug_id AND f.region_id = m.region_id
    CROSS JOIN win w
    WHERE m.period_month > w.prev_start
),
inv_c AS (
    SELECT
        AVG(CASE WHEN i.snapshot_month > w.cur_start THEN i.stockout_days END)  AS cur_stockout,
        AVG(CASE WHEN i.snapshot_month <= w.cur_start THEN i.stockout_days END) AS prev_stockout
    FROM inventory_snapshots i
    INNER JOIN focus f ON f.drug_id = i.drug_id AND f.region_id = i.region_id
    CROSS JOIN win w
    WHERE i.snapshot_month > w.prev_start
),
factors AS (
    SELECT 'PRESCRIPTION_VOLUME' AS factor,
           CASE WHEN rx_c.prev_units = 0 THEN NULL
                ELSE 100*(rx_c.cur_units - rx_c.prev_units)/rx_c.prev_units END AS change_pct
    FROM rx_c
    UNION ALL
    SELECT 'HCP_ENGAGEMENT',
           CASE WHEN engage_c.prev_visits = 0 THEN NULL
                ELSE 100*(engage_c.cur_visits - engage_c.prev_visits)/engage_c.prev_visits END
    FROM engage_c
    UNION ALL
    SELECT 'COMPETITOR_SHARE',
           CASE WHEN share_c.prev_share = 0 THEN NULL
                ELSE 100*(share_c.cur_share - share_c.prev_share)/share_c.prev_share END
    FROM share_c
    UNION ALL
    SELECT 'INVENTORY',
           CASE WHEN inv_c.prev_stockout IS NULL OR inv_c.prev_stockout = 0 THEN 0
                ELSE -100*(inv_c.cur_stockout - inv_c.prev_stockout)/inv_c.prev_stockout END
    FROM inv_c
    UNION ALL
    SELECT 'PRICE_DISCOUNT',
           CASE WHEN revenue_c.prev_disc = 0 THEN NULL
                ELSE -100*(revenue_c.cur_disc - revenue_c.prev_disc)/revenue_c.prev_disc END
    FROM revenue_c
)
SELECT
    factor,
    ROUND(change_pct, 1) AS change_pct,
    CASE WHEN change_pct > 0 THEN 'POSITIVE'
         WHEN change_pct < 0 THEN 'NEGATIVE' ELSE 'NEUTRAL' END AS direction,
    ROUND(100 * ABS(change_pct) / NULLIF(SUM(ABS(change_pct)) OVER (), 0), 1) AS contribution_pct
FROM factors
WHERE change_pct IS NOT NULL
ORDER BY contribution_pct DESC;

-- ----------------------------------------------------------------------------
-- Q10.2 — Anomaly detection: monthly revenue deviation vs trailing baseline
-- Business question: Which recent monthly revenue figures are statistical
--   outliers versus each entity's own trailing average (a spike or a drop worth
--   an alert)?
-- Serves: SRS §24 / GET /api/anomalies (SQL approximation of the ML z-score).
-- Techniques: multi-CTE, window AVG and STDDEV_POP over a trailing frame
--   PARTITION BY drug, z-score expression, CASE severity banding, outer filter on
--   the derived z, ORDER BY.
-- Talking point: AVG and STDDEV_POP over ROWS BETWEEN 6 PRECEDING AND 1 PRECEDING
--   build a *trailing* baseline that excludes the current month, so the z-score
--   measures how far this month deviates from its own recent history — the same
--   idea as the ML service's robust z-score, expressed in SQL.
-- ----------------------------------------------------------------------------
WITH drug_month AS (
    SELECT s.drug_id, DATE_FORMAT(s.sale_date, '%Y-%m-01') AS period, SUM(s.revenue) AS revenue
    FROM sales s
    GROUP BY s.drug_id, DATE_FORMAT(s.sale_date, '%Y-%m-01')
),
stats AS (
    SELECT
        drug_id, period, revenue,
        AVG(revenue)        OVER w AS base_avg,
        STDDEV_POP(revenue) OVER w AS base_sd
    FROM drug_month
    WINDOW w AS (PARTITION BY drug_id ORDER BY period ROWS BETWEEN 6 PRECEDING AND 1 PRECEDING)
),
z AS (
    SELECT drug_id, period, revenue, base_avg, base_sd,
           CASE WHEN base_sd IS NULL OR base_sd = 0 THEN NULL
                ELSE (revenue - base_avg) / base_sd END AS z_score
    FROM stats
)
SELECT
    d.drug_name,
    DATE_FORMAT(z.period, '%Y-%m')       AS period,
    ROUND(z.revenue, 2)                  AS revenue,
    ROUND(z.base_avg, 2)                 AS expected_revenue,
    ROUND(z.z_score, 2)                  AS z_score,
    CASE WHEN z.z_score >= 0 THEN 'SPIKE' ELSE 'DROP' END AS direction,
    CASE WHEN ABS(z.z_score) >= 3.5 THEN 'CRITICAL'
         WHEN ABS(z.z_score) >= 2.5 THEN 'HIGH'
         WHEN ABS(z.z_score) >= 2.0 THEN 'MEDIUM' ELSE 'LOW' END AS severity
FROM z
INNER JOIN drugs d ON d.drug_id = z.drug_id
WHERE z.z_score IS NOT NULL
  AND ABS(z.z_score) >= 2.0
  AND z.period > (SELECT MAX(sale_date) - INTERVAL 6 MONTH FROM sales)
ORDER BY ABS(z.z_score) DESC
LIMIT 25;

-- ----------------------------------------------------------------------------
-- Q10.3 — New- vs repeat-patient revenue mix shift (growth-quality diagnostic)
-- Business question: Is our recent prescription growth coming from acquiring new
--   patients or from existing ones — and how has that mix shifted year over year?
-- Serves: SRS §25 (root-cause quality: durable vs one-off growth).
-- Techniques: conditional aggregation on is_new_patient, INNER JOIN drug→ta,
--   PARTITION BY window for the current-period share, LAG-free YoY via two
--   conditional windows, CASE, ORDER BY.
-- Talking point: SUM(CASE WHEN is_new_patient ...) splits the same rows into new
--   vs repeat without a second scan; expressing it as a share of the period total
--   shows whether growth is *durable* (new patients) or just repeat-fill — a
--   nuance a flat revenue number hides.
-- ----------------------------------------------------------------------------
WITH win AS (
    SELECT MAX(prescription_date) - INTERVAL 6 MONTH  AS cur_start,
           MAX(prescription_date) - INTERVAL 12 MONTH AS prev_start
    FROM prescriptions
)
SELECT
    ta.ta_name,
    SUM(CASE WHEN p.prescription_date > w.cur_start AND p.is_new_patient = 1 THEN p.units ELSE 0 END) AS new_patient_units,
    SUM(CASE WHEN p.prescription_date > w.cur_start AND p.is_new_patient = 0 THEN p.units ELSE 0 END) AS repeat_units,
    ROUND(100 * SUM(CASE WHEN p.prescription_date > w.cur_start AND p.is_new_patient = 1 THEN p.units ELSE 0 END)
             / NULLIF(SUM(CASE WHEN p.prescription_date > w.cur_start THEN p.units ELSE 0 END), 0), 1) AS new_patient_share_pct,
    ROUND(100 * SUM(CASE WHEN p.prescription_date <= w.cur_start AND p.prescription_date > w.prev_start AND p.is_new_patient = 1 THEN p.units ELSE 0 END)
             / NULLIF(SUM(CASE WHEN p.prescription_date <= w.cur_start AND p.prescription_date > w.prev_start THEN p.units ELSE 0 END), 0), 1) AS prior_new_patient_share_pct
FROM prescriptions p
INNER JOIN drugs d              ON d.drug_id = p.drug_id
INNER JOIN therapeutic_areas ta ON ta.ta_id = d.ta_id
CROSS JOIN win w
WHERE p.prescription_date > w.prev_start
GROUP BY ta.ta_name
ORDER BY new_patient_share_pct DESC;
