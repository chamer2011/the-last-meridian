// Requests, step 2 of the organic quests: every kind of goal (fix a part by hand, give someone something, talk to
// someone, go somewhere, pass a check, as well as bringing things aboard), handing a request to whoever's post it is
// with their duty showing how it went, a reminder the day before one's due, and parts that wear out now and then by
// themselves. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-requests-goals-"));
// The real scenes, and three requests of the tests' own for the kinds of goal no draft uses yet.
const scenesDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-requests-goals-scenes-"));
for (const name of fs.readdirSync(new URL("../world/scenes/", import.meta.url))) fs.copyFileSync(new URL(`../world/scenes/${name}`, import.meta.url), path.join(scenesDir, name));
const testRequest = (title, flag, asks, needs) => `# ${title}
when: flag ${flag}
asks: ${asks}
needs: ${needs}
by: 2 days

== ask
@{asker}: "Would you?"
> Yes -> yes
> No -> no

== yes
@{asker}: "Good."

== no
@{asker}: "Fine."

== done
@{asker}: "Done, then."

== failed
@{asker}: "Not done."

== gone
@{asker}: "Never mind."
`;
fs.writeFileSync(path.join(scenesDir, "request_test_talk.txt"), testRequest("Word to the quartermaster", "test_talk", "the chief medical officer", "talk to the quartermaster"));
fs.writeFileSync(path.join(scenesDir, "request_test_go.txt"), testRequest("A trip to Haven", "test_go", "the chief engineer", "go to haven"));
fs.writeFileSync(path.join(scenesDir, "request_test_pass.txt"), testRequest("A steady hand", "test_pass", "the quartermaster", "pass engineering"));
process.env.GAME_SCENES_DIR = scenesDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const rules = await import("../src/rules.js");
const lg = await import("../src/logistics.js");
const rq = await import("../src/requests.js");
const sys = await import("../src/systems.js");
const walk = await import("../src/walk.js");
const talks = await import("../src/talks.js");
const cmd = await import("../src/command.js");
const { startCheck, checkCommand } = await import("../src/checks.js");
const { putsOf } = await import("../src/puts.js");
const { parseSceneText, conditionHolds } = await import("../src/scene-text.js");
const { allSceneProblems } = await import("../src/scenes.js");

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
  return game.talk.lastReply;
}
function say(game, words) {
  const said = [];
  talks.writtenTalkTurn({ game, playerText: words, emit: (e) => { if (e.type !== "state") said.push(e.text); } });
  return said;
}
const partNamed = (kind, room) => Object.values(sys.systemsOf(SHIP).parts).find((part) => part.kind === kind && (!room || part.room === room));
// Settles a check on a part the way the server does, with the result decided here instead of by dice.
function settleAs(game, success) {
  const reason = game.check?.reason;
  game.check = null;
  return sys.settlePart(game, { success, reason, training: false });
}
const questOf = (game, kind) => [...game.quests].reverse().find((one) => one.request === kind);

// The speaker in the Galley worn out, with no parts crate aboard to mend it, and the engineers having tried.
// With no crates at all, Marrow would ask the captain to buy parts first, so that request is resting here.
function brokenWithoutParts(game) {
  lg.takeAboard(game, SHIP, "parts_crate", 99);
  game.requests = { open: {}, rest: { parts: 1e9 }, asked: {}, n: 0 };
  const speaker = partNamed("speaker", "galley");
  sys.damagePart(game, SHIP, speaker.id, "cut", { by: "wear" });
  // The engineers come to mend it within the two hours, and find no crate.
  at(game, 9.5);
  at(game, 9.9);
  return speaker;
}
// Takes on the broken speaker: Marrow asks, and the player answers.
function askedToFix(game, answer) {
  const speaker = brokenWithoutParts(game);
  at(game, 10.5);
  const first = talkTo(game, "engineering", "marrow");
  say(game, answer);
  walk.closeTalk(game);
  return { speaker, first };
}

