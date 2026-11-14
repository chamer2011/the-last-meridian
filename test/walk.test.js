// The walk-around view: each room's level, walking, doors, talking with the clock stopped, the game
// master's set_scene tool, rooms that aren't on a plan, and old saves. None of this calls a real AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-walk-"));
process.env.GAME_DATA_DIR = dataDir;

const { findCampaignRoom, saveCampaignCharacter, saveCampaignRoom } = await import("../src/campaign.js");
const { checkCommand } = await import("../src/checks.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { ITEMS, LOCATIONS } = await import("../src/data.js");
const { shipCommand, shipLedger } = await import("../src/ship.js");
const { migrateGame } = await import("../src/migrate.js");
const { projectDir } = await import("../src/paths.js");
const { publicState, rest, travel } = await import("../src/rules.js");
const { rumorsFrom } = await import("../src/story-library.js");
const { TOOL_DEFS, newTurnLimits, runTool } = await import("../src/tools.js");
const { closeTalk, mapFor, roomHere, roomsOf, setScene, talkCommand, talkHeard, talkLineOver, talkSaid, walkCommand, walkFromStory, walkOf, walkView } = await import("../src/walk.js");
const { ROOM_KINDS, WORLD_MAPS } = await import("../src/world.js");
const { NOTABLES } = await import("../src/character-data.js");
// Whoever could have the chair is only there in a game where the player isn't the captain.
const forAnyGame = (id) => !NOTABLES[id]?.chair;

const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story so far." });
  return game;
};
const FILE = WORLD_MAPS.meridian;
// The ship is decks, each with its rooms drawn on it: the levels are the decks, and the rooms are known by their ids.
const LEVEL_IDS = Object.keys(FILE.levels);
const MAP = mapFor("meridian");
const ROOM_IDS = roomsOf(MAP).map((room) => room.id);
const deckOf = (view) => view.here.deck?.id ?? view.here.id;
const tool = (game, name, input) => runTool(game, name, input, newTurnLimits());
const spot = (game) => walkView(game).captain;
const person = (game, key) => walkView(game).people.find((one) => one.key === key);
const thing = (game, name) => walkView(game).things.find((one) => one.name === name);
const standOn = (game, x, y) => { Object.assign(walkOf(game), { x, y }); };
const enter = (game, id) => walkCommand(game, { action: "room", to: id }).walk;

// The squares a person, a thing, an exit or a label takes up on a level.
const run = (x, y, length, side = "right") => Array.from({ length }, (_, i) => `${side === "left" ? x - i : x + i},${y}`);
// Floor or a doorway on the plan, and not under furniture that's in the way, which the room's own floor knows.
const paved = (view, x, y) => ["floor", "doors"].some((layer) => view.layers[layer][y]?.[x] && view.layers[layer][y][x] !== " ") && view.floor[y]?.[x] === ".";
const standable = (view) => {
  const cells = [];
  for (let y = 0; y < view.lines; y += 1) {
    for (let x = 0; x < view.cols; x += 1) {
      const taken = [...view.things, ...view.people].some((one) => one.x === x && one.y === y);
      if (paved(view, x, y) && !taken) cells.push({ x, y });
    }
  }
  return cells;
};
function assertNothingOverlaps(view, label) {
  const taken = new Map();
  const claim = (name, squares) => {
    for (const key of squares) {
      assert.ok(!taken.has(key), `${label}: ${name} overlaps ${taken.get(key)} at ${key}`);
      const [x, y] = key.split(",").map(Number);
      assert.ok(x >= 0 && x < view.cols && y >= 0 && y < view.lines, `${label}: ${name} runs off the level at ${key}`);
      taken.set(key, name);
    }
  };
  for (const one of view.labels) claim(one.text, run(one.x, one.y, one.text.length));
  for (const one of view.exits) claim(one.label, run(one.x, one.y, one.label.length + 2, one.side));
  for (const one of view.people.filter((person) => !person.crowd && !person.walking)) claim(one.short, run(one.x, one.y, one.short.length + 2, one.side));
  // A container that's a piece of the deck's furniture lies under names and words, like the furniture itself.
  for (const one of view.things.filter((thing) => !thing.onPiece)) claim(one.name, run(one.x, one.y, 1));
  // A name can't sit over words on the wall, though a thing can be hung on them.
  view.layers.writing.forEach((row, y) => [...row].forEach((ch, x) => {
    const on = taken.get(`${x},${y}`);
    if (ch !== " ") assert.ok(!on || [...view.things].some((one) => one.name === on), `${label}: ${on} covers the writing at ${x},${y}`);
  }));
  assert.ok(!taken.has(`${view.captain.x},${view.captain.y}`), `${label}: the captain starts on top of ${taken.get(`${view.captain.x},${view.captain.y}`)}`);
}

// ---- The levels ---------------------------------------------------------

test("every room in the place's file has a level, and everyone in it has a post", () => {
  const game = newGame();
  const { gm } = LOCATIONS.meridian;
  for (const district of gm.districts) {
    setScene(game, district.name);
    const view = walkView(game);
    assert.equal(view.offPlan, false, district.name);
    assert.equal(view.here.desc, district.desc, `${district.name} should use the place file's description`);
  }
  const posted = LEVEL_IDS.flatMap((id) => Object.values(FILE.levels[id].people ?? {}).map((one) => one.id)).filter(forAnyGame).sort();
  assert.deepEqual(posted, [...gm.people].sort());
  for (const id of gm.people) assert.ok(LEVEL_IDS.some((level) => enter(structuredClone(game), level).people.some((one) => one.key === id)), `${id} isn't on any level`);
});

test("every item the place's file mentions is in a room, and each room has things in it of its own", () => {
  const items = LEVEL_IDS.flatMap((id) => Object.values(FILE.levels[id].things ?? {})).map((one) => one.item).filter(Boolean).sort();
  assert.deepEqual(items, [...LOCATIONS.meridian.gm.items].sort());
  const seen = new Set();
  for (const id of LEVEL_IDS) {
    const things = Object.values(FILE.levels[id].things ?? {});
    assert.ok(things.length >= 3, `${id} only has ${things.length} things in it`);
    for (const one of things) {
      assert.ok(one.name && one.look && one.use, `${id}: ${one.name}`);
      assert.ok(one.use.startsWith("I "), `${one.name}'s use should read as what the player does`);
      assert.ok(!seen.has(one.name), `${one.name} is in two rooms`);
      seen.add(one.name);
    }
  }
});

test("the decks are different from each other, and the rooms on them are the ship's own", () => {
  const levels = LEVEL_IDS.map((id) => FILE.levels[id]);
  assert.ok(levels.length >= 3, "the command deck, the civilian deck and engineering");
  assert.equal(new Set(levels.map((one) => JSON.stringify(one.colors))).size, levels.length, "every deck has its own colors");
  for (const one of levels) assert.ok(one.colors.floor && one.colors.walls && one.colors.scenery && one.colors.writing, one.name);
  const names = roomsOf(MAP).map((room) => room.name);
  assert.ok(names.length >= 7, "the Bridge, the Mess, Engineering, the Aft Holds, the Bulkhead, the Medbay and the Crawlways");
  assert.equal(new Set(names).size, names.length, "every room has its own name");
  for (const id of ["bridge", "mess", "engineering", "aft", "names", "medbay", "crawlways", "bunks"]) assert.ok(MAP.rooms[id]?.area, `${id} is a room drawn on a deck`);
  // The things each room's known for are drawn into it.
  const art = (id) => {
    const { level, area } = MAP.rooms[id];
    return FILE.levels[level.id].plan.slice(area.y, area.y + area.h).map((row) => row.slice(area.x, area.x + area.w)).join("\n");
  };
  assert.match(art("engineering"), /\*\*\*\*\*/, "the reactor");
  assert.ok(MAP.rooms.mess.level.furniture.filter((piece) => piece.kind === "long-table" && MAP.rooms.mess.level.areaAt(piece.x, piece.y) === "mess").length >= 4, "the long tables");
  const deck1 = FILE.levels.deck1.plan.join("\n");
  assert.ok(deck1.includes("*") && deck1.includes("'"), "stars outside the bridge");
  assert.match(art("aft"), /\[\]\[\]\[\]/, "the crates");
  assert.ok(Object.values(FILE.levels).flatMap((level) => level.writing ?? []).flat().join(" ").includes("OLD PETE"), "names in chalk");
  assert.ok(art("crawlways").split("\n").filter((row) => row.includes("~")).length >= 10, "ducts");
});

test("every letter and every square of a level means something, and its rows line up", () => {
  for (const id of LEVEL_IDS) {
    const level = FILE.levels[id];
    assert.equal(new Set(level.plan.map((row) => row.length)).size, 1, `${id}: the rows should all be the same length`);
    const text = level.plan.join("");
    for (const letter of new Set(text.match(/\p{L}/gu))) assert.ok(level.people?.[letter] || level.things?.[letter], `${id}: ${letter} isn't listed`);
    for (const mark of [...Object.keys(level.people ?? {}), ...Object.keys(level.things ?? {}), ...Object.keys(level.exits ?? {})]) {
      assert.equal(text.split(mark).length - 1, 1, `${id}: ${mark} should be on the plan exactly once`);
    }
    assert.equal(text.split("@").length - 1, 1, `${id}: where does the captain stand?`);
  }
});

test("every square of every level can be walked to, and everyone and everything in it can be reached", () => {
  const game = newGame();
  for (const id of LEVEL_IDS) {
    const view = enter(game, id);
    const cells = standable(view);
    assert.ok(cells.length > 40, id);
    // A whole deck has thousands of squares, so one in five is walked to.
    for (const target of cells.length > 400 ? cells.filter((_, i) => i % 5 === 0) : cells) {
      const fresh = structuredClone(game);
      const reply = walkCommand(fresh, { action: "go", ...target });
      assert.deepEqual(reply.walk.captain, target, `${id}: can't reach ${target.x},${target.y}`);
    }
    for (const one of view.people) assert.equal(walkCommand(structuredClone(game), { action: "go", to: `person:${one.key}` }).arrived?.kind, "person", `${id}: ${one.key}`);
    for (const one of view.things) assert.equal(walkCommand(structuredClone(game), { action: "go", to: `thing:${one.id}` }).arrived?.kind, "thing", `${id}: ${one.name}`);
    for (const one of view.exits) assert.equal(walkCommand(structuredClone(game), { action: "go", to: `exit:${one.key}` }).arrived?.kind, "exit", `${id}: ${one.label}`);
  }
});

