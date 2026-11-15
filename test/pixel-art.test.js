// The pixel-art test view (public/pixel-art.js): its pictures land where the game's tiles are, it's off until Settings
// turns it on, and the bought pack it draws from can never be published.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doorPicture, mapping, pieceWay, pixelArtOn, pixelDoorDepth, pixelKey, solidBox, standingPoint } from "../public/pixel-art.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

test("a floor tile's four corners land on the tile's four corners, at half the pack's size", () => {
  // The tile's top, right and left corners on the sheet, to where they'd be in the view at 64 pixels a tile.
  const m = mapping([[64, 56], [128, 88], [0, 88]], [[300, 100], [332, 116], [268, 116]]);
  assert.deepEqual(apply(m, [64, 120]).map(Math.round), [300, 132]);
  assert.deepEqual(apply(m, [64, 56]).map(Math.round), [300, 100]);
});

test("a wall is stood up to the game's height without leaving its foot", () => {
  // The slab's near foot, far foot and near top, to a wall 1.7 tiles high at 64 pixels a tile (54.4 pixels up).
  const m = mapping([[24, 92], [88, 124], [24, 4]], [[0, 0], [32, 16], [0, -54.4]]);
  assert.deepEqual(apply(m, [88, 36]).map((n) => Math.round(n * 10) / 10), [32, -38.4]);
});

test("a door shows shut and green, slides open through six pictures, and shows red when locked", () => {
  assert.equal(doorPicture(0), 1);
  assert.equal(doorPicture(0.5), 6);
  assert.equal(doorPicture(1), 8);
  assert.equal(doorPicture(1, true), 2);
  const seen = new Set(Array.from({ length: 101 }, (_, i) => doorPicture(i / 100)));
  assert.deepEqual([...seen].sort((a, b) => a - b), [1, 3, 4, 5, 6, 7, 8]);
});

test("a door stands in the front of its doorway, so whoever's in the doorway is drawn behind its frame", () => {
  // A doorway on square 10 of row 4, half a tile wide: someone standing in it is at its middle.
  const middle = (10 + 0.5) * 0.5 + 4 + 0.5;
  assert.ok(pixelDoorDepth({ x: 10, y: 4, along: "x" }, 0.5) > middle);
  assert.ok(pixelDoorDepth({ x: 10, y: 4, along: "y" }, 0.5) > middle);
});

test("a piece of furniture stands on the middle of the diamond under it", () => {
  // A piece 40 pixels wide whose lowest pixel is row 99 stands 10 pixels up from its foot.
  assert.deepEqual(standingPoint({ x0: 20, x1: 59, y0: 10, y1: 99 }), [40, 90]);
});

// As if every picture of both packs were in the folder, or only the first pack's.
const both = { look: "dark", has: () => true };
const firstOnly = { look: "dark", has: (picture) => !picture.file };

test("a chair is drawn from the side it's seen from, and a piece with one picture is turned round to face east or west", () => {
  assert.match(pieceWay("chair", "s", 0, both).picture.file, /Chair_4_A_Tile/);
  assert.match(pieceWay("chair", "e", 0, both).picture.file, /Chair_4_B_Tile/);
  assert.match(pieceWay("chair", "w", 0, both).picture.file, /Chair_4_C_Tile/);
  assert.match(pieceWay("chair", "n", 0, both).picture.file, /Chair_4_D_Tile/);
  assert.equal(pieceWay("chair", "w", 0, both).flip, false);
  assert.equal(pieceWay("locker", "s", 0, both).flip, false);
  assert.equal(pieceWay("locker", "e", 0, both).flip, true);
});

test("a long table is its picture three times along it, and the kettle is a pot stood on a stove", () => {
  assert.equal(pieceWay("long-table", "s", 0, both).times, 3);
  assert.equal(pieceWay("table", "s", 0, both).times, 1);
  const kettle = pieceWay("kettle", "s", 0, both);
  assert.match(kettle.picture.file, /Oven/);
  assert.match(kettle.on.file, /Pot/);
  assert.ok(kettle.lift > 0);
  // Without the pot's picture, there's no kettle from the packs at all.
  assert.equal(pieceWay("kettle", "s", 0, { look: "dark", has: (picture) => !/Pot/.test(picture.file ?? "") }), null);
});

test("without the second pack the first pack's own pieces stand in, and the rest are the game's", () => {
  assert.equal(pieceWay("locker", "s", 0, firstOnly).picture.sheet, "assets");
  assert.equal(pieceWay("plot-table", "s", 0, firstOnly).picture.sheet, "assets");
  assert.equal(pieceWay("chair", "s", 0, firstOnly), null);
  assert.equal(pieceWay("long-table", "s", 0, firstOnly), null);
  // A desk's terminal is the dark one or the light one, by look.
  assert.notEqual(pieceWay("desk", "s", 0, { look: "dark", has: () => true }).picture.id, pieceWay("desk", "s", 0, { look: "light", has: () => true }).picture.id);
  // Bunks and cots are never the packs': people lie in them.
  assert.equal(pieceWay("bunk", "s", 0, both), null);
  assert.equal(pieceWay("cot", "s", 0, both), null);
});

test("a plant is one of a few, the same one every time for the same piece", () => {
  const seen = new Set(Array.from({ length: 40 }, (_, i) => pieceWay("plant", "s", i / 40, both).picture.file));
  assert.ok(seen.size >= 3);
  assert.equal(pieceWay("plant", "s", 0.37, both).picture.file, pieceWay("plant", "s", 0.37, both).picture.file);
  assert.ok(pieceWay("plant", "s", 1, both).picture);
});

test("a picture's soft shadow isn't part of the piece it's stood by", () => {
  // Four pixels across, two down: a solid pixel at (1,0), a half see-through shadow at (3,1).
  const data = new Uint8ClampedArray(4 * 2 * 4);
  data[(0 * 4 + 1) * 4 + 3] = 255;
  data[(1 * 4 + 3) * 4 + 3] = 128;
  assert.deepEqual(solidBox(data, 4, 2), { x0: 1, y0: 0, x1: 1, y1: 0 });
  assert.equal(solidBox(new Uint8ClampedArray(16), 2, 2), null);
});

test("the view draws as it always has until Settings turns the test on", () => {
  assert.equal(pixelArtOn(), false);
  assert.equal(pixelKey(), "drawn");
});

test("the bought pack never goes to GitHub, the public copy or an installer for others", () => {
  const ignored = fs.readFileSync(path.join(root, ".gitignore"), "utf8").split(/\r?\n/).map((line) => line.trim());
  assert.ok(ignored.includes("licensed/"), "licensed/ is in .gitignore");
  const publish = fs.readFileSync(path.join(root, "tools", "publish.mjs"), "utf8");
  const game = publish.match(/const GAME = \[([^\]]*)\]/)[1];
  assert.doesNotMatch(game, /licensed/);
  const files = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).build.files;
  assert.ok(files.every((one) => !one.startsWith("licensed")));
});
