// The ship's logistics, step 1: the file and its checker, the stores as things in the rooms, full to start with, that
// open beside the pack, the Ship menu's count of them, the Story board's page, and that showing the game changes
// nothing. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-logistics-"));
// The board saves into a copy of the folder, so the real file is never written by a test.
const logisticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-logistics-files-"));
fs.copyFileSync(new URL("../world/logistics/meridian.txt", import.meta.url), path.join(logisticsDir, "meridian.txt"));
process.env.GAME_LOGISTICS_DIR = logisticsDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const bag = await import("../src/bag.js");
const { boardWorldItem, boardWorldList, saveBoardWorldItem } = await import("../src/board.js");
const { ITEMS } = await import("../src/data.js");
const { describeHolds, itemByWords, logisticsOf, logisticsProblems, placesWithLogistics, storesView } = await import("../src/logistics.js");
const { allStoryProblems } = await import("../src/scenes.js");
const { passTime, publicState } = await import("../src/rules.js");
const { clearMaps, mapFor, thingsIn, walkCommand, walkView } = await import("../src/walk.js");
const { LOGISTICS_FILE_PROBLEMS, WORLD_LOGISTICS, reloadLogistics } = await import("../src/world.js");
const { LOGISTICS_PARTS, parseLogisticsText, readStoreLine, writeLogisticsText } = await import("../public/logistics-text.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const FILE = fs.readFileSync(path.join(logisticsDir, "meridian.txt"), "utf8");

// Puts the file back the way it was, after a test that saved another.
function restore() {
  fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), FILE);
  reloadLogistics();
  clearMaps();
}

// ---- The file -----------------------------------------------------------------------------------

test("the Meridian's logistics file reads into its parts, and writes back the same", () => {
  const { value, problems } = parseLogisticsText(FILE, "meridian");
  assert.deepEqual(problems, []);
  assert.equal(value.name, "CFS Meridian");
  assert.equal(value.numbers.eats, 2);
  assert.equal(value.numbers.crateFeeds, 200);
  assert.ok(value.stores.length >= 6);
  for (const part of LOGISTICS_PARTS) assert.ok(Array.isArray(value[part]), part);
  assert.ok(value.machines.length && value.errands.length && value.loads.length && value.refills.length, "the later steps' parts are kept too");
  const again = parseLogisticsText(writeLogisticsText(value), "meridian");
  assert.deepEqual(again.problems, []);
  const bare = (one) => ({ ...one, stores: one.stores.map((s) => s.text), machines: one.machines.map((s) => s.text), loads: one.loads.map((s) => s.text), errands: one.errands.map((s) => s.text), refills: one.refills.map((s) => s.text) });
  assert.deepEqual(bare(again.value), bare(value));
});

test("a store's line is read into its pieces, and a bad one says what's wrong", () => {
  const read = readStoreLine("pantry in The Galley: holds 12 ration crates, 12 produce: Shelves behind a wire door.");
  assert.deepEqual(read, { name: "pantry", room: "The Galley", holds: [{ n: 12, what: "ration crates" }, { n: 12, what: "produce" }], look: "Shelves behind a wire door." });
  assert.equal(readStoreLine("the soup kettle in The Long Mess: holds 400 sittings").look, null);
  assert.match(readStoreLine("pantry: holds 12 ration crates").problem, /needs to say where it is/);
  assert.match(readStoreLine("pantry in The Galley").problem, /needs holds after the colon/);
  assert.match(readStoreLine("pantry in The Galley: holds lots of food").problem, /should be a number and what it is/);
  assert.equal(itemByWords("ration crates"), "ration_crate");
  assert.equal(itemByWords("Fuel Cell"), "fuel_cell");
  assert.equal(itemByWords("produce"), "produce");
  assert.equal(itemByWords("gold bars"), null);
  assert.equal(describeHolds({ ration_crate: 12, produce: 12 }), "12 ration crates and 12 produce");
  assert.equal(describeHolds({}, { n: 400, unit: "sittings" }), "400 sittings");
});

