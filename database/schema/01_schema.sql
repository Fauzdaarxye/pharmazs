-- ============================================================================
-- PharmaZs — Pharmaceutical Commercial Intelligence Platform
-- MySQL 8.0 schema (SRS §1, §39)
--
-- Design notes
--   * Star-ish model: narrow FACT tables (prescriptions, sales, visits) around
--     conformed DIMENSIONS (drugs, hcps, regions, sales_reps, time).
--   * region_id / city_id are deliberately DENORMALISED onto the fact tables.
--     Every dashboard filters by region; carrying it on the fact avoids a
--     3-table join on 250k+ rows for the most common query in the product.
--   * ML output lands in its own tables (hcp_scores, forecasts, anomalies)
--     so the Python service never mutates transactional data.
--   * All money is DECIMAL(14,2) — never FLOAT. Floating point money silently
--     loses cents and KPI cards then disagree with each other.
-- ============================================================================

DROP DATABASE IF EXISTS pharmazs;
CREATE DATABASE pharmazs
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE pharmazs;

-- ---------------------------------------------------------------------------
-- AUTH & USERS (SRS §6)
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  user_id        INT AUTO_INCREMENT PRIMARY KEY,
  full_name      VARCHAR(120)  NOT NULL,
  email          VARCHAR(160)  NOT NULL UNIQUE,
  password_hash  VARCHAR(255)  NOT NULL,          -- bcrypt; never plaintext (SRS §38)
  role           ENUM('ADMIN','EXECUTIVE','MANAGER','SALES_REP','ANALYST') NOT NULL,
  -- When role = SALES_REP / MANAGER this scopes the user to their own data.
  sales_rep_id   INT           NULL,
  region_id      INT           NULL,
  is_active      TINYINT(1)    NOT NULL DEFAULT 1,
  last_login_at  DATETIME      NULL,
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_role (role)
) ENGINE=InnoDB;

