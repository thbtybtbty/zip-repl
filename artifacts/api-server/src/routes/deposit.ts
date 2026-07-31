import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getOrCreateUser, addBalance } from "../bot/utils.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ─── API key guard ─────────────────────────────────────────────────────────────
// Set DEPOSIT_SECRET in your .env / Wispbyte environment.
// The Roblox script must send: Authorization: Bearer <DEPOSIT_SECRET>
const DEPOSIT_SECRET = process.env["DEPOSIT_SECRET"] ?? "";

function authGuard(req: Request, res: Response): boolean {
  if (!DEPOSIT_SECRET) {
    res.status(503).json({ ok: false, error: "DEPOSIT_SECRET not configured on server" });
    return false;
  }
  const header = req.headers["authorization"] ?? "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== DEPOSIT_SECRET) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

// ─── POST /deposit ─────────────────────────────────────────────────────────────
// Body: { robloxUser: string, amount: number }
// Looks up which Discord account has linked that Roblox username, then credits them.
router.post("/deposit", async (req: Request, res: Response) => {
  if (!authGuard(req, res)) return;

  const { robloxUser, amount } = req.body as { robloxUser?: unknown; amount?: unknown };

  // ── Validate inputs ────────────────────────────────────────────────────────
  if (!robloxUser || typeof robloxUser !== "string" || robloxUser.trim() === "") {
    res.status(400).json({ ok: false, error: "robloxUser must be a non-empty string" });
    return;
  }

  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0 || !Number.isInteger(amountNum)) {
    res.status(400).json({ ok: false, error: "amount must be a positive integer" });
    return;
  }

  const robloxName = robloxUser.trim();

  // ── Look up which Discord account is linked to this Roblox username ────────
  const linked = await db
    .select({ id: usersTable.id, username: usersTable.username, balance: usersTable.balance })
    .from(usersTable)
    .where(eq(usersTable.robloxUsername, robloxName))
    .limit(1);

  if (!linked[0]) {
    logger.warn({ robloxUser: robloxName, amount: amountNum }, "Deposit rejected — Roblox username not linked");
    res.status(404).json({
      ok: false,
      error: `Roblox username "${robloxName}" is not linked to any Discord account. The player must run /link first.`,
    });
    return;
  }

  const discordId = linked[0].id;

  try {
    // Credit balance
    const newBalance = await addBalance(discordId, amountNum);

    // Track lifetime deposited amount
    await db
      .update(usersTable)
      .set({ deposited: sql`${usersTable.deposited} + ${amountNum}` })
      .where(eq(usersTable.id, discordId));

    logger.info(
      { robloxUser: robloxName, discordId, amount: amountNum, newBalance },
      "Mailbox deposit processed",
    );

    res.json({
      ok: true,
      robloxUser: robloxName,
      discordId,
      deposited: amountNum,
      newBalance,
    });
  } catch (err) {
    logger.error({ err, robloxUser: robloxName, discordId, amount: amountNum }, "Deposit route error");
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;