test("in every level, people's names, room names and the ways out don't cover each other", () => {
  const game = newGame();
  for (const id of LEVEL_IDS) assertNothingOverlaps(enter(game, id), id);
});

test("words on a wall can be read, because nothing else is drawn under them", () => {
  const view = enter(newGame(), "mess");
  const y = view.layers.writing.findIndex((line) => line.includes("SITTINGS"));
  assert.ok(y >= 0, "the mess's sitting rota is on a wall");
  const row = view.layers.writing[y];
  const at = row.indexOf("SITTINGS");
  assert.ok(at > 0);
  assert.equal(view.layers.walls[y][at], " ");
  assert.equal(view.layers.walls[y][at - 2], "#");
  const gap = at + "SITTINGS:".length;
  assert.equal(row[gap], " ");
  assert.equal(view.layers.walls[y][gap], " ", "and that goes for the gaps between words");
});

test("the deck plan has every room on it, deck by deck, and clicking one goes there", () => {
  const game = newGame();
  const { overview } = walkView(game);
  assert.equal(overview.decks.length, LEVEL_IDS.length);
  const rooms = overview.decks.flatMap((deck) => deck.rooms);
  assert.deepEqual(rooms.map((room) => room.id).sort(), [...ROOM_IDS].sort());
  assert.equal(rooms.find((room) => room.here).id, "bridge");
  assert.ok(rooms.find((room) => room.id === "bridge").people.includes("Voss"));
  for (const deck of overview.decks) {
    for (const room of deck.rooms) {
      assert.ok(Object.values(deck.floors).includes(room.id), `no floor on the plan is ${room.id}`);
      const view = enter(game, room.id);
      assert.equal(view.here.id, room.id);
      assert.deepEqual(view.captain, roomHere(game).id === room.id ? { x: walkOf(game).x, y: walkOf(game).y } : null);
    }
  }
  assert.throws(() => walkCommand(game, { action: "room", to: "the moon" }), /isn't on the map/);
  assert.throws(() => walkCommand(game, { action: "room", to: "elsewhere:the moon" }), /don't know the way/);
});

// A place someone adds to world/places without drawing it stays in the classic view.
const withUnmappedPlace = (run) => {
  LOCATIONS.nowhere = structuredClone(LOCATIONS.haven);
  try {
    run();
  } finally {
    delete LOCATIONS.nowhere;
  }
};

test("a place with no levels has no walk-around view at all", () => {
  withUnmappedPlace(() => {
    const game = newGame();
    game.location = "nowhere";
    assert.equal(walkView(game), null);
    assert.equal(publicState(game).walk, null);
    assert.throws(() => walkCommand(game, { action: "go", x: 1, y: 1 }), /no map/);
  });
});

// ---- Every place ---------------------------------------------------------

const PLACE_IDS = Object.keys(LOCATIONS);
const LEVELS = PLACE_IDS.flatMap((place) => Object.entries(WORLD_MAPS[place]?.levels ?? {}).map(([id, file]) => ({ place, id, file, where: place + "/" + id })));
const at = (place, seed = 21) => {
  const game = newGame(seed);
  game.location = place;
  return game;
};
// Puts the captain in any level at all, whether its door is closed or not. A deck is entered by its id, since its
// name isn't a room's.
const inLevel = ({ place, id, file }) => {
  const game = at(place);
  if (file.areas?.length) walkCommand(game, { action: "room", to: id });
  else setScene(game, file.name);
  return game;
};
const plainName = (text) => text.toLowerCase().replace(/\s+/g, " ").replace(/^\s*the /, "").trim();

test("every place in the world has a map, and the captain arrives at its way in", () => {
  assert.ok(PLACE_IDS.length >= 24);
  for (const place of PLACE_IDS) {
    assert.ok(WORLD_MAPS[place], place + " has no map");
    const game = at(place);
    const view = walkView(game);
    assert.equal(view.here.id, WORLD_MAPS[place].start, place);
    assert.equal(view.offPlan, false);
    assert.ok(view.overview.title, place);
    assert.doesNotThrow(() => publicState(game));
    assert.equal(game.walk, null, "only looking doesn't change the save");
  }
});

test("every part of every place's file is on its map, with everyone and everything the file mentions", () => {
  for (const place of PLACE_IDS) {
    const { gm } = LOCATIONS[place];
    const file = WORLD_MAPS[place];
    const game = at(place);
    for (const district of gm.districts) {
      setScene(game, district.name);
      assert.equal(walkView(game).offPlan, false, place + ": " + district.name);
    }
    const levels = Object.values(file.levels);
    const posted = levels.flatMap((level) => Object.values(level.people ?? {}).map((one) => one.id)).filter(forAnyGame);
    assert.deepEqual([...posted].sort(), [...gm.people].sort(), place + ": who has a post, and nobody has two");
    const things = levels.flatMap((level) => Object.values(level.things ?? {}));
    for (const item of gm.items) assert.ok(things.some((one) => one.item === item), place + ": " + item + " isn't in any room");
    for (const one of things) {
      if (one.item) assert.ok(ITEMS[one.item], place + ": there's no such item as " + one.item);
      assert.ok(one.name && one.look && one.use, place + ": " + one.name);
      assert.ok(one.use.startsWith("I "), one.name + "'s use should read as what the player does");
    }
    assert.equal(new Set(things.map((one) => one.name)).size, things.length, place + ": each thing has its own name");
  }
});

test("in every level in the game, the rows line up, every letter means something, and it's small enough to read", () => {
  assert.ok(LEVELS.length > 100);
  for (const { where, file } of LEVELS) {
    assert.equal(new Set(file.plan.map((row) => row.length)).size, 1, where + ": the rows should all be the same length");
    // A room drawn in characters fits the text view; a deck with its rooms drawn on it scrolls.
    if (!file.areas?.length) assert.ok(file.plan[0].length <= 78 && file.plan.length <= 18, where + " is too big to read");
    const text = file.plan.join("");
    for (const letter of new Set(text.match(/\p{L}/gu))) assert.ok(file.people?.[letter] || file.things?.[letter], where + ": " + letter + " isn't listed");
    for (const mark of [...Object.keys(file.people ?? {}), ...Object.keys(file.things ?? {}), ...Object.keys(file.exits ?? {})]) {
      assert.equal(text.split(mark).length - 1, 1, where + ": " + mark + " should be on the plan exactly once");
    }
    assert.equal(text.split("@").length - 1, 1, where + ": where does the captain stand?");
    assert.ok(file.colors.floor && file.colors.walls && file.colors.scenery && file.colors.writing, where);
  }
});

test("in every level in the game, everything can be walked to, and nothing covers anything else", () => {
  for (const level of LEVELS) {
    const game = inLevel(level);
    const view = walkView(game);
    assert.ok(view.here.desc, level.where + " has nothing for the player to read");
    assertNothingOverlaps(view, level.where);
    // This goes by the drawing, because a floor with words painted on it is still floor.
    const floors = new Set(level.file.floor ?? ".");
    const open = new Set();
    level.file.plan.forEach((row, y) => [...row].forEach((ch, x) => {
      if (floors.has(ch) || ch === "+" || ch === "@" || level.file.people?.[ch]) open.add(x + "," + y);
    }));
    const seen = new Set([view.captain.x + "," + view.captain.y]);
    const queue = [view.captain];
    for (let i = 0; i < queue.length; i += 1) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = (queue[i].x + dx) + "," + (queue[i].y + dy);
        if (open.has(key) && !seen.has(key)) {
          seen.add(key);
          queue.push({ x: queue[i].x + dx, y: queue[i].y + dy });
        }
      }
    }
    assert.equal(seen.size, open.size, level.where + ": some of the floor can't be walked to");
    assert.ok(open.size >= 40, level.where + " is too small to walk around");
    for (const one of view.people) assert.equal(walkCommand(structuredClone(game), { action: "go", to: "person:" + one.key }).arrived?.kind, "person", level.where + ": " + one.key);
    for (const one of view.things) assert.equal(walkCommand(structuredClone(game), { action: "go", to: "thing:" + one.id }).arrived?.kind, "thing", level.where + ": " + one.name);
  }
});

test("in every level in the game, a crowd the story brings along fits in without covering anything", () => {
  const crew = ["voss", "marrow", "pell", "tarrow", "halm", "seven", "tobin", "iven"];
  for (const level of LEVELS) {
    const game = at(level.place);
    const posted = Object.values(level.file.people ?? {}).map((one) => one.id);
    // On a deck, the story names one of the rooms drawn on it.
    const room = level.file.areas?.[0] ?? { id: level.id, name: level.file.name };
    const reply = tool(game, "set_scene", { area: room.name, people: crew.filter((one) => !posted.includes(one)) });
    assert.ok(!reply.isError, level.where);
    const view = walkView(game);
    assert.equal(view.here.id, room.id, level.where);
    assertNothingOverlaps(view, level.where + " with a crowd");
    for (const one of view.people) assert.equal(walkCommand(structuredClone(game), { action: "go", to: "person:" + one.key }).arrived?.kind, "person", level.where + ": " + one.key);
  }
});

