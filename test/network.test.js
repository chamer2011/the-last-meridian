// The ship's network, step 7 of the hacking rework (src/network.js): every system a place's systems file knows, on
// the data network and the maintenance bus, the file's own links, going along a link from one system to the next,
// and the map a computer's Network folder shows.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-network-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const { enterComputer, openDoorPanel, openLogon, writtenContent } = await import("../src/computers.js");
const { rigCommand } = await import("../src/rig.js");
const { computerCommand } = await import("../src/computer-use.js");
const { linkedTo, networkOf } = await import("../src/network.js");
const { parseSystemsText, writeSystemsText } = await import("../public/systems-text.js");
const { NET_MAP, layOutNetMap } = await import("../public/net-layout.js");
const { publicState } = await import("../src/rules.js");
const walk = await import("../src/walk.js");

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
const count = (net, kind) => Object.values(net.nodes).filter((one) => one.kind === kind).length;
const named = (net, name) => Object.values(net.nodes).find((one) => one.name === name)?.id;
const linked = (net, a, b, kind) => net.links.some((one) => ((one.a === a && one.b === b) || (one.a === b && one.b === a)) && (!kind || one.net === kind));

test("the Meridian's network: every system its file knows, on the data network and the bus, and the file's own link", () => {
  const net = networkOf("meridian");
  assert.deepEqual(net.problems, []);
  // The plot table, the reactor gauges and the records terminal, and since step 9 the navigation core, the reactor
  // safety controller and three private terminals (the first officer's, the security desk and the ledger).
  assert.equal(count(net, "terminal"), 8);
  assert.equal(count(net, "door"), 6);
  assert.equal(count(net, "junction"), 4);
  assert.equal(count(net, "camera"), 3);
  assert.equal(count(net, "relay"), 1);
  const plot = "c:meridian_plot_table";
  // The plot table runs the doors, the cameras and the comms: it's linked to each.
  assert.ok(linked(net, plot, "door:bridge", "data"));
  assert.ok(linked(net, plot, named(net, "Comms relay"), "data"));
  assert.ok(Object.values(net.nodes).filter((one) => one.kind === "camera").every((cam) => linked(net, plot, cam.id, "data")));
  // The reactor gauges run the power, through every junction box.
  assert.ok(Object.values(net.nodes).filter((one) => one.kind === "junction").every((box) => linked(net, "c:meridian_reactor_gauges", box.id, "data")));
  // The boxes are one bus, and each reaches the door panels and the relay in the rooms it feeds.
  assert.equal(net.links.filter((one) => one.net === "bus" && net.nodes[one.a].kind === "junction" && net.nodes[one.b].kind === "junction").length, 3);
  assert.ok(linked(net, "part:power:junction_box:bridge", named(net, "Comms relay"), "bus"));
  assert.ok(linked(net, "part:power:junction_box:engineering", "door:engineering", "bus"));
  // The Network part of world/systems/meridian.txt.
  assert.ok(linked(net, "c:meridian_medbay_records", plot, "data"));
});

test("a systems file's Network part reads back as written, and a line naming nothing is a problem", () => {
  const text = fs.readFileSync(new URL("../world/systems/meridian.txt", import.meta.url), "utf8");
  const { value, problems } = parseSystemsText(text, "meridian");
  assert.deepEqual(problems, []);
  assert.deepEqual(value.network.map((one) => one.text), ["the records terminal to the plot table", "the security desk to the door to The Armory", "the navigation core to the comms relay"]);
  assert.equal(writeSystemsText(value).trim(), text.replace(/\r/g, "").trim());
  const bad = parseSystemsText("# Somewhere\n\nNetwork:\n- the toaster to the kettle\n- the plot table\n", "x");
  assert.equal(bad.value.network.length, 2);
});

