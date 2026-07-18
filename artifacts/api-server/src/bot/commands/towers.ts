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

export interface TowersGame {
  userId: string;
  bet: number;
  difficulty: Difficulty;
  level: number;        // current level (0-indexed), max 8
  maxLevels: number;
  multiplier: number;
  row: TileType[];      // current level's tiles [left, mid, right]
  messageId: string;
  channelId: string;
}

export const activeTowersGames = new Map<string, TowersGame>();

// ─── Config ───────────────────────────────────────────────────────────────────
const MAX_LEVELS = 8;

/** Multiplier gain per level for each difficulty */
const LEVEL_MULT: Record<Difficulty, number> = {
  easy:   1.46,  // 2/3 safe → fair 1.5 × 0.97
  medium: 1.94,  // 1/2 safe → fair 2.0 × 0.97
  hard:   2.91,  // 1/3 safe → fair 3.0 × 0.97
};

const DIFF_LABEL: Record<Difficulty, string> = {
  easy:   "🟢 Easy   (2 💎, 1 💣)",
  medium: "🟡 Medium (1 💎, 1 💣)",
  hard:   "🔴 Hard   (1 💎, 2 💣)",
};

/** Generate a shuffled row for the given difficulty */
function generateRow(difficulty: Difficulty): TileType[] {
  let tiles: TileType[];
  if (difficulty === "easy") {
    tiles = ["diamond", "diamond", "bomb"];
  } else if (difficulty === "medium") {
    // 1 diamond, 1 bomb — only 2 meaningful tiles; 3rd position handled by hiding middle
    tiles = ["diamond", "bomb", "diamond"]; // will be overridden with shuffle + disabled 3rd
  } else {
    tiles = ["diamond", "bomb", "bomb"];
  }

  // Shuffle
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j]!, tiles[i]!];
  }
  return tiles;
}

/** For medium, only show 2 buttons */
function getMediumRow(): TileType[] {
  const options: TileType[] = ["diamond", "bomb"];
  const j = Math.floor(Math.random() * 2);
  [options[0], options[1]] = [options[j]!, options[1 - j]!];
  return options; // length 2; 3rd button will be disabled spacer
}

// ─── UI builders ─────────────────────────────────────────────────────────────
function buildLevelBar(current: number, max: number): string {
  const bars = Array.from({ length: max }, (_, i) => {
    if (i < current) return "🟩";
    if (i === current) return "🔷";
    return "⬜";
  });
  return bars.join("");
}

export function buildTowersEmbed(
  game: TowersGame,
  status: "active" | "won" | "lost" | "cashed",
): EmbedBuilder {
  const currentWin = Math.floor(game.bet * game.multiplier);
  const nextMult = game.multiplier * LEVEL_MULT[game.difficulty];
  const nextWin = Math.floor(game.bet * nextMult);

  const color =
    status === "active"
      ? COLORS.primary
      : status === "won" || status === "cashed"
        ? COLORS.success
        : COLORS.danger;

  const titleMap: Record<string, string> = {
    active: `🗼 Towers — Level ${game.level + 1} / ${game.maxLevels}`,
    won:    `🗼 Towers — Cleared All Levels! 🏆`,
    lost:   `🗼 Towers — Bomb Hit! 💥`,
    cashed: `🗼 Towers — Cashed Out! 💸`,
  };

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(titleMap[status] ?? "Towers")
    .addFields(
      {
        name: "💰 Bet",
        value: `${formatAmount(game.bet)} gems`,
        inline: true,
      },
      {
        name: "🎯 Difficulty",
        value: DIFF_LABEL[game.difficulty],
        inline: true,
      },
      { name: "\u200b", value: "\u200b", inline: true },
      {
        name: "✨ Multiplier",
        value: formatMult(game.multiplier),
        inline: true,
      },
      {
        name: `${GEM} Current`,
        value: `${formatAmount(currentWin)} gems`,
        inline: true,
      },
      ...(status === "active"
        ? [
            {
              name: "⭐ Next level",
              value: `${formatAmount(nextWin)} gems`,
              inline: true,
            },
          ]
        : [{ name: "\u200b", value: "\u200b", inline: true }]),
    )
    .setDescription(
      `\n**Progress**\n${buildLevelBar(game.level, game.maxLevels)}\n`,
    )
    .setTimestamp();

  if (status === "cashed") {
    embed.setFooter({
      text: `Profit: +${formatAmount(currentWin - game.bet)} gems`,
    });
  } else if (status === "lost") {
    embed.setFooter({ text: `Lost: ${formatAmount(game.bet)} gems` });
  } else if (status === "won") {
    embed.setFooter({
      text: `Profit: +${formatAmount(currentWin - game.bet)} gems  •  All ${game.maxLevels} levels cleared!`,
    });
  }

  return embed;
}

