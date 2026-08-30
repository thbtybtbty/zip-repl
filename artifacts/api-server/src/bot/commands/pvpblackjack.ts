import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { createCanvas, type CanvasRenderingContext2D } from "@napi-rs/canvas";
import {
  COLORS,
  addBalance,
  errorEmbed,
  formatAmount,
  getOrCreateUser,
  parseAmount,
  recordBet,
} from "../utils.js";

interface Card {
  rank: string;
  suit: string;
}

type Role = "dealer" | "player";
type RoundStatus =
  | "active"
  | "player_bust"
  | "dealer_bust"
  | "player_win"
  | "dealer_win"
  | "push"
  | "blackjack";

interface Participant {
  id: string;
  displayName: string;
  isBot: boolean;
}

interface PvpRound {
  number: number;
  dealerId: string;
  playerId: string;
  dealerHand: Card[];
  playerHand: Card[];
  deck: Card[];
  doubled: boolean;
  phase: "active" | "resolved";
  status: RoundStatus;
  resultText: string;
}

interface PvpGame {
  creator: Participant;
  opponent?: Participant;
  startingDealerId?: string;
  amount: number;
  rounds: number;
  messageId: string;
  message?: Message;
  phase: "lobby" | "playing" | "finished" | "cancelled";
  dealerRevealing?: boolean;
  currentRound: number;
  round?: PvpRound;
  wins: Record<string, number>;
  extraStake: Record<string, number>;
  roundResult: string;
  winnerId?: string;
  tax: number;
  payout: number;
}

const gamesByMessage = new Map<string, PvpGame>();
const gameByUser = new Map<string, string>();

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];

const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 650;
const CARD_WIDTH = 125;
const CARD_HEIGHT = 175;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

function divider(): SeparatorBuilder {
  return new SeparatorBuilder();
}

function buildDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

