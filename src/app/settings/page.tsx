"use client";

import { useEffect, useState } from "react";
import Header from "../components/Header";
import SessionsCard from "../components/SessionsCard";
import TelegramAlertsCard from "../components/TelegramAlertsCard";
import DictionarySelect from "../components/DictionarySelect";
import AccountCard from "../components/AccountCard";
import { DICT_BRANDS_KEY } from "@/lib/dictionaries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type Platform = "instagram" | "threads" | "tiktok";

const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  threads: "Threads",
  tiktok: "TikTok",
};

const PLATFORM_PLACEHOLDERS: Record<Platform, string> = {
  instagram: "https://instagram.com/salam_bro или @salam_bro",
  threads: "https://threads.com/@salam_bro или @salam_bro",
  tiktok: "https://tiktok.com/@salam_bro или @salam_bro",
};

function extractUsername(input: string, platform: Platform): string {
  let val = input.trim();
  const patterns: Record<Platform, RegExp> = {
    instagram: /instagram\.com\/([^/?#]+)/,
    threads: /threads\.(?:com|net)\/@?([^/?#]+)/,
    tiktok: /tiktok\.com\/@?([^/?#]+)/,
  };
  const m = val.match(patterns[platform]);
  if (m) val = m[1];
  return val.replace(/^@/, "").replace(/\/$/, "");
}

interface Account {
  id: number;
  platform: Platform;
  username: string;
  clientName: string;
  brand: string | null;
  isActive: boolean;
  postCount: number;
  avgViews: number;
  lastScrapeAt: string | null;
  lastScrapeStatus: string | null;
}

interface ScrapeRun {
  id: number;
  accountId: number;
  status: string;
  postsScraped: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const INTERVAL_PRESETS: Record<string, string> = {
  "0 * * * *": "Каждый час",
  "0 */6 * * *": "Каждые 6 часов",
  "0 3 * * *": "Раз в день (3:00)",
};

export default function SettingsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [scrapeRuns, setScrapeRuns] = useState<ScrapeRun[]>([]);
  const [newPlatform, setNewPlatform] = useState<Platform>("instagram");
  const [newUsername, setNewUsername] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newBrand, setNewBrand] = useState<string | null>(null);
  const [addError, setAddError] = useState("");
  const [addSuccess, setAddSuccess] = useState("");
  const [interval, setInterval_] = useState("0 3 * * *");
  const [adding, setAdding] = useState(false);
  const [savingInterval, setSavingInterval] = useState(false);
  const [intervalSaved, setIntervalSaved] = useState(false);

  async function fetchData() {
    try {
      const [accountsRes, scrapeRes, settingsRes] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/scrape"),
        fetch("/api/settings"),
      ]);
      const accountsData = await accountsRes.json();
      const scrapeData = await scrapeRes.json();
      const settingsData = await settingsRes.json();
      setAccounts(accountsData);
      setScrapeRuns(scrapeData.runs || []);
      if (settingsData.scrape_interval) {
        setInterval_(settingsData.scrape_interval);
      }
    } catch (err) {
      console.error("Failed to fetch:", err);
    }
  }

  async function handleIntervalChange(value: string) {
    setInterval_(value);
    setSavingInterval(true);
    setIntervalSaved(false);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "scrape_interval", value }),
      });
      setIntervalSaved(true);
      setTimeout(() => setIntervalSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save interval:", err);
    } finally {
      setSavingInterval(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!newUsername || !newClientName) return;
    setAddError("");
    setAddSuccess("");

    const username = extractUsername(newUsername, newPlatform);
    const duplicate = accounts.find(
      (a) =>
        a.platform === newPlatform &&
        a.username.toLowerCase() === username.toLowerCase()
    );
    if (duplicate) {
      setAddError(
        `Аккаунт @${username} в ${PLATFORM_LABELS[newPlatform]} уже отслеживается (${duplicate.clientName})`
      );
      return;
    }

    setAdding(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: newPlatform,
          username: newUsername.trim(),
          clientName: newClientName.trim(),
          brand: newBrand,
        }),
      });
      if (res.ok) {
        const added = await res.json();
        setAddSuccess(
          `Аккаунт @${added.username} (${PLATFORM_LABELS[added.platform as Platform]}) добавлен`
        );
        setNewUsername("");
        setNewClientName("");
        setNewBrand(null);
        fetchData();
        setTimeout(() => setAddSuccess(""), 3000);
      } else {
        const data = await res.json();
        setAddError(data.error || "Ошибка при добавлении");
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleDeactivate(id: number) {
    await fetch("/api/accounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchData();
  }

  async function handleBrandChange(id: number, brand: string | null) {
    // Optimistic update — the DictionarySelect already reflects the choice.
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, brand } : a))
    );
    await fetch("/api/accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, brand }),
    });
    fetchData();
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-8 space-y-8">
        <h1 className="text-2xl font-bold">Настройки</h1>

        {/* Sessions (manual cookie upload) */}
        <SessionsCard />

        {/* Telegram alerts */}
        <TelegramAlertsCard />

        {/* Interval settings */}
        <Card>
          <CardHeader>
            <CardTitle>Интервал сбора данных</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Select value={interval} onValueChange={(v) => v && handleIntervalChange(v)}>
                <SelectTrigger className="w-[280px]">
                  <SelectValue placeholder="Выберите интервал">
                    {INTERVAL_PRESETS[interval] || interval}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(INTERVAL_PRESETS).map(([cron, label]) => (
                    <SelectItem key={cron} value={cron}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <code className="text-sm text-muted-foreground bg-gray-100 px-2 py-1 rounded">
                {interval}
              </code>
              {savingInterval && (
                <span className="text-sm text-muted-foreground">Сохранение...</span>
              )}
              {intervalSaved && (
                <span className="text-sm text-green-600">Сохранено</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Add account */}
        <Card>
          <CardHeader>
            <CardTitle>Добавить аккаунт</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddAccount} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Платформа</Label>
                  <Select
                    value={newPlatform}
                    onValueChange={(v) => {
                      if (!v) return;
                      setNewPlatform(v as Platform);
                      setAddError("");
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="instagram">Instagram</SelectItem>
                      <SelectItem value="threads">Threads</SelectItem>
                      <SelectItem value="tiktok">TikTok</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Ссылка или username</Label>
                  <Input
                    id="username"
                    placeholder={PLATFORM_PLACEHOLDERS[newPlatform]}
                    value={newUsername}
                    onChange={(e) => {
                      setNewUsername(e.target.value);
                      setAddError("");
                    }}
                    required
                  />
                  {newUsername && (
                    <p className="text-xs text-muted-foreground">
                      Будет отслеживаться:{" "}
                      <span className="font-medium">
                        @{extractUsername(newUsername, newPlatform)}
                      </span>{" "}
                      в {PLATFORM_LABELS[newPlatform]}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clientName">Клиент</Label>
                  <Input
                    id="clientName"
                    placeholder="Kex Group"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Бренд</Label>
                  <DictionarySelect
                    dictKey={DICT_BRANDS_KEY}
                    value={newBrand}
                    onChange={setNewBrand}
                    className="w-full"
                    placeholder="Выбрать бренд…"
                  />
                  <p className="text-xs text-muted-foreground">
                    Все посты аккаунта наследуют бренд
                  </p>
                </div>
              </div>

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

              <Button type="submit" disabled={adding}>
                {adding ? "Добавление..." : "Добавить"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Account cards (health at a glance) */}
        {accounts.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                platform={account.platform}
                username={account.username}
                clientName={account.clientName}
                brand={account.brand}
                postCount={account.postCount}
                avgViews={account.avgViews}
                lastScrapeAt={account.lastScrapeAt}
                lastScrapeStatus={account.lastScrapeStatus}
                isActive={account.isActive}
              />
            ))}
          </div>
        )}

        {/* Accounts list */}
        <Card>
          <CardHeader>
            <CardTitle>Аккаунты</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Бренд</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">
                      @{account.username}
                    </TableCell>
                    <TableCell>{account.clientName}</TableCell>
                    <TableCell>
                      <DictionarySelect
                        dictKey={DICT_BRANDS_KEY}
                        value={account.brand}
                        onChange={(brand) =>
                          handleBrandChange(account.id, brand)
                        }
                        size="sm"
                        placeholder="—"
                      />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={account.isActive ? "default" : "secondary"}
                      >
                        {account.isActive ? "Активен" : "Неактивен"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {account.isActive && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeactivate(account.id)}
                        >
                          Деактивировать
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Scrape history */}
        <Card>
          <CardHeader>
            <CardTitle>Лог сбора данных</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Собрано</TableHead>
                  <TableHead>Ошибка</TableHead>
                  <TableHead>Завершено</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scrapeRuns.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-muted-foreground"
                    >
                      Нет записей
                    </TableCell>
                  </TableRow>
                ) : (
                  scrapeRuns.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="text-sm">
                        {formatDate(run.startedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            run.status === "success"
                              ? "default"
                              : run.status === "failed"
                              ? "destructive"
                              : "secondary"
                          }
                          className={
                            run.status === "success" ? "bg-green-600" : ""
                          }
                        >
                          {run.status === "success"
                            ? "Успех"
                            : run.status === "failed"
                            ? "Ошибка"
                            : run.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {run.postsScraped}
                      </TableCell>
                      <TableCell className="text-sm text-red-600 max-w-xs truncate">
                        {run.errorMessage || "-"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDate(run.finishedAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
