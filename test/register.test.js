// The 900 and sickness (health step 8): everyone aboard without a day of their own is on the register, made up from the
// game's seed; illness is caught and spreads among them, more when the ship's hungry; a serious case gets a dose from the
// medbay's cabinet, and one left without can die; the ship's health settles lower the more are sick; hunger's deaths are
// people with names; the people with days of their own catch the same illnesses as wounds; and the medbay's records
// terminal lists everyone.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-register-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const body = await import("../src/body.js");
const register = await import("../src/register.js");
const { passTime } = await import("../src/rules.js");
const { shipLedger, shipView } = await import("../src/ship.js");
const { countAboard, takeAboard } = await import("../src/logistics.js");
const { migrateGame } = await import("../src/migrate.js");
const { readNames } = await import("../src/death.js");
const { NAMES } = await import("../src/character-data.js");
const { WORLD_COMPUTERS } = await import("../src/world.js");
const health = await import("../public/health-text.js");

const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const day = (game) => Math.floor(game.clock.hours / 24);
const BAO = "crowd:meridian:mess hand bao";
// The council and the chair keep their hands off the rations, so a test's rations stand.
const leaveTheRations = (game, rations) => {
  game.ship.rations = rations;
  game.ship.council = { ...game.ship.council, off: true };
};

test("the files say how illness is caught and spreads, where the register sleeps, and what its deaths cost", () => {
  const kinds = body.illnessKinds();
  assert.deepEqual(kinds.map((one) => one.id), ["cough", "fever"]);
  const fever = kinds.find((one) => one.id === "fever");
  assert.deepEqual([fever.serious, fever.days, fever.dosed, fever.kills, fever.killsOneIn], [true, 8, 3, 5, 3]);
  assert.equal(body.hungerFactor("half"), 2);
  assert.equal(body.hungerFactor("reduced"), 1.5);
  assert.equal(body.hungerFactor("standard", 0.5), 1.5, "a kettle empty for half the sittings is halfway to half rations");
  assert.match(health.MEDBAY_KEYS.quarters.read("everywhere").problem, /The Overflow 5/);
  assert.deepEqual(health.readRule("kills 1 in 3 left untreated 5 days"), { kills: 5, killsOneIn: 3 });
});

test("a new game has the register: everyone aboard without a day of their own, made up, the same every look", () => {
  const game = newGame();
  const people = register.registerPeople(game);
  assert.equal(game.version, 28);
  assert.equal(people.length, game.ship.aboard - register.lifePeople().length);
  assert.equal(new Set(people.map((one) => one.name)).size, people.length, "nobody's name twice");
  assert.ok(!people.some((one) => NAMES.includes(one.name)), "and never one of the game's whole names");
  assert.deepEqual(register.registerPeople(game), people);
  const share = (room) => people.filter((one) => one.quarters === room).length / people.length;
  assert.ok(share("The Overflow") > 0.4 && share("The Overflow") < 0.6, "half of them in the Overflow");
  assert.ok(people.some((one) => one.age < 16) && people.some((one) => one.age > 64), "children and old people too");
  // Another game, another ship's worth of people.
  const other = newGame();
  other.bodySeed = game.bodySeed + 1;
  other.register = { ...other.register };
  assert.notEqual(register.registerPeople(other)[0].name === people[0].name && register.registerPeople(other)[1].name === people[1].name, true);
  // An older save gets one, sized to who's aboard.
  const { register: _register, ...old } = structuredClone(game);
  const migrated = migrateGame({ ...old, version: 22 });
  assert.equal(migrated.register.size, people.length);
});

test("a well-fed ship with medicine aboard stays mostly well, and a hungry one gets sicker", () => {
  const sickDays = (rations) => {
    const game = newGame();
    game.bodySeed = 11;
    leaveTheRations(game, rations);
    let total = 0;
    for (let d = 0; d < 30; d += 1) {
      passTime(game, 24, "rest");
      total += Object.keys(game.register.sick).length;
    }
    return { total, game };
  };
  const fed = sickDays("standard");
  const hungry = sickDays("half");
  assert.ok(fed.total / 30 < 15, `about ${Math.round(fed.total / 30)} sick on a day`);
  assert.ok(hungry.total > fed.total * 1.3, `${hungry.total} sick-days hungry against ${fed.total} fed`);
});

