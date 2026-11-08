// Rooms drawn in Tiled: every room in the game comes back from a Tiled map just as it was, the ship's rooms are read
// from theirs, .tmx files and endless and flat maps are read where they're drawn, what's wrong in one is said plainly,
// the tool that moves a place's rooms into Tiled keeps them the same, and a room saved while the game runs shows up.
// The maps are a copy, so the tests can change a room the way the owner would in Tiled.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { test } from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-tiled-"));
process.env.GAME_DATA_DIR = dataDir;
const mapsDir = path.join(dataDir, "maps");
fs.cpSync(path.join(root, "world", "maps"), mapsDir, { recursive: true });
process.env.GAME_MAPS_DIR = mapsDir;

const { MAP_FILE_PROBLEMS, WORLD_MAPS } = await import("../src/world.js");
const tiled = await import("../src/tiled.js");
const { compileLevel, mapFor, redrawnRooms, walkOf, walkView } = await import("../src/walk.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");

// What the game makes of a room, as plain data, leaving out how many times the rooms have been read.
const plain = (id, level) => {
  const { drawn, ...rest } = compileLevel(id, level);
  return JSON.parse(JSON.stringify(rest, (key, value) => (value instanceof Set ? [...value].sort() : value)));
};
const later = (() => {
  let at = Date.now();
  return () => {
    at += 60_000;
    return at;
  };
})();

// A tileset made on the spot, with a tile for every piece the rooms need.
function scratchTiles() {
  const pieces = new Map();
  const figures = { person: { gid: 1, width: 48, height: 96 }, thing: { gid: 2, width: 40, height: 56 }, exit: { gid: 3, width: 40, height: 64 }, start: { gid: 4, width: 40, height: 64 } };
  const gidOf = (piece) => {
    const key = tiled.pieceKey(piece);
    if (!pieces.has(key)) pieces.set(key, { id: 4 + pieces.size, piece });
    return pieces.get(key).id + 1;
  };
  const write = (file) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tiles = [
      ...["Person", "Thing", "Way out", "Start"].map((type, id) => ({ id, type, image: `${id}.png`, imagewidth: 40, imageheight: 64 })),
      ...[...pieces.values()].map(({ id, piece }) => ({ id, image: `p${id}.png`, imagewidth: 128, imageheight: 160, properties: [{ name: "mark", type: "string", value: piece.mark }, { name: "floor", type: "string", value: piece.floor }] })),
    ];
    const set = { type: "tileset", name: "Scratch", tilewidth: 128, tileheight: 160, tilecount: tiles.length, columns: 0, objectalignment: "bottom", tiles };
    fs.writeFileSync(file, JSON.stringify(set));
    return set;
  };
  return { gidOf, figures, write };
}

test("every room in the game comes back from a Tiled map just as it was", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-tiled-all-"));
  const tiles = scratchTiles();
  const written = [];
  for (const [place, map] of Object.entries(WORLD_MAPS)) {
    for (const [id, level] of Object.entries(map.levels)) {
      const file = path.join(dir, place, `${id}.tmj`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(tiled.roomToMap(level, tiles)));
      written.push({ place, id, level, file });
    }
  }
  tiles.write(path.join(dir, "tiles", "stand-ins.tsj"));
  assert.ok(written.length > 100, "every place's rooms");
  for (const { place, id, level, file } of written) {
    const { level: back, problems } = tiled.roomFromMap(tiled.readMapFile(file), { rooms: new Set(Object.keys(WORLD_MAPS[place].levels)) });
    assert.deepEqual(problems, [], `${place}/${id}`);
    assert.deepEqual(plain(id, back), plain(id, level), `${place}/${id}`);
    assert.equal(back.district, level.district, `${place}/${id}`);
  }
});

test("the ship's rooms are read from their Tiled maps, with nothing wrong in them", () => {
  const files = fs.readdirSync(path.join(mapsDir, "meridian")).filter((name) => name.endsWith(".tmj"));
  assert.ok(files.length >= 3, "a map to each deck");
  for (const name of files) {
    const level = WORLD_MAPS.meridian.levels[name.slice(0, -4)];
    assert.ok(level?.drawn > 0, `${name} is read`);
    assert.ok(level.name, `${name} has a name`);
  }
  assert.deepEqual(MAP_FILE_PROBLEMS, []);
  const map = mapFor("meridian");
  assert.ok(map.rooms[WORLD_MAPS.meridian.start], "the ship starts in a room drawn on one of them");
  const project = JSON.parse(fs.readFileSync(path.join(mapsDir, "almagest-explorers.tiled-project"), "utf8"));
  assert.ok(project.folders.includes("meridian"), "Tiled's project shows the ship's rooms");
});

