import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { sqlite } from "@workspace/db";
import { COLORS, errorEmbed } from "../utils.js";
import { isAdmin } from "../botConfig.js";

const CONFIRM_PREFIX = "clear_data_confirm_";
const CANCEL_PREFIX = "clear_data_cancel_";

export const data = new SlashCommandBuilder()
  .setName("clear")
  .setDescription("[Admin] Clear all bot data and start fresh")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("data")
      .setDescription("Permanently delete all balances, history, stats, codes, and settings"),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdmin(interaction.user.id)) {
    await interaction.reply({ embeds: [errorEmbed("Admin only.")], flags: MessageFlags.Ephemeral });
    return;
  }

  const confirmButton = new ButtonBuilder()
    .setCustomId(`${CONFIRM_PREFIX}${interaction.user.id}`)
    .setLabel("Yes, clear everything")
    .setStyle(ButtonStyle.Danger);

  const cancelButton = new ButtonBuilder()
    .setCustomId(`${CANCEL_PREFIX}${interaction.user.id}`)
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>()
    .addComponents(confirmButton, cancelButton);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.danger ?? 0xe74c3c)
        .setTitle("⚠️ Clear all bot data?")
        .setDescription(
          "This permanently deletes **all users, balances, game history, statistics, invite records, promo codes, freezes, disabled games, and server settings**.\n\n" +
          "The database tables will remain available, but the bot will start with no saved data. This cannot be undone.",
        )
        .setFooter({ text: "Only the admin who started this request can confirm it." }),
    ],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleConfirm(interaction: ButtonInteraction): Promise<void> {
  const adminId = interaction.customId.slice(CONFIRM_PREFIX.length);
  if (interaction.user.id !== adminId || !isAdmin(interaction.user.id)) {
    await interaction.reply({ content: "❌ This confirmation is not yours.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();

  // Keep the schema and migrations intact while removing every persisted record.
  // Foreign keys are temporarily disabled because games reference users.
  sqlite.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM users;
    DELETE FROM games;
    DELETE FROM config;
    DELETE FROM bet_log;
    DELETE FROM invite_log;
    DELETE FROM promocodes;
    DELETE FROM promocode_redemptions;
    PRAGMA foreign_keys = ON;
  `);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle("✅ Database cleared")
        .setDescription("All balances, history, stats, codes, settings, and other saved bot data have been permanently deleted. The bot is starting fresh.")
        .setTimestamp(),
    ],
    components: [],
  });
}

export async function handleCancel(interaction: ButtonInteraction): Promise<void> {
  const adminId = interaction.customId.slice(CANCEL_PREFIX.length);
  if (interaction.user.id !== adminId) {
    await interaction.reply({ content: "❌ This confirmation is not yours.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.dark)
        .setDescription("❌ Database clear cancelled. No data was changed."),
    ],
    components: [],
  });
}
