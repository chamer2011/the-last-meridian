// After a battle (src/aftermath.js): the beaten of the other side lie where they fell under the fight's names, the
// medics carry the player's own side first and theirs after, those who gave up are held in the brig as a number and the
// rest are walked there once they're on their feet, one who dies goes up on the names as an unnamed mutineer, the
// battle costs morale and the council's confidence as its file says, and everyone who fought beside the player
// remembers it.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-aftermath-"));
process.env.GAME_DATA_DIR = dataDir;

const { parseBattleText, writeBattleText } = await import("../public/battle-text.js");
const { UNNAMED, battleEnds, prisonersMove } = await import("../src/aftermath.js");
const { keyAt } = await import("../src/body.js");
const { commandOf, commandView } = await import("../src/command.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { deathsView, die } = await import("../src/death.js");
const { hasADayAt } = await import("../src/medbay.js");
const { liveTick } = await import("../src/live-fight.js");
const { roomNotes } = await import("../src/room-hooks.js");
const { passTime } = await import("../src/rules.js");
const { writtenTurn } = await import("../src/scenes.js");
const { walkView } = await import("../src/walk.js");

const SHIP = "meridian";
const newGame = (seed = 31) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
function play(game, args) {
  const said = [];
  writtenTurn({ game, emit: (e) => { if (e.type !== "state") said.push(e); }, log: (role, text) => game.transcript.push({ role, text }), ...args });
  return said;
}
// The opening played as far as the battle, and the battle ended at once the same way every time: the six who come up
// first go down, then, once the other six have come up the aft stair, two more of them and one of the player's own
// side (someone with a day aboard), and the four still standing give up.
function quickBattle(game) {
  play(game, { event: "start" });
  play(game, { playerText: "Hold the bridge" });
  const c = game.combat;
  assert.ok(c?.battle, "the battle has begun");
  const before = { morale: game.ship.morale, confidence: commandView(game, SHIP).mood.confidence };
  // Every other one of the first six is down with a deep cut, which the medbay treats and three days of rest follow.
  c.enemies.forEach((enemy, i) => {
    if (i % 2 === 0) enemy.wounds = [...(enemy.wounds ?? []), { part: "chest", kind: "deep_cut", words: "a deep cut in the chest", fresh: true }];
    enemy.hp = 0;
  });
  let ours = null;
  for (let i = 0; i < 80; i += 1) {
    if (!ours && c.enemies.length === 12) {
      for (const enemy of c.enemies.filter((one) => one.hp > 0).slice(0, 2)) enemy.hp = 0;
      ours = c.allies.find((one) => one.hp > 0 && one.live && hasADayAt(SHIP, one.body?.who));
      ours.hp = 0;
    }
    const reply = liveTick(game, { ms: 500 });
    if (reply.over) return { c, outcome: reply, before, ours };
  }
  assert.fail("The battle never ended.");
}
const coming = (game) => game.command[SHIP].prisoners.coming;

test("the beaten of the other side lie where they fell under the fight's names, and those who gave up go to the brig", () => {
  const game = newGame(31);
  const { c, outcome } = quickBattle(game);
  assert.equal(outcome.result, "victory");
  assert.match(outcome.summary, /Those who gave up are taken to the brig, and the rest will follow once they're on their feet\./);
  assert.ok(outcome.notes.includes("[COMMAND] The four who gave up are taken to the brig."), outcome.notes.join("\n"));
  const held = game.command[SHIP].prisoners;
  assert.equal(held.held, 4);
  // The eight beaten, by the fight's names: the first of them, who the fight called only Mutineer, is Mutineer #1.
  assert.equal(coming(game).length, 8);
  assert.equal(new Set(coming(game)).size, 8);
  assert.ok(coming(game).every((name) => /^Mutineer #\d+$/.test(name)), coming(game).join(", "));
  assert.ok(coming(game).includes("Mutineer #1"));
  for (const name of coming(game)) {
    const key = keyAt(SHIP, name);
    const d = game.down[key];
    assert.ok(d, `${name} lies where they fell`);
    assert.equal(d.who, name);
    assert.equal(d.level, "deck1");
    assert.match(d.why, /out cold|can't stand|can't get up/);
    // Their body keeps the name and the species they fought as, so nobody's made up as something else afterwards.
    assert.deepEqual([game.bodies[key].name, game.bodies[key].species], [name, "human"]);
  }
  // Each lies where they're drawn, with nobody else on their square.
  const lying = Object.values(game.down).filter((one) => one.level === "deck1");
  assert.equal(new Set(lying.map((one) => `${one.x},${one.y}`)).size, lying.length);
  // The room shows them, lying where they fell.
  const seen = walkView(game).people.filter((one) => /^Mutineer #/.test(one.name ?? ""));
  assert.equal(seen.length, 8, JSON.stringify(walkView(game).people.map((one) => one.name)));
  assert.ok(seen.every((one) => /lying where they fell/.test(one.doing ?? "")), JSON.stringify(seen.map((one) => one.doing)));
  // The Command menu and the brig itself say who's held there.
  assert.deepEqual(commandView(game, SHIP).mood.brig, ["4 mutineers, without names, since day 1, and 8 mutineers still down or in the medbay, to follow"]);
  const brig = commandOf(SHIP).brig.room;
  assert.deepEqual(roomNotes(game, SHIP, brig), ["Four of the mutineers are held here, without names, the red cloth still round their arms. Eight more are to be brought here once they're on their feet."]);
  assert.deepEqual(roomNotes(game, SHIP, "bridge"), []);
  assert.ok(c.enemies.length === 12);
});

test("the battle costs morale and the council's confidence as its file says, and those who fought beside you remember it", () => {
  const game = newGame(32);
  const { c, outcome, before, ours } = quickBattle(game);
  // Five, and two for each of the player's side who went down; nothing more, since the player stayed on their feet.
  const fallen = c.allies.filter((one) => one.hp <= 0).length;
  assert.ok(fallen >= 1);
  const by = Math.min(25, 5 + 2 * fallen);
  assert.equal(game.ship.morale, before.morale - by);
  assert.ok(outcome.notes.some((one) => one.startsWith(`[SHIP] Morale -${by}: The Red Cloth, and `)), outcome.notes.join("\n"));
  assert.equal(commandView(game, SHIP).mood.confidence, before.confidence - 10);
  assert.ok(outcome.notes.includes(`[COMMAND] The council's confidence in you falls to ${before.confidence - 10}.`));
  // The one of ours who went down lies where they fell, like anyone, and the medics will come.
  assert.ok(game.down[keyAt(SHIP, ours.body.who)], `${ours.name} lies on the deck`);
  // Everyone on the player's side remembers fighting beside them, the fallen too.
  const memory = game.command[SHIP].memory;
  for (const one of c.allies.filter((ally) => ally.body?.who)) {
    assert.ok((memory[one.body.who] ?? []).some((kept) => kept.kind === "story" && /fought beside you on deck 1/.test(kept.words)), `${one.name} remembers`);
  }
});

test("worked out by the file: more if you went down, never more than 25 at once, and nothing without the lines", () => {
  const game = newGame(33);
  const ground = { level: { id: "deck1" } };
  const battle = { title: "The Test", morale: { base: 5, each: 2, you: 5 }, confidence: { base: 10, you: 5 } };
  const morale = game.ship.morale;
  const confidence = commandView(game, SHIP).mood.confidence;
  const notes = battleEnds(game, { allies: [], enemies: [], battle }, ground, "defeat");
  assert.deepEqual(notes, ["[SHIP] Morale -10: The Test, and you with them.", `[COMMAND] The council's confidence in you falls to ${confidence - 15}.`]);
  assert.equal(game.ship.morale, morale - 10);
  // Two of ours down, out of sight of the room: counted all the same.
  const two = [{ hp: 0 }, { hp: 0 }];
  assert.deepEqual(battleEnds(game, { allies: two, enemies: [], battle }, ground, "victory")[0], "[SHIP] Morale -9: The Test, and two of yours down.");
  const worst = battleEnds(game, { allies: [{ hp: 0 }, { hp: 0 }, { hp: 0 }], enemies: [], battle: { ...battle, morale: { base: 20, each: 5, you: 5 } } }, ground, "defeat");
  assert.equal(worst[0], "[SHIP] Morale -25: The Test, and three of yours down, and you with them.");
  const still = game.ship.morale;
  assert.deepEqual(battleEnds(game, { allies: two, enemies: [], battle: { title: "Quiet" } }, ground, "victory"), []);
  assert.equal(game.ship.morale, still);
});

test("one of them who dies goes up on the names as an unnamed mutineer, and isn't waited for in the brig", () => {
  const game = newGame(34);
  quickBattle(game);
  const name = coming(game)[0];
  const key = keyAt(SHIP, name);
  const said = die(game, key, { cause: "bled" });
  assert.deepEqual(said.filter((one) => one.startsWith("[HEALTH]")), [`[HEALTH] ${name} dies, bled to death where they fell.`]);
  prisonersMove(game);
  const held = game.command[SHIP].prisoners;
  assert.equal(held.died, 1);
  assert.equal(coming(game).length, 7);
  assert.ok(!coming(game).includes(name));
  assert.equal(game.dead[key].name, UNNAMED);
  assert.equal(deathsView(game, SHIP)[0].name, "An unnamed mutineer");
  assert.match(commandView(game, SHIP).mood.brig[0], /and 7 mutineers still down or in the medbay, to follow$/);
});

test("as the hours go by the medics carry our own first, then theirs, and once on their feet they're walked to the brig", () => {
  const game = newGame(35);
  quickBattle(game);
  play(game, { event: "continue" });
  const ours = Object.values(game.down).filter((d) => !d.bed && !/^Mutineer #/.test(d.who)).map((d) => d.who);
  const lines = [];
  for (let i = 0; i < 8; i += 1) lines.push(...(passTime(game, 0.25, "routine") ?? []));
  // Whoever sets off for someone: none of theirs while one of ours is still waiting.
  const calls = lines.map((line) => line.match(/sets off from the medbay for (.+)\.$/)?.[1]).filter(Boolean);
  const firstTheirs = calls.findIndex((who) => /^Mutineer #/.test(who));
  if (firstTheirs >= 0) assert.ok(calls.slice(firstTheirs).every((who) => /^Mutineer #/.test(who)), calls.join(", "));
  assert.ok(ours.length || calls.length, "somebody needed carrying");
  // Laid on a cot or the medbay's floor, treated, three days' rest for a deep wound, then to the brig.
  let walked = 0;
  let treated = false;
  let last = null;
  for (let hour = 2; hour < 100 && coming(game).length; hour += 1) {
    walked += (passTime(game, 1, "routine") ?? []).filter((line) => /is on their feet again, and is walked to the brig under guard\.$/.test(line)).length;
    treated ||= (game.medbay?.[SHIP]?.log ?? []).some((one) => /^Dr\. Aduro dresses Mutineer #\d+'s deep cut in the chest$/.test(one.line));
    last = hour;
  }
  assert.ok(treated, "the doctor dressed their wounds, calling them by the fight's names");
  assert.ok(last > 48, `those with a deep cut rested in the medbay before the brig, the last walked there after ${last} hours`);
  const held = game.command[SHIP].prisoners;
  assert.deepEqual(coming(game), [], "nobody is still to come");
  assert.equal(held.held + held.died, 12, JSON.stringify(held));
  assert.ok(walked >= 1);
  // In the brig they're a number: nobody of theirs lies anywhere, and only the dead keep a body's record.
  assert.ok(!Object.values(game.down ?? {}).some((d) => /^Mutineer #/.test(d.who ?? "") && !d.dead));
  for (const [key, kept] of Object.entries(game.bodies ?? {})) if (kept.name) assert.ok(game.dead?.[key], `${kept.name} is in the brig`);
  // The brig says how many it holds, and no longer that more are to come.
  const [note, ...more] = roomNotes(game, SHIP, commandOf(SHIP).brig.room);
  assert.match(note, /^[A-Z][a-z]+ of the mutineers (?:are|is) held here, without names, the red cloth still round their arms\.$/);
  assert.deepEqual(more, []);
  if (held.held === 12) assert.match(note, /^Twelve of the mutineers are/);
});

test("a battle's file says what it costs aboard, and what's wrong with those lines in plain words", () => {
  const text = `# The Test
place: meridian
deck: deck1
they make for: The Bridge
morale falls by: 4
the council's confidence falls by: 10, and 5 more if you went down

Against you:
- 3 mutineer_crew, up The Upper Forward Stair
`;
  const { battle, problems } = parseBattleText(text, "test");
  assert.deepEqual(problems, []);
  assert.deepEqual(battle.morale, { base: 4, each: 0, you: 0 });
  assert.deepEqual(battle.confidence, { base: 10, you: 5 });
  assert.match(writeBattleText(battle), /^morale falls by: 4$/m);
  assert.match(writeBattleText(battle), /^the council's confidence falls by: 10, and 5 more if you went down$/m);
  const wrong = parseBattleText(text.replace("morale falls by: 4", "morale falls by: lots").replace("10, and 5 more if you went down", "a little"), "test");
  assert.ok(wrong.problems.some((one) => one.line === 5 && /morale falls by: is written as a number/.test(one.message)), JSON.stringify(wrong.problems));
  assert.ok(wrong.problems.some((one) => one.line === 6 && /the council's confidence falls by: is written as a number/.test(one.message)), JSON.stringify(wrong.problems));
});
