"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface Snapshot {
  viewCount: number | null;
  likeCount: number | null;
  scrapedAt: string;
}

interface PostWithSnapshots {
  externalId: string;
  postUrl: string;
  caption: string | null;
  currentViews: number | null;
  snapshots: Snapshot[];
}

interface ViewsChartProps {
  posts: PostWithSnapshots[];
  title?: string;
}

const COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#ea580c",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#c026d3",
  "#0d9488",
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatViews(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toString();
}

export default function ViewsChart({ posts, title }: ViewsChartProps) {
  // Build unified timeline data
  // Collect all unique timestamps
  const allTimestamps = new Set<string>();
  posts.forEach((post) => {
    post.snapshots.forEach((s) => allTimestamps.add(s.scrapedAt));
  });

  const sortedTimestamps = Array.from(allTimestamps).sort();

  const data = sortedTimestamps.map((timestamp) => {
    const point: Record<string, number | string | null> = {
      time: formatDate(timestamp),
    };
    posts.forEach((post) => {
      const snapshot = post.snapshots.find((s) => s.scrapedAt === timestamp);
      point[post.externalId] = snapshot?.viewCount ?? null;
    });
    return point;
  });

  if (data.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        Нет данных для отображения
      </div>
    );
  }

  return (
    <div>
      {title && <h3 className="text-lg font-semibold mb-3">{title}</h3>}
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" fontSize={12} />
          <YAxis tickFormatter={formatViews} fontSize={12} />
          <Tooltip
            formatter={(value) => formatViews(Number(value))}
          />
          <Legend />
          {posts.map((post, i) => (
            <Line
              key={post.externalId}
              type="monotone"
              dataKey={post.externalId}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
              name={post.caption ? post.caption.substring(0, 30) : post.externalId.substring(0, 10)}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
