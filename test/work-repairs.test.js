// Repairs on the ship's work board (the logistics rework, step 5, part 1): what's broken is given, in its last hour,
// to the first engineer who's free, one person to a job; a repair nobody can take waits, and its hour starts when
// someone does; the file's Urgency part says which work comes before which, and someone at work drops it only for a
// job two lines higher or more; the player can take a repair for themselves. The ship's file is a copy here with the
// techs alone carrying for the fuel rack, so that it's plain who's meant to go. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-work-repairs-"));
const logisticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-work-repairs-files-"));
const OWN = fs.readFileSync(new URL("../world/logistics/meridian.txt", import.meta.url), "utf8").replaceAll("\r\n", "\n");
// Nobody decides what comes first or what the stores want here (test/work-page has the officers).
const FILE = OWN
  .replace("carried by the deckhands, the techs, the spare hands: A rack", "carried by the techs: A rack")
  .replace("what comes first: the first officer, every hour\n", "")
  .replace("what stores want: the quartermaster, every 4 hours\n", "");
assert.ok(FILE.includes("carried by the techs: A rack") && !/what comes first|what stores want/.test(FILE) && FILE.includes("\nUrgency:\n"), "the ship's file is written as this test expects");
fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), FILE);
process.env.GAME_LOGISTICS_DIR = logisticsDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const bag = await import("../src/bag.js");
const cmd = await import("../src/command.js");
const sys = await import("../src/systems.js");
const { countAboard, logisticsOf, logisticsProblems, storesView } = await import("../src/logistics.js");
const { boardView, workCommand } = await import("../src/work.js");
// The dice are held still while the clock runs here: in play a fire or a breach can start by chance, and an engineer
// would be sent to it, off whatever these tests are watching. Just under 1 is "it never happens".
const rules = await import("../src/rules.js");
function calmly(play) {
  const real = Math.random;
  Math.random = () => 0.99;
  try {
    return play();
  } finally {
    Math.random = real;
  }
}
const clockRuns = (game, minutes) => calmly(() => rules.clockRuns(game, minutes));
const passTime = (game, hours, activity) => calmly(() => rules.passTime(game, hours, activity));
const { publicState } = rules;
const { whereNow } = await import("../src/life.js");
const { addDetour } = await import("../src/room-hooks.js");
const { clearLife } = await import("../src/life.js");
const { clearMaps } = await import("../src/walk.js");
const { reloadLogistics } = await import("../src/world.js");
const { WORK_KINDS, parseLogisticsText, readUrgencyLine, writeLogisticsText } = await import("../public/logistics-text.js");