test("going along the network aboard your own ship: two minutes, straight in, and only along a link", () => {
  const game = newGame();
  enterComputer(game, { id: "meridian_medbay_records" });
  let v = view(game);
  assert.equal(v.netmap.here, "c:meridian_medbay_records");
  assert.deepEqual(v.netmap.nodes.filter((one) => one.linked).map((one) => one.name), ["The plot table"]);
  assert.match(hop(game, "door:bridge").said, /isn't linked to where you are/);
  // The map is on the rig, which is connected first.
  assert.match(hop(game, "c:meridian_plot_table").said, /^Your rig isn't connected, so it can't go on from here: connect it first/);
  const before = game.clock.hours;
  computerCommand(game, { action: "plug" });
  assert.equal(view(game).reach.ok, true);
  const out = hop(game, "c:meridian_plot_table");
  assert.equal(out.computer, true);
  v = view(game);
  assert.equal(v.name, "The plot table");
  assert.equal(v.locked, false, "your own ship's systems let you straight in");
  assert.equal(v.reach.remote, true);
  assert.equal(v.reach.ok, true, "over the network the rig is plugged in where you started");
  assert.ok(Math.abs((game.clock.hours - before) * 60 - 3) < 0.01, "connecting takes a minute, and a hop two");
  // On along the bus: the relay, then the bridge's junction box, with its own menu.
  hop(game, "part:comms:relay:bridge");
  assert.equal(view(game).name, "The comms relay");
  hop(game, "part:power:junction_box:bridge");
  v = view(game);
  assert.equal(v.look, "service");
  assert.deepEqual(v.device.feeds.map((one) => one.room), ["bridge"]);
});

test("someone else's network: each system you reach is at its logon, the hop is heard at both ends, and the rig's link doesn't matter", () => {
  const game = newGame();
  game.location = "haven";
  game.walk = null;
  walk.walkView(game);
  enterComputer(game, { id: "haven_berth_board", hacked: true });
  // Over the network the rig is plugged in back at the berth board, whatever link it has.
  game.rig.nextUid += 1;
  game.rig.parts.push({ uid: `p${game.rig.nextUid}`, id: "short_radio", cond: "new", tune: null, from: "" });
  game.rig.build.fit.link1 = `p${game.rig.nextUid}`;
  hop(game, "part:cameras:camera:docks");
  const v = view(game);
  assert.equal(v.look, "camera");
  assert.equal(v.locked, true);
  assert.equal(v.watch.noise, 1, "heard arriving");
  assert.equal(v.logon.ways.find((one) => one.id === "dictionary").why, null, "nothing says the rig can't reach it");
  // A hop out of a session that's about to be cut off is the last thing it hears.
  computerCommand(game, { action: "logoff" });
  enterComputer(game, { id: "haven_berth_board", hacked: true });
  game.computer.noise = view(game).watch.cuts - 1;
  hop(game, "c:haven_harbor_office");
  assert.equal(game.computer, null, "cut off where you were, so you never got there");
  assert.match(game.transcript.at(-1).text, /cuts the session off/);
});

test("the map: the decks, where each system sits, and what's linked to here", () => {
  const game = newGame();
  enterComputer(game, { id: "meridian_plot_table" });
  const map = view(game).netmap;
  assert.deepEqual(map.bands.map((one) => one.id), ["deck1", "deck2", "deck3"]);
  assert.equal(map.nodes.find((one) => one.here).id, "c:meridian_plot_table");
  assert.equal(map.nodes.filter((one) => one.linked).length, linkedTo(networkOf("meridian"), "c:meridian_plot_table").length);
  // However crowded a deck is, no box on the map touches another, and all of them are inside it: aboard the Meridian,
  // and at Haven, whose systems are one band.
  const apart = (one) => {
    const { at, width, height, bands } = layOutNetMap(one);
    const { box, boxHeight } = NET_MAP;
    const boxes = one.nodes.map((node) => ({ id: node.id, band: node.band, ...at[node.id] }));
    for (const b of boxes) {
      assert.ok(b.x - box / 2 >= 0 && b.x + box / 2 <= width, `${b.id} is inside the map's width`);
      const band = bands.find((x) => x.id === b.band);
      assert.ok(b.y - boxHeight / 2 >= band.y && b.y + boxHeight / 2 <= band.y + band.height, `${b.id} is inside its deck`);
      assert.ok(band.y + band.height <= height);
    }
    for (const [i, p] of boxes.entries()) {
      for (const q of boxes.slice(i + 1)) assert.ok(Math.abs(p.x - q.x) >= box || Math.abs(p.y - q.y) >= boxHeight, `${p.id} and ${q.id} touch`);
    }
  };
  apart(map);
  const haven = newGame();
  haven.location = "haven";
  haven.walk = null;
  walk.walkView(haven);
  enterComputer(haven, { id: "haven_berth_board", hacked: true });
  apart(view(haven).netmap);
  // A deck as crowded as can be is still laid out apart.
  apart({ bands: [{ id: "deck1", name: "Deck 1" }], nodes: Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, band: "deck1", i })), links: [] });
});

