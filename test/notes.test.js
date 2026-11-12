// The stories' notes: every ending has a name, a story can name the facts it leaves and what on the record
// changes it, the written story ends a story by name, scenes can ask how a story ended, and the checker reads it all.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { INQUIRY, LEAK, useTestWorld } from "./fixtures/test-world.mjs";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-notes-"));
process.env.GAME_DATA_DIR = dataDir;
// The stories these tests read are the tests' own (test/fixtures): a leak, and the inquiry that follows it and
// reacts to how it ended. They're in a copy of the world, beside the game's stories.
useTestWorld();

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { endStory, endedWith, endingOf, recordFact, recordView } = await import("../src/record.js");
const { conditionHolds, parseCondition, parseEffect, parseSceneText } = await import("../src/scene-text.js");
const { allStoryProblems, factsLeft, loadScenes, sceneProblems, writtenTurn } = await import("../src/scenes.js");
const { notesProblems } = await import("../src/story-library.js");
const { TOOL_DEFS, newTurnLimits, runTool } = await import("../src/tools.js");
const { FACT_LINES, WORLD_THREADS, endingsOf } = await import("../src/world.js");

const FUEL = LEAK;
const newGame = (seed = 23) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  return game;
};
const quiet = (game) => ({ emit: () => {}, log: (role, text) => game.transcript.push({ role, text }) });

test("every story's endings have names, and the notes of all the stories pass the checker with the scenes", () => {
  for (const [id, thread] of Object.entries(WORLD_THREADS)) {
    const names = endingsOf(thread).map((one) => one.id);
    assert.ok(names.length >= 1, id);
    assert.equal(new Set(names).size, names.length, `${id} has two endings with one name`);
    for (const name of names) assert.match(name, /^[a-z][a-z0-9_]{1,39}$/, `${id}: ${name}`);
  }
  assert.deepEqual(endingsOf(WORLD_THREADS[FUEL]).map((one) => one.id), ["patch_it", "marrow_mends_it", "seal_the_hold", "let_it_run"]);
  assert.deepEqual(endingsOf({ gm: { outcomes: ["Plain words"] } }), [{ id: "ending_1", text: "Plain words" }], "an outcome without a name gets its number");
  assert.deepEqual(notesProblems(), []);
  const { count, stories, problems } = allStoryProblems();
  assert.deepEqual(problems, []);
  assert.equal(stories, Object.keys(WORLD_THREADS).length);
  assert.ok(count >= 24);
  assert.equal(FACT_LINES.aft_hold_sealed, "The Aft Holds are sealed since the leak.");
});

