// A fight in the room, in real time: everyone stands somewhere in the room, walks, shoots along a line of fire or closes
// in to hit, takes cover behind what's in the way, and acts again once they're ready. The page says how much time has
// gone by, so nothing happens while it's stopped. The rules of a fight are still src/combat.js's. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-live-fight-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { combatAction, publicState, startCombat } = await import("../src/rules.js");
const live = await import("../src/live-fight.js");
const { walkView, walkCommand } = await import("../src/walk.js");
const { FURNITURE_BY_ID, squaresOf } = await import("../public/furniture.js");

const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
// Three mutineers, and Voss beside the player, on the bridge.
function mutiny(game, { allies = ["voss"] } = {}) {
  startCombat(game, "mutineer", { followers: ["mutineer", "mutineer"], allies });
  live.goLive(game);
  return game.combat;
}
// Time going by, a twentieth of a second at a time over many asks, until it's over or the time's up.
function run(game, seconds, { orders = () => {}, step = 150 } = {}) {
  let outcome = { over: false, events: [] };
  const said = [];
  for (let t = 0; t < seconds * 1000 && !outcome.over; t += step) {
    orders();
    outcome = live.liveTick(game, { ms: step });
    said.push(...outcome.events);
  }
  return { outcome, said };
}
const view = (game) => publicState(game).combat;
// Going for whoever the player can hit from where they stand.
const shootWhoeverCanBeSeen = (game) => () => {
  const v = live.liveView(game);
  if (!v) return;
  const seen = Object.entries(v.sight).find(([, s]) => s.ok);
  if (seen && v.you.target !== seen[0]) live.liveOrder(game, { type: "attack", target: seen[0] });
};

test("a fight moves into the room: the player where they stand, someone there where they are, the rest by the door", () => {
  const game = newGame();
  const here = walkView(game);
  const voss = here.people.find((one) => one.key === "voss");
  const c = mutiny(game);
  assert.deepEqual({ x: c.live.you.x, y: c.live.you.y }, here.captain);
  assert.equal(c.allies[0].person, "voss");
  assert.deepEqual({ x: c.allies[0].live.x, y: c.allies[0].live.y }, { x: voss.x, y: voss.y });
  // The bridge's way in is its door to the Names Bulkhead, at the far end from the player.
  for (const enemy of c.enemies) assert.ok(enemy.live.x >= 40 && enemy.live.x <= 45, `${enemy.key} at ${enemy.live.x},${enemy.live.y}`);
  assert.equal(new Set(c.enemies.map((enemy) => `${enemy.live.x},${enemy.live.y}`)).size, 3, "nobody stands on anybody");
  const v = view(game);
  assert.ok(v.live, "the page is told where everyone is");
  assert.deepEqual(Object.keys(v.live.fighters).sort(), [...c.allies, ...c.enemies].map((one) => one.key).sort());
  assert.ok(!v.actions.some((one) => one.action.type === "cover"), "in the room, cover is standing behind something");
  assert.ok(v.actions.some((one) => one.action.type === "flee"), "Run for it is still there");
});

test("someone attacked in the room fights from where they stand, and is drawn once", () => {
  const game = newGame();
  const pell = walkView(game).people.find((one) => one.key === "pell");
  walkCommand(game, { action: "attack", key: "person:pell" });
  live.goLive(game);
  const enemy = game.combat.enemies[0];
  assert.equal(enemy.person, "pell");
  assert.deepEqual({ x: enemy.live.x, y: enemy.live.y }, { x: pell.x, y: pell.y });
  assert.equal(view(game).live.fighters[enemy.key].person, "pell");
});

test("a simulation stays in its window, and so does a fight already played in rounds", () => {
  const game = newGame();
  startCombat(game, "dock_thug", { training: true });
  assert.throws(() => live.goLive(game), /simulated fight stays in its window/);
  game.combat = null;
  startCombat(game, "dock_thug");
  game.hp = 1000;
  combatAction(game, { type: "attack" });
  if (game.combat) assert.throws(() => live.goLive(game), /already under way in its window/);
});

test("nothing happens until time goes by, and then everyone acts once they're ready", () => {
  const game = newGame();
  const c = mutiny(game);
  const before = JSON.stringify([game.hp, c.enemies.map((one) => [one.hp, one.live.x, one.live.y])]);
  live.liveOrder(game, { type: "attack", target: c.enemies[0].key });
  assert.equal(JSON.stringify([game.hp, c.enemies.map((one) => [one.hp, one.live.x, one.live.y])]), before, "an order alone does nothing");
  assert.equal(c.live.you.target, c.enemies[0].key);
  game.hp = 1000;
  const { said } = run(game, 4);
  assert.ok(said.some((event) => event.by === "you"), "the player fired");
  assert.ok(said.some((event) => event.by?.startsWith("e")), "they fired back");
  assert.ok(said.some((event) => event.by === c.allies[0].key), "Voss fought by herself");
  assert.ok(c.live.t > 3.9 && c.live.t < 4.1, `${c.live.t} seconds went by`);
  // Each acts again only once they're ready: the player about every 2.6 seconds.
  const yours = said.filter((event) => event.by === "you" && (event.damage || event.missed)).length;
  assert.ok(yours >= 1 && yours <= 2, `${yours} shots in four seconds`);
});

