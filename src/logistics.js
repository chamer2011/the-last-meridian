// The ship's logistics: nothing aboard comes from nothing. world/logistics/<place>.txt says where every stock is kept,
// and each store is a real thing in a room, full to start with, that the player can walk to and open beside their
// pack; the Ship menu reads the same count. Its machines run on the clock, at the same beat as everyone's days: each
// takes from one store and puts into another so often, while its room has power and someone's at it. The whole ship
// eats from the kettle at its sittings, and whoever finds it empty goes without, which the ship's morale feels at
// midnight. The file's other parts (loads, errands, refills) are read and checked for their shape, and come to life
// step by step. Everything here runs on this computer, and the AI isn't told any of it yet. public/logistics-text.js
// reads the words; this knows the maps, the items, the systems and everyone's days.

import { ITEMS, LOCATIONS } from "./data.js";
import { storeCounts, storePut, storeTake } from "./bag.js";
import { findCharacter } from "./campaign.js";
import { hasReached, isAbout, rosterOf, usuallyIn, whoIsIn } from "./life.js";
import { claimedSquares, floorSpot, roomPowered, systemsOf } from "./systems.js";
import { mapFor, roomHere, roomsOf, roomsOn, thingsIn } from "./walk.js";
import { LOGISTICS_FILE_PROBLEMS, WORLD_LOGISTICS } from "./world.js";
import { everyWords, readErrandLine, readLoadsLine, readMachineLine, readStoreLine, slugOf } from "../public/logistics-text.js";
import { KNOWN_SYSTEMS, SYSTEM_TITLES } from "../public/systems-text.js";

const plain = (words) => String(words ?? "").toLowerCase().replace(/['’]/g, "").replace(/^the\s+/, "").replace(/\s+/g, " ").trim();
const upperFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : "");
// A store can hold a count of something that isn't an item you pick up: the kettle's sittings.
const COUNT_UNITS = ["sittings"];
// When the whole ship eats, unless the file says: four sittings of an hour and a half, as the rota on the mess wall
// has it, two in the morning and two in the evening, while the cooks are at the kettle.
const DEFAULT_SITTINGS = { at: [6 * 60, 7 * 60 + 30, 18 * 60, 19 * 60 + 30], minutes: 90 };
// The clock is stepped through in pieces this long, so that who's at a machine and whether there's a sitting on are
// looked at often enough, however far the clock jumps at once.
const CHUNK = 5;
// How long a walk across the ship is allowed to take before an errand counts its person as arrived anyway.
const WALK_MINUTES = 15;
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"];
const clockWords = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(Math.round(minutes) % 60).padStart(2, "0")}`;

// An item by the words a file uses for it: its name or its id, plural or not.
export function itemByWords(words) {
  const want = plain(words).replace(/s$/, "");
  if (!want) return null;
  for (const [id, item] of Object.entries(ITEMS)) {
    const names = [id.replace(/_/g, " "), item.name].map((one) => plain(one).replace(/s$/, ""));
    if (names.includes(want)) return id;
  }
  return null;
}

const itemWords = (id, n) => {
  const name = (ITEMS[id]?.name ?? id).toLowerCase();
  return n === 1 || /produce$/.test(name) ? name : `${name}s`;
};

// "12 ration crates and 12 produce", or "400 sittings".
export function describeHolds(holds, count = null) {
  if (count) return `${count.n} ${count.unit}`;
  const parts = Object.entries(holds ?? {}).map(([id, n]) => `${n} ${itemWords(id, n)}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? "nothing";
}

const models = new Map();
const compiling = new Set();

// Made again after the file changes, or the maps are made again.
export function clearLogistics() {
  models.clear();
}

export function logisticsOf(place) {
  if (!place || !WORLD_LOGISTICS[place]) return null;
  if (models.has(place)) return models.get(place);
  if (compiling.has(place)) return null;
  compiling.add(place);
  try {
    models.set(place, compileLogistics(place));
  } catch (err) {
    console.error(`The logistics at ${place} can't be used: ${err.message}`);
    models.set(place, null);
  } finally {
    compiling.delete(place);
  }
  return models.get(place);
}

// The squares a new store must leave alone: every thing's and part's own square and the squares beside them, which
// is where you stand to reach them (a part on a wall is reached from the square in front of it, one of those).
function keptClear(place, map, level) {
  const out = new Set();
  const around = (x, y) => { for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) out.add(`${x + dx},${y + dy}`); };
  for (const thing of level.things) around(thing.x, thing.y);
  const model = systemsOf(place);
  const rooms = level.areas?.length ? roomsOn(map, level.id).map((room) => room.id) : [level.id];
  for (const room of rooms) {
    for (const id of model?.partsIn[room] ?? []) {
      const part = model.parts[id];
      if (!part || part.unplaced) continue;
      around(part.x, part.y);
    }
  }
  return out;
}

