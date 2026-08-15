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
  formatMult,
  getOrCreateUser,
  addBalance,
  recordBet,
  errorEmbed,
} from "../utils.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CrashSession {
  userId: string;
  bet: number;
  crashPoint: number;
  startTime: number;
  status: "flying" | "cashed" | "crashed";
  lastMult: number;
  gameMessage: Message;
  timer: NodeJS.Timeout;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HOUSE_EDGE = 0.075;
const GROWTH = 0.06;
const UPDATE_MS = 1_000;

// ─── Active sessions ──────────────────────────────────────────────────────────

export const activeSessions = new Map<string, CrashSession>();

// ─── Crash point generation ───────────────────────────────────────────────────

function generateCrashPoint(): number {
  const r = Math.random();

  if (r < HOUSE_EDGE) return 1.00;

  const raw =
    (1 - HOUSE_EDGE) /
    (1 - r);

  return Math.floor(raw * 100) / 100;
}

// ─── Multiplier ───────────────────────────────────────────────────────────────

function multAt(elapsedMs: number): number {
  return Math.exp(
    GROWTH *
      elapsedMs /
      1_000,
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function buildBar(mult: number): string {
  const filled = Math.min(
    10,
    Math.round(
      Math.log10(mult) * 10,
    ),
  );

  return (
    "▰".repeat(filled) +
    "▱".repeat(10 - filled)
  );
}

// ─── Components V2 helpers ────────────────────────────────────────────────────

function text(
  content: string,
): TextDisplayBuilder {
  return new TextDisplayBuilder()
    .setContent(content);
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder();
}

// ─── Flying panel ─────────────────────────────────────────────────────────────

function flyingComponents(
  mult: number,
  bet: number,
  sessionId: string,
): ContainerBuilder[] {
  const potential = Math.floor(
    bet * mult,
  );

  const color =
    mult >= 5
      ? COLORS.gold
      : mult >= 2
        ? COLORS.success
        : COLORS.primary;

  const icon =
    mult >= 10
      ? "🌕"
      : mult >= 5
        ? "🌟"
        : mult >= 2
          ? "🚀"
          : "🛫";

  const panel =
    new ContainerBuilder()
      .setAccentColor(color)

      .addTextDisplayComponents(
        text(
          `## ${icon}  Crash — Flying!`,
        ),
      )

      .addTextDisplayComponents(
        text(
          [
            `💎 **Bet**  \`${formatAmount(bet)}\``,
            `💵 **Cash Out Now**  \`${formatAmount(potential)}\``,
          ].join("\n"),
        ),
      )

      .addSeparatorComponents(
        separator(),
      )

      .addTextDisplayComponents(
        text(
          [
            `## ${mult.toFixed(2)}×`,
            "",
            buildBar(mult),
          ].join("\n"),
        ),
      )

      .addActionRowComponents(
        cashOutRow(sessionId),
      );

  return [panel];
}

// ─── Crashed panel ────────────────────────────────────────────────────────────

function crashedComponents(
  crashPoint: number,
  bet: number,
  userId: string,
): ContainerBuilder[] {
  const panel =
    new ContainerBuilder()
      .setAccentColor(
        COLORS.danger,
      )

      .addTextDisplayComponents(
        text(
          "## 💥  Crash — Crashed!",
        ),
      )

      .addTextDisplayComponents(
        text(
          `💎 **Bet**  \`${formatAmount(bet)}\``,
        ),
      )

      .addSeparatorComponents(
        separator(),
      )

      .addTextDisplayComponents(
        text(
          [
            `## ${crashPoint.toFixed(2)}×`,
            "",
            `***(Crashed at ${crashPoint.toFixed(2)}×)***`,
          ].join("\n"),
        ),
      )

      .addActionRowComponents(
        playAgainRow(
          userId,
          bet,
        ),
      );

  return [panel];
}

// ─── Cashed out panel ─────────────────────────────────────────────────────────

function cashedComponents(
  mult: number,
  bet: number,
  crashPoint: number,
  userId: string,
): ContainerBuilder[] {
  const winnings = Math.floor(
    bet * mult,
  );

  const panel =
    new ContainerBuilder()
      .setAccentColor(
        winnings > bet
          ? COLORS.success
          : COLORS.warning,
      )

      .addTextDisplayComponents(
        text(
          "## ✅  Crash — Cashed Out!",
        ),
      )

      .addTextDisplayComponents(
        text(
          [
            `💎 **Bet**  \`${formatAmount(bet)}\``,
            `💰 **Payout**  \`${formatAmount(winnings)}\``,
          ].join("\n"),
        ),
      )

      .addSeparatorComponents(
        separator(),
      )

      .addTextDisplayComponents(
        text(
          [
            `## ${mult.toFixed(2)}×`,
            "",
            `***(Crashed at ${crashPoint.toFixed(2)}×)***`,
            "",
            `> Cashed out at **${mult.toFixed(2)}×** with **${formatAmount(winnings)}**`,
          ].join("\n"),
        ),
      )

      .addActionRowComponents(
        playAgainRow(
          userId,
          bet,
        ),
      );

  return [panel];
}

// ─── Buttons ──────────────────────────────────────────────────────────────────

function cashOutRow(
  sessionId: string,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `crash_cashout_${sessionId}`,
      )
      .setLabel("Cash Out")
      .setEmoji("💵")
      .setStyle(
        ButtonStyle.Success,
      ),
  );
}

