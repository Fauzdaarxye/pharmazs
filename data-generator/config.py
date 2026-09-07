"""
PharmaZs synthetic data configuration (SRS §21, §22).

Everything tunable lives here so `generate.py` stays pure logic.

Why this file matters more than it looks: the *believability* of the whole
product comes from these tables. If a cardiologist prescribed oncology drugs at
random, every downstream KPI, score and forecast would be noise wearing a
business costume. The affinity matrix and the planted narratives are what make
the analytics find something real.
"""

from __future__ import annotations

import datetime as dt

# ---------------------------------------------------------------------------
# Reproducibility. A portfolio project must produce the same numbers every run,
# otherwise the screenshots in the README stop matching the database.
# ---------------------------------------------------------------------------
RANDOM_SEED = 42

# ---------------------------------------------------------------------------
# Time window: 24 complete months of history.
# ---------------------------------------------------------------------------
HISTORY_MONTHS = 24
END_MONTH = dt.date(2026, 8, 1)      # last complete month of history

# ---------------------------------------------------------------------------
# Volume targets. Sized to be big enough that window functions, forecasting and
# anomaly detection are meaningful, small enough to seed in well under a minute.
# ---------------------------------------------------------------------------
N_HCPS = 2000
N_REPS = 60
N_MANAGERS = 10
TARGET_PRESCRIPTIONS = 260_000
TARGET_VISITS = 70_000

CURRENCY = "INR"

# ---------------------------------------------------------------------------
# GEOGRAPHY — Indian market (matches the SRS's "North India" drill-down example)
# region -> (population_mn, demand_multiplier, [(city, tier), ...])
# demand_multiplier bakes in market maturity, not just population.
# ---------------------------------------------------------------------------
REGIONS: dict[str, dict] = {
    "North": {
        "population_mn": 380.0, "demand": 1.15, "zone_head": "Vikram Rathore",
        "cities": [("Delhi", 1), ("Gurugram", 1), ("Noida", 1), ("Chandigarh", 2),
                   ("Jaipur", 2), ("Lucknow", 2), ("Kanpur", 3)],
    },
    "South": {
        "population_mn": 260.0, "demand": 1.25, "zone_head": "Lakshmi Narayanan",
        "cities": [("Bengaluru", 1), ("Chennai", 1), ("Hyderabad", 1),
                   ("Kochi", 2), ("Coimbatore", 2), ("Visakhapatnam", 3)],
    },
    "West": {
        "population_mn": 210.0, "demand": 1.30, "zone_head": "Meera Deshpande",
        "cities": [("Mumbai", 1), ("Pune", 1), ("Ahmedabad", 1),
                   ("Surat", 2), ("Nagpur", 2), ("Rajkot", 3)],
    },
    "East": {
        "population_mn": 230.0, "demand": 0.85, "zone_head": "Arindam Basu",
        "cities": [("Kolkata", 1), ("Bhubaneswar", 2), ("Patna", 2),
                   ("Guwahati", 3), ("Ranchi", 3)],
    },
    "Central": {
        "population_mn": 160.0, "demand": 0.80, "zone_head": "Sanjay Tiwari",
        "cities": [("Bhopal", 2), ("Indore", 2), ("Raipur", 3), ("Jabalpur", 3)],
    },
}

# ---------------------------------------------------------------------------
# THERAPEUTIC AREAS (SRS §9)
# seasonality: 12 monthly multipliers, Jan..Dec. Respiratory spikes in winter,
# oncology is flat (chronic treatment), diabetes drifts up slightly year-round.
# ---------------------------------------------------------------------------
THERAPEUTIC_AREAS: dict[str, dict] = {
    "Cardiology": {
        "description": "Cardiovascular disease: hypertension, lipids, heart failure",
        "seasonality": [1.05, 1.04, 1.00, 0.98, 0.96, 0.95, 0.96, 0.98, 1.00, 1.02, 1.05, 1.07],
        "growth": 0.008,
    },
    "Diabetes": {
        "description": "Type 2 diabetes, insulin therapy and metabolic care",
        "seasonality": [1.02, 1.00, 1.00, 1.00, 1.01, 1.00, 0.99, 1.00, 1.01, 1.02, 1.03, 1.04],
        "growth": 0.012,
    },
    "Oncology": {
        "description": "Solid tumour and haematological oncology",
        "seasonality": [1.00] * 12,
        "growth": 0.015,
    },
    "Respiratory": {
        "description": "Asthma, COPD and allergic respiratory disease",
        "seasonality": [1.28, 1.20, 1.05, 0.92, 0.80, 0.75, 0.85, 0.90, 0.98, 1.10, 1.22, 1.32],
        "growth": 0.006,
    },
    "Neurology": {
        "description": "Epilepsy, neuropathic pain and neurodegenerative care",
        "seasonality": [1.01, 1.00, 1.00, 0.99, 0.99, 1.00, 1.00, 1.00, 1.01, 1.01, 1.00, 1.00],
        "growth": 0.009,
    },
    "Gastroenterology": {
        "description": "Acid-related disorders, IBD and hepatology",
        "seasonality": [1.03, 1.00, 0.99, 1.00, 1.02, 1.04, 1.05, 1.03, 1.00, 0.99, 1.00, 1.02],
        "growth": 0.005,
    },
}

