// The ship's trade: world/trade.txt, and passengers carried between ports for a fee paid into the ship's purse. How
// she's restocked at a dock, the slate and the distress call are in living-off-ports.test.js, and freight in
// freight.test.js.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-trade-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
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
// Ashore at a port with the ship docked there.
function ashore(game, place) {
  game.ship.at = place;
  game.location = place;
  game.walk = null;
  walk.walkView(game);
}
const tradeLines = (notes) => notes.filter((one) => one.startsWith("[TRADE]"));

test("the file reads, and the game's own is whole", () => {
  const model = trade.parseTrade(["the purse: 600 to begin with, 60 a day", "the slate: whenever", "tips: 5"].join("\n"));
  assert.deepEqual(model["the purse"], { start: 600, aDay: 60 });
  assert.match(model.problems[0], /line 2: "the slate" is written like: 1\.5 times the price, up to 300 credits a port, standing falls 1 a day until it's paid/);
  assert.match(model.problems[1], /line 3: a line here is one of: the purse, a ration crate, a fuel cell, the slate, while she owes, a distress call, freight, passengers/);
  assert.match(model.problems[2], /there's no line for a ration crate, a fuel cell, the slate, while she owes, a distress call, freight, passengers/);
  assert.equal(model.whole, false);
  const rules = trade.tradeRules();
  assert.ok(rules, "the game's own file has every line");
  assert.deepEqual(rules.problems, []);
  // A crate goes by the port's food price and a cell by its fuel price, and a port that sells neither sells neither.
  const game = newGame();
  assert.ok(trade.unitPrice(game, "haven", "ration_crate") >= 1);
  assert.ok(trade.unitPrice(game, "haven", "fuel_cell") < trade.unitPrice(game, "wheel", "fuel_cell") + 3);
  assert.equal(trade.unitPrice(game, "graveyard", "ration_crate"), null);
  assert.equal(trade.unitPrice(game, "graveyard", "fuel_cell"), null);
  assert.equal(trade.unitPrice(game, "haven", "medicine_crate"), null, "only what the dock restocks has a price here");
});

test("passengers are taken at a port and paid for where they're going", () => {
  const game = newGame();
  ashore(game, "haven");
  const { party } = trade.offersAt(game, "haven");
  assert.ok(party && party.n >= 4 && party.n <= 10);
  assert.equal(party.fee, party.n * 10);
  const offered = acts(game).filter((one) => one.id === "take-passengers");
  assert.equal(offered.length, 1);
  assert.match(offered[0].label, /^Take \d+ passengers to .+$/);
  assert.deepEqual(acts(game).filter((one) => one.id === "take-cargo"), [], "the crates nobody ever saw are gone: freight is on the Market's page");
  const aboard = game.ship.aboard;
  assert.match(walk.walkCommand(game, { action: "take-passengers", key: party.id }).said, /passengers for .+ come aboard/);
  assert.equal(game.ship.aboard, aboard + party.n);
  assert.equal(trade.offersAt(game, "haven").party, null, "it's offered once");
  assert.throws(() => walk.walkCommand(game, { action: "take-passengers", key: party.id }), /another ship/);
  // The ship gets to where they're going. Whatever the docks sold her on the way came out of the same purse.
  const spentAt = (lines) => lines.reduce((sum, one) => sum + Number(one.match(/bought at .+ for (\d+) credits/)?.[1] ?? 0) - Number(one.match(/, (\d+) of it on the slate/)?.[1] ?? 0), 0);
  const purse = trade.purseOf(game);
  game.ship.at = party.to;
  const notes = tradeLines(passTime(game, 1, "active"));
  assert.ok(notes.some((one) => new RegExp(`^\\[TRADE\\] The ${party.n} passengers go ashore at .+\\. ${party.fee} credits into the ship's purse\\.$`).test(one)), notes.join(" | "));
  assert.equal(game.ship.aboard, aboard);
  assert.equal(game.ship.party, null);
  assert.equal(trade.purseOf(game), purse + party.fee - spentAt(notes));
});

test("none of it is anyone's but the captain's", () => {
  const game = newGame("engine_hand");
  inRoom(game, "lighter");
  assert.deepEqual(acts(game).filter((one) => /^take-|^trade-/.test(one.id)), []);
  assert.deepEqual(trade.offersAt(game, "haven"), { party: null });
  ashore(game, "haven");
  assert.deepEqual(trade.offersAt(game, "haven"), { party: null });
  assert.throws(() => walk.walkCommand(game, { action: "take-passengers", key: "0:haven:p" }), /another ship/);
});