// A free square of the room for a store nobody has drawn: at the edge, off the squares that are kept clear, and
// where it leaves everything in the room reachable. The squares other stores took are the deck's, shared by its rooms.
function spotFor(place, map, room, taken) {
  const level = room.level;
  const keep = new Set([...claimedSquares(place, map, level), ...keptClear(place, map, level)]);
  return floorSpot(level, taken.get(level.id) ?? new Set(), 0, 1, keep, room.area ?? null);
}

function compileLogistics(place) {
  const map = mapFor(place);
  const file = WORLD_LOGISTICS[place];
  if (!map || !file) return null;
  const name = LOCATIONS[place]?.name ?? file.name ?? place;
  const problems = [];
  const at = (line, message) => problems.push({ line: line ?? null, message });
  const rooms = roomsOf(map);
  const findRoom = (want) => {
    const key = plain(want);
    return rooms.find((room) => plain(room.name) === key || room.id === key || (room.aliases ?? []).some((alias) => plain(alias) === key)) ?? null;
  };
  const model = { place, name, file, numbers: file.numbers ?? {}, stores: [], storesIn: {}, machines: [], kettles: [], sittings: file.sittings ?? DEFAULT_SITTINGS, eats: Number(file.numbers?.eats) || 2, problems };
  const taken = new Map();
  for (const raw of file.stores ?? []) {
    const line = raw.line ?? null;
    const s = readStoreLine(raw.text);
    if (s.problem) {
      at(line, s.problem);
      continue;
    }
    const room = findRoom(s.room);
    if (!room) {
      at(line, `${name} has no room called ${s.room}`);
      continue;
    }
    const id = slugOf(s.name);
    if (model.stores.some((one) => one.id === id)) {
      at(line, `the ${s.name} is written twice`);
      continue;
    }
    const holds = {};
    let count = null;
    let sound = true;
    for (const { n, what } of s.holds) {
      const unit = plain(what).replace(/s$/, "");
      if (COUNT_UNITS.includes(`${unit}s`)) {
        count = { n, unit: `${unit}s` };
        continue;
      }
      const item = itemByWords(what);
      if (!item) {
        at(line, `there's no item called ${what} in world/items, to keep in the ${s.name}`);
        sound = false;
        continue;
      }
      holds[item] = (holds[item] ?? 0) + n;
    }
    if (!sound) continue;
    if (count && Object.keys(holds).length) {
      at(line, `the ${s.name} holds ${count.unit} and things both: a store is one or the other`);
      continue;
    }
    const level = room.level;
    const existing = thingsIn(room).find((one) => plain(one.name) === plain(s.name));
    let thing = existing;
    if (!thing) {
      const spot = spotFor(place, map, room, taken);
      if (!spot) {
        at(line, `there's no free square in ${room.name} to put the ${s.name} on`);
        continue;
      }
      thing = { id: `store:${id}`, name: upperFirst(s.name), x: spot.x, y: spot.y, placed: true };
      // It stands like a thing drawn there: its square isn't floor, and you reach it from beside it.
      level.things.push(thing);
      level.solid.add(`${spot.x},${spot.y}`);
      if (level.open[spot.y]) level.open[spot.y][spot.x] = false;
      (taken.get(level.id) ?? taken.set(level.id, new Set()).get(level.id)).add(`${spot.x},${spot.y}`);
    }
    const kept = describeHolds(holds, count);
    thing.store = id;
    if (count) thing.look = `${existing ? `${thing.look ?? ""} `.trimStart() : s.look ? `${s.look} ` : ""}It holds up to ${kept}, the ship's own.`.trim();
    else {
      thing.holds = { ...holds };
      thing.look = `${existing ? `${thing.look ?? ""} `.trimStart() : s.look ? `${s.look} ` : ""}The ship keeps ${kept} here.`.trim();
    }
    const entry = { id, name: s.name, room: room.id, roomName: room.name, level: level.id, thing: thing.id, key: `thing:${place}:${thing.id}`, holds, count, look: s.look, placed: !existing, line };
    model.stores.push(entry);
    (model.storesIn[room.id] ??= []).push(id);
    if (count) model.kettles.push(entry);
  }
  // The machines: what each takes, from where, what it makes, where that goes, how often, and what it needs.
  const findStore = (words) => {
    const key = plain(words);
    return model.stores.find((store) => plain(store.name) === key || store.id === slugOf(words)) ?? null;
  };
  const storeNames = () => model.stores.map((store) => store.name).join(", ") || "none yet";
  for (const raw of file.machines ?? []) {
    const line = raw.line ?? null;
    const m = readMachineLine(raw.text);
    if (m.problem) {
      at(line, m.problem);
      continue;
    }
    const id = slugOf(m.name);
    if (model.machines.some((one) => one.id === id)) {
      at(line, `the ${m.name} is written twice`);
      continue;
    }
    let sound = true;
    const from = m.from ? findStore(m.from) : null;
    if (m.from && !from) {
      at(line, `there's no store called ${m.from} for the ${m.name} to take from: the stores are ${storeNames()}`);
      sound = false;
    }
    const into = m.into ? findStore(m.into) : null;
    if (m.into && !into) {
      at(line, `there's no store called ${m.into} for the ${m.name} to put into: the stores are ${storeNames()}`);
      sound = false;
    }
    const takes = [];
    for (const { n, what } of m.takes) {
      const item = itemByWords(what);
      if (!item) {
        at(line, `there's no item called ${what} in world/items for the ${m.name} to use`);
        sound = false;
      } else if (from && !(item in from.holds)) {
        at(line, `the ${from.name} doesn't keep ${what}: add it to the ${from.name}'s holds line, or use something it keeps`);
        sound = false;
      } else takes.push({ item, n });
    }
    let gives = null;
    if (m.gives) {
      const unit = plain(m.gives.what).replace(/s$/, "");
      if (COUNT_UNITS.includes(`${unit}s`)) {
        if (!into) {
          at(line, `the ${m.name} makes ${unit}s but doesn't say where they go: write into ${m.gives.n} ${unit}s in the soup kettle`);
          sound = false;
        } else if (into.count?.unit !== `${unit}s`) {
          at(line, `the ${m.name} makes ${unit}s, so it has to put them into a store of ${unit}s, and the ${into.name} isn't one`);
          sound = false;
        } else gives = { count: true, unit: `${unit}s`, n: m.gives.n };
      } else {
        const item = itemByWords(m.gives.what);
        if (!item) {
          at(line, `there's no item called ${m.gives.what} in world/items for the ${m.name} to make`);
          sound = false;
        } else if (!into) {
          at(line, `the ${m.name} makes ${m.gives.what} but doesn't say where they go: write into the garden bins`);
          sound = false;
        } else if (into.count || !(item in into.holds)) {
          at(line, `the ${into.name} doesn't keep ${m.gives.what}: add it to the ${into.name}'s holds line`);
          sound = false;
        } else gives = { count: false, item, n: m.gives.n };
      }
    }
    const room = m.room ? findRoom(m.room) : findRoom(m.name) ?? rooms.find((one) => one.id === (into ?? from)?.room) ?? null;
    if (m.room && !room) {
      at(line, `${name} has no room called ${m.room}`);
      sound = false;
    } else if (!room) {
      at(line, `the ${m.name} needs a room: write ${m.name} in The Galley`);
      sound = false;
    }
    if (!sound) continue;
    // A machine that gives power and makes nothing else is a generator: it burns what it's given and keeps the place lit.
    const generator = Boolean(m.power) && !gives;
    model.machines.push({ id, name: m.name, verb: m.verb, room: room.id, roomName: room.name, takes, from: from?.id ?? null, gives, into: into?.id ?? null, every: m.every, needs: m.needs, power: m.power, generator, runs: Boolean(gives) || generator, line, text: raw.text });
  }
  model.generators = model.machines.filter((m) => m.generator);
  // The loads: what each system draws from the generator, and the order they're let go in when there isn't enough.
  model.loads = [];
  model.drop = [];
  const SYNONYMS = { "air plant": "air", air: "air", nav: "navigation", lighting: "lights", light: "lights", camera: "cameras", engine: "engines", door: "doors", comm: "comms", computer: "computers" };
  const systemIdOf = (words) => {
    const key = plain(words).replace(/s$/, "");
    if (SYNONYMS[key]) return SYNONYMS[key];
    return KNOWN_SYSTEMS.find((one) => plain(one).replace(/s$/, "") === key || plain(SYSTEM_TITLES[one]).replace(/s$/, "") === key) ?? null;
  };
  const systemNames = () => `${KNOWN_SYSTEMS.filter((one) => one !== "power").join(", ")}, and computers`;
  for (const raw of file.loads ?? []) {
    const line = raw.line ?? null;
    const l = readLoadsLine(raw.text);
    if (l.problem) {
      at(line, l.problem);
      continue;
    }
    if (l.drop) {
      if (model.drop.length) at(line, "the order to drop systems in is written twice, and the second is the one kept");
      model.drop = [];
      for (const words of l.drop) {
        const id = systemIdOf(words);
        if (!id || id === "power" || id === "computers") at(line, `there's no system called ${words} to drop: the systems are ${KNOWN_SYSTEMS.filter((one) => one !== "power").join(", ")}`);
        else model.drop.push(id);
      }
      continue;
    }
    for (const one of l.loads) {
      const id = systemIdOf(one.system);
      if (!id || id === "power") {
        at(line, `there's no system called ${one.system} to draw power: the systems are ${systemNames()}`);
        continue;
      }
      if (one.while && !/^(under way|underway|jumping|moving)$/.test(one.while)) {
        at(line, `"while ${one.while}" isn't a time the game knows: write while under way`);
        continue;
      }
      model.loads.push({ system: id, amount: one.amount, per: one.per, underWay: Boolean(one.while), words: one.system });
    }
  }
  // The errands: who carries what from which store to which, when the store it goes to is short, so many a trip.
  model.errands = [];
  const roster = rosterOf(place);
  const findPerson = (who) => {
    const key = plain(who);
    const crowd = roster.find((one) => one.name && plain(one.name) === key);
    if (crowd) return crowd;
    const person = findCharacter(null, who);
    return person ? roster.find((one) => one.id === person.id) ?? null : null;
  };
  for (const raw of file.errands ?? []) {
    const line = raw.line ?? null;
    const e = readErrandLine(raw.text);
    if (e.problem) {
      at(line, e.problem);
      continue;
    }
    let sound = true;
    const person = findPerson(e.who);
    if (!person) {
      at(line, `nobody called ${e.who} has a day at ${name} in world/life, and an errand needs someone who does`);
      sound = false;
    }
    const item = itemByWords(e.what);
    if (!item) {
      at(line, `there's no item called ${e.what} in world/items for ${e.who} to carry`);
      sound = false;
    }
    const from = findStore(e.from);
    const to = findStore(e.to);
    if (!from) {
      at(line, `there's no store called ${e.from} for ${e.who} to carry from: the stores are ${storeNames()}`);
      sound = false;
    } else if (item && !(item in from.holds)) {
      at(line, `the ${from.name} doesn't keep ${e.what}: add it to the ${from.name}'s holds line`);
      sound = false;
    }
    if (!to) {
      at(line, `there's no store called ${e.to} for ${e.who} to carry to: the stores are ${storeNames()}`);
      sound = false;
    } else if (item && !(item in to.holds)) {
      at(line, `the ${to.name} doesn't keep ${e.what}: add it to the ${to.name}'s holds line`);
      sound = false;
    } else if (item && e.under > to.holds[item]) {
      at(line, `the ${to.name} keeps only ${to.holds[item]} ${e.what}, so it's always under ${e.under}, and ${e.who} would never stop`);
      sound = false;
    }
    if (!sound) continue;
    const id = `${slugOf(e.who)}:${item}`;
    if (model.errands.some((one) => one.id === id)) {
      at(line, `${e.who} is given ${e.what} to carry twice`);
      continue;
    }
    model.errands.push({ id, who: e.who, key: person.key, item, from: from.id, to: to.id, under: e.under, each: e.each, line, text: raw.text });
  }
  return model;
}

