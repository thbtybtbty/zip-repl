import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
  type TextChannel,
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
import { getServerConfig } from "../botConfig.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const PAYOUT_MULT = 1.9;  // winner gets 1.9× their bet (5% house edge on join, ~2.5% on bot call)
const WIN_CHANCE  = 0.475; // vs bot: 47.5% win chance so EV ≈ 0.475*1.9 - 1 = -0.0975 (9.75% edge)

// ─── Pending flip challenges ──────────────────────────────────────────────────
interface FlipChallenge {
  challengerId:   string;
  challengerName: string;
  challengerSide: "Heads" | "Tails";
  bet:            number;
  channelMsgId:   string;
  createdAt:      number;
}

const pendingFlips = new Map<string, FlipChallenge>();

// ─── Embed builders ───────────────────────────────────────────────────────────
function challengeEmbed(
  challengerName: string,
  challengerSide: "Heads" | "Tails",
  bet:            number,
  status:         "open" | "expired",
): EmbedBuilder {
  const open     = status === "open";
  const winner   = Math.floor(bet * PAYOUT_MULT);
  const joinerSide: "Heads" | "Tails" = challengerSide === "Heads" ? "Tails" : "Heads";

  const lines = open
    ? [
        `**${challengerName}** is looking for a coin flip duel!`,
        ``,
        `┌─────────────────────────────────┐`,
        `│  ${SIDE_ICON[challengerSide]} **${challengerName}**  →  \`${challengerSide}\``,
        `│  ${SIDE_ICON[joinerSide]} **You (joiner)**  →  \`${joinerSide}\``,
        `└─────────────────────────────────┘`,
        ``,
        `💎 **Bet**     \`${formatAmount(bet)}\``,
        `💰 **Winner**  \`${formatAmount(winner)}\``,
        ``,
        `Click **Join** to play as \`${joinerSide}\`, or **Call Bot** to face the house.`,
      ]
    : [`❌  This challenge has expired.`];

  return new EmbedBuilder()
    .setColor(open ? COLORS.gold : COLORS.dark)
    .setTitle("🪙  Flip Challenge")
    .setDescription(lines.join("\n"))
    .setTimestamp();
}

function challengeRow(challengerId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`flip_join_${challengerId}`)
      .setLabel("Join")
      .setEmoji("🤝")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`flip_bot_${challengerId}`)
      .setLabel("Call Bot")
      .setEmoji("🤖")
      .setStyle(ButtonStyle.Secondary),
  );
}

const SIDE_ICON: Record<"Heads" | "Tails", string> = { Heads: "🟡", Tails: "⚪" };

