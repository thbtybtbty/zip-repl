import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
  type Message,
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
  recordBet,
  errorEmbed,
} from "../utils.js";

// ─── Types ────────────────────────────────────────────────────────────────────
interface CrashSession {
  userId:      string;
  bet:         number;
  crashPoint:  number;
  startTime:   number;
  status:      "flying" | "cashed" | "crashed";
  lastMult:    number;   // multiplier shown on the last tick — used for cashout
  gameMessage: Message;  // the flying embed message to edit
  timer:       NodeJS.Timeout;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const HOUSE_EDGE  = 0.075;  // 7.5% house edge: P(crash > M) = 0.925/M
const GROWTH      = 0.06;   // continuous growth rate (e^0.06 per second)
const UPDATE_MS   = 1_000;  // refresh interval in ms

// ─── Active sessions (sessionId → game) ──────────────────────────────────────
export const activeSessions = new Map<string, CrashSession>();

// ─── Crash point generation ───────────────────────────────────────────────────
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
    .setDescription(
      [
        `## ${mult.toFixed(2)}×`,
        buildBar(mult),
        ``,
        `💎 **Bet**          \`${formatAmount(bet)}\``,
        `💵 **Cash Out Now** \`${formatAmount(potential)}\``,
      ].join("\n"),
    )
    .setTimestamp();
}

function crashedEmbed(crashPoint: number, bet: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.danger)
    .setTitle("💥  Crash — Crashed!")
    .setDescription(
      [
        `## ${crashPoint.toFixed(2)}×`,
        ``,
        `💎 **Bet**   \`${formatAmount(bet)}\``,
        `💸 **Lost**  \`-${formatAmount(bet)}\``,
      ].join("\n"),
    )
    .setTimestamp();
}

function cashedEmbed(mult: number, bet: number, crashPoint: number): EmbedBuilder {
  const winnings = Math.floor(bet * mult);
  return new EmbedBuilder()
    .setColor(winnings > bet ? COLORS.success : COLORS.warning)
    .setTitle("✅  Crash — Cashed Out!")
    .setDescription(
      [
        `## ${mult.toFixed(2)}×  *(crashed at ${crashPoint.toFixed(2)}×)*`,
        ``,
        `💎 **Bet**     \`${formatAmount(bet)}\``,
        `💵 **Return**  \`${formatAmount(winnings)}\``,
        winnings > bet
          ? `🎉 **Profit**  \`+${formatAmount(winnings - bet)}\``
          : ``,
      ].filter(Boolean).join("\n"),
    )
    .setTimestamp();
}

// ─── Button rows ──────────────────────────────────────────────────────────────
function cashOutRow(sessionId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`crash_cashout_${sessionId}`)
      .setLabel("Cash Out")
      .setEmoji("💵")
      .setStyle(ButtonStyle.Success),
  );
}

function playAgainRow(userId: string, bet: number, disabled = false): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pa_crash_${userId}_${bet}`)
      .setLabel("🔄  Play Again")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

// ─── Core session launcher (shared by /crash and Play Again) ──────────────────
function launchCrash(userId: string, bet: number, gameMessage: Message): string {
  const sessionId  = `${userId}_${Date.now()}`;
  const crashPoint = generateCrashPoint();
  const startTime  = Date.now();

  const session: CrashSession = {
    userId,
    bet,
    crashPoint,
    startTime,
    status:      "flying",
    lastMult:    1.00,
    gameMessage,
    timer: setInterval(async () => {
      if (session.status !== "flying") return;

      const elapsed = Date.now() - session.startTime;
      const mult    = multAt(elapsed);

      if (mult >= crashPoint) {
        clearInterval(session.timer);
        session.status = "crashed";
        activeSessions.delete(sessionId);
        await recordBet(userId, bet, -bet);
        try {
          await session.gameMessage.edit({
            embeds:     [crashedEmbed(crashPoint, bet)],
            components: [playAgainRow(userId, bet)],
          });
        } catch { /* message expired */ }
      } else {
        session.lastMult = mult;
        try {
          await session.gameMessage.edit({
            embeds:     [flyingEmbed(mult, bet)],
            components: [cashOutRow(sessionId)],
          });
        } catch { /* rate-limit miss — skip this frame */ }
      }
    }, UPDATE_MS),
  };

  activeSessions.set(sessionId, session);
  return sessionId;
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

  if (!amount || amount < 1_000_000)
    return interaction.editReply({ embeds: [errorEmbed("Minimum bet is **1m gems**. Try `1m`, `2.5b`, `500k`.")] });

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount)
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} gems**.`)],
    });

  const alreadyActive = [...activeSessions.values()].find((s) => s.userId === interaction.user.id);
  if (alreadyActive)
    return interaction.editReply({ embeds: [errorEmbed("You already have a Crash game in progress!")] });

  await addBalance(interaction.user.id, -amount);

  // Show initial state, then hand the message to launchCrash
  const gameMessage = await interaction.editReply({
    embeds:     [flyingEmbed(1.00, amount)],
    components: [], // sessionId not yet known — launchCrash sets up the interval
  });

  const sessionId = launchCrash(interaction.user.id, amount, gameMessage);

  // Immediately update with the correct cashout button now that we have the sessionId
  await gameMessage.edit({ components: [cashOutRow(sessionId)] });
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
  await recordBet(session.userId, session.bet, winnings - session.bet);

  await interaction.update({
    embeds:     [cashedEmbed(mult, session.bet, session.crashPoint)],
    components: [playAgainRow(session.userId, session.bet)],
  });
}

// ─── Button: Play Again ───────────────────────────────────────────────────────
export async function handlePlayAgain(interaction: ButtonInteraction, userId: string, betStr: string): Promise<void> {
  if (interaction.user.id !== userId) {
    return void interaction.reply({ content: "❌ This isn't your game.", flags: MessageFlags.Ephemeral });
  }

  const bet = parseInt(betStr, 10);

  // Disable the Play Again button on the old result message
  await interaction.deferUpdate();
  await interaction.editReply({ components: [playAgainRow(userId, bet, true)] });

  const alreadyActive = [...activeSessions.values()].find((s) => s.userId === userId);
  if (alreadyActive) {
    await interaction.followUp({ embeds: [errorEmbed("You already have a Crash game in progress!")], ephemeral: true });
    return;
  }

  const user = await getOrCreateUser(userId, interaction.user.username);
  if (user.balance < bet) {
    await interaction.followUp({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} gems**.`)],
      ephemeral: true,
    });
    return;
  }

  await addBalance(userId, -bet);

  // Create the new game message via followUp
  const gameMessage: Message = await interaction.followUp({
    embeds:     [flyingEmbed(1.00, bet)],
    components: [],
  });

  const sessionId = launchCrash(userId, bet, gameMessage);
  await gameMessage.edit({ components: [cashOutRow(sessionId)] });
}
