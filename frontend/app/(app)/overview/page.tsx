"use client";

import Link from "next/link";
import { ArrowRight, Bell, Lightbulb } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  Card,
  CardHeader,
  DeltaBadge,
  CenteredSpinner,
  ErrorState,
  EmptyState,
} from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { taColor } from "@/lib/constants";
import { formatCurrency, formatPercent } from "@/lib/format";
import { AlertRow, RecommendationRow } from "@/components/overview/OverviewLists";

export default function OverviewPage() {
  const kpis = useAsync(() => endpoints.dashboardKpis(), []);
  const alerts = useAsync(() => endpoints.alertList({ pageSize: 3 }), []);
  const recs = useAsync(() => endpoints.recommendations(3), []);
  const tas = useAsync(() => endpoints.therapeuticAreas(), []);
  const regional = useAsync(() => endpoints.regionalPerformance(), []);

  const k = kpis.data;
  const maxTaRevenue = Math.max(1, ...(tas.data?.map((t) => t.revenue) ?? [1]));

  return (
    <>
      <PageHeader
        title="Executive Overview"
        subtitle="The headline view: performance, the risks that need attention, and where to act."
      />

      {/* Headline revenue + growth — two large tiles, not a six-KPI row */}
      {kpis.loading ? (
        <div className="mb-6"><Card><CenteredSpinner /></Card></div>
      ) : kpis.error || !k ? (
        <div className="mb-6">
          <Card><ErrorState message={kpis.error ?? "Headline figures unavailable."} onRetry={kpis.reload} /></Card>
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-5 md:grid-cols-3">
          <Card className="md:col-span-2 flex flex-col justify-between">
            <span className="text-[13px] font-medium text-text-muted">Total Revenue</span>
            <div className="mt-2 flex items-end gap-3">
              <span className="tnum text-[40px] font-bold leading-none text-text">
                {formatCurrency(k.totalRevenue)}
              </span>
              <DeltaBadge value={k.deltas.totalRevenue} />
            </div>
            <span className="mt-2 text-[12px] text-text-muted">Trailing 12 months vs prior period</span>
          </Card>
          <Card className="flex flex-col justify-between">
            <span className="text-[13px] font-medium text-text-muted">Revenue Growth</span>
            <div className="mt-2 flex items-end gap-3">
              <span className="tnum text-[40px] font-bold leading-none text-text">
                {formatPercent(k.revenueGrowthPct, { signed: false })}
              </span>
              <DeltaBadge value={k.deltas.revenueGrowthPct} />
            </div>
            <span className="mt-2 text-[12px] text-text-muted">Year-over-year</span>
          </Card>
        </div>
      )}

      {/* Alerts + Recommendations */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card padded={false} className="p-5">
          <CardHeader
            title="Top Alerts"
            subtitle="The three most pressing signals right now."
            action={
              <Link href="/alerts" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:text-primary-hover">
                View all <ArrowRight size={14} />
              </Link>
            }
          />
          {alerts.loading ? (
            <CenteredSpinner />
          ) : alerts.error ? (
            <ErrorState message={alerts.error} onRetry={alerts.reload} compact />
          ) : (alerts.data?.data.length ?? 0) === 0 ? (
            <EmptyState icon={<Bell size={20} />} title="No active alerts" message="Nothing needs attention right now." />
          ) : (
            <ul className="divide-y divide-border">
              {alerts.data!.data.map((a) => (
                <AlertRow key={a.alertId} alert={a} />
              ))}
            </ul>
          )}
        </Card>

        <Card padded={false} className="p-5">
          <CardHeader
            title="Top Recommendations"
            subtitle="Where the data says to act next."
            action={
              <Link href="/recommendations" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:text-primary-hover">
                View all <ArrowRight size={14} />
              </Link>
            }
          />
          {recs.loading ? (
            <CenteredSpinner />
          ) : recs.error ? (
            <ErrorState message={recs.error} onRetry={recs.reload} compact />
          ) : (recs.data?.length ?? 0) === 0 ? (
            <EmptyState icon={<Lightbulb size={20} />} title="No recommendations" message="No decision-support items at the moment." />
          ) : (
            <ul className="divide-y divide-border">
              {recs.data!.map((rec, i) => (
                <RecommendationRow key={i} rec={rec} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Compact TA breakdown + regional summary */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Therapeutic Areas" subtitle="Revenue contribution by area." />
          {tas.loading ? (
            <CenteredSpinner />
          ) : tas.error ? (
            <ErrorState message={tas.error} onRetry={tas.reload} compact />
          ) : (tas.data?.length ?? 0) === 0 ? (
            <EmptyState message="No therapeutic-area data." />
          ) : (
            <ul className="space-y-3">
              {tas.data!.map((ta) => (
                <li key={ta.taId}>
                  <div className="mb-1 flex items-center justify-between text-[13px]">
                    <span className="font-medium text-text">{ta.taName}</span>
                    <span className="flex items-center gap-2">
                      <span className="tnum font-semibold text-text">{formatCurrency(ta.revenue)}</span>
                      <DeltaBadge value={ta.growthPct} />
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-bg" aria-hidden>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(4, (ta.revenue / maxTaRevenue) * 100)}%`, backgroundColor: taColor(ta.taName) }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Regional Summary"
            subtitle="Performance across markets."
            action={
              <Link href="/regions" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:text-primary-hover">
                Details <ArrowRight size={14} />
              </Link>
            }
          />
          {regional.loading ? (
            <CenteredSpinner />
          ) : regional.error ? (
            <ErrorState message={regional.error} onRetry={regional.reload} compact />
          ) : (regional.data?.data.length ?? 0) === 0 ? (
            <EmptyState message="No regional data." />
          ) : (
            <ul className="divide-y divide-border">
              {regional.data!.data.map((r) => (
                <li key={r.regionId} className="flex items-center justify-between py-2.5">
                  <span className="text-[14px] font-medium text-text">{r.regionName}</span>
                  <div className="flex items-center gap-4">
                    <span className="tnum text-[13px] text-text-muted">
                      MS: {r.marketSharePct.toFixed(1)}%
                    </span>
                    <span className="tnum text-[14px] font-semibold text-text">{formatCurrency(r.revenue)}</span>
                    <DeltaBadge value={r.growthPct} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
