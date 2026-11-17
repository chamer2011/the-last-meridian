// The ship's chain of command, step 3: how well each post's holder does. Each post's duty is measured at midnight from
// what the game already counts (the kettle running dry, the generator short, alarms, thefts, deaths, empty stations),
// kept a week back and shown as a bar on its card; and skill shows in the work, from the numbers in each person's
// file: repairs go quicker under a better engineer, and the galley's pot goes on sooner under a better cook. None of
// this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-duty-"));
const commandDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-duty-files-"));
fs.copyFileSync(new URL("../world/command/meridian.txt", import.meta.url), path.join(commandDir, "meridian.txt"));
process.env.GAME_COMMAND_DIR = commandDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const cmd = await import("../src/command.js");
const lg = await import("../src/logistics.js");
const bag = await import("../src/bag.js");
const sys = await import("../src/systems.js");
const { settleDeed } = await import("../src/deeds.js");
const { clockRuns, passTime, publicState } = await import("../src/rules.js");
const { reloadCommand } = await import("../src/world.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
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
const card = (game, id) => cmd.commandView(game).groups.flatMap((group) => group.posts).find((one) => one.id === id);
// To the next midnight and a little past it, so that the day just ended is settled.
const toMidnight = (game) => passTime(game, Math.ceil(game.clock.hours / 24 + 1e-9) * 24 - game.clock.hours + 0.1, "routine");
const store = (id) => lg.logisticsOf("meridian").stores.find((one) => one.id === id);

test("each post's duty words are what it's measured by, and a word the game can't measure is a problem", () => {
  const post = (id) => cmd.commandOf("meridian").posts.find((one) => one.id === id);
  assert.deepEqual(post("quartermaster").measures, ["sittings missed", "stores run dry"]);
  assert.deepEqual(post("chief_engineer").measures, ["power short", "repairs waiting", "hull worn"]);
  assert.deepEqual(post("speaker").measures, ["the council's confidence"], "the speaker is marked on the council's confidence in the captain");
  assert.deepEqual(cmd.commandProblems(), []);
  withFile(FILE.replace("duty: sittings missed, stores run dry", "duty: sittings missed, cheerfulness"), () => {
    assert.match(cmd.commandProblems().join(" | "), /cheerfulness isn't something a post's duty can be measured by: the measures are morale, shortages/);
  });
});

test("skill is a file's number, or a 5 at your own job and a 2 at others, and the file says how much each point counts", () => {
  const game = newGame();
  assert.equal(cmd.skillOfPerson(game, "meridian", "marrow", "engineering"), 8);
  assert.equal(cmd.skillOfPerson(game, "meridian", "Cook Imre", "survival"), 5);
  assert.equal(cmd.skillOfPerson(game, "meridian", "Cook Imre", "engineering"), 2);
  assert.equal(cmd.skillOfPerson(game, "meridian", "Yusuf", "survival"), 2, "a spare hand has no job of their own");
  assert.equal(cmd.speedOf(game, "meridian", ["marrow"], "engineering"), 1.24);
  assert.equal(cmd.speedOf(game, "meridian", ["Cook Imre"], "survival"), 1);
  assert.equal(cmd.speedOf(game, "meridian", ["Yusuf", "Salome"], "survival"), 0.76);
  assert.equal(cmd.speedOf(game, "meridian", ["Yusuf", "marrow"], "engineering"), 1.24, "the best of them sets the pace");
  assert.equal(cmd.speedOf(game, "meridian", [], "survival"), 1);
  withFile(FILE.replace("each point of skill: 8% quicker or slower\n", ""), () => {
    assert.equal(cmd.speedOf(game, "meridian", ["marrow"], "engineering"), 1, "without the line, skill doesn't change the pace");
  });
});

test("repairs go quicker under a better engineer, and slower without one", () => {
  const game = newGame();
  const box = Object.values(sys.systemsOf("meridian").parts).find((one) => one.name === "junction box" && one.room === "engineering");
  sys.damagePart(game, "meridian", box.id, "cut", { by: "story" });
  assert.ok(Math.abs(game.systems.meridian.parts[box.id].fixAt - game.clock.hours - 2 / 1.24) < 0.001, "Marrow's engineering 8 takes two hours down to about an hour and three-quarters");
  // Hask as chief engineer, with the techs moved off: his engineering 4 makes it a little slower than the place's two hours.
  const slow = newGame();
  cmd.setHolder(slow, "meridian", "chief_engineer", "tobin");
  for (const key of ["Tech Sami", "Tech Oona", "Tech Goran"]) cmd.assignJob(slow, "meridian", key, "deckhand");
  sys.damagePart(slow, "meridian", box.id, "cut", { by: "story" });
  assert.ok(Math.abs(slow.systems.meridian.parts[box.id].fixAt - slow.clock.hours - 2 / 0.92) < 0.001);
});

test("the galley's pot goes on sooner under a better cook, and later under spare hands who aren't cooks", () => {
  const made = (game) => game.logistics.meridian.machines.galley?.made ?? 0;
  const morning = (swap) => {
    const game = newGame();
    game.clock.hours = 9;
    clockRuns(game, 1);
    if (swap) {
      cmd.assignJob(game, "meridian", "Cook Imre", "spare");
      cmd.assignJob(game, "meridian", "Cook Dessa", "spare");
      cmd.assignJob(game, "meridian", "Yusuf", "cook");
      cmd.assignJob(game, "meridian", "Salome", "cook");
    }
    // An empty kettle and a full pantry, so the only thing that holds the galley back is who's cooking.
    game.stores[store("soup_kettle").key] = { count: 0 };
    lg.fillStores(game, "meridian");
    game.stores[store("soup_kettle").key] = { count: 0 };
    // From a standing start: the kettle holds two pots, so two hours is as much as it can take.
    game.logistics.meridian.machines.galley.progress = 0;
    const before = made(game);
    for (let gone = 0; gone < 120; gone += 5) clockRuns(game, 5);
    return made(game) - before;
  };
  assert.equal(morning(false), 2, "a pot an hour with the cooks");
  assert.equal(morning(true), 1, "and slower with two spare hands, whose survival is a 2");
});

test("each post's duty is settled at midnight from the day's numbers, and kept a week", () => {
  const game = newGame();
  toMidnight(game);
  const quartermaster = card(game, "quartermaster");
  assert.equal(quartermaster.duty.days, 1);
  assert.equal(quartermaster.duty.score, 100);
  assert.equal(quartermaster.duty.last, "sittings missed 100/100, stores run dry 100/100");
  assert.equal(card(game, "first_officer").duty.last, "stations staffed 90/100", "the guards are two short of the twenty the watch bill wants");
  assert.match(card(game, "speaker").duty.last, /^the council's confidence \d+\/100$/, "the speaker is marked on the council's confidence");
  passTime(game, 24 * 8, "routine");
  assert.equal(game.command.meridian.duty.quartermaster.length, 7);
  assert.equal(card(game, "quartermaster").duty.days, 7);
});

test("the kettle running dry two nights brings the quartermaster's duty down", () => {
  const game = newGame();
  game.clock.hours = 9;
  clockRuns(game, 1);
  cmd.assignJob(game, "meridian", "Cook Imre", "spare");
  cmd.assignJob(game, "meridian", "Cook Dessa", "spare");
  toMidnight(game);
  passTime(game, 24, "routine");
  const quartermaster = card(game, "quartermaster");
  assert.equal(quartermaster.duty.days, 2);
  assert.ok(quartermaster.duty.score < 70, `Brandt's duty is ${quartermaster.duty.score}`);
  assert.match(quartermaster.duty.last, /^sittings missed \d+\/100, stores run dry 100\/100$/);
  assert.ok(Number(quartermaster.duty.last.match(/sittings missed (\d+)/)[1]) < 40, quartermaster.duty.last);
});

test("the generator running out of cells brings the chief engineer's duty down", () => {
  const game = newGame();
  const model = lg.logisticsOf("meridian");
  const refills = model.refills;
  model.refills = [];
  try {
    toMidnight(game);
    // No cell aboard, and none in the generator: two and a half hours without power, then cells in the rack again. Not
    // a day of it, as this used to run: a ship with no power has no air, and nobody aboard outlives that by more than
    // a few hours (test/no-air.test.js), the chief engineer included.
    bag.storeTake(game, store("fuel_rack").key, store("fuel_rack").holds, "fuel_cell", 99);
    bag.storeTake(game, store("shuttle_stores").key, store("shuttle_stores").holds, "fuel_cell", 99);
    game.logistics.meridian.machines.generator = { ...(game.logistics.meridian.machines.generator ?? { progress: 0, made: 0, waiting: null }), burning: 0 };
    passTime(game, 2.5, "routine");
    assert.equal(lg.powerSupply(game, "meridian"), 0);
    bag.storePut(game, store("fuel_rack").key, store("fuel_rack").holds, "fuel_cell", 3);
    toMidnight(game);
  } finally {
    model.refills = refills;
  }
  assert.equal(game.dead, undefined, "nobody died of it");
  const chief = card(game, "chief_engineer");
  const marks = chief.duty.last.match(/^power short (\d+)\/100, repairs waiting 100\/100, hull worn \d+\/100$/);
  assert.ok(marks, chief.duty.last);
  assert.ok(Number(marks[1]) >= 60 && Number(marks[1]) <= 82, `two and a half hours of it: ${chief.duty.last}`);
  assert.ok(chief.duty.score < 95, `Marrow's duty is ${chief.duty.score}`);
});

test("an alarm and a pocket picked aboard go on the chief of security's record, and deaths aboard on the doctor's", () => {
  const game = newGame();
  game.location = "meridian";
  sys.soundAlarm(game, "meridian", "bridge");
  game.personAsked = { place: "meridian", key: "Yusuf", name: "Yusuf", short: "Yusuf", id: null, room: "mess" };
  settleDeed(game, { success: true });
  game.ship.health = 10;
  toMidnight(game);
  assert.equal(card(game, "chief_of_security").duty.last, "alarms 70/100, tampering seen 100/100, thefts 75/100");
  assert.match(card(game, "chief_medical_officer").duty.last, /^medicine out 100\/100, deaths aboard \d+\/100, patients left waiting \d+\/100, people reached in time 100\/100$/);
  assert.ok(Number(card(game, "chief_medical_officer").duty.last.match(/deaths aboard (\d+)/)[1]) < 100, "people died aboard in the night");
});

test("someone new in a post starts with a clean record, and reading it changes nothing", () => {
  const game = newGame();
  toMidnight(game);
  assert.equal(card(game, "quartermaster").duty.days, 1);
  cmd.setHolder(game, "meridian", "quartermaster", "tobin");
  assert.deepEqual(card(game, "quartermaster").duty, { score: null, days: 0, measures: "sittings missed, stores run dry" });
  const before = JSON.stringify(game);
  publicState(game);
  cmd.commandView(game);
  assert.equal(JSON.stringify(game), before);
});
