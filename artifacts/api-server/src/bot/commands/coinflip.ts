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
  loadImage,
  type Image,
} from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COLORS,
  parseAmount,
  formatAmount,
  getOrCreateUser,
  addBalance,
  recordBet,
  errorEmbed,
} from "../utils.js";

// ─── Command ──────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("coinflip")
  .setDescription("Flip a coin — double or nothing!")
  .addStringOption((opt) =>
    opt
      .setName("amount")
      .setDescription("Bet amount (e.g. 1m, 2.5b)")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("choice")
      .setDescription("Heads or tails?")
      .setRequired(true)
      .addChoices(
        { name: "🪙 Heads", value: "heads" },
        { name: "🔵 Tails", value: "tails" },
      ),
  );

// ─── Constants ───────────────────────────────────────────────────────────────

const SIDES = ["heads", "tails"] as const;
type CoinSide = (typeof SIDES)[number];

const SIDE_DISPLAY: Record<CoinSide, string> = {
  heads: "🪙 Heads",
  tails: "🔵 Tails",
};

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

// The source runs from the workspace root in Replit, while the compiled
// WispByte bundle runs from artifacts/api-server/dist. Resolve both layouts
// without depending on the process working directory.
const COINFLIP_FACE_ASSET_CANDIDATES = [
  path.resolve(
    process.cwd(),
    "coinflip_face_assets",
  ),
  path.resolve(
    MODULE_DIR,
    "../../../coinflip_face_assets",
  ),
  path.resolve(
    MODULE_DIR,
    "../../../../coinflip_face_assets",
  ),
];

function getCoinflipFaceAssetsDir(): string {
  const assetsDir =
    COINFLIP_FACE_ASSET_CANDIDATES.find(
      (candidate) =>
        fs.existsSync(candidate),
    );

  if (!assetsDir) {
    throw new Error(
      [
        "Coinflip face assets folder does not exist.",
        "Checked:",
        ...COINFLIP_FACE_ASSET_CANDIDATES,
      ].join(" "),
    );
  }

  return assetsDir;
}

const COINFLIP_FRAME_MS = 240;
const COINFLIP_FRAME_SCALES = [
  1,
  0.74,
  0.48,
  0.24,
  0.09,
  0.24,
  0.48,
  0.74,
  1,
];
const COINFLIP_CANVAS_SIZE = 520;
const COINFLIP_RADIUS = 174;
const COINFLIP_EDGE_HEIGHT = 24;

type CoinFaceImages = Record<CoinSide, Image>;

let coinFaceImagesPromise:
  | Promise<CoinFaceImages>
  | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function text(
  content: string,
): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(
    content,
  );
}

async function getCoinflipFaceImages(): Promise<CoinFaceImages> {
  if (!coinFaceImagesPromise) {
    coinFaceImagesPromise =
      (async () => {
        const assetsDir =
          getCoinflipFaceAssetsDir();

        return {
          heads: await loadImage(
            path.join(
              assetsDir,
              "coinflip_heads.jpeg",
            ),
          ),
          tails: await loadImage(
            path.join(
              assetsDir,
              "coinflip_tails.jpeg",
            ),
          ),
        };
      })();
  }

  try {
    return await coinFaceImagesPromise;
  } catch (error) {
    coinFaceImagesPromise = null;
    throw error;
  }
}

// ─── Animation Container ─────────────────────────────────────────────────────

function coinflipAnimationContainer(
  amount: number,
  choice: CoinSide,
  imageFilename: string,
): ContainerBuilder {
  const coinImage =
    new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL(
          `attachment://${imageFilename}`,
        )
        .setDescription(
          "Coin flipping vertically",
        ),
    );

  return new ContainerBuilder()
    .setAccentColor(
      COLORS.primary,
    )

    // Title
    .addTextDisplayComponents(
      text(
        "## 🪙  Coin Flip",
      ),
    )

    // Bet
    .addTextDisplayComponents(
      text(
        `💎 **Bet**  \`${formatAmount(
          amount,
        )}\``,
      ),
    )

    .addSeparatorComponents(
      new SeparatorBuilder(),
    )

    // Animated coin
    .addMediaGalleryComponents(
      coinImage,
    )

    .addSeparatorComponents(
      new SeparatorBuilder(),
    )

    // Pick only.
    // The old fake "Result" animation text is removed.
    .addTextDisplayComponents(
      text(
        `🎯 **Your pick**  \`${SIDE_DISPLAY[
          choice
        ]}\``,
      ),
    );
}