test("a serious case gets a dose and gets over it sooner; left without, it can die, with a name", () => {
  const game = newGame();
  const today = day(game);
  // Three with a fever caught five days ago, all of them fated: one with medicine to be had, two without.
  game.register.sick = { 0: { kind: "fever", since: today - 5, ends: today + 3, fated: true } };
  passTime(game, 24, "rest");
  assert.equal(game.register.dead[0], undefined, "dosed in time");
  assert.equal(game.register.sick[0]?.dosed, today + 1);
  // The rounds carry a crate of their own from the cabinet.
  assert.ok(game.medbay.meridian.rounds > 0);
  takeAboard(game, "meridian", "medicine_crate", 99);
  game.medbay.meridian.rounds = 0;
  const now = day(game);
  game.register.sick = { 1: { kind: "fever", since: now - 5, ends: now + 3, fated: true }, 2: { kind: "fever", since: now - 5, ends: now + 3, fated: false } };
  const aboard = game.ship.aboard;
  passTime(game, 24, "rest");
  assert.match(game.register.dead[1]?.cause ?? "", /of a fever, with no medicine to dose it/);
  assert.equal(game.register.dead[2], undefined, "two in three get over it anyway");
  assert.equal(game.ship.aboard, aboard - 1);
  // A death on the register costs a point of morale, as the health file says.
  const before = game.ship.morale;
  register.registerDies(game, 5, "of a fever");
  assert.equal(game.ship.morale, before - 1);
  const name = register.registerPeople(game)[1].name;
  assert.ok(readNames(game, "meridian", { name: "The chalked names" }).includes(name), "their name goes up with the rest");
  assert.ok(shipView(game).medbay.rounds.died >= 1);
});

test("the ship's health settles lower the more of it is sick, and hunger's deaths are people with names", () => {
  const game = newGame();
  const before = shipLedger(game).healthTarget;
  const today = day(game);
  game.register.sick = Object.fromEntries(Array.from({ length: 86 }, (_, i) => [i, { kind: "cough", since: today, ends: today + 6, fated: true }]));
  assert.equal(register.illnessPenalty(game), 10, "a tenth of the register coughing is ten points");
  assert.equal(shipLedger(game).healthTarget, before - 10);
  // Below the deadly line, the ones who die are on the register: the seriously sick, the sick and the old first.
  game.ship.health = 10;
  const aboard = game.ship.aboard;
  passTime(game, 24, "rest");
  const dead = Object.values(game.register.dead);
  assert.ok(dead.length > 0 && game.ship.aboard === aboard - dead.length, `${dead.length} died`);
  assert.ok(dead.every((one) => /of hunger/.test(one.cause)));
});

test("the people with days of their own catch the same illnesses, and the doctor's rounds dose a fever", () => {
  const game = newGame();
  assert.equal(body.catchIllness(game, BAO, "fever", game.clock.hours), true);
  assert.equal(body.catchIllness(game, BAO, "fever", game.clock.hours), false, "not twice at once");
  // The medbay's own hours leave it to the rounds, at midnight.
  passTime(game, 24 - (game.clock.hours % 24) - 1, "rest");
  assert.ok(!body.woundsNow(game, BAO).find((one) => one.kind === "fever").dressed, "not dosed in the morning queue");
  passTime(game, 2, "rest");
  const fever = body.woundsNow(game, BAO).find((one) => one.kind === "fever");
  assert.equal(fever.dressed, true, "dosed on the rounds");
  assert.equal(fever.until, fever.dressedAt + 3 * 24, "and over it three days later, as the wounds file says");
  assert.ok(game.medbay.meridian.log.some((one) => one.line === "On the rounds, Mess Hand Bao is dosed for a fever"), JSON.stringify(game.medbay.meridian.log));
  assert.equal(health.MEDBAY_KEYS["the doctor's rounds"].read("2 doses for each serious illness, once a day").doses, 2);
});

