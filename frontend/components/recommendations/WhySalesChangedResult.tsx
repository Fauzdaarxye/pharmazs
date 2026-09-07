"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { RootCauseResult, RootCauseContributor } from "@/lib/types-pages";

/**
 * A single ranked contributor row. The proportional bar is the story: its WIDTH
 * is the contributionPct (share of the headline move), so the factor that caused
 * the change is visibly the longest bar. Direction colours it — a NEGATIVE
 * contributor is red (it dragged revenue down), a POSITIVE one green (it pushed
 * back). This is what lets a reader tell a demand failure (PRESCRIPTION_VOLUME /
 * HCP_ENGAGEMENT lead) from a supply failure (INVENTORY leads) at a glance.
 */
function ContributorRow({ c, rank }: { c: RootCauseContributor; rank: number }) {
  const negative = c.direction === "NEGATIVE";
  const barColor = negative ? "#DC2626" : "#16A34A";
  const width = Math.max(2, Math.min(100, c.contributionPct));

  return (
    <li className="py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="tnum flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg text-[11px] font-bold text-text-muted">
            {rank}
          </span>
          <span className="truncate text-[13px] font-semibold text-text">{c.label}</span>
          <span
            className="inline-flex items-center gap-0.5 text-[12px] font-medium"
            style={{ color: c.changePct < 0 ? "#DC2626" : "#16A34A" }}
          >
            {c.changePct < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
            <span className="tnum">{formatPercent(c.changePct)}</span>
          </span>
        </div>
        <span className="tnum shrink-0 text-[13px] font-bold text-text">
          {c.contributionPct.toFixed(1)}%
        </span>
      </div>

      <div className="h-2.5 w-full overflow-hidden rounded-full bg-bg">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${width}%`, backgroundColor: barColor }}
          aria-hidden
        />
      </div>

      <p className="mt-1 text-[12px] leading-relaxed text-text-muted">{c.detail}</p>
    </li>
  );
}

export function WhySalesChangedResult({ result }: { result: RootCauseResult }) {
  const h = result.headline;
  const isDrop = h.direction === "DROP";
  const headlineColor = isDrop ? "#DC2626" : "#16A34A";

  // Contributors arrive already ranked by the API (descending contributionPct).
  // We render them in that exact order — the ranking IS the analysis, so we must
  // not re-sort or the discriminating story would be lost.
  const contributors = result.contributors;

  return (
    <div className="space-y-5">
      {/* Headline: the size, direction and window of the change */}
      <div className="rounded-lg border border-border bg-bg p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-center gap-2">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ backgroundColor: isDrop ? "#FEE2E2" : "#DCFCE7", color: headlineColor }}
            >
              {isDrop ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
            </span>
            <div>
              <div className="text-[12px] font-medium uppercase tracking-wide text-text-muted">
                Revenue {isDrop ? "declined" : "grew"}
              </div>
              <div className="tnum text-[28px] font-bold leading-none" style={{ color: headlineColor }}>
                {formatPercent(h.changePct)}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[12px] text-text-muted">{h.periodLabel}</div>
            <div className="tnum mt-0.5 text-[13px] text-text">
              <span className="font-semibold text-text">{formatCurrency(h.current)}</span>
              <span className="text-text-muted"> vs {formatCurrency(h.previous)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Ranked contribution breakdown */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-text">What drove the change</h3>
          <span className="text-[12px] text-text-muted">Ranked by contribution to the move</span>
        </div>
        <p className="mb-2 text-[12px] text-text-muted">
          Bars show each factor&apos;s share of the total change; the five sum to ~100%. Red pulled
          revenue {isDrop ? "down" : "off its potential"}, green pushed back.
        </p>
        <ul className="divide-y divide-border">
          {contributors.map((c, i) => (
            <li key={c.factor}>
              <ContributorRow c={c} rank={i + 1} />
            </li>
          ))}
        </ul>
      </div>

      {/* Recommended actions returned alongside the diagnosis */}
      {result.recommendations.length > 0 && (
        <div className="rounded-lg border border-violet/30 bg-violet-bg p-4">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-violet">
            Recommended actions
          </div>
          <ul className="space-y-2">
            {result.recommendations.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] text-text">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet" aria-hidden />
                <div>
                  <span className="font-medium">{r.title}</span>
                  {r.expectedImpact && (
                    <span className="text-text-muted"> — {r.expectedImpact}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