test("beside a panel the rig is the screen: its board and casing go with the view, and it has to be plugged in to go on", () => {
  const game = newGame();
  // The captain's own Bridge door: its panel opens by right, with no optical reader on the rig.
  openDoorPanel(game, "meridian", "bridge");
  let v = view(game);
  assert.equal(v.look, "door");
  assert.equal(v.locked, false);
  assert.deepEqual(v.rigFace, { board: "Yard board", casing: "Plain case" });
  assert.deepEqual([v.reach.ok, v.reach.remote], [false, false]);
  const before = game.clock.hours;
  assert.match(hop(game, "c:meridian_plot_table").said, /^Your rig isn't connected, so it can't go on from here: it takes an optical reader/);
  assert.match(computerCommand(game, { action: "plug" }).said, /^Your rig can't connect to it: it takes an optical reader/);
  assert.equal(game.computer.id, "meridian:door:bridge", "still at the panel");
  assert.equal(game.clock.hours, before, "and no time went by");
  // With an optical reader in the link socket (fitted away from any computer) it is.
  computerCommand(game, { action: "logoff" });
  game.rig.nextUid += 1;
  const uid = `p${game.rig.nextUid}`;
  game.rig.parts.push({ uid, id: "optical_reader", cond: "new", tune: null, from: "" });
  rigCommand(game, { action: "fit", uid, socket: "link1" });
  openDoorPanel(game, "meridian", "bridge");
  assert.deepEqual([view(game).reach.fits, view(game).reach.ok], [true, false], "it fits, but isn't plugged in yet");
  computerCommand(game, { action: "plug" });
  assert.equal(view(game).reach.ok, true);
  assert.equal(hop(game, "c:meridian_plot_table").computer, true);
  v = view(game);
  assert.equal(v.name, "The plot table");
  assert.deepEqual(v.rigFace, { board: "Yard board", casing: "Plain case" }, "the rig is beside a desk too");
});

test("the rig is connected before anything is hacked: a minute, seen in front of people, and off again with Unplug", () => {
  const game = newGame();
  game.location = "haven";
  game.walk = null;
  const docks = Object.keys(walk.mapFor("haven").rooms).find((id) => walk.mapFor("haven").rooms[id].name === "The Manifest Docks");
  // Walking there sets down where the player stands, which is how anyone in the room can see them.
  walk.walkCommand(game, { action: "go", to: `room:${docks}` });
  for (let i = 0; i < 6 && publicState(game).walk?.here?.id !== docks; i += 1) walk.walkCommand(game, { action: "go", to: `room:${docks}` });
  openLogon(game, writtenContent("haven_berth_board"));
  let v = view(game);
  assert.equal(v.locked, true);
  assert.deepEqual([v.reach.fits, v.reach.ok], [true, false]);
  assert.ok(v.logon.ways.every((way) => way.why === "your rig isn't connected"));
  assert.equal(v.reach.seen, true, "plugging in here is seen by anyone in the room");
  assert.equal(v.rigHeat, null, "an unplugged rig isn't working");
  assert.match(computerCommand(game, { action: "rig", id: "dictionary" }).said ?? view(game).screen?.lines?.map((one) => one.text).join(" ") ?? "", /isn't connected/);
  // The docks are busy in the morning: plugging in there is seen.
  const standing = Object.values(game.factions).reduce((sum, n) => sum + n, 0);
  const plugged = computerCommand(game, { action: "plug" });
  assert.match(plugged.said, /saw you plug into Haven Station's systems/);
  assert.ok(Object.values(game.factions).reduce((sum, n) => sum + n, 0) < standing);
  v = view(game);
  assert.equal(v.reach.ok, true);
  assert.equal(v.minutes, 1, "connecting takes a minute");
  assert.equal(v.logon.ways.find((way) => way.id === "dictionary").why, null);
  assert.equal(v.rigHeat.words, "cool");
  assert.match(computerCommand(game, { action: "plug" }).said, /connected already/);
  computerCommand(game, { action: "unplug" });
  assert.equal(view(game).reach.ok, false);
  assert.equal(view(game).logon.ways.find((way) => way.id === "dictionary").why, "your rig isn't connected");
  computerCommand(game, { action: "logoff" });
  // A junction box is reached only through the rig: opening it connects it, and it's left, not unplugged.
  game.rig.nextUid += 1;
  game.rig.parts.push({ uid: `p${game.rig.nextUid}`, id: "service_clip", cond: "new", tune: null, from: "" });
  game.rig.build.fit.link1 = `p${game.rig.nextUid}`;
  walk.walkCommand(game, { action: "device-service", key: "part:power:junction_box:docks" });
  assert.equal(view(game).reach.ok, true);
  assert.match(computerCommand(game, { action: "unplug" }).said, /leave it to unplug/);
});

test("plugging into someone else's box in front of people is seen, like tampering", () => {
  const game = newGame();
  game.location = "haven";
  game.walk = null;
  const docks = Object.keys(walk.mapFor("haven").rooms).find((id) => walk.mapFor("haven").rooms[id].name === "The Manifest Docks");
  for (let i = 0; i < 6 && publicState(game).walk?.here?.id !== docks; i += 1) walk.walkCommand(game, { action: "go", to: `room:${docks}` });
  game.rig.nextUid += 1;
  game.rig.parts.push({ uid: `p${game.rig.nextUid}`, id: "service_clip", cond: "new", tune: null, from: "" });
  game.rig.build.fit.link1 = `p${game.rig.nextUid}`;
  const standing = Object.values(game.factions).reduce((sum, n) => sum + n, 0);
  const said = walk.walkCommand(game, { action: "device-service", key: "part:power:junction_box:docks" }).said;
  // The docks are busy in the morning: someone, or the camera, sees.
  assert.match(said, /saw you plug into Haven Station's systems/);
  assert.ok(Object.values(game.factions).reduce((sum, n) => sum + n, 0) < standing);
  assert.ok((game.story?.record?.facts ?? []).some((one) => one.id === "seen_tampering_at_haven"));
});
