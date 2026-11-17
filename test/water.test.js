// The logistics rework, step 11: water and air aboard. The ship keeps her water in a tank in the Pump Room, which
// everyone aboard drinks from and the galley, the Garden and the air plant take theirs out of; the pumps bring most
// of it back, so it goes several times as fast while they're stopped. Low on water the quartermaster rations it; with
// none the galley can't cook, nothing grows, and the air plant stops making air, so the ship breathes her reserve.
// The tank is filled at a dock from the purse, with the port's own water. The reserve air is real tanks in Life
// Support: breathed while the air plant is stopped, used to fill a breached room again, and filled again from water.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-water-"));
const logisticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-water-files-"));
fs.copyFileSync(new URL("../world/logistics/meridian.txt", import.meta.url), path.join(logisticsDir, "meridian.txt"));
process.env.GAME_LOGISTICS_DIR = logisticsDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const bag = await import("../src/bag.js");
const em = await import("../src/emergencies.js");
const { logisticsOf, logisticsProblems, machinesView, powerSupply, storeById, storesView, takeAboard } = await import("../src/logistics.js");
const { amountOf, portsModel } = await import("../src/ports.js");
const { airSpoiled } = await import("../src/room-hooks.js");
const { addItem, passTime } = await import("../src/rules.js");
const { shipView } = await import("../src/ship.js");
const sys = await import("../src/systems.js");
const water = await import("../src/water.js");
const { clearMaps, walkCommand, walkView } = await import("../src/walk.js");
const { reloadLogistics } = await import("../src/world.js");
const text = await import("../public/logistics-text.js");

const SHIP = "meridian";
const FILE = fs.readFileSync(path.join(logisticsDir, "meridian.txt"), "utf8");
// A captain past the opening, who doesn't breathe (so a ship left without air doesn't end the game), on a ship where
// nothing wears out by itself: the pumps only stop when a test stops them.
const newGame = (seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  game.character.species = "synthetic";
  game.wearDay = Infinity;
  return game;
};
const model = () => logisticsOf(SHIP);
const tank = () => storeById(model(), model().water.tank);
const inTank = (game) => storesView(game, SHIP).find((one) => one.id === "water_tank").count.n;
const setTank = (game, n) => { (game.stores ??= {})[tank().key] = { count: n }; };
// The generator never runs out of cells.
const keepPower = (game) => { game.logistics.meridian.machines.generator = { progress: 0, made: 0, waiting: null, burning: 1e9 }; };
const hours = (game, n) => passTime(game, n, "routine");
const minutes = (game, n) => passTime(game, n / 60, "routine");
const toHour = (game, hour) => passTime(game, (((hour - (game.clock.hours % 24)) % 24) + 24) % 24 || 24, "routine");
const inRoom = (game, room) => {
  game.walk = null;
  walkCommand(game, { action: "room", to: room });
};
const thing = (game, name) => walkView(game).things.find((one) => one.name === name);
const run = (game, name, id) => walkCommand(game, { action: id, key: thing(game, name).id });
const machine = (game, id) => machinesView(game, SHIP).find((one) => one.id === id);
const part = (kind) => Object.values(sys.systemsOf(SHIP).parts).find((one) => one.kind === kind);
const pumps = () => Object.values(sys.systemsOf(SHIP).parts).find((one) => one.system === "water");
const RESERVE = 5 * 24 * 60;
const useReserve = (game, minutesUsed) => {
  game.systems ??= {};
  game.systems.meridian ??= { at: game.clock.hours, parts: {}, doors: {}, air: {}, alarm: {}, noted: {} };
  game.systems.meridian.reserve = minutesUsed;
};
// A port's stock of something set to so many.
const leave = (game, port, good, n) => { ((game.world.ports ??= {})[port] ??= {})[good] = (n / portsModel().ports[port].holds[good].usual) * 100; };
const some = (lines, pattern) => assert.ok(lines.some((one) => pattern.test(one)), `${pattern} in: ${lines.join(" | ") || "nothing"}`);
const none = (lines, pattern) => assert.ok(!lines.some((one) => pattern.test(one)), `${pattern} shouldn't be in: ${lines.join(" | ")}`);

