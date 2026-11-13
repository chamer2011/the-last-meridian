// Getting parts, step 5 of the hacking rework: the Graveyard's three wrecks (src/wrecks.js), the ports' dealers
// (src/dealers.js), the bench's tools and what they make (src/rig.js), and now and then the ship's own things taken
// apart and finds (src/ship-parts.js).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-part-sources-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const { benchToolsNow, rigPartById, rigPartsNow } = await import("../src/rig-parts.js");
const { rigCommand } = await import("../src/rig.js");
const { dealerProblems, dealersNow, friendSteps, dealerAt } = await import("../src/dealers.js");
const { strippedBare, wreckAirLeft, wreckProblems, wrecksNow } = await import("../src/wrecks.js");
const { countAboard, putAboard, takeAboard } = await import("../src/logistics.js");
const { migrateGame } = await import("../src/migrate.js");
const { addItem, passTime, priceEdge, publicState } = await import("../src/rules.js");
const { partBroken, roomPowered, systemsOf } = await import("../src/systems.js");
const { holderKey, regardFor } = await import("../src/command.js");
const walk = await import("../src/walk.js");

const newGame = ({ engineering = 1 } = {}) => {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  game.scene = null;
  game.skills.engineering = engineering;
  // No way with a price, so that the prices are the files' own.
  game.skills.commerce = 0;
  game.stats.presence = 3;
  game.credits = 1000;
  return game;
};
const goTo = (game, place) => {
  game.location = place;
  game.walk = null;
  walk.walkView(game);
};
const acts = (game) => (walk.walkView(game).acts ?? []);
const wreckActs = (game) => acts(game).filter((one) => /^(salvage|wreck)-/.test(one.id)).map((one) => `${one.label}${one.disabled ? " (off)" : ""}`);
const run = (game, action, key) => walk.walkCommand(game, { action, key }).said;
const spares = (game) => game.rig.parts.slice(8).map((one) => `${one.id}:${one.cond}`);
const dealer = (game) => publicState(game).rig.dealer;
const toRoom = (game, room) => {
  for (let i = 0; i < 6 && publicState(game).walk?.here?.id !== room; i += 1) walk.walkCommand(game, { action: "go", to: `room:${room}` });
  assert.equal(publicState(game).walk?.here?.id, room);
};

test("the wrecks, the dealers, the tools and the new parts read with nothing wrong", () => {
  assert.deepEqual(wrecksNow().list.map((w) => w.id), ["merrow", "pale_wren", "saint_ilse"]);
  assert.deepEqual(wreckProblems(), []);
  assert.deepEqual(dealersNow().list.map((d) => `${d.id}@${d.at}`).sort(), ["frontier@frontier", "haven@haven", "kessara@kessara"]);
  assert.deepEqual(dealerProblems(), []);
  assert.deepEqual(benchToolsNow().list.map((t) => t.id), ["soldering_kit", "cell_press", "micro_lathe"]);
  assert.deepEqual(rigPartsNow().problems, []);
  for (const id of ["service_clip", "optical_reader", "short_radio", "navy_coupler"]) assert.equal(rigPartById(id).kind, "link", id);
  assert.equal(rigPartById("navy").worth, 220);
  assert.deepEqual(rigPartById("hot_cell").made.needs, [{ id: "fuel_cell", n: 1 }, { id: "parts_crate", n: 1 }]);
  assert.equal(rigPartById("fin_sink").made.tool, "soldering_kit");
});

test("a new game has two air bottles, and so does one saved before", () => {
  const game = newGame();
  assert.equal(game.inventory.air_bottle, 2);
  const old = JSON.parse(JSON.stringify(game));
  old.version = 27;
  delete old.inventory.air_bottle;
  const moved = migrateGame(old);
  assert.equal(moved.version, 28);
  assert.equal(moved.inventory.air_bottle, 2);
});