test("every stand-in tile says what it puts in a room, and has its picture", () => {
  const set = JSON.parse(fs.readFileSync(path.join(mapsDir, "tiles", "stand-ins.tsj"), "utf8"));
  assert.deepEqual(set.tiles.slice(0, 4).map((tile) => tile.type), ["Person", "Thing", "Way out", "Start"]);
  assert.equal(set.objectalignment, "bottom", "people stand on their feet");
  assert.equal(new Set(set.tiles.map((tile) => tile.id)).size, set.tiles.length);
  assert.equal(set.tilecount, set.tiles.length);
  for (const tile of set.tiles) {
    const image = fs.readFileSync(path.join(mapsDir, "tiles", tile.image));
    assert.equal(image.subarray(1, 4).toString(), "PNG", tile.image);
    assert.equal(image.readUInt32BE(16), tile.imagewidth, tile.image);
    assert.equal(image.readUInt32BE(20), tile.imageheight, tile.image);
    if (tile.type) continue;
    const props = Object.fromEntries(tile.properties.map((one) => [one.name, one.value]));
    assert.ok([1, 2].includes([...props.mark].length), `tile ${tile.id}'s mark`);
    assert.ok([...props.floor].every((ch) => props.mark.includes(ch)), `tile ${tile.id}'s floor is in its mark`);
    assert.ok(props.what, `tile ${tile.id} says what it is`);
  }
});

// ---- Tiled's other kinds of file ------------------------------------------------------------------------------

const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xmlProps = (list) => (list?.length
  ? `<properties>${list.map((one) => (String(one.value).includes("\n") ? `<property name="${esc(one.name)}" type="${one.type}">${esc(one.value)}</property>` : `<property name="${esc(one.name)}" type="${one.type}" value="${esc(one.value)}"/>`)).join("")}</properties>`
  : "");

