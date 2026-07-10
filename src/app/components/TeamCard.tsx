"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

interface TeamCardProps {
  brandParam: string; // brand name or "__none__", used to build the team URL
  team: string;
  postsCount: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number | null;
  deltaPct: number | null;
  series: number[];
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toLocaleString("ru-RU");
}

export function TrendBadge({ deltaPct }: { deltaPct: number | null }) {
  if (deltaPct === null) {
    return (
      <span
        className="text-xs text-muted-foreground"
        title="Нет данных за предыдущий период"
      >
        —
      </span>
    );
  }
  const up = deltaPct >= 0;
  return (
    <span
      className={`text-sm font-semibold ${up ? "text-green-600" : "text-red-600"}`}
      title="К предыдущему периоду той же длины"
    >
      {up ? "▲" : "▼"} {up ? "+" : "−"}
      {Math.abs(deltaPct).toFixed(1)}%
    </span>
  );
}

/**
 * Team performance card on the brand dashboard: views headline with trend
 * vs the previous equal period, likes/comments/posts, and a cumulative
 * daily-views sparkline. Zero-post teams render muted — "who shipped
 * nothing" is exactly the signal the dashboard exists to surface.
 */
export default function TeamCard({
  brandParam,
  team,
  postsCount,
  totalViews,
  totalLikes,
  totalComments,
  deltaPct,
  series,
}: TeamCardProps) {
  const isEmpty = postsCount === 0;
  const data = series.map((views, i) => ({ i, views }));
  const href = `/brands/${encodeURIComponent(brandParam)}/teams/${encodeURIComponent(team)}`;

  return (
    <Link href={href} className="block">
      <Card
        className={`hover:shadow-md transition-shadow cursor-pointer h-full ${
          isEmpty ? "opacity-60" : ""
        }`}
      >
        <CardHeader className="pb-1">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base truncate">{team}</CardTitle>
            {isEmpty ? (
              <Badge variant="secondary" className="shrink-0 text-xs">
                нет постов
              </Badge>
            ) : (
              <TrendBadge deltaPct={deltaPct} />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">
              {formatNumber(totalViews)}
            </span>
            <span className="text-xs text-muted-foreground">просмотров</span>
          </div>

          {!isEmpty && series.length > 1 && (
            <div className="h-[44px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data}
                  margin={{ top: 4, right: 2, bottom: 2, left: 2 }}
                >
                  <YAxis hide domain={["dataMin", "dataMax"]} />
                  <Line
                    type="monotone"
                    dataKey="views"
                    stroke={isEmpty ? "#d1d5db" : "#2563eb"}
                    strokeWidth={1.8}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {postsCount} пост{postsCount === 1 ? "" : postsCount < 5 && postsCount > 0 ? "а" : "ов"}
            </span>
            <span>♥ {formatNumber(totalLikes)}</span>
            <span>
              💬 {totalComments !== null ? formatNumber(totalComments) : "—"}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
