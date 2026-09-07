"use client";

import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  Card,
  CardHeader,
  ChartCard,
  SegmentedControl,
  AiInsightBanner,
} from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import type { ForecastEntityType } from "@/lib/types-pages";
import { ForecastChart } from "@/components/forecasting/ForecastChart";

/**
 * /meta/filters is keyed {regionId/regionName, taId/taName, drugId/drugName} in the
 * live API — not the {id,name} that lib/types declares. Both files are shared and
 * read-only, so normalise defensively here.
 */
type Row = { id: number; name: string };
function pick(rows: unknown[] | undefined, idKeys: string[], nameKeys: string[]): Row[] {
  return (rows ?? [])
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      const id = idKeys.map((k) => r[k]).find((v) => typeof v === "number") as number | undefined;
      const name = nameKeys.map((k) => r[k]).find((v) => typeof v === "string") as string | undefined;
      return id != null && name ? { id, name } : null;
    })
    .filter((r): r is Row => r !== null);
}

const ENTITY_OPTIONS = [
  { label: "Company", value: "COMPANY" as const },
  { label: "Drug", value: "DRUG" as const },
  { label: "Region", value: "REGION" as const },
  { label: "Therapeutic Area", value: "TA" as const },
];

const HORIZON_OPTIONS = [
  { label: "3 mo", value: "3" },
  { label: "6 mo", value: "6" },
  { label: "12 mo", value: "12" },
];

/** MAPE → plain-language confidence band. Lower error = higher confidence. */
function mapeConfidence(mape: number | null): { label: string; color: string; note: string } {
  if (mape == null) return { label: "Not available", color: "#64748B", note: "Backtest error could not be computed for this series." };
  if (mape <= 8) return { label: "High confidence", color: "#16A34A", note: "The model tracked recent history closely in backtesting." };
  if (mape <= 15) return { label: "Moderate confidence", color: "#F59E0B", note: "Reasonable fit, but treat the estimate as indicative." };
  return { label: "Low confidence", color: "#DC2626", note: "History is volatile or short — widen your planning range." };
}

export default function ForecastingPage() {
  const meta = useAsync(() => endpoints.metaFilters(), []);

  const products = useMemo(() => pick(meta.data?.products as unknown[], ["drugId", "id"], ["drugName", "name"]), [meta.data]);
  const regions = useMemo(() => pick(meta.data?.regions as unknown[], ["regionId", "id"], ["regionName", "name"]), [meta.data]);
  const tas = useMemo(() => pick(meta.data?.therapeuticAreas as unknown[], ["taId", "id"], ["taName", "name"]), [meta.data]);

  const [entityType, setEntityType] = useState<ForecastEntityType>("COMPANY");
  const [horizon, setHorizon] = useState("6");
  const [entityId, setEntityId] = useState<number | undefined>(undefined);

  // The list of selectable entities for the current type (empty for COMPANY).
  const entityList: Row[] = useMemo(() => {
    if (entityType === "DRUG") return products;
    if (entityType === "REGION") return regions;
    if (entityType === "TA") return tas;
    return [];
  }, [entityType, products, regions, tas]);

  // When the entity TYPE changes, default the id to the first available option
  // (or undefined for COMPANY) so we never send a stale id from another type.
  useEffect(() => {
    if (entityType === "COMPANY") {
      setEntityId(undefined);
    } else {
      setEntityId(entityList[0]?.id);
    }
    // entityList identity changes when meta loads; that is the intended trigger.
  }, [entityType, entityList]);

  const needsEntity = entityType !== "COMPANY";
  const ready = !needsEntity || entityId != null;

  const forecast = useAsync(
    () =>
      ready
        ? endpoints.forecast({
            entityType,
            entityId: needsEntity ? entityId : undefined,
            horizon: Number(horizon),
          })
        : Promise.resolve(null),
    [entityType, entityId, horizon, ready],
  );

  const entityName = useMemo(() => {
    if (entityType === "COMPANY") return "the company";
    return entityList.find((e) => e.id === entityId)?.name ?? "this entity";
  }, [entityType, entityId, entityList]);

  const f = forecast.data;
  const conf = mapeConfidence(f?.mape ?? null);

  return (
    <>
      <PageHeader
        title="Forecasting"
        subtitle="Projected demand by entity and horizon. Every figure is an estimate, not a guarantee (SRS §23)."
      />

      {/* Controls */}
      <div className="mb-6">
        <Card>
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-text-muted">Entity</div>
              <SegmentedControl
                ariaLabel="Entity type"
                options={ENTITY_OPTIONS}
                value={entityType}
                onChange={setEntityType}
              />
            </div>

            {needsEntity && (
              <div>
                <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-text-muted">
                  {entityType === "DRUG" ? "Product" : entityType === "REGION" ? "Region" : "Therapeutic area"}
                </div>
                <label className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[13px]">
                  <select
                    value={entityId ?? ""}
                    onChange={(e) => setEntityId(Number(e.target.value))}
                    disabled={meta.loading || entityList.length === 0}
                    className="cursor-pointer bg-transparent font-medium text-text outline-none disabled:cursor-not-allowed"
                  >
                    {entityList.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <div>
              <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-text-muted">Horizon</div>
              <SegmentedControl
                ariaLabel="Forecast horizon"
                options={HORIZON_OPTIONS}
                value={horizon}
                onChange={setHorizon}
              />
            </div>
          </div>
        </Card>
      </div>

      {/* Forecast chart */}
      <div className="mb-6">
        <ChartCard
          title="Revenue outlook"
          subtitle={`Based on historical patterns, the model estimates revenue for ${entityName} over the next ${horizon} months.`}
          loading={meta.loading || forecast.loading || !ready}
          error={meta.error ?? forecast.error}
          isEmpty={!!f && f.history.length === 0}
          onRetry={forecast.reload}
          minHeight={360}
        >
          {f && (
            <div className="space-y-4">
              <AiInsightBanner title="How to read this">
                The solid blue line is actual history; the{" "}
                <span className="font-semibold text-violet">dashed line is an estimate</span>, and the
                shaded band is the likely range around it. These are projections based on past
                trends and seasonality — not a commitment.
              </AiInsightBanner>
              <ForecastChart result={f} />
            </div>
          )}
        </ChartCard>
      </div>

      {/* Model + confidence (MAPE) */}
      {f && !forecast.loading && !forecast.error && (
        <Card>
          <CardHeader
            title="Model & reliability"
            subtitle="Judge the estimate before you trust it."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-bg p-4">
              <div className="text-[12px] font-medium uppercase tracking-wide text-text-muted">Model</div>
              <div className="mt-1 text-[15px] font-semibold text-text">
                {f.model.replace(/_/g, " ")}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-bg p-4">
              <div className="text-[12px] font-medium uppercase tracking-wide text-text-muted">
                Backtest error (MAPE)
              </div>
              <div className="tnum mt-1 text-[15px] font-semibold text-text">
                {f.mape != null ? `${f.mape.toFixed(1)}%` : "—"}
              </div>
              <div className="text-[12px] text-text-muted">avg. deviation in backtesting</div>
            </div>
            <div className="rounded-lg border p-4" style={{ borderColor: `${conf.color}55`, backgroundColor: `${conf.color}12` }}>
              <div className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide" style={{ color: conf.color }}>
                <Info size={13} /> Confidence
              </div>
              <div className="mt-1 text-[15px] font-semibold" style={{ color: conf.color }}>
                {conf.label}
              </div>
              <div className="text-[12px] text-text-muted">{conf.note}</div>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
