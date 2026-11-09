// The ship's chain of command, step 2: the watch bill. Everyone named aboard without a post has a job (or is a spare
// hand), written in world/command/meridian.txt and kept in the save; their day is their job's; the machines, errands
// and systems count people by job; the captain moves people with two clicks; and Commander Voss covers for anyone lost
// from their job with a spare hand. Crew aboard are on it too, and their shifts follow it. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-watch-bill-"));
const commandDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-watch-bill-files-"));
fs.copyFileSync(new URL("../world/command/meridian.txt", import.meta.url), path.join(commandDir, "meridian.txt"));
process.env.GAME_COMMAND_DIR = commandDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const cmd = await import("../src/command.js");
const life = await import("../src/life.js");
const lg = await import("../src/logistics.js");
const bag = await import("../src/bag.js");
const sys = await import("../src/systems.js");
const { migrateGame } = await import("../src/migrate.js");
const { clockRuns, passTime, publicState } = await import("../src/rules.js");
const { jobHere } = await import("../src/role.js");
const { reloadCommand } = await import("../src/world.js");
const { readWorkersLine } = await import("../public/command-text.js");

const newGame = (start = "captain", seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = start;
  return createGameFromDraft(draft);
};
const FILE = fs.readFileSync(path.join(commandDir, "meridian.txt"), "utf8");
function withFile(text, run) {
  try {
    fs.writeFileSync(path.join(commandDir, "meridian.txt"), text);
    reloadCommand();
    cmd.clearCommand();
    return run();
  } finally {
    fs.writeFileSync(path.join(commandDir, "meridian.txt"), FILE);
    reloadCommand();
    cmd.clearCommand();
  }
}
const at = (game, hours) => {
  game.clock.hours = hours;
  clockRuns(game, 1);
};
const minutes = (game, n) => {
  for (let gone = 0; gone < n; gone += 5) clockRuns(game, 5);
};
const bill = (game) => cmd.commandView(game).watchBill;
const row = (game, id) => bill(game).jobs.find((one) => one.id === id);
const names = (people) => people.map((one) => one.name);

