// The story clock reads the record: a stage can wait on a condition, two stages on one day can be a fork, a
// consequence follows from how a story ended days later, stages and consequences leave facts, and the checker
// reads all of it.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { INQUIRY, LEAK, useTestWorld } from "./fixtures/test-world.mjs";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-clock-"));
process.env.GAME_DATA_DIR = dataDir;
// The stories whose clocks these tests watch are the tests' own (test/fixtures): a leak with three consequences,
// and the inquiry after it, whose second stage is a fork on how the leak ended.
useTestWorld();

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { clearFact, endStory, endingOf, recordFact } = await import("../src/record.js");
const { passTime } = await import("../src/rules.js");
const { fillStores } = await import("../src/logistics.js");
const { allStoryProblems } = await import("../src/scenes.js");
const { clockFacts, clockProblems, hasMovedOn, leadNow } = await import("../src/story-clock.js");
const { STORY_CLOCK, WORLD_THREADS } = await import("../src/world.js");

const FUEL = LEAK;
const COUNCIL = INQUIRY;
const newGame = (seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story so far." });
  return game;
};
const days = (game, count) => passTime(game, 24 * count, "routine");
// Keeps the ship out of trouble, so that only what's being tested gets a say.
function comfortable(game) {
  // Every store in her rooms full (food, medicine, parts and the generator's cells), the tank full, and morale steady.
  fillStores(game, "meridian");
  game.ship.fuel = game.ship.maxFuel;
  game.ship.morale = 60;
}
// A day at a time until something's happened, with nobody in charge of anything.
function until(game, reached, limit = 400) {
  for (let day = 0; day < limit; day += 1) {
    if (reached()) return day;
    comfortable(game);
    days(game, 1);
  }
  assert.fail(`It still hadn't happened after ${limit} days.`);
}
const moved = (game, pattern) => (game.story.clock?.moved ?? []).filter((entry) => pattern.test(entry.text));

test("the clock's conditions, facts and consequences pass the checker, and the examples are in the file", () => {
  assert.deepEqual(clockProblems(), []);
  assert.deepEqual(allStoryProblems().problems, []);
  assert.ok(clockFacts().includes("marrow_called_it_in"), "the checker knows the clock leaves it");
  assert.equal(STORY_CLOCK.threads[FUEL].consequences.length, 3);
  assert.equal(STORY_CLOCK.threads[COUNCIL].stages.filter((stage) => stage.if).length, 2, "the inquiry's second stage is a fork");
});

