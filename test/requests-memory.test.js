// Requests, step 3 of the organic quests: whoever asked remembers what came of it. Helped, let down, turned down, or
// seen to by whoever the captain left it to: a memory with its words, said with their first words for a few days, on
// their card in the Command menu, moving an officer's loyalty to the captain; and each outcome on the record, for the
// scenes to ask about. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-requests-memory-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const rules = await import("../src/rules.js");
const lg = await import("../src/logistics.js");
const rq = await import("../src/requests.js");
const walk = await import("../src/walk.js");
const talks = await import("../src/talks.js");
const ship = await import("../src/ship.js");
const cmd = await import("../src/command.js");
const { readRecord } = await import("../src/record.js");
const { factsLeft, loadScenes } = await import("../src/scenes.js");
const { ROOM_TALK } = await import("../src/world.js");

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
function talkTo(game, room, key) {
  walk.walkCommand(game, { action: "room", to: room });
  walk.talkCommand(game, { action: "open", person: key });
  talks.openWrittenTalk(game);
  const first = game.talk.lastReply;
  walk.closeTalk(game);
  return first;
}
function say(game, room, key, words) {
  walk.walkCommand(game, { action: "room", to: room });
  walk.talkCommand(game, { action: "open", person: key });
  talks.openWrittenTalk(game);
  talks.writtenTalkTurn({ game, playerText: words, emit: () => {} });
  walk.closeTalk(game);
}
const memoryOf = (game, key) => game.command?.[SHIP]?.memory?.[key] ?? [];
const factOf = (game, id) => readRecord(game).facts.find((one) => one.id === id) ?? null;
const lines = (kind) => ROOM_TALK.stock.grudge[kind];
const saysOneOf = (text, kind) => lines(kind).some((line) => text.includes(line.replace(/\{who\}.*$/, "")));
// The medicine cabinet down to its last crate, and Dr. Aduro asking.
function asked(game) {
  lg.takeAboard(game, SHIP, "medicine_crate", lg.countAboard(game, SHIP, "medicine_crate").n - 1);
  at(game, 10.5);
  assert.equal(game.requests.open.medicine?.asker, "aduro");
}
function buyMedicine(game) {
  game.ship.at = "haven";
  game.credits = 5000;
  ship.shipCommand(game, { action: "buy", id: "medicine" });
  ship.shipCommand(game, { action: "buy", id: "medicine" });
  return told(rq.advanceRequests(game));
}

test("helped: Dr. Aduro remembers it, thanks you with their first words for a few days, and it's on the record and on their card", () => {
  const game = newGame();
  asked(game);
  say(game, "medbay", "aduro", "I'll see to it");
  const loyal = cmd.loyaltyOf(game, SHIP, "aduro");
  assert.match(buyMedicine(game)[0], /^\[REQUEST\] Done: Medicine for the medbay\./);
  const memory = memoryOf(game, "aduro").at(-1);
  assert.deepEqual({ kind: memory.kind, by: memory.by, words: memory.words }, { kind: "helped", by: "you", words: "medicine for the medbay" });
  assert.ok(cmd.loyaltyOf(game, SHIP, "aduro") > loyal, "an officer's loyalty to the captain goes up");
  assert.match(JSON.stringify(cmd.commandView(game)), /asked you for help \(medicine for the medbay\), and got it/);
  const fact = factOf(game, "request_medicine_done");
  assert.match(fact.text, /^You brought 2 medicine crates aboard, when Dr\. Aduro asked \(day \d+\)\.$/);
  // Next time they're talked to, the thanks come first; a few days on, they don't.
  const now = game.clock.hours;
  assert.ok(saysOneOf(talkTo(game, "medbay", "aduro"), "helped_by_you"), "thanked");
  at(game, now + 24 * 4);
  assert.ok(!saysOneOf(talkTo(game, "medbay", "aduro"), "helped_by_you"), "not after a few days");
  assert.equal(memoryOf(game, "aduro").at(-1).kind, "helped", "but still remembered");
});

test("let down: the day came first, so they remember it against you, and say so", () => {
  const game = newGame();
  asked(game);
  say(game, "medbay", "aduro", "I'll see to it");
  const loyal = cmd.loyaltyOf(game, SHIP, "aduro");
  const due = game.requests.open.medicine.due;
  const notes = told(at(game, due + 0.5));
  assert.match(notes[0], /^\[REQUEST\] Failed: Medicine for the medbay\./);
  assert.equal(memoryOf(game, "aduro").at(-1).kind, "let_down");
  assert.ok(cmd.loyaltyOf(game, SHIP, "aduro") < loyal, "an officer's loyalty goes down");
  assert.ok(saysOneOf(talkTo(game, "medbay", "aduro"), "let_down_by_you"), "the reproach comes first");
  assert.match(factOf(game, "request_medicine_failed").text, /^You said you'd see to medicine for the medbay for Dr\. Aduro, and day \d+ came first\.$/);
});

test("turned down: a no is remembered too, a little, and it's on the record", () => {
  const game = newGame();
  asked(game);
  say(game, "medbay", "aduro", "We'll have to manage without");
  assert.equal(memoryOf(game, "aduro").at(-1).kind, "turned_down");
  assert.match(factOf(game, "request_medicine_refused").text, /^You told Dr\. Aduro no about medicine for the medbay, on day \d+\.$/);
  assert.ok(saysOneOf(talkTo(game, "medbay", "aduro"), "turned_down_by_you"));
});

test("left to the quartermaster: the cook remembers it was seen to, and the record says who did it", () => {
  const game = newGame();
  at(game, 10.5);
  for (const item of ["ration_crate", "produce"]) lg.takeAboard(game, SHIP, item, lg.stockOf(game, SHIP, item, "the pantry"), ["pantry"]);
  game.clock.hours = 11.5;
  rq.advanceRequests(game);
  const cook = game.requests.open.pantry?.asker;
  assert.match(cook ?? "", /^Cook /);
  rq.answerRequest(game, "pantry", "handed");
  let notes = [];
  for (let h = 11.6; h <= 15 && !notes.length; h += 0.25) notes = told(at(game, h));
  assert.match(notes[0], /^\[REQUEST\] Done by Quartermaster Brandt: A bare pantry\.$/);
  const memory = memoryOf(game, cook).at(-1);
  assert.deepEqual({ kind: memory.kind, about: memory.about }, { kind: "seen_to", about: "odessa" });
  assert.match(factOf(game, "request_pantry_seen_to").text, /^Quartermaster Brandt saw to a bare pantry for Cook \w+, when you left it to them/);
  assert.ok(saysOneOf(talkTo(game, "galley", cook), "seen_to_by_you"), "the cook says so");
});

test("a scene can wait on what a request leaves: the checker knows the facts", () => {
  const known = factsLeft(loadScenes().scenes);
  for (const id of ["request_medicine_done", "request_medicine_failed", "request_medicine_refused", "request_pantry_seen_to", "request_broken_left_undone"]) assert.ok(known.has(id), id);
});