test("the file says who does which job, each job has a day, and the checker catches a bad line", () => {
  assert.deepEqual(readWorkersLine("cook: Cook Imre, Cook Dessa"), { job: "cook", people: ["Cook Imre", "Cook Dessa"] });
  assert.deepEqual(readWorkersLine("guard: nobody"), { job: "guard", people: [] });
  assert.match(readWorkersLine("cook Cook Imre").problem, /needs a colon/);
  const model = cmd.commandOf("meridian");
  assert.deepEqual(model.problems, []);
  assert.equal(model.startJob["Cook Imre"], "cook");
  assert.equal(model.startJob["Ensign Nadia"], "ensign");
  assert.equal(model.startJob.Yusuf, null, "a spare hand");
  assert.equal("Vik" in model.startJob, false, "the sick aren't on the watch bill");
  const job = (id) => model.jobs.find((one) => one.id === id);
  assert.deepEqual([job("cook").first, job("cook").day[0].doing, job("cook").day[0].go], ["Cook Imre", "cooking", "galley"]);
  assert.deepEqual([job("guard").first, job("guard").day[0].doing, job("guard").day[0].go], [null, "on duty in the Aft Holds", "@aft"], "a job nobody starts in gets a plain day at its room");
  assert.equal(model.spareDay[0].go, "benches");
  const bad = FILE.replace("- cook: Cook Imre, Cook Dessa", "- cook: Cook Imre, Cook Dessa, Cook Imre\n- juggler: Teo\n- nurse: voss, Mott Jessup");
  withFile(bad, () => {
    const problems = cmd.commandProblems().join(" | ");
    for (const want of [/Cook Imre is given two jobs/, /no job called juggler under Jobs/, /voss holds a post, so they aren't on the watch bill/, /nobody called Mott Jessup has a day at CFS Meridian/]) assert.match(problems, want);
  });
});

test("a new game's watch bill has everyone in their job, the player too if they're crew, and an old save gets the same", () => {
  const game = newGame();
  const jobs = game.command.meridian.jobs;
  assert.equal(jobs["Tech Oona"], "tech");
  assert.equal(jobs.Petra, null);
  assert.equal("you" in jobs, false, "the captain isn't on the watch bill");
  assert.deepEqual(names(row(game, "guard").people), []);
  assert.equal(row(game, "guard").short, 2);
  const hand = newGame("engine_hand");
  assert.equal(hand.command.meridian.jobs.you, "tech", "the engine hand works in engineering, with the techs");
  assert.ok(row(hand, "tech").people.some((one) => one.you && one.name === `You, ${hand.name}`));
  const marine = newGame("marine");
  assert.equal(marine.command.meridian.jobs.you, "guard");
  assert.equal(row(marine, "guard").short, 1);
  // An old save gets the file's watch bill; a save made at step 1, with posts but no watch bill, reads the file's.
  const { command: _gone, ...old } = JSON.parse(JSON.stringify(hand));
  assert.deepEqual(migrateGame({ ...old, version: 17 }).command.meridian.jobs, hand.command.meridian.jobs);
  const stepOne = JSON.parse(JSON.stringify(game));
  delete stepOne.command.meridian.jobs;
  const before = JSON.stringify(stepOne);
  assert.equal(cmd.jobOf(stepOne, "meridian", "Cook Imre"), "cook");
  assert.equal(bill(stepOne).jobs.length, 8);
  assert.equal(JSON.stringify(stepOne), before, "reading it changes nothing");
});

test("moving the cooks to the garden: they walk there, the galley stops, the sitting goes hungry, and putting them back puts it right", () => {
  const game = newGame();
  at(game, 10);
  assert.deepEqual(life.usuallyIn(game, "meridian", "galley", 600, "cook"), ["Cook Imre", "Cook Dessa"]);
  assert.equal(cmd.assignJob(game, "meridian", "Cook Imre", "gardener"), "Cook Imre is a gardener now, in The Garden.");
  cmd.assignJob(game, "meridian", "Cook Dessa", "gardener");
  assert.deepEqual(life.usuallyIn(game, "meridian", "galley", 600, "cook"), []);
  minutes(game, 30);
  assert.match(life.whereNow(game, "Cook Imre"), /^tending the beds, at the Garden/);
  assert.equal(lg.machinesView(game, "meridian").find((one) => one.id === "galley").status, "waiting for a cook there");
  assert.deepEqual(names(row(game, "gardener").people).sort(), ["Cook Dessa", "Cook Imre", "Gardener Benno", "Gardener Odile"]);
  assert.equal(row(game, "cook").short, 2);
  // Through the evening's sittings, the kettle runs dry and stays dry.
  passTime(game, 12, "routine");
  const meals = game.logistics.meridian.meals.days[0];
  assert.ok(meals.missed > 0, `${meals.missed} went without`);
  cmd.assignJob(game, "meridian", "Cook Imre", "cook");
  cmd.assignJob(game, "meridian", "Cook Dessa", "cook");
  at(game, 24 + 9);
  minutes(game, 60);
  assert.match(life.whereNow(game, "Cook Imre"), /^cooking, at the Galley/);
  assert.notEqual(lg.machinesView(game, "meridian").find((one) => one.id === "galley").status, "waiting for a cook there");
  assert.deepEqual(bill(game).log.slice(0, 2), ["Day 1: You put Cook Dessa on as a cook.", "Day 1: You put Cook Imre on as a cook."]);
});

test("a spare hand put on as a cook takes the cooks' day, and the galley works with them", () => {
  const game = newGame();
  at(game, 10);
  cmd.assignJob(game, "meridian", "Cook Imre", "spare");
  cmd.assignJob(game, "meridian", "Cook Dessa", "spare");
  cmd.assignJob(game, "meridian", "Yusuf", "cook");
  assert.deepEqual(life.usuallyIn(game, "meridian", "galley", 600, "cook"), ["Yusuf"]);
  minutes(game, 30);
  assert.match(life.whereNow(game, "Yusuf"), /^cooking, at the Galley/);
  assert.match(life.whereNow(game, "Cook Imre"), /^(eating|waiting in the medbay queue|reading the names|patching something|talking in the corridor|heading for)/, "and Imre has the spare hands' day");
  assert.notEqual(lg.machinesView(game, "meridian").find((one) => one.id === "galley").status, "waiting for a cook there");
});

test("an errand that names a job is carried by whoever does it and is free, and nobody carries when nobody does it", () => {
  const errands = lg.logisticsOf("meridian").errands;
  assert.deepEqual(errands.filter((one) => one.job).map((one) => [one.id, one.job]), [["tech:fuel_cell", "tech"], ["cook:produce", "cook"], ["tech:parts_crate", "tech"]]);
  const game = newGame();
  at(game, 10);
  const store = (id) => lg.logisticsOf("meridian").stores.find((one) => one.id === id);
  bag.storeTake(game, store("fuel_rack").key, store("fuel_rack").holds, "fuel_cell", 5);
  bag.storeTake(game, store("parts_lockers").key, store("parts_lockers").holds, "parts_crate", 5);
  minutes(game, 5);
  const fuel = game.logistics.meridian.errands["tech:fuel_cell"];
  const parts = game.logistics.meridian.errands["tech:parts_crate"];
  assert.ok(fuel && parts, "both errands begun");
  assert.notEqual(fuel.by, parts.by, "by two different techs");
  assert.ok(cmd.onJob(game, "meridian", "tech").includes(fuel.by));
  assert.equal(lg.errandsView(game, "meridian").find((one) => one.id === "tech:fuel_cell").who, fuel.by);
  assert.ok(lg.errandDetour(game, "meridian")(fuel.by));
  // With every tech moved to the deckhands, a new errand finds nobody to carry it.
  const empty = newGame();
  at(empty, 10);
  for (const key of ["Tech Sami", "Tech Oona", "Tech Goran"]) cmd.assignJob(empty, "meridian", key, "deckhand");
  bag.storeTake(empty, store("fuel_rack").key, store("fuel_rack").holds, "fuel_cell", 5);
  minutes(empty, 15);
  assert.equal(empty.logistics.meridian.errands?.["tech:fuel_cell"], undefined);
  assert.equal(lg.errandsView(empty, "meridian").find((one) => one.id === "tech:fuel_cell").who, "A tech");
});

test("the techs are the engineers and the guards are whoever guards, as the watch bill has them", () => {
  const model = sys.systemsOf("meridian");
  assert.deepEqual(model.engineers, ["post:chief_engineer", "job:tech"]);
  assert.deepEqual(model.guards, ["post:chief_of_security", "job:guard"]);
  const game = newGame();
  assert.deepEqual(sys.staffOf(game, "meridian", model.engineers), ["marrow", "Tech Sami", "Tech Oona", "Tech Goran"]);
  assert.deepEqual(sys.staffOf(game, "meridian", model.guards), ["tarrow"]);
  cmd.assignJob(game, "meridian", "Tech Goran", "cook");
  cmd.assignJob(game, "meridian", "Yusuf", "guard");
  assert.deepEqual(sys.staffOf(game, "meridian", model.engineers), ["marrow", "Tech Sami", "Tech Oona"]);
  assert.deepEqual(sys.staffOf(game, "meridian", model.guards), ["tarrow", "Yusuf"]);
  assert.equal(sys.staffWords("meridian", "job:tech"), "the techs");
  // The marine is a guard on the watch bill, but the player's own hands are never sent anywhere by the systems.
  assert.deepEqual(sys.staffOf(newGame("marine"), "meridian", model.guards), ["tarrow"]);
});

test("only the captain moves people on the watch bill, and never themselves", () => {
  const game = newGame();
  assert.deepEqual(cmd.commandCommand(game, { action: "assign", key: "Petra", job: "nurse" }), { message: "Petra is a nurse now, in Medbay." });
  assert.equal(cmd.commandCommand(game, { action: "assign", key: "Petra", job: "nurse" }).message, "Petra is already a nurse.");
  assert.equal(cmd.commandCommand(game, { action: "assign", key: "Petra", job: "spare" }).message, "Petra is one of the spare hands now.");
  assert.throws(() => cmd.commandCommand(game, { action: "assign", key: "odessa", job: "cook" }), /aren't on the watch bill/);
  assert.throws(() => cmd.commandCommand(game, { action: "assign", key: "Petra", job: "juggler" }), /no such job/);
  const hand = newGame("engine_hand");
  assert.throws(() => cmd.commandCommand(hand, { action: "assign", key: "Petra", job: "nurse" }), /Only the captain/);
  assert.equal(bill(hand).canMove, false);
  assert.equal(bill(game).canMove, true);
});

test("Voss covers for someone lost from their job with a spare hand, and sends the spare hand back when they return", () => {
  const game = newGame();
  at(game, 10);
  game.deeds = { hurt: { "meridian:Cook Dessa": game.clock.hours + 6 } };
  const notes = [];
  for (let gone = 0; gone < 10; gone += 5) notes.push(...clockRuns(game, 5));
  assert.ok(notes.includes("[COMMAND] Voss has put Yusuf on as a cook while Cook Dessa is being patched up."), notes.join(" | "));
  assert.equal(cmd.jobOf(game, "meridian", "Yusuf"), "cook");
  const cook = row(game, "cook");
  assert.deepEqual(cook.people.map((one) => [one.name, one.lost, one.covering]), [["Cook Imre", null, null], ["Cook Dessa", "being patched up", null], ["Yusuf", null, "Cook Dessa"]]);
  assert.equal(cook.short, 0);
  const back = [];
  for (let gone = 0; gone < 6 * 60 + 10; gone += 5) back.push(...clockRuns(game, 5));
  assert.ok(back.includes("[COMMAND] Cook Dessa is back as a cook, and Yusuf goes back to the spare hands."), back.join(" | "));
  assert.equal(cmd.jobOf(game, "meridian", "Yusuf"), null);
  assert.deepEqual(game.command.meridian.cover, {});
  // With the first officer gone, nobody covers.
  const leaderless = newGame();
  at(leaderless, 10);
  const voss = leaderless.contacts.find((one) => one.name === "Ilya Voss");
  if (voss) voss.status = "dead";
  else leaderless.contacts.push({ name: "Ilya Voss", status: "dead", attitude: "friendly", note: "" });
  leaderless.deeds = { hurt: { "meridian:Cook Dessa": leaderless.clock.hours + 6 } };
  minutes(leaderless, 10);
  assert.equal(cmd.jobOf(leaderless, "meridian", "Yusuf"), null);
});

test("crew aboard work the shift the watch bill has them on", () => {
  const hand = newGame("engine_hand");
  assert.equal(jobHere(hand).name, "Work a shift in Engineering");
  hand.command.meridian.jobs.you = "cook";
  const shift = jobHere(hand);
  assert.deepEqual([shift.name, shift.pay, shift.skill], ["Work a shift as a cook in the Galley", 14, "survival"]);
  assert.match(shift.done, /a shift as a cook, in the Galley/);
  assert.equal(jobHere(newGame()), null, "the captain has no shift to work");
});

test("the Command menu's watch bill reads without changing anything", () => {
  const game = newGame();
  cmd.assignJob(game, "meridian", "Cook Imre", "gardener");
  const before = JSON.stringify(game);
  const view = publicState(game).command.watchBill;
  assert.equal(view.keeper, "Ilya Voss");
  assert.deepEqual(view.jobs.map((one) => one.plural), ["Cooks", "Mess hands", "Gardeners", "Techs", "Nurses", "Deckhands", "Ensigns", "Guards"]);
  assert.deepEqual(names(view.spare), ["Yusuf", "Salome", "Emeka", "Ayla", "Teo", "Petra"]);
  assert.deepEqual(view.log, ["Day 1: You put Cook Imre on as a gardener."]);
  assert.equal(JSON.stringify(game), before);
});
