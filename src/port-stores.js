// A port's stores where you stand (step 10 of the logistics rework). A port's file, world/ports/<place>.txt, can say
// where its goods stand in its rooms: a Stores part, each line a store with its room and how many of each good are in
// it when the port has what it usually holds, and two lines at the top for who carries for them and where goods come
// and go. Each store is a thing in its room that opens beside the pack like any store, and what's in it is its share
// of what the port really has that day (src/ports.js): half of its usual when the port has half.
//
// Only where the player is. Every other port stays numbers: a store is filled to its share the moment the player
// arrives, follows the port's amounts while they're there, and is let go of when they leave (anything of the player's
// own left in one stays in it).
//
// The dockhands carry on a board of their own, which is this file's and not the ship's (src/work.js): whenever a store
// has more or fewer of a good than its share, one of the port's carriers who's up and about takes a trip's worth out
// to where goods come and go, or brings one in. And what a ship takes at the dock (the Meridian's restocking, her
// lots, her freight, what she sells) comes off these shelves first, a trip at a time, and is made up from the port's
// holds after it. Carrying between a store and the rest of the port changes nothing the port has: its amount is the
// truth, the store its shop window.
//
// What the player takes out of a port's store comes out of the port, and what they put in is the port's from then on.
// It isn't theirs to take: the law treats a port's store like a container that belongs to whoever holds the place
// (src/law.js). The numbers of the board (how often it looks, how long before it stops watching) are below.

import { addChecker, addClockWork, addDetour, addFirstContents, addMapWork, addThingActs } from "./room-hooks.js";
import { gridPut, sizeOf, stackOf, storeCounts, storeTake } from "./bag.js";
import { keyAt } from "./body.js";
import { findCharacter } from "./campaign.js";
import { levelName, worldOf } from "./daily.js";
import { ITEMS, LOCATIONS } from "./data.js";
import { PORTS_OWN, ownerWords } from "./law.js";
import { hasReached, notAbout, rosterOf, roomsByDay, walkMinutes } from "./life.js";
import { logisticsPending } from "./logistics.js";
import { amountOf, counted, levelOf, portTake, portsModel } from "./ports.js";
import { whenPut } from "./puts.js";
import { claimedSquares, floorSpot, systemsOf, systemsPending } from "./systems.js";
import { canStand, mapFor, roomOf, roomsOf } from "./walk.js";
import { INVENTORY, WORLD_PORTS } from "./world.js";

// The board looks every so many minutes of the clock, like the ship's own.
const CHUNK = 5;
// After a wait longer than this nobody was watching: the stores are simply as the port has them, and no job is kept.
const SETTLE_AFTER = 180;
// A walk nobody can measure takes this long.
const WALK_MINUTES = 6;
const STEPS = [[0, -1], [-1, 0], [1, 0], [0, 1]];

const plain = (words) => String(words ?? "").trim().toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").replace(/^the /, "");
const upperFirst = (words) => (words ? words[0].toUpperCase() + words.slice(1) : words);
const lowerThe = (words) => String(words ?? "").replace(/^The /, "the ");
const minutesOf = (hours) => Math.floor(hours * 60 + 1e-6);
const listed = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0] ?? "");
const box = () => INVENTORY.containers ?? { cols: 6, rows: 5 };
const squaresOf = (item, n) => Math.ceil(n / stackOf(ITEMS[item])) * sizeOf(ITEMS[item]).w * sizeOf(ITEMS[item]).h;
// How many of a thing one of the port's people carries in a trip: a stack of it, which is a square of a store.
const tripOf = (item) => stackOf(ITEMS[item]);

// ---- The stores, stood in the port's rooms -----------------------------------------------------------------------

// What a map has of its port's stores: each with its room, its thing and the square to stand on beside it, where goods
// come and go, and who carries. Made once for each map, and again when the map is.
const placed = new WeakMap();

