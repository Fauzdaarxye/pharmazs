// All display formatting lives here (Contract §5): the API returns raw numbers,
// the frontend turns them into ₹1.85 Cr, +12.4%, "5 days ago", etc.

const CRORE = 10_000_000; // 1 crore  = 1e7
const LAKH = 100_000; // 1 lakh   = 1e5

/**
 * Indian-notation currency. Rupees in, a short human string out.
 *   18452310  -> "₹1.85 Cr"
 *   1840000   -> "₹18.4 L"
 *   4200      -> "₹4,200"
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const neg = value < 0;
  const abs = Math.abs(value);
  let body: string;
  if (abs >= CRORE) {
    body = `₹${trim(abs / CRORE)} Cr`;
  } else if (abs >= LAKH) {
    body = `₹${trim(abs / LAKH)} L`;
  } else {
    body = `₹${Math.round(abs).toLocaleString("en-IN")}`;
  }
  return neg ? `-${body}` : body;
}

/** Currency for chart axes — always Cr, terse. 812340000 -> "₹81 Cr". */
export function formatCurrencyAxis(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "";
  const abs = Math.abs(value);
  if (abs >= CRORE) return `₹${trim(abs / CRORE)} Cr`;
  if (abs >= LAKH) return `₹${trim(abs / LAKH)} L`;
  return `₹${Math.round(abs).toLocaleString("en-IN")}`;
}

/** Compact count. 294143 -> "2.94L" style is confusing for counts, so use K/M. */
export function formatCompact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const neg = value < 0;
  const abs = Math.abs(value);
  let body: string;
  if (abs >= 1_000_000) body = `${trim(abs / 1_000_000)}M`;
  else if (abs >= 1_000) body = `${trim(abs / 1_000)}K`;
  else body = `${Math.round(abs)}`;
  return neg ? `-${body}` : body;
}

/** Grouped integer with Indian digit grouping. 294143 -> "2,94,143". */
export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return Math.round(value).toLocaleString("en-IN");
}

/**
 * Percentage. The API sends numbers already in percent units (-15.3 => -15.3%).
 *   12.4  -> "+12.4%"   (signed:true, default)
 *   27.8  -> "27.8%"    (signed:false)
 */
export function formatPercent(
  value: number | null | undefined,
  opts: { signed?: boolean; digits?: number } = {},
): string {
  if (value == null || Number.isNaN(value)) return "—";
  const { signed = true, digits = 1 } = opts;
  const rounded = round(value, digits);
  const sign = signed && rounded > 0 ? "+" : "";
  // Use a minus sign identical to the design (ASCII hyphen renders fine tabular).
  return `${sign}${rounded.toFixed(digits)}%`;
}

/** Percentage-point delta (the `Pp` suffix fields in §2). 7 -> "+7.0 pp". */
export function formatPercentagePoints(
  value: number | null | undefined,
  digits = 1,
): string {
  if (value == null || Number.isNaN(value)) return "—";
  const rounded = round(value, digits);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(digits)} pp`;
}

/** A score out of 100, e.g. 82.4 -> "82.4/100". */
export function formatScore(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${round(value, digits).toFixed(digits)}/100`;
}

/**
 * Relative date. Accepts an ISO date string or Date.
 *   today            -> "Today"
 *   yesterday        -> "Yesterday"
 *   5 days back      -> "5 days ago"
 *   ~2 months back   -> "2 months ago"
 */
export function formatRelativeDate(
  input: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";

  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);

  if (days < 0) return formatDate(d);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "1 month ago";
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

/** Absolute date, e.g. "19 Aug 2026". */
export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** A YYYY-MM period label -> "Aug 2026". */
export function formatPeriod(period: string | null | undefined): string {
  if (!period) return "";
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(period);
  if (!m) return period;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = m[3] ? Number(m[3]) : 1;
  const d = new Date(year, month, day);
  if (Number.isNaN(d.getTime())) return period;
  return m[3]
    ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
    : d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

// ---- internals ----------------------------------------------------------

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** One decimal, but drop a trailing ".0" so "₹2 Cr" not "₹2.0 Cr". */
function trim(value: number): string {
  const r = round(value, value >= 100 ? 0 : value >= 10 ? 1 : 2);
  return r.toString();
}
