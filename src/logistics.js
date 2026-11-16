// The ship's logistics: nothing aboard comes from nothing. world/logistics/<place>.txt says where every stock is kept,
// and each store is a real thing in a room, full to start with, that the player can walk to and open beside their
// pack; the Ship menu reads the same count. Its machines run on the clock, at the same beat as everyone's days: each
// takes from one store and puts into another so often, while its room has power and someone's at it. The whole ship
// eats from the kettle at its sittings, and whoever finds it empty goes without, which the ship's morale feels at
// midnight. A store's line also says what it wants kept in it, when that's urgent and who carries for it, and the
// ship's work board (src/work.js) sends them. Everything here runs on this computer. public/logistics-text.js
// reads the words; this knows the maps, the items, the systems and everyone's days.

import { handsFree } from "./body.js";
import { medbayOf } from "./medbay.js";
import { ITEMS, LOCATIONS } from "./data.js";
import { storeCounts, storePut, storeTake } from "./bag.js";
import { findCharacter } from "./campaign.js";
import { rosterOf, usuallyIn, whoIsIn } from "./life.js";
import { claimedSquares, damageKinds, floorSpot, powerBalance, roomPowered, systemsOf, waitingForParts } from "./systems.js";
import { YOU, jobById, jobByWords, mutinyStage, postByWords, speedOf, tallyDuty } from "./command.js";
import { mapFor, roomHere, roomsOf, roomsOn, thingsIn } from "./walk.js";
import { LOGISTICS_FILE_PROBLEMS, WORLD_LOGISTICS } from "./world.js";
import { WORK_KINDS, everyWords, readLoadsLine, readMachineLine, readRefillLine, readStoreLine, readUrgencyLine, slugOf } from "../public/logistics-text.js";
import { KNOWN_SYSTEMS, SYSTEM_TITLES } from "../public/systems-text.js";
import { SHIP_DATA } from "./world.js";
import { refillsHeld } from "./room-hooks.js";
import { runBoard } from "./work.js";
import { KINDS, WORTH, pickWorth, worthIn, worthOf, worthTotal } from "./worth.js";

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

