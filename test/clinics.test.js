// The rest of the world (health step 10): a place other than the Meridian can have a medbay of its own, written as
// world/health/<place>.txt with its medics named one by one, the place's own medicine and a bill for the player;
// Anselm's Mercy has the first, its Long Ward; the fallen there are carried to its cots and treated; the player knocked
// down there wakes in it and pays for the doses; and at a dock with no clinic, someone whose home is the Meridian is
// brought back aboard by the shuttle crew to hers, while anyone else comes round where they fell.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-clinics-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const body = await import("../src/body.js");
const medbay = await import("../src/medbay.js");
const { combatAction, passTime, startCombat } = await import("../src/rules.js");
const { walkOf, walkView } = await import("../src/walk.js");
const { DAILY, WORLD_HEALTH } = await import("../src/world.js");
const { MEDBAY_KEYS, parseHealthText, writeHealthText } = await import("../public/health-text.js");

const newGame = (start = "captain") => {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const wound = (name, part) => body.newWound(body.woundKindsByName(name).find((kind) => kind.parts.includes(part)), part);
// The player at a place, with the Meridian at its dock.
const goTo = (game, place) => {
  game.location = place;
  game.walk = null;
  walkOf(game);
  if (game.ship) game.ship.at = place;
};
const TOLU = "crowd:anselm:mama tolu";

test("Anselm's Mercy has a medbay of its own: the Long Ward, its medics by name, its own medicine and a bill", () => {
  const text = fs.readFileSync(new URL("../world/health/anselm.txt", import.meta.url), "utf8");
  const { value, problems } = parseHealthText(text, "anselm");
  assert.deepEqual(problems, []);
  assert.equal(writeHealthText(value), text, "it reads back the same");
  const ward = medbay.medbayOf("anselm");
  assert.equal(ward.room, "ward");
  assert.equal(ward.cots.length, 6);
  assert.deepEqual(ward.answers, [{ who: "Nurse Adaeze" }, { who: "Nurse Piet" }, { who: "Nurse Luz" }, { who: "Orderly Sem" }]);
  assert.deepEqual(ward.treaters.map((one) => one.who), ["wen", "tessaly", "Nurse Adaeze", "Nurse Piet", "Nurse Luz"], "Dr. Adeyemi and Doc Marsh by the names their files give them");
  assert.deepEqual([ward.medicine.own, ward.medicine.doses, ward.perDose], [true, 20, 2]);
  assert.equal(medbay.medbayCalled("anselm"), "the Long Ward");
  assert.equal(medbay.medbayCalled("meridian"), "the medbay");
  assert.deepEqual(medbay.medbayProblems().filter((one) => one.includes("anselm")), []);
  assert.match(MEDBAY_KEYS["you pay"].read("a lot").problem, /2 credits a dose/);
  // The checker names someone who isn't there.
  const kept = WORLD_HEALTH.anselm;
  try {
    WORLD_HEALTH.anselm = { ...kept, treaters: "Dr. Nobody" };
    medbay.clearMedbays();
    assert.ok(medbay.medbayProblems().some((one) => /who treats names Dr\. Nobody, which isn't .* or someone in world\/life\/anselm\.json/.test(one)));
  } finally {
    WORLD_HEALTH.anselm = kept;
    medbay.clearMedbays();
  }
});

test("someone who falls at Anselm's Mercy is carried to a cot in the Long Ward and treated there", () => {
  const game = newGame();
  goTo(game, "anselm");
  passTime(game, 0.5, "routine");
  body.addWounds(game, TOLU, [wound("broken bone", "right_leg"), wound("broken bone", "left_leg")]);
  const notes = [];
  for (let i = 0; i < 12; i += 1) notes.push(...passTime(game, 0.25, "routine"));
  assert.ok(notes.some((one) => /sets off from the Long Ward for Mama Tolu/.test(one)), notes.join(" | "));
  assert.ok(notes.some((one) => /lays Mama Tolu on a cot in the Long Ward/.test(one)));
  assert.match(game.down[TOLU].bed, /^cot-/);
  assert.ok(body.woundsNow(game, TOLU).every((one) => one.dressed), "both legs splinted");
  assert.ok(game.medbay.anselm.log.some((one) => /splints Mama Tolu's broken/.test(one.line)));
});

test("knocked down at Anselm's Mercy, you wake in the Long Ward, and pay for your doses", () => {
  const game = newGame();
  goTo(game, "anselm");
  passTime(game, 0.2, "routine");
  body.addWounds(game, "you", [wound("deep cut", "chest")]);
  const credits = game.credits;
  const woke = medbay.wakeAfterDefeat(game);
  assert.match(woke[0], /^You come to on a cot in the Long Ward, .* later\. Nurse \w+ carried you here\.$/);
  assert.equal(walkView(game).here.id, "ward");
  const notes = [];
  for (let i = 0; i < 8; i += 1) notes.push(...passTime(game, 0.25, "rest"));
  assert.ok(notes.some((one) => /charges you 4 credits for the doses/.test(one)), notes.join(" | "));
  assert.equal(game.credits, credits - 4, "a deep cut's two doses at 2 credits each");
  // With less than the bill, they take what there is.
  const poor = newGame();
  goTo(poor, "anselm");
  passTime(poor, 0.2, "routine");
  body.addWounds(poor, "you", [wound("deep cut", "chest")]);
  poor.credits = 1;
  medbay.wakeAfterDefeat(poor);
  const said = [];
  for (let i = 0; i < 8; i += 1) said.push(...passTime(poor, 0.25, "rest"));
  assert.ok(said.some((one) => /charges you 4 credits for the doses, and takes the 1 you have/.test(one)), said.join(" | "));
  assert.equal(poor.credits, 0);
});

test("a port's own medicine runs out, and then nobody can be treated there until there's more", (t) => {
  // Anselm's supplies aren't one of the world's, so its medicine never runs out; here the world keeps them, as it does
  // Haven's, with enough for one crate.
  DAILY.places.anselm = structuredClone(DAILY.places.haven);
  t.after(() => delete DAILY.places.anselm);
  const game = newGame();
  goTo(game, "anselm");
  passTime(game, 0.2, "routine");
  game.world.places.anselm.goods.medicine = 11;
  body.addWounds(game, TOLU, [wound("broken bone", "right_leg"), wound("broken bone", "left_leg")]);
  for (let i = 0; i < 12; i += 1) passTime(game, 0.25, "routine");
  assert.equal(game.world.places.anselm.goods.medicine, 7, "a crate taken, as buying one would, and under 8 there's none left");
  // The crate's doses go; then there's none left for another.
  game.medbay.anselm.doses = 0;
  body.addWounds(game, "you", [wound("deep cut", "chest")]);
  // Said while they're still coming to, among the lines of waking.
  const notes = [...medbay.wakeAfterDefeat(game)];
  for (let i = 0; i < 6; i += 1) notes.push(...passTime(game, 0.25, "rest"));
  assert.ok(notes.some((one) => /There's no medicine left here\. .* can't treat anyone until there's more/.test(one)), notes.join(" | "));
  assert.ok(!body.woundsNow(game, "you").find((one) => one.kind === "deep_cut").dressed);
});

test("at a dock with no clinic, the Meridian's own are brought back aboard to her medbay, and anyone else comes round", () => {
  const game = newGame();
  goTo(game, "haven");
  passTime(game, 0.2, "routine");
  const woke = medbay.wakeAfterDefeat(game);
  assert.equal(woke[0], "The shuttle crew found you on Haven Station and brought you back aboard.");
  assert.match(woke[1], /^You come to on a cot in the medbay/);
  assert.equal(game.location, "meridian");
  assert.equal(walkView(game).here.id, "medbay");
  // Crew too.
  const crew = newGame("engine_hand");
  goTo(crew, "haven");
  assert.ok(medbay.wakeAfterDefeat(crew));
  // A dock hand at Haven isn't the Meridian's, and away from her dock nobody's shuttle comes.
  const docker = newGame("docker");
  docker.ship.at = "haven";
  assert.equal(medbay.wakeAfterDefeat(docker), null);
  const away = newGame();
  goTo(away, "kessara");
  away.ship.at = "haven";
  assert.equal(medbay.wakeAfterDefeat(away), null);
});

test("losing a fight at the Meridian's dock ends aboard her, with nothing taken", () => {
  for (let tries = 0; tries < 30; tries += 1) {
    const game = newGame();
    goTo(game, "haven");
    passTime(game, 0.2, "routine");
    const credits = game.credits;
    startCombat(game, "choir_hunter");
    let outcome;
    let rounds = 0;
    do {
      game.hp = Math.min(game.hp, 2);
      outcome = combatAction(game, { type: "attack" });
      rounds += 1;
    } while (!outcome.over && rounds < 50);
    if (outcome.result !== "defeat") continue;
    assert.equal(game.location, "meridian");
    assert.equal(game.credits, credits, "nothing taken");
    assert.match(outcome.summary, /came to in the medbay/);
    assert.ok(outcome.events.some((event) => /The shuttle crew found you on Haven Station/.test(event.text ?? "")));
    return;
  }
  assert.fail("no defeat in thirty games");
});