CREATE TABLE refresh_tokens (
  token_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NOT NULL,
  token_hash  CHAR(64)     NOT NULL UNIQUE,   -- sha256 of the token, not the token
  expires_at  DATETIME     NOT NULL,
  revoked_at  DATETIME     NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_rt_user (user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- GEOGRAPHY (SRS §10, §15)
-- ---------------------------------------------------------------------------
CREATE TABLE regions (
  region_id     INT AUTO_INCREMENT PRIMARY KEY,
  region_name   VARCHAR(40) NOT NULL UNIQUE,      -- North / South / East / West / Central
  zone_head     VARCHAR(120),
  population_mn DECIMAL(8,2),
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE cities (
  city_id    INT AUTO_INCREMENT PRIMARY KEY,
  region_id  INT NOT NULL,
  city_name  VARCHAR(80) NOT NULL,
  tier       ENUM('TIER_1','TIER_2','TIER_3') NOT NULL DEFAULT 'TIER_2',
  CONSTRAINT fk_city_region FOREIGN KEY (region_id) REFERENCES regions(region_id),
  UNIQUE KEY uq_city (region_id, city_name),
  INDEX idx_city_region (region_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- PRODUCT (SRS §9, §11)
-- ---------------------------------------------------------------------------
CREATE TABLE therapeutic_areas (
  ta_id        INT AUTO_INCREMENT PRIMARY KEY,
  ta_name      VARCHAR(60) NOT NULL UNIQUE,       -- Cardiology, Diabetes, Oncology, ...
  description  VARCHAR(255)
) ENGINE=InnoDB;

CREATE TABLE drugs (
  drug_id       INT AUTO_INCREMENT PRIMARY KEY,
  drug_code     VARCHAR(20)  NOT NULL UNIQUE,
  drug_name     VARCHAR(120) NOT NULL,            -- our brand, e.g. CardioMax
  generic_name  VARCHAR(120) NOT NULL,            -- e.g. Atorvastatin
  ta_id         INT          NOT NULL,
  unit_price    DECIMAL(10,2) NOT NULL,
  dosage_form   VARCHAR(40),
  strength      VARCHAR(40),
  launch_date   DATE         NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  CONSTRAINT fk_drug_ta FOREIGN KEY (ta_id) REFERENCES therapeutic_areas(ta_id),
  INDEX idx_drug_ta (ta_id),
  INDEX idx_drug_active (is_active)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- PEOPLE: HCPs (SRS §12) and SALES REPS (SRS §14)
-- ---------------------------------------------------------------------------
CREATE TABLE hcps (
  hcp_id                INT AUTO_INCREMENT PRIMARY KEY,
  hcp_code              VARCHAR(20)  NOT NULL UNIQUE,
  full_name             VARCHAR(140) NOT NULL,
  specialty             VARCHAR(60)  NOT NULL,    -- Cardiologist, Diabetologist, ...
  qualification         VARCHAR(80),
  hospital              VARCHAR(160),
  city_id               INT          NOT NULL,
  region_id             INT          NOT NULL,    -- denormalised, see header
  years_experience      SMALLINT,
  monthly_patient_volume INT,
  hcp_tier              ENUM('A','B','C') NOT NULL DEFAULT 'B',
  email                 VARCHAR(160),
  phone                 VARCHAR(30),
  onboarded_date        DATE,
  is_active             TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_hcp_city   FOREIGN KEY (city_id)   REFERENCES cities(city_id),
  CONSTRAINT fk_hcp_region FOREIGN KEY (region_id) REFERENCES regions(region_id),
  INDEX idx_hcp_region (region_id),
  INDEX idx_hcp_specialty (specialty),
  INDEX idx_hcp_city (city_id),
  INDEX idx_hcp_tier (hcp_tier)
) ENGINE=InnoDB;

CREATE TABLE sales_reps (
  rep_id         INT AUTO_INCREMENT PRIMARY KEY,
  rep_code       VARCHAR(20)  NOT NULL UNIQUE,
  full_name      VARCHAR(140) NOT NULL,
  email          VARCHAR(160) NOT NULL UNIQUE,
  region_id      INT          NOT NULL,
  manager_id     INT          NULL,               -- self-FK: rep -> manager
  territory      VARCHAR(120),
  hire_date      DATE         NOT NULL,
  annual_target  DECIMAL(14,2) NOT NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  CONSTRAINT fk_rep_region  FOREIGN KEY (region_id)  REFERENCES regions(region_id),
  CONSTRAINT fk_rep_manager FOREIGN KEY (manager_id) REFERENCES sales_reps(rep_id),
  INDEX idx_rep_region (region_id),
  INDEX idx_rep_manager (manager_id)
) ENGINE=InnoDB;

-- A rep "owns" a panel of HCPs. Modelled as a junction with validity dates so
-- territory reshuffles are representable instead of overwriting history.
CREATE TABLE rep_hcp_assignments (
  assignment_id INT AUTO_INCREMENT PRIMARY KEY,
  rep_id        INT  NOT NULL,
  hcp_id        INT  NOT NULL,
  assigned_from DATE NOT NULL,
  assigned_to   DATE NULL,                        -- NULL = current owner
  CONSTRAINT fk_rha_rep FOREIGN KEY (rep_id) REFERENCES sales_reps(rep_id),
  CONSTRAINT fk_rha_hcp FOREIGN KEY (hcp_id) REFERENCES hcps(hcp_id),
  INDEX idx_rha_rep (rep_id),
  INDEX idx_rha_hcp (hcp_id),
  INDEX idx_rha_current (hcp_id, assigned_to)
) ENGINE=InnoDB;

CREATE TABLE rep_targets (
  target_id      INT AUTO_INCREMENT PRIMARY KEY,
  rep_id         INT NOT NULL,
  period_month   DATE NOT NULL,                   -- always the 1st of the month
  target_revenue DECIMAL(14,2) NOT NULL,
  CONSTRAINT fk_rt_rep FOREIGN KEY (rep_id) REFERENCES sales_reps(rep_id),
  UNIQUE KEY uq_rep_period (rep_id, period_month),
  INDEX idx_rtg_period (period_month)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- COMPETITORS (SRS §11, §15, §25)
-- ---------------------------------------------------------------------------
CREATE TABLE competitors (
  competitor_id INT AUTO_INCREMENT PRIMARY KEY,
  company_name  VARCHAR(120) NOT NULL UNIQUE,
  hq_country    VARCHAR(60)
) ENGINE=InnoDB;

CREATE TABLE competitor_drugs (
  competitor_drug_id INT AUTO_INCREMENT PRIMARY KEY,
  competitor_id      INT NOT NULL,
  drug_name          VARCHAR(120) NOT NULL,
  ta_id              INT NOT NULL,
  rival_drug_id      INT NULL,                    -- the drug of ours it competes with
  unit_price         DECIMAL(10,2),
  CONSTRAINT fk_cd_competitor FOREIGN KEY (competitor_id) REFERENCES competitors(competitor_id),
  CONSTRAINT fk_cd_ta         FOREIGN KEY (ta_id)         REFERENCES therapeutic_areas(ta_id),
  CONSTRAINT fk_cd_rival      FOREIGN KEY (rival_drug_id) REFERENCES drugs(drug_id),
  INDEX idx_cd_rival (rival_drug_id)
) ENGINE=InnoDB;

-- Monthly share-of-market per (our drug, region).
--
-- ROW LAYOUT — read this before writing a query against this table. The layout is
-- WIDE, not long/EAV: there is exactly ONE row per (drug_id, region_id,
-- period_month), and that row carries BOTH sides of the comparison.
--   * our_share_pct        is populated on EVERY row.
--   * competitor_drug_id / competitor_share_pct are populated on rows where the
--     drug has a tracked rival, and NULL for the 10 drugs that have none.
--
-- So `WHERE competitor_drug_id IS NULL` does NOT select "our share rows" — it
-- selects only the handful of drugs with no competitor, and any market-share KPI
-- built on that filter silently under-reports across the whole catalogue. To get
-- our share, just read our_share_pct with no competitor filter; for a
-- head-to-head, read both columns off the same row.
--
-- Only the single LARGEST rival is recorded per drug, so competitor_share_pct is
-- that rival's share, not the whole competitive set.
CREATE TABLE market_share (
  share_id            INT AUTO_INCREMENT PRIMARY KEY,
  drug_id             INT  NOT NULL,
  region_id           INT  NOT NULL,
  period_month        DATE NOT NULL,
  our_share_pct       DECIMAL(6,2) NOT NULL,
  competitor_drug_id  INT  NULL,
  competitor_share_pct DECIMAL(6,2) NULL,
  CONSTRAINT fk_ms_drug   FOREIGN KEY (drug_id)   REFERENCES drugs(drug_id),
  CONSTRAINT fk_ms_region FOREIGN KEY (region_id) REFERENCES regions(region_id),
  CONSTRAINT fk_ms_cd     FOREIGN KEY (competitor_drug_id) REFERENCES competitor_drugs(competitor_drug_id),
  INDEX idx_ms_lookup (drug_id, region_id, period_month)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- FACTS (SRS §39 — every filtered column is indexed)
-- ---------------------------------------------------------------------------
CREATE TABLE prescriptions (
  prescription_id   BIGINT AUTO_INCREMENT PRIMARY KEY,
  hcp_id            INT  NOT NULL,
  drug_id           INT  NOT NULL,
  region_id         INT  NOT NULL,
  prescription_date DATE NOT NULL,
  units             INT  NOT NULL,
  patient_count     INT  NOT NULL DEFAULT 1,
  is_new_patient    TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_rx_hcp    FOREIGN KEY (hcp_id)    REFERENCES hcps(hcp_id),
  CONSTRAINT fk_rx_drug   FOREIGN KEY (drug_id)   REFERENCES drugs(drug_id),
  CONSTRAINT fk_rx_region FOREIGN KEY (region_id) REFERENCES regions(region_id),
  INDEX idx_rx_date (prescription_date),
  INDEX idx_rx_hcp_date (hcp_id, prescription_date),
  INDEX idx_rx_drug_date (drug_id, prescription_date),
  INDEX idx_rx_region_date (region_id, prescription_date)
) ENGINE=InnoDB;

CREATE TABLE sales (
  sale_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
  drug_id      INT  NOT NULL,
  hcp_id       INT  NULL,                         -- NULL = institutional / tender sale
  rep_id       INT  NOT NULL,
  region_id    INT  NOT NULL,
  city_id      INT  NOT NULL,
  sale_date    DATE NOT NULL,
  units_sold   INT  NOT NULL,
  unit_price   DECIMAL(10,2) NOT NULL,            -- price AT TIME OF SALE, not today's
  discount_pct DECIMAL(5,2)  NOT NULL DEFAULT 0,
  -- Stored generated column: revenue can never drift out of sync with its inputs.
  revenue      DECIMAL(14,2) AS (ROUND(units_sold * unit_price * (1 - discount_pct/100), 2)) STORED,
  channel      ENUM('RETAIL','HOSPITAL','INSTITUTIONAL','ONLINE') NOT NULL DEFAULT 'RETAIL',
  CONSTRAINT fk_sale_drug   FOREIGN KEY (drug_id)   REFERENCES drugs(drug_id),
  CONSTRAINT fk_sale_hcp    FOREIGN KEY (hcp_id)    REFERENCES hcps(hcp_id),
  CONSTRAINT fk_sale_rep    FOREIGN KEY (rep_id)    REFERENCES sales_reps(rep_id),
  CONSTRAINT fk_sale_region FOREIGN KEY (region_id) REFERENCES regions(region_id),
  CONSTRAINT fk_sale_city   FOREIGN KEY (city_id)   REFERENCES cities(city_id),
  INDEX idx_sale_date (sale_date),
  INDEX idx_sale_drug_date (drug_id, sale_date),
  INDEX idx_sale_region_date (region_id, sale_date),
  INDEX idx_sale_rep_date (rep_id, sale_date),
  INDEX idx_sale_hcp_date (hcp_id, sale_date),
  INDEX idx_sale_revenue (revenue)
) ENGINE=InnoDB;

CREATE TABLE visits (
  visit_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
  rep_id        INT  NOT NULL,
  hcp_id        INT  NOT NULL,
  visit_date    DATE NOT NULL,
  duration_min  SMALLINT,
  visit_type    ENUM('IN_PERSON','VIRTUAL','PHONE','CONFERENCE') NOT NULL DEFAULT 'IN_PERSON',
  outcome       ENUM('POSITIVE','NEUTRAL','NEGATIVE') NOT NULL DEFAULT 'NEUTRAL',
  samples_given INT NOT NULL DEFAULT 0,
  discussed_drug_id INT NULL,
  notes         VARCHAR(400),
  CONSTRAINT fk_visit_rep  FOREIGN KEY (rep_id) REFERENCES sales_reps(rep_id),
  CONSTRAINT fk_visit_hcp  FOREIGN KEY (hcp_id) REFERENCES hcps(hcp_id),
  CONSTRAINT fk_visit_drug FOREIGN KEY (discussed_drug_id) REFERENCES drugs(drug_id),
  INDEX idx_visit_date (visit_date),
  INDEX idx_visit_hcp_date (hcp_id, visit_date),
  INDEX idx_visit_rep_date (rep_id, visit_date)
) ENGINE=InnoDB;

-- Monthly stock snapshot per (drug, region). Feeds the inventory contributor in
-- "Why did sales change?" (SRS §25).
CREATE TABLE inventory_snapshots (
  snapshot_id   INT AUTO_INCREMENT PRIMARY KEY,
  drug_id       INT  NOT NULL,
  region_id     INT  NOT NULL,
  snapshot_month DATE NOT NULL,
  opening_stock INT  NOT NULL,
  units_in      INT  NOT NULL,
  units_out     INT  NOT NULL,
  closing_stock INT  NOT NULL,
  stockout_days SMALLINT NOT NULL DEFAULT 0,
  CONSTRAINT fk_inv_drug   FOREIGN KEY (drug_id)   REFERENCES drugs(drug_id),
  CONSTRAINT fk_inv_region FOREIGN KEY (region_id) REFERENCES regions(region_id),
  UNIQUE KEY uq_inv (drug_id, region_id, snapshot_month),
  INDEX idx_inv_month (snapshot_month)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- ML / ANALYTICS OUTPUT (written by the Python FastAPI service, SRS §13, §23, §24)
-- ---------------------------------------------------------------------------
CREATE TABLE hcp_scores (
  score_id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  hcp_id                     INT  NOT NULL,
  scored_at                  DATETIME NOT NULL,
  -- Component sub-scores, each 0-100, before weighting (SRS §13 weights:
  -- volume 40, growth 25, engagement 15, relevance 10, competitor gap 10)
  rx_volume_score            DECIMAL(6,2) NOT NULL,
  rx_growth_score            DECIMAL(6,2) NOT NULL,
  engagement_score           DECIMAL(6,2) NOT NULL,
  ta_relevance_score         DECIMAL(6,2) NOT NULL,
  competitor_opportunity_score DECIMAL(6,2) NOT NULL,
  total_score                DECIMAL(6,2) NOT NULL,
  priority                   ENUM('HIGH','MEDIUM','LOW') NOT NULL,
  reasons_json               JSON NULL,           -- human-readable "why this rank"
  CONSTRAINT fk_score_hcp FOREIGN KEY (hcp_id) REFERENCES hcps(hcp_id) ON DELETE CASCADE,
  INDEX idx_score_hcp (hcp_id),
  INDEX idx_score_total (total_score DESC),
  INDEX idx_score_priority (priority)
) ENGINE=InnoDB;

CREATE TABLE forecasts (
  forecast_id       BIGINT AUTO_INCREMENT PRIMARY KEY,
  entity_type       ENUM('COMPANY','DRUG','REGION','TA') NOT NULL,
  entity_id         INT NULL,                     -- NULL when entity_type = COMPANY
  period_month      DATE NOT NULL,
  predicted_revenue DECIMAL(14,2) NOT NULL,
  lower_bound       DECIMAL(14,2) NOT NULL,
  upper_bound       DECIMAL(14,2) NOT NULL,
  model_name        VARCHAR(60) NOT NULL,
  mape              DECIMAL(6,2) NULL,            -- backtest error, so the UI can show confidence
  generated_at      DATETIME NOT NULL,
  INDEX idx_fc_entity (entity_type, entity_id, period_month)
) ENGINE=InnoDB;

CREATE TABLE anomalies (
  anomaly_id     BIGINT AUTO_INCREMENT PRIMARY KEY,
  entity_type    ENUM('COMPANY','DRUG','REGION','TA','REP','HCP') NOT NULL,
  entity_id      INT NULL,
  period_month   DATE NOT NULL,
  metric         VARCHAR(60) NOT NULL,            -- revenue / units / rx_volume
  actual_value   DECIMAL(16,2) NOT NULL,
  expected_value DECIMAL(16,2) NOT NULL,
  deviation_pct  DECIMAL(8,2)  NOT NULL,
  z_score        DECIMAL(8,3)  NOT NULL,
  severity       ENUM('CRITICAL','HIGH','MEDIUM','LOW') NOT NULL,
  direction      ENUM('DROP','SPIKE') NOT NULL,
  detected_at    DATETIME NOT NULL,
  INDEX idx_anom_entity (entity_type, entity_id),
  INDEX idx_anom_month (period_month),
  INDEX idx_anom_severity (severity)
) ENGINE=InnoDB;

CREATE TABLE alerts (
  alert_id     BIGINT AUTO_INCREMENT PRIMARY KEY,
  alert_type   VARCHAR(60) NOT NULL,              -- REVENUE_DROP, STOCKOUT_RISK, ...
  severity     ENUM('CRITICAL','HIGH','MEDIUM','LOW') NOT NULL,
  title        VARCHAR(200) NOT NULL,
  message      VARCHAR(600) NOT NULL,
  entity_type  VARCHAR(30),
  entity_id    INT,
  audience_role ENUM('ALL','EXECUTIVE','MANAGER','SALES_REP','ANALYST') NOT NULL DEFAULT 'ALL',
  is_read      TINYINT(1) NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL,
  INDEX idx_alert_created (created_at DESC),
  INDEX idx_alert_severity (severity),
  INDEX idx_alert_unread (is_read)
) ENGINE=InnoDB;

CREATE TABLE recommendations (
  rec_id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  rec_type        VARCHAR(60) NOT NULL,           -- HCP_PRIORITY, REGION_FOCUS, PRODUCT_PUSH
  audience_role   ENUM('ALL','EXECUTIVE','MANAGER','SALES_REP','ANALYST') NOT NULL DEFAULT 'ALL',
  target_entity_type VARCHAR(30),
  target_entity_id   INT,
  title           VARCHAR(200) NOT NULL,
  rationale       VARCHAR(800) NOT NULL,          -- computed, never hard-coded (SRS §26)
  expected_impact VARCHAR(200),
  priority        ENUM('HIGH','MEDIUM','LOW') NOT NULL,
  confidence      DECIMAL(5,2),
  created_at      DATETIME NOT NULL,
  INDEX idx_rec_role (audience_role),
  INDEX idx_rec_priority (priority),
  INDEX idx_rec_target (target_entity_type, target_entity_id)
) ENGINE=InnoDB;