function playAgainRow(
  userId: string,
  bet: number,
  disabled = false,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `pa_crash_${userId}_${bet}`,
      )
      .setLabel(
        "🔄  Play Again",
      )
      .setStyle(
        ButtonStyle.Secondary,
      )
      .setDisabled(disabled),
  );
}

// ─── Core session launcher ────────────────────────────────────────────────────

function launchCrash(
  userId: string,
  bet: number,
  gameMessage: Message,
): string {
  const sessionId =
    `${userId}_${Date.now()}`;

  const crashPoint =
    generateCrashPoint();

  const startTime =
    Date.now();

  const session: CrashSession = {
    userId,
    bet,
    crashPoint,
    startTime,
    status: "flying",
    lastMult: 1.00,
    gameMessage,

    timer: setInterval(
      async () => {
        if (
          session.status !==
          "flying"
        ) {
          return;
        }

        const elapsed =
          Date.now() -
          session.startTime;

        const mult =
          multAt(elapsed);

        if (
          mult >=
          crashPoint
        ) {
          clearInterval(
            session.timer,
          );

          session.status =
            "crashed";

          activeSessions.delete(
            sessionId,
          );

          await recordBet(
            userId,
            bet,
            -bet,
            "crash",
          );

          try {
            await session.gameMessage.edit(
              {
                flags:
                  MessageFlags.IsComponentsV2,
                components:
                  crashedComponents(
                    crashPoint,
                    bet,
                    userId,
                  ),
              },
            );
          } catch {
            // Message expired.
          }

          return;
        }

        session.lastMult =
          mult;

        try {
          await session.gameMessage.edit(
            {
              flags:
                MessageFlags.IsComponentsV2,
              components:
                flyingComponents(
                  mult,
                  bet,
                  sessionId,
                ),
            },
          );
        } catch {
          // Rate-limit miss — skip this frame.
        }
      },
      UPDATE_MS,
    ),
  };

  activeSessions.set(
    sessionId,
    session,
  );

  return sessionId;
}

// ─── Command ──────────────────────────────────────────────────────────────────

export const data =
  new SlashCommandBuilder()
    .setName("crash")
    .setDescription(
      "Play the Crash game",
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
          `Insufficient balance. You have **${formatAmount(user.balance)} gems**.`,
        ),
      ],
    });
  }

  const alreadyActive =
    [
      ...activeSessions.values(),
    ].find(
      (s) =>
        s.userId ===
        interaction.user.id,
    );

  if (alreadyActive) {
    return interaction.editReply({
      embeds: [
        errorEmbed(
          "You already have a Crash game in progress!",
        ),
      ],
    });
  }

  await addBalance(
    interaction.user.id,
    -amount,
  );

  const gameMessage =
    await interaction.editReply({
      flags:
        MessageFlags.IsComponentsV2,
      components:
        flyingComponents(
          1.00,
          amount,
          `${interaction.user.id}_${Date.now()}`,
        ),
    });

  const sessionId =
    launchCrash(
      interaction.user.id,
      amount,
      gameMessage,
    );

  await gameMessage.edit({
    flags:
      MessageFlags.IsComponentsV2,
    components:
      flyingComponents(
        1.00,
        amount,
        sessionId,
      ),
  });
}

