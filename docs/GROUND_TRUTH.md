# Ground Truth — what the analytics MUST rediscover

The synthetic dataset is not random noise. Three narratives were deliberately
planted by `data-generator/generate.py`, calibrated so that the *observed*
period-over-period change equals the target (see the two-pass calibration note in
that file's docstring).

This file exists so the ML service can be **verified against a known answer**
rather than eyeballed. If `/root-cause` cannot rediscover narrative 1, or ranks
narrative 2's cause wrongly, the feature is decorative and the build is not done.

Data window: **2024-09-01 .. 2026-08-31** (24 complete months). "Now" is 2026-09.

---

## 1. `cardiomax_north_decline` — the SRS §44 demo scenario

Drug **CardioMax**, region **North**, last **3** months vs the 3 before.

| Metric                      | Measured in the data |
|-----------------------------|----------------------|
| Revenue                     | **−15.3%**           |
| Prescription units          | **−8.5%**            |
| Regional visits (engagement)| **−14.6%**           |
| Inventory (closing stock)   | **−5.0%**            |
| Competitor share            | **+7.0 pp**          |

This is a **demand + engagement** failure. `/root-cause` must return a headline of
roughly −15% and rank `PRESCRIPTION_VOLUME` and `HCP_ENGAGEMENT` as the leading
negative contributors.

The demo then ends on the three highest-scoring North cardiologists, who are
seeded as genuinely high-potential physicians (hcp_id 1, 2, 3) so the scorer ranks
them on merit rather than by name:

- Dr. Rajesh Sharma (Delhi)
- Dr. Anjali Gupta (Gurugram)
- Dr. Vikram Mehta (Noida)

## 2. `respicare_east_stockout` — the discriminating case

Drug **RespiCare**, region **East**, last **2** months vs the 2 before.

| Metric             | Measured  |
|--------------------|-----------|
| Revenue            | **−26.6%**|
| Prescription units | −0.6% (essentially flat) |
| Inventory          | −10.0%    |
| Stockout days      | 11        |
| Competitor share   | +3.0 pp   |

This is a **supply** failure, not a demand failure: doctors kept prescribing, but
stock ran out. `/root-cause` must rank `INVENTORY` **above** `PRESCRIPTION_VOLUME`
here. A root-cause engine that blames prescriptions for both narrative 1 and
narrative 2 is not discriminating and has to be fixed.

## 3. `dapaglyn_west_surge` — the upside case

Drug **Dapaglyn**, region **West**, last **4** months vs the 4 before.

| Metric             | Measured  |
|--------------------|-----------|
| Revenue            | **+34.5%**|
| Prescription units | +25.1%    |
| Visits             | +18.5%    |
| Inventory          | +15.0%    |
| Competitor share   | −5.0 pp   |

Anomaly detection must flag this as a **SPIKE**, not only report drops. An
anomalies page that lists nothing but failures reads as a fault log rather than an
analytics product.

---

## Tolerances

Narrative 1 is calibrated to within ~0.5pp on every metric and is the one the demo
depends on, so treat it as exact.

Narratives 2 and 3 are looser on Rx and revenue (±3pp). East is the smallest region
and RespiCare is the most seasonal brand, so its cells carry the most sampling
noise; inventory there is additionally floor-limited, because stock cannot fall
faster than the region consumes it. Their *shape* — which contributor dominates —
is what matters and is stable.

## Reproducing

```bash
cd data-generator && .venv/bin/python generate.py
```

Seed is fixed at 42, so the numbers above are reproducible. The generator prints a
target-vs-measured verification table at the end and writes it to
`out/_manifest.json`; trust that table over this file if they ever disagree.
