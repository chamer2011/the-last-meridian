// What the ports hold, in real amounts (step 7 of the logistics rework). world/goods has the goods, a tree to a file,
// and world/ports a file for each port: what it usually holds of each good and where it sends for more, what it makes
// in a day, and what it uses. Each midnight every port makes what it makes (never past what it usually holds), uses
// what it uses, and sends for what it's running short of to the ports its file names; what's sent leaves the sender
// that day and arrives days later, by the distance on the star map. A sender that's running low itself sends less,
// and nothing once it's down to what it keeps back, so a shortage at a maker reaches the ports it supplies some days
// later, and is over when the hauls arrive again.
//
// A maker needs what it makes things from (part 2): its line says what goes into a day's making, it makes no more
// than it has the goods for, and it takes them from what the port holds. It needs hands and power too: a port short
// of what its people eat and drink has fewer hands at its makers, one short of medicine has more of them laid up,
// and one that's run out of what its makers run on does a part of its work, by hand. The trees say which goods those
// are (hands need, the sick need, power is). So a shortage travels down a tree as well as across the map.
//
// The basic goods come out of the ground (part 3): a port's Ground part says where, and how many at the most a day.
// The ground gives to whatever hands there are, with or without power, and nothing else is made from nothing: every
// other good is made from the goods its tree names, by a maker that says how many of each.
//
// The word every port already has for each of its supplies (plenty, normal, short, scarce) stays where it was, as a
// level where 100 is what the port usually holds: game.world.places[id].goods[supply]. A tree's "stands for" line says
// which good that is (food is the ration crates), so the amount is the level's share of the usual, and whatever sets
// a level sets the amount: the story, a save from before, the ship's own buying. The goods a port holds that no
// supply stands for are kept the same way in game.world.ports[id][good], and what's on its way between ports in
// game.world.hauls, each [from, to, good, how many, days left].
//
// What's going on at a port (world/daily.json's events) does real things here: its makers make less or more, its
// people use more, goods are taken off its market or brought to it, nothing gets in or out, or what was sent to it
// never arrives. This file imports nothing of the game's rules, so the world's day (src/daily.js) can use it.

import { ITEMS, LOCATIONS } from "./data.js";
import { DAILY, PORTS_FILE_PROBLEMS, STAR_MAP, WORLD_GOODS, WORLD_PORTS } from "./world.js";
import { NEEDS, NEED_KEYS, STEPS, numberWords, readGoodLine, readGroundLine, readHoldLine, readMakeLine, readPortStoreLine, readUseLine, slugOf } from "../public/ports-text.js";

// A haul carries what the port brings in over the days the trip takes, and half again: but never more than a day and
// a half's worth over, so that a long trip doesn't empty the port before it's back.
const haulDays = (days) => days + Math.min(days, 3) * 0.5;
// The most a port loads in a day, as a share of what it usually holds: what's asked for beyond that waits a day.
const LOADS_A_DAY = 0.2;
// A port sends for more once a haul would leave it with no more than this share of what it usually holds.
const TOP = 1.1;
// One haul of a good is on its way to a port at a time, and a second once it's down to under this level.
const SECOND_HAUL_UNDER = 65;
// A sender sends whole hauls while it's at this level or better, less below it, and nothing at what it keeps back.
const FULL_ABOVE = 80;
const KEEPS_BACK = 30;
// The least share of a haul worth sending.
const LEAST = 0.25;
// How far a port's use leans, one way and then the other, for days at a time.
const LEAN_KEEPS = 0.92;
const LEAN_SHAKE = 1.2;
const LEAN_SHARE = 0.05;
// A level never goes past twice the usual, however much is brought.
const MOST = 200;
// How far past the usual a port's makers fill it while they're making more than usual.
const GLUT = 1.6;
// A haul takes a day to load and unload, and a day for every so far on the chart, between two days and six.
const CHART_A_DAY = 15;
// What a port's makers do of their work when it's short of what they need besides the goods themselves. Each is whole
// while the good is at its level or better, and falls in a line from there to its least, with none left.
//   hands: what its people eat and drink; sick: its medicine; power: what its makers run on.
const WORK = { hands: { full: 80, least: 0.75 }, sick: { full: 50, least: 0.85 }, power: { full: 50, least: 0.4 } };

