// The record: how each story ended and the lasting facts that left, kept in the save, written by the written story's
// flags and by the AI's two checked actions, shown on the Quests page, and read by the AI in its state.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-record-"));
process.env.GAME_DATA_DIR = dataDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { clearFact, endingOf, recordEnding, recordFact, recordOf, recordView } = await import("../src/record.js");
const { publicState } = await import("../src/rules.js");
const { parseEffect, parseSceneText } = await import("../src/scene-text.js");
const { sceneProblems, writtenTurn } = await import("../src/scenes.js");
const { newTurnLimits, runTool } = await import("../src/tools.js");

const FUEL = "main_two_weeks_of_fuel";
const newGame = (seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = "captain";
  return createGameFromDraft(draft);
};
const tool = (game, name, input, turn = newTurnLimits()) => runTool(game, name, input, turn);

test("a fact has a short name and a line, sets its flag, and keeps its first words", () => {
  const game = newGame();
  const { entry, known } = recordFact(game, { id: "kessara_closed", text: "Kessara Drift is closed to the fleet.", from: "thread_main_two_weeks_of_fuel" });
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
  const ending = recordEnding(game, { id: FUEL, ending: "sign_with_quill", summary: "Signed with Mother Quill: forty-one markers, to be named later." });
  assert.equal(ending.day, 1);
  assert.equal(endingOf(game, FUEL).ending, "sign_with_quill");
  recordEnding(game, { id: FUEL, ending: "raid_depot", summary: "Another." });
  assert.equal(endingOf(game, FUEL).ending, "sign_with_quill", "the first ending is the one that's kept");
  recordFact(game, { id: "signed_with_quill", text: "The fleet signed Mother Quill's page.", from: "thread_main_two_weeks_of_fuel" });
  const shown = publicState(game).story.record;
  assert.equal(shown.endings[0].title, "Two Weeks of Fuel");
  assert.equal(shown.endings[0].ending, "sign_with_quill");
  assert.equal(shown.endings[0].failed, false);
  assert.equal(shown.endings[0].summary, "Signed with Mother Quill: forty-one markers, to be named later.");
  assert.deepEqual(shown.facts[0], { id: "signed_with_quill", text: "The fleet signed Mother Quill's page.", from: "Two Weeks of Fuel", day: 1 });
});

test("a story's quest settled the old way still records its ending", () => {
  const game = newGame();
  tool(game, "add_quest", { id: FUEL, title: "Two Weeks of Fuel", description: "Fuel.", objective: "Find fuel." });
  tool(game, "update_quest", { id: FUEL, status: "completed", objective: "Signed with Mother Quill." });
  assert.equal(endingOf(game, FUEL).summary, "Signed with Mother Quill.");
  assert.equal(endingOf(game, FUEL).ending, null);
  tool(game, "add_quest", { id: "main_visiting_hours", title: "Visiting Hours", description: "x", objective: "y" });
  tool(game, "update_quest", { id: "main_visiting_hours", status: "failed", objective: "Lost." });
  assert.equal(endingOf(game, "main_visiting_hours").failed, true);
  tool(game, "add_quest", { id: "the_beacon_two", title: "Not a story", description: "x", objective: "y" });
  tool(game, "update_quest", { id: "the_beacon_two", status: "failed", objective: "Over." });
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

