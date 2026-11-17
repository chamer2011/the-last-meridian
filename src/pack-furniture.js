// What each piece of the bought packs is to the game once it stands on a deck: a seat, a table, something to open, a
// fitting on a wall; how much floor it takes; whether people walk round it. It's step 2 of the map's rework
// with the packs. The catalogue (src/pieces.js) says which pictures are a piece and whether it's
// on the ship; this says what the piece is, and hands every one of them to the game's list of furniture
// (public/furniture.js) under the piece's own id, so a deck's file can hold one like any chair or locker.
//
// The facts are kept in world/furniture.txt, in plain words, a line a piece. That file alone is what the game goes
// by: the packs' pictures are only on the owner's computer, and where people can walk mustn't depend on them. A line
// was first written from a guess (guessFurniture: what a piece is by its name, how much floor it takes by measuring
// its picture), and is anyone's to change after that, by hand or from the Pieces window.

import fs from "node:fs";
import path from "node:path";
import { worldDir } from "./paths.js";
import { addChecker } from "./room-hooks.js";
import { PLACES, catalogue, licensedDir } from "./pieces.js";
import { solidBoxOf } from "./png.js";
import { setPackFurniture } from "../public/furniture.js";

export const furnitureFile = () => process.env.GAME_FURNITURE_FILE || path.join(worldDir, "furniture.txt");

// What a piece can be, in the file's words; whether each kind is in the way unless its line says otherwise; and how
// high each stands, in tiles, unless its line says (a table's top, for what's put on it; how far up a wall a fitting
// hangs).
export const WHATS = [
  { id: "seat", words: "a seat", blocks: false, high: 0.5 },
  { id: "bed", words: "a bed", blocks: false, high: 0.5 },
  { id: "table", words: "a table", blocks: true, high: 0.75 },
  { id: "stand", words: "stands on the floor", blocks: true, high: 1 },
  { id: "opens", words: "something to open", blocks: true, high: 1.3 },
  { id: "wall", words: "hangs on a wall", blocks: false, high: 0.95 },
  { id: "rug", words: "lies on the floor", blocks: false, high: 0 },
  { id: "small", words: "a small thing", blocks: false, high: 0.2 },
];
const WHAT = Object.fromEntries(WHATS.map((one) => [one.id, one]));
// What something to open opens like: one of the game's own pieces, whose containers it then has (src/loot.js).
export const LIKES = { locker: "a locker", shelf: "shelves", desk: "a desk", barrel: "a barrel" };
const LIKE_BY_WORD = { locker: "locker", lockers: "locker", shelf: "shelf", shelves: "shelf", desk: "desk", barrel: "barrel", crate: "barrel", box: "barrel" };
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

// ---- The first guess --------------------------------------------------------------------------------------------

