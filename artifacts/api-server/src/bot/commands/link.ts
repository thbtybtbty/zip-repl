import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db, usersTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { COLORS, getOrCreateUser, errorEmbed } from "../utils.js";

export const data = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Link your Roblox username to your Discord account for automatic mailbox deposits")
  .addStringOption((opt) =>
    opt
      .setName("roblox_username")
      .setDescription("Your exact Roblox username")
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const robloxUsername = interaction.options.getString("roblox_username", true).trim();

  if (!robloxUsername || robloxUsername.length < 3 || robloxUsername.length > 20) {
    return interaction.editReply({
      embeds: [errorEmbed("Invalid Roblox username. Must be between 3 and 20 characters.")],
    });
  }

  // Check if this Roblox username is already linked to a DIFFERENT Discord account
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.robloxUsername, robloxUsername))
    .limit(1);

  if (existing[0] && existing[0].id !== interaction.user.id) {
    return interaction.editReply({
      embeds: [errorEmbed(`The Roblox username **${robloxUsername}** is already linked to another Discord account.`)],
    });
  }

  // Ensure the user row exists
  await getOrCreateUser(interaction.user.id, interaction.user.username);

  // Save the link
  await db
    .update(usersTable)
    .set({ robloxUsername, updatedAt: new Date() })
    .where(eq(usersTable.id, interaction.user.id));

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle("✅ Roblox Account Linked")
        .setDescription(
          `Your Roblox username **${robloxUsername}** has been linked to your Discord account.\n\n` +
          `From now on, gems you send via the PS99 mailbox will be credited to your balance automatically.`,
        )
        .setTimestamp(),
    ],
  });
}
