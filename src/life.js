// People living their days: sleeping, eating, working, and walking from room to room. This is the
// start of the world engine. It has no screens, and all it knows is
// what time it is and where everyone should be. The clock can move by a moment or by a year, and
// everyone ends up where their day says they should be, with or without the captain. Only the place
// the captain's in gets walked through step by step. Everywhere else, people are simply where their
// day says they are, whenever anyone looks, which is why this costs next to nothing.
//
// world/life/ has one file for each place whose people live their days, named after the place.

import { LOCATIONS } from "./data.js";
import { errandDetour, logisticsOf, mealWords } from "./logistics.js";
import { atPost, canStand, findPath, mapFor, roomOf, seedFrom } from "./walk.js";
import { detourFor, doorLocked, partSquares } from "./systems.js";
import { detourExtras } from "./room-hooks.js";
import { WORLD_LIFE } from "./world.js";
import { jobsOf, movedDays } from "./command.js";
import { bodyOf, hurtAt, keyAt, mendedByTechs, paceOf, queueOf } from "./body.js";
import { workshopDetour, workshopOf } from "./workshop.js";
import { followCarriers, laidWhereTheyAre, medbayDetour, medbayOf } from "./medbay.js";

const MINUTES_IN_A_DAY = 1440;
const SQUARES_A_MINUTE = 18;
// Over a gap longer than this, nobody's worth walking: they're just where they should be by now.
const LONG_GAP = 30;
const VARIES_BY = 6;
const ROUND_STOP = 20;
// How long the people the story brought together stay with the captain once the clock is running.
const COMPANY_STAYS = 20;

const STEPS = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const NO_ONE = new Set();
const seatKey = (spot) => `${spot.level}:${spot.x},${spot.y}`;

function toMinutes(text) {
  const [hours, minutes] = text.split(":").map(Number);
  return hours * 60 + minutes;
}

// ---- Reading the place's file ------------------------------------------------

function expandGroup(entries) {
  return entries.flatMap((entry) => {
    if (Array.isArray(entry)) return [{ level: entry[0], x: entry[1], y: entry[2] }];
    const row = [];
    for (let x = entry.from; x <= entry.to; x += entry.step ?? 1) row.push({ level: entry.level, x, y: entry.y });
    return row;
  });
}

function readLifeFile(file, map) {
  // A spot names a room, which can be one drawn on a deck: it's kept by the level the room is on, whose squares it's in.
  const levelOf = (id) => roomOf(map, id)?.levelId ?? id;
  const spots = Object.fromEntries(Object.entries(file.spots ?? {}).map(([name, [level, x, y, side]]) => [name, { level: levelOf(level), x, y, ...(side ? { side } : {}) }]));
  const groups = Object.fromEntries(Object.entries(file.groups ?? {}).map(([name, entries]) => [name, expandGroup(entries).map((spot) => ({ ...spot, level: levelOf(spot.level) }))]));
  // The place's stores (world/logistics) get a spot each, the square you stand on to reach one, so that an errand can
  // send someone there.
  for (const store of (map?.place && logisticsOf(map.place)?.stores) || []) {
    const level = map.levels[store.level];
    const thing = level?.things.find((one) => one.id === store.thing);
    const beside = thing && STEPS.map(([dx, dy]) => ({ x: thing.x + dx, y: thing.y + dy })).find((spot) => canStand(level, spot.x, spot.y));
    if (beside) spots[`store:${store.id}`] = { level: level.id, ...beside };
  }
  const roster = [
    ...Object.entries(file.people ?? {}).map(([id, day]) => ({ key: id, id, day, shift: 0 })),
    ...(file.crowd ?? []).flatMap((group) => group.names.map(([name, shift]) => ({ key: name, id: null, name, crowd: true, day: group.day, shift }))),
  ];
  return { spots, groups, roster };
}

const lifeFiles = new Map();

// A file with a mistake in it is skipped, so the people there just stay at their posts.
function lifeFileFor(place) {
  if (!lifeFiles.has(place)) {
    let file = null;
    try {
      if (WORLD_LIFE[place]) file = readLifeFile(WORLD_LIFE[place], mapFor(place));
    } catch (err) {
      console.error(`The days of the people at ${place} can't be used: ${err.message}`);
    }
    lifeFiles.set(place, file);
  }
  return lifeFiles.get(place);
}

// Read again after a place's systems change, since parts on the floor change where people can stand.
export function clearLife() {
  lifeFiles.clear();
  settledAt.clear();
  usual.clear();
}
// One place's, once the player has left it and its map is let go of (keepOnly in src/walk.js): read again with the map.
export function forgetLife(place) {
  lifeFiles.delete(place);
  for (const key of [...settledAt.keys()]) if (key.startsWith(`${place}@`)) settledAt.delete(key);
  for (const key of [...usual.keys()]) if (key.startsWith(`${place}/`)) usual.delete(key);
}

