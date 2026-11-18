// What the Godot view (godot/) needs to draw a place's levels, worked out by the game's own code. Godot draws and takes
// clicks; the rules stay here, in JavaScript. So nothing about where a wall, a door or a chair stands is worked out
// twice: a level is described for its picture the way the page gets it (levelLook and draftLook in src/walk.js), turned
// into a scene by buildScene (public/iso.js), which is what the browser view draws from too, and handed over with which
// picture of the packs each piece is drawn from (pieceWay, machineAt, thingPicture and partPicture in
// public/pixel-art.js; furnitureForPage in src/pack-furniture.js).
//
// Two things use it: the game itself, for a game being played (godotPlace and godotLevelNow, asked by server.js), and
// tools/godot-decks.mjs, for the decks alone with no game behind them (godotLevel on draftLook).
//
// It only reads.

import fs from "node:fs";
import path from "node:path";
import { LOCATIONS } from "./data.js";
import { furnitureForPage } from "./pack-furniture.js";
import { licensedDir } from "./pieces.js";
import { placeLevels } from "./walk.js";
import { FURNITURE_BY_ID, footprintOf } from "../public/furniture.js";
import { CELL_WIDTH, CUT_WALL_HEIGHT, WALL_HEIGHT, buildScene } from "../public/iso.js";
import { SPEED } from "../public/move.js";
import { FLIGHT, PACK_FIGURE, PART_HANG, PIXEL_UNIT, machineAt, packBed, partPicture, pieceWay, replacedPlate, thingPicture, wallRun } from "../public/pixel-art.js";

// The three sheets of the first pack, as public/pixel-art.js names them.
const SHEET_FILES = { level: "isospace/IsoSpace_Level.png", assets: "isospace/IsoSpace_Assets.png", doors: "isospace/IsoSpace_Doors.png" };
// The game's own furniture whose picture in the packs is wood or orange, and is drawn in steel (STEEL_FILES there).
const STEEL_FILES = new Set(["Tables/Table_Corridor.png", "Bathroom/WC_Tap_Ani/Wc_Tap_1.png", "Bedroom/Bed_G_4.png", "Kitchen/Kitchen_A_Tile.png"]);
// How high the top of each of the game's own tables is in the pixel-art view (PIXEL_TABLE_TOP in public/iso.js), which
// buildScene only uses once the browser has the packs' pictures; and what it uses without them (TABLE_TOP).
const PIXEL_TABLE_TOP = { table: 0.48, "long-table": 0.48, desk: 0.45, "plot-table": 0.33 };
const TABLE_TOP = { table: 0.76, "long-table": 0.76, desk: 0.62, "plot-table": 0.7 };
const KIND_LETTERS = { floor: "f", wall: "w", hull: "h", void: "v", door: "d", exit: "e", thing: "t", block: "b", glow: "g", spark: "s", dim: "m", inside: "i", water: "~", blank: " " };
// Every picture a part of a place's systems can be drawn from, whatever state it's in, so Godot has them all from the
// start and a switch thrown later needs nothing new.
const PART_PIECES = ["part:camera", "part:switch-on", "part:switch-off", "part:switch-dead", "part:vent", "part:box", "part:keypad", "part:alarm", "part:relay", "part:core", "part:air", "part:engines"];
const CAMERA_TURNS = 16;

// Numbers as short as they can be said: the answer is a megabyte or two of them.
export const godotRound = (key, value) => (typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 10000) / 10000 : value);

// ---- Which picture a piece is drawn from ----------------------------------------------------------------------------

