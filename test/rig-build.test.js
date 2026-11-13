// The rig built from parts, step 4 of the hacking rework: a casing round a board, the board's sockets each holding a
// part (world/rig-parts, src/rig-parts.js), what a build adds up to, the heat a session builds, the bench's jobs (src/rig.js),
// and what the rig does to a session at a computer (src/computer-use.js).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-rig-build-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { enterComputer, watchFor } = await import("../src/computers.js");
const { computerCommand } = await import("../src/computer-use.js");
const { HEAT, parseRigPart, partNumbers, rigPartsNow, rigStats, rigWeight } = await import("../src/rig-parts.js");
const { giveStartingBuild, rigCommand, rigNow } = await import("../src/rig.js");
const { loadOf } = await import("../src/bag.js");
const { countAboard } = await import("../src/logistics.js");
const { migrateGame } = await import("../src/migrate.js");
const { publicState } = await import("../src/rules.js");
const { walkCommand } = await import("../src/walk.js");

const newGame = ({ engineering = 2 } = {}) => {
  const game = createGameFromDraft(randomDraft({ seed: 11, archetype: "officer" }));
  game.scene = null;
  game.skills.engineering = engineering;
  return game;
};
const toBench = (game) => {
  for (let i = 0; i < 6 && publicState(game).walk?.here?.id !== "repair"; i += 1) walkCommand(game, { action: "go", to: "room:repair" });
  assert.equal(publicState(game).rig.atBench, true);
};
const partNamed = (game, id) => game.rig.parts.find((one) => one.id === id);
const TERMINAL = { id: "test_terminal", name: "The test terminal", classKey: "easy", user: "oona", place: "haven", desc: "A terminal.", files: [{ id: "a", name: "a.txt", text: "Alpha." }], mail: [], logs: [], programs: [], network: [], controls: [] };

test("the part files read with nothing wrong, and a bad one says what's wrong", () => {
  const { list, problems } = rigPartsNow();
  assert.deepEqual(problems, []);
  assert.equal(list.length, 21);
  const yard = list.find((p) => p.id === "yard");
  assert.deepEqual(yard.sockets.map((s) => s.key), ["core1", "sink1", "memory1", "link1", "cell1", "memory2"]);
  assert.equal(list.find((p) => p.id === "navy").sockets.find((s) => s.kind === "extra").gate, 7);
  assert.deepEqual(list.find((p) => p.id === "open_frame").made, { scrap: 2, engineering: 1, hours: 2 });
  const bad = parseRigPart("bad", "# Bad\nkind: board\nsockets: core at 1 1, cupholder at 2 1\nheat: lots\n");
  for (const words of ["cupholder", "heat should be a number", "needs a cell socket", "What it is"]) assert.ok(bad.problems.join("\n").includes(words), words);
});

test("a new rig is the plain yard build: four blocks, cool, and its weight is its parts'", () => {
  const game = newGame();
  const stats = rigNow(game);
  assert.equal(stats.memory, 4);
  assert.equal(stats.power, 0);
  assert.equal(stats.speed, 1);
  assert.equal(stats.heat, 0, "the fin sink takes the core's heat, and the plain case the rest");
  assert.equal(stats.dead, null);
  assert.equal(stats.weight, rigWeight(game.rig));
  assert.ok(Math.abs(stats.weight - 1.45) < 1e-9);
  const view = publicState(game).rig.build;
  assert.equal(view.sockets.length, 6);
  assert.equal(view.sockets.find((s) => s.key === "core1").part.name, "Stock core");
  assert.equal(view.stats.fanAfter, HEAT.fan * HEAT.minutesAPoint);
  // The pack weighs the rig by its parts.
  const before = loadOf(game);
  game.rig.parts.push({ uid: "x1", id: "navy", cond: "new", tune: null, from: "" });
  assert.ok(Math.abs(loadOf(game) - before - 0.6) < 0.11);
});

test("worn parts give half and run warmer, broken ones nothing, and a rig won't start without a working core, cell and link", () => {
  const game = newGame();
  const memory = partNamed(game, "memory_2");
  memory.cond = "worn";
  assert.equal(partNumbers(memory).fx.memory, 1);
  assert.equal(rigNow(game).memory, 3);
  memory.cond = "broken";
  assert.equal(rigNow(game).memory, 2);
  const cell = partNamed(game, "standard_cell");
  cell.cond = "broken";
  assert.match(rigNow(game).dead, /standard cell is broken/);
  cell.cond = "new";
  delete game.rig.build.fit.link1;
  assert.match(rigNow(game).dead, /no link/);
});

