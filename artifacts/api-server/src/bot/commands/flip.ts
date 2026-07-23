import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
  type TextChannel,
} from "discord.js";
import {
  COLORS,
  parseAmount,
  formatAmount,
  getOrCreateUser,
  addBalance,
  recordBet,
  errorEmbed,
} from "../utils.js";
import { getServerConfig } from "../botConfig.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const PAYOUT_MULT = 1.9;  // winner gets 1.9× their bet (5% house edge on join, ~2.5% on bot call)
const WIN_CHANCE  = 0.475; // vs bot: 47.5% win chance so EV ≈ 0.475*1.9 - 1 = -0.0975 (9.75% edge)

// ─── Pending flip challenges ──────────────────────────────────────────────────
interface FlipChallenge {
  challengerId:   string;
  challengerName: string;
  bet:            number;
  channelMsgId:   string; // message ID in flip channel
  createdAt:      number;
}

const pendingFlips = new Map<string, FlipChallenge>(); // key = challengerId

// ─── Embed builders ───────────────────────────────────────────────────────────
function challengeEmbed(
  challengerName: string,
  bet:            number,
  status:         "open" | "expired",
): EmbedBuilder {
  const open = status === "open";
  return new EmbedBuilder()
    .setColor(open ? COLORS.gold : COLORS.dark)
    .setTitle("🪙  Flip Challenge")
    .setDescription(
      open
        ? `**${challengerName}** is challenging someone to a coin flip!\n\nWinner takes **${formatAmount(Math.floor(bet * PAYOUT_MULT))}** gems.\n\nClick **Join** to play them, or **Call Bot** to play against the house.`
        : `This challenge has expired.`,
    )
    .addFields(
      { name: "💎 Bet",     value: `\`${formatAmount(bet)}\``,                        inline: true },
      { name: "💰 Payout",  value: `\`${formatAmount(Math.floor(bet * PAYOUT_MULT))}\``, inline: true },
    )
    .setTimestamp();
}

function challengeRow(challengerId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`flip_join_${challengerId}`)
      .setLabel("Join")
      .setEmoji("🤝")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`flip_bot_${challengerId}`)
      .setLabel("Call Bot")
      .setEmoji("🤖")
      .setStyle(ButtonStyle.Secondary),
  );
}

function resultEmbed(
  title:       string,
  winner:      string,
  loser:       string,
  bet:         number,
  payout:      number,
  result:      string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(`🪙  ${title}`)
    .setDescription(`**${winner}** won the flip against **${loser}**!\n\n🎲 **Result:** ${result}`)
    .addFields(
      { name: "💎 Bet each",  value: `\`${formatAmount(bet)}\``,    inline: true },
      { name: "💰 Winner gets", value: `\`${formatAmount(payout)}\``, inline: true },
    )
    .setTimestamp();
}

// ─── Command definition ───────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("flip")
  .setDescription("Challenge another player to a coin flip — 1.9× payout to the winner!")
  .addStringOption((o) =>
    o.setName("amount").setDescription("Your bet (e.g. 1m, 2.5b, 500k)").setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const cfg = getServerConfig();
  if (!cfg || !cfg.flipChannelId) {
    return void interaction.editReply({
      embeds: [errorEmbed("Flip channel not configured. Ask an admin to run `/setup`.")],
    });
  }

  const amountStr = interaction.options.getString("amount", true);
  const amount    = parseAmount(amountStr);

  if (!amount || amount < 1_000_000) {
    return void interaction.editReply({ embeds: [errorEmbed("Minimum bet is **1M gems**.")] });
  }

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount) {
    return void interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
    });
  }

  // Check for existing open challenge
  if (pendingFlips.has(interaction.user.id)) {
    return void interaction.editReply({
      embeds: [errorEmbed("You already have an open flip challenge. Wait for it to be accepted or expire.")],
    });
  }

  // Deduct bet from challenger
  await addBalance(interaction.user.id, -amount);

  // Post to flip channel
  const guild   = interaction.guild!;
  const channel = await guild.channels.fetch(cfg.flipChannelId).catch(() => null) as TextChannel | null;
  if (!channel) {
    await addBalance(interaction.user.id, amount); // refund
    return void interaction.editReply({
      embeds: [errorEmbed("Flip channel not found. Ask an admin to re-run `/setup`.")],
    });
  }

  const msg = await channel.send({
    embeds:     [challengeEmbed(interaction.user.username, amount, "open")],
    components: [challengeRow(interaction.user.id)],
  });

  const challenge: FlipChallenge = {
    challengerId:   interaction.user.id,
    challengerName: interaction.user.username,
    bet:            amount,
    channelMsgId:   msg.id,
    createdAt:      Date.now(),
  };
  pendingFlips.set(interaction.user.id, challenge);

  // Auto-expire after 10 minutes
  setTimeout(async () => {
    const still = pendingFlips.get(interaction.user.id);
    if (still && still.channelMsgId === msg.id) {
      pendingFlips.delete(interaction.user.id);
      await addBalance(interaction.user.id, amount); // refund
      await msg.edit({ embeds: [challengeEmbed(interaction.user.username, amount, "expired")], components: [] }).catch(() => null);
    }
  }, 10 * 60 * 1000);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setDescription(`✅ Flip challenge posted in <#${cfg.flipChannelId}>!`),
    ],
  });
}

