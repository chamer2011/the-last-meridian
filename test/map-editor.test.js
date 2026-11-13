// The map editor's side of the game (src/map-editor.js): a deck taken apart into squares and what stands on them, a
// change tried out against the rest of the game, and the deck's file written so that the game reads back exactly what
// was drawn. Everything here works on copies of the maps and of the life files, never on the game's own.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-map-editor-"));
const world = new URL("../world/", import.meta.url);
const stock = { maps: fs.realpathSync(new URL("maps", world)), life: fs.realpathSync(new URL("life", world)) };
fs.cpSync(stock.maps, path.join(tmp, "maps"), { recursive: true });
fs.cpSync(stock.life, path.join(tmp, "life"), { recursive: true });
process.env.GAME_DATA_DIR = path.join(tmp, "data");
process.env.GAME_MAPS_DIR = path.join(tmp, "maps");
process.env.GAME_LIFE_DIR = path.join(tmp, "life");

const editor = await import("../src/map-editor.js");
const { readMapFile, roomFromMap } = await import("../src/tiled.js");
const { WORLD_LIFE } = await import("../src/world.js");

const deckFile = (deck) => path.join(tmp, "maps", "meridian", `${deck}.tmj`);
const fresh = (deck) => fs.copyFileSync(path.join(stock.maps, "meridian", `${deck}.tmj`), deckFile(deck));
const open = (deck) => editor.deckForEditing("meridian", deck);
// What the editor sends back for a deck: the squares, and everything on them.
const parcel = (doc) => ({ grid: doc.grid, people: doc.people, things: doc.things, exits: doc.exits, start: doc.start, writing: doc.writing, labels: doc.labels, areas: doc.areas, spots: doc.spots });
const painted = (doc, squares) => {
  const rows = doc.grid.map((row) => [...row]);
  for (const [x, y, mark] of squares) rows[y][x] = mark;
  return { ...doc, grid: rows.map((row) => row.join("")) };
};
const shown = (doc) => {
  const { problems: _problems, ...rest } = doc;
  return rest;
};

test("the ship's decks are there to change, and a deck comes apart into its squares and what stands on them", () => {
  assert.deepEqual(editor.editableMaps(), [{ place: "meridian", decks: [{ id: "deck1", name: "Deck 1: Command" }, { id: "deck2", name: "Deck 2: The Civilian Deck" }, { id: "deck3", name: "Deck 3: Engineering" }] }]);
  const doc = open("deck1");
  assert.equal(doc.width, 143);
  assert.equal(doc.grid.length, 32);
  assert.ok(doc.grid.every((row) => [...row].length === 143));
  // Nobody's letter is left on the squares: who stands where comes beside them, and what's under someone is floor.
  for (const one of [...doc.people, ...doc.things, ...doc.exits]) assert.notEqual(doc.grid[one.y][one.x], one.mark, `${one.name ?? one.label} isn't painted on the deck`);
  for (const person of doc.people) assert.equal(doc.grid[person.y][person.x], doc.floor);
  assert.ok(doc.people.some((one) => one.name === "Ilya Voss"));
  assert.ok(doc.things.every((one) => one.name && /^[a-z]$/.test(one.mark)));
  assert.ok(doc.areas.some((area) => area.id === "bridge" && area.name === "The Bridge"));
  assert.ok(doc.spots.length > 10 && doc.spots.every((spot) => Number.isInteger(spot.x) && Number.isInteger(spot.y)));
  assert.ok(doc.start && doc.labels.length && doc.writing.length);
  // The paints never use a mark that's floor on the deck: on the engineering deck a bench's usual mark is the floor.
  for (const deck of ["deck1", "deck2", "deck3"]) {
    const { paints, floors } = open(deck);
    assert.equal(paints[0].mark, floors[0]);
    for (const paint of paints.filter((one) => !one.id.startsWith("floor") && one.id !== "space")) assert.ok(![...paint.mark].some((ch) => floors.includes(ch)), `${deck}: ${paint.name} is painted with a floor mark`);
  }
  assert.throws(() => open("deck9"), /no deck like that/);
  assert.throws(() => editor.deckForEditing("../maps", "deck1"), /no deck like that/);
});

test("a deck handed back as it came has nothing wrong with it, and kept, it's the same deck", () => {
  for (const deck of ["deck1", "deck2", "deck3"]) {
    const doc = open(deck);
    assert.deepEqual(editor.tryDeck("meridian", deck, parcel(doc), { whole: false }), { kept: false, problems: [], elsewhere: [], notes: [] }, deck);
  }
  // Tried against the whole game, and kept: the file is written anew, and reads back as the deck it was.
  const before = open("deck3");
  const was = fs.readFileSync(deckFile("deck3"), "utf8");
  const kept = editor.tryDeck("meridian", "deck3", parcel(before), { keep: true });
  assert.equal(kept.kept, true);
  assert.deepEqual([kept.problems, kept.elsewhere, kept.notes], [[], [], []]);
  assert.deepEqual(shown(open("deck3")), shown(before));
  assert.equal(fs.readFileSync(kept.backup, "utf8"), was, "the file that was there is kept beside it");
  // The engineering deck has marks of its own on it, which come through untouched.
  assert.ok(before.grid.some((row) => row.includes("0")) && before.grid.some((row) => row.includes("~")));
});

