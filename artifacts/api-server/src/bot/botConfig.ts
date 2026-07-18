import path from "path";
import fs from "fs";

export interface ServerConfig {
  depositChannelId: string;
  withdrawChannelId: string;
  requestChannelId: string;
  robloxUser: string;
}

// Files live next to the built dist/ folder, i.e. artifacts/api-server/*.json
const ROOT        = process.cwd();
const CONFIG_PATH = path.join(ROOT, "server-config.json");
const ADMINS_PATH = path.join(ROOT, "admins.json");

export function getServerConfig(): ServerConfig | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as ServerConfig;
    if (!cfg.requestChannelId) return null;
    return cfg;
  } catch {
    return null;
  }
}

export function saveServerConfig(cfg: ServerConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}

export function isAdmin(userId: string): boolean {
  try {
    const { adminIds } = JSON.parse(fs.readFileSync(ADMINS_PATH, "utf-8")) as { adminIds: string[] };
    return Array.isArray(adminIds) && adminIds.includes(userId);
  } catch {
    return false;
  }
}
