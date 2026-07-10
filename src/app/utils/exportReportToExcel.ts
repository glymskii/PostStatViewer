import * as XLSX from "xlsx";

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  threads: "Threads",
  tiktok: "TikTok",
};

const NO_BRAND = "Без бренда";
const NO_TEAM = "Без команды";

export interface ReportPost {
  postId: number;
  accountId: number;
  platform: string;
  username: string;
  clientName: string;
  brand: string | null;
  team: string | null;
  postUrl: string;
  caption: string | null;
  firstSeenAt: string;
  views: number | null;
  likes: number | null;
}

export interface ReportGroup {
  brand: string | null;
  team: string | null;
  postsCount: number;
  totalViews: number;
  avgViews: number;
  totalLikes: number;
  posts: ReportPost[];
}

export interface ReportTotals {
  postsCount: number;
  totalViews: number;
  avgViews: number;
  totalLikes: number;
}

function formatDateTime(s: string | null | undefined): string {
  if (!s) return "";
  return new Date(s).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(s: string | null | undefined): string {
  if (!s) return "";
  return new Date(s).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Build a two-sheet report workbook that mirrors the on-screen report
 * (already filtered by brand/team on the client):
 *   1. Сводка — one row per (brand × team) group + a totals row.
 *   2. Посты  — flat list of every post in the (filtered) groups.
 *
 * Triggers a browser download. Filename: report-{from}_{to}.xlsx
 */
export function exportReportToExcel(opts: {
  from: string;
  to: string;
  groups: ReportGroup[];
  totals: ReportTotals;
}): void {
  const { from, to, groups, totals } = opts;

  // --- Sheet 1: Summary (groups)
  const summaryHeader = [
    "Бренд",
    "Команда",
    "Постов",
    "Просмотры",
    "Ср. просмотры",
    "Лайки",
  ];
  const summaryRows: (string | number)[][] = [
    ["Отчёт за период", `${formatDate(from)} — ${formatDate(to)}`],
    ["Дата выгрузки", formatDateTime(new Date().toISOString())],
    [],
    summaryHeader,
    ...groups.map((g) => [
      g.brand ?? NO_BRAND,
      g.team ?? NO_TEAM,
      g.postsCount,
      g.totalViews,
      g.avgViews,
      g.totalLikes,
    ]),
    [
      "ИТОГО",
      "",
      totals.postsCount,
      totals.totalViews,
      totals.avgViews,
      totals.totalLikes,
    ],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [
    { wch: 20 }, // Бренд
    { wch: 18 }, // Команда
    { wch: 10 }, // Постов
    { wch: 14 }, // Просмотры
    { wch: 14 }, // Ср. просмотры
    { wch: 12 }, // Лайки
  ];

  // --- Sheet 2: Posts (flat)
  const postsHeader = [
    "Бренд",
    "Команда",
    "Платформа",
    "Аккаунт",
    "Клиент",
    "Описание",
    "Просмотры",
    "Лайки",
    "Первая фиксация",
    "Ссылка",
  ];
  const postRows: (string | number)[][] = [];
  for (const group of groups) {
    for (const post of group.posts) {
      postRows.push([
        post.brand ?? NO_BRAND,
        post.team ?? NO_TEAM,
        PLATFORM_LABELS[post.platform] ?? post.platform,
        `@${post.username}`,
        post.clientName,
        post.caption ?? "",
        post.views ?? "",
        post.likes ?? "",
        formatDateTime(post.firstSeenAt),
        post.postUrl,
      ]);
    }
  }
  const postsSheet = XLSX.utils.aoa_to_sheet([postsHeader, ...postRows]);
  postsSheet["!cols"] = [
    { wch: 18 }, // Бренд
    { wch: 16 }, // Команда
    { wch: 10 }, // Платформа
    { wch: 18 }, // Аккаунт
    { wch: 18 }, // Клиент
    { wch: 50 }, // Описание
    { wch: 12 }, // Просмотры
    { wch: 10 }, // Лайки
    { wch: 18 }, // Первая фиксация
    { wch: 55 }, // Ссылка
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Сводка");
  XLSX.utils.book_append_sheet(workbook, postsSheet, "Посты");

  XLSX.writeFile(workbook, `report-${from}_${to}.xlsx`);
}
