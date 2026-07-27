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
import { sqlite } from "@workspace/db";
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
  // profit = current balance + lifetime withdrawals - lifetime deposits
  const profit    = balance + withdrawn - deposited;

  const profitPositive = profit >= 0;
  const profitEmoji    = profitPositive ? "📈" : "📉";
  const profitStr      = `${profitPositive ? "+" : "-"}${formatAmount(Math.abs(profit))}`;

  const embed = new EmbedBuilder()
    .setColor(profitPositive ? 0x57f287 : 0xed4245)
    .setTitle(`💎 ${interaction.user.displayName}'s Balance`)
    .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
    .setDescription(
      [
        `💎 **Balance**   \`${formatAmount(balance)}\` *(${balance.toLocaleString("en-US")})*`,
        `📥 **Deposited** \`${formatAmount(deposited)}\``,
        `📤 **Withdrawn** \`${formatAmount(withdrawn)}\``,
        `💸 **Wagered**   \`${formatAmount(wagered)}\``,
        `${profitEmoji} **Profit**    \`${profitStr}\``,
      ].join("\n"),
    )
    .setTimestamp();

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bal_adv_${interaction.user.id}`)
      .setLabel("Advanced Stats")
      .setEmoji("📊")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ─── Button: Advanced Stats (ephemeral — only the command owner can see it) ───
export async function handleAdvancedStats(bi: ButtonInteraction, targetUserId: string): Promise<void> {
  // Only the person whose /balance was run can open this
  if (bi.user.id !== targetUserId) {
    await bi.reply({
      content: "❌ This panel belongs to someone else's `/balance`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await bi.deferReply({ flags: MessageFlags.Ephemeral });

  const q = <T>(sql: string, ...args: unknown[]) =>
    (sqlite.prepare(sql).get(...args) as T) ?? ({} as T);

  const { sent }     = q<{ sent: number }>(
    `SELECT CAST(COALESCE(SUM(bet),0) AS INTEGER) AS sent
     FROM bet_log WHERE user_id = ? AND command = 'tip-sent'`,
    targetUserId,
  );
  const { received } = q<{ received: number }>(
    `SELECT CAST(COALESCE(SUM(net_delta),0) AS INTEGER) AS received
     FROM bet_log WHERE user_id = ? AND command = 'tip-received'`,
    targetUserId,
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.dark)
    .setTitle("📊 Advanced Stats")
    .addFields({
      name:  "💸 Tips",
      value: `📤  Tips Sent      **${formatAmount(sent ?? 0)} 💎**\n📥  Tips Received  **${formatAmount(received ?? 0)} 💎**`,
      inline: false,
    })
    .setTimestamp();

  await bi.editReply({ embeds: [embed] });
}
