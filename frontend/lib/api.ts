// The ONE typed API client (Contract §8). No component calls fetch directly.
// - unwraps the { success, data, meta } envelope
// - carries the JWT access token
// - transparently refreshes once on 401, then retries the original request
// - surfaces a typed ApiError otherwise
// - when NEXT_PUBLIC_USE_MOCKS=1, serves contract-shaped fixtures instead

import { API_BASE_URL, USE_MOCKS } from "./constants";
import { tokenStore } from "./token-store";
import type {
  ApiEnvelope,
  ApiResult,
  BusinessAlert,
  DashboardKpis,
  ErrorCode,
  Hcp,
  HcpSummary,
  LoginResponse,
  MetaFilters,
  Priority,
  RefreshResponse,
  RegionalHighlights,
  RegionalPerformance,
  RevenueTrendPoint,
  TherapeuticArea,
  TopProduct,
} from "./types";
import * as mocks from "./mocks";

export class ApiError extends Error {
  code: ErrorCode | "NETWORK" | "PARSE";
  status: number;
  details?: unknown[];
  constructor(
    code: ApiError["code"],
    message: string,
    status: number,
    details?: unknown[],
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type QueryValue = string | number | boolean | Array<string | number> | undefined | null;
export type QueryParams = Record<string, QueryValue>;

function buildQuery(params?: QueryParams): string {
  if (!params) return "";
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) usp.append(key, String(v));
    } else {
      usp.append(key, String(value));
    }
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

// ---- refresh coordination (a single in-flight refresh, shared) -----------
let refreshInFlight: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as ApiEnvelope<RefreshResponse>;
    if (!json.success) return null;
    tokenStore.setAccess(json.data.accessToken);
    return json.data.accessToken;
  } catch {
    return null;
  }
}

function refreshOnce(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  params?: QueryParams;
  /** Skip attaching / refreshing auth (used by login & refresh themselves). */
  auth?: boolean;
  signal?: AbortSignal;
}

async function request<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<ApiResult<T>> {
  const { method = "GET", body, params, auth = true, signal } = opts;
  const url = `${API_BASE_URL}${path}${buildQuery(params)}`;

  const doFetch = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  };

  let res: Response;
  try {
    res = await doFetch(auth ? tokenStore.getAccess() : null);
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError("NETWORK", "Could not reach the server.", 0);
  }

  // Transparent refresh on 401, then a single retry.
  if (res.status === 401 && auth) {
    const newToken = await refreshOnce();
    if (newToken) {
      try {
        res = await doFetch(newToken);
      } catch {
        throw new ApiError("NETWORK", "Could not reach the server.", 0);
      }
    } else {
      tokenStore.clear();
      throw new ApiError("UNAUTHORIZED", "Your session has expired.", 401);
    }
  }

  let json: ApiEnvelope<T>;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError("PARSE", "Malformed response from the server.", res.status);
  }

  if (!json || typeof json !== "object" || !("success" in json)) {
    throw new ApiError("PARSE", "Unexpected response shape.", res.status);
  }

  if (!json.success) {
    throw new ApiError(
      json.error.code,
      json.error.message || "Request failed.",
      res.status,
      json.error.details,
    );
  }

  return { data: json.data, meta: json.meta };
}

// ---- public client -------------------------------------------------------

export const api = {
  get: <T>(path: string, params?: QueryParams, signal?: AbortSignal) =>
    request<T>(path, { method: "GET", params, signal }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...opts, method: "POST", body }),
};

// ---- typed endpoint helpers ----------------------------------------------
// Every screen imports from here. Each helper transparently returns mock data
// when USE_MOCKS is on, so pages never branch on the mode themselves.

const mockDelay = () => new Promise<void>((r) => setTimeout(r, 220));

export const endpoints = {
  async login(email: string, password: string): Promise<LoginResponse> {
    if (USE_MOCKS) {
      await mockDelay();
      if (!password) {
        throw new ApiError("VALIDATION_ERROR", "Password is required.", 400);
      }
      return mocks.mockLogin(email);
    }
    const { data } = await request<LoginResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    return data;
  },

  async logout(): Promise<void> {
    if (USE_MOCKS) return;
    const refreshToken = tokenStore.getRefresh();
    try {
      await request("/auth/logout", { method: "POST", body: { refreshToken } });
    } catch {
      // best effort
    }
  },

  async dashboardKpis(params?: QueryParams): Promise<DashboardKpis> {
    if (USE_MOCKS) {
      await mockDelay();
      return mocks.mockKpis();
    }
    return (await api.get<DashboardKpis>("/dashboard/kpis", params)).data;
  },

  async revenueTrend(params?: {
    granularity?: "monthly" | "daily";
    metric?: "revenue" | "units";
  }): Promise<RevenueTrendPoint[]> {
    if (USE_MOCKS) {
      await mockDelay();
      return mocks.mockRevenueTrend(params?.granularity ?? "monthly");
    }
    return (await api.get<RevenueTrendPoint[]>("/dashboard/revenue-trend", params)).data;
  },

  async therapeuticAreas(params?: QueryParams): Promise<TherapeuticArea[]> {
    if (USE_MOCKS) {
      await mockDelay();
      return mocks.mockTherapeuticAreas();
    }
    return (await api.get<TherapeuticArea[]>("/dashboard/therapeutic-areas", params)).data;
  },

  async regionalPerformance(params?: QueryParams): Promise<{
    data: RegionalPerformance[];
    highlights?: RegionalHighlights;
  }> {
    if (USE_MOCKS) {
      await mockDelay();
      const m = mocks.mockRegionalPerformance();
      return { data: m.data, highlights: m.meta.highlights as RegionalHighlights };
    }
    const res = await api.get<RegionalPerformance[]>("/dashboard/regional-performance", params);
    return {
      data: res.data,
      highlights: res.meta?.highlights as RegionalHighlights | undefined,
    };
  },

  async topProducts(limit = 5): Promise<TopProduct[]> {
    if (USE_MOCKS) {
      await mockDelay();
      return mocks.mockTopProducts(limit);
    }
    return (await api.get<TopProduct[]>("/dashboard/top-products", { limit })).data;
  },

  async alerts(limit = 10): Promise<BusinessAlert[]> {
    if (USE_MOCKS) {
      await mockDelay();
      return mocks.mockAlerts(limit);
    }
    return (await api.get<BusinessAlert[]>("/dashboard/alerts", { limit })).data;
  },

  async hcps(query: mocks.HcpQuery): Promise<{
    data: Hcp[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    if (USE_MOCKS) {
      await mockDelay();
      return mocks.mockHcps(query);
    }
    const res = await api.get<Hcp[]>("/hcps", {
      q: query.q,
      specialty: query.specialty,
      regionId: query.regionId,
      priority: query.priority,
      minScore: query.minScore,
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      data: res.data,
      meta: {
        page: res.meta?.page ?? query.page ?? 1,
        pageSize: res.meta?.pageSize ?? query.pageSize ?? 25,
        total: res.meta?.total ?? res.data.length,
        totalPages: res.meta?.totalPages ?? 1,
      },
    };
  },

  async hcpSummary(params?: QueryParams): Promise<HcpSummary> {
    if (USE_MOCKS) {
      await mockDelay();
      return mocks.mockHcpSummary();
    }
    return (await api.get<HcpSummary>("/hcps/summary", params)).data;
  },

  async metaFilters(): Promise<MetaFilters> {
    if (USE_MOCKS) {
      await mockDelay();
      return mocks.mockMetaFilters();
    }
    return (await api.get<MetaFilters>("/meta/filters")).data;
  },
};

export type { Priority };
