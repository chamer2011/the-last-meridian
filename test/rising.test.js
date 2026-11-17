// The ship's chain of command, step 4: rising and falling. A holder with a bad stretch is warned, then relieved at the
// next review and replaced by whoever chooses for the post, from those it's picked from by skill, ambition, loyalty
// and how they get on; for the player as captain, it comes as the first officer's recommendation. People remember
// being relieved, passed over or promoted, and say so when they're talked to; the ambitious ask for their boss's post,
// and a refusal can make a rival who works against them. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-rising-"));
const commandDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-rising-files-"));
fs.copyFileSync(new URL("../world/command/meridian.txt", import.meta.url), path.join(commandDir, "meridian.txt"));
process.env.GAME_COMMAND_DIR = commandDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const cmd = await import("../src/command.js");
const { clockRuns, passTime, publicState } = await import("../src/rules.js");
const { reloadCommand, WORLD_CHARACTERS } = await import("../src/world.js");
const { openWrittenTalk } = await import("../src/talks.js");
const { whoIsIn } = await import("../src/life.js");
const { mapFor, roomsOf } = await import("../src/walk.js");
const { chairOf } = await import("../src/ship.js");

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
const newGame = (start = "captain", seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = start;
  return createGameFromDraft(draft);
};
// The cooks taken off the galley after breakfast on the first day, so that the kettle runs dry from then on.
function starve(game) {
  game.clock.hours = 9;
  clockRuns(game, 1);
  cmd.assignJob(game, "meridian", "Cook Imre", "spare");
  cmd.assignJob(game, "meridian", "Cook Dessa", "spare");
  return game;
}
// Days go by, one at a time, and what the chain of command said on the way.
function days(game, n) {
  const said = [];
  for (let i = 0; i < n; i += 1) said.push(...passTime(game, 24, "routine").filter((one) => one.startsWith("[COMMAND]")));
  return said;
}
const card = (game, id) => cmd.commandView(game).groups.flatMap((group) => group.posts).find((one) => one.id === id);
const holder = (game, id) => cmd.holderKey(game, "meridian", id);