test("a redrawn deck is kept: walls, a door, furniture, a new room, a new thing and someone's post moved", () => {
  const doc = open("deck1");
  const floor = doc.floor;
  // A little room in the Wardroom, walls all round, a door in its side, a console outside it.
  const squares = [];
  for (let y = 24; y <= 28; y += 1) for (let x = 58; x <= 64; x += 1) squares.push([x, y, x === 58 || x === 64 || y === 24 || y === 28 ? "#" : floor]);
  squares.push([58, 26, "+"], [52, 25, "="], [53, 25, "="]);
  const voss = doc.people.find((one) => one.name === "Ilya Voss");
  const changed = {
    ...painted(doc, squares),
    people: doc.people.map((one) => (one === voss ? { ...one, x: voss.x + 2 } : one)),
    things: [...doc.things, { mark: "z", x: 61, y: 26, name: "Test safe", look: "A squat grey safe, bolted to the deck.", use: "" }],
    areas: [...doc.areas, { name: "The Strongroom", x: 58, y: 24, w: 7, h: 5, desc: "Somewhere to keep what matters." }],
  };
  const result = editor.tryDeck("meridian", "deck1", parcel(changed), { keep: true });
  assert.deepEqual([result.problems, result.elsewhere], [[], []]);
  assert.equal(result.kept, true);
  // The game reads the deck's file as it always did, and finds all of it there.
  const { level, problems } = roomFromMap(readMapFile(deckFile("deck1")), { rooms: new Set(["deck1", "deck2", "deck3"]) });
  assert.deepEqual(problems, []);
  assert.equal(level.plan[26][58], "+");
  assert.equal(level.plan[24].slice(58, 65), "#######");
  assert.equal(level.plan[26][61], "z");
  assert.deepEqual(level.things.z, { name: "Test safe", look: "A squat grey safe, bolted to the deck." });
  assert.deepEqual(level.areas.find((area) => area.id === "the_strongroom"), { id: "the_strongroom", name: "The Strongroom", x: 58, y: 24, w: 7, h: 5, desc: "Somewhere to keep what matters." });
  assert.equal(level.plan[voss.y][voss.x + 2], voss.mark);
  // Everything that was there keeps its letter, which is what the game knows a thing by.
  const again = open("deck1");
  for (const thing of doc.things) assert.deepEqual(again.things.find((one) => one.mark === thing.mark), thing);
  assert.equal(again.areas.length, doc.areas.length + 1);
  fresh("deck1");
});

