// The ship's logistics, step 3: people carry from one store to another when the second runs short. Their errand is
// written in world/logistics, they walk there and back through the life engine with their line saying so, and when
// there's nothing to fetch they stand at the store and wait. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-logistics-errands-"));
// The checker test writes another file, so the real one is copied first and never written.
const logisticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-logistics-errands-files-"));
fs.copyFileSync(new URL("../world/logistics/meridian.txt", import.meta.url), path.join(logisticsDir, "meridian.txt"));
process.env.GAME_LOGISTICS_DIR = logisticsDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const bag = await import("../src/bag.js");
const { errandDetour, errandsView, logisticsOf, logisticsProblems, storesView } = await import("../src/logistics.js");
const { clockRuns, passTime, publicState } = await import("../src/rules.js");
const { peopleAboard, rosterOf, whereNow } = await import("../src/life.js");
const { clearMaps } = await import("../src/walk.js");
const { reloadLogistics } = await import("../src/world.js");
const { readErrandLine } = await import("../public/logistics-text.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const FILE = fs.readFileSync(path.join(logisticsDir, "meridian.txt"), "utf8");
const storeOf = (id) => logisticsOf("meridian").stores.find((one) => one.id === id);
const count = (game, storeId, item) => storesView(game, "meridian").find((one) => one.id === storeId).items.find((one) => one.id === item)?.n ?? 0;
const take = (game, storeId, item, n) => bag.storeTake(game, storeOf(storeId).key, storeOf(storeId).holds, item, n);
const put = (game, storeId, item, n) => bag.storePut(game, storeOf(storeId).key, storeOf(storeId).holds, item, n);
// The quartermaster's errand: Brandt, while she holds the post.
const BRANDT = "quartermaster:ration_crate";
const errand = (game, id) => errandsView(game, "meridian").find((one) => one.id === id);
// A quarter of an hour at a time, in the five-minute pieces the clock is counted in, noting what Brandt's up to.
function watch(game, minutes, who = "odessa") {
  const seen = [];
  for (let gone = 0; gone < minutes; gone += 5) {
    clockRuns(game, 5);
    seen.push(whereNow(game, who));
  }
  return seen;
}

test("an errand's line is read into its pieces, numbers in words too, and a bad one says what's wrong", () => {
  assert.deepEqual(readErrandLine("Quartermaster Brandt: ration crates from the shuttle stores to the pantry when under 4, two at a time"),
    { who: "Quartermaster Brandt", what: "ration crates", from: "shuttle stores", to: "pantry", under: 4, each: 2 });
  assert.deepEqual(readErrandLine("Cook Imre: produce from the garden bins to the pantry when under 4, four at a time").each, 4);
  assert.deepEqual(readErrandLine("Someone: crates from the hold to the pantry when it's under 2"), { who: "Someone", what: "crates", from: "hold", to: "pantry", under: 2, each: 1 });
  assert.match(readErrandLine("Someone carries crates").problem, /needs a colon/);
  assert.match(readErrandLine("Someone: crates from the hold to the pantry").problem, /when under 4/);
  assert.match(readErrandLine("Someone: crates to the pantry when under 2").problem, /from a store, to a store/);
  assert.match(readErrandLine("Someone: crates from the hold to the pantry when under 2, twenty at a time").problem, /how many at a time/);
});

test("the Meridian's errands name their people, stores and items, and the checker catches a bad one", () => {
  const errands = logisticsOf("meridian").errands;
  assert.deepEqual(errands.map((one) => [one.id, one.key, one.item, one.from, one.to, one.under, one.each]), [
    ["tech_oona:fuel_cell", "Tech Oona", "fuel_cell", "shuttle_stores", "fuel_rack", 3, 2],
    [BRANDT, null, "ration_crate", "shuttle_stores", "pantry", 4, 2],
    ["cook_imre:produce", "Cook Imre", "produce", "garden_bins", "pantry", 4, 4],
    ["tech_sami:parts_crate", "Tech Sami", "parts_crate", "shuttle_stores", "parts_lockers", 2, 1],
  ]);
  assert.ok(rosterOf("meridian").some((one) => one.key === "Tech Oona" && one.name === "Tech Oona") && rosterOf("meridian").some((one) => one.key === "odessa" && one.id === "odessa"));
  try {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), [
      "# CFS Meridian", "", "Stores:", "- shuttle stores in The Lighter Bay: holds 20 ration crates, 12 fuel cells", "- pantry in The Galley: holds 12 ration crates", "", "Errands:",
      "- Nobody Special: ration crates from the shuttle stores to the pantry when under 4",
      "- Quartermaster Brandt: ration crates from the hold to the pantry when under 4",
      "- Quartermaster Brandt: fuel cells from the shuttle stores to the pantry when under 4",
      "- Quartermaster Brandt: ration crates from the shuttle stores to the pantry when under 20",
      "- Cook Imre: ration crates from the shuttle stores to the pantry when under 4, three at a time", ""].join("\n"));
    reloadLogistics();
    clearMaps();
    const problems = logisticsProblems();
    assert.ok(problems.some((one) => /line 8.*nobody called Nobody Special has a day/.test(one)), problems.join(" | "));
    assert.ok(problems.some((one) => /line 9.*no store called hold/.test(one)), problems.join(" | "));
    assert.ok(problems.some((one) => /line 10.*pantry doesn't keep fuel cells/.test(one)), problems.join(" | "));
    assert.ok(problems.some((one) => /line 11.*keeps only 12 ration crates.*never stop/.test(one)), problems.join(" | "));
    const sound = logisticsOf("meridian").errands;
    assert.deepEqual(sound.map((one) => [one.key, one.each]), [["Cook Imre", 3]], "the one sound errand is kept");
  } finally {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), FILE);
    reloadLogistics();
    clearMaps();
  }
});

