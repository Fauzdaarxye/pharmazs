import { Request } from 'express';
import { z } from 'zod';
import { ApiError } from './envelope';

export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
}

export interface SortSpec {
  /** DB column (from the allow-list), safe to interpolate. */
  column: string;
  direction: 'ASC' | 'DESC';
}

/** Parse `page` / `pageSize` (1-based, default 25, max 200). */
export function parsePagination(req: Request): Pagination {
  const page = intParam(req, 'page', 1, { min: 1 });
  const pageSize = intParam(req, 'pageSize', 25, { min: 1, max: 200 });
  return { page, pageSize, offset: (page - 1) * pageSize };
}

interface IntOpts {
  min?: number;
  max?: number;
}

export function intParam(req: Request, name: string, fallback: number, opts: IntOpts = {}): number {
  const raw = req.query[name];
  if (raw === undefined) return fallback;
  const s = Array.isArray(raw) ? String(raw[0]) : String(raw);
  const n = Number(s);
  if (!Number.isInteger(n)) throw ApiError.validation(`Query param "${name}" must be an integer`);
  if (opts.min !== undefined && n < opts.min) throw ApiError.validation(`"${name}" must be >= ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw ApiError.validation(`"${name}" must be <= ${opts.max}`);
  return n;
}

export function optIntParam(req: Request, name: string): number | undefined {
  if (req.query[name] === undefined) return undefined;
  return intParam(req, name, 0);
}

/** Repeatable integer param, e.g. regionId=1&regionId=2. */
export function intArrayParam(req: Request, name: string): number[] {
  const raw = req.query[name];
  if (raw === undefined) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((v) => {
    const n = Number(String(v));
    if (!Number.isInteger(n)) throw ApiError.validation(`Query param "${name}" must be integer(s)`);
    return n;
  });
}

export function strParam(req: Request, name: string): string | undefined {
  const raw = req.query[name];
  if (raw === undefined) return undefined;
  const s = Array.isArray(raw) ? String(raw[0]) : String(raw);
  return s.trim() === '' ? undefined : s.trim();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function dateParam(req: Request, name: string): string | undefined {
  const s = strParam(req, name);
  if (s === undefined) return undefined;
  if (!DATE_RE.test(s)) throw ApiError.validation(`Query param "${name}" must be a date (YYYY-MM-DD)`);
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) throw ApiError.validation(`Query param "${name}" is not a valid date`);
  return s;
}

/**
 * Parse the `sort` param against an allow-list mapping public field -> DB column.
 * A leading `-` means DESC. Any field not in the allow-list is a VALIDATION_ERROR —
 * user input is NEVER interpolated raw into SQL.
 */
export function parseSort(
  req: Request,
  allow: Record<string, string>,
  fallback: SortSpec,
): SortSpec {
  const raw = strParam(req, 'sort');
  if (raw === undefined) return fallback;
  const direction: 'ASC' | 'DESC' = raw.startsWith('-') ? 'DESC' : 'ASC';
  const field = raw.replace(/^[-+]/, '');
  const column = allow[field];
  if (!column) {
    throw ApiError.validation(
      `Cannot sort by "${field}". Allowed: ${Object.keys(allow).join(', ')}`,
    );
  }
  return { column, direction };
}

export function enumParam<T extends string>(
  req: Request,
  name: string,
  values: readonly T[],
): T | undefined {
  const s = strParam(req, name);
  if (s === undefined) return undefined;
  if (!values.includes(s as T)) {
    throw ApiError.validation(`Query param "${name}" must be one of: ${values.join(', ')}`);
  }
  return s as T;
}

/** Validate an arbitrary object with a zod schema, throwing a VALIDATION_ERROR on failure. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const details = result.error.errors.map((e) => ({ path: e.path.join('.'), message: e.message }));
    throw ApiError.validation('Request validation failed', details);
  }
  return result.data;
}
