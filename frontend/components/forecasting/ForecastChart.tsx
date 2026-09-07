"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { formatCurrency, formatCurrencyAxis, formatPeriod } from "@/lib/format";
import type { ForecastResult } from "@/lib/types-pages";

interface Row {
  period: string;
  history: number | null;
  predicted: number | null;
  lower: number | null;
  // Recharts stacks Area from a base; we render the band as [lower, upper-lower].
  band: [number, number] | null;
  isForecast: boolean;
}

/**
 * Merge history and forecast into one continuous series keyed by period.
 * The history line and the forecast line share the seam month so the two
 * connect visually rather than leaving a gap. The confidence interval is drawn
 * as a shaded band between `lower` and `upper` over the forecast horizon only.
 */
function buildRows(result: ForecastResult): Row[] {
  const rows: Row[] = result.history.map((h) => ({
    period: h.period,
    history: h.value,
    predicted: null,
    lower: null,
    band: null,
    isForecast: false,
  }));

  // Seam: let the forecast line start from the last actual so it connects.
  const lastHist = result.history[result.history.length - 1];
  if (lastHist && result.forecast.length > 0) {
    const seam = rows[rows.length - 1];
    seam.predicted = lastHist.value;
    seam.lower = lastHist.value;
    seam.band = [lastHist.value, lastHist.value];
  }

  for (const f of result.forecast) {
    rows.push({
      period: f.period,
      history: null,
      predicted: f.predicted,
      lower: f.lower,
      band: [f.lower, Math.max(0, f.upper - f.lower)],
      isForecast: true,
    });
  }
  return rows;
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
      {row.isForecast ? (
        <>
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-text-muted">Estimate:</span>
            <span className="tnum font-semibold text-text">{formatCurrency(row.predicted)}</span>
          </div>
          {row.band && (
            <div className="mt-0.5 text-[12px] text-text-muted">
              <span className="tnum">
                {formatCurrency(row.band[0])} – {formatCurrency(row.band[0] + row.band[1])}
              </span>{" "}
              likely range
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-text-muted">Actual:</span>
          <span className="tnum font-semibold text-text">{formatCurrency(row.history)}</span>
        </div>
      )}
    </div>
  );
}

export function ForecastChart({ result }: { result: ForecastResult }) {
  const rows = buildRows(result);
  const seamPeriod = result.history[result.history.length - 1]?.period;

  return (
    <ResponsiveContainer width="100%" height={340}>
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

        {/* Confidence band: invisible base up to `lower`, shaded slab to `upper`. */}
        <Area
          dataKey={(r: Row) => (r.band ? r.band[0] : null)}
          stackId="band"
          stroke="none"
          fill="none"
          isAnimationActive={false}
          legendType="none"
          activeDot={false}
        />
        <Area
          dataKey={(r: Row) => (r.band ? r.band[1] : null)}
          stackId="band"
          stroke="none"
          fill="#2563EB"
          fillOpacity={0.12}
          isAnimationActive={false}
          legendType="none"
          activeDot={false}
        />

        {seamPeriod && (
          <ReferenceLine x={seamPeriod} stroke="#94A3B8" strokeDasharray="3 3" />
        )}

        {/* Actual history — solid blue. */}
        <Line
          type="monotone"
          name="Actual"
          dataKey="history"
          stroke="#2563EB"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        {/* Forecast — dashed violet to read clearly as an ESTIMATE, not an actual. */}
        <Line
          type="monotone"
          name="Estimate"
          dataKey="predicted"
          stroke="#7C3AED"
          strokeWidth={2}
          strokeDasharray="6 5"
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
