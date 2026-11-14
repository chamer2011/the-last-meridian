// The story knows your rig, step 10 of the hacking rework (src/story-rig.js): scenes, talks and asks can ask what's on
// the rig and what the player did on computers, give programs, parts and tools, plant a way in, seal a system; the
// player's deeds go on the record; and the Story board has pages for programs and rig parts.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-story-rig-"));
// The board saves into copies of the programs and the parts, never the game's own.
const copyOf = (folder) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `meridian-${folder}-`));
  for (const name of fs.readdirSync(new URL(`../world/${folder}`, import.meta.url))) fs.copyFileSync(new URL(`../world/${folder}/${name}`, import.meta.url), path.join(dir, name));
  return dir;
};
process.env.GAME_PROGRAMS_DIR = copyOf("programs");
process.env.GAME_RIG_PARTS_DIR = copyOf("rig-parts");

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const { conditionHolds, parseCondition, parseEffect, parseSceneText } = await import("../src/scene-text.js");
const { storyCommand } = await import("../src/command.js");
const { enterComputer, openLogon, useComputer, writtenContent } = await import("../src/computers.js");
const { computerCommand } = await import("../src/computer-use.js");
const { readRecord } = await import("../src/record.js");
const { factsLeft, loadScenes, sceneProblems } = await import("../src/scenes.js");
const { storyRequest } = await import("../src/request-hook.js");
const { boardWorldItem, boardWorldList, saveBoardWorldItem } = await import("../src/board.js");
const { programById } = await import("../src/programs.js");
const { rigCommand } = await import("../src/rig.js");
const { shipSystemsView, systemsOf } = await import("../src/systems.js");
const { parseWorldText, writeWorldText, PROGRAM, RIG_PART } = await import("../public/world-text.js");
const { publicState } = await import("../src/rules.js");
const walk = await import("../src/walk.js");
const talks = await import("../src/talks.js");

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
const holds = (game, text) => {
  assert.deepEqual(parseCondition(text).problems, [], text);
  return conditionHolds(game, text);
};
const play = (game, text) => storyCommand(game, parseEffect(text).do);
const facts = (game) => readRecord(game).facts.map((one) => one.id);
const thing = (id) => {
  for (const level of Object.values(walk.mapFor(SHIP).levels)) {
    const found = level.things.find((one) => one.computer === id);
    if (found) return { thing: found, room: level.roomAt(found.x, found.y) };
  }
  return null;
};
// Onto the ship's network by cable at the medbay's records terminal, then on to the plot table.
const onTable = (game) => {
  enterComputer(game, { id: "meridian_medbay_records" });
  computerCommand(game, { action: "plug" });
  computerCommand(game, { action: "hop", id: "c:meridian_plot_table" });
};
function talkTo(game, key, ...lines) {
  walk.bringOver(game, [key]);
  walk.talkCommand(game, { action: "open", person: key });
  talks.openWrittenTalk(game);
  const said = [];
  for (const words of lines) talks.writtenTalkTurn({ game, playerText: words, emit: (e) => { if (e.text) said.push(e.text); } });
  walk.closeTalk(game);
  return said.join("\n");
}

