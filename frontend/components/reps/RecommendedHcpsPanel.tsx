import { Sparkles, Check, Info } from "lucide-react";
import { Card, CardHeader, ScoreBadge, PriorityBadge, CenteredSpinner, ErrorState, EmptyState } from "@/components/ui";
import type { RecommendedHcp, ScoreComponents } from "@/lib/types-pages";

/** Human labels for the five weighted score components (SRS §13). */
const COMPONENT_LABELS: Array<{ key: keyof ScoreComponents; label: string }> = [
  { key: "rxVolume", label: "Rx volume" },
  { key: "rxGrowth", label: "Rx growth" },
  { key: "engagement", label: "Engagement" },
  { key: "taRelevance", label: "TA relevance" },
  { key: "competitorOpportunity", label: "Competitor opportunity" },
];

function ComponentBars({
  components,
  weights,
}: {
  components: ScoreComponents;
  weights: ScoreComponents;
}) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {COMPONENT_LABELS.map(({ key, label }) => {
        const value = components[key] ?? 0;
        const weightPct = Math.round((weights[key] ?? 0) * 100);
        return (
          <div key={key}>
            <div className="mb-1 flex items-center justify-between text-[12px]">
              <span className="text-text-muted">
                {label} <span className="text-[11px] text-text-muted/70">· {weightPct}%</span>
              </span>
              <span className="tnum font-semibold text-text">{Math.round(value)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg" aria-hidden>
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Recommended HCPs — the SRS §27 payoff and the visual focus of the rep detail
 * page. Each card surfaces the ranked score with its priority band, the plain-
 * language `reasons` as the visible justification, and the weighted component
 * breakdown. The panel-level `disclaimer` is rendered VERBATIM (SRS §13): the
 * score is a commercial prioritisation, not a medical judgement.
 */
export function RecommendedHcpsPanel({
  items,
  loading,
  error,
  onRetry,
}: {
  items: RecommendedHcp[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  // The disclaimer is identical across items; surface it once, verbatim.
  const disclaimer = items[0]?.disclaimer;

  return (
    <Card className="border-violet/30 bg-violet-bg/40">
      <CardHeader
        title="Recommended HCPs to Prioritise"
        subtitle="AI-ranked commercial opportunities for this rep's territory (SRS §27)."
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet/40 bg-violet-bg px-2.5 py-1 text-[12px] font-semibold text-violet">
            <Sparkles size={13} /> AI Prioritisation
          </span>
        }
      />

      {loading ? (
        <CenteredSpinner />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No recommendations available"
          message="The scoring service returned no prioritised HCPs for this rep."
        />
      ) : (
        <div className="space-y-4">
          <ul className="space-y-3">
            {items.map((hcp, i) => (
              <li
                key={hcp.hcpId}
                className="rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-bg text-[13px] font-bold text-violet">
                      {i + 1}
                    </span>
                    <div>
                      <div className="text-[15px] font-semibold text-text">{hcp.hcpName}</div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <PriorityBadge priority={hcp.priority} />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ScoreBadge score={hcp.totalScore} showMax />
                  </div>
                </div>

                {/* Reasons — the visible justification for the ranking */}
                {hcp.reasons.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {hcp.reasons.map((reason, r) => (
                      <li key={r} className="flex items-start gap-2 text-[13px] text-text">
                        <Check size={15} className="mt-0.5 shrink-0 text-success" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Weighted component breakdown */}
                <div className="mt-4 border-t border-border pt-3">
                  <ComponentBars components={hcp.components} weights={hcp.weights} />
                </div>
              </li>
            ))}
          </ul>

          {/* Verbatim disclaimer (SRS §13) */}
          {disclaimer && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-bg px-3 py-2.5 text-[12px] text-text-muted">
              <Info size={14} className="mt-0.5 shrink-0" />
              <p>{disclaimer}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