test("a heat sink cools only the sockets beside it, so where a part goes matters", () => {
  const game = newGame();
  const rig = game.rig;
  assert.equal(rigNow(game).sockets.find((s) => s.key === "core1").cooled, 1);
  // Put the sink where it touches nothing hot (a sink in a memory socket doesn't fit, so: out of the board): the
  // core's heat comes through.
  const sink = rig.build.fit.sink1;
  delete rig.build.fit.sink1;
  assert.ok(sink);
  const stats = rigNow(game);
  assert.equal(stats.sockets.find((s) => s.key === "core1").cooled, 0);
  assert.equal(stats.heat, 0, "one point of the core's, less the plain case's one");
  partNamed(game, "stock_core").tune = "over";
  assert.equal(rigNow(game).heat, 2, "overclocked, the core runs three, the case takes one");
});

test("fitting a spare part, taking one out, and a part that doesn't go in that socket", () => {
  const game = newGame();
  const rig = game.rig;
  const spare = { uid: "s1", id: "memory_4", cond: "new", tune: null, from: "A test." };
  rig.parts.push(spare);
  assert.ok(publicState(game).rig.build.box.some((one) => one.uid === "s1"));
  assert.throws(() => rigCommand(game, { action: "fit", uid: "s1", socket: "core1" }), /doesn't go in a core socket/);
  rigCommand(game, { action: "fit", uid: "s1", socket: "memory2" });
  assert.equal(rigNow(game).memory, 6);
  const out = publicState(game).rig.build.box.find((one) => one.id === "memory_2");
  assert.ok(out, "the 2-block memory that was there is a spare part now");
  // A memory part out takes memory with it, and what no longer fits comes off.
  const said = rigCommand(game, { action: "remove", uid: "s1" }).said;
  rigCommand(game, { action: "remove", uid: rig.build.fit.memory1 });
  assert.equal(rigNow(game).memory, 0);
  assert.deepEqual(rig.loaded, []);
  assert.match(said, /comes out/);
  // Not at a computer.
  enterComputer(game, { generic: TERMINAL, hacked: true });
  assert.throws(() => rigCommand(game, { action: "fit", uid: "s1", socket: "memory2" }), /Log off/);
});

test("at the bench: overclocking takes Engineering and hours, mending a parts crate, the lathe scrap, and taking apart gives scrap", () => {
  const game = newGame({ engineering: 0 });
  const core = partNamed(game, "stock_core");
  assert.throws(() => rigCommand(game, { action: "tune", uid: core.uid, how: "over" }), /Repair Bay/);
  toBench(game);
  assert.throws(() => rigCommand(game, { action: "tune", uid: core.uid, how: "over" }), /Engineering 1/);
  game.skills.engineering = 2;
  const before = game.clock.hours;
  rigCommand(game, { action: "tune", uid: core.uid, how: "over" });
  assert.equal(core.tune, "over");
  assert.ok(Math.abs(game.clock.hours - before - 2) < 0.01);
  assert.equal(rigNow(game).speed, 1.3);
  core.cond = "worn";
  const crates = countAboard(game, "meridian", "parts_crate").n;
  rigCommand(game, { action: "mend", uid: core.uid });
  assert.equal(core.cond, "new");
  assert.equal(countAboard(game, "meridian", "parts_crate").n, crates - 1, "a parts crate from the ship's stores");
  core.cond = "broken";
  assert.throws(() => rigCommand(game, { action: "rebuild", uid: core.uid }), /2 scrap/);
  const spare = { uid: "s2", id: "memory_4", cond: "broken", tune: null, from: "" };
  game.rig.parts.push(spare, { uid: "s3", id: "slim", cond: "new", tune: null, from: "" });
  rigCommand(game, { action: "apart", uid: "s3" });
  assert.equal(game.inventory.scrap, 2, "a board gives two");
  assert.throws(() => rigCommand(game, { action: "apart", uid: core.uid }), /can't be done/);
  rigCommand(game, { action: "rebuild", uid: core.uid });
  assert.equal(core.cond, "worn", "the lathe gives back a worn part");
  assert.ok(!game.inventory.scrap);
  rigCommand(game, { action: "apart", uid: "s2" });
  rigCommand(game, { action: "make", id: "scrap_memory" });
  assert.ok(game.rig.parts.some((one) => one.id === "scrap_memory" && one.from.includes("Made at the bench")));
});

test("a session warms the rig: the fan is heard and louder, then it overheats, slower, and the hottest part wears at log-off", () => {
  const game = newGame();
  partNamed(game, "stock_core").tune = "over";
  enterComputer(game, { generic: TERMINAL, hacked: true });
  const session = game.computer;
  const read = () => computerCommand(game, { action: "file", id: "a" });
  read();
  assert.equal(session.minutes, 2, "two minutes over a speed of 1.3 is still two, rounded up");
  while (game.computer && !session.fanOn) read();
  assert.ok(session.minutes >= (HEAT.fan - rigNow(game).heat) * HEAT.minutesAPoint);
  assert.match(session.log.map((one) => one.text).join(" "), /fan comes on/);
  // Anything noisy is one louder with the fan on: SCOPE makes one, and it's heard as two. Reading stays free.
  const noise = session.noise;
  computerCommand(game, { action: "rig", id: "scope" });
  assert.equal(session.noise, noise + 2);
  while (game.computer && !session.overheated) read();
  const minutes = session.minutes;
  read();
  assert.equal(session.minutes - minutes, 4, "overheating doubles the minutes");
  computerCommand(game, { action: "logoff" });
  assert.match(game.transcript.at(-1).text, /ran too hot: the stock core is worn now/);
  assert.equal(partNamed(game, "stock_core").cond, "worn");
});

test("the rig's quiet takes noise off, its power is added to a program's, and the echo buffer helps CLEANER", () => {
  const game = newGame();
  const rig = game.rig;
  rig.parts.push({ uid: "f1", id: "ghost_foil", cond: "new", tune: null, from: "" }, { uid: "n1", id: "navy", cond: "new", tune: null, from: "" });
  rigCommand(game, { action: "casing", uid: "f1" });
  assert.equal(rigNow(game).quiet, 2);
  enterComputer(game, { generic: { ...TERMINAL, classKey: "moderate" }, hacked: true });
  computerCommand(game, { action: "rig", id: "scope" });
  assert.equal(game.computer.noise, 0, "SCOPE's one noise, less the foil's one");
  computerCommand(game, { action: "logoff" });
  // The Navy board's power lets DICTIONARY at a ship's main system.
  game.rig.loaded = ["dictionary"];
  enterComputer(game, { generic: { ...TERMINAL, classKey: "hard" }, locked: true });
  assert.match(publicState(game).computer.logon.ways.find((w) => w.id === "dictionary").why, /too weak/);
  computerCommand(game, { action: "logoff" });
  rigCommand(game, { action: "board", uid: "n1" });
  assert.equal(rigNow(game).power, 1);
  assert.equal(rigNow(game).sockets.filter((s) => s.uid).length, 6, "the yard's parts all found a socket on the Navy board");
  enterComputer(game, { generic: { ...TERMINAL, classKey: "hard" }, locked: true });
  assert.equal(publicState(game).computer.logon.ways.find((w) => w.id === "dictionary").why, null);
  computerCommand(game, { action: "logoff" });
  // An echo buffer only fits the Navy board's extra socket, which opens from Hacking 7.
  rig.parts.push({ uid: "e1", id: "echo_buffer", cond: "new", tune: null, from: "" });
  assert.throws(() => rigCommand(game, { action: "fit", uid: "e1", socket: "extra1" }), /Hacking 7/);
  game.skills.hacking = 7;
  rigCommand(game, { action: "fit", uid: "e1", socket: "extra1" });
  rig.programs.push("cleaner");
  rig.loaded = ["cleaner"];
  const watch = watchFor(game, "easy");
  enterComputer(game, { generic: TERMINAL, hacked: true, noise: watch.notices + 2 });
  computerCommand(game, { action: "rig", id: "cleaner" });
  assert.equal(game.computer.noise, watch.notices + 2 - 5, "three, and the buffer's two");
});

test("an old save's rig gets the yard build, holding what it had loaded", () => {
  const game = newGame();
  const old = JSON.parse(JSON.stringify({ ...game, version: 26 }));
  old.rig = { programs: old.rig.programs, loaded: ["dictionary", "doorkey", "mask"], timers: [] };
  const moved = migrateGame(old);
  assert.equal(moved.version, 27);
  assert.equal(moved.rig.parts.length, 8);
  assert.deepEqual(moved.rig.loaded, ["dictionary", "doorkey", "mask"]);
  assert.equal(rigStats(moved.rig).memory, 4);
  const again = giveStartingBuild({ programs: [], loaded: [], timers: [] });
  assert.equal(rigStats(again).dead, null);
});
