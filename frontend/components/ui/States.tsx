import type { ReactNode } from "react";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary",
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

export function CenteredSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-text-muted">
      <Spinner />
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

/** Error state — required on every data surface (SRS §40). */
export function ErrorState({
  message = "Something went wrong loading this data.",
  onRetry,
  compact = false,
}: {
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        compact ? "py-6" : "py-10",
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-danger-bg text-danger">
        <AlertTriangle size={20} />
      </span>
      <p className="max-w-sm text-[13px] text-text-muted">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-text transition-colors hover:bg-bg"
        >
          <RefreshCw size={14} /> Retry
        </button>
      )}
    </div>
  );
}

/** Empty state — required on every data surface (SRS §40). */
export function EmptyState({
  title = "Nothing to show",
  message,
  icon,
  action,
}: {
  title?: string;
  message?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-bg text-text-muted">
        {icon ?? <Inbox size={20} />}
      </span>
      <div>
        <p className="text-[14px] font-medium text-text">{title}</p>
        {message && <p className="mt-1 max-w-sm text-[13px] text-text-muted">{message}</p>}
      </div>
      {action}
    </div>
  );
}
