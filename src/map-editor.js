// The map editor's side of the game: a deck read into something that can be changed square by square, a change tried
// out against the rest of the game before it's kept, and the deck's file written the same way tools/to-tiled.mjs
// writes one, so the game (and Tiled) read it as they always did.
//
// A deck is one file, world/maps/<place>/<deck>.tmj. The game's own picture of it is a plan, rows of marks, one to a
// square: floor, walls, doors, consoles and the rest, with a letter where someone stands, a thing sits or a stair
// goes. The editor gets that plan with the letters taken out (people, things and ways out come beside it, each with
// its square), the rooms drawn on the deck as rectangles, the words painted on it, and the spots people's days send
// them to, which are kept in world/life/<place>.json and have to stay on floor.
//
// Saving is careful, because the owner can't read what went wrong in a file: the deck is written to a copy of the maps
// first, read back, and compared; the whole game's checker is run on that copy and on the maps as they are, and
// anything new it finds stops the save unless the owner says to keep it anyway; the file that's there goes to
// data/map-backups first; and only then is anything written. The game reads a changed deck by itself (src/world.js).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { dataDir, projectDir } from "./paths.js";
import { FIGURES, PIECE, figureImage, pieceImage, pieceWords } from "./stand-in-art.js";
import { pieceKey, readMapFile, roomFromMap, roomToMap } from "./tiled.js";
import { FACINGS, FURNITURE_BY_ID, isFurniture, squaresOf } from "../public/furniture.js";
import { compileLevel, draftLook } from "./walk.js";
import { LIFE_DIR, MAPS_DIR, WORLD_CHARACTERS, WORLD_LIFE } from "./world.js";

