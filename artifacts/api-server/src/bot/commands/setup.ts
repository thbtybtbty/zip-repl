import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { COLORS, errorEmbed } from "../utils.js";
import { isAdmin, getServerConfig, saveServerConfig, type ServerConfig } from "../botConfig.js";

// ─── Pending configs waiting for Re-setup confirmation ───────────────────────
// Key: original interaction ID  Value: config the user wants to apply
const pendingSetups = new Map<string, ServerConfig>();

// ─── Helpers ─────────────────────────────────────────────────────────────────
function configEmbed(cfg: ServerConfig, title: string, color: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: "📥 Deposit Channel",  value: `<#${cfg.depositChannelId}>`,  inline: true },
      { name: "📤 Withdraw Channel", value: `<#${cfg.withdrawChannelId}>`, inline: true },
      { name: "📋 Request Channel",  value: `<#${cfg.requestChannelId}>`,  inline: true },
      { name: "🎮 Roblox User",      value: cfg.robloxUser,                inline: true },
    )
    .setTimestamp();
}

function confirmRow(interactionId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup_confirm_${interactionId}`)
      .setLabel("Re-setup")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`setup_cancel_${interactionId}`)
      .setLabel("Cancel")
      .setEmoji("✖️")
      .setStyle(ButtonStyle.Secondary),
  );
}

// ─── Slash command definition ─────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("(Admin) Configure the deposit/withdraw system")
  .addChannelOption((opt) =>
    opt
      .setName("deposit_channel")
      .setDescription("Channel where deposit requests appear")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .addChannelOption((opt) =>
    opt
      .setName("withdraw_channel")
      .setDescription("Channel where withdraw requests appear")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .addChannelOption((opt) =>
    opt
      .setName("request_channel")
      .setDescription("Channel where Accept / Deny buttons appear for all requests")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("roblox_user")
      .setDescription("Roblox username players send gems to when depositing")
      .setRequired(true),
  );

// ─── Execute ──────────────────────────────────────────────────────────────────
export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  if (!isAdmin(interaction.user.id)) {
    return interaction.editReply({
      embeds: [errorEmbed("You don't have permission to use this command.")],
    });
  }

  const depositCh  = interaction.options.getChannel("deposit_channel",  true);
  const withdrawCh = interaction.options.getChannel("withdraw_channel",  true);
  const requestCh  = interaction.options.getChannel("request_channel",   true);
  const robloxUser = interaction.options.getString("roblox_user",        true);

  const newCfg: ServerConfig = {
    depositChannelId:  depositCh.id,
    withdrawChannelId: withdrawCh.id,
    requestChannelId:  requestCh.id,
    robloxUser,
  };

  const existing = getServerConfig();

  // ── First-time setup — save immediately ──
  if (!existing) {
    saveServerConfig(newCfg);
    return interaction.editReply({
      embeds: [configEmbed(newCfg, "✅  Setup Saved", COLORS.success)],
    });
  }

  // ── Already configured — ask for confirmation ──
  pendingSetups.set(interaction.id, newCfg);

  // Auto-remove after 5 minutes to prevent memory leaks
  setTimeout(() => pendingSetups.delete(interaction.id), 5 * 60 * 1000);

  const embed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle("⚠️  Setup Already Configured")
    .setDescription("The bot is already set up. Do you want to overwrite the existing configuration with the new values?")
    .addFields(
      {
        name: "Current configuration",
        value: [
          `📥 Deposit: <#${existing.depositChannelId}>`,
          `📤 Withdraw: <#${existing.withdrawChannelId}>`,
          `📋 Requests: <#${existing.requestChannelId}>`,
          `🎮 Roblox: \`${existing.robloxUser}\``,
        ].join("\n"),
        inline: true,
      },
      {
        name: "New configuration",
        value: [
          `📥 Deposit: <#${newCfg.depositChannelId}>`,
          `📤 Withdraw: <#${newCfg.withdrawChannelId}>`,
          `📋 Requests: <#${newCfg.requestChannelId}>`,
          `🎮 Roblox: \`${newCfg.robloxUser}\``,
        ].join("\n"),
        inline: true,
      },
    )
    .setTimestamp();

  return interaction.editReply({
    embeds: [embed],
    components: [confirmRow(interaction.id)],
  });
}

// ─── Button: Re-setup ─────────────────────────────────────────────────────────
export async function handleConfirm(interaction: ButtonInteraction, interactionId: string) {
  await interaction.deferUpdate();

  const cfg = pendingSetups.get(interactionId);
  if (!cfg) {
    return interaction.editReply({
      embeds: [errorEmbed("This confirmation has expired. Please run `/setup` again.")],
      components: [],
    });
  }

  pendingSetups.delete(interactionId);
  saveServerConfig(cfg);

  return interaction.editReply({
    embeds: [configEmbed(cfg, "✅  Setup Updated", COLORS.success)],
    components: [],
  });
}

// ─── Button: Cancel ───────────────────────────────────────────────────────────
export async function handleCancelSetup(interaction: ButtonInteraction, interactionId: string) {
  await interaction.deferUpdate();
  pendingSetups.delete(interactionId);

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.dark)
        .setDescription("✖️  Setup cancelled. The existing configuration was kept.")
        .setTimestamp(),
    ],
    components: [],
  });
}
