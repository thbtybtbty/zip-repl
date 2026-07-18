import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import {
  COLORS,
  parseAmount,
  formatAmount,
  getOrCreateUser,
  addBalance,
  errorEmbed,
} from "../utils.js";

// ─── Types ────────────────────────────────────────────────────────────────────
interface CrashSession {
  userId:      string;
  bet:         number;
  crashPoint:  number;
  startTime:   number;
  status:      "flying" | "cashed" | "crashed";
  frame:       number;
  timer:       NodeJS.Timeout;
  interaction: ChatInputCommandInteraction;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const HOUSE_EDGE = 0.04;   // 4% instant-crash probability
const GROWTH     = 0.10;   // e^0.10 per second
const UPDATE_MS  = 1_500;  // refresh cadence

// ─── Sessions ─────────────────────────────────────────────────────────────────
export const activeSessions = new Map<string, CrashSession>();

// ─── Math helpers ─────────────────────────────────────────────────────────────
function generateCrashPoint(): number {
  const r = Math.random();
  if (r < HOUSE_EDGE) return 1.00;
  return Math.floor((1 / (1 - r)) * 100) / 100;
}

function multAt(elapsedMs: number): number {
  return Math.exp(GROWTH * elapsedMs / 1_000);
}

// ─── Rocket track ─────────────────────────────────────────────────────────────
// Moves 🚀 from 🌍 to 🌙 on a log scale (1× at left, 10× at right).
// The exhaust character cycles each frame to give a flicker effect.
const EXHAUST = ["🔥", "✨", "💫", "⚡"];
const SLOTS   = 13;

function buildTrack(mult: number, frame: number): string {
  const pos     = Math.min(SLOTS - 1, Math.floor(Math.log10(Math.max(1.001, mult)) * SLOTS));
  const exhaust = pos > 0 ? (EXHAUST[frame % EXHAUST.length] ?? "🔥") : "";
  const trail   = pos > 1 ? "━".repeat(pos - 1) : "";
  const ahead   = pos < SLOTS - 1 ? "─".repeat(SLOTS - 1 - pos) : "";
  const rocket  = pos >= SLOTS - 1 ? "🌙" : "🚀";
  return `🌍${trail}${exhaust}${rocket}${ahead}🌙`;
}

// ─── Status line (changes with altitude) ─────────────────────────────────────
function statusLine(mult: number, frame: number): string {
  const spin = ["◐", "◓", "◑", "◒"][frame % 4]!;
  if (mult >= 10) return `🌕 **MOON SHOT!** The rocket left the atmosphere!`;
  if (mult >= 5)  return `⚡ **BLAZING!** Cash out before it's too late!`;
  if (mult >= 2)  return `🔥 **Picking up speed!** Hold tight…`;
  return `${spin} Climbing… don't be greedy.`;
}

// ─── Embeds ───────────────────────────────────────────────────────────────────
function flyingEmbed(mult: number, bet: number, frame: number): EmbedBuilder {
  const potential = Math.floor(bet * mult);
  const color =
    mult >= 10 ? COLORS.gold    :
    mult >= 5  ? 0xe67e22       :  // orange
    mult >= 2  ? COLORS.success :
                 COLORS.primary;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle("🚀  Crash")
    .setDescription(
      `${buildTrack(mult, frame)}\n` +
      `## ${mult.toFixed(2)}×\n` +
      `${statusLine(mult, frame)}`,
    )
    .addFields(
      { name: "💰 Bet",          value: `${formatAmount(bet)} gems`,       inline: true },
      { name: "💵 Cash Out Now", value: `${formatAmount(potential)} gems`,  inline: true },
    )
    .setTimestamp();
}

function crashedEmbed(crashPoint: number, bet: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.danger)
    .setTitle("💥  Crashed!")
    .setDescription(
      `🌍${"━".repeat(SLOTS - 2)}💥🌙\n` +
      `## ${crashPoint.toFixed(2)}×`,
    )
    .addFields(
      { name: "💸 Lost", value: `${formatAmount(bet)} gems`, inline: true },
    )
    .setFooter({ text: "Better luck next time." })
    .setTimestamp();
}

