// Living with wounds (health step 3): wounds bleed until they're dressed, minor ones dressed by whoever has them,
// blood comes back, wounds left undressed go bad, each heals at its own pace, a medkit dresses the player's worst, a limp
// slows anyone's walking, a hand that's no use keeps them off carrying and work, a knock on the head and low blood make
// checks harder, pain adds to stress, the hurt queue at the medbay in the morning, and now and then someone has an
// accident at work.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-living-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const body = await import("../src/body.js");
const { checkParts, clockRuns, passTime, publicState, useItem, workShift } = await import("../src/rules.js");
const { addItem } = await import("../src/rules.js");
const { peopleAboard } = await import("../src/life.js");
const { mapFor, walkCommand, walkView } = await import("../src/walk.js");
const health = await import("../public/health-text.js");
const { WORLD_CHARACTERS } = await import("../src/world.js");

const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const wound = (name, part) => body.newWound(body.kindOf(name.replace(/ /g, "_"), part), part);
const MAP = mapFor("meridian");
const everyone = (game) => Object.keys(MAP.levels).flatMap((level) => peopleAboard(game, "meridian", level).map((one) => ({ ...one, room: MAP.levels[level].roomAt(one.x, one.y), key: one.id ?? one.name })));

test("a wound bleeds until it's dressed, a small one dressed by whoever has it, and blood comes back", () => {
  const game = newGame();
  body.addWounds(game, "you", [wound("deep cut", "left_arm"), wound("cut", "chest")]);
  assert.ok(publicState(game).body.lines.some((line) => line.words === "A deep cut in the left arm, bleeding"));
  const notes = passTime(game, 2);
  assert.ok(notes.some((note) => /You dress the cut on the chest/.test(note)), "the cut, an hour in");
  assert.equal(game.blood, 100 - 12 * 2 - 4);
  passTime(game, 10);
  assert.equal(game.blood, 35, "and no lower, for now");
  assert.ok(checkParts(game, { skill: "awareness" }).parts.some((part) => part.label === "condition" && part.value === -2), "too little blood makes checks harder");
  // A medkit dresses the worst of them, and the blood comes back.
  addItem(game, "medkit");
  assert.match(useItem(game, "medkit"), /dressed the deep cut in the left arm/);
  assert.ok(publicState(game).body.lines.some((line) => line.words === "A deep cut in the left arm, dressed"));
  passTime(game, 10);
  assert.equal(game.blood, 55);
  passTime(game, 40);
  assert.equal(game.blood, undefined, "all of it, in time");
});

test("a wound left undressed goes bad, and a dressed one doesn't", () => {
  const game = newGame();
  body.addWounds(game, "you", [wound("deep cut", "left_leg"), wound("deep burn", "chest")]);
  body.dressWounds(game, "you", 1);
  const notes = passTime(game, 24 * 3);
  const bad = game.wounds.filter((one) => one.kind === "infected");
  assert.equal(bad.length, 1);
  assert.equal(bad[0].part, game.wounds.find((one) => one.kind !== "infected" && !one.dressed).part);
  assert.ok(notes.some((note) => /has gone bad/.test(note)));
  assert.ok(checkParts(game, { skill: "awareness" }).parts.some((part) => part.label === "condition" && part.value <= -2), "a wound gone bad makes checks harder");
});

test("each wound heals at its own pace: slower for a species that heals slowly, and twice as long left alone", () => {
  const game = newGame();
  const deep = body.kindOf("deep_cut", "chest");
  body.addWounds(game, "id:voss", [body.newWound(deep, "chest")]);
  const human = game.bodies["id:voss"].wounds[0];
  assert.equal(human.until - human.at, 8 * 24 * 2, "only heals once dressed, so twice as long left alone");
  const slow = Object.keys(WORLD_CHARACTERS).find((id) => WORLD_CHARACTERS[id].species === "thessan");
  assert.ok(slow, "someone with a file is a Thessan");
  body.addWounds(game, `id:${slow}`, [body.newWound(body.kindOf("bruise", "chest"), "chest")]);
  const bruise = game.bodies[`id:${slow}`].wounds[0];
  assert.equal(Math.round(bruise.until - bruise.at), Math.round((2 * 24) / 0.75), "a Thessan heals at three quarters the pace");
});

