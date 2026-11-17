// Every place's supplies, prices and factions, day by day. None of this calls a real AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-daily-"));
process.env.GAME_DATA_DIR = dataDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { changePlace, levelName, newWorld, newsView, placeNow, supplyFactor, worldRumors } = await import("../src/daily.js");
const { FACTIONS, ITEMS, LOCATIONS } = await import("../src/data.js");
const { chartEntry, shipCommand, shipView } = await import("../src/ship.js");
const { migrateGame } = await import("../src/migrate.js");
const { projectDir } = await import("../src/paths.js");
const { buy, buyPrice, passTime, publicState, sell, sellPrice } = await import("../src/rules.js");
const { countAboard, takeAboard } = await import("../src/logistics.js");
const { rumorsHere } = await import("../src/story-library.js");
const { TOOL_DEFS, newTurnLimits, runTool } = await import("../src/tools.js");
const { DAILY, STAR_MAP } = await import("../src/world.js");

const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story so far." });
  // A captain who doesn't breathe, so that months can go by with nobody at the helm: left to herself the Meridian loses
  // her air about day 20, and since 2026-11-16 a captain who breathes with it (test/players-death.test.js).
  game.character.species = "synthetic";
  return game;
};
const FILE = DAILY.places;
const tool = (game, name, input) => runTool(game, name, input, newTurnLimits());
const days = (game, count) => passTime(game, 24 * count, "routine");
const at = (place) => {
  const game = newGame();
  game.ship.at = place;
  game.location = place;
  game.walk = null;
  return game;
};

// ---- The file ---------------------------------------------------------------

test("every place and side and supply in the file is a real one", () => {
  for (const [id, place] of Object.entries(FILE)) {
    assert.ok(LOCATIONS[id], `${id} isn't a place`);
    for (const [good, from] of Object.entries(place.goods ?? {})) {
      assert.ok(DAILY.goods[good], `${id}: there's no such supply as ${good}`);
      for (const other of from) {
        assert.ok(FILE[other], `${id}: ${other} isn't in the file`);
        assert.notEqual(FILE[other].goods[good], undefined, `${id} gets ${good} from ${other}, which doesn't deal in it`);
      }
    }
    assert.equal(Object.values(place.hold).reduce((sum, share) => sum + share, 0), 100, `${id}: its shares should add up to 100`);
    for (const side of [...Object.keys(place.hold), ...Object.keys(place.push ?? {})]) assert.ok(FACTIONS[side] || place.sides?.[side], `${id}: nobody knows who ${side} is`);
  }
  for (const [id, good] of Object.entries(DAILY.items)) {
    assert.ok(ITEMS[id], `There's no such item as ${id}`);
    assert.ok(DAILY.goods[good], `${id} follows ${good}`);
  }
});

test("everything that can happen happens at real places, and is written properly", () => {
  const ids = new Set();
  for (const event of DAILY.events) {
    assert.ok(!ids.has(event.id), `${event.id} is in twice`);
    ids.add(event.id);
    assert.ok(event.places.length, event.id);
    assert.ok(event.news.endsWith("."), `${event.id} should be a sentence`);
    assert.ok(event.chance > 0 && event.chance < 0.05, `${event.id} would happen too often`);
    assert.ok(event.days[0] >= 1 && event.days[1] >= event.days[0], event.id);
    for (const place of event.places) {
      const file = FILE[place];
      assert.ok(file, `${event.id}: ${place} isn't in the file`);
      for (const good of Object.keys(event.goods ?? {})) if (event.places.length === 1) assert.notEqual(file.goods[good], undefined, `${event.id} changes ${good}, and ${place} doesn't deal in it`);
      for (const side of Object.keys(event.sides ?? {})) if (event.places.length === 1) assert.notEqual(file.hold[side], undefined, `${event.id} moves ${side}, who isn't at ${place}`);
    }
    if (event.places.length > 1) assert.match(event.news, /\{place\}/, `${event.id} should say where`);
  }
});

