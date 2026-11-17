// What's in the containers (the loot plan): world/loot/containers.txt, read by
// public/loot-text.js, names the kinds of container, what a thing has to be called to be one, how big each is inside
// and how many things it holds, which rooms and places hold more or fewer, how often each rarity turns up, what the
// furniture on the decks opens as, which rooms everywhere else get a container of their own, and the things that open
// as another kind or not at all; each item's file says which kinds it's found in (found in:) and how rare it is
// (rarity:). This reads it all, says which kind a thing or a piece of furniture is, and tells the checker what's wrong.
// Since step 3 the Meridian's containers open (the things named like one, and the lockers, shelves, desks and barrels
// on her decks), and since step 4 every place's: the things named like one, and a container of its own in each room
// the file names. Each is filled the first time it's opened (src/bag.js keeps what's in it from then on).

import fs from "node:fs";
import path from "node:path";
import { FURNITURE_BY_ID, squaresOf } from "../public/furniture.js";
import { parseLootText, RARITIES } from "../public/loot-text.js";
import { seeded, weighted } from "./body.js";
import { ITEMS, LOCATIONS } from "./data.js";
import { logisticsPending } from "./logistics.js";
import { worldDir } from "./paths.js";
import { addChecker, addMapWork, addThingActs } from "./room-hooks.js";
import { claimedSquares, floorSpot, systemsOf, systemsPending } from "./systems.js";
import { mapFor } from "./walk.js";

export const LOOT_DIR = process.env.GAME_LOOT_DIR ?? path.join(worldDir, "loot");
const FILE = "containers.txt";
const where = (line) => `world/loot/${FILE}${line ? `, line ${line}` : ""}`;

let cached = null;
// The file, read once, with its problems; null when there's no file.
export function lootModel() {
  if (cached !== null) return cached || null;
  const file = path.join(LOOT_DIR, FILE);
  if (!fs.existsSync(file)) {
    cached = false;
    return null;
  }
  const { value, problems } = parseLootText(fs.readFileSync(file, "utf8"));
  cached = { ...value, problems: problems.map((one) => `${where(one.line)}: ${one.message}`) };
  return cached;
}
// Read the file again next time, as after the Story board saves it.
export const reloadLoot = () => { cached = null; };

