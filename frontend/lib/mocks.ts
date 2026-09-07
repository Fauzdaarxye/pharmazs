// Deterministic fixtures matching the Contract §5 response shapes, used when
// NEXT_PUBLIC_USE_MOCKS=1 so the UI is fully reviewable without a backend.
// Seeded HCP names follow GROUND_TRUTH.md (North cardiologists rank on merit).

import type {
  BusinessAlert,
  DashboardKpis,
  Hcp,
  HcpSummary,
  LoginResponse,
  MetaFilters,
  Priority,
  RegionalPerformance,
  RevenueTrendPoint,
  TherapeuticArea,
  TopProduct,
} from "./types";

// ---- small seeded PRNG so the mock data is stable across reloads ----------
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REGIONS = ["North", "South", "East", "West", "Central"];
const SPECIALTIES = [
  "Cardiologist",
  "Endocrinologist",
  "Oncologist",
  "Pulmonologist",
  "Neurologist",
  "Gastroenterologist",
];
const HOSPITALS = [
  "Apollo Hospital",
  "Fortis Healthcare",
  "Max Super Speciality",
  "Manipal Hospital",
  "Medanta Medicity",
  "Narayana Health",
  "AIIMS",
  "Kokilaben Hospital",
];
const CITIES = [
  "Delhi",
  "Mumbai",
  "Bengaluru",
  "Chennai",
  "Kolkata",
  "Hyderabad",
  "Pune",
  "Gurugram",
  "Noida",
  "Ahmedabad",
];

const FIRST = [
  "Rajesh",
  "Anjali",
  "Vikram",
  "Priya",
  "Arjun",
  "Sneha",
  "Kavita",
  "Rahul",
  "Meera",
  "Sanjay",
  "Divya",
  "Amit",
  "Neha",
  "Karan",
  "Pooja",
];
const LAST = [
  "Sharma",
  "Gupta",
  "Mehta",
  "Reddy",
  "Nair",
  "Iyer",
  "Patel",
  "Singh",
  "Rao",
  "Desai",
  "Kapoor",
  "Joshi",
];

// ---- auth ----------------------------------------------------------------

export function mockLogin(email: string): LoginResponse {
  const roleByEmail: Record<string, LoginResponse["user"]["role"]> = {
    "admin@pharmaiq.io": "ADMIN",
    "exec@pharmaiq.io": "EXECUTIVE",
    "manager@pharmaiq.io": "MANAGER",
    "rep@pharmaiq.io": "SALES_REP",
    "analyst@pharmaiq.io": "ANALYST",
  };
  const role = roleByEmail[email.toLowerCase()] ?? "EXECUTIVE";
  return {
    accessToken: "mock-access-token",
    refreshToken: "mock-refresh-token",
    user: {
      id: 1,
      fullName: email.split("@")[0].replace(/^\w/, (c) => c.toUpperCase()),
      email,
      role,
      repId: role === "SALES_REP" ? 14 : null,
      regionId: role === "MANAGER" ? 1 : null,
    },
  };
}

// ---- dashboard -----------------------------------------------------------

export function mockKpis(): DashboardKpis {
  const spark = (seed: number, base: number, drift: number) => {
    const r = mulberry32(seed);
    const out: number[] = [];
    let v = base;
    for (let i = 0; i < 12; i++) {
      v = v * (1 + drift + (r() - 0.5) * 0.06);
      out.push(Math.round(v * 100) / 100);
    }
    return out;
  };
  return {
    totalRevenue: 18923446159,
    revenueGrowthPct: 12.4,
    totalPrescriptions: 294143,
    activeHcps: 2000,
    marketSharePct: 27.8,
    inventoryAvailabilityPct: 94.2,
    totalProducts: 38,
    totalReps: 60,
    deltas: {
      totalRevenue: 12.4,
      revenueGrowthPct: 3.2,
      totalPrescriptions: 8.7,
      activeHcps: 5.3,
      marketSharePct: 1.8,
      inventoryAvailabilityPct: -1.4,
    },
    sparklines: {
      totalRevenue: spark(1, 1.2, 0.011),
      revenueGrowthPct: spark(2, 1.0, 0.006),
      totalPrescriptions: spark(3, 1.0, 0.008),
      activeHcps: spark(4, 1.0, 0.004),
      marketSharePct: spark(5, 1.0, 0.003),
      inventoryAvailabilityPct: spark(6, 1.0, -0.002),
    },
  };
}