// ─── Final Result Container ──────────────────────────────────────────────────

function coinflipResultContainer(
  amount: number,
  choice: CoinSide,
  result: CoinSide,
  won: boolean,
): ContainerBuilder {
  const container =
    new ContainerBuilder()
      .setAccentColor(
        won
          ? COLORS.success
          : COLORS.danger,
      )

      .addTextDisplayComponents(
        text(
          won
            ? "## 🪙  Coin Flip — You Win!"
            : "## 🪙  Coin Flip — You Lose!",
        ),
      );

  // Bet + payout
  const statsLines = [
    `💎 **Bet**  \`${formatAmount(
      amount,
    )}\``,
    ...(won
      ? [
          `💰 **Payout**  \`${formatAmount(
            amount * 2,
          )} (2.00x)\``,
        ]
      : []),
  ];

  container.addTextDisplayComponents(
    text(
      statsLines.join("\n"),
    ),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder(),
  );

  // Final pick + actual result
  container.addTextDisplayComponents(
    text(
      [
        `🎯 **Your pick**  \`${SIDE_DISPLAY[
          choice
        ]}\``,
        `🪙 **Result**     \`${SIDE_DISPLAY[
          result
        ]}\``,
      ].join("\n"),
    ),
  );

  return container;
}

// ─── Animation ────────────────────────────────────────────────────────────────

function oppositeSide(
  side: CoinSide,
): CoinSide {
  return side === "heads"
    ? "tails"
    : "heads";
}

