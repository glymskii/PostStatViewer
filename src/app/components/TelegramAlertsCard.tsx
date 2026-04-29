"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function TelegramAlertsCard() {
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [savingChat, setSavingChat] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      const data = await res.json();
      if (data.telegram_bot_token) setBotToken(data.telegram_bot_token);
      if (data.telegram_chat_id) setChatId(data.telegram_chat_id);
    } catch (err) {
      console.error("Failed to load Telegram settings:", err);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveSetting(
    key: string,
    value: string,
    setSaving: (v: boolean) => void
  ) {
    if (!value) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMessage({ kind: "err", text: data.error || "Не удалось сохранить" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage({ kind: "err", text: msg });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/notifications/test", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ kind: "ok", text: "Сообщение отправлено в Telegram" });
      } else {
        setMessage({ kind: "err", text: data.error || "Не удалось отправить" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage({ kind: "err", text: msg });
    } finally {
      setTesting(false);
    }
  }

  const canTest = Boolean(botToken && chatId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Telegram-алёрты</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Когда сбор падает или сессия протухает, бот пришлёт уведомление в
          Telegram. Создай бота через{" "}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            @BotFather
          </a>
          , отправь ему любое сообщение со своего аккаунта, потом получи свой
          chat_id через{" "}
          <a
            href="https://t.me/userinfobot"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            @userinfobot
          </a>
          .
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="bot-token">Bot token</Label>
            <Input
              id="bot-token"
              type="password"
              placeholder="123456:ABC-DEF..."
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              onBlur={() =>
                saveSetting("telegram_bot_token", botToken, setSavingToken)
              }
            />
            {savingToken && (
              <p className="text-xs text-muted-foreground">Сохранение...</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="chat-id">Chat ID</Label>
            <Input
              id="chat-id"
              placeholder="123456789"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              onBlur={() =>
                saveSetting("telegram_chat_id", chatId, setSavingChat)
              }
            />
            {savingChat && (
              <p className="text-xs text-muted-foreground">Сохранение...</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleTest} disabled={!canTest || testing}>
            {testing ? "Отправка..." : "Отправить тестовое сообщение"}
          </Button>
          {message && (
            <span
              className={`text-sm ${
                message.kind === "ok" ? "text-green-600" : "text-red-600"
              }`}
            >
              {message.text}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
