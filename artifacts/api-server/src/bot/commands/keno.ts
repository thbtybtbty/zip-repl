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
  type TextChannel,
  type MessageEditOptions,
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

// ─── Constants ────────────────────────────────────────────────────────────────
const GRID_SIZE = 25;
const PICK_COUNT = 6;

// Easy: 2+ hits pay. Hard: 3+ hits pay (bigger multipliers).
const EASY_PAYOUTS: Record<number, number> = {
  2: 1.5,
  3: 2,
  4: 5,
  5: 20,
  6: 50,
};

const HARD_PAYOUTS: Record<number, number> = {
  3: 2,
  4: 10,
  5: 50,
  6: 200,
};

function getPayouts(difficulty: string) {
  return difficulty === "hard"
    ? HARD_PAYOUTS
    : EASY_PAYOUTS;
}

function topPrize(difficulty: string) {
  return Math.max(
    ...Object.values(getPayouts(difficulty)),
  );
}

function payoutLine(difficulty: string) {
  return Object.entries(getPayouts(difficulty))
    .map(([h, m]) => `**${h}** hits → **${m}x**`)
    .join(" · ");
}

// ─── State ────────────────────────────────────────────────────────────────────
interface KenoState {
  userId: string;
  bet: number;
  difficulty: string;
  picks: Set<number>;

  /** ID of the embed + grid message */
  embedMessageId: string;

  /** ID of the controls message */
  panelMessageId: string;

  channelId: string;
}

const activeSessions = new Map<string, KenoState>();

const sessionKey = (userId: string) =>
  `${userId}_keno`;

// ─── Button rows ──────────────────────────────────────────────────────────────

/**
 * 5×5 interactive grid.
 */
function numberRows(
  picks: Set<number>,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  for (let row = 0; row < 5; row++) {
    const ar =
      new ActionRowBuilder<MessageActionRowComponentBuilder>();

    for (let col = 0; col < 5; col++) {
      const n = row * 5 + col + 1;
      const picked = picks.has(n);

      ar.addComponents(
        new ButtonBuilder()
          .setCustomId(`keno_num_${n}`)
          .setLabel(picked ? `✓${n}` : `${n}`)
          .setStyle(
            picked
              ? ButtonStyle.Primary
              : ButtonStyle.Secondary,
          ),
      );
    }

    rows.push(ar);
  }

  return rows;
}

/**
 * Frozen result grid shown after draw.
 */
function resultNumberRows(
  picks: Set<number>,
  drawn: Set<number>,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  for (let row = 0; row < 5; row++) {
    const ar =
      new ActionRowBuilder<MessageActionRowComponentBuilder>();

    for (let col = 0; col < 5; col++) {
      const n = row * 5 + col + 1;

      const isPicked = picks.has(n);
      const isDrawn = drawn.has(n);

      let label: string;
      let style: ButtonStyle;

      if (isPicked && isDrawn) {
        label = `✓${n}`;
        style = ButtonStyle.Success;
      } else if (isPicked && !isDrawn) {
        label = `✓${n}`;
        style = ButtonStyle.Primary;
      } else if (!isPicked && isDrawn) {
        label = `✗${n}`;
        style = ButtonStyle.Danger;
      } else {
        label = `✗${n}`;
        style = ButtonStyle.Secondary;
      }

      ar.addComponents(
        new ButtonBuilder()
          .setCustomId(`keno_done_${n}`)
          .setLabel(label)
          .setStyle(style)
          .setDisabled(true),
      );
    }

    rows.push(ar);
  }

  return rows;
}

function controlRow(
  picks: Set<number>,
  canDraw: boolean,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("keno_quick")
      .setLabel("✨ Quick Pick")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("keno_clear")
      .setLabel("Clear")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(picks.size === 0),

    new ButtonBuilder()
      .setCustomId("keno_draw")
      .setLabel("🎲 Draw")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canDraw),
  );
}

function playAgainRow(
  userId: string,
  bet: number,
  difficulty: string,
  disabled = false,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `pa_keno_${userId}_${difficulty}_${bet}`,
      )
      .setLabel("🔄 Play Again")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );
}

// ─── Embeds ───────────────────────────────────────────────────────────────────