// A map as Tiled's XML would have it: one tile layer as CSV, the other packed with zlib, as Tiled can save them.
function toTmx(map, source) {
  const layers = map.layers.map((layer, i) => {
    if (layer.type === "tilelayer") {
      const data = i === 0
        ? `<data encoding="csv">\n${layer.data.join(",")}\n</data>`
        : `<data encoding="base64" compression="zlib">\n   ${zlib.deflateSync(Buffer.from(new Uint32Array(layer.data).buffer)).toString("base64")}\n  </data>`;
      return `<layer id="${layer.id}" name="${esc(layer.name)}" width="${layer.width}" height="${layer.height}">\n  ${data}\n </layer>`;
    }
    const objects = layer.objects.map((one) => `  <object id="${one.id}" name="${esc(one.name)}"${one.type ? ` type="${esc(one.type)}"` : ""}${one.gid ? ` gid="${one.gid}"` : ""} x="${one.x}" y="${one.y}" width="${one.width}" height="${one.height}">${xmlProps(one.properties)}${one.text ? `<text wrap="0" pixelsize="14">${esc(one.text.text)}</text>` : ""}</object>`);
    return `<objectgroup id="${layer.id}" name="${esc(layer.name)}">\n${objects.join("\n")}\n </objectgroup>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Made for a test -->\n<map version="1.10" tiledversion="1.11.2" orientation="isometric" renderorder="right-down" width="${map.width}" height="${map.height}" tilewidth="${map.tilewidth}" tileheight="${map.tileheight}" infinite="0" nextlayerid="5" nextobjectid="${map.nextobjectid}">\n ${xmlProps(map.properties)}\n <tileset firstgid="1" source="${source}"/>\n ${layers.join("\n ")}\n</map>\n`;
}

const toTsx = (set) => `<?xml version="1.0" encoding="UTF-8"?>\n<tileset version="1.10" tiledversion="1.11.2" name="${esc(set.name)}" tilewidth="${set.tilewidth}" tileheight="${set.tileheight}" tilecount="${set.tilecount}" columns="0" objectalignment="bottom">\n${set.tiles.map((tile) => ` <tile id="${tile.id}"${tile.type ? ` type="${esc(tile.type)}"` : ""}>${xmlProps(tile.properties)}<image source="${esc(tile.image)}" width="${tile.imagewidth}" height="${tile.imageheight}"/></tile>`).join("\n")}\n</tileset>\n`;

test("a room saved as a .tmx file, Tiled's own kind, reads the same as its .tmj", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-tiled-tmx-"));
  const set = JSON.parse(fs.readFileSync(path.join(mapsDir, "tiles", "stand-ins.tsj"), "utf8"));
  fs.mkdirSync(path.join(dir, "tiles"));
  fs.writeFileSync(path.join(dir, "tiles", "stand-ins.tsx"), toTsx(set));
  for (const id of ["deck1", "deck2", "deck3"]) {
    const json = path.join(mapsDir, "meridian", `${id}.tmj`);
    const xml = path.join(dir, `${id}.tmx`);
    fs.writeFileSync(xml, toTmx(JSON.parse(fs.readFileSync(json, "utf8")), "tiles/stand-ins.tsx"));
    const fromXml = tiled.roomFromMap(tiled.readMapFile(xml));
    assert.deepEqual(fromXml.problems, [], id);
    assert.deepEqual(fromXml.level, tiled.roomFromMap(tiled.readMapFile(json)).level, id);
  }
  // The bridge's people have more than one thing to ask, a line each, which XML keeps inside the property.
  const voss = Object.values(tiled.roomFromMap(tiled.readMapFile(path.join(dir, "deck1.tmx"))).level.people).find((one) => one.id === "voss");
  assert.equal(voss.asks.length, 2);
});

// A small map, written as Tiled would, with its own tiles: a wall, a floor, and the kinds of object.
function smallMap(dir, name, { width = 3, height = 2, orientation = "isometric", tilewidth = 128, tileheight = 64, data, chunks, objects = [], properties = [], extraTiles = [], alignment } = {}) {
  const tiles = [
    { id: 0, properties: [{ name: "mark", type: "string", value: "#" }, { name: "floor", type: "string", value: "" }] },
    { id: 1, properties: [{ name: "mark", type: "string", value: "." }, { name: "floor", type: "string", value: "." }] },
    { id: 2, type: "Person" },
    { id: 3, type: "Thing" },
    { id: 4, type: "Way out" },
    ...extraTiles,
  ];
  const layer = chunks
    ? { type: "tilelayer", id: 1, name: "Floor", chunks, startx: 0, starty: 0, width: 0, height: 0, visible: true }
    : { type: "tilelayer", id: 1, name: "Floor", width, height, data: data ?? Array(width * height).fill(2), visible: true };
  const map = {
    type: "map", orientation, width, height, tilewidth, tileheight, infinite: Boolean(chunks), properties,
    tilesets: [{ firstgid: 1, name: "Small", tilecount: tiles.length, columns: 0, ...(alignment ? { objectalignment: alignment } : {}), tiles }],
    layers: [layer, { type: "objectgroup", id: 2, name: "Things", objects, visible: true }],
  };
  const file = path.join(dir, `${name}.tmj`);
  fs.writeFileSync(file, JSON.stringify(map));
  return file;
}

test("an endless map, a flat map and plain shapes are read where they're drawn", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-tiled-shapes-"));
  // Endless: the room is wherever something's drawn, here three tiles across from x -2, and two down from y -1.
  const chunk = Array(64).fill(0);
  for (const [x, y, gid] of [[-2, -1, 1], [-1, -1, 2], [0, -1, 1], [-2, 0, 1], [-1, 0, 2], [0, 0, 1]]) chunk[(y + 4) * 8 + (x + 4)] = gid;
  const endless = smallMap(dir, "endless", { chunks: [{ x: -4, y: -4, width: 8, height: 8, data: chunk }], objects: [{ id: 1, name: "Voss", gid: 3, x: -0.75 * 64, y: -0.5 * 64, width: 48, height: 96, properties: [{ name: "person", type: "string", value: "voss" }] }] });
  const one = tiled.roomFromMap(tiled.readMapFile(endless));
  assert.deepEqual(one.problems, []);
  assert.deepEqual(one.level.plan, ["##A.##", "##..##"]);
  assert.deepEqual(one.level.people, { A: { id: "voss", label: "Voss" } });
  // Flat: a tile object's position is its bottom left corner, and a rectangle stands where its middle is.
  const flat = smallMap(dir, "flat", {
    orientation: "orthogonal", tilewidth: 32, tileheight: 32, alignment: "unspecified",
    objects: [
      { id: 1, name: "Pell", gid: 3, x: 32, y: 64, width: 32, height: 32, properties: [{ name: "person", type: "string", value: "pell" }] },
      { id: 2, name: "A crate of rations", x: 0, y: 0, width: 32, height: 32, properties: [{ name: "look", type: "string", value: "Rations, mostly." }] },
      { id: 3, name: "", type: "Label", x: 64, y: 0, width: 60, height: 20, text: { text: "STORES" } },
    ],
  });
  const two = tiled.roomFromMap(tiled.readMapFile(flat));
  assert.deepEqual(two.problems, []);
  assert.deepEqual(two.level.plan, [".a....", "...A.."]);
  assert.deepEqual(two.level.things.a, { name: "A crate of rations", look: "Rations, mostly." });
  assert.deepEqual(two.level.labels, [{ text: "STORES", at: [4, 0] }]);
  // A way out can be named after the room it leads to, and the start after what it is.
  const named = smallMap(dir, "named", { objects: [{ id: 1, name: "bridge", gid: 5, x: 16, y: 32, width: 40, height: 64 }, { id: 2, name: "Start", point: true, x: 160, y: 96, width: 0, height: 0 }] });
  const three = tiled.roomFromMap(tiled.readMapFile(named), { rooms: new Set(["bridge"]) });
  assert.deepEqual(three.problems, []);
  assert.deepEqual(three.level.exits, { 1: { to: "bridge" } });
  assert.deepEqual(three.level.plan, ["1.....", ".....@"]);
});

