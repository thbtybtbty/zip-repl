import {
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  type Message,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";

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
type TileType = "diamond" | "bomb";

interface LevelRecord {
  picked: number;
  result: "safe" | "bomb";
  row: TileType[];
}

export interface TowersGame {
  userId: string;
  bet: number;
  difficulty: Difficulty;
  level: number;
  maxLevels: number;
  multiplier: number;
  row: TileType[];
  grid: TileType[][];
  history: LevelRecord[];
  messageId: string;
  channelId: string;
}

export const activeTowersGames = new Map<string, TowersGame>();

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_LEVELS = 8;

const LEVEL_MULT: Record<Difficulty, number> = {
  easy: 1.39,
  medium: 1.85,
  hard: 2.775,
};

// ─── Row generation ───────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [a[i], a[j]] = [a[j]!, a[i]!];
  }

  return a;
}

function generateRow(
  difficulty: Difficulty,
): TileType[] {
  if (difficulty === "easy") {
    return shuffle([
      "diamond",
      "diamond",
      "bomb",
    ] as TileType[]);
  }

  if (difficulty === "medium") {
    return shuffle([
      "diamond",
      "bomb",
    ] as TileType[]);
  }

  return shuffle([
    "diamond",
    "bomb",
    "bomb",
  ] as TileType[]);
}

// ─── Tower visual ─────────────────────────────────────────────────────────────

function tileEmoji(
  type: TileType,
  picked: boolean,
  exploded = false,
): string {
  if (
    exploded &&
    type === "bomb"
  ) {
    return "💥";
  }

  if (type === "diamond") {
    return "💎";
  }

  return "💣";
}

function buildTowerVisual(
  game: TowersGame,
  status:
    | "active"
    | "won"
    | "lost"
    | "cashed",
): string {
  const isMedium =
    game.difficulty === "medium";

  const colCount =
    isMedium ? 2 : 3;

  const showFullGrid =
    status !== "active";

  const lines: string[] = [];

  for (
    let lvl = game.maxLevels;
    lvl >= 1;
    lvl--
  ) {
    const idx = lvl - 1;

    const isCurrent =
      idx === game.level;

    const isFuture =
      idx > game.level;

    let tileStr: string;

    if (
      isFuture &&
      !showFullGrid
    ) {
      tileStr = Array(
        colCount,
      )
        .fill("❓")
        .join("  ");
    } else if (
      isCurrent &&
      status !== "lost"
    ) {
      if (showFullGrid) {
        tileStr = (
          game.grid[idx] ??
          game.row
        )
          .map((tile) =>
            tileEmoji(
              tile,
              false,
            ),
          )
          .join("  ");
      } else {
        tileStr = Array(
          colCount,
        )
          .fill("🟦")
          .join("  ");
      }
    } else {
      const record =
        game.history[idx];

      if (!record) {
        tileStr = showFullGrid
          ? (
              game.grid[idx] ??
              []
            )
              .map((tile) =>
                tileEmoji(
                  tile,
                  false,
                ),
              )
              .join("  ")
          : Array(
              colCount,
            )
              .fill("▫️")
              .join("  ");
      } else {
        const isLostLevel =
          status === "lost" &&
          isCurrent;

        const cells =
          record.row.map(
            (tile, c) => {
              const picked =
                c ===
                record.picked;

              const exploded =
                isLostLevel &&
                picked &&
                tile === "bomb";

              return tileEmoji(
                tile,
                picked,
                exploded,
              );
            },
          );

        tileStr =
          cells.join("  ");
      }
    }

    /*
     * IMPORTANT:
     * Keep the prefix exactly the same width on every row.
     * This prevents Lv 8 from visually shifting left/right.
     */
    const prefix =
      isCurrent &&
      status !== "lost"
        ? "▶ "
        : "   ";

    /*
     * No leading zeroes:
     * Lv 1
     * Lv 2
     * ...
     * Lv 8
     */
    const label =
      `Lv ${lvl}`;

    lines.push(
      `${prefix}\`${label}\`  ${tileStr}`,
    );
  }

  return lines.join("\n");
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

function text(
  content: string,
): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(
    content,
  );
}

function realDivider(): SeparatorBuilder {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(
      SeparatorSpacingSize.Small,
    );
}

// ─── Main buttons ─────────────────────────────────────────────────────────────

function buildTowersChoiceRow(
  game: TowersGame,
  disabled: boolean,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const isMedium =
    game.difficulty === "medium";

  const row =
    new ActionRowBuilder<MessageActionRowComponentBuilder>();

  if (isMedium) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId("towers_l")
        .setLabel("⬅  Left")
        .setStyle(
          ButtonStyle.Primary,
        )
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId("towers_r")
        .setLabel("Right  ➡")
        .setStyle(
          ButtonStyle.Primary,
        )
        .setDisabled(disabled),
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId("towers_l")
        .setLabel("⬅  Left")
        .setStyle(
          ButtonStyle.Primary,
        )
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId("towers_m")
        .setLabel("⬆  Mid")
        .setStyle(
          ButtonStyle.Primary,
        )
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId("towers_r")
        .setLabel("Right  ➡")
        .setStyle(
          ButtonStyle.Primary,
        )
        .setDisabled(disabled),
    );
  }

  return row;
}

