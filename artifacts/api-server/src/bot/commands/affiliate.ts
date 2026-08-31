import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from "discord.js";
import { db, usersTable, sqlite } from "@workspace/db";
import { eq } from "drizzle-orm";
import { errorEmbed } from "../utils.js";
import { getOrCreateUser } from "../utils.js";
import { getServerConfig } from "../botConfig.js";

export const data = new SlashCommandBuilder()
  .setName("affiliate")
  .setDescription("Affiliate to another user (irreversible)")
  .addUserOption((option) =>
    option.setName("user").setDescription("User to affiliate to").setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const target = interaction.options.getUser("user", true);
  if (target.id === interaction.user.id) {
    return interaction.editReply({ embeds: [errorEmbed("You cannot affiliate to yourself.")] });
  }

  const current = sqlite
    .prepare("SELECT affiliate_id FROM users WHERE id = ?")
    .get(interaction.user.id) as { affiliate_id?: string } | undefined;
  if (current?.affiliate_id) {
    return interaction.editReply({
      embeds: [errorEmbed("You are already affiliated to another user. This affiliation is irreversible.")],
    });
  }

  await getOrCreateUser(interaction.user.id, interaction.user.username);
  await getOrCreateUser(target.id, target.username);
  await db
    .update(usersTable)
    .set({ affiliateId: target.id, updatedAt: new Date() })
    .where(eq(usersTable.id, interaction.user.id));

  const cfg = getServerConfig();
  const channel = cfg?.affiliateChannelId
    ? interaction.client.channels.cache.get(cfg.affiliateChannelId)
    : undefined;
  if (channel?.isTextBased()) {
    await (channel as TextChannel).send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("New Affiliation")
          .setDescription(`<@${interaction.user.id}> affiliated to <@${target.id}>.`)
          .setFooter({ text: "💎 PS99Bet" }),
      ],
    });
  }

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("🎁 Affiliation Complete")
        .setDescription(
          `You are now affiliated to <@${target.id}>.\n\nThis affiliation is **irreversible**. They will earn 1% of your wagers, paid by the bot.`,
        ),
    ],
  });
}