// ---- The counts -------------------------------------------------------------------------------------

const storeById = (model, id) => model.stores.find((store) => store.id === id) ?? null;
// What a store of sittings holds now: kept in the save once anything's moved, and the file's number before that.
export const countOf = (game, store) => (store.count ? game.stores?.[store.key]?.count ?? store.count.n : null);
function setCount(game, store, n) {
  game.stores ??= {};
  game.stores[store.key] = { ...(game.stores[store.key] ?? {}), count: Math.max(0, Math.min(store.count.n, Math.round(n))) };
}
// How much more a store can take of what a machine makes.
function roomFor(game, store, gives) {
  if (!gives) return Infinity;
  if (gives.count) return store.count.n - countOf(game, store);
  const counts = storeCounts(game, store.key, store.holds);
  return (store.holds[gives.item] ?? 0) - (counts[gives.item] ?? 0);
}
// The first of a machine's choices that the store has enough of.
function pickTake(game, store, takes) {
  const counts = storeCounts(game, store.key, store.holds);
  return takes.find((one) => (counts[one.item] ?? 0) >= one.n) ?? null;
}
const takesWords = (takes) => takes.map((one) => itemWords(one.item, 2)).join(" or ");
// "the pantry is full", "the garden bins are full".
const isFull = (store) => `the ${store.name} ${/s$/i.test(store.name) ? "are" : "is"} full`;

