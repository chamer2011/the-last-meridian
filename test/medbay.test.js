// Down where they fell, and the medics come (health step 4): someone beaten or too weak to stand lies where they fell
// instead of vanishing, a nurse walks out from the medbay, carries them back and lays them on a free cot (the floor when
// the cots are full), they get up when they can and the cot's free, the watch bill covers them, the player knocked out
// aboard comes to on a cot with what they had, and the player can carry someone and put them down on a cot.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-medbay-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const body = await import("../src/body.js");
const medbay = await import("../src/medbay.js");
const { clockRuns, combatAction, startCombat } = await import("../src/rules.js");
const { attackPerson, afterDeedFight } = await import("../src/deeds.js");
const { lostReason } = await import("../src/command.js");
const { mapFor, walkCommand, walkView } = await import("../src/walk.js");
const health = await import("../public/health-text.js");

const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "marine" }));
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const MAP = mapFor("meridian");
const inRoom = (game, room) => {
  game.walk = null;
  walkCommand(game, { action: "room", to: room });
  clockRuns(game, 1);
};
const person = (game, key) => walkView(game).people.find((one) => one.key === key);
const roomOf = (game, key) => {
  const state = game.life.places.meridian[key];
  return MAP.levels[state.level].roomAt(state.x, state.y);
};
function beat(game, who) {
  attackPerson(game, { key: who, id: null, name: who, short: who }, { place: "meridian", room: "mess" });
  let outcome;
  let rounds = 0;
  do {
    game.hp = 999;
    outcome = combatAction(game, { type: "attack" });
    rounds += 1;
  } while (!outcome.over && rounds < 200);
  return [outcome, afterDeedFight(game, outcome)];
}
function minutes(game, n) {
  const said = [];
  for (let i = 0; i < n; i += 1) said.push(...(clockRuns(game, 1) ?? []));
  return said;
}

test("the medbay's file reads, and says what's wrong with a line", () => {
  const meridian = medbay.medbayOf("meridian");
  assert.equal(meridian.room, "medbay");
  assert.deepEqual(meridian.cots, ["patient-1", "patient-2", "patient-3", "patient-4"]);
  assert.deepEqual(meridian.answers, ["nurse", "spare"]);
  assert.equal(medbay.medbayOf("haven"), null);
  assert.match(health.MEDBAY_KEYS.cots.read("").problem, /spots/);
  assert.deepEqual(body.healthProblems(), []);
});

test("someone beaten lies where they fell, a nurse carries them to a cot, and they get up when they can", () => {
  const game = newGame();
  inRoom(game, "mess");
  const [outcome, said] = beat(game, "Mess Hand Bao");
  assert.equal(outcome.result, "victory");
  assert.deepEqual(said, ["[COMBAT] Mess Hand Bao lies where they fell."]);
  const fell = person(game, "Mess Hand Bao");
  assert.ok(fell, "still in the room, not gone to get patched up");
  assert.equal(fell.down, true);
  assert.match(fell.downLook, /^Lying where they fell/);
  assert.equal(lostReason(game, "meridian", "Mess Hand Bao"), "down", "and the watch bill knows");
  // The call goes out, and the nurse walks over and carries them back.
  const notes = [];
  let helper = null;
  let carried = false;
  for (let i = 0; i < 60 && !game.down["crowd:meridian:mess hand bao"].bed; i += 1) {
    notes.push(...(clockRuns(game, 1) ?? []));
    const d = game.down["crowd:meridian:mess hand bao"];
    helper ??= d.call?.by ?? null;
    carried ||= Boolean(d.carriedBy);
  }
  assert.match(helper, /^Nurse /);
  assert.ok(carried, "carried, not teleported");
  assert.ok(notes.some((note) => /sets off from the medbay for Mess Hand Bao/.test(note)));
  assert.ok(notes.some((note) => /lays Mess Hand Bao on a cot in the medbay/.test(note)));
  const d = game.down["crowd:meridian:mess hand bao"];
  assert.match(d.bed, /^patient-[34]$/, "on a free cot, not Vik's or Hana's");
  assert.equal(roomOf(game, "Mess Hand Bao"), "medbay");
  assert.equal(lostReason(game, "meridian", "Mess Hand Bao"), "laid up in the medbay");
  // Still bleeding from a deep cut, they stay on the cot; with nothing worse than a bruise, they get up once the beating's
  // time is up, and the cot's free.
  game.bodies["crowd:meridian:mess hand bao"] = { wounds: [{ ...body.newWound(body.kindOf("deep_cut", "chest"), "chest"), at: game.clock.hours, until: game.clock.hours + 400 }], blood: 80 };
  minutes(game, 4 * 60);
  assert.ok(game.down["crowd:meridian:mess hand bao"]?.bed, "bleeding, they stay laid up");
  game.bodies["crowd:meridian:mess hand bao"] = { wounds: [{ ...body.newWound(body.kindOf("bruise", "chest"), "chest"), at: game.clock.hours, until: game.clock.hours + 40 }] };
  minutes(game, 5);
  assert.equal(game.down["crowd:meridian:mess hand bao"], undefined);
  assert.equal(medbay.freeCot(game, "meridian"), "patient-3");
});

