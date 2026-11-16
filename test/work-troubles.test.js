// Fires, breaches and the alarm's guards on the ship's work board (the logistics rework, step 5, part 3): an engineer
// is sent to each fire and each breach, walks there, and is on that job until it's dealt with; a fire isn't fought
// while nobody's got to it; a breach waits for a parts crate; the guards answering an alarm are on a job too, and
// carry nothing meanwhile; and it's all on the Work page. The ship's file is a copy here with the chief of security
// alone carrying for the pantry, so that a guard can be seen not to carry. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-work-troubles-"));
const logisticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-work-troubles-files-"));
const OWN = fs.readFileSync(new URL("../world/logistics/meridian.txt", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const FILE = OWN
  .replace("carried by the deckhands, the cooks, the quartermaster, the spare hands", "carried by the chief of security")
  .replace("what comes first: the first officer, every hour\n", "")
  .replace("what stores want: the quartermaster, every 4 hours\n", "");
assert.ok(FILE.includes("wants 4 of each; carried by the chief of security:") && !/what comes first|what stores want/.test(FILE), "the ship's file is written as this test expects");
fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), FILE);
process.env.GAME_LOGISTICS_DIR = logisticsDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const bag = await import("../src/bag.js");
const cmd = await import("../src/command.js");
const em = await import("../src/emergencies.js");
const sys = await import("../src/systems.js");
const { countAboard, logisticsOf, putAboard, storesView, takeAboard } = await import("../src/logistics.js");
const { boardView, busyOnBoard, troubleCrew } = await import("../src/work.js");
const { clockRuns, passTime, publicState } = await import("../src/rules.js");
const { whereNow } = await import("../src/life.js");
const { addDetour } = await import("../src/room-hooks.js");

// Nothing wears out by itself here, so the only parts crates that go are the ones the tests are about.
const newGame = (seed = 21) => Object.assign(createGameFromDraft(randomDraft({ seed, archetype: "officer" })), { wearDay: Infinity });
const storeOf = (id) => logisticsOf("meridian").stores.find((one) => one.id === id);
const count = (game, storeId, item) => storesView(game, "meridian").find((one) => one.id === storeId).items.find((one) => one.id === item)?.n ?? 0;
const take = (game, storeId, item, n) => bag.storeTake(game, storeOf(storeId).key, storeOf(storeId).holds, item, n);
const crates = (game) => countAboard(game, "meridian", ["parts_crate"]).n;
// The dice held still, so that nothing new starts by chance and nobody's burnt: just under 1 is "it never happens".
function calm(play) {
  const real = Math.random;
  Math.random = () => 0.99;
  try {
    return play();
  } finally {
    Math.random = real;
  }
}
const at = (game, hours) => calm(() => {
  game.clock.hours = hours;
  clockRuns(game, 1);
});
// Runs the clock five minutes at a time, and gives back what was said.
const run = (game, n) => calm(() => {
  const said = [];
  for (let gone = 0; gone < n; gone += 5) said.push(...clockRuns(game, 5));
  return said;
});
const jobs = (game) => game.logistics.meridian.jobs ?? [];
const sentTo = (game, kind, room) => jobs(game).find((one) => one.kind === kind && one.room === room) ?? null;
const mending = (game, id) => jobs(game).find((one) => one.ref === id) ?? null;
const carrying = (game, store) => jobs(game).find((one) => one.to === store) ?? null;
const row = (game, id) => boardView(game, "meridian").jobs.find((one) => one.id === id) ?? null;
const techs = (game) => cmd.onJob(game, "meridian", "tech");
const fire = (game) => em.fireIn(game, "meridian", "galley");
const CAMERA = "cameras:camera:bridge";
// Something outside the board that takes people, as walking with the player or a brawl would (src/room-hooks.js).
const wanted = new Set();
addDetour((game, place) => (place === "meridian" && wanted.size ? (key) => (wanted.has(key) ? { where: "@bridge", doing: "wanted on the bridge" } : null) : null));
const without = (keys, play) => {
  for (const key of keys) wanted.add(key);
  try {
    return play();
  } finally {
    wanted.clear();
  }
};

