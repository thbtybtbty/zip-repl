
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
  sideBetType: SideBetType | null;
  sideBetAmount: number;
  sideBetMultiplier: number;
  sideBetWon: boolean;
  sideBetPayout: number;
  doubled: boolean;
  messageId: string;
}

type SideBetType = "perfect_pairs" | "21+3";

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

function isRedSuit(suit: string): boolean {
  return suit === "♥" || suit === "♦";
}

function rankNumber(rank: string): number {
  if (rank === "A") return 14;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  return Number(rank);
}

function isThreeCardStraight(cards: Card[]): boolean {
  const values = cards
    .map((card) => rankNumber(card.rank))
    .sort((a, b) => a - b);

  if (new Set(values).size !== 3) return false;

  return (
    values[2]! - values[0]! === 2 ||
    (values[0] === 2 && values[1] === 3 && values[2] === 14)
  );
}

function getPerfectPairsMultiplier(playerHand: Card[]): number {
  const first = playerHand[0];
  const second = playerHand[1];

  if (!first || !second || first.rank !== second.rank) return 0;
  if (first.suit === second.suit) return 25;
  if (isRedSuit(first.suit) === isRedSuit(second.suit)) return 12;
  return 6;
}

function get21Plus3Multiplier(game: BlackjackGame): number {
  const cards = [
    game.playerHand[0],
    game.playerHand[1],
    game.dealerHand[0],
  ];

  if (cards.some((card) => !card)) return 0;

  const sameRank =
    cards[0]!.rank === cards[1]!.rank &&
    cards[1]!.rank === cards[2]!.rank;
  const flush = cards.every(
    (card) => card!.suit === cards[0]!.suit,
  );
  const straight = isThreeCardStraight(cards as Card[]);

  if (sameRank) return 100;
  if (straight && flush) return 40;
  if (straight) return 10;
  if (flush) return 5;
  return 0;
}

function getSideBetMultiplier(game: BlackjackGame): number {
  if (!game.sideBetAmount || !game.sideBetType) return 0;

  return game.sideBetType === "perfect_pairs"
    ? getPerfectPairsMultiplier(game.playerHand)
    : get21Plus3Multiplier(game);
}

function prepareSideBet(game: BlackjackGame): void {
  const multiplier = getSideBetMultiplier(game);

  game.sideBetMultiplier = multiplier;
  game.sideBetWon = multiplier > 0;
  game.sideBetPayout = game.sideBetWon
    ? game.sideBetAmount + game.sideBetAmount * multiplier
    : 0;
}

function getSideBetDetails(game: BlackjackGame): {
  label: string;
  amount: string;
  result: string;
} | null {
  if (!game.sideBetAmount || !game.sideBetType) return null;

  const label =
    game.sideBetType === "perfect_pairs" ? "Perfect Pairs" : "21+3";
  const result = game.sideBetWon
    ? formatAmount(game.sideBetPayout)
    : game.sideBetType === "perfect_pairs"
      ? "No pair"
      : "No match";

  return {
    label,
    amount: formatAmount(game.sideBetAmount),
    result,
  };
}

function getSideBetText(game: BlackjackGame): string | null {
  const details = getSideBetDetails(game);
  return details
    ? `Side bet (${details.label}) ${details.amount}: ${details.result}`
    : null;
}

