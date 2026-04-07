"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Header from "../../components/Header";
import ViewsChart from "../../components/ViewsChart";
import ReelTable from "../../components/ReelTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Snapshot {
  viewCount: number | null;
  likeCount: number | null;
  scrapedAt: string;
}

interface PostData {
  id: number;
  instagramId: string;
  postUrl: string;
  caption: string | null;
  thumbnailUrl: string | null;
  firstSeenAt: string;
  currentViews: number | null;
  currentLikes: number | null;
  snapshots: Snapshot[];
}

export default function AccountPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [posts, setPosts] = useState<PostData[]>([]);
  const [days, setDays] = useState("30");
  const [loading, setLoading] = useState(true);
  const [accountInfo, setAccountInfo] = useState<{
    clientName: string;
    id: number;
  } | null>(null);
  const [showAddReel, setShowAddReel] = useState(false);
  const [reelUrl, setReelUrl] = useState("");
  const [addingReel, setAddingReel] = useState(false);
  const [reelError, setReelError] = useState("");
  const [reelSuccess, setReelSuccess] = useState("");

  useEffect(() => {
    let isFirst = true;
    async function fetchData() {
      if (isFirst) setLoading(true);
      try {
        // Get account info
        const accountsRes = await fetch("/api/accounts");
        const accounts = await accountsRes.json();
        const account = accounts.find(
          (a: { username: string }) => a.username === slug
        );
        if (account) {
          setAccountInfo({ clientName: account.clientName, id: account.id });

          // Get stats
          const statsRes = await fetch(
            `/api/stats?accountId=${account.id}&days=${days}`
          );
          const statsData = await statsRes.json();
          setPosts(statsData);
        }
      } catch (err) {
        console.error("Failed to fetch data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    isFirst = false;
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [slug, days]);

  const totalViews = posts.reduce(
    (sum, p) => sum + (p.currentViews ?? 0),
    0
  );
  const totalLikes = posts.reduce(
    (sum, p) => sum + (p.currentLikes ?? 0),
    0
  );
  const avgViews =
    posts.length > 0 ? Math.round(totalViews / posts.length) : 0;
  const topPosts = [...posts]
    .sort((a, b) => (b.currentViews ?? 0) - (a.currentViews ?? 0))
    .slice(0, 10);

  async function handleAddReel(e: React.FormEvent) {
    e.preventDefault();
    if (!reelUrl || !accountInfo) return;
    setReelError("");
    setReelSuccess("");

    // Client-side duplicate check
    const idMatch = reelUrl.match(/\/(reel|p)\/([^/?]+)/);
    if (!idMatch) {
      setReelError("Неверная ссылка. Пример: https://www.instagram.com/reel/ABC123/");
      return;
    }
    const reelId = idMatch[2];
    const exists = posts.find((p) => p.instagramId === reelId);
    if (exists) {
      setReelError("Этот рилс уже отслеживается");
      return;
    }

    setAddingReel(true);
    try {
      const res = await fetch("/api/reels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: accountInfo.id,
          reelUrl: reelUrl.trim(),
        }),
      });
      if (res.ok) {
        setReelSuccess("Рилс добавлен и данные собраны");
        setReelUrl("");
        // Refresh data
        const statsRes = await fetch(
          `/api/stats?accountId=${accountInfo.id}&days=${days}`
        );
        const statsData = await statsRes.json();
        setPosts(statsData);
        setTimeout(() => {
          setReelSuccess("");
          setShowAddReel(false);
        }, 2000);
      } else {
        const data = await res.json();
        setReelError(data.error || "Ошибка при добавлении");
      }
    } finally {
      setAddingReel(false);
    }
  }

  function formatNumber(num: number): string {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
    return num.toLocaleString("ru-RU");
  }

  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">@{slug}</h1>
            {accountInfo && (
              <p className="text-muted-foreground">
                {accountInfo.clientName}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Период:</span>
            <Select value={days} onValueChange={(v) => v && setDays(v)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 дней</SelectItem>
                <SelectItem value="14">14 дней</SelectItem>
                <SelectItem value="30">30 дней</SelectItem>
                <SelectItem value="90">90 дней</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Загрузка...</p>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Всего Reels
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{posts.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Общие просмотры
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {formatNumber(totalViews)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Средние просмотры
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {formatNumber(avgViews)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Общие лайки
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {formatNumber(totalLikes)}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Chart - top 10 reels trend */}
            {topPosts.some((p) => p.snapshots.length > 0) && (
              <Card className="mb-8">
                <CardHeader>
                  <CardTitle>Тренд просмотров (ТОП-10)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ViewsChart
                    posts={topPosts.filter((p) => p.snapshots.length > 0)}
                  />
                </CardContent>
              </Card>
            )}

            {/* Table */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Все Reels</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowAddReel(!showAddReel);
                    setReelError("");
                    setReelSuccess("");
                  }}
                >
                  + Добавить рилс
                </Button>
              </CardHeader>
              <CardContent>
                {showAddReel && (
                  <form onSubmit={handleAddReel} className="mb-6 space-y-3">
                    <div className="space-y-1">
                      <Input
                        placeholder="https://www.instagram.com/reel/ABC123/"
                        value={reelUrl}
                        onChange={(e) => {
                          setReelUrl(e.target.value);
                          setReelError("");
                        }}
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        Вставьте прямую ссылку на рилс для отслеживания
                      </p>
                    </div>
                    {reelError && (
                      <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-3 py-2 text-sm">
                        {reelError}
                      </div>
                    )}
                    {reelSuccess && (
                      <div className="bg-green-50 border border-green-200 text-green-700 rounded-md px-3 py-2 text-sm">
                        {reelSuccess}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={addingReel}>
                        {addingReel ? "Добавление..." : "Добавить"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setShowAddReel(false);
                          setReelError("");
                          setReelSuccess("");
                        }}
                      >
                        Отмена
                      </Button>
                    </div>
                  </form>
                )}
                <ReelTable posts={posts} />
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </>
  );
}
