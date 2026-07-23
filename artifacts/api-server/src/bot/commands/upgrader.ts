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
const RTP      = 0.925; // 7.5% house edge
const MULT_MIN = 1.5;
const MULT_MAX = 25;

function winChancePct(multiplier: number): number {
  return (RTP / multiplier) * 100;
}

// ─── Result embed (matching photo style) ─────────────────────────────────────
function resultEmbed(
  bet:        number,
  multiplier: number,
  won:        boolean,
  payout:     number,
  rolled:     number,
): EmbedBuilder {
  const chancePct = winChancePct(multiplier);
  const profit    = payout - bet;

  const title = won
    ? "▲  Upgrader"
    : "▲  Upgrader";

  const outcome = won
    ? "🏆 **YOU WON**"
    : "💀 **YOU LOST**";

  const rollVerdict = won
    ? `Roll landed at \`${rolled.toFixed(2)}\` — under the \`${chancePct.toFixed(2)}%\` threshold. **Upgrade successful!**`
    : `Roll landed at \`${rolled.toFixed(2)}\` — over the \`${chancePct.toFixed(2)}%\` threshold. **Upgrade failed.**`;

  const lines: string[] = [
    outcome,
    "",
    `💎 **Bet**           \`${formatAmount(bet)}\``,
    `✨ **Multiplier**    \`${multiplier.toFixed(2)}x\` (\`${formatAmount(payout > 0 ? payout : Math.floor(bet * multiplier))}\`)`,
    `🍀 **Roll**          \`${rolled.toFixed(2)}\``,
    `🍀 **Win chance**    \`${chancePct.toFixed(2)}%\``,
    "",
    `Roll \`${rolled.toFixed(2)}\` → Threshold \`${chancePct.toFixed(2)}%\``,
    "",
    `> ${rollVerdict}`,
  ];

  if (won) {
    lines.push("", `💰 **Payout**  \`${formatAmount(payout)}\``);
    lines.push(`📈 **Profit**   \`+${formatAmount(profit)}\``);
  }

  return new EmbedBuilder()
    .setColor(won ? COLORS.success : COLORS.danger)
    .setTitle(title)
    .setDescription(lines.join("\n"))
    .setTimestamp();
}

// ─── Command definition ───────────────────────────────────────────────────────
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
  const amount     = parseAmount(amountStr);

  if (!amount || amount < 1_000_000) {
    return void interaction.editReply({ embeds: [errorEmbed("Minimum bet is **1M gems**. Try `1m`, `2.5b`, `500k`.")] });
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

  const rolled    = Math.floor(Math.random() * 10000) / 100; // 0.00–99.99
  const chancePct = winChancePct(multiplier);
  const won       = rolled < chancePct;
  const payout    = won ? Math.floor(amount * multiplier) : 0;

  if (won) await addBalance(interaction.user.id, payout);
  await recordBet(interaction.user.id, amount, payout - amount);

  await interaction.editReply({
    embeds: [resultEmbed(amount, multiplier, won, payout, rolled)],
  });
}
