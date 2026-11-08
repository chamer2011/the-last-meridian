// Moves a place's rooms out of its map file and into Tiled maps, so they can be drawn in Tiled:
//
//   node tools/to-tiled.mjs meridian
//
// Each room of world/maps/<place>.json becomes world/maps/<place>/<room>.tmj, exactly as it was, and leaves the place's
// file, which keeps the rest (its name, where it starts, and its overview). The tiles they need are added to the
// stand-in tileset, world/maps/tiles/stand-ins.tsj, with a picture for each, and the place's folder to the Tiled project,
// world/maps/almagest-explorers.tiled-project. A room that's already drawn in Tiled is never written over. Each room is
// read back before anything changes, and if any of them wouldn't come back exactly as it was, nothing is written.
// See src/tiled.js for how a room is drawn, and world/maps/_how-to-draw-rooms-in-tiled.txt for the owner's side.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { FIGURES, PIECE, figureImage, pieceImage, pieceWords } from "./stand-in-art.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "to-tiled-"));
const mapsDir = process.env.GAME_MAPS_DIR ?? path.join(root, "world", "maps");
const { pieceKey, readMapFile, roomFromMap, roomToMap } = await import("../src/tiled.js");
const { compileLevel } = await import("../src/walk.js");

const place = process.argv[2];
function stop(message) {
  console.error(message);
  process.exit(1);
}
if (!place) stop("Which place? node tools/to-tiled.mjs <place>, such as meridian");
const placeFile = path.join(mapsDir, `${place}.json`);
if (!fs.existsSync(placeFile)) stop(`There's no map of a place called ${place} in ${mapsDir}.`);
const file = JSON.parse(fs.readFileSync(placeFile, "utf8"));
const roomsDir = path.join(mapsDir, place);
const tilesDir = path.join(mapsDir, "tiles");
const tilesetFile = path.join(tilesDir, "stand-ins.tsj");
const imagesDir = path.join(tilesDir, "stand-ins");
const projectFile = path.join(mapsDir, "almagest-explorers.tiled-project");

const already = (id) => ["tmj", "tmx", "json"].some((ext) => fs.existsSync(path.join(roomsDir, `${id}.${ext}`)));
const moving = Object.entries(file.levels ?? {}).filter(([id]) => {
  if (!already(id)) return true;
  console.log(`${place}/${id} is already drawn in Tiled, so it's left as it is, and so is the place file's ${id}.`);
  return false;
});
if (!moving.length) stop("There's nothing to move.");

// ---- The tileset: what's there already keeps its number, since the maps know tiles by it ------------------------

const KINDS = [["person", "Person"], ["thing", "Thing"], ["exit", "Way out"], ["start", "Start"]];
const tileset = fs.existsSync(tilesetFile)
  ? JSON.parse(fs.readFileSync(tilesetFile, "utf8"))
  : {
      type: "tileset",
      version: "1.10",
      tiledversion: "1.11.2",
      name: "Stand-ins",
      tilewidth: PIECE.width,
      tileheight: PIECE.height,
      tilecount: 0,
      columns: 0,
      margin: 0,
      spacing: 0,
      objectalignment: "bottom",
      grid: { orientation: "isometric", width: 128, height: 64 },
      properties: [{ name: "what", type: "string", value: "Stand-in tiles for laying out rooms. The game draws its own. See world/maps/_how-to-draw-rooms-in-tiled.txt." }],
      tiles: KINDS.map(([kind, type], id) => ({ id, type, image: `stand-ins/${kind}.png`, imagewidth: FIGURES[kind].width, imageheight: FIGURES[kind].height })),
    };
