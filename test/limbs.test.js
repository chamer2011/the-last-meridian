// Lost limbs, artificial ones and synthetic bodies (health step 7): a hard hit on a limb that's already broken takes it
// now and then, and the doctor takes a limb whose wound has gone bad and been left too long; the stump is dressed in the
// medbay, a tech builds an artificial arm or leg in the Repair Bay from parts crates, and the doctor fits it, and it
// works nearly as well; now and then someone has one from before; and synthetics are mended in the Repair Bay by the
// techs with parts crates, not by the nurses with medicine.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-limbs-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const body = await import("../src/body.js");
const workshop = await import("../src/workshop.js");
const { medbayProblems } = await import("../src/medbay.js");
const { passTime } = await import("../src/rules.js");
const { countAboard, takeAboard } = await import("../src/logistics.js");
const { walkCommand } = await import("../src/walk.js");
const { shipView } = await import("../src/ship.js");
const health = await import("../public/health-text.js");

const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "marine" }));
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const BAO = "crowd:meridian:mess hand bao";
const SEVEN = "id:seven";
const wound = (game, kind, part, extra = {}) => ({ ...body.newWound(body.kindOf(kind, part), part), at: game.clock.hours, ...extra });
const hours = (game, n) => {
  const said = [];
  for (let i = 0; i < n; i += 1) said.push(...passTime(game, 1, "rest"));
  return said;
};
const rolls = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

