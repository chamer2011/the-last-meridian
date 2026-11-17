// Water and air aboard (step 11 of the logistics rework). The ship keeps water in a tank, which her logistics file
// names with her other stores (a store that holds measures of water), and reserve air in her reserve tanks (a store
// that holds the reserve air her systems file gives her). src/logistics.js reads the lines; this is what they do.
//
// - Everyone aboard drinks, so many measures a day. The galley takes water for every pot and the Garden for every
//   picking (a machine's line says "and 1 water"), and the air plant uses it up as it runs: it makes the decks' air
//   from water and power, and with none it stops, like an air plant with no power (src/systems.js asks plantFed).
// - What the file gives is what's lost for good: the pumps bring the rest back. With the pumps stopped (the parts of
//   the place's Water system: broken, switched off or without power) everything goes several times as fast.
// - Low on water, whoever decides what the stores want (the quartermaster) puts it on ration at their next look:
//   everyone gets half, and so does whatever grows, which gives half as much. With none, the galley can't cook,
//   nothing grows, and when the air plant has used what it had, the ship is on her reserve air.
// - The tank is filled at a dock, with the port's own tanks of water, paid from the purse (src/trade.js), or by hand:
//   a tank of water poured in. In open space nothing comes.
// - The reserve tanks are breathed while the air plant is stopped, and a room that was breached is filled again out
//   of them once it's patched; with none left in them it takes the air plant some hours. They fill again while the
//   air plant runs, from water, or by hand: a full tank fitted.
//
// It registers what the room shows with src/room-hooks.js. Nothing here is made from nothing.

import { addAirSpoiler, addDayWork, addOrder, addThingActs } from "./room-hooks.js";
import { calledBy } from "./command.js";
import { ITEMS } from "./data.js";
import { countOf, dropOrderOf, logisticsOf, powerSupply, setCount, storeById, takeCount } from "./logistics.js";
import { aboardShip, isCaptain } from "./role.js";
import { removeItem } from "./rules.js";
import { giveReserve, partWorks, partsOf, plantOn, reserveAllOf, reserveLeft, roomPowered, systemsOf, useReserve } from "./systems.js";
import { dockSends } from "./trade.js";
import { mapFor, roomOf } from "./walk.js";
import { SHIP_DATA } from "./world.js";

const SHIP = "meridian";
// What fills a water tank, and what tops up the reserve: the ports' own goods, as things.
export const WATER_ITEM = "water";
export const AIR_ITEM = "reserve_tank";
// While it's rationed, people and whatever grows get this share of their water.
const RATION = 0.5;
// The ration is lifted once the tank is back to this many times the mark it was put on at.
const LIFTED_AT = 1.5;
// How much of a day a machine that needs water is reckoned to be at work, where nothing's been measured yet.
const AT_WORK = 0.4;

const round1 = (n) => Math.round(n * 10) / 10;
const dayLabel = (t) => `Day ${Math.floor(t / 1440) + 1}`;
const roomName = (place, room) => (roomOf(mapFor(place), room)?.name ?? room).replace(/^The /, "the ");
const upperFirst = (words) => (words ? words[0].toUpperCase() + words.slice(1) : words);
const measures = (n) => `${n} measure${n === 1 ? "" : "s"}`;

export const waterOf = (place) => logisticsOf(place)?.water ?? null;
const tankOf = (model) => (model?.water?.tank ? storeById(model, model.water.tank) : null);
const reserveOf = (model) => (model?.water?.reserve ? storeById(model, model.water.reserve) : null);
const stateOf = (game, place) => game.logistics?.[place] ?? null;
// What the save keeps of a place's water: the fractions of a measure not yet taken, and whether the tank has run
// dry, the pumps have stopped, or a room is being filled. A new game has it from the start
// (src/logistics.js), so a game from before the ship kept her water is known by not having it.
const waterState = (state) => (state.water ??= { carry: 0 });
export const newWater = () => ({ carry: 0 });

// ---- The pumps, and the ration -------------------------------------------------------------------------------------

