import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db, usersTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { COLORS, formatAmount } from "../utils.js";

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Top 10 richest players");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const top = await db
    .select()
    .from(usersTable)
    .orderBy(desc(usersTable.balance))
    .limit(10);

  if (top.length === 0) {
    await interaction.editReply({ content: "No players found yet." });
    return;
  }

  const MEDALS = ["🥇", "🥈", "🥉"];

  const topThree = top.slice(0, 3).map((u, i) =>
    `${MEDALS[i]}  **${u.username}**  ·  \`${formatAmount(u.balance)} 💎\``
  );

  const rest = top.slice(3).map((u, i) =>
    `\`#${i + 4}\`  ${u.username}  ·  \`${formatAmount(u.balance)} 💎\``
  );

  const sections: string[] = [...topThree];
  if (rest.length) sections.push("──────────────────", ...rest);

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle("🏆  Leaderboard — Top 10")
    .setDescription(sections.join("\n"))
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
