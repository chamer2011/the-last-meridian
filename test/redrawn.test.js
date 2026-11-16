// A deck redrawn under a game that's already begun, by the Map editor's save or by its file changing: everyone aboard
// is settled again where their day has them now (src/life.js), and the parts of the ship's systems keep to walls that
// stand, clear of what the deck itself hangs on them (src/systems.js). On copies of the maps and the life files, never
// the game's own.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-redrawn-"));
const world = new URL("../world/", import.meta.url);
fs.cpSync(fs.realpathSync(new URL("maps", world)), path.join(tmp, "maps"), { recursive: true });
fs.cpSync(fs.realpathSync(new URL("life", world)), path.join(tmp, "life"), { recursive: true });
process.env.GAME_DATA_DIR = path.join(tmp, "data");
process.env.GAME_MAPS_DIR = path.join(tmp, "maps");
process.env.GAME_LIFE_DIR = path.join(tmp, "life");

const editor = await import("../src/map-editor.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { peopleAboard } = await import("../src/life.js");
const { passTime } = await import("../src/rules.js");
const { claimedSquares, fittedSquares, systemsOf, wallSpots } = await import("../src/systems.js");
const { mapFor, redrawnRooms, roomOf } = await import("../src/walk.js");
const { buildScene } = await import("../public/iso.js");

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// The game looks at its decks' files at most once a second; a test says it's later than it is.
let later = 0;
const readAgain = () => redrawnRooms(Date.now() + 5000 * (later += 1));
const newGame = (seed) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }), "redrawn");
// A free square of floor on the deck, away from everything on it.
function freeFloor(doc) {
  const used = new Set([...(doc.furniture ?? []), ...(doc.things ?? []), ...(doc.people ?? []), ...(doc.exits ?? []), ...(doc.spots ?? [])].flatMap((one) => [-2, -1, 0, 1, 2].flatMap((dx) => [-1, 0, 1].map((dy) => `${one.x + dx},${one.y + dy}`))));
  for (let y = 2; y < doc.height - 2; y += 1) {
    for (let x = 2; x < doc.width - 3; x += 1) {
      const free = (xx, yy) => doc.floors.includes(doc.grid[yy][xx]) && !used.has(`${xx},${yy}`);
      if (free(x, y) && free(x + 1, y) && free(x, y + 1) && free(x - 1, y) && free(x, y - 1)) return { x, y };
    }
  }
  throw new Error("no free floor on the deck");
}
// Whoever of the people drawn on deck 1 is at their post just now.
function atTheirPost(game, doc) {
  const kept = game.life.places.meridian;
  const one = doc.people.find((person) => kept[person.id]?.level === "deck1" && kept[person.id].x === person.x && kept[person.id].y === person.y);
  assert.ok(one, "someone on deck 1 is at their post");
  return one;
}

test("when a deck is redrawn under a game, everyone aboard is settled again where their day has them now", () => {
  const game = newGame(5);
  passTime(game, 5 / 60);
  const mark = game.life.drawn.meridian;
  assert.equal(typeof mark, "string");
  // Nothing redrawn: the clock moving on keeps the mark, and people where they were.
  const posted = atTheirPost(game, editor.deckForEditing("meridian", "deck1"));
  passTime(game, 1 / 60);
  assert.equal(game.life.drawn.meridian, mark);
  // Their post is moved across the deck, onto free floor.
  const doc = editor.deckForEditing("meridian", "deck1");
  const to = freeFloor(doc);
  assert.ok(Math.abs(to.x - posted.x) + Math.abs(to.y - posted.y) > 3);
  const people = doc.people.map((person) => (person.id === posted.id ? { ...person, x: to.x, y: to.y } : person));
  const result = editor.tryDeck("meridian", "deck1", { ...doc, people }, { keep: true, whole: false });
  assert.equal(result.kept, true, JSON.stringify(result.problems));
  readAgain();
  // Looking shows them where they'd be now, and changes nothing in the save.
  const saved = JSON.stringify(game.life);
  const seen = peopleAboard(game, "meridian", "deck1").find((one) => one.id === posted.id);
  assert.deepEqual([seen.x, seen.y], [to.x, to.y]);
  assert.equal(JSON.stringify(game.life), saved);
  // The clock moving settles it into the save, with the deck's new mark.
  passTime(game, 1 / 60);
  const now = game.life.places.meridian[posted.id];
  assert.deepEqual([now.level, now.x, now.y], ["deck1", to.x, to.y]);
  assert.notEqual(game.life.drawn.meridian, mark);
  // Everyone kept is on a square of some deck that's floor.
  const map = mapFor("meridian");
  for (const [id, state] of Object.entries(game.life.places.meridian)) assert.ok(map.levels[state.level]?.open[state.y]?.[state.x], `${id} is on floor`);
});

