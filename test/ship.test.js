// The Meridian on her own: her stores, the daily drain, shortages, rations, the hull, the star map, the stories set
// aside with the fleet, and old saves.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-ship-"));
process.env.GAME_DATA_DIR = dataDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { storePut } = await import("../src/bag.js");
const { countAboard, fillStores, logisticsOf, putAboard, takeAboard } = await import("../src/logistics.js");
const { LOCATIONS } = await import("../src/data.js");
const { LORE } = await import("../src/lore.js");
const { migrateGame } = await import("../src/migrate.js");
const { passTime, publicState, rest, travel } = await import("../src/rules.js");
// The written story says whether it's waiting on something, such as a written arrival.
await import("../src/scenes.js");
const { SHIP_ID, chairOf, councilOf, jumpCost, shipCommand, shipLedger, shipView } = await import("../src/ship.js");
const { leadsHere } = await import("../src/story-library.js");
const { clockOf } = await import("../src/story-clock.js");
const { TOOL_DEFS, newTurnLimits, runTool } = await import("../src/tools.js");
const { SET_ASIDE, SHIP_DATA, STAR_MAP, STORY_CLOCK, WORLD_THREADS } = await import("../src/world.js");

// The officers and the council have their own tests, in stories.test.js. Here it's only the ship.
const newGame = (seed = 21, archetype = "officer") => {
  const game = createGameFromDraft(randomDraft({ seed, archetype }));
  councilOf(game.ship).off = true;
  return game;
};
const tool = (game, name, input) => runTool(game, name, input, newTurnLimits());
const supply = (game, id) => shipView(game).supplies.find((entry) => entry.id === id);

// Passes whole days from midnight to midnight.
function days(game, count, activity = "routine") {
  game.clock.hours = Math.ceil(game.clock.hours / 24) * 24;
  game.ship.day = game.clock.hours / 24;
  const notes = [];
  for (let i = 0; i < count; i += 1) notes.push(...passTime(game, 24, activity));
  return notes;
}

// The rooms' stores are the count of food, medicine and parts (world/logistics): a test empties them, fills them, or
// stops the garden and the refills from nothing while a shortage has to last.
const ITEMS_OF = { food: ["ration_crate", "produce"], medicine: ["medicine_crate"], parts: ["parts_crate"] };
const stock = (game, id) => countAboard(game, SHIP_ID, ITEMS_OF[id]).n;
function empty(game, id) {
  for (const item of ITEMS_OF[id]) takeAboard(game, SHIP_ID, item, 999);
  if (id === "food") {
    game.stores ??= {};
    game.stores[logisticsOf(SHIP_ID).stores.find((one) => one.id === "soup_kettle").key] = { count: 0 };
  }
}
function withoutSources(run) {
  const model = logisticsOf(SHIP_ID);
  const garden = model.machines.find((one) => one.id === "garden");
  const refills = model.refills;
  garden.runs = false;
  model.refills = [];
  try {
    return run();
  } finally {
    garden.runs = true;
    model.refills = refills;
  }
}

// ---- The ship -----------------------------------------------------------

test("the ship's file: nine hundred aboard, four supplies, four ration levels, and three captains for the chair", () => {
  assert.equal(SHIP_ID, "meridian");
  assert.equal(SHIP_DATA.ship.aboard, 900);
  assert.deepEqual(Object.keys(SHIP_DATA.supplies), ["food", "fuel", "medicine", "parts"]);
  assert.deepEqual(Object.keys(SHIP_DATA.rations), ["generous", "standard", "reduced", "half"]);
  for (const id of Object.keys(SHIP_DATA.start)) assert.ok(id === "health" || SHIP_DATA.supplies[id], id);
  for (const [id, uses] of Object.entries(SHIP_DATA.ship.uses)) assert.ok(SHIP_DATA.supplies[id] && uses > 0, id);
  assert.equal(Object.keys(SHIP_DATA.chair.captains).length, 3);
  for (const port of SHIP_DATA.chair.ports) assert.ok(STAR_MAP.places[port], port);
  assert.ok(!("crews" in SHIP_DATA) && !("raid" in SHIP_DATA) && !("ships" in SHIP_DATA), "nothing of the fleet is left in the file");
});

