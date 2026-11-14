// The grid inventory. Everything the player carries sits somewhere: in hand, worn, on the hip, on the belt, in a pocket
// (things one square big) or in the pack, each item taking squares by its size. game.inventory still says how many of
// each the player has, and every rule in the game reads that; game.bag only says where they are, and it's matched up
// with game.inventory whenever it's read, so whatever gives or takes an item anywhere needs nothing from here. What has
// nowhere to go is carried loose until there's room. Things in rooms with a holds line in their map file can be opened,
// and so can the piles on the floor of what's been dropped or left by the beaten; their contents are in game.stores.
// The numbers are in world/inventory.json, and each item's size, weight and stack in its own file.

import { ITEMS } from "./data.js";
import { INVENTORY } from "./world.js";
import { addItem, attr, removeItem, useItem } from "./rules.js";
import { standingAt } from "./walk.js";
import { notePut } from "./puts.js";
import { rigWeight } from "./rig-parts.js";
import { lootBox, lootOf, lootRoomOf, rollLoot } from "./loot.js";

const R = () => INVENTORY;
const round1 = (n) => Math.round(n * 10) / 10;
const kindOf = (item) => R().kinds?.[item?.type] ?? R().kinds?.gadget ?? { size: "1x1", weight: 0.5, stack: 1 };

// ---- Items: their size, weight and stack ---------------------------------------------------------------

export function sizeOf(item) {
  const [w, h] = String(item?.size ?? kindOf(item).size ?? "1x1").toLowerCase().split("x").map((n) => Math.max(1, Math.round(Number(n)) || 1));
  return { w, h: h ?? 1 };
}
export const weightOf = (item) => Number(item?.weight ?? kindOf(item).weight ?? 0);
export const stackOf = (item) => Math.max(1, Number(item?.stack ?? kindOf(item).stack ?? 1));
const squares = (item) => sizeOf(item).w * sizeOf(item).h;
const pocketable = (item) => squares(item) === 1;
// What can be used in a fight from the belt: supplies that heal or give energy.
export const fightable = (item) => item?.type === "consumable" && Boolean(item.effect?.hp || item.effect?.energy);
export const fitsSidearm = (item) => item?.type === "weapon" && squares(item) <= (R().sidearm?.squares ?? 2);
const SLOT_TAKES = { weapon: (item) => item?.type === "weapon", armor: (item) => item?.type === "armor", sidearm: fitsSidearm };
const SLOT_NAMES = { weapon: "in hand", armor: "worn", sidearm: "on the hip" };

// ---- The load ------------------------------------------------------------------------------------------

export const maxLoad = (game) => (R().load?.base ?? 12) + (R().load?.perMight ?? 3) * attr(game, "might");
// The rig weighs what its board, casing and parts weigh, the spare ones with it included (src/rig-parts.js).
const weightIn = (game, id) => (id === "rig" && game.rig?.parts ? rigWeight(game.rig) : weightOf(ITEMS[id]));
export const loadOf = (game) => round1(Object.entries(game.inventory ?? {}).reduce((sum, [id, n]) => sum + weightIn(game, id) * n, 0));
export const overloaded = (game) => loadOf(game) > maxLoad(game);
// How many times as fast the player tires: more than they can carry wears them out.
export const tiring = (game) => (overloaded(game) ? R().load?.tiring ?? 2 : 1);

// ---- Grids -----------------------------------------------------------------------------------------------

const BELT = () => R().belt?.slots ?? 4;
const boxOf = (name) => (name === "pockets" ? { ...R().pockets, small: true } : name === "pack" ? R().pack : null);

