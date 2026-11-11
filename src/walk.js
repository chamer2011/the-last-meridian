// Walking around a place that has levels, and talking to the people there. All of it runs on this
// computer. Walking doesn't move the clock by itself, though the clock runs beside it where people
// live their days (see src/life.js). The written story moves the player with set_scene, and a talk
// plays from the person's written lines or stock ones (src/talks.js).
//
// world/maps/ has each place's levels, one to a room, and a file's name is the id of the place it's
// for. world/rooms.json has the kinds of room the game can draw for anywhere that isn't on a map,
// and a campaign can keep its own rooms in its folder, so they stay the same from then on.

import { bleedingOf, bodyOf, keyAt, lookLine, paceOf } from "./body.js";
import { awakeInMedbay, carry, downForStory, downRecord, putDown } from "./medbay.js";
import { allCharacters, campaignRooms, findCampaignRoom, findCharacter, fullName, saveCampaignRoom } from "./campaign.js";
import { startCheck, startChoiceCheck } from "./checks.js";
import { useComputer } from "./computers.js";
import { clearSystems, doorActions, doorLocked, doorLook, exitLocked, partSquares, partThings, roomDark, roomView, systemsOf, workOnDoor, workOnPart } from "./systems.js";
import { clearLogistics, logisticsOf, storeLook } from "./logistics.js";
import { ITEMS, LOCATIONS } from "./data.js";
import { clearLife, hasADay, livesHere, peopleAboard } from "./life.js";
import { isCaptain, toOutsider } from "./role.js";
import { addItem, audienceBonus, clockRuns } from "./rules.js";
import { conditionHolds } from "./scene-text.js";
import { recordFact } from "./record.js";
import { attackPerson, isHurt, isWary, pickPocket, pocketDetail } from "./deeds.js";
import { rumorsFrom } from "./story-library.js";
import { pilesIn } from "./bag.js";
import { colorForName, parseNarration } from "../public/story.js";
import { COMBAT_ART, LOOKS, ROOM_KINDS, ROOM_TALK, WORLD_MAPS, roomsRedrawn } from "./world.js";

const STEPS = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const DOOR = "+";
const WALL = "#";
const START = "@";
const FLOOR = ".";
const SNAP_DISTANCE = 3;
const MAX_PEOPLE = 8;
const MAX_NAME = 60;
const MAX_THINGS = 4;
const MAX_LABEL = 14;
const MAX_RECORD = 20;
// How fast the clock can run, in minutes of the game to each real minute.
const CLOCK_RATES = [10, 60, 300];
const LONGEST_TICK = 2000;

const spotKey = (x, y) => `${x},${y}`;
const nextTo = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

// The squares a mark and its name take up, on whichever side of it the name goes.
function runSquares(x, y, length, side = "right") {
  return Array.from({ length: length + 2 }, (_, i) => spotKey(side === "left" ? x - i : x + i, y));
}

// ---- The levels ---------------------------------------------------------

// Turns one level from its file into what the game works with: where can be walked, and what's where.
export function compileLevel(id, file, districts = []) {
  const width = Math.max(...file.plan.map((row) => row.length));
  const rows = file.plan.map((row) => row.padEnd(width));
  const floors = new Set(file.floor ?? FLOOR);
  const floorMark = [...floors][0];
  const open = rows.map(() => Array(width).fill(false));
  const homes = [];
  const things = [];
  const exits = [];
  const doors = new Set();
  let start = null;
  const isMark = (ch) => ch === START || file.people?.[ch] || file.things?.[ch] || file.exits?.[ch];
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (floors.has(ch)) open[y][x] = true;
    else if (ch === DOOR) {
      open[y][x] = true;
      doors.add(spotKey(x, y));
    } else if (ch === START) {
      open[y][x] = true;
      start = { x, y };
    } else if (file.people?.[ch]) {
      open[y][x] = true;
      homes.push({ ...file.people[ch], x, y });
    } else if (file.things?.[ch]) things.push({ id: `${id}:${ch}`, ...file.things[ch], x, y });
    else if (file.exits?.[ch]) exits.push({ key: ch, ...file.exits[ch], x, y });
  }));
  // Words on the walls take the place of whatever's under them, gaps and all, so they can be read.
  const written = rows.map(() => Array(width).fill(" "));
  const covered = new Set();
  for (const [x, y, text] of file.writing ?? []) {
    [...text].forEach((ch, i) => {
      if (written[y]?.[x + i] === undefined) return;
      written[y][x + i] = ch;
      covered.add(spotKey(x + i, y));
    });
  }
  const layer = (pick) => rows.map((row, y) => [...row].map((ch, x) => (covered.has(spotKey(x, y)) ? " " : pick(ch))).join(""));
  const solid = new Set(things.map((thing) => spotKey(thing.x, thing.y)));
  const areas = compileAreas(file, { id, width, height: rows.length, open, solid, doors, exits, start, districts });
  return {
    id,
    name: file.name,
    desc: file.desc ?? districts.find((district) => district.name === (file.district ?? file.name))?.desc ?? "",
    aliases: file.aliases ?? [],
    width,
    height: rows.length,
    colors: file.colors ?? {},
    open,
    homes,
    things,
    exits,
    doors,
    solid,
    start: start ?? { x: 1, y: 1 },
    // The rooms drawn on a deck, and which one each square is in: the deck itself, where no room is drawn.
    areas: areas.list,
    areaAt: areas.at,
    roomAt: (x, y) => areas.at(x, y) ?? id,
    doorAreas: areas.doorAreas,
    // How many times the rooms drawn in Tiled have been read, so the picture of one is drawn again when it changes.
    drawn: file.drawn ?? 0,
    labels: (file.labels ?? []).map((label) => ({ text: label.text, x: label.at[0], y: label.at[1] })),
    // The squares are drawn in layers, so that walls, floors and scenery can each have their own color.
    layers: {
      floor: layer((ch) => (floors.has(ch) ? ch : ch === START || file.people?.[ch] ? floorMark : " ")),
      doors: layer((ch) => (ch === DOOR ? DOOR : " ")),
      walls: layer((ch) => (ch === WALL ? WALL : " ")),
      scenery: layer((ch) => (ch === WALL || ch === DOOR || floors.has(ch) || isMark(ch) ? " " : ch)),
      writing: written.map((row) => row.join("")),
      // What's under the words, for anything that needs to know: f is floor, w is wall, d is a door, and s is scenery.
      under: covered.size ? rows.map((row, y) => [...row].map((ch, x) => {
        if (!covered.has(spotKey(x, y)) || ch === " ") return " ";
        return floors.has(ch) || ch === START || file.people?.[ch] ? "f" : ch === WALL ? "w" : ch === DOOR ? "d" : "s";
      }).join("")) : [],
    },
  };
}

// ---- The rooms drawn on a deck ------------------------------------------

// A deck is one level with its rooms drawn on it as rectangles, each with its own id, so that the story, people's days
// and the place's systems go on knowing rooms. A square is in the smallest room drawn over it, so a pit can sit
// inside a bridge. Each room has the spot the story puts the player on, and knows the doors to the rooms beside it.
function compileAreas(file, { id: levelId, width, height, open, solid, doors, exits, start, districts = [] }) {
  const list = (file.areas ?? [])
    .filter((one) => one && typeof one.id === "string" && one.w > 0 && one.h > 0)
    .map((one) => ({ id: one.id, name: one.name ?? one.id, aliases: one.aliases ?? [], desc: one.desc ?? districts.find((district) => district.name === (one.district ?? one.name))?.desc ?? "", x: one.x, y: one.y, w: one.w, h: one.h }));
  if (!list.length) return { list: [], at: () => null, doorAreas: new Map() };
  const bySize = [...list].sort((a, b) => a.w * a.h - b.w * b.h);
  const grid = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => bySize.find((a) => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h)?.id ?? null));
  const at = (x, y) => grid[y]?.[x] ?? null;
  // A room's own start, when no flag gives one, is near its middle, but not on its painted name or any other words.
  const lettered = new Set([
    ...(file.labels ?? []).flatMap((label) => [...String(label.text ?? "")].map((_, i) => spotKey(Number(label.at?.[0]) + i, Number(label.at?.[1])))),
    ...(file.writing ?? []).flatMap(([wx, wy, text]) => [...String(text ?? "")].map((_, i) => spotKey(Number(wx) + i, Number(wy)))),
  ]);
  const standable = (x, y) => Boolean(open[y]?.[x]) && !solid.has(spotKey(x, y)) && !doors.has(spotKey(x, y)) && !lettered.has(spotKey(x, y));
  const starts = [...(file.starts ?? []), ...(start ? [start] : [])];
  for (const area of list) {
    const inside = (spot) => Boolean(spot) && at(spot.x, spot.y) === area.id;
    area.start = starts.find((spot) => inside(spot) && standable(spot.x, spot.y)) ?? starts.find(inside) ?? nearestOpen(area, standable) ?? { x: area.x, y: area.y };
    area.exits = exits.filter((exit) => inside(exit)).map((exit) => exit.key);
  }
  // A door is between the rooms on its sides: the rooms drawn there, or the deck itself, where a side is open floor
  // in no room at all. A door with one room on both sides is inside that room.
  const sideOf = (x, y) => at(x, y) ?? (open[y]?.[x] && !doors.has(spotKey(x, y)) ? levelId : null);
  const doorAreas = new Map();
  for (const key of doors) {
    const [x, y] = key.split(",").map(Number);
    const touched = new Set([at(x, y), ...STEPS.map(([dx, dy]) => sideOf(x + dx, y + dy))].filter(Boolean));
    if (touched.size) doorAreas.set(key, touched);
  }
  for (const area of list) {
    area.doors = [];
    for (const [key, touched] of doorAreas) {
      if (!touched.has(area.id)) continue;
      const [x, y] = key.split(",").map(Number);
      for (const other of touched) if (other !== area.id && other !== levelId) area.doors.push({ x, y, to: other });
    }
  }
  return { list, at, doorAreas };
}

