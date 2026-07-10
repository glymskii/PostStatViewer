/**
 * Period presets shared by the dashboard, team page, and report page.
 * Dates are LOCAL-timezone YYYY-MM-DD (what the operator means by "this
 * month"); the API compares them against UTC timestamps — documented
 * one-day skew for late-evening UTC scrapes is accepted.
 */

export type Preset =
  | "this_month"
  | "last_month"
  | "7"
  | "30"
  | "90"
  | "custom";

export const PRESET_LABELS: Record<Preset, string> = {
  this_month: "Этот месяц",
  last_month: "Прошлый месяц",
  "7": "7 дней",
  "30": "30 дней",
  "90": "90 дней",
  custom: "Произвольный",
};

/** Local-timezone YYYY-MM-DD (avoids the UTC shift of toISOString). */
export function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function presetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  if (preset === "this_month") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: localDate(first), to: localDate(now) };
  }
  if (preset === "last_month") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: localDate(first), to: localDate(last) };
  }
  if (preset === "7" || preset === "30" || preset === "90") {
    const days = parseInt(preset, 10);
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    return { from: localDate(from), to: localDate(now) };
  }
  return { from: localDate(now), to: localDate(now) };
}
