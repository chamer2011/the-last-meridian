// The logistics rework, step 10, on the Story board: a port's page shows its stores, who carries for them and where
// goods come and go, with the place's rooms and people to pick from; a store's line is saved through the game's own
// readers into a copy of the file, and the stores are stood again from it without the game being closed; and what
// only the place's map and people can say is wrong is said in plain words.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-port-stores-board-"));
// The board saves into copies of the goods and the ports, never the game's own.
const copyOf = (folder) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `meridian-${folder}-`));
  for (const name of fs.readdirSync(new URL(`../world/${folder}`, import.meta.url))) fs.copyFileSync(new URL(`../world/${folder}/${name}`, import.meta.url), path.join(dir, name));
  return dir;
};
process.env.GAME_GOODS_DIR = copyOf("goods");
process.env.GAME_PORTS_DIR = copyOf("ports");

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const { boardWorldItem, saveBoardWorldItem } = await import("../src/board.js");
const { portStoreProblems, portStoresView } = await import("../src/port-stores.js");
const { portsProblems } = await import("../src/ports.js");
const { travel } = await import("../src/rules.js");
const walk = await import("../src/walk.js");
const { readPortStoreLine } = await import("../public/ports-text.js");

const ashoreAt = (place) => {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  game.scene = null;
  game.ship.at = place;
  game.clock.hours = Math.floor(game.clock.hours / 24) * 24 + 13;
  travel(game, place);
  return game;
};
// Every thing at a place that's one of its port's stores, as { store id: the level it stands on }.
const standing = (place) => Object.fromEntries(Object.values(walk.mapFor(place).levels).flatMap((level) => level.things.filter((one) => one.portStore).map((one) => [one.portStore, level.id])));
const CAGE = "- the chandler's cage in The Hook: usually 6 clothes, 6 tea and tobacco, 6 beer and spirits, 6 drinking water: What the station sells by the piece, behind wire, with the prices on a slate.";

test("a port's page has its stores, who carries and where goods come and go, and the place's rooms and people to pick from", () => {
  const haven = boardWorldItem("port", "haven");
  assert.deepEqual(haven.value.stores.map((one) => readPortStoreLine(one.text).name), ["the granary", "the bonded store", "the chandler's cage"]);
  assert.deepEqual(haven.value.carriers.list, ["Docker Pav", "Docker Renko", "Docker Bo"]);
  assert.equal(haven.value.dock.room, "The Manifest Docks");
  assert.ok(haven.lists.rooms.includes("The Manifest Docks") && haven.lists.rooms.includes("The Hook"));
  assert.ok(haven.lists.locals.includes("Docker Pav") && haven.lists.locals.includes("Tally Clerk Ise"));
  // Only what the port holds and someone can carry is offered for a store.
  assert.ok(haven.lists.carried.includes("ration crates") && haven.lists.carried.includes("meal"));
  assert.ok(!haven.lists.carried.includes("grain"), "Haven holds no grain");
  assert.ok(!boardWorldItem("port", "graveyard").lists.carried.includes("wrecks"), "nobody carries a wreck");
  assert.deepEqual(haven.problems, []);
  assert.ok(haven.text.includes(CAGE));
});

test("a store's line saved on the board is stood again at once: moved, changed, or taken away", () => {
  const haven = boardWorldItem("port", "haven");
  const game = ashoreAt("haven");
  assert.deepEqual(standing("haven"), { granary: "docks", bonded_store: "docks", chandlers_cage: "hook" });
  // Moved to another room, with something else in it.
  const moved = haven.text.replace(CAGE, "- the chandler's cage in The Consulate Row: usually 9 tea and tobacco, 3 fine things: Behind a polished counter now.");
  assert.deepEqual(saveBoardWorldItem("port", "haven", moved), { saved: true, problems: [] });
  assert.equal(standing("haven").chandlers_cage, "row");
  const cage = portStoresView(game).stores.find((one) => one.id === "chandlers_cage");
  assert.equal(cage.room, "The Consulate Row");
  assert.deepEqual(cage.items.map((one) => [one.name, one.usual]), [["tea and tobacco", 9], ["fine things", 3]]);
  // Taken out of the file: the thing is gone from the map, and its square is floor again.
  const row = walk.mapFor("haven").levels.row;
  const thing = row.things.find((one) => one.portStore === "chandlers_cage");
  assert.ok(row.solid.has(`${thing.x},${thing.y}`));
  assert.deepEqual(saveBoardWorldItem("port", "haven", haven.text.replace(`${CAGE}\n`, "")), { saved: true, problems: [] });
  assert.deepEqual(standing("haven"), { granary: "docks", bonded_store: "docks" });
  assert.equal(row.solid.has(`${thing.x},${thing.y}`), false);
  assert.equal(walk.canStand(row, thing.x, thing.y), true);
  assert.deepEqual(portStoresView(game).stores.map((one) => one.id), ["granary", "bonded_store"]);
  // And put back as it was.
  assert.deepEqual(saveBoardWorldItem("port", "haven", haven.text), { saved: true, problems: [] });
  assert.deepEqual(standing("haven"), { granary: "docks", bonded_store: "docks", chandlers_cage: "hook" });
});

