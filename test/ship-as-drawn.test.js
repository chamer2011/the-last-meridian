// What must hold of the ship however she's drawn. This file looks at the real decks in world/maps and the real days in
// world/life (its name keeps test/kept-ship.mjs from pointing it at the kept copy), and says nothing about where
// anything is, so redrawing a room can't break it unless the room is broken: floor nobody can reach, someone's place
// inside a wall, a locker nobody can walk up to, a battle that can't be fought.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIFE_DIR, MAPS_DIR, MAP_FILE_PROBLEMS, WORLD_LIFE } from "../src/world.js";
import { deckForEditing } from "../src/map-editor.js";
import { allStoryProblems, writtenTurn } from "../src/scenes.js";
import { createGameFromDraft, randomDraft } from "../src/creator.js";
import { mapFor, placeLevels } from "../src/walk.js";
import { peopleAboard } from "../src/life.js";
import { passTime } from "../src/rules.js";
import { liveOrder, liveTick, liveView } from "../src/live-fight.js";
import { buildScene } from "../public/iso.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHIP = "meridian";
const map = mapFor(SHIP);
const decks = Object.keys(map.levels);
const plans = Object.fromEntries(decks.map((id) => [id, deckForEditing(SHIP, id)]));
// A square of a deck's plan that's neither a wall nor outside the hull.
const inside = (deck, x, y) => { const mark = plans[deck].grid[y]?.[x]; return mark !== undefined && mark !== "#" && mark !== " "; };
const deckOf = (room) => (map.levels[room] ? room : map.rooms?.[room]?.levelId ?? null);

test("this file reads the decks as they're drawn, not the copy kept for the other tests", () => {
  assert.equal(path.resolve(MAPS_DIR), path.join(root, "world", "maps"));
  assert.equal(path.resolve(LIFE_DIR), path.join(root, "world", "life"));
});

test("the decks read without complaint, and nothing in the world names a room that isn't there", () => {
  assert.deepEqual(MAP_FILE_PROBLEMS, []);
  assert.deepEqual(allStoryProblems().problems, []);
});

test("every deck passes the Map editor's own check: all its floor reached, every room with floor and a way in", () => {
  for (const id of decks) assert.deepEqual(plans[id].problems, [], id);
});

test("everywhere people's days send them is on the deck, not in a wall or outside the hull", () => {
  const life = WORLD_LIFE[SHIP];
  const places = [...Object.entries(life.spots ?? {}), ...Object.entries(life.groups ?? {}).flatMap(([name, list]) => list.map((spot, i) => [`${name} ${i + 1}`, spot]))];
  assert.ok(places.length > 20);
  for (const [name, [room, x, y]] of places) {
    const deck = deckOf(room);
    assert.ok(deck, `${name}: no room called ${room}`);
    assert.ok(inside(deck, x, y), `${name} at ${x},${y} on ${deck}`);
  }
});

test("everything in a room can be walked up to: its things, its lockers and shelves, the parts on its walls", () => {
  for (const id of decks) {
    const level = map.levels[id];
    const free = (x, y) => Boolean(level.open[y]?.[x]) && !level.solid.has(`${x},${y}`);
    for (const thing of level.things) assert.ok([[0, -1], [-1, 0], [1, 0], [0, 1]].some(([dx, dy]) => free(thing.x + dx, thing.y + dy)), `${thing.name} at ${thing.x},${thing.y} on ${id}`);
  }
});

test("a day and a night go by with everyone aboard somewhere they can stand", () => {
  const game = createGameFromDraft(randomDraft({ seed: 7, archetype: "officer" }));
  let seen = 0;
  for (const hours of [5, 9, 8, 6]) {
    passTime(game, hours);
    for (const id of decks) {
      for (const one of peopleAboard(game, SHIP, id)) {
        seen += 1;
        assert.ok(inside(id, one.x, one.y), `${one.label} at ${one.x},${one.y} on ${id}, ${one.doing}`);
      }
    }
  }
  assert.ok(seen > 100);
});

test("the room view can draw every deck, lit rooms, stairs and all", () => {
  const game = createGameFromDraft(randomDraft({ seed: 7, archetype: "officer" }));
  for (const [id, view] of Object.entries(placeLevels(game).levels)) {
    const scene = buildScene(view);
    assert.ok(scene.blocks.length > 100, id);
    assert.ok(scene.ground.some((cell) => cell.kind === "floor"), id);
  }
});

test("the opening battle can be fought to an end on deck 1 as it's drawn, and is still the crew's to win", () => {
  const play = (game, args) => writtenTurn({ game, emit: () => {}, log: (role, text) => game.transcript.push({ role, text }), ...args });
  const nearest = (game) => {
    const view = liveView(game);
    let best = null;
    for (const enemy of game.combat.enemies) {
      const spot = view.fighters[enemy.key];
      if (enemy.hp <= 0 || enemy.out || !spot || !view.sight[enemy.key]?.ok) continue;
      const far = Math.hypot((spot.x - view.you.x) * 0.5, spot.y - view.you.y);
      if (!best || far < best.far) best = { key: enemy.key, far };
    }
    return best?.key ?? null;
  };
  let won = 0;
  const fights = 12;
  for (let n = 0; n < fights; n += 1) {
    const game = createGameFromDraft(randomDraft({ seed: 300 + n, archetype: "officer" }));
    play(game, { event: "start" });
    play(game, { playerText: "Hold the bridge" });
    assert.ok(game.combat?.battle, "the battle begins");
    let over = null;
    for (let i = 0; i < 2400 && !over; i += 1) {
      if (game.hp > 0) {
        const target = nearest(game);
        if (target && target !== game.combat.live.you.target) liveOrder(game, { type: "attack", target });
      }
      const reply = liveTick(game, { ms: 500 });
      if (reply.over) over = reply;
    }
    assert.ok(over, `fight ${n + 1} ends`);
    if (game.battles?.mutiny?.result === "victory") won += 1;
  }
  // Holding the bridge wins most of the time on any deck that's fair to the crew: a redraw that loses it every time
  // has shut the crew out of the fight, or let the mutineers straight in.
  assert.ok(won >= 4, `${won} of ${fights} won`);
});
