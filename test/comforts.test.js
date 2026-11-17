// The logistics rework, step 12: comforts aboard. The crew uses up drink, tea and tobacco, and clothes, a little every
// day, out of the comforts locker in the Long Mess; an item's own file says what one of it is worth. While things are
// going wrong, every comfort they still have steadies morale, and every one they've run out of sours it. After a hard
// day the quartermaster has the provisions laid out, and morale lifts. They're bought at a dock from the Ship menu, the
// beer bucket and the still make a little of the drink, and something given to someone aboard is remembered.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-comforts-"));
const logisticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-comforts-files-"));
fs.copyFileSync(new URL("../world/logistics/meridian.txt", import.meta.url), path.join(logisticsDir, "meridian.txt"));
process.env.GAME_LOGISTICS_DIR = logisticsDir;
const lawDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-comforts-law-"));
for (const name of fs.readdirSync(new URL("../world/law/", import.meta.url))) fs.copyFileSync(new URL(`../world/law/${name}`, import.meta.url), path.join(lawDir, name));
process.env.GAME_LAW_DIR = lawDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const bag = await import("../src/bag.js");
const { placeMoments } = await import("../src/chatter.js");
const comforts = await import("../src/comforts.js");
const command = await import("../src/command.js");
const { ITEMS } = await import("../src/data.js");
const { forgetLaw, lawOf, lawProblems } = await import("../src/law.js");
const { logisticsOf, logisticsProblems, machinesView, storeById, worthLine } = await import("../src/logistics.js");
const { amountOf } = await import("../src/ports.js");
const { checkExtras } = await import("../src/room-hooks.js");
const { addItem, passTime } = await import("../src/rules.js");
const { shipCommand, shipView } = await import("../src/ship.js");
const { clearMaps, walkCommand, walkView } = await import("../src/walk.js");
const { reloadLogistics } = await import("../src/world.js");
const worth = await import("../src/worth.js");
const text = await import("../public/logistics-text.js");

const SHIP = "meridian";
const FILE = fs.readFileSync(path.join(logisticsDir, "meridian.txt"), "utf8");
const LAW = fs.readFileSync(path.join(lawDir, "meridian.txt"), "utf8");
// A captain past the opening, who doesn't breathe, on a ship where nothing wears out by itself.
const newGame = (seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  game.character.species = "synthetic";
  game.wearDay = Infinity;
  return game;
};
const model = () => logisticsOf(SHIP);
const locker = () => storeById(model(), "comforts_locker");
// The generator never runs out of cells, and the tank never of water.
const keepGoing = (game) => {
  game.logistics.meridian.machines.generator = { progress: 0, made: 0, waiting: null, burning: 1e9 };
  (game.stores ??= {})[storeById(model(), model().water.tank).key] = { count: 1e9 };
};
// What the locker holds, set by hand: a list of [item, how many].
const fill = (game, list) => {
  (game.stores ??= {})[locker().key] = { items: [] };
  for (const [id, n] of list) bag.containerPut(game, locker().key, { cols: 6, rows: 5 }, id, n);
};
const inLocker = (game) => bag.storeCounts(game, locker().key, locker().holds);
const state = (game) => game.logistics.meridian.comforts;
const hours = (game, n) => passTime(game, n, "routine");
const toHour = (game, hour) => passTime(game, (((hour - (game.clock.hours % 24)) % 24) + 24) % 24 || 24, "routine");
const view = (game) => shipView(game).comforts;
const kind = (game, id) => view(game).kinds.find((one) => one.id === id);
const inRoom = (game, room) => {
  game.walk = null;
  walkCommand(game, { action: "room", to: room });
};
const person = (game, key) => walkView(game).people.find((one) => one.key === key);
const gifts = (game, key) => (person(game, key)?.acts ?? []).filter((one) => one.id.startsWith("give-gift"));
const some = (lines, pattern) => assert.ok(lines.some((one) => pattern.test(one)), `${pattern} in: ${lines.join(" | ") || "nothing"}`);
const none = (lines, pattern) => assert.ok(!lines.some((one) => pattern.test(one)), `${pattern} shouldn't be in: ${lines.join(" | ")}`);
// The logistics file as a test wants it, read again by the game.
const withFile = (change, run) => {
  fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), change(FILE));
  reloadLogistics();
  clearMaps();
  forgetLaw();
  try {
    return run();
  } finally {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), FILE);
    reloadLogistics();
    clearMaps();
    forgetLaw();
  }
};
const withLaw = (change, run) => {
  fs.writeFileSync(path.join(lawDir, "meridian.txt"), change(LAW));
  forgetLaw();
  try {
    return run();
  } finally {
    fs.writeFileSync(path.join(lawDir, "meridian.txt"), LAW);
    forgetLaw();
  }
};