// The squares a store nobody drew keeps off: the room's words and ways out, where people stand and stop, and the
// squares round what already stands there (as src/loot.js and src/uses.js stand theirs).
function keptClear(place, map, level) {
  const out = new Set(claimedSquares(place, map, level));
  const around = (x, y) => { for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) out.add(`${x + dx},${y + dy}`); };
  for (const thing of level.things) around(thing.x, thing.y);
  const parts = systemsOf(place);
  for (const room of Object.values(map.rooms ?? {})) {
    if (room.levelId !== level.id) continue;
    for (const id of parts?.partsIn?.[room.id] ?? []) {
      const part = parts.parts[id];
      if (part && !part.unplaced) around(part.x, part.y);
    }
  }
  return out;
}

// A square to stand on near another: the nearest that isn't a doorway, isn't beside a way out and has none of the
// room's words on it, at least so many steps off. Null when there's none.
function standNear(place, map, level, from, least = 0, area = null) {
  const named = claimedSquares(place, map, level);
  const good = (x, y) => canStand(level, x, y) && !level.doors.has(`${x},${y}`) && !named.has(`${x},${y}`) && !level.exits.some((exit) => Math.abs(exit.x - x) + Math.abs(exit.y - y) <= 1) && (!area || level.areaAt?.(x, y) === area.id);
  const seen = new Set([`${from.x},${from.y}`]);
  let edge = [{ x: from.x, y: from.y, far: 0 }];
  while (edge.length) {
    const next = [];
    for (const here of edge) {
      if (here.far >= least && good(here.x, here.y)) return { x: here.x, y: here.y };
      for (const [dx, dy] of STEPS) {
        const x = here.x + dx;
        const y = here.y + dy;
        if (seen.has(`${x},${y}`) || !canStand(level, x, y)) continue;
        seen.add(`${x},${y}`);
        next.push({ x, y, far: here.far + 1 });
      }
    }
    edge = next;
  }
  return null;
}

// Someone a port's file names to carry: by the name they have in the place's file in world/life, or their id.
function carrierKey(place, words) {
  const roster = rosterOf(place);
  const said = plain(words);
  const crowd = roster.find((one) => one.name && plain(one.name) === said);
  if (crowd) return crowd.key;
  const byId = roster.find((one) => one.id && one.id === said.replace(/\s+/g, "_"));
  if (byId) return byId.key;
  const person = findCharacter(null, words);
  return person ? roster.find((one) => one.id === person.id)?.key ?? null : null;
}

// A store this file stood on a square of its own is taken away again, and its square is floor again; a thing drawn
// on the map that was made a store is only a thing again.
function unstand(level, thing) {
  if (thing.placed && String(thing.id).startsWith("port:")) {
    level.things.splice(level.things.indexOf(thing), 1);
    level.solid.delete(`${thing.x},${thing.y}`);
    if (level.open[thing.y]) level.open[thing.y][thing.x] = true;
  } else {
    delete thing.portStore;
    delete thing.holds;
  }
}