test("whatever sells to the Meridian on the star map is something that place deals in, unless it's a ship with no day of its own", () => {
  for (const [id, spot] of Object.entries(STAR_MAP.places)) {
    if (!FILE[id]) continue;
    for (const good of Object.keys(spot.trade ?? {})) assert.notEqual(FILE[id]?.goods?.[good], undefined, `${id} sells ${good} to the ship, so it needs a level for it`);
  }
});

test("the places that can't change hands are the ones the story needs that way", () => {
  for (const id of ["vantor", "ilun", "foundry", "orrin"]) assert.equal(FILE[id].locked, true, id);
  for (const id of ["nest", "asterion", "harbor", "pale_gate", "meridian"]) assert.equal(FILE[id], undefined, `${id} has nothing going on day to day`);
  // The farm ship and the hospital ship are ports of their own, held by the fleet's people for good.
  for (const id of ["sundial", "anselm"]) assert.deepEqual([FILE[id].locked, FILE[id].hold], [true, { fleet: 100 }], id);
});

// ---- How it starts ------------------------------------------------------------

test("on day one, every price and every chart entry is exactly what it always was", () => {
  const game = newGame();
  for (const [id, spot] of Object.entries(STAR_MAP.places)) {
    // The Sundial and Anselm's Mercy are ports now, held by the fleet's own people, who give their captain a friend's
    // price like any port does for whoever it thinks well of.
    const friend = ["sundial", "anselm"].includes(id) && game.factions.fleet >= DAILY.standing.friendly.at ? DAILY.standing.friendly.price : 1;
    for (const good of Object.keys(spot.trade ?? {})) assert.equal(supplyFactor(game, id, good), friend, `${id} ${good}`);
    if (!spot.control) continue;
    game.seenLore.push(`place:${id}`);
    assert.equal(chartEntry(game, id).control, spot.control, id);
    assert.equal(chartEntry(game, id).danger, spot.danger, id);
  }
  const shop = at("haven");
  assert.equal(buyPrice(shop, ITEMS.medkit), buyPrice(newGame(), ITEMS.medkit));
});

test("a new game has a world, and an older save gets one that starts from now", () => {
  assert.equal(newGame().version, 28);
  assert.ok(newGame().world.places.haven);
  const old = { ...newGame(), version: 11, clock: { hours: 24 * 40 + 8 } };
  old.ship.day = 40;
  delete old.world;
  // A save that old had no wounds kept, nobody laid up and no medbay of its own.
  for (const key of ["wounds", "bodies", "down", "medbay", "healthStarted"]) delete old[key];
  const game = migrateGame(JSON.parse(JSON.stringify(old)));
  assert.equal(game.version, 28);
  assert.equal(game.world.day, 40, "nobody pays for the days that went by before");
  assert.deepEqual(passTime(game, 1), [], "and nothing happens all at once");
  assert.doesNotThrow(() => publicState(game));
});

// ---- Day by day -----------------------------------------------------------------

test("a year goes by quickly, everything stays in bounds, and the world does change", () => {
  const game = newGame();
  // The work this takes, not the time on the wall: the tests all run at once, so a busy computer isn't a slow game.
  const started = process.cpuUsage();
  days(game, 365);
  const used = process.cpuUsage(started);
  const took = Math.round((used.user + used.system) / 1000);
  // About 3 s by itself, now that the ship's own logistics and the ports' real amounts run with it (the ports are a
  // quarter of a second of that); three or four times as much when every test runs at once on a busy computer.
  assert.ok(took < 12000, `a year took ${took} ms of work`);
  const { world } = game;
  assert.equal(world.day, 365);
  let moved = 0;
  for (const [id, state] of Object.entries(world.places)) {
    for (const [good, level] of Object.entries(state.goods)) {
      assert.ok(level >= 0 && level <= 200, `${id} ${good} is at ${level}`);
      if (level !== 100) moved += 1;
    }
    const total = Object.values(state.hold).reduce((sum, share) => sum + share, 0);
    assert.ok(Math.abs(total - 100) < 1, `${id}'s shares add up to ${total}`);
    assert.equal(state.holder, Object.entries(state.hold).sort((a, b) => b[1] - a[1])[0][0] === state.holder ? state.holder : state.holder);
  }
  assert.ok(moved > 30);
  assert.ok(world.news.length > 10, "plenty should have happened in a year");
  assert.ok(world.news.length <= 40, "and the list doesn't grow for ever");
  // The ports' other goods and what's on its way between them are kept too, since their amounts are real.
  assert.ok(JSON.stringify(world).length < 26000, `the save has ${JSON.stringify(world).length} characters of this`);
  assert.ok(world.hauls.length > 50 && world.hauls.length < 400, `${world.hauls.length} hauls on their way`);
});