// Pieces that are what a deck is built of, not what stands in it: floors, walls, doors and stairs. They aren't
// furniture, and later steps of the rework use them.
const NOT_FURNITURE = /^(isospace\/(floor|wall|low-wall|pillar|stairs|stair-rail|door)-|interiors\/(Floor_Wall_Tiles_128|Doors|StairCase)\/|interiors\/Lab\/Door_Lab$|interiors\/Japanese_Room\/(Floor_|Wall_|Japanese_Door))/;
// What a piece is, by where it is in the packs and what it's called there. The first line that fits; anything else
// stands on the floor.
const RULES = [
  [/^interiors\/(Chairs\/|Sofa\/Sofa_)|^isospace\/(padded-chair|sofa)$|Japanese_Seat$|Projector_Stand$|Bathroom\/WC_Ani$/, { what: "seat" }],
  [/^interiors\/Bedroom\/Bed_|^isospace\/(bunk|pod)$/, { what: "bed" }],
  [/^interiors\/Carpets\/|Bath_Carpet$|Kitchen_Rug$|Shower_(Floor|Tray)$/, { what: "rug" }],
  [/^interiors\/(Wall_Decoration|Windows)\/|^interiors\/Televisions_TV\/BigTv|^interiors\/Clocks\/Wall_Clock/, { what: "wall" }],
  [/^interiors\/Lab\/(Cable|Pipe|Switch|Camera|Screen_Small|Ac_Big_1|Tools$)/, { what: "wall" }],
  [/^interiors\/Office\/(AC|Board|Corkboard|Diploma|Long_Rack|Photos|Tv|Fire_Extinguisher|Medical_Kit)/, { what: "wall" }],
  [/^interiors\/Kitchen\/(Shelf|Rack|Wall_Protection|Kitchen_Tiles|Kitchen_Window|Painting)$/, { what: "wall" }],
  [/^interiors\/Bathroom\/(Mirror|Hanger|Hanging_Towel|Long_Shelf|Small_Shelf|Tap_Wall|Shower_Tap|Tap_Shower|Bath_window|Toilet_Paper)$/, { what: "wall" }],
  [/^interiors\/Lamps\/(Lamp_7|Lamp_Modern)$|^interiors\/Living Roon\/(AirCC|shelving_6)$|^interiors\/Japanese_Room\/Japanese_Canvas/, { what: "wall" }],
  [/Office_(Metallic|Wood)_Closet|Japanese_Closet$|^isospace\/locker-light$/, { what: "opens", like: "locker" }],
  [/^interiors\/Kitchen\/(Fridge|Fidge_Red|Kitchen|Kitchen_Furniture_\w+)$|^interiors\/Office\/Rack$|shelving_7$|Japanese_Shelf$|Wc_Furniture$|^isospace\/cooler$/, { what: "opens", like: "shelf" }],
  [/^interiors\/Desks\/(Desk_1|Office_Normal_Table_Ani)$|^interiors\/Bedroom\/Night_Table$/, { what: "opens", like: "desk" }],
  [/^isospace\/(drums|cases|crate-dark|crate-light)$|Carton_Box$|White_Box$|^interiors\/Kitchen\/(Box_2|TrashBin|Clothes_Basket)$|^interiors\/Lab\/(Plastic_Box|Tool_Box)|Clothes_Case$|Shower_Bin$|^interiors\/Office\/Trash/, { what: "opens", like: "barrel" }],
  [/^interiors\/(Tables|Desks)\/|SmallTable_5$|Japanese_Table$|^isospace\/(chart-table|terminal|console)$/, { what: "table" }],
  [/^interiors\/(Books|Consoles|Present|Computer|Cat_Ani)\//, { what: "small" }],
  [/^interiors\/Kitchen\/(Bottle|Cereals|Cola|Cutting_Board|Dish|Fork|Frying_Pan|Glass|Ketel|Kitchen_Knife|Kitchen_Soap|Mug|Pot|Rag|Scourer|Soap|Soda_Can|Spoon|Sugar|TeaPot|Toaster|CoffeMachine|Microwave|Wine)/, { what: "small" }],
  [/^interiors\/Bathroom\/(Soap_|Tissues|Towel_|Duck)|^interiors\/(Bedroom|Sofa)\/Pillow_|^interiors\/Lamps\/(Lamp_8|Lamp_9|Lamp_11|LavaLamp)/, { what: "small" }],
  [/^interiors\/Japanese_Room\/(Candle|Japanese_Cup|Japanese_BaseCup|Japanese_Dish|Japanese_Tea|Bonsai)$|^interiors\/Living Roon\/Book_/, { what: "small" }],
  [/^interiors\/Office\/(Blueprint|Calculator|Headset|Paper|Pencil|Picture_Frame|Rolled|Ruler|Sticky|Telephone|Whiteboard_Eraser|Printer)/, { what: "small" }],
  [/^interiors\/Lab\/(Microscope|VoltageMeter|Tools_Electric|Printer_Filament|Oscilator|3D_Printer|Server_3)/, { what: "small" }],
];
// What gives off light, and its colour.
const LIGHTS = [
  [/^interiors\/(Computer\/|Televisions_TV\/|Office\/Tv$|Lab\/(Screen_Small|Server|Oscilator))|^isospace\/(terminal|console|rack-dark)$/, "#86dcff"],
  [/^interiors\/Lamps\/Lamp_(7|8|9|10|11)$|Japanese_Lamp$|Candle$/, "#ffd9a0"],
  [/Lamp_Modern$/, "#dfeaff"],
  [/LavaLamp/, "#b98cff"],
  [/^isospace\/chart-table$/, "#7dffa8"],
  [/^isospace\/tank$/, "#7dffe0"],
];

// The picture a piece is measured by: the side it shows when it faces the camera, or its first.
const firstPicture = (piece) => piece.pictures?.find((picture) => picture.side === "A") ?? piece.pictures?.[0] ?? null;

// What the game takes a piece of the catalogue to be, before anyone has said: null for what a deck is built of.
// How much floor it takes and how high it stands are read off its picture when the picture's here: a thing drawn from
// its corner is as wide as its two sides together, and its lowest point says where one ends and the other begins.
export function guessFurniture(piece) {
  if (NOT_FURNITURE.test(piece.id)) return null;
  const rule = RULES.find(([of]) => of.test(piece.id))?.[1] ?? { what: "stand" };
  const facts = { what: rule.what, like: rule.like ?? null, across: 1, down: 1, high: WHAT[rule.what].high, blocks: WHAT[rule.what].blocks, lit: LIGHTS.find(([of]) => of.test(piece.id))?.[1] ?? null, steel: false };
  if (facts.what === "wall" || facts.what === "small") return facts;
  const picture = firstPicture(piece);
  const box = picture ? solidBoxOf(path.join(licensedDir(), picture.file), picture.x === undefined ? null : picture) : null;
  if (!box) return facts;
  const wide = box.x1 - box.x0 + 1;
  const tall = box.y1 - box.y0 + 1;
  // In tiles: along the deck's rows, and along its columns. The packs' pictures are drawn a little bigger than they
  // are, to stand as tall as the game's walls (public/pixel-art.js), so they take that much more floor too.
  const bigger = 1.7 / 1.375;
  const across = ((box.front * wide) / 64) * bigger;
  const down = (((1 - box.front) * wide) / 64) * bigger;
  const sofa = /sofa/i.test(piece.id);
  if (facts.what !== "seat" || sofa) facts.across = clamp(Math.round(across / 0.5), 1, 8);
  if (facts.what !== "seat") facts.down = clamp(Math.round(down), 1, 4);
  // How high it stands is as its picture has it: the packs' pieces are drawn at their own size.
  if (facts.what !== "rug") facts.high = clamp(Math.round(((tall - wide / 2) / 64) * 20) / 20, 0.1, 2);
  return facts;
}

// ---- The file -----------------------------------------------------------------------------------------------------

const TOP = [
  "What each piece of the two pixel-art packs is to the game, once it stands on a deck.",
  "",
  "How this file works",
  "- A line a piece: its name, in square brackets where its pictures are in the packs, then what it is.",
  "- What it is, first: a seat, a bed, a table, stands on the floor, something to open like a locker (or like shelves, like a desk, like a barrel), hangs on a wall, lies on the floor, or a small thing. A small thing put on a table's square sits on the table.",
  "- Then how many squares it takes, across by down, as it stands facing you. A square is half a tile across and a whole tile down, so \"2 by 1\" is one whole tile.",
  "- Then, if you like: how high it stands in tiles (\"0.8 high\": a table's top, or how far up the wall a fitting hangs), \"in the way\" or \"not in the way\" where that isn't what its kind usually is, and \"glows\" with a colour for a thing that gives off light.",
  "- And \"in steel\" for a piece drawn in wood or orange that a ship would have in steel: its picture is drawn with the brown and the orange turned blue-grey.",
  "- Leave what's in the square brackets as it is, and the name is only here to read: the name the game uses is the one in pieces.txt.",
  "- The floors, walls, doors and stairs of the packs aren't in here: a deck is built of those, and they come later.",
];

const PLACE_NAMES = new Set(PLACES.map((place) => place.name.toLowerCase()));

function readFacts(words) {
  const facts = { what: null, like: null, across: 1, down: 1, high: null, blocks: null, lit: null, steel: false };
  for (const part of words.split(",").map((one) => one.trim()).filter(Boolean)) {
    const said = part.toLowerCase();
    const open = said.match(/^something to open(?: like (?:an? )?([a-z]+))?$/);
    const size = said.match(/^(\d+) by (\d+)$/);
    const high = said.match(/^(\d+(?:\.\d+)?) high$/);
    const glows = said.match(/^glows (#[0-9a-f]{6})$/);
    const what = WHATS.find((one) => one.words === said);
    if (open) {
      facts.what = "opens";
      facts.like = LIKE_BY_WORD[open[1] ?? "barrel"] ?? null;
      if (!facts.like) return { problem: `"${part}": it can open like a locker, like shelves, like a desk or like a barrel` };
    } else if (what) facts.what = what.id;
    else if (size) [facts.across, facts.down] = [clamp(Number(size[1]), 1, 8), clamp(Number(size[2]), 1, 4)];
    else if (high) facts.high = clamp(Number(high[1]), 0, 2);
    else if (said === "in the way") facts.blocks = true;
    else if (said === "not in the way") facts.blocks = false;
    else if (glows) facts.lit = glows[1];
    else if (said === "in steel") facts.steel = true;
    else return { problem: `"${part}" isn't something this file knows` };
  }
  if (!facts.what) return { problem: "it doesn't say what the piece is (a seat, a table, hangs on a wall...)" };
  facts.high ??= WHAT[facts.what].high;
  facts.blocks ??= WHAT[facts.what].blocks;
  return { facts };
}

export function factsWords(facts) {
  const kind = WHAT[facts.what];
  const parts = [facts.what === "opens" ? `something to open like ${LIKES[facts.like] ?? LIKES.barrel}` : kind.words];
  if (facts.what !== "wall" && facts.what !== "small") parts.push(`${facts.across} by ${facts.down}`);
  if (facts.high !== kind.high) parts.push(`${facts.high} high`);
  if (facts.blocks !== kind.blocks) parts.push(facts.blocks ? "in the way" : "not in the way");
  if (facts.lit) parts.push(`glows ${facts.lit}`);
  if (facts.steel) parts.push("in steel");
  return parts.join(", ");
}

// Reads the file's words: each piece it lists with its name and what it is, and the lines it couldn't read.
export function parseFurniture(text) {
  const listed = new Map();
  const problems = [];
  let started = false;
  String(text).split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    if (PLACE_NAMES.has(line.toLowerCase())) {
      started = true;
      return;
    }
    if (!started) return;
    const piece = line.match(/^-\s*(.*?)\s*\[([^\]]+)\]\s*:\s*(.+)$/);
    if (!piece) {
      problems.push(`world/furniture.txt, line ${index + 1}: this line isn't "- a name [where it is]: what it is".`);
      return;
    }
    const id = piece[2].trim();
    const read = readFacts(piece[3]);
    if (read.problem) problems.push(`world/furniture.txt, line ${index + 1}: ${read.problem}.`);
    else if (listed.has(id)) problems.push(`world/furniture.txt, line ${index + 1}: "${id}" is listed twice; the first line counts.`);
    else listed.set(id, { id, name: piece[1].trim(), ...read.facts });
  });
  return { listed, problems };
}

