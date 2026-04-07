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
              {/* Thumbnail area */}
              <div className="relative aspect-[9/16] max-h-[280px] bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center overflow-hidden">
                {post.thumbnailUrl ? (
                  <img
                    src={post.thumbnailUrl}
                    alt={`${itemLabel} ${post.externalId}`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-gray-400">
                    <svg
                      className="w-12 h-12"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
                      />
                    </svg>
                    <span className="text-xs">{itemLabel}</span>
                  </div>
                )}

                {/* Rank badge */}
                <div className="absolute top-2 left-2">
                  <Badge
                    variant={rank <= 3 ? "default" : "secondary"}
                    className={`text-sm font-bold ${
                      rank === 1
                        ? "bg-yellow-500 hover:bg-yellow-600"
                        : rank === 2
                        ? "bg-gray-400 hover:bg-gray-500"
                        : rank === 3
                        ? "bg-amber-700 hover:bg-amber-800"
                        : ""
                    }`}
                  >
                    #{rank}
                  </Badge>
                </div>

                {/* Stats overlay */}
                <div className="absolute bottom-2 left-2 right-2">
                  <div className="bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <svg
                        className="w-4 h-4 text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      <span className="text-white font-bold text-sm">
                        {formatNumber(post.currentViews)}
                      </span>
                    </div>
                    {post.currentLikes !== null && (
                      <div className="flex items-center gap-1.5">
                        <svg
                          className="w-4 h-4 text-red-400"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                        </svg>
                        <span className="text-white font-bold text-sm">
                          {formatNumber(post.currentLikes)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Info area */}
              <div className="p-3">
                <p className="text-sm font-medium leading-snug line-clamp-2 min-h-[2.5rem]">
                  {post.caption || post.externalId}
                </p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-muted-foreground">
                    {formatDate(post.firstSeenAt)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {post.snapshots.length} замер{post.snapshots.length === 1 ? "" : post.snapshots.length < 5 ? "а" : "ов"}
                  </span>
                </div>
              </div>
            </Card>
          </a>
        );
      })}
    </div>
  );
}
