// The ship's chain of command, step 5: loyalty and mutiny. Each officer's loyalty to the captain moves with the
// rations, going hungry, the mood aboard, risky jumps and the sides the captain takes; the council has a confidence of
// its own. When morale and the officers' loyalty are both low, a mutiny builds: grumbling, orders going astray, a
// delegation the player meets in a written scene, and the ship taken. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-mutiny-"));
const commandDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-mutiny-files-"));
fs.copyFileSync(new URL("../world/command/meridian.txt", import.meta.url), path.join(commandDir, "meridian.txt"));
process.env.GAME_COMMAND_DIR = commandDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const cmd = await import("../src/command.js");
const { changeStanding, clockRuns, passTime, publicState } = await import("../src/rules.js");
const { reloadCommand } = await import("../src/world.js");
const { shipCommand, chairOf } = await import("../src/ship.js");
const { writtenTurn, sceneProblems } = await import("../src/scenes.js");
const { isCaptain, jobHere } = await import("../src/role.js");
const { mealWords } = await import("../src/logistics.js");

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
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const days = (game, n) => {
  const said = [];
  for (let i = 0; i < n; i += 1) said.push(...passTime(game, 24, "routine").filter((one) => one.startsWith("[COMMAND]")));
  return said;
};
// Plays a turn of the written story and gives what it said.
const turn = (game, event, playerText = "") => {
  const out = [];
  writtenTurn({ game, event, playerText, emit: (e) => { if (e.text) out.push(e.text); }, log: () => {} });
  return out.join("\n");
};
const card = (game, id) => cmd.commandView(game).groups.flatMap((group) => group.posts).find((one) => one.id === id);
const holder = (game, id) => cmd.holderKey(game, "meridian", id);
// The test's way to a mutiny's door: morale on the floor, every officer's loyalty pulled down but those spared, and
// the pressure a day short of the delegation.
function brewing(game, { spare = [], pressure = 6 } = {}) {
  game.ship.morale = 5;
  const state = game.command.meridian;
  state.loyalty = {};
  for (const post of cmd.commandOf("meridian").posts) {
    const key = holder(game, post.id);
    if (key && key !== "you") state.loyalty[key] = spare.includes(key) ? { sides: 15 } : { rations: -20, hunger: -20, morale: -10 };
  }
  state.mutiny = { pressure, stage: 2, ringleader: null, due: null, calmUntil: 0 };
}