// ---- The clock -----------------------------------------------------------------------------------

// The state of a place's logistics in the save: when it was last run, each machine's progress, and the day's meals.
function stateOf(game, place) {
  game.logistics ??= {};
  return game.logistics[place] ??= { at: null, machines: {}, meals: { days: {}, carry: 0, dry: false }, errands: {} };
}

// ---- The errands ----------------------------------------------------------------------------------

const loadWords = (item, n) => `${n} ${itemWords(item, n)}`;
// The spot an errand has its person at: beside the store they fetch from, or beside the one they carry to.
const errandWhere = (e, s) => `store:${s.phase === "carrying" || s.phase === "unloading" ? e.to : e.from}`;
// What an errand's person is doing, in words, from where it's got to.
function errandDoing(model, e, s) {
  const from = storeById(model, e.from);
  const to = storeById(model, e.to);
  if (s.phase === "going") return `fetching ${itemWords(e.item, 2)} from the ${from.name}`;
  if (s.phase === "loading") return `taking ${itemWords(e.item, 2)} from the ${from.name}`;
  if (s.phase === "waiting") return `waiting at the ${from.name} for ${itemWords(e.item, 2)}`;
  if (s.phase === "carrying") return `carrying ${loadWords(s.load.item, s.load.n)} to the ${to.name}`;
  return `waiting at the ${to.name} for room for ${loadWords(s.load.item, s.load.n)}`;
}

