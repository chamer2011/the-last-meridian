// Requests, step 5 of the organic quests: the player's life decides who asks and how. A kind's for: line says which
// lives it's for (the captain, crew, outsiders, anyone aboard, anyone, or a life by name); the captain's officers bring
// them things to decide; crew get orders (as: an order) from the officer over their job, which cost more to refuse; and
// a life that began somewhere else is asked by the people there, their boss or someone with a name. The pacer keeps a
// quiet day between new asks, asks nothing in the middle of a written scene, and doesn't ask the same kind twice running.
// None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-requests-lives-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const rules = await import("../src/rules.js");
const rq = await import("../src/requests.js");
const walk = await import("../src/walk.js");
const talks = await import("../src/talks.js");
const cmd = await import("../src/command.js");
const lg = await import("../src/logistics.js");
const { questsView } = await import("../src/quests.js");
const { readRecord } = await import("../src/record.js");
const { conditionHolds, parseCondition, parseSceneText } = await import("../src/scene-text.js");

const SHIP = "meridian";
const KINDS = ["medicine", "fuel", "parts", "pantry", "broken", "medkit", "rival", "post_back", "brig", "grumbling", "carry", "extra_shift", "repair_order", "hand_on_job", "word_for_boss"];
const newGame = (start = "captain", seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "Begun." });
  return game;
};
const at = (game, hours) => {
  game.clock.hours = hours;
  return rules.clockRuns(game, 1);
};
const told = (notes) => notes.filter((one) => one.startsWith("[REQUEST]"));
// Only these kinds can be asked: the others rest.
function only(game, ...kinds) {
  game.requests = { open: {}, rest: Object.fromEntries(KINDS.filter((one) => !kinds.includes(one)).map((one) => [one, 1e9])), asked: {}, n: 0 };
}
function talkTo(game, key, words = null) {
  walk.bringOver(game, [key]);
  walk.talkCommand(game, { action: "open", person: key });
  talks.openWrittenTalk(game);
  const first = game.talk.lastReply;
  if (words) talks.writtenTalkTurn({ game, playerText: words, emit: () => {} });
  walk.closeTalk(game);
  return first;
}
const memoryOf = (game, key) => game.command[SHIP].memory?.[key]?.at(-1) ?? null;
const shortTech = (game) => {
  // Two techs in the brig leave the engine hand's job short of hands: it wants three, and has the engine hand and one.
  const techs = cmd.onJob(game, SHIP, "tech").filter((key) => key !== "you");
  game.command[SHIP].brig = Object.fromEntries(techs.slice(0, 2).map((key) => [key, { until: 99, by: "you" }]));
  return techs.slice(0, 2);
};

test("for: lines, as: an order, and the new words are checked", () => {
  const scene = (top) => parseSceneText(`# T\n${top}\n\n== ask\n@{asker}: "?"\n> Yes -> yes\n> No -> no\n\n== yes\n@{asker}: "Y."\n\n== no\n@{asker}: "N."\n\n== done\n@{asker}: "D."\n\n== failed\n@{asker}: "F."\n\n== gone\n@{asker}: "G."\n`, "request_t").scene;
  const problemsOf = (top) => rq.compileRequest("t", scene(top)).problems.join(" | ");
  assert.equal(problemsOf("for: crew\nas: an order\nasks: your officer\nneeds: work a shift\nby: 1 day"), "");
  assert.equal(problemsOf("for: outsiders\nasks: your boss\nneeds: work two shifts\nby: 3 days"), "");
  assert.equal(problemsOf("for: dock hand, runner\nasks: someone here\nneeds: talk to your boss\nby: 2 days"), "");
  assert.equal(problemsOf("for: the captain, engine hand\nasks: the chief engineer\nneeds: talk to the quartermaster\nby: 2 days"), "", "when: is optional now");
  assert.match(problemsOf("for: sailors\nasks: a cook\nneeds: your word\nby: 1 day"), /for: is the captain, crew, outsiders/);
  assert.match(problemsOf("for: the captain\nas: an order\nasks: the first officer\nneeds: your word\nby: 1 day"), /the captain takes no orders/);
  assert.match(problemsOf("for: outsiders\nasks: your officer\nneeds: your word\nby: 1 day"), /your officer is for crew aboard the Meridian/);
  assert.match(problemsOf("for: the captain\nasks: your boss\nneeds: your word\nby: 1 day"), /your boss and \{boss\} are only for lives that have one/);
  assert.match(problemsOf("for: anyone aboard\nasks: a cook\nneeds: work a shift\nby: 1 day"), /the captain has no shifts to work/);
  assert.match(problemsOf("for: crew\nas: a command\nasks: your officer\nneeds: your word\nby: 1 day"), /as: is an order, or a request/);
  for (const text of ["short any", "short your job", "short cook"]) assert.deepEqual(parseCondition(text).problems, [], text);
  assert.match(parseCondition("short spare").problems.join(" "), /"short" is followed by any, your job, or a job/);
});

