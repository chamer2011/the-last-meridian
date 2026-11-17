// When the player goes down, other than in a fight. Chosen by the owner on 2026-11-16: the same things kill the player
// as kill the crew, and "you pass out first and are carried to the medbay like anyone, and die only when nobody
// reaches you in time". A lost fight is as it was: it ends on a cot (src/combat.js, src/medbay.js).
//
// What takes their legs: being out cold for want of air (src/no-air.js); and, where a medbay could have reached them,
// too little blood to stand, and the last hours before a wound gone bad would kill them; and aboard the Meridian the
// last hours before a fever nobody has dosed would (the wounds file's "you collapse" line says how many hours).
//
// Each time the clock has moved, this looks (through src/room-hooks.js, last of all). Once they're down the player
// can do nothing, so what follows is played through here, a few minutes at a go, until they can get up again or
// they're dead: whatever they were doing is over; a dressing of their own goes on what's killing them, if they carry
// one; at a place with a medbay whoever would answer a call for anyone comes for them (a nurse, then a spare hand,
// aboard the Meridian), unless a locked door is in the way, and half an hour later has them on a cot, where the
// medics treat them in their turn with what the cabinet has; at the dock the Meridian's at, her shuttle crew bring her
// own people across to her medbay; anywhere else they lie where they fell. The time goes by for everyone else as it
// would: repairs are finished, the air comes back or doesn't. Then they come round, and a line says where, how much
// later and who carried them; or they don't, and the game ends (src/ending.js).
//
// game.fell = { at, cause, place, room, said, call: { by, since }, bed, by, laidAt, from, help } while they're down:
// when and why (air, blood, infection, illness), where, and the line that said so; who's on their way; the cot or
// floor they were laid on, by whom and when; the dock the shuttle fetched them from; and the sentence for why nobody
// could help, which the ending quotes. It's gone once they're up. Reading any of it writes nothing.

import { bloodOf, breathing, collapseHours, deadlyHere, outForAir, playersKillers, tooWeakUnder, treatWound, woundRules, woundsNow } from "./body.js";
import { ITEMS, LOCATIONS } from "./data.js";
import { isOver } from "./ending.js";
import { cantTreatWhy, carrierName, helpForPlayer, layPlayerDown, medbayCalled, playerInMedbay, putDown, shuttleBringsAboard } from "./medbay.js";
import { onTheRounds } from "./role.js";
import { addAfterClock, dropExtras } from "./room-hooks.js";
import { passTime, removeItem, restedFor } from "./rules.js";
import { airBadIn, playerSpot } from "./systems.js";
import { closeTalk, mapFor, roomOf } from "./walk.js";

const YOU = "you";
const nowOf = (game) => game.clock?.hours ?? 0;
// From the call to the cot: a walk out and a walk back, as for anyone the medics fetch (src/medbay.js).
const CARRY_HOURS = 0.5;
// The time goes by this much at a go while they're down: finely until they're on a cot and while it's the air, more
// roughly once they're only lying there. A little over five minutes at the least, so that it's time gone by and not
// time played: nothing that only starts by chance in play (src/emergencies.js) starts while they're out.
const FINE_STEP = 6 / 60;
const COT_STEP = 0.25;
// Nothing here keeps anyone down this long. If it ever did, they get up, and aren't looked at again for a day.
const MOST_HOURS = 240;
const roomWords = (place, room) => (roomOf(mapFor(place), room)?.name ?? "").replace(/^The /, "the ");

// ---- Why they can't stand ---------------------------------------------------------------------------

// Why the player can't stand right now: "air", "blood", "infection" or "illness"; or null, and they can.
export function whyDown(game) {
  if (outForAir(game, YOU)) return "air";
  if (deadlyHere(game) && bloodOf(game, YOU) < tooWeakUnder()) return "blood";
  const next = playersKillers(game, { rounds: onTheRounds(game) })[0];
  return next && nowOf(game) >= next.at - collapseHours() ? next.cause : null;
}

// ---- Going down --------------------------------------------------------------------------------------

// The games whose player is being played through a fall right now: the time it passes mustn't start another.
const falling = new WeakSet();
export const isFalling = (game) => falling.has(game);

