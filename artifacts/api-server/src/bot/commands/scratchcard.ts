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
  getOrCreateUser,
  addBalance,
  recordBet,
  errorEmbed,
} from "../utils.js";

// ─── Symbols ──────────────────────────────────────────────────────────────────
interface CardSymbol { emoji: string; mult: number; weight: number }

const SYMBOLS: CardSymbol[] = [
  { emoji: "🔻", mult: 0.1,   weight: 30 },
  { emoji: "💎", mult: 0.5,   weight: 20 },
  { emoji: "🌿", mult: 1.0,   weight: 15 },
  { emoji: "💰", mult: 2.0,   weight: 12 },
  { emoji: "🎁", mult: 10.0,  weight: 7  },
  { emoji: "🔥", mult: 50.0,  weight: 3  },
  { emoji: "⭐", mult: 100.0, weight: 2  },
  { emoji: "👑", mult: 500.0, weight: 1  },
];

const JACKPOT_MULT = 500.0;
const SYMBOL_POOL: CardSymbol[] = SYMBOLS.flatMap((s) => Array(s.weight).fill(s));

function pickWeighted(): CardSymbol {
  return SYMBOL_POOL[Math.floor(Math.random() * SYMBOL_POOL.length)]!;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function fmtMult(mult: number): string {
  return `${mult.toFixed(1)}x`;
}

// ─── Cell generation — fully random, but no symbol appears more than 3 times ──
// This means a win (exactly 3 of the same) can happen or not — pure chance.
function generateCells(): CardSymbol[] {
  const cells: CardSymbol[] = [];
  const counts = new Map<string, number>();

  for (let i = 0; i < 9; i++) {
    let pick: CardSymbol;
    let attempts = 0;
    do {
      pick = pickWeighted();
      attempts++;
      if (attempts > 50) {
        const available = SYMBOLS.filter((s) => (counts.get(s.emoji) ?? 0) < 3);
        pick = available[Math.floor(Math.random() * available.length)]!;
        break;
      }
    } while ((counts.get(pick.emoji) ?? 0) >= 3);

    cells.push(pick);
    counts.set(pick.emoji, (counts.get(pick.emoji) ?? 0) + 1);
  }

  return cells;
}

// ─── Game state ───────────────────────────────────────────────────────────────
interface ScratchGame {
  userId:   string;
  bet:      number;
  cells:    CardSymbol[];
  revealed: boolean[];
  settled:  boolean;
}

const activeGames = new Map<string, ScratchGame>();

// ─── Win check — exactly 3 of the same symbol ─────────────────────────────────
function checkWin(cells: CardSymbol[]): { winner: boolean; symbol: CardSymbol | null } {
  const counts = new Map<string, { symbol: CardSymbol; count: number }>();
  for (const cell of cells) {
    const entry = counts.get(cell.emoji);
    if (entry) entry.count++;
    else counts.set(cell.emoji, { symbol: cell, count: 1 });
  }

  let best: { symbol: CardSymbol; count: number } | null = null;
  for (const entry of counts.values()) {
    if (entry.count === 3) {
      if (!best || entry.symbol.mult > best.symbol.mult) best = entry;
    }
  }

  return best
    ? { winner: true,  symbol: best.symbol }
    : { winner: false, symbol: null         };
}

// ─── Settle ───────────────────────────────────────────────────────────────────
async function settleGame(game: ScratchGame): Promise<void> {
  if (game.settled) return;
  game.settled = true;

  const win      = checkWin(game.cells);
  const winnings = win.winner ? Math.floor(game.bet * win.symbol!.mult) : 0;
  if (winnings > 0) await addBalance(game.userId, winnings);
  await recordBet(game.userId, game.bet, winnings - game.bet);
}

// ─── Components ───────────────────────────────────────────────────────────────
function buildPlayAgainRow(
  userId: string,
  bet: number,
  disabled = false,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pa_sc_${userId}_${bet}`)
      .setLabel("🔄  Play Again")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

function buildGrid(
  game: ScratchGame,
  disabled  = false,
  winEmoji?: string,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  const allDone = game.revealed.every(Boolean) || game.settled;

  for (let row = 0; row < 3; row++) {
    const actionRow = new ActionRowBuilder<MessageActionRowComponentBuilder>();
    for (let col = 0; col < 3; col++) {
      const idx        = row * 3 + col;
      const cell       = game.cells[idx]!;
      const isRevealed = game.revealed[idx]!;

      const btn = new ButtonBuilder()
        .setCustomId(`sc_reveal_${game.userId}_${game.bet}_${idx}`)
        .setDisabled(disabled || isRevealed || allDone);

      if (isRevealed) {
        const isWin = winEmoji !== undefined && cell.emoji === winEmoji;
        btn.setLabel(`${cell.emoji} ${fmtMult(cell.mult)}`).setStyle(
          isWin ? ButtonStyle.Success : ButtonStyle.Secondary,
        );
      } else {
        btn.setEmoji("🎰").setStyle(ButtonStyle.Primary);
      }

      actionRow.addComponents(btn);
    }
    rows.push(actionRow);
  }

  // Scratch All / Play Again row
  const scratchedCount = game.revealed.filter(Boolean).length;
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`sc_all_${game.userId}_${game.bet}`)
        .setLabel("✨ Scratch All")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled || scratchedCount === 9 || allDone),
    ),
  );

  return rows;
}

// ─── Embeds ───────────────────────────────────────────────────────────────────
function buildActiveEmbed(game: ScratchGame): EmbedBuilder {
  const scratchedCount = game.revealed.filter(Boolean).length;
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🎰 Scratchcard")
    .setDescription(
      [
        `💎 **Bet**        \`${formatAmount(game.bet)}\``,
        `✨ **Jackpot**    \`${fmtMult(JACKPOT_MULT)}\``,
        `🎃 **Scratched**  \`${scratchedCount}/9\``,
      ].join("\n"),
    )
    .setTimestamp();
}

