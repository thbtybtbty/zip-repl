import {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
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
const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18,
  19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

// Full ordered wheel (American, 38 pockets)
const WHEEL: (number | "00")[] = [
  0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1,
  "00",
  27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2,
];

type Pocket = number | "00";

type BetType =
  | "red"
  | "black"
  | "odd"
  | "even"
  | "low"
  | "high"
  | "dozen1"
  | "dozen2"
  | "dozen3"
  | "col1"
  | "col2"
  | "col3"
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

  const n = p as number;
  const col = pocketColor(p) === "red" ? "🟥 Red" : "⬛ Black";
  const par = n % 2 === 0 ? "Even" : "Odd";
  const rng = n <= 18 ? "Low (1–18)" : "High (19–36)";
  const doz =
    n <= 12
      ? "1st Dozen"
      : n <= 24
        ? "2nd Dozen"
        : "3rd Dozen";

  return [col, par, rng, doz].join("  ·  ");
}

// ─── Strip builder ────────────────────────────────────────────────────────────
// Always shows 5 pockets. The center slot is permanently framed by 《 》.
function buildStrip(centreIdx: number, highlight: boolean): string {
  return Array.from({ length: 5 }, (_, i) => {
    const p =
      WHEEL[
        (centreIdx - 2 + i + WHEEL.length * 10) % WHEEL.length
      ]!;

    const label = `${pocketEmoji(p)} ${p}`;

    if (i === 2) {
      return highlight
        ? `《 **${label}** 》`
        : `《 ${label} 》`;
    }

    return label;
  }).join("  ·  ");
}

// ─── Bet evaluation ───────────────────────────────────────────────────────────
function evaluateBet(
  bet: BetType,
  straightTarget: string | null,
  result: Pocket,
): { won: boolean; payout: number } {
  const num = result === "00" ? -1 : (result as number);
  const isGreen = result === "00" || result === 0;
  const isRed = !isGreen && RED_NUMBERS.has(num);
  const isBlack = !isGreen && !isRed;

  switch (bet) {
    case "red":
      return { won: isRed, payout: 1 };

    case "black":
      return { won: isBlack, payout: 1 };

    case "odd":
      return { won: !isGreen && num % 2 !== 0, payout: 1 };

    case "even":
      return { won: !isGreen && num % 2 === 0, payout: 1 };

    case "low":
      return { won: num >= 1 && num <= 18, payout: 1 };

    case "high":
      return { won: num >= 19 && num <= 36, payout: 1 };

    case "dozen1":
      return { won: num >= 1 && num <= 12, payout: 2 };

    case "dozen2":
      return { won: num >= 13 && num <= 24, payout: 2 };

    case "dozen3":
      return { won: num >= 25 && num <= 36, payout: 2 };

    case "col1":
      return { won: num >= 1 && num % 3 === 1, payout: 2 };

    case "col2":
      return { won: num >= 1 && num % 3 === 2, payout: 2 };

    case "col3":
      return { won: num >= 1 && num % 3 === 0, payout: 2 };

    case "straight": {
      const target: Pocket =
        straightTarget === "00"
          ? "00"
          : parseInt(straightTarget ?? "", 10);

      return {
        won: result === target,
        payout: 35,
      };
    }

    default:
      return { won: false, payout: 0 };
  }
}

// ─── Display ──────────────────────────────────────────────────────────────────
const BET_DISPLAY: Record<BetType, string> = {
  red: "🟥 Red",
  black: "⬛ Black",
  odd: "🔢 Odd",
  even: "🔢 Even",
  low: "📉 Low (1–18)",
  high: "📈 High (19–36)",
  dozen1: "1️⃣ 1st Dozen",
  dozen2: "2️⃣ 2nd Dozen",
  dozen3: "3️⃣ 3rd Dozen",
  col1: "🔷 Column 1",
  col2: "🔷 Column 2",
  col3: "🔷 Column 3",
  straight: "🎯 Straight",
};

const MULTIPLIER_DISPLAY: Record<BetType, string> = {
  red: "2x",
  black: "2x",
  odd: "2x",
  even: "2x",
  low: "2x",
  high: "2x",
  dozen1: "3x",
  dozen2: "3x",
  dozen3: "3x",
  col1: "3x",
  col2: "3x",
  col3: "3x",
  straight: "36x",
};

// ─── Animation constants ──────────────────────────────────────────────────────
const OFFSETS = [36, 28, 21, 15, 10, 6, 3, 1, 0] as const;

const DELAYS = [140, 160, 200, 260, 320, 390, 460, 530, 650] as const;

// ─── Components V2 helpers ────────────────────────────────────────────────────
function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder();
}

// ─── Animation panel ──────────────────────────────────────────────────────────
function buildRouletteAnimationComponents(
  centre: number,
  highlight: boolean,
): ContainerBuilder[] {
  const panel = new ContainerBuilder()
    .setAccentColor(COLORS.primary)
    .addTextDisplayComponents(
      text("# 🎰 American Roulette — Spinning…"),
    )
    .addSeparatorComponents(
      separator(),
    )
    .addTextDisplayComponents(
      text(buildStrip(centre, highlight)),
    );

  return [panel];
}

