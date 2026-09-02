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
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type Guild,
  type GuildMember,
  type PartialGuildMember,
} from "discord.js";
import { db, sqlite, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { formatAmount, setStarterLocked } from "./utils.js";
import { getServerConfig } from "./botConfig.js";

// ─── Commands ─────────────────────────────────────────────────────────────────
import * as balance       from "./commands/balance.js";
import * as tip           from "./commands/tip.js";
import * as rakeback      from "./commands/rakeback.js";
import * as affiliate     from "./commands/affiliate.js";
import * as afflist       from "./commands/afflist.js";
import * as mines         from "./commands/mines.js";
import * as towers        from "./commands/towers.js";
import * as rps           from "./commands/rps.js";
import * as coinflip      from "./commands/coinflip.js";
import * as dice          from "./commands/dice.js";
import * as blackjack     from "./commands/blackjack.js";
import * as pvpblackjack  from "./commands/pvpblackjack.js";
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
import * as link            from "./commands/link.js";
import * as change          from "./commands/change.js";
import * as invites         from "./commands/invites.js";
import * as cleardata       from "./commands/cleardata.js";
import { isFrozen, isGameDisabled } from "./botState.js";

// ─── Gambling commands (checked for freeze + disable) ─────────────────────────
const GAMBLING_COMMANDS = new Set([
  "mines","towers","rps","coinflip","blackjack","wheel","slots","roulette",
  "crash","scratchcard","chickencrossing","colordice","dice","upgrader","keno","flip","hilo",
  "pvpblackjack",
]);

function isExpiredInteractionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 10062
  );
}

const commands    = [balance, tip, rakeback, affiliate, afflist, mines, towers, rps, coinflip, dice, blackjack, pvpblackjack, setup, deposit, withdraw, addbalance, removebalance, wheel, slots, hilo, roulette, crash, scratchcard, chickencrossing, colordice, upgrader, keno, flip, createcode, redeem, viewcodes, leaderboard, history, resetstats, simulate, freeze, gamedisable, stats, economy, addadminperms, rain, link, change, invites, cleardata];
const commandData = commands.map((cmd) => cmd.data.toJSON());

// ─── Client ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
  ],
});

// Keep gateway failures visible in WispByte's console. Without these handlers,
// a connection/authentication problem can look like a successful HTTP-only
// startup because the web server starts before Discord finishes logging in.
client.on(Events.Error, (err) => {
  logger.error({ err }, "Discord client error");
});
client.on(Events.Warn, (message) => {
  logger.warn({ message }, "Discord client warning");
});
client.on(Events.ShardError, (err, shardId) => {
  logger.error({ err, shardId }, "Discord gateway shard error");
});

