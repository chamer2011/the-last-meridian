// Whose it is, step 5 of the loot plan: every container in a room belongs to someone, by the law files (a closed room's
// owners, a room's line, or the line for anywhere; world/law/elsewhere.txt at every place without a file of its own,
// where it's whoever holds the place, or whoever sleeps there in the rooms people live in), and taking from one that
// isn't yours matters only when it's seen: it goes back, aboard the witness remembers, ashore standing with whoever holds
// the place drops, and a second time within the week costs credits. Unseen, you're told once that nobody saw.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-loot-law-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const bag = await import("../src/bag.js");
const law = await import("../src/law.js");
const loot = await import("../src/loot.js");
const { clockRuns, passTime } = await import("../src/rules.js");
const systems = await import("../src/systems.js");
const walk = await import("../src/walk.js");

const newGame = (start = "engine_hand") => {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const toHour = (game, hour) => passTime(game, (((hour - (game.clock.hours % 24)) % 24) + 24) % 24 || 24, "rest");
const inRoom = (game, room) => {
  game.walk = null;
  walk.walkCommand(game, { action: "room", to: room });
};
const ashore = (game, place, room) => {
  game.location = place;
  game.ship.at = place;
  inRoom(game, room);
};
const lawLines = (notes) => notes.filter((one) => one.startsWith("[LAW]"));
// The containers in a room, as { level, thing }.
function containersIn(place, room) {
  const map = walk.mapFor(place);
  return Object.values(map.levels).flatMap((level) => level.things.map((thing) => ({ level, thing })))
    .filter(({ level, thing }) => (level.areas?.length ? level.roomAt(thing.x, thing.y) : level.id) === room && loot.lootOf(place, thing));
}
const keyOf = (place, thing) => `thing:${place}:${thing.id}`;
// Something to find in it, whatever it would have held: two ration bars in its corner.
const stock = (game, place, thing) => {
  game.stores = { ...(game.stores ?? {}), [keyOf(place, thing)]: { items: [{ id: "ration_bar", x: 0, y: 0, n: 2 }] } };
};
function takeFirst(game, place, thing) {
  bag.bagCommand(game, { action: "open", key: keyOf(place, thing) });
  const one = bag.bagView(game).open.items[0];
  bag.bagCommand(game, { action: "take", from: { at: "open", x: one.x, y: one.y } });
  bag.bagCommand(game, { action: "close" });
  return one;
}
const ownerOf = (place, room, pick = () => true) => {
  const found = containersIn(place, room).find(({ thing }) => pick(thing));
  return law.ownerWords(place, law.containerOwner(place, found.level, found.thing));
};
const blind = (game, room) => {
  systems.applySystemsEffect(game, { system: "cameras", room, state: "off" });
  systems.applySystemsEffect(game, { system: "lights", room, state: "off" });
};

test("every container belongs to someone, by the law files, and the files read with nothing wrong", () => {
  assert.deepEqual(law.lawProblems(), []);
  assert.equal(ownerOf("meridian", "cabins"), "It belongs to whoever sleeps here.");
  assert.equal(ownerOf("meridian", "galley"), "It belongs to the quartermaster and the cooks.");
  assert.equal(ownerOf("meridian", "armory"), "It belongs to the chief of security and the guards.", "a closed room's containers are its owners'");
  assert.equal(ownerOf("meridian", "wardroom"), "It's the captain's.");
  assert.equal(ownerOf("meridian", "boat_bay"), null, "anywhere else, everyone's");
  assert.equal(ownerOf("haven", "row"), "It belongs to the Kessara Syndicate.", "at a port without a file, whoever holds the place");
  assert.equal(ownerOf("haven", "hook"), "It belongs to whoever sleeps here.", "the refugees' own footlocker");
  assert.equal(ownerOf("frontier", "commons"), "It belongs to the people of Tessen Colony.", "a place held by nobody is its people's");
  assert.equal(law.lawOf("haven").shared, true);
  assert.equal(law.lawOf("haven").standing, 3);
  const read = law.parseLaw("Containers:\n- The Galley: the cooks\n- anywhere else: everyone\nseen taking: it goes back; 5 credits fined a second time within 3 days\nseen taking costs standing: 2 with whoever holds the place\n");
  assert.deepEqual(read.containers.map((one) => [one.name, one.owners]), [["The Galley", ["the cooks"]], ["anywhere else", ["everyone"]]]);
  assert.deepEqual(read.taking, { fine: 5, days: 3 });
  assert.equal(read.standing, 2);
  assert.deepEqual(read.problems, []);
});

test("the captain takes from anything aboard and nothing's said; a hand seen taking from the galley's shelf gives it back", () => {
  const captain = newGame("captain");
  toHour(captain, 10);
  inRoom(captain, "galley");
  const shelf = containersIn("meridian", "galley")[0].thing;
  stock(captain, "meridian", shelf);
  takeFirst(captain, "meridian", shelf);
  assert.deepEqual(lawLines(clockRuns(captain, 1)), []);
  assert.equal(captain.inventory.ration_bar, 2);
  const hand = newGame();
  toHour(hand, 10);
  inRoom(hand, "galley");
  assert.ok(law.whoSees(hand, "meridian", "galley"), "someone's in the galley at ten, or a camera is");
  stock(hand, "meridian", shelf);
  takeFirst(hand, "meridian", shelf);
  const said = lawLines(clockRuns(hand, 1));
  assert.match(said[0], /^\[LAW\] .+ saw you take 2 ration bars from a pantry shelf\. They go back\.$/);
  assert.equal(hand.inventory.ration_bar ?? 0, 0);
  assert.equal(hand.stores[keyOf("meridian", shelf)].items.reduce((sum, one) => sum + one.n, 0), 2, "back in the shelf");
  assert.deepEqual(lawLines(clockRuns(hand, 1)), [], "and nothing more is said");
});

test("unseen, in the dark with the cameras off, the player is told once that nobody saw", () => {
  const hand = newGame();
  toHour(hand, 10);
  inRoom(hand, "galley");
  blind(hand, "The Galley");
  const [one, two] = containersIn("meridian", "galley").map(({ thing }) => thing);
  stock(hand, "meridian", one);
  stock(hand, "meridian", two);
  takeFirst(hand, "meridian", one);
  assert.deepEqual(lawLines(clockRuns(hand, 1)), ["[LAW] A pantry shelf isn't yours: it belongs to the quartermaster and the cooks. Nobody saw."]);
  assert.equal(hand.inventory.ration_bar, 2);
  takeFirst(hand, "meridian", one === two ? one : two);
  const again = lawLines(clockRuns(hand, 1));
  assert.ok(again.length <= 1, "told once for each container, never twice for one");
});

test("taking back what the player put in isn't taking", () => {
  const hand = newGame();
  toHour(hand, 10);
  inRoom(hand, "galley");
  const shelf = containersIn("meridian", "galley")[0].thing;
  stock(hand, "meridian", shelf);
  bag.bagCommand(hand, { action: "open", key: keyOf("meridian", shelf) });
  const mine = Object.keys(hand.inventory).find((id) => ["ration_pack", "medkit", "stim"].includes(id));
  assert.ok(mine, "the hand carries a supply of their own");
  const where = ["pockets", "pack", "belt"].flatMap((at) => (at === "belt" ? hand.bag.belt.map((one, i) => (one?.id === mine ? { at, i } : null)) : hand.bag[at].filter((one) => one.id === mine).map((one) => ({ at, x: one.x, y: one.y })))).find(Boolean);
  const had = hand.inventory[mine];
  bag.bagCommand(hand, { action: "drop", from: where });
  const back = bag.bagView(hand).open.items.find((one) => one.id === mine);
  bag.bagCommand(hand, { action: "take", from: { at: "open", x: back.x, y: back.y } });
  bag.bagCommand(hand, { action: "close" });
  assert.equal(hand.inventory[mine], had);
  assert.deepEqual(lawLines(clockRuns(hand, 1)), []);
});

test("ashore, taking from whoever holds the place in front of someone costs standing, and a fine the second time", () => {
  const game = newGame("captain");
  game.clock.hours = 10;
  let room = null;
  for (const one of ["bar", "docks", "row", "warm"]) {
    ashore(game, "haven", one);
    if (containersIn("haven", one).length && law.whoSees(game, "haven", one)) {
      room = one;
      break;
    }
  }
  assert.ok(room, "someone's about in one of Haven's rooms with a container");
  const { thing } = containersIn("haven", room)[0];
  const window = walk.walkView(game).things.find((one) => one.id === thing.id);
  assert.match(window.look, /It belongs to the Kessara Syndicate\.$/, "its window says whose it is");
  const standing = game.factions.drift;
  stock(game, "haven", thing);
  takeFirst(game, "haven", thing);
  const notes = clockRuns(game, 1);
  const said = lawLines(notes);
  assert.match(said[0], /saw you take 2 ration bars from .+\. They go back\.$/);
  assert.ok(notes.some((one) => /^\[FACTION\] Kessara Syndicate -3: seen taking from .+ at Haven Station$/.test(one)), notes.join("\n"));
  assert.equal(game.factions.drift, standing - 3);
  assert.equal(game.inventory.ration_bar ?? 0, 0);
  const credits = game.credits;
  takeFirst(game, "haven", thing);
  const second = lawLines(clockRuns(game, 1));
  assert.ok(second.includes("[LAW] It's not the first time this week: you're fined 10 credits."), second.join("\n"));
  assert.equal(game.credits, credits - 10);
});

test("taking everything from one container in front of someone is one taking, however many kinds of thing were in it", () => {
  const game = newGame("captain");
  game.clock.hours = 10;
  ashore(game, "haven", "bar");
  const { thing } = containersIn("haven", "bar")[0];
  assert.ok(law.whoSees(game, "haven", "bar"));
  game.stores = { [keyOf("haven", thing)]: { items: [{ id: "ration_bar", x: 0, y: 0, n: 2 }, { id: "galley_knife", x: 1, y: 0, n: 1 }] } };
  bag.bagCommand(game, { action: "open", key: keyOf("haven", thing) });
  for (const one of [...bag.bagView(game).open.items]) bag.bagCommand(game, { action: "take", from: { at: "open", x: one.x, y: one.y } });
  bag.bagCommand(game, { action: "close" });
  const standing = game.factions.drift;
  const credits = game.credits;
  const notes = clockRuns(game, 1);
  assert.deepEqual(lawLines(notes).length, 1, notes.join("\n"));
  assert.match(lawLines(notes)[0], /saw you take 2 ration bars and a galley knife from the weapons rack\. They go back\.$/);
  assert.equal(notes.filter((one) => one.startsWith("[FACTION]")).length, 1);
  assert.equal(game.factions.drift, standing - 3);
  assert.equal(game.credits, credits, "no fine the first time");
});

test("in the rooms people live in ashore, a container is whoever sleeps there's: it goes back, and nobody's standing drops", () => {
  const game = newGame("captain");
  game.clock.hours = 10;
  ashore(game, "haven", "hook");
  const { thing } = containersIn("haven", "hook")[0];
  if (!law.whoSees(game, "haven", "hook")) return;
  const standing = { ...game.factions };
  stock(game, "haven", thing);
  takeFirst(game, "haven", thing);
  const notes = clockRuns(game, 1);
  assert.match(lawLines(notes)[0], /saw you take 2 ration bars from a refugee's footlocker\. They go back\.$/);
  assert.ok(!notes.some((one) => one.startsWith("[FACTION]")));
  assert.deepEqual(game.factions, standing);
});
