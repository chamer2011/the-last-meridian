// Furniture (public/furniture.js): pieces kept in a deck's own file, read and written by src/tiled.js, in the way or
// not (src/walk.js), drawn as what they are by the room's picture (public/iso.js), with things drawn as the piece their
// name says, and put down, turned and taken away in the map editor (src/map-editor.js). Everything here works on copies
// of the maps and the life files, never on the game's own.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-furniture-"));
const world = new URL("../world/", import.meta.url);
fs.cpSync(fs.realpathSync(new URL("maps", world)), path.join(tmp, "maps"), { recursive: true });
fs.cpSync(fs.realpathSync(new URL("life", world)), path.join(tmp, "life"), { recursive: true });
process.env.GAME_DATA_DIR = path.join(tmp, "data");
process.env.GAME_MAPS_DIR = path.join(tmp, "maps");
process.env.GAME_LIFE_DIR = path.join(tmp, "life");

// Deck 1's copy gets a table and a chair in the bridge, and a window in its forward wall, before the game reads it.
const deckFile = (deck) => path.join(tmp, "maps", "meridian", `${deck}.tmj`);
const square = (x, y) => ({ x: ((x + 0.5) / 2) * 64, y: (y + 0.5) * 64 });
const piece = (id, kind, x, y, facing) => ({ id, name: kind, type: "Furniture", ...square(x, y), width: 0, height: 0, rotation: 0, point: true, visible: true, properties: facing ? [{ name: "facing", type: "string", value: facing }] : [] });
const withFurniture = (file, objects, extra = (json) => json) => {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  json.layers.push({ id: 90, name: "Furniture", type: "objectgroup", visible: true, opacity: 1, x: 0, y: 0, objects });
  return JSON.stringify(extra(json));
};
fs.writeFileSync(deckFile("deck1"), withFurniture(deckFile("deck1"), [piece(9001, "table", 30, 9, "s"), piece(9002, "chair", 30, 10, "n"), piece(9003, "window", 24, 1)]));