function buildResultEmbed(game: ScratchGame): EmbedBuilder {
  const win      = checkWin(game.cells);
  const winnings = win.winner ? Math.floor(game.bet * win.symbol!.mult) : 0;
  const net      = winnings - game.bet;

  const resultLine = win.winner
    ? `🎉 **3× ${win.symbol!.emoji}** matched! (${fmtMult(win.symbol!.mult)})\n` +
      `${net >= 0 ? "+" : ""}${formatAmount(net)} 💎`
    : `No 3 matching symbols found.\nPayout: **0** 💎`;

  return new EmbedBuilder()
    .setColor(win.winner ? COLORS.success : COLORS.danger)
    .setTitle(win.winner ? "🎰 Scratchcard — WINNER!" : "🎰 Scratchcard — NO MATCH")
    .setDescription(
      [
        `💎 **Bet**         \`${formatAmount(game.bet)}\``,
        `✨ **Best Match**  ${win.winner ? `\`${win.symbol!.emoji} ${fmtMult(win.symbol!.mult)}\`` : "`None`"}`,
        `💰 **Winnings**   \`${winnings > 0 ? formatAmount(winnings) : "0"}\``,
        ``,
        resultLine,
      ].join("\n"),
    )
    .setTimestamp();
}

// ─── Shared finish helper ─────────────────────────────────────────────────────
async function finishGame(
  game: ScratchGame,
  editFn: (data: {
    embeds:     EmbedBuilder[];
    components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  }) => Promise<void>,
): Promise<void> {
  await settleGame(game);
  activeGames.delete(game.userId);

  const win      = checkWin(game.cells);
  const winEmoji = win.winner ? win.symbol!.emoji : undefined;

  const gridRows     = buildGrid(game, true, winEmoji);
  const playAgainRow = buildPlayAgainRow(game.userId, game.bet);
  // Replace the last row (Scratch All) with Play Again
  gridRows[gridRows.length - 1] = playAgainRow;

  await editFn({
    embeds:     [buildResultEmbed(game)],
    components: gridRows,
  });
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("scratchcard")
  .setDescription("Buy a scratchcard — match 3 symbols to win!")
  .addStringOption((opt) =>
    opt.setName("amount").setDescription("Bet amount (e.g. 1m, 2.5b)").setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const amountStr = interaction.options.getString("amount", true);
  const amount    = parseAmount(amountStr);

  if (!amount || amount <= 0)
    return interaction.editReply({ embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")] });

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount)
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
    });

  activeGames.delete(interaction.user.id);
  await addBalance(interaction.user.id, -amount);

  const game: ScratchGame = {
    userId:   interaction.user.id,
    bet:      amount,
    cells:    generateCells(),
    revealed: Array(9).fill(false),
    settled:  false,
  };
  activeGames.set(interaction.user.id, game);

  await interaction.editReply({
    embeds:     [buildActiveEmbed(game)],
    components: buildGrid(game),
  });
}

