import {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  MessageFlags,
  type Message,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from "discord.js";

import {
  createCanvas,
  type CanvasRenderingContext2D,
} from "@napi-rs/canvas";

import {
  COLORS,
  parseAmount,
  formatAmount,
  formatMult,
  getOrCreateUser,
  addBalance,
  recordBet,
  errorEmbed,
} from "../utils.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type Difficulty = "easy" | "medium" | "hard";
type GameStatus = "active" | "cashed" | "dead";

export interface ChickenGame {
  userId: string;
  bet: number;
  difficulty: Difficulty;
  lanesCrossed: number;
  multiplier: number;
  messageId: string;
  channelId: string;
}

export const activeChickenGames = new Map<string, ChickenGame>();

// ─── Config ──────────────────────────────────────────────────────────────────

const TOTAL_LANES = 24;
const RTP = 0.925;

const HIT_CHANCE: Record<Difficulty, number> = {
  easy: 0.10,
  medium: 0.25,
  hard: 0.45,
};

const DIFF_EMOJI: Record<Difficulty, string> = {
  easy: "🍀",
  medium: "⚠️",
  hard: "💀",
};

// ─── Math ─────────────────────────────────────────────────────────────────────

function calcMultiplier(
  difficulty: Difficulty,
  lanesCrossed: number,
): number {
  if (lanesCrossed === 0) return 1.0;

  const survive = 1 - HIT_CHANCE[difficulty];

  return (
    (1 / Math.pow(survive, lanesCrossed)) *
    RTP
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE
// ─────────────────────────────────────────────────────────────────────────────

const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 760;

const ROAD_TOP = 0;
const ROAD_BOTTOM = IMAGE_HEIGHT;

const SIDEWALK_WIDTH = 175;
const ROAD_LEFT = SIDEWALK_WIDTH;
const ROAD_WIDTH = IMAGE_WIDTH - ROAD_LEFT;

const LANE_WIDTH = ROAD_WIDTH / 5;

const TARGET_Y = 335;
const DRAIN_Y = 650;

const BG = "#41496f";
const BG_DARK = "#343b5e";
const ROAD_ALT = "#444c72";

const LANE_LINE = "#b5c0e3";

const MULTIPLIER_FILL = "#626da1";
const MULTIPLIER_INNER = "#596598";
const MULTIPLIER_RING = "#747fc0";
const MULTIPLIER_DARK_RING = "#30385b";

const OBSTACLE = "#303758";
const OBSTACLE_HIGHLIGHT = "#363e61";

const DRAIN_DARK = "#202744";
const DRAIN_MID = "#293150";
const DRAIN_EDGE = "#5b668f";

const CHICKEN_WHITE = "#f8f8ed";
const CHICKEN_SHADOW = "#d9ddd5";
const CHICKEN_OUTLINE = "#20243b";
const CHICKEN_RED = "#e92f35";
const CHICKEN_RED_DARK = "#b91f2a";
const CHICKEN_YELLOW = "#f5a928";
const CHICKEN_BEAK = "#f6ae28";
const CHICKEN_EYE = "#22243a";

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

// ─── Car behind hit chicken ───────────────────────────────────────────────────

function drawHitCar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale = 1,
): void {
  ctx.save();

  ctx.globalAlpha = 0.8;

  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 2);
  ctx.scale(scale, scale);

  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#171b31";

  ctx.beginPath();
  ctx.ellipse(
    0,
    67,
    125,
    18,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.restore();

  ctx.fillStyle = "#262d4d";
  ctx.strokeStyle = "#171c32";
  ctx.lineWidth = 6;

  ctx.beginPath();
  ctx.moveTo(-115, 32);
  ctx.lineTo(-98, -13);
  ctx.quadraticCurveTo(-86, -47, -52, -57);
  ctx.lineTo(48, -57);
  ctx.quadraticCurveTo(82, -48, 98, -14);
  ctx.lineTo(116, 32);
  ctx.lineTo(116, 51);
  ctx.quadraticCurveTo(116, 62, 104, 62);
  ctx.lineTo(-104, 62);
  ctx.quadraticCurveTo(-116, 62, -116, 51);
  ctx.closePath();

  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#3d466b";
  ctx.strokeStyle = "#171c32";
  ctx.lineWidth = 5;

  ctx.beginPath();
  ctx.moveTo(-66, -49);
  ctx.lineTo(-42, -80);
  ctx.quadraticCurveTo(-35, -90, -20, -91);
  ctx.lineTo(27, -91);
  ctx.quadraticCurveTo(42, -90, 50, -79);
  ctx.lineTo(69, -49);
  ctx.closePath();

  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#202742";
  ctx.strokeStyle = "#566184";
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.moveTo(-37, -76);
  ctx.lineTo(-20, -82);
  ctx.lineTo(20, -82);
  ctx.lineTo(39, -76);
  ctx.lineTo(49, -55);
  ctx.lineTo(-47, -55);
  ctx.closePath();

  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;

  ctx.beginPath();
  ctx.moveTo(-28, -78);
  ctx.lineTo(-12, -57);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(7, -81);
  ctx.lineTo(24, -57);
  ctx.stroke();

  ctx.restore();

  ctx.fillStyle = "#343c5d";

  roundedRect(ctx, -84, -5, 168, 48, 10);
  ctx.fill();

  ctx.fillStyle = "#1d233d";

  roundedRect(ctx, -112, 37, 224, 25, 9);
  ctx.fill();

  ctx.fillStyle = "#e9343e";
  ctx.strokeStyle = "#7e202c";
  ctx.lineWidth = 3;

  roundedRect(ctx, -103, 4, 35, 18, 6);
  ctx.fill();
  ctx.stroke();

  roundedRect(ctx, 68, 4, 35, 18, 6);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = "#ff4149";

  ctx.beginPath();
  ctx.arc(-86, 13, 26, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(86, 13, 26, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  ctx.fillStyle = "#e4e7dc";
  ctx.strokeStyle = "#171c32";
  ctx.lineWidth = 3;

  roundedRect(ctx, -38, 20, 76, 24, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#303758";
  ctx.font = "900 11px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillText("HIT", 0, 32);

  ctx.fillStyle = "#11162a";
  ctx.strokeStyle = "#080c18";
  ctx.lineWidth = 4;

  ctx.beginPath();
  ctx.ellipse(-82, 53, 22, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(82, 53, 22, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#3c4566";
  ctx.strokeStyle = "#1a2038";
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.arc(-82, 53, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(82, 53, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

// ─── Chicken ─────────────────────────────────────────────────────────────────

function drawChicken(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale = 1,
  hit = false,
): void {
  ctx.save();

  ctx.translate(x, y);
  ctx.scale(scale, scale);

  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#171b31";

  ctx.beginPath();
  ctx.ellipse(0, 45, 57, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  if (hit) {
    ctx.save();
    ctx.strokeStyle = "#ffd34e";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";

    const rays = [
      [-65, -65, -88, -91],
      [-75, 0, -108, 0],
      [-58, 55, -84, 78],
      [62, -60, 87, -86],
      [72, 5, 108, 5],
      [54, 58, 82, 84],
    ];

    for (const [x1, y1, x2, y2] of rays) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    ctx.restore();
  }

  ctx.strokeStyle = "#d8871f";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(-7, 27);
  ctx.lineTo(-9, 52);
  ctx.lineTo(-22, 57);
  ctx.moveTo(-9, 52);
  ctx.lineTo(3, 58);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(24, 25);
  ctx.lineTo(25, 51);
  ctx.lineTo(13, 58);
  ctx.moveTo(25, 51);
  ctx.lineTo(37, 56);
  ctx.stroke();

  ctx.fillStyle = CHICKEN_WHITE;
  ctx.strokeStyle = CHICKEN_OUTLINE;
  ctx.lineWidth = 4;

  ctx.beginPath();
  ctx.moveTo(-28, -7);
  ctx.bezierCurveTo(-55, -20, -75, -46, -65, -65);
  ctx.bezierCurveTo(-47, -60, -35, -45, -28, -30);
  ctx.bezierCurveTo(-65, -48, -79, -34, -74, -12);
  ctx.bezierCurveTo(-58, -9, -43, -3, -27, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = hit ? "#e7aaa2" : CHICKEN_WHITE;
  ctx.strokeStyle = CHICKEN_OUTLINE;
  ctx.lineWidth = 4;

  ctx.beginPath();
  ctx.ellipse(0, 4, 55, 43, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = hit ? "#cc8b84" : CHICKEN_SHADOW;
  ctx.globalAlpha = 0.75;

  ctx.beginPath();
  ctx.ellipse(-5, 22, 40, 20, 0.05, 0, Math.PI);
  ctx.fill();

  ctx.globalAlpha = 1;

  ctx.fillStyle = hit ? "#d9948e" : "#eef0e9";
  ctx.strokeStyle = CHICKEN_OUTLINE;
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.ellipse(-7, 9, 30, 25, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#cbd0c9";
  ctx.lineWidth = 2.5;

  ctx.beginPath();
  ctx.arc(-8, 10, 19, 0.2, 1.7);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(-7, 12, 13, 0.25, 1.6);
  ctx.stroke();

  ctx.fillStyle = hit ? "#e7aaa2" : CHICKEN_WHITE;
  ctx.strokeStyle = CHICKEN_OUTLINE;
  ctx.lineWidth = 4;

  ctx.beginPath();
  ctx.arc(38, -28, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = hit ? "#c95e5c" : CHICKEN_RED;
  ctx.strokeStyle = CHICKEN_OUTLINE;
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.moveTo(11, -52);
  ctx.bezierCurveTo(4, -67, 11, -80, 23, -73);
  ctx.bezierCurveTo(26, -88, 40, -89, 44, -74);
  ctx.bezierCurveTo(53, -84, 66, -77, 64, -63);
  ctx.bezierCurveTo(52, -52, 29, -49, 11, -52);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#ff5050";
  ctx.globalAlpha = 0.5;

  ctx.beginPath();
  ctx.arc(28, -66, 8, Math.PI, Math.PI * 1.8);
  ctx.fill();

  ctx.globalAlpha = 1;

  ctx.fillStyle = "#fffbe8";

  ctx.beginPath();
  ctx.ellipse(45, -25, 24, 27, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#fff6bf";
  ctx.strokeStyle = CHICKEN_OUTLINE;
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.arc(48, -34, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = CHICKEN_EYE;

  ctx.beginPath();
  ctx.arc(51, -35, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";

  ctx.beginPath();
  ctx.arc(53, -37, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = CHICKEN_BEAK;
  ctx.strokeStyle = CHICKEN_OUTLINE;
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.moveTo(66, -27);
  ctx.lineTo(98, -15);
  ctx.lineTo(67, -5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#d57f16";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(69, -16);
  ctx.lineTo(91, -15);
  ctx.stroke();

  ctx.fillStyle = "#e63238";
  ctx.strokeStyle = CHICKEN_OUTLINE;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.ellipse(66, -1, 8, 14, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(57, -2, 7, 11, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (hit) {
    ctx.fillStyle = "#ff4a42";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.font = "900 31px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeText("HIT!", 0, -98);
    ctx.fillText("HIT!", 0, -98);
  }

  ctx.restore();
}

// ─── Golden passed-lane coin ─────────────────────────────────────────────────

function drawGoldenCoin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  ctx.save();

  ctx.shadowColor = "#ffd84a";
  ctx.shadowBlur = 24;

  ctx.fillStyle = "#d89b18";
  ctx.beginPath();
  ctx.arc(x, y, 82, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;

  ctx.strokeStyle = "#8f6410";
  ctx.lineWidth = 10;

  ctx.beginPath();
  ctx.arc(x, y, 82, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "#ffdc55";
  ctx.lineWidth = 8;

  ctx.beginPath();
  ctx.arc(
    x,
    y,
    70,
    -Math.PI * 0.8,
    Math.PI * 0.55,
  );
  ctx.stroke();

  ctx.fillStyle = "#f0b92d";
  ctx.strokeStyle = "#a96f0d";
  ctx.lineWidth = 6;

  ctx.beginPath();
  ctx.arc(x, y, 57, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = "#fff4a8";

  ctx.beginPath();
  ctx.arc(
    x - 18,
    y - 18,
    35,
    Math.PI * 1.05,
    Math.PI * 1.75,
  );
  ctx.lineTo(x - 18, y - 18);
  ctx.fill();

  ctx.restore();

  ctx.strokeStyle = "#9a690e";
  ctx.lineWidth = 17;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(x - 31, y + 2);
  ctx.lineTo(x - 8, y + 25);
  ctx.lineTo(x + 37, y - 28);
  ctx.stroke();

  ctx.strokeStyle = "#fff8cf";
  ctx.lineWidth = 11;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(x - 31, y + 2);
  ctx.lineTo(x - 8, y + 25);
  ctx.lineTo(x + 37, y - 28);
  ctx.stroke();

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.75;

  ctx.beginPath();
  ctx.moveTo(x - 27, y - 1);
  ctx.lineTo(x - 9, y + 17);
  ctx.stroke();

  ctx.globalAlpha = 1;

  ctx.restore();
}

// ─── Multiplier target ───────────────────────────────────────────────────────

function drawMultiplier(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  multiplier: string,
  state: "future" | "current" | "safe" | "hit",
): void {
  const isCurrent = state === "current";
  const isSafe = state === "safe";
  const isHit = state === "hit";

  ctx.save();

  if (isSafe) {
    drawGoldenCoin(
      ctx,
      x,
      y,
    );
  } else {
    ctx.shadowColor = isCurrent
      ? "#18ff55"
      : isHit
        ? "#ff3030"
        : "#202745";

    ctx.shadowBlur =
      isCurrent || isHit
        ? 20
        : 10;

    ctx.fillStyle = isCurrent
      ? "#2fb34f"
      : isHit
        ? "#c32d32"
        : MULTIPLIER_FILL;

    ctx.beginPath();
    ctx.arc(x, y, 82, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    ctx.strokeStyle = isCurrent
      ? "#168f3b"
      : isHit
        ? "#8f2025"
        : MULTIPLIER_DARK_RING;

    ctx.lineWidth = 10;

    ctx.beginPath();
    ctx.arc(x, y, 82, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = isCurrent
      ? "#42ff63"
      : isHit
        ? "#ff5555"
        : MULTIPLIER_RING;

    ctx.lineWidth = 8;

    ctx.beginPath();
    ctx.arc(
      x,
      y,
      70,
      -Math.PI * 0.8,
      Math.PI * 0.55,
    );
    ctx.stroke();

    ctx.strokeStyle = isCurrent
      ? "#168f3b"
      : isHit
        ? "#8f2025"
        : "#343d69";

    ctx.lineWidth = 7;

    ctx.beginPath();
    ctx.arc(x, y, 60, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#ffffff";

    ctx.beginPath();
    ctx.moveTo(x - 55, y - 47);
    ctx.arc(
      x,
      y,
      75,
      Math.PI * 1.05,
      Math.PI * 1.7,
    );
    ctx.lineTo(x - 55, y - 47);
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  if (isCurrent) {
    drawChicken(
      ctx,
      x,
      y - 4,
      0.47,
      false,
    );
  }

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#313754";
  ctx.lineWidth = 2;

  ctx.font = "900 35px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.strokeText(
    multiplier,
    x,
    y + 112,
  );

  ctx.fillText(
    multiplier,
    x,
    y + 112,
  );

  ctx.restore();
}

// ─── Lane obstacle ───────────────────────────────────────────────────────────

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.save();

  ctx.fillStyle = OBSTACLE;

  roundedRect(
    ctx,
    x,
    y,
    width,
    height,
    17,
  );

  ctx.fill();

  ctx.fillStyle = OBSTACLE_HIGHLIGHT;
  ctx.globalAlpha = 0.42;

  roundedRect(
    ctx,
    x + 4,
    y + 3,
    width - 8,
    height * 0.35,
    14,
  );

  ctx.fill();

  ctx.globalAlpha = 1;

  ctx.restore();
}

// ─── Sewer / drain ───────────────────────────────────────────────────────────

function drawDrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  ctx.save();

  ctx.fillStyle = "#555f8a";

  roundedRect(
    ctx,
    x - 67,
    y - 8,
    134,
    17,
    8,
  );

  ctx.fill();

  ctx.fillStyle = DRAIN_DARK;
  ctx.strokeStyle = "#252b49";
  ctx.lineWidth = 5;

  ctx.beginPath();
  ctx.moveTo(x - 57, y - 5);
  ctx.lineTo(x - 57, y - 72);
  ctx.quadraticCurveTo(
    x,
    y - 105,
    x + 57,
    y - 72,
  );
  ctx.lineTo(x + 57, y - 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = DRAIN_MID;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";

  for (let i = -42; i <= 42; i += 15) {
    const topY =
      y -
      63 +
      Math.abs(i) * 0.22;

    ctx.beginPath();
    ctx.moveTo(x + i, y - 10);
    ctx.lineTo(x + i, topY);
    ctx.stroke();
  }

  ctx.strokeStyle = DRAIN_EDGE;
  ctx.lineWidth = 4;

  ctx.beginPath();
  ctx.arc(
    x,
    y - 8,
    57,
    Math.PI,
    Math.PI * 2,
  );
  ctx.stroke();

  ctx.restore();
}

// ─── Sidewalk ────────────────────────────────────────────────────────────────

function drawSidewalk(
  ctx: CanvasRenderingContext2D,
): void {
  ctx.save();

  ctx.fillStyle = "#222741";
  ctx.fillRect(
    0,
    0,
    SIDEWALK_WIDTH,
    IMAGE_HEIGHT,
  );

  ctx.fillStyle = "#2c314d";
  ctx.fillRect(
    8,
    0,
    SIDEWALK_WIDTH - 8,
    IMAGE_HEIGHT,
  );

  const gradient =
    ctx.createLinearGradient(
      0,
      0,
      SIDEWALK_WIDTH,
      0,
    );

  gradient.addColorStop(
    0,
    "rgba(255,255,255,0.025)",
  );

  gradient.addColorStop(
    1,
    "rgba(0,0,0,0.12)",
  );

  ctx.fillStyle = gradient;

  ctx.fillRect(
    8,
    0,
    SIDEWALK_WIDTH - 8,
    IMAGE_HEIGHT,
  );

  ctx.strokeStyle = "#3a405d";
  ctx.lineWidth = 3;

  for (
    let y = 70;
    y < IMAGE_HEIGHT;
    y += 120
  ) {
    ctx.beginPath();
    ctx.moveTo(8, y);
    ctx.lineTo(SIDEWALK_WIDTH, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#505875";

  ctx.fillRect(
    SIDEWALK_WIDTH - 9,
    0,
    9,
    IMAGE_HEIGHT,
  );

  ctx.fillStyle = "#68718f";

  ctx.fillRect(
    SIDEWALK_WIDTH - 4,
    0,
    4,
    IMAGE_HEIGHT,
  );

  ctx.restore();
}

// ─── Traffic light ───────────────────────────────────────────────────────────

function drawTrafficLight(
  ctx: CanvasRenderingContext2D,
): void {
  const x = 47;
  const y = 45;

  ctx.save();

  ctx.fillStyle = "#181d31";

  ctx.fillRect(
    x + 22,
    y + 115,
    8,
    165,
  );

  ctx.fillStyle = "#151a2d";
  ctx.strokeStyle = "#0d1120";
  ctx.lineWidth = 4;

  roundedRect(
    ctx,
    x,
    y,
    52,
    124,
    14,
  );

  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#ef3c45";

  ctx.beginPath();
  ctx.arc(
    x + 26,
    y + 26,
    10,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.fillStyle = "#e8a82d";

  ctx.beginPath();
  ctx.arc(
    x + 26,
    y + 62,
    10,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.fillStyle = "#35c765";

  ctx.beginPath();
  ctx.arc(
    x + 26,
    y + 98,
    10,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.restore();
}

// ─── Image window ─────────────────────────────────────────────────────────────

function imageWindowStart(
  lanesCrossed: number,
  status: GameStatus,
): number {
  const focusLane =
    status === "dead"
      ? lanesCrossed + 1
      : Math.max(1, lanesCrossed);

  return (
    Math.floor((focusLane - 1) / 5) * 5
  );
}

// ─── Main image ──────────────────────────────────────────────────────────────

function chickenCrossingImage(
  game: ChickenGame,
  status: GameStatus,
): Buffer {
  const canvas = createCanvas(
    IMAGE_WIDTH,
    IMAGE_HEIGHT,
  );

  const ctx =
    canvas.getContext("2d");

  const windowStart =
    imageWindowStart(
      game.lanesCrossed,
      status,
    );

  ctx.fillStyle = BG;

  ctx.fillRect(
    0,
    0,
    IMAGE_WIDTH,
    IMAGE_HEIGHT,
  );

  ctx.fillStyle = BG_DARK;

  ctx.fillRect(
    0,
    IMAGE_HEIGHT - 18,
    IMAGE_WIDTH,
    18,
  );

  drawSidewalk(ctx);
  drawTrafficLight(ctx);

  ctx.fillStyle = BG;

  ctx.fillRect(
    ROAD_LEFT,
    ROAD_TOP,
    ROAD_WIDTH,
    ROAD_BOTTOM,
  );

  for (let i = 0; i < 5; i++) {
    if (i % 2 === 1) {
      ctx.fillStyle = ROAD_ALT;

      ctx.fillRect(
        ROAD_LEFT + i * LANE_WIDTH,
        0,
        LANE_WIDTH,
        IMAGE_HEIGHT,
      );
    }
  }

  for (let i = 0; i <= 5; i++) {
    const x =
      ROAD_LEFT +
      i * LANE_WIDTH;

    ctx.strokeStyle = LANE_LINE;
    ctx.globalAlpha = 0.92;
    ctx.lineWidth = 6;
    ctx.setLineDash([30, 30]);

    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, IMAGE_HEIGHT);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  const windowEnd = Math.min(
    TOTAL_LANES,
    windowStart + 5,
  );

  for (
    let column = 0;
    column < 5;
    column++
  ) {
    const lane =
      windowStart +
      column +
      1;

    const laneLeft =
      ROAD_LEFT +
      column * LANE_WIDTH;

    const laneCenter =
      laneLeft +
      LANE_WIDTH / 2;

    if (lane > TOTAL_LANES) {
      continue;
    }

    /*
     * Lane state:
     *
     * - At game start (lanesCrossed === 0):
     *   NO chicken appears on lane 1.
     *   The chicken stays on the sidewalk.
     *
     * - Current lane after crossing:
     *   GREEN with chicken.
     *
     * - Previously completed lanes:
     *   GOLDEN COIN with checkmark.
     *
     * - Hit lane:
     *   RED.
     *
     * - Future lanes:
     *   Normal multiplier.
     */

    const currentLane =
      game.lanesCrossed;

    // IMPORTANT:
    // Do not show a chicken on lane 1 when
    // the game has just started.
    const isCurrent =
      status === "active" &&
      game.lanesCrossed > 0 &&
      lane === currentLane;

    const isCashedCurrent =
      status === "cashed" &&
      game.lanesCrossed > 0 &&
      lane === game.lanesCrossed;

    const isSafe =
      status === "dead"
        ? lane <= game.lanesCrossed
        : lane < game.lanesCrossed;

    const isHit =
      status === "dead" &&
      lane === game.lanesCrossed + 1;

    const obstaclePattern =
      lane % 5;

    const topObstacleY =
      obstaclePattern === 0
        ? 27
        : obstaclePattern === 1
          ? 91
          : obstaclePattern === 2
            ? 50
            : obstaclePattern === 3
              ? 120
              : 30;

    const obstacleOffset =
      ((lane * 37) % 55) - 27;

    drawObstacle(
      ctx,
      laneCenter - 38 + obstacleOffset,
      topObstacleY,
      76,
      62,
    );

    if (lane % 3 === 0) {
      drawObstacle(
        ctx,
        laneCenter - 45,
        500,
        90,
        62,
      );
    }

    const multiplier =
      formatMult(
        calcMultiplier(
          game.difficulty,
          lane,
        ),
      );

    const targetState =
      isHit
        ? "hit"
        : isCurrent || isCashedCurrent
          ? "current"
          : isSafe
            ? "safe"
            : "future";

    drawMultiplier(
      ctx,
      laneCenter,
      TARGET_Y,
      multiplier,
      targetState,
    );

    drawDrain(
      ctx,
      laneCenter,
      DRAIN_Y,
    );
  }

  // Hit state: show the hit car + large hit chicken.
  if (status === "dead") {
    const hitLane =
      game.lanesCrossed + 1;

    const hitColumn =
      hitLane -
      windowStart -
      1;

    if (
      hitColumn >= 0 &&
      hitColumn < 5
    ) {
      const hitLaneLeft =
        ROAD_LEFT +
        hitColumn * LANE_WIDTH;

      const hitCenter =
        hitLaneLeft +
        LANE_WIDTH / 2;

      drawHitCar(
        ctx,
        hitCenter,
        TARGET_Y + 5,
        0.82,
      );

      drawChicken(
        ctx,
        hitCenter,
        TARGET_Y,
        0.86,
        true,
      );
    }
  }

  // At the beginning of the game, the chicken is ONLY on the sidewalk.
  else if (
    game.lanesCrossed === 0
  ) {
    drawChicken(
      ctx,
      SIDEWALK_WIDTH / 2 - 4,
      TARGET_Y,
      0.86,
    );
  }

  // After crossing at least one lane, place the chicken
  // on the lane currently occupied.
  else {
    const chickenLane =
      game.lanesCrossed;

    const chickenColumn =
      chickenLane -
      windowStart -
      1;

    if (
      chickenColumn >= 0 &&
      chickenColumn < 5
    ) {
      const chickenLaneLeft =
        ROAD_LEFT +
        chickenColumn * LANE_WIDTH;

      const chickenCenter =
        chickenLaneLeft +
        LANE_WIDTH / 2;

      drawChicken(
        ctx,
        chickenCenter,
        TARGET_Y,
        0.86,
      );
    }
  }

  ctx.fillStyle =
    "rgba(17, 21, 40, 0.12)";

  ctx.fillRect(
    ROAD_LEFT,
    0,
    ROAD_WIDTH,
    10,
  );

  ctx.fillStyle =
    "rgba(18, 22, 40, 0.20)";

  ctx.fillRect(
    ROAD_LEFT,
    IMAGE_HEIGHT - 17,
    ROAD_WIDTH,
    17,
  );

  ctx.fillStyle = "#e3e9ff";
  ctx.font = "800 16px Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";

  ctx.fillText(
    `LANES ${windowStart + 1}–${windowEnd}`,
    IMAGE_WIDTH - 24,
    29,
  );

  return canvas.toBuffer(
    "image/png",
  );
}

// ─── Image attachment ────────────────────────────────────────────────────────

function imageComponent(): MediaGalleryBuilder {
  return new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(
      "attachment://chicken-crossing.png",
    ),
  );
}

function imageFile(
  game: ChickenGame,
  status: GameStatus,
): AttachmentBuilder {
  return new AttachmentBuilder(
    chickenCrossingImage(
      game,
      status,
    ),
    {
      name: "chicken-crossing.png",
    },
  );
}

// ─── Components V2 helpers ───────────────────────────────────────────────────

function text(
  content: string,
): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(
    content,
  );
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder();
}

// ─── Main panel ──────────────────────────────────────────────────────────────

function buildComponents(
  game: ChickenGame,
  status: GameStatus,
): ContainerBuilder[] {
  const mult =
    calcMultiplier(
      game.difficulty,
      game.lanesCrossed,
    );

  const nextMult =
    calcMultiplier(
      game.difficulty,
      game.lanesCrossed + 1,
    );

  const nextWin =
    Math.floor(
      game.bet * nextMult,
    );

  const currentWin =
    Math.floor(
      game.bet * mult,
    );

  const diffLabel =
    game.difficulty
      .charAt(0)
      .toUpperCase() +
    game.difficulty.slice(1);

  const diffEmoji =
    DIFF_EMOJI[
      game.difficulty
    ];

  const color =
    status === "active"
      ? COLORS.primary
      : status === "cashed"
        ? COLORS.success
        : COLORS.danger;

  const title =
    status === "active"
      ? "🐔  Chicken Crossing"
      : status === "cashed"
        ? "🐔  Chicken Crossing — 💸 CASHED OUT"
        : "🐔  Chicken Crossing — 🚗 Hit!";

  const panel =
    new ContainerBuilder()
      .setAccentColor(color)

      .addMediaGalleryComponents(
        imageComponent(),
      )

      .addTextDisplayComponents(
        text(`## ${title}`),
      )

      .addTextDisplayComponents(
        text(
          [
            `💎 **Bet**  \`${formatAmount(game.bet)}\``,
            `${diffEmoji} **Mode**  \`${diffLabel}\``,
            status === "active"
              ? `💰 **Potential**  \`${formatAmount(currentWin)}\``
              : status === "dead"
                ? `💰 **Potential**  \`${formatAmount(currentWin)}\``
                : `💰 **Payout**  \`${formatAmount(currentWin)}\``,
            status === "active"
              ? `💰 **Next lane**  \`${formatAmount(nextWin)}\``
              : status === "dead"
                ? `❌ **Lost on lane**  \`${game.lanesCrossed + 1} of ${TOTAL_LANES}\``
                : "",
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );

  if (
    status === "active" &&
    game.lanesCrossed < TOTAL_LANES
  ) {
    panel
      .addSeparatorComponents(
        separator(),
      )
      .addTextDisplayComponents(
        text(
          `Next lane pays **${formatMult(nextMult)}** for **${formatAmount(nextWin)} gems**.`,
        ),
      )
      .addActionRowComponents(
        buildGameButtons(
          game.userId,
          game.lanesCrossed > 0,
        ),
      );
  } else if (
    status === "cashed"
  ) {
    panel
      .addSeparatorComponents(
        separator(),
      )
      .addTextDisplayComponents(
        text(
          `Cashed out at **${formatMult(mult)}** after **${game.lanesCrossed} safe lane${game.lanesCrossed !== 1 ? "s" : ""}**.`,
        ),
      )
      .addActionRowComponents(
        buildPlayAgainRow(
          game.userId,
          game.difficulty,
          game.bet,
        ),
      );
  } else if (
    status === "dead"
  ) {
    panel.addActionRowComponents(
      buildPlayAgainRow(
        game.userId,
        game.difficulty,
        game.bet,
      ),
    );
  }

  return [panel];
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

function buildGameButtons(
  userId: string,
  canCashout: boolean,
): ActionRowBuilder {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `cc_fwd_${userId}`,
      )
      .setLabel("Forward")
      .setEmoji("➡️")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(
        `cc_cash_${userId}`,
      )
      .setLabel("Cashout")
      .setEmoji("🦅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canCashout),
  );
}

function buildPlayAgainRow(
  userId: string,
  difficulty: string,
  bet: number,
  disabled = false,
): ActionRowBuilder {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `pa_cc_${userId}_${difficulty}_${bet}`,
      )
      .setLabel("🔄  Play Again")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

// ─── Command ─────────────────────────────────────────────────────────────────

export const data =
  new SlashCommandBuilder()
    .setName("chickencrossing")
    .setDescription(
      "Cross lanes with your chicken — cash out before getting hit!",
    )
    .addStringOption((o) =>
      o
        .setName("bet")
        .setDescription("Amount to bet")
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("difficulty")
        .setDescription("Lane difficulty")
        .setRequired(true)
        .addChoices(
          {
            name: "Easy",
            value: "easy",
          },
          {
            name: "Medium",
            value: "medium",
          },
          {
            name: "Hard",
            value: "hard",
          },
        ),
    );

// ─── Execute ─────────────────────────────────────────────────────────────────

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const userId =
    interaction.user.id;

  if (
    activeChickenGames.has(
      userId,
    )
  ) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "You already have an active Chicken Crossing game!",
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

  const difficulty =
    interaction.options.getString(
      "difficulty",
      true,
    ) as Difficulty;

  const bet =
    parseAmount(betStr);

  if (
    !bet ||
    bet < 1_000_000
  ) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "Minimum bet is 1m gems.",
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

  const game: ChickenGame = {
    userId,
    bet,
    difficulty,
    lanesCrossed: 0,
    multiplier: 1.0,
    messageId: "",
    channelId:
      interaction.channelId,
  };

  const msg: Message =
    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,
      files: [
        imageFile(
          game,
          "active",
        ),
      ],
      components:
        buildComponents(
          game,
          "active",
        ),
    });

  game.messageId =
    msg.id;

  activeChickenGames.set(
    userId,
    game,
  );
}

// ─── Button: Forward ─────────────────────────────────────────────────────────

export async function handleForward(
  interaction: ButtonInteraction,
): Promise<void> {
  await interaction.deferUpdate();

  const game =
    activeChickenGames.get(
      interaction.user.id,
    );

  if (!game) return;

  const hit =
    Math.random() <
    HIT_CHANCE[
      game.difficulty
    ];

  if (hit) {
    activeChickenGames.delete(
      interaction.user.id,
    );

    await recordBet(
      interaction.user.id,
      game.bet,
      -game.bet,
      "chickencrossing",
    );

    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,
      files: [
        imageFile(
          game,
          "dead",
        ),
      ],
      components:
        buildComponents(
          game,
          "dead",
        ),
    });

    return;
  }

  game.lanesCrossed++;

  game.multiplier =
    calcMultiplier(
      game.difficulty,
      game.lanesCrossed,
    );

  if (
    game.lanesCrossed ===
    TOTAL_LANES
  ) {
    activeChickenGames.delete(
      interaction.user.id,
    );

    const winnings =
      Math.floor(
        game.bet *
        game.multiplier,
      );

    await addBalance(
      interaction.user.id,
      winnings,
    );

    await recordBet(
      interaction.user.id,
      game.bet,
      winnings - game.bet,
      "chickencrossing",
      game.multiplier,
    );

    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,
      files: [
        imageFile(
          game,
          "cashed",
        ),
      ],
      components:
        buildComponents(
          game,
          "cashed",
        ),
    });

    return;
  }

  await interaction.editReply({
    flags:
      MessageFlags.IsComponentsV2,
    files: [
      imageFile(
        game,
        "active",
      ),
    ],
    components:
      buildComponents(
        game,
        "active",
      ),
  });
}

// ─── Button: Cashout ─────────────────────────────────────────────────────────

export async function handleCashout(
  interaction: ButtonInteraction,
): Promise<void> {
  await interaction.deferUpdate();

  const game =
    activeChickenGames.get(
      interaction.user.id,
    );

  if (
    !game ||
    game.lanesCrossed === 0
  ) {
    return;
  }

  activeChickenGames.delete(
    interaction.user.id,
  );

  const winnings =
    Math.floor(
      game.bet *
      game.multiplier,
    );

  await addBalance(
    interaction.user.id,
    winnings,
  );

  await recordBet(
    interaction.user.id,
    game.bet,
    winnings - game.bet,
    "chickencrossing",
    game.multiplier,
  );

  await interaction.editReply({
    flags:
      MessageFlags.IsComponentsV2,
    files: [
      imageFile(
        game,
        "cashed",
      ),
    ],
    components:
      buildComponents(
        game,
        "cashed",
      ),
  });
}

// ─── Button: Play Again ──────────────────────────────────────────────────────

export async function handlePlayAgain(
  interaction: ButtonInteraction,
  userId: string,
  difficulty: string,
  betStr: string,
): Promise<void> {
  if (
    interaction.user.id !==
    userId
  ) {
    return void interaction.reply({
      content:
        "❌ This isn’t your game.",
      flags:
        MessageFlags.Ephemeral,
    });
  }

  if (
    activeChickenGames.has(
      userId,
    )
  ) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "You already have an active Chicken Crossing game!",
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });
  }

  const bet =
    parseInt(
      betStr,
      10,
    );

  if (
    !Number.isSafeInteger(
      bet,
    ) ||
    bet < 1
  ) {
    return void interaction.reply({
      content:
        "❌ Invalid bet.",
      flags:
        MessageFlags.Ephemeral,
    });
  }

  await interaction.deferUpdate();

  const message =
    interaction.message;

  const disabledPlayAgainRow =
    buildPlayAgainRow(
      userId,
      difficulty,
      bet,
      true,
    );

  const existingComponents =
    message.components.map(
      (component) =>
        component.toJSON(),
    );

  const updatedComponents =
    existingComponents.map(
      (component: any) => {
        if (
          component.type !==
            17 ||
          !Array.isArray(
            component.components,
          )
        ) {
          return component;
        }

        return {
          ...component,
          components:
            component.components.map(
              (child: any) => {
                if (
                  child.type === 1 &&
                  Array.isArray(
                    child.components,
                  ) &&
                  child.components.some(
                    (
                      button: any,
                    ) =>
                      button.custom_id ===
                      `pa_cc_${userId}_${difficulty}_${bet}`,
                  )
                ) {
                  return disabledPlayAgainRow.toJSON();
                }

                return child;
              },
            ),
        };
      },
    );

  await interaction.editReply({
    flags:
      MessageFlags.IsComponentsV2,
    components:
      updatedComponents as any,
  });

  const user =
    await getOrCreateUser(
      userId,
      interaction.user.username,
    );

  if (
    user.balance < bet
  ) {
    await interaction.followUp({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`,
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });

    return;
  }

  await addBalance(
    userId,
    -bet,
  );

  const game: ChickenGame = {
    userId,
    bet,
    difficulty:
      difficulty as Difficulty,
    lanesCrossed: 0,
    multiplier: 1.0,
    messageId: "",
    channelId:
      interaction.channelId,
  };

  const msg: Message =
    await interaction.followUp({
      flags:
        MessageFlags.IsComponentsV2,
      files: [
        imageFile(
          game,
          "active",
        ),
      ],
      components:
        buildComponents(
          game,
          "active",
        ),
    });

  game.messageId =
    msg.id;

  activeChickenGames.set(
    userId,
    game,
  );
}