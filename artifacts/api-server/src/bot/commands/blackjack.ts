import {
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  MessageFlags,
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
  displayName: string;
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

export const activeBlackjackGames =
  new Map<string, BlackjackGame>();

const finishedBlackjackGames =
  new Map<string, FinishedBlackjackGame>();

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_PLAYER_CARDS = 2;
const DEFAULT_DEALER_CARDS = 2;

const MIN_STARTING_CARDS = 1;
const MAX_STARTING_CARDS = 10;

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
    const j = Math.floor(
      Math.random() * (i + 1),
    );

    [d[i], d[j]] = [d[j]!, d[i]!];
  }

  return d;
}

function deal(deck: Card[]): Card {
  const card = deck.pop();

  if (!card) {
    throw new Error(
      "Blackjack deck ran out of cards.",
    );
  }

  return card;
}

function dealCards(
  deck: Card[],
  amount: number,
): Card[] {
  const hand: Card[] = [];

  for (let i = 0; i < amount; i++) {
    hand.push(deal(deck));
  }

  return hand;
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
  return (
    hand.length === 2 &&
    handValue(hand) === 21
  );
}

function isBust(hand: Card[]): boolean {
  return handValue(hand) > 21;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, ms),
  );

// ─── Blackjack image renderer ─────────────────────────────────────────────────

const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 650;

const CARD_WIDTH = 125;
const CARD_HEIGHT = 175;
const CARD_GAP = 12;

const DEALER_Y = 125;
const PLAYER_Y = 405;

const CARD_TEXT_SAFE_RIGHT = 300;
const CARD_RIGHT_MARGIN = 70;

// ─── Drawing helpers ───────────────────────────────────────────────────────────

function suitColor(suit: string): string {
  return suit === "♥" || suit === "♦"
    ? "#e53935"
    : "#111111";
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();

  ctx.roundRect(
    x,
    y,
    width,
    height,
    radius,
  );

  ctx.fill();
}

// ─── Card renderer ─────────────────────────────────────────────────────────────

function drawCard(
  ctx: CanvasRenderingContext2D,
  card: Card,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  ctx.save();

  const color = suitColor(card.suit);

  ctx.fillStyle = "rgba(0, 0, 0, 0.32)";

  drawRoundedRect(
    ctx,
    x + 6,
    y + 8,
    width,
    height,
    16,
  );

  ctx.fillStyle = "#ffffff";

  drawRoundedRect(
    ctx,
    x,
    y,
    width,
    height,
    16,
  );

  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 2.5;

  ctx.beginPath();

  ctx.roundRect(
    x,
    y,
    width,
    height,
    16,
  );

  ctx.stroke();

  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const topRankFont =
    card.rank === "10"
      ? "bold 31px Arial"
      : "bold 35px Arial";

  ctx.font = topRankFont;

  ctx.fillText(
    card.rank,
    x + 15,
    y + 13,
  );

  const rankWidth =
    ctx.measureText(card.rank).width;

  ctx.font = "27px Arial";

  ctx.fillText(
    card.suit,
    x + 18 + rankWidth,
    y + 16,
  );

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "82px Arial";

  ctx.fillText(
    card.suit,
    x + width / 2,
    y + height / 2 + 2,
  );

  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";

  const bottomRankFont =
    card.rank === "10"
      ? "bold 31px Arial"
      : "bold 35px Arial";

  ctx.font = bottomRankFont;

  ctx.fillText(
    card.rank,
    x + width - 15,
    y + height - 13,
  );

  const bottomRankWidth =
    ctx.measureText(card.rank).width;

  ctx.font = "27px Arial";

  ctx.fillText(
    card.suit,
    x + width - 18 - bottomRankWidth,
    y + height - 16,
  );

  ctx.restore();
}

// ─── Hidden card ───────────────────────────────────────────────────────────────

function drawHiddenCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  ctx.save();

  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";

  drawRoundedRect(
    ctx,
    x + 6,
    y + 8,
    width,
    height,
    16,
  );

  ctx.fillStyle = "#172554";

  drawRoundedRect(
    ctx,
    x,
    y,
    width,
    height,
    16,
  );

  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = 4;

  ctx.beginPath();

  ctx.roundRect(
    x + 9,
    y + 9,
    width - 18,
    height - 18,
    11,
  );

  ctx.stroke();

  ctx.strokeStyle =
    "rgba(255,255,255,0.18)";

  ctx.lineWidth = 1.5;

  for (
    let i = -height;
    i < width;
    i += 22
  ) {
    ctx.beginPath();

    ctx.moveTo(
      x + i,
      y,
    );

    ctx.lineTo(
      x + i + height,
      y + height,
    );

    ctx.stroke();
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 58px Arial";

  ctx.fillText(
    "♠",
    x + width / 2,
    y + height / 2,
  );

  ctx.restore();
}

// ─── Card row renderer ─────────────────────────────────────────────────────────

function drawCards(
  ctx: CanvasRenderingContext2D,
  hand: Card[],
  y: number,
  hiddenSecondCard: boolean,
) {
  if (hand.length === 0) {
    return;
  }

  let cardWidth = CARD_WIDTH;
  let cardHeight = CARD_HEIGHT;
  let gap = CARD_GAP;

  const rightEdge =
    IMAGE_WIDTH - CARD_RIGHT_MARGIN;

  let totalWidth =
    hand.length * cardWidth +
    Math.max(0, hand.length - 1) * gap;

  let startX =
    (IMAGE_WIDTH - totalWidth) / 2;

  if (
    startX < CARD_TEXT_SAFE_RIGHT
  ) {
    const availableWidth =
      rightEdge -
      CARD_TEXT_SAFE_RIGHT;

    const availableForCards =
      availableWidth -
      Math.max(0, hand.length - 1) * gap;

    if (availableForCards > 0) {
      const requiredCardWidth =
        availableForCards /
        hand.length;

      if (
        requiredCardWidth <
        cardWidth
      ) {
        cardWidth =
          Math.floor(
            requiredCardWidth,
          );

        cardHeight =
          Math.floor(
            cardWidth * 1.4,
          );

        totalWidth =
          hand.length * cardWidth +
          Math.max(0, hand.length - 1) *
            gap;

        startX =
          (IMAGE_WIDTH -
            totalWidth) /
          2;
      }
    }
  }

  if (
    startX < CARD_TEXT_SAFE_RIGHT
  ) {
    gap = 7;

    const availableWidth =
      rightEdge -
      CARD_TEXT_SAFE_RIGHT;

    const availableForCards =
      availableWidth -
      Math.max(0, hand.length - 1) * gap;

    if (availableForCards > 0) {
      const requiredCardWidth =
        availableForCards /
        hand.length;

      if (
        requiredCardWidth <
        cardWidth
      ) {
        cardWidth =
          Math.floor(
            requiredCardWidth,
          );

        cardHeight =
          Math.floor(
            cardWidth * 1.4,
          );
      }

      totalWidth =
        hand.length * cardWidth +
        Math.max(0, hand.length - 1) *
          gap;

      startX =
        (IMAGE_WIDTH -
          totalWidth) /
        2;
    }
  }

  hand.forEach(
    (card, index) => {
      const x =
        startX +
        index *
          (cardWidth + gap);

      if (
        hiddenSecondCard &&
        index === 1
      ) {
        drawHiddenCard(
          ctx,
          x,
          y,
          cardWidth,
          cardHeight,
        );
      } else {
        drawCard(
          ctx,
          card,
          x,
          y,
          cardWidth,
          cardHeight,
        );
      }
    },
  );
}

// ─── Result helpers ────────────────────────────────────────────────────────────

