import {
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type User,
} from "discord.js";
import { db, betLogTable, sqlite } from "@workspace/db";
import {
  addBalance,
  formatAmount,
  getOrCreateUser,
} from "../utils.js";

const RAKEBACK_RATE = 1;

function panel(user: User, amount: number): ContainerBuilder {
  const button = new ButtonBuilder()
    .setCustomId("rakeback_claim")
    .setLabel("Claim Rakeback")
    .setEmoji("💸")
    .setStyle(ButtonStyle.Success)
    .setDisabled(amount <= 0);

  return new ContainerBuilder()
    .setAccentColor(0xffd700)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `# 💸 ${user.username}'s Rakeback`,
        "",
        `📊 **Rakeback percentage**  \`${RAKEBACK_RATE}%\``,
        `💰 **Accrued rakeback**  \`${formatAmount(amount)}\``,
        "",
        amount > 0
          ? "Click the button below to claim your accrued rakeback."
          : "Please wager more in order to claim more rewards.",
      ].join("\n")),
    )
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button));
}

export const data = new SlashCommandBuilder()
  .setName("rakeback")
  .setDescription("View and claim your 1% rakeback");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  const row = sqlite
    .prepare("SELECT COALESCE(rakeback, 0) AS rakeback FROM users WHERE id = ?")
    .get(interaction.user.id) as { rakeback?: number } | undefined;
  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: [panel(interaction.user, Number(row?.rakeback ?? user.rakeback ?? 0))],
  });
}

export async function handleClaim(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  await getOrCreateUser(interaction.user.id, interaction.user.username);
  const row = sqlite
    .prepare("SELECT COALESCE(rakeback, 0) AS rakeback FROM users WHERE id = ?")
    .get(interaction.user.id) as { rakeback?: number } | undefined;
  const amount = Number(row?.rakeback ?? 0);
  if (amount <= 0) {
    await interaction.followUp({
      content: "Please wager more in order to claim more rewards.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  sqlite
    .prepare("UPDATE users SET rakeback = 0, updated_at = ? WHERE id = ?")
    .run(Math.floor(Date.now() / 1000), interaction.user.id);
  await addBalance(interaction.user.id, amount);
  await db.insert(betLogTable).values({
    userId: interaction.user.id,
    command: "rakeback-claim",
    bet: 0,
    netDelta: amount,
    adminBet: 0,
  });

  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: [panel(interaction.user, 0)],
  });
  await interaction.followUp({
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [
      new ContainerBuilder()
        .setAccentColor(0x57f287)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`✅ You successfully claimed **${formatAmount(amount)}** rakeback! 💸`),
        ),
    ],
  });
}