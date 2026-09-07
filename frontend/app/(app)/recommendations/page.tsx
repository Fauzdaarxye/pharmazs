"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader, CenteredSpinner, ErrorState, EmptyState, SegmentedControl } from "@/components/ui";
import { PageHeader } from "@/components/shell/PageHeader";
import { endpoints } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import type { MetaFilters } from "@/lib/types";
import { RecommendationCard } from "@/components/recommendations/RecommendationCard";
import { WhySalesChangedResult } from "@/components/recommendations/WhySalesChangedResult";

const REC_LIMIT = 8;

/**
 * The live /meta/filters payload keys products/regions as {drugId,drugName} /
 * {regionId,regionName} — NOT the {id,name} that lib/types typed. Both are
 * shared, read-only files, so we normalise defensively here rather than trusting
 * either. `?? id/name` keeps us correct if the API is ever brought in line.
 */
type MetaRegion = { regionId?: number; regionName?: string; id?: number; name?: string };
type MetaProduct = { drugId?: number; drugName?: string; id?: number; name?: string };

function normRegions(meta: MetaFilters | null): { id: number; name: string }[] {
  const rows = (meta?.regions ?? []) as unknown as MetaRegion[];
  return rows
    .map((r) => ({ id: r.regionId ?? r.id, name: r.regionName ?? r.name }))
    .filter((r): r is { id: number; name: string } => r.id != null && !!r.name);
}
function normProducts(meta: MetaFilters | null): { id: number; name: string }[] {
  const rows = (meta?.products ?? []) as unknown as MetaProduct[];
  return rows
    .map((p) => ({ id: p.drugId ?? p.id, name: p.drugName ?? p.name }))
    .filter((p): p is { id: number; name: string } => p.id != null && !!p.name);
}

// SRS §44 demo scenario — must land on first paint with no user input.
const DEMO_DRUG = "CardioMax";
const DEMO_REGION = "North";

const PERIOD_OPTIONS = [
  { label: "2 months", value: "2" },
  { label: "3 months", value: "3" },
  { label: "6 months", value: "6" },
];

export default function RecommendationsPage() {
  const recs = useAsync(() => endpoints.recommendations(REC_LIMIT), []);
  const meta = useAsync(() => endpoints.metaFilters(), []);

  const products = useMemo(() => normProducts(meta.data), [meta.data]);
  const regions = useMemo(() => normRegions(meta.data), [meta.data]);

  // Selectors default to the demo scenario, resolved by NAME so a re-seed that
  // changes ids does not break the default. Until meta loads, drugId/regionId
  // are undefined and the query is held back.
  const [drugName, setDrugName] = useState(DEMO_DRUG);
  const [regionName, setRegionName] = useState(DEMO_REGION);
  const [periodMonths, setPeriodMonths] = useState("3");

  const drugId = useMemo(
    () => products.find((p) => p.name === drugName)?.id,
    [products, drugName],
  );
  const regionId = useMemo(
    () => regions.find((r) => r.name === regionName)?.id,
    [regions, regionName],
  );

  const ready = drugId != null && regionId != null;
  const why = useAsync(
    () =>
      ready
        ? endpoints.whyDidSalesChange({ drugId: drugId!, regionId: regionId!, periodMonths: Number(periodMonths) })
        : Promise.resolve(null),
    [drugId, regionId, periodMonths],
  );

  return (
    <>
      <PageHeader
        title="Recommendations"
        subtitle="Decision support: what to do next, why, and the expected impact."
      />

      {/* (a) Recommendation cards */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-text">Prioritised actions</h2>
          <p className="text-[13px] text-text-muted">
            Computed from the current data — each card links to the entity it concerns.
          </p>
        </div>
      </div>

      {recs.loading ? (
        <Card><CenteredSpinner /></Card>
      ) : recs.error ? (
        <Card><ErrorState message={recs.error} onRetry={recs.reload} /></Card>
      ) : (recs.data?.length ?? 0) === 0 ? (
        <Card><EmptyState message="No recommendations right now." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {recs.data!.map((r, i) => (
            <RecommendationCard key={`${r.recType}-${r.targetEntityId ?? i}`} rec={r} />
          ))}
        </div>
      )}

      {/* (b) Why did sales change? */}
      <div className="mt-8">
        <Card>
          <CardHeader
            title="Why did sales change?"
            subtitle="Root-cause attribution across the five commercial drivers (SRS §25, §26)."
            action={
              <SegmentedControl
                ariaLabel="Comparison window"
                options={PERIOD_OPTIONS}
                value={periodMonths}
                onChange={setPeriodMonths}
              />
            }
          />

          {/* Drug + region selectors */}
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[13px]">
              <span className="text-text-muted">Product:</span>
              <select
                value={drugName}
                onChange={(e) => setDrugName(e.target.value)}
                disabled={meta.loading || products.length === 0}
                className="cursor-pointer bg-transparent font-medium text-text outline-none disabled:cursor-not-allowed"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[13px]">
              <span className="text-text-muted">Region:</span>
              <select
                value={regionName}
                onChange={(e) => setRegionName(e.target.value)}
                disabled={meta.loading || regions.length === 0}
                className="cursor-pointer bg-transparent font-medium text-text outline-none disabled:cursor-not-allowed"
              >
                {regions.map((r) => (
                  <option key={r.id} value={r.name}>{r.name}</option>
                ))}
              </select>
            </label>
            {ready && (
              <span className="text-[12px] text-text-muted">
                Showing <span className="font-medium text-text">{drugName}</span> in{" "}
                <span className="font-medium text-text">{regionName}</span>
              </span>
            )}
          </div>

          {meta.error ? (
            <ErrorState message={meta.error} onRetry={meta.reload} />
          ) : meta.loading || !ready || why.loading ? (
            <CenteredSpinner />
          ) : why.error ? (
            <ErrorState message={why.error} onRetry={why.reload} />
          ) : !why.data ? (
            <EmptyState message="No root-cause data for this selection." />
          ) : (
            <WhySalesChangedResult result={why.data} />
          )}
        </Card>
      </div>
    </>
  );
}