test("the life decides: the captain is asked to decide, the crew aren't asked to buy for the ship", () => {
  const captain = newGame();
  only(captain, "medicine");
  lg.takeAboard(captain, SHIP, "medicine_crate", 4);
  assert.deepEqual(told(at(captain, 10.5)), ["[REQUEST] Dr. Aduro has something for you to decide, in Medbay."]);

  const crew = newGame("orderly");
  only(crew, "medicine");
  lg.takeAboard(crew, SHIP, "medicine_crate", 4);
  assert.deepEqual(told(at(crew, 10.5)), []);
  assert.equal(crew.requests.open.medicine, undefined, "medicine is for the captain alone");
});

test("an order for crew: the engine hand's job is short of hands, and Chief Marrow orders a shift", () => {
  const game = newGame("engine_hand");
  only(game, "extra_shift");
  assert.equal(conditionHolds(game, "short your job"), false, "four techs, the engine hand among them, for three wanted");
  shortTech(game);
  assert.equal(conditionHolds(game, "short your job"), true);
  assert.equal(conditionHolds(game, "job you tech"), true);
  const notes = told(at(game, 10.5));
  assert.deepEqual(notes, ["[REQUEST] Chief Engineer Marrow has orders for you, in Engineering."]);
  const first = talkTo(game, "marrow", "Yes, I'll take it");
  assert.match(first, /I need you on a shift today\. That's not a question\./);
  const quest = game.quests.find((one) => one.request === "extra_shift");
  assert.deepEqual({ objective: quest.objective, order: quest.order }, { objective: "Work a shift", order: true });
  assert.match(questsView(game).quests.find((one) => one.id === quest.id).step.where, /^Chief Engineer Marrow's orders\. By /);
  assert.equal(quest.desc, "Chief Engineer Marrow gave you the order on day 1.");
  const shift = rules.workShift(game);
  assert.match(shift, /\[REQUEST\] Done: An extra shift\. Chief Engineer (Dunn )?Marrow: "That's the shift covered\. Thank you\."/);
  assert.equal(memoryOf(game, "marrow").kind, "obeyed");
});

test("refusing an order costs more than a no, and they say so for a week", () => {
  const game = newGame("engine_hand");
  only(game, "extra_shift");
  shortTech(game);
  at(game, 10.5);
  talkTo(game, "marrow", "I can't today");
  const memory = memoryOf(game, "marrow");
  assert.equal(memory.kind, "disobeyed");
  assert.ok(readRecord(game).facts.some((one) => one.id === "request_extra_shift_refused" && /You refused Chief Engineer Marrow's orders about an extra shift/.test(one.text)));
  assert.match(JSON.stringify(cmd.commandView(game)), /gave you orders \(an extra shift\), and was refused/, "on Marrow's card");
  game.clock.hours += 24 * 5;
  assert.match(cmd.grudgeLine(game, "marrow") ?? "", /order|refused me|told you to do something/);
  game.clock.hours += 24 * 3;
  assert.doesNotMatch(cmd.grudgeLine(game, "marrow") ?? "", /order|refused me|told you to do something/, "after a week it isn't said");
});

test("a dock hand at Haven: Dockmaster Jessup asks for two more shifts, and someone else there asks for a word with him", () => {
  const game = newGame("docker");
  assert.equal(game.location, "haven");
  only(game, "hand_on_job");
  const notes = told(at(game, 10.5));
  assert.equal(game.requests.open.hand_on_job?.asker, "mott");
  assert.match(notes[0], /^\[REQUEST\] Dockmaster Jessup has something to ask you, in the Manifest Docks\.$/);
  talkTo(game, "mott", "I'll do it");
  const quest = game.quests.find((one) => one.request === "hand_on_job");
  assert.equal(quest.objective, "Work 2 shifts (0/2)");
  rules.workShift(game);
  assert.equal(quest.objective, "Work 2 shifts (1/2)");
  assert.match(rules.workShift(game), /\[REQUEST\] Done: Two more shifts\./);

  // Someone with a name at Haven, not Jessup, has a word for him.
  only(game, "word_for_boss");
  game.requests.day = undefined;
  // The next morning: nobody brings something new at night.
  at(game, Math.floor(game.clock.hours / 24) * 24 + 24 + 7.5);
  const open = game.requests.open.word_for_boss;
  assert.ok(open?.asker && open.asker !== "mott", JSON.stringify(open));
  const first = talkTo(game, open.asker, "I'll tell");
  assert.match(first, /You work for Dockmaster Mott Jessup, don't you\?/);
  assert.equal(game.quests.find((one) => one.request === "word_for_boss").objective, "Talk to Dockmaster Jessup");
  talkTo(game, "mott");
  assert.match(told(rq.advanceRequests(game))[0], /^\[REQUEST\] Done: A word for the boss\./);
});

test("away from where their work is, nobody there asks them, and the captain's kinds never reach them", () => {
  const game = newGame("docker");
  only(game, "hand_on_job", "medicine");
  game.location = "kessara";
  at(game, 10.5);
  assert.deepEqual(game.requests.open, {});
});

test("the pacer: a quiet day between, nothing in the middle of a written scene, not the same kind twice running", () => {
  const game = newGame();
  only(game, "medicine", "fuel");
  lg.takeAboard(game, SHIP, "medicine_crate", 4);
  game.ship.fuel = 2;
  // A written scene being played with the player: nothing new is asked.
  game.scene = { id: "thread_test", part: "start", told: true, with: null };
  at(game, 10.5);
  assert.deepEqual(game.requests.open, {});
  game.scene = null;
  at(game, 11.5);
  const first = Object.keys(game.requests.open);
  assert.equal(first.length, 1);
  // The first is turned down; it rests a week, and the other comes after a quiet day, not the next.
  rq.answerRequest(game, first[0], "no");
  at(game, 35.5);
  assert.deepEqual(Object.keys(game.requests.open), [], "a quiet day");
  at(game, 59.5);
  const second = Object.keys(game.requests.open);
  assert.equal(second.length, 1);
  assert.notEqual(second[0], first[0], "not the same kind twice running");
});

test("what can't wait doesn't wait for the quiet day: someone down is asked about at once", () => {
  const game = newGame("engine_hand");
  only(game, "carry", "extra_shift");
  shortTech(game);
  at(game, 10.5);
  assert.ok(game.requests.open.extra_shift);
  game.down = { "Mess Hand Bao": { who: "Mess Hand Bao", place: SHIP, level: "deck2", x: 10, y: 10, since: 10.5, why: "out cold" } };
  game.clock.hours = 11.5;
  rq.advanceRequests(game);
  assert.equal(game.requests.open.carry?.about, "Mess Hand Bao", "the same day");
});

test("nobody brings something new at night, unless it can't wait", () => {
  const game = newGame("docker");
  only(game, "hand_on_job");
  at(game, 22.5);
  assert.deepEqual(game.requests.open, {}, "half past ten at night");
  at(game, 31.5);
  assert.equal(game.requests.open.hand_on_job?.asker, "mott", "half past seven in the morning");
});