// The square nearest the middle of a room that can be stood on. The squares are half as wide as they are deep.
function nearestOpen(area, standable) {
  const cx = area.x + (area.w - 1) / 2;
  const cy = area.y + (area.h - 1) / 2;
  let best = null;
  for (let y = area.y; y < area.y + area.h; y += 1) {
    for (let x = area.x; x < area.x + area.w; x += 1) {
      if (!standable(x, y)) continue;
      const far = (x - cx) ** 2 + ((y - cy) * 2) ** 2;
      if (!best || far < best.far) best = { x, y, far };
    }
  }
  return best && { x: best.x, y: best.y };
}

// Every room of a place by its id: the rooms drawn on each deck, and each level, which is a room itself unless it's a
// deck with rooms drawn on it.
function roomsIndex(levels) {
  const rooms = {};
  for (const level of Object.values(levels)) {
    rooms[level.id] = { id: level.id, name: level.name, aliases: level.aliases, desc: level.desc, levelId: level.id, level, area: null, start: level.start, deck: level.areas.length > 0 };
    for (const area of level.areas) rooms[area.id] ??= { id: area.id, name: area.name, aliases: area.aliases, desc: area.desc || level.desc, levelId: level.id, level, area, start: area.start, deck: false };
  }
  return rooms;
}
export const roomOf = (map, id) => map?.rooms?.[id] ?? null;
// The rooms the player can be in, in the order of the file: not the decks themselves.
export const roomsOf = (map) => Object.values(map?.rooms ?? {}).filter((room) => !room.deck);
// The rooms on one level: the level itself, or the rooms drawn on the deck.
export const roomsOn = (map, levelId) => roomsOf(map).filter((room) => room.levelId === levelId);
const inRoom = (room, spot) => (room.area ? room.level.areaAt(spot.x, spot.y) === room.id : true);
export const thingsIn = (room) => room.level.things.filter((thing) => inRoom(room, thing));
export const homesIn = (room) => room.level.homes.filter((home) => inRoom(room, home));

// Which way an exit points, from where it is in the level's walls, and which side its name goes.
function settleExit(exit, level, label) {
  const glyph = exit.x === 0 ? "<" : exit.x === level.width - 1 ? ">" : exit.y === 0 ? "^" : "v";
  const side = exit.side ?? (exit.x + label.length + 2 > level.width ? "left" : "right");
  return { ...exit, label, glyph, side };
}

// The deck plan of a deck, made from the rooms drawn on it: every four squares across and two down become one, in
// a character of that room's own, so the plan window can show it and be clicked, the way a drawn plan is.
const OVERVIEW_CHARS = ".,:;'`_-=~^\"<>abcdefghijklmnopqrstuvwxyz";
const shortLabel = (name) => String(name).replace(/^The /i, "").toUpperCase().slice(0, 10);
function deckOverview(level) {
  const [sx, sy] = [4, 2];
  const cols = Math.ceil(level.width / sx);
  const lines = Math.ceil(level.height / sy);
  const chars = Object.fromEntries(level.areas.map((area, i) => [area.id, OVERVIEW_CHARS[i % OVERVIEW_CHARS.length]]));
  const plan = [];
  for (let gy = 0; gy < lines; gy += 1) {
    let row = "";
    for (let gx = 0; gx < cols; gx += 1) {
      const counts = new Map();
      let wall = false;
      for (let y = gy * sy; y < (gy + 1) * sy; y += 1) {
        for (let x = gx * sx; x < (gx + 1) * sx; x += 1) {
          if (level.open[y]?.[x]) {
            const id = level.areaAt(x, y);
            if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
          } else if (level.layers.walls[y]?.[x] === WALL) wall = true;
        }
      }
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      row += best ? chars[best[0]] : wall ? WALL : " ";
    }
    plan.push(row);
  }
  const floors = Object.fromEntries(Object.entries(chars).map(([id, ch]) => [ch, id]));
  // Each room's name sits at its middle, pulled in so it stays on the plan.
  const rooms = level.areas.map((area) => {
    const text = shortLabel(area.name);
    const x = Math.max(0, Math.min(Math.floor((area.x + area.w / 2) / sx), cols - text.length));
    return { level: area.id, at: [x, Math.min(lines - 1, Math.floor((area.y + area.h / 2) / sy))], text };
  });
  const compiled = compileLevel(`overview:${level.id}`, { name: level.name, plan, floor: Object.keys(floors).join("") });
  return { id: level.id, name: level.name, width: compiled.width, height: compiled.height, layers: compiled.layers, floors, rooms };
}

function compileMap(file, districts = []) {
  const levels = Object.fromEntries(Object.entries(file.levels).map(([id, level]) => [id, compileLevel(id, level, districts)]));
  for (const level of Object.values(levels)) {
    level.exits = level.exits.map((exit) => settleExit(exit, level, exit.label ?? levels[exit.to]?.name ?? exit.to));
  }
  const rooms = roomsIndex(levels);
  const decks = Object.values(levels).filter((level) => level.areas.length);
  const overview = file.overview ? compileLevel("overview", { name: file.name, plan: file.overview.plan, floor: Object.keys(file.overview.floors).join("") }) : null;
  return {
    name: file.name ?? "",
    start: rooms[file.start] ? file.start : Object.keys(rooms)[0],
    levels,
    rooms,
    decks: decks.length ? decks.map(deckOverview) : null,
    overview: overview && { ...overview, title: file.overview.title ?? "Map", floors: file.overview.floors, rooms: file.overview.rooms },
    talk: { ...ROOM_TALK, ...file.talk },
  };
}

const maps = new Map();

// A room saved in Tiled while the game runs: the maps are made again, with the parts of the systems and people's days.
// It looks at the files at most once a second; a test can say it's later than it is.
export function redrawnRooms(now = Date.now()) {
  if (!roomsRedrawn(now)) return false;
  maps.clear();
  clearSystems();
  clearLogistics();
  clearLife();
  return true;
}

// A map with a mistake in it is skipped, so that place just stays in the classic view.
export function mapFor(place) {
  redrawnRooms();
  if (!maps.has(place)) {
    let map = null;
    try {
      if (WORLD_MAPS[place]) map = compileMap(WORLD_MAPS[place], LOCATIONS[place]?.gm?.districts);
    } catch (err) {
      console.error(`The levels for ${place} can't be used: ${err.message}`);
    }
    if (map) map.place = place;
    maps.set(place, map);
    // The place's systems stand some of their parts on the floor, where nobody can walk, so they're placed now,
    // and so are the stores of its logistics that the map hasn't drawn.
    if (map) systemsOf(place);
    if (map) logisticsOf(place);
  }
  return maps.get(place);
}

// Made again from the files, after the story board saves a place's systems or logistics.
export function clearMaps() {
  maps.clear();
  clearLogistics();
}

export const canStand = (level, x, y) => Boolean(level.open[y]?.[x]) && !level.solid.has(spotKey(x, y));

// ---- Doors only the story can open --------------------------------------

// Some ways in are for the story to decide: a guard, a locked door, a picket line. The player can
// ask at the door, which follows the door's rule. Once the story has taken the captain in, it stays open.
const storyClosed = (game, exit) => Boolean(exit.closed) && !game.opened?.[game.location]?.includes(exit.to);
// Closed to walking: a door only the story opens, or one the place's systems have locked (see src/systems.js).
const isClosed = (game, exit, levelId) => storyClosed(game, exit) || exitLocked(game, game.location, levelId, exit);

function openDoorsTo(game, id) {
  game.opened ??= {};
  game.opened[game.location] ??= [];
  if (!game.opened[game.location].includes(id)) game.opened[game.location].push(id);
}

// Asking at a closed door goes by the rule written in the map file, under closed.ask:
// an answer that leaves it closed, a condition that opens it, or a check whose result decides.
export function askAtDoor(game, key) {
  const walk = walkOf(game);
  const map = mapFor(game.location);
  const level = levelOf(game, walk, map);
  const exit = exitByKey(level, lockedDoorExits(game, map, level), key);
  if (!exit || !storyClosed(game, exit)) throw new Error(exit && isClosed(game, exit, level.id) ? "It's locked. Force it, or get into its panel." : "That door isn't closed.");
  const rule = exit.closed.ask ?? {};
  const open = (said) => {
    openDoorsTo(game, exit.to);
    if (rule.flag) recordFact(game, { id: rule.flag });
    return { said: said ?? "The way is open.", opened: true };
  };
  // In order: a condition that opens it, a check whose result decides, a door that simply opens when asked, or an answer that leaves it closed.
  if (rule.if) {
    if (conditionHolds(game, rule.if, { attr: () => 0, skillRank: () => 0, maxHp: () => 1 })) return open(rule.opens);
    if (!rule.check) return { said: rule.else ?? "Not this way, not yet." };
  }
  if (rule.check) {
    const [skill, difficulty, audience] = rule.check.split(":");
    startCheck(game, { skill, difficulty, audience: audience ?? null, reason: rule.reason ?? `Get through: ${exit.label}`, scene: exit.closed.look, source: "door", target: `exit:${exit.key}` });
    game.doorAsked = { place: game.location, to: exit.to, pass: rule.pass ?? "The way is open.", fail: rule.fail ?? "The way stays closed.", flag: rule.flag ?? null };
    return { check: true };
  }
  if (rule.opens) return open(rule.opens);
  return { said: rule.answer ?? "Asking gets you nowhere, for now. The story will have to take you through." };
}

// A door's check is done, and this says how it went, opening the door if it passed.
export function answerDoor(game, success) {
  const asked = game.doorAsked;
  game.doorAsked = null;
  if (!asked) return "Nothing more is written here for now.";
  if (success && game.location === asked.place) {
    game.opened ??= {};
    game.opened[asked.place] ??= [];
    if (!game.opened[asked.place].includes(asked.to)) game.opened[asked.place].push(asked.to);
    if (asked.flag) recordFact(game, { id: asked.flag });
  }
  return success ? asked.pass : asked.fail;
}

