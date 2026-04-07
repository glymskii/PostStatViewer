import { NextRequest, NextResponse } from "next/server";
import {
  runScrapeForAccount,
  runScrapeForAllAccounts,
  isScrapeRunning,
} from "@/scraper/runner";
import { db } from "@/db/client";
import { scrapeRuns } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function POST(request: NextRequest) {
  if (isScrapeRunning()) {
    return NextResponse.json(
      { error: "Сбор данных уже выполняется" },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { accountId } = body;

  // Run in background, don't await
  if (accountId) {
    runScrapeForAccount(parseInt(accountId));
  } else {
    runScrapeForAllAccounts();
  }

  return NextResponse.json({ message: "Сбор данных запущен" });
}

export async function GET() {
  // Return recent scrape runs
  const runs = db
    .select()
    .from(scrapeRuns)
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(20)
    .all();

  return NextResponse.json({
    isRunning: isScrapeRunning(),
    runs,
  });
}