const START = "@";
const VOID = " ";
const DOOR = "+";
const WALL = "#";
const NAME = /^[a-z0-9_-]+$/i;
const MARKS = { person: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", thing: "abcdefghijklmnopqrstuvwxyz", exit: "1234567890" };
// What can be painted on a square. The first of a deck's floor marks is its floor; the rest are the marks the game's
// picture of a room knows (public/iso.js), under the names the editor's buttons give them.
export const PAINTS = [
  { id: "floor", name: "Floor", mark: null, about: "Somewhere to walk" },
  { id: "wall", name: "Wall", mark: WALL, about: "A wall, as high as the room" },
  { id: "door", name: "Door", mark: DOOR, about: "A doorway in a wall, which the ship can lock" },
  { id: "console", name: "Console", mark: "=", about: "A console or a machine, waist high" },
  { id: "crate", name: "Crate", mark: "[]", about: "A crate, two squares wide" },
  { id: "locker", name: "Locker", mark: "|", about: "Something tall and narrow: a locker, a rack, a pillar" },
  { id: "bench", name: "Bench", mark: ":", about: "Something low: a bench, a table, a cot, a step" },
  { id: "beds", name: "Plant bed", mark: "\"", about: "Something growing, ankle high" },
  { id: "lamp", name: "Lamp", mark: "!", about: "A standing lamp" },
  { id: "space", name: "Open space", mark: VOID, about: "Nothing: outside the hull" },
];

// A deck's paints: its own floor marks first, and nothing else painted with a mark that's floor on this deck (on the
// engineering deck the floor is drawn with the mark a bench has elsewhere).
function paintsFor(floors) {
  const taken = new Set(floors);
  const free = (marks) => marks.find((mark) => ![...mark].some((ch) => taken.has(ch))) ?? marks[0];
  const others = { bench: [":", "-", "_"], console: ["=", "^"], locker: ["|", "/"] };
  return PAINTS.flatMap((paint) => {
    if (paint.id !== "floor") return [{ ...paint, mark: others[paint.id] ? free(others[paint.id]) : paint.mark }];
    return [...floors].map((mark, i) => ({ ...paint, id: i ? `floor${i + 1}` : "floor", name: i ? (mark === "~" ? "Crawlway" : `Floor ${i + 1}`) : "Floor", mark, about: i ? "Another kind of floor this deck has" : paint.about }));
  });
}

const deckFile = (place, level) => path.join(MAPS_DIR, place, `${level}.tmj`);
const tilesetFile = () => path.join(MAPS_DIR, "tiles", "stand-ins.tsj");
const lifeFile = (place) => path.join(LIFE_DIR, `${place}.json`);
const isDeck = (place, level) => NAME.test(String(place)) && NAME.test(String(level)) && fs.existsSync(deckFile(place, level));
const plain = (value) => JSON.parse(JSON.stringify(value, (key, v) => (v instanceof Set ? [...v].sort() : v)));

function need(place, level) {
  if (!isDeck(place, level)) throw new Error("There's no deck like that to change.");
}

// ---- What there is to change -----------------------------------------------------------------------------------

// The decks of a place drawn as files, with their names.
function decksOf(place) {
  const folder = path.join(MAPS_DIR, place);
  if (!NAME.test(place) || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return [];
  return fs.readdirSync(folder).filter((name) => name.endsWith(".tmj")).sort().map((name) => {
    const id = name.slice(0, -4);
    try {
      const { level } = roomFromMap(readMapFile(path.join(folder, name)), { rooms: new Set([id]) });
      return { id, name: level.name ?? id, areas: (level.areas ?? []).map((area) => area.id) };
    } catch {
      return { id, name: id, areas: [] };
    }
  });
}

// Every place with decks to change. For now that's the Meridian: the other places' rooms are still in their own files.
export function editableMaps() {
  if (!fs.existsSync(MAPS_DIR)) return [];
  return fs.readdirSync(MAPS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "tiles" && fs.existsSync(path.join(MAPS_DIR, `${entry.name}.json`)))
    .map((entry) => ({ place: entry.name, decks: decksOf(entry.name).map(({ id, name }) => ({ id, name })) }))
    .filter((one) => one.decks.length);
}

// A deck as the game reads it, straight from its file: the words in it are kept exactly as they're written there.
function levelOf(place, level) {
  const ids = new Set(decksOf(place).map((one) => one.id));
  const { level: read, problems } = roomFromMap(readMapFile(deckFile(place, level)), { rooms: ids });
  return { read, problems };
}

// Where people's days send them, on one deck: a spot names a room, and is on whichever deck that room is drawn on.
function spotsOn(place, level) {
  const life = WORLD_LIFE[place];
  if (!life?.spots) return [];
  const mine = new Set([level, ...(decksOf(place).find((one) => one.id === level)?.areas ?? [])]);
  return Object.entries(life.spots).filter(([, [room]]) => mine.has(room)).map(([name, [room, x, y, side]]) => ({ name, room, x, y, ...(side ? { side } : {}) }));
}

// ---- A deck, taken apart for the editor --------------------------------------------------------------------------

// The plan with the letters taken out, and whoever and whatever stood on them beside it. What's under a letter is
// floor for someone standing, and for a thing or a way out whatever's beside it (a console set into a wall is wall),
// which is how the deck's file has it too (src/tiled.js).
function apart(level) {
  const width = Math.max(1, ...level.plan.map((row) => row.length));
  const rows = level.plan.map((row) => [...row.padEnd(width)]);
  const floor = [...(level.floor ?? ".")][0];
  const stands = (ch) => ch === START || Boolean(level.people?.[ch]);
  const sits = (ch) => Boolean(level.things?.[ch] || level.exits?.[ch]);
  const people = [];
  const things = [];
  const exits = [];
  let start = null;
  const grid = rows.map((row, y) => row.map((ch, x) => {
    if (!stands(ch) && !sits(ch)) return ch;
    const other = row[x % 2 === 0 ? x + 1 : x - 1] ?? VOID;
    if (ch === START) start = { x, y };
    else if (level.people?.[ch]) people.push({ mark: ch, x, y, ...level.people[ch] });
    else if (level.things?.[ch]) things.push({ mark: ch, x, y, ...level.things[ch] });
    else exits.push({ mark: ch, x, y, ...level.exits[ch] });
    return stands(ch) || stands(other) || sits(other) || other === VOID ? floor : other;
  }).join(""));
  return { width, height: grid.length, floor, grid, people, things, exits, start };
}

// What the editor is given for a deck.
export function deckForEditing(place, level) {
  need(place, level);
  const { read, problems } = levelOf(place, level);
  const parts = apart(read);
  return {
    place,
    level,
    name: read.name ?? level,
    desc: read.desc ?? "",
    colors: read.colors ?? {},
    ...parts,
    people: parts.people.map((one) => ({ ...one, name: WORLD_CHARACTERS[one.id]?.name ?? one.label ?? one.id })),
    starts: read.starts ?? [],
    writing: (read.writing ?? []).map(([x, y, text]) => ({ x, y, text })),
    labels: (read.labels ?? []).map((label) => ({ x: label.at[0], y: label.at[1], text: label.text })),
    areas: (read.areas ?? []).map((area) => ({ ...area })),
    furniture: (read.furniture ?? []).map((piece) => ({ ...piece })),
    spots: spotsOn(place, level),
    decks: decksOf(place).map(({ id, name }) => ({ id, name })),
    floors: read.floor ?? parts.floor,
    paints: paintsFor(read.floor ?? parts.floor),
    problems,
  };
}

// ---- A deck, put back together from what the editor sends ----------------------------------------------------------

const whole = (value, most) => Number.isInteger(value) && value >= 0 && value < most;
const words = (value, most = 600) => String(value ?? "").replace(/\r/g, "").slice(0, most).trim();
const slugOf = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// The deck the game would read, from the editor's parts. Whatever the editor doesn't change (the deck's name, its
// colours, its floor) is the file's own. Throws, in plain words, at anything that can't be a deck.
function together(doc, read) {
  const base = apart(read);
  const { width, height, floor } = base;
  const rows = doc?.grid;
  if (!Array.isArray(rows) || rows.length !== height || rows.some((row) => typeof row !== "string" || [...row].length !== width)) throw new Error("The deck isn't the size it was. Open it again and make the change once more.");
  const letters = new Set([START, ...[...(doc.people ?? []), ...(doc.things ?? []), ...(doc.exits ?? [])].map((one) => one?.mark)]);
  if (rows.some((row) => [...row].some((ch) => ch < " " || ch > "~" || letters.has(ch)))) throw new Error("There's a mark on the deck that can't be painted there.");
  const plan = rows.map((row) => [...row]);
  const taken = new Set();
  const put = (mark, one, what) => {
    if (!whole(one?.x, width) || !whole(one?.y, height)) throw new Error(`${what} is off the edge of the deck.`);
    const key = `${one.x},${one.y}`;
    if (taken.has(key)) throw new Error(`${what} is on the same square as something else. Move one of them.`);
    taken.add(key);
    plan[one.y][one.x] = mark;
  };
  const marked = (list, kind, what) => {
    const seen = new Set();
    const out = {};
    for (const one of list ?? []) {
      if (typeof one?.mark !== "string" || !MARKS[kind].includes(one.mark) || one.mark.length !== 1 || seen.has(one.mark)) throw new Error(`${what(one)} has lost its mark. Open the deck again.`);
      seen.add(one.mark);
      put(one.mark, one, what(one));
      const { mark, x, y, ...rest } = one;
      out[mark] = rest;
    }
    return out;
  };
  // People stand where they're put, and are who the file says they are: the editor only moves them.
  const people = marked((doc.people ?? []).map((one) => ({ ...(read.people?.[one.mark] ?? {}), mark: one.mark, x: one.x, y: one.y })), "person", (one) => `Whoever stands at ${one.mark}`);
  if (Object.keys(people).sort().join() !== Object.keys(read.people ?? {}).sort().join()) throw new Error("Someone who stands on this deck is missing, or new. People are only moved here.");
  const things = marked((doc.things ?? []).map((one) => {
    const kept = read.things?.[one.mark] ?? {};
    const name = words(one.name, 80);
    if (!name) throw new Error("A thing needs a name.");
    const out = { ...kept, mark: one.mark, x: one.x, y: one.y, name };
    for (const key of ["look", "use", "used"]) {
      const value = words(one[key]);
      if (value) out[key] = value;
      else delete out[key];
    }
    // What it's drawn as (public/furniture.js): a piece that stands on the floor, a plain box, or, with nothing, what
    // its name says; and which way it faces.
    const looks = words(one.looks, 30).toLowerCase();
    if (looks && looks !== "box" && (!isFurniture(looks) || FURNITURE_BY_ID[looks].wall)) throw new Error(`${name} can't be drawn as that.`);
    if (looks) out.looks = looks;
    else delete out.looks;
    if (FACINGS.includes(one.facing)) out.facing = one.facing;
    else delete out.facing;
    return out;
  }), "thing", (one) => one.name ?? "A thing");
  const exits = marked((doc.exits ?? []).map((one) => ({ ...(read.exits?.[one.mark] ?? {}), mark: one.mark, x: one.x, y: one.y })), "exit", (one) => one.label ?? "A way out");
  if (Object.keys(exits).sort().join() !== Object.keys(read.exits ?? {}).sort().join()) throw new Error("A stair on this deck is missing, or new. Stairs are only moved here.");
  if (base.start) {
    if (!doc.start) throw new Error("The flag that says where the deck starts is missing.");
    put(START, doc.start, "The start flag");
  }
  const areas = [];
  const ids = new Set();
  for (const area of doc.areas ?? []) {
    const name = words(area.name, 60);
    if (!name) throw new Error("A room needs a name.");
    const id = NAME.test(String(area.id ?? "")) ? area.id : slugOf(name);
    // A room is found by its name as well as by its id, so both have to be its own.
    if (!id || ids.has(id) || ids.has(`name:${name.toLowerCase()}`)) throw new Error(`Two rooms can't both be called ${name}.`);
    ids.add(`name:${name.toLowerCase()}`);
    ids.add(id);
    if (![area.x, area.y, area.w, area.h].every(Number.isInteger) || area.w < 2 || area.h < 1 || area.x < 0 || area.y < 0 || area.x + area.w > width + 1 || area.y + area.h > height) throw new Error(`${name} doesn't fit on the deck.`);
    const kept = (read.areas ?? []).find((one) => one.id === id) ?? {};
    const { x: _x, y: _y, w: _w, h: _h, name: _name, desc: _desc, ...rest } = kept;
    const desc = words(area.desc);
    areas.push({ ...rest, id, name, x: area.x, y: area.y, w: area.w, h: area.h, ...(desc ? { desc } : {}) });
  }
  const lettered = (list, what) => (list ?? []).map((one) => {
    const text = words(one.text, 60);
    if (!text) throw new Error(`${what} need some words in them.`);
    if (!whole(one.x, width) || !whole(one.y, height)) throw new Error(`"${text}" is off the edge of the deck.`);
    return { x: one.x, y: one.y, text };
  });
  // Furniture, in the order the deck's file keeps it, so the deck reads back the same.
  const furniture = (doc.furniture ?? []).map((one) => {
    if (!isFurniture(one?.kind)) throw new Error("A piece of furniture on the deck isn't one the game knows. Open the deck again.");
    if (!whole(one.x, width) || !whole(one.y, height)) throw new Error(`The ${FURNITURE_BY_ID[one.kind].name.toLowerCase()} is off the edge of the deck.`);
    return { kind: one.kind, x: one.x, y: one.y, facing: FACINGS.includes(one.facing) ? one.facing : "s" };
  }).sort((a, b) => a.y - b.y || a.x - b.x || a.kind.localeCompare(b.kind));
  const { furniture: _was, ...rest } = read;
  return {
    ...rest,
    ...(furniture.length ? { furniture } : {}),
    // Every row at its full width, so the deck stays the size it is however much of its edge is open space.
    plan: plan.map((row) => row.join("")),
    floor: read.floor ?? floor,
    people,
    things,
    exits,
    writing: lettered(doc.writing, "Words on a wall").map((one) => [one.x, one.y, one.text.toUpperCase()]),
    labels: lettered(doc.labels, "Names on the deck").map((one) => ({ text: one.text.toUpperCase(), at: [one.x, one.y] })),
    areas,
  };
}

// ---- What's wrong with a deck, that the owner can see and put right ------------------------------------------------

const STEPS = [[0, -1], [-1, 0], [1, 0], [0, 1]];

// Every square that can be walked to from where the deck starts (or from a stair, or anywhere, if it starts nowhere).
function reached(compiled) {
  const { open, width, height } = compiled;
  const seen = open.map((row) => row.map(() => false));
  const from = [];
  const begin = (x, y) => {
    if (open[y]?.[x] && !seen[y][x]) {
      seen[y][x] = true;
      from.push([x, y]);
    }
  };
  begin(compiled.start.x, compiled.start.y);
  for (const exit of compiled.exits) for (const [dx, dy] of STEPS) begin(exit.x + dx, exit.y + dy);
  if (!from.length) {
    outer: for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (open[y][x]) { begin(x, y); break outer; }
  }
  while (from.length) {
    const [x, y] = from.pop();
    for (const [dx, dy] of STEPS) begin(x + dx, y + dy);
  }
  return seen;
}

// What the owner should know about a deck before keeping it: each with where it is, so the editor can point at it.
export function deckProblems(level, id = "deck") {
  let compiled;
  try {
    compiled = compileLevel(id, level);
  } catch (err) {
    return [{ words: `The deck can't be read: ${err.message}` }];
  }
  const out = [];
  const { open, width, height } = compiled;
  const seen = reached(compiled);
  const nameAt = (x, y) => (compiled.areas.find((area) => area.id === compiled.areaAt(x, y))?.name ?? "the deck's passages").replace(/^The /, "the ");
  // Floor nobody can get to, a patch at a time.
  const cut = open.map((row) => row.map(() => false));
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!open[y][x] || seen[y][x] || cut[y][x]) continue;
    let size = 0;
    const patch = [[x, y]];
    cut[y][x] = true;
    while (patch.length) {
      const [px, py] = patch.pop();
      size += 1;
      for (const [dx, dy] of STEPS) {
        const nx = px + dx;
        const ny = py + dy;
        if (open[ny]?.[nx] && !seen[ny][nx] && !cut[ny][nx]) {
          cut[ny][nx] = true;
          patch.push([nx, ny]);
        }
      }
    }
    out.push({ words: `Nobody can get to ${size === 1 ? "a square" : `${size} squares`} of floor in ${nameAt(x, y)}: there's no doorway to it.`, x, y });
  }
  const beside = (one) => STEPS.some(([dx, dy]) => seen[one.y + dy]?.[one.x + dx]);
  for (const thing of compiled.things) if (!beside(thing)) out.push({ words: `${thing.name} can't be reached: put it beside floor someone can walk to.`, x: thing.x, y: thing.y });
  for (const exit of compiled.exits) if (!beside(exit)) out.push({ words: `${exit.label ?? "A stair"} can't be reached: put it beside floor someone can walk to.`, x: exit.x, y: exit.y });
  for (const home of compiled.homes) if (!seen[home.y]?.[home.x]) out.push({ words: `${WORLD_CHARACTERS[home.id]?.name ?? home.label ?? home.id} stands somewhere nobody can get to.`, x: home.x, y: home.y });
  for (const area of level.areas ?? []) {
    let floor = 0;
    for (let y = area.y; y < area.y + area.h; y += 1) for (let x = area.x; x < area.x + area.w; x += 1) if (open[y]?.[x] && compiled.areaAt(x, y) === area.id) floor += 1;
    if (!floor) out.push({ words: `${area.name} has no floor in it.`, x: area.x, y: area.y });
  }
  // Furniture stands on floor, a window or a screen on a wall the room can see, and two pieces don't share a square.
  const floors = new Set(level.floor ?? ".");
  const standable = (x, y) => {
    const ch = level.plan[y]?.[x] ?? VOID;
    return floors.has(ch) || ch === START || Boolean(level.people?.[ch]);
  };
  const under = new Map();
  for (const piece of level.furniture ?? []) {
    const kind = FURNITURE_BY_ID[piece.kind];
    if (!kind) continue;
    const name = kind.name.toLowerCase();
    const at = { x: piece.x, y: piece.y };
    if (kind.wall) {
      if (level.plan[piece.y]?.[piece.x] !== WALL) out.push({ words: `The ${name} has to hang on a wall.`, ...at });
      else if (!standable(piece.x, piece.y + 1) && !standable(piece.x + 1, piece.y)) out.push({ words: `Nobody would see the ${name} from the room: put it on a wall with floor below it or to the right of it.`, ...at });
      continue;
    }
    const squares = squaresOf(piece);
    if (squares.some(([x, y]) => !standable(x, y))) out.push({ words: `The ${name} is standing on something that isn't floor.`, ...at });
    // What lies on the floor goes under whatever stands there, and a small thing sits on a table: neither takes the
    // square for itself.
    const shares = kind.pack && (kind.what === "rug" || kind.what === "small");
    const on = shares ? null : squares.map(([x, y]) => under.get(`${x},${y}`)).find(Boolean);
    if (on) out.push({ words: `The ${name} is on top of the ${on}.`, ...at });
    if (!shares) for (const [x, y] of squares) under.set(`${x},${y}`, name);
    const post = kind.blocks && compiled.homes.find((home) => squares.some(([x, y]) => x === home.x && y === home.y));
    if (post) out.push({ words: `The ${name} is on ${WORLD_CHARACTERS[post.id]?.name ?? post.label ?? post.id}'s post, and they'd stand inside it.`, ...at });
  }
  if (width > 200 || height > 60) out.push({ words: "The deck is bigger than the game can draw." });
  return out;
}

