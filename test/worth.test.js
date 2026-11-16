// What goods are worth to the ship, step 2 of the logistics rework: an item's file says what it feeds, how many doses
// it is or how many repairs, and whatever uses that kind of goods takes anything worth some of it. The galley cooks
// tins when there's nothing else, the medbay doses from a medkit, a repair takes a repair kit, and the Ship menu and
// the asks count it all for its share. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-worth-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const rules = await import("../src/rules.js");
const bag = await import("../src/bag.js");
const lg = await import("../src/logistics.js");
const medbay = await import("../src/medbay.js");
const rq = await import("../src/requests.js");
const walk = await import("../src/walk.js");
const talks = await import("../src/talks.js");
const { ITEMS } = await import("../src/data.js");
const { KINDS, kindOf, pickWorth, worthIn, worthOf, worthWords } = await import("../src/worth.js");
const { readMachineLine } = await import("../public/logistics-text.js");

const SHIP = "meridian";
const newGame = (seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "Begun." });
  // A captain starts with a medkit or two of their own: the tests count only what they hand in.
  for (const id of ["medkit", "tinned_fish", "soup_concentrate", "repair_kit", "bandage_roll", "surgical_kit", "antibiotics", "ship_brewed_beer"]) {
    if (game.inventory[id]) rules.removeItem(game, id, game.inventory[id]);
  }
  return game;
};
const at = (game, hours) => {
  game.clock.hours = hours;
  return rules.clockRuns(game, 1);
};
const minutes = (game, n) => {
  for (let gone = 0; gone < n; gone += 5) rules.clockRuns(game, 5);
};
const storeOf = (id) => lg.logisticsOf(SHIP).stores.find((one) => one.id === id);
const inStore = (game, id) => bag.storeCounts(game, storeOf(id).key, storeOf(id).holds);
// A store emptied of everything it keeps.
function emptied(game, id) {
  for (const [item, n] of Object.entries(inStore(game, id))) bag.storeTake(game, storeOf(id).key, storeOf(id).holds, item, n);
}
// The player hands something in at a store: walks to its room, opens it, and puts what they carry inside.
function handIn(game, room, storeId, item, n) {
  rules.addItem(game, item, n);
  walk.walkCommand(game, { action: "room", to: room });
  bag.bagCommand(game, { action: "open", key: storeOf(storeId).key });
  // Wherever it's carried: on the belt, in a pocket, in the pack, or loose in the arms when there's no room for it.
  for (let guard = 0; guard < 60 && (game.inventory[item] ?? 0) > 0; guard += 1) {
    const view = bag.bagView(game);
    const slot = view.belt.findIndex((one) => one?.id === item);
    const grid = ["pack", "pockets"].find((name) => view[name].items.some((one) => one.id === item));
    const held = grid ? view[grid].items.find((one) => one.id === item) : null;
    const from = slot >= 0 ? { at: "belt", i: slot } : held ? { at: grid, x: held.x, y: held.y } : { at: "loose", id: item };
    bag.bagCommand(game, { action: "drop", from });
  }
  assert.equal(game.inventory[item] ?? 0, 0, `all the ${item} went in`);
  bag.bagCommand(game, { action: "close" });
}
// Nothing grows, nothing comes aboard and nobody carries, so a store stays as the test leaves it.
function stillShip(run) {
  const model = lg.logisticsOf(SHIP);
  const garden = model.machines.find((one) => one.id === "garden");
  const { refills, wants } = model;
  garden.runs = false;
  model.refills = [];
  model.wants = [];
  try {
    return run();
  } finally {
    garden.runs = true;
    model.refills = refills;
    model.wants = wants;
  }
}
const kettle = (game) => lg.countOf(game, storeOf("soup_kettle"));
const supply = (game, id) => rules.publicState(game).ship.supplies.find((one) => one.id === id);