test("every way out in the game leads where it says, and comes back to the door it left by", () => {
  for (const level of LEVELS) {
    const { place, id, file, where } = level;
    assert.ok(Object.keys(file.exits).length > 0, where + " has no way out");
    for (const [key, exit] of Object.entries(file.exits)) {
      const back = WORLD_MAPS[place].levels[exit.to]?.exits?.[exit.via];
      assert.ok(back, where + ": exit " + key + " goes nowhere");
      assert.equal(back.to, id, where + ": exit " + key + " doesn't lead back");
      assert.equal(back.via, key, where + ": exit " + key + " doesn't come back to the same door");
      assert.ok(!(exit.closed && back.closed), where + ": a door closed from both sides would trap the captain");
      if (exit.closed) assert.ok(exit.closed.look && exit.closed.use.startsWith("I "), where + ": exit " + key);
      const game = inLevel(level);
      const reply = walkCommand(game, { action: "go", to: "exit:" + key });
      if (exit.closed && !game.opened[place]?.includes(exit.to)) {
        assert.equal(reply.arrived.kind, "door", where);
        assert.equal(deckOf(reply.walk), id, where + ": a closed door doesn't let you through");
      } else {
        assert.equal(deckOf(reply.walk), exit.to, where + ": exit " + key);
        const door = reply.walk.exits.find((one) => one.key === exit.via);
        assert.equal(Math.abs(door.x - reply.walk.captain.x) + Math.abs(door.y - reply.walk.captain.y), 1, exit.to + ": you should come out beside the door");
      }
    }
  }
  // The way in never needs the story's help to leave by, wherever the story has put the captain.
  for (const place of PLACE_IDS) {
    const { levels, start } = WORLD_MAPS[place];
    // The way in is a room, which on the ship is drawn on a deck: the levels reached are counted from its deck.
    const reach = new Set([mapFor(place).rooms[start].levelId]);
    for (const id of reach) for (const exit of Object.values(levels[id].exits)) reach.add(exit.to);
    assert.equal(reach.size, Object.keys(levels).length, place + ": some rooms can't be reached at all");
  }
});

test("no two rooms in the game are the same, and each place's rooms all look different from each other", () => {
  assert.equal(new Set(LEVELS.map(({ file }) => file.plan.join("\n"))).size, LEVELS.length, "every drawing is its own");
  for (const place of PLACE_IDS) {
    const all = Object.values(WORLD_MAPS[place].levels);
    assert.equal(new Set(all.map((one) => JSON.stringify(one.colors))).size, all.length, place + ": every room has its own colors");
    // Decks share the ship's hull, so this is for rooms drawn one to a level.
    const levels = all.filter((one) => !one.areas?.length);
    assert.equal(new Set(levels.map((one) => one.plan[0].length + "x" + one.plan.length)).size, levels.length, place + ": every room has its own size");
    // Laid over each other, no two rooms have what's solid in the same places.
    const solid = (one) => new Set(one.plan.flatMap((row, y) => [...row].map((ch, x) => (ch !== " " && !(one.floor ?? ".").includes(ch) ? x + "," + y : null)).filter(Boolean)));
    for (let i = 0; i < levels.length; i += 1) {
      for (let j = i + 1; j < levels.length; j += 1) {
        const [a, b] = [solid(levels[i]), solid(levels[j])];
        const shared = [...a].filter((key) => b.has(key)).length;
        assert.ok(shared / new Set([...a, ...b]).size < 0.7, place + ": " + levels[i].name + " and " + levels[j].name + " have nearly the same shape");
      }
    }
  }
});

test("the game master can use a room's name or anything else it's called, and no two rooms answer to the same one", () => {
  for (const place of PLACE_IDS) {
    const names = new Map();
    const game = at(place);
    for (const [levelId, level] of Object.entries(WORLD_MAPS[place].levels)) {
      // The rooms are the ones drawn on a deck, or the level itself.
      const rooms = level.areas?.length ? level.areas : [{ id: levelId, name: level.name, aliases: level.aliases }];
      for (const room of rooms) {
        for (const name of [room.name, ...(room.aliases ?? [])]) {
          assert.ok(!names.has(plainName(name)) || names.get(plainName(name)) === room.id, place + ": " + name + " could mean " + room.id + " or " + names.get(plainName(name)));
          names.set(plainName(name), room.id);
          setScene(game, name);
          assert.equal(walkView(game).here.id, room.id, place + ": " + name);
          assert.equal(walkView(game).offPlan, false, place + ": " + name);
        }
      }
    }
  }
});

test("every place's map has all of its rooms on it, and clicking one goes there", () => {
  for (const place of PLACE_IDS) {
    const { levels } = WORLD_MAPS[place];
    const { overview } = walkView(at(place));
    // A ship of decks has a plan to a deck; anywhere else has one plan of the whole place.
    const plans = overview.decks ?? [overview];
    const rooms = plans.flatMap((plan) => plan.rooms);
    const expected = Object.entries(levels).flatMap(([id, level]) => (level.areas?.length ? level.areas.map((area) => area.id) : [id]));
    assert.deepEqual(rooms.map((room) => room.id).sort(), expected.sort(), place);
    for (const room of rooms) {
      const plan = plans.find((one) => one.rooms.includes(room));
      assert.ok(Object.values(plan.floors).includes(room.id), place + ": no floor on the map is " + room.id);
      assert.ok(room.x + room.text.length <= plan.cols && room.y < plan.lines, place + ": " + room.text + " runs off the map");
      assert.ok(plan.layers.floor.join("").includes(Object.keys(plan.floors).find((ch) => plan.floors[ch] === room.id)), place + ": " + room.id + "'s floor isn't drawn");
      if (room.closed) {
        assert.throws(() => walkCommand(at(place), { action: "room", to: room.id }), /closed door/, place + ": " + room.id);
        assert.deepEqual(room.people, [], place + ": nobody can see who's behind a closed door");
      } else {
        assert.equal(walkCommand(at(place), { action: "room", to: room.id }).walk.here.id, room.id, place);
      }
    }
  }
});

test("a closed door can be walked up to, but only the story can open it", () => {
  const game = at("foundry");
  const door = walkView(game).exits.find((exit) => exit.closed);
  assert.ok(door.look && door.use.startsWith("I "));
  assert.equal(door.glyph, "x");
  const before1 = structuredClone(game);
  const reply = walkCommand(game, { action: "go", to: "exit:" + door.key });
  assert.deepEqual(reply.arrived, { kind: "door", key: door.key });
  assert.equal(reply.walk.here.id, "gate", "still outside");
  const stood = reply.walk.captain;
  assert.equal(Math.abs(door.x - stood.x) + Math.abs(door.y - stood.y), 1);
  assert.deepEqual({ ...game, walk: null }, { ...before1, walk: null }, "walking up to it changes nothing else");
  // Walking into it with the arrow keys is the same.
  const dx = Math.sign(door.x - stood.x);
  const dy = Math.sign(door.y - stood.y);
  const bump = walkCommand(game, { action: "step", dx, dy });
  assert.deepEqual(bump.arrived, { kind: "door", key: door.key });
  assert.deepEqual(bump.path, []);
  // And nobody gets round it from the map of the place.
  assert.throws(() => walkCommand(game, { action: "room", to: "floor" }), /closed door/);
  assert.throws(() => walkCommand(game, { action: "room", to: "rack" }), /closed door/, "what's behind it is closed too");
  const shut = walkView(game).overview.rooms;
  assert.equal(shut.find((room) => room.id === "floor").closed, true);
  assert.deepEqual(shut.find((room) => room.id === "floor").people, []);
  assert.equal(shut.find((room) => room.id === "gate").closed, false);

  // The story takes the captain through.
  assert.ok(!tool(game, "set_scene", { area: "The Assembly Floor" }).isError);
  assert.equal(walkView(game).here.id, "floor");
  assert.deepEqual(game.opened.foundry, ["floor"]);
  const open = walkView(game).overview.rooms;
  assert.equal(open.find((room) => room.id === "rack").closed, false, "what was behind it is open now");
  assert.equal(open.find((room) => room.id === "sublevels").closed, true, "and the next closed door is still closed");
  // From then on it's free in both directions.
  const out = walkCommand(game, { action: "go", to: "exit:1" });
  assert.equal(out.walk.here.id, "gate");
  assert.equal(out.walk.exits.find((exit) => exit.key === door.key).closed, undefined);
  assert.equal(out.walk.exits.find((exit) => exit.key === door.key).glyph, ">");
  assert.equal(walkCommand(game, { action: "go", to: "exit:" + door.key }).walk.here.id, "floor");
});

test("a door the story has opened stays open after leaving and coming back, and each place keeps its own", () => {
  const game = at("wheel");
  game.ship.fuel = 12;
  assert.equal(walkView(game).overview.rooms.find((room) => room.id === "velvet").closed, true);
  setScene(game, "The Velvet Deck");
  travel(game, "cinder");
  assert.equal(walkView(game).overview.rooms.find((room) => room.id === "stack").closed, true, "a door somewhere else is still closed");
  travel(game, "wheel");
  assert.equal(walkView(game).here.id, "docks", "you arrive at the way in again");
  assert.equal(walkView(game).overview.rooms.find((room) => room.id === "velvet").closed, false);
  assert.deepEqual(JSON.parse(JSON.stringify(game)).opened, { wheel: ["velvet"] }, "it's in the save");
});

test("the Meridian has no closed doors, because it's your ship", () => {
  for (const level of Object.values(WORLD_MAPS.meridian.levels)) for (const exit of Object.values(level.exits)) assert.equal(exit.closed, undefined);
});

test("a talk somewhere else works just the same, with that place's own rumors", () => {
  const game = at("haven");
  setScene(game, "The Neutral Ground");
  assert.equal(walkView(game).here.name, "The Neutral Ground");
  assert.ok(walkView(game).people.some((one) => one.short === "Sable"));
  talkCommand(game, { action: "open", person: "sable" });
  const talk = publicState(game).talk;
  assert.equal(talk.where, "The Neutral Ground");
  talkCommand(game, { action: "rumor" });
  const said = publicState(game).talk.log.at(-1).text;
  assert.ok(LOCATIONS.haven.rumors.some((rumor) => said.includes(rumor.replaceAll('"', "'"))), "it's one of Haven's");
  closeTalk(game);
  assert.match(game.transcript.at(-1).text, /^\[TALK\] You talked with .* at the Neutral Ground\.$/);
});

test("someone who isn't really standing there says so when you come over", () => {
  const game = at("asterion");
  setScene(game, "The Exchange");
  talkCommand(game, { action: "open", person: "echo" });
  assert.match(publicState(game).talk.log[0].text, /^A cord slides home/);
  assert.match(publicState(game).talk.log[0].text, /Echo is already on the line/);
});

