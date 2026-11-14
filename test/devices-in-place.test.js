// Every device in its place on the ship: a keypad on the wall beside every door the systems run, used where it hangs;
// the comms relay's service menu opened in the room; and the navigation core used at its own cabinet.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-in-place-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const { computerCommand } = await import("../src/computer-use.js");
const { rigCommand } = await import("../src/rig.js");
const { doorLocked, switchPart, systemsOf } = await import("../src/systems.js");
const { publicState } = await import("../src/rules.js");
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
const panels = (place) => Object.values(systemsOf(place).parts).filter((one) => one.kind === "door panel");
const panelFor = (place, room) => panels(place).find((one) => one.door === room);
// Stand on the floor in front of a part on a wall, where it's used from.
function standAt(game, place, part) {
  walk.walkCommand(game, { action: "go", to: `room:${part.room}` });
  const level = walk.mapFor(place).rooms[part.room].level;
  const [x, y] = part.face === "side" ? [part.x + 1, part.y] : [part.x, part.y + 1];
  Object.assign(game.walk, { place, level: level.id, x, y });
}
const thingOf = (game, partId) => publicState(game).walk.things.find((one) => one.id === `part:${partId}`);

test("every door the ship's systems run has its keypad on the wall beside one of its doorways", () => {
  const model = systemsOf(SHIP);
  assert.deepEqual(model.problems ?? [], []);
  const map = walk.mapFor(SHIP);
  for (const room of Object.keys(model.doors)) {
    const list = panels(SHIP).filter((one) => one.door === room);
    assert.equal(list.length, 1, `the door to ${room} has one keypad`);
    const [part] = list;
    const level = map.rooms[room].level;
    assert.equal(level.layers.walls[part.y]?.[part.x], "#", `the ${part.name} hangs on a wall`);
    assert.equal(part.mount, "wall");
    const doorways = [...level.doorAreas].filter(([, touched]) => touched.has(room)).map(([key]) => key.split(",").map(Number));
    assert.ok(doorways.some(([x, y]) => Math.max(Math.abs(x - part.x), Math.abs(y - part.y)) <= 3), `the ${part.name} is beside a doorway into ${room}`);
  }
  // No two parts on one square of a deck.
  const squares = Object.values(model.parts).filter((one) => !one.unplaced).map((one) => `${map.rooms[one.room].level.id}:${one.x},${one.y}`);
  assert.equal(new Set(squares).size, squares.length);
});

test("the Bridge door's keypad, used from the corridor: the door's own panel, straight in for its captain", () => {
  const game = newGame();
  const part = panelFor(SHIP, "bridge");
  standAt(game, SHIP, part);
  const thing = thingOf(game, part.id);
  assert.equal(thing.name, "The Bridge door panel");
  assert.deepEqual(thing.does.map((one) => one.label), ["Use its keypad"]);
  assert.equal(thing.part.locked, false);
  assert.match(walk.walkCommand(game, { action: "device-door", key: thing.id }).said, /^You key into the Bridge door panel\.$/);
  const v = view(game);
  assert.deepEqual([v.look, v.locked, v.device.lcd], ["door", false, ["BRIDGE", "OPEN"]]);
  // Keyed into by hand, it's stepped away from, not unclipped.
  assert.equal(v.device.leave, "Step away");
  assert.ok(game.computer.log.some((one) => /Step away to leave/.test(one.text)));
  computerCommand(game, { action: "device", id: "door-lock" });
  assert.equal(doorLocked(game, SHIP, "bridge"), true);
  computerCommand(game, { action: "logoff" });
  assert.equal(thingOf(game, part.id).part.locked, true, "its screen shows the door locked");
  walk.walkCommand(game, { action: "device-door", key: thing.id });
  computerCommand(game, { action: "device", id: "door-unlock" });
  assert.equal(doorLocked(game, SHIP, "bridge"), false);
});