function freeAt(entries, box, x, y, item, except = null) {
  const { w, h } = sizeOf(item);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + w > box.cols || y + h > box.rows) return false;
  if (box.small && !pocketable(item)) return false;
  return !entries.some((one) => {
    if (one === except) return false;
    const s = sizeOf(ITEMS[one.id]);
    return x < one.x + s.w && one.x < x + w && y < one.y + s.h && one.y < y + h;
  });
}
function firstFree(entries, box, item, except = null) {
  const { w, h } = sizeOf(item);
  for (let y = 0; y + h <= box.rows; y += 1) for (let x = 0; x + w <= box.cols; x += 1) if (freeAt(entries, box, x, y, item, except)) return { x, y };
  return null;
}
// Puts n of an item into a grid's entries: onto stacks of it there first, then wherever it fits. Returns what's left over.
function pour(entries, box, id, n) {
  const item = ITEMS[id];
  const stack = stackOf(item);
  for (const one of entries) {
    if (n <= 0) break;
    if (one.id !== id || one.n >= stack) continue;
    const put = Math.min(stack - one.n, n);
    one.n += put;
    n -= put;
  }
  while (n > 0) {
    const spot = firstFree(entries, box, item);
    if (!spot) break;
    const put = Math.min(stack, n);
    entries.push({ id, x: spot.x, y: spot.y, n: put });
    n -= put;
  }
  return n;
}

// ---- Matching the bag to what the player has ----------------------------------------------------------------

const emptyBag = () => ({ pockets: [], pack: [], belt: Array(BELT()).fill(null) });
const cleanEntry = (one) => Boolean(one && ITEMS[one.id] && one.n > 0);

// Where everything is, matched up with game.inventory and what's in hand, worn or on the hip: places for things the
// player no longer has go, and what they have with no place yet gets one, stacks first, small things in a pocket and
// the rest in the pack. A bag made for the first time puts the supplies that work in a fight on the belt. This works on
// a copy, so reading it changes nothing; settleBag keeps what it makes.
export function settledBag(game) {
  const fresh = !game.bag;
  const bag = fresh ? emptyBag() : structuredClone(game.bag);
  bag.pockets = (bag.pockets ?? []).filter(cleanEntry);
  bag.pack = (bag.pack ?? []).filter(cleanEntry);
  bag.belt = Array.from({ length: BELT() }, (_, i) => {
    const one = bag.belt?.[i];
    return cleanEntry(one) && ITEMS[one.id].type === "consumable" ? one : null;
  });
  const left = {};
  for (const [id, n] of Object.entries(game.inventory ?? {})) if (ITEMS[id] && n > 0) left[id] = n;
  for (const slot of ["weapon", "armor", "sidearm"]) {
    const id = game.equipped?.[slot];
    if (id && left[id] > 0) left[id] -= 1;
  }
  const keep = (one) => {
    const n = Math.min(one.n, left[one.id] ?? 0, stackOf(ITEMS[one.id]));
    left[one.id] = (left[one.id] ?? 0) - n;
    one.n = n;
    return n > 0;
  };
  bag.belt = bag.belt.map((one) => (one && keep(one) ? one : null));
  bag.pockets = bag.pockets.filter(keep);
  bag.pack = bag.pack.filter(keep);
  if (fresh) {
    for (const [id, n] of Object.entries(left)) {
      const at = bag.belt.indexOf(null);
      if (at < 0) break;
      if (!fightable(ITEMS[id]) || n <= 0) continue;
      const put = Math.min(n, stackOf(ITEMS[id]));
      bag.belt[at] = { id, n: put };
      left[id] -= put;
    }
  }
  const loose = [];
  for (const [id, total] of Object.entries(left)) {
    if (total <= 0) continue;
    const item = ITEMS[id];
    let n = total;
    // Onto a stack of it on the belt, if there's one.
    for (const one of bag.belt) {
      if (!one || one.id !== id || n <= 0) continue;
      const put = Math.min(stackOf(item) - one.n, n);
      if (put > 0) {
        one.n += put;
        n -= put;
      }
    }
    const order = pocketable(item) && item.type !== "consumable" ? ["pockets", "pack"] : ["pack", "pockets"];
    for (const name of order) n = pour(bag[name], boxOf(name), id, n);
    if (n > 0) loose.push({ id, n });
  }
  return { bag, loose };
}
export function settleBag(game) {
  const { bag, loose } = settledBag(game);
  game.bag = bag;
  return loose;
}