function selectionEmbed(
  state: KenoState,
): EmbedBuilder {
  const mode =
    state.difficulty === "hard"
      ? "Hard"
      : "Easy";

  const hint =
    state.picks.size < PICK_COUNT
      ? `_Pick **${
          PICK_COUNT - state.picks.size
        }** more number(s) or use ✨ Quick Pick_`
      : `_Ready! Click 🎲 Draw to play._`;

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🎱  Keno")
    .setDescription(
      [
        `💎 **Bet**  \`${formatAmount(state.bet)}\``,
        `🍀 **Mode**  \`${mode}\``,
        `🔢 **Numbers**  \`${state.picks.size}/${PICK_COUNT}\``,
        `👑 **Top prize**  \`${topPrize(
          state.difficulty,
        )}x\``,
        ``,
        `📊 Payouts · ${payoutLine(
          state.difficulty,
        )}`,
        ``,
        hint,
      ].join("\n"),
    )
    .setTimestamp();
}

function resultEmbed(
  state: KenoState,
  hits: number,
  payout: number,
): EmbedBuilder {
  const payouts =
    getPayouts(state.difficulty);

  const multiplier =
    payouts[hits] ?? 0;

  const profit =
    payout - state.bet;

  const won =
    multiplier > 0;

  const mode =
    state.difficulty === "hard"
      ? "Hard"
      : "Easy";

  const lines = [
    `💎 **Bet**  \`${formatAmount(
      state.bet,
    )}\``,
    `🍀 **Mode**  \`${mode}\``,
    `🎯 **Hits**  \`${hits}/${PICK_COUNT}\``,
  ];

  if (won) {
    lines.push(
      `✨ **Multiplier**  \`${multiplier}x\``,
      `💰 **Payout**  \`${formatAmount(
        payout,
      )}\``,
      `📈 **Profit**  \`+${formatAmount(
        profit,
      )}\``,
    );
  }

  return new EmbedBuilder()
    .setColor(
      won
        ? COLORS.success
        : COLORS.danger,
    )
    .setTitle(
      won
        ? "🎱  Keno — YOU WON"
        : "🎱  Keno — No Win",
    )
    .setDescription(
      lines.join("\n"),
    )
    .setTimestamp();
}

// ─── Draw logic ───────────────────────────────────────────────────────────────

function drawNumbers(): Set<number> {
  const pool = Array.from(
    { length: GRID_SIZE },
    (_, i) => i + 1,
  );

  for (
    let i = pool.length - 1;
    i > 0;
    i--
  ) {
    const j = Math.floor(
      Math.random() * (i + 1),
    );

    [pool[i], pool[j]] = [
      pool[j]!,
      pool[i]!,
    ];
  }

  return new Set(
    pool.slice(0, PICK_COUNT),
  );
}

// ─── Helper: edit any channel message by ID ───────────────────────────────────

async function editChannelMessage(
  interaction: ButtonInteraction,
  messageId: string,
  data: MessageEditOptions,
): Promise<void> {
  const channel =
    interaction.channel as TextChannel;

  const msg =
    await channel.messages.fetch(
      messageId,
    );

  await msg.edit(data);
}

// ─── Command ──────────────────────────────────────────────────────────────────

