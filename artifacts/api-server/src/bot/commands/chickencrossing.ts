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
  formatMult,
  getOrCreateUser,
  addBalance,
  recordBet,
  errorEmbed,
} from "../utils.js";

// ─── Types ────────────────────────────────────────────────────────────────────
type Difficulty = "easy" | "medium" | "hard";

export interface ChickenGame {
  userId:       string;
  bet:          number;
  difficulty:   Difficulty;
  lanesCrossed: number;
  multiplier:   number;
  messageId:    string;
  channelId:    string;
}

export const activeChickenGames = new Map<string, ChickenGame>();

// ─── Config ───────────────────────────────────────────────────────────────────
const TOTAL_LANES = 24;
const RTP         = 0.925;

const HIT_CHANCE: Record<Difficulty, number> = {
  easy:   0.10,
  medium: 0.25,
  hard:   0.45,
};

const DIFF_EMOJI: Record<Difficulty, string> = {
  easy:   "🍀",
  medium: "⚠️",
  hard:   "💀",
};

// ─── Math ─────────────────────────────────────────────────────────────────────
function calcMultiplier(difficulty: Difficulty, lanesCrossed: number): number {
  if (lanesCrossed === 0) return 1.0;
  const survive = 1 - HIT_CHANCE[difficulty];
  return (1 / Math.pow(survive, lanesCrossed)) * RTP;
}

// ─── Track visual ─────────────────────────────────────────────────────────────
function buildTrack(lanesCrossed: number, status: "active" | "cashed" | "dead"): string {
  const parts: string[] = ["🚩"];
  for (let i = 0; i < TOTAL_LANES; i++) {
    if (i < lanesCrossed) {
      parts.push("🥚");
    } else if (i === lanesCrossed) {
      parts.push(status === "dead" ? "💥" : "🐔");
    } else {
      parts.push("🚗");
    }
  }
  parts.push("🏆");
  return parts.join("");
}

// ─── Embed ────────────────────────────────────────────────────────────────────
function buildEmbed(game: ChickenGame, status: "active" | "cashed" | "dead"): EmbedBuilder {
  const mult      = calcMultiplier(game.difficulty, game.lanesCrossed);
  const nextMult  = calcMultiplier(game.difficulty, game.lanesCrossed + 1);
  const nextWin   = Math.floor(game.bet * nextMult);
  const currentWin = Math.floor(game.bet * mult);
  const maxWin    = Math.floor(game.bet * calcMultiplier(game.difficulty, TOTAL_LANES));
  const diffLabel = game.difficulty.charAt(0).toUpperCase() + game.difficulty.slice(1);
  const diffEmoji = DIFF_EMOJI[game.difficulty];

  const color =
    status === "active" ? COLORS.primary :
    status === "cashed" ? COLORS.success :
    COLORS.danger;

  const title =
    status === "active" ? "🐔  Chicken Crossing" :
    status === "cashed" ? "🐔  Chicken Crossing — 💸 CASHED OUT" :
    "🐔  Chicken Crossing — 🚗 Hit!";

  const embed = new EmbedBuilder().setColor(color).setTitle(title);

  if (status === "active") {
    embed.setDescription([
      `💎 **Bet**  \`${formatAmount(game.bet)}\``,
      `${diffEmoji} **Difficulty**  \`${diffLabel}\``,
      `💰 **If you cross**  \`${formatAmount(nextWin)}\``,
      `💰 **Potential**  \`${formatAmount(maxWin)}\``,
    ].join("\n"));
  } else if (status === "cashed") {
    embed.setDescription([
      `💎 **Bet**  \`${formatAmount(game.bet)}\``,
      `💰 **Winnings**  \`${formatAmount(currentWin)}\``,
      `${diffEmoji} **Difficulty**  \`${diffLabel}\``,
      `💰 **Payout**  \`${formatAmount(currentWin)}\``,
    ].join("\n"));
  } else {
    embed.setDescription([
      `💎 **Bet**  \`${formatAmount(game.bet)}\``,
      `${diffEmoji} **Difficulty**  \`${diffLabel}\``,
      `❌ **Lost on lane**  \`${game.lanesCrossed + 1} of ${TOTAL_LANES}\``,
    ].join("\n"));
  }

  const laneLabel =
    status === "active"
      ? `🐔  Lane ${game.lanesCrossed + 1} of ${TOTAL_LANES}`
      : `🏁  Crossed ${game.lanesCrossed} lane${game.lanesCrossed !== 1 ? "s" : ""}`;

  embed.addFields({ name: laneLabel, value: buildTrack(game.lanesCrossed, status) });

  if (status === "active" && game.lanesCrossed > 0) {
    embed.setFooter({ text: `Next lane pays ${formatMult(nextMult)} for ${formatAmount(nextWin)} gems.` });
  }
  if (status === "cashed") {
    embed.setFooter({ text: `Cashed out at ${formatMult(mult)} after ${game.lanesCrossed} safe lane${game.lanesCrossed !== 1 ? "s" : ""}.` });
  }

  return embed;
}

