import {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { COLORS, errorEmbed } from "../utils.js";
import { isAdmin } from "../botConfig.js";
import { getDisabledGames, disableGame, enableGame, isGameDisabled } from "../botState.js";

// ─── All games ────────────────────────────────────────────────────────────────
const ALL_GAMES = [
  { name: "🃏 Blackjack",          value: "blackjack" },
  { name: "💣 Mines",              value: "mines" },
  { name: "🗼 Towers",             value: "towers" },
  { name: "🪙 Coin Flip",          value: "coinflip" },
  { name: "✊ Rock Paper Scissors", value: "rps" },
  { name: "🎡 Wheel",              value: "wheel" },
  { name: "🎰 Slots",              value: "slots" },
  { name: "🃏 Hi-Lo",              value: "hilo" },
  { name: "🎰 Scratchcard",        value: "scratchcard" },
  { name: "🐔 Chicken Crossing",   value: "chickencrossing" },
  { name: "🎲 Color Dice",         value: "colordice" },
  { name: "⚡ Upgrader",           value: "upgrader" },
  { name: "🎯 Keno",               value: "keno" },
  { name: "🚀 Crash",              value: "crash" },
  { name: "🪙 Flip",               value: "flip" },
  { name: "🎡 Roulette",           value: "roulette" },
];

const GAME_LABEL = Object.fromEntries(ALL_GAMES.map((g) => [g.value, g.name]));

export const data = new SlashCommandBuilder()
  .setName("game")
  .setDescription("[Admin] Enable or disable games")
  .addSubcommand((sub) =>
    sub
      .setName("disable")
      .setDescription("Disable a game so players cannot play it")
      .addStringOption((opt) =>
        opt.setName("game").setDescription("Game to disable").setRequired(true)
          .addChoices(...ALL_GAMES),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("Show all disabled games and optionally re-enable one"),
  );

// ─── /game disable ────────────────────────────────────────────────────────────
async function handleDisable(interaction: ChatInputCommandInteraction) {
  const game = interaction.options.getString("game", true);

  if (isGameDisabled(game)) {
    return interaction.editReply({
      embeds: [errorEmbed(`**${GAME_LABEL[game] ?? game}** is already disabled.`)],
    });
  }

  disableGame(game);

  const embed = new EmbedBuilder()
    .setColor(COLORS.danger)
    .setTitle("🚫  Game Disabled")
    .setDescription(
      `**${GAME_LABEL[game] ?? game}** has been **disabled**.\n` +
      `Players who try to use it will be told it is currently unavailable.\n\n` +
      `Use \`/game list\` to re-enable it.`,
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ─── /game list ───────────────────────────────────────────────────────────────
async function handleList(interaction: ChatInputCommandInteraction) {
  const disabled = getDisabledGames();

  if (disabled.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle("🎮  Game Status")
      .setDescription("All games are currently **enabled**.")
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  }

  const lines = disabled.map((g) => `• ${GAME_LABEL[g] ?? g}`).join("\n");

  const embed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle(`🚫  Disabled Games — ${disabled.length}`)
    .setDescription(`${lines}\n\nSelect a game below to **re-enable** it.`)
    .setTimestamp();

  const options = disabled.slice(0, 25).map((g) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`Enable ${GAME_LABEL[g] ?? g}`.replace(/[^\w\s()-]/gu, "").trim() || `Enable ${g}`)
      .setValue(g)
      .setDescription(`Re-enable ${g} for all players`)
      .setEmoji("✅"),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId("game_enable_select")
    .setPlaceholder("Select a game to enable…")
    .addOptions(options);

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select);

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ─── Main execute ─────────────────────────────────────────────────────────────
export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isAdmin(interaction.user.id)) {
    return interaction.editReply({ embeds: [errorEmbed("Admin only.")] });
  }

  const sub = interaction.options.getSubcommand();
  if (sub === "disable") return handleDisable(interaction);
  if (sub === "list")    return handleList(interaction);
}

// ─── Select: enable game ──────────────────────────────────────────────────────
export async function handleEnableSelect(interaction: StringSelectMenuInteraction) {
  if (!isAdmin(interaction.user.id)) {
    return interaction.reply({ embeds: [errorEmbed("Admin only.")], flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();

  const game = interaction.values[0]!;
  enableGame(game);

  const remaining = getDisabledGames();
  const lines     = remaining.map((g) => `• ${GAME_LABEL[g] ?? g}`).join("\n");

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle("✅  Game Enabled")
    .setDescription(
      `**${GAME_LABEL[game] ?? game}** is now **enabled** again.\n\n` +
      (remaining.length > 0
        ? `**Still disabled:**\n${lines}`
        : `All games are now enabled.`),
    )
    .setTimestamp();

  if (remaining.length === 0) {
    await interaction.editReply({ embeds: [embed], components: [] });
  } else {
    const options = remaining.slice(0, 25).map((g) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`Enable ${GAME_LABEL[g] ?? g}`.replace(/[^\w\s()-]/gu, "").trim() || `Enable ${g}`)
        .setValue(g)
        .setEmoji("✅"),
    );
    const select = new StringSelectMenuBuilder()
      .setCustomId("game_enable_select")
      .setPlaceholder("Select a game to enable…")
      .addOptions(options);
    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select);
    await interaction.editReply({ embeds: [embed], components: [row] });
  }
}
