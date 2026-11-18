// What the Godot view (godot/) needs to draw the Meridian's decks, worked out by the game's own code and handed over as
// one piece of JSON. Godot runs this once when it starts (godot/scripts/deck_data.gd):
//
//   node tools/godot-decks.mjs --out=<a file to write>     (or with no --out, to the screen)
//
// It's step 1 of the port to Godot: Godot draws and the game's rules stay here, in
// JavaScript. So nothing about where a wall, a door or a chair stands is worked out twice. The decks are read by the
// game's reader (src/tiled.js, through src/world.js), made into levels by compileLevel (src/walk.js), described for
// their picture by draftLook, and turned into a scene by buildScene (public/iso.js), which is what the browser view
// draws from too. Which picture of the packs each piece is drawn from is the game's own answer as well (pieceWay,
// machineAt and thingPicture in public/pixel-art.js; furnitureForPage in src/pack-furniture.js).
//
// It has no game behind it: it reads no save, opens no port and writes nothing but the one file it's asked for. As a
// guard, GAME_DATA_DIR is a temporary folder that's thrown away, and every way of writing a file is shut off for
// anywhere else before the game's code is loaded.

import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";

const outArg = process.argv.find((word) => word.startsWith("--out="));
const outFile = outArg ? path.resolve(outArg.slice("--out=".length)) : null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "almagest-godot-"));
process.env.GAME_DATA_DIR = tmp;

// ---- Nothing is written anywhere else -------------------------------------------------------------------------------

const realWrite = fs.writeFileSync.bind(fs);
const realRemove = fs.rmSync.bind(fs);
const inside = (dir, target) => {
  const rel = path.relative(dir, path.resolve(String(target)));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};
// Each way of writing, with which of its words says where it writes: copying and renaming say it second.
const WRITERS = { writeFileSync: 0, appendFileSync: 0, mkdirSync: 0, rmSync: 0, rmdirSync: 0, unlinkSync: 0, truncateSync: 0, renameSync: 1, copyFileSync: 1, cpSync: 1, writeFile: 0, appendFile: 0, mkdir: 0, rm: 0, rmdir: 0, unlink: 0, truncate: 0, rename: 1, copyFile: 1, cp: 1, createWriteStream: 0 };
const guarded = (name, real, where) => (...words) => {
  if (!inside(tmp, words[where])) throw new Error(`tools/godot-decks.mjs only reads: ${name} was asked for ${words[where]}.`);
  return real(...words);
};
for (const [name, where] of Object.entries(WRITERS)) {
  if (typeof fs[name] === "function") fs[name] = guarded(name, fs[name].bind(fs), where);
  if (typeof fs.promises[name] === "function") fs.promises[name] = guarded(name, fs.promises[name].bind(fs.promises), where);
}
syncBuiltinESMExports();
// Whatever the game's code has to say while it loads goes beside the answer, not into it.
console.log = (...words) => console.error(...words);

// ---- The answer -----------------------------------------------------------------------------------------------------

const PLACE = "meridian";
// The three sheets of the first pack, as public/pixel-art.js names them.
const SHEET_FILES = { level: "isospace/IsoSpace_Level.png", assets: "isospace/IsoSpace_Assets.png", doors: "isospace/IsoSpace_Doors.png" };
// The game's own furniture whose picture in the packs is wood or orange, and is drawn in steel (STEEL_FILES there).
const STEEL_FILES = new Set(["Tables/Table_Corridor.png", "Bathroom/WC_Tap_Ani/Wc_Tap_1.png", "Bedroom/Bed_G_4.png", "Kitchen/Kitchen_A_Tile.png"]);
// How high the top of each of the game's own tables is in the pixel-art view (PIXEL_TABLE_TOP in public/iso.js), which
// buildScene only uses once the browser has the packs' pictures; and what it uses without them (TABLE_TOP).
const PIXEL_TABLE_TOP = { table: 0.48, "long-table": 0.48, desk: 0.45, "plot-table": 0.33 };
const TABLE_TOP = { table: 0.76, "long-table": 0.76, desk: 0.62, "plot-table": 0.7 };
const KIND_LETTERS = { floor: "f", wall: "w", hull: "h", void: "v", door: "d", exit: "e", thing: "t", block: "b", glow: "g", spark: "s", dim: "m", inside: "i", water: "~", blank: " " };