// The file's words for these pieces ({ id, name, place, ...facts }), under their places' names.
export function writeFurniture(entries) {
  const lines = [...TOP];
  const known = new Set(PLACES.map((place) => place.id));
  for (const place of PLACES) {
    const here = entries.filter((one) => (known.has(one.place) ? one.place : "odds") === place.id);
    if (!here.length) continue;
    lines.push("", place.name);
    for (const one of here) lines.push(`- ${String(one.name).replace(/[\[\]]/g, "")} [${one.id}]: ${factsWords(one)}`);
  }
  return `${lines.join("\n")}\n`;
}

let read = null;
function readFile() {
  const file = furnitureFile();
  let stamp = 0;
  try {
    stamp = fs.statSync(file).mtimeMs;
  } catch {
    return { listed: new Map(), problems: [], saved: false };
  }
  if (read?.file !== file || read.stamp !== stamp) read = { file, stamp, ...parseFurniture(fs.readFileSync(file, "utf8")), saved: true };
  return read;
}

// What the file says each piece is, by its id.
export const furnitureFacts = () => readFile().listed;

// ---- For the game ---------------------------------------------------------------------------------------------------

const ABOUT = { seat: "A seat", bed: "A bed", table: "A table", stand: "Stands on the floor", opens: "Something to open", wall: "Hangs on a wall", rug: "Lies on the floor", small: "A small thing, on a table or on the floor" };