function getImageResult(
  status: GameStatus,
): string {
  switch (status) {
    case "player_win":
    case "dealer_bust":
    case "blackjack":
      return "- YOU WON";

    case "dealer_win":
    case "player_bust":
      return "- YOU LOST";

    case "push":
      return "- PUSH";

    default:
      return "";
  }
}

function getResultText(
  game: BlackjackGame,
  status: GameStatus,
): string {
  const pv =
    handValue(game.playerHand);

  const dv =
    handValue(game.dealerHand);

  switch (status) {
    case "player_bust":
      return `You busted with ${pv}.`;

    case "dealer_bust":
      return `The dealer busted with ${dv}.`;

    case "player_win":
      return `You beat the dealer, ${pv} to ${dv}.`;

    case "dealer_win":
      if (
        isBlackjack(game.dealerHand) &&
        pv === 21 &&
        !isBlackjack(game.playerHand)
      ) {
        return "The dealer beat you, natural blackjack to 21.";
      }

      return `The dealer beat you, ${dv} to ${pv}.`;

    case "push":
      return `Push - you and the dealer both had ${pv}.`;

    case "blackjack":
      return `Blackjack! You beat the dealer, ${pv} to ${dv}.`;

    default:
      return "";
  }
}

function getHandLabelColors(
  status: GameStatus,
): {
  dealer: string;
  player: string;
} {
  if (status === "active") {
    return {
      dealer: "#ffffff",
      player: "#ffffff",
    };
  }

  if (
    status === "dealer_win" ||
    status === "player_bust"
  ) {
    return {
      dealer: "#4ade80",
      player: "#ff5c5c",
    };
  }

  if (
    status === "player_win" ||
    status === "dealer_bust" ||
    status === "blackjack"
  ) {
    return {
      dealer: "#ff5c5c",
      player: "#4ade80",
    };
  }

  if (status === "push") {
    return {
      dealer: "#4ade80",
      player: "#4ade80",
    };
  }

  return {
    dealer: "#ffffff",
    player: "#ffffff",
  };
}

// ─── Result overlay ────────────────────────────────────────────────────────────

function drawResultOverlay(
  ctx: CanvasRenderingContext2D,
  text: string,
) {
  if (!text) {
    return;
  }

  ctx.save();

  ctx.font = "bold 23px Arial";

  const paddingX = 24;
  const paddingY = 12;

  const textWidth =
    ctx.measureText(text).width;

  const boxWidth =
    textWidth + paddingX * 2;

  const boxHeight = 48;

  const x =
    (IMAGE_WIDTH - boxWidth) / 2;

  const y = 592;

  ctx.fillStyle =
    "rgba(0, 0, 0, 0.38)";

  drawRoundedRect(
    ctx,
    x,
    y,
    boxWidth,
    boxHeight,
    14,
  );

  ctx.strokeStyle =
    "rgba(255,255,255,0.16)";

  ctx.lineWidth = 1.5;

  ctx.beginPath();

  ctx.roundRect(
    x,
    y,
    boxWidth,
    boxHeight,
    14,
  );

  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 23px Arial";

  ctx.fillText(
    text,
    IMAGE_WIDTH / 2,
    y + boxHeight / 2,
  );

  ctx.restore();
}

// ─── Blackjack image ───────────────────────────────────────────────────────────