function drawCoinFace(
  ctx: ReturnType<
    ReturnType<typeof createCanvas>["getContext"]
  >,
  image: Image,
  scaleY: number,
  side: CoinSide,
): void {
  const center =
    COINFLIP_CANVAS_SIZE / 2;
  const faceHeight =
    COINFLIP_RADIUS * 2 * scaleY;
  const edgeColor =
    side === "heads"
      ? "#087344"
      : "#2455ad";

  // The visible rim remains in place while the face compresses around the
  // horizontal axis, creating thickness without any left/right movement.
  ctx.save();
  ctx.fillStyle = edgeColor;
  ctx.strokeStyle = "#081225";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.ellipse(
    center,
    center +
      Math.max(
        3,
        faceHeight / 2,
      ) +
      COINFLIP_EDGE_HEIGHT / 2,
    COINFLIP_RADIUS,
    COINFLIP_EDGE_HEIGHT / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  if (faceHeight <= 1) {
    return;
  }

  // Clip the reference artwork to the coin outline so its dark square
  // background never appears as the coin flips edge-on.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(
    center,
    center,
    COINFLIP_RADIUS,
    faceHeight / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.clip();
  ctx.drawImage(
    image,
    center - COINFLIP_RADIUS,
    center - faceHeight / 2,
    COINFLIP_RADIUS * 2,
    faceHeight,
  );
  ctx.restore();

  ctx.save();
  ctx.strokeStyle =
    side === "heads"
      ? "rgba(118, 255, 181, 0.66)"
      : "rgba(150, 198, 255, 0.68)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(
    center,
    center,
    COINFLIP_RADIUS - 2,
    Math.max(
      1,
      faceHeight / 2 - 2,
    ),
    0,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
  ctx.restore();
}

function coinflipFrame(
  image: Image,
  side: CoinSide,
  scaleY: number,
): Buffer {
  const canvas =
    createCanvas(
      COINFLIP_CANVAS_SIZE,
      COINFLIP_CANVAS_SIZE,
    );
  const ctx =
    canvas.getContext("2d");

  // Match the deep navy from the supplied reference images.
  ctx.fillStyle = "#11192d";
  ctx.fillRect(
    0,
    0,
    COINFLIP_CANVAS_SIZE,
    COINFLIP_CANVAS_SIZE,
  );

  drawCoinFace(
    ctx,
    image,
    scaleY,
    side,
  );

  return canvas.toBuffer("image/png");
}

async function animateCoinflip(
  interaction: ChatInputCommandInteraction,
  amount: number,
  choice: CoinSide,
  result: CoinSide,
): Promise<void> {
  const images =
    await getCoinflipFaceImages();
  const opposite =
    oppositeSide(choice);
  const transitions =
    result === choice
      ? [choice, opposite, result]
      : [choice, result];
  const imageFilename =
    "coinflip-frame.png";

  for (
    let transition = 0;
    transition < transitions.length - 1;
    transition++
  ) {
    const from =
      transitions[transition]!;
    const to =
      transitions[transition + 1]!;

    for (
      let frame = 0;
      frame < COINFLIP_FRAME_SCALES.length;
      frame++
    ) {
      const scaleY =
        COINFLIP_FRAME_SCALES[frame]!;
      const side =
        frame <
          COINFLIP_FRAME_SCALES.length / 2
          ? from
          : to;
      const attachment =
        new AttachmentBuilder(
          coinflipFrame(
            images[side],
            side,
            scaleY,
          ),
        ).setName(
          imageFilename,
        );

      try {
        await interaction.editReply({
          flags:
            MessageFlags.IsComponentsV2,
          components: [
            coinflipAnimationContainer(
              amount,
              choice,
              imageFilename,
            ),
          ],
          files: [
            attachment,
          ],
        });
      } catch {
        // Intermediate animation frames are best-effort. The settled result
        // is retried separately after the animation completes.
      }

      await new Promise<void>(
        (resolve) =>
          setTimeout(
            resolve,
            COINFLIP_FRAME_MS,
          ),
      );
    }
  }
}

// ─── Command Execute ─────────────────────────────────────────────────────────

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const amountStr =
    interaction.options.getString(
      "amount",
      true,
    );

  const choice =
    interaction.options.getString(
      "choice",
      true,
    ) as CoinSide;

  const amount =
    parseAmount(
      amountStr,
    );

  // ─── Minimum bet ───────────────────────────────────────────────────────────

  if (
    !amount ||
    amount < 1_000_000
  ) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "Minimum bet is **1M gems**. Try `1m`, `2.5b`, `500k`.",
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  // ─── User ──────────────────────────────────────────────────────────────────

  const user =
    await getOrCreateUser(
      interaction.user.id,
      interaction.user.username,
    );

  // ─── Balance check ─────────────────────────────────────────────────────────

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

  // ─── ORIGINAL GAME LOGIC ───────────────────────────────────────────────────
  //
  // P(win) = 0.4625
  // House edge = 7.5%

  const won =
    Math.random() < 0.4625;

  const result =
    (
      won
        ? choice
        : choice === "heads"
          ? "tails"
          : "heads"
    ) as CoinSide;

  // Resolve the animation before charging the player. Missing deployment
  // assets must never leave a wager debited without a playable result.
  try {
    await getCoinflipFaceImages();
  } catch (error) {
    console.error(
      "[coinflip] Face assets unavailable",
      error,
    );
    return void interaction.editReply({
      embeds: [
        errorEmbed(
          "Coinflip is temporarily unavailable because its face images could not be loaded.",
        ),
      ],
    });
  }

  const payout =
    won
      ? amount
      : -amount;

  // ─── Balance ───────────────────────────────────────────────────────────────

  await addBalance(
    interaction.user.id,
    payout,
  );

  // ─── Record bet ────────────────────────────────────────────────────────────

  await recordBet(
    interaction.user.id,
    amount,
    payout,
    "coinflip",
  );

  // ─── Animated coin ─────────────────────────────────────────────────────────

  await animateCoinflip(
    interaction,
    amount,
    choice,
    result,
  );

  // ─── Final result ──────────────────────────────────────────────────────────

  const finalPayload = {
    flags:
      MessageFlags.IsComponentsV2,
    components: [
      coinflipResultContainer(
        amount,
        choice,
        result,
        won,
      ),
    ],
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await interaction.editReply(
        finalPayload,
      );
      break;
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }

      await new Promise<void>(
        (resolve) =>
          setTimeout(
            resolve,
            180 * (attempt + 1),
          ),
      );
    }
  }
}