// Looked at each time the clock has moved. It returns lines for the story. Not in a fight, which has its own way of
// ending; and not with a skill check open, which is finished first, so that whatever it settles is settled (a pocket
// that was being picked, a part that was being worked on, a scene waiting on how it went).
export function playerFalls(game) {
  if (isOver(game) || falling.has(game) || game.combat || game.check) return [];
  if ((game.upUntil ?? 0) > nowOf(game)) return [];
  if (game.upUntil) delete game.upUntil;
  const cause = whyDown(game);
  if (!cause) return [];
  falling.add(game);
  try {
    return goDown(game, cause);
  } finally {
    falling.delete(game);
  }
}

// What a line says first, by what took their legs.
function fallLine(game, cause, room) {
  const there = room ? roomWords(game.location, room) : "";
  if (cause === "air") return `[AIR] There's no air left to breathe${there ? ` in ${there}` : ""}. Everything narrows to a point, and you go down.`;
  if (cause === "blood") return "[HEALTH] You've lost too much blood to stand. Your legs go from under you.";
  const killer = playersKillers(game, { rounds: onTheRounds(game) })[0]?.wound;
  if (cause === "infection") return `[HEALTH] ${upper(killer?.words ?? "the wound has gone bad")}, and it's had too long. You go down where you stand.`;
  return `[HEALTH] ${upper((killer?.words ?? "the fever").replace(/^an? /, "the "))} has had too long with nothing to dose it. You go down where you stand.`;
}
const upper = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// Something of the player's own that dresses a wound (a medkit, a bandage roll), or null.
const dressingOf = (game) => Object.keys(game.inventory ?? {}).find((id) => game.inventory[id] > 0 && ITEMS[id]?.type === "consumable" && ITEMS[id].effect?.dress) ?? null;
// What they carry goes on what's killing them: a dressing for each wound that bleeds, the worst first, or for the
// wound gone bad or the fever. It returns what was used on what: [{ item, word, wound }].
function ownDressings(game, cause) {
  const used = [];
  const wanting = () => {
    if (cause === "blood") return woundsNow(game, YOU).filter((wound) => !wound.dressed && woundRules(wound).bleeds).sort((a, b) => woundRules(b).bleeds - woundRules(a).bleeds);
    if (cause === "air") return [];
    return playersKillers(game, { rounds: onTheRounds(game) }).map((one) => one.wound);
  };
  for (let wound = wanting()[0]; wound; wound = wanting()[0]) {
    const id = dressingOf(game);
    if (!id) break;
    removeItem(game, id);
    used.push({ item: ITEMS[id].name, word: treatWound(game, YOU, wound, nowOf(game)), wound: wound.words });
  }
  return used;
}
const withArticle = (name) => (/^(a|an|the|some) /i.test(name) ? name.toLowerCase() : `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name.toLowerCase()}`);
// The line for one of them: in time, or as they went down.
const dressingLine = (one, when) => `[HEALTH] You get ${withArticle(one.item)} onto it ${when}: ${one.word} ${one.wound.replace(/^an? /, "the ").replace(/ has gone bad$/, ", which had gone bad")}.`;

// Whatever the player was in the middle of is over: a talk, a computer, someone in their arms.
function dropEverything(game) {
  const lines = [];
  if (game.talk) closeTalk(game);
  // A computer they were on (src/computer-use.js, through src/room-hooks.js): the session ends where it was.
  if (game.computer) dropExtras(game, "You don't log off. The screen is still lit when you go down.");
  if (game.computer) game.computer = null;
  if (game.carrying) putDown(game, { quiet: true });
  return lines;
}

function goDown(game, cause) {
  const notes = [];
  const began = nowOf(game);
  // A wound gone bad or a fever, and something in the pack for it: it goes on at the last, and they stay on their feet.
  if (cause === "infection" || cause === "illness") {
    const line = fallLine(game, cause, null).replace(/ You go down where you stand\.$/, "");
    const used = ownDressings(game, cause);
    if (used.length && !whyDown(game)) return [line.replace(/had too long/, "nearly had too long"), ...used.map((one) => dressingLine(one, "in time"))];
    notes.push(...used.map((one) => dressingLine(one, "at last")));
  }
  notes.push(...dropEverything(game));
  const room = playerSpot(game)?.room ?? null;
  // Whatever's wrong may have moved on in what was dropped (a computer's last minutes): it's looked at again.
  const now = whyDown(game) ?? cause;
  game.fell = { at: began, cause: now, place: game.location, room };
  // The line that says so is kept with the fall, for the ending to quote if it comes to that.
  game.fell.said = fallLine(game, now, room);
  notes.push(game.fell.said);
  if (now === "blood") notes.push(...ownDressings(game, now).map((one) => dressingLine(one, "as you go down")));
  while (!isOver(game) && nowOf(game) - began < MOST_HOURS) {
    const now = whyDown(game);
    if (!now) break;
    helpComes(game, now);
    const fell = game.fell;
    if (now === "air") breathesAgain(game);
    notes.push(...passTime(game, now === "air" || !fell.bed ? FINE_STEP : COT_STEP, "routine"));
  }
  if (isOver(game)) return notes;
  if (whyDown(game)) game.upUntil = nowOf(game) + 24;
  notes.push(...getUp(game, began));
  return notes;
}

