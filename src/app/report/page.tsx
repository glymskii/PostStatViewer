"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Header from "../components/Header";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  exportReportToExcel,
  type ReportGroup,
  type ReportTotals,
} from "../utils/exportReportToExcel";
import { PRESET_LABELS, presetRange, type Preset } from "../utils/period";

const NO_BRAND = "Без бренда";
const NO_TEAM = "Без команды";

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  threads: "Threads",
  tiktok: "TikTok",
};

interface ReportResponse {
  from: string;
  to: string;
  groups: ReportGroup[];
  totals: ReportTotals;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toLocaleString("ru-RU");
}

function formatDateTime(s: string): string {
  return new Date(s).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ReportPage() {
  const [preset, setPreset] = useState<Preset>("this_month");
  const initial = presetRange("this_month");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [brandFilter, setBrandFilter] = useState("__all__");
  const [teamFilter, setTeamFilter] = useState("__all__");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") {
      const r = presetRange(p);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/report?from=${from}&to=${to}`);
        if (!res.ok) {
          if (!cancelled) setData(null);
          return;
        }
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  // Distinct brand/team values for filter dropdowns.
  const { brands, teams } = useMemo(() => {
    const b = new Set<string>();
    const t = new Set<string>();
    data?.groups.forEach((g) => {
      b.add(g.brand ?? NO_BRAND);
      t.add(g.team ?? NO_TEAM);
    });
    return { brands: Array.from(b).sort(), teams: Array.from(t).sort() };
  }, [data]);

  // Apply client-side brand/team filters, then recompute totals.
  const { filteredGroups, filteredTotals } = useMemo(() => {
    const groups = (data?.groups ?? []).filter((g) => {
      const bLabel = g.brand ?? NO_BRAND;
      const tLabel = g.team ?? NO_TEAM;
      if (brandFilter !== "__all__" && bLabel !== brandFilter) return false;
      if (teamFilter !== "__all__" && tLabel !== teamFilter) return false;
      return true;
    });
    const totals: ReportTotals = {
      postsCount: groups.reduce((s, g) => s + g.postsCount, 0),
      totalViews: groups.reduce((s, g) => s + g.totalViews, 0),
      totalLikes: groups.reduce((s, g) => s + g.totalLikes, 0),
      avgViews: 0,
    };
    totals.avgViews =
      totals.postsCount > 0
        ? Math.round(totals.totalViews / totals.postsCount)
        : 0;
    return { filteredGroups: groups, filteredTotals: totals };
  }, [data, brandFilter, teamFilter]);

  function groupKey(g: ReportGroup): string {
    return `${g.brand ?? ""}|${g.team ?? ""}`;
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <h1 className="text-2xl font-bold">Отчёт по брендам и командам</h1>
          <Button
            variant="outline"
            disabled={loading || filteredGroups.length === 0}
            onClick={() =>
              exportReportToExcel({
                from,
                to,
                groups: filteredGroups,
                totals: filteredTotals,
              })
            }
          >
            Экспорт в Excel
          </Button>
        </div>

        {/* Period + filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Период</label>
                <Select
                  value={preset}
                  onValueChange={(v) => v && applyPreset(v as Preset)}
                >
                  <SelectTrigger className="w-[180px]">
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
              </div>

              {preset === "custom" && (
                <>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">С</label>
                    <Input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                      className="w-[160px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">По</label>
                    <Input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      className="w-[160px]"
                    />
                  </div>
                </>
              )}

              <div className="space-y-1">
                <label className="text-sm font-medium">Бренд</label>
                <Select
                  value={brandFilter}
                  onValueChange={(v) => v && setBrandFilter(v)}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue>
                      {brandFilter === "__all__" ? "Все бренды" : brandFilter}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Все бренды</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Команда</label>
                <Select
                  value={teamFilter}
                  onValueChange={(v) => v && setTeamFilter(v)}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue>
                      {teamFilter === "__all__" ? "Все команды" : teamFilter}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Все команды</SelectItem>
                    {teams.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <span className="text-sm text-muted-foreground pb-2">
                {from} — {to}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Totals cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Постов
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{filteredTotals.postsCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Просмотры
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {formatNumber(filteredTotals.totalViews)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Ср. просмотры
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {formatNumber(filteredTotals.avgViews)}
              </p>
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
                {formatNumber(filteredTotals.totalLikes)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Grouped table */}
        <Card>
          <CardHeader>
            <CardTitle>Бренд × Команда</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">Загрузка…</p>
            ) : filteredGroups.length === 0 ? (
              <p className="text-muted-foreground">
                Нет постов за выбранный период.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Бренд</TableHead>
                    <TableHead>Команда</TableHead>
                    <TableHead className="text-right">Постов</TableHead>
                    <TableHead className="text-right">Просмотры</TableHead>
                    <TableHead className="text-right">Ср. просмотры</TableHead>
                    <TableHead className="text-right">Лайки</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGroups.map((g) => {
                    const key = groupKey(g);
                    const isOpen = expanded.has(key);
                    return (
                      <Fragment key={key}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => toggleExpanded(key)}
                        >
                          <TableCell className="text-muted-foreground">
                            {isOpen ? "▾" : "▸"}
                          </TableCell>
                          <TableCell className="font-medium">
                            {g.brand ?? (
                              <span className="text-muted-foreground">
                                {NO_BRAND}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {g.team ?? (
                              <span className="text-muted-foreground">
                                {NO_TEAM}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {g.postsCount}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatNumber(g.totalViews)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatNumber(g.avgViews)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatNumber(g.totalLikes)}
                          </TableCell>
                        </TableRow>
                        {isOpen &&
                          g.posts.map((post) => (
                            <TableRow key={post.postId} className="bg-gray-50/50">
                              <TableCell></TableCell>
                              <TableCell colSpan={2}>
                                <a
                                  href={post.postUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 hover:underline"
                                >
                                  <Badge variant="outline" className="text-xs">
                                    {PLATFORM_LABELS[post.platform] ??
                                      post.platform}
                                  </Badge>
                                  <span className="text-sm">
                                    @{post.username}
                                  </span>
                                  <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                                    {post.caption || ""}
                                  </span>
                                </a>
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {formatDateTime(post.firstSeenAt)}
                              </TableCell>
                              <TableCell className="text-right">
                                {post.views !== null
                                  ? formatNumber(post.views)
                                  : "—"}
                              </TableCell>
                              <TableCell></TableCell>
                              <TableCell className="text-right">
                                {post.likes !== null
                                  ? formatNumber(post.likes)
                                  : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                      </Fragment>
                    );
                  })}
                  {/* Totals footer */}
                  <TableRow className="border-t-2 font-bold">
                    <TableCell></TableCell>
                    <TableCell colSpan={2}>ИТОГО</TableCell>
                    <TableCell className="text-right">
                      {filteredTotals.postsCount}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber(filteredTotals.totalViews)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber(filteredTotals.avgViews)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber(filteredTotals.totalLikes)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
