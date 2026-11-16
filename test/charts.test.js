// The chart program on the bridge (src/charts.js), step 1 of moving the star map there: NAVCOM 7 on the plot table
// carries it, it shows what a jump costs the ship herself, Engage is the Star Map's own order for the captain, the plot
// table is the captain's alone by right, and anyone else who gets into it can order a jump too (the owner's choice).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-charts-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const { openLogon, theirOwn, writtenContent } = await import("../src/computers.js");
const { computerCommand } = await import("../src/computer-use.js");
const { chartView, mayChart } = await import("../src/charts.js");
const { jumpCost, shipCommand, shipsJumpCost } = await import("../src/ship.js");
const { damagePart, partsOf, systemsOf } = await import("../src/systems.js");
const { isCaptain } = await import("../src/role.js");
const { publicState } = await import("../src/rules.js");
const cmd = await import("../src/command.js");
const walk = await import("../src/walk.js");
const { WORLD_COMPUTERS } = await import("../src/world.js");
const { COMPUTER, parseWorldText, writeWorldText } = await import("../public/world-text.js");

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
const atTheTable = (game) => {
  toRoom(game, "bridge");
  const table = walk.walkView(game).things.find((one) => /plot table/i.test(one.name));
  walk.walkCommand(game, { action: "use", key: table.id });
};
const view = (game) => publicState(game).computer;
const engage = (game, id) => computerCommand(game, { action: "device", id: `nav-course:${id}` });
const PLOT = "meridian_plot_table";
// The officers take the ship, as test/story-command.test.js does it.
const deposed = () => {
  const game = newGame();
  game.command.meridian.mutiny = { pressure: 9, stage: 3, ringleader: "tarrow", due: null, calmUntil: 0 };
  cmd.mutinyOutcome(game, "taken", "test");
  assert.equal(isCaptain(game), false);
  return game;
};

test("the plot table carries the chart, and it shows what the Star Map shows the captain", () => {
  assert.equal(writtenContent(PLOT).charts, true);
  assert.deepEqual(Object.keys(WORLD_COMPUTERS).filter((id) => writtenContent(id).charts), [PLOT]);
  const game = newGame();
  atTheTable(game);
  const charts = view(game).device.charts;
  assert.equal(charts.name, "Navplot");
  assert.deepEqual([charts.byHand, charts.blocked, charts.ashore], [false, null, true]);
  assert.deepEqual(charts.rings, [{ reach: 20, fuel: 1 }, { reach: 40, fuel: 2 }]);
  // Every place the page knows is there, at the cost the Star Map gives the captain.
  for (const place of publicState(game).locations.filter((one) => !one.ownShip && one.x !== null)) {
    const cost = jumpCost(game, place.id);
    assert.deepEqual(charts.places[place.id], { fuel: cost.fuel, hours: cost.hours, here: false, why: null }, place.id);
  }
  assert.equal(charts.places.haven.fuel, 1);
  assert.equal(charts.places.vantor.fuel, 2);
  assert.equal(charts.places.meridian, undefined);
  // No other computer has it.
  computerCommand(game, { action: "logoff" });
  assert.equal(chartView(game, { locked: true }), null);
});

