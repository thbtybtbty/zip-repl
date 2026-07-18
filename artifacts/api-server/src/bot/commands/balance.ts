import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { COLORS, getOrCreateUser } from "../utils.js";

export const data = new SlashCommandBuilder()
  .setName("balance")
  .setDescription("View your PS99 Gem balance");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const user = await getOrCreateUser(
    interaction.user.id,
    interaction.user.username,
  );

  const formatted = user.balance.toLocaleString("en-US");

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setAuthor({
      name: `${interaction.user.displayName}'s Wallet`,
      iconURL: interaction.user.displayAvatarURL(),
    })
    .setTitle("💎  PS99 Gems")
    .setDescription(`\`\`\`\n  💰  ${formatted}\n\`\`\``)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
