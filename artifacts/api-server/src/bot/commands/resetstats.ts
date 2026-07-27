import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { COLORS, formatAmount, getOrCreateUser, errorEmbed } from "../utils.js";
import { isAdmin } from "../botConfig.js";

// ─── Session state ─────────────────────────────────────────────────────────────
interface ResetSession {
  adminId:        string;
  targetUserId:   string;
  targetUsername: string;
  selectedFields: string[];
}

export const sessions = new Map<string, ResetSession>();

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Stat metadata ─────────────────────────────────────────────────────────────
const STATS: { key: keyof typeof usersTable.$inferInsert; label: string; icon: string }[] = [
  { key: "balance",   label: "Balance",       icon: "💰" },
  { key: "wagered",   label: "Total Wagered",  icon: "🎲" },
  { key: "profit",    label: "Net Profit",     icon: "📊" },
  { key: "deposited", label: "Deposited",      icon: "📥" },
  { key: "withdrawn", label: "Withdrawn",      icon: "📤" },
];

const STAT_LABEL: Record<string, string> = Object.fromEntries(STATS.map((s) => [s.key, s.label]));
const STAT_ICON:  Record<string, string> = Object.fromEntries(STATS.map((s) => [s.key, s.icon]));

// ─── Helpers ───────────────────────────────────────────────────────────────────
function parseShorthand(input: string): number | null {
  const s = input.toLowerCase().trim();
  if (s === "0") return 0;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([kmb]?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  if (!isFinite(n) || n < 0) return null;
  if (m[2] === "b") return Math.floor(n * 1_000_000_000);
  if (m[2] === "m") return Math.floor(n * 1_000_000);
  if (m[2] === "k") return Math.floor(n * 1_000);
  return Math.floor(n);
}

function buildStatsLines(user: typeof usersTable.$inferSelect): string {
  return STATS.map((s) => {
    const val = user[s.key as keyof typeof user] as number;
    return `${s.icon} **${s.label}**  \`${formatAmount(val)} 💎\``;
  }).join("\n");
}

function selectMenu(sessionId: string, defaultValues: string[] = []): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId(`rs_pick_${sessionId}`)
    .setPlaceholder("Select stats to reset…")
    .setMinValues(1)
    .setMaxValues(STATS.length)
    .addOptions(
      STATS.map((s) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(s.label)
          .setValue(s.key as string)
          .setEmoji(s.icon)
          .setDefault(defaultValues.includes(s.key as string)),
      ),
    );
}

// ─── Command definition ────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("resetstats")
  .setDescription("[Admin] Reset one or more stats for a user")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("The user to reset stats for").setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isAdmin(interaction.user.id)) {
    await interaction.editReply({ embeds: [errorEmbed("Admin only.")] });
    return;
  }

  const target  = interaction.options.getUser("user", true);
  const user    = await getOrCreateUser(target.id, target.username);
  const session = makeId();

  sessions.set(session, {
    adminId:        interaction.user.id,
    targetUserId:   target.id,
    targetUsername: target.username,
    selectedFields: [],
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(`🔧  Reset Stats — ${target.username}`)
    .setDescription(`**Current stats:**\n${buildStatsLines(user)}\n\nSelect which stats to reset below.`)
    .setTimestamp();

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>()
    .addComponents(selectMenu(session));

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ─── Select menu: admin picked which stats ─────────────────────────────────────
export async function handlePick(si: StringSelectMenuInteraction, sessionId: string): Promise<void> {
  const sess = sessions.get(sessionId);
  if (!sess || si.user.id !== sess.adminId) {
    await si.reply({ content: "❌ Session expired or not yours.", flags: MessageFlags.Ephemeral });
    return;
  }

  sess.selectedFields = si.values;

  const selected = si.values
    .map((f) => `${STAT_ICON[f] ?? ""} **${STAT_LABEL[f] ?? f}**`)
    .join("\n");

  const applyBtn = new ButtonBuilder()
    .setCustomId(`rs_apply_${sessionId}`)
    .setLabel("Set New Values")
    .setEmoji("✏️")
    .setStyle(ButtonStyle.Primary);

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`rs_cancel_${sessionId}`)
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary);

  await si.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.gold)
        .setTitle(`🔧  Reset Stats — ${sess.targetUsername}`)
        .setDescription(`**Stats selected for reset:**\n${selected}\n\nClick **Set New Values** to enter the new amounts.`)
        .setTimestamp(),
    ],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(selectMenu(sessionId, si.values)),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(applyBtn, cancelBtn),
    ],
  });
}