test("the words: what can be asked about the rig and the computers, what can be given and changed, and what's wrong", () => {
  for (const text of ["rig program mapper", "rig loaded dictionary", "rig part cable_jack", "rig link cable", "rig tool soldering_kit", "computer meridian_security_desk hacked", "computer meridian_armory_panel sealed", "recoded The Armory at meridian"]) assert.deepEqual(parseCondition(text).problems, [], text);
  assert.match(parseCondition("rig program nothing").problems[0], /there's no program called nothing/);
  assert.match(parseCondition("rig link wifi").problems[0], /cable, clip, optic, radio, navy/);
  assert.match(parseCondition("computer nope in").problems[0], /there's no computer called nope/);
  assert.match(parseCondition("computer meridian_ledger owned").problems[0], /in, hacked, network, trusted, sealed, password/);
  assert.deepEqual(parseEffect("weak meridian_ledger session 18:00-19:30: Brandt let it slip").do, { command: "weak", id: "meridian_ledger", kind: "session", hours: ["18:00", "19:30"], reason: "Brandt let it slip" });
  assert.deepEqual(parseEffect("rig part short_radio worn: found in a drawer").do, { command: "rig_part", id: "short_radio", cond: "worn", reason: "found in a drawer" });
  assert.match(parseEffect("rig program mapper").problem, /needs a colon and the reason/);
  assert.match(parseEffect("weak meridian_ledger password 06:00-07:00: no").problem, /only a session has hours/);
  assert.match(parseEffect("seal nothing_here: x").problem, /no computer called nothing_here/);
  // The checker reads them in a scene like anything else.
  const { scene, problems } = parseSceneText("== start\nSomething.\n? rig program nothing -> start\n* rig tool no_such_tool: x\n> Go -> end\n== end\nThe end.\nEND\n", "test_rig");
  const found = [...problems.map((one) => one.message ?? String(one)), ...sceneProblems(scene, "test_rig")];
  assert.ok(found.some((one) => /no program called nothing/.test(one)), JSON.stringify(found));
  assert.ok(found.some((one) => /no tool called no_such_tool/.test(one)), JSON.stringify(found));
});

test("what's on the rig, asked and given: programs, parts and tools", () => {
  const game = newGame();
  assert.deepEqual([holds(game, "rig loaded dictionary"), holds(game, "rig program mapper"), holds(game, "rig link cable"), holds(game, "rig part short_radio"), holds(game, "rig tool soldering_kit")], [true, false, true, false, false]);
  assert.match(play(game, "rig program mapper: Sorel's copy")[0], /^\[RIG\] MAPPER\.EXE is on your rig/);
  assert.match(play(game, "rig part short_radio worn: found in a drawer")[0], /Short radio \(worn\) goes with your rig's spare parts/);
  play(game, "rig tool soldering_kit: Marrow's old kit");
  assert.deepEqual([holds(game, "rig program mapper"), holds(game, "rig part short_radio"), holds(game, "rig tool soldering_kit")], [true, true, true]);
  assert.equal(game.rig.parts.find((one) => one.id === "short_radio").cond, "worn");
  assert.deepEqual(play(game, "rig program mapper: again"), [], "given twice, it's there once");
  // The radio fitted, the link the rig reaches by is a radio.
  rigCommand(game, { action: "fit", uid: game.rig.parts.find((one) => one.id === "short_radio").uid, socket: "link1" });
  assert.equal(holds(game, "rig link radio"), true);
});

test("a way in planted, and a system sealed and opened again by the story", () => {
  const game = newGame();
  play(game, "weak meridian_security_desk password: Tarrow told you over a drink");
  assert.equal(holds(game, "computer meridian_security_desk password"), true);
  const desk = thing("meridian_security_desk");
  useComputer(game, { place: SHIP, levelId: desk.room, thing: desk.thing });
  assert.equal(view(game).locked, false, "straight in with the word the story gave");
  computerCommand(game, { action: "logoff" });
  // The plot table sealed: Use refuses, and the map says so; opened again, it's the captain's as before.
  assert.match(play(game, "seal meridian_plot_table: the officers have locked it down")[0], /The plot table is sealed, and takes nothing at its own keyboard: the officers/);
  assert.equal(holds(game, "computer meridian_plot_table sealed"), true);
  const table = Object.values(walk.mapFor(SHIP).levels).flatMap((level) => level.things.map((one) => ({ one, level }))).find(({ one }) => /plot table/i.test(one.name));
  assert.match(useComputer(game, { place: SHIP, levelId: table.level.roomAt(table.one.x, table.one.y), thing: table.one }).said, /The plot table is sealed: .* answers only to the first officer's terminal/);
  enterComputer(game, { id: "meridian_medbay_records" });
  computerCommand(game, { action: "plug" });
  assert.equal(view(game).netmap.nodes.find((one) => one.id === "c:meridian_plot_table").sealed, true);
  assert.match(computerCommand(game, { action: "hop", id: "c:meridian_plot_table" }).said, /sealed/);
  computerCommand(game, { action: "logoff" });
  play(game, "unseal meridian_plot_table: they've stood down");
  assert.equal(holds(game, "computer meridian_plot_table sealed"), false);
  assert.match(useComputer(game, { place: SHIP, levelId: table.level.roomAt(table.one.x, table.one.y), thing: table.one }).said, /You sit down/);
});

test("what the player does on computers goes on the record, and the story can ask about it", () => {
  const game = newGame();
  // Over the network, with a password: Voss's terminal.
  game.passwords = { meridian_first_officer: true };
  onTable(game);
  computerCommand(game, { action: "hop", id: "c:meridian_first_officer" });
  assert.equal(holds(game, "computer meridian_first_officer network"), true);
  assert.equal(holds(game, "computer meridian_first_officer hacked"), false);
  // Let in by trust, then a new code for the Armory's door.
  game.passwords.meridian_security_desk = true;
  computerCommand(game, { action: "hop", id: "c:meridian_security_desk" });
  computerCommand(game, { action: "hop", id: "door:armory" });
  assert.equal(holds(game, "computer meridian_armory_panel trusted"), true);
  computerCommand(game, { action: "device", id: "door-recode" });
  assert.equal(holds(game, "recoded The Armory"), true);
  computerCommand(game, { action: "logoff" });
  // A line struck from the ship's log at the plot table.
  game.ship.log.push({ day: "Day 1, 09:00", tag: "SHIP", text: "A line to strike." });
  enterComputer(game, { id: "meridian_plot_table" });
  computerCommand(game, { action: "device", id: `nav-strike:${game.ship.log.length - 1}` });
  computerCommand(game, { action: "logoff" });
  // A camera looped, reached over the network from the plot table.
  onTable(game);
  const camera = view(game).netmap.nodes.find((one) => one.kind === "camera" && one.linked);
  computerCommand(game, { action: "hop", id: camera.id });
  computerCommand(game, { action: "device", id: "cam-loop" });
  computerCommand(game, { action: "logoff" });
  // Broken into, with a breaker: Haven's berth board.
  game.location = "haven";
  game.walk = null;
  openLogon(game, writtenContent("haven_berth_board"));
  computerCommand(game, { action: "plug" });
  computerCommand(game, { action: "rig", id: "dictionary" });
  assert.equal(holds(game, "computer haven_berth_board hacked"), true);
  computerCommand(game, { action: "logoff" });
  const on = facts(game);
  for (const id of ["got_into_meridian_first_officer", "got_into_meridian_security_desk", "got_into_meridian_armory_panel", "recoded_meridian_armory", "struck_from_the_ships_log", "looped_a_camera_at_meridian", "got_into_haven_berth_board"]) assert.ok(on.includes(id), `${id} is on the record`);
  const record = readRecord(game).facts;
  assert.match(record.find((one) => one.id === "got_into_meridian_armory_panel").text, /over the network, by being let in from the security desk/);
  assert.match(record.find((one) => one.id === "got_into_haven_berth_board").text, /by breaking in/);
  assert.ok(!on.includes("got_into_meridian_plot_table"), "the captain's own computers leave nothing");
  // The checker knows every one of them, and the computers' programs' facts too.
  const known = factsLeft(loadScenes().scenes);
  for (const id of ["got_into_meridian_ledger", "recoded_meridian_armory", "looped_a_camera_at_meridian", "blinded_a_camera_at_haven", "struck_from_the_ships_log", "navigation_locked", "reactor_scrammed"]) assert.ok(known.has(id), `the checker knows ${id}`);
});

test("Sorel looks at your rig and gives you MAPPER, and the helm officer asks for the navigation back", () => {
  const game = newGame();
  const said = talkTo(game, "iven", "Ask him about your rig", "Ask if he has anything for it");
  assert.match(said, /Yard board, plain case, a cable jack/);
  assert.ok(game.rig.programs.includes("mapper"), "MAPPER is on the rig");
  // The navigation locked from its core, through the comms relay: the helm officer has something to ask.
  onTable(game);
  computerCommand(game, { action: "hop", id: "part:comms:relay:bridge" });
  computerCommand(game, { action: "hop", id: "c:meridian_nav_core" });
  computerCommand(game, { action: "program", id: view(game).programs.find((one) => /Lock/.test(one.name)).id });
  computerCommand(game, { action: "logoff" });
  assert.equal(game.systems[SHIP].parts["navigation:nav_core:bridge"].on, false);
  storyRequest(game, parseEffect("request navigation_locked: the core is locked").do);
  assert.ok(game.requests?.open?.navigation_locked, "the ask is open");
  const asker = game.requests.open.navigation_locked.asker;
  assert.equal(asker, "pell", "the helm officer, Pell, asks");
  talkTo(game, "pell", "Unlock it");
  assert.notEqual(game.systems?.[SHIP]?.parts?.["navigation:nav_core:bridge"]?.on, false, "the navigation's unlocked");
  assert.equal(game.flags.navigation_locked, undefined, "and the fact taken off the record");
});

test("the Ship menu leaves the Armory's door alone: its panel answers only to the security desk", () => {
  const game = newGame();
  const doors = shipSystemsView(game).find((one) => one.id === "doors").rows.map((row) => row.name);
  assert.ok(doors.length >= 5 && !doors.some((name) => /Armory/.test(name)));
  assert.ok(systemsOf(SHIP).doors.armory);
});

test("the Story board has pages for programs and rig parts, read and saved as the game reads them", () => {
  assert.equal(boardWorldList("program").length, 24);
  assert.equal(boardWorldList("part").length, 25);
  const ghost = boardWorldItem("program", "ghost");
  assert.deepEqual(ghost.links.foundOn.map((one) => one.name), ["The plot table"]);
  assert.equal(ghost.links.kindName, "Staying quiet");
  const reader = boardWorldItem("part", "optical_reader");
  assert.equal(reader.links.made.tool, "Soldering kit");
  assert.equal(reader.links.reaches, "through its optical port");
  // Every file reads back as written.
  for (const [folder, spec] of [["programs", PROGRAM], ["rig-parts", RIG_PART]]) {
    for (const name of fs.readdirSync(new URL(`../world/${folder}`, import.meta.url)).filter((one) => one.endsWith(".txt") && !one.startsWith("_"))) {
      const text = fs.readFileSync(new URL(`../world/${folder}/${name}`, import.meta.url), "utf8").replace(/\r/g, "");
      assert.equal(writeWorldText(parseWorldText(text, spec, name).value, spec).trim(), text.trim(), `${folder}/${name} reads back`);
    }
  }
  // A kind the game doesn't know is refused, and a good change is saved and read again at once.
  const bad = ghost.text.replace("kind: quiet", "kind: magic");
  assert.equal(saveBoardWorldItem("program", "ghost", bad).saved, false);
  const cheaper = ghost.text.replace("hacking: 7", "hacking: 6");
  assert.deepEqual(saveBoardWorldItem("program", "ghost", cheaper), { saved: true, problems: [] });
  assert.equal(programById("ghost").hacking, 6);
  assert.match(fs.readFileSync(path.join(process.env.GAME_PROGRAMS_DIR, "ghost.txt"), "utf8"), /hacking: 6/);
});
