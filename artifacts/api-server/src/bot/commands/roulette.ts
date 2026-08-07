import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
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

// ─── American Roulette constants ──────────────────────────────────────────────
const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

// Full ordered wheel (American, 38 pockets)
const WHEEL: (number | "00")[] = [
  0,28,9,26,30,11,7,20,32,17,5,22,34,15,3,24,36,13,1,
  "00",
  27,10,25,29,12,8,19,31,18,6,21,33,16,4,23,35,14,2,
];

type Pocket = number | "00";
type BetType =
  | "red" | "black" | "odd" | "even"
  | "low" | "high"
  | "dozen1" | "dozen2" | "dozen3"
  | "col1" | "col2" | "col3"
  | "straight";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Pocket helpers ───────────────────────────────────────────────────────────
function pocketColor(p: Pocket): "green" | "red" | "black" {
  if (p === "00" || p === 0) return "green";
  return RED_NUMBERS.has(p as number) ? "red" : "black";
}

function pocketEmoji(p: Pocket): string {
  const c = pocketColor(p);
  return c === "green" ? "🟩" : c === "red" ? "🟥" : "⬛";
}

function pocketLabels(p: Pocket): string {
  if (p === "00" || p === 0) return "🟩 Green  ·  House pocket";
  const n   = p as number;
  const col = pocketColor(p) === "red" ? "🟥 Red" : "⬛ Black";
  const par = n % 2 === 0 ? "Even" : "Odd";
  const rng = n <= 18 ? "Low (1–18)" : "High (19–36)";
  const doz = n <= 12 ? "1st Dozen" : n <= 24 ? "2nd Dozen" : "3rd Dozen";
  return [col, par, rng, doz].join("  ·  ");
}

// ─── Strip builder ────────────────────────────────────────────────────────────
// Always shows 5 pockets. The center slot (i=2) is permanently framed by 《 》 —
// it acts as the fixed pointer that never moves. Items scroll past it.
function buildStrip(centreIdx: number, highlight: boolean): string {
  return Array.from({ length: 5 }, (_, i) => {
    const p     = WHEEL[(centreIdx - 2 + i + WHEEL.length * 10) % WHEEL.length]!;
    const label = `${pocketEmoji(p)} ${p}`;
    if (i === 2) return highlight ? `《 **${label}** 》` : `《 ${label} 》`;
    return label;
  }).join("  ·  ");
}

// ─── Bet evaluation ───────────────────────────────────────────────────────────
function evaluateBet(
  bet: BetType,
  straightTarget: string | null,
  result: Pocket,
): { won: boolean; payout: number } {
  const num     = result === "00" ? -1 : (result as number);
  const isGreen = result === "00" || result === 0;
  const isRed   = !isGreen && RED_NUMBERS.has(num);
  const isBlack = !isGreen && !isRed;

  switch (bet) {
    case "red":    return { won: isRed,                          payout: 1  };
    case "black":  return { won: isBlack,                        payout: 1  };
    case "odd":    return { won: !isGreen && num % 2 !== 0,      payout: 1  };
    case "even":   return { won: !isGreen && num % 2 === 0,      payout: 1  };
    case "low":    return { won: num >= 1 && num <= 18,          payout: 1  };
    case "high":   return { won: num >= 19 && num <= 36,         payout: 1  };
    case "dozen1": return { won: num >= 1 && num <= 12,          payout: 2  };
    case "dozen2": return { won: num >= 13 && num <= 24,         payout: 2  };
    case "dozen3": return { won: num >= 25 && num <= 36,         payout: 2  };
    case "col1":   return { won: num >= 1 && num % 3 === 1,      payout: 2  };
    case "col2":   return { won: num >= 1 && num % 3 === 2,      payout: 2  };
    case "col3":   return { won: num >= 1 && num % 3 === 0,      payout: 2  };
    case "straight": {
      const target: Pocket =
        straightTarget === "00" ? "00" : parseInt(straightTarget ?? "", 10);
      return { won: result === target, payout: 35 };
    }
    default: return { won: false, payout: 0 };
  }
}

const BET_DISPLAY: Record<BetType, string> = {
  red:    "🟥 Red",          black:  "⬛ Black",
  odd:    "🔢 Odd",          even:   "🔢 Even",
  low:    "📉 Low (1–18)",   high:   "📈 High (19–36)",
  dozen1: "1️⃣ 1st Dozen",   dozen2: "2️⃣ 2nd Dozen",   dozen3: "3️⃣ 3rd Dozen",
  col1:   "🔷 Column 1",    col2:   "🔷 Column 2",    col3:   "🔷 Column 3",
  straight: "🎯 Straight",
};

const PAYOUT_DISPLAY: Record<BetType, string> = {
  red: "1:1", black: "1:1", odd: "1:1", even: "1:1", low: "1:1", high: "1:1",
  dozen1: "2:1", dozen2: "2:1", dozen3: "2:1",
  col1: "2:1", col2: "2:1", col3: "2:1",
  straight: "35:1",
};