function standStores(place, map) {
  const model = portsModel();
  const port = model.ports[place];
  const out = { place, model, stores: [], byKey: new Map(), dock: null, carriers: [], rooms: new Set(), problems: [] };
  placed.set(map, out);
  // What the file no longer has, since the stores were last stood, goes: the Story board saves a port's file without
  // the game being closed.
  const wanted = new Set((port?.stores ?? []).map((store) => store.id));
  for (const level of Object.values(map.levels ?? {})) for (const thing of [...level.things]) if (thing.portStore && !wanted.has(thing.portStore)) unstand(level, thing);
  if (!port?.stores.length) return out;
  const name = LOCATIONS[place]?.name ?? place;
  const at = (line, message) => out.problems.push(`ports/${place}.txt${line ? ` (line ${line})` : ""}: ${message}`);
  const rooms = roomsOf(map);
  const findRoom = (want) => {
    const key = plain(want);
    return rooms.find((room) => plain(room.name) === key || room.id === key || (room.aliases ?? []).some((alias) => plain(alias) === key)) ?? null;
  };
  // Where goods come and go: the room the file names, or the one people arrive in.
  let dock = port.dock ? findRoom(port.dock.room) : null;
  if (port.dock && !dock) at(port.dock.line, `${name} has no room called ${port.dock.room}, for goods to come and go by`);
  dock ??= roomOf(map, map.start);
  // Its carriers stand a few steps from where people come in, not on the spot itself.
  if (dock?.start) out.dock = { room: dock.id, name: dock.name, spot: { level: dock.levelId, ...(standNear(place, map, dock.level, dock.start, 3, dock.area) ?? { x: dock.start.x, y: dock.start.y }) } };
  // Who carries.
  for (const words of port.carriers?.list ?? []) {
    const key = carrierKey(place, words);
    if (!key) at(port.carriers.line, `nobody called ${words} has a day at ${name} in world/life, to carry for its stores`);
    else if (!out.carriers.includes(key)) out.carriers.push(key);
  }
  if (!port.carriers) at(port.stores[0].line, `${name} has stores and nobody to carry for them: add a line at the top, such as carried by: Docker Pav, Docker Renko`);
  const squares = box().cols * box().rows;
  const taken = new Map();
  for (const store of port.stores) {
    const room = findRoom(store.room);
    if (!room) {
      at(store.line, `${name} has no room called ${store.room}, for ${store.name} to stand in`);
      continue;
    }
    // More than fits its squares when things are as usual would never all be there.
    const needs = store.goods.reduce((sum, entry) => sum + squaresOf(entry.item, entry.usual), 0);
    if (needs > squares) {
      at(store.line, `${store.name} would usually hold more than fits: ${needs} squares of things, and a store has ${squares}. Split it into two stores, or keep less in it`);
      continue;
    }
    const level = room.level;
    const inRoom = (thing) => !room.area || level.areaAt?.(thing.x, thing.y) === room.area.id;
    // One stood before in another room, which the file has since moved, is taken from there.
    for (const other of Object.values(map.levels ?? {})) for (const one of [...other.things]) if (one.portStore === store.id && !(other === level && inRoom(one))) unstand(other, one);
    let thing = level.things.find((one) => inRoom(one) && (one.portStore === store.id || plain(one.name) === plain(store.name))) ?? null;
    const stoodBefore = thing?.portStore === store.id;
    if (thing && !stoodBefore && (thing.store || thing.item || thing.computer || thing.loot)) {
      at(store.line, `${thing.name} in ${room.name} is something else already (${thing.item ? "something to pick up" : thing.computer ? "a computer" : thing.loot ? "a container" : "a store"}): give the port's store a name of its own`);
      continue;
    }
    if (!thing) {
      const mine = taken.get(level.id) ?? taken.set(level.id, new Set()).get(level.id);
      const spot = floorSpot(level, mine, 0, 1, keptClear(place, map, level), room.area ?? null);
      if (!spot) {
        at(store.line, `there's no free square in ${room.name} to put ${store.name} on`);
        continue;
      }
      thing = { id: `port:${store.id}`, name: upperFirst(store.name), look: store.look || `${upperFirst(store.name)}.`, x: spot.x, y: spot.y, placed: true };
      // It stands like a thing drawn there: its square isn't floor, and you reach it from beside it.
      level.things.push(thing);
      level.solid.add(`${spot.x},${spot.y}`);
      if (level.open[spot.y]) level.open[spot.y][spot.x] = false;
      mine.add(`${spot.x},${spot.y}`);
    } else if (stoodBefore && thing.placed && String(thing.id).startsWith("port:")) Object.assign(thing, { name: upperFirst(store.name), look: store.look || `${upperFirst(store.name)}.` });
    else if (!stoodBefore && store.look) thing.look = `${thing.look ?? ""} ${store.look}`.trim();
    // It opens, and what's in it is the port's (firstContents below, and the board).
    thing.holds = {};
    thing.portStore = store.id;
    // Where a carrier stands to reach it: a square beside it that isn't a doorway, and off the room's words if it can be.
    const around = STEPS.map(([dx, dy]) => ({ x: thing.x + dx, y: thing.y + dy })).filter((one) => canStand(level, one.x, one.y) && !level.doors.has(`${one.x},${one.y}`));
    const named = claimedSquares(place, map, level);
    const beside = around.find((one) => !named.has(`${one.x},${one.y}`)) ?? around[0] ?? standNear(place, map, level, thing, 1, room.area ?? null);
    const entry = { ...store, room: room.id, roomName: room.name, level: level.id, thing: thing.id, key: `thing:${place}:${thing.id}`, spot: beside ? { level: level.id, ...beside } : null, baseLook: thing.look };
    out.stores.push(entry);
    out.byKey.set(entry.key, entry);
  }
  // Where the port's carriers are at work: the rooms its stores stand in, and where goods come and go.
  out.rooms = new Set([out.dock?.room, ...out.stores.map((store) => store.room)].filter(Boolean));
  return out;
}

