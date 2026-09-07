"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  Card,
  DataTable,
  SegmentedControl,
  FilterSelectBar,
  TaBadge,
  DeltaBadge,
} from "@/components/ui";
import type { Column, SelectFilter, SortState } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import type { MetaFilters } from "@/lib/types";
import type { Product, SalesRep, Region, InventoryRow } from "@/lib/types-pages";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { toCsv, downloadCsv, type CsvColumn } from "@/components/reports/csv";

const PAGE_SIZE = 25;
const ALL = "All";

type PresetId = "products" | "reps" | "regions" | "inventory";

const PRESETS: { id: PresetId; label: string; title: string; subtitle: string }[] = [
  { id: "products", label: "Product performance", title: "Product Performance", subtitle: "Revenue, prescriptions, growth and market share by product." },
  { id: "reps", label: "Rep attainment", title: "Rep Attainment", subtitle: "Revenue vs target and achievement % by sales representative." },
  { id: "regions", label: "Regional summary", title: "Regional Summary", subtitle: "Revenue, growth, share and coverage across regions." },
  { id: "inventory", label: "At-risk inventory", title: "At-Risk Inventory", subtitle: "Stock cover and stockout exposure for at-risk product/region cells." },
];

/** Normalise /meta/filters regions to {id,name} — live keys are regionId/regionName. */
function regionOptions(meta: MetaFilters | null): { id: number; name: string }[] {
  return ((meta?.regions ?? []) as unknown as { regionId?: number; regionName?: string; id?: number; name?: string }[])
    .map((r) => ({ id: r.regionId ?? r.id, name: r.regionName ?? r.name }))
    .filter((r): r is { id: number; name: string } => r.id != null && !!r.name);
}

function ExportButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Download size={14} /> Export CSV
    </button>
  );
}

export default function ReportsPage() {
  const [preset, setPreset] = useState<PresetId>("products");
  const active = PRESETS.find((p) => p.id === preset)!;

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Saved, exportable views. Each report exports the current filtered rows as CSV."
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <SegmentedControl
          ariaLabel="Report preset"
          options={PRESETS.map((p) => ({ label: p.label, value: p.id }))}
          value={preset}
          onChange={setPreset}
        />
        <span className="inline-flex items-center gap-1.5 text-[13px] text-text-muted">
          <FileText size={14} /> {active.subtitle}
        </span>
      </div>

      {preset === "products" && <ProductsReport />}
      {preset === "reps" && <RepsReport />}
      {preset === "regions" && <RegionsReport />}
      {preset === "inventory" && <InventoryReport />}
    </>
  );
}

// ── Product performance ─────────────────────────────────────────────────────
function ProductsReport() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "revenue", dir: "desc" });
  const sortParam = `${sort.dir === "desc" ? "-" : ""}${sort.key}`;

  const q = useAsync(
    () => endpoints.products({ page, pageSize: PAGE_SIZE, sort: sortParam }),
    [page, sortParam],
  );
  const rows = q.data?.data ?? [];

  const columns: Column<Product>[] = [
    { key: "drugName", header: "Product", render: (p) => <span className="font-semibold text-text">{p.drugName}</span> },
    { key: "genericName", header: "Generic", render: (p) => <span className="text-text-muted">{p.genericName}</span> },
    { key: "taName", header: "Therapeutic Area", render: (p) => <TaBadge area={p.taName} /> },
    { key: "revenue", header: "Revenue", align: "right", numeric: true, sortKey: "revenue", render: (p) => formatCurrency(p.revenue) },
    { key: "rxVolume", header: "Rx Volume", align: "right", numeric: true, sortKey: "rxVolume", render: (p) => formatNumber(p.rxVolume) },
    { key: "growthPct", header: "Growth", align: "right", sortKey: "growthPct", render: (p) => <DeltaBadge value={p.growthPct} /> },
    { key: "marketSharePct", header: "Mkt Share", align: "right", numeric: true, render: (p) => formatPercent(p.marketSharePct, { signed: false }) },
  ];

  const csvColumns: CsvColumn<Product>[] = [
    { header: "Product", value: (p) => p.drugName },
    { header: "Generic", value: (p) => p.genericName },
    { header: "Therapeutic Area", value: (p) => p.taName },
    { header: "Unit Price (INR)", value: (p) => p.unitPrice },
    { header: "Units Sold", value: (p) => p.unitsSold },
    { header: "Revenue (INR)", value: (p) => p.revenue },
    { header: "Rx Volume", value: (p) => p.rxVolume },
    { header: "Growth %", value: (p) => p.growthPct },
    { header: "Market Share %", value: (p) => p.marketSharePct },
  ];

  return (
    <ReportShell
      title="Product Performance"
      count={rows.length}
      onExport={() => downloadCsv(`product-performance-p${page}`, toCsv(rows, csvColumns))}
      exportDisabled={rows.length === 0}
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(p) => p.drugId}
        loading={q.loading}
        error={q.error}
        onRetry={q.reload}
        sort={sort}
        onSortChange={(next) => { setSort(next); setPage(1); }}
        page={q.data?.meta ?? { page, pageSize: PAGE_SIZE, total: 0, totalPages: 1 }}
        onPageChange={setPage}
        emptyTitle="No products"
      />
    </ReportShell>
  );
}

