// Freight that's real (the logistics rework, step 9). Since the ports hold real amounts, what the Meridian carries
// between them is real too:
//
// - Every good a hold can carry is an item (a sack of meal, a load of ore: world/goods names each good's item, and
//   world/items has it), and the ship has a freight hold, a store whose line in world/logistics says "holds freight".
//   Whatever she carries rides there as things, and it's opened like any store.
// - Freight for hire. While she's docked at a port with a file, the port offers what it can spare of a good to a port
//   the captain knows of that's running low on it. Taken, the load leaves this port's stores and goes into the hold;
//   when she docks where it's going it goes into that port's stores, and the fee is paid into the purse. The fee is
//   by the squares of the hold it takes and the fuel the trip takes, times how badly it's wanted there. Late pays
//   half, and only what's still in the hold is paid for.
// - Her own account. She can buy any good the port holds by the load, out of the purse, and sell what's her own in
//   the hold wherever a port holds that good. Each one bought or sold moves the port's amount, and so its price.
// - The Market's list of where each good is cheap and where it's dear, among the ports the captain knows of.
//
// src/ship.js takes the captain's orders (freight-take, freight-buy, freight-sell) and shows freightView; the clock
// unloads what's arrived. world/trade.txt has the freight line.

import { addClockWork } from "./room-hooks.js";
import { gridPut, gridRoom, gridSquares, sizeOf, stackOf, storeCounts, storeTake } from "./bag.js";
import { goodFactor, holderOf, knownPlace, levelName, scarcityOf } from "./daily.js";
import { FACTIONS, ITEMS, LOCATIONS } from "./data.js";
import { logisticsOf } from "./logistics.js";
import { amountOf, counted, hasPort, levelOf, portTake, portsModel } from "./ports.js";
import { aboardShip, isCaptain } from "./role.js";
import { priceEdge } from "./rules.js";
import { jumpCost } from "./ship.js";
import { addToPurse, purseOf, tradeRules, unitPrice } from "./trade.js";
import { STAR_MAP } from "./world.js";

const SHIP = "meridian";
// A port offers what it has over this many hundredths of what it usually holds, and only while it has at least so
// many; another port is offered it while it's under so many, or, if it makes the good itself, only once it's short.
// The marks don't overlap, so nothing is carried to a port and offered back from it the next day.
const KEEPS = 85;
const SPARES_FROM = 95;
const WANTED_UNDER = 90;
const SHORT_UNDER = 80;
// The most squares of the hold one offer takes, and the least fee anyone hires a frigate for.
const MOST_SQUARES = 12;
const LEAST_FEE = 25;
// How many are bought or sold at a click, at the most.
const MOST_AT_ONCE = 60;

const dayOf = (game) => Math.floor((game.clock?.hours ?? 0) / 24);
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const nameOf = (place) => (LOCATIONS[place]?.name ?? place).replace(/^The /, "the ");
const upper = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const rulesOf = () => tradeRules()?.freight ?? null;

// ---- The hold -------------------------------------------------------------------------------------------

// The ship's freight hold: the store of hers whose line says it holds freight.
export const holdOf = () => logisticsOf(SHIP)?.stores.find((one) => one.freight) ?? null;
// What's in it, by item.
const inHold = (game) => {
  const hold = holdOf();
  return hold ? storeCounts(game, hold.key, hold.holds) : {};
};
// The loads she's carrying for a fee, as freight (a save from before kept a count of crates and no more: those are
// src/trade.js's to unload).
const carried = (game) => (game.ship?.cargo ?? []).filter((one) => one.item);
const consigned = (game, item) => carried(game).filter((one) => one.item === item).reduce((sum, one) => sum + one.n, 0);
// What's hers to sell of an item: what's in the hold beyond what she's carrying for someone.
const ownOf = (game, item) => Math.max(0, (inHold(game)[item] ?? 0) - consigned(game, item));
// How many squares so many of an item take.
const squaresFor = (item, n) => Math.ceil(n / stackOf(ITEMS[item])) * sizeOf(ITEMS[item]).w * sizeOf(ITEMS[item]).h;

// ---- What things cost --------------------------------------------------------------------------------------

