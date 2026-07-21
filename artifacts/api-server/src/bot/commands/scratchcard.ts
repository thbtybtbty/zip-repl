import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
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

// ─── Symbols ──────────────────────────────────────────────────────────────────
interface CardSymbol { emoji: string; mult: number; weight: number }

const SYMBOLS: CardSymbol[] = [
  { emoji: "🔻", mult: 0.1,   weight: 30 },
  { emoji: "💎", mult: 0.5,   weight: 20 },
  { emoji: "🌿", mult: 1.0,   weight: 15 },
  { emoji: "💰", mult: 2.0,   weight: 12 },
  { emoji: "🎁", mult: 10.0,  weight: 7  },
  { emoji: "⭐", mult: 100.0, weight: 2  },
  { emoji: "🔥", mult: 50.0,  weight: 3  },
  { emoji: "👑", mult: 500.0, weight: 1  },
];

const JACKPOT_MULT = 500.0;
const SYMBOL_POOL: CardSymbol[] = SYMBOLS.flatMap((s) => Array(s.weight).fill(s));

function pickSymbol(): CardSymbol {
  return SYMBOL_POOL[Math.floor(Math.random() * SYMBOL_POOL.length)]!;
}

function fmtMult(mult: number): string {
  return `${mult % 1 === 0 ? mult.toFixed(1) : mult}x`;
}

// ─── Game state ───────────────────────────────────────────────────────────────
interface ScratchGame {
  userId: string;
  bet: number;
  cells: CardSymbol[];   // 9 pre-determined symbols
  revealed: boolean[];   // which cells the user has scratched
  settled: boolean;      // true once winnings have been paid out
}

const activeGames = new Map<string, ScratchGame>();

// ─── Win check: 3+ of the same symbol ────────────────────────────────────────
function checkWin(cells: CardSymbol[]): { winner: boolean; symbol: CardSymbol | null; count: number } {
  const counts = new Map<string, { symbol: CardSymbol; count: number }>();
  for (const cell of cells) {
    const entry = counts.get(cell.emoji);
    if (entry) entry.count++;
    else counts.set(cell.emoji, { symbol: cell, count: 1 });
  }

  let best: { symbol: CardSymbol; count: number } | null = null;
  for (const entry of counts.values()) {
    if (entry.count >= 3) {
      if (!best || entry.symbol.mult > best.symbol.mult) best = entry;
    }
  }

  return best
    ? { winner: true, symbol: best.symbol, count: best.count }
    : { winner: false, symbol: null, count: 0 };
}

// ─── Settle (pay out winnings once) ──────────────────────────────────────────
async function settleGame(game: ScratchGame): Promise<number> {
  if (game.settled) return 0;
  game.settled = true;

  const win      = checkWin(game.cells);
  const winnings = win.winner ? Math.floor(game.bet * win.symbol!.mult) : 0;
  if (winnings > 0) await addBalance(game.userId, winnings);
  await recordBet(game.userId, game.bet, winnings - game.bet);
  return winnings;
}

// ─── Build the 3×3 grid + Scratch All button ─────────────────────────────────
function buildComponents(game: ScratchGame, disabled = false): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
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
        btn.setLabel(`${cell.emoji} ${fmtMult(cell.mult)}`).setStyle(ButtonStyle.Secondary);
      } else {
        btn.setEmoji("🎰").setStyle(ButtonStyle.Primary);
      }

      actionRow.addComponents(btn);
    }
    rows.push(actionRow);
  }

  // Scratch All button
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

// ─── Build embed ──────────────────────────────────────────────────────────────
function buildInitialEmbed(game: ScratchGame): EmbedBuilder {
  const scratchedCount = game.revealed.filter(Boolean).length;
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🎰 Scratchcard")
    .addFields(
      { name: "💎 Bet",       value: `\`${formatAmount(game.bet)}\``,    inline: true },
      { name: "✨ Jackpot",   value: `\`${fmtMult(JACKPOT_MULT)}\``,     inline: true },
      { name: "🎃 Scratched", value: `\`${scratchedCount}/9\``,           inline: true },
    );
}

