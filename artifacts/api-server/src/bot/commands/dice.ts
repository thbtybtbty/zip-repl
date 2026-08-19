import {
  SlashCommandBuilder,
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
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

type DiceDirection = "over" | "under";

const RTP = 0.90;
const IMAGE_WIDTH = 1024;
const IMAGE_HEIGHT = 320;
const BAR_X = 66;

// Smaller vertical progress bar, centered in the same track.
const BAR_Y = 202;
const BAR_WIDTH = 892;
const BAR_HEIGHT = 24;

export const data = new SlashCommandBuilder()
  .setName("dice")
  .setDescription("Roll over or under a target number")
  .addStringOption((option) =>
    option
      .setName("amount")
      .setDescription("Bet amount (e.g. 1m, 2.5b)")
      .setRequired(true),
  )
  .addIntegerOption((option) =>
    option
      .setName("target")
      .setDescription("Whole number between 10 and 90")
      .setMinValue(10)
      .setMaxValue(90)
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("direction")
      .setDescription("Win over or under your target")
      .setRequired(true)
      .addChoices(
        { name: "Over", value: "over" },
        { name: "Under", value: "under" },
      ),
  );

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder();
}

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

function pipPositions(value: number): Array<[number, number]> {
  const positions: Record<number, Array<[number, number]>> = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  };

  return positions[value]!;
}

