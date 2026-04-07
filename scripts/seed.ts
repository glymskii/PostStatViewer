import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import { accounts, settings } from "../src/db/schema";

const dbPath = path.join(process.cwd(), "data", "poststat.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
const db = drizzle(sqlite);

// Seed initial account
db.insert(accounts)
  .values({
    username: "salam_bro",
    clientName: "Kex Group",
    reelsUrl: "https://www.instagram.com/salam_bro/reels/",
    isActive: true,
  })
  .onConflictDoNothing()
  .run();

// Seed default settings
db.insert(settings)
  .values({ key: "scrape_interval", value: "0 3 * * *" })
  .onConflictDoNothing()
  .run();

console.log("Seed completed: salam_bro account + default settings");
sqlite.close();
