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
  GEM,
  BOMB,
  parseAmount,
  formatAmount,
  formatMult,
  getOrCreateUser,
  addBalance,
  errorEmbed,
} from "../utils.js";
import { gamesTable } from "@workspace/db";

// ─── Game state ───────────────────────────────────────────────────────────────
export interface MinesGame {
  userId: string;
  bet: number;
  minesCount: number;
  board: ("gem" | "bomb")[];
  revealed: boolean[];
  gemsFound: number;
  multiplier: number;
  panelGridMessageId: string; // 1st message — embed + 5×5 grid
  cashoutMessageId: string;   // 2nd message — cashout button only
  channelId: string;
}

export const activeMinesGames = new Map<string, MinesGame>();

// ─── Math ─────────────────────────────────────────────────────────────────────
export function calcMinesMultiplier(minesCount: number, gemsFound: number): number {
  if (gemsFound === 0) return 1.0;
  let mult = 1.0, rem = 25, safe = 25 - minesCount;
  for (let i = 0; i < gemsFound; i++) { mult *= rem / safe; rem--; safe--; }
  return mult * 0.97;
}

// ─── Panel embed ──────────────────────────────────────────────────────────────
export function buildMinesPanelEmbed(
  game: MinesGame,
  status: "active" | "won" | "lost",
): EmbedBuilder {
  const totalGems  = 25 - game.minesCount;
  const currentWin = Math.floor(game.bet * game.multiplier);
  const nextMult   = calcMinesMultiplier(game.minesCount, game.gemsFound + 1);
  const nextWin    = Math.floor(game.bet * nextMult);

  const color = status === "active" ? COLORS.primary : status === "won" ? COLORS.success : COLORS.danger;

  const titles: Record<string, string> = {
    active: `${BOMB} Mines`,
    won:    `${GEM} Mines — Cashed Out!`,
    lost:   `${BOMB} Mines — Bomb Hit!`,
  };

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(titles[status] ?? "Mines")
    .addFields(
      { name: "💰 Bet",        value: `${formatAmount(game.bet)} gems`,  inline: true },
      { name: `${BOMB} Mines`, value: `${game.minesCount}`,               inline: true },
      { name: "\u200b",        value: "\u200b",                           inline: true },
      { name: "✨ Multiplier", value: formatMult(game.multiplier),         inline: true },
      { name: "💎 Current",   value: `${formatAmount(currentWin)} gems`, inline: true },
      ...(status === "active"
        ? [{ name: "⭐ Next gem", value: `${formatAmount(nextWin)} gems`, inline: true }]
        : [{ name: "\u200b", value: "\u200b", inline: true }]),
    )
    .setTimestamp();


  return embed;
}

// ─── Grid (5×5, fills all 5 action rows) ─────────────────────────────────────
export function buildMinesGrid(
  game: MinesGame,
  showAll: boolean,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  for (let row = 0; row < 5; row++) {
    const actionRow = new ActionRowBuilder<MessageActionRowComponentBuilder>();
    for (let col = 0; col < 5; col++) {
      const idx        = row * 5 + col;
      const isRevealed = game.revealed[idx];
      const cell       = game.board[idx];

      let btn: ButtonBuilder;
      if (isRevealed || showAll) {
        const isGem = cell === "gem";
        btn = new ButtonBuilder()
          .setCustomId(`mines_r_${idx}`)
          .setLabel(isGem ? GEM : BOMB)
          .setStyle(isGem ? (isRevealed ? ButtonStyle.Success : ButtonStyle.Secondary) : ButtonStyle.Danger)
          .setDisabled(true);
      } else {
        btn = new ButtonBuilder()
          .setCustomId(`mines_r_${idx}`)
          .setLabel("⬜")
          .setStyle(ButtonStyle.Secondary);
      }
      actionRow.addComponents(btn);
    }
    rows.push(actionRow);
  }
  return rows;
}

