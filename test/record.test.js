// The record: how each story ended and the lasting facts that left, kept in the save, written by the written story's
// flags and by the AI's two checked actions, shown on the Quests page, and read by the AI in its state.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { INQUIRY, LEAK, useTestWorld } from "./fixtures/test-world.mjs";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-record-"));
process.env.GAME_DATA_DIR = dataDir;
// The stories these tests end are the tests' own (test/fixtures), in a copy of the world that has them.
useTestWorld();

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { clearFact, endingOf, recordEnding, recordFact, recordOf, recordView } = await import("../src/record.js");
const { publicState } = await import("../src/rules.js");
const { parseEffect, parseSceneText } = await import("../src/scene-text.js");
const { sceneProblems, writtenTurn } = await import("../src/scenes.js");
const { newTurnLimits, runTool } = await import("../src/tools.js");

const FUEL = LEAK;
const newGame = (seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = "captain";
  return createGameFromDraft(draft);
};
const tool = (game, name, input, turn = newTurnLimits()) => runTool(game, name, input, turn);

test("a fact has a short name and a line, sets its flag, and keeps its first words", () => {
  const game = newGame();
  const { entry, known } = recordFact(game, { id: "kessara_closed", text: "Kessara Drift is closed to the fleet.", from: `thread_${LEAK}` });
  assert.equal(known, false);
  assert.equal(game.flags.kessara_closed, true);
  assert.equal(entry.day, 1);
  const again = recordFact(game, { id: "kessara_closed", text: "Different words." });
  assert.equal(again.known, true);
  assert.equal(again.entry.text, "Kessara Drift is closed to the fleet.", "the first words are kept");
  assert.equal(recordOf(game).facts.length, 1);
  const bare = recordFact(game, { id: "nobody_declares_this" });
  assert.equal(bare.entry.text, null);
  assert.throws(() => recordFact(game, { id: "Bad Name" }), /lowercase letters/);
  assert.throws(() => recordFact(game, { id: "x" }), /lowercase letters/);
  clearFact(game, "kessara_closed");
  assert.equal(game.flags.kessara_closed, undefined);
  assert.equal(recordOf(game).facts.length, 1);
  const view = recordView(game);
  assert.deepEqual(view.facts.map((fact) => fact.text), ["nobody declares this"], "a fact without words shows its name, spaced out");
});

test("a story's ending goes on the record by its name, and the page reads it", () => {
  const game = newGame();
  assert.throws(() => recordEnding(game, { id: "no_such_story", summary: "x" }), /no story/);
  assert.throws(() => recordEnding(game, { id: FUEL, ending: "no_such_ending", summary: "x" }), /no ending called no_such_ending/);
  const ending = recordEnding(game, { id: FUEL, ending: "patch_it", summary: "Patched by hand, with Naomi Cass holding the light." });
  assert.equal(ending.day, 1);
  assert.equal(endingOf(game, FUEL).ending, "patch_it");
  recordEnding(game, { id: FUEL, ending: "seal_the_hold", summary: "Another." });
  assert.equal(endingOf(game, FUEL).ending, "patch_it", "the first ending is the one that's kept");
  recordFact(game, { id: "line_patched", text: "The line was patched by hand.", from: `thread_${LEAK}` });
  const shown = publicState(game).story.record;
  assert.equal(shown.endings[0].title, "The Test Leak");
  assert.equal(shown.endings[0].ending, "patch_it");
  assert.equal(shown.endings[0].failed, false);
  assert.equal(shown.endings[0].summary, "Patched by hand, with Naomi Cass holding the light.");
  assert.deepEqual(shown.facts[0], { id: "line_patched", text: "The line was patched by hand.", from: "The Test Leak", day: 1 });
});

test("a story's quest settled the old way still records its ending", () => {
  const game = newGame();
  tool(game, "add_quest", { id: FUEL, title: "The Test Leak", description: "A leak.", objective: "Find the leak." });
  tool(game, "update_quest", { id: FUEL, status: "completed", objective: "Mended, one way or another." });
  assert.equal(endingOf(game, FUEL).summary, "Mended, one way or another.");
  assert.equal(endingOf(game, FUEL).ending, null);
  tool(game, "add_quest", { id: INQUIRY, title: "The Test Inquiry", description: "x", objective: "y" });
  tool(game, "update_quest", { id: INQUIRY, status: "failed", objective: "Lost." });
  assert.equal(endingOf(game, INQUIRY).failed, true);
  tool(game, "add_quest", { id: "not_a_story", title: "Not a story", description: "x", objective: "y" });
  tool(game, "update_quest", { id: "not_a_story", status: "failed", objective: "Over." });
  assert.equal(Object.keys(recordOf(game).endings).length, 2, "a quest that isn't a story isn't an ending");
});

test("the written story's flags join the record, with words when the line has them, and the checker names a bad flag", () => {
  assert.deepEqual(parseEffect("flag kessara_closed: Kessara is closed to the fleet").do, { set: "kessara_closed", text: "Kessara is closed to the fleet" });
  assert.deepEqual(parseEffect("flag told_the_fleet").do, { set: "told_the_fleet" });
  assert.deepEqual(parseEffect("unflag told_the_fleet").do, { clear: "told_the_fleet" });
  const { scene, problems } = parseSceneText(`== start\nThe depot's gone.\n* flag kessara_closed: Kessara is closed to the fleet\n* flag raided_the_depot_alone\n> Go on -> after\n== after\nLater.\n* unflag raided_the_depot_alone\nEND`);
  assert.deepEqual(problems, []);
  const game = newGame();
  const scenes = { thread_test: scene };
  const emit = () => {};
  const log = (role, text) => game.transcript.push({ role, text });
  writtenTurn({ game, playerText: "I look into this", threadId: "test", emit, log, scenes });
  const facts = recordView(game).facts;
  assert.deepEqual(facts.map((fact) => fact.text), ["Kessara is closed to the fleet", "raided the depot alone"]);
  assert.equal(game.flags.kessara_closed, true);
  writtenTurn({ game, playerText: "Go on", emit, log, scenes });
  assert.equal(game.flags.raided_the_depot_alone, undefined);
  assert.deepEqual(recordView(game).facts.map((fact) => fact.id), ["kessara_closed"]);
  const bad = parseSceneText("== start\nText.\n* flag Bad Name\nEND").scene;
  assert.ok(sceneProblems(bad, "t").some((problem) => /flag's name is lowercase/.test(problem)), sceneProblems(bad, "t").join(" | "));
});

test("an older save's flags join the record when it's read, and the record doesn't repeat them", () => {
  const game = newGame();
  game.flags = { old_flag_one: true, old_flag_two: true };
  delete game.story.record;
  const record = recordOf(game);
  assert.deepEqual(record.facts.map((fact) => fact.id), ["old_flag_one", "old_flag_two"]);
  assert.equal(record.facts[0].text, null);
  recordOf(game);
  assert.equal(recordOf(game).facts.length, 2);
  assert.deepEqual(recordView(game).facts.map((fact) => fact.text), ["old flag one", "old flag two"]);
});

