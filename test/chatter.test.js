// Chatter (step 6 of the furniture plan): what people near the player say to nobody in particular, from
// world/chatter.txt by moment (src/chatter.js), sent with the room view (src/walk.js) and said over their heads now and
// then by the room's picture (public/iso.js). Reads the game's own files, writes nothing of them.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-chatter-"));

const { chatterNext } = await import("../public/iso.js");
const { addWounds, keyAt, newWound, woundKindsByName } = await import("../src/body.js");
const { chatterModel, LONGEST, linesFor, MOMENTS, momentsFor, parseChatter, placeMoments } = await import("../src/chatter.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { startFire } = await import("../src/emergencies.js");
const { damagePart, systemsOf } = await import("../src/systems.js");
const { walkCommand, walkView } = await import("../src/walk.js");

const newGame = (hours = 12.6) => {
  const game = createGameFromDraft(randomDraft({ seed: 21, archetype: "officer" }));
  game.scene = null;
  game.clock.hours = hours;
  return game;
};
const goTo = (game, room) => {
  for (let i = 0; i < 5 && walkView(game).here?.id !== room; i += 1) walkCommand(game, { action: "go", to: `room:${room}` });
  assert.equal(walkView(game).here?.id, room);
};
const someone = (game, key) => walkView(game).people.find((one) => one.key === key);

test("the chatter file reads with nothing wrong, and says what's wrong with one that isn't", () => {
  const model = chatterModel();
  assert.deepEqual(model.problems, []);
  for (const name of MOMENTS) assert.ok(model.moments[name]?.length, `${name} has lines`);
  for (const lines of Object.values(model.moments)) for (const line of lines) assert.ok(line.length <= LONGEST, line);
  const bad = parseChatter(["- said before any moment", "Eating:", "- Soup.", "Weather:", "- Rain.", "Eating:", "- More soup.", "just words", `Hurt:`, `- ${"x".repeat(LONGEST + 1)}`, "-"].join("\n"));
  assert.deepEqual(bad.moments.Eating, ["Soup.", "More soup."]);
  const said = bad.problems.join("\n");
  for (const words of ["before any moment", "no moment called \"Weather\"", "Eating is here twice", "neither a moment", "more than the 60", "a dash with nothing"]) assert.ok(said.includes(words), words);
});

test("what's true for someone: what they're doing, their room, their hurts, and the ship", () => {
  const game = newGame();
  goTo(game, "mess");
  const voss = someone(game, "voss");
  assert.ok(momentsFor(game, "meridian", voss).has("Eating"), "eating at lunch");
  assert.ok(!momentsFor(game, "meridian", voss).has("At night"));
  game.clock.hours = 23;
  assert.ok(placeMoments(game, "meridian").has("At night"));
  game.clock.hours = 12.6;
  // The ship's troubles are everyone's.
  game.ship.morale = 20;
  game.ship.out.food = 1;
  game.battles = { mutiny: { hours: game.clock.hours - 30 } };
  game.dead = { someone: { who: "someone", place: "meridian", at: game.clock.hours - 5 } };
  const day = Math.floor((game.clock.hours * 60) / 1440);
  game.logistics.meridian ??= {};
  game.logistics.meridian.meals = { days: { [day]: { served: 300, missed: 200 } } };
  for (const name of ["Low morale", "Short of food", "After the mutiny", "Someone died", "Hungry"]) assert.ok(placeMoments(game, "meridian").has(name), name);
  game.battles.mutiny.hours = game.clock.hours - 200;
  assert.ok(!placeMoments(game, "meridian").has("After the mutiny"), "five days on, it's not the talk any more");
  // The room and the person.
  damagePart(game, "meridian", Object.values(systemsOf("meridian").parts).find((part) => part.kind === "junction box" && part.room === "names").id, "cut");
  startFire(game, "meridian", "mess");
  addWounds(game, keyAt("meridian", "voss"), [newWound(woundKindsByName("bruise")[0] ?? woundKindsByName("burn")[0], "left_arm")]);
  const now = momentsFor(game, "meridian", someone(game, "voss"));
  for (const name of ["Fire here", "No power", "In the dark", "Hurt", "Fire aboard"]) assert.ok(now.has(name), name);
});

test("someone says something from the most particular moments true for them, and nobody asleep, laid up or talking does", () => {
  const game = newGame();
  goTo(game, "mess");
  const voss = someone(game, "voss");
  const model = chatterModel();
  const lines = linesFor(game, "meridian", voss);
  assert.ok(lines.length >= 1 && lines.length <= 2);
  assert.ok(model.moments.Eating.includes(lines[0]), "at lunch, about lunch first");
  // The same for half an hour of the clock.
  assert.deepEqual(linesFor(game, "meridian", voss), lines);
  // A fire in the room is talked about before anything else.
  startFire(game, "meridian", "mess");
  assert.ok(model.moments["Fire here"].includes(linesFor(game, "meridian", someone(game, "voss"))[0]));
  assert.deepEqual(linesFor(game, "meridian", { ...voss, asleep: true }), []);
  assert.deepEqual(linesFor(game, "meridian", { ...voss, down: true }), []);
  game.talk = { key: "voss" };
  assert.deepEqual(linesFor(game, "meridian", voss), []);
});

test("only those near the player have anything to say in the room view", () => {
  const game = newGame();
  goTo(game, "mess");
  const view = walkView(game);
  const near = (one) => Math.abs(one.x - view.captain.x) / 2 + Math.abs(one.y - view.captain.y) <= 10;
  assert.ok(view.people.some((one) => one.chatter?.length), "someone near has something to say");
  for (const one of view.people) if (!near(one)) assert.equal(one.chatter, undefined, `${one.key} is too far to hear`);
});

test("the picture lets one or two speak at a time, someone on the screen, not the same one again soon", () => {
  const talk = { shown: [], next: 0, said: new Map(), last: new Map() };
  const people = [{ key: "a", chatter: ["One.", "Two."] }, { key: "b", chatter: ["Three."] }, { key: "c", chatter: ["Far."] }, { key: "d" }];
  const seen = new Set(["a", "b", "d"]);
  let roll = 0;
  const random = () => (roll++ % 5) / 5;
  const first = chatterNext(talk, people, seen, 1000, random);
  assert.ok(first && ["a", "b"].includes(first.key), "someone on the screen with something to say");
  assert.equal(chatterNext(talk, people, seen, 1500, random), null, "not again so soon");
  const second = chatterNext(talk, people, seen, talk.next, random);
  assert.ok(second && second.key !== first.key, "someone else");
  assert.equal(talk.shown.length, 2);
  assert.equal(chatterNext(talk, people, seen, talk.next, random), null, "two at most at once, and nobody else on the screen");
  // When their lines are done, and the wait's over, the first can speak again, with their other line.
  const later = talk.next + 30000;
  const again = chatterNext(talk, [people[0]], new Set(["a"]), later, random);
  assert.equal(again.key, "a");
  if (first.key === "a") assert.notEqual(again.text, first.text);
});

test("the clock's tick stays small: lines come only with the tick that crosses a half hour of the clock", async () => {
  const { walkTick } = await import("../src/walk.js");
  const game = newGame(12.6);
  goTo(game, "mess");
  game.clock.hours = 12.9;
  const quiet = walkTick(game, { ms: 500, rate: 10 });
  assert.equal(quiet.chatter, undefined);
  assert.ok(quiet.people.every((one) => one.chatter === undefined), "nothing said in a tick inside a half hour");
  game.clock.hours = 12.99;
  const turning = walkTick(game, { ms: 500, rate: 300 });
  assert.equal(turning.chatter, true);
  assert.ok(turning.people.some((one) => one.chatter?.length), "the tick that crosses 13:00 brings what people would say now");
});
