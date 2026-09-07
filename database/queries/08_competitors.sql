-- ============================================================================
-- 08_competitors.sql — Market share: ours vs competitors, share movement
-- SRS §11/§15/§25, Contract §5 GET /api/competitors, /competitors/market-share
--
-- market_share ROW LAYOUT (see the comment on the table in 01_schema.sql):
--   WIDE, not long/EAV. Exactly ONE row per (drug_id, region_id, period_month),
--   and that row carries BOTH sides: our_share_pct is populated on every row,
--   while competitor_drug_id / competitor_share_pct are populated only for the 28
--   drugs that have a tracked rival (10 drugs have none).
--
--   Therefore `WHERE competitor_drug_id IS NULL` does NOT mean "our share rows".
--   It selects only the rival-less drugs, and a share KPI built on it silently
--   under-reports across the rest of the catalogue. Read our_share_pct with no
--   competitor filter; for a head-to-head read both columns off the same row.
--
--   Only the single LARGEST rival is tracked per drug, so competitor_share_pct is
--   that one rival's share rather than the whole competitive set.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Q08.1 — Head-to-head: our share vs the tracked rival, per drug (latest month)
-- Business question: For each of our drugs, how does our market share compare to
--   its single biggest rival in the most recent month, and where are we behind?
-- Serves: SRS §11 / GET /api/competitors/market-share.
-- Techniques: scalar subquery for the self-derived latest month, INNER JOIN chain
--   drugs → therapeutic_areas and LEFT JOIN through competitor_drugs → competitors
--   (LEFT so rival-less drugs still appear), CASE lead/behind flag, ORDER BY.
-- Talking point: because both figures live on the same row, the head-to-head is a
--   plain column comparison — no self-join and no conditional aggregation needed.
--   The LEFT JOIN is the deliberate choice: an INNER JOIN here would silently drop
--   the 10 drugs that have no tracked competitor, which is exactly the kind of
--   quiet row loss the INNER-vs-LEFT interview question is about.
-- ----------------------------------------------------------------------------
SELECT
    d.drug_id,
    d.drug_name,
    ta.ta_name,
    ROUND(AVG(m.our_share_pct), 2)                                   AS our_share_pct,
    COALESCE(MAX(c.company_name), '(no tracked rival)')               AS top_rival_company,
    MAX(cd.drug_name)                                                AS top_rival_brand,
    ROUND(AVG(m.competitor_share_pct), 2)                            AS rival_share_pct,
    ROUND(AVG(m.our_share_pct) - AVG(m.competitor_share_pct), 2)      AS share_gap_pp,
    CASE
        WHEN AVG(m.competitor_share_pct) IS NULL                            THEN 'UNCONTESTED'
        WHEN AVG(m.our_share_pct) >= AVG(m.competitor_share_pct)            THEN 'LEADING'
        ELSE 'TRAILING'
    END                                                              AS position
FROM market_share m
INNER JOIN drugs d                ON d.drug_id = m.drug_id
INNER JOIN therapeutic_areas ta   ON ta.ta_id  = d.ta_id
LEFT  JOIN competitor_drugs cd    ON cd.competitor_drug_id = m.competitor_drug_id
LEFT  JOIN competitors c          ON c.competitor_id       = cd.competitor_id
WHERE m.period_month = (SELECT MAX(period_month) FROM market_share)
GROUP BY d.drug_id, d.drug_name, ta.ta_name
ORDER BY share_gap_pp ASC;      -- worst-contested brands first

