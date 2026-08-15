import {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
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
  { emoji: "🍒", label: "Cherries", weight: 40, color: COLORS.danger, triplePayout: 2 },
  { emoji: "🍋", label: "Lemons", weight: 27, color: COLORS.warning, triplePayout: 3 },
  { emoji: "🍉", label: "Watermelon", weight: 14, color: COLORS.success, triplePayout: 4 },
  { emoji: "🍇", label: "Grapes", weight: 9, color: 0x9b59b6, triplePayout: 5 },
  { emoji: "💎", label: "Diamond", weight: 6, color: COLORS.primary, triplePayout: 12 },
  { emoji: "⭐", label: "Star", weight: 3, color: COLORS.gold, triplePayout: 8 },
  { emoji: "7️⃣", label: "Lucky 7", weight: 1, color: COLORS.gold, triplePayout: 25 },
];

const SYMBOL_POOL = SLOT_SYMBOLS.flatMap((symbol) =>
  Array.from({ length: symbol.weight }, () => symbol),
);

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
  const symbols = [
    pickSymbol(),
    pickSymbol(),
    pickSymbol(),
  ] as [
    SlotSymbol,
    SlotSymbol,
    SlotSymbol,
  ];

  const [first, second, third] = symbols;

  if (
    first.emoji === second.emoji &&
    second.emoji === third.emoji
  ) {
    return {
      symbols,
      multiplier: first.triplePayout,
      kind: "triple",
    };
  }

  if (
    first.emoji === second.emoji ||
    first.emoji === third.emoji ||
    second.emoji === third.emoji
  ) {
    return {
      symbols,
      multiplier: 1.2,
      kind: "pair",
    };
  }

  return {
    symbols,
    multiplier: 0,
    kind: "loss",
  };
}

function reelPanel(
  symbols: SlotSymbol[],
  stopped: boolean[],
): string {
  const cells = symbols.map((symbol, index) =>
    stopped[index]
      ? `《 **${symbol.emoji}** 》`
      : `《 ${symbol.emoji} 》`,
  );

  return cells.join("  ·  ");
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

// ─── Components V2 helpers ───────────────────────────────────────────────────

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder();
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
  components?: ContainerBuilder[];
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
      if (attempt < maxAttempts - 1) {
        await sleep(400 * (attempt + 1));
      }
    }
  }

  return false;
}

// ─── Spinning panel ───────────────────────────────────────────────────────────

function spinningComponents(
  symbols: SlotSymbol[],
  stopped: boolean[],
  bet: number,
  title = "🎰  Slots — Spinning…",
): ContainerBuilder[] {
  const panel = new ContainerBuilder()
    .setAccentColor(COLORS.primary)

    .addTextDisplayComponents(
      text(`## ${title}`),
    )

    .addTextDisplayComponents(
      text(
        [
          reelPanel(symbols, stopped),
          "",
          `💎 **Bet**  \`${formatAmount(bet)}\``,
          "🎲 The reels are rolling…",
        ].join("\n"),
      ),
    );

  return [panel];
}

// ─── Result panel ─────────────────────────────────────────────────────────────

function resultComponents(
  userId: string,
  bet: number,
  result: SlotSpin,
  winnings: number,
): ContainerBuilder[] {
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

  const panel = new ContainerBuilder()
    .setAccentColor(embedColor)

    .addTextDisplayComponents(
      text(
        result.kind === "loss"
          ? "## 🎰  Slots — No Match"
          : "## 🎰  Slots — You Win!",
      ),
    )

    .addTextDisplayComponents(
      text(
        [
          reelPanel(
            result.symbols,
            [true, true, true],
          ),
          "",
          resultLine,
        ].join("\n"),
      ),
    )

    .addSeparatorComponents(
      separator(),
    )

    .addTextDisplayComponents(
      text(statsLines),
    )

    .addActionRowComponents(
      resultRow(userId, bet),
    );

  return [panel];
}

// ─── Core spin logic (shared by /slots and Play Again) ───────────────────────

