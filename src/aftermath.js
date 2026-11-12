// After a battle (src/battles.js), the people. Whoever went down on the player's side lies where they fell, and the
// medics come for them, their own first. Whoever went down on the other side lies there too, under the name the fight
// gave them (Mutineer #3), and the medics come for them after: carried to the medbay, treated with its medicine, and
// able to bleed to death like anyone, when they go up on the names as an unnamed mutineer. Once they're on their feet
// they're walked to the brig, where whoever gave up already is: the brig keeps them as a number, without names
// (src/command.js). What the battle costs aboard, morale and the council's confidence, is in the battle's file, and
// everyone who fought beside the player remembers it. What happens to the ship itself is for later.

import { roomOnDeck } from "./battles.js";
import { addWounds, beatenFor, downState, keyAt } from "./body.js";
import { commandOf, prisonersAt, prisonersState, rememberRequest, shakeConfidence } from "./command.js";
import { startBreach, startFire } from "./emergencies.js";
import { fallDown, hasADayAt } from "./medbay.js";
import { tellBattleEnding } from "./live-fight.js";
import { addClockWork, addRoomNote } from "./room-hooks.js";
import { airFlows, damagePart, systemsOf } from "./systems.js";
import { mapFor } from "./walk.js";

const nowHours = (game) => game.clock?.hours ?? 0;

// What everyone who fought beside the player remembers, and how much it counts for them.
const FOUGHT_BESIDE = { words: "fought beside you on deck 1 when the mutineers came", w: 8 };
// What the names on the bulkhead call someone from the other side who died: the fight's name was only ever a label.
export const UNNAMED = "An unnamed mutineer";
// However badly it went, a battle takes no more than this off morale at once.
const MOST_MORALE = 25;

const squareOf = (live) => ({ x: Math.round(live.x), y: Math.round(live.y) });
// The fight calls the first of a kind by the kind alone (Mutineer) and the rest by number (Mutineer #2); lying in the
// medbay or walked to the brig, the first is Mutineer #1, when there are others.
const numbered = (c, one) => (one.name === one.base && c.enemies.some((other) => other !== one && other.base === one.base) ? `${one.base} #1` : one.name);
const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const counted = (n) => NUMBERS[n] ?? String(n);
const upperFirst = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// The battle's over: called before the fight is put away (src/live-fight.js), so that the hours a player who went down
// spends on a cot are hours the medics spend on everyone. Returns lines for the story.
export function battleEnds(game, c, ground, ended) {
  const notes = [];
  const place = game.location;
  const level = ground.level.id;
  // The player's side first, so that whoever answers a call goes to their own before anyone else. (The fight itself lays
  // them down too, and finds them already lying there.)
  for (const one of c.allies) {
    const who = one.body?.who;
    if (one.hp > 0 || one.out || !who || !hasADayAt(place, who) || !one.live) continue;
    const at = squareOf(one.live);
    fallDown(game, { who, place, level, x: at.x, y: at.y, why: downState(one.wounds), hours: beatenFor() });
  }
  // The other side: the beaten lie where they fell, with the fight's name and the wounds the fight left; whoever gave up,
  // or was talked out of it, is taken to the brig. A machine is only broken.
  const prisoners = commandOf(place) ? prisonersState(game, place) : null;
  let taken = 0;
  for (const one of c.enemies) {
    if (one.machine) continue;
    if (one.hp > 0) {
      if (one.out) taken += 1;
      continue;
    }
    if (!one.live) continue;
    const who = numbered(c, one);
    const key = keyAt(place, who);
    addWounds(game, key, (one.wounds ?? []).filter((wound) => wound.fresh));
    // Their key has their name only in small letters, and a made-up body would pick its own species: the body's record
    // keeps the name and the species they fought as, for as long as they're down.
    game.bodies ??= {};
    game.bodies[key] = { wounds: [], ...game.bodies[key], name: who, species: one.body?.species ?? "human" };
    const at = squareOf(one.live);
    fallDown(game, { who, place, level, x: at.x, y: at.y, why: downState(one.wounds), hours: beatenFor() });
    if (prisoners && !prisoners.coming.includes(who)) prisoners.coming.push(who);
  }
  if (prisoners && taken) {
    prisoners.held += taken;
    notes.push(`[COMMAND] ${taken === 1 ? "The one who gave up is" : `The ${counted(taken)} who gave up are`} taken to the brig.`);
  }
  // Then the ship: what the battle leaves behind, as its file says.
  notes.push(...shipAfter(game, c, ground, ended));
  // What it costs aboard, as the battle's file says: more for each on the player's side who went down, and more again
  // if the player did.
  const youDown = ended === "defeat";
  const fallen = c.allies.filter((one) => one.hp <= 0).length;
  const morale = c.battle.morale;
  if (morale && game.ship) {
    const by = Math.min(MOST_MORALE, morale.base + morale.each * fallen + (youDown ? morale.you : 0));
    if (by > 0) {
      game.ship.morale = Math.max(0, Math.min(100, (game.ship.morale ?? 50) - by));
      notes.push(`[SHIP] Morale -${by}: ${c.battle.title}${fallen ? `, and ${counted(fallen)} of yours down` : ""}${youDown ? ", and you with them" : ""}.`);
    }
  }
  const confidence = c.battle.confidence;
  if (confidence && commandOf(place)) {
    const by = confidence.base + (youDown ? confidence.you : 0);
    if (by > 0) notes.push(`[COMMAND] The council's confidence in you falls to ${Math.round(shakeConfidence(game, place, -by))}.`);
  }
  // Everyone who fought beside the player remembers it: someone with a file by their id, anyone else by their name.
  for (const one of c.allies) {
    const key = one.body?.who ?? null;
    if (key) rememberRequest(game, key, "story", FOUGHT_BESIDE);
  }
  return notes;
}
tellBattleEnding(battleEnds);

