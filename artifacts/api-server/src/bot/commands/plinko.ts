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

// ─── Board config ─────────────────────────────────────────────────────────────
const ROWS = 8; // 8 pegs → 9 slots (indices 0–8)

type Risk = "low" | "medium" | "high";

const MULTIPLIERS: Record<Risk, number[]> = {
  low:    [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6],
  medium: [13,  3,   1.3, 0.7, 0.4, 0.7, 1.3, 3,   13  ],
  high:   [29,  4,   1.5, 0.3, 0.2, 0.3, 1.5, 4,   29  ],
};

// Emoji per multiplier bracket
function multEmoji(m: number): string {
  if (m >= 10)  return "💎";
  if (m >= 3)   return "🟣";
  if (m >= 1.5) return "🟢";
  if (m >= 1)   return "🟡";
  return "🔴";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Drop simulation ──────────────────────────────────────────────────────────
function drop(): { moves: ("L" | "R")[]; slot: number } {
  const moves = Array.from(
    { length: ROWS },
    () => (Math.random() < 0.5 ? "L" : "R"),
  ) as ("L" | "R")[];
  const slot = moves.filter((m) => m === "R").length;
  return { moves, slot };
}

// ─── Visual builders ──────────────────────────────────────────────────────────

// Animated path string: reveals moves one by one
function pathLine(moves: ("L" | "R")[], reveal: number): string {
  const shown = moves.slice(0, reveal);
  const rest  = moves.length - reveal;
  const trail = shown.map((m) => (m === "R" ? "▶" : "◀")).join(" ");
  return trail + (rest > 0 ? " …" : "");
}

// Bottom multiplier row with winning slot highlighted
function boardLine(mults: number[], winSlot: number, revealed: boolean): string {
  return mults
    .map((m, i) => {
      const em  = multEmoji(m);
      const lbl = `${m}×`;
      if (!revealed) return `${em} ${lbl}`;
      return i === winSlot ? `**▶ ${em} ${lbl} ◀**` : `${em} ${lbl}`;
    })
    .join("  ");
}

// ─── Embed helpers ─────────────────────────────────────────────────────────────
function droppingEmbed(
  risk: Risk,
  bet: number,
  moves: ("L" | "R")[],
  reveal: number,
): EmbedBuilder {
  const mults = MULTIPLIERS[risk];
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🎯  Plinko — Dropping…")
    .setDescription(
      `**Path:** ${pathLine(moves, reveal)}\n\n` +
      `${boardLine(mults, -1, false)}`,
    )
    .addFields(
      { name: "💰 Bet",  value: `${formatAmount(bet)} gems`, inline: true },
      { name: "⚠️ Risk", value: risk.charAt(0).toUpperCase() + risk.slice(1), inline: true },
    )
    .setTimestamp();
}

function resultEmbed(
  risk: Risk,
  bet: number,
  moves: ("L" | "R")[],
  slot: number,
): EmbedBuilder {
  const mults  = MULTIPLIERS[risk];
  const mult   = mults[slot]!;
  const payout = Math.floor(bet * mult);
  const net    = payout - bet;
  const won    = net > 0;
  const even   = net === 0;

  const color =
    mult >= 10 ? COLORS.gold :
    mult >= 3  ? 0x9b59b6   :
    won        ? COLORS.success :
    even       ? COLORS.warning :
                 COLORS.danger;

  const title =
    mult >= 10 ? "🎯  Plinko — JACKPOT! 💎" :
    mult >= 3  ? "🎯  Plinko — Big Win! 🎉" :
    won        ? "🎯  Plinko — Win!" :
    even       ? "🎯  Plinko — Break Even" :
                 "🎯  Plinko — Loss";

  const footer =
    mult >= 10 ? "INSANE drop! 🔥" :
    mult >= 3  ? "Great landing!" :
    won        ? "Nice drop!" :
    even       ? "Nothing lost, nothing gained." :
                 "Better luck next drop.";

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(
      `**Path:** ${pathLine(moves, ROWS)}\n\n` +
      `${boardLine(mults, slot, true)}`,
    )
    .addFields(
      { name: "💰 Bet",        value: `${formatAmount(bet)} gems`,    inline: true },
      { name: "🎯 Multiplier", value: `${mult}×`,                     inline: true },
      { name: "⚠️ Risk",       value: risk.charAt(0).toUpperCase() + risk.slice(1), inline: true },
      { name: "💵 Return",     value: `${formatAmount(payout)} gems`,  inline: true },
      {
        name:  net >= 0 ? "📈 Profit" : "📉 Loss",
        value: `${net >= 0 ? "+" : ""}${formatAmount(net)} gems`,
        inline: true,
      },
    )
    .setFooter({ text: footer })
    .setTimestamp();
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("plinko")
  .setDescription("Drop a ball through the peg board and land on a multiplier!")
  .addStringOption((opt) =>
    opt.setName("amount").setDescription("Bet amount (e.g. 1m, 2.5b)").setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("risk")
      .setDescription("Risk level — higher risk means bigger highs and bigger lows")
      .setRequired(true)
      .addChoices(
        { name: "🟢 Low    — safe multipliers (max 5.6×)",  value: "low"    },
        { name: "🟡 Medium — balanced (max 13×)",           value: "medium" },
        { name: "🔴 High   — volatile, jackpot up to 29×",  value: "high"   },
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const amountStr = interaction.options.getString("amount", true);
  const risk      = interaction.options.getString("risk", true) as Risk;
  const amount    = parseAmount(amountStr);

  if (!amount || amount <= 0)
    return interaction.editReply({ embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")] });

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount)
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} gems**.`)],
    });

  await addBalance(interaction.user.id, -amount);

  const { moves, slot } = drop();
  const mult   = MULTIPLIERS[risk][slot]!;
  const payout = Math.floor(amount * mult);

  // ── Animation: reveal path move by move ────────────────────────────────────
  const FRAMES    = ROWS;      // one frame per row
  const FRAME_MS  = 400;

  for (let f = 1; f <= FRAMES; f++) {
    await interaction.editReply({ embeds: [droppingEmbed(risk, amount, moves, f)] });
    await sleep(FRAME_MS);
  }

  // ── Settle ─────────────────────────────────────────────────────────────────
  if (payout > 0) await addBalance(interaction.user.id, payout);

  await interaction.editReply({ embeds: [resultEmbed(risk, amount, moves, slot)] });
}
