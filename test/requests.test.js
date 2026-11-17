// Requests, step 1 of the organic quests: when something goes wrong aboard (the medicine cabinet nearly empty, the jump
// fuel low, the parts running out, the pantry bare), whoever it matters to has something to ask. A mark on their tag,
// the ask first in a talk, then yes, not now or no; a yes is a quest that ends done, gone or failed, each with their
// line. The kinds are scene files, world/scenes/request_<kind>.txt, read and checked like the rest. None of this calls
// an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-requests-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const rules = await import("../src/rules.js");
const lg = await import("../src/logistics.js");
const rq = await import("../src/requests.js");
const walk = await import("../src/walk.js");
const talks = await import("../src/talks.js");
const ship = await import("../src/ship.js");
const bag = await import("../src/bag.js");
const { parseSceneText, parseCondition, conditionHolds } = await import("../src/scene-text.js");
const { allSceneProblems, loadScenes } = await import("../src/scenes.js");

const newGame = (start = "captain", seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "Begun." });
  return game;
};
// The clock moves on to a time, and everything with it.
const at = (game, hours) => {
  game.clock.hours = hours;
  return rules.clockRuns(game, 1);
};
const told = (notes) => notes.filter((one) => one.startsWith("[REQUEST]"));
const medicine = (game) => lg.countAboard(game, "meridian", "medicine_crate").n;
// A trouble the game can see: the cabinet down to one crate.
const lowOnMedicine = (game) => lg.takeAboard(game, "meridian", "medicine_crate", medicine(game) - 1);
// The player goes to someone and talks; returns what they said first.
function talkTo(game, room, key) {
  walk.walkCommand(game, { action: "room", to: room });
  walk.talkCommand(game, { action: "open", person: key });
  talks.openWrittenTalk(game);
  return game.talk.lastReply;
}
function say(game, words) {
  const said = [];
  talks.writtenTalkTurn({ game, playerText: words, emit: (e) => { if (e.type !== "state") said.push(e.text); } });
  return said;
}
// The pantry emptied, and nothing else: the shuttle stores keep their crates. The quartermaster's and the cooks' errands
// fill it again within the hour in a ship that's running as it should, so the tests ask before they've had the time.
function emptyPantry(game) {
  for (const item of ["ration_crate", "produce"]) lg.takeAboard(game, "meridian", item, lg.stockOf(game, "meridian", item, "the pantry"), ["pantry"]);
}
const quest = (game) => game.quests.find((one) => one.request && one.status === "active") ?? game.quests.filter((one) => one.request).at(-1);
// Takes on the medicine request: the cabinet low, Aduro asks, the player says yes.
function takeOnMedicine(game) {
  lowOnMedicine(game);
  at(game, 10.5);
  talkTo(game, "medbay", "aduro");
  say(game, "I'll see to it");
  walk.closeTalk(game);
  return quest(game);
}

test("the request files are sound, and what they say on top is read", () => {
  const { problems } = allSceneProblems();
  assert.deepEqual(problems.filter((one) => one.startsWith("request_")), []);
  assert.deepEqual(rq.requestProblems(), []);
  const scenes = loadScenes().scenes;
  const med = rq.compileRequest("medicine", scenes.request_medicine);
  assert.deepEqual(med.problems, []);
  assert.equal(med.asker.post, "chief_medical_officer");
  assert.equal(med.asker.room, "medbay");
  assert.deepEqual({ item: med.need.item, where: med.need.where, n: med.need.n }, { item: "medicine_crate", where: "aboard", n: 2 });
  assert.equal(med.hours, 120);
  const pantry = rq.compileRequest("pantry", scenes.request_pantry);
  assert.equal(pantry.asker.job, "cook");
  assert.equal(pantry.need.where, "thing:meridian:store:pantry");
  assert.equal(rq.compileRequest("fuel", scenes.request_fuel).need.where, "tank");
});