function cashedEmbed(mult: number, bet: number, crashPoint: number): EmbedBuilder {
  const winnings = Math.floor(bet * mult);
  const net      = winnings - bet;
  const pos      = Math.min(SLOTS - 1, Math.floor(Math.log10(Math.max(1.001, mult)) * SLOTS));
  const track    = `🌍${"━".repeat(pos > 1 ? pos - 1 : 0)}✅${"─".repeat(Math.max(0, SLOTS - 1 - pos))}🌙`;

  return new EmbedBuilder()
    .setColor(net > 0 ? COLORS.success : COLORS.warning)
    .setTitle("✅  Cashed Out!")
    .setDescription(
      `${track}\n` +
      `## ${mult.toFixed(2)}×  *(crashed @ ${crashPoint.toFixed(2)}×)*`,
    )
    .addFields(
      { name: "💰 Bet",    value: `${formatAmount(bet)} gems`,                            inline: true },
      { name: "💵 Return", value: `${formatAmount(winnings)} gems`,                        inline: true },
      { name: net >= 0 ? "📈 Profit" : "📉 Loss",
        value: `${net >= 0 ? "+" : ""}${formatAmount(net)} gems`,                          inline: true },
    )
    .setFooter({ text: net > 0 ? "Nice cashout! 🎉" : net === 0 ? "Break even." : "Unlucky timing." })
    .setTimestamp();
}

// ─── Buttons ──────────────────────────────────────────────────────────────────
function cashOutRow(sessionId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`crash_cashout_${sessionId}`)
      .setLabel("Cash Out")
      .setEmoji("💵")
      .setStyle(ButtonStyle.Success),
  );
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("crash")
  .setDescription("Bet on a rising multiplier — cash out before it crashes!")
  .addStringOption((opt) =>
    opt.setName("amount").setDescription("Bet amount (e.g. 1m, 2.5b)").setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const amountStr = interaction.options.getString("amount", true);
  const amount    = parseAmount(amountStr);

  if (!amount || amount <= 0)
    return interaction.editReply({ embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")] });

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount)
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} gems**.`)],
    });

  const alreadyActive = [...activeSessions.values()].find((s) => s.userId === interaction.user.id);
  if (alreadyActive)
    return interaction.editReply({ embeds: [errorEmbed("You already have a Crash game in progress!")] });

  await addBalance(interaction.user.id, -amount);

  const crashPoint = generateCrashPoint();
  const startTime  = Date.now();
  const sessionId  = `${interaction.user.id}_${startTime}`;

  // Show frame 0 immediately
  await interaction.editReply({
    embeds:     [flyingEmbed(1.00, amount, 0)],
    components: [cashOutRow(sessionId)],
  });

  const session: CrashSession = {
    userId: interaction.user.id,
    bet:    amount,
    crashPoint,
    startTime,
    status: "flying",
    frame:  0,
    interaction,
    timer: setInterval(async () => {
      if (session.status !== "flying") return;

      session.frame++;
      const elapsed = Date.now() - session.startTime;
      const mult    = multAt(elapsed);

      if (mult >= crashPoint) {
        clearInterval(session.timer);
        session.status = "crashed";
        activeSessions.delete(sessionId);
        try {
          await interaction.editReply({ embeds: [crashedEmbed(crashPoint, amount)], components: [] });
        } catch { /* expired */ }
      } else {
        try {
          await interaction.editReply({
            embeds:     [flyingEmbed(mult, amount, session.frame)],
            components: [cashOutRow(sessionId)],
          });
        } catch { /* rate-limit miss — skip frame */ }
      }
    }, UPDATE_MS),
  };

  activeSessions.set(sessionId, session);
}

// ─── Cash Out handler ─────────────────────────────────────────────────────────
export async function handleCashout(interaction: ButtonInteraction, sessionId: string) {
  const session = activeSessions.get(sessionId);

  if (!session || session.status !== "flying") {
    return interaction.reply({
      content: "💥 Too late — the rocket already crashed!",
      flags:   MessageFlags.Ephemeral,
    });
  }
  if (interaction.user.id !== session.userId) {
    return interaction.reply({ content: "❌ This isn't your game.", flags: MessageFlags.Ephemeral });
  }

  clearInterval(session.timer);
  session.status = "cashed";
  activeSessions.delete(sessionId);

  const elapsed  = Date.now() - session.startTime;
  const mult     = Math.min(multAt(elapsed), session.crashPoint);
  const winnings = Math.floor(session.bet * mult);

  await addBalance(session.userId, winnings);
  await interaction.update({
    embeds:     [cashedEmbed(mult, session.bet, session.crashPoint)],
    components: [],
  });
}
