// Requests, step 4 of the organic quests: people's own troubles. A request can be about someone: a rival working
// against a post's holder, someone relieved who wants their post back, someone in the brig, the officer least loyal to
// the captain while there's grumbling, someone lying where they fell with nobody coming. The about: line finds them,
// asks: them lets the trouble's own person ask, {about}, {post} and {holder} fill in who and what, and two new goals
// (carry someone to the medbay, and your word) and two new lines (* rivalry ends, * release) settle them. None of this
// calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-requests-people-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const rules = await import("../src/rules.js");
const rq = { ...(await import("../src/requests.js")), ...(await import("../src/quests.js")) };
const walk = await import("../src/walk.js");
const talks = await import("../src/talks.js");
const cmd = await import("../src/command.js");
const { readRecord } = await import("../src/record.js");
const { parseCondition, conditionHolds, parseSceneText } = await import("../src/scene-text.js");

const SHIP = "meridian";
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
const day = (game) => Math.floor(game.clock.hours / 24);
// The player goes to someone (brought over to wherever they're standing) and says what's given, if anything.
function talkTo(game, key, words = null) {
  walk.bringOver(game, [key]);
  walk.talkCommand(game, { action: "open", person: key });
  talks.openWrittenTalk(game);
  const first = game.talk.lastReply;
  if (words) talks.writtenTalkTurn({ game, playerText: words, emit: () => {} });
  walk.closeTalk(game);
  return first;
}
const factOf = (game, id) => readRecord(game).facts.find((one) => one.id === id) ?? null;
// Only the kind being tested is asked: the others rest.
function only(game, kind) {
  const rest = Object.fromEntries(["medicine", "fuel", "parts", "pantry", "broken", "medkit", "rival", "post_back", "brig", "grumbling", "carry"].filter((one) => one !== kind).map((one) => [one, 1e9]));
  game.requests = { open: {}, rest, asked: {}, n: 0 };
}

test("conditions on rivals, the brig and someone down, and the checker's rules for about:", () => {
  for (const text of ["rival any", "rival chief_medical_officer", "brig any", "brig tarrow", "down any", "down Mess Hand Bao"]) assert.deepEqual(parseCondition(text).problems, [], text);
  assert.match(parseCondition("rival the moon").problems.join(" "), /"rival" is followed by any or a post/);
  assert.match(parseCondition("brig").problems.join(" "), /"brig" is followed by any or someone/);
  const game = newGame();
  assert.equal(conditionHolds(game, "rival any"), false);
  game.command[SHIP].rivals = { chief_medical_officer: { key: "Nurse Anton", since: day(game) } };
  assert.equal(conditionHolds(game, "rival any"), true);
  assert.equal(conditionHolds(game, "rival chief_medical_officer"), true);
  assert.equal(conditionHolds(game, "rival quartermaster"), false);
  game.command[SHIP].brig = { tarrow: { until: day(game) + 7, by: "you" } };
  assert.equal(conditionHolds(game, "brig any"), true);
  assert.equal(conditionHolds(game, "brig Kara Tarrow"), true);
  const lines = (top) => parseSceneText(`# T\n${top}\n\n== ask\n@{asker}: "?"\n> Yes -> yes\n\n== yes\n@{asker}: "Y."\n\n== done\n@{asker}: "D."\n\n== failed\n@{asker}: "F."\n\n== gone\n@{asker}: "G."\n`, "request_t").scene;
  const problemsOf = (top) => rq.compileRequest("t", lines(top)).problems.join(" | ");
  assert.match(problemsOf("when: captain\nasks: them\nneeds: your word\nby: 1 day"), /asks: them needs an about: line/);
  assert.match(problemsOf("when: captain\nabout: a ghost\nasks: them\nneeds: your word\nby: 1 day"), /about: is one of a rival/);
  assert.match(problemsOf("when: captain\nabout: the least loyal officer\nasks: them\nneeds: your word\nby: 1 day"), /asks: them is for a trouble that falls on someone/);
  assert.match(problemsOf("when: captain\nabout: a rival\nasks: them\nneeds: carry {about} to the medbay\nby: 1 day"), /needs about: someone down with nobody coming/);
  assert.equal(problemsOf("when: rival any\nabout: a rival\nasks: them\nneeds: talk to {about}\nby: 3 days"), "");
});

