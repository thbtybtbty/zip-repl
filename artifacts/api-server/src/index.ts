import app from "./app.js";
import { logger } from "./lib/logger.js";
import { startBot, destroyBot } from "./bot/index.js";
import { initDb, sqlite } from "@workspace/db";

// Ensure SQLite tables exist and migrations run (safe every boot)
initDb();

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Checkpoint + close the SQLite WAL so bot.db is a clean, self-contained file
// even if the host sends SIGTERM (WispByte, Replit, Docker, etc.).
async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down gracefully…");
  try {
    await destroyBot();
  } catch { /* ignore */ }
  try {
    sqlite.checkpoint();   // flush WAL → main DB file
    sqlite.close();
    logger.info("SQLite closed cleanly");
  } catch { /* ignore */ }
  process.exit(0);
}

process.on("SIGINT",  () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// ─── HTTP server ──────────────────────────────────────────────────────────────
app.listen(12428, "0.0.0.0", (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port: 12428, host: "0.0.0.0" }, "Server listening");
});

// ─── Discord bot ──────────────────────────────────────────────────────────────
startBot().catch((err) => {
  logger.error({ err }, "Failed to start Discord bot");
  process.exit(1);
});
