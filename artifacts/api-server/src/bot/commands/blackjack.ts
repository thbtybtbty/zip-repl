import {
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
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

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Card {
  rank: string;
  suit: string;
}

export interface BlackjackGame {
  userId: string;
  bet: number;
  deck: Card[];
  playerHand: Card[];
  dealerHand: Card[];
  doubled: boolean;
  messageId: string;
}

type GameStatus =
  | "active"
  | "player_bust"
  | "dealer_bust"
  | "player_win"
  | "dealer_win"
  | "push"
  | "blackjack";

interface FinishedBlackjackGame {
  game: BlackjackGame;
  status: GameStatus;
}

export const activeBlackjackGames = new Map<string, BlackjackGame>();

const finishedBlackjackGames = new Map<
  string,
  FinishedBlackjackGame
>();

// ─── Deck helpers ──────────────────────────────────────────────────────────────

const RANKS = [
  "A",
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
];

const SUITS = ["♠", "♥", "♦", "♣"];

function buildDeck(): Card[] {
  const deck: Card[] = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        rank,
        suit,
      });
    }
  }

  return deck;
}

function shuffle(deck: Card[]): Card[] {
  const d = [...deck];

  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [d[i], d[j]] = [d[j]!, d[i]!];
  }

  return d;
}

function deal(deck: Card[]): Card {
  return deck.pop()!;
}

// ─── Hand value ────────────────────────────────────────────────────────────────

function cardValue(rank: string): number {
  if (["J", "Q", "K"].includes(rank)) {
    return 10;
  }

  if (rank === "A") {
    return 11;
  }

  return parseInt(rank, 10);
}

function handValue(hand: Card[]): number {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    total += cardValue(card.rank);

    if (card.rank === "A") {
      aces++;
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  return total;
}

function isBlackjack(hand: Card[]): boolean {
  return hand.length === 2 && handValue(hand) === 21;
}

function isBust(hand: Card[]): boolean {
  return handValue(hand) > 21;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─── Card display ──────────────────────────────────────────────────────────────

function cardStr(card: Card): string {
  return `${card.rank}${card.suit}`;
}

function handDisplay(hand: Card[]): string {
  return hand
    .map((card) => `\`${cardStr(card)}\``)
    .join("  ");
}

// ─── UI ────────────────────────────────────────────────────────────────────────

const CARDS_EMOJI = "🃏";
const DIAMOND_EMOJI = "💎";
const KNOWN_EMOJI = "✨";

function dealerDisplayLine(
  hand: Card[],
  showFull: boolean,
): string {
  if (showFull && isBlackjack(hand)) {
    return "### Dealer's Blackjack";
  }

  const score = showFull
    ? handValue(hand)
    : "?";

  const suffix =
    showFull && handValue(hand) > 21
      ? " • Bust"
      : "";

  return `### Dealer  \`${score}${suffix}\``;
}

function createText(
  content: string,
): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(
    content,
  );
}

/**
 * Discord Components V2 divider.
 *
 * This is the same type of clean horizontal divider
 * used to separate sections in the /balance layout.
 */
function createDivider(): SeparatorBuilder {
  return new SeparatorBuilder();
}

// ─── Main gameplay buttons ─────────────────────────────────────────────────────

function buildComponents(
  game: BlackjackGame,
  disabled: boolean,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const canDouble =
    !disabled &&
    !game.doubled &&
    game.playerHand.length === 2;

  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("bj_hit")
      .setLabel("➕  Hit")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId("bj_stand")
      .setLabel("✋  Stand")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId("bj_double")
      .setLabel("⬆️  Double")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canDouble),
  );
}

// ─── Play Again button ─────────────────────────────────────────────────────────

function playAgainRow(
  userId: string,
  bet: number,
  disabled = false,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `pa_bj_${userId}_${bet}`,
      )
      .setLabel("🔄  Play Again")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

// ─── Main Blackjack container ──────────────────────────────────────────────────

