"use client";

import { useEffect, useState } from "react";
import Header from "./components/Header";
import AccountCard from "./components/AccountCard";
import DictionarySelect from "./components/DictionarySelect";
import { DICT_BRANDS_KEY } from "@/lib/dictionaries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

export default function HomePage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [scrapeRunning, setScrapeRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPlatform, setNewPlatform] = useState<Platform>("instagram");
  const [newUsername, setNewUsername] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newBrand, setNewBrand] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [addSuccess, setAddSuccess] = useState("");

  async function fetchData() {
    try {
      const [accountsRes, scrapeRes] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/scrape"),
      ]);
      const accountsData = await accountsRes.json();
      const scrapeData = await scrapeRes.json();
      setAccounts(accountsData);
      setScrapeRunning(scrapeData.isRunning);
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  async function handleScrape() {
    setScrapeRunning(true);
    try {
      await fetch("/api/scrape", { method: "POST" });
    } catch (err) {
      console.error("Failed to start scrape:", err);
    }
  }

  function checkDuplicate(input: string, platform: Platform): string | null {
    const username = extractUsername(input, platform);
    if (!username) return null;
    const exists = accounts.find(
      (a) =>
        a.platform === platform &&
        a.username.toLowerCase() === username.toLowerCase()
    );
    return exists
      ? `Аккаунт @${username} в ${PLATFORM_LABELS[platform]} уже отслеживается (${exists.clientName})`
      : null;
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!newUsername || !newClientName) return;
    setAddError("");
    setAddSuccess("");

    const dupError = checkDuplicate(newUsername, newPlatform);
    if (dupError) {
      setAddError(dupError);
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
        setTimeout(() => {
          setAddSuccess("");
          setShowAddForm(false);
        }, 2000);
      } else {
        const data = await res.json();
        setAddError(data.error || "Ошибка при добавлении");
      }
    } finally {
      setAdding(false);
    }
  }

  if (loading) {
    return (
      <>
        <Header />
        <main className="container mx-auto px-4 py-8">
          <p className="text-muted-foreground">Загрузка...</p>
        </main>
      </>
    );
  }

  const previewUsername = newUsername
    ? extractUsername(newUsername, newPlatform)
    : "";

  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Аккаунты</h1>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              + Добавить аккаунт
            </Button>
            <Button onClick={handleScrape} disabled={scrapeRunning}>
              {scrapeRunning ? "Сбор данных..." : "Запустить сбор"}
            </Button>
          </div>
        </div>

        {showAddForm && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">
                Добавить аккаунт для отслеживания
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddAccount} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Платформа</label>
                    <Select
                      value={newPlatform}
                      onValueChange={(v) => {
                        setNewPlatform(v as Platform);
                        setAddError("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="instagram">Instagram</SelectItem>
                        <SelectItem value="threads">Threads</SelectItem>
                        <SelectItem value="tiktok">TikTok</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      TikTok пока в разработке (v2.2)
                    </p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">
                      Ссылка или username
                    </label>
                    <Input
                      placeholder={PLATFORM_PLACEHOLDERS[newPlatform]}
                      value={newUsername}
                      onChange={(e) => {
                        setNewUsername(e.target.value);
                        setAddError("");
                      }}
                      required
                    />
                    {previewUsername && (
                      <p className="text-xs text-muted-foreground">
                        Будет отслеживаться:{" "}
                        <span className="font-medium">@{previewUsername}</span>{" "}
                        в {PLATFORM_LABELS[newPlatform]}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">
                      Название клиента
                    </label>
                    <Input
                      placeholder="Kex Group"
                      value={newClientName}
                      onChange={(e) => setNewClientName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Бренд</label>
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

                <div className="flex gap-2">
                  <Button type="submit" disabled={adding}>
                    {adding ? "Добавление..." : "Добавить"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setShowAddForm(false);
                      setAddError("");
                      setAddSuccess("");
                    }}
                  >
                    Отмена
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {accounts.length === 0 ? (
          <p className="text-muted-foreground">
            Нет аккаунтов. Нажмите «+ Добавить аккаунт» чтобы начать.
          </p>
        ) : (
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
      </main>
    </>
  );
}
