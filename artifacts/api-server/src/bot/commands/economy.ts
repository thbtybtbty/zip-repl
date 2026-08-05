import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { sqlite } from "@workspace/db";
import { COLORS, formatAmount } from "../utils.js";
import { isAdmin } from "../botConfig.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function todayStartSec(): number {
  const now = new Date();
  return Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000,
  );
}

function signedAmount(n: number): string {
  if (n === 0) return `0 💎`;
  return n > 0 ? `+${formatAmount(n)} 💎` : `-${formatAmount(Math.abs(n))} 💎`;
}

interface EconomyData {
  totalBalance:    number;
  houseProfit:     number;
  todayProfit:     number;
  todayGrants:     number;
  gamesPlayed:     number;
  avgBet:          number;
  largestWin:      number;
  largestLoss:     number;
}

// These low-level queries are synchronous against the in-memory WASM SQLite
// database; each write is persisted by the database facade.
// "admin-grant" rows encode promos/manual grants: bet = amount, net_delta = -amount.
// House game profit = -SUM(net_delta) for game bets (tips & grants excluded).
// Today's net profit already deducts grants given today so free bets that lose
// don't inflate the figure.
function fetchEconomy(): EconomyData {
  const row = <(q: string, ...p: unknown[]) => Record<string, number>>(
    (q, ...p) => (sqlite.prepare(q).get(...p) as Record<string, number>) ?? {}
  );

  const { totalBalance } = row(
    `SELECT CAST(COALESCE(SUM(balance),0) AS INTEGER) AS totalBalance FROM users`,
  );

  const { houseProfit } = row(
    `SELECT CAST(COALESCE(-SUM(net_delta),0) AS INTEGER) AS houseProfit
     FROM bet_log
     WHERE command NOT IN ('tip-sent','tip-received','admin-grant')
       AND admin_bet = 0`,
  );

  const today = todayStartSec();

  const { todayGameProfit } = row(
    `SELECT CAST(COALESCE(-SUM(net_delta),0) AS INTEGER) AS todayGameProfit
     FROM bet_log
     WHERE command NOT IN ('tip-sent','tip-received','admin-grant')
       AND admin_bet = 0
       AND created_at >= ?`,
    today,
  );

  // Grants given today (positive amount = house expense)
  const { todayGrants } = row(
    `SELECT CAST(COALESCE(SUM(bet),0) AS INTEGER) AS todayGrants
     FROM bet_log
     WHERE command = 'admin-grant' AND created_at >= ?`,
    today,
  );

  const todayProfit = (todayGameProfit ?? 0) - (todayGrants ?? 0);

  const { gamesPlayed } = row(
    `SELECT COUNT(*) AS gamesPlayed
     FROM bet_log
     WHERE command NOT IN ('tip-sent','tip-received','admin-grant')
       AND admin_bet = 0`,
  );

  const { avgBet } = row(
    `SELECT CAST(COALESCE(AVG(bet),0) AS INTEGER) AS avgBet
     FROM bet_log
     WHERE command NOT IN ('tip-sent','tip-received','admin-grant')
       AND admin_bet = 0`,
  );

  const { largestWin } = row(
    `SELECT CAST(COALESCE(MAX(net_delta),0) AS INTEGER) AS largestWin
     FROM bet_log
     WHERE command NOT IN ('tip-sent','tip-received','admin-grant')
       AND admin_bet = 0
       AND net_delta > 0`,
  );

  const { largestLoss } = row(
    `SELECT CAST(COALESCE(MIN(net_delta),0) AS INTEGER) AS largestLoss
     FROM bet_log
     WHERE command NOT IN ('tip-sent','tip-received','admin-grant')
       AND admin_bet = 0
       AND net_delta < 0`,
  );

  return {
    totalBalance:  totalBalance  ?? 0,
    houseProfit:   houseProfit   ?? 0,
    todayProfit,
    todayGrants:   todayGrants   ?? 0,
    gamesPlayed:   gamesPlayed   ?? 0,
    avgBet:        avgBet        ?? 0,
    largestWin:    largestWin    ?? 0,
    largestLoss:   largestLoss   ?? 0,
  };
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("economy")
  .setDescription("[Admin] Server economy overview");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isAdmin(interaction.user.id)) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.danger).setDescription("❌  Admin only.")],
    });
    return;
  }

  const d = fetchEconomy();

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle("💰 Economy Overview")
    .addFields(
      {
        name:   "💎 Money in Circulation",
        value:  `**${formatAmount(d.totalBalance)} 💎**`,
        inline: true,
      },
      {
        name:   "🏦 House Profit (All Time)",
        value:  signedAmount(d.houseProfit),
        inline: true,
      },
      {
        name:   "📅 Today's Net Profit",
        value:  `${signedAmount(d.todayProfit)}\n-# Grants given today (${formatAmount(d.todayGrants)} 💎) already deducted`,
        inline: false,
      },
      {
        name:   "🎮 Games Played",
        value:  `**${d.gamesPlayed.toLocaleString()}**`,
        inline: true,
      },
      {
        name:   "📊 Average Bet",
        value:  `**${formatAmount(d.avgBet)} 💎**`,
        inline: true,
      },
      {
        name:   "\u200b",
        value:  "\u200b",
        inline: true,
      },
      {
        name:   "🏆 Largest Player Win",
        value:  d.largestWin > 0 ? `**+${formatAmount(d.largestWin)} 💎**` : "—",
        inline: true,
      },
      {
        name:   "💥 Largest Player Loss",
        value:  d.largestLoss < 0 ? `**-${formatAmount(Math.abs(d.largestLoss))} 💎**` : "—",
        inline: true,
      },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
