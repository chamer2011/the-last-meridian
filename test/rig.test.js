// The rig, step 2 of the hacking rework: the pocket computer in the pack that carries programs onto computers
// (src/rig.js), its programs as world files (src/programs.js), writing them at the Repair Bay's bench, copying them off
// computers, and what each one does inside a computer (src/computer-use.js).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-rig-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { enterComputer } = await import("../src/computers.js");
const { computerCommand } = await import("../src/computer-use.js");
const { controlSystem, controlsView } = await import("../src/systems.js");
const { passTime, publicState } = await import("../src/rules.js");
const { RIG_MEMORY, rigCommand } = await import("../src/rig.js");
const { parseProgram, programsNow } = await import("../src/programs.js");
const { migrateGame } = await import("../src/migrate.js");
const { walkCommand } = await import("../src/walk.js");

const newGame = () => {
  const game = createGameFromDraft(randomDraft({ seed: 11, archetype: "officer" }));
  game.scene = null;
  return game;
};
// A made-up console aboard that runs the doors and the cameras, for the programs that switch things.
const CONSOLE = { id: "test_console", name: "The test console", classKey: "easy", user: "tech", place: "meridian", desc: "A console for the tests.", files: [{ id: "a", name: "a.txt", text: "Alpha." }, { id: "b", name: "b.txt", text: "Beta." }], mail: [{ id: "m", from: "Oona", to: "Brandt", text: "Gamma." }], logs: [], programs: [], network: [], controls: [{ systems: ["doors", "cameras"], rooms: null }] };
const sitAt = (game, { hacked = true, maxTrace = 6, content = CONSOLE } = {}) => enterComputer(game, { generic: content, hacked, trace: 0, maxTrace, how: "hacked" });
const run = (game, id) => computerCommand(game, { action: "rig", id });
const doorRows = (game) => controlsView(game, "meridian", CONSOLE.controls).find((s) => s.id === "doors")?.rows ?? [];

test("the program files read with nothing wrong, and a bad one says what's wrong", () => {
  const { list, problems } = programsNow();
  assert.deepEqual(problems, []);
  assert.equal(list.length, 24);
  for (const p of list) assert.ok(p.what && p.kind && Number.isFinite(p.hacking), p.id);
  const bad = parseProgram("bad", "# BAD.EXE\nkind: sideways\nhacking: lots\nflavour: yes\n");
  for (const words of ["sideways", "hacking should be a number", "no line called \"flavour\"", "What it does"]) assert.ok(bad.problems.join("\n").includes(words), words);
});

test("a new game's captain has the plain rig in their pack, with DICTIONARY, DOORKEY and MASK loaded", () => {
  const game = newGame();
  assert.equal(game.version, 25);
  assert.equal(game.inventory.rig, 1);
  const rig = publicState(game).rig;
  assert.deepEqual(rig.loaded, ["dictionary", "doorkey", "mask"]);
  assert.equal(rig.used, RIG_MEMORY);
  assert.ok(rig.programs.find((p) => p.id === "knock").owned, "KNOCK comes on every rig");
  assert.ok(rig.programs.find((p) => p.id === "scope").loaded, "SCOPE is built in");
});