test("two places can each have a room of the same name, and each keeps its own", () => {
  const game = newGame();
  game.campaign = "walk-two-back-rooms";
  tool(game, "set_scene", { area: "The Back Room", kind: "cabin" });
  game.location = "haven";
  game.walk = null;
  assert.deepEqual(walkView(game).overview.elsewhere, [], "the Meridian's isn't listed at Haven");
  tool(game, "set_scene", { area: "The Back Room", kind: "hold" });
  assert.equal(walkOf(game).room.kind, "hold");
  assert.equal(findCampaignRoom(game.campaign, "The Back Room", "meridian").kind, "cabin");
  assert.equal(findCampaignRoom(game.campaign, "The Back Room", "haven").kind, "hold");
  assert.deepEqual(walkView(game).overview.elsewhere, [{ name: "The Back Room", here: true }]);
  game.location = "meridian";
  game.walk = null;
  tool(game, "set_scene", { area: "The Back Room" });
  assert.equal(walkOf(game).room.kind, "cabin");
  assert.equal(findCampaignRoom(game.campaign, "The Back Room", "sarn"), null);
});

test("somewhere the story makes up at another place gets a room too, with a way back to where the captain was", () => {
  const game = at("kessara");
  game.campaign = "walk-made-up-at-kessara";
  setScene(game, "The Warrens");
  tool(game, "set_scene", { area: "Rook's Back Office", kind: "cabin", people: ["tannis"] });
  const view = walkView(game);
  assert.equal(view.offPlan, true);
  assert.deepEqual(view.people.map((one) => one.key), ["tannis"]);
  assert.equal(findCampaignRoom(game.campaign, "Rook's Back Office", "kessara").place, "kessara");
  const back = walkCommand(game, { action: "go", to: "exit:0" });
  assert.equal(back.walk.here.id, "warrens");
});

// ---- Walking ------------------------------------------------------------

test("clicking a floor spot walks the shortest way there, one square at a time", () => {
  const game = newGame();
  const from = spot(game);
  const target = { x: from.x + 3, y: from.y - 1 };
  const reply = walkCommand(game, { action: "go", ...target });
  assert.deepEqual(reply.walk.captain, target);
  assert.equal(reply.path.length, 4, "in an open room, the way is exactly as long as it looks");
  let at = from;
  for (const step of reply.path) {
    assert.equal(Math.abs(step.x - at.x) + Math.abs(step.y - at.y), 1, "every step is one square");
    at = step;
  }
});

test("in every level, the way never goes through walls or things, and it really is the shortest", () => {
  const game = newGame();
  for (const id of LEVEL_IDS) {
    const view = enter(game, id);
    const open = new Set(standable(view).map((one) => `${one.x},${one.y}`));
    // Breadth-first over the same level, written separately, to check the answer.
    const distance = (a, b) => {
      const seen = new Set([`${a.x},${a.y}`]);
      let edge = [a];
      for (let steps = 0; edge.length; steps += 1) {
        const next = [];
        for (const here of edge) {
          if (here.x === b.x && here.y === b.y) return steps;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const key = `${here.x + dx},${here.y + dy}`;
            if (!seen.has(key) && open.has(key)) {
              seen.add(key);
              next.push({ x: here.x + dx, y: here.y + dy });
            }
          }
        }
        edge = next;
      }
      return null;
    };
    const cells = [...open].map((key) => key.split(",").map(Number)).map(([x, y]) => ({ x, y }));
    for (let i = 0; i < 12; i += 1) {
      const a = cells[(i * 37) % cells.length];
      const b = cells[(i * 53 + 11) % cells.length];
      standOn(game, a.x, a.y);
      const reply = walkCommand(game, { action: "go", ...b });
      assert.deepEqual(reply.walk.captain, b);
      assert.equal(reply.path.length, distance(a, b), `${id}: ${a.x},${a.y} to ${b.x},${b.y}`);
      for (const step of reply.path) assert.ok(open.has(`${step.x},${step.y}`), `${id}: walked through something at ${step.x},${step.y}`);
    }
  }
});

test("a click on a wall walks to the nearest floor, and a click out in space does nothing", () => {
  const game = newGame();
  const reply = walkCommand(game, { action: "go", x: 42, y: 11 });
  assert.ok(reply.path.length > 0);
  assert.ok(Math.abs(reply.walk.captain.x - 42) + Math.abs(reply.walk.captain.y - 11) <= 3);
  const before1 = spot(game);
  const space = walkCommand(game, { action: "go", x: 0, y: 0 });
  assert.deepEqual(space.path, []);
  assert.deepEqual(spot(game), before1);
  assert.match(space.message, /can't walk/);
});

test("the arrow keys move one square, stop at walls, and walking into someone means talking to them", () => {
  const game = newGame();
  const voss = person(game, "voss");
  standOn(game, voss.x - 1, voss.y);
  const start = spot(game);
  const up = walkCommand(game, { action: "step", dx: -1, dy: 0 });
  assert.deepEqual(up.walk.captain, { x: start.x - 1, y: start.y });
  walkCommand(game, { action: "step", dx: 1, dy: 0 });
  const bump = walkCommand(game, { action: "step", dx: 1, dy: 0 });
  assert.deepEqual(bump.path, []);
  assert.deepEqual(bump.arrived, { kind: "person", key: "voss" });
  assert.deepEqual(spot(game), start, "bumping into someone doesn't move you");
  // A square of the bridge's floor with a wall on its left.
  const { floor, people: crowd } = walkView(game);
  let edge = null;
  for (let y = 0; y < floor.length && !edge; y += 1) {
    for (let x = 1; x < floor[y].length; x += 1) {
      if (floor[y][x] === "." && floor[y][x - 1] === " " && MAP.levels.deck1.roomAt(x, y) === "bridge" && MAP.levels.deck1.layers.walls[y][x - 1] === "#" && !crowd.some((one) => one.x === x && one.y === y)) {
        edge = { x, y };
        break;
      }
    }
  }
  standOn(game, edge.x, edge.y);
  const wall = walkCommand(game, { action: "step", dx: -1, dy: 0 });
  assert.deepEqual(wall.path, []);
  assert.deepEqual(wall.walk.captain, edge);
  // From whichever side of the chair is floor, a step into it is a step up to it.
  const chair = thing(game, "The captain's chair");
  const beside = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => ({ x: chair.x + dx, y: chair.y + dy, dx: -dx, dy: -dy })).find((one) => floor[one.y]?.[one.x] === "." && !crowd.some((person) => person.x === one.x && person.y === one.y));
  standOn(game, beside.x, beside.y);
  assert.equal(walkCommand(game, { action: "step", dx: beside.dx, dy: beside.dy }).arrived.kind, "thing");
});

test("the room says where the player can walk, square by square, the same as the server decides it", () => {
  const game = newGame();
  for (const id of LEVEL_IDS) {
    const view = enter(game, id);
    assert.equal(view.floor.length, view.lines, `${id}: a row of the floor for each line`);
    assert.ok(view.floor.every((row) => row.length === view.cols && /^[. ]*$/.test(row)), `${id}: only floor and not`);
    assert.equal(view.floor[view.captain.y][view.captain.x], ".", `${id}: the player stands on floor`);
    for (const one of view.things) if (!one.part || one.part.mount !== "wall") assert.notEqual(view.floor[one.y]?.[one.x], ".", `${id}: ${one.name} isn't walked through`);
  }
});

test("walking freely: a square at a time it's kept, through a wall or out of reach it isn't, and a way out walked into is taken", () => {
  const game = newGame();
  const view = walkView(game);
  const from = view.captain;
  const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: from.x + dx, y: from.y + dy })).find((one) => view.floor[one.y]?.[one.x] === ".");
  const moved = walkCommand(game, { action: "move", x: next.x, y: next.y });
  assert.deepEqual(moved, { moved: true, captain: next });
  assert.deepEqual(spot(game), next);
  assert.equal(moved.walk, undefined, "only the square comes back");
  // Not into a wall, and not anywhere that can't be walked to from here.
  const wall = { x: 0, y: 0 };
  assert.equal(view.floor[wall.y][wall.x], " ");
  assert.deepEqual(walkCommand(game, { action: "move", ...wall }), { moved: false, captain: next });
  assert.throws(() => walkCommand(game, { action: "move", x: 1.5, y: 2 }), /somewhere to walk/);
  // A few squares on, as a quick walk can be by the time the page says so, is fine if it's the same floor.
  const further = walkCommand(game, { action: "go", x: next.x + 6, y: next.y }).walk.captain;
  standOn(game, next.x, next.y);
  assert.deepEqual(walkCommand(game, { action: "move", ...further }).captain, further);
  // A way out walked into goes through, and the room comes back with it.
  const door = view.exits.find((one) => one.key === "1");
  standOn(game, door.x, door.y - 1);
  const through = walkCommand(game, { action: "move", x: door.x, y: door.y });
  assert.equal(through.arrived.kind, "exit");
  assert.equal(deckOf(through.walk), "deck2");
  assert.equal(walkView(game).here.name, "The Lower Forward Stair");
});

test("walking freely into a door only the story opens stops beside it, the same as clicking it", () => {
  // The Great Wheel's way into the Velvet Deck is the story's to open.
  const game = at("wheel");
  walkCommand(game, { action: "room", to: "great" });
  const closed = { id: walkView(game).here.id, exit: walkView(game).exits.find((one) => one.closed) };
  assert.ok(closed.exit, "the Great Wheel has a door only the story opens");
  const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: closed.exit.x + dx, y: closed.exit.y + dy })).find((one) => walkView(game).floor[one.y]?.[one.x] === ".");
  standOn(game, beside.x, beside.y);
  const bump = walkCommand(game, { action: "move", x: closed.exit.x, y: closed.exit.y });
  assert.deepEqual(bump.arrived, { kind: "door", key: closed.exit.key });
  assert.equal(bump.walk.here.id, closed.id, "still in the same room");
  assert.deepEqual(spot(game), beside);
});

test("clicking someone walks up beside them, and clicking a thing does the same", () => {
  const game = newGame();
  enter(game, "engineering");
  const marrow = person(game, "marrow");
  const reply = walkCommand(game, { action: "go", to: "person:marrow" });
  assert.deepEqual(reply.arrived, { kind: "person", key: "marrow" });
  assert.equal(Math.abs(reply.walk.captain.x - marrow.x) + Math.abs(reply.walk.captain.y - marrow.y), 1);
  const gauges = thing(game, "Reactor gauges");
  const again = walkCommand(game, { action: "go", to: `thing:${gauges.id}` });
  assert.equal(again.arrived.kind, "thing");
  assert.equal(Math.abs(again.walk.captain.x - gauges.x) + Math.abs(again.walk.captain.y - gauges.y), 1);
});

