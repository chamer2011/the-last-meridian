// Ships you can meet (step 13 of the logistics rework). The ports' hauls travel in freighters with names
// (src/lanes.js says which ship carries what, and where it is on its run). This is what the Meridian's captain can
// do about them, docked at the same port as one:
//
// - Hail her: her master says where she's been, where she's bound and what she carries, and what's short and what's
//   plentiful at the far end of her run. A port the captain hadn't heard of goes on the chart.
// - Buy from her hold: part of each thing aboard, one at a time, into the freight hold and out of the purse, at a
//   price halfway between the two ends of her run. What's bought never reaches the port it was bound for.
// - See her safely to her next port: one loading for a dangerous port, or for one where convoys are being lost, pays
//   for company. The fee is paid when she comes in with the Meridian docked there; and where convoys are being lost,
//   the ship she's with arrives.
// - Board her: a fight against her master and a hand or two, beside whoever's walking with the player. It's fought
//   at the Meridian's lock, in the room, where the file names a room for it (the owner's "At the lock", 2026-11-17):
//   the player is taken there, and her crew stand by the hatch. With no room named it's aboard the freighter, in the
//   fight window. Won, what fits in the freight hold is taken, the dearest first, and the port she was bound for
//   goes short of it; either way it costs standing.
//
// And it tells the news: a freighter in with what a port was short of, and one that never arrived.
// The numbers are world/freighters.txt's. Everything is one of the ship's orders (src/ship.js).

import { addChecker, addFightEnd } from "./room-hooks.js";
import { gridPut, gridRoom, sizeOf, stackOf } from "./bag.js";
import { startCombat } from "./combat.js";
import { holderOf, knownPlace, levelName, sideName, tellNews } from "./daily.js";
import { ENEMIES, FACTIONS, ITEMS, LOCATIONS } from "./data.js";
import { goodPrice, holdOf } from "./freight.js";
import { freighterFileProblems, freighterRules, loadsByShip, shipOf, shipSpot, shipState, shipsOn, tellLanes } from "./lanes.js";
import { counted, hasPort, levelOf, losingAt, portsModel } from "./ports.js";
import { recordFact } from "./record.js";
import { isCaptain } from "./role.js";
import { changeStanding, priceEdge, travel } from "./rules.js";
import { shipsJumpCost } from "./ship.js";
import { doorLocked, partWorks, partsOf, systemsOf } from "./systems.js";
import { addToPurse, purseOf } from "./trade.js";
import { canStand, mapFor, roomHere, walkCommand } from "./walk.js";
import { STAR_MAP } from "./world.js";

const SHIP = "meridian";
// A port is short of a thing under this level, and has plenty over that one, for what a master says of it.
const SHORT_UNDER = 70;
const PLENTY_OVER = 125;
// A freighter in with something a port had this little of is news there.
const NEWS_UNDER = 60;
// How many ships the chart's list names: the ones nearest the Meridian's business first.
const MOST_LISTED = 40;

// What the captain did about a freighter goes on the record, the latest of each kind, for a story to ask about
// (src/lanes.js names them for the checker).
function onRecord(game, id, text) {
  try {
    const { entry } = recordFact(game, { id, text, from: "the lanes" });
    entry.text = text;
    entry.day = Math.floor((game.clock?.hours ?? 0) / 24) + 1;
  } catch {
    // A full record: the lanes go on without it.
  }
}
const nameOf = (place) => (LOCATIONS[place]?.name ?? place).replace(/^The /, "the ");
const upper = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const listed = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0] ?? "");
const daysWords = (n) => `${n} ${n === 1 ? "day" : "days"}`;
// The port the Meridian is docked at, where it's one whose amounts are real.
const dockOf = (game) => (game.ship?.at && hasPort(game.ship.at) ? game.ship.at : null);
// Who a ship flies for, in words: whoever held the port she sailed from when she sailed.
const flagOf = (ship) => {
  if (!ship.flies) return `the people of ${nameOf(ship.from)}`;
  const name = sideName(ship.from, ship.flies);
  // A faction whose name has no "The" of its own gets one in a sentence: "flies for the Hegemony".
  return /^the /i.test(name) ? name.replace(/^The /, "the ") : FACTIONS[ship.flies] && name === FACTIONS[ship.flies].name ? `the ${name}` : name;
};
// The Meridian's comms: with none of them working, nobody can be raised.
function commsDown(game) {
  const comms = partsOf(systemsOf(SHIP), "comms");
  return comms.length > 0 && !comms.some((part) => partWorks(game, SHIP, part));
}

