import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AccountCardProps {
  username: string;
  clientName: string;
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

export default function AccountCard({
  username,
  clientName,
  postCount,
  avgViews,
  lastScrapeAt,
  lastScrapeStatus,
  isActive,
}: AccountCardProps) {
  return (
    <Link href={`/accounts/${username}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">@{username}</CardTitle>
            <Badge variant={isActive ? "default" : "secondary"}>
              {isActive ? "Активен" : "Неактивен"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{clientName}</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{postCount}</p>
              <p className="text-xs text-muted-foreground">Reels</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{formatNumber(avgViews)}</p>
              <p className="text-xs text-muted-foreground">Ср. просмотры</p>
            </div>
            <div>
              <p className="text-sm">
                {lastScrapeStatus === "success" ? (
                  <Badge variant="default" className="bg-green-600">OK</Badge>
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
