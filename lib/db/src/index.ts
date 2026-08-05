import { drizzle } from "drizzle-orm/sqlite-proxy";
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import * as schema from "./schema";

// This database adapter deliberately uses SQLite compiled to WebAssembly.
// sql.js is SQLite compiled to WebAssembly, so it has no glibc, libstdc++, or
// native Node addon requirements and works on WispByte's older Linux image.
const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "bot.db");
const require = createRequire(import.meta.url);

let engine: SqlJsDatabase | null = null;
let sqlJs: SqlJsStatic | null = null;

function requireEngine(): SqlJsDatabase {
  if (!engine) throw new Error("Database has not been initialized");
  return engine;
}

function persist(): void {
  const current = requireEngine();
  const parent = path.dirname(DB_PATH);
  fs.mkdirSync(parent, { recursive: true });
  const temporaryPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(temporaryPath, Buffer.from(current.export()));
  fs.renameSync(temporaryPath, DB_PATH);
}

function valuesFor(params: unknown[]): (string | number | null | Uint8Array)[] {
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "string" || typeof value === "number") return value;
    if (value === null || value instanceof Uint8Array) return value;
    return String(value);
  });
}

class PreparedStatement {
  constructor(private readonly query: string) {}

  get(...params: unknown[]): Record<string, unknown> | undefined {
    const statement = requireEngine().prepare(this.query);
    try {
      statement.bind(valuesFor(params));
      return statement.step() ? statement.getAsObject() as Record<string, unknown> : undefined;
    } finally {
      statement.free();
    }
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    const statement = requireEngine().prepare(this.query);
    try {
      statement.bind(valuesFor(params));
      const rows: Record<string, unknown>[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as Record<string, unknown>);
      return rows;
    } finally {
      statement.free();
    }
  }

  run(...params: unknown[]): void {
    requireEngine().run(this.query, valuesFor(params));
    persist();
  }
}

class SqliteFacade {
  prepare(query: string): PreparedStatement {
    return new PreparedStatement(query);
  }

  exec(query: string): void {
    requireEngine().exec(query);
    persist();
  }

  // Kept for the existing shutdown contract. sql.js has no WAL checkpoint
  // because it operates in memory and writes an atomic exported database.
  checkpoint(): void {
    persist();
  }

  close(): void {
    if (engine) {
      persist();
      engine.close();
      engine = null;
    }
  }

  async query(
    query: string,
    params: unknown[],
    method: "run" | "all" | "values" | "get",
  ): Promise<{ rows: unknown }> {
    if (method === "run") {
      requireEngine().run(query, valuesFor(params));
      persist();
      return { rows: [] };
    }

    const statement = requireEngine().prepare(query);
    try {
      statement.bind(valuesFor(params));
      if (method === "get") {
        return { rows: statement.step() ? statement.getAsObject() : undefined };
      }

      if (method === "values") {
        const rows: unknown[][] = [];
        while (statement.step()) rows.push(statement.get());
        return { rows };
      }

      const rows: Record<string, unknown>[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as Record<string, unknown>);
      return { rows };
    } finally {
      statement.free();
    }
  }
}

export const sqlite = new SqliteFacade();

// Drizzle's SQLite proxy driver gives the rest of the project the same
// async query builder API while the low-level command handlers can continue
// using their existing prepare/get/all/run calls.
export const db = drizzle(
  (query, params, method) => sqlite.query(query, params, method),
  { schema },
);

export async function initDb(): Promise<void> {
  if (engine) return;

  sqlJs ??= await initSqlJs({
    locateFile: (file) => path.join(path.dirname(require.resolve("sql.js")), file),
  });

  const existing = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : undefined;
  engine = new sqlJs.Database(existing);

  // sql.js does not use native WAL files, but accepts this pragma for
  // compatibility with existing deployments and schema tooling.
  engine.run("PRAGMA journal_mode = WAL");

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

    CREATE TABLE IF NOT EXISTS bet_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT    NOT NULL,
      command    TEXT    NOT NULL,
      bet        INTEGER NOT NULL,
      net_delta  INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS invite_log (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      inviter_id          TEXT    NOT NULL,
      invited_id          TEXT    NOT NULL,
      invite_code         TEXT    NOT NULL,
      verified            INTEGER NOT NULL DEFAULT 0,
      rewarded            INTEGER NOT NULL DEFAULT 0,
      left_server         INTEGER NOT NULL DEFAULT 0,
      joined_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      verified_at         INTEGER,
      account_created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS promocodes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT    NOT NULL UNIQUE,
      reward      INTEGER NOT NULL,
      max_uses    INTEGER NOT NULL,
      uses        INTEGER NOT NULL DEFAULT 0,
      wager_req   INTEGER NOT NULL DEFAULT 0,
      deposit_req INTEGER NOT NULL DEFAULT 0,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS promocode_redemptions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT    NOT NULL,
      user_id     TEXT    NOT NULL,
      redeemed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(code, user_id)
    );
  `);

  const migrations = [
    `ALTER TABLE users ADD COLUMN deposited       INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN withdrawn       INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN wagered         INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN profit          INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN locked_balance  INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE bet_log ADD COLUMN admin_bet INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN roblox_username TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS users_roblox_username ON users(roblox_username) WHERE roblox_username IS NOT NULL`,
  ];
  for (const statement of migrations) {
    try {
      sqlite.exec(statement);
    } catch {
      // Existing production databases already have this column/index.
    }
  }

  persist();
}

export * from "./schema";