// ---- The lock ---------------------------------------------------------------------------------------------------

const plain = (words) => String(words ?? "").trim().toLowerCase().replace(/^the /, "");
// How far apart two squares are, in tiles: a square is half as wide as it's deep.
const apart = (a, b) => Math.hypot((a.x - b.x) / 2, a.y - b.y);
// A room of the Meridian's by the name the file gives it, with where a boarding is fought in it: the player just
// inside the door from the rest of the ship, and the freighter's crew by the hatch to outside (a door in the room's
// walls that leads to no other room), or as far from the player as the room goes where it has none.
function findLock(map, want) {
  const key = plain(want);
  const room = Object.values(map?.rooms ?? {}).find((one) => one.area && [one.name, one.id, ...(one.aliases ?? [])].some((words) => plain(words) === key));
  if (!room) return null;
  const { area, level } = room;
  const inside = (x, y) => x >= area.x && x < area.x + area.w && y >= area.y && y < area.y + area.h;
  const beside = (door) => [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => ({ x: door.x + dx, y: door.y + dy })).find((spot) => inside(spot.x, spot.y) && canStand(level, spot.x, spot.y)) ?? null;
  const doors = area.doors ?? [];
  const you = doors.map(beside).find(Boolean) ?? { x: room.start.x, y: room.start.y };
  const inner = new Set(doors.map((door) => `${door.x},${door.y}`));
  const hatches = [...(level.doors ?? [])].filter((spot) => !inner.has(spot)).map((spot) => {
    const [x, y] = spot.split(",").map(Number);
    return beside({ x, y });
  }).filter(Boolean);
  let them = hatches.sort((a, b) => apart(b, you) - apart(a, you))[0] ?? null;
  if (!them) {
    for (let y = area.y; y < area.y + area.h; y += 1) {
      for (let x = area.x; x < area.x + area.w; x += 1) if (canStand(level, x, y) && (!them || apart({ x, y }, you) > apart(them, you))) them = { x, y };
    }
  }
  return { id: room.id, name: room.name, words: room.name.replace(/^The /, "the "), you, them: them ?? you };
}
// Where a boarding is fought, if the file says: null when it has no such line (or names no room the Meridian has),
// and then the fight is aboard the freighter. Worked out once for each drawing of the ship.
const locks = new WeakMap();
function lockOf(rules = freighterRules()) {
  const want = rules?.["a boarding is fought at"]?.room;
  const map = want ? mapFor(SHIP) : null;
  if (!map) return null;
  const known = locks.get(map);
  if (known?.want === want) return known.lock;
  const lock = findLock(map, want);
  locks.set(map, { want, lock });
  return lock;
}

addChecker(() => {
  const problems = [...freighterFileProblems()];
  const rules = freighterRules();
  for (const kind of rules ? [rules["the crew fights as"].master, rules["the crew fights as"].hand] : []) if (!ENEMIES[kind]) problems.push(`world/freighters.txt: "the crew fights as" names ${kind}, and there's no enemy with that id in world/enemies`);
  const room = rules?.["a boarding is fought at"]?.room;
  if (room && !lockOf(rules)) problems.push(`world/freighters.txt: "a boarding is fought at" names ${room}, and the Meridian has no room called that. Without the line, a boarding is fought aboard the freighter, in the fight window`);
  return problems;
});

// ---- What a ship carries, and what it's worth -----------------------------------------------------------------

// What a ship carries, a line a good: how many, in words, and the thing one of it is when it's in a hold.
function loadsOf(hauls, model = portsModel()) {
  return hauls.filter((haul) => haul[3] >= 0.5).map((haul) => {
    const good = model.goods[haul[2]];
    return { good: haul[2], name: good?.name ?? haul[2], n: Math.round(haul[3]), words: good ? counted(good, haul[3], { least: 1 }) : `${Math.round(haul[3])} ${haul[2]}`, item: good?.item ?? null, haul };
  }).sort((a, b) => b.n * (ITEMS[b.item]?.price ?? 1) - a.n * (ITEMS[a.item]?.price ?? 1));
}
const worthOf = (loads) => loads.reduce((sum, load) => sum + load.n * (ITEMS[load.item]?.price ?? 0), 0);
// "300 ration crates", "300 ration crates and 40 sacks of meal", "300 ration crates, 40 sacks of meal and 2 more".
const cargoWords = (loads) => (loads.length > 2 ? `${loads[0].words}, ${loads[1].words} and ${loads.length - 2} more` : listed(loads.map((load) => load.words)) || "nothing");

