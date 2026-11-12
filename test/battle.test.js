// Battles (src/battles.js, world/battles): a fight fought by everyone on a deck at once, in the room. The mutiny that
// opens the game is one: who fights it and who takes cover, where the other side comes in and when help comes, the
// limit of four on a side lifted for it alone, how it ends, and the story going on from there.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-battle-"));
process.env.GAME_DATA_DIR = dataDir;

const { parseBattleText, writeBattleText } = await import("../public/battle-text.js");
const { BATTLES_DIR, allBattleProblems, battleOf, battleProblems, startBattle } = await import("../src/battles.js");
const { combatView, startCombat } = await import("../src/combat.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { BATTLE_SIGHT, liveOrder, liveTick, liveView } = await import("../src/live-fight.js");
const { publicState } = await import("../src/rules.js");
const { parseSceneText } = await import("../src/scene-text.js");
const { loadScenes, sceneProblems, writtenTurn } = await import("../src/scenes.js");

const newGame = (seed = 21, archetype = "officer") => createGameFromDraft(randomDraft({ seed, archetype }));
// One turn of the written story, with what it says kept in order.
function play(game, args) {
  const said = [];
  writtenTurn({ game, emit: (e) => { if (e.type !== "state") said.push(e); }, log: (role, text) => game.transcript.push({ role, text }), ...args });
  for (const one of said) game.transcript.push({ role: one.type === "text" ? "narrator" : "notice", text: one.text });
  return said;
}
// The game's opening, played as far as the battle.
function toTheBattle(game, words = "Hold the bridge") {
  play(game, { event: "start" });
  play(game, { playerText: words });
  assert.ok(game.combat?.battle, "the battle has begun");
  return game.combat;
}
// The nearest of the other side the player can hit from where they stand.
function nearestSeen(game) {
  const view = liveView(game);
  let best = null;
  for (const enemy of game.combat.enemies) {
    const spot = view.fighters[enemy.key];
    if (enemy.hp <= 0 || enemy.out || !spot || !view.sight[enemy.key]?.ok) continue;
    const far = Math.hypot((spot.x - view.you.x) * 0.5, spot.y - view.you.y);
    if (!best || far < best.far) best = { key: enemy.key, far };
  }
  return best?.key ?? null;
}
// Fights it out, the player going for the nearest of them, half a second at a time, and says how it ended.
function fightItOut(game, { playerFights = true, limit = 1200 } = {}) {
  for (let i = 0; i < limit; i += 1) {
    if (playerFights && game.hp > 0) {
      const target = nearestSeen(game);
      if (target && target !== game.combat.live.you.target) liveOrder(game, { type: "attack", target });
    }
    const reply = liveTick(game, { ms: 500 });
    if (reply.over) return reply;
  }
  assert.fail("The battle never ended.");
}

// ---- The file ------------------------------------------------------------------------------------------------------

test("the opening's battle reads without a problem, writes back the same, and fits the world", () => {
  const text = fs.readFileSync(path.join(BATTLES_DIR, "mutiny.txt"), "utf8");
  const { battle, problems } = parseBattleText(text, "mutiny");
  assert.deepEqual(problems, []);
  assert.equal(writeBattleText(battle), text, "written the way the game writes it");
  assert.equal(battle.title, "The Red Cloth");
  assert.deepEqual({ place: battle.place, deck: battle.deck, target: battle.target, giveUp: battle.giveUp, crewAs: battle.crewAs, cover: battle.cover },
    { place: "meridian", deck: "deck1", target: "The Bridge", giveUp: { of: 2, in: 3 }, crewAs: "ship_hand", cover: "The Quiet Room" });
  assert.deepEqual(battle.against.map((one) => [one.count, one.enemy, one.how, one.room, one.after]), [[6, "mutineer_crew", "up", "The Upper Forward Stair", 0], [6, "mutineer_crew", "up", "The Upper Aft Stair", 12]]);
  assert.deepEqual(battle.with.map((one) => (one.everyone ? "everyone" : `${one.who}@${one.after}`)), ["everyone", "tarrow@30", "the guards@30", "the ensigns@30"]);
  assert.deepEqual(battleProblems(battle), []);
  assert.deepEqual(allBattleProblems(), { count: 1, problems: [] });
});

test("what's wrong in a battle's file is said in plain words, with the line", () => {
  const { battle, problems } = parseBattleText(`The Wrong One
place: nowhere
deck:
they give up: sometimes
colour: red

Against you:
- six mutineers, from the sky
- 3 mutineer_crew, up The Bridge, 5 seconds in

With you:
- nobody at all
`, "wrong");
  const lines = Object.fromEntries(problems.map((one) => [one.line, one.message]));
  assert.match(lines[1], /starts with its title/);
  assert.match(lines[3], /deck: needs something after the colon/);
  assert.match(lines[4], /they give up: is written "when 2 in 3/);
  assert.match(lines[5], /before Against you: and With you:, a line is one of/);
  assert.match(lines[8], /a line under Against you: is written/);
  assert.match(lines[12], /a line under With you: is either/);
  // What doesn't fit the world: the place, the deck, the rooms, the enemies, the people and the jobs.
  const world = battleProblems({ ...battle, place: "meridian", deck: "deck9", target: "The Moon", against: [{ line: 9, count: 3, enemy: "pony", how: "up", room: "The Bridge", after: 5 }], with: [{ line: 13, who: "nobody special", how: "up", room: "The Bridge", after: 0 }] });
  const expect = (pattern) => assert.ok(world.some((one) => pattern.test(one)), `${pattern}\n${world.join("\n")}`);
  expect(/meridian has no deck called deck9\. Its decks are deck1/);
  expect(/at least one group against you has to come at the start/);
  expect(/line 9\): there's no enemy called pony/);
  expect(/line 13\): nobody special isn't someone with a file in world\/characters, or a job/);
  const rooms = battleProblems({ ...battle, place: "meridian", deck: "deck1", target: "The Moon", against: [{ line: 9, count: 3, enemy: "mutineer_crew", how: "up", room: "The Engine Room", after: 0 }], with: [{ line: 13, who: "the ensigns", how: "up", room: "The Bridge", after: 0 }] });
  assert.ok(rooms.some((one) => /they make for: names The Moon, which isn't a room on deck1/.test(one)), rooms.join("\n"));
  assert.ok(rooms.some((one) => /line 9\): up The Engine Room names The Engine Room, which isn't a room on deck1/.test(one)), rooms.join("\n"));
  assert.ok(rooms.some((one) => /line 13\): the ensigns are crew, so the battle needs crew fight as:/.test(one)), rooms.join("\n"));
  assert.match(battleProblems({ ...battle, place: "nowhere" })[0], /there's no place called nowhere/);
});

test("a scene starts a battle with a BATTLE line, and the checker knows what's wrong with one", () => {
  const { scene, problems } = parseSceneText("== start\nThe alarm.\n> Go -> fight\n== fight\nBATTLE mutiny: Boots on the stair.\n  won -> held\n  lost -> woke\n== held\nHeld.\nEND\n== woke\nWoke.\nEND\n", "test");
  assert.deepEqual(problems, []);
  assert.deepEqual(scene.parts.fight.battle, { battle: "mutiny", lead_in: "Boots on the stair." });
  assert.deepEqual([scene.parts.fight.won, scene.parts.fight.lost], ["held", "woke"]);
  assert.deepEqual(sceneProblems(scene, "test"), []);
  const wrong = parseSceneText("== start\nBATTLE nothing_here\n  fled -> start\n  allies: voss\n", "wrong");
  assert.ok(wrong.problems.some((one) => /a BATTLE ends won, lost or talked, not fled/.test(one.message)), JSON.stringify(wrong.problems));
  assert.ok(wrong.problems.some((one) => /a BATTLE has nothing but its endings under it/.test(one.message)), JSON.stringify(wrong.problems));
  const checked = sceneProblems(wrong.scene, "wrong");
  assert.ok(checked.some((one) => /the battle there's no battle called nothing_here in world\/battles/.test(one)), checked.join("\n"));
  assert.ok(checked.some((one) => /has a battle, so it needs won and lost/.test(one)), checked.join("\n"));
  assert.ok(sceneProblems(parseSceneText("== start\nBATTLE mutiny\n  won -> start\n  lost -> start\n").scene, "talk_test", { talk: true }).some((one) => /has a battle, and a conversation can't open one/.test(one)));
  // The game's own opening starts the mutiny.
  const opening = loadScenes().scenes.opening_captain;
  assert.equal(opening.parts.battle.battle.battle, "mutiny");
  assert.deepEqual(sceneProblems(opening, "opening_captain"), []);
});

// ---- Who fights it --------------------------------------------------------------------------------------------------

test("the mutiny: everyone on the deck who can fight is in it, the rest take cover, and the other side comes up the stairs", () => {
  const game = newGame();
  const c = toTheBattle(game);
  assert.equal(c.battle.title, "The Red Cloth");
  assert.ok(c.live, "it's fought in the room from the start");
  // With the player: the bridge's four officers, Father Roe, and Deckhand Kofi as a ship's hand, with his own body.
  const names = c.allies.map((one) => one.name);
  for (const name of ["Commander Ilya Voss", "Ensign Pell Asante", "Lieutenant Iven Sorel", "Ensign Lira Vey", "Father Bastian Roe", "Deckhand Kofi"]) assert.ok(names.includes(name), `${name} isn't in it: ${names.join(", ")}`);
  const kofi = c.allies.find((one) => one.name === "Deckhand Kofi");
  assert.equal(kofi.prose, "Deckhand Kofi");
  assert.equal(kofi.person, "Deckhand Kofi", "the room draws him once, as a fighter");
  assert.equal(kofi.body.who, "Deckhand Kofi", "the wounds he takes stay with him");
  assert.ok(c.allies.filter((one) => one.holds).map((one) => one.id).sort().join() === "iven,lira,pell,voss", "the bridge crew hold the bridge");
  // The spare hands in the corridor take cover in the Quiet Room.
  const people = publicState(game).walk.people;
  for (const name of ["Yusuf", "Teo", "Petra"]) assert.equal(people.find((one) => one.key === name)?.room, "quiet", `${name} took cover`);
  // Six come up the forward stair at once; six more up the aft stair, and help from below, come later.
  assert.equal(c.enemies.length, 6);
  for (const enemy of c.enemies) assert.equal(enemy.live && Math.round(enemy.live.y) >= 19 && Math.round(enemy.live.x) >= 70 && Math.round(enemy.live.x) <= 77, true, `${enemy.name} came up the forward stair`);
  assert.equal(c.arrivals.filter((one) => one.side === "enemy").length, 6);
  assert.deepEqual(c.arrivals.filter((one) => one.side === "ally").map((one) => one.extra?.prose ?? one.source.id).sort(), ["Ensign Mirela", "Ensign Nadia", "Ensign Tadeo", "tarrow"], "Tarrow and the ensigns, and no guards, since nobody's doing that job");
  assert.equal(c.battle.total, 12);
  // There's no running from it, and no giving up in it.
  const view = combatView(game);
  assert.ok(!view.actions.some((one) => ["flee", "surrender", "cover"].includes(one.action.type)), view.actions.map((one) => one.label).join(", "));
  assert.throws(() => liveOrder(game, { type: "flee" }), /nowhere to run to/);
  assert.throws(() => liveOrder(game, { type: "surrender" }), /Not while your people are fighting/);
  assert.equal(view.battle.title, "The Red Cloth");
  // The limit of four on a side holds for every other fight.
  const other = newGame(22);
  assert.throws(() => startCombat(other, "dock_thug", { followers: ["dock_thug", "dock_thug", "dock_thug", "dock_thug"] }), /at most 4 fighters/);
});

test("the other side comes up when the file says, with a line for each group that comes, and help comes up from below", () => {
  const game = newGame(23);
  const c = toTheBattle(game);
  const lines = [];
  for (let i = 0; i < 70 && game.combat; i += 1) {
    const reply = liveTick(game, { ms: 500 });
    lines.push(...reply.events.filter((one) => one.battle).map((one) => `${Math.round(c.live.t)}:${one.text}`));
    if (reply.over) break;
  }
  const at = (pattern) => lines.find((one) => pattern.test(one));
  assert.ok(at(/^12:More of them come up the aft stair/), lines.join("\n"));
  if (game.combat) {
    assert.ok(at(/^30:Lieutenant Tarrow comes up the aft stair/), lines.join("\n"));
    assert.ok(at(/^30:The ensigns come up the forward stair/), lines.join("\n"));
    assert.ok(!at(/The guards come up/), "nobody's doing the guards' job, so nobody comes, and it isn't said");
    const tarrow = game.combat.allies.find((one) => one.id === "tarrow");
    assert.ok(tarrow?.live, "Tarrow is in it");
  }
  assert.equal(lines.filter((one) => /More of them/.test(one)).length, 1, "each line once");
});

// ---- How it ends ------------------------------------------------------------------------------------------------------

test("fought out, it ends, the record keeps how, the fallen lie where they fell, and the story goes on", () => {
  const started = performance.now();
  const game = newGame(24);
  toTheBattle(game);
  const outcome = fightItOut(game);
  assert.ok(performance.now() - started < 20000, "a whole battle doesn't take long to work out");
  assert.ok(["victory", "talked", "defeat"].includes(outcome.result), outcome.result);
  assert.equal(outcome.battle, "The Red Cloth");
  assert.match(outcome.summary, /The Red Cloth/);
  const record = game.battles.mutiny;
  assert.equal(record.total, 12);
  assert.equal(record.down + record.gaveUp + record.talked, 12, JSON.stringify(record));
  assert.equal(record.youDown, outcome.result === "defeat");
  // Whoever went down on the player's side and has a day aboard lies where they fell, and no two on one square.
  const lying = Object.values(game.down ?? {}).filter((one) => one.level === "deck1");
  assert.equal(new Set(lying.map((one) => `${one.x},${one.y}`)).size, lying.length, "nobody lies on top of anyone");
  // With no time gone by, every one of them is still lying on the deck: everyone on the player's side has a day aboard.
  if (outcome.result !== "defeat") assert.equal(lying.length, record.fallen.length, `${record.fallen.join(", ")} went down, and ${lying.length} lie on the deck`);
  // The story goes on from how it ended.
  assert.equal(publicState(game).storyWaiting, true);
  const said = play(game, { event: "continue" });
  assert.match(said[0].text, outcome.result === "defeat" ? /You come back slowly/ : /The last sidearm clatters/);
  assert.equal(game.scene, null);
  assert.ok(game.transcript.length > 2);
});

test("when two in three of them are out of it, the rest give up, and those still to come don't", () => {
  const game = newGame(25);
  const c = toTheBattle(game);
  // The six who came up first, down at once: it isn't over, since six more are still to come up the aft stair.
  for (const enemy of c.enemies) enemy.hp = 0;
  let downed = false;
  const outcome = (() => {
    for (let i = 0; i < 60; i += 1) {
      const reply = liveTick(game, { ms: 500 });
      if (reply.over) return reply;
      // The second group has come: two more of them down makes eight of the twelve.
      if (!downed && c.enemies.length === 12) {
        assert.ok(game.combat, "it went on until they came");
        for (const enemy of c.enemies.filter((one) => one.hp > 0).slice(0, 2)) enemy.hp = 0;
        downed = true;
      }
    }
    return null;
  })();
  assert.ok(downed, "the second group came up");
  assert.ok(outcome, "it ended");
  assert.equal(outcome.result, "victory");
  const record = game.battles.mutiny;
  assert.equal(record.down, 8, JSON.stringify(record));
  assert.equal(record.gaveUp, 4, "the four still standing gave up");
  assert.ok(outcome.events.some((one) => one.battle && /throw their sidearms down/.test(one.text)));
});

test("going down doesn't end it: it's fought out without you, whoever's left gives up, and you come to in the medbay", () => {
  const game = newGame(26);
  const c = toTheBattle(game);
  liveTick(game, { ms: 500 });
  // A blow the player can't stand up from: the next one that lands puts them down.
  game.hp = 1;
  for (const enemy of c.enemies) enemy.attack = 40;
  const outcome = fightItOut(game, { playerFights: false });
  assert.equal(outcome.result, "defeat");
  assert.match(outcome.summary, /^You went down in The Red Cloth, and it was fought out without you/);
  assert.match(outcome.summary, /You came to in the medbay\./);
  const record = game.battles.mutiny;
  assert.equal(record.youDown, true);
  assert.equal(record.down + record.gaveUp + record.talked, 12, "every one of them is down or gave up in the end");
  assert.ok(outcome.events.some((one) => /The fight goes on without you/.test(one.text ?? "")));
  assert.ok(game.hp >= 1);
  assert.equal(publicState(game).walk.here.id, "medbay");
  const said = play(game, { event: "continue" });
  assert.match(said[0].text, /You come back slowly/);
});

test("in a battle nobody shoots from further than the battle's sight, and the player out of reach walks to where they can reach", () => {
  const game = newGame(27);
  const c = toTheBattle(game);
  const view = liveView(game);
  for (const enemy of c.enemies) {
    const spot = view.fighters[enemy.key];
    const far = Math.hypot((spot.x - view.you.x) * 0.5, spot.y - view.you.y);
    if (far > BATTLE_SIGHT) assert.equal(view.sight[enemy.key].ok, false, "too far to shoot");
  }
  // Going for one of them on the far side of the deck: the player sets off towards them.
  const far = c.enemies[0];
  liveOrder(game, { type: "attack", target: far.key });
  const from = { x: c.live.you.x, y: c.live.you.y };
  for (let i = 0; i < 6; i += 1) liveTick(game, { ms: 500 });
  if (game.combat && game.hp > 0) assert.ok(Math.hypot((c.live.you.x - from.x) * 0.5, c.live.you.y - from.y) > 1, "the player walked towards them");
});

test("a battle saved while it's being fought goes on where it was, and a fresh game can't start a battle that isn't there", () => {
  const game = newGame(28);
  toTheBattle(game);
  for (let i = 0; i < 10; i += 1) liveTick(game, { ms: 500 });
  const saved = JSON.parse(JSON.stringify(game));
  assert.ok(saved.combat.battle && saved.combat.live);
  const reply = liveTick(saved, { ms: 500 });
  assert.equal(typeof reply.over, "boolean", "the saved battle goes on");
  assert.throws(() => startBattle(newGame(29), "no_such_battle"), /There's no battle called no_such_battle/);
  assert.equal(battleOf("no_such_battle"), null);
  const busy = newGame(30);
  startCombat(busy, "dock_thug");
  assert.throws(() => startBattle(busy, "mutiny"), /already underway/);
});
