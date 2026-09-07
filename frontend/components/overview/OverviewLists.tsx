import { AlertTriangle, TrendingUp, Lightbulb } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatRelativeDate } from "@/lib/format";
import type { AlertItem, Recommendation, Severity } from "@/lib/types-pages";

const SEVERITY_STYLE: Record<Severity, { dot: string; text: string; bg: string }> = {
  CRITICAL: { dot: "bg-danger", text: "text-danger", bg: "bg-danger-bg" },
  HIGH: { dot: "bg-warning", text: "text-[#B45309]", bg: "bg-warning-bg" },
  MEDIUM: { dot: "bg-primary", text: "text-primary", bg: "bg-[#EFF6FF]" },
  LOW: { dot: "bg-[#94A3B8]", text: "text-text-muted", bg: "bg-bg" },
};

/** A single top-alert row for the executive overview. */
export function AlertRow({ alert }: { alert: AlertItem }) {
  const s = SEVERITY_STYLE[alert.severity] ?? SEVERITY_STYLE.LOW;
  return (
    <li className="flex items-start gap-3 py-3">
      <span className={cn("mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", s.bg, s.text)}>
        <AlertTriangle size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", s.bg, s.text)}>
            {alert.severity}
          </span>
          <span className="truncate text-[13px] font-semibold text-text">{alert.title}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12px] text-text-muted">{alert.message}</p>
      </div>
      <span className="shrink-0 whitespace-nowrap text-[11px] text-text-muted">
        {formatRelativeDate(alert.createdAt)}
      </span>
    </li>
  );
}

const REC_PRIORITY_STYLE: Record<string, string> = {
  HIGH: "bg-success-bg text-success",
  MEDIUM: "bg-warning-bg text-[#B45309]",
  LOW: "bg-[#F1F5F9] text-text-muted",
};

/** A single recommendation row for the executive overview. */
export function RecommendationRow({ rec }: { rec: Recommendation }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-bg text-violet">
        <Lightbulb size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              REC_PRIORITY_STYLE[rec.priority] ?? REC_PRIORITY_STYLE.LOW,
            )}
          >
            {rec.priority}
          </span>
          <span className="truncate text-[13px] font-semibold text-text">{rec.title}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12px] text-text-muted">{rec.rationale}</p>
        <div className="mt-1 flex items-center gap-3 text-[11px] text-text-muted">
          <span className="inline-flex items-center gap-1 font-medium text-success">
            <TrendingUp size={11} /> {rec.expectedImpact}
          </span>
          <span className="tnum">Confidence {(rec.confidence * 100).toFixed(0)}%</span>
        </div>
      </div>
    </li>
  );
}
