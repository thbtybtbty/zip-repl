import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { db, betLogTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { COLORS, formatAmount } from "../utils.js";
import { isAdmin } from "../botConfig.js";

const PAGE_SIZE = 10;

const GAME_COMMANDS = [
  "blackjack", "mines", "towers", "rps", "coinflip",
  "wheel", "roulette", "crash", "scratchcard",
  "chickencrossing", "colordice", "upgrader", "keno",
  "flip", "tip-sent", "tip-received",
] as const;

const LABEL: Record<string, string> = {
  blackjack:      "Blackjack",
  mines:          "Mines",
  towers:         "Towers",
  rps:            "RPS",
  coinflip:       "Coinflip",
  wheel:          "Wheel",
  roulette:       "Roulette",
  crash:          "Crash",
  scratchcard:    "Scratchcard",
  chickencrossing:"Chicken Crossing",
  colordice:      "Color Dice",
  upgrader:       "Upgrader",
  keno:           "Keno",
  flip:           "Flip",
  "tip-sent":     "Tip Sent",
  "tip-received": "Tip Received",
};

/** Returns a Discord timestamp that renders as relative ("12 hours ago") and shows exact date/time on hover. */
function discordTs(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

async function buildPage(
  targetUserId: string,
  targetUsername: string,
  filter: string,
  page: number,
): Promise<{ embed: EmbedBuilder; totalPages: number; currentPage: number }> {
  const condition = filter === "all"
    ? eq(betLogTable.userId, targetUserId)
    : and(eq(betLogTable.userId, targetUserId), eq(betLogTable.command, filter));

  const rows = await db
    .select()
    .from(betLogTable)
    .where(condition)
    .orderBy(desc(betLogTable.createdAt));

  const total      = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage   = Math.max(1, Math.min(page, totalPages));
  const slice      = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const lines = slice.map((row) => {
    const icon  = row.netDelta >= 0 ? "✅" : "💥";
    const sign  = row.netDelta >= 0 ? "+" : "";
    const amt   = `${sign}${formatAmount(row.netDelta)}`;
    const name  = LABEL[row.command] ?? row.command;
    const when  = discordTs(row.createdAt as Date);
    return `${icon}  ${when}  —  **${name}**  —  \`${amt}\``;
  });

  const filterNote = filter === "all" ? "" : `  ·  ${LABEL[filter] ?? filter} only`;

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`${targetUsername}'s History${filterNote}`)
    .setDescription(lines.length ? lines.join("\n") : "*No entries yet.*")
    .setFooter({ text: `${safePage} / ${totalPages}  ·  ${total} total` });

  return { embed, totalPages, currentPage: safePage };
}

function pageRow(
  targetUserId: string,
  filter: string,
  page: number,
  totalPages: number,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`hist_prev_${targetUserId}_${filter}_${page}`)
      .setLabel("◀  Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`hist_cur_${targetUserId}_${filter}_${page}`)
      .setLabel(`${page} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`hist_next_${targetUserId}_${filter}_${page}`)
      .setLabel("Next  ▶")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages),
  );
}

// ─── Command definition ───────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("history")
  .setDescription("[Admin] View a user's bet history")
  .addUserOption((opt) =>
    opt.setName("member").setDescription("User to look up").setRequired(false),
  )
  .addStringOption((opt) => {
    opt.setName("filter").setDescription("Show only a specific game/action").setRequired(false);
    for (const cmd of GAME_COMMANDS) {
      opt.addChoices({ name: LABEL[cmd]!, value: cmd });
    }
    return opt;
  });

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isAdmin(interaction.user.id)) {
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.danger).setDescription("❌  Admin only.")] });
    return;
  }

  const target = interaction.options.getUser("member") ?? interaction.user;
  const filter = interaction.options.getString("filter") ?? "all";

  const { embed, totalPages, currentPage } = await buildPage(target.id, target.username, filter, 1);
  await interaction.editReply({
    embeds: [embed],
    components: [pageRow(target.id, filter, currentPage, totalPages)],
  });
}

// ─── Button handler (called from index.ts) ────────────────────────────────────
export async function handlePage(bi: ButtonInteraction, targetUserId: string, filter: string, page: number): Promise<void> {
  if (!isAdmin(bi.user.id)) {
    await bi.reply({ content: "❌ Admin only.", flags: MessageFlags.Ephemeral });
    return;
  }

  await bi.deferUpdate();

  let username = targetUserId;
  try { username = (await bi.client.users.fetch(targetUserId)).username; } catch { /* ignore */ }

  const { embed, totalPages, currentPage } = await buildPage(targetUserId, username, filter, page);
  await bi.editReply({
    embeds: [embed],
    components: [pageRow(targetUserId, filter, currentPage, totalPages)],
  });
}
