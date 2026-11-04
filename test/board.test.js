// The story board's side in the game: a story as the board needs it, saving a story's file through the same reader
// the game uses, and a written scene as its parts and choices, put back together line for line.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-board-"));
process.env.GAME_DATA_DIR = dataDir;
// The board writes files, so these tests work on copies of the stories and the scenes.
const worldDir = fileURLToPath(new URL("../world/", import.meta.url));
for (const folder of ["stories", "scenes"]) {
  const copy = path.join(dataDir, folder);
  fs.mkdirSync(copy);
  for (const name of fs.readdirSync(path.join(worldDir, folder))) fs.copyFileSync(path.join(worldDir, folder, name), path.join(copy, name));
  process.env[folder === "stories" ? "GAME_STORIES_DIR" : "GAME_SCENES_DIR"] = copy;
}

const { boardScene, boardStories, boardStory, checkBoardScene, saveBoardScene, saveBoardStory, sceneBoardView } = await import("../src/board.js");
const { SCENES_DIR } = await import("../src/scenes.js");
const { STORIES_DIR, STORY_CLOCK, WORLD_THREADS } = await import("../src/world.js");
const { parseStoryText, writeStoryText } = await import("../public/story-text.js");

const FUEL = "main_two_weeks_of_fuel";

test("the board lists every story, and knows which have a written scene", () => {
  const stories = boardStories();
  assert.equal(stories.length, 128);
  const fuel = stories.find((one) => one.id === FUEL);
  assert.deepEqual(fuel, { id: FUEL, title: "Two Weeks of Fuel", kind: "main", written: true });
  assert.equal(stories.find((one) => one.id === "main_who_paid").written, false);
  assert.ok(stories.every((one, i) => !i || stories[i - 1].title.localeCompare(one.title) <= 0), "in order of their titles");
});

test("a story comes with its file, what the game read, who reacts to it, and what there is to pick from", () => {
  const view = boardStory(FUEL);
  assert.equal(view.text, fs.readFileSync(path.join(STORIES_DIR, `${FUEL}.txt`), "utf8"));
  assert.equal(view.story.title, "Two Weeks of Fuel");
  assert.equal(view.clock.consequences.length, 3);
  assert.ok(view.next.some((one) => one.story === "main_the_council" && one.where.startsWith("its clock") && /take_corvanes_fuel/.test(one.to)));
  assert.ok(view.next.some((one) => one.story === "main_chain_of_command" && one.where === "its notes"));
  assert.ok(view.places.some((one) => one.id === "kessara" && one.name));
  assert.ok(view.facts.includes("kessara_closed") && view.facts.includes("told_the_fleet"));
  assert.equal(view.stories.length, 128);
  assert.deepEqual(view.stories.find((one) => one.id === FUEL).endings, ["sign_with_quill", "raid_depot", "take_corvanes_fuel", "settle_cinder_reach"]);
  assert.deepEqual(view.problems, []);
  assert.equal(view.written, true);
  assert.throws(() => boardStory("No Such"), /lowercase letters/);
  assert.throws(() => boardStory("no_such_story"), /no story called/);
});

