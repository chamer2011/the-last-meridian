// No free way in, step 3 of the hacking rework: a computer that isn't the player's opens at its logon, the breakers
// off their rig get them in if they're strong enough for its class, and the watcher counts the noise they make from
// the first try (src/computers.js, src/computer-use.js, src/rig.js). Practice, scenes, doors and old saves.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-logon-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { hackingClasses, startCheck } = await import("../src/checks.js");
const { computerView, enterComputer, openDoorPanel, watchFor } = await import("../src/computers.js");
const { computerCommand } = await import("../src/computer-use.js");
const { settleDeed } = await import("../src/deeds.js");
const { migrateGame } = await import("../src/migrate.js");
const { readRecord } = await import("../src/record.js");
const { DEEDS } = await import("../src/world.js");

const newGame = (hacking = 0) => {
  const game = createGameFromDraft(randomDraft({ seed: 11, archetype: "officer" }));
  game.scene = null;
  game.skills.hacking = hacking;
  game.perks = [];
  game.traits = [];
  game.inventory = { rig: 1 };
  game.equipped = { weapon: null, armor: null };
  game.ideology = { authority: 0, loyalty: 0, violence: 0, belief: 0, flesh: 0 };
  return game;
};
// A made-up computer that isn't the player's, of whichever class.
const TERMINAL = { id: "test_terminal", name: "The test terminal", classKey: "moderate", user: "oona", place: "haven", desc: "A terminal for the tests.", files: [{ id: "a", name: "a.txt", text: "Alpha." }], mail: [], logs: [], programs: [], network: [], controls: [] };
const logonAt = (game, classKey = "moderate") => enterComputer(game, { generic: { ...TERMINAL, classKey }, locked: true });
const run = (game, id) => computerCommand(game, { action: "rig", id });
const why = (game, id) => computerView(game).logon.ways.find((way) => way.id === id)?.why ?? null;
const lines = (game) => game.computer.log.map((one) => one.text ?? "").join(" ");

test("at a logon nothing on the computer shows, only the breakers and Scope run, and a strong enough breaker gets in", () => {
  const game = newGame();
  game.rig.loaded = ["dictionary", "knock", "doorkey"];
  logonAt(game);
  const view = computerView(game);
  assert.equal(view.locked, true);
  assert.equal(view.files.length + view.programs.length + view.systems.length, 0);
  assert.equal(view.user, null);
  assert.deepEqual(view.logon.ways.map((way) => way.id).sort(), ["dictionary", "knock", "scope"]);
  assert.match(why(game, "knock"), /too weak for a crew terminal/);
  assert.equal(why(game, "dictionary"), null);
  assert.match(computerCommand(game, { action: "file", id: "a" }).said, /Log on first/);
  run(game, "doorkey");
  assert.match(game.computer.screen.lines.map((l) => l.text).join(" "), /log on first/);
  run(game, "dictionary");
  assert.equal(game.computer.locked, false);
  assert.equal(game.computer.hacked, true);
  assert.equal(game.computer.noise, 3, "DICTIONARY's noise came first");
  assert.equal(game.computer.minutes, 6);
  assert.match(lines(game), /ACCESS GRANTED\. Welcome, oona/);
  assert.equal(computerView(game).files.length, 1, "past the logon, the computer shows");
});

test("SKELETON needs Scope to read the logon first, MIMIC a lifted keycard, and SHADOW someone at work, one louder after", () => {
  const game = newGame();
  game.rig.programs.push("skeleton", "mimic", "shadow");
  game.rig.loaded = ["skeleton", "mimic", "shadow"];
  logonAt(game, "hard");
  assert.match(why(game, "skeleton"), /Scope has to read the logon first/);
  assert.match(why(game, "mimic"), /too weak/);
  run(game, "scope");
  assert.equal(game.computer.scanned, true);
  assert.equal(why(game, "skeleton"), null);
  run(game, "skeleton");
  assert.equal(game.computer.locked, false);
  assert.equal(game.computer.user, "service");
  computerCommand(game, { action: "logoff" });

  logonAt(game, "moderate");
  assert.match(why(game, "mimic"), /keycard/);
  game.inventory.keycard = 1;
  assert.equal(why(game, "mimic"), null);
  run(game, "mimic");
  assert.equal(game.computer.user, "keycard");
  assert.equal(game.computer.noise, 0, "MIMIC is silent");
  computerCommand(game, { action: "logoff" });

  game.clock.hours = Math.floor(game.clock.hours / 24) * 24 + 3;
  logonAt(game, "moderate");
  assert.match(why(game, "shadow"), /at this hour/);
  computerCommand(game, { action: "logoff" });
  game.clock.hours += 8;
  logonAt(game, "moderate");
  run(game, "shadow");
  assert.equal(game.computer.shadow, true);
  const before = game.computer.noise;
  computerCommand(game, { action: "file", id: "a" });
  assert.equal(game.computer.noise, before, "reading's still free");
  assert.equal(game.computer.user, "oona", "riding Oona's session");
});