test("a new game's ship carries her stores, with the day's clock set and nobody else in the chair", () => {
  const game = newGame();
  const s = game.ship;
  assert.equal(game.version, 21);
  assert.equal(s.aboard, 900);
  assert.equal(s.food, SHIP_DATA.start.food);
  assert.equal(s.medicine, SHIP_DATA.start.medicine);
  assert.equal(s.parts, SHIP_DATA.start.parts);
  assert.equal(s.health, SHIP_DATA.start.health);
  assert.equal(s.rations, "standard");
  assert.equal(s.day, 0);
  assert.equal(s.at, null, "she starts in open space");
  assert.equal(s.chair, null);
  assert.equal(game.fleet, undefined);
  assert.equal(chairOf(game), null);
});

test("the Sundial and Anselm's Mercy are places of their own now, on the chart, a jump away", () => {
  const game = newGame();
  for (const id of ["sundial", "anselm"]) {
    assert.ok(LOCATIONS[id], id);
    assert.equal(LOCATIONS[id].fleet, undefined);
    assert.ok(STAR_MAP.places[id]?.charted, `${id} is on every captain's chart`);
    const cost = jumpCost(game, id);
    assert.equal(cost.jump, true);
    assert.ok(cost.fuel >= 1);
    assert.ok(publicState(game).locations.some((place) => place.id === id));
  }
});

// ---- The daily drain -------------------------------------------------------

test("supplies drain at midnight, and only then", () => {
  const game = newGame();
  game.clock.hours = 10;
  passTime(game, 13);
  assert.equal(game.ship.owed, undefined, "it isn't midnight yet");
  passTime(game, 2);
  assert.ok(game.ship.owed.medicine > 0 && game.ship.owed.parts > 0, "and now a day has gone by: the medbay and the engineers have used a little");
  assert.equal(game.ship.day, 1);
});

test("passing many days at once runs each one", () => {
  const one = newGame();
  const many = newGame();
  for (let i = 0; i < 5; i += 1) days(one, 1);
  days(many, 5);
  assert.equal(stock(one, "food"), stock(many, "food"));
  assert.equal(stock(one, "medicine"), stock(many, "medicine"));
  assert.equal(one.ship.fuel, many.ship.fuel);
  assert.equal(one.ship.day, many.ship.day);
});

test("left alone, the numbers hold: about two weeks of fuel keeping station, three and a half weeks of food, six of medicine", () => {
  const game = newGame();
  const ledger = shipLedger(game);
  assert.ok(ledger.people === 900);
  const shown = shipView(game).supplies;
  const row = (id) => shown.find((s) => s.id === id);
  // Food is every crate and basket in the pantry, the shuttle stores and the garden bins, about six days of it at
  // nine a day, and the refills from nothing keep it up; medicine and parts are their crates, and nothing refills them.
  assert.equal(row("food").stock, 56);
  assert.equal(row("food").unit, "crates");
  assert.equal(row("food").days, null, "holding, while the refills keep up");
  withoutSources(() => {
    const starved = shipView(game).supplies.find((s) => s.id === "food");
    assert.ok(starved.days >= 5 && starved.days <= 7, `with nothing coming aboard, food lasts ${starved.days} days`);
  });
  assert.ok(row("medicine").days > 35 && row("medicine").days < 50, `medicine lasts ${row("medicine").days} days`);
  assert.ok(row("parts").days > 60 && row("parts").days < 100, `parts last ${row("parts").days} days`);
  assert.ok(row("fuel").days >= 12 && row("fuel").days <= 16, "about two weeks of fuel keeping station");
  assert.equal(row("fuel").days, Math.floor(game.ship.fuel / -ledger.net.fuel));
});

test("fuel is one number: the tank the jumps use, and it burns in whole units", () => {
  const game = newGame();
  game.ship.fuel = 3;
  days(game, 1);
  assert.ok(Number.isInteger(game.ship.fuel), `fuel ${game.ship.fuel}`);
  assert.ok(game.ship.fuel <= 3 && game.ship.fuel >= 2);
  days(game, 5);
  assert.ok(game.ship.fuel <= 1, `fuel ${game.ship.fuel} after six days`);
  assert.ok(Number.isInteger(game.ship.fuel));
  assert.equal(supply(game, "fuel").stock, game.ship.fuel, "the Ship menu shows the tank itself");
});

// ---- Shortages ---------------------------------------------------------------

