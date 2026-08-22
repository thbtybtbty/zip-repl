import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
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

export async function execute(
  interaction: ChatInputCommandInteraction,
) {
  const targetMember = interaction.options.getUser(
    "member",
    false,
  );

  // Only admins can view someone else's balance
  if (
    targetMember &&
    !isAdmin(interaction.user.id)
  ) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.danger ?? 0xe74c3c)
          .setDescription(
            "❌ Only admins can view another member's balance.",
          )
          .setTimestamp(),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  const target =
    targetMember ?? interaction.user;

  const user =
    await getOrCreateUser(
      target.id,
      target.username,
    );

  const balance =
    user.balance;

  const deposited =
    user.deposited ?? 0;

  const withdrawn =
    user.withdrawn ?? 0;

  const wagered =
    user.wagered ?? 0;

  // profit = current balance + lifetime withdrawals - lifetime deposits
  const profit =
    balance +
    withdrawn -
    deposited;

  const profitPositive =
    profit >= 0;

  const profitEmoji =
    profitPositive
      ? "📈"
      : "📉";

  const profitStr =
    `${profitPositive ? "+" : "-"}${formatAmount(
      Math.abs(profit),
    )}`;

  // Advanced Stats button
  // Emoji intentionally removed.
  const advancedStatsRow =
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `bal_adv_${target.id}_${interaction.user.id}`,
        )
        .setLabel("Advanced Stats")
        .setStyle(ButtonStyle.Secondary),
    );

  // Balance panel
  const balanceText = [
    `## 💎 ${target.displayName ?? target.username}'s Balance`,
    "",
    `💎 **Balance**   \`${formatAmount(balance)}\` (${balance.toLocaleString("en-US")})`,
    `📥 **Deposited** \`${formatAmount(deposited)}\``,
    `📤 **Withdrawn** \`${formatAmount(withdrawn)}\``,
    `💸 **Wagered**   \`${formatAmount(wagered)}\``,
    `${profitEmoji} **Profit**    \`${profitStr}\``,
  ].join("\n");

  const avatar =
    new ThumbnailBuilder().setURL(
      target.displayAvatarURL({
        size: 128,
      }),
    );

  const balanceSection =
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          balanceText,
        ),
      )
      .setThumbnailAccessory(
        avatar,
      );

  const container =
    new ContainerBuilder()
      .setAccentColor(0x57f287)
      .addSectionComponents(
        balanceSection,
      )
      .addActionRowComponents(
        advancedStatsRow,
      );

  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: [
      container,
    ],
  });
}

// ─── Button: Advanced Stats ───────────────────────────────────────────────────
// customId format: bal_adv_<targetUserId>_<commandRunnerId>

export async function handleAdvancedStats(
  bi: ButtonInteraction,
  targetUserId: string,
  commandRunnerId: string,
): Promise<void> {
  await bi.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  const q = <T>(
    sql: string,
    ...args: unknown[]
  ) =>
    (sqlite
      .prepare(sql)
      .get(...args) as T) ??
    ({} as T);

  // ── Tips ──

  const { sent } =
    q<{ sent: number }>(
      `SELECT CAST(COALESCE(SUM(bet),0) AS INTEGER) AS sent
       FROM bet_log WHERE user_id = ? AND command = 'tip-sent'`,
      targetUserId,
    );

  const { received } =
    q<{ received: number }>(
      `SELECT CAST(COALESCE(SUM(net_delta),0) AS INTEGER) AS received
       FROM bet_log WHERE user_id = ? AND command = 'tip-received'`,
      targetUserId,
    );

  // ── Rain ──

  const { rain_count } =
    q<{ rain_count: number }>(
      `SELECT CAST(COUNT(*) AS INTEGER) AS rain_count
       FROM bet_log WHERE user_id = ? AND command = 'rain'`,
      targetUserId,
    );

  const { rain_earnings } =
    q<{ rain_earnings: number }>(
      `SELECT CAST(COALESCE(SUM(net_delta),0) AS INTEGER) AS rain_earnings
       FROM bet_log WHERE user_id = ? AND command = 'rain'`,
      targetUserId,
    );

  // ── Promocodes ──

  const { promo_count } =
    q<{ promo_count: number }>(
      `SELECT CAST(COUNT(*) AS INTEGER) AS promo_count
       FROM promocode_redemptions WHERE user_id = ?`,
      targetUserId,
    );

  const { promo_earnings } =
    q<{ promo_earnings: number }>(
      `SELECT CAST(COALESCE(SUM(p.reward),0) AS INTEGER) AS promo_earnings
       FROM promocode_redemptions r
       JOIN promocodes p ON r.code = p.code
       WHERE r.user_id = ?`,
      targetUserId,
    );

  // ──────────────────────────────────────────────────────────────────────────
  // Clean Advanced Stats panel
  // ──────────────────────────────────────────────────────────────────────────

  const advancedStatsContainer =
    new ContainerBuilder()
      .setAccentColor(COLORS.primary)

      // Main title
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "## 📊 Advanced Stats",
        ),
      )

      // Divider
      .addSeparatorComponents(
        new SeparatorBuilder(),
      )

      // Tips & Rain heading
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "### Tips & Rain",
        ),
      )

      // Tips & Rain stats
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [
            `🏅 **Tips sent**  \`${formatAmount(sent ?? 0)}\``,
            `🏅 **Tips received**  \`${formatAmount(received ?? 0)}\``,
            `☂️ **Rain earnings**  \`${formatAmount(rain_earnings ?? 0)}\``,
            `☂️ **Rains joined**  \`${rain_count ?? 0}\``,
          ].join("\n"),
        ),
      )

      // Divider
      .addSeparatorComponents(
        new SeparatorBuilder(),
      )

      // Promocodes heading
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "### Promocodes",
        ),
      )

      // Promocode stats
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [
            `💵 **Redeemed**  \`${promo_count ?? 0}\``,
            `💵 **Earned**  \`${formatAmount(
              promo_earnings ?? 0,
            )}\``,
          ].join("\n"),
        ),
      );

  await bi.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: [
      advancedStatsContainer,
    ],
  });
}