test("the watcher's marks are set by the class and raised by training, from a door panel to the Beacon", () => {
  const untrained = newGame(0);
  const master = newGame(10);
  const panel = watchFor(untrained, "easy");
  const beacon = watchFor(untrained, "nearly_impossible");
  assert.ok(panel.cuts > beacon.cuts && panel.traces > beacon.traces && panel.notices > beacon.notices);
  assert.ok(panel.notices < panel.traces && panel.traces < panel.cuts);
  assert.equal(panel.mark, false);
  assert.equal(watchFor(untrained, "hard").mark, true);
  assert.ok(watchFor(master, "hard").cuts > watchFor(untrained, "hard").cuts);
  assert.equal(hackingClasses().length, 5);
  assert.equal(hackingClasses()[0].name, "Door panel");
  assert.equal(hackingClasses().at(-1).difficulty, "nearly_impossible");
});

test("a breaker's own noise can get the player cut off at the logon, and a scene that asked hears it failed", () => {
  const game = newGame();
  const watch = watchFor(game, "hard");
  // Aboard the Meridian every computer is the captain's own: this is somewhere else.
  game.location = "haven";
  startCheck(game, { skill: "hacking", difficulty: "hard", reason: "Get into the bridge", source: "tool" });
  assert.equal(game.computer.locked, true);
  game.rig.programs.push("skeleton");
  game.rig.loaded = ["skeleton"];
  run(game, "scope");
  game.computer.noise = watch.cuts - 1;
  const out = run(game, "skeleton");
  assert.equal(out.over, true);
  assert.equal(game.computer, null);
  assert.equal(game.lastCheck.success, false);
  assert.equal(game.lastCheck.reason, "Get into the bridge");
  assert.ok(game.transcript.some((entry) => /^\[HACK\] Get into the bridge: CUT OFF/.test(entry.text)));
  assert.ok(readRecord(game).facts.some((fact) => fact.id === "traced_on_ships_main_system"), "a ship's main system marks it");
});

