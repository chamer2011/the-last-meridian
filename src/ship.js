// The Meridian on her own: where she is, what's aboard her (food, medicine and parts, and the fuel in her tank),
// how her people are holding up, the rations, who captains her when the player doesn't, and the star map's
// jumps. Everything here runs on this computer. The game master only ever gets a compact line about it, and a
// short report when something has happened, so none of this adds to what a turn costs.
//
// world/ship.json has the numbers and the words, and world/starmap.json has the chart. shipLedger is the one
// place that works out a day's numbers, so anything that should change them later belongs there. The fleet the
// Meridian once led is a thing of the past: there are no other ships here.

import { findCharacter } from "./campaign.js";
import { LOCATIONS, FACTIONS } from "./data.js";
import { inTrouble, levelName, noneLeft, placeNow, supplyFactor, tellNews, tradedAt } from "./daily.js";
import { aboardShip, isCaptain } from "./role.js";
import { addCondition, buyPrice, changeStress, clamp, clockLabel, jumpHours, passTime, sellPrice, travel } from "./rules.js";
import { navigationDown } from "./systems.js";
import { YOU, commandOf, holderKey, postAndName, setHolder, stillAlive, tallyDuty } from "./command.js";
import { countAboard, errandsView, foodADay, machinesView, mealsOfDay, mealsView, putAboard, refilledADay, refillsView, repairsView, storesView, takeAboard } from "./logistics.js";
import { SHIP_DATA, STAR_MAP } from "./world.js";

const { rules: RULES, rations: RATIONS, supplies: SUPPLIES, text: TEXT, council: COUNCIL, chair: CHAIR, ship: SHIP } = SHIP_DATA;

