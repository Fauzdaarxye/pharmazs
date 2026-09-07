// Typed shapes for the Node API (Contract §2, §5). snake_case in MySQL becomes
// camelCase here — the API is the boundary, the frontend consumes camelCase only.

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "ML_UNAVAILABLE"
  | "INTERNAL";

export interface ApiErrorShape {
  code: ErrorCode;
  message: string;
  details?: unknown[];
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiMeta {
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  [key: string]: unknown;
}

export interface ApiEnvelopeSuccess<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiEnvelopeFailure {
  success: false;
  error: ApiErrorShape;
}

export type ApiEnvelope<T> = ApiEnvelopeSuccess<T> | ApiEnvelopeFailure;

/** What api.get/post resolve to: the unwrapped payload plus any meta. */
export interface ApiResult<T> {
  data: T;
  meta?: ApiMeta;
}

// ---- Auth (§3) ----------------------------------------------------------

export type Role = "ADMIN" | "EXECUTIVE" | "MANAGER" | "SALES_REP" | "ANALYST";

export interface AuthUser {
  id?: number;
  fullName: string;
  email: string;
  role: Role;
  repId?: number | null;
  regionId?: number | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface RefreshResponse {
  accessToken: string;
}

// ---- Dashboard (§5) -----------------------------------------------------

export interface DashboardKpis {
  totalRevenue: number;
  revenueGrowthPct: number;
  totalPrescriptions: number;
  activeHcps: number;
  marketSharePct: number;
  inventoryAvailabilityPct: number;
  totalProducts: number;
  totalReps: number;
  deltas: {
    totalRevenue: number;
    revenueGrowthPct: number;
    totalPrescriptions: number;
    activeHcps: number;
    marketSharePct: number;
    inventoryAvailabilityPct: number;
  };
  sparklines: {
    totalRevenue: number[];
    revenueGrowthPct?: number[];
    totalPrescriptions?: number[];
    activeHcps?: number[];
    marketSharePct?: number[];
    inventoryAvailabilityPct?: number[];
  };
}

export interface RevenueTrendPoint {
  period: string;
  revenue: number;
  target: number;
  units: number;
}

export interface TherapeuticArea {
  taId: number;
  taName: string;
  revenue: number;
  growthPct: number;
  sharePct: number;
}

export interface RegionalPerformance {
  regionId: number;
  regionName: string;
  revenue: number;
  growthPct: number;
  marketSharePct: number;
  prescriptions: number;
  hcpCount: number;
  repCount: number;
}

export interface RegionalHighlight {
  regionId: number;
  regionName: string;
  value?: number;
}

export interface RegionalHighlights {
  // Region NAMES, not objects. The API emits plain strings here; typing these as
  // RegionalHighlight objects made every StatTile fall back to the em-dash,
  // because "North".regionName is quietly undefined rather than a type error
  // at runtime.
  topRegion: string;
  fastestGrowing: string;
  atRisk: string;
}

export interface TopProduct {
  rank: number;
  drugId: number;
  drugName: string;
  taName: string;
  revenue: number;
  growthPct: number;
  prescriptions: number;
  marketSharePct: number;
}

export type AlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface BusinessAlert {
  alertId: number;
  severity: AlertSeverity;
  title: string;
  description: string;
  entityType?: string;
  entityId?: number;
  createdAt: string;
  read?: boolean;
}

// ---- HCPs (§5) ----------------------------------------------------------

export type Priority = "HIGH" | "MEDIUM" | "LOW";

export interface Hcp {
  hcpId: number;
  hcpCode: string;
  fullName: string;
  specialty: string;
  hospital: string;
  city: string;
  regionName: string;
  rxVolume: number;
  rxGrowthPct: number;
  revenue: number;
  visits: number;
  lastVisitDate: string;
  daysSinceLastVisit: number;
  potentialScore: number;
  priority: Priority;
  competitorUsagePct: number;
}

export interface HcpSummary {
  totalHcps: number;
  highPotentialHcps: number;
  highPotentialSharePct: number;
  avgRxVolumePerHcp: number;
  engagementRatePct: number;
  avgPotentialScore: number;
}

// ---- Meta / filters (§5) ------------------------------------------------

/**
 * Filter dropdown options from `GET /api/meta/filters`.
 *
 * Each list uses its OWN field names — the endpoint returns domain keys, not a
 * generic `{id, name}`. These were previously all typed as `FilterOption
 * {id, name}`, which typechecked fine and then failed silently at runtime:
 * `region.name` is `undefined`, so a name->id lookup never matched and choosing a
 * region simply did nothing. Two independent agents caught it by reading the live
 * response. Same failure mode as `RegionalHighlights` — a plausible-looking type
 * over an unverified shape is worse than no type, because it buys false confidence.
 *
 * Verified against `docs/API_SHAPES.md`.
 */
export interface RegionOption {
  regionId: number;
  regionName: string;
}

export interface TherapeuticAreaOption {
  taId: number;
  taName: string;
}

export interface ProductOption {
  drugId: number;
  drugName: string;
}

export interface RepOption {
  repId: number;
  fullName: string;
}

export interface MetaFilters {
  regions: RegionOption[];
  therapeuticAreas: TherapeuticAreaOption[];
  products: ProductOption[];
  reps: RepOption[];
  specialties: string[];
  dateRange: { min: string; max: string };
}