# ---------------------------------------------------------------------------
# OUR PRODUCT CATALOGUE
# (drug_name, generic_name, TA, unit_price_INR, dosage_form, strength,
#  launch_year, base_strength)
# base_strength = relative market pull. The flagship of each TA is ~2x a tail brand.
# ---------------------------------------------------------------------------
DRUGS: list[tuple] = [
    # --- Cardiology ---
    ("CardioMax",   "Atorvastatin",           "Cardiology", 185.00, "Tablet", "40 mg",  2019, 2.60),
    ("CardioMax XR","Atorvastatin ER",        "Cardiology", 268.00, "Tablet", "80 mg",  2022, 1.35),
    ("Amlopress",   "Amlodipine",             "Cardiology",  62.50, "Tablet", "10 mg",  2017, 1.90),
    ("Telsartan-H", "Telmisartan+HCTZ",       "Cardiology", 148.00, "Tablet", "40/12.5 mg", 2020, 1.55),
    ("Clopigrel",   "Clopidogrel",            "Cardiology", 132.00, "Tablet", "75 mg",  2018, 1.20),
    ("Nebicard",    "Nebivolol",              "Cardiology",  96.00, "Tablet", "5 mg",   2021, 0.95),
    ("Rosuva-Q",    "Rosuvastatin",           "Cardiology", 210.00, "Tablet", "20 mg",  2023, 0.80),
    # --- Diabetes ---
    ("GlucoNorm",   "Metformin ER",           "Diabetes",    78.00, "Tablet", "1000 mg",2016, 2.40),
    ("GlucoNorm-V", "Metformin+Vildagliptin", "Diabetes",   225.00, "Tablet", "500/50 mg",2021, 1.80),
    ("Dapaglyn",    "Dapagliflozin",          "Diabetes",   310.00, "Tablet", "10 mg",  2022, 1.70),
    ("Insulex-N",   "Insulin Glargine",       "Diabetes",   842.00, "Injection","100 IU/mL",2018, 1.45),
    ("Sitaglip",    "Sitagliptin",            "Diabetes",   268.00, "Tablet", "100 mg", 2019, 1.30),
    ("Glimeprime",  "Glimepiride",            "Diabetes",    54.00, "Tablet", "2 mg",   2015, 1.00),
    ("Semaglin",    "Semaglutide",            "Diabetes",  1450.00, "Injection","1 mg", 2024, 0.70),
    # --- Oncology ---
    ("OncoShield",  "Trastuzumab",            "Oncology",  18500.00,"Injection","440 mg",2020, 1.85),
    ("Capecita-500","Capecitabine",           "Oncology",   1240.00,"Tablet", "500 mg", 2017, 1.40),
    ("Imatinex",    "Imatinib",               "Oncology",   2150.00,"Capsule","400 mg", 2016, 1.25),
    ("Pembrolix",   "Pembrolizumab",          "Oncology",  92000.00,"Injection","100 mg",2023, 0.85),
    ("Letrozide",   "Letrozole",              "Oncology",    285.00,"Tablet", "2.5 mg", 2015, 1.05),
    ("Bortezol",    "Bortezomib",             "Oncology",   8400.00,"Injection","3.5 mg",2021, 0.75),
    # --- Respiratory ---
    ("RespiCare",   "Budesonide+Formoterol",  "Respiratory", 445.00,"Inhaler","400/12 mcg",2018, 2.30),
    ("Montelair",   "Montelukast",            "Respiratory",  92.00,"Tablet", "10 mg",  2016, 1.75),
    ("Salbuair",    "Salbutamol",             "Respiratory",  68.00,"Inhaler","100 mcg",2014, 1.50),
    ("Tiotrop-HR",  "Tiotropium",             "Respiratory", 520.00,"Inhaler","18 mcg", 2020, 1.20),
    ("Fluticomb",   "Fluticasone+Salmeterol", "Respiratory", 398.00,"Inhaler","250/50 mcg",2019, 1.10),
    ("Doxofyl",     "Doxofylline",            "Respiratory", 124.00,"Tablet", "400 mg", 2022, 0.70),
    # --- Neurology ---
    ("NeuroCalm",   "Pregabalin",             "Neurology",   168.00,"Capsule","75 mg",  2017, 2.00),
    ("Levetira-XR", "Levetiracetam",          "Neurology",   242.00,"Tablet", "500 mg", 2018, 1.60),
    ("Divalpro",    "Divalproex",             "Neurology",   136.00,"Tablet", "500 mg", 2016, 1.30),
    ("Donecept",    "Donepezil",              "Neurology",   118.00,"Tablet", "10 mg",  2019, 1.00),
    ("Rasagilyn",   "Rasagiline",             "Neurology",   485.00,"Tablet", "1 mg",   2022, 0.80),
    ("Sumatrel",    "Sumatriptan",            "Neurology",   152.00,"Tablet", "50 mg",  2020, 0.90),
    # --- Gastroenterology ---
    ("GastroEase",  "Pantoprazole",           "Gastroenterology", 84.00,"Tablet","40 mg",2015, 2.20),
    ("Rabelex-DSR", "Rabeprazole+Domperidone","Gastroenterology",112.00,"Capsule","20/30 mg",2018, 1.85),
    ("Mesalaz-800", "Mesalamine",             "Gastroenterology",640.00,"Tablet","800 mg",2019, 1.15),
    ("Ursodiol-300","Ursodeoxycholic Acid",   "Gastroenterology",395.00,"Capsule","300 mg",2017, 0.95),
    ("Ondasef",     "Ondansetron",            "Gastroenterology", 46.00,"Tablet","4 mg", 2014, 1.05),
    ("Rifaximin-550","Rifaximin",             "Gastroenterology",890.00,"Tablet","550 mg",2021, 0.75),
]

