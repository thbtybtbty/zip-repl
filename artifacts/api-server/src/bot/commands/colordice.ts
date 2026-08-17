import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";

import {
  createCanvas,
  type CanvasRenderingContext2D,
} from "@napi-rs/canvas";

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

const COLORS_LIST = [
  "red",
  "blue",
  "green",
  "orange",
  "yellow",
  "purple",
  "black",
] as const;

type DiceColor = (typeof COLORS_LIST)[number];

// ─── Dice colors ──────────────────────────────────────────────────────────────

const DICE_COLOR: Record<DiceColor, string> = {
  red: "#d93434",
  blue: "#3678d4",
  green: "#31965a",
  orange: "#df792d",
  yellow: "#d6a62e",
  purple: "#8152b8",
  black: "#171a1c",
};

const COLOR_EMOJI: Record<DiceColor, string> = {
  red: "🟥",
  blue: "🟦",
  green: "🟩",
  orange: "🟧",
  yellow: "🟨",
  purple: "🟪",
  black: "⬛",
};

// ─── Payout table ─────────────────────────────────────────────────────────────
// 0 matches → 0x
// 1 match  → 2x
// 2 matches → 0.48x
// 3 matches → 3x
// 4+ matches → 4x

const PAYOUT_TABLE: [number, number][] = [
  [0, 0],
  [1, 2],
  [2, 0.48],
  [3, 3],
  [4, 4],
];

function getPayout(matches: number): number {
  if (matches >= 4) return 4;

  const entry = PAYOUT_TABLE.find(
    ([m]) => m === matches,
  );

  return entry ? entry[1] : 0;
}

// ─── Pending games ────────────────────────────────────────────────────────────

interface PendingColorDice {
  userId: string;
  bet: number;
}

export const pendingColorDice =
  new Map<string, PendingColorDice>();

// ─── Game helpers ─────────────────────────────────────────────────────────────

function rollDice(): DiceColor[] {
  return Array.from(
    { length: 6 },
    () =>
      COLORS_LIST[
        Math.floor(
          Math.random() * COLORS_LIST.length,
        )
      ]!,
  );
}

function countMatches(
  dice: DiceColor[],
  pick: DiceColor,
): number {
  return dice.filter(
    (d) => d === pick,
  ).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 700;

// Casino-style colors
const FELT_TOP = "#063b2d";
const FELT_BOTTOM = "#042e24";
const FELT_LIGHT = "#0b4937";

const GOLD = "#caa62c";
const GOLD_DARK = "#8e711b";

const WHITE = "#f4f2e8";
const TEXT = "#f4f3ec";
const MUTED = "#b9c9c1";

const PANEL = "rgba(3, 24, 18, 0.45)";
const PANEL_BORDER = "rgba(202, 166, 44, 0.32)";

const DICE_SHADOW = "rgba(0, 0, 0, 0.38)";
const PIP = "#f8f8f2";

// Fixed dice positions.
// These NEVER change between animation frames.
const DICE_POSITIONS = [
  { x: 160, y: 360 },
  { x: 336, y: 360 },
  { x: 512, y: 360 },
  { x: 688, y: 360 },
  { x: 864, y: 360 },
  { x: 1040, y: 360 },
];

const DIE_SIZE = 120;
const DICE_FACE_VALUES = [1, 2, 3, 4, 5, 6] as const;
type DiceFace = (typeof DICE_FACE_VALUES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// DRAWING HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(
    x,
    y,
    width,
    height,
    radius,
  );
}

// ─── Background ───────────────────────────────────────────────────────────────

