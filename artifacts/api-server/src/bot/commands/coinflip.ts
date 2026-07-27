import {
  SlashCommandBuilder,
  EmbedBuilder,
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

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const amountStr = interaction.options.getString("amount", true);
  const choice    = interaction.options.getString("choice", true);
  const amount    = parseAmount(amountStr);

  if (!amount || amount < 1_000_000) {
    return interaction.editReply({
      embeds: [errorEmbed("Minimum bet is **1M gems**. Try `1m`, `2.5b`, `500k`.")],
    });
  }

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