// Whether one more of an item would fit somewhere, which buying it needs.
export function roomFor(game, id) {
  const now = settledBag(game).loose.reduce((sum, one) => sum + one.n, 0);
  const more = settledBag({ ...game, inventory: { ...game.inventory, [id]: (game.inventory?.[id] ?? 0) + 1 } }).loose.reduce((sum, one) => sum + one.n, 0);
  return more <= now;
}

// ---- Things that hold something, and piles on the floor ------------------------------------------------------

const PILE = /^pile:/;
// The things in the room the player's in that can be opened, and the piles lying in it.
function containerHere(game, key) {
  const here = standingAt(game);
  if (!here) return null;
  if (PILE.test(key)) {
    const pile = game.stores?.[key];
    return pile && pile.place === here.place && pile.level === here.levelId ? { key, name: pile.name, box: R().piles, pile } : null;
  }
  const thing = here.things.find((one) => `thing:${here.place}:${one.id}` === key && one.holds);
  if (!thing) return null;
  // A container in a room (src/loot.js) holds as many squares as its kind does, and is filled the first time it's opened.
  const loot = lootOf(here.place, thing);
  return { key, name: thing.name, box: lootBox(loot) ?? R().containers, thing, ...(loot ? { loot, place: here.place, levelId: here.levelId } : {}) };
}
// What a store holds right now, by item: what's kept in the save once it's been opened, and otherwise what its holds
// line says, so the Ship menu reads the same count as the open grid. Reading it changes nothing.
export function storeCounts(game, key, holds) {
  const kept = game.stores?.[key]?.items;
  const counts = {};
  if (kept) for (const one of kept) counts[one.id] = (counts[one.id] ?? 0) + one.n;
  else for (const [id, n] of Object.entries(holds ?? {})) if (ITEMS[id]) counts[id] = Math.max(0, Math.round(Number(n)) || 0);
  return counts;
}
// The ship's machines and people take from a store and put into it without opening it, on the same grid the open
// window shows, so what they did is there when it's opened. What's kept starts from the holds line, like opening it.
function storeItems(game, key, holds) {
  const kept = game.stores?.[key]?.items;
  if (kept) return kept;
  const items = [];
  for (const [id, n] of Object.entries(holds ?? {})) if (ITEMS[id]) pour(items, R().containers, id, Math.max(0, Math.round(Number(n)) || 0));
  return items;
}
function keepStore(game, key, items) {
  game.stores ??= {};
  game.stores[key] = { ...(game.stores[key] ?? {}), items };
}
// Takes up to n of an item out of a store, from its last stacks first. Says how many came out.
export function storeTake(game, key, holds, id, n) {
  const items = storeItems(game, key, holds);
  let left = n;
  for (let i = items.length - 1; i >= 0 && left > 0; i -= 1) {
    if (items[i].id !== id) continue;
    const take = Math.min(items[i].n, left);
    items[i].n -= take;
    left -= take;
    if (items[i].n <= 0) items.splice(i, 1);
  }
  keepStore(game, key, items);
  return n - left;
}
// Puts up to n of an item into a store: never more than its holds line says it keeps, and never more than its
// grid has room for. Says how many went in.
export function storePut(game, key, holds, id, n) {
  const items = storeItems(game, key, holds);
  const have = items.filter((one) => one.id === id).reduce((sum, one) => sum + one.n, 0);
  const want = Math.max(0, Math.min(n, (holds?.[id] ?? 0) - have));
  const left = want > 0 ? pour(items, R().containers, id, want) : 0;
  keepStore(game, key, items);
  return want - left;
}
// Puts up to n of an item back into a container in a room that's been opened, wherever it fits on its grid (src/law.js,
// when someone saw it taken). Says how many went in.
export function containerPut(game, key, box, id, n) {
  const items = [...(game.stores?.[key]?.items ?? [])];
  const left = pour(items, box, id, n);
  keepStore(game, key, items);
  return n - left;
}
// What's in a thing, from its map file's holds line the first time it's opened, or for a container in a room what's
// found in it (src/loot.js); whatever doesn't fit its squares isn't there.
function contentsOf(game, found) {
  if (found.pile) return found.pile.items;
  const kept = game.stores?.[found.key]?.items;
  if (kept) return kept;
  const items = [];
  if (found.loot) {
    for (const { id, n } of rollLoot(game, found.key, found.loot, found.place, lootRoomOf(found.place, found.levelId, found.thing))) pour(items, found.box, id, n);
    return items;
  }
  for (const [id, n] of Object.entries(found.thing.holds ?? {})) if (ITEMS[id]) pour(items, found.box, id, Math.max(0, Math.round(Number(n)) || 0));
  return items;
}
function keepContents(game, found, items) {
  game.stores ??= {};
  if (found.pile) {
    found.pile.items = items;
    if (!items.length) delete game.stores[found.key];
  } else game.stores[found.key] = { items };
}
// The piles in a room, as things the room shows: what you dropped, and what people you beat left.
export function pilesIn(game, place, levelId) {
  return Object.entries(game.stores ?? {})
    .filter(([key, one]) => PILE.test(key) && one.place === place && one.level === levelId && one.items?.length)
    .map(([key, one]) => ({ id: key, name: one.name, x: one.x, y: one.y, look: one.look ?? `${one.items.length === 1 ? "Something" : "A few things"} on the floor: ${one.items.map((it) => ITEMS[it.id]?.name).filter(Boolean).join(", ")}.`, pile: true, holds: true, written: true }));
}
// A pile on the floor where the player stands, made if there isn't one.
function pileHere(game, name, look = null) {
  const here = standingAt(game);
  if (!here) return null;
  game.stores ??= {};
  const found = Object.entries(game.stores).find(([key, one]) => PILE.test(key) && one.place === here.place && one.level === here.levelId && one.x === here.x && one.y === here.y && one.name === name);
  if (found) return { key: found[0], name, box: R().piles, pile: found[1] };
  game.pileCount = (game.pileCount ?? 0) + 1;
  const key = `pile:${game.pileCount}`;
  game.stores[key] = { name, look, place: here.place, level: here.levelId, x: here.x, y: here.y, items: [] };
  return { key, name, box: R().piles, pile: game.stores[key] };
}

