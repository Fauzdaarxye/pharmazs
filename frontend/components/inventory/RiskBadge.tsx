"use client";

import { cn } from "@/lib/cn";

/**
 * Risk badge coloured from the API's `riskFlag`. HIGH is red (a supply problem
 * to act on), MEDIUM amber, LOW/OK green, anything else neutral grey.
 */
export function RiskBadge({ flag }: { flag: string }) {
  const f = (flag ?? "").toUpperCase();
  const style =
    f === "HIGH" || f === "CRITICAL"
      ? "bg-danger-bg text-danger"
      : f === "MEDIUM"
        ? "bg-warning-bg text-[#B45309]"
        : f === "LOW" || f === "OK" || f === "HEALTHY"
          ? "bg-success-bg text-success"
          : "bg-[#F1F5F9] text-text-muted";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
        style,
      )}
    >
      {f || "—"}
    </span>
  );
}

/**
 * Stockout-days cell. Zero is quiet; any positive value is visually unmistakable
 * (bold red pill) because a stockout is the true cause of the RespiCare/East
 * revenue drop this page exists to confirm.
 */
export function StockoutDays({ days }: { days: number }) {
  if (!days || days <= 0) {
    return <span className="tnum text-text-muted">0</span>;
  }
  return (
    <span className="tnum inline-flex items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 text-[12px] font-bold text-danger">
      {days} {days === 1 ? "day" : "days"}
    </span>
  );
}
