// Keepsakes asked after (step 6 of the loot plan). A keepsake is an item whose file says keepsake: yes (a photograph, a
// ring, a harmonica). Taken from a container aboard the Meridian that's someone's in particular, it's missed: by
// whoever sleeps nearest it, for a container in a room people sleep in (world/law/meridian.txt says which), or by
// whoever holds the post a container belongs to (a desk on the Bridge is the first officer's). Some hours after it went,
// while the player still has it, they ask after it: the request whose about: line is "a keepsake you took"
// (world/scenes/request_keepsake.txt, played by src/requests.js), with {thing} for what's missing, {room} for where it
// was, and {container} for what it was in. Giving it back is the request done; putting it back where it was ends it too.
//
// game.keepsakes, made the first time a keepsake is taken from someone's container, so a new game's save is unchanged:
//   taken: by puts entry ("thing:meridian:<id>|<item>"), how many have been taken out of it, as last counted
//   list:  [{ item, from, owner, room, container, at, n, base, asked, over }]: what's missed and by whom, since when and
//          how many, how many the owner had been given before (so giving it back counts from there), whether they've
//          asked yet, and once it's over, how: "given" back, "put back" where it was, or its owner "dead"
//
// It registers itself with src/room-hooks.js; src/requests.js reads keepsakeTroubles.

import { addClockWork } from "./room-hooks.js";
import { seeded } from "./body.js";
import { YOU, holderKey, lostReason, stillAlive } from "./command.js";
import { ITEMS } from "./data.js";
import { containerOwner } from "./law.js";
import { sleepersOf } from "./life.js";
import { lootOf } from "./loot.js";
import { putsOf } from "./puts.js";
import { mapFor } from "./walk.js";

const SHIP = "meridian";
// The trouble's name in a request's about: line.
export const KEEPSAKE = "a keepsake you took";
// How long after it went the owner notices, in hours.
const NOTICED_AFTER = 8;
// Only so many that are over are kept, the latest.
const KEEP_OVER = 20;

const nowOf = (game) => game.clock?.hours ?? 0;
const roomOfSquare = (level, x, y) => (level?.areas?.length ? level.roomAt(x, y) : level?.id ?? null);

