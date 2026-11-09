// The ship's logistics, step 2: the machines run on the clock, at the same beat as everyone's days, each taking from
// one store and putting into another while its room has power and someone's at it; and the whole ship eats from the
// kettle at its sittings, with whoever finds it empty going without, which the ship's morale feels at midnight. None
// of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-logistics-clock-"));
// The checker test writes another file, so the real one is copied first and never written.
const logisticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-logistics-clock-files-"));
fs.copyFileSync(new URL("../world/logistics/meridian.txt", import.meta.url), path.join(logisticsDir, "meridian.txt"));
process.env.GAME_LOGISTICS_DIR = logisticsDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const bag = await import("../src/bag.js");
const { advanceLogistics, logisticsOf, logisticsProblems, machinesView, mealWords, mealsOfDay, mealsView, storesView, workersIn } = await import("../src/logistics.js");
const { clockRuns, passTime, publicState } = await import("../src/rules.js");
const { peopleAboard, whoIsIn } = await import("../src/life.js");
const { switchPart, systemsOf } = await import("../src/systems.js");
const { migrateGame } = await import("../src/migrate.js");
const { clearMaps, walkCommand, walkView } = await import("../src/walk.js");
const { reloadLogistics } = await import("../src/world.js");
const { readMachineLine, readSittings, writeSittings } = await import("../public/logistics-text.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const FILE = fs.readFileSync(path.join(logisticsDir, "meridian.txt"), "utf8");
const storeOf = (id) => logisticsOf("meridian").stores.find((one) => one.id === id);
const kettleCount = (game) => storesView(game, "meridian").find((one) => one.id === "soup_kettle").count.n;
const setKettle = (game, n) => { game.stores ??= {}; game.stores[storeOf("soup_kettle").key] = { count: n }; };
const emptyPantry = (game) => { const pantry = storeOf("pantry"); for (const id of Object.keys(pantry.holds)) bag.storeTake(game, pantry.key, pantry.holds, id, 99); };
// And the stores the errands would refill it from, so that it stays empty.
const emptySources = (game) => { for (const [id, item] of [["shuttle_stores", "ration_crate"], ["garden_bins", "produce"]]) bag.storeTake(game, storeOf(id).key, storeOf(id).holds, item, 99); };
// The garden makes food from nothing, and the refills bring crates from nothing, so a test that wants the pantry to
// stay empty stops both for a while.
const withoutTheGarden = (run) => {
  const model = logisticsOf("meridian");
  const garden = model.machines.find((one) => one.id === "garden");
  const refills = model.refills;
  garden.runs = false;
  model.refills = [];
  try {
    return run();
  } finally {
    garden.runs = true;
    model.refills = refills;
  }
};
const status = (game, id) => machinesView(game, "meridian").find((one) => one.id === id).status;
const atHour = (game, hours) => { game.clock.hours = hours; clockRuns(game, 1); };

test("a machine's line is read into its pieces, and a bad one says what's wrong", () => {
  const galley = readMachineLine("galley: cooks 1 produce or 1 ration crate from the pantry into 200 sittings in the soup kettle every hour, with power and a cook there");
  assert.deepEqual(galley, { name: "galley", room: null, verb: "cooks", takes: [{ n: 1, what: "produce" }, { n: 1, what: "ration crate" }], from: "pantry", gives: { n: 200, what: "sittings" }, into: "soup kettle", every: 60, needs: { power: true, worker: "a cook there" }, power: null });
  const garden = readMachineLine("garden: grows 1 produce into the garden bins every 2 hours, with power and someone tending it");
  assert.deepEqual([garden.takes, garden.from, garden.gives, garden.into, garden.every, garden.needs], [[], null, { n: 1, what: "produce" }, "garden bins", 120, { power: true, worker: "someone tending it" }]);
  const generator = readMachineLine("generator in Engineering: burns 1 fuel cell from the fuel rack every 8 hours, gives 100 power");
  assert.deepEqual([generator.room, generator.takes, generator.from, generator.gives, generator.every, generator.power], ["Engineering", [{ n: 1, what: "fuel cell" }], "fuel rack", null, 480, 100]);
  assert.match(readMachineLine("oven: bakes 1 produce").problem, /how often/);
  assert.match(readMachineLine("oven: bakes 1 produce every hour").problem, /from which store/);
  assert.match(readMachineLine("oven: hums every hour").problem, /needs a verb/);
  assert.match(readMachineLine("oven bakes things").problem, /needs a colon/);
  assert.deepEqual(readSittings("06:00, 07:30, 18:00, 19:30, each 90 minutes"), { at: [360, 450, 1080, 1170], minutes: 90 });
  assert.equal(writeSittings(readSittings("19:30, 6:00")), "06:00, 19:30, each 90 minutes");
  assert.match(readSittings("noon").problem, /isn't a time of day/);
});

test("the Meridian's machines know their stores, rooms and needs, and the generator waits for step 4", () => {
  const model = logisticsOf("meridian");
  const byId = Object.fromEntries(model.machines.map((m) => [m.id, m]));
  assert.deepEqual(Object.keys(byId).sort(), ["galley", "garden", "generator"]);
  assert.deepEqual([byId.galley.room, byId.galley.takes, byId.galley.from, byId.galley.gives, byId.galley.into, byId.galley.every, byId.galley.needs, byId.galley.runs],
    ["galley", [{ item: "produce", n: 1 }, { item: "ration_crate", n: 1 }], "pantry", { count: true, unit: "sittings", n: 200 }, "soup_kettle", 60, { power: true, worker: "a cook there" }, true]);
  assert.deepEqual([byId.garden.room, byId.garden.takes, byId.garden.gives, byId.garden.into, byId.garden.every, byId.garden.runs], ["garden", [], { count: false, item: "produce", n: 1 }, "garden_bins", 120, true]);
  assert.deepEqual([byId.generator.room, byId.generator.from, byId.generator.power, byId.generator.runs, byId.generator.generator], ["engineering", "fuel_rack", 100, true, true]);
  assert.deepEqual(model.sittings, { at: [360, 450, 1080, 1170], minutes: 90 });
  assert.equal(model.eats, 2);
  assert.deepEqual(model.kettles.map((one) => one.id), ["soup_kettle"]);
  assert.deepEqual(model.problems, []);
});

test("the checker names a machine's unknown store, unknown item and missing every, each with its line", () => {
  try {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), [
      "# CFS Meridian", "", "Stores:", "- pantry in The Galley: holds 2 ration crates", "- soup kettle in The Long Mess: holds 400 sittings", "", "Machines:",
      "- galley: cooks 1 ration crate from the larder into 200 sittings in the soup kettle every hour",
      "- galley: cooks 1 brick from the pantry into 200 sittings in the soup kettle every hour",
      "- still: distils 1 ration crate from the pantry",
      "- cellar: cools 1 ration crate from the pantry into 10 sittings in the pantry every hour",
      "- oven: bakes 1 ration crate from the pantry into 100 sittings in the soup kettle every hour, with a baker", ""].join("\n"));
    reloadLogistics();
    clearMaps();
    const problems = logisticsProblems();
    assert.ok(problems.some((one) => /line 8.*no store called larder/.test(one)), problems.join(" | "));
    assert.ok(problems.some((one) => /line 9.*no item called brick/.test(one)), problems.join(" | "));
    assert.ok(problems.some((one) => /line 10.*how often/.test(one)), problems.join(" | "));
    assert.ok(problems.some((one) => /line 11.*pantry isn't one/.test(one)), problems.join(" | "));
    const sound = logisticsOf("meridian").machines;
    assert.deepEqual(sound.map((one) => one.id), ["oven"], "the one sound machine is kept");
    assert.deepEqual(sound[0].needs, { power: false, worker: "a baker" });
  } finally {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), FILE);
    reloadLogistics();
    clearMaps();
  }
});

