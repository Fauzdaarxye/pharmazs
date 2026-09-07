# Verified API shapes

**Generated from the RUNNING API, not from the contract.** Every shape below was
returned by a real request against the seeded database.

This file exists because the previous build round produced two integration failures
that a documented contract could not prevent: `meta.highlights` was typed as
`{regionId, regionName}` objects while the API emits plain strings (so every Regional
StatTile rendered an em-dash), and the HCP page sent the literal string `"All"` as a
filter (so the directory came back empty). Build against THIS file.

Captured 2026-09-08 against the seeded dataset. If the API changes, re-probe the
endpoint rather than trusting this file.

## Conventions

- Envelope: `{success, data, meta?}`. The typed client in `frontend/lib/api.ts`
  unwraps it; pages never see the envelope.
- `meta` present => the endpoint is server-side paginated: pass `page` & `pageSize`.
- Money is rupees as a number. Percentages are percent units (`-15.7` = -15.7%).
- A `"All"`-style UI sentinel must be converted to `undefined` before it is sent.

### `GET /dashboard/kpis`

```
data: { totalRevenue: number, revenueGrowthPct: number, totalPrescriptions: number, activeHcps: number, marketSharePct: number, inventoryAvailabilityPct: number, totalProducts: number, totalReps: number, deltas: { totalRevenue: number, revenueGrowthPct: number, totalPrescriptions: number, activeHcps: number, marketSharePct: number, inventoryAvailabilityPct: number }, sparklines: { totalRevenue: [number] x12 } }
```

### `GET /dashboard/revenue-trend`

```
data: [{ period: string, revenue: number, target: number, units: number }] x12
```

### `GET /dashboard/therapeutic-areas`

```
data: [{ taId: number, taName: string, revenue: number, growthPct: number, sharePct: number }] x6
```

### `GET /dashboard/regional-performance`

```
data: [{ regionId: number, regionName: string, revenue: number, growthPct: number, marketSharePct: number, prescriptions: number, hcpCount: number, repCount: number }] x5
meta: { highlights: { topRegion: string, fastestGrowing: string, atRisk: string } }
```

### `GET /dashboard/top-products?limit=5`

```
data: [{ rank: number, drugId: number, drugName: string, taName: string, revenue: number, growthPct: number, prescriptions: number, marketSharePct: number }] x5
```

### `GET /dashboard/top-hcps?limit=5`

```
data: [{ rank: number, hcpId: number, hcpCode: string, fullName: string, specialty: string, regionName: string, revenue: number, rxVolume: number }] x5
```

### `GET /dashboard/alerts?pageSize=5`

```
data: [{ alertId: number, alertType: string, severity: string, title: string, message: string, entityType: string, entityId: number, audienceRole: string, isRead: bool, createdAt: string }] x5
meta: { page: number, pageSize: number, total: number, totalPages: number }
```

### `GET /products?pageSize=3`

```
data: [{ drugId: number, drugCode: string, drugName: string, genericName: string, taId: number, taName: string, unitPrice: number, dosageForm: string, strength: string, unitsSold: number, revenue: number, rxVolume: number, growthPct: number, marketSharePct: number }] x3
meta: { page: number, pageSize: number, total: number, totalPages: number }
```

### `GET /products/1`

```
data: { drugId: number, drugCode: string, drugName: string, genericName: string, taId: number, taName: string, unitPrice: number, dosageForm: string, strength: string, unitsSold: number, revenue: number, rxVolume: number, growthPct: number, marketSharePct: number }
```

### `GET /products/1/trend`

```
data: [{ period: string, revenue: number, units: number }] x12
```

### `GET /products/1/regional`

```
data: [{ regionId: number, regionName: string, revenue: number, units: number, marketSharePct: number }] x5
```

### `GET /products/1/forecast`

```
data: { entityType: string, entityId: number, horizon: number, history: [{...}] x24, forecast: [{...}] x6, model: string, mape: number }
```

### `GET /products/1/competitors`

```
data: [{ competitorDrugId: number, competitorName: string, companyName: string, unitPrice: number, competitorSharePct: number }] x2
```

### `GET /hcps?pageSize=3`

```
data: [{ hcpId: number, hcpCode: string, fullName: string, specialty: string, hospital: string, city: string, regionName: string, rxVolume: number, rxGrowthPct: number, revenue: number, visits: number, lastVisitDate: string, daysSinceLastVisit: number, potentialScore: number }] x3
meta: { page: number, pageSize: number, total: number, totalPages: number }
```

### `GET /hcps/summary`

```
data: { totalHcps: number, highPotentialHcps: number, highPotentialSharePct: number, avgRxVolumePerHcp: number, engagementRatePct: number, avgPotentialScore: number }
```