test("an item's file says what it's worth, and most things are worth nothing to the ship", () => {
  assert.deepEqual([worthOf("ration_crate", "food"), worthOf("produce", "food"), worthOf("tinned_fish", "food"), worthOf("soup_concentrate", "food")], [200, 200, 1, 6]);
  assert.deepEqual([worthOf("medicine_crate", "medicine"), worthOf("medkit", "medicine"), worthOf("bandage_roll", "medicine"), worthOf("surgical_kit", "medicine")], [20, 4, 1, 6]);
  assert.deepEqual([worthOf("parts_crate", "parts"), worthOf("repair_kit", "parts"), worthOf("scrap", "parts")], [1, 1, 0]);
  assert.deepEqual([kindOf("tinned_fish"), kindOf("medkit"), kindOf("parts_crate"), kindOf("ship_brewed_beer"), kindOf("stim"), kindOf("no_such_thing")], ["food", "medicine", "parts", null, null, null]);
  assert.equal(worthOf("medkit", "food"), 0, "a medkit feeds nobody");
  // Nothing is two kinds at once, and only what's eaten, dosed or fitted is worth anything.
  const counted = Object.fromEntries(KINDS.map((kind) => [kind, Object.keys(ITEMS).filter((id) => worthOf(id, kind) > 0).length]));
  assert.deepEqual(counted, { food: 27, medicine: 23, parts: 2 });
  for (const id of Object.keys(ITEMS)) assert.ok(KINDS.filter((kind) => worthOf(id, kind) > 0).length <= 1, `${id} is one kind of goods at most`);
  assert.deepEqual([worthWords("tinned_fish"), worthWords("medkit"), worthWords("parts_crate"), worthWords("scrap")], ["feeds 1 at the kettle", "4 doses for the medbay", "one repair's worth of spares", null]);
  // What a store has of a kind, the most first, and which of it makes up so much and no more.
  const counts = { tinned_fish: 5, soup_concentrate: 2, ration_crate: 1, medkit: 3 };
  assert.deepEqual(worthIn(counts, "food").map((one) => [one.item, one.n, one.worth]), [["ration_crate", 1, 200], ["soup_concentrate", 2, 6], ["tinned_fish", 5, 1]]);
  assert.deepEqual(pickWorth(counts, "food", 200, ["ration_crate"]).map((one) => [one.item, one.n]), [["soup_concentrate", 2], ["tinned_fish", 5]]);
  assert.deepEqual(pickWorth(counts, "food", 8, ["ration_crate"]).map((one) => [one.item, one.n]), [["soup_concentrate", 1], ["tinned_fish", 2]], "eight sittings' worth and no more");
  assert.deepEqual(pickWorth(counts, "medicine", 100), [{ item: "medkit", n: 3, worth: 4 }]);
});

test("a machine's line can take any food, and nothing else by its kind", () => {
  const line = readMachineLine("galley: cooks 1 produce or 1 ration crate or any food from the pantry into 200 sittings in the soup kettle every hour, with power and a cook there");
  assert.deepEqual(line.takes, [{ n: 1, what: "produce" }, { n: 1, what: "ration crate" }, { any: "food", what: "any food" }]);
  assert.deepEqual(lg.logisticsOf(SHIP).machines.find((one) => one.id === "galley").takes, [{ item: "produce", n: 1 }, { item: "ration_crate", n: 1 }, { kind: "food" }]);
  assert.deepEqual(lg.logisticsProblems(), []);
  assert.match(rules.publicState(newGame()).ship.machines.find((one) => one.id === "galley").does, /^cooks 1 produce or 1 ration crate or any food from the pantry into 200 sittings in the soup kettle every hour/);
});

