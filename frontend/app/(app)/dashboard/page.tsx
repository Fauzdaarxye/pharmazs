"use client";

import { useState } from "react";
import Link from "next/link";
import { Trophy, TrendingUp as TrendingUpIcon, AlertTriangle, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  Card,
  CardHeader,
  KpiCard,
  SegmentedControl,
  FilterChipBar,
  AiInsightBanner,
  AiAlertBanner,
  StatTile,
  ChartCard,
  DeltaBadge,
  TaBadge,
  CenteredSpinner,
  ErrorState,
  EmptyState,
} from "@/components/ui";
import type { FilterChip } from "@/components/ui";
import { RevenueTrendChart } from "@/components/charts/RevenueTrendChart";
import { endpoints } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { taColor } from "@/lib/constants";
import {
  formatCurrency,
  formatCompact,
  formatNumber,
  formatPercent,
} from "@/lib/format";

const DEFAULT_CHIPS: FilterChip[] = [
  { id: "period", label: "Last 12 Months", removable: false },
  { id: "regions", label: "All Regions" },
  { id: "tas", label: "All Therapeutic Areas" },
  { id: "products", label: "All Products" },
  { id: "reps", label: "All Sales Reps" },
];

export default function DashboardPage() {
  const [chips, setChips] = useState<FilterChip[]>(DEFAULT_CHIPS);
  const [metric, setMetric] = useState<"revenue" | "units">("revenue");
  const [granularity, setGranularity] = useState<"monthly" | "daily">("monthly");

  const kpis = useAsync(() => endpoints.dashboardKpis(), []);
  const trend = useAsync(
    () => endpoints.revenueTrend({ granularity, metric }),
    [granularity, metric],
  );
  const tas = useAsync(() => endpoints.therapeuticAreas(), []);
  const regional = useAsync(() => endpoints.regionalPerformance(), []);
  const products = useAsync(() => endpoints.topProducts(6), []);

  const k = kpis.data;
  const maxTaRevenue = Math.max(1, ...(tas.data?.map((t) => t.revenue) ?? [1]));

  return (
    <>
      <PageHeader
        title="Commercial Intelligence Overview"
        subtitle="Monitor pharmaceutical performance, growth opportunities and emerging risks."
      />

      {/* 1. Filter chip bar */}
      <div className="mb-6">
        <FilterChipBar
          chips={chips}
          onRemove={(id) => setChips((c) => c.filter((chip) => chip.id !== id))}
          onReset={() => setChips(DEFAULT_CHIPS)}
          onApply={() => {}}
        />
      </div>

      {/* 2. Six KPI cards */}
      {kpis.loading ? (
        <div className="mb-6">
          <Card><CenteredSpinner /></Card>
        </div>
      ) : kpis.error || !k ? (
        <div className="mb-6">
          <Card>
            <ErrorState message={kpis.error ?? "KPIs unavailable."} onRetry={kpis.reload} />
          </Card>
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Total Revenue" value={formatCurrency(k.totalRevenue)} delta={k.deltas.totalRevenue} sparkline={k.sparklines.totalRevenue} />
          <KpiCard label="Revenue Growth" value={formatPercent(k.revenueGrowthPct)} delta={k.deltas.revenueGrowthPct} sparkline={k.sparklines.revenueGrowthPct} />
          <KpiCard label="Total Prescriptions" value={formatCompact(k.totalPrescriptions)} delta={k.deltas.totalPrescriptions} sparkline={k.sparklines.totalPrescriptions} />
          <KpiCard label="Active HCPs" value={formatNumber(k.activeHcps)} delta={k.deltas.activeHcps} sparkline={k.sparklines.activeHcps} />
          <KpiCard label="Market Share" value={formatPercent(k.marketSharePct, { signed: false })} delta={k.deltas.marketSharePct} sparkline={k.sparklines.marketSharePct} />
          <KpiCard label="Inventory Availability" value={formatPercent(k.inventoryAvailabilityPct, { signed: false })} delta={k.deltas.inventoryAvailabilityPct} sparkline={k.sparklines.inventoryAvailabilityPct} />
        </div>
      )}

      {/* 3 + 4. Revenue (2/3) + Therapeutic Area (1/3) */}
      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Revenue Performance"
          subtitle="Tracking actual revenue against target goals."
          loading={trend.loading}
          error={trend.error}
          isEmpty={!trend.loading && !trend.error && (trend.data?.length ?? 0) === 0}
          onRetry={trend.reload}
          minHeight={360}
          controls={
            <div className="flex items-center gap-2">
              <SegmentedControl
                ariaLabel="Metric"
                options={[
                  { label: "Revenue", value: "revenue" },
                  { label: "Units", value: "units" },
                ]}
                value={metric}
                onChange={setMetric}
              />
              <SegmentedControl
                ariaLabel="Granularity"
                options={[
                  { label: "Monthly", value: "monthly" },
                  { label: "Daily", value: "daily" },
                ]}
                value={granularity}
                onChange={setGranularity}
              />
            </div>
          }
        >
          <div className="space-y-4">
            <AiInsightBanner>
              Revenue is tracking{" "}
              <span className="font-semibold">above target in West and South</span>, but{" "}
              <span className="font-semibold">North is trailing</span> on a CardioMax
              demand-and-engagement decline — prioritise the top North cardiologists.
            </AiInsightBanner>
            {trend.data && <RevenueTrendChart data={trend.data} metric={metric} />}
          </div>
        </ChartCard>

        <Card>
          <CardHeader
            title="Therapeutic Area Performance"
            subtitle="Revenue contribution & growth matrix."
          />
          {tas.loading ? (
            <CenteredSpinner />
          ) : tas.error ? (
            <ErrorState message={tas.error} onRetry={tas.reload} compact />
          ) : (tas.data?.length ?? 0) === 0 ? (
            <EmptyState message="No therapeutic-area data." />
          ) : (
            <ul className="space-y-4">
              {tas.data!.map((ta) => (
                <li key={ta.taId}>
                  <div className="mb-1.5 flex items-center justify-between text-[13px]">
                    <span className="font-medium text-text">{ta.taName}</span>
                    <span className="flex items-center gap-2">
                      <span className="tnum font-semibold text-text">
                        {formatCurrency(ta.revenue)}
                      </span>
                      <span
                        className="tnum font-semibold"
                        style={{ color: ta.growthPct >= 0 ? "#16A34A" : "#DC2626" }}
                      >
                        {formatPercent(ta.growthPct)}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-bg">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(4, (ta.revenue / maxTaRevenue) * 100)}%`,
                        backgroundColor: taColor(ta.taName),
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* 5. Regional Performance */}
      <div className="mb-6">
        <Card>
          <CardHeader
            title="Regional Performance"
            subtitle="Comparison across core geographical markets."
          />
          {regional.loading ? (
            <CenteredSpinner />
          ) : regional.error ? (
            <ErrorState message={regional.error} onRetry={regional.reload} />
          ) : (regional.data?.data.length ?? 0) === 0 ? (
            <EmptyState message="No regional data." />
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatTile
                  label="Top Region"
                  value={regional.data!.highlights?.topRegion ?? "—"}
                  icon={<Trophy size={14} />}
                  tone="neutral"
                />
                <StatTile
                  label="Fastest Growing"
                  value={regional.data!.highlights?.fastestGrowing ?? "—"}
                  icon={<TrendingUpIcon size={14} />}
                  tone="success"
                />
                <StatTile
                  label="At Risk"
                  value={regional.data!.highlights?.atRisk ?? "—"}
                  icon={<AlertTriangle size={14} />}
                  tone="danger"
                />
              </div>

              <ul className="divide-y divide-border">
                {regional.data!.data.map((r) => (
                  <li key={r.regionId} className="flex items-center justify-between py-2.5">
                    <span className="text-[14px] font-medium text-text">{r.regionName}</span>
                    <div className="flex items-center gap-4">
                      <span className="tnum text-[13px] text-text-muted">
                        MS: {r.marketSharePct.toFixed(1)}%
                      </span>
                      <span className="tnum text-[14px] font-semibold text-text">
                        {formatCurrency(r.revenue)}
                      </span>
                      <DeltaBadge value={r.growthPct} />
                    </div>
                  </li>
                ))}
              </ul>

              <AiAlertBanner>
                <span className="font-semibold">East revenue is down and at risk</span> — a
                RespiCare stockout (not a demand drop) is the leading cause; expedite
                replenishment before share erodes further.
              </AiAlertBanner>
            </div>
          )}
        </Card>
      </div>

      {/* 6. Top Performing Products */}
      <Card padded={false}>
        <div className="p-5 pb-0">
          <CardHeader
            title="Top Performing Products"
            subtitle="Clinical leaders ranked by current commercial impact."
            action={
              <Link
                href="/products"
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:text-primary-hover"
              >
                View All Products <ArrowRight size={14} />
              </Link>
            }
          />
        </div>
        {products.loading ? (
          <div className="p-5"><CenteredSpinner /></div>
        ) : products.error ? (
          <div className="p-5"><ErrorState message={products.error} onRetry={products.reload} /></div>
        ) : (products.data?.length ?? 0) === 0 ? (
          <div className="p-5"><EmptyState message="No product data." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-y border-border bg-bg text-[12px] uppercase tracking-wide text-text-muted">
                  <th className="px-5 py-2.5 text-left font-semibold">Rank</th>
                  <th className="px-5 py-2.5 text-left font-semibold">Product</th>
                  <th className="px-5 py-2.5 text-left font-semibold">Therapeutic Area</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Revenue</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Growth</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Prescriptions</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Mkt Share</th>
                </tr>
              </thead>
              <tbody>
                {products.data!.map((p) => (
                  <tr key={p.drugId} className="border-b border-border last:border-0 hover:bg-bg">
                    <td className="tnum px-5 py-3 font-semibold text-text-muted">#{p.rank}</td>
                    <td className="px-5 py-3 font-semibold text-text">{p.drugName}</td>
                    <td className="px-5 py-3"><TaBadge area={p.taName} /></td>
                    <td className="tnum px-5 py-3 text-right font-semibold text-text">{formatCurrency(p.revenue)}</td>
                    <td className="px-5 py-3 text-right"><DeltaBadge value={p.growthPct} /></td>
                    <td className="tnum px-5 py-3 text-right text-text">{formatNumber(p.prescriptions)}</td>
                    <td className="tnum px-5 py-3 text-right text-text">{formatPercent(p.marketSharePct, { signed: false })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
