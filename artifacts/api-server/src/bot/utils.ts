import { db, usersTable, betLogTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { isAdmin } from "./botConfig.js";
import {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";

// ─── Constants ───────────────────────────────────────────────────────────────
export const COLORS = {
  primary: 0x5865f2,   // blurple
  success: 0x57f287,   // green
  danger:  0xed4245,   // red
  gold:    0xffd700,   // gold
  warning: 0xfee75c,   // yellow
  dark:    0x2b2d31,   // dark grey
};

export const GEM  = "💎";
export const BOMB = "💣";
export const QUESTION = "⬜";

// ─── Amount parsing ──────────────────────────────────────────────────────────
export function parseAmount(input: string): number | null {
  const str = input.toLowerCase().trim();

  // Allow comma-formatted plain numbers: 1,000,000 / 1,090,000 etc.
  const commaMatch = str.match(/^[\d,]+$/);
  if (commaMatch) {
    const num = parseInt(str.replace(/,/g, ""), 10);
    if (!isFinite(num) || num <= 0) return null;
    return num;
  }

  // Shorthand: 1m, 2.5b, 500k
  const match = str.match(/^(\d+(?:\.\d+)?)\s*([kmb]?)$/);
  if (!match) return null;

  const num = parseFloat(match[1]!);
  const suffix = match[2] ?? "";

  if (!isFinite(num) || num <= 0) return null;

  if (suffix === "b") return Math.floor(num * 1_000_000_000);
  if (suffix === "m") return Math.floor(num * 1_000_000);
  if (suffix === "k") return Math.floor(num * 1_000);
  return Math.floor(num);
}

export function formatAmount(amount: number): string {
  if (amount >= 1_000_000_000) {
    const v = amount / 1_000_000_000;
    return `${parseFloat(v.toFixed(2))}B`;
  }
  if (amount >= 1_000_000) {
    const v = amount / 1_000_000;
    return `${parseFloat(v.toFixed(2))}M`;
  }
  if (amount >= 1_000) {
    const v = amount / 1_000;
    return `${parseFloat(v.toFixed(2))}K`;
  }
  return amount.toLocaleString();
}

export function formatMult(mult: number): string {
  return `${mult.toFixed(2)}x`;
}

// ─── User helpers ────────────────────────────────────────────────────────────
export async function getOrCreateUser(userId: string, username: string) {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (rows[0]) return rows[0];

  await db.insert(usersTable).values({
    id: userId,
    username,
    balance: 0,
  });

  const created = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  return created[0]!;
}

export async function getBalance(userId: string): Promise<number> {
  const rows = await db
    .select({ balance: usersTable.balance })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return rows[0]?.balance ?? 0;
}

export async function addBalance(userId: string, delta: number): Promise<number> {
  const current = await getBalance(userId);
  const next = Math.max(0, current + delta);
  await db
    .update(usersTable)
    .set({ balance: next, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
  return next;
}

/** Add to a user's locked balance (bonus gems that must be wagered ≥1.8× before withdrawal). */
export async function addLocked(userId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await db
    .update(usersTable)
    .set({
      lockedBalance: sql`${usersTable.lockedBalance} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));
}

/** Hold the welcome bonus separately so an approved deposit can unlock only it. */
export async function setStarterLocked(userId: string, amount: number): Promise<void> {
  await db
    .update(usersTable)
    .set({
      starterLockedBalance: Math.max(0, amount),
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));
}

/** Release a user's welcome bonus after an approved deposit. */
export async function unlockStarterLocked(userId: string): Promise<void> {
  await setStarterLocked(userId, 0);
}

/** Decrease locked balance by up to `amount` (never below 0). Internal — called by recordBet. */
async function unlockWager(userId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await db
    .update(usersTable)
    .set({
      lockedBalance: sql`MAX(0, ${usersTable.lockedBalance} - ${amount})`,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));
}

/** Track a completed bet: adds to lifetime wagered + updates net profit + writes to history log.
 *  Pass `cashoutMultiplier` only for cashout-game WINS (mines/towers/hilo/crash/chickencrossing).
 *  If the multiplier is < 1.8× the wager won't unlock locked balance — losses and fixed-odds games
 *  always unlock (leave cashoutMultiplier undefined).
 *  Admin bets are flagged admin_bet=1 so /stats and /economy exclude them, but /history still shows them. */
export async function recordBet(
  userId: string,
  wagered: number,
  netDelta: number,
  command = "unknown",
  cashoutMultiplier?: number,
): Promise<void> {
  await db
    .update(usersTable)
    .set({
      wagered:   sql`${usersTable.wagered} + ${wagered}`,
      profit:    sql`${usersTable.profit}  + ${netDelta}`,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));
  const adminBet = isAdmin(userId) ? 1 : 0;
  await db.insert(betLogTable).values({ userId, command, bet: wagered, netDelta, adminBet });

  // Unlock locked balance if the wager qualifies:
  //   • No multiplier passed  → fixed-odds game or a loss → always unlocks
  //   • Cashout game win ≥1.8× → unlocks
  //   • Cashout game win <1.8× → does NOT unlock (low-risk cashout abuse prevention)
  const shouldUnlock = cashoutMultiplier === undefined || cashoutMultiplier >= 1.8;
  if (shouldUnlock) await unlockWager(userId, wagered);
}

/** Log a tip transfer for both sender and receiver history.
 *  Pass lockReceived=true to lock the received amount (must wager ≥1.8× before withdrawal). */
export async function logTip(senderId: string, receiverId: string, amount: number, lockReceived = false): Promise<void> {
  await db.insert(betLogTable).values({ userId: senderId,   command: "tip-sent",     bet: amount, netDelta: -amount });
  await db.insert(betLogTable).values({ userId: receiverId, command: "tip-received", bet: amount, netDelta:  amount });
  if (lockReceived) await addLocked(receiverId, amount);
}

/** Increment lifetime deposited counter (call on approved deposit). */
export async function addDeposited(userId: string, amount: number): Promise<void> {
  await db
    .update(usersTable)
    .set({
      deposited: sql`${usersTable.deposited} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));
  if (amount > 0) await unlockStarterLocked(userId);
}

/** Increment lifetime withdrawn counter (call on approved withdrawal). */
export async function addWithdrawn(userId: string, amount: number): Promise<void> {
  await db
    .update(usersTable)
    .set({
      withdrawn: sql`${usersTable.withdrawn} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));
}

// ─── Embed helpers ───────────────────────────────────────────────────────────
export function errorEmbed(message: string) {
  return new EmbedBuilder()
    .setColor(COLORS.danger)
    .setDescription(`❌  ${message}`);
}

export function successEmbed(title: string, description?: string) {
  const e = new EmbedBuilder().setColor(COLORS.success).setTitle(title);
  if (description) e.setDescription(description);
  return e;
}

// ─── Shared reply helpers ─────────────────────────────────────────────────────
export async function replyError(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  message: string,
) {
  const payload = { embeds: [errorEmbed(message)], ephemeral: true };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload);
  } else {
    await interaction.reply(payload);
  }
}
