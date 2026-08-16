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
  formatMult,
  getOrCreateUser,
  addBalance,
  recordBet,
  errorEmbed,
} from "../utils.js";

// ─── Types ────────────────────────────────────────────────────────────────────
type Difficulty = "easy" | "medium" | "hard";

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

// ─── Config ───────────────────────────────────────────────────────────────────
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

// ─── Track image ──────────────────────────────────────────────────────────────
const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 760;
const FIELD_LEFT = 45;
const FIELD_TOP = 42;
const FIELD_WIDTH = IMAGE_WIDTH - 90;
const LANE_TOP = 140;
const LANE_BOTTOM = 690;
const SIDEWALK_LEFT = 90;
const SIDEWALK_WIDTH = 130;
const LANE_LEFT = 250;
const LANE_WIDTH = 165;
const LANE_GAP = 10;
const TARGET_Y = 350;

type GameStatus = "active" | "cashed" | "dead";

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

function drawChicken(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  hit = false,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  if (hit) {
    ctx.strokeStyle = "#ffcf33";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    for (const [dx, dy] of [
      [-58, -35],
      [-45, 35],
      [50, -30],
      [58, 30],
    ]) {
      ctx.beginPath();
      ctx.moveTo(dx * 0.6, dy * 0.6);
      ctx.lineTo(dx, dy);
      ctx.stroke();
    }

    ctx.fillStyle = "#f5d08a";
    for (const [dx, dy, angle] of [
      [-48, -22, -0.5],
      [-42, 29, 0.7],
      [47, -25, 0.4],
      [48, 25, -0.6],
    ]) {
      ctx.save();
      ctx.translate(dx, dy);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Legs.
  ctx.strokeStyle = "#e58b2c";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  for (const legX of [0, 22]) {
    ctx.beginPath();
    ctx.moveTo(legX, 25);
    ctx.lineTo(legX - 4, 43);
    ctx.moveTo(legX - 4, 43);
    ctx.lineTo(legX - 13, 43);
    ctx.moveTo(legX - 4, 43);
    ctx.lineTo(legX + 5, 43);
    ctx.stroke();
  }

  // Body and wing.
  ctx.fillStyle = hit ? "#f4b6aa" : "#fff9e8";
  ctx.strokeStyle = "#d9c79b";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(8, 4, 39, 29, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = hit ? "#dc8f82" : "#e9dfc3";
  ctx.beginPath();
  ctx.ellipse(2, 8, 20, 13, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // Tail feathers.
  ctx.fillStyle = hit ? "#d8897c" : "#fff9e8";
  ctx.beginPath();
  ctx.moveTo(-23, -7);
  ctx.lineTo(-54, -27);
  ctx.lineTo(-39, 2);
  ctx.lineTo(-56, 13);
  ctx.lineTo(-20, 17);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Head, comb, beak, and eye.
  ctx.fillStyle = hit ? "#f4b6aa" : "#fff9e8";
  ctx.beginPath();
  ctx.arc(39, -17, 25, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#e94b4b";
  ctx.beginPath();
  ctx.arc(31, -43, 7, 0, Math.PI * 2);
  ctx.arc(42, -46, 8, 0, Math.PI * 2);
  ctx.arc(52, -41, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f29b38";
  ctx.beginPath();
  ctx.moveTo(61, -17);
  ctx.lineTo(86, -8);
  ctx.lineTo(61, -1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#222b3a";
  ctx.beginPath();
  ctx.arc(47, -23, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(48, -24, 1.5, 0, Math.PI * 2);
  ctx.fill();

  if (hit) {
    ctx.fillStyle = "#f04f45";
    ctx.font = "900 32px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("HIT!", 4, -73);
  }

  ctx.restore();
}

function drawTarget(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  state: "safe" | "current" | "future" | "hit",
  multiplier: string,
): void {
  const colors = {
    safe: { fill: "#1f9d68", stroke: "#70f0b0", text: "✓" },
    current: { fill: "#c47b22", stroke: "#ffd166", text: "→" },
    future: { fill: "#263750", stroke: "#7283a0", text: "?" },
    hit: { fill: "#a93643", stroke: "#ff7771", text: "×" },
  }[state];

  ctx.save();
  const glow = state === "current" || state === "hit" ? 20 : 8;
  ctx.shadowColor = colors.stroke;
  ctx.shadowBlur = glow;
  ctx.fillStyle = colors.fill;
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x, y, 43, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = colors.stroke;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 7]);
  ctx.beginPath();
  ctx.arc(x, y, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  ctx.arc(x - 12, y - 14, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 36px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(colors.text, x, y - 2);

  const badgeWidth = 116;
  const badgeHeight = 34;
  const badgeY = y + 61;
  ctx.fillStyle = state === "future" ? "#1c2b42" : "#0c1728";
  ctx.strokeStyle = state === "future" ? "#536783" : colors.stroke;
  ctx.lineWidth = 2;
  roundedRect(
    ctx,
    x - badgeWidth / 2,
    badgeY,
    badgeWidth,
    badgeHeight,
    17,
  );
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = state === "future" ? "#a5b4c8" : "#ffe08a";
  ctx.font = "900 20px Arial";
  ctx.fillText(multiplier, x, badgeY + badgeHeight / 2 + 1);
  ctx.restore();
}

function imageWindowStart(
  lanesCrossed: number,
  status: GameStatus,
): number {
  const focusLane =
    status === "dead"
      ? lanesCrossed + 1
      : status === "cashed"
        ? Math.max(1, lanesCrossed)
        : lanesCrossed + 1;

  return Math.floor((focusLane - 1) / 5) * 5;
}

function chickenCrossingImage(
  game: ChickenGame,
  status: GameStatus,
): Buffer {
  const canvas = createCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
  const ctx = canvas.getContext("2d");
  const windowStart = imageWindowStart(
    game.lanesCrossed,
    status,
  );

  const background = ctx.createLinearGradient(
    0,
    0,
    IMAGE_WIDTH,
    IMAGE_HEIGHT,
  );
  background.addColorStop(0, "#071628");
  background.addColorStop(1, "#101c34");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

  ctx.fillStyle = "#152945";
  roundedRect(
    ctx,
    FIELD_LEFT,
    FIELD_TOP,
    FIELD_WIDTH,
    IMAGE_HEIGHT - 84,
    30,
  );
  ctx.fill();
  ctx.strokeStyle = "#28466c";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = "#f6fbff";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "900 32px Arial";
  ctx.fillText("CHICKEN CROSSING", 84, 70);

  const windowEnd = Math.min(TOTAL_LANES, windowStart + 5);
  ctx.fillStyle = "#90a8c8";
  ctx.textAlign = "right";
  ctx.font = "700 21px Arial";
  ctx.fillText(
    `LANES ${windowStart + 1}–${windowEnd}`,
    IMAGE_WIDTH - 84,
    78,
  );

  // One continuous vertical sidewalk is the chicken's starting area.
  ctx.fillStyle = "#b69870";
  roundedRect(
    ctx,
    SIDEWALK_LEFT,
    LANE_TOP,
    SIDEWALK_WIDTH,
    LANE_BOTTOM - LANE_TOP,
    18,
  );
  ctx.fill();
  ctx.strokeStyle = "#e0c493";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#765f46";
  ctx.font = "900 17px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    "START",
    SIDEWALK_LEFT + SIDEWALK_WIDTH / 2,
    LANE_TOP + 28,
  );
  ctx.save();
  ctx.translate(
    SIDEWALK_LEFT + SIDEWALK_WIDTH / 2,
    LANE_BOTTOM - 95,
  );
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("SIDEWALK", 0, 0);
  ctx.restore();

  for (let column = 0; column < 5; column++) {
    const lane = windowStart + column + 1;
    const laneX =
      LANE_LEFT +
      column * (LANE_WIDTH + LANE_GAP);
    const targetX = laneX + LANE_WIDTH / 2;

    if (lane > TOTAL_LANES) {
      ctx.fillStyle = "#14243a";
      roundedRect(
        ctx,
        laneX,
        LANE_TOP,
        LANE_WIDTH,
        LANE_BOTTOM - LANE_TOP,
        18,
      );
      ctx.fill();
      continue;
    }

    const currentLane = game.lanesCrossed + 1;
    const isSafe = lane <= game.lanesCrossed;
    const isHit = status === "dead" && lane === currentLane;
    const isCurrent = status === "active" && lane === currentLane;

    ctx.fillStyle =
      column % 2 === 0 ? "#1a3350" : "#1d3958";
    roundedRect(
      ctx,
      laneX,
      LANE_TOP,
      LANE_WIDTH,
      LANE_BOTTOM - LANE_TOP,
      18,
    );
    ctx.fill();
    ctx.strokeStyle = "#385276";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Vertical crossing lane with a subtle dashed center line.
    ctx.strokeStyle = "#49617e";
    ctx.lineWidth = 2;
    ctx.setLineDash([18, 16]);
    ctx.beginPath();
    ctx.moveTo(targetX, LANE_TOP + 18);
    ctx.lineTo(targetX, LANE_BOTTOM - 18);
    ctx.stroke();
    ctx.setLineDash([]);

    // Lane label.
    ctx.fillStyle = "#d9e7f7";
    ctx.textAlign = "center";
    ctx.font = "900 17px Arial";
    ctx.fillText(`LANE ${lane}`, targetX, LANE_TOP + 28);

    const laneMultiplier = formatMult(
      calcMultiplier(game.difficulty, lane),
    );
    const targetState = isHit
      ? "hit"
      : isSafe
        ? "safe"
        : isCurrent
          ? "current"
          : "future";
    drawTarget(
      ctx,
      targetX,
      TARGET_Y,
      targetState,
      laneMultiplier,
    );

    if (isHit) {
      drawChicken(ctx, targetX, TARGET_Y - 2, 0.72, true);
    } else if (isSafe && lane === game.lanesCrossed) {
      drawChicken(ctx, targetX, TARGET_Y - 2, 0.58);
    } else if (isCurrent) {
      const chickenX =
        game.lanesCrossed === 0
          ? SIDEWALK_LEFT + SIDEWALK_WIDTH / 2
          : laneX + 33;
      drawChicken(ctx, chickenX, TARGET_Y - 7, 0.62);
    }
  }

  ctx.fillStyle = "#8da4c4";
  ctx.font = "600 18px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(
    status === "dead"
      ? "The chicken got hit — the crossing ends here."
      : status === "cashed"
        ? "Safe crossing — payout locked in."
        : "Choose Forward to cross the highlighted lane.",
    IMAGE_WIDTH / 2,
    IMAGE_HEIGHT - 27,
  );

  return canvas.toBuffer("image/png");
}

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
    chickenCrossingImage(game, status),
    { name: "chicken-crossing.png" },
  );
}

// ─── Components V2 helpers ────────────────────────────────────────────────────
function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder();
}

// ─── Main panel ───────────────────────────────────────────────────────────────
function buildComponents(
  game: ChickenGame,
  status: "active" | "cashed" | "dead",
): ContainerBuilder[] {
  const mult = calcMultiplier(
    game.difficulty,
    game.lanesCrossed,
  );

  const nextMult = calcMultiplier(
    game.difficulty,
    game.lanesCrossed + 1,
  );

  const nextWin = Math.floor(
    game.bet * nextMult,
  );

  const currentWin = Math.floor(
    game.bet * mult,
  );

  const maxWin = Math.floor(
    game.bet *
      calcMultiplier(
        game.difficulty,
        TOTAL_LANES,
      ),
  );

  const diffLabel =
    game.difficulty.charAt(0).toUpperCase() +
    game.difficulty.slice(1);

  const diffEmoji =
    DIFF_EMOJI[game.difficulty];

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

  const panel = new ContainerBuilder()
    .setAccentColor(color)

    // ── Smaller title ───────────────────────────────────────────────────────
    .addTextDisplayComponents(
      text(`## ${title}`),
    )

    // ── Bet / payout / difficulty section ───────────────────────────────────
    .addTextDisplayComponents(
      text(
        [
          `💎 **Bet**  \`${formatAmount(game.bet)}\``,
          status === "active"
            ? `💰 **If you cash**  \`${formatAmount(currentWin)}\``
            : status === "dead"
              ? `💰 **Lost Payout**  \`${formatAmount(currentWin)}\``
              : `💰 **Payout**  \`${formatAmount(currentWin)}\``,
          `${diffEmoji} **Difficulty**  \`${diffLabel}\``,
          status === "active"
            ? `💰 **Last lane**  \`${formatAmount(maxWin)}\``
            : status === "dead"
              ? `❌ **Lost on lane**  \`${game.lanesCrossed + 1} of ${TOTAL_LANES}\``
              : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    )

    .addSeparatorComponents(
      separator(),
    )

    // ── Five-lane visual field ───────────────────────────────────────────────
    .addMediaGalleryComponents(
      imageComponent(),
    )

    // ── Track status ─────────────────────────────────────────────────────────
    .addTextDisplayComponents(
      text(
        [
          status === "active"
            ? `## 🐔  Lane ${game.lanesCrossed + 1} of ${TOTAL_LANES}`
            : `## 🏁  Crossed ${game.lanesCrossed} lane${game.lanesCrossed !== 1 ? "s" : ""}`,
        ].join("\n"),
      ),
    );

  // ── Buttons / status ──────────────────────────────────────────────────────
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
  } else if (status === "cashed") {
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
  } else if (status === "dead") {
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

// ─── Buttons ──────────────────────────────────────────────────────────────────
function buildGameButtons(
  userId: string,
  canCashout: boolean,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
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
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `pa_cc_${userId}_${difficulty}_${bet}`,
      )
      .setLabel("🔄  Play Again")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
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
      .setDescription(
        "Lane difficulty (default: easy)",
      )
      .setRequired(false)
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

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const userId = interaction.user.id;

  if (activeChickenGames.has(userId)) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "You already have an active Chicken Crossing game!",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  const betStr =
    interaction.options.getString(
      "bet",
      true,
    );

  const difficulty =
    (interaction.options.getString(
      "difficulty",
    ) ?? "easy") as Difficulty;

  const bet = parseAmount(betStr);

  if (!bet || bet < 1_000_000) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "Minimum bet is **1m gems**.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  const user =
    await getOrCreateUser(
      userId,
      interaction.user.username,
    );

  if (user.balance < bet) {
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

  game.messageId = msg.id;

  activeChickenGames.set(
    userId,
    game,
  );
}

// ─── Button: Forward ──────────────────────────────────────────────────────────
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

// ─── Button: Cashout ──────────────────────────────────────────────────────────
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

// ─── Button: Play Again ───────────────────────────────────────────────────────
export async function handlePlayAgain(
  interaction: ButtonInteraction,
  userId: string,
  difficulty: string,
  betStr: string,
): Promise<void> {
  if (interaction.user.id !== userId) {
    return void interaction.reply({
      content: "❌ This isn't your game.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (activeChickenGames.has(userId)) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "You already have an active Chicken Crossing game!",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  const bet = parseInt(betStr, 10);

  if (!Number.isSafeInteger(bet) || bet < 1) {
    return void interaction.reply({
      content: "❌ Invalid bet.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // Acknowledge the button interaction.
  await interaction.deferUpdate();

  /*
   * Keep the COMPLETE previous panel exactly as it was.
   *
   * We only replace the ActionRow containing the Play Again button
   * with the same row, but with that button disabled.
   *
   * The previous title, bet, payout, difficulty, track, separators,
   * and all other text remain unchanged.
   */
  const message = interaction.message;

  const disabledPlayAgainRow = buildPlayAgainRow(
    userId,
    difficulty,
    bet,
    true,
  );

  const existingComponents = message.components.map(
    (component) => component.toJSON(),
  );

  const updatedComponents = existingComponents.map(
    (component: any) => {
      if (
        component.type !== 17 ||
        !Array.isArray(component.components)
      ) {
        return component;
      }

      return {
        ...component,
        components: component.components.map(
          (child: any) => {
            if (
              child.type === 1 &&
              Array.isArray(child.components) &&
              child.components.some(
                (button: any) =>
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

  // Edit the original message while preserving the entire panel.
  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: updatedComponents as any,
  });

  const user =
    await getOrCreateUser(
      userId,
      interaction.user.username,
    );

  if (user.balance < bet) {
    await interaction.followUp({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
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

  // The new game is a separate message.
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

  game.messageId = msg.id;

  activeChickenGames.set(
    userId,
    game,
  );
}