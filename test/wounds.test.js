// Fights land on the body (health step 2): every hit lands on a part at random and says where, hard hits leave wounds by
// what they were with, wounds count in the fight (a broken arm hits worse, a broken leg can't run or walk in the room),
// nobody dies, the wounds stay afterwards on whoever's body is kept and go when their time comes, losing leaves the
// wounds the hits left, and a simulated fight changes nothing.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-wounds-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const body = await import("../src/body.js");
const { combatAction, passTime, publicState, startCombat } = await import("../src/rules.js");
const { combatProfile } = await import("../src/combat.js");
const { attackPerson } = await import("../src/deeds.js");
const { migrateGame } = await import("../src/migrate.js");
const live = await import("../src/live-fight.js");
const health = await import("../public/health-text.js");

const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const wound = (name, part) => body.newWound(body.kindOf(name.replace(/ /g, "_"), part), part);
// Attacks until it's over, with the player kept on their feet if asked.
function fightOut(game, { keepUp = true, most = 400 } = {}) {
  let outcome;
  const events = [];
  let rounds = 0;
  do {
    if (keepUp) game.hp = Math.max(game.hp, 999);
    outcome = combatAction(game, { type: "attack" });
    events.push(...outcome.events);
    rounds += 1;
  } while (!outcome.over && rounds < most);
  return { outcome, events };
}

