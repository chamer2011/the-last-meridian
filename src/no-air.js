// People without air. Asked for on 2026-11-16, in the owner's words: "The other npcs should die if they don't have air
// too". Until then bad air only drove people out of a room and hurt the player.
//
// Everyone still gets out of bad air if there's anywhere to go (src/systems.js turns their day aside). Whoever can't is
// without air: someone lying where they fell, on a cot or on a floor in a room whose air has gone bad, and everyone at
// a place once it has no room left with good air to get to. Being without air is counted by the minute. After the
// wounds file's time (world/health/wounds.txt, "without air": each person their own, between its two times) they pass
// out where they are, and after its second time, still without air, they die of it. Carried somewhere they can
// breathe, or once the air's back, they come round a little later, and the time they went without is made up at the
// rate the file's "back in good air" line gives.
//
// What spares someone: getting out; being carried out, by the medics or the player; the air coming back in time;
// being at work the place's board or the medbay sent them to, since that isn't where their day has them (an engineer
// at a fire or a breach works in a mask); and belonging to a species the wounds file's "no air" line says it isn't
// for. Aboard the Meridian the people on the register (src/register.js) go the same way, by the quarters they sleep
// in, on paper: nobody on it is seen passing out, they're counted when they die.
//
// The player is counted too, since 2026-11-16, by the room they're standing or lying in: every minute of bad air
// there, whether or not they could have walked out of it, since where they stand is theirs to choose. They pass out
// when their own time is up, or sooner once the bad air has taken their health all the way down (src/systems.js takes
// it), and what follows is src/collapse.js: carried to a cot if anyone can come, on a mask there unless there's no
// air anywhere, and dead when their second time is up with nobody having got them out (src/ending.js).
//
// Nothing here runs unless a place's air is moving (src/systems.js calls it through src/room-hooks.js, for every
// stretch of time its air moves through: a few minutes at most aboard the ship, however long the wait). The counts
// are kept with the place's systems in the save, game.systems[place].short, by body key, and "quarters:" and a room
// for the register; game.systems[place].toll is what's happened out of the player's sight and hasn't been said yet.
// Reading any of it writes nothing.

import { addAirWork } from "./room-hooks.js";
import { airTimes, backInAir, breathing, deathOf, healthReadings, keyAt, nameOfKey, needsAir, outForAir, passOut, speciesNeedsAir } from "./body.js";
import { LOCATIONS } from "./data.js";
import { deathRulesOf, die } from "./death.js";
import { isOver, playerDies } from "./ending.js";
import { roomsByDay } from "./life.js";
import { fallDown, lyingRoom, medbayOf } from "./medbay.js";
import { registerDies, registerPeople } from "./register.js";
import { aboardShip } from "./role.js";
import { airBadIn, nowhereToBreathe, playerSpot, wayToGoodAir } from "./systems.js";
import { mapFor, roomOf, roomsOf } from "./walk.js";
import { WORLD_HEALTH } from "./world.js";
import { MEDBAY_KEYS } from "../public/health-text.js";

const YOU = "you";
const SHIP = "meridian";
// What the record of someone lying down says of why, for Look.
const WHY = "out cold, for want of air";
const QUARTERS = "quarters:";
// What happens out of the player's sight is said together, this often at most, in hours.
const SAID_EVERY = 0.25;
const lower = (text) => String(text ?? "").trim().toLowerCase();
const listOf = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);
// A room as a line says it: "the Long Mess", "Medbay".
const roomWords = (place, room) => (roomOf(mapFor(place), room)?.name ?? room).replace(/^The /, "the ");
const placeWords = (place) => (place === SHIP ? "aboard the Meridian" : `at ${LOCATIONS[place]?.name ?? place}`);

const NONE = Object.freeze([]);
// How many rooms a place has, kept for as long as its map stands.
const roomCounts = new WeakMap();
function roomCount(place) {
  const map = mapFor(place);
  if (!map) return 0;
  if (!roomCounts.has(map)) roomCounts.set(map, roomsOf(map).length);
  return roomCounts.get(map);
}
// Whether anyone's lying down at a place, alive and not on their way somewhere.
function lyingAt(game, place) {
  for (const key in game.down) {
    const d = game.down[key];
    if (d.place === place && !d.dead && !d.going) return true;
  }
  return false;
}
// Whether the player hears of what happens at a place: they're there, or it's the ship and she's theirs or beside them.
const hears = (game, place) => place === game.location || (place === SHIP && aboardShip(game));

// The places where there's nothing left to count: no room with air, nobody alive who breathes it, and the register
// past its last. Remembered against the list of rooms the air's own clock hands over while nothing changes, so that
// a dead ship, asked every few minutes for a year, is answered at once. Not kept in the save.
const finished = new WeakMap();
const isFinished = (game, place, stuck) => Boolean(stuck) && finished.get(game)?.get(place) === stuck;
function setFinished(game, place, stuck) {
  const mine = finished.get(game) ?? finished.set(game, new Map()).get(game);
  if (stuck) mine.set(place, stuck);
  else mine.delete(place);
}