test("one ask moves the fight on half a second at most, so a slow page skips nothing", () => {
  const game = newGame();
  const c = mutiny(game);
  live.liveTick(game, { ms: 5000 });
  assert.ok(Math.abs(c.live.t - 0.5) < 1e-6, String(c.live.t));
});

test("a fight in the room plays out to its end, with the ending src/combat.js gives", () => {
  let won = 0;
  for (let seed = 1; seed <= 6; seed += 1) {
    const game = newGame();
    const c = mutiny(game);
    for (const enemy of c.enemies) enemy.hp = 6;
    game.hp = 300;
    const { outcome } = run(game, 120, { orders: shootWhoeverCanBeSeen(game) });
    assert.ok(outcome.over, `fight ${seed} ended`);
    assert.equal(game.combat, null);
    assert.ok(outcome.summary, "with a summary for the story");
    if (outcome.result === "victory") won += 1;
  }
  assert.ok(won >= 5, `${won} of 6 won against weakened mutineers`);
});

test("the player walks where they're sent, and stays where the fight ended", () => {
  const game = newGame();
  const c = mutiny(game);
  for (const enemy of c.enemies) enemy.hp = 4;
  game.hp = 300;
  const start = { x: c.live.you.x, y: c.live.you.y };
  // Somewhere a few squares off that can be stood on, whatever the bridge has standing in it.
  const round = walkView(game).floor;
  const to = [[-4, 1], [4, 2], [3, -2], [-3, -2], [2, 3], [-2, 3]].map(([dx, dy]) => ({ x: start.x + dx, y: start.y + dy })).find((one) => round[one.y]?.[one.x] === ".");
  live.liveOrder(game, { type: "move", x: to.x, y: to.y });
  assert.ok(c.live.you.path.length > 0);
  assert.deepEqual(live.liveView(game).you.to, to);
  run(game, 3);
  assert.deepEqual({ x: c.live.you.x, y: c.live.you.y }, to);
  const { outcome } = run(game, 120, { orders: shootWhoeverCanBeSeen(game) });
  assert.ok(outcome.over);
  // Wherever the fight took them, they're standing there in the room afterwards.
  assert.deepEqual(walkView(game).captain, { x: Math.round(c.live.you.x), y: Math.round(c.live.you.y) });
  assert.throws(() => live.liveOrder(game, { type: "move", x: 1, y: 1 }), /no fight/i);
});

test("walls stop shots, and what's lower is cover, worth 3 to defense", () => {
  const game = newGame();
  const c = mutiny(game);
  const v = live.liveView(game);
  for (const key of Object.keys(v.sight)) assert.ok("ok" in v.sight[key] && "cover" in v.sight[key]);
  // Someone the other side of the bridge's wall can't be shot at.
  const enemy = c.enemies[0];
  enemy.live.x = 50;
  enemy.live.y = 6;
  const sight = live.liveView(game).sight[enemy.key];
  assert.equal(sight.ok, false);
  assert.equal(sight.why, "no line of fire");
  // Someone just beyond something low on the player's own row is in cover from them: the far side of the nearest
  // piece of furniture that's in the way and has floor behind it.
  const you = live.liveView(game).you;
  const room = walkView(game);
  const low = room.furniture.filter((piece) => FURNITURE_BY_ID[piece.kind].blocks && !FURNITURE_BY_ID[piece.kind].wall).flatMap((piece) => squaresOf(piece)).filter(([, y]) => y === Math.round(you.y)).map(([x]) => x);
  const beyond = low.map((x) => x + Math.sign(x - you.x)).filter((x) => room.floor[Math.round(you.y)]?.[x] === ".").sort((a, b) => Math.abs(a - you.x) - Math.abs(b - you.x))[0];
  assert.ok(Number.isInteger(beyond), "something low stands on the player's row, with floor beyond it");
  enemy.live.x = beyond;
  enemy.live.y = Math.round(you.y);
  const behind = live.liveView(game).sight[enemy.key];
  assert.equal(behind.ok, true);
  assert.equal(behind.cover, true);
});

