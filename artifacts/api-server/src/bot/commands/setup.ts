import {
  SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
  ChannelSelectMenuBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType,
  type ChatInputCommandInteraction, type ButtonInteraction, type StringSelectMenuInteraction,
  type ChannelSelectMenuInteraction, type ModalSubmitInteraction,
} from "discord.js";
import { COLORS, errorEmbed, parseAmount } from "../utils.js";
import { isAdmin, getServerConfig, saveServerConfig, type ServerConfig } from "../botConfig.js";

type Session = { cfg: Partial<ServerConfig>; adminId: string; selected?: string[] };
const sessions = new Map<string, Session>();
const ch = (id?: string) => id ? `<#${id}>` : "`Not set`";
const ro = (id?: string) => id ? `<@&${id}>` : "`Not set`";
const amount = (v?: number) => v && v > 0 ? `\`${v.toLocaleString()} 💎\`` : "`Disabled`";
const rate = (v?: number) => v === undefined ? "`Disabled`" : `\`${v}%\``;
const readId = (value: string) => value.match(/\d{15,25}/)?.[0] ?? value.trim();

function summary(cfg: Partial<ServerConfig>) {
  return [
    `📥 Deposit: ${ch(cfg.depositChannelId)}`, `📤 Withdraw: ${ch(cfg.withdrawChannelId)}`,
    `📋 Requests: ${ch(cfg.requestChannelId)}`, `🪙 Flip: ${ch(cfg.flipChannelId)}`,
    `🎮 Roblox: \`${cfg.robloxUser ?? "Not set"}\``, `🎁 Affiliate channel: ${ch(cfg.affiliateChannelId)}`,
    `📥 Min deposit: ${amount(cfg.minDeposit)}`, `📤 Min withdraw: ${amount(cfg.minWithdraw)}`,
    `💸 Rakeback: ${rate(cfg.rakebackRate)}`, `🎁 Affiliate rate: ${rate(cfg.affiliateRate)}`,
    `🌧️ Rain: ${ch(cfg.rainChannelId)} · 🎰 Codes: ${ch(cfg.codesChannelId)}`,
    `🔒 Locks: tips ${cfg.lockTips ?? true ? "on" : "off"} · rain ${cfg.lockRain ?? true ? "on" : "off"} · codes ${cfg.lockCodes ?? true ? "on" : "off"}`,
  ].join("\n");
}
function panel(title: string, description: string, cfg?: Partial<ServerConfig>) {
  return { embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle(title).setDescription(description + (cfg ? `\n\n${summary(cfg)}` : "")).setTimestamp()] };
}
function step1(id: string, cfg: Partial<ServerConfig>) {
  return {
    ...panel("⚙️ Setup · Step 1 of 3", "Choose the deposit and withdraw channels.\n\nThese are required. Select both to continue.", cfg),
    components: [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`setup_deposit_${id}`).setPlaceholder("Select deposit channel").setChannelTypes(ChannelType.GuildText)),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`setup_withdraw_${id}`).setPlaceholder("Select withdraw channel").setChannelTypes(ChannelType.GuildText)),
      new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`setup_cancel_${id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)),
    ],
  };
}
function coreModal(id: string, cfg: Partial<ServerConfig>) {
  const modal = new ModalBuilder().setCustomId(`setup_core_modal_${id}`).setTitle("Setup · Step 2 of 3");
  const field = (customId: string, label: string, value?: string, required = true) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setValue(value ?? "").setPlaceholder("Channel ID or @mention"));
  modal.addComponents(
    field("request_channel", "Request channel", cfg.requestChannelId),
    field("flip_channel", "Flip channel", cfg.flipChannelId),
    field("roblox_user", "Roblox username", cfg.robloxUser),
    field("affiliate_channel", "Affiliate announcement channel", cfg.affiliateChannelId),
  );
  return modal;
}
function optionalModal(id: string, cfg: Partial<ServerConfig>) {
  const modal = new ModalBuilder().setCustomId(`setup_optional_modal_${id}`).setTitle("Setup · Optional settings");
  const field = (customId: string, label: string, value?: string) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false).setValue(value ?? "").setPlaceholder("Leave blank to keep; 0 disables"));
  modal.addComponents(
    field("minimum_deposit", "Minimum deposit (e.g. 1m)", cfg.minDeposit?.toString()),
    field("minimum_withdraw", "Minimum withdraw (e.g. 1m)", cfg.minWithdraw?.toString()),
    field("starter_balance", "Starter balance (e.g. 10m)", cfg.starterBalance?.toString()),
    field("rakeback_rate", "Rakeback percentage (blank disables)", cfg.rakebackRate?.toString()),
    field("affiliate_rate", "Affiliate percentage (blank disables)", cfg.affiliateRate?.toString()),
  );
  return modal;
}
function editSteps(id: string) {
  const menu = new StringSelectMenuBuilder().setCustomId(`setup_pick_${id}`).setPlaceholder("Select step(s) to change").setMinValues(1).setMaxValues(3).addOptions(
    new StringSelectMenuOptionBuilder().setLabel("Deposit & withdraw channels").setValue("channels").setEmoji("📥"),
    new StringSelectMenuOptionBuilder().setLabel("Core channels & Roblox username").setValue("core").setEmoji("⚙️"),
    new StringSelectMenuOptionBuilder().setLabel("Optional limits & percentages").setValue("optional").setEmoji("🎛️"),
  );
  return { components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu), new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`setup_cancel_${id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary))] };
}

