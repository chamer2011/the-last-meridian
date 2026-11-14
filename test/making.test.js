// Salvage made into parts crates, step 6 of the loot plan: each piece of salvage counts for its item file's salvage
// number, and the logistics file's salvage makes line says what the bench makes from how much, where, how long it
// takes and which store it goes into. In the Repair Bay, You can offers it, greyed with the reason while there isn't
// enough; making it uses the least valuable salvage first, takes less time with Engineering, and puts the crate into
// the parts lockers, or the pack when they're full.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-making-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const lg = await import("../src/logistics.js");
const making = await import("../src/making.js");
const { readMaking, writeMaking, parseLogisticsText } = await import("../public/logistics-text.js");
const { putsOf } = await import("../src/puts.js");
const walk = await import("../src/walk.js");

const SHIP = "meridian";
function newGame() {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  game.walk = null;
  walk.walkCommand(game, { action: "room", to: "repair" });
  return game;
}
const actOf = (game) => (walk.walkView(game).acts ?? []).find((one) => one.id === "make-from-salvage");
const make = (game) => walk.walkCommand(game, { action: "make-from-salvage", key: "parts_crate" });

test("the salvage makes line reads and writes back, and says what's wrong in plain words", () => {
  const line = "1 parts crate from 10 salvage, in The Repair Bay, in 2 hours, into the parts lockers or the shuttle stores";
  const read = readMaking(line);
  assert.deepEqual(read, { n: 1, what: "parts crate", per: 10, room: "The Repair Bay", hours: 2, into: ["parts lockers", "shuttle stores"] });
  assert.equal(writeMaking(read), line);
  assert.equal(readMaking("nothing").n, 0);
  assert.match(readMaking("a parts crate").problem, /from how much salvage/);
  assert.match(readMaking("1 parts crate from 10 salvage").problem, /needs the room/);
  assert.match(readMaking("1 parts crate from 10 salvage, in The Repair Bay, quickly").problem, /isn't something a salvage makes line says/);
  const model = lg.logisticsOf(SHIP).making;
  assert.deepEqual({ item: model.item, n: model.n, per: model.per, room: model.room, hours: model.hours, into: model.into }, { item: "parts_crate", n: 1, per: 10, room: "repair", hours: 2, into: ["parts_lockers"] });
  const file = parseLogisticsText("# CFS Meridian\nsalvage makes: 1 parts crate from 10 salvage, in The Moon Room, in 2 hours, into the wine cellar\n");
  assert.deepEqual(file.problems, []);
  assert.equal(file.value.making.room, "The Moon Room", "the words are the reader's; the rooms and stores are the game's to check");
});

test("in the Repair Bay, You can offers it, greyed with the reason until the player carries enough salvage", () => {
  const game = newGame();
  const none = actOf(game);
  assert.ok(none, "offered in the Repair Bay");
  assert.equal(none.disabled, true);
  assert.equal(none.detail, "It takes 10 salvage, and you carry none.");
  game.inventory.scrap = 6;
  assert.equal(actOf(game).detail, "It takes 10 salvage, and you carry 6.");
  assert.throws(() => make(game), /It takes 10 salvage, and you carry 6/);
  Object.assign(game.inventory, { circuit_board: 2, reactor_seal_ring: 1 });
  const some = actOf(game);
  assert.ok(!some.disabled, some.detail);
  assert.equal(some.detail, "uses 10 of your 25 salvage, the least valuable first");
  game.walk = null;
  walk.walkCommand(game, { action: "room", to: "galley" });
  assert.equal(actOf(game), undefined, "only where the line says");
});

test("making one uses the least valuable salvage first, passes the hours less with Engineering, and fills the parts lockers", () => {
  const game = newGame();
  Object.assign(game.inventory, { scrap: 6, circuit_board: 2, reactor_seal_ring: 1 });
  // A crate's room in the parts lockers.
  lg.takeAboard(game, SHIP, "parts_crate", 1, ["parts_lockers"]);
  const before = lg.stockOf(game, SHIP, "parts_crate", "parts lockers");
  const aboard = putsOf(game, "aboard", "parts_crate");
  game.skills = { ...(game.skills ?? {}), engineering: 3 };
  const start = game.clock.hours;
  const { said } = make(game);
  assert.match(said, /^\[WORK\] You spend 1 hour 24 minutes at the bench and make a parts crate from 6 scrap and 2 circuit boards\. It goes into the parts lockers\./);
  assert.ok(Math.abs(game.clock.hours - start - 1.4) < 0.01, "two hours less three tenths");
  assert.equal(game.inventory.scrap ?? 0, 0);
  assert.equal(game.inventory.circuit_board ?? 0, 0);
  assert.equal(game.inventory.reactor_seal_ring, 1, "the seal ring's worth more for what it counts, so it's kept");
  assert.equal(lg.stockOf(game, SHIP, "parts_crate", "parts lockers"), before + 1);
  assert.equal(putsOf(game, "aboard", "parts_crate"), aboard + 1, "a crate made counts as one brought aboard");
  assert.equal(game.inventory.parts_crate ?? 0, 0);
});

test("with the parts lockers full the crate goes into the pack, and Engineering never takes it under half", () => {
  const game = newGame();
  game.inventory.scrap = 10;
  game.skills = { ...(game.skills ?? {}), engineering: 9 };
  assert.equal(lg.stockOf(game, SHIP, "parts_crate", "parts lockers"), 6, "they start full");
  const { said } = make(game);
  assert.match(said, /in 1 hour at the bench|spend 1 hour at the bench/);
  assert.match(said, /It goes into your pack\./);
  assert.equal(game.inventory.parts_crate, 1);
  assert.equal(making.makingHours(game, lg.logisticsOf(SHIP).making), 1);
});