const FLIP_PROGRESS_BARS = [
  "▰▱▱▱▱▱",
  "▰▰▰▱▱▱",
  "▰▰▰▰▰▱",
  "▰▰▰▰▰▰",
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function flipAnimationEmbed(
  title: string,
  playerOneName: string,
  playerOneSide: "Heads" | "Tails",
  playerTwoName: string,
  playerTwoSide: "Heads" | "Tails",
  bet: number,
  coinResult: "Heads" | "Tails",
  frame: number,
): EmbedBuilder {
  const animatedResult = frame >= FLIP_PROGRESS_BARS.length - 1
    ? coinResult
    : (frame % 2 === 0 ? "Heads" : "Tails");

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(title)
    .setDescription([
      `${SIDE_ICON[playerOneSide]} **${playerOneName}**  \`${playerOneSide}\`   vs   \`${playerTwoSide}\`  **${playerTwoName}** ${SIDE_ICON[playerTwoSide]}`,
      "",
      `🎲 **Coin landed**   \`${animatedResult}\``,
      `💎 **Bet each**      \`${formatAmount(bet)}\``,
      "",
      "🕐 **Flipping the coin…**",
      FLIP_PROGRESS_BARS[Math.min(frame, FLIP_PROGRESS_BARS.length - 1)]!,
    ].join("\n"))
    .setTimestamp();
}

async function animateFlip(
  interaction: ButtonInteraction,
  title: string,
  playerOneName: string,
  playerOneSide: "Heads" | "Tails",
  playerTwoName: string,
  playerTwoSide: "Heads" | "Tails",
  bet: number,
  coinResult: "Heads" | "Tails",
): Promise<void> {
  await interaction.editReply({
    embeds: [flipAnimationEmbed(title, playerOneName, playerOneSide, playerTwoName, playerTwoSide, bet, coinResult, 0)],
    components: [],
  }).catch(() => null);

  for (let frame = 1; frame < FLIP_PROGRESS_BARS.length; frame++) {
    await sleep(350);
    await interaction.editReply({
      embeds: [flipAnimationEmbed(title, playerOneName, playerOneSide, playerTwoName, playerTwoSide, bet, coinResult, frame)],
      components: [],
    }).catch(() => null);
  }

  await sleep(350);
}

function pvpResultEmbed(
  winner: string, loser: string,
  winnerSide: "Heads" | "Tails", loserSide: "Heads" | "Tails",
  coinResult: "Heads" | "Tails",
  bet: number, payout: number,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle("🪙  Flip — Player vs Player")
    .setDescription([
      `${SIDE_ICON[winnerSide]} **${winner}**  \`${winnerSide}\`   vs   \`${loserSide}\`  **${loser}** ${SIDE_ICON[loserSide]}`,
      ``,
      `🎲 **Coin landed**   \`${coinResult}\``,
      ``,
      `> 🏆 **${winner}** wins the flip!`,
      ``,
      `💎 **Bet each**    \`${formatAmount(bet)}\``,
      `💰 **Winner gets** \`${formatAmount(payout)}\``,
    ].join("\n"))
    .setTimestamp();
}

// ─── Command definition ───────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("flip")
  .setDescription("Challenge another player to a coin flip — 1.9× payout to the winner!")
  .addStringOption((o) =>
    o.setName("amount").setDescription("Your bet (e.g. 1m, 2.5b, 500k)").setRequired(true),
  )
  .addStringOption((o) =>
    o.setName("side")
      .setDescription("Your side of the coin")
      .setRequired(true)
      .addChoices(
        { name: "🟡 Heads", value: "Heads" },
        { name: "⚪ Tails", value: "Tails" },
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const cfg = getServerConfig();
  if (!cfg || !cfg.flipChannelId) {
    return void interaction.editReply({
      embeds: [errorEmbed("Flip channel not configured. Ask an admin to run `/setup`.")],
    });
  }

  const amountStr     = interaction.options.getString("amount", true);
  const challengerSide = interaction.options.getString("side", true) as "Heads" | "Tails";
  const amount         = parseAmount(amountStr);

  if (!amount || amount < 1_000_000) {
    return void interaction.editReply({ embeds: [errorEmbed("Minimum bet is **1M gems**.")] });
  }

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount) {
    return void interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
    });
  }

  if (pendingFlips.has(interaction.user.id)) {
    return void interaction.editReply({
      embeds: [errorEmbed("You already have an open flip challenge. Wait for it to be accepted or expire.")],
    });
  }

  await addBalance(interaction.user.id, -amount);

  const guild   = interaction.guild!;
  const channel = await guild.channels.fetch(cfg.flipChannelId).catch(() => null) as TextChannel | null;
  if (!channel) {
    await addBalance(interaction.user.id, amount);
    return void interaction.editReply({
      embeds: [errorEmbed("Flip channel not found. Ask an admin to re-run `/setup`.")],
    });
  }

  const msg = await channel.send({
    embeds:     [challengeEmbed(interaction.user.username, challengerSide, amount, "open")],
    components: [challengeRow(interaction.user.id)],
  });

  const challenge: FlipChallenge = {
    challengerId:   interaction.user.id,
    challengerName: interaction.user.username,
    challengerSide,
    bet:            amount,
    channelMsgId:   msg.id,
    createdAt:      Date.now(),
  };
  pendingFlips.set(interaction.user.id, challenge);

  setTimeout(async () => {
    const still = pendingFlips.get(interaction.user.id);
    if (still && still.channelMsgId === msg.id) {
      pendingFlips.delete(interaction.user.id);
      await addBalance(interaction.user.id, amount);
      await msg.edit({ embeds: [challengeEmbed(interaction.user.username, challengerSide, amount, "expired")], components: [] }).catch(() => null);
    }
  }, 10 * 60 * 1000);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setDescription(`✅ Flip challenge posted in <#${cfg.flipChannelId}>!`),
    ],
  });
}

