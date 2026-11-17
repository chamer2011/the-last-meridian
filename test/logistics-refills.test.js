// The ship's logistics, step 5: a store whose refill says "from nothing" is topped up on the hour, each refill written
// in the manifest, and the Ship menu's food, medicine and parts are the rooms' stores and nothing else: the kettle eats
// the food, the medbay and the engineers take a crate when they've used one up, and buying puts crates into the stores.
// None of this calls an AI.
//
// Since the ports hold real amounts the Meridian's own file has her restocked at a dock (test/living-off-ports.test.js),
// but a file can still say from nothing. So the copy these tests run on says what hers said before: the shuttle stores
// as big as they were, and filled from nothing.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-logistics-refills-"));
const logisticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-logistics-refills-files-"));
const HERS = fs.readFileSync(new URL("../world/logistics/meridian.txt", import.meta.url), "utf8");
const FROM_NOTHING = HERS
  .replace("holds 24 ration crates, 36 fuel cells, 6 parts crates", "holds 20 ration crates, 12 fuel cells, 6 parts crates")
  .replace("ration crates and fuel cells from the dock, every 6 hours", "ration crates and fuel cells from nothing for now, every 6 hours");
assert.ok(FROM_NOTHING.includes("holds 20 ration crates, 12 fuel cells") && FROM_NOTHING.includes("from nothing for now"), "the ship's file has changed: these tests' copy of it needs looking at");
fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), FROM_NOTHING);
process.env.GAME_LOGISTICS_DIR = logisticsDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const bag = await import("../src/bag.js");
const { countAboard, logisticsOf, logisticsProblems, manifestLines, mealsView, putAboard, refillsView, storesView, takeAboard } = await import("../src/logistics.js");
const { clockRuns, passTime, publicState } = await import("../src/rules.js");
const { SHIP_ID, shipCommand, storyHitsShip } = await import("../src/ship.js");
const { clearMaps, walkCommand, walkView } = await import("../src/walk.js");
const { reloadLogistics } = await import("../src/world.js");
const { readRefillLine } = await import("../public/logistics-text.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const FILE = fs.readFileSync(path.join(logisticsDir, "meridian.txt"), "utf8");
const storeOf = (id) => logisticsOf("meridian").stores.find((one) => one.id === id);
const count = (game, storeId, item) => storesView(game, "meridian").find((one) => one.id === storeId).items.find((one) => one.id === item)?.n ?? 0;
const take = (game, storeId, item, n) => bag.storeTake(game, storeOf(storeId).key, storeOf(storeId).holds, item, n);
const supply = (game, id) => publicState(game).ship.supplies.find((one) => one.id === id);
const atHour = (game, hours) => { game.clock.hours = hours; clockRuns(game, 1); };

test("a refill's line is read into its pieces, and a bad one says what's wrong", () => {
  assert.deepEqual(readRefillLine("the shuttle stores: ration crates and fuel cells from nothing for now, every 6 hours, up to full"),
    { store: "shuttle stores", what: ["ration crates", "fuel cells"], from: "nothing", every: 360, upTo: "full" });
  assert.deepEqual(readRefillLine("pantry: produce from nothing every day, up to 10").upTo, 10);
  assert.match(readRefillLine("shuttle stores get crates").problem, /needs a colon/);
  assert.match(readRefillLine("the shuttle stores: ration crates every 6 hours").problem, /where it comes from/);
  // From the dock is how the ship's own file has it now: bought at whatever port she's docked at.
  assert.deepEqual(readRefillLine("the shuttle stores: ration crates and fuel cells from the dock, every 6 hours, up to full"),
    { store: "shuttle stores", what: ["ration crates", "fuel cells"], from: "dock", every: 360, upTo: "full" });
  assert.match(readRefillLine("the shuttle stores: ration crates from the moon every 6 hours").problem, /from the dock, or from nothing/);
  assert.match(readRefillLine("the shuttle stores: ration crates from nothing").problem, /how often/);
});

test("the Meridian's refill knows its store and items, and the checker catches a bad one", () => {
  const model = logisticsOf("meridian");
  assert.deepEqual(model.refills.map((one) => [one.store, one.items, one.every, one.upTo]), [["shuttle_stores", ["ration_crate", "fuel_cell"], 360, "full"], ["water_tank", ["water"], 360, "full"]]);
  assert.deepEqual(model.problems, []);
  try {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), ["# CFS Meridian", "", "Stores:", "- shuttle stores in The Lighter Bay: holds 20 ration crates, 12 fuel cells", "- soup kettle in The Long Mess: holds 400 sittings", "", "Refills:",
      "- the hold: ration crates from nothing every 6 hours", "- the soup kettle: sittings from nothing every hour", "- the shuttle stores: medicine crates from nothing every 6 hours", "- the shuttle stores: fuel cells from nothing every day, up to 4", ""].join("\n"));
    reloadLogistics();
    clearMaps();
    const problems = logisticsProblems();
    assert.ok(problems.some((one) => /line 8.*no store called hold to refill/.test(one)), problems.join(" | "));
    assert.ok(problems.some((one) => /line 9.*holds sittings, not things that come aboard/.test(one)), problems.join(" | "));
    assert.ok(problems.some((one) => /line 10.*shuttle stores doesn't keep medicine crates/.test(one)), problems.join(" | "));
    assert.deepEqual(logisticsOf("meridian").refills.map((one) => [one.items, one.every, one.upTo]), [[["fuel_cell"], 1440, 4]], "the one sound refill is kept");
  } finally {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), FILE);
    reloadLogistics();
    clearMaps();
  }
});