# ---------------------------------------------------------------------------
# UNITS PER PRESCRIPTION, banded by unit price.
#
# A single draw of ~28 units for every drug is what broke the therapeutic-area
# mix: 28 units of a ₹92,000 immuno-oncology vial is ₹2.6 crore from ONE script,
# so oncology finished at 89% of company revenue and the TA card rendered as one
# full bar beside five slivers.
#
# Real dispensing scales inversely with unit cost. A cheap oral tablet goes out as
# a month's supply; a specialty injectable is dispensed per dose, a handful at a
# time. Bands below are (price_below, mean_units, sd_units) and are evaluated in
# order, so they double as a rough proxy for dosage form without needing a second
# lookup table.
# ---------------------------------------------------------------------------
UNITS_PER_SCRIPT_BANDS: list[tuple[float, float, float]] = [
    (150.0,      45.0, 14.0),   # cheap orals — monthly pack
    (500.0,      30.0, 10.0),   # standard orals / inhalers
    (2_000.0,    12.0,  4.0),   # higher-cost orals, insulin pens
    (10_000.0,    4.0,  1.5),   # specialty injectables, per-cycle
    (float("inf"), 1.6, 0.6),   # immuno-oncology biologics — per dose
]


def units_for_price(price: float) -> tuple[float, float]:
    """(mean, sd) units per prescription for a drug at this unit price."""
    for ceiling, mean, sd in UNITS_PER_SCRIPT_BANDS:
        if price < ceiling:
            return mean, sd
    return 1.6, 0.6