test("Engage is the Star Map's own order for the captain: she jumps, and as things stand they're ashore", () => {
  const game = newGame();
  atTheTable(game);
  const fuel = game.ship.fuel;
  const cost = jumpCost(game, "haven");
  assert.throws(() => engage(game, "nowhere"), /isn't on the chart/);
  assert.throws(() => engage(game, "meridian"), /isn't on the chart/);
  const reply = engage(game, "haven");
  assert.equal(reply.over, true);
  assert.equal(game.ship.at, "haven");
  assert.equal(game.location, "haven");
  assert.equal(game.computer, null);
  assert.ok([fuel - cost.fuel, fuel - cost.fuel + 1].includes(game.ship.fuel), "the fuel a jump takes, less one for a clean jump");
  assert.ok(game.transcript.some((entry) => entry.role === "notice" && /\[NAV\] Jumped to Haven Station in \d+ hours/.test(entry.text)));
  assert.ok(!game.transcript.some((entry) => /\[COMPUTER\] On The plot table/.test(entry.text)), "the jump's own line is the only one");
  // Back aboard, the chart says she's here, and won't take the order.
  shipCommand(game, { action: "course", id: "meridian" });
  atTheTable(game);
  assert.equal(view(game).device.charts.places.haven.here, true);
  assert.throws(() => engage(game, "haven"), /at Haven Station already/);
  // With too little in the tank it says so beside the place, and refuses.
  game.ship.fuel = 1;
  assert.match(view(game).device.charts.places.vantor.why, /^Needs \d fuel, and the Meridian has 1\.$/);
  assert.throws(() => engage(game, "vantor"), /takes \d fuel, and the Meridian has 1/);
  assert.equal(game.ship.at, "haven");
  assert.ok(game.computer, "a refused order leaves them at the chart");
});

test("with the navigation down the chart plots by hand: a fuel more, and half as long again", () => {
  const game = newGame();
  const before = shipsJumpCost(game, "haven");
  const core = partsOf(systemsOf("meridian"), "navigation")[0];
  damagePart(game, "meridian", core.id, "broken", { by: "test" });
  atTheTable(game);
  const charts = view(game).device.charts;
  assert.equal(charts.byHand, true);
  assert.deepEqual(charts.rings, [{ reach: 20, fuel: 2 }, { reach: 40, fuel: 3 }]);
  assert.deepEqual([charts.places.haven.fuel, charts.places.haven.hours], [before.fuel + 1, Math.round(before.hours * 1.5)]);
});

test("the plot table is the captain's alone, and anyone else who gets in can order a jump too", () => {
  const game = deposed();
  const table = writtenContent(PLOT);
  assert.equal(theirOwn(game, table), false);
  assert.equal(theirOwn(game, writtenContent("meridian_reactor_gauges")), true, "the ship's other computers are as they were");
  assert.equal(theirOwn(newGame(), table), true);
  // At its logon there's no chart, and no order gets through.
  openLogon(game, table, {});
  assert.equal(game.computer.locked, true);
  assert.equal(view(game).device.charts, null);
  assert.match(engage(game, "haven").said, /Log on first/);
  assert.equal(game.ship.at, null);
  computerCommand(game, { action: "logoff" });
  // Past it (here with its password), the chart shows the ship's own jumps, not a passenger's fare.
  game.passwords = { ...(game.passwords ?? {}), [PLOT]: "found" };
  openLogon(game, table, {});
  assert.deepEqual([game.computer.locked, game.computer.yours], [false, false]);
  const charts = view(game).device.charts;
  const cost = shipsJumpCost(game, "haven");
  assert.equal(charts.ashore, false);
  assert.deepEqual(charts.places.haven, { fuel: cost.fuel, hours: cost.hours, here: false, why: null });
  const fuel = game.ship.fuel;
  // Whoever has the chair buys fuel wherever she docks, at the day's turn, which isn't what's counted here: the jump
  // is made early in a day, with nothing in the chair's purse.
  game.ship.chair.funds = 0;
  game.clock.hours = Math.floor(game.clock.hours / 24) * 24 + 1;
  engage(game, "haven");
  assert.equal(game.ship.at, "haven");
  assert.equal(game.location, "meridian", "they stay aboard her");
  assert.ok([fuel - cost.fuel, fuel - cost.fuel + 1].includes(game.ship.fuel));
  assert.ok(game.ship.log.some((entry) => /^Jumped to Haven Station on an order from the plot table that wasn't the chair's\.$/.test(entry.text)));
  assert.ok(game.computer, "they're still at the chart");
  assert.ok(game.computer.noise >= 3, "and SENTRY heard it");
  assert.equal(view(game).device.charts.places.haven.here, true);
});

test("a session let in for less than the computer's programs gets no chart", () => {
  assert.equal(mayChart({ rights: ["the crew file"] }), false);
  assert.equal(mayChart({ rights: ["programs"] }), true);
  assert.equal(mayChart({ rights: null }), true);
  const game = newGame();
  atTheTable(game);
  game.computer.rights = ["the crew file"];
  assert.equal(view(game).device.charts, null);
  assert.throws(() => engage(game, "haven"), /doesn't let you run its programs/);
  assert.equal(game.ship.at, null);
});

test("the plot table's file reads back as it's written, with its charts line", () => {
  const file = path.join(process.env.GAME_COMPUTERS_DIR ?? "world/computers", `${PLOT}.txt`);
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  assert.match(text, /^charts: yes$/m);
  const read = parseWorldText(text, COMPUTER, PLOT).value;
  assert.equal(read.charts, true);
  assert.equal(writeWorldText(read, COMPUTER), text);
});