function buildBlackjackContainer(
  game: BlackjackGame,
  status: GameStatus,
  showGameplayButtons: boolean,
  playAgainDisabled = false,
): ContainerBuilder {
  const pv = handValue(
    game.playerHand,
  );

  const dv = handValue(
    game.dealerHand,
  );

  const showDealerFull =
    status !== "active";

  const dealerCards = showDealerFull
    ? handDisplay(game.dealerHand)
    : `\`${cardStr(game.dealerHand[0]!)}\`  \`?\``;

  const bet =
    game.bet *
    (game.doubled ? 2 : 1);

  const payout =
    status === "blackjack"
      ? game.bet +
        Math.floor(game.bet * 1.5)
      : status === "player_win" ||
          status === "dealer_bust"
        ? bet * 2
        : status === "push"
          ? bet
          : 0;

  const multiplier =
    bet > 0
      ? payout / bet
      : 0;

  const dealerNaturalBeatPlayer21 =
    status === "dealer_win" &&
    isBlackjack(game.dealerHand) &&
    pv === 21 &&
    !isBlackjack(game.playerHand);

  const statusMeta: Record<
    GameStatus,
    {
      color: number;
      title: string;
      resultLine: string;
    }
  > = {
    active: {
      color: COLORS.primary,
      title: `${CARDS_EMOJI} Blackjack`,
      resultLine: "",
    },

    player_bust: {
      color: COLORS.danger,
      title: `${CARDS_EMOJI} Blackjack - YOU LOST`,
      resultLine: `> You busted with ${pv}.`,
    },

    dealer_bust: {
      color: COLORS.success,
      title: `${CARDS_EMOJI} Blackjack - YOU WON`,
      resultLine: `> The dealer busted with ${dv}.`,
    },

    player_win: {
      color: COLORS.success,
      title: `${CARDS_EMOJI} Blackjack - YOU WON`,
      resultLine: `> You beat the dealer, ${pv} to ${dv}.`,
    },

    dealer_win: {
      color: COLORS.danger,
      title: `${CARDS_EMOJI} Blackjack - YOU LOST`,
      resultLine:
        dealerNaturalBeatPlayer21
          ? "> The dealer beat you, natural blackjack to 21."
          : `> The dealer beat you, ${dv} to ${pv}.`,
    },

    push: {
      color: COLORS.warning,
      title: `${CARDS_EMOJI} Blackjack - PUSH`,
      resultLine: `> Push — you and the dealer both had ${pv}.`,
    },

    blackjack: {
      color: COLORS.gold,
      title: `${CARDS_EMOJI} Blackjack - BLACKJACK`,
      resultLine: `> Blackjack! You beat the dealer, ${pv} to ${dv}.`,
    },
  };

  const meta =
    statusMeta[status];

  const container =
    new ContainerBuilder()
      .setAccentColor(meta.color);

  // ─── Title ────────────────────────────────────────────────────────────────

  container.addTextDisplayComponents(
    createText(
      `## ${meta.title}`,
    ),
  );

  // ─── Bet ──────────────────────────────────────────────────────────────────

  container.addTextDisplayComponents(
    createText(
      `${DIAMOND_EMOJI} **Bet**  \`${formatAmount(bet)}\`${game.doubled ? "  (doubled)" : ""}`,
    ),
  );

  // ─── Multiplier ───────────────────────────────────────────────────────────
  // If multiplier exists, the divider goes AFTER it.

  if (
    status === "player_win" ||
    status === "dealer_bust" ||
    status === "push" ||
    status === "blackjack"
  ) {
    container.addTextDisplayComponents(
      createText(
        `${KNOWN_EMOJI} **Multiplier**  \`${multiplier.toFixed(2)}x (${formatAmount(payout)})\``,
      ),
    );
  }

  // ─── Divider ──────────────────────────────────────────────────────────────
  // Clean Discord Components V2 separator, exactly like /balance.

  container.addSeparatorComponents(
    createDivider(),
  );

  // ─── Dealer ───────────────────────────────────────────────────────────────

  container.addTextDisplayComponents(
    createText(
      [
        dealerDisplayLine(
          game.dealerHand,
          showDealerFull,
        ),

        dealerCards,

        `### Your hand  \`${pv}${pv > 21 ? " • Bust" : ""}\``,

        handDisplay(
          game.playerHand,
        ),

        "",

        ...(meta.resultLine
          ? [meta.resultLine]
          : []),
      ].join("\n"),
    ),
  );

  // ─── Buttons ───────────────────────────────────────────────────────────────

  container.addTextDisplayComponents(
    createText("\u200b"),
  );

  // Active game:
  // Hit / Stand / Double
  if (showGameplayButtons) {
    container.addActionRowComponents(
      buildComponents(
        game,
        false,
      ),
    );
  }

  // Finished game:
  // ONLY Play Again
  if (!showGameplayButtons) {
    container.addActionRowComponents(
      playAgainRow(
        game.userId,
        game.bet,
        playAgainDisabled,
      ),
    );
  }

  return container;
}

