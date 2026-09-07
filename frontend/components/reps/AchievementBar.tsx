import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";

/**
 * Attainment progress bar + the number, banded per the brief:
 *   ≥100  green, <90 amber, <75 red, otherwise a neutral primary blue.
 * The bar is capped at 100% width so a 123% attainment doesn't overflow the
 * cell — the exact figure is shown alongside it.
 */
function band(pct: number): { bar: string; text: string } {
  if (pct >= 100) return { bar: "bg-success", text: "text-success" };
  if (pct < 75) return { bar: "bg-danger", text: "text-danger" };
  if (pct < 90) return { bar: "bg-warning", text: "text-[#B45309]" };
  return { bar: "bg-primary", text: "text-text" };
}

export function AchievementBar({ pct }: { pct: number | null | undefined }) {
  if (pct == null || Number.isNaN(pct)) {
    return <span className="text-[13px] text-text-muted">—</span>;
  }
  const { bar, text } = band(pct);
  const width = Math.max(4, Math.min(100, pct));
  return (
    <div className="flex items-center justify-end gap-2.5">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-bg" aria-hidden>
        <div className={cn("h-full rounded-full", bar)} style={{ width: `${width}%` }} />
      </div>
      <span className={cn("tnum w-14 text-right text-[13px] font-semibold", text)}>
        {formatPercent(pct, { signed: false })}
      </span>
    </div>
  );
}
