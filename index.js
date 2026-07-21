// GemSpin Bet — WispByte entry point
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Try to use Node 20 via nvm if we're on an older version
const major = parseInt(process.version.slice(1));
if (major < 20) {
  const nvmDir = process.env.NVM_DIR || path.join(process.env.HOME || "/root", ".nvm");
  const nvmSh = path.join(nvmDir, "nvm.sh");
  if (fs.existsSync(nvmSh)) {
    console.log("[boot] Node " + process.version + " detected, switching to Node 20 via nvm...");
    try {
      const node20 = execSync(
        `bash -c "source ${nvmSh} && nvm install 20 --no-progress && nvm which 20"`,
        { encoding: "utf8", shell: true }
      ).trim();
      if (node20 && fs.existsSync(node20)) {
        console.log("[boot] Re-exec with " + node20);
        const child = spawn(node20, [__filename], {
          stdio: "inherit",
          env: { ...process.env, _SKIP_NVM_CHECK: "1" },
        });
        child.on("exit", (code) => process.exit(code ?? 0));
        return;
      }
    } catch (e) {
      console.log("[boot] nvm switch failed, continuing with " + process.version);
    }
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

// Pick a compatible better-sqlite3 version based on Node version
const bsq3Version = major >= 20 ? "12.11.1" : "11.9.1";

// Install better-sqlite3 if missing or wrong version
const bsq3 = path.join(__dirname, "node_modules", "better-sqlite3");
const bsq3Pkg = path.join(bsq3, "package.json");
let installedVersion = null;
try { installedVersion = require(bsq3Pkg).version; } catch (_) {}

if (installedVersion !== bsq3Version) {
  console.log("[boot] Installing better-sqlite3@" + bsq3Version + " (Node " + process.version + ")...");
  execSync(`npm install better-sqlite3@${bsq3Version} --no-save`, {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, npm_config_libc: "glibc" },
    cwd: __dirname,
  });
}

// Start the pre-built bot
const botEntry = path.join(__dirname, "artifacts", "api-server", "dist", "index.mjs");
console.log("[boot] Starting bot (Node " + process.version + ")...");
const child = spawn(process.execPath, [botEntry], {
  stdio: "inherit",
  cwd: path.dirname(botEntry),
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
