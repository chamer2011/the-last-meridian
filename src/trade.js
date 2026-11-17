// The ship's trade, from world/trade.txt. Since the ports hold real amounts (the logistics rework, step 8) this is how
// the Meridian lives:
//
// - The purse: the ship's own money, apart from the player's, whoever has the chair. A levy comes in every day, and it
//   pays for what the ship buys: her restocking, and what the captain buys for her by the lot (src/ship.js).
// - Restocking at a dock. A store whose refill line in world/logistics says "from the dock" is filled every so often
//   while she's docked at a port that sells what it keeps: real crates and cells out of the port's stores, at the
//   port's own price that day, paid from the purse. In open space, nothing comes.
// - The slate: when the purse can't pay at a port, the port puts it on the slate, dearer, up to so much; whatever
//   is left in the purse at midnight goes to the slate, and the ship's standing with whoever holds the port falls a
//   little every day until it's paid. While she owes anything the dock only keeps her going: it fills her stores part
//   of the way, not to the top.
// - Passengers, offered at a port while the ship is docked there and the captain's ashore: people for another port on
//   the chart, paid into the purse on arrival. They eat at the sittings on the way. (Freight is src/freight.js: real
//   goods out of a port's stores, in the ship's hold. The crates a game from before was carrying are still unloaded
//   here.)
//
// It registers itself with src/room-hooks.js. src/ship.js uses the purse and the slate for what the captain buys, and
// for the distress call; nothing here imports the ship's rules.

import fs from "node:fs";
import path from "node:path";
import { addChecker, addClockWork, addDayWork, addOrder, addRoomActs } from "./room-hooks.js";
import { storeCounts, storePut } from "./bag.js";
import { seeded } from "./body.js";
import { goodFactor, holderOf, supplyFactor } from "./daily.js";
import { FACTIONS, ITEMS, LOCATIONS } from "./data.js";
import { countAboard, countOf, logisticsOf, setCount } from "./logistics.js";
import { worldDir } from "./paths.js";
import { amountOf, portTake, portsModel } from "./ports.js";
import { aboardShip, isCaptain } from "./role.js";
import { SHIP_DATA, STAR_MAP } from "./world.js";

export const TRADE_FILE = process.env.GAME_TRADE_FILE ?? path.join(worldDir, "trade.txt");
const SHIP = "meridian";
// What a thing in the ship's stores is at a port's market: the supply whose price it follows on the star map.
const SUPPLY_OF = { ration_crate: "food", fuel_cell: "fuel" };
// The line of the file that prices each.
const PRICE_LINE = { ration_crate: "a ration crate", fuel_cell: "a fuel cell" };

const nowOf = (game) => game.clock?.hours ?? 0;
const dayOf = (game) => Math.floor(nowOf(game) / 24);
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
// A place's name as it reads in the middle of a line: "for the Graveyard".
const nameOf = (place) => (LOCATIONS[place]?.name ?? place).replace(/^The /, "the ");
const counted = (item, n) => {
  const name = (ITEMS[item]?.name ?? item).toLowerCase();
  if (n === 1 || /s$/.test(name)) return `${n} ${name}`;
  // "3 tanks of water", not "3 tank of waters".
  const of = name.indexOf(" of ");
  return of > 0 ? `${n} ${name.slice(0, of)}s${name.slice(of)}` : `${n} ${name}s`;
};
const listed = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0] ?? "");

// ---- The file -----------------------------------------------------------------------------------------