function getSideBetPanelLine(game: BlackjackGame): string {
  const details = getSideBetDetails(game);
  return details
    ? `\n🎲 **Side bet (${details.label}) ${details.amount}:** \`${details.result}\``
    : "";
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
  const pv = handValue(
    game.playerHand,
  );

  const dv = handValue(
    game.dealerHand,
  );

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
  const sideBetText = getSideBetText(game);

  ctx.font = "bold 21px Arial";

  const betPaddingX = 18;
  const betPaddingY = 8;
  const betTextWidth =
    ctx.measureText(betText).width;
  const sideBetTextWidth = sideBetText
    ? (ctx.font = "bold 17px Arial",
      ctx.measureText(sideBetText).width)
    : 0;

  const betBoxWidth =
    Math.max(betTextWidth, sideBetTextWidth) +
    betPaddingX * 2;

  const betBoxHeight =
    sideBetText
      ? 45
      : 21 + betPaddingY * 2;

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
    sideBetText
      ? betBoxY + 14
      : betBoxY + betBoxHeight / 2,
  );
  if (sideBetText) {
    ctx.font = "bold 17px Arial";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(
      sideBetText,
      IMAGE_WIDTH / 2,
      betBoxY + 34,
    );
  }

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
    88 + 36,
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

  const dealerCardY = sideBetText
    ? DEALER_Y + 15
    : DEALER_Y;

  drawCards(
    ctx,
    game.dealerHand,
    dealerCardY,
    !showDealerFull,
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
    const sideBetLine = getSideBetPanelLine(game);

    container.addTextDisplayComponents(
      createText(
        `💎 **Bet:** \`${formatAmount(
          bet,
        )}\`${game.doubled ? "  *(doubled)*" : ""}\n` +
        `${sideBetLine ? `${sideBetLine}\n` : ""}` +
        `✨ **Multiplier:** \`${multiplier.toFixed(
          2,
        )}x (${formatAmount(
          payout,
        )})\``,
      ),
    );
  } else {
    const sideBetLine = getSideBetPanelLine(game);

    container.addTextDisplayComponents(
      createText(
        `💎 **Bet:** \`${formatAmount(
          bet,
        )}\`${game.doubled ? "  *(doubled)*" : ""}${sideBetLine}`,
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
      )}\`${game.doubled ? "  *(doubled)*" : ""}${getSideBetPanelLine(game)}`,
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

  const sideBetAmount = game.sideBetAmount || 0;
  const sideBetPayout = game.sideBetPayout || 0;
  payout += sideBetPayout;
  netDelta += sideBetPayout - sideBetAmount;

  await addBalance(
    game.userId,
    payout,
  );

  await recordBet(
    game.userId,
    totalStake + sideBetAmount,
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
    .addStringOption(
      (opt) =>
        opt
          .setName("side_bet_amount")
          .setDescription(
            "Optional side bet amount (e.g. 1m, 2.5b)",
          ),
    )
    .addStringOption(
      (opt) =>
        opt
          .setName("side_bet_type")
          .setDescription("Optional side bet type")
          .addChoices(
            {
              name: "Perfect Pairs",
              value: "perfect_pairs",
            },
            {
              name: "21+3",
              value: "21+3",
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

  const sideBetAmountStr =
    interaction.options.getString(
      "side_bet_amount",
    );
  const sideBetType =
    interaction.options.getString(
      "side_bet_type",
    ) as SideBetType | null;

  if (
    Boolean(sideBetType) !==
    Boolean(sideBetAmountStr)
  ) {
    return interaction.reply({
      embeds: [
        errorEmbed(
          "To place a side bet, provide both **side_bet_amount** and **side_bet_type**.",
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });
  }

  const sideBetAmount = sideBetAmountStr
    ? parseAmount(sideBetAmountStr) ?? 0
    : 0;

  if (
    sideBetAmountStr &&
    (!sideBetAmount || sideBetAmount < 1_000_000)
  ) {
    return interaction.reply({
      embeds: [
        errorEmbed(
          "Minimum side bet is **1m gems**. Try `1m`, `2.5b`, `500k`.",
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

  const totalInitialStake =
    amount + sideBetAmount;

  if (
    user.balance < totalInitialStake
  ) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(
            user.balance,
          )} gems**. You need **${formatAmount(
            totalInitialStake,
          )} gems** for the bet and side bet.`,
        ),
      ],
    });
  }

  await addBalance(
    interaction.user.id,
    -totalInitialStake,
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
    playerHand: [
      deal(deck),
      deal(deck),
    ],
    dealerHand: [
      deal(deck),
      deal(deck),
    ],
    sideBetType,
    sideBetAmount,
    sideBetMultiplier: 0,
    sideBetWon: false,
    sideBetPayout: 0,
    doubled: false,
    messageId: "",
  };

  prepareSideBet(game);

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

    payout += game.sideBetPayout;

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

  // Disable the old Play Again button.
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
    playerHand: [
      deal(deck),
      deal(deck),
    ],
    dealerHand: [
      deal(deck),
      deal(deck),
    ],
    sideBetType: null,
    sideBetAmount: 0,
    sideBetMultiplier: 0,
    sideBetWon: false,
    sideBetPayout: 0,
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

    /*
     * IMPORTANT:
     * Use interaction.channel.send() instead of
     * interaction.followUp().
     *
     * This creates a completely normal new Discord
     * message rather than another response/follow-up
     * to the button interaction.
     */
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

  /*
   * IMPORTANT:
   * This is also a normal channel message.
   * It does NOT reply to the old Blackjack game.
   */
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