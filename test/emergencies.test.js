// Emergencies in the rooms (the hands-on plan, step 4): a fire that grows, spoils the air, breaks parts and is put out
// by the engineers, by shutting off its air or by hand; a breach that's patched; a brawl that's stopped or isn't.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-emergencies-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const body = await import("../src/body.js");
const em = await import("../src/emergencies.js");
const { countAboard } = await import("../src/logistics.js");
const { addItem, clockRuns, passTime } = await import("../src/rules.js");
const systems = await import("../src/systems.js");
const walk = await import("../src/walk.js");

const newGame = (start = "captain") => {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const inRoom = (game, room) => {
  game.walk = null;
  walk.walkCommand(game, { action: "room", to: room });
};
const toHour = (game, hour) => passTime(game, (((hour - (game.clock.hours % 24)) % 24) + 24) % 24 || 24, "rest");
const acts = (game) => (walk.walkView(game).acts ?? []).map((one) => one.label);
const minutes = (game, n) => passTime(game, n / 60, "active");
// The dice, held still for a test: 0 is always "it happens", just under 1 never.
function withDice(value, run) {
  const real = Math.random;
  Math.random = () => value;
  try { return run(); } finally { Math.random = real; }
}

test("the file reads, a kind with a line missing never happens, and the game's own file is sound", () => {
  const model = em.parseEmergencies([
    "Fire:",
    "- rooms: meridian, The Galley",
    "- starts: now and then",
    "- sparks: 3",
    "Brawl:",
    "- rooms: meridian, The Long Mess",
    "- starts: 1 in 3 sittings, with morale under 40",
    "- lasts: 20 minutes",
    "- stepping in: persuasion against 6",
  ].join("\n"));
  assert.deepEqual(model.brawl, { rooms: [{ place: "meridian", name: "The Long Mess" }], sittings: 3, morale: 40, lasts: 20, skill: "persuasion", against: 6 });
  assert.equal(model.fire, null);
  assert.match(model.problems[0], /line 3: "starts" is written like: 1 in 40 days a room/);
  assert.match(model.problems[1], /line 4: "sparks" isn't a line of fire/);
  assert.match(model.problems[2], /fire has no line for starts, grows, burns, breaks parts, spreads, by hand, engineers, so it never happens/);
  assert.deepEqual(em.emergenciesProblems(), []);
});

test("a fire grows, spoils the room's air and breaks something; then the engineers come and put it out", () => {
  const game = newGame();
  toHour(game, 10);
  inRoom(game, "bridge");
  const started = withDice(0.99, () => em.startFire(game, "meridian", "galley"));
  assert.match(started[0], /^\[FIRE\] Fire in the Galley! It's small/);
  const notes = [];
  withDice(0.99, () => { for (let i = 0; i < 4; i += 1) notes.push(...minutes(game, 10)); });
  // Forty minutes on: it grew twice, and the second time took something with it.
  assert.equal(em.fireIn(game, "meridian", "galley").size, 3);
  assert.ok(notes.some((one) => /^\[FIRE\] The fire in the Galley grows: it's burning hard\.$/.test(one)), notes.join(" | "));
  assert.ok(notes.some((one) => /^\[FIRE\] It's got to the /.test(one)));
  const model = systems.systemsOf("meridian");
  assert.equal(model.partsIn.galley.filter((id) => systems.partBroken(game, "meridian", id)).length, 1);
  assert.ok(systems.airIn(game, "meridian", "galley") < 30, `the air's bad: ${systems.airIn(game, "meridian", "galley")}`);
  // The ship's work board sent the chief engineer as soon as it started. From forty-five minutes he has the better
  // of it, and by an hour and a half it's out.
  withDice(0.99, () => { for (let i = 0; i < 5; i += 1) notes.push(...minutes(game, 10)); });
  assert.ok(notes.some((one) => /^\[FIRE\] Chief Engineer Marrow is getting the better of the fire in the Galley\.$/.test(one)), notes.filter((one) => one.startsWith("[FIRE]")).join(" | "));
  assert.ok(notes.some((one) => /^\[FIRE\] The fire in the Galley is out: the engineers put it out\.$/.test(one)), notes.filter((one) => one.startsWith("[FIRE]")).join(" | "));
  assert.equal(em.fireIn(game, "meridian", "galley"), null);
  // And the air comes back.
  minutes(game, 60);
  assert.ok(systems.airIn(game, "meridian", "galley") > 60);
});

test("a fire with its air shut off goes out by itself, and one fought by hand goes out sooner", () => {
  const game = newGame();
  toHour(game, 10);
  inRoom(game, "bridge");
  em.startFire(game, "meridian", "galley");
  systems.applySystemsEffect(game, { system: "air", room: "The Galley", state: "off" });
  const notes = withDice(0.99, () => minutes(game, 16));
  assert.ok(notes.some((one) => /is out: it had no air to burn\.$/.test(one)), notes.join(" | "));
  // By hand, in the room: a go takes ten minutes and one off its size; it's out in two.
  const second = newGame();
  toHour(second, 10);
  inRoom(second, "galley");
  assert.deepEqual(acts(second).filter((one) => /fire/i.test(one)), []);
  em.startFire(second, "meridian", "galley");
  withDice(0.99, () => minutes(second, 16));
  assert.equal(em.fireIn(second, "meridian", "galley").size, 2);
  assert.deepEqual(acts(second).filter((one) => /fire/i.test(one)), ["Fight the fire (10 minutes)"]);
  const first = withDice(0.99, () => walk.walkCommand(second, { action: "fight-fire" }).said);
  assert.match(first, /^\[FIRE\] You beat it back: it's small now\./);
  const last = withDice(0.99, () => walk.walkCommand(second, { action: "fight-fire" }).said);
  assert.match(last, /^\[FIRE\] The fire in the Galley is out: you put it out\./);
  assert.equal(second.wounds?.length ?? 0, 0, "and no burn, with the dice kind");
  // With the dice unkind, fighting it burns.
  const third = newGame();
  toHour(third, 10);
  inRoom(third, "galley");
  em.startFire(third, "meridian", "galley");
  assert.match(withDice(0, () => walk.walkCommand(third, { action: "fight-fire" }).said), /a burn/);
  assert.ok(third.wounds.some((one) => /^a burn on/.test(one.words)));
  assert.throws(() => walk.walkCommand(third, { action: "fight-fire" }), /no fire here/);
});

test("a breach lets a room's air out until it's patched, by hand with a patch or by the engineers with a crate", () => {
  const game = newGame();
  toHour(game, 10);
  inRoom(game, "airlock_port");
  assert.match(em.startBreach(game, "meridian", "airlock_port")[0], /^\[BREACH\] A plate's gone in the Port Airlock/);
  while (game.inventory.emergency_patch) game.inventory.emergency_patch = 0;
  assert.deepEqual(walk.walkView(game).acts.map((one) => [one.label, Boolean(one.disabled)]), [["Patch the breach (20 minutes)", true]]);
  withDice(0.99, () => minutes(game, 15));
  assert.ok(systems.airIn(game, "meridian", "airlock_port") < 60);
  addItem(game, "emergency_patch");
  assert.match(walk.walkView(game).acts[0].detail, /^with an emergency/);
  assert.match(walk.walkCommand(game, { action: "patch-breach" }).said, /^\[BREACH\] You patch the hull in the Port Airlock with the /);
  assert.equal(game.inventory.emergency_patch ?? 0, 0);
  assert.equal(em.breachIn(game, "meridian", "airlock_port"), null);
  // Left alone, the engineers see to it after two hours, and a parts crate goes.
  const left = newGame();
  toHour(left, 10);
  inRoom(left, "bridge");
  const crates = countAboard(left, "meridian", ["parts_crate"]).n;
  em.startBreach(left, "meridian", "boat_bay");
  const notes = withDice(0.99, () => passTime(left, 2.1, "active"));
  assert.ok(notes.some((one) => /^\[BREACH\] Chief Engineer Marrow has patched the hull in the Boat Bay, with a parts crate\.$/.test(one)), notes.join(" | "));
  assert.equal(countAboard(left, "meridian", ["parts_crate"]).n, crates - 1);
});

test("a brawl in the mess is stopped by stepping in, or ends with both of them hurt", () => {
  const game = newGame();
  toHour(game, 18.2);
  inRoom(game, "mess");
  const [line] = em.startBrawl(game, "meridian", "mess");
  assert.match(line, /^\[BRAWL\] .+ and .+ have come to blows in the Long Mess\.$/);
  const { a, b } = game.emergencies.brawl;
  assert.notEqual(a, b);
  assert.deepEqual(acts(game).filter((one) => /between/.test(one)), ["Step between them"]);
  // Clumsily first, and it costs a bruise; then properly.
  assert.match(withDice(0.99, () => walk.walkCommand(game, { action: "stop-brawl" }).said), /catch an elbow for it/);
  assert.ok(game.wounds.some((one) => /^a bruise on/.test(one.words)));
  assert.match(withDice(0, () => walk.walkCommand(game, { action: "stop-brawl" }).said), /They let go of each other\./);
  assert.equal(game.emergencies.brawl, null);
  // Left to itself, twenty minutes on they're both hurt and the ship's a little lower for it.
  const left = newGame();
  toHour(left, 18.2);
  inRoom(left, "bridge");
  em.startBrawl(left, "meridian", "mess");
  const pair = left.emergencies.brawl;
  const morale = left.ship.morale;
  const notes = withDice(0.99, () => minutes(left, 21));
  assert.ok(notes.some((one) => /^\[BRAWL\] .+ are pulled apart at last/.test(one)), notes.join(" | "));
  for (const who of [pair.a, pair.b]) assert.ok(body.woundsNow(left, body.keyAt("meridian", who)).some((one) => /^a bruise on/.test(one.words)), `${who} has a bruise`);
  assert.equal(left.ship.morale, morale - 1);
});

test("trouble only starts while the clock runs in play, never during a skipped stretch", () => {
  const game = newGame();
  toHour(game, 10);
  inRoom(game, "bridge");
  // With the dice always saying yes: a night's sleep starts nothing.
  withDice(0, () => passTime(game, 8, "rest"));
  assert.deepEqual(Object.keys(game.emergencies?.fires ?? {}), []);
  assert.deepEqual(Object.keys(game.emergencies?.breaches ?? {}), []);
  // A minute of play, and everything that can go wrong does.
  withDice(0, () => { clockRuns(game, 1); clockRuns(game, 1); });
  assert.ok(Object.keys(game.emergencies.fires).length >= 1, JSON.stringify(game.emergencies));
  assert.ok(Object.keys(game.emergencies.breaches).length >= 1);
});