test("the cooks are in the galley by day and the gardeners in the garden, nobody at night, and the player counts", () => {
  const game = newGame();
  assert.deepEqual(whoIsIn(game, "meridian", "galley", 8), ["Cook Imre", "Cook Dessa"]);
  assert.deepEqual(whoIsIn(game, "meridian", "garden", 8), ["Gardener Odile", "Gardener Benno"]);
  assert.deepEqual(whoIsIn(game, "meridian", "galley", 2), []);
  assert.ok(!whoIsIn(game, "meridian", "garden", 12 + 20 / 60).includes("Gardener Odile"), "at lunch a gardener is at the benches");
  assert.ok(whoIsIn(game, "meridian", "bridge", 10).includes("voss"), "someone at their post is in that room");
  walkCommand(game, { action: "room", to: "galley" });
  assert.deepEqual(workersIn(game, "meridian", "galley", 2), ["you"], "the player standing in the galley at night counts as a cook");
});

test("the galley cooks the pantry into the kettle while a cook's there, and says why it waits when it does", () => {
  const game = newGame();
  assert.equal(status(game, "galley"), "about to start");
  // The morning's sitting takes the kettle down to 125 by five to nine, the galley's hour is up, and in go 200; by ten
  // there's only room for 100 more, so the next potful waits, ready.
  game.clock.hours = 10;
  clockRuns(game, 60);
  assert.equal(status(game, "galley"), "no room in the soup kettle for 200 sittings yet", "a nearly full kettle has no room for another 200");
  assert.equal(kettleCount(game), 300);
  assert.deepEqual(storesView(game, "meridian").find((one) => one.id === "pantry").items.map((one) => `${one.id} ${one.n}`), ["ration_crate 12", "produce 11"], "produce goes first, as the line has it first");
  // Room in the kettle, and the potful it's had ready goes in at once.
  setKettle(game, 100);
  clockRuns(game, 5);
  assert.equal(kettleCount(game), 300);
  assert.deepEqual(storesView(game, "meridian").find((one) => one.id === "pantry").items.map((one) => `${one.id} ${one.n}`), ["ration_crate 12", "produce 10"]);
  assert.match(status(game, "galley"), /at work, \d+ minutes to the next/);
  // Nothing to cook from, nothing anyone could fetch, and the garden stopped.
  withoutTheGarden(() => {
    emptyPantry(game);
    emptySources(game);
    setKettle(game, 0);
    clockRuns(game, 60);
    assert.equal(status(game, "galley"), "the pantry has no produce or ration crates");
    assert.equal(kettleCount(game), 0);
    // No power in the galley.
    bag.storePut(game, storeOf("pantry").key, storeOf("pantry").holds, "produce", 2);
    switchPart(game, "meridian", systemsOf("meridian").circuits.galley, false, { by: "player" });
    clockRuns(game, 5);
    assert.equal(status(game, "galley"), "no power");
    assert.equal(kettleCount(game), 0);
    switchPart(game, "meridian", systemsOf("meridian").circuits.galley, true, { by: "player" });
    clockRuns(game, 5);
    assert.equal(kettleCount(game), 200, "and it cooks again the moment the power's back");
    // Nobody at the kettle at night.
    atHour(game, 24 + 2);
    assert.equal(status(game, "galley"), "waiting for a cook there");
  });
});