// What a master asks for one of a thing: halfway between what it costs at the two ends of the run, less the
// captain's own way with a price.
function masterPrice(game, ship, good) {
  const a = goodPrice(game, ship.from, good);
  const b = goodPrice(game, ship.to, good);
  const mean = a !== null && b !== null ? (a + b) / 2 : a ?? b;
  return mean === null ? null : Math.max(1, Math.ceil(mean * (1 - priceEdge(game))));
}
// How many of a load the master will still sell: the file's share of what was aboard, less what's been sold.
function stillSells(rules, ship, load) {
  const sold = ship.memo.sold?.[load.good] ?? 0;
  return Math.max(0, Math.floor((load.haul[3] + sold) * rules["the master sells"].share) - sold);
}

// What seeing a ship to her next port pays, if she wants company: loading here, for a port that's dangerous enough
// or one where what's sent is being lost.
function escortOffer(game, rules, ship, state, hauls) {
  if (state !== "loading") return null;
  const danger = STAR_MAP.places[ship.to]?.danger ?? 0;
  const losing = hauls.some((haul) => losingAt(game.world, ship.to, haul[2]));
  if (danger < rules["an escort pays"].from && !losing) return null;
  const fuel = Math.max(1, shipsJumpCost(game, ship.to).fuel ?? 1);
  return { fee: Math.round(rules["an escort pays"].rate * fuel * Math.max(1, danger)), danger, losing, fuel };
}
// Her crew, for a boarding: the master, and a hand or two by what she carries.
const crewOf = (rules, worth) => 1 + (worth > rules["the crew"].over ? rules["the crew"].more : rules["the crew"].hands);

// ---- What the page shows ------------------------------------------------------------------------------------------

const placeView = (game, id) => ({ id, name: LOCATIONS[id]?.name ?? id, known: knownPlace(game, id) });

// A ship docked beside the Meridian, with everything that can be done about her.
function dockedView(game, rules, ship, hauls, at) {
  const id = ship.id;
  const world = game.world;
  const loads = loadsOf(hauls);
  const hold = holdOf();
  const escort = escortOffer(game, rules, ship, at.state, hauls);
  const mine = (game.ship?.escorts ?? []).find((one) => one.ship === id) ?? null;
  const far = at.state === "loading" ? ship.to : ship.from;
  return {
    id,
    name: upper(ship.name),
    flies: flagOf(ship),
    from: placeView(game, ship.from),
    to: placeView(game, ship.to),
    state: at.state,
    days: ship.total - 1,
    // She comes in at midnight, at the end of this day, as the game counts days for the player.
    due: world.day + Math.max(1, at.left),
    cargo: cargoWords(loads),
    loads: loads.map((load) => {
      const price = load.item ? masterPrice(game, ship, load.good) : null;
      return { good: load.good, name: load.name, words: load.words, n: load.n, sells: load.item ? stillSells(rules, ship, load) : 0, price, room: hold && load.item ? gridRoom(game, hold.key, load.item) : 0 };
    }),
    hailed: ship.memo.hailed ?? null,
    said: ship.memo.said ?? null,
    // Boarded once, she has nothing more to say to the Meridian, and her crew won't be surprised twice.
    boarded: ship.memo.boarded !== undefined,
    // The far end of her run is somewhere the captain hasn't heard of until she's hailed.
    far: placeView(game, far),
    escort: mine ? { taken: true, fee: mine.fee } : escort ? { fee: escort.fee, why: escort.losing ? "convoys are being lost there" : `the way there is ${String(STAR_MAP.dangerLevels?.[escort.danger] ?? "dangerous").toLowerCase()}` } : null,
    crew: crewOf(rules, worthOf(loads)),
  };
}

