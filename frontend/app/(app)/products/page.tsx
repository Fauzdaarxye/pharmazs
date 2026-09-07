"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  Card,
  KpiCardSimple,
  FilterSelectBar,
  DataTable,
  DeltaBadge,
  TaBadge,
} from "@/components/ui";
import type { Column, SelectFilter, SortState } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import type { Product } from "@/lib/types-pages";

const PAGE_SIZE = 25;

// "All" is a UI-only sentinel — it must become undefined before it reaches the
// API, which filters literally (a literal "All" matches zero rows).
const ALL = "All";
const clear = (v: string): string | undefined => (v === ALL ? undefined : v);

// /meta/filters returns {taId,taName}/{regionId,regionName} at runtime (verified
// against the live API); the shared FilterOption type is a narrower {id,name}.
// Read through these local shapes so the lookups resolve at runtime.

export default function ProductsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "revenue", dir: "desc" });
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState({ ta: ALL, region: ALL });

  // Region/TA are chosen by NAME in the UI but the API filters by id; resolve
  // through /meta/filters rather than hardcoding ids the seed could change.
  const meta = useAsync(() => endpoints.metaFilters(), []);
  // Memoised: `?? []` builds a NEW array every render, which invalidates every
  // useMemo that depends on it and defeats the memoisation entirely.
  const taList = useMemo(() => meta.data?.therapeuticAreas ?? [], [meta.data]);
  const regionList = useMemo(() => meta.data?.regions ?? [], [meta.data]);
  const taOptions = useMemo(
    () => [ALL, ...taList.map((t) => t.taName)],
    [taList],
  );
  const regionOptions = useMemo(
    () => [ALL, ...regionList.map((r) => r.regionName)],
    [regionList],
  );
  const taId = useMemo(() => {
    const name = clear(filters.ta);
    return name ? taList.find((t) => t.taName === name)?.taId : undefined;
  }, [filters.ta, taList]);
  const regionId = useMemo(() => {
    const name = clear(filters.region);
    return name ? regionList.find((r) => r.regionName === name)?.regionId : undefined;
  }, [filters.region, regionList]);

  const sortParam = `${sort.dir === "desc" ? "-" : ""}${sort.key}`;

  const products = useAsync(
    () =>
      endpoints.products({
        page,
        pageSize: PAGE_SIZE,
        sort: sortParam,
        q: q.trim() || undefined,
        taId,
        regionId,
      }),
    [page, sortParam, q, taId, regionId],
  );

  const rows = useMemo(() => products.data?.data ?? [], [products.data]);
  const pageMeta = products.data?.meta;

  // KPIs derived from the list + meta (portfolio revenue and best grower reflect
  // the current filtered/sorted page; total count comes from meta.total).
  const kpis = useMemo(() => {
    if (rows.length === 0) return null;
    const revenue = rows.reduce((s, p) => s + p.revenue, 0);
    const bestGrower = rows.reduce((a, b) => (b.growthPct > a.growthPct ? b : a));
    const avgShare = rows.reduce((s, p) => s + p.marketSharePct, 0) / rows.length;
    return { revenue, bestGrower, avgShare };
  }, [rows]);

  const selectFilters: SelectFilter[] = [
    { id: "ta", label: "Therapeutic Area", value: filters.ta, options: taOptions },
    { id: "region", label: "Region", value: filters.region, options: regionOptions },
  ];

  const columns: Column<Product>[] = [
    {
      key: "product",
      header: "Product",
      sortKey: "drugName",
      render: (p) => (
        <div>
          <div className="font-semibold text-text">{p.drugName}</div>
          <div className="text-[12px] text-text-muted">{p.strength} · {p.dosageForm}</div>
        </div>
      ),
    },
    { key: "generic", header: "Generic", render: (p) => <span className="text-text-muted">{p.genericName}</span> },
    { key: "ta", header: "Therapeutic Area", render: (p) => <TaBadge area={p.taName} /> },
    { key: "price", header: "Price", align: "right", numeric: true, sortKey: "unitPrice", render: (p) => formatCurrency(p.unitPrice) },
    { key: "units", header: "Units Sold", align: "right", numeric: true, sortKey: "unitsSold", render: (p) => formatNumber(p.unitsSold) },
    { key: "revenue", header: "Revenue", align: "right", numeric: true, sortKey: "revenue", render: (p) => <span className="font-semibold text-text">{formatCurrency(p.revenue)}</span> },
    { key: "rx", header: "Rx Volume", align: "right", numeric: true, sortKey: "rxVolume", render: (p) => formatNumber(p.rxVolume) },
    { key: "growth", header: "Growth", align: "right", sortKey: "growthPct", render: (p) => <DeltaBadge value={p.growthPct} /> },
    { key: "share", header: "Mkt Share", align: "right", numeric: true, sortKey: "marketSharePct", render: (p) => formatPercent(p.marketSharePct, { signed: false }) },
  ];

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Portfolio performance by drug, brand, therapeutic area, price and market share."
      />

      {/* KPI row */}
      <div className="mb-6 grid grid-cols-2 gap-5 md:grid-cols-4">
        {products.loading || !kpis ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <div className="h-3 w-24 animate-pulse rounded bg-[#EEF2F7]" />
              <div className="mt-3 h-7 w-20 animate-pulse rounded bg-[#EEF2F7]" />
              <div className="mt-3 h-3 w-16 animate-pulse rounded bg-[#EEF2F7]" />
            </Card>
          ))
        ) : (
          <>
            <KpiCardSimple
              label="Total Products"
              value={formatNumber(pageMeta?.total ?? rows.length)}
              subNote="Across the portfolio"
            />
            <KpiCardSimple
              label="Portfolio Revenue"
              value={formatCurrency(kpis.revenue)}
              subNote="This page, current filters"
            />
            <KpiCardSimple
              label="Best Grower"
              value={kpis.bestGrower.drugName}
              subNote={`${formatPercent(kpis.bestGrower.growthPct)} growth`}
              subNoteTone="success"
            />
            <KpiCardSimple
              label="Avg. Market Share"
              value={formatPercent(kpis.avgShare, { signed: false })}
              subNote="Mean across this page"
            />
          </>
        )}
      </div>

      {/* Filter bar: TA + Region + text search */}
      <div className="mb-6">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <FilterSelectBar
              title="Filters:"
              filters={selectFilters}
              onChange={(id, value) => {
                setFilters((f) => ({ ...f, [id]: value }));
                setPage(1);
              }}
            />
            <div className="ml-auto">
              <input
                type="search"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="Search products…"
                aria-label="Search products"
                className="w-56 rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] text-text outline-none placeholder:text-text-muted focus:border-primary"
              />
            </div>
          </div>
        </Card>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(p) => p.drugId}
        loading={products.loading}
        error={products.error}
        onRetry={products.reload}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        page={pageMeta ?? { page, pageSize: PAGE_SIZE, total: 0, totalPages: 1 }}
        onPageChange={setPage}
        onRowClick={(p) => router.push(`/products/${p.drugId}`)}
        emptyTitle="No products match these filters"
        emptyMessage="Loosen the therapeutic-area, region or search filters."
      />
    </>
  );
}
