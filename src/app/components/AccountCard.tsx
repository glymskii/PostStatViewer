import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Platform = "instagram" | "threads" | "tiktok";

const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  threads: "Threads",
  tiktok: "TikTok",
};

const PLATFORM_BADGE_CLASS: Record<Platform, string> = {
  instagram: "bg-pink-500 hover:bg-pink-600",
  threads: "bg-black hover:bg-neutral-800",
  tiktok: "bg-cyan-500 hover:bg-cyan-600",
};

const PLATFORM_ITEM_LABEL: Record<Platform, string> = {
  instagram: "Reels",
  threads: "Постов",
  tiktok: "Видео",
};

interface AccountCardProps {
  platform: Platform;
  username: string;
  clientName: string;
  brand?: string | null;
  postCount: number;
  avgViews: number;
  lastScrapeAt: string | null;
  lastScrapeStatus: string | null;
  isActive: boolean;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toString();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Никогда";
  const date = new Date(dateStr);
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STALE_HOURS = 36;

function staleness(lastScrapeAt: string | null): {
  stale: boolean;
  hoursAgo: number | null;
} {
  if (!lastScrapeAt) return { stale: true, hoursAgo: null };
  const ms = Date.now() - new Date(lastScrapeAt).getTime();
  const hours = ms / (60 * 60 * 1000);
  return { stale: hours >= STALE_HOURS, hoursAgo: hours };
}

function formatStaleness(hoursAgo: number | null): string {
  if (hoursAgo === null) return "Сбор ещё ни разу не запускался";
  const days = Math.floor(hoursAgo / 24);
  if (days >= 1) return `Сбор не работает ${days} ${days === 1 ? "день" : days < 5 ? "дня" : "дней"}`;
  return `Сбор не работает ${Math.round(hoursAgo)}ч`;
}

export default function AccountCard({
  platform,
  username,
  clientName,
  brand,
  postCount,
  avgViews,
  lastScrapeAt,
  lastScrapeStatus,
  isActive,
}: AccountCardProps) {
  const stale = staleness(lastScrapeAt);

  return (
    <Link href={`/accounts/${platform}/${username}`}>
      <Card
        className={`hover:shadow-md transition-shadow cursor-pointer overflow-hidden ${
          stale.stale && isActive ? "ring-2 ring-red-400" : ""
        }`}
      >
        {stale.stale && isActive && (
          <div className="bg-red-50 text-red-700 text-xs font-semibold px-3 py-1.5 border-b border-red-200">
            {formatStaleness(stale.hoursAgo)} — проверь сессию в{" "}
            <span className="underline">Настройках</span>
          </div>
        )}
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">@{username}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge className={PLATFORM_BADGE_CLASS[platform]}>
                {PLATFORM_LABELS[platform]}
              </Badge>
              <Badge variant={isActive ? "default" : "secondary"}>
                {isActive ? "Активен" : "Неактивен"}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground">{clientName}</p>
            {brand && (
              <Badge variant="outline" className="text-xs font-normal">
                {brand}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{postCount}</p>
              <p className="text-xs text-muted-foreground">
                {PLATFORM_ITEM_LABEL[platform]}
              </p>
            </div>
            <div>
              <p className="text-2xl font-bold">{formatNumber(avgViews)}</p>
              <p className="text-xs text-muted-foreground">Ср. просмотры</p>
            </div>
            <div>
              <p className="text-sm">
                {lastScrapeStatus === "success" ? (
                  <Badge variant="default" className="bg-green-600">
                    OK
                  </Badge>
                ) : lastScrapeStatus === "failed" ? (
                  <Badge variant="destructive">Ошибка</Badge>
                ) : (
                  <Badge variant="secondary">-</Badge>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatDate(lastScrapeAt)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
