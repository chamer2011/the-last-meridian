// The ship's logistics, step 4: the generator burns fuel cells from the rack and gives the power the systems draw,
// written as loads in world/logistics; when it hasn't enough, systems are let go in the written order, and when it
// stops for want of a cell, nothing aboard has power, with everything that already happens in the dark. None of this
// calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-logistics-power-"));
const logisticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-logistics-power-files-"));
fs.copyFileSync(new URL("../world/logistics/meridian.txt", import.meta.url), path.join(logisticsDir, "meridian.txt"));
process.env.GAME_LOGISTICS_DIR = logisticsDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const bag = await import("../src/bag.js");
const { logisticsOf, logisticsProblems, machinesView, powerSupply, storesView } = await import("../src/logistics.js");
const { clockRuns, passTime, publicState } = await import("../src/rules.js");
const sys = await import("../src/systems.js");
const { clearMaps, walkCommand, walkView } = await import("../src/walk.js");
const { reloadLogistics } = await import("../src/world.js");
const { readLoadsLine } = await import("../public/logistics-text.js");
const { computerView } = await import("../src/computers.js");
const { logLines } = await import("../src/computer-use.js").catch(() => ({ logLines: null }));

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const FILE = fs.readFileSync(path.join(logisticsDir, "meridian.txt"), "utf8");
const storeOf = (id) => logisticsOf("meridian").stores.find((one) => one.id === id);
const count = (game, storeId, item) => storesView(game, "meridian").find((one) => one.id === storeId).items.find((one) => one.id === item)?.n ?? 0;
const take = (game, storeId, item, n) => bag.storeTake(game, storeOf(storeId).key, storeOf(storeId).holds, item, n);
const put = (game, storeId, item, n) => bag.storePut(game, storeOf(storeId).key, storeOf(storeId).holds, item, n);
const generator = (game) => machinesView(game, "meridian").find((one) => one.id === "generator");
const part = (system) => sys.systemsOf("meridian").systems.find((one) => one.id === system).parts.map((id) => sys.systemsOf("meridian").parts[id])[0];

test("a loads line is read into its pieces, and so is the order to drop systems in", () => {
  assert.deepEqual(readLoadsLine("air plant 20, engines 30 while under way, doors 6, lights 1 a room, computers 2 each"), { loads: [
    { system: "air plant", amount: 20, per: null, while: null }, { system: "engines", amount: 30, per: null, while: "under way" },
    { system: "doors", amount: 6, per: null, while: null }, { system: "lights", amount: 1, per: "room", while: null }, { system: "computers", amount: 2, per: "each", while: null }] });
  assert.deepEqual(readLoadsLine("when short, drop: cameras, comms, lights, doors, navigation, air"), { drop: ["cameras", "comms", "lights", "doors", "navigation", "air"] });
  assert.match(readLoadsLine("air plant lots").problem, /should be a system and a number/);
  assert.match(readLoadsLine("when short, drop:").problem, /names nothing to drop/);
});

test("the Meridian's loads know their systems, the generator is a generator, and the checker catches a bad line", () => {
  const model = logisticsOf("meridian");
  assert.deepEqual(model.loads.map((one) => [one.system, one.amount, one.per, one.underWay]), [["air", 20, null, false], ["engines", 30, null, true], ["doors", 6, null, false], ["comms", 6, null, false], ["navigation", 6, null, false], ["cameras", 4, null, false], ["lights", 1, "room", false], ["computers", 2, "each", false]]);
  assert.deepEqual(model.drop, ["cameras", "comms", "lights", "doors", "navigation", "air"]);
  assert.deepEqual(model.generators.map((one) => one.id), ["generator"]);
  assert.deepEqual(model.problems, []);
  try {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), ["# CFS Meridian", "", "Loads:", "- air plant 20, hot tub 50, lights 1 a room", "- engines 30 while dancing", "- when short, drop: cameras, power, hot tub", ""].join("\n"));
    reloadLogistics();
    clearMaps();
    const problems = logisticsProblems();
    assert.ok(problems.some((one) => /line 4.*no system called hot tub to draw power/.test(one)), problems.join(" | "));
    assert.ok(problems.some((one) => /line 5.*isn't a time the game knows/.test(one)), problems.join(" | "));
    assert.ok(problems.some((one) => /line 6.*no system called power to drop/.test(one)) && problems.some((one) => /line 6.*no system called hot tub to drop/.test(one)), problems.join(" | "));
    assert.deepEqual(logisticsOf("meridian").loads.map((one) => one.system), ["air", "lights"], "the sound loads are kept");
    assert.deepEqual(logisticsOf("meridian").drop, ["cameras"]);
  } finally {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), FILE);
    reloadLogistics();
    clearMaps();
  }
});

