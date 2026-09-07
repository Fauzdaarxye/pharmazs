import { KpiCardSimple, Card } from "@/components/ui";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/format";
import type { SalesRep } from "@/lib/types-pages";

/**
 * The KPI row above the leaderboard. These are team totals for the CURRENT page
 * of reps (the leaderboard is server-paginated), so the sub-notes say so — a
 * headline that implied it summed all 70 reps while the table showed 25 would be
 * the reconciliation bug the contract warns about.
 */
export function RepKpiRow({
  reps,
  loading,
  totalReps,
}: {
  reps: SalesRep[];
  loading: boolean;
  totalReps: number;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <div className="h-3 w-24 animate-pulse rounded bg-[#EEF2F7]" />
            <div className="mt-3 h-7 w-20 animate-pulse rounded bg-[#EEF2F7]" />
            <div className="mt-3 h-3 w-16 animate-pulse rounded bg-[#EEF2F7]" />
          </Card>
        ))}
      </div>
    );
  }

  const teamRevenue = reps.reduce((s, r) => s + r.revenue, 0);
  const teamTarget = reps.reduce((s, r) => s + r.target, 0);
  const attainment = teamTarget > 0 ? (teamRevenue / teamTarget) * 100 : 0;
  const atOrOverTarget = reps.filter((r) => r.achievementPct >= 100).length;
  const totalVisits = reps.reduce((s, r) => s + r.visits, 0);
  const shown = reps.length;

  return (
    <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
      <KpiCardSimple
        label="Team Revenue"
        value={formatCurrency(teamRevenue)}
        subNote={`Across ${shown} of ${formatNumber(totalReps)} reps`}
      />
      <KpiCardSimple
        label="Team Attainment"
        value={formatPercent(attainment, { signed: false })}
        subNote="Revenue vs target, this page"
        subNoteTone={attainment >= 100 ? "success" : "muted"}
      />
      <KpiCardSimple
        label="Reps At / Over Target"
        value={`${atOrOverTarget} / ${shown}`}
        subNote="≥ 100% attainment"
        subNoteTone={atOrOverTarget > 0 ? "success" : "muted"}
      />
      <KpiCardSimple
        label="Total Visits"
        value={formatNumber(totalVisits)}
        subNote="Field visits, this page"
      />
    </div>
  );
}