test("what's wrong in a Tiled room is said plainly, and the rest of the room still plays", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-tiled-wrong-"));
  const say = (file, options) => tiled.roomFromMap(tiled.readMapFile(file), options);
  const unmarked = say(smallMap(dir, "unmarked", { data: [2, 6, 2, 2, 2, 2], extraTiles: [{ id: 5, image: "mine.png" }] }));
  assert.match(unmarked.problems.join(), /tile 5 of the Small tileset doesn't say what it is in the room, so the game takes it for a wall \(1 square\)/);
  assert.equal(unmarked.level.plan[0], "..##..");
  const crowded = say(smallMap(dir, "crowded", {
    objects: [
      { id: 1, name: "Out there", gid: 4, x: 900, y: 32, width: 40, height: 56 },
      { id: 2, name: "A box", gid: 4, x: 16, y: 32, width: 40, height: 56 },
      { id: 3, name: "Another box", gid: 4, x: 16, y: 32, width: 40, height: 56 },
      { id: 4, name: "Somebody", gid: 3, x: 80, y: 32, width: 48, height: 96 },
      { id: 5, name: "", gid: 4, x: 112, y: 32, width: 40, height: 56 },
      { id: 6, name: "Nowhere", gid: 5, x: 16, y: 96, width: 40, height: 64 },
    ],
  }));
  assert.match(crowded.problems.join("\n"), /a thing called Out there is outside the room/);
  assert.match(crowded.problems.join("\n"), /a thing called Another box is on the same square as a thing called A box, so it's left out/);
  assert.match(crowded.problems.join("\n"), /a person called Somebody has no person property saying who they are/);
  assert.match(crowded.problems.join("\n"), /a thing has no name, so it's left out/);
  assert.match(crowded.problems.join("\n"), /a way out called Nowhere doesn't say where it goes/);
  assert.deepEqual(crowded.level.things, { a: { name: "A box" } });
  const big = say(smallMap(dir, "big", { width: 101, height: 61 }));
  assert.match(big.problems.join(), /it's 101 tiles across and 61 down, and a map can be 100 across and 60 down at most/);
  const mixed = say(smallMap(dir, "mixed", { data: [2, 6, 2, 2, 2, 2], extraTiles: [{ id: 5, properties: [{ name: "mark", type: "string", value: "." }, { name: "floor", type: "string", value: "" }] }] }));
  assert.match(mixed.problems.join(), /the mark \. is floor on some tiles and not on others/);
  // A file that can't be read is left out, and so is the older of two files for one room.
  const place = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-tiled-place-"));
  fs.writeFileSync(path.join(place, "broken.tmj"), "{ not a map");
  smallMap(place, "twice");
  fs.writeFileSync(path.join(place, "twice.tmx"), "<map orientation=\"isometric\" width=\"1\" height=\"1\" tilewidth=\"128\" tileheight=\"64\"></map>");
  const read = tiled.readPlaceRooms(place, { label: "maps/test" });
  assert.match(read.problems.join("\n"), /maps\/test\/broken\.tmj: it can't be read, so the room is left out/);
  assert.match(read.problems.join("\n"), /there's more than one file for the room twice \(twice\.tmj, twice\.tmx\), and the game uses the one saved last/);
  assert.deepEqual(Object.keys(read.rooms), ["twice"]);
});

// ---- While the game runs --------------------------------------------------------------------------------------

test("a room saved in Tiled shows up while the game runs, and nobody's left standing in a wall", () => {
  const game = createGameFromDraft(randomDraft({ seed: 21, archetype: "officer" }));
  // The captain stands on a whole tile of floor with nobody near, which isn't where the room starts.
  const first = walkView(game);
  const near = (x, y) => [...first.people, ...first.things, ...first.exits].some((one) => Math.abs(one.x - x) <= 2 && Math.abs(one.y - y) <= 1);
  const spots = first.floor.flatMap((row, y) => [...row].map((ch, x) => ({ x, y })).filter(({ x }) => row[x] === "." && row[x ^ 1] === "."));
  Object.assign(walkOf(game), spots.find((one) => !near(one.x, one.y) && (one.x !== first.captain.x || one.y !== first.captain.y)));
  const before = walkView(game);
  // The file is the deck's, when the room is one drawn on a deck.
  const room = before.here.deck?.id ?? before.here.id;
  const { x, y } = before.captain;
  const file = path.join(mapsDir, "meridian", `${room}.tmj`);
  const saved = fs.readFileSync(file, "utf8");
  try {
    // A wall where the captain stands, and a way out to a room that isn't there, as the owner might draw in Tiled.
    const map = JSON.parse(saved);
    const set = JSON.parse(fs.readFileSync(path.join(mapsDir, "tiles", "stand-ins.tsj"), "utf8"));
    const wall = set.tiles.find((tile) => tile.properties?.some((one) => one.name === "mark" && one.value === "#")).id + 1;
    map.layers.find((layer) => layer.name === "Walls and things").data[y * map.width + Math.floor(x / 2)] = wall;
    const exit = set.tiles.find((tile) => tile.type === "Way out").id + 1;
    map.layers.find((layer) => layer.name === "People and things").objects.push({ id: 999, name: "", type: "", gid: exit, x: 16, y: 32, width: 40, height: 64, properties: [{ name: "to", type: "string", value: "cargo_bay" }] });
    fs.writeFileSync(file, JSON.stringify(map));
    assert.ok(redrawnRooms(later()), "the change is noticed");
    const after = walkView(game);
    assert.ok(after.here.drawn > before.here.drawn, "the picture of the room is drawn again");
    assert.equal(after.layers.walls[y][x], "#");
    assert.notDeepEqual(after.captain, { x, y });
    assert.equal(after.floor[after.captain.y][after.captain.x], ".", "the captain is on the floor nearby");
    assert.ok(Math.abs(after.captain.x - x) + Math.abs(after.captain.y - y) <= 3);
    assert.match(MAP_FILE_PROBLEMS.join("\n"), new RegExp(`maps/meridian/${room}: a way out leads to cargo_bay, and there's no room called that`));
    assert.equal(redrawnRooms(later()), false, "nothing more to read until it changes again");
  } finally {
    fs.writeFileSync(file, saved);
    redrawnRooms(later());
  }
  assert.deepEqual(MAP_FILE_PROBLEMS, []);
  assert.equal(walkView(game).layers.walls[y][x], before.layers.walls[y][x], "and back as it was");
});

test("the tool that moves a place's rooms into Tiled keeps every one of them the same", () => {
  const place = "sarn";
  const levels = structuredClone(WORLD_MAPS[place].levels);
  const tilesBefore = JSON.parse(fs.readFileSync(path.join(mapsDir, "tiles", "stand-ins.tsj"), "utf8")).tiles;
  execFileSync(process.execPath, [path.join(root, "tools", "to-tiled.mjs"), place], { env: { ...process.env, GAME_MAPS_DIR: mapsDir }, stdio: "pipe" });
  const file = JSON.parse(fs.readFileSync(path.join(mapsDir, `${place}.json`), "utf8"));
  assert.deepEqual(file.levels, {}, "the place's file keeps only what Tiled doesn't draw");
  assert.match(file._help[0], /drawn in Tiled/);
  const tilesAfter = JSON.parse(fs.readFileSync(path.join(mapsDir, "tiles", "stand-ins.tsj"), "utf8")).tiles;
  assert.deepEqual(tilesAfter.slice(0, tilesBefore.length), tilesBefore, "the tiles already there keep their numbers");
  assert.ok(redrawnRooms(later()));
  for (const [id, level] of Object.entries(levels)) {
    assert.ok(WORLD_MAPS[place].levels[id].drawn, `${place}/${id} is read from Tiled`);
    assert.deepEqual(plain(id, WORLD_MAPS[place].levels[id]), plain(id, level), `${place}/${id}`);
  }
  assert.deepEqual(MAP_FILE_PROBLEMS, []);
  // Run again, it leaves the rooms it's moved alone.
  assert.throws(() => execFileSync(process.execPath, [path.join(root, "tools", "to-tiled.mjs"), place], { env: { ...process.env, GAME_MAPS_DIR: mapsDir }, stdio: "pipe" }), /nothing to move/);
});
