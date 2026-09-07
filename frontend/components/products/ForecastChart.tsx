"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { ForecastResult } from "@/lib/types-pages";
import { formatCurrency, formatCurrencyAxis, formatPeriod } from "@/lib/format";

interface Row {
  period: string;
  history: number | null;
  predicted: number | null;
  /** [lower, upper] so the Area renders a band, not a fill-to-zero. */
  band: [number, number] | null;
}

interface TooltipEntry {
  dataKey: string;
  value: number | [number, number];
  payload: Row;
}

function ForecastTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
      <div className="mb-1 text-[12px] font-semibold text-text">{formatPeriod(label)}</div>
      {row.history != null && (
        <Line3Row color="#0F172A" label="Actual" value={row.history} />
      )}
      {row.predicted != null && (
        <Line3Row color="#2563EB" label="Forecast" value={row.predicted} />
      )}
      {row.band && (
        <div className="mt-0.5 text-[12px] text-text-muted">
          Range {formatCurrency(row.band[0])} – {formatCurrency(row.band[1])}
        </div>
      )}
    </div>
  );
}

function Line3Row({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <span className="text-text-muted">{label}:</span>
      <span className="tnum font-semibold text-text">{formatCurrency(value)}</span>
    </div>
  );
}

/**
 * Forecast chart (SRS §23): actual history (dark line), point forecast (blue
 * dashed line) and a shaded confidence band between `lower` and `upper`. The
 * history line's last point is joined to the first forecast point so the series
 * is continuous. A forecast is an ESTIMATE — the caller shows the MAPE note.
 */
export function ForecastChart({ result }: { result: ForecastResult }) {
  const rows = useMemo<Row[]>(() => {
    const hist: Row[] = result.history.map((h) => ({
      period: h.period,
      history: h.value,
      predicted: null,
      band: null,
    }));
    // Bridge: seed the forecast series from the last actual so the dashed line
    // and band start where history ends rather than floating detached.
    const lastActual = result.history.at(-1);
    const fc: Row[] = result.forecast.map((f, i) => ({
      period: f.period,
      history: i === 0 && lastActual ? lastActual.value : null,
      predicted: f.predicted,
      band: [f.lower, f.upper],
    }));
    return [...hist, ...fc];
  }, [result]);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid vertical={false} stroke="#EEF2F7" />
        <XAxis
          dataKey="period"
          tickFormatter={formatPeriod}
          tick={{ fontSize: 12, fill: "#64748B" }}
          tickLine={false}
          axisLine={{ stroke: "#E5E9F0" }}
          minTickGap={20}
        />
        <YAxis
          tickFormatter={formatCurrencyAxis}
          tick={{ fontSize: 12, fill: "#64748B" }}
          tickLine={false}
          axisLine={false}
          width={64}
        />
        <Tooltip content={<ForecastTooltip />} />
        {/* Confidence band: an Area drawn from lower to upper (a [min,max] pair). */}
        <Area
          type="monotone"
          name="Confidence interval"
          dataKey="band"
          stroke="none"
          fill="#2563EB"
          fillOpacity={0.12}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          type="monotone"
          name="Actual"
          dataKey="history"
          stroke="#0F172A"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          type="monotone"
          name="Forecast"
          dataKey="predicted"
          stroke="#2563EB"
          strokeWidth={2}
          strokeDasharray="6 5"
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