export function mockRevenueTrend(
  granularity: "monthly" | "daily" = "monthly",
): RevenueTrendPoint[] {
  const r = mulberry32(granularity === "daily" ? 99 : 7);
  const out: RevenueTrendPoint[] = [];
  if (granularity === "daily") {
    let rev = 26_000_000;
    for (let d = 1; d <= 30; d++) {
      rev = rev * (1 + (r() - 0.45) * 0.08);
      const target = 27_000_000;
      out.push({
        period: `2026-08-${String(d).padStart(2, "0")}`,
        revenue: Math.round(rev),
        target,
        units: Math.round(rev / 640),
      });
    }
    return out;
  }
  let rev = 560_000_000;
  const months = [
    "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02",
    "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08",
  ];
  for (const period of months) {
    rev = rev * (1 + 0.02 + (r() - 0.5) * 0.05);
    const target = rev * (0.96 + r() * 0.08);
    out.push({
      period,
      revenue: Math.round(rev),
      target: Math.round(target),
      units: Math.round(rev / 640),
    });
  }
  return out;
}

export function mockTherapeuticAreas(): TherapeuticArea[] {
  return [
    { taId: 1, taName: "Cardiology", revenue: 3240000000, growthPct: 18.2, sharePct: 31.2 },
    { taId: 2, taName: "Diabetes", revenue: 2810000000, growthPct: 22.6, sharePct: 27.1 },
    { taId: 3, taName: "Oncology", revenue: 2190000000, growthPct: 9.4, sharePct: 21.1 },
    { taId: 4, taName: "Respiratory", revenue: 1120000000, growthPct: -4.8, sharePct: 10.8 },
    { taId: 5, taName: "Neurology", revenue: 640000000, growthPct: 6.1, sharePct: 6.2 },
    { taId: 6, taName: "Gastroenterology", revenue: 370000000, growthPct: 3.3, sharePct: 3.6 },
  ];
}

export function mockRegionalPerformance(): {
  data: RegionalPerformance[];
  meta: {
    highlights: {
      topRegion: string;
      fastestGrowing: string;
      atRisk: string;
    };
  };
} {
  const data: RegionalPerformance[] = [
    { regionId: 4, regionName: "West", revenue: 5120000000, growthPct: 24.5, marketSharePct: 31, prescriptions: 82400, hcpCount: 520, repCount: 16 },
    { regionId: 2, regionName: "South", revenue: 4680000000, growthPct: 14.1, marketSharePct: 29, prescriptions: 76100, hcpCount: 480, repCount: 14 },
    { regionId: 1, regionName: "North", revenue: 4210000000, growthPct: -6.2, marketSharePct: 26, prescriptions: 71800, hcpCount: 460, repCount: 14 },
    { regionId: 5, regionName: "Central", revenue: 2990000000, growthPct: 8.7, marketSharePct: 22, prescriptions: 41200, hcpCount: 300, repCount: 9 },
    { regionId: 3, regionName: "East", revenue: 1920000000, growthPct: -11.4, marketSharePct: 18, prescriptions: 22600, hcpCount: 240, repCount: 7 },
  ];
  return {
    data,
    meta: {
      highlights: {
        topRegion: "West",
        fastestGrowing: "Central",
        atRisk: "East",
      },
    },
  };
}