// ─── Animated dealer reveal ────────────────────────────────────────────────────

function buildContainerAnimating(
  game: BlackjackGame,
  shownDealerCards: Card[],
): ContainerBuilder {
  const pv =
    handValue(game.playerHand);

  const bet =
    game.bet *
    (game.doubled ? 2 : 1);

  const more =
    shownDealerCards.length <
    game.dealerHand.length;

  const dealerLine =
    !more &&
    isBlackjack(
      shownDealerCards,
    )
      ? dealerDisplayLine(
          shownDealerCards,
          true,
        )
      : `### Dealer  \`${handValue(shownDealerCards)}\``;

  const container =
    new ContainerBuilder()
      .setAccentColor(
        COLORS.primary,
      );

  // ─── Title ────────────────────────────────────────────────────────────────

  container.addTextDisplayComponents(
    createText(
      `## ${CARDS_EMOJI} Blackjack`,
    ),
  );

  // ─── Bet ──────────────────────────────────────────────────────────────────

  container.addTextDisplayComponents(
    createText(
      `${DIAMOND_EMOJI} **Bet**  \`${formatAmount(bet)}\`${game.doubled ? "  (doubled)" : ""}`,
    ),
  );

  // ─── Divider ──────────────────────────────────────────────────────────────

  container.addSeparatorComponents(
    createDivider(),
  );

  // ─── Dealer + player ──────────────────────────────────────────────────────

  container.addTextDisplayComponents(
    createText(
      [
        dealerLine,

        handDisplay(
          shownDealerCards,
        ),

        `### Your hand  \`${pv}\``,

        handDisplay(
          game.playerHand,
        ),
      ].join("\n"),
    ),
  );

  // ─── Disabled buttons during animation ────────────────────────────────────

  container.addTextDisplayComponents(
    createText("\u200b"),
  );

  container.addActionRowComponents(
    buildComponents(
      game,
      true,
    ),
  );

  return container;
}

// ─── Dealer play ───────────────────────────────────────────────────────────────

function dealerPlay(
  game: BlackjackGame,
): void {
  while (
    handValue(game.dealerHand) <
    17
  ) {
    game.dealerHand.push(
      deal(game.deck),
    );
  }
}

function determineOutcome(
  game: BlackjackGame,
): GameStatus {
  const playerBJ =
    isBlackjack(
      game.playerHand,
    );

  const dealerBJ =
    isBlackjack(
      game.dealerHand,
    );

  if (dealerBJ) {
    return playerBJ
      ? "push"
      : "dealer_win";
  }

  if (
    isBust(
      game.dealerHand,
    )
  ) {
    return "dealer_bust";
  }

  const pv =
    handValue(
      game.playerHand,
    );

  const dv =
    handValue(
      game.dealerHand,
    );

  return pv > dv
    ? "player_win"
    : pv === dv
      ? "push"
      : "dealer_win";
}

// ─── Resolve outcome ───────────────────────────────────────────────────────────

