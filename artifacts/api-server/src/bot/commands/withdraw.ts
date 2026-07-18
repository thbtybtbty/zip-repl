import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
  type TextChannel,
} from "discord.js";
import { COLORS, parseAmount, formatAmount, getOrCreateUser, addBalance, errorEmbed } from "../utils.js";
import { getServerConfig } from "../botConfig.js";

// ─── Pending requests ─────────────────────────────────────────────────────────
interface PendingWithdraw {
  userId: string;
  username: string;
  amount: number;
  robloxUser: string; // the requesting user's Roblox username
}

export const pendingWithdraws = new Map<string, PendingWithdraw>(); // reqId → data

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
    opt.setName("roblox_user").setDescription("Your Roblox username — Robux will be sent here").setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const cfg = getServerConfig();
  if (!cfg) {
    return interaction.editReply({
      embeds: [errorEmbed("The bot hasn't been configured yet. Ask an admin to run `/setup`.")],
    });
  }

  const amountStr  = interaction.options.getString("amount",      true);
  const robloxUser = interaction.options.getString("roblox_user", true);
  const amount     = parseAmount(amountStr);

  if (!amount || amount <= 0) {
    return interaction.editReply({ embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")] });
  }

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount) {
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} gems**.`)],
    });
  }

  // Deduct gems immediately — refunded if denied
  await addBalance(interaction.user.id, -amount);

  const reqId = makeReqId();
  pendingWithdraws.set(reqId, {
    userId:     interaction.user.id,
    username:   interaction.user.username,
    amount,
    robloxUser,
  });

  // Send request to the request channel
  const requestChannel = interaction.client.channels.cache.get(cfg.requestChannelId) as TextChannel | undefined;
  if (!requestChannel) {
    // Refund and bail
    await addBalance(interaction.user.id, amount);
    pendingWithdraws.delete(reqId);
    return interaction.editReply({ embeds: [errorEmbed("Request channel not found. Ask an admin to re-run `/setup`.")]});
  }

  const reqEmbed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle("📤  Withdraw Request")
    .addFields(
      { name: "👤 User",          value: `<@${interaction.user.id}>`,    inline: true },
      { name: "💎 Amount",        value: `${formatAmount(amount)} gems`, inline: true },
      { name: "🎮 Send Robux to", value: `\`${robloxUser}\``,           inline: true },
    )
    .setTimestamp();

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`with_accept_${reqId}`)
      .setLabel("✅  Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`with_deny_${reqId}`)
      .setLabel("❌  Deny")
      .setStyle(ButtonStyle.Danger),
  );

  await requestChannel.send({ embeds: [reqEmbed], components: [row] });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle("📤  Withdraw Request Sent")
        .setDescription(
          `Your request to withdraw **${formatAmount(amount)} gems** has been submitted.\n\nRobux will be sent to your Roblox account: \`${robloxUser}\`\nYour gems have been held and will be refunded if the request is denied.`,
        )
        .setTimestamp(),
    ],
  });
}

// ─── Button: Accept ───────────────────────────────────────────────────────────
export async function handleAccept(interaction: ButtonInteraction, reqId: string) {
  await interaction.deferUpdate();

  const req = pendingWithdraws.get(reqId);
  if (!req) {
    return interaction.followUp({ content: "❌ This request has already been processed.", ephemeral: true });
  }

  pendingWithdraws.delete(reqId);
  // Gems were already deducted — just confirm

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle("✅  Withdraw Accepted")
        .addFields(
          { name: "👤 User",          value: `<@${req.userId}>`,           inline: true },
          { name: "💎 Amount",        value: `${formatAmount(req.amount)} gems`, inline: true },
          { name: "🎮 Send Robux to", value: `\`${req.robloxUser}\``,     inline: true },
          { name: "🛡️ By",           value: `<@${interaction.user.id}>`,   inline: true },
        )
        .setTimestamp(),
    ],
    components: [],
  });

  // Notify user via withdraw channel
  const cfg = getServerConfig();
  if (cfg) {
    const ch = interaction.client.channels.cache.get(cfg.withdrawChannelId) as TextChannel | undefined;
    if (ch) {
      await ch.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.success)
            .setDescription(`✅ <@${req.userId}> — your withdrawal of **${formatAmount(req.amount)} gems** has been approved! Robux will be sent to \`${req.robloxUser}\` shortly.`)
            .setTimestamp(),
        ],
      });
    }
  }
}

// ─── Button: Deny ─────────────────────────────────────────────────────────────
export async function handleDeny(interaction: ButtonInteraction, reqId: string) {
  await interaction.deferUpdate();

  const req = pendingWithdraws.get(reqId);
  if (!req) {
    return interaction.followUp({ content: "❌ This request has already been processed.", ephemeral: true });
  }

  pendingWithdraws.delete(reqId);
  // Refund gems
  await addBalance(req.userId, req.amount);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.danger)
        .setTitle("❌  Withdraw Denied")
        .addFields(
          { name: "👤 User",   value: `<@${req.userId}>`,           inline: true },
          { name: "💎 Amount", value: `${formatAmount(req.amount)} gems`, inline: true },
          { name: "🛡️ By",    value: `<@${interaction.user.id}>`,   inline: true },
        )
        .setTimestamp(),
    ],
    components: [],
  });

  // Notify user via withdraw channel
  const cfg = getServerConfig();
  if (cfg) {
    const ch = interaction.client.channels.cache.get(cfg.withdrawChannelId) as TextChannel | undefined;
    if (ch) {
      await ch.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.danger)
            .setDescription(`❌ <@${req.userId}> — your withdrawal of **${formatAmount(req.amount)} gems** was denied. Your gems have been refunded.`)
            .setTimestamp(),
        ],
      });
    }
  }
}