test("a fire is a job on the board: an engineer is sent at once and walks there, and has the better of it from the time the file gives", () => {
  const game = newGame();
  at(game, 34);
  calm(() => em.startFire(game, "meridian", "galley"));
  const first = row(game, "fire:galley");
  assert.deepEqual([first.what, first.why, first.mark, first.busy, first.canTake], ["Fight the fire in the Galley", "it's small", "!!", false, false]);
  run(game, 5);
  const job = sentTo(game, "fire", "galley");
  assert.equal(job?.by, "marrow", "the chief engineer is the first the board asks");
  assert.ok(job.walk > 0 && job.walk < 30, `${job.walk} minutes' walk from where he was`);
  const shown = row(game, "fire:galley");
  assert.match(shown.status, /^Chief Engineer Marrow is fighting the fire in the Galley, since 10:0\d$/);
  assert.deepEqual([shown.busy, shown.stuck, shown.by], [true, false, "the engineers"]);
  assert.equal(busyOnBoard(game, "meridian", "marrow"), "fighting the fire in the Galley");
  assert.match(whereNow(game, "marrow"), /^fighting the fire in the Galley/, "and it's where he's going");
  // He isn't there before his walk is done, and the fire isn't fought before he is.
  assert.equal(troubleCrew(game, "meridian", "fire", "galley", job.took / 60), null);
  assert.equal(troubleCrew(game, "meridian", "fire", "galley", (job.took + job.walk) / 60 + 0.01), "marrow");
  const said = run(game, 30);
  assert.ok(fire(game).size >= 2, "it grew meanwhile");
  assert.ok(!said.some((line) => /getting the better/.test(line)), "nobody has the better of it before forty-five minutes");
  // From forty-five minutes after it started he has, and it's out inside two hours; then the job's gone.
  const later = run(game, 85);
  assert.ok(later.includes("[FIRE] Chief Engineer Marrow is getting the better of the fire in the Galley."), later.filter((line) => line.startsWith("[FIRE]")).join(" | "));
  assert.ok(later.includes("[FIRE] The fire in the Galley is out: the engineers put it out."), later.filter((line) => line.startsWith("[FIRE]")).join(" | "));
  assert.equal(fire(game), null);
  run(game, 5);
  assert.equal(sentTo(game, "fire", "galley"), null);
  assert.equal(row(game, "fire:galley"), null);
  assert.doesNotMatch(whereNow(game, "marrow") ?? "", /fire/);
  assert.deepEqual(publicState(game).ship.board.jobs.filter((one) => one.id.startsWith("fire:")), []);
});

test("with no engineer able to come a fire isn't fought, the Work page says why, and it counts against the chief engineer", () => {
  const game = newGame();
  at(game, 34);
  const engineers = sys.engineersOf(game, "meridian");
  without(engineers, () => {
    calm(() => em.startFire(game, "meridian", "galley"));
    const said = run(game, 60);
    assert.equal(sentTo(game, "fire", "galley"), null);
    assert.ok(fire(game), "it's still burning at an hour, with nobody at it");
    assert.ok(fire(game).size >= 3, `and it's got big: ${fire(game).size}`);
    assert.ok(!said.some((line) => /getting the better|The engineers are at the fire/.test(line)), "though the file's forty-five minutes are up");
    const shown = row(game, "fire:galley");
    assert.deepEqual([shown.status, shown.busy, shown.stuck], ["nobody free: 4 are wanted on the bridge", false, true]);
    const day = Math.floor(game.clock.hours / 24);
    assert.ok(game.command.meridian.tally[day].repairsLeft >= 50, `${game.command.meridian.tally[day].repairsLeft} minutes counted`);
  });
  // Let go, one of them is sent, and it gives ground as soon as he's there, the time being long past.
  const later = run(game, 30);
  assert.equal(sentTo(game, "fire", "galley")?.by ?? "marrow", "marrow");
  assert.ok(later.includes("[FIRE] Chief Engineer Marrow is getting the better of the fire in the Galley."), later.filter((line) => line.startsWith("[FIRE]")).join(" | "));
});