test("what's wrong with a store is said in plain words: its line, its goods, its room, its size and who carries", () => {
  const haven = boardWorldItem("port", "haven");
  const save = (text) => saveBoardWorldItem("port", "haven", text);
  // A line that can't be read isn't saved at all.
  const unread = save(haven.text.replace(CAGE, "- the chandler's cage: usually 6 clothes"));
  assert.equal(unread.saved, false);
  assert.match(unread.problems[0], /in and its room/);
  // A room the place doesn't have.
  const nowhere = save(haven.text.replace("the chandler's cage in The Hook", "the chandler's cage in The Engine Room"));
  assert.equal(nowhere.saved, true);
  assert.ok(nowhere.problems.some((one) => /Haven Station has no room called The Engine Room, for the chandler's cage to stand in/.test(one)), nowhere.problems.join(" | "));
  // More than fits a store's thirty squares.
  const big = save(haven.text.replace("usually 6 clothes, 6 tea and tobacco", "usually 120 clothes, 6 tea and tobacco"));
  assert.ok(big.problems.some((one) => /the chandler's cage would usually hold more than fits: 46 squares of things, and a store has 30/.test(one)), big.problems.join(" | "));
  // A good the port doesn't hold, one that isn't a good, and one nobody can carry.
  const grain = save(haven.text.replace("usually 6 clothes,", "usually 6 grain, 6 moonbeams,"));
  assert.ok(grain.problems.some((one) => /the chandler's cage keeps grain, and the port holds none/.test(one)), grain.problems.join(" | "));
  assert.ok(grain.problems.some((one) => /there's no good called moonbeams in world\/goods, to keep in the chandler's cage/.test(one)));
  const graveyard = boardWorldItem("port", "graveyard");
  const wrecks = saveBoardWorldItem("port", "graveyard", graveyard.text.replace("usually 12 scrap,", "usually 12 scrap, 2 wrecks,"));
  assert.ok(wrecks.problems.some((one) => /wrecks can't stand in a store/.test(one)), wrecks.problems.join(" | "));
  assert.deepEqual(saveBoardWorldItem("port", "graveyard", graveyard.text), { saved: true, problems: [] });
  // A store written twice, and a carrier nobody at the place is called.
  const twice = save(haven.text.replace(CAGE, `${CAGE}\n- the chandler's cage in The Hook: usually 3 clothes`));
  assert.ok(twice.problems.some((one) => /the chandler's cage is written twice under Stores/.test(one)), twice.problems.join(" | "));
  const stranger = save(haven.text.replace("carried by: Docker Pav,", "carried by: Docker Nobody,"));
  assert.ok(stranger.problems.some((one) => /nobody called Docker Nobody has a day at Haven Station in world\/life, to carry for its stores/.test(one)), stranger.problems.join(" | "));
  // Stores and nobody at all to carry for them.
  const nobody = save(haven.text.replace("carried by: Docker Pav, Docker Renko, Docker Bo\n", ""));
  assert.ok(nobody.problems.some((one) => /Haven Station has stores and nobody to carry for them/.test(one)), nobody.problems.join(" | "));
  // A room for goods to come and go by that isn't there.
  const dock = save(haven.text.replace("goods come and go by: The Manifest Docks", "goods come and go by: The Back Stairs"));
  assert.ok(dock.problems.some((one) => /Haven Station has no room called The Back Stairs, for goods to come and go by/.test(one)), dock.problems.join(" | "));
  // As it was, nothing's wrong anywhere.
  assert.deepEqual(save(haven.text), { saved: true, problems: [] });
  assert.deepEqual(portsProblems(), []);
  assert.deepEqual(portStoreProblems(), []);
});
