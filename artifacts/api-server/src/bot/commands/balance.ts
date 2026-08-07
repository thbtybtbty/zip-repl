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
import { isAdmin } from "../botConfig.js";

export const data = new SlashCommandBuilder()
  .setName("balance")
  .setDescription("View your PS99 Gem balance")
  .addUserOption((opt) =>
    opt
      .setName("member")
      .setDescription("(Admin) View another member's balance")
      .setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const targetMember = interaction.options.getUser("member", false);

  // Only admins can view someone else's balance
  if (targetMember && !isAdmin(interaction.user.id)) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.danger ?? 0xe74c3c)
          .setDescription("❌ Only admins can view another member's balance.")
          .setTimestamp(),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  const target = targetMember ?? interaction.user;
  const user   = await getOrCreateUser(target.id, target.username);

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
    .setTitle(`💎 ${target.displayName ?? target.username}'s Balance`)
    .setThumbnail(target.displayAvatarURL({ size: 128 }))
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

  // customId encodes: target user ID + command runner ID (separated by _adv_)
  // so the handler knows who to query and who is allowed to click
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bal_adv_${target.id}_${interaction.user.id}`)
      .setLabel("Advanced Stats")
      .setEmoji("📊")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ─── Button: Advanced Stats ───────────────────────────────────────────────────
// customId format: bal_adv_<targetUserId>_<commandRunnerId>
export async function handleAdvancedStats(
  bi: ButtonInteraction,
  targetUserId: string,
  commandRunnerId: string,
): Promise<void> {
  // Only the person who ran the command can open this panel
  if (bi.user.id !== commandRunnerId) {
    await bi.reply({
      content: "❌ This panel belongs to someone else's `/balance`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await bi.deferReply({ flags: MessageFlags.Ephemeral });

  const q = <T>(sql: string, ...args: unknown[]) =>
    (sqlite.prepare(sql).get(...args) as T) ?? ({} as T);

  // ── Tips ──
  const { sent } = q<{ sent: number }>(
    `SELECT CAST(COALESCE(SUM(bet),0) AS INTEGER) AS sent
     FROM bet_log WHERE user_id = ? AND command = 'tip-sent'`,
    targetUserId,
  );
  const { received } = q<{ received: number }>(
    `SELECT CAST(COALESCE(SUM(net_delta),0) AS INTEGER) AS received
     FROM bet_log WHERE user_id = ? AND command = 'tip-received'`,
    targetUserId,
  );

  // ── Rain ──
  const { rain_count } = q<{ rain_count: number }>(
    `SELECT CAST(COUNT(*) AS INTEGER) AS rain_count
     FROM bet_log WHERE user_id = ? AND command = 'rain'`,
    targetUserId,
  );
  const { rain_earnings } = q<{ rain_earnings: number }>(
    `SELECT CAST(COALESCE(SUM(net_delta),0) AS INTEGER) AS rain_earnings
     FROM bet_log WHERE user_id = ? AND command = 'rain'`,
    targetUserId,
  );

  // ── Promocodes ──
  const { promo_count } = q<{ promo_count: number }>(
    `SELECT CAST(COUNT(*) AS INTEGER) AS promo_count
     FROM promocode_redemptions WHERE user_id = ?`,
    targetUserId,
  );
  const { promo_earnings } = q<{ promo_earnings: number }>(
    `SELECT CAST(COALESCE(SUM(p.reward),0) AS INTEGER) AS promo_earnings
     FROM promocode_redemptions r
     JOIN promocodes p ON r.code = p.code
     WHERE r.user_id = ?`,
    targetUserId,
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.dark)
    .setTitle("📊 Advanced Stats")
    .addFields(
      {
        name:   "💸 Tips",
        value:  `📤  Tips Sent      **${formatAmount(sent ?? 0)} 💎**\n📥  Tips Received  **${formatAmount(received ?? 0)} 💎**`,
        inline: false,
      },
      {
        name: "☂️ Rains & Promocodes",
        value: [
          `☂️  Rain Earnings        **${formatAmount(rain_earnings ?? 0)} 💎**`,
          `☂️  Rains Joined         **${rain_count ?? 0}**`,
          `💰  Promocode Earnings   **${formatAmount(promo_earnings ?? 0)} 💎**`,
          `💰  Promocodes Redeemed  **${promo_count ?? 0}**`,
        ].join("\n"),
        inline: false,
      },
    )
    .setTimestamp();

  await bi.editReply({ embeds: [embed] });
}
