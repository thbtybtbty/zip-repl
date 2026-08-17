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

const MODULE_DIR = path.dirname(
  fileURLToPath(import.meta.url),
);

// The source runs from the workspace root in Replit, while the compiled
// WispByte bundle runs from artifacts/api-server/dist. Resolve both layouts
// without depending on the process working directory.
const COINFLIP_ASSET_CANDIDATES = [
  path.resolve(
    process.cwd(),
    "coinflip_animation_pack",
  ),
  path.resolve(
    MODULE_DIR,
    "../../../coinflip_animation_pack",
  ),
  path.resolve(
    MODULE_DIR,
    "../../../../coinflip_animation_pack",
  ),
];

function getCoinflipAssetsDir(): string {
  const assetsDir =
    COINFLIP_ASSET_CANDIDATES.find(
      (candidate) =>
        fs.existsSync(candidate),
    );

  if (!assetsDir) {
    throw new Error(
      [
        "Coinflip assets folder does not exist.",
        "Checked:",
        ...COINFLIP_ASSET_CANDIDATES,
      ].join(" "),
    );
  }

  return assetsDir;
}

// How long Discord is allowed to play the GIF
// before the final result panel appears.
const ANIMATION_MS = 2600;

// ─── Animation history ───────────────────────────────────────────────────────
//
// Prevents the exact same animation from being selected
// twice in a row for the same result.
//
// Example:
//
// Game 1 → heads_04
// Game 2 → heads_11
// Game 3 → heads_02
//
// The history resets if the bot restarts.

const lastAnimation: Record<
  CoinSide,
  string | null
> = {
  heads: null,
  tails: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function text(
  content: string,
): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(
    content,
  );
}

/**
 * Gets all available animations for a result.
 *
 * heads → coinflip_heads_01.gif ... coinflip_heads_12.gif
 * tails → coinflip_tails_01.gif ... coinflip_tails_12.gif
 */
function getCoinflipAnimations(
  result: CoinSide,
): string[] {
  const assetsDir =
    getCoinflipAssetsDir();

  const prefix =
    `coinflip_${result}_`;

  const files =
    fs.readdirSync(
      assetsDir,
    );

  return files
    .filter(
      (file) =>
        file.startsWith(prefix) &&
        file.toLowerCase().endsWith(".gif"),
    )
    .sort();
}

/**
 * Picks a random animation.
 *
 * It avoids immediately using the same animation twice
 * for the same result.
 */
function getRandomCoinflipGif(
  result: CoinSide,
): string {
  const animations =
    getCoinflipAnimations(result);

  if (animations.length === 0) {
    throw new Error(
      `No coinflip animations found for ${result}. ` +
      `Expected files like coinflip_${result}_01.gif`,
    );
  }

  let available =
    animations.filter(
      (file) =>
        file !== lastAnimation[result],
    );

  // Safety fallback.
  if (available.length === 0) {
    available = animations;
  }

  const selected =
    available[
      Math.floor(
        Math.random() *
          available.length,
      )
    ]!;

  lastAnimation[result] =
    selected;

  return selected;
}

// ─── Animation Container ─────────────────────────────────────────────────────

function coinflipAnimationContainer(
  amount: number,
  choice: CoinSide,
  gifFilename: string,
): ContainerBuilder {
  const coinImage =
    new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL(
          `attachment://${gifFilename}`,
        )
        .setDescription(
          "Coin flipping",
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

async function animateCoinflip(
  interaction: ChatInputCommandInteraction,
  amount: number,
  choice: CoinSide,
  gifFilename: string,
): Promise<void> {
  const assetsDir =
    getCoinflipAssetsDir();
  const gifPath =
    path.join(
      assetsDir,
      gifFilename,
    );

  // Verify the file exists before sending.
  if (!fs.existsSync(gifPath)) {
    throw new Error(
      `Coinflip GIF not found: ${gifPath}`,
    );
  }

  const attachment =
    new AttachmentBuilder(
      gifPath,
    ).setName(
      gifFilename,
    );

  /*
   * Send the animated GIF once.
   *
   * We DON'T edit the Discord message repeatedly.
   * Discord itself plays the GIF, which makes the
   * animation much smoother.
   */
  try {
    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,

      components: [
        coinflipAnimationContainer(
          amount,
          choice,
          gifFilename,
        ),
      ],

      files: [
        attachment,
      ],
    });
  } catch {
    // The final result is retried below. A transient first edit should not
    // turn a settled wager into an unhandled command failure.
  }

  /*
   * Give the GIF time to finish.
   */
  await new Promise<void>(
    (resolve) =>
      setTimeout(
        resolve,
        ANIMATION_MS,
      ),
  );
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
  const gifFilename =
    getRandomCoinflipGif(result);

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
    gifFilename,
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