// The ship's work board, and nobody counted in two places: someone at a repair, laid up or called away is given no
// job, a carrier who's called away hands the job back with whatever they'd loaded, and a walk takes as long as the
// way through the decks is, watched or not. (What raises the jobs, a store wanting something, is in
// test/store-wants.) The ship's file is a copy here with one group of carriers to a store, the techs for the fuel
// rack and the quartermaster for the pantry, so that it's plain who's meant to go. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-work-board-"));
const logisticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-work-board-files-"));
const OWN = fs.readFileSync(new URL("../world/logistics/meridian.txt", import.meta.url), "utf8");
const FILE = OWN
  .replace("carried by the deckhands, the techs, the spare hands: A rack", "carried by the techs: A rack")
  .replace("carried by the deckhands, the cooks, the quartermaster, the spare hands", "carried by the quartermaster");
assert.ok(FILE.includes("carried by the techs: A rack") && FILE.includes("wants 4 of each; carried by the quartermaster:"), "the ship's file is written as this test expects");
fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), FILE);
process.env.GAME_LOGISTICS_DIR = logisticsDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const bag = await import("../src/bag.js");
const cmd = await import("../src/command.js");
const sys = await import("../src/systems.js");
const medbay = await import("../src/medbay.js");
const { logisticsOf, storesView } = await import("../src/logistics.js");
const { workDetour, workView } = await import("../src/work.js");
const { clockRuns, passTime, publicState } = await import("../src/rules.js");
const { standsAt, walkMinutes, whereNow } = await import("../src/life.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const storeOf = (id) => logisticsOf("meridian").stores.find((one) => one.id === id);
const count = (game, storeId, item) => storesView(game, "meridian").find((one) => one.id === storeId).items.find((one) => one.id === item)?.n ?? 0;
const take = (game, storeId, item, n) => bag.storeTake(game, storeOf(storeId).key, storeOf(storeId).holds, item, n);
const at = (game, hours) => {
  game.clock.hours = hours;
  clockRuns(game, 1);
};
const minutes = (game, n) => {
  for (let gone = 0; gone < n; gone += 5) clockRuns(game, 5);
};
// The stores the jobs here carry to, and the Ship menu's lines for what they want.
const FUEL = "fuel_rack";
const PANTRY = "pantry";
const FUEL_LINE = "fuel_rack:fuel_cell";
const CRATES_LINE = "pantry:ration_crate";
const jobs = (game) => game.logistics.meridian.jobs ?? [];
const job = (game, store) => jobs(game).find((one) => one.to === store);
const shown = (game, id) => workView(game, "meridian").find((one) => one.id === id);
const techs = (game) => cmd.onJob(game, "meridian", "tech");
// Parts that take a repair, of rooms nothing else in these tests stands on.
const SPARE_PARTS = ["cameras:camera:bridge", "cameras:camera:aft", "alarm:speaker:bridge", "cameras:camera:engineering"];
// Calls someone to a repair in its last hour: the systems hand the repairs that are due to the engineers in turn, so
// as many parts are broken as it takes to reach them.
function callToRepair(game, key) {
  const engineers = sys.staffOf(game, "meridian", sys.systemsOf("meridian").engineers);
  const turn = engineers.indexOf(key);
  assert.ok(turn >= 0, `${key} is an engineer`);
  for (const id of SPARE_PARTS.slice(0, turn + 1)) {
    sys.damagePart(game, "meridian", id, "broken", { by: "story" });
    game.systems.meridian.parts[id].fixAt = game.clock.hours + 0.9;
  }
  assert.match(sys.dutyDetour(game, "meridian")(key)?.doing ?? "", /fetching|fixing/, `${key} is at a repair`);
}
// Nothing comes aboard from nowhere meanwhile, so that what's counted is only what's carried.
function withoutRefills(run) {
  const model = logisticsOf("meridian");
  const refills = model.refills;
  model.refills = [];
  try {
    return run();
  } finally {
    model.refills = refills;
  }
}
// Runs the clock five minutes at a time until a job is where the test wants it.
function until(game, store, phase, most = 60) {
  for (let gone = 0; gone < most && job(game, store)?.phase !== phase; gone += 5) clockRuns(game, 5);
  assert.equal(job(game, store)?.phase, phase, `the job got to ${phase}`);
  return job(game, store);
}

test("a tech at a repair is given nothing to carry, and the next tech goes", () => {
  const game = newGame();
  at(game, 10);
  const [first, second] = techs(game);
  callToRepair(game, first);
  take(game, FUEL, "fuel_cell", 5);
  minutes(game, 5);
  assert.equal(job(game, FUEL)?.by, second, "the second tech on the watch bill takes the fuel");
  assert.equal(workDetour(game, "meridian")(first), null, "and the first has no job");
  assert.match(whereNow(game, first), /fetching .* for the|fixing the/, "they're at the repair");
  assert.doesNotMatch(whereNow(game, first), /fuel cells/);
  assert.deepEqual(shown(game, FUEL_LINE).carriers, [second]);
  assert.match(shown(game, FUEL_LINE).status, new RegExp(`^${second} is fetching fuel cells from the shuttle stores, since \\d\\d:\\d\\d$`), "the Ship menu says who and since when");
  assert.equal(shown(game, FUEL_LINE).busy, true);
});

test("with every tech taken the job waits, the Ship menu says why, and it's taken up when one comes free", () => {
  const game = newGame();
  at(game, 10);
  const [only, ...others] = techs(game);
  for (const key of others) cmd.assignJob(game, "meridian", key, "deckhand");
  callToRepair(game, only);
  take(game, FUEL, "fuel_cell", 5);
  minutes(game, 15);
  assert.equal(job(game, FUEL), undefined, "nobody's carrying");
  assert.equal(count(game, FUEL, "fuel_cell"), 1);
  const stuck = shown(game, FUEL_LINE);
  assert.match(stuck.status, new RegExp(`^nobody free: ${only} is (fetching|fixing)`));
  assert.deepEqual([stuck.busy, stuck.stuck, stuck.carriers, stuck.by], [false, true, [], "the techs"]);
  // The repairs are done within the hour, and then the fuel is fetched.
  minutes(game, 120);
  assert.equal(sys.dutyDetour(game, "meridian"), null, "the repairs are done");
  assert.equal(count(game, FUEL, "fuel_cell"), 3, "one trip of two brings the rack to three, which is enough");
  assert.equal(shown(game, FUEL_LINE).status, "nothing to carry");
});

test("a carrier called away before loading hands the job to the next free hand", () => {
  const game = newGame();
  at(game, 10);
  take(game, FUEL, "fuel_cell", 5);
  minutes(game, 5);
  const carrier = job(game, FUEL).by;
  assert.equal(job(game, FUEL).phase, "going");
  callToRepair(game, carrier);
  minutes(game, 5);
  const next = job(game, FUEL);
  assert.ok(next, "there's still a job for the rack");
  assert.notEqual(next.by, carrier, "with someone else on it");
  assert.ok(techs(game).includes(next.by));
  assert.equal(next.phase, "going");
  assert.equal(jobs(game).length, 1, "and only the one");
  assert.equal(workDetour(game, "meridian")(carrier), null);
});

test("called away with a load, it's set down, and the next free hand carries it on: nothing lost, nothing doubled", () => withoutRefills(() => {
  const game = newGame();
  at(game, 10);
  const [only, ...others] = techs(game);
  for (const key of others) cmd.assignJob(game, "meridian", key, "deckhand");
  take(game, FUEL, "fuel_cell", 5);
  const cells = () => count(game, FUEL, "fuel_cell") + count(game, "shuttle_stores", "fuel_cell") + (job(game, FUEL)?.load?.n ?? 0);
  const all = cells();
  const carrying = until(game, FUEL, "carrying");
  assert.deepEqual([carrying.by, carrying.load], [only, { item: "fuel_cell", n: 2 }]);
  assert.equal(cells(), all);
  callToRepair(game, only);
  minutes(game, 5);
  assert.deepEqual([job(game, FUEL).phase, job(game, FUEL).by, job(game, FUEL).load], ["down", null, { item: "fuel_cell", n: 2 }], "set down, with nobody on it");
  assert.equal(cells(), all, "the cells are with the job, not gone");
  assert.equal(jobs(game).length, 1, "and no second job is raised for cells that are already on their way");
  assert.match(shown(game, FUEL_LINE).status, new RegExp(`^2 fuel cells set down; nobody free: ${only} is (fetching|fixing)`));
  assert.equal(workDetour(game, "meridian"), null, "and nobody is walked anywhere for it");
  // Once the repair's done the same tech picks them up and carries them on.
  minutes(game, 120);
  assert.equal(job(game, FUEL), undefined);
  assert.equal(count(game, FUEL, "fuel_cell"), 3);
  assert.equal(cells(), all);
}));

test("someone laid up carries nothing, and the Ship menu says who's down", () => {
  const game = newGame();
  at(game, 10);
  const spot = standsAt(game, "meridian", "odessa");
  assert.ok(medbay.fallDown(game, { who: "odessa", place: "meridian", ...spot, why: "out cold", hours: 8 }));
  take(game, PANTRY, "ration_crate", 12);
  minutes(game, 30);
  assert.equal(job(game, PANTRY), undefined, "Brandt isn't sent for crates while she's down");
  assert.equal(count(game, PANTRY, "ration_crate"), 0);
  assert.match(shown(game, CRATES_LINE).status, /^nobody free: Quartermaster Brandt is (down|laid up in the medbay|being patched up)$/);
  assert.equal(shown(game, CRATES_LINE).stuck, true);
  assert.doesNotMatch(whereNow(game, "odessa"), /ration crates/);
});

test("bad air doesn't turn a carrier aside, though it would anyone else headed there", () => {
  const game = newGame();
  at(game, 10);
  take(game, FUEL, "fuel_cell", 5);
  minutes(game, 5);
  const carrier = job(game, FUEL).by;
  // The systems' own shape for a place, as they make it the first time something there changes.
  game.systems ??= {};
  game.systems.meridian ??= { at: game.clock.hours, parts: {}, doors: {}, air: {}, alarm: {}, noted: {} };
  game.systems.meridian.air.engineering = 5;
  assert.match(sys.detourFor(game, "meridian")(carrier, "engineering", false)?.doing ?? "", /getting out of the bad air/, "the systems would send them out");
  assert.match(whereNow(game, carrier), /fetching fuel cells from the shuttle stores/, "but they're on a job, and keep at it");
});

test("a walk takes the minutes of the way through the decks, watched or not, and the same however the hour is cut", () => {
  const game = newGame();
  const there = walkMinutes(game, "meridian", "Tech Oona", "store:shuttle_stores", "store:fuel_rack");
  const back = walkMinutes(game, "meridian", "Tech Oona", "store:fuel_rack", "store:shuttle_stores");
  assert.ok(there > 1 && there < 15, `${there} minutes from the shuttle stores to the fuel rack`);
  assert.ok(Math.abs(there - back) < 1, "about as far back as there");
  assert.ok(walkMinutes(game, "meridian", "odessa", null, "store:shuttle_stores", 10) > there, "Brandt has further to go, from the deck above");
  assert.equal(walkMinutes(game, "meridian", "odessa", null, "store:nowhere", 10), null, "and nobody can say how far it is to a store that isn't there");
  // With the captain ashore, a trip isn't made in no time: about ten minutes down, five to load, ten back, counted
  // in the clock's five-minute pieces. (The pace is Brandt's own: a made-up body can have a bad knee.)
  const away = newGame();
  at(away, 10);
  away.location = "haven";
  take(away, PANTRY, "ration_crate", 12);
  const inPieces = (walk) => Math.ceil(walk / 5) * 5;
  const trip = inPieces(walkMinutes(away, "meridian", "odessa", null, "store:shuttle_stores")) + 5 + inPieces(walkMinutes(away, "meridian", "odessa", "store:shuttle_stores", "store:pantry"));
  assert.ok(trip >= 25, `a trip is ${trip} minutes`);
  passTime(away, (trip - 5) / 60);
  assert.equal(count(away, PANTRY, "ration_crate"), 0, `no crates before the ${trip} minutes of the trip are up`);
  passTime(away, 15 / 60);
  assert.equal(count(away, PANTRY, "ration_crate"), 2, "and two once they are");
  // The same two hours, in one go and in five-minute pieces, leave the same crates in the same stores.
  const once = newGame(7);
  const pieces = newGame(7);
  pieces.bodySeed = once.bodySeed;
  for (const one of [once, pieces]) {
    at(one, 9);
    one.location = "haven";
    take(one, PANTRY, "ration_crate", 12);
    take(one, FUEL, "fuel_cell", 5);
  }
  passTime(once, 2);
  for (let gone = 0; gone < 120; gone += 5) passTime(pieces, 5 / 60);
  for (const [store, item] of [[PANTRY, "ration_crate"], ["shuttle_stores", "ration_crate"], [FUEL, "fuel_cell"], ["shuttle_stores", "fuel_cell"]]) {
    assert.equal(count(pieces, store, item), count(once, store, item), `${item} in the ${store}`);
  }
});

test("a job kept by a save of before the stores said what they want is settled, and reading the board writes nothing", () => withoutRefills(() => {
  const game = newGame();
  at(game, 10);
  take(game, PANTRY, "ration_crate", 12);
  take(game, "shuttle_stores", "ration_crate", 2);
  // As the errands kept it: by the errand's own name, with two crates on someone's shoulder.
  delete game.logistics.meridian.jobs;
  game.logistics.meridian.errands = { "quartermaster:ration_crate": { phase: "carrying", since: game.logistics.meridian.at, load: { item: "ration_crate", n: 2 }, by: "odessa" } };
  const crates = () => count(game, PANTRY, "ration_crate") + count(game, "shuttle_stores", "ration_crate") + jobs(game).reduce((sum, one) => sum + (one.load?.n ?? 0), 0);
  const before = JSON.stringify(game);
  const work = publicState(game).ship.work;
  assert.equal(JSON.stringify(game), before, "reading the board writes nothing");
  assert.deepEqual(work.map((one) => one.id), [FUEL_LINE, CRATES_LINE, "pantry:produce", "medicine_cabinet:medicine_crate", "parts_lockers:parts_crate"], "a line for everything a store wants");
  minutes(game, 5);
  assert.equal(game.logistics.meridian.errands, undefined, "the old job is gone");
  assert.equal(crates(), 20, "and its two crates are back in the stores, none lost and none doubled");
  minutes(game, 90);
  assert.equal(count(game, PANTRY, "ration_crate"), 4, "Brandt brought the pantry up to what it wants");
  assert.equal(crates(), 20);
  // And when nothing's due and nobody's called, the systems say so at once.
  assert.equal(sys.dutyDetour(newGame(), "meridian"), null);
}));