// ---- The ship -----------------------------------------------------------------------------------------------------

// A number from 0 to n - 1 that's the same for the same game, battle, room and line, and different in the next game:
// which part in a room takes the shot.
function pickFor(game, key, n) {
  let hash = 2166136261;
  for (const char of `${game.bodySeed ?? 1}|${key}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % n;
}

// What the battle leaves behind on the ship, as the After it: lines in its file say (public/battle-text.js): a fire
// where the fighting was thickest (where the most fell, on either side) or in a room, a breach, a part in a room broken,
// or one part of the kinds named broken in every room where anyone went down. A line can be only if the player went
// down, or only if anyone went down in the room it names. Everything broken this way is "broken", which the engineers
// mend with a parts crate, as they do anything broken. Returns lines for the story.
function shipAfter(game, c, ground, ended) {
  const lines = c.battle.after ?? [];
  const place = game.location;
  const map = mapFor(place);
  const model = systemsOf(place);
  if (!lines.length || !map) return [];
  const deck = ground.level.id;
  const fell = new Map();
  for (const one of [...c.allies, ...c.enemies]) {
    if (one.hp > 0 || one.machine || !one.live) continue;
    const room = ground.level.roomAt?.(Math.round(one.live.x), Math.round(one.live.y));
    if (room && room !== deck) fell.set(room, (fell.get(room) ?? 0) + 1);
  }
  const rooms = [...fell.keys()].sort((a, b) => fell.get(b) - fell.get(a) || a.localeCompare(b));
  const thickest = rooms[0] ?? roomOnDeck(map, deck, c.battle.target)?.id ?? null;
  const youDown = ended === "defeat";
  const said = [];
  const broken = [];
  const works = (part) => !game.systems?.[place]?.parts?.[part.id]?.damage;
  const breakPart = (part) => {
    said.push(...damagePart(game, place, part.id, "broken", { by: "battle" }));
    broken.push(part);
  };
  const parts = Object.values(model?.parts ?? {});
  const roomOf = (line) => (line.thickest ? thickest : line.room ? roomOnDeck(map, deck, line.room)?.id ?? null : null);
  const holds = (line, room) => !(line.if === "you" && !youDown) && !(line.if === "there" && !(room && fell.has(room)));
  // What's broken first, in the order the lines are written.
  lines.forEach((line, index) => {
    if (line.what !== "broken") return;
    const room = roomOf(line);
    if (!holds(line, room)) return;
    if (line.every) {
      for (const at of rooms) {
        const choices = parts.filter((part) => part.room === at && line.kinds.includes(part.kind) && works(part));
        if (choices.length) breakPart(choices[pickFor(game, `${c.battle.id}|${at}|${index}`, choices.length)]);
      }
    } else if (room) {
      const part = parts.find((one) => one.room === room && one.kind === line.part && works(one));
      if (part) breakPart(part);
    }
  });
  // The engineers work through what the battle broke one thing at a time, in that order, rather than all at once: the
  // first is mended as soon as anything broken would be, and each after it a repair's time later.
  const now = nowHours(game);
  broken.forEach((part, k) => {
    const s = game.systems?.[place]?.parts?.[part.id];
    if (s?.fixAt !== undefined) s.fixAt = now + (s.fixAt - now) * (k + 1);
  });
  // Then the fires and breaches. A fire where the fighting was thickest is where the most fell, of the rooms that still
  // have air for it to burn: a room whose vent has lost its power starves a fire at once.
  lines.forEach((line) => {
    if (line.what === "broken") return;
    const room = line.thickest ? rooms.find((at) => airFlows(game, place, at)) ?? thickest : roomOf(line);
    if (!room || !holds(line, room)) return;
    if (line.what === "fire") said.push(...startFire(game, place, room));
    else if (line.what === "breach") said.push(...startBreach(game, place, room));
  });
  if (!broken.length) return said;
  // One line for what's broken, room by room, before what follows from it.
  const byRoom = new Map();
  for (const part of broken) byRoom.set(part.room, [...(byRoom.get(part.room) ?? []), `the ${part.name}`]);
  const words = [...byRoom].map(([room, names]) => `${listed(names)} in ${map.rooms?.[room]?.name ?? room}`);
  return [`[SYSTEMS] Broken in the fighting: ${words.join("; ")}.`, ...said];
}
const listed = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

// As time goes by, the beaten of the other side who are on their feet again are walked to the brig, and whoever died is
// counted, and goes up on the names as an unnamed mutineer. Returns lines for the story, for the place the player's at.
export function prisonersMove(game) {
  const notes = [];
  for (const [place, state] of Object.entries(game.command ?? {})) {
    const held = state?.prisoners;
    if (!held?.coming?.length) continue;
    const here = place === game.location;
    held.coming = held.coming.filter((who) => {
      const key = keyAt(place, who);
      if (game.dead?.[key]) {
        held.died = (held.died ?? 0) + 1;
        game.dead[key] = { ...game.dead[key], name: UNNAMED };
        return false;
      }
      const d = game.down?.[key];
      // Still lying there, being carried, on a cot or on the medbay's floor.
      if (d && !d.going) return true;
      // On their feet: not off to the medbay by themselves, but to the brig, under guard, where they're a number and
      // nothing more, their body's record with them.
      if (d) delete game.down[key];
      if (game.bodies?.[key]) delete game.bodies[key];
      held.held += 1;
      if (here) notes.push(`[COMMAND] ${who} is on their feet again, and is walked to the brig under guard.`);
      return false;
    });
  }
  return notes;
}
addClockWork(prisonersMove);

// The brig says who's held there: how many of the other side, and how many more are to come.
addRoomNote((game, place, room) => {
  const held = prisonersAt(game, place);
  if (!held || room !== commandOf(place)?.brig?.room) return null;
  const coming = held.coming?.length ?? 0;
  if (!held.held && !coming) return null;
  return [
    held.held ? `${held.held === 1 ? "One of the mutineers is" : `${upperFirst(counted(held.held))} of the mutineers are`} held here, without names, the red cloth still round their arms.` : null,
    coming ? `${coming === 1 ? `${held.held ? "Another is" : "One is"}` : `${upperFirst(counted(coming))} ${held.held ? "more " : ""}are`} to be brought here once they're on their feet.` : null,
  ].filter(Boolean).join(" ");
});
