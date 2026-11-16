// The logistics rework, step 3: nobody writes the routes any more. A store's line says what it wants kept in it, when
// that's urgent and who carries for it, and the ship's work board does the rest: a job comes up whenever a store has
// fewer than it wants, it's fetched from the nearest store that can spare it, by the first of the store's carriers
// who's free, the deckhands before anyone else, as many at once as the want needs. Where nothing aboard can be spared
// nobody is sent to stand at an empty store. An urgent want comes first, and wakes a sleeper. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-store-wants-"));
// Some tests write another file, so the real one is copied first and never written.
const logisticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-store-wants-files-"));
fs.copyFileSync(new URL("../world/logistics/meridian.txt", import.meta.url), path.join(logisticsDir, "meridian.txt"));
process.env.GAME_LOGISTICS_DIR = logisticsDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const bag = await import("../src/bag.js");
const cmd = await import("../src/command.js");
const medbay = await import("../src/medbay.js");
const { logisticsOf, logisticsProblems, storesView } = await import("../src/logistics.js");
const { workDetour, workView } = await import("../src/work.js");
const { clockRuns, passTime, publicState } = await import("../src/rules.js");
const { clearLife, notAbout, standsAt, walkMinutes, whereNow } = await import("../src/life.js");
const { clearMaps } = await import("../src/walk.js");
const { reloadLogistics } = await import("../src/world.js");
const { parseLogisticsText, readCarriers, readStoreLine, readTrip, writeLogisticsText, writeStoreLine } = await import("../public/logistics-text.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const FILE = fs.readFileSync(path.join(logisticsDir, "meridian.txt"), "utf8");
const storeOf = (id) => logisticsOf("meridian").stores.find((one) => one.id === id);
const count = (game, storeId, item) => storesView(game, "meridian").find((one) => one.id === storeId).items.find((one) => one.id === item)?.n ?? 0;
const take = (game, storeId, item, n) => bag.storeTake(game, storeOf(storeId).key, storeOf(storeId).holds, item, n);
const put = (game, storeId, item, n) => bag.storePut(game, storeOf(storeId).key, storeOf(storeId).holds, item, n);
const jobs = (game) => game.logistics.meridian.jobs ?? [];
const line = (game, id) => workView(game, "meridian").find((one) => one.id === id);
const at = (game, hours) => {
  game.clock.hours = hours;
  clockRuns(game, 1);
};
// Five minutes at a time, as the clock is counted, noting what some people are up to on the way.
function watch(game, minutes, who = []) {
  const seen = [];
  for (let gone = 0; gone < minutes; gone += 5) {
    clockRuns(game, 5);
    for (const one of who) seen.push(whereNow(game, one));
  }
  return seen;
}
// The game with the ship's file written another way, and the real words put back afterwards.
function withFile(change, run) {
  const text = change(FILE);
  assert.notEqual(text, FILE, "the file was changed for this test");
  // As the Story board does when it saves the file: the stores are stood in the rooms again, with their spots.
  const again = () => {
    reloadLogistics();
    clearMaps();
    clearLife();
  };
  fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), text);
  again();
  try {
    return run();
  } finally {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), FILE);
    again();
  }
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
const up = (game, keys) => keys.filter((key) => !notAbout(game, "meridian", key, game.clock.hours));