addMapWork((place, map) => {
  // Not before the place's parts and stores stand in the map: nothing is stood on their squares.
  if (systemsPending(place) || logisticsPending(place)) return false;
  if (!placed.has(map)) standStores(place, map);
  return true;
});

// A port's stores as its map has them, or nothing for a place with none (or one whose map is still being made). The
// place in play has its map built already.
function storesAt(place) {
  if (!place || !portsModel().ports[place]) return null;
  const map = mapFor(place);
  let here = map ? placed.get(map) ?? null : null;
  // The files have been read again since: the stores are stood again from them.
  if (here && here.model !== portsModel()) here = standStores(place, map);
  return here?.stores.length ? here : null;
}
export const portHasStores = (place) => Boolean(portsModel().ports[place]?.stores.length);

// What's wrong with a port's stores that only its map and its people can say: a room that isn't there, no free square,
// nobody of that name to carry. For npm run check-story, and the Story board's page of the port.
export function portStoreProblems(place = null) {
  const out = [];
  for (const id of place ? [place] : Object.keys(WORLD_PORTS)) {
    if (!portsModel().ports[id]?.stores.length) continue;
    const map = mapFor(id);
    if (!map) {
      out.push(`ports/${id}.txt: there's no map of ${LOCATIONS[id]?.name ?? id} in world/maps, for its stores to stand in`);
      continue;
    }
    const here = placed.get(map);
    out.push(...((here && here.model !== portsModel() ? standStores(id, map) : here)?.problems ?? []));
  }
  return out;
}
addChecker(() => portStoreProblems());

// ---- What a store has, against what the port has -------------------------------------------------------------------

// The goods a port holds that are things, by the thing each is.
const goodsByItem = new WeakMap();
function goodOfItem(place, item) {
  const model = portsModel();
  let byItem = goodsByItem.get(model);
  if (!byItem) goodsByItem.set(model, (byItem = new Map()));
  if (!byItem.has(place)) byItem.set(place, new Map(Object.keys(model.ports[place]?.holds ?? {}).filter((good) => model.goods[good].item).map((good) => [model.goods[good].item, good])));
  return byItem.get(place).get(item) ?? null;
}

// A store's share of a good today: what it usually has, at the level the port has it at, and never more than the port has.
function shareOf(game, place, entry) {
  const world = game.world;
  const level = levelOf(world, place, entry.good);
  return Math.max(0, Math.min(Math.round((entry.usual * level) / 100), Math.floor(amountOf(world, place, entry.good) + 1e-6)));
}
// What's in a store now, by item: what's kept once the player's here, and its share before that.
function countsOf(game, place, store) {
  if (game.portStores?.place === place && game.stores?.[store.key]) return storeCounts(game, store.key, {});
  const counts = storeCounts(game, store.key, {});
  for (const item of Object.keys(counts)) if (goodOfItem(place, item)) delete counts[item];
  for (const entry of store.goods) counts[entry.item] = shareOf(game, place, entry);
  return counts;
}

// The first time a port's store is opened before the board has looked, it has its share.
addFirstContents((game, place, thing) => {
  if (!thing?.portStore) return null;
  const store = storesAt(place)?.stores.find((one) => one.id === thing.portStore);
  return store ? Object.fromEntries(store.goods.map((entry) => [entry.item, shareOf(game, place, entry)])) : null;
});

// A store filled to its share at once: what the player left in it that isn't the port's stays where it is.
function fill(game, place, store) {
  game.stores ??= {};
  const mine = (game.stores[store.key]?.items ?? []).filter((one) => !goodOfItem(place, one.id));
  game.stores[store.key] = { items: mine };
  for (const entry of store.goods) gridPut(game, store.key, entry.item, shareOf(game, place, entry));
}