test("a click partway through a walk carries on from wherever the captain has got to", () => {
  const game = newGame();
  const first = walkCommand(game, { action: "go", x: 10, y: 14 });
  const midway = first.path[5];
  const reply = walkCommand(game, { action: "go", x: midway.x, y: midway.y - 1, from: midway });
  assert.equal(reply.path.length, 1);
  // Somewhere that makes no sense is ignored.
  const fine = walkCommand(game, { action: "go", x: 25, y: 14, from: { x: 0, y: 0 } });
  assert.deepEqual(fine.walk.captain, { x: 25, y: 14 });
});

test("every way out leads where it says, and comes back to the door it left by", () => {
  const game = newGame();
  for (const id of LEVEL_IDS) {
    const { exits } = enter(game, id);
    assert.ok(exits.length > 0, `${id} has no way out`);
    for (const exit of exits) {
      enter(game, id);
      const spec = FILE.levels[id].exits[exit.key];
      const out = walkCommand(game, { action: "go", to: `exit:${exit.key}` });
      assert.equal(out.arrived.kind, "exit");
      assert.equal(deckOf(out.walk), spec.to, `${id} exit ${exit.key}`);
      const door = out.walk.exits.find((one) => one.key === spec.via);
      assert.ok(door, `${spec.to} has no exit ${spec.via}`);
      assert.equal(FILE.levels[spec.to].exits[spec.via].to, id, `${spec.to} exit ${spec.via} should lead back to ${id}`);
      assert.equal(FILE.levels[spec.to].exits[spec.via].via, exit.key, `${spec.to} exit ${spec.via} should come out at exit ${exit.key}`);
      assert.equal(Math.abs(door.x - out.walk.captain.x) + Math.abs(door.y - out.walk.captain.y), 1, `${spec.to}: you should come out beside the door`);
      const back = walkCommand(game, { action: "go", to: `exit:${spec.via}` });
      assert.equal(deckOf(back.walk), id);
    }
  }
});

test("walking through a door with the arrow keys works too, and the path is still in the room being left", () => {
  const game = newGame();
  const { exits } = walkView(game);
  const door = exits.find((one) => one.key === "1");
  standOn(game, door.x, door.y - 1);
  const through = walkCommand(game, { action: "step", dx: 0, dy: 1 });
  assert.equal(through.arrived.kind, "exit");
  assert.equal(deckOf(through.walk), "deck2");
  assert.equal(walkView(game).here.name, "The Lower Forward Stair");
});

test("walking changes nothing but where the captain is: not the clock, not the ship, not the AI", () => {
  const game = newGame();
  game.clock.hours = 23;
  game.ship.day = 0;
  const before1 = structuredClone(game);
  for (const id of LEVEL_IDS) {
    const view = enter(game, id);
    for (const exit of view.exits) walkCommand(structuredClone(game), { action: "go", to: `exit:${exit.key}` });
    for (let i = 0; i < 20; i += 1) walkCommand(game, { action: "step", dx: i % 2 ? 1 : -1, dy: 0 });
    walkCommand(game, { action: "go", to: `exit:${view.exits[0].key}` });
  }
  const { walk: _walk, ...rest1 } = game;
  const { walk: _before, ...rest2 } = before1;
  assert.deepEqual(rest1, rest2);
  assert.equal(game.clock.hours, 23);
});

test("showing the game changes nothing in the save", () => {
  const game = newGame();
  const before1 = structuredClone(game);
  publicState(game);
  assert.deepEqual(game, before1);
});

test("nobody who's dead or gone stands at their post", () => {
  const game = newGame();
  game.contacts.find((contact) => contact.name === "Ilya Voss").status = "dead";
  assert.equal(person(game, "voss"), undefined);
  assert.ok(person(game, "pell"));
});

// ---- The game master's tool ---------------------------------------------

test("set_scene moves the captain to a room, by its name or anything else people call it", () => {
  const game = newGame();
  for (const [name, level] of [["The Long Mess", "mess"], ["the mess", "mess"], ["BRIDGE", "bridge"], ["Engineering and the Aft Holds", "engineering"], ["the aft hold", "aft"], ["The Crawlways", "crawlways"], ["medbay", "medbay"], ["The Names Bulkhead", "names"]]) {
    const { result, isError } = tool(game, "set_scene", { area: name });
    assert.ok(!isError, result);
    assert.equal(walkView(game).here.id, level, name);
    assert.equal(walkView(game).offPlan, false);
    assert.deepEqual(spot(game), walkOf(game) && { x: walkOf(game).x, y: walkOf(game).y });
  }
  assert.ok(TOOL_DEFS.some((def) => def.name === "set_scene"));
});

test("set_scene puts who's present beside the captain, and everyone else goes back to their post", () => {
  const game = newGame();
  tool(game, "set_scene", { area: "The Long Mess", people: ["Commander Voss", "marrow"] });
  const voss = person(game, "voss");
  assert.ok(voss, "she's here now");
  assert.ok(person(game, "marrow"), "and so is he");
  assert.equal(voss.short, "Voss", "she goes by the same name wherever she is");
  for (const one of [voss, person(game, "marrow")]) {
    assert.equal(walkView(game).layers.doors[one.y][one.x], " ", `${one.key} is standing in a doorway`);
    for (let i = 0; i < one.short.length + 2; i += 1) assert.notEqual(walkView(game).layers.walls[one.y][one.x + i], "#", `${one.key}'s name runs over a wall`);
  }
  assert.equal(enter(structuredClone(game), "bridge").people.filter((one) => one.key === "voss").length, 0, "she isn't in two places");
  tool(game, "set_scene", { area: "The Long Mess" });
  assert.equal(person(game, "voss"), undefined);
  assert.ok(enter(structuredClone(game), "bridge").people.some((one) => one.key === "voss"), "she's back at her post");
  // They end up clear of anyone else's name, and of the captain, wherever it is.
  for (const id of LEVEL_IDS) {
    const name = FILE.levels[id].name;
    tool(game, "set_scene", { area: name, people: ["voss", "marrow", "pell", "tarrow", "halm", "seven", "tobin", "iven"].filter((one) => !Object.values(FILE.levels[id].people ?? {}).some((home) => home.id === one)) });
    assertNothingOverlaps(walkView(game), name);
  }
});

test("set_scene checks what it's given", () => {
  const game = newGame();
  assert.ok(tool(game, "set_scene", {}).isError);
  assert.ok(tool(game, "set_scene", { area: "" }).isError);
  assert.ok(tool(game, "set_scene", { area: 7 }).isError);
  assert.ok(tool(game, "set_scene", { area: "x".repeat(61) }).isError);
  assert.ok(tool(game, "set_scene", { area: "The Bridge", people: "Voss" }).isError);
  assert.ok(tool(game, "set_scene", { area: "The Bridge", people: ["x".repeat(61)] }).isError);
  assert.ok(tool(game, "set_scene", { area: "Somewhere", kind: "a kind that doesn't exist" }).isError);
  assert.ok(tool(game, "set_scene", { area: "Somewhere", things: [{ name: "No description" }] }).isError);
  const crowd = Array.from({ length: 12 }, (_, i) => `Deckhand ${i}`);
  assert.ok(!tool(game, "set_scene", { area: "A crowded hatchway", people: crowd }).isError);
  assert.equal(walkView(game).people.length, 8);
  // The captain isn't standing next to themselves.
  tool(game, "set_scene", { area: "The Bridge", people: [game.name] });
  assert.ok(!walkView(game).people.some((one) => one.key === game.name));
});

// ---- Rooms that aren't on a plan ----------------------------------------

test("every kind of room can hold eight people with long names, and everything in it can be reached", () => {
  const names = Array.from({ length: 8 }, (_, i) => `Longer Name ${i}xx`.slice(0, 14));
  for (const kind of Object.keys(ROOM_KINDS)) {
    for (const place of ["The Still Room", "The Other Room", "Number Three", "Somewhere Else", "A Fifth Place", "Room Six"]) {
      const game = newGame();
      tool(game, "set_scene", { area: place, people: names, kind });
      const view = walkView(game);
      assert.equal(view.offPlan, true);
      assert.equal(view.people.length, 8, `${kind}: everyone should fit`);
      assertNothingOverlaps(view, `${kind}, ${place}`);
      assert.equal(view.exits.length, 1, `${kind} needs a way out`);
      assert.equal(view.things.length, 4, `${kind} should have things in it`);
      for (const cell of standable(view)) assert.deepEqual(walkCommand(structuredClone(game), { action: "go", ...cell }).walk.captain, cell, `${kind}: can't reach ${cell.x},${cell.y}`);
      for (const one of view.people) assert.equal(walkCommand(structuredClone(game), { action: "go", to: `person:${one.key}` }).arrived?.kind, "person", `${kind}: ${one.key}`);
      for (const one of view.things) assert.equal(walkCommand(structuredClone(game), { action: "go", to: `thing:${one.id}` }).arrived?.kind, "thing", `${kind}: ${one.name}`);
      assert.equal(walkCommand(structuredClone(game), { action: "go", to: `exit:${view.exits[0].key}` }).walk.offPlan, false, `${kind}: the way out should lead back`);
    }
  }
});

test("the kinds of room are all different from each other, and each has its own things", () => {
  const kinds = Object.values(ROOM_KINDS);
  assert.ok(kinds.length >= 12);
  assert.equal(new Set(kinds.map((kind) => kind.layouts[0].plan.join("\n"))).size, kinds.length);
  assert.equal(new Set(kinds.flatMap((kind) => kind.things.map((one) => one.name))).size, kinds.flatMap((kind) => kind.things).length);
  for (const kind of kinds) {
    assert.ok(kind.things.length >= 4);
    for (const one of kind.things) assert.ok(one.name && one.look);
    for (const layout of kind.layouts) assert.equal(new Set(layout.plan.map((row) => row.length)).size, 1, "the rows should line up");
  }
});