export function mockTopProducts(limit = 5): TopProduct[] {
  const all: TopProduct[] = [
    { rank: 1, drugId: 1, drugName: "CardioMax", taName: "Cardiology", revenue: 1840000000, growthPct: 16.8, prescriptions: 42100, marketSharePct: 34.2 },
    { rank: 2, drugId: 2, drugName: "Dapaglyn", taName: "Diabetes", revenue: 1560000000, growthPct: 34.5, prescriptions: 38700, marketSharePct: 29.9 },
    { rank: 3, drugId: 3, drugName: "OncoShield", taName: "Oncology", revenue: 1290000000, growthPct: 11.2, prescriptions: 12400, marketSharePct: 24.6 },
    { rank: 4, drugId: 4, drugName: "RespiCare", taName: "Respiratory", revenue: 720000000, growthPct: -26.6, prescriptions: 18900, marketSharePct: 17.8 },
    { rank: 5, drugId: 5, drugName: "NeuroCalm", taName: "Neurology", revenue: 540000000, growthPct: 7.9, prescriptions: 9800, marketSharePct: 14.3 },
    { rank: 6, drugId: 6, drugName: "GastroEase", taName: "Gastroenterology", revenue: 310000000, growthPct: 4.1, prescriptions: 7200, marketSharePct: 9.6 },
  ];
  return all.slice(0, limit);
}

export function mockAlerts(limit = 10): BusinessAlert[] {
  const all: BusinessAlert[] = [
    { alertId: 1, severity: "CRITICAL", title: "CardioMax revenue down 15.3% in North", description: "Demand and engagement decline over the last 3 months. Prescription volume and HCP visits are the leading contributors.", entityType: "DRUG", entityId: 1, createdAt: daysAgo(1), read: false },
    { alertId: 2, severity: "HIGH", title: "RespiCare stockout risk in East", description: "Closing stock fell 10% with 11 stockout days — a supply failure, not demand. Prescriptions held flat.", entityType: "DRUG", entityId: 4, createdAt: daysAgo(2), read: false },
    { alertId: 3, severity: "MEDIUM", title: "Competitor share up 7pp for CardioMax", description: "Rivals gained ground in North while our engagement dropped.", entityType: "DRUG", entityId: 1, createdAt: daysAgo(4), read: true },
    { alertId: 4, severity: "LOW", title: "Dapaglyn surging in West (+34.5%)", description: "Prescriptions, visits and inventory all up — a genuine demand spike worth reinforcing.", entityType: "DRUG", entityId: 2, createdAt: daysAgo(6), read: true },
  ];
  return all.slice(0, limit);
}

// ---- HCPs ----------------------------------------------------------------

// Seeded high-potential North cardiologists (GROUND_TRUTH narrative 1).
const SEEDED_HCPS: Array<Partial<Hcp> & { fullName: string; city: string }> = [
  { fullName: "Dr. Rajesh Sharma", city: "Delhi", specialty: "Cardiologist", regionName: "North", potentialScore: 94, priority: "HIGH" },
  { fullName: "Dr. Anjali Gupta", city: "Gurugram", specialty: "Cardiologist", regionName: "North", potentialScore: 91, priority: "HIGH" },
  { fullName: "Dr. Vikram Mehta", city: "Noida", specialty: "Cardiologist", regionName: "North", potentialScore: 88, priority: "HIGH" },
];

let HCP_CACHE: Hcp[] | null = null;

