import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  COLORS,
  GEM,
  parseAmount,
  formatAmount,
  getOrCreateUser,
  addBalance,
  errorEmbed,
} from "../utils.js";

type Choice = "rock" | "paper" | "scissors";

const EMOJI: Record<Choice, string> = {
  rock: "🪨",
  paper: "📄",
  scissors: "✂️",
};

const BEATS: Record<Choice, Choice> = {
  rock: "scissors",
  paper: "rock",
  scissors: "paper",
};

// What beats each choice (inverse of BEATS)
const BEATEN_BY: Record<Choice, Choice> = {
  rock: "paper",
  paper: "scissors",
  scissors: "rock",
};

const CHOICES: Choice[] = ["rock", "paper", "scissors"];

function getResult(
  player: Choice,
  bot: Choice,
): "win" | "loss" | "tie" {
  if (player === bot) return "tie";
  if (BEATS[player] === bot) return "win";
  return "loss";
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
        { name: "🪨 Rock", value: "rock" },
        { name: "📄 Paper", value: "paper" },
        { name: "✂️ Scissors", value: "scissors" },
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const amountStr = interaction.options.getString("amount", true);
  const playerChoice = interaction.options.getString("choice", true) as Choice;

  // Parse amount
  const amount = parseAmount(amountStr);
  if (!amount || amount <= 0) {
    return interaction.editReply({
      embeds: [
        errorEmbed("Invalid amount. Use formats like `1m`, `2.5b`, `500k`."),
      ],
    });
  }

  // Get/create user
  const user = await getOrCreateUser(
    interaction.user.id,
    interaction.user.username,
  );

  if (user.balance < amount) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(user.balance)} gems**.`,
        ),
      ],
    });
  }

  // Bot chooses — biased for 7.5% house edge:
  // P(player_lose)=0.371, P(tie)=0.333, P(player_win)=0.296
  const rr = Math.random();
  const botChoice: Choice =
    rr < 0.371               ? BEATEN_BY[playerChoice]   // bot wins
    : rr < 0.371 + 0.333     ? playerChoice              // tie
                              : BEATS[playerChoice];      // player wins
  const result = getResult(playerChoice, botChoice);

  // Calculate payout
  let payout = 0;
  let resultText = "";
  let color = COLORS.primary;

  if (result === "win") {
    payout = amount; // net gain
    resultText = "🎉 You Win!";
    color = COLORS.success;
  } else if (result === "loss") {
    payout = -amount;
    resultText = "💀 You Lose!";
    color = COLORS.danger;
  } else {
    payout = 0;
    resultText = "🤝 It's a Tie!";
    color = COLORS.warning;
  }

  const newBalance = await addBalance(interaction.user.id, payout);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle("🪨✂️📄  Rock Paper Scissors")
    .addFields(
      {
        name: "Your pick",
        value: `${EMOJI[playerChoice]}  ${playerChoice.charAt(0).toUpperCase() + playerChoice.slice(1)}`,
        inline: true,
      },
      {
        name: "Bot's pick",
        value: `${EMOJI[botChoice]}  ${botChoice.charAt(0).toUpperCase() + botChoice.slice(1)}`,
        inline: true,
      },
      { name: "\u200b", value: "\u200b", inline: true },
      {
        name: "Result",
        value: resultText,
        inline: true,
      },
      {
        name: payout >= 0 ? "Won" : "Lost",
        value: `${payout >= 0 ? "+" : ""}${formatAmount(Math.abs(payout))} ${GEM}`,
        inline: true,
      },
      { name: "\u200b", value: "\u200b", inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
