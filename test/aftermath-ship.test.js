// After a battle, the ship (src/aftermath.js): what its file's After it: lines say it leaves behind. A fire where the
// fighting was thickest, of the rooms with air for it, a breach, parts broken in the rooms it names and in every room
// where anyone went down, more if the player went down, mended by the engineers one thing at a time in the file's
// order, each with a parts crate. And the Medbay on a junction box of its own, so the Names Bulkhead's going out leaves
// it lit.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-aftermath-ship-"));
process.env.GAME_DATA_DIR = dataDir;

const { parseBattleText, writeBattleText } = await import("../public/battle-text.js");
const { battleEnds } = await import("../src/aftermath.js");
const { BATTLES_DIR, battleProblems } = await import("../src/battles.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { liveTick } = await import("../src/live-fight.js");
const { countAboard } = await import("../src/logistics.js");
const { passTime } = await import("../src/rules.js");
const { writtenTurn } = await import("../src/scenes.js");
const { damagePart, lookAt, roomPowered, systemsOf } = await import("../src/systems.js");
const { mapFor } = await import("../src/walk.js");

const SHIP = "meridian";
const newGame = (seed = 41) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const play = (game, args) => writtenTurn({ game, emit: () => {}, log: (role, text) => game.transcript.push({ role, text }), ...args });
const partState = (game, id) => game.systems?.[SHIP]?.parts?.[id] ?? {};
const brokenByBattle = (game) => Object.entries(game.systems?.[SHIP]?.parts ?? {}).filter(([, s]) => s.damage && s.by === "battle").map(([id]) => id);
const crates = (game) => {
  const found = countAboard(game, SHIP, "parts_crate");
  return typeof found === "number" ? found : found.n;
};
// The opening played as far as the battle, and the battle ended at once the same way every time, as in
// test/aftermath.test.js: the six who come up first go down, then two more once the rest have come up, and the four
// still standing give up. The player stays on their feet.
function quickBattle(game) {
  play(game, { event: "start" });
  play(game, { playerText: "Hold the bridge" });
  const c = game.combat;
  for (const enemy of c.enemies) enemy.hp = 0;
  for (let i = 0; i < 80; i += 1) {
    if (c.enemies.length === 12 && c.enemies.filter((one) => one.hp > 0).length > 4) for (const enemy of c.enemies.filter((one) => one.hp > 0).slice(0, 2)) enemy.hp = 0;
    const reply = liveTick(game, { ms: 500 });
    if (reply.over) return { c, outcome: reply };
  }
  assert.fail("The battle never ended.");
}
// The rooms on deck 1 where anyone on either side went down.
function roomsFallenIn(c) {
  const level = mapFor(SHIP).levels.deck1;
  return new Set([...c.allies, ...c.enemies].filter((one) => one.hp <= 0 && one.live).map((one) => level.roomAt(Math.round(one.live.x), Math.round(one.live.y))).filter((room) => room && room !== "deck1"));
}
// A square inside a room on deck 1.
function squareIn(room) {
  const level = mapFor(SHIP).levels.deck1;
  for (let y = 0; y < 80; y += 1) for (let x = 0; x < 200; x += 1) if (level.roomAt(x, y) === room) return { x, y };
  return null;
}

test("the mutiny's file says what it leaves behind, reads back the same, and what's wrong with such a line is said", () => {
  const text = fs.readFileSync(path.join(BATTLES_DIR, "mutiny.txt"), "utf8");
  const { battle, problems } = parseBattleText(text, "mutiny");
  assert.deepEqual(problems, []);
  assert.equal(writeBattleText(battle), text.replace(/\r\n/g, "\n"));
  assert.deepEqual(battle.after.map(({ line, ...one }) => one), [
    { what: "fire", thickest: true },
    { what: "breach", room: "The Boat Bay" },
    { what: "broken", part: "junction box", room: "The Names Bulkhead" },
    { what: "broken", part: "junction box", room: "The Bridge", if: "you" },
    { what: "broken", part: "nav core", room: "The Bridge" },
    { what: "broken", part: "relay", room: "The Bridge", if: "there" },
    { what: "broken", every: true, kinds: ["speaker", "camera"] },
    { what: "broken", every: true, kinds: ["speaker", "camera"], if: "you" },
  ]);
  const wrong = parseBattleText(`# Wrong
place: meridian
deck: deck1
they make for: The Bridge

Against you:
- 3 mutineer_crew, up The Upper Forward Stair

After it:
- a fire in The Galley
- the toaster in The Bridge broken
- an urn broken in every room where anyone went down, if anyone went down there
- everything on fire
`, "wrong");
  assert.deepEqual(wrong.problems.map((one) => one.line), [13]);
  assert.match(wrong.problems[0].message, /a line under After it: is one of/);
  const said = battleProblems(wrong.battle);
  const expect = (pattern) => assert.ok(said.some((one) => pattern.test(one)), `${pattern}\n${said.join("\n")}`);
  expect(/line 10\): a fire in The Galley names The Galley, which isn't a room on deck1/);
  expect(/line 11\): The Bridge has no toaster in meridian's systems\. What's there: junction box/);
  expect(/line 12\): there's no urn anywhere in meridian's systems/);
  expect(/line 12\): "if anyone went down there" needs a line that names a room/);
});

