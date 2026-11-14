// The containers aboard the Meridian open, step 3 of the loot plan: the lockers, shelves, desks and barrels on her decks
// and the things named like a container, each filled the first time it's opened with things its kind holds (as many as
// its kind and its room say, each of a rarity by the file's chances), the same in the same game, and never refilled.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-loot-open-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { ITEMS } = await import("../src/data.js");
const { passTime } = await import("../src/rules.js");
const bag = await import("../src/bag.js");
const { mapFor, walkCommand, walkView } = await import("../src/walk.js");
const loot = await import("../src/loot.js");
const { parseLootText, writeLootText, readKindLine, readChances } = await import("../public/loot-text.js");
const { squaresOf } = await import("../public/furniture.js");

const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const map = mapFor("meridian");
const levels = Object.values(map.levels);
const things = levels.flatMap((level) => level.things.map((thing) => ({ level, thing })));
const roomOf = (level, thing) => level.roomAt(thing.x, thing.y);
const inRoom = (game, room) => {
  game.walk = null;
  walkCommand(game, { action: "room", to: room });
};
const keyOf = (thing) => `thing:meridian:${thing.id}`;
const containersIn = (room) => things.filter(({ level, thing }) => thing.onPiece && roomOf(level, thing) === room).map(({ thing }) => thing);
const open = (game, thing) => {
  bag.bagCommand(game, { action: "open", key: keyOf(thing) });
  return bag.bagView(game).open;
};
const kindNamed = (name) => loot.lootModel().kinds.find((kind) => kind.name === name);

test("aboard the Meridian, the lockers, shelves, desks and barrels on her decks open, each as its line says, and so do the things named like a container", () => {
  let pieces = 0;
  for (const level of levels) {
    for (const piece of level.furniture ?? []) {
      const room = map.rooms[level.roomAt(piece.x, piece.y)]?.name ?? "";
      const kind = loot.furnitureKindOf(piece.kind, room);
      if (!kind) continue;
      pieces += 1;
      const container = level.things.find((thing) => thing.onPiece && thing.x === piece.x && thing.y === piece.y);
      const covered = level.things.some((thing) => !thing.onPiece && squaresOf(piece).some(([x, y]) => thing.x === x && thing.y === y));
      assert.ok(container || covered, `the ${piece.kind} at ${piece.x},${piece.y} in ${room} opens`);
      if (container) {
        assert.equal(container.loot.kind, kind.name);
        assert.ok(container.holds && container.look, `${container.name} opens and has something to look at`);
      }
    }
  }
  assert.ok(pieces >= 80, `${pieces} pieces of storage furniture`);
  const names = (room) => new Set(containersIn(room).map((thing) => thing.name));
  assert.deepEqual([...names("armory")].sort(), ["A weapons locker", "A weapons shelf"]);
  assert.ok(names("engineering").has("A tool shelf"));
  assert.ok(names("galley").has("A pantry shelf"));
  assert.ok(names("medbay").has("A medicine shelf"));
  assert.ok(names("cabins").has("A locker"));
  assert.ok(things.some(({ thing }) => thing.name === "A barrel") && things.some(({ thing }) => thing.name === "A desk"));
  const named = (name) => things.find(({ thing }) => thing.name === name)?.thing;
  assert.equal(loot.lootOf("meridian", named("A sack under a rack"))?.kind, "pantry");
  assert.equal(loot.lootOf("meridian", named("A footlocker with no name on it"))?.kind, "crew locker");
  assert.equal(loot.lootOf("meridian", named("The captain's sea chest"))?.kind, "dresser");
  for (const story of ["Data chip in the comms tray", "Ready room locker", "Ration crate", "Tool roll on the bench", "Pantry", "Medicine cabinet", "Parts lockers", "The security desk"]) {
    assert.equal(loot.lootOf("meridian", named(story)), null, `${story} keeps to what it is`);
  }
  assert.ok(named("A sack under a rack").holds, "a thing named like a container opens");
});

test("only the Meridian's containers open for now: the other places' come in step 4", () => {
  assert.equal(loot.lootOf("haven", { name: "A crate of something" }), null);
  assert.equal(loot.lootOf("meridian", { name: "A crate of something" })?.kind, "crate");
  for (const place of ["haven", "kessara", "frontier"]) {
    for (const level of Object.values(mapFor(place).levels)) assert.ok(!level.things.some((thing) => thing.loot || thing.onPiece), `nothing opens as loot at ${place} yet`);
  }
});

test("opening one fills it once with things its kind holds, as many as its kind and its room say, and the same game finds the same", () => {
  const game = newGame();
  inRoom(game, "cabins");
  const lockers = containersIn("cabins");
  assert.ok(lockers.length >= 4);
  const before = structuredClone(game);
  const seen = [];
  for (const locker of lockers) {
    const grid = open(game, locker);
    const kind = kindNamed(locker.loot.kind);
    assert.equal(grid.name, locker.name);
    assert.deepEqual([grid.cols, grid.rows], [kind.size.cols, kind.size.rows], "it holds as many squares as its kind");
    for (const one of grid.items) assert.ok(ITEMS[one.id].foundIn.includes(kind.name), `${one.id} turns up in a ${kind.name}`);
    const picked = loot.rollLoot(game, keyOf(locker), locker.loot, "meridian", "The Officers' Cabins");
    assert.ok(picked.length >= kind.things[0] + 1 && picked.length <= kind.things[1] + 1, `a cabin holds one more: ${picked.length}`);
    assert.ok(game.stores[keyOf(locker)], "what's in it is kept from the first time it's opened");
    seen.push(grid.items.map((one) => `${one.id}x${one.n}@${one.x},${one.y}`));
    bag.bagCommand(game, { action: "close" });
  }
  // Opened again, and in a save of the same game from before any was opened, each holds the same.
  lockers.forEach((locker, i) => assert.deepEqual(open(game, locker).items.map((one) => `${one.id}x${one.n}@${one.x},${one.y}`), seen[i]));
  lockers.forEach((locker, i) => assert.deepEqual(open(before, locker).items.map((one) => `${one.id}x${one.n}@${one.x},${one.y}`), seen[i]));
  // Another game, with its own seed, finds other things.
  const other = newGame(22);
  other.bodySeed = game.bodySeed + 1;
  inRoom(other, "cabins");
  assert.ok(lockers.some((locker, i) => JSON.stringify(open(other, locker).items.map((one) => `${one.id}x${one.n}@${one.x},${one.y}`)) !== JSON.stringify(seen[i])));
});

