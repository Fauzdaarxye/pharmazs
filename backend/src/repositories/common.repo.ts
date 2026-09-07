import { queryOne, RowDataPacket } from '../db/pool';

interface RangeRow extends RowDataPacket {
  minDate: string;
  maxDate: string;
}

let cached: { min: string; max: string } | null = null;

/** The span of the seeded sales data, derived from MIN/MAX(sale_date). Cached per process. */
export async function dataDateRange(): Promise<{ min: string; max: string }> {
  if (cached) return cached;
  const row = await queryOne<RangeRow>(
    'SELECT MIN(sale_date) AS minDate, MAX(sale_date) AS maxDate FROM sales',
  );
  cached = { min: row?.minDate ?? '2024-09-01', max: row?.maxDate ?? '2026-08-31' };
  return cached;
}

/** Subtract N months from a YYYY-MM-DD string, returning YYYY-MM-DD. */
export function minusMonths(date: string, months: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** First day of the month for a date string. */
export function monthStart(date: string): string {
  return date.slice(0, 7) + '-01';
}

/**
 * Resolve the effective [from, to] window for analytics endpoints.
 * `to` defaults to the latest data date; `from` defaults to 12 months before `to`.
 */
export async function resolveWindow(
  from: string | undefined,
  to: string | undefined,
): Promise<{ from: string; to: string }> {
  const range = await dataDateRange();
  const resolvedTo = to ?? range.max;
  const resolvedFrom = from ?? minusMonths(resolvedTo, 12);
  return { from: resolvedFrom, to: resolvedTo };
}
