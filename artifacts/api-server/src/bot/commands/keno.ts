import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
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

// ─── Constants ────────────────────────────────────────────────────────────────
const GRID_SIZE  = 20;  // numbers 1-20 (5 action rows: 4 number rows + 1 control row)
const PICK_COUNT = 6;   // player picks 6, bot draws 6

const EASY_PAYOUTS: Record<number, number> = { 2: 1.5, 3: 2, 4: 5, 5: 20, 6: 50 };
const HARD_PAYOUTS: Record<number, number> = { 2: 3,   3: 10, 4: 40, 5: 100, 6: 200 };

function getPayouts(difficulty: string) {
  return difficulty === "hard" ? HARD_PAYOUTS : EASY_PAYOUTS;
}

function topPrize(difficulty: string): number {
  const p = getPayouts(difficulty);
  return Math.max(...Object.values(p));
}

function payoutLine(difficulty: string): string {
  return Object.entries(getPayouts(difficulty))
    .map(([hits, mult]) => `**${hits}** hits → **${mult}x**`)
    .join(" · ");
}

// ─── In-memory game state ─────────────────────────────────────────────────────
interface KenoState {
  userId:     string;
  bet:        number;
  difficulty: string;
  picks:      Set<number>;
}

const activeSessions = new Map<string, KenoState>();

// key: `${userId}_keno`
function sessionKey(userId: string) { return `${userId}_keno`; }

// ─── Grid rendering ───────────────────────────────────────────────────────────
type CellState = "none" | "picked" | "hit" | "miss" | "drawn";

function renderGrid(
  picks: Set<number>,
  drawn?: Set<number>,
): string {
  const rows: string[] = [];
  for (let row = 0; row < 4; row++) {
    const cells: string[] = [];
    for (let col = 0; col < 5; col++) {
      const n = row * 5 + col + 1;
      const isPicked = picks.has(n);
      const isDrawn  = drawn ? drawn.has(n) : false;

      let cell: string;
      const label = n < 10 ? ` ${n}` : `${n}`;

      if (drawn) {
        if (isPicked && isDrawn)  cell = `✅\`${label}\``; // hit
        else if (isPicked)        cell = `❌\`${label}\``; // miss (picked, not drawn)
        else if (isDrawn)         cell = `🔵\`${label}\``; // drawn, not picked
        else                      cell = `⬛\`${label}\``; // neither
      } else {
        cell = isPicked ? `🟦\`${label}\`` : `⬛\`${label}\``;
      }
      cells.push(cell);
    }
    rows.push(cells.join(" "));
  }
  return rows.join("\n");
}

// ─── Button rows ──────────────────────────────────────────────────────────────
function numberRows(picks: Set<number>): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  for (let row = 0; row < 4; row++) {
    const ar = new ActionRowBuilder<MessageActionRowComponentBuilder>();
    for (let col = 0; col < 5; col++) {
      const n = row * 5 + col + 1;
      const selected = picks.has(n);
      ar.addComponents(
        new ButtonBuilder()
          .setCustomId(`keno_num_${n}`)
          .setLabel(`${n}`)
          .setStyle(selected ? ButtonStyle.Primary : ButtonStyle.Secondary),
      );
    }
    rows.push(ar);
  }
  return rows;
}

function controlRow(picks: Set<number>, canDraw: boolean): ActionRowBuilder<MessageActionRowComponentBuilder> {
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

function playAgainRow(userId: string, bet: number, difficulty: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pa_keno_${userId}_${difficulty}_${bet}`)
      .setLabel("🔄 Play Again")
      .setStyle(ButtonStyle.Primary),
  );
}

// ─── Embed builders ───────────────────────────────────────────────────────────
function selectionEmbed(state: KenoState): EmbedBuilder {
  const picks = state.picks;
  const mode  = state.difficulty === "hard" ? "Hard" : "Easy";
  const grid  = renderGrid(picks);

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🎱  Keno")
    .addFields(
      { name: "💎 Bet",        value: `\`${formatAmount(state.bet)}\``,                       inline: true },
      { name: "🍀 Mode",       value: `\`${mode}\``,                                          inline: true },
      { name: "🔢 Numbers",    value: `\`${picks.size}/${PICK_COUNT}\``,                       inline: true },
      { name: "👑 Top prize",  value: `\`${topPrize(state.difficulty)}x\``,                   inline: true },
    )
    .setDescription(
      `📊 Payouts · ${payoutLine(state.difficulty)}\n\n${grid}\n\n` +
      (picks.size < PICK_COUNT ? `_Pick **${PICK_COUNT - picks.size}** more number(s) or use ✨ Quick Pick_` : `_Ready! Click 🎲 Draw to play._`),
    )
    .setTimestamp();
}

