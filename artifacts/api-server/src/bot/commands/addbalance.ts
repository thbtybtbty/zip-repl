import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { COLORS, formatAmount, getOrCreateUser, addBalance, errorEmbed } from "../utils.js";
import { isAdmin } from "../botConfig.js";
import { db, betLogTable } from "@workspace/db";

// ─── Pending sessions (userId of admin → target user info) ───────────────────
interface PendingSession {
  adminId: string;
  targetUserId: string;
  targetUsername: string;
}

export const pendingSessions = new Map<string, PendingSession>(); // sessionId → data

function makeSessionId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("addbalance")
  .setDescription("[Admin] Add gems to a user's balance")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("The user to add gems to").setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isAdmin(interaction.user.id)) {
    return interaction.editReply({ embeds: [errorEmbed("You don't have permission to use this command.")] });
  }

  const targetUser = interaction.options.getUser("user", true);
  const dbUser = await getOrCreateUser(targetUser.id, targetUser.username);

  const sessionId = makeSessionId();
  pendingSessions.set(sessionId, {
    adminId: interaction.user.id,
    targetUserId: targetUser.id,
    targetUsername: targetUser.username,
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle("➕ Add Balance")
    .setDescription(
      `**<@${targetUser.id}>** currently has **${formatAmount(dbUser.balance)} 💎 gems**.\n\n` +
      `Click **Enter Amount & Reason** to proceed, or **Cancel** to abort.`,
    )
    .setTimestamp();

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`addbalnc_enter_${sessionId}`)
      .setLabel("Enter Amount & Reason")
      .setEmoji("💎")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`addbalnc_cancel_${sessionId}`)
      .setLabel("Cancel")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ─── Button: admin clicked "Enter Amount & Reason" ────────────────────────────
export async function handleEnter(interaction: ButtonInteraction, sessionId: string) {
  const session = pendingSessions.get(sessionId);
  if (!session) {
    return interaction.reply({ content: "❌ Session expired.", flags: MessageFlags.Ephemeral });
  }
  if (interaction.user.id !== session.adminId) {
    return interaction.reply({ content: "❌ This is not your action.", flags: MessageFlags.Ephemeral });
  }

  const modal = new ModalBuilder()
    .setCustomId(`addbalnc_modal_${sessionId}`)
    .setTitle("Add Balance");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("amount")
        .setLabel("Amount of gems to add (e.g. 1m, 2.5b)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("e.g. 5m"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Reason")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder("e.g. Compensation for bug, manual top-up…"),
    ),
  );

  await interaction.showModal(modal);
}

// ─── Button: admin clicked "Cancel" ───────────────────────────────────────────
export async function handleCancelBtn(interaction: ButtonInteraction, sessionId: string) {
  const session = pendingSessions.get(sessionId);
  if (session) {
    if (interaction.user.id !== session.adminId) {
      return interaction.reply({ content: "❌ This is not your action.", flags: MessageFlags.Ephemeral });
    }
    pendingSessions.delete(sessionId);
  }
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.dark)
        .setDescription("❌ Action cancelled.")
        .setTimestamp(),
    ],
    components: [],
  });
}

// ─── Modal: admin submitted amount + reason ────────────────────────────────────
export async function handleModal(interaction: ModalSubmitInteraction, sessionId: string) {
  await interaction.deferUpdate();

  const session = pendingSessions.get(sessionId);
  if (!session) {
    return interaction.followUp({ content: "❌ Session expired.", flags: MessageFlags.Ephemeral });
  }

  const amountStr = interaction.fields.getTextInputValue("amount");
  const reason = interaction.fields.getTextInputValue("reason");

  // Parse shorthand amounts
  const lower = amountStr.toLowerCase().trim();
  const match = lower.match(/^(\d+(?:\.\d+)?)\s*([kmb]?)$/);
  let amount = 0;
  if (match) {
    const num = parseFloat(match[1]!);
    const suf = match[2] ?? "";
    if (suf === "b") amount = Math.floor(num * 1_000_000_000);
    else if (suf === "m") amount = Math.floor(num * 1_000_000);
    else if (suf === "k") amount = Math.floor(num * 1_000);
    else amount = Math.floor(num);
  }

  if (!amount || amount <= 0) {
    return interaction.followUp({
      content: "❌ Invalid amount. Try `1m`, `2.5b`, `500k`.",
      flags: MessageFlags.Ephemeral,
    });
  }

  pendingSessions.delete(sessionId);
  const newBalance = await addBalance(session.targetUserId, amount);

  // Log as admin-grant so economy stats can deduct it from house profit
  await db.insert(betLogTable).values({
    userId:   session.targetUserId,
    command:  "admin-grant",
    bet:      amount,
    netDelta: -amount,
  });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle("✅ Balance Added")
        .addFields(
          { name: "👤 User", value: `<@${session.targetUserId}>`, inline: true },
          { name: "➕ Added", value: `${formatAmount(amount)} 💎 gems`, inline: true },
          { name: "💰 New Balance", value: `${formatAmount(newBalance)} 💎 gems`, inline: true },
          { name: "📝 Reason", value: reason, inline: false },
        )
        .setTimestamp(),
    ],
    components: [],
  });

  // DM the user
  try {
    const user = await interaction.client.users.fetch(session.targetUserId);
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.success)
          .setTitle("💎 Gems Added to Your Balance!")
          .setDescription(
            `**${formatAmount(amount)} 💎 gems** have been added to your balance by a moderator.\n\n` +
            `**Reason:** ${reason}\n` +
            `**New Balance:** ${formatAmount(newBalance)} 💎 gems`,
          )
          .setTimestamp(),
      ],
    });
  } catch {
    // DM failed — ignore silently
  }
}