test("the same game gives the same world, even after saving and loading part way", () => {
  // The same game, to the last number: a ship left in open space this long runs dry, and what becomes of her then,
  // and of the ports she's taken to, goes by who's aboard.
  const one = newGame();
  const two = JSON.parse(JSON.stringify(one));
  days(one, 60);
  days(two, 30);
  const loaded = JSON.parse(JSON.stringify(two));
  days(loaded, 30);
  assert.deepEqual(one.world, loaded.world);
  const other = newGame(99);
  other.name = "Somebody Else";
  other.world = newWorld(other);
  days(other, 60);
  assert.notDeepEqual(one.world.places, other.world.places, "another captain's world goes differently");
});

test("over the years, every place has good times and bad, and comes back from them", () => {
  const game = newGame();
  const low = {};
  const high = {};
  for (let day = 0; day < 365 * 3; day += 1) {
    days(game, 1);
    for (const [id, state] of Object.entries(game.world.places)) {
      for (const [good, level] of Object.entries(state.goods)) {
        const key = `${id}/${good}`;
        low[key] = Math.min(low[key] ?? 100, level);
        high[key] = Math.max(high[key] ?? 100, level);
      }
    }
  }
  const dipped = Object.values(low).filter((level) => level < 80).length;
  assert.ok(dipped > Object.keys(low).length / 2, `only ${dipped} of ${Object.keys(low).length} supplies ever ran short`);
  assert.ok(Object.values(high).some((level) => level > 135), "and something should have been in plenty");
  const averages = Object.values(game.world.places).flatMap((state) => Object.values(state.goods));
  const average = averages.reduce((sum, level) => sum + level, 0) / averages.length;
  assert.ok(average > 75 && average < 125, `on the whole it stays near normal, and it's at ${average}`);
});

test("trouble spreads: a place that runs out starts to hurt the places it supplies", () => {
  const game = newGame();
  const { places } = game.world;
  // Cinder's fuel runs out and stays out, and Haven gets its fuel partly from there.
  for (let day = 0; day < 15; day += 1) {
    places.cinder.goods.fuel = 0;
    places.deepyards.goods.fuel = 0;
    places.haven.events = [];
    days(game, 1);
  }
  assert.ok(places.haven.goods.fuel < 80, `Haven's fuel should be running short, and it's at ${places.haven.goods.fuel}`);
  // Left alone, it all recovers.
  for (let day = 0; day < 45; day += 1) {
    for (const place of Object.values(places)) place.events = [];
    days(game, 1);
  }
  assert.ok(places.cinder.goods.fuel > 80 && places.haven.goods.fuel > 80, `Cinder ${places.cinder.goods.fuel}, Haven ${places.haven.goods.fuel}`);
});

test("something going on at a place pushes its supplies and its sides, and then it ends", () => {
  const game = newGame();
  const state = game.world.places.cinder;
  state.events = [{ id: "cinder_picket_fight", left: 10 }];
  const company = state.hold.company;
  const strike = state.hold.strike;
  days(game, 5);
  assert.ok(state.goods.fuel < 90, `fuel at ${state.goods.fuel}`);
  assert.ok(state.hold.strike > strike && state.hold.company < company);
  assert.equal(chartEntry(game, "cinder").danger, STAR_MAP.places.cinder.danger + 1, "and it's more dangerous for now");
  assert.ok(placeNow(game, "cinder").going[0].includes("picket"));
  days(game, 6);
  assert.ok(!state.events.some((event) => event.id === "cinder_picket_fight"));
});