function drawDie(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  value: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.16);

  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 9;
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 5;

  // Keep the die compact like the reference, but give it a beveled,
  // dimensional tile treatment instead of simply scaling it up.
  ctx.fillStyle = "#8d9aa3";
  roundedRect(ctx, -23, -27, 46, 60, 9);
  ctx.fill();

  const dieFace = ctx.createLinearGradient(-22, -30, 21, 30);
  dieFace.addColorStop(0, "#ffffff");
  dieFace.addColorStop(0.42, "#f4f7f5");
  dieFace.addColorStop(1, "#c7d0d2");

  ctx.fillStyle = dieFace;
  roundedRect(ctx, -23, -30, 46, 60, 9);
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = "transparent";
  ctx.globalAlpha = 0.72;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;

  roundedRect(ctx, -17, -24, 34, 48, 5);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.fillStyle = "#172033";

  for (const [px, py] of pipPositions(value)) {
    ctx.beginPath();
    ctx.arc(px * 10, py * 17, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#27344b";

    ctx.beginPath();
    ctx.arc(
      px * 10 - 1,
      py * 17 - 1,
      2.2,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.fillStyle = "#172033";
  }

  ctx.restore();
}

function drawDiceImage(
  roll: number,
  target: number,
  direction: DiceDirection,
): Buffer {
  const canvas = createCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
  const ctx = canvas.getContext("2d");

  const background = ctx.createLinearGradient(
    0,
    0,
    0,
    IMAGE_HEIGHT,
  );

  background.addColorStop(0, "#101a28");
  background.addColorStop(1, "#0c121d");

  ctx.fillStyle = background;

  ctx.fillRect(
    0,
    0,
    IMAGE_WIDTH,
    IMAGE_HEIGHT,
  );

  ctx.strokeStyle = "#d54b57";
  ctx.lineWidth = 5;

  roundedRect(
    ctx,
    2.5,
    2.5,
    IMAGE_WIDTH - 5,
    IMAGE_HEIGHT - 5,
    18,
  );

  ctx.stroke();

  ctx.fillStyle = "#b9c5d8";
  ctx.font = "700 14px Arial";
  ctx.letterSpacing = "5px";

  ctx.fillText(
    "DICE",
    48,
    45,
  );

  ctx.letterSpacing = "0px";

  ctx.fillStyle = "#f5a9b3";
  ctx.strokeStyle = "#080d17";
  ctx.lineWidth = 10;
  ctx.font = "900 82px Arial";

  ctx.strokeText(
    roll.toFixed(2),
    48,
    128,
  );

  ctx.fillText(
    roll.toFixed(2),
    48,
    128,
  );

  const chance =
    direction === "over"
      ? 100 - target
      : target;

  const targetLabel =
    `${direction.toUpperCase()} ${target}`;

  const chanceLabel =
    `${chance}% WIN CHANCE`;

  ctx.textAlign = "right";
  ctx.fillStyle = "#ffd34d";
  ctx.font = "900 33px Arial";

  ctx.fillText(
    targetLabel,
    IMAGE_WIDTH - 43,
    87,
  );

  ctx.fillStyle = "#aebbd0";
  ctx.font = "700 20px Arial";

  ctx.fillText(
    chanceLabel,
    IMAGE_WIDTH - 43,
    117,
  );

  ctx.textAlign = "left";

  ctx.fillStyle = "#101827";
  ctx.strokeStyle = "#050b15";
  ctx.lineWidth = 5;

  roundedRect(
    ctx,
    42,
    178,
    940,
    72,
    18,
  );

  ctx.fill();
  ctx.stroke();

  // ── Smaller progress bar ────────────────────────────────────────────────

  const trackX = BAR_X;
  const trackY = BAR_Y;

  const split =
    trackX +
    (target / 100) * BAR_WIDTH;

  const winningLeft =
    direction === "under";

  ctx.save();

  roundedRect(
    ctx,
    trackX,
    trackY,
    BAR_WIDTH,
    BAR_HEIGHT,
    12,
  );

  ctx.clip();

  ctx.fillStyle =
    winningLeft
      ? "#2cae6b"
      : "#e34d5b";

  ctx.fillRect(
    trackX,
    trackY,
    split - trackX,
    BAR_HEIGHT,
  );

  ctx.fillStyle =
    winningLeft
      ? "#e34d5b"
      : "#2cae6b";

  ctx.fillRect(
    split,
    trackY,
    trackX + BAR_WIDTH - split,
    BAR_HEIGHT,
  );

  ctx.restore();

  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;

  for (
    let x = trackX - 20;
    x < trackX + BAR_WIDTH;
    x += 36
  ) {
    ctx.beginPath();

    ctx.moveTo(
      x,
      trackY,
    );

    ctx.lineTo(
      x + 30,
      trackY + BAR_HEIGHT,
    );

    ctx.stroke();
  }

  ctx.globalAlpha = 1;

  const targetX = split;

  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 9;

  ctx.beginPath();

  ctx.moveTo(
    targetX,
    148,
  );

  ctx.lineTo(
    targetX,
    258,
  );

  ctx.stroke();

  ctx.strokeStyle = "#ffe05c";
  ctx.lineWidth = 5;

  ctx.beginPath();

  ctx.moveTo(
    targetX,
    148,
  );

  ctx.lineTo(
    targetX,
    258,
  );

  ctx.stroke();

  const flagX = Math.max(
    BAR_X + 6,
    Math.min(
      targetX + 5,
      IMAGE_WIDTH - 84,
    ),
  );

  // A compact folded pennant: depth and a warm gradient improve the shape
  // without making the marker larger than the supplied reference.
  ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
  ctx.strokeStyle = "transparent";
  ctx.lineWidth = 1;

  ctx.beginPath();

  ctx.moveTo(
    flagX + 3,
    151,
  );

  ctx.lineTo(
    flagX + 69,
    151,
  );

  ctx.lineTo(
    flagX + 69,
    179,
  );

  ctx.lineTo(
    flagX + 22,
    179,
  );

  ctx.lineTo(
    flagX + 11,
    166,
  );

  ctx.lineTo(
    flagX + 3,
    175,
  );

  ctx.closePath();
  ctx.fill();

  const flag =
    ctx.createLinearGradient(
      flagX,
      148,
      flagX,
      175,
    );

  flag.addColorStop(
    0,
    "#ffe276",
  );

  flag.addColorStop(
    0.55,
    "#ffd34d",
  );

  flag.addColorStop(
    1,
    "#e4a72b",
  );

  ctx.fillStyle = flag;
  ctx.strokeStyle = "#9d6f1b";
  ctx.lineWidth = 2;

  ctx.beginPath();

  ctx.moveTo(
    flagX,
    148,
  );

  ctx.lineTo(
    flagX + 66,
    148,
  );

  ctx.lineTo(
    flagX + 66,
    176,
  );

  ctx.lineTo(
    flagX + 20,
    176,
  );

  ctx.lineTo(
    flagX + 9,
    163,
  );

  ctx.lineTo(
    flagX,
    173,
  );

  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#142035";
  ctx.font = "900 16px Arial";
  ctx.textAlign = "center";

  ctx.fillText(
    String(target),
    flagX + 37,
    167,
  );

  const rollX =
    trackX +
    (roll / 100) * BAR_WIDTH;

  drawDie(
    ctx,
    Math.max(
      trackX + 22,
      Math.min(
        trackX + BAR_WIDTH - 22,
        rollX,
      ),
    ),
    trackY + BAR_HEIGHT / 2,
    Math.max(
      1,
      Math.min(
        6,
        Math.floor(roll) % 6 + 1,
      ),
    ),
  );

  ctx.fillStyle = "#8b98ad";
  ctx.font = "700 15px Arial";
  ctx.textAlign = "center";

  ctx.fillText(
    "BUST",
    IMAGE_WIDTH / 2,
    274,
  );

  ctx.font = "700 16px Arial";

  for (const tick of [
    0,
    25,
    50,
    75,
    100,
  ]) {
    const tickX =
      trackX +
      (tick / 100) * BAR_WIDTH;

    ctx.fillText(
      String(tick),
      tickX,
      300,
    );
  }

  return canvas.toBuffer(
    "image/png",
  );
}

function resultContainer(
  amount: number,
  target: number,
  direction: DiceDirection,
  roll: number,
  multiplier: number,
  payout: number,
  won: boolean,
  filename: string,
): ContainerBuilder {
  const image =
    new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL(
          `attachment://${filename}`,
        )
        .setDescription(
          "Dice roll result",
        ),
    );

  return new ContainerBuilder()
    .setAccentColor(
      won
        ? COLORS.success
        : COLORS.danger,
    )
    .addTextDisplayComponents(
      text("## 🎲 Dice"),
    )
    .addTextDisplayComponents(
      text(
        won
          ? "### ✅ You won"
          : "### ❌ Roll missed",
      ),
    )
    .addMediaGalleryComponents(
      image,
    )
    .addSeparatorComponents(
      separator(),
    )
    .addTextDisplayComponents(
      text(
        [
          `💎 **Bet**  \`${formatAmount(
            amount,
          )}\``,
          `🎯 **Roll**  \`${roll.toFixed(
            2,
          )}\` · ${direction} ${target}`,
          `✨ **Multiplier**  \`${formatMult(
            multiplier,
          )}\``,
          `💰 **Payout**  \`${formatAmount(
            payout,
          )}\``,
        ].join("\n"),
      ),
    );
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const amountStr =
    interaction.options.getString(
      "amount",
      true,
    );

  const target =
    interaction.options.getInteger(
      "target",
      true,
    );

  const direction =
    interaction.options.getString(
      "direction",
      true,
    ) as DiceDirection;

  const amount =
    parseAmount(amountStr);

  if (
    !amount ||
    amount < 1_000_000
  ) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "Minimum bet is **1M gems**. Try `1m`, `2.5b`, or `500k`.",
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });
  }

  if (
    !Number.isInteger(target) ||
    target < 10 ||
    target > 90
  ) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "Target must be a whole number from **10** to **90**.",
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  const user =
    await getOrCreateUser(
      interaction.user.id,
      interaction.user.username,
    );

  if (
    user.balance < amount
  ) {
    return void interaction.editReply({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(
            user.balance,
          )} gems**.`,
        ),
      ],
    });
  }

  const roll =
    Math.floor(
      Math.random() * 10000,
    ) / 100;

  const chance =
    direction === "over"
      ? (100 - target) / 100
      : target / 100;

  const multiplier =
    RTP / chance;

  const won =
    direction === "over"
      ? roll > target
      : roll < target;

  const payout =
    won
      ? Math.floor(
          amount * multiplier,
        )
      : 0;

  const netDelta =
    won
      ? payout - amount
      : -amount;

  await addBalance(
    interaction.user.id,
    netDelta,
  );

  await recordBet(
    interaction.user.id,
    amount,
    netDelta,
    "dice",
  );

  const filename =
    "dice-roll.png";

  const attachment =
    new AttachmentBuilder(
      drawDiceImage(
        roll,
        target,
        direction,
      ),
    ).setName(filename);

  await interaction.editReply({
    flags:
      MessageFlags.IsComponentsV2,
    components: [
      resultContainer(
        amount,
        target,
        direction,
        roll,
        multiplier,
        payout,
        won,
        filename,
      ),
    ],
    files: [
      attachment,
    ],
  });
}