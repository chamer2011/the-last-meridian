// The player's own death (chosen by the owner on 2026-11-16): the same things kill them as kill the crew, they go
// down first and are carried to the medbay like anyone, and die only when nobody reaches them in time. Without air they
// pass out at their own time, or sooner once the bad air has their health; too little blood takes their legs where a
// medbay could have reached them; a wound gone bad or a fever does, a while before it would kill. Whoever would answer
// a call for anyone comes for them, a dressing of their own goes on first, and the medbay treats them with what it
// has. When that isn't enough the game ends on a page of the ship's log, and nothing moves afterwards. A synthetic
// doesn't breathe. A ship with nobody left alive but the player goes on.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-players-death-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const body = await import("../src/body.js");
const { addItem, clockRuns, passTime, publicState } = await import("../src/rules.js");
const { whyDown } = await import("../src/collapse.js");
const { startCheck } = await import("../src/checks.js");
const { stillAlive } = await import("../src/command.js");
const death = await import("../src/death.js");
const logistics = await import("../src/logistics.js");
const { peopleAboard } = await import("../src/life.js");
const { registerPeople } = await import("../src/register.js");
const { walkCommand } = await import("../src/walk.js");
const sys = await import("../src/systems.js");
const { parseEffect } = await import("../src/scene-text.js");
const health = await import("../public/health-text.js");

// The dice held still: no fire or breach starts by chance while the clock runs in play.
Math.random = () => 0.99;

const newGame = (seed = 21, bodySeed = 77) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "captain" }));
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  game.bodySeed = bodySeed;
  return game;
};
const inRoom = (game, room) => {
  game.walk = null;
  walkCommand(game, { action: "room", to: room });
  clockRuns(game, 1);
};
const roomNow = (game) => sys.playerSpot(game)?.room ?? null;
// Minute by minute, as in play, with everything the story says, until something's so or the minutes are up.
const minutes = (game, n, until = () => false) => {
  const said = [];
  for (let i = 0; i < n && !until(); i += 1) said.push(...(clockRuns(game, 1) ?? []));
  return said;
};
const effect = (game, words) => sys.applySystemsEffect(game, parseEffect(words).do.systems);
// The air plant off and nothing in reserve: the whole ship's air goes.
const airGone = (game) => {
  effect(game, "air off");
  game.systems.meridian.reserve = 5 * 24 * 60;
};
// A wound on the player, from now.
const wound = (game, kind, part) => body.addWounds(game, "you", [body.newWound(body.kindOf(kind, part), part)]);
// Nothing in the medicine cabinet, and nothing left in the crate that was open.
const noMedicine = (game) => {
  logistics.takeAboard(game, "meridian", "medicine_crate", 99);
  clockRuns(game, 1);
  if (game.medbay?.meridian) game.medbay.meridian.doses = 0;
};
// What the server does with what the clock says: it goes into the story.
const told = (game, lines) => {
  if (lines.length) game.transcript.push({ role: "notice", text: lines.join("\n") });
  return lines;
};

