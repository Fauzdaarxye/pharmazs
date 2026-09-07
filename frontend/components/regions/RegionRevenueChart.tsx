"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import { formatCurrency, formatCurrencyAxis } from "@/lib/format";
import type { Region } from "@/lib/types-pages";

interface TooltipEntry {
  value: number;
  payload: Region;
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
      <div className="mb-1 text-[12px] font-semibold text-text">{row.regionName}</div>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-text-muted">Revenue:</span>
        <span className="tnum font-semibold text-text">{formatCurrency(row.revenue)}</span>
      </div>
    </div>
  );
}

/**
 * Regional revenue comparison — horizontal bars so relative performance is
 * legible at a glance (North top, East weakest). The top region is emphasised in
 * primary blue; the rest are a calmer tint of the same hue.
 */
export function RegionRevenueChart({ data }: { data: Region[] }) {
  const sorted = [...data].sort((a, b) => b.revenue - a.revenue);
  const max = Math.max(...sorted.map((r) => r.revenue));
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, sorted.length * 52)}>
      <BarChart
        data={sorted}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
        barCategoryGap={12}
      >
        <CartesianGrid horizontal={false} stroke="#EEF2F7" />
        <XAxis
          type="number"
          tickFormatter={formatCurrencyAxis}
          tick={{ fontSize: 12, fill: "#64748B" }}
          tickLine={false}
          axisLine={{ stroke: "#E5E9F0" }}
        />
        <YAxis
          type="category"
          dataKey="regionName"
          tick={{ fontSize: 13, fill: "#0F172A" }}
          tickLine={false}
          axisLine={false}
          width={72}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "#F6F8FB" }} />
        <Bar dataKey="revenue" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {sorted.map((r) => (
            <Cell key={r.regionId} fill={r.revenue === max ? "#2563EB" : "#93B4F5"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
