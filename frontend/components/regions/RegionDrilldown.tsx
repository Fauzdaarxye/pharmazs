"use client";

import { useState } from "react";
import { ChevronRight, Home } from "lucide-react";
import { Card, CardHeader, CenteredSpinner, ErrorState, EmptyState } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { Region, DrilldownLevel, DrilldownRow } from "@/lib/types-pages";
import { taColor } from "@/lib/constants";

/**
 * The SRS §15 hierarchy, presented as one navigable path with breadcrumbs
 * (Region → City → Therapeutic Area → Product) rather than three disconnected
 * dropdowns. Each level drills the SAME selected region; clicking a row advances
 * to the next level, and the breadcrumb walks back up. The last level (Product)
 * is a leaf.
 */
const LEVELS: DrilldownLevel[] = ["city", "ta", "product"];
const LEVEL_LABEL: Record<DrilldownLevel, string> = {
  city: "City",
  ta: "Therapeutic Area",
  product: "Product",
};

interface Crumb {
  level: DrilldownLevel;
  /** The row selected to descend from this level (undefined = still on it). */
  selectedName?: string;
}

export function RegionDrilldown({ region }: { region: Region }) {
  // The navigation path: index 0 is always the current region's first level.
  const [path, setPath] = useState<Crumb[]>([{ level: "city" }]);
  const current = path[path.length - 1];
  const currentLevelIdx = LEVELS.indexOf(current.level);
  const isLeaf = current.level === "product";

  const rows = useAsync(
    () => endpoints.regionDrilldown(region.regionId, current.level),
    [region.regionId, current.level],
  );

  const maxRevenue = Math.max(1, ...(rows.data?.map((d) => d.revenue) ?? [1]));

  const descend = (row: DrilldownRow) => {
    if (isLeaf) return;
    const nextLevel = LEVELS[currentLevelIdx + 1];
    setPath((p) => [
      ...p.slice(0, -1),
      { ...p[p.length - 1], selectedName: row.name },
      { level: nextLevel },
    ]);
  };

  const jumpTo = (idx: number) => {
    // Reset the tail; the clicked crumb becomes the active (unselected) level.
    setPath((p) => p.slice(0, idx + 1).map((c, i) => (i === idx ? { level: c.level } : c)));
  };

  return (
    <Card>
      <CardHeader
        title="Regional Drill-down"
        subtitle="Trace revenue from region down to product (SRS §15)."
      />

      {/* Breadcrumb trail */}
      <nav aria-label="Drill-down path" className="mb-4 flex flex-wrap items-center gap-1.5 text-[13px]">
        <span className="inline-flex items-center gap-1 font-semibold text-text">
          <Home size={13} /> {region.regionName}
        </span>
        {path.map((crumb, idx) => {
          const isCurrent = idx === path.length - 1;
          return (
            <span key={idx} className="inline-flex items-center gap-1.5">
              <ChevronRight size={13} className="text-text-muted" />
              {crumb.selectedName ? (
                <button
                  type="button"
                  onClick={() => jumpTo(idx)}
                  className="font-medium text-primary hover:text-primary-hover"
                >
                  {crumb.selectedName}
                </button>
              ) : (
                <span className={isCurrent ? "font-semibold text-text" : "text-text-muted"}>
                  {LEVEL_LABEL[crumb.level]}
                </span>
              )}
            </span>
          );
        })}
      </nav>

      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-text">
          By {LEVEL_LABEL[current.level]}
        </span>
        {!isLeaf && (
          <span className="text-[12px] text-text-muted">Select a row to drill down</span>
        )}
      </div>

      {rows.loading ? (
        <CenteredSpinner />
      ) : rows.error ? (
        <ErrorState message={rows.error} onRetry={rows.reload} compact />
      ) : (rows.data?.length ?? 0) === 0 ? (
        <EmptyState message={`No ${LEVEL_LABEL[current.level].toLowerCase()} breakdown for this region.`} />
      ) : (
        <ul className="space-y-2.5">
          {rows.data!.map((row) => {
            const clickable = !isLeaf;
            const color = current.level === "ta" ? taColor(row.name) : "#2563EB";
            return (
              <li key={row.id}>
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => descend(row)}
                  className={
                    "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors" +
                    (clickable ? " cursor-pointer hover:border-primary/40 hover:bg-bg" : " cursor-default")
                  }
                >
                  <div className="mb-1.5 flex items-center justify-between text-[13px]">
                    <span className="flex items-center gap-2 font-medium text-text">
                      {row.name}
                      {clickable && <ChevronRight size={13} className="text-text-muted" />}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tnum text-text-muted">{formatNumber(row.units)} units</span>
                      <span className="tnum font-semibold text-text">{formatCurrency(row.revenue)}</span>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-bg" aria-hidden>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(4, (row.revenue / maxRevenue) * 100)}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
