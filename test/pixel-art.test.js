// The pixel-art test view (public/pixel-art.js): its pictures land where the game's tiles are, it's off until Settings
// turns it on, and the bought pack it draws from can never be published.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doorPicture, mapping, pixelArtOn, pixelDoorDepth, pixelKey, standingPoint } from "../public/pixel-art.js";

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
