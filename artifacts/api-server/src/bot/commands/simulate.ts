import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { COLORS, errorEmbed } from "../utils.js";
import { isAdmin } from "../botConfig.js";
import { calcMinesMultiplier } from "./mines.js";
import { spinSlots } from "./slots.js";
import { buildHiloDeck } from "./hilo.js";

// ─── Game registry ─────────────────────────────────────────────────────────────
const GAME_CHOICES = [
  { name: "🃏 Blackjack",         value: "blackjack" },
  { name: "💣 Mines",             value: "mines" },
  { name: "🗼 Towers",            value: "towers" },
  { name: "🪙 Coin Flip",         value: "coinflip" },
  { name: "✊ Rock Paper Scissors",value: "rps" },
  { name: "🎡 Wheel",             value: "wheel" },
  { name: "🎰 Slots",             value: "slots" },
  { name: "🃏 Hi-Lo",             value: "hilo" },
  { name: "🎰 Scratchcard",       value: "scratchcard" },
  { name: "🐔 Chicken Crossing",  value: "chickencrossing" },
  { name: "🎲 Color Dice",        value: "colordice" },
  { name: "⚡ Upgrader",          value: "upgrader" },
  { name: "🎯 Keno",              value: "keno" },
  { name: "🚀 Crash",             value: "crash" },
  { name: "🪙 Flip (PvE)",        value: "flip" },
  { name: "🎡 Roulette",          value: "roulette" },
];

const VARIANT_HELP: Record<string, string> = {
  mines:          "Format `{mines}:{gems}` — mines count then gems to reveal before cashing out. E.g. `5:3` = 5 mines, cashout after 3 safe tiles. Default: `5:1`",
  towers:         "Format `{difficulty}:{levels}` — difficulty then levels to climb before cashing out. E.g. `hard:5` = hard, cashout after 5 levels. Default: `medium:4`",
  chickencrossing:"Format `{difficulty}:{lanes}` — difficulty then lanes to cross before cashing out. E.g. `medium:8` = medium, cashout after 8 lanes. Default: `medium:4`",
  keno:           "Difficulty — `easy` `hard`  (default: easy)",
  upgrader:       "Target multiplier — `1.5` `2` `3` `5` `10` `25`  (default: 2)",
  crash:          "Cashout target multiplier — e.g. `2` `3` `5` `10`  (default: 2)",
  roulette:       "Bet type — `red` `dozen` `straight`  (default: red)",
};

