// Weak points, step 8 of the hacking rework (src/weak-points.js): a hardened computer takes no breaker from the front,
// and its way in is written somewhere else at its place: a password in a letter, a session it leaves open, a service
// account the junction boxes still share. Reading one teaches it, and the map marks it.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-weak-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const { consoleContent, enterComputer, openLogon, useConsolePart, writtenContent } = await import("../src/computers.js");
const { computerCommand } = await import("../src/computer-use.js");
const { rigCommand } = await import("../src/rig.js");
const { readWeakLine, hardenedAt } = await import("../src/weak-points.js");
const { readComputerLine } = await import("../public/systems-text.js");
const { parseComputerText, writeComputerText } = await import("../public/world-text.js");
const { checkExtras } = await import("../src/room-hooks.js");
const { startCheck } = await import("../src/checks.js");
const { systemsOf } = await import("../src/systems.js");
const { publicState } = await import("../src/rules.js");
const { WORLD_COMPUTERS } = await import("../src/world.js");
const walk = await import("../src/walk.js");

const OFFICE = "haven_harbor_office";
const newGame = () => {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  game.scene = null;
  game.location = "haven";
  game.walk = null;
  walk.walkView(game);
  return game;
};
const view = (game) => publicState(game).computer;
const run = (game, id) => computerCommand(game, { action: "rig", id });
const why = (game, id) => view(game).logon.ways.find((one) => one.id === id)?.why;
// A program put straight onto the rig, loaded.
const load = (game, id) => {
  if (!game.rig.programs.includes(id)) game.rig.programs.push(id);
  if (!game.rig.loaded.includes(id)) game.rig.loaded.push(id);
};
// At the harbor master's logon, with the rig connected.
const atOffice = (game) => {
  openLogon(game, writtenContent(OFFICE));
  computerCommand(game, { action: "plug" });
  assert.equal(view(game).reach.ok, true);
};
// On the berth board, already in.
const onBoard = (game) => enterComputer(game, { id: "haven_berth_board", hacked: true });
const weakOne = (list, pattern) => list.find((one) => one.id.startsWith("weak_") && pattern.test(one.name));
const setHour = (game, hour) => { game.clock.hours = Math.floor(game.clock.hours / 24) * 24 + hour; };

test("a weak point's line: a password, a session with its hours, a service account, and anything else is a problem", () => {
  assert.deepEqual(readWeakLine("password in mail on haven_berth_board: From the harbor master to Mott: the word is BRINE."), { kind: "password", hours: null, where: { kind: "mail", computer: "haven_berth_board" }, text: "From the harbor master to Mott: the word is BRINE." });
  assert.deepEqual(readWeakLine("session 6:00-8:00 in logs on haven_berth_board: Left open.").hours, ["06:00", "08:00"]);
  assert.deepEqual(readWeakLine("service on the junction boxes: SERVICE ACCT x/x").where, { kind: "bus" });
  assert.match(readWeakLine("the password is under the mat").problem, /password, service or session/);
  // A computer's file keeps them, and reads back as written.
  const text = fs.readFileSync(new URL(`../world/computers/${OFFICE}.txt`, import.meta.url), "utf8");
  const { value, problems } = parseComputerText(text, OFFICE);
  assert.deepEqual(problems, []);
  assert.equal(value.hardened, true);
  assert.equal(value.weakPoints.length, 3);
  assert.equal(writeComputerText(value).trim(), text.replace(/\r/g, "").trim());
  // A console in a systems file is hardened by a word after what it runs, either side of its class.
  assert.equal(readComputerLine("a watch console in The Neutral Ground: cameras, alarm, class moderate, hardened").hardened, true);
  assert.deepEqual(readComputerLine("a watch console in The Neutral Ground: doors, hardened, class hard").systems, ["doors"]);
  assert.equal(readComputerLine("a watch console in The Neutral Ground: doors, class hard").hardened, undefined);
});