test("a save from before the mark was kept has everyone settled once, where their day has them", () => {
  const game = newGame(6);
  passTime(game, 5 / 60);
  const doc = editor.deckForEditing("meridian", "deck1");
  const posted = atTheirPost(game, doc);
  const away = freeFloor(doc);
  // As an old save has it: no mark, and someone standing where the deck no longer has them.
  delete game.life.drawn;
  Object.assign(game.life.places.meridian[posted.id], { x: away.x, y: away.y, goal: { level: "deck1", x: away.x, y: away.y }, path: null });
  const seen = peopleAboard(game, "meridian", "deck1").find((one) => one.id === posted.id);
  assert.deepEqual([seen.x, seen.y], [posted.x, posted.y], "shown at their post before the clock moves");
  passTime(game, 1 / 60);
  const now = game.life.places.meridian[posted.id];
  assert.deepEqual([now.x, now.y], [posted.x, posted.y]);
  assert.equal(typeof game.life.drawn.meridian, "string");
});

test("no part of the ship's systems hangs where the deck has a fitting of its own, and parts keep to walls that stand", () => {
  const map = mapFor("meridian");
  const model = systemsOf("meridian");
  let onWalls = 0;
  for (const [room, ids] of Object.entries(model.partsIn)) {
    const entry = roomOf(map, room);
    const fitted = fittedSquares(entry.level);
    const every = wallSpots(entry.level, claimedSquares("meridian", map, entry.level), entry.area);
    const own = ids.map((id) => model.parts[id]).filter((part) => part.kind !== "door panel");
    const standing = every.filter((one) => !one.low && !fitted.has(`${one.x},${one.y}`));
    for (const part of own) {
      if (part.mount !== "wall") continue;
      onWalls += 1;
      assert.ok(!fitted.has(`${part.x},${part.y}`), `${part.name} in ${entry.name} hangs over a fitting`);
      // Where the room has a standing wall free for each of its parts, none is on a wall the room view cuts down.
      if (standing.length >= own.length) assert.ok(!every.find((one) => one.x === part.x && one.y === part.y)?.low, `${part.name} in ${entry.name} is on a low wall`);
    }
  }
  assert.ok(onWalls > 20, `${onWalls} parts on walls`);
});

test("a fitting hung where a part was moves the part along, and the fitting stays", () => {
  const before = systemsOf("meridian");
  const part = before.partsIn.bridge.map((id) => before.parts[id]).find((one) => one.mount === "wall" && one.kind !== "door panel");
  assert.ok(part, "the bridge has a part on a wall");
  const doc = editor.deckForEditing("meridian", "deck1");
  const result = editor.tryDeck("meridian", "deck1", { ...doc, furniture: [...doc.furniture, { kind: "wall-screen", x: part.x, y: part.y, facing: "s" }] }, { keep: true, whole: false });
  assert.equal(result.kept, true, JSON.stringify(result.problems));
  readAgain();
  const after = systemsOf("meridian");
  const moved = after.parts[part.id];
  assert.ok(moved && (moved.x !== part.x || moved.y !== part.y), `${part.name} moved from ${part.x},${part.y}`);
  assert.ok(!Object.values(after.parts).some((one) => one.mount === "wall" && one.room === "bridge" && one.x === part.x && one.y === part.y), "nothing hangs over the screen");
  const level = mapFor("meridian").levels.deck1;
  assert.ok(level.furniture.some((piece) => piece.kind === "wall-screen" && piece.x === part.x && piece.y === part.y));
});

test("the hull's skin turns a corner of the hull square, not in steps", () => {
  // A small ship: a room of four squares by three, walls round it, nothing else. The square diagonally off a corner of
  // the hull is skin, as the ones straight out from it are.
  const rows = ["            ", "            ", "            ", "   ######   ", "   #....#   ", "   #....#   ", "   #....#   ", "   ######   ", "            ", "            ", "            "];
  const blank = rows.map((row) => " ".repeat(row.length));
  const view = {
    place: { id: "test" }, cols: rows[0].length, lines: rows.length,
    layers: { floor: rows.map((row) => row.replace(/[^.]/g, " ")), walls: rows.map((row) => row.replace(/[^#]/g, " ")), scenery: blank, writing: blank },
    labels: [], colors: {}, look: { style: "navy", floor: "plating" }, here: { level: "test", name: "Test" }, things: [], furniture: [], exits: [], areas: [],
  };
  const scene = buildScene(view);
  assert.equal(scene.kinds[3][2], "hull", "straight out from the wall");
  assert.equal(scene.kinds[2][2], "hull", "off the corner");
  assert.equal(scene.kinds[1][1], "hull", "two out, off the corner");
});
