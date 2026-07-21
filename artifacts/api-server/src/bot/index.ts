import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  type Interaction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type GuildMember,
} from "discord.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { addBalance, formatAmount } from "./utils.js";

// ─── Commands ─────────────────────────────────────────────────────────────────
import * as balance       from "./commands/balance.js";
import * as tip           from "./commands/tip.js";
import * as mines         from "./commands/mines.js";
import * as towers        from "./commands/towers.js";
import * as rps           from "./commands/rps.js";
import * as coinflip      from "./commands/coinflip.js";
import * as blackjack     from "./commands/blackjack.js";
import * as setup         from "./commands/setup.js";
import * as deposit       from "./commands/deposit.js";
import * as withdraw      from "./commands/withdraw.js";
import * as addbalance    from "./commands/addbalance.js";
import * as removebalance from "./commands/removebalance.js";
import * as wheel         from "./commands/wheel.js";
import * as roulette      from "./commands/roulette.js";
import * as crash         from "./commands/crash.js";
import * as scratchcard   from "./commands/scratchcard.js";

const commands    = [balance, tip, mines, towers, rps, coinflip, blackjack, setup, deposit, withdraw, addbalance, removebalance, wheel, roulette, crash, scratchcard];
const commandData = commands.map((cmd) => cmd.data.toJSON());

