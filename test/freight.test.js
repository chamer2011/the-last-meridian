// The logistics rework, step 9: freight that's real. What a dock offers is a port's real surplus going where it's
// running low; it leaves the port when it's loaded, rides in the ship's freight hold as things, and goes into the far
// port's stores when she docks there. The fee follows the room it takes, the fuel the trip takes and how badly it's
// wanted. The captain can buy and sell any port's goods by the load for the ship's own account. The Market lists
// where each good is cheap and where it's dear, and the story can ask about a port's amounts and change them.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-freight-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const bag = await import("../src/bag.js");
const { storyCommand } = await import("../src/command.js");
const { holderOf, knownPlace } = await import("../src/daily.js");
const { FACTIONS, ITEMS } = await import("../src/data.js");
const { freightOffers, freightView, goodPrice, holdOf } = await import("../src/freight.js");
const { logisticsOf, storesView } = await import("../src/logistics.js");
const { amountOf, levelOf, portsModel } = await import("../src/ports.js");
const { passTime, publicState } = await import("../src/rules.js");
const { conditionHolds, parseCondition, parseEffect, parseSceneText } = await import("../src/scene-text.js");
const { sceneProblems } = await import("../src/scenes.js");
const { jumpCost, shipCommand, shipView } = await import("../src/ship.js");
const trade = await import("../src/trade.js");
const walk = await import("../src/walk.js");
const { readStoreLine, writeStoreLine } = await import("../public/logistics-text.js");

const SHIP = "meridian";
const newGame = (start = "captain") => {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  game.scene = null;
  return game;
};
// A captain's game docked at a port, the captain still aboard. Every port starts with what it usually holds, so
// nothing's offered until a test makes somewhere short.
const dockedAt = (place) => {
  const game = newGame();
  game.ship.at = place;
  return game;
};
const m = () => portsModel();
const has = (game, port, good) => amountOf(game.world, port, good);
// A port's stock of a good set to so many hundredths of what it usually holds.
function level(game, port, good, hundredths) {
  const supply = m().supplyOf[good];
  if (supply && game.world.places[port]?.goods?.[supply] !== undefined) game.world.places[port].goods[supply] = hundredths;
  else ((game.world.ports ??= {})[port] ??= {})[good] = hundredths;
  assert.ok(Math.abs(levelOf(game.world, port, good) - hundredths) < 0.001);
}
const inHold = (game, item) => storesView(game, SHIP).find((one) => one.id === "freight_hold").items.find((one) => one.id === item)?.n ?? 0;
const order = (game, body) => shipCommand(game, body);
const offerFor = (game, good, to) => freightOffers(game).find((one) => one.good === good && one.to === to);
const tradeLines = (notes) => notes.filter((one) => one.startsWith("[TRADE]"));

// ---- The files ------------------------------------------------------------------------------------------

test("the ship has a freight hold, every good a hold can carry is an item, and the trade file has the freight line", () => {
  const hold = holdOf();
  assert.deepEqual([hold.id, hold.name, hold.roomName, hold.freight, hold.holds], ["freight_hold", "freight hold", "The Aft Holds", true, {}]);
  const read = readStoreLine("freight hold in The Aft Holds: holds freight: Tie-down rings.");
  assert.deepEqual([read.freight, read.holds, read.look], [true, [], "Tie-down rings."]);
  assert.equal(writeStoreLine(read), "freight hold in The Aft Holds: holds freight: Tie-down rings.");
  assert.deepEqual(logisticsOf(SHIP).problems, []);
  // Forty-four goods ride in a hold, each as its own item; a wreck doesn't.
  const goods = m().order.map((id) => m().goods[id]);
  assert.deepEqual(goods.filter((good) => !good.item).map((good) => good.id), ["wrecks"]);
  assert.equal(new Set(goods.filter((good) => good.item).map((good) => good.item)).size, 44, "no two goods are the same item");
  for (const good of goods.filter((one) => one.item)) {
    const item = ITEMS[good.item];
    assert.ok(item.price >= 1 && bag.weightOf(item) > 0 && bag.stackOf(item) >= 1 && item.desc, good.item);
  }
  assert.deepEqual([m().goods.meal.item, m().goods.ration_crates.item, m().goods.jump_fuel.item, m().goods.medkits.item], ["meal", "ration_crate", "jump_fuel", "medkit_case"]);
  // What goes in a ship's tank is jump fuel, by the measure; a refinery's drum doesn't any more.
  assert.equal(ITEMS.jump_fuel.effect?.fuel, 1);
  assert.equal(ITEMS.refined_fuel.effect?.fuel, undefined);
  assert.deepEqual(trade.tradeRules().freight, { offers: 3, rate: 4, days: 8 });
  // A new game's hold is empty, and the ship's food doesn't count what's in it.
  const game = newGame();
  const view = shipView(game).freight;
  assert.deepEqual(view.hold, { name: "freight hold", room: "The Aft Holds", squares: { taken: 0, of: 30 }, lines: [] });
  assert.deepEqual([view.at, view.offers, view.goods, view.carrying], [null, [], [], []]);
});