const GAME_LABELS: Record<string, string> = {
  blackjack: "Blackjack", mines: "Mines", towers: "Towers",
  coinflip: "Coin Flip", rps: "Rock Paper Scissors", wheel: "Wheel", slots: "Slots",
  hilo: "Hi-Lo",
  scratchcard: "Scratchcard", chickencrossing: "Chicken Crossing",
  colordice: "Color Dice", upgrader: "Upgrader", keno: "Keno",
  crash: "Crash", flip: "Flip (PvE)", roulette: "Roulette",
};

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("simulate")
  .setDescription("(Admin) Simulate playing a game")
  .addStringOption((opt) =>
    opt.setName("game").setDescription("Which game to simulate").setRequired(true)
      .addChoices(...GAME_CHOICES),
  )
  .addIntegerOption((opt) =>
    opt.setName("simulations").setDescription("Number of rounds to simulate (1 000 – 100 000)").setRequired(true)
      .setMinValue(1_000).setMaxValue(100_000),
  )
  .addStringOption((opt) =>
    opt.setName("variant").setDescription("Difficulty / type / mine count / multiplier (depends on game)").setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isAdmin(interaction.user.id)) {
    return interaction.editReply({ embeds: [errorEmbed("Admin only.")] });
  }

  const game    = interaction.options.getString("game", true);
  const n       = interaction.options.getInteger("simulations", true);
  const variant = (interaction.options.getString("variant") ?? "").toLowerCase().trim();

  const result = runSimulation(game, variant, n);

  const variantHelp = VARIANT_HELP[game];
  const variantLine = variantHelp
    ? `📐 **Variant hint**  ${variantHelp}`
    : null;

  const variantDisplay = resolveVariantDisplay(game, variant);

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(`📊  Simulation — ${GAME_LABELS[game] ?? game}`)
    .setDescription(
      [
        `\`${"⠀".repeat(38)}\``,
        variantDisplay ? `🎮 **Variant**       \`${variantDisplay}\`` : null,
        `🔁 **Simulations**  \`${n.toLocaleString()}\``,
        ``,
        `📈 **RTP**          \`${result.rtp.toFixed(2)}%\``,
        `🏠 **House Edge**   \`${result.houseEdge.toFixed(2)}%\``,
        `✅ **Win Rate**     \`${result.winPct.toFixed(2)}%\``,
        `💰 **Avg Payout**   \`${result.avgPayout.toFixed(4)}×\``,
        `🏆 **Wins**         \`${result.wins.toLocaleString()} / ${n.toLocaleString()}\``,
        ``,
        variantLine,
      ].filter((l) => l !== null).join("\n"),
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ─── Variant parsers ──────────────────────────────────────────────────────────

function parseMinesVariant(v: string): { mines: number; gems: number } {
  const [a, b] = v.split(":");
  const mines = Math.max(1, Math.min(24, parseInt(a ?? "5", 10) || 5));
  const maxGems = 25 - mines;
  const gems  = Math.max(1, Math.min(maxGems, parseInt(b ?? "1", 10) || 1));
  return { mines, gems };
}

function parseTowersVariant(v: string): { difficulty: string; levels: number } {
  const [a, b] = v.split(":");
  const difficulty = ["easy","medium","hard"].includes(a ?? "") ? (a ?? "medium") : "medium";
  const levels = Math.max(1, Math.min(8, parseInt(b ?? "4", 10) || 4));
  return { difficulty, levels };
}

function parseChickenVariant(v: string): { difficulty: string; lanes: number } {
  const [a, b] = v.split(":");
  const difficulty = ["easy","medium","hard"].includes(a ?? "") ? (a ?? "medium") : "medium";
  const lanes = Math.max(1, Math.min(24, parseInt(b ?? "4", 10) || 4));
  return { difficulty, lanes };
}

// ─── Variant display ───────────────────────────────────────────────────────────
function resolveVariantDisplay(game: string, variant: string): string | null {
  switch (game) {
    case "mines": {
      const { mines, gems } = parseMinesVariant(variant);
      return `${mines} mines · cashout after ${gems} gem${gems !== 1 ? "s" : ""}`;
    }
    case "towers": {
      const { difficulty, levels } = parseTowersVariant(variant);
      return `${difficulty} · cashout after ${levels} level${levels !== 1 ? "s" : ""}`;
    }
    case "chickencrossing": {
      const { difficulty, lanes } = parseChickenVariant(variant);
      return `${difficulty} · cashout after ${lanes} lane${lanes !== 1 ? "s" : ""}`;
    }
    case "keno":     return variant || "easy";
    case "upgrader": return `${variant || "2"}×`;
    case "crash":    return `cashout at ${variant || "2"}×`;
    case "roulette": return variant || "red";
    default:         return null;
  }
}

// ─── Simulation runners ────────────────────────────────────────────────────────

function simCoinflip(): number {
  return Math.random() < 0.4625 ? 2 : 0;
}

function simRps(): number {
  const r = Math.random();
  if (r < 0.296) return 2;
  if (r < 0.629) return 1; // tie: return stake
  return 0;
}

function simWheel(): number {
  // Exact weights from wheel.ts — RTP 92.47%
  const SEGS = [
    { mult: 0,   w: 40 }, { mult: 0.5, w: 26 }, { mult: 1,  w: 8 },
    { mult: 1.5, w: 5  }, { mult: 2,   w: 3  }, { mult: 3,  w: 2 },
    { mult: 5,   w: 1  }, { mult: 10,  w: 1  }, { mult: 25, w: 1 },
  ];
  let r = Math.random() * 87;
  for (const s of SEGS) { r -= s.w; if (r <= 0) return s.mult; }
  return 0;
}

function simSlots(): number {
  return spinSlots().multiplier;
}

function simHilo(): number {
  const deck = buildHiloDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }

  const current = deck.shift()!;
  const higher = deck.filter((card) => card.rankValue > current.rankValue).length;
  const lower = deck.filter((card) => card.rankValue < current.rankValue).length;
  const direction = Math.random() < 0.5 ? "higher" : "lower";
  const favorable = direction === "higher" ? higher : lower;
  const next = deck[Math.floor(Math.random() * deck.length)]!;

  if (favorable === 0 || next.rankValue === current.rankValue) return 0;
  const correct = direction === "higher"
    ? next.rankValue > current.rankValue
    : next.rankValue < current.rankValue;
  return correct ? 0.9 / (favorable / deck.length) : 0;
}