// Out cold for want of air, somewhere whose air nobody's counting for them any more: fetched across to the ship from
// a dock, say, where the count stayed behind. If the air where they are now is fit to breathe, they come round from
// here on, as the air's own clock would have had it (src/no-air.js).
function breathesAgain(game) {
  if (game.systems?.[game.location]?.short?.[YOU] !== undefined) return;
  const room = playerSpot(game)?.room ?? null;
  if (!room || !airBadIn(game, game.location, room)) breathing(game, YOU, true, nowOf(game));
}

// Who comes, and where the player has got to: asked before each piece of the time they're down.
function helpComes(game, cause) {
  const fell = game.fell;
  const now = nowOf(game);
  if (fell.bed) {
    // On a cot: what's said if it isn't enough is why nobody there could treat them.
    fell.help = cause === "air" ? "They got you as far as a cot, and there was no air there either." : cause === "illness" ? null : cantTreatWhy(game);
    return;
  }
  if (fell.call) {
    if (now < fell.call.since + CARRY_HOURS - 1e-9) return;
    const bed = layPlayerDown(game);
    if (bed) Object.assign(fell, { bed, by: fell.call.by, laidAt: now, call: null, help: null });
    else Object.assign(fell, { call: null, shut: true, help: "There was a closed door between you and the medbay, and nobody could carry you through it." });
    return;
  }
  if (fell.shut) return;
  // Down in the medbay itself: whoever's there has them on a cot at once.
  if (playerInMedbay(game)) {
    const bed = layPlayerDown(game);
    if (bed) Object.assign(fell, { bed, by: null, laidAt: now, help: null });
    return;
  }
  const help = helpForPlayer(game, cause === "blood" ? "bleeding" : "fallen");
  if (help?.by) {
    Object.assign(fell, { call: { by: help.by, since: now }, help: null });
    return;
  }
  if (help) {
    fell.help = help.help;
    return;
  }
  // No medbay here. The Meridian's own, at the dock she's at, are fetched across to hers.
  const from = shuttleBringsAboard(game);
  if (from) {
    const bed = layPlayerDown(game);
    Object.assign(fell, { place: game.location, room: playerSpot(game)?.room ?? null, from, bed, by: null, laidAt: now, help: null });
    return;
  }
  fell.help = "There was no medbay there, and nobody to carry you to one.";
}

// How long they were out, in words.
function longWords(hours) {
  const minutes = Math.round(hours * 60);
  if (minutes < 50) return `${Math.max(5, Math.round(minutes / 5) * 5)} minutes`;
  if (hours < 1.75) return "an hour or so";
  if (hours < 36) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

// They can stand again: where they are, how much later, and who carried them.
function getUp(game, began) {
  const fell = game.fell ?? {};
  delete game.fell;
  const notes = [];
  // The time on the cot was rest, like any other.
  if (fell.laidAt !== undefined) notes.push(...restedFor(game, Math.max(0, nowOf(game) - fell.laidAt)));
  const later = `${longWords(nowOf(game) - began)} later`;
  const place = game.location;
  if (fell.bed) {
    const where = fell.bed.startsWith("@") ? `on the floor of ${medbayCalled(place)}, the cots all taken` : `on a cot in ${medbayCalled(place)}`;
    const who = fell.from ? ` The shuttle crew found you on ${LOCATIONS[fell.from]?.name ?? fell.from} and brought you back aboard.` : fell.by ? ` ${carrierName(game, fell.by)} carried you here.` : "";
    return [`[HEALTH] You come round ${where}, ${later}.${who}`, ...notes];
  }
  const why = fell.cause === "air" ? " There's air to breathe again." : "";
  return [`[HEALTH] You come round where you fell, ${later}.${why}${fell.help ? ` ${fell.help}` : ""}`, ...notes];
}

addAfterClock(playerFalls);