// ─── Animation constants ──────────────────────────────────────────────────────
// Positions decrease (deceleration): strip scrolls fast then eases to a stop.
// DELAYS[f] = milliseconds to wait after showing frame f.
const OFFSETS = [36, 28, 21, 15, 10, 6, 3, 1, 0] as const;
const DELAYS  = [140, 160, 200, 260, 320, 390, 460, 530, 650] as const;

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("roulette")
  .setDescription("Spin the American Roulette wheel ")
  .addStringOption((opt) =>
    opt.setName("amount").setDescription("Bet amount (e.g. 1m, 2.5b)").setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("bet")
      .setDescription("Type of bet to place")
      .setRequired(true)
      .addChoices(
        { name: "🟥 Red (1:1)",                     value: "red"      },
        { name: "⬛ Black (1:1)",                    value: "black"    },
        { name: "🔢 Odd (1:1)",                      value: "odd"      },
        { name: "🔢 Even (1:1)",                     value: "even"     },
        { name: "📉 Low — 1 to 18 (1:1)",           value: "low"      },
        { name: "📈 High — 19 to 36 (1:1)",         value: "high"     },
        { name: "1️⃣ 1st Dozen — 1-12 (2:1)",        value: "dozen1"   },
        { name: "2️⃣ 2nd Dozen — 13-24 (2:1)",       value: "dozen2"   },
        { name: "3️⃣ 3rd Dozen — 25-36 (2:1)",       value: "dozen3"   },
        { name: "🔷 Column 1 (2:1)",                 value: "col1"     },
        { name: "🔷 Column 2 (2:1)",                 value: "col2"     },
        { name: "🔷 Column 3 (2:1)",                 value: "col3"     },
        { name: "🎯 Straight — single number (35:1)", value: "straight" },
      ),
  )
  .addStringOption((opt) =>
    opt
      .setName("number")
      .setDescription('Required for Straight bet — enter 0 to 36, or "00"')
      .setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const amountStr = interaction.options.getString("amount", true);
  const bet       = interaction.options.getString("bet", true) as BetType;
  const numOpt    = interaction.options.getString("number", false)?.trim() ?? null;
  const amount    = parseAmount(amountStr);

  if (!amount || amount < 1_000_000)
    return interaction.reply({
      embeds: [errorEmbed("Minimum bet is **1m gems**. Try `1m`, `2.5b`, `500k`.")],
      flags: MessageFlags.Ephemeral,
    });

  await interaction.deferReply();

  if (bet === "straight") {
    const valid =
      numOpt !== null &&
      (numOpt === "00" || (/^\d+$/.test(numOpt) && parseInt(numOpt, 10) >= 0 && parseInt(numOpt, 10) <= 36));
    if (!valid)
      return interaction.editReply({
        embeds: [errorEmbed('Straight bets require the `number` option — enter `0` to `36` or `00`.')],
      });
  }

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount)
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
    });

  // ── Settle before animating ────────────────────────────────────────────────
  // Virtual 39-pocket wheel: 1/39 extra green → house edge 3/39 ≈ 7.69%
  const raw       = Math.floor(Math.random() * 39);
  const resultIdx = raw < 38 ? raw : (Math.random() < 0.5 ? 0 : 19); // 0=0, 19="00"
  const result    = WHEEL[resultIdx]!;

  await addBalance(interaction.user.id, -amount);
  const { won, payout } = evaluateBet(bet, numOpt, result);
  if (won) await addBalance(interaction.user.id, amount + amount * payout);
  await recordBet(interaction.user.id, amount, won ? amount * payout : -amount, "roulette");

  const winningPockets: Record<BetType, number> = {
    red: 18, black: 18, odd: 18, even: 18, low: 18, high: 18,
    dozen1: 12, dozen2: 12, dozen3: 12,
    col1: 12, col2: 12, col3: 12,
    straight: 1,
  };
  const oddsText  = `${((winningPockets[bet]! / 38) * 100).toFixed(1)}%`;
  const winAmount = won ? amount * payout : 0;

  // ── Animation: scroll strip through decelerating offsets ──────────────────
  for (let f = 0; f < OFFSETS.length; f++) {
    const centre = (resultIdx - OFFSETS[f]! + WHEEL.length * 10) % WHEEL.length;
    const isLast = OFFSETS[f] === 0;
    await interaction.editReply({
      content: "",
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.primary)
          .setTitle("🎰  American Roulette — Spinning…")
          .setDescription(buildStrip(centre, isLast))
          .setTimestamp(),
      ],
    });
    await sleep(DELAYS[f]!);
  }

  // ── Result embed ───────────────────────────────────────────────────────────
  const color   = won ? COLORS.success : COLORS.danger;
  const betName = bet === "straight" ? `🎯 Straight on **${numOpt}**` : BET_DISPLAY[bet];

  const statsLines = [
    `🎲 **Bet**    \`${betName}\``,
    `💸 **Stake**  \`${formatAmount(amount)}\``,
    `📊 **Odds**   \`${oddsText}  ·  ${PAYOUT_DISPLAY[bet]}\``,
    `💰 **Payout**  \`${won ? formatAmount(amount + winAmount) : "0"}\``,
  ].join("\n");

  await interaction.editReply({
    content: "",
    embeds: [
      new EmbedBuilder()
        .setColor(color)
        .setTitle("🎰  American Roulette")
        .setDescription(
          `${buildStrip(resultIdx, true)}\n` +
          `${pocketEmoji(result)}  **${result}**  —  ${pocketLabels(result)}\n\n` +
          statsLines,
        )
        .setTimestamp(),
    ],
  });
}