### `GET /hcps/1`

```
data: { hcpId: number, hcpCode: string, fullName: string, specialty: string, hospital: string, city: string, regionName: string, rxVolume: number, rxGrowthPct: number, revenue: number, visits: number, lastVisitDate: string, daysSinceLastVisit: number, potentialScore: number }
```

### `GET /hcps/1/trend`

```
data: [{ period: string, rxVolume: number, revenue: number, visits: number }] x12
```

### `GET /hcps/1/score`

```
data: { hcpId: number, hcpName: string, totalScore: number, priority: string, components: { rxVolume: number, rxGrowth: number, engagement: number, taRelevance: number, competitorOpportunity: number }, weights: { rxVolume: number, rxGrowth: number, engagement: number, taRelevance: number, competitorOpportunity: number }, reasons: [string] x2, disclaimer: string }
```

### `GET /reps?pageSize=3`

```
data: [{ repId: number, repCode: string, fullName: string, regionId: number, regionName: string, territory: string, revenue: number, target: number, achievementPct: number, visits: number, hcpCount: number, rank: number }] x3
meta: { page: number, pageSize: number, total: number, totalPages: number }
```

### `GET /reps/11`

```
data: { repId: number, repCode: string, fullName: string, regionId: number, regionName: string, territory: string, revenue: number, target: number, achievementPct: number, visits: number, hcpCount: number, rank: number }
```

### `GET /reps/11/hcps?pageSize=3`

```
data: [{ hcpId: number, hcpCode: string, fullName: string, specialty: string, hospital: string, regionName: string, potentialScore: number, priority: string, lastVisitDate: string }] x3
meta: { page: number, pageSize: number, total: number, totalPages: number }
```

### `GET /reps/11/recommended-hcps?limit=3`

```
data: [{ hcpId: number, hcpName: string, totalScore: number, priority: string, components: {...}, weights: {...}, reasons: [string] x3, disclaimer: string }] x3
```

### `GET /regions`

```
data: [{ regionId: number, regionName: string, zoneHead: string, revenue: number, growthPct: number, marketSharePct: number, prescriptions: number, hcpCount: number, repCount: number }] x5
```

### `GET /regions/1`

```
data: { regionId: number, regionName: string, zoneHead: string, revenue: number, growthPct: number, marketSharePct: number, prescriptions: number, hcpCount: number, repCount: number }
```

### `GET /regions/1/drilldown?level=city`

```
data: [{ id: number, name: string, revenue: number, units: number }] x7
meta: { level: string }
```

### `GET /competitors`

```
data: [{ competitorId: number, companyName: string, hqCountry: string, drugCount: number, avgSharePct: number }] x6
```

### `GET /competitors/market-share?drugId=1`

```
data: [{ period: string, ourSharePct: number, competitorSharePct: number }] x24
```

### `GET /inventory?pageSize=3`

```
data: [{ drugId: number, drugName: string, regionId: number, regionName: string, snapshotMonth: string, closingStock: number, unitsOut: number, coverMonths: number, stockoutDays: number, riskFlag: string }] x3
meta: { page: number, pageSize: number, total: number, totalPages: number }
```

### `GET /inventory/at-risk`

```
data: [{ drugId: number, drugName: string, regionId: number, regionName: string, snapshotMonth: string, closingStock: number, unitsOut: number, coverMonths: number, stockoutDays: number, riskFlag: string }] x20
```

### `GET /forecast?entityType=COMPANY&horizon=6`

```
data: { entityType: string, entityId: null, horizon: number, history: [{...}] x24, forecast: [{...}] x6, model: string, mape: number }
```

### `GET /anomalies?pageSize=3`

```
data: [{ anomalyId: number, entityType: string, entityId: number, entityName: string, periodMonth: string, metric: string, actual: number, expected: number, deviationPct: number, zScore: number, severity: string, direction: string, detectedAt: string }] x3
meta: { page: number, pageSize: number, total: number, totalPages: number }
```

### `GET /recommendations?limit=3`

```
data: [{ recType: string, title: string, rationale: string, expectedImpact: string, priority: string, confidence: number, targetEntityType: string, targetEntityId: number }] x3
```

### `GET /meta/filters`

```
data: { regions: [{...}] x5, therapeuticAreas: [{...}] x6, products: [{...}] x38, reps: [{...}] x70, specialties: [string] x9, dateRange: { min: string, max: string } }
```

### `POST /analytics/why-did-sales-change`

request: `{"drugId": 1, "regionId": 1, "periodMonths": 3}`

```
data: { headline: { metric: string, changePct: number, direction: string, current: number, previous: number, periodLabel: string }, contributors: [{...}] x5, recommendations: [{...}] x3, confidence: number }
```