// A piece as the game's list of furniture has one (public/furniture.js).
function asFurniture(id, name, facts) {
  return {
    id, name, about: `${ABOUT[facts.what]}, from the packs`, pack: true, what: facts.what,
    size: [facts.across * 0.5, facts.down], blocks: facts.blocks, high: facts.high,
    ...(facts.what === "seat" ? { seat: true } : {}), ...(facts.what === "bed" ? { bed: true } : {}), ...(facts.what === "wall" ? { wall: true } : {}),
    ...(facts.what === "opens" ? { opens: facts.like } : {}), ...(facts.lit ? { lit: facts.lit } : {}),
    ...(facts.steel ? { steel: true } : {}),
  };
}

// Every piece the file knows, as furniture: from the file alone, so it's the same on a computer without the packs.
export function furnitureKinds() {
  return [...furnitureFacts().values()].map((one) => asFurniture(one.id, one.name, one));
}

// Tells the game's list of furniture what the file has now. Done when the game starts and whenever the file changes.
export function syncFurniture() {
  setPackFurniture(furnitureKinds());
}

// The catalogue with what each piece is put beside it (furniture: the file's line, else the guess marked guessed,
// else null for what a deck is built of).
export function withFurniture(all = catalogue()) {
  const listed = furnitureFacts();
  for (const piece of all.pieces) {
    const own = listed.get(piece.id);
    const facts = own ?? guessFurniture(piece);
    piece.furniture = facts ? { what: facts.what, like: facts.like, across: facts.across, down: facts.down, high: facts.high, blocks: facts.blocks, lit: facts.lit, steel: Boolean(facts.steel), known: Boolean(own) } : null;
  }
  all.furnitureProblems = readFile().problems;
  return all;
}

