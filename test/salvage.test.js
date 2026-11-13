// Salvage runs (the hands-on plan, step 7): at the Graveyard, a run out to a dead ship, played from the You can list
// against the air in the bottle. What's taken comes home with the shuttle; out of air, it stays behind.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-salvage-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const { addItem, passTime } = await import("../src/rules.js");
const salvage = await import("../src/salvage.js");
const walk = await import("../src/walk.js");

const newGame = (start = "captain") => {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
// At the Graveyard, with the dice held so that nothing's still aboard unless a test says so.
function atTheGraveyard() {
  const game = newGame();
  game.location = "graveyard";
  game.walk = null;
  walk.walkView(game);
  return game;
}
const acts = (game) => walk.walkView(game).acts ?? [];
const labels = (game) => acts(game).filter((one) => one.id.startsWith("salvage")).map((one) => `${one.label}${one.disabled ? " (off)" : ""}`);
const job = (game, id) => walk.walkCommand(game, { action: "salvage-job", key: id }).said;
function withDice(value, run) {
  const real = Math.random;
  Math.random = () => value;
  try { return run(); } finally { Math.random = real; }
}

test("the file reads, and the game's own is whole", () => {
  const model = salvage.parseSalvage(["at: nowhere", "air: 90 minutes", "lockers hold: medkit, gold"].join("\n"));
  assert.equal(model.air, 90);
  assert.match(model.problems[0], /line 1: "at" is written like: a place's id/);
  assert.match(model.problems[1], /line 3: "lockers hold" is written like: item ids/);
  assert.match(model.problems[2], /there's no line for at, the wreck/);
  assert.ok(salvage.salvageRules());
});

test("a whole run: the power, the hatch, the lockers, the engine room and the log, and home with all of it", () => {
  const game = atTheGraveyard();
  game.skills.hacking = 3;
  assert.deepEqual(labels(game), ["Take the shuttle out to the hulk of the Harrow"]);
  assert.match(acts(game).find((one) => one.id === "salvage-start").detail, /^a salvage run: 90 minutes of air, 20 minutes each way$/);
  const start = game.clock.hours;
  assert.match(walk.walkCommand(game, { action: "salvage-start" }).said, /^\[SALVAGE\] The shuttle puts you across to the hulk of the Harrow/);
  assert.ok(Math.abs(game.clock.hours - start - 20 / 60) < 1e-6);
  assert.equal(salvage.airLeft(game), 90);
  assert.deepEqual(labels(game), [
    "Bring the power back at the junction box (15 minutes)",
    "Get the hatch to the engine room open (30 minutes)",
    "Go through the crew lockers (10 minutes)",
    "Strip the engine room for parts (25 minutes) (off)",
    "Pull the log from the bridge console (15 minutes) (off)",
    "Go back to the shuttle (90 minutes of air left)",
  ]);
  assert.throws(() => job(game, "engine"), /Not yet: the hatch is shut/);
  assert.match(job(game, "junction"), /The junction box coughs/);
  // With the power on the hatch is five minutes, not thirty.
  assert.ok(labels(game).includes("Get the hatch to the engine room open (5 minutes)"));
  job(game, "hatch");
  job(game, "lockers");
  assert.match(withDice(0.99, () => job(game, "engine")), /You strip the engine room: 2 parts crates\./);
  assert.equal(game.combat ?? null, null, "nothing was aboard");
  assert.match(job(game, "console"), /will pay 60 credits for it/);
  assert.equal(salvage.airLeft(game), 90 - 15 - 5 - 10 - 25 - 15);
  assert.deepEqual(labels(game), ["Go back to the shuttle (20 minutes of air left)"]);
  const credits = game.credits;
  const kits = game.inventory.medkit ?? 0;
  const said = walk.walkCommand(game, { action: "salvage-back" }).said;
  assert.match(said, /^\[SALVAGE\] The shuttle brings you back with .+2 parts crates.+ a log worth 60 credits\./);
  assert.equal(game.inventory.parts_crate, 2);
  assert.equal(game.inventory.medkit, kits + 1);
  assert.equal(game.credits, credits + 60);
  assert.equal(game.salvage, null);
  // It's been picked over: not again for three days.
  assert.deepEqual(labels(game), ["Take the shuttle out to the hulk of the Harrow (off)"]);
  passTime(game, 24 * 3, "routine");
  assert.deepEqual(labels(game), ["Take the shuttle out to the hulk of the Harrow"]);
});

test("the air runs out: hauled out, and what was carried stays behind", () => {
  const game = atTheGraveyard();
  walk.walkCommand(game, { action: "salvage-start" });
  job(game, "lockers");
  assert.ok(game.salvage.carried.medkit);
  const kits = game.inventory.medkit ?? 0;
  const stress = game.needs.stress;
  // By hand the hatch is half an hour, and then the player dawdles.
  job(game, "hatch");
  const notes = passTime(game, 1, "active");
  assert.ok(notes.some((one) => /^\[SALVAGE\] The bottle's empty\. The shuttle's crew haul you out by your harness, and what you were carrying stays behind: /.test(one)), notes.join(" | "));
  assert.equal(game.salvage, null);
  assert.equal(game.inventory.medkit ?? 0, kits);
  assert.ok(game.needs.stress > stress);
});

test("a tool roll halves the heavy work, the console wants some Hacking, and something may still be aboard", () => {
  const game = atTheGraveyard();
  addItem(game, "tool_roll");
  game.skills.hacking = 0;
  walk.walkCommand(game, { action: "salvage-start" });
  assert.ok(labels(game).includes("Bring the power back at the junction box (8 minutes)"));
  assert.ok(labels(game).includes("Get the hatch to the engine room open (15 minutes)"));
  job(game, "junction");
  assert.equal(acts(game).find((one) => one.key === "console").detail, "it wants Hacking 2");
  job(game, "hatch");
  const said = withDice(0, () => job(game, "engine"));
  assert.match(said, /You're not the only one in here\./);
  assert.ok(game.combat, "a fight has started");
});

test("there's no run from anywhere but the Graveyard", () => {
  const game = newGame();
  assert.deepEqual(labels(game), []);
  assert.throws(() => walk.walkCommand(game, { action: "salvage-start" }), /no wreck to go out to from here/);
});
