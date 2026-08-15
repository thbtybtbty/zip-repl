import {
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
  type Message,
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
interface Segment {
  emoji: string;
  label: string;
  mult: number;
  weight: number;
  color: number;
}

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

// ─── Pool ─────────────────────────────────────────────────────────────────────
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

  const gaps = shuffle([
    ...Array(18).fill(3),
    4,
    4,
    4,
  ]);

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

const sleep = (ms: number) =>
  new Promise((r) => setTimeout(r, ms));

// ─── Pick result ──────────────────────────────────────────────────────────────
function pickResult(): {
  result: Segment;
  poolIdx: number;
} {
  const poolIdx = Math.floor(Math.random() * POOL.length);

  return {
    result: POOL[poolIdx]!,
    poolIdx,
  };
}

// ─── Strip ────────────────────────────────────────────────────────────────────
function buildStrip(
  centreIdx: number,
  highlight: boolean,
): string {
  return Array.from({ length: 5 }, (_, i) => {
    const seg =
      POOL[
        (centreIdx - 2 + i + POOL.length * 10) %
          POOL.length
      ]!;

    const label = `${seg.emoji} ${seg.label}`;

    if (i === 2) {
      return highlight
        ? `《 **${label}** 》`
        : `《 ${label} 》`;
    }

    return label;
  }).join("  ·  ");
}

// ─── Animation ────────────────────────────────────────────────────────────────
const OFFSETS = [
  36,
  28,
  21,
  15,
  10,
  6,
  3,
  1,
  0,
] as const;

const DELAYS = [
  140,
  160,
  200,
  260,
  320,
  390,
  460,
  530,
  650,
] as const;

// ─── Components V2 helpers ───────────────────────────────────────────────────
function wheelSeparator(): SeparatorBuilder {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);
}

function wheelText(
  text: string,
): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(text);
}

function playAgainButton(
  userId: string,
  bet: number,
  disabled = false,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`pa_wheel_${userId}_${bet}`)
    .setLabel("Play Again")
    .setEmoji("🔄")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);
}

// ─── Spinning panel ───────────────────────────────────────────────────────────
function buildSpinningPanel(
  centre: number,
  highlight: boolean,
): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(COLORS.primary)

    .addTextDisplayComponents(
      wheelText("## 🎡  Wheel of Fortune"),
    )

    .addSeparatorComponents(
      wheelSeparator(),
    )

    .addTextDisplayComponents(
      wheelText(
        buildStrip(centre, highlight),
      ),
    )

    .addSeparatorComponents(
      wheelSeparator(),
    )

    .addTextDisplayComponents(
      wheelText("🕐 **Spinning the wheel…**"),
    );
}

// ─── Result panel ─────────────────────────────────────────────────────────────
function buildResultPanel(
  userId: string,
  bet: number,
  result: Segment,
  poolIdx: number,
  outcomeText: string,
  winnings: number,
  embedColor: number,
  playAgainDisabled = false,
): ContainerBuilder {
  const panel = new ContainerBuilder()
    .setAccentColor(embedColor)

    // Title
    .addTextDisplayComponents(
      wheelText("## 🎡  Wheel of Fortune"),
    );

  // Bet + payout are intentionally together with NO blank line.
  if (result.mult > 0) {
    panel.addTextDisplayComponents(
      wheelText(
        `💎 **Bet**  \`${formatAmount(bet)}\`\n` +
        `💰 **Payout**  \`${formatAmount(winnings)}\``,
      ),
    );
  } else {
    // No payout line when losing.
    panel.addTextDisplayComponents(
      wheelText(
        `💎 **Bet**  \`${formatAmount(bet)}\``,
      ),
    );
  }

  // Divider between stats and wheel/result.
  panel.addSeparatorComponents(
    wheelSeparator(),
  );

  // Wheel result
  panel.addTextDisplayComponents(
    wheelText(
      buildStrip(poolIdx, true),
    ),
  );

  // Outcome
  panel.addTextDisplayComponents(
    wheelText(outcomeText),
  );

  // Multiplier
  panel.addTextDisplayComponents(
    wheelText(
      `🎯 **Multiplier**  \`${result.label}\``,
    ),
  );

  // Divider before Play Again.
  panel.addSeparatorComponents(
    wheelSeparator(),
  );

  // Play Again inside the panel.
  panel.addActionRowComponents(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      playAgainButton(
        userId,
        bet,
        playAgainDisabled,
      ),
    ),
  );

  return panel;
}