export const livesHere = (place) => Boolean(lifeFileFor(place) && mapFor(place));

// The roster as a game has it: each named person's day is the one their job on the ship's watch bill gives them
// (src/command.js), where that's been changed from the job their group in the file does; and someone in a post the
// game didn't begin them in has the day of whoever it began with, and goes to that one's place at the post (home).
// Kept until it changes again.
const rosters = new WeakMap();
const signatures = new WeakMap();
function rosterSignature(moved) {
  if (!moved) return "";
  if (!signatures.has(moved)) signatures.set(moved, Object.entries(moved).map(([key, one]) => `${key}=${one.job}`).join("|"));
  return signatures.get(moved);
}
function rosterFor(game, place) {
  const file = lifeFileFor(place);
  if (!file) return [];
  const moved = movedDays(game, place);
  if (!moved) return file.roster;
  const signature = rosterSignature(moved);
  const kept = rosters.get(game)?.[place];
  if (kept && kept.file === file && kept.signature === signature) return kept.roster;
  const roster = file.roster.map((entry) => (moved[entry.key] ? { ...entry, day: moved[entry.key].day, dayTag: moved[entry.key].job ?? "spare", home: moved[entry.key].home, plans: undefined } : entry));
  rosters.set(game, { ...(rosters.get(game) ?? {}), [place]: { file, signature, roster } });
  return roster;
}

// The places someone could be at: the one the player's at, then any whose days file names them, by id or by name in a
// crowd. Only those are looked at, so asking where someone is builds no place's map but those (src/walk.js keeps only
// the place the player's at built, and the ship).
const namedIn = (file, id) => Boolean(file?.people?.[id]) || (file?.crowd ?? []).some((group) => (group.names ?? []).some(([name]) => name === id));
const placesFor = (game, id) => [...new Set([game.location, ...Object.keys(WORLD_LIFE).filter((place) => namedIn(WORLD_LIFE[place], id))])];

// Someone with no day in the place's file just stays at their post.
export const hasADay = (place, id) => Boolean(lifeFileFor(place)?.roster.some((entry) => entry.id === id));

// ---- What someone's doing at a given time ---------------------------------------

// One person's day, with each thing starting a few minutes differently from one day to the next.
// It's kept with the person's entry in that place's file, because some people are in two files.
function dayOf(entry, day) {
  entry.plans ??= new Map();
  if (!entry.plans.has(day)) {
    if (entry.plans.size > 40) entry.plans.clear();
    const list = entry.day
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => !block.every || ((day % block.every) + block.every) % block.every === 0)
      .map(({ block, index }) => {
        const varies = block.exact ? 0 : (seedFrom(`${entry.key}/${day}/${index}`) % (VARIES_BY * 2 + 1)) - VARIES_BY;
        const start = (((toMinutes(block.at) + entry.shift + varies) % MINUTES_IN_A_DAY) + MINUTES_IN_A_DAY) % MINUTES_IN_A_DAY;
        return { block, index, start };
      })
      .sort((a, b) => a.start - b.start);
    entry.plans.set(day, list);
  }
  return entry.plans.get(day);
}

function planAt(entry, hours) {
  const day = Math.floor(hours / 24);
  const minute = (hours - day * 24) * 60;
  const current = dayOf(entry, day).filter((one) => one.start <= minute).at(-1);
  const startDay = current ? day : day - 1;
  const { block, index, start } = current ?? dayOf(entry, startDay).at(-1);
  const elapsed = minute + (current ? 0 : MINUTES_IN_A_DAY) - start;
  const stop = block.rounds ? Math.floor(elapsed / (block.stop ?? ROUND_STOP)) % block.rounds.length : 0;
  const where = block.rounds?.[stop] ?? block.go ?? block.pick?.[seedFrom(`${entry.key}/${startDay}/${index}/pick`) % block.pick.length];
  // Someone the watch bill has moved does their new job's day, whose steps are told apart from their old one's.
  return { key: `${entry.dayTag ? `${entry.dayTag}:` : ""}${startDay}.${index}.${stop}`, block, where };
}

// The room a plan sends someone to, so the place's systems can turn them aside: the guards to the alarm, an engineer
// to a repair, anyone headed into bad air somewhere better. detour comes from src/systems.js, and is null when
// nothing's going on.
function levelOfPlan(map, file, entry, plan) {
  const where = plan.where;
  if (!where) return null;
  if (where === "post") return postOf(map, entry.home ?? entry.id)?.level ?? null;
  if (/^[@>]/.test(where)) return where.slice(1);
  return file.spots[where]?.level ?? file.groups[where]?.[0]?.level ?? null;
}
function planFor(map, file, entry, hours, detour) {
  const plan = planAt(entry, hours);
  if (!detour) return plan;
  const turn = detour(entry.key, levelOfPlan(map, file, entry, plan), Boolean(plan.block.asleep));
  // A detour names a room, or a spot the file knows, such as the square beside one of the ship's stores.
  // A detour can also name a square itself, such as where someone fell, and lay them down there.
  const known = turn && (turn.spot ?? (/^[@>]/.test(turn.where) ? roomOf(map, turn.where.slice(1)) : file.spots[turn.where] ?? file.groups[turn.where]));
  return known ? { key: `systems:${turn.where}:${turn.doing}`, block: { doing: turn.doing, go: turn.where, ...(turn.asleep ? { asleep: true } : {}) }, where: turn.where, ...(turn.spot ? { spot: { level: turn.spot.level, x: turn.spot.x, y: turn.spot.y }, exact: Boolean(turn.exact) } : {}) } : plan;
}

