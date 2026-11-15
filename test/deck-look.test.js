// The map editor's picture of the deck it's changing (src/map-editor.js, deckLook; src/walk.js, draftLook): the game
// describes a deck that isn't saved the way it describes any level for its picture, quickly, and without writing
// anything. On copies of the maps and the life files, never the game's own.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-deck-look-"));
const world = new URL("../world/", import.meta.url);
fs.cpSync(fs.realpathSync(new URL("maps", world)), path.join(tmp, "maps"), { recursive: true });
fs.cpSync(fs.realpathSync(new URL("life", world)), path.join(tmp, "life"), { recursive: true });
process.env.GAME_DATA_DIR = path.join(tmp, "data");
process.env.GAME_MAPS_DIR = path.join(tmp, "maps");
process.env.GAME_LIFE_DIR = path.join(tmp, "life");

const editor = await import("../src/map-editor.js");
const { placeLevels } = await import("../src/walk.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { buildScene } = await import("../public/iso.js");
const { asPixelArt, pixelArtOn, pixelKey } = await import("../public/pixel-art.js");

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const deckFile = (deck) => path.join(tmp, "maps", "meridian", `${deck}.tmj`);
// A free square of floor on the deck, with another to its right, away from everything on it.
function freeFloor(doc) {
  const used = new Set([...(doc.furniture ?? []), ...(doc.things ?? []), ...(doc.people ?? []), ...(doc.exits ?? [])].flatMap((one) => [-2, -1, 0, 1, 2].flatMap((dx) => [-1, 0, 1].map((dy) => `${one.x + dx},${one.y + dy}`))));
  for (let y = 2; y < doc.height - 2; y += 1) {
    for (let x = 2; x < doc.width - 3; x += 1) {
      const free = (xx, yy) => doc.floors.includes(doc.grid[yy][xx]) && !used.has(`${xx},${yy}`);
      if (free(x, y) && free(x + 1, y) && free(x, y + 1) && free(x + 1, y + 1)) return { x, y };
    }
  }
  throw new Error("no free floor on the deck");
}

test("an unchanged deck is described for its picture as the game describes it", () => {
  const game = createGameFromDraft(randomDraft(), "deck look");
  const levels = placeLevels(game).levels;
  for (const deck of ["deck1", "deck2", "deck3"]) {
    const look = editor.deckLook("meridian", deck, editor.deckForEditing("meridian", deck));
    const real = levels[deck];
    // The squares, the words painted on them, the colours and the look are the same thing.
    for (const key of ["cols", "lines", "layers", "labels", "colors", "look", "furniture"]) assert.deepEqual(look[key], real[key], `${deck}: ${key}`);
    assert.deepEqual(look.here.deck, real.here.deck, deck);
    assert.deepEqual(look.areas.map((area) => [area.id, area.x, area.y, area.w, area.h]), real.areas.map((area) => [area.id, area.x, area.y, area.w, area.h]), deck);
    assert.deepEqual(look.exits.map((exit) => [exit.x, exit.y, exit.label]), real.exits.filter((exit) => !exit.inner).map((exit) => [exit.x, exit.y, exit.label]), deck);
    // Nothing in a draft is dark, and it has only the things its own file has: the game stands the rest in itself.
    assert.ok(look.areas.every((area) => area.dark === false), deck);
    assert.ok(look.things.length > 0 && look.things.length <= real.things.length, deck);
    for (const thing of look.things) assert.ok(real.things.some((one) => one.id === thing.id && one.x === thing.x && one.y === thing.y && one.looks === thing.looks), `${deck}: ${thing.name}`);
    // Where the people drawn on the deck stand.
    assert.ok(look.posts.length > 0 && look.posts.every((post) => Number.isInteger(post.x) && Number.isInteger(post.y) && post.id), deck);
    // And the room's picture can be made from it.
    const scene = buildScene(look);
    assert.ok(scene.blocks.length > 100, deck);
    assert.equal(scene.blocks.filter((block) => block.style === "piece").length >= look.furniture.filter((piece) => !["wall-screen", "window"].includes(piece.kind)).length * 0.9, true, deck);
  }
});

test("a change in the editor shows in the description, and nothing is saved", () => {
  const before = fs.readFileSync(deckFile("deck1"));
  const doc = editor.deckForEditing("meridian", "deck1");
  const at = freeFloor(doc);
  const was = editor.deckLook("meridian", "deck1", doc);
  // A table put down, and a square of floor painted into a wall.
  const grid = doc.grid.map((row, y) => (y === at.y + 1 ? [...row].map((ch, x) => (x === at.x + 1 ? "#" : ch)).join("") : row));
  const changed = { ...doc, grid, furniture: [...doc.furniture, { kind: "plot-table", x: at.x, y: at.y, facing: "e" }] };
  const look = editor.deckLook("meridian", "deck1", changed);
  assert.equal(look.furniture.length, was.furniture.length + 1);
  assert.deepEqual(look.furniture.filter((piece) => piece.x === at.x && piece.y === at.y), [{ kind: "plot-table", x: at.x, y: at.y, facing: "e" }]);
  assert.notEqual(look.layers.walls[at.y + 1][at.x + 1], " ");
  assert.equal(was.layers.walls[at.y + 1][at.x + 1], " ");
  assert.notEqual(look.layers.floor[at.y + 1][at.x + 1], was.layers.floor[at.y + 1][at.x + 1]);
  // The picture's scene has the table where it was put.
  const table = buildScene(look).blocks.find((block) => block.style === "piece" && block.kind === "plot-table" && block.x0 === at.x * 0.5 && block.y0 === at.y);
  assert.ok(table);
  // The deck's file is as it was, to the byte, and the game's own deck too.
  assert.deepEqual(fs.readFileSync(deckFile("deck1")), before);
  assert.equal(editor.deckForEditing("meridian", "deck1").furniture.length, doc.furniture.length);
  assert.equal(fs.existsSync(path.join(tmp, "data", "map-backups")), false);
});

test("it's quick enough to ask for after every change", () => {
  const doc = editor.deckForEditing("meridian", "deck2");
  editor.deckLook("meridian", "deck2", doc);
  const began = performance.now();
  for (let i = 0; i < 10; i += 1) editor.deckLook("meridian", "deck2", doc);
  const each = (performance.now() - began) / 10;
  assert.ok(each < 150, `${Math.round(each)} ms a description`);
});

test("what can't be a deck is refused in plain words", () => {
  const doc = editor.deckForEditing("meridian", "deck3");
  assert.throws(() => editor.deckLook("meridian", "deck3", { ...doc, grid: doc.grid.slice(1) }), /isn't the size it was/);
  assert.throws(() => editor.deckLook("meridian", "deck3", { ...doc, furniture: [...doc.furniture, { kind: "a throne", x: 3, y: 3, facing: "s" }] }), /isn't one the game knows/);
  assert.throws(() => editor.deckLook("meridian", "deck9", doc));
  assert.throws(() => editor.deckLook("nowhere", "deck1", doc));
});

test("drawing in the packs' pictures for a while leaves the view as it was", () => {
  // No pictures are loaded here, so nothing is drawn with them either way; what's checked is that the game's own view
  // isn't switched over, during or after.
  assert.equal(pixelArtOn(), false);
  assert.equal(asPixelArt(() => 7), 7);
  assert.equal(asPixelArt(() => pixelKey()), "drawn");
  assert.throws(() => asPixelArt(() => { throw new Error("stopped"); }), /stopped/);
  assert.equal(pixelArtOn(), false);
  assert.equal(pixelKey(), "drawn");
});
