import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
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

export const activeBlackjackGames = new Map<string, BlackjackGame>();

// ─── Deck helpers ──────────────────────────────────────────────────────────────
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];

function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS)
      deck.push({ rank, suit });
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
  if (["J", "Q", "K"].includes(rank)) return 10;
  if (rank === "A") return 11;
  return parseInt(rank, 10);
}

function handValue(hand: Card[]): number {
  let total = 0;
  let aces  = 0;
  for (const card of hand) {
    total += cardValue(card.rank);
    if (card.rank === "A") aces++;
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

// ─── Card display ──────────────────────────────────────────────────────────────
function cardStr(card: Card): string {
  return `${card.rank}${card.suit}`;
}

function handStr(hand: Card[]): string {
  return hand.map(cardStr).join("  ");
}

// ─── UI builders ───────────────────────────────────────────────────────────────
type GameStatus = "active" | "player_bust" | "dealer_bust" | "player_win" | "dealer_win" | "push" | "blackjack";

function buildEmbed(game: BlackjackGame, status: GameStatus): EmbedBuilder {
  const pv = handValue(game.playerHand);
  const dv = handValue(game.dealerHand);

  const showDealerFull = status !== "active";
  const dealerDisplay  = showDealerFull
    ? `\`${handStr(game.dealerHand)}\``
    : `\`${cardStr(game.dealerHand[0]!)}  ?\``;

  const dealerScore = showDealerFull ? `**${dv}**${dv > 21 ? "  💥 BUST" : ""}` : "**?**";

  const bet        = game.bet * (game.doubled ? 2 : 1);
  const winPayout  = bet;
  const bjPayout   = Math.floor(game.bet * 1.5);

  const statusMeta: Record<GameStatus, { color: number; title: string; footer: string }> = {
    active:       { color: COLORS.primary, title: "🃏  Blackjack",               footer: "Hit, stand, or double down?" },
    player_bust:  { color: COLORS.danger,  title: "🃏  Blackjack — Bust!",       footer: `Lost ${formatAmount(bet)} gems` },
    dealer_bust:  { color: COLORS.success, title: "🃏  Blackjack — You Win!",    footer: `Dealer busted · +${formatAmount(winPayout)} gems` },
    player_win:   { color: COLORS.success, title: "🃏  Blackjack — You Win!",    footer: `+${formatAmount(winPayout)} gems` },
    dealer_win:   { color: COLORS.danger,  title: "🃏  Blackjack — Dealer Wins", footer: `Lost ${formatAmount(bet)} gems` },
    push:         { color: COLORS.warning, title: "🃏  Blackjack — Push",        footer: "Tie — bet returned" },
    blackjack:    { color: COLORS.gold,    title: "🃏  Blackjack! 🎉",           footer: `Blackjack! · +${formatAmount(bjPayout)} gems` },
  };

  const meta = statusMeta[status];

  return new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(meta.title)
    .setDescription(
      [
        `**Dealer**  ${dealerScore}`,
        dealerDisplay,
        ``,
        `**Your Hand**  **${pv}**${pv > 21 ? "  💥 BUST" : ""}`,
        `\`${handStr(game.playerHand)}\``,
      ].join("\n"),
    )
    .addFields(
      { name: "💰 Bet",   value: `${formatAmount(bet)} gems${game.doubled ? "  *(doubled)*" : ""}`, inline: true },
      { name: "\u200b",   value: "\u200b",  inline: true },
      { name: "\u200b",   value: "\u200b",  inline: true },
    )
    .setFooter({ text: meta.footer })
    .setTimestamp();
}

function buildComponents(
  game: BlackjackGame,
  disabled: boolean,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const canDouble = !disabled && !game.doubled && game.playerHand.length === 2;

  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("bj_hit")
        .setLabel("🃏  Hit")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId("bj_stand")
        .setLabel("✋  Stand")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId("bj_double")
        .setLabel("⚡  Double Down")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!canDouble),
    ),
  ];
}

// ─── House edge ────────────────────────────────────────────────────────────────
// 7.5% of player wins are silently flipped to dealer wins.
// Payouts remain full — the edge is in outcome probability, not payout size.
function applyHouseEdge(status: GameStatus): GameStatus {
  if (status === "player_win" || status === "dealer_bust" || status === "blackjack") {
    if (Math.random() < 0.075) return "dealer_win";
  }
  return status;
}

// ─── Dealer play ───────────────────────────────────────────────────────────────
function dealerPlay(game: BlackjackGame): void {
  while (handValue(game.dealerHand) < 17) {
    game.dealerHand.push(deal(game.deck));
  }
}

// ─── Resolve outcome ───────────────────────────────────────────────────────────
async function resolveGame(
  game: BlackjackGame,
  interaction: ButtonInteraction,
  status: GameStatus,
): Promise<void> {
  activeBlackjackGames.delete(game.userId);

  // Apply hidden house edge: 7.5% of wins become dealer wins
  status = applyHouseEdge(status);

  const multiplier = game.doubled ? 2 : 1;
  let payout = 0;

  if (status === "blackjack")                                    payout = Math.floor(game.bet * 1.5);
  else if (status === "player_win" || status === "dealer_bust")  payout = game.bet * multiplier;
  else if (status === "push")                                    payout = 0;
  else                                                           payout = -(game.bet * multiplier);

  await addBalance(game.userId, payout);

  await interaction.editReply({
    embeds:     [buildEmbed(game, status)],
    components: buildComponents(game, true),
  });
}