// The pumps are the parts of the place's Water system, found once for each reading of its systems.
const pumpsKept = new WeakMap();
function pumpsAt(model) {
  if (!model) return [];
  let pumps = pumpsKept.get(model);
  if (!pumps) pumpsKept.set(model, (pumps = partsOf(model, "water")));
  return pumps;
}
// Stopped: the place has pumps, and none of them works. Asked for every piece of the clock, so where the power never
// lets the water go for want of enough (its Loads don't name it) only the pump's own state and its room's power are
// looked at, which is all that can stop it there.
export function pumpsStopped(game, place) {
  const pumps = pumpsAt(systemsOf(place));
  if (!pumps.length) return false;
  if (dropOrderOf(place).includes("water")) return !pumps.some((part) => partWorks(game, place, part));
  const parts = game.systems?.[place]?.parts;
  for (const part of pumps) {
    const s = parts?.[part.id];
    if (!(s && (s.on === false || s.damage)) && roomPowered(game, place, part.room)) return false;
  }
  return true;
}
// How many times as much water goes as the file gives: once, or several times with the pumps stopped.
const lossFactor = (game, place) => (pumpsStopped(game, place) ? Math.max(1, waterOf(place)?.pumpsStopped || 1) : 1);

export const waterRationed = (game, place) => Boolean(game.logistics?.[place]?.orders?.water?.rationed);

// Whether the dock the ship's at keeps her tank up: it sells water, has some, and the purse or the slate can pay.
const dockKeepsUp = (game, place) => place === SHIP && dockSends(game, WATER_ITEM) > 0;

const hearsOf = (game, place) => game.location === place || (place === SHIP && (isCaptain(game) || aboardShip(game)));

// The quartermaster's look (src/work.js, with what the stores want): water goes on ration when the tank is under the
// file's mark and no dock is keeping it up, and comes off once it's well over the mark again, or a dock is. Lines for
// the story.
export function rationLook(game, place, model, state, t, by) {
  const w = model.water;
  const tank = tankOf(model);
  if (!tank || !(w.rationUnder > 0)) return [];
  const orders = (state.orders ??= {});
  const was = Boolean(orders.water?.rationed);
  const have = countOf(game, tank);
  // Nothing's asked of the dock unless the answer could change anything. Nobody starts rationing an empty tank.
  const low = was ? have < w.rationUnder * LIFTED_AT : have > 0 && have < w.rationUnder;
  const now = low && !dockKeepsUp(game, place);
  if (now === was) return [];
  const who = upperFirst(calledBy(game, place, by));
  if (now) orders.water = { rationed: true, by, since: t };
  else delete orders.water;
  const text = now
    ? `${who} has put water on ration: ${measures(have)} ${have === 1 ? "is" : "are"} left in the ${tank.name}. Everyone gets half, and so does whatever grows.`
    : `${who} has taken water off ration${have >= w.rationUnder * LIFTED_AT ? `: there are ${measures(have)} in the ${tank.name} again` : ": the dock is keeping the tank up"}.`;
  if (place === SHIP) game.ship?.log?.push({ day: dayLabel(t), tag: "SUPPLY", text });
  return hearsOf(game, place) ? [`[SHIP] ${text}`] : [];
}

// ---- What takes water ------------------------------------------------------------------------------------------------

// A machine whose line says it needs water: why it can't have it, or null. And taking it, for one go.
export function machineWaterWhy(game, place, m) {
  const tank = tankOf(logisticsOf(place));
  if (!tank) return null;
  return countOf(game, tank) >= m.needs.water * lossFactor(game, place) ? null : `the ${tank.name} has no water`;
}
export function takeMachineWater(game, place, m) {
  const tank = tankOf(logisticsOf(place));
  if (!tank) return true;
  const n = m.needs.water * lossFactor(game, place);
  if (countOf(game, tank) < n) return false;
  takeCount(game, tank, n);
  return true;
}
// While water's rationed, what grows goes at half its pace. A kettle is cooked for as before: people have to eat.
export const waterSlows = (game, place, m) => (waterRationed(game, place) && !m.gives?.count ? RATION : 1);

