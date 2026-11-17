// The Meridian on her own: where she is, what's aboard her (food, medicine and parts, and the fuel in her tank),
// how her people are holding up, the rations, who captains her when the player doesn't, and the star map's
// jumps. Everything here runs on this computer.
//
// world/ship.json has the numbers and the words, and world/starmap.json has the chart. shipLedger is the one
// place that works out a day's numbers, so anything that should change them later belongs there. The fleet the
// Meridian once led is a thing of the past: there are no other ships here.

import { findCharacter } from "./campaign.js";
import { LOCATIONS, FACTIONS } from "./data.js";
import { inTrouble, leftToSell, levelName, noneLeft, placeNow, supplyFactor, tellNews, tradedAt } from "./daily.js";
import { aboardShip, isCaptain } from "./role.js";
import { addCondition, buyPrice, changeStress, clamp, clockLabel, jumpHours, passTime, sellPrice, travel } from "./rules.js";
import { navigationDown } from "./systems.js";
import { YOU, commandOf, councilRefuses, holderKey, officerName, officerNames, postAndName, riskyJump, setHolder, stillAlive, tallyDuty } from "./command.js";
import { dosesADay, medbayDoses, medbayOf, medbayView } from "./medbay.js";
import { illnessPenalty, registerStarves } from "./register.js";
import { illnessKinds } from "./body.js";
import { workshopView } from "./workshop.js";
import { countAboard, foodADay, grownGuess, grownSoFar, machinesView, mealsOfDay, mealsView, powerSupply, putAboard, refilledADay, refillsView, repairsView, storesView, takeAboard, usedFrom, worthAboard } from "./logistics.js";
import { addToPurse, cellsOf, dockSends, payAt, purseOf, slateWords, tradeRules, tradeView, unitPrice } from "./trade.js";
import { portTake, portsModel } from "./ports.js";
import { worthOf } from "./worth.js";
import { SHIP_DATA, STAR_MAP } from "./world.js";
import { boardView, workView } from "./work.js";
import { notePut } from "./puts.js";

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
// What's aboard of a supply, and how much the stores hold of it: the items above, counted one each, and anything
// else that's worth some of it in the store it's used from, for its share of a crate (src/worth.js). A medkit in the
// medicine cabinet is four doses, a fifth of a crate; a tin in the pantry is one sitting, a two-hundredth of one.
function aboardCount(game, id) {
  if (id === "fuel") return null;
  const counted = countAboard(game, SHIP_ID, STORE_ITEMS[id]);
  const unit = counted ? worthOf(STORE_ITEMS[id][0], id) : 0;
  if (!unit) return counted;
  const from = id === "medicine" ? [medbayOf(SHIP_ID)?.medicine?.store].filter(Boolean) : usedFrom(SHIP_ID, id);
  const extra = worthAboard(game, SHIP_ID, id, from, STORE_ITEMS[id]) / unit;
  return extra ? { n: Math.round((counted.n + extra) * 100) / 100, of: counted.of } : counted;
}
const MAX_LOG = 40;

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
    log: [],
    // When each store was last restocked at a dock (src/trade.js).
    restocked: {},
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
// Someone aboard who's taken the chair runs her the way the file's anyone says, under their post's name.
const chairFile = (game) => {
  const key = chairKey(game);
  if (!key) return null;
  return CHAIR.captains[key] ?? (CHAIR.anyone ? { ...CHAIR.anyone, name: officerName(game, SHIP_ID, captainPost()) } : null);
};

export function chairOf(game) {
  const file = chairFile(game);
  return file ? { id: chairKey(game), name: file.name } : null;
}

// Places on every captain's chart from the start, so the star map isn't empty on day one.
export const isCharted = (id) => Boolean(STAR_MAP.places[id]?.charted);

const mapSpot = (id) => (id ? STAR_MAP.places[id] ?? null : null);
const placeName = (ship) => LOCATIONS[ship.at]?.name ?? STAR_MAP.openSpace;

// ---- A day's numbers ----------------------------------------------------