// ─── Client ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ─── Interaction routing ──────────────────────────────────────────────────────
async function handleInteraction(interaction: Interaction) {
  // ── Slash commands ──
  if (interaction.isChatInputCommand()) {
    const name = interaction.commandName;
    try {
      if (name === "balance")       return await balance.execute(interaction);
      if (name === "tip")           return await tip.execute(interaction);
      if (name === "mines")         return await mines.execute(interaction);
      if (name === "towers")        return await towers.execute(interaction);
      if (name === "rps")           return await rps.execute(interaction);
      if (name === "coinflip")      return await coinflip.execute(interaction);
      if (name === "blackjack")     return await blackjack.execute(interaction);
      if (name === "setup")         return await setup.execute(interaction);
      if (name === "deposit")       return await deposit.execute(interaction);
      if (name === "withdraw")      return await withdraw.execute(interaction);
      if (name === "addbalance")    return await addbalance.execute(interaction);
      if (name === "removebalance") return await removebalance.execute(interaction);
      if (name === "wheel")         return await wheel.execute(interaction);
      if (name === "roulette")      return await roulette.execute(interaction);
      if (name === "crash")         return await crash.execute(interaction);
    } catch (err) {
      logger.error({ err, command: name }, "Error executing command");
      const payload = { content: "❌ Something went wrong. Please try again.", ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    }
    return;
  }

  // ── Buttons ──
  if (interaction.isButton()) {
    const bi = interaction as ButtonInteraction;
    const id = bi.customId;

    try {
      // Mines
      if (id.startsWith("mines_r_")) return await mines.handleReveal(bi, parseInt(id.slice(8), 10));
      if (id === "mines_cash")       return await mines.handleCashout(bi);

      // Towers
      if (id === "towers_l")    return await towers.handleChoice(bi, "l");
      if (id === "towers_m")    return await towers.handleChoice(bi, "m");
      if (id === "towers_r")    return await towers.handleChoice(bi, "r");
      if (id === "towers_cash") return await towers.handleCashout(bi);

      // Blackjack
      if (id === "bj_hit")    return await blackjack.handleHit(bi);
      if (id === "bj_stand")  return await blackjack.handleStand(bi);
      if (id === "bj_double") return await blackjack.handleDouble(bi);

      // Deposit (player side)
      if (id.startsWith("dep_sent_"))   return await deposit.handleSent(bi, id.slice("dep_sent_".length));
      if (id.startsWith("dep_cancel_")) return await deposit.handleCancel(bi, id.slice("dep_cancel_".length));

      // Deposit (mod side)
      if (id.startsWith("dep_approve_"))    return await deposit.handleApprove(bi, id.slice("dep_approve_".length));
      if (id.startsWith("dep_notapprove_")) return await deposit.handleNotApprove(bi, id.slice("dep_notapprove_".length));

      // Withdraw (player side)
      if (id.startsWith("with_confirm_")) return await withdraw.handleConfirm(bi, id.slice("with_confirm_".length));
      if (id.startsWith("with_cancel_"))  return await withdraw.handleCancel(bi, id.slice("with_cancel_".length));

      // Withdraw (mod side)
      if (id.startsWith("with_approve_"))    return await withdraw.handleApprove(bi, id.slice("with_approve_".length));
      if (id.startsWith("with_disapprove_")) return await withdraw.handleDisapprove(bi, id.slice("with_disapprove_".length));

      // Crash
      if (id.startsWith("crash_cashout_")) return await crash.handleCashout(bi, id.slice("crash_cashout_".length));

      // Play Again buttons
      if (id.startsWith("pa_wheel_")) {
        const [userId, bet] = id.slice("pa_wheel_".length).split("_");
        return await wheel.handlePlayAgain(bi, userId!, bet!);
      }
      if (id.startsWith("pa_crash_")) {
        const [userId, bet] = id.slice("pa_crash_".length).split("_");
        return await crash.handlePlayAgain(bi, userId!, bet!);
      }
      if (id.startsWith("pa_towers_")) {
        const parts = id.slice("pa_towers_".length).split("_");
        // format: userId_difficulty_bet  (userId is 18-digit snowflake, no underscores)
        const [userId, difficulty, bet] = parts;
        return await towers.handlePlayAgain(bi, userId!, difficulty!, bet!);
      }
      if (id.startsWith("pa_mines_")) {
        const parts = id.slice("pa_mines_".length).split("_");
        // format: userId_minesCount_bet
        const [userId, minesCount, bet] = parts;
        return await mines.handlePlayAgain(bi, userId!, minesCount!, bet!);
      }

      // Scratchcard
      if (id.startsWith("sc_reveal_")) {
        const parts = id.slice("sc_reveal_".length).split("_");
        // format: userId_bet_idx  (userId is 18-digit snowflake)
        const idx    = parseInt(parts.pop()!, 10);
        const bet    = parts.pop()!;
        const userId = parts.join("_");
        return await scratchcard.handleReveal(bi, userId, bet, idx);
      }
      if (id.startsWith("sc_all_")) {
        const rest   = id.slice("sc_all_".length);
        const lastUs = rest.lastIndexOf("_");
        const userId = rest.slice(0, lastUs);
        return await scratchcard.handleScratchAll(bi, userId);
      }

      // Setup confirmation
      if (id.startsWith("setup_confirm_")) return await setup.handleConfirm(bi, id.slice("setup_confirm_".length));
      if (id.startsWith("setup_cancel_"))  return await setup.handleCancelSetup(bi, id.slice("setup_cancel_".length));

      // Add balance (admin)
      if (id.startsWith("addbalnc_enter_"))  return await addbalance.handleEnter(bi, id.slice("addbalnc_enter_".length));
      if (id.startsWith("addbalnc_cancel_")) return await addbalance.handleCancelBtn(bi, id.slice("addbalnc_cancel_".length));

      // Remove balance (admin)
      if (id.startsWith("rembalnc_enter_"))  return await removebalance.handleEnter(bi, id.slice("rembalnc_enter_".length));
      if (id.startsWith("rembalnc_cancel_")) return await removebalance.handleCancelBtn(bi, id.slice("rembalnc_cancel_".length));

    } catch (err) {
      logger.error({ err, buttonId: id }, "Error handling button");
      if (!bi.replied && !bi.deferred) {
        await bi.reply({ content: "❌ Something went wrong.", ephemeral: true });
      }
    }
    return;
  }

  // ── Modal submissions ──
  if (interaction.isModalSubmit()) {
    const mi = interaction as ModalSubmitInteraction;
    const id = mi.customId;

    try {
      // Deposit: mod denied with reason
      if (id.startsWith("dep_notapprove_modal_"))
        return await deposit.handleNotApproveModal(mi, id.slice("dep_notapprove_modal_".length));

      // Withdraw: mod approved with note
      if (id.startsWith("with_approve_modal_"))
        return await withdraw.handleApproveModal(mi, id.slice("with_approve_modal_".length));

      // Withdraw: mod disapproved with reason
      if (id.startsWith("with_disapprove_modal_"))
        return await withdraw.handleDisapproveModal(mi, id.slice("with_disapprove_modal_".length));

      // Add balance: admin entered amount + reason
      if (id.startsWith("addbalnc_modal_"))
        return await addbalance.handleModal(mi, id.slice("addbalnc_modal_".length));

      // Remove balance: admin entered amount + reason
      if (id.startsWith("rembalnc_modal_"))
        return await removebalance.handleModal(mi, id.slice("rembalnc_modal_".length));

    } catch (err) {
      logger.error({ err, modalId: id }, "Error handling modal");
      if (!mi.replied && !mi.deferred) {
        await mi.reply({ content: "❌ Something went wrong.", ephemeral: true });
      }
    }
  }
}

// ─── Welcome bonus ────────────────────────────────────────────────────────────
const WELCOME_BONUS = 10_000_000; // 10m

async function handleNewMember(member: GuildMember) {
  const userId   = member.id;
  const username = member.user.username;

  // Check if this user already has a record (left and rejoined)
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (existing.length > 0) {
    logger.info({ userId, username }, "Returning member joined — no bonus awarded");
    return;
  }

  // Brand-new user: create their account with the welcome bonus
  await db.insert(usersTable).values({
    id: userId,
    username,
    balance: WELCOME_BONUS,
  });

  logger.info({ userId, username, bonus: WELCOME_BONUS }, "New member joined — welcome bonus awarded");

  // DM the user so they know
  try {
    await member.send(
      `👋 Welcome to the server! You've received a **${formatAmount(WELCOME_BONUS)}** welcome bonus. Use \`/balance\` to check your balance!`,
    );
  } catch {
    // User may have DMs disabled — not a critical failure
  }
}

// ─── Start bot ────────────────────────────────────────────────────────────────
export async function startBot() {
  const token    = process.env["DISCORD_BOT_TOKEN"];
  const clientId = process.env["DISCORD_CLIENT_ID"];

  if (!token || !clientId) {
    logger.warn("DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID not set — Discord bot will not start");
    return;
  }

  const rest = new REST().setToken(token);

  client.once(Events.ClientReady, async (c) => {
    logger.info({ tag: c.user.tag }, "Discord bot ready");

    // Clear global commands (no duplicates)
    try {
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
    } catch (err) {
      logger.error({ err }, "Failed to clear global commands");
    }

    // Register guild commands (instant propagation)
    const guilds = [...c.guilds.cache.values()];
    await Promise.all(
      guilds.map(async (guild) => {
        try {
          await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: commandData });
          logger.info({ guildId: guild.id, guildName: guild.name, count: commandData.length }, "Guild commands registered");
        } catch (err) {
          logger.error({ err, guildId: guild.id }, "Failed to register guild commands");
        }
      }),
    );
  });

  client.on(Events.GuildMemberAdd, (member: GuildMember) => {
    handleNewMember(member).catch((err) => {
      logger.error({ err, userId: member.id }, "Error handling new member join");
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction).catch((err) => {
      logger.error({ err }, "Unhandled interaction error");
    });
  });

  await client.login(token);
}

/** Cleanly disconnect the Discord client (called during graceful shutdown). */
export async function destroyBot(): Promise<void> {
  await client.destroy();
}
