import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  GEM,
  parseAmount,
  formatAmount,
  getOrCreateUser,
  addBalance,
  errorEmbed,
} from "../utils.js";

const MIN_TIP = 1_000_000; // 1M

export const data = new SlashCommandBuilder()
  .setName("tip")
  .setDescription("Send gems to another user")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("Who to tip").setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("amount")
      .setDescription("Amount to tip (e.g. 1m, 2.5b)")
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const target = interaction.options.getUser("user", true);
  const amountStr = interaction.options.getString("amount", true);

  // Validate target
  if (target.id === interaction.user.id) {
    return interaction.editReply({
      embeds: [errorEmbed("You can't tip yourself.")],
    });
  }
  if (target.bot) {
    return interaction.editReply({
      embeds: [errorEmbed("You can't tip a bot.")],
    });
  }

  // Parse amount
  const amount = parseAmount(amountStr);
  if (!amount || amount < MIN_TIP) {
    return interaction.editReply({
      embeds: [
        errorEmbed(`Minimum tip is **1M gems**. Use \`m\` for million, \`b\` for billion.`),
      ],
    });
  }

  // Ensure users exist
  const [sender] = await Promise.all([
    getOrCreateUser(interaction.user.id, interaction.user.username),
    getOrCreateUser(target.id, target.username),
  ]);

  // Check balance
  if (sender.balance < amount) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(sender.balance)} gems**.`,
        ),
      ],
    });
  }

  // Transfer
  await Promise.all([
    addBalance(interaction.user.id, -amount),
    addBalance(target.id, amount),
  ]);

  await interaction.editReply({
    content: `<@${interaction.user.id}> tipped **${formatAmount(amount)} gems** ${GEM} to <@${target.id}>!`,
  });
}
