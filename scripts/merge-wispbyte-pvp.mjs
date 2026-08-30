import fs from "node:fs";

const targetPath = "attached_assets/index_(13)_1788109963690.mjs";
const sourcePath = "artifacts/api-server/dist/index.mjs";
let target = fs.readFileSync(targetPath, "utf8");
const source = fs.readFileSync(sourcePath, "utf8");

if (target.includes("var pvpblackjack_exports")) {
  throw new Error("The WispByte bundle already contains PvP Blackjack.");
}

const sourceStart = source.indexOf("// src/bot/commands/pvpblackjack.ts");
const sourceEnd = source.indexOf("// src/bot/commands/setup.ts", sourceStart);
if (sourceStart < 0 || sourceEnd < 0) {
  throw new Error("Could not locate the compiled PvP Blackjack module.");
}

let moduleText = source.slice(sourceStart, sourceEnd);
moduleText = moduleText.replace(
  'import { createCanvas as createCanvas3 } from "@napi-rs/canvas";\n',
  "",
);

const symbols = [
  ["gamesByMessage", "pvpGamesByMessage"],
  ["gameByUser", "pvpGameByUser"],
  ["RANKS2", "pvpRanks"],
  ["SUITS2", "pvpSuits"],
  ["IMAGE_WIDTH3", "pvpImageWidth"],
  ["IMAGE_HEIGHT3", "pvpImageHeight"],
  ["CARD_WIDTH2", "pvpCardWidth"],
  ["sleep4", "pvpSleep"],
  ["text5", "pvpText"],
  ["divider", "pvpDivider"],
  ["buildDeck2", "pvpBuildDeck"],
  ["shuffle3", "pvpShuffle"],
  ["deal2", "pvpDeal"],
  ["cardValue2", "pvpCardValue"],
  ["handValue2", "pvpHandValue"],
  ["isBlackjack2", "pvpIsBlackjack"],
  ["isBust2", "pvpIsBust"],
  ["participantName", "pvpParticipantName"],
  ["getParticipant", "pvpGetParticipant"],
  ["getNameById", "pvpGetNameById"],
  ["getDisplayName", "pvpGetDisplayName"],
  ["suitColor2", "pvpSuitColor"],
  ["roundedRect2", "pvpRoundedRect"],
  ["drawCard2", "pvpDrawCard"],
  ["drawHiddenCard2", "pvpDrawHiddenCard"],
  ["drawCards2", "pvpDrawCards"],
  ["drawOverlay", "pvpDrawOverlay"],
  ["pvpImage", "pvpRenderImage"],
  ["imageFile2", "pvpImageFile"],
  ["roleForRound", "pvpRoleForRound"],
  ["startRound", "pvpStartRound"],
  ["dealerPlay2", "pvpDealerPlay"],
  ["determineRoundStatus", "pvpDetermineRoundStatus"],
  ["roundWinnerId", "pvpRoundWinnerId"],
  ["roundResultText", "pvpRoundResultText"],
  ["resolveRound", "pvpResolveRound"],
  ["totalStake", "pvpTotalStake"],
  ["matchWinner", "pvpMatchWinner"],
  ["settleGame", "pvpSettleGame"],
  ["lobbyContainer", "pvpLobbyContainer"],
  ["activeContainer", "pvpActiveContainer"],
  ["finalContainer", "pvpFinalContainer"],
  ["cancelledContainer", "pvpCancelledContainer"],
  ["payload", "pvpPayload"],
  ["publish", "pvpPublish"],
  ["advanceRound", "pvpAdvanceRound"],
  ["runBotTurnIfNeeded", "pvpRunBotTurnIfNeeded"],
  ["replyEphemeral", "pvpReplyEphemeral"],
  ["getGame", "pvpGetGame"],
  ["canDouble", "pvpCanDouble"],
  ["data9", "pvpData"],
  ["execute9", "pvpExecute"],
  ["handleCallBot", "pvpHandleCallBot"],
  ["handleCancel", "pvpHandleCancel"],
  ["handleDouble2", "pvpHandleDouble"],
  ["handleHit2", "pvpHandleHit"],
  ["handleJoin", "pvpHandleJoin"],
  ["handleStand2", "pvpHandleStand"],
];