const LINES = {
  "the purse": [/^(\d+) to begin with, (\d+) a day$/i, (f) => ({ start: Number(f[1]), aDay: Number(f[2]) }), "600 to begin with, 60 a day"],
  "a ration crate": [/^([\d.]+) times the port's food price$/i, (f) => ({ times: Number(f[1]) }), "1 times the port's food price"],
  "a fuel cell": [/^([\d.]+) times the port's fuel price$/i, (f) => ({ times: Number(f[1]) }), "0.15 times the port's fuel price"],
  "the slate": [/^([\d.]+) times the price, up to (\d+) credits a port, standing falls (\d+) a day until it's paid$/i, (f) => ({ times: Number(f[1]), limit: Number(f[2]), falls: Number(f[3]) }), "1.5 times the price, up to 300 credits a port, standing falls 1 a day until it's paid"],
  "while she owes": [/^the dock fills her stores to (\d+) percent$/i, (f) => ({ share: Number(f[1]) / 100 }), "the dock fills her stores to 33 percent"],
  "a distress call": [/^answered in (\d+) days?, at ([\d.]+) times the price$/i, (f) => ({ days: Number(f[1]), times: Number(f[2]) }), "answered in 3 days, at 2 times the price"],
  freight: [/^up to (\d+) offers a port, ([\d.]+) credits a square for each measure of fuel the trip takes, (\d+) days to deliver$/i, (f) => ({ offers: Number(f[1]), rate: Number(f[2]), days: Number(f[3]) }), "up to 3 offers a port, 4 credits a square for each measure of fuel the trip takes, 8 days to deliver"],
  passengers: [/^(\d+) to (\d+) people, (\d+) credits each$/i, (f) => ({ least: Number(f[1]), most: Number(f[2]), each: Number(f[3]) }), "4 to 10 people, 10 credits each"],
};

export function parseTrade(text) {
  const model = { problems: [] };
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^draft:/i.test(line)) return;
    const found = line.match(/^([a-z ]+): (.+)$/i);
    const reader = found ? LINES[found[1].toLowerCase()] : null;
    if (!reader) return model.problems.push(`world/trade.txt, line ${i + 1}: a line here is one of: ${Object.keys(LINES).join(", ")}`);
    const read = found[2].trim().match(reader[0]);
    if (!read) return model.problems.push(`world/trade.txt, line ${i + 1}: "${found[1]}" is written like: ${reader[2]}`);
    model[found[1].toLowerCase()] = reader[1](read);
  });
  const missing = Object.keys(LINES).filter((name) => !model[name]);
  if (missing.length) model.problems.push(`world/trade.txt: there's no line for ${missing.join(", ")}, so there's no trade`);
  model.whole = !missing.length;
  return model;
}

let read;
export function tradeRules() {
  if (read === undefined) read = fs.existsSync(TRADE_FILE) ? parseTrade(fs.readFileSync(TRADE_FILE, "utf8")) : null;
  return read?.whole ? read : null;
}
export const forgetTrade = () => { read = undefined; };
addChecker(() => (fs.existsSync(TRADE_FILE) ? (tradeRules(), read.problems) : []));

// ---- The purse ----------------------------------------------------------------------------------------

// The ship's money is one purse, whoever has the chair: the player as captain keeps it on the ship, and someone else
// in the chair keeps it as the chair's funds (src/ship.js hands it over with the chair).
export const purseOf = (game) => (game.ship?.chair ? game.ship.chair.funds ?? 0 : game.ship?.purse ?? tradeRules()?.["the purse"].start ?? 0);
// The purse is written into the save the first time anything moves in it.
export const openPurse = (game) => { if (game.ship && !game.ship.chair && game.ship.purse === undefined) game.ship.purse = purseOf(game); };
export function addToPurse(game, n) {
  const ship = game.ship;
  if (!ship || !n) return;
  if (ship.chair) ship.chair.funds = (ship.chair.funds ?? 0) + n;
  else {
    openPurse(game);
    ship.purse += n;
  }
}

// ---- The slate ----------------------------------------------------------------------------------------

// What the ship owes at a port, and everything she owes.
export const slateOf = (game, place) => game.ship?.slate?.[place]?.owed ?? 0;
export const slates = (game) => Object.entries(game.ship?.slate ?? {}).filter(([, one]) => one.owed > 0).map(([place, one]) => ({ place, name: LOCATIONS[place]?.name ?? place, owed: one.owed, since: one.since }));