// A machine that uses water up as it runs (the air plant), over one piece of the clock: it has so long on what it
// last took, and when that's gone it takes the next from the tank, or stops until there's some. It starts with one in
// it. Stopped for anything else (no power, switched off, broken), it uses nothing.
export function runUser(game, place, model, m, state, minutes) {
  const s = state.machines[m.id] ??= { progress: 0, made: 0, waiting: null, burning: m.every };
  if (s.burning === undefined) s.burning = m.every;
  if (m.needs.power && !roomPowered(game, place, m.room)) {
    s.waiting = "no power";
    return;
  }
  if (m.airPlant && !plantRuns(game, place)) {
    s.waiting = "stopped";
    return;
  }
  if (s.burning > 0) s.burning -= minutes * lossFactor(game, place);
  if (s.burning > 0) {
    s.waiting = null;
    return;
  }
  const from = storeById(model, m.from);
  const n = m.takes[0].n;
  if (countOf(game, from) < n) {
    s.burning = 0;
    s.waiting = `the ${from.name} has no water`;
    return;
  }
  takeCount(game, from, n);
  s.burning += m.every;
  s.made += 1;
  s.waiting = null;
}

// Whether a place's air plant is running, as far as its own parts and its power go (src/systems.js). Asked for every
// piece of the clock, so it's kept until something it hangs on changes: what the generator gives, whether the ship's
// under way, a part switched or broken, or a feed cut.
const plantKept = new WeakMap();
function plantRuns(game, place) {
  const state = game.systems?.[place];
  let sig = `${powerSupply(game, place)}|${place === SHIP && game.ship?.underWay ? 1 : 0}|`;
  if (state) {
    for (const id in state.parts) {
      const one = state.parts[id];
      sig += `${id}${one.on === false ? "-" : "+"}${one.damage ? "x" : ""},`;
    }
    if (state.cut) for (const room in state.cut) sig += `/${room}`;
  }
  const model = systemsOf(place);
  let mine = plantKept.get(game);
  if (!mine) plantKept.set(game, (mine = new Map()));
  const kept = mine.get(place);
  if (kept && kept.sig === sig && kept.model === model) return kept.on;
  const on = plantOn(game, place, model);
  mine.set(place, { sig, model, on });
  return on;
}

// Whether a place's air plant has water to make air from: always, where no machine in its logistics file is one.
export function plantFed(game, place) {
  const id = logisticsOf(place)?.water?.plant;
  if (!id) return true;
  const burning = game.logistics?.[place]?.machines?.[id]?.burning;
  return burning === undefined || burning > 0;
}
// What a look at an air plant says while it runs with no water: null while it has some, or takes none.
export function plantDry(game, place) {
  if (plantFed(game, place)) return null;
  const tank = tankOf(logisticsOf(place));
  return `Its fans are turning over nothing: there's no water in the ${tank?.name ?? "tank"} for it to make air from.`;
}

// So many minutes of reserve air made by the air plant, as it fills the reserve again: it takes water, and gives back
// how many of those minutes there was water for. All of them where the file gives no price in water.
export function reserveFills(game, place, minutes) {
  const model = logisticsOf(place);
  const w = model?.water;
  const tank = tankOf(model);
  const state = stateOf(game, place);
  if (!w?.reserve || !tank || !(w.airTakes > 0) || !state) return minutes;
  const s = waterState(state);
  const owed = (s.air ?? 0) + (minutes / 1440) * w.airTakes * lossFactor(game, place);
  const whole = Math.floor(owed);
  if (!whole) {
    if (countOf(game, tank) <= 0) return 0;
    s.air = owed;
    return minutes;
  }
  const took = takeCount(game, tank, whole);
  if (took < whole) {
    delete s.air;
    return minutes * (took / whole);
  }
  s.air = owed - whole;
  return minutes;
}

// ---- The clock --------------------------------------------------------------------------------------------------------

