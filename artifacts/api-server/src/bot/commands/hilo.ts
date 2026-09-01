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

// ─── Cards ─────────────────────────────────────────────────────────────────────

const RANKS = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
] as const;

const SUITS = [
  { name: "Spades", symbol: "♠" },
  { name: "Hearts", symbol: "♥" },
  { name: "Diamonds", symbol: "♦" },
  { name: "Clubs", symbol: "♣" },
] as const;

export type HiloDirection = "higher" | "lower";

export interface HiloCard {
  rank: string;
  rankValue: number;
  suit: string;
  suitSymbol: string;
  glyph: string;
}

export interface HiloGame {
  userId: string;
  bet: number;
  deck: HiloCard[];
  currentCard: HiloCard;
  multiplier: number;
  correctGuesses: number;
}

export const activeHiloGames = new Map<string, HiloGame>();

// ─── Card helpers ──────────────────────────────────────────────────────────────

function unicodeCard(rankValue: number, suitOffset: number): string {
  const unicodeRank =
    rankValue === 14
      ? 1
      : rankValue === 12
        ? 13
        : rankValue;

  return String.fromCodePoint(
    0x1f0a0 + suitOffset + unicodeRank,
  );
}

export function buildHiloDeck(): HiloCard[] {
  return SUITS.flatMap((suit, suitIndex) =>
    RANKS.map((rank, index) => ({
      rank,
      rankValue: index + 2,
      suit: suit.name,
      suitSymbol: suit.symbol,
      glyph: unicodeCard(
        index + 2,
        suitIndex * 0x10,
      ),
    })),
  );
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(
      Math.random() * (i + 1),
    );

    [items[i], items[j]] = [
      items[j]!,
      items[i]!,
    ];
  }

  return items;
}

// Only display rank + suit symbol.
// No Unicode playing-card emoji.
function cardLabel(card: HiloCard): string {
  return `${card.rank}${card.suitSymbol}`;
}

// ─── Probability / multiplier ─────────────────────────────────────────────────

function cardCount(
  game: HiloGame,
  direction: HiloDirection,
): number {
  return game.deck.filter((card) =>
    direction === "higher"
      ? card.rankValue >
        game.currentCard.rankValue
      : card.rankValue <
        game.currentCard.rankValue,
  ).length;
}

function chance(
  game: HiloGame,
  direction: HiloDirection,
): number {
  if (game.deck.length === 0) return 0;

  return (
    cardCount(game, direction) /
    game.deck.length
  );
}

export function nextMultiplier(
  game: HiloGame,
  direction: HiloDirection,
): number {
  const probability = chance(
    game,
    direction,
  );

  if (probability <= 0) return 0;

  return (
    game.multiplier *
    (0.9 / probability)
  );
}

function formatChance(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// ─── Components V2 helpers ────────────────────────────────────────────────────

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

// ─── Game buttons ──────────────────────────────────────────────────────────────

function gameButtons(
  game: HiloGame,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const higher = new ButtonBuilder()
    .setCustomId(
      `hilo_higher_${game.userId}`,
    )
    .setLabel("Higher")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(
      cardCount(game, "higher") === 0,
    );

  const lower = new ButtonBuilder()
    .setCustomId(
      `hilo_lower_${game.userId}`,
    )
    .setLabel("Lower")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(
      cardCount(game, "lower") === 0,
    );

  const cashout = new ButtonBuilder()
    .setCustomId(
      `hilo_cashout_${game.userId}`,
    )
    .setLabel("Cashout")
    .setStyle(ButtonStyle.Success)
    .setDisabled(
      game.correctGuesses === 0,
    );

  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    higher,
    lower,
    cashout,
  );
}

function playAgainRow(
  userId: string,
  bet: number,
  disabled = false,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `pa_hilo_${userId}_${bet}`,
      )
      .setLabel("🔄  Play Again")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

// ─── Active game panel ─────────────────────────────────────────────────────────

function buildActiveComponents(
  game: HiloGame,
): ContainerBuilder[] {
  const higher = chance(
    game,
    "higher",
  );

  const lower = chance(
    game,
    "lower",
  );

  const potential = Math.floor(
    game.bet *
      game.multiplier,
  );

  const panel = new ContainerBuilder()
    .setAccentColor(
      COLORS.primary,
    )

    .addTextDisplayComponents(
      text(
        [
          "# 🃏 Hi-Lo",
          "",
          `💎 **Bet**  \`${formatAmount(game.bet)}\``,
          `✨ **Multiplier**  \`${formatMult(game.multiplier)}\``,
          `🔺 **Higher**  \`${formatChance(higher)}\``,
          `🔻 **Lower**  \`${formatChance(lower)}\``,
          `💰 **Potential Win**  \`${formatAmount(potential)}\``,
        ].join("\n"),
      ),
    )

    .addSeparatorComponents(
      separator(),
    )

    .addTextDisplayComponents(
      text(
        [
          "## Current Card",
          "",
          `# ${cardLabel(game.currentCard)}`,
          `Rank \`${game.currentCard.rank}\` · \`${game.deck.length}\` cards left in the deck`,
        ].join("\n"),
      ),
    )

    .addSeparatorComponents(
      separator(),
    )

    .addTextDisplayComponents(
      text(
        "Choose **Higher** or **Lower**. Ties lose.",
      ),
    )

    .addActionRowComponents(
      gameButtons(game),
    );

  return [panel];
}

