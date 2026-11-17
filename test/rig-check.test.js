// The rig's check of its own parts, which it shows on its screen each time it comes out of the pocket (step 2 of the
// rig's plan; src/rig.js rigCheck, drawn by public/computer.js): a line to each kind of part in its sockets with how
// those are, a kind it can't start without that isn't fitted, and why it won't start when it won't.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-rig-check-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { openDoorPanel } = await import("../src/computers.js");
const { rigCheck, rigCommand } = await import("../src/rig.js");
const { publicState } = await import("../src/rules.js");

const newGame = () => {
  const game = createGameFromDraft(randomDraft({ seed: 11, archetype: "officer" }));
  game.scene = null;
  return game;
};
const partNamed = (game, id) => game.rig.parts.find((one) => one.id === id);
const lineOf = (game, slot) => rigCheck(game).lines.find((line) => line.slot === slot) ?? null;

test("a new rig checks every kind of part it's built from, and all of it is in order", () => {
  const check = rigCheck(newGame());
  assert.equal(check.board, "YARD BOARD");
  assert.deepEqual(check.lines, [
    { slot: "CORE", name: "STOCK CORE", state: "OK" },
    { slot: "MEMORY", name: "2 + 2 BLOCKS", state: "OK" },
    { slot: "CELL", name: "STANDARD CELL", state: "OK" },
    { slot: "SINK", name: "FIN SINK", state: "OK" },
    { slot: "LINK", name: "CABLE JACK", state: "OK" },
  ]);
  assert.equal(check.dead, null);
});

test("a worn part says so, and of two of a kind the worse one counts", () => {
  const game = newGame();
  partNamed(game, "fin_sink").cond = "worn";
  assert.deepEqual(lineOf(game, "SINK"), { slot: "SINK", name: "FIN SINK", state: "WORN" });
  assert.equal(rigCheck(game).dead, null, "a worn rig still starts");
  const [first, second] = game.rig.parts.filter((one) => one.id === "memory_2");
  first.cond = "worn";
  assert.equal(lineOf(game, "MEMORY").state, "WORN");
  second.cond = "broken";
  assert.equal(lineOf(game, "MEMORY").state, "BROKEN");
  assert.equal(lineOf(game, "MEMORY").name, "2 + 2 BLOCKS");
  assert.equal(rigCheck(game).dead, null, "broken memory is less memory, not a rig that won't start");
});

test("a broken core is shown broken, and the rig says why it won't start", () => {
  const game = newGame();
  partNamed(game, "stock_core").cond = "broken";
  const check = rigCheck(game);
  assert.deepEqual(check.lines[0], { slot: "CORE", name: "STOCK CORE", state: "BROKEN" });
  assert.match(check.dead, /core/);
});

test("a part it can't start without that's been taken out is missing, and one it can do without has no line", () => {
  const game = newGame();
  rigCommand(game, { action: "remove", uid: partNamed(game, "cable_jack").uid });
  rigCommand(game, { action: "remove", uid: partNamed(game, "fin_sink").uid });
  const check = rigCheck(game);
  assert.deepEqual(check.lines.map((line) => line.slot), ["CORE", "MEMORY", "CELL", "LINK"]);
  assert.deepEqual(lineOf(game, "LINK"), { slot: "LINK", name: "NONE FITTED", state: "MISSING" });
  assert.match(check.dead, /link/);
  // One block of memory is a block, not blocks.
  const [first] = game.rig.parts.filter((one) => one.id === "memory_2");
  rigCommand(game, { action: "remove", uid: first.uid });
  assert.equal(lineOf(game, "MEMORY").name, "2 BLOCKS");
});

test("a test save's rig lists the parts it really has, and always starts", () => {
  const game = newGame();
  rigCommand(game, { action: "remove", uid: partNamed(game, "stock_core").uid });
  assert.match(rigCheck(game).dead, /core/);
  game.test = { rig: true };
  const check = rigCheck(game);
  assert.deepEqual(check.lines[0], { slot: "CORE", name: "NONE FITTED", state: "MISSING" });
  assert.equal(check.dead, null);
});

test("it goes with every computer's view, for the page to play as the rig comes out", () => {
  const game = newGame();
  partNamed(game, "fin_sink").cond = "worn";
  openDoorPanel(game, "meridian", "bridge");
  const view = publicState(game).computer;
  assert.deepEqual(view.rigCheck, rigCheck(game));
  assert.equal(view.rigCheck.lines.find((line) => line.slot === "SINK").state, "WORN");
  // No rig, nothing to check.
  const none = newGame();
  none.rig = null;
  assert.equal(rigCheck(none), null);
});
