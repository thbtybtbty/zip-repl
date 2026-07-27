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
import { sqlite } from "@workspace/db";
import { COLORS, formatAmount } from "../utils.js";
import { isAdmin } from "../botConfig.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 4;

const GAME_CHOICES = [
  { name: "🎰 Slots",             value: "slots"           },
  { name: "💣 Mines",             value: "mines"           },
  { name: "🗼 Towers",            value: "towers"          },
  { name: "🃏 Blackjack",         value: "blackjack"       },
  { name: "🎴 Hi-Lo",             value: "hilo"            },
  { name: "🎡 Roulette",          value: "roulette"        },
  { name: "📈 Crash",             value: "crash"           },
  { name: "🪙 Coinflip",          value: "coinflip"        },
  { name: "✌️ RPS",               value: "rps"             },
  { name: "🎡 Wheel",             value: "wheel"           },
  { name: "🎱 Keno",              value: "keno"            },
  { name: "🎟️ Scratchcard",       value: "scratchcard"     },
  { name: "🐔 Chicken Crossing",  value: "chickencrossing" },
  { name: "🎲 Color Dice",        value: "colordice"       },
  { name: "⬆️ Upgrader",          value: "upgrader"        },
  { name: "🏆 Flip",              value: "flip"            },
] as const;

// ─── Label helper ─────────────────────────────────────────────────────────────
function gameLabel(command: string): string {
  if (command.startsWith("mines-")) {
    const n = command.slice(6);
    return `💣 Mines — ${n} mine${n === "1" ? "" : "s"}`;
  }
  const TOWERS: Record<string, string> = {
    "towers-easy":   "🗼 Towers — Easy",
    "towers-medium": "🗼 Towers — Medium",
    "towers-hard":   "🗼 Towers — Hard",
  };
  if (TOWERS[command]) return TOWERS[command]!;
  const MAP: Record<string, string> = {
    slots:           "🎰 Slots",
    blackjack:       "🃏 Blackjack",
    hilo:            "🎴 Hi-Lo",
    roulette:        "🎡 Roulette",
    crash:           "📈 Crash",
    coinflip:        "🪙 Coinflip",
    rps:             "✌️ RPS",
    wheel:           "🎡 Wheel",
    keno:            "🎱 Keno",
    scratchcard:     "🎟️ Scratchcard",
    chickencrossing: "🐔 Chicken Crossing",
    colordice:       "🎲 Color Dice",
    upgrader:        "⬆️ Upgrader",
    flip:            "🏆 Flip",
  };
  return MAP[command] ?? command;
}

// ─── Data types ───────────────────────────────────────────────────────────────
interface GameStat {
  command:     string;
  played:      number;
  houseProfit: number;
  biggestWin:  number;
  wins:        number;
  losses:      number;
}

// ─── Query ────────────────────────────────────────────────────────────────────
function fetchStats(filter: string): GameStat[] {
  let where: string;
  if (filter === "mines") {
    where = `command LIKE 'mines-%' AND admin_bet = 0`;
  } else if (filter === "towers") {
    where = `command IN ('towers-easy','towers-medium','towers-hard') AND admin_bet = 0`;
  } else if (filter === "all") {
    where = `command NOT IN ('tip-sent','tip-received','admin-grant') AND admin_bet = 0`;
  } else {
    // single game (e.g. "slots") — safe: value comes from Discord choices
    where = `command = '${filter}' AND admin_bet = 0`;
  }

  return sqlite.prepare(`
    SELECT
      command,
      COUNT(*) AS played,
      CAST(-SUM(net_delta) AS INTEGER) AS houseProfit,
      CAST(MAX(CASE WHEN net_delta > 0 THEN net_delta ELSE 0 END) AS INTEGER) AS biggestWin,
      SUM(CASE WHEN net_delta > 0 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN net_delta <= 0 THEN 1 ELSE 0 END) AS losses
    FROM bet_log
    WHERE ${where}
    GROUP BY command
    ORDER BY played DESC
  `).all() as GameStat[];
}

// ─── Page builder ─────────────────────────────────────────────────────────────
function buildPage(filter: string, page: number): { embed: EmbedBuilder; totalPages: number; page: number } {
  const rows = fetchStats(filter);

  if (rows.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.dark)
      .setTitle("📊 Game Statistics")
      .setDescription("*No data recorded yet.*");
    return { embed, totalPages: 1, page: 1 };
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage   = Math.max(1, Math.min(page, totalPages));
  const slice      = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const title = filter === "all"
    ? "📊 Game Statistics — All Games"
    : `📊 Game Statistics — ${gameLabel(filter)}`;

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(title)
    .setFooter({ text: `Page ${safePage}/${totalPages}  ·  ${rows.length} game variant(s)` })
    .setTimestamp();

  for (const row of slice) {
    const winRate  = row.played > 0 ? Math.round((row.wins / row.played) * 100) : 0;
    const profit   = row.houseProfit >= 0 ? `+${formatAmount(row.houseProfit)}` : `-${formatAmount(Math.abs(row.houseProfit))}`;
    const bigWin   = row.biggestWin > 0 ? formatAmount(row.biggestWin) : "—";

    embed.addFields({
      name: gameLabel(row.command),
      value:
        `▸ Played: **${row.played.toLocaleString()}**  ·  ` +
        `Win Rate: **${winRate}%** (✅ ${row.wins} · ❌ ${row.losses})\n` +
        `▸ House Profit: **${profit} 💎**  ·  Biggest Win: **${bigWin} 💎**`,
      inline: false,
    });
  }

  return { embed, totalPages, page: safePage };
}

// ─── Page row ─────────────────────────────────────────────────────────────────
function pageRow(
  filter: string,
  page: number,
  totalPages: number,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`stats_prev_${filter}_${page}`)
      .setLabel("◀  Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`stats_cur_${filter}_${page}`)
      .setLabel(`${page} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`stats_next_${filter}_${page}`)
      .setLabel("Next  ▶")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages),
  );
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("[Admin] Per-game statistics")
  .addStringOption((opt) => {
    opt.setName("game").setDescription("Show a specific game (default: all)").setRequired(false);
    for (const c of GAME_CHOICES) opt.addChoices(c);
    return opt;
  });

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isAdmin(interaction.user.id)) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.danger).setDescription("❌  Admin only.")],
    });
    return;
  }

  const filter = interaction.options.getString("game") ?? "all";
  const { embed, totalPages, page } = buildPage(filter, 1);

  await interaction.editReply({
    embeds:     [embed],
    components: totalPages > 1 ? [pageRow(filter, page, totalPages)] : [],
  });
}

// ─── Button handler ───────────────────────────────────────────────────────────
export async function handlePage(bi: ButtonInteraction, filter: string, page: number): Promise<void> {
  if (!isAdmin(bi.user.id)) {
    await bi.reply({ content: "❌ Admin only.", flags: MessageFlags.Ephemeral });
    return;
  }

  await bi.deferUpdate();
  const { embed, totalPages, page: safePage } = buildPage(filter, page);

  await bi.editReply({
    embeds:     [embed],
    components: totalPages > 1 ? [pageRow(filter, safePage, totalPages)] : [],
  });
}
