import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type MessageActionRowComponentBuilder,
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

// ─── Types ────────────────────────────────────────────────────────────────────
const COLORS_LIST = ["red", "blue", "green", "orange", "yellow", "purple", "white", "brown"] as const;
type DiceColor = (typeof COLORS_LIST)[number];

const COLOR_EMOJI: Record<DiceColor, string> = {
  red:    "🟥",
  blue:   "🟦",
  green:  "🟩",
  orange: "🟧",
  yellow: "🟨",
  purple: "🟪",
  white:  "⬜",
  brown:  "🟫",
};

// Payout table (multiplier applied to bet)
// 0 matches → 0x, 1 match → 2x, 2 matches → 0.48x, 3 matches → 3x, 4+ matches → 4x
const PAYOUT_TABLE: [number, number][] = [
  [0, 0],
  [1, 2],
  [2, 0.48],
  [3, 3],
  [4, 4],
];

function getPayout(matches: number): number {
  if (matches >= 4) return 4;
  const entry = PAYOUT_TABLE.find(([m]) => m === matches);
  return entry ? entry[1] : 0;
}

// ─── Pending games (waiting for color selection) ───────────────────────────────
interface PendingColorDice {
  userId: string;
  bet: number;
}

export const pendingColorDice = new Map<string, PendingColorDice>();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rollDice(): DiceColor[] {
  return Array.from({ length: 6 }, () => COLORS_LIST[Math.floor(Math.random() * COLORS_LIST.length)]!);
}

function countMatches(dice: DiceColor[], pick: DiceColor): number {
  return dice.filter((d) => d === pick).length;
}

// ─── Rolling animation embed ──────────────────────────────────────────────────
const PROGRESS_BARS = [
  "▰▱▱▱▱▱▱▱▱▱",
  "▰▰▰▱▱▱▱▱▱▱",
  "▰▰▰▰▰▱▱▱▱▱",
  "▰▰▰▰▰▰▰▱▱▱",
  "▰▰▰▰▰▰▰▰▰▱",
  "▰▰▰▰▰▰▰▰▰▰",
];

function randomDiceRow(): string {
  return Array.from(
    { length: 6 },
    () => COLOR_EMOJI[COLORS_LIST[Math.floor(Math.random() * COLORS_LIST.length)]!],
  ).join("");
}

function rollingEmbed(bet: number, pick: DiceColor, frame: number): EmbedBuilder {
  const bar = PROGRESS_BARS[Math.min(frame, PROGRESS_BARS.length - 1)]!;
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🎲  Color Dice")
    .setDescription(
      [
        `💎 **Bet**  \`${formatAmount(bet)}\``,
        `${COLOR_EMOJI[pick]} **Your pick**  ${pick.charAt(0).toUpperCase() + pick.slice(1)}`,
        "",
        randomDiceRow(),
        "",
        "🕐 **Rolling the dice…**",
        bar,
      ].join("\n"),
    )
    .setTimestamp();
}

// ─── Embeds ───────────────────────────────────────────────────────────────────
function payoutEmbed(bet: number): EmbedBuilder {
  const payoutLines = PAYOUT_TABLE.map(([matches, mult]) => {
    const label = matches === 4 ? "4+" : String(matches);
    return `• **${label} match${matches !== 1 ? "es" : ""}**  →  \`${mult}x\``;
  }).join("\n");

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🎲  Color Dice")
    .setDescription(
      [
        `💎 **Bet**  \`${formatAmount(bet)}\``,
        "",
        "**Payout table**",
        payoutLines,
        "",
        "✨ *Six dice roll — stack matches on your color to climb the multiplier*",
      ].join("\n"),
    )
    .setTimestamp();
}

