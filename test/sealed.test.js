// Sealed systems, step 9 of the hacking rework (src/sealed.js): a sealed computer takes nothing at its own keyboard
// and lets in only the machines it trusts, with what you can do set by where you came from; and the Meridian's private
// terminals, which aren't the captain's by right.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-sealed-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const { enterComputer, openDoorPanel, openLogon, useComputer, writtenContent } = await import("../src/computers.js");
const { computerCommand } = await import("../src/computer-use.js");
const { readTrustLine } = await import("../src/sealed.js");
const { parseComputerText, writeComputerText } = await import("../public/world-text.js");
const { checkExtras } = await import("../src/room-hooks.js");
const { doorActions, doorLocked, doorLook, systemsOf } = await import("../src/systems.js");
const { publicState } = await import("../src/rules.js");
const { WORLD_COMPUTERS } = await import("../src/world.js");
const walk = await import("../src/walk.js");

const SHIP = "meridian";
const newGame = () => {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  game.scene = null;
  return game;
};
const view = (game) => publicState(game).computer;
const hop = (game, id) => computerCommand(game, { action: "hop", id });
// Onto the ship's network by cable at the medbay's records terminal (the captain's own), then on to the plot table.
const onTable = (game) => {
  enterComputer(game, { id: "meridian_medbay_records" });
  computerCommand(game, { action: "plug" });
  assert.equal(hop(game, "c:meridian_plot_table").computer, true);
};
// The thing the game stood for a written computer, with the room it's in.
const stood = (id) => {
  for (const level of Object.values(walk.mapFor(SHIP).levels)) {
    const thing = level.things.find((one) => one.computer === id);
    if (thing) return { thing, room: level.roomAt(thing.x, thing.y) };
  }
  return null;
};
const read = (game, kind, pattern) => {
  const item = view(game)[kind].find((one) => pattern.test(one.name));
  assert.ok(item, `${kind} has ${pattern}`);
  return computerCommand(game, { action: { mail: "mail", files: "file", logs: "log" }[kind], id: item.id });
};

