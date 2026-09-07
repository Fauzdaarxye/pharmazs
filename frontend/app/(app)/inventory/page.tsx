"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  Card,
  CardHeader,
  FilterSelectBar,
  DataTable,
  AiAlertBanner,
  CenteredSpinner,
  ErrorState,
  EmptyState,
} from "@/components/ui";
import type { Column, SelectFilter, SortState } from "@/components/ui";
import { RiskBadge, StockoutDays } from "@/components/inventory/RiskBadge";
import { endpoints } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { formatNumber, formatPeriod } from "@/lib/format";
import type { InventoryRow } from "@/lib/types-pages";

const PAGE_SIZE = 25;

const ALL = "All";
const clear = (v: string): string | undefined => (v === ALL ? undefined : v);

// The API's /meta/filters returns {regionId,regionName}/{drugId,drugName} at
// runtime (verified against the live API); the shared FilterOption type is a
// narrower {id,name}. Read through this local shape so lookups work at runtime.

export default function InventoryPage() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "stockoutDays", dir: "desc" });
  const [filters, setFilters] = useState({ region: ALL, drug: ALL });

  const meta = useAsync(() => endpoints.metaFilters(), []);
  const regionList = useMemo(() => meta.data?.regions ?? [], [meta.data]);
  const productList = useMemo(() => meta.data?.products ?? [], [meta.data]);

  const regionOptions = useMemo(
    () => [ALL, ...regionList.map((r) => r.regionName)],
    [regionList],
  );
  const drugOptions = useMemo(
    () => [ALL, ...productList.map((p) => p.drugName)],
    [productList],
  );
  const regionId = useMemo(() => {
    const name = clear(filters.region);
    return name ? regionList.find((r) => r.regionName === name)?.regionId : undefined;
  }, [filters.region, regionList]);
  const drugId = useMemo(() => {
    const name = clear(filters.drug);
    return name ? productList.find((p) => p.drugName === name)?.drugId : undefined;
  }, [filters.drug, productList]);

  const sortParam = `${sort.dir === "desc" ? "-" : ""}${sort.key}`;

  const inventory = useAsync(
    () => endpoints.inventory({ page, pageSize: PAGE_SIZE, sort: sortParam, regionId, drugId }),
    [page, sortParam, regionId, drugId],
  );
  const atRisk = useAsync(() => endpoints.inventoryAtRisk(), []);

  const rows = inventory.data?.data ?? [];
  const pageMeta = inventory.data?.meta;

  // The worst at-risk item drives the supply-failure callout.
  const worst = atRisk.data?.[0] ?? null;
  const stockoutCount = atRisk.data?.filter((r) => r.stockoutDays > 0).length ?? 0;

  const selectFilters: SelectFilter[] = [
    { id: "region", label: "Region", value: filters.region, options: regionOptions },
    { id: "drug", label: "Product", value: filters.drug, options: drugOptions },
  ];

  const columns: Column<InventoryRow>[] = [
    { key: "drug", header: "Drug", sortKey: "drugName", render: (r) => <span className="font-semibold text-text">{r.drugName}</span> },
    { key: "region", header: "Region", render: (r) => <span className="text-text-muted">{r.regionName}</span> },
    { key: "month", header: "Month", render: (r) => <span className="text-text-muted">{formatPeriod(r.snapshotMonth)}</span> },
    { key: "stock", header: "Closing Stock", align: "right", numeric: true, sortKey: "closingStock", render: (r) => formatNumber(r.closingStock) },
    { key: "out", header: "Units Out", align: "right", numeric: true, sortKey: "unitsOut", render: (r) => formatNumber(r.unitsOut) },
    { key: "cover", header: "Cover (months)", align: "right", numeric: true, sortKey: "coverMonths", render: (r) => r.coverMonths.toFixed(1) },
    { key: "stockout", header: "Stockout Days", align: "right", sortKey: "stockoutDays", render: (r) => <StockoutDays days={r.stockoutDays} /> },
    { key: "risk", header: "Risk", align: "center", render: (r) => <RiskBadge flag={r.riskFlag} /> },
  ];

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Stock cover, units out and stockout risk by product and region."
      />

      {/* Supply-failure callout — this page confirms stockouts, not falling demand. */}
      {worst && worst.stockoutDays > 0 && (
        <div className="mb-6">
          <AiAlertBanner title="Supply risk">
            <span className="font-semibold">{worst.drugName} in {worst.regionName}</span> hit{" "}
            <span className="font-semibold">{worst.stockoutDays} stockout days</span> with only{" "}
            <span className="font-semibold">{worst.coverMonths.toFixed(1)} months</span> of cover
            ({worst.riskFlag} risk) — a supply failure, not a demand drop. {stockoutCount} at-risk
            line{stockoutCount === 1 ? "" : "s"} currently show stockout days above zero.
          </AiAlertBanner>
        </div>
      )}

      {/* At-risk panel, worst first */}
      <div className="mb-6">
        <Card>
          <CardHeader
            title="At-Risk Inventory"
            subtitle="Highest-risk product/region lines, worst first."
          />
          {atRisk.loading ? (
            <CenteredSpinner />
          ) : atRisk.error ? (
            <ErrorState message={atRisk.error} onRetry={atRisk.reload} />
          ) : (atRisk.data?.length ?? 0) === 0 ? (
            <EmptyState
              title="Nothing at risk"
              message="No product/region line is currently flagged."
              icon={<AlertTriangle size={20} />}
            />
          ) : (
            <ul className="divide-y divide-border">
              {atRisk.data!.slice(0, 8).map((r) => (
                <li
                  key={`${r.drugId}-${r.regionId}-${r.snapshotMonth}`}
                  className="flex items-center justify-between gap-4 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium text-text">
                      {r.drugName} <span className="text-text-muted">· {r.regionName}</span>
                    </div>
                    <div className="tnum text-[12px] text-text-muted">
                      {r.coverMonths.toFixed(1)} mo cover · {formatNumber(r.closingStock)} in stock ·{" "}
                      {formatPeriod(r.snapshotMonth)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <StockoutDays days={r.stockoutDays} />
                    <RiskBadge flag={r.riskFlag} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Filter bar */}
      <div className="mb-6">
        <Card>
          <FilterSelectBar
            title="Filters:"
            filters={selectFilters}
            onChange={(id, value) => {
              setFilters((f) => ({ ...f, [id]: value }));
              setPage(1);
            }}
          />
        </Card>
      </div>

      {/* Paginated inventory table */}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => `${r.drugId}-${r.regionId}-${r.snapshotMonth}`}
        loading={inventory.loading}
        error={inventory.error}
        onRetry={inventory.reload}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        page={pageMeta ?? { page, pageSize: PAGE_SIZE, total: 0, totalPages: 1 }}
        onPageChange={setPage}
        emptyTitle="No inventory rows match these filters"
        emptyMessage="Loosen the region or product filter."
      />
    </>
  );
}