test("the file says how often the reviews are, what a bad stretch is, and who each post is picked from", () => {
  const model = cmd.commandOf("meridian");
  assert.deepEqual(model.reviews, { every: 7, under: 60, days: 5, stands: 10, fade: 30 });
  assert.deepEqual(model.crew, { ambition: 2, temper: 2, loyalty: 60 });
  const post = (id) => model.posts.find((one) => one.id === id);
  assert.deepEqual(post("quartermaster").pool, { jobs: ["cook", "mess_hand", "gardener"], posts: ["deck_chief"] });
  assert.deepEqual(post("first_officer").pool, { jobs: [], posts: ["chief_of_security", "deck_chief", "comms_officer", "helm_officer", "sensor_officer"] });
  assert.deepEqual(post("chief_medical_officer").pool, { jobs: ["nurse"], posts: [] });
  assert.deepEqual(cmd.commandProblems(), []);
  withFile(FILE.replace("picked from nurses;", "picked from surgeons;").replace("everyone else: ambition 2", "everyone else: ambition 9").replace("a bad stretch: duty under 60 for 5 days", "a bad stretch: now and then"), () => {
    const problems = cmd.commandProblems().join(" | ");
    assert.match(problems, /there's no job or post called surgeons, for the chief medical officer to be picked from/);
    assert.match(problems, /everyone else's ambition goes from 1 to 5, not 9/);
    assert.match(problems, /a bad stretch is written like duty under 40 for 5 days, not "now and then"/);
  });
});

test("the officers' files have their ambition, temper and loyalty, and everyone else has the command file's", () => {
  assert.deepEqual(cmd.natureOf("meridian", "tarrow"), { ambition: 4, temper: 4, loyalty: 45 });
  assert.deepEqual(cmd.natureOf("meridian", "voss"), { ambition: 1, temper: 3, loyalty: 85 });
  assert.equal(WORLD_CHARACTERS.halm.ambition, 5);
  assert.deepEqual(cmd.natureOf("meridian", "Cook Imre"), { ambition: 2, temper: 2, loyalty: 60 });
  withFile(FILE.replace("everyone else: ambition 2, temper 2, loyalty 60", "everyone else: ambition 5, temper 1, loyalty 20"), () => {
    assert.deepEqual(cmd.natureOf("meridian", "Cook Imre"), { ambition: 5, temper: 1, loyalty: 20 });
    assert.deepEqual(cmd.natureOf("meridian", "tarrow"), { ambition: 4, temper: 4, loyalty: 45 }, "a file's own numbers come first");
  });
});

test("an empty kettle for a week: the first officer warns the quartermaster, recommends relieving her, and acts on it if the captain doesn't answer", () => {
  const game = starve(newGame());
  const warned = days(game, 7);
  assert.ok(warned.some((one) => /Commander Voss has had a word with Quartermaster Brandt in your name, about five days of empty kettles\./.test(one)), warned.join("\n"));
  assert.equal(holder(game, "quartermaster"), "odessa");
  days(game, 1);
  const view = cmd.commandView(game);
  assert.equal(view.waiting.length, 1);
  assert.equal(view.waiting[0].text, "Commander Voss recommends relieving Quartermaster Brandt after six days of empty kettles, and giving the post to Gardener Benno.");
  assert.deepEqual([view.waiting[0].holder, view.waiting[0].candidate, view.waiting[0].by], ["Brandt", "Benno", "Voss"]);
  assert.equal(holder(game, "quartermaster"), "odessa", "nothing's done until the captain answers");
  const later = days(game, 7);
  assert.equal(holder(game, "quartermaster"), "Gardener Benno");
  assert.ok(later.some((one) => one.includes("Commander Voss has relieved Quartermaster Brandt after six days of empty kettles, in your name, since you hadn't answered, and given the post to Gardener Benno. Brandt is a gardener now, and takes it quietly.")), later.join("\n"));
  assert.equal(cmd.jobOf(game, "meridian", "odessa"), "gardener", "Brandt takes the job Benno left");
  assert.equal(cmd.jobOf(game, "meridian", "Gardener Benno"), undefined, "and Benno's off the watch bill");
  assert.deepEqual(cmd.commandView(game).waiting, []);
});

test("as crew, the captain in the chair relieves the quartermaster at the review, without asking anyone", () => {
  const game = starve(newGame("engine_hand"));
  const said = days(game, 8);
  const captain = chairOf(game).name;
  assert.ok(said.some((one) => one.includes(`${captain} has warned Quartermaster Brandt about five days of empty kettles.`)), said.join("\n"));
  assert.ok(said.some((one) => one.includes(`${captain} has relieved Quartermaster Brandt after six days of empty kettles, and given the post to Gardener Benno.`)), said.join("\n"));
  assert.equal(holder(game, "quartermaster"), "Gardener Benno");
  assert.deepEqual(cmd.commandView(game).waiting, [], "nothing waits on the player, who isn't the captain");
  assert.throws(() => cmd.commandCommand(game, { action: "replace", post: "quartermaster", key: "odessa" }), /Only the captain gives orders here\. Commander Voss keeps the watch bill\./);
});

test("the captain answers the first officer: do it, keep her on, or leave it to Voss", () => {
  const ready = () => {
    const game = starve(newGame());
    days(game, 8);
    return game;
  };
  const done = ready();
  const { message } = cmd.commandCommand(done, { action: "answer", post: "quartermaster", answer: "accept" });
  assert.equal(message, "You've relieved Quartermaster Brandt after six days of empty kettles, and given the post to Gardener Benno. Brandt is a gardener now, and takes it quietly.");
  assert.equal(holder(done, "quartermaster"), "Gardener Benno");
  assert.equal(card(done, "quartermaster").since, "Since day 9, chosen by you");

  const kept = ready();
  const keep = cmd.commandCommand(kept, { action: "answer", post: "quartermaster", answer: "keep" });
  assert.equal(keep.message, "You've kept Quartermaster Brandt on as quartermaster, against Commander Voss's advice. Your choice stands for 10 days.");
  days(kept, 7);
  assert.equal(holder(kept, "quartermaster"), "odessa", "the captain's choice stands at the next review");
  assert.match(card(kept, "quartermaster").memories.join(" | "), /Day 9: kept on as quartermaster by you, against advice/);

  const left = ready();
  const leave = cmd.commandCommand(left, { action: "answer", post: "quartermaster", answer: "leave" });
  assert.match(leave.message, /^Commander Voss has relieved Quartermaster Brandt after six days of empty kettles, and given the post to Gardener Benno\./);
  assert.equal(holder(left, "quartermaster"), "Gardener Benno");
  assert.throws(() => cmd.commandCommand(left, { action: "answer", post: "quartermaster", answer: "accept" }), /There's nothing waiting on that post/);
});

test("the new quartermaster lives the post's day at its place, and Brandt lives a gardener's", () => {
  const game = newGame();
  const rooms = roomsOf(mapFor("meridian"));
  const at = (hours, name) => rooms.find((room) => whoIsIn(game, "meridian", room.id, hours).includes(name))?.id ?? null;
  const counting = 24 + 5.5;
  const post = at(counting, "odessa");
  assert.ok(post, "Brandt is counting the ration crates somewhere at half past five");
  cmd.commandCommand(game, { action: "replace", post: "quartermaster", key: "Gardener Benno" });
  assert.equal(at(counting, "Gardener Benno"), post, "Benno counts the crates where Brandt did");
  assert.notEqual(at(counting, "odessa"), post);
  const moved = cmd.movedDays(game, "meridian");
  assert.equal(moved["Gardener Benno"].job, "post:quartermaster");
  assert.equal(moved["Gardener Benno"].home, "odessa");
  assert.equal(moved.odessa.job, "gardener");
});

test("the ship's own lines name whoever holds the post", () => {
  const game = newGame();
  const names = cmd.officerNames(game, "meridian");
  assert.equal(names.quartermaster, "Quartermaster Brandt");
  assert.equal(names.chief_engineer, "Chief Engineer Marrow");
  assert.equal(names.chief_medical_officer, "Dr. Aduro");
  cmd.commandCommand(game, { action: "replace", post: "quartermaster", key: "Gardener Benno" });
  assert.equal(cmd.officerNames(game, "meridian").quartermaster, "Quartermaster Benno");
  const ship = JSON.parse(fs.readFileSync(new URL("../world/ship.json", import.meta.url), "utf8"));
  assert.match(ship.text.foodLow, /\{quartermaster\}/);
  assert.doesNotMatch(JSON.stringify(ship.text), /Brandt|Marrow|Aduro/);
});

test("the captain relieves someone themselves: the choice stands, and they bring it up when they're talked to", () => {
  const game = newGame();
  const { message, notes } = cmd.commandCommand(game, { action: "replace", post: "chief_engineer", key: "Tech Sami" });
  assert.equal(message, "You've relieved Chief Engineer Marrow, and given the post to Tech Sami. Marrow is a tech now, and has said what they think of it, loudly, all over engineering.");
  assert.deepEqual(notes, [`[COMMAND] ${message}`]);
  assert.equal(holder(game, "chief_engineer"), "Tech Sami");
  assert.equal(cmd.jobOf(game, "meridian", "marrow"), "tech");
  assert.equal(cmd.loyaltyOf(game, "meridian", "marrow"), 35, "65 to begin with, and 30 off for being relieved by the captain");
  assert.equal(card(game, "chief_engineer").since, "Since day 1, chosen by you");
  game.talk = { id: 1, key: "marrow", personId: "marrow", name: WORLD_CHARACTERS.marrow.name, short: "Marrow", where: "Engineering", doing: null, log: [], lastReply: null, said: 0, told: [], unheard: [] };
  openWrittenTalk(game);
  const first = game.talk.log[0].text;
  assert.ok(first.startsWith(`@${WORLD_CHARACTERS.marrow.name}: "`), first);
  assert.match(first, /You took the chief engineer's post off me and gave it to Chief Engineer Sami|Come to see how Chief Engineer Sami is managing my work|I did that job for years/);
  game.talk = null;
  // A month on (with the reviews held, so that nothing else happens to Marrow), it isn't the first thing they say.
  // The generator's cell lasts the month: left without power the ship loses her air, and everyone aboard with it.
  game.logistics.meridian.machines.generator = { progress: 0, made: 0, waiting: null, burning: 1e9 };
  cmd.commandCommand(game, { action: "hold", held: true });
  passTime(game, 24 * 31, "routine");
  assert.equal(cmd.grudgeLine(game, "marrow"), null);
});

test("while the captain holds the reviews, nobody's warned or relieved", () => {
  const game = starve(newGame());
  assert.match(cmd.commandCommand(game, { action: "hold", held: true }).message, /^The reviews are held/);
  assert.equal(cmd.commandView(game).reviews.held, true);
  assert.deepEqual(days(game, 15), []);
  assert.equal(holder(game, "quartermaster"), "odessa");
  cmd.commandCommand(game, { action: "hold", held: false });
  assert.equal(cmd.commandView(game).reviews.held, false);
  assert.ok(days(game, 1).some((one) => one.includes("had a word with Quartermaster Brandt")));
});

test("an ambitious nurse asks for a weak chief medical officer's post; the captain in the chair gives it, and a refused one works against their boss", () => {
  withFile(FILE.replace("everyone else: ambition 2, temper 2, loyalty 60", "everyone else: ambition 5, temper 5, loyalty 60"), () => {
    // Deckhand Kofi, whose medicine is a 2, put in as the chief medical officer.
    const weak = (game) => {
      const { Kofi: _gone, ...jobs } = game.command.meridian.jobs;
      delete jobs["Deckhand Kofi"];
      game.command.meridian.jobs = jobs;
      cmd.setHolder(game, "meridian", "chief_medical_officer", "Deckhand Kofi");
      return game;
    };
    const crew = weak(newGame("engine_hand"));
    const said = days(crew, 7);
    const captain = chairOf(crew).name;
    assert.ok(said.some((one) => one.includes(`Nurse Anton has asked ${captain} to be made chief medical officer in place of Chief Medical Officer Kofi.`)), said.join("\n"));
    assert.ok(said.some((one) => one.includes(`${captain} has relieved Chief Medical Officer Kofi at Anton's asking, and given the post to Nurse Anton.`)), said.join("\n"));
    assert.equal(holder(crew, "chief_medical_officer"), "Nurse Anton");

    const mine = weak(newGame());
    days(mine, 7);
    const waiting = cmd.commandView(mine).waiting[0];
    assert.equal(waiting.text, "Nurse Anton asks to be made chief medical officer in place of Chief Medical Officer Kofi: their medicine is 5 to Kofi's 2.");
    const { message } = cmd.commandCommand(mine, { action: "answer", post: "chief_medical_officer", answer: "keep" });
    assert.equal(message, "You've told Nurse Anton no: Chief Medical Officer Kofi stays chief medical officer. Anton hasn't taken it well, and has started working against Kofi.");
    assert.equal(card(mine, "chief_medical_officer").rival, "Nurse Anton");
    days(mine, 1);
    assert.match(card(mine, "chief_medical_officer").duty.last, /10 off for Nurse Anton working against them$/);
    assert.equal(cmd.grudgeLine(mine, "Nurse Anton").includes("Captain"), true, "Anton brings up being told no");
  });
});

test("reading the Command menu changes nothing, and a save from before the reviews works", () => {
  const game = starve(newGame());
  days(game, 8);
  const before = JSON.stringify(game);
  cmd.commandView(game);
  publicState(game);
  cmd.grudgeLine(game, "odessa");
  assert.equal(JSON.stringify(game), before);
  const old = starve(newGame());
  for (const key of ["memory", "pending", "rivals", "held", "reviewAt"]) delete old.command.meridian[key];
  days(old, 8);
  assert.equal(cmd.commandView(old).waiting.length, 1);
});
