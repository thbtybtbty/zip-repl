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

// ─── Symbols and weighted reels ──────────────────────────────────────────────
export interface SlotSymbol {
  emoji: string;
  label: string;
  weight: number;
  color: number;
  triplePayout: number;
}

// 100 entries per reel. Common symbols are much more frequent, while rare
// symbols carry the largest prizes. With independent reels and the payout
// table below, the exact theoretical RTP is 84.4583% (15.5417% edge).
export const SLOT_SYMBOLS: SlotSymbol[] = [
  { emoji: "🍒", label: "Cherries", weight: 40, color: COLORS.danger,  triplePayout: 2  },
  { emoji: "🍋", label: "Lemons",   weight: 27, color: COLORS.warning, triplePayout: 3  },
  { emoji: "🍉", label: "Watermelon", weight: 14, color: COLORS.success, triplePayout: 4 },
  { emoji: "🍇", label: "Grapes",   weight:  9, color: 0x9b59b6,       triplePayout: 5  },
  { emoji: "💎", label: "Diamond",  weight:  6, color: COLORS.primary, triplePayout: 12 },
  { emoji: "⭐", label: "Star",     weight:  3, color: COLORS.gold,    triplePayout: 8  },
  { emoji: "7️⃣", label: "Lucky 7", weight:  1, color: COLORS.gold,    triplePayout: 25 },
];

