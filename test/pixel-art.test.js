// The pixel-art test view (public/pixel-art.js): its pictures land where the game's tiles are, it's off until Settings
// turns it on, and the bought pack it draws from can never be published.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PACK_FIGURE, doorPicture, lightDim, machineAt, mapping, packBed, pieceWay, pixelArtOn, pixelDoorDepth, pixelKey, setLightDim, solidBox, standingPoint, steelOf } from "../public/pixel-art.js";
import { figureUnit, sittingIn } from "../public/iso.js";
import { setPackFurniture } from "../public/furniture.js";

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

test("a long table is its picture four times along it, and the kettle is a pot stood on a stove", () => {
  // Four, since the packs' pieces are drawn at their own size: a table of theirs is half a tile, and a long table two.
  assert.equal(pieceWay("long-table", "s", 0, both).times, 4);
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
  // A bunk is the first pack's, with whoever's asleep drawn into it; a cot is the second pack's plain bed, and without
  // that pack still the game's own.
  assert.equal(pieceWay("bunk", "s", 0, firstOnly).picture.sheet, "assets");
  assert.match(pieceWay("cot", "s", 0, both).picture.file, /Bed_G_4/);
  assert.equal(pieceWay("cot", "s", 0, firstOnly), null);
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

test("wood and orange turn to the ship's blue-grey, and nothing else changes colour", () => {
  const top = steelOf(224, 130, 58); // an orange table top
  const wood = steelOf(138, 84, 52); // a darker wood
  for (const one of [top, wood]) assert.ok(one && one[2] > one[0] + 15 && one[1] > one[0], `blue-grey: ${one}`);
  // What was lighter is still lighter, and nothing's brighter than it was.
  assert.ok(top[0] + top[1] + top[2] > wood[0] + wood[1] + wood[2]);
  assert.ok(Math.max(...top) < 224 && Math.max(...wood) < 138);
  for (const [name, colour] of [["steel grey", [120, 124, 128]], ["red", [200, 40, 40]], ["hazard yellow", [240, 214, 40]], ["green", [70, 160, 80]], ["blue", [80, 120, 200]], ["white", [250, 250, 250]], ["a dark outline", [22, 14, 10]]]) assert.equal(steelOf(...colour), null, name);
});

test("a room can be in the Light look on a Dark ship, toned down by as much as its place says", () => {
  setLightDim(0.65);
  assert.equal(lightDim(), 0.65);
  setLightDim(5);
  assert.equal(lightDim(), 1);
  setLightDim(0.1);
  assert.equal(lightDim(), 0.35);
  setLightDim("nonsense");
  assert.equal(lightDim(), 1);
  // A piece with a picture for each look says which one it gave, so a Light one can be toned down with its room.
  const has = () => true;
  assert.equal(pieceWay("desk", "s", 0, { look: "light", has }).look, "light");
  assert.equal(pieceWay("desk", "s", 0, { look: "dark", has }).look, null);
  assert.equal(pieceWay("plot-table", "s", 0, { look: "light", has }).look, null);
});

test("the packs' furniture is drawn at its own size, and people as much smaller beside it", () => {
  // The game enlarged the packs' furniture by 1.7 / 1.375 to fit its people; now the people are that much smaller.
  assert.ok(Math.abs(PACK_FIGURE - 1.375 / 1.7) < 1e-9);
  assert.ok(PACK_FIGURE > 0.8 && PACK_FIGURE < 0.82);
  // Until the test view is on, people are the game's own size.
  assert.equal(figureUnit(64), 64);
  // A bench is its picture three times along it at that size, so the three meet.
  assert.equal(pieceWay("bench", "s", 0, { look: "dark", has: () => true }).times, 3);
});

test("a bank of consoles on the plan is a control console to each two squares, and a terminal on an odd one", () => {
  const bank = (cells) => (x, y) => y === 3 && cells.includes(x);
  const five = bank([4, 5, 6, 7, 8]);
  assert.deepEqual([4, 5, 6, 7, 8].map((x) => machineAt(x, 3, five).draw), ["plan-console", null, "plan-console", null, "plan-terminal"]);
  assert.equal(machineAt(4, 3, five).across, 2);
  assert.equal(machineAt(8, 3, five).across, 1);
  assert.deepEqual([machineAt(6, 3, five).start, machineAt(6, 3, five).end], [4, 8]);
  // A square on its own is a terminal, and two are one console.
  assert.equal(machineAt(9, 3, bank([9])).draw, "plan-terminal");
  assert.deepEqual([10, 11].map((x) => machineAt(x, 3, bank([10, 11])).draw), ["plan-console", null]);
  // The packs have a picture for each.
  assert.ok(pieceWay("plan-console", "s", 0, both) && pieceWay("plan-terminal", "s", 0, both));
  // A run with more of the same above or below it is one big machine, like the ship's boat: the game draws it itself.
  const boat = (bx, by) => (by === 3 && bx >= 5 && bx <= 6) || (by === 4 && bx >= 4 && bx <= 7);
  assert.equal(machineAt(5, 3, boat).block, true);
  assert.equal(machineAt(4, 4, boat).block, true);
  assert.equal(machineAt(4, 4, boat).draw, null);
  assert.equal(machineAt(4, 3, five).block, undefined);
});

test("a bunk is two of the pack's end to end, turned to run the way the game's bunk does", () => {
  // The pack's bunk is drawn along the plan's rows: a bunk running down the columns (facing north or south) has it
  // turned round, and one along the rows hasn't.
  const down = pieceWay("bunk", "s", 0, both);
  assert.equal(down.times, 2);
  assert.equal(down.flip, true);
  assert.equal(pieceWay("bunk", "n", 0, both).flip, true);
  assert.equal(pieceWay("bunk", "e", 0, both).flip, false);
  // Any other piece with one picture is the other way about: turned round to face east or west.
  assert.equal(pieceWay("plot-table", "s", 0, both).flip, false);
  assert.equal(pieceWay("plot-table", "e", 0, both).flip, true);
  // Until the view is on, the game's own bunk and cot are drawn, sleepers and all; and the wall lamp has its picture.
  assert.equal(packBed({ kind: "bunk", facing: "s", x0: 4, y0: 2, x1: 5, y1: 4 }), null);
  assert.equal(packBed({ kind: "cot", facing: "s", x0: 4, y0: 2, x1: 5, y1: 4 }), null);
  assert.ok(pieceWay("plan-lamp", "s", 0, both));
});

test("people lie in the packs' beds: one in a bed, two in a bunk or a wide bed, their heads at the far end of it", () => {
  const bed = (id, across, down, high) => ({ id, name: id, pack: true, what: "bed", bed: true, size: [across * 0.5, down], blocks: false, high });
  setPackFurniture([bed("interiors/Bedroom/Bed_J_4", 2, 1, 0.55), bed("interiors/Bedroom/Bed_C_4", 2, 1, 0.15), bed("interiors/Bedroom/Bed_M_4", 3, 2, 0.55), bed("isospace/bunk", 2, 1, 0.65), bed("isospace/pod", 1, 1, 0.45), { id: "interiors/Chairs/GChair_9", name: "chair", pack: true, what: "seat", seat: true, size: [0.5, 1], blocks: false, high: 0.5 }]);
  try {
    // A bed as its picture is drawn runs down the plan's columns, with its pillow at the far (north) end.
    const down = packBed({ kind: "interiors/Bedroom/Bed_J_4", facing: "s", x0: 4, y0: 2, x1: 5, y1: 3 });
    assert.equal(down.run, "y");
    assert.equal(down.places.length, 1);
    assert.ok(down.places[0].wy < 2.5 && down.places[0].wy > 2 && down.places[0].wx === 4.5);
    // Turned to face east or west, it runs along the rows, its pillow at the far (west) end.
    const along = packBed({ kind: "interiors/Bedroom/Bed_J_4", facing: "e", x0: 4, y0: 2, x1: 5, y1: 3 });
    assert.equal(along.run, "x");
    assert.ok(along.places[0].wx < 4.5 && along.places[0].wy === 2.5);
    // The pack's bunk is drawn along the rows, so it's the other way about; it takes two, and so does the wide bed.
    assert.equal(packBed({ kind: "isospace/bunk", facing: "s", x0: 4, y0: 2, x1: 5, y1: 3 }).run, "x");
    assert.equal(packBed({ kind: "isospace/bunk", facing: "e", x0: 4, y0: 2, x1: 5, y1: 3 }).run, "y");
    assert.equal(packBed({ kind: "isospace/bunk", facing: "s", x0: 4, y0: 2, x1: 5, y1: 3 }).places.length, 2);
    assert.equal(packBed({ kind: "interiors/Bedroom/Bed_M_4", facing: "s", x0: 4, y0: 2, x1: 5.5, y1: 4 }).places.length, 2);
    assert.equal(packBed({ kind: "isospace/pod", facing: "s", x0: 4, y0: 2, x1: 4.5, y1: 3 }).places.length, 1);
    // Until the packs draw it, it's a plain shape, and whoever's in it lies on top of that under a blanket.
    assert.equal(down.pictured, false);
    assert.equal(down.places[0].z, 0.55);
    assert.equal(down.blankets, true);
    // A seat of the packs is no bed.
    assert.equal(packBed({ kind: "interiors/Chairs/GChair_9", facing: "s", x0: 4, y0: 2, x1: 4.5, y1: 3 }), null);
    assert.equal(packBed(null), null);
    // Awake on it, they sit on the side of it the camera sees: the east side of one that runs down the columns.
    const sitting = sittingIn({ kind: "interiors/Bedroom/Bed_J_4", facing: "s", x0: 4, y0: 2, x1: 5, y1: 3 }, 4.25, 2.5);
    assert.ok(sitting.pose.seated && sitting.wx > 4.5 && sitting.over === null);
    assert.ok(sittingIn({ kind: "interiors/Bedroom/Bed_J_4", facing: "e", x0: 4, y0: 2, x1: 5, y1: 3 }, 4.25, 2.5).wy > 2.5);
  } finally {
    setPackFurniture([]);
  }
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