test("somewhere that isn't on the plan looks like what it is, never like a wrong map", () => {
  const game = newGame();
  tool(game, "set_scene", { area: "Frame Thirty", people: ["voss"], kind: "ducts" });
  const view = walkView(game);
  assert.equal(view.offPlan, true);
  assert.equal(view.here.name, "Frame Thirty");
  assert.deepEqual(view.people.map((one) => one.key), ["voss"]);
  assert.equal(view.labels[0].text, "FRAME THIRTY");
  assert.ok(view.layers.floor.join("").includes("~"), "ducts have a duct's floor");
  assert.ok(!JSON.stringify(view.things).includes("captain's chair"));
  // Nearly the name of a room on the plan isn't that room.
  tool(game, "set_scene", { area: "The Bridge of the Ember Day" });
  assert.equal(walkView(game).offPlan, true);
  tool(game, "set_scene", { area: "The Bridge" });
  assert.equal(walkView(game).offPlan, false);
});

test("with nothing said about a room, the game goes by its name and what the codex says about it", () => {
  const game = newGame();
  const kindOf = () => walkOf(game).room.kind;
  for (const [name, kind] of [["The Old Brig", "cells"], ["Hangar Two", "hangar"], ["Father Roe's Chapel", "chapel"], ["Her Quarters", "cabin"], ["The Cannon Deck", "gundeck"], ["The Hydroponics Ward", "garden"], ["Somewhere Nobody's Named", "plain"]]) {
    tool(game, "set_scene", { area: name });
    assert.equal(kindOf(), kind, name);
  }
  game.lore.push({ id: "custom:0", name: "The Warren", kind: "place", text: "A block of ductwork and dead space deep in the crawlways." });
  tool(game, "set_scene", { area: "The Warren" });
  assert.equal(kindOf(), "ducts");
  assert.match(walkView(game).here.desc, /ductwork/, "the codex says what it is");
});

test("the things the game master says are in a room are there to look at, and using one goes to the story", () => {
  const game = newGame();
  tool(game, "set_scene", { area: "The Old Galley", kind: "workshop", things: [{ name: "A cracked oven", look: "It hasn't been lit since the Fall." }, { name: "Someone's apron", look: "Folded, with a name sewn into it." }] });
  const view = walkView(game);
  const oven = view.things.find((one) => one.name === "A cracked oven");
  assert.equal(oven.look, "It hasn't been lit since the Fall.");
  assert.match(oven.use, /^I go over to A cracked oven/);
  assert.equal(view.things.length, 4, "the room's usual things fill in the rest");
  assert.equal(walkCommand(game, { action: "go", to: `thing:${oven.id}` }).arrived.kind, "thing");
  const tooMany = Array.from({ length: 9 }, (_, i) => ({ name: `Thing ${i}`, look: "It's there." }));
  tool(game, "set_scene", { area: "A Busy Room", things: tooMany });
  assert.equal(walkOf(game).room.things.length, 4);
});

test("a room stays the way it was first described, for good, and can be gone back to from the deck plan", () => {
  const game = newGame();
  game.campaign = "walk-rooms-for-good";
  tool(game, "set_scene", { area: "The Old Galley", kind: "workshop", people: ["voss"], things: [{ name: "A cracked oven", look: "It hasn't been lit since the Fall." }] });
  const saved = findCampaignRoom(game.campaign, "the old galley");
  assert.equal(saved.kind, "workshop");
  assert.equal(saved.place, "meridian");
  assert.deepEqual(saved.regulars, ["voss"]);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "campaigns", "walk-rooms-for-good", "rooms", "old-galley.json"), "utf8"));
  assert.equal(onDisk.things[0].name, "A cracked oven");

  walkCommand(game, { action: "go", to: "exit:0" });
  assert.equal(walkView(game).offPlan, false);
  const elsewhere = walkView(game).overview.elsewhere;
  assert.deepEqual(elsewhere, [{ name: "The Old Galley", here: false }]);
  const back = walkCommand(game, { action: "room", to: "elsewhere:The Old Galley" }).walk;
  assert.equal(back.offPlan, true);
  assert.equal(back.here.name, "The Old Galley");
  assert.ok(back.things.some((one) => one.name === "A cracked oven"));
  assert.deepEqual(back.people.map((one) => one.key), ["voss"]);

  // Coming back in the story, with nothing more said, it's the same room.
  walkCommand(game, { action: "go", to: "exit:0" });
  tool(game, "set_scene", { area: "the old galley" });
  assert.equal(walkOf(game).room.kind, "workshop");
  assert.ok(walkView(game).things.some((one) => one.name === "A cracked oven"));
  assert.deepEqual(walkView(game).people.map((one) => one.key), ["voss"], "whoever's usually there");
});

test("a campaign's room file can have its own drawing, with people and things where they belong", () => {
  const game = newGame();
  game.campaign = "walk-own-drawing";
  saveCampaignRoom(game.campaign, {
    name: "The Long Gallery",
    place: "meridian",
    kind: "ducts",
    desc: "A dead-space gallery between two frames.",
    floor: ".",
    colors: { floor: "#123456" },
    label: [2, 1],
    exitTo: "crawlways",
    exitLabel: "The Cold Elbow",
    regulars: ["voss", "the children"],
    spots: { "the children": "2", voss: "1" },
    plan: [
      "##############################",
      "#............................#",
      "0.........................b..#",
      "#..@..1.......................#".slice(0, 30),
      "#............................#",
      "#.....2..................a...#",
      "##############################",
    ],
    writing: [[12, 0, "NOBODY GETS LEFT"]],
    things: [{ spot: "a", name: "The painted laws", look: "Careful letters.", use: "I read the laws." }],
  });
  tool(game, "set_scene", { area: "The Long Gallery" });
  const view = walkView(game);
  assert.equal(view.here.desc, "A dead-space gallery between two frames.");
  assert.equal(view.colors.floor, "#123456");
  assert.deepEqual(view.captain, { x: 3, y: 3 });
  assert.deepEqual(person(game, "voss") && [person(game, "voss").x, person(game, "voss").y], [6, 3], "she has her own spot");
  assert.deepEqual([person(game, "the children").x, person(game, "the children").y], [6, 5]);
  assert.deepEqual(view.things.map((one) => one.name), ["The painted laws"], "only what's in its file");
  assert.equal(view.things[0].use, "I read the laws.");
  assert.equal(view.exits[0].label, "The Cold Elbow");
  assert.equal(view.layers.writing[0].slice(12, 28), "NOBODY GETS LEFT");
  assertNothingOverlaps(view, "The Long Gallery");
  assert.equal(walkCommand(game, { action: "go", to: "exit:0" }).walk.here.id, "crawlways", "its way out goes where the file says");
});

test("the captain can walk around a room like that, and get back out by clicking", () => {
  const game = newGame();
  const before1 = spot(game);
  tool(game, "set_scene", { area: "Frame Thirty", people: ["voss", "Someone without a file"], kind: "plain" });
  const open = standable(walkView(game));
  const reply = walkCommand(game, { action: "go", ...open[10] });
  assert.deepEqual(reply.walk.captain, open[10]);
  const talkTo = walkCommand(game, { action: "go", to: "person:Someone without a file" });
  assert.equal(talkTo.arrived.key, "Someone without a file");
  const back = walkCommand(game, { action: "go", to: "exit:0" });
  assert.equal(back.walk.offPlan, false);
  assert.deepEqual(back.walk.captain, before1, "back where they were");
  assert.equal(walkView(game).here.name, "The Bridge");
});

test("walking about a room keeps the player in it, and the story can put them somewhere off the map", () => {
  const game = newGame();
  assert.equal(walkView(game).here.name, "The Bridge");
  walkCommand(game, { action: "go", x: 10, y: 14 });
  assert.equal(walkView(game).here.name, "The Bridge", "walking around the same room keeps the room");
  walkCommand(game, { action: "go", to: "room:names" });
  assert.equal(walkView(game).here.name, "The Names Bulkhead");
  tool(game, "set_scene", { area: "Section Fourteen", people: ["voss"] });
  assert.equal(walkView(game).here.name, "Section Fourteen");
  withUnmappedPlace(() => {
    game.location = "nowhere";
    assert.match(setScene(game, "The Soup Line"), /no map/);
  });
});

test("leaving and coming back starts from the way in, even from somewhere off the plan", () => {
  const game = newGame();
  tool(game, "set_scene", { area: "Section Fourteen" });
  const first = travel(game, "sundial");
  assert.ok(first.message);
  assert.equal(walkView(game).here.id, "furrow", "wherever they go, they arrive at its way in");
  travel(game, "meridian");
  const view = walkView(game);
  assert.equal(view.offPlan, false);
  assert.equal(view.here.id, "bridge");
});

// ---- The player's own campaign: somewhere an older game's story invented ----

function sectionFourteen(campaign = "walk-test-campaign") {
  const game = newGame(40);
  game.campaign = campaign;
  for (const [name, role, archetype] of [["Dot Harrow", "Doctor of the Downstairs Crew, age ten", "civilian"], ["Tobiah Wren", "Chief engineer of the Downstairs Crew, age nine", "engineer"]]) {
    saveCampaignCharacter(game.campaign, { name, pronouns: "they/them", role, public: role, personality: "Serious.", voice: "Exact.", archetype, threat: 1 });
  }
  game.contacts.push({ id: "dot-harrow", name: "Dot Harrow", attitude: "wary", note: "Held the line." });
  game.lore.push({ id: "custom:0", name: "Section Fourteen", kind: "place", text: "A block of ductwork and dead space deep in the Meridian's crawlways." });
  game.transcript = [
    { role: "narrator", text: 'You climb down from the bridge.\n\n@Naomi Cass: "Mind your head."' },
    { role: "narrator", text: '@Dot Harrow: "I\'m handling it."\n\n@Tobiah Wren: "Knocking is for doors."\n\nThe children laugh, and it\'s the first sound in Section Fourteen that doesn\'t sound frightened.\n\n> Sign the treaty\n> Go up to the bridge meeting' },
  ];
  return game;
}

test("Section Fourteen, with its children who aren't in any file of the world, gets a room of its own", () => {
  const game = sectionFourteen();
  const reply = tool(game, "set_scene", { area: "Section Fourteen", people: ["Dot Harrow", "Tobiah", "Naomi Cass", "the children"] });
  assert.ok(!reply.isError, reply.result);
  const view = walkView(game);
  assert.equal(view.offPlan, true);
  assert.equal(view.here.name, "Section Fourteen");
  assert.equal(walkOf(game).room.kind, "ducts", "the codex says it's ductwork");
  assert.deepEqual(view.people.map((one) => one.short), ["Dot Harrow", "Tobiah Wren", "Naomi Cass", "the children"]);
  assertNothingOverlaps(view, "Section Fourteen");
  assert.doesNotThrow(() => publicState(game));
});