// For the page: every piece the file knows, as furniture, with the pictures it's drawn from where the packs are here
// (its four sides when the pack has all four, else one picture, turned round for the other two ways), its name as the
// catalogue has it, and whether it's on the ship.
export function furnitureForPage() {
  const all = catalogue();
  const pieces = new Map(all.pieces.map((piece) => [piece.id, piece]));
  return [...furnitureFacts().values()].map((one) => {
    const piece = pieces.get(one.id);
    const pictures = piece?.pictures ?? [];
    const side = (letter) => pictures.find((picture) => picture.side === letter) ?? null;
    const sides = ["A", "B", "C", "D"].map(side);
    return {
      ...asFurniture(one.id, piece?.name ?? one.name, one),
      on: piece ? piece.on : false,
      place: piece?.place ?? "odds",
      ...(sides.every(Boolean) ? { faces: { s: sides[0], e: sides[1], w: sides[2], n: sides[3] } } : pictures.length ? { picture: firstPicture(piece) } : {}),
    };
  });
}

// ---- Changing it ----------------------------------------------------------------------------------------------------

function save(listed, all = catalogue()) {
  const pieces = new Map(all.pieces.map((piece) => [piece.id, piece]));
  const entries = [...listed.values()].map((one) => ({ ...one, name: pieces.get(one.id)?.name ?? one.name, place: pieces.get(one.id)?.place ?? "odds" }));
  const order = new Map(all.pieces.map((piece, i) => [piece.id, i]));
  entries.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || a.id.localeCompare(b.id));
  fs.writeFileSync(furnitureFile(), writeFurniture(entries));
  read = null;
  syncFurniture();
}

