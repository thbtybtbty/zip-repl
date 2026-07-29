import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { COLORS, formatAmount, getOrCreateUser, addBalance, errorEmbed } from "../utils.js";
import { sqlite } from "@workspace/db";

interface PromoRow {
  id:          number;
  code:        string;
  reward:      number;
  max_uses:    number;
  uses:        number;
  wager_req:   number;
  deposit_req: number;
  active:      number;
}

interface UserRow {
  wagered:   number;
  deposited: number;
}

export const data = new SlashCommandBuilder()
  .setName("redeem")
  .setDescription("Redeem a promocode")
  .addStringOption((opt) =>
    opt.setName("code").setDescription("The promocode to redeem").setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const code = interaction.options.getString("code", true).toUpperCase().trim();

  // Fetch the code
  const promo = sqlite
    .prepare("SELECT * FROM promocodes WHERE code = ?")
    .get(code) as PromoRow | undefined;

  if (!promo) {
    return void interaction.editReply({ embeds: [errorEmbed(`Code \`${code}\` does not exist.`)] });
  }
  if (!promo.active) {
    return void interaction.editReply({ embeds: [errorEmbed(`Code \`${code}\` has been deactivated.`)] });
  }
  if (promo.uses >= promo.max_uses) {
    return void interaction.editReply({ embeds: [errorEmbed(`Code \`${code}\` has no uses left.`)] });
  }

  // Check if already redeemed
  const alreadyRedeemed = sqlite
    .prepare("SELECT id FROM promocode_redemptions WHERE code = ? AND user_id = ?")
    .get(code, interaction.user.id);
  if (alreadyRedeemed) {
    return void interaction.editReply({ embeds: [errorEmbed(`You have already redeemed code \`${code}\`.`)] });
  }

  // Check requirements
  const dbUser = await getOrCreateUser(interaction.user.id, interaction.user.username);
  const userStats = sqlite
    .prepare("SELECT wagered, deposited FROM users WHERE id = ?")
    .get(interaction.user.id) as UserRow | undefined;

  const wagered   = userStats?.wagered   ?? 0;
  const deposited = userStats?.deposited ?? 0;

  if (promo.wager_req > 0 && wagered < promo.wager_req) {
    return void interaction.editReply({
      embeds: [errorEmbed(
        `You need to wager at least **${formatAmount(promo.wager_req)} 💎** to redeem this code.\n` +
        `Your current wager: **${formatAmount(wagered)} 💎**`,
      )],
    });
  }
  if (promo.deposit_req > 0 && deposited < promo.deposit_req) {
    return void interaction.editReply({
      embeds: [errorEmbed(
        `You need to deposit at least **${formatAmount(promo.deposit_req)} 💎** to redeem this code.\n` +
        `Your current deposit: **${formatAmount(deposited)} 💎**`,
      )],
    });
  }

  // Redeem — atomic update
  sqlite.prepare("UPDATE promocodes SET uses = uses + 1 WHERE code = ?").run(code);
  sqlite.prepare("INSERT INTO promocode_redemptions (code, user_id) VALUES (?, ?)").run(code, interaction.user.id);
  await addBalance(interaction.user.id, promo.reward);

  const newBalance = (dbUser.balance + promo.reward);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle("🎉 Code Redeemed!")
        .setDescription(
          `You successfully redeemed \`${code}\` and received **${formatAmount(promo.reward)} 💎**!\n\n` +
          `💰 **New balance:** ${formatAmount(newBalance)} 💎`,
        )
        .setTimestamp(),
    ],
  });
}
