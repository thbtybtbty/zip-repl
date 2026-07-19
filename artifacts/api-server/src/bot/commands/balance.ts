import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { COLORS, getOrCreateUser, formatAmount } from "../utils.js";

export const data = new SlashCommandBuilder()
  .setName("balance")
  .setDescription("View your PS99 Gem balance");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const user = await getOrCreateUser(
    interaction.user.id,
    interaction.user.username,
  );

  const balance   = user.balance;
  const deposited = user.deposited ?? 0;
  const withdrawn = user.withdrawn ?? 0;
  const wagered   = user.wagered   ?? 0;
  const profit    = user.profit    ?? 0;

  const profitSign  = profit >= 0 ? "+" : "-";
  const profitEmoji = profit >= 0 ? "💚" : "🔴";

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`${interaction.user.displayName}'s Balance`)
    .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
    .setDescription(
      [
        `💎 **Balance** ${formatAmount(balance)} *(${balance.toLocaleString("en-US")})*`,
        `📥 **Deposited** ${formatAmount(deposited)}`,
        `📤 **Withdrawn** ${formatAmount(withdrawn)}`,
        `💎 **Wagered** ${formatAmount(wagered)}`,
        `${profitEmoji} **Profit** ${profitSign}${formatAmount(Math.abs(profit))}`,
      ].join("\n"),
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
