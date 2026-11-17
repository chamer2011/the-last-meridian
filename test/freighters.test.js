// The logistics rework, step 13: ships you can meet. Everything a port sends for travels in a freighter with a name
// (src/lanes.js): it loads for a day where it sails from, is days on the way, and unloads where it's bound. Docked
// beside one, the Meridian's captain can hail her, buy from her hold, see her to her next port for pay, or board her
// and fight her crew for what she carries (src/freighters.js). A freighter that never arrives is a shortage where it
// was going, and the news says so.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-freighters-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const bag = await import("../src/bag.js");
const { combatAction, combatView, endCombat } = await import("../src/combat.js");
const { knownPlace } = await import("../src/daily.js");
const { ENEMIES, FACTIONS, ITEMS } = await import("../src/data.js");
const { goodPrice, holdOf } = await import("../src/freight.js");
const lanes = await import("../src/lanes.js");
const { goLive } = await import("../src/live-fight.js");
const { logisticsOf, storeById } = await import("../src/logistics.js");
const { amountOf, portsModel } = await import("../src/ports.js");
const { readRecord } = await import("../src/record.js");
const { checkExtras } = await import("../src/room-hooks.js");
const { passTime } = await import("../src/rules.js");
const { isCaptain } = await import("../src/role.js");
const { allStoryProblems } = await import("../src/scenes.js");
const { shipCommand, shipView } = await import("../src/ship.js");
const sys = await import("../src/systems.js");
const { STAR_MAP } = await import("../src/world.js");

const SHIP = "meridian";
// A captain who doesn't breathe, docked at Haven on the fourth morning, on a ship where nothing wears out and whose
// generator and water never run out, with a purse to buy with.
const newGame = (seed = 21, days = 3) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  game.character.species = "synthetic";
  game.wearDay = Infinity;
  game.ship.at = "haven";
  game.ship.purse = 3000;
  keepGoing(game);
  for (let day = 0; day < days; day += 1) passTime(game, 24, "routine");
  return game;
};
function keepGoing(game) {
  const model = logisticsOf(SHIP);
  game.logistics.meridian.machines.generator = { progress: 0, made: 0, waiting: null, burning: 1e9 };
  (game.stores ??= {})[storeById(model, model.water.tank).key] = { count: 1e9 };
}
const twin = (game) => JSON.parse(JSON.stringify(game));
const day = (game, n = 1) => { const notes = []; for (let i = 0; i < n; i += 1) notes.push(...passTime(game, 24, "routine")); return notes; };
const view = (game) => shipView(game).lanes;
const inPort = (game) => view(game).here.ships;
const haulsOf = (game, id) => game.world.hauls.filter((haul) => String(haul[5]) === String(id));
// A ship as the game sees her: her name, her run and who she flies for.
const shipOf = (game, id) => lanes.shipOf(game.world, String(id), haulsOf(game, id));
const order = (game, action, id, more = {}) => shipCommand(game, { action, id, ...more });
const hold = () => holdOf();
const inHold = (game) => bag.storeCounts(game, hold().key, hold().holds);
const some = (lines, pattern) => assert.ok(lines.some((one) => pattern.test(one)), `${pattern} in: ${lines.join(" | ") || "nothing"}`);
const none = (lines, pattern) => assert.ok(!lines.some((one) => pattern.test(one)), `${pattern} shouldn't be in: ${lines.join(" | ")}`);
// The fight played out by attacking: won when the crew is nearly down already, lost when the captain is.
function fight(game) {
  let out = null;
  for (let i = 0; i < 200 && game.combat; i += 1) {
    const enemy = game.combat.enemies.find((one) => one.hp > 0 && !one.out);
    out = combatAction(game, { type: "attack", target: enemy.key });
  }
  return out;
}
const weaken = (game) => { for (const enemy of game.combat.enemies) enemy.hp = 1; };