// ─── Button: Reveal single cell ───────────────────────────────────────────────
export async function handleReveal(
  interaction: ButtonInteraction,
  userId: string,
  _bet: string,
  idx: number,
): Promise<void> {
  if (interaction.user.id !== userId)
    return void interaction.reply({ content: "❌ This isn't your game.", flags: MessageFlags.Ephemeral });

  const game = activeGames.get(userId);
  if (!game)
    return void interaction.reply({ content: "❌ No active scratchcard. Use `/scratchcard` to start.", flags: MessageFlags.Ephemeral });

  if (game.revealed[idx]) return void interaction.deferUpdate();

  game.revealed[idx] = true;
  await interaction.deferUpdate();

  if (game.revealed.every(Boolean)) {
    await finishGame(game, (d) => interaction.editReply(d));
  } else {
    await interaction.editReply({
      embeds:     [buildActiveEmbed(game)],
      components: buildGrid(game),
    });
  }
}

// ─── Button: Scratch All ──────────────────────────────────────────────────────
export async function handleScratchAll(interaction: ButtonInteraction, userId: string): Promise<void> {
  if (interaction.user.id !== userId)
    return void interaction.reply({ content: "❌ This isn't your game.", flags: MessageFlags.Ephemeral });

  const game = activeGames.get(userId);
  if (!game)
    return void interaction.reply({ content: "❌ No active scratchcard. Use `/scratchcard` to start.", flags: MessageFlags.Ephemeral });

  game.revealed.fill(true);
  await interaction.deferUpdate();
  await finishGame(game, (d) => interaction.editReply(d));
}

// ─── Button: Play Again ───────────────────────────────────────────────────────
export async function handlePlayAgain(
  interaction: ButtonInteraction,
  userId: string,
  betStr: string,
): Promise<void> {
  if (interaction.user.id !== userId)
    return void interaction.reply({ content: "❌ This isn't your button.", flags: MessageFlags.Ephemeral });

  const bet = parseInt(betStr, 10);

  // Disable the Play Again button on the old message immediately
  await interaction.deferUpdate();
  const oldGrid = buildGrid(
    { userId, bet, cells: [], revealed: Array(9).fill(true), settled: true },
    true,
  );
  oldGrid[oldGrid.length - 1] = buildPlayAgainRow(userId, bet, true);
  await interaction.editReply({ components: oldGrid });

  const user = await getOrCreateUser(userId, interaction.user.username);
  if (user.balance < bet) {
    await interaction.followUp({
      embeds:   [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
      ephemeral: true,
    });
    return;
  }

  activeGames.delete(userId);
  await addBalance(userId, -bet);

  const game: ScratchGame = {
    userId,
    bet,
    cells:    generateCells(),
    revealed: Array(9).fill(false),
    settled:  false,
  };
  activeGames.set(userId, game);

  const msg: Message = await interaction.followUp({
    embeds:     [buildActiveEmbed(game)],
    components: buildGrid(game),
  });

  // Reuse button interactions on the new message via collector pattern —
  // handled globally by the existing button router in index.ts.
  void msg;
}
