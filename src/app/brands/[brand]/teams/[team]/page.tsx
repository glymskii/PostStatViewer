"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Header from "../../../../components/Header";
import ReelTable from "../../../../components/ReelTable";
import { TrendBadge } from "../../../../components/TeamCard";
import { PRESET_LABELS, presetRange, type Preset } from "../../../../utils/period";
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
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Platform = "instagram" | "threads" | "tiktok";

const NONE_BRAND = "__none__";

const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  threads: "Threads",
  tiktok: "TikTok",
};

interface DashboardPost {
  postId: number;
  accountId: number;
  platform: Platform;
  username: string;
  postUrl: string;
  caption: string | null;
  thumbnailUrl: string | null;
  team: string | null;
  firstSeenAt: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  snapshots: {
    viewCount: number | null;
    likeCount: number | null;
    commentCount: number | null;
    scrapedAt: string;
  }[];
}

interface TeamEntry {
  team: string | null;
  postsCount: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number | null;
  prevViews: number;
  deltaPct: number | null;
  series: number[];
  posts: DashboardPost[];
}

interface DashboardData {
  brand: string;
  dates: string[];
  teams: TeamEntry[];
}

interface AccountLite {
  id: number;
  platform: Platform;
  username: string;
  brand: string | null;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toLocaleString("ru-RU");
}

function platformFromUrl(url: string): Platform | null {
  if (/instagram\.com/.test(url)) return "instagram";
  if (/threads\.(com|net)/.test(url)) return "threads";
  if (/tiktok\.com/.test(url)) return "tiktok";
  return null;
}