// The freighters as the page sees them: the ones docked beside the Meridian, with what can be done about each; every
// one between ports the captain knows of, for the chart; and the ships she's said she'll see in. Reading it changes
// nothing.
export function freightersView(game) {
  const rules = freighterRules();
  const world = game.world;
  if (!rules || !world?.hauls || !game.ship) return null;
  const port = dockOf(game);
  const here = [];
  const lanes = [];
  let more = 0;
  for (const { ship, hauls } of shipsOn(world)) {
    const id = ship.id;
    // One with less than half of anything aboard isn't worth a name on anyone's list.
    if (!hauls.some((haul) => haul[3] >= 0.5)) continue;
    const at = shipState(ship, hauls);
    if (port && at.at === port) here.push(dockedView(game, rules, ship, hauls, at));
    if (!knownPlace(game, ship.from) || !knownPlace(game, ship.to)) continue;
    const spot = shipSpot(ship, at.left);
    if (!spot) continue;
    lanes.push({ id, name: upper(ship.name), from: ship.from, to: ship.to, fromName: LOCATIONS[ship.from]?.name ?? ship.from, toName: LOCATIONS[ship.to]?.name ?? ship.to, state: at.state, left: Math.max(0, at.left), x: spot.x, y: spot.y, cargo: cargoWords(loadsOf(hauls)), worth: worthOf(loadsOf(hauls)), near: port && (ship.to === port || ship.from === port) ? 0 : 1 });
  }
  // The ones that are the Meridian's business first, then the soonest in, and the biggest loads.
  lanes.sort((a, b) => a.near - b.near || a.left - b.left || b.worth - a.worth || a.name.localeCompare(b.name));
  if (lanes.length > MOST_LISTED) {
    more = lanes.length - MOST_LISTED;
    lanes.length = MOST_LISTED;
  }
  here.sort((a, b) => Number(b.state === "unloading") - Number(a.state === "unloading") || a.name.localeCompare(b.name));
  return {
    here: port ? { id: port, name: LOCATIONS[port]?.name ?? port, ships: here } : null,
    lanes: lanes.map(({ near, worth, ...rest }) => rest),
    more,
    escorts: (game.ship.escorts ?? []).map((one) => ({ ...one, toName: LOCATIONS[one.to]?.name ?? one.to, due: one.by, here: game.ship.at === one.to })),
    comms: commsDown(game) ? "The Meridian's comms are down, so nobody can be raised: you can still board one." : null,
    purse: Math.floor(purseOf(game)),
    captain: isCaptain(game),
    // Ashore, a boarding at the Meridian's lock starts with the shuttle back aboard.
    ashore: game.location !== SHIP,
    rules: { share: Math.round(rules["the master sells"].share * 100), flag: rules["a boarding costs"].flag, port: rules["a boarding costs"].port, lock: lockOf(rules)?.words ?? null },
  };
}

// ---- The orders ---------------------------------------------------------------------------------------------------

// A ship docked beside the Meridian, by its id: the ship, its hauls and where it is on its run.
function docked(game, id) {
  const rules = freighterRules();
  const port = dockOf(game);
  const hauls = loadsByShip(game.world).get(String(id ?? "")) ?? [];
  const ship = shipOf(game.world, String(id ?? ""), hauls);
  if (!rules) throw new Error("There are no freighters to meet.");
  if (!port) throw new Error("The Meridian has to be docked at a port to meet a freighter there.");
  if (!ship || !hauls.length) throw new Error("That ship has gone.");
  const at = shipState(ship, hauls);
  if (at.at !== port) throw new Error(`${upper(ship.name)} isn't docked at ${nameOf(port)} any more.`);
  if (ship.memo.boarded !== undefined) throw new Error(`${upper(ship.name)} has nothing more to say to the Meridian, and her crew won't be surprised twice.`);
  return { rules, port, ship, hauls, at };
}
function raised(game) {
  if (commsDown(game)) throw new Error("The Meridian's comms are down: nobody can be raised until they're mended.");
}
// A port the captain hadn't heard of goes on the chart: a master says where she's been.
function learnPlace(game, id) {
  if (!LOCATIONS[id] || LOCATIONS[id].hidden || knownPlace(game, id)) return false;
  game.seenLore ??= [];
  if (!game.seenLore.includes(`place:${id}`)) game.seenLore.push(`place:${id}`);
  return true;
}

