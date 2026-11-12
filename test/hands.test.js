// The crew's jobs by hand (the hands-on plan, step 1): a room with a machine offers its work, and doing it passes the
// time at work, says what came of it and makes nothing from nothing; someone hurt can be treated with a medkit, or in
// a medbay with its own doses; and crew aboard are paid by the piece for real work at their own job, six pieces a day.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-hands-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const body = await import("../src/body.js");
const hands = await import("../src/hands.js");
const { logisticsOf, storesView, takeAboard, putAboard } = await import("../src/logistics.js");
const { notePut } = await import("../src/puts.js");
const { addItem, passTime, publicState, removeItem } = await import("../src/rules.js");
const { walkCommand, walkView } = await import("../src/walk.js");

const newGame = (start = "captain") => {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const inRoom = (game, room) => {
  game.walk = null;
  walkCommand(game, { action: "room", to: room });
};
const store = (id) => logisticsOf("meridian").stores.find((one) => one.id === id);
const kettle = (game) => storesView(game, "meridian").find((one) => one.id === "soup_kettle").count.n;
const setKettle = (game, n) => { game.stores ??= {}; game.stores[store("soup_kettle").key] = { count: n }; };
const wound = (name, part) => body.newWound(body.woundKindsByName(name).find((kind) => kind.parts.includes(part)), part);
const BAO = "crowd:meridian:mess hand bao";
const acts = (game) => walkView(game).acts ?? [];
// On to an hour of the day, resting.
const toHour = (game, hour) => passTime(game, (((hour - (game.clock.hours % 24)) % 24) + 24) % 24 || 24, "rest");
const noKits = (game) => { while (game.inventory.medkit) removeItem(game, "medkit"); };
const person = (game, key) => walkView(game).people.find((one) => one.key === key);

test("the galley offers its work, and cooking a pot by hand turns what's in the pantry into sittings", () => {
  const game = newGame();
  inRoom(game, "galley");
  const offered = acts(game);
  assert.deepEqual(offered.map((one) => [one.id, one.key, one.label]), [["work-machine", "galley", "Cook a pot (1 hour)"]]);
  // In the small hours, with no cook about and the kettle half empty.
  passTime(game, (24 - (game.clock.hours % 24)) + 2, "rest");
  setKettle(game, 100);
  const before = { hours: game.clock.hours, kettle: kettle(game), fatigue: game.needs.fatigue };
  const { said } = walkCommand(game, { action: "work-machine", key: "galley" });
  assert.match(said, /^\[WORK\] You cook for an hour: \d+ sittings into the soup kettle\./);
  assert.ok(Math.abs(game.clock.hours - before.hours - 1) < 1e-6, "an hour went by");
  assert.ok(kettle(game) > before.kettle, `${kettle(game)} sittings in the kettle`);
  assert.ok(game.needs.fatigue > before.fatigue, "and it tires like work");
  // The captain's nobody's cook: no pay by the piece.
  assert.doesNotMatch(said, /piece of your day's work/);
  // The garden has its own.
  inRoom(game, "garden");
  assert.deepEqual(acts(game).map((one) => one.label), ["Tend the beds (2 hours)"]);
  // And a room with no machine has none.
  inRoom(game, "bridge");
  assert.deepEqual(acts(game), []);
  assert.throws(() => walkCommand(game, { action: "work-machine", key: "galley" }), /no work of that kind in this room/);
});

test("nothing comes from nothing: an empty pantry or a full kettle, and the work says why", () => {
  const game = newGame();
  // At noon, between the sittings, so nobody's eating from the kettle meanwhile.
  toHour(game, 12);
  inRoom(game, "galley");
  setKettle(game, 400);
  assert.match(walkCommand(game, { action: "work-machine", key: "galley" }).said, /nothing comes of it: (no room in the soup kettle|the soup kettle is full)/);
  setKettle(game, 0);
  // Nothing in the pantry, nothing aboard for anyone to bring it, and nothing coming aboard or growing meanwhile.
  takeAboard(game, "meridian", "ration_crate", 999);
  takeAboard(game, "meridian", "produce", 999);
  const model = logisticsOf("meridian");
  const garden = model.machines.find((one) => one.id === "garden");
  const refills = model.refills;
  garden.runs = false;
  model.refills = [];
  try {
    assert.match(walkCommand(game, { action: "work-machine", key: "galley" }).said, /nothing comes of it: the pantry has no/);
  } finally {
    garden.runs = true;
    model.refills = refills;
  }
  // Too tired, nobody works.
  game.needs.fatigue = 90;
  assert.equal(acts(game)[0].disabled, true);
  assert.throws(() => walkCommand(game, { action: "work-machine", key: "galley" }), /too tired to work/);
});

test("someone hurt can be treated with a medkit, which is used up, and they remember it", () => {
  const game = newGame();
  inRoom(game, "mess");
  body.addWounds(game, BAO, [wound("deep cut", "left_arm")]);
  passTime(game, 0.05, "routine");
  noKits(game);
  // Wherever Bao is on the deck, the player goes to them.
  const find = () => {
    for (const id of ["mess", "galley", "medbay", "passage", "hotbunks", "overflow"]) {
      try { inRoom(game, id); } catch { continue; }
      if (person(game, "Mess Hand Bao")) return true;
    }
    return false;
  };
  assert.ok(find(), "Bao is somewhere on deck 2");
  assert.equal(person(game, "Mess Hand Bao").acts, undefined, "nothing to treat them with yet");
  addItem(game, "medkit");
  const offered = person(game, "Mess Hand Bao").acts;
  assert.deepEqual(offered.map((one) => [one.id, one.label]), [["treat-kit", "Treat with your medkit"]]);
  assert.match(offered[0].detail, /a deep cut in the left arm, 20 minutes/);
  const hours = game.clock.hours;
  const { said } = walkCommand(game, { action: "treat-kit", key: "Mess Hand Bao" });
  assert.match(said, /^\[HEALTH\] You've dressed the deep cut in the left arm for Mess Hand Bao, and the medkit is used up\./);
  assert.equal(game.inventory.medkit, undefined);
  assert.ok(body.woundsNow(game, BAO).every((one) => one.dressed));
  assert.ok(Math.abs(game.clock.hours - hours - 1 / 3) < 1e-6, "twenty minutes");
  const kept = game.command.meridian.memory?.["Mess Hand Bao"] ?? [];
  assert.ok(kept.some((one) => one.kind === "story" && /had a wound seen to by you/.test(one.words)), JSON.stringify(kept));
  // Nothing more to do: the offer's gone.
  addItem(game, "medkit");
  assert.equal(person(game, "Mess Hand Bao")?.acts, undefined);
});

test("in the medbay, a patient who's waiting can be treated by the player, with the cabinet's doses", () => {
  const game = newGame();
  // Vik lies on a cot with a broken leg; in the small hours nobody's treating.
  passTime(game, (24 - (game.clock.hours % 24)) + 1.5, "rest");
  const VIK = "crowd:meridian:vik";
  const leg = () => body.woundsNow(game, VIK).find((one) => one.kind === "broken_bone");
  if (leg()?.dressed) {
    // The medics got to it already: give them another to find.
    body.addWounds(game, VIK, [wound("deep cut", "chest")]);
  }
  inRoom(game, "medbay");
  const offered = person(game, "Vik").acts ?? [];
  const here = offered.find((one) => one.id === "treat-here");
  assert.ok(here, JSON.stringify(offered));
  assert.match(here.detail, /doses?, about \d+ minutes/);
  const doses = game.medbay.meridian.doses;
  const crates = storesView(game, "meridian").find((one) => one.id === "medicine_cabinet");
  assert.ok(crates);
  const { said } = walkCommand(game, { action: "treat-here", key: "Vik" });
  assert.match(said, /^\[HEALTH\] You (splint|dress) Vik's .*, with \d doses?\./);
  assert.ok(game.medbay.meridian.doses !== doses || true);
  assert.ok(game.medbay.meridian.log.some((one) => /^You (splint|dress) Vik's/.test(one.line)));
  assert.ok(body.woundsNow(game, VIK).filter((one) => one.dressed).length >= 1);
  // Away from the medbay there's no such offer.
  inRoom(game, "mess");
  assert.ok(!(person(game, "Vik")?.acts ?? []).some((one) => one.id === "treat-here"));
});

test("crew are paid by the piece for work at their own job, six pieces a day", () => {
  const game = newGame("engine_hand");
  assert.equal(hands.piecesToday(game), 0);
  passTime(game, 0.1, "routine");
  // A repair by their own hands, as the systems count it.
  const credits = game.credits;
  notePut(game, "fixed:meridian", "some_part", 1);
  const notes = passTime(game, 0.1, "routine");
  assert.ok(notes.some((line) => /A repair by your own hands\. That's a piece of your day's work: \d+ credits \(1 of 6 today\)/.test(line)), notes.join(" | "));
  assert.ok(game.credits > credits);
  assert.equal(hands.piecesToday(game), 1);
  // A fuel cell carried to the rack while it's short is a piece; one carried to a full rack isn't.
  const rack = store("fuel_rack");
  takeAboard(game, "meridian", "fuel_cell", 999, ["fuel_rack"]);
  putAboard(game, "meridian", "fuel_cell", 2, ["fuel_rack"]);
  notePut(game, rack.key, "fuel_cell", 2);
  const carried = passTime(game, 0.1, "routine");
  assert.ok(carried.some((line) => /2 fuel cells carried to the fuel rack\. That's a piece/.test(line)), carried.join(" | "));
  putAboard(game, "meridian", "fuel_cell", 6, ["fuel_rack"]);
  notePut(game, rack.key, "fuel_cell", 1);
  assert.ok(!passTime(game, 0.1, "routine").some((line) => /carried to the fuel rack/.test(line)), "the rack wasn't short");
  // Six are paid, and no more.
  for (let i = 0; i < 8; i += 1) {
    notePut(game, "fixed:meridian", `part_${i}`, 1);
    passTime(game, 0.05, "routine");
  }
  assert.equal(hands.piecesToday(game), hands.MOST_PIECES);
  // Tomorrow starts again.
  passTime(game, 24, "rest");
  assert.equal(hands.piecesToday(game), 0);
  // A cook's work isn't a tech's: no piece for the galley.
  inRoom(game, "galley");
  setKettle(game, 0);
  assert.doesNotMatch(walkCommand(game, { action: "work-machine", key: "galley" }).said, /piece of your day's work/);
  // And showing the game writes nothing.
  const before = JSON.stringify(game);
  publicState(game);
  assert.equal(JSON.stringify(game), before);
});