// The goods a hold can carry: the ones with an item.
const freightGoods = (model = portsModel()) => model.order.filter((good) => model.goods[good].item);
// What one of a good costs at a port today, before anyone's haggling: where the port sells that supply to ships it's
// the star map's price (and the trade file's for what a dock restocks), and otherwise the price of the good's own
// item; times how much the port has of it and what it thinks of her. Nothing where the port doesn't hold it.
export function goodPrice(game, port, good) {
  const model = portsModel();
  const g = model.goods[good];
  if (!g?.item || !model.ports[port]?.holds[good]) return null;
  const restocked = unitPrice(game, port, g.item);
  if (restocked !== null) return restocked;
  const supply = model.supplyOf[good];
  const base = (supply && STAR_MAP.places?.[port]?.trade?.[supply]) || ITEMS[g.item].price || 1;
  return Math.max(1, base * goodFactor(game, port, good));
}
// What the ship pays for one, and what she's paid for one: the captain's own way with a price counts, and selling
// pays half of what buying costs, as everywhere.
const buysAt = (game, port, good) => Math.max(1, Math.ceil(goodPrice(game, port, good) * (1 - priceEdge(game))));
const sellsAt = (game, port, good) => Math.max(0, Math.floor(goodPrice(game, port, good) * (0.5 + priceEdge(game))));

// ---- Freight for hire ---------------------------------------------------------------------------------------

// What the port she's docked at offers today: the loads it can spare for ports the captain knows of that are running
// low, the best paid first. Reading it changes nothing; an offer taken isn't made again that day.
export function freightOffers(game) {
  const rules = rulesOf();
  const ship = game.ship;
  const from = ship?.at;
  const hold = holdOf();
  if (!rules || !hold || !isCaptain(game) || !from || !hasPort(from)) return [];
  const model = portsModel();
  const day = dayOf(game);
  const taken = new Set(ship.taken ?? []);
  const offers = [];
  for (const good of freightGoods(model)) {
    const here = model.ports[from].holds[good];
    if (!here) continue;
    const level = levelOf(game.world, from, good, model);
    const spare = Math.floor(((level - KEEPS) / 100) * here.usual);
    if (level < SPARES_FROM || spare < 1) continue;
    const item = model.goods[good].item;
    // As many as twelve squares of the hold take: by the stack, and fewer of a thing that's more than one square big.
    const most = Math.max(1, Math.floor(MOST_SQUARES / (sizeOf(ITEMS[item]).w * sizeOf(ITEMS[item]).h))) * stackOf(ITEMS[item]);
    for (const to of Object.keys(model.ports)) {
      const there = model.ports[to].holds[good];
      if (to === from || !there || !knownPlace(game, to)) continue;
      const wanted = levelOf(game.world, to, good, model);
      if (wanted >= WANTED_UNDER) continue;
      // Nothing's carried back to where this port gets it from, and a port that makes its own only sends for it once
      // it's really short.
      if (here.from?.includes(to) || (model.ports[to].made?.[good] > 0 && wanted >= SHORT_UNDER)) continue;
      const id = `${day}:${from}:${good}:${to}`;
      if (taken.has(id)) continue;
      const missing = Math.ceil(((100 - wanted) / 100) * there.usual);
      const n = Math.min(spare, missing, most);
      if (n < 1) continue;
      const squares = squaresFor(item, n);
      const fuel = Math.max(1, jumpCost(game, to).fuel ?? 1);
      const fee = Math.round(rules.rate * squares * fuel * scarcityOf(game, to, good));
      if (fee < LEAST_FEE) continue;
      offers.push({ id, good, item, from, to, n, squares, fuel, fee, days: rules.days, level: levelName(wanted) });
    }
  }
  // The best paid first, and one load to a port: nobody splits a ship's hold between rival buyers on one dock.
  offers.sort((a, b) => b.fee - a.fee || a.id.localeCompare(b.id));
  const kept = [];
  for (const one of offers) {
    if (kept.length >= rules.offers) break;
    if (kept.some((other) => other.to === one.to || other.good === one.good)) continue;
    kept.push(one);
  }
  return kept;
}

function takeFreight(game, id) {
  const offer = freightOffers(game).find((one) => one.id === String(id ?? ""));
  if (!offer) throw new Error("That load's gone.");
  const hold = holdOf();
  const model = portsModel();
  const good = model.goods[offer.good];
  const room = gridRoom(game, hold.key, offer.item);
  if (room < offer.n) throw new Error(`There isn't the room in the ${hold.name} for ${counted(good, offer.n)}: there's room for ${room}.`);
  // It leaves this port's stores as it's loaded.
  portTake(game.world, offer.from, offer.good, offer.n);
  gridPut(game, hold.key, offer.item, offer.n);
  const ship = game.ship;
  ship.cargo = [...(ship.cargo ?? []), { id: offer.id, good: offer.good, item: offer.item, from: offer.from, to: offer.to, n: offer.n, fee: offer.fee, by: dayOf(game) + offer.days }];
  ship.taken = [...(ship.taken ?? []), offer.id].slice(-40);
  const message = `${upper(counted(good, offer.n))} for ${nameOf(offer.to)} ${offer.n === 1 ? "is" : "are"} craned into the ${hold.name}: ${offer.fee} credits when ${offer.n === 1 ? "it gets" : "they get"} there, within ${offer.days} days.`;
  return { message, notes: [`[TRADE] ${message}`] };
}

