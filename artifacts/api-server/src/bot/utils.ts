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

/** Track a completed bet: adds to lifetime wagered + updates net profit + writes to history log.
 *  Admin bets are flagged admin_bet=1 so /stats and /economy exclude them, but /history still shows them. */
export async function recordBet(userId: string, wagered: number, netDelta: number, command = "unknown"): Promise<void> {
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
}

/** Log a tip transfer for both sender and receiver history. */
export async function logTip(senderId: string, receiverId: string, amount: number): Promise<void> {
  await db.insert(betLogTable).values({ userId: senderId,   command: "tip-sent",     bet: amount, netDelta: -amount });
  await db.insert(betLogTable).values({ userId: receiverId, command: "tip-received", bet: amount, netDelta:  amount });
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
