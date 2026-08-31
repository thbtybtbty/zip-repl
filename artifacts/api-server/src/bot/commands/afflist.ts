import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { sqlite } from "@workspace/db";
import { isAdmin } from "../botConfig.js";
import { formatAmount, errorEmbed } from "../utils.js";

export const data = new SlashCommandBuilder()
  .setName("afflist")
  .setDescription("View a user's affiliation list")
  .addUserOption((option) =>
    option.setName("user").setDescription("User whose affiliates to view").setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const target = interaction.options.getUser("user", false) ?? interaction.user;
  if (target.id !== interaction.user.id && !isAdmin(interaction.user.id)) {
    return interaction.editReply({
      embeds: [errorEmbed("Only admins can view another member's affiliation list.")],
    });
  }

  const rows = sqlite
    .prepare(
      "SELECT id, username, wagered FROM users WHERE affiliate_id = ? ORDER BY wagered DESC, username ASC LIMIT 25",
    )
    .all(target.id) as Array<{ id: string; wagered?: number }>;
  const lines = rows.length
    ? rows.map((row, index) =>
        `${index < 3 ? ["🥇", "🥈", "🥉"][index] : `#${index + 1}`} <@${row.id}> — ${formatAmount(Number(row.wagered ?? 0))} wagered`,
      ).join("\n")
    : "*No affiliated users yet.*";

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Affiliation List")
        .setDescription(lines)
        .setThumbnail(target.displayAvatarURL({ size: 256 }))
        .setTimestamp(),
    ],
  });
}