// Using a thing is what its file says it is: something to pick up, a written result, or nothing much.
export function useThing(game, key) {
  const walk = walkOf(game);
  const level = levelOf(game, walk, mapFor(game.location));
  // A part of the place's systems is worked by hand instead, and a console among them is a computer.
  if (String(key).startsWith("part:")) return workOnPart(game, key, "use");
  const thing = level.things.find((one) => one.id === key);
  if (!thing) throw new Error("That isn't here.");
  if (thing.item && !game.inventory?.[thing.item]) {
    addItem(game, thing.item);
    return { said: `[ITEM] Received: ${ITEMS[thing.item]?.name ?? thing.item}. ${thing.used ?? ""}`.trim() };
  }
  if (thing.item) return { said: "You've already got one." };
  // A thing with a computer file of its own is a computer: the player sits down at it, or hacks it. A console or
  // a panel nobody has written is one too, unless the map file already says what using it does.
  const written = (!isCaptain(game) && thing.usedOther) || thing.used;
  const inside = useComputer(game, { place: game.location, levelId: level.roomAt(thing.x, thing.y), thing, look: thing.look ?? null, generic: !written });
  if (inside) return inside;
  return { said: written ?? "Nothing more comes of it, for now." };
}

// Where the captain can get to from here without the story's help.
function roomsInReach(game, walk, map) {
  const reach = new Set([walk.level]);
  for (const id of reach) {
    for (const exit of map.levels[id]?.exits ?? []) if (!isClosed(game, exit, id)) reach.add(exit.to);
  }
  // Every room drawn on a deck that can be reached can be walked to, a locked door being forced or hacked.
  for (const id of [...reach]) for (const area of map.levels[id]?.areas ?? []) reach.add(area.id);
  return reach;
}

// ---- Somewhere that isn't on the map ------------------------------------

export function seedFrom(text) {
  let seed = 7;
  for (const ch of String(text).toLowerCase()) seed = (Math.imul(seed, 31) + ch.codePointAt(0)) >>> 0;
  return seed;
}

// If nothing says what a room is, this goes by what it's called and what the codex says about it.
function kindFromWords(game, name) {
  const lore = (game.lore ?? []).find((entry) => entry.name.toLowerCase() === String(name).toLowerCase())?.text ?? "";
  const counts = (text, word) => (text.match(new RegExp(`(?<![\\p{L}\\p{N}])${word}`, "giu")) ?? []).length;
  let best = "plain";
  let score = 0;
  for (const [id, kind] of Object.entries(ROOM_KINDS)) {
    // The room's own name says more than anything in its description.
    const found = (kind.words ?? []).reduce((sum, word) => sum + counts(String(name), word) * 3 + counts(lore, word), 0);
    if (found > score) {
      best = id;
      score = found;
    }
  }
  return best;
}

const PLAIN_ROOM = {
  floor: FLOOR,
  layouts: [{
    label: [3, 1],
    plan: [
      "##############################################",
      "#............................................#",
      "#............................................#",
      "#...1................2.......................#",
      "#...3................4.......................#",
      "#...5................6.......................#",
      "#...7................8.......................#",
      "#.@..........................................#",
      "##0###########################################",
    ],
  }],
  things: [],
};

// Builds the level for somewhere off the map: the room's own drawing if the campaign has one, and
// otherwise a drawing of its kind. Its name decides which way up that is, so two of a kind differ.
function roomLevel(game, walk, map) {
  const { room } = walk;
  const saved = findCampaignRoom(game.campaign, room.name, game.location);
  const kind = ROOM_KINDS[saved?.kind ?? room.kind] ?? ROOM_KINDS.plain ?? PLAIN_ROOM;
  const seed = seedFrom(room.name);
  const own = Boolean(saved?.plan);
  const layout = own ? saved : kind.layouts[seed % kind.layouts.length];
  const flipped = !own && (seed >> 3) % 2 === 1;
  const drawing = flipped ? [...layout.plan].reverse() : layout.plan;
  const floor = saved?.floor ?? kind.floor ?? FLOOR;
  const spots = {};
  const plan = drawing.map((row, y) => [...row].map((ch, x) => {
    if (!/[1-8a-h]/.test(ch)) return ch;
    spots[ch] = { x, y };
    return floor[0];
  }).join(""));
  const backTo = roomOf(map, saved?.exitTo) ?? roomOf(map, room.from) ?? roomOf(map, walk.level) ?? roomOf(map, map.start);
  const label = layout.label ?? [3, 1];
  const level = compileLevel("room", {
    name: room.name,
    desc: saved?.desc ?? (game.lore ?? []).find((entry) => entry.name.toLowerCase() === room.name.toLowerCase())?.text ?? kind.desc ?? map.talk?.offPlan ?? "",
    floor,
    colors: saved?.colors ?? kind.colors,
    plan,
    writing: saved?.writing,
    labels: [{ text: room.name.toUpperCase().slice(0, 30), at: [label[0], flipped ? drawing.length - 1 - label[1] : label[1]] }],
    exits: { 0: { back: true, to: backTo.id } },
  });
  level.exits = level.exits.map((exit) => settleExit(exit, level, saved?.exitLabel ?? `Back to ${backTo.name}`));

  // People go to the spot the room's file gives them, and otherwise to the next one free.
  const free = Object.keys(spots).filter((key) => /[1-8]/.test(key)).sort();
  const wanted = saved?.spots ?? {};
  const taken = new Set(room.people.map((person) => wanted[person.id ?? person.name]).filter(Boolean));
  const open = free.filter((key) => !taken.has(key));
  level.homes = room.people.map((person) => {
    const key = wanted[person.id ?? person.name] ?? open.shift();
    const spot = spots[key];
    return spot ? { ...person, label: person.name.slice(0, MAX_LABEL), ...spot } : null;
  }).filter(Boolean);

  // What the story said is here comes first, then whatever suits this kind of room.
  const named = (saved?.things ?? room.things ?? []).map((thing) => ({ ...thing, use: thing.use ?? `I go over to ${thing.name.replace(/^The /, "the ")} and take a closer look.` }));
  const usual = (kind.things ?? []).map((thing) => ({ ...thing, use: thing.use ?? `I go over to ${thing.name.replace(/^[AT]/, (first) => first.toLowerCase())} and take a closer look.` }));
  const places = Object.keys(spots).filter((key) => /[a-h]/.test(key)).sort();
  const fixed = named.filter((thing) => thing.spot && spots[thing.spot]);
  const loose = places.filter((key) => !fixed.some((thing) => thing.spot === key));
  const rest = [...named.filter((thing) => !thing.spot || !spots[thing.spot]), ...(own ? [] : usual)];
  level.things = [
    ...fixed.map((thing) => ({ ...thing, id: `room:${thing.spot}`, ...spots[thing.spot] })),
    ...loose.map((key, i) => (rest[i] ? { ...rest[i], id: `room:${key}`, ...spots[key] } : null)).filter(Boolean),
  ];
  level.solid = new Set(level.things.map((thing) => spotKey(thing.x, thing.y)));
  return level;
}

// ---- Where the captain is -----------------------------------------------

const newWalk = (place, map) => {
  const room = roomOf(map, map.start);
  return { place, level: room.levelId, x: room.start.x, y: room.start.y, walked: false, with: [], withLevel: null, room: null };
};

// Wherever the captain arrives, they start from that place's way in. Places without levels have nothing here.
// Only looking at this changes nothing, so showing the game can't change the save.
function walkAt(game) {
  const map = mapFor(game.location);
  if (!map) return null;
  return game.walk?.place === game.location ? onFloor(game.walk, map) : newWalk(game.location, map);
}

// A room drawn in Tiled can change under the player while the game runs: a wall where they stood, or the room gone.
// They're put on the nearest square they can stand on, or where the place starts, and the next step saves it.
function onFloor(walk, map) {
  if (walk.room) return walk;
  // A save from before the rooms were drawn on decks names one of them as its level: it stands at that room's spot.
  const named = !map.levels[walk.level] && roomOf(map, walk.level);
  if (named) return { ...walk, level: named.levelId, x: named.start.x, y: named.start.y };
  const level = map.levels[walk.level];
  if (level && (!level.drawn || canStand(level, walk.x, walk.y))) return walk;
  if (!level) {
    const room = roomOf(map, map.start);
    return { ...walk, level: room.levelId, x: room.start.x, y: room.start.y };
  }
  let best = null;
  for (let y = 0; y < level.height; y += 1) for (let x = 0; x < level.width; x += 1) {
    const far = (x - walk.x) ** 2 + (y - walk.y) ** 2;
    if (canStand(level, x, y) && (!best || far < best.far)) best = { x, y, far };
  }
  const spot = best ?? roomOf(map, map.start).start;
  return { ...walk, x: spot.x, y: spot.y };
}

// Where the player stands, for what's on the floor and what can be opened: the place, the room, the square and the
// room's things. Null where there's no map.
export function standingAt(game) {
  const walk = walkAt(game);
  if (!walk) return null;
  const map = mapFor(game.location);
  const level = levelOf(game, walk, map);
  const spot = walk.room ?? walk;
  return { place: game.location, levelId: roomId(walk, level), room: walk.room ? walk.room.name : level.roomAt(spot.x, spot.y), x: spot.x, y: spot.y, things: level.things };
}
// What a level is called in the save: its id, or a made-up room's name.
const roomId = (walk, level) => (walk.room ? walk.room.name : level.id);

// Someone who starts out at their job starts in the room they work in.
export function startInRoom(game, room) {
  const map = mapFor(game.location);
  const found = roomOf(map, room);
  if (!found) return;
  game.walk = { ...newWalk(game.location, map), level: found.levelId, x: found.start.x, y: found.start.y };
}

// The room the player is in, by its id: the one drawn around them on a deck, or the level itself.
export function roomHere(game) {
  const walk = walkAt(game);
  if (!walk) return null;
  const map = mapFor(game.location);
  const level = levelOf(game, walk, map);
  if (walk.room) return { id: walk.room.name, name: level.name, desc: level.desc, levelId: "room", offPlan: true };
  const id = level.roomAt(walk.x, walk.y);
  const room = roomOf(map, id);
  return { id, name: room?.name ?? level.name, desc: room?.desc ?? level.desc, levelId: level.id };
}

// The same, for something that's about to move the captain.
export function walkOf(game) {
  game.walk = walkAt(game);
  return game.walk;
}

const levelOf = (game, walk, map) => (walk.room ? roomLevel(game, walk, map) : map.levels[walk.level] ?? map.levels[map.start]);

const contactOf = (game, name) => game.contacts?.find((contact) => contact.name.toLowerCase() === name.toLowerCase());

// Someone stands at their post unless the story has put them somewhere else, or they're gone.
export function atPost(game, id) {
  const person = findCharacter(game.campaign, id);
  if (!person) return false;
  // Whoever could have had the chair is only here if they do.
  if (person.chair && game.ship?.chair?.id !== id) return false;
  const status = contactOf(game, person.name)?.status;
  return !status || status === "alive";
}

