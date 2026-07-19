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
  errorEmbed,
} from "../utils.js";

// ─── Segments ─────────────────────────────────────────────────────────────────
interface Segment { emoji: string; label: string; mult: number; weight: number; color: number }

const SEGMENTS: Segment[] = [
  { emoji: "💀", label: "0x",  mult: 0,    weight: 9, color: COLORS.dark    },
  { emoji: "🔴", label: "0.5×",      mult: 0.5,  weight: 7, color: COLORS.danger  },
  { emoji: "🟡", label: "1×",        mult: 1,    weight: 6, color: COLORS.warning  },
  { emoji: "🟢", label: "1.5×",      mult: 1.5,  weight: 5, color: COLORS.success },
  { emoji: "🔵", label: "2×",        mult: 2,    weight: 4, color: COLORS.primary },
  { emoji: "🟣", label: "3×",        mult: 3,    weight: 3, color: 0x9b59b6       },
  { emoji: "🟠", label: "5×",        mult: 5,    weight: 2, color: 0xe67e22       },
  { emoji: "💛", label: "10×",       mult: 10,   weight: 1, color: COLORS.gold    },
  { emoji: "💎", label: "25×",       mult: 25,   weight: 1, color: COLORS.gold    },
];

// Weighted pool — each segment appears proportional to its weight
const POOL: Segment[] = SEGMENTS.flatMap((s) => Array(s.weight).fill(s));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Pick a result from the weighted pool ─────────────────────────────────────
function pickResult(): { result: Segment; poolIdx: number } {
  const poolIdx = Math.floor(Math.random() * POOL.length);
  return { result: POOL[poolIdx]!, poolIdx };
}

// ─── Strip builder ────────────────────────────────────────────────────────────
// Always shows 5 items. The center slot (i=2) is permanently framed by 《 》 —
// it acts as the fixed pointer that never moves. Items scroll past it.
function buildStrip(centreIdx: number, highlight: boolean): string {
  return Array.from({ length: 5 }, (_, i) => {
    const seg   = POOL[(centreIdx - 2 + i + POOL.length * 10) % POOL.length]!;
    const label = `${seg.emoji} ${seg.label}`;
    if (i === 2) return highlight ? `《 **${label}** 》` : `《 ${label} 》`;
    return label;
  }).join("  ·  ");
}

// ─── Animation constants ──────────────────────────────────────────────────────
// Positions decrease (deceleration): strip scrolls fast then eases to a stop.
// DELAYS[f] = milliseconds to wait after showing frame f.
const OFFSETS = [36, 28, 21, 15, 10, 6, 3, 1, 0] as const;
const DELAYS  = [140, 160, 200, 260, 320, 390, 460, 530, 650] as const;

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("wheel")
  .setDescription("Spin the Wheel of Fortune")
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

  // ── Settle before animating ────────────────────────────────────────────────
  const { result, poolIdx } = pickResult();
  await addBalance(interaction.user.id, -amount);
  const winnings  = Math.floor(amount * result.mult);
  if (winnings > 0) await addBalance(interaction.user.id, winnings);
  const oddsText  = `${((result.weight / POOL.length) * 100).toFixed(1)}%`;

  // ── Animation: scroll strip through decelerating offsets ──────────────────
  for (let f = 0; f < OFFSETS.length; f++) {
    const centre = (poolIdx - OFFSETS[f]! + POOL.length * 10) % POOL.length;
    // Last frame (offset = 0): strip is already on the result — highlight it
    const isLast = OFFSETS[f] === 0;
    await interaction.editReply({
      content: "",
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.primary)
          .setTitle("🎡  Wheel of Fortune — Spinning…")
          .setDescription(buildStrip(centre, isLast))
          .setTimestamp(),
      ],
    });
    await sleep(DELAYS[f]!);
  }

  // ── Result embed ───────────────────────────────────────────────────────────
  const net = winnings - amount;

  let outcomeText: string;
  if (result.mult === 0) {
    outcomeText = `💀 **0x!** You lost **${formatAmount(amount)} 💎**`;
  } else if (result.mult === 1) {
    outcomeText = `😐 Break even — you get your bet back.`;
  } else if (net > 0) {
    outcomeText = `🎉 **${result.label} win!**  +${formatAmount(net)} 💎`;
  } else {
    outcomeText = `📉 **${result.label}** — you get **${formatAmount(winnings)} 💎** back.`;
  }

  const embedColor =
    result.mult === 0 ? COLORS.danger :
    result.mult <  1 ? COLORS.warning :
    result.color;

  await interaction.editReply({
    content: "",
    embeds: [
      new EmbedBuilder()
        .setColor(embedColor)
        .setTitle("🎡  Wheel of Fortune")
        .setDescription(`${buildStrip(poolIdx, true)}\n\n${outcomeText}`)
        .addFields(
          { name: "💰 Bet",        value: `${formatAmount(amount)} gems`,   inline: true },
          { name: "🎯 Multiplier", value: result.label,                     inline: true },
          { name: "📊 Odds",       value: oddsText,                         inline: true },
          { name: "💵 Return",     value: `${formatAmount(winnings)} gems`,  inline: true },
        )
        .setTimestamp(),
    ],
  });
}
