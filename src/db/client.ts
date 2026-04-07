import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import * as schema from "./schema";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;
type SqliteDb = Database.Database;

let _sqlite: SqliteDb | null = null;
let _db: DrizzleDb | null = null;

function init(): { sqlite: SqliteDb; db: DrizzleDb } {
  if (_db && _sqlite) return { sqlite: _sqlite, db: _db };

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, "poststat.db");
  _sqlite = new Database(dbPath);
  _sqlite.pragma("journal_mode = WAL");
  _db = drizzle(_sqlite, { schema });
  return { sqlite: _sqlite, db: _db };
}

// Lazy proxies: opening SQLite only happens on first real access, not at
// module-import time. This keeps `next build` ("Collecting page data") from
// touching the DB and avoids SQLITE_BUSY between parallel build workers.
export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    const real = init().db as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
});

export const sqlite = new Proxy({} as SqliteDb, {
  get(_target, prop) {
    const real = init().sqlite as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
});
