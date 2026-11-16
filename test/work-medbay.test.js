// The medbay and the workshop on the ship's work board (the logistics rework, step 5, part 2): who answers a call for
// someone down is the board's choice, by the place's order of urgency, so a nurse sets down what she's carrying, or
// leaves a patient, for someone who's fallen, and leaves someone who's only down for someone bleeding; the medics and
// the menders start nothing with someone who's on other work; a job at the workshop's bench that's left is taken up
// again where it was; and it's all on the Work page. The ship's file is a copy here with Nurse Haru alone carrying
// for the pantry and the techs alone for the fuel rack, so that it's plain who's meant to go. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-work-medbay-"));
const logisticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-work-medbay-files-"));
const OWN = fs.readFileSync(new URL("../world/logistics/meridian.txt", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const FILE = OWN
  .replace("carried by the deckhands, the techs, the spare hands: A rack", "carried by the techs: A rack")
  .replace("carried by the deckhands, the cooks, the quartermaster, the spare hands", "carried by Nurse Haru")
  .replace("what comes first: the first officer, every hour\n", "")
  .replace("what stores want: the quartermaster, every 4 hours\n", "");
assert.ok(FILE.includes("carried by the techs: A rack") && FILE.includes("wants 4 of each; carried by Nurse Haru:") && !/what comes first|what stores want/.test(FILE), "the ship's file is written as this test expects");
fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), FILE);
process.env.GAME_LOGISTICS_DIR = logisticsDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const bag = await import("../src/bag.js");
const body = await import("../src/body.js");
const cmd = await import("../src/command.js");
const death = await import("../src/death.js");
const medbay = await import("../src/medbay.js");
const workshop = await import("../src/workshop.js");
const { logisticsOf, logisticsProblems, storesView } = await import("../src/logistics.js");
const { boardView, busyOnBoard } = await import("../src/work.js");
const { clockRuns, publicState } = await import("../src/rules.js");
const { standsAt } = await import("../src/life.js");
const { addDetour } = await import("../src/room-hooks.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const storeOf = (id) => logisticsOf("meridian").stores.find((one) => one.id === id);
const count = (game, storeId, item) => storesView(game, "meridian").find((one) => one.id === storeId).items.find((one) => one.id === item)?.n ?? 0;
const take = (game, storeId, item, n) => bag.storeTake(game, storeOf(storeId).key, storeOf(storeId).holds, item, n);
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
const carrying = (game, store) => jobs(game).find((one) => one.to === store) ?? null;
const row = (game, id) => boardView(game, "meridian").jobs.find((one) => one.id === id) ?? null;
const HARU = "Nurse Haru";
const ANTON = "Nurse Anton";
const keyOf = (who) => `crowd:meridian:${who.toLowerCase()}`;
const BAO = keyOf("Mess Hand Bao");
const spare = (game) => cmd.onJob(game, "meridian", null);
// Someone goes down where they stand, for a while.
function fall(game, who, why = "out cold", hours = 3) {
  assert.ok(medbay.fallDown(game, { who, place: "meridian", ...standsAt(game, "meridian", who), why, hours }), `${who} goes down`);
  return keyOf(who);
}
const callFor = (game, key) => game.down?.[key]?.call ?? null;
const wound = (game, kind, part, extra = {}) => ({ ...body.newWound(body.kindOf(kind, part), part), at: game.clock.hours, ...extra });
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

test("the ship's file has carrying the dead in its order, and it reads without a problem", () => {
  assert.deepEqual(logisticsProblems(), []);
  const urgency = logisticsOf("meridian").urgency;
  assert.deepEqual(urgency.slice(7, 10), ["treat", "dead", "carry"]);
  assert.ok(urgency.indexOf("bleeding") < urgency.indexOf("fallen") - 1, "someone bleeding is clearly above someone who's only down");
});

test("a call for someone down is a job on the board: the first nurse goes, the Work page says so, and she's on nothing else meanwhile", () => {
  const game = newGame();
  at(game, 32.5);
  const key = fall(game, "Deckhand Kofi");
  const said = run(game, 5);
  assert.ok(said.includes("[HEALTH] Nurse Haru sets off from the medbay for Deckhand Kofi."), said.join(" | "));
  assert.equal(callFor(game, key).by, HARU);
  const shown = row(game, `call:${key}`);
  assert.deepEqual([shown.what, shown.why, shown.mark, shown.busy, shown.stuck, shown.canTake], ["Carry Deckhand Kofi to the medbay", "out cold", "!!", true, false, false]);
  assert.match(shown.status, /^Nurse Haru is going to help Deckhand Kofi, since 08:3\d$/);
  assert.equal(shown.tip, "Carried by a nurse, and then by a spare hand.");
  assert.equal(boardView(game, "meridian").jobs[0].id, `call:${key}`, "it's first on the page");
  assert.equal(busyOnBoard(game, "meridian", HARU), "going to help Deckhand Kofi");
  // Asked to carry meanwhile, she isn't sent: the pantry's crates wait for her.
  take(game, "pantry", "ration_crate", 12);
  run(game, 5);
  assert.equal(carrying(game, "pantry"), null);
  assert.match(row(game, "pantry:ration_crate").status, /^nobody free: Nurse Haru is (going to help Deckhand Kofi|carrying Deckhand Kofi to the medbay)$/);
  // Once he's on a cot the call's over, and then she fetches the crates.
  run(game, 40);
  assert.ok(game.down[key].bed, "he's laid on a cot");
  assert.equal(row(game, `call:${key}`), null);
  assert.equal(carrying(game, "pantry")?.by ?? HARU, HARU);
  run(game, 60);
  assert.ok(count(game, "pantry", "ration_crate") >= 2, "the crates come after");
  assert.deepEqual(publicState(game).ship.board.jobs.filter((one) => one.id.startsWith("call:")), []);
});

test("a nurse carrying crates sets them down for someone who's fallen, and carries them on afterwards", () => {
  const game = newGame();
  at(game, 34);
  take(game, "pantry", "ration_crate", 12);
  for (let gone = 0; gone < 60 && carrying(game, "pantry")?.phase !== "carrying"; gone += 5) clockRuns(game, 5);
  assert.deepEqual([carrying(game, "pantry")?.phase, carrying(game, "pantry")?.by, carrying(game, "pantry")?.load], ["carrying", HARU, { item: "ration_crate", n: 2 }]);
  const all = () => count(game, "pantry", "ration_crate") + count(game, "shuttle_stores", "ration_crate") + (carrying(game, "pantry")?.load?.n ?? 0);
  const before = all();
  const key = fall(game, "Deckhand Kofi");
  run(game, 5);
  assert.equal(callFor(game, key).by, HARU, "carrying is well below someone who's down, so she goes");
  assert.deepEqual([carrying(game, "pantry").phase, carrying(game, "pantry").by, carrying(game, "pantry").load], ["down", null, { item: "ration_crate", n: 2 }], "and the crates are set down");
  assert.equal(all(), before, "nothing's lost");
  assert.match(row(game, "pantry:ration_crate").status, /^2 ration crates set down; nobody free: Nurse Haru is going to help Deckhand Kofi$/);
  run(game, 90);
  assert.ok(game.down[key].bed);
  assert.ok(count(game, "pantry", "ration_crate") >= 2, "the crates she set down are in the pantry");
  assert.equal(all(), before);
});

test("a nurse leaves a patient for someone who's fallen, the next call takes someone else, and nobody's in two places", () => {
  const game = newGame();
  run(game, 10);
  // As a game begins the doctor has Hana and Nurse Haru has Vik.
  const treating = () => Object.entries(game.medbay.meridian.treating).map(([patient, job]) => [patient, job.by]);
  assert.deepEqual(treating(), [[keyOf("Hana"), "aduro"], [keyOf("Vik"), HARU]]);
  assert.match(row(game, `treat:${keyOf("Vik")}`).status, /^Nurse Haru is seeing to it, \d+ minutes left, since 08:00$/);
  assert.equal(row(game, `treat:${keyOf("Vik")}`).what, "Treat Vik's broken right leg");
  assert.equal(busyOnBoard(game, "meridian", HARU), "treating Vik");
  assert.equal(busyOnBoard(game, "meridian", HARU, "treat"), null, "which the medbay doesn't count against her for its own work");
  const first = fall(game, "Deckhand Kofi");
  const said = run(game, 5);
  assert.ok(said.includes("[HEALTH] Nurse Haru sets off from the medbay for Deckhand Kofi."), said.join(" | "));
  assert.equal(callFor(game, first).by, HARU, "the first nurse goes, though she was treating: a call is well above treating");
  assert.ok(!treating().some(([, by]) => by === HARU), "and she isn't at the table as well");
  // Vik waits for whoever's next, and the doses she'd drawn went back in the crate.
  const vik = row(game, `treat:${keyOf("Vik")}`);
  assert.ok(vik, "Vik's leg is still to be seen to");
  assert.doesNotMatch(vik.status, /^Nurse Haru/);
  // A second call isn't hers: she's on one as urgent already.
  const second = fall(game, "Deckhand Ines");
  run(game, 5);
  const other = callFor(game, second)?.by;
  assert.ok(other && other !== HARU && [ANTON, ...spare(game)].includes(other), `${other} answers the second`);
  const everyone = [...Object.values(game.down).map((d) => d.call?.by), ...treating().map(([, by]) => by), ...jobs(game).map((one) => one.by)].filter(Boolean);
  assert.equal(new Set(everyone).size, everyone.length, `nobody's on two jobs: ${everyone.join(", ")}`);
});

test("someone bleeding comes before someone who's only down: with nobody else to send, the nurse leaves one for the other", () => {
  const game = newGame();
  at(game, 32.5);
  without([ANTON, ...spare(game)], () => {
    const kofi = fall(game, "Deckhand Kofi");
    run(game, 5);
    assert.equal(callFor(game, kofi).by, HARU);
    game.bodies ??= {};
    game.bodies[BAO] = { wounds: [wound(game, "deep_cut", "chest", { until: game.clock.hours + 400 })], blood: 30 };
    fall(game, "Mess Hand Bao", "too weak from losing blood");
    run(game, 5);
    assert.equal(callFor(game, BAO)?.by, HARU, "she goes to whoever's bleeding");
    assert.equal(callFor(game, kofi), null);
    assert.equal(game.down[kofi].carriedBy ?? null, null, "and Kofi lies where he was left");
    const rows = boardView(game, "meridian").jobs.filter((one) => one.id.startsWith("call:"));
    assert.deepEqual(rows.map((one) => [one.id, one.why, one.busy]), [[`call:${BAO}`, "bleeding", true], [`call:${kofi}`, "out cold", false]], "the bleeding first on the page");
    assert.match(rows[1].status, /^nobody free: Nurse Haru is (going to help|carrying) Mess Hand Bao/);
    assert.equal(rows[1].stuck, true);
  });
});

test("the dead are carried too, after the living, and nobody's woken for them", () => {
  const game = newGame();
  at(game, 27);
  // At three in the morning Nurse Anton has the watch, and some of the spare hands are up. With all of them taken,
  // nobody gets up for a body.
  without([ANTON, ...spare(game)], () => {
    const key = fall(game, "Mess Hand Bao");
    death.die(game, key);
    assert.equal(game.down[key].dead, true);
    run(game, 10);
    assert.equal(callFor(game, key), null);
    const shown = row(game, `call:${key}`);
    assert.deepEqual([shown.what, shown.mark, shown.busy, shown.stuck], ["Carry Mess Hand Bao's body to the Quiet Room", "", false, true]);
    assert.equal(shown.status, "nobody free: Nurse Haru is asleep, 7 are wanted on the bridge");
    // Someone alive who falls is another matter: the call wakes the day nurse.
    const kofi = fall(game, "Deckhand Kofi");
    const said = run(game, 5);
    assert.ok(said.includes("[HEALTH] The call wakes Nurse Haru, who sets off from the medbay for Deckhand Kofi."), said.join(" | "));
    assert.equal(callFor(game, kofi).by, HARU);
    assert.equal(callFor(game, key), null, "and still nobody's woken for the dead");
  });
  // With the night nurse free, he takes the body.
  run(game, 5);
  const key = keyOf("Mess Hand Bao");
  assert.equal(callFor(game, key)?.by, ANTON);
  assert.match(row(game, `call:${key}`).status, /^Nurse Anton is (going for Mess Hand Bao's body|carrying Mess Hand Bao's body away), since 03:\d\d$/);
});

test("a patient waits while the only nurse is on urgent carrying, and takes her from an ordinary errand", () => {
  const game = newGame();
  at(game, 34);
  // The pantry bare, so that the galley has nothing to cook from: carrying for it is urgent, two lines above treating.
  take(game, "pantry", "ration_crate", 12);
  take(game, "pantry", "produce", 12);
  run(game, 5);
  assert.deepEqual([carrying(game, "pantry")?.by, carrying(game, "pantry")?.kind], [HARU, "carry_urgent"]);
  // Bao on a cot with a deep cut to be seen to, and the doctor and the night nurse out of it.
  game.bodies ??= {};
  game.bodies[BAO] = { wounds: [wound(game, "deep_cut", "left_arm")], blood: 90 };
  game.down[BAO] = { who: "Mess Hand Bao", place: "meridian", level: "deck2", x: 12, y: 8, since: game.clock.hours, until: game.clock.hours, why: "laid up", bed: "patient-3" };
  without(["aduro", ANTON], () => {
    run(game, 5);
    assert.equal(game.medbay.meridian.treating[BAO], undefined, "nobody's at the table");
    assert.equal(carrying(game, "pantry")?.by, HARU, "the nurse keeps carrying: the galley comes first");
    const waits = row(game, `treat:${BAO}`);
    assert.equal(waits.what, "Treat Mess Hand Bao's deep cut in the left arm");
    assert.match(waits.status, /^nobody free: 2 are wanted on the bridge, Nurse Haru is (fetching|taking) (ration crates|produce) from the (shuttle stores|garden bins)$/);
    assert.deepEqual([waits.busy, waits.stuck, waits.mark], [false, true, ""]);
    // Once something's in the pantry the rest is ordinary carrying, two lines below treating: she leaves it for him.
    for (let gone = 0; gone < 120 && !game.medbay.meridian.treating[BAO]; gone += 5) clockRuns(game, 5);
    assert.equal(game.medbay.meridian.treating[BAO]?.by, HARU);
    assert.ok(!jobs(game).some((one) => one.by === HARU), "and she isn't carrying as well");
    assert.match(row(game, `treat:${BAO}`).status, /^Nurse Haru is seeing to it, \d+ minutes? left, since 1\d:\d\d$/);
  });
  // With the cabinet empty, the page says that instead.
  const empty = newGame();
  at(empty, 34);
  empty.bodies ??= {};
  empty.bodies[BAO] = { wounds: [wound(empty, "deep_cut", "left_arm")], blood: 90 };
  empty.down[BAO] = { who: "Mess Hand Bao", place: "meridian", level: "deck2", x: 12, y: 8, since: empty.clock.hours, until: empty.clock.hours, why: "laid up", bed: "patient-3" };
  empty.medbay.meridian.doses = 0;
  take(empty, "medicine_cabinet", "medicine_crate", 99);
  run(empty, 10);
  assert.deepEqual([row(empty, `treat:${BAO}`).status, row(empty, `treat:${BAO}`).stuck], ["the medicine cabinet is empty", true]);
});

test("a tech leaves the workshop's bench for the generator's fuel, and what was half built is taken up where it was", () => {
  const game = newGame();
  at(game, 34);
  const [only, ...others] = cmd.onJob(game, "meridian", "tech");
  for (const key of others) cmd.assignJob(game, "meridian", key, "deckhand");
  cmd.setHolder(game, "meridian", "chief_engineer", null);
  // Bao has lost a leg and had the stump dressed: the workshop builds one.
  game.bodies ??= {};
  game.bodies[BAO] = { wounds: [wound(game, "lost", "right_leg", { dressed: true, dressedAt: game.clock.hours })] };
  run(game, 10);
  const id = `build:${BAO}:right_leg`;
  const job = () => game.workshop.meridian.jobs[id];
  assert.equal(job()?.by, only, "the tech's at the bench");
  const built = row(game, `workshop:${id}`);
  assert.equal(built.what, "Build an artificial right leg for Mess Hand Bao");
  assert.match(built.status, new RegExp(`^${only} is at it in the Repair Bay, \\d+ hours left, since 10:\\d\\d$`));
  assert.equal(busyOnBoard(game, "meridian", only), "building an artificial right leg in the Repair Bay");
  const due = job().until;
  // The rack down to its last cell, and only the techs carry for it: urgent carrying is far above the bench.
  take(game, "fuel_rack", "fuel_cell", 5);
  run(game, 5);
  assert.equal(carrying(game, "fuel_rack")?.by, only, "the tech has gone for the fuel");
  assert.deepEqual([job().by, job().until], [null, null], "and the leg is set down");
  assert.ok(Math.abs(job().left - (due - game.clock.hours)) < 0.2, `what was left of it is kept: ${job().left} hours`);
  const waits = row(game, `workshop:${id}`);
  assert.deepEqual([waits.why, waits.busy, waits.stuck], ["set down on the bench", false, true]);
  assert.match(waits.status, new RegExp(`^nobody free: ${only} is fetching fuel cells from the shuttle stores$`));
  assert.match(workshop.workshopView(game, "meridian").lines.join(" | "), /An artificial right leg for Mess Hand Bao is set down part built, waiting for a free hand/);
  // A save and a load keep it set down.
  const loaded = JSON.parse(JSON.stringify(game));
  assert.deepEqual([loaded.workshop.meridian.jobs[id].by, loaded.workshop.meridian.jobs[id].until], [null, null]);
  // The fuel's brought, and the leg is taken up again with the hours it still needed, not from the start.
  const left = job().left;
  for (let gone = 0; gone < 120 && !job().by; gone += 5) clockRuns(game, 5);
  assert.equal(job().by, only);
  assert.ok(count(game, "fuel_rack", "fuel_cell") >= 3, "the rack has what it wants");
  assert.ok(job().until - game.clock.hours <= left + 0.26 && job().until - game.clock.hours > left - 0.2, "what was left, and the walk back to the bench");
});