test("the file's words for water and reserve air are read, and written back as they were", () => {
  const tankLine = text.readStoreLine("water tank in The Pump Room: holds 800 measures of water: A tank.");
  assert.deepEqual([tankLine.name, tankLine.room, tankLine.holds], ["water tank", "The Pump Room", [{ n: 800, what: "measures of water" }]]);
  const reserve = text.readStoreLine("reserve tanks in Life Support: holds the reserve air: Bottles.");
  assert.deepEqual([reserve.reserve, reserve.holds], [true, []]);
  assert.equal(text.writeStoreLine(reserve), "reserve tanks in Life Support: holds the reserve air: Bottles.");
  const garden = text.readMachineLine("garden: grows 1 produce into the garden bins every 2 hours, with power, someone tending it and 1 water");
  assert.deepEqual(garden.needs, { power: true, worker: "someone tending it", water: 1 });
  const plant = text.readMachineLine("air plant in Engineering: takes 1 water from the water tank every 3 hours, with power");
  assert.deepEqual([plant.room, plant.takes, plant.from, plant.gives, plant.every], ["Engineering", [{ n: 1, what: "water" }], "water tank", null, 180]);
  assert.deepEqual(text.readRefillLine("the water tank: water from the dock, every 6 hours, up to full"), { store: "water tank", what: ["water"], from: "dock", every: 360, upTo: "full" });
  // The ship's own file, whole.
  const { value, problems } = text.parseLogisticsText(FILE);
  assert.deepEqual(problems, []);
  assert.deepEqual([value.numbers.drinks, value.numbers.tankFills, value.numbers.pumpsStopped, value.numbers.rationUnder, value.numbers.tankAir, value.numbers.airTakes, value.numbers.breachAir, value.numbers.breachSlow], [9, 100, 4, 200, 24, 4, 6, 3]);
  assert.equal(text.writeLogisticsText(value), FILE);
  // A number that isn't one says how it's written.
  const bad = text.parseLogisticsText("# X\nwater is rationed under: lots\n");
  assert.match(bad.problems[0].message, /water is rationed under is a number of measures, such as water is rationed under: 200 measures/);
});

test("the ship has a water tank in the Pump Room and reserve tanks in Life Support, both full, and pumps among her systems", () => {
  const game = newGame();
  assert.deepEqual(logisticsProblems(), []);
  const w = model().water;
  assert.deepEqual([w.tank, w.reserve, w.plant, w.drinks, w.tankFills, w.pumpsStopped, w.rationUnder], ["water_tank", "reserve_tanks", "air_plant", 9, 100, 4, 200]);
  const stores = storesView(game, SHIP);
  const kept = (id) => stores.find((one) => one.id === id);
  assert.deepEqual([kept("water_tank").room, kept("water_tank").count], ["The Pump Room", { n: 800, of: 800, unit: "measures of water" }]);
  assert.deepEqual([kept("reserve_tanks").room, kept("reserve_tanks").count], ["Life Support", { n: 120, of: 120, unit: "hours of air" }]);
  // Each is a thing in its room.
  inRoom(game, "pumps");
  assert.ok(thing(game, "Water tank"), walkView(game).things.map((one) => one.name).join(", "));
  inRoom(game, "lifesupport");
  assert.ok(thing(game, "Reserve tanks"), walkView(game).things.map((one) => one.name).join(", "));
  // The pumps are a part of the ship, in the Pump Room, and draw nothing the generator has to find.
  assert.deepEqual([pumps().name, pumps().room, pumps().kind], ["pumps", "pumps", "machine"]);
  assert.equal(sys.powerBalance(game, SHIP).load, 80);
  assert.equal(water.pumpsStopped(game, SHIP), false);
  // The air plant is a machine now, which takes water.
  assert.match(machine(game, "air_plant").does, /^takes 1 measure of water from the water tank every 3 hours$/);
  assert.match(machine(game, "air_plant").status, /^running, 3 h 0 min on the water it has$/);
  // And the Ship menu has both.
  const view = shipView(game);
  assert.deepEqual([view.water.n, view.water.of, view.water.holding, view.water.rationed, view.water.pumps, view.water.fills], [800, 800, false, false, null, 100]);
  assert.ok(view.water.days >= 20 && view.water.days <= 30, `the tank lasts about 25 days: ${view.water.days}`);
  assert.deepEqual([view.air.hours, view.air.of, view.air.full, view.air.stopped, view.air.breathing], [120, 120, true, false, false]);
});

