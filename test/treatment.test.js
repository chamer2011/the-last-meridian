// Treatment in the medbay (health step 5): the doctor and the nurses treat each wound in turn, faster the better their
// Medicine, with doses from the medicine cabinet; a dressed cut stops bleeding and a splinted bone knits; someone with a
// serious wound rests on the cot for the file's days, and gets up after; whoever waits on the floor takes a cot that
// comes free, the worst first; the laid up can be talked to there, and a story waiting on them waits; Vik and Hana start
// the game laid up and go back to their days; the Ship menu shows the medbay; and the chief medical officer is marked on
// patients left waiting and on calls reached in time.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-treatment-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const body = await import("../src/body.js");
const medbay = await import("../src/medbay.js");
const { clockRuns, passTime } = await import("../src/rules.js");
const { countAboard, takeAboard } = await import("../src/logistics.js");
const { migrateGame } = await import("../src/migrate.js");
const { personWhere, walkCommand, walkView } = await import("../src/walk.js");
const { shipView } = await import("../src/ship.js");
const health = await import("../public/health-text.js");

const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "marine" }));
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const inRoom = (game, room) => {
  game.walk = null;
  walkCommand(game, { action: "room", to: room });
  clockRuns(game, 1);
};
const VIK = "crowd:meridian:vik";
const HANA = "crowd:meridian:hana";
const BAO = "crowd:meridian:mess hand bao";
const hours = (game, n) => {
  const said = [];
  for (let i = 0; i < n; i += 1) said.push(...passTime(game, 1, "rest"));
  return said;
};
const layUp = (game, key, who, bed, wounds) => {
  game.down ??= {};
  game.down[key] = { who, place: "meridian", level: "deck2", x: 10, y: 9, since: game.clock.hours, until: game.clock.hours, why: "hurt", bed };
  game.bodies ??= {};
  game.bodies[key] = { wounds: wounds.map(([kind, part]) => ({ ...body.newWound(body.kindOf(kind, part), part), at: game.clock.hours, until: game.clock.hours + 400 })), blood: 90 };
};