// ─── Result panel ─────────────────────────────────────────────────────────────
function buildRouletteResultComponents(
  result: Pocket,
  resultIdx: number,
  bet: BetType,
  numOpt: string | null,
  amount: number,
  won: boolean,
  winAmount: number,
): ContainerBuilder[] {
  const color = won ? COLORS.success : COLORS.danger;

  const betName =
    bet === "straight"
      ? `🎯 Straight on **${numOpt}**`
      : BET_DISPLAY[bet];

  const statsLines = [
    `🎲 **Bet**        \`${betName}\``,
    `💸 **Stake**      \`${formatAmount(amount)}\``,
    `📊 **${won ? "Multiplier" : "Missed Multiplier"}**  \`${MULTIPLIER_DISPLAY[bet]}\``,
    `💰 **Payout**     \`${won ? formatAmount(amount + winAmount) : "0"}\``,
  ];

  const panel = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(
      text(won ? "# 🎰 American Roulette — YOU WON" : "# 🎰 American Roulette — YOU LOST"),
    )
    .addSeparatorComponents(
      separator(),
    )
    .addTextDisplayComponents(
      text(statsLines.join("\n")),
    )
    .addSeparatorComponents(
      separator(),
    )
    .addTextDisplayComponents(
      text(
        [
          "🎲 **Result**",
          buildStrip(resultIdx, true),
          "",
          `${pocketEmoji(result)}  **${result}**  —  ${pocketLabels(result)}`,
        ].join("\n"),
      ),
    );

  return [panel];
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("roulette")
  .setDescription("Spin the American Roulette wheel ")
  .addStringOption((opt) =>
    opt
      .setName("amount")
      .setDescription("Bet amount (e.g. 1m, 2.5b)")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("bet")
      .setDescription("Type of bet to place")
      .setRequired(true)
      .addChoices(
        { name: "🟥 Red (2x)", value: "red" },
        { name: "⬛ Black (2x)", value: "black" },
        { name: "🔢 Odd (2x)", value: "odd" },
        { name: "🔢 Even (2x)", value: "even" },
        { name: "📉 Low — 1 to 18 (2x)", value: "low" },
        { name: "📈 High — 19 to 36 (2x)", value: "high" },
        { name: "1️⃣ 1st Dozen — 1-12 (3x)", value: "dozen1" },
        { name: "2️⃣ 2nd Dozen — 13-24 (3x)", value: "dozen2" },
        { name: "3️⃣ 3rd Dozen — 25-36 (3x)", value: "dozen3" },
        { name: "🔷 Column 1 (3x)", value: "col1" },
        { name: "🔷 Column 2 (3x)", value: "col2" },
        { name: "🔷 Column 3 (3x)", value: "col3" },
        { name: "🎯 Straight — single number (36x)", value: "straight" },
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
  const bet = interaction.options.getString("bet", true) as BetType;
  const numOpt =
    interaction.options.getString("number", false)?.trim() ?? null;

  const amount = parseAmount(amountStr);

  if (!amount || amount < 1_000_000) {
    return interaction.reply({
      embeds: [
        errorEmbed(
          "Minimum bet is **1m gems**. Try `1m`, `2.5b`, `500k`.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  if (bet === "straight") {
    const valid =
      numOpt !== null &&
      (
        numOpt === "00" ||
        (
          /^\d+$/.test(numOpt) &&
          parseInt(numOpt, 10) >= 0 &&
          parseInt(numOpt, 10) <= 36
        )
      );

    if (!valid) {
      return interaction.editReply({
        embeds: [
          errorEmbed(
            'Straight bets require the `number` option — enter `0` to `36` or `00`.',
          ),
        ],
      });
    }
  }

  const user = await getOrCreateUser(
    interaction.user.id,
    interaction.user.username,
  );

  if (user.balance < amount) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`,
        ),
      ],
    });
  }

  // ── Settle before animating ────────────────────────────────────────────────
  const raw = Math.floor(Math.random() * 39);

  const resultIdx =
    raw < 38
      ? raw
      : Math.random() < 0.5
        ? 0
        : 19;

  const result = WHEEL[resultIdx]!;

  await addBalance(interaction.user.id, -amount);

  const { won, payout } = evaluateBet(
    bet,
    numOpt,
    result,
  );

  if (won) {
    await addBalance(
      interaction.user.id,
      amount + amount * payout,
    );
  }

  await recordBet(
    interaction.user.id,
    amount,
    won ? amount * payout : -amount,
    "roulette",
  );

  const winAmount = won ? amount * payout : 0;

  // ── Animation ──────────────────────────────────────────────────────────────
  for (let f = 0; f < OFFSETS.length; f++) {
    const centre =
      (
        resultIdx -
        OFFSETS[f]! +
        WHEEL.length * 10
      ) % WHEEL.length;

    const isLast = OFFSETS[f] === 0;

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: buildRouletteAnimationComponents(
        centre,
        isLast,
      ),
    });

    await sleep(DELAYS[f]!);
  }

  // ── Final result ───────────────────────────────────────────────────────────
  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: buildRouletteResultComponents(
      result,
      resultIdx,
      bet,
      numOpt,
      amount,
      won,
      winAmount,
    ),
  });
}