import {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { COLORS, errorEmbed } from "../utils.js";
import { isAdmin } from "../botConfig.js";
import { getFrozenUsers, freezeUser, unfreezeUser, isFrozen } from "../botState.js";

export const data = new SlashCommandBuilder()
  .setName("freeze")
  .setDescription("[Admin] Freeze or manage frozen users")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Freeze a user — blocks them from gambling and withdrawing")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("User to freeze").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("View all frozen users and optionally unfreeze one"),
  );

// ─── /freeze add ──────────────────────────────────────────────────────────────
async function handleAdd(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user", true);

  if (isFrozen(target.id)) {
    return interaction.editReply({
      embeds: [errorEmbed(`<@${target.id}> is already frozen.`)],
    });
  }

  freezeUser(target.id);

  const embed = new EmbedBuilder()
    .setColor(COLORS.danger)
    .setTitle("🧊  User Frozen")
    .setDescription(
      `<@${target.id}> has been **frozen**.\n` +
      `They can no longer gamble or submit withdrawal requests.\n\n` +
      `Use \`/freeze list\` to manage frozen users.`,
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ─── /freeze list ─────────────────────────────────────────────────────────────
async function handleList(interaction: ChatInputCommandInteraction) {
  const frozen = getFrozenUsers();

  if (frozen.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle("🧊  Frozen Users")
      .setDescription("No users are currently frozen.")
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  }

  const mentions = frozen.map((id) => `• <@${id}> (\`${id}\`)`).join("\n");

  const embed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle(`🧊  Frozen Users — ${frozen.length}`)
    .setDescription(
      `${mentions}\n\nSelect a user below to **unfreeze** them.`,
    )
    .setTimestamp();

  const options = frozen.slice(0, 25).map((id) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`Unfreeze ${id}`)
      .setValue(id)
      .setDescription(`Remove freeze from user ${id}`)
      .setEmoji("🔓"),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId("freeze_unfreeze_select")
    .setPlaceholder("Select a user to unfreeze…")
    .addOptions(options);

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ─── Main execute ─────────────────────────────────────────────────────────────
export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isAdmin(interaction.user.id)) {
    return interaction.editReply({ embeds: [errorEmbed("Admin only.")] });
  }

  const sub = interaction.options.getSubcommand();
  if (sub === "add")  return handleAdd(interaction);
  if (sub === "list") return handleList(interaction);
}

// ─── Select: unfreeze ─────────────────────────────────────────────────────────
export async function handleUnfreezeSelect(interaction: StringSelectMenuInteraction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ embeds: [errorEmbed("Admin only.")], flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();

  const targetId = interaction.values[0]!;
  unfreezeUser(targetId);

  const remaining = getFrozenUsers();
  const mentions  = remaining.map((id) => `• <@${id}> (\`${id}\`)`).join("\n");

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle("🔓  User Unfrozen")
    .setDescription(
      `<@${targetId}> has been **unfrozen** and can gamble/withdraw again.\n\n` +
      (remaining.length > 0
        ? `**Still frozen:**\n${mentions}`
        : `No users are currently frozen.`),
    )
    .setTimestamp();

  if (remaining.length === 0) {
    await interaction.editReply({ embeds: [embed], components: [] });
  } else {
    const options = remaining.slice(0, 25).map((id) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`Unfreeze ${id}`)
        .setValue(id)
        .setEmoji("🔓"),
    );
    const select = new StringSelectMenuBuilder()
      .setCustomId("freeze_unfreeze_select")
      .setPlaceholder("Select a user to unfreeze…")
      .addOptions(options);
    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select);
    await interaction.editReply({ embeds: [embed], components: [row] });
  }
}
