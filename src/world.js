// Loads the world's files from disk. You can edit these files, or add new ones, and
// the game picks them up the next time it starts. A file's name is that person's id.

import fs from "node:fs";
import path from "node:path";
import { worldDir } from "./paths.js";
import { DRAWN, readPlaceRooms, stampNow } from "./tiled.js";
import { parseStoryText } from "../public/story-text.js";
import { parseSystemsText } from "../public/systems-text.js";
import { COMPUTER, ENEMY, FACTION, ITEM, PERK, PERSON, PLACE, SPECIES_SPEC, parseWorldText } from "../public/world-text.js";

// A file with a mistake in it is skipped, so one typo can't stop the whole game.
export function readFolder(folder) {
  const files = {};
  if (!fs.existsSync(folder)) return files;
  for (const name of fs.readdirSync(folder).sort()) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(folder, name);
    try {
      files[name.slice(0, -".json".length)] = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      console.error(`Skipping ${file}, because it can't be read: ${err.message}`);
    }
  }
  return files;
}

// The same, for a file that holds a whole list of things.
function readFile(name) {
  const file = path.join(worldDir, name);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.error(`Skipping ${file}, because it can't be read: ${err.message}`);
    return {};
  }
}

// The people, places and species are plain-text files too, read by public/world-text.js, and read again when the
// story board saves one. Tests point the folders at copies.
export const PEOPLE_DIR = process.env.GAME_PEOPLE_DIR ?? path.join(worldDir, "characters");
export const PLACES_DIR = process.env.GAME_PLACES_DIR ?? path.join(worldDir, "places");
export const SPECIES_DIR = process.env.GAME_SPECIES_DIR ?? path.join(worldDir, "species");
export const ENEMIES_DIR = process.env.GAME_ENEMIES_DIR ?? path.join(worldDir, "enemies");
export const ITEMS_DIR = process.env.GAME_ITEMS_DIR ?? path.join(worldDir, "items");
export const FACTIONS_DIR = process.env.GAME_FACTIONS_DIR ?? path.join(worldDir, "factions");
export const PERKS_DIR = process.env.GAME_PERKS_DIR ?? path.join(worldDir, "perks");
export const COMPUTERS_DIR = process.env.GAME_COMPUTERS_DIR ?? path.join(worldDir, "computers");
export const WORLD_COMPUTERS = {};
// What computers say when nobody has written them a file, and the advisor's hints inside one.
export const COMPUTER_FLAVOR = readFile("computers/_flavor.json");
export const WORLD_CHARACTERS = {};
export const WORLD_PLACES = {};
export const WORLD_SPECIES = {};
export const WORLD_ENEMIES = {};
export const WORLD_ITEMS = {};
export const WORLD_FACTIONS = {};
export const WORLD_PERKS = {};
export const WORLD_FILE_PROBLEMS = [];
// Each place's systems, as plain text in world/systems, read by public/systems-text.js and read again when the story
// board saves one. A place without a file gets what _defaults.json says. Tests point the folder at a copy.
export const SYSTEMS_DIR = process.env.GAME_SYSTEMS_DIR ?? path.join(worldDir, "systems");
export const WORLD_SYSTEMS = {};
export const SYSTEMS_FILE_PROBLEMS = [];
export const SYSTEMS_DEFAULTS = readFile("systems/_defaults.json");
export function reloadSystems() {
  for (const key of Object.keys(WORLD_SYSTEMS)) delete WORLD_SYSTEMS[key];
  SYSTEMS_FILE_PROBLEMS.splice(0);
  if (!fs.existsSync(SYSTEMS_DIR)) return;
  for (const name of fs.readdirSync(SYSTEMS_DIR).sort()) {
    if (!name.endsWith(".txt") || name.startsWith("_")) continue;
    const { value, problems } = parseSystemsText(fs.readFileSync(path.join(SYSTEMS_DIR, name), "utf8"), name.slice(0, -".txt".length));
    for (const one of problems) SYSTEMS_FILE_PROBLEMS.push(`systems/${name}${one.line ? ` (line ${one.line})` : ""}: ${one.message}`);
    WORLD_SYSTEMS[name.slice(0, -".txt".length)] = value;
  }
}
reloadSystems();
function readTextFolder(dir, spec, into, folder) {
  for (const key of Object.keys(into)) delete into[key];
  if (!fs.existsSync(dir)) return;
  const read = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".txt") || name.startsWith("_")) continue;
    const id = name.slice(0, -".txt".length);
    const { value, problems } = parseWorldText(fs.readFileSync(path.join(dir, name), "utf8"), spec, id);
    for (const one of problems) WORLD_FILE_PROBLEMS.push(`${folder}/${name}${one.line ? ` (line ${one.line})` : ""}: ${one.message}`);
    read.push([id, value]);
  }
  // Files with an order line keep that order, which is the order the game shows them in; the rest come by name.
  if (read.some(([, value]) => value.order !== undefined)) read.sort((a, b) => (a[1].order ?? 999) - (b[1].order ?? 999) || a[0].localeCompare(b[0]));
  for (const [id, value] of read) into[id] = value;
}
export function reloadWorld() {
  WORLD_FILE_PROBLEMS.splice(0);
  readTextFolder(PEOPLE_DIR, PERSON, WORLD_CHARACTERS, "characters");
  readTextFolder(PLACES_DIR, PLACE, WORLD_PLACES, "places");
  readTextFolder(SPECIES_DIR, SPECIES_SPEC, WORLD_SPECIES, "species");
  readTextFolder(ENEMIES_DIR, ENEMY, WORLD_ENEMIES, "enemies");
  readTextFolder(ITEMS_DIR, ITEM, WORLD_ITEMS, "items");
  readTextFolder(FACTIONS_DIR, FACTION, WORLD_FACTIONS, "factions");
  readTextFolder(PERKS_DIR, PERK, WORLD_PERKS, "perks");
  readTextFolder(COMPUTERS_DIR, COMPUTER, WORLD_COMPUTERS, "computers");
  WORLD_FILE_PROBLEMS.push(...bagProblems(WORLD_ITEMS, WORLD_CHARACTERS, WORLD_ENEMIES, readFile("inventory.json").pack));
}
// What the inventory needs of the files: an item's size is squares across by down, no bigger than the pack, and what
// people and enemies leave when they're beaten is the game's items, each with a chance from 0 to 100.
export function bagProblems(items, characters, enemies, pack = { cols: 8, rows: 5 }) {
  const problems = [];
  for (const [id, item] of Object.entries(items)) {
    if (item.size === undefined) continue;
    const size = /^(\d+)x(\d+)$/.exec(String(item.size).trim().toLowerCase());
    if (!size || Number(size[1]) < 1 || Number(size[2]) < 1) problems.push(`items/${id}.txt: its size should be squares across by down, like 2x1, not ${item.size}.`);
    else if (Number(size[1]) > pack.cols || Number(size[2]) > pack.rows) problems.push(`items/${id}.txt: at ${item.size} it's bigger than the pack, which is ${pack.cols} by ${pack.rows}.`);
  }
  for (const [folder, all, lootOf] of [["characters", characters, (one) => one.combat?.loot], ["enemies", enemies, (one) => one.loot]]) {
    for (const [id, one] of Object.entries(all)) {
      for (const [item, chance] of Object.entries(lootOf(one) ?? {})) {
        if (!items[item]) problems.push(`${folder}/${id}.txt: its loot names ${item}, which isn't one of the items in world/items.`);
        else if (!(chance >= 0 && chance <= 100)) problems.push(`${folder}/${id}.txt: the chance of ${item} in its loot is ${chance}, and it should be from 0 to 100.`);
      }
    }
  }
  return problems;
}
reloadWorld();
// The stories are plain-text files in world/stories, read by public/story-text.js into the shape the game uses, and
// read again when the story board saves one: the objects below are filled in place, so nothing needs a restart.
// Tests point this at a copy, so they can save stories without touching the real ones.
export const STORIES_DIR = process.env.GAME_STORIES_DIR ?? path.join(worldDir, "stories");
export const WORLD_THREADS = {};
export const STORY_FILE_PROBLEMS = [];
// Stories kept in their files but out of the game, one id a line in world/stories/_set-aside.txt: since the fleet
// went, the ones that stand on a ship that isn't there any more.
export const SET_ASIDE = new Set();

