import * as XLSX from "xlsx";

type Platform = "instagram" | "threads" | "tiktok";

const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  threads: "Threads",
  tiktok: "TikTok",
};

const PLATFORM_ITEM_LABEL: Record<Platform, string> = {
  instagram: "Reel",
  threads: "Пост",
  tiktok: "Видео",
};

export interface ExportSnapshot {
  viewCount: number | null;
  likeCount: number | null;
  scrapedAt: string;
}

export interface ExportPost {
  id?: number;
  externalId: string;
  postUrl: string;
  caption: string | null;
  thumbnailUrl?: string | null;
  team?: string | null;
  firstSeenAt: string;
  currentViews: number | null;
  currentLikes: number | null;
  currentComments?: number | null;
  snapshots: ExportSnapshot[];
}

export interface ExportAccount {
  username: string;
  clientName: string;
  brand?: string | null;
  platform: Platform;
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
 * Build a workbook with three sheets:
 *   1. Сводка     — high-level account stats and export metadata.
 *   2. Посты      — one row per post (current state, sorted by views desc).
 *   3. Динамика   — one row per snapshot (post_id × date), for time-series charts.
 *
 * Triggers a browser download. Filename: {platform}-{username}-{YYYY-MM-DD}.xlsx
 */
export function exportAccountToExcel(opts: {
  account: ExportAccount;
  posts: ExportPost[];
  periodDays: number;
}): void {
  const { account, posts, periodDays } = opts;
  const itemLabel = PLATFORM_ITEM_LABEL[account.platform];

  const totalViews = posts.reduce(
    (sum, p) => sum + (p.currentViews ?? 0),
    0
  );
  const totalLikes = posts.reduce(
    (sum, p) => sum + (p.currentLikes ?? 0),
    0
  );
  const avgViews = posts.length > 0 ? Math.round(totalViews / posts.length) : 0;
  const avgLikes = posts.length > 0 ? Math.round(totalLikes / posts.length) : 0;
  const commentPosts = posts.filter((p) => p.currentComments != null);
  const totalComments =
    commentPosts.length > 0
      ? commentPosts.reduce((sum, p) => sum + (p.currentComments ?? 0), 0)
      : null;

  // --- Sheet 1: Summary
  const summaryRows: (string | number)[][] = [
    ["Аккаунт", `@${account.username}`],
    ["Клиент", account.clientName],
    ["Бренд", account.brand ?? "—"],
    ["Платформа", PLATFORM_LABELS[account.platform]],
    ["Период (дней)", periodDays],
    ["Дата выгрузки", formatDateTime(new Date().toISOString())],
    [],
    ["Всего постов", posts.length],
    ["Сумма просмотров", totalViews],
    ["Средние просмотры", avgViews],
    ["Сумма лайков", totalLikes],
    ["Средние лайки", avgLikes],
    ["Сумма комментариев", totalComments ?? "—"],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  // Wider first column.
  summarySheet["!cols"] = [{ wch: 22 }, { wch: 30 }];

  // --- Sheet 2: Posts
  const sortedPosts = [...posts].sort(
    (a, b) => (b.currentViews ?? 0) - (a.currentViews ?? 0)
  );

  const postsHeader = [
    "Ранг",
    "ID",
    "Тип",
    "Команда",
    "Описание",
    "Просмотры",
    "Лайки",
    "Комментарии",
    "Замеров",
    "Первая фиксация",
    "Последний замер",
    "Ссылка",
  ];
  const postsRows = sortedPosts.map((p, idx) => {
    const lastSnapshotAt =
      p.snapshots.length > 0
        ? p.snapshots[p.snapshots.length - 1].scrapedAt
        : null;
    return [
      idx + 1,
      p.externalId,
      itemLabel,
      p.team ?? "",
      p.caption || "",
      p.currentViews ?? "",
      p.currentLikes ?? "",
      p.currentComments ?? "",
      p.snapshots.length,
      formatDateTime(p.firstSeenAt),
      formatDateTime(lastSnapshotAt),
      p.postUrl,
    ];
  });
  const postsSheet = XLSX.utils.aoa_to_sheet([postsHeader, ...postsRows]);
  postsSheet["!cols"] = [
    { wch: 6 }, // Ранг
    { wch: 16 }, // ID
    { wch: 8 }, // Тип
    { wch: 14 }, // Команда
    { wch: 60 }, // Описание
    { wch: 12 }, // Просмотры
    { wch: 10 }, // Лайки
    { wch: 12 }, // Комментарии
    { wch: 10 }, // Замеров
    { wch: 18 }, // Первая фиксация
    { wch: 18 }, // Последний замер
    { wch: 60 }, // Ссылка
  ];

  // --- Sheet 3: Snapshots (time-series)
  const snapshotsHeader = [
    "ID поста",
    "Дата замера",
    "Время замера",
    "Просмотры",
    "Лайки",
  ];
  const snapshotRows: (string | number)[][] = [];
  for (const post of sortedPosts) {
    for (const snap of post.snapshots) {
      snapshotRows.push([
        post.externalId,
        formatDate(snap.scrapedAt),
        formatDateTime(snap.scrapedAt),
        snap.viewCount ?? "",
        snap.likeCount ?? "",
      ]);
    }
  }
  const snapshotsSheet = XLSX.utils.aoa_to_sheet([
    snapshotsHeader,
    ...snapshotRows,
  ]);
  snapshotsSheet["!cols"] = [
    { wch: 16 },
    { wch: 12 },
    { wch: 18 },
    { wch: 12 },
    { wch: 10 },
  ];

  // --- Assemble workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Сводка");
  XLSX.utils.book_append_sheet(workbook, postsSheet, "Посты");
  XLSX.utils.book_append_sheet(workbook, snapshotsSheet, "Динамика");

  // --- Filename
  const today = new Date().toISOString().slice(0, 10);
  const filename = `${account.platform}-${account.username}-${today}.xlsx`;

  XLSX.writeFile(workbook, filename);
}
