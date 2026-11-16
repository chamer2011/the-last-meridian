// The pieces of the bought packs as furniture (src/pack-furniture.js, world/furniture.txt): what each is guessed to be,
// the plain-text file that says so, and the pieces on a deck: in the way or not, sat in, opened, hung on a wall, laid
// under things or stood on a table. Everything here works on a made-up pack and on copies of the maps, never on the
// game's own files.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-pack-furniture-"));
const world = new URL("../world/", import.meta.url);
fs.cpSync(fs.realpathSync(new URL("maps", world)), path.join(tmp, "maps"), { recursive: true });
fs.cpSync(fs.realpathSync(new URL("life", world)), path.join(tmp, "life"), { recursive: true });
process.env.GAME_DATA_DIR = path.join(tmp, "data");
process.env.GAME_MAPS_DIR = path.join(tmp, "maps");
process.env.GAME_LIFE_DIR = path.join(tmp, "life");
process.env.GAME_LICENSED_DIR = path.join(tmp, "licensed");
process.env.GAME_PIECES_FILE = path.join(tmp, "pieces.txt");
process.env.GAME_FURNITURE_FILE = path.join(tmp, "furniture.txt");

// A real picture file: alphaAt says how solid each pixel is. As eight bits a channel, or with a palette of three
// colours (nothing, solid, half see-through), and with its rows packed plainly or as differences from the pixel to
// the left or the row above, the ways a PNG can be.
function png(w, h, alphaAt, { palette = false, filter = 0 } = {}) {
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, "ascii"), body])) >>> 0, 0);
    return Buffer.concat([head, body, crc]);
  };
  const step = palette ? 1 : 4;
  const stride = w * step;
  const rows = [];
  for (let y = 0; y < h; y += 1) {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < w; x += 1) {
      const a = alphaAt(x, y);
      if (palette) row[x] = a >= 250 ? 1 : a > 0 ? 2 : 0;
      else row.set([200, 180, 90, a], x * 4);
    }
    rows.push(row);
  }
  const raw = Buffer.alloc(h * (stride + 1));
  rows.forEach((row, y) => {
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= step ? row[i - step] : 0;
      const up = y ? rows[y - 1][i] : 0;
      raw[y * (stride + 1) + 1 + i] = (row[i] - (filter === 1 ? left : filter === 2 ? up : 0)) & 255;
    }
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = palette ? 3 : 6;
  const parts = [chunk("IHDR", ihdr)];
  if (palette) parts.push(chunk("PLTE", Buffer.from([0, 0, 0, 200, 180, 90, 20, 20, 20])), chunk("tRNS", Buffer.from([0, 255, 128])));
  parts.push(chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...parts]);
}
// A thing a hundred pixels tall and the whole picture wide, standing on one point three quarters of the way across,
// with a soft shadow under it that isn't part of it.
const longTable = (x, y) => (y >= 28 && y <= 125 ? 255 : y >= 126 && y <= 127 ? (x >= 96 && x <= 97 ? 255 : 120) : 0);
const blob = (x, y) => (x >= 20 && x <= 43 && y >= 30 && y <= 59 ? 255 : 0);
const pack = (file, bytes) => {
  const full = path.join(tmp, "licensed", file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bytes);
};
pack("interiors/Tables/Table_10.png", png(128, 128, longTable));
pack("interiors/Tables/Table_11.png", png(128, 128, longTable, { palette: true, filter: 1 }));
pack("interiors/Chairs/Chair_4_A_Tile.png", png(64, 64, blob));
pack("interiors/Chairs/Chair_4_B_Tile.png", png(64, 64, blob));
pack("interiors/Chairs/Chair_4_C_Tile.png", png(64, 64, blob));
pack("interiors/Chairs/Chair_4_D_Tile.png", png(64, 64, blob));
pack("interiors/Sofa/Sofa_2_A.png", png(128, 128, longTable, { filter: 2 }));
pack("interiors/Lab/Server_2_A.png", png(64, 64, blob));
pack("interiors/Wall_Decoration/Poster_6.png", png(64, 64, blob));
pack("interiors/Kitchen/Mug_Red.png", png(32, 32, (x, y) => (x > 10 && x < 20 && y > 10 && y < 20 ? 255 : 0)));
pack("interiors/Carpets/Carpet_Modern.png", png(128, 128, (x, y) => (Math.abs(x - 64) / 64 + Math.abs(y - 96) / 32 <= 1 ? 255 : 0)));
pack("interiors/Office/Office_Metallic_Closet_Ani/Metallic_Closet_Base.png", png(64, 64, blob));
pack("interiors/Floor_Wall_Tiles_128/Floor_128_Black.png", png(128, 128, () => 255));
pack("interiors/Doors/Door_6_Blue.png", png(640, 128, blob));
pack("interiors/Lamps/Lamp_11_Tile.png", png(32, 32, blob));