// What the people beaten in a fight leave on the floor: each one's loot line, or the usual chances, and now and then the
// weapon they fought with, when it's one of the game's items. A machine leaves only what its own loot line says.
export function leaveLoot(game, beaten, roll = Math.random) {
  const found = [];
  const usual = Object.fromEntries(Object.entries(R().loot?.chances ?? {}).filter(([id]) => ITEMS[id]));
  for (const enemy of beaten) {
    const own = enemy.loot && Object.keys(enemy.loot).length ? enemy.loot : null;
    if (enemy.machine && !own) continue;
    for (const [id, chance] of Object.entries(own ?? usual)) if (ITEMS[id] && roll() * 100 < chance) found.push(id);
    const weapon = Object.keys(ITEMS).find((id) => ITEMS[id].type === "weapon" && ITEMS[id].name.toLowerCase() === String(enemy.weapon ?? "").toLowerCase());
    if (weapon && roll() * 100 < (R().loot?.weapon ?? 25)) found.push(weapon);
  }
  if (!found.length) return [];
  const pile = pileHere(game, "What they left", "What the people you beat had on them, on the floor.");
  if (!pile) return [];
  const items = pile.pile.items;
  const left = [];
  for (const id of found) if (pour(items, pile.box, id, 1) === 0) left.push(ITEMS[id].name);
  return left;
}

// ---- Fights: the belt and the sidearm --------------------------------------------------------------------------

// The supplies on the belt that can be used in a fight.
export const beltSupplies = (game) => settledBag(game).bag.belt.filter((one) => one && fightable(ITEMS[one.id]));
// One of an item used from the belt in a fight comes off the belt.
export function spendFromBelt(game, id) {
  settleBag(game);
  const one = game.bag.belt.find((entry) => entry?.id === id);
  if (!one) throw new Error("That isn't on your belt.");
  one.n -= 1;
  if (one.n <= 0) game.bag.belt[game.bag.belt.indexOf(one)] = null;
}
// The weapon being used: the one in hand, or the sidearm once it's been drawn in this fight.
export const drawnWeapon = (game) => (game.combat?.drawn && game.equipped?.sidearm ? game.equipped.sidearm : game.equipped?.weapon ?? null);