// What the Pieces window changed about what pieces are: each { id, furniture: { what, like, across, down, high,
// blocks, lit } }, or furniture: null for a piece that isn't furniture after all. Anything left out of a change stays
// as it was. Changes without a furniture part are passed over (they're for the catalogue's ticks).
export function setFurniture(changes) {
  const wanted = (Array.isArray(changes) ? changes : []).filter((change) => change && "furniture" in change);
  if (!wanted.length) return null;
  const all = catalogue();
  const pieces = new Map(all.pieces.map((piece) => [piece.id, piece]));
  const listed = new Map(furnitureFacts());
  for (const change of wanted) {
    const piece = pieces.get(String(change.id ?? ""));
    if (!piece) throw new Error("That piece isn't in the packs.");
    if (change.furniture === null) {
      listed.delete(piece.id);
      continue;
    }
    const now = listed.get(piece.id) ?? guessFurniture(piece) ?? { what: "stand", like: null, across: 1, down: 1, high: WHAT.stand.high, blocks: true, lit: null, steel: false };
    const next = { ...now, ...change.furniture };
    if (!WHAT[next.what]) throw new Error("That isn't something a piece can be.");
    if (next.what !== now.what) {
      // Another kind of thing: in the way or not as that kind is, and as high, unless the change says.
      if (change.furniture.blocks === undefined) next.blocks = WHAT[next.what].blocks;
      if (change.furniture.high === undefined && (next.what === "wall" || next.what === "rug" || now.what === "wall" || now.what === "rug")) next.high = WHAT[next.what].high;
    }
    next.like = next.what === "opens" ? (LIKES[next.like] ? next.like : "barrel") : null;
    if (![next.across, next.down, next.high].every(Number.isFinite)) throw new Error("A piece's size has to be numbers.");
    next.across = clamp(Math.round(next.across), 1, 8);
    next.down = clamp(Math.round(next.down), 1, 4);
    next.high = clamp(Math.round(next.high * 20) / 20, 0, 2);
    next.blocks = Boolean(next.blocks);
    next.lit = /^#[0-9a-f]{6}$/i.test(next.lit ?? "") ? next.lit.toLowerCase() : null;
    listed.set(piece.id, { id: piece.id, name: piece.name, what: next.what, like: next.like, across: next.across, down: next.down, high: next.high, blocks: next.blocks, lit: next.lit, steel: Boolean(next.steel) });
  }
  save(listed, all);
  return { known: listed.size };
}

// Gives every piece of the packs that isn't in the file yet its line, from the guess; a line that's there is never
// changed. How the file was first made, and how a newer pack's pieces get theirs. Says how many lines it added.
export function fillFurniture() {
  const all = catalogue();
  const listed = new Map(furnitureFacts());
  let added = 0;
  for (const piece of all.pieces) {
    if (listed.has(piece.id) || piece.missing) continue;
    const facts = guessFurniture(piece);
    if (!facts) continue;
    listed.set(piece.id, { id: piece.id, name: piece.name, ...facts });
    added += 1;
  }
  if (added) save(listed, all);
  return added;
}

// For npm run check-story: lines of the file the game can't read.
export function furnitureProblems() {
  return readFile().problems;
}
addChecker(furnitureProblems);

syncFurniture();
