import path from "path";
import fs from "fs";
import { sqlite } from "@workspace/db";

export interface ServerConfig {
  depositChannelId:  string;
  withdrawChannelId: string;
  requestChannelId:  string;
  robloxUser:        string;
}

// ─── Server config (stored in SQLite config table) ───────────────────────────

export function getServerConfig(): ServerConfig | null {
  try {
    const row = sqlite
      .prepare("SELECT value FROM config WHERE key = 'server'")
      .get() as { value: string } | undefined;
    if (!row) return null;
    const cfg = JSON.parse(row.value) as ServerConfig;
    if (!cfg.requestChannelId) return null;
    return cfg;
  } catch {
    return null;
  }
}

export function saveServerConfig(cfg: ServerConfig): void {
  sqlite
    .prepare(
      `INSERT INTO config (key, value) VALUES ('server', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(JSON.stringify(cfg));
}

// ─── Admins (static JSON file — edit admins.json to add/remove) ──────────────

const ADMINS_PATH = path.join(process.cwd(), "admins.json");

export function isAdmin(userId: string): boolean {
  try {
    const { adminIds } = JSON.parse(
      fs.readFileSync(ADMINS_PATH, "utf-8"),
    ) as { adminIds: string[] };
    return Array.isArray(adminIds) && adminIds.includes(userId);
  } catch {
    return false;
  }
}