// ─── Interaction routing ──────────────────────────────────────────────────────
async function handleInteraction(interaction: Interaction) {
  // ── Slash commands ──
  if (interaction.isChatInputCommand()) {
    const name = interaction.commandName;
    try {
      if (name === "balance")       return await balance.execute(interaction);
      if (name === "tip")           return await tip.execute(interaction);
      if (name === "rakeback")      return await rakeback.execute(interaction);
      if (name === "affiliate")     return await affiliate.execute(interaction);
      if (name === "afflist")       return await afflist.execute(interaction);
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
      if (name === "dice")          return await dice.execute(interaction);
      if (name === "blackjack")     return await blackjack.execute(interaction);
      if (name === "pvpblackjack")  return await pvpblackjack.execute(interaction);
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
      if (name === "link")             return await link.execute(interaction);
      if (name === "change")           return await change.execute(interaction);
      if (name === "invites")          return await invites.execute(interaction);
      if (name === "clear")            return await cleardata.execute(interaction);
    } catch (err) {
      if (isExpiredInteractionError(err)) {
        logger.warn({ command: name }, "Interaction expired before Discord acknowledged it");
        return;
      }
      logger.error({ err, command: name }, "Error executing command");
      const payload = { content: "❌ Something went wrong. Please try again.", ephemeral: true };
      try {
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch (replyError) {
        if (isExpiredInteractionError(replyError)) {
          logger.warn({ command: name }, "Interaction expired before the error response could be sent");
          return;
        }
        throw replyError;
      }
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
      if (id === "bj_split")  return await blackjack.handleSplit(bi);

      // PvP Blackjack
      if (id === "pvpbj_join")   return await pvpblackjack.handleJoin(bi);
      if (id === "pvpbj_bot")    return await pvpblackjack.handleCallBot(bi);
      if (id === "pvpbj_cancel") return await pvpblackjack.handleCancel(bi);
      if (id === "pvpbj_hit")    return await pvpblackjack.handleHit(bi);
      if (id === "pvpbj_stand")  return await pvpblackjack.handleStand(bi);

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

      // Roblox account linking
      if (id.startsWith("roblox_phrase_")) return await link.handlePhrase(bi, id.slice("roblox_phrase_".length));
      if (id.startsWith("roblox_verify_")) return await link.handleVerify(bi, id.slice("roblox_verify_".length));

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
      if (id.startsWith("setup_wiz_")) return await setup.handleWizardButton(bi, id);

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
      if (id.startsWith("lb_prev_") || id.startsWith("lb_next_")) {
        const next = id.startsWith("lb_next_");
        const parts = id.slice(next ? "lb_next_".length : "lb_prev_".length).split("_");
        const page = parseInt(parts.pop()!, 10);
        const category = parts.join("_") as "gems" | "profit" | "wager" | "tipped" | "withdrawn" | "deposited";
        return await leaderboard.handlePage(bi, category, next ? page + 1 : page - 1);
      }

      // Reset stats
      if (id.startsWith("rs_apply_"))  return await resetstats.handleApply(bi, id.slice("rs_apply_".length));
      if (id.startsWith("rs_cancel_")) return await resetstats.handleCancel(bi, id.slice("rs_cancel_".length));

      // Clear all data
      if (id.startsWith("clear_data_confirm_")) return await cleardata.handleConfirm(bi);
      if (id.startsWith("clear_data_cancel_"))  return await cleardata.handleCancel(bi);

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

      // Balance — Advanced Stats  (format: bal_adv_<targetUserId>_<commandRunnerId>)
      if (id.startsWith("bal_adv_")) {
        const rest            = id.slice("bal_adv_".length);
        const lastUs          = rest.lastIndexOf("_");
        const targetUserId    = rest.slice(0, lastUs);
        const commandRunnerId = rest.slice(lastUs + 1);
        return await balance.handleAdvancedStats(bi, targetUserId, commandRunnerId);
      }

      // Rain
      if (id === "rain_join") return await rain.handleJoin(bi);
      if (id === "rakeback_claim") return await rakeback.handleClaim(bi);

    } catch (err) {
      if (isExpiredInteractionError(err)) {
        logger.warn({ buttonId: id }, "Button interaction expired before Discord acknowledged it");
        return;
      }
      logger.error({ err, buttonId: id }, "Error handling button");
      if (!bi.replied && !bi.deferred) {
        try {
          await bi.reply({ content: "❌ Something went wrong.", ephemeral: true });
        } catch (replyError) {
          if (isExpiredInteractionError(replyError)) {
            logger.warn({ buttonId: id }, "Button interaction expired before the error response could be sent");
            return;
          }
          throw replyError;
        }
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
      if (isExpiredInteractionError(err)) {
        logger.warn({ selectId: si.customId }, "Select interaction expired before Discord acknowledged it");
        return;
      }
      logger.error({ err, selectId: si.customId }, "Error handling user select menu");
      if (!si.replied && !si.deferred) {
        try {
          await si.reply({ content: "❌ Something went wrong.", ephemeral: true });
        } catch (replyError) {
          if (isExpiredInteractionError(replyError)) {
            logger.warn({ selectId: si.customId }, "Select interaction expired before the error response could be sent");
            return;
          }
          throw replyError;
        }
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
      if (isExpiredInteractionError(err)) {
        logger.warn({ selectId: id }, "Select interaction expired before Discord acknowledged it");
        return;
      }
      logger.error({ err, selectId: id }, "Error handling select menu");
      if (!si.replied && !si.deferred) {
        try {
          await si.reply({ content: "❌ Something went wrong.", ephemeral: true });
        } catch (replyError) {
          if (isExpiredInteractionError(replyError)) {
            logger.warn({ selectId: id }, "Select interaction expired before the error response could be sent");
            return;
          }
          throw replyError;
        }
      }
    }
    return;
  }

  // ── Setup channel/role selectors ──
  if (interaction.isChannelSelectMenu()) {
    const si = interaction as ChannelSelectMenuInteraction;
    if (si.customId.startsWith("setup_wiz_channel_")) {
      return await setup.handleWizardChannel(si, si.customId.slice("setup_wiz_channel_".length));
    }
  }
  if (interaction.isRoleSelectMenu()) {
    const si = interaction as RoleSelectMenuInteraction;
    if (si.customId.startsWith("setup_wiz_role_")) {
      return await setup.handleWizardRole(si, si.customId.slice("setup_wiz_role_".length));
    }
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

      if (id.startsWith("setup_wiz_roblox_modal_"))
        return await setup.handleWizardModal(mi, `roblox_${id.slice("setup_wiz_roblox_modal_".length)}`);

      if (id.startsWith("setup_wiz_optional_modal_"))
        return await setup.handleWizardModal(mi, `optional_${id.slice("setup_wiz_optional_modal_".length)}`);

      if (id.startsWith("rs_modal_"))
        return await resetstats.handleModal(mi, id.slice("rs_modal_".length));
    } catch (err) {
      if (isExpiredInteractionError(err)) {
        logger.warn({ modalId: id }, "Modal interaction expired before Discord acknowledged it");
        return;
      }
      logger.error({ err, modalId: id }, "Error handling modal");
      if (!mi.replied && !mi.deferred) {
        try {
          await mi.reply({ content: "❌ Something went wrong.", ephemeral: true });
        } catch (replyError) {
          if (isExpiredInteractionError(replyError)) {
            logger.warn({ modalId: id }, "Modal interaction expired before the error response could be sent");
            return;
          }
          throw replyError;
        }
      }
    }
  }
}

// ─── Welcome bonus ────────────────────────────────────────────────────────────
const WELCOME_BONUS = 10_000_000; // 10m
const inviteSnapshots = new Map<string, Map<string, number>>();

async function cacheGuildInvites(guild: Guild) {
  try {
    const invites = await guild.invites.fetch();
    inviteSnapshots.set(guild.id, new Map(invites.map((invite) => [invite.code, invite.uses ?? 0])));
  } catch (err) {
    logger.warn({ err, guildId: guild.id }, "Could not cache guild invites");
  }
}

async function handleNewMember(member: GuildMember) {
  const userId   = member.id;
  const username = member.user.username;
  const cfg = getServerConfig();

  // ── Welcome bonus (only for first-time joins) ─────────────────────────────
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (existing.length > 0) {
    sqlite
      .prepare("UPDATE invite_log SET left_server = 2 WHERE invited_id = ? AND left_server = 1")
      .run(userId);
    logger.info({ userId, username }, "Returning member joined — no bonus awarded");
    return;
  }

  const welcomeBonus = Math.max(0, cfg?.starterBalance ?? WELCOME_BONUS);
  await db.insert(usersTable).values({
    id: userId,
    username,
    balance: welcomeBonus,
  });
  if (welcomeBonus > 0 && (cfg?.lockStarterBalance ?? true)) {
    await setStarterLocked(userId, welcomeBonus);
  }

  if (cfg?.unverifiedRoleId) await member.roles.add(cfg.unverifiedRoleId).catch(() => null);

  try {
    const before = inviteSnapshots.get(member.guild.id) ?? new Map<string, number>();
    const current = await member.guild.invites.fetch();
    const used = current.find((invite) => (invite.uses ?? 0) > (before.get(invite.code) ?? 0));
    if (used?.inviter?.id) {
      sqlite
        .prepare(
          "INSERT INTO invite_log (inviter_id, invited_id, invite_code, account_created_at) VALUES (?, ?, ?, ?)",
        )
        .run(used.inviter.id, userId, used.code, Math.floor(member.user.createdTimestamp / 1000));
    }
    inviteSnapshots.set(member.guild.id, new Map(current.map((invite) => [invite.code, invite.uses ?? 0])));
  } catch (err) {
    logger.warn({ err, guildId: member.guild.id }, "Could not record invite join");
  }

  try {
    if (welcomeBonus > 0) {
      await member.send(
        `👋 Welcome to the server! You've received a **${formatAmount(welcomeBonus)}** welcome bonus. Use \`/balance\` to check your balance!`,
      );
    }
  } catch {
    // User may have DMs disabled
  }
}

async function handleMemberLeave(member: GuildMember | PartialGuildMember) {
  sqlite
    .prepare("UPDATE invite_log SET left_server = 1 WHERE invited_id = ? AND left_server IN (0, 2)")
    .run(member.id);
}

async function handleMemberUpdate(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember | PartialGuildMember,
) {
  const cfg = getServerConfig();
  if (!cfg?.verifiedRoleId) return;
  if (!newMember.roles.cache.has(cfg.verifiedRoleId) || oldMember.roles.cache.has(cfg.verifiedRoleId)) return;

  sqlite
    .prepare(
      "UPDATE invite_log SET verified = 1, verified_at = ? WHERE invited_id = ? AND verified = 0 AND left_server = 0",
    )
    .run(Math.floor(Date.now() / 1000), newMember.id);
  if (cfg.unverifiedRoleId) await newMember.roles.remove(cfg.unverifiedRoleId).catch(() => null);
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
    await Promise.all([...c.guilds.cache.values()].map((guild) => cacheGuildInvites(guild)));

    try {
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
    } catch (err) {
      logger.error({ err }, "Failed to clear global commands");
    }

    const guilds = [...c.guilds.cache.values()];
    logger.info({ guildCount: guilds.length }, "Registering guild commands");

    if (guilds.length === 0) {
      logger.warn("Discord bot is ready but has no cached guilds; no guild commands were registered");
      return;
    }

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
    logger.info({ guildCount: guilds.length, commandCount: commandData.length }, "Guild command registration complete");
  });

  client.on(Events.InviteCreate, (invite) => {
    if (invite.guild) void cacheGuildInvites(invite.guild);
  });
  client.on(Events.InviteDelete, (invite) => {
    if (invite.guild) void cacheGuildInvites(invite.guild);
  });
  client.on(Events.GuildMemberRemove, (member) => {
    handleMemberLeave(member).catch((err) => logger.warn({ err, userId: member.id }, "Could not record member leave"));
  });
  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    handleMemberUpdate(oldMember, newMember).catch((err) => logger.warn({ err, userId: newMember.id }, "Could not process verified role"));
  });
  client.on(Events.GuildMemberAdd, (member: GuildMember) => {
    handleNewMember(member).catch((err) => {
      logger.error({ err, userId: member.id }, "Error handling new member join");
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction).catch((err) => {
      // A Discord interaction token is valid for only a few seconds. Every
      // routed handler already avoids a second reply for code 10062; keep the
      // final event-level guard quiet too so an expired interaction never
      // becomes a misleading "Unhandled interaction" console error.
      if (isExpiredInteractionError(err)) return;
      logger.error({ err }, "Unhandled interaction error");
    });
  });

  const loginTimeout = setTimeout(() => {
    logger.error(
      "Discord login did not complete within 60 seconds. Check the WispByte token, outbound network access, and Discord gateway status.",
    );
  }, 60_000);
  loginTimeout.unref();

  try {
    await client.login(token);
  } finally {
    clearTimeout(loginTimeout);
  }
}

/** Cleanly disconnect the Discord client (called during graceful shutdown). */
export async function destroyBot(): Promise<void> {
  await client.destroy();
}
