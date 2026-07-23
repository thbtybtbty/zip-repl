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

// Resolve relative to this file so the path is correct regardless of cwd.
// In the compiled dist the file lives at dist/index.mjs, one level above src/,
// so we go up two directories from __dirname-equivalent to reach the project
// root where admins.json lives (artifacts/api-server/admins.json).
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename);
const ADMINS_PATH = path.resolve(__dirname2, "../../admins.json");

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
