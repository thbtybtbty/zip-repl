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
    // No secret configured — reject all requests for safety
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
router.post("/deposit", async (req: Request, res: Response) => {
  if (!authGuard(req, res)) return;

  const { discordId, amount } = req.body as { discordId?: unknown; amount?: unknown };

  // ── Validate inputs ────────────────────────────────────────────────────────
  if (!discordId || typeof discordId !== "string" || discordId.trim() === "") {
    res.status(400).json({ ok: false, error: "discordId must be a non-empty string" });
    return;
  }

  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0 || !Number.isInteger(amountNum)) {
    res.status(400).json({ ok: false, error: "amount must be a positive integer" });
    return;
  }

  const id = discordId.trim();

  try {
    // Create the user row if this is their first-ever deposit
    await getOrCreateUser(id, id); // username defaults to their ID until they interact

    // Credit balance
    const newBalance = await addBalance(id, amountNum);

    // Track lifetime deposited amount
    await db
      .update(usersTable)
      .set({ deposited: sql`${usersTable.deposited} + ${amountNum}` })
      .where(eq(usersTable.id, id));

    logger.info({ discordId: id, amount: amountNum, newBalance }, "Mailbox deposit processed");

    res.json({ ok: true, discordId: id, deposited: amountNum, newBalance });
  } catch (err) {
    logger.error({ err, discordId: id, amount: amountNum }, "Deposit route error");
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;
