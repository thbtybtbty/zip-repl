import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
  type Message,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
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

// ─── Segments ─────────────────────────────────────────────────────────────────
interface Segment { emoji: string; label: string; mult: number; weight: number; color: number }

// Weights tuned for a 7.5% house edge:
// Σ(weight × mult) / Σ(weight) = 80.5 / 87 ≈ 0.9253 → RTP 92.53%
const SEGMENTS: Segment[] = [
  { emoji: "💀", label: "0x",   mult: 0,   weight: 40, color: COLORS.dark    },
  { emoji: "🔴", label: "0.5×", mult: 0.5, weight: 26, color: COLORS.danger  },
  { emoji: "🟡", label: "1×",   mult: 1,   weight:  8, color: COLORS.warning },
  { emoji: "🟢", label: "1.5×", mult: 1.5, weight:  5, color: COLORS.success },
  { emoji: "🔵", label: "2×",   mult: 2,   weight:  3, color: COLORS.primary },
  { emoji: "🟣", label: "3×",   mult: 3,   weight:  2, color: 0x9b59b6       },
  { emoji: "🟠", label: "5×",   mult: 5,   weight:  1, color: 0xe67e22       },
  { emoji: "💛", label: "10×",  mult: 10,  weight:  1, color: COLORS.gold    },
  { emoji: "💎", label: "25×",  mult: 25,  weight:  1, color: COLORS.gold    },
];

// Build a randomized weighted pool without allowing five low multipliers
// (0x/0.5x) to appear in a row. The counts stay exactly the same, so the
// outcome odds and house edge are unchanged; only the visual order changes.
// Low segments are distributed into randomized gaps of 3 or 4 between the
// higher multipliers, so good results appear nearby without a fixed pattern.
function buildPool(): Segment[] {
  const shuffle = <T,>(items: T[]): T[] => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  };

  const low: Segment[] = [];
  const high: Segment[] = [];
  for (const segment of SEGMENTS) {
    for (let i = 0; i < segment.weight; i++) {
      (segment.mult < 1 ? low : high).push(segment);
    }
  }

  // There are 66 low and 21 higher-multiplier segments. Distributing the low
  // segments as eighteen gaps of 3 and three gaps of 4 guarantees that every
  // five-segment strip contains at least one multiplier above 0.5x.
  const gaps = shuffle([...Array(18).fill(3), 4, 4, 4]);
  shuffle(low);
  shuffle(high);

  const pool: Segment[] = [];
  let lowIndex = 0;
  for (let i = 0; i < high.length; i++) {
    pool.push(high[i]!);
    for (let j = 0; j < gaps[i]!; j++) {
      pool.push(low[lowIndex++]!);
    }
  }

  return pool;
}

const POOL = buildPool();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Pick a result from the weighted pool ─────────────────────────────────────
function pickResult(): { result: Segment; poolIdx: number } {
  const poolIdx = Math.floor(Math.random() * POOL.length);
  return { result: POOL[poolIdx]!, poolIdx };
}

// ─── Strip builder ────────────────────────────────────────────────────────────
function buildStrip(centreIdx: number, highlight: boolean): string {
  return Array.from({ length: 5 }, (_, i) => {
    const seg   = POOL[(centreIdx - 2 + i + POOL.length * 10) % POOL.length]!;
    const label = `${seg.emoji} ${seg.label}`;
    if (i === 2) return highlight ? `《 **${label}** 》` : `《 ${label} 》`;
    return label;
  }).join("  ·  ");
}

// ─── Animation constants ──────────────────────────────────────────────────────
const OFFSETS = [36, 28, 21, 15, 10, 6, 3, 1, 0] as const;
const DELAYS  = [140, 160, 200, 260, 320, 390, 460, 530, 650] as const;