test("a file with mistakes is read as far as it goes, and each mistake is named with its line", () => {
  const { value, problems } = parseLogisticsText("# Somewhere\nweather: wet\n\nStores:\nnot a store\n- pantry in The Galley: holds 2 ration crates\n\nWeather:\n- rain\n\nStores:\n", "x");
  const lines = problems.map((one) => one.line);
  assert.ok(problems.some((one) => /before the first part/.test(one.message)) && lines.includes(2));
  assert.ok(problems.some((one) => /starts with - and a space/.test(one.message)) && lines.includes(5));
  assert.ok(problems.some((one) => /isn't a part of a place's logistics/.test(one.message)) && lines.includes(8));
  assert.ok(problems.some((one) => /written twice/.test(one.message)) && lines.includes(11));
  assert.equal(value.stores.length, 1, "the good line is kept");
  assert.ok(parseLogisticsText("", "x").problems.some((one) => /starts with # The Name/.test(one.message)));
});

test("the checker reads the logistics too, and the Meridian's file is clean", () => {
  assert.deepEqual(LOGISTICS_FILE_PROBLEMS, []);
  assert.deepEqual(logisticsProblems(), []);
  assert.equal(placesWithLogistics(), 1);
  const { logistics, problems } = allStoryProblems();
  assert.equal(logistics, 1);
  assert.deepEqual(problems, []);
});

test("the checker names a room that isn't there, an item that isn't, and a store written twice", () => {
  try {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), "# CFS Meridian\n\nStores:\n- pantry in The Scullery: holds 2 ration crates\n- hoard in The Galley: holds 3 gold bars\n- fuel rack in Engineering: holds 2 fuel cells\n- fuel rack in Engineering: holds 2 fuel cells\n- oddment in The Galley: holds 4 sittings, 2 produce\n");
    reloadLogistics();
    clearMaps();
    const problems = logisticsProblems();
    assert.ok(problems.some((one) => /line 4.*no room called The Scullery/.test(one)), problems.join(" | "));
    assert.ok(problems.some((one) => /line 5.*no item called gold bars/.test(one)), problems.join(" | "));
    assert.ok(problems.some((one) => /line 7.*written twice/.test(one)), problems.join(" | "));
    assert.ok(problems.some((one) => /line 8.*one or the other/.test(one)), problems.join(" | "));
    assert.equal(logisticsOf("meridian").stores.length, 1, "the sound store is still placed");
  } finally {
    restore();
  }
});

// ---- The stores in the rooms --------------------------------------------------------------------------

test("every store is a thing in its room, full to start with, drawn there or put there by the game", () => {
  const model = logisticsOf("meridian");
  assert.deepEqual(model.problems, []);
  const byId = Object.fromEntries(model.stores.map((store) => [store.id, store]));
  assert.deepEqual(byId.pantry.holds, { ration_crate: 12, produce: 12 });
  assert.equal(byId.pantry.roomName, "The Galley");
  assert.equal(byId.pantry.placed, true, "the galley has no pantry drawn, so the game puts one there");
  assert.equal(byId.soup_kettle.placed, false, "the mess has its kettle drawn already");
  assert.deepEqual(byId.soup_kettle.count, { n: 400, unit: "sittings" });
  const map = mapFor("meridian");
  const game = newGame();
  for (const store of model.stores) {
    const room = map.rooms[store.room];
    const thing = thingsIn(room).find((one) => one.id === store.thing);
    assert.ok(thing, `${store.id} isn't in ${store.roomName}`);
    assert.equal(room.level.roomAt(thing.x, thing.y), store.room, `${store.id} stands outside its room`);
    // It stands like a thing drawn there: not floor, solid, and reached from beside it.
    assert.equal(Boolean(room.level.open[thing.y]?.[thing.x]), false, `${store.id} stands on open floor`);
    assert.ok(room.level.solid.has(`${thing.x},${thing.y}`), `${store.id} can be walked through`);
    const there = structuredClone(game);
    walkCommand(there, { action: "room", to: store.room });
    const reply = walkCommand(there, { action: "go", to: `thing:${thing.id}` });
    assert.equal(reply.arrived?.kind, "thing", `${store.id} can't be walked to`);
    assert.equal(Math.abs(reply.walk.captain.x - thing.x) + Math.abs(reply.walk.captain.y - thing.y), 1, `${store.id} is reached from beside it`);
    if (store.count) assert.match(thing.look, /holds up to 400 sittings/);
    else {
      assert.deepEqual(thing.holds, store.holds);
      assert.match(thing.look, /The ship keeps/);
    }
    for (const id of Object.keys(store.holds)) assert.ok(ITEMS[id], id);
  }
  assert.ok(map.levels.deck2.solid.has(`${byId.pantry.thing && thingsIn(map.rooms.galley).find((one) => one.id === byId.pantry.thing).x},${thingsIn(map.rooms.galley).find((one) => one.id === byId.pantry.thing).y}`), "nobody walks through the pantry");
});

