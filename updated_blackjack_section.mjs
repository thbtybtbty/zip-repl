var blackjack_exports = {};
__export(blackjack_exports, {
  activeBlackjackGames: () => activeBlackjackGames,
  data: () => data8,
  execute: () => execute8,
  handleDouble: () => handleDouble,
  handleHit: () => handleHit,
  handlePlayAgain: () => handlePlayAgain3,
  handleSplit: () => handleSplit,
  handleStand: () => handleStand
});
var import_discord9 = __toESM(require_src2(), 1);
import {
  createCanvas as createCanvas3
} from "@napi-rs/canvas";
var activeBlackjackGames = /* @__PURE__ */ new Map();
var finishedBlackjackGames = /* @__PURE__ */ new Map();
var RANKS = [
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
  "K"
];
var SUITS = ["\u2660", "\u2665", "\u2666", "\u2663"];
function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        rank,
        suit
      });
    }
  }
  return deck;
}
function shuffle2(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(
      Math.random() * (i + 1)
    );
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
function deal(deck) {
  return deck.pop();
}
function cardValue(rank) {
  if (["J", "Q", "K"].includes(rank)) {
    return 10;
  }
  if (rank === "A") {
    return 11;
  }
  return parseInt(rank, 10);
}
function handValue(hand) {
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
function isBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21;
}
function isBust(hand) {
  return handValue(hand) > 21;
}
function isRedSuit(suit) {
  return suit === "\u2665" || suit === "\u2666";
}
function rankNumber(rank) {
  if (rank === "A") return 14;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  return Number(rank);
}
function isThreeCardStraight(cards) {
  const values = cards.map((card) => rankNumber(card.rank)).sort((a, b) => a - b);
  if (new Set(values).size !== 3) return false;
  return values[2] - values[0] === 2 || values[0] === 2 && values[1] === 3 && values[2] === 14;
}
function getPerfectPairsMultiplier(playerHand) {
  const first = playerHand[0];
  const second = playerHand[1];
  if (!first || !second || first.rank !== second.rank) return 0;
  if (first.suit === second.suit) return 25;
  if (isRedSuit(first.suit) === isRedSuit(second.suit)) return 12;
  return 6;
}
function get21Plus3Multiplier(game) {
  const sideBetCards = game.sideBetCards || game.playerHand;
  const cards = [
    sideBetCards[0],
    sideBetCards[1],
    game.dealerHand[0]
  ];
  if (cards.some((card) => !card)) return 0;
  const sameRank = cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank;
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straight = isThreeCardStraight(cards);
  if (sameRank) return 100;
  if (straight && flush) return 40;
  if (straight) return 10;
  if (flush) return 5;
  return 0;
}
function getSideBetMultiplier(game) {
  if (!game.sideBetAmount || !game.sideBetType) return 0;
  const sideBetCards = game.sideBetCards || game.playerHand;
  return game.sideBetType === "perfect_pairs" ? getPerfectPairsMultiplier(sideBetCards) : get21Plus3Multiplier(game);
}
function prepareSideBet(game) {
  const multiplier = getSideBetMultiplier(game);
  game.sideBetMultiplier = multiplier;
  game.sideBetWon = multiplier > 0;
  game.sideBetPayout = game.sideBetWon ? game.sideBetAmount + game.sideBetAmount * multiplier : 0;
}
function getSideBetDetails(game) {
  if (!game.sideBetAmount || !game.sideBetType) return null;
  const label = game.sideBetType === "perfect_pairs" ? "Perfect Pairs" : "21+3";
  const result = game.sideBetWon ? formatAmount(game.sideBetPayout) : game.sideBetType === "perfect_pairs" ? "No pair" : "No match";
  return {
    label,
    amount: formatAmount(game.sideBetAmount),
    result
  };
}
function getSideBetText(game, status) {
  const details = getSideBetDetails(game);
  return details ? `Side bet (${details.label}) ${details.amount}: ${details.result}` : null;
}
function getSideBetPanelLine(game) {
  const details = getSideBetDetails(game);
  return details ? `\n\u{1F3B2} **Side bet (${details.label}) ${details.amount}:** \`${details.result}\`` : "";
}
var sleep2 = (ms) => new Promise(
  (resolve) => setTimeout(resolve, ms)
);
var IMAGE_WIDTH2 = 1200;
var IMAGE_HEIGHT2 = 650;
var CARD_WIDTH = 125;
var CARD_HEIGHT = 175;
var CARD_GAP = 12;
var DEALER_Y = 125;
var PLAYER_Y = 405;
var CARD_TEXT_SAFE_RIGHT = 300;
var CARD_RIGHT_MARGIN = 70;
function suitColor(suit) {
  return suit === "\u2665" || suit === "\u2666" ? "#e53935" : "#111111";
}
function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(
    x,
    y,
    width,
    height,
    radius
  );
  ctx.fill();
}
function drawCard(ctx, card, x, y, width, height) {
  ctx.save();
  const color = suitColor(card.suit);
  ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
  drawRoundedRect(
    ctx,
    x + 6,
    y + 8,
    width,
    height,
    16
  );
  ctx.fillStyle = "#ffffff";
  drawRoundedRect(
    ctx,
    x,
    y,
    width,
    height,
    16
  );
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(
    x,
    y,
    width,
    height,
    16
  );
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const topRankFont = card.rank === "10" ? "bold 31px Arial" : "bold 35px Arial";
  ctx.font = topRankFont;
  ctx.fillText(
    card.rank,
    x + 15,
    y + 13
  );
  const rankWidth = ctx.measureText(card.rank).width;
  ctx.font = "27px Arial";
  ctx.fillText(
    card.suit,
    x + 18 + rankWidth,
    y + 16
  );
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "82px Arial";
  ctx.fillText(
    card.suit,
    x + width / 2,
    y + height / 2 + 2
  );
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  const bottomRankFont = card.rank === "10" ? "bold 31px Arial" : "bold 35px Arial";
  ctx.font = bottomRankFont;
  ctx.fillText(
    card.rank,
    x + width - 15,
    y + height - 13
  );
  const bottomRankWidth = ctx.measureText(card.rank).width;
  ctx.font = "27px Arial";
  ctx.fillText(
    card.suit,
    x + width - 18 - bottomRankWidth,
    y + height - 16
  );
  ctx.restore();
}
function drawHiddenCard(ctx, x, y, width, height) {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  drawRoundedRect(
    ctx,
    x + 6,
    y + 8,
    width,
    height,
    16
  );
  ctx.fillStyle = "#172554";
  drawRoundedRect(
    ctx,
    x,
    y,
    width,
    height,
    16
  );
  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(
    x + 9,
    y + 9,
    width - 18,
    height - 18,
    11
  );
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.5;
  for (let i = -height; i < width; i += 22) {
    ctx.beginPath();
    ctx.moveTo(
      x + i,
      y
    );
    ctx.lineTo(
      x + i + height,
      y + height
    );
    ctx.stroke();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 58px Arial";
  ctx.fillText(
    "\u2660",
    x + width / 2,
    y + height / 2
  );
  ctx.restore();
}
function drawCards(ctx, hand, y, hiddenSecondCard) {
  if (hand.length === 0) {
    return;
  }
  let cardWidth = CARD_WIDTH;
  let cardHeight = CARD_HEIGHT;
  let gap = CARD_GAP;
  const rightEdge = IMAGE_WIDTH2 - CARD_RIGHT_MARGIN;
  let totalWidth = hand.length * cardWidth + Math.max(0, hand.length - 1) * gap;
  let startX = (IMAGE_WIDTH2 - totalWidth) / 2;
  if (startX < CARD_TEXT_SAFE_RIGHT) {
    const availableWidth = rightEdge - CARD_TEXT_SAFE_RIGHT;
    const availableForCards = availableWidth - Math.max(0, hand.length - 1) * gap;
    if (availableForCards > 0) {
      const requiredCardWidth = availableForCards / hand.length;
      if (requiredCardWidth < cardWidth) {
        cardWidth = Math.floor(
          requiredCardWidth
        );
        cardHeight = Math.floor(
          cardWidth * 1.4
        );
        totalWidth = hand.length * cardWidth + Math.max(0, hand.length - 1) * gap;
        startX = (IMAGE_WIDTH2 - totalWidth) / 2;
      }
    }
  }
  if (startX < CARD_TEXT_SAFE_RIGHT) {
    gap = 7;
    const availableWidth = rightEdge - CARD_TEXT_SAFE_RIGHT;
    const availableForCards = availableWidth - Math.max(0, hand.length - 1) * gap;
    if (availableForCards > 0) {
      const requiredCardWidth = availableForCards / hand.length;
      if (requiredCardWidth < cardWidth) {
        cardWidth = Math.floor(
          requiredCardWidth
        );
        cardHeight = Math.floor(
          cardWidth * 1.4
        );
      }
      totalWidth = hand.length * cardWidth + Math.max(0, hand.length - 1) * gap;
      startX = (IMAGE_WIDTH2 - totalWidth) / 2;
    }
  }
  if (startX < CARD_TEXT_SAFE_RIGHT) {
    const stackAvailableWidth = rightEdge - CARD_TEXT_SAFE_RIGHT;
    const stackOverlap =
      hand.length > 1
        ? Math.max(
            28,
            Math.min(
              50,
              (stackAvailableWidth - CARD_WIDTH) /
                (hand.length - 1)
            )
          )
        : 0;
    drawStackedCards(
      ctx,
      hand,
      CARD_TEXT_SAFE_RIGHT,
      y,
      stackOverlap,
      hiddenSecondCard
    );
    return;
  }
  hand.forEach(
    (card, index) => {
      const x = startX + index * (cardWidth + gap);
      if (hiddenSecondCard && index === 1) {
        drawHiddenCard(
          ctx,
          x,
          y,
          cardWidth,
          cardHeight
        );
      } else {
        drawCard(
          ctx,
          card,
          x,
          y,
          cardWidth,
          cardHeight
        );
      }
    }
  );
}
function drawStackedCards(
  ctx,
  hand,
  x,
  y,
  overlap = 50,
  hiddenSecondCard = false
) {
  hand.forEach((card, index) => {
    const cardX = x + index * overlap;
    if (hiddenSecondCard && index === 1) {
      drawHiddenCard(
        ctx,
        cardX,
        y,
        CARD_WIDTH,
        CARD_HEIGHT
      );
    } else {
      drawCard(
        ctx,
        card,
        cardX,
        y,
        CARD_WIDTH,
        CARD_HEIGHT
      );
    }
  });
}
function isSplitGame(game) {
  return Array.isArray(game.playerHands) && game.playerHands.length === 2;
}
function currentPlayerHand(game) {
  if (isSplitGame(game)) {
    return game.playerHands[game.activeHandIndex] || game.playerHand;
  }
  return game.playerHand;
}
function currentDoubled(game) {
  return isSplitGame(game)
    ? Boolean(game.handDoubled && game.handDoubled[game.activeHandIndex])
    : Boolean(game.doubled);
}
function syncCurrentHand(game) {
  if (!isSplitGame(game)) return;
  game.playerHand = game.playerHands[game.activeHandIndex];
  game.doubled = Boolean(game.handDoubled[game.activeHandIndex]);
}
function canSplitHand(game) {
  const hand = currentPlayerHand(game);
  return (
    !isSplitGame(game) &&
    hand.length === 2 &&
    hand[0].rank === hand[1].rank
  );
}
function canDoubleHand(game) {
  return (
    !isSplitGame(game) &&
    currentPlayerHand(game).length === 2 &&
    !currentDoubled(game)
  );
}
function handResultLabel(status) {
  switch (status) {
    case "player_win":
    case "dealer_bust":
      return "Won";
    case "push":
      return "Push";
    case "standing":
      return "Standing";
    case "player_bust":
    case "dealer_win":
      return "Lost";
    default:
      return "Playing";
  }
}
function handResultColor(status) {
  switch (status) {
    case "player_win":
    case "dealer_bust":
      return "#4ade80";
    case "push":
      return "#facc15";
    case "player_bust":
    case "dealer_win":
      return "#ff5c5c";
    default:
      return "#ffffff";
  }
}
function getSplitImageResult(game) {
  return game.handStatuses
    .map(
      (status, index) =>
        `Hand ${index + 1}: ${handResultLabel(status)}`
    )
    .join("  •  ");
}
function getImageResult(status) {
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
    case "split":
      return "- SPLIT";
    default:
      return "";
  }
}
function getResultText(game, status) {
  if (status === "split") {
    return getSplitImageResult(game);
  }
  const pv = handValue(
    game.playerHand
  );
  const dv = handValue(
    game.dealerHand
  );
  switch (status) {
    case "player_bust":
      return `You busted with ${pv}.`;
    case "dealer_bust":
      return `The dealer busted with ${dv}.`;
    case "player_win":
      return `You beat the dealer, ${pv} to ${dv}.`;
    case "dealer_win":
      if (isBlackjack(game.dealerHand) && pv === 21 && !isBlackjack(game.playerHand)) {
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
function getHandLabelColors(status) {
  if (status === "active") {
    return {
      dealer: "#ffffff",
      player: "#ffffff"
    };
  }
  if (status === "dealer_win" || status === "player_bust") {
    return {
      dealer: "#4ade80",
      player: "#ff5c5c"
    };
  }
  if (status === "player_win" || status === "dealer_bust" || status === "blackjack") {
    return {
      dealer: "#ff5c5c",
      player: "#4ade80"
    };
  }
  if (status === "push") {
    return {
      dealer: "#4ade80",
      player: "#4ade80"
    };
  }
  return {
    dealer: "#ffffff",
    player: "#ffffff"
  };
}
function drawResultOverlay(ctx, text11) {
  if (!text11) {
    return;
  }
  ctx.save();
  ctx.font = "bold 23px Arial";
  const paddingX = 24;
  const paddingY = 12;
  const textWidth = ctx.measureText(text11).width;
  const boxWidth = textWidth + paddingX * 2;
  const boxHeight = 48;
  const x = (IMAGE_WIDTH2 - boxWidth) / 2;
  const y = 592;
  ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
  drawRoundedRect(
    ctx,
    x,
    y,
    boxWidth,
    boxHeight,
    14
  );
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(
    x,
    y,
    boxWidth,
    boxHeight,
    14
  );
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 23px Arial";
  ctx.fillText(
    text11,
    IMAGE_WIDTH2 / 2,
    y + boxHeight / 2
  );
  ctx.restore();
}
function blackjackImage(game, status, showDealerFull) {
  const canvas = createCanvas3(
    IMAGE_WIDTH2,
    IMAGE_HEIGHT2
  );
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#071a12";
  ctx.fillRect(
    0,
    0,
    IMAGE_WIDTH2,
    IMAGE_HEIGHT2
  );
  ctx.fillStyle = "#0b3d2e";
  ctx.beginPath();
  ctx.roundRect(
    25,
    25,
    IMAGE_WIDTH2 - 50,
    IMAGE_HEIGHT2 - 50,
    30
  );
  ctx.fill();
  ctx.strokeStyle = "#c9a227";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "bold 34px Arial";
  const title = status === "active" ? "BLACKJACK" : `BLACKJACK ${getImageResult(status)}`;
  ctx.fillText(
    title,
    IMAGE_WIDTH2 / 2,
    43
  );
  const displayedBet = isSplitGame(game)
    ? game.bet * 2
    : game.bet * (currentDoubled(game) ? 2 : 1);
  const betText = isSplitGame(game)
    ? `Bet: ${formatAmount(displayedBet)} (split)`
    : `Bet: ${formatAmount(displayedBet)}${currentDoubled(game) ? " (doubled)" : ""}`;
  const sideBetText = getSideBetText(game, status);
  ctx.font = "bold 21px Arial";
  const betPaddingX = 18;
  const betPaddingY = 8;
  const betTextWidth = ctx.measureText(betText).width;
  const sideBetTextWidth = sideBetText ? (ctx.font = "bold 21px Arial", ctx.measureText(sideBetText).width) : 0;
  const betBoxWidth = Math.max(betTextWidth, sideBetTextWidth) + betPaddingX * 2;
  const betBoxHeight = sideBetText ? 45 : 21 + betPaddingY * 2;
  const betBoxX = (IMAGE_WIDTH2 - betBoxWidth) / 2;
  const betBoxY = 78;
  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  drawRoundedRect(
    ctx,
    betBoxX,
    betBoxY,
    betBoxWidth,
    betBoxHeight,
    10
  );
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 21px Arial";
  ctx.fillText(
    betText,
    IMAGE_WIDTH2 / 2,
    sideBetText ? betBoxY + 14 : betBoxY + betBoxHeight / 2
  );
  if (sideBetText) {
    ctx.font = "bold 21px Arial";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(
      sideBetText,
      IMAGE_WIDTH2 / 2,
      betBoxY + 34
    );
  }
  const handColors = getHandLabelColors(status);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 25px Arial";
  ctx.fillStyle = handColors.dealer;
  ctx.fillText(
    "DEALER",
    70,
    88 + 36
  );
  const dealerValue = showDealerFull ? handValue(
    game.dealerHand
  ) : "?";
  ctx.font = "bold 22px Arial";
  ctx.fillText(
    `Value: ${dealerValue}`,
    70,
    159
  );
  if (showDealerFull && isBust(game.dealerHand)) {
    ctx.fillStyle = "#ff5c5c";
    ctx.fillText(
      "BUST",
      205,
      159
    );
  }
  const dealerCardY = sideBetText ? DEALER_Y + 15 : DEALER_Y;
  drawCards(
    ctx,
    game.dealerHand,
    dealerCardY,
    !showDealerFull
  );
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(
    70,
    335
  );
  ctx.lineTo(
    IMAGE_WIDTH2 - 70,
    335
  );
  ctx.stroke();
  if (isSplitGame(game)) {
    const splitSections = [
      { hand: game.playerHands[0], x: 70, index: 0 },
      { hand: game.playerHands[1], x: 640, index: 1 }
    ];
    splitSections.forEach(({ hand, x, index }) => {
      const statusForHand = game.handStatuses?.[index] || "active";
      const isActive =
        statusForHand === "active" &&
        game.activeHandIndex === index;
      ctx.fillStyle = handResultColor(statusForHand);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const handLabelX = x + (isActive ? 48 : 0);
      if (isActive) {
        ctx.fillStyle = "#facc15";
        drawRoundedRect(
          ctx,
          x - 8,
          344,
          42,
          30,
          8
        );
        ctx.fillStyle = "#071a12";
        ctx.beginPath();
        ctx.moveTo(x + 2, 354);
        ctx.lineTo(x + 18, 354);
        ctx.lineTo(x + 18, 349);
        ctx.lineTo(x + 32, 359);
        ctx.lineTo(x + 18, 369);
        ctx.lineTo(x + 18, 364);
        ctx.lineTo(x + 2, 364);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = handResultColor(statusForHand);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = "bold 22px Arial";
      ctx.fillText(
        `YOUR HAND ${index + 1}`,
        handLabelX,
        350
      );
      ctx.font = "bold 20px Arial";
      ctx.fillText(
        `Value: ${handValue(hand)}`,
        x,
        378
      );
      if (isBust(hand)) {
        ctx.fillStyle = "#ff5c5c";
        ctx.fillText(
          "BUST",
          x + 135,
          378
        );
      }
      drawStackedCards(
        ctx,
        hand,
        x,
        PLAYER_Y
      );
    });
  } else {
    ctx.fillStyle = handColors.player;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "bold 25px Arial";
    ctx.fillText(
      "YOUR HAND",
      70,
      350
    );
    const playerValue = handValue(
      game.playerHand
    );
    ctx.font = "bold 22px Arial";
    ctx.fillText(
      `Value: ${playerValue}`,
      70,
      378
    );
    if (isBust(
      game.playerHand
    )) {
      ctx.fillStyle = "#ff5c5c";
      ctx.fillText(
        "BUST",
        205,
        378
      );
    }
    drawCards(
      ctx,
      game.playerHand,
      PLAYER_Y,
      false
    );
  }
  if (status !== "active") {
    drawResultOverlay(
      ctx,
      getResultText(
        game,
        status
      )
    );
  }
  return canvas.toBuffer(
    "image/png"
  );
}
function imageComponent() {
  return new import_discord9.MediaGalleryBuilder().addItems(
    new import_discord9.MediaGalleryItemBuilder().setURL(
      "attachment://blackjack.png"
    )
  );
}
function createText(content) {
  return new import_discord9.TextDisplayBuilder().setContent(content);
}
function createDivider() {
  return new import_discord9.SeparatorBuilder();
}
function buildComponents(game, disabled) {
  const canDouble = !disabled && canDoubleHand(game);
  const canSplit = !disabled && canSplitHand(game);
  const buttons = [
    new import_discord9.ButtonBuilder().setCustomId("bj_hit").setLabel("\u2795  Hit").setStyle(import_discord9.ButtonStyle.Primary).setDisabled(disabled),
    new import_discord9.ButtonBuilder().setCustomId("bj_stand").setLabel("\u270B  Stand").setStyle(import_discord9.ButtonStyle.Secondary).setDisabled(disabled)
  ];
  if (canDouble) {
    buttons.push(
      new import_discord9.ButtonBuilder().setCustomId("bj_double").setLabel("\u2B06\uFE0F  Double").setStyle(import_discord9.ButtonStyle.Success)
    );
  }
  if (canSplit) {
    buttons.push(
      new import_discord9.ButtonBuilder().setCustomId("bj_split").setLabel("\u{1F500}  Split").setStyle(import_discord9.ButtonStyle.Success)
    );
  }
  return new import_discord9.ActionRowBuilder().addComponents(...buttons);
}
function playAgainRow(userId, bet, disabled = false) {
  return new import_discord9.ActionRowBuilder().addComponents(
    new import_discord9.ButtonBuilder().setCustomId(
      `pa_bj_${userId}_${bet}`
    ).setLabel("\u{1F504}  Play Again").setStyle(import_discord9.ButtonStyle.Secondary).setDisabled(disabled)
  );
}
function buildBlackjackContainer(game, status, showGameplayButtons, playAgainDisabled = false) {
  const bet = game.bet * (currentDoubled(game) ? 2 : 1);
  const payout = status === "blackjack" ? game.bet + Math.floor(
    game.bet * 1.5
  ) : status === "player_win" || status === "dealer_bust" ? bet * 2 : status === "push" ? bet : 0;
  const multiplier = bet > 0 ? payout / bet : 0;
  const statusMeta = {
    active: {
      color: COLORS.primary,
      title: `\u{1F0CF} ${game.displayName}'s Blackjack game`
    },
    player_bust: {
      color: COLORS.danger,
      title: "\u{1F0CF} Blackjack - YOU LOST"
    },
    dealer_bust: {
      color: COLORS.success,
      title: "\u{1F0CF} Blackjack - YOU WON"
    },
    player_win: {
      color: COLORS.success,
      title: "\u{1F0CF} Blackjack - YOU WON"
    },
    dealer_win: {
      color: COLORS.danger,
      title: "\u{1F0CF} Blackjack - YOU LOST"
    },
    push: {
      color: COLORS.warning,
      title: "\u{1F0CF} Blackjack - PUSH"
    },
    blackjack: {
      color: COLORS.gold,
      title: "\u{1F0CF} Blackjack - BLACKJACK WIN"
    },
    split: {
      color: COLORS.primary,
      title: "\u{1F0CF} Blackjack - SPLIT RESULTS"
    }
  };
  const meta = statusMeta[status];
  const container = new import_discord9.ContainerBuilder().setAccentColor(
    meta.color
  );
  container.addTextDisplayComponents(
    createText(
      `## ${meta.title}`
    )
  );
  if (status === "player_win" || status === "dealer_bust" || status === "push" || status === "blackjack") {
    const sideBetLine = getSideBetPanelLine(game);
    container.addTextDisplayComponents(
      createText(
        `\u{1F48E} **Bet:** \`${formatAmount(
          bet
        )}\`${currentDoubled(game) ? "  *(doubled)*" : ""}${sideBetLine}
\u2728 **Multiplier:** \`${multiplier.toFixed(
          2
        )}x (${formatAmount(
          payout
        )})\``
      )
    );
  } else {
    const sideBetLine = getSideBetPanelLine(game);
    container.addTextDisplayComponents(
      createText(
        `\u{1F48E} **Bet:** \`${formatAmount(
          bet
        )}\`${currentDoubled(game) ? "  *(doubled)*" : ""}${sideBetLine}`
      )
    );
  }
  container.addSeparatorComponents(
    createDivider()
  );
  container.addMediaGalleryComponents(
    imageComponent()
  );
  if (showGameplayButtons) {
    container.addActionRowComponents(
      buildComponents(
        game,
        false
      )
    );
  } else {
    container.addActionRowComponents(
      playAgainRow(
        game.userId,
        game.bet,
        playAgainDisabled
      )
    );
  }
  return container;
}
function buildContainerAnimating(game, shownDealerCards) {
  const bet = game.bet * (currentDoubled(game) ? 2 : 1);
  const tempGame = {
    ...game,
    dealerHand: shownDealerCards
  };
  const container = new import_discord9.ContainerBuilder().setAccentColor(
    COLORS.primary
  );
  container.addTextDisplayComponents(
    createText(
      `## \u{1F0CF} ${game.displayName}'s Blackjack game`
    )
  );
  container.addTextDisplayComponents(
    createText(
      `\u{1F48E} **Bet:** \`${formatAmount(
        bet
        )}\`${currentDoubled(game) ? "  *(doubled)*" : ""}${getSideBetText(game, "active") ? `\n\u{1F3B2} **${getSideBetText(game, "active")}**` : ""}`
    )
  );
  container.addSeparatorComponents(
    createDivider()
  );
  container.addMediaGalleryComponents(
    imageComponent()
  );
  container.addActionRowComponents(
    buildComponents(
      tempGame,
      true
    )
  );
  return container;
}
function imageFile(game, status, showDealerFull) {
  return new import_discord9.AttachmentBuilder(
    blackjackImage(
      game,
      status,
      showDealerFull
    ),
    {
      name: "blackjack.png"
    }
  );
}
function dealerPlay(game) {
  while (handValue(game.dealerHand) < 17) {
    game.dealerHand.push(
      deal(game.deck)
    );
  }
}
function determineSingleHandOutcome(game, hand, allowBlackjack) {
  const playerBJ = allowBlackjack && isBlackjack(hand);
  const dealerBJ = isBlackjack(
    game.dealerHand
  );
  if (dealerBJ) {
    return playerBJ ? "push" : "dealer_win";
  }
  if (isBust(hand)) {
    return "player_bust";
  }
  if (isBust(
    game.dealerHand
  )) {
    return "dealer_bust";
  }
  const pv = handValue(
    hand
  );
  const dv = handValue(
    game.dealerHand
  );
  return pv > dv ? "player_win" : pv === dv ? "push" : "dealer_win";
}
function determineOutcome(game) {
  if (isSplitGame(game)) {
    game.handResults = game.playerHands.map(
      (hand) => determineSingleHandOutcome(game, hand, false)
    );
    return "split";
  }
  return determineSingleHandOutcome(game, game.playerHand, true);
}
async function finishCurrentHand(game, interaction, handStatus) {
  if (!isSplitGame(game)) {
    dealerPlay(game);
    return resolveGame(
      game,
      interaction,
      handStatus === "player_bust"
        ? handStatus
        : determineOutcome(game)
    );
  }
  game.handStatuses[game.activeHandIndex] = handStatus;
  if (game.activeHandIndex < game.playerHands.length - 1) {
    game.activeHandIndex += 1;
    syncCurrentHand(game);
    await interaction.editReply({
      flags: import_discord9.MessageFlags.IsComponentsV2,
      files: [
        imageFile(
          game,
          "active",
          false
        )
      ],
      components: [
        buildBlackjackContainer(
          game,
          "active",
          true
        )
      ]
    });
    return;
  }
  dealerPlay(game);
  return resolveGame(
    game,
    interaction,
    determineOutcome(game)
  );
}
async function resolveGame(game, interaction, status) {
  activeBlackjackGames.delete(
    game.userId
  );
  const multiplier = currentDoubled(game) ? 2 : 1;
  const totalStake = isSplitGame(game)
    ? game.playerHands.reduce(
        (sum, hand, index) =>
          sum + game.bet + (game.handDoubled[index] ? game.bet : 0),
        0
      )
    : game.bet * multiplier;
  let payout = 0;
  let netDelta = 0;
  if (status === "split") {
    game.handStatuses = game.handResults.map(
      (handResult) => handResult
    );
    game.handResults.forEach((handResult, index) => {
      const handStake =
        game.bet +
        (game.handDoubled[index] ? game.bet : 0);
      if (handResult === "player_win" || handResult === "dealer_bust") {
        payout += handStake * 2;
        netDelta += handStake;
      } else if (handResult === "push") {
        payout += handStake;
      } else {
        netDelta -= handStake;
      }
    });
  } else if (status === "blackjack") {
    const bjProfit = Math.floor(
      game.bet * 1.5
    );
    payout = game.bet + bjProfit;
    netDelta = bjProfit;
  } else if (status === "player_win" || status === "dealer_bust") {
    payout = totalStake * 2;
    netDelta = totalStake;
  } else if (status === "push") {
    payout = totalStake;
    netDelta = 0;
  } else {
    payout = 0;
    netDelta = -totalStake;
  }
  const sideBetAmount = game.sideBetAmount || 0;
  const sideBetPayout = game.sideBetPayout || 0;
  payout += sideBetPayout;
  netDelta += sideBetPayout - sideBetAmount;
  await addBalance(
    game.userId,
    payout
  );
  await recordBet(
    game.userId,
    totalStake + sideBetAmount,
    netDelta,
    "blackjack"
  );
  finishedBlackjackGames.set(
    game.messageId,
    {
      game: {
        ...game,
        deck: [...game.deck],
        playerHand: [
          ...game.playerHand
        ],
        dealerHand: [
          ...game.dealerHand
        ],
        ...(isSplitGame(game)
          ? {
              playerHands: game.playerHands.map(
                (hand) => [...hand]
              ),
              handDoubled: [
                ...game.handDoubled
              ],
              handStatuses: [
                ...game.handStatuses
              ],
              handResults: [
                ...game.handResults
              ]
            }
          : {})
      },
      status
    }
  );
  if (status === "player_bust") {
    await interaction.editReply({
      flags: import_discord9.MessageFlags.IsComponentsV2,
      files: [
        imageFile(
          game,
          status,
          true
        )
      ],
      components: [
        buildBlackjackContainer(
          game,
          status,
          false,
          false
        )
      ]
    });
    return;
  }
  const all = game.dealerHand;
  const firstRevealGame = {
    ...game,
    dealerHand: all.slice(0, 2)
  };
  await interaction.editReply({
    flags: import_discord9.MessageFlags.IsComponentsV2,
    files: [
      imageFile(
        firstRevealGame,
        "active",
        true
      )
    ],
    components: [
      buildContainerAnimating(
        firstRevealGame,
        all.slice(0, 2)
      )
    ]
  });
  for (let i = 2; i < all.length; i++) {
    await sleep2(700);
    const revealGame = {
      ...game,
      dealerHand: all.slice(
        0,
        i + 1
      )
    };
    await interaction.editReply({
      flags: import_discord9.MessageFlags.IsComponentsV2,
      files: [
        imageFile(
          revealGame,
          "active",
          true
        )
      ],
      components: [
        buildContainerAnimating(
          revealGame,
          all.slice(
            0,
            i + 1
          )
        )
      ]
    });
  }
  await sleep2(700);
  await interaction.editReply({
    flags: import_discord9.MessageFlags.IsComponentsV2,
    files: [
      imageFile(
        game,
        status,
        true
      )
    ],
    components: [
      buildBlackjackContainer(
        game,
        status,
        false,
        false
      )
    ]
  });
}
var data8 = new import_discord9.SlashCommandBuilder().setName("blackjack").setDescription(
  "Play Blackjack against the dealer \u2014 get closer to 21!"
).addStringOption(
  (opt) => opt.setName("amount").setDescription(
    "Bet amount (e.g. 1m, 2.5b)"
  ).setRequired(true)
).addStringOption(
  (opt) => opt.setName("side_bet_amount").setDescription(
    "Optional side bet amount (e.g. 1m, 2.5b)"
  )
).addStringOption(
  (opt) => opt.setName("side_bet_type").setDescription(
    "Optional side bet type"
  ).addChoices(
    {
      name: "Perfect Pairs",
      value: "perfect_pairs"
    },
    {
      name: "21+3",
      value: "21+3"
    }
  )
);
async function execute8(interaction) {
  const amountStr = interaction.options.getString(
    "amount",
    true
  );
  const amount = parseAmount(amountStr);
  if (!amount || amount < 1e6) {
    return interaction.reply({
      embeds: [
        errorEmbed(
          "Minimum bet is **1m gems**. Try `1m`, `2.5b`, `500k`."
        )
      ],
      flags: import_discord9.MessageFlags.Ephemeral
    });
  }
  const sideBetType = interaction.options.getString("side_bet_type");
  const sideBetAmountStr = interaction.options.getString("side_bet_amount");
  if (Boolean(sideBetType) !== Boolean(sideBetAmountStr)) {
    return interaction.reply({
      embeds: [
        errorEmbed(
          "To place a side bet, provide both **side_bet_type** and **side_bet_amount**."
        )
      ],
      flags: import_discord9.MessageFlags.Ephemeral
    });
  }
  const sideBetAmount = sideBetAmountStr ? parseAmount(sideBetAmountStr) : 0;
  if (sideBetAmountStr && (!sideBetAmount || sideBetAmount < 1e6)) {
    return interaction.reply({
      embeds: [
        errorEmbed(
          "Minimum side bet is **1m gems**. Try `1m`, `2.5b`, `500k`."
        )
      ],
      flags: import_discord9.MessageFlags.Ephemeral
    });
  }
  await interaction.deferReply();
  if (activeBlackjackGames.has(
    interaction.user.id
  )) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          "You already have an active Blackjack game!"
        )
      ]
    });
  }
  const user = await getOrCreateUser(
    interaction.user.id,
    interaction.user.username
  );
  const totalInitialStake = amount + sideBetAmount;
  if (user.balance < totalInitialStake) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(
            user.balance
          )} gems**. You need **${formatAmount(
            totalInitialStake
          )} gems** for the bet and side bet.`
        )
      ]
    });
  }
  await addBalance(
    interaction.user.id,
    -totalInitialStake
  );
  const deck = shuffle2(
    buildDeck()
  );
  const game = {
    userId: interaction.user.id,
    displayName: interaction.member && "displayName" in interaction.member ? interaction.member.displayName : interaction.user.globalName ?? interaction.user.username,
    bet: amount,
    deck,
    playerHand: [
      deal(deck),
      deal(deck)
    ],
    dealerHand: [
      deal(deck),
      deal(deck)
    ],
    sideBetType,
    sideBetAmount,
    sideBetMultiplier: 0,
    sideBetWon: false,
    sideBetPayout: 0,
    doubled: false,
    messageId: ""
  };
  prepareSideBet(game);
  const playerBJ = isBlackjack(
    game.playerHand
  );
  const dealerBJ = isBlackjack(
    game.dealerHand
  );
  if (playerBJ) {
    activeBlackjackGames.delete(
      interaction.user.id
    );
    let status;
    let payout;
    if (playerBJ && dealerBJ) {
      status = "push";
      payout = amount;
    } else {
      status = "blackjack";
      payout = amount + Math.floor(
        amount * 1.5
      );
    }
    payout += game.sideBetPayout || 0;
    await addBalance(
      interaction.user.id,
      payout
    );
    const msg2 = await interaction.editReply({
      flags: import_discord9.MessageFlags.IsComponentsV2,
      files: [
        imageFile(
          game,
          status,
          true
        )
      ],
      components: [
        buildBlackjackContainer(
          game,
          status,
          false,
          false
        )
      ]
    });
    game.messageId = msg2.id;
    finishedBlackjackGames.set(
      msg2.id,
      {
        game: {
          ...game,
          deck: [
            ...game.deck
          ],
          playerHand: [
            ...game.playerHand
          ],
          dealerHand: [
            ...game.dealerHand
          ]
        },
        status
      }
    );
    return;
  }
  const msg = await interaction.editReply({
    flags: import_discord9.MessageFlags.IsComponentsV2,
    files: [
      imageFile(
        game,
        "active",
        false
      )
    ],
    components: [
      buildBlackjackContainer(
        game,
        "active",
        true
      )
    ]
  });
  game.messageId = msg.id;
  activeBlackjackGames.set(
    interaction.user.id,
    game
  );
}
async function handleHit(interaction) {
  await interaction.deferUpdate();
  const game = activeBlackjackGames.get(
    interaction.user.id
  );
  if (!game) return;
  const hand = currentPlayerHand(game);
  hand.push(
    deal(game.deck)
  );
  if (isSplitGame(game)) {
    if (isBust(hand)) {
      return finishCurrentHand(
        game,
        interaction,
        "player_bust"
      );
    }
    if (handValue(hand) === 21) {
      return finishCurrentHand(
        game,
        interaction,
        "standing"
      );
    }
  }
  if (isBust(
    hand
  )) {
    return resolveGame(
      game,
      interaction,
      "player_bust"
    );
  }
  if (handValue(
    hand
  ) === 21) {
    dealerPlay(game);
    return resolveGame(
      game,
      interaction,
      determineOutcome(
        game
      )
    );
  }
  await interaction.editReply({
    flags: import_discord9.MessageFlags.IsComponentsV2,
    files: [
      imageFile(
        game,
        "active",
        false
      )
    ],
    components: [
      buildBlackjackContainer(
        game,
        "active",
        true
      )
    ]
  });
}
async function handleStand(interaction) {
  await interaction.deferUpdate();
  const game = activeBlackjackGames.get(
    interaction.user.id
  );
  if (!game) return;
  if (isSplitGame(game)) {
    return finishCurrentHand(
      game,
      interaction,
      "standing"
    );
  }
  dealerPlay(game);
  return resolveGame(
    game,
    interaction,
    determineOutcome(
      game
    )
  );
}
async function handleDouble(interaction) {
  await interaction.deferUpdate();
  const game = activeBlackjackGames.get(
    interaction.user.id
  );
  if (!game || !canDoubleHand(game)) {
    return;
  }
  const hand = currentPlayerHand(game);
  const user = await getOrCreateUser(
    game.userId,
    ""
  );
  const bal = user.balance;
  if (bal < game.bet) {
    await interaction.followUp({
      embeds: [
        errorEmbed(
          `Not enough gems to double down. You need **${formatAmount(
            game.bet
          )}** more.`
        )
      ],
      ephemeral: true
    });
    return;
  }
  await addBalance(
    game.userId,
    -game.bet
  );
  if (isSplitGame(game)) {
    game.handDoubled[game.activeHandIndex] = true;
    syncCurrentHand(game);
  } else {
    game.doubled = true;
  }
  hand.push(
    deal(game.deck)
  );
  if (isSplitGame(game)) {
    return finishCurrentHand(
      game,
      interaction,
      isBust(hand) ? "player_bust" : "standing"
    );
  }
  if (isBust(hand)) {
    return resolveGame(
      game,
      interaction,
      "player_bust"
    );
  }
  dealerPlay(game);
  return resolveGame(
    game,
    interaction,
    determineOutcome(
      game
    )
  );
}
async function handleSplit(interaction) {
  await interaction.deferUpdate();
  const game = activeBlackjackGames.get(
    interaction.user.id
  );
  if (!game || !canSplitHand(game)) {
    return;
  }
  const user = await getOrCreateUser(
    game.userId,
    ""
  );
  if (user.balance < game.bet) {
    await interaction.followUp({
      embeds: [
        errorEmbed(
          `Not enough gems to split. You need **${formatAmount(
            game.bet
          )}** more.`
        )
      ],
      ephemeral: true
    });
    return;
  }
  await addBalance(
    game.userId,
    -game.bet
  );
  const firstCard = game.playerHand[0];
  const secondCard = game.playerHand[1];
  game.sideBetCards = game.sideBetCards || [
    firstCard,
    secondCard
  ];
  game.playerHands = [
    [
      firstCard,
      deal(game.deck)
    ],
    [
      secondCard,
      deal(game.deck)
    ]
  ];
  game.handDoubled = [false, false];
  game.handStatuses = ["active", "active"];
  game.handResults = [];
  game.activeHandIndex = 0;
  syncCurrentHand(game);
  await interaction.editReply({
    flags: import_discord9.MessageFlags.IsComponentsV2,
    files: [
      imageFile(
        game,
        "active",
        false
      )
    ],
    components: [
      buildBlackjackContainer(
        game,
        "active",
        true
      )
    ]
  });
}
async function handlePlayAgain3(interaction, userId, betStr) {
  if (interaction.user.id !== userId) {
    return void interaction.reply({
      content: "\u274C This isn't your game.",
      flags: import_discord9.MessageFlags.Ephemeral
    });
  }
  const bet = parseInt(
    betStr,
    10
  );
  const finished = finishedBlackjackGames.get(
    interaction.message.id
  );
  if (!finished) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "This Blackjack game can no longer be replayed."
        )
      ],
      flags: import_discord9.MessageFlags.Ephemeral
    });
  }
  const sideBetType = finished.game.sideBetType;
  const sideBetAmount = finished.game.sideBetAmount || 0;
  const totalInitialStake = bet + sideBetAmount;
  await interaction.update({
    flags: import_discord9.MessageFlags.IsComponentsV2,
    components: [
      buildBlackjackContainer(
        finished.game,
        finished.status,
        false,
        true
      )
    ]
  });
  if (activeBlackjackGames.has(
    userId
  )) {
    return void interaction.followUp({
      embeds: [
        errorEmbed(
          "You already have an active Blackjack game!"
        )
      ],
      flags: import_discord9.MessageFlags.Ephemeral
    });
  }
  const user = await getOrCreateUser(
    userId,
    interaction.user.username
  );
  if (user.balance < totalInitialStake) {
    return void interaction.followUp({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(
            user.balance
          )} gems**. You need **${formatAmount(
            totalInitialStake
          )} gems** for the bet and side bet.`
        )
      ],
      flags: import_discord9.MessageFlags.Ephemeral
    });
  }
  await addBalance(
    userId,
    -totalInitialStake
  );
  const deck = shuffle2(
    buildDeck()
  );
  const game = {
    userId,
    displayName: interaction.member && "displayName" in interaction.member ? interaction.member.displayName : interaction.user.globalName ?? interaction.user.username,
    bet,
    deck,
    playerHand: [
      deal(deck),
      deal(deck)
    ],
    dealerHand: [
      deal(deck),
      deal(deck)
    ],
    sideBetType,
    sideBetAmount,
    sideBetMultiplier: 0,
    sideBetWon: false,
    sideBetPayout: 0,
    doubled: false,
    messageId: ""
  };
  prepareSideBet(game);
  const playerBJ = isBlackjack(
    game.playerHand
  );
  const dealerBJ = isBlackjack(
    game.dealerHand
  );
  if (playerBJ) {
    let status;
    let payout;
    if (playerBJ && dealerBJ) {
      status = "push";
      payout = bet;
    } else {
      status = "blackjack";
      payout = bet + Math.floor(
        bet * 1.5
      );
    }
    await addBalance(
      userId,
      payout
    );
    if (!interaction.channel) {
      return;
    }
    const msg2 = await interaction.channel.send({
      flags: import_discord9.MessageFlags.IsComponentsV2,
      files: [
        imageFile(
          game,
          status,
          true
        )
      ],
      components: [
        buildBlackjackContainer(
          game,
          status,
          false,
          false
        )
      ]
    });
    game.messageId = msg2.id;
    finishedBlackjackGames.set(
      msg2.id,
      {
        game: {
          ...game,
          deck: [
            ...game.deck
          ],
          playerHand: [
            ...game.playerHand
          ],
          dealerHand: [
            ...game.dealerHand
          ]
        },
        status
      }
    );
    return;
  }
  if (!interaction.channel) {
    return;
  }
  const msg = await interaction.channel.send({
    flags: import_discord9.MessageFlags.IsComponentsV2,
    files: [
      imageFile(
        game,
        "active",
        false
      )
    ],
    components: [
      buildBlackjackContainer(
        game,
        "active",
        true
      )
    ]
  });
  game.messageId = msg.id;
  activeBlackjackGames.set(
    userId,
    game
  );
}
