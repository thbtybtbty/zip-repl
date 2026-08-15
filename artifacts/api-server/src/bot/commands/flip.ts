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
const PAYOUT_MULT = 1.9;
const WIN_CHANCE  = 0.475;

// ─── Pending flip challenges ──────────────────────────────────────────────────
interface FlipChallenge {
  challengerId:   string;
  challengerName: string;
  challengerSide: "Heads" | "Tails";
  bet:            number;
  channelMsgId:   string;
  createdAt:       number;
}

const pendingFlips = new Map<string, FlipChallenge>();

// ─── Visual helpers ───────────────────────────────────────────────────────────
const SIDE_ICON: Record<"Heads" | "Tails", string> = {
  Heads: "🟡",
  Tails: "⚪",
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

// ─── Components V2 helpers ────────────────────────────────────────────────────
function separator(): SeparatorBuilder {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);
}

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

function makeContainer(
  content: (
    | TextDisplayBuilder
    | SeparatorBuilder
    | ActionRowBuilder<MessageActionRowComponentBuilder>
  )[],
  color: number,
): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(color);

  for (const component of content) {
    if (component instanceof TextDisplayBuilder) {
      container.addTextDisplayComponents(component);
    } else if (component instanceof SeparatorBuilder) {
      container.addSeparatorComponents(component);
    } else {
      container.addActionRowComponents(component);
    }
  }

  return container;
}

// ─── Challenge panel ──────────────────────────────────────────────────────────
function challengePanel(
  challengerName: string,
  challengerSide: "Heads" | "Tails",
  bet: number,
  status: "open" | "expired",
): ContainerBuilder {
  if (status === "expired") {
    return makeContainer(
      [
        text("## 🪙  Flip Challenge"),
        separator(),
        text("❌ **This challenge has expired.**"),
      ],
      COLORS.dark,
    );
  }

  const winner = Math.floor(bet * PAYOUT_MULT);

  const joinerSide: "Heads" | "Tails" =
    challengerSide === "Heads" ? "Tails" : "Heads";

  return makeContainer(
    [
      text("## 🪙  Flip Challenge"),

      separator(),

      text(
        `**${challengerName}** is looking for a coin flip duel!`,
      ),

      separator(),

      text(
        `💎 **Bet**     \`${formatAmount(bet)}\`\n` +
        `💰 **Winner**  \`${formatAmount(winner)}\``,
      ),

      separator(),

      text(
        `${SIDE_ICON[challengerSide]} **${challengerName}**  →  \`${challengerSide}\`\n` +
        `${SIDE_ICON[joinerSide]} **You (joiner)**  →  \`${joinerSide}\``,
      ),

      separator(),

      text(
        `Click **Join** to play as \`${joinerSide}\`, or **Call Bot** to face the house.`,
      ),
    ],
    COLORS.gold,
  );
}