// ─── Button: Join (player vs player) ─────────────────────────────────────────
export async function handleJoin(interaction: ButtonInteraction, challengerId: string): Promise<void> {
  await interaction.deferUpdate();

  if (interaction.user.id === challengerId) {
    return void interaction.followUp({ content: "❌ You can't join your own flip!", ephemeral: true });
  }

  const challenge = pendingFlips.get(challengerId);
  if (!challenge) {
    return void interaction.editReply({ embeds: [challengeEmbed("?", 0, "expired")], components: [] });
  }

  const joiner = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (joiner.balance < challenge.bet) {
    return void interaction.followUp({
      content: `❌ Insufficient balance. You need **${formatAmount(challenge.bet)} 💎** to join.`,
      ephemeral: true,
    });
  }

  // Deduct joiner's bet
  await addBalance(interaction.user.id, -challenge.bet);

  // Flip
  const challengerWins = Math.random() < 0.5;
  const winnerId   = challengerWins ? challengerId : interaction.user.id;
  const loserId    = challengerWins ? interaction.user.id : challengerId;
  const winnerName = challengerWins ? challenge.challengerName : interaction.user.username;
  const loserName  = challengerWins ? interaction.user.username : challenge.challengerName;
  const payout     = Math.floor(challenge.bet * PAYOUT_MULT * 2); // 2 bets in the pot, winner gets 1.9× their bet from total
  const winnerPayout = Math.floor(challenge.bet * PAYOUT_MULT + challenge.bet); // their stake back + 0.9× opponent's bet
  // Simpler: winner gets (bet * 2 * 0.95) — total pot with 5% house cut
  const totalPot = challenge.bet * 2;
  const winnerGets = Math.floor(totalPot * 0.95);

  await addBalance(winnerId, winnerGets);
  await recordBet(challengerId,       challenge.bet, challengerWins ? winnerGets - challenge.bet : -challenge.bet);
  await recordBet(interaction.user.id, challenge.bet, challengerWins ? -challenge.bet : winnerGets - challenge.bet);

  pendingFlips.delete(challengerId);

  await interaction.editReply({
    embeds:     [resultEmbed("Flip Result", winnerName, loserName, challenge.bet, winnerGets, "🪙 Heads")],
    components: [],
  });
}

// ─── Button: Call Bot ─────────────────────────────────────────────────────────
export async function handleCallBot(interaction: ButtonInteraction, challengerId: string): Promise<void> {
  await interaction.deferUpdate();

  const challenge = pendingFlips.get(challengerId);
  if (!challenge) {
    return void interaction.editReply({ embeds: [challengeEmbed("?", 0, "expired")], components: [] });
  }

  // Only the challenger can call bot
  if (interaction.user.id !== challengerId) {
    return void interaction.followUp({ content: "❌ Only the challenger can call the bot.", ephemeral: true });
  }

  // Flip vs bot
  const won    = Math.random() < WIN_CHANCE;
  const payout = won ? Math.floor(challenge.bet * PAYOUT_MULT) : 0;

  if (won) await addBalance(challengerId, payout + challenge.bet); // return stake + winnings
  // If lost, bet was already deducted at challenge creation
  await recordBet(challengerId, challenge.bet, won ? payout : -challenge.bet);

  pendingFlips.delete(challengerId);

  const embed = new EmbedBuilder()
    .setColor(won ? COLORS.success : COLORS.danger)
    .setTitle(`🪙  Flip vs Bot — ${won ? "YOU WON! 🎉" : "You Lost"}`)
    .addFields(
      { name: "💎 Bet",     value: `\`${formatAmount(challenge.bet)}\``,                              inline: true },
      { name: "💰 Payout",  value: `\`${won ? formatAmount(payout + challenge.bet) : "0"}\``,         inline: true },
      { name: "📈 Profit",  value: `\`${won ? `+${formatAmount(payout)}` : `-${formatAmount(challenge.bet)}`}\``, inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed], components: [] });
}