for (const [from, to] of symbols) {
  moduleText = moduleText.replace(new RegExp(`\\b${from}\\b`, "g"), to);
}
moduleText = moduleText.replace(
  /function pvpParticipantName\(participant\) \{[\s\S]*?\n\}/,
  'function pvpParticipantName(participant) {\n  return participant?.id ? `<@${participant.id}>` : participant?.displayName ?? "Unknown player";\n}',
);

const imageStart = moduleText.indexOf("function pvpRenderImage(");
const imageEnd = moduleText.indexOf("function pvpImageFile", imageStart);
if (imageStart < 0 || imageEnd < 0) {
  throw new Error("Could not locate the PvP image renderer.");
}
moduleText =
  moduleText.slice(0, imageStart) +
  `function pvpRenderImage(game, showDealerFull) {
  const round = game.round;
  const imageGame = {
    playerHand: round?.playerHand ?? [],
    dealerHand: round?.dealerHand ?? [],
    deck: round?.deck ?? [],
    bet: game.amount,
    doubled: false,
    displayName: "PvP Blackjack"
  };
  const status = round?.phase === "resolved" ? round.status : "active";
  return blackjackImage(imageGame, status, showDealerFull);
}
` +
  moduleText.slice(imageEnd);

moduleText = moduleText.replace(
  "  handleDouble: () => pvpHandleDouble,\n",
  "",
);
const doubleStart = moduleText.indexOf("async function pvpHandleDouble(");
if (doubleStart >= 0) {
  moduleText = moduleText.slice(0, doubleStart).trimEnd() + "\n";
}
moduleText = moduleText.replace(
  /  const pvpCanDouble = !player\.isBot && round\.playerHand\.length === 2;\n/,
  "",
);
const doubleButtonStart = moduleText.indexOf(
  ',\n        new import_discord_pvp.ButtonBuilder().setCustomId("pvpbj_double")',
);
if (doubleButtonStart >= 0) {
  const disabledStart = moduleText.indexOf(".setDisabled(!pvpCanDouble)", doubleButtonStart);
  const doubleButtonEnd = moduleText.indexOf(")", disabledStart) + 1;
  moduleText = moduleText.slice(0, doubleButtonStart) + moduleText.slice(doubleButtonEnd);
}
moduleText = moduleText.replaceAll("650", "900");

const setupMarker = "// src/bot/commands/setup.ts";
const insertionPoint = target.indexOf(setupMarker);
if (insertionPoint < 0) {
  throw new Error("Could not locate the setup module in the WispByte bundle.");
}
target = target.slice(0, insertionPoint) + moduleText + "\n" + target.slice(insertionPoint);

target = target.replace(
  '  "blackjack"\n',
  '  "blackjack",\n  "pvpblackjack"\n',
);
target = target.replace(
  "blackjack_exports, setup_exports",
  "blackjack_exports, pvpblackjack_exports, setup_exports",
);
target = target.replace(
  'if (name === "blackjack") return await execute8(interaction);',
  'if (name === "blackjack") return await execute8(interaction);\n      if (name === "pvpblackjack") return await pvpExecute(interaction);',
);
target = target.replace(
  'if (id === "bj_split") return await handleSplit(bi);',
  'if (id === "bj_split") return await handleSplit(bi);\n' +
    '      if (id === "pvpbj_join") return await pvpHandleJoin(bi);\n' +
    '      if (id === "pvpbj_bot") return await pvpHandleCallBot(bi);\n' +
    '      if (id === "pvpbj_cancel") return await pvpHandleCancel(bi);\n' +
    '      if (id === "pvpbj_hit") return await pvpHandleHit(bi);\n' +
    '      if (id === "pvpbj_stand") return await pvpHandleStand(bi);',
);

if (!target.includes('if (name === "pvpblackjack") return await pvpExecute(interaction);')) {
  throw new Error("PvP slash-command routing was not inserted.");
}
if (!target.includes('if (id === "pvpbj_stand") return await pvpHandleStand(bi);')) {
  throw new Error("PvP button routing was not inserted.");
}
if (target.includes("pvpbj_double") || target.includes("pvpHandleDouble")) {
  console.error("Remaining double-down references:", target.match(/.{0,100}(?:pvpbj_double|pvpHandleDouble).{0,140}/g));
  throw new Error("Double Down was not fully removed from PvP Blackjack.");
}

fs.writeFileSync(targetPath, target);