// Nothing wears out by itself here, so the only parts crates that go are the ones the tests are about.
const newGame = (seed = 21) => Object.assign(createGameFromDraft(randomDraft({ seed, archetype: "officer" })), { wearDay: Infinity });
const storeOf = (id) => logisticsOf("meridian").stores.find((one) => one.id === id);
const count = (game, storeId, item) => storesView(game, "meridian").find((one) => one.id === storeId).items.find((one) => one.id === item)?.n ?? 0;
const take = (game, storeId, item, n) => bag.storeTake(game, storeOf(storeId).key, storeOf(storeId).holds, item, n);
const crates = (game) => countAboard(game, "meridian", ["parts_crate"]).n;
const at = (game, hours) => {
  game.clock.hours = hours;
  clockRuns(game, 1);
};
// Runs the clock five minutes at a time, and gives back what was said.
const run = (game, n) => {
  const said = [];
  for (let gone = 0; gone < n; gone += 5) said.push(...clockRuns(game, 5));
  return said;
};
const jobs = (game) => game.logistics.meridian.jobs ?? [];
const mending = (game, id) => jobs(game).find((one) => one.ref === id) ?? null;
const carrying = (game, store) => jobs(game).find((one) => one.to === store) ?? null;
const row = (game, id) => boardView(game, "meridian").jobs.find((one) => one.id === id) ?? null;
const techs = (game) => cmd.onJob(game, "meridian", "tech");
// Parts in rooms nothing else in these tests stands on. A camera or a speaker is an ordinary repair, and a junction
// box, which carries the power, is one the ship can't do without.
const CAMERA = "cameras:camera:bridge";
const SPEAKER = "alarm:speaker:bridge";
const AFT = "cameras:camera:aft";
const BOX = "power:junction_box:bridge";
// Breaks something so that it's in its last hour: due nine tenths of an hour from now.
function breakNow(game, id) {
  sys.damagePart(game, "meridian", id, "broken", { by: "story" });
  game.systems.meridian.parts[id].fixAt = game.clock.hours + 0.9;
}
const due = (game, id) => game.systems?.meridian?.parts?.[id]?.fixAt ?? null;
// What's wrong with a part, or nothing: the systems keep nothing about a place where everything works.
const damage = (game, id) => game.systems?.meridian?.parts?.[id]?.damage;
// Leaves the chief engineer and one tech to mend, by moving the other techs to the deckhands.
function oneTech(game) {
  const [only, ...others] = techs(game);
  for (const key of others) cmd.assignJob(game, "meridian", key, "deckhand");
  return only;
}
// Something outside the board that takes people, as walking with the player or a brawl would (src/room-hooks.js).
const wanted = new Set();
addDetour((game, place) => (place === "meridian" && wanted.size ? (key) => (wanted.has(key) ? { where: "@bridge", doing: "wanted on the bridge" } : null) : null));
// Plays with another file for the ship, and puts the usual one back.
function withFile(text, play) {
  const write = (words) => {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), words);
    reloadLogistics();
    clearMaps();
    clearLife();
  };
  try {
    write(text);
    return play();
  } finally {
    write(FILE);
  }
}

test("something broken goes, in its last hour, to the first engineer who's free, who fetches the spare and mends it", () => {
  const game = newGame();
  at(game, 10);
  const before = crates(game);
  sys.damagePart(game, "meridian", CAMERA, "broken", { by: "story" });
  // Until its last hour nobody's on it, and the Work page says when they will be.
  run(game, 5);
  assert.equal(mending(game, CAMERA), null);
  assert.match(row(game, `repair:${CAMERA}`).status, /^the engineers start on it at 1\d:\d\d$/);
  assert.deepEqual([row(game, `repair:${CAMERA}`).what, row(game, `repair:${CAMERA}`).busy, row(game, `repair:${CAMERA}`).canTake], ["Mend the camera in The Bridge", false, true]);
  game.systems.meridian.parts[CAMERA].fixAt = game.clock.hours + 0.9;
  run(game, 5);
  assert.deepEqual([mending(game, CAMERA).by, mending(game, CAMERA).kind], ["marrow", "repair"], "the chief engineer is the first the board asks");
  assert.equal(jobs(game).length, 1);
  const shown = row(game, `repair:${CAMERA}`);
  assert.match(shown.status, /^Chief Engineer Marrow is fetching a parts crate from the parts lockers for the camera, since 10:\d\d$/);
  assert.deepEqual([shown.busy, shown.stuck, shown.canTake, shown.mark, shown.by, shown.tip], [true, false, false, "", "the engineers", "Mended by the engineers, the first of them who's free."]);
  assert.match(whereNow(game, "marrow"), /^fetching a parts crate from the parts lockers for the camera/);
  // Half an hour on they've left the store for it (how soon they're there goes by their own pace: a made-up body
  // can have a bad knee), and by the end of the hour it's done, with the crate.
  run(game, 30);
  assert.match(whereNow(game, "marrow"), /^(fixing the camera|heading for the Bridge)/);
  const said = run(game, 30);
  assert.ok(said.includes("[SYSTEMS] Marrow has fixed the camera in The Bridge, with a parts crate from the parts lockers."), said.join(" | "));
  assert.equal(damage(game, CAMERA), undefined);
  assert.equal(crates(game), before - 1);
  assert.deepEqual(jobs(game), [], "and the job's gone");
  assert.equal(row(game, `repair:${CAMERA}`), null);
  assert.deepEqual(publicState(game).ship.board.jobs, []);
});