-- ----------------------------------------------------------------------------
-- Q08.2 — Biggest share movers: our share change vs 6 months ago (LAG)
-- Business question: Which drugs gained or lost the most market share over the
--   trailing half-year, and are we winning or bleeding share?
-- Serves: SRS §15/§25 (share movement, "biggest share losses highlighted").
-- Techniques: multi-CTE, LAG(...,6) OVER (PARTITION BY drug ORDER BY month),
--   share-point delta, CASE direction, outer filter to the latest month.
-- Talking point: comparing the latest month to the same drug six months earlier
--   uses one window call instead of a self-join on (drug, month − 6). The delta is
--   in share POINTS, matching the contract's `Pp` convention — a 2pp share move
--   and a 2% relative move are different quantities and the API distinguishes them.
-- ----------------------------------------------------------------------------
WITH our_monthly AS (
    SELECT m.drug_id, m.period_month, AVG(m.our_share_pct) AS our_share
    FROM market_share m
    GROUP BY m.drug_id, m.period_month
),
delta AS (
    SELECT drug_id, period_month, our_share,
           LAG(our_share, 6) OVER (PARTITION BY drug_id ORDER BY period_month) AS share_6m_ago
    FROM our_monthly
)
SELECT
    dl.drug_id,
    dr.drug_name,
    ROUND(dl.share_6m_ago, 2)                   AS share_6m_ago,
    ROUND(dl.our_share, 2)                      AS share_now,
    ROUND(dl.our_share - dl.share_6m_ago, 2)    AS share_delta_pp,
    CASE WHEN dl.our_share - dl.share_6m_ago >  0 THEN 'GAINING'
         WHEN dl.our_share - dl.share_6m_ago <  0 THEN 'LOSING'
         ELSE 'FLAT' END                        AS trend
FROM delta dl
INNER JOIN drugs dr ON dr.drug_id = dl.drug_id
WHERE dl.period_month = (SELECT MAX(period_month) FROM market_share)
  AND dl.share_6m_ago IS NOT NULL
ORDER BY share_delta_pp ASC          -- biggest losers first (SRS: highlight losses)
LIMIT 15;

-- ----------------------------------------------------------------------------
-- Q08.3 — Where a rival is actively out-sharing us, by drug AND region
-- Business question: In which specific drug-region cells has a competitor
--   overtaken us this month, and how large is the deficit?
-- Serves: SRS §25 (the competitor contributor to "why did sales change"),
--   and the SRS §44 demo — CardioMax in North is expected to appear here.
-- Techniques: multi-CTE, INNER JOIN chain market_share → competitor_drugs →
--   competitors plus the region and drug dimensions, correlated subquery for the
--   drug's 6-month average deficit, DENSE_RANK to order the worst cells, CASE
--   severity banding, WHERE on the computed gap.
-- Talking point: this is the cell-level view that a company-level share KPI hides.
--   Averaging share across regions can look healthy while individual territories
--   are being lost; ranking (drug, region) pairs is what makes the loss
--   actionable, and it is where the planted North/CardioMax competitor gain shows
--   up. The correlated subquery answers "is this a blip or a standing deficit?"
-- ----------------------------------------------------------------------------
WITH latest AS (
    SELECT MAX(period_month) AS mth FROM market_share
),
contested AS (
    SELECT
        m.drug_id, m.region_id, m.period_month,
        m.our_share_pct, m.competitor_share_pct, m.competitor_drug_id,
        m.competitor_share_pct - m.our_share_pct AS deficit_pp
    FROM market_share m
    CROSS JOIN latest l
    WHERE m.period_month = l.mth
      AND m.competitor_drug_id IS NOT NULL
      AND m.competitor_share_pct > m.our_share_pct
)
SELECT
    d.drug_name,
    r.region_name,
    c.company_name                                  AS rival_company,
    cd.drug_name                                    AS rival_brand,
    ROUND(ct.our_share_pct, 2)                      AS our_share_pct,
    ROUND(ct.competitor_share_pct, 2)               AS rival_share_pct,
    ROUND(ct.deficit_pp, 2)                         AS deficit_pp,
    -- Standing deficit vs this month's: distinguishes a blip from a trend.
    (SELECT ROUND(AVG(m2.competitor_share_pct - m2.our_share_pct), 2)
       FROM market_share m2
      WHERE m2.drug_id   = ct.drug_id
        AND m2.region_id = ct.region_id
        AND m2.competitor_drug_id IS NOT NULL
        AND m2.period_month > (SELECT MAX(period_month) - INTERVAL 6 MONTH
                                 FROM market_share))  AS avg_deficit_6m_pp,
    CASE WHEN ct.deficit_pp >= 15 THEN 'CRITICAL'
         WHEN ct.deficit_pp >=  8 THEN 'HIGH'
         WHEN ct.deficit_pp >=  3 THEN 'MEDIUM'
         ELSE 'LOW' END                             AS severity,
    DENSE_RANK() OVER (ORDER BY ct.deficit_pp DESC) AS deficit_rank
