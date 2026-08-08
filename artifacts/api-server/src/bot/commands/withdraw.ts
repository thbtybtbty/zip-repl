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
  type TextChannel,
} from "discord.js";
import { COLORS, parseAmount, formatAmount, getOrCreateUser, addBalance, addWithdrawn, errorEmbed } from "../utils.js";
import { getServerConfig } from "../botConfig.js";

// ─── Pending requests ─────────────────────────────────────────────────────────
interface PendingWithdraw {
  userId: string;
  username: string;
  amount: number;
  robloxUser: string;
}

export const pendingWithdraws = new Map<string, PendingWithdraw>();

// ─── Approved announcement data (for "View Details" button) ───────────────────
interface WithdrawAnnouncementData {
  userId: string;
  amount: number;
  adminId: string;
  robloxUser: string;
}
export const withdrawAnnouncements = new Map<string, WithdrawAnnouncementData>();

function makeReqId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("withdraw")
  .setDescription("Request to withdraw gems from your balance")
  .addStringOption((opt) =>
    opt.setName("amount").setDescription("Amount of gems to withdraw (e.g. 1m, 2.5b)").setRequired(true),
  )
  .addStringOption((opt) =>
    opt.setName("send_to").setDescription("Your Roblox username — gems will be sent to this account").setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const cfg = getServerConfig();
  if (!cfg) {
    return interaction.editReply({
      embeds: [errorEmbed("The bot hasn't been configured yet. Ask an admin to run `/setup`.")],
    });
  }

  const amountStr = interaction.options.getString("amount", true);
  const robloxUser = interaction.options.getString("send_to", true);
  const amount = parseAmount(amountStr);

  if (!amount || amount <= 0) {
    return interaction.editReply({ embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")] });
  }

  if (cfg.minWithdraw && amount < cfg.minWithdraw) {
    return interaction.editReply({
      embeds: [errorEmbed(
        `The minimum withdrawal is **${formatAmount(cfg.minWithdraw)} 💎 gems**.`,
      )],
    });
  }

  const dbUser = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (dbUser.balance < amount) {
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(dbUser.balance)} 💎 gems**.`)],
    });
  }

  const lockedBalance = dbUser.lockedBalance ?? 0;
  const withdrawable  = Math.max(0, dbUser.balance - lockedBalance);
  if (amount > withdrawable) {
    return interaction.editReply({
      embeds: [errorEmbed(
        `You can only withdraw **${formatAmount(withdrawable)} 💎** right now.\n\n` +
        `**${formatAmount(lockedBalance)} 💎** of your balance is locked (welcome bonus, rain winnings, promo codes, or tips received) and must be wagered at **1.8× or higher** before it can be withdrawn.`,
      )],
    });
  }

  const reqId = makeReqId();
  pendingWithdraws.set(reqId, {
    userId: interaction.user.id,
    username: interaction.user.username,
    amount,
    robloxUser,
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle("📤 Withdraw Request")
    .setDescription(
      `You requested to withdraw **${formatAmount(amount)} 💎 gems** to Roblox account: **${robloxUser}**.\n\n` +
      `Click **Accept** to confirm your withdrawal request, or **Cancel** to abort.`,
    )
    .setTimestamp();

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`with_confirm_${reqId}`)
      .setLabel("Accept")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`with_cancel_${reqId}`)
      .setLabel("Cancel")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ─── Button: player clicked "Accept" ──────────────────────────────────────────
export async function handleConfirm(interaction: ButtonInteraction, reqId: string) {
  const req = pendingWithdraws.get(reqId);
  if (!req) {
    return interaction.reply({ content: "❌ This request is no longer active.", flags: MessageFlags.Ephemeral });
  }
  if (interaction.user.id !== req.userId) {
    return interaction.reply({ content: "❌ This is not your withdrawal request.", flags: MessageFlags.Ephemeral });
  }

  // Deduct gems
  await addBalance(req.userId, -req.amount);

  const cfg = getServerConfig();

  // Update player's ephemeral panel
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle("📤 Withdrawal Recorded")
        .setDescription(
          `Your withdrawal of **${formatAmount(req.amount)} 💎 gems** to Roblox account **${req.robloxUser}** has been recorded.\n\n` +
          `The moderators will send the gems and you will receive a DM by this bot when the gems have been sent to your account.\n\n` +
          `Thank you!`,
        )
        .setTimestamp(),
    ],
    components: [],
  });

  // DM the player — withdrawal is being checked
  try {
    const dmUser = await interaction.client.users.fetch(req.userId);
    await dmUser.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.warning)
          .setTitle("⏳ Withdrawal Checking")
          .setDescription(
            `Your withdrawal of **${formatAmount(req.amount)} 💎** gems will be sent to your Roblox account **${req.robloxUser}** via mailbox.\n\n` +
            `You will receive another DM when your withdrawal has been processed.`,
          )
          .setTimestamp(),
      ],
    });
  } catch {
    // DMs disabled — ignore silently
  }

  if (!cfg) return;

  // Send to request channel
  const requestChannel = interaction.client.channels.cache.get(cfg.requestChannelId) as TextChannel | undefined;
  if (!requestChannel) return;

  const reqEmbed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle("📤 Withdraw Request")
    .addFields(
      { name: "👤 From", value: `<@${req.userId}>`, inline: true },
      { name: "💎 Amount", value: `${formatAmount(req.amount)} gems`, inline: true },
      { name: "🎮 Send Gems To (Roblox)", value: `\`${req.robloxUser}\``, inline: true },
    )
    .setTimestamp();

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`with_approve_${reqId}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`with_disapprove_${reqId}`)
      .setLabel("Disapprove")
      .setStyle(ButtonStyle.Danger),
  );

  await requestChannel.send({ embeds: [reqEmbed], components: [row] });
}

// ─── Button: player clicked "Cancel" ──────────────────────────────────────────
export async function handleCancel(interaction: ButtonInteraction, reqId: string) {
  const req = pendingWithdraws.get(reqId);
  if (!req) {
    return interaction.update({ embeds: [], components: [], content: "Already processed." });
  }
  if (interaction.user.id !== req.userId) {
    return interaction.reply({ content: "❌ This is not your withdrawal request.", flags: MessageFlags.Ephemeral });
  }

  pendingWithdraws.delete(reqId);
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.dark)
        .setDescription("❌ Withdrawal cancelled.")
        .setTimestamp(),
    ],
    components: [],
  });
}

// ─── Button: mod clicked "Approve" — show modal for reason ────────────────────
export async function handleApprove(interaction: ButtonInteraction, reqId: string) {
  const req = pendingWithdraws.get(reqId);
  if (!req) {
    return interaction.reply({ content: "❌ This request has already been processed.", flags: MessageFlags.Ephemeral });
  }

  const modal = new ModalBuilder()
    .setCustomId(`with_approve_modal_${reqId}`)
    .setTitle("Approve Withdrawal — Add Note");

  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Note / confirmation message")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder("e.g. Gems sent, check your mailbox…");

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
  await interaction.showModal(modal);
}

// ─── Modal: mod approved with note ────────────────────────────────────────────
export async function handleApproveModal(interaction: ModalSubmitInteraction, reqId: string) {
  await interaction.deferUpdate();

  const req = pendingWithdraws.get(reqId);
  if (!req) {
    return interaction.followUp({ content: "❌ This request has already been processed.", flags: MessageFlags.Ephemeral });
  }

  const reason = interaction.fields.getTextInputValue("reason");
  pendingWithdraws.delete(reqId);
  // Gems were already deducted when player confirmed — no further deduction needed
  await addWithdrawn(req.userId, req.amount);

  const adminId = interaction.user.id;

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle("✅ Withdrawal Approved")
        .addFields(
          { name: "👤 From", value: `<@${req.userId}>`, inline: true },
          { name: "📥 Amount", value: `${formatAmount(req.amount)} gems`, inline: true },
          { name: "🎮 Sent To (Roblox)", value: `\`${req.robloxUser}\``, inline: true },
          { name: "🛡️ By", value: `<@${adminId}>`, inline: true },
          { name: "📝 Note", value: reason, inline: false },
        )
        .setTimestamp(),
    ],
    components: [],
  });

  // Announce in withdraw channel with embed + View Details button
  const cfg2 = getServerConfig();
  if (cfg2) {
    const withCh = interaction.client.channels.cache.get(cfg2.withdrawChannelId) as TextChannel | undefined;
    if (withCh) {
      const bot = interaction.client.user!;
      const announceEmbed = new EmbedBuilder()
        .setColor(COLORS.warning)
        .setTitle("Withdrawal Confirmed")
        .addFields(
          { name: "📥 Amount", value: formatAmount(req.amount), inline: false },
          { name: "User", value: `<@${req.userId}>`, inline: false },
        )
        .setFooter({ text: bot.username, iconURL: bot.displayAvatarURL() });

      const viewRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`with_viewdetails_${reqId}`)
          .setLabel("View Details")
          .setStyle(ButtonStyle.Secondary),
      );

      withdrawAnnouncements.set(reqId, { userId: req.userId, amount: req.amount, adminId, robloxUser: req.robloxUser });

      await withCh.send({
        content: `<@${req.userId}> withdrew **${formatAmount(req.amount)} 💎**`,
        embeds: [announceEmbed],
        components: [viewRow],
      });
    }
  }

  // DM the player
  try {
    const user = await interaction.client.users.fetch(req.userId);
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.success)
          .setTitle("📥 Withdrawal Approved!")
          .setDescription(
            `Your withdrawal of **${formatAmount(req.amount)} gems** to Roblox account **${req.robloxUser}** has been processed.\n\n**Note:** ${reason}`,
          )
          .setTimestamp(),
      ],
    });
  } catch {
    // DM failed — ignore silently
  }
}