# ---------------------------------------------------------------------------
# HCP SPECIALTIES -> therapeutic-area affinity (SRS §21).
# "A cardiologist should be more likely to prescribe cardiovascular products."
# Rows need not sum to 1; they are normalised at draw time. Non-zero off-diagonal
# weights matter: real physicians have comorbid patients, and a perfectly block
# diagonal matrix would make the data look synthetic at a glance.
# ---------------------------------------------------------------------------
SPECIALTIES: dict[str, dict] = {
    "Cardiologist":      {"share": 0.16, "affinity": {"Cardiology": 0.78, "Diabetes": 0.12, "Neurology": 0.04, "Respiratory": 0.03, "Gastroenterology": 0.03}},
    "Diabetologist":     {"share": 0.14, "affinity": {"Diabetes": 0.80, "Cardiology": 0.13, "Neurology": 0.04, "Gastroenterology": 0.03}},
    "Endocrinologist":   {"share": 0.07, "affinity": {"Diabetes": 0.72, "Cardiology": 0.14, "Oncology": 0.06, "Neurology": 0.08}},
    "Oncologist":        {"share": 0.09, "affinity": {"Oncology": 0.84, "Gastroenterology": 0.09, "Respiratory": 0.04, "Cardiology": 0.03}},
    "Pulmonologist":     {"share": 0.11, "affinity": {"Respiratory": 0.85, "Cardiology": 0.07, "Oncology": 0.05, "Gastroenterology": 0.03}},
    "Neurologist":       {"share": 0.10, "affinity": {"Neurology": 0.83, "Cardiology": 0.07, "Diabetes": 0.06, "Gastroenterology": 0.04}},
    "Gastroenterologist":{"share": 0.09, "affinity": {"Gastroenterology": 0.86, "Oncology": 0.07, "Diabetes": 0.04, "Cardiology": 0.03}},
    "General Physician": {"share": 0.18, "affinity": {"Cardiology": 0.26, "Diabetes": 0.26, "Respiratory": 0.20, "Gastroenterology": 0.18, "Neurology": 0.08, "Oncology": 0.02}},
    "Consultant Physician": {"share": 0.06, "affinity": {"Cardiology": 0.24, "Diabetes": 0.22, "Gastroenterology": 0.20, "Respiratory": 0.16, "Neurology": 0.14, "Oncology": 0.04}},
}

QUALIFICATIONS = ["MBBS, MD", "MBBS, MD, DM", "MBBS, DNB", "MBBS, MD, FACC",
                  "MBBS, MS", "MBBS, MD, FRCP", "MBBS, DM"]

HOSPITAL_PREFIXES = ["Apollo", "Fortis", "Max", "Manipal", "Medanta", "Narayana",
                     "Kokilaben", "AIIMS", "Ruby Hall", "Lilavati", "Artemis",
                     "Sir Ganga Ram", "Jaslok", "CMC", "KIMS", "Yashoda"]
HOSPITAL_SUFFIXES = ["Hospital", "Multispeciality Hospital", "Medical Centre",
                     "Institute of Medical Sciences", "Heart Institute", "Super Speciality Hospital"]

# ---------------------------------------------------------------------------
# COMPETITORS (SRS §11, §25)
# ---------------------------------------------------------------------------
COMPETITORS = [
    ("Zenith Pharma",      "Switzerland"),
    ("Aurora Life Sciences","United States"),
    ("Meridian Healthcare","Germany"),
    ("Kalpa Biotech",      "India"),
    ("Nordwest Pharma",    "Denmark"),
    ("Sentinel Therapeutics","United Kingdom"),
]