test("one engineer, one repair: three things broken go to three of them, and a fourth waits for a free hand", () => {
  const game = newGame();
  at(game, 10);
  for (const id of [CAMERA, SPEAKER, AFT, "cameras:camera:engineering"]) breakNow(game, id);
  run(game, 5);
  const on = jobs(game).filter((one) => one.ref).map((one) => [one.ref, one.by]);
  // Tech Goran keeps the night watch, and is asleep at ten: nobody's woken for a camera.
  assert.deepEqual(on, [[CAMERA, "marrow"], [SPEAKER, "Tech Sami"], [AFT, "Tech Oona"]]);
  const left = row(game, "repair:cameras:camera:engineering");
  assert.equal(left.status, "nobody free: Chief Engineer Marrow is mending the camera in The Bridge, Tech Sami is mending the speaker in The Bridge, Tech Oona is mending the camera in The Aft Holds, and 1 more can't come");
  assert.deepEqual([left.busy, left.stuck, left.canTake], [false, true, true]);
  // Its hour starts when someone takes it: it can't be done in under an hour from now.
  assert.ok(due(game, "cameras:camera:engineering") >= game.clock.hours + 0.8, "the one that waits is put off");
  // The three are done within the hour, and then the first of them who's free takes the fourth, for an hour of its own.
  run(game, 60);
  for (const id of [CAMERA, SPEAKER, AFT]) assert.equal(damage(game, id), undefined, `${id} is mended`);
  assert.equal(mending(game, "cameras:camera:engineering")?.by, "marrow");
  run(game, 65);
  assert.equal(damage(game, "cameras:camera:engineering"), undefined);
  assert.deepEqual(jobs(game), []);
});

test("a tech drops a broken speaker for the generator's fuel, which is clearly more urgent, and the speaker waits for whoever's free next", () => {
  const game = newGame();
  at(game, 10);
  const only = oneTech(game);
  breakNow(game, CAMERA);
  breakNow(game, SPEAKER);
  run(game, 5);
  assert.deepEqual([mending(game, CAMERA).by, mending(game, SPEAKER).by], ["marrow", only]);
  // The rack down to its last cell is urgent carrying, five lines above a repair, and only the techs carry for it.
  take(game, "fuel_rack", "fuel_cell", 5);
  run(game, 5);
  assert.deepEqual([carrying(game, "fuel_rack")?.by, carrying(game, "fuel_rack")?.kind], [only, "carry_urgent"], "the tech has left the speaker for the fuel");
  assert.equal(mending(game, SPEAKER), null);
  assert.equal(mending(game, CAMERA).by, "marrow", "and the chief, who doesn't carry for the rack, is still at the camera");
  assert.match(whereNow(game, only), /^fetching fuel cells from the shuttle stores/);
  assert.equal(damage(game, SPEAKER), "broken");
  assert.ok(due(game, SPEAKER) >= game.clock.hours + 0.8, "whoever takes the speaker up has an hour of their own at it");
  const waits = row(game, `repair:${SPEAKER}`);
  assert.equal(waits.status, `nobody free: Chief Engineer Marrow is mending the camera in The Bridge, ${only} is fetching fuel cells from the shuttle stores`);
  // The fuel's brought, and then the speaker's mended after all.
  run(game, 150);
  assert.equal(count(game, "fuel_rack", "fuel_cell"), 3);
  assert.equal(damage(game, SPEAKER), undefined);
  assert.deepEqual(jobs(game), []);
});

test("carrying that isn't urgent is only one line above a repair, so nobody leaves a repair for it", () => {
  const game = newGame();
  at(game, 10);
  const only = oneTech(game);
  breakNow(game, CAMERA);
  breakNow(game, SPEAKER);
  run(game, 5);
  assert.equal(mending(game, SPEAKER).by, only);
  // Two cells in the rack is under the three it wants, and not under its urgent mark.
  take(game, "fuel_rack", "fuel_cell", 4);
  run(game, 10);
  assert.equal(mending(game, SPEAKER).by, only, "the tech stays at the speaker");
  assert.equal(carrying(game, "fuel_rack"), null);
  assert.equal(row(game, "fuel_rack:fuel_cell").status, `nobody free: ${only} is mending the speaker in The Bridge`);
  // Once the speaker's mended the cells are fetched: a trip of two.
  run(game, 90);
  assert.equal(count(game, "fuel_rack", "fuel_cell"), 4);
});