FROM contested ct
INNER JOIN drugs d             ON d.drug_id  = ct.drug_id
INNER JOIN regions r           ON r.region_id = ct.region_id
INNER JOIN competitor_drugs cd ON cd.competitor_drug_id = ct.competitor_drug_id
INNER JOIN competitors c       ON c.competitor_id       = cd.competitor_id
ORDER BY deficit_pp DESC
LIMIT 20;

-- ----------------------------------------------------------------------------
-- Q08.4 — Competitor pressure by therapeutic area
-- Business question: Which therapeutic area is under the most competitive
--   pressure overall, and which company is driving it?
-- Serves: SRS §9/§25 (where should management investigate first).
-- Techniques: multi-CTE, aggregation with HAVING, ROW_NUMBER to pick the top
--   rival per area, conditional aggregation to count contested cells, ORDER BY.
-- Talking point: HAVING filters on the AGGREGATE (areas where we actually trail
--   on average), which WHERE cannot do — the classic WHERE-vs-HAVING distinction.
-- ----------------------------------------------------------------------------
WITH ta_cells AS (
    SELECT
        ta.ta_id, ta.ta_name,
        AVG(m.our_share_pct)                                          AS our_share,
        AVG(m.competitor_share_pct)                                   AS rival_share,
        SUM(CASE WHEN m.competitor_share_pct > m.our_share_pct THEN 1 ELSE 0 END) AS cells_lost,
        COUNT(*)                                                      AS cells_total
    FROM market_share m
    INNER JOIN drugs d              ON d.drug_id = m.drug_id
    INNER JOIN therapeutic_areas ta ON ta.ta_id  = d.ta_id
    WHERE m.period_month = (SELECT MAX(period_month) FROM market_share)
      AND m.competitor_drug_id IS NOT NULL
    GROUP BY ta.ta_id, ta.ta_name
    HAVING AVG(m.competitor_share_pct) > AVG(m.our_share_pct)
),
top_rival AS (
    SELECT
        ta.ta_id, c.company_name,
        AVG(m.competitor_share_pct) AS comp_share,
        ROW_NUMBER() OVER (PARTITION BY ta.ta_id
                           ORDER BY AVG(m.competitor_share_pct) DESC) AS rn
    FROM market_share m
    INNER JOIN competitor_drugs cd  ON cd.competitor_drug_id = m.competitor_drug_id
    INNER JOIN competitors c        ON c.competitor_id       = cd.competitor_id
    INNER JOIN drugs d              ON d.drug_id             = m.drug_id
    INNER JOIN therapeutic_areas ta ON ta.ta_id              = d.ta_id
    WHERE m.period_month = (SELECT MAX(period_month) FROM market_share)
    GROUP BY ta.ta_id, c.company_name
)
SELECT
    tc.ta_name,
    ROUND(tc.our_share, 2)                                    AS our_share_pct,
    ROUND(tc.rival_share, 2)                                  AS rival_share_pct,
    ROUND(tc.rival_share - tc.our_share, 2)                   AS pressure_pp,
    tc.cells_lost,
    tc.cells_total,
    ROUND(100 * tc.cells_lost / tc.cells_total, 1)            AS cells_lost_pct,
    tr.company_name                                           AS leading_rival
FROM ta_cells tc
LEFT JOIN top_rival tr ON tr.ta_id = tc.ta_id AND tr.rn = 1
ORDER BY pressure_pp DESC;