export const itemWords = (id, n) => {
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
// One place's, once the player has left it and its map is let go of (keepOnly in src/walk.js): made again with the map.
export const forgetLogistics = (place) => models.delete(place);
// Whether a place's stores are being stood in its map right now (src/room-hooks.js waits for them).
export const logisticsPending = (place) => compiling.has(place);

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
  const model = { place, name, file, numbers: file.numbers ?? {}, stores: [], storesIn: {}, wants: [], trip: {}, machines: [], kettles: [], sittings: file.sittings ?? DEFAULT_SITTINGS, eats: Number(file.numbers?.eats) || 2, problems };
  // Who a store's line can name to carry for it: the people doing a job ("the deckhands"), whoever holds a post ("the
  // quartermaster"), the watch bill's spare hands, or someone by name. Whoever of them is free at the time goes.
  const roster = rosterOf(place);
  const findCarrier = (words) => {
    const said = String(words).trim();
    if (/^(the\s+)?spare\s+hands?$/i.test(said)) return { spare: true, words: "the spare hands" };
    const job = jobByWords(place, said);
    if (job) return { job, words: said };
    const post = postByWords(place, said) ?? postByWords(place, said.replace(/^the\s+/i, ""));
    if (post) return { post, words: said };
    const crowd = roster.find((one) => one.name && plain(one.name) === plain(said));
    if (crowd) return { key: crowd.key, words: said };
    const person = findCharacter(null, said);
    const known = person ? roster.find((one) => one.id === person.id) : null;
    return known ? { key: known.key, words: said } : null;
  };
  const nobodyCalled = (words, forWhat) => `nobody called ${words} is a job or a post in world/command, or has a day at ${name} in world/life, to carry ${forWhat}`;
  // The file's own carried by line, for every store that doesn't say.
  const usualCarriers = [];
  for (const words of file.carriers?.list ?? []) {
    const one = findCarrier(words);
    if (one) usualCarriers.push(one);
    else at(file.carriers.line ?? null, nobodyCalled(words, "for the stores"));
  }
  // How many of a thing one person carries in a trip: one, unless the file's a trip carries line says more.
  model.trip = {};
  for (const { n, what } of file.trip?.list ?? []) {
    const item = itemByWords(what);
    if (!item) at(file.trip.line ?? null, `there's no item called ${what} in world/items, for a trip to carry`);
    else model.trip[item] = n;
  }
  // The order the board's work comes in, the most urgent first: the file's Urgency part, with any kind it leaves out
  // after the rest, in the usual order.
  const ordered = [];
  for (const raw of file.urgency ?? []) {
    const read = readUrgencyLine(raw.text);
    if (read.problem) at(raw.line ?? null, read.problem);
    else if (ordered.includes(read.kind)) at(raw.line ?? null, `${raw.text} is written twice under Urgency`);
    else ordered.push(read.kind);
  }
  model.urgency = [...ordered, ...WORK_KINDS.map(([kind]) => kind).filter((kind) => !ordered.includes(kind))];
  // Who decides what comes first on the work board, and how much each store should want: a post each, and how often
  // whoever holds it looks. Without the lines nobody decides: jobs go as they come, and stores want what's written.
  model.deciders = {};
  for (const [what, words, said] of [["first", "what comes first", file.first], ["levels", "what stores want", file.levels]]) {
    if (!said) continue;
    const post = postByWords(place, said.who) ?? postByWords(place, String(said.who).replace(/^the\s+/i, ""));
    if (!post) at(said.line ?? null, `${said.who} isn't a post in world/command, to decide ${words}`);
    else model.deciders[what] = { post, every: said.every, words: said.who };
  }
  // A job left waiting is brought to the player as an ask (src/work.js, src/requests.js): after how long, and by
  // whichever post each part of the ship belongs to. Without both lines nobody brings anything.
  model.asks = null;
  if (file.waiting && file.askers) {
    const by = {};
    for (const entry of file.askers.list) {
      const post = postByWords(place, entry.who) ?? postByWords(place, String(entry.who).replace(/^the\s+/i, ""));
      if (!post) at(file.askers.line ?? null, `${entry.who} isn't a post in world/command, to ask for ${entry.parts.join(" and ")}`);
      else for (const part of entry.parts) {
        if (by[part]) at(file.askers.line ?? null, `who asks names two posts for ${part === "rest" ? "the rest" : part}`);
        by[part] = post;
      }
    }
    model.asks = { after: { urgent: file.waiting.urgent, other: file.waiting.other }, by };
  } else if (file.waiting || file.askers) at((file.waiting ?? file.askers).line ?? null, "left waiting and who asks go together: one says after how long a job is brought to the player, the other who brings it");
  // For a job the written story gives the board (src/work.js): a room and a carrier by their words.
  model.findRoom = findRoom;
  model.findCarrier = findCarrier;
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
    if (count && (s.wants.length || s.urgent.length || s.carriers.length)) {
      at(line, `the ${s.name} holds ${count.unit}, which nobody carries: only a store of things says what it wants and who carries for it`);
      continue;
    }
    // What it wants kept in it, when that's urgent, and who carries for it. A number alone is for everything it holds.
    const wants = {};
    const urgent = {};
    const mark = (list, into, saying) => {
      for (const { n, what } of list) {
        const item = what === null ? null : itemByWords(what);
        if (what !== null && (!item || !(item in holds))) {
          at(line, `the ${s.name} ${saying} ${n} ${what}, which it doesn't hold: add it to its holds first`);
          sound = false;
        } else for (const one of item ? [item] : Object.keys(holds)) into[one] = n;
      }
    };
    mark(s.wants, wants, "wants");
    mark(s.urgent, urgent, "is urgent under");
    for (const [item, n] of Object.entries(wants)) {
      if (n >= 1 && n <= holds[item]) continue;
      at(line, n < 1 ? `the ${s.name} wants ${n} ${itemWords(item, 2)}, which is nothing to want: leave wants out, or write a number it can be short of` : `the ${s.name} holds only ${holds[item]} ${itemWords(item, 2)}, so it can't want ${n}: it would always be short`);
      sound = false;
    }
    for (const [item, n] of Object.entries(urgent)) {
      if (item in wants && n <= wants[item]) continue;
      at(line, item in wants ? `the ${s.name} wants ${wants[item]} ${itemWords(item, 2)}, so being urgent under ${n} would make it urgent whenever it's short: urgent under is the smaller number` : `the ${s.name} says when ${itemWords(item, 2)} are urgent, but not how many it wants: write wants first`);
      sound = false;
    }
    const carriers = [];
    for (const words of s.carriers) {
      const one = findCarrier(words);
      if (one) carriers.push(one);
      else {
        at(line, nobodyCalled(words, `for the ${s.name}`));
        sound = false;
      }
    }
    if (sound && Object.keys(wants).length && !carriers.length && !usualCarriers.length) {
      at(line, `the ${s.name} wants things kept in it, but nobody's named to carry them: add carried by the deckhands to its line, or a carried by line at the top of the file`);
      sound = false;
    }
    if (!sound) continue;
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
    const entry = { id, name: s.name, room: room.id, roomName: room.name, level: level.id, thing: thing.id, key: `thing:${place}:${thing.id}`, holds, count, wants, urgent, carriers: carriers.length ? carriers : usualCarriers, look: s.look, placed: !existing, line };
    model.stores.push(entry);
    (model.storesIn[room.id] ??= []).push(id);
    if (count) model.kettles.push(entry);
  }
  // Everything the stores want, in the file's order: what the work board keeps up (src/work.js).
  model.wants = model.stores.flatMap((store) => Object.keys(store.wants).map((item) => ({ store: store.id, item, wants: store.wants[item], urgent: store.urgent[item] ?? 0, line: store.line })));
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
    for (const { n, what, any } of m.takes) {
      // "any food": whatever else in the store is worth something of that kind (src/worth.js).
      if (any) {
        const kind = KINDS.find((one) => one === any || WORTH[one] === any) ?? null;
        if (kind !== "food") {
          at(line, `the ${m.name} can take any food, and nothing else by its kind: ${what} isn't something a machine works from`);
          sound = false;
        } else takes.push({ kind });
        continue;
      }
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
    // A worker the words name by their job ("a cook") has to be someone the watch bill has doing it.
    const job = m.needs?.worker ? jobByWords(place, m.needs.worker.replace(/\s+there$/i, "")) : null;
    const needs = job ? { ...m.needs, job } : m.needs;
    model.machines.push({ id, name: m.name, verb: m.verb, room: room.id, roomName: room.name, takes, from: from?.id ?? null, gives, into: into?.id ?? null, every: m.every, needs, power: m.power, generator, runs: Boolean(gives) || generator, line, text: raw.text });
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
  // The refills: what comes into a store from outside, how often and how far. From nothing, until trade off the ship
  // is built, which is the one place something still comes from nowhere.
  model.refills = [];
  for (const raw of file.refills ?? []) {
    const line = raw.line ?? null;
    const r = readRefillLine(raw.text);
    if (r.problem) {
      at(line, r.problem);
      continue;
    }
    const store = findStore(r.store);
    if (!store) {
      at(line, `there's no store called ${r.store} to refill: the stores are ${storeNames()}`);
      continue;
    }
    if (store.count) {
      at(line, `the ${store.name} holds ${store.count.unit}, not things that come aboard: a refill names a store of things`);
      continue;
    }
    const items = [];
    let sound = true;
    for (const words of r.what) {
      const item = itemByWords(words);
      if (!item) {
        at(line, `there's no item called ${words} in world/items to come into the ${store.name}`);
        sound = false;
      } else if (!(item in store.holds)) {
        at(line, `the ${store.name} doesn't keep ${words}: add it to the ${store.name}'s holds line`);
        sound = false;
      } else items.push(item);
    }
    if (!sound) continue;
    if (model.refills.some((one) => one.store === store.id)) {
      at(line, `the ${store.name} is refilled twice: write what comes into it on one line`);
      continue;
    }
    model.refills.push({ store: store.id, items, every: r.every, upTo: r.upTo, line, text: raw.text });
  }
  // What the engineers' repairs take: so many of an item, from which stores first to last, for which kinds of damage.
  model.repair = null;
  const r = file.repair;
  if (r?.n > 0) {
    const line = r.line ?? null;
    let sound = true;
    const item = itemByWords(r.what);
    if (!item) {
      at(line, `there's no item called ${r.what} in world/items, for a repair to take`);
      sound = false;
    }
    const from = [];
    for (const words of r.from ?? []) {
      const store = findStore(words);
      if (!store) {
        at(line, `there's no store called ${words} for a repair's ${r.what} to come from: the stores are ${storeNames()}`);
        sound = false;
      } else if (item && (store.count || !(item in store.holds))) {
        at(line, `the ${store.name} doesn't keep ${r.what}, for a repair to take: add it to the ${store.name}'s holds line`);
        sound = false;
      } else from.push(store.id);
    }
    const kinds = damageKinds();
    for (const word of r.damage ?? []) {
      if (kinds.has(word)) continue;
      at(line, `nothing is ever ${word}: the kinds of damage are ${[...kinds].join(", ")}`);
      sound = false;
    }
    const keeping = item ? model.stores.filter((store) => !store.count && item in store.holds).map((store) => store.id) : [];
    if (sound && !from.length && !keeping.length) at(line, `no store keeps ${r.what}, for a repair to take`);
    else if (sound) model.repair = { item, n: r.n, from: from.length ? from : keeping, damage: r.damage ?? [], line };
  }
  // What the bench makes from salvage (step 6 of the loot plan, src/making.js): so many of an item from so much
  // salvage (each item's own salvage line says what it counts for), in a room, in so many hours, into which stores
  // first to last, or the player's pack.
  model.making = null;
  const mk = file.making;
  if (mk?.n > 0) {
    const line = mk.line ?? null;
    let sound = true;
    const item = itemByWords(mk.what);
    if (!item) {
      at(line, `there's no item called ${mk.what} in world/items, for salvage to make`);
      sound = false;
    }
    const room = findRoom(mk.room);
    if (!room) {
      at(line, `${name} has no room called ${mk.room}, for salvage to be made into ${mk.what} in`);
      sound = false;
    }
    const into = [];
    for (const words of mk.into ?? []) {
      const store = findStore(words);
      if (!store) {
        at(line, `there's no store called ${words} for what salvage makes to go into: the stores are ${storeNames()}`);
        sound = false;
      } else if (item && (store.count || !(item in store.holds))) {
        at(line, `the ${store.name} doesn't keep ${mk.what}: add it to the ${store.name}'s holds line`);
        sound = false;
      } else into.push(store.id);
    }
    if (sound) model.making = { item, n: mk.n, per: mk.per, room: room.id, roomName: room.name, hours: mk.hours, into, line };
  }
  return model;
}

