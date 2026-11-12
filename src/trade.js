// Real trade (the hands-on plan, step 6), from world/trade.txt. Three things for the Meridian's captain:
//
// - Restocking from the dock, a switch thrown in the Lighter Bay. While it's on, the shuttle stores no longer fill
//   from nothing: at a dock, every few hours, what's missing is bought from the port out of the ship's purse, at the
//   port's own price that day, and the port has that much less. In open space, nothing comes. It's off unless the
//   captain turns it on, because it changes how the whole ship is fed.
// - The purse: the ship's own money, apart from the player's, with a levy every day.
// - Cargo and passengers, offered at a port while the ship is docked there and the captain's ashore: crates or people
//   for another port on the chart, paid into the purse on arrival. Passengers eat at the sittings on the way.
//
// It registers itself with src/room-hooks.js; nothing else in the game calls it.

import fs from "node:fs";
import path from "node:path";
import { addChecker, addClockWork, addDayWork, addOrder, addRefillHold, addRoomActs } from "./room-hooks.js";
import { storeCounts, storePut } from "./bag.js";
import { seeded } from "./body.js";
import { noneLeft, supplyFactor, tradedAt } from "./daily.js";
import { ITEMS, LOCATIONS } from "./data.js";
import { logisticsOf } from "./logistics.js";
import { worldDir } from "./paths.js";
import { isCaptain } from "./role.js";
import { STAR_MAP } from "./world.js";

export const TRADE_FILE = process.env.GAME_TRADE_FILE ?? path.join(worldDir, "trade.txt");
const SHIP = "meridian";
// What a crate in the shuttle stores is, at a port's market.
const GOODS = { ration_crate: "food", fuel_cell: "fuel" };
// A port's stock goes down a step for every so many crates bought there.
const CRATES_A_LOT = 5;

const nowOf = (game) => game.clock?.hours ?? 0;
const dayOf = (game) => Math.floor(nowOf(game) / 24);
// A place's name as it reads in the middle of a line: "for the Graveyard".
const nameOf = (place) => (LOCATIONS[place]?.name ?? place).replace(/^The /, "the ");
const counted = (item, n) => {
  const name = (ITEMS[item]?.name ?? item).toLowerCase();
  return `${n} ${name}${n === 1 || /s$/.test(name) ? "" : "s"}`;
};

// ---- The file -----------------------------------------------------------------------------------------

