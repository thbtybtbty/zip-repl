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
import { COLORS, formatAmount, errorEmbed } from "../utils.js";
import { isAdmin } from "../botConfig.js";
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

export const data = new SlashCommandBuilder()
  .setName("viewcodes")
  .setDescription("(Admin) View all active promocodes and manage them");

function buildCodesMessage(codes: PromoRow[]): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
} {
  if (codes.length === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.dark)
          .setTitle("🎫 Active Promocodes")
          .setDescription("No active promocodes at the moment.")
          .setTimestamp(),
      ],
      components: [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("vc_cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    };
  }

  const lines = codes.map((c) => {
    const usesLeft = c.max_uses - c.uses;
    const reqs: string[] = [];
    if (c.wager_req   > 0) reqs.push(`Wager: ${formatAmount(c.wager_req)}`);
    if (c.deposit_req > 0) reqs.push(`Deposit: ${formatAmount(c.deposit_req)}`);
    const reqStr = reqs.length > 0 ? ` | Req: ${reqs.join(", ")}` : "";
    return `🎫 \`${c.code}\`  💎 **${formatAmount(c.reward)}**  |  Uses left: **${usesLeft}/${c.max_uses}**${reqStr}`;
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🎫 Active Promocodes")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `${codes.length} active code${codes.length !== 1 ? "s" : ""}` })
    .setTimestamp();

  // Build button rows — max 4 Deactivate buttons per row, Cancel in last row
  // Limit to 20 codes (4 rows × 5) then Cancel fills the 5th row
  const buttonRows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  const chunks: PromoRow[][] = [];
  for (let i = 0; i < Math.min(codes.length, 20); i += 4) {
    chunks.push(codes.slice(i, i + 4));
  }

  for (const chunk of chunks) {
    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      ...chunk.map((c) =>
        new ButtonBuilder()
          .setCustomId(`vc_deactivate_${c.id}`)
          .setLabel(`Deactivate ${c.code}`)
          .setStyle(ButtonStyle.Danger),
      ),
    );
    buttonRows.push(row);
  }

  // Cancel row
  buttonRows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("vc_cancel")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components: buttonRows };
}

export const data_slash = data;

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isAdmin(interaction.user.id)) {
    return void interaction.editReply({ embeds: [errorEmbed("You don't have permission to use this command.")] });
  }

  const codes = sqlite
    .prepare("SELECT * FROM promocodes WHERE active = 1 ORDER BY created_at DESC")
    .all() as PromoRow[];

  const { embeds, components } = buildCodesMessage(codes);
  await interaction.editReply({ embeds, components });
}

// ─── Button: Deactivate ───────────────────────────────────────────────────────
export async function handleDeactivate(interaction: ButtonInteraction, codeId: string): Promise<void> {
  await interaction.deferUpdate();

  if (!isAdmin(interaction.user.id)) {
    return void interaction.followUp({ content: "❌ You don't have permission.", flags: MessageFlags.Ephemeral });
  }

  const id = parseInt(codeId, 10);
  const row = sqlite.prepare("SELECT code FROM promocodes WHERE id = ?").get(id) as { code: string } | undefined;

  if (!row) {
    return void interaction.followUp({ content: "❌ Code not found.", flags: MessageFlags.Ephemeral });
  }

  sqlite.prepare("UPDATE promocodes SET active = 0 WHERE id = ?").run(id);

  // Re-render with updated list
  const remaining = sqlite
    .prepare("SELECT * FROM promocodes WHERE active = 1 ORDER BY created_at DESC")
    .all() as PromoRow[];

  const { embeds, components } = buildCodesMessage(remaining);
  await interaction.editReply({ embeds, components });

  await interaction.followUp({
    content: `✅ Code \`${row.code}\` has been deactivated.`,
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Button: Cancel ───────────────────────────────────────────────────────────
export async function handleCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.dark)
        .setDescription("✖️ Closed.")
        .setTimestamp(),
    ],
    components: [],
  });
}
