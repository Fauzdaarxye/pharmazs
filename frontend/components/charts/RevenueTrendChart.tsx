"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { RevenueTrendPoint } from "@/lib/types";
import { formatCurrency, formatCurrencyAxis, formatCompact, formatPeriod } from "@/lib/format";

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
  metric,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  metric: "revenue" | "units";
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
            {metric === "revenue"
              ? formatCurrency(entry.value)
              : formatCompact(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Revenue Performance chart (Contract §9 /dashboard): blue actual line + a green
 * dashed target line. Grid is horizontal only (#EEF2F7); 2px strokes, no dots.
 */
export function RevenueTrendChart({
  data,
  metric = "revenue",
}: {
  data: RevenueTrendPoint[];
  metric?: "revenue" | "units";
}) {
  const valueKey = metric === "revenue" ? "revenue" : "units";
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
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
          tickFormatter={(v) => (metric === "revenue" ? formatCurrencyAxis(v) : formatCompact(v))}
          tick={{ fontSize: 12, fill: "#64748B" }}
          tickLine={false}
          axisLine={false}
          width={64}
        />
        <Tooltip content={<ChartTooltip metric={metric} />} />
        <Line
          type="monotone"
          name={metric === "revenue" ? "Revenue" : "Units"}
          dataKey={valueKey}
          stroke="#2563EB"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        {metric === "revenue" && (
          <Line
            type="monotone"
            name="Target"
            dataKey="target"
            stroke="#16A34A"
            strokeWidth={2}
            strokeDasharray="6 5"
            dot={false}
            isAnimationActive={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