test("the player walks to the pantry, opens it beside their pack, takes a crate and puts it back, and the Ship menu follows", () => {
  const game = newGame();
  walkCommand(game, { action: "room", to: "galley" });
  const pantry = walkView(game).things.find((one) => one.name === "Pantry");
  assert.ok(pantry?.holds && pantry.store === "thing:meridian:store:pantry");
  assert.equal(pantry.room, "galley");
  assert.equal(pantry.written, true, "opening it is free, with or without an AI");
  const before = JSON.stringify(game);
  publicState(game);
  assert.equal(JSON.stringify(game), before, "showing the game changes nothing");
  bag.bagCommand(game, { action: "open", key: pantry.store });
  let open = bag.bagView(game).open;
  assert.equal(open.name, "Pantry");
  assert.deepEqual(Object.fromEntries(open.items.map((one) => [one.id, (open.items.filter((o) => o.id === one.id)).reduce((sum, o) => sum + o.n, 0)])), { ration_crate: 12, produce: 12 });
  const crate = open.items.find((one) => one.id === "ration_crate");
  bag.bagCommand(game, { action: "take", from: { at: "open", x: crate.x, y: crate.y } });
  assert.equal(game.inventory.ration_crate, crate.n);
  let shown = publicState(game).ship.stores.find((one) => one.id === "pantry");
  assert.equal(shown.items.find((one) => one.id === "ration_crate").n, 12 - crate.n);
  assert.equal(shown.full, false);
  // Back in it goes, and the store is full again. A crate is one square, so it went to the pockets first.
  const view = bag.bagView(game);
  const at = view.pockets.items.some((one) => one.id === "ration_crate") ? "pockets" : "pack";
  const packed = view[at].items.find((one) => one.id === "ration_crate");
  assert.ok(packed, "the crate is on the player");
  bag.bagCommand(game, { action: "move", from: { at, x: packed.x, y: packed.y }, to: { at: "open", x: crate.x, y: crate.y } });
  shown = publicState(game).ship.stores.find((one) => one.id === "pantry");
  assert.equal(shown.items.find((one) => one.id === "ration_crate").n, 12);
  assert.equal(shown.full, true);
  assert.equal(game.inventory.ration_crate ?? 0, 0);
  // Out of the room it's shut, and still holds everything.
  walkCommand(game, { action: "room", to: "mess" });
  assert.equal(bag.bagView(game).open, null);
  open = null;
  assert.deepEqual(game.stores["thing:meridian:store:pantry"].items.reduce((sum, one) => sum + one.n, 0), 24);
});