test("a fire takes an engineer off a repair, and gets one out of bed when nobody's up", () => {
  const game = newGame();
  at(game, 34);
  for (const key of techs(game)) cmd.assignJob(game, "meridian", key, "deckhand");
  sys.damagePart(game, "meridian", CAMERA, "broken", { by: "story" });
  game.systems.meridian.parts[CAMERA].fixAt = game.clock.hours + 0.9;
  run(game, 5);
  assert.equal(mending(game, CAMERA)?.by, "marrow");
  calm(() => em.startFire(game, "meridian", "galley"));
  run(game, 5);
  assert.equal(sentTo(game, "fire", "galley")?.by, "marrow", "the only engineer leaves the camera for the fire");
  assert.equal(mending(game, CAMERA), null);
  assert.equal(game.systems.meridian.parts[CAMERA].damage, "broken");
  assert.match(row(game, `repair:${CAMERA}`).status, /^nobody free: Chief Engineer Marrow is fighting the fire in the Galley$/);
  // At three in the morning, with the night watch taken, the fire wakes the chief.
  const night = newGame();
  at(night, 27);
  const watch = techs(night).at(-1);
  without([watch], () => {
    calm(() => em.startFire(night, "meridian", "galley"));
    run(night, 5);
    assert.equal(sentTo(night, "fire", "galley")?.by, "marrow");
  });
});

test("a breach: an engineer is sent and patches it two hours after the plate went, with a crate; with none aboard it waits for one", () => {
  const game = newGame();
  at(game, 34);
  const before = crates(game);
  calm(() => em.startBreach(game, "meridian", "boat_bay"));
  run(game, 5);
  assert.equal(sentTo(game, "breach", "boat_bay")?.by, "marrow");
  const shown = row(game, "breach:boat_bay");
  assert.deepEqual([shown.what, shown.why, shown.mark], ["Patch the hull in the Boat Bay", "the air's going out of it", "!!"]);
  assert.match(shown.status, /^Chief Engineer Marrow is patching the hull in the Boat Bay, since 10:0\d$/);
  assert.match(whereNow(game, "marrow"), /^patching the hull in the Boat Bay/);
  const early = run(game, 100);
  assert.ok(em.breachIn(game, "meridian", "boat_bay"), "not patched before its two hours");
  assert.ok(!early.some((line) => /patched/.test(line)));
  const said = run(game, 25);
  assert.ok(said.includes("[BREACH] Chief Engineer Marrow has patched the hull in the Boat Bay, with a parts crate."), said.filter((line) => line.startsWith("[BREACH]")).join(" | "));
  assert.equal(em.breachIn(game, "meridian", "boat_bay"), null);
  assert.equal(crates(game), before - 1);
  assert.equal(sentTo(game, "breach", "boat_bay"), null);
  // With no parts crate aboard he can't, says so once, and is free again; the page says what it's waiting for.
  const bare = newGame();
  at(bare, 34);
  takeAboard(bare, "meridian", "parts_crate", 99);
  calm(() => em.startBreach(bare, "meridian", "boat_bay"));
  const waited = run(bare, 180);
  assert.deepEqual(waited.filter((line) => line.startsWith("[BREACH]")), ["[BREACH] Chief Engineer Marrow can't patch the Boat Bay: there isn't a parts crate aboard."]);
  assert.equal(sentTo(bare, "breach", "boat_bay"), null);
  assert.deepEqual([row(bare, "breach:boat_bay").status, row(bare, "breach:boat_bay").stuck], ["waiting for a parts crate: there's none aboard", true]);
  // A crate comes aboard: someone's sent again, and it's patched when he gets there.
  putAboard(bare, "meridian", "parts_crate", 1, ["parts_lockers"]);
  const done = run(bare, 40);
  assert.ok(done.includes("[BREACH] Chief Engineer Marrow has patched the hull in the Boat Bay, with a parts crate."), done.filter((line) => line.startsWith("[BREACH]")).join(" | "));
  assert.equal(crates(bare), 0);
});