// What a master says of the far end of her run: what it's short of, and what it has plenty of.
function wordOf(world, port, model = portsModel()) {
  const levels = Object.keys(model.ports[port]?.holds ?? {}).map((good) => ({ good, level: levelOf(world, port, good, model) }));
  const short = levels.filter((one) => one.level < SHORT_UNDER).sort((a, b) => a.level - b.level).slice(0, 3).map((one) => model.goods[one.good].name);
  const plenty = levels.filter((one) => one.level > PLENTY_OVER).sort((a, b) => b.level - a.level).slice(0, 2).map((one) => model.goods[one.good].name);
  const where = upper(nameOf(port));
  if (!short.length && !plenty.length) return `${where} wants for nothing much just now.`;
  return `${where} is ${short.length ? `short of ${listed(short)}` : "short of nothing"}${plenty.length ? `, and has ${listed(plenty)} to spare` : ""}.`;
}

function hail(game, id) {
  const { ship, hauls, at } = docked(game, id);
  raised(game);
  const loads = loadsOf(hauls);
  const loading = at.state === "loading";
  const far = loading ? ship.to : ship.from;
  const run = loading
    ? `loading for ${nameOf(ship.to)}, ${daysWords(ship.total - 1)} away, and sails tonight`
    : at.state === "waiting" ? `${daysWords(ship.total - 1)} out of ${nameOf(ship.from)}, and kept waiting off the port`
      : `${daysWords(ship.total - 1)} out of ${nameOf(ship.from)}, and unloading`;
  const fresh = learnPlace(game, far);
  const said = `${upper(ship.name)} answers. She flies for ${flagOf(ship)}, ${run}, with ${cargoWords(loads)}. Her master says: "${wordOf(game.world, far)}"${fresh ? ` ${upper(nameOf(far))} goes on your chart.` : ""}`;
  ship.memo.hailed = game.world.day;
  ship.memo.said = wordOf(game.world, far);
  return { message: said, notes: [`[HAIL] ${said}`] };
}

function buy(game, id, good) {
  const { rules, ship, hauls } = docked(game, id);
  raised(game);
  const hold = holdOf();
  const load = loadsOf(hauls).find((one) => one.good === String(good ?? ""));
  if (!hold) throw new Error("She has no hold for freight.");
  if (!load?.item) throw new Error(`${upper(ship.name)} carries nothing like that to sell.`);
  if (stillSells(rules, ship, load) < 1) throw new Error("Her master won't sell any more of that: the rest is promised where she's bound.");
  if (gridRoom(game, hold.key, load.item) < 1) throw new Error(`The ${hold.name} is full.`);
  const price = masterPrice(game, ship, load.good);
  if (Math.floor(purseOf(game)) < price) throw new Error(`The purse holds ${Math.floor(purseOf(game))} credits, and one costs ${price}.`);
  gridPut(game, hold.key, load.item, 1);
  load.haul[3] = Math.round((load.haul[3] - 1) * 100) / 100;
  if (load.haul[3] < 0.01) game.world.hauls.splice(game.world.hauls.indexOf(load.haul), 1);
  (ship.memo.sold ??= {})[load.good] = (ship.memo.sold[load.good] ?? 0) + 1;
  addToPurse(game, -price);
  const message = `Bought ${counted(portsModel().goods[load.good], 1)} out of ${ship.name}'s hold for ${price} credits, into the ${hold.name}. That's one that won't reach ${nameOf(ship.to)}.`;
  return { message, notes: [`[TRADE] ${message}`] };
}

function escort(game, id) {
  const { rules, ship, hauls, at } = docked(game, id);
  raised(game);
  const offer = escortOffer(game, rules, ship, at.state, hauls);
  if (!offer) throw new Error(`${upper(ship.name)} isn't asking for company.`);
  const list = (game.ship.escorts ??= []);
  if (list.some((one) => one.ship === ship.id)) throw new Error(`You've already said you'd see ${ship.name} in.`);
  const by = game.world.day + at.left;
  list.push({ ship: ship.id, name: ship.name, to: ship.to, fee: offer.fee, by });
  ship.memo.escort = true;
  learnPlace(game, ship.to);
  const message = `You've given ${ship.name} your word: be docked at ${nameOf(ship.to)} when she comes in, at midnight at the end of day ${by}, and her master pays ${offer.fee} credits into the purse.${offer.losing ? ` Convoys are being lost there, and with the Meridian beside her she'll get in.` : ""}`;
  return { message, notes: [`[TRADE] ${message}`] };
}