test("everyone drinks, and the galley, the Garden and the air plant take theirs: about thirty measures a day", () => {
  const game = newGame();
  keepPower(game);
  for (let day = 0; day < 5; day += 1) hours(game, 24);
  const used = 800 - inTank(game);
  assert.ok(used >= 5 * 24 && used <= 5 * 40, `five days took ${used} measures`);
  // The air plant alone takes one every three hours while it runs.
  const made = game.logistics.meridian.machines.air_plant.made;
  assert.ok(made >= 38 && made <= 41, `the air plant took ${made}`);
  // Fewer aboard drink less: half the people, half of the nine.
  const before = shipView(game).water.aDay;
  game.ship.aboard = 450;
  assert.ok(Math.abs(before - shipView(game).water.aDay - 4.5) < 0.11, `${before} and then ${shipView(game).water.aDay}`);
});

test("with the pumps stopped nothing that's used comes back, and the water goes four times as fast", () => {
  const game = newGame();
  const control = newGame();
  for (const one of [game, control]) {
    keepPower(one);
    // Nothing to mend the pumps with, so they stay as they're left.
    takeAboard(one, SHIP, "parts_crate", 999);
    hours(one, 1);
  }
  const [was, wasControl] = [inTank(game), inTank(control)];
  sys.damagePart(game, SHIP, pumps().id, "broken", { by: "story" });
  const said = hours(game, 24);
  hours(control, 24);
  some(said, /^\[SHIP\] The pumps have stopped, and nothing that's used is coming back: the water's going 4 times as fast\.$/);
  const [fast, usual] = [was - inTank(game), wasControl - inTank(control)];
  assert.ok(fast >= usual * 3.4 && fast <= usual * 4.6, `${fast} measures with the pumps stopped against ${usual}`);
  assert.equal(shipView(game).water.pumps, 4);
  assert.ok(shipView(game).water.days < shipView(control).water.days / 3);
  // Mended, they run again, and it's said once.
  sys.repairPart(game, SHIP, pumps().id);
  some(hours(game, 0.2), /^\[SHIP\] The pumps are running again\.$/);
  none(hours(game, 0.2), /pumps/);
  assert.equal(shipView(game).water.pumps, null);
  // With nothing aboard powered, they're stopped too.
  const dark = newGame();
  dark.logistics.meridian.machines.generator = { progress: 0, made: 0, waiting: "the fuel rack has no fuel cells", burning: 0 };
  assert.equal(powerSupply(dark, SHIP), 0);
  assert.equal(water.pumpsStopped(dark, SHIP), true);
});

test("low on water, the quartermaster puts it on ration: everyone gets half, and so does whatever grows", () => {
  const game = newGame();
  keepPower(game);
  const usual = shipView(game).water.aDay;
  setTank(game, 190);
  some(hours(game, 1), /^\[SHIP\] Quartermaster Brandt has put water on ration: \d+ measures are left in the water tank\. Everyone gets half, and so does whatever grows\.$/);
  const view = shipView(game).water;
  assert.deepEqual([view.rationed, view.by], [true, "Quartermaster Brandt"]);
  assert.ok(view.aDay < usual - 6, `${view.aDay} a day against ${usual}`);
  const of = (id) => model().machines.find((one) => one.id === id);
  assert.deepEqual([water.waterSlows(game, SHIP, of("garden")), water.waterSlows(game, SHIP, of("galley"))], [0.5, 1]);
  assert.ok(game.ship.log.some((one) => /has put water on ration/.test(one.text)));
  // It stays on while the tank is only a little over the mark, and comes off once it's well over.
  setTank(game, 240);
  none(hours(game, 9), /ration/);
  setTank(game, 420);
  some(hours(game, 9), /^\[SHIP\] Quartermaster Brandt has taken water off ration: there are \d+ measures in the water tank again\.$/);
  assert.equal(shipView(game).water.rationed, false);
  // At a dock that sells water nobody rations it: the dock keeps the tank up.
  const docked = newGame();
  docked.ship.at = "haven";
  hours(docked, 0.1);
  setTank(docked, 190);
  none(hours(docked, 5), /ration/);
  assert.equal(shipView(docked).water.rationed, false);
});

