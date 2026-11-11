// When help doesn't come (health step 6): someone bleeding who isn't reached in time bleeds to death, and a wound gone
// bad left undressed kills, at a place with a medbay; with the medics free and the doors open nobody does; the player
// never dies, and nobody away from a medbay does, for now. The dead lie under a blanket until they're carried to the
// Quiet Room, then nobody sees them again; their name goes up on the chalked names; their fact goes on the record; a
// story person's stories fail and their post goes to someone else; a crowd person leaves the watch bill; one less is
// aboard, morale drops and the doctor's and the captain's duty count it.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-death-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const body = await import("../src/body.js");
const death = await import("../src/death.js");
const { clockRuns, passTime } = await import("../src/rules.js");
const { holderKey, jobsOf, onJob, stillAlive } = await import("../src/command.js");
const { takeAboard } = await import("../src/logistics.js");
const { peopleAboard } = await import("../src/life.js");
const { personWhere, useThing, walkCommand, walkView } = await import("../src/walk.js");
const { setDoor, switchPart, systemsOf } = await import("../src/systems.js");
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
const minutes = (game, n, until = () => false) => {
  const said = [];
  for (let i = 0; i < n && !until(); i += 1) said.push(...(clockRuns(game, 1) ?? []));
  return said;
};
const BAO = "crowd:meridian:mess hand bao";
const bleeding = (game, key, blood = 45, kind = "deep_cut") => {
  game.bodies ??= {};
  game.bodies[key] = { wounds: [{ ...body.newWound(body.kindOf(kind, "chest"), "chest"), at: game.clock.hours, until: game.clock.hours + 400 }], blood };
};
const everyoneAboard = (game) => ["deck1", "deck2", "deck3"].flatMap((level) => peopleAboard(game, "meridian", level));