test("the garden fills its bins, one produce every two hours while someone tends it, and stops when they're full", () => {
  const game = newGame();
  clockRuns(game, 30);
  assert.equal(status(game, "garden"), "the garden bins are full");
  const bins = storeOf("garden_bins");
  bag.storeTake(game, bins.key, bins.holds, "produce", 6);
  clockRuns(game, 240);
  assert.equal(storesView(game, "meridian").find((one) => one.id === "garden_bins").items[0].n, 8, "two more in four hours");
  assert.equal(machinesView(game, "meridian").find((one) => one.id === "garden").made, 2);
  atHour(game, 24 + 2);
  assert.equal(status(game, "garden"), "waiting for someone tending it");
  assert.match(status(game, "generator"), /^running, .* on this fuel cell, giving 100 power$/);
  assert.equal(storesView(game, "meridian").find((one) => one.id === "fuel_rack").items[0].n, 4, "the generator has taken two cells from the rack by two in the morning");
});

test("the whole ship eats at the sittings, 450 a sitting from the kettle, and whoever finds it empty goes without", () => {
  // A new game starts at 08:00, in the morning's second sitting; by half past ten it's over, and everyone was fed.
  const game = newGame();
  game.clock.hours = 10;
  clockRuns(game, 30);
  let meals = mealsView(game, "meridian");
  assert.deepEqual([meals.sittings, meals.aSitting, meals.eats], [4, 450, 2]);
  assert.equal(meals.now, "between sittings, the next at 18:00");
  assert.equal(meals.today.missed, 0);
  assert.ok(meals.today.served >= 295 && meals.today.served <= 305, `${meals.today.served} served between eight and nine`);
  const morning = meals.today.served;
  // Nothing in the kettle and nothing to cook when the evening's first sitting comes: people go without, you hear once,
  // and whoever you can see eating has found the kettle empty.
  game.clock.hours = 18;
  emptyPantry(game);
  emptySources(game);
  setKettle(game, 0);
  const notes = withoutTheGarden(() => clockRuns(game, 45));
  meals = mealsView(game, "meridian");
  assert.equal(meals.today.served, morning);
  assert.ok(meals.today.missed >= 220 && meals.today.missed <= 230, `${meals.today.missed} went without`);
  assert.match(meals.now, /the third sitting is on, 450 people over 90 minutes, \d+ to go/);
  assert.equal(notes.filter((one) => /kettle has run dry in the third sitting/.test(one)).length, 1);
  assert.equal(mealWords(game, "meridian", "eating what's left"), "finding the kettle empty");
  assert.equal(mealWords(game, "meridian", "cooking"), "cooking");
  const seen = peopleAboard(game, "meridian", "deck2");
  assert.ok(seen.some((one) => /kettle empty/.test(one.doing)), `someone in the mess has found the kettle empty: ${seen.map((one) => `${one.name} ${one.doing}`).join("; ")}`);
  assert.ok(!seen.some((one) => /\beating\b/.test(one.doing)), "and nobody's eating");
  // Soup again, and the rest of the sitting is served, with nothing more said.
  setKettle(game, 400);
  assert.equal(mealWords(game, "meridian", "eating"), "eating", "with anything in the kettle, people eat");
  const later = withoutTheGarden(() => clockRuns(game, 45));
  meals = mealsView(game, "meridian");
  assert.ok(meals.today.served >= morning + 220, `${meals.today.served} served by the end of the sitting`);
  assert.ok(!later.some((one) => /kettle has run dry/.test(one)));
});