// The errands over one piece of the clock. One starts when the store it keeps up is short and its person is awake and
// about: they go to the store they fetch from, stand there a minute and take what they can carry, or wait there when
// there's nothing, carry it over and put it in, and go back to their day; and again while the store's still short.
function runErrands(game, place, model, state, t) {
  state.errands ??= {};
  for (const e of model.errands) {
    const from = storeById(model, e.from);
    const to = storeById(model, e.to);
    const s = state.errands[e.id];
    const have = () => storeCounts(game, to.key, to.holds)[e.item] ?? 0;
    const room = () => Math.max(0, (to.holds[e.item] ?? 0) - have());
    if (!s) {
      if (have() >= e.under || !isAbout(game, place, e.key, t / 60)) continue;
      state.errands[e.id] = { phase: "going", since: t, load: null };
      continue;
    }
    // They've arrived when their walk has got them there, or when a walk's worth of time has gone by since they set
    // out: over a long jump of the clock nobody is walked minute by minute, and the errand still has to get done.
    const there = hasReached(game, place, e.key, errandWhere(e, s)) || t - s.since >= WALK_MINUTES;
    if (s.phase === "going") {
      if (there) Object.assign(s, { phase: "loading", since: t });
    } else if (s.phase === "loading" || s.phase === "waiting") {
      if (s.phase === "loading" && t - s.since < CHUNK) continue;
      const want = Math.min(e.each, room());
      if (want <= 0) {
        delete state.errands[e.id];
        continue;
      }
      const took = storeTake(game, from.key, from.holds, e.item, want);
      if (took <= 0) {
        s.phase = "waiting";
        continue;
      }
      Object.assign(s, { phase: "carrying", since: t, load: { item: e.item, n: took } });
    } else if (there) {
      s.load.n -= storePut(game, to.key, to.holds, s.load.item, s.load.n);
      if (s.load.n > 0) s.phase = "unloading";
      else delete state.errands[e.id];
    }
  }
}

// What the errands have someone doing and where, for the life engine's walks: null for anyone not on one.
export function errandDetour(game, place) {
  const model = logisticsOf(place);
  const errands = game.logistics?.[place]?.errands;
  if (!model?.errands?.length || !errands || !Object.keys(errands).length) return null;
  return (key) => {
    for (const e of model.errands) {
      const s = errands[e.id];
      if (s && e.key === key) return { where: errandWhere(e, s), doing: errandDoing(model, e, s) };
    }
    return null;
  };
}

// Who's at work in a room at a moment: the player standing there, and anyone whose day puts them there, awake.
export function workersIn(game, place, roomId, hours) {
  const names = whoIsIn(game, place, roomId, hours);
  if (game.location === place && game.walk && roomHere(game)?.id === roomId) names.unshift("you");
  return names;
}

// Why a machine isn't making anything at a minute of the clock, or null while it's running. Who's there comes from
// everyone's days as written (the same however a jump of the clock is cut up), and the player standing in the room.
function whyWaiting(game, place, m, from, into, minute, you) {
  if (m.needs.power && !roomPowered(game, place, m.room)) return "no power";
  if (m.needs.worker && you !== m.room && !usuallyIn(game, place, m.room, minute % 1440).length) return `waiting for ${m.needs.worker}`;
  if (into && roomFor(game, into, m.gives) < m.gives.n) return isFull(into);
  if (from && !pickTake(game, from, m.takes)) return `the ${from.name} ${/s$/i.test(from.name) ? "have" : "has"} no ${takesWords(m.takes)}`;
  return null;
}

