import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  type Interaction,
  type ButtonInteraction,
} from "discord.js";
import { logger } from "../lib/logger.js";

// ─── Commands ─────────────────────────────────────────────────────────────────
import * as balance   from "./commands/balance.js";
import * as tip       from "./commands/tip.js";
import * as mines     from "./commands/mines.js";
import * as towers    from "./commands/towers.js";
import * as rps       from "./commands/rps.js";
import * as coinflip  from "./commands/coinflip.js";
import * as blackjack from "./commands/blackjack.js";

const commands = [balance, tip, mines, towers, rps, coinflip, blackjack];

// ─── Client ───────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ─── Register slash commands ──────────────────────────────────────────────────
async function registerCommands() {
  const token    = process.env["DISCORD_BOT_TOKEN"];
  const clientId = process.env["DISCORD_CLIENT_ID"];

  if (!token || !clientId) {
    logger.error("DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID is missing");
    return;
  }

  const rest = new REST().setToken(token);

  try {
    await rest.put(Routes.applicationCommands(clientId), {
      body: commands.map((cmd) => cmd.data.toJSON()),
    });
    logger.info({ count: commands.length }, "Discord slash commands registered");
  } catch (err) {
    logger.error({ err }, "Failed to register Discord slash commands");
  }
}

// ─── Interaction routing ──────────────────────────────────────────────────────
async function handleInteraction(interaction: Interaction) {
  // ── Slash commands ──
  if (interaction.isChatInputCommand()) {
    const name = interaction.commandName;
    try {
      if (name === "balance")   return await balance.execute(interaction);
      if (name === "tip")       return await tip.execute(interaction);
      if (name === "mines")     return await mines.execute(interaction);
      if (name === "towers")    return await towers.execute(interaction);
      if (name === "rps")       return await rps.execute(interaction);
      if (name === "coinflip")  return await coinflip.execute(interaction);
      if (name === "blackjack") return await blackjack.execute(interaction);
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
    } catch (err) {
      logger.error({ err, buttonId: id }, "Error handling button");
      if (!bi.replied && !bi.deferred) {
        await bi.reply({ content: "❌ Something went wrong.", ephemeral: true });
      }
    }
  }
}

// ─── Start bot ────────────────────────────────────────────────────────────────
export async function startBot() {
  const token = process.env["DISCORD_BOT_TOKEN"];

  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN not set — Discord bot will not start");
    return;
  }

  await registerCommands();

  client.once(Events.ClientReady, (c) => {
    logger.info({ tag: c.user.tag }, "Discord bot ready");
  });

  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction).catch((err) => {
      logger.error({ err }, "Unhandled interaction error");
    });
  });

  await client.login(token);
}