const plain = (words) => String(words ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim();
const hasWords = (name, words) => ` ${plain(name)} `.includes(` ${plain(words)} `);

// What a name is a name of, the way public/furniture.js reads it: the words before anything that only says where it is
// or what's with it ("The drawing under the desks" is a drawing, "A footlocker with no name on it" a footlocker), with
// "a stack of" and the like looked past ("A stack of medical crates" is medical crates); and its last word, with
// anything "of" cut off too ("A box of colored tags" is a box).
const WHERE = /\s+(?:with|in|on|under|for|facing|from|at|by|behind|beside|against|near|inside|beneath|below|above|over|into|onto|upon)\s+/;
const MANY = /^(?:(?:a|an|the)\s+)?(?:row|pair|set|stack|line|pile|heap)\s+of\s+/;
function nameOf(name) {
  const lower = plain(name).replace(MANY, "");
  const before = lower.split(WHERE)[0].trim();
  const head = before.split(/\s+of\s+/)[0].trim().split(/\s+/).at(-1) ?? "";
  return { before, head };
}

// The kind of container a thing called this is, or null: words of more than one word found whole in what the name is
// of ("weapons rack", "medical crates"), and one word only as the word it's a name of; the longest words win, so
// "a weapons locker" is an armory and not a crew locker.
export function containerKindOf(name) {
  const model = lootModel();
  if (!model) return null;
  const { before, head } = nameOf(name);
  let best = null;
  for (const kind of model.kinds) {
    for (const words of kind.words) {
      const fits = words.includes(" ") ? hasWords(before, words) : head === plain(words);
      if (fits && (!best || words.length > best.words.length)) best = { kind, words };
    }
  }
  return best?.kind ?? null;
}

// The kind a piece of furniture opens as, in a room called this: the room's own line first, then anywhere else.
export function furnitureKindOf(piece, roomName = "") {
  const model = lootModel();
  const line = model?.furniture.find((one) => one.piece === piece);
  if (!line) return null;
  const rule = line.rules.find((one) => one.rooms.some((room) => plain(room) === plain(roomName)));
  const name = rule?.kind ?? line.otherwise;
  return model.kinds.find((kind) => kind.name.toLowerCase() === name) ?? null;
}

// How many more (or fewer) things a container holds in a room called this, at this place.
export function lootAdjustment(place, roomName = "") {
  const model = lootModel();
  if (!model) return 0;
  let by = 0;
  for (const one of model.adjust) {
    if (one.what === "places" ? one.words.includes(String(place).toLowerCase()) : one.words.some((words) => hasWords(roomName, words))) by += one.by;
  }
  return by;
}

// The items that turn up in a kind of container, with how rare each is.
export function itemsFoundIn(kindName) {
  const name = String(kindName ?? "").toLowerCase();
  return Object.entries(ITEMS)
    .filter(([, item]) => (item.foundIn ?? []).some((one) => one.toLowerCase() === name))
    .map(([id, item]) => ({ id, rarity: item.rarity ?? "common" }));
}

// ---- Opening them (steps 3 and 4) -------------------------------------------------------------------------

const DEFAULT_CHANCES = { common: 70, uncommon: 25, rare: 5 };

// A thing that can be a container: not one of the ship's stores, a pile, a computer or a part, nor one whose map file
// says what's in it, nor one that hands out an item or has words of its own when used, which keeps to that (a story's
// piece, like the data chip in the comms tray, or a locker that's written to be locked).
const canBeLoot = (thing) => !thing.item && !thing.used && !thing.usedOther && !thing.store && !thing.portStore && !thing.pile && !thing.computer && !thing.part && !Object.keys(thing.holds ?? {}).length;
const kindNamed = (name) => lootModel()?.kinds.find((kind) => kind.name === name) ?? null;

// The file's line for a thing at a place, under Things: the kind it opens as, or none.
const thingLine = (place, thing) => lootModel()?.things.find((one) => one.place === place && plain(one.thing) === plain(thing.name)) ?? null;

// The kind of container a thing in a room opens as, as { kind }, or null: a piece of furniture or a container a room
// was given says so itself; any other thing as the file's line for it says, or by its name.
export function lootOf(place, thing) {
  if (thing?.loot) return thing.loot;
  if (!thing || !canBeLoot(thing)) return null;
  const line = thingLine(place, thing);
  if (line) return line.kind && kindNamed(line.kind) ? { kind: line.kind } : null;
  const kind = containerKindOf(thing.name);
  return kind ? { kind: kind.name } : null;
}
// How many squares a container holds, across and down: its kind's.
export const lootBox = (loot) => kindNamed(loot?.kind)?.size ?? null;

// What a piece of furniture that opens is called: a locker, a weapons locker, a tool shelf, a medicine shelf, a barrel.
const QUALIFIERS = { armory: "weapons", "medicine cabinet": "medicine", pantry: "pantry", "tool shelf": "tool", crate: "storage" };
const withArticle = (words) => `${/^[aeiou]/i.test(words) ? "An" : "A"} ${words}`;
const upperFirst = (words) => (words ? words[0].toUpperCase() + words.slice(1) : words);
function pieceName(piece, kind) {
  const noun = String(piece).replace(/-/g, " ");
  return withArticle(kind.words.includes(noun) ? noun : `${QUALIFIERS[kind.name] ?? kind.name} ${noun}`);
}

// The line under Rooms that gets a room a container of its own: its place's own line for it first, then the first whose
// words are in the room's name. A line can say "nothing".
function roomLine(place, room) {
  const model = lootModel();
  if (!model) return null;
  return model.rooms.find((one) => one.place === place && plain(one.room) === plain(room.name))
    ?? model.rooms.find((one) => one.words?.some((words) => hasWords(room.name, words)))
    ?? null;
}
// What a room at a place gets, by the file: { kind, name } (kind null for nothing), or null when no line fits it.
export const roomGets = (place, roomName) => {
  const line = roomLine(place, { name: roomName });
  return line ? { kind: line.kind, ...(line.name ? { name: line.name } : {}) } : null;
};
// What a container a room was given is called: what its line says, or its kind's first word.
const givenName = (line, kind) => upperFirst(line.name ?? withArticle(kind.words[0] ?? kind.name));

// The squares a new container keeps off: the room's words and ways out, where people stand and stop, and the squares
// round what already stands there (as src/uses.js and src/terminals.js stand theirs).
function keptClear(place, map, level) {
  const out = new Set(claimedSquares(place, map, level));
  const around = (x, y) => { for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) out.add(`${x + dx},${y + dy}`); };
  for (const thing of level.things) around(thing.x, thing.y);
  const parts = systemsOf(place);
  for (const room of Object.values(map.rooms ?? {})) {
    if (room.levelId !== level.id) continue;
    for (const id of parts?.partsIn?.[room.id] ?? []) {
      const part = parts.parts[id];
      if (part && !part.unplaced) around(part.x, part.y);
    }
  }
  return out;
}
// What wouldn't stand where the file says, by place, for the checker.
const placing = new Map();

