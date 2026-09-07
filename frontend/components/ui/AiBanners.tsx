import type { ReactNode } from "react";
import { Sparkles, AlertTriangle } from "lucide-react";

/** Violet AI insight banner (Contract §7, §9 /dashboard revenue card). */
export function AiInsightBanner({
  title = "AI Insight",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-violet/30 bg-violet-bg p-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet/10 text-violet">
        <Sparkles size={15} />
      </span>
      <div className="text-[13px] leading-relaxed text-text">
        <span className="font-semibold text-violet">{title}: </span>
        {children}
      </div>
    </div>
  );
}

/** Red AI alert banner (Contract §7, §9 /dashboard regional card). */
export function AiAlertBanner({
  title = "AI Alert",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-bg p-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-danger/10 text-danger">
        <AlertTriangle size={15} />
      </span>
      <div className="text-[13px] leading-relaxed text-text">
        <span className="font-semibold text-danger">{title}: </span>
        {children}
      </div>
    </div>
  );
}
