"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  DataTable,
} from "@/components/ui";
import type { Column, SortState } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { SalesRep } from "@/lib/types-pages";
import { AchievementBar } from "@/components/reps/AchievementBar";
import { RepKpiRow } from "@/components/reps/RepKpiRow";

const PAGE_SIZE = 25;

export default function SalesRepsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  // Default sort mirrors the leaderboard ranking (highest revenue first).
  const [sort, setSort] = useState<SortState>({ key: "revenue", dir: "desc" });

  const sortParam = `${sort.dir === "desc" ? "-" : ""}${sort.key}`;

  const reps = useAsync(
    () => endpoints.reps({ page, pageSize: PAGE_SIZE, sort: sortParam }),
    [page, sortParam],
  );

  const rows = reps.data?.data ?? [];
  const meta = reps.data?.meta;

  const columns: Column<SalesRep>[] = [
    {
      key: "rank",
      header: "Rank",
      align: "left",
      numeric: true,
      sortKey: "rank",
      render: (r) => <span className="font-semibold text-text-muted">#{r.rank}</span>,
    },
    {
      key: "rep",
      header: "Rep",
      render: (r) => (
        <div className="flex flex-col">
          <span className="font-semibold text-text">{r.fullName}</span>
          <span className="text-[12px] text-text-muted">{r.repCode}</span>
        </div>
      ),
    },
    { key: "region", header: "Region", render: (r) => <span className="text-text-muted">{r.regionName}</span> },
    { key: "territory", header: "Territory", render: (r) => <span className="text-text-muted">{r.territory}</span> },
    {
      key: "revenue",
      header: "Revenue",
      align: "right",
      numeric: true,
      sortKey: "revenue",
      render: (r) => <span className="font-semibold text-text">{formatCurrency(r.revenue)}</span>,
    },
    {
      key: "target",
      header: "Target",
      align: "right",
      numeric: true,
      sortKey: "target",
      render: (r) => <span className="text-text-muted">{formatCurrency(r.target)}</span>,
    },
    {
      key: "achievement",
      header: "Achievement",
      align: "right",
      sortKey: "achievementPct",
      render: (r) => <AchievementBar pct={r.achievementPct} />,
    },
    {
      key: "visits",
      header: "Visits",
      align: "right",
      numeric: true,
      sortKey: "visits",
      render: (r) => formatNumber(r.visits),
    },
    {
      key: "hcpCount",
      header: "HCP Count",
      align: "right",
      numeric: true,
      sortKey: "hcpCount",
      render: (r) => formatNumber(r.hcpCount),
    },
  ];

  return (
    <>
      <PageHeader
        title="Sales Representatives"
        subtitle="Field-force leaderboard ranked by commercial attainment (SRS §14)."
      />

      {/* KPI row — team totals for the reps shown on this page */}
      <div className="mb-6">
        <RepKpiRow reps={rows} loading={reps.loading} totalReps={meta?.total ?? rows.length} />
      </div>

      <div className="mb-3">
        <h2 className="text-[16px] font-semibold text-text">Leaderboard</h2>
        <p className="text-[13px] text-text-muted">
          Server-side ranked and paginated. Sort any column to re-rank; select a rep to
          open their panel.
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.repId}
        loading={reps.loading}
        error={reps.error}
        onRetry={reps.reload}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        page={
          meta ?? { page, pageSize: PAGE_SIZE, total: 0, totalPages: 1 }
        }
        onPageChange={setPage}
        onRowClick={(r) => router.push(`/sales-reps/${r.repId}`)}
        emptyTitle="No sales representatives found"
        emptyMessage="There are no reps for the current view."
      />
    </>
  );
}
