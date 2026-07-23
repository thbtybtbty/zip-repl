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

// ─── Win chance (as 0–100 percentage) ────────────────────────────────────────
function winChancePct(multiplier: number): number {
  return (RTP / multiplier) * 100;
}

// ─── Progress bar (win-chance zone visualisation, 20 segments = 0–100) ────────
function buildChanceBar(chancePct: number, rolledPct: number): string {
  const winSegments    = Math.round(chancePct / 5);   // how many segments are "safe"
  const rolledSegment  = Math.min(19, Math.floor(rolledPct / 5)); // which segment the roll landed on
  return Array.from({ length: 20 }, (_, i) => {
    if (i === rolledSegment) return "🔸"; // marker showing where the roll landed
    return i < winSegments ? "▰" : "▱";  // filled = win zone, empty = loss zone
  }).join("");
}

// ─── Embeds ───────────────────────────────────────────────────────────────────
function resultEmbed(
  bet:        number,
  multiplier: number,
  won:        boolean,
  payout:     number,
  rolled:     number,  // 0.00 – 99.99
): EmbedBuilder {
  const chancePct = winChancePct(multiplier);
  const profit    = payout - bet;

  const color = won ? COLORS.success : COLORS.danger;
  const title = won ? `⬆️  Upgrader — Upgraded! 🎉` : `⬆️  Upgrader — Failed ❌`;

  const lines: string[] = [
    `💎 **Bet**         \`${formatAmount(bet)}\``,
    `✨ **Multiplier**  \`${multiplier.toFixed(2)}x\``,
    `📊 **Win if roll <** \`${chancePct.toFixed(2)}\``,
    `🎲 **Rolled**      \`${rolled.toFixed(2)}\`  ${won ? "✅" : "❌"}`,
    "",
    buildChanceBar(chancePct, rolled),
    "",
  ];

  if (won) {
    lines.push(
      `💰 **Payout**   \`${formatAmount(payout)}\``,
      `📈 **Profit**   \`+${formatAmount(profit)}\``,
    );
  } else {
    lines.push(`💸 **Lost**     \`-${formatAmount(bet)}\``);
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
  if (!amount || amount < 1_000_000) {
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

  const rolled    = Math.floor(Math.random() * 10000) / 100; // 0.00 – 99.99
  const chancePct = winChancePct(multiplier);
  const won       = rolled < chancePct;
  const payout    = won ? Math.floor(amount * multiplier) : 0;

  if (won) await addBalance(interaction.user.id, payout);
  await recordBet(interaction.user.id, amount, payout - amount);

  await interaction.editReply({
    embeds: [resultEmbed(amount, multiplier, won, payout, rolled)],
  });
}
