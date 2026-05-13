"use client";

import {
  LineChart,
  Line,
  Tooltip,
  ResponsiveContainer,
  YAxis,
} from "recharts";

interface Snapshot {
  viewCount: number | null;
  likeCount: number | null;
  scrapedAt: string;
}

interface MiniViewChartProps {
  snapshots: Snapshot[];
  /** Tailwind text-color class for the line, e.g. "text-pink-500" */
  colorClass?: string;
  /** Pixel height of the sparkline */
  height?: number;
}

function formatViews(num: number | null): string {
  if (num === null) return "—";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toString();
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Tiny sparkline chart embedded inside post cards. Shows view-count
 * progression across all available snapshots for that single post.
 *
 * Designed to be compact and zero-chrome (no axis labels, no grid) so it
 * reads well inside a 250px-wide card. Hover reveals exact value + date.
 *
 * When fewer than 2 snapshots are available, renders an inline note instead
 * of an empty chart — recharts requires at least 2 points to draw a line.
 */
export default function MiniViewChart({
  snapshots,
  colorClass = "text-blue-500",
  height = 50,
}: MiniViewChartProps) {
  const data = snapshots
    .filter((s) => s.viewCount !== null)
    .map((s) => ({
      time: s.scrapedAt,
      views: s.viewCount,
    }));

  if (data.length < 2) {
    return (
      <div
        className="text-[10px] text-muted-foreground italic px-1"
        style={{ height }}
      >
        {data.length === 0
          ? "Нет замеров просмотров"
          : "Только 1 замер — нужно 2+ для графика"}
      </div>
    );
  }

  // Resolve Tailwind color class to actual CSS color via a data attribute.
  // We render an SVG inside, so we can't use className directly on Line.
  // Map common Tailwind classes to hex (cheap, fully predictable).
  const colorMap: Record<string, string> = {
    "text-pink-500": "#ec4899",
    "text-pink-600": "#db2777",
    "text-blue-500": "#3b82f6",
    "text-blue-600": "#2563eb",
    "text-cyan-500": "#06b6d4",
    "text-emerald-500": "#10b981",
    "text-amber-500": "#f59e0b",
    "text-gray-700": "#374151",
    "text-black": "#000000",
  };
  const stroke = colorMap[colorClass] || "#3b82f6";

  // Calculate trend for tooltip caption ("+12.3% за 7 замеров")
  const first = data[0].views ?? 0;
  const last = data[data.length - 1].views ?? 0;
  const deltaPct = first > 0 ? ((last - first) / first) * 100 : 0;
  const trendUp = deltaPct >= 0;

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            cursor={{ stroke: stroke, strokeWidth: 1, strokeDasharray: "2 2" }}
            contentStyle={{
              fontSize: 11,
              padding: "4px 8px",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
            }}
            labelFormatter={(label) => formatDate(label as string)}
            formatter={(value) => [formatViews(value as number), "Просмотры"]}
          />
          <Line
            type="monotone"
            dataKey="views"
            stroke={stroke}
            strokeWidth={1.8}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1 -mt-1">
        <span>{data.length} замеров</span>
        <span className={trendUp ? "text-green-600" : "text-red-600"}>
          {trendUp ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