export function buildTowersComponents(
  game: TowersGame,
  disabled: boolean,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const isMedium = game.difficulty === "medium";

  const choiceRow =
    new ActionRowBuilder<MessageActionRowComponentBuilder>();

  const labels = ["◀  Left", "⬛  Mid", "▶  Right"];
  const ids = ["towers_l", "towers_m", "towers_r"];

  if (isMedium) {
    // Only Left and Right; Middle is a disabled spacer
    choiceRow.addComponents(
      new ButtonBuilder()
        .setCustomId("towers_l")
        .setLabel("◀  Left")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId("towers_m")
        .setLabel("  ·  ")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId("towers_r")
        .setLabel("▶  Right")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
    );
  } else {
    for (let i = 0; i < 3; i++) {
      choiceRow.addComponents(
        new ButtonBuilder()
          .setCustomId(ids[i]!)
          .setLabel(labels[i]!)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),
      );
    }
  }

  const cashRow =
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
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
  .setDescription("Climb the Towers — pick safe tiles to multiply your bet!")
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
        { name: "🟢 Easy (2 diamonds, 1 bomb)", value: "easy" },
        { name: "🟡 Medium (1 diamond, 1 bomb)", value: "medium" },
        { name: "🔴 Hard (1 diamond, 2 bombs)", value: "hard" },
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const amountStr = interaction.options.getString("amount", true);
  const difficulty = interaction.options.getString(
    "difficulty",
    true,
  ) as Difficulty;

  const amount = parseAmount(amountStr);
  if (!amount || amount <= 0) {
    return interaction.editReply({
      embeds: [errorEmbed("Invalid amount. Try `1m`, `2.5b`, `500k`.")],
    });
  }

  if (activeTowersGames.has(interaction.user.id)) {
    return interaction.editReply({
      embeds: [
        errorEmbed("You already have an active Towers game! Finish it first."),
      ],
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
          `Insufficient balance. You have **${formatAmount(user.balance)} gems**.`,
        ),
      ],
    });
  }

  await addBalance(interaction.user.id, -amount);

  const row =
    difficulty === "medium" ? getMediumRow() : generateRow(difficulty);

  const game: TowersGame = {
    userId: interaction.user.id,
    bet: amount,
    difficulty,
    level: 0,
    maxLevels: MAX_LEVELS,
    multiplier: 1.0,
    row,
    messageId: "",
    channelId: interaction.channelId,
  };

  const msg = await interaction.editReply({
    embeds: [buildTowersEmbed(game, "active")],
    components: buildTowersComponents(game, false),
  });

  game.messageId = msg.id;
  activeTowersGames.set(interaction.user.id, game);
}

// ─── Button handlers ──────────────────────────────────────────────────────────
type TowerChoice = "l" | "m" | "r";

const CHOICE_INDEX: Record<TowerChoice, number> = { l: 0, m: 1, r: 2 };

export async function handleChoice(
  interaction: ButtonInteraction,
  choice: TowerChoice,
) {
  await interaction.deferUpdate();

  const game = activeTowersGames.get(interaction.user.id);
  if (!game) {
    await interaction.followUp({
      embeds: [errorEmbed("No active Towers game found.")],
      ephemeral: true,
    });
    return;
  }

  const colIndex = CHOICE_INDEX[choice];

  // For medium, col 1 (mid) is disabled — shouldn't reach here
  const tile = game.row[colIndex] ?? "bomb";

  if (tile === "bomb") {
    // Game over
    activeTowersGames.delete(interaction.user.id);
    await interaction.editReply({
      embeds: [buildTowersEmbed(game, "lost")],
      components: buildTowersComponents(game, true),
    });
    return;
  }

  // Safe — advance level
  game.multiplier *= LEVEL_MULT[game.difficulty];
  game.level++;

  if (game.level >= game.maxLevels) {
    // All levels cleared — auto win
    activeTowersGames.delete(interaction.user.id);
    const winnings = Math.floor(game.bet * game.multiplier);
    await addBalance(interaction.user.id, winnings);

    await interaction.editReply({
      embeds: [buildTowersEmbed(game, "won")],
      components: buildTowersComponents(game, true),
    });
    return;
  }

  // Generate next row
  game.row =
    game.difficulty === "medium" ? getMediumRow() : generateRow(game.difficulty);

  await interaction.editReply({
    embeds: [buildTowersEmbed(game, "active")],
    components: buildTowersComponents(game, false),
  });
}

export async function handleCashout(interaction: ButtonInteraction) {
  await interaction.deferUpdate();

  const game = activeTowersGames.get(interaction.user.id);
  if (!game) {
    await interaction.followUp({
      embeds: [errorEmbed("No active Towers game found.")],
      ephemeral: true,
    });
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
    embeds: [buildTowersEmbed(game, "cashed")],
    components: buildTowersComponents(game, true),
  });
}
