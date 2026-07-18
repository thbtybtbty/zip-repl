import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from "discord.js";
import {
  COLORS,
  parseAmount,
  formatAmount,
  getOrCreateUser,
  addBalance,
  errorEmbed,
} from "../utils.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Session store ────────────────────────────────────────────────────────────
interface CrashSession {
  cashedOut:   boolean;
  cashoutMult: number;
  currentMult: number;
  done:        boolean;
}

export const activeSessions = new Map<string, CrashSession>();

// ─── Crash point generation ───────────────────────────────────────────────────
// ~4% house edge. 4% of games crash immediately at 1.00x.
function generateCrashPoint(): number {
  const r = Math.random();
  if (r < 0.04) return 1.00;
  const raw = 0.99 / (1 - r);
  return Math.min(Math.floor(raw * 100) / 100, 1000);
}

// ─── Multiplier tick ──────────────────────────────────────────────────────────
// Increments accelerate as the multiplier grows.
function nextMult(current: number): number {
  let step: number;
  if (current < 2)   step = 0.05;
  else if (current < 5)  step = 0.10;
  else if (current < 10) step = 0.25;
  else if (current < 50) step = 0.50;
  else                   step = 2.00;
  return Math.round((current + step) * 100) / 100;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function multColor(mult: number): string {
  if (mult < 1.5) return "🟢";
  if (mult < 3)   return "🟡";
  if (mult < 7)   return "🟠";
  return "🔴";
}

// 20-char progress bar. Fills toward a soft cap of 20x for visual effect.
function buildBar(mult: number): string {
  const pct    = Math.min((mult - 1) / 19, 1);
  const filled = Math.round(pct * 20);
  return `[${"█".repeat(filled)}${"░".repeat(20 - filled)}]`;
}

function cashoutRow(userId: string, disabled = false) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`crash_cash_${userId}`)
      .setLabel("💸  Cash Out")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("crash")
  .setDescription("Watch the multiplier climb — cash out before it crashes!")
  .addStringOption((opt) =>
    opt
      .setName("amount")
      .setDescription("Bet amount (e.g. 1m, 2.5b)")
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const amountStr = interaction.options.getString("amount", true);
  const amount    = parseAmount(amountStr);

  if (!amount || amount <= 0)
    return interaction.editReply({
      embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")],
    });

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);

  if (user.balance < amount)
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
    });

  if (activeSessions.has(interaction.user.id))
    return interaction.editReply({
      embeds: [errorEmbed("You already have an active Crash game. Cash out first!")],
    });

  // Deduct bet upfront
  await addBalance(interaction.user.id, -amount);

  const crashPoint = generateCrashPoint();
  const session: CrashSession = {
    cashedOut:   false,
    cashoutMult: 0,
    currentMult: 1.00,
    done:        false,
  };
  activeSessions.set(interaction.user.id, session);

  const TICK_MS = 600;

  try {
    // ── If game crashes instantly at 1.00x ──
    if (crashPoint <= 1.00) {
      session.done = true;
      activeSessions.delete(interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor(COLORS.danger)
        .setTitle("💥  Crash!")
        .setDescription("## 💥  Crashed instantly at **1.00x**\n\nNo time to cash out — the rocket blew on launch.")
        .addFields(
          { name: "💰 Bet",  value: `${formatAmount(amount)} gems`,  inline: true },
          { name: "💀 Lost", value: `-${formatAmount(amount)} gems`, inline: true },
        )
        .setTimestamp();

      return interaction.editReply({ content: "", embeds: [embed], components: [] });
    }

    // ── Tick loop ──
    let mult = 1.00;

    while (mult < crashPoint && !session.cashedOut) {
      session.currentMult = mult;

      const emoji     = multColor(mult);
      const bar       = buildBar(mult);
      const potential = Math.floor(amount * mult);

      await interaction.editReply({
        content: [
          `## ${emoji}  **${mult.toFixed(2)}x**`,
          `\`${bar}\``,
          ``,
          `💰 Bet: **${formatAmount(amount)} gems**  ·  Cash out now for **${formatAmount(potential)} gems**`,
        ].join("\n"),
        embeds:     [],
        components: [cashoutRow(interaction.user.id)],
      });

      await sleep(TICK_MS);
      mult = nextMult(mult);
    }

    session.done = true;
    activeSessions.delete(interaction.user.id);

    // ── Cashed out ──
    if (session.cashedOut) {
      const cashMult = session.cashoutMult;
      const winnings = Math.floor(amount * cashMult);
      const profit   = winnings - amount;
      await addBalance(interaction.user.id, winnings);

      const embed = new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle("🚀  Crash — Cashed Out!")
        .setDescription(
          `## ✅  ${cashMult.toFixed(2)}x\n\n` +
          `Cashed out at **${cashMult.toFixed(2)}x** — the rocket crashed at **${crashPoint.toFixed(2)}x**.`,
        )
        .addFields(
          { name: "💰 Bet",    value: `${formatAmount(amount)} gems`,   inline: true },
          { name: "📈 Mult",   value: `${cashMult.toFixed(2)}x`,        inline: true },
          { name: "🎉 Profit", value: `+${formatAmount(profit)} gems`,  inline: true },
          { name: "💵 Return", value: `${formatAmount(winnings)} gems`,  inline: true },
        )
        .setTimestamp();

      return interaction.editReply({ content: "", embeds: [embed], components: [] });
    }

    // ── Crashed ──
    const embed = new EmbedBuilder()
      .setColor(COLORS.danger)
      .setTitle("💥  Crash!")
      .setDescription(
        `## 💥  Crashed at **${crashPoint.toFixed(2)}x**\n\n` +
        `You didn't cash out in time.`,
      )
      .addFields(
        { name: "💰 Bet",  value: `${formatAmount(amount)} gems`,  inline: true },
        { name: "💀 Lost", value: `-${formatAmount(amount)} gems`, inline: true },
      )
      .setTimestamp();

    return interaction.editReply({ content: "", embeds: [embed], components: [] });

  } catch (err) {
    session.done = true;
    activeSessions.delete(interaction.user.id);
    throw err;
  }
}

// ─── Button handler ───────────────────────────────────────────────────────────
export async function handleCashout(bi: ButtonInteraction, userId: string) {
  if (bi.user.id !== userId)
    return bi.reply({ content: "❌ This isn't your game!", ephemeral: true });

  const session = activeSessions.get(userId);

  if (!session || session.done || session.cashedOut)
    return bi.reply({ content: "❌ No active game or it already ended.", ephemeral: true });

  session.cashedOut   = true;
  session.cashoutMult = session.currentMult;

  await bi.deferUpdate();
}