function shuffle(deck: Card[]): Card[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function deal(deck: Card[]): Card {
  return deck.pop()!;
}

function cardValue(rank: string): number {
  if (["J", "Q", "K"].includes(rank)) return 10;
  if (rank === "A") return 11;
  return Number.parseInt(rank, 10);
}

function handValue(hand: Card[]): number {
  let total = hand.reduce((sum, card) => sum + cardValue(card.rank), 0);
  let aces = hand.filter((card) => card.rank === "A").length;
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

function participantName(participant: Participant | undefined): string {
  return participant?.displayName ?? "Unknown player";
}

function getParticipant(game: PvpGame, id: string): Participant {
  if (game.creator.id === id) return game.creator;
  return game.opponent!;
}

function getNameById(game: PvpGame, id: string): string {
  return participantName(getParticipant(game, id));
}

function getDisplayName(interaction: ChatInputCommandInteraction | ButtonInteraction): string {
  if (interaction.member && "displayName" in interaction.member) {
    return interaction.member.displayName;
  }
  return interaction.user.globalName ?? interaction.user.username;
}

function suitColor(suit: string): string {
  return suit === "♥" || suit === "♦" ? "#e53935" : "#111111";
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  card: Card,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  roundedRect(ctx, x + 6, y + 8, width, height, 16);
  ctx.fillStyle = "#fffdf7";
  roundedRect(ctx, x, y, width, height, 16);
  ctx.strokeStyle = "#d9d3c3";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = suitColor(card.suit);
  ctx.font = `bold ${Math.max(24, Math.floor(width * 0.25))}px Arial`;
  ctx.fillText(`${card.rank}${card.suit}`, x + width / 2, y + height / 2);
  ctx.restore();
}

function drawHiddenCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  roundedRect(ctx, x + 6, y + 8, width, height, 16);
  ctx.fillStyle = "#172554";
  roundedRect(ctx, x, y, width, height, 16);
  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(x + 9, y + 9, width - 18, height - 18, 11);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 58px Arial";
  ctx.fillText("♠", x + width / 2, y + height / 2);
  ctx.restore();
}

function drawCards(
  ctx: CanvasRenderingContext2D,
  hand: Card[],
  y: number,
  hideSecond: boolean,
) {
  if (hand.length === 0) return;
  const maxWidth = 780;
  const gap = 12;
  const normalWidth = Math.min(
    CARD_WIDTH,
    Math.floor((maxWidth - Math.max(0, hand.length - 1) * gap) / hand.length),
  );
  const normalTotalWidth =
    hand.length * normalWidth +
    Math.max(0, hand.length - 1) * gap;
  const stacked = normalTotalWidth > maxWidth;
  const step = stacked
    ? hand.length > 1
      ? Math.max(
          18,
          Math.min(
            110,
            (maxWidth - CARD_WIDTH) / (hand.length - 1),
          ),
        )
      : 0
    : normalWidth + gap;
  const cardWidth = stacked ? CARD_WIDTH : normalWidth;
  const cardHeight = stacked ? CARD_HEIGHT : Math.floor(normalWidth * 1.4);
  const totalWidth =
    cardWidth + Math.max(0, hand.length - 1) * step;
  const startX = (IMAGE_WIDTH - totalWidth) / 2;

  hand.forEach((card, index) => {
    const x = startX + index * step;
    if (hideSecond && index === 1) {
      drawHiddenCard(ctx, x, y, cardWidth, cardHeight);
    } else {
      drawCard(ctx, card, x, y, cardWidth, cardHeight);
    }
  });
}

function drawOverlay(ctx: CanvasRenderingContext2D, result: string) {
  if (!result) return;
  ctx.save();
  ctx.font = "bold 23px Arial";
  const width = ctx.measureText(result).width + 48;
  ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
  roundedRect(ctx, (IMAGE_WIDTH - width) / 2, 592, width, 48, 14);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(result, IMAGE_WIDTH / 2, 616);
  ctx.restore();
}

function pvpImage(game: PvpGame, showDealerFull: boolean, overlay = ""): Buffer {
  const round = game.round;
  const canvas = createCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#071a12";
  ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  ctx.fillStyle = "#0b3d2e";
  ctx.beginPath();
  ctx.roundRect(25, 25, IMAGE_WIDTH - 50, IMAGE_HEIGHT - 50, 30);
  ctx.fill();
  ctx.strokeStyle = "#c9a227";
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "bold 34px Arial";
  ctx.fillText("🃏 PVP BLACKJACK", IMAGE_WIDTH / 2, 48);
  ctx.font = "bold 22px Arial";
  ctx.fillText(
    `ROUND ${game.currentRound + 1} / ${game.rounds}   •   ${game.roundResult || `Turn: ${round ? getNameById(game, round.playerId) : "Waiting"}`}`,
    IMAGE_WIDTH / 2,
    88,
  );

  if (round) {
    ctx.textAlign = "left";
    ctx.font = "bold 25px Arial";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`DEALER (${getNameById(game, round.dealerId)})`, 70, 105);
    ctx.font = "bold 21px Arial";
    ctx.fillText(
      `Value: ${showDealerFull ? handValue(round.dealerHand) : "?"}`,
      70,
      135,
    );
    drawCards(ctx, round.dealerHand, 160, !showDealerFull);

    ctx.beginPath();
    ctx.moveTo(70, 335);
    ctx.lineTo(IMAGE_WIDTH - 70, 335);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 25px Arial";
    ctx.fillText(`PLAYER (${getNameById(game, round.playerId)})`, 70, 350);
    ctx.font = "bold 21px Arial";
    ctx.fillText(`Value: ${handValue(round.playerHand)}`, 70, 378);
    drawCards(ctx, round.playerHand, 405, false);
  }

  ctx.textAlign = "right";
  ctx.font = "bold 18px Arial";
  ctx.fillStyle = "#e7d48a";
  ctx.fillText(`Stake: ${formatAmount(game.amount)} each  •  Tax: 5%`, IMAGE_WIDTH - 70, 55);
  drawOverlay(ctx, overlay);
  return canvas.toBuffer("image/png");
}