test("the file says what the crew uses and what it does, reads back as written, and says what's wrong with it", () => {
  assert.deepEqual(logisticsProblems(), []);
  const c = model().comforts;
  assert.equal(c.store, "comforts_locker");
  assert.deepEqual(c.uses, { drink: 20, leaf: 20, clothes: 10 });
  assert.deepEqual([c.steadies, c.sours, c.tableLifts], [2, 2, 6]);
  assert.equal(locker().roomName, "The Long Mess");
  assert.deepEqual(Object.keys(locker().holds).sort(), ["beer_and_spirits", "clothes", "crawlway_moonshine", "provisions", "ship_brewed_beer", "tea_and_tobacco"]);
  assert.equal(text.writeLogisticsText(text.parseLogisticsText(FILE).value), FILE, "the file reads back exactly");
  assert.deepEqual(text.readCrewUses("20 drink, 20 tea and tobacco, 10 clothes a day, from the comforts locker"), { uses: { drink: 20, leaf: 20, clothes: 10 }, from: "comforts locker" });
  assert.match(text.readCrewUses("20 rum a day, from the comforts locker").problem, /a number and a comfort/);
  assert.match(text.readCrewUses("20 drink a day").problem, /which store/);
  const problems = (change) => withFile(change, () => logisticsProblems().join(" | "));
  assert.match(problems((file) => file.replace("from the comforts locker", "from the wine cellar")), /no store called wine cellar for the crew's comforts/);
  assert.match(problems((file) => file.replace("from the comforts locker", "from the soup kettle")), /things kept in a store/);
  assert.match(problems((file) => file.replace(/^the crew uses:.*\n/m, "")), /doesn't say what the crew uses/);
  assert.match(problems((file) => file.replace(" 2 bales of clothes,", "")), /the crew uses clothes, and nothing the comforts locker holds is worth any/);
});

test("an item's file says what it's worth as a comfort and as a gift, and the checker reads the lines", () => {
  assert.deepEqual(worth.comfortOf("beer_and_spirits"), { kind: "drink", n: 80 });
  assert.deepEqual(worth.comfortOf("ship_brewed_beer"), { kind: "drink", n: 1 });
  assert.deepEqual(worth.comfortOf("tea_and_tobacco"), { kind: "leaf", n: 100 });
  assert.deepEqual(worth.comfortOf("clothes"), { kind: "clothes", n: 100 });
  assert.deepEqual(worth.comfortOf("crew_jumpsuit"), { kind: "clothes", n: 3 });
  assert.deepEqual(worth.comfortOf("provisions"), { kind: "table", n: 300 });
  assert.equal(worth.comfortOf("ration_crate"), null);
  assert.equal(worth.giftOf("fine_things"), 8);
  assert.equal(worth.giftOf("vantor_red_wine"), 6);
  assert.equal(worth.giftOf("ration_crate"), 0);
  // Only garments that stop nothing are clothes for the crew.
  for (const [id, item] of Object.entries(ITEMS)) if (item.type === "armor" && worth.comfortOf(id)) assert.ok(!(item.defense > 0), `${id} stops something`);
  assert.equal(worthLine(SHIP, "beer_and_spirits"), "80 of the crew's drink, once it's in the comforts locker.");
  assert.equal(worthLine(SHIP, "vantor_red_wine"), "3 of the crew's drink, once it's in the comforts locker. Given to someone, it's remembered.");
  assert.equal(worthLine(SHIP, "fine_things"), "Given to someone, it's remembered.");
  assert.deepEqual(checkExtras().filter((one) => /comfort|gift/.test(one)), []);
  ITEMS.test_comfort = { name: "Test comfort", comfort: "lots of drink", gift: 0 };
  try {
    const problems = checkExtras().filter((one) => one.includes("test_comfort"));
    some(problems, /comfort is written like 80 drink/);
    some(problems, /gift is a number above nothing/);
  } finally {
    delete ITEMS.test_comfort;
  }
});

test("the crew uses a little of each every day, the loose bottles before a keg, and fewer aboard use less", () => {
  const game = newGame();
  keepGoing(game);
  assert.deepEqual(view(game).kinds.map((one) => [one.id, one.left, one.days]), [["drink", 416, 20], ["leaf", 400, 20], ["clothes", 200, 20]]);
  hours(game, 24);
  // Twenty of drink went, in the ship's beer, and no keg has been broached; a chest and a bale are open.
  const after = inLocker(game);
  assert.equal(after.ship_brewed_beer, 28);
  assert.equal(after.beer_and_spirits, 4);
  assert.equal(after.tea_and_tobacco, 3);
  assert.equal(after.clothes, 1);
  assert.deepEqual(view(game).kinds.map((one) => [one.id, one.left]), [["drink", 396], ["leaf", 380], ["clothes", 190]]);
  // With a third of them aboard, a third as much goes.
  game.ship.aboard = 300;
  hours(game, 24);
  assert.deepEqual(view(game).kinds.map((one) => Math.round(one.left)), [389, 373, 187]);
  assert.equal(kind(game, "drink").aDay, 6.7);
});

test("anything in the locker that's worth some counts, whether or not the locker's line names it", () => {
  const game = newGame();
  keepGoing(game);
  fill(game, [["tea_brick", 3], ["korrun_stone_ale", 2], ["crew_jumpsuit", 1]]);
  assert.deepEqual(view(game).kinds.map((one) => [one.id, one.left]), [["drink", 4], ["leaf", 12], ["clothes", 3]]);
  hours(game, 2);
  const after = inLocker(game);
  assert.equal(after.tea_brick, 2, "a tea brick is open");
  assert.equal(after.korrun_stone_ale, 1);
  assert.equal(after.crew_jumpsuit ?? 0, 0);
});

test("running out is said once, sours where morale settles, dries the tea urn and is talked about; a chest puts it right", () => {
  const game = newGame();
  keepGoing(game);
  fill(game, [["beer_and_spirits", 2], ["clothes", 1]]);
  assert.equal(shipView(game).moraleTarget, 60);
  const told = hours(game, 2);
  some(told, /The crew has run out of tea and tobacco: there's none left in the comforts locker.*A chest of tea and tobacco from a port/);
  none(told, /run out of (drink|clothes)/);
  assert.ok(comforts.comfortOut(game, SHIP, "leaf"));
  assert.ok(!comforts.comfortOut(game, SHIP, "drink"));
  assert.equal(kind(game, "leaf").out, true);
  assert.equal(shipView(game).moraleTarget, 58, "one comfort gone sours it by two");
  assert.equal(view(game).shift, -2);
  none(hours(game, 30), /run out of tea/);
  assert.ok(placeMoments(game, SHIP).has("No tea"));
  assert.ok(!placeMoments(game, SHIP).has("No drink"));
  // The urn in the mess has nothing to make a cup from.
  inRoom(game, "mess");
  const urn = walkView(game).things.find((one) => /urn/i.test(one.name));
  assert.ok(urn, "there's a tea urn in the Long Mess");
  const cup = (urn.does ?? []).find((one) => one.id === "use-drink");
  assert.equal(cup.disabled, true);
  assert.match(cup.detail, /run dry: there's no tea aboard/);
  // A chest in the locker, and within the hour they have their tea again.
  bag.storePut(game, locker().key, locker().holds, "tea_and_tobacco", 1);
  hours(game, 1.5);
  assert.ok(!comforts.comfortOut(game, SHIP, "leaf"));
  assert.equal(shipView(game).moraleTarget, 60);
  assert.ok(!placeMoments(game, SHIP).has("No tea"));
  assert.ok(!(walkView(game).things.find((one) => /urn/i.test(one.name)).does ?? []).find((one) => one.id === "use-drink").disabled);
});

test("comforts steady the crew while things go wrong, never past where a ship at ease settles", () => {
  const game = newGame();
  keepGoing(game);
  hours(game, 1);
  const settles = (rations) => shipView(game).rations.find((one) => one.id === rations).moraleTarget;
  // Fed and at ease, they change nothing.
  assert.equal(settles("standard"), 60);
  assert.equal(settles("generous"), 74);
  // On short rations each of the three steadies it by two.
  assert.equal(settles("reduced"), 48);
  assert.equal(settles("half"), 30);
  assert.equal(comforts.comfortsShift(game, 57, 60), 60, "never past where a fed ship settles");
  // With one gone, two steady it and one sours it; with all gone, all three sour it, however things are going.
  fill(game, [["beer_and_spirits", 2], ["clothes", 1]]);
  state(game).open.leaf = 0;
  hours(game, 2);
  assert.equal(settles("half"), 26);
  assert.equal(settles("generous"), 72);
  fill(game, []);
  state(game).open = {};
  hours(game, 2);
  assert.equal(settles("standard"), 54);
  assert.equal(settles("half"), 18);
  assert.equal(view(game).shift, -6);
});

test("after a hard day the quartermaster has a good table laid at the evening sitting, once, and morale lifts", () => {
  const game = newGame();
  keepGoing(game);
  toHour(game, 12);
  const day = Math.floor(game.clock.hours / 24);
  // A day like any other: nothing's laid.
  none(toHour(game, 19), /good table/);
  assert.equal(inLocker(game).provisions, 3);
  // A death aboard makes the next one hard, and spirits are low.
  toHour(game, 12);
  command.countForDuty(game, SHIP, "deaths", 1);
  game.ship.morale = 40;
  const morale = game.ship.morale;
  const told = toHour(game, 19);
  some(told, /Quartermaster Brandt had a good table laid in The Long Mess this evening, after a death aboard: 3 hampers of provisions, enough for everyone aboard\. Morale is up 6\./);
  assert.equal(game.ship.morale, morale + 6);
  assert.equal(inLocker(game).provisions ?? 0, 0);
  assert.equal(state(game).table.day, day + 1);
  assert.ok(placeMoments(game, SHIP).has("A good table"));
  assert.match(JSON.stringify(view(game).table.last), /a death aboard/);
  // A treat stops being one: there's no second table for three days, however hard they are.
  bag.storePut(game, locker().key, locker().holds, "provisions", 3);
  for (let i = 0; i < 2; i += 1) {
    toHour(game, 12);
    command.countForDuty(game, SHIP, "deaths", 1);
    game.ship.morale = 40;
    none(toHour(game, 19), /good table/);
  }
  assert.equal(inLocker(game).provisions, 3);
  // With one hamper for nine hundred, a third of them sit down to it.
  fill(game, [["provisions", 1]]);
  toHour(game, 12);
  command.countForDuty(game, SHIP, "alarms", 1);
  game.ship.morale = 40;
  some(toHour(game, 19), /after the alarm: 1 hamper of provisions, enough for about 300 of the 900 aboard\. Morale is up 2\./);
  assert.equal(game.ship.morale, 42);
  // With spirits where a fed ship at ease has them, the hampers are kept for a worse day; and a table never lifts
  // morale past that.
  fill(game, [["provisions", 3]]);
  state(game).table = null;
  toHour(game, 12);
  command.countForDuty(game, SHIP, "deaths", 1);
  game.ship.morale = 64;
  none(toHour(game, 19), /good table/);
  toHour(game, 12);
  command.countForDuty(game, SHIP, "deaths", 1);
  game.ship.morale = 57;
  some(toHour(game, 19), /Morale is up 3\./);
  assert.equal(game.ship.morale, 60);
  // A kettle that ran dry isn't a hard day, and with no hampers nothing's laid, however hard it was.
  state(game).table = null;
  toHour(game, 12);
  command.countForDuty(game, SHIP, "deaths", 1);
  game.ship.morale = 40;
  none(toHour(game, 19), /good table/);
});

test("nobody lays a table while the post that decides what the stores want can't", () => {
  const game = newGame();
  keepGoing(game);
  toHour(game, 12);
  command.countForDuty(game, SHIP, "deaths", 1);
  // The quartermaster is in the brig.
  const key = command.holderKey(game, SHIP, "quartermaster");
  (game.command.meridian.brig ??= {})[key] = { since: 1, until: 99 };
  assert.ok(command.lostReason(game, SHIP, key));
  none(toHour(game, 19), /good table/);
  assert.equal(inLocker(game).provisions, 3);
});

test("at a dock the Ship menu buys a comfort for the crew, out of the port's stores and the purse, into the locker", () => {
  const game = newGame();
  keepGoing(game);
  assert.deepEqual(view(game).offers, [], "in open space there's nothing to buy");
  assert.throws(() => shipCommand(game, { action: "comfort-buy", id: "beer_and_spirits" }), /docked at a port/);
  game.ship.at = "haven";
  hours(game, 1);
  const offers = view(game).offers;
  assert.deepEqual(offers.map((one) => one.item).sort(), ["beer_and_spirits", "clothes", "provisions", "tea_and_tobacco"]);
  const keg = offers.find((one) => one.item === "beer_and_spirits");
  assert.equal(keg.worth, "80 of the crew's drink");
  assert.ok(keg.price > 0 && keg.has > 0);
  // A full locker has no room for another.
  assert.throws(() => shipCommand(game, { action: "comfort-buy", id: "beer_and_spirits" }), /no room for another/);
  fill(game, [["beer_and_spirits", 1]]);
  game.ship.purse = 600;
  const purse = game.ship.purse;
  const had = amountOf(game.world, "haven", "beer_and_spirits");
  const done = shipCommand(game, { action: "comfort-buy", id: "beer_and_spirits" });
  assert.match(done.message, /Bought 1 keg of beer and spirits at Haven Station for \d+ credits, for the crew: it's in the comforts locker\./);
  assert.equal(inLocker(game).beer_and_spirits, 2);
  assert.equal(game.ship.purse, purse - keg.price);
  assert.equal(Math.round(amountOf(game.world, "haven", "beer_and_spirits")), Math.round(had) - 1);
  assert.match(game.ship.log.at(-1).text, /for the crew/);
  // Nothing on the slate: with the purse empty, nothing's bought.
  game.ship.purse = 3;
  assert.throws(() => shipCommand(game, { action: "comfort-buy", id: "beer_and_spirits" }), /purse holds 3 credits/);
  // Only what the locker keeps: nobody buys a ration crate this way.
  assert.throws(() => shipCommand(game, { action: "comfort-buy", id: "ration_crates" }), /sells that for the crew/);
});

test("the beer bucket and the still make a little drink from produce, which the kettle doesn't get", () => {
  const game = newGame();
  keepGoing(game);
  const bucket = model().machines.find((one) => one.name === "beer bucket");
  const still = model().machines.find((one) => one.name === "still");
  assert.equal(bucket.gives.item, "ship_brewed_beer");
  assert.equal(bucket.gives.n, 48);
  assert.equal(still.gives.item, "crawlway_moonshine");
  assert.equal(bucket.needs.water, 1);
  // Nobody stands over a bucket for weeks: it isn't offered as work to do by hand.
  inRoom(game, "galley");
  assert.ok(!(walkView(game).acts ?? []).some((one) => /bucket/i.test(one.label)), "the bucket isn't worked by hand");
  // A batch that's ready goes into the locker when there's room, and a basket of produce is gone from the bins: with
  // the garden stopped and the pantry wanting nothing, only the bucket takes any.
  fill(game, []);
  const bins = storeById(model(), "garden_bins");
  const produce = () => bag.storeCounts(game, bins.key, bins.holds).produce ?? 0;
  const garden = model().machines.find((one) => one.id === "garden");
  const pantry = storeById(model(), "pantry");
  const wants = pantry.wants;
  garden.runs = false;
  pantry.wants = {};
  try {
    toHour(game, 9);
    game.logistics.meridian.machines[bucket.id] = { progress: bucket.every - 1, made: 0, waiting: null };
    const before = produce();
    assert.ok(before > 0, "there's produce in the bins");
    hours(game, 1);
    // Forty-eight bottles, less the one or two the crew has had since.
    assert.ok(inLocker(game).ship_brewed_beer >= 45 && inLocker(game).ship_brewed_beer <= 48, `${inLocker(game).ship_brewed_beer} beers`);
    assert.equal(game.logistics.meridian.machines[bucket.id].made, 1);
    assert.equal(produce(), before - 1, "a basket of produce went into it");
    // With none in the bins, it waits for some.
    (game.stores ??= {})[bins.key] = { items: [] };
    (game.stores ??= {})[locker().key] = { items: [] };
    game.logistics.meridian.machines[bucket.id].progress = bucket.every - 1;
    hours(game, 1);
    assert.equal(game.logistics.meridian.machines[bucket.id].made, 1);
    assert.equal(machinesView(game, SHIP).find((one) => one.id === bucket.id).status, "the garden bins have no produce");
  } finally {
    garden.runs = true;
    pantry.wants = wants;
  }
  assert.match(machinesView(game, SHIP).find((one) => one.id === still.id).status, /days' work to the next|hours' work to the next|no room|waiting for someone there|no produce/);
});

test("the ship's law looks away from the still, and a line against it shuts it", () => {
  assert.deepEqual(lawProblems(), []);
  const still = model().machines.find((one) => one.name === "still");
  assert.deepEqual(lawOf(SHIP).makers, [{ id: still.id, name: "still", shut: false }]);
  const game = newGame();
  keepGoing(game);
  hours(game, 30);
  assert.doesNotMatch(machinesView(game, SHIP).find((one) => one.id === still.id).status, /law/);
  withLaw((law) => law.replace(/^the still: the law looks away$/m, "the still: against the law"), () => {
    assert.deepEqual(lawProblems(), []);
    assert.equal(lawOf(SHIP).makers[0].shut, true);
    const shut = newGame();
    keepGoing(shut);
    shut.logistics.meridian.machines[still.id] = { progress: still.every - 1, made: 0, waiting: null };
    (shut.stores ??= {})[locker().key] = { items: [] };
    hours(shut, 30);
    assert.equal(machinesView(shut, SHIP).find((one) => one.id === still.id).status, "shut down: it's against the ship's law");
    assert.equal(shut.logistics.meridian.machines[still.id].made, 0);
    assert.equal(inLocker(shut).crawlway_moonshine ?? 0, 0);
  });
  // A maker the logistics file doesn't have is a problem the checker names.
  withLaw((law) => law.replace(/^the still: the law looks away$/m, "the distillery: against the law"), () => {
    assert.match(lawProblems().join(" | "), /no machine called the distillery in world\/logistics\/meridian\.txt: its machines are .*still/);
  });
  assert.deepEqual(lawProblems(), []);
});

test("something given to someone aboard is remembered: the best in the pack is offered, one a week, the last two kept", () => {
  const game = newGame();
  keepGoing(game);
  inRoom(game, "bridge");
  // An officer, who has a card in the Command menu.
  const cards = () => command.commandView(game).groups.flatMap((one) => one.posts);
  const who = walkView(game).people.find((one) => !one.asleep && !one.crowd && cards().some((card) => card.holder?.key === one.key));
  assert.ok(who, "an officer is on the bridge");
  assert.deepEqual(gifts(game, who.key), [], "with nothing to give, nothing's offered");
  addItem(game, "vantor_red_wine", 1);
  addItem(game, "ship_brewed_beer", 2);
  addItem(game, "ration_crate", 1);
  const offered = gifts(game, who.key);
  assert.deepEqual(offered.map((one) => [one.id, one.label]), [["give-gift", "Give a vantor red wine"], ["give-gift-2", "Give a ship-brewed beer"]]);
  assert.ok(!offered[0].disabled);
  const regard = command.regardFor(game, SHIP, who.key, command.YOU);
  const { said } = walkCommand(game, { action: "give-gift", key: who.key });
  assert.match(said, /^\[GIFT\] You give .+ a vantor red wine\. There's a moment with no words in it, and then you're thanked twice\.$/);
  assert.equal(game.inventory.vantor_red_wine ?? 0, 0);
  assert.equal(command.regardFor(game, SHIP, who.key, command.YOU), regard + 6);
  const memory = game.command.meridian.memory[who.key].at(-1);
  assert.deepEqual([memory.kind, memory.words, memory.w, memory.by], ["gift", "a vantor red wine", 6, command.YOU]);
  // It shows on their card in the Command menu.
  some(cards().find((card) => card.holder?.key === who.key).memories, /given a vantor red wine by you/i);
  // And for a few days it's the first thing they say when they're talked to.
  assert.match(command.grudgeLine(game, who.key), /kind thing|given me anything|still got it/);
  // One a week counts: the beer is offered, greyed, and refused.
  const again = gifts(game, who.key);
  assert.equal(again[0].label, "Give a ship-brewed beer");
  assert.equal(again[0].disabled, true);
  assert.match(again[0].detail, /this week/);
  assert.throws(() => walkCommand(game, { action: "give-gift", key: who.key }), /this week/);
  assert.equal(game.inventory.ship_brewed_beer, 2);
  // A week on, another; and a third pushes the first out, so gifts never crowd out what else someone remembers.
  hours(game, 7 * 24);
  inRoom(game, "bridge");
  const there = (key) => person(game, key) && !person(game, key).asleep;
  if (there(who.key)) {
    walkCommand(game, { action: "give-gift", key: who.key });
    assert.equal(game.command.meridian.memory[who.key].filter((one) => one.kind === "gift").length, 2);
    hours(game, 7 * 24);
    inRoom(game, "bridge");
    if (there(who.key)) {
      walkCommand(game, { action: "give-gift", key: who.key });
      const kept = game.command.meridian.memory[who.key].filter((one) => one.kind === "gift");
      assert.equal(kept.length, 2);
      assert.deepEqual(kept.map((one) => one.words), ["a ship-brewed beer", "a ship-brewed beer"]);
    }
  }
});

test("what's worn isn't offered as a gift, and nobody asleep or lying where they fell is given one", () => {
  const game = newGame();
  keepGoing(game);
  inRoom(game, "bridge");
  const who = walkView(game).people.find((one) => !one.asleep && !one.crowd);
  addItem(game, "evening_gown", 1);
  assert.equal(gifts(game, who.key).length, 1);
  game.equipped.armor = "evening_gown";
  assert.deepEqual(gifts(game, who.key), [], "the gown on the captain's back isn't offered");
  game.equipped.armor = null;
  // Ashore, nobody keeps what people remember.
  game.location = "haven";
  game.walk = null;
  assert.ok(!(walkView(game).people ?? []).some((one) => (one.acts ?? []).some((act) => act.id.startsWith("give-gift"))));
});

test("a game from before finds its locker full and is told once; the Ship menu has the comforts", () => {
  const game = newGame();
  keepGoing(game);
  delete game.logistics.meridian.comforts;
  const told = hours(game, 1);
  some(told, /From now on the crew's comforts are kept in the comforts locker in The Long Mess/);
  none(hours(game, 3), /From now on the crew's comforts/);
  const c = view(game);
  assert.equal(c.store, "comforts locker");
  assert.equal(c.room, "The Long Mess");
  assert.deepEqual(c.kinds.map((one) => [one.id, one.name, one.of]), [["drink", "drink", 416], ["leaf", "tea and tobacco", 400], ["clothes", "clothes", 200]]);
  assert.deepEqual([c.steadies, c.sours, c.shift], [2, 2, 0]);
  assert.deepEqual([c.table.lifts, c.table.hampers, c.table.seats, c.table.last], [6, 3, 900, null]);
  // Without the lines, a ship has no comforts, and nothing about them is shown or done.
  withFile((file) => file.split("\n").filter((line) => !/^(the crew uses|each comfort steadies|going without one|a good table lifts)/.test(line)).join("\n"), () => {
    assert.deepEqual(logisticsProblems(), []);
    const plain = newGame();
    keepGoing(plain);
    hours(plain, 30);
    assert.equal(shipView(plain).comforts, null);
    assert.equal(plain.logistics.meridian.comforts, undefined);
    assert.equal(inLocker(plain).ship_brewed_beer, 48, "nobody touched the locker");
  });
});

test("the Gilded Wheel pays for what it can't get: short of fine things, Madame Oriel buys Vantor red at twice the price", async () => {
  const rq = await import("../src/requests.js");
  const talks = await import("../src/talks.js");
  const walk = await import("../src/walk.js");
  const { clockRuns } = await import("../src/rules.js");
  const { itemFactor } = await import("../src/daily.js");
  const { portsModel } = await import("../src/ports.js");
  assert.deepEqual(rq.requestProblems?.() ?? [], []);
  const game = newGame();
  keepGoing(game);
  game.location = "wheel";
  game.ship.at = "wheel";
  game.walk = null;
  game.requests = { open: {}, rest: {}, asked: {}, n: 0 };
  const cases = (n) => { ((game.world.ports ??= {}).wheel ??= {}).fine_things = (n / portsModel().ports.wheel.holds.fine_things.usual) * 100; };
  const told = (notes) => notes.filter((one) => one.startsWith("[REQUEST]"));
  // With the Cellars as they usually are, nobody asks.
  cases(37);
  game.clock.hours = 10.5;
  assert.deepEqual(told(clockRuns(game, 1)), []);
  // Short of fine things, she does.
  cases(20);
  game.clock.hours = 34.5;
  const asked = told(clockRuns(game, 1));
  assert.equal(asked.length, 1, asked.join(" | "));
  assert.match(asked[0], /^\[REQUEST\] Madame Ao-Dess has something to ask you/);
  walk.bringOver(game, ["oriel"]);
  walk.talkCommand(game, { action: "open", person: "oriel" });
  talks.openWrittenTalk(game);
  assert.match(game.talk.lastReply, /The Cellars are thin/);
  talks.writtenTalkTurn({ game, playerText: "I'll find you two", emit: () => {} });
  walk.closeTalk(game);
  const price = Math.round(ITEMS.vantor_red_wine.price * itemFactor(game, ITEMS.vantor_red_wine) * 2);
  assert.ok(price >= 2 * ITEMS.vantor_red_wine.price * 0.5, `twice the market's price: ${price}`);
  const quest = game.quests.find((one) => one.request === "wheel_cellar");
  assert.equal(quest.objective, `Sell Madame Ao-Dess 2 vantor red wines at ${price} credits each (0/2)`);
  // Two bottles, paid for as they're handed over.
  game.inventory.vantor_red_wine = 2;
  walk.bringOver(game, ["oriel"]);
  const credits = game.credits;
  walk.walkCommand(game, { action: "give", key: "person:oriel" });
  const end = told(rq.advanceRequests(game));
  assert.match(end[0], new RegExp(`pays you ${2 * price} credits for 2 `));
  assert.match(end.at(-1), /^\[REQUEST\] Done: What the house can't get\./);
  assert.equal(game.credits, credits + 2 * price);
});