// ── Rep attainment ──────────────────────────────────────────────────────────
function RepsReport() {
  const meta = useAsync(() => endpoints.metaFilters(), []);
  const regions = regionOptions(meta.data);
  const [regionName, setRegionName] = useState(ALL);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "achievementPct", dir: "desc" });
  const sortParam = `${sort.dir === "desc" ? "-" : ""}${sort.key}`;
  const regionId = regionName === ALL ? undefined : regions.find((r) => r.name === regionName)?.id;

  const q = useAsync(
    () => endpoints.reps({ page, pageSize: PAGE_SIZE, sort: sortParam, regionId }),
    [page, sortParam, regionId],
  );
  const rows = q.data?.data ?? [];

  const filters: SelectFilter[] = [
    { id: "region", label: "Region", value: regionName, options: [ALL, ...regions.map((r) => r.name)] },
  ];

  const columns: Column<SalesRep>[] = [
    { key: "rank", header: "Rank", numeric: true, render: (r) => <span className="tnum font-semibold text-text-muted">#{r.rank}</span> },
    { key: "fullName", header: "Representative", render: (r) => <span className="font-semibold text-text">{r.fullName}</span> },
    { key: "regionName", header: "Region", render: (r) => <span className="text-text-muted">{r.regionName}</span> },
    { key: "territory", header: "Territory", render: (r) => <span className="text-text-muted">{r.territory}</span> },
    { key: "revenue", header: "Revenue", align: "right", numeric: true, sortKey: "revenue", render: (r) => formatCurrency(r.revenue) },
    { key: "target", header: "Target", align: "right", numeric: true, render: (r) => formatCurrency(r.target) },
    { key: "achievementPct", header: "Attainment", align: "right", sortKey: "achievementPct", render: (r) => <AttainmentBar pct={r.achievementPct} /> },
    { key: "visits", header: "Visits", align: "right", numeric: true, render: (r) => formatNumber(r.visits) },
  ];

  const csvColumns: CsvColumn<SalesRep>[] = [
    { header: "Rank", value: (r) => r.rank },
    { header: "Representative", value: (r) => r.fullName },
    { header: "Rep Code", value: (r) => r.repCode },
    { header: "Region", value: (r) => r.regionName },
    { header: "Territory", value: (r) => r.territory },
    { header: "Revenue (INR)", value: (r) => r.revenue },
    { header: "Target (INR)", value: (r) => r.target },
    { header: "Attainment %", value: (r) => r.achievementPct },
    { header: "Visits", value: (r) => r.visits },
    { header: "HCP Count", value: (r) => r.hcpCount },
  ];

  return (
    <div className="space-y-5">
      <Card>
        <FilterSelectBar
          title="Filter:"
          filters={filters}
          onChange={(_id, value) => { setRegionName(value); setPage(1); }}
        />
      </Card>
      <ReportShell
        title="Rep Attainment"
        count={rows.length}
        onExport={() => downloadCsv(`rep-attainment${regionId ? `-${regionName.toLowerCase()}` : ""}-p${page}`, toCsv(rows, csvColumns))}
        exportDisabled={rows.length === 0}
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.repId}
          loading={q.loading}
          error={q.error}
          onRetry={q.reload}
          sort={sort}
          onSortChange={(next) => { setSort(next); setPage(1); }}
          page={q.data?.meta ?? { page, pageSize: PAGE_SIZE, total: 0, totalPages: 1 }}
          onPageChange={setPage}
          emptyTitle="No representatives match this filter"
        />
      </ReportShell>
    </div>
  );
}

