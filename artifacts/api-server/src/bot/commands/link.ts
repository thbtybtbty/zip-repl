import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { COLORS, errorEmbed, getOrCreateUser } from "../utils.js";
import {
  createVerificationPhrase,
  findRobloxUser,
  getRobloxProfile,
  RobloxApiError,
} from "../roblox.js";

export const LINK_EXPIRY_MS = 15 * 60 * 1_000;

export const data = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Verify and link your Roblox account")
  .addStringOption((opt) =>
    opt
      .setName("roblox_username")
      .setDescription("Your exact Roblox username")
      .setRequired(true),
  );

function isValidRobloxUsername(username: string): boolean {
  return /^[A-Za-z0-9_]{3,20}$/.test(username);
}

function linkButtons(userId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`roblox_phrase_${userId}`)
      .setLabel("Show Phrase")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`roblox_verify_${userId}`)
      .setLabel("Verify Roblox")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
  );
}

function linkEmbed(
  username: string,
  phrase: string,
  expiresAt: number,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🔗 Roblox Account Linking")
    .setDescription(
      [
        `**Roblox Username:** \`${username}\``,
        "",
        "**Verification Phrase**",
        `\`\`\`\n${phrase}\n\`\`\``,
        "Copy the phrase above and paste it exactly into your Roblox profile bio/description.",
        "",
        "When it is saved publicly, click **Verify Roblox**. The bot only checks your public Roblox profile; never share a password, cookie, or login information.",
        "",
        `⏱️ This phrase expires <t:${Math.floor(expiresAt / 1_000)}:R>.`,
      ].join("\n"),
    )
    .setFooter({ text: "You can start a new verification attempt if this phrase expires." })
    .setTimestamp();
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const robloxUsername = interaction.options.getString("roblox_username", true).trim();
  if (!isValidRobloxUsername(robloxUsername)) {
    return interaction.editReply({
      embeds: [errorEmbed("Invalid Roblox username. Use 3–20 letters, numbers, or underscores.")],
    });
  }

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.robloxUsername || user.robloxUserId) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          `Your Discord account is already linked to **${user.robloxUsername ?? "a Roblox account"}**. Ask an admin to use \`/change link\` if it needs to be changed.`,
        ),
      ],
    });
  }

  const phrase = createVerificationPhrase();
  const expiresAt = Date.now() + LINK_EXPIRY_MS;

  await db
    .update(usersTable)
    .set({
      robloxPendingUsername: robloxUsername,
      robloxVerificationPhrase: phrase,
      robloxVerificationExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, interaction.user.id));

  return interaction.editReply({
    embeds: [linkEmbed(robloxUsername, phrase, expiresAt)],
    components: [linkButtons(interaction.user.id)],
  });
}

async function getPendingLink(userId: string) {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const user = rows[0];
  if (
    !user ||
    !user.robloxPendingUsername ||
    !user.robloxVerificationPhrase ||
    !user.robloxVerificationExpiresAt
  ) {
    return null;
  }
  if (user.robloxVerificationExpiresAt <= Date.now()) {
    await db
      .update(usersTable)
      .set({
        robloxPendingUsername: null,
        robloxVerificationPhrase: null,
        robloxVerificationExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId));
    return null;
  }
  return user;
}

export async function handlePhrase(
  interaction: ButtonInteraction,
  userId: string,
): Promise<void> {
  if (interaction.user.id !== userId) {
    await interaction.reply({ content: "❌ This verification panel belongs to another Discord user.", flags: MessageFlags.Ephemeral });
    return;
  }

  const pending = await getPendingLink(userId);
  if (!pending) {
    await interaction.reply({
      embeds: [errorEmbed("This verification phrase has expired. Run `/link` to create a new one.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `Your Roblox verification phrase is:\n\`\`\`\n${pending.robloxVerificationPhrase}\n\`\`\`\nPaste this exact phrase into your Roblox profile bio.`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleVerify(
  interaction: ButtonInteraction,
  userId: string,
): Promise<void> {
  if (interaction.user.id !== userId) {
    await interaction.reply({ content: "❌ This verification panel belongs to another Discord user.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const pending = await getPendingLink(userId);
  if (!pending) {
    await interaction.editReply({
      embeds: [errorEmbed("This verification phrase has expired. Run `/link` to create a new one.")],
    });
    return;
  }

  try {
    const robloxUser = await findRobloxUser(pending.robloxPendingUsername);
    if (!robloxUser) {
      await interaction.editReply({
        embeds: [errorEmbed(`Roblox could not find **${pending.robloxPendingUsername}**. Check the spelling and try again.`)],
      });
      return;
    }

    const alreadyLinked = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.robloxUserId, robloxUser.id))
      .limit(1);
    if (alreadyLinked[0] && alreadyLinked[0].id !== userId) {
      await interaction.editReply({
        embeds: [errorEmbed("That Roblox account is already linked to another Discord account.")],
      });
      return;
    }

    const profile = await getRobloxProfile(robloxUser.id);
    if (!profile.description.includes(pending.robloxVerificationPhrase)) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            `The phrase was not found in **${profile.name}**'s public profile description.\n\nMake sure you pasted the exact phrase into your Roblox bio and saved it publicly, then try again.`,
          ),
        ],
      });
      return;
    }

    await db
      .update(usersTable)
      .set({
        robloxUsername: profile.name,
        robloxUserId: profile.id,
        robloxPendingUsername: null,
        robloxVerificationPhrase: null,
        robloxVerificationExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId));

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.success)
          .setTitle("✅ Roblox Account Linked")
          .setDescription(
            `Successfully linked **${profile.name}** to your Discord account.\n\nYour Roblox User ID has been saved as the permanent account identifier.`,
          )
          .setTimestamp(),
      ],
      components: [],
    });
  } catch (error) {
    const message = error instanceof RobloxApiError
      ? error.message
      : "The Roblox account could not be verified right now. Please try again shortly.";
    await interaction.editReply({ embeds: [errorEmbed(message)] });
  }
}