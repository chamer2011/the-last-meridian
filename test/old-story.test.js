// The written main story was taken out of the game on 2026-11-12, at the owner's word: The Beacon and Fuel for the
// Ship, the written openings, the arrival at Haven, the written stories and Tharel's talk. These tests say what's
// left in the game's own folders, how a new game begins, and what happens to a game saved in the middle of it.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-old-story-"));
process.env.GAME_DATA_DIR = dataDir;

const { latestOptions } = await import("../public/story.js");
const { createGameFromDraft, creatorSetup, randomDraft } = await import("../src/creator.js");
const { STARTING_QUESTS } = await import("../src/data.js");
const { OLD_STORY_NOTICE, migrateGame } = await import("../src/migrate.js");
const { questsView } = await import("../src/quests.js");
const { publicState } = await import("../src/rules.js");
const { sceneFileIds, writtenThreadIds } = await import("../src/scene-files.js");
const { NO_OPENING, StoryError, allStoryProblems, loadScenes, writtenTurn } = await import("../src/scenes.js");
const { leadsHere } = await import("../src/story-library.js");
const { SET_ASIDE, STORY_CLOCK, WORLD_THREADS } = await import("../src/world.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
// One turn of the written story, with what it says kept in order.
function play(game, args) {
  const said = [];
  writtenTurn({ game, emit: (e) => { if (e.type !== "state") said.push(e); }, log: (role, text) => game.transcript.push({ role, text }), ...args });
  for (const one of said) game.transcript.push({ role: one.type === "text" ? "narrator" : "notice", text: one.text });
  return said;
}

test("what's left in the game's folders: no main story, no written story or arrival, no clock by act, and the mutiny as the only opening", () => {
  const stories = Object.keys(WORLD_THREADS);
  assert.equal(stories.length, 108);
  assert.deepEqual(stories.filter((id) => id.startsWith("main_")), []);
  assert.deepEqual(stories.filter((id) => WORLD_THREADS[id].kind === "main"), []);
  assert.deepEqual(stories.filter((id) => WORLD_THREADS[id].after && !WORLD_THREADS[WORLD_THREADS[id].after] && !SET_ASIDE.has(id)), [], "nothing still in the game waits on a story that's gone");
  assert.ok(SET_ASIDE.has("deep_past_the_lamp") && SET_ASIDE.has("out_ghostlight_court_martial"), "the two that followed the main story are set aside");
  assert.equal(writtenThreadIds().size, 0, "no story has a written scene");
  const scenes = [...sceneFileIds()];
  assert.deepEqual(scenes.filter((id) => /^(arrive_|thread_)/.test(id)), []);
  // Since 2026-11-12 the captain's game opens with a mutiny on deck 1 (src/battles.js), and no other life has an opening.
  assert.deepEqual(scenes.filter((id) => id.startsWith("opening")), ["opening_captain"]);
  assert.equal(loadScenes().scenes.opening_captain.title, "The Red Cloth");
  assert.ok(!scenes.includes("talk_tharel"));
  assert.ok(scenes.filter((id) => id.startsWith("request_")).length >= 19, "what people ask is all still there");
  assert.ok(scenes.filter((id) => id.startsWith("talk_")).length >= 13, "and so are the crew's written talks");
  assert.deepEqual(scenes.filter((id) => id.startsWith("command_")).sort(), ["command_brig", "command_conspiracy", "command_delegation"]);
  assert.deepEqual(STORY_CLOCK.acts, []);
  assert.deepEqual(STARTING_QUESTS, []);
  assert.deepEqual(allStoryProblems().problems, [], "and the checker is content with what's left");
});

test("a new game is the captain's, with no quest, and it opens with the mutiny's alarm on the bridge", () => {
  assert.deepEqual(Object.keys(creatorSetup().starts), ["captain"]);
  const game = newGame();
  assert.equal(game.version, 24);
  assert.deepEqual(game.quests, []);
  assert.equal(questsView(game).following, null);
  const said = play(game, { event: "start" });
  assert.match(said[0].text, /every speaker on the deck gives the same flat chime/);
  assert.equal(game.scene.id, "opening_captain");
  assert.equal(game.scene.part, "alarm");
  assert.deepEqual(game.quests, [], "the opening gives no quest");
  const shown = publicState(game);
  assert.equal(shown.storyWaiting, false);
  assert.equal(shown.walk.here.name, "The Bridge");
  assert.equal(latestOptions(shown.transcript).length, 2, "hold the bridge, or get on the speakers first");
  // Another life, in a game saved from when it was offered, has no opening, and says so.
  const draft = randomDraft({ seed: 8, archetype: "officer" });
  draft.start = "engine_hand";
  const hand = createGameFromDraft(draft);
  assert.deepEqual(play(hand, { event: "start" }), [{ type: "notice", text: NO_OPENING }]);
  assert.equal(hand.scene, null);
  // The leads are still listed, as notes of stories nobody has written out, and taking one says so.
  const leads = leadsHere(game);
  assert.ok(leads.length >= 1);
  assert.ok(leads.every((lead) => !lead.written));
  assert.throws(() => play(game, { playerText: "I look into this", threadId: leads[0].id }), (err) => err instanceof StoryError && /hasn't been written out yet/.test(err.message));
  // Typing what isn't one of the choices gets a plain answer, and changes nothing.
  const before = JSON.stringify(game);
  assert.throws(() => play(game, { playerText: "look around" }), (err) => err instanceof StoryError);
  assert.equal(JSON.stringify(game), before);
});

// A game saved in the middle of the old story, at save version 23: on the bridge in the opening, with the Downstairs
// Crew waiting its turn, the two main quests and a story's quest going, something the cook asked, and a talk open.
function savedInTheOldStory() {
  const game = { ...newGame(), version: 23 };
  game.scene = { id: "opening_captain", part: "orders", pending: null, seen: ["bridge", "listen", "orders"], quest: "the_beacon", told: true, with: "voss", at: null };
  game.parked = {
    thread_crew_naomi_under_crew: { id: "thread_crew_naomi_under_crew", part: "asked", pending: null, seen: ["doorway", "asked"], quest: "crew_naomi_under_crew", told: true, with: "naomi", at: null },
    command_delegation: { id: "command_delegation", part: "start", pending: null, seen: ["start"], quest: null, told: false, with: "tarrow", at: null },
  };
  game.quests = [
    { id: "the_beacon", title: "The Beacon", description: "A signal on every band.", objective: "Find someone who can read it.", status: "active", main: true },
    { id: "fuel_for_the_fleet", title: "Fuel for the Ship", description: "Two weeks of fuel.", objective: "Secure a fuel supplier for the ship.", status: "active", main: false },
    { id: "crew_naomi_under_crew", title: "The Downstairs Crew", description: "x", objective: "Find out what's in Section Fourteen.", status: "active" },
    { id: "old_favour", title: "An Old Favour", description: "x", objective: "Done long ago.", status: "completed" },
    { id: "request_pantry", title: "A bare pantry", description: "x", objective: "Bring 2 ration crates to the pantry.", status: "active", request: "pantry" },
  ];
  game.following = "the_beacon";
  game.talk = { key: "voss", name: "Commander Ilya Voss", personId: "voss", log: [], written: { id: "talk_voss", part: "start_list", seen: ["start_list"], stock: null } };
  game.transcript = [{ role: "narrator", text: "Voss waits. The dots on the table don't.\n\n> Have Pell plot the course for Haven\n> Go and see the ship first" }];
  return game;
}

test("a game saved in the middle of the old story opens with that story closed, and everything else as it was", () => {
  const saved = savedInTheOldStory();
  const game = migrateGame(structuredClone(saved));
  assert.equal(game.version, 24);
  assert.equal(game.scene, null, "the opening it was in is gone, though there's a new opening by that name: the mutiny's");
  assert.deepEqual(Object.keys(game.parked), ["command_delegation"], "a scene whose file is still there keeps its place");
  const quest = (id) => game.quests.find((one) => one.id === id);
  for (const id of ["the_beacon", "fuel_for_the_fleet", "crew_naomi_under_crew"]) {
    assert.equal(quest(id).status, "completed", id);
    assert.equal(quest(id).objective, "Closed: the written story this belonged to has been taken out of the game.", id);
  }
  assert.equal(quest("old_favour").objective, "Done long ago.", "a quest that was over is left alone");
  assert.equal(quest("request_pantry").status, "active", "what someone aboard asked is still asked");
  assert.equal(quest("request_pantry").objective, "Bring 2 ration crates to the pantry.");
  assert.equal(game.following, null, "the tracker lets go of a quest that's over");
  assert.equal(questsView(game).following, "request_pantry", "and follows what's still going");
  assert.equal(game.talk, null, "a talk that was open is closed, since its lines may have changed");
  // Told once, in a line that also stops the old scene's choices being offered.
  assert.equal(game.transcript.length, 2);
  assert.deepEqual(game.transcript.at(-1), { role: "notice", text: OLD_STORY_NOTICE, turnover: true });
  assert.deepEqual(latestOptions(game.transcript), []);
  const shown = publicState(game);
  assert.equal(shown.storyWaiting, false);
  assert.equal(shown.scene, null);
  // Opened again, nothing more is said.
  const again = migrateGame(structuredClone(game));
  assert.deepEqual(again.transcript, game.transcript);
  assert.deepEqual(again.quests, game.quests);
});

test("a saved game with nothing of the old story in it is told nothing, and another life's game still opens", () => {
  const quiet = { ...newGame(), version: 23 };
  quiet.transcript = [{ role: "narrator", text: "A quiet watch." }];
  quiet.quests = [{ id: "request_pantry", title: "A bare pantry", description: "x", objective: "Bring 2 ration crates to the pantry.", status: "active", request: "pantry" }];
  const opened = migrateGame(structuredClone(quiet));
  assert.equal(opened.version, 24);
  assert.deepEqual(opened.transcript, quiet.transcript);
  assert.deepEqual(opened.quests, quiet.quests);
  // A game that hadn't begun says nothing either, even with the old quests in it: it has no story to interrupt.
  const unbegun = { ...newGame(), version: 23, transcript: [] };
  unbegun.quests = [{ id: "the_beacon", title: "The Beacon", description: "x", objective: "y", status: "active", main: true }];
  const begun = migrateGame(structuredClone(unbegun));
  assert.deepEqual(begun.transcript, []);
  assert.equal(begun.quests[0].status, "completed");
  // The lives that are switched off for new games are kept, so an engine hand's saved game opens as an engine hand's.
  const draft = randomDraft({ seed: 8, archetype: "officer" });
  draft.start = "engine_hand";
  const hand = migrateGame({ ...createGameFromDraft(draft), version: 23 });
  assert.equal(hand.role.id, "engine_hand");
  assert.equal(publicState(hand).role.captain, false);
  assert.equal(play(hand, { event: "start" })[0].text, NO_OPENING);
});