const prop = (tile, name) => tile.properties?.find((one) => one.name === name)?.value ?? "";
const known = new Map(tileset.tiles.filter((tile) => prop(tile, "mark")).map((tile) => [pieceKey({ mark: prop(tile, "mark"), floor: prop(tile, "floor") }), tile.id]));
const figures = Object.fromEntries(KINDS.map(([kind, type]) => {
  const tile = tileset.tiles.find((one) => one.type === type);
  if (!tile) stop(`The stand-in tileset has no ${type} tile.`);
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

// A floor's colour in the pictures is the colour of the first room it's the floor of, a little lighter.
const floorColors = {};
for (const [, level] of Object.entries(file.levels ?? {})) {
  const color = level.colors?.floor;
  if (!color) continue;
  const n = parseInt(color.slice(1), 16);
  const light = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((value) => value * 0.55 + 150 * 0.45);
  for (const ch of level.floor ?? ".") floorColors[ch] ??= light;
}

// ---- The rooms, each read back to be sure it's the same ---------------------------------------------------------

const written = moving.map(([id, level]) => ({ id, level, map: roomToMap(level, { gidOf, figures }) }));
for (const piece of fresh) {
  tileset.tiles.push({
    id: piece.id,
    image: `stand-ins/piece-${String(piece.id).padStart(3, "0")}.png`,
    imagewidth: PIECE.width,
    imageheight: PIECE.height,
    properties: [
      { name: "floor", type: "string", value: piece.piece.floor },
      { name: "mark", type: "string", value: piece.piece.mark },
      { name: "what", type: "string", value: pieceWords(piece.piece) },
    ],
  });
}
tileset.tilecount = tileset.tiles.length;

const check = fs.mkdtempSync(path.join(os.tmpdir(), "to-tiled-check-"));
fs.mkdirSync(path.join(check, "tiles"));
fs.mkdirSync(path.join(check, place));
fs.writeFileSync(path.join(check, "tiles", "stand-ins.tsj"), JSON.stringify(tileset));
const plain = (value) => JSON.parse(JSON.stringify(value, (key, v) => (v instanceof Set ? [...v].sort() : v)));
const ids = new Set(Object.keys(file.levels ?? {}));
for (const { id, level, map } of written) {
  const where = path.join(check, place, `${id}.tmj`);
  fs.writeFileSync(where, JSON.stringify(map));
  const { level: back, problems } = roomFromMap(readMapFile(where), { rooms: ids });
  if (problems.length) stop(`${place}/${id} wouldn't come back as it is, so nothing's been changed: ${problems.join("; ")}`);
  const same = isDeepStrictEqual(plain(compileLevel(id, level)), plain(compileLevel(id, back))) && (level.district ?? null) === (back.district ?? null);
  if (!same) stop(`${place}/${id} wouldn't come back exactly as it is, so nothing's been changed.`);
}
fs.rmSync(check, { recursive: true, force: true });

// ---- Writing it all ---------------------------------------------------------------------------------------------

fs.mkdirSync(roomsDir, { recursive: true });
fs.mkdirSync(imagesDir, { recursive: true });
for (const { id, map } of written) fs.writeFileSync(path.join(roomsDir, `${id}.tmj`), `${JSON.stringify(map, null, 1)}\n`);
for (const [kind] of KINDS) {
  const image = path.join(imagesDir, `${kind}.png`);
  if (!fs.existsSync(image)) fs.writeFileSync(image, figureImage(kind));
}
for (const piece of fresh) fs.writeFileSync(path.join(imagesDir, `piece-${String(piece.id).padStart(3, "0")}.png`), pieceImage(piece.piece, floorColors));
fs.writeFileSync(tilesetFile, `${JSON.stringify(tileset, null, 1)}\n`);

// The project lists the folders of rooms, and what each kind of object has, so Tiled shows the right boxes to fill in.
const member = (name, type = "string", value = "") => ({ name, type, value });
const kind = (id, name, color, useAs, members) => ({ id, name, type: "class", color, drawFill: true, useAs, members });
const project = fs.existsSync(projectFile)
  ? JSON.parse(fs.readFileSync(projectFile, "utf8"))
  : {
      automappingRulesFile: "",
      commands: [],
      extensionsPath: "extensions",
      folders: ["tiles"],
      propertyTypes: [
        kind(1, "Room", "#ffa0a0a4", ["map"], [member("name"), member("aliases"), member("district"), member("desc"), member("floor"), member("floor color", "color"), member("walls color", "color"), member("scenery color", "color"), member("writing color", "color")]),
        kind(2, "Person", "#ff5fd08a", ["object", "tile"], [member("person"), member("asks"), member("asksOther"), member("greeting"), member("side"), member("mark")]),
        kind(3, "Thing", "#ffffcc4d", ["object", "tile"], [member("look"), member("use"), member("used"), member("lookOther"), member("useOther"), member("usedOther"), member("item"), member("mark")]),
        kind(4, "Way out", "#ff4fd0d0", ["object", "tile"], [member("to"), member("via"), member("mark")]),
        kind(5, "Start", "#ffe6e6eb", ["object", "tile"], []),
        kind(6, "Label", "#ffd8d4c0", ["object"], []),
        kind(7, "Writing", "#ffd8d4c0", ["object"], []),
      ],
    };
if (!project.folders.includes(place)) project.folders = [place, ...project.folders];
fs.writeFileSync(projectFile, `${JSON.stringify(project, null, 4)}\n`);

// The place's file keeps what Tiled doesn't draw, and says where its rooms went.
for (const [id] of moving) delete file.levels[id];
const note = `The rooms of this place are drawn in Tiled, the free map editor, in world/maps/${place}/, one file to a room, and the game reads them from there. world/maps/_how-to-draw-rooms-in-tiled.txt says how. A room that's still here is drawn in characters, as below.`;
const help = Array.isArray(file._help) ? file._help : [];
if (!help.includes(note)) help.unshift(note);
fs.writeFileSync(placeFile, `${JSON.stringify({ _help: help, ...file }, null, 2)}\n`);

console.log(`${place}: ${written.length} room${written.length === 1 ? "" : "s"} moved to ${path.relative(root, roomsDir)}, with ${fresh.length} new tile${fresh.length === 1 ? "" : "s"} in the stand-in tileset (${tileset.tiles.length} in all).`);