test("the new drafts and the kinds of goal are sound, and the checker knows their rules", () => {
  const { problems } = allSceneProblems();
  assert.deepEqual(problems.filter((one) => one.includes("request_")), []);
  assert.deepEqual(rq.requestProblems(), []);
  const lines = (top, parts) => parseSceneText(`# T\n${top}\n\n== ask\n@{asker}: "?"\n> Yes -> yes\n\n== yes\n@{asker}: "Y."\n\n== done\n@{asker}: "D."\n\n== failed\n@{asker}: "F."\n\n== gone\n@{asker}: "G."\n${parts}`, "request_t").scene;
  const problemsOf = (top, parts = "") => rq.compileRequest("t", lines(top, parts)).problems.join(" | ");
  assert.match(problemsOf("when: captain\nasks: the quartermaster\nneeds: fix the moon\nby: 1 day"), /no part called the moon/);
  assert.match(problemsOf("when: captain\nasks: the quartermaster\nneeds: give 1 moonbeam to {asker}\nby: 1 day"), /no item called moonbeam/);
  assert.match(problemsOf("when: captain\nasks: the quartermaster\nneeds: go to the moon\nby: 1 day"), /no place called the moon/);
  assert.match(problemsOf("when: captain\nasks: the quartermaster\nneeds: pass juggling\nby: 1 day"), /no skill called juggling/);
  assert.match(problemsOf("when: captain\nasks: the quartermaster\nneeds: talk to {asker}\nby: 1 day\nhanded to: the chief engineer"), /needs a handed part/);
  assert.match(problemsOf("when: captain\nasks: the quartermaster\nneeds: talk to {asker}\nby: 1 day\nhanded to: the chief engineer", "\n== handed\n@{asker}: \"H.\"\n"), /handed to: needs a gone when: line/);
  assert.match(problemsOf("when: captain\nasks: the quartermaster\nneeds: talk to {asker}\nby: 1 day", "\n== handed\n@{asker}: \"H.\"\n"), /needs a handed to: line/);
  assert.match(problemsOf("when: captain\nasks: the quartermaster\nneeds: talk to {asker}\nby: 1 day\nhanded to: the cat"), /handed to: is a post aboard/);
  assert.equal(problemsOf("when: repairs waiting\nasks: the chief engineer\nneeds: fix a part waiting for repairs\nby: 2 days"), "");
});

