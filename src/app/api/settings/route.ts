import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const allSettings = db.select().from(settings).all();
  const result: Record<string, string> = {};
  for (const s of allSettings) {
    result[s.key] = s.value;
  }
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { key, value } = body;

  if (!key || !value) {
    return NextResponse.json(
      { error: "key и value обязательны" },
      { status: 400 }
    );
  }

  // Upsert setting
  const existing = db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .get();

  if (existing) {
    db.update(settings)
      .set({ value })
      .where(eq(settings.key, key))
      .run();
  } else {
    db.insert(settings)
      .values({ key, value })
      .run();
  }

  // If updating scrape interval, restart scheduler
  if (key === "scrape_interval") {
    try {
      const { startScheduler } = await import("@/scraper/scheduler");
      startScheduler(value);
      console.log(`[api/settings] Scheduler restarted with: ${value}`);
    } catch (err) {
      console.error("[api/settings] Failed to restart scheduler:", err);
    }
  }

  return NextResponse.json({ key, value });
}
