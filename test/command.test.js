// The ship's chain of command, step 1: who holds which post, who chose them and since when, read from
// world/command/meridian.txt and kept in the save, shown on the Command menu, and asked by everything that names
// someone for a post: the council's decisions, the systems' guards and engineers, the errands and the captain's chair.
// Nothing changes hands by itself yet. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-command-"));
// The checker test writes another file, so the real one is copied first and never written.
const commandDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-command-files-"));
fs.copyFileSync(new URL("../world/command/meridian.txt", import.meta.url), path.join(commandDir, "meridian.txt"));
process.env.GAME_COMMAND_DIR = commandDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const cmd = await import("../src/command.js");
const { countAboard, errandDetour, errandsView, fillStores, logisticsOf, putAboard, takeAboard } = await import("../src/logistics.js");
const { migrateGame } = await import("../src/migrate.js");
const { passTime, publicState } = await import("../src/rules.js");
const { changeCommand, chairOf, shipLedger } = await import("../src/ship.js");
const sys = await import("../src/systems.js");
const bag = await import("../src/bag.js");
const { reloadCommand } = await import("../src/world.js");
const { parseCommandText, readHolderLine, readJobLine, readPostLine, writeCommandText } = await import("../public/command-text.js");

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
const card = (game, id) => cmd.commandView(game).groups.flatMap((group) => group.posts).find((one) => one.id === id);

test("a post's, a job's and a holder's lines are read into their pieces, the file writes back the same, and a bad line says what's wrong", () => {
  assert.deepEqual(readPostLine("quartermaster in The Long Mess: chosen by the captain; heads cooks, mess hands, gardeners; skills commerce; duty: sittings missed, stores run dry"),
    { title: "quartermaster", prep: "in", room: "The Long Mess", chosenBy: "captain", watchBill: false, brig: false, heads: ["cooks", "mess hands", "gardeners"], pool: [], skills: ["commerce"], duty: ["sittings missed", "stores run dry"] });
  assert.equal(readPostLine("first officer on The Bridge: chosen by the captain; keeps the watch bill").watchBill, true);
  assert.deepEqual(readPostLine("deck chief in Engineering: chosen by the captain; picked from deckhands, the comms officer").pool, ["deckhands", "the comms officer"]);
  assert.deepEqual(readJobLine("cook in The Galley: 2 wanted; skills survival"), { title: "cook", prep: "in", room: "The Galley", wanted: 2, skills: ["survival"] });
  assert.deepEqual(readHolderLine("quartermaster: odessa"), { post: "quartermaster", holder: "odessa" });
  assert.deepEqual(readHolderLine("the captain: the chair"), { post: "captain", holder: "the chair" });
  assert.match(readPostLine("quartermaster chosen by the captain").problem, /needs a colon/);
  assert.match(readPostLine("quartermaster: chosen by the captain").problem, /needs the room/);
  assert.match(readPostLine("quartermaster in The Long Mess: skills commerce").problem, /who chooses/);
  assert.match(readPostLine("quartermaster in The Long Mess: chosen by the captain; sings badly").problem, /isn't something a post's line says/);
  assert.match(readJobLine("cook in The Galley: skills survival").problem, /how many it wants/);
  assert.match(readHolderLine("quartermaster odessa").problem, /needs a colon/);
  const { value, problems } = parseCommandText(FILE, "meridian");
  assert.deepEqual(problems, []);
  assert.equal(value.posts.length, 11);
  assert.equal(value.numbers.reviews, "7 days", "the numbers at the top are kept for the later steps");
  assert.equal(writeCommandText(value), FILE);
});