function drawCasinoBackground(
  ctx: CanvasRenderingContext2D,
): void {
  const gradient =
    ctx.createLinearGradient(
      0,
      0,
      0,
      IMAGE_HEIGHT,
    );

  gradient.addColorStop(
    0,
    FELT_TOP,
  );

  gradient.addColorStop(
    1,
    FELT_BOTTOM,
  );

  ctx.fillStyle = gradient;

  ctx.fillRect(
    0,
    0,
    IMAGE_WIDTH,
    IMAGE_HEIGHT,
  );

  // Very subtle felt texture.
  ctx.save();

  for (
    let y = 0;
    y < IMAGE_HEIGHT;
    y += 8
  ) {
    ctx.globalAlpha =
      y % 16 === 0
        ? 0.018
        : 0.010;

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(
      IMAGE_WIDTH,
      y,
    );
    ctx.stroke();
  }

  ctx.restore();

  // Outer casino border.
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 5;

  roundedRect(
    ctx,
    24,
    24,
    IMAGE_WIDTH - 48,
    IMAGE_HEIGHT - 48,
    30,
  );

  ctx.stroke();

  // Inner subtle border.
  ctx.strokeStyle =
    "rgba(202,166,44,0.18)";

  ctx.lineWidth = 1;

  roundedRect(
    ctx,
    34,
    34,
    IMAGE_WIDTH - 68,
    IMAGE_HEIGHT - 68,
    23,
  );

  ctx.stroke();
}

// ─── Top title ───────────────────────────────────────────────────────────────

function drawHeader(
  ctx: CanvasRenderingContext2D,
  bet: number,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = TEXT;
  ctx.font =
    "900 38px Arial";

  ctx.fillText(
    "COLOR DICE",
    IMAGE_WIDTH / 2,
    67,
  );

  // Bet badge.
  const betText =
    `Bet: ${formatAmount(bet)}`;

  ctx.font =
    "800 22px Arial";

  const textWidth =
    ctx.measureText(
      betText,
    ).width;

  const badgeWidth =
    textWidth + 38;

  const badgeX =
    IMAGE_WIDTH / 2 -
    badgeWidth / 2;

  const badgeY = 91;

  ctx.fillStyle =
    "rgba(2, 27, 21, 0.9)";

  roundedRect(
    ctx,
    badgeX,
    badgeY,
    badgeWidth,
    42,
    12,
  );

  ctx.fill();

  ctx.strokeStyle =
    "rgba(202,166,44,0.35)";

  ctx.lineWidth = 1;

  roundedRect(
    ctx,
    badgeX,
    badgeY,
    badgeWidth,
    42,
    12,
  );

  ctx.stroke();

  ctx.fillStyle = TEXT;

  ctx.fillText(
    betText,
    IMAGE_WIDTH / 2,
    badgeY + 21,
  );
}

// ─── Dice table area ──────────────────────────────────────────────────────────

function drawDiceArea(
  ctx: CanvasRenderingContext2D,
): void {
  ctx.fillStyle = PANEL;

  roundedRect(
    ctx,
    60,
    165,
    IMAGE_WIDTH - 120,
    300,
    22,
  );

  ctx.fill();

  ctx.strokeStyle =
    PANEL_BORDER;

  ctx.lineWidth = 2;

  roundedRect(
    ctx,
    60,
    165,
    IMAGE_WIDTH - 120,
    300,
    22,
  );

  ctx.stroke();

  // Small label.
  ctx.fillStyle = MUTED;
  ctx.font =
    "700 16px Arial";

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  ctx.fillText(
    "DICE",
    85,
    192,
  );
}

// ─── One die ──────────────────────────────────────────────────────────────────