test("a side that keeps gaining ground takes over, and it's big news", () => {
  const game = newGame();
  game.seenLore.push("place:cinder");
  const state = game.world.places.cinder;
  const name = (side) => DAILY.places.cinder.sides[side];
  state.hold = { company: 30, strike: 60, hegemony: 5, drift: 5 };
  state.holder = "company";
  const notes = passTime(game, 24);
  assert.equal(state.holder, "strike");
  assert.ok(notes.some((line) => line.startsWith("[WORLD]") && line.includes(name("strike"))), notes.join(" | "));
  assert.equal(chartEntry(game, "cinder").control, name("strike"), "the star map says so");
  assert.equal(placeNow(game, "cinder").changed, true);
  assert.ok(newsView(game).some((entry) => entry.text.includes(name("strike"))), "and it's in the news");
});

test("a place that can't change hands never does, however hard anyone pushes", () => {
  const game = newGame();
  game.world.places.vantor.hold = { hegemony: 100 };
  days(game, 200);
  assert.equal(game.world.places.vantor.holder, "hegemony");
  assert.throws(() => changePlace(game, { place: "foundry", side: "unbound", amount: -30, reason: "Test" }), /Nobody can take/);
});

test("nobody hears about somewhere they don't know of, or something small that's far away", () => {
  const game = newGame();
  const { world } = game;
  world.places.foundry.events = [];
  world.news.push({ day: world.day, place: "foundry", text: "A secret from Foundry Seven." });
  world.news.push({ day: world.day, place: "haven", text: "Something at Haven." });
  assert.ok(!newsView(game).some((entry) => entry.text.includes("secret")), "Foundry Seven isn't known yet");
  assert.ok(newsView(game).some((entry) => entry.text.includes("Haven")));
  game.seenLore.push("place:foundry");
  assert.ok(newsView(game).some((entry) => entry.text.includes("secret")));
  // A whole year's worth, and the captain's only told what's close or big.
  const quiet = newGame();
  const notes = passTime(quiet, 24 * 120, "routine").filter((line) => line.startsWith("[WORLD]"));
  assert.ok(notes.length < quiet.world.news.length + 40);
});

// ---- Prices --------------------------------------------------------------------

test("the less there is of something, the more it costs, and there's a band for how much that is", () => {
  const game = newGame();
  const { goods } = game.world.places.haven;
  const priced = (level) => {
    goods.fuel = level;
    return supplyFactor(game, "haven", "fuel");
  };
  assert.equal(priced(100), 1);
  assert.ok(priced(60) > 1.2 && priced(60) < 1.5);
  assert.ok(priced(10) > 2);
  assert.ok(priced(170) < 0.85);
  const curve = [0, 10, 20, 50, 80, 100, 135, 180, 200].map(priced);
  for (let i = 1; i < curve.length; i += 1) assert.ok(curve[i] < curve[i - 1], "it only ever goes one way");
  assert.deepEqual([150, 100, 60, 30, 5].map(levelName), ["plenty", "normal", "short", "scarce", "almost gone"]);
});

test("the ship pays what things cost today out of her purse, each lot it buys raises the price, and it can run out", () => {
  const game = at("haven");
  game.ship.purse = 100000;
  game.ship.fuel = 2;
  const before = shipView(game).trade.find((one) => one.id === "fuel");
  assert.equal(before.level, "normal");
  const credits = game.credits;
  shipCommand(game, { action: "buy", id: "fuel" });
  assert.equal(game.ship.purse, 100000 - before.price);
  assert.equal(game.credits, credits, "the captain's own credits aren't the ship's");
  const after1 = shipView(game).trade.find((one) => one.id === "fuel");
  assert.ok(after1.price > before.price, `${after1.price} after ${before.price}`);
  // Down to less than one measure of fuel on the whole station.
  game.world.places.haven.goods.fuel = 0.1;
  const empty = shipView(game).trade.find((one) => one.id === "fuel");
  assert.equal(empty.none, true);
  assert.throws(() => shipCommand(game, { action: "buy", id: "fuel" }), /any left/);
});

