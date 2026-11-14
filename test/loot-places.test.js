// The containers at every place, step 4 of the loot plan: anything named like a container opens wherever it is (read for
// what it's a name of, so a drawing under the desks isn't a desk), the file's Things lines say a thing opens as another
// kind or not at all, and each room its Rooms that get one lines name gets a container of its own, on a free square at
// the edge of the room, unless it has one already; each is filled the first time it's opened, like the Meridian's.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-loot-places-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { ITEMS, LOCATIONS } = await import("../src/data.js");
const bag = await import("../src/bag.js");
const { mapFor, walkCommand, walkView } = await import("../src/walk.js");
const loot = await import("../src/loot.js");
const { parseLootText, writeLootText, readRoomLine, readThingLine } = await import("../public/loot-text.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const atPlace = (game, place, room) => {
  game.location = place;
  game.ship.at = place === "meridian" ? null : place;
  game.walk = null;
  walkCommand(game, { action: "room", to: room });
  return game;
};
const roomsOf = (place) => Object.values(mapFor(place).rooms).filter((room) => !room.deck);
const thingsIn = (place, room) => room.level.things.filter((thing) => !room.area || room.level.areaAt?.(thing.x, thing.y) === room.area.id);
const named = (place, name) => Object.values(mapFor(place).levels).flatMap((level) => level.things).find((thing) => thing.name === name);
const fileText = fs.readFileSync(path.join(loot.LOOT_DIR, "containers.txt"), "utf8").replace(/\r\n/g, "\n");
const model = parseLootText(fileText).value;

test("a thing named like a container opens wherever it is, read for what it's a name of", () => {
  const kindOf = (name) => loot.containerKindOf(name)?.name ?? null;
  assert.equal(kindOf("A stack of medical crates"), "medicine cabinet", "a stack of medical crates is medical crates");
  assert.equal(kindOf("The drawing under the desks"), null, "a drawing under the desks is a drawing");
  assert.equal(kindOf("A hatch in the cable tray"), null);
  assert.equal(kindOf("A contract, open on the desk"), null);
  assert.equal(kindOf("A box of colored tags"), "crate", "a box of tags is a box");
  assert.equal(kindOf("A chest of drawers in the corner"), "dresser");
  assert.equal(kindOf("The clerk's desk"), "desk");
  assert.equal(kindOf("A filing cabinet"), "desk");
  assert.equal(kindOf("A footlocker with no name on it"), "crew locker");
  assert.equal(loot.lootOf("haven", named("haven", "A stack of medical crates"))?.kind, "medicine cabinet");
  assert.equal(loot.lootOf("haven", named("haven", "The weapons rack"))?.kind, "armory");
  assert.ok(named("haven", "The weapons rack").holds, "it opens");
  assert.equal(loot.lootOf("graveyard", named("graveyard", "The only bar"))?.kind, "cooler");
  for (const [place, story] of [["haven", "Papers on the Legate's desk"], ["kessara", "A jammer on a crate"], ["wheel", "A tray of markers"]]) {
    assert.equal(loot.lootOf(place, named(place, story)), null, `${story} keeps to its story`);
  }
});

