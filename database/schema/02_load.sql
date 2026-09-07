-- ============================================================================
-- PharmaIQ — bulk load generated CSVs into MySQL
--
-- Run from the directory holding the CSVs:
--   mysql --local-infile=1 -u pharmaiq -p pharmaiq < 02_load.sql
-- or use database/seed.sh, which handles paths and the local_infile flag.
--
-- Two things here are deliberate and easy to get wrong:
--
-- 1. NULLABLE FOREIGN KEYS. An empty CSV field loaded straight into an INT
--    column becomes 0, not NULL — and 0 is not a valid parent key, so the load
--    either dies on the FK or silently writes a dangling reference. Every
--    nullable FK is therefore read into a @variable and passed through
--    NULLIF(@v, ''). sales.hcp_id is the important one: institutional/tender
--    sales genuinely have no attributable physician.
--
-- 2. sales.revenue is a STORED GENERATED column and must NOT appear in the
--    column list; MySQL rejects an explicit value for it.
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;   -- bulk-load speed; re-enabled and verified below
SET UNIQUE_CHECKS = 0;
SET autocommit = 0;

-- ---- dimensions -----------------------------------------------------------
LOAD DATA LOCAL INFILE 'regions.csv' INTO TABLE regions
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (region_id, region_name, zone_head, population_mn);

LOAD DATA LOCAL INFILE 'cities.csv' INTO TABLE cities
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (city_id, region_id, city_name, tier);

LOAD DATA LOCAL INFILE 'therapeutic_areas.csv' INTO TABLE therapeutic_areas
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (ta_id, ta_name, description);

LOAD DATA LOCAL INFILE 'drugs.csv' INTO TABLE drugs
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (drug_id, drug_code, drug_name, generic_name, ta_id, unit_price,
                  dosage_form, strength, launch_date, is_active);

LOAD DATA LOCAL INFILE 'competitors.csv' INTO TABLE competitors
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (competitor_id, company_name, hq_country);

LOAD DATA LOCAL INFILE 'competitor_drugs.csv' INTO TABLE competitor_drugs
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (competitor_drug_id, competitor_id, drug_name, ta_id,
                  @rival_drug_id, unit_price)
  SET rival_drug_id = NULLIF(@rival_drug_id, '');

-- ---- people ---------------------------------------------------------------
LOAD DATA LOCAL INFILE 'hcps.csv' INTO TABLE hcps
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (hcp_id, hcp_code, full_name, specialty, qualification, hospital,
                  city_id, region_id, years_experience, monthly_patient_volume,
                  hcp_tier, email, phone, onboarded_date, is_active);

-- Managers appear FIRST in this file and carry an empty manager_id, so the
-- self-referencing FK resolves in file order.
LOAD DATA LOCAL INFILE 'sales_reps.csv' INTO TABLE sales_reps
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (rep_id, rep_code, full_name, email, region_id, @manager_id,
                  territory, hire_date, annual_target, is_active)
  SET manager_id = NULLIF(@manager_id, '');

LOAD DATA LOCAL INFILE 'rep_hcp_assignments.csv' INTO TABLE rep_hcp_assignments
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (assignment_id, rep_id, hcp_id, assigned_from, @assigned_to)
  SET assigned_to = NULLIF(@assigned_to, '');

LOAD DATA LOCAL INFILE 'rep_targets.csv' INTO TABLE rep_targets
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (target_id, rep_id, period_month, target_revenue);

LOAD DATA LOCAL INFILE 'users.csv' INTO TABLE users
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (user_id, full_name, email, password_hash, role,
                  @sales_rep_id, @region_id, is_active)
  SET sales_rep_id = NULLIF(@sales_rep_id, ''),
      region_id    = NULLIF(@region_id, '');

-- ---- facts ----------------------------------------------------------------
LOAD DATA LOCAL INFILE 'prescriptions.csv' INTO TABLE prescriptions
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (prescription_id, hcp_id, drug_id, region_id, prescription_date,
                  units, patient_count, is_new_patient);

