import fs from "node:fs";

const path = "attached_assets/index_10_1788122096145.mjs";
let bundle = fs.readFileSync(path, "utf8");
const pvpStart = bundle.indexOf("// src/bot/commands/pvpblackjack.ts");
const mainStart = bundle.indexOf("// src/bot/index.ts", pvpStart);
if (pvpStart < 0 || mainStart < 0) throw new Error("PvP module boundaries not found.");
let pvp = bundle.slice(pvpStart, mainStart);

if (!bundle.includes("globalThis.__pvpBlackjackRenderer")) {
  bundle = bundle.replace(
    "globalThis.__pvpDeps = { COLORS, addBalance, errorEmbed, formatAmount, getOrCreateUser, parseAmount, recordBet };\n",
    "globalThis.__pvpDeps = { COLORS, addBalance, errorEmbed, formatAmount, getOrCreateUser, parseAmount, recordBet };\n" +
      "globalThis.__pvpBlackjackRenderer = { drawCards, drawResultOverlay };\n",
  );
}

const imageStart = pvp.indexOf("  function pvpImage(");
const imageEnd = pvp.indexOf("  function imageFile", imageStart);
if (imageStart < 0 || imageEnd < 0) throw new Error("PvP image function not found.");
let image = pvp.slice(imageStart, imageEnd);
image = image.replaceAll("drawCards(ctx,", "globalThis.__pvpBlackjackRenderer.drawCards(ctx,");
image = image.replace(
  "overlay && drawResultOverlay(ctx, overlay), canvas.toBuffer(\"image/png\")",
  "overlay && (game.phase === \"finished\" ? drawPvpFinalResult(ctx, game) : globalThis.__pvpBlackjackRenderer.drawResultOverlay(ctx, overlay)), canvas.toBuffer(\"image/png\")",
);
const resultRenderer = String.raw`  function drawPvpFinalResult(ctx, game) {
    const creatorName = getNameById(game, game.creator.id);
    const opponentName = getNameById(game, game.opponent.id);
    const creatorScore = game.wins[game.creator.id] ?? 0;
    const opponentScore = game.wins[game.opponent.id] ?? 0;
    const winnerName = game.winnerId ? getNameById(game, game.winnerId) + " WINS" : "PUSH";
    const scoreText = creatorName + "  " + creatorScore + "   \u2014   " + opponentScore + "  " + opponentName;
    ctx.save();
    ctx.fillStyle = "rgba(3, 12, 9, 0.94)";
    roundedRect(ctx, 65, 495, IMAGE_WIDTH - 130, 125, 20);
    ctx.strokeStyle = game.winnerId ? "#4ade80" : "#facc15";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(65, 495, IMAGE_WIDTH - 130, 125, 20);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = game.winnerId ? "#4ade80" : "#facc15";
    ctx.font = "900 30px Arial";
    ctx.fillText(winnerName, IMAGE_WIDTH / 2, 528);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 22px Arial";
    if (ctx.measureText(scoreText).width > IMAGE_WIDTH - 180) ctx.font = "700 17px Arial";
    ctx.fillText(scoreText, IMAGE_WIDTH / 2, 570);
    ctx.fillStyle = "#aebbd0";
    ctx.font = "italic 17px Arial";
    ctx.fillText("FINAL SCORE", IMAGE_WIDTH / 2, 602);
    ctx.restore();
  }

`;
pvp = pvp.slice(0, imageStart) + resultRenderer + image + pvp.slice(imageEnd);

const declarationStart = pvp.indexOf("    const tied = !game.winnerId");
const declarationEnd = pvp.indexOf("\n    return new ContainerBuilder", declarationStart);
if (declarationStart < 0 || declarationEnd < 0) throw new Error("Final panel declaration not found.");
const declaration = '    const tied = !game.winnerId, winnerMention = game.winnerId ? participantMention(getParticipant(game, game.winnerId)) : "Nobody", status = tied ? "PUSH" : `${winnerMention} WINS`, creatorStake = totalStake(game, game.creator), opponentStake = totalStake(game, game.opponent), score = `${participantMention(getParticipant(game, game.creator.id))} ${game.wins[game.creator.id] ?? 0} \u2014 ${game.wins[game.opponent.id] ?? 0} ${participantMention(getParticipant(game, game.opponent.id))}`, payoutText = tied ? "Each player was refunded their stake." : `\u{1F4B0} **Winner payout**  \`${formatAmount(game.payout)}\`  *(after ${formatAmount(game.tax)} tax)*`;';
pvp = pvp.slice(0, declarationStart) + declaration + pvp.slice(declarationEnd);
pvp = pvp.replace(/^\s*`\\u\{1F3E6\} \*\*Tax\*\*.*\n/m, "");
pvp = pvp.replace(
  '`${getNameById(game, game.winnerId)} wins the match`',
  '`${participantMention(getParticipant(game, game.winnerId))} wins the match`',
);

bundle = bundle.slice(0, pvpStart) + pvp + bundle.slice(mainStart);
fs.writeFileSync(path, bundle);