// ─── Command ───────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("blackjack")
  .setDescription("Play Blackjack against the dealer — get closer to 21!")
  .addStringOption((opt) =>
    opt.setName("amount").setDescription("Bet amount (e.g. 1m, 2.5b)").setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const amountStr = interaction.options.getString("amount", true);
  const amount    = parseAmount(amountStr);

  if (!amount || amount <= 0) {
    return interaction.editReply({ embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")] });
  }
  if (activeBlackjackGames.has(interaction.user.id)) {
    return interaction.editReply({ embeds: [errorEmbed("You already have an active Blackjack game!")] });
  }

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount) {
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} gems**.`)],
    });
  }

  await addBalance(interaction.user.id, -amount);

  const deck = shuffle(buildDeck());
  const game: BlackjackGame = {
    userId:     interaction.user.id,
    bet:        amount,
    deck,
    playerHand: [deal(deck), deal(deck)],
    dealerHand: [deal(deck), deal(deck)],
    doubled:    false,
    messageId:  "",
  };

  // Check immediate blackjack
  const playerBJ = isBlackjack(game.playerHand);
  const dealerBJ = isBlackjack(game.dealerHand);

  if (playerBJ || dealerBJ) {
    activeBlackjackGames.delete(interaction.user.id);

    let status: GameStatus;
    let payout: number;

    if (playerBJ && dealerBJ) {
      status = "push";
      payout = 0;
    } else if (playerBJ) {
      status = applyHouseEdge("blackjack");
      payout = status === "blackjack" ? Math.floor(amount * 1.5) : -amount;
    } else {
      status = "dealer_win";
      payout = -amount;
    }

    await addBalance(interaction.user.id, payout);
    return interaction.editReply({
      embeds:     [buildEmbed(game, status)],
      components: buildComponents(game, true),
    });
  }

  const msg = await interaction.editReply({
    embeds:     [buildEmbed(game, "active")],
    components: buildComponents(game, false),
  });
  game.messageId = msg.id;
  activeBlackjackGames.set(interaction.user.id, game);
}

// ─── Button: Hit ──────────────────────────────────────────────────────────────
export async function handleHit(interaction: ButtonInteraction) {
  await interaction.deferUpdate();

  const game = activeBlackjackGames.get(interaction.user.id);
  if (!game) return;

  game.playerHand.push(deal(game.deck));

  if (isBust(game.playerHand)) {
    return resolveGame(game, interaction, "player_bust");
  }

  // If 21 exactly, auto-stand
  if (handValue(game.playerHand) === 21) {
    dealerPlay(game);
    const dv = handValue(game.dealerHand);
    const pv = handValue(game.playerHand);
    const status: GameStatus = isBust(game.dealerHand)
      ? "dealer_bust"
      : pv > dv ? "player_win" : pv === dv ? "push" : "dealer_win";
    return resolveGame(game, interaction, status);
  }

  await interaction.editReply({
    embeds:     [buildEmbed(game, "active")],
    components: buildComponents(game, false),
  });
}

// ─── Button: Stand ────────────────────────────────────────────────────────────
export async function handleStand(interaction: ButtonInteraction) {
  await interaction.deferUpdate();

  const game = activeBlackjackGames.get(interaction.user.id);
  if (!game) return;

  dealerPlay(game);

  const pv = handValue(game.playerHand);
  const dv = handValue(game.dealerHand);

  const status: GameStatus = isBust(game.dealerHand)
    ? "dealer_bust"
    : pv > dv  ? "player_win"
    : pv === dv ? "push"
    : "dealer_win";

  return resolveGame(game, interaction, status);
}

// ─── Button: Double Down ──────────────────────────────────────────────────────
export async function handleDouble(interaction: ButtonInteraction) {
  await interaction.deferUpdate();

  const game = activeBlackjackGames.get(interaction.user.id);
  if (!game || game.playerHand.length !== 2) return;

  // Check user has enough to double
  const bal = await (await getOrCreateUser(game.userId, "")).balance;
  if (bal < game.bet) {
    await interaction.followUp({
      embeds: [errorEmbed(`Not enough gems to double down. You need **${formatAmount(game.bet)}** more.`)],
      ephemeral: true,
    });
    return;
  }

  await addBalance(game.userId, -game.bet); // deduct the extra bet
  game.doubled = true;

  // Take exactly one card then auto-stand
  game.playerHand.push(deal(game.deck));

  if (isBust(game.playerHand)) {
    return resolveGame(game, interaction, "player_bust");
  }

  dealerPlay(game);

  const pv = handValue(game.playerHand);
  const dv = handValue(game.dealerHand);

  const status: GameStatus = isBust(game.dealerHand)
    ? "dealer_bust"
    : pv > dv  ? "player_win"
    : pv === dv ? "push"
    : "dealer_win";

  return resolveGame(game, interaction, status);
}
