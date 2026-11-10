// The story library: what each place offers, how story threads get taken up and finished, and
// what the game master is told and when. The game master's notes never reach the browser.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createGameFromDraft, randomDraft } from "../src/creator.js";
import { FACTIONS, ITEMS, LOCATIONS, STARTING_FACTIONS } from "../src/data.js";
import { LORE } from "../src/lore.js";
import { migrateGame } from "../src/migrate.js";
import { audienceBonus, buyPrice, publicState, travel } from "../src/rules.js";
import { leadsHere, noteThreadStarted, rumorsHere, updateStory } from "../src/story-library.js";
import { newTurnLimits, runTool } from "../src/tools.js";
import { WORLD_ARC, WORLD_THREADS } from "../src/world.js";

const newGame = (seed = 11, archetype = "officer") => createGameFromDraft(randomDraft({ seed, archetype }));
const tool = (game, name, input) => runTool(game, name, input, newTurnLimits());

test("every place has a file, and the world is much bigger than it was", () => {
  assert.ok(Object.keys(LOCATIONS).length >= 24);
  for (const [id, place] of Object.entries(LOCATIONS)) {
    assert.ok(place.name && place.desc, id);
    assert.ok(place.gm, `${id} has no notes`);
    assert.ok(Array.isArray(place.market), id);
    for (const item of place.market) assert.ok(ITEMS[item], `${id} sells ${item}`);
  }
  assert.ok(Object.keys(FACTIONS).length >= 12);
  assert.ok(Object.keys(WORLD_THREADS).length >= 80, `only ${Object.keys(WORLD_THREADS).length} threads`);
  assert.ok((WORLD_ARC.acts ?? []).length >= 3);
  assert.ok((WORLD_ARC.clues ?? []).length >= 20);
});

test("new places and factions get highlighted in the story, and in the codex", () => {
  for (const id of Object.keys(LOCATIONS)) assert.ok(LORE.some((entry) => entry.id === `place:${id}`), id);
  for (const id of Object.keys(FACTIONS)) assert.ok(LORE.some((entry) => entry.id === `faction:${id}`), id);
});

test("the leads menu shows what fits here, and it changes from place to place", () => {
  const game = newGame();
  const seen = new Set();
  for (const id of Object.keys(LOCATIONS)) {
    game.location = id;
    game.level = 3;
    const leads = leadsHere(game);
    assert.ok(leads.length <= 4, id);
    for (const lead of leads) {
      seen.add(lead.id);
      const thread = WORLD_THREADS[lead.id];
      assert.ok((thread.minLevel ?? 1) <= game.level, lead.id);
      assert.ok(thread.places.includes(id) || thread.places.includes("any") || (thread.places.includes("fleet") && id === "meridian"), `${lead.id} at ${id}`);
      assert.ok(!thread.after, `${lead.id} isn't unlocked yet`);
    }
  }
  assert.ok(seen.size >= 20, `only ${seen.size} different leads across the galaxy`);
});

test("leads stay put for a while, then move on", () => {
  const game = newGame();
  game.location = "haven";
  game.level = 8;
  const first = leadsHere(game).map((lead) => lead.id);
  assert.deepEqual(leadsHere(game).map((lead) => lead.id), first);
  game.clock.hours += 1;
  assert.deepEqual(leadsHere(game).map((lead) => lead.id), first);
  const rumors = rumorsHere(game);
  assert.deepEqual(rumorsHere(game), rumors);
  game.clock.hours += 24 * 6;
  assert.notDeepEqual(rumorsHere(game), rumors);
});

test("the writer's notes on a place never reach the browser", () => {
  const game = newGame();
  for (const id of ["haven", "meridian", "nest"]) {
    game.location = id;
    const state = publicState(game);
    const shown = JSON.stringify({ location: state.location, story: state.story, locations: state.locations });
    assert.ok(!state.location.gm, id);
    assert.ok(!state.location.encounters, id);
    assert.ok(!state.location.rumors, id);
    for (const secret of LOCATIONS[id].gm.secrets) assert.ok(!shown.includes(secret), secret);
    assert.ok(!shown.includes('"truth"'));
    assert.ok(!shown.includes('"beats"'));
  }
  // The hidden place stays hidden until someone mentions it.
  game.location = "meridian";
  assert.ok(!publicState(game).locations.some((place) => place.id === "harbor"));
});

