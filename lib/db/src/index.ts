import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import * as schema from "./schema";

// DB file path — override via DATABASE_PATH env var for custom hosting.
// Default: bot.db next to wherever the process runs.
const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "bot.db");

export const sqlite = new Database(DB_PATH);

// WAL mode: faster writes, safer concurrent reads
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

/**
 * Create all tables if they don't exist yet.
 * Call once at startup — safe to call on every boot.
 */
export function initDb(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT    PRIMARY KEY,
      username    TEXT    NOT NULL,
      balance     INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS games (
      id          TEXT    PRIMARY KEY,
      user_id     TEXT    NOT NULL REFERENCES users(id),
      game_type   TEXT    NOT NULL,
      bet         INTEGER NOT NULL,
      state       TEXT    NOT NULL DEFAULT '{}',
      status      TEXT    NOT NULL DEFAULT 'active',
      multiplier  TEXT    NOT NULL DEFAULT '1.00',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrations — safe to run every boot; ALTER TABLE is a no-op if column exists
  const migrations = [
    `ALTER TABLE users ADD COLUMN deposited INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN withdrawn INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN wagered   INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN profit    INTEGER NOT NULL DEFAULT 0`,
  ];
  for (const stmt of migrations) {
    try { sqlite.exec(stmt); } catch { /* column already exists — ignore */ }
  }
}

export * from "./schema";