// Where the story has put someone beats wherever their day would have them.
function peopleOnLevel(game, walk, level) {
  if (level.id === "room") return level.homes;
  const moved = new Set([...walk.with, ...(game.walk?.room?.people ?? [])].map(keyOf));
  const posted = level.homes.filter((home) => !moved.has(home.id) && atPost(game, home.id) && !hasADay(walk.place, home.id));
  const living = livesHere(walk.place) ? peopleAboard(game, walk.place, level.id).filter((one) => !moved.has(keyOf(one))) : [];
  // Someone the player has beaten in a fight is off getting patched up for a while.
  return [...posted, ...living, ...(walk.withLevel === level.id ? walk.with : [])].filter((one) => !isHurt(game, walk.place, keyOf(one)));
}

const keyOf = (entry) => entry.id ?? entry.name;
const shortName = (game, entry) => entry.label ?? (entry.id ? findCharacter(game.campaign, entry.id)?.name : null) ?? entry.name;

// ---- Where someone is, for the story waiting on them ------------------------

// Where someone with a file is now: here, in the room the player's in; in another room of this place, by its name; at
// another place; gone, when they're dead, missing or captured; or null when the player couldn't find them anywhere.
// Reading this changes nothing in the save.
export function personWhere(game, id) {
  const person = findCharacter(game.campaign, id);
  if (!person) return null;
  const status = contactOf(game, person.name)?.status;
  if (status && status !== "alive") return { gone: status };
  // Someone down waits where they are: out cold, being carried, or laid up in a medbay at another place. Awake on a cot
  // here, they're found like anyone else, and the player goes to them.
  const down = downForStory(game, person.id);
  if (down) return { gone: down };
  const walk = walkAt(game);
  const map = walk ? mapFor(game.location) : null;
  if (walk && map) {
    const here = levelOf(game, walk, map);
    const find = (level) => peopleOnLevel(game, walk, level).find((one) => keyOf(one) === person.id);
    const roomName = (level, spot) => roomOf(map, level.roomAt(spot.x, spot.y))?.name ?? level.name;
    const onThis = find(here);
    if (onThis) {
      // On a deck, "here" is the room drawn around them both, not the whole deck.
      const mine = walk.room ? null : here.roomAt(walk.x, walk.y);
      const theirs = walk.room ? null : here.roomAt(onThis.x, onThis.y);
      if (walk.room || theirs === mine) return { here: true, room: walk.room ? here.name : roomName(here, onThis) };
      return { here: false, room: roomName(here, onThis), level: theirs, reachable: true };
    }
    if (!walk.room) {
      for (const level of Object.values(map.levels)) {
        if (level.id === here.id) continue;
        const found = find(level);
        // Behind a door only the story opens, they can't be walked to yet.
        if (found) return { here: false, room: roomName(level, found), level: level.roomAt(found.x, found.y), reachable: roomsInReach(game, walk, map).has(level.id) };
      }
    }
  }
  const home = person.location;
  if (home && home !== game.location && LOCATIONS[home]) return { here: false, place: home, placeName: LOCATIONS[home].name };
  return null;
}

// The story brings people to the player: they come and stand beside them, in the room they're in, and stay while the
// story needs them. Anyone already here stays where they are.
export function bringOver(game, ids) {
  const walk = walkOf(game);
  const map = walk ? mapFor(game.location) : null;
  if (!walk || !map) return;
  const level = levelOf(game, walk, map);
  // On a deck, "here" is the room drawn around the player: someone in another room of the deck comes over too.
  const mine = walk.room ? null : level.roomAt(walk.x, walk.y);
  const here = new Set(peopleOnLevel(game, walk, level).filter((one) => walk.room || level.roomAt(one.x, one.y) === mine).map(keyOf));
  // Someone down can't come over: the story waits for the player to go to them.
  const coming = peopleNamed(game, ids).filter((one) => !here.has(keyOf(one)) && !(one.id && game.down?.[`id:${one.id}`]));
  if (!coming.length) return;
  if (walk.room) {
    walk.room.people.push(...coming);
    return;
  }
  const staying = walk.withLevel === level.id ? walk.with : [];
  walk.with = standNear(game, level, { x: walk.x, y: walk.y }, [...staying, ...coming]);
  walk.withLevel = level.id;
  walk.withUntil = null;
}

// ---- Finding the way ----------------------------------------------------

// The shortest way from one square to any square that counts as there, not counting the start.
export function findPath(level, blocked, from, isThere) {
  const seen = new Set([spotKey(from.x, from.y)]);
  const queue = [{ x: from.x, y: from.y, back: null }];
  for (let i = 0; i < queue.length; i += 1) {
    const here = queue[i];
    if (isThere(here)) {
      const path = [];
      for (let at = here; at.back; at = at.back) path.unshift({ x: at.x, y: at.y });
      return path;
    }
    for (const [dx, dy] of STEPS) {
      const x = here.x + dx;
      const y = here.y + dy;
      const key = spotKey(x, y);
      if (seen.has(key) || blocked.has(key) || !canStand(level, x, y)) continue;
      seen.add(key);
      queue.push({ x, y, back: here });
    }
  }
  return null;
}

// The captain walks around people if there's a way, and squeezes past them in a narrow duct if there isn't. locked
// has the squares of the doors the place's systems have shut, which nobody squeezes through.
function route(level, people, locked, from, isThere) {
  const shut = new Set(locked.keys());
  const blocked = new Set([...people.map((person) => spotKey(person.x, person.y)), ...shut]);
  return findPath(level, blocked, from, isThere) ?? findPath(level, shut, from, isThere);
}

// The doors inside a deck that the place's systems have shut: a door into a locked room is shut from both sides.
function lockedDoorsOn(game, level) {
  const out = new Map();
  if (!level.doorAreas?.size || !systemsOf(game.location)) return out;
  for (const [key, touched] of level.doorAreas) {
    // A door with the same room on both sides is inside that room, and locking the room leaves it alone.
    if (touched.size < 2) continue;
    const shut = [...touched].find((id) => doorLocked(game, game.location, id));
    if (shut) out.set(key, shut);
  }
  return out;
}

// Each of those as a way out of its own, so it shows as a shut door that can be forced or hacked, like a locked exit.
function lockedDoorExits(game, map, level) {
  const walk = walkAt(game);
  const mine = walk && !walk.room && map.levels[walk.level] === level ? level.roomAt(walk.x, walk.y) : null;
  return [...lockedDoorsOn(game, level)].map(([key, to]) => {
    const [x, y] = key.split(",").map(Number);
    // From inside the room that's locked, its door is named by where it goes, a room before the deck itself; from
    // outside, by the room it's locked on.
    const sides = to === mine ? [...(level.doorAreas.get(key) ?? [])].filter((id) => id !== mine) : [];
    const beyond = sides.find((id) => id !== level.id) ?? sides[0] ?? null;
    const named = beyond ?? to;
    return settleExit({ key: `door:${key}`, to, via: null, x, y, inner: true }, level, roomOf(map, named)?.name ?? named);
  });
}
const exitByKey = (level, inner, key) => level.exits.find((one) => one.key === key) ?? inner.find((one) => one.key === key) ?? null;

function nearestFloor(level, people, x, y) {
  const taken = new Set(people.map((person) => spotKey(person.x, person.y)));
  for (let distance = 0; distance <= SNAP_DISTANCE; distance += 1) {
    for (let dy = -distance; dy <= distance; dy += 1) {
      const dx = distance - Math.abs(dy);
      for (const cx of dx ? [x - dx, x + dx] : [x]) {
        if (canStand(level, cx, y + dy) && !taken.has(spotKey(cx, y + dy))) return { x: cx, y: y + dy };
      }
    }
  }
  return null;
}

// What's being clicked or walked into: someone to talk to, something to look at, or a way out.
function markAt(game, walk, level, x, y) {
  const person = peopleOnLevel(game, walk, level).find((one) => one.x === x && one.y === y);
  if (person) return { kind: "person", key: keyOf(person), x, y, passing: person.walking };
  const thing = level.things.find((one) => one.x === x && one.y === y) ?? pilesIn(game, game.location, roomId(walk, level)).find((one) => one.x === x && one.y === y);
  if (thing) return { kind: "thing", key: thing.id, x, y };
  const part = partsOn(game, walk, level).find((one) => one.x === x && one.y === y);
  if (part) return { kind: "thing", key: `part:${part.id}`, x, y };
  const exit = level.exits.find((one) => one.x === x && one.y === y) ?? lockedDoorExits(game, mapFor(game.location), level).find((one) => one.x === x && one.y === y);
  return exit ? { kind: "exit", key: exit.key, x, y, exit } : null;
}

function findMark(game, walk, level, target) {
  const [kind, ...rest] = String(target).split(":");
  const key = rest.join(":");
  if (kind === "person") {
    const person = peopleOnLevel(game, walk, level).find((one) => keyOf(one) === key);
    return person ? { kind, key, x: person.x, y: person.y } : null;
  }
  if (kind === "exit") {
    const exit = exitByKey(level, lockedDoorExits(game, mapFor(game.location), level), key);
    return exit ? { kind, key, x: exit.x, y: exit.y, exit } : null;
  }
  const thing = kind === "thing" ? level.things.find((one) => one.id === key) ?? partsOn(game, walk, level).find((one) => `part:${one.id}` === key) ?? pilesIn(game, game.location, roomId(walk, level)).find((one) => one.id === key) : null;
  return thing ? { kind, key, x: thing.x, y: thing.y } : null;
}

// The parts of the place's systems on this level, in every room drawn on it, which aren't in the map file:
// src/systems.js places them.
function partsOn(game, walk, level) {
  if (walk.room || level.id === "room") return [];
  const model = systemsOf(game.location);
  if (!model) return [];
  const ids = roomsOn(mapFor(game.location), level.id).flatMap((room) => model.partsIn[room.id] ?? []);
  return ids.map((id) => model.parts[id]).filter((part) => part && !part.unplaced);
}

const isWhole = (cell, level) => Number.isInteger(cell?.x) && Number.isInteger(cell?.y) && canStand(level, cell.x, cell.y);