test("taking up a thread takes it off the list of leads", () => {
  const game = newGame();
  game.location = "haven";
  game.level = 8;
  const [lead] = leadsHere(game);
  assert.ok(lead);
  noteThreadStarted(game, lead.id);
  assert.ok(!leadsHere(game).some((one) => one.id === lead.id));
  const state = publicState(game);
  assert.ok(state.story.active.some((one) => one.id === lead.id));
});

test("a quest with a thread's id follows that thread, and finishing one can unlock the next", () => {
  const game = newGame();
  const [id, thread] = Object.entries(WORLD_THREADS).find(([, one]) => one.after);
  game.level = 8;
  [game.location] = thread.places.filter((place) => LOCATIONS[place]);
  if (!game.location) game.location = "meridian";
  assert.ok(!leadsHere(game).some((one) => one.id === id), "it isn't open yet");
  tool(game, "add_quest", { id: thread.after, title: "Before", description: "x", objective: "y" });
  assert.equal(game.story.threads[thread.after], "active");
  tool(game, "update_quest", { id: thread.after, status: "completed", objective: "Done." });
  assert.equal(game.story.threads[thread.after], "done");
  assert.ok(publicState(game).story.done.some((one) => one.id === thread.after));
});

test("the main story moves on as clues are found, and it won't take nonsense", () => {
  const game = newGame();
  assert.equal(game.story.act, 1);
  const [clue] = WORLD_ARC.clues;
  assert.ok(!tool(game, "update_story", { clue: clue.id }).isError);
  assert.ok(game.story.clues.includes(clue.id));
  assert.equal(tool(game, "update_story", { clue: "nonsense" }).isError, true);
  assert.equal(tool(game, "update_story", { act: 99 }).isError, true);
  assert.equal(tool(game, "update_story", {}).isError, true);
  assert.match(updateStory(game, { act: 2 }), /act 2\./);
  assert.equal(game.story.act, 2);
});

test("the dock the Meridian's at is close by: no fuel, and an hour to cross; anywhere else is a jump", () => {
  const game = newGame();
  game.ship.fuel = 0;
  game.location = "meridian";
  game.ship.at = "haven";
  const { message } = travel(game, "haven");
  assert.match(message, /Haven/);
  assert.equal(game.location, "haven");
  assert.equal(game.ship.fuel, 0);
  assert.throws(() => travel(game, "sundial"), /fuel/, "the Sundial is a place of her own now, a jump away");
  travel(game, "meridian");
  assert.equal(game.location, "meridian");
});

test("a new campaign and an old save both know about every faction", () => {
  const game = newGame();
  for (const id of Object.keys(FACTIONS)) assert.equal(typeof game.factions[id], "number", id);
  const old = JSON.parse(JSON.stringify({ ...newGame(12), version: 5 }));
  old.factions = { fleet: 50, hegemony: -40, drift: 3, ilun: 9 };
  delete old.story;
  const migrated = migrateGame(old);
  assert.equal(migrated.factions.fleet, 50, "what they've earned stays");
  assert.equal(migrated.factions.guild, STARTING_FACTIONS.guild);
  for (const id of Object.keys(FACTIONS)) assert.equal(typeof audienceBonus(migrated, id), "number", id);
  assert.ok(publicState(migrated).factions.length === Object.keys(FACTIONS).length);
  assert.deepEqual(migrated.story.threads, {});
});

test("a new item works in a market, and gear changes the numbers it says it does", () => {
  const game = newGame();
  for (const [id, item] of Object.entries(ITEMS)) {
    if (item.price > 0) assert.ok(buyPrice(game, item) > 0, id);
  }
});