// A spot someone's day sends them to can be floor, a bunk, a cot or a seat at a console, but not the inside of a wall
// or the dark outside the hull. One that is, once the deck's been redrawn, is moved to the nearest floor, in the same
// room if there's any. Gives the spots as they should be, and which were moved.
function spotsOnFloor(level, id, spots) {
  const compiled = compileLevel(id, level);
  const { open, width, height } = compiled;
  const moved = [];
  const out = (spots ?? []).map((spot) => {
    const on = level.plan[spot.y]?.[spot.x] ?? VOID;
    if (open[spot.y]?.[spot.x] || (on !== WALL && on !== VOID)) return spot;
    const room = compiled.areaAt(spot.x, spot.y);
    let best = null;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      if (!open[y][x]) continue;
      // A step across is half a step down: the squares are half as wide as they're deep.
      const far = Math.abs(x - spot.x) / 2 + Math.abs(y - spot.y) + (compiled.areaAt(x, y) === room ? 0 : 1000);
      if (!best || far < best.far) best = { x, y, far };
    }
    if (!best) return spot;
    moved.push(spot.name);
    return { ...spot, x: best.x, y: best.y };
  });
  return { spots: out, moved };
}

// ---- Trying a change out, and keeping it -------------------------------------------------------------------------

// The stand-in tiles, which only ever grow: a piece that isn't there yet gets the next number and a picture.
function tilesFor() {
  const file = tilesetFile();
  const tileset = JSON.parse(fs.readFileSync(file, "utf8"));
  const prop = (tile, name) => tile.properties?.find((one) => one.name === name)?.value ?? "";
  const known = new Map(tileset.tiles.filter((tile) => prop(tile, "mark")).map((tile) => [pieceKey({ mark: prop(tile, "mark"), floor: prop(tile, "floor") }), tile.id]));
  const figures = Object.fromEntries([["person", "Person"], ["thing", "Thing"], ["exit", "Way out"], ["start", "Start"]].map(([kind, type]) => {
    const tile = tileset.tiles.find((one) => one.type === type);
    if (!tile) throw new Error(`The stand-in tiles have no ${type} tile.`);
    return [kind, { gid: tile.id + 1, width: tile.imagewidth, height: tile.imageheight }];
  }));
  const fresh = [];
  let nextId = Math.max(-1, ...tileset.tiles.map((tile) => tile.id)) + 1;
  const gidOf = (piece) => {
    const key = pieceKey(piece);
    if (!known.has(key)) {
      known.set(key, nextId);
      fresh.push({ id: nextId, piece });
      nextId += 1;
    }
    return known.get(key) + 1;
  };
  const grown = () => {
    if (!fresh.length) return null;
    const tiles = [...tileset.tiles, ...fresh.map(({ id, piece }) => ({
      id,
      image: `stand-ins/piece-${String(id).padStart(3, "0")}.png`,
      imagewidth: PIECE.width,
      imageheight: PIECE.height,
      properties: [{ name: "floor", type: "string", value: piece.floor }, { name: "mark", type: "string", value: piece.mark }, { name: "what", type: "string", value: pieceWords(piece) }],
    }))];
    return { text: `${JSON.stringify({ ...tileset, tiles, tilecount: tiles.length }, null, 1)}\n`, images: fresh.map(({ id, piece }) => ({ name: `piece-${String(id).padStart(3, "0")}.png`, data: pieceImage(piece) })) };
  };
  return { gidOf, figures, grown };
}

