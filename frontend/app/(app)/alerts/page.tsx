"use client";

import { useState } from "react";
import { AlertTriangle, TrendingDown, TrendingUp, Bell, Circle, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  Card,
  SegmentedControl,
  FilterSelectBar,
  DataTable,
  CenteredSpinner,
  ErrorState,
  EmptyState,
} from "@/components/ui";
import type { Column, SelectFilter, SortState } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { formatNumber, formatPercent, formatRelativeDate, formatPeriod } from "@/lib/format";
import type { AlertItem, AnomalyItem, Severity } from "@/lib/types-pages";

const PAGE_SIZE = 20;

const ALL = "All";
const asSeverity = (v: string): Severity | undefined =>
  v === ALL ? undefined : (v as Severity);

// §7 severity colour coding.
const SEVERITY_STYLE: Record<Severity, { bg: string; fg: string; dot: string }> = {
  CRITICAL: { bg: "#FEE2E2", fg: "#B91C1C", dot: "#DC2626" },
  HIGH: { bg: "#FEF3C7", fg: "#B45309", dot: "#F59E0B" },
  MEDIUM: { bg: "#DBEAFE", fg: "#1D4ED8", dot: "#2563EB" },
  LOW: { bg: "#F1F5F9", fg: "#64748B", dot: "#94A3B8" },
};

function SeverityPill({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.LOW;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.dot }} aria-hidden />
      {severity}
    </span>
  );
}

// ── Alerts tab ────────────────────────────────────────────────────────────
function AlertsTab() {
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState(ALL);
  const [readState, setReadState] = useState(ALL);

  const isRead =
    readState === "Read" ? true : readState === "Unread" ? false : undefined;

  const alerts = useAsync(
    () =>
      endpoints.alertList({
        page,
        pageSize: PAGE_SIZE,
        severity: asSeverity(severity),
        isRead,
      }),
    [page, severity, readState],
  );

  const selectFilters: SelectFilter[] = [
    { id: "severity", label: "Severity", value: severity, options: [ALL, "CRITICAL", "HIGH", "MEDIUM", "LOW"] },
    { id: "read", label: "Status", value: readState, options: [ALL, "Unread", "Read"] },
  ];

  const rows = alerts.data?.data ?? [];

  return (
    <div className="space-y-5">
      <Card>
        <FilterSelectBar
          title="Filter alerts:"
          filters={selectFilters}
          onChange={(id, value) => {
            if (id === "severity") setSeverity(value);
            else setReadState(value);
            setPage(1);
          }}
        />
      </Card>

      {alerts.loading ? (
        <Card><CenteredSpinner /></Card>
      ) : alerts.error ? (
        <Card><ErrorState message={alerts.error} onRetry={alerts.reload} /></Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No alerts match these filters"
            message="Loosen the severity or status filter to see more."
            icon={<Bell size={20} />}
          />
        </Card>
      ) : (
        <>
          <ul className="space-y-3">
            {rows.map((a) => (
              <AlertRow key={a.alertId} alert={a} />
            ))}
          </ul>
          {alerts.data?.meta && (
            <Pager
              page={alerts.data.meta.page}
              totalPages={alerts.data.meta.totalPages}
              total={alerts.data.meta.total}
              pageSize={alerts.data.meta.pageSize}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}

function AlertRow({ alert }: { alert: AlertItem }) {
  const s = SEVERITY_STYLE[alert.severity] ?? SEVERITY_STYLE.LOW;
  return (
    <li>
      <Card className={alert.isRead ? "opacity-80" : ""}>
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: s.bg, color: s.fg }}
          >
            <AlertTriangle size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityPill severity={alert.severity} />
              <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] font-medium text-text-muted">
                {alert.alertType.replace(/_/g, " ")}
              </span>
              {!alert.isRead && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                  <Circle size={7} className="fill-current" /> Unread
                </span>
              )}
              {alert.isRead && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-text-muted">
                  <CheckCircle2 size={12} /> Read
                </span>
              )}
            </div>
            <h3 className="mt-1.5 text-[14px] font-semibold text-text">{alert.title}</h3>
            <p className="mt-0.5 text-[13px] leading-relaxed text-text-muted">{alert.message}</p>
            <div className="mt-1.5 flex items-center gap-3 text-[12px] text-text-muted">
              {alert.entityType && (
                <span className="tnum">
                  {alert.entityType}
                  {alert.entityId != null ? ` #${alert.entityId}` : ""}
                </span>
              )}
              <span>{formatRelativeDate(alert.createdAt)}</span>
            </div>
          </div>
        </div>
      </Card>
    </li>
  );
}