// The goods on a port's market: the finished ones, not what they're made from.
const onMarket = (good) => good.step === "developed" || good.step === "advanced";
const round2 = (n) => Math.round(n * 100) / 100;
// A level is kept fine enough that a single crate shows in the biggest store.
const fine = (n) => Math.round(n * 10000) / 10000;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const plain = (words) => String(words ?? "").trim().toLowerCase().replace(/^the\s+/, "").replace(/['’]/g, "");

// ---- The files, made into what's played -------------------------------------------------------------------

let kept = null;
// The files have been read again: what was made of them is made afresh.
export function clearPorts() {
  kept = null;
}

// A place by what a port's file calls it: its id, its name, the name the chart gives it, or another name it goes by.
function placeByWords(words) {
  const want = plain(words);
  if (!want) return null;
  for (const [id, place] of Object.entries(LOCATIONS)) {
    if (id === want || plain(place.name) === want || plain(STAR_MAP.places?.[id]?.short) === want) return id;
    if ((place.aliases ?? []).some((one) => plain(one) === want)) return id;
  }
  return null;
}

export function portsModel() {
  if (kept) return kept;
  const problems = [];
  const at = (folder, id, line, message) => problems.push(`${folder}/${id}.txt${line ? ` (line ${line})` : ""}: ${message}`);
  const goods = {};
  const order = [];
  const trees = {};
  const stands = {};
  const supplyOf = {};
  // The trees that stand for a supply come first, in the supplies' own order, then the rest by name.
  const supplies = Object.keys(DAILY.goods ?? {});
  const place = (file) => (supplies.includes(file.stands?.supply) ? supplies.indexOf(file.stands.supply) : supplies.length);
  const files = Object.entries(WORLD_GOODS).sort((a, b) => place(a[1]) - place(b[1]) || a[0].localeCompare(b[0]));
  for (const [treeId, file] of files) {
    const tree = (trees[treeId] = { id: treeId, name: file.name ?? treeId, goods: [], supply: null, staple: null });
    for (const step of STEPS) {
      for (const raw of file.steps?.[step] ?? []) {
        const read = readGoodLine(raw.text);
        if (read.problem) continue;
        const id = slugOf(read.name);
        if (goods[id]) {
          at("goods", treeId, raw.line, `${read.name} is written twice: it's in ${trees[goods[id].tree].name} too`);
          continue;
        }
        if (read.item && !ITEMS[read.item]) at("goods", treeId, raw.line, `there's no item called ${read.item} in world/items for ${read.name} to be`);
        goods[id] = { id, name: read.name, unit: read.unit, item: read.item && ITEMS[read.item] ? read.item : null, tree: treeId, step, words: read.words, from: read.from ?? [], line: raw.line };
        tree.goods.push(id);
        order.push(id);
      }
    }
  }
  // A good by the words a file uses for it, with or without its last s.
  const goodByWords = (words) => {
    const id = slugOf(words);
    return goods[id] ?? goods[`${id}s`] ?? (id.endsWith("s") ? goods[id.slice(0, -1)] : null) ?? null;
  };
  // What each good is made from, now that every good is known.
  const basics = new Set(Object.values(goods).filter((good) => good.step === "basic").map((good) => good.tree));
  for (const good of Object.values(goods)) {
    good.from = good.from.map((words) => {
      const one = goodByWords(words);
      if (!one) at("goods", good.tree, good.line, `${good.name}: made from ${words}, which isn't a good in world/goods`);
      else if (one.id === good.id) at("goods", good.tree, good.line, `${good.name} can't be made from itself`);
      return one && one.id !== good.id ? one.id : null;
    }).filter(Boolean);
    // Only what comes out of the ground is made from nothing, once a tree has its basic goods written.
    if (good.step === "basic" && good.from.length) at("goods", good.tree, good.line, `${good.name}: a basic good comes out of the ground, and isn't made from anything`);
    else if (good.step !== "basic" && !good.from.length && basics.has(good.tree)) at("goods", good.tree, good.line, `${good.name}: say what it's made from (made from ...). Only the basic goods come out of the ground`);
  }
  // What a port's makers need besides the goods themselves: the goods its hands, its sick and its power go by.
  const work = Object.fromEntries(NEEDS.map((need) => [need, []]));
  for (const [treeId, file] of files) {
    for (const need of NEEDS) {
      const told = file.needs?.[need];
      if (!told) continue;
      const good = goodByWords(told.good);
      if (!good || good.tree !== treeId) at("goods", treeId, told.line, `${NEED_KEYS[need]}: ${told.good}, which isn't one of this tree's goods`);
      else {
        work[need].push(good.id);
        // The makers of the tree a port's power comes from run on what they make.
        if (need === "power") trees[treeId].power = true;
      }
    }
  }
  for (const [treeId, file] of Object.entries(WORLD_GOODS)) {
    if (!file.stands) continue;
    const { supply, good: words, line } = file.stands;
    const good = goodByWords(words);
    if (!DAILY.goods?.[supply]) at("goods", treeId, line, `${supply} isn't one of the supplies every port has a word for: they are ${Object.keys(DAILY.goods ?? {}).join(", ")}`);
    else if (!good || good.tree !== treeId) at("goods", treeId, line, `${words} isn't one of this tree's goods, to stand for ${supply}`);
    else if (stands[supply]) at("goods", treeId, line, `${supply} already stands on ${goods[stands[supply]].name}, in ${trees[goods[stands[supply]].tree].name}`);
    else {
      trees[treeId].supply = supply;
      trees[treeId].staple = good.id;
      stands[supply] = good.id;
      supplyOf[good.id] = supply;
    }
  }

  const ports = {};
  for (const [id, file] of Object.entries(WORLD_PORTS)) {
    if (!LOCATIONS[id] || !STAR_MAP.places?.[id]) {
      at("ports", id, null, `there's no place called ${id} on the star map: a port's file is named for its place, like haven.txt`);
      continue;
    }
    const port = (ports[id] = { id, name: LOCATIONS[id].name, people: file.people ?? null, holds: {}, makes: [], uses: [], use: {}, made: {}, eat: {}, stores: [], carriers: null, dock: null });
    for (const raw of file.holds ?? []) {
      const read = readHoldLine(raw.text);
      if (read.problem) continue;
      const good = goodByWords(read.good);
      if (!good) {
        at("ports", id, raw.line, `there's no good called ${read.good} in world/goods`);
        continue;
      }
      if (port.holds[good.id]) {
        at("ports", id, raw.line, `${good.name} is held twice`);
        continue;
      }
      const from = [];
      for (const words of read.from) {
        const place = placeByWords(words);
        if (!place) at("ports", id, raw.line, `there's no place called ${words} for ${good.name} to come from`);
        else if (place === id) at("ports", id, raw.line, `${good.name} can't come from the port itself: leave the from out if it makes its own`);
        else if (!from.includes(place)) from.push(place);
      }
      port.holds[good.id] = { usual: read.usual, from, line: raw.line };
    }
    // What comes out of the ground here: basic goods, from nothing, as many a day at the most as the line says.
    for (const raw of file.ground ?? []) {
      const read = readGroundLine(raw.text);
      if (read.problem) continue;
      const good = goodByWords(read.good);
      if (!good) at("ports", id, raw.line, `there's no good called ${read.good} in world/goods`);
      else if (good.step !== "basic") at("ports", id, raw.line, `${good.name}: only a basic good comes out of the ground. This one is made, so its line goes under Makes, with what it's made from`);
      else if (!port.holds[good.id]) at("ports", id, raw.line, `${read.name}: ${good.name} come out of the ground here, and the port holds none: add a line for it under Holds`);
      else {
        port.makes.push({ name: read.name, good: good.id, rate: read.n, from: [], ground: true, line: raw.line });
        port.made[good.id] = (port.made[good.id] ?? 0) + read.n;
      }
    }
    for (const raw of file.makes ?? []) {
      const read = readMakeLine(raw.text);
      if (read.problem) continue;
      const good = goodByWords(read.good);
      if (!good) at("ports", id, raw.line, `there's no good called ${read.good} in world/goods`);
      else if (good.step === "basic") at("ports", id, raw.line, `${good.name}: a basic good isn't made, it comes out of the ground. Write the line under Ground, without a from`);
      else if (!port.holds[good.id]) at("ports", id, raw.line, `${read.name} makes ${good.name}, and the port holds none: add a line for it under Holds`);
      else {
        // What goes into a day's making: goods the port holds, and ones the tree says this good is made from.
        const from = [];
        const madeFrom = () => good.from.map((one) => goods[one].name).join(", ");
        for (const entry of read.from) {
          const input = goodByWords(entry.good);
          if (!input) at("ports", id, raw.line, `there's no good called ${entry.good} in world/goods, for ${read.name} to make ${good.name} from`);
          else if (input.id === good.id || from.some((one) => one.good === input.id)) at("ports", id, raw.line, `${read.name} can take ${input.name} once, and not to make ${input.id === good.id ? "itself" : "the same thing twice"}`);
          else if (good.from.length && !good.from.includes(input.id)) at("ports", id, raw.line, `there's no making ${good.name} from ${input.name}, by world/goods/${good.tree}.txt: it says ${madeFrom()}`);
          else if (!port.holds[input.id]) at("ports", id, raw.line, `${read.name}: ${good.name} from ${input.name}, and the port holds no ${input.name}: add a line for it under Holds`);
          else from.push({ good: input.id, n: entry.n });
        }
        if (!read.from.length && good.from.length) at("ports", id, raw.line, `${read.name}: ${good.name} from nothing. Say from how many of what (${madeFrom()}), as in 72 ration packs a day, from 36 meal`);
        port.makes.push({ name: read.name, good: good.id, rate: read.n, from, line: raw.line });
        port.made[good.id] = (port.made[good.id] ?? 0) + read.n;
      }
    }
    for (const raw of file.uses ?? []) {
      const read = readUseLine(raw.text);
      if (read.problem) continue;
      const list = [];
      for (const entry of read.list) {
        const good = goodByWords(entry.good);
        if (!good) at("ports", id, raw.line, `there's no good called ${entry.good} in world/goods`);
        else if (!port.holds[good.id]) at("ports", id, raw.line, `${read.who} use ${good.name}, and the port holds none: add a line for it under Holds`);
        else {
          list.push({ good: good.id, n: entry.n });
          port.use[good.id] = (port.use[good.id] ?? 0) + entry.n;
        }
      }
      port.uses.push({ who: read.who, list, line: raw.line });
    }
    // Where its goods stand in its rooms, for whoever walks them (src/port-stores.js, which finds the rooms and the
    // people): each store by its name, with how many of each good it has when the port has what it usually holds.
    port.carriers = file.carriers ?? null;
    port.dock = file.dock ?? null;
    for (const raw of file.stores ?? []) {
      const read = readPortStoreLine(raw.text);
      if (read.problem) continue;
      const storeId = slugOf(read.name.replace(/^the\s+/i, ""));
      if (!storeId || port.stores.some((one) => one.id === storeId)) {
        at("ports", id, raw.line, `${read.name} is written twice under Stores`);
        continue;
      }
      const list = [];
      for (const entry of read.list) {
        const good = goodByWords(entry.good);
        if (!good) at("ports", id, raw.line, `there's no good called ${entry.good} in world/goods, to keep in ${read.name}`);
        else if (!port.holds[good.id]) at("ports", id, raw.line, `${read.name} keeps ${good.name}, and the port holds none: add a line for it under Holds`);
        else if (!good.item) at("ports", id, raw.line, `${good.name} can't stand in a store: world/goods names no item for it in square brackets, so nobody can carry one`);
        else if (list.some((one) => one.good === good.id)) at("ports", id, raw.line, `${read.name} keeps ${good.name} twice`);
        else list.push({ good: good.id, item: good.item, usual: entry.n });
      }
      if (list.length) port.stores.push({ id: storeId, name: read.name, room: read.room, goods: list, look: read.look, line: raw.line });
    }
  }
  // Where a good comes from has to be a port that holds it.
  for (const port of Object.values(ports)) {
    for (const [good, hold] of Object.entries(port.holds)) {
      hold.from = hold.from.filter((other) => {
        if (ports[other]?.holds[good]) return true;
        at("ports", port.id, hold.line, `${goods[good].name} comes from ${LOCATIONS[other]?.name ?? other}, which ${ports[other] ? "holds none" : "has no file in world/ports"}`);
        return false;
      });
    }
  }
  // The order things are made in: a good after everything any maker makes it from, so that what's made today can go
  // into what's made of it today. Makers of the same good, or of goods that don't depend on each other, keep the
  // order they're written in, and the first written is the first served.
  const madeOf = {};
  for (const port of Object.values(ports)) for (const maker of port.makes) for (const input of maker.from) (madeOf[maker.good] ??= new Set()).add(input.good);
  const rank = {};
  const rankOf = (good, on = new Set()) => {
    if (rank[good] !== undefined) return rank[good];
    if (on.has(good)) return null;
    on.add(good);
    let deepest = 0;
    for (const input of madeOf[good] ?? []) {
      const below = rankOf(input, on);
      if (below === null) {
        at("goods", goods[good].tree, goods[good].line, `making ${goods[good].name} takes ${goods[input].name}, and making ${goods[input].name} takes ${goods[good].name} in the end: one of the ports' makers has to give way`);
        continue;
      }
      deepest = Math.max(deepest, below + 1);
    }
    on.delete(good);
    return (rank[good] = deepest);
  };
  for (const good of order) rankOf(good);
  for (const port of Object.values(ports)) port.makes = port.makes.map((maker, i) => ({ maker, i })).sort((a, b) => (rank[a.maker.good] ?? 0) - (rank[b.maker.good] ?? 0) || a.i - b.i).map((one) => one.maker);
  // What goes through each port in a day when things are as usual: what it uses itself, what its makers take to make
  // what's wanted of them, and what the ports that send to it for a good take. What it has to bring in is that, less
  // what it makes.
  const flow = {};
  const need = {};
  for (const port of Object.values(ports)) {
    flow[port.id] = Object.fromEntries(Object.keys(port.holds).map((good) => [good, port.use[good] ?? 0]));
    need[port.id] = {};
  }
  const needOf = (id, good) => Math.max(0, flow[id][good] - (ports[id].made[good] ?? 0));
  for (let round = 0; round < 60; round += 1) {
    for (const port of Object.values(ports)) {
      // Its makers work as hard as it takes to make what goes out, and take that share of what they're written to.
      const eat = {};
      for (const maker of port.makes) {
        const share = Math.min(1, flow[port.id][maker.good] / port.made[maker.good]);
        for (const input of maker.from) eat[input.good] = (eat[input.good] ?? 0) + input.n * share;
      }
      port.eat = eat;
      for (const good of Object.keys(port.holds)) {
        let out = (port.use[good] ?? 0) + (eat[good] ?? 0);
        for (const other of Object.values(ports)) {
          const from = other.holds[good]?.from;
          if (other !== port && from?.includes(port.id)) out += needOf(other.id, good) / from.length;
        }
        flow[port.id][good] = out;
      }
    }
  }
  for (const port of Object.values(ports)) {
    for (const [good, hold] of Object.entries(port.holds)) {
      need[port.id][good] = hold.from.length ? needOf(port.id, good) : 0;
      const made = port.made[good] ?? 0;
      const taken = port.use[good] || port.eat[good];
      if (!hold.from.length && !made && taken) at("ports", port.id, hold.line, `${goods[good].name} ${port.use[good] ? "is used here" : "goes into what's made here"} and never comes: say where it's from, or who makes it`);
      if (!hold.from.length && made > 0 && made < flow[port.id][good] - 1e-9) at("ports", port.id, hold.line, `${numberWords(flow[port.id][good])} ${goods[good].name} a day are used here, taken by its makers or sent for from here, and ${numberWords(made)} are made: it'll run down`);
    }
  }
  const spot = (id) => STAR_MAP.places[id];
  const days = (a, b) => clamp(1 + Math.ceil(Math.hypot(spot(a).x - spot(b).x, (spot(a).y - spot(b).y) * 2) / CHART_A_DAY), 2, 6);
  kept = { goods, order, trees, stands, supplyOf, work, ports, flow, need, days, goodByWords, placeByWords, problems };
  return kept;
}

// What a port's makers do of their work, going by how it stands for what its hands, its sick and its power need:
// each a share, 1 for all of it, and what it's short of. level gives a good's level there, or nothing if it holds none.
function workOf(model, level) {
  const out = { hands: 1, power: 1, short: [] };
  for (const need of NEEDS) {
    const { full, least } = WORK[need];
    let worst = 1;
    let which = null;
    for (const good of model.work[need]) {
      const now = level(good);
      if (now === null || now === undefined || now >= full) continue;
      const share = least + (1 - least) * (Math.max(0, now) / full);
      if (share < worst) {
        worst = share;
        which = good;
      }
    }
    if (!which) continue;
    out.short.push({ need, good: which, share: worst });
    if (need === "power") out.power *= worst;
    else out.hands *= worst;
  }
  return out;
}
// The same for a port as the save has it today.
export function workAt(world, id, model = portsModel()) {
  const port = model.ports[id];
  if (!port) return null;
  return workOf(model, (good) => (port.holds[good] ? levelOf(world, id, good, model) : null));
}

// What's wrong in the goods' and the ports' files, for npm run check-story.
export const portsProblems = () => [...PORTS_FILE_PROBLEMS, ...portsModel().problems];
export const portsCount = () => ({ ports: Object.keys(portsModel().ports).length, goods: portsModel().order.length, stores: Object.values(portsModel().ports).reduce((sum, port) => sum + port.stores.length, 0) });
// Whether a place has a file, and so real amounts.
export const hasPort = (id) => Boolean(portsModel().ports[id]);

// ---- What a port has -----------------------------------------------------------------------------------------

// A good's level at a port, where 100 is what it usually holds: the supply's own level where the good stands for
// one, and otherwise what's kept for the port's other goods. A port that's never been looked at has the usual.
export function levelOf(world, id, good, model = portsModel()) {
  const supply = model.supplyOf[good];
  const level = supply ? world?.places?.[id]?.goods?.[supply] : undefined;
  return level ?? world?.ports?.[id]?.[good] ?? 100;
}
function setLevel(world, id, good, level, model) {
  const supply = model.supplyOf[good];
  if (supply && world.places?.[id]?.goods?.[supply] !== undefined) world.places[id].goods[supply] = level;
  else ((world.ports ??= {})[id] ??= {})[good] = level;
}
// How many it has: the level's share of the usual.
export function amountOf(world, id, good, model = portsModel()) {
  const hold = model.ports[id]?.holds[good];
  return hold ? (levelOf(world, id, good, model) / 100) * hold.usual : 0;
}
// So many of a good taken out of a port's stores, or put into them when it's fewer than none: the Meridian's
// restocking, and what a distress call brings her. Says how many came out, which is never more than it had.
export function portTake(world, id, good, n) {
  const model = portsModel();
  const hold = model.ports[id]?.holds[good];
  if (!hold || !n) return 0;
  const have = (levelOf(world, id, good, model) / 100) * hold.usual;
  const took = n > 0 ? Math.min(n, have) : n;
  setLevel(world, id, good, fine(clamp(((have - took) / hold.usual) * 100, 0, MOST)), model);
  return took;
}
// What a port usually holds of the good a supply stands on, or nothing if it has no file or holds none.
export function usualOf(id, supply) {
  const model = portsModel();
  return model.ports[id]?.holds[model.stands[supply]]?.usual ?? null;
}

// ---- What's going on there, in real terms ---------------------------------------------------------------------

const NOTHING = Object.freeze({ makes: 1, uses: 1, takes: 0, brings: 0, blocks: false, loses: false, events: Object.freeze([]) });
// What an event does to a supply, as its line in world/daily.json has it: a number is so many hundredths of the
// usual taken a day (below nothing) or brought (above), and anything else says what it does.
function effectOf(value) {
  if (typeof value === "number") return value < 0 ? { takes: -value } : { brings: value };
  return value && typeof value === "object" ? value : {};
}
// The same as the push on a level it used to be, for a place with no file of its own (src/daily.js).
export function pushOf(value) {
  if (typeof value === "number") return value;
  const one = effectOf(value);
  let push = (one.brings ?? 0) - (one.takes ?? 0);
  if (one.makes !== undefined) push += (one.makes - 1) * 8;
  if (one.uses !== undefined) push -= (one.uses - 1) * 4;
  if (one.blocks || one.loses) push -= 4;
  return push;
}
// Everything going on at a port today, a tree at a time.
function effectsAt(world, model, id) {
  const going = world.places?.[id]?.events ?? [];
  if (!going.length) return null;
  const out = {};
  for (const event of going) {
    const file = (DAILY.events ?? []).find((one) => one.id === event.id);
    for (const [key, value] of Object.entries(file?.goods ?? {})) {
      const tree = Object.values(model.trees).find((one) => one.supply === key)?.id ?? (model.trees[key] ? key : null);
      if (!tree) continue;
      const one = effectOf(value);
      const sum = (out[tree] ??= { makes: 1, uses: 1, takes: 0, brings: 0, blocks: false, loses: false, events: [] });
      if (one.makes !== undefined) sum.makes *= Math.max(0, one.makes);
      if (one.uses !== undefined) sum.uses *= Math.max(0, one.uses);
      sum.takes += one.takes ?? 0;
      sum.brings += one.brings ?? 0;
      sum.blocks ||= Boolean(one.blocks);
      sum.loses ||= Boolean(one.loses);
      sum.events.push(file);
    }
  }
  return out;
}

// ---- A day at every port --------------------------------------------------------------------------------------

// A number from a pair of names that's the same every time, to set things going out of step with each other.
function stagger(text, most) {
  let seed = 7;
  for (const ch of text) seed = (Math.imul(seed, 31) + ch.codePointAt(0)) >>> 0;
  return seed % most;
}
// A world that's never had a haul begins as if it had been going all along: each port that sends for a good has one
// on its way, due on a day of its own, so that they don't all send for more on the same morning.
function firstHauls(model) {
  const hauls = [];
  for (const port of Object.values(model.ports)) {
    for (const [good, hold] of Object.entries(port.holds)) {
      const f = model.need[port.id][good];
      if (!hold.from.length || !(f > 0)) continue;
      const from = hold.from[stagger(`${port.id}/${good}`, hold.from.length)];
      const days = model.days(from, port.id);
      hauls.push([from, port.id, good, round2(f * haulDays(days) * 0.5), 1 + stagger(`${good}/${port.id}`, days)]);
    }
  }
  return hauls;
}

// One day at every port with a file. roll gives the world's own dice, kept in the save.
export function portsDay(world, roll) {
  const model = portsModel();
  const ids = Object.keys(model.ports);
  if (!ids.length) return;
  world.hauls ??= firstHauls(model);
  const usual = (id, good) => model.ports[id].holds[good].usual;
  const amount = {};
  const going = {};
  for (const id of ids) {
    amount[id] = {};
    for (const good of Object.keys(model.ports[id].holds)) amount[id][good] = (levelOf(world, id, good, model) / 100) * usual(id, good);
    going[id] = effectsAt(world, model, id);
  }
  const effect = (id, good) => going[id]?.[model.goods[good].tree] ?? NOTHING;

  // What's on its way comes a day nearer, and what's arrived is put away: unless nothing's getting into the port,
  // when it waits off it, or what was sent there is being lost.
  const still = [];
  for (const haul of world.hauls) {
    const [, to, good, n] = haul;
    if (!model.ports[to]?.holds[good]) continue;
    haul[4] -= 1;
    if (haul[4] > 0) {
      still.push(haul);
      continue;
    }
    const now = effect(to, good);
    if (now.blocks) {
      haul[4] = 0;
      still.push(haul);
    } else if (!now.loses) amount[to][good] += n;
  }
  world.hauls = still;

  // Each port makes what it makes, up to what it usually holds and no more than it has the goods, the hands and the
  // power for, and uses what it uses.
  for (const id of ids) {
    const port = model.ports[id];
    const work = workOf(model, (good) => (port.holds[good] ? (amount[id][good] / usual(id, good)) * 100 : null));
    const leans = world.places?.[id] ? (world.places[id].lean ??= {}) : null;
    const lean = {};
    for (const tree of Object.values(model.trees)) {
      if (!tree.goods.some((good) => port.holds[good])) continue;
      const key = tree.supply ?? tree.id;
      const now = Math.round(((leans?.[key] ?? 0) * LEAN_KEEPS + (roll() - 0.5) * 2 * LEAN_SHAKE) * 100) / 100;
      if (leans) leans[key] = now;
      lean[tree.id] = now;
    }
    for (const maker of port.makes) {
      // Up to what it usually holds; and past it, while something has them making more than usual.
      const more = effect(id, maker.good).makes;
      const room = Math.max(0, usual(id, maker.good) * clamp(more, 1, GLUT) - amount[id][maker.good]);
      const share = work.hands * (maker.ground || model.trees[model.goods[maker.good].tree].power ? 1 : work.power);
      let make = Math.min(room, maker.rate * more * share);
      // And no more than there are goods for: what's written goes into a full day's making.
      for (const input of maker.from) make = Math.min(make, (amount[id][input.good] / input.n) * maker.rate);
      if (!(make > 0)) continue;
      for (const input of maker.from) amount[id][input.good] = Math.max(0, amount[id][input.good] - (input.n / maker.rate) * make);
      amount[id][maker.good] += make;
    }
    for (const [good, n] of Object.entries(port.use)) {
      const wanted = n * effect(id, good).uses * Math.max(0.5, 1 + (lean[model.goods[good].tree] ?? 0) * LEAN_SHARE);
      amount[id][good] = Math.max(0, amount[id][good] - wanted);
    }
    // What's taken off its market or brought to it is finished goods: nobody hoards meal, or requisitions scrap.
    for (const good of Object.keys(port.holds)) {
      const now = effect(id, good);
      if ((now.takes || now.brings) && onMarket(model.goods[good])) amount[id][good] = clamp(amount[id][good] + ((now.brings - now.takes) / 100) * usual(id, good), 0, (MOST / 100) * usual(id, good));
    }
  }

  // Each port sends for what it's running short of, a different one first each day. What it brings in is shared
  // between the ports it sends to that have something to send, one haul from each on its way at a time (and a second
  // once it's badly short), the best stocked asked first.
  const onWay = new Map();
  for (const [from, to, good, n] of world.hauls) {
    const key = `${to}/${good}`;
    const one = onWay.get(key) ?? { n: 0, per: {} };
    one.n += n;
    one.per[from] = (one.per[from] ?? 0) + 1;
    onWay.set(key, one);
  }
  const loaded = {};
  const first = world.day % ids.length;
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[(first + i) % ids.length];
    for (const [good, hold] of Object.entries(model.ports[id].holds)) {
      const f = model.need[id][good];
      if (!(f > 0) || effect(id, good).blocks) continue;
      const key = `${id}/${good}`;
      const way = onWay.get(key) ?? { n: 0, per: {} };
      const most = (amount[id][good] / hold.usual) * 100 < SECOND_HAUL_UNDER ? 2 : 1;
      const senders = hold.from.filter((other) => !effect(other, good).blocks)
        .map((other) => ({ id: other, days: model.days(other, id), level: (amount[other][good] / usual(other, good)) * 100 }))
        .filter((sender) => sender.level > KEEPS_BACK)
        .sort((a, b) => b.level - a.level || a.days - b.days);
      for (const sender of senders) {
        if ((way.per[sender.id] ?? 0) >= most) continue;
        const size = (f * haulDays(sender.days)) / senders.length;
        // Not until a haul would leave it with no more than a little over the usual.
        if (amount[id][good] + way.n - sender.days * f + size > TOP * hold.usual) continue;
        const share = sender.level >= FULL_ABOVE ? 1 : (sender.level - KEEPS_BACK) / (FULL_ABOVE - KEEPS_BACK);
        const from = `${sender.id}/${good}`;
        const send = Math.min(size * share, amount[sender.id][good] - (KEEPS_BACK / 100) * usual(sender.id, good));
        if (send < size * LEAST) continue;
        // Its first haul of the day goes whole; one asked for after that, past what it loads in a day, waits.
        if (loaded[from] && loaded[from] + send > LOADS_A_DAY * usual(sender.id, good)) continue;
        loaded[from] = (loaded[from] ?? 0) + send;
        amount[sender.id][good] -= send;
        world.hauls.push([sender.id, id, good, round2(send), sender.days]);
        way.n += send;
        way.per[sender.id] = (way.per[sender.id] ?? 0) + 1;
        onWay.set(key, way);
      }
    }
  }

  for (const id of ids) for (const good of Object.keys(model.ports[id].holds)) setLevel(world, id, good, fine(clamp((amount[id][good] / usual(id, good)) * 100, 0, MOST)), model);
}

// ---- What the map and the market say ---------------------------------------------------------------------------

// "1,180 ration crates", "160 measures of jump fuel", "1 cask of drinking water".
// Whole things: under half of one is hardly any, and none is none. A haul is never less than one.
export function counted(good, n, { least = 0 } = {}) {
  const shown = Math.max(least, Math.round(n));
  if (shown === 0) return `${n > 0 ? "hardly any" : "no"} ${good.name}`;
  if (good.unit) return `${numberWords(shown)} ${good.unit}${shown === 1 ? "" : "s"} of ${good.name}`;
  return `${numberWords(shown)} ${shown === 1 ? good.name.replace(/s$/, "") : good.name}`;
}
const daysWords = (n) => (n <= 1 ? "tomorrow" : `in ${n} days`);
const capital = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
// "a", "a and b", "a, b and c".
const listed = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0] ?? "");
// The game's own word for a level: plenty, normal, short, scarce, almost gone.
const levelWord = (level) => (DAILY.levels ?? []).find((band) => level >= band.from)?.name ?? "normal";
// What a port's makers are short of besides the goods themselves: its hands ("hands (ration crates scarce)") and
// its power, and whether more of its people are laid up. Not its power for a good of the tree its power comes
// from, whose makers run on what they make.
function workWords(world, id, model, tree = null) {
  const short = [];
  let sick = null;
  for (const one of workAt(world, id, model)?.short ?? []) {
    if (one.need === "power" && tree && model.trees[tree].power) continue;
    const what = `${model.goods[one.good].name} ${levelWord(levelOf(world, id, one.good, model))}`;
    if (one.need === "sick") sick = `more of its people are laid up (${what})`;
    else short.push(`${one.need} (${what})`);
  }
  return { short, sick };
}
// How much of their work a port's makers are doing today, and why it isn't all of it: a line, or nothing.
export function workLine(world, id) {
  const model = portsModel();
  const work = workAt(world, id, model);
  if (!work?.short.length || !model.ports[id].makes.length) return null;
  const { short, sick } = workWords(world, id, model);
  const why = [short.length ? `its makers are short of ${listed(short)}` : null, sick].filter(Boolean).join(", and ");
  const tenths = (share) => (share >= 0.95 ? "nearly all" : `about ${["a tenth", "two tenths", "three tenths", "four tenths", "half", "six tenths", "seven tenths", "eight tenths", "nine tenths"][Math.max(1, Math.round(share * 10)) - 1]}`);
  return capital(`${why}: ${short.length ? "they're" : "its makers are"} doing ${tenths(work.hands * work.power)} of their work`);
}