async function resolveGame(
  game: BlackjackGame,
  interaction: ButtonInteraction,
  status: GameStatus,
): Promise<void> {
  activeBlackjackGames.delete(
    game.userId,
  );

  const multiplier =
    game.doubled ? 2 : 1;

  const totalStake =
    game.bet * multiplier;

  let payout = 0;
  let netDelta = 0;

  if (status === "blackjack") {
    const bjProfit =
      Math.floor(
        game.bet * 1.5,
      );

    payout =
      game.bet + bjProfit;

    netDelta = bjProfit;
  } else if (
    status === "player_win" ||
    status === "dealer_bust"
  ) {
    payout =
      totalStake * 2;

    netDelta =
      totalStake;
  } else if (
    status === "push"
  ) {
    payout =
      totalStake;

    netDelta = 0;
  } else {
    payout = 0;

    netDelta =
      -totalStake;
  }

  await addBalance(
    game.userId,
    payout,
  );

  await recordBet(
    game.userId,
    totalStake,
    netDelta,
    "blackjack",
  );

  finishedBlackjackGames.set(
    game.messageId,
    {
      game: {
        ...game,
        deck: [...game.deck],
        playerHand: [
          ...game.playerHand,
        ],
        dealerHand: [
          ...game.dealerHand,
        ],
      },
      status,
    },
  );

  // Player busts immediately — no dealer animation.
  if (
    status !== "player_bust"
  ) {
    const all =
      game.dealerHand;

    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,
      components: [
        buildContainerAnimating(
          game,
          all.slice(0, 2),
        ),
      ],
    });

    for (
      let i = 2;
      i < all.length;
      i++
    ) {
      await sleep(700);

      await interaction.editReply({
        flags:
          MessageFlags.IsComponentsV2,
        components: [
          buildContainerAnimating(
            game,
            all.slice(
              0,
              i + 1,
            ),
          ),
        ],
      });
    }

    await sleep(700);
  }

  await interaction.editReply({
    flags:
      MessageFlags.IsComponentsV2,
    components: [
      buildBlackjackContainer(
        game,
        status,
        false,
        false,
      ),
    ],
  });
}

// ─── Command ───────────────────────────────────────────────────────────────────

export const data =
  new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription(
      "Play Blackjack against the dealer — get closer to 21!",
    )
    .addStringOption(
      (opt) =>
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
  const amountStr =
    interaction.options.getString(
      "amount",
      true,
    );

  const amount =
    parseAmount(amountStr);

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
    activeBlackjackGames.has(
      interaction.user.id,
    )
  ) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          "You already have an active Blackjack game!",
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

  const deck =
    shuffle(
      buildDeck(),
    );

  const game: BlackjackGame = {
    userId:
      interaction.user.id,
    bet: amount,
    deck,
    playerHand: [
      deal(deck),
      deal(deck),
    ],
    dealerHand: [
      deal(deck),
      deal(deck),
    ],
    doubled: false,
    messageId: "",
  };

  const playerBJ =
    isBlackjack(
      game.playerHand,
    );

  const dealerBJ =
    isBlackjack(
      game.dealerHand,
    );

  if (playerBJ) {
    activeBlackjackGames.delete(
      interaction.user.id,
    );

    let status: GameStatus;
    let payout: number;

    if (
      playerBJ &&
      dealerBJ
    ) {
      status = "push";
      payout = amount;
    } else if (playerBJ) {
      status = "blackjack";

      payout =
        amount +
        Math.floor(
          amount * 1.5,
        );
    } else {
      status =
        "dealer_win";

      payout = 0;
    }

    await addBalance(
      interaction.user.id,
      payout,
    );

    const msg =
      await interaction.editReply({
        flags:
          MessageFlags.IsComponentsV2,
        components: [
          buildBlackjackContainer(
            game,
            status,
            false,
            false,
          ),
        ],
      });

    game.messageId =
      msg.id;

    finishedBlackjackGames.set(
      msg.id,
      {
        game: {
          ...game,
          deck: [
            ...game.deck,
          ],
          playerHand: [
            ...game.playerHand,
          ],
          dealerHand: [
            ...game.dealerHand,
          ],
        },
        status,
      },
    );

    return;
  }

  const msg =
    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,
      components: [
        buildBlackjackContainer(
          game,
          "active",
          true,
        ),
      ],
    });

  game.messageId =
    msg.id;

  activeBlackjackGames.set(
    interaction.user.id,
    game,
  );
}

// ─── Button: Hit ──────────────────────────────────────────────────────────────

export async function handleHit(
  interaction: ButtonInteraction,
) {
  await interaction.deferUpdate();

  const game =
    activeBlackjackGames.get(
      interaction.user.id,
    );

  if (!game) return;

  game.playerHand.push(
    deal(game.deck),
  );

  if (
    isBust(
      game.playerHand,
    )
  ) {
    return resolveGame(
      game,
      interaction,
      "player_bust",
    );
  }

  if (
    handValue(
      game.playerHand,
    ) === 21
  ) {
    dealerPlay(game);

    return resolveGame(
      game,
      interaction,
      determineOutcome(
        game,
      ),
    );
  }

  await interaction.editReply({
    flags:
      MessageFlags.IsComponentsV2,
    components: [
      buildBlackjackContainer(
        game,
        "active",
        true,
      ),
    ],
  });
}

