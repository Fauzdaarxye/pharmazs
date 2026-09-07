"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  Card,
  CardHeader,
  ChartCard,
  KpiCardSimple,
  TaBadge,
  DeltaBadge,
  CenteredSpinner,
  ErrorState,
  EmptyState,
} from "@/components/ui";
import { ProductTrendChart } from "@/components/products/ProductTrendChart";
import { ForecastChart } from "@/components/products/ForecastChart";
import { endpoints } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { taColor } from "@/lib/constants";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/format";

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ drugId: string }>;
}) {
  const { drugId: drugIdStr } = use(params);
  const drugId = Number(drugIdStr);

  const product = useAsync(() => endpoints.product(drugId), [drugId]);
  const trend = useAsync(() => endpoints.productTrend(drugId), [drugId]);
  const regional = useAsync(() => endpoints.productRegional(drugId), [drugId]);
  const forecast = useAsync(() => endpoints.productForecast(drugId), [drugId]);
  const competitors = useAsync(() => endpoints.productCompetitors(drugId), [drugId]);

  const p = product.data;
  const ourShare = p?.marketSharePct ?? null;
  const maxRegionRevenue = Math.max(1, ...(regional.data?.map((r) => r.revenue) ?? [1]));

  return (
    <>
      <div className="mb-4">
        <Link
          href="/products"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-text-muted transition-colors hover:text-text"
        >
          <ArrowLeft size={14} /> All Products
        </Link>
      </div>

      {/* Header */}
      {product.loading ? (
        <Card><CenteredSpinner /></Card>
      ) : product.error || !p ? (
        <Card>
          <ErrorState message={product.error ?? "Product not found."} onRetry={product.reload} />
        </Card>
      ) : (
        <>
          <PageHeader
            title={p.drugName}
            subtitle={`${p.genericName} · ${p.strength} ${p.dosageForm}`}
            action={
              <div className="flex items-center gap-3">
                <TaBadge area={p.taName} />
                <span className="tnum text-[15px] font-semibold text-text">
                  {formatCurrency(p.unitPrice)}
                </span>
              </div>
            }
          />

          {/* KPI row */}
          <div className="mb-6 grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-5">
            <KpiCardSimple label="Revenue" value={formatCurrency(p.revenue)} subNote="Trailing period" />
            <KpiCardSimple label="Units Sold" value={formatNumber(p.unitsSold)} subNote="Trailing period" />
            <KpiCardSimple label="Rx Volume" value={formatNumber(p.rxVolume)} subNote="Prescriptions" />
            <KpiCardSimple
              label="Growth"
              value={formatPercent(p.growthPct)}
              subNote="vs last period"
              subNoteTone={p.growthPct >= 0 ? "success" : "danger"}
            />
            <KpiCardSimple label="Market Share" value={formatPercent(p.marketSharePct, { signed: false })} subNote="Of segment" />
          </div>
        </>
      )}

      {/* Trend + Regional split */}
      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Revenue & Units Trend"
          subtitle="Monthly revenue with units sold."
          loading={trend.loading}
          error={trend.error}
          isEmpty={!trend.loading && !trend.error && (trend.data?.length ?? 0) === 0}
          onRetry={trend.reload}
          minHeight={340}
        >
          {trend.data && <ProductTrendChart data={trend.data} />}
        </ChartCard>

        <Card>
          <CardHeader title="Regional Split" subtitle="Revenue & market share by region." />
          {regional.loading ? (
            <CenteredSpinner />
          ) : regional.error ? (
            <ErrorState message={regional.error} onRetry={regional.reload} compact />
          ) : (regional.data?.length ?? 0) === 0 ? (
            <EmptyState message="No regional data." />
          ) : (
            <ul className="space-y-4">
              {regional.data!.map((r) => (
                <li key={r.regionId}>
                  <div className="mb-1.5 flex items-center justify-between text-[13px]">
                    <span className="font-medium text-text">{r.regionName}</span>
                    <span className="flex items-center gap-2">
                      <span className="tnum font-semibold text-text">{formatCurrency(r.revenue)}</span>
                      <span className="tnum text-text-muted">MS: {r.marketSharePct.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-bg">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(4, (r.revenue / maxRegionRevenue) * 100)}%`,
                        backgroundColor: taColor(p?.taName),
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Forecast with confidence band */}
      <div className="mb-6">
        <ChartCard
          title="Revenue Forecast"
          subtitle="Projected revenue with a shaded confidence interval — an estimate, not a guarantee (SRS §23)."
          loading={forecast.loading}
          error={forecast.error}
          isEmpty={
            !forecast.loading &&
            !forecast.error &&
            (forecast.data?.forecast?.length ?? 0) === 0
          }
          onRetry={forecast.reload}
          minHeight={340}
          action={
            forecast.data ? (
              <span className="rounded-full border border-border bg-bg px-2.5 py-0.5 text-[12px] font-medium text-text-muted">
                {forecast.data.mape != null
                  ? `Backtest MAPE ${forecast.data.mape.toFixed(1)}% · ${forecast.data.model}`
                  : forecast.data.model}
              </span>
            ) : undefined
          }
        >
          {forecast.data && (
            <div className="space-y-3">
              <ForecastChart result={forecast.data} />
              <p className="text-[12px] text-text-muted">
                The shaded band is the confidence interval around the point forecast.
                {forecast.data.mape != null && (
                  <>
                    {" "}
                    A backtest mean absolute percentage error of{" "}
                    <span className="font-semibold text-text">
                      {forecast.data.mape.toFixed(1)}%
                    </span>{" "}
                    indicates the typical historical miss — treat the projection as
                    directional guidance.
                  </>
                )}
              </p>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Competitor comparison */}
      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader
            title="Competitor Comparison"
            subtitle="Rival brands in the same segment — their price and share against ours."
          />
        </div>
        {competitors.loading ? (
          <div className="p-5"><CenteredSpinner /></div>
        ) : competitors.error ? (
          <div className="p-5"><ErrorState message={competitors.error} onRetry={competitors.reload} /></div>
        ) : (competitors.data?.length ?? 0) === 0 ? (
          <div className="p-5"><EmptyState title="No tracked competitors" message="No rival brands are tracked for this product." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-y border-border bg-bg text-[12px] uppercase tracking-wide text-text-muted">
                  <th className="px-5 py-2.5 text-left font-semibold">Rival Brand</th>
                  <th className="px-5 py-2.5 text-left font-semibold">Company</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Their Price</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Their Share</th>
                  <th className="px-5 py-2.5 text-right font-semibold">vs Ours</th>
                </tr>
              </thead>
              <tbody>
                {competitors.data!.map((c) => {
                  const gapPp = ourShare != null ? ourShare - c.competitorSharePct : null;
                  return (
                    <tr key={c.competitorDrugId} className="border-b border-border last:border-0 hover:bg-bg">
                      <td className="px-5 py-3 font-semibold text-text">{c.competitorName}</td>
                      <td className="px-5 py-3 text-text-muted">{c.companyName}</td>
                      <td className="tnum px-5 py-3 text-right text-text">{formatCurrency(c.unitPrice)}</td>
                      <td className="tnum px-5 py-3 text-right text-text">{formatPercent(c.competitorSharePct, { signed: false })}</td>
                      <td className="px-5 py-3 text-right">
                        {gapPp == null ? (
                          <span className="text-text-muted">—</span>
                        ) : (
                          <DeltaBadge value={gapPp} suffix="pp" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {ourShare != null && (
              <p className="px-5 py-3 text-[12px] text-text-muted">
                “vs Ours” is our market share ({formatPercent(ourShare, { signed: false })})
                minus the rival’s, in percentage points — green means we lead, red means we trail.
              </p>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