test("bad blood: Dr. Aduro asks you to have a word with the nurse working against them, and the rivalry ends", () => {
  const game = newGame();
  only(game, "rival");
  game.command[SHIP].rivals = { chief_medical_officer: { key: "Nurse Anton", since: day(game) } };
  at(game, 10.5);
  const open = game.requests.open.rival;
  assert.deepEqual({ asker: open.asker, about: open.about, post: open.post }, { asker: "aduro", about: "Nurse Anton", post: "chief_medical_officer" });
  const first = talkTo(game, "aduro", "I'll talk to Nurse Anton");
  assert.match(first, /Nurse Anton has been telling anyone who'll listen that I can't do this job/);
  const quest = game.quests.find((one) => one.request === "rival");
  assert.equal(quest.objective, "Talk to Nurse Anton");
  talkTo(game, "Nurse Anton");
  const notes = rq.advanceRequests(game);
  assert.match(told(notes)[0], /^\[REQUEST\] Done: Bad blood\. Dr\. Sen Aduro: "Whatever you said to Nurse Anton, it's quieter/);
  assert.ok(notes.some((one) => /Nurse Anton has stopped working against Dr\. Aduro: You had a word with Nurse Anton/.test(one)), notes.join(" | "));
  assert.equal(game.command[SHIP].rivals?.chief_medical_officer, undefined);
  assert.equal(game.command[SHIP].memory["Nurse Anton"].at(-1).w, -3, "the rival remembers whose side you took");
  assert.ok(factOf(game, "request_rival_done"));
});

test("taking the rival's side: a no, and the rival remembers it kindly", () => {
  const game = newGame();
  only(game, "rival");
  game.command[SHIP].rivals = { chief_medical_officer: { key: "Nurse Anton", since: day(game) } };
  at(game, 10.5);
  talkTo(game, "aduro", "Maybe Nurse Anton has a point");
  assert.equal(game.command[SHIP].memory.aduro.at(-1).kind, "turned_down");
  const anton = game.command[SHIP].memory["Nurse Anton"].at(-1);
  assert.deepEqual({ kind: anton.kind, w: anton.w }, { kind: "story", w: 4 });
  assert.ok(game.command[SHIP].rivals?.chief_medical_officer, "and the rivalry goes on");
});

test("the post they lost: someone relieved asks the captain for it back, and a yes gives it back at once", () => {
  const game = newGame();
  only(game, "post_back");
  cmd.storyCommand(game, { command: "relieve", post: "quartermaster", reason: "A test" });
  const holder = cmd.holderKey(game, SHIP, "quartermaster");
  assert.notEqual(holder, "odessa");
  at(game, 10.5);
  const open = game.requests.open.post_back;
  assert.deepEqual({ asker: open.asker, post: open.post }, { asker: "odessa", post: "quartermaster" });
  const first = talkTo(game, "odessa", "It's yours again");
  assert.match(first, /I'm not the quartermaster any more\. .+ has it now\. Give it back to me/);
  assert.equal(cmd.holderKey(game, SHIP, "quartermaster"), "odessa", "the post is hers again");
  assert.match(told(rq.advanceRequests(game))[0], /^\[REQUEST\] Done: The post they lost\./);
  assert.ok(factOf(game, "request_post_back_done"));
});

test("days in the brig: whoever's in it asks to be let out, and a yes lets them out as a spare hand", () => {
  const game = newGame();
  only(game, "brig");
  game.command[SHIP].brig = { tarrow: { until: day(game) + 7, by: "you" } };
  at(game, 10.5);
  assert.equal(game.requests.open.brig?.asker, "tarrow");
  const first = talkTo(game, "tarrow", "Let them out");
  assert.match(first, /Let me out before my days are done/);
  assert.equal(game.command[SHIP].brig?.tarrow, undefined);
  assert.equal(game.command[SHIP].jobs.tarrow, null, "a spare hand");
  assert.match(told(rq.advanceRequests(game))[0], /^\[REQUEST\] Done: Days in the brig\./);
});

test("who's stirring it: while there's grumbling, the first officer asks you to talk to the least loyal officer", () => {
  const game = newGame();
  only(game, "grumbling");
  game.command[SHIP].mutiny = { pressure: 2, stage: 1, ringleader: null, due: null, calmUntil: 0 };
  at(game, 10.5);
  const open = game.requests.open.grumbling;
  assert.equal(open.asker, "voss");
  const officers = ["odessa", "marrow", "tarrow", "aduro", "tobin", "seven", "pell", "iven"].filter((key) => cmd.holderKey(game, SHIP, cmd.postOf(game, SHIP, key)) === key);
  const least = officers.sort((a, b) => cmd.loyaltyOf(game, SHIP, a) - cmd.loyaltyOf(game, SHIP, b))[0];
  assert.equal(open.about, least);
  const first = talkTo(game, "voss", "I'll talk to");
  assert.match(first, /There's grumbling in the mess, Captain/);
  assert.equal(game.requests.open.grumbling.state, "accepted");
  assert.ok(game.quests.some((one) => one.request === "grumbling" && one.status === "active"));
  const loyal = cmd.loyaltyOf(game, SHIP, least);
  talkTo(game, least);
  assert.match(told(rq.advanceRequests(game))[0], /^\[REQUEST\] Done: Who's stirring it\./);
  assert.ok(cmd.loyaltyOf(game, SHIP, least) > loyal, "hearing them out moves their loyalty");
});

test("a hand with the carrying: someone down with nobody coming, a nurse asks, and carrying them to a cot does it", () => {
  const game = newGame("engine_hand");
  only(game, "carry");
  at(game, 10.5);
  // Lying in the Galley half an hour, with nobody on the way (the medbay's own rounds are kept still here).
  const down = { who: "Mess Hand Bao", place: SHIP, level: "deck2", x: 10, y: 10, since: game.clock.hours - 0.5, why: "out cold" };
  game.down = { "Mess Hand Bao": down };
  assert.equal(conditionHolds(game, "down any"), true);
  game.clock.hours = 11.5;
  rq.advanceRequests(game);
  const open = game.requests.open.carry;
  assert.equal(open?.about, "Mess Hand Bao");
  assert.match(open.asker, /^Nurse /);
  rq.answerRequest(game, "carry", "yes");
  const quest = game.quests.find((one) => one.request === "carry");
  assert.equal(quest.objective, "Carry Mess Hand Bao to the medbay");
  // Picked up by the player: still going, not "gone".
  down.carriedBy = "you";
  assert.deepEqual(told(rq.advanceRequests(game)), []);
  assert.equal(quest.status, "active");
  // Laid on a cot.
  delete down.carriedBy;
  down.bed = "cot-1";
  assert.match(told(rq.advanceRequests(game))[0], /^\[REQUEST\] Done: A hand with the carrying\./);

  // Someone else got there first: gone. Dying where they lay: failed.
  const other = newGame("engine_hand", 33);
  only(other, "carry");
  at(other, 10.5);
  const lying = { who: "Mess Hand Lotte", place: SHIP, level: "deck2", x: 10, y: 10, since: other.clock.hours - 0.5, why: "out cold" };
  other.down = { "Mess Hand Lotte": lying };
  other.clock.hours = 11.5;
  rq.advanceRequests(other);
  rq.answerRequest(other, "carry", "yes");
  lying.carriedBy = "Nurse Haru";
  assert.match(told(rq.advanceRequests(other))[0], /^\[REQUEST\] No longer needed: A hand with the carrying\./);

  const third = newGame("engine_hand", 45);
  only(third, "carry");
  at(third, 10.5);
  const left = { who: "Mess Hand Lotte", place: SHIP, level: "deck2", x: 10, y: 10, since: third.clock.hours - 0.5, why: "out cold" };
  third.down = { "Mess Hand Lotte": left };
  third.clock.hours = 11.5;
  rq.advanceRequests(third);
  rq.answerRequest(third, "carry", "yes");
  left.dead = true;
  assert.match(told(rq.advanceRequests(third))[0], /^\[REQUEST\] Failed: A hand with the carrying\./);
});

test("a request given less than a day says the time it's due, not only the day", () => {
  const { dueWords } = rq;
  assert.equal(dueWords(14.5, true), "14:30 on day 1");
  assert.equal(dueWords(14.5), "day 1");
  assert.equal(dueWords(50.25, true), "02:15 on day 3");
});