function blackjackImage(
  game: BlackjackGame,
  status: GameStatus,
  showDealerFull: boolean,
): Buffer {
  const canvas =
    createCanvas(
      IMAGE_WIDTH,
      IMAGE_HEIGHT,
    );

  const ctx =
    canvas.getContext("2d");

  ctx.fillStyle = "#071a12";

  ctx.fillRect(
    0,
    0,
    IMAGE_WIDTH,
    IMAGE_HEIGHT,
  );

  ctx.fillStyle = "#0b3d2e";

  ctx.beginPath();

  ctx.roundRect(
    25,
    25,
    IMAGE_WIDTH - 50,
    IMAGE_HEIGHT - 50,
    30,
  );

  ctx.fill();

  ctx.strokeStyle = "#c9a227";
  ctx.lineWidth = 4;

  ctx.stroke();

  // ── Title ────────────────────────────────────────────────────────────────

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "bold 34px Arial";

  const title =
    status === "active"
      ? "BLACKJACK"
      : `BLACKJACK ${getImageResult(status)}`;

  ctx.fillText(
    title,
    IMAGE_WIDTH / 2,
    43,
  );

  // ── Bet ──────────────────────────────────────────────────────────────────

  const displayedBet =
    game.bet *
    (game.doubled ? 2 : 1);

  const betText =
    `Bet: ${formatAmount(displayedBet)}${
      game.doubled
        ? " (doubled)"
        : ""
    }`;

  ctx.font = "bold 21px Arial";

  const betPaddingX = 18;
  const betPaddingY = 8;

  const betTextWidth =
    ctx.measureText(betText).width;

  const betBoxWidth =
    betTextWidth +
    betPaddingX * 2;

  const betBoxHeight =
    21 +
    betPaddingY * 2;

  const betBoxX =
    (IMAGE_WIDTH - betBoxWidth) / 2;

  const betBoxY = 78;

  ctx.fillStyle =
    "rgba(0, 0, 0, 0.28)";

  drawRoundedRect(
    ctx,
    betBoxX,
    betBoxY,
    betBoxWidth,
    betBoxHeight,
    10,
  );

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillText(
    betText,
    IMAGE_WIDTH / 2,
    betBoxY +
      betBoxHeight / 2,
  );

  // ── Dealer information ──────────────────────────────────────────────────

  const handColors =
    getHandLabelColors(status);

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 25px Arial";

  ctx.fillStyle =
    handColors.dealer;

  ctx.fillText(
    "DEALER",
    70,
    124,
  );

  const dealerValue =
    showDealerFull
      ? handValue(
          game.dealerHand,
        )
      : "?";

  ctx.font = "bold 22px Arial";

  ctx.fillText(
    `Value: ${dealerValue}`,
    70,
    159,
  );

  if (
    showDealerFull &&
    isBust(game.dealerHand)
  ) {
    ctx.fillStyle = "#ff5c5c";

    ctx.fillText(
      "BUST",
      205,
      159,
    );
  }

  drawCards(
    ctx,
    game.dealerHand,
    DEALER_Y,
    !showDealerFull &&
      game.dealerHand.length >= 2,
  );

  // ── Divider ──────────────────────────────────────────────────────────────

  ctx.strokeStyle =
    "rgba(255,255,255,0.18)";

  ctx.lineWidth = 2;

  ctx.beginPath();

  ctx.moveTo(
    70,
    335,
  );

  ctx.lineTo(
    IMAGE_WIDTH - 70,
    335,
  );

  ctx.stroke();

  // ── Player information ──────────────────────────────────────────────────

  ctx.fillStyle =
    handColors.player;

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 25px Arial";

  ctx.fillText(
    "YOUR HAND",
    70,
    350,
  );

  const playerValue =
    handValue(
      game.playerHand,
    );

  ctx.font = "bold 22px Arial";

  ctx.fillText(
    `Value: ${playerValue}`,
    70,
    378,
  );

  if (
    isBust(
      game.playerHand,
    )
  ) {
    ctx.fillStyle = "#ff5c5c";

    ctx.fillText(
      "BUST",
      205,
      378,
    );
  }

  drawCards(
    ctx,
    game.playerHand,
    PLAYER_Y,
    false,
  );

  if (status !== "active") {
    drawResultOverlay(
      ctx,
      getResultText(
        game,
        status,
      ),
    );
  }

  return canvas.toBuffer(
    "image/png",
  );
}

// ─── Image component ──────────────────────────────────────────────────────────

function imageComponent(): MediaGalleryBuilder {
  return new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(
      "attachment://blackjack.png",
    ),
  );
}

// ─── Text helpers ──────────────────────────────────────────────────────────────