// ─── Button: Cash Out ─────────────────────────────────────────────────────────

export async function handleCashout(
  interaction: ButtonInteraction,
  sessionId: string,
) {
  const session =
    activeSessions.get(
      sessionId,
    );

  if (
    !session ||
    session.status !==
      "flying"
  ) {
    return interaction.reply({
      content:
        "💥 Too late — the rocket already crashed!",
      flags:
        MessageFlags.Ephemeral,
    });
  }

  if (
    interaction.user.id !==
    session.userId
  ) {
    return interaction.reply({
      content:
        "❌ This isn't your game.",
      flags:
        MessageFlags.Ephemeral,
    });
  }

  clearInterval(
    session.timer,
  );

  session.status =
    "cashed";

  activeSessions.delete(
    sessionId,
  );

  const mult =
    session.lastMult;

  const winnings =
    Math.floor(
      session.bet * mult,
    );

  await addBalance(
    session.userId,
    winnings,
  );

  await recordBet(
    session.userId,
    session.bet,
    winnings -
      session.bet,
    "crash",
    mult,
  );

  await interaction.update({
    flags:
      MessageFlags.IsComponentsV2,
    components:
      cashedComponents(
        mult,
        session.bet,
        session.crashPoint,
        session.userId,
      ),
  });
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

  // ── Disable only the clicked Play Again button ─────────────────────────────
  // Keep the entire previous Components V2 panel unchanged.

  const components =
    interaction.message.components.map(
      (component: any) =>
        component.toJSON
          ? component.toJSON()
          : component,
    );

  const disablePlayAgain = (
    component: any,
  ): any => {
    if (
      component?.type === 1 &&
      Array.isArray(
        component.components,
      )
    ) {
      return {
        ...component,
        components:
          component.components.map(
            (button: any) => {
              if (
                button.type === 2 &&
                typeof button.custom_id ===
                  "string" &&
                button.custom_id ===
                  `pa_crash_${userId}_${bet}`
              ) {
                return {
                  ...button,
                  disabled: true,
                };
              }

              return button;
            },
          ),
      };
    }

    if (
      Array.isArray(
        component?.components,
      )
    ) {
      return {
        ...component,
        components:
          component.components.map(
            disablePlayAgain,
          ),
      };
    }

    return component;
  };

  const updatedComponents =
    components.map(
      disablePlayAgain,
    );

  await interaction.update({
    flags:
      MessageFlags.IsComponentsV2,
    components:
      updatedComponents as any,
  });

  // ── Check for another active game ──────────────────────────────────────────

  const alreadyActive =
    [
      ...activeSessions.values(),
    ].find(
      (s) =>
        s.userId ===
        userId,
    );

  if (alreadyActive) {
    await interaction.followUp({
      embeds: [
        errorEmbed(
          "You already have a Crash game in progress!",
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });

    return;
  }

  // ── Check balance ──────────────────────────────────────────────────────────

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
          `Insufficient balance. You have **${formatAmount(user.balance)} gems**.`,
        ),
      ],
      flags:
        MessageFlags.Ephemeral,
    });

    return;
  }

  await addBalance(
    userId,
    -bet,
  );

  // ── Start new game in a separate message ───────────────────────────────────

  const gameMessage: Message =
    await interaction.followUp({
      flags:
        MessageFlags.IsComponentsV2,
      components:
        flyingComponents(
          1.00,
          bet,
          `${userId}_${Date.now()}`,
        ),
    });

  const sessionId =
    launchCrash(
      userId,
      bet,
      gameMessage,
    );

  await gameMessage.edit({
    flags:
      MessageFlags.IsComponentsV2,
    components:
      flyingComponents(
        1.00,
        bet,
        sessionId,
      ),
  });
}