const { FURNITURE, footprintOf, looksOf, squaresOf } = await import("../public/furniture.js");
const { readMapFile, roomFromMap, roomToMap } = await import("../src/tiled.js");
const { MAP_FILE_PROBLEMS, WORLD_MAPS } = await import("../src/world.js");
const { canStand, compileLevel, mapFor, walkView } = await import("../src/walk.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const editor = await import("../src/map-editor.js");
const { buildScene } = await import("../public/iso.js");

const parcel = (doc) => ({ grid: doc.grid, people: doc.people, things: doc.things, exits: doc.exits, start: doc.start, writing: doc.writing, labels: doc.labels, areas: doc.areas, furniture: doc.furniture, spots: doc.spots });
const problemsOf = (objects, extra) => {
  const file = path.join(tmp, "maps", "meridian", "trial.tmj");
  fs.writeFileSync(file, withFurniture(deckFile("deck2"), objects, extra));
  try {
    return roomFromMap(readMapFile(file));
  } finally {
    fs.rmSync(file);
  }
};

test("every piece of furniture has a name, says what it is, and takes the floor its size says, turned the way it faces", () => {
  assert.ok(FURNITURE.length >= 15);
  for (const kind of FURNITURE) assert.ok(kind.id && kind.name && kind.about && (kind.wall || kind.size), kind.id);
  assert.deepEqual(footprintOf({ kind: "bunk", facing: "n" }), { across: 2, down: 2 });
  assert.deepEqual(footprintOf({ kind: "bunk", facing: "e" }), { across: 4, down: 1 });
  assert.deepEqual(footprintOf({ kind: "chair", facing: "w" }), { across: 1, down: 1 });
  assert.deepEqual(footprintOf({ kind: "long-table", facing: "s" }), { across: 4, down: 1 });
  assert.deepEqual(squaresOf({ kind: "table", x: 10, y: 3, facing: "s" }), [[10, 3], [11, 3]]);
  // A thing is drawn as what its name says, or what its looks line says, and a box when neither says anything.
  assert.equal(looksOf({ name: "The captain's chair" }), "command-chair");
  assert.equal(looksOf({ name: "The plot table" }), "plot-table");
  assert.equal(looksOf({ name: "Cracked repeater" }), "screen");
  assert.equal(looksOf({ name: "Ready room locker" }), "locker");
  assert.equal(looksOf({ name: "Soup kettle" }), "kettle");
  assert.equal(looksOf({ name: "Data chip in the comms tray" }), null);
  assert.equal(looksOf({ name: "A photograph in a rack frame" }), null);
  assert.equal(looksOf({ name: "The plot table", looks: "box" }), null);
  assert.equal(looksOf({ name: "A crate of tins", looks: "shelf" }), "shelf");
  assert.equal(looksOf({ name: "Anything", looks: "window" }), null, "a thing stands on the floor, so it can't be a window");
});

test("a deck's furniture comes from its own file, and what's wrong with a piece is said plainly", () => {
  assert.deepEqual(WORLD_MAPS.meridian.levels.deck1.furniture, [{ kind: "window", x: 24, y: 1, facing: "s" }, { kind: "table", x: 30, y: 9, facing: "s" }, { kind: "chair", x: 30, y: 10, facing: "n" }]);
  assert.deepEqual(MAP_FILE_PROBLEMS, []);
  const { level, problems } = problemsOf([piece(1, "sofa", 30, 9), piece(2, "locker", 0, 0), piece(3, "table", 40, 9), piece(4, "table", 41, 9), piece(5, "chair", 44, 12, "up")], (json) => {
    const things = json.layers.find((layer) => layer.name === "People and things");
    const thing = things.objects.find((one) => one.properties?.some((prop) => prop.name === "item" || prop.name === "look"));
    thing.properties.push({ name: "looks", type: "string", value: "window" });
    return json;
  });
  const said = problems.join("\n");
  assert.match(said, /furniture called sofa isn't one the game knows/);
  assert.match(said, /the locker at 0,0 stands on something that isn't floor/);
  assert.match(said, /is on top of the table at 40,9/);
  assert.match(said, /faces up, and it can face n, e, s or w/);
  assert.match(said, /is to look like window, which isn't a piece of furniture that stands on the floor/);
  // The rest of it is still read: the pieces the game knows are all there, the one turned the wrong way facing south.
  assert.deepEqual(level.furniture.map((one) => one.kind), ["locker", "table", "table", "chair"]);
  assert.equal(level.furniture.at(-1).facing, "s");
});

test("a table is in the way and a chair isn't, and nobody's post is ever under something in the way", () => {
  const level = mapFor("meridian").levels.deck1;
  assert.equal(canStand(level, 30, 9), false);
  assert.equal(canStand(level, 31, 9), false);
  assert.equal(canStand(level, 30, 10), true);
  assert.equal(canStand(level, 32, 9), true);
  const file = WORLD_MAPS.meridian.levels.deck1;
  const post = Object.entries(file.people)[0];
  const at = file.plan.findIndex((row) => row.includes(post[0]));
  const x = file.plan[at].indexOf(post[0]);
  const compiled = compileLevel("deck1", { ...file, furniture: [{ kind: "locker", x, y: at, facing: "s" }] });
  assert.equal(canStand(compiled, x, at), true, `${post[1].id} can still stand at their post`);
});

test("the room shows the furniture, and things that look like furniture say so, turned away from a wall or toward the bow", () => {
  const game = createGameFromDraft(randomDraft({ seed: 31, archetype: "officer" }));
  const view = walkView(game);
  assert.ok(view.furniture.some((one) => one.kind === "table" && one.x === 30 && one.y === 9));
  const chair = view.things.find((thing) => thing.name === "The captain's chair");
  assert.equal(chair.looks, "command-chair");
  assert.ok(["n", "e", "s", "w"].includes(chair.facing));
  assert.equal(view.things.find((thing) => thing.name === "The plot table").looks, "plot-table");
  assert.equal(view.things.find((thing) => /comms tray/.test(thing.name)).looks, undefined);
  // The picture of the room has a block for each piece, the window on the wall's face toward the room, light from the
  // plot table, and no lamp on the wall where the window is.
  const level = mapFor("meridian").levels.deck1;
  const scene = buildScene({ cols: level.width, lines: level.height, layers: level.layers, labels: level.labels, colors: level.colors, things: view.things, exits: level.exits, people: [], here: { id: "deck1" }, furniture: view.furniture });
  const pieces = scene.blocks.filter((block) => block.style === "piece");
  assert.ok(pieces.some((one) => one.kind === "table" && one.shadow));
  assert.ok(pieces.some((one) => one.kind === "command-chair"));
  assert.ok(pieces.some((one) => one.kind === "plot-table"));
  const window = pieces.find((one) => one.kind === "window");
  assert.equal(window.face, "s");
  assert.ok(!scene.fixtures.some((one) => one.x === 24 && one.y === 1));
  assert.ok(scene.lights.some((one) => one.color === "#7dffa8"));
});

test("the map editor puts furniture down, turns it and keeps it, and says what's wrong with where it is", () => {
  const doc = editor.deckForEditing("meridian", "deck1");
  assert.equal(doc.furniture.length, 3);
  // Wrong: a table in a wall, a window on the floor, two on one square, and a locker on someone's post.
  const post = doc.people[0];
  const wrong = { ...parcel(doc), furniture: [...doc.furniture, { kind: "table", x: 18, y: 1, facing: "s" }, { kind: "window", x: 32, y: 12 }, { kind: "barrel", x: 31, y: 9, facing: "s" }, { kind: "locker", x: post.x, y: post.y, facing: "s" }] };
  const said = editor.tryDeck("meridian", "deck1", wrong, { whole: false }).problems.map((one) => one.words).join("\n");
  assert.match(said, /The table is standing on something that isn't floor/);
  assert.match(said, /The window has to hang on a wall/);
  assert.match(said, /The barrel is on top of the table/);
  assert.match(said, new RegExp(`The locker is on ${post.name}'s post`));
  assert.throws(() => editor.tryDeck("meridian", "deck1", { ...parcel(doc), furniture: [{ kind: "sofa", x: 30, y: 12 }] }, { whole: false }), /isn't one the game knows/);
  const locker = doc.things.findIndex((thing) => thing.name === "Ready room locker");
  assert.throws(() => editor.tryDeck("meridian", "deck1", { ...parcel(doc), things: doc.things.map((thing, i) => (i === locker ? { ...thing, looks: "window" } : thing)) }, { whole: false }), /can't be drawn as that/);
  // Right: a long table in the bridge, the chair turned, and the locker drawn as shelves; it's kept and reads back.
  const changed = { ...parcel(doc), furniture: [...doc.furniture.map((one) => (one.kind === "chair" ? { ...one, facing: "e" } : one)), { kind: "long-table", x: 20, y: 13, facing: "s" }], things: doc.things.map((thing, i) => (i === locker ? { ...thing, looks: "shelf", facing: "w" } : thing)) };
  const result = editor.tryDeck("meridian", "deck1", changed, { keep: true, whole: false });
  assert.equal(result.kept, true, JSON.stringify(result.problems));
  const back = roomFromMap(readMapFile(deckFile("deck1")), { rooms: new Set(["deck1", "deck2", "deck3"]) }).level;
  assert.deepEqual(back.furniture, [{ kind: "window", x: 24, y: 1, facing: "s" }, { kind: "table", x: 30, y: 9, facing: "s" }, { kind: "chair", x: 30, y: 10, facing: "e" }, { kind: "long-table", x: 20, y: 13, facing: "s" }]);
  const shelves = Object.values(back.things).find((thing) => thing.name === "Ready room locker");
  assert.equal(shelves.looks, "shelf");
  assert.equal(shelves.facing, "w");
  // The file keeps the furniture as Tiled objects on a layer of their own, which Tiled itself can open.
  const layer = JSON.parse(fs.readFileSync(deckFile("deck1"), "utf8")).layers.find((one) => one.name === "Furniture");
  assert.ok(layer.objects.every((one) => one.type === "Furniture" && one.point));
  // Taking it all away takes the layer away too.
  const cleared = editor.tryDeck("meridian", "deck1", { ...parcel(editor.deckForEditing("meridian", "deck1")), furniture: [] }, { keep: true, whole: false });
  assert.equal(cleared.kept, true);
  assert.equal(JSON.parse(fs.readFileSync(deckFile("deck1"), "utf8")).layers.some((one) => one.name === "Furniture"), false);
});

test("a deck written out with furniture reads back the same", () => {
  const level = { ...WORLD_MAPS.meridian.levels.deck2, furniture: [{ kind: "bunk", x: 20, y: 5, facing: "e" }, { kind: "kettle", x: 30, y: 8, facing: "s" }] };
  const figures = Object.fromEntries(["person", "thing", "exit", "start"].map((kind) => [kind, { gid: 1, width: 128, height: 160 }]));
  const map = roomToMap(level, { gidOf: () => 1, figures });
  const layer = map.layers.find((one) => one.name === "Furniture");
  assert.deepEqual(layer.objects.map((one) => [one.name, one.properties[0].value]), [["bunk", "e"], ["kettle", "s"]]);
  assert.equal(map.nextlayerid, Math.max(...map.layers.map((one) => one.id)) + 1);
});