// The room a square of a level is in, by name, for the rooms that hold more or fewer.
function roomNameAt(map, level, x, y) {
  const id = level.areas?.length ? level.roomAt(x, y) : level.id;
  return map.rooms?.[id]?.name ?? level.name ?? "";
}
export function lootRoomOf(place, levelId, thing) {
  const map = mapFor(place);
  const level = map?.levels?.[levelId];
  return level && thing ? roomNameAt(map, level, thing.x, thing.y) : "";
}

// What a piece of the packs that opens is called as a thing in a room, from its name in the catalogue: "Tool box" is
// "A tool box", "Fridge, red" "A fridge", "Pile of cases" "A pile of cases", and what's already more than one
// ("Kitchen units, black", "Wire shelving") is left as it is.
export function packPieceName(name) {
  const short = String(name ?? "").split(",")[0].trim();
  if (!short) return "Something to open";
  const head = short.split(/ with | of /)[0];
  if (/(s|ing)$/.test(head)) return short;
  return `${/^[aeiou]/i.test(short) ? "An" : "A"} ${short[0].toLowerCase()}${short.slice(1)}`;
}

// Once for each map, after the place's parts and stores stand in it: a thing named like a container opens (src/bag.js
// opens anything with a holds line); each piece of storage furniture on the decks opens, as a thing of its own standing
// on it, unless something drawn on the map stands there already; and each room the file gives a container that has
// none gets one, on a free square at the edge of the room, like a store nobody drew.
addMapWork((place, map) => {
  if (systemsPending(place) || logisticsPending(place)) return false;
  if (!lootModel()) return true;
  for (const level of Object.values(map.levels ?? {})) {
    for (const thing of level.things ?? []) if (!thing.holds && lootOf(place, thing)) thing.holds = {};
    const standing = new Set((level.things ?? []).map((one) => `${one.x},${one.y}`));
    for (const piece of level.furniture ?? []) {
      const room = roomNameAt(map, level, piece.x, piece.y);
      // A piece of the packs that opens does it like one of the game's own (public/furniture.js): a steel cabinet
      // like a locker, a fridge like shelves.
      const like = FURNITURE_BY_ID[piece.kind]?.pack ? FURNITURE_BY_ID[piece.kind].opens : piece.kind;
      const kind = like ? furnitureKindOf(like, room) : null;
      if (!kind || squaresOf(piece).some(([x, y]) => standing.has(`${x},${y}`))) continue;
      // A piece of the packs is called what it is (a tool box, a fridge), not what it opens like.
      const name = FURNITURE_BY_ID[piece.kind]?.pack ? packPieceName(FURNITURE_BY_ID[piece.kind].name) : pieceName(like, kind);
      level.things.push({ id: `loot:${level.id}:${piece.x},${piece.y}`, name, look: kind.look ?? `${name}.`, x: piece.x, y: piece.y, holds: {}, loot: { kind: kind.name }, onPiece: piece.kind });
    }
  }
  const problems = [];
  for (const room of Object.values(map.rooms ?? {})) {
    if (room.deck) continue;
    const line = roomLine(place, room);
    const kind = line?.kind ? kindNamed(line.kind) : null;
    if (!kind) continue;
    const level = room.level;
    const inRoom = (thing) => !room.area || level.areaAt?.(thing.x, thing.y) === room.area.id;
    if (level.things.some((thing) => inRoom(thing) && (thing.store || lootOf(place, thing)))) continue;
    const name = givenName(line, kind);
    const spot = floorSpot(level, new Set(), 0, 1, keptClear(place, map, level), room.area ?? null);
    if (!spot) {
      problems.push(`${where(line.line)}: there's no free square in ${room.name} at ${LOCATIONS[place]?.name ?? place} to put ${name.toLowerCase()} on`);
      continue;
    }
    level.things.push({ id: `loot:${room.id}`, name, look: kind.look ?? `${name}.`, x: spot.x, y: spot.y, holds: {}, loot: { kind: kind.name }, quiet: true, placed: true });
    // It stands like a thing drawn there: its square isn't floor, and you reach it from beside it.
    level.solid.add(`${spot.x},${spot.y}`);
    if (level.open[spot.y]) level.open[spot.y][spot.x] = false;
  }
  placing.set(place, problems);
  return true;
});