test("the guards answering an alarm are on a job: it's on the Work page, and a guard carries nothing meanwhile", () => {
  const game = newGame();
  at(game, 34);
  game.location = "meridian";
  // The chief of security carries for the pantry here, and is on her way with crates when the alarm goes.
  take(game, "pantry", "ration_crate", 12);
  for (let gone = 0; gone < 60 && carrying(game, "pantry")?.phase !== "carrying"; gone += 5) run(game, 5);
  assert.deepEqual([carrying(game, "pantry")?.by, carrying(game, "pantry")?.phase], ["tarrow", "carrying"]);
  const all = () => count(game, "pantry", "ration_crate") + count(game, "shuttle_stores", "ration_crate") + (carrying(game, "pantry")?.load?.n ?? 0);
  const before = all();
  calm(() => sys.soundAlarm(game, "meridian", "bridge"));
  assert.equal(busyOnBoard(game, "meridian", "tarrow"), "carrying 2 ration crates to the pantry");
  run(game, 5);
  // The alarm takes her, and the crates are set down where she was.
  const shown = row(game, "alarm:bridge");
  assert.deepEqual([shown.what, shown.status, shown.mark, shown.busy, shown.canTake], ["Answer the alarm in The Bridge", "Lieutenant Tarrow is answering it", "!!", true, false]);
  assert.deepEqual([carrying(game, "pantry").phase, carrying(game, "pantry").by], ["down", null]);
  assert.equal(all(), before, "nothing's lost");
  assert.equal(busyOnBoard(game, "meridian", "tarrow"), "answering the alarm in the Bridge");
  assert.match(whereNow(game, "tarrow"), /^(answering the alarm|heading for the Bridge)/, "and it's where she's going");
  assert.match(row(game, "pantry:ration_crate").status, /^2 ration crates set down; nobody free: Lieutenant Tarrow is answering the alarm in the Bridge$/);
  // When it stops she picks them up again.
  calm(() => sys.silenceAlarm(game, "meridian"));
  assert.equal(row(game, "alarm:bridge"), null);
  run(game, 60);
  assert.ok(count(game, "pantry", "ration_crate") >= 2);
});

test("a fire and a breach come out the same however the clock is cut", () => {
  const once = newGame(7);
  const pieces = newGame(7);
  pieces.bodySeed = once.bodySeed;
  for (const one of [once, pieces]) {
    at(one, 33);
    calm(() => em.startFire(one, "meridian", "galley"));
    calm(() => em.startBreach(one, "meridian", "boat_bay"));
  }
  const before = crates(once);
  calm(() => passTime(once, 4));
  calm(() => { for (let gone = 0; gone < 240; gone += 5) passTime(pieces, 5 / 60); });
  for (const game of [once, pieces]) {
    assert.equal(em.fireIn(game, "meridian", "galley"), null, "the fire's out");
    assert.equal(em.breachIn(game, "meridian", "boat_bay"), null, "the hull's patched");
    assert.deepEqual(jobs(game).filter((one) => one.room), [], "and nobody's still on either");
    // The patch took a crate. (What the fire broke is mended an hour and a half after the clock last stopped, as
    // it always was, so its crate goes sooner when the time's taken in small pieces.)
    assert.ok(crates(game) <= before - 1 && crates(game) >= before - 3, `${before - crates(game)} crates used`);
  }
});