export const data =
  new SlashCommandBuilder()
    .setName("keno")
    .setDescription(
      "Pick 6 numbers from 1–25 and match the draw!",
    )
    .addStringOption((o) =>
      o
        .setName("amount")
        .setDescription(
          "Bet amount (e.g. 1m, 2.5b, 500k)",
        )
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("difficulty")
        .setDescription(
          "Easy (max 50x) or Hard (max 200x)",
        )
        .setRequired(true)
        .addChoices(
          {
            name: "🍀 Easy  — max 50x",
            value: "easy",
          },
          {
            name: "🔥 Hard  — max 200x",
            value: "hard",
          },
        ),
    );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const amountStr =
    interaction.options.getString(
      "amount",
      true,
    );

  const difficulty =
    interaction.options.getString(
      "difficulty",
      true,
    );

  const amount =
    parseAmount(amountStr);

  if (
    !amount ||
    amount < 1_000_000
  ) {
    return void interaction.reply({
      embeds: [
        errorEmbed(
          "Minimum bet is **1M gems**.",
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
    user.balance < amount
  ) {
    return void interaction.editReply({
      embeds: [
        errorEmbed(
          `Insufficient balance. You have **${formatAmount(
            user.balance,
          )} 💎**.`,
        ),
      ],
    });
  }

  await addBalance(
    interaction.user.id,
    -amount,
  );

  const state: KenoState = {
    userId:
      interaction.user.id,
    bet: amount,
    difficulty,
    picks: new Set(),
    embedMessageId: "",
    panelMessageId: "",
    channelId:
      interaction.channelId,
  };

  activeSessions.set(
    sessionKey(
      interaction.user.id,
    ),
    state,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGE 1 — Embed + 5×5 grid
  //
  // This remains the slash command's original response.
  // ─────────────────────────────────────────────────────────────────────────

  const embedMsg =
    await interaction.editReply({
      embeds: [
        selectionEmbed(state),
      ],
      components:
        numberRows(state.picks),
    });

  state.embedMessageId =
    embedMsg.id;

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGE 2 — Controls
  //
  // IMPORTANT:
  // Use channel.send(), NOT interaction.followUp().
  // This makes the controls a completely normal message directly below
  // the grid instead of a reply to the grid message.
  // ─────────────────────────────────────────────────────────────────────────

  const channel =
    interaction.channel as TextChannel;

  const panelMsg =
    await channel.send({
      components: [
        controlRow(
          state.picks,
          false,
        ),
      ],
    });

  state.panelMessageId =
    panelMsg.id;
}

// ─── Shared: run the draw ─────────────────────────────────────────────────────

async function runDraw(
  interaction: ButtonInteraction,
  state: KenoState,
): Promise<void> {
  const drawn =
    drawNumbers();

  const hits = [
    ...state.picks,
  ].filter((n) =>
    drawn.has(n),
  ).length;

  const payouts =
    getPayouts(
      state.difficulty,
    );

  const multiplier =
    payouts[hits] ?? 0;

  const payout =
    multiplier > 0
      ? Math.floor(
          state.bet * multiplier,
        )
      : 0;

  if (payout > 0) {
    await addBalance(
      state.userId,
      payout,
    );
  }

  await recordBet(
    state.userId,
    state.bet,
    payout - state.bet,
    "keno",
  );

  activeSessions.delete(
    sessionKey(state.userId),
  );

  // Replace controls with Play Again.
  await interaction.update({
    components: [
      playAgainRow(
        state.userId,
        state.bet,
        state.difficulty,
      ),
    ],
  });

  // Freeze grid/result message.
  await editChannelMessage(
    interaction,
    state.embedMessageId,
    {
      embeds: [
        resultEmbed(
          state,
          hits,
          payout,
        ),
      ],
      components:
        resultNumberRows(
          state.picks,
          drawn,
        ),
    },
  );
}

// ─── Button: Toggle number ────────────────────────────────────────────────────

export async function handleNumber(
  interaction: ButtonInteraction,
  n: number,
): Promise<void> {
  const state =
    activeSessions.get(
      sessionKey(
        interaction.user.id,
      ),
    );

  if (
    !state ||
    state.userId !==
      interaction.user.id
  ) {
    return void interaction.reply({
      content:
        "❌ No active Keno session for you.",
      ephemeral: true,
    });
  }

  if (state.picks.has(n)) {
    state.picks.delete(n);
  } else {
    if (
      state.picks.size >=
      PICK_COUNT
    ) {
      return void interaction.reply({
        content: `❌ You can only pick **${PICK_COUNT}** numbers.`,
        ephemeral: true,
      });
    }

    state.picks.add(n);
  }

  const canDraw =
    state.picks.size ===
    PICK_COUNT;

  await interaction.update({
    embeds: [
      selectionEmbed(state),
    ],
    components:
      numberRows(state.picks),
  });

  await editChannelMessage(
    interaction,
    state.panelMessageId,
    {
      components: [
        controlRow(
          state.picks,
          canDraw,
        ),
      ],
    },
  );
}

// ─── Button: Quick Pick ───────────────────────────────────────────────────────

export async function handleQuickPick(
  interaction: ButtonInteraction,
): Promise<void> {
  const state =
    activeSessions.get(
      sessionKey(
        interaction.user.id,
      ),
    );

  if (
    !state ||
    state.userId !==
      interaction.user.id
  ) {
    return void interaction.reply({
      content:
        "❌ No active Keno session for you.",
      ephemeral: true,
    });
  }

  state.picks.clear();

  const pool = Array.from(
    { length: GRID_SIZE },
    (_, i) => i + 1,
  );

  for (
    let i = pool.length - 1;
    i > 0;
    i--
  ) {
    const j = Math.floor(
      Math.random() * (i + 1),
    );

    [pool[i], pool[j]] = [
      pool[j]!,
      pool[i]!,
    ];
  }

  pool
    .slice(0, PICK_COUNT)
    .forEach((n) =>
      state.picks.add(n),
    );

  await interaction.update({
    components: [
      controlRow(
        state.picks,
        true,
      ),
    ],
  });

  await editChannelMessage(
    interaction,
    state.embedMessageId,
    {
      embeds: [
        selectionEmbed(state),
      ],
      components:
        numberRows(state.picks),
    },
  );
}

// ─── Button: Clear ────────────────────────────────────────────────────────────

export async function handleClear(
  interaction: ButtonInteraction,
): Promise<void> {
  const state =
    activeSessions.get(
      sessionKey(
        interaction.user.id,
      ),
    );

  if (
    !state ||
    state.userId !==
      interaction.user.id
  ) {
    return void interaction.reply({
      content:
        "❌ No active Keno session for you.",
      ephemeral: true,
    });
  }

  state.picks.clear();

  await interaction.update({
    components: [
      controlRow(
        state.picks,
        false,
      ),
    ],
  });

  await editChannelMessage(
    interaction,
    state.embedMessageId,
    {
      embeds: [
        selectionEmbed(state),
      ],
      components:
        numberRows(state.picks),
    },
  );
}

// ─── Button: Draw ─────────────────────────────────────────────────────────────

export async function handleDraw(
  interaction: ButtonInteraction,
): Promise<void> {
  const state =
    activeSessions.get(
      sessionKey(
        interaction.user.id,
      ),
    );

  if (
    !state ||
    state.userId !==
      interaction.user.id
  ) {
    return void interaction.reply({
      content:
        "❌ No active Keno session for you.",
      ephemeral: true,
    });
  }

  if (
    state.picks.size <
    PICK_COUNT
  ) {
    return void interaction.reply({
      content: `❌ Pick **${PICK_COUNT}** numbers first.`,
      ephemeral: true,
    });
  }

  await runDraw(
    interaction,
    state,
  );
}

// ─── Button: Play Again ───────────────────────────────────────────────────────

export async function handlePlayAgain(
  interaction: ButtonInteraction,
  userId: string,
  difficulty: string,
  betStr: string,
): Promise<void> {
  if (
    interaction.user.id !==
    userId
  ) {
    return void interaction.reply({
      content:
        "❌ This is not your game.",
      ephemeral: true,
    });
  }

  const bet =
    parseInt(
      betStr,
      10,
    );

  const user =
    await getOrCreateUser(
      interaction.user.id,
      interaction.user.username,
    );

  if (
    user.balance < bet
  ) {
    return void interaction.reply({
      content: `❌ Insufficient balance. You have **${formatAmount(
        user.balance,
      )} 💎**.`,
      ephemeral: true,
    });
  }

  // Disable ONLY the old Play Again button.
  // The old result/grid stays exactly where it is.
  await interaction.update({
    components: [
      playAgainRow(
        userId,
        bet,
        difficulty,
        true,
      ),
    ],
  });

  await addBalance(
    interaction.user.id,
    -bet,
  );

  const state: KenoState = {
    userId:
      interaction.user.id,
    bet,
    difficulty,
    picks: new Set(),
    embedMessageId: "",
    panelMessageId: "",
    channelId:
      interaction.channelId,
  };

  activeSessions.set(
    sessionKey(
      interaction.user.id,
    ),
    state,
  );

  const channel =
    interaction.channel as TextChannel;

  // ─────────────────────────────────────────────────────────────────────────
  // NEW GAME — MESSAGE 1
  // Embed + 5×5 grid
  // ─────────────────────────────────────────────────────────────────────────

  const embedMsg =
    await channel.send({
      embeds: [
        selectionEmbed(state),
      ],
      components:
        numberRows(state.picks),
    });

  state.embedMessageId =
    embedMsg.id;

  // ─────────────────────────────────────────────────────────────────────────
  // NEW GAME — MESSAGE 2
  // Quick Pick + Clear + Draw
  //
  // Normal message, immediately after the grid.
  // ─────────────────────────────────────────────────────────────────────────

  const panelMsg =
    await channel.send({
      components: [
        controlRow(
          state.picks,
          false,
        ),
      ],
    });

  state.panelMessageId =
    panelMsg.id;
}