test("someone too weak to stand goes down where they are, and the floor takes them when the cots are full", () => {
  const game = newGame();
  inRoom(game, "mess");
  game.bodies["crowd:meridian:mess hand lotte"] = { wounds: [], blood: 30 };
  const said = minutes(game, 1);
  assert.ok(said.some((note) => /Mess Hand Lotte goes down, too weak to stand/.test(note)));
  assert.equal(game.down["crowd:meridian:mess hand lotte"].why, "too weak to stand");
  // Fill the two free cots, and the next one goes on the floor.
  game.down["crowd:meridian:salome"] = { who: "Salome", place: "meridian", level: "deck2", x: 10, y: 9, since: 8, until: 999, why: "out cold", bed: "patient-3" };
  game.down["crowd:meridian:emeka"] = { who: "Emeka", place: "meridian", level: "deck2", x: 15, y: 6, since: 8, until: 999, why: "out cold", bed: "patient-4" };
  assert.equal(medbay.freeCot(game, "meridian"), null);
  minutes(game, 60);
  assert.equal(game.down["crowd:meridian:mess hand lotte"].bed, "@medbay");
});

test("the player knocked out aboard comes to on a cot, with what they had", () => {
  for (let seed = 1; seed < 30; seed += 1) {
    const game = newGame(seed);
    inRoom(game, "mess");
    const credits = game.credits;
    const before = game.clock.hours;
    startCombat(game, "choir_hunter");
    let outcome;
    let rounds = 0;
    do {
      game.hp = Math.min(game.hp, 2);
      outcome = combatAction(game, { type: "attack" });
      rounds += 1;
    } while (!outcome.over && rounds < 50);
    if (outcome.result !== "defeat") continue;
    assert.equal(game.credits, credits, "nothing taken");
    assert.ok(game.clock.hours - before >= 1, "hours later");
    assert.equal(walkView(game).here.id, "medbay");
    assert.match(outcome.summary, /came to in the medbay/);
    assert.ok(outcome.events.some((event) => /You come to on a cot in the medbay/.test(event.text ?? "")));
    return;
  }
  assert.fail("no defeat in thirty games");
});

test("the player can carry someone, slowly, and put them on a cot in the medbay", () => {
  const game = newGame();
  inRoom(game, "medbay");
  game.down = { "crowd:meridian:mess hand bao": { who: "Mess Hand Bao", place: "meridian", level: game.walk.level, x: game.walk.x + 1, y: game.walk.y, since: 8, until: 99, why: "out cold" } };
  clockRuns(game, 1);
  const pace = walkView(game).pace;
  assert.match(medbay.carry(game, "Mess Hand Bao"), /You pick Mess Hand Bao up/);
  assert.equal(walkView(game).pace, pace / 2, "carrying someone is slow going");
  assert.deepEqual(walkView(game).carrying, { key: "Mess Hand Bao" });
  assert.throws(() => walkCommand(game, { action: "attack", key: "aduro" }), /Put them down first/);
  clockRuns(game, 1);
  assert.equal(person(game, "Mess Hand Bao")?.carried, "you");
  assert.match(medbay.putDown(game), /on a cot/);
  assert.match(game.down["crowd:meridian:mess hand bao"].bed, /^patient-/);
  assert.equal(walkView(game).carrying, undefined);
});

test("somewhere without a medbay, someone down comes round where they fell", () => {
  const game = newGame();
  game.down = { "crowd:haven:dock hand": { who: "Dock Hand", place: "haven", level: "x", x: 1, y: 1, since: 8, until: 9, why: "out cold" } };
  game.clock.hours = 8.5;
  medbay.advanceMedbay(game);
  assert.ok(game.down["crowd:haven:dock hand"] && !game.down["crowd:haven:dock hand"].call, "nobody comes");
  game.clock.hours = 9.5;
  medbay.advanceMedbay(game);
  assert.equal(game.down["crowd:haven:dock hand"], undefined, "up again");
});

test("the same wound twice on one part reads as one line", () => {
  const game = newGame();
  const deep = body.kindOf("deep_cut", "left_arm");
  body.addWounds(game, "crowd:meridian:mess hand lotte", [body.newWound(deep, "left_arm"), body.newWound(deep, "left_arm")]);
  const lines = body.bodyView(body.bodyOf(game, { name: "Mess Hand Lotte", place: "meridian" })).lines.map((line) => line.words);
  assert.ok(lines.includes("A deep cut in the left arm, bleeding (twice)"), lines.join(" | "));
});