test("won, the battle leaves a fire, a breach, the Names Bulkhead's power and the nav core broken, and a part in every room fought in", () => {
  const game = newGame(41);
  const { c, outcome } = quickBattle(game);
  assert.equal(outcome.result, "victory");
  const line = outcome.notes.find((one) => one.startsWith("[SYSTEMS] Broken in the fighting: "));
  assert.ok(line, outcome.notes.join("\n"));
  assert.match(line, /the junction box[^;]* in The Names Bulkhead/);
  assert.match(line, /the nav core[^;]* in The Bridge/);
  assert.equal((line.match(/the junction box/g) ?? []).length, 1, "the bridge keeps its own power when you stay on your feet");
  for (const id of ["power:junction_box:names", "navigation:nav_core:bridge"]) assert.deepEqual([partState(game, id).damage, partState(game, id).by], ["broken", "battle"], id);
  assert.equal(partState(game, "power:junction_box:bridge").damage, undefined);
  // The relay only if anyone went down on the bridge; a speaker or a camera in every room where anyone did.
  const fought = roomsFallenIn(c);
  assert.equal(Boolean(partState(game, "comms:relay:bridge").damage), fought.has("bridge"));
  const parts = Object.values(systemsOf(SHIP).parts);
  for (const room of fought) {
    const kinds = parts.filter((part) => part.room === room && ["speaker", "camera"].includes(part.kind));
    if (kinds.length) assert.ok(kinds.some((part) => partState(game, part.id).damage === "broken"), `something in ${room} took a shot`);
  }
  // A fire where most fell, of the rooms with air for it; a plate gone in the Boat Bay.
  const fires = Object.values(game.emergencies?.fires ?? {});
  assert.equal(fires.length, 1);
  assert.ok(fought.has(fires[0].room), `${fires[0].room} was fought in`);
  assert.notEqual(fires[0].room, "names", "the Names Bulkhead, with its vent dead, has no air for a fire");
  assert.deepEqual(Object.values(game.emergencies.breaches).map((one) => one.room), ["boat_bay"]);
  assert.ok(outcome.notes.some((one) => one.startsWith("[FIRE] Fire in ")) && outcome.notes.some((one) => one.startsWith("[BREACH] ")));
  // The galley and the garden go dark with the Names Bulkhead; the medbay, on its own box, doesn't.
  assert.equal(roomPowered(game, SHIP, "galley"), false);
  assert.equal(roomPowered(game, SHIP, "garden"), false);
  assert.equal(roomPowered(game, SHIP, "medbay"), true);
  // The engineers will get to them one at a time, in the file's order: each a repair's time after the one before.
  const order = brokenByBattle(game).sort((a, b) => partState(game, a).fixAt - partState(game, b).fixAt);
  assert.equal(order[0], "power:junction_box:names");
  assert.equal(order[1], "navigation:nav_core:bridge");
  const now = game.clock.hours;
  const step = partState(game, order[0]).fixAt - now;
  order.forEach((id, k) => assert.ok(Math.abs(partState(game, id).fixAt - now - step * (k + 1)) < 1e-6, `${id} is mended ${k + 1} repairs from now`));
});

test("the engineers mend it all one thing at a time, power first, each with a parts crate, and the galley has power again", () => {
  const game = newGame(42);
  quickBattle(game);
  play(game, { event: "continue" });
  const broken = brokenByBattle(game);
  const before = crates(game);
  const fixed = [];
  for (let hour = 0; hour < 24 && brokenByBattle(game).length; hour += 1) {
    for (const line of passTime(game, 1, "routine") ?? []) {
      const found = line.match(/^\[SYSTEMS\] .+ has fixed the (.+) in (.+), with a parts crate/);
      if (found) fixed.push(`${found[1]} in ${found[2]}`);
    }
  }
  assert.deepEqual(brokenByBattle(game), [], "everything the battle broke is mended within a day");
  assert.equal(fixed[0], "junction box in The Names Bulkhead");
  assert.ok(fixed.indexOf("nav core in The Bridge") > 0);
  assert.ok(before - crates(game) >= broken.length, `${broken.length} repairs took ${before - crates(game)} crates`);
  assert.equal(roomPowered(game, SHIP, "galley"), true);
  assert.equal(Object.keys(game.emergencies?.fires ?? {}).length, 0, "the fire's out");
  assert.equal(Object.keys(game.emergencies?.breaches ?? {}).length, 0, "the breach is patched");
});