// Everything that turns someone aside from their day: the place's systems first (the alarm, a repair, bad air), then
// the ship's errands, then the morning queue at the medbay. Null when nothing's going on.
function detoursFor(game, place) {
  // Whoever's down, and whoever's gone to help them, comes before anything else (src/medbay.js).
  const down = medbayDetour(game, place);
  const systems = detourFor(game, place);
  const errands = errandDetour(game, place);
  // Whoever's mending or building in the workshop (src/workshop.js).
  const workshop = workshopDetour(game, place);
  const queue = queueDetour(game, place);
  // And wherever the parts of the game that add to a room send someone (src/room-hooks.js): after someone down and
  // the place's systems, before the errands.
  const extras = detourExtras(game, place);
  if (!down && !systems && !extras && !errands && !workshop && !queue) return null;
  return (key, room, asleep) => down?.(key, room, asleep) ?? systems?.(key, room, asleep) ?? extras?.(key, room, asleep) ?? errands?.(key, room, asleep) ?? workshop?.(key, room, asleep) ?? queue?.(key, room, asleep) ?? null;
}

// In the morning, whoever's hurt and on their feet goes and waits at the medbay, as the place's health file says
// (src/body.js), unless they're asleep or laid up. Null outside its hours or where nobody's hurt.
function queueDetour(game, place) {
  const queue = queueOf(place);
  if (!queue) return null;
  // Nobody queues at a medbay whose door is locked.
  const medbay = medbayOf(place);
  if (medbay?.room && doorLocked(game, place, medbay.room)) return null;
  const minute = ((game.clock.hours % 24) + 24) % 24 * 60;
  if (minute < queue.from || minute >= queue.to) return null;
  const hurt = hurtAt(game, place);
  if (!hurt.size) return null;
  // A synthetic goes to the workshop to be mended instead, unless its door is locked (src/workshop.js).
  const shop = workshopOf(place);
  const toShop = shop?.room && !doorLocked(game, place, shop.room) ? shop.room : null;
  return (key, room, asleep) => {
    if (asleep || !hurt.has(key)) return null;
    if (mendedByTechs(game, keyAt(place, key))) return toShop ? { where: `@${toShop}`, doing: `waiting in ${shop.roomName.replace(/^The /, "the ")} to be mended` } : null;
    return { where: queue.at, doing: "waiting in the medbay queue" };
  };
}

// How fast each person at a place walks, as a share of the usual, from their body: a limp slows them, and a leg they
// can't stand on slows them more (src/body.js).
function pacesFor(game, place, roster) {
  const paces = new Map();
  for (const entry of roster) {
    const pace = paceOf(bodyOf(game, entry.id ? { id: entry.id } : { name: entry.name, place }));
    if (pace !== 1) paces.set(entry.key, pace);
  }
  return paces;
}

// The people of a place, for the ship's errands to name: their key in its file, their id if they're someone, and their
// crowd name otherwise. Read from the file as it is, since the logistics are compiled before the file is read in full.
export function rosterOf(place) {
  const file = WORLD_LIFE[place];
  if (!file) return [];
  return [
    ...Object.keys(file.people ?? {}).map((id) => ({ key: id, id, name: null })),
    ...(file.crowd ?? []).flatMap((group) => group.names.map(([name]) => ({ key: name, id: null, name }))),
  ];
}

// Where everyone at a place sleeps, as the place's file has it: each person's key, their id if they're someone, and
// the squares of the spots or groups their asleep steps go to (a spot is one bed, a group many shared ones). For
// src/keepsakes.js, which takes a locker in a room people sleep in to be whoever's bed is nearest it. The file's own
// days, not the watch bill's: a locker doesn't move when its owner's put to other work.
export function sleepersOf(place) {
  const file = lifeFileFor(place);
  if (!file) return [];
  return file.roster.map((entry) => {
    const squares = [];
    for (const block of entry.day ?? []) {
      if (!block.asleep) continue;
      for (const where of [block.go, ...(block.pick ?? [])].filter(Boolean)) {
        if (file.spots[where]) squares.push(file.spots[where]);
        else squares.push(...(file.groups[where] ?? []));
      }
    }
    return { key: entry.key, id: entry.id ?? null, squares };
  }).filter((one) => one.squares.length);
}

