"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Platform } from "@/db/schema";

interface PostData {
  externalId: string;
  postUrl: string;
  caption: string | null;
  thumbnailUrl: string | null;
  currentViews: number | null;
  currentLikes: number | null;
  firstSeenAt: string;
  snapshots: { viewCount: number | null; likeCount: number | null; scrapedAt: string }[];
}

interface ReelTableProps {
  posts: PostData[];
  platform: Platform;
}

const ITEM_LABEL: Record<Platform, string> = {
  instagram: "Reel",
  threads: "Пост",
  tiktok: "Видео",
};

function formatNumber(num: number | null): string {
  if (num === null) return "-";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toLocaleString("ru-RU");
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
  });
}

function rankClass(rank: number): string {
  if (rank === 1) return "bg-yellow-500 hover:bg-yellow-600";
  if (rank === 2) return "bg-gray-400 hover:bg-gray-500";
  if (rank === 3) return "bg-amber-700 hover:bg-amber-800";
  return "";
}

function StatsBar({
  views,
  likes,
  dark = true,
}: {
  views: number | null;
  likes: number | null;
  dark?: boolean;
}) {
  const bg = dark
    ? "bg-black/70 backdrop-blur-sm"
    : "bg-gray-100";
  const textColor = dark ? "text-white" : "text-gray-800";

  return (
    <div className={`${bg} rounded-lg px-3 py-2 flex items-center gap-3`}>
      <div className="flex items-center gap-1.5">
        <svg className={`w-4 h-4 ${textColor}`} fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
        <span className={`${textColor} font-bold text-sm`}>
          {formatNumber(views)}
        </span>
      </div>
      {likes !== null && (
        <div className="flex items-center gap-1.5">
          <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          <span className={`${textColor} font-bold text-sm`}>
            {formatNumber(likes)}
          </span>
        </div>
      )}
    </div>
  );
}

function PostMeta({ date, snapshots }: { date: string; snapshots: number }) {
  return (
    <div className="flex items-center justify-between mt-1">
      <span className="text-xs text-muted-foreground">{formatDate(date)}</span>
      <span className="text-xs text-muted-foreground">
        {snapshots} замер{snapshots === 1 ? "" : snapshots < 5 ? "а" : "ов"}
      </span>
    </div>
  );
}

export default function ReelTable({ posts, platform }: ReelTableProps) {
  const itemLabel = ITEM_LABEL[platform];
  const sorted = [...posts].sort(
    (a, b) => (b.currentViews ?? 0) - (a.currentViews ?? 0)
  );

  if (sorted.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12 text-lg">
        Нет данных. Запустите сбор данных.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {sorted.map((post, index) => {
        const rank = index + 1;

        return (
          <a
            key={post.externalId}
            href={post.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <Card className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer group">
              {post.thumbnailUrl ? (
                <>
                  {/* Visual post — thumbnail-focused layout */}
                  <div className="relative aspect-[9/16] max-h-[280px] bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center overflow-hidden">
                    <img
                      src={post.thumbnailUrl}
                      alt={`${itemLabel} ${post.externalId}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />

                    {/* Rank badge */}
                    <div className="absolute top-2 left-2">
                      <Badge
                        variant={rank <= 3 ? "default" : "secondary"}
                        className={`text-sm font-bold ${rankClass(rank)}`}
                      >
                        #{rank}
                      </Badge>
                    </div>

                    {/* Stats overlay */}
                    <div className="absolute bottom-2 left-2 right-2">
                      <StatsBar views={post.currentViews} likes={post.currentLikes} />
                    </div>
                  </div>

                  {/* Info area */}
                  <div className="p-3">
                    <p className="text-sm font-medium leading-snug line-clamp-2 min-h-[2.5rem]">
                      {post.caption || post.externalId}
                    </p>
                    <PostMeta date={post.firstSeenAt} snapshots={post.snapshots.length} />
                  </div>
                </>
              ) : (
                <>
                  {/* Text post — caption-focused layout */}
                  <div className="relative p-4 min-h-[200px] flex flex-col">
                    {/* Rank badge */}
                    <div className="absolute top-2 right-2">
                      <Badge
                        variant={rank <= 3 ? "default" : "secondary"}
                        className={`text-sm font-bold ${rankClass(rank)}`}
                      >
                        #{rank}
                      </Badge>
                    </div>

                    {/* Caption as main content */}
                    <p className="text-base leading-relaxed line-clamp-6 flex-1 pr-10">
                      {post.caption || post.externalId}
                    </p>

                    {/* Stats row */}
                    <div className="mt-3">
                      <StatsBar views={post.currentViews} likes={post.currentLikes} dark={false} />
                    </div>

                    <PostMeta date={post.firstSeenAt} snapshots={post.snapshots.length} />
                  </div>
                </>
              )}
            </Card>
          </a>
        );
      })}
    </div>
  );
}
