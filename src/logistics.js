// The ship's logistics: nothing aboard comes from nothing. world/logistics/<place>.txt says where every stock is kept,
// and each store is a real thing in a room, full to start with, that the player can walk to and open beside their
// pack; the Ship menu reads the same count. The file's other parts (machines, loads, errands, refills) are read and
// checked for their shape, and come to life step by step. Everything here runs on this computer, and the AI isn't
// told any of it yet. public/logistics-text.js reads the words; this knows the maps and the items.

import { ITEMS, LOCATIONS } from "./data.js";
import { storeCounts } from "./bag.js";
import { claimedSquares, floorSpot, systemsOf } from "./systems.js";
import { mapFor, roomsOf, roomsOn, thingsIn } from "./walk.js";
import { LOGISTICS_FILE_PROBLEMS, WORLD_LOGISTICS } from "./world.js";
import { readStoreLine, slugOf } from "../public/logistics-text.js";

const plain = (words) => String(words ?? "").toLowerCase().replace(/['’]/g, "").replace(/^the\s+/, "").replace(/\s+/g, " ").trim();
const upperFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : "");
// A store can hold a count of something that isn't an item you pick up: the kettle's sittings.
const COUNT_UNITS = ["sittings"];

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

// "12 ration crates and 12 produce", or "400 sittings".
export function describeHolds(holds, count = null) {
  if (count) return `${count.n} ${count.unit}`;
  const parts = Object.entries(holds ?? {}).map(([id, n]) => {
    const name = ITEMS[id]?.name ?? id;
    return `${n} ${n === 1 || /produce$/i.test(name) ? name.toLowerCase() : `${name.toLowerCase()}s`}`;
  });
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

// A free square of the room for a store the map hasn't drawn, clear of names, parts and the other stores.
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
  const model = { place, name, file, numbers: file.numbers ?? {}, stores: [], storesIn: {}, problems };
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
  }
  return model;
}

// ---- What the player sees ------------------------------------------------------------------------

// Every store of a place with what's in it now: what's been taken out and put back is kept in the save, and before
// that it's what the file says, so a store starts full. Reading this changes nothing.
export function storesView(game, place) {
  const model = logisticsOf(place);
  if (!model) return [];
  return model.stores.map((store) => {
    if (store.count) {
      const n = game.stores?.[store.key]?.count ?? store.count.n;
      return { id: store.id, name: upperFirst(store.name), room: store.roomName, items: [], count: { n, of: store.count.n, unit: store.count.unit }, full: n >= store.count.n };
    }
    const counts = storeCounts(game, store.key, store.holds);
    const items = Object.keys(store.holds).map((id) => ({ id, name: ITEMS[id]?.name ?? id, n: counts[id] ?? 0, of: store.holds[id] }));
    for (const [id, n] of Object.entries(counts)) if (!(id in store.holds)) items.push({ id, name: ITEMS[id]?.name ?? id, n, of: 0 });
    return { id: store.id, name: upperFirst(store.name), room: store.roomName, items, count: null, full: items.every((one) => one.n >= one.of) };
  });
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