function imageFile(game: PvpGame, showDealerFull: boolean, overlay = ""): AttachmentBuilder {
  return new AttachmentBuilder(pvpImage(game, showDealerFull, overlay), { name: "pvpblackjack.png" });
}

function roleForRound(game: PvpGame, roundNumber: number): { dealerId: string; playerId: string } {
  if (!game.startingDealerId) {
    game.startingDealerId = Math.random() < 0.5 ? game.creator.id : game.opponent!.id;
  }
  const firstDealer = roundNumber % 2 === 1
    ? game.startingDealerId
    : game.startingDealerId === game.creator.id
      ? game.opponent!.id
      : game.creator.id;
  return {
    dealerId: firstDealer,
    playerId: firstDealer === game.creator.id ? game.opponent!.id : game.creator.id,
  };
}

function startRound(game: PvpGame) {
  const deck = shuffle(buildDeck());
  const roles = roleForRound(game, game.currentRound + 1);
  const round: PvpRound = {
    number: game.currentRound + 1,
    dealerId: roles.dealerId,
    playerId: roles.playerId,
    dealerHand: [deal(deck), deal(deck)],
    playerHand: [deal(deck), deal(deck)],
    deck,
    doubled: false,
    phase: "active",
    status: "active",
    resultText: "",
  };
  game.round = round;
  game.phase = "playing";
  game.roundResult = "";
  game.dealerRevealing = false;

  if (isBlackjack(round.playerHand)) {
    dealerPlay(round);
    resolveRound(game, isBlackjack(round.dealerHand) ? "push" : "blackjack");
  }
}

function dealerPlay(round: PvpRound) {
  while (handValue(round.dealerHand) < 17) {
    round.dealerHand.push(deal(round.deck));
  }
}

function determineRoundStatus(round: PvpRound): RoundStatus {
  if (isBust(round.playerHand)) return "player_bust";
  if (isBlackjack(round.playerHand) && !isBlackjack(round.dealerHand)) return "blackjack";
  if (isBlackjack(round.dealerHand)) {
    return isBlackjack(round.playerHand) ? "push" : "dealer_win";
  }
  if (isBust(round.dealerHand)) return "dealer_bust";

  const player = handValue(round.playerHand);
  const dealer = handValue(round.dealerHand);
  return player > dealer ? "player_win" : player === dealer ? "push" : "dealer_win";
}

function roundWinnerId(game: PvpGame, status: RoundStatus): string | undefined {
  const round = game.round!;
  if (status === "player_win" || status === "dealer_bust" || status === "blackjack") {
    return round.playerId;
  }
  if (status === "dealer_win" || status === "player_bust") {
    return round.dealerId;
  }
  return undefined;
}

function roundResultText(game: PvpGame, status: RoundStatus): string {
  const round = game.round!;
  const player = getNameById(game, round.playerId);
  const dealer = getNameById(game, round.dealerId);
  const pv = handValue(round.playerHand);
  const dv = handValue(round.dealerHand);
  if (status === "player_bust") return `${player} busted with ${pv}. ${dealer} wins the round.`;
  if (status === "dealer_bust") return `${dealer} busted with ${dv}. ${player} wins the round.`;
  if (status === "blackjack") return `${player} has Blackjack and wins the round.`;
  if (status === "player_win") return `${player} wins ${pv} to ${dv}.`;
  if (status === "dealer_win") return `${dealer} wins ${dv} to ${pv}.`;
  return `Push — both hands finished on ${pv}.`;
}

function resolveRound(game: PvpGame, status: RoundStatus) {
  const round = game.round!;
  if (round.phase === "resolved") return;
  round.phase = "resolved";
  round.status = status;
  round.resultText = roundResultText(game, status);
  game.roundResult = round.resultText;
  const winner = roundWinnerId(game, status);
  if (winner) game.wins[winner] = (game.wins[winner] ?? 0) + 1;
}