// The player goes to the lock: back aboard on the shuttle first when they're ashore, which takes its hour, and by
// then she may have gone, or something else may have come up. It gives { stopped }, the words for why the boarding
// is off, or { found }, the ship as she stands once they're there (null when nothing has changed).
function toTheLock(game, id, lock, notes) {
  let found = null;
  if (game.location !== SHIP) {
    notes.push(...(travel(game, SHIP).notes ?? []));
    if (game.over || game.combat || game.talk || game.check) return { stopped: "You're back aboard the Meridian, and something else has come up first." };
    try {
      found = docked(game, id);
    } catch (error) {
      return { stopped: `You're back aboard the Meridian, too late. ${error.message}` };
    }
  }
  // Once they've crossed, a refusal is something to be told; before anything has happened, it's an order refused.
  const refuse = (why) => {
    if (found) return { stopped: why };
    throw new Error(why);
  };
  // A door the ship's systems have locked stops them: the one to the room they're in, or the lock's own.
  const from = roomHere(game)?.id ?? null;
  const shut = from === lock.id ? null : [from, lock.id].find((room) => room && doorLocked(game, SHIP, room)) ?? null;
  if (shut) return refuse(`The door to ${(mapFor(SHIP)?.rooms?.[shut]?.name ?? "the room").replace(/^The /, "the ")} is locked, so you can't get to ${lock.words}: nobody's going across.`);
  try {
    walkCommand(game, { action: "room", to: lock.id });
  } catch {
    return refuse(`There's a closed door between you and ${lock.words}, so nobody's going across.`);
  }
  if (game.walk && !game.walk.room) Object.assign(game.walk, { x: lock.you.x, y: lock.you.y });
  return { found };
}

// Going for her. Where the file names a room of the Meridian's for it, the player is taken to that room and the
// fight is there, in the room like any other: her crew by the hatch, the player just inside the door, whoever's
// walking with them beside them. With no room named, the fight is aboard the freighter, so it's in the fight window
// and never in the room. What comes of it is settled when it ends (below).
function board(game, id) {
  let found = docked(game, id);
  if (game.location !== SHIP && game.location !== found.port) throw new Error(`You have to be aboard the Meridian, or ashore at ${nameOf(found.port)}, to go across to her.`);
  if (game.talk || game.check) throw new Error("Finish what you're in the middle of first.");
  const lock = lockOf(found.rules);
  const before = [];
  // Whether the player crosses from the port to the Meridian for it: the page then has a new place to show.
  const crossed = Boolean(lock) && game.location !== SHIP;
  if (lock) {
    const moved = toTheLock(game, id, lock, before);
    if (moved.stopped) return { message: moved.stopped, notes: before, moved: crossed };
    found = moved.found ?? found;
  }
  const { rules, port, ship, hauls } = found;
  const loads = loadsOf(hauls);
  const fights = rules["the crew fights as"];
  const hands = crewOf(rules, worthOf(loads)) - 1;
  const notes = startCombat(game, fights.master, {
    followers: Array(hands).fill(fights.hand),
    leadIn: lock
      ? `You come down to ${lock.words} to cross to ${ship.name}. Her master is standing in the hatch, and isn't alone.`
      : `You go across to ${ship.name} through the lock. Her master is waiting in the hold, and isn't alone.`,
    why: "guarding",
    reason: lock ? "You mean to board their ship for what's in her hold." : "You've come aboard their ship for what's in her hold.",
    faction: FACTIONS[ship.flies] ? ship.flies : null,
  });
  // At the lock her crew stand by the hatch when the fight moves into the room (src/live-fight.js reads enter).
  if (lock) for (const enemy of game.combat.enemies) enemy.enter = { x: lock.them.x, y: lock.them.y };
  else game.combat.away = `aboard ${ship.name}`;
  game.combat.boarding = { ship: ship.id, port };
  const lines = [
    ...before,
    lock ? `[COMBAT] You go to board ${ship.name}, at ${nameOf(port)}, and her crew meet you in ${lock.words}.` : `[COMBAT] You board ${ship.name}, at ${nameOf(port)}.`,
    ...notes,
    ...boardingCosts(game, rules, ship, port),
  ];
  ship.memo.boarded = game.world.day;
  onRecord(game, "boarded_a_freighter", `You boarded ${ship.name} at ${nameOf(port)} for her cargo.`);
  return { message: lock ? `You go down to ${lock.words}, where ${ship.name} is made fast.` : `You go across to ${ship.name}.`, notes: lines, moved: crossed };
}
// What a boarding costs, won or lost: standing with whoever she flies for, and with whoever holds the port it was
// done in, where each is one of the game's factions.
function boardingCosts(game, rules, ship, port) {
  const costs = rules["a boarding costs"];
  const lines = [];
  const why = `You boarded ${ship.name} at ${nameOf(port)}`;
  if (FACTIONS[ship.flies]) lines.push(changeStanding(game, ship.flies, -costs.flag, why));
  const holder = holderOf(game, port);
  if (FACTIONS[holder] && holder !== ship.flies) lines.push(changeStanding(game, holder, -costs.port, why));
  return lines.filter(Boolean);
}