test("the Ship menu lists every store with what's in it, the kettle by its sittings, and a day passing changes none of it yet", () => {
  const game = newGame();
  const stores = publicState(game).ship.stores;
  assert.equal(stores.length, 7);
  const names = stores.map((one) => one.name);
  assert.deepEqual(names, ["Shuttle stores", "Fuel rack", "Pantry", "Garden bins", "Medicine cabinet", "Parts lockers", "Soup kettle"]);
  assert.ok(stores.every((one) => one.full));
  const kettle = stores.find((one) => one.id === "soup_kettle");
  assert.deepEqual(kettle.count, { n: 400, of: 400, unit: "sittings" });
  assert.deepEqual(kettle.items, []);
  const shuttle = stores.find((one) => one.id === "shuttle_stores");
  assert.equal(shuttle.room, "The Lighter Bay");
  assert.deepEqual(shuttle.items.map((one) => `${one.n} ${one.id}`), ["20 ration_crate", "12 fuel_cell", "6 parts_crate"]);
  // Three days on, the galley has cooked the pantry down and the kettle has been eaten from: the machines run on the clock.
  passTime(game, 24 * 3, "routine");
  const later = publicState(game).ship.stores;
  assert.ok(later.find((one) => one.id === "pantry").items.reduce((sum, one) => sum + one.n, 0) < 24, "the pantry has been cooked from");
  assert.ok(!later.find((one) => one.id === "shuttle_stores").full, "and the errands have drawn on the shuttle stores to keep it up");
});

test("the new items for the stores have sizes, weights and stacks, and the four of them are in the item files", () => {
  for (const id of ["ration_crate", "produce", "parts_crate", "medicine_crate"]) {
    const item = ITEMS[id];
    assert.ok(item, id);
    assert.equal(bag.sizeOf(item).w * bag.sizeOf(item).h, 1, `${id} is one square`);
    assert.ok(bag.weightOf(item) > 0 && bag.stackOf(item) >= 1, id);
    assert.ok(item.desc, `${id} has no line`);
  }
  assert.equal(ITEMS.fuel_cell.effect?.fuel, 3, "fuel cells are the item the game already had");
});

// ---- The board -----------------------------------------------------------------------------------------

test("the Story board has a Logistics page: the file as boxes, its lists, and Save writing the file", () => {
  assert.deepEqual(boardWorldList("logistics").map((one) => one.id), ["meridian"]);
  const item = boardWorldItem("logistics", "meridian");
  assert.equal(item.kind, "logistics");
  assert.equal(item.text, FILE);
  assert.equal(item.value.stores.length, 7);
  assert.ok(item.links.stores.some((one) => one.id === "pantry" && one.placed && one.room === "The Galley"));
  assert.ok(item.links.stores.some((one) => one.id === "soup_kettle" && !one.placed));
  assert.ok(item.lists.rooms.includes("The Galley") && item.lists.rooms.includes("Engineering"));
  assert.ok(item.lists.items.some((one) => one.id === "ration_crate"));
  assert.deepEqual(item.problems, []);
  assert.throws(() => boardWorldItem("logistics", "haven"), /no logistics file yet/);
  try {
    const refused = saveBoardWorldItem("logistics", "meridian", "# CFS Meridian\n\nStores:\nnot a line\n");
    assert.equal(refused.saved, false);
    assert.match(refused.problems[0], /line 4/);
    assert.equal(fs.readFileSync(path.join(logisticsDir, "meridian.txt"), "utf8"), FILE, "a file that can't be read isn't written");
    const changed = FILE.replace("- fuel rack in Engineering: holds 6 fuel cells", "- fuel rack in Engineering: holds 4 fuel cells");
    const saved = saveBoardWorldItem("logistics", "meridian", changed);
    assert.equal(saved.saved, true);
    assert.deepEqual(saved.problems, []);
    assert.match(WORLD_LOGISTICS.meridian.stores.find((one) => /fuel rack/.test(one.text)).text, /^fuel rack in Engineering: holds 4 fuel cells/);
    assert.deepEqual(logisticsOf("meridian").stores.find((one) => one.id === "fuel_rack").holds, { fuel_cell: 4 }, "the stores are placed again from the new file");
    assert.equal(publicState(newGame()).ship.stores.find((one) => one.id === "fuel_rack").items[0].n, 4);
  } finally {
    restore();
  }
});