test("the files say how limbs are lost, how the workshop mends and builds, and how long a fitting takes", () => {
  const care = health.careOf({});
  assert.equal(care["losing a limb to a hit"].oneIn, 4);
  assert.equal(care["losing a limb to rot"].days, 3);
  assert.deepEqual(care["artificial limbs from before"], { oneIn: 60, rough: 25 });
  assert.deepEqual(health.readMendingLine("cracked casing: 1 parts crate, an hour"), { name: "cracked casing", crates: 1, minutes: 60 });
  assert.match(health.readMendingLine("a new hand").problem, /cracked casing: 1 parts crate, an hour/);
  const shop = workshop.workshopOf("meridian");
  assert.equal(shop.room, "repair");
  assert.deepEqual(shop.stores, ["parts_lockers", "shuttle_stores"]);
  assert.deepEqual(shop.recipes.arm, { name: "artificial arm", crates: 2, minutes: 360 });
  assert.deepEqual(medbayProblems(), []);
  for (const [file, parse, write] of [["wounds.txt", health.parseWoundsText, health.writeWoundsText], ["meridian.txt", health.parseHealthText, health.writeHealthText]]) {
    const text = fs.readFileSync(new URL(`../world/health/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
    assert.equal(write(parse(text, "meridian").value), text, file);
  }
});

test("a hard hit on a limb that's already broken takes it now and then, and never one that isn't", () => {
  const broken = [{ part: "right_leg", kind: "broken_bone" }];
  const hard = { weapon: "rifle", damage: 30, maxHp: 30 };
  // The first roll picks the right leg; the next decides whether it's lost.
  const lost = body.landHit({ species: "human" }, { ...hard, wounds: broken, roll: rolls(0.85, 0.1) });
  assert.equal(lost.wound.kind, "lost");
  assert.equal(lost.wound.words, "the right leg is gone");
  const kept = body.landHit({ species: "human" }, { ...hard, wounds: broken, roll: rolls(0.85, 0.9) });
  assert.equal(kept.wound.kind, "deep_cut", "three times in four it's only another wound");
  const whole = body.landHit({ species: "human" }, { ...hard, wounds: [], roll: rolls(0.85, 0.1) });
  assert.notEqual(whole.wound?.kind, "lost");
  assert.notEqual(body.landHit({ species: "synthetic" }, { ...hard, wounds: [{ part: "right_leg", kind: "broken_bone" }], roll: rolls(0.85, 0.1) }).wound?.kind, "lost", "a synthetic's limb isn't lost");
});

test("a lost arm: the stump dressed in the medbay, an arm built in the Repair Bay from parts crates, and fitted", () => {
  const game = newGame();
  game.walk = null;
  walkCommand(game, { action: "room", to: "medbay" });
  const crates = countAboard(game, "meridian", ["parts_crate"]).n;
  game.bodies[BAO] = { wounds: [wound(game, "lost", "left_arm")], blood: 60 };
  const said = hours(game, 30);
  assert.ok(said.some((line) => /dresses the stump of Mess Hand Bao's left arm/.test(line)), said.join(" | "));
  assert.ok(said.some((line) => /fits Mess Hand Bao's artificial left arm\. It works nearly as well/.test(line)), said.join(" | "));
  assert.deepEqual(body.woundsNow(game, BAO).filter((one) => one.kind === "lost"), [], "the stump's wound gives way to the arm");
  assert.equal(game.bodies[BAO].fitted[0].part, "left_arm");
  // Two parts crates went into it, besides any the engineers used on repairs meanwhile.
  const repairs = (game.logistics?.meridian?.repairs?.log ?? []).length;
  assert.equal(countAboard(game, "meridian", ["parts_crate"]).n, crates - 2 - repairs, "two parts crates went into it");
  assert.ok(game.workshop.meridian.log.some((one) => /finishes an artificial left arm for Mess Hand Bao/.test(one.line)));
  // The body says so, and it works nearly as well: one off the attack in a fight, and the hand works.
  const bao = body.bodyOf(game, { name: "Mess Hand Bao", place: "meridian" });
  assert.ok(bao.marks.some((mark) => mark.words === "an artificial left arm"));
  assert.equal(body.handsFree(game, "meridian", "Mess Hand Bao"), true);
  const fighter = body.fighterBody(game, { name: "Mess Hand Bao", place: "meridian" });
  assert.equal(body.fightAttackOf(fighter.wounds), -1);
  // It stays: the wounds clock keeps the body with nothing else on it.
  passTime(game, 24 * 40, "rest");
  assert.equal(game.bodies[BAO].fitted.length, 1);
});

test("an artificial leg walks a little slower, and nobody gets one with no parts crates aboard", () => {
  const game = newGame();
  game.bodies[BAO] = { wounds: [wound(game, "lost", "right_leg", { dressed: true, dressedAt: game.clock.hours })] };
  takeAboard(game, "meridian", "parts_crate", 99);
  hours(game, 12);
  assert.equal(game.workshop.meridian.ready?.[BAO], undefined, "nothing built without crates");
  assert.equal(workshop.workshopView(game, "meridian").short, true);
  assert.match(workshop.workshopView(game, "meridian").lines.join(" "), /Mess Hand Bao is waiting for an artificial right leg/);
  // Once there are crates, it's built and, when Bao's in the medbay, fitted.
  const fitted = newGame();
  fitted.bodies[BAO] = { wounds: [wound(fitted, "lost", "right_leg", { dressed: true, dressedAt: fitted.clock.hours })] };
  fitted.down = { ...fitted.down, [BAO]: { who: "Mess Hand Bao", place: "meridian", level: "deck2", x: 12, y: 8, since: fitted.clock.hours, until: fitted.clock.hours, why: "laid up", bed: "patient-3" } };
  hours(fitted, 12);
  const bao = body.bodyOf(fitted, { name: "Mess Hand Bao", place: "meridian" });
  assert.ok(bao.marks.some((mark) => mark.words === "an artificial right leg"), JSON.stringify(bao.marks.map((mark) => mark.words)));
  assert.equal(body.paceOf(bao), 0.9);
  assert.equal(body.statusOf(bao), "Walks a little stiffly");
});

test("the doctor takes a limb whose wound has gone bad and been left three days", () => {
  const game = newGame();
  game.bodies[BAO] = { wounds: [wound(game, "infected", "left_arm", { at: game.clock.hours - 80 })] };
  hours(game, 4);
  assert.deepEqual(body.woundsNow(game, BAO).map((one) => [one.kind, one.dressed]), [["lost", true]]);
  assert.ok(game.medbay.meridian.log.some((one) => /takes Mess Hand Bao's left arm: the wound had gone too far/.test(one.line)));
  // Caught sooner, it's only dressed.
  const sooner = newGame();
  sooner.bodies[BAO] = { wounds: [wound(sooner, "infected", "left_arm", { at: sooner.clock.hours - 30 })] };
  hours(sooner, 4);
  assert.equal(body.woundsNow(sooner, BAO)[0].kind, "infected");
  assert.equal(body.woundsNow(sooner, BAO)[0].dressed, true);
});

test("synthetics are mended in the Repair Bay by the techs with parts crates, and carried there when they're down", () => {
  const game = newGame();
  const crates = countAboard(game, "meridian", ["parts_crate"]).n;
  game.bodies[SEVEN] = { wounds: [wound(game, "cracked_casing", "chest")] };
  hours(game, 4);
  const casing = body.woundsNow(game, SEVEN)[0];
  assert.equal(casing?.dressed, true, "mended");
  assert.equal(countAboard(game, "meridian", ["parts_crate"]).n, crates - 1);
  assert.ok(game.workshop.meridian.log.some((one) => /mends Mercy Seven's cracked casing on the chest/.test(one.line)), JSON.stringify(game.workshop.meridian.log));
  assert.ok(!game.medbay?.meridian?.log?.some((one) => /Seven/.test(one.line)), "not by the nurses");
  // A synthetic who can't get up goes to the Repair Bay's bench, and gets up once mended.
  const down = newGame();
  down.walk = null;
  walkCommand(down, { action: "room", to: "mess" });
  down.bodies[SEVEN] = { wounds: [wound(down, "ruined_joint", "right_leg"), wound(down, "ruined_joint", "left_leg")] };
  const said = hours(down, 6);
  assert.ok(said.some((line) => /lays Mercy Seven on the bench in the Repair Bay/.test(line)) || down.workshop.meridian.log.some((one) => /mends Mercy Seven's/.test(one.line)), said.join(" | "));
  assert.ok(body.woundsNow(down, SEVEN).every((one) => one.dressed), "both joints mended");
});

test("now and then someone has an artificial limb from before, and the same in a game with the same seed", () => {
  const counts = [];
  for (const seed of [1, 2, 3]) {
    const game = newGame();
    game.bodySeed = seed;
    const life = JSON.parse(fs.readFileSync(new URL("../world/life/meridian.json", import.meta.url), "utf8"));
    const names = life.crowd.flatMap((group) => group.names.map(([name]) => name));
    counts.push(names.filter((name) => body.bodyOf(game, { name, place: "meridian" }).marks.some((mark) => mark.kind === "artificial_limb")).length);
    // A second look gives the same body.
    const again = names.filter((name) => body.bodyOf(game, { name, place: "meridian" }).marks.some((mark) => mark.kind === "artificial_limb")).length;
    assert.equal(again, counts.at(-1));
  }
  assert.ok(counts.every((n) => n <= 4), `rare: ${counts.join(", ")} of the crowd`);
  // A synthetic never has one, nor a species with only its own marks.
  assert.ok(!body.bodyOf(newGame(), { id: "seven" }).marks.some((mark) => mark.kind === "artificial_limb"));
  // The Ship menu has the Repair Bay.
  assert.equal(shipView(newGame()).workshop.room, "The Repair Bay");
});