// ---- What the page shows -------------------------------------------------------------------------------------

function itemFacts(id, extra = {}) {
  const item = ITEMS[id];
  const { w, h } = sizeOf(item);
  return { id, name: item.name, type: item.type, w, h, weight: weightOf(item), stack: stackOf(item), desc: item.desc ?? "", price: item.price ?? 0, damage: item.damage ?? null, defense: item.defense ?? null, effect: item.effect ?? null, sidearm: fitsSidearm(item), fight: fightable(item), ...(item.art?.length ? { art: item.art } : {}), ...(item.read ? { read: item.read } : {}), ...extra };
}
// Reading this changes nothing in the save.
export function bagView(game) {
  const { bag, loose } = settledBag(game);
  const gear = Object.fromEntries(["weapon", "armor", "sidearm"].map((slot) => [slot, game.equipped?.[slot] && ITEMS[game.equipped[slot]] ? itemFacts(game.equipped[slot]) : null]));
  const grid = (name) => ({ ...R()[name], items: bag[name].map((one) => itemFacts(one.id, { x: one.x, y: one.y, n: one.n })) });
  const found = game.looting ? containerHere(game, game.looting) : null;
  return {
    gear,
    belt: bag.belt.map((one) => (one ? itemFacts(one.id, { n: one.n }) : null)),
    pockets: grid("pockets"),
    pack: grid("pack"),
    loose: loose.map((one) => itemFacts(one.id, { n: one.n })),
    load: loadOf(game),
    maxLoad: maxLoad(game),
    overloaded: overloaded(game),
    tiring: R().load?.tiring ?? 2,
    sidearmSquares: R().sidearm?.squares ?? 2,
    open: found ? { key: found.key, name: found.name, cols: found.box.cols, rows: found.box.rows, items: contentsOf(game, found).map((one) => itemFacts(one.id, { x: one.x, y: one.y, n: one.n })) } : null,
  };
}

// ---- What the player does with it --------------------------------------------------------------------------

const GRIDS = ["pockets", "pack"];
const name = (id) => ITEMS[id]?.name ?? id;

// What's at a place in the bag, or in the thing that's open: { id, n, take(n) } where take removes that many from there.
function pick(game, where, found) {
  const at = where?.at;
  if (GRIDS.includes(at) || at === "open") {
    const list = at === "open" ? contentsOf(game, found) : game.bag[at];
    const entry = list.find((one) => one.x === where.x && one.y === where.y);
    if (!entry) return null;
    return { id: entry.id, n: entry.n, list, entry, take: (n) => { entry.n -= n; if (entry.n <= 0) list.splice(list.indexOf(entry), 1); } };
  }
  if (at === "belt") {
    const entry = game.bag.belt[where.i];
    if (!entry) return null;
    return { id: entry.id, n: entry.n, entry, take: (n) => { entry.n -= n; if (entry.n <= 0) game.bag.belt[where.i] = null; } };
  }
  if (SLOT_TAKES[at]) {
    const id = game.equipped?.[at];
    return id ? { id, n: 1, slot: at, take: () => { game.equipped[at] = null; } } : null;
  }
  if (at === "loose") {
    const entry = settledBag(game).loose.find((one) => one.id === where.id);
    return entry ? { id: entry.id, n: entry.n, loose: true, take: () => {} } : null;
  }
  return null;
}

function openFound(game) {
  if (!game.looting) return null;
  const found = containerHere(game, game.looting);
  if (!found) game.looting = null;
  return found;
}

