"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Platform = "instagram" | "threads" | "tiktok";

type SessionState = "ok" | "expired" | "missing";

interface PlatformStatus {
  state: SessionState;
  hasFile: boolean;
  hasSessionId: boolean;
  cookieExpiresAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: "Instagram",
  threads: "Threads",
  tiktok: "TikTok",
};

const PLATFORM_DOMAIN: Record<Platform, string> = {
  instagram: "instagram.com",
  threads: "threads.com",
  tiktok: "tiktok.com",
};

const STATE_BADGE: Record<
  SessionState,
  { label: string; className: string }
> = {
  ok: { label: "Сессия активна", className: "bg-green-600 hover:bg-green-700" },
  expired: { label: "Сессия истекла", className: "bg-red-600 hover:bg-red-700" },
  missing: { label: "Сессия не загружена", className: "bg-gray-500" },
};

function formatDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SessionsCard() {
  const [statuses, setStatuses] = useState<Record<
    Platform,
    PlatformStatus
  > | null>(null);
  const [busy, setBusy] = useState<Platform | null>(null);
  const [message, setMessage] = useState<{
    platform: Platform;
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const fileRefs = {
    instagram: useRef<HTMLInputElement>(null),
    threads: useRef<HTMLInputElement>(null),
    tiktok: useRef<HTMLInputElement>(null),
  };

  async function load() {
    try {
      const res = await fetch("/api/sessions/status");
      if (!res.ok) return;
      setStatuses(await res.json());
    } catch (err) {
      console.error("Failed to load session status:", err);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleUpload(platform: Platform, file: File) {
    setBusy(platform);
    setMessage(null);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setMessage({
          platform,
          kind: "err",
          text: "Файл не является валидным JSON",
        });
        return;
      }
      // Cookie-Editor exports an array directly. Some other tools wrap it
      // in { cookies: [...] }. Accept both.
      const cookies = Array.isArray(parsed)
        ? parsed
        : (parsed as { cookies?: unknown[] }).cookies;
      if (!Array.isArray(cookies)) {
        setMessage({
          platform,
          kind: "err",
          text: "JSON должен быть массивом cookies (или объектом { cookies: [...] })",
        });
        return;
      }

      const res = await fetch("/api/sessions/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, cookies }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({
          platform,
          kind: "err",
          text: data.error || "Не удалось загрузить cookies",
        });
        return;
      }

      setMessage({
        platform,
        kind: "ok",
        text: `Сессия загружена (${data.cookieCount} cookies). ${
          data.sessionidExpires
            ? "Истекает: " + formatDate(data.sessionidExpires)
            : ""
        }`,
      });
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage({ platform, kind: "err", text: msg });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Сессии браузера</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Если автоматический логин падает, экспортируй cookies из обычного Chrome
          (расширение{" "}
          <a
            href="https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Cookie-Editor
          </a>
          {" "}— зайди на сайт, открой расширение, нажми <em>Export → JSON</em>) и
          загрузи файл здесь. Бот будет использовать эти cookies вместо
          автоматического логина.
        </p>

        {(["instagram", "threads"] as Platform[]).map((platform) => {
          const status = statuses?.[platform];
          const badge = status ? STATE_BADGE[status.state] : null;
          const ref = fileRefs[platform];
          return (
            <div
              key={platform}
              className="flex flex-col gap-2 border rounded-lg p-4"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-base">
                    {PLATFORM_LABEL[platform]}
                  </h3>
                  <span className="text-xs text-muted-foreground font-mono">
                    {PLATFORM_DOMAIN[platform]}
                  </span>
                  {badge && (
                    <Badge className={badge.className}>{badge.label}</Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    ref={ref}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUpload(platform, file);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    onClick={() => ref.current?.click()}
                    disabled={busy === platform}
                    variant={
                      status?.state === "ok" ? "outline" : "default"
                    }
                  >
                    {busy === platform
                      ? "Загрузка..."
                      : status?.state === "ok"
                      ? "Заменить"
                      : "Загрузить cookies"}
                  </Button>
                </div>
              </div>

              {status && (
                <dl className="text-xs text-muted-foreground grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-2">
                  <div>
                    <dt className="inline">Cookie истекает:</dt>{" "}
                    <dd className="inline font-mono">
                      {formatDate(status.cookieExpiresAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Последний успешный сбор:</dt>{" "}
                    <dd className="inline font-mono">
                      {formatDate(status.lastSuccessAt)}
                    </dd>
                  </div>
                  {status.lastError && status.state !== "ok" && (
                    <div className="sm:col-span-2 text-red-600 truncate">
                      <dt className="inline">Последняя ошибка:</dt>{" "}
                      <dd className="inline">{status.lastError}</dd>
                    </div>
                  )}
                </dl>
              )}

              {message?.platform === platform && (
                <p
                  className={`text-sm mt-1 ${
                    message.kind === "ok" ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {message.text}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
