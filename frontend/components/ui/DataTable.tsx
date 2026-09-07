"use client";

import type { ReactNode } from "react";
import { ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { EmptyState, ErrorState } from "./States";

export interface Column<Row> {
  key: string;
  header: string;
  /** dataKey used for server-side sort (`sort=-<sortKey>`). */
  sortKey?: string;
  align?: "left" | "right" | "center";
  /** true for numeric columns so they get tabular numerals. */
  numeric?: boolean;
  width?: string;
  render: (row: Row) => ReactNode;
}

export interface SortState {
  key: string;
  dir: "asc" | "desc";
}

export interface PageState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  sort,
  onSortChange,
  page,
  onPageChange,
  emptyTitle = "No records found",
  emptyMessage = "Try adjusting your filters.",
  onRowClick,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string | number;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  page?: PageState;
  onPageChange?: (page: number) => void;
  emptyTitle?: string;
  emptyMessage?: string;
  onRowClick?: (row: Row) => void;
}) {
  const handleSort = (col: Column<Row>) => {
    if (!col.sortKey || !onSortChange) return;
    const nextDir: "asc" | "desc" =
      sort?.key === col.sortKey && sort.dir === "desc" ? "asc" : "desc";
    onSortChange({ key: col.sortKey, dir: nextDir });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <div className="max-h-[640px] overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-bg">
            <tr className="border-b border-border">
              {columns.map((col) => {
                const sorted = sort?.key === col.sortKey;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    style={col.width ? { width: col.width } : undefined}
                    className={cn(
                      "whitespace-nowrap px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-text-muted",
                      col.align === "right" && "text-right",
                      col.align === "center" && "text-center",
                      (!col.align || col.align === "left") && "text-left",
                      col.sortKey && "cursor-pointer select-none hover:text-text",
                    )}
                    onClick={() => handleSort(col)}
                    aria-sort={
                      sorted ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"
                    }
                  >
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        col.align === "right" && "flex-row-reverse",
                      )}
                    >
                      {col.header}
                      {col.sortKey && sorted && (
                        <span className="text-primary">
                          {sort!.dir === "asc" ? (
                            <ArrowUp size={12} />
                          ) : (
                            <ArrowDown size={12} />
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows columns={columns} />
            ) : error ? (
              <tr>
                <td colSpan={columns.length}>
                  <ErrorState message={error} onRetry={onRetry} />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState title={emptyTitle} message={emptyMessage} />
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-border last:border-0 transition-colors hover:bg-bg",
                    onRowClick && "cursor-pointer",
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-4 py-3 text-text",
                        col.align === "right" && "text-right",
                        col.align === "center" && "text-center",
                        col.numeric && "tnum",
                      )}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {page && !loading && !error && rows.length > 0 && onPageChange && (
        <Pagination page={page} onPageChange={onPageChange} />
      )}
    </div>
  );
}

function SkeletonRows<Row>({ columns }: { columns: Column<Row>[] }) {
  return (
    <>
      {Array.from({ length: 8 }).map((_, r) => (
        <tr key={r} className="border-b border-border last:border-0">
          {columns.map((col) => (
            <td key={col.key} className="px-4 py-3">
              <div
                className={cn(
                  "h-3.5 animate-pulse rounded bg-[#EEF2F7]",
                  col.align === "right" ? "ml-auto w-12" : "w-24",
                )}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function Pagination({
  page,
  onPageChange,
}: {
  page: PageState;
  onPageChange: (page: number) => void;
}) {
  const from = (page.page - 1) * page.pageSize + 1;
  const to = Math.min(page.page * page.pageSize, page.total);
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3 text-[13px] text-text-muted">
      <span className="tnum">
        Showing {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of{" "}
        {page.total.toLocaleString("en-IN")}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page.page <= 1}
          onClick={() => onPageChange(page.page - 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 font-medium text-text transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={14} /> Prev
        </button>
        <span className="tnum">
          Page {page.page} of {page.totalPages}
        </span>
        <button
          type="button"
          disabled={page.page >= page.totalPages}
          onClick={() => onPageChange(page.page + 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 font-medium text-text transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