// ─── Win panel ─────────────────────────────────────────────────────────────────

function buildWinComponents(
  game: HiloGame,
  previousCard: HiloCard,
  newCard: HiloCard,
  deckComplete = false,
  playAgainDisabled = false,
): ContainerBuilder[] {
  const payout = Math.floor(
    game.bet *
      game.multiplier,
  );

  const panel = new ContainerBuilder()
    .setAccentColor(
      COLORS.success,
    )

    .addTextDisplayComponents(
      text(
        [
          `# 🃏 Hi-Lo — ${
            deckComplete
              ? "Deck Complete!"
              : "Correct Guess!"
          }`,
          "",
          `✅ **${cardLabel(previousCard)}** → **${cardLabel(newCard)}**`,
          "",
          `✨ **Multiplier**  \`${formatMult(game.multiplier)}\``,
          `💰 **Payout**  \`${formatAmount(payout)}\``,
          `📈 **Profit**  \`+${formatAmount(payout - game.bet)}\``,
          `🎯 **Correct Guesses**  \`${game.correctGuesses}\``,
        ].join("\n"),
      ),
    )

    .addSeparatorComponents(
      separator(),
    )

    .addTextDisplayComponents(
      text(
        deckComplete
          ? "The deck is complete."
          : "The game continues — cash out or guess again.",
      ),
    )

    .addActionRowComponents(
      playAgainRow(
        game.userId,
        game.bet,
        playAgainDisabled,
      ),
    );

  return [panel];
}

// ─── Loss panel ────────────────────────────────────────────────────────────────

function buildLossComponents(
  game: HiloGame,
  previousCard: HiloCard,
  newCard: HiloCard,
  reason: "wrong" | "tie",
  playAgainDisabled = false,
): ContainerBuilder[] {
  const reasonText =
    reason === "tie"
      ? `The next card went the wrong way after ${game.correctGuesses} correct guesses.`
      : `The next card went the wrong way after ${game.correctGuesses} correct guesses.`;

  const panel = new ContainerBuilder()
    .setAccentColor(
      COLORS.danger,
    )

    .addTextDisplayComponents(
      text(
        [
          "# 🃏 Hi-Lo — You Lose",
          "",
          `💎 **Bet**  \`${formatAmount(game.bet)}\``,
          `✨ **Multiplier**  \`${formatMult(game.multiplier)}\``,
        ].join("\n"),
      ),
    )

    .addSeparatorComponents(
      separator(),
    )

    .addTextDisplayComponents(
      text(
        [
          `**Your card:** ${cardLabel(previousCard)}`,
          `**Revealed:** ${cardLabel(newCard)}`,
          "",
          `> ${reasonText}`,
        ].join("\n"),
      ),
    )

    .addActionRowComponents(
      playAgainRow(
        game.userId,
        game.bet,
        playAgainDisabled,
      ),
    );

  return [panel];
}

// ─── Cashout panel ─────────────────────────────────────────────────────────────

function buildCashoutComponents(
  game: HiloGame,
  playAgainDisabled = false,
): ContainerBuilder[] {
  const payout = Math.floor(
    game.bet *
      game.multiplier,
  );

  const multiplierText =
    formatMult(game.multiplier);

  const panel = new ContainerBuilder()
    .setAccentColor(
      COLORS.success,
    )

    .addTextDisplayComponents(
      text(
        [
          "# 🃏 Hi-Lo",
          "",
          `💎 **Bet**  \`${formatAmount(game.bet)}\``,
          `✨ **Multiplier**  \`${multiplierText}\`  \`(${formatAmount(payout)})\``,
        ].join("\n"),
      ),
    )

    .addSeparatorComponents(
      separator(),
    )

    .addTextDisplayComponents(
      text(
        [
          `**Final Card:**  ${cardLabel(game.currentCard)}`,
          "",
          `> Cashed out at **${multiplierText} (${formatAmount(payout)})** with **${game.correctGuesses} correct guesses**`,
        ].join("\n"),
      ),
    )

    .addActionRowComponents(
      playAgainRow(
        game.userId,
        game.bet,
        playAgainDisabled,
      ),
    );

  return [panel];
}

