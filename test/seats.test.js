// People in the furniture (step 3 of the furniture plan): the seats and beds public/furniture.js marks, a seat or a bed
// taking only its own square in the life engine (src/life.js), the decks' posts and spots on their seats and beds, and
// how the room's picture puts someone in one (public/iso.js). Reads the game's own decks and life file, writes nothing.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-seats-"));

const { FURNITURE, FURNITURE_BY_ID, squaresOf } = await import("../public/furniture.js");
const { buildScene, cellCentre, restingOn, sittingIn } = await import("../public/iso.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { peopleAboard } = await import("../src/life.js");
const { mapFor, walkCommand, walkView } = await import("../src/walk.js");
const { WORLD_LIFE } = await import("../src/world.js");

const MAP = mapFor("meridian");
const LIFE = WORLD_LIFE.meridian;
const at = (hours) => {
  const game = createGameFromDraft(randomDraft({ seed: 21, archetype: "officer" }));
  game.clock.hours = hours;
  return game;
};
const pieceAt = (level, x, y) => level.furniture.find((piece) => squaresOf(piece).some(([px, py]) => px === x && py === y)) ?? null;
const kindAt = (level, x, y) => pieceAt(level, x, y)?.kind ?? null;
const spot = (name) => LIFE.spots[name];

test("a chair, a bench and the command chair are seats, a bunk and a cot are beds, and nothing in the way is either", () => {
  assert.deepEqual(FURNITURE.filter((kind) => kind.seat).map((kind) => kind.id), ["chair", "bench", "command-chair"]);
  assert.deepEqual(FURNITURE.filter((kind) => kind.bed).map((kind) => kind.id), ["bunk", "cot"]);
  for (const kind of FURNITURE) assert.ok(!(kind.seat || kind.bed) || (!kind.blocks && !kind.wall), `${kind.id} is somewhere to be`);
  // A deck knows its seats' and beds' squares: a chair's in the mess, a bunk's in the Hot Bunks, and never a table's.
  const deck2 = MAP.levels.deck2;
  const [, vx, vy] = spot("seat-voss");
  assert.ok(deck2.seats.has(`${vx},${vy}`));
  const bunk = deck2.furniture.find((piece) => piece.kind === "bunk");
  assert.ok(squaresOf(bunk).every(([x, y]) => deck2.seats.has(`${x},${y}`)));
  const table = deck2.furniture.find((piece) => piece.kind === "long-table");
  assert.ok(squaresOf(table).every(([x, y]) => !deck2.seats.has(`${x},${y}`)));
});

test("where people's days have them sitting or sleeping is on a seat or a bed", () => {
  const deck1 = MAP.levels.deck1;
  const deck2 = MAP.levels.deck2;
  // The helm and comms, at their consoles, and the night watch in the same chairs.
  for (const id of ["pell", "iven"]) {
    const home = deck1.homes.find((one) => one.id === id);
    assert.equal(kindAt(deck1, home.x, home.y), "chair", `${id}'s post`);
  }
  for (const name of ["helm-night", "comms-night", "ready-room"]) assert.equal(kindAt(deck1, spot(name)[1], spot(name)[2]), "chair", name);
  // The officers' cabins: their spot is their bunk.
  for (const name of Object.keys(LIFE.spots).filter((one) => one.startsWith("cabin-"))) assert.equal(kindAt(deck1, spot(name)[1], spot(name)[2]), "bunk", name);
  // Everyone's seat at the mess tables has a chair, and every sleeping place in the Hot Bunks is in a bunk.
  for (const name of Object.keys(LIFE.spots).filter((one) => one.startsWith("seat-"))) assert.equal(kindAt(deck2, spot(name)[1], spot(name)[2]), "chair", name);
  for (const [room, x, y] of LIFE.groups.racks) assert.equal(kindAt(deck2, x, y), "bunk", `${room} ${x},${y}`);
  for (const name of ["patient-1", "patient-3", "patient-4"]) assert.equal(kindAt(deck2, spot(name)[1], spot(name)[2]), "cot", name);
  // The curtained cot is a thing drawn as a cot, turned like the cots beside it, so whoever's laid up there is in it.
  const curtained = deck2.things.find((thing) => thing.name === "A cot with its curtain drawn");
  assert.equal(curtained.facing, "e");
});

test("someone in a seat or a bed takes only its square, so the officers at a mess table each keep their own chair", () => {
  const lunch = at(12.75);
  const deck2 = MAP.levels.deck2;
  const people = peopleAboard(lunch, "meridian", "deck2");
  // Voss, Tarrow and Halm, side by side and each with a name over their head, on the very chairs their days name.
  for (const [id, name] of [["voss", "seat-voss"], ["tarrow", "seat-tarrow"], ["halm", "seat-halm"]]) {
    const one = people.find((person) => person.id === id);
    assert.deepEqual([one.x, one.y], spot(name).slice(1), `${id} at ${name}`);
    assert.equal(kindAt(deck2, one.x, one.y), "chair");
  }
  // At night the officers are in their bunks, the crew in the Hot Bunks' and the night watch at the helm and comms.
  const night = at(26.5);
  const deck1 = MAP.levels.deck1;
  for (const id of ["voss", "halm", "tarrow", "odessa"]) {
    const one = peopleAboard(night, "meridian", "deck1").find((person) => person.id === id);
    assert.ok(one.asleep && kindAt(deck1, one.x, one.y) === "bunk", `${id} asleep in a bunk`);
  }
  const sleepers = peopleAboard(night, "meridian", "deck2").filter((one) => one.asleep && deck2.roomAt(one.x, one.y) === "bunks");
  assert.ok(sleepers.length >= 10);
  for (const one of sleepers) assert.equal(kindAt(deck2, one.x, one.y), "bunk", `${one.id ?? one.name} at ${one.x},${one.y}`);
  const watch = peopleAboard(night, "meridian", "deck1").filter((one) => !one.asleep && deck1.roomAt(one.x, one.y) === "bridge");
  assert.ok(watch.some((one) => kindAt(deck1, one.x, one.y) === "chair"), "someone on watch in a bridge chair");
});

test("the picture sits someone in a chair the way it faces, along a bench where they are, and on the edge of a bed", () => {
  const piece = (kind, facing, x0, y0, x1, y1) => ({ kind, facing, x0, y0, x1, y1, depth: (x0 + x1) / 2 + (y0 + y1) / 2 });
  // A chair facing the bow: their back to the camera, the chair's back drawn again over them.
  const toBow = sittingIn(piece("chair", "n", 12, 8, 12.5, 9), 12.2, 8.6);
  assert.deepEqual([toBow.wx, toBow.wy, toBow.over], [12.25, 8.5, "back"]);
  assert.deepEqual([toBow.pose.seated, toBow.pose.back, toBow.pose.flip], [true, true, false]);
  // Facing the camera, they face it too, and nothing goes over them.
  const toYou = sittingIn(piece("chair", "s", 12, 8, 12.5, 9), 12.25, 8.5);
  assert.deepEqual([toYou.pose.back, toYou.pose.flip, toYou.over], [false, true, null]);
  assert.ok(sittingIn(piece("command-chair", "s", 12, 18, 13, 19), 12.5, 18.5).pose.raise > 0);
  // Along a bench they keep their own place; across it they're in its middle.
  const bench = sittingIn(piece("bench", "s", 10, 5, 12, 6), 10.75, 5.3);
  assert.deepEqual([bench.wx, bench.wy], [10.75, 5.5]);
  const turned = sittingIn(piece("bench", "e", 10, 5, 10.5, 7), 10.4, 6.5);
  assert.deepEqual([turned.wx, turned.wy], [10.25, 6.5]);
  // Awake on a bed, on the long side the camera sees, facing out: a cot along the deck, a bunk down it, the bunk's upper
  // bed over them.
  const cot = sittingIn(piece("cot", "e", 7, 12, 9, 13), 7.75, 12.5);
  assert.deepEqual([cot.wx, cot.wy, cot.over, cot.pose.flip], [7.75, 12.8, null, true]);
  const bunk = sittingIn(piece("bunk", "s", 36.5, 23, 37.5, 25), 37.25, 24.5);
  assert.deepEqual([bunk.wx, bunk.wy, bunk.over, bunk.pose.back], [37.36, 24.5, "over", false]);
  assert.ok(bunk.pose.raise < cot.pose.raise, "a lower bunk is lower than a cot");
  assert.equal(sittingIn(piece("long-table", "s", 22, 6, 24, 7), 23, 6.5), null);
});

test("in the room's picture, the helm sits in her chair and the laid up lie in the medbay's cots, the curtained one too", () => {
  const game = at(9);
  const bridge = walkView(game);
  const scene = buildScene(bridge);
  const pell = bridge.people.find((one) => one.key === "pell");
  const chair = restingOn(scene, cellCentre(pell.x, pell.y).wx, cellCentre(pell.x, pell.y).wy);
  assert.equal(chair?.kind, "chair");
  assert.equal(sittingIn(chair, cellCentre(pell.x, pell.y).wx, cellCentre(pell.x, pell.y).wy).pose.back, true);
  for (let i = 0; i < 4 && walkView(game).here?.id !== "medbay"; i += 1) walkCommand(game, { action: "go", to: "room:medbay" });
  const medbay = walkView(game);
  const laid = medbay.people.filter((one) => one.down);
  assert.ok(laid.length >= 2, "Vik and Hana start the game laid up");
  const inMedbay = buildScene(medbay);
  for (const one of laid) assert.equal(restingOn(inMedbay, cellCentre(one.x, one.y).wx, cellCentre(one.x, one.y).wy)?.kind, "cot", `${one.key} in a cot`);
});