function AttainmentBar({ pct }: { pct: number }) {
  const color = pct >= 100 ? "#16A34A" : pct >= 85 ? "#F59E0B" : "#DC2626";
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-bg">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }} />
      </div>
      <span className="tnum text-[13px] font-semibold" style={{ color }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

// ── Regional summary ────────────────────────────────────────────────────────
function RegionsReport() {
  const q = useAsync(() => endpoints.regions(), []);
  const rows = q.data ?? [];

  const columns: Column<Region>[] = [
    { key: "regionName", header: "Region", render: (r) => <span className="font-semibold text-text">{r.regionName}</span> },
    { key: "zoneHead", header: "Zone Head", render: (r) => <span className="text-text-muted">{r.zoneHead}</span> },
    { key: "revenue", header: "Revenue", align: "right", numeric: true, render: (r) => formatCurrency(r.revenue) },
    { key: "growthPct", header: "Growth", align: "right", render: (r) => <DeltaBadge value={r.growthPct} /> },
    { key: "marketSharePct", header: "Mkt Share", align: "right", numeric: true, render: (r) => formatPercent(r.marketSharePct, { signed: false }) },
    { key: "prescriptions", header: "Prescriptions", align: "right", numeric: true, render: (r) => formatNumber(r.prescriptions) },
    { key: "hcpCount", header: "HCPs", align: "right", numeric: true, render: (r) => formatNumber(r.hcpCount) },
    { key: "repCount", header: "Reps", align: "right", numeric: true, render: (r) => formatNumber(r.repCount) },
  ];

  const csvColumns: CsvColumn<Region>[] = [
    { header: "Region", value: (r) => r.regionName },
    { header: "Zone Head", value: (r) => r.zoneHead },
    { header: "Revenue (INR)", value: (r) => r.revenue },
    { header: "Growth %", value: (r) => r.growthPct },
    { header: "Market Share %", value: (r) => r.marketSharePct },
    { header: "Prescriptions", value: (r) => r.prescriptions },
    { header: "HCP Count", value: (r) => r.hcpCount },
    { header: "Rep Count", value: (r) => r.repCount },
  ];

  return (
    <ReportShell
      title="Regional Summary"
      count={rows.length}
      onExport={() => downloadCsv("regional-summary", toCsv(rows, csvColumns))}
      exportDisabled={rows.length === 0}
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.regionId}
        loading={q.loading}
        error={q.error}
        onRetry={q.reload}
        emptyTitle="No regions"
      />
    </ReportShell>
  );
}

// ── At-risk inventory ───────────────────────────────────────────────────────
function InventoryReport() {
  const q = useAsync(() => endpoints.inventoryAtRisk(), []);
  const rows = q.data ?? [];

  const riskColor = (flag: string) =>
    /crit|high|out/i.test(flag) ? "#DC2626" : /med|warn/i.test(flag) ? "#F59E0B" : "#64748B";

  const columns: Column<InventoryRow>[] = [
    { key: "drugName", header: "Product", render: (r) => <span className="font-semibold text-text">{r.drugName}</span> },
    { key: "regionName", header: "Region", render: (r) => <span className="text-text-muted">{r.regionName}</span> },
    { key: "closingStock", header: "Closing Stock", align: "right", numeric: true, render: (r) => formatNumber(r.closingStock) },
    { key: "coverMonths", header: "Cover (mo)", align: "right", numeric: true, render: (r) => <span className="tnum">{r.coverMonths.toFixed(1)}</span> },
    { key: "stockoutDays", header: "Stockout Days", align: "right", numeric: true, render: (r) => (
      <span className="tnum font-semibold" style={{ color: r.stockoutDays > 0 ? "#DC2626" : "#64748B" }}>{r.stockoutDays}</span>
    ) },
    { key: "riskFlag", header: "Risk", align: "center", render: (r) => (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
        style={{ backgroundColor: `${riskColor(r.riskFlag)}1A`, color: riskColor(r.riskFlag) }}>
        {r.riskFlag}
      </span>
    ) },
  ];

  const csvColumns: CsvColumn<InventoryRow>[] = [
    { header: "Product", value: (r) => r.drugName },
    { header: "Region", value: (r) => r.regionName },
    { header: "Snapshot Month", value: (r) => r.snapshotMonth },
    { header: "Closing Stock", value: (r) => r.closingStock },
    { header: "Units Out", value: (r) => r.unitsOut },
    { header: "Cover Months", value: (r) => r.coverMonths },
    { header: "Stockout Days", value: (r) => r.stockoutDays },
    { header: "Risk Flag", value: (r) => r.riskFlag },
  ];

  return (
    <ReportShell
      title="At-Risk Inventory"
      count={rows.length}
      onExport={() => downloadCsv("at-risk-inventory", toCsv(rows, csvColumns))}
      exportDisabled={rows.length === 0}
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => `${r.drugId}-${r.regionId}-${r.snapshotMonth}`}
        loading={q.loading}
        error={q.error}
        onRetry={q.reload}
        emptyTitle="No at-risk inventory"
        emptyMessage="Nothing is flagged at risk right now."
      />
    </ReportShell>
  );
}

// ── Shared preset shell (title + row count + export button) ───────────────────
function ReportShell({
  title,
  count,
  onExport,
  exportDisabled,
  children,
}: {
  title: string;
  count: number;
  onExport: () => void;
  exportDisabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold text-text">
          {title}{" "}
          <span className="tnum text-[13px] font-normal text-text-muted">
            · {count.toLocaleString("en-IN")} row{count === 1 ? "" : "s"} shown
          </span>
        </h2>
        <ExportButton onClick={onExport} disabled={exportDisabled} />
      </div>
      {children}
    </div>
  );
}