test("saving a story writes its file and the game plays the new one, and a file that can't be read is never written", () => {
  const file = path.join(STORIES_DIR, `${FUEL}.txt`);
  const original = fs.readFileSync(file, "utf8");
  try {
    const { story, clock } = parseStoryText(original, FUEL);
    story.lead = "Chief Marrow has done the sums four times now.";
    story.gm.facts.tested_by_the_board = "The board was tested.";
    const saved = saveBoardStory(FUEL, writeStoryText(story, clock));
    assert.equal(saved.saved, true);
    assert.deepEqual(saved.problems, []);
    assert.ok(fs.readFileSync(file, "utf8").includes("Chief Marrow has done the sums four times now."));
    assert.equal(WORLD_THREADS[FUEL].lead, "Chief Marrow has done the sums four times now.", "the game holds the new story at once");
    assert.equal(WORLD_THREADS[FUEL].gm.facts.tested_by_the_board, "The board was tested.");
    assert.equal(STORY_CLOCK.threads[FUEL].consequences.length, 3);

    const refused = saveBoardStory(FUEL, "Two Weeks of Fuel\nkind: main\n\nThe Twist:\nno");
    assert.equal(refused.saved, false);
    assert.ok(refused.problems.some((one) => /line 1: the first line is the story's title/.test(one)), refused.problems.join("\n"));
    assert.ok(fs.readFileSync(file, "utf8").includes("four times now"), "the broken text wasn't written");

    const warned = saveBoardStory(FUEL, writeStoryText({ ...story, gm: { ...story.gm, reacts: [{ to: "ended no_such_story", then: "x" }] } }, clock));
    assert.equal(warned.saved, true, "a story the checker frowns on is still saved, with the problems named");
    assert.ok(warned.problems.some((one) => /reacts 1: there's no story called no_such_story/.test(one)), warned.problems.join("\n"));
    assert.throws(() => saveBoardStory("bad id", "x"), /lowercase letters/);
    assert.throws(() => saveBoardStory(FUEL, ""), /nothing to save/);
  } finally {
    fs.writeFileSync(file, original);
    saveBoardStory(FUEL, original);
  }
  assert.equal(WORLD_THREADS[FUEL].lead.slice(0, 40), "Chief Marrow has done the sums three tim");
  assert.equal(WORLD_THREADS[FUEL].gm.facts.tested_by_the_board, undefined);
});

test("a written scene comes as its parts and choices, and put back together it's the file again", () => {
  const view = boardScene(FUEL);
  const file = fs.readFileSync(path.join(SCENES_DIR, `thread_${FUEL}.txt`), "utf8");
  assert.equal(view.text, file);
  assert.ok(view.parts.length > 50);
  const start = view.parts.find((one) => one.name === "start");
  assert.ok(start.text.startsWith("Two weeks."));
  assert.equal(start.line, 8);
  const marrow = start.choices.find((one) => one.check === "engineering:moderate");
  assert.deepEqual([marrow.pass, marrow.fail, marrow.to], ["cold_pass", "cold_fail", null]);
  assert.ok(start.choices.some((one) => one.to === "to_kessara"));
  assert.ok(start.when.some((one) => one.if === "life engine_hand" && one.to === "hand_start"));
  assert.ok(view.parts.some((one) => one.fight && one.won && one.lost));
  assert.ok(view.parts.some((one) => one.end));
  assert.deepEqual(view.problems, []);
  const together = [view.header, ...view.parts.map((one) => `== ${one.name}\n${one.raw}`)].join("\n");
  assert.equal(together, file.replace(/\r\n?/g, "\n"), "line for line");
  assert.throws(() => boardScene("main_who_paid"), /no written scene yet/);
});

test("a changed scene is checked without saving, and saving writes it only when it can be read", () => {
  const file = path.join(SCENES_DIR, `thread_${FUEL}.txt`);
  const original = fs.readFileSync(file, "utf8");
  const broken = original.replace("== start", "== start\n> A choice that goes nowhere -> no_such_part");
  const checked = checkBoardScene(FUEL, broken);
  assert.ok(checked.parts.some((one) => one.name === "start" && one.choices.some((choice) => choice.to === "no_such_part")));
  assert.ok(checked.problems.some((one) => /no_such_part/.test(one)), checked.problems.join("\n"));
  assert.equal(fs.readFileSync(file, "utf8"), original, "checking saves nothing");
  try {
    const saved = saveBoardScene(FUEL, original.replace("Two weeks. Chief Marrow", "Two weeks, near enough. Chief Marrow"));
    assert.equal(saved.saved, true);
    assert.deepEqual(saved.problems, []);
    assert.ok(fs.readFileSync(file, "utf8").includes("Two weeks, near enough."));
    const unreadable = saveBoardScene(FUEL, "== start\nText.\nCHECK\n");
    assert.equal(unreadable.saved, false);
    assert.ok(unreadable.problems.length > 0);
    assert.ok(fs.readFileSync(file, "utf8").includes("Two weeks, near enough."), "the unreadable text wasn't written");
  } finally {
    fs.writeFileSync(file, original);
  }
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.throws(() => saveBoardScene("bad id", "x"), /lowercase letters/);
  const empty = sceneBoardView("", "thread_x");
  assert.deepEqual(empty.parts, []);
});