function buildResultEmbed(game: ScratchGame): EmbedBuilder {
  const win      = checkWin(game.cells);
  const winnings = win.winner ? Math.floor(game.bet * win.symbol!.mult) : 0;

  const title = win.winner
    ? `🎰 Scratchcard — ${win.count}× ${win.symbol!.emoji} WINNER!`
    : "🎰 Scratchcard — NO MATCH";

  const description = win.winner
    ? `🎉 Found **${win.count}×  ${win.symbol!.emoji}** (${fmtMult(win.symbol!.mult)})!\nPayout: **${formatAmount(winnings)} gems**.`
    : `No 3 matching symbols found.\nPayout: **0** gems.`;

  return new EmbedBuilder()
    .setColor(win.winner ? COLORS.success : COLORS.danger)
    .setTitle(title)
    .addFields(
      { name: "💎 Bet",          value: `\`${formatAmount(game.bet)}\``,                                                  inline: true },
      { name: "✨ Best Match",   value: win.winner ? `\`${win.symbol!.emoji} ${fmtMult(win.symbol!.mult)}\`` : "`None`",   inline: true },
      { name: "💰 Winnings",    value: `\`${winnings > 0 ? formatAmount(winnings) : "0"}\``,                               inline: true },
    )
    .setDescription(description);
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("scratchcard")
  .setDescription("Buy a scratchcard — find 3 matching symbols to win!")
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

  // Cancel any existing game for this user
  activeGames.delete(interaction.user.id);

  // Deduct bet upfront
  await addBalance(interaction.user.id, -amount);

  const game: ScratchGame = {
    userId:   interaction.user.id,
    bet:      amount,
    cells:    Array.from({ length: 9 }, () => pickSymbol()),
    revealed: Array(9).fill(false),
    settled:  false,
  };
  activeGames.set(interaction.user.id, game);

  await interaction.editReply({
    embeds:     [buildInitialEmbed(game)],
    components: buildComponents(game),
  });
}

// ─── Button: Reveal a single cell ────────────────────────────────────────────
export async function handleReveal(interaction: ButtonInteraction, userId: string, bet: string, idx: number): Promise<void> {
  if (interaction.user.id !== userId)
    return void interaction.reply({ content: "❌ This isn't your game.", flags: MessageFlags.Ephemeral });

  const game = activeGames.get(userId);
  if (!game)
    return void interaction.reply({ content: "❌ No active scratchcard found. Use `/scratchcard` to start.", flags: MessageFlags.Ephemeral });

  if (game.revealed[idx]) return void interaction.deferUpdate(); // already scratched

  game.revealed[idx] = true;
  const allRevealed = game.revealed.every(Boolean);

  await interaction.deferUpdate();

  if (allRevealed) {
    await settleGame(game);
    activeGames.delete(userId);
    await interaction.editReply({
      embeds:     [buildResultEmbed(game)],
      components: buildComponents(game, true),
    });
  } else {
    await interaction.editReply({
      embeds:     [buildInitialEmbed(game)],
      components: buildComponents(game),
    });
  }
}

// ─── Button: Scratch All ──────────────────────────────────────────────────────
export async function handleScratchAll(interaction: ButtonInteraction, userId: string): Promise<void> {
  if (interaction.user.id !== userId)
    return void interaction.reply({ content: "❌ This isn't your game.", flags: MessageFlags.Ephemeral });

  const game = activeGames.get(userId);
  if (!game)
    return void interaction.reply({ content: "❌ No active scratchcard found. Use `/scratchcard` to start.", flags: MessageFlags.Ephemeral });

  game.revealed.fill(true);
  await settleGame(game);
  activeGames.delete(userId);

  await interaction.deferUpdate();
  await interaction.editReply({
    embeds:     [buildResultEmbed(game)],
    components: buildComponents(game, true),
  });
}