// What the player takes out of a port's store comes out of the port, and what they put in is the port's.
whenPut((game, where, item, n) => {
  const place = game.location;
  if (!where.startsWith(`thing:${place}:`) || !portHasStores(place)) return;
  if (!storesAt(place)?.byKey.has(where)) return;
  const good = goodOfItem(place, item);
  if (!good) return;
  const world = worldOf(game);
  const before = amountOf(world, place, good);
  portTake(world, place, good, -n);
  // What's done by hand isn't a ship's doing: the board doesn't answer it as one.
  const state = game.portStores;
  if (state?.place === place && state.base?.[good] !== undefined) state.base[good] += amountOf(world, place, good) - before;
});

// ---- The board ------------------------------------------------------------------------------------------------------

const owedKey = (store, item) => `${store.id}|${item}`;
const whereOf = (j) => ((j.dir === "in") === (j.phase === "carrying") ? `store:port-${j.store}` : "store:port-dock");
const spotOf = (here, j) => ((j.dir === "in") === (j.phase === "carrying") ? here.stores.find((one) => one.id === j.store)?.spot ?? null : here.dock?.spot ?? null);
const loadWords = (item, n) => `${n === 1 ? (/^[aeiou]/i.test(ITEMS[item]?.name ?? "") ? "an" : "a") : n} ${(ITEMS[item]?.name ?? item).toLowerCase()}${n === 1 || /(s|produce)$/i.test(ITEMS[item]?.name ?? "") ? "" : "s"}`;

// What a job's carrier is doing, in words, for their line in the room and the port's own page.
function doingWords(here, j) {
  const store = here.stores.find((one) => one.id === j.store);
  const called = lowerThe(store?.name ?? "the stores");
  const dock = lowerThe(here.dock?.name ?? "the dock");
  if (j.dir === "in") return j.phase === "carrying" ? `carrying ${loadWords(j.item, j.n)} to ${called}` : `fetching ${loadWords(j.item, j.n)} from ${dock} for ${called}`;
  return j.phase === "carrying" ? `carrying ${loadWords(j.item, j.n)} out to ${dock}` : `fetching ${loadWords(j.item, j.n)} from ${called}`;
}

// Whether a job's carrier has got where its walk was taking them: when the minutes of the walk have gone by, or sooner
// if their own feet have got them there.
function there(game, place, j, t) {
  if (t - j.since >= (j.walk ?? WALK_MINUTES)) return true;
  return Boolean(game.life?.places?.[place]?.[j.by]) && hasReached(game, place, j.by, whereOf(j));
}
const walkFor = (game, place, key, from, to, hours) => (to ? walkMinutes(game, place, key, from, to, hours) : null) ?? WALK_MINUTES;

// Why one of the port's carriers can't be given a job now, or null when they can: they take one while their own day
// has them up and about in a room with one of the stores, or where goods come and go. A docker drinking at the bar
// isn't carrying. days is everyone's room by their day just now (roomsByDay).
function whyNot(game, place, here, state, key, hours, days) {
  if (state?.jobs.some((j) => j.by === key)) return "carrying already";
  if (game.down?.[keyAt(place, key)]) return "down";
  if (game.along?.key === key) return "with you";
  return notAbout(game, place, key, hours) ?? (here.rooms.has(days.get(key)?.room) ? null : "elsewhere");
}

// The port's amounts as the board last saw them, a good at a time: what's changed since, other than by the port's own
// day, is a ship's doing at the dock.
function baseline(game, place, here) {
  const base = {};
  for (const store of here.stores) for (const entry of store.goods) base[entry.good] ??= amountOf(game.world, place, entry.good);
  return base;
}

function arrive(game, place, here, now) {
  const world = worldOf(game);
  for (const store of here.stores) fill(game, place, store);
  game.portStores = { place, at: now, day: world.day ?? 0, seq: 0, jobs: [], owed: {}, base: baseline(game, place, here), keys: here.stores.map((store) => store.key) };
  return game.portStores;
}