test("taking everything leaves it empty, and nothing comes back: not the next day, nor a month later", () => {
  const game = newGame();
  inRoom(game, "boat_bay");
  const full = containersIn("boat_bay").find((thing) => open(game, thing).items.length);
  assert.ok(full, "something in the Boat Bay has something in it");
  for (const one of [...bag.bagView(game).open.items]) bag.bagCommand(game, { action: "take", from: { at: "open", x: one.x, y: one.y } });
  assert.deepEqual(bag.bagView(game).open.items, []);
  bag.bagCommand(game, { action: "close" });
  assert.equal(walkView(game).things.find((one) => one.id === full.id)?.empty, true, "the room says it's empty");
  passTime(game, 24, "rest");
  inRoom(game, "boat_bay");
  assert.deepEqual(open(game, full).items, []);
  bag.bagCommand(game, { action: "close" });
  passTime(game, 24 * 30, "rest");
  inRoom(game, "boat_bay");
  assert.deepEqual(open(game, full).items, [], "filled once, the first time, and never again");
});

test("looking round the room fills nothing: a container is only filled when it's opened", () => {
  const game = newGame();
  inRoom(game, "bunks");
  const view = walkView(game);
  const shown = view.things.filter((one) => one.loot);
  assert.ok(shown.length >= 3, "the Hot Bunks' lockers, the sack and the footlocker");
  assert.ok(shown.some((one) => one.onPiece === "locker" && one.holds && one.store), "a locker on the deck is a container the room shows");
  assert.ok(shown.some((one) => !one.onPiece && one.name === "A sack under a rack"));
  assert.equal(game.stores, undefined, "nothing's been opened, so nothing's in the save");
});

test("rooms that hold more or fewer, and rarities about as often as the file's chances", () => {
  const game = newGame();
  const crew = { kind: "crew locker" };
  const counts = (room) => Array.from({ length: 200 }, (_, i) => loot.rollLoot(game, `test:${room}:${i}`, crew, "meridian", room).length);
  const bunks = counts("The Hot Bunks");
  const cabins = counts("The Officers' Cabins");
  assert.ok(bunks.every((n) => n <= 2) && cabins.every((n) => n >= 1 && n <= 4), "the Hot Bunks hold one fewer, the cabins one more");
  assert.ok(cabins.reduce((a, b) => a + b, 0) > bunks.reduce((a, b) => a + b, 0) * 1.5);
  const rarity = { common: 0, uncommon: 0, rare: 0 };
  for (let i = 0; i < 1500; i += 1) for (const { id } of loot.rollLoot(game, `test:crate:${i}`, { kind: "crate" }, "meridian", "Stores")) rarity[ITEMS[id].rarity] += 1;
  const all = rarity.common + rarity.uncommon + rarity.rare;
  assert.ok(rarity.common / all > 0.62 && rarity.common / all < 0.78, `common ${rarity.common / all}`);
  assert.ok(rarity.rare / all > 0.02 && rarity.rare / all < 0.09, `rare ${rarity.rare / all}`);
  for (let i = 0; i < 200; i += 1) {
    for (const { id, n } of loot.rollLoot(game, `test:armory:${i}`, { kind: "armory" }, "meridian", "The Armory")) {
      assert.ok(ITEMS[id].foundIn.includes("armory"));
      assert.ok(n >= 1 && n <= Math.max(1, ITEMS[id].stack ?? 1), `${id} x${n}`);
    }
  }
});

test("the containers file: the chances and each kind's look read and write back exactly, and a wrong one says what's wrong", () => {
  const text = fs.readFileSync(path.join(loot.LOOT_DIR, "containers.txt"), "utf8").replace(/\r\n/g, "\n");
  const { value, problems } = parseLootText(text);
  assert.deepEqual(problems, []);
  assert.deepEqual(value.chances, { common: 70, uncommon: 25, rare: 5 });
  assert.ok(value.kinds.every((kind) => kind.look), "every kind says how it looks as a piece of furniture");
  assert.equal(writeLootText(value), text);
  assert.equal(readKindLine("desk: called desk; 6x3; 0 to 3 things; Its drawers stick.").look, "Its drawers stick.");
  assert.match(readChances("common seventy").problem, /a rarity and a number/);
  assert.match(readChances("legendary 5").problem, /isn't a rarity/);
  assert.match(readChances("common 0, rare 0").problem, /more than 0/);
  assert.match(parseLootText("# Loot\nchances: common lots\n").problems[0].message, /a rarity and a number/);
});