// ---- The counts -------------------------------------------------------------------------------------

export const storeById = (model, id) => model.stores.find((store) => store.id === id) ?? null;
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
// The first of a machine's choices that the store has enough of. A choice by kind ("any food") is whatever else in
// the store is worth something of that kind, as much as one go of the machine makes and no more: the biggest that
// fit first (src/worth.js). Null when the store has none of them.
function pickTake(game, store, takes, most = Infinity) {
  const counts = storeCounts(game, store.key, store.holds);
  const named = takes.filter((one) => one.item).map((one) => one.item);
  for (const one of takes) {
    if (one.item && (counts[one.item] ?? 0) >= one.n) return one;
    if (one.kind) {
      const picked = pickWorth(counts, one.kind, most, named);
      if (picked.length) return { kind: one.kind, picked, worth: picked.reduce((sum, each) => sum + each.n * each.worth, 0) };
    }
  }
  return null;
}
const takesWords = (takes) => takes.map((one) => (one.kind ? `other ${one.kind}` : itemWords(one.item, 2))).join(" or ");
// "the pantry is full", "the garden bins are full".
const isFull = (store) => `the ${store.name} ${/s$/i.test(store.name) ? "are" : "is"} full`;

// ---- Everything aboard of a kind -----------------------------------------------------------------------

