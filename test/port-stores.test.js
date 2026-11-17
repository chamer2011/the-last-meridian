// The logistics rework, step 10: a port's stores where you stand. A port's file says where its goods stand in its
// rooms; each store holds its share of what the port really has, only while the player's there; the port's own
// carriers keep each at its share, a trip at a time, on a board of their own; what a ship takes at the dock comes off
// the shelves; and what the player takes or leaves by hand is the port's, in real amounts. Nothing is made from
// nothing by any of it.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-port-stores-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const bag = await import("../src/bag.js");
const { ITEMS, LOCATIONS } = await import("../src/data.js");
const { takeAboard } = await import("../src/logistics.js");
const { lootOf } = await import("../src/loot.js");
const { portHasStores, portStoreProblems, portStoresView } = await import("../src/port-stores.js");
const { amountOf, levelOf, portsModel, portsProblems } = await import("../src/ports.js");
const { clockRuns, passTime, publicState, travel } = await import("../src/rules.js");
const { shipCommand } = await import("../src/ship.js");
const walk = await import("../src/walk.js");
const { WORLD_PORTS } = await import("../src/world.js");
const { parsePortText, readCarriedBy, readPortStoreLine, writePortStoreLine, writePortText } = await import("../public/ports-text.js");

const newGame = () => {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  game.scene = null;
  return game;
};
// A captain gone ashore at a port the Meridian is docked at, at an hour of the day: early afternoon by default, when
// Haven's three dockers are all about.
const ashoreAt = (place, hour = 13) => {
  const game = newGame();
  game.ship.at = place;
  game.clock.hours = Math.floor(game.clock.hours / 24) * 24 + hour;
  travel(game, place);
  return game;
};
const m = () => portsModel();
const has = (game, port, good) => amountOf(game.world, port, good);
// A port's stock of a good set to so many hundredths of what it usually holds, as its own day would leave it: the
// board is told it isn't a ship's doing.
function level(game, port, good, hundredths) {
  const supply = m().supplyOf[good];
  if (supply && game.world.places[port]?.goods?.[supply] !== undefined) game.world.places[port].goods[supply] = hundredths;
  else ((game.world.ports ??= {})[port] ??= {})[good] = hundredths;
  assert.ok(Math.abs(levelOf(game.world, port, good) - hundredths) < 0.001);
  if (game.portStores?.place === port && game.portStores.base[good] !== undefined) game.portStores.base[good] = has(game, port, good);
}
const storeOf = (game, id) => portStoresView(game).stores.find((one) => one.id === id);
const inStore = (game, id, item) => storeOf(game, id).items.find((one) => one.id === item)?.n ?? 0;
const minutes = (game, n) => {
  const notes = [];
  for (let i = 0; i < n / 5; i += 1) notes.push(...clockRuns(game, 5));
  return notes;
};
// The thing a store is, in the room view of the level it stands on.
function thingOf(game, place, storeId) {
  const map = walk.mapFor(place);
  for (const lvl of Object.values(map.levels)) {
    const thing = lvl.things.find((one) => one.portStore === storeId);
    if (thing) return { level: lvl, thing, key: `thing:${place}:${thing.id}` };
  }
  return null;
}
// The player walks up to a store and opens it.
function open(game, place, storeId) {
  const found = thingOf(game, place, storeId);
  const room = Object.values(walk.mapFor(place).rooms).find((one) => !one.deck && one.levelId === found.level.id);
  walk.startInRoom(game, room.id);
  const spot = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => ({ x: found.thing.x + dx, y: found.thing.y + dy })).find((one) => walk.canStand(found.level, one.x, one.y));
  Object.assign(game.walk, spot);
  bag.bagCommand(game, { action: "open", key: found.key });
  return found;
}
// Where the player has a thing: in the pack, a pocket, on the belt or in their hands, as the inventory's orders name it.
function heldAt(game, id) {
  const view = bag.bagView(game);
  for (const at of ["pack", "pockets"]) {
    const one = view[at].items.find((entry) => entry.id === id);
    if (one) return { at, x: one.x, y: one.y };
  }
  const i = view.belt.findIndex((one) => one?.id === id);
  if (i >= 0) return { at: "belt", i };
  return view.loose.some((one) => one.id === id) ? { at: "loose", id } : null;
}
const take = (game, item) => {
  const entry = bag.bagView(game).open.items.find((one) => one.id === item);
  return bag.bagCommand(game, { action: "take", from: { at: "open", x: entry.x, y: entry.y } });
};

