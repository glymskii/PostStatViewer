"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Header from "./components/Header";
import TeamCard, { TrendBadge } from "./components/TeamCard";
import DictionarySelect, {
  addDictionaryOption,
  useDictionary,
} from "./components/DictionarySelect";
import { DICT_BRANDS_KEY, DICT_TEAMS_KEY } from "@/lib/dictionaries";
import { PRESET_LABELS, presetRange, type Preset } from "./utils/period";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE_BRAND = "__none__";

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  threads: "Threads",
  tiktok: "TikTok",
};

const PLATFORM_BADGE_CLASS: Record<string, string> = {
  instagram: "bg-pink-500 hover:bg-pink-600",
  threads: "bg-black hover:bg-neutral-800",
  tiktok: "bg-cyan-500 hover:bg-cyan-600",
};

interface DashboardPost {
  postId: number;
  accountId: number;
  platform: string;
  username: string;
  postUrl: string;
  caption: string | null;
  thumbnailUrl: string | null;
  team: string | null;
  firstSeenAt: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
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
  from: string;
  to: string;
  dates: string[];
  teams: TeamEntry[];
  totals: {
    postsCount: number;
    totalViews: number;
    totalLikes: number;
    totalComments: number | null;
    prevViews: number;
    deltaPct: number | null;
  };
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toLocaleString("ru-RU");
}