// Puts the captain in a room: a level, or one drawn on a deck. Coming through a door, they stand beside the door
// they came out of.
function enterLevel(game, walk, map, id, viaKey = null) {
  const room = roomOf(map, id);
  const next = room.level;
  const door = next.exits.find((exit) => exit.key === viaKey);
  const people = peopleOnLevel(game, { ...walk, room: null }, next);
  const taken = new Set(people.map((person) => spotKey(person.x, person.y)));
  const beside = door && STEPS.map(([dx, dy]) => ({ x: door.x + dx, y: door.y + dy })).find((spot) => canStand(next, spot.x, spot.y) && !taken.has(spotKey(spot.x, spot.y)));
  const spot = beside ?? room.start;
  // Whatever was open in the room being left is shut.
  if (game.looting) game.looting = null;
  walk.room = null;
  walk.level = room.levelId;
  walk.x = spot.x;
  walk.y = spot.y;
  walk.walked = true;
}

// The first way out to take from one level towards another, through the levels between.
function exitTowards(map, from, to) {
  const seen = new Set([from]);
  const queue = (map.levels[from]?.exits ?? []).map((exit) => ({ exit, at: exit.to }));
  for (let i = 0; i < queue.length; i += 1) {
    const { exit, at } = queue[i];
    if (at === to) return exit;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const next of map.levels[at]?.exits ?? []) queue.push({ exit, at: next.to });
  }
  return null;
}

function takeExit(game, walk, map, exit) {
  if (exit.back) {
    // Back from a room off the map to the deck it was left from, on the square it was left from.
    if (roomOf(map, exit.to)?.levelId === walk.level) {
      walk.room = null;
      walk.walked = true;
    } else enterLevel(game, walk, map, exit.to);
    return;
  }
  enterLevel(game, walk, map, exit.to, exit.via);
}

// Someone in the player's room by their key, as the room shows them, for the registry printout. It writes nothing.
export function personHere(game, key) {
  const walk = game.walk;
  const map = walk ? mapFor(game.location) : null;
  if (!map) return null;
  const level = levelOf(game, walk, map);
  const entry = peopleOnLevel(game, walk, level).find((one) => keyOf(one) === key);
  return entry ? { entry, view: personView(game, entry) } : null;
}

// The ground a fight in the room is fought on: the level the player's on, where they stand, the room drawn round them,
// the ways into it, and everyone else on the level, who stands where they are while it goes on. Null where there's no map.
export function fightGround(game) {
  const walk = walkAt(game);
  if (!walk) return null;
  const map = mapFor(game.location);
  const level = levelOf(game, walk, map);
  const spot = walk.room ?? walk;
  const roomNow = walk.room ? walk.room.name : level.roomAt(spot.x, spot.y);
  const area = walk.room ? null : level.areas.find((one) => one.id === roomNow) ?? null;
  const ways = area
    ? [...area.doors, ...level.exits.filter((exit) => level.roomAt(exit.x, exit.y) === roomNow)]
    : [...level.exits, ...[...level.doors].map((key) => {
      const [x, y] = key.split(",").map(Number);
      return { x, y };
    })];
  return {
    level,
    area,
    you: { x: spot.x, y: spot.y },
    ways: ways.map((way) => ({ x: way.x, y: way.y })),
    people: peopleOnLevel(game, walk, level).map((entry) => personView(game, entry, level)),
  };
}

// Where the player stands once a fight in the room is over: where they ended up, if it's somewhere they can stand.
export function standAfterFight(game, x, y) {
  const map = mapFor(game.location);
  if (!map) return;
  // A game that hasn't walked yet has no square kept: it's kept from now on.
  const walk = walkOf(game);
  const level = levelOf(game, walk, map);
  if (!canStand(level, x, y)) return;
  const spot = walk.room ?? walk;
  spot.x = x;
  spot.y = y;
}

// Everything the player can do by walking. It's all free, and it can't change anything else.
export function walkCommand(game, body) {
  const walk = walkOf(game);
  if (!walk) throw new Error("There's no map of this place.");
  const map = mapFor(game.location);
  const level = levelOf(game, walk, map);
  const people = peopleOnLevel(game, walk, level);
  const locked = lockedDoorsOn(game, level);
  const inner = lockedDoorExits(game, map, level);
  // A click partway through a walk carries on from wherever the captain has got to.
  const spot = walk.room ?? walk;
  const from = isWhole(body.from, level) ? { x: body.from.x, y: body.from.y } : { x: spot.x, y: spot.y };
  const answer = (path, arrived = null, message = null) => ({ walk: walkView(game), path, arrived, message });
  const roomBefore = walk.room ? null : level.roomAt(spot.x, spot.y);
  const stand = (path, arrived = null, message = null) => {
    const end = path.at(-1) ?? from;
    spot.x = end.x;
    spot.y = end.y;
    // Walking into another room drawn on the deck counts as walking there.
    if (!walk.room && level.roomAt(end.x, end.y) !== roomBefore) walk.walked = true;
    return answer(path, arrived, message);
  };
  const goToMark = (mark, path = route(level, people, locked, from, (here) => nextTo(here, mark))) => {
    if (!path) return stand([], null, "You can't find a way there.");
    if (mark.kind !== "exit") return stand(path, { kind: mark.kind, key: mark.key });
    if (isClosed(game, mark.exit, level.id)) return stand(path, { kind: "door", key: mark.key });
    takeExit(game, walk, map, mark.exit);
    return answer(path, { kind: "exit", key: mark.key });
  };
  // A room picked on the deck plan: walked to, if it's on this deck, and otherwise the stairs that lead toward it.
  const goToRoom = (id) => {
    const room = roomOf(map, id);
    if (!room) throw new Error("That room isn't on the map.");
    if (room.levelId === level.id && !walk.room) {
      const path = route(level, people, locked, from, (here) => here.x === room.start.x && here.y === room.start.y)
        ?? route(level, people, locked, from, (here) => level.roomAt(here.x, here.y) === room.id && !level.doors.has(spotKey(here.x, here.y)));
      return path ? stand(path) : stand([], null, "You can't find a way there.");
    }
    const exit = walk.room ? null : exitTowards(map, level.id, room.levelId);
    if (!exit) return stand([], null, "There's no way there from here.");
    return goToMark({ kind: "exit", key: exit.key, x: exit.x, y: exit.y, exit });
  };

  switch (body.action) {
    case "go": {
      if (typeof body.to === "string" && body.to.startsWith("room:")) return goToRoom(body.to.slice("room:".length));
      if (body.to) {
        const mark = findMark(game, walk, level, body.to);
        if (!mark) throw new Error("They aren't there any more.");
        return goToMark(mark);
      }
      if (!Number.isInteger(body.x) || !Number.isInteger(body.y)) throw new Error("Choose somewhere to walk to.");
      const mark = markAt(game, walk, level, body.x, body.y);
      if (mark) return goToMark(mark);
      const target = nearestFloor(level, people, body.x, body.y);
      if (!target) return stand([], null, "You can't walk there.");
      const path = route(level, people, locked, from, (here) => here.x === target.x && here.y === target.y);
      return path ? stand(path) : stand([], null, "You can't find a way there.");
    }
    // Walking freely, with the keys: the page says which square the player has walked onto, and the server keeps them
    // there, if it can be walked to from where they were. A way out walked into is taken, or stops them at its door.
    // Only the square goes back, unless the room has changed, because this is every square of every walk.
    case "move": {
      const x = Number(body.x);
      const y = Number(body.y);
      if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error("Choose somewhere to walk to.");
      const at = { x: spot.x, y: spot.y };
      const refused = { moved: false, captain: at };
      const mark = markAt(game, walk, level, x, y);
      if (mark?.kind === "exit") {
        const path = route(level, [], locked, at, (here) => nextTo(here, mark));
        return path ? goToMark(mark, path) : refused;
      }
      if (!canStand(level, x, y) || locked.has(spotKey(x, y))) return refused;
      if ((x !== at.x || y !== at.y) && !route(level, [], locked, at, (here) => here.x === x && here.y === y)) return refused;
      spot.x = x;
      spot.y = y;
      return { moved: true, captain: { x, y } };
    }
    case "step": {
      const dx = Math.sign(Number(body.dx) || 0);
      const dy = dx ? 0 : Math.sign(Number(body.dy) || 0);
      const x = from.x + dx;
      const y = from.y + dy;
      const mark = markAt(game, walk, level, x, y);
      if (mark?.kind === "exit") return goToMark(mark, []);
      // Nobody gets stopped for a talk by accident, just by crossing paths in a corridor.
      if (mark && !mark.passing) return stand([], { kind: mark.kind, key: mark.key });
      return stand(canStand(level, x, y) && !locked.has(spotKey(x, y)) ? [{ x, y }] : []);
    }
    // The map of the place: straight to a room, or back to somewhere the story has already been.
    case "room": {
      const to = String(body.to ?? "");
      if (to.startsWith("elsewhere:")) {
        const known = findCampaignRoom(game.campaign, to.slice("elsewhere:".length), game.location);
        if (!known) throw new Error("You don't know the way there.");
        putInRoom(game, walk, known.name, peopleNamed(game, known.regulars ?? []), known);
        walk.walked = true;
      } else {
        if (!roomOf(map, to)) throw new Error("That room isn't on the map.");
        if (!roomsInReach(game, walk, map).has(to)) throw new Error("There's a closed door on the way. You'd have to ask at it.");
        enterLevel(game, walk, map, to);
      }
      return answer([]);
    }
    // Using a thing or asking at a door. The page shows what came of it.
    case "use":
      return useThing(game, String(body.key ?? ""));
    case "ask":
      return askAtDoor(game, String(body.key ?? ""));
    // Working a part of the place's systems by hand, or a locked door: free, or a check in its own window.
    case "work": {
      const key = String(body.key ?? "");
      if (key.startsWith("part:")) return workOnPart(game, key, String(body.how ?? ""));
      const exit = exitByKey(level, inner, key);
      if (!exit) throw new Error("That isn't here.");
      return workOnDoor(game, level.id, exit, String(body.how ?? ""));
    }
    // The right-click menu's two deeds against someone in the room: a pocket picked, in the check window, or a fight.
    // Picking up someone down, slowly, and putting them down again: on a cot in the medbay (src/medbay.js).
    case "carry": {
      const key = String(body.key ?? "").replace(/^person:/, "");
      if (!people.some((one) => keyOf(one) === key)) throw new Error("They aren't there any more.");
      return { said: carry(game, key) };
    }
    case "putdown":
      return { said: putDown(game) };
    case "pickpocket":
    case "attack": {
      if (game.carrying) throw new Error("Put them down first.");
      const key = String(body.key ?? "").replace(/^person:/, "");
      const entry = people.find((one) => keyOf(one) === key);
      if (!entry) throw new Error("They aren't there any more.");
      const shown = personView(game, entry);
      const who = { key, id: entry.id ?? null, name: shown.name, short: shown.short, asleep: Boolean(entry.asleep), doing: entry.doing ?? null };
      const where = { place: game.location, room: walk.room ? null : level.roomAt(spot.x, spot.y) };
      return body.action === "pickpocket" ? pickPocket(game, who, where) : attackPerson(game, who, where);
    }
    default:
      throw new Error("Unknown order.");
  }
}