// ─── Button: open modal to enter new values ────────────────────────────────────
export async function handleApply(bi: ButtonInteraction, sessionId: string): Promise<void> {
  const sess = sessions.get(sessionId);
  if (!sess || bi.user.id !== sess.adminId) {
    await bi.reply({ content: "❌ Session expired or not yours.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!sess.selectedFields.length) {
    await bi.reply({ content: "❌ No stats selected.", flags: MessageFlags.Ephemeral });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`rs_modal_${sessionId}`)
    .setTitle(`Reset — ${sess.targetUsername}`);

  modal.addComponents(
    ...sess.selectedFields.map((field) =>
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(field)
          .setLabel(`${STAT_LABEL[field] ?? field} (e.g. 0, 5m, 1.2b)`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("0"),
      ),
    ),
  );

  await bi.showModal(modal);
}

// ─── Button: cancel ────────────────────────────────────────────────────────────
export async function handleCancel(bi: ButtonInteraction, sessionId: string): Promise<void> {
  sessions.delete(sessionId);
  await bi.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.dark)
        .setDescription("❌  Reset cancelled.")
        .setTimestamp(),
    ],
    components: [],
  });
}

// ─── Modal: apply new values ───────────────────────────────────────────────────
export async function handleModal(mi: ModalSubmitInteraction, sessionId: string): Promise<void> {
  await mi.deferUpdate();

  const sess = sessions.get(sessionId);
  if (!sess) {
    await mi.followUp({ content: "❌ Session expired.", flags: MessageFlags.Ephemeral });
    return;
  }

  // Parse each submitted value
  const updates: Partial<Record<string, number>> = {};
  for (const field of sess.selectedFields) {
    const raw    = mi.fields.getTextInputValue(field).trim();
    const parsed = parseShorthand(raw);
    if (parsed === null) {
      await mi.followUp({
        content: `❌ Invalid value for **${STAT_LABEL[field] ?? field}**: \`${raw}\`. Use \`0\`, \`1m\`, \`2.5b\`, etc.`,
        flags:   MessageFlags.Ephemeral,
      });
      return;
    }
    updates[field] = parsed;
  }

  sessions.delete(sessionId);

  // Apply to DB
  await db
    .update(usersTable)
    .set({ ...(updates as Record<string, number>), updatedAt: new Date() })
    .where(eq(usersTable.id, sess.targetUserId));

  // Fetch fresh row
  const rows  = await db.select().from(usersTable).where(eq(usersTable.id, sess.targetUserId)).limit(1);
  const fresh = rows[0]!;

  const changeLines = sess.selectedFields.map((f) =>
    `${STAT_ICON[f] ?? ""} **${STAT_LABEL[f] ?? f}** → \`${formatAmount(updates[f]!)} 💎\``,
  );

  await mi.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle(`✅  Stats Reset — ${sess.targetUsername}`)
        .setDescription(`**Changes applied:**\n${changeLines.join("\n")}`)
        .setTimestamp(),
      new EmbedBuilder()
        .setColor(COLORS.dark)
        .setTitle("📊  Updated Stats")
        .setDescription(buildStatsLines(fresh))
        .setTimestamp(),
    ],
    components: [],
  });
}