test("logging off at the logon gets the player nowhere, and the story hears so", () => {
  const game = newGame();
  game.location = "haven";
  startCheck(game, { skill: "hacking", difficulty: "moderate", reason: "Peek", source: "choice" });
  computerCommand(game, { action: "logoff" });
  assert.equal(game.computer, null);
  assert.equal(game.lastCheck.success, false);
  assert.ok(game.transcript.some((entry) => /^\[HACK\] Peek: NOT IN/.test(entry.text)));
  assert.match(game.transcript.at(-1).text, /didn't get in/);
});

test("practice counts for nothing: no time, no line, no learning, nothing left behind, and it's never the player's own", () => {
  const game = newGame(3);
  game.rig.programs.push("sleeper");
  game.rig.loaded = ["dictionary", "sleeper"];
  const before = { hours: game.clock.hours, lines: game.transcript.length, xp: JSON.stringify(game.skillXp ?? {}) };
  startCheck(game, { skill: "hacking", difficulty: "moderate", reason: "Practice", source: "practice" });
  assert.equal(game.computer.practice, true);
  assert.equal(game.computer.yours, false, "even aboard the Meridian");
  assert.equal(game.computer.locked, true);
  run(game, "dictionary");
  assert.equal(game.computer.locked, false);
  run(game, "sleeper");
  assert.match(game.computer.screen.lines.map((l) => l.text).join(" "), /in practice nothing's left behind/);
  computerCommand(game, { action: "logoff" });
  assert.equal(game.computer, null);
  assert.equal(game.clock.hours, before.hours);
  assert.equal(game.transcript.length, before.lines);
  assert.equal(JSON.stringify(game.skillXp ?? {}), before.xp);
  assert.equal(game.rig.timers.length, 0);
});

test("a door's panel opens at its logon, and a map file's door opens once the player is in, or says it stays shut", () => {
  const game = newGame();
  game.location = "foundry";
  const rule = { place: "foundry", to: "sublevels", pass: "The door swings in.", fail: "The keypad goes dark." };
  openDoorPanel(game, "foundry", "sublevels", { classKey: "hard", doorRule: rule });
  assert.equal(game.computer.id, "foundry_sublevel_panel");
  assert.equal(game.computer.locked, true);
  computerCommand(game, { action: "logoff" });
  assert.match(game.transcript.map((entry) => entry.text).join(" "), /\[DOOR\] The keypad goes dark\./);
  assert.ok(!(game.opened?.foundry ?? []).includes("sublevels"));
  game.rig.programs.push("skeleton");
  game.rig.loaded = ["skeleton"];
  openDoorPanel(game, "foundry", "sublevels", { classKey: "hard", doorRule: rule });
  run(game, "scope");
  run(game, "skeleton");
  assert.equal(game.computer.locked, false);
  assert.ok(game.opened.foundry.includes("sublevels"));
  assert.match(game.transcript.at(-1).text, /\[DOOR\] The door swings in\./);
});

test("the advisor at a logon says more the more training there is", () => {
  const hints = (hacking) => {
    const game = newGame(hacking);
    logonAt(game);
    return computerView(game).hints;
  };
  const untrained = hints(0);
  const master = hints(10);
  assert.ok(untrained.some((line) => /DICTIONARY\.EXE gets you in, and it's loud/.test(line)), untrained.join(" | "));
  assert.ok(!untrained.some((line) => /noise and/.test(line)), "no numbers untrained");
  assert.ok(hints(2).some((line) => /3 noise and 6 minutes/.test(line)));
  assert.ok(hints(5).some((line) => /notices you at \d+ noise/.test(line)));
  assert.ok(master.some((line) => /after it it stays calm|after it it notices you/.test(line)), master.join(" | "));
  assert.ok(master.some((line) => /quietest way in you have is DICTIONARY/.test(line)));
  assert.ok(master.length > untrained.length);
});

test("a pocket picked clean now and then brings a keycard", () => {
  const game = newGame();
  const keep = DEEDS.pickpocket.keycard;
  DEEDS.pickpocket.keycard = 1;
  try {
    game.personAsked = { how: "pickpocket", place: "meridian", room: "mess", key: "crowd:1", id: null, name: "Cook Imre", short: "Imre" };
    const lines = settleDeed(game, { success: true });
    assert.match(lines.join(" "), /and a keycard/);
    assert.equal(game.inventory.keycard, 1);
  } finally {
    DEEDS.pickpocket.keycard = keep;
  }
});

test("an old save keeps the computer it's on, with its trace turned into noise, and closes an old hacking window", () => {
  const game = newGame();
  const old = JSON.parse(JSON.stringify({ ...game, version: 25 }));
  old.computer = { id: "test_terminal", name: "The test terminal", classKey: "moderate", className: "Crew terminal", user: "oona", place: "haven", yours: false, hacked: true, trace: 3, maxTrace: 6, how: "hacked", generic: TERMINAL, screen: { kind: "home" }, log: [], actions: 4, read: [], ran: [], startedAt: old.clock.hours, roomId: null, at: null };
  old.check = { id: 1, skill: "hacking", game: "crack", difficulty: "moderate", state: {}, log: [] };
  const moved = migrateGame(old);
  assert.equal(moved.version, 28);
  assert.equal(moved.computer.locked, false);
  assert.equal(moved.computer.trace, undefined);
  assert.ok(moved.computer.noise > 0 && moved.computer.noise < watchFor(moved, "moderate").traces, `noise ${moved.computer.noise}`);
  assert.equal(moved.computer.minutes, 8);
  assert.equal(moved.check, null);
  assert.match(moved.transcript.at(-1).text, /Use the computer again, and it opens at its logon/);
  computerCommand(moved, { action: "file", id: "a" });
  assert.ok(moved.computer, "it carries on");
});
