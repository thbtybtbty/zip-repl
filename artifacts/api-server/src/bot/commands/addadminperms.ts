import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type UserSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type MessageActionRowComponentBuilder,
  type Client,
} from "discord.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { COLORS } from "../utils.js";
import { isAdmin } from "../botConfig.js";

// ─── Admins file helpers ──────────────────────────────────────────────────────
const __filename2 = fileURLToPath(import.meta.url);
const __dirname2  = path.dirname(__filename2);
const adminCandidates = [
  process.env.ADMINS_PATH,
  path.resolve(process.cwd(), "artifacts/admins.json"),
  path.resolve(process.cwd(), "artifacts/api-server/admins.json"),
  path.resolve(process.cwd(), "admins.json"),
  path.resolve(__dirname2, "../../admins.json"),
  path.resolve(__dirname2, "../admins.json"),
].filter((candidate): candidate is string => Boolean(candidate));
const ADMINS_PATH = adminCandidates.find((candidate) => fs.existsSync(candidate))
  ?? adminCandidates[0]!;

function readAdminIds(): string[] {
  try {
    const { adminIds } = JSON.parse(fs.readFileSync(ADMINS_PATH, "utf-8")) as { adminIds: string[] };
    return Array.isArray(adminIds) ? adminIds : [];
  } catch {
    return [];
  }
}

function writeAdminIds(ids: string[]): void {
  fs.writeFileSync(ADMINS_PATH, JSON.stringify({ adminIds: ids }, null, 2));
}

// ─── Panel builder ────────────────────────────────────────────────────────────
async function buildPanel(
  client: Client,
  adminIds: string[],
): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] }> {
  const lines = await Promise.all(
    adminIds.map(async (id, i) => {
      let display = id;
      try {
        const u = await client.users.fetch(id);
        display  = u.tag ?? u.username;
      } catch { /* ignore */ }
      return `\`${i + 1}.\` <@${id}>  ·  ${display}`;
    }),
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle("🛡️ Admin Permissions")
    .setDescription(lines.length ? lines.join("\n") : "*No admins configured.*")
    .setFooter({ text: `${adminIds.length} admin(s)` })
    .setTimestamp();

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("aap_add")
      .setLabel("Add Admin")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("aap_remove")
      .setLabel("Remove Admin")
      .setEmoji("➖")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(adminIds.length === 0),
  );

  return { embeds: [embed], components: [row] };
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("addadminperms")
  .setDescription("[Admin] Manage bot admin permissions");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isAdmin(interaction.user.id)) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.danger).setDescription("❌  Admin only.")],
    });
    return;
  }

  const adminIds = readAdminIds();
  const panel    = await buildPanel(interaction.client, adminIds);
  await interaction.editReply(panel);
}

// ─── Button: show "Add Admin" user-select menu ────────────────────────────────
export async function handleAdd(bi: ButtonInteraction): Promise<void> {
  if (!isAdmin(bi.user.id)) {
    await bi.reply({ content: "❌ Admin only.", flags: MessageFlags.Ephemeral });
    return;
  }
  await bi.deferUpdate();

  const menu = new UserSelectMenuBuilder()
    .setCustomId("aap_user_select")
    .setPlaceholder("Select a user to grant admin…")
    .setMaxValues(1);

  const menuRow   = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu);
  const cancelRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("aap_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  await bi.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle("➕ Add Admin")
        .setDescription("Select a user to grant admin permissions:"),
    ],
    components: [menuRow, cancelRow],
  });
}

// ─── Button: show "Remove Admin" string-select menu ──────────────────────────
export async function handleRemove(bi: ButtonInteraction): Promise<void> {
  if (!isAdmin(bi.user.id)) {
    await bi.reply({ content: "❌ Admin only.", flags: MessageFlags.Ephemeral });
    return;
  }
  await bi.deferUpdate();

  const adminIds = readAdminIds();
  if (adminIds.length === 0) {
    await bi.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.danger).setDescription("❌  No admins to remove.")],
      components: [],
    });
    return;
  }

  const options = await Promise.all(
    adminIds.slice(0, 25).map(async (id) => {
      let label = id;
      try {
        const u = await bi.client.users.fetch(id);
        label   = (u.tag ?? u.username).slice(0, 100);
      } catch { /* ignore */ }
      return new StringSelectMenuOptionBuilder().setLabel(label).setValue(id);
    }),
  );

  const menu = new StringSelectMenuBuilder()
    .setCustomId("aap_remove_select")
    .setPlaceholder("Select an admin to remove…")
    .addOptions(options);

  const menuRow   = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu);
  const cancelRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("aap_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  await bi.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.danger)
        .setTitle("➖ Remove Admin")
        .setDescription("Select an admin to remove:"),
    ],
    components: [menuRow, cancelRow],
  });
}

// ─── Button: cancel → back to panel ──────────────────────────────────────────
export async function handleCancel(bi: ButtonInteraction): Promise<void> {
  if (!isAdmin(bi.user.id)) {
    await bi.reply({ content: "❌ Admin only.", flags: MessageFlags.Ephemeral });
    return;
  }
  await bi.deferUpdate();
  const panel = await buildPanel(bi.client, readAdminIds());
  await bi.editReply(panel);
}

// ─── User-select: add the chosen user ────────────────────────────────────────
export async function handleUserSelect(si: UserSelectMenuInteraction): Promise<void> {
  if (!isAdmin(si.user.id)) {
    await si.reply({ content: "❌ Admin only.", flags: MessageFlags.Ephemeral });
    return;
  }
  await si.deferUpdate();

  const targetId = si.values[0]!;
  const adminIds = readAdminIds();

  if (adminIds.includes(targetId)) {
    await si.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.warning)
          .setDescription(`⚠️  <@${targetId}> is already an admin.`),
      ],
      components: [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder().setCustomId("aap_cancel").setLabel("Back").setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    return;
  }

  adminIds.push(targetId);
  writeAdminIds(adminIds);

  const panel = await buildPanel(si.client, adminIds);
  await si.editReply(panel);
}

// ─── String-select: remove the chosen admin ───────────────────────────────────
export async function handleRemoveSelect(si: StringSelectMenuInteraction): Promise<void> {
  if (!isAdmin(si.user.id)) {
    await si.reply({ content: "❌ Admin only.", flags: MessageFlags.Ephemeral });
    return;
  }
  await si.deferUpdate();

  const targetId = si.values[0]!;
  const adminIds = readAdminIds().filter((id) => id !== targetId);
  writeAdminIds(adminIds);

  const panel = await buildPanel(si.client, adminIds);
  await si.editReply(panel);
}
