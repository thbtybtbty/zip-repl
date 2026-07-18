import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { COLORS, parseAmount, formatAmount, getOrCreateUser, addBalance, errorEmbed } from "../utils.js";

// ─── American Roulette constants ──────────────────────────────────────────────
const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

type Pocket = number | "00";
type BetType =
  | "red" | "black" | "odd" | "even"
  | "low" | "high"
  | "dozen1" | "dozen2" | "dozen3"
  | "col1" | "col2" | "col3"
  | "straight";

// ─── Spin ─────────────────────────────────────────────────────────────────────
function spinWheel(): Pocket {
  const n = Math.floor(Math.random() * 38); // 0–37 → 0–36 plus "00"
  return n === 37 ? "00" : n;
}

function pocketColor(p: Pocket): "green" | "red" | "black" {
  if (p === "00" || p === 0) return "green";
  return RED_NUMBERS.has(p as number) ? "red" : "black";
}

function pocketEmoji(p: Pocket): string {
  switch (pocketColor(p)) {
    case "green": return "🟩";
    case "red":   return "🟥";
    default:      return "⬛";
  }
}

// Extra info labels for the result pocket
function pocketLabels(p: Pocket): string[] {
  if (p === "00" || p === 0) return ["🟩 Green", "House pocket"];
  const n   = p as number;
  const col = pocketColor(p) === "red" ? "🟥 Red" : "⬛ Black";
  const par = n % 2 === 0 ? "Even" : "Odd";
  const rng = n <= 18 ? "Low (1–18)" : "High (19–36)";
  const doz = n <= 12 ? "1st Dozen (1–12)" : n <= 24 ? "2nd Dozen (13–24)" : "3rd Dozen (25–36)";
  const rem = n % 3;
  const cls = rem === 1 ? "Column 1" : rem === 2 ? "Column 2" : "Column 3";
  return [col, par, rng, doz, cls];
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
    case "red":    return { won: isRed,                              payout: 1 };
    case "black":  return { won: isBlack,                           payout: 1 };
    case "odd":    return { won: !isGreen && num % 2 !== 0,         payout: 1 };
    case "even":   return { won: !isGreen && num % 2 === 0,         payout: 1 };
    case "low":    return { won: num >= 1 && num <= 18,             payout: 1 };
    case "high":   return { won: num >= 19 && num <= 36,            payout: 1 };
    case "dozen1": return { won: num >= 1 && num <= 12,             payout: 2 };
    case "dozen2": return { won: num >= 13 && num <= 24,            payout: 2 };
    case "dozen3": return { won: num >= 25 && num <= 36,            payout: 2 };
    case "col1":   return { won: num >= 1 && num % 3 === 1,         payout: 2 };
    case "col2":   return { won: num >= 1 && num % 3 === 2,         payout: 2 };
    case "col3":   return { won: num >= 1 && num % 3 === 0,         payout: 2 };
    case "straight": {
      // straightTarget is "00" or a numeric string "0"–"36"
      const target: Pocket =
        straightTarget === "00" ? "00" : parseInt(straightTarget ?? "", 10);
      return { won: result === target, payout: 35 };
    }
    default: return { won: false, payout: 0 };
  }
}

// ─── Bet display names ────────────────────────────────────────────────────────
const BET_DISPLAY: Record<BetType, string> = {
  red:    "🟥 Red",
  black:  "⬛ Black",
  odd:    "🔢 Odd",
  even:   "🔢 Even",
  low:    "📉 Low (1–18)",
  high:   "📈 High (19–36)",
  dozen1: "1️⃣ 1st Dozen (1–12)",
  dozen2: "2️⃣ 2nd Dozen (13–24)",
  dozen3: "3️⃣ 3rd Dozen (25–36)",
  col1:   "🔷 Column 1",
  col2:   "🔷 Column 2",
  col3:   "🔷 Column 3",
  straight: "🎯 Straight (Single Number)",
};

const PAYOUT_DISPLAY: Record<BetType, string> = {
  red: "1:1", black: "1:1", odd: "1:1", even: "1:1",
  low: "1:1", high: "1:1",
  dozen1: "2:1", dozen2: "2:1", dozen3: "2:1",
  col1: "2:1", col2: "2:1", col3: "2:1",
  straight: "35:1",
};

