// The Meridian's decks as furnished (step 2 of the furniture plan): every deck has its
// furniture, the beds and tables that were drawn as consoles are real ones, and nothing stands where it shouldn't or
// cuts anyone off. Reads the game's own maps and changes nothing.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-furnished-"));

const { FURNITURE_BY_ID, squaresOf } = await import("../public/furniture.js");
const { MAP_FILE_PROBLEMS, WORLD_MAPS } = await import("../src/world.js");
const { canStand, mapFor } = await import("../src/walk.js");
const { deckProblems } = await import("../src/map-editor.js");

const decks = () => WORLD_MAPS.meridian.levels;
// A window or a screen is on a wall square, and belongs to the room below it.
// What's in a room: for something on a wall, the room whose floor is in front of it, below it or to its right.
const inRoom = (level, room, kind) => level.furniture.filter((piece) => piece.kind === kind && (FURNITURE_BY_ID[kind].wall ? level.areaAt(piece.x, piece.y + 1) === room || level.areaAt(piece.x + 1, piece.y) === room : level.areaAt(piece.x, piece.y) === room));
const seatsIn = (level, room) => level.furniture.filter((piece) => FURNITURE_BY_ID[piece.kind].seat && level.areaAt(piece.x, piece.y) === room);

test("every deck is furnished, and the game finds nothing wrong with any of it", () => {
  assert.deepEqual(MAP_FILE_PROBLEMS, []);
  for (const [id, file] of Object.entries(decks())) {
    assert.ok((file.furniture ?? []).length >= 50, `${id} has ${(file.furniture ?? []).length} pieces`);
    assert.deepEqual(deckProblems(file, id), [], `${id} is sound`);
  }
});

test("the beds and tables that were drawn as consoles are cots, bunks and tables now", () => {
  const map = mapFor("meridian");
  const deck1 = map.levels.deck1;
  const deck2 = map.levels.deck2;
  assert.ok(inRoom(deck2, "medbay", "cot").length >= 20, "the medbay has its cots");
  assert.ok(inRoom(deck2, "bunks", "bunk").length >= 20, "the Hot Bunks have their bunks");
  assert.ok(inRoom(deck2, "overflow", "cot").length >= 20, "the Overflow has its cots");
  assert.ok(inRoom(deck2, "mess", "long-table").length >= 4 && inRoom(deck2, "mess", "chair").length >= 8, "the Long Mess has tables and chairs");
  assert.ok(inRoom(deck1, "wardroom", "long-table").length >= 2, "the wardroom has its table");
  assert.ok(inRoom(deck1, "quiet", "bench").length >= 4, "the Quiet Room has its benches");
  assert.ok(inRoom(deck1, "bridge", "window").length >= 6, "the bridge has its forward windows");
  assert.ok(seatsIn(deck1, "bridge").length >= 10, "the bridge has seats at its consoles");
  // A bed is somewhere to lie: its squares can be stood on, unlike a table's.
  for (const piece of inRoom(deck2, "medbay", "cot")) for (const [x, y] of squaresOf(piece)) assert.ok(canStand(deck2, x, y), `cot square ${x},${y}`);
  const table = inRoom(deck2, "mess", "long-table")[0];
  assert.ok(squaresOf(table).every(([x, y]) => !canStand(deck2, x, y)));
});

test("nobody's post and no stair is under furniture that's in the way", () => {
  for (const level of Object.values(mapFor("meridian").levels)) {
    for (const piece of level.furniture.filter((one) => FURNITURE_BY_ID[one.kind].blocks)) {
      for (const [x, y] of squaresOf(piece)) {
        assert.ok(!level.homes.some((home) => home.x === x && home.y === y), `${piece.kind} at ${piece.x},${piece.y} is on someone's post`);
        assert.ok(!level.exits.some((exit) => Math.abs(exit.x - x) + Math.abs(exit.y - y) <= 1), `${piece.kind} at ${piece.x},${piece.y} is in front of a stair`);
      }
    }
  }
});
