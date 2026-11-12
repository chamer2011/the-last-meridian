// After a battle, the list in the corner and the asks that go with it (src/aftermath.js, world/scenes/request_*.txt):
// what's on the list and how it ticks itself off, the chief of security's question about the prisoners and each answer,
// the chief engineer's damage report, the dead and the speaker's ask to say their names, a post left empty while its
// holder is laid up, and the words the written story has for all of it.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-aftermath-list-"));
process.env.GAME_DATA_DIR = dataDir;

const { parseBattleText } = await import("../public/battle-text.js");
const { BATTLES_DIR } = await import("../src/battles.js");
const { keyAt } = await import("../src/body.js");
const { commandView, deputyFor, emptyPosts, holderKey, troublesOf } = await import("../src/command.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { die } = await import("../src/death.js");
const { liveTick } = await import("../src/live-fight.js");
const { storyRequest } = await import("../src/request-hook.js");
const { passTime, publicState } = await import("../src/rules.js");
const { conditionHolds, parseCondition, parseEffect } = await import("../src/scene-text.js");
const { allSceneProblems, writtenTurn } = await import("../src/scenes.js");
const { damagePart, mendFirst } = await import("../src/systems.js");
const talks = await import("../src/talks.js");
const walk = await import("../src/walk.js");

const SHIP = "meridian";
const newGame = (seed = 51) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const play = (game, args) => writtenTurn({ game, emit: () => {}, log: (role, text) => game.transcript.push({ role, text }), ...args });
// The opening, and the battle ended at once the same way every time, as in test/aftermath.test.js: nobody on the
// player's side goes down, eight of them are beaten and four give up. Then the story goes on.
function quickBattle(game) {
  play(game, { event: "start" });
  play(game, { playerText: "Hold the bridge" });
  const c = game.combat;
  for (const enemy of c.enemies) enemy.hp = 0;
  for (let i = 0; i < 80 && game.combat; i += 1) {
    if (c.enemies.length === 12 && c.enemies.filter((one) => one.hp > 0).length > 4) for (const enemy of c.enemies.filter((one) => one.hp > 0).slice(0, 2)) enemy.hp = 0;
    liveTick(game, { ms: 500 });
  }
  assert.equal(game.combat, null, "the battle's over");
  play(game, { event: "continue" });
}
const ids = (game) => game.aftermath.items.map((one) => one.id);
const open = (game) => game.aftermath.items.filter((one) => one.done == null).map((one) => one.id);
// Talking to someone where their day has them, and answering with part of a choice's words.
function ask(game, key) {
  const life = game.life.places[SHIP][key];
  walk.walkCommand(game, { action: "room", to: walk.mapFor(SHIP).levels[life.level].roomAt(Math.round(life.x), Math.round(life.y)) });
  walk.talkCommand(game, { action: "open", person: key });
  talks.openWrittenTalk(game);
  return String(game.talk.lastReply ?? "");
}
function answer(game, words) {
  const said = [];
  talks.writtenTalkTurn({ game, playerText: words, emit: (e) => { if (e.type !== "state") said.push(e.text); } });
  walk.talkCommand(game, { action: "close" });
  return said;
}
const hours = (game, n) => {
  const said = [];
  for (let i = 0; i < n; i += 1) said.push(...(passTime(game, 1, "routine") ?? []));
  return said;
};

test("won, the list in the corner holds what the battle left, ticks itself off, and is finished once the prisoners are settled", () => {
  const game = newGame(51);
  quickBattle(game);
  assert.deepEqual(ids(game), ["fire", "fallen", "breach", "galley", "nav", "prisoners"], "nobody on your side went down, and nobody's died");
  const quest = game.quests.find((one) => one.id === "after_mutiny");
  assert.deepEqual([quest.title, quest.main, quest.status, quest.list], ["After the mutiny", true, "active", true]);
  // The tracker follows it, with every box and where to go for the fire and the breach.
  const log = publicState(game).questLog;
  assert.equal(log.following, "after_mutiny");
  const list = log.quests.find((one) => one.id === "after_mutiny").checklist;
  assert.deepEqual(list.map((one) => [one.text, one.done]), [["Fire out", false], ["Nobody left where they fell", false], ["The breach patched", false], ["Power back in the Galley", false], ["The nav core mended", false], ["The prisoners settled", false]]);
  assert.equal(list.find((one) => one.id === "breach").where, "The Boat Bay");
  assert.ok(list.find((one) => one.id === "fire").where, "the fire's room is named");
  // The ship puts itself right in a day, the prisoners aside, each ticked with a line.
  const said = hours(game, 24);
  assert.deepEqual(open(game), ["prisoners"]);
  assert.ok(said.includes("[STORY] After the mutiny: fire out (1 of 6)."), said.filter((one) => one.includes("After the mutiny")).join("\n"));
  assert.equal(publicState(game).questLog.quests.find((one) => one.id === "after_mutiny").checklist.filter((one) => one.done).length, 5);
  // The chief of security asked straight after the battle, and an answer settles it.
  assert.match(ask(game, "tarrow"), /What do you want done with them\?/);
  answer(game, "Keep them locked up");
  const end = hours(game, 1);
  assert.deepEqual(open(game), []);
  assert.ok(end.includes("[STORY] After the mutiny: every last thing on the list is seen to. What comes next comes from the ship, and from what people ask."), end.join("\n"));
  assert.equal(quest.status, "completed");
  assert.notEqual(publicState(game).questLog.following, "after_mutiny", "the list has left the corner");
  // Ticked stays ticked, whatever breaks later.
  damagePart(game, SHIP, "navigation:nav_core:bridge", "broken", { by: "wear" });
  hours(game, 1);
  assert.equal(game.aftermath.items.find((one) => one.id === "nav").done != null, true);
});

test("the chief of security's question settles the prisoners each way, and put ashore they go at the next port", () => {
  const settled = (fate, words) => {
    const game = newGame(52);
    quickBattle(game);
    const morale = game.ship.morale;
    const confidence = commandView(game, SHIP).mood.confidence;
    ask(game, "tarrow");
    const said = answer(game, words);
    assert.equal(game.command[SHIP].prisoners.fate, fate);
    return { game, said, morale, confidence };
  };
  let { game, said, morale, confidence } = settled("locked", "Keep them locked up");
  assert.ok(said.includes("[COMMAND] The mutineers in the brig are kept locked up."), said.join("\n"));
  assert.equal(game.ship.morale, morale);
  assert.ok(game.story.record.facts.some((one) => one.id === "prisoners_kept_locked_up"));
  ({ game, said, morale, confidence } = settled("work", "Put them to work"));
  assert.equal(game.ship.morale, morale + 2);
  assert.equal(commandView(game, SHIP).mood.confidence, confidence + 3);
  assert.match(commandView(game, SHIP).mood.brig[0], /: put to work under guard by day$/);
  ({ game, said } = settled("ashore", "Put them ashore"));
  // Not in open space: once the beaten are on their feet and in the brig, at a port with a market.
  hours(game, 80);
  const held = game.command[SHIP].prisoners;
  assert.equal(held.held, 12);
  const aboard = game.ship.aboard;
  game.ship.at = "haven";
  const docked = hours(game, 1);
  assert.ok(docked.includes("[COMMAND] At Haven Station, the 12 mutineers from the brig are put ashore under guard. Morale +2."), docked.join("\n"));
  assert.deepEqual([held.held, held.ashore, game.ship.aboard], [0, 12, aboard - 12]);
  assert.deepEqual(commandView(game, SHIP).mood.brig, ["12 mutineers put ashore"]);
  assert.ok(game.story.record.facts.some((one) => one.id === "mutineers_put_ashore"));
});

test("the chief engineer's damage report says what's still to mend, and puts first what the captain says", () => {
  const game = newGame(53);
  quickBattle(game);
  const said = ask(game, "marrow");
  assert.match(said, /Still to mend, in the order we're going: the junction box in The Names Bulkhead; the nav core in The Bridge/);
  const order = () => Object.entries(game.systems[SHIP].parts).filter(([, s]) => s.damage && s.by === "battle").sort((a, b) => a[1].fixAt - b[1].fixAt).map(([id]) => id);
  const times = Object.values(game.systems[SHIP].parts).filter((s) => s.damage && s.by === "battle").map((s) => s.fixAt).sort((a, b) => a - b);
  assert.equal(order()[0], "power:junction_box:names");
  const words = answer(game, "The bridge first");
  assert.ok(words.includes("[SYSTEMS] The engineers will mend the nav core first."), words.join("\n"));
  assert.equal(order()[0], "navigation:nav_core:bridge");
  assert.equal(order()[1], "power:junction_box:names");
  // The engineers keep their pace: the same times, in a new order.
  assert.deepEqual(Object.values(game.systems[SHIP].parts).filter((s) => s.damage && s.by === "battle").map((s) => s.fixAt).sort((a, b) => a - b), times);
  // Once it's all mended, an ask that wasn't answered goes.
  const other = newGame(53);
  quickBattle(other);
  hours(other, 14);
  assert.equal(other.requests.open.damage_report, undefined);
});

test("the dead go on the list when the first of them dies, are ticked once laid out, and the speaker asks to say their names", () => {
  const game = newGame(54);
  quickBattle(game);
  const name = game.command[SHIP].prisoners.coming[0];
  die(game, keyAt(SHIP, name), { cause: "bled" });
  passTime(game, 0.25, "routine");
  assert.ok(ids(game).includes("dead"));
  assert.ok(ids(game).indexOf("dead") < ids(game).indexOf("prisoners"), "in its place on the list");
  hours(game, 12);
  assert.equal(open(game).includes("dead"), false, "carried away and named on the bulkhead");
  // The speaker asks, once, to say their names.
  const holds = () => conditionHolds(game, "aftermath dead listed and not flag the_names_said");
  assert.equal(holds(), true);
  storyRequest(game, { request: "the_dead", reason: "The test" });
  assert.match(ask(game, "halm"), /They'd like to hear them said, by you/);
  const morale = game.ship.morale;
  answer(game, "Say their names");
  assert.equal(game.ship.morale, morale + 3);
  assert.equal(holds(), false);
});

test("an officer laid up leaves their post empty, and the first officer asks to give it to the best fit, for good", () => {
  const game = newGame(55);
  quickBattle(game);
  const holder = holderKey(game, SHIP, "comms_officer");
  assert.ok(holder);
  assert.deepEqual(emptyPosts(game, SHIP), []);
  // Laid up on the medbay's floor.
  const now = game.clock.hours;
  game.down = { ...(game.down ?? {}), [keyAt(SHIP, holder)]: { who: holder, place: SHIP, level: "deck2", x: 0, y: 0, since: now, until: now + 72, why: "laid up", bed: "@medbay" } };
  assert.deepEqual(emptyPosts(game, SHIP), ["comms_officer"]);
  const deputy = deputyFor(game, SHIP, "comms_officer");
  assert.ok(deputy && deputy !== holder);
  assert.deepEqual(troublesOf(game, "a post left empty", SHIP), [{ asker: null, about: holder, post: "comms_officer" }]);
  storyRequest(game, { request: "empty_post", reason: "The test" });
  const said = ask(game, "voss");
  assert.match(said, /laid up, Captain, and nobody's doing the work of the comms officer\./);
  answer(game, "Give it to");
  assert.equal(holderKey(game, SHIP, "comms_officer"), deputy);
  assert.deepEqual(emptyPosts(game, SHIP), []);
});

test("the words: ? aftermath, * prisoners, * mend first, * morale, yes_ answers, and the battle's list line", () => {
  // The battle's file turns the list on, by its name.
  const { battle } = parseBattleText(fs.readFileSync(path.join(BATTLES_DIR, "mutiny.txt"), "utf8"), "mutiny");
  assert.equal(battle.list, "After the mutiny");
  // Conditions, and what's wrong with them.
  const game = newGame(56);
  game.aftermath = { quest: "after_test", items: [{ id: "fire", done: null }, { id: "nav", done: 3 }] };
  const holds = (text) => conditionHolds(game, text);
  assert.deepEqual(["aftermath", "aftermath fire", "aftermath fire done", "aftermath nav", "aftermath nav done", "aftermath nav listed", "aftermath dead", "aftermath dead listed", "aftermath repairs"].map(holds), [true, true, false, false, true, true, false, false, false]);
  game.aftermath.done = 5;
  assert.equal(holds("aftermath"), false);
  assert.match(parseCondition("aftermath toaster").problems[0], /"aftermath" is followed by nothing, or one of fire, fallen/);
  assert.match(parseCondition("aftermath fire maybe").problems[0], /is followed by open, done or listed/);
  // Effects, and what's wrong with them.
  assert.deepEqual(parseEffect("prisoners ashore: The reason").do, { command: "prisoners", fate: "ashore", reason: "The reason" });
  assert.match(parseEffect("prisoners sideways: x").problem, /prisoners is written \* prisoners and one of locked, work or ashore/);
  assert.deepEqual(parseEffect("mend first navigation and comms: The reason").do, { command: "mend", first: "navigation and comms", reason: "The reason" });
  assert.match(parseEffect("mend navigation: x").problem, /mend is written \* mend first/);
  assert.deepEqual(parseEffect("morale -2: The reason").do, { tool: "change_ship", hull: 0, fuel: 0, morale: -2, reason: "The reason" });
  // Every scene file reads, the four asks among them, with their yes_ answers.
  assert.deepEqual(allSceneProblems().problems, []);
  // * mend first by a room's name, and nothing to put first.
  const ship = newGame(57);
  for (const id of ["power:junction_box:names", "navigation:nav_core:bridge", "comms:relay:bridge"]) damagePart(ship, SHIP, id, "broken", { by: "battle" });
  ["power:junction_box:names", "navigation:nav_core:bridge", "comms:relay:bridge"].forEach((id, k) => { ship.systems[SHIP].parts[id].fixAt = ship.clock.hours + k + 1; });
  assert.deepEqual(mendFirst(ship, SHIP, "The Bridge"), ["[SYSTEMS] The engineers will mend the nav core and the relay first."]);
  assert.deepEqual(["navigation:nav_core:bridge", "comms:relay:bridge", "power:junction_box:names"].map((id) => ship.systems[SHIP].parts[id].fixAt - ship.clock.hours), [1, 2, 3]);
  assert.match(mendFirst(ship, SHIP, "cameras")[0], /Nothing of that is waiting to be mended/);
});