test("the files say how death comes, where the dead go and what it costs", () => {
  const care = health.careOf({});
  assert.equal(care["bleeding to death"].at, 0);
  assert.equal(care["bleeding stops at"].floor, 35);
  assert.deepEqual(health.readRule("kills after 5 days undressed"), { kills: 5 });
  assert.deepEqual(death.deathRulesOf("meridian"), { room: "quiet", names: "The chalked names", morale: 3 });
  assert.match(health.MEDBAY_KEYS["a death aboard costs"].read("a lot").problem, /3 morale/);
  assert.deepEqual(death.deathProblems(), []);
  assert.ok(death.deathFacts().has("mess_hand_bao_died"));
  assert.ok(death.deathFacts().has("odessa_died"));
  const text = fs.readFileSync(new URL("../world/health/wounds.txt", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal(health.writeWoundsText(health.parseWoundsText(text).value), text);
});

test("behind a locked medbay door, someone bleeding dies where they fell, and all that follows", () => {
  const game = newGame();
  inRoom(game, "mess");
  setDoor(game, "meridian", "medbay", "locked", { by: "story" });
  const morale = game.ship.morale;
  const aboard = game.ship.aboard;
  bleeding(game, BAO);
  const said = minutes(game, 6 * 60, () => game.dead?.[BAO]);
  assert.ok(said.some((line) => /Nobody comes for Mess Hand Bao: the medbay's door is locked/.test(line)), said.join(" | "));
  assert.ok(said.some((line) => /Mess Hand Bao dies, bled to death where they fell/.test(line)), said.join(" | "));
  assert.equal(game.dead[BAO].cause, "bled to death where they fell");
  // On the record, off the watch bill (whoever covered keeps the job), one less aboard, morale down, the duty counts it.
  assert.equal(game.flags.mess_hand_bao_died, true);
  assert.ok(!("Mess Hand Bao" in jobsOf(game, "meridian")));
  assert.equal(stillAlive(game, "Mess Hand Bao"), false);
  assert.ok(said.some((line) => /stays on as a mess hand for good, in Mess Hand Bao's place/.test(line)), said.join(" | "));
  assert.equal(game.ship.aboard, aboard - 1);
  assert.equal(game.ship.morale, morale - 3);
  assert.equal(game.command.meridian.tally[Math.floor(game.dead[BAO].at / 24)].deaths, 1);
  // The body lies under a blanket, and nobody can be carried while the door stays locked.
  const lying = walkView(game).people.find((one) => one.key === "Mess Hand Bao");
  assert.equal(lying.dead, true);
  assert.match(lying.downLook, /^Dead, under a blanket/);
  assert.doesNotMatch(lying.downLook, /Bleeding/);
  // Once the door's open, someone carries the body to the Quiet Room, and nobody sees Bao again.
  setDoor(game, "meridian", "medbay", "unlocked");
  const after = minutes(game, 90, () => !game.down?.[BAO]);
  assert.ok(after.some((line) => /lays Mess Hand Bao out in the Quiet Room, under a sheet/.test(line)), after.join(" | "));
  minutes(game, 5);
  assert.equal(walkView(game).people.some((one) => one.key === "Mess Hand Bao"), false);
  assert.equal(everyoneAboard(game).some((one) => one.name === "Mess Hand Bao"), false);
  // Their name's gone up on the chalked names, and the Ship menu's medbay says so.
  inRoom(game, "names");
  const names = walkView(game).things.find((thing) => thing.name === "The chalked names");
  assert.match(names.look, /Newest, low down and still sharp: Mess Hand Bao, day 1\./);
  assert.match(useThing(game, names.id).said, /- Mess Hand Bao, day 1: bled to death where they fell\./);
  assert.deepEqual(shipView(game).medbay.dead, [{ name: "Mess Hand Bao", day: 1, cause: "bled to death where they fell" }]);
});

test("with the medbay open, a nurse reaches them in time and nobody dies", () => {
  const game = newGame();
  inRoom(game, "mess");
  bleeding(game, BAO);
  minutes(game, 6 * 60);
  assert.equal(game.dead, undefined);
  assert.equal(body.woundsNow(game, BAO).find((wound) => wound.kind === "deep_cut")?.dressed, true, "carried in and dressed");
});

test("a wound gone bad and left undressed kills after five days, and treated, it doesn't", () => {
  const without = newGame();
  takeAboard(without, "meridian", "medicine_crate", 99);
  bleeding(without, BAO, 100, "infected");
  for (let day = 0; day < 6; day += 1) passTime(without, 24, "rest");
  assert.equal(without.dead?.[BAO]?.cause, "of the wound in the chest gone bad");
  assert.equal(without.dead[BAO].day, 5);
  // The same with medicine aboard: the queue brings Bao to the medbay in the morning, and the wound's dressed.
  const fed = newGame();
  bleeding(fed, BAO, 100, "infected");
  for (let hour = 0; hour < 30; hour += 1) passTime(fed, 1, "rest");
  for (let day = 0; day < 5; day += 1) passTime(fed, 24, "rest");
  assert.equal(fed.dead, undefined);
  assert.ok(fed.medbay.meridian.log.some((one) => /Mess Hand Bao's wound in the chest gone bad/.test(one.line)), JSON.stringify(fed.medbay.meridian.log));
});

test("you never die, and nobody away from a medbay bleeds to death, for now", () => {
  const game = newGame();
  inRoom(game, "mess");
  setDoor(game, "meridian", "medbay", "locked", { by: "story" });
  game.wounds = [{ ...body.newWound(body.kindOf("deep_cut", "left_arm"), "left_arm"), at: game.clock.hours, until: game.clock.hours + 400 }];
  game.blood = 50;
  bleeding(game, "crowd:haven:dock hand", 50);
  passTime(game, 10, "rest");
  assert.equal(game.blood, 35, "your blood stops at 35");
  assert.equal(game.bodies["crowd:haven:dock hand"].blood, 35);
  assert.equal(game.dead, undefined);
});

test("a story person who dies: their post goes to someone else, and the story knows", () => {
  const game = newGame();
  inRoom(game, "mess");
  setDoor(game, "meridian", "medbay", "locked", { by: "story" });
  bleeding(game, "id:odessa", 1);
  passTime(game, 1, "rest");
  assert.equal(game.dead?.["id:odessa"]?.name, "Odessa Brandt");
  assert.equal(stillAlive(game, "odessa"), false);
  assert.equal(personWhere(game, "odessa").gone, "dead");
  assert.ok(holderKey(game, "meridian", "quartermaster") && holderKey(game, "meridian", "quartermaster") !== "odessa", "the post went to someone else");
  const contact = game.contacts.find((one) => /Brandt/.test(one.name));
  if (contact) assert.equal(contact.status, "dead");
});

test("a medbay without power treats nobody", () => {
  const game = newGame();
  const box = systemsOf("meridian").circuits.medbay;
  switchPart(game, "meridian", box, false, { by: "story" });
  game.walk = null;
  walkCommand(game, { action: "room", to: "medbay" });
  const said = [];
  for (let hour = 0; hour < 3; hour += 1) said.push(...passTime(game, 1, "rest"));
  assert.ok(said.some((line) => /The medbay has no power/.test(line)), said.join(" | "));
  assert.equal(body.woundsNow(game, "crowd:meridian:vik")[0].dressed, undefined, "Vik's leg isn't splinted in the dark");
});

test("someone answers a call at every hour, and a sleeping nurse is woken when nobody else could come", () => {
  for (let hour = 0; hour < 24; hour += 1) {
    const game = newGame();
    game.clock.hours = 24 + hour;
    inRoom(game, "mess");
    bleeding(game, BAO, 30);
    const said = minutes(game, 20, () => game.down?.[BAO]?.call || game.down?.[BAO]?.bed);
    assert.ok(game.down?.[BAO]?.call || game.down?.[BAO]?.bed, `nobody answered at ${hour}:00: ${said.join(" | ")}`);
  }
  // At three in the morning, with Nurse Anton and every spare hand laid up, Nurse Haru is woken by the call.
  const game = newGame();
  game.clock.hours = 24 + 3;
  inRoom(game, "mess");
  for (const who of ["Nurse Anton", ...onJob(game, "meridian", null)]) {
    game.down[`crowd:meridian:${who.toLowerCase()}`] = { who, place: "meridian", level: "deck2", x: 12, y: 8, since: game.clock.hours, until: 999, why: "laid up", bed: "@medbay" };
  }
  bleeding(game, BAO, 30);
  const said = minutes(game, 20, () => game.down?.[BAO]?.call);
  assert.ok(said.some((line) => /The call wakes Nurse Haru, who sets off from the medbay for Mess Hand Bao/.test(line)), said.join(" | "));
});