function totalStake(game: PvpGame, participant: Participant): number {
  return game.amount + (game.extraStake[participant.id] ?? 0);
}

function matchWinner(game: PvpGame): string | undefined {
  const creatorWins = game.wins[game.creator.id] ?? 0;
  const opponentWins = game.wins[game.opponent!.id] ?? 0;
  if (creatorWins === opponentWins) return undefined;
  return creatorWins > opponentWins ? game.creator.id : game.opponent!.id;
}

async function settleGame(game: PvpGame): Promise<void> {
  game.phase = "finished";
  game.winnerId = matchWinner(game);
  const creatorStake = totalStake(game, game.creator);
  const opponentStake = totalStake(game, game.opponent!);
  const pot = creatorStake + opponentStake;
  game.tax = game.winnerId ? Math.floor(pot * 0.05) : 0;
  game.payout = game.winnerId ? pot - game.tax : 0;

  const humans = [game.creator, game.opponent!].filter((participant) => !participant.isBot);
  for (const participant of humans) {
    const stake = totalStake(game, participant);
    const payout = game.winnerId === undefined
      ? stake
      : game.winnerId === participant.id
        ? game.payout
        : 0;
    const netDelta = payout - stake;
    if (payout > 0) await addBalance(participant.id, payout);
    await recordBet(participant.id, stake, netDelta, "pvpblackjack");
  }

  gamesByMessage.delete(game.messageId);
  gameByUser.delete(game.creator.id);
  if (game.opponent && !game.opponent.isBot) gameByUser.delete(game.opponent.id);
}

function lobbyContainer(game: PvpGame): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(COLORS.primary)
    .addTextDisplayComponents(text("## 🃏 PvP Blackjack"))
    .addTextDisplayComponents(
      text(
        [
          `👤 **Host**  ${participantName(game.creator)}`,
          `💎 **Bet per player**  \`${formatAmount(game.amount)}\``,
          `🔁 **Rounds**  \`${game.rounds}\``,
          "🏦 **Tax**  `5% of the final pot`",
          "",
          "A second player must join with the same stake. Dealer and player roles alternate every round.",
          "Choose **Join Game** to play against the host, or **Call Bot** to play against the bot.",
        ].join("\n"),
      ),
    )
    .addSeparatorComponents(divider())
    .addActionRowComponents(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("pvpbj_join")
          .setLabel("👥  Join Game")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("pvpbj_bot")
          .setLabel("🤖  Call Bot")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("pvpbj_cancel")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
}

function activeContainer(game: PvpGame): ContainerBuilder {
  const round = game.round!;
  const player = getParticipant(game, round.playerId);
  const dealer = getParticipant(game, round.dealerId);
  const container = new ContainerBuilder()
    .setAccentColor(COLORS.primary)
    .addTextDisplayComponents(
      text(`## 🃏 PvP Blackjack — Round ${round.number}/${game.rounds}`),
    )
    .addTextDisplayComponents(
      text(
        [
          `💎 **Stake each**  \`${formatAmount(game.amount)}\``,
          "🏦 **Tax**  `5% of the final pot`",
          `🏆 **Score**  ${getNameById(game, game.creator.id)} \`${game.wins[game.creator.id] ?? 0}\` — ${getNameById(game, game.opponent!.id)} \`${game.wins[game.opponent!.id] ?? 0}\``,
        ].join("\n"),
      ),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      text(
        [
          `🎲 **Dealer**  ${participantName(dealer)}`,
          `🎯 **Player**  ${participantName(player)}`,
          `🕐 **Turn**  ${participantName(player)}`,
          game.roundResult ? `📣 **Round result**  ${game.roundResult}` : "",
        ].filter(Boolean).join("\n"),
      ),
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL("attachment://pvpblackjack.png"),
      ),
    );

  if (!player.isBot) {
    const buttonsDisabled =
      round.phase !== "active" ||
      game.dealerRevealing === true;
    container.addActionRowComponents(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("pvpbj_hit")
          .setLabel("➕  Hit")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(buttonsDisabled),
        new ButtonBuilder()
          .setCustomId("pvpbj_stand")
          .setLabel("✋  Stand")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(buttonsDisabled),
      ),
    );
  }
  return container;
}

