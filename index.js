// GemSpin Bet — WispByte entry point
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Load .env file if present (WispByte stores env vars there)
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  console.log("[boot] Loading .env...");
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

// WispByte runs the compiled bot as a production process. Replit can still
// override this explicitly when running a development/test instance.
process.env.NODE_ENV ??= "production";

// Persistent database on WispByte's /data volume. Respect an explicitly
// configured path first so hosts with a mounted volume can choose it.
if (process.env.DATABASE_PATH) {
  console.log("[boot] DB → " + process.env.DATABASE_PATH + " (configured)");
} else if (fs.existsSync("/data")) {
  process.env.DATABASE_PATH = "/data/bot.db";
  console.log("[boot] DB → /data/bot.db (persistent)");
} else {
  process.env.DATABASE_PATH = path.join(__dirname, "artifacts", "api-server", "bot.db");
  console.log("[boot] DB → " + process.env.DATABASE_PATH);
}

// Start the compiled bundle directly. The bundle resolves runtime assets from
// the package layout, so WispByte does not need a second patched copy of the
// 5+ MB bundle. Creating that extra file can fail on hosts with a full npm
// cache, inode quota, or container overlay even when the visible disk meter
// still reports free space.
const distDir = path.join(__dirname, "artifacts", "api-server", "dist");
const botEntry = path.join(distDir, "index.mjs");

// Start the bot. The compiled bundle is included in the WispByte package, so
// the server does not need TypeScript, pnpm, esbuild, or a native addon.
const hasToken = !!process.env.DISCORD_BOT_TOKEN;
const hasClient = !!process.env.DISCORD_CLIENT_ID;
console.log("[boot] DISCORD_BOT_TOKEN set:", hasToken, "| DISCORD_CLIENT_ID set:", hasClient);
console.log("[boot] Starting bot (Node " + process.version + ")...");
const child = spawn(process.execPath, [botEntry], {
  stdio: "inherit",
  cwd: distDir,
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