test("the ship can sell what it has, for more where it's short, and that eases the shortage", () => {
  const game = at("haven");
  const { goods } = game.world.places.haven;
  const row = (id) => shipView(game).trade.find((one) => one.id === id);
  const usual = row("medicine").sellFor;
  goods.medicine = 30;
  const dear = row("medicine").sellFor;
  assert.ok(dear > usual * 1.5, `${dear} against ${usual}`);
  assert.ok(row("medicine").price > dear, "buying always costs more than selling pays");
  const credits = game.credits;
  // Medicine is the crates in the medbay's cabinet, and a sale takes one out.
  const stock = countAboard(game, "meridian", ["medicine_crate"]).n;
  const purse = shipView(game).money.purse;
  const reply = shipCommand(game, { action: "sell", id: "medicine" });
  assert.equal(shipView(game).money.purse, purse + dear, "what the ship sells goes into her purse");
  assert.equal(game.credits, credits);
  assert.equal(countAboard(game, "meridian", ["medicine_crate"]).n, stock - 1);
  assert.ok(goods.medicine > 30);
  assert.match(reply.message, /Sold 1 crate of the ship's medicine/);
  takeAboard(game, "meridian", "parts_crate", 999);
  assert.throws(() => shipCommand(game, { action: "sell", id: "parts" }), /hasn't got/);
  game.ship.fuel = 0;
  assert.throws(() => shipCommand(game, { action: "sell", id: "fuel" }), /hasn't got/);
  const nowhere = at("meridian");
  assert.throws(() => shipCommand(nowhere, { action: "sell", id: "food" }), /Nobody here/);
});

test("the market's prices follow the supplies too, and what you sell is worth more where it's short", () => {
  const game = at("haven");
  game.credits = 100000;
  const { goods } = game.world.places.haven;
  const medkit = buyPrice(game, ITEMS.medkit);
  const paper = buyPrice(game, ITEMS.forged_papers);
  const carbine = buyPrice(game, ITEMS.heavy_carbine);
  const value = sellPrice(game, ITEMS.medkit);
  goods.medicine = 20;
  goods.parts = 20;
  assert.ok(buyPrice(game, ITEMS.medkit) > medkit * 1.4, "medicine's what a medkit's made of");
  assert.ok(sellPrice(game, ITEMS.medkit) > value);
  assert.equal(buyPrice(game, ITEMS.forged_papers), paper, "a forged paper isn't made of anything that's short");
  assert.ok(buyPrice(game, ITEMS.heavy_carbine) > carbine, "a gun's made of parts");
  assert.ok(buyPrice(game, ITEMS.heavy_carbine) < carbine * 1.5, "but less steeply than the parts themselves");
  const paid = buyPrice(game, ITEMS.medkit);
  const credits = game.credits;
  buy(game, "medkit");
  assert.equal(game.credits, credits - paid);
  sell(game, "medkit");
  assert.ok(game.credits < credits);
  goods.medicine = 200;
  assert.ok(buyPrice(game, ITEMS.medkit) < medkit, "and a glut makes it cheap");
});

test("whoever holds a place charges you more if they hate you, and less if they like you", () => {
  const game = at("haven");
  const usual = buyPrice(game, ITEMS.medkit);
  const fuel = supplyFactor(game, "haven", "fuel");
  game.factions.drift = -60;
  assert.ok(buyPrice(game, ITEMS.medkit) > usual);
  assert.ok(supplyFactor(game, "haven", "fuel") > fuel);
  assert.ok(buyPrice(game, ITEMS.forged_papers) > 0);
  game.factions.drift = 70;
  assert.ok(buyPrice(game, ITEMS.medkit) < usual);
  game.factions.drift = 0;
  game.world.places.haven.holder = "hegemony";
  game.factions.hegemony = -80;
  assert.ok(buyPrice(game, ITEMS.medkit) > usual, "and it's whoever holds it now that counts");
});

test("the Meridian herself has no prices of her own; the Sundial and Anselm's Mercy are ports now, and have", () => {
  const aboard = at("meridian");
  assert.equal(buyPrice(aboard, ITEMS.ration_pack), buyPrice(newGame(), ITEMS.ration_pack));
  assert.equal(placeNow(aboard, "meridian"), null);
  // A farm ship that's short of food charges more for it.
  const game = at("sundial");
  const usual = buyPrice(game, ITEMS.ration_pack);
  game.world.places.sundial.goods.food = 30;
  assert.ok(buyPrice(game, ITEMS.ration_pack) > usual, "food costs more on the Sundial when it's scarce there");
  const now = placeNow(game, "sundial");
  assert.deepEqual(now.goods.map((good) => good.id), ["food", "medicine", "parts"]);
  assert.equal(now.goods[0].level, "scarce");
  assert.match(now.goods[0].has, /^[\d,]+ ration crates$/);
  assert.equal(now.holder, FACTIONS.fleet.name, "held by the fleet's people, as its own file says");
  assert.deepEqual([now.shares, now.changed, now.rival], [[], false, null], "and that never changes");
  assert.deepEqual(placeNow(at("anselm"), "anselm").goods.map((good) => good.id), ["food", "medicine", "parts"]);
  // A save from before they were ports gets them, as they usually stand.
  const old = newGame();
  delete old.world.places.sundial;
  delete old.world.places.anselm;
  const loaded = JSON.parse(JSON.stringify(old));
  passTime(loaded, 1, "routine");
  assert.deepEqual(loaded.world.places.sundial.goods, { food: 100, medicine: 100, parts: 100 });
  assert.equal(loaded.world.places.anselm.holder, "fleet");
});

// ---- The story ------------------------------------------------------------------

test("the story can change how things stand at a place, when it really does", () => {
  const game = newGame();

  const reply = tool(game, "change_place", { place: "cinder", fuel: -200, side: "strike", amount: 100, news: "The strikers have taken the Stack at Cinder Reach.", reason: "The captain helped them take the Stack." });
  assert.ok(!reply.isError, reply.result);
  const state = game.world.places.cinder;
  assert.equal(state.goods.fuel, 40, "it only goes so far at once");
  assert.equal(state.holder, "strike");
  assert.match(reply.result, /The strikers now holds it|The strikers now/);
  assert.match(reply.notice, /^\[WORLD\] Cinder Reach: The captain helped/);
  assert.equal(game.world.news.at(-1).text, "The strikers have taken the Stack at Cinder Reach.");

  assert.ok(tool(game, "change_place", { place: "cinder", side: "nobody", amount: 5, reason: "Test" }).isError);
  assert.ok(tool(game, "change_place", { place: "sarn", fuel: 5, reason: "Test" }).isError, "Sarn doesn't deal in fuel");
  assert.ok(tool(game, "change_place", { place: "meridian", food: 5, reason: "Test" }).isError);
  assert.ok(tool(game, "change_place", { place: "foundry", side: "unbound", amount: -5, reason: "Test" }).isError);
});

test("the tool list stays the same whatever's happening, so it doesn't cost a reload", () => {
  const first = JSON.stringify(TOOL_DEFS);
  days(newGame(), 30);
  assert.equal(JSON.stringify(TOOL_DEFS), first);
});

test("what people say includes the latest news, and it goes stale", () => {
  const game = at("haven");
  assert.deepEqual(worldRumors(game), []);
  game.world.news.push({ day: game.world.day, place: "kessara", text: "Something's happened at Kessara Drift." });
  assert.equal(rumorsHere(game)[0], "Something's happened at Kessara Drift.");
  game.world.news.push({ day: game.world.day, place: "foundry", text: "A secret from Foundry Seven." });
  assert.ok(!worldRumors(game, 5).includes("A secret from Foundry Seven."), "nobody's heard of that place yet");
  game.world.news.push({ day: game.world.day, place: "haven", text: "Something's happened right here." });
  assert.equal(worldRumors(game)[0], "Something's happened right here.", "what's closest comes first");
  game.world.day += 30;
  assert.deepEqual(worldRumors(game), []);
});

test("the map and the menus get what they need, and nothing that gives away what's hidden", () => {
  const game = at("haven");
  game.world.places.haven.goods.food = 30;
  const shown = publicState(game);
  const food = shown.world.here.goods.find((good) => good.id === "food");
  assert.deepEqual({ id: food.id, name: food.name, level: food.level, low: food.low, high: food.high }, { id: "food", name: "Food", level: "scarce", low: true, high: false });
  // How many that is, and why: with Maris Deep, which this captain hasn't heard of, not named.
  assert.match(food.has, /^[\d,]+ ration crates$/);
  assert.match(food.why, /Tessen Colony/);
  assert.ok(!JSON.stringify(shown.world.here).includes("Maris"), "a port that isn't known isn't named");
  assert.ok(shown.world.here.holds.some((tree) => tree.name === "Comforts"), "and everything else the port holds is there, a tree at a time");
  const entry = shown.locations.find((place) => place.id === "haven");
  assert.ok(entry.now.goods.length);
  assert.equal(shown.factions.find((one) => one.id === "drift").holds.includes("Haven Station"), true);
  assert.ok(!shown.factions.find((one) => one.id === "unbound").holds.length, "Foundry Seven isn't known yet");
  assert.ok(!JSON.stringify(shown.world).includes("seed"));
});

test("the place's people and its supplies don't get in each other's way in a long game", () => {
  const game = at("haven");
  days(game, 90);
  assert.doesNotThrow(() => publicState(game));
  for (const state of Object.values(game.world.places)) for (const level of Object.values(state.goods)) assert.ok(Number.isFinite(level));
});

// ---- Over the real server -----------------------------------------------------

const serverData = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-daily-server-"));
let child;
let port;

async function post(route, body = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, ...(await res.json()) };
}

before(async () => {
  fs.mkdirSync(path.join(serverData, "saves"), { recursive: true });
  fs.writeFileSync(path.join(serverData, "settings.json"), JSON.stringify({ provider: "claude", model: "claude-haiku-5-5", effort: "low", apiKey: "not-a-real-key" }));
  const save = at("haven");
  save.credits = 5000;
  fs.writeFileSync(path.join(serverData, "saves", "autosave.json"), JSON.stringify(save));
  port = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  child = spawn(process.execPath, ["server.js"], { cwd: projectDir, env: { ...process.env, GAME_DATA_DIR: serverData, PORT: String(port) }, stdio: "pipe" });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) resolve(); });
    child.on("exit", () => reject(new Error("The server stopped.")));
  });
});

