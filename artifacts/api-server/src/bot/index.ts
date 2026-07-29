import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  type Interaction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type GuildMember,
} from "discord.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { formatAmount } from "./utils.js";

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
import * as slots         from "./commands/slots.js";
import * as hilo          from "./commands/hilo.js";
import * as roulette      from "./commands/roulette.js";
import * as crash         from "./commands/crash.js";
import * as scratchcard      from "./commands/scratchcard.js";
import * as chickencrossing  from "./commands/chickencrossing.js";
import * as colordice        from "./commands/colordice.js";
import * as upgrader         from "./commands/upgrader.js";
import * as keno             from "./commands/keno.js";
import * as flip             from "./commands/flip.js";
import * as createcode       from "./commands/createcode.js";
import * as redeem           from "./commands/redeem.js";
import * as viewcodes        from "./commands/viewcodes.js";
import * as leaderboard      from "./commands/leaderboard.js";
import * as history         from "./commands/history.js";
import * as resetstats      from "./commands/resetstats.js";
import * as simulate        from "./commands/simulate.js";
import * as freeze          from "./commands/freeze.js";
import * as gamedisable     from "./commands/gamedisable.js";
import * as stats           from "./commands/stats.js";
import * as economy         from "./commands/economy.js";
import * as addadminperms   from "./commands/addadminperms.js";
import * as rain            from "./commands/rain.js";
import { isFrozen, isGameDisabled } from "./botState.js";

// ─── Gambling commands (checked for freeze + disable) ─────────────────────────
const GAMBLING_COMMANDS = new Set([
  "mines","towers","rps","coinflip","blackjack","wheel","slots","roulette",
  "crash","scratchcard","chickencrossing","colordice","upgrader","keno","flip","hilo",
]);

const commands    = [balance, tip, mines, towers, rps, coinflip, blackjack, setup, deposit, withdraw, addbalance, removebalance, wheel, slots, hilo, roulette, crash, scratchcard, chickencrossing, colordice, upgrader, keno, flip, createcode, redeem, viewcodes, leaderboard, history, resetstats, simulate, freeze, gamedisable, stats, economy, addadminperms, rain];
const commandData = commands.map((cmd) => cmd.data.toJSON());