// ─── Spinning wheel visual ────────────────────────────────────────────────────
// Show a strip of 7 random pockets with the result highlighted in the center
function buildWheelStrip(result: Pocket): string {
  const all: Pocket[] = [];
  for (let i = 0; i <= 36; i++) all.push(i);
  all.push("00");

  // Pick 3 random "fly-by" pockets for each side (avoid repeating result)
  const others = all.filter((p) => p !== result);
  const shuffle = <T>(a: T[]) => a.sort(() => Math.random() - 0.5);
  const picks   = shuffle([...others]).slice(0, 6);

  const left  = picks.slice(0, 3).map((p) => `${pocketEmoji(p)} ${p}`);
  const right = picks.slice(3, 6).map((p) => `${pocketEmoji(p)} ${p}`);
  const center = `**${pocketEmoji(result)} ${result}**`;

  return [...left, center, ...right].join("  ·  ");
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("roulette")
  .setDescription("Spin the American Roulette wheel — 38 pockets, real casino rules!")
  .addStringOption((opt) =>
    opt.setName("amount").setDescription("Bet amount (e.g. 1m, 2.5b)").setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("bet")
      .setDescription("Type of bet to place")
      .setRequired(true)
      .addChoices(
        { name: "🟥 Red (1:1)",              value: "red" },
        { name: "⬛ Black (1:1)",             value: "black" },
        { name: "🔢 Odd (1:1)",               value: "odd" },
        { name: "🔢 Even (1:1)",              value: "even" },
        { name: "📉 Low — 1 to 18 (1:1)",    value: "low" },
        { name: "📈 High — 19 to 36 (1:1)",  value: "high" },
        { name: "1️⃣ 1st Dozen — 1-12 (2:1)", value: "dozen1" },
        { name: "2️⃣ 2nd Dozen — 13-24 (2:1)",value: "dozen2" },
        { name: "3️⃣ 3rd Dozen — 25-36 (2:1)",value: "dozen3" },
        { name: "🔷 Column 1 (2:1)",          value: "col1" },
        { name: "🔷 Column 2 (2:1)",          value: "col2" },
        { name: "🔷 Column 3 (2:1)",          value: "col3" },
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
  await interaction.deferReply();

  const amountStr = interaction.options.getString("amount", true);
  const bet       = interaction.options.getString("bet", true) as BetType;
  const numOpt    = interaction.options.getString("number", false)?.trim() ?? null;
  const amount    = parseAmount(amountStr);

  if (!amount || amount <= 0) {
    return interaction.editReply({ embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")] });
  }

  // Straight bet requires a number
  if (bet === "straight") {
    const valid =
      numOpt !== null &&
      (numOpt === "00" || (/^\d+$/.test(numOpt) && parseInt(numOpt, 10) >= 0 && parseInt(numOpt, 10) <= 36));
    if (!valid) {
      return interaction.editReply({
        embeds: [errorEmbed('Straight bets require a number. Add the `number` option with a value from `0` to `36`, or `00`.')],
      });
    }
  }

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount) {
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎 gems**.`)],
    });
  }

  // Deduct bet, spin, evaluate
  await addBalance(interaction.user.id, -amount);
  const result            = spinWheel();
  const { won, payout }   = evaluateBet(bet, numOpt, result);
  const winnings          = won ? amount * payout : 0;
  if (won) await addBalance(interaction.user.id, amount + winnings); // return bet + winnings
  const newBal = await import("../utils.js").then((u) => u.getBalance(interaction.user.id));

  // Build embed
  const color   = won ? COLORS.success : COLORS.danger;
  const labels  = pocketLabels(result);
  const betName = bet === "straight"
    ? `🎯 Straight on **${numOpt}**`
    : BET_DISPLAY[bet];

  const resultHeader =
    `${pocketEmoji(result)}  **${result}**  ${pocketEmoji(result)}\n` +
    `${labels.join("  ·  ")}`;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle("🎰  American Roulette")
    .setDescription(
      `${buildWheelStrip(result)}\n\n` +
      `${resultHeader}`,
    )
    .addFields(
      { name: "🎲 Your Bet",     value: betName,                      inline: true },
      { name: "💰 Wagered",      value: `${formatAmount(amount)} gems`, inline: true },
      { name: "📋 Payout Odds",  value: PAYOUT_DISPLAY[bet],           inline: true },
      won
        ? { name: "🎉 Won",       value: `+${formatAmount(winnings)} gems`, inline: true }
        : { name: "💀 Lost",      value: `-${formatAmount(amount)} gems`,   inline: true },
      { name: "💎 Balance",      value: `${formatAmount(newBal)} gems`,  inline: true },
      { name: "\u200b",           value: "\u200b",                        inline: true },
    )
    .setFooter({
      text: won
        ? payout === 35 ? "🔥 STRAIGHT HIT! Incredible!" : "Winner! 🍀"
        : pocketColor(result) === "green"
          ? "🟩 House pocket — the wheel always has an edge."
          : "Spin again — your number's coming.",
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