test("a trust line: the machine it trusts and what it may do there, and anything else is a problem", () => {
  assert.deepEqual(readTrustLine("meridian_security_desk: the door"), { from: "meridian_security_desk", rights: ["the door"] });
  assert.deepEqual(readTrustLine("the comms relay: navigation, reading"), { from: "the comms relay", rights: ["navigation", "reading"] });
  assert.deepEqual(readTrustLine("the plot table: crew file and programs").rights, ["the crew file", "programs"]);
  assert.match(readTrustLine("the plot table: the keys to the ship").problem, /isn't something a machine can be trusted with/);
  assert.match(readTrustLine("everything").problem, /a colon/);
  for (const id of ["meridian_armory_panel", "meridian_nav_core", "meridian_plot_table"]) {
    const text = fs.readFileSync(new URL(`../world/computers/${id}.txt`, import.meta.url), "utf8");
    const { value, problems } = parseComputerText(text, id);
    assert.deepEqual(problems, []);
    assert.ok(value.trusts.length, `${id} trusts something`);
    assert.equal(writeComputerText(value).trim(), text.replace(/\r/g, "").trim(), `${id} reads back as written`);
  }
});

test("a sealed computer takes nothing at its own keyboard, or from anything it doesn't trust, and no time goes by", () => {
  const game = newGame();
  const safety = stood("meridian_reactor_safety");
  assert.equal(safety.room, "engineering", "the game stood the safety controller in Engineering");
  assert.match(useComputer(game, { place: SHIP, levelId: safety.room, thing: safety.thing }).said, /^The reactor safety controller is sealed: it takes nothing at its own keyboard, and answers only to the reactor gauges\.$/);
  assert.equal(game.computer ?? null, null);
  assert.throws(() => openDoorPanel(game, SHIP, "armory"), /The Armory's panel is sealed: .* answers only to the security desk/);
  onTable(game);
  const map = view(game).netmap;
  assert.deepEqual(["sealed", "trusted"].map((key) => map.nodes.find((one) => one.id === "door:armory")[key]), [true, false]);
  const before = game.clock.hours;
  assert.match(hop(game, "door:armory").said, /sealed: it takes nothing at its own keyboard, and answers only to the security desk/);
  assert.equal(game.clock.hours, before, "a refused hop takes no time");
  assert.equal(game.computer.id, "meridian_plot_table");
});

test("from a machine it trusts it lets you straight in, with only what that trust allows", () => {
  const game = newGame();
  // The navigation core from the plot table: its files and logs, and nothing it runs.
  onTable(game);
  assert.equal(view(game).netmap.nodes.find((one) => one.id === "c:meridian_nav_core").trusted, true);
  assert.equal(hop(game, "c:meridian_nav_core").computer, true);
  let v = view(game);
  assert.equal(v.locked, false);
  assert.deepEqual([v.files.length > 0, v.logs.length > 0, v.systems.length, v.programs.length], [true, true, 0, 0]);
  assert.deepEqual(v.through, { name: "the plot table", words: "read what's on it", sealed: true });
  computerCommand(game, { action: "logoff" });
  // From the comms relay: its programs, which lock and unlock the navigation, and nothing to read.
  onTable(game);
  hop(game, "part:comms:relay:bridge");
  assert.equal(view(game).name, "The comms relay");
  hop(game, "c:meridian_nav_core");
  v = view(game);
  assert.deepEqual([v.files.length, v.logs.length, v.programs.map((one) => one.name)], [0, 0, ["Lock the navigation"]]);
  assert.equal(v.through.words, "run its programs");
  computerCommand(game, { action: "program", id: v.programs[0].id });
  assert.equal(game.systems[SHIP].parts["navigation:nav_core:bridge"].on, false, "every jump is plotted by hand now");
  assert.ok(game.computer.log.some((one) => /ACCESS GRANTED: it trusts the comms relay\./.test(one.text)));
  assert.equal(computerCommand(game, { action: "file", id: "jump_log_txt" }).said, "No such file.", "nothing there to read from the relay");
  computerCommand(game, { action: "logoff" });
  // The plot table no longer works navigation itself: that's the core's, through the relay.
  enterComputer(game, { id: "meridian_plot_table" });
  assert.ok(!view(game).systems.some((one) => one.id === "navigation"));
  computerCommand(game, { action: "logoff" });
  // The reactor safety controller from the gauges: everything, its scram among it.
  enterComputer(game, { id: "meridian_reactor_gauges" });
  computerCommand(game, { action: "plug" });
  hop(game, "c:meridian_reactor_safety");
  v = view(game);
  assert.deepEqual(v.programs.map((one) => one.name), ["Scram the reactor"]);
  computerCommand(game, { action: "program", id: v.programs[0].id });
  assert.equal(game.systems[SHIP].parts["engines:engines:engineering"].on, false, "the drive is down");
  assert.deepEqual(view(game).programs.map((one) => one.name), ["Bring the reactor back up"]);
});

test("NAVCOM's crew file is sealed at the plot table, and opens from the first officer's terminal", () => {
  const game = newGame();
  enterComputer(game, { id: "meridian_plot_table" });
  let crew = view(game).device.crew;
  assert.deepEqual([crew.list.length, crew.sealed], [0, "Sealed: it opens only from the first officer's terminal."]);
  computerCommand(game, { action: "logoff" });
  // Voss's word, in a letter to the doctor on the medbay's records terminal.
  enterComputer(game, { id: "meridian_medbay_records" });
  read(game, "mail", /From Voss to Dr\. Aduro/);
  assert.ok(game.passwords.meridian_first_officer);
  computerCommand(game, { action: "logoff" });
  openLogon(game, writtenContent("meridian_first_officer"));
  assert.equal(view(game).locked, false, "straight in with her word");
  computerCommand(game, { action: "plug" });
  hop(game, "c:meridian_plot_table");
  const v = view(game);
  crew = v.device.crew;
  assert.ok(crew.list.length >= 4 && !crew.sealed, "the crew file is open from her terminal");
  assert.match(crew.by, /Voss/);
  assert.equal(v.through.words, "open the crew file");
  assert.equal(v.systems.length > 0, true, "and the captain's own plot table is still all theirs");
});

test("the first officer's terminal, the security desk and the ledger are private: stood in their rooms, at a logon, with ways in written by hand", () => {
  const game = newGame();
  assert.deepEqual(["meridian_first_officer", "meridian_security_desk", "meridian_ledger"].map((id) => stood(id)?.room), ["chart", "aft", "mess"]);
  for (const id of ["meridian_first_officer", "meridian_security_desk", "meridian_ledger"]) {
    assert.ok(!WORLD_COMPUTERS[id].yours && WORLD_COMPUTERS[id].hardened, `${id} is private and hardened`);
  }
  const voss = stood("meridian_first_officer");
  assert.match(useComputer(game, { place: SHIP, levelId: voss.room, thing: voss.thing }).said, /wants a logon/);
  assert.equal(view(game).locked, true);
  assert.equal(view(game).hardened, true);
  // Aboard the captain's own ship plugging in isn't tampering, even at a private terminal, and nothing says it is.
  assert.equal(view(game).reach.seen, false);
  computerCommand(game, { action: "logoff" });
  // Her session left open at the watch change is in the captain's own log, and SHADOW rides it then.
  enterComputer(game, { id: "meridian_plot_table" });
  read(game, "logs", /first officer's terminal stays signed in/);
  assert.deepEqual(game.weak.meridian_first_officer.session.hours, ["05:30", "06:30"]);
  computerCommand(game, { action: "logoff" });
  game.rig.programs.push("shadow");
  game.rig.loaded = ["shadow"];
  game.clock.hours = Math.floor(game.clock.hours / 24) * 24 + 24 + 6;
  openLogon(game, writtenContent("meridian_first_officer"));
  computerCommand(game, { action: "plug" });
  computerCommand(game, { action: "rig", id: "shadow" });
  assert.deepEqual([view(game).locked, view(game).user], [false, "voss"]);
  // Her letters hold the security desk's and the ledger's words.
  assert.deepEqual(view(game).mail.filter((one) => /to Voss/.test(one.name)).map((one) => one.name).sort(), ["From Brandt to Voss", "From Tarrow to Voss"]);
  read(game, "mail", /From Tarrow to Voss/);
  read(game, "mail", /From Brandt to Voss/);
  assert.ok(game.passwords.meridian_security_desk && game.passwords.meridian_ledger);
  hop(game, "c:meridian_ledger");
  assert.deepEqual([view(game).name, view(game).locked], ["The quartermaster's ledger", false]);
  // And the junction boxes still share an account with each.
  const lines = busLines();
  assert.ok(lines.some((text) => /STILL OPENS THE SECURITY DESK/.test(text)) && lines.some((text) => /STILL OPENS THE LEDGER/.test(text)));
});
// The junction boxes' service log aboard, as a box's menu shows it.
function busLines() {
  const game = newGame();
  enterComputer(game, { id: "meridian_reactor_gauges" });
  computerCommand(game, { action: "plug" });
  const box = Object.values(view(game).netmap.nodes).find((one) => one.kind === "junction" && one.linked);
  hop(game, box.id);
  computerCommand(game, { action: "device", id: "svc-log" });
  return view(game).device.lines;
}

test("the security desk works the Armory's door through its sealed panel, and nothing else does", () => {
  const game = newGame();
  // The plot table runs the ship's doors, but not the Armory's.
  enterComputer(game, { id: "meridian_plot_table" });
  const rows = view(game).systems.find((one) => one.id === "doors").rows.map((one) => one.name);
  assert.ok(rows.length >= 5 && !rows.some((name) => /Armory/.test(name)));
  computerCommand(game, { action: "logoff" });
  game.passwords = { ...(game.passwords ?? {}), meridian_security_desk: true };
  const desk = stood("meridian_security_desk");
  useComputer(game, { place: SHIP, levelId: desk.room, thing: desk.thing });
  assert.equal(view(game).locked, false, "the desk's word lets you straight in");
  computerCommand(game, { action: "plug" });
  assert.equal(view(game).netmap.nodes.find((one) => one.id === "door:armory").trusted, true);
  hop(game, "door:armory");
  let v = view(game);
  assert.deepEqual([v.look, v.locked, v.through.words], ["door", false, "work the door"]);
  computerCommand(game, { action: "device", id: "door-lock" });
  assert.equal(doorLocked(game, SHIP, "armory"), true);
  // At the door itself: locked, its panel sealed, and nothing to hack.
  const exit = { to: "armory", key: "test" };
  assert.deepEqual(doorActions(game, SHIP, "passage", exit).map((one) => one.id), ["force"]);
  assert.match(doorLook(game, SHIP, "passage", exit), /It's locked, and the panel beside it is red\. The panel is sealed and answers only to the security desk\.$/);
  computerCommand(game, { action: "device", id: "door-unlock" });
  assert.equal(doorLocked(game, SHIP, "armory"), false);
});

test("the checker: a trust line it can't read, a machine that isn't there or isn't linked, and a seal nothing can open", () => {
  assert.deepEqual(checkExtras().filter((text) => /trust|sealed/i.test(text)), [], "the game's own files are clean");
  WORLD_COMPUTERS.test_vault = { name: "A test vault", place: SHIP, sealed: true, trusts: ["the keys: everything", "nowhere_at_all: reading", "test_vault: reading", "meridian_plot_table: the door, the crew file"] };
  WORLD_COMPUTERS.test_shut = { name: "A shut box", place: SHIP, sealed: true };
  const ledger = WORLD_COMPUTERS.meridian_ledger.trusts;
  WORLD_COMPUTERS.meridian_ledger.trusts = ["meridian_reactor_gauges: reading"];
  try {
    const found = checkExtras().filter((text) => /test_vault|test_shut|meridian_ledger/.test(text));
    assert.ok(found.some((text) => /the keys, which isn't a computer or a system/.test(text)));
    assert.ok(found.some((text) => /nowhere_at_all, which isn't a computer or a system/.test(text)));
    assert.ok(found.some((text) => /meridian_ledger.*trusts Reactor gauges, but the two aren't linked/.test(text)));
    assert.ok(found.some((text) => /trusts itself/.test(text)));
    assert.ok(found.some((text) => /only NAVCOM 7 has a crew file/.test(text)));
    assert.ok(found.some((text) => /"the door" is for a door's panel/.test(text)));
    assert.ok(found.some((text) => /test_shut.*trusts nothing, so nothing can ever get in/.test(text)));
  } finally {
    delete WORLD_COMPUTERS.test_vault;
    delete WORLD_COMPUTERS.test_shut;
    WORLD_COMPUTERS.meridian_ledger.trusts = ledger;
  }
  assert.equal(systemsOf(SHIP).doors.armory?.to, "armory", "the Armory's door is one of the ship's systems");
});