test("on the hour the shuttle stores are topped up from nothing, the manifest says so, and a full store gets nothing", () => {
  const game = newGame();
  take(game, "shuttle_stores", "ration_crate", 10);
  take(game, "shuttle_stores", "fuel_cell", 6);
  atHour(game, 11 + 55 / 60);
  assert.equal(count(game, "shuttle_stores", "ration_crate"), 10, "nothing comes between the hours");
  assert.deepEqual(manifestLines(game, "meridian"), []);
  // The clock is counted in five-minute pieces, so the hour's piece is in once five past has gone by.
  atHour(game, 12 + 5 / 60);
  assert.equal(count(game, "shuttle_stores", "ration_crate"), 20);
  assert.equal(count(game, "shuttle_stores", "fuel_cell"), 12);
  assert.deepEqual(manifestLines(game, "meridian"), ["Day 1, 12:00: 10 ration crates and 6 fuel cells came aboard into the shuttle stores."]);
  const shown = refillsView(game, "meridian");
  assert.equal(shown[0].store, "Shuttle stores");
  assert.equal(shown[0].does, "ration crates and fuel cells from nothing, every 6 hours, up to full");
  assert.match(shown[0].last, /^Day 1, 12:00: 10 ration crates and 6 fuel cells came aboard/);
  // The clip on the shuttle stores carries it, and so does the reactor gauges' manifest log.
  walkCommand(game, { action: "room", to: "lighter" });
  const clip = walkView(game).things.find((one) => one.name === "Shuttle stores").look;
  assert.match(clip, /The manifest says: Day 1, 12:00: 10 ration crates and 6 fuel cells came aboard into the shuttle stores\.$/);
  assert.ok(publicState(game).ship.refills[0].last.startsWith("Day 1, 12:00"));
  // Full at six, so nothing comes; parts crates never do.
  take(game, "shuttle_stores", "parts_crate", 3);
  atHour(game, 18 + 5 / 60);
  assert.equal(manifestLines(game, "meridian").length, 1);
  assert.equal(count(game, "shuttle_stores", "parts_crate"), 3, "parts aren't on the refill line");
});

test("the hour is met when the clock started between the minutes, as it does in play, and the manifest says the hour", () => {
  const game = newGame();
  take(game, "shuttle_stores", "ration_crate", 4);
  atHour(game, 11 + 52.4 / 60);
  // In play the clock runs by the second, so the pieces of five minutes don't start on the minute, let alone the hour.
  game.logistics.meridian.at = 11 * 60 + 57.3;
  atHour(game, 12 + 4 / 60);
  assert.equal(count(game, "shuttle_stores", "ration_crate"), 20, "the piece from 11:57 to 12:02 has the hour in it");
  assert.deepEqual(manifestLines(game, "meridian"), ["Day 1, 12:00: 4 ration crates came aboard into the shuttle stores."]);
  atHour(game, 12 + 9 / 60);
  assert.equal(manifestLines(game, "meridian").length, 1, "and only once");
});