test("the Meridian's chain of command knows its posts, rooms, jobs and holders, and the checker catches a bad one", () => {
  const model = cmd.commandOf("meridian");
  assert.deepEqual(model.problems, []);
  assert.deepEqual(model.posts.map((one) => one.id), ["captain", "first_officer", "quartermaster", "chief_engineer", "chief_of_security", "chief_medical_officer", "deck_chief", "comms_officer", "helm_officer", "sensor_officer", "speaker"]);
  assert.deepEqual(model.posts.map((one) => one.room), ["bridge", "bridge", "mess", "engineering", "aft", "medbay", "engineering", "bridge", "bridge", "bridge", "mess"], "each post is kept where its holder's day has them at work");
  const post = (id) => model.posts.find((one) => one.id === id);
  assert.deepEqual(post("captain").chooser, { body: "council" });
  assert.deepEqual(post("quartermaster").chooser, { post: "captain" });
  assert.deepEqual(post("comms_officer").chooser, { post: "first_officer" });
  assert.deepEqual(post("speaker").chooser, { body: "civilians" });
  assert.deepEqual(post("quartermaster").heads, ["cook", "mess_hand", "gardener"]);
  assert.equal(model.jobs.length, 8);
  assert.equal(model.chairPost, "captain");
  assert.deepEqual(model.start.quartermaster, { key: "odessa" });
  assert.deepEqual(model.start.captain, { chair: true });
  assert.deepEqual(cmd.commandProblems(), []);
  const bad = FILE
    .replace("- quartermaster in The Long Mess:", "- quartermaster in The Pub:")
    .replace("- deck chief in Engineering: chosen by the captain; heads deckhands;", "- deck chief in Engineering: chosen by the bosun; heads dockers;")
    .replace("skills hacking, science", "skills hacking, juggling")
    .replace("- comms officer: iven", "- comms officer: Mott Jessup")
    .replace("- helm officer: pell", "- helm officer: voss")
    .replace("- speaker: halm", "- speaker: halm\n- speaker: lira\n- quarterback: odessa");
  withFile(bad, () => {
    const problems = cmd.commandProblems().join(" | ");
    for (const want of [/line 17.*no room called The Pub/, /deck chief is chosen by bosun, which isn't another post/, /no job called dockers under Jobs/, /no skill called juggling/, /nobody called Mott Jessup has a day at CFS Meridian/, /voss already holds the first officer: one post each/, /the speaker is given twice/, /no post called quarterback/, /nobody holds the comms officer/]) {
      assert.match(problems, want);
    }
  });
  withFile(FILE.replace("- first officer on The Bridge: chosen by the captain;", "- first officer on The Bridge: chosen by the helm officer;"), () => {
    assert.match(cmd.commandProblems().join(" | "), /choosing goes round in a circle/);
  });
});

test("a new game keeps who holds what, with the player or the chair's captain in the captain's post, and an old save gets the same", () => {
  const game = newGame();
  assert.equal(game.version, 24);
  assert.deepEqual(game.command.meridian.holders.captain, { key: "you", since: null, by: null });
  assert.deepEqual(game.command.meridian.holders.quartermaster, { key: "odessa", since: null, by: null });
  assert.equal(Object.keys(game.command.meridian.holders).length, 11);
  const docker = newGame("docker");
  const chair = chairOf(docker);
  assert.ok(chair, "someone else has the chair");
  assert.equal(docker.command.meridian.holders.captain.key, chair.id);
  assert.equal(cmd.holderKey(docker, "meridian", "captain"), chair.id);
  // A save from before the chain of command: everyone in the post they hold now.
  const { command: _gone, ...old } = JSON.parse(JSON.stringify(docker));
  const migrated = migrateGame({ ...old, version: 17 });
  assert.equal(migrated.version, 24);
  assert.deepEqual(migrated.command, docker.command);
});

test("the Command menu shows every post as a card, grouped by who chooses them, and reading it changes nothing", () => {
  const game = newGame();
  const view = publicState(game).command;
  assert.deepEqual(view.groups.map((one) => [one.title, one.posts.length]), [["Chosen by the council", 1], ["Chosen by the captain", 6], ["Chosen by the first officer", 3], ["Chosen by the civilians", 1]]);
  const captain = card(game, "captain");
  assert.equal(captain.holder.name, `You, ${game.name}`);
  assert.equal(captain.holder.you, true);
  assert.equal(captain.holder.sheet, false, "your own card doesn't open someone else's printout");
  const quartermaster = card(game, "quartermaster");
  assert.deepEqual(
    [quartermaster.title, quartermaster.holder.name, quartermaster.station, quartermaster.chosenBy, quartermaster.chooser, quartermaster.skills, quartermaster.heads, quartermaster.since, quartermaster.holder.sheet],
    ["Quartermaster", "Odessa Brandt", "The Long Mess", "the captain", "you", "commerce 7", "cooks, mess hands and gardeners", "Since before the game began", true]);
  const comms = card(game, "comms_officer");
  assert.deepEqual([comms.chosenBy, comms.chooser, comms.skills], ["the first officer", "Ilya Voss", "hacking 5, science 5"]);
  assert.equal(card(game, "first_officer").watchBill, true);
  assert.equal(card(game, "speaker").chosenBy, "the civilians");
  const before = JSON.stringify(game);
  publicState(game);
  cmd.commandView(game);
  assert.equal(JSON.stringify(game), before);
  // Someone else in the chair shows on the captain's card, and on the cards of those the captain chooses.
  const docker = newGame("docker");
  assert.equal(card(docker, "captain").holder.key, chairOf(docker).id);
  assert.ok(card(docker, "captain").holder.name.length > 3);
  assert.equal(card(docker, "quartermaster").chooser, card(docker, "captain").holder.name);
  assert.equal(card(docker, "captain").holder.sheet, true);
});

test("the council's decisions name whoever holds the post, and the council acts itself when nobody can", () => {
  const game = newGame();
  assert.equal(cmd.postAndName(game, "meridian", "quartermaster"), "Quartermaster Brandt");
  assert.equal(cmd.postAndName(game, "meridian", "speaker"), "Speaker Halm");
  cmd.setHolder(game, "meridian", "quartermaster", "tobin");
  assert.equal(cmd.postAndName(game, "meridian", "quartermaster"), "Quartermaster Hask");
  assert.match(card(game, "quartermaster").since, /^Since day 1$/);
  // Six days of food and nothing coming aboard: the quartermaster cuts the rations, and it's Hask who does.
  const model = logisticsOf("meridian");
  const garden = model.machines.find((one) => one.id === "garden");
  const refills = model.refills;
  garden.runs = false;
  model.refills = [];
  try {
    fillStores(game, "meridian");
    game.ship.fuel = game.ship.maxFuel;
    game.ship.rations = "standard";
    // Six days of food each morning, and nothing else coming aboard.
    const food = ["ration_crate", "produce"];
    const sixDays = () => {
      for (const item of food) putAboard(game, "meridian", item, 999);
      let over = countAboard(game, "meridian", food).n - shipLedger(game).used.food * 6;
      for (const item of food) {
        if (over < 1) break;
        over -= takeAboard(game, "meridian", item, Math.floor(over));
      }
    };
    const notes = [];
    for (let day = 0; day < 6 && !notes.some((line) => line.startsWith("[COUNCIL]")); day += 1) {
      sixDays();
      notes.push(...passTime(game, 24, "routine"));
    }
    const line = notes.find((one) => one.startsWith("[COUNCIL]"));
    assert.ok(line, notes.join(" | "));
    assert.match(line, /^\[COUNCIL\] Quartermaster Hask has checked the food count twice/);
    // With nobody in the post, the council does it.
    const empty = newGame();
    cmd.setHolder(empty, "meridian", "quartermaster", null);
    assert.equal(cmd.holderKey(empty, "meridian", "quartermaster"), null);
    assert.equal(card(empty, "quartermaster").holder, null);
  } finally {
    garden.runs = true;
    model.refills = refills;
  }
});

test("the guards and engineers the systems file names by post are whoever holds it", () => {
  const model = sys.systemsOf("meridian");
  assert.deepEqual(model.guards, ["post:chief_of_security", "job:guard"]);
  assert.deepEqual(model.engineers, ["post:chief_engineer", "job:tech"]);
  const game = newGame();
  assert.deepEqual(sys.staffOf(game, "meridian", model.engineers), ["marrow", "Tech Sami", "Tech Oona", "Tech Goran"]);
  assert.deepEqual(sys.staffOf(game, "meridian", model.guards), ["tarrow"]);
  // Hask as chief engineer: he's the one who goes to the vent, and the one who's said to have fixed it.
  cmd.setHolder(game, "meridian", "chief_engineer", "tobin");
  const vent = Object.values(model.parts).find((one) => one.name === "vent" && one.room === "mess");
  sys.damagePart(game, "meridian", vent.id, "sealed", { by: "story" });
  game.systems.meridian.parts[vent.id].fixAt = game.clock.hours + 0.5;
  assert.deepEqual(sys.detourFor(game, "meridian")("tobin", "engineering", false), { where: "@mess", doing: "fixing the vent" });
  assert.equal(sys.detourFor(game, "meridian")("marrow", "engineering", false), null, "Marrow isn't the chief engineer any more");
  game.location = "meridian";
  const notes = passTime(game, 0.6);
  assert.ok(notes.some((line) => /\[SYSTEMS\] Hask has fixed the vent in The Long Mess/.test(line)), notes.join(" | "));
  cmd.setHolder(game, "meridian", "chief_of_security", null);
  assert.deepEqual(sys.staffOf(game, "meridian", model.guards), [], "nobody in the post means no guards");
});

test("the quartermaster's errand is carried by whoever holds the post", () => {
  const errand = logisticsOf("meridian").errands.find((one) => one.post === "quartermaster");
  assert.deepEqual([errand.id, errand.key, errand.item, errand.from, errand.to], ["quartermaster:ration_crate", null, "ration_crate", "shuttle_stores", "pantry"]);
  const game = newGame();
  const shown = () => errandsView(game, "meridian").find((one) => one.id === "quartermaster:ration_crate");
  assert.equal(shown().who, "Quartermaster Brandt");
  cmd.setHolder(game, "meridian", "quartermaster", "tobin");
  assert.equal(shown().who, "Quartermaster Hask");
  const pantry = logisticsOf("meridian").stores.find((one) => one.id === "pantry");
  game.clock.hours = 9;
  passTime(game, 0.1);
  bag.storeTake(game, pantry.key, pantry.holds, "ration_crate", 12);
  passTime(game, 0.2);
  assert.ok(game.logistics.meridian.errands["quartermaster:ration_crate"], "the errand's begun");
  assert.ok(errandDetour(game, "meridian")("tobin"), "and it's Hask who goes");
  assert.equal(errandDetour(game, "meridian")("odessa"), null, "not Brandt");
  // With nobody in the post, nobody goes.
  const empty = newGame();
  cmd.setHolder(empty, "meridian", "quartermaster", null);
  empty.clock.hours = 9;
  passTime(empty, 0.1);
  bag.storeTake(empty, pantry.key, pantry.holds, "ration_crate", 12);
  passTime(empty, 0.5);
  assert.equal(empty.logistics.meridian.errands?.["quartermaster:ration_crate"], undefined);
  assert.match(errandsView(empty, "meridian").find((one) => one.id === "quartermaster:ration_crate").who, /^Nobody/);
});

test("the story giving command away or taking it moves the captain's post, and the chair asks the post", () => {
  const game = newGame();
  game.clock.hours = 24 * 3 + 9;
  const lost = changeCommand(game, { takes: false, reason: "a test" });
  assert.match(lost.notice, /has command of the Meridian now/);
  const chair = chairOf(game);
  assert.equal(game.command.meridian.holders.captain.key, chair.id);
  assert.equal(game.command.meridian.holders.captain.since, 4);
  assert.equal(cmd.holderKey(game, "meridian", "captain"), chair.id);
  assert.equal(card(game, "captain").since, "Since day 4");
  assert.equal(card(game, "quartermaster").chooser, card(game, "captain").holder.name);
  changeCommand(game, { takes: true, reason: "a test" });
  assert.equal(game.command.meridian.holders.captain.key, "you");
  assert.equal(card(game, "captain").holder.you, true);
});