test("at rest the generator's hundred covers the ship; under way the engines take their share and the cameras and comms are let go first", () => {
  const game = newGame();
  const rest = sys.powerBalance(game, "meridian");
  assert.equal(rest.supply, 100);
  assert.deepEqual(rest.loads.map((one) => `${one.system} ${one.amount}`), ["air 20", "doors 6", "comms 6", "navigation 6", "cameras 4", "lights 34", "computers 4"]);
  assert.equal(rest.load, 80);
  assert.deepEqual(rest.dropped, []);
  assert.match(sys.powerNote(game, "meridian"), /^The generator gives 100 power, and the ship draws 80: .* Nothing's let go\.$/);
  assert.equal(sys.roomDark(game, "meridian", "galley"), false);
  assert.equal(sys.watched(game, "meridian", "bridge"), true);
  game.ship.underWay = true;
  const jumping = sys.powerBalance(game, "meridian");
  assert.equal(jumping.load, 110);
  assert.deepEqual(jumping.dropped, ["cameras", "comms"], "cameras and comms go, and that's enough");
  assert.equal(jumping.running, 100);
  assert.equal(sys.watched(game, "meridian", "bridge"), false, "the cameras see nothing under way");
  assert.equal(sys.commsUp(game, "meridian"), false);
  assert.equal(sys.roomDark(game, "meridian", "galley"), false, "the lights stay on");
  assert.match(sys.powerNote(game, "meridian"), /10 more than it gives, so cameras and comms are let go/);
  assert.match(sys.lookAt(game, "meridian", part("cameras")), /let go first/);
  delete game.ship.underWay;
  assert.equal(sys.watched(game, "meridian", "bridge"), true);
  // Lights switched off in a room draw nothing.
  const lights = sys.systemsOf("meridian").systems.find((one) => one.id === "lights").parts.map((id) => sys.systemsOf("meridian").parts[id]).find((one) => one.room === "galley");
  sys.switchPart(game, "meridian", lights.id, false, { by: "player" });
  assert.equal(sys.powerBalance(game, "meridian").load, 79);
  sys.switchPart(game, "meridian", lights.id, true, { by: "player" });
  assert.equal(sys.powerBalance(game, "meridian").load, 80);
});

test("the generator burns a cell every eight hours from the rack, starting with one in it, and Oona keeps the rack up", () => {
  const game = newGame();
  assert.match(generator(game).status, /^running, 8 h 0 min on this fuel cell, giving 100 power$/);
  assert.equal(generator(game).does, "burns 1 fuel cell from the fuel rack every 8 hours, 100 power");
  clockRuns(game, 60);
  assert.match(generator(game).status, /^running, 7 h 0 min on this fuel cell/);
  assert.equal(count(game, "fuel_rack", "fuel_cell"), 6, "the first cell was already in");
  passTime(game, 7, "routine");
  assert.equal(count(game, "fuel_rack", "fuel_cell"), 5, "the next went in at four in the afternoon");
  passTime(game, 24, "routine");
  // Three more by the next afternoon, and Oona has been down to the shuttle stores for the rack once it was under three.
  const cells = count(game, "fuel_rack", "fuel_cell") + count(game, "shuttle_stores", "fuel_cell");
  assert.equal(cells, 42 - 4, `${cells} cells left between the rack and the shuttle stores`);
  assert.ok(count(game, "fuel_rack", "fuel_cell") >= 2, "Oona keeps the rack up, give or take the trip she's on");
  assert.equal(powerSupply(game, "meridian"), 100);
});

test("with no cells left anywhere the generator stops, the ship goes dark and onto her reserve air, the galley waits, and a cell brings it all back", () => {
  const game = newGame();
  // Nothing comes aboard while this runs, whatever the file's refills say.
  const model = logisticsOf("meridian");
  const refills = model.refills;
  model.refills = [];
  try {
    noCells(game);
  } finally {
    model.refills = refills;
  }
});

function noCells(game) {
  take(game, "fuel_rack", "fuel_cell", 6);
  take(game, "shuttle_stores", "fuel_cell", 36);
  walkCommand(game, { action: "room", to: "galley" });
  passTime(game, 8, "routine");
  assert.match(generator(game).status, /^stopped: the fuel rack has no fuel cells, and nothing aboard has power$/);
  assert.equal(powerSupply(game, "meridian"), 0);
  assert.equal(sys.roomPowered(game, "meridian", "galley"), false);
  assert.equal(sys.roomDark(game, "meridian", "galley"), true);
  // The air plant has no power either, so she's on her reserve air: five days of it, and only then airless
  // (test/no-air.test.js).
  assert.equal(sys.airFlows(game, "meridian", "galley"), true);
  assert.ok(sys.reserveLeft(game, "meridian") > 4 * 1440 && sys.reserveLeft(game, "meridian") < 5 * 1440, `${sys.reserveLeft(game, "meridian")} minutes of reserve air left`);
  assert.match(sys.lookAt(game, "meridian", part("air")), /The reserve air stands at 4 days and \d+ hours\.$/);
  assert.equal(sys.watched(game, "meridian", "bridge"), false);
  assert.match(sys.jumpBlocked(game), /engines are down/);
  assert.match(sys.powerNote(game, "meridian"), /^No power: the generator's stopped\./);
  assert.match(sys.lookAt(game, "meridian", part("lights")), /generator's stopped/);
  assert.equal(machinesView(game, "meridian").find((one) => one.id === "galley").status, "no power");
  assert.ok(publicState(game).shipSystems.find((one) => one.id === "power").note.startsWith("No power"));
  const bridge = publicState(game).ship.machines.find((one) => one.id === "generator");
  assert.equal(bridge.bad, true);
  // Bring a cell to the rack, and within the next five minutes the generator takes it and the lights come back.
  put(game, "fuel_rack", "fuel_cell", 1);
  clockRuns(game, 5);
  assert.equal(powerSupply(game, "meridian"), 100);
  assert.equal(count(game, "fuel_rack", "fuel_cell"), 0);
  assert.match(generator(game).status, /^running, (8 h 0|7 h 5[0-9]) min on this fuel cell/);
  assert.equal(sys.roomDark(game, "meridian", "galley"), false);
  assert.equal(sys.airFlows(game, "meridian", "galley"), true);
  assert.equal(sys.jumpBlocked(game), null);
}

test("the reactor gauges and the Ship menu read the generator against the loads, and an old save's generator is running", () => {
  const game = newGame();
  const shown = publicState(game).shipSystems.find((one) => one.id === "power");
  assert.match(shown.note, /^The generator gives 100 power, and the ship draws 80/);
  const before = JSON.stringify(game);
  publicState(game);
  assert.equal(JSON.stringify(game), before, "reading the balance writes nothing");
  // A save from before the generator ran has no burning count, and runs from the next move of the clock.
  const old = newGame();
  clockRuns(old, 5);
  delete old.logistics.meridian.machines.generator.burning;
  assert.equal(powerSupply(old, "meridian"), 100);
  clockRuns(old, 5);
  assert.match(generator(old).status, /^running, 7 h 55 min on this fuel cell/);
  // The readouts log on the reactor gauges carries the same line.
  if (logLines) {
    const gauges = { logs: [{ id: "readouts", kind: "readouts", name: "The ship's readouts" }], place: "meridian" };
    const lines = logLines(game, { place: "meridian" }, gauges, gauges.logs[0]).map((one) => one.text ?? JSON.stringify(one));
    assert.ok(lines.some((one) => /generator gives 100 power/.test(one)), lines.join("\n"));
  }
});