test("the checker says what's wrong with a request, in plain words", () => {
  const { scene } = parseSceneText(`# Broken
when: stock moonbeams < 2
asks: the ship's cat
needs: medicine crates in the airlock +2
by: soon

== ask
@{asker}: "Well?"
> Fine -> later

== later
@{asker}: "Later."
`, "request_broken");
  const { problems } = rq.compileRequest("broken", scene);
  const all = problems.join(" | ");
  assert.match(all, /there's no item called moonbeams/);
  assert.match(all, /no post, job or person called the ship's cat/);
  assert.match(all, /no store called the airlock/);
  assert.match(all, /by: is how long they give you/);
  assert.match(all, /needs a part called yes/);
  assert.match(all, /needs a part called done/);
  assert.match(all, /its ask needs a choice that goes to yes/);
  // A request to bring something has to say when it's no longer needed.
  const { scene: bring } = parseSceneText(`# Short\nwhen: captain\nasks: the quartermaster\nneeds: medicine crates aboard +1\nby: 2 days\n\n== ask\n@{asker}: "Well?"\n> Yes -> yes\n\n== yes\n@{asker}: "Good."\n\n== done\n@{asker}: "Done."\n\n== failed\n@{asker}: "No."\n\n== gone\n@{asker}: "Gone."\n`, "request_short");
  assert.match(rq.compileRequest("short", bring).problems.join(" | "), /gone when: is missing/);
  // A scene that isn't a request can't have the lines on top.
  const { scene: other } = parseSceneText("# Not one\nwhen: captain\n\n== start\nHello.\nEND\n", "thread_x");
  assert.match(rq.requestProblems({ thread_x: other }).join(" "), /only a request/);
});

test("? stock counts the ship's stores, one or all, and ? fuel reads the tank", () => {
  const game = newGame();
  assert.deepEqual(parseCondition("stock medicine_crate < 2").problems, []);
  assert.deepEqual(parseCondition("stock ration_crate < 1 in the pantry").problems, []);
  assert.match(parseCondition("stock ration_crate < 1 in the attic").problems.join(" "), /no store called the attic/);
  assert.match(parseCondition("stock biscuits < 1").problems.join(" "), /no item called biscuits/);
  assert.match(parseCondition("stock medicine_crate lots").problems.join(" "), /"stock" needs/);
  assert.equal(conditionHolds(game, "stock medicine_crate = 5"), true);
  assert.equal(conditionHolds(game, "stock parts_crate = 12"), true);
  assert.equal(conditionHolds(game, "stock parts_crate = 6 in the parts lockers"), true);
  lowOnMedicine(game);
  assert.equal(conditionHolds(game, "stock medicine_crate < 2"), true);
  game.ship.fuel = 2.5;
  assert.equal(conditionHolds(game, "fuel < 3"), true);
  assert.equal(conditionHolds(game, "fuel >= 3"), false);
});

test("nobody asks while nothing's wrong; once the cabinet's nearly empty, Dr. Aduro has something to ask, once", () => {
  const game = newGame();
  assert.deepEqual(told(at(game, 9.5)), []);
  assert.equal(game.requests, undefined, "a game with nothing to ask keeps its save as it was");
  lowOnMedicine(game);
  const notes = told(at(game, 10.5));
  assert.deepEqual(notes, ["[REQUEST] Dr. Aduro has something for you to decide, in Medbay."], "an officer brings the captain a decision");
  assert.equal(game.requests.open.medicine.asker, "aduro");
  assert.deepEqual(told(at(game, 11.5)), [], "it's said once");
  walk.walkCommand(game, { action: "room", to: "medbay" });
  const people = walk.walkView(game).people;
  assert.equal(people.find((one) => one.key === "aduro").asks, true, "the mark on their tag");
  assert.equal(people.find((one) => one.key === "Nurse Haru")?.asks, undefined);
});

test("talking to them, the ask comes first; yes is a quest, and their own talk goes on", () => {
  const game = newGame();
  lowOnMedicine(game);
  at(game, 10.5);
  const first = talkTo(game, "medbay", "aduro");
  assert.match(first, /medicine cabinet's down to its last crate/);
  assert.match(first, /> I'll see to it/);
  const said = say(game, "I'll see to it");
  // What it changes first, then what they say, so their words are the newest on the pane by their head.
  assert.match(said[0], /^\[REQUEST\] Taken on: Medicine for the medbay\. Bring 2 medicine crates aboard, by day 6\./);
  assert.match(said[1], /Two crates\. Thank you/);
  assert.match(said[1], /> How are the medical stores, honestly\?/, "their own conversation's choices follow");
  assert.equal(game.talk.written.id, "talk_aduro");
  walk.closeTalk(game);
  const q = quest(game);
  assert.equal(q.title, "Medicine for the medbay");
  assert.equal(q.objective, "Bring 2 medicine crates aboard (0/2)");
  const shown = rules.publicState(game).questLog.quests.find((one) => one.id === q.id);
  assert.equal(shown.request, true);
  assert.equal(shown.step.where, "Dr. Aduro asked. By day 6.");
  assert.equal(rq.asksNow(game, "aduro"), false, "nothing more to ask");
});

test("buying two crates of medicine at a port finishes it: their line, XP and a memory", () => {
  const game = newGame();
  const q = takeOnMedicine(game);
  game.ship.at = "haven";
  game.credits = 5000;
  const xp = game.xp;
  ship.shipCommand(game, { action: "buy", id: "medicine" });
  assert.deepEqual(told(rq.advanceRequests(game)), []);
  assert.equal(q.objective, "Bring 2 medicine crates aboard (1/2)");
  ship.shipCommand(game, { action: "buy", id: "medicine" });
  const notes = rq.advanceRequests(game);
  assert.match(told(notes)[0], /^\[REQUEST\] Done: Medicine for the medbay\. Dr\. Sen Aduro: "Two crates/);
  assert.equal(game.xp, xp + 15);
  assert.equal(game.command.meridian.memory.aduro.at(-1).kind, "helped", "Dr. Aduro remembers it");
  assert.equal(q.status, "completed");
  assert.equal(q.objective, "Done: you brought 2 medicine crates aboard.");
  assert.deepEqual(game.requests.open, {});
});

test("put right some other way first: gone, with no harm done; the day passing first: failed", () => {
  const game = newGame();
  const q = takeOnMedicine(game);
  // The cabinet filled by someone else (the medbay may already have used the last crate, so it's filled right up).
  lg.putAboard(game, "meridian", "medicine_crate", 5);
  const notes = told(rq.advanceRequests(game));
  assert.match(notes[0], /^\[REQUEST\] No longer needed: Medicine for the medbay\. Dr\. Sen Aduro: "Never mind the medicine/);
  assert.equal(q.status, "completed");
  assert.match(q.objective, /^No longer needed/);

  const late = newGame("captain", 33);
  const lq = takeOnMedicine(late);
  at(late, 10.5 + 24 * 3);
  assert.equal(lq.status, "active");
  const failed = told(at(late, 10.5 + 24 * 5 + 1));
  assert.match(failed[0], /^\[REQUEST\] Failed: Medicine for the medbay\. Dr\. Sen Aduro: "There's been nothing to give/);
  assert.equal(lq.status, "failed");
  assert.equal(lq.objective, "Failed: day 6 came and went.");
});

test("not now puts it off a day; no turns it down, and it rests a week", () => {
  const game = newGame();
  lowOnMedicine(game);
  at(game, 10.5);
  talkTo(game, "medbay", "aduro");
  say(game, "Not now");
  walk.closeTalk(game);
  assert.equal(rq.asksNow(game, "aduro"), false);
  at(game, 10.5 + 12);
  assert.equal(rq.asksNow(game, "aduro"), false);
  at(game, 10.5 + 25);
  assert.equal(rq.asksNow(game, "aduro"), true, "asked again a day later");
  talkTo(game, "medbay", "aduro");
  say(game, "We'll have to manage without");
  walk.closeTalk(game);
  assert.equal(game.requests.open.medicine, undefined);
  assert.equal(game.quests.some((one) => one.request), false);
  at(game, 10.5 + 25 + 24 * 6);
  assert.equal(game.requests.open.medicine, undefined, "still resting");
  at(game, 10.5 + 25 + 24 * 8);
  assert.equal(game.requests.open.medicine?.state, "offered", "a week later it comes up again");
});

test("asked about something that's then put right, they don't ask any more", () => {
  const game = newGame();
  lowOnMedicine(game);
  at(game, 10.5);
  assert.equal(rq.asksNow(game, "aduro"), true);
  lg.putAboard(game, "meridian", "medicine_crate", 2);
  at(game, 11.5);
  assert.equal(rq.asksNow(game, "aduro"), false);
});

test("a quiet day between new asks, one thing at a time each: fuel and parts both wait on the chief engineer", () => {
  const game = newGame();
  game.ship.fuel = 2;
  lowOnMedicine(game);
  lg.takeAboard(game, "meridian", "parts_crate", 10);
  at(game, 10.5);
  assert.equal(Object.keys(game.requests.open).length, 1, "one the first day");
  at(game, 34.5);
  assert.equal(Object.keys(game.requests.open).length, 1, "a quiet day after");
  at(game, 58.5);
  assert.equal(Object.keys(game.requests.open).length, 2, "another the day after that");
  at(game, 106.5);
  at(game, 154.5);
  const open = Object.values(game.requests.open);
  assert.ok(open.length <= 3, "three at most");
  assert.equal(open.filter((one) => one.asker === "marrow").length, 1, "the chief engineer asks one thing at a time");
  assert.ok(!(game.requests.open.fuel && game.requests.open.parts), "so fuel and parts don't both wait at once");
});

test("only the captain is asked to buy for the ship; anyone aboard can be asked to carry crates to a bare pantry", () => {
  const crew = newGame("engine_hand");
  lowOnMedicine(crew);
  crew.ship.fuel = 2;
  at(crew, 10.5);
  // A nurse may ask for their medkit, but nobody asks them to buy medicine or fuel.
  assert.equal(crew.requests?.open?.medicine, undefined);
  assert.equal(crew.requests?.open?.fuel, undefined);
  delete crew.requests;
  delete crew.inventory.medkit;
  // The pantry empty, and the quartermaster and the cooks' own errands kept from filling it.
  emptyPantry(crew);
  assert.equal(lg.stockOf(crew, "meridian", "ration_crate", "the pantry"), 0);
  // The next hour, before anyone's errands have filled it again.
  crew.clock.hours = 11.5;
  const notes = told(rq.advanceRequests(crew));
  const open = crew.requests?.open?.pantry;
  assert.ok(open, `a cook asks: ${JSON.stringify(notes)}`);
  assert.match(open.asker, /^Cook /);
  assert.match(notes[0], /^\[REQUEST\] Cook \w+ has something to ask you, in the Galley\.$/);
});

test("carrying crates into the pantry by hand counts; carrying them back out takes it off", () => {
  const game = newGame("engine_hand");
  at(game, 10.5);
  emptyPantry(game);
  game.clock.hours = 11.5;
  rq.advanceRequests(game);
  const asker = game.requests.open.pantry.asker;
  assert.equal(rq.answerRequest(game, "pantry", "yes").length, 1);
  const q = quest(game);
  assert.equal(q.objective, "Bring 2 ration crates to the pantry (0/2)");
  // Down to the lighter bay: two crates out of the shuttle stores. They sit two to a square, so one square's worth
  // comes out together, and it's split in the pack to carry them in one at a time.
  walk.walkCommand(game, { action: "room", to: "lighter" });
  bag.bagCommand(game, { action: "open", key: "thing:meridian:store:shuttle_stores" });
  const crates = bag.bagView(game).open.items.find((one) => one.id === "ration_crate");
  assert.equal(crates.n, 2, "two crates to a square");
  bag.bagCommand(game, { action: "move", from: { at: "open", x: crates.x, y: crates.y }, to: { at: "pack", x: 7, y: 4 } });
  bag.bagCommand(game, { action: "close" });
  assert.equal(game.inventory.ration_crate, 2);
  bag.bagCommand(game, { action: "split", from: { at: "pack", x: 7, y: 4 } });
  const other = bag.bagView(game).pack.items.find((one) => one.id === "ration_crate" && !(one.x === 7 && one.y === 4));
  bag.bagCommand(game, { action: "move", from: { at: "pack", x: other.x, y: other.y }, to: { at: "pack", x: 6, y: 4 } });
  assert.equal(game.inventory.ration_crate, 2);
  // Up to the galley, and into the pantry.
  walk.walkCommand(game, { action: "room", to: "galley" });
  bag.bagCommand(game, { action: "open", key: "thing:meridian:store:pantry" });
  bag.bagCommand(game, { action: "move", from: { at: "pack", x: 7, y: 4 }, to: { at: "open", x: 0, y: 0 } });
  rq.advanceRequests(game);
  assert.equal(q.objective, "Bring 2 ration crates to the pantry (1/2)");
  // Taking it back out again takes it off.
  bag.bagCommand(game, { action: "move", from: { at: "open", x: 0, y: 0 }, to: { at: "pack", x: 7, y: 4 } });
  rq.advanceRequests(game);
  assert.equal(q.objective, "Bring 2 ration crates to the pantry (0/2)");
  bag.bagCommand(game, { action: "move", from: { at: "pack", x: 7, y: 4 }, to: { at: "open", x: 0, y: 0 } });
  bag.bagCommand(game, { action: "move", from: { at: "pack", x: 6, y: 4 }, to: { at: "open", x: 1, y: 0 } });
  const notes = told(rq.advanceRequests(game));
  assert.match(notes[0], new RegExp(`^\\[REQUEST\\] Done: A bare pantry\\. ${asker}: "That's the next sittings fed`));
  assert.equal(q.status, "completed");
});