-- NOTE: `revenue` is generated/stored and is intentionally absent below.
LOAD DATA LOCAL INFILE 'sales.csv' INTO TABLE sales
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (sale_id, drug_id, @hcp_id, rep_id, region_id, city_id, sale_date,
                  units_sold, unit_price, discount_pct, channel)
  SET hcp_id = NULLIF(@hcp_id, '');

LOAD DATA LOCAL INFILE 'visits.csv' INTO TABLE visits
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (visit_id, rep_id, hcp_id, visit_date, duration_min, visit_type,
                  outcome, samples_given, @discussed_drug_id, @notes)
  SET discussed_drug_id = NULLIF(@discussed_drug_id, ''),
      notes             = NULLIF(@notes, '');

LOAD DATA LOCAL INFILE 'inventory_snapshots.csv' INTO TABLE inventory_snapshots
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (snapshot_id, drug_id, region_id, snapshot_month, opening_stock,
                  units_in, units_out, closing_stock, stockout_days);

LOAD DATA LOCAL INFILE 'market_share.csv' INTO TABLE market_share
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' LINES TERMINATED BY '\n'
  IGNORE 1 LINES (share_id, drug_id, region_id, period_month, our_share_pct,
                  @competitor_drug_id, @competitor_share_pct)
  SET competitor_drug_id   = NULLIF(@competitor_drug_id, ''),
      competitor_share_pct = NULLIF(@competitor_share_pct, '');

COMMIT;
SET autocommit = 1;
SET UNIQUE_CHECKS = 1;
SET FOREIGN_KEY_CHECKS = 1;

-- ---- integrity verification ----------------------------------------------
-- FK checks were off during the load, so prove referential integrity rather
-- than assume it. Every count below must be 0.
SELECT 'orphan sales.drug_id'  AS check_name, COUNT(*) AS bad_rows
  FROM sales s LEFT JOIN drugs d ON d.drug_id = s.drug_id WHERE d.drug_id IS NULL
UNION ALL SELECT 'orphan sales.hcp_id', COUNT(*)
  FROM sales s LEFT JOIN hcps h ON h.hcp_id = s.hcp_id
  WHERE s.hcp_id IS NOT NULL AND h.hcp_id IS NULL
UNION ALL SELECT 'orphan sales.rep_id', COUNT(*)
  FROM sales s LEFT JOIN sales_reps r ON r.rep_id = s.rep_id WHERE r.rep_id IS NULL
UNION ALL SELECT 'orphan prescriptions.hcp_id', COUNT(*)
  FROM prescriptions p LEFT JOIN hcps h ON h.hcp_id = p.hcp_id WHERE h.hcp_id IS NULL
UNION ALL SELECT 'orphan prescriptions.drug_id', COUNT(*)
  FROM prescriptions p LEFT JOIN drugs d ON d.drug_id = p.drug_id WHERE d.drug_id IS NULL
UNION ALL SELECT 'orphan visits.hcp_id', COUNT(*)
  FROM visits v LEFT JOIN hcps h ON h.hcp_id = v.hcp_id WHERE h.hcp_id IS NULL
UNION ALL SELECT 'orphan hcps.city_id', COUNT(*)
  FROM hcps h LEFT JOIN cities c ON c.city_id = h.city_id WHERE c.city_id IS NULL
UNION ALL SELECT 'orphan sales_reps.manager_id', COUNT(*)
  FROM sales_reps r LEFT JOIN sales_reps m ON m.rep_id = r.manager_id
  WHERE r.manager_id IS NOT NULL AND m.rep_id IS NULL
UNION ALL SELECT 'sales with zero/negative revenue', COUNT(*)
  FROM sales WHERE revenue <= 0
UNION ALL SELECT 'inventory stock-flow identity broken', COUNT(*)
  FROM inventory_snapshots
  WHERE closing_stock <> opening_stock + units_in - units_out;