test("a keypad is used from right beside it, whichever room that square is in, and not from across the corridor", () => {
  const game = newGame();
  const map = walk.mapFor(SHIP);
  // A keypad with a square beside it, in front of its wall's line, that's in neither its room nor the one it hangs in.
  let found = null;
  for (const part of panels(SHIP)) {
    const level = map.rooms[part.room].level;
    for (const [dx, dy] of [[1, 0], [-1, 0], [1, 1], [-1, 1], [0, 1], [1, -1], [-1, -1], [0, -1]]) {
      const [x, y] = [part.x + dx, part.y + dy];
      if (!level.open[y]?.[x] || level.solid.has(`${x},${y}`)) continue;
      if (part.face === "side" ? x < part.x : y < part.y) continue;
      const room = level.roomAt(x, y);
      if (room !== part.room && room !== part.side) found ??= { part, level, x, y };
    }
  }
  assert.ok(found, "some keypad hangs where two rooms meet");
  const { part, level, x, y } = found;
  standAt(game, SHIP, part);
  Object.assign(game.walk, { x, y });
  assert.match(walk.walkCommand(game, { action: "device-door", key: `part:${part.id}` }).said, /^You key into /);
  computerCommand(game, { action: "logoff" });
  // Four squares off in a room of its own, it's out of reach.
  const far = [];
  for (let fy = 0; fy < level.open.length; fy += 1) {
    for (let fx = 0; fx < (level.open[fy]?.length ?? 0); fx += 1) {
      if (!level.open[fy][fx] || level.solid.has(`${fx},${fy}`)) continue;
      const room = level.roomAt(fx, fy);
      if (room !== part.room && room !== part.side && Math.max(Math.abs(fx - part.x), Math.abs(fy - part.y)) === 4) far.push([fx, fy]);
    }
  }
  assert.ok(far.length, "there's floor four squares off");
  Object.assign(game.walk, { x: far[0][0], y: far[0][1] });
  assert.throws(() => walk.walkCommand(game, { action: "device-door", key: `part:${part.id}` }), /That isn't here/);
});

test("a keypad goes dark with its room's power, and a sealed one says what it answers to", () => {
  const game = newGame();
  const part = panelFor(SHIP, "bridge");
  standAt(game, SHIP, part);
  const box = Object.values(systemsOf(SHIP).parts).find((one) => one.kind === "junction box" && one.room === "bridge");
  switchPart(game, SHIP, box.id, false, { by: "player" });
  const thing = thingOf(game, part.id);
  assert.equal(thing.does[0].disabled, true);
  assert.equal(thing.does[0].detail, "its screen is dark");
  assert.match(walk.walkCommand(game, { action: "device-door", key: thing.id }).said, /screen is dark/);
  switchPart(game, SHIP, box.id, true, { by: "player" });
  // The Armory's keypad takes nothing: its panel answers only to the security desk.
  const armory = panelFor(SHIP, "armory");
  standAt(game, SHIP, armory);
  assert.match(walk.walkCommand(game, { action: "device-door", key: `part:${armory.id}` }).said, /The Armory's panel is sealed: .* answers only to the security desk\./);
  assert.equal(game.computer ?? null, null);
});

test("at someone else's place a door's keypad is at its logon", () => {
  const game = newGame();
  game.location = "haven";
  game.walk = null;
  walk.walkView(game);
  const part = panels("haven")[0];
  assert.ok(part, "Haven's doors have keypads too");
  standAt(game, "haven", part);
  assert.match(walk.walkCommand(game, { action: "device-door", key: `part:${part.id}` }).said, /wants its code\.$/);
  assert.deepEqual([view(game).look, view(game).locked], ["door", true]);
});

test("the comms relay's service menu opens in the room with a service clip, and the navigation core's cabinet says what it answers to", () => {
  const game = newGame();
  walk.walkCommand(game, { action: "go", to: "room:names" });
  for (let i = 0; i < 8 && publicState(game).walk?.here?.id !== "bridge"; i += 1) walk.walkCommand(game, { action: "go", to: "room:bridge" });
  const relay = publicState(game).walk.things.find((one) => one.id === "part:comms:relay:bridge");
  assert.equal(relay.does.find((one) => one.id === "device-service").detail, "needs a service clip in your rig");
  game.rig.nextUid += 1;
  const uid = `p${game.rig.nextUid}`;
  game.rig.parts.push({ uid, id: "service_clip", cond: "new", tune: null, from: "" });
  rigCommand(game, { action: "fit", uid, socket: "link1" });
  assert.match(walk.walkCommand(game, { action: "device-service", key: relay.id }).said, /You clip onto The comms relay's service port/);
  assert.deepEqual([view(game).name, view(game).look], ["The comms relay", "service"]);
  computerCommand(game, { action: "logoff" });
  const core = publicState(game).walk.things.find((one) => one.id === "part:navigation:nav_core:bridge");
  assert.deepEqual(core.does.map((one) => one.label).slice(0, 1), ["Use it"]);
  assert.match(walk.walkCommand(game, { action: "device-computer", key: core.id }).said, /The navigation core is sealed: .* answers only to the comms relay and the plot table\./);
  // The core is its cabinet: no second thing is stood for it.
  assert.ok(!Object.values(walk.mapFor(SHIP).levels).some((level) => level.things.some((one) => one.computer === "meridian_nav_core")));
});