// Each place's map: its file in world/maps, with the rooms drawn in Tiled, in world/maps/<place>/, in place of the
// file's own (see src/tiled.js). Those are read again when one changes, so a room saved in Tiled shows up while the game
// is running. Tests point the folder at a copy.
export const MAPS_DIR = process.env.GAME_MAPS_DIR ?? path.join(worldDir, "maps");
const MAP_FILES = readFolder(MAPS_DIR);
export const WORLD_MAPS = {};
export const MAP_FILE_PROBLEMS = [];
const drawnRooms = {};
let drawings = 0;
let lastLook = 0;

// Whoever a person in a Tiled room is, by their id or their name.
function personId(text) {
  if (!text || WORLD_CHARACTERS[text]) return text;
  const name = text.toLowerCase();
  return Object.entries(WORLD_CHARACTERS).find(([id, one]) => id.toLowerCase() === name || String(one.name ?? "").toLowerCase() === name)?.[0] ?? text;
}

const titled = (id) => id.replace(/[_-]+/g, " ").replace(/^./, (ch) => ch.toUpperCase());

// The places with a folder of rooms drawn in Tiled: the ones with a file for the place, and a folder of its name.
const drawnPlaces = () => (fs.existsSync(MAPS_DIR) ? fs.readdirSync(MAPS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory() && MAP_FILES[entry.name]).map((entry) => entry.name) : []);