function resultEmbed(
  state:      KenoState,
  drawn:      Set<number>,
  hits:       number,
  payout:     number,
): EmbedBuilder {
  const payouts     = getPayouts(state.difficulty);
  const multiplier  = payouts[hits] ?? 0;
  const profit      = payout - state.bet;
  const won         = hits >= 2 && multiplier > 0;
  const mode        = state.difficulty === "hard" ? "Hard" : "Easy";
  const grid        = renderGrid(state.picks, drawn);
  const drawnList   = [...drawn].sort((a, b) => a - b).join(", ");

  return new EmbedBuilder()
    .setColor(won ? COLORS.success : COLORS.danger)
    .setTitle(won ? "🎱  Keno — YOU WON" : "🎱  Keno — No Win")
    .addFields(
      { name: "💎 Bet",         value: `\`${formatAmount(state.bet)}\``,                  inline: true },
      { name: "🍀 Mode",        value: `\`${mode}\``,                                     inline: true },
      { name: "🎯 Hits",        value: `\`${hits}/${PICK_COUNT}\``,                       inline: true },
      ...(won ? [
        { name: "✨ Multiplier",  value: `\`${multiplier}x\``,                             inline: true },
        { name: "💰 Payout",     value: `\`${formatAmount(payout)}\``,                    inline: true },
        { name: "📈 Profit",     value: `\`+${formatAmount(profit)}\``,                   inline: true },
      ] : []),
    )
    .setDescription(
      `**Winning numbers** ${drawnList}\n\n${grid}`,
    )
    .setTimestamp();
}