test("the ship's morale feels a hungry day at midnight, through the food shortage's own rule, and the log says so", () => {
  const fed = newGame();
  const starved = newGame();
  emptyPantry(starved);
  emptySources(starved);
  setKettle(starved, 0);
  passTime(fed, 24, "routine");
  withoutTheGarden(() => passTime(starved, 24, "routine"));
  assert.equal(mealsOfDay(fed, "meridian", 0).missed, 0);
  const hungry = mealsOfDay(starved, "meridian", 0);
  assert.ok(hungry.missed > 800 && hungry.served === 0, JSON.stringify(hungry));
  assert.ok(starved.ship.log.some((entry) => /kettle ran dry yesterday: \d[\d,]* of \d[\d,]* sittings went unserved/.test(entry.text)), JSON.stringify(starved.ship.log));
  assert.ok(!fed.ship.log.some((entry) => /kettle ran dry/.test(entry.text)));
  passTime(fed, 24, "routine");
  withoutTheGarden(() => passTime(starved, 24, "routine"));
  assert.ok(starved.ship.morale < fed.ship.morale, `${starved.ship.morale} hungry against ${fed.ship.morale} fed`);
});

test("an old save comes up at version 17 with its stores full and its machines about to start", () => {
  const old = { ...newGame(), version: 16 };
  delete old.logistics;
  const migrated = migrateGame(old);
  assert.equal(migrated.version, 17);
  assert.ok(storesView(migrated, "meridian").every((one) => one.full));
  const statuses = machinesView(migrated, "meridian").map((one) => one.status);
  assert.match(statuses[0], /^running, 8 h 0 min on this fuel cell, giving 100 power$/, "the generator starts with a cell in it");
  assert.deepEqual(statuses.slice(1), ["about to start", "about to start"]);
  assert.deepEqual(mealsView(migrated, "meridian").today, { served: 0, missed: 0 });
  clockRuns(migrated, 5);
  assert.ok(migrated.logistics.meridian.at > 0, "and it runs from the clock's next move");
});

test("the kettle says how much is left in it, an emptied pantry says it's empty, and looking changes nothing", () => {
  const game = newGame();
  walkCommand(game, { action: "room", to: "mess" });
  const kettle = () => walkView(game).things.find((one) => one.name === "Soup kettle");
  assert.match(kettle().look, /It's full\.$/);
  setKettle(game, 60);
  assert.match(kettle().look, /There's not much left in it, 60 sittings or so\.$/);
  setKettle(game, 0);
  assert.match(kettle().look, /scraped empty\.$/);
  walkCommand(game, { action: "room", to: "galley" });
  const pantry = () => walkView(game).things.find((one) => one.name === "Pantry");
  assert.doesNotMatch(pantry().look, /empty now/);
  emptyPantry(game);
  assert.match(pantry().look, /It's empty now\.$/);
  const fresh = newGame();
  const before = JSON.stringify(fresh);
  publicState(fresh);
  assert.equal(JSON.stringify(fresh), before, "the Ship menu's machines and sittings are read without writing");
  assert.deepEqual(fresh.logistics, { meridian: { at: 8 * 60, machines: {}, meals: { days: {}, carry: 0, dry: false }, errands: {} } }, "a new game's logistics start with its clock");
  assert.deepEqual(advanceLogistics(fresh), [], "and with the clock where it was, there's nothing to catch up");
});