// One place's map, with its rooms from Tiled. The place's own file stays as it was read, so this can be done again.
function drawPlace(place) {
  const file = MAP_FILES[place];
  const folder = path.join(MAPS_DIR, place);
  const label = `maps/${place}`;
  if (!fs.existsSync(folder)) {
    WORLD_MAPS[place] = file;
    delete drawnRooms[place];
    return;
  }
  const { rooms, problems, stamp, uses } = readPlaceRooms(folder, { personId, label, known: Object.keys(file.levels ?? {}) });
  drawnRooms[place] = { stamp, uses, problems };
  drawings += 1;
  const levels = structuredClone(file.levels ?? {});
  for (const [id, level] of Object.entries(rooms)) {
    const before = levels[id] ?? {};
    const kept = Object.fromEntries(Object.entries(before).filter(([key]) => !DRAWN.includes(key)));
    levels[id] = { ...kept, ...level, name: level.name ?? before.name ?? titled(id), drawn: drawings };
  }
  // A way out that doesn't say where it comes out goes to the way back, if there's only one.
  for (const id of Object.keys(rooms)) {
    for (const exit of Object.values(levels[id].exits ?? {})) {
      const there = levels[exit.to];
      if (!there) {
        problems.push(`${label}/${id}: a way out leads to ${exit.to}, and there's no room called that`);
        continue;
      }
      if (exit.via && there.exits?.[exit.via]) continue;
      const back = Object.entries(there.exits ?? {}).filter(([, one]) => one.to === id);
      if (back.length === 1) exit.via = back[0][0];
      else problems.push(`${label}/${id}: a way out to ${there.name ?? exit.to} doesn't say which way out there it comes through: give it a via property, the mark of that way out`);
    }
    for (const person of Object.values(levels[id].people ?? {})) if (!WORLD_CHARACTERS[person.id]) problems.push(`${label}/${id}: there's nobody called ${person.id} in world/characters`);
  }
  const isRoom = (id) => Boolean(levels[id]) || Object.values(levels).some((level) => (level.areas ?? []).some((area) => area.id === id));
  if (!isRoom(file.start)) problems.push(`${label}: the place starts in the room ${file.start}, and there isn't one`);
  WORLD_MAPS[place] = { ...file, levels };
}

function gatherMapProblems() {
  MAP_FILE_PROBLEMS.splice(0, MAP_FILE_PROBLEMS.length, ...Object.values(drawnRooms).flatMap((one) => one.problems));
}

for (const [place, file] of Object.entries(MAP_FILES)) WORLD_MAPS[place] = file;
for (const place of drawnPlaces()) drawPlace(place);
gatherMapProblems();