test("a store's line says its room and what it usually has, and a port's file keeps its stores and who carries", () => {
  const line = "the granary in The Manifest Docks: usually 20 ration crates, 8 meal: A cage of crates and sacks.";
  const read = readPortStoreLine(line);
  assert.deepEqual(read, { name: "the granary", room: "The Manifest Docks", list: [{ n: 20, good: "ration crates" }, { n: 8, good: "meal" }], look: "A cage of crates and sacks." });
  assert.equal(writePortStoreLine(read), line);
  // A name with an in of its own, and goods with an and in theirs.
  assert.deepEqual(readPortStoreLine("the bins in the back in The Hook: usually 6 beer and spirits, 3 tea and tobacco").list, [{ n: 6, good: "beer and spirits" }, { n: 3, good: "tea and tobacco" }]);
  assert.equal(readPortStoreLine("the bins in the back in The Hook: usually 6 beer and spirits").name, "the bins in the back");
  assert.match(readPortStoreLine("the granary: usually 3 meal").problem, /in and its room/);
  assert.match(readPortStoreLine("the granary in The Docks: usually 2.5 meal").problem, /whole things/);
  assert.deepEqual(readCarriedBy("Docker Pav, Docker Renko and Docker Bo."), ["Docker Pav", "Docker Renko", "Docker Bo"]);
  // Every port's file reads back as it's written, stores and all.
  for (const id of Object.keys(WORLD_PORTS)) {
    const text = fs.readFileSync(path.join("world", "ports", `${id}.txt`), "utf8").replace(/\r\n/g, "\n");
    const { value, problems } = parsePortText(text, id);
    assert.deepEqual(problems, [], id);
    assert.equal(writePortText(value), text, id);
  }
});

