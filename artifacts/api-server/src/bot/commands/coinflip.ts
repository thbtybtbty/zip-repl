import {
  SlashCommandBuilder,
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
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

export const data = new SlashCommandBuilder()
  .setName("coinflip")
  .setDescription("Flip a coin — double or nothing!")
  .addStringOption((opt) =>
    opt
      .setName("amount")
      .setDescription("Bet amount (e.g. 1m, 2.5b)")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("choice")
      .setDescription("Heads or tails?")
      .setRequired(true)
      .addChoices(
        { name: "🪙 Heads", value: "heads" },
        { name: "🔵 Tails", value: "tails" },
      ),
  );

const SIDES = ["heads", "tails"] as const;

const SIDE_DISPLAY: Record<string, string> = {
  heads: "🪙 Heads",
  tails: "🔵 Tails",
};

const FLIP_PROGRESS_BARS = [
  "▰▱▱▱▱▱",
  "▰▰▱▱▱▱",
  "▰▰▰▱▱▱",
  "▰▰▰▰▱▱",
  "▰▰▰▰▰▱",
  "▰▰▰▰▰▰",
];

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

// ─── Animation ─────────────────────────────────────────────────────────────────

function coinflipAnimationContainer(
  amount: number,
  choice: string,
  result: string,
  frame: number,
): ContainerBuilder {
  const animatedResult =
    frame >= FLIP_PROGRESS_BARS.length - 1
      ? result
      : frame % 2 === 0
        ? "heads"
        : "tails";

  const progress =
    FLIP_PROGRESS_BARS[
      Math.min(
        frame,
        FLIP_PROGRESS_BARS.length - 1,
      )
    ]!;

  return new ContainerBuilder()
    .setAccentColor(COLORS.primary)

    .addTextDisplayComponents(
      text("## 🪙  Coin Flip"),
    )

    // Bet stays at the top.
    .addTextDisplayComponents(
      text(
        `💎 **Bet**  \`${formatAmount(amount)}\``,
      ),
    )

    // Divider between the top stats and pick/result.
    .addSeparatorComponents(
      new SeparatorBuilder(),
    )

    .addTextDisplayComponents(
      text(
        [
          `🎯 **Your pick**  \`${SIDE_DISPLAY[choice]!}\``,
          `🪙 **Result**     \`${SIDE_DISPLAY[animatedResult]!}\``,
        ].join("\n"),
      ),
    )

    .addTextDisplayComponents(
      text(
        [
          "",
          "🕐 **Flipping the coin…**",
          progress,
        ].join("\n"),
      ),
    );
}

// ─── Final result ──────────────────────────────────────────────────────────────

function coinflipResultContainer(
  amount: number,
  choice: string,
  result: string,
  won: boolean,
): ContainerBuilder {
  const container =
    new ContainerBuilder()
      .setAccentColor(
        won
          ? COLORS.success
          : COLORS.danger,
      )
      .addTextDisplayComponents(
        text(
          won
            ? "## 🪙  Coin Flip — You Win!"
            : "## 🪙  Coin Flip — You Lose!",
        ),
      );

  // Bet + Payout are intentionally in ONE text component
  // so there is no extra component spacing between them.
  const statsLines = [
    `💎 **Bet**  \`${formatAmount(amount)}\``,
    ...(won
      ? [
          `💰 **Payout**  \`${formatAmount(
            amount * 2,
          )} (2.00x)\``,
        ]
      : []),
  ];

  container.addTextDisplayComponents(
    text(statsLines.join("\n")),
  );

  // Real Components V2 divider.
  container.addSeparatorComponents(
    new SeparatorBuilder(),
  );

  // Your pick + result stay at the bottom.
  container.addTextDisplayComponents(
    text(
      [
        `🎯 **Your pick**  \`${SIDE_DISPLAY[choice]!}\``,
        `🪙 **Result**     \`${SIDE_DISPLAY[result]!}\``,
      ].join("\n"),
    ),
  );

  return container;
}

// ─── Animation ─────────────────────────────────────────────────────────────────

async function animateCoinflip(
  interaction: ChatInputCommandInteraction,
  amount: number,
  choice: string,
  result: string,
): Promise<void> {
  await interaction
    .editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        coinflipAnimationContainer(
          amount,
          choice,
          result,
          0,
        ),
      ],
    })
    .catch(() => null);

  for (
    let frame = 1;
    frame < FLIP_PROGRESS_BARS.length;
    frame++
  ) {
    await sleep(350);

    await interaction
      .editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [
          coinflipAnimationContainer(
            amount,
            choice,
            result,
            frame,
          ),
        ],
      })
      .catch(() => null);
  }

  await sleep(350);
}

// ─── Command ──────────────────────────────────────────────────────────────────

export async function execute(
  interaction: ChatInputCommandInteraction,
) {
  const amountStr =
    interaction.options.getString(
      "amount",
      true,
    );

  const choice =
    interaction.options.getString(
      "choice",
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
          "Minimum bet is **1M gems**. Try `1m`, `2.5b`, `500k`.",
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
          `Insufficient balance. You have **${formatAmount(
            user.balance,
          )} gems**.`,
        ),
      ],
    });
  }

  // Flip — P(win) = 0.4625 → house edge 7.5%
  const won =
    Math.random() < 0.4625;

  const result =
    (
      won
        ? choice
        : choice === "heads"
          ? "tails"
          : "heads"
    ) as typeof SIDES[number];

  const payout =
    won
      ? amount
      : -amount;

  await addBalance(
    interaction.user.id,
    payout,
  );

  await recordBet(
    interaction.user.id,
    amount,
    payout,
    "coinflip",
  );

  // Animation has no payout.
  await animateCoinflip(
    interaction,
    amount,
    choice,
    result,
  );

  // Final result.
  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: [
      coinflipResultContainer(
        amount,
        choice,
        result,
        won,
      ),
    ],
  });
}