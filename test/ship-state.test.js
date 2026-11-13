// The ship's state in the room's picture (step 4 of the furniture plan): what the room view tells the page of power,
// fires, holes in the hull, sparking parts, the stores and the garden (src/walk.js with src/systems.js,
// src/emergencies.js and src/logistics.js), and what the picture makes of it (public/iso.js). Reads the game's own
// decks, writes nothing of them.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-ship-state-"));

const { buildScene, crateSlots, doorOpenFor, GROW_EVERY, GROW_STAGES, growthStage } = await import("../public/iso.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { startBreach, startFire } = await import("../src/emergencies.js");
const { takeAboard } = await import("../src/logistics.js");
const { damagePart, systemsOf } = await import("../src/systems.js");
const { walkCommand, walkView } = await import("../src/walk.js");

const newGame = () => {
  const game = createGameFromDraft(randomDraft({ seed: 21, archetype: "officer" }));
  game.scene = null;
  game.clock.hours = 10;
  return game;
};
const goTo = (game, room) => {
  for (let i = 0; i < 5 && walkView(game).here?.id !== room; i += 1) walkCommand(game, { action: "go", to: `room:${room}` });
  assert.equal(walkView(game).here?.id, room);
};
const area = (view, id) => view.areas.find((one) => one.id === id);
const namesBox = () => Object.values(systemsOf("meridian").parts).find((part) => part.kind === "junction box" && part.room === "names");

test("the room view says which rooms have no power, which are burning or holed, and what's sparking", () => {
  const game = newGame();
  goTo(game, "galley");
  let view = walkView(game);
  assert.ok(view.areas.every((one) => one.power === undefined && !one.fire && !one.breach), "a ship as it starts has power everywhere and nothing wrong");
  assert.equal(view.power, undefined, "and power enough");
  // The Names Bulkhead's box feeds the galley, the mess, the garden and the Hot Bunks: cut it, and they go without.
  damagePart(game, "meridian", namesBox().id, "cut");
  startFire(game, "meridian", "galley");
  startBreach(game, "meridian", "airlock_port");
  view = walkView(game);
  for (const id of ["galley", "mess", "garden", "bunks"]) assert.equal(area(view, id).power, false, `${id} without power`);
  assert.equal(area(view, "medbay").power, undefined, "the medbay has a box of its own");
  assert.equal(area(view, "galley").fire, 1);
  assert.equal(area(view, "airlock_port").breach, true);
  // The cut box is on deck 1, where it sparks; a sealed vent or a covered lens wouldn't.
  goTo(game, "names");
  assert.ok(walkView(game).things.some((thing) => thing.part?.sparks && thing.id === `part:${namesBox().id}`));
});

test("the room view says when the ship hasn't the power it wants, and when it has none", () => {
  const game = newGame();
  game.ship.underWay = true;
  const short = walkView(game).power;
  assert.equal(short.short, true);
  assert.ok(short.dropped.length >= 1, "something's let go");
  const still = newGame();
  still.logistics ??= {};
  still.logistics.meridian ??= {};
  still.logistics.meridian.machines ??= {};
  still.logistics.meridian.machines.generator = { progress: 0, made: 0, waiting: "no fuel cells", burning: 0 };
  const none = walkView(still);
  assert.equal(none.power?.off, true, "a stopped generator is no power at all");
  // And then no room has power, so every screen aboard is dark.
  assert.ok(none.areas.every((one) => one.power === false));
});

test("each of the ship's stores says how full it is, and of what", () => {
  const game = newGame();
  goTo(game, "galley");
  const pantry = () => walkView(game).things.find((thing) => thing.name === "Pantry");
  assert.deepEqual(pantry().stock.full, 1);
  assert.deepEqual(pantry().stock.goods.map((one) => one.item).sort(), ["produce", "ration_crate"]);
  takeAboard(game, "meridian", "produce", 999);
  const after = pantry().stock;
  assert.ok(after.full < 1 && after.full > 0, `${after.full}`);
  assert.equal(after.goods.find((one) => one.item === "produce").n, 0);
  goTo(game, "mess");
  const kettle = walkView(game).things.find((thing) => thing.name === "Soup kettle");
  assert.equal(kettle.stock.unit, "sittings");
  assert.ok(kettle.stock.full > 0 && kettle.stock.full <= 1);
});

test("the garden says how much it's grown, and every bed moves on a stage each time it's given enough", () => {
  const game = newGame();
  goTo(game, "garden");
  assert.deepEqual(walkView(game).growing, [{ room: "garden", made: 0 }]);
  for (let x = 0; x < 30; x += 3) {
    for (let made = 0; made < 40; made += 1) {
      const stage = growthStage(made, x, 6);
      assert.ok(stage >= 0 && stage < GROW_STAGES);
      if (made % GROW_EVERY === GROW_EVERY - 1) assert.equal(growthStage(made + 1, x, 6), (stage + 1) % GROW_STAGES);
      else assert.equal(growthStage(made + 1, x, 6), stage, "nothing changes between");
    }
  }
  // Beds start at different stages.
  assert.ok(new Set([94, 102, 110].map((x) => growthStage(0, x, 6))).size > 1 || new Set([6, 8, 10].map((y) => growthStage(0, 94, y))).size > 1);
});

test("the picture: screens dark where there's no power, fires on the floor, the hole in its wall, beds by stage, doorways", () => {
  const game = newGame();
  damagePart(game, "meridian", namesBox().id, "cut");
  startFire(game, "meridian", "galley");
  game.emergencies.fires["meridian|galley"].size = 3;
  startBreach(game, "meridian", "airlock_port");
  game.logistics ??= {};
  game.logistics.meridian ??= {};
  game.logistics.meridian.machines ??= {};
  game.logistics.meridian.machines.garden = { progress: 0, made: 14, waiting: null };
  goTo(game, "galley");
  const view = walkView(game);
  const scene = buildScene(view);
  const roomAt = (x, y) => view.areas.filter((one) => x >= one.x && x < one.x + one.w && y >= one.y && y < one.y + one.h).sort((a, b) => a.w * a.h - b.w * b.h)[0]?.id;
  // The galley's consoles are dark, and so is any screen in a room without power; the medbay's aren't.
  const consoles = scene.blocks.filter((block) => block.style === "machine");
  assert.ok(consoles.some((block) => block.off && roomAt(block.x, block.y) === "galley"), "the galley's counters are dark");
  assert.ok(consoles.every((block) => !block.off || ["galley", "mess", "garden", "bunks"].includes(roomAt(block.x, block.y))));
  // A fire of size 3 burns on seven squares of its room, each of them floor in it and each a glow.
  const fires = scene.fires.filter((one) => one.room === "galley");
  assert.equal(fires.length, 7);
  for (const one of fires) {
    assert.equal(roomAt(one.x, one.y), "galley");
    assert.equal(scene.kinds[one.y][one.x], "floor");
    assert.ok(scene.glows.some((cell) => cell.x === one.x && cell.y === one.y && cell.seed > 0.8), "a glow with light of its own");
  }
  // The same squares when it's drawn again.
  assert.deepEqual(buildScene(view).fires, scene.fires);
  // The hole is in a wall of the airlock, facing into it.
  const [hole] = scene.breaches;
  assert.equal(hole.room, "airlock_port");
  assert.equal(scene.kinds[hole.y][hole.x], "wall");
  const into = hole.face === "s" ? [hole.x, hole.y + 1] : [hole.x + 1, hole.y];
  assert.equal(roomAt(...into), "airlock_port");
  // The garden's beds have a stage; nothing else's do.
  const beds = scene.blocks.filter((block) => block.style === "plants");
  assert.ok(beds.length > 20);
  assert.ok(beds.every((block) => (roomAt(block.x, block.y) === "garden") === (block.growth !== undefined)));
  assert.ok(new Set(beds.map((block) => block.growth)).size > 1, "beds at different stages");
  // Doorways between rooms, each across its wall, and none where a way out is.
  assert.ok(scene.doorways.length >= 10);
  for (const door of scene.doorways) {
    assert.equal(scene.kinds[door.y][door.x], "door");
    assert.ok(["x", "y"].includes(door.along));
    assert.ok(!view.exits.some((exit) => exit.x === door.x && exit.y === door.y));
  }
});

test("doors open for whoever's near; stores are drawn slot by slot by what they hold", () => {
  const door = { x: 20, y: 10 };
  const at = (x, y) => ({ wx: (x + 0.5) * 0.5, wy: y + 0.5 });
  assert.equal(doorOpenFor(door, []), 0);
  assert.equal(doorOpenFor(door, [at(20, 11)]), 1, "someone in front of it");
  assert.equal(doorOpenFor(door, [at(20, 9)]), 1, "someone behind it");
  assert.equal(doorOpenFor(door, [at(20, 13)]), 0, "nobody near");
  assert.equal(doorOpenFor(door, [at(28, 10)]), 0, "someone along the wall, well away");
  // Half rations and half produce share the slots; a store with one crate left still shows it; an empty one is a pallet.
  assert.deepEqual(crateSlots({ full: 1, goods: [{ item: "ration_crate", n: 12, of: 12 }, { item: "produce", n: 12, of: 12 }] }).length, 12);
  assert.deepEqual(crateSlots({ full: 0.5, goods: [{ item: "ration_crate", n: 12, of: 12 }, { item: "produce", n: 0, of: 12 }] }), Array(6).fill("ration_crate"));
  assert.deepEqual(crateSlots({ full: 0.03, goods: [{ item: "ration_crate", n: 1, of: 20 }, { item: "fuel_cell", n: 0, of: 12 }] }), ["ration_crate"]);
  assert.deepEqual(crateSlots({ full: 0, goods: [{ item: "parts_crate", n: 0, of: 6 }] }), []);
  assert.deepEqual(crateSlots({ full: 1, unit: "sittings" }), []);
});
