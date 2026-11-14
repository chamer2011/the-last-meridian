// What's in the containers (the loot plan, docs/notes/project-loot.md): world/loot/containers.txt, read by
// public/loot-text.js, names the kinds of container, what a thing has to be called to be one, how big each is inside
// and how many things it holds, which rooms and places hold more or fewer, how often each rarity turns up, and what the
// furniture on the decks opens as; each item's file says which kinds it's found in (found in:) and how rare it is
// (rarity:). This reads it all, says which kind a thing or a piece of furniture is, and tells the checker what's wrong.
// Since step 3 the Meridian's containers open: the things named like one, and the lockers, shelves, desks and barrels
// on her decks, each filled the first time it's opened (src/bag.js keeps what's in it from then on). The other places'
// come in step 4.

import fs from "node:fs";
import path from "node:path";
import { FURNITURE_BY_ID, squaresOf } from "../public/furniture.js";
import { parseLootText, RARITIES } from "../public/loot-text.js";
import { seeded, weighted } from "./body.js";
import { ITEMS, LOCATIONS } from "./data.js";
import { logisticsPending } from "./logistics.js";
import { worldDir } from "./paths.js";
import { addChecker, addMapWork, addThingActs } from "./room-hooks.js";
import { systemsPending } from "./systems.js";
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

// The kind of container a thing called this is: the kind whose words fit it, the longest words winning, or null.
export function containerKindOf(name) {
  const model = lootModel();
  if (!model) return null;
  let best = null;
  for (const kind of model.kinds) {
    for (const words of kind.words) {
      if (hasWords(name, words) && (!best || words.length > best.words.length)) best = { kind, words };
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

// ---- Opening them (step 3) ------------------------------------------------------------------------------

// The places whose containers open: the Meridian's since step 3. The other places' come in step 4.
export const LOOT_PLACES = new Set(["meridian"]);
const DEFAULT_CHANCES = { common: 70, uncommon: 25, rare: 5 };

// A thing that can be a container: not one of the ship's stores, a pile, a computer or a part, nor one whose map file
// says what's in it, nor one that hands out an item or has words of its own when used, which keeps to that (a story's
// piece, like the data chip in the comms tray, or a locker that's written to be locked).
const canBeLoot = (thing) => !thing.item && !thing.used && !thing.usedOther && !thing.store && !thing.pile && !thing.computer && !thing.part && !Object.keys(thing.holds ?? {}).length;

// The kind of container a thing in a room opens as, as { kind }, or null: a piece of furniture says so itself, and any
// other thing by its name, at a place whose containers open.
export function lootOf(place, thing) {
  if (thing?.loot) return thing.loot;
  if (!thing || !LOOT_PLACES.has(place) || !canBeLoot(thing)) return null;
  const kind = containerKindOf(thing.name);
  return kind ? { kind: kind.name } : null;
}
const kindNamed = (name) => lootModel()?.kinds.find((kind) => kind.name === name) ?? null;
// How many squares a container holds, across and down: its kind's.
export const lootBox = (loot) => kindNamed(loot?.kind)?.size ?? null;

// What a piece of furniture that opens is called: a locker, a weapons locker, a tool shelf, a medicine shelf, a barrel.
const QUALIFIERS = { armory: "weapons", "medicine cabinet": "medicine", pantry: "pantry", "tool shelf": "tool", crate: "storage" };
const withArticle = (words) => `${/^[aeiou]/i.test(words) ? "An" : "A"} ${words}`;
function pieceName(piece, kind) {
  const noun = String(piece).replace(/-/g, " ");
  return withArticle(kind.words.includes(noun) ? noun : `${QUALIFIERS[kind.name] ?? kind.name} ${noun}`);
}

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

// Once for each map of a place whose containers open, after its parts and stores stand in it: a thing named like a
// container opens (src/bag.js opens anything with a holds line), and so does each piece of storage furniture on the
// decks, as a thing of its own standing on it, unless something drawn on the map stands there already.
addMapWork((place, map) => {
  if (!LOOT_PLACES.has(place)) return true;
  if (systemsPending(place) || logisticsPending(place)) return false;
  if (!lootModel()) return true;
  for (const level of Object.values(map.levels ?? {})) {
    for (const thing of level.things ?? []) if (!thing.holds && lootOf(place, thing)) thing.holds = {};
    const standing = new Set((level.things ?? []).map((one) => `${one.x},${one.y}`));
    for (const piece of level.furniture ?? []) {
      const room = roomNameAt(map, level, piece.x, piece.y);
      const kind = furnitureKindOf(piece.kind, room);
      if (!kind || squaresOf(piece).some(([x, y]) => standing.has(`${x},${y}`))) continue;
      const name = pieceName(piece.kind, kind);
      level.things.push({ id: `loot:${level.id}:${piece.x},${piece.y}`, name, look: kind.look ?? `${name}.`, x: piece.x, y: piece.y, holds: {}, loot: { kind: kind.name }, onPiece: piece.kind });
    }
  }
  return true;
});

// For the room's picture: a container says so, a piece of furniture is drawn as the piece itself with a quieter mark
// than other things' (public/iso.js), and one that's been emptied says it's empty.
addThingActs((game, thing) => {
  const loot = lootOf(game.location, thing);
  if (!loot) return null;
  const kept = game.stores?.[`thing:${game.location}:${thing.id}`]?.items;
  return { loot: true, ...(thing.onPiece ? { onPiece: thing.onPiece } : {}), ...(kept && !kept.length ? { empty: true } : {}) };
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
