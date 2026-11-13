// More computers, step 6 of the hacking rework (src/devices.js): which computers a rig's link reaches, a door's panel
// that can give its door a new code, a junction box's service menu that cuts a room's power, a camera's feed that can
// be looped or blinded, and NAVCOM 7, the ship's main system, with the crew assessments and the ship's log.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-devices-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const { openDoorPanel, writtenContent } = await import("../src/computers.js");
const { computerCommand } = await import("../src/computer-use.js");
const { reachOf, reachWhy, rigLinks, rigReaches, lookOf } = await import("../src/devices.js");
const { rigCommand } = await import("../src/rig.js");
const { doorLocked, roomPowered, setDoor, systemsOf, watched } = await import("../src/systems.js");
const { holderKey, regardFor } = await import("../src/command.js");
const { passTime, publicState } = await import("../src/rules.js");
const walk = await import("../src/walk.js");

const newGame = () => {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  game.scene = null;
  return game;
};
const toRoom = (game, room) => {
  for (let i = 0; i < 6 && publicState(game).walk?.here?.id !== room; i += 1) walk.walkCommand(game, { action: "go", to: `room:${room}` });
  assert.equal(publicState(game).walk?.here?.id, room);
};
// A link put in the rig's link socket, as the Rig page does it.
function fitLink(game, id) {
  game.rig.nextUid += 1;
  const uid = `p${game.rig.nextUid}`;
  game.rig.parts.push({ uid, id, cond: "new", tune: null, from: "" });
  rigCommand(game, { action: "fit", uid, socket: "link1" });
}
const view = (game) => publicState(game).computer;
const device = (game, id) => computerCommand(game, { action: "device", id });
const partOfKind = (place, kind, room = null) => Object.values(systemsOf(place).parts).find((one) => one.kind === kind && (!room || one.room === room));
const roomNamed = (place, name) => Object.entries(walk.mapFor(place).rooms).find(([, room]) => room.name === name)?.[0];

test("each kind of computer takes one kind of link, and the rig's link decides which it reaches", () => {
  const game = newGame();
  assert.deepEqual(rigLinks(game), ["cable"]);
  const plot = writtenContent("meridian_plot_table");
  assert.equal(lookOf(plot), "navcom");
  assert.equal(reachOf(plot), "navy");
  assert.equal(reachOf(writtenContent("haven_berth_board")), "cable");
  assert.equal(rigReaches(game, writtenContent("haven_berth_board")), true);
  assert.equal(reachWhy(game, plot), "it takes a Navy coupler, and your rig has a cable jack");
  fitLink(game, "optical_reader");
  assert.deepEqual(rigLinks(game), ["optic"]);
  assert.equal(reachWhy(game, writtenContent("haven_berth_board")), "it takes a cable jack, and your rig has an optical reader");
});

