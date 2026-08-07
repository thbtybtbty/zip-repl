import {
  SlashCommandBuilder,
  EmbedBuilder,
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
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
const SUITS = [
  { name: "Spades", symbol: "♠", offset: 0x00 },
  { name: "Hearts", symbol: "♥", offset: 0x10 },
  { name: "Diamonds", symbol: "♦", offset: 0x20 },
  { name: "Clubs", symbol: "♣", offset: 0x30 },
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

function unicodeCard(rankValue: number, suitOffset: number): string {
  // Unicode playing cards use Ace, 2–10, Jack, Knight, Queen, King. Skip the
  // Knight code point because the game displays Q rather than Knight.
  const unicodeRank =
    rankValue === 14 ? 1 :
    rankValue === 12 ? 13 :
    rankValue;
  return String.fromCodePoint(0x1f0a0 + suitOffset + unicodeRank);
}

export function buildHiloDeck(): HiloCard[] {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank, index) => ({
      rank,
      rankValue: index + 2,
      suit: suit.name,
      suitSymbol: suit.symbol,
      glyph: unicodeCard(index + 2, suit.offset),
    })),
  );
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

function cardLabel(card: HiloCard): string {
  return `${card.glyph}  ${card.rank}${card.suitSymbol}`;
}

function cardCount(game: HiloGame, direction: HiloDirection): number {
  return game.deck.filter((card) =>
    direction === "higher"
      ? card.rankValue > game.currentCard.rankValue
      : card.rankValue < game.currentCard.rankValue,
  ).length;
}

function chance(game: HiloGame, direction: HiloDirection): number {
  if (game.deck.length === 0) return 0;
  return cardCount(game, direction) / game.deck.length;
}

/**
 * A correct guess pays the current multiplier × (90% / probability of the
 * chosen direction). Ties are not included in that probability and therefore
 * lose. This makes every guess a 90% expected-return step without hardcoded
 * random payouts.
 */
export function nextMultiplier(
  game: HiloGame,
  direction: HiloDirection,
): number {
  const probability = chance(game, direction);
  if (probability <= 0) return 0;
  return game.multiplier * (0.9 / probability);
}