// ---- The story keeps the map true to itself ------------------------------

const plainName = (text) => String(text).toLowerCase().replace(/\s+/g, " ").replace(/^\s*the /, "").trim();

function findOnMap(map, name) {
  const wanted = plainName(name);
  return roomsOf(map).find((room) => [room.name, ...room.aliases].some((alias) => plainName(alias) === wanted)) ?? null;
}

function peopleNamed(game, names) {
  const seen = new Set();
  const people = [];
  for (const raw of names) {
    const given = String(raw).trim();
    if (!given) continue;
    if (given.length > MAX_NAME) throw new Error("That's too long for a name. Use what people call them.");
    if (given.toLowerCase() === game.name?.toLowerCase()) continue;
    const person = findCharacter(game.campaign, given);
    const entry = person ? { id: person.id, name: person.name } : { id: null, name: given };
    if (seen.has(keyOf(entry))) continue;
    seen.add(keyOf(entry));
    people.push(entry);
  }
  return people.slice(0, MAX_PEOPLE);
}

const markSquares = (game, entry, x, y) => runSquares(x, y, shortName(game, entry).length, entry.side);

// Puts each person as close to where the captain arrives as they'll fit, without covering anyone else's name.
function standNear(game, level, entry, people) {
  const moved = new Set(people.map((person) => person.id).filter(Boolean));
  const living = livesHere(game.location) ? peopleAboard(game, game.location, level.id).filter((one) => !one.crowd && !moved.has(one.id)) : [];
  const taken = new Set([
    ...[...level.homes.filter((home) => !moved.has(home.id) && atPost(game, home.id)), ...living].flatMap((home) => markSquares(game, home, home.x, home.y)),
    ...level.things.map((thing) => spotKey(thing.x, thing.y)),
    ...partSquares(game.location, level.id),
    ...level.exits.flatMap((exit) => runSquares(exit.x, exit.y, exit.label.length, exit.side)),
    ...level.labels.flatMap((label) => runSquares(label.x, label.y, label.text.length - 2)),
    ...level.layers.writing.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === " " ? [] : [spotKey(x, y)]))),
    spotKey(entry.x, entry.y),
  ]);
  const near = [];
  findPath(level, new Set(), entry, (here) => {
    near.push(here);
    return false;
  });
  return people.map((one) => {
    // On the plan, someone with a post goes by the same short name wherever they are.
    const home = level.homes.find((other) => other.id === one.id) ?? Object.values(mapFor(game.location)?.levels ?? {}).flatMap((other) => other.homes).find((other) => other.id === one.id);
    const person = home?.label ? { ...one, label: home.label } : one;
    const squares = (spot) => markSquares(game, person, spot.x, spot.y);
    const inside = (key) => {
      const [x, y] = key.split(",").map(Number);
      return x >= 0 && x < level.width && y >= 0 && y < level.height;
    };
    const fits = (spot) => squares(spot).every((key) => !taken.has(key) && inside(key));
    // Best of all is open floor with room for their name, out of the doorways.
    const open = (spot) => !level.doors.has(spotKey(spot.x, spot.y)) && squares(spot).every((key) => {
      const [x, y] = key.split(",").map(Number);
      return level.open[y]?.[x] && !level.doors.has(key);
    });
    const spot = near.find((here) => fits(here) && open(here)) ?? near.find(fits) ?? entry;
    squares(spot).forEach((key) => taken.add(key));
    return { ...person, x: spot.x, y: spot.y };
  });
}

// Puts the captain in a room the story named, with whoever's with them, where the story put them.
function putOnLevel(game, walk, room, people) {
  openDoorsTo(game, room.levelId);
  walk.room = null;
  walk.level = room.levelId;
  walk.walked = false;
  walk.x = room.start.x;
  walk.y = room.start.y;
  walk.with = standNear(game, room.level, room.start, people);
  walk.withLevel = room.levelId;
  walk.withUntil = null;
}

function putInRoom(game, walk, name, people, given = {}) {
  const map = mapFor(game.location);
  const saved = findCampaignRoom(game.campaign, name, game.location);
  // The room the player left, which the way back leads to: the one drawn around them on a deck.
  const from = walk.room ? walk.room.from : map.levels[walk.level]?.roomAt(walk.x, walk.y) ?? walk.level;
  walk.room = {
    name: saved?.name ?? name,
    from,
    kind: ROOM_KINDS[given.kind] ? given.kind : saved?.kind ?? kindFromWords(game, name),
    things: given.things?.length ? given.things : saved?.things ?? [],
    people,
    x: 0,
    y: 0,
  };
  const { start } = roomLevel(game, walk, map);
  walk.room.x = start.x;
  walk.room.y = start.y;
  walk.walked = false;
  walk.with = [];
  walk.withLevel = null;
}

const cleanThings = (things) => (Array.isArray(things) ? things.slice(0, MAX_THINGS).map((thing) => ({ name: String(thing.name).trim().slice(0, MAX_NAME), look: String(thing.look).trim().slice(0, 300) })).filter((thing) => thing.name && thing.look) : []);

// The story has moved the captain, or changed who's with them. A name that isn't on the map gets
// its own room, drawn to suit, so the map can't claim the captain is somewhere they're not. What
// the story says about a new room is saved with the campaign, so it stays that way.
export function setScene(game, area, names = [], { kind = null, things = [] } = {}) {
  const walk = walkOf(game);
  if (!walk) return "There's no map of this place, so nothing changed.";
  const name = String(area ?? "").trim();
  if (!name || name.length > MAX_NAME) throw new Error(`Give the place a name of up to ${MAX_NAME} characters.`);
  const people = peopleNamed(game, names);
  const map = mapFor(game.location);
  const level = findOnMap(map, name);
  const company = people.map((person) => person.name).join(", ");
  if (level) {
    putOnLevel(game, walk, level, people);
    return `The map now shows the player at ${level.name}${company ? `, with ${company}` : ""}.`;
  }
  const given = { kind, things: cleanThings(things) };
  const saved = findCampaignRoom(game.campaign, name, game.location);
  const regulars = peopleNamed(game, saved?.regulars ?? []);
  putInRoom(game, walk, name, people.length ? people : regulars, given);
  if (game.campaign) {
    saveCampaignRoom(game.campaign, {
      ...saved,
      name: walk.room.name,
      place: game.location,
      kind: walk.room.kind,
      ...(given.things.length || saved?.things ? { things: walk.room.things } : {}),
      regulars: saved?.regulars ?? people.map(keyOf),
    });
  }
  return `The map now shows the player off the map, at ${walk.room.name}, in a room of the kind "${walk.room.kind}"${company ? `, with ${company}` : ""}.`;
}

// ---- Saves from before there were levels --------------------------------

function lastMention(text, names) {
  let best = null;
  for (const { name, level } of names) {
    for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu"))) {
      if (!best || match.index > best.index) best = { index: match.index, name, level };
    }
  }
  return best;
}

function speakersIn(game, scenes) {
  const names = new Set();
  for (const scene of scenes) {
    for (const block of parseNarration(scene.text)) {
      if (block.type === "speech" && !block.voice) names.add(block.speaker);
    }
  }
  const everyone = allCharacters(game.campaign);
  return [...names].filter((name) => Object.values(everyone).some((person) => person.name === name || fullName(person) === name));
}

// A save from before this place had a map was written before the story could say where the captain
// is, so this goes by the latest scenes: the last place they name is where the captain must be.
export function walkFromStory(game) {
  const map = mapFor(game.location);
  if (!map) return null;
  const walk = newWalk(game.location, map);
  const scenes = (game.transcript ?? []).filter((entry) => entry.role === "narrator").slice(-2);
  const onMap = roomsOf(map).flatMap((room) => [room.name, ...room.aliases].map((name) => ({ name, level: room })));
  const invented = (game.lore ?? []).filter((entry) => entry.kind === "place").map((entry) => ({ name: entry.name, level: null }));
  const names = [...onMap, ...invented];
  let found = null;
  // A choice can mention anywhere, so only the scene itself counts.
  for (const scene of [...scenes].reverse()) {
    found = lastMention(stripChoices(scene.text), names);
    if (found) break;
  }
  if (!found) return walk;
  const people = peopleNamed(game, speakersIn(game, scenes));
  if (found.level) putOnLevel(game, walk, found.level, people);
  else putInRoom(game, walk, (game.lore ?? []).find((entry) => entry.name.toLowerCase() === found.name.toLowerCase())?.name ?? found.name, people);
  return walk;
}

// A save from when the whole ship was one plan keeps its room. The deck plan has the same shape, and its floor says which room is which.
export function walkFromOnePlan(game) {
  const old = game.walk;
  if (!old) return walkFromStory(game);
  const map = mapFor(game.location);
  if (!map) return null;
  const walk = newWalk(game.location, map);
  const floorAt = map.overview?.floors?.[WORLD_MAPS[game.location]?.overview?.plan?.[old.y]?.[old.x]];
  if (floorAt) enterLevel(game, walk, map, floorAt);
  walk.walked = false;
  if (old.room) {
    const saved = findCampaignRoom(game.campaign, old.room.name, game.location);
    const names = [...(old.room.people ?? []).map(keyOf), ...(saved?.regulars ?? [])];
    putInRoom(game, walk, old.room.name, peopleNamed(game, names));
  }
  return walk;
}

