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
  picked: number;        // column index that was chosen (0=left,1=mid,2=right)
  result: "safe" | "bomb";
}

export interface TowersGame {
  userId: string;
  bet: number;
  difficulty: Difficulty;
  level: number;          // current 0-indexed level (0 = level 1)
  maxLevels: number;
  multiplier: number;
  row: TileType[];        // current level's tiles
  history: LevelRecord[]; // completed levels (index 0 = level 1)
  messageId: string;
  channelId: string;
}

export const activeTowersGames = new Map<string, TowersGame>();

// ─── Config ───────────────────────────────────────────────────────────────────
const MAX_LEVELS = 8;

const LEVEL_MULT: Record<Difficulty, number> = {
  easy:   1.46,  // 2/3 safe
  medium: 1.94,  // 1/2 safe
  hard:   2.91,  // 1/3 safe
};

const DIFF_LABEL: Record<Difficulty, string> = {
  easy:   "🟢 Easy",
  medium: "🟡 Medium",
  hard:   "🔴 Hard",
};

const DIFF_TILES: Record<Difficulty, string> = {
  easy:   "2 💎 · 1 💣",
  medium: "1 💎 · 1 💣",
  hard:   "1 💎 · 2 💣",
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
  if (difficulty === "easy")   return shuffle(["diamond", "diamond", "bomb"]);
  if (difficulty === "medium") return shuffle(["diamond", "bomb"]);   // length 2
  return shuffle(["diamond", "bomb", "bomb"]);
}

// ─── Tower visual ─────────────────────────────────────────────────────────────
/**
 * Builds a visual representation of all levels:
 *
 *  Lv 8  ⬛ ⬛ ⬛
 *  Lv 7  ⬛ ⬛ ⬛
 *  Lv 5  ⬛ ⬛ ⬛
 *  Lv 4  ⬛ ⬛ ⬛
 *  Lv 3  ⬛ ⬛ ⬛
 * ▶ Lv 2  ❓ ❓ ❓   ← current
 *   Lv 1  💎 · ·    ← completed safe
 */
function buildTowerVisual(game: TowersGame): string {
  const isMedium = game.difficulty === "medium";
  const colCount = isMedium ? 2 : 3;
  const lines: string[] = [];

  // Iterate top → bottom (maxLevels → 1)
  for (let lvl = game.maxLevels; lvl >= 1; lvl--) {
    const idx = lvl - 1; // 0-indexed
    const prefix = idx === game.level ? "▶" : " ";

    if (idx > game.level) {
      // Future level — locked
      const tiles = isMedium ? "⬛ ⬛" : "⬛ ⬛ ⬛";
      lines.push(`${prefix} **Lv ${lvl}**  ${tiles}`);
    } else if (idx === game.level) {
      // Current level — question marks
      const tiles = isMedium ? "❓ ❓" : "❓ ❓ ❓";
      lines.push(`${prefix} **Lv ${lvl}**  ${tiles}`);
    } else {
      // Completed level
      const record = game.history[idx];
      if (!record) continue;
      const cells: string[] = [];
      for (let c = 0; c < colCount; c++) {
        if (c === record.picked) {
          cells.push(record.result === "safe" ? "💎" : "💣");
        } else {
          cells.push("▫️");
        }
      }
      lines.push(`${prefix} **Lv ${lvl}**  ${cells.join(" ")}`);
    }
  }

  return lines.join("\n");
}

// ─── Embed builder ────────────────────────────────────────────────────────────
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

  const titles: Record<string, string> = {
    active: `🗼 Towers — Level ${game.level + 1} / ${game.maxLevels}`,
    won:    `🗼 Towers — All Levels Cleared! 🏆`,
    lost:   `🗼 Towers — Bomb Hit! 💥`,
    cashed: `🗼 Towers — Cashed Out! 💸`,
  };

  const embed = new EmbedBuilder()
    .setColor(colors[status] ?? COLORS.primary)
    .setTitle(titles[status] ?? "Towers")
    .setDescription(buildTowerVisual(game))
    .addFields(
      { name: "💰 Bet",         value: `${formatAmount(game.bet)} gems`,      inline: true },
      { name: "🎯 Difficulty",  value: `${DIFF_LABEL[game.difficulty]}\n${DIFF_TILES[game.difficulty]}`, inline: true },
      { name: "\u200b",         value: "\u200b",                               inline: true },
      { name: "✨ Multiplier",  value: formatMult(game.multiplier),            inline: true },
      { name: "💎 Current",    value: `${formatAmount(currentWin)} gems`,     inline: true },
      ...(status === "active"
        ? [{ name: "⭐ Next level", value: `${formatAmount(nextWin)} gems`, inline: true }]
        : [{ name: "\u200b", value: "\u200b", inline: true }]),
    )
    .setTimestamp();

  if (status === "cashed") embed.setFooter({ text: `Profit: +${formatAmount(currentWin - game.bet)} gems` });
  if (status === "lost")   embed.setFooter({ text: `Lost: ${formatAmount(game.bet)} gems` });
  if (status === "won")    embed.setFooter({ text: `Profit: +${formatAmount(currentWin - game.bet)} gems  ·  All ${game.maxLevels} levels cleared!` });

  return embed;
}

// ─── Components builder ───────────────────────────────────────────────────────
export function buildTowersComponents(
  game: TowersGame,
  disabled: boolean,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const isMedium = game.difficulty === "medium";

  const choiceRow = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  if (isMedium) {
    // Left and Right only; middle is a disabled spacer
    choiceRow.addComponents(
      new ButtonBuilder()
        .setCustomId("towers_l")
        .setLabel("⬅  Left")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId("towers_m")
        .setLabel("・")
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

  const canCashout = !disabled && game.multiplier > 1.0;
  const cashRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("towers_cash")
      .setLabel("💸  Cash Out")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canCashout),
  );

  return [choiceRow, cashRow];
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("towers")
  .setDescription("Climb the tower — pick safe tiles to multiply your bet!")
  .addStringOption((opt) =>
    opt
      .setName("amount")
      .setDescription("Bet amount (e.g. 1m, 2.5b)")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("difficulty")
      .setDescription("Game difficulty")
      .setRequired(true)
      .addChoices(
        { name: "🟢 Easy — 2 diamonds, 1 bomb per level",  value: "easy" },
        { name: "🟡 Medium — 1 diamond, 1 bomb per level", value: "medium" },
        { name: "🔴 Hard — 1 diamond, 2 bombs per level",  value: "hard" },
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

  const colIndex = CHOICE_INDEX[choice];
  // For medium: left=0, right=1 (row length is 2)
  const effectiveIndex = game.difficulty === "medium" && colIndex === 2 ? 1 : colIndex;
  const tile = game.row[effectiveIndex] ?? "bomb";

  // Record history before modifying level
  game.history.push({ picked: effectiveIndex, result: tile === "diamond" ? "safe" : "bomb" });

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

  // Next level
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
