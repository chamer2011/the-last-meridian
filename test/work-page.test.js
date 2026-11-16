// The logistics rework, step 4: the officers give the work board its orders, and the Work page shows it all. The
// first officer puts first the part of the ship in the most trouble, as often as their skill lets them look, and the
// quartermaster raises what a store wants after it has run low and eases it back when it's been quiet. With a post
// empty nobody decides. Any job nobody's on can be the player's: the crew leaves it to them for a while, and it's in
// the corner like a quest. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-work-page-"));
// Some tests write another file, so the real one is copied first and never written.
const logisticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-work-page-files-"));
fs.copyFileSync(new URL("../world/logistics/meridian.txt", import.meta.url), path.join(logisticsDir, "meridian.txt"));
process.env.GAME_LOGISTICS_DIR = logisticsDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const bag = await import("../src/bag.js");
const cmd = await import("../src/command.js");
const medbay = await import("../src/medbay.js");
const { logisticsOf, logisticsProblems, storesView } = await import("../src/logistics.js");
const { boardView, workCommand, workView } = await import("../src/work.js");
const { clockRuns, passTime, publicState } = await import("../src/rules.js");
const { clearLife, notAbout, standsAt } = await import("../src/life.js");
const { clearMaps } = await import("../src/walk.js");
const { reloadLogistics } = await import("../src/world.js");
const { parseLogisticsText, readDecider, writeLogisticsText } = await import("../public/logistics-text.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const FILE = fs.readFileSync(path.join(logisticsDir, "meridian.txt"), "utf8");
const storeOf = (id) => logisticsOf("meridian").stores.find((one) => one.id === id);
const count = (game, storeId, item) => storesView(game, "meridian").find((one) => one.id === storeId).items.find((one) => one.id === item)?.n ?? 0;
const take = (game, storeId, item, n) => bag.storeTake(game, storeOf(storeId).key, storeOf(storeId).holds, item, n);
const put = (game, storeId, item, n) => bag.storePut(game, storeOf(storeId).key, storeOf(storeId).holds, item, n);
const jobs = (game) => game.logistics.meridian.jobs ?? [];
const orders = (game) => game.logistics.meridian.orders ?? {};
const board = (game) => boardView(game, "meridian");
const at = (game, hours) => {
  game.clock.hours = hours;
  clockRuns(game, 1);
};
// Five minutes at a time, as the clock is counted, gathering what the story's told.
function run(game, minutes) {
  const said = [];
  for (let gone = 0; gone < minutes; gone += 5) {
    const told = clockRuns(game, 5);
    said.push(...(Array.isArray(told) ? told : told?.notes ?? []));
  }
  return said;
}
// Runs the clock until something holds, and says how many minutes that took.
function until(game, holds, most = 300) {
  let gone = 0;
  for (; gone < most && !holds(); gone += 5) clockRuns(game, 5);
  assert.ok(holds(), `it came about within ${most} minutes`);
  return gone;
}
// The game with the ship's file written another way, and the real words put back afterwards.
function withFile(change, play) {
  const text = change(FILE);
  assert.notEqual(text, FILE, "the file was changed for this test");
  const again = () => {
    reloadLogistics();
    clearMaps();
    clearLife();
  };
  fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), text);
  again();
  try {
    return play();
  } finally {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), FILE);
    again();
  }
}
// Nothing comes aboard from nowhere meanwhile.
function withoutRefills(play) {
  const model = logisticsOf("meridian");
  const refills = model.refills;
  model.refills = [];
  try {
    return play();
  } finally {
    model.refills = refills;
  }
}
// How long whoever holds a post goes between looks, by the file's time and their own skill.
const pace = (game, post, every, skill) => every / cmd.speedOf(game, "meridian", [cmd.holderKey(game, "meridian", post)], skill);