// ─── Button: anyone clicks "View Details" on the withdrawal announcement ───────
export async function handleViewDetails(interaction: ButtonInteraction, reqId: string) {
  const data = withdrawAnnouncements.get(reqId);
  if (!data) {
    return interaction.reply({ content: "❌ Details no longer available.", flags: MessageFlags.Ephemeral });
  }

  const bot = interaction.client.user!;
  const embed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle("Withdrawal Details")
    .setDescription(
      `📥 **Gems:** ${formatAmount(data.amount)}\n` +
      `🌿 **Pet RAP:** 0\n\n` +
      `**Approved by:** <@${data.adminId}>`,
    )
    .setFooter({ text: bot.username, iconURL: bot.displayAvatarURL() });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ─── Button: mod clicked "Disapprove" — show modal for reason ─────────────────
export async function handleDisapprove(interaction: ButtonInteraction, reqId: string) {
  const req = pendingWithdraws.get(reqId);
  if (!req) {
    return interaction.reply({ content: "❌ This request has already been processed.", flags: MessageFlags.Ephemeral });
  }

  const modal = new ModalBuilder()
    .setCustomId(`with_disapprove_modal_${reqId}`)
    .setTitle("Disapprove Withdrawal — Enter Reason");

  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Reason for disapproval")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder("e.g. Suspicious activity, invalid request…");

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
  await interaction.showModal(modal);
}

// ─── Modal: mod disapproved with reason ───────────────────────────────────────
export async function handleDisapproveModal(interaction: ModalSubmitInteraction, reqId: string) {
  await interaction.deferUpdate();

  const req = pendingWithdraws.get(reqId);
  if (!req) {
    return interaction.followUp({ content: "❌ This request has already been processed.", flags: MessageFlags.Ephemeral });
  }

  const reason = interaction.fields.getTextInputValue("reason");
  pendingWithdraws.delete(reqId);

  // Refund gems
  await addBalance(req.userId, req.amount);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.danger)
        .setTitle("❌ Withdrawal Disapproved")
        .addFields(
          { name: "👤 User", value: `<@${req.userId}>`, inline: true },
          { name: "💎 Amount", value: `${formatAmount(req.amount)} gems`, inline: true },
          { name: "🛡️ By", value: `<@${interaction.user.id}>`, inline: true },
          { name: "📝 Reason", value: reason, inline: false },
        )
        .setTimestamp(),
    ],
    components: [],
  });

  // DM the player
  try {
    const user = await interaction.client.users.fetch(req.userId);
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.danger)
          .setTitle("❌ Withdrawal Disapproved")
          .setDescription(
            `Your withdrawal of **${formatAmount(req.amount)} 💎 gems** was disapproved and your gems have been refunded.\n\n**Reason:** ${reason}`,
          )
          .setTimestamp(),
      ],
    });
  } catch {
    // DM failed — ignore silently
  }
}
