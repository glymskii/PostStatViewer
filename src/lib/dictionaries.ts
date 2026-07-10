/**
 * Editable option dictionaries (brands, teams) stored in the settings KV
 * table as JSON string arrays. Until a user adds a custom option, the
 * defaults below are served; the first custom add persists the full merged
 * list, and from then on the stored list is authoritative (which also
 * allows removing options later by editing the setting value directly).
 */

export const DICT_BRANDS_KEY = "dict_brands";
export const DICT_TEAMS_KEY = "dict_teams";

export const DEFAULT_BRANDS = [
  "Salam bro",
  "Just doner",
  "Doner na Abaya",
  "Burger na Abaya",
];

export const DEFAULT_TEAMS = [
  "Сценаристы",
  "Жади",
  "Биржан",
  "Блогеры",
  "Бартерники",
  "Продакшен",
];

export const DICT_DEFAULTS: Record<string, string[]> = {
  [DICT_BRANDS_KEY]: DEFAULT_BRANDS,
  [DICT_TEAMS_KEY]: DEFAULT_TEAMS,
};

/** Parse a stored dictionary value; fall back on malformed/missing data. */
export function parseDict(
  raw: string | undefined | null,
  fallback: string[]
): string[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every((x) => typeof x === "string") &&
      parsed.length > 0
    ) {
      return parsed;
    }
    return fallback;
  } catch {
    return fallback;
  }
}