// ── Anomalies tab ───────────────────────────────────────────────────────────
function AnomaliesTab() {
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState(ALL);
  const [direction, setDirection] = useState(ALL);
  const [sort, setSort] = useState<SortState>({ key: "zScore", dir: "desc" });

  const dir = direction === ALL ? undefined : (direction as "DROP" | "SPIKE");

  const anomalies = useAsync(
    () =>
      endpoints.anomalies({
        page,
        pageSize: PAGE_SIZE,
        severity: asSeverity(severity),
        direction: dir,
      }),
    [page, severity, direction],
  );

  const selectFilters: SelectFilter[] = [
    { id: "severity", label: "Severity", value: severity, options: [ALL, "CRITICAL", "HIGH", "MEDIUM", "LOW"] },
    { id: "direction", label: "Direction", value: direction, options: [ALL, "SPIKE", "DROP"] },
  ];

  const columns: Column<AnomalyItem>[] = [
    {
      key: "direction",
      header: "Signal",
      render: (a) => <DirectionBadge direction={a.direction} />,
    },
    { key: "entity", header: "Entity", render: (a) => (
      <span className="font-semibold text-text">{a.entityName ?? `${a.entityType} #${a.entityId ?? "—"}`}</span>
    ) },
    { key: "metric", header: "Metric", render: (a) => (
      <span className="text-text-muted">{a.metric}</span>
    ) },
    { key: "period", header: "Period", render: (a) => (
      <span className="text-text-muted">{formatPeriod(a.periodMonth)}</span>
    ) },
    { key: "actual", header: "Actual", align: "right", numeric: true, render: (a) => formatNumber(a.actual) },
    { key: "expected", header: "Expected", align: "right", numeric: true, render: (a) => formatNumber(a.expected) },
    {
      key: "deviation",
      header: "Deviation",
      align: "right",
      sortKey: "deviationPct",
      render: (a) => (
        <span
          className="tnum font-semibold"
          style={{ color: a.direction === "SPIKE" ? "#16A34A" : "#DC2626" }}
        >
          {formatPercent(a.deviationPct)}
        </span>
      ),
    },
    { key: "zScore", header: "Z-score", align: "right", numeric: true, sortKey: "zScore", render: (a) => (
      <span className="tnum">{a.zScore.toFixed(2)}</span>
    ) },
    { key: "severity", header: "Severity", align: "center", render: (a) => <SeverityPill severity={a.severity} /> },
  ];

  return (
    <div className="space-y-5">
      <Card>
        <FilterSelectBar
          title="Filter anomalies:"
          filters={selectFilters}
          onChange={(id, value) => {
            if (id === "severity") setSeverity(value);
            else setDirection(value);
            setPage(1);
          }}
        />
      </Card>

      <p className="text-[13px] text-text-muted">
        Statistical outliers vs the seasonally-adjusted expectation.{" "}
        <span className="font-medium text-success">Spikes</span> are upside opportunities;{" "}
        <span className="font-medium text-danger">drops</span> are risks — both are worth attention.
      </p>

      <DataTable
        columns={columns}
        rows={anomalies.data?.data ?? []}
        rowKey={(a) => a.anomalyId}
        loading={anomalies.loading}
        error={anomalies.error}
        onRetry={anomalies.reload}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        page={
          anomalies.data?.meta ?? { page, pageSize: PAGE_SIZE, total: 0, totalPages: 1 }
        }
        onPageChange={setPage}
        emptyTitle="No anomalies match these filters"
        emptyMessage="Try a different severity or direction."
      />
    </div>
  );
}

function DirectionBadge({ direction }: { direction: "DROP" | "SPIKE" }) {
  const spike = direction === "SPIKE";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{
        backgroundColor: spike ? "#DCFCE7" : "#FEE2E2",
        color: spike ? "#16A34A" : "#DC2626",
      }}
    >
      {spike ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {spike ? "Spike" : "Drop"}
    </span>
  );
}

// Shared pager for the card-list Alerts tab (the DataTable has its own).
function Pager({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between px-1 text-[13px] text-text-muted">
      <span className="tnum">
        Showing {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of{" "}
        {total.toLocaleString("en-IN")}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-lg border border-border px-2.5 py-1 font-medium text-text transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
        >
          Prev
        </button>
        <span className="tnum">Page {page} of {totalPages}</span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded-lg border border-border px-2.5 py-1 font-medium text-text transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const [tab, setTab] = useState<"alerts" | "anomalies">("alerts");
  return (
    <>
      <PageHeader
        title="Alerts & Anomalies"
        subtitle="Business alerts and statistical outliers — risks to act on and upside to chase."
      />
      <div className="mb-6">
        <SegmentedControl
          ariaLabel="View"
          options={[
            { label: "Business Alerts", value: "alerts" },
            { label: "Anomalies", value: "anomalies" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === "alerts" ? <AlertsTab /> : <AnomaliesTab />}
    </>
  );
}