function formatDate(s: string): string {
  return new Date(s).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
}

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const brands = useDictionary(DICT_BRANDS_KEY);

  const [hasNoBrandAccounts, setHasNoBrandAccounts] = useState(false);
  const [preset, setPreset] = useState<Preset>("this_month");
  const initial = presetRange("this_month");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scrapeRunning, setScrapeRunning] = useState(false);
  const [addingTeam, setAddingTeam] = useState(false);
  const [teamDraft, setTeamDraft] = useState("");

  const urlBrand = searchParams.get("brand");
  const tabs = useMemo(
    () => [...brands, ...(hasNoBrandAccounts ? [NONE_BRAND] : [])],
    [brands, hasNoBrandAccounts]
  );
  const activeBrand = urlBrand && tabs.includes(urlBrand) ? urlBrand : tabs[0];

  function selectBrand(brand: string) {
    router.replace(`/?brand=${encodeURIComponent(brand)}`, { scroll: false });
  }

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") {
      const r = presetRange(p);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  // Does a «Без бренда» tab need to exist?
  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => (r.ok ? r.json() : []))
      .then((accs: { brand: string | null }[]) => {
        setHasNoBrandAccounts(accs.some((a) => a.brand === null));
      })
      .catch(() => {});
  }, []);

  const refetchDashboard = useCallback(async () => {
    if (!activeBrand) return;
    try {
      const res = await fetch(
        `/api/dashboard?brand=${encodeURIComponent(activeBrand)}&from=${from}&to=${to}`
      );
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error("Failed to fetch dashboard:", err);
    } finally {
      setLoading(false);
    }
  }, [activeBrand, from, to]);

  useEffect(() => {
    setLoading(true);
    refetchDashboard();
  }, [refetchDashboard]);

  // Scrape status poll + refetch when a run finishes.
  useEffect(() => {
    let prevRunning = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/scrape");
        if (!res.ok) return;
        const s = await res.json();
        setScrapeRunning(s.isRunning);
        if (prevRunning && !s.isRunning) refetchDashboard();
        prevRunning = s.isRunning;
      } catch {}
    };
    tick();
    const interval = setInterval(tick, 10000);
    return () => clearInterval(interval);
  }, [refetchDashboard]);

  async function handleScrape() {
    setScrapeRunning(true);
    try {
      await fetch("/api/scrape", { method: "POST" });
    } catch (err) {
      console.error("Failed to start scrape:", err);
    }
  }

  async function handleAssignTeam(postId: number, team: string | null) {
    await fetch("/api/posts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, team }),
    });
    refetchDashboard();
  }

  async function handleAddTeam() {
    const v = teamDraft.trim();
    if (!v) {
      setAddingTeam(false);
      setTeamDraft("");
      return;
    }
    await addDictionaryOption(DICT_TEAMS_KEY, v);
    setAddingTeam(false);
    setTeamDraft("");
    refetchDashboard();
  }

  const namedTeams = (data?.teams ?? []).filter(
    (t): t is TeamEntry & { team: string } => t.team !== null
  );
  // Active teams by views desc, zero-post teams at the end.
  const sortedTeams = [
    ...namedTeams.filter((t) => t.postsCount > 0).sort((a, b) => b.totalViews - a.totalViews),
    ...namedTeams.filter((t) => t.postsCount === 0),
  ];
  const unassigned = (data?.teams ?? []).find((t) => t.team === null);

  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold">Дашборд</h1>
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
            <Button onClick={handleScrape} disabled={scrapeRunning}>
              {scrapeRunning ? "Сбор данных..." : "Запустить сбор"}
            </Button>
          </div>
        </div>

        {/* Brand tabs */}
        <div className="flex gap-2 flex-wrap border-b pb-3">
          {tabs.map((brand) => (
            <button
              key={brand}
              onClick={() => selectBrand(brand)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                brand === activeBrand
                  ? "bg-black text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {brand === NONE_BRAND ? "Без бренда" : brand}
            </button>
          ))}
        </div>

        {loading && !data ? (
          <p className="text-muted-foreground">Загрузка...</p>
        ) : !data ? (
          <p className="text-muted-foreground">Не удалось загрузить данные.</p>
        ) : (
          <>
            {/* Brand summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Посты за период
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{data.totals.postsCount}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Просмотры
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <p className="text-3xl font-bold">
                      {formatNumber(data.totals.totalViews)}
                    </p>
                    <TrendBadge deltaPct={data.totals.deltaPct} />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Лайки
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {formatNumber(data.totals.totalLikes)}
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
                    {data.totals.totalComments !== null
                      ? formatNumber(data.totals.totalComments)
                      : "—"}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Team cards */}
            <div>
              <h2 className="text-lg font-semibold mb-3">Команды</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {sortedTeams.map((t) => (
                  <TeamCard
                    key={t.team}
                    brandParam={activeBrand}
                    team={t.team}
                    postsCount={t.postsCount}
                    totalViews={t.totalViews}
                    totalLikes={t.totalLikes}
                    totalComments={t.totalComments}
                    deltaPct={t.deltaPct}
                    series={t.series}
                  />
                ))}

                {/* Add team card */}
                <Card className="border-dashed flex items-center justify-center min-h-[140px]">
                  <CardContent className="pt-6 w-full">
                    {addingTeam ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          autoFocus
                          value={teamDraft}
                          onChange={(e) => setTeamDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddTeam();
                            if (e.key === "Escape") {
                              setAddingTeam(false);
                              setTeamDraft("");
                            }
                          }}
                          placeholder="Название команды"
                        />
                        <Button size="sm" onClick={handleAddTeam}>
                          OK
                        </Button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingTeam(true)}
                        className="w-full text-center text-muted-foreground hover:text-foreground transition-colors"
                      >
                        + Команда
                      </button>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Unassigned posts pool */}
            {unassigned && unassigned.postsCount > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    Посты без команды ({unassigned.postsCount})
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Присвойте команду, чтобы посты попали в дашборд
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {unassigned.posts.map((post) => (
                    <div
                      key={post.postId}
                      className="flex items-center gap-3 border rounded-lg px-3 py-2"
                    >
                      <Badge
                        className={`shrink-0 ${PLATFORM_BADGE_CLASS[post.platform] ?? ""}`}
                      >
                        {PLATFORM_LABELS[post.platform] ?? post.platform}
                      </Badge>
                      <a
                        href={post.postUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 min-w-0 text-sm truncate hover:underline"
                      >
                        {post.caption || post.postUrl}
                      </a>
                      <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                        {formatDate(post.firstSeenAt)}
                      </span>
                      <span className="text-sm font-semibold shrink-0 w-16 text-right">
                        {post.views !== null ? formatNumber(post.views) : "—"}
                      </span>
                      <div className="shrink-0 w-[180px]">
                        <DictionarySelect
                          dictKey={DICT_TEAMS_KEY}
                          value={null}
                          onChange={(team) =>
                            team && handleAssignTeam(post.postId, team)
                          }
                          size="sm"
                          allowNone={false}
                          placeholder="Выбрать команду…"
                          className="w-full"
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <>
          <Header />
          <main className="container mx-auto px-4 py-8">
            <p className="text-muted-foreground">Загрузка...</p>
          </main>
        </>
      }
    >
      <DashboardInner />
    </Suspense>
  );
}
