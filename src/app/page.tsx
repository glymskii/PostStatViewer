"use client";

import { useEffect, useState } from "react";
import Header from "./components/Header";
import AccountCard from "./components/AccountCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Account {
  id: number;
  username: string;
  clientName: string;
  isActive: boolean;
  postCount: number;
  avgViews: number;
  lastScrapeAt: string | null;
  lastScrapeStatus: string | null;
}

export default function HomePage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [scrapeRunning, setScrapeRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newClientName, setNewClientName] = useState("");
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

  function extractUsername(input: string): string {
    let val = input.trim();
    const urlMatch = val.match(/instagram\.com\/([^/?]+)/);
    if (urlMatch) val = urlMatch[1];
    return val.replace(/^@/, "").replace(/\/$/, "");
  }

  function checkDuplicate(input: string): string | null {
    const username = extractUsername(input);
    if (!username) return null;
    const exists = accounts.find(
      (a) => a.username.toLowerCase() === username.toLowerCase()
    );
    return exists ? `Аккаунт @${username} уже отслеживается (${exists.clientName})` : null;
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!newUsername || !newClientName) return;
    setAddError("");
    setAddSuccess("");

    const dupError = checkDuplicate(newUsername);
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
          username: newUsername.trim(),
          clientName: newClientName.trim(),
        }),
      });
      if (res.ok) {
        const added = await res.json();
        setAddSuccess(`Аккаунт @${added.username} добавлен`);
        setNewUsername("");
        setNewClientName("");
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
            <Button
              onClick={handleScrape}
              disabled={scrapeRunning}
            >
              {scrapeRunning ? "Сбор данных..." : "Запустить сбор"}
            </Button>
          </div>
        </div>

        {showAddForm && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">Добавить аккаунт для отслеживания</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddAccount} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">
                      Ссылка или username
                    </label>
                    <Input
                      placeholder="https://instagram.com/salam_bro или @salam_bro"
                      value={newUsername}
                      onChange={(e) => {
                        setNewUsername(e.target.value);
                        setAddError("");
                      }}
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Вставьте ссылку на профиль, @username или просто имя пользователя
                    </p>
                    {newUsername && (
                      <p className="text-xs text-muted-foreground">
                        Будет отслеживаться: <span className="font-medium">@{extractUsername(newUsername) || "..."}</span>
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
                    <p className="text-xs text-muted-foreground">
                      Для удобной группировки аккаунтов
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
                username={account.username}
                clientName={account.clientName}
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