// The stores a kind of goods is used up from at a place: the ones the kettle's machines cook from, for food, and the
// ones a repair's line names, for parts. (The medbay says where its medicine is kept: src/medbay.js.)
export function usedFrom(place, kind) {
  const model = logisticsOf(place);
  if (!model) return [];
  if (kind === "food") return [...new Set(model.machines.filter((m) => m.gives?.count && m.from).map((m) => m.from))];
  if (kind === "parts") return model.repair?.from ?? [];
  return [];
}
// What everything else of a kind comes to, in the stores it's used from, besides the items the ship counts by name:
// a tin in the pantry is a sitting toward the food aboard, a medkit in the cabinet four doses toward the medicine
// (src/worth.js). Nothing where the place has no logistics.
export function worthAboard(game, place, kind, storeIds, skip = []) {
  const model = logisticsOf(place);
  if (!model) return 0;
  let worth = 0;
  for (const id of storeIds) {
    const store = storeById(model, id);
    if (store && !store.count) worth += worthTotal(storeCounts(game, store.key, store.holds), kind, skip);
  }
  return worth;
}

// What an item is worth to a place's ship, and the store it has to be in for that, in a line for the inventory:
// "Feeds 1 at the kettle, once it's in the pantry." Null for an item that's worth nothing there.
export function worthLine(place, id) {
  const model = logisticsOf(place);
  const kind = model ? KINDS.find((one) => worthOf(id, one) > 0) : null;
  if (!kind) return null;
  const n = worthOf(id, kind);
  const ids = kind === "medicine" ? [medbayOf(place)?.medicine?.store] : usedFrom(place, kind);
  const names = ids.map((one) => storeById(model, one)?.name).filter(Boolean);
  if (!names.length) return null;
  const where = `the ${names.length > 1 ? `${names.slice(0, -1).join(", the ")} or the ${names.at(-1)}` : names[0]}`;
  if (kind === "food") return `Feeds ${n} at the kettle, once it's in ${where}.`;
  if (kind === "medicine") return `${n} dose${n === 1 ? "" : "s"} for the medbay, once it's in ${where}.`;
  return `${n === 1 ? "One repair's" : `${n} repairs'`} worth of spares, in ${where}.`;
}

// How many of some items are aboard a place, over every store that keeps them, and how many those stores hold in
// all: for the Ship menu's count of food, medicine and parts, which is the same count as the stores. Null where the
// place has no logistics, so the ship can fall back on her old numbers.
export function countAboard(game, place, items) {
  const model = logisticsOf(place);
  if (!model) return null;
  const wanted = Array.isArray(items) ? items : [items];
  let n = 0;
  let of = 0;
  for (const store of model.stores) {
    if (store.count) continue;
    const counts = storeCounts(game, store.key, store.holds);
    for (const item of wanted) {
      if (!(item in store.holds)) continue;
      n += counts[item] ?? 0;
      of += store.holds[item];
    }
  }
  return { n, of };
}