test("the file gives the names and the numbers, and the checker reads it", () => {
  const rules = lanes.freighterRules();
  assert.ok(rules, "the file reads whole");
  assert.deepEqual(lanes.freighterFileProblems(), []);
  assert.ok(rules["names begin"].length >= 30 && rules["names end"].length >= 30);
  assert.deepEqual(rules["the master sells"], { share: 0.5 });
  assert.deepEqual(rules["an escort pays"], { rate: 20, from: 2 });
  assert.deepEqual(rules["the crew"], { hands: 1, more: 2, over: 1500 });
  assert.deepEqual(rules["a boarding costs"], { flag: 10, port: 5 });
  assert.ok(ENEMIES[rules["the crew fights as"].master] && ENEMIES[rules["the crew fights as"].hand], "her crew are enemies the game has");
  assert.deepEqual(checkExtras().filter((one) => /freighters\.txt/.test(one)), []);
  const broken = lanes.parseFreighters("names begin: Long, Quiet\nthe master sells: most of it\na ship: is a ship\n");
  assert.match(broken.problems.join(" | "), /"the master sells" is written like: 50 percent of what's aboard/);
  assert.match(broken.problems.join(" | "), /a line here is one of: names begin/);
  assert.match(broken.problems.join(" | "), /"names begin" has 2 words/);
  assert.match(broken.problems.join(" | "), /there's no line for names end/);
  assert.equal(broken.whole, false);
  // What the captain did about one is something a story can wait on.
  assert.ok(!allStoryProblems().problems.some((one) => /robbed_a_freighter|escorted_a_freighter|boarded_a_freighter/.test(one)));
});

test("every haul is in a ship with a name of its own, which loads, sails and unloads by the days of its run", () => {
  const game = newGame();
  const world = game.world;
  const model = portsModel();
  assert.ok(world.hauls.length > 80);
  assert.ok(world.hauls.every((haul) => world.ships[haul[5]]), "every haul has its ship");
  const ships = lanes.shipsOn(world);
  assert.ok(ships.length > 60 && ships.length <= world.hauls.length, `${ships.length} ships`);
  assert.equal(Object.keys(world.ships).length, ships.length, "and nothing's kept of a ship that isn't on the lanes");
  assert.equal(new Set(ships.map(({ ship }) => ship.name)).size, ships.length, "no two ships share a name");
  for (const { ship, hauls } of ships) {
    assert.match(ship.name, /^the [A-Z][a-z]+ [A-Z][a-z]+$/);
    assert.equal(ship.total, model.days(ship.from, ship.to));
    assert.ok(hauls.length > 0 && hauls.every((haul) => haul[0] === ship.from && haul[1] === ship.to), "a ship's hauls are all on its run");
    assert.equal(new Set(hauls.map((haul) => haul[4])).size, 1, "and all as far along");
    // What the save keeps of her is next to nothing: which of her run's names she has.
    assert.deepEqual(world.ships[ship.id], { slot: ship.memo.slot });
  }
  // One that's loading today: here now, under way or unloading tomorrow, and gone from the lanes once it's in.
  const { ship } = ships.find((one) => one.ship.total >= 3 && lanes.shipState(one.ship, one.hauls).state === "loading");
  const id = ship.id;
  assert.deepEqual(lanes.shipState(ship, haulsOf(game, id)), { left: ship.total, state: "loading", at: ship.from });
  assert.deepEqual(lanes.shipSpot(ship, ship.total), { x: STAR_MAP.places[ship.from].x, y: STAR_MAP.places[ship.from].y });
  day(game);
  assert.equal(shipOf(game, id).name, ship.name, "she keeps her name on the way");
  assert.equal(lanes.shipState(shipOf(game, id), haulsOf(game, id)).state, ship.total === 2 ? "unloading" : "under way");
  const spot = lanes.shipSpot(shipOf(game, id), ship.total - 1);
  const a = STAR_MAP.places[ship.from];
  const b = STAR_MAP.places[ship.to];
  assert.ok(Math.min(a.x, b.x) <= spot.x && spot.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= spot.y && spot.y <= Math.max(a.y, b.y), "part of the way along her run");
  day(game, ship.total - 2);
  assert.deepEqual(lanes.shipState(shipOf(game, id), haulsOf(game, id)), { left: 1, state: "unloading", at: ship.to });
  assert.deepEqual(lanes.shipSpot(shipOf(game, id), 1), { x: b.x, y: b.y });
  day(game);
  assert.equal(game.world.ships[id], undefined, "and once she's in, she's off the lanes");
  assert.equal(haulsOf(game, id).length, 0);
});

test("the same world has the same ships, and a save from before gets its ships at the next midnight", () => {
  const one = newGame(77);
  const two = newGame(77);
  assert.deepEqual(one.world.ships, two.world.ships, "a ship's name comes from its run, not from any dice");
  assert.deepEqual(lanes.shipsOn(one.world).map(({ ship }) => ship.name), lanes.shipsOn(two.world).map(({ ship }) => ship.name));
  const old = twin(one);
  delete old.world.ships;
  delete old.world.shipSeq;
  for (const haul of old.world.hauls) haul.length = 5;
  assert.deepEqual(view(old).lanes, [], "nothing to show until the day turns");
  assert.equal(view(old).here.ships.length, 0);
  day(old);
  assert.ok(old.world.hauls.every((haul) => old.world.ships[haul[5]]));
  assert.ok(view(old).here.ships.length > 0);
});

test("the Ship's view has the ships docked beside her and the ones on the lanes between ports the captain knows of", () => {
  const game = newGame();
  const l = view(game);
  assert.equal(l.here.id, "haven");
  assert.ok(l.here.ships.length >= 4, `${l.here.ships.length} ships at Haven`);
  for (const ship of l.here.ships) {
    assert.ok(["loading", "unloading", "waiting"].includes(ship.state));
    assert.equal(ship.state === "loading" ? ship.from.id : ship.to.id, "haven", "she's docked here");
    assert.ok(ship.loads.length > 0 && ship.cargo !== "nothing");
    assert.ok(ship.crew === 2 || ship.crew === 3);
    assert.match(ship.flies, /\S/);
  }
  // A ship in from a port the captain hasn't heard of says so only once she's hailed.
  const far = l.here.ships.find((ship) => !ship.far.known);
  assert.ok(far, "one of them is from further out");
  assert.equal(far.hailed, null);
  // The lanes: only between ports on the captain's chart, each with a spot on it.
  assert.ok(l.lanes.length > 5 && l.lanes.length <= 40);
  for (const ship of l.lanes) {
    assert.ok(knownPlace(game, ship.from) && knownPlace(game, ship.to), `${ship.name} is between ports the captain knows`);
    assert.ok(Number.isFinite(ship.x) && Number.isFinite(ship.y));
    assert.match(ship.cargo, /\d/);
  }
  assert.ok(l.lanes.some((ship) => ship.state === "under way"), "some of them are between ports");
  assert.equal(l.comms, null);
  assert.equal(l.captain, true);
  // Reading it writes nothing.
  const before = JSON.stringify(game);
  shipView(game);
  assert.equal(JSON.stringify(game), before);
});

test("hailing a freighter: where she's been, what she carries, and what's short at the far end, which goes on the chart", () => {
  const game = newGame();
  const ship = inPort(game).find((one) => one.state === "unloading" && !one.from.known);
  assert.ok(ship, "a ship is in from a port the captain doesn't know");
  assert.equal(knownPlace(game, ship.from.id), false);
  const { message, notes } = order(game, "ship-hail", ship.id);
  assert.match(message, new RegExp(`^${ship.name} answers\\. She flies for .+, \\d days? out of .+, and unloading, with .+\\. Her master says: ".+" .+ goes on your chart\\.$`));
  assert.deepEqual(notes, [`[HAIL] ${message}`]);
  assert.equal(knownPlace(game, ship.from.id), true, "the captain has heard of it now");
  const after = inPort(game).find((one) => one.id === ship.id);
  assert.equal(after.hailed, game.world.day);
  assert.match(after.said, /(is short of|wants for nothing much)/);
  assert.equal(after.from.known, true);
  assert.match(game.ship.log.at(-1).text, /answers/);
  assert.equal(game.ship.log.at(-1).tag, "COMMS");
  // With the comms down nobody can be raised.
  const relay = sys.partsOf(sys.systemsOf(SHIP), "comms");
  assert.ok(relay.length > 0, "the ship has comms");
  for (const part of relay) sys.damagePart(game, SHIP, part.id, "broken", { by: "story" });
  assert.match(view(game).comms, /comms are down/);
  assert.throws(() => order(game, "ship-hail", ship.id), /comms are down/);
  assert.throws(() => order(game, "ship-buy", ship.id, { good: ship.loads[0].good }), /comms are down/);
});

test("buying from her hold: one at a time, part of what's aboard, at a price between the two ports', and it never reaches the port", () => {
  const game = newGame();
  const ship = inPort(game).find((one) => one.state === "unloading" && one.loads.some((load) => load.sells >= 3));
  assert.ok(ship, "a ship is unloading with something to sell");
  const load = ship.loads.find((one) => one.sells >= 3);
  const model = portsModel();
  const item = model.goods[load.good].item;
  const prices = [goodPrice(game, ship.from.id, load.good), goodPrice(game, ship.to.id, load.good)];
  assert.ok(load.price >= Math.floor(Math.min(...prices) * 0.8) && load.price <= Math.ceil(Math.max(...prices)), `${load.price} is between ${prices.join(" and ")}`);
  assert.equal(load.sells, Math.floor(haulsOf(game, ship.id).find((haul) => haul[2] === load.good)[3] * 0.5), "half of what's aboard");
  const other = twin(game);
  const purse = game.ship.purse;
  const had = inHold(game)[item] ?? 0;
  const { message } = order(game, "ship-buy", ship.id, { good: load.good });
  assert.match(message, /^Bought 1 .+ out of the .+'s hold for \d+ credits, into the freight hold\. That's one that won't reach Haven Station\.$/);
  assert.equal(inHold(game)[item], had + 1);
  assert.equal(game.ship.purse, purse - load.price);
  const now = inPort(game).find((one) => one.id === ship.id).loads.find((one) => one.good === load.good);
  assert.equal(now.sells, load.sells - 1, "one fewer for sale");
  // The master sells no more than the share.
  for (let i = 0; i < load.sells - 1; i += 1) order(game, "ship-buy", ship.id, { good: load.good });
  assert.throws(() => order(game, "ship-buy", ship.id, { good: load.good }), /won't sell any more of that/);
  assert.throws(() => order(game, "ship-buy", ship.id, { good: "wrecks" }), /carries nothing like that/);
  // At midnight the port gets what's left, and not what was bought.
  day(game);
  day(other);
  assert.equal(Math.round(amountOf(other.world, "haven", load.good) - amountOf(game.world, "haven", load.good)), load.sells, "Haven is short by what was bought");
  // An empty purse buys nothing.
  const poor = newGame();
  poor.ship.purse = 0;
  const cheap = inPort(poor).find((one) => one.loads.some((l) => l.sells > 0));
  assert.throws(() => order(poor, "ship-buy", cheap.id, { good: cheap.loads.find((l) => l.sells > 0).good }), /purse holds 0 credits/);
});

test("a freighter loading for a dangerous port pays to be seen in, when the Meridian is docked there as she arrives", () => {
  const game = newGame();
  const ships = inPort(game);
  for (const ship of ships) {
    const danger = STAR_MAP.places[ship.to.id].danger;
    if (ship.state !== "loading" || danger < 2) assert.equal(ship.escort, null, `${ship.name} asks for nobody`);
    else assert.ok(ship.escort.fee >= 20 * danger, `${ship.name} pays ${ship.escort.fee}`);
  }
  const ship = ships.find((one) => one.escort);
  assert.ok(ship, "one of them wants company");
  const calm = ships.find((one) => !one.escort && one.state === "loading");
  assert.throws(() => order(game, "ship-escort", calm.id), /isn't asking for company/);
  const { message } = order(game, "ship-escort", ship.id);
  assert.match(message, new RegExp(`^You've given ${ship.name.replace(/^T/, "t")} your word: be docked at .+ when she comes in, at midnight at the end of day ${ship.due}, and her master pays ${ship.escort.fee} credits into the purse\\.`));
  assert.throws(() => order(game, "ship-escort", ship.id), /already said/);
  assert.deepEqual(view(game).escorts.map((one) => [one.ship, one.fee, one.due, one.here]), [[ship.id, ship.escort.fee, ship.due, false]]);
  assert.equal(inPort(game).find((one) => one.id === ship.id).escort.taken, true);
  assert.equal(knownPlace(game, ship.to.id), true, "her master gave the bearings");
  // Not there when she comes in: nothing's paid.
  const absent = twin(game);
  const away = day(absent, ship.days + 1);
  some(away, new RegExp(`came in at .+ without you`));
  none(away, /with the Meridian beside her/);
  assert.deepEqual(view(absent).escorts, []);
  // There when she comes in: the fee, a little standing, and it's on the record.
  game.ship.at = ship.to.id;
  const flies = shipOf(game, ship.id).flies;
  const standing = game.factions[flies] ?? 0;
  const purse = game.ship.purse;
  const told = day(game, ship.days + 1);
  some(told, new RegExp(`^\\[TRADE\\] ${ship.name} is in at .+ with the Meridian beside her, and her master pays ${ship.escort.fee} credits into the purse\\.$`));
  assert.deepEqual(view(game).escorts, []);
  if (FACTIONS[flies]) assert.equal(game.factions[flies], standing + 1);
  assert.ok(readRecord(game).facts.some((fact) => fact.id === "escorted_a_freighter" && fact.text.includes(ship.name.replace(/^T/, "t"))));
  assert.ok(game.ship.purse >= purse + ship.escort.fee - 400, "the fee went into the purse, less what the days there cost");
});

test("where convoys are being lost, a freighter alone never arrives and the news says so; one the Meridian sees in does", () => {
  const game = newGame();
  // One that carries nothing but food and parts, which is what's being lost: the whole ship goes.
  const tree = (load) => portsModel().goods[load.good].tree;
  const ship = inPort(game).find((one) => one.state === "loading" && ["kessara", "graveyard", "maris"].includes(one.to.id) && one.loads.every((load) => ["food", "parts"].includes(tree(load))));
  assert.ok(ship, "a ship is loading food or parts for a port where convoys can be lost");
  const to = ship.to.id;
  const lost = ship.loads.filter((load) => ["food", "parts"].includes(portsModel().goods[load.good].tree));
  const losing = (one) => { one.world.places[to].events = [{ id: "convoy_lost", left: 9 }]; };
  const alone = twin(game);
  losing(alone);
  const news = day(alone, ship.days + 1);
  assert.equal(alone.world.ships[ship.id], undefined);
  const said = alone.world.news.find((entry) => entry.place === to && entry.text.startsWith(ship.name) && entry.text.includes("never arrived"));
  assert.ok(said, "the port hears she's overdue");
  assert.match(said.text, new RegExp(`^${ship.name}, out of Haven Station never arrived at .+: .+ lost with her, and the price of what she carried is climbing there\\.$`));
  none(news, /with the Meridian beside her/);
  // Seen in, she arrives, and her master says what that was worth.
  losing(game);
  order(game, "ship-escort", ship.id);
  assert.match(inPort(game).find((one) => one.id === ship.id).escort ? "taken" : "", /taken/);
  game.ship.at = to;
  const told = day(game, ship.days + 1);
  some(told, /with the Meridian beside her, where a ship alone would have been lost, and her master pays \d+ credits into the purse\./);
  assert.ok(!game.world.news.some((entry) => entry.text.startsWith(ship.name) && entry.text.includes("never arrived")));
  for (const load of lost) {
    const gap = amountOf(game.world, to, load.good) - amountOf(alone.world, to, load.good);
    assert.ok(gap > load.n * 0.5, `${to} has ${Math.round(gap)} more ${load.name} for her getting in (she carried ${load.n})`);
  }
});

test("boarding her: a fight aboard the freighter, in its window, that costs standing; won, what fits the hold is taken and the port goes short", () => {
  const game = newGame();
  const ship = inPort(game).find((one) => one.state === "unloading" && one.loads.some((load) => load.n >= 10) && FACTIONS[shipOf(game, one.id).flies]);
  assert.ok(ship, "a ship with something worth taking is unloading");
  const flies = shipOf(game, ship.id).flies;
  const holder = game.world.places.haven.holder;
  const before = { flag: game.factions[flies] ?? 0, port: game.factions[holder] ?? 0 };
  const other = twin(game);
  const { message, notes } = order(game, "ship-board", ship.id);
  assert.equal(message, `You go across to ${ship.name.replace(/^T/, "t")}.`);
  some(notes, /^\[COMBAT\] You board the .+, at Haven Station\.$/);
  // Standing, with whoever she flies for and whoever holds the port, win or lose.
  assert.equal(game.factions[flies], before.flag - 10);
  if (FACTIONS[holder] && holder !== flies) assert.equal(game.factions[holder], before.port - 5);
  // Her crew: the master and a hand, or two for a load worth more.
  const c = game.combat;
  assert.equal(c.enemies.length, ship.crew);
  assert.equal(c.enemies[0].id, "freighter_master");
  assert.ok(c.enemies.slice(1).every((enemy) => enemy.id === "freighter_hand"));
  assert.equal(combatView(game).away, `aboard ${ship.name.replace(/^T/, "t")}`);
  assert.throws(() => goLive(game), /aboard .+, not in the room/);
  assert.throws(() => order(game, "ship-board", ship.id), /won't be surprised twice/);
  // Won: everything that fits comes across, and it's gone from what she carries.
  const had = { ...inHold(game) };
  weaken(game);
  const out = fight(game);
  assert.equal(out.result, "victory");
  const taken = out.events.map((event) => event.note ?? "").find((note) => note.startsWith("[TRADE]"));
  assert.match(taken, /^\[TRADE\] .+ out of the .+'s hold, into the freight hold\. Haven Station was waiting for them\.$/);
  const model = portsModel();
  let squares = 0;
  for (const load of ship.loads) {
    const item = model.goods[load.good].item;
    const got = (inHold(game)[item] ?? 0) - (had[item] ?? 0);
    squares += got;
    const left = haulsOf(game, ship.id).find((haul) => haul[2] === load.good)?.[3] ?? 0;
    assert.ok(Math.abs(left + got - haulsOf(other, ship.id).find((haul) => haul[2] === load.good)[3]) < 0.01, `${load.name}: what she had is in the hold or still aboard`);
  }
  assert.ok(squares > 0, "something was taken");
  assert.ok(readRecord(game).facts.some((fact) => fact.id === "robbed_a_freighter"));
  assert.ok(readRecord(game).facts.some((fact) => fact.id === "boarded_a_freighter"));
  assert.ok(game.world.news.some((entry) => entry.place === "haven" && /was boarded at Haven Station before she'd unloaded, and .+ won't be coming ashore/.test(entry.text)));
  // She has nothing more to say to the Meridian.
  assert.equal(inPort(game).find((one) => one.id === ship.id)?.boarded ?? true, true);
  assert.throws(() => order(game, "ship-board", ship.id), /won't be surprised twice|has gone/);
  assert.throws(() => order(game, "ship-hail", ship.id), /nothing more to say|has gone/);
  // At midnight Haven is short of what was taken.
  day(game);
  day(other);
  const big = ship.loads.find((load) => load.n >= 10);
  const item = model.goods[big.good].item;
  const got = (inHold(game)[item] ?? 0) - (had[item] ?? 0);
  assert.ok(got > 0);
  assert.ok(amountOf(other.world, "haven", big.good) - amountOf(game.world, "haven", big.good) > got * 0.9, "the port went short of it");
});

test("a boarding lost, or run from, takes nothing, and still costs the standing", () => {
  const game = newGame();
  const ship = inPort(game).find((one) => one.state === "unloading" && one.loads.some((load) => load.n >= 10) && FACTIONS[shipOf(game, one.id).flies]);
  const flies = shipOf(game, ship.id).flies;
  const standing = game.factions[flies] ?? 0;
  const carried = haulsOf(game, ship.id).map((haul) => haul[3]);
  const had = JSON.stringify(inHold(game));
  order(game, "ship-board", ship.id);
  game.hp = 1;
  for (const enemy of game.combat.enemies) { enemy.attack = 30; enemy.hp = 500; }
  const out = fight(game);
  assert.equal(out.result, "defeat");
  some(out.events.map((event) => event.text ?? ""), /You're carried back through the lock, and the .+ keeps everything she had\./);
  assert.equal(JSON.stringify(inHold(game)), had, "nothing came across");
  assert.deepEqual(haulsOf(game, ship.id).map((haul) => haul[3]), carried);
  assert.equal(game.factions[flies], standing - 10);
  assert.ok(!readRecord(game).facts.some((fact) => fact.id === "robbed_a_freighter"));
  // Talked into standing aside, the hold is open all the same.
  const smooth = newGame();
  const soft = inPort(smooth).find((one) => one.state === "unloading" && one.loads.some((load) => load.n >= 10));
  order(smooth, "ship-board", soft.id);
  for (const enemy of smooth.combat.enemies) enemy.out = "persuade";
  const talked = endCombat(smooth, "victory", []);
  assert.equal(talked.result, "talked");
  assert.ok(readRecord(smooth).facts.some((fact) => fact.id === "robbed_a_freighter"), "nobody was beaten, and the cargo came across");
});

test("a freighter in with what the Meridian's port was short of is news there, and only whoever has the chair gives orders", () => {
  const game = newGame();
  const ship = inPort(game).find((one) => one.state === "unloading" && one.loads.some((load) => load.n >= 5));
  const load = ship.loads.find((one) => one.n >= 5);
  // Haven has hardly any of it today.
  const model = portsModel();
  const usual = model.ports.haven.holds[load.good].usual;
  const supply = model.supplyOf[load.good];
  if (supply) game.world.places.haven.goods[supply] = 20;
  else ((game.world.ports ??= {}).haven ??= {})[load.good] = 20;
  assert.ok(amountOf(game.world, "haven", load.good) < usual * 0.3);
  const told = day(game);
  some(told, new RegExp(`^\\[WORLD\\] ${ship.name} is in from .+ with .+, which Haven Station was badly short of\\.$`));
  // Someone who isn't the captain sees the ships and gives no orders.
  const crew = newGame();
  crew.role = { ...(crew.role ?? {}), captain: false };
  if (!isCaptain(crew)) {
    const any = view(crew).here.ships[0];
    assert.equal(view(crew).captain, false);
    assert.throws(() => order(crew, "ship-hail", any.id), /chair/);
  }
});

test("a ship boarded while she's loading never sails with what was taken, and the port she was bound for is told", () => {
  const game = newGame();
  const ship = inPort(game).find((one) => one.state === "loading" && one.loads.some((load) => load.n >= 5 && portsModel().goods[load.good].item));
  assert.ok(ship, "a ship is loading at Haven");
  const flag = view(game).here.ships.find((one) => one.id === ship.id).flies;
  assert.doesNotMatch(flag, /^(Hegemony|Kessara Syndicate|Refugee Fleet|Order of Ilun)$/, "a faction reads with its the in a sentence");
  const before = haulsOf(game, ship.id).reduce((sum, haul) => sum + haul[3], 0);
  order(game, "ship-board", ship.id);
  assert.equal(game.combat.story?.reason ?? game.combat.enemies[0].reason, "You've come aboard their ship for what's in her hold.");
  weaken(game);
  const out = fight(game);
  assert.equal(out.result, "victory");
  const after = haulsOf(game, ship.id).reduce((sum, haul) => sum + haul[3], 0);
  assert.ok(after < before, "what was taken isn't aboard her any more");
  const to = ship.to.id;
  const said = game.world.news.find((entry) => entry.place === to && /was boarded at Haven Station, and .+ bound for .+ won't be coming\.$/.test(entry.text));
  assert.ok(said, "the port she was bound for hears of it");
  assert.doesNotMatch(said.text, /before she'd unloaded/);
  assert.match(readRecord(game).facts.find((fact) => fact.id === "robbed_a_freighter").text, /, bound for .+\.$/);
});