// ─── Challenge buttons ────────────────────────────────────────────────────────
function challengeRow(
  challengerId: string,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
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

// ─── Flip animation panel ─────────────────────────────────────────────────────
function flipAnimationPanel(
  title: string,
  playerOneName: string,
  playerOneSide: "Heads" | "Tails",
  playerTwoName: string,
  playerTwoSide: "Heads" | "Tails",
  bet: number,
  coinResult: "Heads" | "Tails",
  frame: number,
): ContainerBuilder {
  const animatedResult =
    frame >= FLIP_PROGRESS_BARS.length - 1
      ? coinResult
      : (frame % 2 === 0 ? "Heads" : "Tails");

  return makeContainer(
    [
      text(`## ${title}`),

      separator(),

      text(
        `💎 **Bet each**      \`${formatAmount(bet)}\``,
      ),

      separator(),

      text(
        `🎲 **Coin landed**   \`${animatedResult}\``,
      ),

      separator(),

      text(
        `${SIDE_ICON[playerOneSide]} **${playerOneName}**  \`${playerOneSide}\`   vs   \`${playerTwoSide}\`  **${playerTwoName}** ${SIDE_ICON[playerTwoSide]}`,
      ),

      separator(),

      text(
        `🕐 **Flipping the coin…**\n` +
        FLIP_PROGRESS_BARS[
          Math.min(frame, FLIP_PROGRESS_BARS.length - 1)
        ]!,
      ),
    ],
    COLORS.primary,
  );
}

// ─── Animation ────────────────────────────────────────────────────────────────
async function animateFlip(
  interaction: ButtonInteraction,
  title: string,
  playerOneName: string,
  playerOneSide: "Heads" | "Tails",
  playerTwoName: string,
  playerTwoSide: "Heads" | "Tails",
  bet: number,
  coinResult: "Heads" | "Tails",
): Promise<void> {
  await interaction.editReply({
    components: [
      flipAnimationPanel(
        title,
        playerOneName,
        playerOneSide,
        playerTwoName,
        playerTwoSide,
        bet,
        coinResult,
        0,
      ),
    ],
  }).catch(() => null);

  for (
    let frame = 1;
    frame < FLIP_PROGRESS_BARS.length;
    frame++
  ) {
    await sleep(350);

    await interaction.editReply({
      components: [
        flipAnimationPanel(
          title,
          playerOneName,
          playerOneSide,
          playerTwoName,
          playerTwoSide,
          bet,
          coinResult,
          frame,
        ),
      ],
    }).catch(() => null);
  }

  await sleep(350);
}

// ─── PvP result panel ─────────────────────────────────────────────────────────
function pvpResultPanel(
  winner: string,
  loser: string,
  winnerSide: "Heads" | "Tails",
  loserSide: "Heads" | "Tails",
  coinResult: "Heads" | "Tails",
  bet: number,
  payout: number,
): ContainerBuilder {
  return makeContainer(
    [
      text("## 🪙  Flip — Player vs Player"),

      separator(),

      // Bet + payout at the top.
      // No separator between these two lines.
      text(
        `💎 **Bet each**    \`${formatAmount(bet)}\`\n` +
        `💰 **Winner gets** \`${formatAmount(payout)}\``,
      ),

      separator(),

      // Result near the bottom.
      text(
        `🎲 **Coin landed**   \`${coinResult}\``,
      ),

      separator(),

      // Players at the end.
      text(
        `> 🏆 **${winner}** wins the flip!\n\n` +
        `${SIDE_ICON[winnerSide]} **${winner}**  \`${winnerSide}\`   vs   \`${loserSide}\`  **${loser}** ${SIDE_ICON[loserSide]}`,
      ),
    ],
    COLORS.gold,
  );
}

// ─── Command definition ───────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("flip")
  .setDescription(
    "Challenge another player to a coin flip — 1.9× payout to the winner!",
  )
  .addStringOption((o) =>
    o
      .setName("amount")
      .setDescription("Your bet (e.g. 1m, 2.5b, 500k)")
      .setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName("side")
      .setDescription("Your side of the coin")
      .setRequired(true)
      .addChoices(
        { name: "🟡 Heads", value: "Heads" },
        { name: "⚪ Tails", value: "Tails" },
      ),
  );

// ─── Command ──────────────────────────────────────────────────────────────────
export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({
    ephemeral: true,
  });

  const cfg = getServerConfig();

  if (!cfg || !cfg.flipChannelId) {
    return void interaction.editReply({
      components: [
        makeContainer(
          [
            text("## ❌ Flip"),
            separator(),
            text(
              "Flip channel not configured. Ask an admin to run `/setup`.",
            ),
          ],
          COLORS.danger,
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  const amountStr =
    interaction.options.getString("amount", true);

  const challengerSide =
    interaction.options.getString(
      "side",
      true,
    ) as "Heads" | "Tails";

  const amount = parseAmount(amountStr);

  if (!amount || amount < 1_000_000) {
    return void interaction.editReply({
      components: [
        makeContainer(
          [
            text("## ❌ Invalid Bet"),
            separator(),
            text("Minimum bet is **1M gems**."),
          ],
          COLORS.danger,
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  const user = await getOrCreateUser(
    interaction.user.id,
    interaction.user.username,
  );

  if (user.balance < amount) {
    return void interaction.editReply({
      components: [
        makeContainer(
          [
            text("## ❌ Insufficient Balance"),
            separator(),
            text(
              `You have **${formatAmount(user.balance)} 💎**.`,
            ),
          ],
          COLORS.danger,
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  if (pendingFlips.has(interaction.user.id)) {
    return void interaction.editReply({
      components: [
        makeContainer(
          [
            text("## ❌ Open Flip Challenge"),
            separator(),
            text(
              "You already have an open flip challenge. Wait for it to be accepted or expire.",
            ),
          ],
          COLORS.danger,
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  await addBalance(interaction.user.id, -amount);

  const guild = interaction.guild!;

  const channel = await guild.channels
    .fetch(cfg.flipChannelId)
    .catch(() => null) as TextChannel | null;

  if (!channel) {
    await addBalance(interaction.user.id, amount);

    return void interaction.editReply({
      components: [
        makeContainer(
          [
            text("## ❌ Flip"),
            separator(),
            text(
              "Flip channel not found. Ask an admin to re-run `/setup`.",
            ),
          ],
          COLORS.danger,
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  const msg = await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [
      challengePanel(
        interaction.user.username,
        challengerSide,
        amount,
        "open",
      ),
      challengeRow(interaction.user.id),
    ],
  });

  const challenge: FlipChallenge = {
    challengerId: interaction.user.id,
    challengerName: interaction.user.username,
    challengerSide,
    bet: amount,
    channelMsgId: msg.id,
    createdAt: Date.now(),
  };

  pendingFlips.set(interaction.user.id, challenge);

  setTimeout(async () => {
    const still = pendingFlips.get(interaction.user.id);

    if (still && still.channelMsgId === msg.id) {
      pendingFlips.delete(interaction.user.id);

      await addBalance(
        interaction.user.id,
        amount,
      );

      await msg.edit({
        flags: MessageFlags.IsComponentsV2,
        components: [
          challengePanel(
            interaction.user.username,
            challengerSide,
            amount,
            "expired",
          ),
        ],
      }).catch(() => null);
    }
  }, 10 * 60 * 1000);

  await interaction.editReply({
    components: [
      makeContainer(
        [
          text("## 🪙 Flip Challenge"),
          separator(),
          text(
            `✅ Flip challenge posted in <#${cfg.flipChannelId}>!`,
          ),
        ],
        COLORS.success,
      ),
    ],
    flags: MessageFlags.IsComponentsV2,
  });
}

// ─── Button: Join ─────────────────────────────────────────────────────────────
export async function handleJoin(
  interaction: ButtonInteraction,
  challengerId: string,
): Promise<void> {
  await interaction.deferUpdate();

  if (interaction.user.id === challengerId) {
    return void interaction.followUp({
      content: "❌ You can't join your own flip!",
      ephemeral: true,
    });
  }

  const challenge = pendingFlips.get(challengerId);

  if (!challenge) {
    return void interaction.editReply({
      components: [
        challengePanel(
          "?",
          "Heads",
          0,
          "expired",
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  const joiner = await getOrCreateUser(
    interaction.user.id,
    interaction.user.username,
  );

  if (joiner.balance < challenge.bet) {
    return void interaction.followUp({
      content:
        `❌ Insufficient balance. You need **${formatAmount(challenge.bet)} 💎** to join.`,
      ephemeral: true,
    });
  }

  await addBalance(
    interaction.user.id,
    -challenge.bet,
  );

  const challengerSide: "Heads" | "Tails" =
    challenge.challengerSide;

  const joinerSide: "Heads" | "Tails" =
    challengerSide === "Heads"
      ? "Tails"
      : "Heads";

  const coinResult: "Heads" | "Tails" =
    Math.random() < 0.5
      ? "Heads"
      : "Tails";

  const challengerWins =
    challengerSide === coinResult;

  const winnerId =
    challengerWins
      ? challengerId
      : interaction.user.id;

  const loserName =
    challengerWins
      ? interaction.user.username
      : challenge.challengerName;

  const winnerName =
    challengerWins
      ? challenge.challengerName
      : interaction.user.username;

  const winnerSide =
    challengerWins
      ? challengerSide
      : joinerSide;

  const loserSide =
    challengerWins
      ? joinerSide
      : challengerSide;

  const totalPot =
    challenge.bet * 2;

  const winnerGets =
    Math.floor(totalPot * 0.95);

  await addBalance(
    winnerId,
    winnerGets,
  );

  await recordBet(
    challengerId,
    challenge.bet,
    challengerWins
      ? winnerGets - challenge.bet
      : -challenge.bet,
    "flip",
  );

  await recordBet(
    interaction.user.id,
    challenge.bet,
    challengerWins
      ? -challenge.bet
      : winnerGets - challenge.bet,
    "flip",
  );

  pendingFlips.delete(challengerId);

  await animateFlip(
    interaction,
    "🪙  Flip — Player vs Player",
    challenge.challengerName,
    challengerSide,
    interaction.user.username,
    joinerSide,
    challenge.bet,
    coinResult,
  );

  await interaction.editReply({
    components: [
      pvpResultPanel(
        winnerName,
        loserName,
        winnerSide,
        loserSide,
        coinResult,
        challenge.bet,
        winnerGets,
      ),
    ],
    flags: MessageFlags.IsComponentsV2,
  });
}

// ─── Button: Call Bot ─────────────────────────────────────────────────────────
export async function handleCallBot(
  interaction: ButtonInteraction,
  challengerId: string,
): Promise<void> {
  await interaction.deferUpdate();

  const challenge =
    pendingFlips.get(challengerId);

  if (!challenge) {
    return void interaction.editReply({
      components: [
        challengePanel(
          "?",
          "Heads",
          0,
          "expired",
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  if (interaction.user.id !== challengerId) {
    return void interaction.followUp({
      content:
        "❌ Only the challenger can call the bot.",
      ephemeral: true,
    });
  }

  const won =
    Math.random() < WIN_CHANCE;

  const payout =
    Math.floor(
      challenge.bet * PAYOUT_MULT,
    );

  const playerSide: "Heads" | "Tails" =
    challenge.challengerSide;

  const botSide: "Heads" | "Tails" =
    playerSide === "Heads"
      ? "Tails"
      : "Heads";

  const coinResult: "Heads" | "Tails" =
    won
      ? playerSide
      : botSide;

  if (won) {
    await addBalance(
      challengerId,
      payout,
    );
  }

  await recordBet(
    challengerId,
    challenge.bet,
    won
      ? payout - challenge.bet
      : -challenge.bet,
    "flip",
  );

  pendingFlips.delete(
    challengerId,
  );

  await animateFlip(
    interaction,
    "🪙  Flip vs Bot",
    interaction.user.username,
    playerSide,
    "Bot",
    botSide,
    challenge.bet,
    coinResult,
  );

  // ─── Win result ────────────────────────────────────────────────────────────
  if (won) {
    const winPanel = makeContainer(
      [
        text("## 🪙  Flip vs Bot — You Win! 🎉"),

        separator(),

        // Bet and payout together, no divider between them.
        text(
          `💎 **Bet**     \`${formatAmount(challenge.bet)}\`\n` +
          `💰 **Payout**  \`${formatAmount(payout)}\``,
        ),

        separator(),

        text(
          `🎲 **Coin landed**  \`${coinResult}\``,
        ),

        separator(),

        text(
          `> 🏆 **You** win the flip!\n\n` +
          `${SIDE_ICON[playerSide]} **You**  \`${playerSide}\`   vs   \`${botSide}\`  **Bot** 🤖`,
        ),
      ],
      COLORS.success,
    );

    await interaction.editReply({
      components: [winPanel],
      flags: MessageFlags.IsComponentsV2,
    });

    return;
  }

  // ─── Loss result ───────────────────────────────────────────────────────────
  const lossPanel = makeContainer(
    [
      text("## 🪙  Flip vs Bot — You Lost"),

      separator(),

      text(
        `💎 **Bet**     \`${formatAmount(challenge.bet)}\``,
      ),

      separator(),

      text(
        `🎲 **Coin landed**  \`${coinResult}\``,
      ),

      separator(),

      text(
        `> 💥 **You** lost the flip.\n\n` +
        `${SIDE_ICON[playerSide]} **You**  \`${playerSide}\`   vs   \`${botSide}\`  **Bot** 🤖`,
      ),
    ],
    COLORS.danger,
  );

  await interaction.editReply({
    components: [lossPanel],
    flags: MessageFlags.IsComponentsV2,
  });
}