// One machine over one piece of the clock. It's at work while it has power and someone there, and its progress
// builds up to one go, so that what's ready goes in as soon as there's room for it, or something to make it from.
function runMachine(game, place, model, m, state, minute, minutes, you) {
  const s = state.machines[m.id] ??= { progress: 0, made: 0, waiting: null };
  const from = m.from ? storeById(model, m.from) : null;
  const into = m.into ? storeById(model, m.into) : null;
  const why = whyWaiting(game, place, m, from, into, minute, you);
  const atWork = why === null || (why !== "no power" && !why.startsWith("waiting for "));
  if (atWork) s.progress = Math.min(m.every, s.progress + minutes);
  s.waiting = why;
  while (why === null && s.progress >= m.every) {
    const take = from ? pickTake(game, from, m.takes) : null;
    if ((from && !take) || (into && roomFor(game, into, m.gives) < m.gives.n)) break;
    if (from) storeTake(game, from.key, from.holds, take.item, take.n);
    if (m.gives.count) setCount(game, into, countOf(game, into) + m.gives.n);
    else storePut(game, into.key, into.holds, m.gives.item, m.gives.n);
    s.progress -= m.every;
    s.made += 1;
  }
}

// A generator over one piece of the clock: it burns what it's given, and when that's spent it takes the next from its
// store, or stops until there's one, and nothing aboard has power meanwhile. It starts with one in it.
function runGenerator(game, model, m, state, minutes) {
  const s = state.machines[m.id] ??= { progress: 0, made: 0, waiting: null, burning: m.every };
  if (s.burning === undefined) s.burning = m.every;
  const from = m.from ? storeById(model, m.from) : null;
  if (s.burning > 0) s.burning -= minutes;
  if (s.burning > 0) {
    s.waiting = null;
    return;
  }
  const take = from ? pickTake(game, from, m.takes) : null;
  if (from && !take) {
    s.burning = 0;
    s.waiting = `the ${from.name} ${/s$/i.test(from.name) ? "have" : "has"} no ${takesWords(m.takes)}`;
    return;
  }
  if (from) storeTake(game, from.key, from.holds, take.item, take.n);
  s.burning += m.every;
  s.made += 1;
  s.waiting = null;
}

// What the place's generators give right now: nothing from one that's stopped for want of fuel. Null where no
// generator is written, which is to say nowhere the power can run short.
export function powerSupply(game, place) {
  const model = logisticsOf(place);
  if (!model?.generators?.length) return null;
  const state = game.logistics?.[place]?.machines ?? {};
  return model.generators.reduce((sum, m) => sum + ((state[m.id]?.burning ?? m.every) > 0 ? m.power : 0), 0);
}
// What each system draws, and the order they're let go in, as the place's file has them.
export const loadsOf = (place) => logisticsOf(place)?.loads ?? [];
export const dropOrderOf = (place) => logisticsOf(place)?.drop ?? [];

// The sitting that's on at a minute of the day, if any.
const sittingAt = (sittings, minuteOfDay) => sittings.at.findIndex((start) => minuteOfDay >= start && minuteOfDay < start + sittings.minutes);

// The whole ship eating over one piece of the clock: so many people a minute through each sitting, each taking a
// sitting from the kettle while there's one to take. Whoever finds it empty goes without, and that's counted.
function serveMeals(game, place, model, state, t, minutes, notes) {
  if (!model.kettles.length) return;
  const day = Math.floor(t / 1440);
  const meals = state.meals;
  const today = meals.days[day] ??= { served: 0, missed: 0 };
  // Old days are let go once the ship's own day has had them, a few days on.
  if (t % 1440 === 0) {
    const keep = Math.min(day, game.ship?.day ?? day) - 3;
    for (const key of Object.keys(meals.days)) if (Number(key) < keep) delete meals.days[key];
  }
  const index = sittingAt(model.sittings, t - day * 1440);
  if (index < 0) return;
  const aboard = game.ship?.aboard ?? 0;
  const aSitting = (aboard * model.eats) / model.sittings.at.length;
  meals.carry = (meals.carry ?? 0) + (aSitting / model.sittings.minutes) * minutes;
  let people = Math.floor(meals.carry);
  meals.carry -= people;
  for (const kettle of model.kettles) {
    if (people <= 0) break;
    const have = countOf(game, kettle);
    const take = Math.min(have, people);
    if (take <= 0) continue;
    setCount(game, kettle, have - take);
    today.served += take;
    people -= take;
    // Soup again: the next time it runs dry is news again.
    meals.dry = false;
  }
  if (people <= 0) return;
  today.missed += people;
  if (!meals.dry) {
    meals.dry = true;
    if (game.location === place) notes.push(`[SHIP] The kettle has run dry in the ${ORDINALS[index] ?? `${index + 1}th`} sitting, and people are leaving the mess hungry.`);
  }
}

