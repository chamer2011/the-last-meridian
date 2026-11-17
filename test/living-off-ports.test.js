// The logistics rework, step 8: the ship lives off the ports. Nothing comes aboard from nowhere any more: at a dock the
// shuttle stores are restocked with real crates and cells out of the port's own stores, paid for from the ship's
// purse; in open space nothing comes. A port sells only what it has. The purse pays for what the captain buys for her
// and gets what she sells. With an empty purse a port puts what she needs on the slate, dearer, and standing there
// falls until it's paid; and a ship that can't get herself to any port can call for help. The Ship menu says what a
// day costs and how long the money and the stores will last.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-living-off-ports-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const { holderOf } = await import("../src/daily.js");
const { FACTIONS, ITEMS } = await import("../src/data.js");
const { countAboard, logisticsOf, manifestLines, powerSupply, putAboard, storesView, takeAboard } = await import("../src/logistics.js");
const { amountOf, portsModel } = await import("../src/ports.js");
const { passTime } = await import("../src/rules.js");
const { changeCommand, jumpCost, shipCommand, shipView } = await import("../src/ship.js");
const trade = await import("../src/trade.js");
const { readRefillLine } = await import("../public/logistics-text.js");

const newGame = (start = "captain", seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const SHIP = "meridian";
// Everything of a thing aboard, and what one store has of it.
const aboard = (game, item) => countAboard(game, SHIP, [item]).n;
const inStore = (game, store, item) => storesView(game, SHIP).find((one) => one.id === store).items.find((one) => one.id === item)?.n ?? 0;
const has = (game, port, good) => amountOf(game.world, port, good);
const tradeLines = (notes) => notes.filter((one) => one.startsWith("[TRADE]"));
const supply = (game, id) => shipView(game).supplies.find((one) => one.id === id);
const row = (game, id) => shipView(game).trade.find((one) => one.id === id);
// Docked, with the captain still aboard, and the clock moved a little so that the dock's count of the hours has begun:
// nothing's bought the moment she comes in.
function dockedAt(place, start = "captain") {
  const game = newGame(start);
  game.ship.at = place;
  assert.deepEqual(tradeLines(passTime(game, 0.1, "routine")), []);
  return game;
}
// A day at a time, from wherever the clock is.
const days = (game, count) => {
  const notes = [];
  for (let day = 0; day < count; day += 1) notes.push(...passTime(game, 24, "routine"));
  return notes;
};
// A port's stock of something set to so many, where its amounts are real.
function leave(game, port, good, n) {
  const usual = portsModel().ports[port].holds[good].usual;
  const supplyOf = portsModel().goods[good].supply;
  if (supplyOf && portsModel().trees[portsModel().goods[good].tree]?.stands === good) game.world.places[port].goods[supplyOf] = (n / usual) * 100;
  else ((game.world.ports ??= {})[port] ??= {})[good] = (n / usual) * 100;
  assert.ok(Math.abs(has(game, port, good) - n) < 0.01, `${port} has ${has(game, port, good)} ${good}`);
}

// ---- The files ----------------------------------------------------------------------------------------

test("the ship's files say it: her stores are restocked from the dock, sized for two weeks away, and the trade file has the slate and the distress call", () => {
  const model = logisticsOf(SHIP);
  assert.deepEqual(model.refills.map((one) => [one.store, one.items, one.from, one.every, one.upTo]), [["shuttle_stores", ["ration_crate", "fuel_cell"], "dock", 360, "full"], ["water_tank", ["water"], "dock", 360, "full"]]);
  assert.deepEqual(model.stores.find((one) => one.id === "shuttle_stores").holds, { ration_crate: 24, fuel_cell: 36, parts_crate: 6 });
  assert.equal(readRefillLine("the pantry: produce from nothing, every 6 hours").from, "nothing", "a file can still say from nothing");
  const rules = trade.tradeRules();
  assert.deepEqual(rules["the purse"], { start: 600, aDay: 60 });
  assert.deepEqual(rules["the slate"], { times: 1.5, limit: 300, falls: 1 });
  assert.deepEqual(rules["while she owes"], { share: 0.33 });
  assert.deepEqual(rules["a distress call"], { days: 3, times: 2 });
  // A fuel cell is the generator's, a few credits at a dock, and no longer pours into the jump tank.
  assert.equal(ITEMS.fuel_cell.effect?.fuel, undefined);
  assert.ok(ITEMS.fuel_cell.price <= 15);
  const game = newGame();
  assert.deepEqual([aboard(game, "fuel_cell"), aboard(game, "ration_crate"), aboard(game, "produce")], [42, 36, 24], "a new game's stores are full");
  assert.deepEqual(trade.cellsOf(game), { n: 42, of: 42, aDay: 3, days: 14, holding: false });
});

// ---- Restocking -----------------------------------------------------------------------------------------

test("in open space nothing comes aboard, whatever's missing, and the levy still comes into the purse", () => {
  const game = newGame();
  assert.equal(game.ship.at, null);
  takeAboard(game, SHIP, "fuel_cell", 10, ["shuttle_stores"]);
  takeAboard(game, SHIP, "ration_crate", 6, ["shuttle_stores"]);
  const cells = aboard(game, "fuel_cell");
  const notes = days(game, 2);
  assert.deepEqual(tradeLines(notes), []);
  assert.deepEqual(manifestLines(game, SHIP), [], "nothing's written in the manifest");
  assert.equal(aboard(game, "fuel_cell"), cells - 6, "the generator has burned six cells, and none came");
  assert.ok(inStore(game, "shuttle_stores", "ration_crate") <= 18);
  assert.equal(trade.purseOf(game), 600 + 2 * 60);
  const view = shipView(game);
  assert.equal(view.money.cost, null, "nothing's bought out here");
  assert.equal(view.money.dock, null);
  assert.equal(view.refills[0].does, "ration crates and fuel cells bought at the dock, every 6 hours, up to full");
});

test("at a dock what's missing is bought out of the port's own stores, at its price that day, from the purse", () => {
  const game = dockedAt("haven");
  takeAboard(game, SHIP, "fuel_cell", 10, ["shuttle_stores"]);
  takeAboard(game, SHIP, "ration_crate", 6, ["shuttle_stores"]);
  const before = { cells: has(game, "haven", "fuel_cells"), crates: has(game, "haven", "ration_crates"), purse: trade.purseOf(game), own: game.credits };
  const cell = trade.unitPrice(game, "haven", "fuel_cell");
  const crate = trade.unitPrice(game, "haven", "ration_crate");
  assert.ok(cell >= 4 && cell <= 9 && crate >= 4 && crate <= 9, `a cell costs ${cell} at Haven and a crate ${crate}`);
  // Noon comes round: the dock's next six hours.
  const said = tradeLines(passTime(game, 5, "routine"));
  assert.equal(said.length, 1, said.join(" | "));
  const cost = 6 * crate + 10 * cell;
  assert.equal(said[0], `[TRADE] 6 ration crates and 10 fuel cells bought at Haven Station for ${cost} credits, into the shuttle stores. The purse holds ${before.purse - cost}.`);
  assert.deepEqual([inStore(game, "shuttle_stores", "ration_crate"), inStore(game, "shuttle_stores", "fuel_cell")], [24, 36], "the shuttle stores are full again");
  assert.equal(trade.purseOf(game), before.purse - cost);
  assert.equal(game.credits, before.own, "the captain's own credits aren't touched");
  assert.ok(Math.abs(before.cells - has(game, "haven", "fuel_cells") - 10) < 0.01, "Haven has ten cells fewer");
  assert.ok(Math.abs(before.crates - has(game, "haven", "ration_crates") - 6) < 0.01, "and six crates fewer");
  assert.deepEqual(manifestLines(game, SHIP), [`Day 1, 12:00: 6 ration crates and 10 fuel cells bought at Haven Station for ${cost} credits, into the shuttle stores.`]);
  assert.match(shipView(game).refills[0].last, /^Day 1, 12:00: 6 ration crates and 10 fuel cells bought at Haven Station/);
});

test("a port sells only what it has: no fuel, no cells; six left, six sold; none left, none", () => {
  // The Sundial sells food and no fuel: crates come, cells don't.
  const farm = dockedAt("sundial");
  takeAboard(farm, SHIP, "fuel_cell", 10, ["shuttle_stores"]);
  takeAboard(farm, SHIP, "ration_crate", 6, ["shuttle_stores"]);
  assert.equal(trade.unitPrice(farm, "sundial", "fuel_cell"), null);
  const said = tradeLines(passTime(farm, 5, "routine"));
  assert.match(said[0], /^\[TRADE\] 6 ration crates bought at the Sundial for \d+ credits, into the shuttle stores\./);
  assert.equal(inStore(farm, "shuttle_stores", "fuel_cell"), 26, "no cells came");
  assert.equal(trade.cellsOf(farm).holding, false);
  // Haven with six cells left sells six, and then has none.
  const low = dockedAt("haven");
  takeAboard(low, SHIP, "fuel_cell", 20, ["shuttle_stores"]);
  leave(low, "haven", "fuel_cells", 6.5);
  const six = tradeLines(passTime(low, 5, "routine"));
  assert.match(six[0], /^\[TRADE\] 6 fuel cells bought at Haven Station for \d+ credits/);
  assert.equal(inStore(low, "shuttle_stores", "fuel_cell"), 22);
  assert.ok(has(low, "haven", "fuel_cells") < 1);
  assert.deepEqual(tradeLines(passTime(low, 6, "routine")), [], "and at the next six hours there are none to sell");
  assert.equal(trade.cellsOf(low).holding, false, "so her cells aren't holding, dock or no dock");
});

// ---- The purse ------------------------------------------------------------------------------------------

test("the purse is the ship's: it pays for a lot bought for her, gets what she sells, and the captain can put their own credits in", () => {
  const game = dockedAt("haven");
  game.credits = 415;
  game.ship.fuel = 3;
  const fuel = row(game, "fuel");
  assert.deepEqual([fuel.buys, fuel.pays, fuel.slate], ["1", "purse", 0]);
  shipCommand(game, { action: "buy", id: "fuel" });
  assert.equal(trade.purseOf(game), 600 - fuel.price);
  assert.equal(game.credits, 415);
  const sell = row(game, "medicine").sellFor;
  shipCommand(game, { action: "sell", id: "medicine" });
  assert.equal(trade.purseOf(game), 600 - fuel.price + sell);
  assert.equal(game.credits, 415);
  const { message } = shipCommand(game, { action: "purse", n: 50 });
  assert.equal(message, `You put 50 of your own credits into the ship's purse. It holds ${600 - fuel.price + sell + 50}.`);
  assert.equal(game.credits, 365);
  assert.throws(() => shipCommand(game, { action: "purse", n: 1000 }), /You have 365 credits of your own/);
  assert.throws(() => shipCommand(game, { action: "purse", n: 0 }), /How many/);
});

test("the purse goes with the chair, whoever has it, and whoever has it pays for the restocking", () => {
  const game = newGame();
  game.ship.purse = 450;
  changeCommand(game, { takes: false, reason: "Relieved" });
  assert.equal(game.ship.chair.funds, 450, "whoever takes the chair has the ship's money");
  assert.equal(trade.purseOf(game), 450);
  game.ship.chair.funds = 320;
  changeCommand(game, { takes: true, reason: "Restored" });
  assert.equal(game.ship.chair, null);
  assert.equal(trade.purseOf(game), 320, "and it comes back with the chair");
  // Someone else's ship from the start: the chair's funds are the purse.
  const theirs = dockedAt("haven", "engine_hand");
  const funds = theirs.ship.chair.funds;
  takeAboard(theirs, SHIP, "fuel_cell", 10, ["shuttle_stores"]);
  const cell = trade.unitPrice(theirs, "haven", "fuel_cell");
  const said = tradeLines(passTime(theirs, 5, "routine"));
  assert.match(said[0], /^\[TRADE\] 10 fuel cells bought at Haven Station/);
  assert.equal(theirs.ship.chair.funds, funds - 10 * cell);
  assert.equal(trade.purseOf(theirs), theirs.ship.chair.funds);
  assert.throws(() => shipCommand(theirs, { action: "purse", n: 10 }));
});

// ---- The slate ------------------------------------------------------------------------------------------

test("with an empty purse the port keeps her going on the slate, dearer; standing falls each day it's owed, and what's left in the purse at midnight pays it", () => {
  const game = dockedAt("haven");
  const holder = holderOf(game, "haven");
  assert.ok(FACTIONS[holder], "someone holds Haven");
  // The same game with money, to tell what the debt did to her standing from whatever else the days did.
  const twin = JSON.parse(JSON.stringify(game));
  game.ship.purse = 0;
  // Six cells left in the shuttle stores: under a third of the thirty-six they hold.
  for (const one of [game, twin]) takeAboard(one, SHIP, "fuel_cell", 30, ["shuttle_stores"]);
  const cell = trade.unitPrice(game, "haven", "fuel_cell");
  const each = Math.ceil(cell * 1.5);
  const said = tradeLines(passTime(game, 5, "routine"));
  passTime(twin, 5, "routine");
  assert.equal(said[0], `[TRADE] 6 fuel cells bought at Haven Station for ${6 * each} credits, ${6 * each} of it on the slate, into the shuttle stores. The purse holds 0. It's on the slate at Haven Station, half again dearer. Whatever's left in the purse each midnight goes to it, and your standing with the ${FACTIONS[holder].name.replace(/^The /, "")} falls a little every day until it's paid. Until then the dock only keeps her going.`);
  assert.equal(inStore(game, "shuttle_stores", "fuel_cell"), 12, "a third of full, and no more");
  assert.equal(inStore(twin, "shuttle_stores", "fuel_cell"), 36, "where the purse can pay she's filled to the top");
  assert.deepEqual(trade.slates(game).map((one) => [one.place, one.owed]), [["haven", 6 * each]]);
  const view = shipView(game).money;
  assert.deepEqual(view.slates.map((one) => [one.name, one.owed, one.holder]), [["Haven Station", 6 * each, FACTIONS[holder].name]]);
  // Day by day: the levy pays the day's needs at the usual price, what's left at midnight goes to the slate, and each
  // midnight it's still owed her standing with whoever holds Haven falls by one.
  let falls = 0;
  const told = [];
  for (let day = 0; day < 8 && trade.slateOf(game, "haven") > 0; day += 1) {
    const owed = trade.slateOf(game, "haven");
    told.push(...passTime(game, 24, "routine"));
    passTime(twin, 24, "routine");
    assert.ok(trade.slateOf(game, "haven") <= owed, "it only goes down: the day's needs come out of the levy, at the usual price");
    if (trade.slateOf(game, "haven") > 0) {
      falls += 1;
      assert.ok(inStore(game, "shuttle_stores", "fuel_cell") <= 12, "and while she owes the dock only keeps her going");
    }
  }
  assert.equal(trade.slateOf(game, "haven"), 0, "paid within the week");
  assert.ok(told.includes("[TRADE] The slate at Haven Station is paid."), told.filter((one) => one.startsWith("[TRADE]")).join(" | "));
  assert.ok(falls >= 1);
  assert.equal(game.factions[holder], twin.factions[holder] - falls, "one off her standing for each midnight it was owed");
  // And once it's paid the dock fills her up again, as fast as the purse allows.
  days(game, 2);
  assert.ok(inStore(game, "shuttle_stores", "fuel_cell") > 12, `${inStore(game, "shuttle_stores", "fuel_cell")} cells in the shuttle stores`);
});

test("the captain can buy on the slate too, as far as the port gives credit, and no further", () => {
  const game = dockedAt("haven");
  game.ship.purse = 0;
  game.ship.fuel = 2;
  const fuel = row(game, "fuel");
  assert.deepEqual([fuel.pays, fuel.slate], ["slate", Math.ceil(fuel.price * 1.5)]);
  const { message } = shipCommand(game, { action: "buy", id: "fuel" });
  assert.match(message, new RegExp(`^Bought 1 of fuel for the ship, for ${fuel.price} credits\\. The purse couldn't cover it: ${fuel.slate} credits are owed\\. It's on the slate at Haven Station, half again dearer\\.`));
  assert.equal(trade.slateOf(game, "haven"), fuel.slate);
  assert.equal(game.ship.fuel, 3);
  // With part of the price in the purse, only the rest goes on the slate.
  game.ship.purse = 10;
  const next = row(game, "fuel");
  assert.equal(next.slate, Math.ceil((next.price - 10) * 1.5));
  shipCommand(game, { action: "buy", id: "fuel" });
  assert.equal(trade.purseOf(game), 0);
  assert.equal(trade.slateOf(game, "haven"), fuel.slate + next.slate);
  // Up to three hundred credits a port.
  game.ship.slate.haven.owed = 290;
  assert.equal(row(game, "fuel").pays, null);
  assert.throws(() => shipCommand(game, { action: "buy", id: "fuel" }), /purse holds 0 credits, and Haven Station won't put any more on the slate/);
  assert.equal(game.ship.fuel, 4, "and nothing came aboard");
  // Another port keeps its own slate.
  game.ship.at = "kessara";
  assert.equal(row(game, "fuel").pays, "slate");
});

// ---- A ship that can't get to any port ----------------------------------------------------------------------

test("a distress call is for a ship that can't get herself to a port: answered in about three days, at twice the price, out of the nearest port's stores", () => {
  const game = newGame();
  assert.equal(shipView(game).stranded, null);
  assert.throws(() => shipCommand(game, { action: "distress" }), /can still get herself to a port/);
  game.ship.fuel = 0;
  assert.deepEqual(shipView(game).stranded, { why: "fuel", words: "There isn't the fuel in her tank for even the shortest jump.", sent: false, due: null, days: 3, times: 2, from: "Haven Station" });
  assert.match(shipCommand(game, { action: "distress" }).message, /^The distress call is out\. Someone should answer in about 3 days, and they'll charge twice the usual/);
  assert.throws(() => shipCommand(game, { action: "distress" }), /already out/);
  assert.equal(shipView(game).stranded.sent, true);
  // Two days on, nothing yet.
  const waiting = days(game, 2);
  assert.equal(game.ship.fuel, 0);
  assert.ok(!waiting.some((one) => /tanker/.test(one)));
  assert.equal(shipView(game).stranded.due, 1);
  // The same game without the call, to see what the tanker took out of Haven's stores.
  const twin = JSON.parse(JSON.stringify(game));
  delete twin.ship.distress;
  const purse = trade.purseOf(game);
  const told = days(game, 1);
  days(twin, 1);
  const wanted = jumpCost(game, "haven").fuel + 1;
  const line = told.find((one) => /tanker/.test(one));
  assert.match(line, new RegExp(`^\\[SHIP\\] A tanker out of Haven Station has answered the distress call: ${wanted} fuel for the tank, for (\\d+) credits\\. She can make Haven Station on that\\.$`));
  const cost = Number(line.match(/for (\d+) credits/)[1]);
  assert.equal(game.ship.fuel, wanted, "enough to reach Haven, and one over");
  assert.equal(trade.purseOf(game), purse + 60 - cost, "out of the purse, with the day's levy in");
  assert.ok(cost >= wanted * 40 * 2 * 0.7 && cost <= wanted * 40 * 2 * 1.6, `${cost} credits for ${wanted} fuel, at twice Haven's price`);
  assert.ok(Math.abs(has(twin, "haven", "jump_fuel") - has(game, "haven", "jump_fuel") - wanted) < 0.05, "and Haven has that much less jump fuel");
  assert.equal(shipView(game).stranded, null);
  assert.equal(game.ship.distress, undefined);
});

test("with no cells and a dead generator she's stranded too; the tanker brings cells, and what the purse can't pay is owed where it came from", () => {
  const game = newGame();
  takeAboard(game, SHIP, "fuel_cell", 99);
  passTime(game, 9, "routine");
  assert.equal(powerSupply(game, SHIP), 0, "the cell that was in the generator has burned out");
  assert.equal(shipView(game).stranded.why, "power");
  // And nothing in the tank either, with an empty purse: the bill is more than the days' levy.
  game.ship.fuel = 0;
  shipCommand(game, { action: "distress" });
  days(game, 2);
  game.ship.purse = 0;
  const told = days(game, 1);
  const line = told.find((one) => /tanker/.test(one));
  // Enough to reach Haven and one over, and one more because with no power her navigation is down and the jump is
  // plotted by hand.
  const wanted = jumpCost(game, "haven").fuel + 2;
  assert.match(line, new RegExp(`^\\[SHIP\\] A tanker out of Haven Station has answered the distress call: ${wanted} fuel for the tank and 6 fuel cells, for (\\d+) credits, (\\d+) of it on the slate there\\. She can make Haven Station on that\\.$`));
  const [, cost, owed] = line.match(/for (\d+) credits, (\d+) of it/).map(Number);
  assert.ok(owed > 0 && owed <= cost);
  assert.ok(owed >= cost - 60, "all but a day's levy, at most");
  assert.equal(trade.slateOf(game, "haven"), owed, "owed at Haven, though she's never docked there");
  assert.ok(aboard(game, "fuel_cell") >= 2 && aboard(game, "fuel_cell") <= 6, `${aboard(game, "fuel_cell")} cells aboard, less what the generator has burned since`);
  assert.ok(powerSupply(game, SHIP) > 0, "and the generator's running again");
});

test("whoever else has the chair calls for help themselves", () => {
  const game = newGame("engine_hand");
  game.ship.at = null;
  game.ship.fuel = 0;
  days(game, 1);
  assert.ok(game.ship.distress, "sent at the first midnight");
  let most = 0;
  for (let day = 0; day < 5; day += 1) {
    days(game, 1);
    most = Math.max(most, game.ship.fuel);
  }
  assert.ok(most >= 2, `the tank has had ${most} in it since`);
  assert.ok(game.ship.log.some((one) => /^A tanker out of .+ has answered the distress call/.test(one.text)), game.ship.log.map((one) => one.text).join(" | "));
});

// ---- What the Ship menu says ------------------------------------------------------------------------------

test("the Ship menu says what a day costs and how long the money and the stores will last: holding at a dock, counted in days away from one", () => {
  const out = newGame();
  const away = supply(out, "food");
  assert.ok(away.days >= 17 && away.days <= 23, `${away.days} days of food in open space`);
  assert.equal(away.bought, 0);
  assert.equal(shipView(out).money.cells.holding, false);
  const game = dockedAt("haven");
  const food = supply(game, "food");
  assert.equal(food.days, null, "holding: the dock sends what the garden doesn't grow");
  assert.ok(food.bought > 1 && food.bought < 5, `the dock sends ${food.bought} crates a day`);
  assert.ok(Math.abs(food.made + food.bought - food.used) < 0.01);
  const money = shipView(game).money;
  assert.deepEqual([money.purse, money.levy], [600, 60]);
  assert.equal(money.cells.holding, true);
  assert.equal(money.cells.days, 14, "and away from a dock, what's aboard lasts two weeks");
  assert.deepEqual(Object.keys(money.dock), ["name", "crate", "cell", "water", "every"]);
  assert.equal(money.dock.every, 6);
  // The cells her generator burns, the fuel she uses keeping station, the water, and what's eaten beyond what the garden grows.
  assert.ok(money.cost >= 40 && money.cost <= 60, `a day at Haven costs ${money.cost}`);
  assert.equal(money.moneyDays, null, "the levy covers it");
  // Where a day costs more than comes in, the purse has days to it.
  game.ship.at = "wheel";
  const dear = shipView(game).money;
  assert.ok(dear.cost > 60, `a day at the Gilded Wheel costs ${dear.cost}`);
  assert.equal(dear.moneyDays, Math.floor(600 / (dear.cost - 60)));
  const before = JSON.stringify(game);
  shipView(game);
  assert.equal(JSON.stringify(game), before, "reading it changes nothing");
});

test("a careful captain breaks even: a month at Haven, buying what she needs, and the purse is about where it began", () => {
  const game = dockedAt("haven");
  const tryBuy = (id) => { try { shipCommand(game, { action: "buy", id }); return true; } catch { return false; } };
  // One thing the purse has to stand: about once a month one of the old stories' clocks takes every ration crate
  // aboard at a stroke (they're still written in the fleet's amounts), and she buys them back at the next six hours.
  let hungry = 0;
  for (let day = 0; day < 30; day += 1) {
    days(game, 1);
    while (game.ship.fuel < 4 && tryBuy("fuel"));
    while (aboard(game, "medicine_crate") < 2 && tryBuy("medicine"));
    while (aboard(game, "parts_crate") < 6 && tryBuy("parts"));
    hungry += game.logistics.meridian.meals?.days?.[Math.floor(game.clock.hours / 24) - 1]?.missed ?? 0;
    assert.ok(powerSupply(game, SHIP) > 0, `day ${day + 1}: the generator's stopped`);
  }
  const purse = trade.purseOf(game);
  assert.ok(purse >= 500 && purse <= 1300, `the purse holds ${purse} after a month, from 600`);
  assert.deepEqual(trade.slates(game), []);
  assert.ok(hungry <= 30 * 1800 * 0.02, `${hungry} sittings missed in a month: a bad morning at most`);
  assert.ok(aboard(game, "fuel_cell") >= 36 && inStore(game, "shuttle_stores", "ration_crate") >= 20, "with her stores kept up");
});

// ---- Games from before, and the test save ------------------------------------------------------------------

test("a game from before is told once that the stores no longer fill themselves; a new one isn't", () => {
  const old = newGame();
  delete old.ship.restocked;
  const first = tradeLines(passTime(old, 0.1, "routine"));
  assert.equal(first.length, 1);
  assert.match(first[0], /^\[TRADE\] From now on nothing comes aboard from nowhere\. Ration crates and fuel cells are bought at a dock, out of the port's own stores and the ship's purse \(600 credits\), and in open space nothing comes\. The fuel cells aboard last about 14 days\. The Ship menu has the purse and what a day costs\.$/);
  assert.ok(old.ship.log.some((one) => /^From now on nothing comes aboard from nowhere/.test(one.text)), "and it's in her log");
  assert.deepEqual(tradeLines(passTime(old, 0.1, "routine")), []);
  // The one number the old switch kept counts as from before too.
  const switched = newGame();
  switched.ship.restocked = 720;
  assert.equal(tradeLines(passTime(switched, 0.1, "routine")).length, 1);
  assert.deepEqual(tradeLines(passTime(newGame(), 0.1, "routine")), []);
});

test("the test save's always-full switch keeps the fuel cells full as well as the tank", () => {
  const game = newGame();
  game.test = { fuel: true };
  takeAboard(game, SHIP, "fuel_cell", 99);
  game.ship.fuel = 1;
  passTime(game, 0.5, "routine");
  assert.equal(aboard(game, "fuel_cell"), 42);
  assert.equal(game.ship.fuel, game.ship.maxFuel);
  days(game, 20);
  assert.ok(aboard(game, "fuel_cell") >= 41);
  assert.ok(powerSupply(game, SHIP) > 0);
  // And without the switch, that's a ship that's gone dark. (Her reserve air lasts five days more, to about day 20.)
  const plain = newGame();
  days(plain, 16);
  assert.equal(aboard(plain, "fuel_cell"), 0);
  assert.equal(powerSupply(plain, SHIP), 0);
  putAboard(plain, SHIP, "fuel_cell", 3, ["fuel_rack"]);
  passTime(plain, 0.2, "routine");
  assert.ok(powerSupply(plain, SHIP) > 0, "until a cell's put in the rack");
});