// Moves what's at one place to another: within the bag, onto the gear and off it, and in and out of what's open.
function move(game, from, to) {
  const found = openFound(game);
  if ((from?.at === "open" || to?.at === "open") && !found) throw new Error("Nothing's open.");
  const source = pick(game, from, found);
  if (!source) throw new Error("There's nothing there.");
  const item = ITEMS[source.id];
  const intoStore = to.at === "open" && from.at !== "open";
  const outOfStore = from.at === "open" && to.at !== "open";
  const count = SLOT_TAKES[to.at] ? 1 : source.n;
  // Onto the gear.
  if (SLOT_TAKES[to.at]) {
    if (!SLOT_TAKES[to.at](item)) throw new Error(to.at === "sidearm" ? `Only a weapon of ${R().sidearm?.squares ?? 2} squares or fewer goes on the hip.` : `The ${item.name} doesn't go there.`);
    if (from.at === to.at) return {};
    if (to.at === "weapon" && game.equipped.sidearm === source.id && from.at !== "sidearm" && (game.inventory[source.id] ?? 0) < 2) throw new Error("That one's on your hip.");
    const old = game.equipped[to.at];
    if (outOfStore) {
      addItem(game, source.id, 1);
      notePut(game, found.key, source.id, -1);
    }
    source.take(1);
    if (from.at === "sidearm" || from.at === "weapon" || from.at === "armor") game.equipped[from.at] = null;
    // What was there goes where this came from, if that's gear it fits; otherwise back in the bag.
    if (old && SLOT_TAKES[from.at]?.(ITEMS[old])) game.equipped[from.at] = old;
    game.equipped[to.at] = source.id;
    if (outOfStore) keepContents(game, found, contentsOf(game, found));
    return { said: `${capital(SLOT_NAMES[to.at])}: the ${item.name}.` };
  }
  // Onto the belt.
  if (to.at === "belt") {
    const i = Number(to.i);
    if (!Number.isInteger(i) || i < 0 || i >= BELT()) throw new Error("There's no such place on the belt.");
    if (item.type !== "consumable") throw new Error("Only supplies go on the belt.");
    const there = game.bag.belt[i];
    if (there && there.id !== source.id) throw new Error("There's something on the belt there already.");
    const room = stackOf(item) - (there?.n ?? 0);
    const n = Math.min(room, count);
    if (n <= 0) throw new Error("That place on the belt is full.");
    if (outOfStore) {
      addItem(game, source.id, n);
      notePut(game, found.key, source.id, -n);
    }
    if (from.at !== "loose") source.take(n);
    game.bag.belt[i] = { id: source.id, n: (there?.n ?? 0) + n };
    if (outOfStore) keepContents(game, found, contentsOf(game, found));
    return { said: outOfStore ? `Took the ${item.name}, onto your belt.` : `On your belt: ${item.name}.`, quiet: !outOfStore };
  }
  // Into a grid: a pocket, the pack, or what's open.
  const list = to.at === "open" ? contentsOf(game, found) : game.bag[to.at];
  const box = to.at === "open" ? found.box : boxOf(to.at);
  if (!list || !box) throw new Error("There's no such place.");
  const x = Number(to.x);
  const y = Number(to.y);
  const onto = list.find((one) => one.x === x && one.y === y && one.id === source.id && one !== source.entry);
  const moving = source.entry && source.list === list ? source.entry : null;
  if (onto) {
    const n = Math.min(stackOf(item) - onto.n, count);
    if (n <= 0) throw new Error("That stack's full.");
    if (intoStore) removeHeld(game, source, n);
    else if (outOfStore) addItem(game, source.id, n);
    if (intoStore || outOfStore) notePut(game, found.key, source.id, intoStore ? n : -n);
    if (!intoStore && from.at !== "loose") source.take(n);
    onto.n += n;
  } else {
    if (!freeAt(list, box, x, y, item, moving)) throw new Error(box.small && !pocketable(item) ? "Only things one square big go in a pocket." : `The ${item.name} doesn't fit there.`);
    if (moving) {
      moving.x = x;
      moving.y = y;
    } else {
      const n = count;
      if (intoStore) removeHeld(game, source, n);
      else if (outOfStore) addItem(game, source.id, n);
      // What the player carries into a store, or out of it, counts for anything someone's asked them to bring.
      if (intoStore || outOfStore) notePut(game, found.key, source.id, intoStore ? n : -n);
      if (!intoStore && from.at !== "loose") source.take(n);
      list.push({ id: source.id, x, y, n });
    }
  }
  if (to.at === "open" || from.at === "open") keepContents(game, found, list === contentsOf(game, found) ? list : contentsOf(game, found));
  if (intoStore) return { said: `Put the ${item.name} in ${lowerFirst(found.name)}.` };
  if (outOfStore) return { said: `Took the ${item.name}.` };
  return {};
}
// Something the player has leaves them: off the gear or out of the bag, and out of what they own.
function removeHeld(game, source, n) {
  if (source.slot) game.equipped[source.slot] = null;
  else if (!source.loose) source.take(n);
  removeItem(game, source.id, n);
}