// For the room's picture: a container says so, one on the furniture is drawn as the piece itself, a piece of furniture
// or one a room was given has a quieter mark than other things' (public/iso.js), and one that's been emptied says so.
addThingActs((game, thing) => {
  const loot = lootOf(game.location, thing);
  if (!loot) return null;
  const kept = game.stores?.[`thing:${game.location}:${thing.id}`]?.items;
  return { loot: true, ...(thing.onPiece ? { onPiece: thing.onPiece } : {}), ...(thing.onPiece || thing.quiet ? { quiet: true } : {}), ...(kept && !kept.length ? { empty: true } : {}) };
});

// What's in a container the first time it's opened, as [{ id, n }]: as many things as its kind holds, more or fewer by
// the room and the place, each of a rarity by the file's chances and then any item of that rarity its kind holds, with
// two or three of a supply or a small part now and then. The same game always finds the same in the same container
// (the game's own seed and the container's key), so loading a save from before it was opened finds the same again.
export function rollLoot(game, key, loot, place, roomName = "") {
  const model = lootModel();
  const kind = kindNamed(loot?.kind);
  if (!model || !kind) return [];
  const roll = seeded(`${game.bodySeed ?? 1}|loot|${key}`);
  const [low, high] = kind.things;
  const count = Math.max(0, Math.min(12, low + Math.floor(roll() * (high - low + 1)) + lootAdjustment(place, roomName)));
  const chances = model.chances ?? DEFAULT_CHANCES;
  const held = itemsFoundIn(kind.name).filter(({ id }) => ITEMS[id]);
  const tiers = RARITIES.map((rarity) => [rarity, held.filter((one) => one.rarity === rarity)]).filter(([rarity, list]) => list.length && (chances[rarity] ?? 0) > 0);
  if (!tiers.length) return [];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const rarity = weighted(roll, tiers.map(([one]) => [one, chances[one]]));
    const list = tiers.find(([one]) => one === rarity)[1];
    const { id } = list[Math.floor(roll() * list.length)];
    const stack = Math.max(1, Number(ITEMS[id].stack) || 1);
    out.push({ id, n: rarity === "rare" || stack === 1 ? 1 : 1 + Math.floor(roll() * Math.min(3, stack)) });
  }
  return out;
}

// How many items turn up in containers at all, for the checker's summary.
export const lootItemCount = () => Object.values(ITEMS).filter((item) => (item.foundIn ?? []).length).length;

// For the Story board: the kinds' names, and the rarities, to pick from.
export const lootLists = () => ({ containerKinds: (lootModel()?.kinds ?? []).map((kind) => kind.name), rarities: RARITIES });

// ---- For the checker ----------------------------------------------------------------------------------