// When the fight's over: won, everything that fits in the freight hold comes across, the dearest first, and it's
// gone from what the ship was carrying. Anything else, and nothing's taken.
addFightEnd((game, fight, result) => {
  const boarding = fight.boarding;
  if (!boarding) return [];
  const hauls = loadsByShip(game.world).get(boarding.ship) ?? [];
  const ship = shipOf(game.world, boarding.ship, hauls);
  if (!ship) return [];
  // Beaten, or talked into standing aside: either way the hold is open. Anything else, and she keeps what she had.
  if (result !== "victory" && result !== "talked") return [result === "defeat" ? `${fight.away ? "You were carried back through the lock" : "You went down in the lock"}, and ${ship.name} keeps everything she had.` : `${upper(ship.name)} keeps everything she had.`];
  const hold = holdOf();
  const taken = [];
  if (hold) {
    const byWorth = loadsOf(hauls).filter((load) => load.item).sort((a, b) => (ITEMS[b.item]?.price ?? 0) / (sizeOf(ITEMS[b.item]).w * sizeOf(ITEMS[b.item]).h / stackOf(ITEMS[b.item])) - (ITEMS[a.item]?.price ?? 0) / (sizeOf(ITEMS[a.item]).w * sizeOf(ITEMS[a.item]).h / stackOf(ITEMS[a.item])));
    for (const load of byWorth) {
      const n = Math.min(Math.floor(load.haul[3]), gridRoom(game, hold.key, load.item));
      if (n < 1) continue;
      gridPut(game, hold.key, load.item, n);
      load.haul[3] = Math.round((load.haul[3] - n) * 100) / 100;
      if (load.haul[3] < 0.01) game.world.hauls.splice(game.world.hauls.indexOf(load.haul), 1);
      taken.push({ good: load.good, n });
    }
  }
  if (!taken.length) return [`${upper(ship.name)} is yours for the taking, and there's no room in the ${hold?.name ?? "freight hold"} for any of it.`];
  const model = portsModel();
  const what = listed(taken.map((one) => counted(model.goods[one.good], one.n)));
  // Boarded where she was unloading, it never came ashore; boarded where she was loading, it never left for where
  // it was bound.
  const ashore = boarding.port === ship.to;
  const many = taken.length > 1 || taken[0].n > 1;
  onRecord(game, "robbed_a_freighter", ashore
    ? `You took ${what} out of ${ship.name} at ${nameOf(boarding.port)}, before she'd unloaded.`
    : `You took ${what} out of ${ship.name} at ${nameOf(boarding.port)}, bound for ${nameOf(ship.to)}.`);
  // The port it was bound for hears of it, whether or not anything of the ship still gets there.
  const told = [];
  tellNews(game, ship.to, ashore
    ? `${upper(ship.name)} was boarded at ${nameOf(boarding.port)} before she'd unloaded, and ${what} won't be coming ashore.`
    : `${upper(ship.name)} was boarded at ${nameOf(boarding.port)}, and ${what} bound for ${nameOf(ship.to)} won't be coming.`, told);
  return [`[TRADE] ${upper(what)} out of ${ship.name}'s hold, into the ${hold.name}. ${upper(nameOf(ship.to))} was waiting for ${many ? "them" : "it"}.`, ...told];
});

