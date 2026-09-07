"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { TrendPoint } from "@/lib/types-pages";
import {
  formatCurrency,
  formatCurrencyAxis,
  formatCompact,
  formatNumber,
  formatPeriod,
} from "@/lib/format";

interface TooltipEntry {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
      <div className="mb-1 text-[12px] font-semibold text-text">{formatPeriod(label)}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-[12px]">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
            aria-hidden
          />
          <span className="text-text-muted">{entry.name}:</span>
          <span className="tnum font-semibold text-text">
            {entry.dataKey === "revenue"
              ? formatCurrency(entry.value)
              : formatNumber(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Product revenue (blue line) + units (translucent bars) trend, reusing the
 * dashboard's Recharts idiom: horizontal grid only (#EEF2F7), 2px stroke, no dots.
 */
export function ProductTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid vertical={false} stroke="#EEF2F7" />
        <XAxis
          dataKey="period"
          tickFormatter={formatPeriod}
          tick={{ fontSize: 12, fill: "#64748B" }}
          tickLine={false}
          axisLine={{ stroke: "#E5E9F0" }}
          minTickGap={16}
        />
        <YAxis
          yAxisId="rev"
          tickFormatter={formatCurrencyAxis}
          tick={{ fontSize: 12, fill: "#64748B" }}
          tickLine={false}
          axisLine={false}
          width={64}
        />
        <YAxis
          yAxisId="units"
          orientation="right"
          tickFormatter={(v) => formatCompact(v)}
          tick={{ fontSize: 12, fill: "#64748B" }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip content={<ChartTooltip />} />
        <Legend
          verticalAlign="top"
          height={28}
          iconType="plainline"
          wrapperStyle={{ fontSize: 12, color: "#64748B" }}
        />
        <Bar
          yAxisId="units"
          name="Units"
          dataKey="units"
          fill="#2563EB"
          fillOpacity={0.14}
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        />
        <Line
          yAxisId="rev"
          type="monotone"
          name="Revenue"
          dataKey="revenue"
          stroke="#2563EB"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