# competitor brand -> (competitor company, TA, our rival brand, unit price)
COMPETITOR_DRUGS = [
    ("Lipitrust",   "Zenith Pharma",        "Cardiology",  "CardioMax",   198.00),
    ("Statiwell",   "Aurora Life Sciences", "Cardiology",  "CardioMax",   172.00),
    ("Amlogard",    "Kalpa Biotech",        "Cardiology",  "Amlopress",    58.00),
    ("Telmizen",    "Meridian Healthcare",  "Cardiology",  "Telsartan-H", 155.00),
    ("Plavitor",    "Sentinel Therapeutics","Cardiology",  "Clopigrel",   140.00),
    ("Metaforce",   "Kalpa Biotech",        "Diabetes",    "GlucoNorm",    72.00),
    ("Vildagard",   "Zenith Pharma",        "Diabetes",    "GlucoNorm-V", 240.00),
    ("Dapavia",     "Nordwest Pharma",      "Diabetes",    "Dapaglyn",    328.00),
    ("Glarilong",   "Nordwest Pharma",      "Diabetes",    "Insulex-N",   880.00),
    ("Sitawell",    "Aurora Life Sciences", "Diabetes",    "Sitaglip",    255.00),
    ("Semavia",     "Nordwest Pharma",      "Diabetes",    "Semaglin",   1520.00),
    ("Herzumab",    "Meridian Healthcare",  "Oncology",    "OncoShield",19200.00),
    ("Xelocap",     "Kalpa Biotech",        "Oncology",    "Capecita-500",1180.00),
    ("Gliventa",    "Zenith Pharma",        "Oncology",    "Imatinex",   2280.00),
    ("Keytralon",   "Aurora Life Sciences", "Oncology",    "Pembrolix", 95000.00),
    ("Femazole",    "Sentinel Therapeutics","Oncology",    "Letrozide",   298.00),
    ("Budeform",    "Meridian Healthcare",  "Respiratory", "RespiCare",   468.00),
    ("Montekast",   "Kalpa Biotech",        "Respiratory", "Montelair",    88.00),
    ("Ventolair",   "Sentinel Therapeutics","Respiratory", "Salbuair",     74.00),
    ("Spirivent",   "Meridian Healthcare",  "Respiratory", "Tiotrop-HR",  545.00),
    ("Seroflow",    "Zenith Pharma",        "Respiratory", "Fluticomb",   410.00),
    ("Pregasure",   "Aurora Life Sciences", "Neurology",   "NeuroCalm",   180.00),
    ("Keppralev",   "Sentinel Therapeutics","Neurology",   "Levetira-XR", 250.00),
    ("Valprodin",   "Kalpa Biotech",        "Neurology",   "Divalpro",    128.00),
    ("Memocept",    "Zenith Pharma",        "Neurology",   "Donecept",    124.00),
    ("Pantovia",    "Kalpa Biotech",        "Gastroenterology", "GastroEase", 79.00),
    ("Rabimax",     "Sentinel Therapeutics","Gastroenterology", "Rabelex-DSR",118.00),
    ("Mesacol-800", "Meridian Healthcare",  "Gastroenterology", "Mesalaz-800",672.00),
    ("Rifagut-550", "Aurora Life Sciences", "Gastroenterology", "Rifaximin-550",920.00),
]

# ---------------------------------------------------------------------------
# NAME POOLS (synthetic — SRS §22: no real patient- or person-identifiable data)
# ---------------------------------------------------------------------------
FIRST_NAMES_M = ["Aarav","Vivaan","Aditya","Arjun","Rohan","Karan","Nikhil","Rahul",
                 "Siddharth","Ankit","Manish","Rajesh","Suresh","Amit","Vikas","Pranav",
                 "Harsh","Devendra","Sandeep","Gaurav","Kabir","Ishaan","Yash","Tarun",
                 "Naveen","Prateek","Abhishek","Varun","Mohit","Sameer"]
FIRST_NAMES_F = ["Ananya","Diya","Aadhya","Kavya","Ishita","Neha","Priya","Sneha",
                 "Pooja","Shreya","Ritu","Anjali","Meera","Divya","Nandini","Swati",
                 "Aarohi","Tanvi","Rachna","Sunita","Lata","Vaishnavi","Radhika","Sonal",
                 "Payal","Bhavna","Kirti","Deepa","Rashmi","Charu"]
LAST_NAMES = ["Sharma","Gupta","Mehta","Verma","Patel","Reddy","Iyer","Nair","Singh",
              "Kulkarni","Joshi","Desai","Rao","Chatterjee","Banerjee","Mukherjee",
              "Bose","Kapoor","Malhotra","Chopra","Agarwal","Bansal","Saxena","Trivedi",
              "Pillai","Menon","Shetty","Hegde","Deshmukh","Pawar","Jadhav","Bhat",
              "Chauhan","Rathore","Bhardwaj","Khanna","Sethi","Ahluwalia","Dutta","Ghosh"]

