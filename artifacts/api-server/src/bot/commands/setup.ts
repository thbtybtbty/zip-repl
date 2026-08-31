import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from "discord.js";
import { COLORS, errorEmbed, parseAmount } from "../utils.js";
import { isAdmin, getServerConfig, saveServerConfig, type ServerConfig } from "../botConfig.js";

const ch = (id?: string) => id ? `<#${id}>` : "`Not set`";
const ro = (id?: string) => id ? `<@&${id}>` : "`Not set`";
const lock = (value: boolean) => value ? "✅ Locked" : "❌ Not locked";
const minimumAmount = (value?: number) =>
  value && value > 0 ? `\`${value.toLocaleString()} 💎\`` : "`No minimum`";

function configEmbed(cfg: Partial<ServerConfig>, title: string, color: number) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: "📥 Deposit Channel", value: ch(cfg.depositChannelId), inline: true },
      { name: "📤 Withdraw Channel", value: ch(cfg.withdrawChannelId), inline: true },
      { name: "📋 Request Channel", value: ch(cfg.requestChannelId), inline: true },
      { name: "🪙 Flip Channel", value: ch(cfg.flipChannelId), inline: true },
      { name: "🌧️ Rain Channel", value: ch(cfg.rainChannelId), inline: true },
      { name: "🎰 Codes Channel", value: ch(cfg.codesChannelId), inline: true },
      { name: "🔔 Rain Ping Role", value: ro(cfg.rainPingRoleId), inline: true },
      { name: "🔔 Code Ping Role", value: ro(cfg.codePingRoleId), inline: true },
      { name: "🛡️ Verified Role", value: ro(cfg.verifiedRoleId), inline: true },
      { name: "🔒 Unverified Role", value: ro(cfg.unverifiedRoleId), inline: true },
      { name: "🎮 Roblox User", value: `\`${cfg.robloxUser ?? "Not set"}\``, inline: true },
      { name: "📥 Minimum Deposit", value: minimumAmount(cfg.minDeposit), inline: true },
      { name: "📤 Minimum Withdraw", value: minimumAmount(cfg.minWithdraw), inline: true },
      { name: "🎁 Starter Balance", value: minimumAmount(cfg.starterBalance), inline: true },
      { name: "📝 Tip Log Channel", value: ch(cfg.tipLogChannelId), inline: true },
      { name: "🎁 Affiliate Channel", value: ch(cfg.affiliateChannelId), inline: true },
      {
        name: "🔒 Lock Settings",
        value: [
          `💸 Tips received: ${lock(cfg.lockTips ?? true)}`,
          `🌧️ Rain winnings: ${lock(cfg.lockRain ?? true)}`,
          `🎰 Promo codes: ${lock(cfg.lockCodes ?? true)}`,
          `🎁 Starter balance until deposit: ${lock(cfg.lockStarterBalance ?? true)}`,
          `➕ /addbalance: ${lock(cfg.lockAddBalance ?? false)}`,
        ].join("\n"),
        inline: false,
      },
    )
    .setTimestamp();
}

function summary(cfg: Partial<ServerConfig>) {
  return [
    `📥 Deposit: ${ch(cfg.depositChannelId)}`,
    `📤 Withdraw: ${ch(cfg.withdrawChannelId)}`,
    `📋 Requests: ${ch(cfg.requestChannelId)}`,
    `🪙 Flip: ${ch(cfg.flipChannelId)}`,
    `🌧️ Rain: ${ch(cfg.rainChannelId)}`,
    `🎰 Codes: ${ch(cfg.codesChannelId)}`,
    `🔔 Rain Ping: ${ro(cfg.rainPingRoleId)}`,
    `🔔 Code Ping: ${ro(cfg.codePingRoleId)}`,
    `🛡️ Verified: ${ro(cfg.verifiedRoleId)}`,
    `🔒 Unverified: ${ro(cfg.unverifiedRoleId)}`,
    `🎮 Roblox: \`${cfg.robloxUser ?? "Not set"}\``,
    `📥 Min Deposit: ${minimumAmount(cfg.minDeposit)}`,
    `📤 Min Withdraw: ${minimumAmount(cfg.minWithdraw)}`,
    `🎁 Starter: ${minimumAmount(cfg.starterBalance)}`,
    `🎁 Affiliate: ${ch(cfg.affiliateChannelId)}`,
    `🔒 Locks: Tips ${lock(cfg.lockTips ?? true)} · Rain ${lock(cfg.lockRain ?? true)} · Codes ${lock(cfg.lockCodes ?? true)} · Starter ${lock(cfg.lockStarterBalance ?? true)} · AddBal ${lock(cfg.lockAddBalance ?? false)}`,
  ].join("\n");
}

