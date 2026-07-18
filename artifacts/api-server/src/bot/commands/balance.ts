import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { COLORS, GEM, formatAmount, getOrCreateUser } from "../utils.js";

export const data = new SlashCommandBuilder()
  .setName("balance")
  .setDescription("View your current gem balance");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const user = await getOrCreateUser(
    interaction.user.id,
    interaction.user.username,
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(`${GEM} Gem Balance`)
    .setDescription(
      [
        `> **${interaction.user.displayName}**`,
        ``,
        `\`\`\``,
        `  💰  ${formatAmount(user.balance)} gems`,
        `\`\`\``,
      ].join("\n"),
    )
    .setFooter({ text: "Earn more by playing games!" })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
