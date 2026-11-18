// What the game hands the Godot view of a game being played (src/godot-view.js): every level of the place the player's
// at, as the game's own code describes it for its picture, with what the ship's state shows of it. Nothing here depends
// on how the decks are drawn, or on the bought art being on this computer.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-godot-view-"));
// A packs' folder with nothing in it: no picture can be named, and the plain shapes have to do.
const empty = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-godot-no-packs-"));
const had = process.env.GAME_LICENSED_DIR;
process.env.GAME_LICENSED_DIR = empty;

const { godotLevelNow, godotPlace, godotRound } = await import("../src/godot-view.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { startBreach, startFire } = await import("../src/emergencies.js");
const { damagePart, systemsOf } = await import("../src/systems.js");
const { placeLevels, walkView } = await import("../src/walk.js");

const newGame = (seed = 31) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const plain = (value) => JSON.parse(JSON.stringify(value, godotRound));

test("a game's place is handed over whole: every level, as the game describes it for its picture", () => {
  const game = newGame();
  const place = godotPlace(game);
  const levels = placeLevels(game).levels;
  assert.equal(place.ok, true);
  assert.equal(place.place.id, "meridian");
  assert.deepEqual(place.decks.map((deck) => deck.id), Object.keys(levels));
  for (const deck of place.decks) {
    const look = levels[deck.id];
    assert.equal(deck.cols, look.cols);
    assert.equal(deck.lines, look.lines);
    // A letter for every square, a row to a line.
    assert.equal(deck.scene.kinds.length, look.lines);
    assert.ok(deck.scene.kinds.every((row) => row.length === look.cols), "each row is as long as the level is wide");
    assert.equal(deck.scene.heights.length, look.lines);
    assert.deepEqual(deck.areas.map((area) => area.id), look.areas.map((area) => area.id));
    assert.deepEqual(deck.exits.map((exit) => exit.key), look.exits.map((exit) => exit.key));
    assert.deepEqual(deck.things.map((thing) => thing.id), look.things.map((thing) => thing.id));
    assert.deepEqual(deck.here, look.here);
    assert.ok(deck.scene.blocks.length > 100 && deck.scene.ground.length > 1000, "there's a deck to draw");
    assert.ok(deck.scene.lights.length > 0, "and light to draw it by");
  }
  // What's said once, whatever the level.
  assert.ok(place.numbers.cellWidth > 0 && place.numbers.wallHeight > 0);
  assert.equal(place.checks.plates.length, 144);
  assert.equal(place.checks.runs.length, 288);
});

test("without the packs no picture is named, and everything can still be drawn plain", () => {
  const place = godotPlace(newGame());
  assert.deepEqual(place.packs, { isospace: false, interiors: false });
  assert.equal(place.ways.lamp, null);
  assert.ok(Object.values(place.ways.parts).every((way) => way === null));
  for (const deck of place.decks) {
    assert.ok(deck.scene.blocks.every((block) => !block.pic), "no block names a picture");
    assert.ok(deck.things.every((thing) => !thing.pic), "nor any thing");
  }
});

test("the systems' parts, the seats and the beds come with what Godot needs to draw people at them", () => {
  const place = godotPlace(newGame());
  const things = place.decks.flatMap((deck) => deck.things);
  const parts = things.filter((thing) => thing.part);
  assert.ok(parts.length > 50, "the ship's parts are there");
  for (const thing of parts) {
    assert.equal(typeof thing.part.kind, "string");
    assert.ok(["wall", "floor"].includes(thing.part.mount), `${thing.id} is on a wall or the floor`);
    assert.equal(typeof thing.part.works, "boolean");
  }
  const blocks = place.decks.flatMap((deck) => deck.scene.blocks);
  const beds = blocks.filter((block) => block.rest === "bed");
  const seats = blocks.filter((block) => block.rest === "seat");
  assert.ok(beds.length > 10 && seats.length > 10, "there are beds and seats aboard");
  for (const block of beds) {
    assert.ok(block.bed.places.length >= 1, "a bed has somewhere to lie");
    assert.ok(["x", "y"].includes(block.bed.run));
    for (const one of block.bed.places) assert.ok([one.wx, one.wy, one.z].every(Number.isFinite));
  }
  // The ship's stores say how full they are, for the crates stacked in them.
  assert.ok(things.some((thing) => thing.stock?.goods?.length), "a store says what it holds");
});

test("what the ship's state shows of a level is in what's handed over: the dark, a fire, a hole in the hull", () => {
  const game = newGame();
  walkView(game);
  const before = plain(godotLevelNow(game, "deck2"));
  assert.deepEqual(before.scene.fires, []);
  assert.deepEqual(before.scene.breaches, []);
  startFire(game, "meridian", "galley");
  startBreach(game, "meridian", "airlock_port");
  const box = Object.values(systemsOf("meridian").parts).find((part) => part.kind === "junction box" && part.room === "names");
  damagePart(game, "meridian", box.id, "cut");
  const after = plain(godotLevelNow(game, "deck2"));
  assert.ok(after.scene.fires.length > 0 && after.scene.fires.every((fire) => fire.room === "galley"), "the galley burns");
  assert.equal(after.areas.find((area) => area.id === "galley").fire, 1);
  assert.deepEqual(after.scene.breaches.map((breach) => breach.room), ["airlock_port"]);
  assert.equal(after.areas.find((area) => area.id === "airlock_port").breach, true);
  // The box that's cut feeds rooms on this deck: they're dark, and nothing in them lights the floor.
  const dark = after.areas.filter((area) => area.dark);
  assert.ok(dark.length > 0, "rooms have gone dark");
  assert.equal(after.scene.darkAreas.length, dark.length);
  assert.ok(dark.every((area) => area.power === false));
  assert.ok(after.scene.fixtures.some((fixture) => fixture.off), "their lamps are out");
});

test("asking for a level only reads, and a level that isn't there is said to be", () => {
  const game = newGame();
  walkView(game);
  const was = JSON.stringify(game);
  const place = godotPlace(game);
  const one = godotLevelNow(game, "deck1");
  assert.equal(JSON.stringify(game), was, "the game is as it was");
  assert.deepEqual(plain(one), plain(place.decks.find((deck) => deck.id === "deck1")));
  assert.throws(() => godotLevelNow(game, "deck9"), /isn't part of this place/);
});

test.after(() => {
  if (had === undefined) delete process.env.GAME_LICENSED_DIR;
  else process.env.GAME_LICENSED_DIR = had;
});