test("someone from Section Fourteen can be talked to, with their own art and how they feel", () => {
  const game = sectionFourteen();
  tool(game, "set_scene", { area: "Section Fourteen", people: ["Dot Harrow", "Tobiah Wren", "the children"] });
  talkCommand(game, { action: "open", person: "dot-harrow" });
  const dot = publicState(game).talk;
  assert.equal(dot.name, "Dot Harrow");
  assert.equal(dot.attitude, "wary");
  assert.equal(dot.where, "Section Fourteen");
  assert.ok(dot.art.join("\n").includes("|oo)"));
  closeTalk(game);
  talkCommand(game, { action: "open", person: "tobiah-wren" });
  assert.equal(publicState(game).talk.attitude, null, "no contact yet means they haven't met");
  assert.ok(publicState(game).talk.art.join("\n").includes("[|oo)"), "Tobiah's an engineer, and looks like one");
  closeTalk(game);
  // Nobody with a file is still somebody you can talk to.
  talkCommand(game, { action: "open", person: "the children" });
  const crowd = publicState(game).talk;
  assert.equal(crowd.name, "the children");
  assert.equal(crowd.role, null);
  assert.ok(crowd.art.length > 0);
});

// ---- Talking ------------------------------------------------------------

test("opening and closing a talk costs nothing, and a talk where nothing was said leaves no note", () => {
  const game = newGame();
  const lines = game.transcript.length;
  talkCommand(game, { action: "open", person: "voss" });
  const view = publicState(game).talk;
  assert.equal(view.name, "Commander Ilya Voss");
  assert.equal(view.where, "The Bridge");
  assert.equal(view.log[0].role, "aside");
  assert.throws(() => talkCommand(game, { action: "open", person: "pell" }), /Finish the talk/);
  talkCommand(game, { action: "close" });
  assert.equal(game.talk, null);
  assert.equal(game.transcript.length, lines);
  assert.equal(publicState(game).talk, null);
});