// The places where everyone who could go short of air has died of it already, so nobody's looked for again while the
// place stays without air: a ship left dead for a year is asked every few minutes. Not kept in the save.
const emptied = new WeakMap();
const isEmptied = (game, place) => Boolean(emptied.get(game)?.has(place));
function setEmptied(game, place, yes) {
  if (yes) (emptied.get(game) ?? emptied.set(game, new Set()).get(game)).add(place);
  else emptied.get(game)?.delete(place);
}

// ---- The register's quarters ----------------------------------------------------------------------------

// The rooms the ship's register sleeps in, as the health file names them, each with its id on the map. Kept for as
// long as the map and the line stand, since it's asked for every few minutes.
const quartersKept = new WeakMap();
function quartersOf() {
  const text = WORLD_HEALTH[SHIP]?.quarters;
  const map = mapFor(SHIP);
  if (!text || !map) return [];
  const kept = quartersKept.get(map);
  if (kept?.text === text) return kept.rooms;
  const read = MEDBAY_KEYS.quarters.read(text);
  const all = roomsOf(map);
  const rooms = read.problem ? [] : read.rooms.map((one) => ({ name: one.room, id: all.find((room) => lower(room.name) === lower(one.room) || room.id === lower(one.room))?.id ?? null })).filter((one) => one.id);
  quartersKept.set(map, { text, rooms });
  return rooms;
}
// Everyone on the register by the quarters they sleep in, each with how many minutes without air kill them, the
// soonest first. Made once for a game's register and the file's times, since it's asked for every few minutes.
const lasting = new Map();
function registerLasts(game) {
  const reg = game.register;
  const key = `${game.bodySeed ?? 1}|${reg.size}|${healthReadings()}`;
  if (!lasting.has(key)) {
    if (lasting.size > 8) lasting.clear();
    const by = new Map();
    for (const person of registerPeople(game)) {
      if (!speciesNeedsAir(person.species)) continue;
      const times = airTimes(game, `register:${person.i}`);
      if (!by.has(person.quarters)) by.set(person.quarters, []);
      by.get(person.quarters).push({ i: person.i, after: times.out + times.dead });
    }
    for (const list of by.values()) list.sort((a, b) => a.after - b.after);
    lasting.set(key, by);
  }
  return lasting.get(key);
}

// ---- A stretch of time breathed --------------------------------------------------------------------------