async function runSpin(
  userId: string,
  bet: number,
  editFn: (data: SlotEditData) => Promise<unknown>,
): Promise<void> {
  const result = spinSlots();

  await addBalance(userId, -bet);

  const winnings = Math.floor(
    bet * result.multiplier,
  );

  if (winnings > 0) {
    await addBalance(
      userId,
      winnings,
    );
  }

  await recordBet(
    userId,
    bet,
    winnings - bet,
    "slots",
  );

  // Each reel settles in sequence, with the final frame showing the evaluated
  // result. This gives the panel a real slot-machine rhythm instead of a
  // single instant result.
  const frames = [
    {
      pause: 0,
      stopped: [false, false, false],
    },
    {
      pause: 560,
      stopped: [false, false, false],
    },
    {
      pause: 620,
      stopped: [false, false, false],
    },
    {
      pause: 700,
      stopped: [true, false, false],
    },
    {
      pause: 780,
      stopped: [true, true, false],
    },
    {
      pause: 900,
      stopped: [true, true, true],
    },
  ] as const;

  for (const frame of frames) {
    if (frame.pause > 0) {
      await sleep(frame.pause);
    }

    const visible =
      result.symbols.map(
        (symbol, index) =>
          frame.stopped[index]
            ? symbol
            : pickSymbol(),
      );

    await safeEdit(editFn, {
      content: "",
      components:
        spinningComponents(
          visible,
          [...frame.stopped],
          bet,
        ),
    });
  }

  await safeEdit(
    editFn,
    {
      content: "",
      components:
        resultComponents(
          userId,
          bet,
          result,
          winnings,
        ),
    },
    5,
  );
}

// ─── Command ──────────────────────────────────────────────────────────────────

export const data =
  new SlashCommandBuilder()
    .setName("slots")
    .setDescription(
      "Spin three slots reels",
    )
    .addStringOption(
      (opt) =>
        opt
          .setName("amount")
          .setDescription(
            "Bet amount (e.g. 1m, 2.5b)",
          )
          .setRequired(true),
    );