// The packs as they are in the folder now: asked afresh each time, since the folder is the owner's to fill.
function packsNow() {
  const licensed = licensedDir();
  const there = new Map();
  const onDisk = (rel) => {
    if (!there.has(rel)) there.set(rel, fs.existsSync(path.join(licensed, rel)));
    return there.get(rel);
  };
  // A picture as Godot is told of it: the file under licensed/, the part of it when it's one of several in a file,
  // and whether it's drawn in steel, or toned down as the Light look is on this Dark ship.
  const told = (picture, { steel = false, look = null } = {}) => {
    const src = picture.sheet ? SHEET_FILES[picture.sheet] : picture.file.startsWith("interiors/") || picture.file.startsWith("isospace/") ? picture.file : `interiors/${picture.file}`;
    return { src, ...(picture.x === undefined ? {} : { rect: [picture.x, picture.y, picture.w, picture.h] }), ...(steel ? { steel: true } : {}), ...(look ? { look } : {}) };
  };
  const has = (picture) => onDisk(picture.sheet ? SHEET_FILES[picture.sheet] : `interiors/${picture.file}`);
  // The game's own pieces, and what the plan's marks are drawn as: pieceWay's own answer, asked with the pictures that
  // are in the folder.
  const ownWay = (kind, facing = "s", seed = 0, look = "dark") => {
    const way = pieceWay(kind, facing, seed, { look, has });
    if (!way) return null;
    return {
      picture: told(way.picture, { steel: Boolean(way.picture.file) && STEEL_FILES.has(way.picture.file), look: way.look }),
      ...(way.flip ? { flip: true } : {}),
      ...(way.times > 1 ? { times: way.times } : {}),
      ...(way.on ? { on: told(way.on), lift: way.lift } : {}),
    };
  };
  // A piece of the packs put on a deck as itself: the side of it that faces the camera, or its one picture turned round.
  const pack = new Map(furnitureForPage().map((one) => [one.id, one]));
  const packWay = (kind, facing = "s") => {
    const one = pack.get(kind);
    if (!one) return null;
    const picture = one.faces ? one.faces[facing] ?? one.faces.s : one.picture;
    if (!picture || !onDisk(picture.file)) return null;
    return { picture: told(picture, { steel: Boolean(one.steel) }), ...(!one.faces && (facing === "e" || facing === "w") ? { flip: true } : {}) };
  };
  const wayOf = (kind, facing, seed, look) => (pack.has(kind) && FURNITURE_BY_ID[kind]?.pack ? packWay(kind, FURNITURE_BY_ID[kind].wall ? "s" : facing) : ownWay(kind, facing, seed, look));
  return { licensed, onDisk, ownWay, wayOf };
}

// ---- What Godot is told once, whatever the level --------------------------------------------------------------------

function staticsOf(packs) {
  const { licensed, onDisk, ownWay } = packs;
  // What the plan's own marks are drawn as, each asked of the game once.
  const ways = {
    lamp: ownWay("plan-lamp"),
    console: ownWay("plan-console"),
    terminal: ownWay("plan-terminal"),
    counter: ownWay("plan-counter"),
    stove: ownWay("plan-stove"),
    pump: ownWay("plan-pump"),
    tank: ownWay("plan-tank"),
    scrap: [ownWay("plan-scrap", "s", 0), ownWay("plan-scrap", "s", 0.99)],
    crate: { dark: ownWay("crate", "s", 0, "dark"), light: ownWay("crate", "s", 0, "light") },
    post: { s: ownWay("locker", "s"), e: ownWay("locker", "e") },
    runs: { "run:pipe": ownWay("run:pipe"), "run:cable": ownWay("run:cable"), "run:tray": ownWay("run:tray") },
    // The systems' parts in every state, and a camera at each of its turns.
    parts: Object.fromEntries(PART_PIECES.map((id) => [id, ownWay(id)])),
    turning: Array.from({ length: CAMERA_TURNS }, (_, n) => ownWay("part:turning", "s", (n + 0.5) / CAMERA_TURNS)),
  };
  // A few of the game's own answers for Godot to hold its copy of two small rules up against when it starts: which
  // floor tiles are replaced plates, and which stretches of wall have a pipe or cables along them.
  const checks = { plates: [], runs: [] };
  for (let y = 0; y < 12; y += 1) for (let x = 0; x < 12; x += 1) {
    checks.plates.push(replacedPlate(x * 3, y * 2) ? 1 : 0);
    checks.runs.push(wallRun(x * 7, y * 3, "s") ?? "", wallRun(x * 5, y * 4, "e") ?? "");
  }
  return {
    licensed,
    packs: { isospace: Object.values(SHEET_FILES).every(onDisk), interiors: fs.existsSync(path.join(licensed, "interiors")) },
    sheets: SHEET_FILES,
    numbers: { cellWidth: CELL_WIDTH, wallHeight: WALL_HEIGHT, cutWallHeight: CUT_WALL_HEIGHT, pixelUnit: PIXEL_UNIT, packFigure: PACK_FIGURE, speed: SPEED, flight: FLIGHT },
    ways,
    checks,
  };
}