// Pays for something the ship buys at a port: out of the purse, and what the purse can't cover on the slate there,
// dearer, while the port will still give credit. Says what was paid and what went on the slate, or null when it can't
// be paid for at all. dry only asks.
export function payAt(game, place, cost, { dry = false } = {}) {
  const ship = game.ship;
  if (!ship || !(cost >= 0)) return null;
  const have = Math.max(0, Math.floor(purseOf(game)));
  if (have >= cost) {
    if (!dry) addToPurse(game, -cost);
    return { paid: cost, slate: 0 };
  }
  const rules = tradeRules()?.["the slate"];
  if (!rules || !place || !LOCATIONS[place]) return null;
  const owed = Math.ceil((cost - have) * rules.times);
  const before = slateOf(game, place);
  if (before + owed > rules.limit) return null;
  if (!dry) {
    addToPurse(game, -have);
    ship.slate ??= {};
    ship.slate[place] = { owed: before + owed, since: before > 0 ? ship.slate[place].since : dayOf(game) };
  }
  // first: nothing was owed there before this.
  return { paid: have, slate: owed, first: before <= 0 };
}
// What's said the first time something goes on the slate at a port.
export function slateWords(game, place) {
  const rules = tradeRules()?.["the slate"];
  const holder = holderOf(game, place);
  const who = FACTIONS[holder]?.name ?? null;
  return `It's on the slate at ${nameOf(place)}, ${rules?.times === 1.5 ? "half again" : `${rules?.times} times`} dearer. Whatever's left in the purse each midnight goes to it${who ? `, and your standing with the ${who.replace(/^The /, "")} falls a little every day until it's paid` : ""}. Until then the dock only keeps her going.`;
}

// Each midnight: what's left in the purse goes to the slates, the oldest first, and standing falls where one's still
// owed; then the levy comes in while the player's the captain (someone else in the chair has their own income,
// src/ship.js). So a day's levy is there for the day's needs at the usual price, and only what she didn't need pays
// what she owes: a ship that's run dry climbs back out, slowly.
addDayWork((game) => {
  const rules = tradeRules();
  const ship = game.ship;
  if (!rules || !ship) return [];
  const lines = [];
  const levy = !ship.chair && isCaptain(game) ? rules["the purse"].aDay : 0;
  // Someone else's income has come in already today (src/ship.js): it's kept back for the day, like the levy.
  const kept = ship.chair ? SHIP_DATA.chair?.income ?? 0 : 0;
  const owing = slates(game).sort((a, b) => a.since - b.since);
  for (const one of owing) {
    const pay = Math.min(Math.max(0, Math.floor(purseOf(game)) - kept), one.owed);
    if (pay > 0) {
      addToPurse(game, -pay);
      ship.slate[one.place].owed -= pay;
    }
    if (ship.slate[one.place].owed <= 0) {
      delete ship.slate[one.place];
      if (aboardShip(game)) lines.push(`[TRADE] The slate at ${nameOf(one.place)} is paid.`);
      continue;
    }
    // Still owed: whoever holds the port thinks a little less of the ship for it.
    const holder = holderOf(game, one.place);
    if (FACTIONS[holder] && game.factions && isCaptain(game)) game.factions[holder] = clamp((game.factions[holder] ?? 0) - rules["the slate"].falls, -100, 100);
  }
  if (levy) addToPurse(game, levy);
  lines.push(...cellsWarning(game));
  return lines;
});

// ---- What the generator burns -------------------------------------------------------------------------

// The fuel cells aboard, how many her generators burn in a day, and how many days that is.
export function cellsOf(game) {
  const model = logisticsOf(SHIP);
  const aDay = (model?.generators ?? []).reduce((sum, m) => sum + (m.takes ?? []).filter((take) => take.item === "fuel_cell").reduce((n, take) => n + (take.n ?? 1), 0) * (1440 / m.every), 0);
  if (!(aDay > 0)) return null;
  const counted = countAboard(game, SHIP, ["fuel_cell"]);
  const n = counted?.n ?? 0;
  // holding: the dock she's at sends them as fast as they're burned.
  return { n, of: counted?.of ?? n, aDay: Math.round(aDay * 10) / 10, days: Math.floor(n / aDay), holding: dockSends(game, "fuel_cell") >= aDay };
}
// Said once when they're down to a few days, and once when the last is in the generator.
function cellsWarning(game) {
  const ship = game.ship;
  const cells = cellsOf(game);
  if (!cells) return [];
  ship.warned ??= {};
  const said = [];
  const warnAt = SHIP_DATA.rules?.warnAtDays ?? 5;
  if (cells.n <= 0 && ship.warned.cells !== "out") {
    ship.warned.cells = "out";
    said.push(`[SUPPLY] The last fuel cell aboard is in the generator. When it's burned, nothing aboard has power: no light, no air plant, no cooking, no jumps. ${ship.at ? "A port that sells fuel sells cells too." : "In open space nothing comes."}`);
  } else if (cells.n > 0 && cells.days <= warnAt && !cells.holding && !ship.warned.cells) {
    ship.warned.cells = "low";
    said.push(`[SUPPLY] Fuel cells for the generator are down to about ${Math.max(1, cells.days)} ${cells.days <= 1 ? "day" : "days"}. They're bought with the stores at a port that sells fuel; ${ship.at ? "nobody here sells them" : "in open space nothing comes"}.`);
  } else if (cells.days > warnAt + 3 || cells.holding) delete ship.warned.cells;
  if (!said.length) return [];
  ship.log?.push({ day: `Day ${dayOf(game) + 1}`, tag: "SUPPLY", text: said[0].replace(/^\[SUPPLY\] /, "") });
  return aboardShip(game) ? said : [];
}

