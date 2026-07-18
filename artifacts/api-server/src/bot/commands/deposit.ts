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
interface PendingDeposit {
  userId: string;
  username: string;
  amount: number;
}

export const pendingDeposits = new Map<string, PendingDeposit>(); // reqId → data

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
  await interaction.deferReply({ ephemeral: true });

  const cfg = getServerConfig();
  if (!cfg) {
    return interaction.editReply({
      embeds: [errorEmbed("The bot hasn't been configured yet. Ask an admin to run `/setup`.")],
    });
  }

  const amountStr = interaction.options.getString("amount", true);
  const amount    = parseAmount(amountStr);

  if (!amount || amount <= 0) {
    return interaction.editReply({ embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")] });
  }

  // Ensure user exists
  await getOrCreateUser(interaction.user.id, interaction.user.username);

  const reqId = makeReqId();
  pendingDeposits.set(reqId, {
    userId:   interaction.user.id,
    username: interaction.user.username,
    amount,
  });

  // Send request to the request channel
  const requestChannel = interaction.client.channels.cache.get(cfg.requestChannelId) as TextChannel | undefined;
  if (!requestChannel) {
    return interaction.editReply({ embeds: [errorEmbed("Request channel not found. Ask an admin to re-run `/setup`.")]});
  }

  const reqEmbed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("📥  Deposit Request")
    .addFields(
      { name: "👤 User",    value: `<@${interaction.user.id}>`,    inline: true },
      { name: "💎 Amount",  value: `${formatAmount(amount)} gems`, inline: true },
      { name: "🎮 Send Robux to", value: `\`${cfg.robloxUser}\``, inline: false },
    )
    .setTimestamp();

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`dep_accept_${reqId}`)
      .setLabel("✅  Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`dep_deny_${reqId}`)
      .setLabel("❌  Deny")
      .setStyle(ButtonStyle.Danger),
  );

  await requestChannel.send({ embeds: [reqEmbed], components: [row] });

  // Also post instructions in deposit channel
  const depositChannel = interaction.client.channels.cache.get(cfg.depositChannelId) as TextChannel | undefined;
  if (depositChannel) {
    await depositChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.primary)
          .setTitle("📥  Deposit Instructions")
          .setDescription(
            `<@${interaction.user.id}> wants to deposit **${formatAmount(amount)} gems**.\n\nSend Robux to Roblox user: \`${cfg.robloxUser}\`\nOnce received, accept the request in <#${cfg.requestChannelId}>.`,
          )
          .setTimestamp(),
      ],
    });
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle("📥  Deposit Request Sent")
        .setDescription(`Your request to deposit **${formatAmount(amount)} gems** has been submitted.\n\nSend **Robux** to Roblox user: \`${cfg.robloxUser}\`\nGems will be added once an admin confirms payment.`)
        .setTimestamp(),
    ],
  });
}

// ─── Button: Accept ───────────────────────────────────────────────────────────
export async function handleAccept(interaction: ButtonInteraction, reqId: string) {
  await interaction.deferUpdate();

  const req = pendingDeposits.get(reqId);
  if (!req) {
    return interaction.followUp({ content: "❌ This request has already been processed.", ephemeral: true });
  }

  pendingDeposits.delete(reqId);
  await addBalance(req.userId, req.amount);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle("✅  Deposit Accepted")
        .addFields(
          { name: "👤 User",    value: `<@${req.userId}>`,           inline: true },
          { name: "💎 Amount",  value: `${formatAmount(req.amount)} gems`, inline: true },
          { name: "🛡️ By",     value: `<@${interaction.user.id}>`,   inline: true },
        )
        .setTimestamp(),
    ],
    components: [],
  });

  // Notify user via deposit channel
  const cfg = getServerConfig();
  if (cfg) {
    const ch = interaction.client.channels.cache.get(cfg.depositChannelId) as TextChannel | undefined;
    if (ch) {
      await ch.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.success)
            .setDescription(`✅ <@${req.userId}> — your deposit of **${formatAmount(req.amount)} gems** has been approved and added to your balance!`)
            .setTimestamp(),
        ],
      });
    }
  }
}

// ─── Button: Deny ─────────────────────────────────────────────────────────────
export async function handleDeny(interaction: ButtonInteraction, reqId: string) {
  await interaction.deferUpdate();

  const req = pendingDeposits.get(reqId);
  if (!req) {
    return interaction.followUp({ content: "❌ This request has already been processed.", ephemeral: true });
  }

  pendingDeposits.delete(reqId);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.danger)
        .setTitle("❌  Deposit Denied")
        .addFields(
          { name: "👤 User",   value: `<@${req.userId}>`,           inline: true },
          { name: "💎 Amount", value: `${formatAmount(req.amount)} gems`, inline: true },
          { name: "🛡️ By",    value: `<@${interaction.user.id}>`,   inline: true },
        )
        .setTimestamp(),
    ],
    components: [],
  });

  // Notify user via deposit channel
  const cfg = getServerConfig();
  if (cfg) {
    const ch = interaction.client.channels.cache.get(cfg.depositChannelId) as TextChannel | undefined;
    if (ch) {
      await ch.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.danger)
            .setDescription(`❌ <@${req.userId}> — your deposit of **${formatAmount(req.amount)} gems** was denied. Please contact an admin if you believe this is an error.`)
            .setTimestamp(),
        ],
      });
    }
  }
}