test("with no water the galley can't cook and nothing grows, and it's said once", () => {
  const game = newGame();
  keepPower(game);
  setTank(game, 0);
  // Room for what they'd make.
  game.stores[storeById(model(), "soup_kettle").key] = { count: 0 };
  const bins = storeById(model(), "garden_bins");
  bag.storeTake(game, bins.key, bins.holds, "produce", 99);
  const said = toHour(game, 17.5);
  some(said, /^\[SHIP\] The water tank is empty\. The galley can't cook and nothing grows, and when the air plant has used what it had, it stops\. In open space nothing comes\.$/);
  assert.equal(said.filter((one) => /water tank is empty/.test(one)).length, 1);
  none(said, /on ration/);
  assert.equal(shipView(game).water.rationed, false, "nobody rations an empty tank");
  const idle = ["galley", "garden"].map((id) => machine(game, id).status);
  assert.ok(idle.includes("the water tank has no water"), idle.join(" | "));
  assert.equal(machine(game, "galley").made + machine(game, "garden").made, 0, "nothing was cooked or picked");
  // Water again, and it's said, and they go on.
  setTank(game, 300);
  some(hours(game, 0.2), /^\[SHIP\] There's water in the water tank again\.$/);
  hours(game, 26);
  assert.ok(machine(game, "galley").made + machine(game, "garden").made > 0, "they cook and grow again");
});

test("when the tank is empty the air plant stops making air, and the ship breathes her reserve until there's water", () => {
  const game = newGame();
  keepPower(game);
  setTank(game, 0);
  const said = hours(game, 4);
  some(said, /^\[AIR\] The air plant has no water to make air from, and has stopped\. The ship is breathing reserve air now: there's 5 days of it, and after that nobody lasts more than a few hours\.$/);
  const air = shipView(game).air;
  assert.deepEqual([air.stopped, air.dry, air.breathing, air.out], [true, true, true, false]);
  assert.ok(air.hours >= 118 && air.hours < 120, `${air.hours} hours of reserve air left`);
  assert.equal(water.plantFed(game, SHIP), false);
  assert.match(sys.lookAt(game, SHIP, part("air plant")), /Its fans are turning over nothing: there's no water in the water tank for it to make air from\./);
  assert.equal(machine(game, "air_plant").status, "stopped: the water tank has no water");
  assert.equal(shipView(game).water.plant, false);
  // Every room still has air while the reserve lasts.
  assert.equal(sys.airFlows(game, SHIP, "bridge"), true);
  // Water again: it runs, and fills the reserve again.
  setTank(game, 400);
  some(hours(game, 6), /^\[AIR\] The ship's reserve air is full again\.$/);
  assert.equal(water.plantFed(game, SHIP), true);
  assert.deepEqual([shipView(game).air.full, shipView(game).air.stopped], [true, false]);
  // Left with none for good, the reserve runs out like any other.
  const lost = newGame();
  keepPower(lost);
  setTank(lost, 0);
  useReserve(lost, RESERVE - 120);
  some(hours(lost, 6), /^\[AIR\] The reserve air has run out\. With the air plant still stopped, the air's going everywhere\.$/);
  assert.equal(sys.airFlows(lost, SHIP, "bridge"), false);
  assert.deepEqual([shipView(lost).air.out, shipView(lost).air.hours], [true, 0]);
});

test("filling the reserve tanks again takes water: four measures for a day of air", () => {
  const game = newGame();
  const control = newGame();
  for (const one of [game, control]) keepPower(one);
  useReserve(game, RESERVE);
  assert.equal(shipView(game).air.hours, 0);
  const said = hours(game, 26);
  hours(control, 26);
  some(said, /^\[AIR\] The ship's reserve air is full again\.$/);
  const more = inTank(control) - inTank(game);
  assert.ok(more >= 18 && more <= 22, `the five days of reserve air took ${more} measures`);
});

test("a patched breach is filled again out of the reserve tanks, or slowly by the air plant when they're empty", () => {
  const game = newGame();
  keepPower(game);
  toHour(game, 10);
  inRoom(game, "boat_bay");
  em.startBreach(game, SHIP, "boat_bay");
  minutes(game, 10);
  addItem(game, "emergency_patch");
  const said = walkCommand(game, { action: "patch-breach" }).said.split("\n");
  some(said, /^\[AIR\] The Boat Bay is filled again out of the reserve tanks: 6 hours of their air went into it\.$/);
  const left = sys.reserveLeft(game, SHIP);
  assert.ok(left >= RESERVE - 360 && left < RESERVE - 200, `${left} minutes of reserve air after the room was filled`);
  assert.equal(airSpoiled(game, SHIP, "boat_bay"), false);
  // With nothing in the tanks the air plant does it alone, and the room's air stays bad meanwhile.
  const slow = newGame();
  keepPower(slow);
  toHour(slow, 10);
  inRoom(slow, "boat_bay");
  em.startBreach(slow, SHIP, "boat_bay");
  minutes(slow, 10);
  useReserve(slow, RESERVE);
  addItem(slow, "emergency_patch");
  const told = walkCommand(slow, { action: "patch-breach" }).said.split("\n");
  some(told, /^\[AIR\] There isn't the reserve air to fill the Boat Bay again: the air plant will take about 3 hours over it\.$/);
  assert.equal(airSpoiled(slow, SHIP, "boat_bay"), true);
  const later = hours(slow, 3);
  some(later, /^\[AIR\] The Boat Bay has air again\.$/);
  assert.equal(airSpoiled(slow, SHIP, "boat_bay"), false);
});

test("at a dock that sells water the tank is kept up from the purse, with the port's own water; in open space nothing comes", () => {
  const game = newGame();
  game.ship.at = "haven";
  hours(game, 0.1);
  setTank(game, 600);
  const had = amountOf(game.world, "haven", "water");
  assert.equal(shipView(game).water.holding, true);
  assert.ok(shipView(game).money.dock.water >= 1);
  const said = hours(game, 6.5);
  const line = said.find((one) => /of water bought/.test(one));
  assert.match(line ?? said.join(" | "), /^\[TRADE\] 2 tanks of water bought at Haven Station for \d+ credits, into the water tank\. The purse holds \d+\.$/);
  const cost = Number(line.match(/for (\d+) credits/)[1]);
  assert.ok(cost >= 4 && cost <= 12, `two tanks cost ${cost}`);
  assert.ok(inTank(game) >= 780 && inTank(game) <= 800, `${inTank(game)} in the tank`);
  assert.ok(Math.abs(had - amountOf(game.world, "haven", "water") - 2) < 0.01, "two tanks left Haven's own stock");
  // A port with none sells none.
  const bare = newGame();
  bare.ship.at = "haven";
  hours(bare, 0.1);
  setTank(bare, 600);
  leave(bare, "haven", "water", 0);
  assert.equal(shipView(bare).water.holding, false);
  none(hours(bare, 6.5), /of water bought/);
  assert.ok(inTank(bare) < 600);
  // And in open space nothing comes.
  const away = newGame();
  setTank(away, 700);
  none(hours(away, 13), /of water bought/);
  assert.ok(inTank(away) < 700);
});

test("a tank of water can be poured in by hand, and a full reserve tank fitted", () => {
  const game = newGame();
  setTank(game, 650);
  addItem(game, "water", 2);
  inRoom(game, "pumps");
  const pour = () => thing(game, "Water tank").does.find((one) => one.id === "pour-water");
  assert.deepEqual([pour().label, pour().detail, Boolean(pour().disabled)], ["Pour in a tank of water", "100 measures", false]);
  assert.match(run(game, "Water tank", "pour-water").said, /^You pour the tank of water into the water tank: 750 of 800 measures in it now\.$/);
  assert.deepEqual([inTank(game), game.inventory.water], [750, 1]);
  // There isn't the room for another.
  assert.deepEqual([pour().detail, pour().disabled], ["there isn't the room in it", true]);
  assert.throws(() => run(game, "Water tank", "pour-water"), /isn't the room in the water tank/);
  assert.equal(game.inventory.water, 1);
  // With none left to pour, it says so.
  game.inventory.water = 0;
  assert.deepEqual([pour().detail, pour().disabled], ["you aren't carrying one", true]);
  game.inventory.water = 1;
  // The reserve: a full tank in place of an empty one.
  inRoom(game, "lifesupport");
  const fit = () => thing(game, "Reserve tanks").does.find((one) => one.id === "fit-reserve-tank");
  // It's offered there whether or not there's a tank to fit, greyed with why not.
  assert.deepEqual([fit().label, fit().detail, fit().disabled], ["Fit a full reserve tank", "you aren't carrying one", true]);
  assert.throws(() => run(game, "Reserve tanks", "fit-reserve-tank"), /no full tank to fit/);
  addItem(game, "reserve_tank", 2);
  assert.deepEqual([fit().detail, fit().disabled], ["they're full", true]);
  useReserve(game, 48 * 60);
  assert.deepEqual([fit().detail, Boolean(fit().disabled)], ["24 hours of air", false]);
  assert.match(run(game, "Reserve tanks", "fit-reserve-tank").said, /^You fit the full tank in place of an empty one\. The reserve air stands at 96 of 120 hours\.$/);
  assert.deepEqual([game.inventory.reserve_tank, sys.reserveLeft(game, SHIP)], [1, RESERVE - 24 * 60]);
});

test("a game from before the ship kept her water is told once how it goes now", () => {
  const game = newGame();
  delete game.logistics.meridian.water;
  const said = hours(game, 0.2).filter((one) => /keeps her water/.test(one));
  assert.equal(said.length, 1);
  assert.match(said[0], /^\[SHIP\] From now on the ship keeps her water in the water tank in The Pump Room: 800 measures, which everyone aboard drinks from, and the galley, the Garden and the air plant use\. It's filled at a dock out of the ship's purse, like her crates and cells, and in open space nothing comes\. Her reserve air is in the reserve tanks in Life Support\. The Ship menu has both\.$/);
  none(hours(game, 0.2), /keeps her water/);
  none(hours(newGame(), 0.2), /keeps her water/);
});

test("left alone in open space, the power still runs out before the water does", () => {
  const game = newGame();
  for (let day = 0; day < 16; day += 1) hours(game, 24);
  assert.equal(powerSupply(game, SHIP), 0, "the generator has burned its last cell");
  assert.ok(inTank(game) > 200, `${inTank(game)} measures still in the tank`);
});

test("the checker says what's wrong with a file's water", () => {
  const problemsOf = (change) => {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), change(FILE));
    reloadLogistics();
    clearMaps();
    return logisticsProblems();
  };
  try {
    // The numbers with no tank to drink from.
    const noTank = problemsOf((file) => file.replace(/^- water tank .*\n/m, "").replace(/^- air plant .*\n/m, "").replace(/^- the water tank: .*\n/m, "").replace(/, someone tending it and 1 water/, " and someone tending it").replace(/, a cook there and 1 water/, " and a cook there"));
    assert.ok(noTank.some((one) => /everyone aboard drinks is written, and no store holds measures of water/.test(one)), noTank.join(" | "));
    assert.ok(noTank.some((one) => /water is rationed under is written, and no store holds measures of water/.test(one)), noTank.join(" | "));
    // A machine that needs water, with no tank.
    const thirsty = problemsOf((file) => file.replace(/^- water tank .*\n/m, "").replace(/^- air plant .*\n/m, "").replace(/^- the water tank: .*\n/m, ""));
    assert.ok(thirsty.some((one) => /the garden needs water, and no store holds measures of water/.test(one)), thirsty.join(" | "));
    // Rationed under more than the tank holds.
    const always = problemsOf((file) => file.replace("water is rationed under: 200 measures", "water is rationed under: 900 measures"));
    assert.ok(always.some((one) => /water is rationed under 900 measures, and the water tank holds only 800: it would always be rationed/.test(one)), always.join(" | "));
    // Two tanks.
    const two = problemsOf((file) => file.replace(/^(- water tank .*\n)/m, "$1- second tank in Stores: holds 100 measures of water\n"));
    assert.ok(two.some((one) => /second tank/.test(one)), two.join(" | "));
  } finally {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), FILE);
    reloadLogistics();
    clearMaps();
  }
  assert.deepEqual(logisticsProblems(), []);
});