// ─── Client ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// ─── Interaction routing ──────────────────────────────────────────────────────
async function handleInteraction(interaction: Interaction) {
  // ── Slash commands ──
  if (interaction.isChatInputCommand()) {
    const name = interaction.commandName;
    try {
      if (name === "balance")       return await balance.execute(interaction);
      if (name === "tip")           return await tip.execute(interaction);
      // ── Freeze / disabled guard for gambling commands ──
      if (GAMBLING_COMMANDS.has(name)) {
        if (isFrozen(interaction.user.id)) {
          return interaction.reply({
            embeds: [{ color: 0xed4245, description: "❌  You are **frozen** and cannot gamble or withdraw. Contact an admin." }],
            ephemeral: true,
          });
        }
        if (isGameDisabled(name)) {
          return interaction.reply({
            embeds: [{ color: 0xed4245, description: `❌  **${name.charAt(0).toUpperCase() + name.slice(1)}** is currently disabled. Try again later.` }],
            ephemeral: true,
          });
        }
      }

      if (name === "mines")         return await mines.execute(interaction);
      if (name === "towers")        return await towers.execute(interaction);
      if (name === "rps")           return await rps.execute(interaction);
      if (name === "coinflip")      return await coinflip.execute(interaction);
      if (name === "blackjack")     return await blackjack.execute(interaction);
      if (name === "setup")         return await setup.execute(interaction);
      if (name === "deposit")       return await deposit.execute(interaction);
      if (name === "withdraw") {
        if (isFrozen(interaction.user.id)) {
          return interaction.reply({
            embeds: [{ color: 0xed4245, description: "❌  You are **frozen** and cannot withdraw. Contact an admin." }],
            ephemeral: true,
          });
        }
        return await withdraw.execute(interaction);
      }
      if (name === "addbalance")    return await addbalance.execute(interaction);
      if (name === "removebalance") return await removebalance.execute(interaction);
      if (name === "wheel")         return await wheel.execute(interaction);
      if (name === "slots")         return await slots.execute(interaction);
      if (name === "hilo")          return await hilo.execute(interaction);
      if (name === "roulette")      return await roulette.execute(interaction);
      if (name === "crash")            return await crash.execute(interaction);
      if (name === "scratchcard")      return await scratchcard.execute(interaction);
      if (name === "chickencrossing")  return await chickencrossing.execute(interaction);
      if (name === "colordice")        return await colordice.execute(interaction);
      if (name === "upgrader")         return await upgrader.execute(interaction);
      if (name === "keno")             return await keno.execute(interaction);
      if (name === "flip")             return await flip.execute(interaction);
      if (name === "createcode")       return await createcode.execute(interaction);
      if (name === "redeem")           return await redeem.execute(interaction);
      if (name === "viewcodes")        return await viewcodes.execute(interaction);
      if (name === "leaderboard")      return await leaderboard.execute(interaction);
      if (name === "history")          return await history.execute(interaction);
      if (name === "resetstats")       return await resetstats.execute(interaction);
      if (name === "simulate")         return await simulate.execute(interaction);
      if (name === "freeze")           return await freeze.execute(interaction);
      if (name === "game")             return await gamedisable.execute(interaction);
      if (name === "stats")            return await stats.execute(interaction);
      if (name === "economy")          return await economy.execute(interaction);
      if (name === "addadminperms")    return await addadminperms.execute(interaction);
      if (name === "rain")             return await rain.execute(interaction);
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

      // Deposit (channel announcement)
      if (id.startsWith("dep_viewdetails_")) return await deposit.handleViewDetails(bi, id.slice("dep_viewdetails_".length));

      // Withdraw (player side)
      if (id.startsWith("with_confirm_")) return await withdraw.handleConfirm(bi, id.slice("with_confirm_".length));
      if (id.startsWith("with_cancel_"))  return await withdraw.handleCancel(bi, id.slice("with_cancel_".length));

      // Withdraw (mod side)
      if (id.startsWith("with_approve_"))    return await withdraw.handleApprove(bi, id.slice("with_approve_".length));
      if (id.startsWith("with_disapprove_")) return await withdraw.handleDisapprove(bi, id.slice("with_disapprove_".length));

      // Withdraw (channel announcement)
      if (id.startsWith("with_viewdetails_")) return await withdraw.handleViewDetails(bi, id.slice("with_viewdetails_".length));

      // Crash
      if (id.startsWith("crash_cashout_")) return await crash.handleCashout(bi, id.slice("crash_cashout_".length));

      // Play Again buttons
      if (id.startsWith("pa_bj_")) {
        const [userId, bet] = id.slice("pa_bj_".length).split("_");
        return await blackjack.handlePlayAgain(bi, userId!, bet!);
      }
      if (id.startsWith("pa_wheel_")) {
        const [userId, bet] = id.slice("pa_wheel_".length).split("_");
        return await wheel.handlePlayAgain(bi, userId!, bet!);
      }
      if (id.startsWith("pa_slots_")) {
        const [userId, bet] = id.slice("pa_slots_".length).split("_");
        return await slots.handlePlayAgain(bi, userId!, bet!);
      }
      if (id.startsWith("slots_payouts_")) {
        return await slots.handlePayouts(bi, id.slice("slots_payouts_".length));
      }
      if (id.startsWith("hilo_higher_")) return await hilo.handleGuess(bi, "higher");
      if (id.startsWith("hilo_lower_"))  return await hilo.handleGuess(bi, "lower");
      if (id.startsWith("hilo_cashout_")) return await hilo.handleCashout(bi);
      if (id.startsWith("pa_hilo_")) {
        const rest = id.slice("pa_hilo_".length);
        const lastUnderscore = rest.lastIndexOf("_");
        return await hilo.handlePlayAgain(
          bi,
          rest.slice(0, lastUnderscore),
          rest.slice(lastUnderscore + 1),
        );
      }
      if (id.startsWith("pa_crash_")) {
        const [userId, bet] = id.slice("pa_crash_".length).split("_");
        return await crash.handlePlayAgain(bi, userId!, bet!);
      }
      if (id.startsWith("pa_towers_")) {
        const parts = id.slice("pa_towers_".length).split("_");
        const [userId, difficulty, bet] = parts;
        return await towers.handlePlayAgain(bi, userId!, difficulty!, bet!);
      }
      if (id.startsWith("pa_mines_")) {
        const parts = id.slice("pa_mines_".length).split("_");
        const [userId, minesCount, bet] = parts;
        return await mines.handlePlayAgain(bi, userId!, minesCount!, bet!);
      }

      // Chicken Crossing
      if (id.startsWith("cc_fwd_"))  return await chickencrossing.handleForward(bi);
      if (id.startsWith("cc_cash_")) return await chickencrossing.handleCashout(bi);
      if (id.startsWith("pa_cc_")) {
        const rest = id.slice("pa_cc_".length);
        const lastUnderscore  = rest.lastIndexOf("_");
        const midUnderscore   = rest.lastIndexOf("_", lastUnderscore - 1);
        const userId          = rest.slice(0, midUnderscore);
        const difficulty      = rest.slice(midUnderscore + 1, lastUnderscore);
        const bet             = rest.slice(lastUnderscore + 1);
        return await chickencrossing.handlePlayAgain(bi, userId, difficulty, bet);
      }

      // Scratchcard
      if (id.startsWith("sc_reveal_")) {
        const parts = id.slice("sc_reveal_".length).split("_");
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
      if (id.startsWith("pa_sc_")) {
        const rest   = id.slice("pa_sc_".length);
        const lastUs = rest.lastIndexOf("_");
        const userId = rest.slice(0, lastUs);
        const bet    = rest.slice(lastUs + 1);
        return await scratchcard.handlePlayAgain(bi, userId, bet);
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

      // Keno — number toggle
      if (id.startsWith("keno_num_")) {
        const n = parseInt(id.slice("keno_num_".length), 10);
        return await keno.handleNumber(bi, n);
      }
      if (id === "keno_quick") return await keno.handleQuickPick(bi);
      if (id === "keno_clear") return await keno.handleClear(bi);
      if (id === "keno_draw")  return await keno.handleDraw(bi);
      if (id.startsWith("pa_keno_")) {
        const rest       = id.slice("pa_keno_".length);
        const lastUs     = rest.lastIndexOf("_");
        const midUs      = rest.lastIndexOf("_", lastUs - 1);
        const userId     = rest.slice(0, midUs);
        const difficulty = rest.slice(midUs + 1, lastUs);
        const bet        = rest.slice(lastUs + 1);
        return await keno.handlePlayAgain(bi, userId, difficulty, bet);
      }

      // Flip
      if (id.startsWith("flip_join_")) return await flip.handleJoin(bi, id.slice("flip_join_".length));
      if (id.startsWith("flip_bot_"))  return await flip.handleCallBot(bi, id.slice("flip_bot_".length));

      // View codes (admin)
      if (id.startsWith("vc_deactivate_")) return await viewcodes.handleDeactivate(bi, id.slice("vc_deactivate_".length));
      if (id === "vc_cancel")             return await viewcodes.handleCancel(bi);

      // History pagination
      if (id.startsWith("hist_prev_") || id.startsWith("hist_next_")) {
        const isNext = id.startsWith("hist_next_");
        const data   = id.slice(isNext ? "hist_next_".length : "hist_prev_".length);
        const parts  = data.split("_");
        const page   = parseInt(parts.pop()!, 10);
        const filter = parts.pop()!;
        const uid    = parts.join("_");
        return await history.handlePage(bi, uid, filter, isNext ? page + 1 : page - 1);
      }

      // Reset stats
      if (id.startsWith("rs_apply_"))  return await resetstats.handleApply(bi, id.slice("rs_apply_".length));
      if (id.startsWith("rs_cancel_")) return await resetstats.handleCancel(bi, id.slice("rs_cancel_".length));

      // Stats pagination
      if (id.startsWith("stats_prev_") || id.startsWith("stats_next_")) {
        const isNext = id.startsWith("stats_next_");
        const rest   = id.slice(isNext ? "stats_next_".length : "stats_prev_".length);
        const lastUs = rest.lastIndexOf("_");
        const filter = rest.slice(0, lastUs);
        const page   = parseInt(rest.slice(lastUs + 1), 10);
        return await stats.handlePage(bi, filter, isNext ? page + 1 : page - 1);
      }

      // Admin perms
      if (id === "aap_add")    return await addadminperms.handleAdd(bi);
      if (id === "aap_remove") return await addadminperms.handleRemove(bi);
      if (id === "aap_cancel") return await addadminperms.handleCancel(bi);

      // Balance — Advanced Stats
      if (id.startsWith("bal_adv_")) {
        const userId = id.slice("bal_adv_".length);
        return await balance.handleAdvancedStats(bi, userId);
      }

      // Rain
      if (id === "rain_join") return await rain.handleJoin(bi);

    } catch (err) {
      logger.error({ err, buttonId: id }, "Error handling button");
      if (!bi.replied && !bi.deferred) {
        await bi.reply({ content: "❌ Something went wrong.", ephemeral: true });
      }
    }
    return;
  }

  // ── User-select menus ──
  if (interaction.isUserSelectMenu()) {
    const si = interaction as UserSelectMenuInteraction;
    try {
      if (si.customId === "aap_user_select") return await addadminperms.handleUserSelect(si);
    } catch (err) {
      logger.error({ err, selectId: si.customId }, "Error handling user select menu");
      if (!si.replied && !si.deferred) {
        await si.reply({ content: "❌ Something went wrong.", ephemeral: true });
      }
    }
    return;
  }

  // ── String-select menus ──
  if (interaction.isStringSelectMenu()) {
    const si = interaction as StringSelectMenuInteraction;
    const id = si.customId;
    try {
      if (id.startsWith("cd_pick_"))           return await colordice.handleColorPick(si);
      if (id.startsWith("rs_pick_"))           return await resetstats.handlePick(si, id.slice("rs_pick_".length));
      if (id === "freeze_unfreeze_select")     return await freeze.handleUnfreezeSelect(si);
      if (id === "game_enable_select")         return await gamedisable.handleEnableSelect(si);
      if (id === "aap_remove_select")          return await addadminperms.handleRemoveSelect(si);
    } catch (err) {
      logger.error({ err, selectId: id }, "Error handling select menu");
      if (!si.replied && !si.deferred) {
        await si.reply({ content: "❌ Something went wrong.", ephemeral: true });
      }
    }
    return;
  }

  // ── Modal submissions ──
  if (interaction.isModalSubmit()) {
    const mi = interaction as ModalSubmitInteraction;
    const id = mi.customId;

    try {
      if (id.startsWith("dep_notapprove_modal_"))
        return await deposit.handleNotApproveModal(mi, id.slice("dep_notapprove_modal_".length));

      if (id.startsWith("with_approve_modal_"))
        return await withdraw.handleApproveModal(mi, id.slice("with_approve_modal_".length));

      if (id.startsWith("with_disapprove_modal_"))
        return await withdraw.handleDisapproveModal(mi, id.slice("with_disapprove_modal_".length));

      if (id.startsWith("addbalnc_modal_"))
        return await addbalance.handleModal(mi, id.slice("addbalnc_modal_".length));

      if (id.startsWith("rembalnc_modal_"))
        return await removebalance.handleModal(mi, id.slice("rembalnc_modal_".length));

      if (id.startsWith("rs_modal_"))
        return await resetstats.handleModal(mi, id.slice("rs_modal_".length));

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

  // ── Welcome bonus (only for first-time joins) ─────────────────────────────
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (existing.length > 0) {
    logger.info({ userId, username }, "Returning member joined — no bonus awarded");
    return;
  }

  await db.insert(usersTable).values({
    id: userId,
    username,
    balance: WELCOME_BONUS,
  });

  logger.info({ userId, username, bonus: WELCOME_BONUS }, "New member joined — welcome bonus awarded");

  try {
    await member.send(
      `👋 Welcome to the server! You've received a **${formatAmount(WELCOME_BONUS)}** welcome bonus. Use \`/balance\` to check your balance!`,
    );
  } catch {
    // User may have DMs disabled
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

    try {
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
    } catch (err) {
      logger.error({ err }, "Failed to clear global commands");
    }

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
