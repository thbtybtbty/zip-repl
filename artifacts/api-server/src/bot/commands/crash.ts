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
  userId:     string;
  bet:        number;
  crashPoint: number;
  startTime:  number;
  status:     "flying" | "cashed" | "crashed";
  lastMult:   number;   // multiplier shown on the last tick — used for cashout
  timer:      NodeJS.Timeout;
  interaction: ChatInputCommandInteraction;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const HOUSE_EDGE  = 0.075;  // 7.5% house edge: P(crash > M) = 0.925/M
const GROWTH      = 0.06;   // continuous growth rate (e^0.06 per second)
const UPDATE_MS   = 1_000;  // refresh interval in ms

// ─── Active sessions (sessionId → game) ──────────────────────────────────────
export const activeSessions = new Map<string, CrashSession>();

// ─── Crash point generation ───────────────────────────────────────────────────
// Distribution: P(crash > M) = 0.925/M  →  E[payout at M] = 0.925 = RTP 92.5%
function generateCrashPoint(): number {
  const r = Math.random();
  if (r < HOUSE_EDGE) return 1.00;
  const raw = (1 - HOUSE_EDGE) / (1 - r);
  return Math.floor(raw * 100) / 100;
}

// ─── Multiplier at elapsed time ───────────────────────────────────────────────
function multAt(elapsedMs: number): number {
  return Math.exp(GROWTH * elapsedMs / 1_000);
}

// ─── Progress bar (log scale: 1× → 10× = 0 → 10 blocks) ─────────────────────
function buildBar(mult: number): string {
  const filled = Math.min(10, Math.round(Math.log10(mult) * 10));
  return "▰".repeat(filled) + "▱".repeat(10 - filled);
}

// ─── Embed helpers ────────────────────────────────────────────────────────────
function flyingEmbed(mult: number, bet: number): EmbedBuilder {
  const potential = Math.floor(bet * mult);
  const color =
    mult >= 5  ? COLORS.gold :
    mult >= 2  ? COLORS.success :
                 COLORS.primary;

  const icon =
    mult >= 10 ? "🌕" :
    mult >= 5  ? "🌟" :
    mult >= 2  ? "🚀" :
                 "🛫";

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${icon}  Crash — Flying!`)
    .setDescription(`## ${mult.toFixed(2)}×\n${buildBar(mult)}`)
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
    .setDescription(`## ${crashPoint.toFixed(2)}×`)
    .addFields(
      { name: "💸 Lost", value: `${formatAmount(bet)} gems`, inline: true },
    )
    .setTimestamp();
}

function cashedEmbed(mult: number, bet: number, crashPoint: number): EmbedBuilder {
  const winnings = Math.floor(bet * mult);
  return new EmbedBuilder()
    .setColor(winnings > bet ? COLORS.success : COLORS.warning)
    .setTitle("✅  Cashed Out!")
    .setDescription(`## ${mult.toFixed(2)}×  *(crashed at ${crashPoint.toFixed(2)}×)*`)
    .addFields(
      { name: "💰 Bet",    value: `${formatAmount(bet)} gems`,      inline: true },
      { name: "💵 Return", value: `${formatAmount(winnings)} gems`,  inline: true },
    )
    .setTimestamp();
}

// ─── Cash Out button row ──────────────────────────────────────────────────────
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
  .setDescription("Play the Crash game")
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

  // One active game per user
  const alreadyActive = [...activeSessions.values()].find((s) => s.userId === interaction.user.id);
  if (alreadyActive)
    return interaction.editReply({ embeds: [errorEmbed("You already have a Crash game in progress!")] });

  await addBalance(interaction.user.id, -amount);

  const crashPoint = generateCrashPoint();
  const startTime  = Date.now();
  const sessionId  = `${interaction.user.id}_${startTime}`;

  // Show initial state immediately
  await interaction.editReply({
    embeds:     [flyingEmbed(1.00, amount)],
    components: [cashOutRow(sessionId)],
  });

  // ── Tick loop ──────────────────────────────────────────────────────────────
  const session: CrashSession = {
    userId: interaction.user.id,
    bet:    amount,
    crashPoint,
    startTime,
    status:   "flying",
    lastMult: 1.00,
    interaction,
    timer: setInterval(async () => {
      if (session.status !== "flying") return;

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
        session.lastMult = mult;
        try {
          await interaction.editReply({
            embeds:     [flyingEmbed(mult, amount)],
            components: [cashOutRow(sessionId)],
          });
        } catch { /* rate-limit miss — skip this frame */ }
      }
    }, UPDATE_MS),
  };

  activeSessions.set(sessionId, session);
}

// ─── Button: Cash Out ──────────────────────────────────────────────────────────
export async function handleCashout(interaction: ButtonInteraction, sessionId: string) {
  const session = activeSessions.get(sessionId);

  if (!session || session.status !== "flying") {
    return interaction.reply({
      content: "💥 Too late — the rocket already crashed!",
      flags:   MessageFlags.Ephemeral,
    });
  }
  if (interaction.user.id !== session.userId) {
    return interaction.reply({
      content: "❌ This isn't your game.",
      flags:   MessageFlags.Ephemeral,
    });
  }

  clearInterval(session.timer);
  session.status = "cashed";
  activeSessions.delete(sessionId);

  const mult     = session.lastMult;
  const winnings = Math.floor(session.bet * mult);

  await addBalance(session.userId, winnings);

  await interaction.update({
    embeds:     [cashedEmbed(mult, session.bet, session.crashPoint)],
    components: [],
  });
}