// The clock: a load for the port she's docked at is unloaded into that port's stores and paid for.
addClockWork((game) => {
  const ship = game.ship;
  const hold = holdOf();
  if (!ship?.at || !hold || !carried(game).some((one) => one.to === ship.at)) return [];
  const model = portsModel();
  const lines = [];
  const stays = [];
  for (const one of ship.cargo) {
    if (!one.item || one.to !== ship.at) {
      stays.push(one);
      continue;
    }
    const good = model.goods[one.good];
    const got = storeTake(game, hold.key, hold.holds, one.item, one.n);
    if (got > 0 && good) portTake(game.world, one.to, one.good, -got);
    const late = dayOf(game) > one.by;
    const fee = Math.round(one.fee * (got / one.n) * (late ? 0.5 : 1));
    if (fee) addToPurse(game, fee);
    // What isn't there isn't paid for, and whoever was waiting for it thinks the less of her.
    const short = one.n - got;
    if (short > 0) {
      const holder = holderOf(game, one.to);
      if (FACTIONS[holder] && game.factions) game.factions[holder] = clamp((game.factions[holder] ?? 0) - 1, -100, 100);
    }
    const what = good ? counted(good, one.n) : `${one.n} loads`;
    const told = `${upper(what)} for ${nameOf(one.to)} ${one.n === 1 ? "is" : "are"} unloaded${short > 0 ? `, ${short} short` : ""}${late ? ", late: half the fee" : ""}. ${fee} credits into the ship's purse.`;
    ship.log?.push({ day: `Day ${dayOf(game) + 1}`, tag: "TRADE", text: told });
    if (aboardShip(game) || isCaptain(game)) lines.push(`[TRADE] ${told}`);
  }
  ship.cargo = stays;
  return lines;
});

// ---- Her own account ----------------------------------------------------------------------------------------

// The good the captain means: by its id, where the port she's docked at holds it and a hold can carry it.
function goodHere(game, id) {
  const ship = game.ship;
  const model = portsModel();
  const good = model.goods[String(id ?? "")];
  if (!rulesOf() || !holdOf()) throw new Error("She has no hold for freight.");
  if (!ship?.at || !hasPort(ship.at)) throw new Error("She has to be docked at a port to deal in its goods.");
  if (!good?.item || !model.ports[ship.at].holds[good.id]) throw new Error(`Nobody at ${nameOf(ship.at)} deals in that.`);
  return good;
}
const howMany = (n) => clamp(Math.floor(Number(n)) || 1, 1, MOST_AT_ONCE);

// Buys so many of a good for the hold, one at a time, each at the price the last one left: out of the purse, and
// never on the slate, since nobody needs a cargo.
function buyFreight(game, id, n) {
  const good = goodHere(game, id);
  const ship = game.ship;
  const hold = holdOf();
  let bought = 0;
  let spent = 0;
  let why = null;
  for (let i = 0; i < howMany(n); i += 1) {
    if (amountOf(game.world, ship.at, good.id) < 1) why = `${nameOf(ship.at)} has no more to sell`;
    else if (gridRoom(game, hold.key, good.item) < 1) why = `the ${hold.name} is full`;
    else {
      const price = buysAt(game, ship.at, good.id);
      if (Math.floor(purseOf(game)) < price) why = `the purse holds ${Math.floor(purseOf(game))} credits and the next costs ${price}`;
      else {
        portTake(game.world, ship.at, good.id, 1);
        gridPut(game, hold.key, good.item, 1);
        addToPurse(game, -price);
        bought += 1;
        spent += price;
        continue;
      }
    }
    break;
  }
  if (!bought) throw new Error(`Nothing bought: ${why}.`);
  const message = `Bought ${counted(good, bought)} at ${nameOf(ship.at)} for ${spent} credits, into the ${hold.name}.${why ? ` No more: ${why}.` : ""}`;
  return { message, notes: [`[TRADE] ${message}`] };
}

