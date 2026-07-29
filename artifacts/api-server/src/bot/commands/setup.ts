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
const pendingSetups = new Map<string, ServerConfig>();

// ─── Helpers ─────────────────────────────────────────────────────────────────
function ch(id: string | undefined) { return id ? `<#${id}>` : "`Not set`"; }
function ro(id: string | undefined) { return id ? `<@&${id}>` : "`Not set`"; }

function configEmbed(cfg: ServerConfig, title: string, color: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: "📥 Deposit Channel",   value: ch(cfg.depositChannelId),  inline: true },
      { name: "📤 Withdraw Channel",  value: ch(cfg.withdrawChannelId), inline: true },
      { name: "📋 Request Channel",   value: ch(cfg.requestChannelId),  inline: true },
      { name: "🪙 Flip Channel",      value: ch(cfg.flipChannelId),     inline: true },
      { name: "🌧️ Rain Channel",      value: ch(cfg.rainChannelId),     inline: true },
      { name: "🎰 Codes Channel",     value: ch(cfg.codesChannelId),    inline: true },
      { name: "🔔 Rain Ping Role",    value: ro(cfg.rainPingRoleId),    inline: true },
      { name: "🔔 Code Ping Role",    value: ro(cfg.codePingRoleId),    inline: true },
      { name: "🎮 Roblox User",       value: `\`${cfg.robloxUser}\``,  inline: true },
    )
    .setTimestamp();
}

function cfgSummary(cfg: ServerConfig): string {
  return [
    `📥 Deposit: ${ch(cfg.depositChannelId)}`,
    `📤 Withdraw: ${ch(cfg.withdrawChannelId)}`,
    `📋 Requests: ${ch(cfg.requestChannelId)}`,
    `🪙 Flip: ${ch(cfg.flipChannelId)}`,
    `🌧️ Rain: ${ch(cfg.rainChannelId)}`,
    `🎰 Codes: ${ch(cfg.codesChannelId)}`,
    `🔔 Rain Ping: ${ro(cfg.rainPingRoleId)}`,
    `🔔 Code Ping: ${ro(cfg.codePingRoleId)}`,
    `🎮 Roblox: \`${cfg.robloxUser}\``,
  ].join("\n");
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
  .setDescription("(Admin) Configure the bot — deposit/withdraw, invites, and roles")
  // ── Existing options ──
  .addChannelOption((opt) =>
    opt.setName("deposit_channel").setDescription("Channel where deposit requests appear")
      .addChannelTypes(ChannelType.GuildText).setRequired(true),
  )
  .addChannelOption((opt) =>
    opt.setName("withdraw_channel").setDescription("Channel where withdraw requests appear")
      .addChannelTypes(ChannelType.GuildText).setRequired(true),
  )
  .addChannelOption((opt) =>
    opt.setName("request_channel").setDescription("Channel where Accept/Deny buttons appear")
      .addChannelTypes(ChannelType.GuildText).setRequired(true),
  )
  .addChannelOption((opt) =>
    opt.setName("flip_channel").setDescription("Channel where /flip challenges are posted")
      .addChannelTypes(ChannelType.GuildText).setRequired(true),
  )
  .addStringOption((opt) =>
    opt.setName("roblox_user").setDescription("Roblox username players send gems to when depositing")
      .setRequired(true),
  )
  .addChannelOption((opt) =>
    opt.setName("codes_channel").setDescription("Channel where new promocodes are announced")
      .addChannelTypes(ChannelType.GuildText).setRequired(false),
  )
  .addChannelOption((opt) =>
    opt.setName("rain_channel").setDescription("Channel where /rain panels are posted")
      .addChannelTypes(ChannelType.GuildText).setRequired(false),
  )
  .addRoleOption((opt) =>
    opt.setName("rain_ping_role").setDescription("Role mentioned at the top of every rain panel")
      .setRequired(false),
  )
  .addRoleOption((opt) =>
    opt.setName("code_ping_role").setDescription("Role mentioned at the top of every new code announcement")
      .setRequired(false),
  )

// ─── Execute ──────────────────────────────────────────────────────────────────
export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  if (!isAdmin(interaction.user.id)) {
    return interaction.editReply({
      embeds: [errorEmbed("You don't have permission to use this command.")],
    });
  }

  const depositCh     = interaction.options.getChannel("deposit_channel",  true);
  const withdrawCh    = interaction.options.getChannel("withdraw_channel", true);
  const requestCh     = interaction.options.getChannel("request_channel",  true);
  const flipCh        = interaction.options.getChannel("flip_channel",     true);
  const codesCh       = interaction.options.getChannel("codes_channel",    false);
  const rainCh        = interaction.options.getChannel("rain_channel",     false);
  const rainPingRole  = interaction.options.getRole("rain_ping_role",      false);
  const codePingRole  = interaction.options.getRole("code_ping_role",      false);
  const robloxUser    = interaction.options.getString("roblox_user",       true);

  const newCfg: ServerConfig = {
    depositChannelId:  depositCh.id,
    withdrawChannelId: withdrawCh.id,
    requestChannelId:  requestCh.id,
    flipChannelId:     flipCh.id,
    codesChannelId:    codesCh?.id,
    rainChannelId:     rainCh?.id,
    rainPingRoleId:    rainPingRole?.id,
    codePingRoleId:    codePingRole?.id,
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
  setTimeout(() => pendingSetups.delete(interaction.id), 5 * 60 * 1000);

  const embed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle("⚠️  Setup Already Configured")
    .setDescription("The bot is already set up. Do you want to overwrite the existing configuration?")
    .addFields(
      { name: "Current configuration", value: cfgSummary(existing), inline: true },
      { name: "New configuration",     value: cfgSummary(newCfg),   inline: true },
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
