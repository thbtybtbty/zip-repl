import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
} from "discord.js";
import { COLORS, errorEmbed } from "../utils.js";
import { isAdmin, saveServerConfig } from "../botConfig.js";

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("(Admin) Configure the deposit/withdraw system")
  .addChannelOption((opt) =>
    opt
      .setName("deposit_channel")
      .setDescription("Channel where deposit requests appear")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .addChannelOption((opt) =>
    opt
      .setName("withdraw_channel")
      .setDescription("Channel where withdraw requests appear")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .addChannelOption((opt) =>
    opt
      .setName("request_channel")
      .setDescription("Channel where Accept / Deny buttons appear for all requests")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("roblox_user")
      .setDescription("Roblox username players send Robux to when depositing")
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  if (!isAdmin(interaction.user.id)) {
    return interaction.editReply({
      embeds: [errorEmbed("You don't have permission to use this command.")],
    });
  }

  const depositCh  = interaction.options.getChannel("deposit_channel",  true);
  const withdrawCh = interaction.options.getChannel("withdraw_channel",  true);
  const requestCh  = interaction.options.getChannel("request_channel",   true);
  const robloxUser = interaction.options.getString("roblox_user",        true);

  saveServerConfig({
    depositChannelId:  depositCh.id,
    withdrawChannelId: withdrawCh.id,
    requestChannelId:  requestCh.id,
    robloxUser,
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle("✅  Setup Saved")
    .addFields(
      { name: "📥 Deposit Channel",  value: `<#${depositCh.id}>`,  inline: true },
      { name: "📤 Withdraw Channel", value: `<#${withdrawCh.id}>`, inline: true },
      { name: "📋 Request Channel",  value: `<#${requestCh.id}>`,  inline: true },
      { name: "🎮 Roblox User",      value: robloxUser,            inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