// ─── Buttons ──────────────────────────────────────────────────────────────────
function buildGameButtons(userId: string, canCashout: boolean): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cc_fwd_${userId}`)
      .setLabel("Forward")
      .setEmoji("➡️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`cc_cash_${userId}`)
      .setLabel("Cashout")
      .setEmoji("🦅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canCashout),
  );
}

function buildPlayAgainRow(
  userId:     string,
  difficulty: string,
  bet:        number,
  disabled =  false,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pa_cc_${userId}_${difficulty}_${bet}`)
      .setLabel("🔄  Play Again")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("chickencrossing")
  .setDescription("Cross lanes with your chicken — cash out before getting hit!")
  .addStringOption((o) =>
    o.setName("bet").setDescription("Amount to bet").setRequired(true),
  )
  .addStringOption((o) =>
    o.setName("difficulty")
      .setDescription("Lane difficulty (default: easy)")
      .setRequired(false)
      .addChoices(
        { name: "Easy",   value: "easy"   },
        { name: "Medium", value: "medium" },
        { name: "Hard",   value: "hard"   },
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  if (activeChickenGames.has(userId)) {
    return void interaction.reply({
      embeds: [errorEmbed("You already have an active Chicken Crossing game!")],
      ephemeral: true,
    });
  }

  const betStr     = interaction.options.getString("bet", true);
  const difficulty = (interaction.options.getString("difficulty") ?? "easy") as Difficulty;

  const bet = parseAmount(betStr);
  if (!bet || bet < 1) {
    return void interaction.reply({ embeds: [errorEmbed("Invalid bet amount.")], ephemeral: true });
  }

  await interaction.deferReply();

  const user = await getOrCreateUser(userId, interaction.user.username);
  if (user.balance < bet) {
    return void interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
    });
  }

  await addBalance(userId, -bet);

  const game: ChickenGame = {
    userId,
    bet,
    difficulty,
    lanesCrossed: 0,
    multiplier:   1.0,
    messageId:    "",
    channelId:    interaction.channelId,
  };

  const msg: Message = await interaction.editReply({
    embeds:     [buildEmbed(game, "active")],
    components: [buildGameButtons(userId, false)],
  });
  game.messageId = msg.id;
  activeChickenGames.set(userId, game);
}

// ─── Button: Forward ─────────────────────────────────────────────────────────
export async function handleForward(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferUpdate();

  const game = activeChickenGames.get(interaction.user.id);
  if (!game) return;

  const hit = Math.random() < HIT_CHANCE[game.difficulty];

  if (hit) {
    activeChickenGames.delete(interaction.user.id);
    await recordBet(interaction.user.id, game.bet, -game.bet);
    await interaction.editReply({
      embeds:     [buildEmbed(game, "dead")],
      components: [buildPlayAgainRow(game.userId, game.difficulty, game.bet)],
    });
    return;
  }

  game.lanesCrossed++;
  game.multiplier = calcMultiplier(game.difficulty, game.lanesCrossed);

  if (game.lanesCrossed === TOTAL_LANES) {
    // Auto-win — crossed all lanes
    activeChickenGames.delete(interaction.user.id);
    const winnings = Math.floor(game.bet * game.multiplier);
    await addBalance(interaction.user.id, winnings);
    await recordBet(interaction.user.id, game.bet, winnings - game.bet);
    await interaction.editReply({
      embeds:     [buildEmbed(game, "cashed")],
      components: [buildPlayAgainRow(game.userId, game.difficulty, game.bet)],
    });
    return;
  }

  await interaction.editReply({
    embeds:     [buildEmbed(game, "active")],
    components: [buildGameButtons(game.userId, true)],
  });
}

// ─── Button: Cashout ─────────────────────────────────────────────────────────
export async function handleCashout(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferUpdate();

  const game = activeChickenGames.get(interaction.user.id);
  if (!game || game.lanesCrossed === 0) return;

  activeChickenGames.delete(interaction.user.id);
  const winnings = Math.floor(game.bet * game.multiplier);
  await addBalance(interaction.user.id, winnings);
  await recordBet(interaction.user.id, game.bet, winnings - game.bet);

  await interaction.editReply({
    embeds:     [buildEmbed(game, "cashed")],
    components: [buildPlayAgainRow(game.userId, game.difficulty, game.bet)],
  });
}

// ─── Button: Play Again ───────────────────────────────────────────────────────
export async function handlePlayAgain(
  interaction: ButtonInteraction,
  userId:      string,
  difficulty:  string,
  betStr:      string,
): Promise<void> {
  if (interaction.user.id !== userId) {
    return void interaction.reply({ content: "❌ This isn't your game.", flags: MessageFlags.Ephemeral });
  }
  if (activeChickenGames.has(userId)) {
    return void interaction.reply({
      embeds: [errorEmbed("You already have an active Chicken Crossing game!")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const bet = parseInt(betStr, 10);
  await interaction.deferUpdate();
  await interaction.editReply({ components: [buildPlayAgainRow(userId, difficulty, bet, true)] });

  const user = await getOrCreateUser(userId, interaction.user.username);
  if (user.balance < bet) {
    await interaction.followUp({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
      ephemeral: true,
    });
    return;
  }

  await addBalance(userId, -bet);

  const game: ChickenGame = {
    userId,
    bet,
    difficulty:   difficulty as Difficulty,
    lanesCrossed: 0,
    multiplier:   1.0,
    messageId:    "",
    channelId:    interaction.channelId,
  };

  const msg: Message = await interaction.followUp({
    embeds:     [buildEmbed(game, "active")],
    components: [buildGameButtons(userId, false)],
  });
  game.messageId = msg.id;
  activeChickenGames.set(userId, game);
}