// What a container is, in a word or two for what's said: "locker", "desk", "footlocker".
export const containerWords = (name) => String(name ?? "").toLowerCase()
  .replace(/^(?:a|an|the)\s+/, "")
  .split(/\s+(?:with|in|on|under|for|from|at|by|behind|beside|near|of)\s+/)[0]
  .replace(/^\S+['’]s\s+/, "")
  .trim() || "locker";

// Whoever sleeps nearest a container in its room: a bed of someone's own before a row of shared ones as near, and
// among those that share, one picked by the game's seed, the same all game.
function nearestSleeper(game, place, level, thing) {
  const room = roomOfSquare(level, thing.x, thing.y);
  const near = [];
  for (const one of sleepersOf(place)) {
    const here = one.squares.filter((square) => square.level === level.id && roomOfSquare(level, square.x, square.y) === room);
    if (!here.length) continue;
    const far = Math.min(...here.map((square) => Math.hypot(square.x - thing.x, square.y - thing.y)));
    near.push({ key: one.key, far: Math.round(far * 100) / 100, beds: here.length });
  }
  if (!near.length) return null;
  near.sort((a, b) => a.far - b.far || a.beds - b.beds || String(a.key).localeCompare(String(b.key)));
  const best = near.filter((one) => one.far === near[0].far && one.beds === near[0].beds);
  return best[Math.floor(seeded(`${game.bodySeed ?? 1}|keepsake|${place}|${thing.id}`)() * best.length)].key;
}

// Whose a keepsake in a container is, if it's someone's in particular: whoever sleeps nearest it in a room people
// sleep in, or whoever holds the first post it belongs to. Null for the captain's own things, a port's holders', a
// job's, or anyone's.
export function keepsakeOwner(game, place, level, thing) {
  const owned = containerOwner(place, level, thing);
  if (!owned || owned.everyone) return null;
  const key = owned.sleepers ? nearestSleeper(game, place, level, thing) : (owned.posts ?? []).map((post) => holderKey(game, place, post)).find((one) => one && one !== YOU) ?? null;
  return key && key !== YOU ? key : null;
}

// A container's thing, by its id, on the ship: { level, thing }.
function containerAt(place, id) {
  for (const level of Object.values(mapFor(place)?.levels ?? {})) {
    const thing = level.things.find((one) => one.id === id);
    if (thing) return { level, thing };
  }
  return null;
}

function stateOf(game) {
  game.keepsakes ??= {};
  game.keepsakes.taken ??= {};
  game.keepsakes.list ??= [];
  return game.keepsakes;
}

// Something put back where it was taken from: the latest that are still missed from there are found again.
function putBack(state, from, item, n) {
  let left = n;
  for (const one of [...state.list].reverse()) {
    if (left <= 0) break;
    if (one.over || one.from !== from || one.item !== item) continue;
    const back = Math.min(left, one.n);
    one.n -= back;
    left -= back;
    if (one.n <= 0) one.over = "put back";
  }
}

// Each time the clock moves: what's been taken out of someone's container since it was last looked at is missed, what's
// been put back is found, and what's been given back to its owner, or whose owner has died, is over. What the player
// takes is already counted by src/puts.js, so this only reads those totals.
addClockWork((game) => {
  const prefix = `thing:${SHIP}:`;
  for (const [entry, total] of Object.entries(game.puts ?? {})) {
    if (!entry.startsWith(prefix)) continue;
    const [where, item] = entry.split("|");
    if (!ITEMS[item]?.keepsake) continue;
    const taken = Math.max(0, -total);
    const before = game.keepsakes?.taken?.[entry] ?? 0;
    if (taken === before) continue;
    const state = stateOf(game);
    state.taken[entry] = taken;
    if (taken < before) {
      putBack(state, where, item, before - taken);
      continue;
    }
    const found = containerAt(SHIP, where.slice(prefix.length));
    if (!found || !lootOf(SHIP, found.thing)) continue;
    const owner = keepsakeOwner(game, SHIP, found.level, found.thing);
    if (!owner) continue;
    const room = mapFor(SHIP)?.rooms?.[roomOfSquare(found.level, found.thing.x, found.thing.y)]?.name ?? null;
    state.list.push({ item, from: where, owner, room, container: containerWords(found.thing.name), at: nowOf(game), n: taken - before, base: putsOf(game, `give:${owner}`, item) });
  }
  const list = game.keepsakes?.list;
  if (!list?.length) return [];
  for (const one of list) {
    if (one.over) continue;
    if (putsOf(game, `give:${one.owner}`, one.item) - one.base >= one.n) one.over = "given";
    else if (!stillAlive(game, one.owner) || lostReason(game, SHIP, one.owner) === "dead") one.over = "dead";
    // Asked about, once a request about it is open: nobody asks twice about the same thing.
    else if (!one.asked && Object.values(game.requests?.open ?? {}).some((open) => open.about === one.owner && open.thing === one.item)) one.asked = true;
  }
  const over = list.filter((one) => one.over);
  if (over.length > KEEP_OVER) game.keepsakes.list = list.filter((one) => !one.over || over.indexOf(one) >= over.length - KEEP_OVER);
  return [];
});

// The troubles a request about a keepsake can be about, for src/requests.js: each thing still missed by someone alive
// and up, with the words for it. ask says whether it can be asked about now (noticed, not asked yet, and the player
// still has it); offer whether an ask that's waiting still stands (the player still has it).
export function keepsakeTroubles(game) {
  const now = nowOf(game);
  return (game.keepsakes?.list ?? [])
    .filter((one) => !one.over && stillAlive(game, one.owner) && !["dead", "down"].includes(lostReason(game, SHIP, one.owner)))
    .map((one) => {
      const carried = (game.inventory?.[one.item] ?? 0) > 0;
      return { asker: one.owner, about: one.owner, post: null, thing: one.item, room: one.room, container: one.container, ask: carried && !one.asked && now - one.at >= NOTICED_AFTER, offer: carried };
    });
}