function finalContainer(game: PvpGame): ContainerBuilder {
  const tied = !game.winnerId;
  const winnerName = game.winnerId ? getNameById(game, game.winnerId) : "Nobody";
  const status = tied ? "PUSH" : `${winnerName} WINS`;
  const creatorStake = totalStake(game, game.creator);
  const opponentStake = totalStake(game, game.opponent!);
  const score = `${getNameById(game, game.creator.id)} ${game.wins[game.creator.id] ?? 0} — ${game.wins[game.opponent!.id] ?? 0} ${getNameById(game, game.opponent!.id)}`;
  const payoutText = tied
    ? `Each player was refunded their stake.`
    : `💰 **Winner payout**  \`${formatAmount(game.payout)}\`  *(after ${formatAmount(game.tax)} tax)*`;

  return new ContainerBuilder()
    .setAccentColor(tied ? COLORS.warning : COLORS.success)
    .addTextDisplayComponents(text(`## 🃏 PvP Blackjack — ${status}`))
    .addTextDisplayComponents(
      text(
        [
          `🏆 **Final score**  ${score}`,
          `💎 **Pot**  \`${formatAmount(creatorStake + opponentStake)}\``,
          `🏦 **Tax**  \`${formatAmount(game.tax)}\`  *(5%)*`,
          payoutText,
        ].join("\n"),
      ),
    )
    .addSeparatorComponents(divider())
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL("attachment://pvpblackjack.png"),
      ),
    );
}

function cancelledContainer(game: PvpGame): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(COLORS.danger)
    .addTextDisplayComponents(text("## 🃏 PvP Blackjack — Cancelled"))
    .addTextDisplayComponents(
      text(`The lobby was cancelled. \`${formatAmount(game.amount)}\` gems were returned to ${participantName(game.creator)}.`),
    );
}

function payload(
  game: PvpGame,
  mode: "lobby" | "active" | "final" | "cancelled",
): any {
  const component = mode === "lobby"
    ? lobbyContainer(game)
    : mode === "active"
      ? activeContainer(game)
      : mode === "final"
        ? finalContainer(game)
        : cancelledContainer(game);
  const showDealerFull = mode === "final" || (mode === "active" && game.round?.phase === "resolved");
  const overlay = mode === "final"
    ? game.winnerId
      ? `${getNameById(game, game.winnerId)} wins the match`
      : "Match tied — stakes refunded"
    : mode === "active" && game.round?.phase === "resolved"
      ? `Round ${game.round.number}: ${game.roundResult}`
      : "";

  if (mode === "lobby" || mode === "cancelled") {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [component],
    };
  }
  return {
    flags: MessageFlags.IsComponentsV2,
    files: [imageFile(game, showDealerFull, overlay)],
    components: [component],
  };
}

async function publish(
  game: PvpGame,
  interaction?: ButtonInteraction,
) {
  if (interaction) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload(game, game.phase === "finished" ? "final" : game.phase === "lobby" ? "lobby" : "active"));
    } else {
      await interaction.update(payload(game, game.phase === "finished" ? "final" : game.phase === "lobby" ? "lobby" : "active"));
    }
    return;
  }
  if (game.message) {
    await game.message.edit(payload(game, game.phase === "finished" ? "final" : game.phase === "cancelled" ? "cancelled" : "active"));
  }
}

async function advanceRound(game: PvpGame) {
  if (game.phase !== "playing" || !game.round || game.round.phase !== "resolved") return;
  if (game.currentRound + 1 >= game.rounds) {
    await settleGame(game);
    await publish(game);
    return;
  }
  game.currentRound++;
  startRound(game);
  await publish(game);
  runBotTurnIfNeeded(game);
}