// Why a port is short of a good, as the reasons one after another, or none when it isn't short. deep is for the port
// itself: said of the port it sends to, things are "there" and only what's wrong at it is told. bare is for something
// its own makers lack: what's wrong with the whole port has been said, and "it's just short" isn't worth a bracket.
function reasonsFor(world, id, good, name, deep = true, bare = false) {
  const model = portsModel();
  const hold = model.ports[id]?.holds[good];
  if (!hold || levelOf(world, id, good, model) >= FULL_ABOVE) return [];
  const tree = model.goods[good].tree;
  const now = effectsAt(world, model, id)?.[tree] ?? NOTHING;
  const called = (place) => name(place)?.replace(/^The /, "the ") ?? "a port you don't know of";
  // Said of the port itself, it's here; said of the port it sends to, it's there.
  const here = deep ? "here" : "there";
  const reasons = [];
  const ground = model.goods[good].step === "basic";
  if (now.makes < 1 && model.ports[id].made[good]) reasons.push(ground ? (now.makes <= 0 ? `nothing's coming out of the ground ${here}` : `less is coming out of the ground ${here} than usual`) : now.makes <= 0 ? `nothing's being made ${here}` : `less is being made ${here} than usual`);
  // Its makers are held back: there isn't a day's worth of something they make it from, or they're short of hands
  // or of power, or more of its people are laid up.
  if (model.ports[id].made[good] && now.makes > 0) {
    const short = [];
    for (const maker of model.ports[id].makes) {
      if (maker.good !== good) continue;
      for (const input of maker.from) {
        if (amountOf(world, id, input.good, model) >= input.n || short.some((one) => one.good === input.good)) continue;
        const why = deep ? reasonsFor(world, id, input.good, name, true, true) : [];
        short.push({ good: input.good, text: `${model.goods[input.good].name}${why.length ? ` (${why.join(", and ")})` : ""}` });
      }
    }
    // What comes out of the ground needs hands, and no power.
    const work = bare ? { short: [], sick: null } : workWords(world, id, model, tree);
    if (ground) work.short = work.short.filter((one) => !one.startsWith("power"));
    const all = [...short.map((one) => one.text), ...work.short];
    if (all.length) reasons.push(`its makers are short of ${listed(all)}`);
    if (work.sick) reasons.push(work.sick);
  }
  if (now.uses > 1) reasons.push("it's being used up faster than usual");
  if (now.takes > 0 && onMarket(model.goods[good])) reasons.push("it's being taken off the market");
  if (now.blocks) reasons.push("nothing's getting in or out");
  if (now.loses) reasons.push(`what was sent ${here} never arrived`);
  if (hold.from.length && deep) {
    const coming = (world.hauls ?? []).filter((haul) => haul[1] === id && haul[2] === good).sort((a, b) => a[4] - b[4]);
    if (coming.length && !now.blocks && !now.loses) {
      const [from, , , n, left] = coming[0];
      const one = Math.max(1, Math.round(n)) === 1;
      reasons.push(`${counted(model.goods[good], n, { least: 1 })} from ${called(from)} ${left <= 0 ? `${one ? "is" : "are"} waiting to come in` : `${one ? "is" : "are"} due ${daysWords(left)}`}`);
    } else if (!coming.length) {
      // Nothing's on its way. Whoever it sends to isn't sending, or has little to spare, and may have a reason of
      // its own; or more has only just been sent for.
      const told = [];
      for (const other of hold.from) {
        const theirs = effectsAt(world, model, other)?.[tree] ?? NOTHING;
        const level = levelOf(world, other, good, model);
        if (theirs.blocks) told.push(`nothing's leaving ${called(other)}`);
        else if (level < FULL_ABOVE) {
          const why = reasonsFor(world, other, good, name, false);
          told.push(`${called(other)} has ${level <= KEEPS_BACK ? "none" : "little"} to spare${why.length ? ` (${why.join(", and ")})` : ""}`);
        }
      }
      reasons.push(...(told.length ? told : [`more has been sent for from ${hold.from.map(called).join(" and ")}`]));
    }
  }
  if (!reasons.length && !bare) reasons.push(model.ports[id].made[good] ? (ground ? `more is being taken from ${here} than comes out of the ground` : `more is being taken from ${here} than is made`) : `it's being used faster than it comes`);
  return reasons;
}
// Why a port is short of a good, in a line, or nothing when it isn't. name gives a place's name, or nothing for a
// place the player doesn't know of.
export function whyShort(world, id, good, name = (place) => LOCATIONS[place]?.name ?? null, deep = true) {
  const reasons = reasonsFor(world, id, good, name, deep);
  return reasons.length ? capital(reasons.join(", and ")) : null;
}

