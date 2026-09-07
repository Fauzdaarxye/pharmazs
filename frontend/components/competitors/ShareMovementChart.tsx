"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { MarketSharePoint } from "@/lib/types-pages";
import { formatPeriod } from "@/lib/format";

interface TooltipEntry {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

function ShareTooltip({
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
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden />
          <span className="text-text-muted">{entry.name}:</span>
          <span className="tnum font-semibold text-text">{entry.value.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Share-movement chart: our share (blue) vs the competitor's (red) over the
 * period. Where the red line sits well above the blue, we are losing the market
 * — that is the story this chart exists to surface (CardioMax / North).
 */
export function ShareMovementChart({ data }: { data: MarketSharePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
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
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 12, fill: "#64748B" }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip content={<ShareTooltip />} />
        <Legend
          verticalAlign="top"
          height={28}
          iconType="plainline"
          wrapperStyle={{ fontSize: 12, color: "#64748B" }}
        />
        <Line
          type="monotone"
          name="Our share"
          dataKey="ourSharePct"
          stroke="#2563EB"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          name="Competitor share"
          dataKey="competitorSharePct"
          stroke="#DC2626"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
