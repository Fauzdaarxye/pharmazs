"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  KpiCardSimple,
  FilterSelectBar,
  DataTable,
  ScoreBadge,
  PriorityBadge,
  DeltaBadge,
  Card,
} from "@/components/ui";
import type { Column, SelectFilter, SortState } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import {
  formatNumber,
  formatCompact,
  formatPercent,
  formatScore,
  formatRelativeDate,
} from "@/lib/format";
import type { Hcp, Priority } from "@/lib/types";

const SPECIALTIES = [
  "All",
  "Cardiologist",
  "Endocrinologist",
  "Oncologist",
  "Pulmonologist",
  "Neurologist",
  "Gastroenterologist",
];
const REGIONS = ["All", "North", "South", "East", "West", "Central"];
const SCORE_BANDS = ["All", "High (80+)", "Medium (50–79)", "Low (<50)"];
const GROWTH_BANDS = ["All", "Growing", "Declining"];
const ENGAGEMENT_BANDS = ["All", "Recently visited", "Overdue"];

const PAGE_SIZE = 25;

/**
 * "All" is a UI-only sentinel for "no filter". It must NEVER reach the API:
 * the backend filters literally, so `?specialty=All` matches zero physicians and
 * the whole directory renders empty with every dropdown still on its default.
 * That is exactly what happened before this guard existed.
 */
const ALL = "All";
const filterValue = (v: string | undefined): string | undefined =>
  !v || v === ALL ? undefined : v;

export default function HcpsPage() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: "score", dir: "desc" });
  const [filters, setFilters] = useState({
    specialty: ALL,
    region: ALL,
    score: ALL,
    growth: ALL,
    engagement: ALL,
  });

  const summary = useAsync(() => endpoints.hcpSummary(), []);
  // Region is selected by NAME in the UI but the API filters by id, so resolve
  // it through /meta/filters rather than hardcoding ids the seed could change.
  const metaFilters = useAsync(() => endpoints.metaFilters(), []);
  const regionId = useMemo(() => {
    const name = filterValue(filters.region);
    if (!name) return undefined;
    return metaFilters.data?.regions?.find((r) => r.regionName === name)?.regionId;
  }, [filters.region, metaFilters.data]);

  const minScore = useMemo(() => {
    if (filters.score === "High (80+)") return 80;
    if (filters.score === "Medium (50–79)") return 50;
    return undefined;
  }, [filters.score]);
  const priority: Priority | undefined = useMemo(() => {
    if (filters.score === "High (80+)") return "HIGH";
    return undefined;
  }, [filters.score]);

  const sortParam = `${sort.dir === "desc" ? "-" : ""}${sort.key}`;

  const directory = useAsync(
    () =>
      endpoints.hcps({
        page,
        pageSize: PAGE_SIZE,
        sort: sortParam,
        specialty: filterValue(filters.specialty),
        regionId,
        minScore,
        priority,
      }),
    [page, sortParam, filters.specialty, regionId, minScore, priority],
  );

  const s = summary.data;

  const selectFilters: SelectFilter[] = [
    { id: "specialty", label: "Specialty", value: filters.specialty, options: SPECIALTIES },
    { id: "region", label: "Region", value: filters.region, options: REGIONS },
    { id: "score", label: "Potential Score", value: filters.score, options: SCORE_BANDS },
    { id: "growth", label: "Prescription Growth", value: filters.growth, options: GROWTH_BANDS },
    { id: "engagement", label: "Engagement", value: filters.engagement, options: ENGAGEMENT_BANDS },
  ];

  const columns: Column<Hcp>[] = [
    { key: "name", header: "HCP Name", sortKey: undefined, render: (h) => (
      <span className="font-semibold text-text">{h.fullName}</span>
    ) },
    { key: "specialty", header: "Specialty", render: (h) => <span className="text-text-muted">{h.specialty}</span> },
    { key: "hospital", header: "Hospital / Institution", render: (h) => (
      <span className="text-text">{h.hospital}</span>
    ) },
    { key: "region", header: "Region", render: (h) => <span className="text-text-muted">{h.regionName}</span> },
    { key: "rxVolume", header: "Rx Volume", align: "right", numeric: true, sortKey: "rxVolume", render: (h) => formatNumber(h.rxVolume) },
    { key: "rxGrowth", header: "Rx Growth", align: "right", sortKey: "rxGrowth", render: (h) => <DeltaBadge value={h.rxGrowthPct} /> },
    { key: "visits", header: "Visits", align: "right", numeric: true, sortKey: "visits", render: (h) => formatNumber(h.visits) },
    { key: "lastVisit", header: "Last Visit", align: "right", render: (h) => (
      <span className="text-text-muted">{formatRelativeDate(h.lastVisitDate)}</span>
    ) },
    { key: "score", header: "Score", align: "center", sortKey: "score", render: (h) => <ScoreBadge score={h.potentialScore} /> },
    { key: "priority", header: "Priority", align: "center", render: (h) => <PriorityBadge priority={h.priority} /> },
  ];

  return (
    <>
      <PageHeader
        title="Healthcare Professional (HCP) Intelligence"
        subtitle="Identify and prioritize high-value commercial opportunities."
      />

      {/* 1. Five simple KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-5">
        {summary.loading || !s ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <div className="h-3 w-24 animate-pulse rounded bg-[#EEF2F7]" />
              <div className="mt-3 h-7 w-20 animate-pulse rounded bg-[#EEF2F7]" />
              <div className="mt-3 h-3 w-16 animate-pulse rounded bg-[#EEF2F7]" />
            </Card>
          ))
        ) : (
          <>
            <KpiCardSimple label="Total HCPs Tracked" value={formatNumber(s.totalHcps)} subNote="+4.2% Growth" subNoteTone="success" />
            <KpiCardSimple label="High-Potential HCPs" value={formatNumber(s.highPotentialHcps)} subNote={`${formatPercent(s.highPotentialSharePct, { signed: false })} of active base`} />
            <KpiCardSimple label="Avg. Rx Volume / HCP" value={formatCompact(s.avgRxVolumePerHcp)} subNote="Monthly average" />
            <KpiCardSimple label="HCP Engagement Rate" value={formatPercent(s.engagementRatePct, { signed: false })} subNote="+2.1% improvement" subNoteTone="success" />
            <KpiCardSimple label="Average Potential Score" value={formatScore(s.avgPotentialScore)} subNote="Weighted scoring" />
          </>
        )}
      </div>

      {/* 2. Segment Filters bar */}
      <div className="mb-6">
        <Card>
          <FilterSelectBar
            title="Segment Filters:"
            filters={selectFilters}
            onChange={(id, value) => {
              setFilters((f) => ({ ...f, [id]: value }));
              setPage(1);
            }}
          />
        </Card>
      </div>

      {/* 3. HCP Performance Directory */}
      <div className="mb-3">
        <h2 className="text-[16px] font-semibold text-text">HCP Performance Directory</h2>
        <p className="text-[13px] text-text-muted">
          Server-side ranked by potential score. Sort any column to re-rank.
        </p>
      </div>
      <DataTable
        columns={columns}
        rows={directory.data?.data ?? []}
        rowKey={(h) => h.hcpId}
        loading={directory.loading}
        error={directory.error}
        onRetry={directory.reload}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        page={
          directory.data?.meta
            ? { ...directory.data.meta }
            : { page, pageSize: PAGE_SIZE, total: 0, totalPages: 1 }
        }
        onPageChange={setPage}
        emptyTitle="No HCPs match these filters"
        emptyMessage="Loosen the segment filters to widen the panel."
      />
    </>
  );
}
