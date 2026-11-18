// The test save (tools/test-save.mjs, src/test-mode.js): the Meridian's fuel stays full, the rig counts as built with
// whatever a hack needs and has every program there is, while a game that isn't a test save plays as it always did.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-test-save-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const { openDoorPanel } = await import("../src/computers.js");
const { computerCommand } = await import("../src/computer-use.js");
const { rigLinks, reachWhy } = await import("../src/devices.js");
const { rigCommand, rigNow, rigView } = await import("../src/rig.js");
const { programsNow } = await import("../src/programs.js");
const { passTime, publicState, travel } = await import("../src/rules.js");
const { migrateGame } = await import("../src/migrate.js");

const newGame = (test = null) => {
  const draft = randomDraft({ seed: 31, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  game.scene = null;
  if (test) game.test = test;
  return game;
};
const view = (game) => publicState(game).computer;
const everyId = () => programsNow().list.map((p) => p.id).sort();
const told = (game) => game.transcript.filter((entry) => /^\[TEST\] Every hacking program/.test(entry.text)).length;

test("on a test save the Meridian's tank stays full through days and a jump; on any other game it runs down", () => {
  const plain = newGame();
  const tested = newGame({ fuel: true, rig: true });
  tested.ship.fuel = 2;
  passTime(plain, 24 * 6);
  passTime(tested, 24 * 6);
  assert.ok(plain.ship.fuel < 6, `a plain game burns fuel keeping station (${plain.ship.fuel} left)`);
  assert.equal(tested.ship.fuel, tested.ship.maxFuel, "the test save's tank is topped up");
  travel(tested, "haven");
  assert.equal(tested.location, "haven");
  assert.equal(tested.ship.fuel, tested.ship.maxFuel, "and stays full after a jump");
});

test("on a test save the rig reaches anything and has what a hack needs, with none of its parts", () => {
  const plain = newGame();
  const tested = newGame({ fuel: true, rig: true });
  assert.deepEqual(rigLinks(plain), ["cable"], "a new rig has a cable jack");
  assert.deepEqual(rigLinks(tested).sort(), ["cable", "clip", "navy", "optic", "radio"]);
  // Even taken apart: no core, no cell, no link.
  tested.rig.build.fit = {};
  plain.rig.build.fit = {};
  assert.match(rigNow(plain).dead, /no core/);
  const stats = rigNow(tested);
  assert.deepEqual([stats.dead, stats.power, stats.memory >= 24, stats.heat], [null, 3, true, 0]);
  // A keypad takes an optical reader, which neither has: the test save's rig connects anyway.
  openDoorPanel(plain, "meridian", "bridge");
  assert.match(reachWhy(plain, { look: "door", door: "bridge" }), /optical reader/);
  openDoorPanel(tested, "meridian", "bridge");
  assert.equal(view(tested).reach.fits, true);
  computerCommand(tested, { action: "plug" });
  assert.equal(view(tested).reach.ok, true, "connected by a link it hasn't got");
});

test("tools/test-save.mjs writes the test save in its own slot, and never over one already there unless asked", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-test-save-tool-"));
  const run = (...args) => execFileSync(process.execPath, ["tools/test-save.mjs", ...args], { env: { ...process.env, GAME_DATA_DIR: dir }, encoding: "utf8", stdio: "pipe" });
  assert.match(run(), /Test save written/);
  const file = path.join(dir, "saves", "test.json");
  const game = migrateGame(JSON.parse(fs.readFileSync(file, "utf8")));
  assert.deepEqual([game.test.fuel, game.test.rig], [true, true]);
  // Every program is on its rig from the start, and its story says so in its first note, not in a second one.
  assert.deepEqual([...game.test.programs].sort(), everyId());
  assert.ok(rigView(game).programs.every((p) => p.owned && p.loaded));
  assert.equal(game.transcript.filter((entry) => /Every hacking program is on/.test(entry.text)).length, 1);
  assert.equal(game.ship.fuel, game.ship.maxFuel);
  assert.equal(game.scene ?? null, null, "past the opening");
  assert.ok(game.transcript.some((entry) => /^\[TEST\]/.test(entry.text)));
  assert.deepEqual(fs.readdirSync(path.join(dir, "saves")), ["test.json"], "no other save is touched");
  assert.throws(() => run(), /test save already/);
  assert.match(run("--again"), /Test save written/);
});

test("on a test save the rig has every program, loaded: given once, so one that's unloaded stays unloaded", () => {
  const all = programsNow().list;
  assert.ok(all.length >= 24, `${all.length} programs`);
  const plain = newGame();
  const tested = newGame({ fuel: true, rig: true });
  const mine = [...plain.rig.programs];
  assert.ok(mine.length < all.length, "a new rig has only a few");
  // The first time its clock moves, they're all there, and it says so once.
  const notes = passTime(tested, 0.1, "routine");
  assert.equal(notes.filter((note) => /^\[TEST\] Every hacking program is on your rig now/.test(note)).length, 1);
  assert.deepEqual([...tested.rig.programs].sort(), everyId());
  for (const p of all) assert.ok(p.builtIn || tested.rig.loaded.includes(p.id), `${p.name} is loaded`);
  const shown = rigView(tested);
  assert.ok(shown.programs.every((p) => p.owned && p.loaded), "the Rig page has them all, loaded");
  assert.ok(all.reduce((n, p) => n + (p.builtIn ? 0 : p.size), 0) <= shown.memory, "and its memory holds them all");
  assert.equal(passTime(tested, 0.1, "routine").filter((note) => /Every hacking program/.test(note)).length, 0, "said once");
  // Unloaded on the Rig page, one stays unloaded: through time, and through the save being opened again.
  rigCommand(tested, { action: "unload", id: "dictionary" });
  passTime(tested, 2, "routine");
  assert.ok(!tested.rig.loaded.includes("dictionary"));
  const again = migrateGame(JSON.parse(JSON.stringify(tested)));
  assert.ok(!again.rig.loaded.includes("dictionary"));
  assert.ok(again.rig.programs.includes("dictionary"), "it's still on the rig, to load again");
  assert.equal(told(again), 0, "and nothing more is said");
  // A game that isn't a test save keeps the rig it has.
  passTime(plain, 2, "routine");
  assert.deepEqual(migrateGame(JSON.parse(JSON.stringify(plain))).rig.programs, mine);
  assert.equal(plain.test, undefined);
});

test("a test save from before this gets every program the moment it's opened, and its story says so once", () => {
  // As the save file was: the two switches, and the rig a new captain starts with.
  const before = JSON.parse(JSON.stringify(newGame({ fuel: true, rig: true })));
  assert.equal(before.test.programs, undefined);
  const opened = migrateGame(before);
  assert.deepEqual([...opened.rig.programs].sort(), everyId());
  assert.ok(rigView(opened).programs.every((p) => p.owned && p.loaded));
  assert.equal(told(opened), 1);
  // Opened again, and after time has passed, nothing more is given or said.
  const twice = migrateGame(JSON.parse(JSON.stringify(opened)));
  assert.equal(told(twice), 1);
  assert.equal(passTime(twice, 0.1, "routine").filter((note) => /Every hacking program/.test(note)).length, 0);
  // A program written into the world later joins the rest: one it was never given is given.
  twice.test.programs = twice.test.programs.filter((id) => id !== "worm");
  twice.rig.programs = twice.rig.programs.filter((id) => id !== "worm");
  twice.rig.loaded = twice.rig.loaded.filter((id) => id !== "worm");
  passTime(twice, 0.1, "routine");
  assert.ok(twice.rig.programs.includes("worm") && twice.rig.loaded.includes("worm"));
  assert.equal(told(twice), 1, "without saying it all over again");
});