// The player has gone: the port is numbers again. What stood in its stores as the port's goods is let go of, and
// anything else left in one stays for when they're back.
function leave(game, state) {
  for (const key of state.keys ?? []) {
    const kept = game.stores?.[key]?.items;
    if (!kept) continue;
    const mine = kept.filter((one) => !goodOfItem(state.place, one.id));
    if (mine.length) game.stores[key] = { items: mine };
    else delete game.stores[key];
  }
  delete game.portStores;
}

// One look of the board, at minute t.
function look(game, place, here, state, t) {
  const world = worldOf(game);
  const hours = t / 60;
  const have = (store, item) => storeCounts(game, store.key, {})[item] ?? 0;
  const coming = (store, item) => state.jobs.reduce((sum, j) => (j.store === store.id && j.item === item && j.dir === "in" ? sum + j.n : sum), 0);
  // What's still on the shelf and already spoken for: an out job that hasn't loaded yet.
  const going = (store, item) => state.jobs.reduce((sum, j) => (j.store === store.id && j.item === item && j.dir === "out" && j.phase !== "carrying" ? sum + j.n : sum), 0);
  // What a ship has taken at the dock since the last look comes off the shelves that keep it, and what one has
  // brought goes onto them: so many owed out, or in. The port's own day (what it made, used, sent and was sent)
  // isn't a ship's doing, and only moves the store's share.
  if ((world.day ?? 0) !== state.day) {
    state.day = world.day ?? 0;
    state.base = baseline(game, place, here);
  } else {
    for (const [good, was] of Object.entries(state.base)) {
      const now = amountOf(world, place, good);
      // Whole things: a level is kept to a few thousandths of one, so what's nearly a whole number is one.
      const moved = Math.abs(now - was - Math.round(now - was)) < 0.05 ? Math.round(now - was) : Math.trunc(now - was);
      if (!moved) continue;
      state.base[good] = was + moved;
      const store = here.stores.find((one) => one.goods.some((entry) => entry.good === good));
      const entry = store?.goods.find((one) => one.good === good);
      if (!entry) continue;
      // Never more than a store's usual at once: a ship that takes a thousand crates empties the shelf, no more.
      const key = owedKey(store, entry.item);
      const owed = Math.max(-entry.usual, Math.min(entry.usual, (state.owed[key] ?? 0) + moved));
      if (owed) state.owed[key] = owed;
      else delete state.owed[key];
    }
  }
  // A store never has more of a good than the port does.
  for (const store of here.stores) {
    for (const entry of store.goods) {
      const over = have(store, entry.item) - Math.floor(amountOf(world, place, entry.good) + 1e-6);
      if (over > 0) storeTake(game, store.key, {}, entry.item, over);
    }
  }
  // The jobs under way go on.
  for (const j of [...state.jobs]) {
    const store = here.stores.find((one) => one.id === j.store);
    const over = () => { state.jobs.splice(state.jobs.indexOf(j), 1); };
    // Whoever's no longer up and about, or is down, puts it down: what they carried is the port's wherever it is.
    if (!store || game.down?.[keyAt(place, j.by)] || notAbout(game, place, j.by, hours)) {
      over();
      continue;
    }
    if (j.phase === "going") {
      if (there(game, place, j, t)) Object.assign(j, { phase: "loading", since: t });
    } else if (j.phase === "loading") {
      if (t - j.since < CHUNK) continue;
      if (j.dir === "out") {
        const took = storeTake(game, store.key, {}, j.item, j.n);
        if (took <= 0) {
          over();
          continue;
        }
        j.n = took;
      }
      Object.assign(j, { phase: "carrying", since: t, walk: walkFor(game, place, j.by, j.dir === "in" ? here.dock?.spot : store.spot, j.dir === "in" ? store.spot : here.dock?.spot, hours) });
    } else if (there(game, place, j, t)) {
      if (j.dir === "in") gridPut(game, store.key, j.item, j.n);
      over();
    }
  }
  const days = roomsByDay(game, place, hours);
  const free = here.carriers.filter((key) => !whyNot(game, place, here, state, key, hours, days));
  const send = (store, item, n, dir, ship = false) => {
    const by = free.shift();
    state.seq += 1;
    const to = dir === "in" ? here.dock?.spot : store.spot;
    state.jobs.push({ id: state.seq, store: store.id, item, n, dir, phase: "going", since: t, by, walk: walkFor(game, place, by, null, to, hours), ...(ship ? { ship: true } : {}) });
  };
  // First what's owed a ship off the shelves, or onto them off one, a trip at a time.
  for (const store of here.stores) {
    for (const entry of store.goods) {
      const key = owedKey(store, entry.item);
      while (free.length && state.owed[key]) {
        const owed = state.owed[key];
        // Out of what's still on the shelf and not spoken for: with none left, the rest of it has gone already.
        const most = owed < 0 ? have(store, entry.item) - going(store, entry.item) : Infinity;
        const n = Math.min(Math.abs(owed), tripOf(entry.item), most);
        if (n < 1) {
          delete state.owed[key];
          break;
        }
        send(store, entry.item, n, owed < 0 ? "out" : "in", true);
        if (Math.abs(owed) - n > 0) state.owed[key] = Math.sign(owed) * (Math.abs(owed) - n);
        else delete state.owed[key];
      }
    }
  }
  // Then each store asks for what it's short of, or to be rid of what it has too many of: its share of what the port
  // has, against what it has and what's on its way in or out.
  for (const store of here.stores) {
    if (!free.length) break;
    const counts = storeCounts(game, store.key, {});
    // What stands in it that's the port's and isn't kept here goes back out.
    const kept = new Map(store.goods.map((entry) => [entry.item, entry]));
    const items = [...kept.keys(), ...Object.keys(counts).filter((item) => !kept.has(item) && goodOfItem(place, item))];
    for (const item of items) {
      if (!free.length) break;
      const entry = kept.get(item) ?? null;
      const short = (entry ? shareOf(game, place, entry) : 0) - ((counts[item] ?? 0) + coming(store, item) - going(store, item));
      if (Math.abs(short) < 1) continue;
      send(store, item, Math.min(Math.abs(Math.trunc(short)), tripOf(item)), short > 0 ? "in" : "out");
    }
  }
}

