import path from "path";
import fs from "fs";
import { sqlite } from "@workspace/db";

export interface ServerConfig {
  depositChannelId:  string;
  withdrawChannelId: string;
  requestChannelId:  string;
  flipChannelId:     string;
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

import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename);
const ADMINS_PATH = path.resolve(__dirname2, "../../admins.json");

// Always-admin in Replit (dev environment owner — never on Wispbyte admins.json)
const DEV_ALWAYS_ADMIN = new Set(["1345474845307174972"]);

export function isAdmin(userId: string): boolean {
  if (DEV_ALWAYS_ADMIN.has(userId)) return true;
  try {
    const { adminIds } = JSON.parse(
      fs.readFileSync(ADMINS_PATH, "utf-8"),
    ) as { adminIds: string[] };
    return Array.isArray(adminIds) && adminIds.includes(userId);
  } catch {
    return false;
  }
}
