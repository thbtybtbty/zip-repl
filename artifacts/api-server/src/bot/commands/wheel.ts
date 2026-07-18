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
  getBalance,
  addBalance,
  errorEmbed,
} from "../utils.js";

// ─── Segments ─────────────────────────────────────────────────────────────────
interface Segment { emoji: string; label: string; mult: number; weight: number; color: number }

const SEGMENTS: Segment[] = [
  { emoji: "💀", label: "Bankrupt",  mult: 0,    weight: 9, color: COLORS.dark    },
  { emoji: "🔴", label: "0.5×",      mult: 0.5,  weight: 7, color: COLORS.danger  },
  { emoji: "🟡", label: "1×",        mult: 1,    weight: 6, color: COLORS.warning  },
  { emoji: "🟢", label: "1.5×",      mult: 1.5,  weight: 5, color: COLORS.success },
  { emoji: "🔵", label: "2×",        mult: 2,    weight: 4, color: COLORS.primary },
  { emoji: "🟣", label: "3×",        mult: 3,    weight: 3, color: 0x9b59b6       },
  { emoji: "🟠", label: "5×",        mult: 5,    weight: 2, color: 0xe67e22       },
  { emoji: "💛", label: "10×",       mult: 10,   weight: 1, color: COLORS.gold    },
  { emoji: "💎", label: "25×",       mult: 25,   weight: 1, color: COLORS.gold    },
];

// Weighted pool
const POOL: Segment[] = SEGMENTS.flatMap((s) => Array(s.weight).fill(s));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Pick a random result from the weighted pool
function pickResult(): { result: Segment; poolIdx: number } {
  const poolIdx = Math.floor(Math.random() * POOL.length);
  return { result: POOL[poolIdx]!, poolIdx };
}

// Build a display strip of 7 segments centred on `centreIdx` in the pool
function buildStrip(centreIdx: number, highlight: boolean): string {
  return Array.from({ length: 7 }, (_, i) => {
    const seg = POOL[(centreIdx - 3 + i + POOL.length) % POOL.length]!;
    return i === 3 && highlight
      ? `**❰ ${seg.emoji} ${seg.label} ❱**`
      : `${seg.emoji} ${seg.label}`;
  }).join("  ·  ");
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

  if (!amount || amount <= 0)
    return interaction.editReply({ embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")] });

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount)
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
    });

  // ── Spin & settle ──────────────────────────────────────────────────────────
  const { result, poolIdx } = pickResult();
  await addBalance(interaction.user.id, -amount);
  const winnings = Math.floor(amount * result.mult);
  if (winnings > 0) await addBalance(interaction.user.id, winnings);
  const newBal = await getBalance(interaction.user.id);

  // ── Animation frames ───────────────────────────────────────────────────────
  // Move the centre index through the pool so the strip visibly scrolls
  const FRAMES = 6;
  const FRAME_MS = 420;

  for (let f = 0; f < FRAMES; f++) {
    // Animate the centre drifting toward the final index
    const shift  = Math.floor((FRAMES - f) * 4.5);
    const centre = (poolIdx - shift + POOL.length * 10) % POOL.length;
    const strip  = buildStrip(centre, false);
    const dots   = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴"][f % 6];
    await interaction.editReply({ content: `🎡  **Spinning…** ${dots}\n\n${strip}`, embeds: [] });
    await sleep(FRAME_MS);
  }

  // ── Final result embed ─────────────────────────────────────────────────────
  const net       = winnings - amount;
  const breakeven = result.mult === 1;

  let outcomeText: string;
  let footerText:  string;
  if (result.mult === 0) {
    outcomeText = `💀 **Bankrupt!** You lost **${formatAmount(amount)} 💎**`;
    footerText  = "Better luck next spin.";
  } else if (breakeven) {
    outcomeText = `😐 Break even — you get your bet back.`;
    footerText  = "Nothing lost, nothing gained.";
  } else if (net > 0) {
    outcomeText = `🎉 **${result.label} win!**  +${formatAmount(net)} 💎`;
    footerText  = result.mult >= 10 ? "MASSIVE WIN! 🔥" : "Nice spin!";
  } else {
    outcomeText = `📉 **${result.label}** — you get **${formatAmount(winnings)} 💎** back.`;
    footerText  = "Unlucky — try again!";
  }

  const embedColor = result.mult === 0 ? COLORS.danger : result.mult < 1 ? COLORS.warning : result.color;

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle("🎡  Wheel of Fortune")
    .setDescription(
      `${buildStrip(poolIdx, true)}\n\n${outcomeText}`,
    )
    .addFields(
      { name: "💰 Bet",         value: `${formatAmount(amount)} gems`,  inline: true },
      { name: "🎯 Multiplier",  value: result.label,                    inline: true },
      { name: "💵 Return",      value: `${formatAmount(winnings)} gems`, inline: true },
      { name: "💎 New Balance", value: `${formatAmount(newBal)} gems`,  inline: true },
    )
    .setFooter({ text: footerText })
    .setTimestamp();

  await interaction.editReply({ content: "", embeds: [embed] });
}
