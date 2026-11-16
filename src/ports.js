// What the ports hold, in real amounts (step 7 of the logistics rework). world/goods has the goods, a tree to a file,
// and world/ports a file for each port: what it usually holds of each good and where it sends for more, what it makes
// in a day, and what it uses. Each midnight every port makes what it makes (never past what it usually holds), uses
// what it uses, and sends for what it's running short of to the ports its file names; what's sent leaves the sender
// that day and arrives days later, by the distance on the star map. A sender that's running low itself sends less,
// and nothing once it's down to what it keeps back, so a shortage at a maker reaches the ports it supplies some days
// later, and is over when the hauls arrive again.
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
import { STEPS, numberWords, readGoodLine, readHoldLine, readMakeLine, readUseLine, slugOf } from "../public/ports-text.js";

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
        goods[id] = { id, name: read.name, unit: read.unit, item: read.item && ITEMS[read.item] ? read.item : null, tree: treeId, step, words: read.words };
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
    const port = (ports[id] = { id, name: LOCATIONS[id].name, people: file.people ?? null, holds: {}, makes: [], uses: [], use: {}, made: {} });
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
    for (const raw of file.makes ?? []) {
      const read = readMakeLine(raw.text);
      if (read.problem) continue;
      const good = goodByWords(read.good);
      if (!good) at("ports", id, raw.line, `there's no good called ${read.good} in world/goods`);
      else if (!port.holds[good.id]) at("ports", id, raw.line, `${read.name} makes ${good.name}, and the port holds none: add a line for it under Holds`);
      else {
        port.makes.push({ name: read.name, good: good.id, rate: read.n, line: raw.line });
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
  }
  // Where a good comes from has to be a port that holds it.
  for (const port of Object.values(ports)) {
    for (const [good, hold] of Object.entries(port.holds)) {
      hold.from = hold.from.filter((other) => {
        if (ports[other]?.holds[good]) return true;
        at("ports", port.id, hold.line, `${goods[good].name} comes from ${LOCATIONS[other]?.name ?? other}, which ${ports[other] ? "holds none" : "has no file in world/ports"}`);
        return false;
      });
      if (!hold.from.length && !port.made[good] && port.use[good]) at("ports", port.id, hold.line, `${goods[good].name} is used here and never comes: say where it's from, or who makes it`);
    }
  }
  // What goes through each port in a day when things are as usual: what it uses itself, and what the ports that
  // send to it for a good take. What it has to bring in is that, less what it makes.
  const flow = {};
  const need = {};
  for (const port of Object.values(ports)) {
    flow[port.id] = Object.fromEntries(Object.keys(port.holds).map((good) => [good, port.use[good] ?? 0]));
    need[port.id] = {};
  }
  const needOf = (id, good) => Math.max(0, flow[id][good] - (ports[id].made[good] ?? 0));
  for (let round = 0; round < 40; round += 1) {
    for (const port of Object.values(ports)) {
      for (const good of Object.keys(port.holds)) {
        let out = port.use[good] ?? 0;
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
      if (!hold.from.length && made > 0 && made < flow[port.id][good] - 1e-9) at("ports", port.id, hold.line, `${numberWords(flow[port.id][good])} ${goods[good].name} a day are used here or sent for from here, and ${numberWords(made)} are made: it'll run down`);
    }
  }
  const spot = (id) => STAR_MAP.places[id];
  const days = (a, b) => clamp(1 + Math.ceil(Math.hypot(spot(a).x - spot(b).x, (spot(a).y - spot(b).y) * 2) / CHART_A_DAY), 2, 6);
  kept = { goods, order, trees, stands, supplyOf, ports, flow, need, days, goodByWords, placeByWords, problems };
  return kept;
}

// What's wrong in the goods' and the ports' files, for npm run check-story.
export const portsProblems = () => [...PORTS_FILE_PROBLEMS, ...portsModel().problems];
export const portsCount = () => ({ ports: Object.keys(portsModel().ports).length, goods: portsModel().order.length });
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

  // Each port makes what it makes, up to what it usually holds, and uses what it uses.
  for (const id of ids) {
    const port = model.ports[id];
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
      amount[id][maker.good] += Math.min(room, maker.rate * more);
    }
    for (const [good, n] of Object.entries(port.use)) {
      const wanted = n * effect(id, good).uses * Math.max(0.5, 1 + (lean[model.goods[good].tree] ?? 0) * LEAN_SHARE);
      amount[id][good] = Math.max(0, amount[id][good] - wanted);
    }
    for (const good of Object.keys(port.holds)) {
      const now = effect(id, good);
      if (now.takes || now.brings) amount[id][good] = clamp(amount[id][good] + ((now.brings - now.takes) / 100) * usual(id, good), 0, (MOST / 100) * usual(id, good));
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
const lowerFirst = (text) => (text ? text[0].toLowerCase() + text.slice(1) : "");

// Why a port is short of a good, in a line, or nothing when it isn't. name gives a place's name, or nothing for a
// place the player doesn't know of.
export function whyShort(world, id, good, name = (place) => LOCATIONS[place]?.name ?? null, deep = true) {
  const model = portsModel();
  const hold = model.ports[id]?.holds[good];
  if (!hold || levelOf(world, id, good, model) >= FULL_ABOVE) return null;
  const tree = model.goods[good].tree;
  const now = effectsAt(world, model, id)?.[tree] ?? NOTHING;
  const called = (place) => name(place)?.replace(/^The /, "the ") ?? "a port you don't know of";
  // Said of the port itself, it's here; said of the port it sends to, it's there.
  const here = deep ? "here" : "there";
  const reasons = [];
  if (now.makes < 1 && model.ports[id].made[good]) reasons.push(now.makes <= 0 ? `nothing's being made ${here}` : `less is being made ${here} than usual`);
  if (now.uses > 1) reasons.push("it's being used up faster than usual");
  if (now.takes > 0) reasons.push("it's being taken off the market");
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
          const reason = whyShort(world, other, good, name, false);
          told.push(`${called(other)} has ${level <= KEEPS_BACK ? "none" : "little"} to spare${reason ? ` (${lowerFirst(reason)})` : ""}`);
        }
      }
      reasons.push(...(told.length ? told : [`more has been sent for from ${hold.from.map(called).join(" and ")}`]));
    }
  }
  if (!reasons.length) reasons.push(model.ports[id].made[good] ? `more is being taken from ${here} than is made` : `it's being used faster than it comes`);
  const text = reasons.join(", and ");
  return text[0].toUpperCase() + text.slice(1);
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
        used: port.use[good] ?? 0,
        from: port.holds[good].from.map(called),
        coming: coming ? counted(model.goods[good], coming, { least: 1 }) : null,
        why: whyShort(world, id, good, name),
      };
    }),
  })).filter((tree) => tree.goods.length);
}
