import {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
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

// ─── Track visual ─────────────────────────────────────────────────────────────
function buildTrack(
  lanesCrossed: number,
  status: "active" | "cashed" | "dead",
): string {
  const parts: string[] = ["🚩"];

  for (let i = 0; i < TOTAL_LANES; i++) {
    if (i < lanesCrossed) {
      parts.push("🥚");
    } else if (i === lanesCrossed) {
      parts.push(
        status === "dead"
          ? "💥"
          : "🐔",
      );
    } else {
      parts.push("🚗");
    }
  }

  parts.push("🏆");

  return parts.join("");
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

    // ── Track ───────────────────────────────────────────────────────────────
    .addTextDisplayComponents(
      text(
        [
          status === "active"
            ? `## 🐔  Lane ${game.lanesCrossed + 1} of ${TOTAL_LANES}`
            : `## 🏁  Crossed ${game.lanesCrossed} lane${game.lanesCrossed !== 1 ? "s" : ""}`,
          "",
          buildTrack(
            game.lanesCrossed,
            status,
          ),
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