// One piece of the clock: everyone drinks, the tank says when it's run dry and when there's water again, the pumps
// say when they stop, and a room that was breached is filled again once it's patched.
export function runWater(game, place, model, state, t, minutes, notes) {
  const w = model.water;
  const tank = tankOf(model);
  const say = (text, tag = "SUPPLY") => {
    if (place === SHIP) game.ship?.log?.push({ day: dayLabel(t), tag, text });
    if (hearsOf(game, place)) notes.push(`[SHIP] ${text}`);
  };
  if (!state.water) {
    // A game from before the ship kept her water is told once how it goes now.
    state.water = newWater();
    const reserve = reserveOf(model);
    if (place === SHIP && tank) say(`From now on the ship keeps her water in the ${tank.name} in ${tank.roomName}: ${measures(countOf(game, tank))}, which everyone aboard drinks from, and the galley, the Garden and the air plant use. It's filled at a dock out of the ship's purse, like her crates and cells, and in open space nothing comes.${reserve ? ` Her reserve air is in the ${reserve.name} in ${reserve.roomName}.` : ""} The Ship menu has both.`);
  }
  const s = state.water;
  if (tank) {
    const factor = lossFactor(game, place);
    // Everyone she started with drinks what the file says; fewer aboard drink less.
    const start = SHIP_DATA.ship?.aboard || 1;
    const share = place === SHIP ? (game.ship?.aboard ?? start) / start : 1;
    s.carry = (s.carry ?? 0) + (w.drinks * share * (waterRationed(game, place) ? RATION : 1) * factor * minutes) / 1440;
    if (s.carry >= 1) {
      const whole = Math.floor(s.carry);
      s.carry -= whole;
      takeCount(game, tank, whole);
    }
    const have = countOf(game, tank);
    if (have <= 0 && !s.dry) {
      s.dry = t;
      say(`The ${tank.name} is empty. The galley can't cook and nothing grows, and when the air plant has used what it had, it stops. ${place === SHIP && !game.ship?.at ? "In open space nothing comes." : "A port that has water sells it."}`);
    } else if (have > 0 && s.dry) {
      delete s.dry;
      say(`There's water in the ${tank.name} again.`);
    }
    const stopped = factor > 1;
    if (stopped && !s.pumps) {
      s.pumps = t;
      say(`The pumps have stopped, and nothing that's used is coming back: the water's going ${w.pumpsStopped} times as fast.`, "SHIP");
    } else if (!stopped && s.pumps) {
      delete s.pumps;
      say("The pumps are running again.", "SHIP");
    }
  }
  if (w.reserve) fillBreaches(game, place, w, s, t, notes);
}

// A room that was breached is filled again once the hull's patched: out of the reserve tanks at once, while they have
// the air for it, and by the air plant alone over some hours when they haven't. Until then its air stays bad.
function fillBreaches(game, place, w, s, t, notes) {
  let any = false;
  for (const key in game.emergencies?.breaches) {
    any = true;
    break;
  }
  if (!any && !s.breached && !s.filling) return;
  const hears = hearsOf(game, place);
  const open = new Set(Object.values(game.emergencies?.breaches ?? {}).filter((one) => one.place === place).map((one) => one.room));
  for (const room of open) (s.breached ??= {})[room] = true;
  for (const room of Object.keys(s.breached ?? {})) {
    if (open.has(room)) continue;
    delete s.breached[room];
    const want = w.breachAir * 60;
    if (!(want > 0)) continue;
    if (reserveLeft(game, place) >= want) {
      useReserve(game, place, want, t / 60);
      if (hears) notes.push(`[AIR] ${upperFirst(roomName(place, room))} is filled again out of the reserve tanks: ${w.breachAir} hours of their air went into it.`);
    } else if (w.breachSlow > 0) {
      (s.filling ??= {})[room] = t + w.breachSlow * 60;
      if (hears) notes.push(`[AIR] There isn't the reserve air to fill ${roomName(place, room)} again: the air plant will take about ${w.breachSlow} hours over it.`);
    }
  }
  for (const [room, until] of Object.entries(s.filling ?? {})) {
    if (t < until && !open.has(room)) continue;
    delete s.filling[room];
    if (!open.has(room) && hears) notes.push(`[AIR] ${upperFirst(roomName(place, room))} has air again.`);
  }
  if (s.breached && !Object.keys(s.breached).length) delete s.breached;
  if (s.filling && !Object.keys(s.filling).length) delete s.filling;
}
// A room being filled the slow way has no air to breathe yet.
addAirSpoiler((game, place, room) => Boolean(game.logistics?.[place]?.water?.filling?.[room]));

// ---- What the Ship menu shows ------------------------------------------------------------------------------------------