// A place's air has moved on by so many minutes, up to an hour of the clock, and bad says how many of them each room's
// air was bad for. Whoever was without air in that time has it counted, passes out or dies when their time's up, and
// whoever can breathe again gets it back. It returns lines for the story.
export function breathe(game, place, { minutes, until, bad, trapped: stuck = null }) {
  const state = game.systems?.[place];
  if (!state) return NONE;
  // The player first, where they are: they're counted by their own room, whatever everyone else is doing.
  const mine = place === game.location && !isOver(game) ? playerBreathes(game, place, state, { minutes, until, bad, stuck }) : NONE;
  if (!bad.size && !state.short && !state.nowhere && !state.toll) return mine;
  if (isFinished(game, place, stuck)) return mine;
  // The rooms whose air is bad with nowhere better to get to: whoever's day has them there can't get out of it.
  const way = stuck ? null : wayToGoodAir(game, place);
  const trapped = new Set(stuck ?? [...bad.keys()].filter((room) => !way(room)));
  // Rooms without air that everyone's out of, nobody lying in them and nobody short of breath: nothing to count. A
  // ship with a dead breaker and no spare sits like this for months, and is asked every few minutes.
  if (!trapped.size && !state.short && !state.nowhere && !state.toll && !lyingAt(game, place)) return mine;
  const lines = [...mine];
  const short = (state.short ??= {});
  const back = backInAir().back;
  const told = hears(game, place);
  const here = place === game.location;
  const seenIn = here ? playerSpot(game)?.room ?? null : null;
  const toll = told ? (state.toll ??= { out: [], dead: 0, all: 0 }) : null;
  if (nowhereToBreathe(game, place, trapped.size > 0) && told) lines.push(`[AIR] There's no good air left anywhere ${placeWords(place)}. Nobody lasts more than a few hours like this.`);
  // Who was without air, and for how many of these minutes: whoever's lying in a room whose air was bad, and whoever's
  // day has them in one they can't get out of. Someone being carried is neither: nothing's counted for them until
  // they're laid down again.
  const without = new Map();
  const lying = new Set();
  const carried = new Set();
  for (const [key, d] of Object.entries(game.down ?? {})) {
    if (d.place !== place || d.dead || d.going || key === YOU) continue;
    lying.add(key);
    if (d.carriedBy) {
      carried.add(key);
      continue;
    }
    const room = lyingRoom(place, d);
    // Whoever the medics have laid on a cot, a floor or a bench is on a mask there, which only fails them once there's
    // nowhere left with good air: it's lying where they fell that leaves someone to the room's own air.
    if (room && bad.has(room) && (!d.bed || trapped.has(room))) without.set(key, { minutes: bad.get(room), room, who: d.who });
  }
  const everywhere = trapped.size > 0 && trapped.size >= roomCount(place);
  if (!everywhere) setEmptied(game, place, false);
  if (trapped.size && !isEmptied(game, place)) {
    let living = 0;
    for (const [who, at] of roomsByDay(game, place, until)) {
      const key = keyAt(place, who);
      if (deathOf(game, key) || !needsAir(game, key)) continue;
      living += 1;
      if (trapped.has(at.room) && !lying.has(key)) without.set(key, { minutes: bad.get(at.room), room: at.room, who });
    }
    if (everywhere && !living) setEmptied(game, place, true);
  }
  for (const key of new Set([...Object.keys(short), ...without.keys()])) {
    if (key.startsWith(QUARTERS) || carried.has(key) || key === YOU) continue;
    if (deathOf(game, key) || !needsAir(game, key)) {
      delete short[key];
      continue;
    }
    const gone = without.get(key);
    const had = short[key] ?? 0;
    // The most they'd gone without at any moment of this stretch, and what's left of it at its end: made up again,
    // faster than it went, for any of the stretch they could breathe in.
    const peak = had + (gone?.minutes ?? 0);
    const stillBad = Boolean(gone) && airBadIn(game, place, gone.room);
    const left = stillBad ? peak : Math.max(0, peak - (minutes - (gone?.minutes ?? 0)) * back);
    const times = airTimes(game, key);
    // When in this stretch a count was reached, as near as it can be told.
    const when = (count) => Math.max(until - minutes / 60, Math.min(until, until - (peak - count) / 60));
    if (gone && peak >= times.out + times.dead) {
      delete short[key];
      lines.push(...die(game, key, { at: when(times.out + times.dead), words: `suffocated in ${roomWords(place, gone.room)}`, from: "the air" }));
      continue;
    }
    if (gone && peak >= times.out && passOut(game, key, when(times.out))) {
      layDown(game, place, gone.who, key, here);
      // Seen where the player's standing; anywhere else, it's said with the rest in a while.
      if (here && seenIn === gone.room) lines.push(`[AIR] ${nameOfKey(game, key)} passes out, here in ${roomWords(place, gone.room)}: there's no air left to breathe.`);
      else toll?.out.push(nameOfKey(game, key));
    }
    // Someone out cold comes round a little after they can breathe again, and not while they still can't.
    if (outForAir(game, key)) breathing(game, key, !stillBad, until);
    if (left > 0) short[key] = Math.round(left * 100) / 100;
    else delete short[key];
  }
  const counting = place === SHIP && game.register && (trapped.size || Object.keys(short).some((key) => key.startsWith(QUARTERS))) ? registerBreathes(game, { minutes, until, bad, trapped, short, back, toll }) : false;
  // Nothing more can happen here until the air changes: nobody's left to count, on their feet, lying down or on paper.
  setFinished(game, place, everywhere && isEmptied(game, place) && !without.size && !counting && !toll?.out.length && !toll?.dead ? stuck : null);
  if (!Object.keys(short).length) delete state.short;
  // What happened out of sight, said together now and then, and at once when it's over.
  if (toll) {
    const pending = toll.out.length > 0 || toll.dead > 0;
    if (pending && (toll.at === undefined || until - toll.at >= SAID_EVERY || !trapped.size)) {
      if (toll.out.length) {
        const names = toll.out.length > 4 ? [...toll.out.slice(0, 3), `${toll.out.length - 3} more`] : toll.out;
        lines.push(`[AIR] Passed out for want of air, elsewhere ${placeWords(place)}: ${listOf(names)}.`);
      }
      if (toll.dead) lines.push(toll.all === toll.dead ? `[AIR] The people on the register are dying for want of air: ${toll.dead} of them so far.` : `[AIR] ${toll.dead} more of the people on the register have died for want of air. That's ${toll.all} of them.`);
      Object.assign(toll, { at: until, out: [], dead: 0 });
    }
    if (!trapped.size && !toll.out.length && !toll.dead) delete state.toll;
  }
  return lines;
}