test("with no crates and no produce, the galley cooks the tins in the pantry, for what they're worth", () => stillShip(() => {
  const game = newGame();
  at(game, 9.5);
  emptied(game, "pantry");
  game.stores[storeOf("soup_kettle").key] = { count: 100 };
  minutes(game, 60);
  assert.equal(kettle(game), 100, "nothing to cook, nothing cooked");
  assert.match(rules.publicState(game).ship.machines.find((one) => one.id === "galley").status, /the pantry has no produce or ration crates or other food/);
  // Six tins and a jar of soup concentrate are twelve sittings, and a bottle of beer is none.
  handIn(game, "galley", "pantry", "tinned_fish", 6);
  handIn(game, "galley", "pantry", "soup_concentrate", 1);
  handIn(game, "galley", "pantry", "ship_brewed_beer", 2);
  minutes(game, 90);
  assert.equal(kettle(game), 112, "twelve sittings went into the kettle");
  assert.deepEqual(inStore(game, "pantry"), { ship_brewed_beer: 2 }, "the food's gone into the pot, and the beer is still on the shelf");
}));

test("a crate is cooked before the tins, and makes what a crate is worth", () => stillShip(() => {
  const game = newGame();
  at(game, 9.5);
  emptied(game, "pantry");
  bag.storePut(game, storeOf("pantry").key, storeOf("pantry").holds, "ration_crate", 1);
  handIn(game, "galley", "pantry", "tinned_fish", 4);
  game.stores[storeOf("soup_kettle").key] = { count: 0 };
  minutes(game, 65);
  assert.equal(kettle(game), 200);
  assert.deepEqual(inStore(game, "pantry"), { tinned_fish: 4 }, "the crate went first");
  minutes(game, 60);
  assert.equal(kettle(game), 204, "and then the tins");
}));

test("the Ship menu counts what's handed in for its share of a crate", () => stillShip(() => {
  const game = newGame();
  at(game, 9.5);
  const food = supply(game, "food").stock;
  const medicine = supply(game, "medicine").stock;
  const parts = supply(game, "parts").stock;
  // A hundred tins are half a crate, five medkits are a crate's twenty doses, and a repair kit is a crate's repair.
  handIn(game, "galley", "pantry", "tinned_fish", 100);
  handIn(game, "medbay", "medicine_cabinet", "medkit", 5);
  handIn(game, "stores", "parts_lockers", "repair_kit", 1);
  assert.equal(supply(game, "food").stock, food + 0.5);
  assert.equal(supply(game, "medicine").stock, medicine + 1);
  assert.equal(supply(game, "parts").stock, parts + 1);
  // In the wrong store they're only things on a shelf.
  handIn(game, "medbay", "medicine_cabinet", "tinned_fish", 100);
  assert.equal(supply(game, "food").stock, food + 0.5, "tins in the medicine cabinet feed nobody");
  const before = JSON.stringify(game);
  rules.publicState(game);
  assert.equal(JSON.stringify(game), before, "and counting writes nothing");
}));

test("the medbay doses from whatever medicine is in its cabinet, a crate first", () => stillShip(() => {
  const game = newGame();
  at(game, 9.5);
  emptied(game, "medicine_cabinet");
  assert.equal(medbay.roundsDose(game, SHIP), false, "an empty cabinet has no dose to give");
  handIn(game, "medbay", "medicine_cabinet", "medkit", 1);
  handIn(game, "medbay", "medicine_cabinet", "bandage_roll", 2);
  assert.equal(medbay.roundsDose(game, SHIP), true, "a medkit is four doses");
  assert.deepEqual(inStore(game, "medicine_cabinet"), { bandage_roll: 2 }, "the medkit was opened, the most doses first");
  assert.equal(game.medbay[SHIP].rounds, 3, "one given and three left of it");
  // A crate is opened before anything else, and is twenty doses.
  bag.storePut(game, storeOf("medicine_cabinet").key, storeOf("medicine_cabinet").holds, "medicine_crate", 1);
  for (let given = 0; given < 4; given += 1) assert.equal(medbay.roundsDose(game, SHIP), true);
  assert.deepEqual(inStore(game, "medicine_cabinet"), { bandage_roll: 2 }, "the crate went before the bandages");
  assert.equal(game.medbay[SHIP].rounds, 19);
}));