// Whether someone's awake and about at a time, as their day has it, and here at all.
export function isAbout(game, place, key, hours) {
  const entry = rosterFor(game, place).find((one) => one.key === key);
  if (!entry || (entry.id && !atPost(game, entry.id))) return false;
  const plan = planAt(entry, hours);
  return !plan.block.asleep && !plan.block.hidden;
}

// Whether someone's walk has brought them to where a detour sent them. Where the captain isn't, everyone is where
// their day says, so they're there already.
export function hasReached(game, place, key, where) {
  if (place !== game.location) return true;
  const state = game.life?.places?.[place]?.[key];
  if (!state) return true;
  return typeof state.task === "string" && state.task.startsWith(`systems:${where}:`) && atGoal(state);
}

// The room a plan sends someone to, by its id: their post's room, the room named, or the room a spot or a group is in.
function roomOfPlan(map, file, entry, plan) {
  const where = plan.where;
  if (!where) return null;
  if (/^[@>]/.test(where)) return where.slice(1);
  const spot = where === "post" ? postOf(map, entry.home ?? entry.id) : file.spots[where] ?? file.groups[where]?.[0] ?? null;
  const level = spot && map.levels[spot.level];
  if (!level) return null;
  return level.areas?.length ? level.roomAt(spot.x, spot.y) : level.id;
}

// Who's usually in a room at each five minutes of the day, from everyone's days as written: the ship's machines need
// someone at them, and a long jump of the clock isn't walked through minute by minute, so this is as close as anyone
// would know, and the same however the jump is cut up. Someone dead or away isn't counted when it's read. With a job,
// only those the watch bill has doing it count: a machine that needs a cook needs someone whose job is cook.
const USUAL_STEP = 5;
const usual = new Map();
export function usuallyIn(game, place, roomId, minuteOfDay, job = undefined) {
  const key = `${place}/${roomId}/${rosterSignature(movedDays(game, place))}`;
  if (!usual.has(key)) {
    if (usual.size > 200) usual.clear();
    const roster = rosterFor(game, place);
    const file = lifeFileFor(place);
    const map = mapFor(place);
    const buckets = [];
    for (let minute = 0; minute < MINUTES_IN_A_DAY; minute += USUAL_STEP) {
      const here = [];
      if (file && map) {
        for (const entry of roster) {
          const plan = planAt(entry, minute / 60);
          if (plan.block.asleep || plan.block.hidden) continue;
          if (roomOfPlan(map, file, entry, plan) === roomId) here.push({ id: entry.id, key: entry.key, name: entry.name ?? entry.id });
        }
      }
      buckets.push(here);
    }
    usual.set(key, buckets);
  }
  const minute = ((minuteOfDay % MINUTES_IN_A_DAY) + MINUTES_IN_A_DAY) % MINUTES_IN_A_DAY;
  const jobs = job === undefined ? null : jobsOf(game, place);
  return usual.get(key)[Math.floor(minute / USUAL_STEP)]
    .filter((one) => (!one.id || atPost(game, one.id)) && (!jobs || jobs[one.key] === job))
    .map((one) => one.name);
}

// Everyone whose day has them in a room at a given time, awake and about, by name, as exactly as their days say.
// Looking changes nothing.
export function whoIsIn(game, place, roomId, hours) {
  const file = lifeFileFor(place);
  const map = mapFor(place);
  if (!file || !map) return [];
  const names = [];
  for (const entry of rosterFor(game, place)) {
    if (entry.id && !atPost(game, entry.id)) continue;
    const plan = planAt(entry, hours);
    if (plan.block.asleep || plan.block.hidden) continue;
    if (roomOfPlan(map, file, entry, plan) === roomId) names.push(entry.name ?? entry.id);
  }
  return names;
}

const homeOf = (map, id) => Object.values(map.levels).flatMap((level) => level.homes).find((home) => home.id === id);

function postOf(map, id) {
  for (const level of Object.values(map.levels)) {
    const home = level.homes.find((one) => one.id === id);
    if (home) return { level: level.id, x: home.x, y: home.y, ...(home.side ? { side: home.side } : {}) };
  }
  return null;
}

// What someone takes up where they stop: one square, or the whole of their name if it's shown beside
// them. Someone leaving by a door is on their way out of sight, so they don't take up anything.
function squaresOf(map, entry, spot) {
  if (spot.out) return [];
  // Someone in a seat or a bed takes only that square: at a table or in a row of bunks, their name goes over their
  // head, not along the floor beside them.
  if (map.levels[spot.level]?.seats?.has(`${spot.x},${spot.y}`)) return [seatKey(spot)];
  const label = entry.id ? homeOf(map, entry.id)?.label : null;
  return Array.from({ length: label ? label.length + 2 : 1 }, (_, i) => seatKey({ level: spot.level, y: spot.y, x: spot.side === "left" ? spot.x - i : spot.x + i }));
}

