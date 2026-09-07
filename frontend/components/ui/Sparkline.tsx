"use client";

import { ResponsiveContainer, LineChart, Line } from "recharts";

/** A tiny inline trend line for KPI cards. No axes, no dots, 2px stroke. */
export function Sparkline({
  data,
  color = "#2563EB",
  height = 40,
}: {
  data: number[];
  color?: string;
  height?: number;
}) {
  if (!data || data.length < 2) {
    return <div style={{ height }} aria-hidden />;
  }
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <div style={{ height, width: "100%" }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