test("a store's line says what it wants, when that's urgent and who carries, with semicolons or commas between", () => {
  const pantry = readStoreLine("pantry in The Galley: holds 12 ration crates, 12 produce; wants 4 of each; urgent under 2 ration crates; carried by the deckhands, then the cooks, the spare hands: Shelves behind a wire door.");
  assert.deepEqual(pantry, {
    name: "pantry", room: "The Galley", holds: [{ n: 12, what: "ration crates" }, { n: 12, what: "produce" }],
    wants: [{ n: 4, what: null }], urgent: [{ n: 2, what: "ration crates" }], carriers: ["the deckhands", "the cooks", "the spare hands"], look: "Shelves behind a wire door.",
  });
  // As the plan's page first sketched it, with commas all the way.
  const rack = readStoreLine("fuel rack in Engineering: holds 6 fuel cells, wants 4, urgent under 2, carried by the deckhands");
  assert.deepEqual([rack.holds, rack.wants, rack.urgent, rack.carriers], [[{ n: 6, what: "fuel cells" }], [{ n: 4, what: null }], [{ n: 2, what: null }], ["the deckhands"]]);
  assert.deepEqual(readStoreLine("pantry in The Galley: holds 12 ration crates, 12 produce; wants 4 ration crates, 3 produce").wants, [{ n: 4, what: "ration crates" }, { n: 3, what: "produce" }]);
  assert.match(readStoreLine("pantry in The Galley: holds 12 ration crates; wants plenty").problem, /"plenty" should be a number/);
  assert.match(readStoreLine("pantry in The Galley: wants 4").problem, /needs holds after the colon/);
  // Written back, a line reads the same.
  const written = writeStoreLine(pantry);
  assert.equal(written, "pantry in The Galley: holds 12 ration crates, 12 produce; wants 4; urgent under 2 ration crates; carried by the deckhands, the cooks, the spare hands: Shelves behind a wire door.");
  assert.deepEqual(readStoreLine(written), pantry);
  assert.deepEqual(readCarriers("the deckhands, then the cooks; and the spare hands"), ["the deckhands", "the cooks", "the spare hands"]);
  assert.deepEqual(readTrip("2 ration crates, 4 produce").list, [{ n: 2, what: "ration crates" }, { n: 4, what: "produce" }]);
  assert.match(readTrip("a few crates").problem, /should be a number and what it is/);
  // The two lines at the top are read, and written back where they were.
  const { value, problems } = parseLogisticsText(FILE, "meridian");
  assert.deepEqual(problems, []);
  assert.match(writeLogisticsText(value), /\ncarried by: the deckhands, the spare hands\na trip carries: 2 ration crates, 2 fuel cells, 4 produce, 1 parts crate, 1 medicine crate\n/);
});