// The medicine the medbay's been getting through, in crates a day: what it used over the last week, or, with no week
// behind it yet, what the register's serious cases would take.
function medicineADay(game) {
  const perCrate = medbayOf(SHIP_ID)?.medicine?.doses ?? 20;
  const used = dosesADay(game, SHIP_ID);
  if (used > 0) return used / perCrate;
  const alive = game.register ? game.register.size - Object.keys(game.register.dead).length : game.ship?.aboard ?? 0;
  return (alive * illnessKinds().filter((kind) => kind.serious && kind.dosed !== null).reduce((sum, kind) => sum + kind.catches, 0)) / perCrate;
}

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
  used.medicine = medbayDoses(SHIP_ID) && aboardCount(game, "medicine") ? medicineADay(game) : people * SUPPLIES.medicine.perPerson * (1 + (100 - ship.health) / 100);
  for (const [id, amount] of Object.entries(SHIP.uses ?? {})) used[id] += amount;
  for (const [id, amount] of Object.entries(SHIP.produces ?? {})) made[id] += amount;
  // What a refill from nothing brings counts as made, up to what's used, and so does what the garden grows.
  for (const id of STORES) if (aboardCount(game, id)) made[id] += Math.min(used[id], refilledADay(game, SHIP_ID, STORE_ITEMS[id]) + (id === "food" ? grownADay(game) : 0));
  // What the dock she's at sends for the rest is bought, not made: while it keeps up, a store is holding, and nobody
  // counts the days it has left. The purse pays for it.
  // (Left out when someone's asking how long she'd last away from it: change.dock false.)
  const bought = Object.fromEntries(SUPPLY_IDS.map((id) => [id, 0]));
  for (const id of STORES) if (change.dock !== false && aboardCount(game, id)) bought[id] = Math.min(Math.max(0, used[id] - made[id]), STORE_ITEMS[id].reduce((sum, item) => sum + dockSends(game, item), 0));
  const net = Object.fromEntries(SUPPLY_IDS.map((id) => [id, made[id] + bought[id] - used[id]]));
  let moraleTarget = rations.morale;
  let healthTarget = rations.health - illnessPenalty(game);
  for (const id of shortages) {
    moraleTarget += RULES.shortage[id]?.morale ?? 0;
    healthTarget += RULES.shortage[id]?.health ?? 0;
  }
  return {
    people,
    made,
    bought,
    used,
    net,
    moraleTarget: clamp(moraleTarget, 5, 100),
    healthTarget: clamp(healthTarget, 5, 100),
    // With parts aboard the engineers keep the hull up, and mend it a little. Without them, she wears.
    wear: ship.out.parts ? RULES.wearNoParts : 0,
    mend: ship.out.parts ? 0 : RULES.mend,
  };
}

