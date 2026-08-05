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

// Persistent database on WispByte's /data volume
if (fs.existsSync("/data")) {
  process.env.DATABASE_PATH = "/data/bot.db";
  console.log("[boot] DB → /data/bot.db (persistent)");
} else {
  process.env.DATABASE_PATH = path.join(__dirname, "artifacts", "api-server", "bot.db");
  console.log("[boot] DB → " + process.env.DATABASE_PATH);
}

// Patch hardcoded Replit path in the built bundle
const distDir = path.join(__dirname, "artifacts", "api-server", "dist");
const botEntry = path.join(distDir, "index.mjs");
const botPatched = path.join(distDir, "index.patched.mjs");
const REPLIT_PATH = "/home/runner/workspace/artifacts/api-server/dist";

const src = fs.readFileSync(botEntry, "utf8");
if (src.includes(REPLIT_PATH)) {
  console.log("[boot] Patching hardcoded paths...");
  fs.writeFileSync(botPatched, src.replaceAll(REPLIT_PATH, distDir));
} else {
  fs.copyFileSync(botEntry, botPatched);
}

// Start the bot. The compiled bundle is included in the WispByte package, so
// the server does not need TypeScript, pnpm, esbuild, or a native addon.
const hasToken = !!process.env.DISCORD_BOT_TOKEN;
const hasClient = !!process.env.DISCORD_CLIENT_ID;
console.log("[boot] DISCORD_BOT_TOKEN set:", hasToken, "| DISCORD_CLIENT_ID set:", hasClient);
console.log("[boot] Starting bot (Node " + process.version + ")...");
const child = spawn(process.execPath, [botPatched], {
  stdio: "inherit",
  cwd: distDir,
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
