import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { sqlite } from "@workspace/db";
import { COLORS, errorEmbed } from "../utils.js";
import { isAdmin } from "../botConfig.js";

interface InviteLogRow {
  id: number;
  inviter_id: string;
  invited_id: string;
  invite_code: string;
  verified: number;
  rewarded: number;
  left_server: number;
  joined_at: number;
  verified_at: number | null;
  account_created_at: number;
}

// ─── Command ─────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("invites")
  .setDescription("View your invite stats")
  .addUserOption((opt) =>
    opt
      .setName("user")
      .setDescription("(Admin only) View another member's invite stats")
      .setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const targetUser = interaction.options.getUser("user");

  // Only admins may look up other users
  if (targetUser && targetUser.id !== interaction.user.id) {
    if (!isAdmin(interaction.user.id)) {
      return interaction.editReply({
        embeds: [errorEmbed("Only admins can view another member's invite stats.")],
      });
    }
  }

  const userId      = targetUser?.id ?? interaction.user.id;
  const displayName = targetUser?.displayName ?? interaction.user.displayName;

  // ─── Queries ──────────────────────────────────────────────────────────────
  const verified = sqlite
    .prepare(
      `SELECT * FROM invite_log
       WHERE inviter_id = ? AND verified = 1
       ORDER BY verified_at DESC`,
    )
    .all(userId) as InviteLogRow[];

  const unverified = sqlite
    .prepare(
      `SELECT * FROM invite_log
       WHERE inviter_id = ? AND verified = 0 AND left_server = 0
       ORDER BY joined_at DESC`,
    )
    .all(userId) as InviteLogRow[];

  const left = sqlite
    .prepare(
      `SELECT * FROM invite_log
       WHERE inviter_id = ? AND left_server = 1
       ORDER BY joined_at DESC`,
    )
    .all(userId) as InviteLogRow[];

  // ─── Format member lists (max 15 shown, rest summarised) ─────────────────
  function fmtList(rows: InviteLogRow[]): string {
    if (rows.length === 0) return "`None`";
    const shown = rows.slice(0, 15).map((r) => `<@${r.invited_id}>`);
    const extra = rows.length - shown.length;
    return shown.join(", ") + (extra > 0 ? ` *(+${extra} more)*` : "");
  }

  // ─── Embed ────────────────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`📨  Invites — ${displayName}`)
    .addFields(
      {
        name: `✅  Verified Invites  \`${verified.length}\``,
        value: fmtList(verified),
        inline: false,
      },
      {
        name: `⏳  Unverified Invites  \`${unverified.length}\``,
        value: fmtList(unverified),
        inline: false,
      },
      {
        name: `👋  Left Invites  \`${left.length}\``,
        value: fmtList(left),
        inline: false,
      },
    )
    .setFooter({ text: `Total tracked invites: ${verified.length + unverified.length + left.length}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