# ---------------------------------------------------------------------------
# PLANTED NARRATIVES (SRS §44 — the final demo scenario)
#
# This is the single most important block in the generator. The SRS demo is:
#   CardioMax, North India, sales down ~15%, prescriptions down ~8%,
#   HCP engagement down ~14%, competitor share up ~7pp, inventory down ~5%.
#
# We do NOT hard-code that sentence anywhere in the app. We instead bend the
# DATA so those effects are genuinely present, then let the SQL and the Python
# root-cause analyser rediscover them. That is the difference between a demo and
# a fake.
# ---------------------------------------------------------------------------
# Each value below is a TARGET PERIOD-OVER-PERIOD CHANGE, in percent, measured
# as mean(last `months_from_end` months) vs mean(the `months_from_end` months
# before that) — exactly the comparison the dashboards and the root-cause page
# make.
#
# They are deliberately NOT expressed as level multipliers. A -8% level
# multiplier does not produce a -8% reported change, because therapeutic-area
# seasonality and the secular growth trend move the baseline underneath it. The
# generator therefore runs a first pass with narratives OFF to learn the
# counterfactual baseline, then solves for the multiplier that makes the
# OBSERVED change equal the target (see generate.py::_calibrate).
NARRATIVES: list[dict] = [
    {
        "name": "cardiomax_north_decline",
        "drug": "CardioMax",
        "region": "North",
        "months_from_end": 3,
        "rx_change_pct": -8.0,           # prescriptions  -8%   (SRS §44)
        "revenue_change_pct": -15.0,     # revenue        -15%
        "visit_change_pct": -14.0,       # HCP engagement -14%
        "competitor_share_delta_pp": 7.0,  # competitor   +7 percentage points
        "inventory_change_pct": -5.0,    # stock          -5%
        "stockout_days": 4,
    },
    {
        # A second, different-shaped story: demand held up but supply collapsed.
        # This gives the root-cause analyser a case where the answer is inventory
        # rather than engagement, so the feature has to actually discriminate.
        "name": "respicare_east_stockout",
        "drug": "RespiCare",
        "region": "East",
        "months_from_end": 2,
        "rx_change_pct": -3.0,
        "revenue_change_pct": -28.0,
        "visit_change_pct": 2.0,
        "competitor_share_delta_pp": 3.0,
        # -24% is the floor physics allows here, not a softened ambition: with
        # ~1.35 months of cover, stock cannot fall faster than the region
        # consumes it, and consumption is itself falling in this scenario.
        # Asking for -45% would just clamp at zero replenishment and report a
        # miss, so the target states what a real supply failure would produce.
        "inventory_change_pct": -24.0,   # the actual cause
        "stockout_days": 11,
    },
    {
        # An upside anomaly. Growth must be detectable too, otherwise the
        # anomaly page reads as a fault log rather than an analytics tool.
        "name": "dapaglyn_west_surge",
        "drug": "Dapaglyn",
        "region": "West",
        "months_from_end": 4,
        "rx_change_pct": 22.0,
        "revenue_change_pct": 31.0,
        "visit_change_pct": 18.0,
        "competitor_share_delta_pp": -5.0,
        "inventory_change_pct": 15.0,
        "stockout_days": 0,
    },
]

# The three HCPs the SRS demo ends on (§27, §44). They are seeded as real,
# high-potential North-region cardiologists so the scorer ranks them on merit.
HERO_HCPS = [
    {"last_name": "Sharma", "first_name": "Rajesh",  "city": "Delhi",     "specialty": "Cardiologist"},
    {"last_name": "Gupta",  "first_name": "Anjali",  "city": "Gurugram",  "specialty": "Cardiologist"},
    {"last_name": "Mehta",  "first_name": "Vikram",  "city": "Noida",     "specialty": "Cardiologist"},
]

# ---------------------------------------------------------------------------
# DEMO LOGIN ACCOUNTS (SRS §3, §6). Password is intentionally weak and shared:
# this is a portfolio demo, and the README says so.
# ---------------------------------------------------------------------------
DEMO_PASSWORD = "PharmaZs@2026"
DEMO_USERS = [
    ("Admin User",        "admin@pharmazs.io",     "ADMIN"),
    ("Priya Raghavan",    "exec@pharmazs.io",      "EXECUTIVE"),
    ("Sandeep Kulkarni",  "manager@pharmazs.io",   "MANAGER"),
    ("Rohan Verma",       "rep@pharmazs.io",       "SALES_REP"),
    ("Neha Bansal",       "analyst@pharmazs.io",   "ANALYST"),
]

# ---------------------------------------------------------------------------
# HCP potential score weights (SRS §13). Must sum to 1.0.
# ---------------------------------------------------------------------------
SCORE_WEIGHTS = {
    "rx_volume": 0.40,
    "rx_growth": 0.25,
    "engagement": 0.15,
    "ta_relevance": 0.10,
    "competitor_opportunity": 0.10,
}
assert abs(sum(SCORE_WEIGHTS.values()) - 1.0) < 1e-9, "SRS §13 weights must sum to 100%"

PRIORITY_BANDS = [(80, "HIGH"), (50, "MEDIUM"), (0, "LOW")]   # SRS §13