export default function TeamPage() {
  const params = useParams();
  const brandParam = decodeURIComponent(params.brand as string);
  const team = decodeURIComponent(params.team as string);
  const brandLabel = brandParam === NONE_BRAND ? "Без бренда" : brandParam;

  const [preset, setPreset] = useState<Preset>("this_month");
  const initial = presetRange("this_month");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<AccountLite[]>([]);

  // Add-post form
  const [showAdd, setShowAdd] = useState(false);
  const [postUrl, setPostUrl] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [addSuccess, setAddSuccess] = useState("");

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") {
      const r = presetRange(p);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/dashboard?brand=${encodeURIComponent(brandParam)}&from=${from}&to=${to}`
      );
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error("Failed to fetch team data:", err);
    } finally {
      setLoading(false);
    }
  }, [brandParam, from, to]);

  useEffect(() => {
    setLoading(true);
    refetch();
  }, [refetch]);

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => (r.ok ? r.json() : []))
      .then((accs: AccountLite[]) => setAccounts(accs))
      .catch(() => {});
  }, []);

  const entry = useMemo(
    () => data?.teams.find((t) => t.team === team) ?? null,
    [data, team]
  );

  // Accounts of this brand matching the pasted URL's platform.
  const urlPlatform = postUrl ? platformFromUrl(postUrl) : null;
  const brandAccounts = accounts.filter((a) =>
    brandParam === NONE_BRAND ? a.brand === null : a.brand === brandParam
  );
  const matchingAccounts = urlPlatform
    ? brandAccounts.filter((a) => a.platform === urlPlatform)
    : [];

  async function handleAddPost(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    setAddSuccess("");
    const url = postUrl.trim();
    if (!url) return;

    const platform = platformFromUrl(url);
    if (!platform) {
      setAddError("Не удалось определить платформу по ссылке");
      return;
    }
    if (matchingAccounts.length === 0) {
      setAddError(
        `У бренда «${brandLabel}» нет аккаунта ${PLATFORM_LABELS[platform]}. Добавьте его в Настройках.`
      );
      return;
    }
    const accountId =
      matchingAccounts.length === 1
        ? matchingAccounts[0].id
        : parseInt(selectedAccountId, 10);
    if (!accountId) {
      setAddError("Выберите аккаунт");
      return;
    }

    setAdding(true);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, postUrl: url, team }),
      });
      if (res.ok) {
        setAddSuccess("Пост добавлен и присвоен команде");
        setPostUrl("");
        setSelectedAccountId("");
        refetch();
        setTimeout(() => {
          setAddSuccess("");
          setShowAdd(false);
        }, 2000);
      } else {
        const d = await res.json();
        setAddError(d.error || "Ошибка при добавлении");
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleTeamChange(postId: number, newTeam: string | null) {
    await fetch("/api/posts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, team: newTeam }),
    });
    refetch();
  }

  // Reshape dashboard posts → ReelTable PostData (cross-platform grid).
  const reelPosts = (entry?.posts ?? []).map((p) => ({
    id: p.postId,
    externalId: String(p.postId),
    postUrl: p.postUrl,
    caption: p.caption,
    thumbnailUrl: p.thumbnailUrl,
    team: p.team,
    platform: p.platform,
    currentViews: p.views,
    currentLikes: p.likes,
    firstSeenAt: p.firstSeenAt,
    snapshots: p.snapshots.map((s) => ({
      viewCount: s.viewCount,
      likeCount: s.likeCount,
      scrapedAt: s.scrapedAt,
    })),
  }));

  const chartData = (data?.dates ?? []).map((d, i) => ({
    date: d,
    views: entry?.series[i] ?? 0,
  }));

  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <Link
              href={`/?brand=${encodeURIComponent(brandParam)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← К дашборду
            </Link>
            <div className="flex items-center gap-2 mt-1">
              <h1 className="text-2xl font-bold">{team}</h1>
              <Badge variant="outline">{brandLabel}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={preset} onValueChange={(v) => v && applyPreset(v as Preset)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue>{PRESET_LABELS[preset]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRESET_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {preset === "custom" && (
              <>
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-[150px]"
                />
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-[150px]"
                />
              </>
            )}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Посты</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{entry?.postsCount ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Просмотры</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <p className="text-3xl font-bold">
                  {formatNumber(entry?.totalViews ?? 0)}
                </p>
                <TrendBadge deltaPct={entry?.deltaPct ?? null} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Лайки</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {formatNumber(entry?.totalLikes ?? 0)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Комментарии
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {entry?.totalComments != null
                  ? formatNumber(entry.totalComments)
                  : "—"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Cumulative views chart */}
        {chartData.length > 1 && (entry?.totalViews ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Накопление просмотров</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData}>
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis tickFormatter={formatNumber} fontSize={11} />
                  <Tooltip formatter={(v) => formatNumber(Number(v))} />
                  <Line
                    type="monotone"
                    dataKey="views"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Posts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Посты команды</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowAdd(!showAdd);
                setAddError("");
                setAddSuccess("");
              }}
            >
              + Добавить пост
            </Button>
          </CardHeader>
          <CardContent>
            {showAdd && (
              <form onSubmit={handleAddPost} className="mb-6 space-y-3">
                <Input
                  placeholder="https://www.instagram.com/reel/... или ссылка Threads/TikTok"
                  value={postUrl}
                  onChange={(e) => {
                    setPostUrl(e.target.value);
                    setAddError("");
                  }}
                  required
                />
                {urlPlatform && matchingAccounts.length > 1 && (
                  <Select
                    value={selectedAccountId}
                    onValueChange={(v) => v && setSelectedAccountId(v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Выберите аккаунт" />
                    </SelectTrigger>
                    <SelectContent>
                      {matchingAccounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          @{a.username} ({PLATFORM_LABELS[a.platform]})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {urlPlatform && (
                  <p className="text-xs text-muted-foreground">
                    Платформа: {PLATFORM_LABELS[urlPlatform]};{" "}
                    {matchingAccounts.length === 0
                      ? "нет подходящего аккаунта у бренда"
                      : matchingAccounts.length === 1
                      ? `аккаунт @${matchingAccounts[0].username}`
                      : "выберите аккаунт выше"}
                  </p>
                )}
                {addError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-3 py-2 text-sm">
                    {addError}
                  </div>
                )}
                {addSuccess && (
                  <div className="bg-green-50 border border-green-200 text-green-700 rounded-md px-3 py-2 text-sm">
                    {addSuccess}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={adding}>
                    {adding ? "Добавление..." : "Добавить"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAdd(false)}
                  >
                    Отмена
                  </Button>
                </div>
              </form>
            )}

            {loading && !data ? (
              <p className="text-muted-foreground">Загрузка...</p>
            ) : reelPosts.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center">
                У команды пока нет постов за выбранный период. Добавьте ссылку
                или присвойте команду постам на дашборде.
              </p>
            ) : (
              <ReelTable
                posts={reelPosts}
                platform="instagram"
                onTeamChange={handleTeamChange}
              />
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