// The clock in whole minutes.
const minutesOf = (hours) => Math.floor(hours * 60 + 1e-6);

// A new game's logistics start with its clock, so that the first move of the clock counts from the start. A save from
// before there were logistics has no mark, and starts from the clock's next move instead, with nothing to catch up.
export function startLogistics(game) {
  const now = minutesOf(game.clock.hours);
  for (const place of Object.keys(WORLD_LOGISTICS)) if (logisticsOf(place)) stateOf(game, place).at = now;
  return game;
}

// Called whenever the clock moves, by however much, wherever the player is, and at each midnight of a long wait before
// the ship's own day is run, so that the day's hunger is counted first. The time since last time is stepped through in
// whole pieces of five minutes, each from the last mark to the next, so that a wait comes out the same however it's cut
// up; what's left over waits for the next move. Nothing happens while the clock is paused, since this isn't called then.
export function advanceLogistics(game, untilHours = game.clock.hours) {
  const notes = [];
  const until = minutesOf(untilHours);
  for (const place of Object.keys(WORLD_LOGISTICS)) {
    const model = logisticsOf(place);
    if (!model || (!model.kettles.length && !model.machines.some((m) => m.runs) && !model.errands.length)) continue;
    const state = stateOf(game, place);
    if (state.at === null) {
      state.at = until;
      continue;
    }
    if (until < state.at) continue;
    const you = game.location === place && game.walk ? roomHere(game)?.id ?? null : null;
    let t = state.at;
    while (t + CHUNK <= until) {
      for (const m of model.machines) {
        if (m.generator) runGenerator(game, model, m, state, CHUNK);
        else if (m.runs) runMachine(game, place, model, m, state, t, CHUNK, you);
      }
      serveMeals(game, place, model, state, t, CHUNK, notes);
      runErrands(game, place, model, state, t);
      t += CHUNK;
    }
    state.at = t;
  }
  return notes;
}

// ---- What the player sees ------------------------------------------------------------------------

// Every store of a place with what's in it now: what's been taken out and put back is kept in the save, and before
// that it's what the file says, so a store starts full. Reading this changes nothing.
export function storesView(game, place) {
  const model = logisticsOf(place);
  if (!model) return [];
  return model.stores.map((store) => {
    if (store.count) {
      const n = countOf(game, store);
      return { id: store.id, name: upperFirst(store.name), room: store.roomName, items: [], count: { n, of: store.count.n, unit: store.count.unit }, full: n >= store.count.n, empty: n <= 0 };
    }
    const counts = storeCounts(game, store.key, store.holds);
    const items = Object.keys(store.holds).map((id) => ({ id, name: ITEMS[id]?.name ?? id, n: counts[id] ?? 0, of: store.holds[id] }));
    for (const [id, n] of Object.entries(counts)) if (!(id in store.holds)) items.push({ id, name: ITEMS[id]?.name ?? id, n, of: 0 });
    return { id: store.id, name: upperFirst(store.name), room: store.roomName, items, count: null, full: items.every((one) => one.n >= one.of), empty: items.every((one) => one.n <= 0) };
  });
}