test("someone who fights up close walks up to hit, and can't from across the room", () => {
  const game = newGame();
  startCombat(game, "dock_thug");
  live.goLive(game);
  const c = game.combat;
  assert.equal(c.enemies[0].live.reach, "melee");
  assert.equal(live.reachOf({ weapon: "Concord Sidearm" }), "range");
  assert.equal(live.reachOf({ weapon: "Boarding Axe" }), "melee");
  assert.equal(live.reachOf({ weapon: "Cargo Claws" }), "melee");
  assert.equal(live.reachOf({ weapon: "Resonant Fire" }), "range");
  game.hp = 300;
  const start = { ...c.enemies[0].live };
  const far = Math.hypot((start.x - c.live.you.x) * 0.5, start.y - c.live.you.y);
  assert.ok(far > live.REACH);
  const { said } = run(game, 10);
  const close = Math.hypot((c.enemies[0].live.x - c.live.you.x) * 0.5, c.enemies[0].live.y - c.live.you.y);
  assert.ok(close <= live.REACH + 0.01, `the thug got to ${close} tiles away`);
  assert.ok(said.some((event) => event.by === c.enemies[0].key && (event.damage || event.missed)), "and swung");
});

test("it can stop the moment the player's ready, and goes on from there", () => {
  const game = newGame();
  const c = mutiny(game);
  game.hp = 300;
  live.liveOrder(game, { type: "attack", target: c.enemies[0].key });
  // Ready at the start: it stops before the first shot.
  let outcome = live.liveTick(game, { ms: 150, stopWhenReady: true });
  assert.equal(outcome.ready, true);
  assert.ok(!outcome.events.some((event) => event.by === "you"));
  // Asked again, the player acts.
  outcome = live.liveTick(game, { ms: 150, stopWhenReady: true });
  assert.ok(outcome.events.some((event) => event.by === "you"), "the shot comes on the next ask");
  assert.ok(c.live.you.cool > 0);
  // And it stops again the next time they're ready.
  let stopped = false;
  for (let i = 0; i < 40 && !stopped; i += 1) stopped = Boolean(live.liveTick(game, { ms: 150, stopWhenReady: true }).ready);
  assert.ok(stopped, "it stopped once the player was ready again");
});

test("an order for something else waits for the player to be ready, and an ability or the belt is used then", () => {
  const game = newGame();
  const c = mutiny(game);
  game.hp = 20;
  const before = game.hp;
  const belt = view(game).actions.find((one) => one.action.type === "item");
  assert.ok(belt, "something on the belt");
  live.liveOrder(game, belt.action);
  assert.deepEqual(c.live.you.queued, belt.action);
  const { said } = run(game, 0.3);
  assert.equal(c.live.you.queued, null);
  assert.ok(said.some((event) => event.by === "you" && event.gained), "it was used");
  assert.ok(game.hp >= before);
  assert.throws(() => live.liveOrder(game, { type: "cover" }), /cover is standing behind something/);
  assert.throws(() => live.liveOrder(game, { type: "attack", target: "nobody" }), /not in the fight/);
});

test("giving up and running end it, as in rounds", () => {
  const game = newGame();
  mutiny(game);
  live.liveOrder(game, { type: "surrender" });
  const { outcome } = run(game, 1);
  assert.equal(outcome.result, "surrendered");
  const runner = newGame();
  // They can't hit, so being shot at for a long time doesn't knock the player out with stress before they get away.
  for (const enemy of mutiny(runner).enemies) enemy.attack = -40;
  runner.hp = 1000;
  let fled = null;
  for (let i = 0; i < 60 && !fled; i += 1) {
    live.liveOrder(runner, { type: "flee" });
    const { outcome: done } = run(runner, 3);
    if (done.over) fled = done.result;
  }
  assert.ok(["fled", "victory"].includes(fled), String(fled));
});

test("people due partway through come in by the door when their round comes", () => {
  const game = newGame();
  startCombat(game, "mutineer", { arrivals: [{ who: "mutineer", side: "enemy", round: 2 }] });
  live.goLive(game);
  const c = game.combat;
  game.hp = 1000;
  for (const enemy of c.enemies) enemy.hp = 1000;
  assert.equal(c.enemies.length, 1);
  const { said } = run(game, live.ROUND_SECONDS - 0.5);
  assert.equal(c.enemies.length, 1, "not before their round");
  const more = run(game, 1);
  assert.equal(c.enemies.length, 2);
  assert.ok(c.enemies[1].live, "placed in the room");
  assert.ok(more.said.some((event) => event.joined === "enemy"));
  void said;
});

test("rounds can't be played in a fight that's in the room", () => {
  const game = newGame();
  mutiny(game);
  assert.throws(() => combatAction(game, { type: "attack" }), /happening in the room/);
});