test("the file says when a mutiny brews, how it builds, the council's confidence to begin with, and where the brig is", () => {
  const model = cmd.commandOf("meridian");
  assert.deepEqual(model.mutiny, { morale: 30, loyalty: 35, stages: [1, 4, 7, 10], confidence: 60 });
  assert.deepEqual(model.brig, { room: "brig", roomName: "The Brig", days: 7 });
  assert.equal(model.posts.find((one) => one.brig).id, "chief_of_security");
  assert.deepEqual(cmd.commandProblems(), []);
  withFile(FILE.replace("grumbling after 1 day, orders refused after 4", "grumbling after 5 days, orders refused after 4").replace("the brig: The Brig, for 7 days", "the brig: The Dungeon, for 7 days").replace("the council's confidence: 60 to begin with", "the council's confidence: lots"), () => {
    const problems = cmd.commandProblems().join(" | ");
    assert.match(problems, /the mutiny's stages come one after another/);
    assert.match(problems, /no room called The Dungeon, for the brig/);
    assert.match(problems, /the council's confidence is a number from 0 to 100/);
  });
});

test("loyalty moves with the rations, going hungry, the mood aboard, risky jumps and the sides the captain takes", () => {
  const game = newGame();
  const marrow = cmd.loyaltyOf(game, "meridian", "marrow");
  assert.equal(marrow, 65, "Marrow's own loyalty to begin with");
  shipCommand(game, { action: "council", on: false });
  shipCommand(game, { action: "rations", id: "half" });
  days(game, 3);
  assert.ok(cmd.loyaltyOf(game, "meridian", "marrow") <= 61, `half rations for three days: ${cmd.loyaltyOf(game, "meridian", "marrow")}`);
  assert.match(card(game, "chief_engineer").loyalty.why, /down for the rations/);
  const before = cmd.loyaltyOf(game, "meridian", "marrow");
  cmd.riskyJump(game, 3);
  assert.equal(cmd.loyaltyOf(game, "meridian", "marrow"), before - 4, "a dangerous jump costs four");
  const tarrow = cmd.loyaltyOf(game, "meridian", "tarrow");
  changeStanding(game, "drift", 10, "The captain sided with the Drift");
  assert.ok(cmd.loyaltyOf(game, "meridian", "tarrow") < tarrow, "Tarrow's beliefs are against the Drift's");
  assert.match(card(game, "chief_of_security").memories.join(" | "), /saw you side with/);
});

test("going hungry pulls loyalty down, and the council's confidence follows, and is the speaker's duty", () => {
  const game = newGame();
  game.clock.hours = 9;
  clockRuns(game, 1);
  cmd.assignJob(game, "meridian", "Cook Imre", "spare");
  cmd.assignJob(game, "meridian", "Cook Dessa", "spare");
  days(game, 4);
  assert.match(card(game, "deck_chief").loyalty.why, /going hungry/);
  assert.ok(cmd.confidenceOf(game) < 50, `the council's confidence is ${cmd.confidenceOf(game)}`);
  assert.match(card(game, "speaker").duty.last, /^the council's confidence \d+\/100$/);
});

test("a ship kept hungry on half rations grumbles, lets orders go astray, and sends the captain a delegation", () => {
  const game = newGame();
  game.clock.hours = 9;
  clockRuns(game, 1);
  shipCommand(game, { action: "council", on: false });
  shipCommand(game, { action: "rations", id: "half" });
  cmd.assignJob(game, "meridian", "Cook Imre", "spare");
  cmd.assignJob(game, "meridian", "Cook Dessa", "spare");
  cmd.commandCommand(game, { action: "replace", post: "first_officer", key: "tarrow" });
  const said = [];
  let refusedCut = null;
  let refusedMove = null;
  for (let day = 0; day < 25 && !cmd.commandSceneDue(game); day += 1) {
    said.push(...days(game, 1));
    if (cmd.mutinyStage(game) === 2 && refusedCut === null) {
      shipCommand(game, { action: "rations", id: "generous" });
      assert.throws(() => shipCommand(game, { action: "rations", id: "reduced" }), (err) => { refusedCut = err.message; return true; });
      assert.throws(() => cmd.commandCommand(game, { action: "assign", key: "Petra", job: "nurse" }), (err) => { refusedMove = err.message; return true; });
      game.ship.rations = "half"; // the test puts it back by hand: the council wouldn't
    }
  }
  assert.ok(said.some((one) => /There's grumbling in the mess, about empty kettles, and about you\./.test(one)), said.join("\n"));
  assert.ok(said.some((one) => /Orders have started going astray: First Officer Tarrow is slow to move anyone on the watch bill and the council has stopped taking your word on the rations\./.test(one)), said.join("\n"));
  assert.equal(refusedCut, "The council won't put a cut through for you: they've stopped taking your word on the rations.");
  assert.equal(refusedMove, "First Officer Tarrow won't move anyone for you while the ship's like this.");
  assert.equal(cmd.commandSceneDue(game), "command_delegation");
  assert.equal(publicState(game).storyWaiting, true, "Continue the story is offered");
  assert.match(cmd.commandView(game).mood.due, /^First Officer Tarrow and some of the officers are asking to see you, together/);
  const opened = turn(game, "continue");
  assert.match(opened, /@Kara Tarrow: "Captain\. We're here about how this ship is being run/);
  assert.doesNotMatch(opened, /\{ringleader\}/);
  assert.doesNotMatch(opened, /Have the chief of security take/, "the chief of security isn't loyal enough to arrest anyone");
  assert.equal(game.scene.id, "command_delegation");
});

test("the delegation answered: giving ground calms it, and sending them away gets the ship taken and the captain locked up", () => {
  const ready = () => {
    const game = newGame();
    brewing(game);
    days(game, 1);
    assert.equal(cmd.commandSceneDue(game), "command_delegation");
    turn(game, "continue");
    return game;
  };
  const given = ready();
  given.ship.rations = "half";
  turn(given, "say", "Hear them out");
  const gave = turn(given, "say", "Give them what they want");
  assert.match(gave, /You've given the officers what they asked for: rations aboard are now standard\./);
  assert.equal(given.ship.rations, "standard");
  assert.equal(cmd.mutinyStage(given), 0);
  assert.match(card(given, "chief_engineer").memories.join(" | "), /heard out by you/);

  const refused = ready();
  const leader = refused.command.meridian.mutiny.ringleader;
  turn(refused, "say", "Tell them to get back to their posts");
  const taken = days(refused, 1);
  assert.ok(taken.some((one) => /The officers have taken the ship\. .+ has the chair now, and you're under guard in the brig\./.test(one)), taken.join("\n"));
  assert.equal(isCaptain(refused), false);
  assert.equal(refused.ship.chair.id, leader);
  assert.equal(holder(refused, "captain"), leader);
  assert.equal(cmd.jobOf(refused, "meridian", "you"), null, "the player is one of the spare hands");
  assert.equal(cmd.commandSceneDue(refused), "command_brig");
  const brig = turn(refused, "continue");
  assert.doesNotMatch(brig, /\{ringleader\}/);
  turn(refused, "say", "Wait it out");
  assert.equal(refused.scene, null);
  assert.equal(jobHere(refused)?.name, "Help wherever you're sent", "a relieved captain works shifts as crew");
  assert.match(cmd.commandView(refused).mood.deposed, /^You were relieved of command on day \d+, when .+ and the officers took the ship\.$/);
  assert.equal(chairOf(refused).name, cmd.officerName(refused, "meridian", "captain"), "whoever took the chair runs the ship");
  assert.throws(() => cmd.commandCommand(refused, { action: "hold", held: true }), /Only the captain gives orders here/);
});

test("arresting the ringleader needs the chief of security on the captain's side, and the brig keeps them a week", () => {
  const game = newGame();
  brewing(game, { spare: ["tarrow"] });
  days(game, 1);
  const leader = game.command.meridian.mutiny.ringleader;
  assert.notEqual(leader, "tarrow");
  assert.equal(cmd.mutinyHolds(game, "can arrest"), true);
  const opened = turn(game, "continue");
  assert.match(opened, /Have the chief of security take/);
  const post = cmd.postOf(game, "meridian", leader);
  const arrested = turn(game, "say", "Have the chief of security take");
  assert.match(arrested, /is in the brig, at your word/);
  assert.equal(cmd.lostReason(game, "meridian", leader), "in the brig");
  assert.notEqual(holder(game, post), leader, "their post went to someone else");
  assert.equal(cmd.movedDays(game, "meridian")[leader].job, "brig");
  assert.match(cmd.commandView(game).mood.brig.join(" "), /until day \d+/);
  days(game, 8);
  assert.equal(cmd.lostReason(game, "meridian", leader), null, "out after the file's days");
  assert.equal(cmd.jobOf(game, "meridian", leader), null, "and one of the spare hands");
});

test("stepping down hands over the chair without the brig, and winning the fight puts the ringleader there", () => {
  const ready = () => {
    const game = newGame();
    brewing(game);
    days(game, 1);
    turn(game, "continue");
    turn(game, "say", "Hear them out");
    return game;
  };
  const stepped = ready();
  const leader = stepped.command.meridian.mutiny.ringleader;
  assert.match(turn(stepped, "say", "Step down"), /You've stepped down\./);
  assert.equal(isCaptain(stepped), false);
  assert.equal(stepped.ship.chair.id, leader);
  assert.equal(cmd.commandSceneDue(stepped), null, "no brig for a captain who stepped down");

  const fought = ready();
  const ringleader = fought.command.meridian.mutiny.ringleader;
  turn(fought, "say", "Throw them out yourself");
  assert.ok(fought.combat, "the fight is on, as any fight is");
  fought.combat = null;
  fought.lastFight = { result: "victory", used: false };
  const after = turn(fought, "continue");
  assert.match(after, /You've put the delegation down\./);
  assert.equal(cmd.lostReason(fought, "meridian", ringleader), "in the brig");
  assert.equal(isCaptain(fought), true);
});

test("with another captain in the chair, whoever leads it asks the player in: joining gives them the ship", () => {
  const game = newGame("engine_hand");
  const was = chairOf(game);
  brewing(game);
  days(game, 1);
  assert.equal(cmd.commandSceneDue(game), "command_conspiracy");
  const leader = game.command.meridian.mutiny.ringleader;
  const opened = turn(game, "continue");
  assert.match(opened, new RegExp(`The officers have had enough of ${was.name}`));
  const joined = turn(game, "say", "Join them");
  assert.match(joined, new RegExp(`The officers have taken the ship from ${was.name}\\.`));
  assert.equal(game.ship.chair.id, leader);
  assert.equal(isCaptain(game), false);
  assert.match(card(game, cmd.postOf(game, "meridian", leader) ?? "captain").since ?? "", /Since|before/);
});

test("warning the captain gets the ringleader arrested while security's loyal", () => {
  const game = newGame("engine_hand");
  brewing(game, { spare: ["tarrow"] });
  days(game, 1);
  const leader = game.command.meridian.mutiny.ringleader;
  turn(game, "continue");
  const warned = turn(game, "say", "Warn");
  assert.match(warned, /heard you out, and .+ is in the brig\./);
  assert.equal(cmd.lostReason(game, "meridian", leader), "in the brig");
  assert.equal(cmd.mutinyStage(game), 0);
  assert.ok(cmd.grudgeLine(game, leader), "they know who gave them away");
});

test("a captain the officers relieved can be asked back to the chair when it's the new captain's turn", () => {
  const game = newGame();
  brewing(game);
  days(game, 1);
  turn(game, "continue");
  turn(game, "say", "Tell them to get back to their posts");
  days(game, 1);
  turn(game, "continue");
  turn(game, "say", "Wait it out");
  const usurper = game.ship.chair.id;
  assert.equal(isCaptain(game), false);
  game.location = "meridian";
  brewing(game);
  days(game, 1);
  assert.equal(cmd.commandSceneDue(game), "command_conspiracy");
  assert.equal(cmd.mutinyHolds(game, "offers the chair"), true);
  const opened = turn(game, "continue");
  assert.match(opened, /Say the word, and it's yours again/);
  const back = turn(game, "say", "Take the chair back");
  assert.match(back, /You have the chair again\./);
  assert.equal(isCaptain(game), true);
  assert.equal(cmd.lostReason(game, "meridian", usurper), "in the brig");
  assert.equal(cmd.jobOf(game, "meridian", "you"), undefined, "off the watch bill");
  assert.equal(cmd.commandView(game).mood.deposed, null);
});

test("with the player away, the captain in the chair gives ground on the rations", () => {
  const game = newGame("engine_hand");
  game.location = "haven";
  game.ship.rations = "half";
  brewing(game);
  const said = days(game, 1);
  assert.equal(cmd.commandSceneDue(game), null);
  assert.equal(game.ship.rations, "standard");
  assert.equal(cmd.mutinyStage(game), 0);
  assert.equal(said.length, 0, "the player hears nothing of it, away from the ship");
});

test("the discontented grumble in talks and at the benches, while a mutiny's brewing", () => {
  const game = newGame();
  brewing(game, { pressure: 1 });
  days(game, 1);
  assert.ok(cmd.mutinyStage(game) >= 1);
  assert.match(cmd.grudgeLine(game, "marrow") ?? "", /bowl|talking|mess|kettle/);
  assert.equal(mealWords(game, "meridian", "eating"), "eating, and grumbling about the captain");
});

test("a scene's stand-ins are filled in from the game, and one the game doesn't know is a mistake", () => {
  const scene = { title: "T", start: "a", parts: { a: { text: ["@{ringleader}: \"Hello, {captain}.\" {somebody}"], fight: { enemy: "{ringleader}" }, won: "a", lost: "a" } } };
  assert.match(sceneProblems(scene, "command_test").join(" | "), /\{somebody\} isn't a stand-in the game fills in: the stand-ins are \{ringleader\}, \{captain\}, \{first_officer\}, \{quartermaster\}/);
  const game = newGame();
  brewing(game);
  days(game, 1);
  const values = cmd.standIns(game);
  assert.equal(values.ringleader.id, game.command.meridian.mutiny.ringleader);
  assert.equal(values.captain.id, "you");
});

test("reading how things stand changes nothing, and a save from before the mutiny works", () => {
  const game = newGame();
  brewing(game);
  days(game, 1);
  const before = JSON.stringify(game);
  cmd.commandView(game);
  publicState(game);
  cmd.standIns(game);
  cmd.mutinyHolds(game, "can arrest");
  cmd.grudgeLine(game, "marrow");
  assert.equal(JSON.stringify(game), before);
  const old = newGame();
  for (const key of ["loyalty", "confidence", "mutiny", "brig", "deposed", "moodAt"]) delete old.command.meridian[key];
  days(old, 2);
  assert.equal(cmd.mutinyStage(old), 0);
  assert.ok(cmd.confidenceOf(old) > 0);
});