// Squares nobody else stops on: everyone's post, and anything on a level with a name of its own.
function fixedSquares(file, map) {
  if (!file.fixed) {
    file.fixed = new Set(file.roster.filter((entry) => entry.id).flatMap((entry) => {
      const post = postOf(map, entry.id);
      return post ? squaresOf(map, entry, post) : [];
    }));
    for (const level of Object.values(map.levels)) {
      const covers = (x, y, length = 1) => Array.from({ length }, (_, i) => file.fixed.add(seatKey({ level: level.id, x: x + i, y })));
      // A container that's a piece of the deck's furniture (src/loot.js) is furniture: names may run over it.
      for (const thing of level.things) if (!thing.onPiece) covers(thing.x, thing.y);
      for (const key of map.place ? partSquares(map.place, level.id) : []) covers(...key.split(",").map(Number));
      for (const exit of level.exits) covers(exit.side === "left" ? exit.x - exit.label.length - 1 : exit.x, exit.y, exit.label.length + 2);
      for (const label of level.labels) covers(label.x, label.y, label.text.length);
      level.layers.writing.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch !== " ") covers(x, y);
      }));
    }
  }
  return file.fixed;
}

function fits(map, entry, spot, taken) {
  const squares = squaresOf(map, entry, spot);
  if (!squares.length) return true;
  const [end] = squares.at(-1).split(":")[1].split(",").map(Number);
  return end >= 0 && end < map.levels[spot.level].width && squares.every((key) => !taken.has(key));
}

const standingRoom = new WeakMap();

// The squares of a room where anyone might stop: not in a doorway, and not right in front of a way out. On a deck,
// a room is the one drawn there, and only its squares count.
function squaresToStand(room) {
  const { level } = room;
  if (!standingRoom.has(level)) standingRoom.set(level, new Map());
  const byRoom = standingRoom.get(level);
  if (!byRoom.has(room.id)) {
    const squares = [];
    level.open.forEach((row, y) => row.forEach((open, x) => {
      if (open && canStand(level, x, y) && !level.doors.has(`${x},${y}`) && !level.exits.some((exit) => beside({ x, y }, exit)) && (!room.area || level.areaAt(x, y) === room.id)) squares.push({ x, y });
    }));
    byRoom.set(room.id, squares);
  }
  return byRoom.get(room.id);
}

// A free place somewhere in a room, different each time, with open floor for their name if it can be had.
function somewhereOn(map, entry, plan, roomId, taken) {
  const room = roomOf(map, roomId);
  const { level } = room;
  const squares = squaresToStand(room);
  if (!squares.length) return null;
  // Their own bed, or their own place at the benches, is the same one every day.
  const same = plan.block.stays || plan.block.asleep;
  const first = seedFrom(same ? `${entry.key}/${roomId}` : `${entry.key}/${plan.key}/${roomId}`) % squares.length;
  const inTurn = Array.from({ length: squares.length }, (_, i) => ({ level: level.id, ...squares[(first + i) % squares.length] }));
  const onFloor = (spot) => squaresOf(map, entry, spot).every((key) => {
    const [x, y] = key.split(":")[1].split(",").map(Number);
    return level.open[y]?.[x];
  });
  return inTurn.find((spot) => fits(map, entry, spot, taken) && onFloor(spot)) ?? inTurn.find((spot) => fits(map, entry, spot, taken)) ?? inTurn[0];
}

// Beside the way out of a room that this person always uses, so they can go out of sight through it. A room drawn
// on a deck with no way out of its own uses the deck's.
function byTheDoor(map, entry, roomId) {
  const room = roomOf(map, roomId);
  const { level } = room;
  const own = room.area ? level.exits.filter((exit) => room.area.exits.includes(exit.key)) : level.exits;
  const exits = own.length ? own : level.exits;
  if (!exits.length) return null;
  const door = exits[seedFrom(`${entry.key}/${roomId}`) % exits.length];
  const spot = STEPS.map(([dx, dy]) => ({ x: door.x + dx, y: door.y + dy })).find((one) => canStand(level, one.x, one.y));
  return spot ? { level: level.id, ...spot, out: true } : null;
}

// Two people can't stop in one place, so the second stops as close as they can get.
function closeTo(map, entry, spot, taken) {
  if (fits(map, entry, spot, taken)) return spot;
  let found = spot;
  findPath(map.levels[spot.level], NO_ONE, spot, (here) => {
    if (!canStand(map.levels[spot.level], here.x, here.y) || !fits(map, entry, { ...spot, x: here.x, y: here.y }, taken)) return false;
    found = { ...spot, x: here.x, y: here.y };
    return true;
  });
  return found;
}