test("a room walled off is said in plain words, with what the rest of the game would make of it, and isn't kept unasked", () => {
  const doc = open("deck2");
  const medbay = doc.areas.find((area) => area.id === "medbay");
  const doors = [];
  doc.grid.forEach((row, y) => [...row].forEach((mark, x) => {
    if (mark === "+" && x >= medbay.x && x < medbay.x + medbay.w + 1 && y >= medbay.y && y < medbay.y + medbay.h) doors.push([x, y, "#"]);
  }));
  assert.ok(doors.length >= 2, "the medbay has doors to wall up");
  const was = fs.readFileSync(deckFile("deck2"), "utf8");
  const tried = editor.tryDeck("meridian", "deck2", parcel(painted(doc, doors)), { keep: true });
  assert.equal(tried.kept, false);
  assert.ok(tried.problems.some((one) => /^Nobody can get to \d+ squares of floor in Medbay: there's no doorway to it\.$/.test(one.words) && Number.isInteger(one.x)), JSON.stringify(tried.problems.slice(0, 3)));
  assert.ok(tried.problems.some((one) => /can't be reached/.test(one.words)));
  assert.ok(tried.elsewhere.some((line) => /Medbay/.test(line)), tried.elsewhere.join(" | "));
  assert.equal(fs.readFileSync(deckFile("deck2"), "utf8"), was, "nothing was written");
  // The owner can keep it all the same, and is still told what's wrong.
  const anyway = editor.tryDeck("meridian", "deck2", parcel(painted(doc, doors)), { keep: true, anyway: true, whole: false });
  assert.equal(anyway.kept, true);
  assert.ok(anyway.problems.length > 0);
  assert.notEqual(fs.readFileSync(deckFile("deck2"), "utf8"), was);
  fresh("deck2");
});

test("a spot where someone stands that ends up inside a wall is moved to the nearest floor, in the life file too", () => {
  const doc = open("deck1");
  const spot = doc.spots.find((one) => doc.grid[one.y][one.x] === doc.floor && doc.grid[one.y][one.x + 1] === doc.floor && doc.grid[one.y][one.x - 1] === doc.floor);
  assert.ok(spot, "there's a spot standing on open floor");
  const lifeFile = path.join(tmp, "life", "meridian.json");
  const text = fs.readFileSync(lifeFile, "utf8");
  // A spot on a bunk or at a console stays where it is: only a wall, or the dark outside, moves one.
  assert.deepEqual(editor.tryDeck("meridian", "deck1", parcel(doc), { whole: false }).notes, []);
  const result = editor.tryDeck("meridian", "deck1", parcel(painted(doc, [[spot.x, spot.y, "#"]])), { keep: true, anyway: true, whole: false });
  assert.equal(result.kept, true);
  assert.match(result.notes.join(" "), /One spot where someone stands was inside something, and moved to the nearest floor\./);
  const moved = JSON.parse(fs.readFileSync(lifeFile, "utf8")).spots[spot.name];
  assert.equal(moved[0], spot.room);
  assert.ok(moved[1] !== spot.x || moved[2] !== spot.y);
  assert.ok(Math.abs(moved[1] - spot.x) <= 2 && Math.abs(moved[2] - spot.y) <= 1, `${spot.name} went from ${spot.x},${spot.y} to ${moved[1]},${moved[2]}`);
  assert.deepEqual(WORLD_LIFE.meridian.spots[spot.name].slice(0, 3), moved.slice(0, 3), "the running game has it too");
  // Nothing else in the life file moved: it's the same text but for that one line.
  const now = fs.readFileSync(lifeFile, "utf8").split("\n");
  assert.equal(now.filter((line, i) => line !== text.split("\n")[i]).length, 1);
  assert.ok(fs.readdirSync(path.join(tmp, "data", "map-backups")).some((name) => name.startsWith("meridian-life-")));
  // A spot dragged somewhere else is kept there.
  fresh("deck1");
  fs.writeFileSync(lifeFile, text);
  WORLD_LIFE.meridian.spots[spot.name] = JSON.parse(text).spots[spot.name];
  const dragged = { ...doc, spots: doc.spots.map((one) => (one.name === spot.name ? { ...one, x: spot.x + 1 } : one)) };
  assert.equal(editor.tryDeck("meridian", "deck1", parcel(dragged), { keep: true, whole: false }).kept, true);
  assert.equal(JSON.parse(fs.readFileSync(lifeFile, "utf8")).spots[spot.name][1], spot.x + 1);
  fresh("deck1");
  fs.writeFileSync(lifeFile, text);
  WORLD_LIFE.meridian.spots[spot.name] = JSON.parse(text).spots[spot.name];
});

test("what can't be a deck is refused in plain words, before anything is written", () => {
  const doc = open("deck1");
  const was = fs.readFileSync(deckFile("deck1"), "utf8");
  const refused = (change, words) => assert.throws(() => editor.tryDeck("meridian", "deck1", parcel({ ...doc, ...change }), { keep: true, anyway: true, whole: false }), words);
  refused({ people: doc.people.slice(1) }, /People are only moved here/);
  refused({ exits: doc.exits.slice(1) }, /Stairs are only moved here/);
  refused({ things: [...doc.things, { ...doc.things[0], mark: "z" }] }, /same square as something else/);
  refused({ things: [{ ...doc.things[0], name: "  " }, ...doc.things.slice(1)] }, /A thing needs a name/);
  refused({ areas: [...doc.areas, { name: "", x: 1, y: 1, w: 4, h: 4 }] }, /A room needs a name/);
  refused({ areas: [...doc.areas, { name: "The Bridge", x: 60, y: 20, w: 4, h: 4 }] }, /Two rooms can't both be called The Bridge/);
  refused({ areas: [...doc.areas, { name: "Too far", x: 140, y: 30, w: 9, h: 9 }] }, /doesn't fit on the deck/);
  refused({ grid: doc.grid.slice(1) }, /isn't the size it was/);
  refused({ grid: doc.grid.map((row, y) => (y === 3 ? `${doc.people[0].mark}${row.slice(1)}` : row)) }, /can't be painted there/);
  refused({ start: null }, /start/);
  assert.equal(fs.readFileSync(deckFile("deck1"), "utf8"), was);
});

test("the editor is on the menu, has its own screen, and holds the clock while it's open", () => {
  const read = (name) => fs.readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
  assert.match(read("menus.js"), /mapedit: \{ label: "Map editor", command: "mapedit",[^\n]*editor: true/);
  assert.match(read("menus.js"), /title: "Game", ids: \["mapedit", "settings"\]/);
  assert.match(read("app.js"), /if \(MENUS\[id\]\?\.editor\) \{\s+closeMenu\(\);\s+openMapEditor\(/);
  assert.match(read("index.html"), /href="mapedit\.css"/);
  assert.match(read("walk.js"), /getElementById\("mapedit"\)\) return "Stopped while the map editor is open"/);
  // Everything in it is done with the mouse: the only boxes to type in are names and words.
  const page = read("mapedit.js");
  assert.ok(!/type: "number"/.test(page));
  for (const words of ["Choose and move", "Brush", "Block", "Room", "A room's outline", "A thing", "Words on a wall", "Undo", "Redo", "Check", "Save", "Save it anyway"]) assert.ok(page.includes(`"${words}"`), words);
});