const capital = (words) => words.charAt(0).toUpperCase() + words.slice(1);
const lowerFirst = (words) => (/^(The|A|An) /.test(words) ? words.charAt(0).toLowerCase() + words.slice(1) : words);

// Equips something from wherever it is to the gear it goes in, or takes it off into the bag.
function equipFrom(game, from) {
  const source = pick(game, from, openFound(game));
  if (!source) throw new Error("There's nothing there.");
  const item = ITEMS[source.id];
  if (source.slot) return stow(game, from);
  if (item.type === "consumable") {
    const i = game.bag.belt.findIndex((one) => one?.id === source.id && one.n < stackOf(item));
    const at = i >= 0 ? i : game.bag.belt.indexOf(null);
    if (at < 0) throw new Error("Your belt's full.");
    return move(game, from, { at: "belt", i: at });
  }
  const slot = item.type === "armor" ? "armor" : item.type === "weapon" ? (game.equipped.weapon && fitsSidearm(item) && !game.equipped.sidearm ? "sidearm" : "weapon") : null;
  if (!slot) throw new Error(`The ${item.name} isn't something to wear or carry in hand.`);
  return move(game, from, { at: slot });
}

function useFrom(game, from) {
  const source = pick(game, from, null);
  if (!source || from.at === "open") throw new Error("There's nothing there.");
  if (ITEMS[source.id].type !== "consumable") throw new Error("That can't be used from here.");
  source.take(1);
  return { said: `[ITEM] ${useItem(game, source.id)}` };
}

// Reading what's written on something, carried or in what's open: the words go in What you know, once, under the
// item's name (the loot's drafts in world/items have a When read part). The page shows the words; this keeps them.
function readFrom(game, from) {
  const source = pick(game, from, openFound(game));
  if (!source) throw new Error("There's nothing there.");
  const item = ITEMS[source.id];
  if (!item.read) throw new Error(`There's nothing written on the ${item.name}.`);
  return { said: `You read the ${item.name}.${keepWords(game, source.id, item) ? " It's in What you know now." : ""}` };
}
function keepWords(game, id, item) {
  game.lore ??= [];
  const key = `item:${id}`;
  if (game.lore.some((entry) => entry.id === key)) return false;
  const taken = game.lore.some((entry) => entry.name.toLowerCase() === item.name.toLowerCase());
  game.lore.push({ id: key, name: taken ? `${item.name}, read` : item.name, kind: "concept", text: String(item.read).slice(0, 600) });
  return true;
}

function splitAt(game, from) {
  const found = openFound(game);
  const source = pick(game, from, found);
  if (!source?.entry || source.n < 2 || !source.list) throw new Error("There's nothing to split there.");
  const box = from.at === "open" ? found.box : boxOf(from.at);
  const half = Math.floor(source.n / 2);
  const spot = firstFree(source.list, box, ITEMS[source.id]);
  if (!spot) throw new Error("There's no room to split it.");
  source.entry.n -= half;
  source.list.push({ id: source.id, x: spot.x, y: spot.y, n: half });
  if (from.at === "open") keepContents(game, found, source.list);
  return { said: `Split the ${name(source.id)} into ${source.entry.n} and ${half}.`, quiet: true };
}