// Where this person goes for what they're doing now. In a group, they take the next place that's free.
function spotFor(file, map, entry, plan, taken) {
  if (plan.spot) return plan.exact ? plan.spot : closeTo(map, entry, plan.spot, taken);
  if (plan.where === "post") return postOf(map, entry.home ?? entry.id);
  // A step of a day that names nowhere to go leaves them where they are, and so does a room that isn't on the map,
  // so a typing mistake in the file can't stop the game. (A day with such a step, the guards' made-up one, used to
  // stop the clock every evening for anyone the captain put on that job.)
  if (!plan.where) return null;
  if (/^[@>]/.test(plan.where) && !roomOf(map, plan.where.slice(1))) return null;
  if (plan.where.startsWith("@")) return somewhereOn(map, entry, plan, plan.where.slice(1), taken);
  if (plan.where.startsWith(">")) return byTheDoor(map, entry, plan.where.slice(1));
  if (file.spots[plan.where]) return closeTo(map, entry, file.spots[plan.where], taken);
  const group = file.groups[plan.where] ?? [];
  const first = seedFrom(`${entry.key}/${plan.key}`) % Math.max(1, group.length);
  for (let i = 0; i < group.length; i += 1) {
    const spot = group[(first + i) % group.length];
    if (fits(map, entry, spot, taken)) return spot;
  }
  return group[first] ? closeTo(map, entry, group[first], taken) : null;
}

// ---- Who's where ----------------------------------------------------------------

const atGoal = (state) => state.level === state.goal.level && state.x === state.goal.x && state.y === state.goal.y;

// Everyone exactly where they should be at this moment, as they are after any long gap. Anyone who's
// still doing the same thing as before keeps the place they already had.
function settle(place, hours, before = {}, detour = null, roster = lifeFileFor(place).roster) {
  const file = lifeFileFor(place);
  const map = mapFor(place);
  const plansNow = roster.map((entry) => ({ entry, plan: planFor(map, file, entry, hours, detour) }));
  const stays = ({ entry, plan }) => before[entry.key]?.task === plan.key;
  const taken = new Set(fixedSquares(file, map));
  for (const one of plansNow.filter(stays)) squaresOf(map, one.entry, before[one.entry.key].goal).forEach((key) => taken.add(key));
  const people = {};
  for (const one of plansNow) {
    const { entry, plan } = one;
    const goal = stays(one) ? before[entry.key].goal : spotFor(file, map, entry, plan, taken);
    if (!goal) continue;
    squaresOf(map, entry, goal).forEach((key) => taken.add(key));
    people[entry.key] = { task: plan.key, level: goal.level, x: goal.x, y: goal.y, goal, path: null };
  }
  return people;
}

// A place nobody's in is drawn over and over from the same few moments.
const settledAt = new Map();

function settledPlace(game, place, hours) {
  const key = `${place}@${hours}@${rosterSignature(movedDays(game, place))}`;
  if (!settledAt.has(key)) {
    if (settledAt.size > 100) settledAt.clear();
    settledAt.set(key, settle(place, hours, {}, null, rosterFor(game, place)));
  }
  return settledAt.get(key);
}

// A short mark of a place as it's drawn: where anyone can walk on each level, its furniture, where people are posted
// and the spots their days send them to. A save keeps the mark of the place its people were settled in, so that when
// the place has been redrawn since (a wall where someone stood, a station moved across the room) they're settled
// afresh where their day puts them now, and nobody's left standing where the deck used to be.
const drawnMarks = new WeakMap();
function drawnMark(place) {
  const map = mapFor(place);
  const life = lifeFileFor(place);
  if (!map || !life) return null;
  if (!drawnMarks.has(map)) {
    let hash = 2166136261;
    const add = (text) => {
      for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    };
    for (const id of Object.keys(map.levels).sort()) {
      const level = map.levels[id];
      add(id);
      for (const row of level.open) add(row.map((open) => (open ? "1" : "0")).join(""));
      add(JSON.stringify(level.furniture ?? []));
      add(JSON.stringify((level.homes ?? []).map((home) => [home.id, home.x, home.y])));
    }
    add(JSON.stringify(Object.entries(life.spots).map(([name, spot]) => [name, spot.level, spot.x, spot.y])));
    drawnMarks.set(map, (hash >>> 0).toString(36));
  }
  return drawnMarks.get(map);
}
// Whether a place has been redrawn since the save's people were settled in it. A save from before marks were kept
// counts as redrawn: its people are settled once more, where their day has them at that hour anyway.
const redrawnSince = (game, place) => {
  const mark = drawnMark(place);
  return mark !== null && game.life?.drawn?.[place] !== mark;
};

// Only looking at this changes nothing, so showing the game can't change the save. A save with people on levels that
// are gone, or in a place that's been redrawn since, shows them settled afresh until the clock moves.
function peopleOf(game, place) {
  const saved = game.life?.places[place];
  const map = mapFor(place);
  if (saved && !Object.values(saved).some((state) => !map?.levels[state.level]) && !redrawnSince(game, place)) return saved;
  // Whoever's down lies where they are from the start (src/medbay.js).
  return laidWhereTheyAre(game, place, settledPlace(game, place, game.clock.hours));
}