export const godotStatics = () => staticsOf(packsNow());

// ---- One level ------------------------------------------------------------------------------------------------------

// A bed the packs have nothing to say about (one of the game's own with its picture not in the folder): a plain shape,
// on whose top whoever's in it lies, two side by side on a bunk.
function plainBed(block) {
  const run = block.y1 - block.y0 >= block.x1 - block.x0 ? "y" : "x";
  const [cx, cy] = [(block.x0 + block.x1) / 2, (block.y0 + block.y1) / 2];
  const head = Math.max(0.2, (run === "y" ? block.y1 - block.y0 : block.x1 - block.x0) / 2 - 0.2);
  const across = block.kind === "bunk" ? [-0.12, 0.12] : [0];
  return { run, places: across.map((off) => (run === "y" ? { wx: cx + off, wy: cy - head, z: block.top } : { wx: cx - head, wy: cy + off, z: block.top })), cx, cy, head, long: head * 2 + 0.06, under: false, blankets: true, pictured: false };
}

// A level as Godot draws it, from the game's description of it for its picture (levelLook for a game being played,
// draftLook for a deck with no game behind it). more: what a deck with no game needs besides (where the player can
// walk, where each way out leads), which a game being played says for itself as it goes.
function levelOf(packs, id, look, more = {}) {
  const { ownWay, wayOf } = packs;
  const scene = buildScene(look);
  const walkable = (x, y) => ["floor", "door"].includes(scene.kinds[y]?.[x]);
  const isMachine = (x, y) => scene.styles[y]?.[x] === "machine";
  const lightAt = (x, y) => Boolean(scene.light[y]?.[x]);
  const pieceLookAt = (block) => (lightAt(Math.round(block.x0 / CELL_WIDTH), Math.floor(block.y0 + 1e-6)) ? "light" : "dark");

  const blocks = scene.blocks.map((block) => {
    const out = { ...block };
    delete out.type;
    if (block.style === "piece") {
      const kind = FURNITURE_BY_ID[block.kind];
      // A small thing on one of the game's own tables sits at the height the packs' table is drawn at.
      if (kind?.pack && kind.what === "small" && block.lift) {
        const under = (look.furniture ?? []).concat((look.things ?? []).filter((thing) => thing.looks && !thing.part && !thing.onPiece).map((thing) => ({ kind: thing.looks, facing: thing.facing ?? "s", x: thing.x, y: thing.y })))
          .find((other) => PIXEL_TABLE_TOP[other.kind] && TABLE_TOP[other.kind] === block.lift && (() => {
            const { across, down } = footprintOf(other);
            const [px, py] = [Math.round(block.x0 / CELL_WIDTH), Math.round(block.y0)];
            return px >= other.x - (across > 1 ? other.x % 2 : 0) && px < other.x + across && py >= other.y && py < other.y + down;
          })());
        if (under) {
          out.top = block.top - block.lift + PIXEL_TABLE_TOP[under.kind];
          out.h = out.top;
          out.lift = PIXEL_TABLE_TOP[under.kind];
        }
      }
      const pieceLook = pieceLookAt(block);
      const way = block.kind === "crate" ? null : wayOf(block.kind, block.facing ?? "s", block.seed ?? 0, pieceLook);
      if (way) out.pic = way;
      out.what = kind?.pack ? kind.what : kind?.wall ? "wall" : kind?.seat ? "seat" : kind?.bed ? "bed" : "stand";
      if (kind?.wall) out.high = kind.pack ? kind.high ?? 0.95 : null;
      if (kind?.lit) out.lit = kind.lit;
      // Somewhere to sit, or to lie: how whoever's asleep in a bed lies in it is the game's own answer (packBed).
      if (kind?.seat) out.rest = "seat";
      else if (kind?.bed) {
        out.rest = "bed";
        out.bed = packBed(block, { on: true, way: (kindId, facing = "s") => wayOf(kindId, facing, block.seed ?? 0, pieceLook) }) ?? plainBed(block);
      }
    } else if (block.style === "stood") {
      const way = ownWay(block.piece, block.facing ?? "s");
      if (way) out.pic = way;
    } else if (block.style === "machine" && !block.big) {
      // A console of a bank: which of the bank's squares it's drawn on, as what, and which way it's turned.
      const found = machineAt(block.x, block.y, isMachine, block.bank);
      if (!found.block) {
        let below = false;
        for (let at = found.start; at <= found.end && !below; at += 1) below = walkable(at, block.y + 1);
        const flip = found.galley ? below : !below && walkable(found.end + 1, block.y);
        out.bank = { draw: found.draw, across: found.across ?? 1, ...(flip ? { flip: true } : {}) };
      }
    } else if (block.style === "post" && block.mark === "|" && !block.stair) {
      out.turned = !walkable(block.x, block.y + 1) && walkable(block.x + 1, block.y);
    }
    return out;
  });

  const things = (look.things ?? []).map((thing) => {
    const out = { id: thing.id, name: thing.name, x: thing.x, y: thing.y, ...(thing.looks ? { looks: thing.looks, facing: thing.facing ?? "s" } : {}), ...(thing.room ? { room: thing.room } : {}) };
    if (thing.onPiece) out.onPiece = true;
    if (thing.quiet) out.quiet = true;
    if (thing.stock) out.stock = thing.stock;
    if (thing.part) {
      // A part of the place's systems: how it stands, and the packs' fitting for it as it stands now, with how it's hung.
      const { kind, system, mount, face, works, word, locked, ringing, sparks } = thing.part;
      out.part = { kind, system, mount, face, works: Boolean(works), word, ...(locked ? { locked: true } : {}), ...(ringing ? { ringing: true } : {}), ...(sparks ? { sparks: true } : {}) };
      const piece = partPicture(thing.part);
      const way = piece ? ownWay(piece) : null;
      if (way) {
        out.pic = way;
        out.hang = PART_HANG[kind];
      }
    } else if (!thing.looks && !thing.onPiece && !thing.stock?.goods) {
      const piece = thingPicture(thing.name);
      out.nothing = piece === null;
      const way = piece ? ownWay(piece) : null;
      if (way) out.pic = way;
    }
    return out;
  });

  return {
    id,
    name: more.name ?? look.here?.deck?.name ?? look.here?.name ?? id,
    cols: look.cols,
    lines: look.lines,
    ...(more.start ? { start: more.start } : {}),
    ...(more.floor ? { floor: more.floor } : {}),
    exits: more.exits ?? (look.exits ?? []).map(({ key, x, y, label, glyph, closed, locked, inner, room }) => ({ key, x, y, label, glyph, ...(closed ? { closed: true } : {}), ...(locked ? { locked: true } : {}), ...(inner ? { inner: true } : {}), ...(room ? { room } : {}) })),
    // The rooms drawn on a deck, and how each is now: dark, without power, on fire, holed, scorched.
    areas: (look.areas ?? []).map(({ id: areaId, name, x, y, w, h, dark, power, fire, breach, scorched }) => ({ id: areaId, name, x, y, w, h, ...(dark ? { dark: true } : {}), ...(power === false ? { power: false } : {}), ...(fire ? { fire } : {}), ...(breach ? { breach: true } : {}), ...(scorched ? { scorched } : {}) })),
    labels: look.labels ?? [],
    things,
    // What else changes a level's picture, as the game's view of a level says it (the page keeps a picture until any
    // of these changes, and Godot does the same).
    here: look.here ?? { id },
    ...(look.growing ? { growing: look.growing } : {}),
    ...(look.wear ? { wear: look.wear } : {}),
    ...(look.marks ? { marks: look.marks } : {}),
    ...(look.power ? { power: look.power } : {}),
    mainFloor: scene.ground.find((cell) => cell.kind === "floor")?.mark ?? ".",
    scene: {
      kinds: scene.kinds.map((row) => row.map((kind) => KIND_LETTERS[kind] ?? "?").join("")),
      heights: scene.heights,
      machines: scene.styles.map((row) => row.map((style) => (style === "machine" ? "1" : "0")).join("")),
      light: scene.light.map((row) => row.map((on) => (on ? "1" : "0")).join("")),
      blocks,
      ground: scene.ground.map(({ x, y, kind, mark, seed, passage, light, hazard, ring, rib }) => ({ x, y, k: KIND_LETTERS[kind], ...(mark && mark !== " " ? { mark } : {}), seed, ...(passage ? { passage: true } : {}), ...(light ? { light: true } : {}), ...(hazard ? { hazard } : {}), ...(ring ? { ring } : {}), ...(rib ? { rib: true } : {}) })),
      glows: scene.glows,
      sparks: scene.sparks,
      runs: scene.runs,
      lights: scene.lights,
      fixtures: scene.fixtures,
      doorways: scene.doorways,
      worn: scene.worn.map((one) => one.points),
      big: Object.fromEntries(scene.big),
      fitted: [...scene.fitted],
      bounds: scene.bounds,
      // What the ship's state shows of the level: rooms gone dark, what's burning, holes in the hull, soot and stains,
      // and how worn and cluttered she looks.
      dark: Boolean(scene.dark),
      darkAreas: (scene.darkAreas ?? []).map(({ x, y, w, h }) => ({ x, y, w, h })),
      fires: scene.fires ?? [],
      breaches: scene.breaches ?? [],
      marks: scene.marks ?? [],
      wear: scene.wear ?? null,
      look: { floor: scene.look.floor, ambient: scene.look.ambient, lights: scene.look.lights, glow: scene.look.glow, fire: scene.look.fire, pixelLight: scene.look.pixelLight ?? 1 },
      style: scene.style,
      colors: scene.colors,
    },
  };
}

// A deck with no game behind it (tools/godot-decks.mjs): look is draftLook's.
export const godotLevel = (id, look, more = {}) => levelOf(packsNow(), id, look, more);

// ---- A game being played --------------------------------------------------------------------------------------------

// Every level of the place the player's at, as Godot draws it now, with what it's told once. Null where there's no
// map to walk on.
export function godotPlace(game) {
  const place = placeLevels(game);
  if (!place) return null;
  const packs = packsNow();
  return {
    ok: true,
    place: place.place,
    name: place.name ?? LOCATIONS[game.location]?.name ?? game.location,
    ...staticsOf(packs),
    decks: Object.entries(place.levels).map(([id, look]) => levelOf(packs, id, look)),
  };
}

// One of those levels as it is now, asked again when something on it has changed: a room gone dark, a fire, a door
// locked.
export function godotLevelNow(game, id) {
  const look = placeLevels(game)?.levels[id];
  if (!look) throw new Error("That level isn't part of this place.");
  return levelOf(packsNow(), id, look);
}