function createText(
  content: string,
): TextDisplayBuilder {
  return new TextDisplayBuilder()
    .setContent(content);
}

function createDivider(): SeparatorBuilder {
  return new SeparatorBuilder();
}

// ─── Buttons ───────────────────────────────────────────────────────────────────

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
  const bet =
    game.bet *
    (game.doubled ? 2 : 1);

  const payout =
    status === "blackjack"
      ? game.bet +
        Math.floor(
          game.bet * 1.5,
        )
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

  const statusMeta: Record<
    GameStatus,
    {
      color: number;
      title: string;
    }
  > = {
    active: {
      color: COLORS.primary,
      title: `🃏 ${game.displayName}'s Blackjack game`,
    },

    player_bust: {
      color: COLORS.danger,
      title: "🃏 Blackjack - YOU LOST",
    },

    dealer_bust: {
      color: COLORS.success,
      title: "🃏 Blackjack - YOU WON",
    },

    player_win: {
      color: COLORS.success,
      title: "🃏 Blackjack - YOU WON",
    },

    dealer_win: {
      color: COLORS.danger,
      title: "🃏 Blackjack - YOU LOST",
    },

    push: {
      color: COLORS.warning,
      title: "🃏 Blackjack - PUSH",
    },

    blackjack: {
      color: COLORS.gold,
      title: "🃏 Blackjack - BLACKJACK WIN",
    },
  };

  const meta =
    statusMeta[status];

  const container =
    new ContainerBuilder()
      .setAccentColor(
        meta.color,
      );

  container.addTextDisplayComponents(
    createText(
      `## ${meta.title}`,
    ),
  );

  if (
    status === "player_win" ||
    status === "dealer_bust" ||
    status === "push" ||
    status === "blackjack"
  ) {
    container.addTextDisplayComponents(
      createText(
        `💎 **Bet:** \`${formatAmount(
          bet,
        )}\`${game.doubled ? "  *(doubled)*" : ""}\n` +
        `✨ **Multiplier:** \`${multiplier.toFixed(
          2,
        )}x (${formatAmount(
          payout,
        )})\``,
      ),
    );
  } else {
    container.addTextDisplayComponents(
      createText(
        `💎 **Bet:** \`${formatAmount(
          bet,
        )}\`${game.doubled ? "  *(doubled)*" : ""}`,
      ),
    );
  }

  container.addSeparatorComponents(
    createDivider(),
  );

  container.addMediaGalleryComponents(
    imageComponent(),
  );

  if (showGameplayButtons) {
    container.addActionRowComponents(
      buildComponents(
        game,
        false,
      ),
    );
  } else {
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

// ─── Animated dealer image container ───────────────────────────────────────────

function buildContainerAnimating(
  game: BlackjackGame,
  shownDealerCards: Card[],
): ContainerBuilder {
  const bet =
    game.bet *
    (game.doubled ? 2 : 1);

  const tempGame: BlackjackGame = {
    ...game,
    dealerHand:
      shownDealerCards,
  };

  const container =
    new ContainerBuilder()
      .setAccentColor(
        COLORS.primary,
      );

  container.addTextDisplayComponents(
    createText(
      `## 🃏 ${game.displayName}'s Blackjack game`,
    ),
  );

  container.addTextDisplayComponents(
    createText(
      `💎 **Bet:** \`${formatAmount(
        bet,
      )}\`${game.doubled ? "  *(doubled)*" : ""}`,
    ),
  );

  container.addSeparatorComponents(
    createDivider(),
  );

  container.addMediaGalleryComponents(
    imageComponent(),
  );

  container.addActionRowComponents(
    buildComponents(
      tempGame,
      true,
    ),
  );

  return container;
}

// ─── Message edit helper ───────────────────────────────────────────────────────

function imageFile(
  game: BlackjackGame,
  status: GameStatus,
  showDealerFull: boolean,
): AttachmentBuilder {
  return new AttachmentBuilder(
    blackjackImage(
      game,
      status,
      showDealerFull,
    ),
    {
      name: "blackjack.png",
    },
  );
}

// ─── Dealer play ───────────────────────────────────────────────────────────────

function dealerPlay(
  game: BlackjackGame,
): void {
  while (
    handValue(game.dealerHand) < 17
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

  if (
    status === "player_bust"
  ) {
    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,
      files: [
        imageFile(
          game,
          status,
          true,
        ),
      ],
      components: [
        buildBlackjackContainer(
          game,
          status,
          false,
          false,
        ),
      ],
    });

    return;
  }

  const all =
    game.dealerHand;

  const firstRevealGame: BlackjackGame = {
    ...game,
    dealerHand:
      all.slice(0, 2),
  };

  await interaction.editReply({
    flags:
      MessageFlags.IsComponentsV2,
    files: [
      imageFile(
        firstRevealGame,
        "active",
        true,
      ),
    ],
    components: [
      buildContainerAnimating(
        firstRevealGame,
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

    const revealGame: BlackjackGame = {
      ...game,
      dealerHand:
        all.slice(
          0,
          i + 1,
        ),
    };

    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,
      files: [
        imageFile(
          revealGame,
          "active",
          true,
        ),
      ],
      components: [
        buildContainerAnimating(
          revealGame,
          all.slice(
            0,
            i + 1,
          ),
        ),
      ],
    });
  }

  await sleep(700);

  await interaction.editReply({
    flags:
      MessageFlags.IsComponentsV2,
    files: [
      imageFile(
        game,
        status,
        true,
      ),
    ],
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
    )
    .addIntegerOption(
      (opt) =>
        opt
          .setName("player_cards")
          .setDescription(
            "Number of starting cards for the player (default: 2)",
          )
          .setMinValue(
            MIN_STARTING_CARDS,
          )
          .setMaxValue(
            MAX_STARTING_CARDS,
          )
          .setRequired(false),
    )
    .addIntegerOption(
      (opt) =>
        opt
          .setName("dealer_cards")
          .setDescription(
            "Number of starting cards for the dealer (default: 2)",
          )
          .setMinValue(
            MIN_STARTING_CARDS,
          )
          .setMaxValue(
            MAX_STARTING_CARDS,
          )
          .setRequired(false),
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

  const playerCards =
    interaction.options.getInteger(
      "player_cards",
    ) ??
    DEFAULT_PLAYER_CARDS;

  const dealerCards =
    interaction.options.getInteger(
      "dealer_cards",
    ) ??
    DEFAULT_DEALER_CARDS;

  if (
    playerCards <
      MIN_STARTING_CARDS ||
    playerCards >
      MAX_STARTING_CARDS
  ) {
    return interaction.reply({
      embeds: [
        errorEmbed(
          `Player cards must be between **${MIN_STARTING_CARDS}** and **${MAX_STARTING_CARDS}**.`,
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });
  }

  if (
    dealerCards <
      MIN_STARTING_CARDS ||
    dealerCards >
      MAX_STARTING_CARDS
  ) {
    return interaction.reply({
      embeds: [
        errorEmbed(
          `Dealer cards must be between **${MIN_STARTING_CARDS}** and **${MAX_STARTING_CARDS}**.`,
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

    displayName:
      interaction.member &&
      "displayName" in interaction.member
        ? interaction.member.displayName
        : interaction.user.globalName ??
          interaction.user.username,

    bet: amount,

    deck,

    playerHand:
      dealCards(
        deck,
        playerCards,
      ),

    dealerHand:
      dealCards(
        deck,
        dealerCards,
      ),

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
    } else {
      status = "blackjack";

      payout =
        amount +
        Math.floor(
          amount * 1.5,
        );
    }

    await addBalance(
      interaction.user.id,
      payout,
    );

    const msg =
      await interaction.editReply({
        flags:
          MessageFlags.IsComponentsV2,

        files: [
          imageFile(
            game,
            status,
            true,
          ),
        ],

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

  /*
   * If the selected starting player cards
   * already make 21, resolve the game.
   */
  if (
    handValue(
      game.playerHand,
    ) === 21
  ) {
    dealerPlay(game);

    const status =
      determineOutcome(game);

    return resolveInitialGame(
      interaction,
      game,
      status,
    );
  }

  /*
   * If the player starts busted because of
   * the selected number of starting cards,
   * resolve immediately.
   */
  if (
    isBust(
      game.playerHand,
    )
  ) {
    return resolveInitialGame(
      interaction,
      game,
      "player_bust",
    );
  }

  const msg =
    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,

      files: [
        imageFile(
          game,
          "active",
          false,
        ),
      ],

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

// ─── Initial game resolver ──────────────────────────────────────────────────────

async function resolveInitialGame(
  interaction: ChatInputCommandInteraction,
  game: BlackjackGame,
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
    const profit =
      Math.floor(
        game.bet * 1.5,
      );

    payout =
      game.bet + profit;

    netDelta = profit;
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

  const msg =
    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,

      files: [
        imageFile(
          game,
          status,
          true,
        ),
      ],

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

    files: [
      imageFile(
        game,
        "active",
        false,
      ),
    ],

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

  const user =
    await getOrCreateUser(
      game.userId,
      "",
    );

  const bal = user.balance;

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
    return void interaction.followUp({
      embeds: [
        errorEmbed(
          "You already have an active Blackjack game!",
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });
  }

  const user =
    await getOrCreateUser(
      userId,
      interaction.user.username,
    );

  if (
    user.balance < bet
  ) {
    return void interaction.followUp({
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
  }

  await addBalance(
    userId,
    -bet,
  );

  /*
   * Play Again uses the same number of starting
   * cards as the finished game.
   */
  const playerCards =
    finished.game.playerHand.length;

  const dealerCards =
    finished.game.dealerHand.length;

  const deck =
    shuffle(
      buildDeck(),
    );

  const game: BlackjackGame = {
    userId,

    displayName:
      interaction.member &&
      "displayName" in interaction.member
        ? interaction.member.displayName
        : interaction.user.globalName ??
          interaction.user.username,

    bet,

    deck,

    playerHand:
      dealCards(
        deck,
        Math.min(
          playerCards,
          MAX_STARTING_CARDS,
        ),
      ),

    dealerHand:
      dealCards(
        deck,
        Math.min(
          dealerCards,
          MAX_STARTING_CARDS,
        ),
      ),

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

    if (!interaction.channel) {
      return;
    }

    const msg =
      await interaction.channel.send({
        flags:
          MessageFlags.IsComponentsV2,

        files: [
          imageFile(
            game,
            status,
            true,
          ),
        ],

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

  if (
    handValue(
      game.playerHand,
    ) === 21
  ) {
    dealerPlay(game);

    if (!interaction.channel) {
      return;
    }

    const status =
      determineOutcome(game);

    const msg =
      await interaction.channel.send({
        flags:
          MessageFlags.IsComponentsV2,

        files: [
          imageFile(
            game,
            status,
            true,
          ),
        ],

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

  if (
    isBust(
      game.playerHand,
    )
  ) {
    if (!interaction.channel) {
      return;
    }

    const msg =
      await interaction.channel.send({
        flags:
          MessageFlags.IsComponentsV2,

        files: [
          imageFile(
            game,
            "player_bust",
            true,
          ),
        ],

        components: [
          buildBlackjackContainer(
            game,
            "player_bust",
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
        status: "player_bust",
      },
    );

    return;
  }

  if (!interaction.channel) {
    return;
  }

  const msg =
    await interaction.channel.send({
      flags:
        MessageFlags.IsComponentsV2,

      files: [
        imageFile(
          game,
          "active",
          false,
        ),
      ],

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