// ─── Core spin logic ──────────────────────────────────────────────────────────
async function runSpin(
  userId: string,
  username: string,
  bet: number,
  editFn: (data: {
    content?: string;
    components: ContainerBuilder[];
    flags?: MessageFlags;
  }) => Promise<unknown>,
): Promise<void> {
  const {
    result,
    poolIdx,
  } = pickResult();

  await addBalance(
    userId,
    -bet,
  );

  const winnings = Math.floor(
    bet * result.mult,
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
    "wheel",
  );

  // ─── Animation ─────────────────────────────────────────────────────────────
  for (
    let f = 0;
    f < OFFSETS.length;
    f++
  ) {
    const centre =
      (
        poolIdx -
        OFFSETS[f]! +
        POOL.length * 10
      ) %
      POOL.length;

    const isLast =
      OFFSETS[f] === 0;

    await editFn({
      content: "",
      components: [
        buildSpinningPanel(
          centre,
          isLast,
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    });

    await sleep(
      DELAYS[f]!,
    );
  }

  // ─── Result ────────────────────────────────────────────────────────────────
  const net =
    winnings - bet;

  let outcomeText: string;

  if (result.mult === 0) {
    outcomeText =
      `💀 **0x!** You lost **${formatAmount(bet)} 💎**`;
  } else if (result.mult === 1) {
    outcomeText =
      `😐 Break even — you get your bet back.`;
  } else if (net > 0) {
    outcomeText =
      `🎉 **${result.label} win!**  +${formatAmount(net)} 💎`;
  } else {
    outcomeText =
      `📉 **${result.label}** — you get **${formatAmount(winnings)} 💎** back.`;
  }

  const embedColor =
    result.mult === 0
      ? COLORS.danger
      : result.mult < 1
        ? COLORS.warning
        : result.color;

  await editFn({
    content: "",
    components: [
      buildResultPanel(
        userId,
        bet,
        result,
        poolIdx,
        outcomeText,
        winnings,
        embedColor,
        false,
      ),
    ],
    flags: MessageFlags.IsComponentsV2,
  });
}

// ─── Command ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("wheel")
  .setDescription("Spin the Wheel of Fortune")
  .addStringOption((opt) =>
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
  const amountStr =
    interaction.options.getString(
      "amount",
      true,
    );

  const amount =
    parseAmount(amountStr);

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
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  const user =
    await getOrCreateUser(
      interaction.user.id,
      interaction.user.username,
    );

  if (
    user.balance < amount
  ) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`,
        ),
      ],
    });
  }

  await runSpin(
    interaction.user.id,
    interaction.user.username,
    amount,
    (data) =>
      interaction.editReply(data),
  );
}

// ─── Disable Play Again on old panel ──────────────────────────────────────────
function disablePlayAgainComponents(
  components: readonly any[],
): any[] {
  return components.map(
    (component) => {
      const json =
        typeof component.toJSON === "function"
          ? component.toJSON()
          : component;

      const clone =
        JSON.parse(
          JSON.stringify(json),
        );

      const disableButtons = (
        node: any,
      ): void => {
        if (!node) return;

        if (
          node.type === 2 &&
          typeof node.custom_id === "string" &&
          node.custom_id.startsWith(
            "pa_wheel_",
          )
        ) {
          node.disabled = true;
        }

        if (
          Array.isArray(
            node.components,
          )
        ) {
          for (
            const child of node.components
          ) {
            disableButtons(child);
          }
        }
      };

      disableButtons(clone);

      return clone;
    },
  );
}

// ─── Button: Play Again ───────────────────────────────────────────────────────
export async function handlePlayAgain(
  interaction: ButtonInteraction,
  userId: string,
  betStr: string,
): Promise<void> {
  if (
    interaction.user.id !== userId
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

  // Immediately visually disable the
  // Play Again button on the OLD panel.
  await interaction.deferUpdate();

  try {
    const disabledComponents =
      disablePlayAgainComponents(
        interaction.message.components,
      );

    await interaction.editReply({
      components:
        disabledComponents,
      });
  } catch {
    // The new spin can still proceed
    // if Discord rejects the reconstructed
    // old components.
  }

  const user =
    await getOrCreateUser(
      userId,
      interaction.user.username,
    );

  if (
    user.balance < bet
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

  // New game is a NEW message.
  // The previous game remains visible.
  const spinMsg: Message =
    await interaction.followUp({
      content: "",
      components: [
        new ContainerBuilder()
          .setAccentColor(
            COLORS.primary,
          )
          .addTextDisplayComponents(
            wheelText(
              "## 🎡  Wheel of Fortune",
            ),
          )
          .addSeparatorComponents(
            wheelSeparator(),
          )
          .addTextDisplayComponents(
            wheelText(
              "🕐 **Spinning the wheel…**",
            ),
          ),
      ],
      flags:
        MessageFlags.IsComponentsV2,
    });

  await runSpin(
    userId,
    interaction.user.username,
    bet,
    (data) =>
      spinMsg.edit(data),
  );
}