test("a run out to the Merrow: a bottle of air, jobs by Engineering, broken parts below it, home with the rest", () => {
  const game = newGame({ engineering: 1 });
  goTo(game, "graveyard");
  assert.deepEqual(wreckActs(game), [
    "Take the shuttle out to the hulk of the Harrow",
    "Take the shuttle out to the Merrow",
    "Take the shuttle out to the Pale Wren",
    "Take the shuttle out to the Saint Ilse",
  ]);
  assert.match(run(game, "wreck-start", "merrow"), /^\[SALVAGE\] The shuttle puts you across to the Merrow, an ore freighter\. You've a fresh bottle: 60 minutes of air\./);
  assert.equal(game.inventory.air_bottle, 1);
  assert.equal(wreckAirLeft(game), 60);
  // The Harrow waits while you're out here.
  assert.ok(!wreckActs(game).some((one) => /Harrow/.test(one)));
  assert.throws(() => run(game, "salvage-start"), /out there already/);
  assert.match(acts(game).find((one) => one.key === "bridge").detail, /^Engineering 2, and yours is 1: the parts will come out broken\./);
  assert.match(run(game, "wreck-job", "lockers"), /Empty the crew lockers: a worn standard cell, a worn 2-block memory and 2 scrap\./);
  assert.match(run(game, "wreck-job", "bridge"), /a broken 4-block memory and a broken cable jack\. Engineering 2 would have got them out whole\./);
  assert.equal(wreckAirLeft(game), 25);
  // Thirty minutes of work doesn't fit in twenty-five of air.
  assert.equal(acts(game).find((one) => one.key === "engine").detail, "not enough air left");
  assert.throws(() => run(game, "wreck-job", "engine"), /not enough air left/);
  const said = run(game, "wreck-back");
  assert.match(said, /^\[SALVAGE\] The shuttle brings you back from the Merrow with a worn standard cell, a worn 2-block memory, a broken 4-block memory, a broken cable jack and 2 scrap\./);
  assert.deepEqual(spares(game), ["standard_cell:worn", "memory_2:worn", "memory_4:broken", "cable_jack:broken"]);
  assert.equal(game.rig.parts.at(-1).from, "Salvaged from the Merrow.");
  assert.equal(game.inventory.scrap, 2);
  assert.equal(game.wreckRun, null);
  // What's taken stays taken: the next run has only what's left.
  run(game, "wreck-start", "merrow");
  assert.deepEqual(acts(game).filter((one) => one.id === "wreck-job").map((one) => one.key), ["hold", "engine"]);
  run(game, "wreck-job", "hold");
  run(game, "wreck-job", "engine");
  run(game, "wreck-back");
  assert.equal(strippedBare(game, wrecksNow().byId.merrow), true);
  assert.match(acts(game).find((one) => one.key === "merrow").detail, /^stripped bare/);
  assert.equal(game.inventory.air_bottle ?? 0, 0);
  assert.match(acts(game).find((one) => one.key === "saint_ilse").detail, /^you've no air bottle: Tessen Colony's workshop sells them/);
});

test("the Pale Wren's engine room is behind its hatch; out of air, what's carried waits by the airlock", () => {
  const game = newGame({ engineering: 4 });
  goTo(game, "graveyard");
  run(game, "wreck-start", "pale_wren");
  assert.equal(acts(game).find((one) => one.key === "engine").detail, "the hatch is in the way");
  run(game, "wreck-job", "hatch");
  run(game, "wreck-job", "bridge");
  assert.deepEqual(game.wreckRun.carried.parts, [{ id: "navy", cond: "worn" }, { id: "navy_coupler", cond: "worn" }]);
  const stress = game.needs.stress;
  const notes = passTime(game, 1, "active");
  assert.ok(notes.some((one) => /^\[SALVAGE\] The bottle's empty\. The shuttle's crew haul you out of the Pale Wren by your harness, and what you were carrying is left by the airlock: a worn navy board and a worn navy coupler\./.test(one)), notes.join(" | "));
  assert.equal(game.wreckRun, null);
  assert.ok(game.needs.stress > stress);
  assert.equal(game.rig.parts.some((one) => one.id === "navy"), false);
  // Next time it's by the airlock.
  run(game, "wreck-start", "pale_wren");
  assert.equal(acts(game).find((one) => one.id === "wreck-job").label, "Pick up what you left by the airlock (5 minutes)");
  run(game, "wreck-job", "left");
  run(game, "wreck-back");
  assert.ok(game.rig.parts.some((one) => one.id === "navy" && one.cond === "worn"));
});

test("Kessara's fence: a markup, dearer for each one bought until it restocks, friends pay less, anything bought", () => {
  const game = newGame();
  game.factions.drift = 0;
  assert.equal(priceEdge(game), 0);
  goTo(game, "kessara");
  const view = dealer(game);
  assert.equal(view.name, "Kessara's fence");
  const core = view.sells.find((one) => one.id === "racing_core");
  assert.equal(core.price, Math.round(105 * 1.5), "worth 105, half again");
  assert.match(rigCommand(game, { action: "deal-buy", id: "racing_core" }).said, /^Bought a racing core for 158 credits\. It's with your rig's spare parts\./);
  assert.equal(game.credits, 1000 - 158);
  assert.equal(dealer(game).sells.find((one) => one.id === "racing_core").why, "sold out until the port restocks");
  passTime(game, 24, "routine");
  assert.equal(dealer(game).sells.find((one) => one.id === "racing_core").price, 158, "a day later it's restocked, and back to its price");
  // Broken parts fetch a little here; a friend of the Drift pays less and gets more.
  game.rig.parts.push({ uid: "x1", id: "memory_4", cond: "broken", tune: null, from: "" }, { uid: "x2", id: "memory_4", cond: "worn", tune: null, from: "" });
  assert.equal(dealer(game).spare.find((one) => one.uid === "x1").price, 5);
  const worn = dealer(game).spare.find((one) => one.uid === "x2").price;
  game.factions.drift = 60;
  assert.equal(friendSteps(game, dealerAt("kessara")), 3);
  assert.ok(dealer(game).spare.find((one) => one.uid === "x2").price > worn);
  assert.ok(dealer(game).sells.find((one) => one.id === "slim").price < Math.round(90 * 1.5));
  const sold = rigCommand(game, { action: "deal-sell", uid: "x1" });
  assert.match(sold.said, /^Sold a broken 4-block memory at Kessara's fence for 5 credits\./);
  assert.match(sold.notes[0], /^\[FACTION\] .+ \+1: you sold to the fence/);
  assert.equal(rigCommand(game, { action: "deal-sell", uid: "x2" }).notes.length, 0, "once a day");
  // Its programs.
  const masterkey = dealer(game).programs.find((one) => one.id === "masterkey");
  assert.ok(masterkey && !masterkey.owned);
  rigCommand(game, { action: "deal-program", id: "masterkey" });
  assert.ok(game.rig.programs.includes("masterkey"));
  // A part in the rig isn't for sale.
  assert.throws(() => rigCommand(game, { action: "deal-sell", uid: game.rig.build.board }), /Take it out of the rig first/);
});

test("Haven's market buys only what works and pays half again for what it wants today; Tessen's workshop buys scrap", () => {
  const game = newGame();
  goTo(game, "haven");
  game.rig.parts.push({ uid: "y1", id: "standard_cell", cond: "broken", tune: null, from: "" }, { uid: "y2", id: "memory_4", cond: "new", tune: null, from: "" }, { uid: "y3", id: "racing_core", cond: "new", tune: null, from: "" });
  const view = dealer(game);
  assert.equal(view.spare.find((one) => one.uid === "y1").why, "won't buy it broken");
  const wants = view.wants;
  const memory = view.spare.find((one) => one.uid === "y2").price;
  const core = view.spare.find((one) => one.uid === "y3").price;
  if (wants === "memory") assert.equal(memory, Math.round(70 * 0.4 * 1.5));
  else assert.equal(memory, Math.round(70 * 0.4));
  assert.equal(core, Math.round(105 * 0.4));
  passTime(game, 24, "routine");
  assert.notEqual(dealer(game).wants, wants, "it wants something else the next day");
  goTo(game, "frontier");
  const shop = dealer(game);
  assert.equal(shop.name, "Tessen Colony's workshop");
  assert.ok(shop.spare.every((one) => one.why === "only buys scrap"));
  addItem(game, "scrap", 7);
  const credits = game.credits;
  assert.match(rigCommand(game, { action: "deal-scrap" }).said, /^Sold 5 scrap at Tessen Colony's workshop for 20 credits\./);
  assert.equal(game.credits, credits + 20);
  rigCommand(game, { action: "deal-buy", id: "scrap" });
  assert.equal(game.inventory.scrap, 5, "a sack is three");
  rigCommand(game, { action: "deal-buy", id: "air_bottle" });
  assert.equal(game.inventory.air_bottle, 3);
});

test("the bench's tools come from Tessen, out of the ship's purse; the lathe, the soldering kit and the cell press", () => {
  const game = newGame({ engineering: 4 });
  goTo(game, "frontier");
  const purse = publicState(game).rig.dealer.purse;
  assert.equal(purse, 600);
  const credits = game.credits;
  assert.match(rigCommand(game, { action: "deal-buy", id: "micro_lathe" }).said, /^Bought a micro lathe for 150 credits from the ship's purse\. It goes on the Repair Bay's bench\./);
  assert.equal(game.credits, credits, "the captain's own credits aren't touched");
  assert.equal(game.ship.purse, 450);
  assert.equal(dealer(game).sells.find((one) => one.id === "micro_lathe").owned, true);
  assert.throws(() => rigCommand(game, { action: "deal-buy", id: "micro_lathe" }), /it's on your bench/);
  // Back aboard, at the bench.
  goTo(game, "meridian");
  toRoom(game, "repair");
  game.rig.parts.push({ uid: "z1", id: "memory_4", cond: "broken", tune: null, from: "" });
  addItem(game, "scrap", 10);
  const rebuild = publicState(game).rig.build.box.find((one) => one.uid === "z1").actions.find((one) => one.action === "rebuild");
  assert.equal(rebuild.why, null);
  rigCommand(game, { action: "rebuild", uid: "z1" });
  assert.equal(game.rig.parts.find((one) => one.uid === "z1").cond, "worn");
  // Without the soldering kit there's no fin sink from scrap.
  const fin = () => publicState(game).rig.build.makes.find((one) => one.id === "fin_sink");
  assert.equal(fin().why, "needs a soldering kit on the bench");
  game.rig.tools.push("soldering_kit", "cell_press");
  assert.equal(fin().why, null);
  assert.match(fin().label, /^Make a fin sink: 3 scrap, 2 hours, with the soldering kit$/);
  rigCommand(game, { action: "make", id: "fin_sink" });
  // A hot cell is pressed from a fuel cell and one of the ship's parts crates.
  delete game.inventory.fuel_cell;
  const hot = () => publicState(game).rig.build.makes.find((one) => one.id === "hot_cell");
  assert.equal(hot().why, "needs a fuel cell");
  addItem(game, "fuel_cell");
  const crates = countAboard(game, "meridian", "parts_crate").n;
  assert.ok(crates >= 1);
  assert.match(rigCommand(game, { action: "make", id: "hot_cell" }).said, /^3 hours at the bench with the cell press, and a fuel cell and a parts crate make hot cell\./);
  assert.equal(countAboard(game, "meridian", "parts_crate").n, crates - 1);
  assert.equal(game.inventory.fuel_cell ?? 0, 0);
  assert.ok(game.rig.parts.some((one) => one.id === "hot_cell" && one.cond === "new"));
});

test("a rebuild on the lathe needs the lathe", () => {
  const game = newGame();
  toRoom(game, "repair");
  game.rig.parts.push({ uid: "w1", id: "memory_2", cond: "broken", tune: null, from: "" });
  addItem(game, "scrap", 4);
  const rebuild = publicState(game).rig.build.box.find((one) => one.uid === "w1").actions.find((one) => one.action === "rebuild");
  assert.equal(rebuild.why, "needs a micro lathe on the bench");
  assert.throws(() => rigCommand(game, { action: "rebuild", uid: "w1" }), /micro lathe/);
});

test("the ship's own junction box taken apart: a fin sink and scrap, its rooms dark until it's mended, and seen, remembered", () => {
  const game = newGame({ engineering: 2 });
  toRoom(game, "engineering");
  const model = systemsOf("meridian");
  const box = Object.values(model.parts).find((one) => one.kind === "junction box" && one.room === "engineering");
  const thing = () => walk.walkView(game).things.find((one) => one.id === `part:${box.id}`);
  const act = thing().does.find((one) => one.id === "strip-part");
  assert.equal(act.label, "Take it apart for your rig");
  assert.match(act.detail, /^a fin sink and 2 scrap; 25 minutes/);
  const chief = holderKey(game, "meridian", "chief_engineer");
  const before = regardFor(game, "meridian", chief, "you");
  const said = run(game, "strip-part", `part:${box.id}`);
  assert.match(said, /^\[SHIP\] 25 minutes with the panel off, and a worn fin sink and 2 scrap come out of the junction box\. They're with your rig's spare parts and in your pack\./);
  // Its window says what it is now: dead, and who'll mend it.
  assert.match(thing().look, /It's been taken apart for parts, and it's dead\. .+ will fix it with a parts crate from the stores\./);
  assert.ok(partBroken(game, "meridian", box.id));
  assert.equal(roomPowered(game, "meridian", "engineering"), false);
  assert.ok(game.rig.parts.some((one) => one.id === "fin_sink" && one.cond === "worn" && /junction box/.test(one.from)));
  assert.equal(game.inventory.scrap, 2);
  // Engineering is full of people at this hour: someone saw it, and the chief engineer heard.
  if (/saw you do it/.test(said)) assert.ok(regardFor(game, "meridian", chief, "you") < before);
  // Broken, it offers nothing more to take.
  assert.equal((thing().does ?? []).some((one) => one.id === "strip-part"), false);
});

test("taking apart wants the Engineering, and it's only the captain's", () => {
  const game = newGame({ engineering: 0 });
  toRoom(game, "bridge");
  const relay = Object.values(systemsOf("meridian").parts).find((one) => one.kind === "relay");
  const act = walk.walkView(game).things.find((one) => one.id === `part:${relay.id}`).does.find((one) => one.id === "strip-part");
  assert.equal(act.disabled, true);
  assert.equal(act.detail, "needs Engineering 1");
  assert.throws(() => run(game, "strip-part", `part:${relay.id}`), /needs Engineering 1/);
  game.skills.engineering = 1;
  game.role = { ...game.role, captain: false };
  assert.equal((walk.walkView(game).things.find((one) => one.id === `part:${relay.id}`).does ?? []).length, 0);
});

test("finds: the mutineers' belongings after the mutiny, and Tech Oona's old clip for two parts crates", () => {
  const game = newGame();
  toRoom(game, "brig");
  assert.ok(!acts(game).some((one) => one.id === "find-take"), "not before the mutiny");
  game.battles = { mutiny: { result: "victory" } };
  const belongings = acts(game).find((one) => one.id === "find-take");
  assert.equal(belongings.label, "Go through the mutineers' belongings");
  assert.match(run(game, "find-take", belongings.key), /^\[SHIP\] The mutineers' belongings: a worn short radio, a worn scrap memory and 1 scrap\. The prisoners watch you/);
  assert.ok(game.rig.parts.some((one) => one.id === "short_radio"));
  assert.ok(!acts(game).some((one) => one.id === "find-take"), "taken once");
  toRoom(game, "repair");
  const clip = acts(game).find((one) => one.id === "find-take");
  assert.equal(clip.label, "Give 2 parts crates for Tech Oona's old service clip");
  const crates = countAboard(game, "meridian", "parts_crate").n;
  takeAboard(game, "meridian", "parts_crate", crates - 1);
  assert.equal(acts(game).find((one) => one.id === "find-take").disabled, true);
  putAboard(game, "meridian", "parts_crate", 3);
  const before = countAboard(game, "meridian", "parts_crate").n;
  run(game, "find-take", clip.key);
  assert.equal(countAboard(game, "meridian", "parts_crate").n, before - 2);
  assert.ok(game.rig.parts.some((one) => one.id === "service_clip" && one.cond === "worn"));
});
