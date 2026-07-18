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
import { COLORS, parseAmount, formatAmount, addBalance, errorEmbed } from "../utils.js";
import { getServerConfig } from "../botConfig.js";

// ─── Pending requests ─────────────────────────────────────────────────────────
interface PendingDeposit {
  userId: string;
  username: string;
  amount: number;
}

export const pendingDeposits = new Map<string, PendingDeposit>();

function makeReqId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("deposit")
  .setDescription("Request to deposit gems into your balance")
  .addStringOption((opt) =>
    opt.setName("amount").setDescription("Amount of gems to deposit (e.g. 1m, 2.5b)").setRequired(true),
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
  const amount = parseAmount(amountStr);

  if (!amount || amount <= 0) {
    return interaction.editReply({ embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")] });
  }

  const reqId = makeReqId();
  pendingDeposits.set(reqId, {
    userId: interaction.user.id,
    username: interaction.user.username,
    amount,
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("📥 Deposit Request")
    .setDescription(
      `You requested a **${formatAmount(amount)} 💎** gems deposit.\n\n` +
      `Please send that amount of gems in the mailbox to the account: **${cfg.robloxUser}**\n\n` +
      `When you sent the gems to the mailbox, please click the button **Sent**.\n` +
      `If you want to cancel the deposit click the button **Cancel**.`,
    )
    .setTimestamp();

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`dep_sent_${reqId}`)
      .setLabel("Sent")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`dep_cancel_${reqId}`)
      .setLabel("Cancel")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ─── Button: player clicked "Sent" ────────────────────────────────────────────
export async function handleSent(interaction: ButtonInteraction, reqId: string) {
  const req = pendingDeposits.get(reqId);
  if (!req) {
    return interaction.reply({ content: "❌ This request is no longer active.", flags: MessageFlags.Ephemeral });
  }
  if (interaction.user.id !== req.userId) {
    return interaction.reply({ content: "❌ This is not your deposit request.", flags: MessageFlags.Ephemeral });
  }

  const cfg = getServerConfig();

  // Edit the player's ephemeral panel to "pending review"
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.warning)
        .setTitle("⏳ Deposit Pending Review")
        .setDescription(
          `Your deposit request will be reviewed by the mods.\n` +
          `When they confirm the deposit you will be sent a DM by this bot and your gems will be added to your balance.\n\n` +
          `Thank you!`,
        )
        .setTimestamp(),
    ],
    components: [],
  });

  if (!cfg) return;

  // Send to request channel
  const requestChannel = interaction.client.channels.cache.get(cfg.requestChannelId) as TextChannel | undefined;
  if (!requestChannel) return;

  const reqEmbed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("📥 Deposit Request")
    .addFields(
      { name: "👤 User", value: `<@${req.userId}>`, inline: true },
      { name: "💎 Amount", value: `${formatAmount(req.amount)} gems`, inline: true },
    )
    .setTimestamp();

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`dep_approve_${reqId}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`dep_notapprove_${reqId}`)
      .setLabel("Not Approve")
      .setStyle(ButtonStyle.Danger),
  );

  await requestChannel.send({ embeds: [reqEmbed], components: [row] });
}

// ─── Button: player clicked "Cancel" ──────────────────────────────────────────
export async function handleCancel(interaction: ButtonInteraction, reqId: string) {
  const req = pendingDeposits.get(reqId);
  if (!req) {
    return interaction.update({ embeds: [], components: [], content: "Already processed." });
  }
  if (interaction.user.id !== req.userId) {
    return interaction.reply({ content: "❌ This is not your deposit request.", flags: MessageFlags.Ephemeral });
  }

  pendingDeposits.delete(reqId);
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.dark)
        .setDescription("❌ Deposit cancelled.")
        .setTimestamp(),
    ],
    components: [],
  });
}

// ─── Button: mod clicked "Approve" ────────────────────────────────────────────
export async function handleApprove(interaction: ButtonInteraction, reqId: string) {
  await interaction.deferUpdate();

  const req = pendingDeposits.get(reqId);
  if (!req) {
    return interaction.followUp({ content: "❌ This request has already been processed.", flags: MessageFlags.Ephemeral });
  }

  pendingDeposits.delete(reqId);
  await addBalance(req.userId, req.amount);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle("✅ Deposit Approved")
        .addFields(
          { name: "👤 User", value: `<@${req.userId}>`, inline: true },
          { name: "💎 Amount", value: `${formatAmount(req.amount)} gems`, inline: true },
          { name: "🛡️ By", value: `<@${interaction.user.id}>`, inline: true },
        )
        .setTimestamp(),
    ],
    components: [],
  });

  // Announce in deposit channel
  const cfg2 = getServerConfig();
  if (cfg2) {
    const depCh = interaction.client.channels.cache.get(cfg2.depositChannelId) as TextChannel | undefined;
    if (depCh) {
      await depCh.send(`<@${req.userId}> has deposited **${formatAmount(req.amount)} 💎**`);
    }
  }

  // DM the player
  try {
    const user = await interaction.client.users.fetch(req.userId);
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.success)
          .setTitle("💎 Deposit Approved!")
          .setDescription(
            `Your deposit of **${formatAmount(req.amount)} 💎 gems** has been confirmed and added to your balance. Thank you!`,
          )
          .setTimestamp(),
      ],
    });
  } catch {
    // DM failed (DMs disabled) — ignore silently
  }
}

// ─── Button: mod clicked "Not Approve" — show modal for reason ────────────────
export async function handleNotApprove(interaction: ButtonInteraction, reqId: string) {
  const req = pendingDeposits.get(reqId);
  if (!req) {
    return interaction.reply({ content: "❌ This request has already been processed.", flags: MessageFlags.Ephemeral });
  }

  const modal = new ModalBuilder()
    .setCustomId(`dep_notapprove_modal_${reqId}`)
    .setTitle("Deny Deposit — Enter Reason");

  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Reason for denial")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder("e.g. Payment not received, wrong amount sent…");

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
  await interaction.showModal(modal);
}

// ─── Modal: mod submitted denial reason ───────────────────────────────────────
export async function handleNotApproveModal(interaction: ModalSubmitInteraction, reqId: string) {
  await interaction.deferUpdate();

  const req = pendingDeposits.get(reqId);
  if (!req) {
    return interaction.followUp({ content: "❌ This request has already been processed.", flags: MessageFlags.Ephemeral });
  }

  const reason = interaction.fields.getTextInputValue("reason");
  pendingDeposits.delete(reqId);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.danger)
        .setTitle("❌ Deposit Denied")
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
          .setTitle("❌ Deposit Denied")
          .setDescription(
            `Your deposit of **${formatAmount(req.amount)} 💎 gems** was not approved.\n\n**Reason:** ${reason}`,
          )
          .setTimestamp(),
      ],
    });
  } catch {
    // DM failed — ignore silently
  }
}