test("lost, more is broken: the bridge's own power, and another part in every room fought in", () => {
  const game = newGame(43);
  play(game, { event: "start" });
  play(game, { playerText: "Hold the bridge" });
  const c = game.combat;
  game.hp = 1;
  for (const enemy of c.enemies) enemy.attack = 40;
  let outcome = null;
  for (let i = 0; i < 1200 && !outcome; i += 1) {
    const reply = liveTick(game, { ms: 500 });
    if (reply.over) outcome = reply;
  }
  assert.equal(outcome.result, "defeat");
  const line = outcome.notes.find((one) => one.startsWith("[SYSTEMS] Broken in the fighting: "));
  assert.equal((line.match(/the junction box/g) ?? []).length, 2, line);
  assert.match(line, /the junction box, the nav core[^;]* in The Bridge/);
});

test("worked out by the file: the fire goes where the most fell of the rooms with air, and lines held back until they hold", () => {
  const ground = { level: mapFor(SHIP).levels.deck1 };
  const fallen = (room, n) => Array.from({ length: n }, (_, i) => ({ name: `Mutineer #${room.length}${i}`, base: "Mutineer", hp: 0, wounds: [], body: { species: "human" }, live: squareIn(room) }));
  const battle = (after) => ({ id: "test", title: "The Test", target: "The Bridge", after });
  // Three fell in the Names Bulkhead and one on the bridge. With its junction box broken, the Names Bulkhead has no air.
  let game = newGame(44);
  const enemies = [...fallen("names", 3), ...fallen("bridge", 1)];
  battleEnds(game, { allies: [], enemies, battle: battle([{ what: "fire", thickest: true }, { what: "broken", part: "junction box", room: "The Names Bulkhead" }]) }, ground, "victory");
  assert.deepEqual(Object.values(game.emergencies.fires).map((one) => one.room), ["bridge"]);
  // With its power on, the fire's where most fell.
  game = newGame(44);
  battleEnds(game, { allies: [], enemies: [...fallen("names", 3), ...fallen("bridge", 1)], battle: battle([{ what: "fire", thickest: true }]) }, ground, "victory");
  assert.deepEqual(Object.values(game.emergencies.fires).map((one) => one.room), ["names"]);
  // "If you went down" waits for a defeat; "if anyone went down there" for someone fallen in that room.
  game = newGame(44);
  const said = battleEnds(game, { allies: [], enemies: fallen("names", 1), battle: battle([
    { what: "broken", part: "junction box", room: "The Bridge", if: "you" },
    { what: "broken", part: "relay", room: "The Bridge", if: "there" },
    { what: "broken", part: "speaker", room: "The Names Bulkhead", if: "there" },
  ]) }, ground, "victory");
  assert.deepEqual(brokenByBattle(game), ["alarm:speaker:names"]);
  assert.ok(said.includes("[SYSTEMS] Broken in the fighting: the speaker in The Names Bulkhead."), said.join("\n"));
  game = newGame(44);
  battleEnds(game, { allies: [], enemies: fallen("names", 1), battle: battle([{ what: "broken", part: "junction box", room: "The Bridge", if: "you" }]) }, ground, "defeat");
  assert.deepEqual(brokenByBattle(game), ["power:junction_box:bridge"]);
});

test("a part shot up in the fighting says so, and the Medbay has power of its own", () => {
  const game = newGame(45);
  const part = systemsOf(SHIP).parts["comms:relay:bridge"];
  damagePart(game, SHIP, part.id, "broken", { by: "battle" });
  assert.match(lookAt(game, SHIP, part), /It was shot up in the fighting, and it's dead\./);
  // Anything else broken looks as it always has.
  const vent = systemsOf(SHIP).parts["air:vent:bridge"];
  damagePart(game, SHIP, vent.id, "sealed", { by: "player" });
  assert.doesNotMatch(lookAt(game, SHIP, vent), /shot up/);
  assert.equal(systemsOf(SHIP).circuits.medbay, "power:junction_box:medbay");
  damagePart(game, SHIP, "power:junction_box:names", "broken", { by: "battle" });
  assert.deepEqual(["galley", "garden", "names", "medbay"].map((room) => roomPowered(game, SHIP, room)), [false, false, false, true]);
});