test("a repair takes any spare: a parts crate first, and a repair kit when there's no crate", () => stillShip(() => {
  const game = newGame();
  at(game, 9.5);
  emptied(game, "parts_lockers");
  for (const [item, n] of Object.entries(inStore(game, "shuttle_stores"))) if (item === "parts_crate") bag.storeTake(game, storeOf("shuttle_stores").key, storeOf("shuttle_stores").holds, item, n);
  assert.equal(lg.repairPartsAboard(game, SHIP, "broken"), false);
  assert.equal(lg.takeRepairParts(game, SHIP, "broken", "the camera on the Bridge"), null, "nothing to mend it with");
  handIn(game, "stores", "parts_lockers", "repair_kit", 1);
  assert.equal(lg.repairPartsAboard(game, SHIP, "broken"), true);
  assert.equal(lg.repairStore(game, SHIP, "broken").id, "parts_lockers", "the engineer goes where the spare is");
  assert.equal(lg.takeRepairParts(game, SHIP, "broken", "the camera on the Bridge"), "a hull repair kit from the parts lockers");
  assert.deepEqual(inStore(game, "parts_lockers"), {});
  // With a crate there too, the crate is what's used, and the words are the old ones.
  bag.storePut(game, storeOf("parts_lockers").key, storeOf("parts_lockers").holds, "parts_crate", 1);
  handIn(game, "stores", "parts_lockers", "repair_kit", 1);
  assert.equal(lg.takeRepairParts(game, SHIP, "broken", "the camera on the Bridge"), "a parts crate from the parts lockers");
  assert.deepEqual(inStore(game, "parts_lockers"), { repair_kit: 1 });
}));

test("an ask for medicine crates takes medkits handed in at the cabinet, five to a crate", () => {
  const game = newGame();
  // The cabinet down to one crate, Aduro asks for two more, and the captain says yes.
  lg.takeAboard(game, SHIP, "medicine_crate", lg.countAboard(game, SHIP, "medicine_crate").n - 1);
  at(game, 10.5);
  walk.walkCommand(game, { action: "room", to: "medbay" });
  walk.talkCommand(game, { action: "open", person: "aduro" });
  talks.openWrittenTalk(game);
  talks.writtenTalkTurn({ game, playerText: "I'll see to it", emit: () => {} });
  walk.closeTalk(game);
  const quest = game.quests.find((one) => one.request && one.status === "active");
  assert.equal(quest.objective, "Bring 2 medicine crates aboard (0/2)");
  handIn(game, "medbay", "medicine_cabinet", "medkit", 4);
  rq.advanceRequests(game);
  assert.equal(quest.objective, "Bring 2 medicine crates aboard (0/2)", "four medkits are sixteen doses, short of a crate");
  handIn(game, "medbay", "medicine_cabinet", "medkit", 1);
  rq.advanceRequests(game);
  assert.equal(quest.objective, "Bring 2 medicine crates aboard (1/2)", "five are a crate's worth");
  handIn(game, "medbay", "medicine_cabinet", "surgical_kit", 3);
  handIn(game, "medbay", "medicine_cabinet", "antibiotics", 1);
  const notes = rq.advanceRequests(game);
  assert.ok(notes.some((one) => /^\[REQUEST\] Done: Medicine for the medbay/.test(one)), notes.join(" | "));
  assert.equal(quest.status, "completed");
});

test("the inventory says what a thing is worth to the ship, and where it has to be", () => {
  const game = newGame();
  rules.addItem(game, "tinned_fish", 1);
  rules.addItem(game, "medkit", 1);
  rules.addItem(game, "repair_kit", 1);
  rules.addItem(game, "ship_brewed_beer", 1);
  const view = bag.bagView(game);
  const held = (id) => [...view.pack.items, ...view.pockets.items, ...view.belt.filter(Boolean)].find((one) => one.id === id);
  assert.equal(held("tinned_fish").worth, "Feeds 1 at the kettle, once it's in the pantry.");
  assert.equal(held("medkit").worth, "4 doses for the medbay, once it's in the medicine cabinet.");
  assert.equal(held("repair_kit").worth, "One repair's worth of spares, in the parts lockers or the shuttle stores.");
  assert.equal(held("ship_brewed_beer").worth, undefined);
});
