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
  GEM,
  BOMB,
  parseAmount,
  formatAmount,
  formatMult,
  getOrCreateUser,
  addBalance,
  recordBet,
  errorEmbed,
} from "../utils.js";

// ─── Types ────────────────────────────────────────────────────────────────────
type Difficulty = "easy" | "medium" | "hard";
type TileType = "diamond" | "bomb";

interface LevelRecord {
  picked: number;
  result: "safe" | "bomb";
  row: TileType[];
}

export interface TowersGame {
  userId: string;
  bet: number;
  difficulty: Difficulty;
  level: number;
  maxLevels: number;
  multiplier: number;
  row: TileType[];
  history: LevelRecord[];
  messageId: string;
  channelId: string;
}

export const activeTowersGames = new Map<string, TowersGame>();

// ─── Config ───────────────────────────────────────────────────────────────────
const MAX_LEVELS = 8;

const LEVEL_MULT: Record<Difficulty, number> = {
  easy:   1.39,
  medium: 1.85,
  hard:   2.775,
};

// ─── Row generation ───────────────────────────────────────────────────────────
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function generateRow(difficulty: Difficulty): TileType[] {
  if (difficulty === "easy")   return shuffle(["diamond", "diamond", "bomb"] as TileType[]);
  if (difficulty === "medium") return shuffle(["diamond", "bomb"] as TileType[]);
  return shuffle(["diamond", "bomb", "bomb"] as TileType[]);
}

// ─── Tower visual ─────────────────────────────────────────────────────────────
function tileEmoji(type: TileType, picked: boolean, exploded = false): string {
  if (exploded && type === "bomb") return "💥";
  if (type === "diamond") return picked ? "💎" : "🔹";
  return "💣";
}

function buildTowerVisual(game: TowersGame, status: "active" | "won" | "lost" | "cashed"): string {
  const isMedium = game.difficulty === "medium";
  const colCount = isMedium ? 2 : 3;
  const lines: string[] = [];

  for (let lvl = game.maxLevels; lvl >= 1; lvl--) {
    const idx       = lvl - 1;
    const isCurrent = idx === game.level;
    const isFuture  = idx > game.level;

    let tileStr: string;

    if (isFuture) {
      tileStr = Array(colCount).fill("⬛").join("  ");
    } else if (isCurrent && status !== "lost") {
      tileStr = Array(colCount).fill("🟦").join("  ");
    } else {
      const record = game.history[idx];
      if (!record) { tileStr = Array(colCount).fill("▫️").join("  "); }
      else {
        const isLostLevel = status === "lost" && isCurrent;
        const cells = record.row.map((tile, c) => {
          const picked   = c === record.picked;
          const exploded = isLostLevel && picked && tile === "bomb";
          return tileEmoji(tile, picked, exploded);
        });
        tileStr = cells.join("  ");
      }
    }

    const prefix = (isCurrent && status !== "lost") ? "▶ " : "   ";
    const label  = `Lv ${String(lvl).padStart(2, " ")}`;
    lines.push(`${prefix}\`${label}\`  ${tileStr}`);
  }

  return lines.join("\n");
}

// ─── Embed ────────────────────────────────────────────────────────────────────
export function buildTowersEmbed(
  game: TowersGame,
  status: "active" | "won" | "lost" | "cashed",
): EmbedBuilder {
  const currentWin = Math.floor(game.bet * game.multiplier);
  const nextMult   = game.multiplier * LEVEL_MULT[game.difficulty];
  const nextWin    = Math.floor(game.bet * nextMult);

  const colors: Record<string, number> = {
    active: COLORS.primary,
    won:    COLORS.success,
    cashed: COLORS.success,
    lost:   COLORS.danger,
  };

  const diffName: Record<Difficulty, string> = {
    easy:   "🟢 Easy",
    medium: "🟡 Medium",
    hard:   "🔴 Hard",
  };

  const titles: Record<string, string> = {
    active: `🗼 Towers — Level ${game.level + 1} / ${game.maxLevels}`,
    won:    `🗼 Towers — Cleared! 🏆`,
    lost:   `🗼 Towers — Bomb Hit! 💥`,
    cashed: `🗼 Towers — Cashed Out!`,
  };

  return new EmbedBuilder()
    .setColor(colors[status] ?? COLORS.primary)
    .setTitle(titles[status] ?? "Towers")
    .setDescription(buildTowerVisual(game, status))
    .addFields(
      { name: "💰 Bet",        value: `${formatAmount(game.bet)} gems`,  inline: true },
      { name: "🎯 Difficulty", value: diffName[game.difficulty],          inline: true },
      { name: "\u200b",        value: "\u200b",                           inline: true },
      { name: "✨ Multiplier", value: formatMult(game.multiplier),        inline: true },
      { name: "💎 Current",   value: `${formatAmount(currentWin)} gems`, inline: true },
      ...(status === "active"
        ? [{ name: "⭐ Next",  value: `${formatAmount(nextWin)} gems`,   inline: true }]
        : [{ name: "\u200b",   value: "\u200b",                           inline: true }]),
    )
    .setTimestamp();
}