function simScratchcard(): number {
  const WIN_POOL = [
    { mult: 0.5, w: 35 }, { mult: 1,  w: 30 }, { mult: 2,  w: 25 },
    { mult: 10,  w: 8  }, { mult: 50, w: 1  }, { mult: 100, w: 1 },
  ];
  if (Math.random() >= 0.269) return 0;
  let r = Math.random() * 100;
  for (const s of WIN_POOL) { r -= s.w; if (r <= 0) return s.mult; }
  return 0;
}

function simColordice(): number {
  // 6 dice, 8 colours, player picks one colour
  let hits = 0;
  for (let i = 0; i < 6; i++) if (Math.floor(Math.random() * 8) === 0) hits++;
  if (hits === 0) return 0;
  if (hits === 1) return 2;
  if (hits === 2) return 0.48;
  if (hits === 3) return 3;
  return 4; // 4+
}

function simFlip(): number {
  return Math.random() < 0.475 ? 1.9 : 0;
}

function simBlackjack(): number {
  const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  const deck: string[] = [];
  for (let s = 0; s < 8; s++) for (const r of RANKS) deck.push(r);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  let idx = 0;
  const deal = () => deck[idx++]!;

  function val(r: string): number {
    if (["J","Q","K"].includes(r)) return 10;
    if (r === "A") return 11;
    return parseInt(r, 10);
  }
  function hv(hand: string[]): number {
    let t = 0, a = 0;
    for (const r of hand) { t += val(r); if (r === "A") a++; }
    while (t > 21 && a > 0) { t -= 10; a--; }
    return t;
  }

  const player = [deal(), deal()];
  const dealer = [deal(), deal()];

  const pBJ = hv(player) === 21 && player.length === 2;
  const dBJ = hv(dealer) === 21 && dealer.length === 2;

  if (pBJ && dBJ) return 1;
  if (pBJ) return 2.5; // 3:2 payout
  if (dBJ) return 0;

  function dealerValue(rank: string): number {
    return rank === "A" ? 11 : val(rank);
  }

  function isSoft(hand: string[]): boolean {
    const hardTotal = hand.reduce((sum, rank) => sum + (rank === "A" ? 1 : val(rank)), 0);
    return hand.includes("A") && hardTotal + 10 <= 21;
  }

  function shouldSplit(hand: string[], dealerUp: number): boolean {
    if (hand.length !== 2 || hand[0] !== hand[1]) return false;
    const rank = hand[0]!;
    if (rank === "A" || rank === "8") return true;
    if (rank === "9") return [2, 3, 4, 5, 6, 8, 9].includes(dealerUp);
    if (rank === "7") return dealerUp >= 2 && dealerUp <= 7;
    if (rank === "6") return dealerUp >= 2 && dealerUp <= 6;
    if (rank === "4") return dealerUp === 5 || dealerUp === 6;
    if (rank === "2" || rank === "3") return dealerUp >= 2 && dealerUp <= 7;
    return false;
  }

  function shouldDouble(hand: string[], dealerUp: number): boolean {
    if (hand.length !== 2) return false;
    const total = hv(hand);
    if (isSoft(hand)) {
      if (total === 13 || total === 14) return dealerUp === 5 || dealerUp === 6;
      if (total === 15 || total === 16) return dealerUp >= 4 && dealerUp <= 6;
      if (total === 17) return dealerUp >= 3 && dealerUp <= 6;
      if (total === 18) return dealerUp >= 3 && dealerUp <= 6;
      return false;
    }
    if (total === 9) return dealerUp >= 3 && dealerUp <= 6;
    if (total === 10) return dealerUp >= 2 && dealerUp <= 9;
    if (total === 11) return dealerUp >= 2 && dealerUp <= 11;
    return false;
  }

  function shouldHit(hand: string[], dealerUp: number): boolean {
    const total = hv(hand);
    if (isSoft(hand)) {
      if (total <= 17) return true;
      if (total === 18) return dealerUp === 9 || dealerUp === 10 || dealerUp === 11;
      return false;
    }
    if (total <= 11) return true;
    if (total === 12) return dealerUp === 2 || dealerUp >= 7;
    if (total <= 16) return dealerUp >= 7;
    return false;
  }

  interface SimHand {
    cards: string[];
    stake: number;
    wasSplit: boolean;
  }

  const dealerUp = dealerValue(dealer[0]!);
  const hands: SimHand[] = [{ cards: player, stake: 1, wasSplit: false }];

  for (let handIndex = 0; handIndex < hands.length; handIndex++) {
    const hand = hands[handIndex]!;
    while (hv(hand.cards) <= 21) {
      if (
        hand.wasSplit &&
        hand.cards.length === 2 &&
        hand.cards[0] === "A"
      ) {
        break;
      }

      if (!hand.wasSplit && shouldSplit(hand.cards, dealerUp)) {
        const first = hand.cards[0]!;
        const second = hand.cards[1]!;
        hand.cards = [first, deal()];
        hand.wasSplit = true;
        hands.splice(handIndex + 1, 0, {
          cards: [second, deal()],
          stake: 1,
          wasSplit: true,
        });
        continue;
      }

      if (shouldDouble(hand.cards, dealerUp)) {
        hand.stake = 2;
        hand.cards.push(deal());
        break;
      }

      if (shouldHit(hand.cards, dealerUp)) {
        hand.cards.push(deal());
        continue;
      }

      break;
    }
  }

  while (hv(dealer) < 17) dealer.push(deal());
  const dv = hv(dealer);
  let payout = 0;

  for (const hand of hands) {
    const pv = hv(hand.cards);
    if (pv > 21) continue;
    if (dv > 21 || pv > dv) payout += hand.stake * 2;
    else if (pv === dv) payout += hand.stake;
  }

  return payout;
}

