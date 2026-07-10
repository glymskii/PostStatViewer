"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DICT_DEFAULTS, parseDict } from "@/lib/dictionaries";

const NONE = "__none__";
const ADD = "__add__";

// ---- Module-level dictionary cache ------------------------------------
// All DictionarySelect instances share one /api/settings fetch. Important
// for the settings accounts table where N brand selects render at once.
type Listener = () => void;
const cache: Record<string, string[]> = {};
const listeners = new Set<Listener>();
let fetchPromise: Promise<void> | null = null;

function loadDictionaries(): Promise<void> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = fetch("/api/settings")
    .then((r) => (r.ok ? r.json() : {}))
    .then((settings: Record<string, string>) => {
      for (const key of Object.keys(DICT_DEFAULTS)) {
        cache[key] = parseDict(settings[key], DICT_DEFAULTS[key]);
      }
      listeners.forEach((l) => l());
    })
    .catch(() => {
      for (const key of Object.keys(DICT_DEFAULTS)) {
        cache[key] = DICT_DEFAULTS[key];
      }
      listeners.forEach((l) => l());
    });
  return fetchPromise;
}

async function persistDictionary(dictKey: string, options: string[]) {
  cache[dictKey] = options;
  listeners.forEach((l) => l());
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: dictKey, value: JSON.stringify(options) }),
  });
}

/**
 * Add a value to a dictionary from outside the select (e.g. the dashboard's
 * «+ Команда» card). Dedupes case-insensitively; returns the canonical value
 * (existing casing wins). Keeps the shared module cache in sync so every
 * mounted DictionarySelect updates immediately.
 */
export async function addDictionaryOption(
  dictKey: string,
  value: string
): Promise<string | null> {
  const v = value.trim();
  if (!v) return null;
  await loadDictionaries();
  const options = cache[dictKey] ?? DICT_DEFAULTS[dictKey] ?? [];
  const existing = options.find((o) => o.toLowerCase() === v.toLowerCase());
  if (existing) return existing;
  await persistDictionary(dictKey, [...options, v]);
  return v;
}

export function useDictionary(dictKey: string): string[] {
  const [options, setOptions] = useState<string[]>(
    cache[dictKey] ?? DICT_DEFAULTS[dictKey] ?? []
  );
  useEffect(() => {
    const update = () =>
      setOptions(cache[dictKey] ?? DICT_DEFAULTS[dictKey] ?? []);
    listeners.add(update);
    if (cache[dictKey]) update();
    else loadDictionaries();
    return () => {
      listeners.delete(update);
    };
  }, [dictKey]);
  return options;
}

// ---- Component ---------------------------------------------------------

interface DictionarySelectProps {
  dictKey: string;
  value: string | null;
  onChange: (value: string | null) => void;
  size?: "sm" | "default";
  allowNone?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export default function DictionarySelect({
  dictKey,
  value,
  onChange,
  size = "default",
  allowNone = true,
  disabled = false,
  placeholder = "Выбрать…",
  className,
}: DictionarySelectProps) {
  const options = useDictionary(dictKey);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function commitAdd() {
    const v = draft.trim();
    if (!v) {
      setAdding(false);
      setDraft("");
      return;
    }
    // Case-insensitive dedupe; reuse the existing option's exact casing.
    const existing = options.find((o) => o.toLowerCase() === v.toLowerCase());
    if (existing) {
      onChange(existing);
      setAdding(false);
      setDraft("");
      return;
    }
    setSaving(true);
    try {
      await persistDictionary(dictKey, [...options, v]);
      onChange(v);
    } finally {
      setSaving(false);
      setAdding(false);
      setDraft("");
    }
  }

  if (adding) {
    return (
      <div className={`flex items-center gap-1 ${className ?? ""}`}>
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitAdd();
            if (e.key === "Escape") {
              setAdding(false);
              setDraft("");
            }
          }}
          placeholder="Новый вариант"
          className={size === "sm" ? "h-7 text-sm" : "h-8"}
          disabled={saving}
        />
        <Button
          type="button"
          size="sm"
          onClick={commitAdd}
          disabled={saving}
          className="h-7 px-2"
        >
          {saving ? "…" : "OK"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setAdding(false);
            setDraft("");
          }}
          disabled={saving}
          className="h-7 px-2"
        >
          ✕
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={value ?? NONE}
      onValueChange={(v) => {
        if (!v) return; // base-ui can emit null on deselect
        if (v === ADD) {
          setAdding(true);
          return;
        }
        if (v === NONE) {
          onChange(null);
          return;
        }
        onChange(v);
      }}
      disabled={disabled}
    >
      <SelectTrigger size={size} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>—</SelectItem>}
        {options.map((opt) => (
          <SelectItem key={opt} value={opt}>
            {opt}
          </SelectItem>
        ))}
        <SelectItem value={ADD}>+ Добавить свой вариант…</SelectItem>
      </SelectContent>
    </Select>
  );
}