// ---- What the browser gets to see ---------------------------------------

const withMarks = (line) => (line ? { marks: line } : {});
function downView(game, key) {
  const d = downRecord(game, game.location, key);
  if (!d || d.going) return {};
  const bleeding = bleedingOf(game, keyAt(game.location, key));
  const where = d.carriedBy ? (d.carriedBy === "you" ? "You're carrying them." : "Being carried to the medbay.") : d.bed ? (d.bed.startsWith("@") ? "Lying on the medbay's floor." : "Laid up on a cot.") : `Lying where they fell, ${d.why ?? "down"}.`;
  return {
    down: true,
    ...(d.carriedBy ? { carried: d.carriedBy } : {}),
    ...(d.bed ? { onCot: true } : {}),
    ...(awakeInMedbay(game, keyAt(game.location, key)) ? { awake: true } : {}),
    downLook: [where, bleeding ? `Bleeding: ${bleeding.blood} blood left, losing ${bleeding.rate} an hour.` : null].filter(Boolean).join(" "),
  };
}

function personView(game, entry, level = null) {
  const person = entry.id ? findCharacter(game.campaign, entry.id) : null;
  const name = person ? fullName(person) : entry.name;
  const key = keyOf(entry);
  return {
    key,
    name,
    short: shortName(game, entry),
    color: person?.color ?? colorForName(name),
    x: entry.x,
    y: entry.y,
    side: entry.side ?? "right",
    ...(entry.doing ? { doing: entry.doing } : {}),
    ...(entry.walking ? { walking: true } : {}),
    ...(entry.asleep ? { asleep: true } : {}),
    ...(entry.crowd ? { crowd: true } : {}),
    // What the right-click menu needs: how they look, how hard their pocket is, and whether they're wary of it now.
    ...(person?.appearance ? { look: person.appearance } : {}),
    // What anyone can see of their body at a glance (src/body.js): how they walk, and the worst of their marks.
    ...withMarks(lookLine(bodyOf(game, entry.id ? { id: entry.id } : { name, place: game.location }), { walking: !downRecord(game, game.location, key) || downRecord(game, game.location, key).going })),
    // Someone down lies where they fell, with a mark over them, and Look says how they are and how fast they're bleeding
    // (src/medbay.js).
    ...downView(game, key),
    pocket: pocketDetail(game, { id: entry.id ?? null, name, asleep: Boolean(entry.asleep) }),
    ...(isWary(game, game.location, key) ? { wary: true } : {}),
    // On a deck, which of its rooms they're in.
    ...(level?.areas.length ? { room: level.roomAt(entry.x, entry.y) } : {}),
  };
}

const thingView = (game, thing, level = null) => ({
  ...(level?.areas.length ? { room: level.roomAt(thing.x, thing.y) } : {}),
  id: thing.id,
  name: thing.name,
  // One of the ship's stores says how it stands now: a kettle how much is left in it, an emptied store that it's empty.
  look: storeLook(game, game.location, thing, (!isCaptain(game) && thing.lookOther) || thing.look),
  use: (!isCaptain(game) && thing.useOther) || thing.use,
  x: thing.x,
  y: thing.y,
  have: Boolean(thing.item && game.inventory?.[thing.item]),
  // Something to pick up or a written result answers from the file; anything else has nothing more to it, for now.
  written: Boolean(thing.item || thing.used || thing.holds || (!isCaptain(game) && thing.usedOther)),
  // A thing with a holds line can be opened, and this is what the inventory calls it.
  ...(thing.holds ? { holds: true, store: `thing:${game.location}:${thing.id}` } : {}),
});

function exitView(game, exit, levelId) {
  const { key, x, y, label, glyph, side } = exit;
  if (storyClosed(game, exit)) return { key, x, y, label, glyph: "x", side, closed: true, look: exit.closed.look, use: exit.closed.use, written: Boolean(exit.closed.ask) };
  if (!exitLocked(game, game.location, levelId, exit)) return { key, x, y, label, glyph, side };
  // A door the place's systems have locked: forced, or opened from its panel.
  const actions = doorActions(game, game.location, levelId, exit).map(({ id, label: words, detail }) => ({ id, label: words, detail }));
  return { key, x, y, label, glyph: "x", side, closed: true, locked: true, look: doorLook(game, game.location, levelId, exit), written: true, actions };
}

// The deck plan: for decks with rooms drawn on them, made from the rooms, one plan to a deck, with who's in each room.
function decksView(game, walk, map) {
  const reach = roomsInReach(game, walk, map);
  const current = walk.room ? null : walk.level;
  const mine = walk.room ? null : map.levels[walk.level]?.roomAt(walk.x, walk.y);
  return {
    title: "Deck plan",
    current,
    decks: map.decks.map((deck) => {
      const level = map.levels[deck.id];
      const people = reach.has(deck.id) ? peopleOnLevel(game, { ...walk, room: null }, level) : [];
      const byRoom = new Map();
      for (const one of people) {
        const id = level.roomAt(one.x, one.y);
        if (!byRoom.has(id)) byRoom.set(id, []);
        byRoom.get(id).push(one);
      }
      return {
        id: deck.id,
        name: deck.name,
        here: current === deck.id,
        cols: deck.width,
        lines: deck.height,
        layers: deck.layers,
        floors: deck.floors,
        rooms: deck.rooms.map((room) => {
          const list = byRoom.get(room.level) ?? [];
          return {
            id: room.level,
            name: roomOf(map, room.level)?.name ?? room.level,
            text: room.text,
            x: room.at[0],
            y: room.at[1],
            here: current === deck.id && mine === room.level,
            closed: !reach.has(deck.id),
            people: list.filter((one) => !one.crowd).map((one) => shortName(game, one)),
            others: list.filter((one) => one.crowd).length,
          };
        }),
      };
    }),
    elsewhere: Object.values(campaignRooms(game.campaign)).filter((room) => (room.place ?? game.location) === game.location).map((room) => ({ name: room.name, here: walk.room?.name === room.name })),
  };
}

function overviewView(game, walk, map) {
  if (map.decks) return decksView(game, walk, map);
  const { overview } = map;
  if (!overview) return null;
  const reach = roomsInReach(game, walk, map);
  // Nobody can see who's behind a door they can't get through.
  const inRoom = (room) => (map.levels[room.level] && reach.has(room.level) ? peopleOnLevel(game, { ...walk, room: null }, map.levels[room.level]) : []);
  return {
    title: overview.title,
    cols: overview.width,
    lines: overview.height,
    layers: overview.layers,
    floors: overview.floors,
    rooms: overview.rooms.map((room) => {
      const people = inRoom(room);
      return {
        id: room.level,
        name: map.levels[room.level]?.name ?? room.level,
        text: room.text,
        x: room.at[0],
        y: room.at[1],
        here: !walk.room && walk.level === room.level,
        closed: !reach.has(room.level),
        people: people.filter((one) => !one.crowd).map((one) => shortName(game, one)),
        others: people.filter((one) => one.crowd).length,
      };
    }),
    // The places the story has been that aren't on the map.
    elsewhere: Object.values(campaignRooms(game.campaign)).filter((room) => (room.place ?? game.location) === game.location).map((room) => ({ name: room.name, here: walk.room?.name === room.name })),
  };
}

// What a room's made of and how it's lit, for the isometric view. Nothing else needs to know.
export function lookOf(place, levelName, { only = false } = {}) {
  const { levels = {}, ...general } = LOOKS.places[place] ?? {};
  // Only what's written for this room by name, for a room drawn on a deck, whose deck has the look of its own.
  if (only) return levels[levelName] ?? null;
  return { ...LOOKS.default, ...general, ...levels[levelName] };
}

const floorOf = (level, locked = new Map()) => Array.from({ length: level.height }, (_, y) => Array.from({ length: level.width }, (_, x) => (canStand(level, x, y) && !locked.has(spotKey(x, y)) ? "." : " ")).join(""));

// The doors out of the room the player's in on a deck, one to each room beside it.
function waysFrom(map, level, roomId) {
  const area = level.areas.find((one) => one.id === roomId);
  if (!area) return [];
  const seen = new Set();
  return area.doors.filter((door) => !seen.has(door.to) && seen.add(door.to)).map((door) => ({ to: door.to, name: roomOf(map, door.to)?.name ?? door.to, x: door.x, y: door.y }));
}

export function walkView(game) {
  const walk = walkAt(game);
  if (!walk) return null;
  const map = mapFor(game.location);
  const level = levelOf(game, walk, map);
  const spot = walk.room ?? walk;
  const inner = walk.room ? [] : lockedDoorExits(game, map, level);
  const locked = new Map(inner.map((exit) => [spotKey(exit.x, exit.y), exit.to]));
  // On a deck, here is the room drawn around the player, and the deck is named beside it.
  const roomNow = walk.room ? walk.room.name : level.roomAt(spot.x, spot.y);
  const room = walk.room ? null : roomOf(map, roomNow);
  const onDeck = !walk.room && level.areas.length > 0;
  return {
    offPlan: Boolean(walk.room),
    cols: level.width,
    lines: level.height,
    layers: level.layers,
    labels: level.labels,
    colors: level.colors,
    look: lookOf(game.location, level.name),
    captain: { x: spot.x, y: spot.y },
    // Where the player can walk, a row of the room to a line: "." for floor, a space for anything else. Ways out are
    // under exits, and people under people, since they move. A door the systems have locked isn't floor.
    floor: floorOf(level, locked),
    here: { id: roomNow, name: room?.name ?? level.name, desc: room?.desc ?? level.desc, ...(level.drawn ? { drawn: level.drawn } : {}), ...(onDeck ? { deck: { id: level.id, name: level.name } } : {}) },
    people: peopleOnLevel(game, walk, level).map((entry) => personView(game, entry, level)),
    things: [...level.things.map((thing) => thingView(game, thing, level)), ...(walk.room ? [] : roomsOn(map, level.id).flatMap((one) => partThings(game, game.location, one.id).map((thing) => (onDeck ? { ...thing, room: one.id } : thing)))), ...pilesIn(game, game.location, roomId(walk, level)).map((pile) => ({ ...pile, store: pile.id }))],
    // On a deck, each way out says which room it's in, a shut door between rooms counting as in the player's room.
    exits: [...level.exits, ...inner].map((exit) => ({ ...exitView(game, exit, level.id), ...(onDeck ? { room: exit.inner && level.doorAreas.get(spotKey(exit.x, exit.y))?.has(roomNow) ? roomNow : level.roomAt(exit.x, exit.y) } : {}) })),
    ...(walk.room ? {} : { room: roomView(game, game.location, roomNow) }),
    // The rooms drawn on the deck, with which are dark, so the picture can darken each by itself, and the doors out
    // of this one to the rooms beside it, shut or not.
    ...(onDeck ? {
      areas: level.areas.map((area) => ({ id: area.id, name: area.name, x: area.x, y: area.y, w: area.w, h: area.h, dark: roomDark(game, game.location, area.id), look: lookOf(game.location, area.name, { only: true }) })),
      ways: waysFrom(map, level, roomNow).map((way) => ({ ...way, ...(locked.has(spotKey(way.x, way.y)) ? { locked: true } : {}) })),
    } : {}),
    overview: overviewView(game, walk, map),
    ...(livesHere(walk.place) ? { life: true } : {}),
    // How fast the player walks, as a share of the usual: slower with a limp, slower still on a leg they can't stand on.
    pace: paceOf(bodyOf(game, "you")) * (game.carrying ? 0.5 : 1),
    // Who the player's carrying, by the key the room knows them by.
    ...(game.carrying && game.down?.[game.carrying] ? { carrying: { key: game.down[game.carrying].who } } : {}),
  };
}