function buildHcps(): Hcp[] {
  if (HCP_CACHE) return HCP_CACHE;
  const r = mulberry32(2026);
  const list: Hcp[] = [];
  const total = 240;
  for (let i = 0; i < total; i++) {
    const seeded = SEEDED_HCPS[i];
    const specialty = seeded?.specialty ?? SPECIALTIES[Math.floor(r() * SPECIALTIES.length)];
    const regionName = seeded?.regionName ?? REGIONS[Math.floor(r() * REGIONS.length)];
    const city = seeded?.city ?? CITIES[Math.floor(r() * CITIES.length)];
    const fullName =
      seeded?.fullName ??
      `Dr. ${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;
    const score = seeded?.potentialScore ?? Math.round(20 + r() * 79);
    const priority: Priority =
      seeded?.priority ?? (score >= 80 ? "HIGH" : score >= 50 ? "MEDIUM" : "LOW");
    const rxVolume = Math.round(120 + r() * 1500);
    const days = Math.floor(r() * 90);
    list.push({
      hcpId: i + 1,
      hcpCode: `HCP-${String(i + 1).padStart(5, "0")}`,
      fullName,
      specialty,
      hospital: HOSPITALS[Math.floor(r() * HOSPITALS.length)],
      city,
      regionName,
      rxVolume,
      rxGrowthPct: Math.round((r() * 40 - 15) * 10) / 10,
      revenue: Math.round(rxVolume * (2200 + r() * 3600)),
      visits: Math.floor(r() * 8),
      lastVisitDate: daysAgo(days),
      daysSinceLastVisit: days,
      potentialScore: score,
      priority,
      competitorUsagePct: Math.round(r() * 400) / 10,
    });
  }
  // Sort so the seeded high-potential cardiologists lead by score.
  list.sort((a, b) => b.potentialScore - a.potentialScore);
  HCP_CACHE = list;
  return list;
}

export interface HcpQuery {
  q?: string;
  specialty?: string;
  /** Region is filtered by id server-side; the UI resolves the name via /meta/filters. */
  regionId?: number;
  priority?: Priority;
  minScore?: number;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function mockHcps(query: HcpQuery): {
  data: Hcp[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
} {
  let rows = buildHcps();
  const { q, specialty, regionId, priority, minScore } = query;
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (h) =>
        h.fullName.toLowerCase().includes(needle) ||
        h.hospital.toLowerCase().includes(needle) ||
        h.city.toLowerCase().includes(needle),
    );
  }
  if (specialty && specialty !== "All") rows = rows.filter((h) => h.specialty === specialty);
  if (typeof regionId === "number") {
    // REGIONS index+1 is the id the mock /meta/filters hands out, so the same
    // name<->id mapping holds in mock mode as against the real API.
    const name = REGIONS[regionId - 1];
    if (name) rows = rows.filter((h) => h.regionName === name);
  }
  if (priority) rows = rows.filter((h) => h.priority === priority);
  if (typeof minScore === "number") rows = rows.filter((h) => h.potentialScore >= minScore);

  if (query.sort) {
    const desc = query.sort.startsWith("-");
    const key = query.sort.replace(/^-/, "");
    const map: Record<string, keyof Hcp> = {
      score: "potentialScore",
      rxVolume: "rxVolume",
      revenue: "revenue",
      rxGrowth: "rxGrowthPct",
      visits: "visits",
    };
    const field = map[key];
    if (field) {
      rows = [...rows].sort((a, b) => {
        const av = a[field] as number;
        const bv = b[field] as number;
        return desc ? bv - av : av - bv;
      });
    }
  }

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    data: rows.slice(start, start + pageSize),
    meta: { page, pageSize, total, totalPages },
  };
}

export function mockHcpSummary(): HcpSummary {
  return {
    totalHcps: 2000,
    highPotentialHcps: 252,
    highPotentialSharePct: 12.6,
    avgRxVolumePerHcp: 147,
    engagementRatePct: 68.4,
    avgPotentialScore: 82.4,
  };
}

// ---- meta ----------------------------------------------------------------

export function mockMetaFilters(): MetaFilters {
  return {
    regions: REGIONS.map((name, i) => ({ id: i + 1, name })),
    therapeuticAreas: mockTherapeuticAreas().map((t) => ({ id: t.taId, name: t.taName })),
    products: mockTopProducts(6).map((p) => ({ id: p.drugId, name: p.drugName })),
    reps: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Rep ${i + 1}` })),
    specialties: SPECIALTIES,
    dateRange: { min: "2024-09-01", max: "2026-08-31" },
  };
}

// ---- helpers -------------------------------------------------------------

function daysAgo(n: number): string {
  const d = new Date("2026-09-07T00:00:00Z");
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