test("a repair the ship can't do without takes an engineer off a lesser one, and wakes one when nobody's up", () => {
  const game = newGame();
  at(game, 10);
  const only = oneTech(game);
  breakNow(game, CAMERA);
  breakNow(game, SPEAKER);
  run(game, 5);
  assert.deepEqual([mending(game, CAMERA).by, mending(game, SPEAKER).by], ["marrow", only]);
  // A junction box carries the power. Both engineers are at ordinary repairs, four lines below it.
  breakNow(game, BOX);
  run(game, 5);
  const on = mending(game, BOX);
  assert.deepEqual([on?.kind, on?.by], ["repair_critical", "marrow"], "the first of them leaves what they were at for it");
  assert.equal(mending(game, CAMERA), null);
  assert.equal(mending(game, SPEAKER).by, only, "and the other keeps at theirs");
  const shown = row(game, `repair:${BOX}`);
  assert.deepEqual([shown.mark, shown.why], ["!!", "the ship can't do without it"]);
  assert.deepEqual(boardView(game, "meridian").jobs.map((one) => one.id).slice(0, 1), [`repair:${BOX}`], "it's first on the Work page");
  // At three the next morning only the tech on the night watch is up. With them taken, an ordinary repair waits
  // for the morning, and one the ship can't do without wakes the chief.
  const night = newGame();
  at(night, 27);
  const [, , watch] = techs(night);
  assert.equal(watch, "Tech Goran");
  wanted.add(watch);
  try {
    breakNow(night, CAMERA);
    run(night, 5);
    assert.equal(mending(night, CAMERA), null, "nobody's woken for a camera");
    assert.match(row(night, `repair:${CAMERA}`).status, /^nobody free: 3 are asleep, Tech Goran is wanted on the bridge$/);
    breakNow(night, BOX);
    run(night, 5);
    assert.equal(mending(night, BOX)?.by, "marrow", "the chief is woken for the power");
    assert.match(whereNow(night, "marrow"), /^(fetching a parts crate from the parts lockers for|fixing) the junction box/);
  } finally {
    wanted.clear();
  }
  // And nobody's woken while someone who's up can leave lesser work for it: the night watch drops a camera for the
  // power, and the chief sleeps on.
  const late = newGame();
  at(late, 27);
  breakNow(late, CAMERA);
  run(late, 5);
  assert.equal(mending(late, CAMERA)?.by, watch, "the night watch has the camera");
  breakNow(late, BOX);
  run(late, 5);
  assert.equal(mending(late, BOX)?.by, watch, "and leaves it for the junction box");
  assert.equal(mending(late, CAMERA), null);
  assert.match(row(late, `repair:${CAMERA}`).status, /^nobody free: 3 are asleep, Tech Goran is mending the junction box in The Bridge$/);
});