// ─── Components ───────────────────────────────────────────────────────────────
export function buildTowersComponents(
  game: TowersGame,
  disabled: boolean,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const isMedium = game.difficulty === "medium";

  const choiceRow = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  if (isMedium) {
    choiceRow.addComponents(
      new ButtonBuilder().setCustomId("towers_l").setLabel("⬅  Left").setStyle(ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("towers_m").setLabel("　·　").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("towers_r").setLabel("Right  ➡").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    );
  } else {
    choiceRow.addComponents(
      new ButtonBuilder().setCustomId("towers_l").setLabel("⬅  Left").setStyle(ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("towers_m").setLabel("⬆  Mid").setStyle(ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("towers_r").setLabel("Right  ➡").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    );
  }

  const cashRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("towers_cash")
      .setLabel("💸  Cash Out")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled || game.multiplier <= 1.0),
  );

  return [choiceRow, cashRow];
}

function buildEndComponents(
  game: TowersGame,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const base = buildTowersComponents(game, true);
  base.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`pa_towers_${game.userId}_${game.difficulty}_${game.bet}`)
        .setLabel("🔄  Play Again")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return base;
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("towers")
  .setDescription("Play the Towers game")
  .addStringOption((opt) =>
    opt.setName("amount").setDescription("Bet amount (e.g. 1m, 2.5b)").setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("difficulty")
      .setDescription("Game difficulty")
      .setRequired(true)
      .addChoices(
        { name: "🟢 Easy — 2 diamonds, 1 bomb",  value: "easy" },
        { name: "🟡 Medium — 1 diamond, 1 bomb", value: "medium" },
        { name: "🔴 Hard — 1 diamond, 2 bombs",  value: "hard" },
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const amountStr  = interaction.options.getString("amount", true);
  const difficulty = interaction.options.getString("difficulty", true) as Difficulty;
  const amount     = parseAmount(amountStr);

  if (!amount || amount <= 0)
    return interaction.editReply({ embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")] });

  if (activeTowersGames.has(interaction.user.id))
    return interaction.editReply({ embeds: [errorEmbed("You already have an active Towers game!")] });

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount)
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} gems**.`)],
    });

  await addBalance(interaction.user.id, -amount);

  const game: TowersGame = {
    userId:     interaction.user.id,
    bet:        amount,
    difficulty,
    level:      0,
    maxLevels:  MAX_LEVELS,
    multiplier: 1.0,
    row:        generateRow(difficulty),
    history:    [],
    messageId:  "",
    channelId:  interaction.channelId,
  };

  const msg = await interaction.editReply({
    embeds:     [buildTowersEmbed(game, "active")],
    components: buildTowersComponents(game, false),
  });
  game.messageId = msg.id;
  activeTowersGames.set(interaction.user.id, game);
}

// ─── Button handlers ──────────────────────────────────────────────────────────
type TowerChoice = "l" | "m" | "r";
const CHOICE_INDEX: Record<TowerChoice, number> = { l: 0, m: 1, r: 2 };

export async function handleChoice(interaction: ButtonInteraction, choice: TowerChoice) {
  await interaction.deferUpdate();

  const game = activeTowersGames.get(interaction.user.id);
  if (!game) {
    await interaction.followUp({ embeds: [errorEmbed("No active Towers game.")], ephemeral: true });
    return;
  }

  let colIndex = CHOICE_INDEX[choice];
  if (game.difficulty === "medium" && choice === "r") colIndex = 1;

  const tile = game.row[colIndex] ?? "bomb";
  game.history.push({ picked: colIndex, result: tile === "diamond" ? "safe" : "bomb", row: game.row });

  if (tile === "bomb") {
    activeTowersGames.delete(interaction.user.id);
    await recordBet(interaction.user.id, game.bet, -game.bet);
    await interaction.editReply({
      embeds:     [buildTowersEmbed(game, "lost")],
      components: buildEndComponents(game),
    });
    return;
  }

  // Safe — advance
  game.multiplier *= LEVEL_MULT[game.difficulty];
  game.level++;

  if (game.level >= game.maxLevels) {
    activeTowersGames.delete(interaction.user.id);
    const winnings = Math.floor(game.bet * game.multiplier);
    await addBalance(interaction.user.id, winnings);
    await recordBet(interaction.user.id, game.bet, winnings - game.bet);
    await interaction.editReply({
      embeds:     [buildTowersEmbed(game, "won")],
      components: buildEndComponents(game),
    });
    return;
  }

  game.row = generateRow(game.difficulty);
  await interaction.editReply({
    embeds:     [buildTowersEmbed(game, "active")],
    components: buildTowersComponents(game, false),
  });
}

export async function handleCashout(interaction: ButtonInteraction) {
  await interaction.deferUpdate();

  const game = activeTowersGames.get(interaction.user.id);
  if (!game) {
    await interaction.followUp({ embeds: [errorEmbed("No active Towers game.")], ephemeral: true });
    return;
  }
  if (game.multiplier <= 1.0) {
    await interaction.followUp({
      embeds: [errorEmbed("Complete at least one level before cashing out!")],
      ephemeral: true,
    });
    return;
  }

  activeTowersGames.delete(interaction.user.id);
  const winnings = Math.floor(game.bet * game.multiplier);
  await addBalance(interaction.user.id, winnings);
  await recordBet(interaction.user.id, game.bet, winnings - game.bet);

  await interaction.editReply({
    embeds:     [buildTowersEmbed(game, "cashed")],
    components: buildEndComponents(game),
  });
}

// ─── Button: Play Again ───────────────────────────────────────────────────────
export async function handlePlayAgain(
  interaction: ButtonInteraction,
  userId: string,
  difficulty: string,
  betStr: string,
): Promise<void> {
  if (interaction.user.id !== userId) {
    return void interaction.reply({ content: "❌ This isn't your game.", flags: MessageFlags.Ephemeral });
  }
  if (activeTowersGames.has(userId)) {
    return void interaction.reply({ embeds: [errorEmbed("You already have an active Towers game!")], flags: MessageFlags.Ephemeral });
  }

  const bet  = parseInt(betStr, 10);
  const diff = difficulty as Difficulty;

  // Disable Play Again on the old message
  await interaction.deferUpdate();
  await interaction.editReply({
    components: [
      ...buildTowersComponents({ difficulty: diff } as TowersGame, true),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`pa_towers_${userId}_${difficulty}_${bet}`)
          .setLabel("🔄  Play Again")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      ),
    ],
  });

  const user = await getOrCreateUser(userId, interaction.user.username);
  if (user.balance < bet) {
    await interaction.followUp({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} gems**.`)],
      ephemeral: true,
    });
    return;
  }

  await addBalance(userId, -bet);

  const game: TowersGame = {
    userId,
    bet,
    difficulty: diff,
    level:      0,
    maxLevels:  MAX_LEVELS,
    multiplier: 1.0,
    row:        generateRow(diff),
    history:    [],
    messageId:  "",
    channelId:  interaction.channelId,
  };

  const msg: Message = await interaction.followUp({
    embeds:     [buildTowersEmbed(game, "active")],
    components: buildTowersComponents(game, false),
  });
  game.messageId = msg.id;
  activeTowersGames.set(userId, game);
}