test("the health file says who treats, where the medicine is, the bed rest and each treatment", () => {
  const meridian = medbay.medbayOf("meridian");
  assert.deepEqual(meridian.treaters, [{ post: "chief_medical_officer" }, { job: "nurse" }]);
  assert.deepEqual(meridian.medicine, { store: "medicine_cabinet", name: "medicine cabinet", doses: 20 });
  assert.equal(meridian.rest, 3);
  assert.deepEqual(meridian.treatments.find((one) => one.name === "broken bone"), { name: "broken bone", doses: 2, minutes: 60 });
  assert.deepEqual(health.readTreatmentLine("deep cut: two doses, 30 minutes"), { name: "deep cut", doses: 2, minutes: 30 });
  assert.match(health.readTreatmentLine("deep cut takes a while").problem, /deep cut: 2 doses, 30 minutes/);
  assert.match(health.MEDBAY_KEYS.medicine.read("the cabinet").problem, /doses to a crate/);
  assert.deepEqual(medbay.medbayProblems(), []);
  // The file reads back as written.
  const text = fs.readFileSync(new URL("../world/health/meridian.txt", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal(health.writeHealthText(health.parseHealthText(text, "meridian").value), text);
});

test("Vik and Hana start laid up on their cots, with wounds that heal, and an older save gets the same", () => {
  const game = newGame();
  assert.equal(game.version, 25);
  assert.equal(game.down[VIK].bed, "patient-1");
  assert.equal(game.down[HANA].bed, "patient-2");
  assert.deepEqual(body.woundsNow(game, VIK).map((wound) => wound.kind), ["broken_bone"]);
  assert.ok(body.woundsNow(game, HANA).some((wound) => wound.kind === "deep_burn"));
  assert.equal(medbay.freeCot(game, "meridian"), "patient-3");
  // A version 21 game: the start lines were made-up marks then, and become kept wounds now.
  const { down: _down, bodies: _bodies, healthStarted: _started, ...old } = structuredClone(game);
  const migrated = migrateGame({ ...old, version: 21, bodies: {} });
  assert.equal(migrated.version, 25);
  assert.equal(migrated.down[VIK].bed, "patient-1");
  assert.equal(body.woundsNow(migrated, VIK).length, 1);
  assert.equal(body.woundsNow(migrateGame(structuredClone(migrated)), VIK).length, 1, "only once");
});

test("the medics treat the laid up with the cabinet's medicine, and they rest, get up and go back to their days", () => {
  const game = newGame();
  const crates = countAboard(game, "meridian", ["medicine_crate"]).n;
  const said = [];
  inRoom(game, "medbay");
  said.push(...hours(game, 4));
  assert.ok(said.some((line) => /Dr\. Aduro|Nurse /.test(line) && /splints Vik's broken right leg/.test(line)), said.join(" | "));
  assert.ok(said.some((line) => /dresses Hana's deep burn on the chest/.test(line)), said.join(" | "));
  const leg = body.woundsNow(game, VIK)[0];
  assert.equal(leg.dressed, true, "splinted");
  assert.ok(leg.until - game.clock.hours < 60 * 24, "a splinted bone knits faster than one left alone");
  assert.equal(countAboard(game, "meridian", ["medicine_crate"]).n, crates - 1, "a crate opened from the cabinet");
  // Two doses for the leg, three for the deep burn, and two for the burn on her arm unless she dressed it herself first.
  const used = 2 + 3 + (game.medbay.meridian.log.some((one) => /burn on the left arm/.test(one.line)) ? 2 : 0);
  assert.equal(game.medbay.meridian.doses, 20 - used);
  // The Ship menu shows them resting, and what was done.
  const view = shipView(game).medbay;
  assert.equal(view.cots[0].who, "Vik");
  assert.equal(view.cots[0].state, "resting");
  assert.equal(view.cots[2], null);
  assert.match(view.log[0], /^Day 1: /);
  assert.equal(view.medicine.doses, 20 - used);
  // Three days' bed rest, then up and back to their days, and the cots are free.
  passTime(game, 24 * 2, "rest");
  assert.ok(game.down[VIK], "still resting on the second day");
  passTime(game, 24 * 1.5, "rest");
  assert.equal(game.down[VIK], undefined);
  assert.equal(game.down[HANA], undefined);
  assert.equal(medbay.freeCot(game, "meridian"), "patient-1");
});

test("with the cabinet empty nobody's treated, and patients left waiting count against the doctor", () => {
  const game = newGame();
  takeAboard(game, "meridian", "medicine_crate", 99);
  game.walk = null;
  walkCommand(game, { action: "room", to: "medbay" });
  const said = hours(game, 3);
  assert.ok(said.some((line) => /The medicine cabinet is empty/.test(line)), said.join(" | "));
  assert.equal(body.woundsNow(game, VIK)[0].dressed, undefined);
  assert.equal(shipView(game).medbay.medicine.short, true);
  assert.match(shipView(game).medbay.cots[0].state, /^waiting for treatment/);
  // At midnight the doctor's day is marked down for it.
  passTime(game, 24, "rest");
  const day = game.command.meridian.duty.chief_medical_officer.at(-1);
  assert.ok(day.parts["patients left waiting"] < 100, JSON.stringify(day));
  assert.equal(day.parts["people reached in time"], 100);
});

test("the walking hurt in the morning queue are seen to as well, after the laid up", () => {
  const game = newGame();
  game.bodies[BAO] = { wounds: [{ ...body.newWound(body.kindOf("broken_bone", "left_arm"), "left_arm"), at: game.clock.hours, until: game.clock.hours + 2000 }] };
  hours(game, 3);
  assert.equal(game.bodies[BAO].wounds[0].dressed, true, "his arm splinted in the queue");
  assert.equal(game.down?.[BAO], undefined, "and he wasn't laid up for it");
  assert.ok(game.medbay.meridian.log.some((one) => /splints Mess Hand Bao's broken left arm/.test(one.line)), JSON.stringify(game.medbay.meridian.log));
});

test("a call reached late counts against the doctor", () => {
  const game = newGame();
  inRoom(game, "mess");
  medbay.fallDown(game, { who: "Mess Hand Bao", place: "meridian", level: game.walk.level, x: game.walk.x + 1, y: game.walk.y, why: "out cold", hours: 9 });
  // Nobody saw them fall for two hours.
  game.down[BAO].since -= 2;
  for (let i = 0; i < 60 && !game.down[BAO].carriedBy; i += 1) clockRuns(game, 1);
  assert.ok(game.down[BAO].carriedBy, "picked up");
  const tally = game.command.meridian.tally[Math.floor(game.clock.hours / 24)];
  assert.equal(tally.lateCalls, 1);
});

test("whoever waits on the floor takes a cot that comes free, the worst first", () => {
  const game = newGame();
  layUp(game, "crowd:meridian:salome", "Salome", "patient-3", [["bruise", "chest"]]);
  layUp(game, "crowd:meridian:emeka", "Emeka", "patient-4", [["broken_bone", "left_arm"]]);
  layUp(game, "crowd:meridian:mess hand lotte", "Mess Hand Lotte", "@medbay", [["cut", "left_arm"]]);
  layUp(game, BAO, "Mess Hand Bao", "@medbay", [["broken_bone", "right_leg"], ["deep_cut", "chest"]]);
  assert.equal(shipView(game).medbay.floor[0].who, "Mess Hand Bao", "the worst first on the menu too");
  delete game.down["crowd:meridian:salome"];
  medbay.advanceMedbay(game);
  assert.equal(game.down[BAO].bed, "patient-3", "Bao, the worse off, takes the cot");
  assert.equal(game.down["crowd:meridian:mess hand lotte"].bed, "@medbay");
});

test("the laid up can be talked to on their cot, and a story waiting on them waits", () => {
  const game = newGame();
  inRoom(game, "medbay");
  clockRuns(game, 1);
  const vik = walkView(game).people.find((one) => one.key === "Vik");
  assert.equal(vik.room, "medbay", "on the cot from the start, not walking there");
  assert.equal(vik.walking, undefined);
  assert.equal(vik.onCot, true);
  assert.equal(vik.awake, true, "awake, so Talk is offered");
  // Someone out cold on a cot isn't.
  layUp(game, "crowd:meridian:emeka", "Emeka", "patient-3", [["knock", "head"]]);
  game.bodies["crowd:meridian:emeka"].wounds[0].until = game.clock.hours + 5;
  assert.equal(medbay.awakeInMedbay(game, "crowd:meridian:emeka"), false);
  // Someone the story needs: found on their cot here, and laid up where the player can't reach them from another place.
  layUp(game, "id:pell", "pell", "patient-4", [["broken_bone", "left_leg"]]);
  assert.equal(personWhere(game, "pell")?.gone, undefined);
  game.location = "haven";
  assert.equal(personWhere(game, "pell").gone, "laid up in the medbay");
  game.location = "meridian";
  game.down["id:pell"].bed = null;
  assert.match(personWhere(game, "pell").gone, /^down/);
});

test("the player standing in the medbay is treated, and walking out stops it", () => {
  const game = newGame();
  inRoom(game, "medbay");
  game.wounds = [{ ...body.newWound(body.kindOf("deep_cut", "left_arm"), "left_arm"), at: game.clock.hours, until: game.clock.hours + 400 }];
  hours(game, 3);
  assert.equal(game.wounds[0].dressed, true, "dressed by a medic");
  // A second time, walking out before it's done: not treated, and the doses go back.
  game.wounds.push({ ...body.newWound(body.kindOf("deep_cut", "right_arm"), "right_arm"), at: game.clock.hours, until: game.clock.hours + 400 });
  for (let i = 0; i < 90 && !game.medbay.meridian.treating.you; i += 1) clockRuns(game, 1);
  assert.ok(game.medbay.meridian.treating.you, "being seen to");
  const doses = game.medbay.meridian.doses;
  inRoom(game, "mess");
  hours(game, 2);
  assert.equal(game.wounds[1].dressed, undefined);
  assert.equal(game.medbay.meridian.doses, doses + 2);
});