test("a shortage warns first, then hits, and shows up in the story as lines", () => {
  const game = newGame();
  withoutSources(() => {
    // Down to about four days of food, with nothing coming aboard.
    takeAboard(game, SHIP_ID, "ration_crate", 20);
    const warned = days(game, 1);
    assert.ok(warned.some((line) => /^\[SUPPLY\] Food is down to about \d+ days/.test(line)), warned.join(" | "));
    assert.deepEqual(shipView(game).shortages, ["food"]);
    const out = days(game, 6);
    assert.ok(out.some((line) => /^\[SUPPLY\] The Meridian is out of food/.test(line)), out.join(" | "));
    assert.equal(game.ship.out.food >= 1, true);
    assert.equal(supply(game, "food").out, true);
    const still = days(game, 5);
    assert.ok(still.some((line) => /with no food stores/.test(line)), "every five days, a reminder");
  });
});

test("no food pulls morale and health down, and the captain goes hungry too", () => {
  const game = newGame();
  empty(game, "food");
  const morale = game.ship.morale;
  const health = game.ship.health;
  const notes = withoutSources(() => days(game, 6));
  assert.ok(game.ship.morale < morale);
  assert.ok(game.ship.health < health);
  assert.ok(game.conditions.some((c) => c.id === "underfed"), "the captain eats what everyone eats");
  assert.ok(notes.some((line) => line.startsWith("[HEALTH] Underfed")));
  assert.ok(shipLedger(game).moraleTarget < SHIP_DATA.rations.standard.morale);
});

test("with parts aboard the engineers mend the hull, and without them it wears", () => {
  const mended = newGame();
  mended.ship.hull = 50;
  days(mended, 10);
  assert.ok(mended.ship.hull > 50 && mended.ship.hull <= 56, `hull ${mended.ship.hull} after ten days with parts`);
  const whole = newGame();
  whole.ship.hull = whole.ship.maxHull;
  days(whole, 10);
  assert.equal(whole.ship.hull, whole.ship.maxHull, "and never past the top");
  const worn = newGame();
  empty(worn, "parts");
  worn.ship.hull = 50;
  const notes = days(worn, 10);
  assert.ok(worn.ship.hull < 50 && worn.ship.hull >= 40, `hull ${worn.ship.hull} after ten days without parts`);
  assert.ok(notes.some((line) => /out of parts/.test(line)));
});

test("no medicine: health falls, wounds heal slower, and people aboard start dying", () => {
  const game = newGame();
  empty(game, "medicine");
  const before = game.ship.aboard;
  // The shortage is counted at midnight, and from then on wounds heal at half speed.
  days(game, 1);
  assert.ok(game.ship.out.medicine);
  game.conditions.push({ id: "concussed", hoursLeft: 24 });
  days(game, 1);
  assert.ok(game.conditions[0]?.hoursLeft > 0 && game.conditions[0].hoursLeft <= 13, `${game.conditions[0]?.hoursLeft} hours left: half speed`);
  // With the food gone too, and nothing coming aboard, health falls far enough for people to die.
  empty(game, "food");
  withoutSources(() => days(game, 40));
  assert.ok(game.ship.health < SHIP_DATA.rules.deadlyHealth, `health ${game.ship.health}`);
  assert.ok(game.ship.aboard < before, "people have died");
  assert.ok(game.ship.aboard >= SHIP_DATA.rules.peopleFloor, "but never below the ship's own crew");
  assert.ok(game.ship.log.some((entry) => /have died of hunger and sickness/.test(entry.text)));
});

