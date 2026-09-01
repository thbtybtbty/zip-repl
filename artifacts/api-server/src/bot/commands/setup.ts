import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { COLORS, errorEmbed, formatAmount, parseAmount } from "../utils.js";
import { isAdmin, getServerConfig, saveServerConfig, type ServerConfig } from "../botConfig.js";

const ch = (id?: string) => id ? `<#${id}>` : "`Not set`";
const ro = (id?: string) => id ? `<@&${id}>` : "`Not set`";
const lock = (value: boolean) => value ? "✅ Locked" : "❌ Not locked";
const minimumAmount = (value?: number) =>
  value && value > 0 ? `\`${value.toLocaleString()} 💎\`` : "`No minimum`";

type SetupStep =
  | "deposit_request"
  | "withdraw_request"
  | "deposit_ping"
  | "withdraw_ping"
  | "flip"
  | "affiliate"
  | "verified"
  | "unverified"
  | "roblox"
  | "optional"
  | "review";

interface PendingSetup {
  ownerId: string;
  step: SetupStep;
  draft: Partial<ServerConfig>;
  existing: ServerConfig | null;
}

const STEPS: SetupStep[] = [
  "deposit_request",
  "withdraw_request",
  "deposit_ping",
  "withdraw_ping",
  "flip",
  "affiliate",
  "verified",
  "unverified",
  "roblox",
  "optional",
  "review",
];

const pendingSetups = new Map<string, PendingSetup>();

function initialDraft(existing: ServerConfig | null): Partial<ServerConfig> {
  if (!existing) return {};
  return {
    ...existing,
    depositRequestChannelId: existing.depositRequestChannelId ?? existing.requestChannelId ?? existing.depositChannelId,
    withdrawRequestChannelId: existing.withdrawRequestChannelId ?? existing.requestChannelId ?? existing.withdrawChannelId,
  };
}

function configEmbed(cfg: Partial<ServerConfig>, title: string, color: number) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription("The bot is ready with the configuration below.")
    .addFields(
      { name: "📥 Deposit Request Channel", value: ch(cfg.depositRequestChannelId ?? cfg.depositChannelId), inline: true },
      { name: "📤 Withdraw Request Channel", value: ch(cfg.withdrawRequestChannelId ?? cfg.withdrawChannelId), inline: true },
      { name: "🔔 Deposit Ping Role", value: ro(cfg.depositPingRoleId), inline: true },
      { name: "🔔 Withdraw Ping Role", value: ro(cfg.withdrawPingRoleId), inline: true },
      { name: "📥 Deposit Announcement", value: ch(cfg.depositChannelId), inline: true },
      { name: "📤 Withdraw Announcement", value: ch(cfg.withdrawChannelId), inline: true },
      { name: "🪙 Flip Channel", value: ch(cfg.flipChannelId), inline: true },
      { name: "🎮 Roblox User", value: `\`${cfg.robloxUser ?? "Not set"}\``, inline: true },
      { name: "🎁 Affiliate Channel", value: ch(cfg.affiliateChannelId), inline: true },
      { name: "✅ Verified Role", value: ro(cfg.verifiedRoleId), inline: true },
      { name: "⏳ Unverified Role", value: ro(cfg.unverifiedRoleId), inline: true },
      { name: "📥 Minimum Deposit", value: minimumAmount(cfg.minDeposit), inline: true },
      { name: "📤 Minimum Withdraw", value: minimumAmount(cfg.minWithdraw), inline: true },
      { name: "🎁 Starter Balance", value: minimumAmount(cfg.starterBalance), inline: true },
      { name: "🔒 Lock Settings", value: [
        `💸 Tips: ${lock(cfg.lockTips ?? true)}`,
        `🌧️ Rain: ${lock(cfg.lockRain ?? true)}`,
        `🎰 Codes: ${lock(cfg.lockCodes ?? true)}`,
        `🎁 Starter: ${lock(cfg.lockStarterBalance ?? true)}`,
        `➕ /addbalance: ${lock(cfg.lockAddBalance ?? false)}`,
      ].join("\n"), inline: false },
    )
    .setTimestamp();
}

function stepName(step: SetupStep): string {
  return {
    deposit_request: "Deposit request channel",
    withdraw_request: "Withdraw request channel",
    deposit_ping: "Deposit ping role",
    withdraw_ping: "Withdraw ping role",
    flip: "Flip channel",
    affiliate: "Affiliate channel",
    verified: "Verified role",
    unverified: "Unverified role",
    roblox: "Roblox username",
    optional: "Optional settings",
    review: "Review",
  }[step];
}