// What the garden's been picking in a day, in crates of food: over the last few days where they've been watched, and
// before that a guess from how fast its beds grow.
function grownADay(game) {
  const seen = game.ship?.grown ?? [];
  return seen.length >= 2 ? Math.max(0, (seen.at(-1) - seen[0]) / (seen.length - 1)) : grownGuess(SHIP_ID);
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

// A line for the story and the Ship menu.
function note(game, notes, tag, text) {
  const ship = game.ship;
  ship.log.push({ day: clockLabel(game), tag, text });
  if (ship.log.length > MAX_LOG) ship.log.splice(0, ship.log.length - MAX_LOG);
  // Someone who isn't with the ship doesn't hear about any of this, unless it's big enough to be news.
  if (!aboardShip(game)) return;
  notes.push(`[${tag}] ${text}`);
}
// The same from outside these rules: a jump ordered from her chart by someone who isn't in the chair (src/charts.js).
export function logForShip(game, tag, text) {
  const notes = [];
  note(game, notes, tag, text);
  return notes;
}

// A shortage ended by buying something or by a story reward gets said now, not tomorrow.
function noteRestocked(game, id, notes) {
  if (game.ship.out[id] && !isOut(game, id)) {
    delete game.ship.out[id];
    delete game.ship.warned[id];
    note(game, notes, "SUPPLY", say(`${id}Back`, officerNames(game, SHIP_ID)), { about: id });
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
    // The medbay takes medicine a dose at a time from its cabinet, so there's no daily crate of the ship's own.
    if (id === "medicine" && medbayDoses(SHIP_ID)) continue;
    if (isOut(game, id)) {
      ship.owed[id] = 0;
      continue;
    }
    ship.owed[id] = round2((ship.owed[id] ?? 0) - ledger.net[id]);
    while (ship.owed[id] >= 1 && takeAboard(game, SHIP_ID, STORE_ITEMS[id][0], 1, FIRST[id])) ship.owed[id] = round2(ship.owed[id] - 1);
    // With no whole crate to take, only odds and ends that are worth a little, nothing more is owed either.
    if (ship.owed[id] >= 1) ship.owed[id] = 0;
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
      note(game, notes, "SUPPLY", say(`${id}Low`, { days: Math.ceil(days), ...officerNames(game, SHIP_ID) }), { about: id });
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
    // With the register, they're people with names (src/register.js), who count themselves off.
    const named = game.register ? registerStarves(game, dead, ship.day - 1) : 0;
    ship.aboard -= dead - named;
    ship.deaths += dead;
    // The day that's just ended, for the captain's and the doctor's duty.
    if (dead - named) tallyDuty(game, SHIP_ID, ship.day - 1, { deaths: dead - named });
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
  // What the beds have grown, a mark a day for the last few, so the ledger knows what the garden's worth.
  if (aboardCount(game, "food")) ship.grown = [...(ship.grown ?? []).slice(-3), Math.round(grownSoFar(game, SHIP_ID) * 100) / 100];
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
  distressDay(game, notes);
  return notes;
}

// ---- Someone else in the chair ----------------------------------------------------

// What's running out, most urgent first.
function shipNeeds(game, { cells: withCells = true, dock = true } = {}) {
  const ledger = shipLedger(game, { dock });
  // Whatever they're eating today, what counts is whether there's enough to feed people properly.
  const standard = shipLedger(game, { rations: "standard", dock });
  // Fuel is the tank and the generator's cells: with either gone she's going nowhere, and a port that sells one sells
  // the other.
  const cells = withCells ? cellsOf(game) : null;
  const cellDays = cells && !cells.holding ? cells.n / cells.aDay : Infinity;
  return SUPPLY_IDS.map((id) => ({ id, days: isOut(game, id) ? 0 : Math.min(daysLeft(game, id, id === "food" ? standard : ledger) ?? Infinity, id === "fuel" ? cellDays : Infinity) })).sort((a, b) => a.days - b.days);
}

function chairBuys(game, chair, notes) {
  const ship = game.ship;
  const prices = mapSpot(ship.at)?.trade;
  if (!prices) return;
  // What's bought by the lot is judged by itself, and by what's aboard: the tank by the tank, and the food by how
  // long it would last away from this dock. The dock sees to the generator's cells.
  const byTheLot = { cells: false, dock: false };
  // Nobody shops every day, but nobody waits to buy what's run out altogether, either.
  const runOut = shipNeeds(game, byTheLot).some((need) => need.days === 0 && prices[need.id]);
  if (ship.day - ship.chair.lastBuy < CHAIR.buyEvery && !runOut) return;
  const keep = CHAIR.keep ?? {};
  const bought = [];
  for (const { id } of shipNeeds(game, byTheLot)) {
    if (!prices[id]) continue;
    let lots = 0;
    while (lots < CHAIR.lotsAtOnce) {
      const days = shipNeeds(game, byTheLot).find((need) => need.id === id).days;
      // A lot, or the last of what the port has, or what there's room for.
      const n = Math.max(0, Math.min(leftToSell(game, ship.at, id), SUPPLIES[id].lot, id === "fuel" ? ship.maxFuel - ship.fuel : Math.floor(roomFor(game, id) + 1e-6)));
      const price = Math.round(prices[id] * supplyFactor(game, ship.at, id) * n);
      // A ship with fuel can go and get anything else, so nobody sails with less than this if they can help it.
      // A few crates of what goes in lumps are kept whatever the days say: one crate of medicine lasts months of
      // everyday use, and a fever or a bad week can take three at once.
      // Where fuel is dear nobody fills the tank past what they'd never sail without.
      const wanted = id === "fuel" ? ship.fuel < CHAIR.fuelReserve || (days < chair.stockTo && dearness(game, ship.at, id) <= 1) : days < chair.stockTo || stockOf(game, id) < (keep[id] ?? 0);
      if (!wanted || n < 1 || ship.chair.funds < price) break;
      // Only what came aboard is paid for.
      const got = id === "fuel" ? n : stow(game, id, n);
      if (got < 1) break;
      if (id === "fuel") ship.fuel = Math.min(ship.maxFuel, ship.fuel + n);
      ship.chair.funds -= got < n ? Math.round(prices[id] * supplyFactor(game, ship.at, id) * got) : price;
      tradedAt(game, ship.at, id, false, got);
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
// What the ports a chair's captain goes to usually ask for a supply, and how dear one of them is for it today beside
// that: 1 is the usual, more is dearer. She pays for everything she lives on, so a careful captain looks.
const usualPrice = (id) => {
  const all = CHAIR.ports.map((port) => mapSpot(port)?.trade?.[id]).filter(Boolean);
  return all.length ? all.reduce((sum, each) => sum + each, 0) / all.length : null;
};
function dearness(game, port, id) {
  const each = mapSpot(port)?.trade?.[id];
  const usual = usualPrice(id);
  return each && usual ? (each * supplyFactor(game, port, id)) / usual : 1;
}
// How good a port is to lie at: it sells the fuel her generator and her tank want, and the food the garden doesn't
// grow, and the cheaper the better.
const LIVES_ON = ["fuel", "food"];
const living = (game, port) => LIVES_ON.reduce((sum, id) => sum + (mapSpot(port)?.trade?.[id] ? 1.5 - 3 * (dearness(game, port, id) - 1) : 0), 0);

function chairChooses(game, chair, needs) {
  const ship = game.ship;
  // Somewhere that sells what she's short of, and for money, somewhere she can live for less.
  const worth = (spot, id) => (id === "money" ? 0 : spot.trade?.[id] ? 6 : 0);
  let best = null;
  let bestScore = -Infinity;
  for (const id of CHAIR.ports) {
    const spot = mapSpot(id);
    if (!spot || id === ship.at || spot.danger > chair.risk) continue;
    const { fuel } = shipJumpCost(ship, id);
    if (fuel > ship.fuel) continue;
    const score = (needs[0] ? worth(spot, needs[0].id) : 5) + (needs[1] ? worth(spot, needs[1].id) / 2 : 0) + living(game, id) - fuel * 2 - spot.danger + dice(ship);
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
  // A port where a day costs more than comes in is left before the money's gone, for one where she can live for less.
  const cost = here ? moneyView(game, shipLedger(game))?.cost ?? 0 : 0;
  if (cost > CHAIR.income) {
    const days = Math.max(0, ship.chair.funds) / (cost - CHAIR.income);
    if (days <= chair.moveAt && CHAIR.ports.some((id) => id !== ship.at && living(game, id) > living(game, ship.at))) needs.push({ id: "money", days: Math.max(days, CHAIR.desperate + 1) });
  }
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

// What a jump costs the Meridian herself, whoever gives the order. The chart on her bridge shows this to anyone who
// gets into it (src/charts.js).
export function shipsJumpCost(game, destination) {
  const band = mapSpot(destination) ? shipJumpCost(shipOf(game), destination) : { fuel: 1, hours: 1 };
  // With the Meridian's navigation down, the jump's plotted by hand: a fuel more, and half as long again.
  const byHand = navigationDown(game);
  return { fuel: band.fuel + (byHand ? 1 : 0), hours: Math.round(jumpHours(game) * band.hours * (byHand ? 1.5 : 1)), jump: true, ...(byHand ? { byHand: true } : {}) };
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
  return shipsJumpCost(game, destination);
}

// The Meridian has arrived somewhere new.
export function shipJumped(game, destination) {
  shipOf(game).at = LOCATIONS[destination] ? destination : null;
}

// ---- The player's decisions -------------------------------------------

function setRations(game, id) {
  const ship = shipOf(game);
  if (!RATIONS[id]) throw new Error("There's no such ration level.");
  if (ship.rations === id) return { message: null, notes: [] };
  // While orders are going astray, the council won't put a cut through for the captain.
  const refused = councilRefuses(game);
  if (refused && RATIONS[id].food < (RATIONS[ship.rations]?.food ?? 1)) throw new Error(refused);
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
  // A captain's jump somewhere risky costs the officers' loyalty, the more the riskier.
  const danger = isCaptain(game) && jumped ? chartEntry(game, id).danger : 0;
  const { message, notes } = travel(game, id);
  if (danger >= 2 && from !== game.location) riskyJump(game, danger);
  if (from !== game.location) {
    // The written story can have an arrival for this place, or a part waiting for it, played when the player continues.
    game.arrived = game.location;
  }
  return { message, notes: [`[NAV] ${message}`, ...notes], moved: from !== game.location };
}

function buySupply(game, id) {
  const ship = shipOf(game);
  const supply = SUPPLIES[id];
  const prices = mapSpot(ship.at)?.trade;
  if (!supply || !prices?.[id]) throw new Error("Nobody here is selling that to the ship.");
  const offer = buyOffer(game, id);
  if (offer.none) throw new Error("Nobody here has any left to sell.");
  if (id === "fuel" && ship.fuel >= ship.maxFuel) throw new Error("The tank is full.");
  if (offer.n < 1) throw new Error(`There's no room aboard for more ${supply.name.toLowerCase()}: the stores that keep it are full.`);
  // The ship's purse pays for the ship, and what it can't cover goes on the slate here, while the port gives credit.
  if (!payAt(game, ship.at, offer.price, { dry: true })) throw new Error(`The ship's purse holds ${Math.floor(purseOf(game))} credits, and ${placeName(ship)} won't put any more on the slate.`);
  // What the player buys counts toward anything someone's asked them to bring (src/requests.js).
  let got = offer.n;
  if (id === "fuel") {
    const before = ship.fuel;
    ship.fuel = Math.min(ship.maxFuel, ship.fuel + offer.n);
    notePut(game, "tank", "fuel", ship.fuel - before);
  } else {
    got = stow(game, id, offer.n, (store, n) => {
      notePut(game, store.key, STORE_ITEMS[id][0], n);
      notePut(game, "aboard", STORE_ITEMS[id][0], n);
    });
  }
  if (got < 1) throw new Error(`There's no room aboard for more ${supply.name.toLowerCase()}: the stores that keep it are full.`);
  // Only what came aboard is paid for, and only that has left the port.
  if (got < offer.n) offer.price = buyPrice(game, { price: (mapSpot(ship.at).trade[id] ?? 0) * supplyFactor(game, ship.at, id) * got });
  offer.n = got;
  const paid = payAt(game, ship.at, offer.price);
  tradedAt(game, ship.at, id, false, offer.n);
  const notes = [];
  const message = `${say("bought", { amount: amountText(supply, offer.n), supply: supply.name.toLowerCase(), price: offer.price })}${paid.slate ? ` The purse couldn't cover it: ${paid.slate} credits are owed. ${paid.first ? slateWords(game, ship.at) : `The slate at ${placeName(ship)} has grown.`}` : ""}`;
  note(game, notes, "SUPPLY", message);
  noteRestocked(game, id, notes);
  return { message, notes };
}

// "5 crates", "the last 3 crates", "1": so many of a supply, in its own words.
const amountText = (supply, n) => (n === supply.lot ? lotText(supply) : supply.unit ? `${n} ${n === 1 ? supply.unit.replace(/s$/, "") : supply.unit}` : String(n));
// What the dock will sell the ship of a supply in one go, and for how much: a lot, or the last of what the port has
// when it's down to fewer, or what there's room for aboard.
function buyOffer(game, id) {
  const ship = game.ship;
  const supply = SUPPLIES[id];
  const there = leftToSell(game, ship.at, id);
  const room = id === "fuel" ? ship.maxFuel - ship.fuel : Math.floor(roomFor(game, id) + 1e-6);
  const n = Math.max(0, Math.min(there, supply.lot, room));
  const each = mapSpot(ship.at)?.trade?.[id] ?? 0;
  return { n, none: there < 1, last: there >= 1 && there < supply.lot, price: n ? buyPrice(game, { price: each * supplyFactor(game, ship.at, id) * n }) : 0 };
}

// Room aboard for more of a kind, what can be sold of it (crates, not baskets), and putting a lot in or taking one out:
// through the rooms' stores where there are any, and the old counts where there aren't.
// Room aboard for more of a supply as it's bought: room for its crates, in the stores that keep them. The baskets the
// garden's bins have room for aren't room for a ration crate.
function roomFor(game, id) {
  if (!aboardCount(game, id)) return Infinity;
  const counted = countAboard(game, SHIP_ID, [STORE_ITEMS[id][0]]);
  return counted ? counted.of - counted.n : Infinity;
}
function sellable(game, id) {
  // Whole crates only: what's worth a little of a supply counts toward it, and isn't sold by the lot.
  const counted = countAboard(game, SHIP_ID, id === "food" ? ["ration_crate"] : STORE_ITEMS[id]);
  return counted ? counted.n : game.ship[id] ?? 0;
}
function stow(game, id, n, onPut = null) {
  if (!aboardCount(game, id)) {
    game.ship[id] = round1((game.ship[id] ?? 0) + n);
    return n;
  }
  return putAboard(game, SHIP_ID, STORE_ITEMS[id][0], n, FIRST[id], onPut);
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
  // What the ship sells is the ship's: it goes into her purse.
  addToPurse(game, price);
  if (id === "fuel") ship.fuel -= supply.lot;
  else unstow(game, id, supply.lot);
  tradedAt(game, ship.at, id, true);
  const notes = [];
  const message = say("sold", { amount, supply: supply.name.toLowerCase(), price });
  note(game, notes, "SUPPLY", message);
  return { message, notes };
}

// The captain's own credits put into the ship's purse: a way to keep her going when the levy doesn't.
function payIntoPurse(game, requested) {
  const n = Math.floor(Number(requested));
  if (!(n > 0)) throw new Error("How many credits?");
  if ((game.credits ?? 0) < n) throw new Error(`You have ${game.credits ?? 0} credits of your own.`);
  game.credits -= n;
  addToPurse(game, n);
  const notes = [];
  const message = `You put ${n} of your own credits into the ship's purse. It holds ${Math.floor(purseOf(game))}.`;
  note(game, notes, "SHIP", message);
  return { message, notes };
}

// ---- A ship that can't get to any port ---------------------------------------------------------------------

// The fewest fuel a jump to anywhere on the chart would take from where she is.
function shortestJump(game) {
  const ship = game.ship;
  const byHand = navigationDown(game) ? 1 : 0;
  const costs = Object.keys(STAR_MAP.places).filter((id) => id !== ship.at && isCharted(id) && LOCATIONS[id]).map((id) => shipJumpCost(ship, id).fuel + byHand);
  return costs.length ? Math.min(...costs) : Infinity;
}
// Why she can't get herself to a port, or nothing if she can: no fuel in the tank for even the shortest jump, or no
// fuel cells left for the generator her engines run on. At a port that sells fuel she isn't stranded: she buys it
// there, on the slate if she has to.
function strandedWhy(game) {
  const ship = game.ship;
  if (!ship) return null;
  // Where fuel's sold and there's some to sell, the purse or the slate gets it, and her cells with it.
  if (mapSpot(ship.at)?.trade?.fuel && !noneLeft(game, ship.at, "fuel")) return null;
  if (ship.fuel < shortestJump(game)) return "fuel";
  const cells = cellsOf(game);
  if (cells && cells.n <= 0 && (powerSupply(game, SHIP_ID) ?? 1) <= 0) return "power";
  return null;
}
// The nearest port on the chart that sells fuel and has some: where an answer to a distress call comes from.
function nearestFuel(game) {
  const here = shipSpot(game.ship);
  const far = (id) => Math.hypot(mapSpot(id).x - here.x, (mapSpot(id).y - here.y) * 2);
  const sellers = Object.keys(STAR_MAP.places).filter((id) => id !== game.ship.at && isCharted(id) && LOCATIONS[id] && mapSpot(id)?.trade?.fuel).sort((a, b) => far(a) - far(b));
  return sellers.find((id) => !noneLeft(game, id, "fuel")) ?? sellers[0] ?? null;
}
function strandedView(game) {
  const rules = tradeRules()?.["a distress call"];
  const ship = game.ship;
  if (!rules || !ship) return null;
  const why = strandedWhy(game);
  const sent = ship.distress ?? null;
  if (!why && !sent) return null;
  const from = nearestFuel(game);
  return {
    why,
    words: why === "fuel" ? "There isn't the fuel in her tank for even the shortest jump." : why === "power" ? "Her generator has burned its last fuel cell, and her engines won't run without power." : null,
    sent: Boolean(sent),
    due: sent ? Math.max(0, Math.ceil((sent.due - game.clock.hours) / 24)) : null,
    days: rules.days,
    times: rules.times,
    from: from ? LOCATIONS[from].name : null,
  };
}
function callForHelp(game) {
  const ship = shipOf(game);
  const rules = tradeRules()?.["a distress call"];
  if (!rules) throw new Error("There's nobody to call.");
  if (ship.distress) throw new Error("The call's already out. Someone's on their way.");
  if (!strandedWhy(game)) throw new Error("She can still get herself to a port. Nobody answers a call from a ship that can.");
  ship.distress = { sent: game.clock.hours, due: game.clock.hours + rules.days * 24 };
  const notes = [];
  const message = `The distress call is out. Someone should answer in about ${plural(rules.days, "day")}, and they'll charge ${rules.times === 2 ? "twice" : `${rules.times} times`} the usual for what they bring.`;
  note(game, notes, "SHIP", message);
  return { message, notes };
}
// Each midnight: whoever else has the chair calls for help when she's stranded, and a call that's due is answered.
// The answer brings the fuel to reach the nearest port that sells it, and cells for a couple of days if she has none,
// out of that port's own stores and at its prices, dearer; what the purse can't pay goes on the slate there, however
// much it is, because nobody tows a ship home for nothing and nobody leaves one to die for a debt.
function distressDay(game, notes) {
  const ship = game.ship;
  const rules = tradeRules()?.["a distress call"];
  if (!rules) return;
  if (!ship.distress) {
    const why = strandedWhy(game);
    // Whoever else has the chair calls at once. The player's told once that they can.
    if (ship.chair && why) ship.distress = { sent: game.clock.hours, due: game.clock.hours + rules.days * 24 };
    else if (why && isCaptain(game) && !ship.warned.stranded) {
      ship.warned.stranded = true;
      note(game, notes, "SHIP", `The Meridian can't get herself to any port now. A distress call can be sent from the Ship menu: someone answers in about ${plural(rules.days, "day")}, and charges ${rules.times === 2 ? "twice" : `${rules.times} times`} the usual for what they bring.`);
    } else if (!why) delete ship.warned.stranded;
    return;
  }
  if (game.clock.hours < ship.distress.due) return;
  delete ship.distress;
  const from = nearestFuel(game);
  if (!from) return;
  const byHand = navigationDown(game) ? 1 : 0;
  const fuel = clamp(shipJumpCost(ship, from).fuel + byHand + 1 - ship.fuel, 0, ship.maxFuel - ship.fuel);
  const cells = cellsOf(game);
  const wanted = cells && cells.n < cells.aDay ? Math.ceil(cells.aDay * 2) : 0;
  const stowed = wanted ? putAboard(game, SHIP_ID, "fuel_cell", wanted, ["fuel_rack", "shuttle_stores"]) : 0;
  const each = mapSpot(from).trade.fuel * supplyFactor(game, from, "fuel");
  const cost = Math.ceil((fuel * each + stowed * (unitPrice(game, from, "fuel_cell") ?? 0)) * rules.times);
  ship.fuel += fuel;
  if (fuel) tradedAt(game, from, "fuel", false, fuel);
  const good = portsModel().order.find((one) => portsModel().goods[one].item === "fuel_cell");
  if (stowed && good) portTake(game.world, from, good, stowed);
  // From the purse, and the rest on the slate at the port it came from, past what a port would usually give.
  const have = Math.max(0, Math.min(cost, Math.floor(purseOf(game))));
  addToPurse(game, -have);
  const owed = cost - have;
  if (owed > 0) {
    ship.slate ??= {};
    ship.slate[from] = { owed: (ship.slate[from]?.owed ?? 0) + owed, since: ship.slate[from]?.owed > 0 ? ship.slate[from].since : ship.day };
  }
  const brought = [fuel ? `${fuel} fuel for the tank` : null, stowed ? `${stowed} fuel cells` : null].filter(Boolean).join(" and ");
  note(game, notes, "SHIP", `A tanker out of ${LOCATIONS[from].name} has answered the distress call${brought ? `: ${brought}` : ""}, for ${cost} credits${owed > 0 ? `, ${owed} of it on the slate there` : ""}. She can make ${LOCATIONS[from].name} on that.`);
  noteRestocked(game, "fuel", notes);
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
    case "distress": return callForHelp(game);
    case "purse": return payIntoPurse(game, body.n);
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
    bought: round2(ledger.bought[id]),
    used: round2(ledger.used[id]),
    net: round2(ledger.net[id]),
    days: days === null ? null : Math.floor(days),
    out,
    low: !out && days !== null && days <= RULES.warnAtDays,
  };
}

// The ship as the page sees her: her numbers, where she is, what's aboard and what's been decided.
// The ship's money as the Ship menu shows it: src/trade.js knows her purse, her cells and what the tank and the
// generator cost in a day at this dock, and the ledger adds what goes of food, medicine and parts beyond what's made
// aboard, where the dock sells them. So "what a day costs here" is what staying would take out of the purse.
function moneyView(game, ledger) {
  const money = tradeView(game);
  const prices = mapSpot(game.ship.at)?.trade;
  if (!money || money.cost === null || !prices) return money;
  let more = 0;
  for (const id of STORES) if (prices[id]) more += (ledger.bought[id] + Math.max(0, -ledger.net[id])) * prices[id] * supplyFactor(game, game.ship.at, id);
  const cost = Math.round(money.cost + more);
  return { ...money, cost, moneyDays: cost > money.levy ? Math.floor(money.purse / (cost - money.levy)) : null };
}

export function shipView(game) {
  const ship = shipOf(game);
  const ledger = shipLedger(game);
  const spot = mapSpot(ship.at);
  // What the dock she's at has of each supply today, where its amounts are real.
  const dock = spot?.trade ? placeNow(game, ship.at)?.goods ?? null : null;
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
    work: workView(game, SHIP_ID),
    // The work board as the Work page shows it: the officers' orders, the stores and the jobs (src/work.js).
    board: boardView(game, SHIP_ID),
    refills: refillsView(game, SHIP_ID),
    // The ship's money: her purse, what comes in, what a day costs at this dock, what she owes, and her fuel cells.
    money: moneyView(game, ledger),
    // Whether she can get herself to any port, and a distress call that's been sent.
    stranded: strandedView(game),
    repairs: repairsView(game, SHIP_ID),
    // Who's on the medbay's cots and floor, and what the medics are doing (src/medbay.js).
    medbay: medbayView(game, SHIP_ID),
    // What the techs are mending and building in the Repair Bay (src/workshop.js).
    workshop: workshopView(game, SHIP_ID),
    shortages: SUPPLY_IDS.filter((id) => isOut(game, id) || (daysLeft(game, id, ledger) ?? Infinity) <= RULES.warnAtDays),
    trade: Object.entries(spot?.trade ?? {}).map(([id, each]) => {
      const supply = SUPPLIES[id];
      const worth = each * supplyFactor(game, ship.at, id) * supply.lot;
      const level = game.world?.places[ship.at]?.goods[id];
      const offer = buyOffer(game, id);
      // How it would be paid for: from the purse, on the slate here, or not at all.
      const pays = offer.n ? payAt(game, ship.at, offer.price, { dry: true }) : null;
      return {
        id,
        name: supply.name,
        amount: lotText(supply),
        // What Buy would get: a lot, or fewer when the port is down to its last or the stores have little room.
        buys: offer.n ? `${offer.last ? "the last " : ""}${amountText(supply, offer.n)}` : null,
        price: offer.n ? offer.price : buyPrice(game, { price: worth }),
        pays: pays ? (pays.slate ? "slate" : "purse") : null,
        slate: pays?.slate ?? 0,
        sellFor: sellPrice(game, { price: worth }),
        level: level === undefined ? null : levelName(level),
        // How many the port has, and why it's short, where its amounts are real (src/ports.js).
        ...(dock?.find((good) => good.id === id)?.has ? { has: dock.find((good) => good.id === id).has, why: dock.find((good) => good.id === id).why ?? null } : {}),
        none: noneLeft(game, ship.at, id),
        spare: (id === "fuel" ? ship.fuel : sellable(game, id)) >= supply.lot,
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

// Someone's taken the chair, or lost it, in the story.
export function changeCommand(game, { takes, reason }) {
  const ship = shipOf(game);
  game.role ??= { id: "captain", captain: true };
  if (takes) {
    if (isCaptain(game)) return { summary: "They already have command." };
    if (!aboardShip(game)) throw new Error("They have to be aboard the Meridian, or on the dock she's at, to take command of her. Use travel first.");
    const was = chairOf(game);
    game.role.captain = true;
    // The ship's money comes with the chair.
    if (ship.chair) ship.purse = ship.chair.funds ?? ship.purse;
    ship.chair = null;
    if (captainPost()) setHolder(game, SHIP_ID, captainPost(), YOU);
    return { summary: `They're the captain now. ${was ? `${was.name} isn't, and the rations, the buying and the jumps are all the player's to answer.` : ""}`, notice: `[SHIP] You have command of the Meridian: ${reason}`, notes: [] };
  }
  if (!isCaptain(game)) return { summary: "They aren't in command anyway." };
  game.role.captain = false;
  ship.chair = newChair(game);
  if (ship.purse !== undefined) ship.chair.funds = ship.purse;
  if (captainPost()) setHolder(game, SHIP_ID, captainPost(), ship.chair.id);
  const chair = chairOf(game);
  return { summary: `They aren't the captain any more. ${chair.name} (id ${chair.id}) is, and you play them. The ship goes on by itself from here, and the player goes where they like.`, notice: `[SHIP] ${chair.name} has command of the Meridian now: ${reason}`, notes: [] };
}

// The chair changing hands by the chain of command (src/command.js): back to the player, or to someone aboard, who
// runs the ship from then on as the chair's captains do. The ship's funds and the chair's habits go with it.
export function handChair(game, key) {
  const ship = shipOf(game);
  game.role ??= { id: "captain", captain: true };
  if (key === YOU) {
    game.role.captain = true;
    if (ship.chair) ship.purse = ship.chair.funds ?? ship.purse;
    ship.chair = null;
  } else {
    game.role.captain = false;
    ship.chair = { id: key, funds: ship.chair?.funds ?? ship.purse ?? CHAIR.funds, lastJump: ship.chair?.lastJump ?? -99, lastBuy: ship.chair?.lastBuy ?? -99 };
  }
  if (captainPost()) setHolder(game, SHIP_ID, captainPost(), key);
}

// The rations going up to at least a level, as an answer to the officers, and never down. Gives what's said, or null if
// they were there already.
export function raiseRations(game, id) {
  const ship = shipOf(game);
  if (!RATIONS[id] || (RATIONS[ship.rations]?.food ?? 1) >= RATIONS[id].food) return null;
  ship.rations = id;
  councilOf(ship).ordered.rations = ship.day;
  councilOf(ship).setRations = null;
  return `Rations aboard are now ${RATIONS[id].name.toLowerCase()}.`;
}

// Lets a test, or the checker, see the names a stage's fleet line may carry that the ship no longer reads.
export const SHIP_EFFECT_KEYS = ["morale", "food", "medicine", "parts", "fuel"];
