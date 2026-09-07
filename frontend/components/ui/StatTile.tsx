import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A compact highlight tile — Top Region / Fastest Growing (green) / At Risk (red).
 * (Contract §7, §9 /dashboard regional card.)
 */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "success" | "danger";
  icon?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        tone === "success" && "border-success/30 bg-success-bg",
        tone === "danger" && "border-danger/30 bg-danger-bg",
        tone === "neutral" && "border-border bg-bg",
      )}
    >
      <div className="flex items-center gap-1.5">
        {icon}
        <span
          className={cn(
            "text-[12px] font-medium",
            tone === "success" && "text-success",
            tone === "danger" && "text-danger",
            tone === "neutral" && "text-text-muted",
          )}
        >
          {label}
        </span>
      </div>
      <div className="mt-1 text-[16px] font-bold text-text">{value}</div>
      {sub && <div className="tnum mt-0.5 text-[12px] text-text-muted">{sub}</div>}
    </div>
  );
}