function selectedValue(pending: PendingSetup, step: SetupStep): string {
  const cfg = pending.draft;
  if (step === "deposit_request") return ch(cfg.depositRequestChannelId);
  if (step === "withdraw_request") return ch(cfg.withdrawRequestChannelId);
  if (step === "deposit_ping") return ro(cfg.depositPingRoleId);
  if (step === "withdraw_ping") return ro(cfg.withdrawPingRoleId);
  if (step === "flip") return ch(cfg.flipChannelId);
  if (step === "affiliate") return ch(cfg.affiliateChannelId);
  if (step === "verified") return ro(cfg.verifiedRoleId);
  if (step === "unverified") return ro(cfg.unverifiedRoleId);
  if (step === "roblox") return cfg.robloxUser ? `\`${cfg.robloxUser}\`` : "`Not set`";
  return "";
}

function wizardEmbed(pending: PendingSetup): EmbedBuilder {
  const index = STEPS.indexOf(pending.step) + 1;
  const isOptional = pending.step === "deposit_ping" || pending.step === "withdraw_ping" || pending.step === "optional";
  const description = pending.step === "review"
    ? "Everything is selected. Save this setup when the summary looks right."
    : `Step **${index} of ${STEPS.length}** — **${stepName(pending.step)}**\n${isOptional ? "This step is optional. You can skip it." : "Choose an option below; the panel will advance automatically."}`;
  const embed = new EmbedBuilder()
    .setColor(pending.step === "review" ? COLORS.success : COLORS.primary)
    .setTitle("⚙️ Bot Setup Wizard")
    .setDescription(description)
    .setTimestamp();
  if (pending.step !== "review") {
    const value = selectedValue(pending, pending.step);
    if (value) embed.addFields({ name: "Current value", value, inline: false });
  }
  return embed;
}

function channelRow(id: string, placeholder: string) {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(`setup_wiz_channel_${id}`)
    .setPlaceholder(placeholder)
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);
  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(menu);
}

function roleRow(id: string, placeholder: string) {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId(`setup_wiz_role_${id}`)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(1);
  return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(menu);
}

