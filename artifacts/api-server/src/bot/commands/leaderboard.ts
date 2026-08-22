import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from "discord.js";
import { sqlite } from "@workspace/db";
import { COLORS, formatAmount } from "../utils.js";

const PAGE_SIZE = 10;
const CATEGORIES = {
  gems: { label: "Gems", icon: "💎" },
  profit: { label: "Profit", icon: "📈" },
  wager: { label: "Wagered", icon: "🎲" },
  tipped: { label: "Tipped", icon: "🏅" },
  withdrawn: { label: "Withdrawn", icon: "📤" },
  deposited: { label: "Deposited", icon: "📥" },
} as const;
type Category = keyof typeof CATEGORIES;

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("View the server leaderboard")
  .addStringOption((option) =>
    option.setName("category").setDescription("Leaderboard category (default: gems)").setRequired(false)
      .addChoices(...Object.entries(CATEGORIES).map(([value, category]) => ({ name: category.label, value }))),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const category = (interaction.options.getString("category") ?? "gems") as Category;
  await renderPage(interaction, category, 1);
}

function valueExpression(category: Category): string {
  if (category === "profit") return "balance + withdrawn - deposited";
  if (category === "tipped") return "COALESCE((SELECT SUM(bet) FROM bet_log WHERE user_id = users.id AND command = 'tip-sent'), 0)";
  return category === "gems" ? "balance" : category === "wager" ? "wagered" : category;
}

function getRows(category: Category) {
  const value = valueExpression(category);
  return sqlite.prepare(
    `SELECT id, username, (${value}) AS score FROM users ORDER BY score DESC, username ASC`,
  ).all() as Array<{ id: string; username: string; score: number }>;
}

function pageButtons(category: Category, page: number, totalPages: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`lb_prev_${category}_${page}`).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`lb_page_${category}_${page}`).setLabel(`${page} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`lb_next_${category}_${page}`).setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages),
  );
}

async function renderPage(interaction: ChatInputCommandInteraction | ButtonInteraction, category: Category, page: number) {
  const rows = getRows(category);
  if (!rows.length) return interaction.editReply({ content: "No players found yet.", components: [] });
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const slice = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const medal = ["🥇", "🥈", "🥉"];
  const lines = slice.map((user, index) => {
    const rank = (safePage - 1) * PAGE_SIZE + index + 1;
    const prefix = rank <= 3 ? medal[rank - 1] : `#${rank}`;
    return `${prefix}  <@${user.id}>  —  \`${formatAmount(Number(user.score))} ${CATEGORIES[category].icon}\``;
  });
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`${CATEGORIES[category].icon} ${CATEGORIES[category].label} Leaderboard`)
    .setDescription(lines.join("\n"))
    .setFooter({ text: `${safePage} / ${totalPages}` });
  return interaction.editReply({ embeds: [embed], components: [pageButtons(category, safePage, totalPages)] });
}

export async function handlePage(interaction: ButtonInteraction, category: Category, page: number) {
  await interaction.deferUpdate();
  await renderPage(interaction, category, page);
}
