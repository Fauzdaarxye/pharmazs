import type { ReactNode } from "react";
import { Card, CardHeader } from "./Card";
import { CenteredSpinner, EmptyState, ErrorState } from "./States";

/**
 * A chart container that enforces loading / empty / error states so a chart
 * never silently renders nothing on failure (SRS §40, Contract §7).
 */
export function ChartCard({
  title,
  subtitle,
  controls,
  action,
  loading,
  error,
  isEmpty,
  onRetry,
  className,
  children,
  minHeight = 280,
}: {
  title: string;
  subtitle?: string;
  controls?: ReactNode;
  action?: ReactNode;
  loading?: boolean;
  error?: string | null;
  isEmpty?: boolean;
  onRetry?: () => void;
  className?: string;
  children: ReactNode;
  minHeight?: number;
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} subtitle={subtitle} action={action}>
        {controls}
      </CardHeader>
      <div style={{ minHeight }}>
        {loading ? (
          <CenteredSpinner />
        ) : error ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : isEmpty ? (
          <EmptyState message="No data for the current filters." />
        ) : (
          children
        )}
      </div>
    </Card>
  );
}