// The same, for something that's about to move the clock. The save only ever holds the captain's place.
export function lifeOf(game) {
  game.life ??= { at: game.clock.hours, carry: 0, places: {} };
  // A save from before a place's map was redrawn has everyone on levels that are gone: they're settled afresh.
  for (const [place, people] of Object.entries(game.life.places)) {
    const map = mapFor(place);
    if (map && (Object.values(people).some((state) => !map.levels[state.level] || !map.levels[state.goal?.level]) || redrawnSince(game, place))) delete game.life.places[place];
  }
  if (livesHere(game.location)) game.life.places[game.location] ??= structuredClone(peopleOf(game, game.location));
  // Everyone still here stands in the place as it's drawn now.
  game.life.drawn = Object.fromEntries(Object.keys(game.life.places).map((place) => [place, drawnMark(place)]).filter(([, mark]) => mark !== null));
  return game.life;
}

// ---- Walking ---------------------------------------------------------------------

// The way through a place: the first door to take on the way to another level.
function doorTowards(map, from, to) {
  const seen = new Set([from]);
  const queue = map.levels[from].exits.map((exit) => ({ exit, at: exit.to }));
  for (let i = 0; i < queue.length; i += 1) {
    const { exit, at } = queue[i];
    if (at === to) return exit;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const next of map.levels[at]?.exits ?? []) queue.push({ exit, at: next.to });
  }
  return null;
}

const beside = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

// The next stretch of someone's walk: the squares across this level, and a door at the end if
// they're leaving it. The last step can be onto a bench or a bunk, which nobody can walk across.
function nextStretch(map, state) {
  const level = map.levels[state.level];
  const { goal } = state;
  if (goal.level === state.level) {
    const path = findPath(level, NO_ONE, state, (here) => beside(here, goal));
    return path && [...path.map(({ x, y }) => [x, y]), [goal.x, goal.y]];
  }
  const door = doorTowards(map, state.level, goal.level);
  if (!door) return null;
  const path = findPath(level, NO_ONE, state, (here) => beside(here, door));
  const beyond = map.levels[door.to];
  const way = beyond?.exits.find((exit) => exit.key === door.via);
  const out = way && STEPS.map(([dx, dy]) => ({ x: way.x + dx, y: way.y + dy })).find((spot) => canStand(beyond, spot.x, spot.y));
  return path && out ? [...path.map(({ x, y }) => [x, y]), { to: door.to, x: out.x, y: out.y }] : null;
}

function walkOn(map, state, steps) {
  for (let left = steps; left > 0 && !atGoal(state); left -= 1) {
    state.path ??= nextStretch(map, state);
    // Nobody ever gets stuck: if there's no way there, they just turn up there.
    if (!state.path?.length) {
      Object.assign(state, { level: state.goal.level, x: state.goal.x, y: state.goal.y, path: null });
      return;
    }
    const next = state.path.shift();
    if (Array.isArray(next)) [state.x, state.y] = next;
    else Object.assign(state, { level: next.to, x: next.x, y: next.y });
    if (!state.path.length) state.path = null;
  }
}

// ---- The clock moves ---------------------------------------------------------------

// Everyone moves on to whatever's next, and walks a little of the way there, as fast as their legs let them.
function moveOn(place, people, hours, steps, detour = null, roster = lifeFileFor(place).roster, paces = null) {
  const file = lifeFileFor(place);
  const map = mapFor(place);
  for (const entry of roster) {
    const state = people[entry.key];
    if (!state) continue;
    const plan = planFor(map, file, entry, hours, detour);
    if (plan.key !== state.task) {
      // Everyone else's place is taken. Their own isn't, in case what's next happens right there too.
      const others = roster.filter((one) => one !== entry && people[one.key]);
      const taken = new Set([...fixedSquares(file, map), ...others.flatMap((one) => squaresOf(map, one, people[one.key].goal))]);
      const goal = spotFor(file, map, entry, plan, taken);
      state.task = plan.key;
      if (goal) {
        state.goal = goal;
        state.path = null;
      }
    }
    const pace = paces?.get(entry.key);
    if (pace === undefined) walkOn(map, state, steps);
    else {
      state.carry = (state.carry ?? 0) + steps * pace;
      const mine = Math.floor(state.carry);
      state.carry -= mine;
      walkOn(map, state, mine);
    }
  }
}

// The people the story brought to the captain go back to their day, from wherever they're standing,
// once the captain has moved on or a little time has gone by. Anyone without a day stays until the
// story says otherwise.
function companyMovesOn(game, hours) {
  const walk = game.walk;
  if (!walk?.with?.length || !livesHere(walk.place)) return;
  walk.withUntil ??= hours + COMPANY_STAYS / 60;
  if (walk.level === walk.withLevel && !walk.room && hours < walk.withUntil) return;
  // Whoever a scene is waiting on stays while the player does, however long they take.
  const needed = walk.level === walk.withLevel && !walk.room ? game.scene?.with ?? null : null;
  const people = game.life.places[walk.place] ?? {};
  walk.with = walk.with.filter((entry) => {
    if (needed && (entry.id ?? entry.name) === needed) return true;
    const state = people[entry.id ?? entry.name];
    if (state) Object.assign(state, { level: walk.withLevel, x: entry.x, y: entry.y, path: null });
    return !state;
  });
}