// What a place's water comes to in a day, as things stand now: what everyone drinks, what the air plant uses while it
// runs, and what the machines that need water take while they have power, each at work for so much of a day; several
// times as much with the pumps stopped.
function waterADay(game, place, model = logisticsOf(place)) {
  const w = model?.water;
  if (!w?.tank) return 0;
  const start = SHIP_DATA.ship?.aboard || 1;
  const share = place === SHIP ? (game.ship?.aboard ?? start) / start : 1;
  let aDay = w.drinks * share * (waterRationed(game, place) ? RATION : 1);
  for (const m of model.machines) {
    if (m.needs?.power && !roomPowered(game, place, m.room)) continue;
    if (m.user) aDay += m.airPlant && !plantOn(game, place) ? 0 : (m.takes[0].n * 1440) / m.every;
    else if (m.needs?.water) aDay += ((m.needs.water * 1440) / m.every) * AT_WORK * waterSlows(game, place, m);
  }
  return aDay * lossFactor(game, place);
}

// The ship's water for her Stores list: how many measures, how long they last, whether a dock is keeping it up, and
// whether it's rationed or the pumps have stopped. Null where she has no tank. Reading it changes nothing.
export function waterView(game) {
  const model = logisticsOf(SHIP);
  const w = model?.water;
  const tank = tankOf(model);
  if (!tank) return null;
  const n = countOf(game, tank);
  const aDay = waterADay(game, SHIP, model);
  const order = stateOf(game, SHIP)?.orders?.water ?? null;
  return {
    name: tank.name,
    room: tank.roomName,
    n,
    of: tank.count.n,
    aDay: round1(aDay),
    days: aDay > 0 ? Math.floor(n / aDay) : null,
    holding: dockKeepsUp(game, SHIP),
    rationed: Boolean(order?.rationed),
    by: order?.rationed && order.by ? upperFirst(calledBy(game, SHIP, order.by)) : null,
    under: w.rationUnder,
    pumps: pumpsStopped(game, SHIP) ? w.pumpsStopped : null,
    fills: w.tankFills,
    plant: w.plant ? plantFed(game, SHIP) : null,
  };
}

// Each midnight: said once when the ship's water is down to a few days with no dock keeping it up, as her fuel cells
// are, and forgotten once she's well stocked again.
addDayWork((game) => {
  const ship = game.ship;
  const w = ship ? waterView(game) : null;
  if (!w) return [];
  const warned = (ship.warned ??= {});
  const warnAt = SHIP_DATA.rules?.warnAtDays ?? 5;
  if (w.holding || w.days === null || w.days > warnAt + 3) delete warned.water;
  if (!(w.n > 0) || w.holding || w.days === null || w.days > warnAt || warned.water) return [];
  warned.water = true;
  const text = `Water is down to about ${Math.max(1, w.days)} ${w.days <= 1 ? "day" : "days"}: ${measures(w.n)} in the ${w.name}${w.pumps ? ", going fast with the pumps stopped" : ""}. It's bought by the tank at a port that has some; ${ship.at ? "nobody here sells it" : "in open space nothing comes"}.`;
  ship.log?.push({ day: dayLabel((game.clock?.hours ?? 0) * 60), tag: "SUPPLY", text });
  return hearsOf(game, SHIP) ? [`[SUPPLY] ${text}`] : [];
});

// The ship's tank filled to the top, for a test save that isn't to run out of anything (src/test-mode.js).
export function fillTank(game) {
  const tank = tankOf(logisticsOf(SHIP));
  if (tank && countOf(game, tank) < tank.count.n) setCount(game, tank, tank.count.n);
}

// A word for the Work page beside a place's water tank or its reserve tanks: what's going on with it, if anything.
export function countNote(game, place, store) {
  const w = waterOf(place);
  if (!w) return "";
  if (store.id === w.tank) return [waterRationed(game, place) ? "rationed" : null, pumpsStopped(game, place) ? "the pumps are stopped" : null].filter(Boolean).join(", ");
  if (store.id !== w.reserve) return "";
  const left = reserveLeft(game, place);
  if (!(plantOn(game, place) && plantFed(game, place))) return left > 0 ? "being breathed" : "gone";
  return left < reserveAllOf(place) ? "filling again" : "";
}