test("parts wear out now and then on the Meridian, mended the same day while there are crates, and the same for the same game", () => {
  // Aboard, so the player hears each one.
  const wearFor = (game, days) => {
    const heard = [];
    for (let day = 1; day <= days; day += 1) heard.push(...sys.wearDay(game, day).filter((one) => /given out/.test(one)));
    return heard;
  };
  const game = newGame();
  const crates = lg.countAboard(game, SHIP, "parts_crate").n;
  const heard = wearFor(game, 120);
  assert.ok(heard.length >= 4 && heard.length <= 25, `about one every ten days: ${heard.length} in 120`);
  for (const line of heard) assert.match(line, /^\[SYSTEMS\] The (junction box|air plant|speaker|relay|engines) in .+ (has|have) given out/);
  // With a crate aboard, the engineers replace what wore out on its own day, a crate where a repair takes one.
  assert.match(heard[0], /has replaced what wore out/);
  assert.ok(lg.countAboard(game, SHIP, "parts_crate").n < crates, "crates went on repairs");
  assert.deepEqual(wearFor(newGame(), 120), heard, "the same game and days wear the same way");
  assert.deepEqual(sys.wearDay(game, game.wearDay), [], "a day wears once");
  // Nowhere else wears out.
  assert.deepEqual(Object.keys(game.systems ?? {}).filter((place) => place !== SHIP && Object.values(game.systems[place]?.parts ?? {}).some((one) => one.by === "wear")), []);
  // With no crate it stays broken, looks worn, and waits for one.
  const bare = newGame();
  lg.takeAboard(bare, SHIP, "parts_crate", 99);
  const lines = [];
  for (let day = 1; day <= 120; day += 1) lines.push(...sys.wearDay(bare, day));
  const broken = sys.partsWaitingIds(bare, SHIP);
  assert.ok(broken.length > 0, lines.join(" | "));
  const part = sys.systemsOf(SHIP).parts[broken[0]];
  assert.match(sys.lookAt(bare, SHIP, part), /given out|burnt out|clogged|worn through/);
  assert.ok(lines.some((one) => /can't fix the/.test(one)), lines.join(" | "));
});

test("with no parts crate aboard, the chief engineer asks someone to fix what broke, and fixing it by hand does it", () => {
  const game = newGame();
  const speaker = brokenWithoutParts(game);
  assert.deepEqual(sys.partsWaitingIds(game, SHIP), [speaker.id]);
  assert.equal(conditionHolds(game, "repairs waiting"), true);
  at(game, 10.5);
  assert.equal(game.requests.open.broken?.part, speaker.id);
  const first = talkTo(game, "engineering", "marrow");
  assert.match(first, /The speaker in the Galley has gone/);
  assert.match(first, /> Leave it to your engineers/, "the captain can hand it on");
  say(game, "I'll see to it");
  walk.closeTalk(game);
  const quest = questOf(game, "broken");
  assert.equal(quest.objective, "Fix the speaker in the Galley");
  // By hand, in the Galley: the part's own fix, an engineering check, passed.
  walk.walkCommand(game, { action: "room", to: "galley" });
  const xp = game.xp;
  assert.deepEqual(sys.workOnPart(game, `part:${speaker.id}`, "fix"), { check: true });
  settleAs(game, true);
  assert.equal(putsOf(game, `fixed:${SHIP}`, speaker.id), 1);
  const notes = told(rq.advanceRequests(game));
  assert.match(notes[0], /^\[REQUEST\] Done: Something broken\. Chief Engineer Dunn Marrow: "The speaker's working\./);
  assert.equal(game.xp, xp + 20);
  assert.equal(quest.status, "completed");
  assert.equal(quest.objective, "Done: fix the speaker in the Galley.");
});

test("left to the engineers: done once a crate comes and they mend it, and it's on the chief engineer's duty", () => {
  const game = newGame();
  const { speaker } = askedToFix(game, "Leave it to your engineers");
  const quest = questOf(game, "broken");
  assert.equal(game.requests.open.broken.state, "handed");
  assert.match(quest.objective, /is seeing to it$/);
  assert.equal(quest.handed, true);
  // A crate comes aboard, and the engineers fix it within the hour or two.
  lg.putAboard(game, SHIP, "parts_crate", 1);
  let notes = [];
  for (let h = 11; h <= 14 && !notes.length; h += 0.5) notes = told(at(game, h));
  assert.equal(sys.partBroken(game, SHIP, speaker.id), false);
  assert.match(notes[0], /^\[REQUEST\] Done by .+: Something broken\.$/);
  assert.equal(quest.status, "completed");
  // The next midnight marks the chief engineer's day, five more for it.
  rules.passTime(game, 24.2 - game.clock.hours);
  const days = game.command[SHIP].duty.chief_engineer;
  assert.equal(days.at(-1).handed, 5);
  assert.match(JSON.stringify(cmd.commandView(game)), /5 more for a request you handed them, done/);
});

test("left to the engineers and still broken on the day: failed, and fifteen off the chief engineer's day", () => {
  const game = newGame();
  askedToFix(game, "Leave it to your engineers");
  const quest = questOf(game, "broken");
  const due = game.requests.open.broken.due;
  let notes = [];
  for (let h = 11; h <= due + 1 && !notes.length; h += 6) notes = told(at(game, h));
  if (!notes.length) notes = told(at(game, due + 0.5));
  assert.match(notes.join(" "), /\[REQUEST\] Failed: Something broken\. .+ didn't see to it by day 3\./);
  assert.equal(quest.status, "failed");
  rules.passTime(game, (Math.floor(game.clock.hours / 24) + 1) * 24 + 0.2 - game.clock.hours);
  assert.equal(game.command[SHIP].duty.chief_engineer.at(-1).handed, -15);
});

test("a nurse asks for a medkit when the cabinet's empty, and handing it over there and then does it", () => {
  const game = newGame("engine_hand");
  lg.takeAboard(game, SHIP, "medicine_crate", 99);
  at(game, 10.5);
  const open = game.requests.open.medkit;
  assert.ok(open, "a nurse asks");
  assert.match(open.asker, /^Nurse /);
  const first = talkTo(game, "medbay", open.asker);
  assert.match(first, /You carry a medkit/);
  const said = say(game, "Here, take mine");
  assert.ok(said.some((one) => /You give Nurse \w+ the medkit/.test(one)), said.join(" | "));
  walk.closeTalk(game);
  assert.equal(game.inventory.medkit, 1);
  const notes = told(rq.advanceRequests(game));
  assert.match(notes[0], /^\[REQUEST\] Done: A medkit for the ward\./);
});

test("or saying they'll bring one, and Give on the nurse's menu does it", () => {
  const game = newGame("engine_hand");
  lg.takeAboard(game, SHIP, "medicine_crate", 99);
  at(game, 10.5);
  const nurse = game.requests.open.medkit.asker;
  talkTo(game, "medbay", nurse);
  say(game, "I'll bring you one");
  walk.closeTalk(game);
  const view = walk.walkView(game).people.find((one) => one.key === nurse);
  assert.deepEqual(view.wants, { item: "medkit", n: 1, name: "Medkit" });
  const reply = walk.walkCommand(game, { action: "give", key: `person:${nurse}` });
  assert.match(reply.said, /^\[ITEM\] You give .+ the medkit\.$/);
  assert.equal(game.inventory.medkit, 1);
  assert.match(told(rq.advanceRequests(game))[0], /^\[REQUEST\] Done: A medkit for the ward\./);
  assert.equal(walk.walkView(game).people.find((one) => one.key === nurse)?.wants, undefined);
  assert.throws(() => walk.walkCommand(game, { action: "give", key: `person:${nurse}` }), /aren't waiting for anything/);
});

test("talk to someone, go somewhere, pass a check: the other kinds of goal", () => {
  const game = newGame();
  const take = (flag, kind, hours) => {
    game.flags = { ...(game.flags ?? {}), [flag]: true };
    at(game, hours);
    assert.equal(game.requests.open[kind]?.state, "offered", kind);
    assert.equal(rq.answerRequest(game, kind, "yes").length, 1);
    return questOf(game, kind);
  };
  const talk = take("test_talk", "test_talk", 10.5);
  assert.equal(talk.objective, "Talk to Quartermaster Brandt");
  talkTo(game, "mess", "odessa");
  walk.closeTalk(game);
  assert.match(told(rq.advanceRequests(game))[0], /^\[REQUEST\] Done: Word to the quartermaster\./);

  const go = take("test_go", "test_go", 34.5);
  assert.equal(go.objective, "Go to Haven Station");
  game.location = "haven";
  assert.match(told(rq.advanceRequests(game))[0], /^\[REQUEST\] Done: A trip to Haven\./);
  game.location = SHIP;

  const pass = take("test_pass", "test_pass", 58.5);
  assert.equal(pass.objective, "Pass a check of engineering");
  // Checks are rolled until one passes, the way the game rolls them.
  for (let tries = 0; tries < 60 && pass.status === "active"; tries += 1) {
    startCheck(game, { skill: "engineering", difficulty: "easy", reason: "A test", source: "tool" });
    while (game.check) checkCommand(game, game.check.decided ? "disconnect" : "run");
    rq.advanceRequests(game);
  }
  assert.equal(pass.status, "completed");
});

test("a day before a request is due, the player hears once", () => {
  const game = newGame();
  lg.takeAboard(game, SHIP, "medicine_crate", 4);
  at(game, 10.5);
  rq.answerRequest(game, "medicine", "yes");
  const due = game.requests.open.medicine.due;
  assert.deepEqual(told(at(game, due - 30)).filter((one) => /Due tomorrow/.test(one)), []);
  const notes = told(at(game, due - 23));
  assert.ok(notes.some((one) => /^\[REQUEST\] Due tomorrow: Medicine for the medbay\. Bring 2 medicine crates aboard \(0\/2\)\.$/.test(one)), notes.join(" | "));
  assert.deepEqual(told(at(game, due - 22)).filter((one) => /Due tomorrow/.test(one)), []);
});
