import { Principal } from '../types';
import * as repo from '../repositories/products.repo';
import { mlClient } from '../ml/client';
import { ApiError } from '../http/envelope';

export const listProducts = repo.listProducts;
export const getProductTrend = repo.getProductTrend;
export const getProductRegional = repo.getProductRegional;
export const getProductCompetitors = repo.getProductCompetitors;

export async function getProductDetail(p: Principal, drugId: number) {
  const detail = await repo.getProductDetail(p, drugId);
  if (!detail) throw ApiError.notFound(`Product ${drugId} not found`);
  const competitors = await repo.getProductCompetitors(drugId);
  return { ...detail, competitors };
}

export async function ensureProduct(drugId: number): Promise<void> {
  if (!(await repo.productExists(drugId))) throw ApiError.notFound(`Product ${drugId} not found`);
}

/** Forecast — ML passthrough. Throws ML_UNAVAILABLE if FastAPI is down. */
export async function getProductForecast(drugId: number, horizon: number) {
  await ensureProduct(drugId);
  return mlClient.forecast('DRUG', drugId, horizon);
}
