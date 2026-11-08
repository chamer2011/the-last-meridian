// The ship as decks: each deck one Tiled map with its rooms drawn on it, and the game still knowing rooms. Where the
// player is, walking from room to room and deck to deck, the deck plan, the story putting the player in a room by
// name, who's in which room, doors the systems lock inside a deck, rooms going dark one by one, people's days on the
// decks, and a save from before the decks. None of this calls a real AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-decks-"));
process.env.GAME_DATA_DIR = dataDir;

const { WORLD_MAPS, MAP_FILE_PROBLEMS } = await import("../src/world.js");
const { canStand, mapFor, personWhere, roomHere, roomsOf, setScene, walkCommand, walkLine, walkOf, walkView } = await import("../src/walk.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { lifeOf, peopleAboard } = await import("../src/life.js");
const { roomDark, setDoor, switchPart, systemsOf } = await import("../src/systems.js");

const OLD_ROOMS = ["bridge", "mess", "engineering", "aft", "names", "medbay", "crawlways", "bunks"];
const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const walkTo = (game, id) => walkCommand(game, { action: "go", to: `room:${id}` });

test("the Meridian is three decks with its rooms drawn on them, and the eight old rooms are all there by their ids", () => {
  assert.deepEqual(Object.keys(WORLD_MAPS.meridian.levels), ["deck1", "deck2", "deck3"]);
  assert.deepEqual(MAP_FILE_PROBLEMS, []);
  const map = mapFor("meridian");
  assert.equal(map.start, "bridge");
  for (const id of OLD_ROOMS) {
    const room = map.rooms[id];
    assert.ok(room?.area, `${id} is a room drawn on a deck`);
    assert.ok(room.desc, `${id} says what it's like`);
  }
  const rooms = roomsOf(map);
  assert.ok(rooms.length >= 30, `${rooms.length} rooms`);
  for (const room of rooms) {
    const { area, level, start } = room;
    assert.ok(canStand(level, start.x, start.y), `${room.id}'s start can be stood on`);
    assert.equal(level.areaAt(start.x, start.y), room.id, `${room.id}'s start is in it`);
    assert.ok(area.doors.length + area.exits.length > 0, `${room.id} has a way in`);
  }
  // A square is in the smallest room drawn over it: the bridge's sensor pit would be, if it were drawn as one.
  assert.equal(map.levels.deck1.roomAt(25, 15), "bridge");
  assert.equal(map.levels.deck1.roomAt(80, 15), "names");
  assert.equal(map.levels.deck1.roomAt(0, 0), "deck1", "the dark outside is the deck itself");
});

test("a new game starts on the bridge, and here is the bridge, not the whole deck", () => {
  const game = newGame();
  const view = walkView(game);
  assert.equal(view.here.id, "bridge");
  assert.equal(view.here.name, "The Bridge");
  assert.equal(view.here.deck.id, "deck1");
  assert.match(view.here.desc, /repeater/);
  assert.equal(walkOf(game).level, "deck1");
  assert.ok(view.people.length > 0);
  for (const person of view.people) assert.ok(person.room, `${person.name} says which room they're in`);
  assert.ok(view.people.filter((person) => person.room === "bridge").some((person) => person.short === "Voss"));
  assert.ok(view.ways.some((way) => way.to === "names"), "the way out of the bridge leads to the Names Bulkhead");
  assert.equal(view.areas.length, map1().areas.length);
  assert.match(walkLine(game), /^Map: player at The Bridge\./);
  assert.match(walkLine(game), /Voss/);
  assert.doesNotMatch(walkLine(game), /Reddick/, "someone in another room isn't nearby");
});
const map1 = () => mapFor("meridian").levels.deck1;

test("walking into another room changes the room, not the deck, and the room's doors lead on", () => {
  const game = newGame();
  const reply = walkTo(game, "names");
  assert.ok(reply.path.length > 5, "it's a walk, not a jump");
  assert.equal(roomHere(game).id, "names");
  assert.equal(game.walk.level, "deck1");
  assert.match(walkLine(game), /player walked to The Names Bulkhead/);
  const view = walkView(game);
  assert.ok(view.ways.length >= 5, `the bulkhead opens on ${view.ways.length} rooms`);
  assert.ok(view.ways.some((way) => way.to === "bridge"));
  walkTo(game, "chart");
  assert.equal(roomHere(game).id, "chart");
  assert.equal(roomHere(game).name, "The Chart Room");
});

test("the deck plan has a plan for each deck, and a room on another deck is reached by the stairs", () => {
  const game = newGame();
  const { overview } = walkView(game);
  assert.equal(overview.decks.length, 3);
  assert.equal(overview.current, "deck1");
  const deck1 = overview.decks[0];
  assert.ok(deck1.here);
  assert.ok(deck1.rooms.find((room) => room.id === "bridge").here);
  assert.ok(deck1.rooms.find((room) => room.id === "bridge").people.includes("Voss"));
  for (const deck of overview.decks) {
    assert.ok(deck.layers.floor.length > 0, `${deck.id} has a plan`);
    for (const room of deck.rooms) assert.ok(Object.values(deck.floors).includes(room.id), `${room.id} can be clicked on the plan`);
  }
  // The mess is on deck 2: the walk ends at the stairs, which are taken.
  const reply = walkTo(game, "mess");
  assert.equal(reply.arrived?.kind, "exit");
  assert.equal(game.walk.level, "deck2");
  assert.equal(roomHere(game).id, "stair_fore_2");
  const there = walkTo(game, "mess");
  assert.ok(there.path.length > 0);
  assert.equal(roomHere(game).id, "mess");
  assert.equal(walkView(game).overview.current, "deck2");
});

test("the story puts the player in a room by its name, with whoever's with them, on whichever deck", () => {
  const game = newGame();
  assert.match(setScene(game, "the Long Mess", ["voss"]), /at The Long Mess, with Ilya Voss/);
  assert.equal(game.walk.level, "deck2");
  assert.equal(roomHere(game).id, "mess");
  assert.equal(game.walk.with[0].id, "voss");
  assert.equal(walkView(game).people.find((one) => one.key === "voss")?.room, "mess");
  assert.match(setScene(game, "Engineering", []), /at Engineering/);
  assert.equal(game.walk.level, "deck3");
  // The deck plan's instant move, from the old plan, still works by a room's id.
  walkCommand(game, { action: "room", to: "medbay" });
  assert.equal(roomHere(game).id, "medbay");
  assert.equal(game.walk.level, "deck2");
});

test("where someone is tells rooms on a deck apart", () => {
  const game = newGame();
  assert.deepEqual(personWhere(game, "voss"), { here: true, room: "The Bridge" });
  walkTo(game, "names");
  const where = personWhere(game, "voss");
  assert.equal(where.here, false);
  assert.equal(where.room, "The Bridge");
  assert.equal(where.level, "bridge");
  assert.equal(where.reachable, true);
  walkCommand(game, { action: "room", to: where.level });
  assert.equal(personWhere(game, "voss").here, true);
  // Someone on another deck is found there too.
  assert.equal(personWhere(game, "marrow")?.room, "Engineering");
});

test("a door the systems lock is shut from both sides of a deck, shows as a door, and opens again", () => {
  const game = newGame();
  const level = map1();
  const door = level.areas.find((area) => area.id === "bridge").doors[0];
  assert.equal(walkView(game).floor[door.y][door.x], ".", "open to begin with");
  setDoor(game, "meridian", "bridge", "locked", { by: "story" });
  const view = walkView(game);
  assert.equal(view.floor[door.y][door.x], " ", "a locked door isn't floor");
  const shut = view.exits.find((exit) => exit.key === `door:${door.x},${door.y}`);
  assert.ok(shut?.closed && shut.locked, "the door shows as a locked way out");
  assert.ok(shut.actions.some((action) => action.id === "force"));
  assert.ok(view.ways.find((way) => way.to === "names").locked, "the way to the bulkhead says it's locked");
  // Walking into the door with the keys stops at it, as at any locked door, and the door's window comes up.
  const refused = walkCommand(game, { action: "move", x: door.x, y: door.y });
  assert.ok(refused.moved === false || refused.arrived?.kind === "door", JSON.stringify(refused.arrived ?? refused));
  assert.equal(roomHere(game).id, "bridge");
  const blocked = walkTo(game, "names");
  assert.match(blocked.message ?? "", /can't find a way/);
  assert.equal(roomHere(game).id, "bridge");
  setDoor(game, "meridian", "bridge", "unlocked", { by: "story" });
  assert.equal(walkView(game).floor[door.y][door.x], ".");
  walkTo(game, "names");
  assert.equal(roomHere(game).id, "names");
});

test("a room's lights go out on their own, and the rest of the deck stays lit", () => {
  const game = newGame();
  const model = systemsOf("meridian");
  const lights = Object.values(model.parts).find((part) => part.kind === "light switch" && part.room === "bridge");
  assert.ok(lights, "the bridge has a light switch of its own");
  assert.equal(level1AreaOf(lights), "bridge", "and it's on the bridge's own wall");
  switchPart(game, "meridian", lights.id, false);
  assert.equal(roomDark(game, "meridian", "bridge"), true);
  assert.equal(roomDark(game, "meridian", "names"), false);
  const view = walkView(game);
  assert.equal(view.room.dark, true, "the player's room is dark");
  assert.equal(view.areas.find((area) => area.id === "bridge").dark, true);
  assert.equal(view.areas.find((area) => area.id === "names").dark, false);
  // Every part of the ship's systems stands inside its own room.
  for (const part of Object.values(model.parts)) {
    if (part.unplaced) continue;
    const room = mapFor("meridian").rooms[part.room];
    const near = [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0]].some(([dx, dy]) => room.level.areaAt(part.x + dx, part.y + dy) === part.room);
    assert.ok(near, `the ${part.name} in ${room.name} is at ${part.x},${part.y}, in ${room.level.areaAt(part.x, part.y)}`);
  }
});
const level1AreaOf = (part) => {
  const level = mapFor("meridian").levels.deck1;
  return [[0, 1], [1, 0], [0, 0]].map(([dx, dy]) => level.areaAt(part.x + dx, part.y + dy)).find(Boolean);
};

test("people live their days in the rooms drawn on the decks", () => {
  const game = newGame();
  const map = mapFor("meridian");
  const inRoom = (deckId, roomId, hours) => {
    game.clock.hours = hours;
    return peopleAboard(game, "meridian", deckId).filter((one) => map.levels[deckId].roomAt(one.x, one.y) === roomId);
  };
  const lunch = inRoom("deck2", "mess", 12.5);
  assert.ok(lunch.length >= 3, `${lunch.length} people in the mess at lunch`);
  const night = [...inRoom("deck2", "bunks", 3), ...inRoom("deck1", "cabins", 3)];
  assert.ok(night.some((one) => one.asleep), "someone's asleep in the bunks or the cabins at three in the morning");
  // Everyone stands on the deck's floor, or lies on a bunk.
  for (const deckId of ["deck1", "deck2", "deck3"]) {
    const level = map.levels[deckId];
    for (const one of peopleAboard(game, "meridian", deckId)) {
      const onBunk = "[=]".includes(level.layers.scenery[one.y]?.[one.x] ?? "#");
      assert.ok(level.open[one.y]?.[one.x] || onBunk, `${one.name ?? one.id} stands on the deck, at ${one.x},${one.y}`);
    }
  }
});

test("a save that names a room as its level, from before the decks, stands at that room's spot", () => {
  const game = newGame();
  game.walk = { place: "meridian", level: "mess", x: 30, y: 4, walked: true, with: [], withLevel: null, room: null };
  const view = walkView(game);
  assert.equal(view.here.id, "mess");
  assert.equal(walkOf(game).level, "deck2");
  // And one with people on levels that are gone shows them settled afresh, with nobody lost, and the clock's first
  // move drops what was saved.
  game.life = { at: game.clock.hours, carry: 0, places: { meridian: { voss: { task: "x", level: "bridge", x: 3, y: 3, goal: { level: "bridge", x: 3, y: 3 }, path: null } } } };
  assert.ok(peopleAboard(game, "meridian", "deck1").some((one) => one.id === "voss"), "Voss is on her deck");
  lifeOf(game);
  assert.ok(Object.values(game.life.places.meridian ?? {}).every((state) => mapFor("meridian").levels[state.level]));
});