// ─── Play Again button ────────────────────────────────────────────────────────
function playAgainRow(userId: string, bet: number, disabled = false): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pa_wheel_${userId}_${bet}`)
      .setLabel("🔄  Play Again")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

// ─── Core spin logic (shared by /wheel and Play Again) ────────────────────────
// editFn updates the message for each animation frame and the final result.
async function runSpin(
  userId: string,
  username: string,
  bet: number,
  editFn: (data: { content: string; embeds: EmbedBuilder[]; components?: ActionRowBuilder<MessageActionRowComponentBuilder>[] }) => Promise<unknown>,
): Promise<void> {
  const { result, poolIdx } = pickResult();
  await addBalance(userId, -bet);
  const winnings = Math.floor(bet * result.mult);
  if (winnings > 0) await addBalance(userId, winnings);
  await recordBet(userId, bet, winnings - bet, "wheel");

  // Animation frames
  for (let f = 0; f < OFFSETS.length; f++) {
    const centre = (poolIdx - OFFSETS[f]! + POOL.length * 10) % POOL.length;
    const isLast = OFFSETS[f] === 0;
    await editFn({
      content: "",
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.primary)
          .setTitle("🎡  Wheel of Fortune — Spinning…")
          .setDescription(buildStrip(centre, isLast))
          .setTimestamp(),
      ],
    });
    await sleep(DELAYS[f]!);
  }

  // Result embed
  const net = winnings - bet;
  let outcomeText: string;
  if (result.mult === 0) {
    outcomeText = `💀 **0x!** You lost **${formatAmount(bet)} 💎**`;
  } else if (result.mult === 1) {
    outcomeText = `😐 Break even — you get your bet back.`;
  } else if (net > 0) {
    outcomeText = `🎉 **${result.label} win!**  +${formatAmount(net)} 💎`;
  } else {
    outcomeText = `📉 **${result.label}** — you get **${formatAmount(winnings)} 💎** back.`;
  }

  const embedColor =
    result.mult === 0 ? COLORS.danger :
    result.mult <  1 ? COLORS.warning :
    result.color;

  const statsLines = [
    `💎 **Bet**        \`${formatAmount(bet)}\``,
    `🎯 **Multiplier** \`${result.label}\``,
    `💰 **Payout**     \`${formatAmount(winnings)}\``,
  ].join("\n");

  await editFn({
    content: "",
    embeds: [
      new EmbedBuilder()
        .setColor(embedColor)
        .setTitle("🎡  Wheel of Fortune")
        .setDescription(`${buildStrip(poolIdx, true)}\n\n${outcomeText}\n\n${statsLines}`)
        .setTimestamp(),
    ],
    components: [playAgainRow(userId, bet)],
  });
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("wheel")
  .setDescription("Spin the Wheel of Fortune")
  .addStringOption((opt) =>
    opt.setName("amount").setDescription("Bet amount (e.g. 1m, 2.5b)").setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const amountStr = interaction.options.getString("amount", true);
  const amount    = parseAmount(amountStr);

  if (!amount || amount < 1_000_000)
    return interaction.reply({
      embeds: [errorEmbed("Minimum bet is **1m gems**. Try `1m`, `2.5b`, `500k`.")],
      flags: MessageFlags.Ephemeral,
    });

  await interaction.deferReply();

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount)
    return interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
    });

  await runSpin(
    interaction.user.id,
    interaction.user.username,
    amount,
    (data) => interaction.editReply(data),
  );
}

// ─── Button: Play Again ───────────────────────────────────────────────────────
export async function handlePlayAgain(interaction: ButtonInteraction, userId: string, betStr: string): Promise<void> {
  if (interaction.user.id !== userId) {
    return void interaction.reply({ content: "❌ This isn't your game.", flags: MessageFlags.Ephemeral });
  }

  const bet = parseInt(betStr, 10);

  // Disable the button on the old result message immediately
  await interaction.deferUpdate();
  await interaction.editReply({ components: [playAgainRow(userId, bet, true)] });

  const user = await getOrCreateUser(userId, interaction.user.username);
  if (user.balance < bet) {
    await interaction.followUp({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
      ephemeral: true,
    });
    return;
  }

  // Create the new game message via followUp, then animate into it
  const spinMsg: Message = await interaction.followUp({
    content: "",
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle("🎡  Wheel of Fortune — Spinning…")
        .setDescription("…")
        .setTimestamp(),
    ],
  });

  await runSpin(userId, interaction.user.username, bet, (data) => spinMsg.edit(data));
}
