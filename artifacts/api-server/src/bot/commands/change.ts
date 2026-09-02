import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { COLORS, errorEmbed, getOrCreateUser } from "../utils.js";
import { findRobloxUser, getRobloxProfile, RobloxApiError } from "../roblox.js";
import { isAdmin } from "../botConfig.js";

export const data = new SlashCommandBuilder()
  .setName("change")
  .setDescription("Admin account changes")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("link")
      .setDescription("Change a member's linked Roblox account")
      .addUserOption((option) =>
        option.setName("user").setDescription("Discord member to update").setRequired(true),
      )
      .addStringOption((option) =>
        option.setName("roblox_username").setDescription("New Roblox username").setRequired(true),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!isAdmin(interaction.user.id)) {
    return interaction.editReply({ embeds: [errorEmbed("You don't have permission to use this command.")] });
  }

  const target = interaction.options.getUser("user", true);
  const requestedUsername = interaction.options.getString("roblox_username", true).trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(requestedUsername)) {
    return interaction.editReply({
      embeds: [errorEmbed("Invalid Roblox username. Use 3–20 letters, numbers, or underscores.")],
    });
  }

  try {
    const robloxUser = await findRobloxUser(requestedUsername);
    if (!robloxUser) {
      return interaction.editReply({
        embeds: [errorEmbed(`Roblox could not find **${requestedUsername}**.`)],
      });
    }

    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.robloxUserId, robloxUser.id))
      .limit(1);
    if (existing[0] && existing[0].id !== target.id) {
      return interaction.editReply({
        embeds: [errorEmbed("That Roblox account is already linked to another Discord account.")],
      });
    }

    const profile = await getRobloxProfile(robloxUser.id);
    await getOrCreateUser(target.id, target.username);
    await db
      .update(usersTable)
      .set({
        robloxUsername: profile.name,
        robloxUserId: profile.id,
        robloxPendingUsername: null,
        robloxVerificationPhrase: null,
        robloxVerificationExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, target.id));

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.success)
          .setTitle("✅ Linked Roblox Account Changed")
          .setDescription(`Linked **${target.username}** to Roblox account **${profile.name}**.`)
          .setTimestamp(),
      ],
    });
  } catch (error) {
    const message = error instanceof RobloxApiError
      ? error.message
      : "The Roblox account could not be changed right now. Please try again shortly.";
    return interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}