// A store by what it's called, "the pantry" or "medicine cabinet", or by its id. Null when there's no such store.
const storeWords = (words) => String(words ?? "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
export function storeByWords(place, words) {
  const want = storeWords(words);
  if (!want) return null;
  return logisticsOf(place)?.stores.find((store) => storeWords(store.name) === want || store.id === want.replace(/ /g, "_")) ?? null;
}
// The names of a place's stores of things, for saying which there are.
export const storeNames = (place) => (logisticsOf(place)?.stores ?? []).filter((store) => !store.count).map((store) => `the ${store.name}`);

// How many of an item a place's stores hold: in one store, named, or in all of them. Null where the place has no
// logistics, or no such store. Reading it changes nothing.
export function stockOf(game, place, item, storeName = null) {
  if (!storeName) return countAboard(game, place, item)?.n ?? null;
  const store = storeByWords(place, storeName);
  if (!store || store.count) return null;
  return storeCounts(game, store.key, store.holds)[item] ?? 0;
}

// The stores that keep an item, in the file's order, or in the order of the ids given.
function storesKeeping(model, item, order = null) {
  const keeping = model.stores.filter((store) => !store.count && item in store.holds);
  if (!order) return keeping;
  return [...order.map((id) => keeping.find((store) => store.id === id)).filter(Boolean), ...keeping.filter((store) => !order.includes(store.id))];
}

// Puts so many of an item into the place's stores that keep it, the first with room first. Says how many went in, and
// tells onPut, if it's given, how many went into each store.
export function putAboard(game, place, item, n, order = null, onPut = null) {
  const model = logisticsOf(place);
  if (!model) return 0;
  let left = n;
  for (const store of storesKeeping(model, item, order)) {
    if (left <= 0) break;
    const put = storePut(game, store.key, store.holds, item, left);
    left -= put;
    if (put) onPut?.(store, put);
  }
  return n - left;
}

// Takes so many of an item from the place's stores that keep it, in the file's order or the order given. Says how
// many came out.
export function takeAboard(game, place, item, n, order = null) {
  const model = logisticsOf(place);
  if (!model) return 0;
  let left = n;
  for (const store of storesKeeping(model, item, order)) {
    if (left <= 0) break;
    left -= storeTake(game, store.key, store.holds, item, left);
  }
  return n - left;
}

// Every store of things filled to what it holds: for tests, and for a game that wants to start from full.
export function fillStores(game, place) {
  const model = logisticsOf(place);
  if (!model) return;
  for (const store of model.stores) {
    if (store.count) {
      setCount(game, store, store.count.n);
      continue;
    }
    for (const [item, holds] of Object.entries(store.holds)) {
      const have = storeCounts(game, store.key, store.holds)[item] ?? 0;
      if (have < holds) storePut(game, store.key, store.holds, item, holds - have);
    }
  }
}

// How much the rations stretch or cut what everyone eats: standard is one.
const rationsFactor = (game) => SHIP_DATA.rations?.[game.ship?.rations]?.food ?? 1;

// How many sittings a crate or a basket makes, from the file's numbers at the top, or the galley's own line.
function sittingsAUnit(model) {
  if (model.numbers?.crateFeeds) return model.numbers.crateFeeds;
  const galley = model.machines.find((m) => m.gives?.count);
  return galley?.gives.n ?? 200;
}

// How many of some items the refills from nothing can bring aboard in a day: a store topped up to full every so often
// can give its whole capacity each time. Zero where nothing refills them.
export function refilledADay(game, place, items) {
  const model = logisticsOf(place);
  if (!model || refillsHeld(game, place)) return 0;
  const wanted = Array.isArray(items) ? items : [items];
  let aDay = 0;
  for (const r of model.refills) {
    const store = storeById(model, r.store);
    for (const item of r.items) {
      if (!wanted.includes(item)) continue;
      const upTo = r.upTo === "full" ? store.holds[item] : Math.min(store.holds[item], r.upTo);
      aDay += (upTo * 1440) / r.every;
    }
  }
  return aDay;
}

// How many crates or baskets the whole ship eats in a day, with the rations as they are, or as they might be. Null
// where there are no sittings.
export function foodADay(game, place, factor = rationsFactor(game)) {
  const model = logisticsOf(place);
  if (!model?.kettles.length) return null;
  return ((game.ship?.aboard ?? 0) * model.eats * factor) / sittingsAUnit(model);
}

// ---- The clock -----------------------------------------------------------------------------------

// The state of a place's logistics in the save: when it was last run, each machine's progress, and the day's meals.
function stateOf(game, place) {
  game.logistics ??= {};
  return game.logistics[place] ??= { at: null, machines: {}, meals: { days: {}, carry: 0, dry: false }, jobs: [] };
}

// ---- The carrying ---------------------------------------------------------------------------------
// Who carries what between the stores, and when, is the work board's (src/work.js): this file reads what each store
// wants and who carries for it, and its clock runs the board with everything else.

// How many of a thing one person carries in a trip.
export const tripOf = (model, item) => model.trip?.[item] ?? 1;
// Whether a machine has nothing left in its store to work from: the generator on its last cell, the galley with a
// bare pantry. That's when it asks the board for more, however the store's own line counts it.
export const machineStarved = (game, model, m) => Boolean(m.from) && m.takes.length > 0 && !pickTake(game, storeById(model, m.from), m.takes, aGo(m));

const loadWords = (item, n) => `${n} ${itemWords(item, n)}`;

// Who's at work in a room at a moment: the player standing there, and anyone whose day puts them there, awake.
export function workersIn(game, place, roomId, hours) {
  const names = whoIsIn(game, place, roomId, hours);
  if (game.location === place && game.walk && roomHere(game)?.id === roomId) names.unshift("you");
  return names;
}

// Why a machine isn't making anything at a minute of the clock, or null while it's running. Who's there comes from
// everyone's days as written (the same however a jump of the clock is cut up), and the player standing in the room.
function whyWaiting(game, place, m, from, into, minute, you, workers = null) {
  if (m.needs.power && !roomPowered(game, place, m.room)) return "no power";
  if (m.needs.worker && you !== m.room && !(workers ?? usuallyIn(game, place, m.room, minute % 1440, m.needs.job)).length) return `waiting for ${m.needs.worker}`;
  if (into) {
    const room = roomFor(game, into, m.gives);
    if (room < m.gives.n) return room > 0 ? `no room in the ${into.name} for ${m.gives.n} ${m.gives.count ? "sittings" : itemWords(m.gives.item, m.gives.n)} yet` : isFull(into);
  }
  if (from && !pickTake(game, from, m.takes, aGo(m))) return `the ${from.name} ${/s$/i.test(from.name) ? "have" : "has"} no ${takesWords(m.takes)}`;
  return null;
}
// How much one go of a machine makes at most, for a machine that takes whatever it's given: a pot of so many sittings.
const aGo = (m) => (m.gives?.count ? m.gives.n : Infinity);

// One machine over one piece of the clock. It's at work while it has power and someone there, and its progress
// builds up to one go, so that what's ready goes in as soon as there's room for it, or something to make it from.
function runMachine(game, place, model, m, state, minute, minutes, you) {
  const s = state.machines[m.id] ??= { progress: 0, made: 0, waiting: null };
  const from = m.from ? storeById(model, m.from) : null;
  const into = m.into ? storeById(model, m.into) : null;
  // Who's at it, asked once: whether it waits for someone, and how fast they go. Someone with a hand that's no use
  // can't do the work.
  const workers = m.needs.worker ? usuallyIn(game, place, m.room, minute % 1440, m.needs.job).filter((who) => handsFree(game, place, who)) : null;
  const why = whyWaiting(game, place, m, from, into, minute, you, workers);
  const atWork = why === null || (why !== "no power" && !why.startsWith("waiting for "));
  // A machine that needs someone doing a job goes as fast as the best of them at that job's skill.
  const speed = atWork && m.needs.job ? speedOf(game, place, you === m.room ? [...workers, YOU] : workers, jobById(place, m.needs.job)?.skills[0]) : 1;
  if (atWork) s.progress = Math.min(m.every, s.progress + minutes * speed);
  s.waiting = why;
  while (why === null && s.progress >= m.every) {
    const take = from ? pickTake(game, from, m.takes, aGo(m)) : null;
    if ((from && !take) || (into && roomFor(game, into, m.gives) < m.gives.n)) break;
    // What a go gives: what its line says, unless what went in says what it feeds (src/worth.js). A pot of tins makes
    // as many sittings as the tins were worth, and a crate makes what a crate is worth.
    let gives = m.gives.n;
    if (take?.kind) {
      for (const each of take.picked) storeTake(game, from.key, from.holds, each.item, each.n);
      gives = take.worth;
    } else if (from) {
      storeTake(game, from.key, from.holds, take.item, take.n);
      if (m.gives.count) gives = worthOf(take.item, "food") * take.n || m.gives.n;
    }
    if (m.gives.count) setCount(game, into, countOf(game, into) + gives);
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
  // Old days are let go once the ship's own day has had them, a few days on: once a day, whenever the day turns.
  if (meals.pruned !== day) {
    meals.pruned = day;
    const keep = Math.min(day, game.ship?.day ?? day) - 3;
    for (const key of Object.keys(meals.days)) if (Number(key) < keep) delete meals.days[key];
  }
  const index = sittingAt(model.sittings, t - day * 1440);
  if (index < 0) return;
  const aboard = game.ship?.aboard ?? 0;
  // The rations stretch or cut what each sitting takes from the kettle.
  const aSitting = (aboard * model.eats * rationsFactor(game)) / model.sittings.at.length;
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

// The refills over one piece of the clock: on the hour the file says, every store written is topped up from nothing,
// and the manifest says what came aboard.
const clockWordsAt = (t) => `Day ${Math.floor(t / 1440) + 1}, ${clockWords(t % 1440)}`;
function runRefills(game, place, model, state, t) {
  // Nothing comes from nothing while something else supplies the place: the dock, paid for (src/room-hooks.js).
  if (!model.refills.length || refillsHeld(game, place)) return;
  state.refills ??= { log: [] };
  for (const r of model.refills) {
    // The hour's mark that falls in this piece of the clock, if one does. In play the clock runs by the second, so
    // the pieces don't start on the minute, let alone on the hour.
    const mark = Math.ceil(t / r.every) * r.every;
    if (mark >= t + CHUNK) continue;
    const store = storeById(model, r.store);
    const came = [];
    for (const item of r.items) {
      const have = storeCounts(game, store.key, store.holds)[item] ?? 0;
      const upTo = r.upTo === "full" ? store.holds[item] : Math.min(store.holds[item], r.upTo);
      if (upTo - have <= 0) continue;
      const put = storePut(game, store.key, store.holds, item, upTo - have);
      if (put > 0) came.push(loadWords(item, put));
    }
    if (!came.length) continue;
    state.refills.log.push({ at: mark, text: `${came.length > 1 ? `${came.slice(0, -1).join(", ")} and ${came.at(-1)}` : came[0]} came aboard into the ${store.name}.` });
    if (state.refills.log.length > 20) state.refills.log.splice(0, state.refills.log.length - 20);
  }
}

// The manifest: what's come aboard lately, newest first, for the lighter bay's clip and the ship's computers.
export function manifestLines(game, place) {
  const model = logisticsOf(place);
  if (!model?.refills.length) return [];
  const log = game.logistics?.[place]?.refills?.log ?? [];
  return [...log].reverse().map((entry) => `${clockWordsAt(entry.at)}: ${entry.text}`);
}

// Every refill with its store, what comes, how often, and the last time it did. Reading this changes nothing.
export function refillsView(game, place) {
  const model = logisticsOf(place);
  if (!model) return [];
  const log = game.logistics?.[place]?.refills?.log ?? [];
  return model.refills.map((r) => {
    const store = storeById(model, r.store);
    const last = [...log].reverse().find((entry) => entry.text.endsWith(`into the ${store.name}.`)) ?? null;
    return {
      id: r.store,
      store: upperFirst(store.name),
      does: `${r.items.map((item) => itemWords(item, 2)).join(" and ")} from nothing, every ${everyWords(r.every)}, up to ${r.upTo === "full" ? "full" : r.upTo}`,
      last: last ? `${clockWordsAt(last.at)}: ${last.text}` : null,
    };
  });
}

// ---- The engineers' repairs -----------------------------------------------------------------------

// What a repair of a kind of damage takes at a place, from its file's "a repair takes" line: so many of an item,
// fetched from its stores first to last. Null where the file doesn't say, or the line leaves that damage out.
export function repairNeeds(place, damage = "broken") {
  const r = logisticsOf(place)?.repair;
  if (!r || (r.damage.length && !r.damage.includes(damage))) return null;
  return r;
}
const partsWords = (r) => (r.n === 1 ? `a ${itemWords(r.item, 1)}` : loadWords(r.item, r.n));
const listWords = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} or ${list.at(-1)}` : list[0] ?? "");
// What one of an item is worth toward a repair: what its file says (src/worth.js), or one, as it always was.
const spareOf = (id) => worthOf(id, "parts") || 1;
// What a repair's line asks for, in that worth: one parts crate is one repair's worth of spares.
const sparesWanted = (r) => r.n * spareOf(r.item);
// What a store has toward a repair: the line's own item, and anything else in it that's worth a repair.
function sparesIn(game, store, r) {
  const counts = storeCounts(game, store.key, store.holds);
  return (counts[r.item] ?? 0) * spareOf(r.item) + worthTotal(counts, "parts", [r.item]);
}
const inStores = (game, model, r) => r.from.reduce((sum, id) => sum + sparesIn(game, storeById(model, id), r), 0);
// Takes up to so much worth of spares out of a store: the line's own item first, then whatever else there is worth a
// repair, the least first, so nothing big goes on a small need. Says how much came out, and what.
function takeSpares(game, store, r, want) {
  let got = 0;
  const what = [];
  const take = (item, each) => {
    const n = storeTake(game, store.key, store.holds, item, Math.ceil((want - got) / each));
    if (n <= 0) return;
    got += n * each;
    what.push({ item, n });
  };
  take(r.item, spareOf(r.item));
  for (const one of worthIn(storeCounts(game, store.key, store.holds), "parts", [r.item]).reverse()) {
    if (got >= want) break;
    take(one.item, one.worth);
  }
  return { got, what };
}
// "a parts crate", or "" for a repair that takes nothing.
export const repairPartsWords = (place, damage) => {
  const r = repairNeeds(place, damage);
  return r ? partsWords(r) : "";
};
// "there isn't a parts crate in the stores", for the line that says a repair is waiting.
export const noPartsWords = (place, damage) => {
  const r = repairNeeds(place, damage);
  if (!r) return "";
  return r.n === 1 ? `there isn't ${partsWords(r)} in the stores` : `there aren't ${partsWords(r)} in the stores`;
};
// Whether there's enough in the stores for a repair now. A repair that takes nothing always has what it needs.
export function repairPartsAboard(game, place, damage) {
  const r = repairNeeds(place, damage);
  return !r || inStores(game, logisticsOf(place), r) >= sparesWanted(r);
}
// The store an engineer goes to for a repair: the first of the line's with enough in it, or else the first, where
// they'll find out there isn't any. Null for a repair that takes nothing.
export function repairStore(game, place, damage) {
  const r = repairNeeds(place, damage);
  if (!r) return null;
  const model = logisticsOf(place);
  const stores = r.from.map((id) => storeById(model, id));
  return stores.find((store) => sparesIn(game, store, r) >= sparesWanted(r)) ?? stores[0];
}
// Takes what a repair needs from the stores, first to last, and writes it in the repairs' log. Gives the words for
// the line that says it's fixed, "a parts crate from the parts lockers", or "" for a repair that takes nothing. Null,
// taking nothing, while there isn't enough in the stores.
export function takeRepairParts(game, place, damage, what) {
  const r = repairNeeds(place, damage);
  if (!r) return "";
  const model = logisticsOf(place);
  if (inStores(game, model, r) < sparesWanted(r)) return null;
  let left = sparesWanted(r);
  const from = [];
  const used = [];
  for (const id of r.from) {
    if (left <= 0) break;
    const store = storeById(model, id);
    const took = takeSpares(game, store, r, left);
    if (took.got > 0) from.push(store.name);
    used.push(...took.what);
    left -= took.got;
  }
  // "a parts crate", as the line has it, unless something else that's worth a repair went into it.
  const asAsked = used.every((one) => one.item === r.item);
  const words = `${asAsked ? partsWords(r) : listWords(used.map((one) => (one.n === 1 ? `a ${itemWords(one.item, 1)}` : loadWords(one.item, one.n)))).replace(/ or ([^,]+)$/, " and $1")} from the ${from.join(" and the ")}`;
  const state = stateOf(game, place);
  state.repairs ??= { log: [] };
  state.repairs.log.push({ at: minutesOf(game.clock.hours), text: `${upperFirst(words)}, for ${what}.` });
  if (state.repairs.log.length > 20) state.repairs.log.splice(0, state.repairs.log.length - 20);
  return words;
}
// For the Ship menu: what a repair takes, what's waiting for it, and the last one made. Reading this changes nothing.
export function repairsView(game, place) {
  const model = logisticsOf(place);
  const r = model?.repair;
  if (!r) return null;
  const last = game.logistics?.[place]?.repairs?.log?.at(-1) ?? null;
  return {
    does: `${partsWords(r)}, from the ${r.from.map((id) => storeById(model, id).name).join(" or the ")}${r.damage.length ? `, for what's ${listWords(r.damage)}` : ""}`,
    waiting: waitingForParts(game, place),
    last: last ? `${clockWordsAt(last.at)}: ${last.text}` : null,
  };
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
    if (!model) continue;
    const state = stateOf(game, place);
    if (state.at === null) {
      state.at = until;
      continue;
    }
    if (until < state.at) continue;
    const you = game.location === place && game.walk ? roomHere(game)?.id ?? null : null;
    let t = state.at;
    // Whether systems are let go for want of power changes only when the generator does, or with the parts, so it's
    // looked at once an hour, or as soon as the supply changes.
    let supplyWas = undefined;
    let balanceAt = -Infinity;
    let dropping = false;
    // What the posts' duty counts is added up through each day here, and handed over when the day turns or this ends.
    let counted = { day: Math.floor(t / 1440), powerShort: 0, errandsWaiting: 0, repairsLeft: 0 };
    const handOver = () => tallyDuty(game, place, counted.day, { powerShort: counted.powerShort, errandsWaiting: counted.errandsWaiting, repairsLeft: counted.repairsLeft });
    while (t + CHUNK <= until) {
      for (const m of model.machines) {
        if (m.generator) runGenerator(game, model, m, state, CHUNK);
        else if (m.runs) runMachine(game, place, model, m, state, t, CHUNK, you);
      }
      serveMeals(game, place, model, state, t, CHUNK, notes);
      runRefills(game, place, model, state, t);
      // The board says what it couldn't give to anyone: something a store is badly short of, that some other store
      // could spare, with nobody able to carry it, which is what counts as an errand left waiting; and a repair the
      // ship can't do without, with nobody to send to it.
      const left = runBoard(game, place, model, state, t, CHUNK, notes);
      // What the posts' duty counts: the minutes the generator was short of the loads, and the minutes urgent jobs
      // stood with nobody on them.
      const supply = powerSupply(game, place);
      if (supply !== supplyWas || t - balanceAt >= 60) {
        dropping = Boolean(powerBalance(game, place)?.dropped.length);
        supplyWas = supply;
        balanceAt = t;
      }
      if (Math.floor(t / 1440) !== counted.day) {
        handOver();
        counted = { day: Math.floor(t / 1440), powerShort: 0, errandsWaiting: 0, repairsLeft: 0 };
      }
      if ((supply !== null && supply <= 0) || dropping) counted.powerShort += CHUNK;
      counted.errandsWaiting += left.carrying * CHUNK;
      counted.repairsLeft += left.repairs * CHUNK;
      t += CHUNK;
    }
    handOver();
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

// How full one of a place's stores is, for the room's picture (public/iso.js stacks crates, cells or soup by it): the
// share of what it keeps that it has, and of what. Reading this changes nothing.
export function storeStock(game, place, storeId) {
  const store = logisticsOf(place)?.stores.find((one) => one.id === storeId);
  if (!store) return null;
  const share = (n, of) => (of > 0 ? Math.max(0, Math.min(1, n / of)) : 0);
  if (store.count) return { full: share(countOf(game, store), store.count.n), unit: store.count.unit };
  const counts = storeCounts(game, store.key, store.holds);
  const goods = Object.entries(store.holds).map(([item, of]) => ({ item, n: Math.min(of, counts[item] ?? 0), of }));
  const of = goods.reduce((sum, one) => sum + one.of, 0);
  return { full: share(goods.reduce((sum, one) => sum + one.n, 0), of), goods };
}

// What grows at a place and how much it's grown, for the room's picture of its beds: each growing machine's room and
// how many times it's given what it grows, which only goes up while it's working. Reading this changes nothing.
export function growingAt(game, place) {
  const model = logisticsOf(place);
  if (!model) return [];
  return model.machines.filter((m) => /^grows?$/i.test(m.verb ?? "")).map((m) => ({ room: m.room, made: game.logistics?.[place]?.machines?.[m.id]?.made ?? 0 }));
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
    const does = [m.verb, m.takes.map((one) => (one.kind ? `any ${one.kind}` : `${one.n} ${itemWords(one.item, one.n)}`)).join(" or "), from ? `from the ${from.name}` : "", m.gives ? `into ${m.gives.n} ${m.gives.count ? m.gives.unit : itemWords(m.gives.item, m.gives.n)} in the ${into.name}` : "", `every ${everyWords(m.every)}`, m.power ? `, ${m.power} power` : ""].filter(Boolean).join(" ").replace(" ,", ",");
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
    aSitting: Math.round(aSitting * rationsFactor(game)),
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
  if (model.kettles.every((kettle) => countOf(game, kettle) <= 0)) return "finding the kettle empty";
  // While a mutiny's brewing, the mess is where it's talked about.
  return mutinyStage(game, place) >= 1 ? `${doing}, and grumbling about the captain` : doing;
}

// A store's words with how it stands now: a kettle says how much is left in it, an emptied store says so, and one
// that's refilled from outside carries its manifest, the last few things that came aboard.
export function storeLook(game, place, thing, look) {
  if (!thing?.store) return look;
  const model = logisticsOf(place);
  const store = model?.stores.find((one) => one.id === thing.store);
  if (!store) return look;
  if (store.count) {
    const n = countOf(game, store);
    const of = store.count.n;
    const words = n <= 0 ? "It's been scraped empty." : n < of / 4 ? `There's not much left in it, ${n} ${store.count.unit} or so.` : n < of ? `About ${n} ${store.count.unit} left in it.` : "It's full.";
    return `${look ?? ""} ${words}`.trim();
  }
  const counts = storeCounts(game, store.key, store.holds);
  let words = Object.values(counts).some((n) => n > 0) ? look ?? "" : `${look ?? ""} It's empty now.`.trim();
  if (model.refills.some((r) => r.store === store.id)) {
    const lately = manifestLines(game, place).filter((line) => line.endsWith(`into the ${store.name}.`)).slice(0, 3);
    words = `${words} The manifest says: ${lately.length ? lately.join(" ") : "nothing has come aboard yet."}`.trim();
  }
  return words;
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
