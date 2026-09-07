"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  ChartCard,
  DataTable,
  AiAlertBanner,
  StatTile,
} from "@/components/ui";
import type { Column, SortState } from "@/components/ui";
import { ShareMovementChart } from "@/components/competitors/ShareMovementChart";
import { endpoints } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { formatPercent } from "@/lib/format";
import type { Competitor } from "@/lib/types-pages";

const ALL = "All";
const clear = (v: string): string | undefined => (v === ALL ? undefined : v);

// /meta/filters returns {drugId,drugName}/{regionId,regionName} at runtime
// (verified against the live API); the shared FilterOption type is {id,name}.

export default function CompetitorsPage() {
  const [sort, setSort] = useState<SortState>({ key: "avgSharePct", dir: "desc" });

  const meta = useAsync(() => endpoints.metaFilters(), []);
  const competitors = useAsync(() => endpoints.competitors(), []);

  // Drug selector — default to CardioMax (the planted competitive-loss story).
  const productOptions = useMemo(
    () => (meta.data?.products ?? []),
    [meta.data],
  );
  const regionList = useMemo(() => meta.data?.regions ?? [], [meta.data]);
  const [drugId, setDrugId] = useState<number | null>(null);
  const [region, setRegion] = useState<string>(ALL);

  // Resolve the default drug once products load: prefer CardioMax by name.
  const effectiveDrugId = useMemo(() => {
    if (drugId != null) return drugId;
    const cardio = productOptions.find((p) => p.drugName === "CardioMax");
    return cardio?.drugId ?? productOptions[0]?.drugId ?? null;
  }, [drugId, productOptions]);

  const regionId = useMemo(() => {
    const name = clear(region);
    return name ? regionList.find((r) => r.regionName === name)?.regionId : undefined;
  }, [region, regionList]);

  const share = useAsync(
    () =>
      effectiveDrugId != null
        ? endpoints.competitorMarketShare({ drugId: effectiveDrugId, regionId })
        : Promise.resolve([]),
    [effectiveDrugId, regionId],
  );

  const selectedDrugName =
    productOptions.find((p) => p.drugId === effectiveDrugId)?.drugName ?? "product";

  // Latest point drives the loss callout and the two StatTiles.
  const latest = share.data?.at(-1) ?? null;
  const gapPp = latest ? latest.ourSharePct - latest.competitorSharePct : null;
  const isLoss = gapPp != null && gapPp < -3; // trailing by >3pp = a real loss

  const columns: Column<Competitor>[] = [
    { key: "company", header: "Company", sortKey: "companyName", render: (c) => <span className="font-semibold text-text">{c.companyName}</span> },
    { key: "hq", header: "HQ Country", render: (c) => <span className="text-text-muted">{c.hqCountry}</span> },
    { key: "drugs", header: "Tracked Brands", align: "right", numeric: true, sortKey: "drugCount", render: (c) => c.drugCount },
    { key: "share", header: "Avg. Share", align: "right", numeric: true, sortKey: "avgSharePct", render: (c) => formatPercent(c.avgSharePct, { signed: false }) },
  ];

  // Sort the company table client-side — /competitors returns the full set (6 rows).
  const sortedCompanies = useMemo(() => {
    const rows = [...(competitors.data ?? [])];
    const key = sort.key as keyof Competitor;
    rows.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sort.dir === "desc" ? -cmp : cmp;
    });
    return rows;
  }, [competitors.data, sort]);

  return (
    <>
      <PageHeader
        title="Competitors"
        subtitle="Track rival companies and how our share moves against theirs, product by product."
      />

      {/* Competitive-loss callout — the point of this page. */}
      {isLoss && latest && (
        <div className="mb-6">
          <AiAlertBanner title="Competitive loss">
            <span className="font-semibold">
              {selectedDrugName}
              {clear(region) ? ` in ${clear(region)}` : ""}
            </span>{" "}
            is losing share — we hold{" "}
            <span className="font-semibold">{latest.ourSharePct.toFixed(1)}%</span> against the
            competitor’s{" "}
            <span className="font-semibold">{latest.competitorSharePct.toFixed(1)}%</span> as of{" "}
            {latest.period}, a gap of{" "}
            <span className="font-semibold">{Math.abs(gapPp!).toFixed(1)} pp</span>. Open the
            root-cause view to see what is driving it.
          </AiAlertBanner>
        </div>
      )}

      {/* Company table */}
      <div className="mb-6">
        <div className="mb-3">
          <h2 className="text-[16px] font-semibold text-text">Tracked Competitors</h2>
          <p className="text-[13px] text-text-muted">Rival companies and their average market share.</p>
        </div>
        <DataTable
          columns={columns}
          rows={sortedCompanies}
          rowKey={(c) => c.competitorId}
          loading={competitors.loading}
          error={competitors.error}
          onRetry={competitors.reload}
          sort={sort}
          onSortChange={setSort}
          emptyTitle="No competitors tracked"
          emptyMessage="No rival companies are configured yet."
        />
      </div>

      {/* Share movement */}
      <ChartCard
        title="Share Movement Over Time"
        subtitle="Our market share against the leading competitor’s, month by month."
        loading={share.loading || meta.loading}
        error={share.error || meta.error}
        isEmpty={
          !share.loading && !share.error && (share.data?.length ?? 0) === 0
        }
        onRetry={share.reload}
        minHeight={360}
        controls={
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[13px]">
              <span className="text-text-muted">Product:</span>
              <select
                value={effectiveDrugId ?? ""}
                onChange={(e) => setDrugId(Number(e.target.value))}
                className="cursor-pointer bg-transparent font-medium text-text outline-none"
                aria-label="Select product"
              >
                {productOptions.map((p) => (
                  <option key={p.drugId} value={p.drugId}>{p.drugName}</option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[13px]">
              <span className="text-text-muted">Region:</span>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="cursor-pointer bg-transparent font-medium text-text outline-none"
                aria-label="Select region"
              >
                <option value={ALL}>{ALL}</option>
                {regionList.map((r) => (
                  <option key={r.regionId} value={r.regionName}>{r.regionName}</option>
                ))}
              </select>
            </label>
          </div>
        }
      >
        {share.data && share.data.length > 0 && (
          <div className="space-y-4">
            {latest && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatTile label="Our Share (latest)" value={`${latest.ourSharePct.toFixed(1)}%`} tone="neutral" />
                <StatTile label="Competitor Share (latest)" value={`${latest.competitorSharePct.toFixed(1)}%`} tone={isLoss ? "danger" : "neutral"} />
                <StatTile
                  label="Gap vs Competitor"
                  value={gapPp != null ? `${gapPp >= 0 ? "+" : ""}${gapPp.toFixed(1)} pp` : "—"}
                  tone={gapPp == null ? "neutral" : gapPp >= 0 ? "success" : "danger"}
                />
              </div>
            )}
            <ShareMovementChart data={share.data} />
          </div>
        )}
      </ChartCard>
    </>
  );
}