test("loading takes memory; unloading frees it; a program the rig has runs whatever your Hacking", () => {
  const game = newGame();
  assert.throws(() => rigCommand(game, { action: "load", id: "knock" }), /free/);
  rigCommand(game, { action: "unload", id: "dictionary" });
  rigCommand(game, { action: "load", id: "knock" });
  assert.deepEqual(game.rig.loaded, ["doorkey", "mask", "knock"]);
  assert.throws(() => rigCommand(game, { action: "load", id: "ghost" }), /doesn't have/);
});

test("what's loaded is settled before sitting down: at a computer the rig won't change until you log off", () => {
  const game = newGame();
  sitAt(game);
  assert.throws(() => rigCommand(game, { action: "unload", id: "dictionary" }), /Log off/);
  assert.deepEqual(game.rig.loaded, ["dictionary", "doorkey", "mask"]);
  computerCommand(game, { action: "logoff" });
  rigCommand(game, { action: "unload", id: "dictionary" });
  assert.deepEqual(game.rig.loaded, ["doorkey", "mask"]);
});

test("writing a program needs the Repair Bay's bench and the Hacking, and takes its hours", () => {
  const game = newGame();
  game.skills.hacking = 3;
  assert.throws(() => rigCommand(game, { action: "write", id: "cleaner" }), /Repair Bay/);
  for (let i = 0; i < 6 && publicState(game).walk?.here?.id !== "repair"; i += 1) walkCommand(game, { action: "go", to: "room:repair" });
  assert.equal(publicState(game).rig.atBench, true);
  const before = game.clock.hours;
  const { said } = rigCommand(game, { action: "write", id: "cleaner" });
  assert.match(said, /2 hours/);
  assert.ok(Math.abs(game.clock.hours - before - 2) < 0.01);
  assert.ok(game.rig.programs.includes("cleaner"));
  assert.throws(() => rigCommand(game, { action: "write", id: "ghost" }), /copied/);
  game.skills.hacking = 1;
  assert.throws(() => rigCommand(game, { action: "write", id: "digger" }), /Hacking 3/);
});

test("inside a hacked computer: MASK lets three actions by, CLEANER takes the trace down, LULLABY slows it", () => {
  const game = newGame();
  game.skills.hacking = 6;
  game.rig.programs.push("cleaner", "lullaby", "blindfold", "cutout", "ghost");
  game.rig.loaded = ["mask", "cleaner", "lullaby"];
  sitAt(game, { maxTrace: 8 });
  run(game, "mask");
  for (let i = 0; i < 4; i += 1) computerCommand(game, { action: "system", system: "doors", row: doorRows(game)[0].id, to: doorRows(game)[0].actions[0].to });
  assert.equal(game.computer.trace, 1, "three switches went by unnoticed; the fourth cost a point");
  game.computer.trace = 5;
  run(game, "cleaner");
  assert.equal(game.computer.trace, 2);
  run(game, "lullaby");
  assert.equal(game.computer.maxTrace, 10);
  assert.match(run(game, "cleaner").said ?? game.computer.screen.lines.map((l) => l.text).join(" "), /already run/);
});

test("CUTOUT keeps a completed trace off the record; without it a ship's main system marks it", () => {
  const game = newGame();
  game.skills.hacking = 6;
  game.rig.programs.push("cutout");
  game.rig.loaded = ["cutout", "doorkey"];
  sitAt(game, { maxTrace: 2, content: { ...CONSOLE, classKey: "hard" } });
  run(game, "cutout");
  const out = computerCommand(game, { action: "system", system: "doors", row: doorRows(game)[0].id, to: doorRows(game)[0].actions[0].to });
  assert.equal(out.over, true);
  assert.ok(!Object.keys(game.story?.record?.facts ?? {}).some((id) => id.startsWith("traced_on")), "nothing on the record");
});

test("DOORKEY unlocks the doors a computer runs without the trace noticing; DIGGER reads everything at once", () => {
  const game = newGame();
  sitAt(game, { maxTrace: 6 });
  const row = doorRows(game)[0];
  if (row.actions.some((a) => a.to === "locked")) controlSystem(game, "meridian", CONSOLE.controls, row.id, "locked", { by: "owner" });
  assert.equal(doorRows(game)[0].word, "locked");
  run(game, "doorkey");
  assert.notEqual(doorRows(game)[0].word, "locked");
  assert.equal(game.computer.trace, 0);
  game.skills.hacking = 3;
  game.rig.programs.push("digger");
  game.rig.loaded = ["digger"];
  run(game, "digger");
  assert.equal(game.computer.read.length, 3);
  assert.ok(game.lore.some((entry) => /Gamma/.test(entry.text)));
});

test("breakers say there's nothing to break once you're in, and a program too weak for the computer won't run", () => {
  const game = newGame();
  sitAt(game, { content: { ...CONSOLE, classKey: "hard" } });
  run(game, "dictionary");
  assert.match(game.computer.screen.lines.map((l) => l.text).join(" "), /already in/);
  run(game, "doorkey");
  assert.match(game.computer.screen.lines.map((l) => l.text).join(" "), /too weak/);
});

test("a computer that holds a program can have it copied; the desktop shows it, and what's loaded", () => {
  const game = newGame();
  enterComputer(game, { id: "meridian_plot_table" });
  const view = publicState(game).computer.rig;
  assert.ok(view.copies.some((p) => p.id === "ghost"));
  assert.ok(view.loaded.some((p) => p.id === "mask"));
  computerCommand(game, { action: "copy", id: "ghost" });
  assert.ok(game.rig.programs.includes("ghost"));
  assert.ok(!publicState(game).computer.rig.copies.some((p) => p.id === "ghost"));
});

test("a sleeper left on a computer that runs doors unlocks them at 02:00", () => {
  const game = newGame();
  game.skills.hacking = 4;
  game.rig.programs.push("sleeper");
  game.rig.loaded = ["sleeper"];
  game.clock.hours = Math.floor(game.clock.hours / 24) * 24 + 20;
  sitAt(game, { hacked: false });
  const row = doorRows(game)[0];
  run(game, "sleeper");
  computerCommand(game, { action: "logoff" });
  controlSystem(game, "meridian", CONSOLE.controls, row.id, doorRows(game)[0].actions.some((a) => a.to === "locked") ? "locked" : "unlocked", { by: "owner" });
  assert.equal(doorRows(game)[0].word, "locked");
  passTime(game, 7);
  assert.notEqual(doorRows(game)[0].word, "locked");
  assert.equal(game.rig.timers.length, 0);
});

test("an old save gets the rig", () => {
  const game = newGame();
  const old = JSON.parse(JSON.stringify({ ...game, version: 24 }));
  delete old.rig;
  delete old.inventory.rig;
  const moved = migrateGame(old);
  assert.equal(moved.version, 25);
  assert.equal(moved.inventory.rig, 1);
  assert.deepEqual(moved.rig.loaded, ["dictionary", "doorkey", "mask"]);
});