test("weapons make their kind of hit, and a hit leaves a wound by how much of their health it took", () => {
  assert.equal(body.weaponKind("Concord Sidearm"), "shot");
  assert.equal(body.weaponKind("Plasma Cutter"), "burn");
  assert.equal(body.weaponKind("Combat Knife"), "blade");
  assert.equal(body.weaponKind("your bare hands"), "blunt");
  const human = { species: "human" };
  const hit = (options) => body.landHit(human, { maxHp: 100, roll: () => 0.5, ...options });
  assert.ok(health.PARTS.includes(hit({ damage: 5 }).part), "every hit lands somewhere");
  assert.equal(hit({ weapon: "Stun Baton", damage: 10 }).wound, null, "a light hit leaves nothing");
  assert.equal(hit({ weapon: "Stun Baton", damage: 25 }).wound.kind, "bruise");
  assert.equal(hit({ weapon: "Combat Knife", damage: 25 }).wound.kind, "cut");
  assert.equal(hit({ weapon: "Combat Knife", damage: 45 }).wound.kind, "deep_cut");
  assert.equal(hit({ weapon: "Combat Knife", damage: 5, critical: true }).wound.kind, "deep_cut", "a hard hit always leaves a hard wound");
  assert.equal(hit({ weapon: "Plasma Cutter", damage: 45 }).wound.kind, "deep_burn");
  // Blunt hits break what they land on: a bone in a limb, ribs, the head; and the one that drops them to the head knocks them out.
  const onHead = () => 0.01;
  assert.equal(body.landHit(human, { weapon: "Stun Baton", damage: 45, maxHp: 100, roll: onHead }).wound.kind, "concussion");
  assert.equal(body.landHit(human, { weapon: "Stun Baton", damage: 5, maxHp: 100, down: true, roll: onHead }).wound.kind, "knock");
  const limb = body.landHit(human, { weapon: "Stun Baton", damage: 45, maxHp: 100, roll: () => 0.99 });
  assert.equal(limb.part, "left_leg");
  assert.equal(limb.wound.kind, "broken_bone");
  assert.equal(limb.wound.words, "a broken left leg");
  // Synthetics have their own, and a machine has no body at all.
  assert.match(body.landHit({ species: "synthetic" }, { weapon: "Combat Knife", damage: 45, maxHp: 100 }).wound.kind, /ruined_joint|cracked_casing/);
  assert.equal(body.landHit(null, { damage: 50 }), null);
  // The file's lines say what's wrong with them.
  assert.match(health.readHitLine("blade cut deep").problem, /each one is written/);
  assert.match(health.readHitLine("blade: cut; hard: deep cut on an elbow").problem, /isn't a part/);
  assert.match(health.readShare("a fifth of their health").problem, /20% of their health/);
});

test("someone beaten from the right-click menu keeps the wounds, and every hit says where it landed", () => {
  const game = newGame();
  // Looked at before the fight, so their body is already made when the wounds come.
  const before = body.bodyOf(game, { name: "Deckhand Rafe", place: "meridian" }).marks.length;
  attackPerson(game, { key: "Deckhand Rafe", id: null, name: "Deckhand Rafe", short: "Rafe" }, { place: "meridian", room: null });
  const enemy = game.combat.enemies[0];
  assert.equal(enemy.body.key, "crowd:meridian:deckhand rafe");
  const { outcome, events } = fightOut(game);
  assert.equal(outcome.result, "victory");
  const landed = events.filter((event) => event.damage && event.by === "you");
  assert.ok(landed.length && landed.every((event) => /damage to the (head|chest|right arm|left arm|right leg|left leg)/.test(event.math)), "the numbers say where each hit landed");
  // The hit that put them down left a wound, and the fight's wounds are on their body now.
  const left = events.filter((event) => event.wound && event.on === enemy.key).map((event) => event.wound);
  assert.ok(left.length >= 1);
  const kept = body.woundsNow(game, "crowd:meridian:deckhand rafe").map((one) => one.words);
  assert.deepEqual(kept.sort(), [...left].sort());
  const shown = body.bodyView(body.bodyOf(game, { name: "Deckhand Rafe", place: "meridian" }));
  assert.equal(shown.marks.length, before + left.length);
  for (const words of left) assert.ok(shown.marks.some((mark) => mark.words.toLowerCase() === words), words);
  const down = events.find((event) => event.down && event.on === enemy.key);
  assert.match(down.math, /out cold|can't stand|can't get up/, "nobody dies: they're down");
});

test("the player keeps the wounds the hits left, losing gives no other, and they heal when their time comes", () => {
  for (let seed = 1; seed < 12; seed += 1) {
    const game = newGame(seed);
    const conditions = game.conditions.length;
    startCombat(game, "choir_hunter");
    const { outcome, events } = fightOut(game, { keepUp: false });
    const mine = events.filter((event) => event.wound && event.on === "you").map((event) => event.wound);
    assert.deepEqual(game.wounds.map((one) => one.words).sort(), [...mine].sort(), `seed ${seed}`);
    if (outcome.result === "defeat") {
      assert.ok(game.wounds.length >= 1, "the hit that put them down left one");
      assert.equal(game.conditions.length, conditions, "and no random wound on top");
      assert.ok(events.some((event) => /^You go down/.test(event.text ?? "")));
    }
  }
  const game = newGame();
  body.addWounds(game, "you", [wound("bruise", "chest"), wound("broken bone", "left_arm")]);
  assert.equal(publicState(game).body.marks.filter((mark) => mark.state === "bad" || mark.state === "hurt").length, 2);
  const notes = passTime(game, 24 * 3);
  assert.deepEqual(game.wounds.map((one) => one.kind), ["broken_bone"], "a bruise is gone in two days, a broken arm isn't");
  assert.ok(notes.some((note) => /Healed: a bruise on the chest/.test(note)));
  passTime(game, 24 * 30);
  assert.equal(game.wounds.length, 0);
});

test("wounds count in a fight: a broken arm hits worse, and a broken leg can't run", () => {
  const game = newGame();
  const before = combatProfile(game).attack;
  body.addWounds(game, "you", [wound("broken bone", "right_arm")]);
  assert.equal(combatProfile(game).attack, before - 2);
  body.addWounds(game, "you", [wound("broken bone", "left_leg")]);
  startCombat(game, "dock_thug");
  const run = publicState(game).combat.actions.find((one) => one.action.type === "flee");
  assert.equal(run.disabled, true);
  assert.match(run.why, /broken left leg/);
  assert.throws(() => combatAction(game, { type: "flee" }), /can't run with a broken left leg/);
  assert.ok(publicState(game).combat.you.wounds.includes("a broken right arm"));
  // An enemy's wounds count against them too.
  const thug = game.combat.enemies[0];
  const attack = publicState(game).combat.enemies[0].attack;
  thug.wounds.push({ ...wound("broken bone", "left_arm"), fresh: true });
  assert.equal(publicState(game).combat.enemies[0].attack, attack - 2);
  assert.ok(publicState(game).combat.enemies[0].wounds.includes("a broken left arm"));
});

test("in the room, a broken leg keeps someone where they are", () => {
  const game = newGame();
  startCombat(game, "mutineer");
  live.goLive(game);
  body.addWounds(game, "you", [wound("broken bone", "right_leg")]);
  assert.throws(() => live.liveOrder(game, { type: "move", x: game.combat.live.you.x + 4, y: game.combat.live.you.y }), /can't walk with a broken right leg/);
  const enemy = game.combat.enemies[0];
  enemy.wounds.push({ ...wound("broken bone", "left_leg"), fresh: true });
  const at = { x: enemy.live.x, y: enemy.live.y };
  for (let i = 0; i < 20; i += 1) {
    game.hp = 999;
    const outcome = live.liveTick(game, { ms: 150 });
    if (outcome.over) break;
  }
  if (game.combat) assert.deepEqual({ x: enemy.live.x, y: enemy.live.y }, at, "the mutineer with a broken leg hasn't moved");
});

test("a simulated fight leaves no wounds behind", () => {
  const game = newGame();
  const before = JSON.stringify({ wounds: game.wounds, bodies: game.bodies });
  startCombat(game, "dock_thug", { training: true, allies: ["voss"] });
  fightOut(game, { keepUp: false });
  assert.equal(JSON.stringify({ wounds: game.wounds, bodies: game.bodies }), before);
});

test("save version 21 keeps the wounds", () => {
  const game = newGame();
  assert.equal(game.version, 21);
  assert.deepEqual([game.wounds, game.bodies], [[], {}]);
  const { wounds: _w, bodies: _b, ...old } = structuredClone(game);
  const migrated = migrateGame({ ...old, version: 20 });
  assert.equal(migrated.version, 21);
  assert.deepEqual([migrated.wounds, migrated.bodies], [[], {}]);
});