// Into what's open, or onto the floor where the player stands.
function dropFrom(game, from) {
  const found = openFound(game);
  const source = pick(game, from, found);
  if (!source || from.at === "open") throw new Error("There's nothing there.");
  const item = ITEMS[source.id];
  if (item.type === "story" && !item.price) throw new Error("You should hold on to that.");
  const into = found ?? pileHere(game, "Things you left", "What you put down here.");
  if (!into) throw new Error("There's nowhere to put it down here.");
  const items = contentsOf(game, into);
  const before = source.n;
  const left = pour(items, into.box, source.id, before);
  const n = before - left;
  if (!n) throw new Error(found ? `There's no room in ${lowerFirst(found.name)}.` : "There's no room to put it down here.");
  removeHeld(game, source, n);
  // Put into a store or a container, it counts the same as dragging it in: for what someone's asked the player to
  // bring, and so that taking back what's the player's own isn't taking someone else's (src/law.js).
  if (found && !found.pile) notePut(game, found.key, source.id, n);
  keepContents(game, into, items);
  return { said: found ? `Put the ${item.name} in ${lowerFirst(found.name)}.` : `Put the ${item.name} down on the floor. It'll be there if you come back for it.` };
}

// From what's open, wherever it fits in the bag.
function takeFrom(game, from) {
  const found = openFound(game);
  if (!found) throw new Error("Nothing's open.");
  const source = pick(game, from, found);
  if (!source) throw new Error("There's nothing there.");
  const item = ITEMS[source.id];
  const order = pocketable(item) && item.type !== "consumable" ? ["pockets", "pack"] : ["pack", "pockets"];
  let n = source.n;
  for (const grid of order) {
    const copy = structuredClone(game.bag[grid]);
    const left = pour(copy, boxOf(grid), source.id, n);
    if (left === n) continue;
    game.bag[grid] = copy;
    n = left;
    if (!n) break;
  }
  const took = source.n - n;
  if (!took) throw new Error(`There's no room in your pack for the ${item.name}.`);
  addItem(game, source.id, took);
  notePut(game, found.key, source.id, -took);
  source.take(took);
  keepContents(game, found, source.list);
  return { said: `Took the ${item.name}${took > 1 ? ` x${took}` : ""}.` };
}

// Off the gear or the belt, into the bag wherever it fits, or into the player's hands when there's no room.
function stow(game, from) {
  const source = pick(game, from, null);
  if (!source || !(SLOT_TAKES[from.at] || from.at === "belt")) throw new Error("There's nothing there to put away.");
  source.take(source.n);
  const item = ITEMS[source.id];
  const quiet = from.at === "belt";
  if (settledBag(game).loose.some((one) => one.id === source.id)) return { said: `There's no room for the ${item.name}, so you're carrying it in your hands.`, quiet };
  return { said: `The ${item.name} goes in your ${pocketable(item) && item.type !== "consumable" ? "pocket" : "pack"}.`, quiet };
}

function open(game, key) {
  const found = containerHere(game, key);
  if (!found) throw new Error("That isn't here to open.");
  game.looting = key;
  // A thing opened for the first time keeps what was in it from then on.
  if (!found.pile && !game.stores?.[key]) keepContents(game, found, contentsOf(game, found));
  return { said: null };
}

// Everything the inventory window does. Nothing changes gear in the middle of a fight: the belt is in the fight's buttons.
// What it says is for the window; quiet means it only rearranged the bag, so it's kept out of the story's log.
export function bagCommand(game, body) {
  if (game.combat) throw new Error("Not in the middle of a fight. What's on your belt is in the fight's own buttons.");
  settleBag(game);
  let reply;
  switch (body.action) {
    case "move": reply = move(game, body.from, body.to ?? {}); break;
    case "equip": reply = equipFrom(game, body.from); break;
    case "stow": reply = stow(game, body.from); break;
    case "use": reply = useFrom(game, body.from); break;
    case "read": reply = readFrom(game, body.from); break;
    case "split": reply = splitAt(game, body.from); break;
    case "drop": reply = dropFrom(game, body.from); break;
    case "take": reply = takeFrom(game, body.from); break;
    case "open": reply = open(game, String(body.key ?? "")); break;
    case "close":
      game.looting = null;
      reply = {};
      break;
    default: throw new Error("Unknown order.");
  }
  settleBag(game);
  return { said: reply?.said ?? null, quiet: Boolean(reply?.quiet) };
}
