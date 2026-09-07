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

/** Last day of the month for a date string. */
export function monthEnd(date: string): string {
  const d = new Date(date.slice(0, 7) + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** Whole calendar months spanned by [from, to], inclusive. */
export function monthSpan(from: string, to: string): number {
  const a = new Date(monthStart(from) + 'T00:00:00Z');
  const b = new Date(monthStart(to) + 'T00:00:00Z');
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1;
}

export const DEFAULT_WINDOW_MONTHS = 12;

/**
 * Resolve the effective [from, to] window for analytics endpoints.
 *
 * The default window is MONTH-ALIGNED: `to` is the last day of the latest data
 * month and `from` is the first day of the month 11 months earlier, giving
 * exactly 12 whole months.
 *
 * Alignment is not cosmetic. Defaulting `from` to "max date minus 12 months"
 * produced 2025-08-31, which broke two things at once: the first bucket of every
 * monthly series contained a SINGLE DAY (the revenue chart opened with a near-zero
 * point and a vertical climb), and the span came out as 13 months, so the prior
 * window started before the dataset began and was only ~11 months long. Comparing
 * 13 months against 11 reported revenue growth of 50% where the true
 * year-over-year figure is 35.1%.
 */
export async function resolveWindow(
  from: string | undefined,
  to: string | undefined,
): Promise<{ from: string; to: string }> {
  const range = await dataDateRange();
  const resolvedTo = to ?? monthEnd(range.max);
  const resolvedFrom = from ?? monthStart(minusMonths(monthStart(resolvedTo), DEFAULT_WINDOW_MONTHS - 1));
  return { from: resolvedFrom, to: resolvedTo };
}

/**
 * The equal-length window immediately BEFORE [from, to], month-aligned so it can
 * never overlap the current window (an overlapping prior period double-counts the
 * boundary month and inflates every growth figure on the dashboard).
 */
export function priorWindow(from: string, to: string): { from: string; to: string } {
  const months = monthSpan(from, to);
  const prevTo = monthEnd(minusMonths(monthStart(from), 1));
  const prevFrom = monthStart(minusMonths(monthStart(prevTo), months - 1));
  return { from: prevFrom, to: prevTo };
}