export const data = new SlashCommandBuilder().setName("setup").setDescription("(Admin) Configure the bot with an ordered setup wizard");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  if (!isAdmin(interaction.user.id)) return interaction.editReply({ embeds: [errorEmbed("You don't have permission to use this command.")] });
  const existing = getServerConfig();
  const id = interaction.id;
  sessions.set(id, { cfg: { ...(existing ?? {}) }, adminId: interaction.user.id });
  setTimeout(() => sessions.delete(id), 10 * 60 * 1000);
  if (existing) {
    return interaction.editReply({
      ...panel("⚙️ Setup already configured", "Choose whether to configure everything again or change only specific steps.", existing),
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`setup_all_${id}`).setLabel("Setup all again").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`setup_specific_${id}`).setLabel("Change specific steps").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`setup_cancel_${id}`).setLabel("Cancel").setStyle(ButtonStyle.Danger),
      )],
    });
  }
  return interaction.editReply(step1(id, {}));
}
export async function handleChannel(interaction: ChannelSelectMenuInteraction, id: string, kind: "deposit" | "withdraw") {
  const session = sessions.get(id);
  if (!session || session.adminId !== interaction.user.id) return interaction.reply({ content: "❌ This setup session expired.", ephemeral: true });
  session.cfg[kind === "deposit" ? "depositChannelId" : "withdrawChannelId"] = interaction.values[0];
  if (session.cfg.depositChannelId && session.cfg.withdrawChannelId) return interaction.showModal(coreModal(id, session.cfg));
  return interaction.update(step1(id, session.cfg));
}
export async function handleCoreModal(interaction: ModalSubmitInteraction, id: string) {
  const session = sessions.get(id);
  if (!session || session.adminId !== interaction.user.id) return interaction.reply({ content: "❌ This setup session expired.", ephemeral: true });
  session.cfg.requestChannelId = readId(interaction.fields.getTextInputValue("request_channel"));
  session.cfg.flipChannelId = readId(interaction.fields.getTextInputValue("flip_channel"));
  session.cfg.robloxUser = interaction.fields.getTextInputValue("roblox_user").trim();
  session.cfg.affiliateChannelId = readId(interaction.fields.getTextInputValue("affiliate_channel"));
  await interaction.reply({ ...panel("⚙️ Setup · Step 3 of 3", "Optional settings are next. You can skip this step; setup will keep existing values.", session.cfg), ephemeral: true, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`setup_optional_${id}`).setLabel("Configure optional settings").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`setup_skip_${id}`).setLabel("Skip optional settings").setStyle(ButtonStyle.Secondary))] });
}
export async function handleOptionalModal(interaction: ModalSubmitInteraction, id: string) {
  const session = sessions.get(id);
  if (!session || session.adminId !== interaction.user.id) return interaction.reply({ content: "❌ This setup session expired.", ephemeral: true });
  const val = (key: string) => interaction.fields.getTextInputValue(key).trim();
  const numeric = (key: string, previous?: number) => { const raw = val(key); if (!raw) return previous; if (raw === "0") return undefined; const n = key.includes("rate") ? Number(raw) : parseAmount(raw); return Number.isFinite(n) && n >= 0 ? n : previous; };
  session.cfg.minDeposit = numeric("minimum_deposit", session.cfg.minDeposit);
  session.cfg.minWithdraw = numeric("minimum_withdraw", session.cfg.minWithdraw);
  session.cfg.starterBalance = numeric("starter_balance", session.cfg.starterBalance);
  session.cfg.rakebackRate = numeric("rakeback_rate", session.cfg.rakebackRate);
  session.cfg.affiliateRate = numeric("affiliate_rate", session.cfg.affiliateRate);
  await interaction.deferReply({ ephemeral: true });
  return finish(interaction, id, session.cfg);
}
export async function handleButton(interaction: ButtonInteraction, id: string, action: string) {
  const session = sessions.get(id);
  if (!session || session.adminId !== interaction.user.id) return interaction.reply({ content: "❌ This setup session expired.", ephemeral: true });
  if (action === "cancel") return handleCancelSetup(interaction, id);
  if (action === "all") return interaction.update(step1(id, session.cfg));
  if (action === "specific") return interaction.update({ ...panel("⚙️ Change specific setup steps", "Select one or more steps. Unselected values will stay unchanged.", session.cfg), ...editSteps(id) });
  if (action === "optional") return interaction.showModal(optionalModal(id, session.cfg));
  if (action === "skip") return finish(interaction, id, session.cfg);
}
export async function handlePick(interaction: StringSelectMenuInteraction, id: string) {
  const session = sessions.get(id);
  if (!session || session.adminId !== interaction.user.id) return interaction.reply({ content: "❌ This setup session expired.", ephemeral: true });
  session.selected = interaction.values;
  if (session.selected.includes("channels")) return interaction.update(step1(id, session.cfg));
  if (session.selected.includes("core")) return interaction.showModal(coreModal(id, session.cfg));
  return interaction.showModal(optionalModal(id, session.cfg));
}
async function finish(interaction: ButtonInteraction | ModalSubmitInteraction, id: string, cfg: Partial<ServerConfig>) {
  if (!cfg.depositChannelId || !cfg.withdrawChannelId || !cfg.requestChannelId || !cfg.flipChannelId || !cfg.robloxUser || !cfg.affiliateChannelId) return interaction.reply({ content: "❌ Complete all required setup fields first.", ephemeral: true });
  saveServerConfig(cfg as ServerConfig); sessions.delete(id);
  return interaction.editReply({ ...panel("✅ Setup saved successfully", "All setup changes have been saved.", cfg), components: [] });
}
export async function handleConfirm(interaction: ButtonInteraction, id: string) { return handleButton(interaction, id, "all"); }
export async function handleCancelSetup(interaction: ButtonInteraction, id: string) {
  sessions.delete(id); await interaction.deferUpdate();
  return interaction.editReply({ ...panel("✖️ Setup cancelled", "The existing configuration was kept."), components: [] });
}