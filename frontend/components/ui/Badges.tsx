import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { taColor } from "@/lib/constants";
import { formatPercent, formatScore } from "@/lib/format";
import type { Priority } from "@/lib/types";

/** Green +x% / red −x% pill (Contract §7). Neutral grey at zero. */
export function DeltaBadge({
  value,
  className,
  suffix = "%",
}: {
  value: number | null | undefined;
  className?: string;
  suffix?: "%" | "pp";
}) {
  if (value == null || Number.isNaN(value)) {
    return <span className={cn("text-[13px] text-text-muted", className)}>—</span>;
  }
  const positive = value > 0;
  const negative = value < 0;
  const text =
    suffix === "pp"
      ? `${positive ? "+" : ""}${value.toFixed(1)} pp`
      : formatPercent(value);
  return (
    <span
      className={cn(
        "tnum inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-semibold",
        positive && "bg-success-bg text-success",
        negative && "bg-danger-bg text-danger",
        !positive && !negative && "bg-[#F1F5F9] text-text-muted",
        className,
      )}
    >
      {text}
    </span>
  );
}

export function Pill({
  children,
  color,
  className,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium",
        className,
      )}
      style={
        color
          ? { backgroundColor: `${color}1A`, color }
          : { backgroundColor: "#F1F5F9", color: "#334155" }
      }
    >
      {color && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}

/** Therapeutic-area badge, coloured by the fixed §7 map. */
export function TaBadge({ area }: { area: string }) {
  return <Pill color={taColor(area)}>{area}</Pill>;
}

/** Score chip: green ≥80, amber 50–79, grey <50 (Contract §7). */
export function ScoreBadge({
  score,
  showMax = false,
}: {
  score: number;
  showMax?: boolean;
}) {
  const band =
    score >= 80
      ? "bg-success-bg text-success"
      : score >= 50
        ? "bg-warning-bg text-[#B45309]"
        : "bg-[#F1F5F9] text-text-muted";
  return (
    <span
      className={cn(
        "tnum inline-flex min-w-[42px] items-center justify-center rounded-md px-2 py-0.5 text-[13px] font-semibold",
        band,
      )}
    >
      {showMax ? formatScore(score, 0) : Math.round(score)}
    </span>
  );
}

// HIGH is GREEN, not red. In this product a HIGH priority HCP is an
// opportunity worth a rep's time, not a problem — the Figma shows HIGH on a
// green tint, MEDIUM amber, LOW grey. Rendering HIGH in danger-red inverted the
// meaning of the most important column on the page.
const PRIORITY_STYLE: Record<Priority, string> = {
  HIGH: "bg-success-bg text-success",
  MEDIUM: "bg-warning-bg text-[#B45309]",
  LOW: "bg-[#F1F5F9] text-text-muted",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
        PRIORITY_STYLE[priority],
      )}
    >
      {priority}
    </span>
  );
}