test("restocking ends a shortage, and says so", () => {
  const game = newGame();
  empty(game, "food");
  withoutSources(() => days(game, 2));
  assert.ok(game.ship.out.food);
  const { notice } = withoutSources(() => tool(game, "pass_time", { hours: 1, activity: "active", reason: "A moment" }));
  assert.ok(!/food again/.test(notice ?? ""));
  putAboard(game, SHIP_ID, "ration_crate", 20);
  const notes = withoutSources(() => days(game, 1));
  assert.ok(notes.some((line) => /There's food again/.test(line)), notes.join(" | "));
  assert.equal(game.ship.out.food, undefined);
});

// ---- Rations -----------------------------------------------------------------

test("morale and health settle where the rations put them", () => {
  const game = newGame();
  // Every store kept full, and the tank, so that only the rations have a say.
  const stocked = () => {
    fillStores(game, SHIP_ID);
    game.ship.fuel = game.ship.maxFuel;
  };
  // The stories that move on by themselves nudge morale a point or two, so it settles near its level, not on it.
  const near = (value, target) => Math.abs(value - target) <= 3;
  for (let day = 0; day < 40; day += 1) { stocked(); days(game, 1); }
  assert.ok(near(game.ship.morale, SHIP_DATA.rations.standard.morale), `morale ${game.ship.morale}`);
  assert.equal(game.ship.health, SHIP_DATA.rations.standard.health);
  shipCommand(game, { action: "rations", id: "generous" });
  for (let day = 0; day < 40; day += 1) { stocked(); days(game, 1); }
  // Generous rations are a quarter more to serve, and the galley's kettle can't quite keep up through the sittings, so
  // some find it empty and morale settles a little under what the rations promise: better than standard, not the full way.
  assert.ok(game.ship.morale > SHIP_DATA.rations.standard.morale + 3 && game.ship.morale <= SHIP_DATA.rations.generous.morale, `morale ${game.ship.morale}`);
  assert.equal(game.ship.health, SHIP_DATA.rations.generous.health);
});

test("ration levels have a visible cost and benefit, and do what they say", () => {
  const game = newGame();
  const { rations } = shipView(game);
  assert.equal(rations.length, 4);
  assert.equal(rations.find((r) => r.current).id, "standard");
  const generous = rations.find((r) => r.id === "generous");
  const half = rations.find((r) => r.id === "half");
  assert.ok(generous.foodUsed > half.foodUsed);
  assert.ok(generous.moraleTarget > half.moraleTarget);
  const { message } = shipCommand(game, { action: "rations", id: "half" });
  assert.match(message, /Rations aboard are now half/);
  assert.equal(shipLedger(game).used.food, half.foodUsed);
  assert.throws(() => shipCommand(game, { action: "rations", id: "feast" }), /no such ration level/);
});

test("half rations are hard on morale and health, and on the captain", () => {
  const game = newGame();
  shipCommand(game, { action: "rations", id: "half" });
  days(game, 10);
  assert.ok(game.ship.morale < 55);
  assert.ok(game.conditions.some((c) => c.id === "underfed"));
});

// ---- Orders ------------------------------------------------------------------

test("waiting passes whole days, and doesn't tire the captain", () => {
  const game = newGame();
  game.clock.hours = 9;
  const fatigue = game.needs.fatigue;
  const { message, notes } = shipCommand(game, { action: "wait", days: 3 });
  assert.match(message, /The Meridian holds position for 3 days/);
  assert.equal(game.clock.hours, 81);
  assert.equal(game.ship.day, 3);
  assert.ok(notes[0].startsWith("[TIME]"));
  assert.equal(game.needs.fatigue, fatigue);
  shipCommand(game, { action: "wait", days: 99 });
  assert.equal(game.clock.hours, 81 + 72, "three days at most at once");
  assert.throws(() => shipCommand(game, { action: "strip", id: "x" }), /Unknown order/);
});

test("buying needs a dock that sells, credits and room in the tank", () => {
  const game = newGame();
  assert.throws(() => shipCommand(game, { action: "buy", id: "fuel" }), /Nobody here is selling/);
  game.ship.at = "haven";
  game.location = "haven";
  game.credits = 1;
  assert.throws(() => shipCommand(game, { action: "buy", id: "food" }), /can't afford/);
  game.credits = 10000;
  game.ship.fuel = game.ship.maxFuel;
  assert.throws(() => shipCommand(game, { action: "buy", id: "fuel" }), /tank is full/);
  // The stores start full, so a lot of food needs room first.
  assert.throws(() => shipCommand(game, { action: "buy", id: "food" }), /no room aboard/);
  takeAboard(game, SHIP_ID, "ration_crate", 5);
  const food = stock(game, "food");
  const { message } = shipCommand(game, { action: "buy", id: "food" });
  assert.match(message, /^Bought 5 crates of food for the ship, for \d+ credits/);
  assert.equal(stock(game, "food"), food + 5);
});

// ---- The star map -------------------------------------------------------------

test("every place has a spot on the chart, inside the frame, except the Meridian herself", () => {
  for (const [id, place] of Object.entries(LOCATIONS)) {
    if (id === SHIP_ID) {
      assert.equal(STAR_MAP.places[id], undefined, "she's the @, not a star");
      continue;
    }
    const spot = STAR_MAP.places[id];
    assert.ok(spot, `${id} isn't on the chart`);
    assert.ok(spot.x > 0 && spot.x < STAR_MAP.cols - 1 && spot.y > 0 && spot.y < STAR_MAP.rows - 1, `${id} is off the chart`);
    assert.ok(spot.short, id);
    assert.ok(Number.isInteger(spot.danger) && spot.danger >= 0 && spot.danger < STAR_MAP.dangerLevels.length, id);
    assert.equal(spot.yields, undefined, `${id}: the crews' gathering went with the fleet`);
    for (const supplyId of Object.keys(spot.trade ?? {})) assert.ok(SHIP_DATA.supplies[supplyId], `${id}: ${supplyId}`);
    assert.ok(!place.fleet, `${id} still carries the fleet's flag`);
  }
  for (const id of Object.keys(STAR_MAP.places)) assert.ok(LOCATIONS[id], `${id} isn't a place`);
});

test("no two names on the chart overlap, even with every place known", () => {
  const boxes = Object.entries(STAR_MAP.places).map(([id, spot]) => {
    const width = spot.short.length + 2;
    // Near the right-hand edge the name goes on the left of the star, as public/map.js draws it.
    const flip = spot.x + spot.short.length + 3 > STAR_MAP.cols;
    const left = flip ? spot.x - spot.short.length - 1 : spot.x;
    return { id, y: spot.y, left, right: left + width };
  });
  for (const box of boxes) {
    assert.ok(box.left >= 0 && box.right <= STAR_MAP.cols, `${box.id} runs off the chart`);
    for (const other of boxes) {
      if (box === other || box.y !== other.y) continue;
      assert.ok(box.right <= other.left || other.right <= box.left, `${box.id} overlaps ${other.id}`);
    }
  }
});

test("the map shows what a jump costs, how dangerous it is and who runs the place", () => {
  const game = newGame();
  const places = publicState(game).locations;
  const haven = places.find((place) => place.id === "haven");
  assert.ok(haven, "Haven should be on every captain's chart");
  assert.equal(haven.fuel, 1);
  assert.ok(haven.hours > 1);
  assert.equal(typeof haven.dangerLabel, "string");
  assert.equal(typeof haven.control, "string");
  assert.equal(haven.canGo, true);
  assert.equal(haven.shipIsHere, false);
  const vantor = places.find((place) => place.id === "vantor");
  assert.ok(vantor.fuel > haven.fuel && vantor.hours > haven.hours, "further should cost more");
  assert.equal(vantor.control, "Hegemony");
  const own = places.find((place) => place.id === SHIP_ID);
  assert.equal(own.ownShip, true);
  assert.equal(own.here, true);
  assert.ok(!places.some((place) => place.id === "harbor"), "the end of the story stays hidden");
  assert.ok(!places.some((place) => place.id === "nest"), "this hasn't come up in the story yet");
  game.seenLore.push("place:nest");
  assert.equal(publicState(game).locations.find((place) => place.id === "nest").control, "The Choir");
});

test("a jump needs all its fuel, says so on the map, and costs fuel in the game", () => {
  const game = newGame();
  game.skills.navigation = 0;
  game.ship.fuel = 1;
  const vantor = publicState(game).locations.find((place) => place.id === "vantor");
  assert.equal(vantor.canGo, false);
  assert.match(vantor.why, /Needs 2 fuel, and the Meridian has 1/);
  assert.throws(() => travel(game, "vantor"), /2 fuel/);
  assert.equal(game.ship.fuel, 1, "a failed jump costs nothing");
  game.ship.fuel = 5;
  travel(game, "vantor");
  assert.equal(game.ship.fuel, 3);
  assert.equal(game.ship.at, "vantor");
  assert.equal(jumpCost(game, "vantor").jump, false, "you can't jump to where you already are");
});

test("Set course runs here, and the story hears about it when the player carries on", () => {
  const game = newGame();
  const { message, notes, moved } = shipCommand(game, { action: "course", id: "haven" });
  assert.equal(moved, true);
  assert.equal(game.location, "haven");
  assert.match(message, /Jumped to Haven Station/);
  assert.match(notes[0], /^\[NAV\]/);
  assert.equal(game.arrived, "haven");
  assert.equal(publicState(game).storyWaiting, true, "Haven has a written arrival, which plays when the player carries on");
  // From Haven, the Meridian and the dock are a short hop apart.
  shipCommand(game, { action: "course", id: SHIP_ID });
  assert.equal(game.ship.at, "haven");
  assert.equal(game.location, SHIP_ID);
  const fuel = game.ship.fuel;
  const { message: back } = shipCommand(game, { action: "course", id: "haven" });
  assert.match(back, /Crossed over/);
  assert.equal(game.ship.fuel, fuel);
  assert.equal(publicState(game).locations.find((place) => place.id === "haven").shipIsHere, true);
});

// ---- What the story can change ----------------------------------------------

test("when the story moves the clock, it says what the days brought", () => {
  const game = newGame();
  empty(game, "food");
  game.clock.hours = 20;
  const { result, notice } = withoutSources(() => tool(game, "pass_time", { hours: 48, activity: "active", reason: "A long wait" }));
  assert.match(result, /out of food/);
  assert.match(notice, /\[SUPPLY\]/);
});

test("the story's ship action changes hull, fuel and morale within limits, and the fleet's actions are gone", () => {
  const game = newGame();
  const { result, isError } = tool(game, "change_ship", { hull: 0, fuel: 99, morale: 99, reason: "Too good to be true" });
  assert.ok(!isError, result);
  assert.equal(game.ship.fuel, game.ship.maxFuel);
  assert.equal(game.ship.morale, 55 + 15);
  for (const gone of ["change_fleet", "change_fleet_ship", "read_fleet"]) {
    assert.ok(!TOOL_DEFS.some((def) => def.name === gone), `${gone} is still offered`);
    assert.equal(tool(game, gone, { reason: "x" }).isError, true);
  }
  assert.ok(TOOL_DEFS.some((def) => def.name === "change_command"));
});

test("the codex has no ships of the fleet, and the chart has no fleet", () => {
  assert.ok(!LORE.some((entry) => entry.kind === "ship"));
  assert.ok(LORE.some((entry) => entry.id === "place:meridian"));
  const view = publicState(newGame());
  assert.equal(view.fleet, undefined);
  assert.equal(view.ship.aboard, 900);
  assert.ok(Array.isArray(view.ship.supplies) && view.ship.supplies.length === 4);
  assert.equal(view.role.withShip, true);
});

// ---- Stories set aside with the fleet ------------------------------------------

test("stories set aside stay in their files, out of the Leads menu, and still on the clock's shelf", () => {
  assert.ok(SET_ASIDE.size >= 10, `${SET_ASIDE.size} set aside`);
  for (const id of SET_ASIDE) assert.ok(WORLD_THREADS[id], `${id} is set aside, so it has to exist`);
  assert.ok(SET_ASIDE.has("fleet_frost_line") && SET_ASIDE.has("main_the_ship_that_sat_down"));
  const game = newGame();
  game.level = 10;
  const seen = new Set();
  for (const place of ["meridian", "haven", "sundial", "anselm", "wheel", "kessara"]) {
    game.location = place;
    for (let day = 0; day < 30; day += 1) {
      game.clock.hours = day * 48 + 8;
      for (const lead of leadsHere(game)) seen.add(lead.id);
    }
  }
  for (const id of SET_ASIDE) assert.ok(!seen.has(id), `${id} was offered`);
  assert.ok(seen.size > 20, `only ${seen.size} leads`);
  const waited = newGame();
  for (let day = 0; day < 200; day += 1) {
    fillStores(waited, SHIP_ID);
    waited.ship.fuel = waited.ship.maxFuel;
    days(waited, 1);
  }
  for (const id of SET_ASIDE) {
    assert.equal(clockOf(waited).threads[id], undefined, `${id} moved on by itself`);
    assert.ok(!waited.story.clock.moved.some((entry) => entry.id === id), id);
  }
  assert.ok(Object.keys(STORY_CLOCK.threads).length === Object.keys(WORLD_THREADS).length);
});

after(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // It's a temporary folder, so it doesn't matter if something is still holding on to it.
  }
});

// ---- Old saves ----------------------------------------------------------

const oldSave = (changes = {}) => {
  const save = JSON.parse(JSON.stringify({ ...newGame(), version: 6, ...changes }));
  save.ship = { name: "CFS Meridian", hull: save.ship.hull, maxHull: save.ship.maxHull, fuel: save.ship.fuel, maxFuel: save.ship.maxFuel, morale: save.ship.morale };
  delete save.fleet;
  return save;
};

test("a save from before the ship kept her own stores loads, with nothing charged for the days already gone", () => {
  const save = oldSave({ clock: { hours: 24 * 9 + 5 }, location: "kessara" });
  save.ship = { name: "CFS Meridian", hull: 40, maxHull: 100, fuel: 3, maxFuel: 12, morale: 31 };
  save.transcript = [{ role: "narrator", text: "The story so far.\n\n> Do something" }];
  const game = migrateGame(save);
  assert.equal(game.version, 21);
  assert.equal(game.ship.day, 9);
  assert.equal(game.ship.at, "kessara");
  assert.equal(stock(game, "food"), 56, "her stores are full, from the logistics file");
  assert.equal(game.ship.aboard, 900);
  assert.equal(game.ship.fuel, 3, "fuel stays what it was");
  assert.equal(game.ship.morale, 31, "morale stays what it was");
  assert.equal(game.ship.hull, 40);
  assert.equal(game.fleet, undefined);
  assert.equal(publicState(game).storyWaiting, false, "nothing's waiting on the player");
  passTime(game, 24);
  assert.ok(game.ship.owed?.medicine > 0, "and a day has been charged since");
});

test("a save with the fleet in it loses the fleet, and keeps what was the ship's", () => {
  const save = JSON.parse(JSON.stringify({ ...newGame(), version: 15 }));
  save.role = { id: "docker", captain: false };
  save.location = "haven";
  save.ship = { name: "CFS Meridian", hull: 60, maxHull: 100, fuel: 4, maxFuel: 12, morale: 40 };
  save.fleet = {
    day: 12, at: "cinder", chair: { id: "lund", funds: 300, lastJump: 10, lastBuy: 11 }, health: 50, rations: "reduced",
    food: 250, medicine: 80, parts: 40, pursuit: 60, raid: null, ships: { meridian: { condition: 60, aboard: 900, status: "active" } },
    log: [{ day: "Day 3, 00:00", tag: "FLEET", text: "Something happened." }], unheard: [], council: { off: true, ordered: {}, waiting: {}, last: {}, setRations: null, setCrews: "farms", recent: [] },
  };
  save.transcript = [{ role: "narrator", text: "The story so far." }];
  const game = migrateGame(save);
  assert.equal(game.version, 21);
  assert.equal(game.fleet, undefined);
  assert.equal(game.ship.day, 12);
  assert.equal(game.ship.at, "cinder");
  assert.deepEqual(game.ship.chair, { id: "lund", funds: 300, lastJump: 10, lastBuy: 11 });
  assert.equal(chairOf(game).name, "Captain Lund");
  assert.equal(game.ship.health, 50);
  assert.equal(game.ship.rations, "reduced");
  assert.equal(game.ship.food, SHIP_DATA.start.food, "the fleet's tonnes were for thirty thousand, so the ship starts from her file");
  assert.equal(game.ship.fuel, 4);
  assert.equal(game.ship.hull, 60);
  assert.equal(game.ship.log.length, 1);
  assert.equal(game.ship.council.off, true);
  assert.equal(game.ship.council.setCrews, undefined);
  assert.ok(game.transcript.some((entry) => /^\[SHIP\] The fleet is a thing of the past/.test(entry.text)));
  assert.doesNotThrow(() => publicState(game));
  assert.equal(JSON.stringify(game).includes("pursuit"), false);
});

test("loading a save twice changes nothing the second time", () => {
  const once = migrateGame(oldSave());
  const twice = migrateGame(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
  const fresh = newGame();
  assert.deepEqual(migrateGame(JSON.parse(JSON.stringify(fresh))), fresh);
});

test("a captain's save aboard the Sundial docks the Meridian there, and one from any older version works", () => {
  assert.equal(migrateGame(oldSave({ location: "sundial" })).ship.at, "sundial");
  const ancient = { ...oldSave(), version: 3, bestiary: undefined };
  delete ancient.campaign;
  const game = migrateGame(ancient);
  assert.equal(game.version, 21);
  assert.ok(game.ship.day !== undefined);
  assert.doesNotThrow(() => publicState(game));
});

test("sleeping pays for the day too", () => {
  const game = newGame();
  game.location = "meridian";
  game.clock.hours = 20;
  rest(game);
  assert.ok(game.ship.owed?.medicine > 0, "midnight went by in the sleep, and the day was charged");
});