async function answer() {
  const { WORLD_MAPS } = await import("../src/world.js");
  const { LOCATIONS } = await import("../src/data.js");
  const { compileLevel, draftLook, canStand } = await import("../src/walk.js");
  const { licensedDir } = await import("../src/pieces.js");
  const { furnitureForPage } = await import("../src/pack-furniture.js");
  const { FURNITURE_BY_ID, footprintOf } = await import("../public/furniture.js");
  const { CELL_WIDTH, WALL_HEIGHT, CUT_WALL_HEIGHT, buildScene } = await import("../public/iso.js");
  const { FLIGHT, PACK_FIGURE, PIXEL_UNIT, machineAt, pieceWay, replacedPlate, thingPicture, wallRun } = await import("../public/pixel-art.js");
  const { SPEED } = await import("../public/move.js");

  const file = WORLD_MAPS[PLACE];
  if (!file?.levels) throw new Error("The game has no decks for the Meridian.");
  const licensed = licensedDir();
  const there = new Map();
  const onDisk = (rel) => {
    if (!there.has(rel)) there.set(rel, fs.existsSync(path.join(licensed, rel)));
    return there.get(rel);
  };

  // ---- Which picture a piece is drawn from ----
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

  const round = (key, value) => (typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 10000) / 10000 : value);
  const decks = [];
  const kindsUsed = new Set();
  for (const [id, raw] of Object.entries(file.levels)) {
    const level = compileLevel(id, raw, LOCATIONS[PLACE]?.gm?.districts);
    const look = draftLook(PLACE, level);
    // Each way out says which room it's in, as the game's own view of a deck does: the stairs are found by it.
    const glyphOf = (exit) => (exit.x === 0 ? "<" : exit.x === level.width - 1 ? ">" : exit.y === 0 ? "^" : "v");
    look.exits = level.exits.map((exit) => ({ key: exit.key, x: exit.x, y: exit.y, label: exit.label ?? file.levels[exit.to]?.name ?? exit.to, glyph: glyphOf(exit), room: level.roomAt(exit.x, exit.y) }));
    const scene = buildScene(look);
    const walkable = (x, y) => ["floor", "door"].includes(scene.kinds[y]?.[x]);
    const isMachine = (x, y) => scene.styles[y]?.[x] === "machine";
    const lightAt = (x, y) => Boolean(scene.light[y]?.[x]);

    const blocks = scene.blocks.map((block) => {
      const out = { ...block };
      delete out.type;
      if (block.style === "piece") {
        kindsUsed.add(block.kind);
        const kind = FURNITURE_BY_ID[block.kind];
        // A small thing on one of the game's own tables sits at the height the packs' table is drawn at.
        if (kind?.pack && kind.what === "small" && block.lift) {
          const under = (look.furniture ?? []).concat((look.things ?? []).filter((thing) => thing.looks).map((thing) => ({ kind: thing.looks, facing: thing.facing ?? "s", x: thing.x, y: thing.y })))
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
        const pieceLook = lightAt(Math.round(block.x0 / CELL_WIDTH), Math.floor(block.y0 + 1e-6)) ? "light" : "dark";
        const way = block.kind === "crate" ? null : wayOf(block.kind, block.facing ?? "s", block.seed ?? 0, pieceLook);
        if (way) out.pic = way;
        out.what = kind?.pack ? kind.what : kind?.wall ? "wall" : kind?.seat ? "seat" : kind?.bed ? "bed" : "stand";
        if (kind?.wall) out.high = kind.pack ? kind.high ?? 0.95 : null;
        if (kind?.lit) out.lit = kind.lit;
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
      const out = { id: thing.id, name: thing.name, x: thing.x, y: thing.y, ...(thing.looks ? { looks: thing.looks } : {}) };
      if (!thing.looks) {
        const piece = thingPicture(thing.name);
        out.nothing = piece === null;
        const way = piece ? ownWay(piece) : null;
        if (way) out.pic = way;
      }
      return out;
    });

    decks.push({
      id,
      name: level.name,
      cols: level.width,
      lines: level.height,
      start: level.start,
      // Where the player can walk: "." for a square that can be stood on, as the game's own view has it.
      floor: Array.from({ length: level.height }, (_, y) => Array.from({ length: level.width }, (_, x) => (canStand(level, x, y) ? "." : " ")).join("")),
      exits: level.exits.map((exit) => ({ key: exit.key, x: exit.x, y: exit.y, label: exit.label ?? file.levels[exit.to]?.name ?? exit.to, glyph: glyphOf(exit), to: exit.to, via: exit.via ?? null })),
      areas: level.areas.map((area) => ({ id: area.id, name: area.name, x: area.x, y: area.y, w: area.w, h: area.h })),
      labels: look.labels ?? [],
      things,
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
        look: { floor: scene.look.floor, ambient: scene.look.ambient, lights: scene.look.lights, glow: scene.look.glow, fire: scene.look.fire, pixelLight: scene.look.pixelLight ?? 1 },
        style: scene.style,
        colors: scene.colors,
      },
    });
  }

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
  };

  // A few of the game's own answers for Godot to hold its copy of two small rules up against when it starts: which
  // floor tiles are replaced plates, and which stretches of wall have a pipe or cables along them.
  const checks = { plates: [], runs: [] };
  for (let y = 0; y < 12; y += 1) for (let x = 0; x < 12; x += 1) {
    checks.plates.push(replacedPlate(x * 3, y * 2) ? 1 : 0);
    checks.runs.push(wallRun(x * 7, y * 3, "s") ?? "", wallRun(x * 5, y * 4, "e") ?? "");
  }

  return {
    ok: true,
    place: PLACE,
    name: LOCATIONS[PLACE]?.name ?? "The Meridian",
    licensed,
    packs: { isospace: Object.values(SHEET_FILES).every(onDisk), interiors: fs.existsSync(path.join(licensed, "interiors")) },
    sheets: SHEET_FILES,
    numbers: { cellWidth: CELL_WIDTH, wallHeight: WALL_HEIGHT, cutWallHeight: CUT_WALL_HEIGHT, pixelUnit: PIXEL_UNIT, packFigure: PACK_FIGURE, speed: SPEED, flight: FLIGHT },
    // Each kind of furniture on the decks: how many squares it takes and what it is, for the plain shape Godot draws
    // where a picture isn't in the folder.
    furniture: Object.fromEntries([...kindsUsed].sort().map((kind) => {
      const one = FURNITURE_BY_ID[kind] ?? {};
      return [kind, { name: one.name ?? kind, what: one.pack ? one.what : one.wall ? "wall" : one.seat ? "seat" : one.bed ? "bed" : "stand", high: one.high ?? null, ...(one.lit ? { lit: one.lit } : {}), ...(one.pack ? { pack: true } : {}) }];
    })),
    ways,
    checks,
    decks,
    round,
  };
}

let code = 0;
let text;
try {
  const { round, ...out } = await answer();
  text = JSON.stringify(out, round);
} catch (error) {
  code = 1;
  text = JSON.stringify({ ok: false, error: String(error?.message ?? error) });
}
try {
  realRemove(tmp, { recursive: true, force: true });
} catch {
  // A temporary folder left behind is the computer's to clear.
}
if (outFile) realWrite(outFile, text);
else process.stdout.write(`${text}\n`);
process.exitCode = code;