// The player's own ship. She's a place too, with this id.
export const SHIP_ID = "meridian";
const SUPPLY_IDS = Object.keys(SUPPLIES);
// Fuel lives in the ship's tank, with the jumps it pays for. The others are what's in her rooms' stores (world/logistics):
// food is every ration crate and basket of produce aboard, counted as crates. A game whose world has no logistics
// falls back on the old counts kept here.
const STORES = SUPPLY_IDS.filter((id) => id !== "fuel");
const STORE_ITEMS = { food: ["ration_crate", "produce"], medicine: ["medicine_crate"], parts: ["parts_crate"] };
// The stores a bought lot goes into first, and a sold or used one comes out of first.
const FIRST = { food: ["shuttle_stores", "pantry"], medicine: ["medicine_cabinet"], parts: ["parts_lockers", "shuttle_stores"] };
// A story's unit of food is about a day's eating, ten crates; its medicine and parts are crates already.
const STORY_FOOD_CRATES = 10;
const aboardCount = (game, id) => (id === "fuel" ? null : countAboard(game, SHIP_ID, STORE_ITEMS[id]));
const MAX_LOG = 40;
const MAX_REPORT_LINES = 5;

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// "5 t", "1 crate", "3 crates", or just "1" for fuel.
const lotText = (supply) => (supply.unit ? `${supply.lot} ${supply.lot === 1 ? supply.unit.replace(/s$/, "") : supply.unit}` : String(supply.lot));
const say = (key, vars = {}) => (TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
// A few of these are written to the captain, and read differently for anyone else.
const sayTo = (game, key, vars) => say(!isCaptain(game) && TEXT[`${key}Other`] ? `${key}Other` : key, vars);

function seedFrom(text) {
  let seed = 7;
  for (const ch of text) seed = (Math.imul(seed, 31) + ch.codePointAt(0)) >>> 0;
  return seed;
}

// The ship's own dice, kept in the save, so reloading doesn't change how a day goes.
function dice(ship) {
  ship.seed = (Math.imul(ship.seed, 1664525) + 1013904223) >>> 0;
  return ship.seed / 4294967296;
}

// ---- The ship in a saved game ------------------------------------------

// What a new game's ship carries besides her hull, fuel and morale, which game.ship always had.
export function newShipState(game) {
  const here = LOCATIONS[game.location];
  return {
    // The last day the simulation has run. Time before this has already been paid for.
    day: Math.floor(game.clock.hours / 24),
    // Where she's docked, or null in open space. The captain can be aboard her or on the dock she's at.
    at: isCaptain(game) && here && game.location !== SHIP_ID ? game.location : null,
    chair: isCaptain(game) ? null : newChair(game),
    aboard: SHIP.aboard,
    food: SHIP_DATA.start.food,
    medicine: SHIP_DATA.start.medicine,
    parts: SHIP_DATA.start.parts,
    fuelBurn: 0,
    hullWear: 0,
    health: SHIP_DATA.start.health,
    rations: "standard",
    // How many days each supply has been out, and which have had their warning.
    out: {},
    warned: {},
    deaths: 0,
    // What the game master hasn't been told yet, and what the Ship menu shows.
    unheard: [],
    log: [],
    seed: seedFrom(`${game.name}|ship`),
  };
}

// A save from before the ship kept these gets them, with nothing charged for the days already gone.
export function shipOf(game) {
  game.ship ??= { name: SHIP.name, hull: 70, maxHull: 100, fuel: 6, maxFuel: 12, morale: 55 };
  if (game.ship.day === undefined) Object.assign(game.ship, newShipState(game));
  game.ship.at = LOCATIONS[game.ship.at] ? game.ship.at : null;
  return game.ship;
}

// Who has the chair, if it isn't the player. Each game gets one of them, and it's the same one all the way through.
export function newChair(game) {
  const ids = Object.keys(CHAIR.captains);
  return { id: ids[seedFrom(`${game.name}|chair`) % ids.length], funds: CHAIR.funds, lastJump: -99, lastBuy: -99 };
}

// Whoever holds the captain's post when the player doesn't: the chain of command says who, and the captain they are
// says how they run her.
const captainPost = () => commandOf(SHIP_ID)?.chairPost ?? null;
const chairKey = (game) => (game.ship?.chair ? (captainPost() ? holderKey(game, SHIP_ID, captainPost()) : null) ?? game.ship.chair.id : null);
const chairFile = (game) => (chairKey(game) ? CHAIR.captains[chairKey(game)] ?? null : null);

export function chairOf(game) {
  const file = chairFile(game);
  return file ? { id: chairKey(game), name: file.name } : null;
}

// Places on every captain's chart from the start, so the star map isn't empty on day one.
export const isCharted = (id) => Boolean(STAR_MAP.places[id]?.charted);

const mapSpot = (id) => (id ? STAR_MAP.places[id] ?? null : null);
const placeName = (ship) => LOCATIONS[ship.at]?.name ?? STAR_MAP.openSpace;

// ---- A day's numbers ----------------------------------------------------

// What a day does right now, or what it would do if the rations changed.
export function shipLedger(game, change = {}) {
  const ship = shipOf(game);
  const rations = RATIONS[change.rations ?? ship.rations] ?? RATIONS.standard;
  const shortages = Object.keys(ship.out).filter((id) => ship.out[id] > 0);
  const people = ship.aboard;
  const made = Object.fromEntries(SUPPLY_IDS.map((id) => [id, 0]));
  const used = Object.fromEntries(SUPPLY_IDS.map((id) => [id, 0]));
  // What the whole ship eats at the kettle in a day, in crates, or the old tonnes where there are no sittings.
  used.food = foodADay(game, SHIP_ID, rations.food) ?? people * SUPPLIES.food.perPerson * rations.food;
  // Sick people need more medicine, so a medicine shortage feeds itself.
  used.medicine = people * SUPPLIES.medicine.perPerson * (1 + (100 - ship.health) / 100);
  for (const [id, amount] of Object.entries(SHIP.uses ?? {})) used[id] += amount;
  for (const [id, amount] of Object.entries(SHIP.produces ?? {})) made[id] += amount;
  // What the refills from nothing bring to the stores counts as made, up to what's used: while they keep up, a store
  // is holding, and nobody counts the days it has left.
  for (const id of STORES) if (aboardCount(game, id)) made[id] += Math.min(used[id], refilledADay(game, SHIP_ID, STORE_ITEMS[id]));
  const net = Object.fromEntries(SUPPLY_IDS.map((id) => [id, made[id] - used[id]]));
  let moraleTarget = rations.morale;
  let healthTarget = rations.health;
  for (const id of shortages) {
    moraleTarget += RULES.shortage[id]?.morale ?? 0;
    healthTarget += RULES.shortage[id]?.health ?? 0;
  }
  return {
    people,
    made,
    used,
    net,
    moraleTarget: clamp(moraleTarget, 5, 100),
    healthTarget: clamp(healthTarget, 5, 100),
    // With parts aboard the engineers keep the hull up, and mend it a little. Without them, she wears.
    wear: ship.out.parts ? RULES.wearNoParts : 0,
    mend: ship.out.parts ? 0 : RULES.mend,
  };
}

function stockOf(game, id) {
  if (id === "fuel") return Math.max(0, game.ship.fuel + game.ship.fuelBurn);
  const counted = aboardCount(game, id);
  return counted ? counted.n : game.ship[id] ?? 0;
}
// How much the ship can hold of a kind: what its stores keep between them, or the old guess.
function capacityOf(game, id) {
  if (id === "fuel") return game.ship.maxFuel;
  const counted = aboardCount(game, id);
  return counted ? counted.of : Math.max(SHIP_DATA.start[id] * 1.5, game.ship[id] ?? 0);
}
const isOut = (game, id) => (id === "fuel" ? game.ship.fuel < 1 : stockOf(game, id) <= 0);

function daysLeft(game, id, ledger) {
  const net = ledger.net[id];
  return net < -0.001 ? stockOf(game, id) / -net : null;
}

// ---- What the ship says ------------------------------------------------

// A line for the story and the Ship menu. The game master hears it with its next message too, unless it's the
// one that made the time pass, in which case it hears straight away. Only the newest line about each supply goes
// out, since "running low" is old news once it's run out.
function note(game, notes, tag, text, { heard = true, about = null } = {}) {
  const ship = game.ship;
  ship.log.push({ day: clockLabel(game), tag, text });
  if (ship.log.length > MAX_LOG) ship.log.splice(0, ship.log.length - MAX_LOG);
  // Someone who isn't with the ship doesn't hear about any of this, unless it's big enough to be news.
  if (!aboardShip(game)) return;
  notes.push(`[${tag}] ${text}`);
  if (!heard) return;
  if (about) ship.unheard = ship.unheard.filter((entry) => entry.about !== about);
  ship.unheard.push({ about, text });
}

// A shortage ended by buying something or by a story reward gets said now, not tomorrow.
function noteRestocked(game, id, notes) {
  if (game.ship.out[id] && !isOut(game, id)) {
    delete game.ship.out[id];
    delete game.ship.warned[id];
    note(game, notes, "SUPPLY", say(`${id}Back`), { about: id });
  }
}

// ---- A day aboard -------------------------------------------------

const moveToward = (value, target, step) => (value < target ? Math.min(target, value + step) : Math.max(target, value - step));

function payForDay(game, ledger) {
  const ship = game.ship;
  ship.owed ??= {};
  for (const id of STORES) {
    // Without the rooms' stores, the old counts drain as they did.
    if (!aboardCount(game, id)) {
      ship[id] = Math.max(0, round1((ship[id] ?? 0) + ledger.net[id]));
      continue;
    }
    // Food is eaten at the kettle through the day. Medicine and parts are used a little at a time, and a crate comes
    // out of the stores each time a whole one's been used up. With none left, nothing's used and nothing's owed: the
    // shortage shows instead, and the first crates to come aboard last their whole time.
    if (id === "food") continue;
    if (isOut(game, id)) {
      ship.owed[id] = 0;
      continue;
    }
    ship.owed[id] = round2((ship.owed[id] ?? 0) - ledger.net[id]);
    while (ship.owed[id] >= 1 && takeAboard(game, SHIP_ID, STORE_ITEMS[id][0], 1, FIRST[id])) ship.owed[id] = round2(ship.owed[id] - 1);
  }
  // The tank holds whole units, and the fractions wait here until they add up to one.
  ship.fuelBurn = round2(ship.fuelBurn + ledger.net.fuel);
  while (ship.fuelBurn <= -1 && ship.fuel > 0) {
    ship.fuel -= 1;
    ship.fuelBurn = round2(ship.fuelBurn + 1);
  }
  while (ship.fuelBurn >= 1) {
    ship.fuel = Math.min(ship.maxFuel, ship.fuel + 1);
    ship.fuelBurn = round2(ship.fuelBurn - 1);
  }
  if (ship.fuel === 0) ship.fuelBurn = Math.max(0, ship.fuelBurn);
}

function checkShortages(game, notes) {
  const ship = game.ship;
  const ledger = shipLedger(game);
  for (const id of SUPPLY_IDS) {
    if (isOut(game, id)) {
      ship.out[id] = (ship.out[id] ?? 0) + 1;
      if (ship.out[id] === 1) note(game, notes, "SUPPLY", sayTo(game, `${id}Out`), { about: id });
      else if (ship.out[id] % 5 === 0) note(game, notes, "SUPPLY", say(`${id}Still`, { days: ship.out[id] }), { about: id });
      continue;
    }
    noteRestocked(game, id, notes);
    const days = daysLeft(game, id, ledger);
    if (days !== null && days <= RULES.warnAtDays && !ship.warned[id]) {
      ship.warned[id] = true;
      note(game, notes, "SUPPLY", say(`${id}Low`, { days: Math.ceil(days) }), { about: id });
    } else if (days === null || days > RULES.warnAtDays + 3) {
      delete ship.warned[id];
    }
  }
}

// The hull only moves in whole points, so the day's wear and mending wait here until they add up to one.
function wearHull(game, ledger) {
  const ship = game.ship;
  ship.hullWear = round2(ship.hullWear + ledger.wear - ledger.mend);
  while (ship.hullWear >= 1) {
    ship.hull = Math.max(1, ship.hull - 1);
    ship.hullWear = round2(ship.hullWear - 1);
  }
  while (ship.hullWear <= -1) {
    ship.hull = Math.min(ship.maxHull, ship.hull + 1);
    ship.hullWear = round2(ship.hullWear + 1);
  }
  if (ship.hull >= ship.maxHull) ship.hullWear = Math.max(0, ship.hullWear);
  if (ship.hull <= 1) ship.hullWear = Math.min(0, ship.hullWear);
}

function countTheDead(game, notes) {
  const ship = game.ship;
  if (ship.health < RULES.deadlyHealth && ship.aboard > RULES.peopleFloor) {
    const dead = Math.min(ship.aboard - RULES.peopleFloor, Math.max(1, Math.round(ship.aboard * (RULES.deadlyHealth - ship.health) * 0.0004)));
    ship.aboard -= dead;
    ship.deaths += dead;
    // The day that's just ended, for the captain's and the doctor's duty.
    tallyDuty(game, SHIP_ID, ship.day - 1, { deaths: dead });
  }
  if (ship.deaths >= 5 && ship.day % 3 === 0) {
    note(game, notes, "SHIP", say("deaths", { dead: ship.deaths.toLocaleString("en-US") }));
    if (aboardShip(game)) notes.push(...changeStress(game, 2));
    ship.deaths = 0;
  }
}

export const shipGoingHungry = (game) => aboardShip(game) && Boolean(game.ship?.out?.food || game.ship?.rations === "half");

function feedThePlayer(game, notes) {
  if (!shipGoingHungry(game)) return;
  if (!game.conditions.some((c) => c.id === "underfed")) notes.push(`[HEALTH] Underfed: ${say("underfed")}`);
  addCondition(game, "underfed");
}

function runDay(game) {
  const ship = game.ship;
  const notes = [];
  const ledger = shipLedger(game);
  // Whoever found the kettle empty yesterday went without, and morale feels it by their share, through the same rule as
  // the food running out. The day that's just ended is the one before the day the ship's clock has got to.
  const meals = mealsOfDay(game, SHIP_ID, ship.day - 1);
  const hungry = meals && meals.missed > 0 ? meals.missed / (meals.served + meals.missed) : 0;
  ship.hungry = hungry > 0 ? (ship.hungry ?? 0) + 1 : 0;
  if (hungry > 0) {
    // With the food itself run out, the shortage rule already has morale; this is for a kettle nobody kept up.
    if (!ship.out.food) ledger.moraleTarget = clamp(ledger.moraleTarget + Math.round(hungry * (RULES.shortage.food?.morale ?? -25)), 5, 100);
    // Said when it starts, and every few days while it goes on, like the other shortages.
    if (ship.hungry === 1 || ship.hungry % 5 === 0) note(game, notes, "SHIP", `The kettle ran dry ${ship.hungry === 1 ? "yesterday" : `again yesterday, the ${ship.hungry}th day running`}: ${meals.missed.toLocaleString("en-US")} of ${(meals.served + meals.missed).toLocaleString("en-US")} sittings went unserved, and people are saying so.`);
  }
  payForDay(game, ledger);
  checkShortages(game, notes);
  // Things get worse faster than they get better, while something's actually run out, or half the ship's going hungry.
  const step = Object.keys(ship.out).length || hungry >= 0.5 ? 2 : 1;
  // People pick themselves up faster when they're being looked after and they've got a long way to climb.
  const climbing = !Object.keys(ship.out).length && ledger.moraleTarget - ship.morale >= RULES.climbFrom;
  ship.morale = clamp(moveToward(ship.morale, ledger.moraleTarget, climbing ? 2 : step), 0, 100);
  ship.health = clamp(moveToward(ship.health, ledger.healthTarget, step), 0, 100);
  wearHull(game, ledger);
  countTheDead(game, notes);
  feedThePlayer(game, notes);
  councilDay(game, notes);
  chairDay(game, notes);
  return notes;
}

// ---- Someone else in the chair ----------------------------------------------------

// What's running out, most urgent first.
function shipNeeds(game) {
  const ledger = shipLedger(game);
  // Whatever they're eating today, what counts is whether there's enough to feed people properly.
  const standard = shipLedger(game, { rations: "standard" });
  return SUPPLY_IDS.map((id) => ({ id, days: isOut(game, id) ? 0 : daysLeft(game, id, id === "food" ? standard : ledger) ?? Infinity })).sort((a, b) => a.days - b.days);
}

function chairBuys(game, chair, notes) {
  const ship = game.ship;
  const prices = mapSpot(ship.at)?.trade;
  if (!prices || ship.day - ship.chair.lastBuy < CHAIR.buyEvery) return;
  const bought = [];
  for (const { id } of shipNeeds(game)) {
    if (!prices[id]) continue;
    let lots = 0;
    while (lots < CHAIR.lotsAtOnce && !noneLeft(game, ship.at, id)) {
      const days = shipNeeds(game).find((need) => need.id === id).days;
      const price = Math.round(prices[id] * supplyFactor(game, ship.at, id) * SUPPLIES[id].lot);
      // A ship with fuel can go and get anything else, so nobody sails with less than this if they can help it.
      const wanted = id === "fuel" ? ship.fuel < CHAIR.fuelReserve || days < chair.stockTo : days < chair.stockTo;
      if (!wanted || ship.chair.funds < price || (id === "fuel" && ship.fuel >= ship.maxFuel) || roomFor(game, id) < SUPPLIES[id].lot) break;
      ship.chair.funds -= price;
      if (id === "fuel") ship.fuel = Math.min(ship.maxFuel, ship.fuel + SUPPLIES[id].lot);
      else stow(game, id, SUPPLIES[id].lot);
      tradedAt(game, ship.at, id);
      lots += 1;
    }
    if (lots) {
      bought.push(SUPPLIES[id].name.toLowerCase());
      noteRestocked(game, id, notes);
    }
  }
  if (!bought.length) return;
  ship.chair.lastBuy = ship.day;
  chairRecords(game, say("chairBought", { who: chair.name, what: bought.join(" and "), place: placeName(ship) }));
}

// The everyday decisions aren't news. They're in the log, and on the Ship menu for anyone who looks.
function chairRecords(game, text) {
  const { ship } = game;
  const council = councilOf(ship);
  ship.log.push({ day: clockLabel(game), tag: "SHIP", text });
  if (ship.log.length > MAX_LOG) ship.log.splice(0, ship.log.length - MAX_LOG);
  council.recent.push({ day: clockLabel(game), text });
  if (council.recent.length > 6) council.recent.shift();
}

// Where's best to go from here for what's needed most, without taking the ship anywhere this captain wouldn't.
function chairChooses(game, chair, needs) {
  const ship = game.ship;
  const worth = (spot, id) => (spot.trade?.[id] ? 6 : 0);
  let best = null;
  let bestScore = -Infinity;
  for (const id of CHAIR.ports) {
    const spot = mapSpot(id);
    if (!spot || id === ship.at || spot.danger > chair.risk) continue;
    const { fuel } = shipJumpCost(ship, id);
    if (fuel > ship.fuel) continue;
    const score = (needs[0] ? worth(spot, needs[0].id) : 5) + (needs[1] ? worth(spot, needs[1].id) / 2 : 0) - fuel * 2 - spot.danger + dice(ship);
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

function chairMoves(game, chair, notes) {
  const ship = game.ship;
  const here = mapSpot(ship.at);
  const servedHere = (id) => Boolean(here?.trade?.[id] && !noneLeft(game, ship.at, id));
  const lowOnFuel = ship.fuel <= CHAIR.fuelLow && !here?.trade?.fuel;
  const needs = shipNeeds(game).filter((need) => (need.days <= chair.moveAt || (need.id === "fuel" && lowOnFuel)) && !servedHere(need.id));
  if (lowOnFuel) needs.sort((a, b) => Number(b.id === "fuel") - Number(a.id === "fuel"));
  if (!needs.length) return;
  // Nobody jumps again straight away, unless something's about to run out altogether.
  if (ship.day - ship.chair.lastJump < chair.restDays && !needs.some((need) => need.days <= CHAIR.desperate)) return;
  const to = chairChooses(game, chair, needs);
  if (!to) return;
  const { fuel } = shipJumpCost(ship, to);
  // The last of the fuel isn't for running out of something else.
  if (ship.fuel - fuel < 1 && needs[0]?.id !== "fuel") return;
  const from = ship.at;
  const place = LOCATIONS[to]?.name ?? to;
  const wasHere = from && game.location === from;
  ship.fuel -= fuel;
  shipJumped(game, to);
  ship.chair.lastJump = ship.day;
  note(game, notes, "SHIP", say("chairJumped", { who: chair.name, place, why: TEXT.chairWhy[needs[0]?.id] ?? "" }));
  // It's news at both ends. Anyone who was standing on the dock watches her go, and anyone at the other end watches her come.
  tellNews(game, to, say("chairCame", { place }), []);
  if (wasHere) tellNews(game, from, say("chairLeft", { from: LOCATIONS[from]?.name ?? from, place }), notes);
}

function chairDay(game, notes) {
  const ship = game.ship;
  const chair = chairFile(game);
  if (!chair) return;
  ship.chair.funds += CHAIR.income;
  chairMoves(game, chair, notes);
  chairBuys(game, chair, notes);
}

// ---- The ship's own decisions ---------------------------------------------------

// The Meridian isn't nine hundred people waiting to be told. If something's gone wrong and stayed wrong, the
// officers and the council deal with it themselves, and say so. The captain can overrule any of it, and an order
// of the captain's own stands for a while before anyone would change it.
export function councilOf(ship) {
  ship.council ??= { off: false, ordered: {}, waiting: {}, last: {}, setRations: null, recent: [] };
  return ship.council;
}

function councilSees(game, ledger, council) {
  const { ship } = game;
  const left = (id) => (isOut(game, id) ? 0 : daysLeft(game, id, ledger) ?? Infinity);
  return {
    foodBelow: (n) => left("food") <= n,
    foodAbove: (n) => left("food") > n,
    foodAtStandard: (n) => {
      const { net } = shipLedger(game, { rations: "standard" });
      return net.food >= 0 || stockOf(game, "food") / -net.food > n;
    },
    medicineBelow: (n) => left("medicine") <= n,
    medicineAbove: (n) => left("medicine") > n,
    partsBelow: (n) => left("parts") <= n,
    partsAbove: (n) => left("parts") > n,
    fuelBelow: (n) => left("fuel") <= n,
    fuelAbove: (n) => left("fuel") > n,
    fuelAtLeast: (n) => ship.fuel >= n,
    moraleBelow: (n) => ship.morale < n,
    moraleAbove: (n) => ship.morale >= n,
    rations: (list) => list.includes(ship.rations),
    theirRations: () => council.setRations === ship.rations,
  };
}

// Whoever would do this, if they can: whoever holds the post it names. If nobody does, or they've been lost, the council
// does it instead. A decision can still name a person, as the old files did.
function whoDecides(game, decision) {
  if (decision.post) {
    const key = holderKey(game, SHIP_ID, decision.post);
    return key && key !== YOU && stillAlive(game, key) ? postAndName(game, SHIP_ID, decision.post) ?? COUNCIL.anyone : COUNCIL.anyone;
  }
  const person = decision.who ? findCharacter(game.campaign, decision.who) : null;
  const status = person && game.contacts?.find((contact) => contact.name.toLowerCase() === person.name.toLowerCase())?.status;
  return person && (!status || status === "alive") ? decision.name : COUNCIL.anyone;
}

function councilActs(game, decision, notes) {
  const { ship } = game;
  const council = councilOf(ship);
  const { rations } = decision.set;
  if (rations && RATIONS[rations]) {
    ship.rations = rations;
    council.setRations = rations;
  }
  const text = decision.text.replaceAll("{who}", whoDecides(game, decision));
  note(game, notes, "COUNCIL", text);
  council.last[decision.id] = ship.day;
  council.recent.push({ day: clockLabel(game), text });
  if (council.recent.length > 6) council.recent.shift();
}

function councilDay(game, notes) {
  const { ship } = game;
  const council = councilOf(ship);
  if (council.off || !COUNCIL) return;
  const sees = councilSees(game, shipLedger(game), council);
  let acted = false;
  for (const decision of COUNCIL.decisions) {
    const holds = Object.entries(decision.when).every(([test, value]) => sees[test]?.(value));
    if (!holds) {
      delete council.waiting[decision.id];
      continue;
    }
    council.waiting[decision.id] ??= ship.day;
    const waited = ship.day - council.waiting[decision.id] >= (decision.wait ?? COUNCIL.wait);
    const allowed = Object.keys(decision.set).every((setting) => ship.day - (council.ordered[setting] ?? -Infinity) >= COUNCIL.respect);
    const rested = ship.day - (council.last[decision.id] ?? -Infinity) >= (decision.every ?? 0);
    if (acted || !waited || !allowed || !rested) continue;
    councilActs(game, decision, notes);
    delete council.waiting[decision.id];
    // One decision a day. Whatever else is wrong will still be wrong tomorrow.
    acted = true;
  }
}

// Something in a story has touched the ship. The stories' files still speak of the fleet (fleet: morale -2), so
// the numbers that mean something aboard one ship are read, and the rest (pursuit, ships lost) are let go.
export function storyHitsShip(game, { morale = 0, food = 0, medicine = 0, parts = 0, fuel = 0 } = {}, notes = []) {
  const ship = shipOf(game);
  ship.morale = clamp(ship.morale + morale, 0, 100);
  // A story's food is in days' worth, which is crates by the ten in the rooms' stores; medicine and parts are crates.
  for (const [id, amount] of Object.entries({ food, medicine, parts })) {
    if (!amount) continue;
    const crates = Math.round(Math.abs(amount) * (id === "food" ? STORY_FOOD_CRATES : 1));
    if (amount > 0) stow(game, id, crates);
    else unstow(game, id, crates);
  }
  ship.fuel = clamp(ship.fuel + fuel, 0, ship.maxFuel);
  for (const id of SUPPLY_IDS) noteRestocked(game, id, notes);
}

// Called whenever the clock moves. Runs one day of the simulation for each midnight that's gone by.
export function advanceShip(game, today = Math.floor(game.clock.hours / 24)) {
  const ship = shipOf(game);
  const notes = [];
  while (ship.day < today) {
    ship.day += 1;
    notes.push(...runDay(game));
  }
  return notes;
}

// ---- Jumps --------------------------------------------------------------

const shipSpot = (ship) => mapSpot(ship.at) ?? STAR_MAP.start;

// Each row of the chart is about twice as tall as a column is wide.
function jumpBand(from, to) {
  const distance = Math.hypot(to.x - from.x, (to.y - from.y) * 2);
  return Object.values(STAR_MAP.jumps).find((entry) => distance <= entry.reach) ?? { fuel: 3, hours: 2, fare: 50 };
}

// What it takes the Meridian to get somewhere.
function shipJumpCost(ship, destination) {
  const to = mapSpot(destination);
  return to ? jumpBand(shipSpot(ship), to) : { fuel: 1, hours: 1 };
}

// What a place on someone else's ship costs. Nobody runs passage to some places at any price.
function passageCost(game, destination) {
  const ship = shipOf(game);
  const going = destination === SHIP_ID ? shipSpot(ship) : mapSpot(destination);
  const from = game.location === SHIP_ID ? shipSpot(ship) : mapSpot(game.location) ?? shipSpot(ship);
  const { hours: base, dangerFare } = STAR_MAP.passage;
  if (!going) return { fuel: 0, fare: STAR_MAP.jumps.long.fare, hours: Math.round(base * STAR_MAP.jumps.long.hours), jump: true };
  const band = jumpBand(from, going);
  const danger = destination === SHIP_ID ? 0 : going.danger ?? 0;
  return { fuel: 0, fare: Math.round(band.fare * (1 + danger * dangerFare)), hours: Math.round(base * band.hours), jump: true, none: Boolean(going.noPassage) };
}

// What it takes to get somewhere: a shuttle hop between the Meridian and the dock she's at, and otherwise a jump,
// or for anyone who isn't the captain, a passage.
export function jumpCost(game, destination) {
  const ship = shipOf(game);
  const shuttle = destination === SHIP_ID || (ship.at !== null && destination === ship.at);
  if (!isCaptain(game)) {
    return aboardShip(game) && shuttle ? { fuel: 0, fare: 0, hours: 1, jump: false } : passageCost(game, destination);
  }
  if (shuttle) return { fuel: 0, hours: 1, jump: false };
  const to = mapSpot(destination);
  const band = to ? shipJumpCost(ship, destination) : { fuel: 1, hours: 1 };
  // With the Meridian's navigation down, the jump's plotted by hand: a fuel more, and half as long again.
  const byHand = navigationDown(game);
  return { fuel: band.fuel + (byHand ? 1 : 0), hours: Math.round(jumpHours(game) * band.hours * (byHand ? 1.5 : 1)), jump: true, ...(byHand ? { byHand: true } : {}) };
}

// The Meridian has arrived somewhere new.
export function shipJumped(game, destination) {
  shipOf(game).at = LOCATIONS[destination] ? destination : null;
}

// ---- The player's decisions, all made here without the game master ------

function setRations(game, id) {
  const ship = shipOf(game);
  if (!RATIONS[id]) throw new Error("There's no such ration level.");
  if (ship.rations === id) return { message: null, notes: [] };
  ship.rations = id;
  councilOf(ship).ordered.rations = ship.day;
  councilOf(ship).setRations = null;
  const notes = [];
  const text = `Rations aboard are now ${RATIONS[id].name.toLowerCase()}.`;
  note(game, notes, "SHIP", text);
  return { message: text, notes };
}

function setCouncil(game, on) {
  const ship = shipOf(game);
  const council = councilOf(ship);
  if (council.off === !on) return { message: null, notes: [] };
  council.off = !on;
  council.waiting = {};
  const notes = [];
  const text = on ? COUNCIL.free : COUNCIL.held;
  note(game, notes, "COUNCIL", text);
  return { message: text, notes };
}

function wait(game, requested) {
  const days = clamp(Number.isInteger(requested) ? requested : 1, 1, 3);
  const notes = [];
  for (let waited = 0; waited < days; waited += 1) notes.push(...passTime(game, 24, "routine"));
  const message = sayTo(game, "wait", { days: plural(days, "day"), clock: clockLabel(game) });
  return { message, notes: [`[TIME] ${message}`, ...notes] };
}

function setCourse(game, id) {
  const place = LOCATIONS[id];
  if (!place) throw new Error("That place isn't on the chart.");
  const from = game.location;
  const cost = jumpCost(game, id);
  const jumped = cost.jump;
  if (!isCaptain(game) && from !== id) {
    if (cost.none) throw new Error(`Nobody runs a ship to ${place.name}.`);
    if (cost.fare > game.credits) throw new Error(`Passage to ${place.name} costs ${cost.fare} credits, and you have ${game.credits}.`);
    game.credits -= cost.fare;
  }
  const { message, notes } = travel(game, id);
  if (from !== game.location) {
    // The written story can have an arrival for this place, played when the player continues.
    game.arrived = game.location;
    if (isCaptain(game)) game.pendingEvents.push(jumped ? `On the captain's order, the Meridian jumped to ${place.name}.` : `The captain crossed over to ${place.name}.`);
    else game.pendingEvents.push(jumped ? `The player paid ${cost.fare} credits for passage to ${place.name}, on someone else's ship. They've just arrived, alone.` : `The player crossed over to ${place.name}.`);
  }
  return { message, notes: [`[NAV] ${message}`, ...notes], moved: from !== game.location };
}

function buySupply(game, id) {
  const ship = shipOf(game);
  const supply = SUPPLIES[id];
  const prices = mapSpot(ship.at)?.trade;
  if (!supply || !prices?.[id]) throw new Error("Nobody here is selling that to the ship.");
  if (noneLeft(game, ship.at, id)) throw new Error("Nobody here has any left to sell.");
  const price = buyPrice(game, { price: prices[id] * supplyFactor(game, ship.at, id) * supply.lot });
  if (game.credits < price) throw new Error("You can't afford that.");
  if (id === "fuel" && ship.fuel >= ship.maxFuel) throw new Error("The tank is full.");
  if (id !== "fuel" && roomFor(game, id) < supply.lot) throw new Error(`There's no room aboard for ${lotText(supply)} more of ${supply.name.toLowerCase()}: the stores that keep it are full.`);
  game.credits -= price;
  if (id === "fuel") ship.fuel = Math.min(ship.maxFuel, ship.fuel + supply.lot);
  else stow(game, id, supply.lot);
  tradedAt(game, ship.at, id);
  const notes = [];
  const amount = lotText(supply);
  const message = say("bought", { amount, supply: supply.name.toLowerCase(), price });
  note(game, notes, "SUPPLY", message);
  noteRestocked(game, id, notes);
  return { message, notes };
}

// Room aboard for more of a kind, what can be sold of it (crates, not baskets), and putting a lot in or taking one out:
// through the rooms' stores where there are any, and the old counts where there aren't.
function roomFor(game, id) {
  const counted = aboardCount(game, id);
  return counted ? counted.of - counted.n : Infinity;
}
function sellable(game, id) {
  const counted = id === "food" ? countAboard(game, SHIP_ID, ["ration_crate"]) : aboardCount(game, id);
  return counted ? counted.n : game.ship[id] ?? 0;
}
function stow(game, id, n) {
  if (!aboardCount(game, id)) {
    game.ship[id] = round1((game.ship[id] ?? 0) + n);
    return n;
  }
  return putAboard(game, SHIP_ID, STORE_ITEMS[id][0], n, FIRST[id]);
}
function unstow(game, id, n) {
  if (!aboardCount(game, id)) {
    const took = Math.min(n, game.ship[id] ?? 0);
    game.ship[id] = round1((game.ship[id] ?? 0) - took);
    return took;
  }
  return takeAboard(game, SHIP_ID, STORE_ITEMS[id][0], n, FIRST[id]);
}

// Where something's short, it can be worth more there than the ship needs it. It's the player's call.
function sellSupply(game, id) {
  const ship = shipOf(game);
  const supply = SUPPLIES[id];
  const prices = mapSpot(ship.at)?.trade;
  if (!supply || !prices?.[id]) throw new Error("Nobody here is buying that from the ship.");
  const amount = lotText(supply);
  if ((id === "fuel" ? ship.fuel : sellable(game, id)) < supply.lot) throw new Error(`The ship hasn't got ${amount} of ${supply.name.toLowerCase()} to sell.`);
  const price = sellPrice(game, { price: prices[id] * supplyFactor(game, ship.at, id) * supply.lot });
  game.credits += price;
  if (id === "fuel") ship.fuel -= supply.lot;
  else unstow(game, id, supply.lot);
  tradedAt(game, ship.at, id, true);
  const notes = [];
  const message = say("sold", { amount, supply: supply.name.toLowerCase(), price });
  note(game, notes, "SUPPLY", message);
  return { message, notes };
}

export function shipCommand(game, body) {
  shipOf(game);
  if (!isCaptain(game) && body.action !== "wait" && body.action !== "course") throw new Error(say("chairTook", { who: chairOf(game)?.name ?? "Someone else" }));
  switch (body.action) {
    case "rations": return setRations(game, body.id);
    case "council": return setCouncil(game, Boolean(body.on));
    case "wait": return wait(game, body.days);
    case "course": return setCourse(game, body.id);
    case "buy": return buySupply(game, body.id);
    case "sell": return sellSupply(game, body.id);
    default: throw new Error("Unknown order.");
  }
}

// ---- What the browser gets to see ---------------------------------------

function supplyRow(game, id, ledger) {
  const supply = SUPPLIES[id];
  const days = daysLeft(game, id, ledger);
  const out = isOut(game, id);
  return {
    id,
    name: supply.name,
    unit: supply.unit,
    stock: id === "fuel" ? game.ship.fuel : round1(stockOf(game, id)),
    max: capacityOf(game, id),
    made: round2(ledger.made[id]),
    used: round2(ledger.used[id]),
    net: round2(ledger.net[id]),
    days: days === null ? null : Math.floor(days),
    out,
    low: !out && days !== null && days <= RULES.warnAtDays,
  };
}

// The ship as the page sees her: her numbers, where she is, what's aboard and what's been decided.
export function shipView(game) {
  const ship = shipOf(game);
  const ledger = shipLedger(game);
  const spot = mapSpot(ship.at);
  return {
    name: ship.name,
    hull: ship.hull,
    maxHull: ship.maxHull,
    fuel: ship.fuel,
    maxFuel: ship.maxFuel,
    morale: ship.morale,
    at: ship.at,
    atName: placeName(ship),
    atText: ship.at ? `at ${placeName(ship)}` : `in ${STAR_MAP.openSpace.toLowerCase()}`,
    start: { x: STAR_MAP.start.x, y: STAR_MAP.start.y },
    chart: { cols: STAR_MAP.cols, rows: STAR_MAP.rows, levels: STAR_MAP.dangerLevels },
    aboard: ship.aboard,
    health: ship.health,
    healthTarget: ledger.healthTarget,
    moraleTarget: ledger.moraleTarget,
    chair: chairOf(game)?.name ?? null,
    rations: Object.entries(RATIONS).map(([id, rations]) => {
      const next = shipLedger(game, { rations: id });
      return { id, name: rations.name, desc: rations.desc, current: ship.rations === id, foodUsed: round2(next.used.food), moraleTarget: next.moraleTarget, healthTarget: next.healthTarget };
    }),
    supplies: SUPPLY_IDS.map((id) => supplyRow(game, id, ledger)),
    // The stores in her rooms, from world/logistics: each a thing the player can open, with what's in it now.
    stores: storesView(game, SHIP_ID),
    machines: machinesView(game, SHIP_ID),
    meals: mealsView(game, SHIP_ID),
    errands: errandsView(game, SHIP_ID),
    refills: refillsView(game, SHIP_ID),
    repairs: repairsView(game, SHIP_ID),
    shortages: SUPPLY_IDS.filter((id) => isOut(game, id) || (daysLeft(game, id, ledger) ?? Infinity) <= RULES.warnAtDays),
    trade: Object.entries(spot?.trade ?? {}).map(([id, each]) => {
      const supply = SUPPLIES[id];
      const worth = each * supplyFactor(game, ship.at, id) * supply.lot;
      const level = game.world?.places[ship.at]?.goods[id];
      return {
        id,
        name: supply.name,
        amount: lotText(supply),
        price: buyPrice(game, { price: worth }),
        sellFor: sellPrice(game, { price: worth }),
        level: level === undefined ? null : levelName(level),
        none: noneLeft(game, ship.at, id),
        spare: (id === "fuel" ? ship.fuel : ship[id]) >= supply.lot,
        full: id === "fuel" && ship.fuel >= ship.maxFuel,
      };
    }),
    log: [...ship.log].reverse().slice(0, 14),
    council: { off: Boolean(ship.council?.off), recent: [...(ship.council?.recent ?? [])].reverse() },
  };
}

// What the star map shows about a place the player knows of.
export function chartEntry(game, id) {
  const ship = shipOf(game);
  const place = LOCATIONS[id];
  const spot = mapSpot(id);
  const cost = jumpCost(game, id);
  let why = null;
  if (isCaptain(game)) {
    if (cost.fuel > 0 && ship.fuel < cost.fuel) why = `Needs ${cost.fuel} fuel, and the Meridian has ${ship.fuel}.`;
  } else if (cost.none) why = "Nobody runs a ship there.";
  else if (cost.fare > game.credits) why = `Passage costs ${cost.fare} credits, and you have ${game.credits}.`;
  const controller = FACTIONS[place.faction]?.name;
  const usualDanger = id === SHIP_ID ? 0 : spot?.danger ?? (place.dangerous ? 3 : 1);
  // Trouble at a place makes it one step more dangerous for as long as it lasts.
  const danger = Math.min(STAR_MAP.dangerLevels.length - 1, usualDanger + (inTrouble(game, id) ? 1 : 0));
  const now = placeNow(game, id);
  return {
    short: spot?.short ?? place.name,
    x: spot?.x ?? null,
    y: spot?.y ?? null,
    hours: cost.hours,
    fuel: cost.fuel,
    fare: cost.fare ?? 0,
    jump: cost.jump,
    shipIsHere: id === ship.at,
    danger,
    dangerLabel: STAR_MAP.dangerLevels[danger],
    control: now?.changed ? now.holder : spot?.control ?? controller ?? now?.holder ?? "Nobody in particular",
    now,
    sells: Object.keys(spot?.trade ?? {}),
    canGo: !why,
    why,
  };
}

// ---- What the game master gets ------------------------------------------

function dayCount(game, id, ledger) {
  if (isOut(game, id)) return "OUT";
  const days = daysLeft(game, id, ledger);
  return days === null ? "steady" : `${Math.floor(days)}d`;
}

// One compact line in the state block. It's rounded, so that it doesn't change on every turn.
export function shipLine(game) {
  const ship = shipOf(game);
  const ledger = shipLedger(game);
  const supplies = SUPPLY_IDS.map((id) => `${id} ${dayCount(game, id, ledger)}`).join(", ");
  const chair = chairOf(game);
  if (chair && !aboardShip(game)) return `The Meridian, under ${chair.name}, isn't the player's to command, and they only know what's got around: last heard of at ${placeName(ship)}.`;
  return `${chair ? `The Meridian, under ${chair.name}, isn't the player's to command: ` : "Aboard: "}${ship.aboard.toLocaleString("en-US")} people, health ${ship.health}/100, at ${placeName(ship)}. Left: ${supplies}. Rations ${RATIONS[ship.rations].name.toLowerCase()}.`;
}

// What's happened since the game master last heard. It goes out once, with the next message.
export function shipReport(game) {
  const ship = game.ship;
  if (!ship?.unheard?.length) return null;
  const lines = ship.unheard.splice(0);
  const shown = lines.slice(-MAX_REPORT_LINES);
  const older = lines.length - shown.length;
  return `<ship_report>Happened aboard the Meridian by itself since your last message${older ? `, among ${older} smaller things` : ""}: ${shown.map((entry) => entry.text).join(" ")} Bring what matters into the story as the serious thing it is.</ship_report>`;
}

export function markShipHeard(game) {
  if (game.ship) game.ship.unheard = [];
}

// Someone's taken the chair, or lost it, in the story. It takes both sides to mean it, so this comes from the game master.
export function changeCommand(game, { takes, reason }) {
  const ship = shipOf(game);
  game.role ??= { id: "captain", captain: true };
  if (takes) {
    if (isCaptain(game)) return { summary: "They already have command." };
    if (!aboardShip(game)) throw new Error("They have to be aboard the Meridian, or on the dock she's at, to take command of her. Use travel first.");
    const was = chairOf(game);
    game.role.captain = true;
    ship.chair = null;
    if (captainPost()) setHolder(game, SHIP_ID, captainPost(), YOU);
    return { summary: `They're the captain now. ${was ? `${was.name} isn't, and the rations, the buying and the jumps are all the player's to answer.` : ""}`, notice: `[SHIP] You have command of the Meridian: ${reason}`, notes: [] };
  }
  if (!isCaptain(game)) return { summary: "They aren't in command anyway." };
  game.role.captain = false;
  ship.chair = newChair(game);
  if (captainPost()) setHolder(game, SHIP_ID, captainPost(), ship.chair.id);
  const chair = chairOf(game);
  return { summary: `They aren't the captain any more. ${chair.name} (id ${chair.id}) is, and you play them. The ship goes on by itself from here, and the player goes where they like.`, notice: `[SHIP] ${chair.name} has command of the Meridian now: ${reason}`, notes: [] };
}

// Lets a test, or the checker, see the names a stage's fleet line may carry that the ship no longer reads.
export const SHIP_EFFECT_KEYS = ["morale", "food", "medicine", "parts", "fuel"];
