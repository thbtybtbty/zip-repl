import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from "discord.js";
import { COLORS, parseAmount, formatAmount, errorEmbed } from "../utils.js";
import { isAdmin, getServerConfig } from "../botConfig.js";
import { sqlite } from "@workspace/db";

export const data = new SlashCommandBuilder()
  .setName("createcode")
  .setDescription("(Admin) Create a new promocode")
  .addStringOption((opt) =>
    opt.setName("code").setDescription("Code name (e.g. SUMMER2025)").setRequired(true),
  )
  .addStringOption((opt) =>
    opt.setName("reward").setDescription("Gem reward (e.g. 100m, 2.5b)").setRequired(true),
  )
  .addIntegerOption((opt) =>
    opt.setName("max_uses").setDescription("Maximum number of uses").setRequired(true).setMinValue(1),
  )
  .addStringOption((opt) =>
    opt.setName("wager_requirement").setDescription("Minimum wager required to redeem (e.g. 10m)").setRequired(false),
  )
  .addStringOption((opt) =>
    opt.setName("deposit_requirement").setDescription("Minimum deposit required to redeem (e.g. 50m)").setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!isAdmin(interaction.user.id)) {
    return void interaction.editReply({ embeds: [errorEmbed("You don't have permission to use this command.")] });
  }

  const code        = interaction.options.getString("code", true).toUpperCase().trim();
  const rewardStr   = interaction.options.getString("reward", true);
  const maxUses     = interaction.options.getInteger("max_uses", true);
  const wagerStr    = interaction.options.getString("wager_requirement", false);
  const depositStr  = interaction.options.getString("deposit_requirement", false);

  const reward = parseAmount(rewardStr);
  if (!reward || reward <= 0) {
    return void interaction.editReply({ embeds: [errorEmbed("Invalid reward amount. Try `100m`, `2.5b`.")] });
  }

  const wagerReq   = wagerStr   ? (parseAmount(wagerStr)   ?? 0) : 0;
  const depositReq = depositStr ? (parseAmount(depositStr) ?? 0) : 0;

  if (wagerStr && wagerReq <= 0) {
    return void interaction.editReply({ embeds: [errorEmbed("Invalid wager requirement. Try `10m`.")] });
  }
  if (depositStr && depositReq <= 0) {
    return void interaction.editReply({ embeds: [errorEmbed("Invalid deposit requirement. Try `50m`.")] });
  }

  // Check for duplicate
  const existing = sqlite.prepare("SELECT id FROM promocodes WHERE code = ?").get(code);
  if (existing) {
    return void interaction.editReply({ embeds: [errorEmbed(`Code \`${code}\` already exists.`)] });
  }

  // Insert
  sqlite.prepare(
    `INSERT INTO promocodes (code, reward, max_uses, wager_req, deposit_req) VALUES (?, ?, ?, ?, ?)`,
  ).run(code, reward, maxUses, wagerReq, depositReq);

  // Build the codes-channel embed
  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "🏷️ Code",     value: `\`${code}\``,       inline: true },
    { name: "💎 Reward",   value: formatAmount(reward), inline: true },
    { name: "🔢 Max Uses", value: `${maxUses}`,          inline: true },
  ];

  const hasRequirements = wagerReq > 0 || depositReq > 0;
  if (hasRequirements) {
    fields.push({ name: "\u200b", value: "**Requirements**", inline: false });
    if (wagerReq   > 0) fields.push({ name: "📈 Min Wager",   value: formatAmount(wagerReq),   inline: true });
    if (depositReq > 0) fields.push({ name: "📥 Min Deposit", value: formatAmount(depositReq), inline: true });
  }

  // Redeem instruction + value side by side on the bottom row
  fields.push(
    { name: "📋 How to Redeem", value: `\`/redeem code:${code}\``,         inline: true },
    { name: "💎 Value",         value: `**${formatAmount(reward)}** gems`,  inline: true },
  );

  const announceEmbed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🎉 New Promocode Available!")
    .addFields(fields)
    .setTimestamp();

  // Post to codes channel if configured
  const cfg = getServerConfig();
  if (cfg?.codesChannelId) {
    const ch = interaction.client.channels.cache.get(cfg.codesChannelId) as TextChannel | undefined;
    if (ch) await ch.send({ embeds: [announceEmbed] });
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle("✅ Promocode Created")
        .setDescription(`Code \`${code}\` created with reward **${formatAmount(reward)}** and **${maxUses}** max uses.`)
        .setTimestamp(),
    ],
  });
}
