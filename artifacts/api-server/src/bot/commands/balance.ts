import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { COLORS, formatAmount, getOrCreateUser } from "../utils.js";

export const data = new SlashCommandBuilder()
  .setName("balance")
  .setDescription("View your PS99 Gem balance");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const user = await getOrCreateUser(
    interaction.user.id,
    interaction.user.username,
  );

  const bal = user.balance;

  // Breakdown line (only show if balance is big enough to have multiple denominations)
  let breakdown = "";
  if (bal >= 1_000_000_000) {
    const b = Math.floor(bal / 1_000_000_000);
    const m = Math.floor((bal % 1_000_000_000) / 1_000_000);
    if (b > 0 && m > 0) breakdown = `\n${b}B ${m}M gems`;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setAuthor({
      name: `${interaction.user.displayName}'s Wallet`,
      iconURL: interaction.user.displayAvatarURL(),
    })
    .setTitle("💎  PS99 Gems")
    .setDescription(
      [
        `### ${formatAmount(bal)} gems${breakdown}`,
        "",
        "-# Use /tip to send gems · /mines or /towers to earn more",
      ].join("\n"),
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