// ─── Cashout row ──────────────────────────────────────────────────────────────
function buildCashoutRow(enabled: boolean): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("mines_cash")
      .setLabel("💸  Cash Out")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!enabled),
  );
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("mines")
  .setDescription("Play the Mines game")
  .addStringOption((opt) =>
    opt.setName("amount").setDescription("Bet amount (e.g. 1m, 2.5b)").setRequired(true),
  )
  .addIntegerOption((opt) =>
    opt.setName("mines").setDescription("Number of mines (1–24)").setRequired(true).setMinValue(1).setMaxValue(24),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const amountStr  = interaction.options.getString("amount", true);
  const minesCount = interaction.options.getInteger("mines", true);
  const amount     = parseAmount(amountStr);

  if (!amount || amount <= 0) {
    return interaction.editReply({ embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")] });
  }
  if (activeMinesGames.has(interaction.user.id)) {
    return interaction.editReply({ embeds: [errorEmbed("You already have an active Mines game!")] });
  }

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount) {
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} gems**.`)],
    });
  }

  await addBalance(interaction.user.id, -amount);

  // Generate board
  const board: ("gem" | "bomb")[] = Array(25).fill("gem");
  const minePositions = new Set<number>();
  while (minePositions.size < minesCount) minePositions.add(Math.floor(Math.random() * 25));
  minePositions.forEach((pos) => (board[pos] = "bomb"));

  const game: MinesGame = {
    userId:             interaction.user.id,
    bet:                amount,
    minesCount,
    board,
    revealed:           Array(25).fill(false),
    gemsFound:          0,
    multiplier:         1.0,
    panelGridMessageId: "",
    cashoutMessageId:   "",
    channelId:          interaction.channelId,
  };

  // Message 1: panel embed + 5×5 grid (embed + components in same message — Discord allows this)
  const panelGridMsg = await interaction.editReply({
    embeds:     [buildMinesPanelEmbed(game, "active")],
    components: buildMinesGrid(game, false),
  });
  game.panelGridMessageId = panelGridMsg.id;

  // Message 2: cashout button only (appears right below, looks joined)
  const channel     = interaction.channel!;
  const cashoutMsg  = await channel.send({ components: [buildCashoutRow(false)] });
  game.cashoutMessageId = cashoutMsg.id;

  activeMinesGames.set(interaction.user.id, game);
}

// ─── Button: reveal cell (grid is in message 1) ───────────────────────────────
export async function handleReveal(interaction: ButtonInteraction, cellIndex: number) {
  await interaction.deferUpdate();

  const game = activeMinesGames.get(interaction.user.id);
  if (!game || game.revealed[cellIndex]) return;

  game.revealed[cellIndex] = true;
  const isGem   = game.board[cellIndex] === "gem";
  const channel = interaction.channel!;

  if (isGem) {
    game.gemsFound++;
    game.multiplier = calcMinesMultiplier(game.minesCount, game.gemsFound);
    const totalGems = 25 - game.minesCount;

    if (game.gemsFound === totalGems) {
      // Auto-win — found all gems
      activeMinesGames.delete(interaction.user.id);
      const winnings = Math.floor(game.bet * game.multiplier);
      await addBalance(interaction.user.id, winnings);

      await interaction.editReply({
        embeds:     [buildMinesPanelEmbed(game, "won")],
        components: buildMinesGrid(game, false),
      });
      const cashoutMsg = await channel.messages.fetch(game.cashoutMessageId);
      await cashoutMsg.delete();
    } else {
      // Update panel + grid, enable cashout
      await interaction.editReply({
        embeds:     [buildMinesPanelEmbed(game, "active")],
        components: buildMinesGrid(game, false),
      });
      const cashoutMsg = await channel.messages.fetch(game.cashoutMessageId);
      await cashoutMsg.edit({ components: [buildCashoutRow(true)] });
    }
  } else {
    // Bomb hit — reveal all
    activeMinesGames.delete(interaction.user.id);
    await interaction.editReply({
      embeds:     [buildMinesPanelEmbed(game, "lost")],
      components: buildMinesGrid(game, true),
    });
    const cashoutMsg = await channel.messages.fetch(game.cashoutMessageId);
    await cashoutMsg.delete();
  }
}

// ─── Button: cashout (cashout button is in message 2) ────────────────────────
export async function handleCashout(interaction: ButtonInteraction) {
  await interaction.deferUpdate();

  const game = activeMinesGames.get(interaction.user.id);
  if (!game) return;

  if (game.gemsFound === 0) {
    await interaction.followUp({
      embeds: [errorEmbed("Reveal at least one gem before cashing out!")],
      ephemeral: true,
    });
    return;
  }

  activeMinesGames.delete(interaction.user.id);
  const winnings = Math.floor(game.bet * game.multiplier);
  await addBalance(interaction.user.id, winnings);

  // Delete the cashout message and update panel+grid in parallel
  const channel      = interaction.channel!;
  const panelGridMsg = await channel.messages.fetch(game.panelGridMessageId);
  await Promise.all([
    interaction.message.delete(),
    panelGridMsg.edit({
      embeds:     [buildMinesPanelEmbed(game, "won")],
      components: buildMinesGrid(game, false),
    }),
  ]);
}
