// The test save (tools/test-save.mjs, src/test-mode.js): the Meridian's fuel stays full, and the rig counts as built with
// whatever a hack needs, while a game that isn't a test save plays as it always did.

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
const { rigNow } = await import("../src/rig.js");
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
  assert.deepEqual(game.test, { fuel: true, rig: true });
  assert.equal(game.ship.fuel, game.ship.maxFuel);
  assert.equal(game.scene ?? null, null, "past the opening");
  assert.ok(game.transcript.some((entry) => /^\[TEST\]/.test(entry.text)));
  assert.deepEqual(fs.readdirSync(path.join(dir, "saves")), ["test.json"], "no other save is touched");
  assert.throws(() => run(), /test save already/);
  assert.match(run("--again"), /Test save written/);
});