function buildCashoutRow(
  game: TowersGame,
  disabled: boolean,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        "towers_cash",
      )
      .setLabel("💸  Cash Out")
      .setStyle(
        ButtonStyle.Success,
      )
      .setDisabled(
        disabled ||
          game.multiplier <=
            1.0,
      ),
  );
}

function buildPlayAgainRow(
  game: TowersGame,
  disabled = false,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `pa_towers_${game.userId}_${game.difficulty}_${game.bet}`,
      )
      .setLabel(
        "🔄  Play Again",
      )
      .setStyle(
        ButtonStyle.Secondary,
      )
      .setDisabled(
        disabled,
      ),
  );
}

// ─── Main Towers container ────────────────────────────────────────────────────

export function buildTowersContainer(
  game: TowersGame,
  status:
    | "active"
    | "won"
    | "lost"
    | "cashed",
  playAgainDisabled = false,
): ContainerBuilder {
  const currentWin =
    Math.floor(
      game.bet *
        game.multiplier,
    );

  const nextMult =
    game.multiplier *
    LEVEL_MULT[
      game.difficulty
    ];

  const nextWin =
    Math.floor(
      game.bet *
        nextMult,
    );

  const colors: Record<
    string,
    number
  > = {
    active:
      COLORS.primary,

    won:
      COLORS.success,

    cashed:
      COLORS.success,

    lost:
      COLORS.danger,
  };

  const diffName: Record<
    Difficulty,
    string
  > = {
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
  };

  const titles: Record<
    string,
    string
  > = {
    active:
      `## 🗼 Towers ${diffName[game.difficulty]} - Level ${game.level + 1} / ${game.maxLevels}`,

    won:
      `## 🗼 Towers ${diffName[game.difficulty]} - Cleared! 🏆`,

    lost:
      `## 🗼 Towers ${diffName[game.difficulty]} - Bomb Hit! 💥`,

    cashed:
      `## 🗼 Towers ${diffName[game.difficulty]} - Cashed Out!`,
  };

  /*
   * Active:
   * Bet
   * Potential
   * Next gem
   *
   * Finished:
   * Bet
   * Payout
   *
   * Lost:
   * Bet
   * No payout line
   */
  const stats: string[] = [
    `💎 **Bet**         \`${formatAmount(game.bet)}\``,
  ];

  if (
    status === "won" ||
    status === "cashed"
  ) {
    const payoutMultiplier =
      formatMult(
        game.multiplier,
      );

    stats.push(
      `💰 **Payout**      \`${formatAmount(currentWin)} (${payoutMultiplier})\``,
    );
  } else if (
    status === "active"
  ) {
    stats.push(
      `💰 **Potential**   \`${formatAmount(currentWin)} (${formatMult(game.multiplier)})\``,
    );

    stats.push(
      `⭐ **Next gem**   \`${formatAmount(nextWin)} (${formatMult(nextMult)})\``,
    );
  }

  const container =
    new ContainerBuilder()
      .setAccentColor(
        colors[status] ??
          COLORS.primary,
      )

      // ─── Header ─────────────────────────────────────────────
      .addTextDisplayComponents(
        text(
          titles[status] ??
            "## 🗼 Towers",
        ),
      )

      // ─── Stats ─────────────────────────────────────────────
      .addTextDisplayComponents(
        text(
          stats.join("\n"),
        ),
      )

      /*
       * REAL DISCORD DIVIDER.
       *
       * It is always present:
       * - active
       * - won
       * - lost
       * - cashed
       *
       * It is the only divider in the game panel.
       */
      .addSeparatorComponents(
        realDivider(),
      )

      // ─── Tower grid ─────────────────────────────────────────
      .addTextDisplayComponents(
        text(
          buildTowerVisual(
            game,
            status,
          ),
        ),
      );

  /*
   * Cash-out result:
   *
   * > Cashed out at 1.39x after 1 level.
   *
   * No separator is added after this.
   */
  if (status === "cashed") {
    container.addTextDisplayComponents(
      text(
        `> Cashed out at ${formatMult(game.multiplier)} after ${game.level} ${game.level === 1 ? "level" : "levels"}.`,
      ),
    );
  }

  /*
   * Buttons are INSIDE the same container.
   *
   * There is deliberately NO separator between:
   * grid → buttons
   *
   * and no separator between:
   * cash-out quote → Play Again
   */
  if (status === "active") {
    container
      .addActionRowComponents(
        buildTowersChoiceRow(
          game,
          false,
        ),
      )
      .addActionRowComponents(
        buildCashoutRow(
          game,
          false,
        ),
      );
  } else {
    container.addActionRowComponents(
      buildPlayAgainRow(
        game,
        playAgainDisabled,
      ),
    );
  }

  return container;
}