function skipRow(id: string, label = "Skip") {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup_wiz_skip_${id}`)
      .setLabel(label)
      .setEmoji("⏭️")
      .setStyle(ButtonStyle.Secondary),
  );
}

function wizardComponents(pendingId: string, pending: PendingSetup) {
  switch (pending.step) {
    case "deposit_request":
      return [channelRow(`${pendingId}_deposit_request`, "Select the deposit request channel")];
    case "withdraw_request":
      return [channelRow(`${pendingId}_withdraw_request`, "Select the withdraw request channel")];
    case "deposit_ping":
      return [
        roleRow(`${pendingId}_deposit_ping`, "Select the role to ping for deposits"),
        skipRow(`${pendingId}_deposit_ping`, "Skip deposit ping role"),
      ];
    case "withdraw_ping":
      return [
        roleRow(`${pendingId}_withdraw_ping`, "Select the role to ping for withdrawals"),
        skipRow(`${pendingId}_withdraw_ping`, "Skip withdraw ping role"),
      ];
    case "flip":
      return [channelRow(`${pendingId}_flip`, "Select the /flip channel")];
    case "affiliate":
      return [channelRow(`${pendingId}_affiliate`, "Select the affiliate channel")];
    case "verified":
      return [roleRow(`${pendingId}_verified`, "Select the verified member role")];
    case "unverified":
      return [roleRow(`${pendingId}_unverified`, "Select the unverified member role")];
    case "roblox":
      return [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`setup_wiz_roblox_${pendingId}`).setLabel("Enter Roblox username").setEmoji("🎮").setStyle(ButtonStyle.Primary),
      )];
    case "optional":
      return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`setup_wiz_optional_${pendingId}`).setLabel("Set optional amounts").setEmoji("🛠️").setStyle(ButtonStyle.Primary),
        ),
        skipRow(`${pendingId}_optional`, "Skip optional settings"),
      ];
    case "review":
      return [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`setup_wiz_save_${pendingId}`).setLabel(pending.existing ? "Save Updated Setup" : "Save Setup").setEmoji("✅").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`setup_wiz_cancel_${pendingId}`).setLabel("Cancel").setEmoji("✖️").setStyle(ButtonStyle.Secondary),
      )];
  }
}

async function showWizard(interaction: {
  editReply: (payload: { embeds: EmbedBuilder[]; components: unknown[] }) => Promise<unknown>;
}, pendingId: string, pending: PendingSetup) {
  return interaction.editReply({
    embeds: [pending.step === "review"
      ? configEmbed(pending.draft, pending.existing ? "✅ Review Updated Setup" : "✅ Review Setup", COLORS.success)
      : wizardEmbed(pending)],
    components: wizardComponents(pendingId, pending),
  });
}

function next(pending: PendingSetup, step: SetupStep): SetupStep {
  pending.step = step;
  return step;
}

function getPending(interaction: { user: { id: string } }, pendingId: string): PendingSetup | null {
  const pending = pendingSetups.get(pendingId);
  if (!pending || pending.ownerId !== interaction.user.id) return null;
  return pending;
}

function requiredConfig(pending: PendingSetup): ServerConfig | null {
  const cfg = pending.draft;
  if (!cfg.depositRequestChannelId || !cfg.withdrawRequestChannelId || !cfg.flipChannelId ||
      !cfg.robloxUser || !cfg.affiliateChannelId || !cfg.verifiedRoleId || !cfg.unverifiedRoleId) {
    return null;
  }
  return {
    ...cfg,
    depositChannelId: cfg.depositChannelId ?? cfg.depositRequestChannelId,
    withdrawChannelId: cfg.withdrawChannelId ?? cfg.withdrawRequestChannelId,
    requestChannelId: cfg.requestChannelId ?? cfg.depositRequestChannelId,
    depositRequestChannelId: cfg.depositRequestChannelId,
    withdrawRequestChannelId: cfg.withdrawRequestChannelId,
  } as ServerConfig;
}

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("(Admin) Configure the bot with a guided setup panel");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  if (!isAdmin(interaction.user.id)) {
    return interaction.editReply({ embeds: [errorEmbed("You don't have permission to use this command.")] });
  }
  const pendingId = interaction.id;
  const existing = getServerConfig();
  const pending: PendingSetup = { ownerId: interaction.user.id, step: "deposit_request", draft: initialDraft(existing), existing };
  pendingSetups.set(pendingId, pending);
  setTimeout(() => pendingSetups.delete(pendingId), 10 * 60 * 1000);
  return showWizard(interaction, pendingId, pending);
}

export async function handleWizardChannel(interaction: ChannelSelectMenuInteraction, encoded: string) {
  const separator = encoded.lastIndexOf("_");
  const pendingId = encoded.slice(0, separator);
  const step = encoded.slice(separator + 1) as SetupStep;
  const pending = getPending(interaction, pendingId);
  if (!pending) return interaction.reply({ content: "❌ This setup wizard is no longer active.", ephemeral: true });
  if (pending.step !== step) return interaction.reply({ content: "❌ This setup step has already been completed.", ephemeral: true });
  await interaction.deferUpdate();
  const channelId = interaction.values[0];
  if (step === "deposit_request") {
    pending.draft.depositRequestChannelId = channelId;
    pending.draft.depositChannelId ??= channelId;
    pending.draft.requestChannelId ??= channelId;
    next(pending, "withdraw_request");
  } else if (step === "withdraw_request") {
    pending.draft.withdrawRequestChannelId = channelId;
    pending.draft.withdrawChannelId ??= channelId;
    next(pending, "deposit_ping");
  } else if (step === "flip") {
    pending.draft.flipChannelId = channelId;
    next(pending, "affiliate");
  } else if (step === "affiliate") {
    pending.draft.affiliateChannelId = channelId;
    next(pending, "verified");
  }
  return showWizard(interaction, pendingId, pending);
}

export async function handleWizardRole(interaction: RoleSelectMenuInteraction, encoded: string) {
  const separator = encoded.lastIndexOf("_");
  const pendingId = encoded.slice(0, separator);
  const step = encoded.slice(separator + 1) as SetupStep;
  const pending = getPending(interaction, pendingId);
  if (!pending) return interaction.reply({ content: "❌ This setup wizard is no longer active.", ephemeral: true });
  if (pending.step !== step) return interaction.reply({ content: "❌ This setup step has already been completed.", ephemeral: true });
  await interaction.deferUpdate();
  const roleId = interaction.values[0];
  if (step === "deposit_ping") {
    pending.draft.depositPingRoleId = roleId;
    next(pending, "withdraw_ping");
  } else if (step === "withdraw_ping") {
    pending.draft.withdrawPingRoleId = roleId;
    next(pending, "flip");
  } else if (step === "verified") {
    pending.draft.verifiedRoleId = roleId;
    next(pending, "unverified");
  } else if (step === "unverified") {
    pending.draft.unverifiedRoleId = roleId;
    next(pending, "roblox");
  }
  return showWizard(interaction, pendingId, pending);
}

function robloxModal(pendingId: string) {
  const input = new TextInputBuilder()
    .setCustomId("roblox_user")
    .setLabel("Roblox username")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(32)
    .setValue("");
  return new ModalBuilder()
    .setCustomId(`setup_wiz_roblox_modal_${pendingId}`)
    .setTitle("Set Roblox Deposit Account")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

function optionalModal(pendingId: string) {
  const field = (id: string, label: string, placeholder: string) => new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder(placeholder);
  return new ModalBuilder()
    .setCustomId(`setup_wiz_optional_modal_${pendingId}`)
    .setTitle("Optional Setup Settings")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(field("minimum_deposit", "Minimum deposit", "1m, or 0 to disable")),
      new ActionRowBuilder<TextInputBuilder>().addComponents(field("minimum_withdraw", "Minimum withdrawal", "1m, or 0 to disable")),
      new ActionRowBuilder<TextInputBuilder>().addComponents(field("starter_balance", "Starter balance", "10m, or 0 to disable")),
    );
}

export async function handleWizardButton(interaction: ButtonInteraction, id: string) {
  const patterns: Array<[RegExp, (pending: PendingSetup, pendingId: string) => Promise<unknown> | unknown]> = [
    [/^setup_wiz_roblox_(\d+)$/, (pending, pendingId) => interaction.showModal(robloxModal(pendingId))],
    [/^setup_wiz_optional_(\d+)$/, (pending, pendingId) => interaction.showModal(optionalModal(pendingId))],
  ];
  for (const [pattern, action] of patterns) {
    const match = id.match(pattern);
    if (match) {
      const pending = getPending(interaction, match[1]);
      if (!pending || pending.step !== (id.startsWith("setup_wiz_roblox_") ? "roblox" : "optional")) {
        return interaction.reply({ content: "❌ This setup wizard is no longer active.", ephemeral: true });
      }
      return action(pending, match[1]);
    }
  }
  const skipMatch = id.match(/^setup_wiz_skip_(\d+)_(deposit_ping|withdraw_ping|optional)$/);
  if (skipMatch) {
    const pendingId = skipMatch[1];
    const pending = getPending(interaction, pendingId);
    if (!pending) return interaction.reply({ content: "❌ This setup wizard is no longer active.", ephemeral: true });
    await interaction.deferUpdate();
    if (skipMatch[2] === "deposit_ping") next(pending, "withdraw_ping");
    else if (skipMatch[2] === "withdraw_ping") next(pending, "flip");
    else next(pending, "review");
    return showWizard(interaction, pendingId, pending);
  }
  const actionMatch = id.match(/^setup_wiz_(save|cancel)_(\d+)$/);
  if (actionMatch) {
    const pendingId = actionMatch[2];
    const pending = getPending(interaction, pendingId);
    if (!pending) return interaction.reply({ content: "❌ This setup wizard is no longer active.", ephemeral: true });
    await interaction.deferUpdate();
    pendingSetups.delete(pendingId);
    if (actionMatch[1] === "cancel") {
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.dark).setDescription("✖️ Setup cancelled. Existing settings were kept.").setTimestamp()], components: [] });
    }
    const cfg = requiredConfig(pending);
    if (!cfg) {
      return interaction.editReply({ embeds: [errorEmbed("The setup is incomplete. Please run `/setup` again.")], components: [] });
    }
    saveServerConfig(cfg);
    return interaction.editReply({ embeds: [configEmbed(cfg, pending.existing ? "✅ Setup Updated" : "✅ Setup Saved", COLORS.success)], components: [] });
  }
  return interaction.reply({ content: "❌ Unknown setup action.", ephemeral: true });
}

function parseOptional(value: string, previous?: number): number | undefined {
  if (!value.trim()) return previous;
  if (value.trim() === "0") return undefined;
  const parsed = parseAmount(value);
  if (!parsed || parsed <= 0) throw new Error("invalid amount");
  return parsed;
}

export async function handleWizardModal(interaction: ModalSubmitInteraction, encoded: string) {
  const match = encoded.match(/^(roblox|optional)_(\d+)$/);
  if (!match) return;
  const pendingId = match[2];
  const pending = getPending(interaction, pendingId);
  if (!pending) return interaction.reply({ content: "❌ This setup wizard is no longer active.", ephemeral: true });
  await interaction.deferUpdate();
  if (match[1] === "roblox") {
    pending.draft.robloxUser = interaction.fields.getTextInputValue("roblox_user").trim();
    next(pending, "optional");
  } else {
    try {
      pending.draft.minDeposit = parseOptional(interaction.fields.getTextInputValue("minimum_deposit"), pending.draft.minDeposit);
      pending.draft.minWithdraw = parseOptional(interaction.fields.getTextInputValue("minimum_withdraw"), pending.draft.minWithdraw);
      pending.draft.starterBalance = parseOptional(interaction.fields.getTextInputValue("starter_balance"), pending.draft.starterBalance ?? 10_000_000);
    } catch {
      return interaction.editReply({ embeds: [errorEmbed("Invalid optional amount. Use values like `1m`, `2.5b`, or `0` to disable.")], components: [] });
    }
    next(pending, "review");
  }
  return showWizard(interaction, pendingId, pending);
}
