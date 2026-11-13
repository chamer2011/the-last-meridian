// One place's map at a time: the server keeps built only the place the player's at, and the ship, whose own rules go on
// while they're away, letting a place go once they've left it and building it again exactly the same if it's needed;
// asking where someone is builds only the places they could be at; and the page is given every level of the place at
// once, described for its picture as the level the player's on is (src/walk.js, placeLevels), to draw the whole place
// behind its loading screen (public/iso.js). Nothing here depends on how the decks are drawn, which the owner may change.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-one-map-"));
process.env.GAME_DATA_DIR = dataDir;

const { keepOnly, mapFor, placeLevels, placesBuilt, walkView } = await import("../src/walk.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { whereNow } = await import("../src/life.js");
const { travel } = await import("../src/rules.js");
const { LOCATIONS } = await import("../src/data.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
// What the picture of a level is drawn from (public/iso.js, buildScene and sceneIdOf).
const PICTURE = ["cols", "lines", "layers", "labels", "colors", "look", "here", "things", "furniture", "exits", "room", "areas", "power", "growing", "wear", "marks"];
const levelOfView = (view) => view.here.deck?.id ?? view.here.id;
// Everything a place's map stands where: its levels' things, and the squares nobody can walk on (parts on the floor).
const standing = (map) => Object.values(map.levels).map((level) => [level.id, level.things.map((thing) => `${thing.id}@${thing.x},${thing.y}`).sort(), [...level.solid].sort()]);

test("the level the player's on is described for its picture the same way whichever way it's asked for", () => {
  const game = newGame();
  const view = walkView(game);
  const all = placeLevels(game);
  const mine = all.levels[levelOfView(view)];
  assert.ok(mine, "the player's own level is among the place's levels");
  for (const field of PICTURE) assert.deepEqual(mine[field], view[field], field);
  // The walk view says which place it's of, and how many times its rooms have been read, which the page loads by.
  assert.equal(view.place.id, "meridian");
  assert.equal(view.place.name, LOCATIONS.meridian.name);
  assert.ok(Number.isFinite(view.place.drawn));
  assert.deepEqual(all.place, view.place);
});

test("every level of the place comes at once, the ship's decks and a port's rooms, each with all its picture needs", () => {
  const game = newGame();
  walkView(game);
  const ship = placeLevels(game);
  assert.deepEqual(Object.keys(ship.levels), Object.keys(mapFor("meridian").levels));
  assert.ok(Object.keys(ship.levels).length > 1, "the ship has more than one deck");
  for (const [id, level] of Object.entries(ship.levels)) {
    assert.equal(levelOfView(level), id);
    assert.equal(level.layers.floor.length, level.lines);
    assert.ok(level.areas.length, `${id} is a deck with rooms drawn on it`);
    assert.ok(Array.isArray(level.things) && Array.isArray(level.exits) && Array.isArray(level.furniture));
  }
  assert.equal(ship.name, LOCATIONS.meridian.name);
  // Across to Haven, with the ship docked there: its rooms, one level each.
  game.ship.at = "haven";
  travel(game, "haven");
  walkView(game);
  const haven = placeLevels(game);
  assert.equal(haven.place.id, "haven");
  assert.equal(haven.name, LOCATIONS.haven.name);
  assert.deepEqual(Object.keys(haven.levels), Object.keys(mapFor("haven").levels));
  for (const [id, level] of Object.entries(haven.levels)) {
    assert.equal(levelOfView(level), id);
    assert.equal(level.room?.dark !== undefined, true, `${id} says whether it's dark`);
  }
});

test("only the place the player's at stays built beside the ship, and a place they've left is let go of", () => {
  const game = newGame();
  walkView(game);
  assert.deepEqual(placesBuilt(), ["meridian"]);
  const ship = mapFor("meridian");
  game.ship.at = "haven";
  travel(game, "haven");
  walkView(game);
  assert.ok(placesBuilt().includes("haven"));
  assert.ok(placesBuilt().includes("meridian"), "the ship stays built while the player's away: her own rules go on");
  travel(game, "meridian");
  walkView(game);
  assert.ok(!placesBuilt().includes("haven"), "Haven is let go of once the player's back aboard");
  assert.equal(mapFor("meridian"), ship, "the ship was never let go of");
});

test("asking where someone is builds only the places they could be at, never every place", () => {
  const game = newGame();
  walkView(game);
  assert.ok(whereNow(game, "tarrow"));
  assert.deepEqual(placesBuilt(), ["meridian"]);
  // Someone who lives at Haven: only Haven is built to find them.
  const there = whereNow(game, "sable");
  assert.ok(there && there.includes(LOCATIONS.haven.name), there);
  assert.deepEqual(placesBuilt().sort(), ["haven", "meridian"]);
});

test("a place let go of is built again exactly as it was, with everything standing where it stood", () => {
  keepOnly("haven");
  const before = standing(mapFor("haven"));
  keepOnly("meridian");
  assert.ok(!placesBuilt().includes("haven"));
  assert.deepEqual(standing(mapFor("haven")), before);
  // Another port, and the ship, which is never let go of, so it's the same map all along.
  const ship = mapFor("meridian");
  keepOnly("kessara");
  const kessara = standing(mapFor("kessara"));
  keepOnly("meridian");
  assert.ok(!placesBuilt().includes("kessara"));
  assert.deepEqual(standing(mapFor("kessara")), kessara);
  assert.equal(mapFor("meridian"), ship);
});
