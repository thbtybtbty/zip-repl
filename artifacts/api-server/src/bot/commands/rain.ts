import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type TextChannel,
  type Message,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import {
  COLORS,
  parseAmount,
  formatAmount,
  getOrCreateUser,
  addBalance,
  errorEmbed,
} from "../utils.js";
import { isAdmin } from "../botConfig.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const MIN_DURATION_MS = 5_000;                 // 5 seconds
const MAX_DURATION_MS = 3 * 24 * 3_600_000;   // 3 days
const MIN_RAIN        = 1_000_000;             // 1M

// ─── State ───────────────────────────────────────────────────────────────────
interface RainState {
  adminId:      string;
  total:        number;
  endsAt:       number;               // Unix ms
  participants: Set<string>;          // Discord user IDs who joined
  message:      Message;
  timer:        ReturnType<typeof setTimeout>;
}

// One rain per guild at a time
export const activeRains = new Map<string, RainState>();

// ─── Duration parser: 30s / 5m / 2h / 1d ────────────────────────────────────
export function parseDuration(raw: string): number | null {
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*([smhd])$/i);
  if (!match) return null;
  const n    = parseFloat(match[1]!);
  const unit = match[2]!.toLowerCase();
  if (!isFinite(n) || n <= 0) return null;
  if (unit === "s") return Math.floor(n * 1_000);
  if (unit === "m") return Math.floor(n * 60_000);
  if (unit === "h") return Math.floor(n * 3_600_000);
  if (unit === "d") return Math.floor(n * 86_400_000);
  return null;
}

// ─── Embed helpers ────────────────────────────────────────────────────────────
function activeEmbed(total: number, endsAt: number, participants: Set<string>): EmbedBuilder {
  const count    = participants.size;
  const each     = count > 0 ? Math.floor(total / count) : total;
  const endsAtSec = Math.floor(endsAt / 1_000);

  const lines = [
    `💎 **Total:** ${formatAmount(total)}`,
    `🍀 **Players:** ${count}`,
    `💰 **Each:** ${formatAmount(each)}`,
    `⏳ **Ends:** <t:${endsAtSec}:R>`,
  ];

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🌧️ Rain Active")
    .addFields({ name: "\u200b", value: lines.join("\n"), inline: false })
    .setTimestamp();
}

function joinRow(): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("rain_join")
      .setLabel("Join Rain")
      .setEmoji("🌧️")
      .setStyle(ButtonStyle.Primary),
  );
}

function endedEmbed(total: number, count: number, each: number): EmbedBuilder {
  const info = [
    `🍀 **Players:** ${count}`,
    `💰 **Each:** ${formatAmount(each)}`,
    `💎 **Total paid:** ${formatAmount(total)}`,
  ].join("\n");

  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle("Rain ended")
    .addFields(
      { name: "\u200b", value: info,                                                                                    inline: false },
      { name: "\u200b", value: `> ${count} players received **${formatAmount(each)}** gems each.`, inline: false },
    )
    .setTimestamp();
}

function noJoinersEmbed(total: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.dark)
    .setTitle("Rain ended")
    .addFields({ name: "\u200b", value: "> No one joined the rain. Gems returned to admin.", inline: false })
    .setTimestamp();
}

// ─── End rain (called by timer or manually) ───────────────────────────────────
export async function endRain(guildId: string): Promise<void> {
  const rain = activeRains.get(guildId);
  if (!rain) return;
  activeRains.delete(guildId);
  clearTimeout(rain.timer);

  const count = rain.participants.size;

  if (count === 0) {
    await addBalance(rain.adminId, rain.total);
    await rain.message.edit({ embeds: [noJoinersEmbed(rain.total)], components: [] }).catch(() => null);
    return;
  }

  const each      = Math.floor(rain.total / count);
  const remainder = rain.total - each * count;

  await Promise.all([
    ...[...rain.participants].map((uid) => addBalance(uid, each)),
    remainder > 0 ? addBalance(rain.adminId, remainder) : Promise.resolve(),
  ]);

  await rain.message
    .edit({ embeds: [endedEmbed(rain.total, count, each)], components: [] })
    .catch(() => null);
}

// ─── Command definition ───────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("rain")
  .setDescription("(Admin) Rain gems — everyone who joins splits the prize")
  .addStringOption((o) =>
    o.setName("gems").setDescription("Total gems to rain (e.g. 5b, 100m)").setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName("duration")
      .setDescription("How long the rain lasts (e.g. 30s, 5m, 2h, 1d)")
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!isAdmin(interaction.user.id)) {
    return void interaction.editReply({
      embeds: [errorEmbed("You don't have permission to use this command.")],
    });
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    return void interaction.editReply({ embeds: [errorEmbed("This command can only be used in a server.")] });
  }

  if (activeRains.has(guildId)) {
    return void interaction.editReply({
      embeds: [errorEmbed("There is already an active rain. Wait for it to end.")],
    });
  }

  const gemsStr    = interaction.options.getString("gems", true);
  const durStr     = interaction.options.getString("duration", true);

  const total = parseAmount(gemsStr);
  if (!total || total < MIN_RAIN) {
    return void interaction.editReply({ embeds: [errorEmbed("Invalid gem amount. Minimum is **1M**.")] });
  }

  const durationMs = parseDuration(durStr);
  if (!durationMs) {
    return void interaction.editReply({
      embeds: [errorEmbed("Invalid duration. Use `30s`, `5m`, `2h`, `1d`.")],
    });
  }
  if (durationMs < MIN_DURATION_MS) {
    return void interaction.editReply({ embeds: [errorEmbed("Minimum duration is **5 seconds**.")] });
  }
  if (durationMs > MAX_DURATION_MS) {
    return void interaction.editReply({ embeds: [errorEmbed("Maximum duration is **3 days**.")] });
  }

  const admin = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (admin.balance < total) {
    return void interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(admin.balance)}** gems.`)],
    });
  }

  await addBalance(interaction.user.id, -total);

  const endsAt  = Date.now() + durationMs;
  const channel = interaction.channel as TextChannel;

  const participants = new Set<string>();
  const msg = await channel.send({
    embeds:     [activeEmbed(total, endsAt, participants)],
    components: [joinRow()],
  });

  const timer = setTimeout(() => {
    endRain(guildId).catch(() => null);
  }, durationMs);

  activeRains.set(guildId, {
    adminId: interaction.user.id,
    total,
    endsAt,
    participants,
    message: msg,
    timer,
  });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setDescription(
          `✅ Rain started! **${formatAmount(total)}** gems will be shared among all who join. Ends <t:${Math.floor(endsAt / 1_000)}:R>.`,
        ),
    ],
  });
}

// ─── Button: Join Rain ────────────────────────────────────────────────────────
export async function handleJoin(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferUpdate();

  const guildId = interaction.guildId;
  const rain    = guildId ? activeRains.get(guildId) : null;

  if (!rain) {
    return void interaction.followUp({
      content: "❌ This rain has already ended.",
      ephemeral: true,
    });
  }

  if (rain.participants.has(interaction.user.id)) {
    return void interaction.followUp({
      content: "❌ You already joined this rain!",
      ephemeral: true,
    });
  }

  rain.participants.add(interaction.user.id);
  await getOrCreateUser(interaction.user.id, interaction.user.username);

  await interaction.editReply({
    embeds:     [activeEmbed(rain.total, rain.endsAt, rain.participants)],
    components: [joinRow()],
  }).catch(() => null);
}