function drawDie(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: DiceColor,
  face: DiceFace,
  rotation = 0,
  offsetY = 0,
  scale = 1,
  isLocked = false,
): void {
  ctx.save();

  ctx.translate(
    x,
    y + offsetY,
  );
  ctx.rotate(rotation);
  ctx.scale(scale, scale);

  const half =
    DIE_SIZE / 2;

  const left =
    -half;

  const top =
    -half;

  // Shadow.
  ctx.save();

  ctx.globalAlpha = 0.45;
  ctx.fillStyle = DICE_SHADOW;

  roundedRect(
    ctx,
    left + 5,
    top + 8,
    DIE_SIZE,
    DIE_SIZE,
    18,
  );

  ctx.fill();

  ctx.restore();

  // Die body.
  ctx.fillStyle =
    DICE_COLOR[color];

  roundedRect(
    ctx,
    left,
    top,
    DIE_SIZE,
    DIE_SIZE,
    18,
  );

  ctx.fill();

  // Dark edge.
  ctx.strokeStyle =
    color === "black"
      ? "#303437"
      : "rgba(0,0,0,0.35)";

  ctx.lineWidth = 4;

  roundedRect(
    ctx,
    left,
    top,
    DIE_SIZE,
    DIE_SIZE,
    18,
  );

  ctx.stroke();

  // Very subtle top highlight.
  ctx.save();

  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#ffffff";

  roundedRect(
    ctx,
    left + 7,
    top + 6,
    DIE_SIZE - 14,
    25,
    10,
  );

  ctx.fill();

  ctx.restore();

  // Locked dice get a small gold halo so the result reveal feels staged.
  if (isLocked) {
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    roundedRect(
      ctx,
      left + 2,
      top + 2,
      DIE_SIZE - 4,
      DIE_SIZE - 4,
      17,
    );
    ctx.stroke();
    ctx.restore();
  }

  const pipPositions: Record<
    DiceFace,
    [number, number][]
  > = {
    1: [[0, 0]],
    2: [[-23, -23], [23, 23]],
    3: [[-23, -23], [0, 0], [23, 23]],
    4: [
      [-23, -23],
      [23, -23],
      [-23, 23],
      [23, 23],
    ],
    5: [
      [-23, -23],
      [23, -23],
      [0, 0],
      [-23, 23],
      [23, 23],
    ],
    6: [
      [-23, -23],
      [-23, 0],
      [-23, 23],
      [23, -23],
      [23, 0],
      [23, 23],
    ],
  };

  for (const [pipX, pipY] of pipPositions[face]) {
    ctx.save();

    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(
      pipX + 2,
      pipY + 3,
      13,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = PIP;
    ctx.beginPath();
    ctx.arc(
      pipX,
      pipY,
      14,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.restore();
  }

  ctx.restore();
}

// ─── Draw six dice ────────────────────────────────────────────────────────────

function drawDice(
  ctx: CanvasRenderingContext2D,
  dice: DiceColor[],
  faces: DiceFace[],
  animationFrame: number,
  showResult: boolean,
): void {
  const lockedCount = showResult
    ? dice.length
    : Math.min(
        dice.length,
        Math.max(
          0,
          animationFrame - 3,
        ),
      );

  for (
    let i = 0;
    i < 6;
    i++
  ) {
    const position =
      DICE_POSITIONS[i]!;

    const isLocked =
      i < lockedCount;
    const motion =
      isLocked
        ? 0
        : animationFrame * 0.82 +
          i * 1.15;

    drawDie(
      ctx,
      position.x,
      position.y,
      dice[i]!,
      faces[i] ?? 1,
      isLocked
        ? 0
        : Math.sin(motion) * 0.075,
      isLocked
        ? 0
        : Math.sin(motion * 1.45) * 10,
      isLocked
        ? 1
        : 1 + Math.sin(motion * 0.9) * 0.035,
      isLocked,
    );
  }
}

// ─── Bottom information ───────────────────────────────────────────────────────

function drawBottomInfo(
  ctx: CanvasRenderingContext2D,
  pick: DiceColor,
  showResult: boolean,
  matches: number,
  mult: number,
  payout: number,
  animationFrame = 0,
): void {
  const pickName =
    pick.charAt(0).toUpperCase() +
    pick.slice(1);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (!showResult) {
    ctx.fillStyle = TEXT;
    ctx.font =
      "800 22px Arial";

    ctx.fillText(
      `Your pick: ${pickName}`,
      IMAGE_WIDTH / 2,
      525,
    );

    const lockedCount =
      Math.min(
        6,
        Math.max(
          0,
          animationFrame - 3,
        ),
      );

    ctx.fillStyle = MUTED;
    ctx.font =
      "600 16px Arial";

    ctx.fillText(
      lockedCount === 0
        ? "Rolling six dice…"
        : `${lockedCount}/6 dice locked • Watching for ${pickName}`,
      IMAGE_WIDTH / 2,
      555,
    );

    return;
  }

  const resultColor =
    payout > 0
      ? payout >= 1
        ? "#55d887"
        : "#e0b94a"
      : "#df4c4c";

  const resultText =
    payout > 0
      ? payout >= 1
        ? "WIN"
        : "PARTIAL RETURN"
      : "NO MATCH";

  ctx.fillStyle =
    resultColor;

  ctx.font =
    "900 30px Arial";

  ctx.fillText(
    resultText,
    IMAGE_WIDTH / 2,
    515,
  );

  ctx.fillStyle = TEXT;

  ctx.font =
    "700 19px Arial";

  ctx.fillText(
    `Your pick: ${pickName}   •   Matches: ${matches}`,
    IMAGE_WIDTH / 2,
    550,
  );

  ctx.fillStyle = MUTED;

  ctx.font =
    "600 17px Arial";

  ctx.fillText(
    `${mult}x   •   Payout: ${formatAmount(payout)}`,
    IMAGE_WIDTH / 2,
    580,
  );
}

// ─── Main image ───────────────────────────────────────────────────────────────

function colorDiceImage(
  bet: number,
  pick: DiceColor,
  dice: DiceColor[],
  showResult: boolean,
  matches: number,
  mult: number,
  payout: number,
  faces: DiceFace[],
  animationFrame: number,
): Buffer {
  const canvas =
    createCanvas(
      IMAGE_WIDTH,
      IMAGE_HEIGHT,
    );

  const ctx =
    canvas.getContext("2d");

  drawCasinoBackground(ctx);

  drawHeader(
    ctx,
    bet,
  );

  drawDiceArea(ctx);

  drawDice(
    ctx,
    dice,
    faces,
    animationFrame,
    showResult,
  );

  drawBottomInfo(
    ctx,
    pick,
    showResult,
    matches,
    mult,
    payout,
    animationFrame,
  );

  return canvas.toBuffer(
    "image/png",
  );
}

// ─── Attachment ───────────────────────────────────────────────────────────────

function imageFile(
  bet: number,
  pick: DiceColor,
  dice: DiceColor[],
  showResult: boolean,
  matches = 0,
  mult = 0,
  payout = 0,
  faces: DiceFace[] = randomFaceRow(),
  animationFrame = 0,
): AttachmentBuilder {
  return new AttachmentBuilder(
    colorDiceImage(
      bet,
      pick,
      dice,
      showResult,
      matches,
      mult,
      payout,
      faces,
      animationFrame,
    ),
    {
      name:
        "color-dice.png",
    },
  );
}

// ─── Rolling animation ────────────────────────────────────────────────────────

function randomDiceRow(): DiceColor[] {
  return rollDice();
}

function randomFaceRow(): DiceFace[] {
  return Array.from(
    { length: 6 },
    () =>
      DICE_FACE_VALUES[
        Math.floor(
          Math.random() *
            DICE_FACE_VALUES.length,
        )
      ]!,
  );
}

function rollingEmbed(
  bet: number,
  pick: DiceColor,
): EmbedBuilder {
  const pickName =
    pick.charAt(0).toUpperCase() +
    pick.slice(1);

  return new EmbedBuilder()
    .setColor(
      COLORS.primary,
    )
    .setTitle(
      "🎲  Color Dice",
    )
    .setDescription(
      [
        `💎 **Bet**  \`${formatAmount(bet)}\``,
        `${COLOR_EMOJI[pick]} **Your pick**  ${pickName}`,
        "",
        "🎲 **Rolling…**",
      ].join("\n"),
    )
    .setTimestamp();
}

// ─── Payout panel ─────────────────────────────────────────────────────────────

function payoutEmbed(
  bet: number,
): EmbedBuilder {
  const payoutLines =
    PAYOUT_TABLE.map(
      ([matches, mult]) => {
        const label =
          matches === 4
            ? "4+"
            : String(matches);

        return `• **${label} match${matches !== 1 ? "es" : ""}** → \`${mult}x\``;
      },
    ).join("\n");

  return new EmbedBuilder()
    .setColor(
      COLORS.primary,
    )
    .setTitle(
      "🎲  Color Dice",
    )
    .setDescription(
      [
        `💎 **Bet**  \`${formatAmount(bet)}\``,
        "",
        "**Payout table**",
        payoutLines,
        "",
        "✨ *Choose a color to roll six dice.*",
      ].join("\n"),
    )
    .setTimestamp();
}

// ─── Result embed ─────────────────────────────────────────────────────────────

function resultEmbed(
  bet: number,
  pick: DiceColor,
  matches: number,
  mult: number,
  payout: number,
): EmbedBuilder {
  const isWin =
    payout > 0;

  const color =
    isWin
      ? payout >= bet
        ? COLORS.success
        : COLORS.warning
      : COLORS.danger;

  const pickName =
    pick.charAt(0).toUpperCase() +
    pick.slice(1);

  const resultTitle =
    payout > 0
      ? payout >= bet
        ? "🎉  You Won!"
        : "💰  Partial Return"
      : "❌  No Match";

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(
      resultTitle,
    )
    .setDescription(
      [
        `💎 **Bet**  \`${formatAmount(bet)}\``,
        `${COLOR_EMOJI[pick]} **Your pick**  ${pickName}`,
        "",
        `🎯 **Matches**  \`${matches}\``,
        `📈 **Multiplier**  \`${mult}x\``,
        `💰 **Payout**  \`${formatAmount(payout)}\``,
      ].join("\n"),
    )
    .setTimestamp();
}

// ─── Select menu ──────────────────────────────────────────────────────────────

function buildColorSelect(
  userId: string,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const menu =
    new StringSelectMenuBuilder()
      .setCustomId(
        `cd_pick_${userId}`,
      )
      .setPlaceholder(
        "Choose your color…",
      )
      .addOptions(
        COLORS_LIST.map(
          (c) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(
                c.charAt(0).toUpperCase() +
                  c.slice(1),
              )
              .setValue(c)
              .setEmoji(
                COLOR_EMOJI[c],
              ),
        ),
      );

  return new ActionRowBuilder<MessageActionRowComponentBuilder>()
    .addComponents(
      menu,
    );
}

// ─── Command ──────────────────────────────────────────────────────────────────

export const data =
  new SlashCommandBuilder()
    .setName("colordice")
    .setDescription(
      "Six dice roll",
    )
    .addStringOption(
      (o) =>
        o
          .setName("bet")
          .setDescription(
            "Bet amount (e.g. 1m, 2.5b, 500k)",
          )
          .setRequired(true),
    );

// ─── Execute ─────────────────────────────────────────────────────────────────

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const userId =
    interaction.user.id;

  if (
    pendingColorDice.has(
      userId,
    )
  ) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "You already have a Color Dice game waiting! Choose your color.",
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });
  }

  const betStr =
    interaction.options.getString(
      "bet",
      true,
    );

  const bet =
    parseAmount(betStr);

  if (
    !bet ||
    bet < 1_000_000
  ) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "Minimum bet is **1m gems**.",
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  const user =
    await getOrCreateUser(
      userId,
      interaction.user.username,
    );

  if (
    user.balance < bet
  ) {
    return void interaction.editReply({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`,
        ),
      ],
    });
  }

  await addBalance(
    userId,
    -bet,
  );

  pendingColorDice.set(
    userId,
    {
      userId,
      bet,
    },
  );

  await interaction.editReply({
    embeds: [
      payoutEmbed(bet),
    ],
    components: [
      buildColorSelect(userId),
    ],
  });
}

// ─── Select: color picked ─────────────────────────────────────────────────────

export async function handleColorPick(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const userId =
    interaction.user.id;

  const pending =
    pendingColorDice.get(
      userId,
    );

  if (!pending) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "No active Color Dice game.",
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });
  }

  const pick =
    interaction.values[0] as DiceColor;

  if (
    !COLORS_LIST.includes(
      pick,
    )
  ) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "Invalid color.",
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });
  }

  pendingColorDice.delete(
    userId,
  );

  // Pre-roll the actual result.
  // The animation changes colors only.
  // Dice positions never move.
  const dice =
    rollDice();

  const matches =
    countMatches(
      dice,
      pick,
    );

  const mult =
    getPayout(matches);

  const payout =
    Math.floor(
      pending.bet * mult,
    );
  const finalFaces =
    randomFaceRow();

  // ─────────────────────────────────────────────────────────────────────────
  // FIRST UPDATE
  // Keep the normal Discord panel while the image animation starts.
  // ─────────────────────────────────────────────────────────────────────────

  await interaction.update({
    embeds: [
      rollingEmbed(
        pending.bet,
        pick,
      ),
    ],
    files: [
      imageFile(
        pending.bet,
        pick,
        randomDiceRow(),
        false,
          0,
          0,
          0,
          randomFaceRow(),
          0,
      ),
    ],
    components: [],
  });

  // ─────────────────────────────────────────────────────────────────────────
  // FAST COLOR ANIMATION
  // ─────────────────────────────────────────────────────────────────────────

  const FRAME_MS = 220;

  for (
    let frame = 0;
    frame < 10;
    frame++
  ) {
    await new Promise<void>(
      (resolve) =>
        setTimeout(
          resolve,
          FRAME_MS,
        ),
    );

    const lockedCount =
      Math.min(
        dice.length,
        Math.max(
          0,
          frame + 1 - 3,
        ),
      );
    const animatedDice =
      randomDiceRow().map(
        (color, index) =>
          index < lockedCount
            ? dice[index]!
            : color,
      );
    const animatedFaces =
      randomFaceRow().map(
        (face, index) =>
          index < lockedCount
            ? finalFaces[index]!
            : face,
      );

    try {
      await interaction.editReply({
        embeds: [
          rollingEmbed(
            pending.bet,
            pick,
          ),
        ],
        files: [
          imageFile(
            pending.bet,
            pick,
            animatedDice,
            false,
            0,
            0,
            0,
            animatedFaces,
            frame + 1,
          ),
        ],
      });
    } catch {
      // Ignore an occasional Discord edit/rate-limit failure.
    }
  }

  // Small pause before revealing the actual result.
  await new Promise<void>(
    (resolve) =>
      setTimeout(
        resolve,
        260,
      ),
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PAYOUT
  // ─────────────────────────────────────────────────────────────────────────

  if (payout > 0) {
    await addBalance(
      userId,
      payout,
    );
  }

  await recordBet(
    userId,
    pending.bet,
    payout - pending.bet,
    "colordice",
  );

  // ─────────────────────────────────────────────────────────────────────────
  // FINAL RESULT IMAGE
  // ─────────────────────────────────────────────────────────────────────────

  await interaction.editReply({
    embeds: [
      resultEmbed(
        pending.bet,
        pick,
        matches,
        mult,
        payout,
      ),
    ],
    files: [
      imageFile(
        pending.bet,
        pick,
        dice,
        true,
        matches,
        mult,
        payout,
          finalFaces,
          99,
      ),
    ],
    components: [],
  });
}