// Everything a port holds today, a tree at a time, for whoever wants the whole of it: how many, the word for it,
// what's made and used here in a day, where it comes from, and what's on its way.
export function portHolds(world, id, levelName, name = (place) => LOCATIONS[place]?.name ?? null) {
  const model = portsModel();
  const port = model.ports[id];
  if (!port) return [];
  const called = (place) => name(place)?.replace(/^The /, "the ") ?? "a port you don't know of";
  return Object.values(model.trees).map((tree) => ({
    id: tree.id,
    name: tree.name,
    goods: tree.goods.filter((good) => port.holds[good]).map((good) => {
      const level = levelOf(world, id, good, model);
      const coming = (world.hauls ?? []).filter((haul) => haul[1] === id && haul[2] === good).reduce((sum, haul) => sum + haul[3], 0);
      return {
        id: good,
        name: model.goods[good].name,
        counted: counted(model.goods[good], (level / 100) * port.holds[good].usual),
        level: levelName(level),
        low: level < FULL_ABOVE,
        high: level >= 125,
        made: port.made[good] ?? 0,
        // Where it comes out of the ground here, for a basic good.
        ground: port.makes.filter((maker) => maker.good === good && maker.ground).map((maker) => maker.name),
        // What its makers here make it from, and what they take of it in a day to make other things, as a rule.
        madeFrom: [...new Set(port.makes.filter((maker) => maker.good === good).flatMap((maker) => maker.from.map((input) => model.goods[input.good].name)))],
        taken: port.eat[good] ?? 0,
        used: port.use[good] ?? 0,
        from: port.holds[good].from.map(called),
        coming: coming ? counted(model.goods[good], coming, { least: 1 }) : null,
        why: whyShort(world, id, good, name),
      };
    }),
  })).filter((tree) => tree.goods.length);
}
