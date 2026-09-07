"use client";

import { useState } from "react";
import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  KpiCardSimple,
  Card,
  DataTable,
  ScoreBadge,
  PriorityBadge,
  CenteredSpinner,
  ErrorState,
} from "@/components/ui";
import type { Column } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { formatCurrency, formatNumber, formatPercent, formatRelativeDate } from "@/lib/format";
import type { RepPanelHcp } from "@/lib/types-pages";
import type { Priority } from "@/lib/types";
import { AchievementBar } from "@/components/reps/AchievementBar";
import { RecommendedHcpsPanel } from "@/components/reps/RecommendedHcpsPanel";

const PANEL_PAGE_SIZE = 25;

export default function RepDetailPage({
  params,
}: {
  params: Promise<{ repId: string }>;
}) {
  const { repId: repIdRaw } = use(params);
  const repId = Number(repIdRaw);

  const [panelPage, setPanelPage] = useState(1);

  const rep = useAsync(() => endpoints.rep(repId), [repId]);
  const panel = useAsync(
    () => endpoints.repHcps(repId, { page: panelPage, pageSize: PANEL_PAGE_SIZE }),
    [repId, panelPage],
  );
  const recommended = useAsync(() => endpoints.repRecommendedHcps(repId, 8), [repId]);

  const r = rep.data;

  const panelColumns: Column<RepPanelHcp>[] = [
    {
      key: "name",
      header: "HCP Name",
      render: (h) => <span className="font-semibold text-text">{h.fullName}</span>,
    },
    { key: "specialty", header: "Specialty", render: (h) => <span className="text-text-muted">{h.specialty}</span> },
    { key: "hospital", header: "Hospital", render: (h) => <span className="text-text">{h.hospital}</span> },
    { key: "region", header: "Region", render: (h) => <span className="text-text-muted">{h.regionName}</span> },
    {
      key: "score",
      header: "Potential",
      align: "center",
      render: (h) =>
        h.potentialScore != null ? (
          <ScoreBadge score={h.potentialScore} />
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    {
      key: "priority",
      header: "Priority",
      align: "center",
      render: (h) =>
        h.priority ? (
          <PriorityBadge priority={h.priority as Priority} />
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    {
      key: "lastVisit",
      header: "Last Visit",
      align: "right",
      render: (h) => (
        <span className="text-text-muted">{formatRelativeDate(h.lastVisitDate)}</span>
      ),
    },
  ];

  return (
    <>
      <div className="mb-2">
        <Link
          href="/sales-reps"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:text-primary-hover"
        >
          <ArrowLeft size={14} /> Back to leaderboard
        </Link>
      </div>

      <PageHeader
        title={r ? r.fullName : rep.loading ? "Loading rep…" : "Sales Representative"}
        subtitle={
          r
            ? `${r.repCode} · ${r.territory} · ${r.regionName} region · Rank #${r.rank}`
            : "Rep panel and prioritised opportunities (SRS §14, §27)."
        }
      />

      {/* Rep KPIs */}
      {rep.loading ? (
        <div className="mb-6">
          <Card><CenteredSpinner /></Card>
        </div>
      ) : rep.error || !r ? (
        <div className="mb-6">
          <Card>
            <ErrorState message={rep.error ?? "This rep could not be loaded."} onRetry={rep.reload} />
          </Card>
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-5">
          <KpiCardSimple label="Revenue" value={formatCurrency(r.revenue)} subNote={`Target ${formatCurrency(r.target)}`} />
          <Card className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-text-muted">Attainment</span>
            <span className="tnum text-[30px] font-bold leading-none text-text">
              {formatPercent(r.achievementPct, { signed: false })}
            </span>
            <AchievementBar pct={r.achievementPct} />
          </Card>
          <KpiCardSimple label="Visits" value={formatNumber(r.visits)} subNote="Field visits" />
          <KpiCardSimple label="HCP Panel" value={formatNumber(r.hcpCount)} subNote="Assigned HCPs" />
          <KpiCardSimple label="Leaderboard Rank" value={`#${r.rank}`} subNote="By revenue" />
        </div>
      )}

      {/* THE payoff: Recommended HCPs — visual focus of the page */}
      <div className="mb-6">
        <RecommendedHcpsPanel
          items={recommended.data ?? []}
          loading={recommended.loading}
          error={recommended.error}
          onRetry={recommended.reload}
        />
      </div>

      {/* HCP panel table */}
      <div className="mb-3">
        <h2 className="text-[16px] font-semibold text-text">Assigned HCP Panel</h2>
        <p className="text-[13px] text-text-muted">
          The physicians in this rep&apos;s territory. Server-side paginated.
        </p>
      </div>
      <DataTable
        columns={panelColumns}
        rows={panel.data?.data ?? []}
        rowKey={(h) => h.hcpId}
        loading={panel.loading}
        error={panel.error}
        onRetry={panel.reload}
        page={panel.data?.meta ?? { page: panelPage, pageSize: PANEL_PAGE_SIZE, total: 0, totalPages: 1 }}
        onPageChange={setPanelPage}
        emptyTitle="No HCPs in this panel"
        emptyMessage="This rep has no assigned physicians yet."
      />
    </>
  );
}
