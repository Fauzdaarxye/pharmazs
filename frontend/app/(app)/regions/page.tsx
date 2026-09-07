"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  Card,
  ChartCard,
  DataTable,
  DeltaBadge,
  SegmentedControl,
  CenteredSpinner,
  ErrorState,
} from "@/components/ui";
import type { Column, SortState } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { Region } from "@/lib/types-pages";
import { RegionRevenueChart } from "@/components/regions/RegionRevenueChart";
import { RegionDrilldown } from "@/components/regions/RegionDrilldown";

export default function RegionsPage() {
  // /regions returns the full set of 5 regions (no server pager); sort in the
  // browser is acceptable here because it is a fixed, tiny comparison set — not
  // a fact table. Server-side pagination applies to the big tables, not this.
  const regions = useAsync(() => endpoints.regions(), []);
  const [sort, setSort] = useState<SortState>({ key: "revenue", dir: "desc" });
  const [selectedRegionId, setSelectedRegionId] = useState<number | null>(null);

  const data = useMemo(() => regions.data ?? [], [regions.data]);

  const sortedRows = useMemo(() => {
    const key = sort.key as keyof Region;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...data].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [data, sort]);

  // Default the drilldown to the top region once data arrives.
  const selectedRegion = useMemo(() => {
    if (data.length === 0) return null;
    const id = selectedRegionId ?? [...data].sort((a, b) => b.revenue - a.revenue)[0].regionId;
    return data.find((r) => r.regionId === id) ?? null;
  }, [data, selectedRegionId]);

  const columns: Column<Region>[] = [
    {
      key: "region",
      header: "Region",
      sortKey: "regionName",
      render: (r) => <span className="font-semibold text-text">{r.regionName}</span>,
    },
    { key: "zoneHead", header: "Zone Head", render: (r) => <span className="text-text-muted">{r.zoneHead}</span> },
    {
      key: "revenue",
      header: "Revenue",
      align: "right",
      numeric: true,
      sortKey: "revenue",
      render: (r) => <span className="font-semibold text-text">{formatCurrency(r.revenue)}</span>,
    },
    { key: "growth", header: "Growth", align: "right", sortKey: "growthPct", render: (r) => <DeltaBadge value={r.growthPct} /> },
    {
      key: "share",
      header: "Market Share",
      align: "right",
      numeric: true,
      sortKey: "marketSharePct",
      render: (r) => formatPercent(r.marketSharePct, { signed: false }),
    },
    {
      key: "prescriptions",
      header: "Prescriptions",
      align: "right",
      numeric: true,
      sortKey: "prescriptions",
      render: (r) => formatNumber(r.prescriptions),
    },
    { key: "hcpCount", header: "HCPs", align: "right", numeric: true, sortKey: "hcpCount", render: (r) => formatNumber(r.hcpCount) },
    { key: "repCount", header: "Reps", align: "right", numeric: true, sortKey: "repCount", render: (r) => formatNumber(r.repCount) },
  ];

  return (
    <>
      <PageHeader
        title="Regions"
        subtitle="Compare geographical markets and trace revenue down to product (SRS §15)."
      />

      {/* Comparison table */}
      <div className="mb-3">
        <h2 className="text-[16px] font-semibold text-text">Regional Comparison</h2>
        <p className="text-[13px] text-text-muted">Sort any column to re-rank the markets.</p>
      </div>
      <div className="mb-6">
        <DataTable
          columns={columns}
          rows={sortedRows}
          rowKey={(r) => r.regionId}
          loading={regions.loading}
          error={regions.error}
          onRetry={regions.reload}
          sort={sort}
          onSortChange={setSort}
          emptyTitle="No regions found"
          emptyMessage="No regional data is available."
        />
      </div>

      {/* Revenue chart + drill-down */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard
          title="Revenue by Region"
          subtitle="Relative commercial performance across markets."
          loading={regions.loading}
          error={regions.error}
          isEmpty={!regions.loading && !regions.error && data.length === 0}
          onRetry={regions.reload}
          minHeight={300}
        >
          {data.length > 0 && <RegionRevenueChart data={data} />}
        </ChartCard>

        <div>
          {regions.loading ? (
            <Card><CenteredSpinner /></Card>
          ) : regions.error ? (
            <Card><ErrorState message={regions.error} onRetry={regions.reload} /></Card>
          ) : selectedRegion ? (
            <div className="space-y-3">
              <Card padded={false} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-text-muted">Drill into:</span>
                  <SegmentedControl
                    ariaLabel="Region to drill down"
                    options={data
                      .slice()
                      .sort((a, b) => b.revenue - a.revenue)
                      .map((r) => ({ label: r.regionName, value: String(r.regionId) }))}
                    value={String(selectedRegion.regionId)}
                    onChange={(v) => setSelectedRegionId(Number(v))}
                  />
                </div>
              </Card>
              <RegionDrilldown key={selectedRegion.regionId} region={selectedRegion} />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