// What the game's own file would say of some pieces that are in no pack, so a deck can have them wherever the packs are.
const OWN = [
  "What each piece is.",
  "",
  "Bridge and command",
  "- Test table [testpack/Table]: a table, 2 by 1, 0.8 high",
  "- Test laptop [testpack/Laptop]: a small thing, glows #86dcff",
  "- Test chair [testpack/Chair]: a seat, 1 by 1",
  "- Test sign [testpack/Sign]: hangs on a wall",
  "- Test rug [testpack/Rug]: lies on the floor, 4 by 2",
  "- Test cabinet [testpack/Cabinet]: something to open like a locker, 1 by 1, 1.5 high",
  "- Test screen [testpack/Screen]: stands on the floor, 1 by 1, not in the way",
].join("\n");
fs.writeFileSync(process.env.GAME_FURNITURE_FILE, OWN);

// Deck 1's copy gets those pieces on its bridge before the game reads it, in place of the furniture it has: a table
// with a laptop on its square, a chair, a rug, a cabinet, and a sign on the forward wall.
const deckFile = path.join(tmp, "maps", "meridian", "deck1.tmj");
const square = (x, y) => ({ x: ((x + 0.5) / 2) * 64, y: (y + 0.5) * 64 });
const piece = (id, kind, x, y, facing) => ({ id, name: kind, type: "Furniture", ...square(x, y), width: 0, height: 0, rotation: 0, point: true, visible: true, properties: facing ? [{ name: "facing", type: "string", value: facing }] : [] });
const deck = JSON.parse(fs.readFileSync(deckFile, "utf8"));
deck.layers = deck.layers.filter((layer) => layer.name !== "Furniture");
deck.layers.push({ id: 90, name: "Furniture", type: "objectgroup", visible: true, opacity: 1, x: 0, y: 0, objects: [
  piece(9001, "testpack/Table", 30, 9, "s"), piece(9002, "testpack/Laptop", 31, 9, "s"), piece(9003, "testpack/Chair", 30, 10, "n"),
  piece(9004, "testpack/Sign", 26, 1), piece(9005, "testpack/Rug", 32, 14, "s"), piece(9006, "testpack/Cabinet", 34, 9, "s"),
] });
fs.writeFileSync(deckFile, JSON.stringify(deck));

