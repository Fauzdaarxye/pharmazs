"use client";

import Link from "next/link";
import { ArrowRight, Lightbulb } from "lucide-react";
import { Card, PriorityBadge, Pill } from "@/components/ui";
import type { Recommendation } from "@/lib/types-pages";

/**
 * Map a recommendation's targetEntity to the in-app route it concerns, so every
 * card is a live link to the entity it is about (Contract §9 /recommendations).
 * Returns null when the type has no dedicated detail route yet.
 */
function entityHref(type: string | null, id: number | null): string | null {
  if (id == null) return null;
  switch ((type ?? "").toUpperCase()) {
    case "DRUG":
      return `/products?drugId=${id}`;
    case "REGION":
      return `/regions`;
    case "HCP":
      return `/hcps?hcpId=${id}`;
    case "REP":
      return `/sales-reps`;
    default:
      return null;
  }
}

function entityLabel(type: string | null, id: number | null): string {
  const t = (type ?? "").toUpperCase();
  if (!t || id == null) return "Company-wide";
  const noun =
    t === "DRUG" ? "product" : t === "HCP" ? "physician" : t === "REP" ? "rep" : t.toLowerCase();
  return `View ${noun}`;
}

/** Confidence as a labelled 0–100% bar so it reads as a signal, not a raw float. */
function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 75 ? "#16A34A" : pct >= 50 ? "#F59E0B" : "#64748B";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-text-muted">Confidence</span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-bg">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: tone }} />
      </div>
      <span className="tnum text-[12px] font-semibold" style={{ color: tone }}>
        {pct}%
      </span>
    </div>
  );
}

export function RecommendationCard({ rec }: { rec: Recommendation }) {
  const href = entityHref(rec.targetEntityType, rec.targetEntityId);

  return (
    <Card className="flex h-full flex-col">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-bg text-violet">
            <Lightbulb size={15} />
          </span>
          <Pill>{rec.recType.replace(/_/g, " ")}</Pill>
        </div>
        <PriorityBadge priority={rec.priority} />
      </div>

      <h3 className="text-[15px] font-semibold leading-snug text-text">{rec.title}</h3>

      <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-text-muted">{rec.rationale}</p>

      <div className="mt-3 rounded-lg border border-border bg-bg px-3 py-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
          Expected impact
        </div>
        <div className="text-[13px] font-semibold text-text">{rec.expectedImpact}</div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <ConfidenceMeter value={rec.confidence} />
        {href ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:text-primary-hover"
          >
            {entityLabel(rec.targetEntityType, rec.targetEntityId)} <ArrowRight size={14} />
          </Link>
        ) : (
          <span className="text-[12px] text-text-muted">Company-wide</span>
        )}
      </div>
    </Card>
  );
}
