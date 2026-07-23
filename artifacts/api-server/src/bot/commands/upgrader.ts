import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  COLORS,
  parseAmount,
  formatAmount,
  getOrCreateUser,
  addBalance,
  recordBet,
  errorEmbed,
} from "../utils.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const RTP        = 0.925; // 7.5% house edge
const MULT_MIN   = 1.5;
const MULT_MAX   = 25;

// ─── Win chance ───────────────────────────────────────────────────────────────
function winChance(multiplier: number): number {
  return RTP / multiplier;
}

// ─── Progress bar (win chance visualisation) ──────────────────────────────────
function buildChanceBar(chance: number): string {
  const filled = Math.round(chance * 20);
  return "▰".repeat(filled) + "▱".repeat(20 - filled);
}

// ─── Embeds ───────────────────────────────────────────────────────────────────
function resultEmbed(
  bet:        number,
  multiplier: number,
  won:        boolean,
  payout:     number,
): EmbedBuilder {
  const chance  = winChance(multiplier);
  const profit  = payout - bet;

  const color = won
    ? (payout >= bet ? COLORS.success : COLORS.warning)
    : COLORS.danger;

  const title = won
    ? `⬆️  Upgrader — Upgraded! 🎉`
    : `⬆️  Upgrader — Failed ❌`;

  const lines: string[] = [
    `💎 **Bet**         \`${formatAmount(bet)}\``,
    `✨ **Multiplier**  \`${multiplier.toFixed(2)}x\``,
    `📊 **Win chance**  \`${(chance * 100).toFixed(1)}%\``,
    buildChanceBar(chance),
    "",
  ];

  if (won) {
    lines.push(
      `✅ **Result**    Win!`,
      `💰 **Payout**   \`${formatAmount(payout)}\``,
      `📈 **Profit**   \`+${formatAmount(profit)}\``,
    );
  } else {
    lines.push(
      `❌ **Result**    Loss`,
      `💸 **Lost**     \`-${formatAmount(bet)}\``,
    );
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(lines.join("\n"))
    .setTimestamp();
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("upgrader")
  .setDescription("Upgrade your gems — higher multiplier = lower win chance")
  .addStringOption((o) =>
    o.setName("amount").setDescription("Amount to upgrade (e.g. 1m, 2.5b, 500k)").setRequired(true),
  )
  .addNumberOption((o) =>
    o
      .setName("multiplier")
      .setDescription(`Target multiplier (${MULT_MIN}x – ${MULT_MAX}x)`)
      .setRequired(true)
      .setMinValue(MULT_MIN)
      .setMaxValue(MULT_MAX),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const amountStr  = interaction.options.getString("amount", true);
  const multiplier = interaction.options.getNumber("multiplier", true);

  const amount = parseAmount(amountStr);
  if (!amount || amount < 1) {
    return void interaction.editReply({ embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")] });
  }

  if (multiplier < MULT_MIN || multiplier > MULT_MAX) {
    return void interaction.editReply({
      embeds: [errorEmbed(`Multiplier must be between ${MULT_MIN}x and ${MULT_MAX}x.`)],
    });
  }

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount) {
    return void interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
    });
  }

  await addBalance(interaction.user.id, -amount);

  const chance = winChance(multiplier);
  const won    = Math.random() < chance;
  const payout = won ? Math.floor(amount * multiplier) : 0;

  if (won) {
    await addBalance(interaction.user.id, payout);
  }
  await recordBet(interaction.user.id, amount, payout - amount);

  await interaction.editReply({
    embeds: [resultEmbed(amount, multiplier, won, payout)],
  });
}