// Every machine with what it does and how it's getting on. Reading this changes nothing.
export function machinesView(game, place) {
  const model = logisticsOf(place);
  if (!model) return [];
  const state = game.logistics?.[place];
  return model.machines.map((m) => {
    const s = state?.machines?.[m.id] ?? null;
    const from = m.from ? storeById(model, m.from) : null;
    const into = m.into ? storeById(model, m.into) : null;
    const does = [m.verb, m.takes.map((one) => `${one.n} ${itemWords(one.item, one.n)}`).join(" or "), from ? `from the ${from.name}` : "", m.gives ? `into ${m.gives.n} ${m.gives.count ? m.gives.unit : itemWords(m.gives.item, m.gives.n)} in the ${into.name}` : "", `every ${everyWords(m.every)}`, m.power ? `, ${m.power} power` : ""].filter(Boolean).join(" ").replace(" ,", ",");
    const left = (minutes) => `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} h ` : ""}${Math.round(minutes % 60)} min`;
    const status = m.generator
      ? ((s?.burning ?? m.every) > 0 ? `running, ${left(s?.burning ?? m.every)} on this ${m.takes[0] ? itemWords(m.takes[0].item, 1) : "charge"}, giving ${m.power} power` : `stopped: ${s.waiting}, and nothing aboard has power`)
      : !m.runs ? "not in play"
        : !s ? "about to start"
          : s.waiting ? s.waiting
            : `at work, ${Math.max(1, Math.ceil(m.every - s.progress))} ${Math.ceil(m.every - s.progress) === 1 ? "minute" : "minutes"} to the next`;
    // A full store or nobody there at night is how things are; no power or nothing left to work from is a want.
    const bad = Boolean(s?.waiting) && (s.waiting === "no power" || / ha(?:s|ve) no /.test(s.waiting));
    return { id: m.id, name: upperFirst(m.name), room: m.roomName, does, status, waiting: Boolean(s?.waiting) || !m.runs, bad, made: s?.made ?? 0, runs: m.runs, generator: m.generator };
  });
}

// Every errand with who does it, what it is, and where they've got to. Reading this changes nothing.
export function errandsView(game, place) {
  const model = logisticsOf(place);
  if (!model) return [];
  const errands = game.logistics?.[place]?.errands ?? {};
  return model.errands.map((e) => {
    const from = storeById(model, e.from);
    const to = storeById(model, e.to);
    const s = errands[e.id] ?? null;
    return {
      id: e.id,
      who: e.who,
      does: `${itemWords(e.item, 2)} from the ${from.name} to the ${to.name} when under ${e.under}, ${e.each} at a time`,
      status: s ? errandDoing(model, e, s) : "about their day",
      busy: Boolean(s),
      waiting: Boolean(s && (s.phase === "waiting" || s.phase === "unloading")),
    };
  });
}

// The sittings: how many a day and for how many people, which is on now, and what the kettle gave today and yesterday.
export function mealsView(game, place) {
  const model = logisticsOf(place);
  if (!model?.kettles.length) return null;
  const minutes = game.clock.hours * 60;
  const day = Math.floor(minutes / 1440);
  const minute = minutes - day * 1440;
  const { at, minutes: length } = model.sittings;
  const aSitting = Math.round(((game.ship?.aboard ?? 0) * model.eats) / at.length);
  const index = sittingAt(model.sittings, minute);
  const next = at.find((start) => start > minute) ?? at[0];
  const days = game.logistics?.[place]?.meals?.days ?? {};
  return {
    sittings: at.length,
    aSitting,
    eats: model.eats,
    now: index >= 0 ? `the ${ORDINALS[index] ?? `${index + 1}th`} sitting is on, ${aSitting} people over ${length} minutes, ${Math.max(1, Math.ceil(at[index] + length - minute))} to go` : `between sittings, the next at ${clockWords(next)}`,
    today: { ...(days[day] ?? { served: 0, missed: 0 }) },
    yesterday: days[day - 1] ? { ...days[day - 1] } : null,
  };
}

// What the kettle gave and didn't on a day of the clock, for the ship's own day at midnight.
export const mealsOfDay = (game, place, day) => game.logistics?.[place]?.meals?.days?.[day] ?? null;

// Someone's "eating" when the kettle's empty finds it empty instead.
export function mealWords(game, place, doing) {
  if (!/\beating\b/i.test(doing ?? "")) return doing;
  const model = logisticsOf(place);
  if (!model?.kettles.length) return doing;
  return model.kettles.every((kettle) => countOf(game, kettle) <= 0) ? "finding the kettle empty" : doing;
}

// A store's words with how it stands now: a kettle says how much is left in it, and an emptied store says so.
export function storeLook(game, place, thing, look) {
  if (!thing?.store) return look;
  const store = logisticsOf(place)?.stores.find((one) => one.id === thing.store);
  if (!store) return look;
  if (store.count) {
    const n = countOf(game, store);
    const of = store.count.n;
    const words = n <= 0 ? "It's been scraped empty." : n < of / 4 ? `There's not much left in it, ${n} ${store.count.unit} or so.` : n < of ? `About ${n} ${store.count.unit} left in it.` : "It's full.";
    return `${look ?? ""} ${words}`.trim();
  }
  const counts = storeCounts(game, store.key, store.holds);
  return Object.values(counts).some((n) => n > 0) ? look : `${look ?? ""} It's empty now.`.trim();
}

// ---- For the checker --------------------------------------------------------------------------------

export const placesWithLogistics = () => Object.keys(WORLD_LOGISTICS).filter((place) => mapFor(place)).length;

export function logisticsProblems() {
  const problems = [...LOGISTICS_FILE_PROBLEMS];
  for (const place of Object.keys(WORLD_LOGISTICS)) {
    if (!mapFor(place)) {
      problems.push(`logistics/${place}.txt: there's no map of a place called ${place} in world/maps`);
      continue;
    }
    const model = logisticsOf(place);
    for (const one of model?.problems ?? []) problems.push(`logistics/${place}.txt${one.line ? ` (line ${one.line})` : ""}: ${one.message}`);
  }
  return problems;
}