const LINES = {
  "the purse": [/^(\d+) to begin with, (\d+) a day$/i, (f) => ({ start: Number(f[1]), aDay: Number(f[2]) }), "600 to begin with, 60 a day"],
  restocking: [/^every (\d+) hours at a dock$/i, (f) => ({ every: Number(f[1]) }), "every 6 hours at a dock"],
  "a ration crate": [/^([\d.]+) times the port's food price$/i, (f) => ({ times: Number(f[1]) }), "2 times the port's food price"],
  "a fuel cell": [/^([\d.]+) times the port's fuel price$/i, (f) => ({ times: Number(f[1]) }), "0.5 times the port's fuel price"],
  cargo: [/^(\d+) offers a port, (\d+) to (\d+) crates, (\d+) credits a crate, (\d+) days to deliver, (\d+) crates in the hold$/i, (f) => ({ offers: Number(f[1]), least: Number(f[2]), most: Number(f[3]), each: Number(f[4]), days: Number(f[5]), hold: Number(f[6]) }), "2 offers a port, 4 to 10 crates, 15 credits a crate, 10 days to deliver, 20 crates in the hold"],
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

export const purseOf = (game) => game.ship?.purse ?? tradeRules()?.["the purse"].start ?? 0;
// The purse begins the first time it's used, and the levy comes in from then on.
const openPurse = (game) => { if (game.ship && game.ship.purse === undefined) game.ship.purse = purseOf(game); };
const tradeOn = (game) => Boolean(game.ship?.trade) && Boolean(tradeRules());

addDayWork((game) => {
  const rules = tradeRules();
  if (rules && game.ship?.purse !== undefined && isCaptain(game)) game.ship.purse += rules["the purse"].aDay;
  return [];
});

// While the captain has the stores restocked from the dock, nothing comes into them from nowhere.
addRefillHold((game, place) => place === SHIP && tradeOn(game));

// ---- Restocking at a dock -----------------------------------------------------------------------------

const sells = (game, port, good) => Boolean(STAR_MAP.places?.[port]?.trade?.[good]) && !noneLeft(game, port, good);
export function crateprice(game, port, item) {
  const rules = tradeRules();
  const good = GOODS[item];
  const line = item === "ration_crate" ? rules?.["a ration crate"] : item === "fuel_cell" ? rules?.["a fuel cell"] : null;
  if (!line || !good || !sells(game, port, good)) return null;
  return Math.max(1, Math.ceil(STAR_MAP.places[port].trade[good] * line.times * supplyFactor(game, port, good)));
}

function restock(game) {
  const rules = tradeRules();
  const ship = game.ship;
  const every = rules.restocking.every;
  const mark = Math.floor(nowOf(game) / every) * every;
  if (ship.restocked === mark) return [];
  const first = ship.restocked === undefined;
  ship.restocked = mark;
  // The first mark after the switch is thrown only starts the count.
  if (first || !ship.at || !LOCATIONS[ship.at]) return [];
  const model = logisticsOf(SHIP);
  const bought = [];
  let spent = 0;
  for (const refill of model?.refills ?? []) {
    const store = model.stores.find((one) => one.id === refill.store);
    for (const item of refill.items) {
      const price = crateprice(game, ship.at, item);
      if (!price) continue;
      const have = storeCounts(game, store.key, store.holds)[item] ?? 0;
      const want = Math.min((store.holds[item] ?? 0) - have, Math.floor(purseOf(game) / price));
      const put = want > 0 ? storePut(game, store.key, store.holds, item, want) : 0;
      if (put <= 0) continue;
      openPurse(game);
      ship.purse -= put * price;
      spent += put * price;
      for (let i = 0; i < Math.ceil(put / CRATES_A_LOT); i += 1) tradedAt(game, ship.at, GOODS[item]);
      bought.push(counted(item, put));
    }
  }
  if (!bought.length) return [];
  const text = `${bought.join(" and ")} bought at ${nameOf(ship.at)} for ${spent} credits, into the shuttle stores.`;
  const state = game.logistics?.[SHIP];
  if (state) {
    state.refills ??= { log: [] };
    state.refills.log.push({ at: Math.round(nowOf(game) * 60), text });
    if (state.refills.log.length > 20) state.refills.log.splice(0, state.refills.log.length - 20);
  }
  return game.location === SHIP ? [`[TRADE] ${text[0].toUpperCase()}${text.slice(1)} The purse holds ${ship.purse}.`] : [];
}

// ---- Cargo and passengers -----------------------------------------------------------------------------

const cargoAboard = (game) => (game.ship?.cargo ?? []).reduce((sum, one) => sum + one.n, 0);
// The ports a captain's chart shows that have a market, other than this one.
const portsFrom = (place) => Object.entries(STAR_MAP.places ?? {}).filter(([id, spot]) => id !== place && spot.charted && spot.trade && LOCATIONS[id]).map(([id]) => id);

// What a port offers this week: the same all week, and gone once it's taken.
export function offersAt(game, place) {
  const rules = tradeRules();
  // Nothing's offered to someone who's out at a wreck (src/salvage.js): they aren't on the dock to hear it.
  if (!rules || !isCaptain(game) || game.ship?.at !== place || game.location !== place || game.salvage) return { cargo: [], party: null };
  const ports = portsFrom(place);
  if (!ports.length) return { cargo: [], party: null };
  const week = Math.floor(dayOf(game) / 7);
  const roll = seeded(`${game.bodySeed}:trade:${week}:${place}`);
  const between = (least, most) => least + Math.floor(roll() * (most - least + 1));
  const taken = game.ship.taken ?? [];
  const cargo = [];
  for (let i = 0; i < rules.cargo.offers; i += 1) {
    const n = between(rules.cargo.least, rules.cargo.most);
    const offer = { id: `${week}:${place}:${i}`, to: ports[Math.floor(roll() * ports.length)], n, fee: n * rules.cargo.each, days: rules.cargo.days };
    if (!taken.includes(offer.id)) cargo.push(offer);
  }
  const n = between(rules.passengers.least, rules.passengers.most);
  const party = { id: `${week}:${place}:p`, to: ports[Math.floor(roll() * ports.length)], n, fee: n * rules.passengers.each };
  return { cargo, party: taken.includes(party.id) ? null : party };
}

addRoomActs((game, { place, room }) => {
  const rules = tradeRules();
  if (!rules || !isCaptain(game)) return null;
  const acts = [];
  if (place === SHIP && room === logisticsOf(SHIP)?.stores.find((one) => logisticsOf(SHIP).refills.some((r) => r.store === one.id))?.room) {
    acts.push({ id: "trade-switch", label: tradeOn(game) ? "Go back to stores from nowhere" : "Restock from the dock, out of the purse", detail: `the purse holds ${purseOf(game)} credits` });
    for (const one of game.ship.cargo ?? []) acts.push({ id: "trade-carried", key: one.id, label: `Carrying ${one.n} crates for ${nameOf(one.to)}`, detail: `${one.fee} credits, by day ${one.by + 1}`, disabled: true });
    if (game.ship.party) acts.push({ id: "trade-carried", key: "party", label: `Carrying ${game.ship.party.n} passengers to ${nameOf(game.ship.party.to)}`, detail: `${game.ship.party.fee} credits on arrival`, disabled: true });
  }
  const offers = offersAt(game, place);
  for (const one of offers.cargo) {
    const full = cargoAboard(game) + one.n > rules.cargo.hold;
    acts.push({ id: "take-cargo", key: one.id, label: `Take cargo for ${nameOf(one.to)}: ${one.n} crates`, detail: full ? "there's no room in the hold" : `${one.fee} credits on arrival, within ${one.days} days`, ...(full ? { disabled: true } : {}) });
  }
  if (offers.party) {
    const busy = Boolean(game.ship.party);
    acts.push({ id: "take-passengers", key: offers.party.id, label: `Take ${offers.party.n} passengers to ${nameOf(offers.party.to)}`, detail: busy ? "you're carrying a party already" : `${offers.party.fee} credits on arrival; they eat at the sittings`, ...(busy ? { disabled: true } : {}) });
  }
  return acts;
});

addOrder("trade-switch", (game) => {
  if (!tradeRules() || !isCaptain(game)) throw new Error("That's the captain's to decide.");
  openPurse(game);
  game.ship.trade = !game.ship.trade;
  delete game.ship.restocked;
  return { said: game.ship.trade
    ? `[TRADE] From now on the shuttle stores are restocked only at a dock, bought from the port out of the ship's purse (${game.ship.purse} credits). In open space, nothing comes.`
    : "[TRADE] The shuttle stores fill as they did before, from nowhere." };
});

addOrder("take-cargo", (game, body) => {
  const offer = offersAt(game, game.location).cargo.find((one) => one.id === String(body.key ?? ""));
  if (!offer) throw new Error("That cargo's gone.");
  if (cargoAboard(game) + offer.n > tradeRules().cargo.hold) throw new Error("There's no room in the hold for it.");
  openPurse(game);
  game.ship.cargo = [...(game.ship.cargo ?? []), { id: offer.id, to: offer.to, n: offer.n, fee: offer.fee, by: dayOf(game) + offer.days }];
  game.ship.taken = [...(game.ship.taken ?? []), offer.id].slice(-30);
  return { said: `[TRADE] ${offer.n} crates for ${nameOf(offer.to)} go into the Meridian's hold: ${offer.fee} credits when they get there, within ${offer.days} days.` };
});

addOrder("take-passengers", (game, body) => {
  const party = offersAt(game, game.location).party;
  if (!party || party.id !== String(body.key ?? "")) throw new Error("They've found another ship.");
  if (game.ship.party) throw new Error("You're carrying a party already.");
  openPurse(game);
  game.ship.party = { to: party.to, n: party.n, fee: party.fee };
  game.ship.taken = [...(game.ship.taken ?? []), party.id].slice(-30);
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
    for (const one of (ship.cargo ?? []).filter((it) => it.to === ship.at)) {
      const late = dayOf(game) > one.by;
      const fee = late ? Math.floor(one.fee / 2) : one.fee;
      openPurse(game);
      ship.purse += fee;
      lines.push(`[TRADE] The ${one.n} crates for ${nameOf(one.to)} are unloaded${late ? ", late: half the fee" : ""}. ${fee} credits into the ship's purse.`);
    }
    if (ship.cargo?.length) ship.cargo = ship.cargo.filter((it) => it.to !== ship.at);
    if (ship.party?.to === ship.at) {
      openPurse(game);
      ship.purse += ship.party.fee;
      ship.aboard = Math.max(0, ship.aboard - ship.party.n);
      lines.push(`[TRADE] The ${ship.party.n} passengers go ashore at ${nameOf(ship.at)}. ${ship.party.fee} credits into the ship's purse.`);
      ship.party = null;
    }
  }
  if (tradeOn(game)) lines.push(...restock(game));
  return lines;
});
