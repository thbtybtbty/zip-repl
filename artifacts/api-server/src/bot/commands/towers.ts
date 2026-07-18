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

// ─── Types ────────────────────────────────────────────────────────────────────
type Difficulty = "easy" | "medium" | "hard";
type TileType = "diamond" | "bomb";

interface LevelRecord {
  picked: number;          // column index chosen
  result: "safe" | "bomb";
  row: TileType[];         // full tile layout so we can reveal it
}

export interface TowersGame {
  userId: string;
  bet: number;
  difficulty: Difficulty;
  level: number;           // current 0-indexed level
  maxLevels: number;
  multiplier: number;
  row: TileType[];         // current level's tiles
  history: LevelRecord[];  // past levels (index 0 = level 1)
  messageId: string;
  channelId: string;
}

export const activeTowersGames = new Map<string, TowersGame>();

// ─── Config ───────────────────────────────────────────────────────────────────
const MAX_LEVELS = 8;

const LEVEL_MULT: Record<Difficulty, number> = {
  easy:   1.46,
  medium: 1.94,
  hard:   2.91,
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

// ─── Tower visual (top → bottom, highest level first) ────────────────────────
// Tile emojis:
//   💎  = diamond you picked (safe, correct pick)
//   🔹  = diamond you didn't pick (revealed after level complete)
//   💣  = bomb (revealed after level)
//   🟦  = current level slot (unknown, clickable via buttons)
//   ⬛  = locked future level slot

function tileEmoji(type: TileType, picked: boolean): string {
  if (type === "diamond") return picked ? "💎" : "🔹";
  return "💣"; // bomb always shows as bomb after reveal
}

function buildTowerVisual(game: TowersGame): string {
  const isMedium = game.difficulty === "medium";
  const colCount = isMedium ? 2 : 3;
  const lines: string[] = [];

  for (let lvl = game.maxLevels; lvl >= 1; lvl--) {
    const idx      = lvl - 1;
    const isCurrent = idx === game.level;
    const isFuture  = idx > game.level;

    let tileStr: string;

    if (isFuture) {
      tileStr = Array(colCount).fill("⬛").join("  ");
    } else if (isCurrent) {
      tileStr = Array(colCount).fill("🟦").join("  ");
    } else {
      // Completed — reveal full tile layout
      const record = game.history[idx];
      if (!record) { tileStr = Array(colCount).fill("▫️").join("  "); }
      else {
        const cells = record.row.map((tile, c) => tileEmoji(tile, c === record.picked));
        tileStr = cells.join("  ");
      }
    }

    const prefix = isCurrent ? "▶ " : "   ";
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

  const embed = new EmbedBuilder()
    .setColor(colors[status] ?? COLORS.primary)
    .setTitle(titles[status] ?? "Towers")
    .setDescription(buildTowerVisual(game))
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


  return embed;
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
      new ButtonBuilder()
        .setCustomId("towers_l")
        .setLabel("⬅  Left")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId("towers_m")
        .setLabel("　·　")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId("towers_r")
        .setLabel("Right  ➡")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
    );
  } else {
    choiceRow.addComponents(
      new ButtonBuilder()
        .setCustomId("towers_l")
        .setLabel("⬅  Left")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId("towers_m")
        .setLabel("⬆  Mid")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId("towers_r")
        .setLabel("Right  ➡")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
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

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("towers")
  .setDescription("Climb the tower — pick safe tiles to multiply your bet!")
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

  if (!amount || amount <= 0) {
    return interaction.editReply({ embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")] });
  }
  if (activeTowersGames.has(interaction.user.id)) {
    return interaction.editReply({ embeds: [errorEmbed("You already have an active Towers game!")] });
  }

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount) {
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} gems**.`)],
    });
  }

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

  // For medium, right button maps to index 1 in the 2-tile row
  let colIndex = CHOICE_INDEX[choice];
  if (game.difficulty === "medium" && choice === "r") colIndex = 1;

  const tile = game.row[colIndex] ?? "bomb";

  // Record this level's result (with full row revealed)
  game.history.push({ picked: colIndex, result: tile === "diamond" ? "safe" : "bomb", row: game.row });

  if (tile === "bomb") {
    activeTowersGames.delete(interaction.user.id);
    await interaction.editReply({
      embeds:     [buildTowersEmbed(game, "lost")],
      components: buildTowersComponents(game, true),
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
    await interaction.editReply({
      embeds:     [buildTowersEmbed(game, "won")],
      components: buildTowersComponents(game, true),
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

  await interaction.editReply({
    embeds:     [buildTowersEmbed(game, "cashed")],
    components: buildTowersComponents(game, true),
  });
}
