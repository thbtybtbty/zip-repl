// GemSpin Bet — WispByte entry point
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Persistent database on WispByte's /data volume
if (fs.existsSync("/data")) {
  process.env.DATABASE_PATH = "/data/bot.db";
  console.log("[boot] DB → /data/bot.db (persistent)");
} else {
  process.env.DATABASE_PATH = path.join(__dirname, "artifacts", "api-server", "bot.db");
  console.log("[boot] DB → " + process.env.DATABASE_PATH);
}

// Install better-sqlite3 if missing (downloads prebuilt binary, no compilation needed)
const bsq3 = path.join(__dirname, "node_modules", "better-sqlite3");
if (!fs.existsSync(bsq3)) {
  console.log("[boot] Installing better-sqlite3 (prebuilt)...");
  execSync("npm install better-sqlite3@12.11.1 --no-save", {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, npm_config_libc: "glibc" },
    cwd: __dirname,
  });
}

// The built bot lives here
const botEntry = path.join(__dirname, "artifacts", "api-server", "dist", "index.mjs");

console.log("[boot] Starting bot (Node " + process.version + ")...");
const child = spawn(process.execPath, [botEntry], {
  stdio: "inherit",
  cwd: path.dirname(botEntry),
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