test("the checker names what's wrong in a story's notes, in plain words", () => {
  WORLD_THREADS.test_bad = {
    title: "Bad", kind: "crew", places: [], after: null, people: [], factions: [], lead: "x",
    gm: {
      outcomes: ["No name", { id: "Bad Name", text: "x" }, { id: "fine", text: "" }, { id: "twice", text: "a" }, { id: "twice", text: "b" }],
      facts: { "Bad": "line", fine_name: "" },
      reacts: [{ to: "flag nothing_leaves_this", then: "x" }, { to: "ended no_such_story", then: "x" }, { to: `ended ${FUEL} no_such_ending`, then: "x" }, { to: "chance 50", then: "x" }, { to: "seen start", then: "y" }, { then: "no condition" }, { to: `flag aft_hold_sealed and ended ${FUEL} seal_the_hold`, then: "fine" }],
    },
  };
  try {
    const problems = notesProblems(factsLeft(loadScenes().scenes));
    assert.ok(!problems.some((one) => !one.startsWith("test_bad")), "the real stories are sound");
    const expect = (pattern) => assert.ok(problems.some((one) => pattern.test(one)), `${pattern}\n${problems.join("\n")}`);
    expect(/test_bad, outcome 1 needs a name/);
    expect(/test_bad, outcome 2: an ending's name is lowercase/);
    expect(/test_bad, outcome 3 \(fine\) has no text/);
    expect(/test_bad, outcome 5: two endings are called twice/);
    expect(/test_bad, facts: a fact's name is lowercase letters, digits and underscores, not Bad/);
    expect(/test_bad, facts: fine_name needs a line/);
    expect(/test_bad, reacts 1: nothing leaves the fact nothing_leaves_this/);
    expect(/test_bad, reacts 2: there's no story called no_such_story/);
    expect(/test_bad, reacts 3: crew_test_leak has no ending called no_such_ending\. Its endings are patch_it/);
    expect(/test_bad, reacts 4: a story can't react to "chance"/);
    expect(/test_bad, reacts 5: a story can't react to "seen"/);
    expect(/test_bad, reacts 6 is written/);
    assert.ok(!problems.some((one) => /reacts 7/.test(one)), problems.join("\n"));
    assert.equal(problems.filter((one) => one.startsWith("test_bad")).length, 12, problems.join("\n"));
  } finally {
    delete WORLD_THREADS.test_bad;
  }
});

test("a scene can ask how a story ended, by name or any way, and the game answers from the record", () => {
  assert.ok(parseCondition("ended no_such_story").problems.some((one) => /no story called no_such_story/.test(one)));
  assert.ok(parseCondition("ended crew_test_leak no_such_ending").problems.some((one) => /no ending called no_such_ending/.test(one)));
  assert.ok(parseCondition("ended crew_test_leak seal_the_hold extra").problems.some((one) => /takes a story's id/.test(one)));
  assert.deepEqual(parseCondition("ended crew_test_leak seal_the_hold").problems, []);
  assert.deepEqual(parseCondition("not ended crew_test_leak and flag aft_hold_sealed").problems, []);
  const game = newGame();
  assert.equal(conditionHolds(game, "ended crew_test_leak"), false);
  assert.equal(conditionHolds(game, "not ended crew_test_leak"), true);
  endStory(game, { id: FUEL, ending: "seal_the_hold", summary: "The hold, shut." });
  assert.equal(conditionHolds(game, "ended crew_test_leak"), true);
  assert.equal(conditionHolds(game, "ended crew_test_leak seal_the_hold"), true);
  assert.equal(conditionHolds(game, "ended crew_test_leak patch_it"), false);
  assert.equal(conditionHolds(game, "not ended crew_test_leak patch_it"), true);
  assert.equal(endedWith(game, INQUIRY), false);
  game.story.threads[INQUIRY] = "done";
  assert.equal(endedWith(game, INQUIRY), true, "a story the clock ran out on is over, any way");
  assert.equal(endedWith(game, INQUIRY, "captain_blamed"), false);
});

test("the written story ends its story by name: the record, the quest and the Leads menu agree, and the checker knows the names", () => {
  assert.deepEqual(parseEffect("ending patch_it: Patched by hand.").do, { ending: "patch_it", text: "Patched by hand." });
  assert.deepEqual(parseEffect("ending ignored failed: You let it run.").do, { ending: "ignored", failed: true, text: "You let it run." });
  assert.ok(parseEffect("ending: no name").problem);
  assert.ok(parseEffect("ending patch_it").problem);
  assert.ok(parseEffect("ending patch_it badly: words").problem);
  const { scene, problems } = parseSceneText("== start\nThe clamp.\n* ending patch_it: Patched by hand.\nEND");
  assert.deepEqual(problems, []);
  assert.deepEqual(sceneProblems(scene, `thread_${FUEL}`), []);
  assert.ok(sceneProblems(scene, `thread_${INQUIRY}`).some((one) => /crew_test_inquiry has no ending called patch_it/.test(one)));
  assert.ok(sceneProblems(scene, "opening_captain").some((one) => /story's own scene/.test(one)));
  assert.ok(sceneProblems(scene, "talk_marrow", { talk: true }).some((one) => /story's own scene/.test(one)));

  const game = newGame();
  runTool(game, "add_quest", { id: FUEL, title: "The Test Leak", description: "A leak.", objective: "Find the leak." }, newTurnLimits());
  const notices = [];
  writtenTurn({ game, playerText: "I look into this", threadId: FUEL, emit: (line) => { if (line.type === "notice") notices.push(line.text); }, log: quiet(game).log, scenes: { [`thread_${FUEL}`]: scene } });
  assert.equal(endingOf(game, FUEL).ending, "patch_it");
  assert.equal(endingOf(game, FUEL).summary, "Patched by hand.");
  const quest = game.quests.find((one) => one.id === FUEL);
  assert.equal(quest.status, "completed");
  assert.equal(quest.objective, "Patched by hand.");
  assert.equal(game.story.threads[FUEL], "done");
  assert.ok(notices.includes("[STORY] The Test Leak has ended: Patched by hand."), notices.join("\n"));
  assert.equal(recordView(game).endings[0].ending, "patch_it");

  const lost = parseSceneText("== start\nThe line.\n* ending let_it_run failed: You let it run.\nEND").scene;
  const other = newGame();
  runTool(other, "add_quest", { id: FUEL, title: "The Test Leak", description: "x", objective: "y" }, newTurnLimits());
  writtenTurn({ other, game: other, playerText: "I look into this", threadId: FUEL, ...quiet(other), scenes: { [`thread_${FUEL}`]: lost } });
  assert.equal(other.quests.find((one) => one.id === FUEL).status, "failed");
  assert.equal(endingOf(other, FUEL).failed, true);
  assert.equal(publicStateEnding(other), "let_it_run");
});

const publicStateEnding = (game) => recordView(game).endings[0].ending;

test("a story's notes name its endings and facts, and its reactions are read against the record", () => {
  const thread = WORLD_THREADS[INQUIRY];
  assert.ok(endingsOf(thread).some((one) => one.id === "captain_blamed" && /^If the inquiry blames the captain/.test(one.text)));
  assert.equal(thread.gm.facts.inquiry_closed, "The inquiry into the leak is closed.");
  assert.equal(thread.gm.reacts.length, 4);
  const game = newGame();
  const holding = (id, on = game) => (WORLD_THREADS[id].gm.reacts ?? []).filter((one) => conditionHolds(on, one.to)).map((one) => one.then);
  assert.equal(holding(FUEL).length, 0, "nothing on the record yet");
  assert.deepEqual(holding(INQUIRY), ["The leak isn't settled yet, so the inquiry has nothing to ask about."], "a reaction to a story not ended yet");
  endStory(game, { id: FUEL, ending: "seal_the_hold", summary: "The hold, shut." });
  assert.deepEqual(holding(INQUIRY), ["The hold is sealed, so the inquiry begins at a shut door."], "only the reactions that hold");
  recordFact(game, { id: "marrow_owed", from: `thread_${FUEL}` });
  assert.ok(holding(INQUIRY).some((line) => /^Chief Marrow is owed a favour/.test(line)), "and a reaction to a fact");
  recordFact(game, { id: "inquiry_closed", from: `thread_${INQUIRY}` });
  assert.deepEqual(holding(FUEL), ["The inquiry is already closed, so nobody asks afterwards who mended what."]);
});

test("a fact a scene leaves without words shows the line the story's notes give it", () => {
  const game = newGame();
  recordFact(game, { id: "aft_hold_sealed", from: `thread_${FUEL}` });
  assert.equal(recordView(game).facts.find((fact) => fact.id === "aft_hold_sealed").text, FACT_LINES.aft_hold_sealed);
  recordFact(game, { id: "marrow_owed", text: "The scene's own words win.", from: `thread_${FUEL}` });
  assert.equal(recordView(game).facts.find((fact) => fact.id === "marrow_owed").text, "The scene's own words win.");
});