// The player's own breath, over a stretch of a place's air: the minutes of it that were bad in the room they're in
// are counted, unless they're being carried (nothing's counted then, as for anyone) or have been laid in the medbay,
// where they're on a mask that only fails once there's nowhere left with good air. They pass out when their time's
// up, and sooner if the bad air has their health all the way down. Until their fall has been taken up
// (src/collapse.js, after this piece of the clock) the count stops there; after it, their second time kills them. It
// returns lines for the story.
const PICKED_UP = 0.25;
function playerBreathes(game, place, state, { minutes, until, bad, stuck }) {
  if (!needsAir(game, YOU)) {
    if (state.short?.[YOU] !== undefined) delete state.short[YOU];
    return NONE;
  }
  const had = state.short?.[YOU] ?? 0;
  const out = outForAir(game, YOU);
  if (!bad.size && !had && !out) return NONE;
  const fell = game.fell ?? null;
  // Picked up and on the way to a cot: nothing's counted until they're laid down.
  if (fell?.call && until >= fell.call.since + PICKED_UP) return NONE;
  const room = playerSpot(game)?.room ?? null;
  const nowhere = () => (stuck ? stuck.includes(room) : !wayToGoodAir(game, place)(room));
  const masked = Boolean(fell?.bed) && !nowhere();
  const gone = room && bad.has(room) && !masked ? bad.get(room) : 0;
  if (!gone && !had && !out) return NONE;
  const times = airTimes(game, YOU);
  let peak = had + gone;
  if (gone && game.hp <= 1) peak = Math.max(peak, times.out);
  if (!fell) peak = Math.min(peak, times.out);
  const when = (count) => Math.max(until - minutes / 60, Math.min(until, until - (peak - count) / 60));
  const short = (state.short ??= {});
  if (fell && gone && peak >= times.out + times.dead) {
    delete short[YOU];
    if (!Object.keys(short).length) delete state.short;
    return playerDies(game, { at: when(times.out + times.dead), cause: "air", room });
  }
  if (gone && peak >= times.out) passOut(game, YOU, when(times.out));
  const stillBad = gone > 0 && airBadIn(game, place, room);
  if (outForAir(game, YOU)) breathing(game, YOU, !stillBad, until);
  const left = stillBad ? peak : Math.max(0, peak - (minutes - gone) * backInAir().back);
  if (left > 0) short[YOU] = Math.round(left * 100) / 100;
  else delete short[YOU];
  if (!Object.keys(short).length) delete state.short;
  return NONE;
}

// Someone who's passed out lies where they are: on their square where the player's there to see it, and unseen at
// another place with a medbay, whose medics come for them as for anyone. Anywhere else they're laid down when the
// player next comes by (src/medbay.js lays down whoever can't stand).
function layDown(game, place, who, key, here) {
  if (game.down?.[key] || !who) return;
  const spot = here ? game.life?.places?.[place]?.[who] : null;
  if (spot) fallDown(game, { who, place, level: spot.level, x: spot.x, y: spot.y, why: WHY, stain: false });
  else if (!here && medbayOf(place)?.room) fallDown(game, { who, place, level: null, x: 0, y: 0, why: WHY, stain: false });
}

// The ship's register, by its quarters: while the room they sleep in has bad air and there's nowhere better aboard,
// the time's counted for all of them together, and each dies when their own time's up, the soonest first.
function registerBreathes(game, { minutes, until, bad, trapped, short, back, toll }) {
  const reg = game.register;
  const day = Math.floor(until / 24);
  let counting = false;
  for (const quarters of quartersOf()) {
    const key = `${QUARTERS}${quarters.id}`;
    const gone = trapped.has(quarters.id) ? bad.get(quarters.id) : 0;
    const had = short[key] ?? 0;
    if (!gone && !had) continue;
    const list = registerLasts(game).get(quarters.name) ?? [];
    // Past the time that kills the last of them there's nobody left to count for, so the count stops there.
    const most = list.at(-1)?.after ?? 0;
    const peak = Math.min(had + gone, Math.max(had, most + 1));
    const left = gone && airBadIn(game, SHIP, quarters.id) ? peak : Math.max(0, peak - (minutes - gone) * back);
    if (left > 0) short[key] = Math.round(left * 100) / 100;
    else delete short[key];
    if (!gone || had > most) continue;
    counting = true;
    let died = 0;
    for (const one of list) {
      if (one.after > peak) break;
      if (reg.dead[one.i]) continue;
      // Each is counted, with nothing said one by one: it's said together, with what the health file says a death on
      // the register costs for each.
      registerDies(game, one.i, "for want of air", day, { quiet: true });
      died += 1;
    }
    if (!died) continue;
    const cost = (deathRulesOf(SHIP)?.registerMorale ?? 0) * died;
    if (cost && game.ship) game.ship.morale = Math.max(0, Math.min(100, (game.ship.morale ?? 50) - cost));
    if (toll) Object.assign(toll, { dead: toll.dead + died, all: toll.all + died });
  }
  return counting;
}

addAirWork(breathe);
