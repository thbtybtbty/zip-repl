import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { COLORS, parseAmount, formatAmount, getOrCreateUser, addBalance, errorEmbed } from "../utils.js";

// ─── Segments ─────────────────────────────────────────────────────────────────
// mult = total return multiplier (0 = lose all, 2 = get 2× back, etc.)
interface Segment {
  emoji: string;
  label: string;
  mult:  number;
  weight: number;
  color: number;
}

const SEGMENTS: Segment[] = [
  { emoji: "💀", label: "Bankrupt",  mult: 0,    weight: 9,  color: COLORS.dark },
  { emoji: "🔴", label: "0.5×",      mult: 0.5,  weight: 7,  color: COLORS.danger },
  { emoji: "🟡", label: "1×",        mult: 1,    weight: 6,  color: COLORS.warning },
  { emoji: "🟢", label: "1.5×",      mult: 1.5,  weight: 5,  color: COLORS.success },
  { emoji: "🔵", label: "2×",        mult: 2,    weight: 4,  color: COLORS.primary },
  { emoji: "🟣", label: "3×",        mult: 3,    weight: 3,  color: 0x9b59b6 },
  { emoji: "🟠", label: "5×",        mult: 5,    weight: 2,  color: 0xe67e22 },
  { emoji: "💛", label: "10×",       mult: 10,   weight: 1,  color: COLORS.gold },
  { emoji: "💎", label: "25×",       mult: 25,   weight: 1,  color: COLORS.gold },
];

// Build weighted pool
const POOL: Segment[] = [];
for (const seg of SEGMENTS) {
  for (let i = 0; i < seg.weight; i++) POOL.push(seg);
}

function spin(): { result: Segment; strip: Segment[] } {
  const idx    = Math.floor(Math.random() * POOL.length);
  const result = POOL[idx]!;

  // Build a 7-item display strip: 3 before, result, 3 after (wrapping)
  const strip: Segment[] = [];
  for (let offset = -3; offset <= 3; offset++) {
    strip.push(POOL[(idx + offset + POOL.length) % POOL.length]!);
  }
  return { result, strip };
}

function buildStrip(strip: Segment[]): string {
  // strip[3] is the result (middle)
  return strip
    .map((s, i) =>
      i === 3
        ? `❰ ${s.emoji} **${s.label}** ❱`
        : `${s.emoji} ${s.label}`,
    )
    .join("  ·  ");
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("wheel")
  .setDescription("Spin the Wheel of Fortune — land on a multiplier and win big!")
  .addStringOption((opt) =>
    opt.setName("amount").setDescription("Bet amount (e.g. 1m, 2.5b)").setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const amountStr = interaction.options.getString("amount", true);
  const amount    = parseAmount(amountStr);

  if (!amount || amount <= 0) {
    return interaction.editReply({ embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")] });
  }

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount) {
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎 gems**.`)],
    });
  }

  await addBalance(interaction.user.id, -amount);

  const { result, strip } = spin();

  const winnings  = Math.floor(amount * result.mult);
  const net       = winnings - amount;
  const won       = net > 0;
  const breakeven = net === 0 && result.mult === 1;

  if (winnings > 0) await addBalance(interaction.user.id, winnings);

  const newBal = await import("../utils.js").then((u) => u.getBalance(interaction.user.id));

  let outcomeText: string;
  let footerText:  string;

  if (result.mult === 0) {
    outcomeText = `💀 **Bankrupt!** You lost **${formatAmount(amount)} 💎**`;
    footerText  = "Better luck next spin.";
  } else if (breakeven) {
    outcomeText = `😐 Break even — you get your bet back.`;
    footerText  = "Nothing lost, nothing gained.";
  } else if (won) {
    outcomeText = `🎉 **${result.label} win!** +${formatAmount(net)} 💎`;
    footerText  = result.mult >= 10 ? "MASSIVE WIN! 🔥" : "Nice spin!";
  } else {
    outcomeText = `📉 Landed on **${result.label}** — you get **${formatAmount(winnings)} 💎** back.`;
    footerText  = "Unlucky — try again!";
  }

  const embed = new EmbedBuilder()
    .setColor(result.mult === 0 ? COLORS.danger : result.mult < 1 ? COLORS.warning : result.color)
    .setTitle("🎡  Wheel of Fortune")
    .setDescription(
      `${buildStrip(strip)}\n\n` +
      `${outcomeText}`,
    )
    .addFields(
      { name: "💰 Bet",          value: `${formatAmount(amount)} gems`,    inline: true },
      { name: "🎯 Multiplier",   value: result.label,                       inline: true },
      { name: "💵 Return",       value: `${formatAmount(winnings)} gems`,   inline: true },
      { name: "💎 New Balance",  value: `${formatAmount(newBal)} gems`,     inline: true },
    )
    .setFooter({ text: footerText })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