test("when the pantry runs short, Brandt goes down to the lighter bay for crates, two at a time, and then back to her day", () => {
  const game = newGame();
  assert.equal(errand(game, BRANDT).status, "about their day");
  take(game, "pantry", "ration_crate", 12);
  const seen = watch(game, 90);
  assert.ok(seen.some((line) => /fetching ration crates from the shuttle stores/.test(line)), seen.join("\n"));
  assert.ok(seen.some((line) => /heading for the Lighter Bay/.test(line)), seen.join("\n"));
  assert.ok(seen.some((line) => /carrying 2 ration crates to the pantry/.test(line)), seen.join("\n"));
  assert.equal(count(game, "pantry", "ration_crate"), 4, "two trips of two, and four is enough");
  assert.equal(count(game, "shuttle_stores", "ration_crate"), 16);
  assert.equal(errand(game, BRANDT).status, "about their day");
  assert.match(whereNow(game, "odessa"), /counting the ration crates|watching the sittings|eating/);
  assert.equal(errandDetour(game, "meridian"), null, "nobody's on an errand once the pantry's right");
});

test("with nothing to fetch she waits at the shuttle stores, her line and the Ship menu say so, and when crates come she carries them", () => {
  const game = newGame();
  take(game, "pantry", "ration_crate", 12);
  take(game, "shuttle_stores", "ration_crate", 20);
  watch(game, 30);
  assert.equal(errand(game, BRANDT).status, "waiting at the shuttle stores for ration crates");
  assert.equal(publicState(game).ship.errands.find((one) => one.id === BRANDT).waiting, true);
  assert.match(whereNow(game, "odessa"), /waiting at the shuttle stores for ration crates, at the Lighter Bay/);
  assert.ok(peopleAboard(game, "meridian", "deck3").some((one) => one.id === "odessa" && /waiting at the shuttle stores/.test(one.doing)), "she's standing in the lighter bay");
  put(game, "shuttle_stores", "ration_crate", 5);
  watch(game, 45);
  assert.ok(count(game, "pantry", "ration_crate") >= 2, `${count(game, "pantry", "ration_crate")} crates reached the pantry`);
  assert.ok(count(game, "shuttle_stores", "ration_crate") < 5);
});

test("nobody runs an errand in their sleep, and the day's other errands go the same way", () => {
  const asleep = newGame();
  // The clock catches up to two in the morning with the pantry full, and only then is it emptied.
  asleep.clock.hours = 24 + 2;
  clockRuns(asleep, 1);
  take(asleep, "pantry", "ration_crate", 12);
  watch(asleep, 15);
  assert.equal(errand(asleep, BRANDT).status, "about their day", "Brandt sleeps until five");
  assert.equal(count(asleep, "pantry", "ration_crate"), 0);
  asleep.clock.hours = 24 + 6;
  watch(asleep, 5);
  assert.ok(count(asleep, "pantry", "ration_crate") >= 2, "and goes once she's up");
  // Imre fetches produce from the garden bins when the pantry's low on it.
  const produce = newGame();
  take(produce, "pantry", "produce", 12);
  watch(produce, 60, "Cook Imre");
  // Four came over, and the galley has cooked one of them in the meantime.
  assert.ok(count(produce, "pantry", "produce") >= 3, `${count(produce, "pantry", "produce")} produce in the pantry`);
  assert.ok(count(produce, "garden_bins", "produce") <= 8);
  // Oona keeps the fuel rack up from the shuttle stores, once she's on shift.
  const fuel = newGame();
  fuel.clock.hours = 10;
  take(fuel, "fuel_rack", "fuel_cell", 4);
  watch(fuel, 60, "Tech Oona");
  assert.equal(count(fuel, "fuel_rack", "fuel_cell"), 4, "two cells bring the rack to four, which is enough");
  assert.equal(count(fuel, "shuttle_stores", "fuel_cell"), 10);
});

test("away from the ship, the errands still get done, as everyone's day says, and the Ship menu lists them all", () => {
  const game = newGame();
  const stores = publicState(game).ship.errands;
  assert.deepEqual(stores.map((one) => [one.who, one.status, one.busy]), [["Tech Oona", "about their day", false], ["Quartermaster Brandt", "about their day", false], ["Cook Imre", "about their day", false], ["Tech Sami", "about their day", false]]);
  assert.equal(stores[1].does, "ration crates from the shuttle stores to the pantry when under 4, 2 at a time");
  const before = JSON.stringify(game);
  publicState(game);
  assert.equal(JSON.stringify(game), before, "reading the errands writes nothing");
  // With the captain elsewhere, the ship's people are where their days say, so a trip takes its minutes but no walking.
  game.location = "haven";
  take(game, "pantry", "ration_crate", 12);
  passTime(game, 1);
  assert.equal(count(game, "pantry", "ration_crate"), 4);
  assert.equal(count(game, "shuttle_stores", "ration_crate"), 16);
});