test("you can't talk to someone who isn't here, or before the story has started", () => {
  const game = newGame();
  assert.throws(() => talkCommand(game, { action: "open", person: "Someone Else" }), /aren't here/);
  assert.throws(() => talkCommand(game, { action: "open", person: "marrow" }), /aren't here/, "he's in Engineering");
  tool(game, "set_scene", { area: "Frame Thirty", people: ["marrow"] });
  assert.throws(() => talkCommand(game, { action: "open", person: "voss" }), /aren't here/);
  const fresh = createGameFromDraft(randomDraft({ seed: 4, archetype: "officer" }));
  assert.throws(() => talkCommand(fresh, { action: "open", person: "voss" }), /Start the story/);
});

test("rumors come from the place's file, and nobody gossips about themselves", () => {
  const game = newGame();
  const all = LOCATIONS.meridian.rumors;
  for (const name of ["Voss", "Marrow", "Pell"]) {
    const told = rumorsFrom(game, name.toLowerCase(), [name]);
    assert.ok(told.length > 0);
    for (const rumor of told) {
      assert.ok(all.includes(rumor));
      assert.ok(!rumor.includes(name), `${name} shouldn't be saying: ${rumor}`);
    }
  }
  talkCommand(game, { action: "open", person: "voss" });
  const count = publicState(game).talk.rumors;
  assert.ok(count > 0);
  talkCommand(game, { action: "rumor" });
  const view = publicState(game).talk;
  assert.equal(view.rumors, count - 1);
  assert.equal(view.log.at(-1).role, "narrator");
  assert.match(view.log.at(-1).text, /^@Commander Ilya Voss: "/);
  assert.equal(view.lastReply, null, "a rumor offers no choices of its own");
  while (publicState(game).talk.rumors > 0) talkCommand(game, { action: "rumor" });
  assert.throws(() => talkCommand(game, { action: "rumor" }), /all they've heard/);
});

test("closing a talk leaves one line in the story, and what was said is kept with it", () => {
  const game = newGame();
  talkCommand(game, { action: "open", person: "voss" });
  talkSaid(game, "How are you holding up?");
  talkHeard(game, '@Commander Ilya Voss: "Nine minutes, Captain." She doesn\'t look up.\n\n> Ask what happens in nine minutes\n> Let it go');
  talkHeard(game, "[RELATION] Ilya Voss: neutral -> wary", "notice");
  closeTalk(game);
  const note = game.transcript.at(-1);
  assert.equal(note.role, "notice");
  assert.ok(!note.text.includes("\n"), "it's one line");
  assert.match(note.text, /^\[TALK\] You talked with Commander Ilya Voss at the Bridge\. Last word: "Nine minutes, Captain\."$/);
  assert.deepEqual(note.talk.map((line) => line.role), ["player", "narrator"]);
  assert.ok(!note.talk[1].text.includes(">"), "the choices don't need keeping");
  // A rumor passed along isn't anybody's last word.
  talkCommand(game, { action: "open", person: "pell" });
  talkCommand(game, { action: "rumor" });
  closeTalk(game);
  assert.match(game.transcript.at(-1).text, /^\[TALK\] You talked with Ensign Pell Asante at the Bridge\.$/);
});

test("a choice with a check on it, offered in a talk, opens the check's window and ends the talk", () => {
  const game = newGame();
  talkCommand(game, { action: "open", person: "voss" });
  talkSaid(game, "Tell me about the Tarn.");
  talkHeard(game, '@Commander Ilya Voss: "No."\n\n> [persuasion:hard:voss] Press her on it\n> Let it go');
  assert.throws(() => talkCommand(game, { action: "check", label: "Something she never offered" }), /on offer/);
  assert.equal(game.check, null);
  talkCommand(game, { action: "check", label: "Press her on it" });
  assert.equal(game.talk, null);
  assert.equal(game.check.skill, "persuasion");
  assert.equal(game.check.source, "choice");
  assert.equal(game.check.audience, "voss");
  const hours = game.clock.hours;
  checkCommand(game, "run");
  assert.equal(game.clock.hours, hours);
  assert.equal(game.lastCheck.source, "choice");
});

test("a fight or a check that starts during a talk takes over from it", () => {
  const game = newGame();
  talkCommand(game, { action: "open", person: "voss" });
  talkSaid(game, "Stand down, Commander.");
  tool(game, "start_combat", { enemy: "dock_thug", lead_in: "It goes badly." });
  talkLineOver(game);
  assert.equal(game.talk, null);
  assert.ok(game.combat);
});

test("something the captain is already carrying can't be used again, and everything else can", () => {
  const game = newGame();
  enter(game, "mess");
  assert.equal(thing(game, "Ration crate").have, false);
  game.inventory.ration_pack = 1;
  assert.equal(thing(game, "Ration crate").have, true);
  assert.equal(thing(game, "Soup kettle").have, false);
});

test("a conversation can't move the clock or the player, whatever its file says", () => {
  const game = newGame();
  const talking = { ...newTurnLimits(), talking: true };
  for (const [name, input] of [["pass_time", { hours: 30, activity: "active", reason: "A long talk" }], ["travel", { destination: "haven" }], ["set_scene", { area: "The Long Mess" }]]) {
    const refused = runTool(game, name, input, talking);
    assert.equal(refused.isError, true, name);
    assert.match(refused.result, /clock is stopped in a talk window/);
  }
  assert.equal(game.location, "meridian");
  assert.equal(runTool(game, "change_stress", { amount: -4, reason: "Weak tea" }, talking).isError, undefined, "anything else a scene can do still works");
});

test("the Ship menu and sleep can't move the clock during a talk", () => {
  // The server refuses these. This says why: both of them really would use up time.
  const game = newGame();
  const hours = game.clock.hours;
  shipCommand(game, { action: "wait", days: 1 });
  assert.ok(game.clock.hours > hours);
  rest(game);
  assert.ok(shipLedger(game));
});

// ---- Old saves ----------------------------------------------------------

const oldSave = (game = newGame(), version = 7) => {
  const save = JSON.parse(JSON.stringify({ ...game, version }));
  if (version < 8) {
    delete save.walk;
    delete save.talk;
  }
  if (version < 10) delete save.opened;
  return save;
};

test("a save from before there was any map loads, with the captain in a room", () => {
  const game = migrateGame(oldSave());
  assert.equal(game.version, 28);
  assert.equal(game.talk, null);
  assert.equal(game.walk.place, "meridian");
  assert.equal(walkView(game).here.id, "bridge");
  assert.doesNotThrow(() => publicState(game));
});

test("loading a save twice changes nothing the second time", () => {
  const once = migrateGame(oldSave());
  const twice = migrateGame(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
});

test("the captain starts wherever the latest scene says they are", () => {
  const onPlan = newGame();
  onPlan.transcript = [{ role: "narrator", text: 'You push through to the Long Mess. @Odessa Brandt: "Ask in writing."\n\n@Odessa Brandt: "I mean it."' }];
  const game = migrateGame(oldSave(onPlan));
  assert.equal(walkView(game).here.id, "mess");
  assert.equal(walkView(game).offPlan, false);
  assert.ok(person(game, "odessa"), "she's on her level");
  const aft = newGame();
  aft.transcript = [{ role: "narrator", text: "Marrow takes you past engineering, down to the aft hold." }];
  assert.equal(walkView(migrateGame(oldSave(aft))).here.id, "aft");
});

test("a save in the middle of Section Fourteen opens there, with the people from the scene, and not on a wrong map", () => {
  const game = migrateGame(oldSave(sectionFourteen("walk-test-from-story")));
  const view = walkView(game);
  assert.equal(view.offPlan, true);
  assert.equal(view.here.name, "Section Fourteen");
  assert.equal(walkOf(game).room.kind, "ducts");
  assert.deepEqual(view.people.map((one) => one.short).sort(), ["Dot Harrow", "Naomi Cass", "Tobiah Wren"]);
  // The story's choices are still on offer, and walking back out is one click.
  const back = walkCommand(game, { action: "go", to: "exit:0" });
  assert.equal(back.walk.offPlan, false);
});

test("a save from when the ship was one plan keeps the captain in the same room", () => {
  for (const [x, y, level] of [[17, 9, "bridge"], [40, 5, "mess"], [40, 10, "names"], [28, 14, "medbay"], [60, 5, "engineering"], [60, 15, "aft"], [50, 12, "crawlways"], [0, 0, "bridge"]]) {
    const old = oldSave(newGame(), 8);
    old.walk = { place: "meridian", x, y, walked: false, with: [{ id: "voss", name: "Ilya Voss", x: 41, y: 5 }], room: null };
    const game = migrateGame(old);
    assert.equal(game.version, 28);
    assert.equal(roomHere(game).id, level, `${x},${y}`);
    assert.deepEqual(walkOf(game).with, [], "everyone's back at their posts");
    assert.equal(walkView(game).offPlan, false);
    assert.doesNotThrow(() => publicState(game));
  }
});

test("a save from when Section Fourteen was a plain room comes back to it, drawn properly", () => {
  const base = sectionFourteen("walk-test-plain-room");
  const old = oldSave(base, 8);
  old.walk = { place: "meridian", x: 17, y: 9, walked: false, with: [], room: { name: "Section Fourteen", x: 24, y: 7, people: [{ id: "dot-harrow", name: "Dot Harrow" }, { id: null, name: "the children" }] } };
  const game = migrateGame(old);
  const view = walkView(game);
  assert.equal(view.offPlan, true);
  assert.equal(walkOf(game).room.kind, "ducts");
  assert.deepEqual(view.people.map((one) => one.key), ["dot-harrow", "the children"]);
  assert.ok(standable(view).some((cell) => cell.x === view.captain.x && cell.y === view.captain.y), "the captain's somewhere they can stand");
  assert.equal(walkOf(game).level, "deck1");
  assert.equal(walkOf(game).room.from, "bridge", "and the way back leads to the bridge");
});

test("a save somewhere else opens wherever its latest scene says, from any older version", () => {
  for (const version of [7, 8, 9]) {
    const away = newGame();
    away.location = "haven";
    away.transcript = [{ role: "narrator", text: 'You push through the door of the Neutral Ground.\n\n@Jun Sable: "Weapons in the rack."' }];
    const game = migrateGame(oldSave(away, version));
    assert.equal(game.version, 28);
    assert.equal(walkView(game).here.id, "bar", `from version ${version}`);
    assert.ok(person(game, "sable"), "whoever's in the scene is there");
    assert.doesNotThrow(() => publicState(game));
    assert.equal(walkFromStory(game).level, "bar");
  }
  // With nothing to go on, the captain's at the way in.
  const plain = newGame();
  plain.location = "sarn";
  plain.transcript = [{ role: "narrator", text: "Nothing in particular happens." }];
  assert.equal(walkView(migrateGame(oldSave(plain, 9))).here.id, "deposit");
  // A scene that's already behind a closed door has opened it.
  const inside = newGame();
  inside.location = "wheel";
  inside.transcript = [{ role: "narrator", text: "She receives you on the Velvet Deck, without getting up." }];
  const game = migrateGame(oldSave(inside, 9));
  assert.equal(walkView(game).here.id, "velvet");
  assert.deepEqual(game.opened.wheel, ["velvet"]);
});

test("a save that's already got a place keeps it, and gains an empty list of opened doors", () => {
  const game = newGame();
  walkCommand(game, { action: "go", to: "room:names" });
  const loaded = migrateGame(oldSave(game, 9));
  assert.equal(walkView(loaded).here.id, "names");
  assert.deepEqual(loaded.opened, {});
  assert.deepEqual(migrateGame(JSON.parse(JSON.stringify(loaded))), loaded);
});

test("a save from any older version gets here too", () => {
  const save = oldSave();
  save.version = 6;
  delete save.fleet;
  const game = migrateGame(save);
  assert.equal(game.version, 28);
  assert.ok(game.ship.day !== undefined && game.ship.aboard > 0, "the ship's own numbers are there");
  assert.doesNotThrow(() => publicState(game));
  assert.equal(newGame().version, 28);
});

test("a save made while talking carries on talking", () => {
  const game = newGame();
  talkCommand(game, { action: "open", person: "voss" });
  talkSaid(game, "Report.");
  const loaded = migrateGame(JSON.parse(JSON.stringify(game)));
  assert.equal(publicState(loaded).talk.name, "Commander Ilya Voss");
  assert.equal(publicState(loaded).talk.log.at(-1).text, "Report.");
});

// ---- The real server, over its real routes --------------------------------

const serverData = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-walk-server-"));
let child;
let port;

async function post(route, body = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  // A line in a talk streams its reply a line at a time.
  if (res.headers.get("content-type")?.includes("ndjson")) return { status: res.status, lines: text.split("\n").filter(Boolean).map((line) => JSON.parse(line)) };
  return { status: res.status, ...JSON.parse(text) };
}

before(async () => {
  fs.mkdirSync(path.join(serverData, "saves"), { recursive: true });
  const save = oldSave();
  fs.writeFileSync(path.join(serverData, "saves", "autosave.json"), JSON.stringify(save));
  // A port nobody's using: this asks the system for one, and lets it go again.
  port = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  child = spawn(process.execPath, ["server.js"], { cwd: projectDir, env: { ...process.env, GAME_DATA_DIR: serverData, PORT: String(port) }, stdio: "pipe" });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) resolve(); });
    child.on("exit", () => reject(new Error("The server stopped.")));
  });
});

after(() => {
  child?.removeAllListeners("exit");
  child?.kill();
  try {
    fs.rmSync(serverData, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // It's a temporary folder, so it doesn't matter if something is still holding on to it.
  }
});

test("over the real server: walking, talking and closing never move the clock, and the save keeps up", async () => {
  const start = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  const hours = start.game.clock.hours;
  assert.equal(start.game.walk.here.id, "bridge");

  const walked = await post("/api/walk", { action: "go", to: "room:names" });
  assert.equal(walked.status, 200);
  assert.equal(walked.walk.here.id, "names");
  assert.ok(walked.path.length > 0);
  assert.equal(walked.game, undefined, "walking gets a small reply, not the whole game");

  const toRoe = await post("/api/walk", { action: "go", to: "person:bastian" });
  assert.deepEqual(toRoe.arrived, { kind: "person", key: "bastian" });

  const opened = await post("/api/talk", { action: "open", person: "bastian" });
  assert.equal(opened.game.talk.short, "Roe");

  // While a talk is open, anything that could move the clock waits.
  for (const [route, body] of [["/api/ship", { action: "wait", days: 1 }], ["/api/ship", { action: "course", id: "haven" }], ["/api/action", { action: "rest" }], ["/api/sim", { enemy: "dock_thug" }], ["/api/walk", { action: "go", x: 50, y: 2 }], ["/api/check/start", { practice: "persuasion" }]]) {
    const refused = await post(route, body);
    assert.equal(refused.status, 400, route);
    assert.match(refused.error, /talk first/);
  }

  // He speaks first, from his written lines, and what's said is one of them.
  assert.match(opened.game.talk.lastReply, /Sit down, sit down/);
  const line = await post("/api/talk", { action: "say", text: "Ask how the services are going" });
  assert.equal(line.status, 200);
  const done = line.lines.at(-1);
  assert.equal(done.type, "done");
  assert.equal(done.state.clock.hours, hours);
  assert.match(done.state.talk.lastReply, /Every tenth day/);
  assert.ok(line.lines.some((entry) => entry.type === "text"));
  assert.ok(!done.state.transcript.some((entry) => entry.text?.includes("Every tenth day")), "what's said stays in its window");

  const rumor = await post("/api/talk", { action: "rumor" });
  assert.equal(rumor.game.talk.log.at(-1).role, "narrator");
  assert.ok(rumor.game.clock.hours === hours);


  const closed = await post("/api/talk", { action: "close" });
  assert.equal(closed.game.talk, null);
  assert.equal(closed.game.clock.hours, hours);
  const note = closed.game.transcript.at(-1);
  assert.match(note.text, /^\[TALK\] You talked with Father Bastian Roe at the Names Bulkhead/);
  const notes = closed.game.transcript.filter((entry) => entry.text.startsWith("[TALK]"));
  assert.equal(notes.length, 1);

  const onDisk = JSON.parse(fs.readFileSync(path.join(serverData, "saves", "autosave.json"), "utf8"));
  assert.equal(onDisk.version, 28);
  assert.equal(onDisk.talk, null);
  assert.equal(onDisk.clock.hours, hours);
});

test("over the real server: words that aren't one of their lines put everything back, including what was said", async () => {
  await post("/api/talk", { action: "open", person: "bastian" });
  const before1 = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  const line = await post("/api/talk", { action: "say", text: "This won't get through." });
  const failed = line.lines.at(-1);
  assert.equal(failed.type, "error");
  assert.match(failed.message, /isn't one of the things to say here/);
  assert.deepEqual(failed.state.talk.log, before1.game.talk.log);
  assert.equal(failed.state.clock.hours, before1.game.clock.hours);
  await post("/api/talk", { action: "close" });
});

test("over the real server: typing words the story has no answer for changes nothing, and closes any talk that's open", async () => {
  await post("/api/talk", { action: "open", person: "bastian" });
  const before1 = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  const turn = await post("/api/chat", { text: "I head back to the bridge." });
  const failed = turn.lines.at(-1);
  assert.equal(failed.type, "error");
  assert.match(failed.message, /no more written story here/);
  assert.equal(failed.state.talk, null);
  assert.equal(failed.state.transcript.length, before1.game.transcript.length, "nothing was said, so the story has nothing new");
});

test("over the real server: during a fight or a check, nobody walks or talks", async () => {
  const practice = await post("/api/check/start", { practice: "persuasion" });
  assert.equal(practice.status, 200);
  assert.match((await post("/api/walk", { action: "go", x: 41, y: 2 })).error, /check first/);
  assert.match((await post("/api/talk", { action: "open", person: "bastian" })).error, /check first/);
  await post("/api/check", { command: "run" });
  const sim = await post("/api/sim", { enemy: "dock_thug" });
  assert.equal(sim.status, 200);
  assert.match((await post("/api/walk", { action: "go", x: 41, y: 2 })).error, /fight first/);
  assert.match((await post("/api/talk", { action: "open", person: "bastian" })).error, /fight first/);
});