test("the order of urgency is the file's: with a repair written above urgent carrying, the tech stays at the repair", () => {
  const model = logisticsOf("meridian");
  assert.deepEqual(model.urgency, WORK_KINDS.map(([kind]) => kind), "the ship's file has every kind, in the usual order");
  assert.deepEqual(readUrgencyLine("A repair the ship can't do without."), { kind: "repair_critical" });
  assert.match(readUrgencyLine("sweeping the decks").problem, /isn't a kind of work the board gives out/);
  // The part is kept as it's written.
  const read = parseLogisticsText(FILE, "meridian");
  assert.deepEqual(read.problems, []);
  assert.deepEqual(read.value.urgency.map((one) => one.text).slice(0, 3), ["carrying someone who's bleeding", "a fire", "a breach"]);
  assert.equal(writeLogisticsText(read.value), FILE);
  // A repair moved up, two lines above urgent carrying: the other way round from the ship's own order.
  const moved = FILE.replace("- urgent carrying\n- a repair the ship can't do without\n", "- a repair\n- a repair the ship can't do without\n- urgent carrying\n").replace("- carrying\n- a repair\n- mending", "- carrying\n- mending");
  assert.notEqual(moved, FILE);
  withFile(moved, () => {
    assert.deepEqual(logisticsProblems(), []);
    const urgency = logisticsOf("meridian").urgency;
    assert.ok(urgency.indexOf("repair") === urgency.indexOf("carry_urgent") - 2);
    const game = newGame();
    at(game, 10);
    const only = oneTech(game);
    breakNow(game, CAMERA);
    breakNow(game, SPEAKER);
    run(game, 5);
    take(game, "fuel_rack", "fuel_cell", 5);
    run(game, 10);
    assert.equal(mending(game, SPEAKER).by, only, "the tech stays at the speaker");
    assert.equal(carrying(game, "fuel_rack"), null, "and the last cell isn't fetched yet");
  });
  // A kind the file leaves out comes after the ones it has; one written twice, or that isn't one, is a problem.
  withFile(FILE.replace("- mending in the workshop\n", ""), () => {
    assert.deepEqual(logisticsProblems(), []);
    assert.equal(logisticsOf("meridian").urgency.at(-1), "workshop");
  });
  withFile(FILE.replace("- a fire\n", "- a fire\n- a fire\n- sweeping the decks\n"), () => {
    const problems = logisticsProblems().join("\n");
    assert.match(problems, /a fire is written twice under Urgency/);
    assert.match(problems, /"sweeping the decks" isn't a kind of work the board gives out/);
  });
});

test("with nobody able to come a repair waits, and one the ship can't do without counts against the chief engineer's day", () => {
  const game = newGame();
  at(game, 10);
  for (const key of sys.engineersOf(game, "meridian")) wanted.add(key);
  try {
    breakNow(game, BOX);
    run(game, 30);
    assert.equal(mending(game, BOX), null);
    assert.equal(row(game, `repair:${BOX}`).status, "nobody free: 4 are wanted on the bridge");
    assert.ok(due(game, BOX) >= game.clock.hours + 0.8, "it's no nearer done");
    const day = Math.floor(game.clock.hours / 24);
    assert.ok(game.command.meridian.tally[day].repairsLeft >= 25, `${game.command.meridian.tally[day].repairsLeft} minutes counted`);
  } finally {
    wanted.clear();
  }
  // With nobody mending at all, the page says so.
  const empty = newGame();
  at(empty, 10);
  cmd.setHolder(empty, "meridian", "chief_engineer", null);
  for (const key of techs(empty)) cmd.assignJob(empty, "meridian", key, "deckhand");
  breakNow(empty, CAMERA);
  run(empty, 10);
  assert.equal(row(empty, `repair:${CAMERA}`).status, "there's nobody to mend it");
});

test("I'll do it holds a repair for the player: the engineers leave it, and it's over once it's mended or they've waited long enough", () => {
  const game = newGame();
  at(game, 10);
  game.location = "meridian";
  breakNow(game, CAMERA);
  const id = `repair:${CAMERA}`;
  assert.equal(row(game, id).canTake, true);
  const took = workCommand(game, "meridian", { action: "mine", id });
  assert.equal(took.message, "It's yours. Mend the camera in The Bridge yourself: walk up to it and fix it by hand.");
  const quest = game.quests.find((one) => one.id === `work:${id}`);
  assert.deepEqual([quest.title, quest.objective, game.following], ["Mend the camera", "Mend the camera in The Bridge yourself: walk up to it and fix it by hand.", `work:${id}`]);
  assert.throws(() => workCommand(game, "meridian", { action: "mine", id }), /already yours/);
  run(game, 60);
  assert.equal(mending(game, CAMERA), null, "no engineer takes it");
  assert.equal(damage(game, CAMERA), "broken");
  assert.deepEqual([row(game, id).mine, row(game, id).canTake], [true, false]);
  assert.match(row(game, id).status, /^yours since 10:0\d$/);
  // Mended by hand, it's over.
  sys.repairPart(game, "meridian", CAMERA);
  const said = run(game, 5);
  assert.ok(said.includes("[WORK] The camera in The Bridge is mended. That job was yours."), said.join(" | "));
  assert.equal(game.quests.some((one) => one.id === `work:${id}`), false);
  // Left too long, the engineers take it back; and it can be given back sooner.
  breakNow(game, SPEAKER);
  const other = `repair:${SPEAKER}`;
  workCommand(game, "meridian", { action: "mine", id: other });
  const later = run(game, 130);
  assert.ok(later.includes("[WORK] The speaker in The Bridge is still broken, so the engineers take the job back."), later.join(" | "));
  run(game, 5);
  assert.ok(mending(game, SPEAKER)?.by, "and one of them is on it");
  assert.throws(() => workCommand(game, "meridian", { action: "mine", id: other }), /^Error: (Chief Engineer Marrow|Tech \w+) is already on it\.$/);
  breakNow(game, AFT);
  workCommand(game, "meridian", { action: "mine", id: `repair:${AFT}` });
  assert.equal(workCommand(game, "meridian", { action: "leave", id: `repair:${AFT}` }).message, "The camera in The Aft Holds is the engineers' to mend again.");
  assert.throws(() => workCommand(game, "meridian", { action: "mine", id: "repair:nothing" }), /no job like that/);
  // Ashore, it can't be taken.
  game.location = "haven";
  assert.throws(() => workCommand(game, "meridian", { action: "mine", id: `repair:${AFT}` }), /have to be aboard to mend it/);
});

test("the part of the ship the first officer has put first has its repairs before the others", () => {
  const game = newGame();
  at(game, 10);
  for (const key of techs(game)) cmd.assignJob(game, "meridian", key, "deckhand");
  const galley = Object.values(sys.systemsOf("meridian").parts).find((one) => one.room === "galley" && one.kind === "speaker");
  assert.ok(galley, "the galley has a speaker");
  // The camera is broken first; with the galley first, its speaker is the one the only engineer takes.
  breakNow(game, CAMERA);
  breakNow(game, galley.id);
  const t = Math.floor(game.clock.hours * 60);
  game.logistics.meridian.orders = { first: { part: "galley", why: "the kettle is empty", by: "voss", holder: null, since: t, looked: t, next: Infinity } };
  run(game, 5);
  assert.equal(mending(game, galley.id)?.by, "marrow");
  assert.equal(mending(game, CAMERA), null);
  // Without an order they go as they come.
  const plain = newGame();
  at(plain, 10);
  for (const key of techs(plain)) cmd.assignJob(plain, "meridian", key, "deckhand");
  breakNow(plain, CAMERA);
  breakNow(plain, galley.id);
  run(plain, 5);
  assert.equal(mending(plain, CAMERA)?.by, "marrow");
});

test("the repairs come out the same however the clock is cut, and reading the Work page changes nothing", () => {
  const once = newGame(7);
  const pieces = newGame(7);
  pieces.bodySeed = once.bodySeed;
  for (const one of [once, pieces]) {
    at(one, 9);
    for (const id of [CAMERA, SPEAKER, BOX]) sys.damagePart(one, "meridian", id, "broken", { by: "story" });
  }
  const before = JSON.stringify(pieces);
  boardView(pieces, "meridian");
  publicState(pieces);
  assert.equal(JSON.stringify(pieces), before);
  passTime(once, 4);
  for (let gone = 0; gone < 240; gone += 5) passTime(pieces, 5 / 60);
  for (const game of [once, pieces]) {
    for (const id of [CAMERA, SPEAKER, BOX]) assert.equal(damage(game, id), undefined, `${id} is mended`);
    assert.deepEqual(jobs(game), []);
  }
  assert.equal(crates(pieces), crates(once));
});