test("the checker names what's wrong in the clock, in plain words", () => {
  const entry = STORY_CLOCK.threads[COUNCIL];
  entry.stages[0].if = "seen start and flag nothing_leaves_this";
  entry.consequences = [
    { of: "ended no_such_story", after: -1 },
    { of: "flag kessara_closed", after: 3, news: "x", place: "nowhere", facts: { Bad: "" }, ending: "no_such_ending" },
    { after: 3, news: "No condition." },
  ];
  try {
    const problems = clockProblems(new Set(["kessara_closed"]));
    const expect = (pattern) => assert.ok(problems.some((one) => pattern.test(one)), `${pattern}\n${problems.join("\n")}`);
    expect(/^crew_test_inquiry, stage 1: the clock can't look at "seen"/);
    expect(/stage 1: nothing leaves the fact nothing_leaves_this/);
    expect(/consequence 1: there's no story called no_such_story/);
    expect(/consequence 1 needs "after"/);
    expect(/consequence 1 needs "news"/);
    expect(/consequence 2: there's no place called nowhere/);
    expect(/consequence 2: a fact's name is lowercase letters, digits and underscores, not Bad/);
    expect(/consequence 2: the fact Bad needs a line/);
    expect(/consequence 2: crew_test_inquiry has no ending called no_such_ending/);
    expect(/consequence 3 needs "of": a condition, written as in a scene, such as ended crew_test_inquiry /);
    assert.equal(problems.length, 10, problems.join("\n"));
  } finally {
    delete entry.stages[0].if;
    delete entry.consequences;
  }
});

test("a stage with a condition is skipped when it doesn't hold, and the fork's other stage happens the same midnight", () => {
  // The inquiry comes after the leak, so its clock starts once the leak is over, whichever way.
  const sealed = newGame();
  comfortable(sealed);
  days(sealed, 3);
  assert.equal(sealed.story.clock.threads[COUNCIL], undefined, "the story before it isn't over, so its clock hasn't started");
  endStory(sealed, { id: FUEL, ending: "seal_the_hold", summary: "The hold, shut." });
  until(sealed, () => (sealed.story.clock?.threads[COUNCIL]?.stage ?? 0) >= 3);
  assert.deepEqual(sealed.story.clock.threads[COUNCIL].skipped, [1], "the stage that blames nobody was skipped");
  assert.equal(moved(sealed, /wants the Aft Holds opened again/).length, 1);
  assert.equal(moved(sealed, /found nobody to blame/).length, 0);
  assert.match(leadNow(sealed, COUNCIL), /wants the Aft Holds opened/);
  assert.ok(hasMovedOn(sealed, COUNCIL));
  assert.equal(sealed.flags.inquiry_closed, undefined, "and the skipped stage left nothing");

  const patched = newGame(22);
  comfortable(patched);
  endStory(patched, { id: FUEL, ending: "patch_it", summary: "Patched by hand." });
  until(patched, () => (patched.story.clock?.threads[COUNCIL]?.stage ?? 0) >= 3);
  assert.deepEqual(patched.story.clock.threads[COUNCIL].skipped, [2], "the other way round");
  assert.equal(moved(patched, /found nobody to blame/).length, 1);
  assert.equal(moved(patched, /wants the Aft Holds opened again/).length, 0);
  assert.match(leadNow(patched, COUNCIL), /closed its book with nobody blamed/);
  assert.equal(patched.flags.inquiry_closed, true, "the stage that happened left its fact");
});

test("a consequence follows from how a story ended, about that many days later, once, and leaves its facts", () => {
  const game = newGame();
  comfortable(game);
  days(game, 10);
  assert.equal(game.story.clock.consequences?.[`${FUEL}:0`], undefined, "nothing's ended yet");
  endStory(game, { id: FUEL, ending: "seal_the_hold", summary: "The hold, shut." });
  until(game, () => game.story.clock.consequences?.[`${FUEL}:0`]?.done !== undefined);
  const fired = game.story.clock.consequences[`${FUEL}:0`];
  assert.ok(fired.done - fired.since >= 5 && fired.done - fired.since <= 9, `about a week later, not ${fired.done - fired.since} days`);
  assert.equal(moved(game, /The Aft Holds are still shut a week on/).length, 1);
  assert.equal(game.flags.aft_hold_sealed, true);
  assert.equal(game.story.record.facts.find((fact) => fact.id === "aft_hold_sealed").text, "The Aft Holds are sealed since the leak.");
  assert.equal(game.story.clock.consequences[`${FUEL}:1`], undefined, "Marrow's favour isn't called in: he never mended it");
  assert.equal(game.story.clock.threads[FUEL].stage, 0, "a story that's over doesn't move on by itself");
  assert.equal(moved(game, /has started to drip/).length, 0);
  for (let day = 0; day < 40; day += 1) {
    comfortable(game);
    days(game, 1);
  }
  assert.equal(game.story.clock.consequences[`${FUEL}:0`].done, fired.done, "it happened once, on that day");
  assert.ok(moved(game, /The Aft Holds are still shut a week on/).length <= 1, "and never again, though the list of what's moved on only keeps the last thirty");
  assert.equal(moved(game, /The patch on the line/).length, 0);
});

test("a consequence whose condition stops holding starts its count over", () => {
  const entry = STORY_CLOCK.threads[COUNCIL];
  entry.consequences = [{ of: "flag test_fact", after: 5, news: "Test news for the clock, long enough to be read.", facts: { test_fact_followed: "The test fact was followed up." } }];
  try {
    const game = newGame();
    comfortable(game);
    recordFact(game, { id: "test_fact" });
    days(game, 2);
    assert.ok(game.story.clock.consequences[`${COUNCIL}:0`].since >= 0);
    clearFact(game, "test_fact");
    for (let day = 0; day < 12; day += 1) {
      comfortable(game);
      days(game, 1);
    }
    assert.equal(game.story.clock.consequences[`${COUNCIL}:0`], undefined, "the count was dropped");
    assert.equal(moved(game, /Test news/).length, 0);
    recordFact(game, { id: "test_fact" });
    until(game, () => game.story.clock.consequences[`${COUNCIL}:0`]?.done !== undefined, 20);
    assert.equal(moved(game, /Test news/).length, 1);
    assert.equal(game.flags.test_fact_followed, true);
  } finally {
    delete entry.consequences;
  }
});

test("a stage can leave facts and end its story by name, and a story that's taken up stops its clock", () => {
  WORLD_THREADS.test_clock = { title: "A Test Story", kind: "crew", places: ["haven"], minLevel: 1, after: null, people: [], factions: [], lead: "Something's up.", gm: { truth: "x", beats: [], routes: [], checks: [], fights: [], outcomes: [{ id: "settled", text: "It settled itself." }], rewards: "none" } };
  STORY_CLOCK.threads.test_clock = { stages: [{ after: 3, news: "The test story settled itself, with nobody there to see it.", lead: "It's over, and you weren't there. Somebody will want to know why.", facts: { test_story_settled: "The test story settled itself." }, ending: "settled" }] };
  try {
    const game = newGame();
    comfortable(game);
    until(game, () => (game.story.clock?.threads.test_clock?.stage ?? 0) >= 1, 20);
    assert.equal(game.flags.test_story_settled, true);
    assert.equal(endingOf(game, "test_clock").ending, "settled");
    assert.equal(endingOf(game, "test_clock").summary, "The test story settled itself, with nobody there to see it.");
    assert.equal(game.story.threads.test_clock, "done");
    const taken = newGame(23);
    comfortable(taken);
    taken.story.threads.test_clock = "active";
    for (let day = 0; day < 10; day += 1) {
      comfortable(taken);
      days(taken, 1);
    }
    assert.equal(taken.story.clock?.threads.test_clock, undefined, "in the player's hands, so its clock never started");
    assert.equal(endingOf(taken, "test_clock"), null);
  } finally {
    delete WORLD_THREADS.test_clock;
    delete STORY_CLOCK.threads.test_clock;
  }
});