// Sells so many of what's hers in the hold, one at a time, into the port's stores and the purse.
function sellFreight(game, id, n) {
  const good = goodHere(game, id);
  const ship = game.ship;
  const hold = holdOf();
  const own = ownOf(game, good.item);
  if (own < 1) throw new Error(consigned(game, good.item) ? `What's in the ${hold.name} of that is carried for someone else.` : `There's none of that in the ${hold.name}.`);
  let sold = 0;
  let got = 0;
  for (let i = 0; i < Math.min(howMany(n), own); i += 1) {
    const price = sellsAt(game, ship.at, good.id);
    if (storeTake(game, hold.key, hold.holds, good.item, 1) < 1) break;
    portTake(game.world, ship.at, good.id, -1);
    addToPurse(game, price);
    sold += 1;
    got += price;
  }
  const message = `Sold ${counted(good, sold)} at ${nameOf(ship.at)} for ${got} credits, out of the ${hold.name}.`;
  return { message, notes: [`[TRADE] ${message}`] };
}

// The captain's orders, from src/ship.js.
export function freightCommand(game, body) {
  switch (body.action) {
    case "freight-take": return takeFreight(game, body.id);
    case "freight-buy": return buyFreight(game, body.id, body.n);
    case "freight-sell": return sellFreight(game, body.id, body.n);
    default: throw new Error("Unknown order.");
  }
}

// ---- What the Market shows ----------------------------------------------------------------------------------

// Where each good is cheapest and dearest today, among the ports the captain knows of that hold it.
function priceList(game) {
  const model = portsModel();
  const ports = Object.keys(model.ports).filter((id) => knownPlace(game, id));
  const here = game.ship?.at && hasPort(game.ship.at) ? game.ship.at : null;
  const list = [];
  for (const good of freightGoods(model)) {
    const at = ports.filter((port) => model.ports[port].holds[good]).map((port) => ({ port, price: buysAt(game, port, good) }));
    if (at.length < 2) continue;
    at.sort((a, b) => a.price - b.price || a.port.localeCompare(b.port));
    const cheap = at[0];
    const dear = at.at(-1);
    if (dear.price <= cheap.price) continue;
    const g = model.goods[good];
    list.push({
      good,
      name: ITEMS[g.item].name,
      tree: model.trees[g.tree].name,
      cheap: { place: cheap.port, name: LOCATIONS[cheap.port].name, price: cheap.price },
      dear: { place: dear.port, name: LOCATIONS[dear.port].name, price: dear.price },
      here: here && model.ports[here].holds[good] ? buysAt(game, here, good) : null,
    });
  }
  return list;
}

// Everything the Market's freight sections show, for the captain: the hold, what she's carrying and for whom, what's
// offered here, this port's goods to buy and sell by the load, and where things are cheap and dear. Reading it
// changes nothing.
export function freightView(game) {
  const hold = holdOf();
  if (!rulesOf() || !hold || !isCaptain(game) || !game.ship) return null;
  const model = portsModel();
  const ship = game.ship;
  const at = ship.at && hasPort(ship.at) ? ship.at : null;
  const counts = inHold(game);
  const day = dayOf(game);
  const words = (good, n) => counted(model.goods[good], n);
  const goodOf = (item) => freightGoods(model).find((good) => model.goods[good].item === item) ?? null;
  return {
    purse: Math.floor(purseOf(game)),
    at: at ? { id: at, name: LOCATIONS[at].name } : null,
    hold: {
      name: hold.name,
      room: hold.roomName,
      squares: gridSquares(game, hold.key),
      // What's in it, a line a thing: how many, how many of them are carried for someone, and how many are hers.
      lines: Object.entries(counts).filter(([, n]) => n > 0).map(([item, n]) => ({ item, name: ITEMS[item]?.name ?? item, n, own: ownOf(game, item), good: goodOf(item) })),
    },
    carrying: carried(game).map((one) => ({ id: one.id, what: words(one.good, one.n), to: LOCATIONS[one.to]?.name ?? one.to, fee: one.fee, by: one.by + 1, late: day > one.by, here: one.to === ship.at })),
    offers: freightOffers(game).map((one) => ({
      id: one.id,
      what: words(one.good, one.n),
      to: LOCATIONS[one.to].name,
      level: one.level,
      fee: one.fee,
      days: one.days,
      squares: one.squares,
      fits: gridRoom(game, hold.key, one.item) >= one.n,
    })),
    // This port's goods, to buy and sell by the load.
    goods: at ? freightGoods(model).filter((good) => model.ports[at].holds[good]).map((good) => {
      const g = model.goods[good];
      const has = Math.floor(amountOf(game.world, at, good));
      return {
        good,
        name: ITEMS[g.item].name,
        tree: model.trees[g.tree].name,
        has,
        level: levelName(levelOf(game.world, at, good, model)),
        buy: buysAt(game, at, good),
        sell: sellsAt(game, at, good),
        own: ownOf(game, g.item),
        room: gridRoom(game, hold.key, g.item),
      };
    }) : [],
    prices: priceList(game),
  };
}
