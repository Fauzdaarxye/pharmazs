import { config } from '../config';
import { ApiError } from '../http/envelope';
import { logger } from '../logger';

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ml.timeoutMs);
  try {
    const res = await fetch(`${config.ml.baseUrl}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn({ path, status: res.status }, 'ML service returned non-2xx');
      throw ApiError.mlUnavailable(`Analytics service error (${res.status})`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // Timeout, connection refused, DNS, etc. — the service is not up / not reachable.
    logger.warn({ path, err: (err as Error).message }, 'ML service unreachable');
    throw ApiError.mlUnavailable();
  } finally {
    clearTimeout(timer);
  }
}

export interface MlHealth {
  status: string;
  modelsLoaded: boolean;
}

export interface ForecastResult {
  history: { period: string; value: number }[];
  forecast: { period: string; predicted: number; lower: number; upper: number }[];
  model: string;
  mape: number;
}

export interface HcpScoreResult {
  hcpId: number;
  totalScore: number;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  components: {
    rxVolume: number;
    rxGrowth: number;
    engagement: number;
    taRelevance: number;
    competitorOpportunity: number;
  };
  reasons: string[];
}

export interface AnomalyResult {
  entityType: string;
  entityId: number | null;
  entityName: string;
  periodMonth: string;
  metric: string;
  actual: number;
  expected: number;
  deviationPct: number;
  zScore: number;
  severity: string;
  direction: string;
}

export interface RefreshResult {
  status: string;
  tasksCompleted: string[];
}

export const mlClient = {
  health: () => call<MlHealth>('GET', '/health'),
  forecast: (entityType: string, entityId: number | null, horizon: number) =>
    call<ForecastResult>('POST', '/forecast', { entityType, entityId, horizon }),
  hcpScore: (payload: { hcpIds?: number[]; regionId?: number; limit?: number }) =>
    call<HcpScoreResult[]>('POST', '/hcp-score', payload),
  anomalies: (payload: { entityType: string; metric: string; lookbackMonths: number }) =>
    call<AnomalyResult[]>('POST', '/anomalies', payload),
  rootCause: (payload: { drugId: number; regionId: number; periodMonths: number }) =>
    call<unknown>('POST', '/root-cause', payload),
  recommendations: (payload: { role: string; regionId?: number; repId?: number; limit: number }) =>
    call<unknown>('POST', '/recommendations', payload),
  refreshAll: () => call<RefreshResult>('POST', '/jobs/refresh-all'),
};

/** Best-effort health check for /api/health — returns reachability, never throws. */
export async function mlReachable(): Promise<boolean> {
  try {
    const h = await mlClient.health();
    return h.status === 'ok';
  } catch {
    return false;
  }
}
