// What's in the containers (step 1 of the loot plan, docs/notes/project-loot.md): world/loot/containers.txt, read by
// public/loot-text.js, names the kinds of container, what a thing has to be called to be one, how big each is inside
// and how many things it holds, which rooms and places hold more or fewer, and what the furniture on the decks opens
// as; each item's file says which kinds it's found in (found in:) and how rare it is (rarity:). This reads it all,
// says which kind a thing or a piece of furniture is, and tells the checker what's wrong. Nothing opens yet: the
// containers aboard the Meridian come in step 3, and the other places' in step 4.

import fs from "node:fs";
import path from "node:path";
import { FURNITURE_BY_ID } from "../public/furniture.js";
import { parseLootText, RARITIES } from "../public/loot-text.js";
import { ITEMS, LOCATIONS } from "./data.js";
import { worldDir } from "./paths.js";
import { addChecker } from "./room-hooks.js";
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