// ---- Restocking at a dock -----------------------------------------------------------------------------

// The good in the ports' files that a thing in the stores is: a ration crate is the port's ration crates.
function portGood(item) {
  const model = portsModel();
  return model.order.find((good) => model.goods[good].item === item) ?? null;
}
// How many whole ones of a thing the port has to sell the ship, where its amounts are real; no limit where they aren't.
function portHas(game, port, item) {
  const good = portGood(item);
  if (!good || !portsModel().ports[port]?.holds[good]) return Infinity;
  return Math.floor(amountOf(game.world, port, good));
}
// What one of a thing costs the ship at a port today, or null where the port doesn't sell it to her: the star map's
// price for the supply it belongs to, by the file's number, by how much the port has of it and what it thinks of her.
// Anything else her stores are filled with at a dock (a tank of water) is sold where the port's own file holds it, at
// the thing's own price, by how much the port has of it and what it thinks of her.
export function unitPrice(game, port, item) {
  const rules = tradeRules();
  const supply = SUPPLY_OF[item];
  if (!supply) {
    // Only what the dock restocks has a price here: anything else is the Market's, or the freight's.
    if (!(logisticsOf(SHIP)?.refills ?? []).some((r) => r.from === "dock" && r.items.includes(item))) return null;
    const good = portGood(item);
    if (!rules || !good || !ITEMS[item]?.price || !portsModel().ports[port]?.holds[good]) return null;
    return Math.max(1, Math.ceil(ITEMS[item].price * goodFactor(game, port, good)));
  }
  const each = STAR_MAP.places?.[port]?.trade?.[supply];
  const line = rules?.[PRICE_LINE[item]];
  if (!line || !each) return null;
  const good = portGood(item);
  const factor = good && portsModel().ports[port]?.holds[good] ? goodFactor(game, port, good) : supplyFactor(game, port, supply);
  return Math.max(1, Math.ceil(each * line.times * factor));
}
// The old name for it, which the Market's page and the tests of the first trade knew.
export const crateprice = unitPrice;

// How many of a thing the dock she's at could send aboard in a day: what the stores restocked from the dock take of
// it, while the port sells it, has some, and the purse or the slate can pay. Nothing in open space. While this keeps
// up with what's used, the thing is holding, and nobody counts the days it has left.
export function dockSends(game, item) {
  const ship = game.ship;
  const rules = tradeRules();
  if (!rules || !ship?.at || !LOCATIONS[ship.at]) return 0;
  const price = unitPrice(game, ship.at, item);
  if (!price || portHas(game, ship.at, item) < 1 || !payAt(game, ship.at, price, { dry: true })) return 0;
  const model = logisticsOf(SHIP);
  const short = slates(game).length > 0 || purseOf(game) < price;
  let aDay = 0;
  for (const r of model?.refills ?? []) {
    if (r.from !== "dock" || !r.items.includes(item)) continue;
    const store = model.stores.find((one) => one.id === r.store);
    const upTo = mostOf(r, store, item);
    aDay += (short ? Math.ceil(upTo * rules["while she owes"].share) : upTo) * (1440 / r.every);
  }
  return aDay;
}
// The most of a thing a refill line keeps in its store: what the store holds of it, or what the line says. A store
// that keeps a count (the water tank, in measures) takes whole ones of what fills it, so many measures each.
function mostOf(r, store, item) {
  const holds = r.count ? Math.floor(store.count.n / r.per) : store.holds[item] ?? 0;
  return r.upTo === "full" ? holds : Math.min(holds, r.count ? Math.floor(r.upTo / r.per) : r.upTo);
}
// How many of it the store has now, and one more put into it: says whether it went in.
const hasOf = (game, r, store, item) => (r.count ? Math.floor(countOf(game, store) / r.per) : storeCounts(game, store.key, store.holds)[item] ?? 0);
function putOne(game, r, store, item) {
  if (!r.count) return storePut(game, store.key, store.holds, item, 1) >= 1;
  const have = countOf(game, store);
  if (store.count.n - have < r.per) return false;
  setCount(game, store, have + r.per);
  return true;
}

