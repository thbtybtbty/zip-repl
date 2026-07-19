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

  if (!amount || amount <= 0) {
    return interaction.editReply({
      embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")],
    });
  }

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);

  if (user.balance < amount) {
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} gems**.`)],
    });
  }

  // Flip
  const result  = SIDES[Math.floor(Math.random() * 2)]!;
  const won     = result === choice;
  const payout  = won ? amount : -amount;
  const newBal  = await addBalance(interaction.user.id, payout);

  const embed = new EmbedBuilder()
    .setColor(won ? COLORS.success : COLORS.danger)
    .setTitle("🪙  Coin Flip")
    .addFields(
      { name: "Your pick",  value: SIDE_DISPLAY[choice]!,  inline: true },
      { name: "Result",     value: SIDE_DISPLAY[result]!,  inline: true },
      { name: "\u200b",     value: "\u200b",               inline: true },
      {
        name:   won ? "🎉 Won" : "💀 Lost",
        value:  `${won ? "+" : "-"}${formatAmount(amount)} gems`,
        inline: true,
      },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