test("the Meridian's stores say what they want, and the checker catches a bad line", () => {
  const model = logisticsOf("meridian");
  assert.deepEqual(logisticsProblems(), []);
  assert.deepEqual(model.wants.map((one) => [one.store, one.item, one.wants, one.urgent]), [
    ["fuel_rack", "fuel_cell", 3, 2],
    ["pantry", "ration_crate", 4, 0],
    ["pantry", "produce", 4, 0],
    ["medicine_cabinet", "medicine_crate", 2, 0],
    ["parts_lockers", "parts_crate", 2, 0],
  ]);
  assert.deepEqual(model.trip, { ration_crate: 2, fuel_cell: 2, produce: 4, parts_crate: 1, medicine_crate: 1 });
  const who = (id) => storeOf(id).carriers.map((one) => one.job ?? one.post ?? (one.spare ? "spare" : one.key));
  assert.deepEqual(who("fuel_rack"), ["deckhand", "tech", "spare"]);
  assert.deepEqual(who("pantry"), ["deckhand", "cook", "quartermaster", "spare"]);
  assert.deepEqual(who("medicine_cabinet"), ["deckhand", "nurse", "spare"]);
  assert.deepEqual([storeOf("shuttle_stores").wants, storeOf("garden_bins").wants], [{}, {}], "the shuttle stores and the garden's bins want nothing: they're only taken from");
  assert.equal(model.errands, undefined, "and there are no errands");
  withFile(() => [
    "# CFS Meridian", "carried by: the deckhands, the navigators", "a trip carries: 2 ration crates, 3 gold bars", "", "Stores:",
    "- shuttle stores in The Lighter Bay: holds 20 ration crates, 12 fuel cells",
    "- pantry in The Galley: holds 12 ration crates; wants 20",
    "- fuel rack in Engineering: holds 6 fuel cells; wants 3; urgent under 5",
    "- parts lockers in Stores: holds 6 parts crates; urgent under 2",
    "- garden bins in The Garden: holds 12 produce; wants 4 ration crates",
    "- soup kettle in The Long Mess: holds 400 sittings; wants 100",
    "- medicine cabinet in Medbay: holds 5 medicine crates; wants 2; carried by Nobody Special",
    "- larder in The Long Mess: holds 6 ration crates; wants 2; carried by Tech Oona, the quartermaster", "",
    "Errands:", "- a tech: fuel cells from the shuttle stores to the fuel rack when under 3, two at a time", ""].join("\n"), () => {
    const problems = logisticsProblems();
    const has = (pattern) => assert.ok(problems.some((one) => pattern.test(one)), `${pattern} in: ${problems.join(" | ")}`);
    has(/line 2.*nobody called the navigators is a job or a post/);
    has(/line 3.*no item called gold bars/);
    has(/line 7.*holds only 12 ration crates, so it can't want 20/);
    has(/line 8.*urgent under is the smaller number/);
    has(/line 9.*not how many it wants: write wants first/);
    has(/line 10.*wants 4 ration crates, which it doesn't hold/);
    has(/line 11.*holds sittings, which nobody carries/);
    has(/line 12.*nobody called Nobody Special/);
    has(/line 15.*the Errands part isn't written any more/);
    const sound = logisticsOf("meridian");
    assert.deepEqual(sound.wants.map((one) => [one.store, one.item, one.wants]), [["larder", "ration_crate", 2]], "the one sound want is kept");
    assert.deepEqual(sound.stores.find((one) => one.id === "larder").carriers.map((one) => one.key ?? one.post), ["Tech Oona", "quartermaster"], "carried for by someone named and by a post");
  });
});

test("when the pantry runs short the deckhands fetch crates, as many at once as it needs, and go back to their day", () => {
  const game = newGame();
  at(game, 16);
  const deckhands = cmd.onJob(game, "meridian", "deckhand");
  assert.ok(up(game, deckhands).length >= 2, "two deckhands or more are up in the afternoon");
  assert.equal(line(game, "pantry:ration_crate").status, "nothing to carry");
  assert.deepEqual([line(game, "pantry:ration_crate").does, line(game, "pantry:ration_crate").by], ["12 ration crates, wants 4", "the deckhands, then the cooks, then the quartermaster, then the spare hands"]);
  take(game, "pantry", "ration_crate", 12);
  clockRuns(game, 5);
  const [first, second] = up(game, deckhands);
  assert.deepEqual(jobs(game).map((one) => [one.to, one.from, one.item, one.n, one.by, one.phase]), [
    ["pantry", "shuttle_stores", "ration_crate", 2, first, "going"],
    ["pantry", "shuttle_stores", "ration_crate", 2, second, "going"],
  ], "two go at once, two crates each, and the four they've gone for are set aside");
  assert.match(line(game, "pantry:ration_crate").status, new RegExp(`^${first} is fetching ration crates from the shuttle stores, since 16:0\\d; ${second} is fetching ration crates`));
  const seen = watch(game, 60, [first, "odessa"]);
  assert.ok(seen.some((words) => /fetching ration crates from the shuttle stores/.test(words)), seen.join("\n"));
  assert.ok(seen.some((words) => /carrying 2 ration crates to the pantry/.test(words)), seen.join("\n"));
  assert.ok(!seen.some((words) => /^Quartermaster Brandt.*ration crates (from|to) the/.test(words)), "Brandt stays at her own work");
  assert.equal(count(game, "pantry", "ration_crate"), 4, "one trip each, and four is what it wants");
  assert.equal(count(game, "shuttle_stores", "ration_crate"), 16);
  assert.equal(line(game, "pantry:ration_crate").status, "nothing to carry");
  assert.deepEqual(jobs(game), []);
  assert.equal(workDetour(game, "meridian"), null, "nobody's carrying once the pantry's right");
  assert.doesNotMatch(whereNow(game, first), /ration crates/);
});

test("with nothing aboard to spare nobody stands at an empty store, the Ship menu says so, and when crates come they're carried", () => withoutRefills(() => {
  const game = newGame();
  at(game, 16);
  take(game, "pantry", "ration_crate", 12);
  take(game, "shuttle_stores", "ration_crate", 20);
  const seen = watch(game, 30, cmd.onJob(game, "meridian", "deckhand"));
  assert.deepEqual(jobs(game), [], "nobody's sent");
  assert.ok(!seen.some((words) => /shuttle stores/.test(words)), "and nobody's standing at the shuttle stores");
  const stuck = line(game, "pantry:ration_crate");
  assert.deepEqual([stuck.status, stuck.stuck, stuck.busy, stuck.urgent], ["nothing aboard to bring", true, false, null], "there's produce to cook, so it isn't urgent");
  assert.equal(publicState(game).ship.work.find((one) => one.id === "pantry:ration_crate").status, "nothing aboard to bring");
  put(game, "shuttle_stores", "ration_crate", 5);
  watch(game, 60);
  assert.equal(count(game, "pantry", "ration_crate"), 4);
  assert.equal(count(game, "shuttle_stores", "ration_crate"), 1);
}));

test("a second larder is kept stocked without another line, from the nearest store that can spare it", () => withoutRefills(() => {
  withFile((text) => text.replace("- garden bins in The Garden", "- larder in The Long Mess: holds 6 ration crates; wants 2\n- garden bins in The Garden"), () => {
    assert.deepEqual(logisticsProblems(), []);
    const larder = storeOf("larder");
    assert.deepEqual(larder.carriers.map((one) => one.words), ["the deckhands", "the spare hands"], "carried for by the file's own carried by line");
    const game = newGame();
    at(game, 16);
    // Which of the two stores with crates is nearer the larder, as anyone would walk it.
    const far = (from) => walkMinutes(game, "meridian", null, `store:${from}`, "store:larder");
    const [near, other] = far("pantry") <= far("shuttle_stores") ? ["pantry", "shuttle_stores"] : ["shuttle_stores", "pantry"];
    take(game, "larder", "ration_crate", 6);
    clockRuns(game, 5);
    assert.deepEqual(jobs(game).map((one) => [one.to, one.from, one.n]), [["larder", near, 2]], `one trip of two, from the ${near}`);
    watch(game, 60);
    assert.equal(count(game, "larder", "ration_crate"), 2);
    // The pantry gives only what it has over what it wants itself: at four, it's left alone.
    take(game, "larder", "ration_crate", 2);
    take(game, "pantry", "ration_crate", count(game, "pantry", "ration_crate") - 4);
    clockRuns(game, 5);
    assert.deepEqual(jobs(game).map((one) => [one.to, one.from]), [["larder", "shuttle_stores"]], "the pantry has none to spare, so it's the shuttle stores");
    assert.ok(["pantry", "shuttle_stores"].includes(other));
    watch(game, 90);
    assert.equal(count(game, "larder", "ration_crate"), 2);
    assert.equal(count(game, "pantry", "ration_crate"), 4, "and the pantry still has what it wants");
  });
}));

test("an urgent want is given out first, and wakes someone when nobody's up", () => {
  // One group of carriers to a store, the cooks, who all sleep through the small hours, and no mark on the rack.
  withFile((text) => text
    .replace("wants 3; urgent under 2; carried by the deckhands, the techs, the spare hands", "wants 3; carried by the cooks")
    .replace("carried by the deckhands, the cooks, the quartermaster, the spare hands", "carried by the cooks"), () => {
    const game = newGame();
    at(game, 24 + 2);
    const cooks = cmd.onJob(game, "meridian", "cook");
    assert.deepEqual(up(game, cooks), [], "the cooks are asleep at two in the morning");
    // The pantry out of crates, with produce left to cook: it can wait for the morning.
    take(game, "pantry", "ration_crate", 12);
    watch(game, 15);
    assert.deepEqual(jobs(game), []);
    assert.deepEqual([line(game, "pantry:ration_crate").status, line(game, "pantry:ration_crate").urgent], ["nobody free: 2 are asleep", null]);
    // The rack one short of what it wants: that can wait too.
    take(game, "fuel_rack", "fuel_cell", count(game, "fuel_rack", "fuel_cell") - 2);
    watch(game, 5);
    assert.deepEqual(jobs(game), []);
    // The pantry bare: the galley has nothing to work from, which is urgent, and a cook is woken for it.
    take(game, "pantry", "produce", count(game, "pantry", "produce"));
    watch(game, 5);
    assert.match(line(game, "pantry:ration_crate").urgent, /^urgent: the galley has nothing to work from$/);
    assert.deepEqual(jobs(game).map((one) => [one.to, one.item, one.n, cooks.includes(one.by)]), [["pantry", "ration_crate", 2, true], ["pantry", "ration_crate", 2, true]], "both cooks are woken for the four crates it wants, and the rack, which isn't urgent, waits");
    assert.notEqual(jobs(game)[0].by, jobs(game)[1].by);
    assert.match(whereNow(game, jobs(game)[0].by), /fetching ration crates from the shuttle stores/);
    assert.equal(line(game, "fuel_rack:fuel_cell").status, "nobody free: 2 are fetching ration crates from the shuttle stores");
    // The rack empty: the generator is on its last cell, and that's urgent whatever the rack's line says.
    const dark = newGame();
    at(dark, 24 + 2);
    take(dark, "fuel_rack", "fuel_cell", count(dark, "fuel_rack", "fuel_cell"));
    watch(dark, 5);
    assert.equal(line(dark, "fuel_rack:fuel_cell").urgent, "urgent: the generator is on its last");
    assert.deepEqual(jobs(dark).map((one) => [one.to, one.n, cooks.includes(one.by)]), [["fuel_rack", 2, true], ["fuel_rack", 2, true]], "two are woken, for the three it wants");
  });
  // On the ship as she's written the rack's own line says when: under two.
  const game = newGame();
  at(game, 10);
  take(game, "fuel_rack", "fuel_cell", 5);
  assert.equal(line(game, "fuel_rack:fuel_cell").urgent, "urgent: under 2");
  assert.equal(line(game, "fuel_rack:fuel_cell").does, "1 fuel cell, wants 3");
});

test("urgent wants nobody can carry count against the deck chief's duty, and a quiet night doesn't", () => {
  withFile((text) => text
    .replace("wants 3; urgent under 2; carried by the deckhands, the techs, the spare hands", "wants 3; urgent under 2; carried by the quartermaster")
    .replace("carried by the deckhands, the cooks, the quartermaster, the spare hands", "carried by the quartermaster"), () => {
    const waited = (game) => Object.values(game.command?.meridian?.tally ?? {}).reduce((sum, day) => sum + (day.errandsWaiting ?? 0), 0);
    // A night with the pantry short of crates and Brandt asleep: nothing urgent, nothing counted.
    const quiet = newGame();
    at(quiet, 24 + 2);
    take(quiet, "pantry", "ration_crate", 12);
    watch(quiet, 60);
    assert.equal(waited(quiet), 0);
    // The rack nearly bare with Brandt laid up: urgent, and nobody to carry it.
    const stuck = newGame();
    at(stuck, 10);
    assert.ok(medbay.fallDown(stuck, { who: "odessa", place: "meridian", ...standsAt(stuck, "meridian", "odessa"), why: "out cold", hours: 8 }));
    take(stuck, "fuel_rack", "fuel_cell", 5);
    watch(stuck, 60);
    assert.deepEqual(jobs(stuck), []);
    assert.ok(waited(stuck) >= 50, `${waited(stuck)} minutes of an urgent job left waiting`);
    assert.match(line(stuck, "fuel_rack:fuel_cell").status, /^nobody free: Quartermaster Brandt is /);
  });
});

test("away from the ship the carrying still gets done, and the Ship menu lists what every store wants", () => {
  const game = newGame();
  at(game, 16);
  const work = publicState(game).ship.work;
  assert.deepEqual(work.map((one) => [one.store, one.item, one.has, one.wants, one.status, one.busy, one.stuck]), [
    ["Fuel rack", "fuel_cell", count(game, "fuel_rack", "fuel_cell"), 3, "nothing to carry", false, false],
    ["Pantry", "ration_crate", 12, 4, "nothing to carry", false, false],
    ["Pantry", "produce", count(game, "pantry", "produce"), 4, "nothing to carry", false, false],
    ["Medicine cabinet", "medicine_crate", count(game, "medicine_cabinet", "medicine_crate"), 2, "nothing to carry", false, false],
    ["Parts lockers", "parts_crate", 6, 2, "nothing to carry", false, false],
  ]);
  const before = JSON.stringify(game);
  publicState(game);
  assert.equal(JSON.stringify(game), before, "reading the board writes nothing");
  // With the captain elsewhere nobody's walked step by step, and the trips still take the minutes of their walks.
  game.location = "haven";
  take(game, "pantry", "ration_crate", 12);
  take(game, "fuel_rack", "fuel_cell", count(game, "fuel_rack", "fuel_cell") - 1);
  passTime(game, 1.5);
  assert.equal(count(game, "pantry", "ration_crate"), 4);
  assert.equal(count(game, "shuttle_stores", "ration_crate"), 16);
  assert.equal(count(game, "fuel_rack", "fuel_cell"), 3);
  assert.deepEqual(jobs(game), []);
});