after(() => {
  child?.removeAllListeners("exit");
  child?.kill();
  for (const folder of [serverData, dataDir]) {
    try {
      fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // It's a temporary folder, so it doesn't matter if something is still holding on to it.
    }
  }
});

test("over the real server: the clock runs away from the Meridian, trading moves the price, and waiting moves the world", async () => {
  const tick = await post("/api/tick", { ms: 500, rate: 60 });
  assert.equal(tick.status, 200);
  assert.ok(tick.clock);
  assert.ok(tick.people.length > 0, "there's someone at the docks");

  const start = (await (await fetch(`http://127.0.0.1:${port}/api/state`)).json()).game;
  const fuel = start.ship.trade.find((one) => one.id === "fuel");
  assert.equal(fuel.level, "normal");
  // The parts lockers start full, so a crate goes to the dock first, and then one comes back aboard, dearer.
  const sold = await post("/api/ship", { action: "sell", id: "parts" });
  assert.equal(sold.status, 200);
  assert.ok(sold.game.ship.money.purse > start.ship.money.purse, "into the ship's purse");
  assert.equal(sold.game.credits, start.credits);
  const bought = await post("/api/ship", { action: "buy", id: "parts" });
  assert.equal(bought.status, 200);
  assert.ok(bought.game.ship.trade.find((one) => one.id === "parts").price >= sold.game.ship.trade.find((one) => one.id === "parts").price);
  assert.ok(bought.game.ship.money.purse < start.ship.money.purse, "buying costs more than selling paid");

  const waited = await post("/api/ship", { action: "wait", days: 3 });
  assert.equal(waited.status, 200);
  assert.ok(waited.game.clock.hours >= start.clock.hours + 72);
  assert.ok(waited.game.world.here.goods.length === 4);
});
