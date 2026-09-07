import { Card } from "./Card";
import { DeltaBadge } from "./Badges";
import { Sparkline } from "./Sparkline";
import { cn } from "@/lib/cn";

/**
 * Dashboard KPI card (Contract §7): label, big value, delta badge + "vs last
 * period", and an optional sparkline.
 */
export function KpiCard({
  label,
  value,
  delta,
  sparkline,
  sparklineColor,
}: {
  label: string;
  value: string;
  delta?: number;
  sparkline?: number[];
  sparklineColor?: string;
}) {
  const deltaColor =
    delta == null ? "#2563EB" : delta >= 0 ? "#16A34A" : "#DC2626";
  return (
    <Card className="flex flex-col justify-between">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium text-text-muted">{label}</span>
        {delta != null && <DeltaBadge value={delta} />}
      </div>
      <div className="mt-2 tnum text-[30px] font-bold leading-none text-text">
        {value}
      </div>
      <div className="mt-3">
        {sparkline && sparkline.length > 1 ? (
          <Sparkline data={sparkline} color={sparklineColor ?? deltaColor} />
        ) : (
          <div className="h-[40px]" />
        )}
      </div>
      <div className="mt-1 text-[12px] text-text-muted">vs last period</div>
    </Card>
  );
}

/** HCP-page KPI variant (Contract §7): big value + muted sub-note, no sparkline. */
export function KpiCardSimple({
  label,
  value,
  subNote,
  subNoteTone = "muted",
}: {
  label: string;
  value: string;
  subNote?: string;
  subNoteTone?: "muted" | "success" | "danger";
}) {
  return (
    <Card className="flex flex-col gap-2">
      <span className="text-[13px] font-medium text-text-muted">{label}</span>
      <span className="tnum text-[30px] font-bold leading-none text-text">{value}</span>
      {subNote && (
        <span
          className={cn(
            "text-[12px] font-medium",
            subNoteTone === "success" && "text-success",
            subNoteTone === "danger" && "text-danger",
            subNoteTone === "muted" && "text-text-muted",
          )}
        >
          {subNote}
        </span>
      )}
    </Card>
  );
}