function restock(game) {
  const ship = game.ship;
  const rules = tradeRules();
  const model = logisticsOf(SHIP);
  const refills = (model?.refills ?? []).filter((r) => r.from === "dock");
  if (!refills.length) return [];
  const lines = [];
  // The marks are kept a store at a time. A game from before the ports held real amounts has none (or the one number
  // of the old switch): it's told once how the stores fill now.
  if (typeof ship.restocked !== "object" || !ship.restocked) {
    ship.restocked = {};
    const cells = cellsOf(game);
    // What's in the purse is the captain's to know; anyone else with the ship hears how it goes from now on.
    const purse = isCaptain(game) ? ` (${Math.floor(purseOf(game))} credits)` : "";
    const text = `From now on nothing comes aboard from nowhere. Ration crates and fuel cells are bought at a dock, out of the port's own stores and the ship's purse${purse}, and in open space nothing comes.${cells ? ` The fuel cells aboard last about ${cells.days} ${cells.days === 1 ? "day" : "days"}.` : ""}${isCaptain(game) ? " The Ship menu has the purse and what a day costs." : ""}`;
    ship.log?.push({ day: `Day ${dayOf(game) + 1}`, tag: "TRADE", text });
    if (aboardShip(game) || isCaptain(game)) lines.push(`[TRADE] ${text}`);
  }
  for (const r of refills) {
    const mark = Math.floor((nowOf(game) * 60) / r.every) * r.every;
    const last = ship.restocked[r.store];
    if (last === mark) continue;
    ship.restocked[r.store] = mark;
    // The first mark only starts the count, so that nothing's bought the moment a game is opened.
    if (last === undefined || !ship.at || !LOCATIONS[ship.at]) continue;
    const store = model.stores.find((one) => one.id === r.store);
    const bought = [];
    let spent = 0;
    let slated = 0;
    let firstSlate = false;
    let refused = false;
    for (const item of r.items) {
      const price = unitPrice(game, ship.at, item);
      if (!price) continue;
      const upTo = mostOf(r, store, item);
      const have = hasOf(game, r, store, item);
      // A tank that keeps a count is topped up only when there's room for a whole one of what fills it.
      const room = r.count ? Math.floor(((r.upTo === "full" ? store.count.n : Math.min(store.count.n, r.upTo)) - countOf(game, store)) / r.per) : upTo - have;
      const want = Math.min(room, portHas(game, ship.at, item));
      // While she owes anything, and for whatever would go on the slate, the dock only keeps her going.
      const keptAt = Math.ceil(upTo * rules["while she owes"].share);
      let got = 0;
      for (let i = 0; i < want; i += 1) {
        const paid = payAt(game, ship.at, price, { dry: true });
        if ((!paid || paid.slate > 0 || slates(game).length) && have + got >= keptAt) break;
        if (!paid) {
          refused = true;
          break;
        }
        if (!putOne(game, r, store, item)) break;
        const went = payAt(game, ship.at, price);
        spent += went.paid;
        slated += went.slate;
        firstSlate ||= went.slate > 0 && went.first;
        const good = portGood(item);
        if (good) portTake(game.world, ship.at, good, 1);
        got += 1;
      }
      if (got) bought.push(counted(item, got));
    }
    if (!bought.length && !refused) continue;
    const text = bought.length
      ? `${listed(bought)} bought at ${nameOf(ship.at)} for ${spent + slated} credits${slated ? `, ${slated} of it on the slate` : ""}, into the ${store.name}.`
      : `Nothing could be bought at ${nameOf(ship.at)} for the ${store.name}: the purse is empty, and the slate there is full.`;
    // An empty purse is said once a day, not at every mark.
    if (!bought.length) {
      if (ship.restockRefused === dayOf(game)) continue;
      ship.restockRefused = dayOf(game);
    }
    const state = game.logistics?.[SHIP];
    if (state && bought.length) {
      state.refills ??= { log: [] };
      state.refills.log.push({ at: mark, text: `${text[0].toUpperCase()}${text.slice(1)}` });
      if (state.refills.log.length > 20) state.refills.log.splice(0, state.refills.log.length - 20);
    }
    // Whoever's aboard or on that dock sees it come aboard. What's left in the purse, and the slate, are the captain's.
    if (game.location === SHIP || game.location === ship.at) lines.push(`[TRADE] ${text[0].toUpperCase()}${text.slice(1)}${isCaptain(game) ? ` The purse holds ${Math.floor(purseOf(game))}.${firstSlate ? ` ${slateWords(game, ship.at)}` : ""}` : ""}`);
  }
  return lines;
}

