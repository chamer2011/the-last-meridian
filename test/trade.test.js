// Real trade (the hands-on plan, step 6): the captain can have the shuttle stores restocked from the dock, paid from
// the ship's purse, instead of from nothing; and carry cargo and passengers between ports for a fee.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-trade-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const { logisticsOf, refilledADay, stockOf, takeAboard } = await import("../src/logistics.js");
const { passTime } = await import("../src/rules.js");
const trade = await import("../src/trade.js");
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
const acts = (game) => walk.walkView(game).acts ?? [];
const crates = (game) => stockOf(game, "meridian", "ration_crate", "the shuttle stores");
const shuttle = () => logisticsOf("meridian").stores.find((one) => one.id === "shuttle_stores");
const emptySome = (game, n) => takeAboard(game, "meridian", "ration_crate", n, ["shuttle_stores"]);
// Ashore at a port with the ship docked there.
function ashore(game, place) {
  game.ship.at = place;
  game.location = place;
  game.walk = null;
  walk.walkView(game);
}
const tradeLines = (notes) => notes.filter((one) => one.startsWith("[TRADE]"));

test("the file reads, and the game's own is whole", () => {
  const model = trade.parseTrade(["the purse: 600 to begin with, 60 a day", "restocking: whenever", "tips: 5"].join("\n"));
  assert.deepEqual(model["the purse"], { start: 600, aDay: 60 });
  assert.match(model.problems[0], /line 2: "restocking" is written like: every 6 hours at a dock/);
  assert.match(model.problems[1], /line 3: a line here is one of: the purse, restocking/);
  assert.match(model.problems[2], /there's no line for restocking, a ration crate, a fuel cell, cargo, passengers/);
  assert.ok(trade.tradeRules(), "the game's own file has every line");
});

test("left alone, the stores fill from nothing as before; switched on, nothing comes in open space", () => {
  const game = newGame();
  inRoom(game, "lighter");
  assert.equal(shuttle().room, "lighter");
  const full = crates(game);
  emptySome(game, 4);
  passTime(game, 12, "rest");
  assert.equal(crates(game), full, "as it was: the crates come back");
  assert.ok(refilledADay(game, "meridian", "ration_crate") > 0);
  // The captain throws the switch in the Lighter Bay.
  const offered = acts(game).find((one) => one.id === "trade-switch");
  assert.deepEqual([offered.label, offered.detail], ["Restock from the dock, out of the purse", "the purse holds 600 credits"]);
  assert.match(walk.walkCommand(game, { action: "trade-switch" }).said, /^\[TRADE\] From now on the shuttle stores are restocked only at a dock/);
  assert.equal(game.ship.purse, 600);
  assert.equal(acts(game).find((one) => one.id === "trade-switch").label, "Go back to stores from nowhere");
  emptySome(game, 4);
  const low = crates(game);
  passTime(game, 12, "rest");
  assert.ok(crates(game) <= low, "in open space nothing comes aboard");
  assert.equal(refilledADay(game, "meridian", "ration_crate"), 0, "and the ledger no longer counts on it");
  // The levy came in at midnight, if one passed.
  assert.ok(game.ship.purse >= 600);
});

test("at a dock, what's missing is bought from the port out of the purse, and the port has less", () => {
  const game = newGame();
  inRoom(game, "lighter");
  walk.walkCommand(game, { action: "trade-switch" });
  game.ship.at = "haven";
  passTime(game, 6, "rest");
  const full = shuttle().holds.ration_crate;
  emptySome(game, crates(game));
  takeAboard(game, "meridian", "ration_crate", 99);
  assert.equal(crates(game), 0);
  const price = trade.crateprice(game, "haven", "ration_crate");
  assert.ok(price >= 1, `a crate costs ${price} at Haven`);
  const purse = game.ship.purse;
  const food = game.world.places.haven.goods.food;
  const notes = tradeLines(passTime(game, 6.1, "rest"));
  assert.match(notes[0], /^\[TRADE\] \d+ ration crates bought at Haven Station for \d+ credits, into the shuttle stores\. The purse holds \d+\.$/);
  const got = crates(game);
  assert.ok(got > 0 && got <= full, `${got} crates came`);
  assert.ok(game.ship.purse < purse, "and were paid for");
  assert.ok(game.world.places.haven.goods.food < food, "out of what Haven had");
  // An empty purse buys nothing but what the day's levy pays for, and never goes under.
  emptySome(game, crates(game));
  game.ship.purse = 0;
  passTime(game, 6.1, "active");
  assert.ok(crates(game) * price <= 60, `${crates(game)} crates on a day's levy`);
  assert.ok(game.ship.purse >= 0);
});

test("cargo and passengers are taken at a port and paid for where they're going", () => {
  const game = newGame();
  ashore(game, "haven");
  const offers = trade.offersAt(game, "haven");
  assert.equal(offers.cargo.length, 2);
  assert.ok(offers.party);
  const cargo = acts(game).filter((one) => one.id === "take-cargo");
  assert.equal(cargo.length, 2);
  assert.match(cargo[0].label, /^Take cargo for .+: \d+ crates$/);
  assert.match(cargo[0].detail, /^\d+ credits on arrival, within 10 days$/);
  const first = offers.cargo[0];
  assert.match(walk.walkCommand(game, { action: "take-cargo", key: first.id }).said, /go into the Meridian's hold/);
  assert.equal(game.ship.cargo.length, 1);
  assert.equal(trade.offersAt(game, "haven").cargo.length, 1, "it's offered once");
  const aboard = game.ship.aboard;
  const party = offers.party;
  assert.match(walk.walkCommand(game, { action: "take-passengers", key: party.id }).said, /passengers for .+ come aboard/);
  assert.equal(game.ship.aboard, aboard + party.n);
  assert.throws(() => walk.walkCommand(game, { action: "take-passengers", key: party.id }), /another ship/);
  // The ship gets to where the crates are going, in time, and then where the passengers are.
  const purse = game.ship.purse;
  game.ship.at = first.to;
  let notes = tradeLines(passTime(game, 1, "active"));
  assert.ok(notes.some((one) => new RegExp(`^\\[TRADE\\] The ${first.n} crates for .+ are unloaded\\. ${first.fee} credits into the ship's purse\\.$`).test(one)), notes.join(" | "));
  game.ship.at = party.to;
  notes = tradeLines(passTime(game, 1, "active"));
  assert.ok(notes.some((one) => /passengers go ashore/.test(one)) || first.to === party.to, notes.join(" | "));
  assert.equal(game.ship.aboard, aboard);
  assert.equal(game.ship.party, null);
  assert.equal(game.ship.purse, purse + first.fee + party.fee);
  // Late, the crates pay half.
  const late = newGame();
  ashore(late, "haven");
  const one = trade.offersAt(late, "haven").cargo[0];
  walk.walkCommand(late, { action: "take-cargo", key: one.id });
  const before = late.ship.purse;
  late.location = "meridian";
  late.walk = null;
  late.ship.at = null;
  passTime(late, 24 * 12, "routine");
  late.ship.at = one.to;
  const paid = tradeLines(passTime(late, 1, "active"));
  assert.ok(paid.some((line) => /late: half the fee/.test(line)), paid.join(" | "));
  assert.ok(late.ship.purse >= before + Math.floor(one.fee / 2));
});

test("none of it is anyone's but the captain's", () => {
  const game = newGame("engine_hand");
  inRoom(game, "lighter");
  assert.equal(acts(game).find((one) => one.id === "trade-switch"), undefined);
  assert.throws(() => walk.walkCommand(game, { action: "trade-switch" }), /captain's to decide/);
  assert.deepEqual(trade.offersAt(game, "haven"), { cargo: [], party: null });
});