// Called whenever the clock moves, by however much, wherever the captain is.
export function advanceLife(game) {
  const life = lifeOf(game);
  const hours = game.clock.hours;
  const gap = (hours - life.at) * 60;
  if (gap <= 0) return;
  life.at = hours;
  life.carry = (life.carry ?? 0) + gap * SQUARES_A_MINUTE;
  const steps = Math.floor(life.carry);
  life.carry -= steps;
  const place = game.location;
  const people = life.places[place];
  const detour = livesHere(place) ? detoursFor(game, place) : null;
  const roster = livesHere(place) ? rosterFor(game, place) : [];
  if (livesHere(place) && people && gap <= LONG_GAP) moveOn(place, people, hours, steps, detour, roster, pacesFor(game, place, roster));
  life.places = livesHere(place) ? { [place]: people && gap <= LONG_GAP ? people : settle(place, hours, people, detour, roster) } : {};
  // Whoever's being carried is wherever the one carrying them has got to.
  if (life.places[place]) followCarriers(game, place, life.places[place]);
  companyMovesOn(game, hours);
}

// ---- What the rest of the game gets to see --------------------------------------

function seenAs(game, map, entry, state, detour = null) {
  const plan = detour ? planFor(map, lifeFileFor(game.location), entry, game.clock.hours, detour) : planAt(entry, game.clock.hours);
  const settled = atGoal(state);
  // Someone going out of sight can still be seen on their way there. The dead, once carried away, aren't seen at all.
  if (plan.block.dead || (settled && plan.block.hidden)) return null;
  const home = entry.id ? homeOf(map, entry.id) : null;
  const heading = roomNameAt(map, state.goal).replace(/^The /, "the ");
  // Someone on one of the ship's errands says what they're carrying as they go.
  const errand = String(plan.key).startsWith("systems:store:");
  return {
    id: entry.id,
    name: entry.name ?? entry.id,
    ...(home?.label ? { label: home.label } : {}),
    ...(home?.greeting ? { greeting: home.greeting } : {}),
    x: state.x,
    y: state.y,
    doing: settled || plan.block.rounds || plan.block.hidden ? mealWords(game, map.place, plan.block.doing) : errand ? `${plan.block.doing}, heading for ${heading}` : `heading for ${heading}`,
    ...(settled ? {} : { walking: true }),
    ...(settled && plan.block.asleep ? { asleep: true } : {}),
    ...(entry.crowd ? { crowd: true } : {}),
    ...(settled && state.goal.side ? { side: state.goal.side } : {}),
  };
}

// The name of the room at a spot: the one drawn there on a deck, or the level's.
function roomNameAt(map, spot) {
  const level = map.levels[spot?.level];
  if (!level) return String(spot?.level ?? "");
  return roomOf(map, level.roomAt(spot.x, spot.y))?.name ?? level.name;
}

// Everyone on one level of a place right now, in the order of the place's file.
export function peopleAboard(game, place, levelId) {
  const file = lifeFileFor(place);
  const map = mapFor(place);
  const people = peopleOf(game, place);
  const detour = place === game.location ? detoursFor(game, place) : null;
  return rosterFor(game, place)
    // Someone with a file who's died is gone from their post, but lies where they are until they're carried away.
    .filter((entry) => people[entry.key]?.level === levelId && (!entry.id || atPost(game, entry.id) || Boolean(game.down?.[keyAt(place, entry.id)]?.dead)))
    .map((entry) => seenAs(game, map, entry, people[entry.key], detour))
    .filter(Boolean);
}

// Where someone is right now and what they're doing, in a few words, for anyone whose life is simulated.
export function whereNow(game, id) {
  if ([...(game.walk?.with ?? []), ...(game.walk?.room?.people ?? [])].some((entry) => entry.id === id)) return "with the captain";
  // Someone who's in two places' files is wherever the captain is, if that's one of them.
  for (const place of placesFor(game, id)) {
    if (!livesHere(place)) continue;
    const entry = rosterFor(game, place).find((one) => one.id === id || (!one.id && one.key === id));
    const state = entry && peopleOf(game, place)[entry.key];
    if (!state) continue;
    const map = mapFor(place);
    const seen = seenAs(game, map, entry, state, place === game.location ? detoursFor(game, place) : null);
    const away = place === game.location ? "" : `, on ${LOCATIONS[place].name}`;
    return seen ? `${seen.doing}, at ${roomNameAt(map, state).replace(/^The /, "the ")}${away}` : `somewhere out of sight${away}`;
  }
  return null;
}