function formatChance(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function gameButtons(
  game: HiloGame,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const higher = new ButtonBuilder()
    .setCustomId(`hilo_higher_${game.userId}`)
    .setLabel("Higher")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(cardCount(game, "higher") === 0);
  const lower = new ButtonBuilder()
    .setCustomId(`hilo_lower_${game.userId}`)
    .setLabel("Lower")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(cardCount(game, "lower") === 0);
  const cashout = new ButtonBuilder()
    .setCustomId(`hilo_cashout_${game.userId}`)
    .setLabel("Cashout")
    .setStyle(ButtonStyle.Success)
    .setDisabled(game.correctGuesses === 0);

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
      .setCustomId(`pa_hilo_${userId}_${bet}`)
      .setLabel("🔄  Play Again")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

function buildActiveEmbed(game: HiloGame): EmbedBuilder {
  const higher = chance(game, "higher");
  const lower = chance(game, "lower");
  const potential = Math.floor(game.bet * game.multiplier);

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🃏  Hi-Lo")
    .setDescription(
      [
        `💎 **Bet**  \`${formatAmount(game.bet)}\``,
        `✨ **Multiplier**  \`${formatMult(game.multiplier)}\``,
        `🔺 **Higher**  \`${formatChance(higher)}\``,
        `🔻 **Lower**  \`${formatChance(lower)}\``,
        `💰 **Potential Win**  \`${formatAmount(potential)}\``,
        `━━━━━━━━━━━━━━━━━━━━`,
        `## Current Card`,
        `# ${cardLabel(game.currentCard)}`,
        `Rank \`${game.currentCard.rank}\` · \`${game.deck.length}\` cards left in the deck`,
      ].join("\n"),
    )
    .setFooter({ text: "Choose Higher or Lower. Ties lose." })
    .setTimestamp();
}

function buildWinEmbed(
  game: HiloGame,
  previousCard: HiloCard,
  newCard: HiloCard,
): EmbedBuilder {
  const payout = Math.floor(game.bet * game.multiplier);
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle("🃏  Hi-Lo — Correct Guess!")
    .setDescription(
      [
        `✅ **${cardLabel(previousCard)}** → **${cardLabel(newCard)}**`,
        "",
        `✨ **Multiplier**  \`${formatMult(game.multiplier)}\``,
        `💰 **Payout**  \`${formatAmount(payout)}\``,
        `📈 **Profit**  \`+${formatAmount(payout - game.bet)}\``,
        `🎯 **Correct Guesses**  \`${game.correctGuesses}\``,
        "",
        "The game continues — cash out or guess again.",
      ].join("\n"),
    )
    .setTimestamp();
}

function buildLossEmbed(
  game: HiloGame,
  previousCard: HiloCard,
  newCard: HiloCard,
  reason: "wrong" | "tie",
): EmbedBuilder {
  const reasonText =
    reason === "tie"
      ? "The cards tied. Ties count as a loss."
      : "The next card went the wrong way.";

  return new EmbedBuilder()
    .setColor(COLORS.danger)
    .setTitle("🃏  Hi-Lo — You Lose")
    .setDescription(
      [
        `❌ **${cardLabel(previousCard)}** → **${cardLabel(newCard)}**`,
        "",
        reasonText,
        `💀 **Loss**  \`-${formatAmount(game.bet)}\``,
        `🎯 **Correct Guesses Achieved**  \`${game.correctGuesses}\``,
      ].join("\n"),
    )
    .setTimestamp();
}

function buildCashoutEmbed(game: HiloGame): EmbedBuilder {
  const payout = Math.floor(game.bet * game.multiplier);
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle("🃏  Hi-Lo — Cashed Out!")
    .setDescription(
      [
        `💰 **Payout**  \`${formatAmount(payout)}\``,
        `✨ **Multiplier**  \`${formatMult(game.multiplier)}\``,
        `📈 **Profit**  \`${payout >= game.bet ? "+" : ""}${formatAmount(payout - game.bet)}\``,
        `🎯 **Correct Guesses**  \`${game.correctGuesses}\``,
        "",
        `Last card: **${cardLabel(game.currentCard)}**`,
      ].join("\n"),
    )
    .setTimestamp();
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("hilo")
  .setDescription("Play Hi-Lo with a standard 52-card deck")
  .addStringOption((opt) =>
    opt
      .setName("amount")
      .setDescription("Bet amount (e.g. 1m, 2.5b)")
      .setRequired(true),
  );

function newGame(userId: string, bet: number): HiloGame {
  const deck = shuffle(buildHiloDeck());
  return {
    userId,
    bet,
    deck: deck.slice(1),
    currentCard: deck[0]!,
    multiplier: 1,
    correctGuesses: 0,
  };
}

async function startGame(
  userId: string,
  bet: number,
  editFn: (data: {
    embeds: EmbedBuilder[];
    components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  }) => Promise<unknown>,
): Promise<void> {
  const game = newGame(userId, bet);
  await addBalance(userId, -bet);
  activeHiloGames.set(userId, game);
  await editFn({
    embeds: [buildActiveEmbed(game)],
    components: [gameButtons(game)],
  });
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const amount = parseAmount(interaction.options.getString("amount", true));
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

  if (activeHiloGames.has(interaction.user.id)) {
    return interaction.editReply({
      embeds: [errorEmbed("You already have an active Hi-Lo game!")],
    });
  }

  const user = await getOrCreateUser(
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

  await startGame(interaction.user.id, amount, (payload) =>
    interaction.editReply(payload),
  );
}

// ─── Buttons: guesses and cashout ─────────────────────────────────────────────
export async function handleGuess(
  interaction: ButtonInteraction,
  direction: HiloDirection,
): Promise<void> {
  await interaction.deferUpdate();
  const game = activeHiloGames.get(interaction.user.id);
  if (!game) {
    await interaction.followUp({
      content: "❌ This Hi-Lo game has already ended.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const previousCard = game.currentCard;
  const nextCardIndex = Math.floor(Math.random() * game.deck.length);
  const nextCard = game.deck.splice(nextCardIndex, 1)[0]!;
  const isTie = nextCard.rankValue === previousCard.rankValue;
  const isCorrect =
    direction === "higher"
      ? nextCard.rankValue > previousCard.rankValue
      : nextCard.rankValue < previousCard.rankValue;

  if (!isCorrect || isTie) {
    activeHiloGames.delete(game.userId);
    await recordBet(game.userId, game.bet, -game.bet, "hilo");
    await interaction.editReply({
      embeds: [buildLossEmbed(game, previousCard, nextCard)],
      components: [playAgainRow(game.userId, game.bet)],
    });
    return;
  }

  game.currentCard = nextCard;
  game.correctGuesses += 1;
  game.multiplier = nextMultiplier(
    { ...game, currentCard: previousCard, deck: [nextCard, ...game.deck] },
    direction,
  );

  if (game.deck.length === 0) {
    activeHiloGames.delete(game.userId);
    const payout = Math.floor(game.bet * game.multiplier);
    await addBalance(game.userId, payout);
    await recordBet(game.userId, game.bet, payout - game.bet, "hilo", game.multiplier);
    await interaction.editReply({
      embeds: [
        buildWinEmbed(game, previousCard, nextCard).setTitle(
          "🃏  Hi-Lo — Deck Complete!",
        ),
      ],
      components: [playAgainRow(game.userId, game.bet)],
    });
    return;
  }

  await interaction.editReply({
    embeds: [buildActiveEmbed(game)],
    components: [gameButtons(game)],
  });
}

export async function handleCashout(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferUpdate();
  const game = activeHiloGames.get(interaction.user.id);
  if (!game) {
    await interaction.followUp({
      content: "❌ This Hi-Lo game has already ended.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  activeHiloGames.delete(game.userId);
  const payout = Math.floor(game.bet * game.multiplier);
  await addBalance(game.userId, payout);
  await recordBet(game.userId, game.bet, payout - game.bet, "hilo", game.multiplier);
  await interaction.editReply({
    embeds: [buildCashoutEmbed(game)],
    components: [playAgainRow(game.userId, game.bet)],
  });
}

// ─── Button: Play Again ───────────────────────────────────────────────────────
export async function handlePlayAgain(
  interaction: ButtonInteraction,
  userId: string,
  betStr: string,
): Promise<void> {
  if (interaction.user.id !== userId) {
    return void interaction.reply({
      content: "❌ This isn't your game.",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (activeHiloGames.has(userId)) {
    return void interaction.reply({
      embeds: [errorEmbed("You already have an active Hi-Lo game!")],
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

  await interaction.deferUpdate();
  await interaction.editReply({
    components: [playAgainRow(userId, bet, true)],
  });

  const user = await getOrCreateUser(userId, interaction.user.username);
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

  const gameMessage: Message = await interaction.followUp({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle("🃏  Hi-Lo")
        .setDescription("Shuffling a new 52-card deck…"),
    ],
  });
  await startGame(userId, bet, (payload) => gameMessage.edit(payload));
}