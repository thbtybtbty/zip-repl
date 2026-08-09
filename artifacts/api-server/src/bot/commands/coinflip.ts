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

export const data = new SlashCommandBuilder()
  .setName("coinflip")
  .setDescription("Flip a coin — double or nothing!")
  .addStringOption((opt) =>
    opt.setName("amount").setDescription("Bet amount (e.g. 1m, 2.5b)").setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("choice")
      .setDescription("Heads or tails?")
      .setRequired(true)
      .addChoices(
        { name: "🪙 Heads", value: "heads" },
        { name: "🔵 Tails", value: "tails" },
      ),
  );

const SIDES = ["heads", "tails"] as const;

const SIDE_DISPLAY: Record<string, string> = {
  heads: "🪙 Heads",
  tails: "🔵 Tails",
};

const FLIP_PROGRESS_BARS = [
  "▰▱▱▱▱▱",
  "▰▰▱▱▱▱",
  "▰▰▰▱▱▱",
  "▰▰▰▰▱▱",
  "▰▰▰▰▰▱",
  "▰▰▰▰▰▰",
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function coinflipAnimationEmbed(amount: number, choice: string, result: string, frame: number): EmbedBuilder {
  const animatedResult = frame >= FLIP_PROGRESS_BARS.length - 1
    ? result
    : (frame % 2 === 0 ? "heads" : "tails");

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🪙  Coin Flip")
    .setDescription([
      `🎯 **Your pick**  \`${SIDE_DISPLAY[choice]!}\``,
      `🪙 **Result**     \`${SIDE_DISPLAY[animatedResult]!}\``,
      `💎 **Bet**        \`${formatAmount(amount)}\``,
      "",
      "🕐 **Flipping the coin…**",
      FLIP_PROGRESS_BARS[Math.min(frame, FLIP_PROGRESS_BARS.length - 1)]!,
    ].join("\n"))
    .setTimestamp();
}

async function animateCoinflip(
  interaction: ChatInputCommandInteraction,
  amount: number,
  choice: string,
  result: string,
): Promise<void> {
  await interaction.editReply({ embeds: [coinflipAnimationEmbed(amount, choice, result, 0)] }).catch(() => null);

  for (let frame = 1; frame < FLIP_PROGRESS_BARS.length; frame++) {
    await sleep(350);
    await interaction
      .editReply({ embeds: [coinflipAnimationEmbed(amount, choice, result, frame)] })
      .catch(() => null);
  }

  await sleep(350);
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const amountStr = interaction.options.getString("amount", true);
  const choice    = interaction.options.getString("choice", true);
  const amount    = parseAmount(amountStr);

  if (!amount || amount < 1_000_000) {
    return interaction.reply({
      embeds: [errorEmbed("Minimum bet is **1M gems**. Try `1m`, `2.5b`, `500k`.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);

  if (user.balance < amount) {
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} gems**.`)],
    });
  }

  // Flip — P(win) = 0.4625 → house edge 7.5%
  const won    = Math.random() < 0.4625;
  const result = (won ? choice : (choice === "heads" ? "tails" : "heads")) as typeof SIDES[number];
  const payout  = won ? amount : -amount;
  const newBal  = await addBalance(interaction.user.id, payout);
  await recordBet(interaction.user.id, amount, payout, "coinflip");

  await animateCoinflip(interaction, amount, choice, result);

  const embed = new EmbedBuilder()
    .setColor(won ? COLORS.success : COLORS.danger)
    .setTitle(won ? "🪙  Coin Flip — You Win!" : "🪙  Coin Flip — You Lose!")
    .setDescription(
      [
        `🎯 **Your pick**  \`${SIDE_DISPLAY[choice]!}\``,
        `🪙 **Result**     \`${SIDE_DISPLAY[result]!}\``,
        `💎 **Bet**        \`${formatAmount(amount)}\``,
        won
          ? `💰 **Payout**     \`${formatAmount(amount * 2)}\``
          : `💰 **Payout**     \`0\``,
      ].join("\n"),
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