// The spots as the place's life file has them, with these changed: the file's own text, a line at a time, so nothing
// else in it moves.
function lifeText(place, spots) {
  const file = lifeFile(place);
  if (!fs.existsSync(file)) return null;
  let text = fs.readFileSync(file, "utf8");
  const now = JSON.parse(text).spots ?? {};
  let changed = false;
  for (const spot of spots) {
    const was = now[spot.name];
    if (!was || (was[1] === spot.x && was[2] === spot.y)) continue;
    const name = spot.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const line = new RegExp(`("${name}"\\s*:\\s*\\[\\s*"[^"]*"\\s*,\\s*)-?\\d+(\\s*,\\s*)-?\\d+`);
    if (!line.test(text)) throw new Error(`The spot ${spot.name} couldn't be found in the life file to move it.`);
    text = text.replace(line, (all, before, between) => `${before}${spot.x}${between}${spot.y}`);
    changed = true;
  }
  if (!changed) return null;
  JSON.parse(text);
  return text;
}

// Everything the game's own checker finds wrong, with the maps and the life files in these folders.
// It's run apart from the game, which has read its own files already: from a little script of its own, so that it
// works the same whether the game is run by Node or from inside the installed app.
function gameProblems(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "map-check-"));
  const script = path.join(dir, "check.mjs");
  fs.writeFileSync(script, `import { pathToFileURL } from "node:url";\nconst m = await import(pathToFileURL(${JSON.stringify(path.join(projectDir, "src", "scenes.js"))}).href);\nprocess.stdout.write(JSON.stringify(m.allStoryProblems().problems));\n`);
  try {
    const out = execFileSync(process.execPath, [script], { cwd: projectDir, env: { ...process.env, ...env, GAME_DATA_DIR: dir, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", maxBuffer: 1 << 26, windowsHide: true });
    return JSON.parse(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A copy of the maps and the life files with the change in it, which the checker and the readers can be pointed at.
function trial(place, level, map, tiles, life) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "map-trial-"));
  const maps = path.join(dir, "maps");
  const lives = path.join(dir, "life");
  fs.cpSync(MAPS_DIR, maps, { recursive: true });
  if (fs.existsSync(LIFE_DIR)) fs.cpSync(LIFE_DIR, lives, { recursive: true });
  else fs.mkdirSync(lives);
  fs.writeFileSync(path.join(maps, place, `${level}.tmj`), map);
  if (tiles) {
    fs.writeFileSync(path.join(maps, "tiles", "stand-ins.tsj"), tiles.text);
    for (const image of tiles.images) fs.writeFileSync(path.join(maps, "tiles", "stand-ins", image.name), image.data);
  }
  if (life) fs.writeFileSync(path.join(lives, `${place}.json`), life);
  return { dir, maps, lives };
}

// The deck as it's drawn in the editor now, described for its picture the way the game describes any level
// (src/walk.js, draftLook), with nothing saved and nothing tried out: the editor draws the room from it beside its
// plan, afresh after each change, so it has to be quick. What can't be a deck at all is refused in plain words.
export function deckLook(place, level, doc) {
  need(place, level);
  const { read } = levelOf(place, level);
  return draftLook(place, compileLevel(level, together(doc, read)));
}

// Tries a change out, and keeps it if `keep` says so and nothing new is wrong (or `anyway` says to keep it all the
// same). Gives what's wrong on the deck itself, what the rest of the game would newly make of it, what was put right
// by itself, and whether it was kept. `whole: false` looks at the deck alone, which takes no time at all.
export function tryDeck(place, level, doc, { keep = false, anyway = false, whole = true } = {}) {
  need(place, level);
  const { read } = levelOf(place, level);
  const made = together(doc, read);
  const fixed = spotsOnFloor(made, level, (doc.spots ?? []).map((spot) => {
    const was = WORLD_LIFE[place]?.spots?.[spot.name];
    if (!was) throw new Error(`There's no spot called ${spot.name}.`);
    return { name: spot.name, room: was[0], x: spot.x, y: spot.y };
  }));
  const notes = fixed.moved.length ? [`${fixed.moved.length === 1 ? "One spot where someone stands was" : `${fixed.moved.length} spots where people stand were`} inside something, and moved to the nearest floor.`] : [];
  const problems = deckProblems(made, level);
  const tiles = tilesFor();
  const map = `${JSON.stringify(roomToMap(made, { gidOf: tiles.gidOf, figures: tiles.figures }), null, 1)}\n`;
  const grown = tiles.grown();
  const life = lifeText(place, fixed.spots);
  const copy = trial(place, level, map, grown, life);
  try {
    // Read back from the copy, the deck has to be the deck that was made.
    const ids = new Set(decksOf(place).map((one) => one.id));
    const back = roomFromMap(readMapFile(path.join(copy.maps, place, `${level}.tmj`)), { rooms: ids });
    if (!isDeepStrictEqual(plain(compileLevel(level, made)), plain(compileLevel(level, back.level)))) throw new Error("The deck wouldn't come back from its file the way it was drawn, so nothing's been changed. Tell whoever looks after the game's code.");
    let elsewhere = [];
    if (whole) try {
      const before = new Set(gameProblems());
      elsewhere = gameProblems({ GAME_MAPS_DIR: copy.maps, GAME_LIFE_DIR: copy.lives }).filter((line) => !before.has(line));
    } catch {
      notes.push("The rest of the game couldn't be checked from here, so only the deck itself was looked at.");
    }
    const wrong = problems.length + elsewhere.length;
    if (!keep || (wrong && !anyway)) return { kept: false, problems, elsewhere, notes };
    // Kept: what's there goes to the backups first, then the life file, the tiles and, last, the deck, which is what
    // the game watches for.
    const backups = path.join(dataDir(), "map-backups");
    fs.mkdirSync(backups, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(deckFile(place, level), path.join(backups, `${place}-${level}-${stamp}.tmj`));
    if (life) {
      fs.copyFileSync(lifeFile(place), path.join(backups, `${place}-life-${stamp}.json`));
      fs.writeFileSync(lifeFile(place), life);
      for (const spot of fixed.spots) {
        const was = WORLD_LIFE[place].spots[spot.name];
        WORLD_LIFE[place].spots[spot.name] = [was[0], spot.x, spot.y, ...was.slice(3)];
      }
    }
    if (grown) {
      fs.mkdirSync(path.join(MAPS_DIR, "tiles", "stand-ins"), { recursive: true });
      for (const image of grown.images) fs.writeFileSync(path.join(MAPS_DIR, "tiles", "stand-ins", image.name), image.data);
      fs.writeFileSync(tilesetFile(), grown.text);
    }
    fs.writeFileSync(deckFile(place, level), map);
    return { kept: true, problems, elsewhere, notes, backup: path.join(backups, `${place}-${level}-${stamp}.tmj`) };
  } finally {
    fs.rmSync(copy.dir, { recursive: true, force: true });
  }
}

// The picture makers are only needed for the tiles' own files; naming them here keeps a missing one from going unseen.
export const STAND_INS = { FIGURES, figureImage };