// ---- What the Ship menu shows of it --------------------------------------------------------------------

// The purse, the levy, the slates, the cells, and what the dock she's at charges: reading it changes nothing.
export function tradeView(game) {
  const rules = tradeRules();
  const ship = game.ship;
  if (!rules || !ship) return null;
  const at = ship.at && LOCATIONS[ship.at] ? ship.at : null;
  const cells = cellsOf(game);
  const prices = at ? { crate: unitPrice(game, at, "ration_crate"), cell: unitPrice(game, at, "fuel_cell"), water: unitPrice(game, at, "water") } : null;
  const fuelEach = at && STAR_MAP.places?.[at]?.trade?.fuel ? STAR_MAP.places[at].trade.fuel * supplyFactor(game, at, "fuel") : null;
  const burn = SHIP_DATA.ship?.uses?.fuel ?? 0;
  // What a day costs at this dock: the cells her generator burns and the fuel she uses keeping station, where they're
  // sold. src/ship.js adds what goes of food, medicine and parts beyond what's made aboard.
  const cost = at ? Math.round((cells && prices.cell ? cells.aDay * prices.cell : 0) + (fuelEach ? burn * fuelEach : 0)) : null;
  const levy = !ship.chair && isCaptain(game) ? rules["the purse"].aDay : SHIP_DATA.chair?.income ?? rules["the purse"].aDay;
  const purse = Math.floor(purseOf(game));
  const refill = (logisticsOf(SHIP)?.refills ?? []).find((r) => r.from === "dock") ?? null;
  return {
    purse,
    levy,
    cost,
    // How long the purse lasts at this dock's prices, when a day costs more than comes in.
    moneyDays: cost !== null && cost > levy ? Math.floor(purse / (cost - levy)) : null,
    cells,
    dock: at ? { name: LOCATIONS[at].name, crate: prices.crate, cell: prices.cell, water: prices.water, every: refill ? refill.every / 60 : null } : null,
    slates: slates(game).map((one) => ({ ...one, holder: FACTIONS[holderOf(game, one.place)]?.name ?? null })),
    slate: { times: rules["the slate"].times, limit: rules["the slate"].limit, falls: rules["the slate"].falls, share: rules["while she owes"].share },
  };
}

// ---- Passengers ---------------------------------------------------------------------------------------

// The ports a captain's chart shows that have a market, other than this one.
const portsFrom = (place) => Object.entries(STAR_MAP.places ?? {}).filter(([id, spot]) => id !== place && spot.charted && spot.trade && LOCATIONS[id]).map(([id]) => id);

