"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Header from "../../../components/Header";
import ViewsChart from "../../../components/ViewsChart";
import ReelTable from "../../../components/ReelTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { exportAccountToExcel } from "../../../utils/exportAccountToExcel";

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

const PLATFORM_ITEM_LABEL_PLURAL: Record<Platform, string> = {
  instagram: "Reels",
  threads: "посты",
  tiktok: "видео",
};

const PLATFORM_ADD_PLACEHOLDER: Record<Platform, string> = {
  instagram: "https://www.instagram.com/reel/ABC123/",
  threads: "https://www.threads.com/@username/post/ABC123",
  tiktok: "https://www.tiktok.com/@username/video/1234567890",
};

interface Snapshot {
  viewCount: number | null;
  likeCount: number | null;
  scrapedAt: string;
}

interface PostData {
  id: number;
  externalId: string;
  postUrl: string;
  caption: string | null;
  thumbnailUrl: string | null;
  team: string | null;
  firstSeenAt: string;
  currentViews: number | null;
  currentLikes: number | null;
  snapshots: Snapshot[];
}

export default function AccountPage() {
  const params = useParams();
  const platform = params.platform as Platform;
  const username = params.username as string;
  const [posts, setPosts] = useState<PostData[]>([]);
  const [days, setDays] = useState("30");
  const [loading, setLoading] = useState(true);
  const [accountInfo, setAccountInfo] = useState<{
    clientName: string;
    brand: string | null;
    id: number;
    platform: Platform;
  } | null>(null);
  const [showAddPost, setShowAddPost] = useState(false);
  const [postUrl, setPostUrl] = useState("");
  const [addingPost, setAddingPost] = useState(false);
  const [postError, setPostError] = useState("");
  const [postSuccess, setPostSuccess] = useState("");

  useEffect(() => {
    let isFirst = true;
    async function fetchData() {
      if (isFirst) setLoading(true);
      try {
        const accountsRes = await fetch("/api/accounts");
        const accounts = await accountsRes.json();
        const account = accounts.find(
          (a: { platform: Platform; username: string }) =>
            a.platform === platform && a.username === username
        );
        if (account) {
          setAccountInfo({
            clientName: account.clientName,
            brand: account.brand ?? null,
            id: account.id,
            platform: account.platform,
          });

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
  }, [platform, username, days]);

  const totalViews = posts.reduce(
    (sum, p) => sum + (p.currentViews ?? 0),
    0
  );
  const totalLikes = posts.reduce(
    (sum, p) => sum + (p.currentLikes ?? 0),
    0
  );
  const avgViews = posts.length > 0 ? Math.round(totalViews / posts.length) : 0;
  const topPosts = [...posts]
    .sort((a, b) => (b.currentViews ?? 0) - (a.currentViews ?? 0))
    .slice(0, 10);

  async function handleTeamChange(postId: number, team: string | null) {
    // Optimistic update; the 10s poll reconciles afterwards.
    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, team } : p))
    );
    await fetch("/api/posts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, team }),
    });
  }

  async function handleAddPost(e: React.FormEvent) {
    e.preventDefault();
    if (!postUrl || !accountInfo) return;
    setPostError("");
    setPostSuccess("");

    setAddingPost(true);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: accountInfo.id,
          postUrl: postUrl.trim(),
        }),
      });
      if (res.ok) {
        setPostSuccess("Пост добавлен и данные собраны");
        setPostUrl("");
        const statsRes = await fetch(
          `/api/stats?accountId=${accountInfo.id}&days=${days}`
        );
        const statsData = await statsRes.json();
        setPosts(statsData);
        setTimeout(() => {
          setPostSuccess("");
          setShowAddPost(false);
        }, 2000);
      } else {
        const data = await res.json();
        setPostError(data.error || "Ошибка при добавлении");
      }
    } finally {
      setAddingPost(false);
    }
  }

  function formatNumber(num: number): string {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
    return num.toLocaleString("ru-RU");
  }

  const itemLabel = PLATFORM_ITEM_LABEL_PLURAL[platform] || "посты";

  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">@{username}</h1>
              <Badge className={PLATFORM_BADGE_CLASS[platform]}>
                {PLATFORM_LABELS[platform]}
              </Badge>
              {accountInfo?.brand && (
                <Badge variant="outline">{accountInfo.brand}</Badge>
              )}
            </div>
            {accountInfo && (
              <p className="text-muted-foreground">{accountInfo.clientName}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || posts.length === 0 || !accountInfo}
              onClick={() => {
                if (!accountInfo) return;
                exportAccountToExcel({
                  account: {
                    username,
                    clientName: accountInfo.clientName,
                    platform,
                  },
                  posts,
                  periodDays: parseInt(days, 10),
                });
              }}
            >
              Экспорт в Excel
            </Button>
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
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground capitalize">
                    Всего {itemLabel}
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
                  <p className="text-3xl font-bold">{formatNumber(avgViews)}</p>
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

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="capitalize">Все {itemLabel}</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowAddPost(!showAddPost);
                    setPostError("");
                    setPostSuccess("");
                  }}
                >
                  + Добавить пост
                </Button>
              </CardHeader>
              <CardContent>
                {showAddPost && (
                  <form onSubmit={handleAddPost} className="mb-6 space-y-3">
                    <div className="space-y-1">
                      <Input
                        placeholder={PLATFORM_ADD_PLACEHOLDER[platform]}
                        value={postUrl}
                        onChange={(e) => {
                          setPostUrl(e.target.value);
                          setPostError("");
                        }}
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        Вставьте прямую ссылку на пост для отслеживания
                      </p>
                    </div>
                    {postError && (
                      <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-3 py-2 text-sm">
                        {postError}
                      </div>
                    )}
                    {postSuccess && (
                      <div className="bg-green-50 border border-green-200 text-green-700 rounded-md px-3 py-2 text-sm">
                        {postSuccess}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={addingPost}>
                        {addingPost ? "Добавление..." : "Добавить"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setShowAddPost(false);
                          setPostError("");
                          setPostSuccess("");
                        }}
                      >
                        Отмена
                      </Button>
                    </div>
                  </form>
                )}
                <ReelTable
                  posts={posts}
                  platform={platform}
                  onTeamChange={handleTeamChange}
                />
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </>
  );
}