// ─── Command ──────────────────────────────────────────────────────────────────

export const data =
  new SlashCommandBuilder()
    .setName("towers")
    .setDescription(
      "Play the Towers game",
    )
    .addStringOption(
      (opt) =>
        opt
          .setName("amount")
          .setDescription(
            "Bet amount (e.g. 1m, 2.5b)",
          )
          .setRequired(true),
    )
    .addStringOption(
      (opt) =>
        opt
          .setName("difficulty")
          .setDescription(
            "Game difficulty",
          )
          .setRequired(true)
          .addChoices(
            {
              name: "🟢 Easy — 2 diamonds, 1 bomb",
              value: "easy",
            },
            {
              name: "🟡 Medium — 1 diamond, 1 bomb",
              value: "medium",
            },
            {
              name: "🔴 Hard — 1 diamond, 2 bombs",
              value: "hard",
            },
          ),
    );

export async function execute(
  interaction: ChatInputCommandInteraction,
) {
  const amountStr =
    interaction.options.getString(
      "amount",
      true,
    );

  const difficulty =
    interaction.options.getString(
      "difficulty",
      true,
    ) as Difficulty;

  const amount =
    parseAmount(
      amountStr,
    );

  if (
    !amount ||
    amount < 1_000_000
  ) {
    return interaction.reply({
      embeds: [
        errorEmbed(
          "Minimum bet is **1m gems**. Try `1m`, `2.5b`, `500k`.",
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  if (
    activeTowersGames.has(
      interaction.user.id,
    )
  ) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          "You already have an active Towers game!",
        ),
      ],
    });
  }

  const user =
    await getOrCreateUser(
      interaction.user.id,
      interaction.user.username,
    );

  if (
    user.balance < amount
  ) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(
            user.balance,
          )} gems**.`,
        ),
      ],
    });
  }

  await addBalance(
    interaction.user.id,
    -amount,
  );

  const game: TowersGame = {
    userId:
      interaction.user.id,

    bet: amount,

    difficulty,

    level: 0,

    maxLevels:
      MAX_LEVELS,

    multiplier: 1.0,

    row:
      generateRow(
        difficulty,
      ),

    grid: Array.from(
      {
        length:
          MAX_LEVELS,
      },
      () =>
        generateRow(
          difficulty,
        ),
    ),

    history: [],

    messageId: "",

    channelId:
      interaction.channelId,
  };

  game.row =
    game.grid[0]!;

  const msg =
    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,

      components: [
        buildTowersContainer(
          game,
          "active",
        ),
      ],
    });

  game.messageId =
    msg.id;

  activeTowersGames.set(
    interaction.user.id,
    game,
  );
}

// ─── Button handlers ──────────────────────────────────────────────────────────

type TowerChoice =
  | "l"
  | "m"
  | "r";

const CHOICE_INDEX: Record<
  TowerChoice,
  number
> = {
  l: 0,
  m: 1,
  r: 2,
};

export async function handleChoice(
  interaction: ButtonInteraction,
  choice: TowerChoice,
) {
  await interaction.deferUpdate();

  const game =
    activeTowersGames.get(
      interaction.user.id,
    );

  if (!game) {
    await interaction.followUp({
      embeds: [
        errorEmbed(
          "No active Towers game.",
        ),
      ],
      ephemeral: true,
    });

    return;
  }

  let colIndex =
    CHOICE_INDEX[choice];

  if (
    game.difficulty ===
      "medium" &&
    choice === "r"
  ) {
    colIndex = 1;
  }

  const tile =
    game.row[colIndex] ??
    "bomb";

  game.history.push({
    picked: colIndex,

    result:
      tile === "diamond"
        ? "safe"
        : "bomb",

    row: game.row,
  });

  // ─── Bomb ──────────────────────────────────────────────────

  if (
    tile === "bomb"
  ) {
    activeTowersGames.delete(
      interaction.user.id,
    );

    await recordBet(
      interaction.user.id,
      game.bet,
      -game.bet,
      `towers-${game.difficulty}`,
    );

    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,

      components: [
        buildTowersContainer(
          game,
          "lost",
        ),
      ],
    });

    return;
  }

  // ─── Safe ──────────────────────────────────────────────────

  game.multiplier *=
    LEVEL_MULT[
      game.difficulty
    ];

  game.level++;

  // ─── Won ───────────────────────────────────────────────────

  if (
    game.level >=
    game.maxLevels
  ) {
    activeTowersGames.delete(
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
      `towers-${game.difficulty}`,
      game.multiplier,
    );

    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,

      components: [
        buildTowersContainer(
          game,
          "won",
        ),
      ],
    });

    return;
  }

  game.row =
    game.grid[
      game.level
    ]!;

  await interaction.editReply({
    flags:
      MessageFlags.IsComponentsV2,

    components: [
      buildTowersContainer(
        game,
        "active",
      ),
    ],
  });
}

// ─── Cash Out ─────────────────────────────────────────────────────────────────

export async function handleCashout(
  interaction: ButtonInteraction,
) {
  await interaction.deferUpdate();

  const game =
    activeTowersGames.get(
      interaction.user.id,
    );

  if (!game) {
    await interaction.followUp({
      embeds: [
        errorEmbed(
          "No active Towers game.",
        ),
      ],
      ephemeral: true,
    });

    return;
  }

  if (
    game.multiplier <=
    1.0
  ) {
    await interaction.followUp({
      embeds: [
        errorEmbed(
          "Complete at least one level before cashing out!",
        ),
      ],
      ephemeral: true,
    });

    return;
  }

  activeTowersGames.delete(
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
    `towers-${game.difficulty}`,
    game.multiplier,
  );

  await interaction.editReply({
    flags:
      MessageFlags.IsComponentsV2,

    components: [
      buildTowersContainer(
        game,
        "cashed",
      ),
    ],
  });
}

// ─── Button: Play Again ───────────────────────────────────────────────────────

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
        "❌ This isn't your game.",

      flags:
        MessageFlags.Ephemeral,
    });
  }

  if (
    activeTowersGames.has(
      userId,
    )
  ) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "You already have an active Towers game!",
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

  const diff =
    difficulty as Difficulty;

  /*
   * FIRST:
   * Keep the previous game exactly as it was,
   * except disable its Play Again button.
   *
   * We do NOT replace the old message with
   * a button-only message.
   */
  await interaction.deferUpdate();

  /*
   * We need the finished game state from the
   * current message. Since this handler is only
   * called on finished games, rebuild the visual
   * from the message's existing displayed state.
   *
   * The message's button custom ID tells us the
   * original bet/difficulty, while the actual
   * game state is not stored globally after the
   * game ends. Therefore, preserve the existing
   * message visually by only changing its button.
   *
   * Components V2 does not allow mixing the old
   * component tree with a normal ActionRow, so
   * obtain the current message and replace only
   * the Play Again button inside the container.
   */
  const oldContainer =
    interaction.message.components[0];

  /*
   * Rebuild the old message from its current
   * components where possible.
   *
   * Most importantly, do not blank the old game.
   */
  if (
    oldContainer &&
    "components" in
      oldContainer
  ) {
    const components =
      oldContainer.components.map(
        (component) => {
          return component;
        },
      );

    /*
     * Edit only the final action row.
     * This preserves the complete previous panel.
     */
    const rebuilt =
      new ContainerBuilder(
        oldContainer.toJSON(),
      );

    const lastIndex =
      rebuilt.components.length -
      1;

    const last =
      rebuilt.components[
        lastIndex
      ];

    if (
      last &&
      last.type === 1
    ) {
      const disabledRow =
        new ActionRowBuilder<MessageActionRowComponentBuilder>();

      for (
        const component of
          last.components
      ) {
        if (
          component.type ===
          2
        ) {
          const disabledButton =
            new ButtonBuilder(
              component,
            ).setDisabled(
              true,
            );

          disabledRow.addComponents(
            disabledButton,
          );
        }
      }

      rebuilt.spliceComponents(
        lastIndex,
        1,
        disabledRow,
      );
    }

    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,

      components: [
        rebuilt,
      ],
    });
  }

  // ─── Check balance ──────────────────────────────────────────

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
          `Insufficient balance. You have **${formatAmount(
            user.balance,
          )} gems**.`,
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

  // ─── New game ───────────────────────────────────────────────

  const game: TowersGame = {
    userId,

    bet,

    difficulty: diff,

    level: 0,

    maxLevels:
      MAX_LEVELS,

    multiplier: 1.0,

    row:
      generateRow(diff),

    grid: Array.from(
      {
        length:
          MAX_LEVELS,
      },
      () =>
        generateRow(diff),
    ),

    history: [],

    messageId: "",

    channelId:
      interaction.channelId,
  };

  game.row =
    game.grid[0]!;

  /*
   * NEW MESSAGE.
   *
   * The previous game remains above it with
   * its Play Again button disabled.
   */
  const msg: Message =
    await interaction.followUp({
      flags:
        MessageFlags.IsComponentsV2,

      components: [
        buildTowersContainer(
          game,
          "active",
        ),
      ],
    });

  game.messageId =
    msg.id;

  activeTowersGames.set(
    userId,
    game,
  );
}