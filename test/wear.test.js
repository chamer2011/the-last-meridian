// Wear and clutter (step 5 of the furniture plan): how worn and cluttered the ship looks by her hull and her morale,
// and the marks a fire and a fall leave in the rooms, fading over the days after (src/wear.js), sent with the room view
// (src/walk.js) and laid on the floor by the room's picture (public/iso.js). Reads the game's own decks, writes nothing
// of them.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-wear-"));

const { buildScene } = await import("../public/iso.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { startFire } = await import("../src/emergencies.js");
const { fallDown } = await import("../src/medbay.js");
const { passTime } = await import("../src/rules.js");
const { walkCommand, walkView } = await import("../src/walk.js");
const { addMark, MARK_DAYS, marksOn, wearOf } = await import("../src/wear.js");

const newGame = () => {
  const game = createGameFromDraft(randomDraft({ seed: 21, archetype: "officer" }));
  game.scene = null;
  game.clock.hours = 9;
  return game;
};
const goTo = (game, room) => {
  for (let i = 0; i < 5 && walkView(game).here?.id !== room; i += 1) walkCommand(game, { action: "go", to: `room:${room}` });
  assert.equal(walkView(game).here?.id, room);
};
const galleyOf = (game) => walkView(game).areas.find((one) => one.id === "galley");

test("the ship looks as worn as her hull and as cluttered as her morale is low, and nowhere else says", () => {
  const game = newGame();
  assert.deepEqual(wearOf(game, "meridian"), { grime: 1, clutter: 1 }, "as she starts: the rooms as they always looked");
  game.ship.hull = 96;
  game.ship.morale = 88;
  assert.deepEqual(wearOf(game, "meridian"), { grime: 0, clutter: 0 });
  game.ship.hull = 30;
  game.ship.morale = 20;
  assert.deepEqual(wearOf(game, "meridian"), { grime: 3, clutter: 3 });
  game.ship.hull = 70;
  game.ship.morale = 40;
  assert.deepEqual(wearOf(game, "meridian"), { grime: 1, clutter: 2 });
  assert.equal(wearOf(game, "haven"), null);
  assert.deepEqual(walkView(game).wear, { grime: 1, clutter: 2 }, "the room view says it aboard");
});

test("a fire leaves soot as big as it got, which fades and is gone in its days", () => {
  const game = newGame();
  goTo(game, "galley");
  startFire(game, "meridian", "galley");
  assert.equal(galleyOf(game).scorched, undefined, "nothing until it's out");
  passTime(game, 3);
  assert.equal(galleyOf(game).fire, undefined, "the engineers have put it out");
  const soot = galleyOf(game).scorched;
  assert.ok(soot.size >= 2, `it grew before they got to it (${soot.size})`);
  assert.equal(soot.left, 1);
  passTime(game, (MARK_DAYS.scorch * 24) / 2);
  assert.equal(galleyOf(game).scorched.left, 0.5);
  passTime(game, (MARK_DAYS.scorch * 24) / 2 + 1);
  assert.equal(galleyOf(game).scorched, undefined, "cleaned away");
});

test("whoever falls leaves a stain where they lay, on that level only, gone in a few days", () => {
  const game = newGame();
  fallDown(game, { who: "Cook Imre", place: "meridian", level: "deck2", x: 84, y: 5, why: "out cold" });
  assert.deepEqual(marksOn(game, "meridian", "deck2"), [{ kind: "fallen", x: 84, y: 5, left: 1 }]);
  assert.deepEqual(marksOn(game, "meridian", "deck1"), []);
  goTo(game, "galley");
  assert.deepEqual(walkView(game).marks, [{ kind: "fallen", x: 84, y: 5, left: 1 }]);
  passTime(game, MARK_DAYS.fallen * 24 + 1);
  assert.deepEqual(marksOn(game, "meridian", "deck2"), []);
  assert.equal(walkView(game).marks, undefined);
  // A place keeps only its newest marks.
  for (let i = 0; i < 80; i += 1) addMark(game, "meridian", { kind: "fallen", level: "deck2", x: 40 + (i % 20), y: 5 + Math.floor(i / 20) });
  assert.equal(game.marks.meridian.length, 60);
});

test("the picture lays soot on the squares the fire burned on, the stains where people fell, and knows how worn it is", () => {
  const game = newGame();
  startFire(game, "meridian", "galley");
  passTime(game, 3);
  fallDown(game, { who: "Mess Hand Bao", place: "meridian", level: "deck2", x: 55, y: 11, why: "out cold" });
  game.ship.hull = 30;
  game.ship.morale = 20;
  goTo(game, "galley");
  const view = walkView(game);
  const scene = buildScene(view);
  assert.deepEqual(scene.wear, { grime: 3, clutter: 3 });
  const size = galleyOf(game).scorched.size;
  const soot = scene.marks.filter((mark) => mark.kind === "scorch");
  assert.equal(soot.length, 1 + size * 2, "one patch for each square a fire that size burns on");
  const area = view.areas.find((one) => one.id === "galley");
  for (const mark of soot) {
    assert.ok(mark.x >= area.x && mark.x < area.x + area.w && mark.y >= area.y && mark.y < area.y + area.h, "in the galley");
    assert.equal(scene.kinds[mark.y][mark.x], "floor");
  }
  // While a room burns, it has flames, not soot, on those same squares.
  startFire(game, "meridian", "galley");
  game.emergencies.fires["meridian|galley"].size = size;
  const burning = buildScene(walkView(game));
  assert.deepEqual(burning.fires.map(({ x, y }) => [x, y]).sort(), soot.map(({ x, y }) => [x, y]).sort());
  assert.equal(burning.marks.filter((mark) => mark.kind === "scorch").length, 0);
  assert.ok(scene.marks.some((mark) => mark.kind === "fallen" && mark.x === 55 && mark.y === 11));
  // A place nobody says the wear of is drawn as it always was.
  assert.equal(buildScene({ ...view, wear: undefined }).wear, null);
});
