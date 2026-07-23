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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function winChancePct(multiplier: number): number {
  return (RTP / multiplier) * 100;
}

/**
 * 24-block colour bar.
 * 🟦 = win zone  ⬛ = loss zone  🟩 = roll landed here (win)  🟥 = roll landed here (loss)
 */
function buildBar(chancePct: number, rolled: number, won: boolean): string {
  const SEGS    = 24;
  const winSegs = Math.round((chancePct / 100) * SEGS);
  const rollSeg = Math.min(SEGS - 1, Math.floor((rolled / 100) * SEGS));

  return Array.from({ length: SEGS }, (_, i) => {
    if (i === rollSeg) return won ? "🟩" : "🟥";
    return i < winSegs ? "🟦" : "⬛";
  }).join("");
}

// ─── Embed ────────────────────────────────────────────────────────────────────
function resultEmbed(
  bet:        number,
  multiplier: number,
  won:        boolean,
  payout:     number,
  rolled:     number, // 0.00 – 99.99
): EmbedBuilder {
  const chancePct = winChancePct(multiplier);
  const profit    = payout - bet;

  // ── Hero line: the roll comparison ──
  const symbol  = won ? "✅" : "❌";
  const verdict = won ? "**WIN**" : "**LOSS**";
  const heroLine = won
    ? `${symbol}  \`${rolled.toFixed(2)}\` rolled  \`<\`  \`${chancePct.toFixed(2)}\` needed  →  ${verdict}`
    : `${symbol}  \`${rolled.toFixed(2)}\` rolled  \`≥\`  \`${chancePct.toFixed(2)}\` needed  →  ${verdict}`;

  // ── Bar legend ──
  const legendLine = `\`◀ WIN ${chancePct.toFixed(1).padStart(5)}%  ${"─".repeat(8)}  ${(100 - chancePct).toFixed(1).padEnd(5)}% LOSS ▶\``;

  const embed = new EmbedBuilder()
    .setColor(won ? COLORS.success : COLORS.danger)
    .setTitle("⬆️  Upgrader")
    .setDescription(
      [
        heroLine,
        "",
        buildBar(chancePct, rolled, won),
        legendLine,
      ].join("\n"),
    )
    .addFields(
      { name: "💎  Bet",        value: `\`${formatAmount(bet)}\``,              inline: true },
      { name: "✨  Multiplier", value: `\`${multiplier.toFixed(2)}×\``,         inline: true },
      { name: "📊  Win Chance", value: `\`${chancePct.toFixed(2)}%\``,          inline: true },
    );

  if (won) {
    embed.addFields(
      { name: "💰  Payout", value: `\`${formatAmount(payout)}\``,   inline: true },
      { name: "📈  Profit", value: `\`+${formatAmount(profit)}\``,  inline: true },
      { name: "\u200b",     value: "\u200b",                         inline: true },
    );
  } else {
    embed.addFields(
      { name: "💸  Lost", value: `\`-${formatAmount(bet)}\``, inline: true },
    );
  }

  embed
    .setFooter({ text: "House edge 7.5%  •  /upgrader" })
    .setTimestamp();

  return embed;
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