addClockWork((game) => {
  const place = game.location;
  const now = minutesOf(game.clock?.hours ?? 0);
  let state = game.portStores ?? null;
  // Nothing for a place with no port's file, or a port with no stores.
  const here = storesAt(place);
  if (state && (state.place !== place || !here)) {
    leave(game, state);
    state = null;
  }
  if (!here) return [];
  if (!state) {
    arrive(game, place, here, now);
    return [];
  }
  const gap = now - state.at;
  if (gap <= 0) return [];
  // Nobody watched a long wait: the stores are as the port has them, and whoever was carrying is done.
  if (gap > SETTLE_AFTER) {
    arrive(game, place, here, now);
    return [];
  }
  let t = state.at;
  while (t + CHUNK <= now) {
    t += CHUNK;
    look(game, place, here, state, t);
  }
  state.at = t;
  return [];
});

// Whoever's carrying for the port's board is turned aside from their day: to the square beside the store, or to where
// goods come and go.
addDetour((game, place) => {
  const state = game.portStores;
  if (!state || state.place !== place || !state.jobs.length) return null;
  const here = storesAt(place);
  if (!here) return null;
  const mine = new Map();
  for (const j of state.jobs) {
    const spot = spotOf(here, j);
    if (j.by && spot) mine.set(j.by, { where: whereOf(j), doing: doingWords(here, j), spot });
  }
  return mine.size ? (key) => mine.get(key) ?? null : null;
});

// ---- What the player sees -------------------------------------------------------------------------------------------

// A store whose name is more than one thing (the grain sheds, the ore bins) is spoken of as them.
const manyOf = (store) => /s$/i.test(store.name);
// How a store stands against what it usually has, in a few words, or nothing when it's about as usual.
function standingWords(have, usual, many = false) {
  if (!(usual > 0)) return null;
  const share = have / usual;
  const its = many ? "They're" : "It's";
  if (have <= 0) return `${its} bare.`;
  if (share < 0.25) return `${its} nearly bare.`;
  if (share < 0.55) return `${its} more than half empty.`;
  if (share < 0.8) return `There's less in ${many ? "them" : "it"} than usual.`;
  return share >= 1.25 ? `${its} stacked higher than usual.` : null;
}

