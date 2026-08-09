import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
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

type Choice = "rock" | "paper" | "scissors";

const EMOJI: Record<Choice, string> = {
  rock:     "🪨",
  paper:    "📄",
  scissors: "✂️",
};

const BEATS: Record<Choice, Choice> = {
  rock:     "scissors",
  paper:    "rock",
  scissors: "paper",
};

// What beats each choice (inverse of BEATS)
const BEATEN_BY: Record<Choice, Choice> = {
  rock:     "paper",
  paper:    "scissors",
  scissors: "rock",
};

function getResult(player: Choice, bot: Choice): "win" | "loss" | "tie" {
  if (player === bot) return "tie";
  if (BEATS[player] === bot) return "win";
  return "loss";
}

const RPS_PROGRESS_BARS = [
  "▰▱▱▱▱▱",
  "▰▰▱▱▱▱",
  "▰▰▰▱▱▱",
  "▰▰▰▰▱▱",
  "▰▰▰▰▰▱",
  "▰▰▰▰▰▰",
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function rpsAnimationEmbed(amount: number, playerChoice: Choice, botChoice: Choice, frame: number): EmbedBuilder {
  const animatedBotChoice = frame >= RPS_PROGRESS_BARS.length - 1
    ? botChoice
    : (["rock", "paper", "scissors"] as Choice[])[frame % 3]!;
  const playerName = playerChoice.charAt(0).toUpperCase() + playerChoice.slice(1);
  const botName = animatedBotChoice.charAt(0).toUpperCase() + animatedBotChoice.slice(1);

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🪨✂️📄  Rock Paper Scissors")
    .setDescription([
      `${EMOJI[playerChoice]} **${playerName}**   vs   **${botName}** ${EMOJI[animatedBotChoice]}`,
      "",
      "🕐 **Choosing…**",
      RPS_PROGRESS_BARS[Math.min(frame, RPS_PROGRESS_BARS.length - 1)]!,
      "",
      `💎 **Bet**  \`${formatAmount(amount)}\``,
    ].join("\n"))
    .setTimestamp();
}

async function animateRps(
  interaction: ChatInputCommandInteraction,
  amount: number,
  playerChoice: Choice,
  botChoice: Choice,
): Promise<void> {
  await interaction.editReply({
    embeds: [rpsAnimationEmbed(amount, playerChoice, botChoice, 0)],
  }).catch(() => null);

  for (let frame = 1; frame < RPS_PROGRESS_BARS.length; frame++) {
    await sleep(350);
    await interaction.editReply({
      embeds: [rpsAnimationEmbed(amount, playerChoice, botChoice, frame)],
    }).catch(() => null);
  }

  await sleep(350);
}

export const data = new SlashCommandBuilder()
  .setName("rps")
  .setDescription("Play Rock Paper Scissors against the bot")
  .addStringOption((opt) =>
    opt
      .setName("amount")
      .setDescription("Bet amount (e.g. 1m, 2.5b)")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("choice")
      .setDescription("Your choice")
      .setRequired(true)
      .addChoices(
        { name: "🪨 Rock",      value: "rock"     },
        { name: "📄 Paper",     value: "paper"    },
        { name: "✂️ Scissors",  value: "scissors" },
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const amountStr    = interaction.options.getString("amount", true);
  const playerChoice = interaction.options.getString("choice", true) as Choice;
  const amount       = parseAmount(amountStr);

  if (!amount || amount < 1_000_000) {
    return interaction.reply({
      embeds: [errorEmbed("Minimum bet is **1M gems**.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount) {
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
    });
  }

  // Bot chooses — biased for 7.5% house edge:
  // P(player_lose)=0.371, P(tie)=0.333, P(player_win)=0.296
  const rr = Math.random();
  const botChoice: Choice =
    rr < 0.371           ? BEATEN_BY[playerChoice]
    : rr < 0.371 + 0.333 ? playerChoice
                          : BEATS[playerChoice];

  const result = getResult(playerChoice, botChoice);

  let netGain = 0;
  let color   = COLORS.primary;
  let outcome = "";

  if (result === "win") {
    netGain = amount;
    color   = COLORS.success;
    outcome = "🎉 You Win!";
  } else if (result === "loss") {
    netGain = -amount;
    color   = COLORS.danger;
    outcome = "💀 You Lose!";
  } else {
    netGain = 0;
    color   = COLORS.warning;
    outcome = "🤝 Tie!";
  }

  await addBalance(interaction.user.id, netGain);
  await recordBet(interaction.user.id, amount, netGain, "rps");

  const playerName = playerChoice.charAt(0).toUpperCase() + playerChoice.slice(1);
  const botName    = botChoice.charAt(0).toUpperCase() + botChoice.slice(1);

  const payout =
    result === "win"  ? `💰 **Payout**  \`${formatAmount(amount * 2)}\`` :
    result === "loss" ? `💰 **Payout**  \`0\`` :
                        `💰 **Payout**  \`${formatAmount(amount)}\``;

  const lines = [
    `${EMOJI[playerChoice]} **${playerName}**   vs   **${botName}** ${EMOJI[botChoice]}`,
    ``,
    `> ${outcome}`,
    ``,
    `💎 **Bet**  \`${formatAmount(amount)}\``,
    payout,
  ];

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle("🪨✂️📄  Rock Paper Scissors")
    .setDescription(lines.join("\n"))
    .setTimestamp();

  await animateRps(interaction, amount, playerChoice, botChoice);
  await interaction.editReply({ embeds: [embed] });
}