const SYMBOL_POOL = SLOT_SYMBOLS.flatMap((symbol) =>
  Array.from({ length: symbol.weight }, () => symbol),
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pickSymbol(): SlotSymbol {
  return SYMBOL_POOL[Math.floor(Math.random() * SYMBOL_POOL.length)]!;
}

export interface SlotSpin {
  symbols: [SlotSymbol, SlotSymbol, SlotSymbol];
  multiplier: number;
  kind: "triple" | "pair" | "loss";
}

/** Roll all three independent reels and evaluate the requested payouts. */
export function spinSlots(): SlotSpin {
  const symbols = [pickSymbol(), pickSymbol(), pickSymbol()] as [
    SlotSymbol,
    SlotSymbol,
    SlotSymbol,
  ];
  const [first, second, third] = symbols;

  if (first.emoji === second.emoji && second.emoji === third.emoji) {
    return { symbols, multiplier: first.triplePayout, kind: "triple" };
  }

  if (
    first.emoji === second.emoji ||
    first.emoji === third.emoji ||
    second.emoji === third.emoji
  ) {
    return { symbols, multiplier: 1.2, kind: "pair" };
  }

  return { symbols, multiplier: 0, kind: "loss" };
}

function reelPanel(symbols: SlotSymbol[], stopped: boolean[]): string {
  const cells = symbols.map((symbol, index) =>
    stopped[index]
      ? `《 **${symbol.emoji}** 》`
      : `《 ${symbol.emoji} 》`,
  );
  return `${cells.join("  ·  ")}`;
}

function payoutTable(): string {
  return [
    "7️⃣ 7️⃣ 7️⃣ → **25x**",
    "💎 💎 💎 → **12x**",
    "⭐ ⭐ ⭐ → **8x**",
    "🍇 🍇 🍇 → **5x**",
    "🍉 🍉 🍉 → **4x**",
    "🍋 🍋 🍋 → **3x**",
    "🍒 🍒 🍒 → **2x**",
    "Any exact pair → **1.2x**",
  ].join("\n");
}

function resultRow(
  userId: string,
  bet: number,
  disabled = false,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pa_slots_${userId}_${bet}`)
      .setLabel("🔄  Play Again")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`slots_payouts_${userId}`)
      .setLabel("📊  Payouts")
      .setStyle(ButtonStyle.Secondary),
  );
}

type SlotEditData = {
  content: string;
  embeds: EmbedBuilder[];
  components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
};

// Discord can briefly reject rapid message edits with a rate-limit or
// transient server error. Animation frames are best-effort; skipping one is
// much better than aborting a paid spin. The final result gets its own retries.
async function safeEdit(
  editFn: (data: SlotEditData) => Promise<unknown>,
  data: SlotEditData,
  maxAttempts = 3,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await editFn(data);
      return true;
    } catch {
      if (attempt < maxAttempts - 1) await sleep(400 * (attempt + 1));
    }
  }
  return false;
}

// ─── Core spin logic (shared by /slots and Play Again) ───────────────────────
async function runSpin(
  userId: string,
  bet: number,
  editFn: (data: SlotEditData) => Promise<unknown>,
): Promise<void> {
  const result = spinSlots();
  await addBalance(userId, -bet);

  const winnings = Math.floor(bet * result.multiplier);
  if (winnings > 0) await addBalance(userId, winnings);
  await recordBet(userId, bet, winnings - bet, "slots");

  // Each reel settles in sequence, with the final frame showing the evaluated
  // result. This gives the panel a real slot-machine rhythm instead of a
  // single instant result.
  const frames = [
    { pause: 0,   stopped: [false, false, false] },
    { pause: 560, stopped: [false, false, false] },
    { pause: 620, stopped: [false, false, false] },
    { pause: 700, stopped: [true,  false, false] },
    { pause: 780, stopped: [true,  true,  false] },
    { pause: 900, stopped: [true,  true,  true] },
  ] as const;

  for (const frame of frames) {
    if (frame.pause > 0) await sleep(frame.pause);
    const visible = result.symbols.map((symbol, index) =>
      frame.stopped[index] ? symbol : pickSymbol(),
    );
    await safeEdit(editFn, {
      content: "",
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.primary)
          .setTitle("🎰  Slots — Spinning…")
          .setDescription(
            `${reelPanel(visible, [...frame.stopped])}\n\n` +
            `💎 **Bet**  \`${formatAmount(bet)}\`\n` +
            "🎲 The reels are rolling…",
          )
          .setTimestamp(),
      ],
    });
  }

  const net = winnings - bet;
  const resultLine =
    result.kind === "triple"
      ? `🎉 **${result.symbols[0].label} triple!**  +${formatAmount(net)} 💎`
      : result.kind === "pair"
        ? `✨ **Pair win!**  +${formatAmount(net)} 💎`
        : `💀 **No match.**  You lost **${formatAmount(bet)} 💎**`;

  const embedColor =
    result.kind === "loss"
      ? COLORS.danger
      : result.kind === "pair"
        ? COLORS.warning
        : result.symbols[0].color;

  const statsLines = [
    `🎯 **Result**     \`${result.symbols.map((symbol) => symbol.emoji).join("  ")}\``,
    `💎 **Bet**        \`${formatAmount(bet)}\``,
    `📊 **Multiplier**  \`${result.multiplier}x\``,
    `💰 **Payout**     \`${formatAmount(winnings)}\``,
  ].join("\n");

  await safeEdit(editFn, {
    content: "",
    embeds: [
      new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(
          result.kind === "loss"
            ? "🎰  Slots — No Match"
            : "🎰  Slots — You Win!",
        )
        .setDescription(
          `${reelPanel(result.symbols, [true, true, true])}\n\n` +
          `${resultLine}\n\n${statsLines}`,
        )
        .setTimestamp(),
    ],
    components: [resultRow(userId, bet)],
  }, 5);
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("slots")
  .setDescription("Spin three slots reels")
  .addStringOption((opt) =>
    opt
      .setName("amount")
      .setDescription("Bet amount (e.g. 1m, 2.5b)")
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const amount = parseAmount(interaction.options.getString("amount", true));
  if (!amount || amount < 1_000_000) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          "Minimum bet is **1m gems**. Try `1m`, `2.5b`, `500k`.",
        ),
      ],
    });
  }

  const user = await getOrCreateUser(
    interaction.user.id,
    interaction.user.username,
  );
  if (user.balance < amount) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`,
        ),
      ],
    });
  }

  return await runSpin(interaction.user.id, amount, (data) =>
    interaction.editReply(data),
  );
}

// ─── Button: Play Again ──────────────────────────────────────────────────────
export async function handlePlayAgain(
  interaction: ButtonInteraction,
  userId: string,
  betStr: string,
): Promise<void> {
  if (interaction.user.id !== userId) {
    return void interaction.reply({
      content: "❌ This isn't your game.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const bet = parseInt(betStr, 10);
  if (!Number.isSafeInteger(bet) || bet < 1) {
    return void interaction.reply({
      content: "❌ Invalid bet.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferUpdate();
  await interaction.editReply({
    components: [resultRow(userId, bet, true)],
  });

  const user = await getOrCreateUser(userId, interaction.user.username);
  if (user.balance < bet) {
    await interaction.followUp({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`,
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  const spinMsg: Message = await interaction.followUp({
    content: "",
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle("🎰  Slots — Spinning…")
        .setDescription("《 ❔ 》  ·  《 ❔ 》  ·  《 ❔ 》")
        .setTimestamp(),
    ],
  });

  await runSpin(userId, bet, (data) => spinMsg.edit(data));
}

// ─── Button: Payouts ─────────────────────────────────────────────────────────
export async function handlePayouts(
  interaction: ButtonInteraction,
  userId: string,
): Promise<void> {
  if (interaction.user.id !== userId) {
    return void interaction.reply({
      content: "❌ This isn't your game.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle("🎰  Slots — Payouts")
        .setDescription(payoutTable())
        .setFooter({ text: "Payouts include your original bet." })
        .setTimestamp(),
    ],
    ephemeral: true,
  });
}