export function lootProblems() {
  const model = lootModel();
  const problems = [];
  const kindNames = new Set((model?.kinds ?? []).map((kind) => kind.name.toLowerCase()));
  if (model) {
    problems.push(...model.problems);
    const names = new Map();
    const words = new Map();
    for (const kind of model.kinds) {
      const name = kind.name.toLowerCase();
      if (names.has(name)) problems.push(`${where(kind.line)}: there's already a kind called ${kind.name}, on line ${names.get(name)}`);
      names.set(name, kind.line);
      if (!kind.words.length) problems.push(`${where(kind.line)}: ${kind.name} needs at least one word a thing can be called`);
      for (const one of kind.words) {
        if (words.has(one) && words.get(one).name !== kind.name) problems.push(`${where(kind.line)}: "${one}" is one of ${words.get(one).name}'s words too, on line ${words.get(one).line}, so a thing called that could be either`);
        words.set(one, kind);
      }
      if (kind.size.cols < 1 || kind.size.rows < 1 || kind.size.cols > 8 || kind.size.rows > 6) problems.push(`${where(kind.line)}: ${kind.name} holds ${kind.size.cols}x${kind.size.rows} squares, and a container holds from 1x1 to 8x6`);
      if (kind.things[0] > kind.things[1]) problems.push(`${where(kind.line)}: ${kind.name} holds ${kind.things[0]} to ${kind.things[1]} things, and the first number is the smaller`);
      if (kind.things[1] > 12) problems.push(`${where(kind.line)}: ${kind.name} holds up to ${kind.things[1]} things, and 12 is the most a container holds`);
    }
    for (const one of model.adjust.filter((line) => line.what === "places")) {
      for (const place of one.words) if (!LOCATIONS[place]) problems.push(`${where(one.line)}: there's no place called ${place}: use the places' ids, as in world/places`);
    }
    const meridian = LOCATIONS.meridian ? mapFor("meridian") : null;
    const rooms = new Set(Object.values(meridian?.rooms ?? {}).map((room) => plain(room.name)));
    for (const one of model.furniture) {
      if (!FURNITURE_BY_ID[one.piece]) problems.push(`${where(one.line)}: there's no piece of furniture called ${one.piece}: they're the ones in public/furniture.js, like locker, shelf, desk and barrel`);
      for (const kind of [...one.rules.map((rule) => rule.kind), one.otherwise].filter(Boolean)) {
        if (!kindNames.has(kind)) problems.push(`${where(one.line)}: there's no kind of container called ${kind} under Kinds`);
      }
      for (const room of one.rules.flatMap((rule) => rule.rooms)) {
        if (meridian && !rooms.has(plain(room))) problems.push(`${where(one.line)}: there's no room called ${room} on the Meridian's decks`);
      }
    }
    // The rooms that get one, and the things that open as another kind or not at all, by place.
    const roomsAt = (place) => new Set(Object.values(mapFor(place)?.rooms ?? {}).filter((room) => !room.deck).map((room) => plain(room.name)));
    const thingsAt = (place) => new Set(Object.values(mapFor(place)?.levels ?? {}).flatMap((level) => level.things.map((thing) => plain(thing.name))));
    const seenRooms = new Map();
    for (const one of model.rooms) {
      if (one.kind !== null && !kindNames.has(one.kind)) problems.push(`${where(one.line)}: there's no kind of container called ${one.kind} under Kinds`);
      if (one.words) {
        if (!one.words.length) problems.push(`${where(one.line)}: rooms called what? Write the words in a room's name, separated by commas`);
        continue;
      }
      if (!LOCATIONS[one.place]) {
        problems.push(`${where(one.line)}: there's no place called ${one.place}: use the places' ids, as in world/places`);
        continue;
      }
      if (!roomsAt(one.place).has(plain(one.room))) problems.push(`${where(one.line)}: there's no room called ${one.room} at ${LOCATIONS[one.place].name}`);
      const key = `${one.place}|${plain(one.room)}`;
      if (seenRooms.has(key)) problems.push(`${where(one.line)}: ${one.room} at ${LOCATIONS[one.place].name} has a line already, on line ${seenRooms.get(key)}, and only the first counts`);
      seenRooms.set(key, one.line);
    }
    for (const one of model.things) {
      if (one.kind !== null && !kindNames.has(one.kind)) problems.push(`${where(one.line)}: there's no kind of container called ${one.kind} under Kinds`);
      if (!LOCATIONS[one.place]) problems.push(`${where(one.line)}: there's no place called ${one.place}: use the places' ids, as in world/places`);
      else if (!thingsAt(one.place).has(plain(one.thing))) problems.push(`${where(one.line)}: there's no thing called ${one.thing} at ${LOCATIONS[one.place].name}`);
    }
    for (const place of Object.keys(LOCATIONS)) {
      mapFor(place);
      problems.push(...(placing.get(place) ?? []));
    }
  }
  for (const [id, item] of Object.entries(ITEMS)) {
    const file = `world/items/${id}.txt`;
    if (item.rarity !== undefined && !RARITIES.includes(String(item.rarity).toLowerCase())) problems.push(`${file}: rarity is ${item.rarity}, and it's common, uncommon or rare`);
    if (!(item.foundIn ?? []).length) continue;
    if (!model) {
      problems.push(`${file}: it's found in containers, and there's no world/loot/${FILE} to say what they are`);
      continue;
    }
    for (const kind of item.foundIn) if (!kindNames.has(kind.toLowerCase())) problems.push(`${file}: found in names ${kind}, and there's no kind of container called that in world/loot/${FILE}`);
    if (item.type === "story") problems.push(`${file}: it's a story item, which the story hands out, so it shouldn't be found in containers`);
  }
  return problems;
}
addChecker(lootProblems);