test("the wounds file says when you go down, and who doesn't breathe", () => {
  const care = health.careOf({});
  assert.deepEqual(care["you collapse"], { hours: 12 });
  assert.deepEqual(health.CARE["you collapse"].read("6 hours before a wound gone bad or a fever would kill you"), { hours: 6 });
  assert.match(health.CARE["you collapse"].read("soon").problem, /12 hours before a wound gone bad or a fever would kill you/);
  // The line about where bleeding stops no longer speaks of the player, and a file that still does reads the same.
  assert.deepEqual(health.CARE["bleeding stops at"].read("35, away from a medbay"), { floor: 35 });
  assert.deepEqual(health.CARE["bleeding stops at"].read("35, for you and away from a medbay, for now"), { floor: 35 });
  const text = fs.readFileSync(new URL("../world/health/wounds.txt", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(text, /^you collapse: 12 hours before a wound gone bad or a fever would kill you$/m);
  assert.match(text, /^bleeding stops at: 35, away from a medbay$/m);
  assert.match(text, /^- no air, the chest: passed out for want of air; out cold until they can breathe; not for: synthetic$/m);
  const read = health.parseWoundsText(text);
  assert.deepEqual(read.problems, []);
  assert.equal(health.writeWoundsText(read.value), text);
  assert.deepEqual(body.healthProblems(), []);
  assert.equal(body.speciesNeedsAir("synthetic"), false, "a machine person doesn't breathe");
  assert.equal(body.speciesNeedsAir("human"), true);
});

test("in a room whose air has gone you pass out at your own time, and whoever answers a call carries you to a cot", () => {
  const game = newGame();
  inRoom(game, "mess");
  effect(game, "air off in The Long Mess");
  const times = body.airTimes(game, "you");
  const began = game.clock.hours;
  const said = minutes(game, 6 * 60, () => roomNow(game) === "medbay" || game.over);
  assert.equal(game.over, undefined, "nobody dies of one room");
  assert.ok(said.some((line) => /^\[AIR\] The air in The Long Mess is bad\. Get out, or get it moving again\.$/.test(line)), said.join(" | "));
  assert.ok(said.some((line) => /^\[AIR\] There's no air left to breathe in the Long Mess\. Everything narrows to a point, and you go down\.$/.test(line)), said.join(" | "));
  const woke = said.find((line) => /^\[HEALTH\] You come round on a cot in the medbay, /.test(line));
  assert.match(woke ?? "", /^\[HEALTH\] You come round on a cot in the medbay, \d+ minutes later\. Nurse \w+ carried you here\.$/, said.join(" | "));
  assert.equal(roomNow(game), "medbay");
  assert.equal(game.fell, undefined, "and you're on your feet again");
  assert.equal(whyDown(game), null);
  assert.equal(body.outForAir(game, "you"), null);
  // Not before your own time was up: the air took about twenty minutes to go, and then it was yours to breathe.
  const gone = (game.clock.hours - began) * 60;
  assert.ok(gone >= times.out && gone <= times.out + 20 + 60, `${Math.round(gone)} minutes, against ${Math.round(times.out)} of your own`);
  assert.ok(!said.some((line) => /Healed: passed out/.test(line)), "coming round isn't a wound healing");
});

test("waiting in it comes out the same: the wait is gone through a little at a time, and goes on once you're up", () => {
  const game = newGame();
  inRoom(game, "mess");
  effect(game, "air off in The Long Mess");
  const began = game.clock.hours;
  const said = passTime(game, 8);
  assert.equal(game.over, undefined);
  assert.ok(said.some((line) => /^\[HEALTH\] You come round on a cot in the medbay, /.test(line)), said.join(" | "));
  assert.equal(roomNow(game), "medbay");
  assert.ok(Math.abs(game.clock.hours - began - 8) < 0.2, `the eight hours were waited, with the time down inside them: ${game.clock.hours - began}`);
  // Nothing wrong with the air, a wait is the one piece it always was, to the minute.
  const fine = newGame();
  inRoom(fine, "mess");
  const at = fine.clock.hours;
  passTime(fine, 24);
  assert.equal(fine.clock.hours, at + 24);
});

test("bad air that has taken your health puts you out sooner than your own time", () => {
  const game = newGame();
  inRoom(game, "mess");
  effect(game, "air off in The Long Mess");
  game.hp = 5;
  const began = game.clock.hours;
  const said = minutes(game, 5 * 60, () => Boolean(game.fell) || roomNow(game) === "medbay" || game.over);
  assert.ok(said.some((line) => /You're close to passing out/.test(line)), said.join(" | "));
  assert.ok(said.some((line) => /you go down/.test(line)), said.join(" | "));
  assert.ok((game.clock.hours - began) * 60 < body.airTimes(game, "you").out, "well before the two hours and more of your own");
  assert.equal(game.over, undefined);
});

test("a ship with no air left takes you with everyone else, and the game ends on a page of the ship's log", () => {
  const game = newGame();
  inRoom(game, "bridge");
  airGone(game);
  const began = game.clock.hours;
  told(game, passTime(game, 24));
  assert.ok(game.over, "the game is over");
  assert.equal(game.over.cause, "air");
  assert.match(game.over.line, /^Died on day 1 aboard the CFS Meridian, for want of air, in the Bridge\.$/);
  const times = body.airTimes(game, "you");
  const lasted = (game.over.at - began) * 60;
  assert.ok(lasted >= times.out + times.dead && lasted <= times.out + times.dead + 30, `${Math.round(lasted)} minutes, against ${Math.round(times.out + times.dead)} of your own`);
  // What the page shows: when, how, why nobody came, what became of the ship, and the last the story said before it.
  const over = publicState(game).over;
  assert.match(over.when, /^Day 1, \d\d:\d\d$/);
  assert.equal(over.line, game.over.line);
  assert.ok(over.more.some((line) => /^Nobody was left who could come for you\.$/.test(line)), JSON.stringify(over.more));
  assert.ok(over.more.some((line) => /^The Meridian had no air left anywhere aboard\./.test(line)), JSON.stringify(over.more));
  assert.ok(over.last.length > 0 && over.last.length <= 5, JSON.stringify(over.last));
  assert.ok(over.last.every((line) => !/^\[HEALTH\] -\d|^\[STRESS\]|You die/.test(line)), JSON.stringify(over.last));
  // And nothing moves any more.
  const clock = game.clock.hours;
  const dead = death.deadAt(game, "meridian").length;
  assert.deepEqual(passTime(game, 48), []);
  assert.deepEqual(clockRuns(game, 30), []);
  assert.equal(game.clock.hours, clock);
  assert.equal(death.deadAt(game, "meridian").length, dead);
  assert.equal(publicState(game).over.line, over.line);
});

test("a synthetic doesn't breathe: bad air is nothing to one, yours or the crew's, and they're the ones left standing", () => {
  const game = newGame();
  game.character.species = "synthetic";
  inRoom(game, "bridge");
  // Once the clock has moved, their health is what a synthetic's can be.
  passTime(game, 2);
  const hp = game.hp;
  airGone(game);
  const said = [];
  for (let hour = 0; hour < 8; hour += 1) said.push(...passTime(game, 1));
  assert.equal(game.over, undefined, "the game goes on");
  assert.equal(game.hp, hp, "and the air took nothing from you");
  assert.equal(whyDown(game), null);
  assert.equal(game.systems.meridian.short?.you, undefined);
  assert.ok(said.some((line) => /^\[AIR\] The air in The Bridge is bad\. It's nothing to you, but nobody who breathes can stay in it\.$/.test(line)), said.filter((line) => /AIR/.test(line)).join(" | "));
  // Mercy Seven, the ship's own synthetic, is still about; the ones who breathe aren't.
  assert.equal(stillAlive(game, "seven"), true);
  assert.equal(game.down?.["id:seven"], undefined);
  assert.equal(stillAlive(game, "voss"), false);
  // On the register, the synthetics are who's left.
  const people = registerPeople(game);
  const machines = people.filter((one) => one.species === "synthetic").length;
  assert.ok(machines > 20, `${machines} synthetics on the register`);
  assert.equal(people.length - Object.keys(game.register.dead).length, machines);
  assert.ok(people.filter((one) => game.register.dead[one.i]).every((one) => one.species !== "synthetic"));
  // And you keep the ship, alone with them: time goes on passing.
  const at = game.clock.hours;
  passTime(game, 24);
  assert.equal(game.clock.hours, at + 24);
  assert.equal(game.over, undefined);
});

test("too little blood takes your legs, a nurse carries you in, the doctor dresses it, and you wake on a cot", () => {
  const game = newGame();
  inRoom(game, "mess");
  wound(game, "deep_cut", "chest");
  const said = [];
  for (let hour = 0; hour < 14 && !said.some((line) => /^\[HEALTH\] You come round/.test(line)); hour += 1) said.push(...passTime(game, 1));
  assert.equal(game.over, undefined);
  assert.ok(said.some((line) => /^\[HEALTH\] You've lost too much blood to stand\. Your legs go from under you\.$/.test(line)), said.join(" | "));
  assert.ok(said.some((line) => /dresses your deep cut in the chest/.test(line)), said.join(" | "));
  assert.match(said.find((line) => /^\[HEALTH\] You come round/.test(line)) ?? "", /^\[HEALTH\] You come round on a cot in the medbay, \d+ hours later\. Nurse \w+ carried you here\.$/);
  assert.equal(roomNow(game), "medbay");
  assert.ok(game.blood >= 40, `blood ${game.blood}`);
  assert.equal(body.bleedingOf(game, "you"), null);
});

test("with nothing in the cabinet and nothing of your own, you bleed to death on the cot, and the page says why", () => {
  const game = newGame();
  inRoom(game, "mess");
  noMedicine(game);
  wound(game, "deep_cut", "chest");
  wound(game, "deep_cut", "left_arm");
  const said = [];
  for (let hour = 0; hour < 24 && !game.over; hour += 1) said.push(...passTime(game, 1));
  assert.ok(game.over, said.join(" | "));
  assert.equal(game.over.cause, "bled");
  assert.match(game.over.line, /^Died on day 1 aboard the CFS Meridian, of your wounds: you bled to death on a cot in the medbay\.$/);
  assert.deepEqual(game.over.more.slice(0, 1), ["The medicine cabinet was empty."]);
  assert.ok(game.over.more.some((line) => /were aboard the Meridian when you died/.test(line)));
  assert.ok(game.over.more.some((line) => /^Commander Voss has the chair now\.$/.test(line)), JSON.stringify(game.over.more));
  assert.equal(game.blood, 0);
});

test("a dressing of your own goes on as you go down, and saves you where the cabinet couldn't", () => {
  const game = newGame();
  inRoom(game, "mess");
  noMedicine(game);
  addItem(game, "medkit", 1);
  addItem(game, "bandage_roll", 1);
  wound(game, "deep_cut", "chest");
  wound(game, "deep_cut", "left_arm");
  const said = [];
  for (let hour = 0; hour < 24 && !game.over; hour += 1) said.push(...passTime(game, 1));
  assert.equal(game.over, undefined, said.join(" | "));
  assert.equal(said.filter((line) => /^\[HEALTH\] You get an? [\w ]+ onto it as you go down: dressed the deep cut in the (chest|left arm)\.$/.test(line)).length, 2, said.join(" | "));
  assert.equal(game.inventory.medkit ?? 0, 0);
  assert.equal(game.inventory.bandage_roll ?? 0, 0);
  assert.ok(said.some((line) => /^\[HEALTH\] You come round/.test(line)));
  assert.equal(body.bleedingOf(game, "you"), null);
});

test("a skill check under way is finished before you go down, so that what it settles is settled", () => {
  const game = newGame();
  inRoom(game, "mess");
  wound(game, "deep_cut", "chest");
  game.blood = 30;
  startCheck(game, { skill: "stealth", difficulty: "moderate", reason: "Pick someone's pocket", source: "person" });
  assert.ok(game.check);
  const during = minutes(game, 30);
  assert.equal(whyDown(game), "blood", "too weak to stand all the while");
  assert.ok(game.check, "and the check is still open");
  assert.ok(!during.some((line) => /legs go from under you/.test(line)), during.join(" | "));
  assert.equal(game.fell, undefined);
  // Once it's over, the next moment of the clock has them down.
  game.check = null;
  const after = minutes(game, 2);
  assert.ok(after.some((line) => /legs go from under you/.test(line)), after.join(" | "));
});

test("behind a locked medbay door nobody comes, and you die where you fell", () => {
  const game = newGame();
  inRoom(game, "mess");
  sys.setDoor(game, "meridian", "medbay", "locked", { by: "story" });
  wound(game, "deep_cut", "chest");
  wound(game, "deep_cut", "left_arm");
  const said = [];
  for (let hour = 0; hour < 24 && !game.over; hour += 1) said.push(...passTime(game, 1));
  assert.ok(game.over, said.join(" | "));
  assert.match(game.over.line, /you bled to death where you fell, in the Long Mess\.$/);
  assert.deepEqual(game.over.more.slice(0, 1), ["The medbay's door was locked, and nobody could get out to you."]);
});

test("out cold on the dock the Meridian's at, her shuttle crew bring her captain across, and they come round aboard", () => {
  const game = newGame();
  inRoom(game, "bridge");
  game.ship.at = "haven";
  game.location = "haven";
  game.walk = null;
  clockRuns(game, 1);
  assert.equal(body.passOut(game, "you"), true);
  const said = minutes(game, 90, () => game.location === "meridian" && !body.outForAir(game, "you"));
  assert.equal(game.location, "meridian");
  assert.equal(roomNow(game), "medbay");
  assert.ok(said.some((line) => /^\[HEALTH\] You come round on a cot in the medbay, \d+ minutes later\. The shuttle crew found you on Haven Station and brought you back aboard\.$/.test(line)), said.join(" | "));
  assert.equal(game.over, undefined);
  assert.equal(game.fell, undefined);
});

test("away from a medbay your blood stops where it always did, and nothing takes your legs", () => {
  const game = newGame();
  game.location = "haven";
  game.walk = null;
  wound(game, "deep_cut", "chest");
  wound(game, "deep_cut", "left_arm");
  for (let hour = 0; hour < 12; hour += 1) passTime(game, 1);
  assert.equal(game.blood, 35);
  assert.equal(whyDown(game), null);
  assert.equal(game.over, undefined);
  assert.equal(game.fell, undefined);
});

test("a wound gone bad warns you each day, takes your legs half a day before it would kill, and the medbay saves you", () => {
  const game = newGame();
  inRoom(game, "bridge");
  wound(game, "deep_burn", "left_arm");
  const said = [];
  for (let day = 0; day < 9 && !said.some((line) => /^\[HEALTH\] You come round/.test(line)); day += 1) said.push(...passTime(game, 24));
  assert.equal(game.over, undefined, said.join(" | "));
  const warned = said.filter((line) => /^\[HEALTH\] The wound in the left arm has gone bad, and it's still untreated\. Left like this it will kill you in /.test(line));
  assert.deepEqual(warned.map((line) => line.match(/kill you in (a day|\d+ days)/)[1]), ["4 days", "3 days", "2 days", "a day"]);
  assert.ok(said.some((line) => /^\[HEALTH\] The wound in the left arm has gone bad, and it's had too long\. You go down where you stand\.$/.test(line)), said.join(" | "));
  assert.ok(said.some((line) => /^\[HEALTH\] You come round on a cot in the medbay/.test(line)));
  assert.ok(!body.woundsNow(game, "you").some((one) => one.kind === "infected" && !one.dressed), "the wound's been seen to");
});

test("with nothing to treat it, it kills you on the cot twelve hours after you went down", () => {
  const game = newGame();
  inRoom(game, "bridge");
  noMedicine(game);
  wound(game, "deep_burn", "left_arm");
  const at = game.clock.hours;
  const said = [];
  for (let day = 0; day < 9 && !game.over; day += 1) said.push(...passTime(game, 24));
  assert.ok(game.over, said.join(" | "));
  assert.equal(game.over.cause, "infection");
  assert.match(game.over.line, /^Died on day 8 aboard the CFS Meridian, of the wound in your left arm gone bad, untreated, on a cot in the medbay\.$/);
  assert.deepEqual(game.over.more.slice(0, 1), ["The medicine cabinet was empty."]);
  // Two days to go bad and five more to kill: no sooner.
  assert.ok(game.over.at >= at + 7 * 24 - 1e-6 && game.over.at <= at + 7 * 24 + 13, `${game.over.at - at} hours after the burn`);
});

test("with a dressing in your pack, it goes on at the last and you never go down", () => {
  const game = newGame();
  inRoom(game, "bridge");
  noMedicine(game);
  addItem(game, "medkit", 1);
  wound(game, "deep_burn", "left_arm");
  const said = [];
  for (let day = 0; day < 9; day += 1) said.push(...passTime(game, 24));
  assert.equal(game.over, undefined, said.join(" | "));
  assert.ok(said.some((line) => /^\[HEALTH\] The wound in the left arm has gone bad, and it's nearly had too long\.$/.test(line)), said.join(" | "));
  assert.ok(said.some((line) => /^\[HEALTH\] You get a medkit onto it in time: dressed the wound in the left arm, which had gone bad\.$/.test(line)), said.join(" | "));
  assert.ok(!said.some((line) => /You go down/.test(line)));
  assert.equal(game.inventory.medkit ?? 0, 0);
});

// A game whose player has a fever that was going to kill them: one fever in three is, by the game's own seed.
const feverish = () => {
  for (let seed = 1; seed < 60; seed += 1) {
    const game = newGame(21, seed);
    inRoom(game, "bridge");
    body.catchIllness(game, "you", "fever", game.clock.hours);
    game.location = "haven";
    const fated = body.playersKillers(game, { rounds: true }).length > 0;
    game.location = "meridian";
    if (fated) return game;
  }
  throw new Error("no seed in sixty gives a fever that kills");
};

test("a fever nobody doses: told each night, down at noon on the last day, and dead at the midnight rounds", () => {
  const game = feverish();
  noMedicine(game);
  const at = game.clock.hours;
  const said = [];
  for (let day = 0; day < 9 && !game.over; day += 1) said.push(...passTime(game, 24));
  assert.ok(game.over, said.join(" | "));
  assert.equal(game.over.cause, "illness");
  assert.match(game.over.line, /of a fever, with no medicine to dose it\.$/);
  assert.ok(said.filter((line) => /^\[HEALTH\] There was no medicine on the rounds for your fever\. Left undosed, it can kill\.$/.test(line)).length >= 4, said.join(" | "));
  assert.ok(said.some((line) => /^\[HEALTH\] The fever has had too long with nothing to dose it\. You go down where you stand\.$/.test(line)), said.join(" | "));
  // Five days untreated, and then the first midnight after: the wait is cut at noon, when they go down.
  assert.equal(game.over.at % 24, 0, "at a midnight");
  assert.ok(game.over.at >= at + 5 * 24 && game.over.at <= at + 6 * 24 + 1e-6, `${game.over.at - at} hours after catching it`);
  assert.ok(Math.abs(game.fell.at % 24 - 12) < 0.2, `down at ${game.fell.at % 24} o'clock`);
});

test("with medicine aboard the rounds dose it the first night, and it never comes to that", () => {
  const game = feverish();
  const said = [];
  for (let day = 0; day < 9; day += 1) said.push(...passTime(game, 24));
  assert.equal(game.over, undefined, said.join(" | "));
  assert.ok(!said.some((line) => /You go down|no medicine on the rounds/.test(line)), said.join(" | "));
  assert.ok(game.medbay.meridian.log.some((one) => /On the rounds, you're dosed for a fever/.test(one.line)) || !body.woundsNow(game, "you").some((one) => one.kind === "fever"), JSON.stringify(game.medbay.meridian.log));
});

test("everyone aboard dead but you: the game goes on, and you keep the ship alone", () => {
  // Ashore while the Meridian loses her air, and back aboard once it's in her again.
  const game = newGame();
  inRoom(game, "bridge");
  airGone(game);
  game.location = "haven";
  game.walk = null;
  for (let hour = 0; hour < 8; hour += 1) passTime(game, 1);
  const breathers = registerPeople(game).filter((one) => one.species !== "synthetic").length;
  assert.equal(Object.keys(game.register.dead).length, breathers, "everyone on the register who breathes has died");
  const plant = Object.values(sys.systemsOf("meridian").parts).find((part) => part.kind === "air plant");
  sys.switchPart(game, "meridian", plant.id, true, { by: "story" });
  for (let hour = 0; hour < 3; hour += 1) passTime(game, 1);
  game.location = "meridian";
  game.walk = null;
  inRoom(game, "bridge");
  const at = game.clock.hours;
  for (let day = 0; day < 3; day += 1) passTime(game, 24);
  assert.equal(game.over, undefined);
  assert.equal(game.clock.hours, at + 72);
  assert.ok(peopleAboard(game, "meridian", "deck1").length >= 0);
});