test("the file's Things lines say a thing opens as another kind, or not at all", () => {
  assert.equal(loot.containerKindOf("Crates of paper").name, "crate");
  assert.equal(loot.lootOf("haven", named("haven", "Crates of paper"))?.kind, "desk", "Tharel's crates of paper hold papers");
  assert.equal(loot.lootOf("anselm", named("anselm", "A box of colored tags"))?.kind, "desk");
  assert.equal(loot.lootOf("meridian", { name: "Crates of paper" })?.kind, "crate", "a line is for its own place");
  assert.deepEqual(readThingLine("frontier, The drawing under the desks: nothing"), { place: "frontier", thing: "The drawing under the desks", kind: null });
  assert.match(readThingLine("haven, Crates of paper: desk, called Tharel's desk").problem, /keeps the name its map gives it/);
  assert.match(readThingLine("Crates of paper").problem, /a place's id, a comma/);
});

test("each room the file names gets a container of its own on a free square at its edge, and none where it has one already", () => {
  let given = 0;
  for (const place of Object.keys(LOCATIONS)) {
    for (const room of roomsOf(place)) {
      const gets = loot.roomGets(place, room.name);
      const mine = thingsIn(place, room).filter((thing) => thing.id === `loot:${room.id}`);
      const others = thingsIn(place, room).filter((thing) => thing.id !== `loot:${room.id}` && (thing.store || loot.lootOf(place, thing)));
      if (!gets?.kind || others.length) {
        assert.equal(mine.length, 0, `${place}: ${room.name} gets nothing of its own`);
        continue;
      }
      assert.equal(mine.length, 1, `${place}: ${room.name} gets a ${gets.kind}`);
      const [box] = mine;
      given += 1;
      assert.equal(box.loot.kind, gets.kind);
      assert.ok(box.quiet && box.holds && box.look, `${box.name} opens, and has words to look at`);
      if (gets.name) assert.equal(box.name.toLowerCase(), gets.name.toLowerCase());
      const level = room.level;
      assert.ok(level.solid.has(`${box.x},${box.y}`), "it stands where nobody walks through it");
      assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => level.open[box.y + dy]?.[box.x + dx]), `${box.name} can be reached from beside it`);
      assert.ok(!level.exits.some((exit) => exit.x === box.x && exit.y === box.y) && !level.doors.has(`${box.x},${box.y}`), "it's not in a way out");
    }
  }
  assert.ok(given >= 55, `${given} rooms given a container`);
  assert.equal(loot.roomGets("sarn", "The Vault Roads").kind, null, "a room's own line, even one that says nothing, beats the words");
  assert.equal(loot.roomGets("anywhere", "The Old Tavern").kind, "cooler", "rooms called tavern get a cooler");
  assert.equal(loot.roomGets("haven", "The Manifest Docks"), null);
  assert.ok(thingsIn("haven", roomsOf("haven").find((room) => room.name === "The Manifest Docks")).every((thing) => !thing.id.startsWith("loot:")), "the docks have their medical crates");
  for (const place of ["nest", "harbor"]) assert.ok(roomsOf(place).every((room) => !thingsIn(place, room).some((thing) => loot.lootOf(place, thing))), `nothing opens at ${place}`);
  assert.deepEqual(loot.lootProblems(), []);
});

test("a container a room was given fills once, the same in the same game, and the room shows it with a quiet mark", () => {
  const game = atPlace(newGame(), "haven", "hook");
  const box = walkView(game).things.find((thing) => thing.id === "loot:hook");
  assert.ok(box?.loot && box.quiet && box.holds && !box.onPiece, "the room shows a container with a quiet mark");
  assert.equal(game.stores, undefined, "nothing's filled by looking");
  const before = structuredClone(game);
  bag.bagCommand(game, { action: "open", key: box.store });
  const grid = bag.bagView(game).open;
  assert.equal(grid.name, "A refugee's footlocker");
  assert.deepEqual([grid.cols, grid.rows], [4, 4], "a crew locker's squares");
  for (const one of grid.items) assert.ok(ITEMS[one.id].foundIn.includes("crew locker"), one.id);
  const seen = grid.items.map((one) => `${one.id}x${one.n}`);
  bag.bagCommand(before, { action: "open", key: box.store });
  assert.deepEqual(bag.bagView(before).open.items.map((one) => `${one.id}x${one.n}`), seen, "a save from before finds the same");
  for (const one of [...grid.items]) bag.bagCommand(game, { action: "take", from: { at: "open", x: one.x, y: one.y } });
  bag.bagCommand(game, { action: "close" });
  assert.equal(walkView(game).things.find((thing) => thing.id === "loot:hook").empty, true);
  // A place that's poorer finds less: the Graveyard's salvage bins hold one fewer.
  const poor = { kind: "crate" };
  const counts = Array.from({ length: 150 }, (_, i) => loot.rollLoot(game, `test:${i}`, poor, "graveyard", "Claim Row").length);
  assert.ok(counts.every((n) => n <= 3), "a crate at the Graveyard holds at most three things");
});

test("the Rooms that get one and Things lines read and write back exactly, and a wrong one says what's wrong", () => {
  assert.equal(writeLootText(model), fileText);
  assert.ok(model.rooms.length >= 60 && model.things.length >= 2);
  assert.deepEqual(readRoomLine("rooms called bar, tavern: cooler"), { words: ["bar", "tavern"], kind: "cooler" });
  assert.deepEqual(readRoomLine("haven, The Hook: crew locker, called a refugee's footlocker"), { place: "haven", room: "The Hook", kind: "crew locker", name: "a refugee's footlocker" });
  assert.deepEqual(readRoomLine("sarn, The Vault Roads: nothing"), { place: "sarn", room: "The Vault Roads", kind: null });
  assert.match(readRoomLine("The Hook: crate").problem, /rooms called bar, tavern: cooler, or a place's id/);
  assert.match(readRoomLine("haven, The Hook: a crate!").problem, /ends with a kind of container/);
  const { problems } = parseLootText("# Loot\n\nRooms that get one:\n- The Hook\n");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].line, 4);
});