const { alphaOf, solidBoxOf } = await import("../src/png.js");
const { FURNITURE, FURNITURE_BY_ID, footprintOf, furnitureVersion, isFurniture, packFurniture, squaresOf } = await import("../public/furniture.js");
const furniture = await import("../src/pack-furniture.js");
const { catalogue } = await import("../src/pieces.js");
const { roomFromMap, readMapFile, roomToMap } = await import("../src/tiled.js");
const { MAP_FILE_PROBLEMS, WORLD_MAPS } = await import("../src/world.js");
const { canStand, mapFor } = await import("../src/walk.js");
const editor = await import("../src/map-editor.js");
const { buildScene } = await import("../public/iso.js");
const { slantOf } = await import("../public/pixel-art.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { walkView } = await import("../src/walk.js");

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("a picture's solid part is found, in each of the ways a picture file can be written", () => {
  for (const file of ["interiors/Tables/Table_10.png", "interiors/Tables/Table_11.png", "interiors/Sofa/Sofa_2_A.png"]) {
    const read = alphaOf(path.join(tmp, "licensed", file));
    assert.equal(read.width, 128, file);
    assert.equal(read.alpha[28 * 128 + 5], 255, file);
    assert.equal(read.alpha[27 * 128 + 5], 0, file);
    // Its shadow is half see-through.
    assert.ok(read.alpha[127 * 128 + 5] > 0 && read.alpha[127 * 128 + 5] < 250, file);
    const box = solidBoxOf(path.join(tmp, "licensed", file));
    assert.deepEqual([box.x0, box.y0, box.x1, box.y1, box.w, box.h], [0, 28, 127, 127, 128, 128], file);
    // The lowest solid point is three quarters of the way across.
    assert.ok(Math.abs(box.front - 96.5 / 127) < 0.001, file);
  }
  // One square of a sheet, counted from the square's own corner.
  const cell = solidBoxOf(path.join(tmp, "licensed", "interiors/Doors/Door_6_Blue.png"), { x: 0, y: 0, w: 128, h: 128 });
  assert.deepEqual([cell.x0, cell.y0, cell.x1, cell.y1], [20, 30, 43, 59]);
  assert.equal(solidBoxOf(path.join(tmp, "licensed", "interiors/Doors/Door_6_Blue.png"), { x: 128, y: 0, w: 128, h: 128 }), null);
  // What isn't a picture, or isn't there.
  fs.writeFileSync(path.join(tmp, "not-a-picture.png"), "words");
  assert.equal(alphaOf(path.join(tmp, "not-a-picture.png")), null);
  assert.equal(solidBoxOf(path.join(tmp, "nowhere.png")), null);
});

test("what a piece is guessed to be comes from where it is in the packs, and its size from its picture", () => {
  const pieces = new Map(catalogue().pieces.map((one) => [one.id, one]));
  const guess = (id) => furniture.guessFurniture(pieces.get(id));
  // A table 128 pixels wide standing on a point three quarters across: four squares by one, and 0.55 of a tile high,
  // as its picture has it (the packs' pieces are drawn at their own size).
  assert.deepEqual(guess("interiors/Tables/Table_10"), { what: "table", like: null, across: 4, down: 1, high: 0.55, blocks: true, lit: null, steel: false });
  assert.deepEqual(guess("interiors/Tables/Table_11"), guess("interiors/Tables/Table_10"));
  // A chair is one square whatever its picture; a sofa is as wide as it's drawn, and one deep.
  assert.deepEqual([guess("interiors/Chairs/Chair_4").what, guess("interiors/Chairs/Chair_4").across, guess("interiors/Chairs/Chair_4").down, guess("interiors/Chairs/Chair_4").blocks], ["seat", 1, 1, false]);
  assert.deepEqual([guess("interiors/Sofa/Sofa_2").what, guess("interiors/Sofa/Sofa_2").across, guess("interiors/Sofa/Sofa_2").down], ["seat", 4, 1]);
  assert.deepEqual([guess("interiors/Lab/Server_2").what, guess("interiors/Lab/Server_2").blocks, guess("interiors/Lab/Server_2").lit], ["stand", true, "#86dcff"]);
  assert.deepEqual([guess("interiors/Office/Office_Metallic_Closet_Ani").what, guess("interiors/Office/Office_Metallic_Closet_Ani").like], ["opens", "locker"]);
  // What hangs on a wall and what's small have no size of their own, and aren't in the way.
  assert.deepEqual(guess("interiors/Wall_Decoration/Poster_6"), { what: "wall", like: null, across: 1, down: 1, high: 0.95, blocks: false, lit: null, steel: false });
  assert.deepEqual(guess("interiors/Kitchen/Mug_Red"), { what: "small", like: null, across: 1, down: 1, high: 0.2, blocks: false, lit: null, steel: false });
  assert.equal(guess("interiors/Lamps/Lamp_11").lit, "#ffd9a0");
  // A carpet lies flat: as much floor as its picture, nothing high.
  assert.deepEqual([guess("interiors/Carpets/Carpet_Modern").what, guess("interiors/Carpets/Carpet_Modern").across, guess("interiors/Carpets/Carpet_Modern").down, guess("interiors/Carpets/Carpet_Modern").high, guess("interiors/Carpets/Carpet_Modern").blocks], ["rug", 2, 1, 0, false]);
  // What a deck is built of isn't furniture.
  assert.equal(guess("interiors/Floor_Wall_Tiles_128/Floor_Black"), null);
  assert.equal(guess("interiors/Doors/Door_6_Blue"), null);
  for (const id of ["isospace/floor-dark-1", "isospace/wall-light-2", "isospace/low-wall-dark", "isospace/door-dark", "isospace/stairs-light", "isospace/pillar-dark", "interiors/StairCase/StairRailing_1", "interiors/Lab/Door_Lab", "interiors/Japanese_Room/Japanese_Door"]) assert.equal(furniture.guessFurniture({ id, pictures: [] }), null, id);
  // Without its picture a piece still has a kind, and the size its kind usually has.
  assert.deepEqual(furniture.guessFurniture({ id: "interiors/Tables/Table_99", pictures: [] }), { what: "table", like: null, across: 1, down: 1, high: 0.75, blocks: true, lit: null, steel: false });
  assert.equal(furniture.guessFurniture({ id: "isospace/bunk", pictures: [] }).what, "bed");
  assert.equal(furniture.guessFurniture({ id: "interiors/Somewhere/New_Thing", pictures: [] }).what, "stand");
});

test("the file's words read back as the same facts, and its mistakes are named with their line", () => {
  const facts = [
    { id: "a/Seat", name: "A seat", place: "bridge", what: "seat", like: null, across: 1, down: 1, high: 0.5, blocks: false, lit: null, steel: false },
    { id: "a/Table", name: "A [long] table", place: "mess", what: "table", like: null, across: 4, down: 1, high: 0.7, blocks: true, lit: null, steel: true },
    { id: "a/Fridge", name: "A fridge", place: "mess", what: "opens", like: "shelf", across: 1, down: 1, high: 1.4, blocks: true, lit: null, steel: false },
    { id: "a/Sign", name: "A sign", place: "walls", what: "wall", like: null, across: 1, down: 1, high: 1.2, blocks: false, lit: null, steel: false },
    { id: "a/Rug", name: "A rug", place: "quarters", what: "rug", like: null, across: 4, down: 2, high: 0, blocks: false, lit: null, steel: false },
    { id: "a/Lamp", name: "A lamp", place: "nowhere at all", what: "small", like: null, across: 1, down: 1, high: 0.2, blocks: false, lit: "#ffd9a0", steel: false },
    { id: "a/Ghost", name: "A screen you walk through", place: "bridge", what: "stand", like: null, across: 2, down: 1, high: 1, blocks: false, lit: null, steel: false },
  ];
  const text = furniture.writeFurniture(facts);
  assert.match(text, /^What each piece of the two pixel-art packs is/);
  assert.match(text, /\nBridge and command\n- A seat \[a\/Seat\]: a seat, 1 by 1\n- A screen you walk through \[a\/Ghost\]: stands on the floor, 2 by 1, not in the way\n/);
  assert.match(text, /\n- A long table \[a\/Table\]: a table, 4 by 1, 0\.7 high, in steel\n- A fridge \[a\/Fridge\]: something to open like shelves, 1 by 1, 1\.4 high\n/);
  assert.match(text, /\n- A sign \[a\/Sign\]: hangs on a wall, 1\.2 high\n/);
  assert.match(text, /\n- A rug \[a\/Rug\]: lies on the floor, 4 by 2\n/);
  // A place the game doesn't know goes under the last heading.
  assert.match(text, /\nOdds and ends\n- A lamp \[a\/Lamp\]: a small thing, glows #ffd9a0\n/);
  const { listed, problems } = furniture.parseFurniture(text);
  assert.deepEqual(problems, []);
  for (const one of facts) {
    const { place, name, ...rest } = one;
    assert.deepEqual({ ...listed.get(one.id), name: undefined }, { ...rest, name: undefined }, one.id);
  }
  const bad = furniture.parseFurniture([
    "Anything before the first place is the file's own words: a seat, a rug [x]: nonsense.",
    "Quarters",
    "- A chair [b/Chair]: a seat, 1 by 1",
    "- No kind [b/None]: 2 by 1",
    "- Odd word [b/Odd]: a table, enormous",
    "- A chair again [b/Chair]: a table",
    "just some words",
    "- A crate [b/Crate]: something to open like a wardrobe",
    "- A big thing [b/Big]: stands on the floor, 99 by 99, 7 high",
    "- A box [b/Box]: something to open",
  ].join("\r\n"));
  assert.equal(bad.problems.length, 5);
  assert.match(bad.problems[0], /line 4: it doesn't say what the piece is/);
  assert.match(bad.problems[1], /line 5: "enormous" isn't something this file knows/);
  assert.match(bad.problems[2], /line 6: "b\/Chair" is listed twice/);
  assert.match(bad.problems[3], /line 7: this line isn't "- a name \[where it is\]: what it is"/);
  assert.match(bad.problems[4], /line 8: .*like a locker, like shelves, like a desk or like a barrel/);
  assert.equal(bad.listed.get("b/Chair").what, "seat");
  // Sizes are kept to what a deck can take, and something to open that doesn't say opens like a barrel.
  assert.deepEqual([bad.listed.get("b/Big").across, bad.listed.get("b/Big").down, bad.listed.get("b/Big").high], [8, 4, 2]);
  assert.equal(bad.listed.get("b/Box").like, "barrel");
});

test("the game's own file reads without a mistake, and has no floor, wall or door in it", () => {
  const { listed, problems } = furniture.parseFurniture(fs.readFileSync(new URL("furniture.txt", world), "utf8"));
  assert.deepEqual(problems, []);
  assert.ok(listed.size > 300, `${listed.size} pieces`);
  for (const one of listed.values()) {
    assert.equal(furniture.guessFurniture({ id: one.id, pictures: [] }) === null, false, one.id);
    assert.ok(one.across >= 1 && one.across <= 8 && one.down >= 1 && one.down <= 4, one.id);
    if (one.what === "opens") assert.ok(furniture.LIKES[one.like], one.id);
  }
});

test("the file's pieces join the game's furniture under their own ids, with the game's own left as they were", () => {
  assert.equal(FURNITURE.length, 18);
  assert.ok(FURNITURE.every((one) => !one.pack));
  assert.deepEqual(packFurniture().map((one) => one.id).sort(), ["testpack/Cabinet", "testpack/Chair", "testpack/Laptop", "testpack/Rug", "testpack/Screen", "testpack/Sign", "testpack/Table"]);
  const table = FURNITURE_BY_ID["testpack/Table"];
  assert.deepEqual([table.name, table.pack, table.what, table.size, table.blocks, table.high, table.seat, table.wall], ["Test table", true, "table", [1, 1], true, 0.8, undefined, undefined]);
  assert.deepEqual([FURNITURE_BY_ID["testpack/Chair"].seat, FURNITURE_BY_ID["testpack/Chair"].blocks], [true, false]);
  assert.deepEqual([FURNITURE_BY_ID["testpack/Sign"].wall, FURNITURE_BY_ID["testpack/Sign"].blocks], [true, false]);
  assert.equal(FURNITURE_BY_ID["testpack/Cabinet"].opens, "locker");
  assert.equal(FURNITURE_BY_ID["testpack/Laptop"].lit, "#86dcff");
  assert.equal(FURNITURE_BY_ID["testpack/Screen"].blocks, false);
  assert.ok(isFurniture("testpack/Rug") && !isFurniture("testpack/rug"));
  // How much floor each takes, turned or not.
  assert.deepEqual(footprintOf({ kind: "testpack/Rug", facing: "s" }), { across: 4, down: 2 });
  assert.deepEqual(footprintOf({ kind: "testpack/Table", facing: "s" }), { across: 2, down: 1 });
  assert.deepEqual(footprintOf({ kind: "testpack/Sign" }), { across: 1, down: 1 });
  assert.equal(squaresOf({ kind: "testpack/Rug", x: 32, y: 14, facing: "s" }).length, 8);
});

test("a deck with the packs' pieces on it reads without complaint: a small thing shares a table's square", () => {
  assert.deepEqual(MAP_FILE_PROBLEMS.filter((line) => /deck1/.test(line)), []);
  const level = WORLD_MAPS.meridian.levels.deck1;
  assert.deepEqual(level.furniture.map((one) => one.kind).sort(), ["testpack/Cabinet", "testpack/Chair", "testpack/Laptop", "testpack/Rug", "testpack/Sign", "testpack/Table"]);
  // A piece's id keeps its capitals in the deck's file and back.
  const again = roomFromMap(readMapFile(deckFile));
  assert.ok(again.level.furniture.some((one) => one.kind === "testpack/Table" && one.x === 30 && one.y === 9));
});

test("on the deck, a table and a cabinet are in the way, and a chair, a rug and a laptop aren't", () => {
  const map = mapFor("meridian");
  const level = map.levels.deck1;
  const stand = (x, y) => canStand(level, x, y);
  // The table's two squares, the laptop's being one of them.
  assert.equal(stand(30, 9), false);
  assert.equal(stand(31, 9), false);
  assert.equal(stand(34, 9), false);
  assert.equal(stand(30, 10), true);
  for (const [x, y] of squaresOf({ kind: "testpack/Rug", x: 32, y: 14, facing: "s" })) assert.equal(stand(x, y), true, `${x},${y}`);
  // The chair is somewhere to sit; the rug isn't.
  assert.ok(level.seats.has("30,10"));
  assert.ok(!level.seats.has("32,14"));
  // What the game stands in rooms by itself keeps off all of them, rug included, but the wall the sign's on isn't floor.
  for (const key of ["30,9", "30,10", "34,9", "32,14", "35,15"]) assert.ok(level.furnished.has(key), key);
  assert.ok(!level.furnished.has("26,1"));
});

test("a cabinet of the packs opens like the game's own lockers", () => {
  const level = mapFor("meridian").levels.deck1;
  const cabinet = level.things.find((thing) => thing.onPiece === "testpack/Cabinet");
  assert.ok(cabinet, "the cabinet is something to open");
  assert.deepEqual([cabinet.x, cabinet.y], [34, 9]);
  assert.match(cabinet.name, /locker/);
  assert.ok(cabinet.holds);
  // The table doesn't open, nor the rug.
  assert.equal(level.things.filter((thing) => String(thing.onPiece ?? "").startsWith("testpack/")).length, 1);
});

test("the room's picture has them: the laptop on the table, the rug under everyone, the sign on the wall's face, and what glows gives light", () => {
  const game = createGameFromDraft(randomDraft(), "pack furniture");
  const view = walkView(game);
  const scene = buildScene(view);
  const blocks = new Map(scene.blocks.filter((block) => block.style === "piece" && String(block.kind).startsWith("testpack/")).map((block) => [block.kind, block]));
  assert.deepEqual([...blocks.keys()].sort(), ["testpack/Cabinet", "testpack/Chair", "testpack/Laptop", "testpack/Rug", "testpack/Sign", "testpack/Table"]);
  const table = blocks.get("testpack/Table");
  const laptop = blocks.get("testpack/Laptop");
  // It sits at the height of the table's top, and is drawn after the table.
  assert.equal(laptop.lift, 0.8);
  assert.ok(laptop.depth > table.depth);
  assert.equal(table.h, 0.8);
  // The rug is drawn before anyone who could stand on it: its depth is that of its far corner or less.
  const rug = blocks.get("testpack/Rug");
  assert.ok(rug.depth <= rug.x0 + rug.y0);
  assert.equal(rug.lift, 0);
  // The sign is on the face of its wall that looks down the deck, where the room is.
  const sign = blocks.get("testpack/Sign");
  assert.deepEqual([sign.face, sign.wallX, sign.wallY], ["s", 26, 1]);
  // The laptop's screen lights the room a little; the sign, which doesn't glow, gives none.
  assert.ok(scene.lights.some((light) => light.color === "#86dcff" && light.wx === 15.75 && light.wy === 9.5 && light.radius === 1.1));
  assert.ok(scene.lights.every((light) => typeof light.color === "string"));
});

test("the map editor takes them: a second small thing on the table, but not a second table", () => {
  const doc = editor.deckForEditing("meridian", "deck1");
  assert.ok(doc.furniture.some((one) => one.kind === "testpack/Laptop"));
  const withMore = (more) => ({ ...doc, grid: doc.grid, furniture: [...doc.furniture, ...more] });
  const about = (result) => result.problems.map((one) => one.words).filter((words) => /test (table|laptop|rug|chair|sign|cabinet|screen)/i.test(words));
  assert.deepEqual(about(editor.tryDeck("meridian", "deck1", withMore([{ kind: "testpack/Laptop", x: 30, y: 9, facing: "e" }, { kind: "testpack/Rug", x: 29, y: 9, facing: "s" }]), { keep: false })), []);
  assert.deepEqual(about(editor.tryDeck("meridian", "deck1", withMore([{ kind: "testpack/Table", x: 31, y: 9, facing: "s" }]), { keep: false })), ["The test table is on top of the test table."]);
  assert.deepEqual(about(editor.tryDeck("meridian", "deck1", withMore([{ kind: "testpack/Sign", x: 30, y: 12 }]), { keep: false })), ["The test sign has to hang on a wall."]);
  // A piece the game doesn't know isn't taken at all.
  assert.throws(() => editor.tryDeck("meridian", "deck1", withMore([{ kind: "testpack/Nothing", x: 36, y: 12, facing: "s" }]), { keep: false }), /isn't one the game knows/);
});

test("the Pieces window's changes are kept in the file, and the game's furniture follows", () => {
  const file = process.env.GAME_FURNITURE_FILE;
  const before = furnitureVersion();
  // A piece of the packs that has no line yet: its first change writes the guess with the change on top.
  assert.deepEqual(furniture.setFurniture([{ id: "interiors/Tables/Table_10", furniture: { blocks: false } }]), { known: 8 });
  assert.match(fs.readFileSync(file, "utf8"), /\n- Square table \[interiors\/Tables\/Table_10\]: a table, 4 by 1, 0\.55 high, not in the way\n/);
  assert.ok(furnitureVersion() > before);
  assert.deepEqual([FURNITURE_BY_ID["interiors/Tables/Table_10"].size, FURNITURE_BY_ID["interiors/Tables/Table_10"].blocks], [[2, 1], false]);
  // The lines that were there are still there, under their headings.
  assert.match(fs.readFileSync(file, "utf8"), /\n- Test cabinet \[testpack\/Cabinet\]: something to open like a locker, 1 by 1, 1\.5 high\n/);
  // Another kind of thing is in the way as that kind is; a size is kept to what a deck can take.
  furniture.setFurniture([{ id: "interiors/Tables/Table_10", furniture: { what: "opens", like: "desk", across: 40, down: 0 } }]);
  let table = furniture.furnitureFacts().get("interiors/Tables/Table_10");
  assert.deepEqual([table.what, table.like, table.across, table.down, table.blocks, table.high], ["opens", "desk", 8, 1, true, 0.55]);
  assert.equal(FURNITURE_BY_ID["interiors/Tables/Table_10"].opens, "desk");
  furniture.setFurniture([{ id: "interiors/Tables/Table_10", furniture: { what: "wall" } }]);
  table = furniture.furnitureFacts().get("interiors/Tables/Table_10");
  assert.deepEqual([table.what, table.like, table.blocks, table.high], ["wall", null, false, 0.95]);
  assert.equal(FURNITURE_BY_ID["interiors/Tables/Table_10"].wall, true);
  // What can't be done is refused, and nothing is written.
  const text = fs.readFileSync(file, "utf8");
  assert.throws(() => furniture.setFurniture([{ id: "interiors/Tables/Table_99", furniture: { what: "seat" } }]), /isn't in the packs/);
  assert.throws(() => furniture.setFurniture([{ id: "interiors/Tables/Table_10", furniture: { what: "a spaceship" } }]), /isn't something a piece can be/);
  assert.throws(() => furniture.setFurniture([{ id: "interiors/Tables/Table_10", furniture: { across: "wide" } }]), /has to be numbers/);
  assert.equal(fs.readFileSync(file, "utf8"), text);
  // A change that isn't about furniture is passed over.
  assert.equal(furniture.setFurniture([{ id: "interiors/Tables/Table_10", on: false }]), null);
  // Not furniture after all: its line goes, and so does the piece from the game's furniture.
  furniture.setFurniture([{ id: "interiors/Tables/Table_10", furniture: null }]);
  assert.equal(furniture.furnitureFacts().has("interiors/Tables/Table_10"), false);
  assert.equal(isFurniture("interiors/Tables/Table_10"), false);
  assert.ok(isFurniture("testpack/Table"));
});

test("every piece of the packs that isn't in the file gets its line, and no line that's there is changed", () => {
  const file = process.env.GAME_FURNITURE_FILE;
  const added = furniture.fillFurniture();
  // Twelve pieces in the made-up pack, less the floor and the door.
  assert.equal(added, 10);
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /\n- Test table \[testpack\/Table\]: a table, 2 by 1, 0\.8 high\n/);
  assert.match(text, /\n- Plastic chair, blue \[interiors\/Chairs\/Chair_4\]: a seat, 1 by 1/);
  assert.match(text, /\n- Hazard sign, yellow \[interiors\/Wall_Decoration\/Poster_6\]: hangs on a wall\n/);
  assert.match(text, /\n- Steel locker \[interiors\/Office\/Office_Metallic_Closet_Ani\]: something to open like a locker, /);
  assert.ok(!/Floor_Black|Door_6_Blue/.test(text));
  assert.deepEqual(furniture.furnitureProblems(), []);
  assert.equal(furniture.fillFurniture(), 0);
  assert.equal(fs.readFileSync(file, "utf8"), text);
  // With the catalogue: each piece has what it is beside it, and what a deck is built of has nothing.
  const all = furniture.withFurniture();
  const pieces = new Map(all.pieces.map((one) => [one.id, one]));
  assert.deepEqual([pieces.get("interiors/Chairs/Chair_4").furniture.what, pieces.get("interiors/Chairs/Chair_4").furniture.known], ["seat", true]);
  assert.equal(pieces.get("interiors/Floor_Wall_Tiles_128/Floor_Black").furniture, null);
  assert.deepEqual(all.furnitureProblems, []);
});

test("the page is told each piece with the pictures to draw it from: four sides where the pack has four, else one", () => {
  const list = new Map(furniture.furnitureForPage().map((one) => [one.id, one]));
  const chair = list.get("interiors/Chairs/Chair_4");
  assert.deepEqual(Object.fromEntries(Object.entries(chair.faces).map(([facing, picture]) => [facing, picture.file])), {
    s: "interiors/Chairs/Chair_4_A_Tile.png", e: "interiors/Chairs/Chair_4_B_Tile.png", w: "interiors/Chairs/Chair_4_C_Tile.png", n: "interiors/Chairs/Chair_4_D_Tile.png",
  });
  assert.deepEqual([chair.name, chair.seat, chair.on, chair.place, chair.pack], ["Plastic chair, blue", true, true, "mess", true]);
  // A sofa with one side, a server with one of three: its first picture, to be turned round for the other ways.
  assert.equal(list.get("interiors/Sofa/Sofa_2").picture.file, "interiors/Sofa/Sofa_2_A.png");
  assert.equal(list.get("interiors/Sofa/Sofa_2").faces, undefined);
  assert.equal(list.get("interiors/Kitchen/Mug_Red").picture.file, "interiors/Kitchen/Mug_Red.png");
  // A piece the file knows that no pack here has: furniture all the same, with nothing to draw it from.
  const own = list.get("testpack/Table");
  assert.deepEqual([own.name, own.on, own.picture, own.faces, own.size], ["Test table", false, undefined, undefined, [1, 1]]);
});

test("a flat thing's picture says which kind of wall it was drawn for", () => {
  // Four numbers a pixel, as a canvas gives them: a band whose top runs down to the right, and one down to the left.
  const band = (rise) => {
    const w = 40;
    const h = 40;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let x = 0; x < w; x += 1) {
      const top = Math.round(10 + (rise > 0 ? x : w - 1 - x) * Math.abs(rise));
      for (let y = top; y < top + 8 && y < h; y += 1) data[(y * w + x) * 4 + 3] = 255;
    }
    return { data, w, box: { x0: 0, x1: w - 1, y0: 0, y1: h - 1 } };
  };
  const right = band(0.5);
  const left = band(-0.5);
  const flat = band(0);
  assert.equal(slantOf(right.data, right.w, right.box), "s");
  assert.equal(slantOf(left.data, left.w, left.box), "e");
  assert.equal(slantOf(flat.data, flat.w, flat.box), null);
});