// mineCount = number of bombs, gemsTarget = how many safe tiles to reveal before cashing out
function simMines(mineCount: number, gemsTarget: number): number {
  // Probability of revealing gemsTarget safe tiles in a row without hitting a bomb.
  // Simulate tile-by-tile: each pick is from the remaining unrevealed tiles.
  let safe = 25 - mineCount; // safe tiles remaining
  let total = 25;             // tiles remaining on board
  for (let g = 0; g < gemsTarget; g++) {
    if (Math.random() * total >= safe) return 0; // hit a bomb
    safe--;
    total--;
  }
  // Survived — cashout multiplier after gemsTarget gems found
  return calcMinesMultiplier(mineCount, gemsTarget);
}

// difficulty = easy/medium/hard, levelsTarget = how many levels to survive before cashing out
function simTowers(difficulty: string, levelsTarget: number): number {
  const CFG: Record<string, { d: number; b: number; m: number }> = {
    easy:   { d: 2, b: 1, m: 1.39 },
    medium: { d: 1, b: 1, m: 1.85 },
    hard:   { d: 1, b: 2, m: 2.775 },
  };
  const cfg   = CFG[difficulty] ?? CFG["medium"]!;
  const tiles = cfg.d + cfg.b;
  let mult    = 1.0;
  for (let lvl = 0; lvl < levelsTarget; lvl++) {
    if (Math.floor(Math.random() * tiles) >= cfg.d) return 0; // bomb
    mult *= cfg.m;
  }
  return mult; // cashed out after levelsTarget levels
}