// The party a port has for her this week: the same all week, and gone once it's taken.
export function offersAt(game, place) {
  const rules = tradeRules();
  // Nothing's offered to someone who's out at a wreck (src/salvage.js, src/wrecks.js): they aren't on the dock to hear it.
  if (!rules || !isCaptain(game) || game.ship?.at !== place || game.location !== place || game.salvage || game.wreckRun) return { party: null };
  const ports = portsFrom(place);
  if (!ports.length) return { party: null };
  const week = Math.floor(dayOf(game) / 7);
  const roll = seeded(`${game.bodySeed}:passengers:${week}:${place}`);
  const between = (least, most) => least + Math.floor(roll() * (most - least + 1));
  const taken = game.ship.taken ?? [];
  const n = between(rules.passengers.least, rules.passengers.most);
  const party = { id: `${week}:${place}:p`, to: ports[Math.floor(roll() * ports.length)], n, fee: n * rules.passengers.each };
  return { party: taken.includes(party.id) ? null : party };
}

addRoomActs((game, { place, room }) => {
  const rules = tradeRules();
  if (!rules || !isCaptain(game)) return null;
  const acts = [];
  // In the room the dock's goods come aboard into: what's being carried, for whoever looks.
  if (place === SHIP && room === logisticsOf(SHIP)?.stores.find((one) => logisticsOf(SHIP).refills.some((r) => r.store === one.id))?.room) {
    // Crates a game from before was carrying. Real freight is in the hold, and on the Market's page.
    for (const one of (game.ship.cargo ?? []).filter((it) => !it.item)) acts.push({ id: "trade-carried", key: one.id, label: `Carrying ${one.n} crates for ${nameOf(one.to)}`, detail: `${one.fee} credits, by day ${one.by + 1}`, disabled: true });
    if (game.ship.party) acts.push({ id: "trade-carried", key: "party", label: `Carrying ${game.ship.party.n} passengers to ${nameOf(game.ship.party.to)}`, detail: `${game.ship.party.fee} credits on arrival`, disabled: true });
  }
  const offers = offersAt(game, place);
  if (offers.party) {
    const busy = Boolean(game.ship.party);
    acts.push({ id: "take-passengers", key: offers.party.id, label: `Take ${offers.party.n} passengers to ${nameOf(offers.party.to)}`, detail: busy ? "you're carrying a party already" : `${offers.party.fee} credits on arrival; they eat at the sittings`, ...(busy ? { disabled: true } : {}) });
  }
  return acts;
});

addOrder("take-passengers", (game, body) => {
  const party = offersAt(game, game.location).party;
  if (!party || party.id !== String(body.key ?? "")) throw new Error("They've found another ship.");
  if (game.ship.party) throw new Error("You're carrying a party already.");
  openPurse(game);
  game.ship.party = { to: party.to, n: party.n, fee: party.fee };
  game.ship.taken = [...(game.ship.taken ?? []), party.id].slice(-40);
  game.ship.aboard += party.n;
  return { said: `[TRADE] ${party.n} passengers for ${nameOf(party.to)} come aboard with their bags. ${party.fee} credits when they get there, and they eat at the sittings until then.` };
});

// The clock: what's for the port the ship has reached is unloaded and paid for, and the dock restocks her.
addClockWork((game) => {
  const rules = tradeRules();
  const ship = game.ship;
  if (!rules || !ship) return [];
  const lines = [];
  if (ship.at && (ship.cargo?.length || ship.party)) {
    // The crates a game from before was carrying were a count and no more. Real freight is unloaded by src/freight.js.
    for (const one of (ship.cargo ?? []).filter((it) => !it.item && it.to === ship.at)) {
      const late = dayOf(game) > one.by;
      const fee = late ? Math.floor(one.fee / 2) : one.fee;
      addToPurse(game, fee);
      lines.push(`[TRADE] The ${one.n} crates for ${nameOf(one.to)} are unloaded${late ? ", late: half the fee" : ""}. ${fee} credits into the ship's purse.`);
    }
    if (ship.cargo?.length) ship.cargo = ship.cargo.filter((it) => it.item || it.to !== ship.at);
    if (ship.party?.to === ship.at) {
      addToPurse(game, ship.party.fee);
      ship.aboard = Math.max(0, ship.aboard - ship.party.n);
      lines.push(`[TRADE] The ${ship.party.n} passengers go ashore at ${nameOf(ship.at)}. ${ship.party.fee} credits into the ship's purse.`);
      ship.party = null;
    }
  }
  lines.push(...restock(game));
  return lines;
});
