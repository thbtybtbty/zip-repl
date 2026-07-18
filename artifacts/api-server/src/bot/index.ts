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

const commands    = [balance, tip, mines, towers, rps, coinflip, blackjack];
const commandData = commands.map((cmd) => cmd.data.toJSON());

// ─── Client ───────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
  const token    = process.env["DISCORD_BOT_TOKEN"];
  const clientId = process.env["DISCORD_CLIENT_ID"];

  if (!token || !clientId) {
    logger.warn("DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID not set — Discord bot will not start");
    return;
  }

  const rest = new REST().setToken(token);

  client.once(Events.ClientReady, async (c) => {
    logger.info({ tag: c.user.tag }, "Discord bot ready");

    // Register as guild commands (instant) for every server the bot is in.
    // Global commands take up to 1 hour to propagate, so we always prefer guild registration.
    const guilds = [...c.guilds.cache.values()];
    await Promise.all(
      guilds.map(async (guild) => {
        try {
          await rest.put(Routes.applicationGuildCommands(clientId, guild.id), {
            body: commandData,
          });
          logger.info({ guildId: guild.id, guildName: guild.name, count: commandData.length }, "Guild commands registered");
        } catch (err) {
          logger.error({ err, guildId: guild.id }, "Failed to register guild commands");
        }
      }),
    );
  });

  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction).catch((err) => {
      logger.error({ err }, "Unhandled interaction error");
    });
  });

  await client.login(token);
}