export function freighterCommand(game, body) {
  if (!isCaptain(game)) throw new Error("That's for whoever has the chair.");
  switch (body.action) {
    case "ship-hail": return hail(game, body.id);
    case "ship-buy": return buy(game, body.id, body.good);
    case "ship-escort": return escort(game, body.id);
    case "ship-board": return board(game, body.id);
    default: throw new Error("Unknown order.");
  }
}

// ---- A day on the lanes, as the player hears of it -----------------------------------------------------------------

const escortOf = (game, id) => (game.ship?.escorts ?? []).find((one) => one.ship === id) ?? null;
const dropEscort = (game, id) => { if (game.ship?.escorts) game.ship.escorts = game.ship.escorts.filter((one) => one.ship !== id); };

tellLanes({
  // The Meridian is seeing this ship in, and is docked where she's bound.
  escorted: (game, ship) => Boolean(escortOf(game, ship.id)) && isCaptain(game) && game.ship?.at === ship.to,

  // She came in. Seen in by the Meridian, her master pays; and at a port that was short of what she carries, it's news.
  arrived(game, world, ship, loads, notes, tell, seen) {
    const rules = freighterRules();
    const model = portsModel();
    const mine = escortOf(game, ship.id);
    if (mine) {
      dropEscort(game, ship.id);
      if (seen) {
        addToPurse(game, mine.fee);
        const saved = loads.some((load) => load.saved);
        notes.push(`[TRADE] ${upper(ship.name)} is in at ${nameOf(ship.to)} with the Meridian beside her${saved ? ", where a ship alone would have been lost" : ""}, and her master pays ${mine.fee} credits into the purse.`);
        if (rules && FACTIONS[ship.flies]) {
          const line = changeStanding(game, ship.flies, rules["an escort earns"].standing, `You saw ${ship.name} safely into ${nameOf(ship.to)}`);
          if (line) notes.push(line);
        }
        onRecord(game, "escorted_a_freighter", `You saw ${ship.name} safely into ${nameOf(ship.to)}.`);
      } else if (isCaptain(game)) notes.push(`[TRADE] ${upper(ship.name)} came in at ${nameOf(ship.to)} without you. You'd given your word to see her in, and her master keeps the fee.`);
    }
    const wanted = loads.filter((load) => load.level < NEWS_UNDER && load.n >= 1 && model.goods[load.good]);
    const close = ship.to === game.location || ship.to === game.ship?.at;
    if (!wanted.length || !close) return;
    const from = knownPlace(game, ship.from) ? nameOf(ship.from) : "further out";
    tell(game, world, ship.to, `${upper(ship.name)} is in from ${from} with ${listed(wanted.slice(0, 2).map((load) => counted(model.goods[load.good], load.n)))}, which ${nameOf(ship.to)} was ${levelName(wanted[0].level) === "short" ? "short of" : "badly short of"}.`, notes);
  },

  // What she carried never arrived.
  lost(game, world, ship, loads, notes, tell, light = false) {
    const model = portsModel();
    const mine = escortOf(game, ship.id);
    const what = listed(loads.filter((load) => model.goods[load.good]).slice(0, 2).map((load) => counted(model.goods[load.good], load.n, { least: 1 })));
    const from = knownPlace(game, ship.from) ? `, out of ${nameOf(ship.from)}` : "";
    tell(game, world, ship.to, light
      ? `${upper(ship.name)}${from} came in light at ${nameOf(ship.to)}: ${what} lost on the way, and the price is climbing there.`
      : `${upper(ship.name)}${from} never arrived at ${nameOf(ship.to)}: ${what} lost with her, and the price of what she carried is climbing there.`, notes);
    // The rest of her came in: arrived() settles what was promised.
    if (!mine || light) return;
    dropEscort(game, ship.id);
    if (!isCaptain(game)) return;
    notes.push(`[TRADE] ${upper(ship.name)} never reached ${nameOf(ship.to)}. You'd given your word to see her in.`);
    const rules = freighterRules();
    if (rules && FACTIONS[ship.flies]) {
      const line = changeStanding(game, ship.flies, -2 * rules["an escort earns"].standing, `${upper(ship.name)} was lost after you'd said you'd see her in`);
      if (line) notes.push(line);
    }
  },

  // Whatever was promised to a ship that's no longer on any lane is let go.
  tidy(game, world) {
    if (game.ship?.escorts?.length) game.ship.escorts = game.ship.escorts.filter((one) => world.ships?.[one.ship]);
  },
});
