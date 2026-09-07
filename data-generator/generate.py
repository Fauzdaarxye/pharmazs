#!/usr/bin/env python3
"""
PharmaIQ synthetic data generator (SRS §21, §22).

Produces a CSV per table into ./out, ready for LOAD DATA INFILE.

    python generate.py --out ./out

Design of the generation model
------------------------------
The generator is *causal*, not table-by-table. Prescriptions are simulated
first, at the level of an individual physician, and then sales, visits,
inventory and market share are derived from (or correlated with) that
prescription stream.

That ordering is the whole point. If each table were filled independently with
plausible-looking random numbers, then "revenue fell because prescriptions fell"
would be untrue in the data, and the root-cause page — the product's headline
feature — would report a correlation that does not exist. Because sales are
derived from prescriptions here, the causal chain the dashboards claim to find is
genuinely there to be found.

Realism levers, in rough order of importance:
  1. specialty -> therapeutic-area affinity   (a cardiologist prescribes cardio)
  2. per-physician productivity (lognormal)   (a few high prescribers dominate)
  3. therapeutic-area seasonality             (respiratory spikes in winter)
  4. regional demand multipliers              (West/South are richer markets)
  5. per-physician random-walk trend          (individual doctors drift)
  6. planted narrative shocks                 (the SRS demo, see below)

Two-pass narrative calibration
------------------------------
The SRS demo (§44) is stated as period-over-period CHANGES: CardioMax in North
with sales -15%, prescriptions -8%, engagement -14%, competitor share +7pp,
inventory -5%.

Applying a 0.85 multiplier to revenue does NOT produce a -15% reported change,
because therapeutic-area seasonality and the secular growth trend move the
baseline underneath the shock. A first attempt at this generator did exactly
that and measured -10.1% instead of -15%; for a respiratory brand the winter
seasonality was strong enough to turn an intended -28% into +1.6%.

So the generator runs TWO passes:
  pass 1  narratives off -> record the counterfactual baseline per (drug, region, month)
  pass 2  solve for the multiplier that makes the OBSERVED change equal the
          target, then simulate again with it applied

`self.rng` is reseeded identically at the start of each pass, and all
narrative-related coin flips draw from a SEPARATE stream (`self.nrng`) so that
adding or dropping rows in pass 2 cannot desynchronise the main stream. That
keeps the two passes comparable, which is what makes the solved multiplier
accurate rather than approximate.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config as C  # noqa: E402


# ===========================================================================
# helpers
# ===========================================================================
def month_starts(end_month: dt.date, count: int) -> list[dt.date]:
    """`count` month-start dates ending at (and including) end_month."""
    out: list[dt.date] = []
    y, m = end_month.year, end_month.month
    for _ in range(count):
        out.append(dt.date(y, m, 1))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))


def days_in_month(d: dt.date) -> int:
    nxt = dt.date(d.year + (d.month == 12), (d.month % 12) + 1, 1)
    return (nxt - d).days


def mean(vals) -> float:
    vals = list(vals)
    return sum(vals) / len(vals) if vals else 0.0


def bcrypt_hash(password: str) -> str:
    """
    bcrypt hash for the demo users.

    We use the real `bcrypt` package so the Node backend can verify these hashes
    directly. If it is missing we emit an obvious sentinel rather than a
    plausible-looking fake, because a fake would fail at login with a confusing
    "invalid credentials" instead of an explicit setup error.
    """
    try:
        import bcrypt
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()
    except ImportError:
        return "NEEDS_BCRYPT_" + hashlib.sha256(password.encode()).hexdigest()[:32]


class Writer:
    """Thin CSV writer that remembers row counts for the summary."""

    def __init__(self, outdir: Path):
        self.outdir = outdir
        self.counts: dict[str, int] = {}

    def write(self, table: str, header: list[str], rows: list[tuple]) -> None:
        path = self.outdir / f"{table}.csv"
        with path.open("w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
            w.writerow(header)
            w.writerows(rows)
        self.counts[table] = len(rows)
        print(f"  {table:<24} {len(rows):>9,} rows")


# ===========================================================================
# generator
# ===========================================================================
class PharmaIQGenerator:
    def __init__(self, seed: int = C.RANDOM_SEED):
        self.seed = seed
        self.rng = np.random.default_rng(seed)
        self.months = month_starts(C.END_MONTH, C.HISTORY_MONTHS)
        self.month_index = {m: i for i, m in enumerate(self.months)}
        self.collect = True          # False during the baseline pass

    # =======================================================================
    # DIMENSIONS — built once, before either fact pass
    # =======================================================================
    def build_regions(self):
        self.regions = []
        self.region_id = {}
        self.region_demand = {}
        for i, (name, meta) in enumerate(C.REGIONS.items(), start=1):
            self.region_id[name] = i
            self.region_demand[i] = meta["demand"]
            self.regions.append((i, name, meta["zone_head"], meta["population_mn"]))

        self.cities = []
        self.city_ids_by_region = defaultdict(list)
        self.city_names_by_region = defaultdict(list)
        self.city_id_by_name = {}
        self.region_of_city = {}
        cid = 0
        for name, meta in C.REGIONS.items():
            rid = self.region_id[name]
            for city, tier in meta["cities"]:
                cid += 1
                self.cities.append((cid, rid, city, f"TIER_{tier}"))
                self.city_ids_by_region[rid].append(cid)
                self.city_names_by_region[rid].append(city)
                self.city_id_by_name[city] = cid
                self.region_of_city[cid] = rid

    def build_products(self):
        self.tas = []
        self.ta_id = {}
        self.ta_season = {}
        self.ta_growth = {}
        for i, (name, meta) in enumerate(C.THERAPEUTIC_AREAS.items(), start=1):
            self.ta_id[name] = i
            self.ta_season[i] = meta["seasonality"]
            self.ta_growth[i] = meta["growth"]
            self.tas.append((i, name, meta["description"]))

        self.drugs = []
        self.drug_id = {}
        self.drug_meta = {}
        self.drugs_by_ta = defaultdict(list)
        for i, (name, generic, ta, price, form, strength, launch_y, strength_f) in enumerate(C.DRUGS, start=1):
            tid = self.ta_id[ta]
            launch = dt.date(launch_y, int(self.rng.integers(1, 13)), 1)
            self.drug_id[name] = i
            self.drug_meta[i] = {"name": name, "ta_id": tid, "price": price,
                                 "base_strength": strength_f, "launch": launch}
            self.drugs_by_ta[tid].append(i)
            self.drugs.append((i, f"DRG-{i:04d}", name, generic, tid, f"{price:.2f}",
                               form, strength, launch.isoformat(), 1))
        # Pack-size band per drug, resolved once (hot path in the sim).
        self.units_band = {d: C.units_for_price(m["price"]) for d, m in self.drug_meta.items()}
        # Precompute per-TA brand-strength weight vectors (hot path in the sim).
        self.ta_pool = {t: np.array(v, dtype=int) for t, v in self.drugs_by_ta.items()}
        self.ta_weights = {
            t: np.array([self.drug_meta[d]["base_strength"] for d in v], dtype=float)
            for t, v in self.drugs_by_ta.items()
        }

    def build_competitors(self):
        self.competitors = []
        self.competitor_id = {}
        for i, (name, hq) in enumerate(C.COMPETITORS, start=1):
            self.competitor_id[name] = i
            self.competitors.append((i, name, hq))

        self.competitor_drugs = []
        self.comp_drug_for_our_drug = defaultdict(list)
        for i, (cname, company, ta, rival, price) in enumerate(C.COMPETITOR_DRUGS, start=1):
            rid = self.drug_id[rival]
            self.competitor_drugs.append((i, self.competitor_id[company], cname,
                                          self.ta_id[ta], rid, f"{price:.2f}"))
            self.comp_drug_for_our_drug[rid].append(i)

    def build_hcps(self):
        rng = self.rng
        spec_names = list(C.SPECIALTIES)
        spec_p = np.array([C.SPECIALTIES[s]["share"] for s in spec_names], dtype=float)
        spec_p /= spec_p.sum()

        # HCP density follows regional demand x city tier: richer, bigger cities
        # carry denser physician panels.
        city_weights = np.array(
            [self.region_demand[rid] * {"TIER_1": 2.2, "TIER_2": 1.2, "TIER_3": 0.6}[tier]
             for _cid, rid, _city, tier in self.cities], dtype=float)
        city_weights /= city_weights.sum()

        self.hcps = []
        self.hcp_meta = {}
        next_id = 0

        # Hero HCPs first (SRS §27/§44) so they hold low, stable ids.
        for hero in C.HERO_HCPS:
            next_id += 1
            cid = self.city_id_by_name[hero["city"]]
            self._make_hcp(next_id, hero["first_name"], hero["last_name"],
                           hero["specialty"], cid, self.region_of_city[cid],
                           tier="A", productivity=float(rng.uniform(2.6, 3.1)),
                           trend=float(rng.uniform(0.010, 0.020)))

        n_rest = C.N_HCPS - len(C.HERO_HCPS)
        spec_draw = rng.choice(len(spec_names), size=n_rest, p=spec_p)
        city_draw = rng.choice(len(self.cities), size=n_rest, p=city_weights)
        # Lognormal productivity: prescribing is heavily top-skewed — a small
        # number of physicians drive a large share of total volume.
        prod_draw = rng.lognormal(mean=0.0, sigma=0.55, size=n_rest)
        trend_draw = rng.normal(0.004, 0.011, size=n_rest)

        for k in range(n_rest):
            next_id += 1
            cid, rid, _city, _tier = self.cities[city_draw[k]]
            prod = float(prod_draw[k])
            first = (rng.choice(C.FIRST_NAMES_M) if rng.random() < 0.62
                     else rng.choice(C.FIRST_NAMES_F))
            self._make_hcp(next_id, str(first), str(rng.choice(C.LAST_NAMES)),
                           spec_names[spec_draw[k]], cid, rid,
                           tier="A" if prod > 1.75 else ("B" if prod > 0.85 else "C"),
                           productivity=prod, trend=float(trend_draw[k]))

    def _make_hcp(self, hid, first, last, specialty, city_id, region_id,
                  tier, productivity, trend):
        rng = self.rng
        yrs = int(np.clip(rng.normal(16, 7), 3, 42))
        pv = int(np.clip(rng.normal(420, 160) * productivity, 60, 2600))
        onboard = dt.date(2026, 9, 1) - dt.timedelta(days=int(rng.integers(200, 3200)))
        self.hcps.append((
            hid, f"HCP-{hid:05d}", f"Dr. {first} {last}", specialty,
            str(rng.choice(C.QUALIFICATIONS)),
            f"{rng.choice(C.HOSPITAL_PREFIXES)} {rng.choice(C.HOSPITAL_SUFFIXES)}",
            city_id, region_id, yrs, pv, tier,
            f"{first}.{last}{hid}".lower() + "@example-health.org",
            f"+91-{rng.integers(70, 99)}{rng.integers(10000000, 99999999)}",
            onboard.isoformat(), 1,
        ))
        aff = C.SPECIALTIES[specialty]["affinity"]
        ta_p = np.array(list(aff.values()), dtype=float)
        self.hcp_meta[hid] = {
            "specialty": specialty, "region_id": region_id, "city_id": city_id,
            "tier": tier, "productivity": productivity, "trend": trend,
            "ta_ids": np.array([self.ta_id[t] for t in aff], dtype=int),
            "ta_p": ta_p / ta_p.sum(),
        }

    def build_reps(self):
        rng = self.rng
        self.reps = []
        self.rep_ids_by_region = defaultdict(list)
        self.manager_ids_by_region = defaultdict(list)
        region_ids = [r[0] for r in self.regions]
        next_id = 0

        for rid in (region_ids * 4)[: C.N_MANAGERS]:
            next_id += 1
            first, last = str(rng.choice(C.FIRST_NAMES_M + C.FIRST_NAMES_F)), str(rng.choice(C.LAST_NAMES))
            hire = dt.date(2026, 9, 1) - dt.timedelta(days=int(rng.integers(1500, 4000)))
            zone = next(r[1] for r in self.regions if r[0] == rid)
            self.reps.append((next_id, f"MGR-{next_id:04d}", f"{first} {last}",
                              f"{first.lower()}.{last.lower()}{next_id}@pharmaiq.io",
                              rid, "", f"{zone} Zone", hire.isoformat(),
                              f"{float(rng.integers(90, 150)) * 1e6:.2f}", 1))
            self.manager_ids_by_region[rid].append(next_id)

        weights = np.array([self.region_demand[r] for r in region_ids], dtype=float)
        weights /= weights.sum()
        alloc = np.floor(weights * C.N_REPS).astype(int)
        while alloc.sum() < C.N_REPS:
            alloc[int(np.argmax(weights))] += 1

        for ridx, rid in enumerate(region_ids):
            for _ in range(int(alloc[ridx])):
                next_id += 1
                first, last = str(rng.choice(C.FIRST_NAMES_M + C.FIRST_NAMES_F)), str(rng.choice(C.LAST_NAMES))
                hire = dt.date(2026, 9, 1) - dt.timedelta(days=int(rng.integers(120, 3000)))
                city = str(rng.choice(self.city_names_by_region[rid]))
                self.reps.append((next_id, f"REP-{next_id:04d}", f"{first} {last}",
                                  f"{first.lower()}.{last.lower()}{next_id}@pharmaiq.io",
                                  rid, int(rng.choice(self.manager_ids_by_region[rid])),
                                  f"{city} Territory", hire.isoformat(),
                                  f"{float(rng.integers(18, 42)) * 1e6:.2f}", 1))
                self.rep_ids_by_region[rid].append(next_id)

    def build_assignments(self):
        """Give every HCP exactly one current rep from their own region."""
        rng = self.rng
        self.assignments = []
        self.rep_panel = defaultdict(list)
        self.rep_for_hcp = {}
        aid = 0
        for hid, meta in self.hcp_meta.items():
            pool = self.rep_ids_by_region[meta["region_id"]]
            if not pool:
                continue
            rep = int(rng.choice(pool))
            aid += 1
            start = self.months[0] - dt.timedelta(days=int(rng.integers(30, 400)))
            self.assignments.append((aid, rep, hid, start.isoformat(), ""))
            self.rep_panel[rep].append(hid)
            self.rep_for_hcp[hid] = rep

    def build_targets(self):
        """
        Set monthly quotas FROM each rep's simulated revenue.

        Targets used to be drawn independently (₹1.8-4.2 Cr per rep per year),
        which put the company-wide quota at ~₹14 Cr/month against ~₹97 Cr/month of
        actual revenue. Every rep then showed ~700% attainment and the dashboard's
        target line sat flat on the chart floor — the KPI was unreadable and the
        "achievement %" column was meaningless.

        A quota is a forecast of a territory, so it has to be derived from that
        territory's expected performance. Each rep's monthly target is their own
        simulated revenue perturbed by a modest factor, which lands attainment in a
        realistic 85-115% band with genuine over- and under-performers. Requires
        the fact pass to have run first.
        """
        rng = self.rng
        self.targets = []
        tid = 0
        # A per-rep bias persists across months: a rep who is behind plan tends to
        # stay behind, which is what makes the leaderboard meaningful.
        rep_bias = {}
        annual: dict[int, float] = defaultdict(float)

        for rep_id, _code, _name, _email, _rid, mgr, _terr, _hire, _annual, _act in self.reps:
            if mgr == "":                     # managers carry zone targets, not quotas
                continue
            bias = float(rng.normal(1.0, 0.09))
            rep_bias[rep_id] = float(np.clip(bias, 0.82, 1.18))
            for m in self.months:
                actual = self.rep_month_revenue.get((rep_id, m), 0.0)
                if actual <= 0:
                    continue
                target = actual * rep_bias[rep_id] * float(rng.uniform(0.97, 1.03))
                tid += 1
                self.targets.append((tid, rep_id, m.isoformat(), f"{target:.2f}"))
                annual[rep_id] += target

        # Rewrite each rep's annual_target so the dimension agrees with the monthly
        # quota rows; a manager's zone target is the sum of their team's.
        team_of = defaultdict(list)
        for rep_id, _c, _n, _e, _r, mgr, _t, _h, _a, _act in self.reps:
            if mgr != "":
                team_of[int(mgr)].append(rep_id)

        last12 = self.months[-12:]
        rebuilt = []
        for row in self.reps:
            rep_id, code, name, email, rid, mgr, terr, hire, _old, act = row
            if mgr == "":
                total = sum(
                    sum(self.rep_month_revenue.get((r, m), 0.0) for m in last12)
                    * rep_bias.get(r, 1.0)
                    for r in team_of.get(rep_id, [])
                )
            else:
                total = sum(self.rep_month_revenue.get((rep_id, m), 0.0) for m in last12) \
                    * rep_bias.get(rep_id, 1.0)
            rebuilt.append((rep_id, code, name, email, rid, mgr, terr, hire,
                            f"{max(total, 1_000_000.0):.2f}", act))
        self.reps = rebuilt

    def build_users(self):
        pw = bcrypt_hash(C.DEMO_PASSWORD)
        self.users = []
        first_rep = next((r[0] for r in self.reps if r[5] != ""), None)
        first_mgr = next((r[0] for r in self.reps if r[5] == ""), None)
        for i, (name, email, role) in enumerate(C.DEMO_USERS, start=1):
            rep_id, region = "", ""
            if role == "SALES_REP" and first_rep:
                rep_id = first_rep
                region = next(r[4] for r in self.reps if r[0] == first_rep)
            elif role == "MANAGER" and first_mgr:
                rep_id = first_mgr
                region = next(r[4] for r in self.reps if r[0] == first_mgr)
            self.users.append((i, name, email, pw, role, rep_id, region, 1))

    # =======================================================================
    # NARRATIVE PLUMBING
    # =======================================================================
    def build_narrative_index(self):
        """Which (drug, region, month) cells and (region, month) pairs a
        narrative touches. Multipliers are filled in later by _calibrate."""
        self.nar_cells: dict[tuple[int, int, dt.date], dict] = {}
        self.nar_regions: dict[tuple[int, dt.date], list[dict]] = defaultdict(list)
        for nar in C.NARRATIVES:
            did, rid = self.drug_id[nar["drug"]], self.region_id[nar["region"]]
            for m in self.months[-nar["months_from_end"]:]:
                self.nar_cells[(did, rid, m)] = nar
                self.nar_regions[(rid, m)].append(nar)

        # Solved multipliers; identity until _calibrate runs.
        self.lam_rx: dict[tuple[int, int, dt.date], float] = {}
        self.lam_sales: dict[tuple[int, int, dt.date], float] = {}
        self.lam_visit: dict[tuple[int, dt.date], float] = {}
        self.inv_target: dict[tuple[int, int, dt.date], float] = {}
        self.share_offset: dict[tuple[int, int, dt.date], float] = {}

    def _windows(self, nar) -> tuple[list[dt.date], list[dt.date]]:
        k = nar["months_from_end"]
        return self.months[-k:], self.months[-2 * k:-k]

    def _calibrate(self, base: dict) -> None:
        """
        Solve for the multiplier that makes the OBSERVED period-over-period
        change equal the configured target.

        For a metric with baseline monthly values B, prior-window mean P and
        recent-window mean R, scaling every recent month by

            lambda = P * (1 + target) / R

        makes the recent mean exactly P*(1+target), i.e. the reported change is
        the target by construction — regardless of what seasonality or trend was
        doing underneath.
        """
        for nar in C.NARRATIVES:
            did, rid = self.drug_id[nar["drug"]], self.region_id[nar["region"]]
            recent, prior = self._windows(nar)

            # --- prescriptions -------------------------------------------------
            P = mean(base["rx_units"].get((did, rid, m), 0) for m in prior)
            R = mean(base["rx_units"].get((did, rid, m), 0) for m in recent)
            lam_rx = (P * (1 + nar["rx_change_pct"] / 100.0) / R) if R else 1.0
            for m in recent:
                self.lam_rx[(did, rid, m)] = lam_rx

            # --- revenue (residual on top of what the rx move already causes) ---
            Pv = mean(base["sales_revenue"].get((did, rid, m), 0.0) for m in prior)
            Rv = mean(base["sales_revenue"].get((did, rid, m), 0.0) for m in recent)
            lam_rev = (Pv * (1 + nar["revenue_change_pct"] / 100.0) / Rv) if Rv else 1.0
            for m in recent:
                self.lam_sales[(did, rid, m)] = (lam_rev / lam_rx) if lam_rx else 1.0

            # --- engagement: regional, so the region's own KPI moves too --------
            Pvi = mean(base["visit_count"].get((rid, m), 0) for m in prior)
            Rvi = mean(base["visit_count"].get((rid, m), 0) for m in recent)
            lam_v = (Pvi * (1 + nar["visit_change_pct"] / 100.0) / Rvi) if Rvi else 1.0
            for m in recent:
                # Several narratives could touch one region; compose them.
                self.lam_visit[(rid, m)] = self.lam_visit.get((rid, m), 1.0) * lam_v

            # --- inventory: hit the target by steering closing stock ------------
            Pi = mean(base["closing_stock"].get((did, rid, m), 0) for m in prior)
            Ri = mean(base["closing_stock"].get((did, rid, m), 0) for m in recent)
            lam_i = (Pi * (1 + nar["inventory_change_pct"] / 100.0) / Ri) if Ri else 1.0
            for m in recent:
                self.inv_target[(did, rid, m)] = base["closing_stock"].get((did, rid, m), 0) * lam_i

            # --- competitor share: additive percentage points -------------------
            Pc = mean(base["comp_share"].get((did, rid, m), 0.0) for m in prior)
            Rc = mean(base["comp_share"].get((did, rid, m), 0.0) for m in recent)
            offset = (Pc + nar["competitor_share_delta_pp"]) - Rc
            for m in recent:
                self.share_offset[(did, rid, m)] = offset

    # =======================================================================
    # FACTS
    # =======================================================================
    def _reset_accumulators(self):
        self.rx_units = defaultdict(int)
        self.rx_count = defaultdict(int)
        self.sales_units = defaultdict(int)
        self.sales_revenue = defaultdict(float)
        self.visit_count = defaultdict(int)
        self.rep_month_revenue = defaultdict(float)
        self.closing_stock = {}
        self.comp_share = {}
        self.prescriptions = []
        self.sales = []
        self.visits = []
        self.inventory = []
        self.market_share = []

    def simulate(self, apply_narrative: bool):
        """
        One full fact pass.

        Each fact table draws from its OWN independent, deterministically-seeded
        stream. That decoupling is essential rather than cosmetic: a narrative
        changes how many rows a table emits (a suppressed cell yields fewer sale
        rows), so with one shared stream every table downstream of the shock
        would consume different draws in the two passes. Its "baseline" would
        then not be a baseline at all, and the solved multipliers would be
        calibrated against noise. Per-table streams make each table's
        counterfactual bit-identical across passes by construction.
        """
        self.rng = np.random.default_rng(self.seed)              # prescriptions
        self.srng = np.random.default_rng(self.seed + 1_001)     # sales
        self.vrng = np.random.default_rng(self.seed + 2_002)     # visits
        self.irng = np.random.default_rng(self.seed + 3_003)     # inventory
        self.mrng = np.random.default_rng(self.seed + 4_004)     # market share
        self.nrng = np.random.default_rng(self.seed + 9_999)     # narrative coin flips
        self.apply_nar = apply_narrative
        self._reset_accumulators()
        self._sim_prescriptions()
        self._sim_sales()
        self._sim_visits()
        self._sim_inventory()
        self._sim_market_share()

    def _sim_prescriptions(self):
        """
        Physician-level simulation. For each HCP-month we draw a Poisson count of
        prescribing events, pick a therapeutic area from that physician's
        affinity vector, then a drug within it weighted by brand strength.
        """
        rng, nrng = self.rng, self.nrng
        rows = self.prescriptions
        avg_prod = float(np.mean([m["productivity"] for m in self.hcp_meta.values()]))
        base_rate = C.TARGET_PRESCRIPTIONS / (C.N_HCPS * C.HISTORY_MONTHS * avg_prod)
        tier_mult = {"A": 1.55, "B": 1.0, "C": 0.62}
        rx_id = 0

        for mi, month in enumerate(self.months):
            season_idx = month.month - 1
            ndays = days_in_month(month)
            for hid, meta in self.hcp_meta.items():
                rid = meta["region_id"]
                lam = (base_rate * meta["productivity"] * tier_mult[meta["tier"]]
                       * self.region_demand[rid] * (1.0 + meta["trend"]) ** mi)
                n_events = int(rng.poisson(max(lam, 0.05)))
                if n_events == 0:
                    continue
                for tid in rng.choice(meta["ta_ids"], size=n_events, p=meta["ta_p"]):
                    tid = int(tid)
                    ta_factor = (self.ta_season[tid][season_idx]
                                 * (1.0 + self.ta_growth[tid]) ** mi)
                    if rng.random() > min(ta_factor / 1.35, 1.0):
                        continue
                    w = self.ta_weights[tid] * np.array(
                        [self.drug_meta[d]["launch"] <= month for d in self.ta_pool[tid]],
                        dtype=float)
                    tot = w.sum()
                    if tot <= 0:
                        continue
                    did = int(rng.choice(self.ta_pool[tid], p=w / tot))
                    # Pack size scales inversely with unit price (see
                    # config.UNITS_PER_SCRIPT_BANDS): a cheap oral goes out as a
                    # month's supply, a ₹92k biologic goes out per dose.
                    u_mean, u_sd = self.units_band[did]
                    units = int(max(1, round(rng.normal(u_mean, u_sd))))
                    patients = int(np.clip(units / rng.uniform(1.2, 9.0), 1, 22))
                    day = int(rng.integers(1, ndays + 1))
                    new_pt = 1 if rng.random() < 0.24 else 0

                    # --- narrative: scale this cell's volume ------------------
                    reps = 1
                    if self.apply_nar:
                        lam_rx = self.lam_rx.get((did, rid, month), 1.0)
                        if lam_rx < 1.0:
                            if nrng.random() > lam_rx:
                                continue                     # suppress
                        elif lam_rx > 1.0:
                            extra = lam_rx - 1.0
                            reps = 1 + int(extra) + (1 if nrng.random() < extra % 1.0 else 0)

                    for r in range(reps):
                        rx_id += 1
                        u = units if r == 0 else int(max(1, round(units * nrng.uniform(0.8, 1.2))))
                        d = day if r == 0 else int(nrng.integers(1, ndays + 1))
                        if self.collect:
                            rows.append((rx_id, hid, did, rid,
                                         dt.date(month.year, month.month, d).isoformat(),
                                         u, patients, new_pt))
                        self.rx_units[(did, rid, month)] += u
                        self.rx_count[(did, rid, month)] += 1

    def _sim_sales(self):
        """
        Sales are DERIVED from the prescription stream: units for a
        (drug, region, month) cell convert from prescribed units, plus an
        institutional/tender component that does not trace to a single HCP.

        This is what makes "revenue fell because prescriptions fell" true in the
        data rather than merely asserted in the UI.
        """
        rng, nrng = self.srng, self.nrng
        rows = self.sales
        sale_id = 0
        hcps_by_region = defaultdict(list)
        for hid, meta in self.hcp_meta.items():
            hcps_by_region[meta["region_id"]].append(hid)

        # Iterate a FIXED cell list rather than `self.rx_units.keys()`. A
        # narrative can add or remove a cell from that dict, which would shift
        # every subsequent cell's draws and make the per-cell conversion factors
        # differ between the baseline and narrative passes.
        for month in self.months:
            for did, dmeta in self.drug_meta.items():
                if dmeta["launch"] > month:
                    continue
                for rid in self.region_id.values():
                    rx_units = self.rx_units.get((did, rid, month), 0)
                    price = dmeta["price"]
                    conv = float(rng.uniform(0.86, 1.06))          # retail pickup rate
                    institutional = float(rng.uniform(0.10, 0.30))
                    n_rows = int(np.clip(rng.normal(42, 12), 8, 90))
                    splits_base = rng.dirichlet(np.ones(n_rows) * 2.2)
                    if rx_units <= 0:
                        continue
                    total_units = rx_units * conv * (1.0 + institutional)
                    if self.apply_nar:
                        total_units *= self.lam_sales.get((did, rid, month), 1.0)
                    if total_units <= 0:
                        continue

                    splits = splits_base * total_units
                    reps = self.rep_ids_by_region[rid] or [1]
                    cities = self.city_ids_by_region[rid]
                    hpool = hcps_by_region[rid]
                    ndays = days_in_month(month)

                    for u in splits:
                        units = int(round(u))
                        if units <= 0:
                            continue
                        sale_id += 1
                        cr = rng.random()
                        if cr < 0.62:
                            channel, hcp = "RETAIL", (int(rng.choice(hpool)) if hpool else "")
                        elif cr < 0.84:
                            channel, hcp = "HOSPITAL", (int(rng.choice(hpool)) if hpool else "")
                        elif cr < 0.95:
                            channel, hcp = "INSTITUTIONAL", ""     # tender: no single HCP
                        else:
                            channel, hcp = "ONLINE", (int(rng.choice(hpool)) if hpool else "")
                        disc = round(float(np.clip(rng.normal(6.5, 4.0), 0, 22)), 2)
                        eff_price = round(price * (1.0 + 0.004 * self.month_index[month])
                                          * float(rng.uniform(0.985, 1.015)), 2)
                        day = int(rng.integers(1, ndays + 1))
                        # Draw rep and city UNCONDITIONALLY so the stream advances
                        # identically whether or not rows are being collected.
                        rep_id = int(rng.choice(reps))
                        city_id = int(rng.choice(cities))
                        line_revenue = units * eff_price * (1 - disc / 100)
                        if self.collect:
                            rows.append((sale_id, did, hcp, rep_id, rid, city_id,
                                         dt.date(month.year, month.month, day).isoformat(),
                                         units, f"{eff_price:.2f}", f"{disc:.2f}", channel))
                        self.sales_units[(did, rid, month)] += units
                        self.sales_revenue[(did, rid, month)] += line_revenue
                        # Per-rep monthly revenue: this is what quotas are set from.
                        self.rep_month_revenue[(rep_id, month)] += line_revenue

    def _sim_visits(self):
        """
        Rep -> HCP call activity. Frequency tracks HCP tier; a narrative's
        engagement shock applies to the whole affected region.

        Counts and details deliberately use SEPARATE streams. The engagement
        multiplier changes the Poisson count, and each visit then consumes
        several detail draws — so on a single stream a shock would shift the
        draws of every physician iterated after it, adding noise far larger than
        the effect being measured (an early version swung East by 11pp against a
        2% target). Drawing all counts from `vrng` (exactly one draw per
        HCP-month, whatever the multiplier) keeps visit_count exactly
        lambda-scaled; details come from `vdrng`, where a varying draw count is
        harmless because it only affects attributes, never row counts.
        """
        crng = self.vrng                                  # counts
        drng = np.random.default_rng(self.seed + 5_005)    # details
        rows = self.visits
        vid = 0
        tier_freq = {"A": 1.9, "B": 1.15, "C": 0.55}
        raw = sum(tier_freq[m["tier"]] for m in self.hcp_meta.values()) * C.HISTORY_MONTHS
        scale = C.TARGET_VISITS / max(raw, 1)

        for month in self.months:
            ndays = days_in_month(month)
            for hid, meta in self.hcp_meta.items():
                rep = self.rep_for_hcp.get(hid)
                rid = meta["region_id"]
                lam = tier_freq[meta["tier"]] * scale
                if self.apply_nar:
                    lam *= self.lam_visit.get((rid, month), 1.0)
                n_visits = int(crng.poisson(max(lam, 0.02)))
                if rep is None:
                    continue
                for _ in range(n_visits):
                    vid += 1
                    d = dt.date(month.year, month.month, int(drng.integers(1, ndays + 1)))
                    vr, orr = drng.random(), drng.random()
                    vtype = ("IN_PERSON" if vr < 0.68 else "VIRTUAL" if vr < 0.86
                             else "PHONE" if vr < 0.96 else "CONFERENCE")
                    outcome = ("POSITIVE" if orr < 0.52 else "NEUTRAL" if orr < 0.87
                               else "NEGATIVE")
                    ta_pick = int(drng.choice(meta["ta_ids"], p=meta["ta_p"]))
                    pool = [x for x in self.drugs_by_ta[ta_pick]
                            if self.drug_meta[x]["launch"] <= month]
                    disc_drug = int(drng.choice(pool)) if pool else ""
                    duration = int(np.clip(drng.normal(22, 9), 5, 75))
                    samples = int(np.clip(drng.poisson(4), 0, 30))
                    if self.collect:
                        rows.append((vid, rep, hid, d.isoformat(), duration, vtype,
                                     outcome, samples, disc_drug, ""))
                    self.visit_count[(rid, month)] += 1

    def _sim_inventory(self):
        """
        Monthly stock snapshot per (drug, region), driven by units sold.

        The stock-flow identity opening + units_in - units_out = closing is
        preserved exactly. When a narrative targets inventory we hit the target
        by steering REPLENISHMENT (units_in), never by overwriting closing stock,
        so the table stays internally consistent and auditable.
        """
        rng = self.irng
        rows = self.inventory
        sid = 0
        carry: dict[tuple[int, int], int] = {}
        for month in self.months:
            for did, dmeta in self.drug_meta.items():
                if dmeta["launch"] > month:
                    continue
                for rid in self.region_id.values():
                    # Iterate EVERY launched (drug, region, month) cell, and never
                    # branch the loop on `out_units`. Sales volumes differ between
                    # the baseline and narrative passes, so skipping empty cells
                    # would make the two passes consume different numbers of
                    # random draws and desynchronise every later table.
                    out_units = self.sales_units.get((did, rid, month), 0)
                    key = (did, rid)
                    opening = carry.get(key, int(out_units * rng.uniform(1.1, 1.8)) + 40)
                    target_closing = (self.inv_target.get((did, rid, month))
                                      if self.apply_nar else None)
                    if target_closing is None:
                        units_in = int(max(out_units * 1.35 - opening + out_units, 0)
                                       * rng.uniform(0.9, 1.1))
                    else:
                        rng.uniform(0.9, 1.1)   # keep this table's own stream aligned
                        units_in = int(max(target_closing - opening + out_units, 0))
                    closing = max(opening + units_in - out_units, 0)
                    carry[key] = closing
                    self.closing_stock[(did, rid, month)] = closing

                    # Draw the organic stockout values UNCONDITIONALLY, then
                    # decide whether to use them. Drawing inside the `if` would
                    # consume a different number of values in the two passes,
                    # desynchronising the shared stream and corrupting the
                    # calibration for every later table (market share included).
                    organic_stockout = (int(rng.integers(0, 3))
                                        if rng.random() < 0.12 else 0)
                    nar = self.nar_cells.get((did, rid, month)) if self.apply_nar else None
                    stockout = nar["stockout_days"] if nar else organic_stockout
                    sid += 1
                    if self.collect:
                        rows.append((sid, did, rid, month.isoformat(), opening,
                                     units_in, out_units, closing, stockout))

    def _sim_market_share(self):
        """
        Our monthly share per (drug, region) plus the largest competitor's.
        Share is anchored to the drug's brand strength within its TA so it stays
        consistent with the revenue data, then offset by any narrative.
        """
        rng = self.mrng
        rows = self.market_share
        sid = 0
        for did, meta in self.drug_meta.items():
            pool = self.drugs_by_ta[meta["ta_id"]]
            tot = sum(self.drug_meta[d]["base_strength"] for d in pool)
            base_share = 100.0 * meta["base_strength"] / tot * 0.55
            comp_pool = self.comp_drug_for_our_drug.get(did) or [None]
            for rid in self.region_id.values():
                region_bias = float(rng.uniform(0.82, 1.18))
                for mi, month in enumerate(self.months):
                    if meta["launch"] > month:
                        continue
                    jitter = float(rng.uniform(0.95, 1.05))
                    comp_jitter = float(rng.uniform(0.55, 1.35))
                    off = self.share_offset.get((did, rid, month), 0.0) if self.apply_nar else 0.0
                    ours = float(np.clip(base_share * region_bias * (1 + 0.0015 * mi) * jitter
                                         - off, 1.0, 92.0))
                    cd = comp_pool[0]
                    comp = (float(np.clip(base_share * region_bias * jitter * comp_jitter + off,
                                          1.0, 95.0)) if cd else None)
                    if comp is not None:
                        self.comp_share[(did, rid, month)] = comp
                    sid += 1
                    if self.collect:
                        rows.append((sid, did, rid, month.isoformat(), f"{ours:.2f}",
                                     cd if cd else "",
                                     f"{comp:.2f}" if comp is not None else ""))

    # =======================================================================
    # ORCHESTRATION
    # =======================================================================
    def run(self, outdir: Path) -> dict:
        print("PharmaIQ synthetic data generator")
        print(f"  seed={self.seed}  months={C.HISTORY_MONTHS} "
              f"({self.months[0]} .. {self.months[-1]})\n")

        self.build_regions()
        self.build_products()
        self.build_competitors()
        self.build_hcps()
        self.build_reps()
        self.build_assignments()
        self.build_narrative_index()

        print("Pass 1/2  baseline (narratives off) — learning the counterfactual...")
        self.collect = False
        self.simulate(apply_narrative=False)
        baseline = {
            "rx_units": dict(self.rx_units),
            "sales_revenue": dict(self.sales_revenue),
            "visit_count": dict(self.visit_count),
            "closing_stock": dict(self.closing_stock),
            "comp_share": dict(self.comp_share),
        }
        self._calibrate(baseline)
        for nar in C.NARRATIVES:
            did, rid = self.drug_id[nar["drug"]], self.region_id[nar["region"]]
            m = self.months[-1]
            print(f"    {nar['name']:<28} solved lambda: rx={self.lam_rx.get((did,rid,m),1):.3f} "
                  f"sales_residual={self.lam_sales.get((did,rid,m),1):.3f} "
                  f"visits={self.lam_visit.get((rid,m),1):.3f}")

        print("\nPass 2/2  applying calibrated narratives...")
        self.collect = True
        self.simulate(apply_narrative=True)

        # Quotas are derived FROM simulated revenue, so they must come after the
        # fact pass. build_targets also rewrites sales_reps.annual_target, and
        # build_users points the demo accounts at rep rows, so users come last.
        self.build_targets()
        self.build_users()

        outdir.mkdir(parents=True, exist_ok=True)
        w = Writer(outdir)
        print("\nWriting CSVs:")
        w.write("regions", ["region_id", "region_name", "zone_head", "population_mn"], self.regions)
        w.write("cities", ["city_id", "region_id", "city_name", "tier"], self.cities)
        w.write("therapeutic_areas", ["ta_id", "ta_name", "description"], self.tas)
        w.write("drugs", ["drug_id", "drug_code", "drug_name", "generic_name", "ta_id",
                          "unit_price", "dosage_form", "strength", "launch_date", "is_active"], self.drugs)
        w.write("competitors", ["competitor_id", "company_name", "hq_country"], self.competitors)
        w.write("competitor_drugs", ["competitor_drug_id", "competitor_id", "drug_name",
                                     "ta_id", "rival_drug_id", "unit_price"], self.competitor_drugs)
        w.write("hcps", ["hcp_id", "hcp_code", "full_name", "specialty", "qualification",
                         "hospital", "city_id", "region_id", "years_experience",
                         "monthly_patient_volume", "hcp_tier", "email", "phone",
                         "onboarded_date", "is_active"], self.hcps)
        w.write("sales_reps", ["rep_id", "rep_code", "full_name", "email", "region_id",
                               "manager_id", "territory", "hire_date", "annual_target",
                               "is_active"], self.reps)
        w.write("rep_hcp_assignments", ["assignment_id", "rep_id", "hcp_id",
                                        "assigned_from", "assigned_to"], self.assignments)
        w.write("rep_targets", ["target_id", "rep_id", "period_month", "target_revenue"], self.targets)
        w.write("users", ["user_id", "full_name", "email", "password_hash", "role",
                          "sales_rep_id", "region_id", "is_active"], self.users)
        w.write("prescriptions", ["prescription_id", "hcp_id", "drug_id", "region_id",
                                  "prescription_date", "units", "patient_count",
                                  "is_new_patient"], self.prescriptions)
        w.write("sales", ["sale_id", "drug_id", "hcp_id", "rep_id", "region_id", "city_id",
                          "sale_date", "units_sold", "unit_price", "discount_pct",
                          "channel"], self.sales)
        w.write("visits", ["visit_id", "rep_id", "hcp_id", "visit_date", "duration_min",
                           "visit_type", "outcome", "samples_given", "discussed_drug_id",
                           "notes"], self.visits)
        w.write("inventory_snapshots", ["snapshot_id", "drug_id", "region_id", "snapshot_month",
                                        "opening_stock", "units_in", "units_out",
                                        "closing_stock", "stockout_days"], self.inventory)
        w.write("market_share", ["share_id", "drug_id", "region_id", "period_month",
                                 "our_share_pct", "competitor_drug_id",
                                 "competitor_share_pct"], self.market_share)

        summary = self._summary(w.counts)
        (outdir / "_manifest.json").write_text(json.dumps(summary, indent=2, default=str))
        return summary

    def _summary(self, counts: dict) -> dict:
        """Measure the planted narratives back out of the generated rows. This is
        the generator proving it created the story the demo depends on, rather
        than us assuming the multipliers worked."""
        checks = []
        for nar in C.NARRATIVES:
            did, rid = self.drug_id[nar["drug"]], self.region_id[nar["region"]]
            recent, prior = self._windows(nar)

            def chg(src, key_fn):
                P = mean(src.get(key_fn(m), 0) for m in prior)
                R = mean(src.get(key_fn(m), 0) for m in recent)
                return round((R / P - 1) * 100, 1) if P else None

            def delta(src, key_fn):
                P = mean(src.get(key_fn(m), 0) for m in prior)
                R = mean(src.get(key_fn(m), 0) for m in recent)
                return round(R - P, 1)

            checks.append({
                "narrative": nar["name"], "drug": nar["drug"], "region": nar["region"],
                "rx_units": {"target": nar["rx_change_pct"],
                             "actual": chg(self.rx_units, lambda m: (did, rid, m))},
                "revenue": {"target": nar["revenue_change_pct"],
                            "actual": chg(self.sales_revenue, lambda m: (did, rid, m))},
                "visits": {"target": nar["visit_change_pct"],
                           "actual": chg(self.visit_count, lambda m: (rid, m))},
                "inventory": {"target": nar["inventory_change_pct"],
                              "actual": chg(self.closing_stock, lambda m: (did, rid, m))},
                "competitor_share_pp": {"target": nar["competitor_share_delta_pp"],
                                        "actual": delta(self.comp_share, lambda m: (did, rid, m))},
            })
        return {
            "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
            "seed": self.seed,
            "months": [self.months[0].isoformat(), self.months[-1].isoformat()],
            "row_counts": counts,
            "total_revenue_inr": round(sum(self.sales_revenue.values()), 2),
            "planted_narrative_verification": checks,
        }


def main():
    ap = argparse.ArgumentParser(description="Generate PharmaIQ synthetic data")
    ap.add_argument("--out", default=str(Path(__file__).parent / "out"))
    ap.add_argument("--seed", type=int, default=C.RANDOM_SEED)
    args = ap.parse_args()

    summary = PharmaIQGenerator(seed=args.seed).run(Path(args.out))

    print(f"\nTotal revenue simulated: INR {summary['total_revenue_inr']:,.0f}")
    print("\nPlanted-narrative verification (target vs measured in the written rows):")
    hdr = f"  {'narrative':<28}{'metric':<20}{'target':>9}{'actual':>9}"
    print(hdr)
    print("  " + "-" * (len(hdr) - 2))
    for c in summary["planted_narrative_verification"]:
        for metric in ("rx_units", "revenue", "visits", "inventory", "competitor_share_pp"):
            t, a = c[metric]["target"], c[metric]["actual"]
            unit = "pp" if metric.endswith("_pp") else "%"
            print(f"  {c['narrative']:<28}{metric:<20}{t:>8.1f}{unit}{a:>8.1f}{unit}")
    print(f"\nCSVs written to {args.out}")


if __name__ == "__main__":
    main()