test("the harbor master's machine is hardened: no breaker works from the front, and Scope says so", () => {
  const game = newGame();
  load(game, "knock");
  load(game, "skeleton");
  atOffice(game);
  const v = view(game);
  assert.equal(v.hardened, true);
  assert.deepEqual(v.weak, []);
  for (const id of ["knock", "dictionary", "skeleton"]) assert.match(why(game, id), /hardened/, `${id} is refused`);
  assert.ok(v.hints.some((text) => /It's hardened/.test(text)), "the advisor says why");
  run(game, "scope");
  assert.match(game.computer.log.at(-1).text, /hardened: every known flaw is closed/);
  run(game, "dictionary");
  assert.equal(view(game).locked, true, "still at the logon");
});

test("a password in a letter on the berth board: once read, the harbor master's machine lets you straight in", () => {
  const game = newGame();
  onBoard(game);
  const letter = weakOne(view(game).mail, /From the harbor master to Mott/);
  assert.ok(letter, "the berth board has the letter");
  computerCommand(game, { action: "mail", id: letter.id });
  assert.match(game.computer.log.at(-1).text, /You've found a way into The harbor master's machine: its password/);
  assert.ok(game.passwords[OFFICE]);
  // The map marks the harbor master's machine as hardened, with a way in found.
  const node = view(game).netmap.nodes.find((one) => one.id === `c:${OFFICE}`);
  assert.deepEqual([node.hardened, node.weak], [true, true]);
  computerCommand(game, { action: "logoff" });
  openLogon(game, writtenContent(OFFICE));
  assert.equal(view(game).locked, false, "straight in with the password");
});

test("a session left open from 06:00 to 08:00: SHADOW rides it then, and not at any other hour", () => {
  const game = newGame();
  load(game, "shadow");
  onBoard(game);
  const log = weakOne(view(game).logs, /session upstairs/);
  computerCommand(game, { action: "log", id: log.id });
  assert.deepEqual(game.weak[OFFICE].session.hours, ["06:00", "08:00"]);
  computerCommand(game, { action: "logoff" });
  setHour(game, 11);
  atOffice(game);
  assert.match(why(game, "shadow"), /only there from 06:00 to 08:00/);
  assert.match(why(game, "dictionary"), /hardened/, "the other breakers still don't");
  computerCommand(game, { action: "logoff" });
  setHour(game, 6.5);
  atOffice(game);
  assert.equal(why(game, "shadow"), null);
  run(game, "shadow");
  const v = view(game);
  assert.equal(v.locked, false);
  assert.equal(v.user, "harbormaster", "in the harbor master's own name");
  assert.ok(game.computer.log.some((one) => /You ride the session harbormaster leaves open/.test(one.text)));
});

test("a service account the junction boxes still share: their service log shows it, and KNOCK gets in with it", () => {
  const game = newGame();
  const docks = Object.entries(walk.mapFor("haven").rooms).find(([, room]) => room.name === "The Manifest Docks")[0];
  for (let i = 0; i < 6 && publicState(game).walk?.here?.id !== docks; i += 1) walk.walkCommand(game, { action: "go", to: `room:${docks}` });
  game.rig.nextUid += 1;
  const uid = `p${game.rig.nextUid}`;
  game.rig.parts.push({ uid, id: "service_clip", cond: "new", tune: null, from: "" });
  rigCommand(game, { action: "fit", uid, socket: "link1" });
  const box = Object.values(systemsOf("haven").parts).find((one) => one.kind === "junction box" && one.room === docks);
  walk.walkCommand(game, { action: "device-service", key: `part:${box.id}` });
  run(game, "dictionary");
  assert.equal(view(game).locked, false);
  computerCommand(game, { action: "device", id: "svc-log" });
  assert.ok(view(game).device.lines.includes("SVC  SERVICE ACCT harbor/harbor STILL OPENS THE HARBOR OFFICE"));
  assert.ok(game.weak[OFFICE].service);
  assert.match(game.computer.log.at(-1).text, /a service account it still shares, so KNOCK gets in/);
  computerCommand(game, { action: "logoff" });
  // The cable goes back in the link socket for the harbor master's machine.
  rigCommand(game, { action: "fit", uid: game.rig.parts.find((one) => one.id === "cable_jack").uid, socket: "link1" });
  load(game, "knock");
  // KNOCK is a door panel's breaker, far too weak for a hard computer: through the shared account, it's in.
  atOffice(game);
  assert.equal(why(game, "knock"), null);
  run(game, "knock");
  assert.equal(view(game).locked, false);
  assert.equal(view(game).user, "service");
});

test("a console the systems file hardens gets a way in made up for it, written somewhere at its place", () => {
  const game = newGame();
  const part = Object.values(systemsOf("haven").parts).find((one) => one.kind === "console" && one.hardened);
  assert.ok(part, "Haven's watch console is hardened");
  const content = consoleContent(game, "haven", part);
  assert.equal(content.hardened, true);
  const target = hardenedAt("haven").find((one) => one.id === content.id);
  assert.equal(target.lines.length, 1);
  const [wp] = target.lines;
  // It's somewhere the player can read it: on the junction boxes, or on another computer here.
  if (wp.where.kind !== "bus") {
    assert.ok(WORLD_COMPUTERS[wp.where.computer]?.place === "haven");
    onBoard(game);
    computerCommand(game, { action: "logoff" });
    enterComputer(game, { id: wp.where.computer, hacked: true });
    const list = view(game)[wp.where.kind];
    const item = list.find((one) => one.id.startsWith("weak_"));
    const action = { files: "file", mail: "mail", logs: "log" }[wp.where.kind];
    computerCommand(game, { action, id: item.id });
    assert.ok(game.weak[content.id][wp.kind]);
    computerCommand(game, { action: "logoff" });
  }
  // Before it's found, or with only a session or an account known, nothing works from the front without its way.
  const fresh = newGame();
  useConsolePart(fresh, "haven", part);
  computerCommand(fresh, { action: "plug" });
  assert.match(why(fresh, "dictionary"), /hardened/);
  if (wp.kind === "password") {
    useConsolePart(game, "haven", part);
    assert.equal(view(game).locked, false, "the password lets you straight in");
  }
});

test("a hack the story asks for here, naming no computer, never lands on a hardened one", () => {
  const game = newGame();
  startCheck(game, { skill: "hacking", difficulty: "hard", reason: "Get into the records", source: "tool" });
  assert.equal(game.computer.locked, true);
  assert.notEqual(game.computer.id, OFFICE);
  assert.equal(view(game).hardened, false);
});

test("the checker: a weak point it can't read, on a computer that isn't there or is elsewhere, or for nothing", () => {
  assert.deepEqual(checkExtras().filter((text) => /weak point|hardened/i.test(text)), [], "the game's own files are clean");
  WORLD_COMPUTERS.test_hard = { name: "A test machine", place: "haven", hardened: true, weakPoints: ["under the mat: SECRET", "password in mail on nowhere_at_all: x", "password in files on meridian_plot_table: x", "password in files on test_hard: x"] };
  WORLD_COMPUTERS.test_soft = { name: "A soft machine", place: "haven", weakPoints: ["service on the junction boxes: X"] };
  try {
    const found = checkExtras().filter((text) => /test_hard|test_soft/.test(text));
    assert.ok(found.some((text) => /test_hard.*password, service or session/.test(text)));
    assert.ok(found.some((text) => /nowhere_at_all, and there's no computer called that/.test(text)));
    assert.ok(found.some((text) => /meridian_plot_table, which is at another place/.test(text)));
    assert.ok(found.some((text) => /on the computer itself/.test(text)));
    assert.ok(found.some((text) => /test_soft.*isn't hardened/.test(text)));
  } finally {
    delete WORLD_COMPUTERS.test_hard;
    delete WORLD_COMPUTERS.test_soft;
  }
});