function confirmRow(id: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup_confirm_${id}`)
      .setLabel("Re-setup")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`setup_cancel_${id}`)
      .setLabel("Cancel")
      .setEmoji("✖️")
      .setStyle(ButtonStyle.Secondary),
  );
}

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("(Admin) Configure the bot — deposit/withdraw, invites, and roles")
  .addChannelOption((opt) => opt
    .setName("deposit_channel")
    .setDescription("Channel where deposit requests appear")
    .addChannelTypes(ChannelType.GuildText)
    .setRequired(true))
  .addChannelOption((opt) => opt
    .setName("withdraw_channel")
    .setDescription("Channel where withdraw requests appear")
    .addChannelTypes(ChannelType.GuildText)
    .setRequired(true))
  .addChannelOption((opt) => opt
    .setName("request_channel")
    .setDescription("Channel where Accept/Deny buttons appear")
    .addChannelTypes(ChannelType.GuildText)
    .setRequired(true))
  .addChannelOption((opt) => opt
    .setName("flip_channel")
    .setDescription("Channel where /flip challenges are posted")
    .addChannelTypes(ChannelType.GuildText)
    .setRequired(true))
  .addStringOption((opt) => opt
    .setName("roblox_user")
    .setDescription("Roblox username players send gems to when depositing")
    .setRequired(true))
  .addChannelOption((opt) => opt
    .setName("affiliate_channel")
    .setDescription("Channel where new affiliations are announced")
    .addChannelTypes(ChannelType.GuildText)
    .setRequired(true))
  .addRoleOption((opt) => opt
    .setName("verified_role")
    .setDescription("Role assigned when an invited member is verified")
    .setRequired(true))
  .addRoleOption((opt) => opt
    .setName("unverified_role")
    .setDescription("Role assigned to new members tracked by invites")
    .setRequired(true))
  .addStringOption((opt) => opt
    .setName("minimum_deposit")
    .setDescription("Optional minimum deposit, e.g. 1m (use 0 to disable)")
    .setRequired(false))
  .addStringOption((opt) => opt
    .setName("minimum_withdraw")
    .setDescription("Optional minimum withdrawal, e.g. 1m (use 0 to disable)")
    .setRequired(false))
  .addStringOption((opt) => opt
    .setName("starter_balance")
    .setDescription("Optional new-member balance, e.g. 10m (use 0 to disable)")
    .setRequired(false))
  .addChannelOption((opt) => opt
    .setName("tip_log_channel")
    .setDescription("Optional channel for detailed tip logs")
    .addChannelTypes(ChannelType.GuildText)
    .setRequired(false))
  .addStringOption((opt) => opt
    .setName("rakeback_excluded_games")
    .setDescription("Optional comma-separated games excluded from rakeback")
    .setRequired(false))
  .addChannelOption((opt) => opt
    .setName("codes_channel")
    .setDescription("Channel where new promo codes are announced")
    .addChannelTypes(ChannelType.GuildText)
    .setRequired(false))
  .addChannelOption((opt) => opt
    .setName("rain_channel")
    .setDescription("Channel where /rain panels are posted")
    .addChannelTypes(ChannelType.GuildText)
    .setRequired(false))
  .addRoleOption((opt) => opt
    .setName("rain_ping_role")
    .setDescription("Role mentioned at the top of every rain panel")
    .setRequired(false))
  .addRoleOption((opt) => opt
    .setName("code_ping_role")
    .setDescription("Role mentioned at the top of every new code announcement")
    .setRequired(false))
  .addBooleanOption((opt) => opt
    .setName("lock_tips")
    .setDescription("Lock tips received — must wager ≥1.8× before withdrawal (default: on)")
    .setRequired(false))
  .addBooleanOption((opt) => opt
    .setName("lock_rain")
    .setDescription("Lock rain winnings — must wager ≥1.8× before withdrawal (default: on)")
    .setRequired(false))
  .addBooleanOption((opt) => opt
    .setName("lock_codes")
    .setDescription("Lock promo code earnings — must wager ≥1.8× before withdrawal (default: on)")
    .setRequired(false))
  .addBooleanOption((opt) => opt
    .setName("lock_starter_balance")
    .setDescription("Lock starter balance until an approved deposit (default: on)")
    .setRequired(false))
  .addBooleanOption((opt) => opt
    .setName("lock_add_balance")
    .setDescription("Lock gems added via /addbalance (default: off)")
    .setRequired(false));

const parseMinimum = (value: string | null, previous?: number) => {
  if (value === null) return previous;
  if (value.trim() === "0") return undefined;
  const parsed = parseAmount(value);
  return parsed && parsed > 0 ? parsed : NaN;
};

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  if (!isAdmin(interaction.user.id)) {
    return interaction.editReply({ embeds: [errorEmbed("You don't have permission to use this command.")] });
  }

  const existing = getServerConfig();
  const minDeposit = parseMinimum(interaction.options.getString("minimum_deposit", false), existing?.minDeposit);
  const minWithdraw = parseMinimum(interaction.options.getString("minimum_withdraw", false), existing?.minWithdraw);
  const starterRaw = interaction.options.getString("starter_balance", false);
  const starterBalance = starterRaw === null
    ? existing?.starterBalance ?? 10_000_000
    : starterRaw.trim() === "0" ? 0 : parseAmount(starterRaw);

  if (Number.isNaN(minDeposit) || Number.isNaN(minWithdraw) || starterBalance === null || Number.isNaN(starterBalance)) {
    return interaction.editReply({ embeds: [errorEmbed("Invalid amount. Use values like `1m`, `2.5b`, or `0` to disable.")] });
  }

  const excludedRaw = interaction.options.getString("rakeback_excluded_games", false);
  const rakebackExcludedGames = excludedRaw === null
    ? existing?.rakebackExcludedGames ?? []
    : [...new Set(excludedRaw.split(",").map((game) => game.trim().toLowerCase()).filter(Boolean))];

  const cfg: ServerConfig = {
    depositChannelId: interaction.options.getChannel("deposit_channel", true).id,
    withdrawChannelId: interaction.options.getChannel("withdraw_channel", true).id,
    requestChannelId: interaction.options.getChannel("request_channel", true).id,
    flipChannelId: interaction.options.getChannel("flip_channel", true).id,
    robloxUser: interaction.options.getString("roblox_user", true),
    affiliateChannelId: interaction.options.getChannel("affiliate_channel", true).id,
    verifiedRoleId: interaction.options.getRole("verified_role", true).id,
    unverifiedRoleId: interaction.options.getRole("unverified_role", true).id,
    codesChannelId: interaction.options.getChannel("codes_channel", false)?.id ?? existing?.codesChannelId,
    rainChannelId: interaction.options.getChannel("rain_channel", false)?.id ?? existing?.rainChannelId,
    rainPingRoleId: interaction.options.getRole("rain_ping_role", false)?.id ?? existing?.rainPingRoleId,
    codePingRoleId: interaction.options.getRole("code_ping_role", false)?.id ?? existing?.codePingRoleId,
    minDeposit,
    minWithdraw,
    starterBalance,
    tipLogChannelId: interaction.options.getChannel("tip_log_channel", false)?.id ?? existing?.tipLogChannelId,
    rakebackExcludedGames,
    rakebackRate: existing?.rakebackRate,
    affiliateRate: existing?.affiliateRate,
    lockTips: interaction.options.getBoolean("lock_tips") ?? existing?.lockTips ?? true,
    lockRain: interaction.options.getBoolean("lock_rain") ?? existing?.lockRain ?? true,
    lockCodes: interaction.options.getBoolean("lock_codes") ?? existing?.lockCodes ?? true,
    lockStarterBalance: interaction.options.getBoolean("lock_starter_balance") ?? existing?.lockStarterBalance ?? true,
    lockAddBalance: interaction.options.getBoolean("lock_add_balance") ?? existing?.lockAddBalance ?? false,
  };

  if (!existing) {
    saveServerConfig(cfg);
    return interaction.editReply({ embeds: [configEmbed(cfg, "✅ Setup Saved", COLORS.success)] });
  }

  const pendingId = interaction.id;
  pendingSetups.set(pendingId, cfg);
  setTimeout(() => pendingSetups.delete(pendingId), 5 * 60 * 1000);
  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.warning)
        .setTitle("⚠️ Setup Already Configured")
        .setDescription("The bot is already set up. Do you want to overwrite the existing configuration?")
        .addFields(
          { name: "Current configuration", value: summary(existing), inline: true },
          { name: "New configuration", value: summary(cfg), inline: true },
        )
        .setTimestamp(),
    ],
    components: [confirmRow(pendingId)],
  });
}

const pendingSetups = new Map<string, ServerConfig>();

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
  return interaction.editReply({ embeds: [configEmbed(cfg, "✅ Setup Updated", COLORS.success)], components: [] });
}

export async function handleCancelSetup(interaction: ButtonInteraction, interactionId: string) {
  await interaction.deferUpdate();
  pendingSetups.delete(interactionId);
  return interaction.editReply({
    embeds: [new EmbedBuilder().setColor(COLORS.dark).setDescription("✖️ Setup cancelled. The existing configuration was kept.").setTimestamp()],
    components: [],
  });
}