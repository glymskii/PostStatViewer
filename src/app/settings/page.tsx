"use client";

import { useEffect, useState } from "react";
import Header from "../components/Header";
import SessionsCard from "../components/SessionsCard";
import TelegramAlertsCard from "../components/TelegramAlertsCard";
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

interface Account {
  id: number;
  username: string;
  clientName: string;
  isActive: boolean;
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
  const [newUsername, setNewUsername] = useState("");
  const [newClientName, setNewClientName] = useState("");
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
    setAdding(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          clientName: newClientName,
        }),
      });
      if (res.ok) {
        setNewUsername("");
        setNewClientName("");
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error || "Ошибка");
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
            <form onSubmit={handleAddAccount} className="flex gap-4 items-end">
              <div className="space-y-2">
                <Label htmlFor="username">Instagram username</Label>
                <Input
                  id="username"
                  placeholder="salam_bro"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  required
                />
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
              <Button type="submit" disabled={adding}>
                {adding ? "Добавление..." : "Добавить"}
              </Button>
            </form>
          </CardContent>
        </Card>

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
