import type { ReactNode } from "react";
import { Construction } from "lucide-react";
import { Card } from "@/components/ui/Card";

/** H1 page title (28px/700) + muted subtitle — every page uses this (§9). */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-text">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-[14px] text-text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * The "Coming next" empty state used by the ten placeholder routes. Kept as a
 * standalone component so another agent can replace a page's body without
 * touching the shell wiring (Task deliverable 5).
 */
export function ComingSoon({
  note = "This section is being built next from the contract's §9 specification.",
}: {
  note?: string;
}) {
  return (
    <Card padded={false} className="p-10">
      <div className="flex flex-col items-center justify-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-bg text-violet">
          <Construction size={22} />
        </span>
        <p className="text-[15px] font-semibold text-text">Coming next</p>
        <p className="max-w-md text-[13px] text-text-muted">{note}</p>
      </div>
    </Card>
  );
}