// ─── New game ──────────────────────────────────────────────────────────────────

function newGame(
  userId: string,
  bet: number,
): HiloGame {
  const deck = shuffle(
    buildHiloDeck(),
  );

  return {
    userId,
    bet,
    deck: deck.slice(1),
    currentCard: deck[0]!,
    multiplier: 1,
    correctGuesses: 0,
  };
}

// ─── Start game ────────────────────────────────────────────────────────────────

async function startGame(
  userId: string,
  bet: number,
  editFn: (data: {
    flags?: MessageFlags;
    components?: ContainerBuilder[];
  }) => Promise<unknown>,
): Promise<void> {
  const game = newGame(
    userId,
    bet,
  );

  await addBalance(
    userId,
    -bet,
  );

  activeHiloGames.set(
    userId,
    game,
  );

  await editFn({
    flags: MessageFlags.IsComponentsV2,
    components:
      buildActiveComponents(game),
  });
}

// ─── Command ──────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("hilo")
  .setDescription(
    "Play Hi-Lo with a standard 52-card deck",
  )
  .addStringOption((opt) =>
    opt
      .setName("amount")
      .setDescription(
        "Bet amount (e.g. 1m, 2.5b)",
      )
      .setRequired(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
) {
  const amount = parseAmount(
    interaction.options.getString(
      "amount",
      true,
    ),
  );

  if (!amount || amount < 1_000_000) {
    return interaction.reply({
      embeds: [
        errorEmbed(
          "Minimum bet is **1m gems**. Try `1m`, `2.5b`, `500k`.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  if (
    activeHiloGames.has(
      interaction.user.id,
    )
  ) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          "You already have an active Hi-Lo game!",
        ),
      ],
    });
  }

  const user =
    await getOrCreateUser(
      interaction.user.id,
      interaction.user.username,
    );

  if (user.balance < amount) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`,
        ),
      ],
    });
  }

  await startGame(
    interaction.user.id,
    amount,
    (payload) =>
      interaction.editReply(payload),
  );
}

// ─── Guess buttons ─────────────────────────────────────────────────────────────

export async function handleGuess(
  interaction: ButtonInteraction,
  direction: HiloDirection,
): Promise<void> {
  await interaction.deferUpdate();

  const game =
    activeHiloGames.get(
      interaction.user.id,
    );

  if (!game) {
    await interaction.followUp({
      content:
        "❌ This Hi-Lo game has already ended.",
      flags: MessageFlags.Ephemeral,
    });

    return;
  }

  const previousCard =
    game.currentCard;

  const nextCardIndex = Math.floor(
    Math.random() *
      game.deck.length,
  );

  const nextCard =
    game.deck.splice(
      nextCardIndex,
      1,
    )[0]!;

  const isTie =
    nextCard.rankValue ===
    previousCard.rankValue;

  const isCorrect =
    direction === "higher"
      ? nextCard.rankValue >
        previousCard.rankValue
      : nextCard.rankValue <
        previousCard.rankValue;

  // ── Loss ───────────────────────────────────────────────────────────────────

  if (!isCorrect || isTie) {
    activeHiloGames.delete(
      game.userId,
    );

    await recordBet(
      game.userId,
      game.bet,
      -game.bet,
      "hilo",
      undefined,
      isTie ? false : undefined,
    );

    await interaction.editReply({
      components:
        buildLossComponents(
          game,
          previousCard,
          nextCard,
          isTie
            ? "tie"
            : "wrong",
        ),
    });

    return;
  }

  // ── Correct guess ──────────────────────────────────────────────────────────

  game.currentCard =
    nextCard;

  game.correctGuesses += 1;

  game.multiplier =
    nextMultiplier(
      {
        ...game,
        currentCard:
          previousCard,
        deck: [
          nextCard,
          ...game.deck,
        ],
      },
      direction,
    );

  // ── Deck complete ──────────────────────────────────────────────────────────

  if (game.deck.length === 0) {
    activeHiloGames.delete(
      game.userId,
    );

    const payout = Math.floor(
      game.bet *
        game.multiplier,
    );

    await addBalance(
      game.userId,
      payout,
    );

    await recordBet(
      game.userId,
      game.bet,
      payout - game.bet,
      "hilo",
      game.multiplier,
    );

    await interaction.editReply({
      components:
        buildWinComponents(
          game,
          previousCard,
          nextCard,
          true,
        ),
    });

    return;
  }

  // ── Continue game ──────────────────────────────────────────────────────────

  await interaction.editReply({
    components:
      buildActiveComponents(game),
  });
}

// ─── Cashout ───────────────────────────────────────────────────────────────────

export async function handleCashout(
  interaction: ButtonInteraction,
): Promise<void> {
  await interaction.deferUpdate();

  const game =
    activeHiloGames.get(
      interaction.user.id,
    );

  if (!game) {
    await interaction.followUp({
      content:
        "❌ This Hi-Lo game has already ended.",
      flags: MessageFlags.Ephemeral,
    });

    return;
  }

  activeHiloGames.delete(
    game.userId,
  );

  const payout = Math.floor(
    game.bet *
      game.multiplier,
  );

  await addBalance(
    game.userId,
    payout,
  );

  await recordBet(
    game.userId,
    game.bet,
    payout - game.bet,
    "hilo",
    game.multiplier,
  );

  await interaction.editReply({
    components:
      buildCashoutComponents(game),
  });
}

// ─── Play Again ────────────────────────────────────────────────────────────────

export async function handlePlayAgain(
  interaction: ButtonInteraction,
  userId: string,
  betStr: string,
): Promise<void> {
  if (
    interaction.user.id !==
    userId
  ) {
    return void interaction.reply({
      content:
        "❌ This isn't your game.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (
    activeHiloGames.has(userId)
  ) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "You already have an active Hi-Lo game!",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  const bet = parseInt(
    betStr,
    10,
  );

  if (
    !Number.isSafeInteger(bet) ||
    bet < 1
  ) {
    return void interaction.reply({
      content:
        "❌ Invalid bet.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferUpdate();

  // IMPORTANT:
  // Keep the old result panel exactly as it was.
  // We only need to replace its Play Again button with
  // the visually disabled version.
  //
  // We do NOT show "Game ended" and we do NOT replace
  // the previous panel with a new panel.

  const oldMessage =
    interaction.message;

  const oldComponents =
    oldMessage.components;

  // Rebuild the previous result panel with only the
  // Play Again button disabled.
  //
  // Since the original message is one of our result panels,
  // determine which result panel it is from its buttons/content.
  const firstContainer =
    oldComponents[0];

  let previousPanel:
    | ContainerBuilder
    | null = null;

  // ── Reconstruct the loss panel ─────────────────────────────────────────────

  const gameState =
    activeHiloGames.get(userId);

  // The game is already ended here, so there should be
  // no active game. We use the original message structure
  // instead of changing its visible content.

  if (firstContainer) {
    const componentsData =
      firstContainer.components;

    // Clone the existing V2 container structure.
    // The only component we replace is the final Play Again row.
    const rebuilt =
      new ContainerBuilder();

    // Preserve the original accent color from the message
    // by using the appropriate result color based on the
    // existing panel type.
    //
    // The result panels are either success or danger.
    const isDanger =
      componentsData.some(
        (component: any) =>
          component?.type === 10 &&
          typeof component.content === "string" &&
          component.content.includes(
            "You Lose",
          ),
      );

    rebuilt.setAccentColor(
      isDanger
        ? COLORS.danger
        : COLORS.success,
    );

    // Re-create the existing content exactly.
    for (
      let i = 0;
      i < componentsData.length;
      i++
    ) {
      const component: any =
        componentsData[i];

      // The final Action Row is the Play Again row.
      if (
        component?.type === 1 &&
        i ===
          componentsData.length - 1
      ) {
        rebuilt.addActionRowComponents(
          new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(
                `pa_hilo_${userId}_${bet}`,
              )
              .setLabel(
                "🔄  Play Again",
              )
              .setStyle(
                ButtonStyle.Secondary,
              )
              .setDisabled(true),
          ),
        );

        continue;
      }

      // Preserve text displays.
      if (
        component?.type === 10
      ) {
        rebuilt.addTextDisplayComponents(
          text(
            component.content ?? "",
          ),
        );

        continue;
      }

      // Preserve separators.
      if (
        component?.type === 14
      ) {
        rebuilt.addSeparatorComponents(
          separator(),
        );

        continue;
      }
    }

    previousPanel = rebuilt;
  }

  // Update only the button on the previous result panel.
  // No V2 flags are sent here because the interaction
  // has already been acknowledged with deferUpdate().
  if (previousPanel) {
    await interaction.editReply({
      components: [
        previousPanel,
      ],
    });
  }

  // ── Check balance ──────────────────────────────────────────────────────────

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

  // ── Start the new game as a separate message ───────────────────────────────

  const gameMessage: Message =
    await interaction.followUp({
      flags:
        MessageFlags.IsComponentsV2,
      components: [
        new ContainerBuilder()
          .setAccentColor(
            COLORS.primary,
          )
          .addTextDisplayComponents(
            text(
              [
                "# 🃏 Hi-Lo",
                "",
                "Shuffling a new 52-card deck…",
              ].join("\n"),
            ),
          ),
      ],
    });

  await startGame(
    userId,
    bet,
    (payload) =>
      gameMessage.edit(payload),
  );
}