// Whether any room drawn in Tiled has changed since it was read, reading it again if it has. It looks at the files at
// most once a second, so it's cheap to ask whenever a map's needed.
export function roomsRedrawn(now = Date.now()) {
  if (now - lastLook < 1000) return false;
  lastLook = now;
  let changed = false;
  for (const place of new Set([...drawnPlaces(), ...Object.keys(drawnRooms)])) {
    const known = drawnRooms[place];
    if (known && stampNow(path.join(MAPS_DIR, place), known.uses) === known.stamp) continue;
    drawPlace(place);
    changed = true;
  }
  if (changed) gatherMapProblems();
  return changed;
}

// A story's endings by name. An outcome written as a plain string gets its number for a name.
export const endingsOf = (thread) => (thread?.gm?.outcomes ?? []).map((outcome, i) => (typeof outcome === "string" ? { id: `ending_${i + 1}`, text: outcome } : outcome));

// The plain words a story's notes give a fact, by its name: the record uses them for a fact a scene leaves without words.
export const FACT_LINES = {};
export const WORLD_LIFE = readFolder(path.join(worldDir, "life"));
// The written scenes aren't here: src/scenes.js reads them whenever the story needs them, so a change shows up without a restart.



export const WORLD_ARC = readFile("arc.json");
export const DAILY = readFile("daily.json");
export const STORY_CLOCK = { ...readFile("story-clock.json"), threads: {} };
export const STARTS = readFile("starts.json");
export const CHECK_TEXT = readFile("checks.json");
export const DEEDS = readFile("deeds.json");
export const INVENTORY = readFile("inventory.json");
export const ROOM_KINDS = readFile("rooms.json").kinds ?? {};
export const ROOM_TALK = readFile("rooms.json").talk ?? {};
// The game can't run without these, so a mistake in one gets a plain explanation.
function readRequired(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(worldDir, name), "utf8"));
  } catch (err) {
    console.error(`\nThe game can't start, because world\\${name} has a mistake in it:\n  ${err.message}\nUndo your last change to that file, then start the game again.\n`);
    process.exit(1);
  }
}

export const COMBAT_TEXT = readRequired("combat-text.json");
export const COMBAT_ART = readRequired("art.json");
export const PARLEY = readRequired("parley.json");
export const LOOKS = readRequired("looks.json");
export const SHIP_DATA = readRequired("ship.json");
export const STAR_MAP = readRequired("starmap.json");

// Reads every story file. A file with a problem is still read as far as it goes, so one mistake can't stop the
// game, and the problem is kept for the checker.
export function reloadStories() {
  for (const key of Object.keys(WORLD_THREADS)) delete WORLD_THREADS[key];
  for (const key of Object.keys(STORY_CLOCK.threads)) delete STORY_CLOCK.threads[key];
  for (const key of Object.keys(FACT_LINES)) delete FACT_LINES[key];
  STORY_FILE_PROBLEMS.splice(0);
  SET_ASIDE.clear();
  if (!fs.existsSync(STORIES_DIR)) return;
  for (const name of fs.readdirSync(STORIES_DIR).sort()) {
    if (!name.endsWith(".txt") || name.startsWith("_")) continue;
    const id = name.slice(0, -".txt".length);
    const { story, clock, problems } = parseStoryText(fs.readFileSync(path.join(STORIES_DIR, name), "utf8"), id);
    for (const one of problems) STORY_FILE_PROBLEMS.push(`stories/${name}${one.line ? ` (line ${one.line})` : ""}: ${one.message}`);
    WORLD_THREADS[id] = story;
    STORY_CLOCK.threads[id] = clock;
    Object.assign(FACT_LINES, story.gm?.facts ?? {});
  }
  const asideFile = path.join(STORIES_DIR, "_set-aside.txt");
  if (!fs.existsSync(asideFile)) return;
  for (const raw of fs.readFileSync(asideFile, "utf8").split(/\r?\n/)) {
    const id = raw.replace(/#.*$/, "").trim();
    if (!id) continue;
    if (WORLD_THREADS[id]) SET_ASIDE.add(id);
    else STORY_FILE_PROBLEMS.push(`stories/_set-aside.txt: there's no story called ${id}`);
  }
}
reloadStories();