function runBotTurnIfNeeded(game: PvpGame) {
  const round = game.round;
  if (!round || round.phase !== "active") {
    if (round?.phase === "resolved") {
      setTimeout(() => void advanceRound(game), 1_400);
    }
    return;
  }
  const player = getParticipant(game, round.playerId);
  if (!player.isBot) return;

  void (async () => {
    await sleep(650);
    while (game.phase === "playing" && game.round === round && round.phase === "active") {
      if (handValue(round.playerHand) >= 17) {
        dealerPlay(round);
        resolveRound(game, determineRoundStatus(round));
        await publish(game);
        setTimeout(() => void advanceRound(game), 1_400);
        return;
      }
      round.playerHand.push(deal(round.deck));
      if (isBust(round.playerHand) || handValue(round.playerHand) === 21) {
        if (!isBust(round.playerHand)) dealerPlay(round);
        resolveRound(game, determineRoundStatus(round));
        await publish(game);
        setTimeout(() => void advanceRound(game), 1_400);
        return;
      }
      await publish(game);
      await sleep(650);
    }
  })();
}

async function replyEphemeral(interaction: ButtonInteraction, message: string) {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      embeds: [errorEmbed(message)],
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.reply({
      embeds: [errorEmbed(message)],
      flags: MessageFlags.Ephemeral,
    });
  }
}

function getGame(interaction: ButtonInteraction): PvpGame | undefined {
  return gamesByMessage.get(interaction.message.id);
}