test("the Ship menu's food, medicine and parts are the rooms' stores: counted in crates, eaten at the kettle, taken as they're used", () => {
  const game = newGame();
  const food = supply(game, "food");
  assert.deepEqual([food.stock, food.max, food.unit], [56, 56, "crates"], "every crate and basket in the pantry, the shuttle stores and the garden bins");
  assert.ok(food.used >= 8.9 && food.used <= 9.1, `${food.used} crates a day at nine hundred mouths`);
  assert.equal(food.days, null, "holding: the refills from nothing bring more than the kettle eats, so there are no days to count");
  assert.equal(food.made, food.used);
  // Nothing refills the medicine, but it goes a dose at a time through the medbay, and a well ship takes few doses.
  assert.ok(supply(game, "medicine").days > 200, `medicine for ${supply(game, "medicine").days} days`);
  assert.deepEqual([supply(game, "medicine").stock, supply(game, "medicine").max], [5, 5]);
  assert.deepEqual([supply(game, "parts").stock, supply(game, "parts").max], [12, 12]);
  takeAboard(game, SHIP_ID, "ration_crate", 20);
  assert.equal(supply(game, "food").stock, 36, "and the count follows the stores at once");
  // Nine days on, the medbay has opened one crate from the cabinet, to treat Vik's leg and Hana's burns, and the ship
  // takes no daily crate of its own: the medicine goes a dose at a time.
  const before = JSON.stringify(game);
  publicState(game);
  assert.equal(JSON.stringify(game), before, "reading changes nothing");
  passTime(game, 24 * 9, "routine");
  // And the doctor's rounds take one of their own if anyone aboard has fallen seriously ill, which is up to the seed.
  const forTheRounds = game.medbay.meridian.rounds === undefined ? 0 : 1;
  assert.equal(countAboard(game, SHIP_ID, ["medicine_crate"]).n, 4 - forTheRounds);
  assert.equal(game.ship.owed.medicine ?? 0, 0);
  assert.ok(countAboard(game, SHIP_ID, ["parts_crate"]).n >= 10, "the engineers take a crate about once a week");
  // The shuttle stores are kept full and Brandt keeps the pantry at about four crates, while the produce goes as fast
  // as the garden grows it: the food settles at twenty-odd crates, holding.
  assert.ok(supply(game, "food").stock > 20, `${supply(game, "food").stock} crates, while the refills and the errands keep the food up`);
  assert.equal(supply(game, "food").days, null);
});

test("while a store is out nothing's owed, so the first crates to come aboard aren't swallowed by the days without", () => {
  const game = newGame();
  takeAboard(game, SHIP_ID, "medicine_crate", 999);
  passTime(game, 24 * 20, "routine");
  assert.ok(game.ship.out.medicine >= 1, "out of medicine");
  assert.equal(game.ship.owed.medicine ?? 0, 0);
  putAboard(game, SHIP_ID, "medicine_crate", 3);
  passTime(game, 24 * 2, "routine");
  // The medbay opens one for Vik and Hana, who waited twenty days for it, and the doctor's rounds take one of their own
  // if anyone on the register has fallen seriously ill since, which is up to the game's seed.
  const forTheRounds = game.medbay.meridian.rounds === undefined ? 0 : 1;
  assert.equal(countAboard(game, SHIP_ID, ["medicine_crate"]).n, 2 - forTheRounds, "the rest still in the cabinet");
  assert.equal(game.ship.out.medicine, undefined);
  assert.equal(game.ship.owed.medicine ?? 0, 0, "nothing's owed: the medbay takes its doses from the crate it's opened");
});

test("buying puts crates into the stores that keep them, selling takes them out, and a story's food is ten crates a unit", () => {
  const game = newGame();
  game.ship.at = "haven";
  game.location = "haven";
  game.credits = 10000;
  assert.throws(() => shipCommand(game, { action: "buy", id: "food" }), /no room aboard/);
  takeAboard(game, SHIP_ID, "ration_crate", 5, ["shuttle_stores"]);
  const { message } = shipCommand(game, { action: "buy", id: "food" });
  assert.match(message, /Bought 5 crates of food/);
  assert.equal(count(game, "shuttle_stores", "ration_crate"), 20, "into the shuttle stores first");
  shipCommand(game, { action: "sell", id: "medicine" });
  assert.equal(countAboard(game, SHIP_ID, ["medicine_crate"]).n, 4);
  const crates = countAboard(game, SHIP_ID, ["ration_crate"]).n;
  storyHitsShip(game, { food: -1 });
  assert.equal(countAboard(game, SHIP_ID, ["ration_crate"]).n, crates - 10);
  storyHitsShip(game, { food: 1 });
  assert.equal(countAboard(game, SHIP_ID, ["ration_crate"]).n, crates);
  storyHitsShip(game, { parts: -2 });
  assert.equal(countAboard(game, SHIP_ID, ["parts_crate"]).n, 10);
});

test("the rations stretch or cut what each sitting takes from the kettle", () => {
  const game = newGame();
  assert.equal(mealsView(game, "meridian").aSitting, 450);
  assert.ok(supply(game, "food").used >= 8.9 && supply(game, "food").used <= 9.1);
  shipCommand(game, { action: "rations", id: "half" });
  assert.equal(mealsView(game, "meridian").aSitting, 225);
  assert.ok(supply(game, "food").used >= 4.4 && supply(game, "food").used <= 4.6);
  shipCommand(game, { action: "rations", id: "generous" });
  assert.ok(Math.abs(mealsView(game, "meridian").aSitting - 562.5) <= 1);
  assert.equal(publicState(game).ship.rations.find((one) => one.id === "generous").foodUsed, 11.25);
});