// ---- Freight for hire -------------------------------------------------------------------------------------

test("a dock offers what it can spare to a port the captain knows of that's running low, and nothing else", () => {
  const game = dockedAt("haven");
  assert.deepEqual(freightOffers(game), [], "with every port at its usual, nobody wants anything carried");
  // Tessen Colony down to half its medicine: it usually holds ten crates, so it's five short, and Haven can spare them.
  level(game, "frontier", "medicine_crates", 50);
  const fuel = jumpCost(game, "frontier").fuel;
  assert.deepEqual(freightOffers(game).map((one) => [one.good, one.to, one.n, one.squares, one.fee, one.days, one.level]), [["medicine_crates", "frontier", 5, 5, Math.round(4 * 5 * fuel * 1.5), 8, "short"]]);
  // The fee is by the room it takes and the fuel the trip takes, times how badly it's wanted: scarcer pays more.
  level(game, "frontier", "medicine_crates", 20);
  assert.equal(offerFor(game, "medicine_crates", "frontier").fee, Math.round(4 * 8 * fuel * 2.2), "eight crates short, and scarce");
  // A big order is as much as twelve squares of the hold take: ration crates sit two to a square.
  level(game, "kessara", "ration_crates", 85);
  const crates = offerFor(game, "ration_crates", "kessara");
  assert.deepEqual([crates.n, crates.squares], [24, 12]);
  assert.equal(crates.fee, Math.round(4 * 12 * jumpCost(game, "kessara").fuel * 1.1125));
  // The best paid first, and three at the most.
  for (const [port, good] of [["graveyard", "medicine_crates"], ["vantor", "tea_and_tobacco"], ["anselm", "ration_crates"]]) level(game, port, good, 40);
  const offered = freightOffers(game);
  assert.equal(offered.length, 3);
  assert.deepEqual(offered.map((one) => one.fee), [...offered.map((one) => one.fee)].sort((a, b) => b - a));
  assert.equal(new Set(offered.map((one) => one.to)).size, 3, "one load to a port");
  // Not from a port that has none to spare.
  level(game, "haven", "medicine_crates", 90);
  assert.equal(offerFor(game, "medicine_crates", "frontier"), undefined);
  level(game, "haven", "medicine_crates", 100);
  // Not to a port the captain doesn't know of, however short it is.
  assert.equal(knownPlace(game, "wheel"), false);
  level(game, "wheel", "ration_crates", 10);
  assert.equal(offerFor(game, "ration_crates", "wheel"), undefined);
  // Not back to where this port gets it from, and not to a port that makes its own unless it's really short.
  level(game, "frontier", "ration_crates", 40);
  assert.equal(offerFor(game, "ration_crates", "frontier"), undefined, "Haven's crates come from Tessen Colony");
  const kessara = dockedAt("kessara");
  level(kessara, "graveyard", "parts_crates", 85);
  assert.equal(offerFor(kessara, "parts_crates", "graveyard"), undefined, "the Graveyard makes its own");
  level(kessara, "graveyard", "parts_crates", 60);
  assert.ok(offerFor(kessara, "parts_crates", "graveyard"), "until it's short of them");
  // In open space, and for anyone who isn't her captain, there's nothing.
  game.ship.at = null;
  assert.deepEqual(freightOffers(game), []);
  assert.equal(shipView(newGame("engine_hand")).freight, null);
});