export const data = new SlashCommandBuilder()
  .setName("pvpblackjack")
  .setDescription("Play Blackjack against another player over multiple rounds.")
  .addStringOption((option) =>
    option
      .setName("amount")
      .setDescription("Equal stake for each player (e.g. 1m, 2.5b)")
      .setRequired(true),
  )
  .addIntegerOption((option) =>
    option
      .setName("rounds")
      .setDescription("Number of rounds (1–10)")
      .setMinValue(1)
      .setMaxValue(10)
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const amount = parseAmount(interaction.options.getString("amount", true));
  const rounds = interaction.options.getInteger("rounds", true);

  if (!amount || amount < 1_000_000) {
    return interaction.reply({
      embeds: [errorEmbed("Minimum PvP Blackjack stake is **1m gems**.")],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (rounds < 1 || rounds > 10) {
    return interaction.reply({
      embeds: [errorEmbed("Rounds must be between **1 and 10**.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();
  if (gameByUser.has(interaction.user.id)) {
    return interaction.editReply({ embeds: [errorEmbed("You already have an active PvP Blackjack game.")] });
  }

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount) {
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} gems**.`)],
    });
  }

  await addBalance(interaction.user.id, -amount);
  const game: PvpGame = {
    creator: {
      id: interaction.user.id,
      displayName: getDisplayName(interaction),
      isBot: false,
    },
    amount,
    rounds,
    messageId: "",
    phase: "lobby",
    currentRound: 0,
    wins: {},
    extraStake: {},
    roundResult: "",
    tax: 0,
    payout: 0,
  };
  const message = await interaction.editReply(payload(game, "lobby"));
  game.messageId = message.id;
  game.message = message;
  gamesByMessage.set(message.id, game);
  gameByUser.set(game.creator.id, message.id);
  return;
}

export async function handleJoin(interaction: ButtonInteraction) {
  const game = getGame(interaction);
  if (!game || game.phase !== "lobby") return replyEphemeral(interaction, "This PvP Blackjack lobby is no longer open.");
  if (interaction.user.id === game.creator.id) return replyEphemeral(interaction, "You cannot join your own game.");
  if (gameByUser.has(interaction.user.id)) return replyEphemeral(interaction, "You already have an active PvP Blackjack game.");

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < game.amount) {
    return replyEphemeral(interaction, `Insufficient balance. You need **${formatAmount(game.amount)} gems** to join.`);
  }

  await interaction.deferUpdate();
  await addBalance(interaction.user.id, -game.amount);
  game.opponent = {
    id: interaction.user.id,
    displayName: getDisplayName(interaction),
    isBot: false,
  };
  gameByUser.set(game.opponent.id, game.messageId);
  startRound(game);
  await publish(game, interaction);
  runBotTurnIfNeeded(game);
}

export async function handleCallBot(interaction: ButtonInteraction) {
  const game = getGame(interaction);
  if (!game || game.phase !== "lobby") return replyEphemeral(interaction, "This PvP Blackjack lobby is no longer open.");
  if (interaction.user.id !== game.creator.id) return replyEphemeral(interaction, "Only the game host can call the bot.");

  await interaction.deferUpdate();
  game.opponent = {
    id: interaction.client.user.id,
    displayName: interaction.client.user.username,
    isBot: true,
  };
  startRound(game);
  await publish(game, interaction);
  runBotTurnIfNeeded(game);
}

export async function handleCancel(interaction: ButtonInteraction) {
  const game = getGame(interaction);
  if (!game || game.phase !== "lobby") return replyEphemeral(interaction, "This PvP Blackjack lobby is no longer open.");
  if (interaction.user.id !== game.creator.id) return replyEphemeral(interaction, "Only the game host can cancel this lobby.");

  await interaction.deferUpdate();
  await addBalance(game.creator.id, game.amount);
  game.phase = "cancelled";
  gamesByMessage.delete(game.messageId);
  gameByUser.delete(game.creator.id);
  await publish(game, interaction);
}

async function validatePlayerTurn(interaction: ButtonInteraction): Promise<PvpGame | undefined> {
  const game = getGame(interaction);
  if (!game || game.phase !== "playing" || !game.round || game.round.phase !== "active") {
    await replyEphemeral(interaction, "It is not possible to play that PvP Blackjack round.");
    return undefined;
  }
  if (interaction.user.id !== game.round.playerId) {
    await replyEphemeral(interaction, `It is **${getNameById(game, game.round.playerId)}'s** turn.`);
    return undefined;
  }
  return game;
}

export async function handleHit(interaction: ButtonInteraction) {
  const game = await validatePlayerTurn(interaction);
  if (!game) return;
  await interaction.deferUpdate();
  const round = game.round!;
  round.playerHand.push(deal(round.deck));
  if (isBust(round.playerHand)) {
    resolveRound(game, "player_bust");
  } else if (handValue(round.playerHand) === 21) {
    dealerPlay(round);
    resolveRound(game, determineRoundStatus(round));
  }
  if (round.phase === "resolved") {
    await publish(game, interaction);
    setTimeout(() => void advanceRound(game), 1_400);
  } else {
    await publish(game, interaction);
  }
}

export async function handleStand(interaction: ButtonInteraction) {
  const game = await validatePlayerTurn(interaction);
  if (!game) return;
  await interaction.deferUpdate();
  dealerPlay(game.round!);
  resolveRound(game, determineRoundStatus(game.round!));
  await publish(game, interaction);
  setTimeout(() => void advanceRound(game), 1_400);
}

export async function handleDouble(interaction: ButtonInteraction) {
  const game = await validatePlayerTurn(interaction);
  if (!game) return;
  const round = game.round!;
  if (round.playerHand.length !== 2) {
    return replyEphemeral(interaction, "Double Down is only available on the opening hand.");
  }
  const player = getParticipant(game, round.playerId);
  const user = await getOrCreateUser(player.id, "");
  if (user.balance < game.amount) {
    return replyEphemeral(interaction, `Not enough gems to double. You need **${formatAmount(game.amount)}** more.`);
  }

  await interaction.deferUpdate();
  await addBalance(player.id, -game.amount);
  game.extraStake[player.id] = (game.extraStake[player.id] ?? 0) + game.amount;
  round.doubled = true;
  round.playerHand.push(deal(round.deck));
  if (!isBust(round.playerHand)) dealerPlay(round);
  resolveRound(game, determineRoundStatus(round));
  await publish(game, interaction);
  setTimeout(() => void advanceRound(game), 1_400);
}