// ─── Draw logic ───────────────────────────────────────────────────────────────
function drawNumbers(): Set<number> {
  const pool = Array.from({ length: GRID_SIZE }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return new Set(pool.slice(0, PICK_COUNT));
}

// ─── Command definition ───────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("keno")
  .setDescription("Pick numbers and match the draw — big multipliers await!")
  .addStringOption((o) =>
    o.setName("amount").setDescription("Bet amount (e.g. 1m, 2.5b, 500k)").setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName("difficulty")
      .setDescription("Easy (max 50x) or Hard (max 200x)")
      .setRequired(true)
      .addChoices(
        { name: "🍀 Easy  — max 50x",   value: "easy" },
        { name: "🔥 Hard  — max 200x",  value: "hard" },
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const amountStr  = interaction.options.getString("amount", true);
  const difficulty = interaction.options.getString("difficulty", true);
  const amount     = parseAmount(amountStr);

  if (!amount || amount < 1_000_000) {
    return void interaction.editReply({ embeds: [errorEmbed("Minimum bet is **1M gems**.")] });
  }

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  if (user.balance < amount) {
    return void interaction.editReply({
      embeds: [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
    });
  }

  // Deduct bet
  await addBalance(interaction.user.id, -amount);

  const key   = sessionKey(interaction.user.id);
  const state: KenoState = { userId: interaction.user.id, bet: amount, difficulty, picks: new Set() };
  activeSessions.set(key, state);

  await interaction.editReply({
    embeds:     [selectionEmbed(state)],
    components: [...numberRows(state.picks), controlRow(state.picks, false)],
  });
}

// ─── Shared: run the draw ─────────────────────────────────────────────────────
async function runDraw(interaction: ButtonInteraction, state: KenoState): Promise<void> {
  const drawn      = drawNumbers();
  const hits       = [...state.picks].filter((n) => drawn.has(n)).length;
  const payouts    = getPayouts(state.difficulty);
  const multiplier = payouts[hits] ?? 0;
  const payout     = hits >= 2 ? Math.floor(state.bet * multiplier) : 0;

  if (payout > 0) await addBalance(state.userId, payout);
  await recordBet(state.userId, state.bet, payout - state.bet);

  activeSessions.delete(sessionKey(state.userId));

  await interaction.update({
    embeds:     [resultEmbed(state, drawn, hits, payout)],
    components: [playAgainRow(state.userId, state.bet, state.difficulty)],
  });
}

// ─── Button: Toggle number ────────────────────────────────────────────────────
export async function handleNumber(interaction: ButtonInteraction, n: number): Promise<void> {
  const key   = sessionKey(interaction.user.id);
  const state = activeSessions.get(key);

  if (!state || state.userId !== interaction.user.id) {
    return void interaction.reply({ content: "❌ No active Keno session for you.", ephemeral: true });
  }

  if (state.picks.has(n)) {
    state.picks.delete(n);
  } else {
    if (state.picks.size >= PICK_COUNT) {
      return void interaction.reply({ content: `❌ You can only pick **${PICK_COUNT}** numbers.`, ephemeral: true });
    }
    state.picks.add(n);
  }

  const canDraw = state.picks.size === PICK_COUNT;
  await interaction.update({
    embeds:     [selectionEmbed(state)],
    components: [...numberRows(state.picks), controlRow(state.picks, canDraw)],
  });
}

// ─── Button: Quick Pick ───────────────────────────────────────────────────────
export async function handleQuickPick(interaction: ButtonInteraction): Promise<void> {
  const key   = sessionKey(interaction.user.id);
  const state = activeSessions.get(key);

  if (!state || state.userId !== interaction.user.id) {
    return void interaction.reply({ content: "❌ No active Keno session for you.", ephemeral: true });
  }

  // Fill remaining picks randomly
  const pool = Array.from({ length: GRID_SIZE }, (_, i) => i + 1).filter((n) => !state.picks.has(n));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const needed = PICK_COUNT - state.picks.size;
  pool.slice(0, needed).forEach((n) => state.picks.add(n));

  // Auto-draw immediately
  await runDraw(interaction, state);
}

// ─── Button: Clear ────────────────────────────────────────────────────────────
export async function handleClear(interaction: ButtonInteraction): Promise<void> {
  const key   = sessionKey(interaction.user.id);
  const state = activeSessions.get(key);

  if (!state || state.userId !== interaction.user.id) {
    return void interaction.reply({ content: "❌ No active Keno session for you.", ephemeral: true });
  }

  state.picks.clear();
  await interaction.update({
    embeds:     [selectionEmbed(state)],
    components: [...numberRows(state.picks), controlRow(state.picks, false)],
  });
}

// ─── Button: Draw ────────────────────────────────────────────────────────────
export async function handleDraw(interaction: ButtonInteraction): Promise<void> {
  const key   = sessionKey(interaction.user.id);
  const state = activeSessions.get(key);

  if (!state || state.userId !== interaction.user.id) {
    return void interaction.reply({ content: "❌ No active Keno session for you.", ephemeral: true });
  }

  if (state.picks.size < PICK_COUNT) {
    return void interaction.reply({
      content: `❌ You need to pick **${PICK_COUNT}** numbers first.`,
      ephemeral: true,
    });
  }

  await runDraw(interaction, state);
}

// ─── Button: Play Again ───────────────────────────────────────────────────────
export async function handlePlayAgain(
  interaction: ButtonInteraction,
  userId:      string,
  difficulty:  string,
  betStr:      string,
): Promise<void> {
  if (interaction.user.id !== userId) {
    return void interaction.reply({ content: "❌ This is not your game.", ephemeral: true });
  }

  await interaction.deferUpdate();

  const bet  = parseInt(betStr, 10);
  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);

  if (user.balance < bet) {
    return void interaction.editReply({
      embeds:     [errorEmbed(`Insufficient balance. You have **${formatAmount(user.balance)} 💎**.`)],
      components: [],
    });
  }

  await addBalance(interaction.user.id, -bet);

  const key   = sessionKey(interaction.user.id);
  const state: KenoState = { userId: interaction.user.id, bet, difficulty, picks: new Set() };
  activeSessions.set(key, state);

  await interaction.editReply({
    embeds:     [selectionEmbed(state)],
    components: [...numberRows(state.picks), controlRow(state.picks, false)],
  });
}