const nameAt = (place, key) => rosterOf(place).find((one) => one.key === key)?.name ?? findCharacter(null, key)?.name ?? key;

// A port's stores as the page shows them, where the player stands: each with what's in it against what it usually
// has, and the dockhands' board. Null anywhere else. Reading this changes nothing.
export function portStoresView(game) {
  const place = game.location;
  if (!portHasStores(place)) return null;
  const here = storesAt(place);
  if (!here) return null;
  const model = portsModel();
  const state = game.portStores?.place === place ? game.portStores : null;
  const hours = game.clock?.hours ?? 0;
  const stores = here.stores.map((store) => {
    const counts = countsOf(game, place, store);
    const items = store.goods.map((entry) => ({
      id: entry.item,
      good: entry.good,
      name: model.goods[entry.good].name,
      n: counts[entry.item] ?? 0,
      usual: entry.usual,
      level: levelName(levelOf(game.world, place, entry.good)),
      has: counted(model.goods[entry.good], amountOf(game.world, place, entry.good)),
    }));
    const have = items.reduce((sum, one) => sum + one.n, 0);
    const usual = items.reduce((sum, one) => sum + one.usual, 0);
    return { id: store.id, name: upperFirst(store.name), room: store.roomName, items, stands: standingWords(have, usual, manyOf(store)), bare: usual > 0 && have / usual < 0.25 };
  });
  const jobs = (state?.jobs ?? []).map((j) => ({ id: j.id, who: nameAt(place, j.by), doing: doingWords(here, j), since: Math.max(0, Math.round(hours * 60 - j.since)) }));
  // Why nobody's carrying, when something's waiting to be carried.
  const days = roomsByDay(game, place, hours);
  const reasons = here.carriers.map((key) => whyNot(game, place, here, state, key, hours, days));
  const free = reasons.filter((why) => !why).length;
  const counts = {};
  for (const why of reasons) if (why && why !== "carrying already") counts[why] = (counts[why] ?? 0) + 1;
  const idle = Object.entries(counts).map(([why, n]) => `${n} ${why === "out of sight" ? "gone home" : why === "elsewhere" ? "off elsewhere" : why}`);
  return {
    place,
    name: LOCATIONS[place]?.name ?? place,
    owner: ownerWords(place, PORTS_OWN),
    dock: here.dock?.name ?? null,
    stores,
    jobs,
    hands: { of: here.carriers.length, free, idle: listed(idle) },
  };
}

// A port's store in the room: how full it's drawn, what's in it in words, and whose it is.
addThingActs((game, thing) => {
  if (!thing?.portStore) return null;
  const place = game.location;
  const store = storesAt(place)?.stores.find((one) => one.id === thing.portStore);
  if (!store) return null;
  const counts = countsOf(game, place, store);
  const model = portsModel();
  const goods = store.goods.map((entry) => ({ item: entry.item, n: counts[entry.item] ?? 0, of: Math.ceil(entry.usual * 1.5) }));
  const have = goods.reduce((sum, one) => sum + one.n, 0);
  const usual = store.goods.reduce((sum, entry) => sum + entry.usual, 0);
  const there = store.goods.filter((entry) => (counts[entry.item] ?? 0) > 0).map((entry) => counted(model.goods[entry.good], counts[entry.item]));
  const many = manyOf(store);
  const owner = many ? ownerWords(place, PORTS_OWN)?.replace(/^It belongs/, "They belong") ?? null : ownerWords(place, PORTS_OWN);
  const words = [store.baseLook, there.length ? `There ${have === 1 ? "is" : "are"} ${listed(there)} in ${many ? "them" : "it"}.` : null, standingWords(have, usual, many), owner].filter(Boolean).join(" ");
  return { portStore: true, stock: { full: Math.max(0, Math.min(1, usual ? have / (usual * 1.5) : 0)), goods }, look: words, ...(owner ? { owner } : {}) };
});