export async function execute(
  interaction: ChatInputCommandInteraction,
) {
  const amount =
    parseAmount(
      interaction.options.getString(
        "amount",
        true,
      ),
    );

  if (
    !amount ||
    amount < 1_000_000
  ) {
    return interaction.reply({
      embeds: [
        errorEmbed(
          "Minimum bet is **1m gems**. Try `1m`, `2.5b`, `500k`.",
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  const user =
    await getOrCreateUser(
      interaction.user.id,
      interaction.user.username,
    );

  if (
    user.balance <
    amount
  ) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`,
        ),
      ],
    });
  }

  return await runSpin(
    interaction.user.id,
    amount,
    (data) =>
      interaction.editReply({
        flags:
          MessageFlags.IsComponentsV2,
        components:
          data.components ?? [],
      }),
  );
}

// ─── Button: Play Again ───────────────────────────────────────────────────────

export async function handlePlayAgain(
  interaction: ButtonInteraction,
  userId: string,
  betStr: string,
): Promise<void> {
  if (
    interaction.user.id !==
    userId
  ) {
    return void interaction.reply({
      content:
        "❌ This isn't your game.",
      flags:
        MessageFlags.Ephemeral,
    });
  }

  const bet =
    parseInt(
      betStr,
      10,
    );

  if (
    !Number.isSafeInteger(
      bet,
    ) ||
    bet < 1
  ) {
    return void interaction.reply({
      content:
        "❌ Invalid bet.",
      flags:
        MessageFlags.Ephemeral,
    });
  }

  await interaction.deferUpdate();

  // Disable the old Play Again button while keeping the result panel intact.
  await interaction.editReply({
    flags:
      MessageFlags.IsComponentsV2,
    components: [
      resultComponents(
        userId,
        bet,
        {
          symbols: [
            {
              emoji: "❔",
              label: "",
              weight: 0,
              color: COLORS.primary,
              triplePayout: 0,
            },
            {
              emoji: "❔",
              label: "",
              weight: 0,
              color: COLORS.primary,
              triplePayout: 0,
            },
            {
              emoji: "❔",
              label: "",
              weight: 0,
              color: COLORS.primary,
              triplePayout: 0,
            },
          ],
          multiplier: 0,
          kind: "loss",
        },
        0,
      )[0],
    ],
  });

  // Rebuild the exact previous result panel, only replacing the Play Again
  // button with its disabled version.
  const originalContainer =
    interaction.message.components[0];

  const originalComponents =
    originalContainer
      ? (originalContainer as any)
      : null;

  if (originalComponents) {
    const container =
      new ContainerBuilder()
        .setAccentColor(
          COLORS.primary,
        );

    // Preserve the previous panel's content and only disable its Play Again
    // button. Components V2 component objects are reconstructed below.
    for (
      const component of
      interaction.message.components[0].components
    ) {
      if (
        component.type === 1
      ) {
        const row =
          new ActionRowBuilder<MessageActionRowComponentBuilder>();

        for (
          const button of
          component.components
        ) {
          const customId =
            "customId" in button
              ? button.customId
              : undefined;

          if (
            customId?.startsWith(
              `pa_slots_${userId}_`,
            )
          ) {
            row.addComponents(
              new ButtonBuilder()
                .setCustomId(
                  customId,
                )
                .setLabel(
                  "🔄  Play Again",
                )
                .setStyle(
                  ButtonStyle.Secondary,
                )
                .setDisabled(true),
            );
          } else if (
            customId
          ) {
            row.addComponents(
              new ButtonBuilder()
                .setCustomId(
                  customId,
                )
                .setLabel(
                  "📊  Payouts",
                )
                .setStyle(
                  ButtonStyle.Secondary,
                ),
            );
          }
        }

        container.addActionRowComponents(
          row,
        );
      } else if (
        component.type === 10
      ) {
        container.addTextDisplayComponents(
          text(
            component.content,
          ),
        );
      } else if (
        component.type === 14
      ) {
        container.addSeparatorComponents(
          separator(),
        );
      }
    }

    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,
      components: [container],
    });
  }

  const user =
    await getOrCreateUser(
      userId,
      interaction.user.username,
    );

  if (
    user.balance <
    bet
  ) {
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

  const spinMsg: Message =
    await interaction.followUp({
      flags:
        MessageFlags.IsComponentsV2,
      components:
        spinningComponents(
          [
            {
              emoji: "❔",
              label: "",
              weight: 0,
              color: COLORS.primary,
              triplePayout: 0,
            },
            {
              emoji: "❔",
              label: "",
              weight: 0,
              color: COLORS.primary,
              triplePayout: 0,
            },
            {
              emoji: "❔",
              label: "",
              weight: 0,
              color: COLORS.primary,
              triplePayout: 0,
            },
          ],
          [false, false, false],
          bet,
        ),
    });

  await runSpin(
    userId,
    bet,
    (data) =>
      spinMsg.edit({
        flags:
          MessageFlags.IsComponentsV2,
        components:
          data.components ?? [],
      }),
  );
}

// ─── Button: Payouts ─────────────────────────────────────────────────────────

export async function handlePayouts(
  interaction: ButtonInteraction,
  userId: string,
): Promise<void> {
  if (
    interaction.user.id !==
    userId
  ) {
    return void interaction.reply({
      content:
        "❌ This isn't your game.",
      flags:
        MessageFlags.Ephemeral,
    });
  }

  const panel =
    new ContainerBuilder()
      .setAccentColor(
        COLORS.primary,
      )
      .addTextDisplayComponents(
        text(
          "## 🎰  Slots — Payouts",
        ),
      )
      .addTextDisplayComponents(
        text(payoutTable()),
      )
      .addSeparatorComponents(
        separator(),
      )
      .addTextDisplayComponents(
        text(
          "Payouts include your original bet.",
        ),
      );

  await interaction.reply({
    flags:
      MessageFlags.IsComponentsV2 |
      MessageFlags.Ephemeral,
    components: [panel],
  });
}