export async function register() {
  // Only run scheduler on the server side
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const path = await import("path");
    const { db, sqlite } = await import("@/db/client");
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { settings } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { startScheduler } = await import("@/scraper/scheduler");

    // Apply pending Drizzle migrations (idempotent — tracked in __drizzle_migrations).
    // Bootstrap existing databases that predate migration tracking: if core tables
    // already exist but __drizzle_migrations does not, mark the baseline migration
    // as applied so migrate() only runs subsequent deltas.
    try {
      const hasTrackingTable = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'"
        )
        .get();
      const hasAccountsTable = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'"
        )
        .get();

      if (!hasTrackingTable && hasAccountsTable) {
        // Legacy DB: seed tracking table with baseline migration hash.
        const fs = await import("fs");
        const crypto = await import("crypto");
        const journalPath = path.join(
          process.cwd(),
          "src/db/migrations/meta/_journal.json"
        );
        const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
          entries: { idx: number; tag: string; when: number }[];
        };
        const baseline = journal.entries[0];
        const baselineSql = fs.readFileSync(
          path.join(process.cwd(), `src/db/migrations/${baseline.tag}.sql`),
          "utf-8"
        );
        const hash = crypto
          .createHash("sha256")
          .update(baselineSql)
          .digest("hex");
        sqlite
          .prepare(
            "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)"
          )
          .run();
        sqlite
          .prepare(
            "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)"
          )
          .run(hash, baseline.when);
        console.log(
          "[instrumentation] bootstrapped legacy DB with baseline migration"
        );
      }

      migrate(db, {
        migrationsFolder: path.join(process.cwd(), "src/db/migrations"),
      });
      console.log("[instrumentation] migrations applied");
    } catch (err) {
      console.error("[instrumentation] migration failed:", err);
      throw err;
    }

    // Get interval from settings
    const intervalSetting = db
      .select()
      .from(settings)
      .where(eq(settings.key, "scrape_interval"))
      .get();

    const cronExpression = intervalSetting?.value || "0 3 * * *";
    console.log(
      `[instrumentation] Starting scheduler with: ${cronExpression}`
    );
    startScheduler(cronExpression);
  }
}