// difficulty = easy/medium/hard, lanesTarget = how many lanes to cross before cashing out
function simChicken(difficulty: string, lanesTarget: number): number {
  const HIT: Record<string, number> = { easy: 0.10, medium: 0.25, hard: 0.45 };
  const hit     = HIT[difficulty] ?? HIT["medium"]!;
  const survive = 1 - hit;
  for (let lane = 1; lane <= lanesTarget; lane++) {
    if (Math.random() < hit) return 0; // hit
  }
  // Cashed out after lanesTarget safe lanes
  return (1 / Math.pow(survive, lanesTarget)) * 0.925;
}

function simKeno(difficulty: string): number {
  const hard = difficulty === "hard";
  const POOL = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = POOL.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [POOL[i], POOL[j]] = [POOL[j]!, POOL[i]!];
  }
  const drawn = new Set(POOL.slice(0, 6));
  const picks: number[] = [];
  const avail = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = avail.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [avail[i], avail[j]] = [avail[j]!, avail[i]!];
  }
  for (let i = 0; i < 6; i++) picks.push(avail[i]!);
  const hits = picks.filter((n) => drawn.has(n)).length;

  if (hard) {
    const pay: Record<number, number> = { 3: 2, 4: 10, 5: 50, 6: 200 };
    return pay[hits] ?? 0;
  }
  const pay: Record<number, number> = { 2: 1.5, 3: 2, 4: 5, 5: 20, 6: 50 };
  return pay[hits] ?? 0;
}

function simUpgrader(mult: number): number {
  return Math.random() * 100 < (0.925 / mult) * 100 ? mult : 0;
}

function simCrash(cashout: number): number {
  const r = Math.random();
  if (r === 0) return cashout; // infinite crash point
  const crashPoint = 0.925 / r;
  return crashPoint >= cashout ? cashout : 0;
}

function simRoulette(betType: string): number {
  const pocket = Math.floor(Math.random() * 39); // 0-38 (0=green, 1=00, 2-37=1-36)
  const num    = pocket <= 1 ? 0 : pocket - 1;

  if (betType === "straight") return num === 7 ? 36 : 0;
  if (betType === "dozen")    return (num >= 1 && num <= 12) ? 3 : 0;
  // red (default)
  const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  return RED.has(num) ? 2 : 0;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────
function runSimulation(game: string, variant: string, n: number) {
  let totalOut = 0, wins = 0;

  for (let i = 0; i < n; i++) {
    let mult = 0;
    switch (game) {
      case "coinflip":        mult = simCoinflip(); break;
      case "rps":             mult = simRps(); break;
      case "wheel":           mult = simWheel(); break;
      case "slots":           mult = simSlots(); break;
      case "hilo":            mult = simHilo(); break;
      case "scratchcard":     mult = simScratchcard(); break;
      case "colordice":       mult = simColordice(); break;
      case "flip":            mult = simFlip(); break;
      case "blackjack":       mult = simBlackjack(); break;
      case "mines": {
        const { mines, gems } = parseMinesVariant(variant);
        mult = simMines(mines, gems);
        break;
      }
      case "towers": {
        const { difficulty, levels } = parseTowersVariant(variant);
        mult = simTowers(difficulty, levels);
        break;
      }
      case "chickencrossing": {
        const { difficulty, lanes } = parseChickenVariant(variant);
        mult = simChicken(difficulty, lanes);
        break;
      }
      case "keno":            mult = simKeno(variant || "easy"); break;
      case "upgrader":        mult = simUpgrader(Math.max(1.01, parseFloat(variant) || 2)); break;
      case "crash":           mult = simCrash(Math.max(1.01, parseFloat(variant) || 2)); break;
      case "roulette":        mult = simRoulette(variant || "red"); break;
    }
    totalOut += mult;
    if (mult > 0) wins++;
  }

  const avgPayout  = totalOut / n;
  const rtp        = avgPayout * 100;
  const houseEdge  = 100 - rtp;
  const winPct     = (wins / n) * 100;
  return { rtp, houseEdge, winPct, avgPayout, wins };
}