test("a limp slows anyone's walking, and a leg they can't stand on more", () => {
  const game = newGame();
  game.walk = null;
  walkCommand(game, { action: "room", to: "mess" });
  const before = walkView(game).pace;
  body.addWounds(game, "you", [wound("bruise", "right_leg")]);
  assert.equal(walkView(game).pace, 0.6);
  body.addWounds(game, "you", [wound("broken bone", "left_leg")]);
  assert.equal(walkView(game).pace, 0.3);
  assert.equal(body.statusOf(body.bodyOf(game, "you")), "Can barely walk");
  assert.ok(before === 1 || before === 0.6, "and before, as their old marks have it");
  assert.equal(body.woundsPace([{ ...wound("cut", "left_leg") }]), 0.6, "a fighter with a cut leg limps too");
});

test("a hand that's no use keeps someone off carrying and the player off work", () => {
  const game = newGame();
  assert.equal(body.handsFree(game, "meridian", "Tech Oona"), true);
  body.addWounds(game, "crowd:meridian:tech oona", [wound("broken bone", "right_arm")]);
  assert.equal(body.handsFree(game, "meridian", "Tech Oona"), false);
  body.addWounds(game, "you", [wound("broken bone", "left_arm")]);
  assert.throws(() => workShift(game), /hand that's no use|got no work/);
});

test("a knock on the head makes checks harder, and pain adds to stress", () => {
  const calm = newGame();
  const hurt = newGame();
  const base = checkParts(hurt, { skill: "awareness" }).total;
  body.addWounds(hurt, "you", [wound("concussion", "head"), wound("deep burn", "right_arm")]);
  assert.equal(checkParts(hurt, { skill: "awareness" }).total, base - 2);
  passTime(calm, 12);
  passTime(hurt, 12);
  assert.ok(hurt.needs.stress > calm.needs.stress, "the pain of a serious wound wears on them");
});

test("in the morning, whoever's hurt and on their feet waits at the medbay", () => {
  const game = newGame();
  game.walk = null;
  walkCommand(game, { action: "room", to: "medbay" });
  body.addWounds(game, "crowd:meridian:mess hand bao", [wound("bruise", "chest")]);
  for (let minute = 0; minute < 60; minute += 5) clockRuns(game, 5);
  const rafe = everyone(game).find((one) => one.key === "Mess Hand Bao");
  assert.ok(rafe, "Bao is somewhere aboard");
  assert.match(rafe.doing, /medbay queue/);
  assert.equal(rafe.room, "medbay");
  // Nobody healthy queues any more.
  const queueing = everyone(game).filter((one) => /waiting in the medbay queue/.test(one.doing ?? "")).map((one) => one.key);
  assert.deepEqual(queueing, ["Mess Hand Bao"]);
});

test("now and then someone has an accident at their work, the same in a game with the same seed", () => {
  const one = newGame();
  const two = newGame();
  two.bodySeed = one.bodySeed;
  // Leave out the wounds Vik and Hana start the game with.
  one.bodies = {};
  two.bodies = {};
  for (let day = 1; day <= 40; day += 1) {
    body.accidentsDay(one, day);
    body.accidentsDay(two, day);
  }
  assert.ok(Object.keys(one.bodies).length >= 3, "a few, in forty days");
  assert.deepEqual(one.bodies, two.bodies);
  for (const [key, held] of Object.entries(one.bodies)) {
    assert.match(key, /^(crowd:meridian:|id:)/);
    for (const kept of held.wounds) assert.match(kept.kind, /burn|cut|bruise/);
  }
  const already = JSON.stringify(one.bodies);
  body.accidentsDay(one, 40);
  assert.equal(JSON.stringify(one.bodies), already, "each day once");
});

test("the files' new lines say what's wrong with them", () => {
  assert.match(health.CARE["bleeding stops at"].read("thirty").problem, /35, for you and away from a medbay, for now/);
  assert.match(health.readQueue("in the morning").problem, /07:45 to 10:30/);
  assert.match(health.readAccidents("often").problem, /1 in 20 days/);
  assert.deepEqual(health.readAccidentLine("cut: likelier in: cook"), { name: "cut", likelier: ["cook"] });
  assert.deepEqual(body.healthProblems(), []);
});