// ─── Button: Join (player vs player) ─────────────────────────────────────────
export async function handleJoin(interaction: ButtonInteraction, challengerId: string): Promise<void> {
  await interaction.deferUpdate();

  if (interaction.user.id === challengerId) {
    return void interaction.followUp({ content: "❌ You can't join your own flip!", ephemeral: true });
  }

  const challenge = pendingFlips.get(challengerId);
  if (!challenge) {
    return void interaction.editReply({ embeds: [challengeEmbed("?", 0, "expired")], components: [] });
  }

  const joiner = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (joiner.balance < challenge.bet) {
    return void interaction.followUp({
      content: `❌ Insufficient balance. You need **${formatAmount(challenge.bet)} 💎** to join.`,
      ephemeral: true,
    });
  }

  await addBalance(interaction.user.id, -challenge.bet);

  // Challenger already picked their side; joiner automatically gets the other
  const challengerSide: "Heads" | "Tails" = challenge.challengerSide;
  const joinerSide: "Heads" | "Tails"     = challengerSide === "Heads" ? "Tails" : "Heads";
  const coinResult: "Heads" | "Tails"     = Math.random() < 0.5 ? "Heads" : "Tails";
  const challengerWins = challengerSide === coinResult;

  const winnerId   = challengerWins ? challengerId : interaction.user.id;
  const loserName  = challengerWins ? interaction.user.username : challenge.challengerName;
  const winnerName = challengerWins ? challenge.challengerName  : interaction.user.username;
  const winnerSide = challengerWins ? challengerSide : joinerSide;
  const loserSide  = challengerWins ? joinerSide     : challengerSide;
  const totalPot   = challenge.bet * 2;
  const winnerGets = Math.floor(totalPot * 0.95);

  await addBalance(winnerId, winnerGets);
  await recordBet(challengerId,        challenge.bet, challengerWins ? winnerGets - challenge.bet : -challenge.bet, "flip");
  await recordBet(interaction.user.id, challenge.bet, challengerWins ? -challenge.bet : winnerGets - challenge.bet, "flip");

  pendingFlips.delete(challengerId);

  await animateFlip(
    interaction,
    "🪙  Flip — Player vs Player",
    challenge.challengerName,
    challengerSide,
    interaction.user.username,
    joinerSide,
    challenge.bet,
    coinResult,
  );

  await interaction.editReply({
    embeds:     [pvpResultEmbed(winnerName, loserName, winnerSide, loserSide, coinResult, challenge.bet, winnerGets)],
    components: [],
  });
}

// ─── Button: Call Bot ─────────────────────────────────────────────────────────
export async function handleCallBot(interaction: ButtonInteraction, challengerId: string): Promise<void> {
  await interaction.deferUpdate();

  const challenge = pendingFlips.get(challengerId);
  if (!challenge) {
    return void interaction.editReply({ embeds: [challengeEmbed("?", 0, "expired")], components: [] });
  }

  if (interaction.user.id !== challengerId) {
    return void interaction.followUp({ content: "❌ Only the challenger can call the bot.", ephemeral: true });
  }

  const won    = Math.random() < WIN_CHANCE;
  const payout = Math.floor(challenge.bet * PAYOUT_MULT); // 1.9× the bet

  // Use the side the challenger already chose; bot takes the other
  const playerSide: "Heads" | "Tails" = challenge.challengerSide;
  const botSide: "Heads" | "Tails"    = playerSide === "Heads" ? "Tails" : "Heads";
  // Force coin result to match win/loss outcome
  const coinResult: "Heads" | "Tails" = won ? playerSide : botSide;

  // Fix: bet was already deducted in execute(); on win just add the 1.9× payout back
  if (won) await addBalance(challengerId, payout);
  await recordBet(challengerId, challenge.bet, won ? payout - challenge.bet : -challenge.bet, "flip");

  pendingFlips.delete(challengerId);

  const profit = won ? payout - challenge.bet : -challenge.bet;

  await animateFlip(
    interaction,
    "🪙  Flip vs Bot",
    interaction.user.username,
    playerSide,
    "Bot",
    botSide,
    challenge.bet,
    coinResult,
  );

  const embed = new EmbedBuilder()
    .setColor(won ? COLORS.success : COLORS.danger)
    .setTitle(won ? "🪙  Flip vs Bot — You Win! 🎉" : "🪙  Flip vs Bot — You Lost")
    .setDescription([
      `${SIDE_ICON[playerSide]} **You**  \`${playerSide}\`   vs   \`${botSide}\`  **Bot** 🤖`,
      ``,
      `🎲 **Coin landed**  \`${coinResult}\``,
      ``,
      `💎 **Bet**     \`${formatAmount(challenge.bet)}\``,
      `💰 **Payout**  \`${won ? formatAmount(payout) : "0"}\``,
      `📈 **Profit**  \`${profit >= 0 ? "+" : ""}${formatAmount(Math.abs(profit))}\``,
    ].join("\n"))
    .setTimestamp();

  await interaction.editReply({ embeds: [embed], components: [] });
}