function resultEmbed(
  bet: number,
  pick: DiceColor,
  dice: DiceColor[],
  matches: number,
  mult: number,
  payout: number,
): EmbedBuilder {
  const isWin  = payout > 0;
  const color  = isWin ? (payout >= bet ? COLORS.success : COLORS.warning) : COLORS.danger;

  const diceRow  = dice.map((c) => COLOR_EMOJI[c]).join("");
  const pickRow  = COLOR_EMOJI[pick];
  const pickName = pick.charAt(0).toUpperCase() + pick.slice(1);

  return new EmbedBuilder()
    .setColor(color)
    .setTitle("🎲  Color Dice")
    .setDescription(
      [
        `💎 **Bet**  \`${formatAmount(bet)}\``,
        `✨ **Multiplier**  \`${mult}x  (${formatAmount(payout)})\``,
        "",
        `**Dice roll**  ${diceRow}`,
        `**Your pick**  ${pickRow} ${pickName}`,
        `**Matches**  ${matches}  (${mult}x)`,
      ].join("\n"),
    )
    .setTimestamp();
}

// ─── Select menu ──────────────────────────────────────────────────────────────
function buildColorSelect(userId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`cd_pick_${userId}`)
    .setPlaceholder("Choose your color…")
    .addOptions(
      COLORS_LIST.map((c) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(c.charAt(0).toUpperCase() + c.slice(1))
          .setValue(c)
          .setEmoji(COLOR_EMOJI[c]),
      ),
    );

  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu);
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("colordice")
  .setDescription("Roll six colored dice — match your color to multiply your bet!")
  .addStringOption((o) =>
    o.setName("bet").setDescription("Bet amount (e.g. 1m, 2.5b, 500k)").setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;

  if (pendingColorDice.has(userId)) {
    return void interaction.reply({
      embeds: [errorEmbed("You already have a Color Dice game waiting! Choose your color.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const betStr = interaction.options.getString("bet", true);
  const bet    = parseAmount(betStr);

  if (!bet || bet < 1) {
    return void interaction.reply({ embeds: [errorEmbed("Invalid bet amount.")], flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply();

  const user = await getOrCreateUser(userId, interaction.user.username);
  if (user.balance < bet) {
    return void interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
    });
  }

  await addBalance(userId, -bet);
  pendingColorDice.set(userId, { userId, bet });

  await interaction.editReply({
    embeds:     [payoutEmbed(bet)],
    components: [buildColorSelect(userId)],
  });
}

// ─── Select: color picked ─────────────────────────────────────────────────────
export async function handleColorPick(interaction: StringSelectMenuInteraction): Promise<void> {
  const userId  = interaction.user.id;
  const pending = pendingColorDice.get(userId);

  if (!pending) {
    return void interaction.reply({ embeds: [errorEmbed("No active Color Dice game.")], flags: MessageFlags.Ephemeral });
  }

  const pick = interaction.values[0] as DiceColor;
  pendingColorDice.delete(userId);

  // ── Step 1: show first rolling frame immediately ──
  await interaction.update({
    embeds:     [rollingEmbed(pending.bet, pick, 0)],
    components: [],
  });

  // ── Step 2: fire several frames with random dice each time ──
  const FRAME_MS = 350;
  for (let frame = 1; frame <= 5; frame++) {
    await new Promise<void>((resolve) => setTimeout(resolve, FRAME_MS));
    try {
      await interaction.editReply({ embeds: [rollingEmbed(pending.bet, pick, frame)] });
    } catch { /* skip if rate-limited */ }
  }

  // ── Step 3: brief pause before reveal ──
  await new Promise<void>((resolve) => setTimeout(resolve, 300));

  const dice    = rollDice();
  const matches = countMatches(dice, pick);
  const mult    = getPayout(matches);
  const payout  = Math.floor(pending.bet * mult);

  if (payout > 0) {
    await addBalance(userId, payout);
  }
  await recordBet(userId, pending.bet, payout - pending.bet);

  await interaction.editReply({
    embeds:     [resultEmbed(pending.bet, pick, dice, matches, mult, payout)],
    components: [],
  });
}