test("a door's panel: its keypad and screen, the breakers only through a link that reaches it, and a new code that holds", () => {
  const game = newGame();
  game.location = "haven";
  game.walk = null;
  walk.walkView(game);
  const hook = roomNamed("haven", "The Hook");
  assert.ok(systemsOf("haven").doors[hook]);
  // Someone's locked it: its panel is the way through.
  setDoor(game, "haven", hook, "locked", { by: "story" });
  openDoorPanel(game, "haven", hook);
  let v = view(game);
  assert.equal(v.look, "door");
  assert.equal(v.locked, true);
  assert.deepEqual(v.device.lcd, ["HOOK", "LOCKED"]);
  assert.equal(v.watch.name, "DoorCtl");
  // With a cable jack, nothing on the rig reaches a door's panel.
  assert.match(v.logon.ways.find((one) => one.id === "dictionary").why, /your rig can't reach it: it takes an optical reader/);
  computerCommand(game, { action: "logoff" });
  fitLink(game, "optical_reader");
  openDoorPanel(game, "haven", hook);
  computerCommand(game, { action: "rig", id: "dictionary" });
  v = view(game);
  assert.equal(v.locked, false);
  assert.deepEqual(v.device.actions.map((one) => one.id), ["door-unlock", "door-recode"]);
  device(game, "door-unlock");
  assert.equal(doorLocked(game, "haven", hook), false);
  device(game, "door-recode");
  assert.equal(doorLocked(game, "haven", hook), true);
  assert.equal(game.systems.haven.doors[hook].recoded, true);
  assert.equal(game.systems.haven.doors[hook].backAt, undefined, "nobody here switches it back");
  assert.deepEqual(view(game).device.lcd, ["HOOK", "NEW CODE"]);
  computerCommand(game, { action: "logoff" });
  passTime(game, 30, "routine");
  assert.equal(doorLocked(game, "haven", hook), true, "a day later it's still locked");
  // The player has the code now: straight in, and they can open it again.
  openDoorPanel(game, "haven", hook);
  assert.equal(view(game).locked, false);
  device(game, "door-unlock");
  assert.equal(doorLocked(game, "haven", hook), false);
  assert.equal(game.systems?.haven?.doors?.[hook]?.recoded, undefined);
});

test("a junction box's service menu: a service clip to reach it, and a room's feed cut and put back", () => {
  const game = newGame();
  toRoom(game, "engineering");
  const box = partOfKind("meridian", "junction box", "engineering");
  const act = () => walk.walkView(game).things.find((one) => one.id === `part:${box.id}`).does.find((one) => one.id === "device-service");
  assert.equal(act().detail, "needs a service clip in your rig");
  assert.equal(act().disabled, true);
  fitLink(game, "service_clip");
  assert.equal(act().disabled, undefined);
  assert.match(walk.walkCommand(game, { action: "device-service", key: `part:${box.id}` }).said, /^You clip onto Junction box JB-\d's service port\.$/);
  let v = view(game);
  assert.equal(v.look, "service");
  assert.equal(v.locked, false, "the captain's own box: no password");
  assert.deepEqual(v.device.feeds.map((one) => one.room), ["engineering", "aft", "crawlways"]);
  device(game, "svc-breakers");
  device(game, "svc-toggle:aft");
  v = view(game);
  assert.equal(v.device.screen, "breakers");
  assert.equal(v.device.feeds.find((one) => one.room === "aft").on, false);
  assert.equal(roomPowered(game, "meridian", "aft"), false);
  assert.equal(roomPowered(game, "meridian", "engineering"), true, "only that room");
  assert.deepEqual(v.device.lines, ["SVC  AFT HOLDS FEED OFF"]);
  assert.match(v.log.at(-1).text, /The Aft Holds goes dark\./);
  // Clearing its log takes CLEANER.EXE or the password.
  assert.throws(() => device(game, "svc-clear"), /CLEANER/);
  device(game, "svc-toggle:aft");
  assert.equal(roomPowered(game, "meridian", "aft"), true);
  device(game, "svc-exit");
  assert.equal(game.computer, null);
});

test("someone else's junction box: its logon, and its people put the power back after a while", () => {
  const game = newGame();
  game.location = "haven";
  game.walk = null;
  const docks = roomNamed("haven", "The Manifest Docks");
  toRoom(game, docks);
  fitLink(game, "service_clip");
  const box = partOfKind("haven", "junction box", docks);
  walk.walkCommand(game, { action: "device-service", key: `part:${box.id}` });
  assert.equal(view(game).locked, true);
  assert.equal(view(game).watch.name, "The fault board");
  computerCommand(game, { action: "rig", id: "dictionary" });
  device(game, "svc-toggle:" + docks);
  assert.equal(roomPowered(game, "haven", docks), false);
  assert.ok(view(game).watch.noise >= 2, "the fault board hears it");
  computerCommand(game, { action: "logoff" });
  passTime(game, 8, "routine");
  assert.equal(roomPowered(game, "haven", docks), true);
});

test("a camera's feed: a short radio, who's in the picture, a loop that doesn't see you pass, and blinding it", () => {
  const game = newGame();
  toRoom(game, "engineering");
  const cam = partOfKind("meridian", "camera", "engineering");
  fitLink(game, "short_radio");
  walk.walkCommand(game, { action: "device-camera", key: `part:${cam.id}` });
  let v = view(game);
  assert.equal(v.look, "camera");
  assert.equal(v.device.mode, "live");
  assert.equal(v.device.people[0], "you");
  assert.equal(watched(game, "meridian", "engineering"), true);
  device(game, "cam-loop");
  v = view(game);
  assert.equal(v.device.mode, "loop");
  assert.equal(v.device.loopLeft, 10);
  assert.equal(watched(game, "meridian", "engineering"), false, "a looped camera sees nobody");
  assert.match(v.log.at(-1).text, /^You loop the last minute, with you/);
  computerCommand(game, { action: "logoff" });
  passTime(game, 0.25, "routine");
  assert.equal(watched(game, "meridian", "engineering"), true, "the loop runs out");
  // Blinding it switches it off, and back to live puts it on again.
  walk.walkCommand(game, { action: "device-camera", key: `part:${cam.id}` });
  device(game, "cam-blind");
  assert.equal(view(game).device.mode, "blind");
  assert.equal(watched(game, "meridian", "engineering"), false);
  device(game, "cam-live");
  assert.equal(watched(game, "meridian", "engineering"), true);
  computerCommand(game, { action: "logoff" });
});

test("a short radio reaches a camera in the next room, out of its sight", () => {
  const game = newGame();
  fitLink(game, "short_radio");
  const model = systemsOf("meridian");
  const map = walk.mapFor("meridian");
  // A room with a door to a room that has a camera.
  const pair = Object.values(model.parts).filter((one) => one.kind === "camera").flatMap((cam) => Object.entries(map.rooms).filter(([id, room]) => id !== cam.room && (room.area?.doors ?? []).some((door) => door.to === cam.room)).map(([id]) => ({ cam, from: id })))[0];
  assert.ok(pair, "some room is next to a camera's");
  toRoom(game, pair.from);
  const act = (walk.walkView(game).acts ?? []).find((one) => one.id === "device-camera" && one.key === `part:${pair.cam.id}`);
  assert.ok(act, "You can has the camera next door");
  assert.match(act.label, /^Tap the camera in .+ by radio$/);
  walk.walkCommand(game, { action: "device-camera", key: act.key });
  assert.equal(view(game).look, "camera");
  assert.equal(view(game).device.people.includes("you"), false, "you're not in its picture");
});

test("NAVCOM 7 on the bridge: the crew assessments, a line struck from the ship's log, and copying only with a Navy coupler", () => {
  const game = newGame();
  game.ship.log.push({ day: "Day 1, 09:00", tag: "SHIP", text: "The captain overrode the rations." });
  toRoom(game, "bridge");
  const table = walk.walkView(game).things.find((one) => /plot table/i.test(one.name));
  walk.walkCommand(game, { action: "use", key: table.id });
  let v = view(game);
  assert.equal(v.look, "navcom");
  assert.equal(v.className, "Ship's main system");
  assert.ok(v.device.crew.list.length >= 4);
  assert.match(v.device.crew.by, /Voss/);
  assert.ok(v.device.crew.list.every((one) => Number.isFinite(one.loyalty) && one.words));
  const line = v.device.shipLog.find((one) => /overrode the rations/.test(one.text));
  const first = holderKey(game, "meridian", "first_officer");
  const before = regardFor(game, "meridian", first, "you");
  device(game, `nav-strike:${line.i}`);
  assert.equal(game.ship.log.some((one) => /overrode the rations/.test(one.text)), false);
  assert.equal(game.rig.struck, 1);
  assert.ok(regardFor(game, "meridian", first, "you") < before, "the first officer reads the log");
  // GHOST is on the plot table to copy, but only through a Navy coupler.
  v = view(game);
  const ghost = v.rig.copies.find((one) => one.id === "ghost");
  assert.match(ghost.why, /it takes a Navy coupler/);
  assert.match(computerCommand(game, { action: "copy", id: "ghost" }).said, /can't reach it/);
  computerCommand(game, { action: "logoff" });
  fitLink(game, "navy_coupler");
  walk.walkCommand(game, { action: "use", key: table.id });
  computerCommand(game, { action: "copy", id: "ghost" });
  assert.ok(game.rig.programs.includes("ghost"));
});