test("every port has stores, each in a room of its own place, on a square that was free, with someone to carry", () => {
  assert.deepEqual(portsProblems(), []);
  assert.deepEqual(portStoreProblems(), []);
  let stores = 0;
  for (const [id, port] of Object.entries(m().ports)) {
    assert.ok(port.stores.length >= 1, `${id} has a store`);
    assert.ok(port.carriers?.list.length >= 1, `${id} names who carries`);
    const map = walk.mapFor(id);
    for (const store of port.stores) {
      stores += 1;
      const found = thingOf({ location: id }, id, store.id);
      assert.ok(found, `${id}: ${store.name} stands somewhere`);
      const { level: lvl, thing } = found;
      // It opens, it isn't one of the containers things are found in, and it can be walked up to.
      assert.deepEqual(thing.holds, {});
      assert.equal(lootOf(id, thing), null, `${id}: ${store.name} isn't loot`);
      assert.ok(lvl.solid.has(`${thing.x},${thing.y}`));
      assert.ok([[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => walk.canStand(lvl, thing.x + dx, thing.y + dy)), `${id}: ${store.name} can be reached`);
      // Its room is the one its line names.
      const room = Object.values(map.rooms).find((one) => !one.deck && one.levelId === lvl.id && (!one.area || lvl.areaAt(thing.x, thing.y) === one.area.id));
      assert.equal(room.name.toLowerCase().replace(/^the /, "").replace(/'/g, ""), store.room.toLowerCase().replace(/^the /, "").replace(/'/g, ""), `${id}: ${store.name}`);
      // What it keeps are goods the port holds, as things someone can carry.
      for (const entry of store.goods) {
        assert.ok(port.holds[entry.good], `${id}: ${store.name} keeps a good the port holds`);
        assert.ok(ITEMS[entry.item], `${id}: ${entry.good} is a thing`);
        assert.ok(Number.isInteger(entry.usual) && entry.usual > 0);
      }
    }
  }
  assert.equal(stores, 48);
  assert.equal(portHasStores("haven"), true);
  assert.equal(portHasStores("meridian"), false);
});

test("where the player stands, a store holds its share of what the port has, and a port that's short has bare shelves", () => {
  const game = ashoreAt("haven");
  const view = portStoresView(game);
  assert.equal(view.name, "Haven Station");
  assert.deepEqual(view.stores.map((one) => one.id), ["granary", "bonded_store", "chandlers_cage"]);
  // With what it usually holds, the granary has what its line says.
  assert.equal(inStore(game, "granary", "ration_crate"), 20);
  assert.equal(inStore(game, "granary", "meal"), 8);
  assert.equal(storeOf(game, "granary").stands, null);
  // The same numbers are in the thing the room shows, and in what opening it finds.
  const things = walk.walkView(game).things.filter((one) => one.portStore);
  const granary = things.find((one) => /granary/i.test(one.name));
  assert.equal(granary.holds, true);
  assert.match(granary.look, /20 ration crates, 8 sacks of meal and 6 cases of ration packs in it/);
  assert.match(granary.look, /It belongs to /);
  assert.equal(granary.stock.goods.find((one) => one.item === "ration_crate").n, 20);
  open(game, "haven", "granary");
  const opened = bag.bagView(game).open;
  assert.equal(opened.items.filter((one) => one.id === "ration_crate").reduce((sum, one) => sum + one.n, 0), 20);
  // The page is told, under the world.
  assert.equal(publicState(game).world.stores.stores.length, 3);

  // Another game, where Haven is all but out of food when the captain arrives: the granary is nearly bare.
  const hungry = newGame();
  hungry.ship.at = "haven";
  hungry.clock.hours = Math.floor(hungry.clock.hours / 24) * 24 + 13;
  level(hungry, "haven", "ration_crates", 15);
  travel(hungry, "haven");
  assert.equal(inStore(hungry, "granary", "ration_crate"), 3);
  assert.equal(inStore(hungry, "granary", "meal"), 8, "meal isn't short");
  const short = walk.walkView(hungry).things.find((one) => one.portStore && /granary/i.test(one.name));
  assert.match(short.look, /3 ration crates/);
  const bare = newGame();
  bare.ship.at = "haven";
  for (const good of ["ration_crates", "meal", "ration_packs"]) level(bare, "haven", good, 10);
  travel(bare, "haven");
  assert.equal(storeOf(bare, "granary").stands, "It's nearly bare.");
  assert.equal(storeOf(bare, "granary").bare, true);
  assert.match(walk.walkView(bare).things.find((one) => one.portStore && /granary/i.test(one.name)).look, /It's nearly bare\./);
});

test("a store that's more than one thing is spoken of as them, and belongs to whoever holds the place", () => {
  const game = ashoreAt("frontier");
  const sheds = walk.walkView(game).things.find((one) => one.portStore && /grain sheds/i.test(one.name));
  assert.match(sheds.look, /There are 20 loads of grain, 16 sacks of meal and 12 ration crates in them\. They belong to the people of Tessen Colony\.$/);
  assert.equal(portStoresView(game).owner, "It belongs to the people of Tessen Colony.");
  // A bad harvest all the way up the tree.
  const lean = newGame();
  lean.ship.at = "frontier";
  for (const good of ["grain", "meal", "ration_crates"]) level(lean, "frontier", good, 12);
  travel(lean, "frontier");
  assert.equal(storeOf(lean, "grain_sheds").stands, "They're nearly bare.");
  assert.match(walk.walkView(lean).things.find((one) => one.portStore && /grain sheds/i.test(one.name)).look, /in them\. They're nearly bare\. They belong to /);
  // A faction's port says whose.
  const haven = ashoreAt("haven");
  assert.match(walk.walkView(haven).things.find((one) => one.portStore && /granary/i.test(one.name)).look, /in it\. It belongs to the Kessara Syndicate\.$/);
});

test("only where the player is: aboard, a port is numbers, and leaving one lets its stores go", () => {
  const game = newGame();
  game.ship.at = "haven";
  passTime(game, 2);
  assert.equal(portStoresView(game), null);
  assert.equal(game.portStores, undefined);
  assert.equal(Object.keys(game.stores ?? {}).filter((key) => key.includes(":port:")).length, 0);
  game.clock.hours = Math.floor(game.clock.hours / 24) * 24 + 13;
  travel(game, "haven");
  assert.equal(game.portStores.place, "haven");
  assert.equal(Object.keys(game.stores).filter((key) => key.startsWith("thing:haven:port:")).length, 3);
  // Something of the player's own left in a store stays there; the port's goods in it are numbers again.
  game.inventory.medkit = (game.inventory.medkit ?? 0) + 1;
  const { key } = open(game, "haven", "granary");
  bag.bagCommand(game, { action: "drop", from: heldAt(game, "medkit") });
  assert.ok(game.stores[key].items.some((one) => one.id === "medkit"));
  const before = has(game, "haven", "ration_crates");
  bag.bagCommand(game, { action: "close" });
  travel(game, "meridian");
  assert.equal(game.portStores, undefined);
  assert.deepEqual(game.stores[key].items.map((one) => one.id), ["medkit"]);
  assert.equal(Object.keys(game.stores).filter((other) => other.startsWith("thing:haven:port:") && other !== key).length, 0);
  assert.equal(has(game, "haven", "ration_crates"), before, "leaving changes nothing the port has");
  // Back again: its share, and the medkit still in it.
  travel(game, "haven");
  assert.equal(inStore(game, "granary", "ration_crate"), 20);
  assert.ok(game.stores[key].items.some((one) => one.id === "medkit"));
});

test("the port's carriers keep a store at its share, a trip at a time, and say what they're carrying", () => {
  const game = ashoreAt("haven");
  // The port's own day leaves it with less food: the granary has too much for its share, and it's carried out.
  level(game, "haven", "ration_crates", 60);
  const amount = has(game, "haven", "ration_crates");
  minutes(game, 10);
  const jobs = portStoresView(game).jobs;
  assert.ok(jobs.length >= 1 && jobs.length <= 3, "a job to a carrier");
  assert.ok(jobs.every((job) => /^Docker (Pav|Renko|Bo)$/.test(job.who)));
  assert.ok(jobs.every((job) => /2 ration crates/.test(job.doing)), "two crates to a trip");
  assert.ok(new Set(jobs.map((job) => job.who)).size === jobs.length, "nobody's on two jobs");
  // Whoever's carrying says so in the room.
  const seen = [];
  for (let i = 0; i < 12; i += 1) {
    clockRuns(game, 5);
    for (const who of game.location === "haven" ? walk.walkView(game).people ?? [] : []) if (/ration crates?/.test(who.doing ?? "")) seen.push(`${who.name}: ${who.doing}`);
  }
  assert.ok(seen.some((line) => /carrying 2 ration crates out to the Manifest Docks/.test(line)), seen.join(" | "));
  minutes(game, 120);
  assert.equal(inStore(game, "granary", "ration_crate"), 12);
  assert.deepEqual(portStoresView(game).jobs, []);
  // Carrying between a store and the rest of the port changes nothing the port has.
  assert.equal(has(game, "haven", "ration_crates"), amount);
  // And when the hauls come in, it's carried back up.
  level(game, "haven", "ration_crates", 100);
  minutes(game, 15);
  assert.ok(portStoresView(game).jobs.some((job) => /from the Manifest Docks for the granary|to the granary/.test(job.doing)));
  minutes(game, 150);
  assert.equal(inStore(game, "granary", "ration_crate"), 20);
});

test("at night nobody carries, and a long wait leaves the stores as the port has them", () => {
  const game = ashoreAt("haven", 3);
  assert.equal(inStore(game, "granary", "ration_crate"), 20, "full on arrival, whatever the hour");
  level(game, "haven", "ration_crates", 50);
  minutes(game, 60);
  const view = portStoresView(game);
  assert.deepEqual(view.jobs, []);
  assert.equal(view.hands.free, 0);
  assert.equal(inStore(game, "granary", "ration_crate"), 20, "it waits for the morning");
  // A wait of half a day: nobody watched, and the store is as the port has it.
  passTime(game, 12);
  assert.equal(inStore(game, "granary", "ration_crate"), 10);
  assert.deepEqual(portStoresView(game).jobs, []);
});

test("what a ship takes at the dock comes off the shelves, and is made up from what the port has", () => {
  const game = ashoreAt("haven");
  takeAboard(game, "meridian", "ration_crate", 12);
  const before = has(game, "haven", "ration_crates");
  shipCommand(game, { action: "buy", id: "food" });
  const after = has(game, "haven", "ration_crates");
  assert.ok(Math.abs(before - after - 5) < 0.01, "five crates left the port");
  minutes(game, 5);
  const out = portStoresView(game).jobs.filter((job) => /from the granary/.test(job.doing));
  assert.equal(out.length, 3, "three trips for five crates");
  let low = 20;
  for (let i = 0; i < 24; i += 1) {
    clockRuns(game, 5);
    low = Math.min(low, inStore(game, "granary", "ration_crate"));
    assert.ok(Math.abs(has(game, "haven", "ration_crates") - after) < 0.01, "carrying changes nothing the port has");
  }
  assert.equal(low, 15, "all five came off the shelf");
  assert.equal(inStore(game, "granary", "ration_crate"), 20, "and it was made up again");
  assert.deepEqual(portStoresView(game).jobs, []);
});

test("what the player takes from a store comes out of the port, and what they leave in one is the port's", () => {
  const game = ashoreAt("haven");
  const before = has(game, "haven", "ration_crates");
  open(game, "haven", "granary");
  take(game, "ration_crate");
  const took = game.inventory.ration_crate;
  assert.ok(took >= 1);
  assert.ok(Math.abs(before - has(game, "haven", "ration_crates") - took) < 0.01, "the port has that many fewer");
  // Whatever the law makes of it, nothing is made or lost: what the player holds and what the port has add up.
  const notes = minutes(game, 60);
  assert.ok(Math.abs(has(game, "haven", "ration_crates") + (game.inventory.ration_crate ?? 0) - before) < 0.01);
  const law = notes.filter((line) => line.startsWith("[LAW]"));
  assert.ok(law.length >= 1, "the law has something to say of it");
  assert.match(law[0], /the granary/i);
  if (/saw you take/.test(law[0])) assert.equal(game.inventory.ration_crate ?? 0, 0, "seen, they go back");
  else assert.match(law[0], /isn't yours/);
  // A gift: a crate of the player's own put into the store is the port's.
  const gift = ashoreAt("haven");
  gift.inventory.medicine_crate = 1;
  const had = has(gift, "haven", "medicine_crates");
  open(gift, "haven", "bonded_store");
  bag.bagCommand(gift, { action: "drop", from: heldAt(gift, "medicine_crate") });
  assert.equal(gift.inventory.medicine_crate ?? 0, 0);
  assert.ok(Math.abs(has(gift, "haven", "medicine_crates") - had - 1) < 0.01, "the port has one more");
  // The shelf has one more than its share, and it's carried off into the port's holds, which changes nothing.
  assert.equal(inStore(gift, "bonded_store", "medicine_crate"), 5);
  minutes(gift, 60);
  assert.equal(inStore(gift, "bonded_store", "medicine_crate"), 4);
  assert.ok(Math.abs(has(gift, "haven", "medicine_crates") - had - 1) < 0.01);
});

test("a store never has more of a good than the port does, and a game that's saved goes on where it was", () => {
  const game = ashoreAt("ilun");
  // The monastery has two loads of night flowers in all, and its herb store shows them.
  assert.equal(inStore(game, "herb_store", "night_flowers"), 2);
  level(game, "ilun", "night_flowers", 30);
  minutes(game, 5);
  assert.equal(inStore(game, "herb_store", "night_flowers"), 0, "under one, there's none to stand on a shelf");
  // Saved in the middle of a job and opened again, the job goes on.
  const haven = ashoreAt("haven");
  level(haven, "haven", "ration_crates", 70);
  minutes(haven, 10);
  assert.ok(haven.portStores.jobs.length > 0);
  const copy = JSON.parse(JSON.stringify(haven));
  minutes(copy, 180);
  minutes(haven, 180);
  assert.equal(inStore(copy, "granary", "ration_crate"), 14);
  assert.equal(inStore(haven, "granary", "ration_crate"), 14);
});