// Her reserve air, for the same list: how many hours are in the tanks, of how many, and whether she's breathing them.
export function airView(game) {
  const model = logisticsOf(SHIP);
  const store = reserveOf(model);
  if (!store) return null;
  const all = reserveAllOf(SHIP);
  const left = reserveLeft(game, SHIP);
  const stopped = !(plantOn(game, SHIP) && plantFed(game, SHIP));
  return {
    name: store.name,
    room: store.roomName,
    hours: Math.floor(left / 60 + 1e-6),
    of: Math.round(all / 60),
    breathing: stopped && left > 0,
    out: left <= 0,
    full: left >= all,
    stopped,
    dry: !plantFed(game, SHIP),
    tank: model.water.tankAir,
  };
}

// So many tanks of water brought aboard from outside, as the answer to a distress call brings them: as many as there's
// room for go into her tank. Says how many.
export function bringWater(game, tanks) {
  const model = logisticsOf(SHIP);
  const tank = tankOf(model);
  const per = model?.water?.tankFills;
  if (!tank || !(per > 0) || !(tanks > 0)) return 0;
  const have = countOf(game, tank);
  const n = Math.max(0, Math.min(Math.floor(tanks), Math.floor((tank.count.n - have) / per)));
  if (n > 0) setCount(game, tank, have + n * per);
  return n;
}

// ---- By hand -----------------------------------------------------------------------------------------------------------

// A tank of water carried to the water tank can be poured in, and a full reserve tank fitted to the reserve. Each is
// offered at its tank whether or not there's one in the pack, greyed with why not, so that the tank's window says
// what can be done there.
addThingActs((game, thing) => {
  if (!thing?.store) return null;
  const model = logisticsOf(game.location);
  const w = model?.water;
  if (!w) return null;
  if (thing.store === w.tank && w.tankFills > 0) {
    const tank = tankOf(model);
    const why = !(game.inventory?.[WATER_ITEM] > 0) ? "you aren't carrying one" : tank.count.n - countOf(game, tank) < w.tankFills ? "there isn't the room in it" : null;
    return { does: [{ id: "pour-water", label: `Pour in a ${ITEMS[WATER_ITEM].name.toLowerCase()}`, detail: why ?? measures(w.tankFills), ...(why ? { disabled: true } : {}) }] };
  }
  if (thing.store === w.reserve && w.tankAir > 0) {
    const why = !(game.inventory?.[AIR_ITEM] > 0) ? "you aren't carrying one" : reserveLeft(game, game.location) >= reserveAllOf(game.location) ? "they're full" : null;
    return { does: [{ id: "fit-reserve-tank", label: "Fit a full reserve tank", detail: why ?? `${w.tankAir} hours of air`, ...(why ? { disabled: true } : {}) }] };
  }
  return null;
});

addOrder("pour-water", (game) => {
  const model = logisticsOf(game.location);
  const w = model?.water;
  const tank = tankOf(model);
  if (!tank || !(w.tankFills > 0)) throw new Error("There's no tank here to pour it into.");
  if (!(game.inventory?.[WATER_ITEM] > 0)) throw new Error("You've no water to pour in.");
  const have = countOf(game, tank);
  if (tank.count.n - have < w.tankFills) throw new Error(`There isn't the room in the ${tank.name} for another.`);
  removeItem(game, WATER_ITEM, 1);
  setCount(game, tank, have + w.tankFills);
  return { said: `You pour the ${ITEMS[WATER_ITEM].name.toLowerCase()} into the ${tank.name}: ${have + w.tankFills} of ${tank.count.n} measures in it now.` };
});

addOrder("fit-reserve-tank", (game) => {
  const place = game.location;
  const w = logisticsOf(place)?.water;
  if (!w?.reserve || !(w.tankAir > 0)) throw new Error("There's nowhere here to fit it.");
  if (!(game.inventory?.[AIR_ITEM] > 0)) throw new Error("You've no full tank to fit.");
  if (reserveLeft(game, place) >= reserveAllOf(place)) throw new Error("The reserve tanks are full.");
  removeItem(game, AIR_ITEM, 1);
  giveReserve(game, place, w.tankAir * 60);
  return { said: `You fit the full tank in place of an empty one. The reserve air stands at ${Math.floor(reserveLeft(game, place) / 60 + 1e-6)} of ${Math.round(reserveAllOf(place) / 60)} hours.` };
});