test("with no medicine, a fever the rounds can't dose kills one of the crew, on the rounds, and never the player", () => {
  const game = newGame();
  passTime(game, 1, "routine");
  takeAboard(game, "meridian", "medicine_crate", 99);
  game.medbay.meridian.rounds = 0;
  // Someone fated to die of it, by the seed: the same roll the rounds make.
  const fated = (key, at) => body.seeded(`${game.bodySeed}|${key}|${at}|kills`)() < 1 / 3;
  const at = game.clock.hours;
  const who = register.lifePeople().map((one) => body.keyAt("meridian", one)).find((key) => key.startsWith("crowd:") && !body.mendedByTechs(game, key) && fated(key, at));
  assert.ok(who, "someone aboard it would kill");
  body.catchIllness(game, who, "fever", at);
  body.catchIllness(game, "you", "fever", at);
  const morale = game.ship.morale;
  passTime(game, 24 * 4, "routine");
  assert.equal(game.dead?.[who], undefined, "not before five days");
  passTime(game, 24 * 2, "routine");
  assert.match(game.dead?.[who]?.cause ?? "", /fever/);
  assert.equal(game.dead[who].at % 24, 0, "at midnight, on the rounds");
  assert.ok(game.ship.morale < morale);
  assert.ok(body.woundsNow(game, "you").some((one) => one.kind === "fever"), "the player lives with theirs");
});

test("it comes out the same however the time is cut up", () => {
  const one = newGame();
  const two = newGame();
  two.bodySeed = one.bodySeed;
  passTime(one, 24 * 20, "rest");
  for (let d = 0; d < 20; d += 1) passTime(two, 24, "rest");
  assert.deepEqual(Object.keys(one.register.sick).sort(), Object.keys(two.register.sick).sort());
  assert.deepEqual(one.register.dead, two.register.dead);
  // The crew too: who's caught what, and been dosed for it, the same.
  const crew = (game) => Object.entries(game.bodies ?? {}).flatMap(([key, held]) => (held.wounds ?? []).filter((one) => /cough|fever/.test(one.kind) && one.until > game.clock.hours).map((one) => `${key} ${one.kind} ${one.at} ${one.dressed ?? false}`)).sort();
  assert.deepEqual(crew(one), crew(two));
  assert.deepEqual(one.register.crew, two.register.crew);
  assert.deepEqual(one.dead ?? {}, two.dead ?? {});
});

test("the medbay's records terminal lists everyone aboard, with how they are", () => {
  const computer = WORLD_COMPUTERS.meridian_medbay_records;
  assert.ok(computer, "the records terminal");
  assert.ok(computer.logs.some((one) => /register/i.test(one.text ?? one)), JSON.stringify(computer.logs));
  const game = newGame();
  const today = day(game);
  game.register.sick = { 3: { kind: "fever", since: today, ends: today + 8, fated: true } };
  game.register.dead = { 4: { day: today, cause: "of a fever" } };
  const table = register.registerTable(game);
  assert.deepEqual(table.columns, ["Name", "Age", "Species", "Quarters", "How they are"]);
  assert.equal(table.rows.length, game.register.size + register.lifePeople().length);
  const people = register.registerPeople(game);
  assert.equal(table.rows.find((row) => row[0] === people[3].name)[4], "a fever, no dose yet");
  assert.match(table.rows.find((row) => row[0] === people[4].name)[4], /^died on day/);
  assert.equal(table.rows.find((row) => row[0] === "Vik")[4], "laid up in the medbay");
  assert.match(table.summary, /1 seriously, 2 laid up\. 1 dead\./);
  // Reading it changes nothing.
  const before = JSON.stringify(game);
  register.registerTable(game);
  assert.equal(JSON.stringify(game), before);
  assert.ok(countAboard(game, "meridian", ["medicine_crate"]).n >= 0);
});