test("two lines at the top name the posts that decide and how often they look, and the checker catches a bad one", () => {
  assert.deepEqual(readDecider("the first officer, every hour"), { who: "the first officer", every: 60 });
  assert.deepEqual(readDecider("the quartermaster, looking every 4 hours"), { who: "the quartermaster", every: 240 });
  assert.deepEqual(readDecider("the deck chief, every 30 minutes"), { who: "the deck chief", every: 30 });
  assert.match(readDecider("the first officer").problem, /how often they look/);
  assert.match(readDecider("every hour").problem, /needs the post that decides/);
  const { value, problems } = parseLogisticsText(FILE, "meridian");
  assert.deepEqual(problems, []);
  assert.match(writeLogisticsText(value), /\nwhat comes first: the first officer, every hour\nwhat stores want: the quartermaster, every 4 hours\n/);
  assert.deepEqual(logisticsOf("meridian").deciders, { first: { post: "first_officer", every: 60, words: "the first officer" }, levels: { post: "quartermaster", every: 240, words: "the quartermaster" } });
  withFile((text) => text.replace("what comes first: the first officer, every hour", "what comes first: the navigator, every hour").replace("what stores want: the quartermaster, every 4 hours", "what stores want: the quartermaster"), () => {
    const said = logisticsProblems();
    assert.ok(said.some((one) => /the navigator isn't a post in world\/command, to decide what comes first/.test(one)), said.join(" | "));
    assert.ok(said.some((one) => /needs to say how often they look/.test(one)), said.join(" | "));
    assert.deepEqual(logisticsOf("meridian").deciders, {}, "and with neither line sound, nobody decides");
    // Without the lines the board works as it did: jobs as they come, wants as written, and no orders kept.
    const game = newGame();
    at(game, 10);
    take(game, "fuel_rack", "fuel_cell", 5);
    run(game, 60);
    assert.equal(game.logistics.meridian.orders, undefined);
    assert.deepEqual([board(game).first, board(game).levels], [null, null]);
    assert.equal(count(game, "fuel_rack", "fuel_cell"), 3);
  });
});

test("the first officer puts first the part of the ship in the most trouble, when she next looks, and the page says whose order it is and why", () => withoutRefills(() => {
  const game = newGame();
  at(game, 10);
  run(game, 20);
  assert.deepEqual([orders(game).first.by, orders(game).first.part, orders(game).first.why], ["voss", null, "nothing's pressing"]);
  assert.deepEqual([board(game).first.title, board(game).first.by, board(game).first.why, board(game).first.post], ["As it comes", "Commander Voss", "nothing's pressing", "the first officer"]);
  // The generator is left on its last cell, with none aboard to bring.
  take(game, "fuel_rack", "fuel_cell", count(game, "fuel_rack", "fuel_cell"));
  take(game, "shuttle_stores", "fuel_cell", count(game, "shuttle_stores", "fuel_cell"));
  const looked = orders(game).first.looked;
  const every = pace(game, "first_officer", 60, "leadership");
  // She hasn't looked again yet, so nothing's changed.
  run(game, 5);
  if (game.logistics.meridian.at - looked < every) assert.equal(orders(game).first.part, null, "not before her next look");
  const waited = until(game, () => orders(game).first.part === "engines", 120);
  assert.ok(game.logistics.meridian.at - looked >= every && waited <= every + 15, `she looked again ${Math.round(every)} minutes after the last time`);
  const first = board(game).first;
  assert.deepEqual([first.title, first.by, first.part, first.why], ["The engines first", "Commander Voss", "engines", "the generator is on its last"]);
  assert.match(first.since, /^\d\d:\d\d$/);
  // Someone lying where they fell comes before that, once there are enough of them.
  for (const who of ["Yusuf", "Salome", "Emeka"]) assert.ok(medbay.fallDown(game, { who, place: "meridian", ...standsAt(game, "meridian", who), why: "out cold", hours: 8 }));
  game.logistics.meridian.orders.first.next = 0;
  run(game, 15);
  const now = board(game).first;
  if (now.part === "medbay") assert.match(now.why, /of the crew (is|are) down where they fell/);
  else assert.equal(now.part, "engines", "or they've been carried in already, and it's the engines still");
  // Reading the page writes nothing.
  const before = JSON.stringify(game);
  publicState(game);
  assert.equal(JSON.stringify(game), before);
}));

test("a slower officer looks less often, and with the post empty or its holder down nobody decides", () => {
  const game = newGame();
  at(game, 10);
  run(game, 20);
  const quick = pace(game, "first_officer", 60, "leadership");
  // An ensign in the post, with little leadership to go on, looks at once on taking it and then less often.
  cmd.setHolder(game, "meridian", "first_officer", "Ensign Tadeo");
  run(game, 15);
  assert.equal(orders(game).first.by, "Ensign Tadeo", "whoever takes the post looks at once");
  const slow = pace(game, "first_officer", 60, "leadership");
  assert.ok(slow > quick, `${Math.round(slow)} minutes between looks against ${Math.round(quick)}`);
  // Nobody in the post: jobs go as they come, and the page says why.
  cmd.setHolder(game, "meridian", "first_officer", null);
  run(game, 15);
  assert.deepEqual([orders(game).first.by, orders(game).first.part], [null, null]);
  assert.deepEqual([board(game).first.title, board(game).first.by, board(game).first.why], ["As it comes", null, "nobody is the first officer"]);
  // The same with its holder laid out, from the time her next look would have been: until then her last order stands.
  const down = newGame();
  at(down, 10);
  run(down, 20);
  assert.ok(medbay.fallDown(down, { who: "voss", place: "meridian", ...standsAt(down, "meridian", "voss"), why: "out cold", hours: 8 }));
  run(down, 5);
  assert.equal(board(down).first.by, "Commander Voss", "her order stands until she'd have looked again");
  until(down, () => orders(down).first.by === null, 120);
  assert.deepEqual([board(down).first.title, board(down).first.by], ["As it comes", null]);
  assert.match(board(down).first.why, /^Commander Voss is /);
});

test("what's been put first goes before the rest when hands are short", () => {
  // One carrier for everything, so that only one job can be taken at a time.
  withFile((text) => text
    .replace("wants 3; urgent under 2; carried by the deckhands, the techs, the spare hands", "wants 3; urgent under 2; carried by the quartermaster")
    .replace("carried by the deckhands, the cooks, the quartermaster, the spare hands", "carried by the quartermaster"), () => {
    const short = (game) => {
      take(game, "fuel_rack", "fuel_cell", count(game, "fuel_rack", "fuel_cell") - 2);
      take(game, "pantry", "ration_crate", 12);
      clockRuns(game, 5);
      return jobs(game).map((one) => one.to);
    };
    // As it comes, the fuel rack is first in the file.
    const plain = newGame();
    at(plain, 10);
    run(plain, 20);
    assert.equal(orders(plain).first.part, null);
    assert.deepEqual(short(plain), ["fuel_rack"]);
    // People went hungry this morning, so the first officer puts the galley first, and the pantry is seen to before the rack.
    const hungry = newGame();
    at(hungry, 10);
    hungry.logistics.meridian.meals.days[Math.floor(hungry.logistics.meridian.at / 1440)] = { served: 400, missed: 50 };
    until(hungry, () => orders(hungry).first?.part === "galley", 120);
    assert.deepEqual([board(hungry).first.title, board(hungry).first.why], ["The galley first", "people went hungry today"]);
    assert.deepEqual(short(hungry), ["pantry"]);
    const [job] = board(hungry).jobs;
    assert.deepEqual([job.id, job.mark], ["pantry:ration_crate", "!"], "and its job is marked on the page, above the rack's");
    assert.deepEqual(board(hungry).jobs.map((one) => one.id), ["pantry:ration_crate", "fuel_rack:fuel_cell"]);
  });
});

test("the quartermaster raises what a store wants after it has run low, a trip's worth, and eases it back after quiet days", () => {
  const game = newGame();
  at(game, 10);
  run(game, 20);
  assert.deepEqual([orders(game).levels.by, orders(game).wants], ["odessa", {}]);
  assert.deepEqual([board(game).levels.by, board(game).levels.post], ["Quartermaster Brandt", "the quartermaster"]);
  take(game, "fuel_rack", "fuel_cell", count(game, "fuel_rack", "fuel_cell") - 1);
  const every = pace(game, "quartermaster", 240, "commerce");
  const waited = until(game, () => orders(game).wants["fuel_rack:fuel_cell"], 300);
  assert.ok(waited <= every + 15, `within her ${Math.round(every)} minutes between looks`);
  const raised = orders(game).wants["fuel_rack:fuel_cell"];
  assert.deepEqual([raised.n, raised.from, raised.by, raised.why], [5, 3, "odessa", "under 2"]);
  run(game, 60);
  assert.ok(count(game, "fuel_rack", "fuel_cell") >= 5, "and the rack is kept at five from then on");
  const row = board(game).stores.find((one) => one.id === "fuel_rack").rows[0];
  assert.deepEqual([row.wants, row.written, row.holds], [5, 3, 6]);
  assert.match(row.note, /raised from 3 by Quartermaster Brandt at \d\d:\d\d, after it ran low/);
  assert.equal(workView(game, "meridian").find((one) => one.id === "fuel_rack:fuel_cell").wants, 5);
  // Three quiet days later it's back to what its line says.
  passTime(game, 24 * 3 + 6);
  assert.equal(orders(game).wants["fuel_rack:fuel_cell"], undefined);
  assert.equal(board(game).stores.find((one) => one.id === "fuel_rack").rows[0].wants, 3);
  // With nobody in the post, what the stores want stays as it is.
  cmd.setHolder(game, "meridian", "quartermaster", null);
  take(game, "fuel_rack", "fuel_cell", count(game, "fuel_rack", "fuel_cell") - 1);
  run(game, 300);
  assert.deepEqual(orders(game).wants, {});
  assert.deepEqual([board(game).levels.by, board(game).levels.why], [null, "nobody is the quartermaster"]);
});

test("I'll do it holds a job for the player: the crew leaves it, it's in the corner, and it's over when the store has what it wants", () => {
  // The cooks alone carry for the pantry, and they sleep through the small hours.
  withFile((text) => text.replace("carried by the deckhands, the cooks, the quartermaster, the spare hands", "carried by the cooks"), () => withoutRefills(() => {
    const game = newGame();
    at(game, 24 + 4);
    const cooks = cmd.onJob(game, "meridian", "cook");
    assert.ok(cooks.every((key) => notAbout(game, "meridian", key, game.clock.hours) === "asleep"), "the cooks are asleep at four");
    take(game, "pantry", "ration_crate", 12);
    run(game, 5);
    const stuck = board(game).jobs.find((one) => one.id === "pantry:ration_crate");
    assert.deepEqual([stuck.status, stuck.stuck, stuck.canTake, stuck.mine], ["nobody free: 2 are asleep", true, true, false]);
    assert.equal(stuck.what, "Pantry: 4 ration crates short of the 4 it wants");
    const said = workCommand(game, "meridian", { action: "mine", id: "pantry:ration_crate" });
    assert.equal(said.message, "It's yours. Bring 4 ration crates to the pantry in The Galley. The shuttle stores in The Lighter Bay have some.");
    const state = publicState(game);
    assert.equal(state.questLog.following, "work:pantry:ration_crate", "it's what the corner of the screen follows");
    const quest = state.questLog.quests.find((one) => one.id === "work:pantry:ration_crate");
    assert.deepEqual([quest.title, quest.status, quest.objective], ["Carry for the pantry", "active", "Bring 4 ration crates to the pantry in The Galley. The shuttle stores in The Lighter Bay have some."]);
    const mine = board(game).jobs.find((one) => one.id === "pantry:ration_crate");
    assert.deepEqual([mine.mine, mine.canTake, mine.stuck], [true, false, false]);
    assert.match(mine.status, /^yours since 04:0\d$/);
    assert.throws(() => workCommand(game, "meridian", { action: "mine", id: "pantry:ration_crate" }), /already yours/);
    // A cook is up before the first sitting, and still leaves it alone.
    run(game, 100);
    assert.ok(cooks.some((key) => !notAbout(game, "meridian", key, game.clock.hours)), "a cook is up");
    assert.deepEqual(jobs(game).filter((one) => one.to === "pantry" && one.item === "ration_crate"), [], "nobody's sent for crates while the job is yours");
    // Two crates in: the corner says what's left. Then the rest, and it's done.
    put(game, "pantry", "ration_crate", 2);
    run(game, 5);
    assert.match(game.quests.find((one) => one.id === "work:pantry:ration_crate").objective, /^Bring 2 ration crates to the pantry/);
    put(game, "pantry", "ration_crate", 2);
    const told = run(game, 5);
    assert.deepEqual(told.filter((line) => line.startsWith("[WORK]")), ["[WORK] The pantry has the ration crates it wants. That job was yours."]);
    assert.equal(game.quests.some((one) => one.id.startsWith("work:")), false, "and it's gone from the corner");
    assert.equal(orders(game).mine, undefined);
    assert.throws(() => workCommand(game, "meridian", { action: "mine", id: "pantry:ration_crate" }), /has what it wants/);
  }));
});

test("a job the player doesn't get to goes back to the crew, one can be given back, and one someone's on can't be taken", () => {
  withFile((text) => text.replace("carried by the deckhands, the cooks, the quartermaster, the spare hands", "carried by the cooks"), () => withoutRefills(() => {
    const game = newGame();
    at(game, 24 + 2);
    take(game, "pantry", "ration_crate", 12);
    run(game, 5);
    workCommand(game, "meridian", { action: "mine", id: "pantry:ration_crate" });
    const told = run(game, 135);
    assert.deepEqual(told.filter((line) => line.startsWith("[WORK]")), ["[WORK] The pantry is still short of ration crates, so the crew takes the job back."]);
    assert.equal(game.quests.some((one) => one.id.startsWith("work:")), false);
    assert.equal(board(game).jobs.find((one) => one.id === "pantry:ration_crate").mine, false);
    // Taken again and given back.
    workCommand(game, "meridian", { action: "mine", id: "pantry:ration_crate" });
    assert.equal(workCommand(game, "meridian", { action: "leave", id: "pantry:ration_crate" }).message, "The pantry is the crew's to fill again.");
    assert.equal(game.quests.some((one) => one.id.startsWith("work:")), false);
    assert.throws(() => workCommand(game, "meridian", { action: "leave", id: "pantry:ration_crate" }), /isn't yours/);
    assert.throws(() => workCommand(game, "meridian", { action: "mine", id: "nowhere:nothing" }), /no job like that/);
    // From ashore there's nothing to take.
    game.location = "haven";
    assert.throws(() => workCommand(game, "meridian", { action: "mine", id: "pantry:ration_crate" }), /have to be aboard/);
  }));
  // On the ship as she's written a deckhand is on it at once, and then it isn't the player's to take.
  const game = newGame();
  at(game, 16);
  take(game, "pantry", "ration_crate", 12);
  run(game, 5);
  assert.equal(board(game).jobs.find((one) => one.id === "pantry:ration_crate").canTake, false);
  assert.throws(() => workCommand(game, "meridian", { action: "mine", id: "pantry:ration_crate" }), /^Error: Deckhand \w+ is already on it\.$/);
});

test("the Work page has the hands free, every store with what it has against what it wants and what's on its way, and the jobs with the urgent first", () => withoutRefills(() => {
  const game = newGame();
  at(game, 16);
  const quiet = board(game);
  assert.deepEqual(quiet.jobs, [], "with every store at what it wants there are no jobs");
  assert.deepEqual([quiet.name, quiet.hands.of], ["CFS Meridian", 18]);
  assert.ok(quiet.hands.free > 0 && quiet.hands.free <= 18);
  assert.deepEqual(quiet.stores.map((one) => one.id), ["shuttle_stores", "fuel_rack", "pantry", "garden_bins", "medicine_cabinet", "parts_lockers", "soup_kettle"]);
  const kettle = quiet.stores.at(-1);
  assert.deepEqual([kettle.count.of, kettle.count.unit, kettle.rows], [400, "sittings", []]);
  assert.match(kettle.note, /^next sitting 18:00$|^a sitting is on$/);
  take(game, "pantry", "ration_crate", 12);
  take(game, "fuel_rack", "fuel_cell", count(game, "fuel_rack", "fuel_cell") - 1);
  take(game, "parts_lockers", "parts_crate", 6);
  take(game, "shuttle_stores", "parts_crate", 6);
  run(game, 5);
  const busy = board(game);
  assert.deepEqual(busy.jobs.map((one) => [one.id, one.mark, one.busy, one.stuck]), [
    ["fuel_rack:fuel_cell", "!!", true, false],
    ["pantry:ration_crate", "", true, false],
    ["parts_lockers:parts_crate", "", false, true],
  ]);
  assert.deepEqual([busy.jobs[0].why, busy.jobs[0].what], ["urgent: under 2", "Fuel rack: 2 fuel cells short of the 3 it wants"]);
  assert.match(busy.jobs[0].status, /^Deckhand \w+ is fetching fuel cells from the shuttle stores, since 16:0\d$/);
  assert.deepEqual([busy.jobs[2].status, busy.jobs[2].canTake], ["nothing aboard to bring", true], "and what nobody can bring can still be the player's");
  assert.ok(busy.hands.free < quiet.hands.free, "the carriers aren't free while they carry");
  const rows = (id) => busy.stores.find((one) => one.id === id).rows;
  assert.deepEqual(rows("fuel_rack").map((one) => [one.name, one.has, one.wants, one.holds, one.urgent, one.note]), [["fuel cell", 1, 3, 6, true, "2 on their way"]]);
  assert.deepEqual(rows("pantry").map((one) => [one.name, one.has, one.wants, one.short, one.note]), [["ration crate", 0, 4, false, "4 on their way"], ["produce", count(game, "pantry", "produce"), 4, false, ""]]);
  assert.deepEqual(rows("shuttle_stores").map((one) => [one.name, one.wants, one.note]), [["ration crate", null, "4 set aside to go"], ["fuel cell", null, "2 set aside to go"], ["parts crate", null, ""]]);
  assert.deepEqual(publicState(game).ship.board.jobs.map((one) => one.id), busy.jobs.map((one) => one.id), "it's what the page is sent");
}));

test("the officers decide the same however the clock is cut", () => {
  const once = newGame(7);
  const pieces = newGame(7);
  pieces.bodySeed = once.bodySeed;
  for (const one of [once, pieces]) {
    at(one, 9);
    one.location = "haven";
    take(one, "fuel_rack", "fuel_cell", count(one, "fuel_rack", "fuel_cell") - 1);
    take(one, "pantry", "ration_crate", 12);
  }
  passTime(once, 6);
  for (let gone = 0; gone < 360; gone += 5) passTime(pieces, 5 / 60);
  assert.deepEqual(pieces.logistics.meridian.orders, once.logistics.meridian.orders);
  assert.ok(once.logistics.meridian.orders.wants["fuel_rack:fuel_cell"], "the quartermaster has raised the rack's want in both");
});