// ─── Button: Stand ────────────────────────────────────────────────────────────

export async function handleStand(
  interaction: ButtonInteraction,
) {
  await interaction.deferUpdate();

  const game =
    activeBlackjackGames.get(
      interaction.user.id,
    );

  if (!game) return;

  dealerPlay(game);

  return resolveGame(
    game,
    interaction,
    determineOutcome(
      game,
    ),
  );
}

// ─── Button: Double Down ──────────────────────────────────────────────────────

export async function handleDouble(
  interaction: ButtonInteraction,
) {
  await interaction.deferUpdate();

  const game =
    activeBlackjackGames.get(
      interaction.user.id,
    );

  if (
    !game ||
    game.playerHand.length !== 2
  ) {
    return;
  }

  const bal =
    await (
      await getOrCreateUser(
        game.userId,
        "",
      )
    ).balance;

  if (
    bal < game.bet
  ) {
    await interaction.followUp({
      embeds: [
        errorEmbed(
          `Not enough gems to double down. You need **${formatAmount(
            game.bet,
          )}** more.`,
        ),
      ],
      ephemeral: true,
    });

    return;
  }

  await addBalance(
    game.userId,
    -game.bet,
  );

  game.doubled = true;

  game.playerHand.push(
    deal(game.deck),
  );

  if (
    isBust(
      game.playerHand,
    )
  ) {
    return resolveGame(
      game,
      interaction,
      "player_bust",
    );
  }

  dealerPlay(game);

  return resolveGame(
    game,
    interaction,
    determineOutcome(
      game,
    ),
  );
}

// ─── Button: Play Again ───────────────────────────────────────────────────────

export async function handlePlayAgain(
  interaction: ButtonInteraction,
  userId: string,
  betStr: string,
): Promise<void> {
  if (
    interaction.user.id !== userId
  ) {
    return void interaction.reply({
      content:
        "❌ This isn't your game.",
      flags:
        MessageFlags.Ephemeral,
    });
  }

  const bet =
    parseInt(
      betStr,
      10,
    );

  const finished =
    finishedBlackjackGames.get(
      interaction.message.id,
    );

  if (!finished) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "This Blackjack game can no longer be replayed.",
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });
  }

  await interaction.update({
    flags:
      MessageFlags.IsComponentsV2,
    components: [
      buildBlackjackContainer(
        finished.game,
        finished.status,
        false,
        true,
      ),
    ],
  });

  if (
    activeBlackjackGames.has(
      userId,
    )
  ) {
    await interaction.followUp({
      embeds: [
        errorEmbed(
          "You already have an active Blackjack game!",
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });

    return;
  }

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

  const deck =
    shuffle(
      buildDeck(),
    );

  const game: BlackjackGame = {
    userId,
    bet,
    deck,
    playerHand: [
      deal(deck),
      deal(deck),
    ],
    dealerHand: [
      deal(deck),
      deal(deck),
    ],
    doubled: false,
    messageId: "",
  };

  const playerBJ =
    isBlackjack(
      game.playerHand,
    );

  const dealerBJ =
    isBlackjack(
      game.dealerHand,
    );

  if (playerBJ) {
    let status: GameStatus;
    let payout: number;

    if (
      playerBJ &&
      dealerBJ
    ) {
      status = "push";
      payout = bet;
    } else {
      status = "blackjack";

      payout =
        bet +
        Math.floor(
          bet * 1.5,
        );
    }

    await addBalance(
      userId,
      payout,
    );

    const msg =
      await interaction.followUp({
        flags:
          MessageFlags.IsComponentsV2,
        components: [
          buildBlackjackContainer(
            game,
            status,
            false,
            false,
          ),
        ],
      });

    game.messageId =
      msg.id;

    finishedBlackjackGames.set(
      msg.id,
      {
        game: {
          ...game,
          deck: [
            ...game.deck,
          ],
          playerHand: [
            ...game.playerHand,
          ],
          dealerHand: [
            ...game.dealerHand,
          ],
        },
        status,
      },
    );

    return;
  }

  const msg =
    await interaction.followUp({
      flags:
        MessageFlags.IsComponentsV2,
      components: [
        buildBlackjackContainer(
          game,
          "active",
          true,
        ),
      ],
    });

  game.messageId =
    msg.id;

  activeBlackjackGames.set(
    userId,
    game,
  );
}