// Just who's in the room with the captain and where they've got to, because this is twice a second.
function peopleNow(game) {
  const walk = walkAt(game);
  const level = levelOf(game, walk, mapFor(game.location));
  return { here: walk.room ? walk.room.name : level.id, drawn: walk.room ? 0 : level.drawn, people: peopleOnLevel(game, walk, level).map((entry) => personView(game, entry, level)) };
}

// The clock running by itself, while the player explores somewhere people live their days. It waits
// for talks and fights, because time stands still for those, and everywhere else it stays still.
// Every skill check lets it run on, the story's own as well as those on the room's parts, things, doors and people, and so
// does a computer in use.
export function walkTick(game, body) {
  if (game.combat || game.talk) return { held: true };
  if (!walkAt(game) || !livesHere(game.location)) return { still: true };
  if (!CLOCK_RATES.includes(body.rate)) throw new Error("That isn't one of the clock's speeds.");
  const ms = Math.max(0, Math.min(Number(body.ms) || 0, LONGEST_TICK));
  const notes = clockRuns(game, (ms / 60000) * body.rate);
  return { notes, ...peopleNow(game) };
}

// What a check from the story is about, when it can be told from the room: the person it's aimed at, or the first person
// in the room it names, or a thing whose whole name is in it. A check from the room says for itself, and practice is about
// nothing here.
const escapedForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
const sayingName = (name, words) => Boolean(name) && new RegExp(`(^|[^\\p{L}])${escapedForRegExp(name)}($|[^\\p{L}])`, "u").test(words);
export function checkTarget(game) {
  const check = game.check;
  if (!check || check.target || check.source === "practice") return check?.target ?? null;
  const view = walkView(game);
  if (!view) return null;
  if (check.audience) {
    const aimed = view.people.find((one) => one.key === check.audience || sayingName(check.audience, one.name));
    if (aimed) return `person:${aimed.key}`;
  }
  const words = `${check.reason ?? ""}\n${check.scene ?? ""}`;
  const named = view.people.find((one) => sayingName(one.short, words) || sayingName(one.name, words));
  if (named) return `person:${named.key}`;
  const lower = words.toLowerCase();
  const thing = view.things.find((one) => {
    const name = one.name.replace(/^the /i, "").toLowerCase();
    return name.length > 3 && lower.includes(name);
  });
  return thing ? `thing:${thing.id}` : null;
}

// ---- Talking ------------------------------------------------------------

function needTalk(game) {
  if (!game.talk) throw new Error("You're not talking to anyone right now.");
  return game.talk;
}

function openTalk(game, key) {
  const walk = walkOf(game);
  if (!walk) throw new Error("There's nobody to walk up to here.");
  if (game.talk) throw new Error("Finish the talk you're in first.");
  if (!game.transcript?.length) throw new Error("Start the story first.");
  const map = mapFor(game.location);
  const level = levelOf(game, walk, map);
  const entry = peopleOnLevel(game, walk, level).find((one) => keyOf(one) === key);
  if (!entry) throw new Error("They aren't here right now.");
  const person = entry.id ? findCharacter(game.campaign, entry.id) : null;
  const name = person ? fullName(person) : entry.name;
  const short = shortName(game, entry);
  const greetings = map.talk?.greetings ?? {};
  const feeling = contactOf(game, person?.name ?? entry.name)?.attitude ?? "unmet";
  const greeting = (entry.asleep ? greetings.asleep : null) ?? entry.greeting ?? greetings[feeling] ?? "{name} looks up.";
  game.talk = {
    id: Date.now(),
    key,
    personId: entry.id ?? null,
    name,
    short,
    // The room they're talked to in: on a deck, the one drawn around them.
    where: roomOf(map, level.roomAt(entry.x, entry.y))?.name ?? level.name,
    doing: entry.doing ?? null,
    log: [{ role: "aside", text: greeting.replaceAll("{name}", short) }],
    lastReply: null,
    said: 0,
    told: [],
  };
}

function namesFor(talk, person) {
  return [talk.short, ...(person ? [person.name, ...(person.aliases ?? [])] : [talk.name])];
}

function rumorsLeft(game, talk) {
  const person = talk.personId ? findCharacter(game.campaign, talk.personId) : null;
  return rumorsFrom(game, talk.key, namesFor(talk, person)).filter((rumor) => !talk.told.includes(rumor));
}

// What's going around, from the place's file.
function tellRumor(game) {
  const talk = needTalk(game);
  const [rumor] = rumorsLeft(game, talk);
  if (!rumor) throw new Error("They've told you all they've heard for now.");
  talk.told.push(rumor);
  talk.said += 1;
  const asked = mapFor(game.location)?.talk?.rumorAsked ?? "What have you heard lately?";
  talk.log.push({ role: "player", text: asked }, { role: "narrator", text: `@${talk.name}: "${rumor.replaceAll('"', "'")}"`, free: true });
}

function stripChoices(text) {
  return text.split("\n").filter((line) => !line.trim().startsWith(">")).join("\n").trim();
}

function lastWords(talk) {
  const last = [...talk.log].reverse().find((line) => line.role === "narrator" && !line.free);
  if (!last) return null;
  const speech = parseNarration(stripChoices(last.text)).filter((block) => block.type === "speech").at(-1);
  const quote = speech?.parts.filter((part) => part.kind === "quote").at(-1)?.text.replace(/^["“]|["”]$/g, "").replace(/\s+/g, " ").trim();
  if (!quote) return null;
  return quote.length > 90 ? `${quote.slice(0, 90).replace(/\s+\S*$/, "")}...` : quote;
}

// What was said, kept with the note in the story.
const talkRecord = (talk) => talk.log
  .filter((line) => line.role === "player" || line.role === "narrator")
  .slice(-MAX_RECORD)
  .map((line) => ({ role: line.role, text: stripChoices(line.text) }));

// The talk is over, and the story gets one line about it.
export function closeTalk(game) {
  const talk = game.talk;
  if (!talk) return;
  game.talk = null;
  if (!talk.said) return;
  const words = lastWords(talk);
  const where = talk.where.replace(/^The /, "the ");
  game.transcript.push({ role: "notice", text: `[TALK] You talked with ${talk.name} at ${where}.${words ? ` Last word: "${words}"` : ""}`, talk: talkRecord(talk) });
}

// A choice with a check on it plays out in its own window, which ends the talk.
function checkFromTalk(game, label) {
  const talk = needTalk(game);
  if (!startChoiceCheck(game, label, [{ role: "narrator", text: talk.lastReply ?? "" }])) throw new Error("That choice isn't on offer any more.");
  talk.log.push({ role: "player", text: label });
  talk.said += 1;
  closeTalk(game);
}

// Everything in a talk but the things said, which go through the written conversation.
export function talkCommand(game, body) {
  switch (body.action) {
    case "open": return openTalk(game, body.person);
    case "rumor": return tellRumor(game);
    case "check": return checkFromTalk(game, body.label);
    case "close": return closeTalk(game);
    default: throw new Error("Unknown order.");
  }
}

export function talkSaid(game, text) {
  const talk = needTalk(game);
  talk.log.push({ role: "player", text });
  talk.said += 1;
}

export function talkHeard(game, text, role = "narrator") {
  const talk = game.talk;
  if (!talk) return;
  talk.log.push({ role, text });
  if (role === "narrator") talk.lastReply = text;
}

// A fight or a check has its own window, so it takes over from the talk.
export function talkLineOver(game) {
  if (game.combat || game.check) closeTalk(game);
}

export function talkView(game) {
  const talk = game.talk;
  if (!talk) return null;
  const person = talk.personId ? findCharacter(game.campaign, talk.personId) : null;
  const contact = contactOf(game, person?.name ?? talk.name);
  const map = mapFor(game.location);
  const home = Object.values(map?.levels ?? {}).flatMap((level) => level.homes).find((one) => one.id === talk.personId);
  const own = (!isCaptain(game) && home?.asksOther) || home?.asks || [];
  const said = new Set(talk.log.filter((line) => line.role === "player").map((line) => line.text));
  return {
    id: talk.id,
    key: talk.key,
    name: talk.name,
    short: talk.short,
    where: talk.where,
    doing: talk.doing ?? null,
    role: toOutsider(game, person?.role) ?? null,
    note: toOutsider(game, person?.note) ?? null,
    color: person?.color ?? colorForName(talk.name),
    art: COMBAT_ART[person?.combat?.art] ?? COMBAT_ART.civilian ?? [],
    attitude: contact?.attitude ?? null,
    relationship: person ? audienceBonus(game, person.id) : 0,
    log: talk.log,
    lastReply: talk.lastReply,
    rumors: rumorsLeft(game, talk).length,
    rumorLabel: map?.talk?.rumor ?? "Ask what they've heard",
    goodbyeLabel: map?.talk?.goodbye ?? "Say goodbye",
  };
}