test("a load taken leaves the port, rides in the hold as things, and goes into the far port's stores when she docks there", () => {
  const game = dockedAt("haven");
  level(game, "frontier", "medicine_crates", 50);
  const offer = offerFor(game, "medicine_crates", "frontier");
  const before = { haven: has(game, "haven", "medicine_crates"), tessen: has(game, "frontier", "medicine_crates"), purse: trade.purseOf(game), own: game.credits };
  const shown = shipView(game).freight.offers[0];
  assert.deepEqual([shown.what, shown.to, shown.level, shown.fee, shown.fits], ["5 medicine crates", "Tessen Colony", "short", offer.fee, true]);
  const { message } = order(game, { action: "freight-take", id: offer.id });
  assert.equal(message, `5 medicine crates for Tessen Colony are craned into the freight hold: ${offer.fee} credits when they get there, within 8 days.`);
  assert.ok(Math.abs(before.haven - has(game, "haven", "medicine_crates") - 5) < 0.001, "Haven has five fewer");
  assert.equal(inHold(game, "medicine_crate"), 5);
  assert.equal(trade.purseOf(game), before.purse, "nothing's paid until it's delivered");
  assert.equal(offerFor(game, "medicine_crates", "frontier"), undefined, "and it isn't offered twice in a day");
  assert.throws(() => order(game, { action: "freight-take", id: offer.id }), /That load's gone/);
  const view = shipView(game).freight;
  assert.deepEqual(view.hold.squares, { taken: 5, of: 30 });
  assert.deepEqual(view.hold.lines, [{ item: "medicine_crate", name: "Medicine Crate", n: 5, own: 0, good: "medicine_crates" }]);
  assert.deepEqual(view.carrying.map((one) => [one.what, one.to, one.fee, one.late, one.here]), [["5 medicine crates", "Tessen Colony", offer.fee, false, false]]);
  // The ship's own medicine is her cabinet's, not her cargo.
  assert.equal(shipView(game).supplies.find((one) => one.id === "medicine").stock, 5);
  // It's a store like any other: walk to the Aft Holds and open it.
  walk.walkCommand(game, { action: "room", to: "aft" });
  bag.bagCommand(game, { action: "open", key: "thing:meridian:store:freight_hold" });
  assert.deepEqual(bag.bagView(game).open.items.map((one) => [one.id, one.n]), Array(5).fill(["medicine_crate", 1]));
  bag.bagCommand(game, { action: "close" });
  // Docked at Tessen Colony: unloaded into its stores, and paid for.
  game.ship.at = "frontier";
  const told = tradeLines(passTime(game, 0.2, "routine"));
  assert.deepEqual(told, [`[TRADE] 5 medicine crates for Tessen Colony are unloaded. ${offer.fee} credits into the ship's purse.`]);
  assert.ok(Math.abs(has(game, "frontier", "medicine_crates") - before.tessen - 5) < 0.001, "Tessen has five more");
  assert.equal(trade.purseOf(game), before.purse + offer.fee);
  assert.equal(game.credits, before.own);
  assert.equal(inHold(game, "medicine_crate"), 0);
  assert.deepEqual(game.ship.cargo, []);
  assert.ok(game.ship.log.some((one) => /unloaded/.test(one.text)));
});

test("late pays half, what isn't in the hold isn't paid for, and a load that doesn't fit isn't taken", () => {
  const game = dockedAt("haven");
  level(game, "frontier", "medicine_crates", 50);
  const offer = offerFor(game, "medicine_crates", "frontier");
  order(game, { action: "freight-take", id: offer.id });
  const purse = trade.purseOf(game);
  // Nine days in open space: a day late.
  game.ship.at = null;
  for (let day = 0; day < 9; day += 1) passTime(game, 24, "routine");
  assert.equal(shipView(game).freight.carrying[0].late, true);
  const levy = trade.purseOf(game) - purse;
  game.ship.at = "frontier";
  const told = tradeLines(passTime(game, 0.2, "routine")).filter((one) => /unloaded/.test(one));
  assert.deepEqual(told, [`[TRADE] 5 medicine crates for Tessen Colony are unloaded, late: half the fee. ${Math.round(offer.fee / 2)} credits into the ship's purse.`]);
  // Two of five gone from the hold on the way: three are paid for, and whoever holds the port thinks less of her.
  const short = dockedAt("haven");
  level(short, "kessara", "medicine_crates", 50);
  const load = offerFor(short, "medicine_crates", "kessara");
  assert.ok(load.n >= 5, `${load.n} crates`);
  order(short, { action: "freight-take", id: load.id });
  const hold = holdOf();
  assert.equal(bag.storeTake(short, hold.key, hold.holds, "medicine_crate", 2), 2);
  const holder = holderOf(short, "kessara");
  const standing = short.factions[holder];
  const before = trade.purseOf(short);
  short.ship.at = "kessara";
  const said = tradeLines(passTime(short, 0.2, "routine")).filter((one) => /unloaded/.test(one));
  const paid = Math.round(load.fee * ((load.n - 2) / load.n));
  assert.match(said[0], new RegExp(`medicine crates for Kessara Drift are unloaded, 2 short\\. ${paid} credits into the ship's purse\\.$`));
  assert.equal(trade.purseOf(short), before + paid);
  if (FACTIONS[holder]) assert.equal(short.factions[holder], standing - 1);
  // A full hold takes nothing more.
  const full = dockedAt("haven");
  full.ship.purse = 100000;
  for (let i = 0; i < 6; i += 1) order(full, { action: "freight-buy", id: "parts_crates", n: 5 });
  assert.deepEqual(shipView(full).freight.hold.squares, { taken: 30, of: 30 });
  level(full, "frontier", "medicine_crates", 50);
  assert.equal(shipView(full).freight.offers[0].fits, false);
  assert.throws(() => order(full, { action: "freight-take", id: offerFor(full, "medicine_crates", "frontier").id }), /There isn't the room in the freight hold for 5 medicine crates: there's room for 0/);
  assert.ok(levy >= 0);
});

// ---- Her own account ----------------------------------------------------------------------------------------

test("she buys a port's goods by the load out of the purse, and sells what's hers where a port holds that good", () => {
  const game = dockedAt("haven");
  const before = { port: has(game, "haven", "medicine_crates"), purse: trade.purseOf(game), own: game.credits };
  const first = shipView(game).freight.goods.find((one) => one.good === "medicine_crates");
  assert.deepEqual([first.name, first.has, first.level, first.own, first.room], ["Medicine Crate", 140, "normal", 0, 30]);
  assert.ok(first.sell < first.buy && first.sell >= Math.floor(first.buy / 2) - 1, `buys at ${first.buy}, sells at ${first.sell}`);
  const bought = order(game, { action: "freight-buy", id: "medicine_crates", n: 5 });
  const spent = before.purse - trade.purseOf(game);
  assert.equal(bought.message, `Bought 5 medicine crates at Haven Station for ${spent} credits, into the freight hold.`);
  assert.ok(spent >= first.buy * 5 && spent <= first.buy * 5 + 6, `each one bought makes the next a little dearer: ${spent} for five at ${first.buy}`);
  assert.ok(Math.abs(before.port - has(game, "haven", "medicine_crates") - 5) < 0.001);
  assert.equal(inHold(game, "medicine_crate"), 5);
  assert.equal(game.credits, before.own, "the ship's purse pays, not the captain");
  assert.equal(shipView(game).freight.goods.find((one) => one.good === "medicine_crates").own, 5);
  // Sold straight back, she's lost about half: buying always costs more than selling pays.
  const back = order(game, { action: "freight-sell", id: "medicine_crates", n: 2 });
  assert.match(back.message, /^Sold 2 medicine crates at Haven Station for \d+ credits, out of the freight hold\.$/);
  const got = Number(back.message.match(/for (\d+) credits/)[1]);
  assert.ok(got < (spent / 5) * 2 * 0.62, `${got} for two that cost ${Math.round((spent / 5) * 2)}`);
  // Carried to where they're scarce, the three that are left pay.
  level(game, "frontier", "medicine_crates", 20);
  game.ship.at = "frontier";
  const there = has(game, "frontier", "medicine_crates");
  const purse = trade.purseOf(game);
  const sold = order(game, { action: "freight-sell", id: "medicine_crates", n: 60 });
  assert.match(sold.message, /^Sold 3 medicine crates at Tessen Colony for \d+ credits/);
  const paid = trade.purseOf(game) - purse;
  assert.ok(paid > (spent / 5) * 3, `${paid} for three that cost ${Math.round((spent / 5) * 3)}`);
  assert.ok(Math.abs(has(game, "frontier", "medicine_crates") - there - 3) < 0.001, "and Tessen has three more");
  assert.throws(() => order(game, { action: "freight-sell", id: "medicine_crates", n: 1 }), /There's none of that in the freight hold/);
  // What a port doesn't hold, it doesn't deal in; an empty purse buys nothing, and there's no slate for cargo.
  assert.throws(() => order(game, { action: "freight-buy", id: "machines", n: 1 }), /Nobody at Tessen Colony deals in that/);
  game.ship.purse = 0;
  assert.throws(() => order(game, { action: "freight-buy", id: "ration_crates", n: 1 }), /Nothing bought: the purse holds 0 credits and the next costs \d+/);
  assert.equal(trade.slateOf(game, "frontier"), 0);
  game.ship.at = null;
  assert.throws(() => order(game, { action: "freight-buy", id: "ration_crates", n: 1 }), /docked at a port/);
});

test("what she carries for someone isn't hers to sell, and a measure of jump fuel from the hold goes in the tank", () => {
  const game = dockedAt("haven");
  level(game, "frontier", "medicine_crates", 50);
  order(game, { action: "freight-take", id: offerFor(game, "medicine_crates", "frontier").id });
  assert.throws(() => order(game, { action: "freight-sell", id: "medicine_crates", n: 1 }), /carried for someone else/);
  order(game, { action: "freight-buy", id: "medicine_crates", n: 2 });
  assert.equal(shipView(game).freight.hold.lines[0].own, 2);
  assert.match(order(game, { action: "freight-sell", id: "medicine_crates", n: 60 }).message, /^Sold 2 medicine crates/);
  assert.equal(inHold(game, "medicine_crate"), 5, "the five she's carrying are still there");
  // Jump fuel is a thing now: bought by the measure, carried in the hold, and poured in by hand.
  order(game, { action: "freight-buy", id: "jump_fuel", n: 2 });
  assert.equal(inHold(game, "jump_fuel"), 2);
  walk.walkCommand(game, { action: "room", to: "aft" });
  bag.bagCommand(game, { action: "open", key: "thing:meridian:store:freight_hold" });
  const measure = bag.bagView(game).open.items.find((one) => one.id === "jump_fuel");
  bag.bagCommand(game, { action: "move", from: { at: "open", x: measure.x, y: measure.y }, to: { at: "pack", x: 7, y: 4 } });
  bag.bagCommand(game, { action: "close" });
  bag.bagCommand(game, { action: "split", from: { at: "pack", x: 7, y: 4 } });
  const fuel = game.ship.fuel;
  bag.bagCommand(game, { action: "use", from: { at: "pack", x: 7, y: 4 } });
  assert.equal(game.ship.fuel, fuel + 1);
  assert.equal(game.inventory.jump_fuel, 1);
});

// ---- The Market's list ---------------------------------------------------------------------------------------

test("the Market lists what this port's goods cost and where each good is cheap and dear, among the ports the captain knows", () => {
  const game = dockedAt("haven");
  const before = JSON.stringify(game);
  const view = publicState(game).ship.freight;
  assert.equal(JSON.stringify(game), before, "reading it changes nothing");
  assert.deepEqual(view.at, { id: "haven", name: "Haven Station" });
  assert.equal(view.purse, 600);
  assert.equal(view.goods.length, 22, "the goods Haven holds that a hold can carry");
  for (const one of view.goods) assert.ok(one.name && one.buy >= 1 && one.sell <= one.buy && one.has >= 0 && one.room >= 0, JSON.stringify(one));
  assert.equal(goodPrice(game, "haven", "wrecks"), null);
  assert.equal(goodPrice(game, "frontier", "machines"), null, "Tessen Colony holds no machines");
  // Prices: only ports the captain knows of, the cheapest and the dearest for each good.
  const known = new Set(Object.keys(m().ports).filter((id) => knownPlace(game, id)));
  assert.ok(known.size >= 6 && known.size < Object.keys(m().ports).length);
  for (const one of view.prices) {
    assert.ok(known.has(one.cheap.place) && known.has(one.dear.place), JSON.stringify(one));
    assert.ok(one.cheap.price < one.dear.price);
  }
  const crates = view.prices.find((one) => one.good === "ration_crates");
  assert.deepEqual([crates.name, crates.cheap.name, crates.here], ["Ration Crate", "Tessen Colony", view.goods.find((one) => one.good === "ration_crates").buy]);
  // A port that's short of a thing is where it's dear.
  level(game, "graveyard", "medicine_crates", 15);
  assert.equal(shipView(game).freight.prices.find((one) => one.good === "medicine_crates").dear.name, "The Graveyard");
  assert.ok(JSON.stringify(view).length < 14000, `${JSON.stringify(view).length} characters`);
});

// ---- The story ------------------------------------------------------------------------------------------------

test("the story can ask how many of a good a port holds, and change it", () => {
  const game = newGame();
  const holds = (text) => {
    assert.deepEqual(parseCondition(text).problems, [], text);
    return conditionHolds(game, text);
  };
  assert.equal(holds("goods ration crates >= 4500 at haven"), true);
  assert.equal(holds("goods ration crates < 4000 at Haven Station"), false);
  const play = (text) => storyCommand(game, parseEffect(text).do);
  assert.deepEqual(play("goods ration crates -600 at haven: The convoy never came."), ["[WORLD] Haven Station: 600 ration crates gone from its stores. The convoy never came."]);
  assert.ok(Math.abs(has(game, "haven", "ration_crates") - 3900) < 0.01);
  assert.equal(holds("goods ration crates < 4000 at haven"), true);
  assert.equal(shipView({ ...game, ship: { ...game.ship, at: "haven" } }).trade.find((one) => one.id === "food").level, "normal");
  assert.match(play("goods meal 40 at haven: A hold of meal comes in from Tessen.")[0], /^\[WORLD\] Haven Station: 40 sacks of meal more in its stores\./);
  // It can't take more than there is.
  assert.match(play("goods medicine crates -999 at frontier: The fever takes it all.")[0], /^\[WORLD\] Tessen Colony: 10 medicine crates gone from its stores\./);
  assert.equal(holds("goods medicine crates = 0 at frontier"), true);
  // What's wrong with a line is said in plain words, and the checker reads them in a scene like anything else.
  assert.match(parseCondition("goods ration crates < 200").problems[0], /needs a good, one of >= <= > < = !=, a number, then at and a port/);
  assert.match(parseCondition("goods moon dust < 2 at haven").problems[0], /no good called moon dust in world\/goods/);
  assert.match(parseCondition("goods machines < 2 at frontier").problems[0], /Tessen Colony doesn't hold machines/);
  assert.match(parseCondition("goods meal < 2 at nowhere").problems[0], /no port called nowhere with a file in world\/ports/);
  assert.match(parseEffect("goods meal -5 at haven").problem, /needs a colon and the reason/);
  assert.match(parseEffect("goods meal at haven: x").problem, /goods is written \* goods a good, a number, then at and a port/);
  const { scene, problems } = parseSceneText("== start\nSomething.\n? goods grain < 5 at meridian -> start\n* goods ore -5 at haven: x\n> Go -> end\n== end\nThe end.\nEND\n", "test_goods");
  const found = [...problems.map((one) => one.message ?? String(one)), ...sceneProblems(scene, "test_goods")];
  assert.ok(found.some((one) => /no port called meridian with a file/.test(one)), JSON.stringify(found));
  assert.ok(found.some((one) => /Haven Station doesn't hold ore/.test(one)), JSON.stringify(found));
});

// ---- Games from before ----------------------------------------------------------------------------------------

test("crates a game from before was carrying are still unloaded and paid for, and passengers are as they were", () => {
  const game = dockedAt("haven");
  game.ship.cargo = [{ id: "0:haven:0", to: "kessara", n: 7, fee: 105, by: 10 }];
  assert.deepEqual(shipView(game).freight.carrying, [], "they aren't things in the hold");
  const purse = trade.purseOf(game);
  game.ship.at = "kessara";
  const told = tradeLines(passTime(game, 0.2, "routine"));
  assert.ok(told.includes("[TRADE] The 7 crates for Kessara Drift are unloaded. 105 credits into the ship's purse."), told.join(" | "));
  assert.equal(trade.purseOf(game), purse + 105);
  assert.deepEqual(game.ship.cargo, []);
  // Passengers: offered ashore, a party a week.
  game.location = "kessara";
  game.walk = null;
  walk.walkView(game);
  const { party } = trade.offersAt(game, "kessara");
  assert.ok(party && party.n >= 4 && party.n <= 10 && party.fee === party.n * 10);
  assert.equal(trade.offersAt(game, "kessara").cargo, undefined, "the made-up cargo is gone");
});
