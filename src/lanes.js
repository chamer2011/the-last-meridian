// The lanes between the ports (step 13 of the logistics rework). Everything a port sends for travels in a freighter
// with a name: src/ports.js keeps the hauls, each [from, to, good, how many, days left], and this file says which ship
// each haul is in. A ship is every haul that left one port for another on the same day; its number is written on each
// of its hauls, as a sixth thing, and game.world.ships keeps, by that number, which of its run's names the ship has
// and whatever has happened to her since (hailed, sold from, boarded, promised an escort). Everything else about a
// ship is worked out from her hauls: her run, how far along it she is, and who she flies for.
//
// A freighter loads for a day at the port that's sending (its hauls have as many days left as the run takes), is
// under way for the days between, and unloads on its last day where it's bound, where its goods go into the port's
// stores at midnight. One that can't get in waits off the port. One whose goods are lost never arrives.
//
// Like src/ports.js this imports nothing of the game's rules, so the world's day (src/daily.js) can use it. What a
// freighter's coming and going means to the player (an escort paid, the news) is told to src/freighters.js, which
// can't be imported from here.

import fs from "node:fs";
import path from "node:path";
import { LOCATIONS } from "./data.js";
import { worldDir } from "./paths.js";
import { blockedAt, levelOf, losingAt, portTake, portsModel } from "./ports.js";
import { STAR_MAP } from "./world.js";

export const FREIGHTERS_FILE = process.env.GAME_FREIGHTERS_FILE ?? path.join(worldDir, "freighters.txt");
// What the captain did about a freighter goes on the record, the latest of each kind, for a story to ask about
// (src/freighters.js leaves them; the checker knows them from here).
export const FREIGHTER_FACTS = ["boarded_a_freighter", "robbed_a_freighter", "escorted_a_freighter"];

// ---- The file -----------------------------------------------------------------------------------------

const words = (text) => text.split(",").map((one) => one.trim()).filter(Boolean);
const LINES = {
  "names begin": [/^(.+)$/, (f) => words(f[1]), "Long, Quiet, Patient"],
  "names end": [/^(.+)$/, (f) => words(f[1]), "Tally, Margin, Ledger"],
  "the master sells": [/^(\d+) percent of what's aboard$/i, (f) => ({ share: Number(f[1]) / 100 }), "50 percent of what's aboard"],
  "an escort pays": [/^(\d+) credits a measure of fuel, times the danger, from danger (\d)$/i, (f) => ({ rate: Number(f[1]), from: Number(f[2]) }), "20 credits a measure of fuel, times the danger, from danger 2"],
  "an escort earns": [/^(\d+) standing with whoever she flies for$/i, (f) => ({ standing: Number(f[1]) }), "1 standing with whoever she flies for"],
  "the crew": [/^a master and (\d) hands?, (\d) hands for a load worth over (\d+) credits$/i, (f) => ({ hands: Number(f[1]), more: Number(f[2]), over: Number(f[3]) }), "a master and 1 hand, 2 hands for a load worth over 1500 credits"],
  "the crew fights as": [/^([a-z_ ]+), ([a-z_ ]+)$/i, (f) => ({ master: f[1].trim().toLowerCase().replace(/ /g, "_"), hand: f[2].trim().toLowerCase().replace(/ /g, "_") }), "freighter_master, freighter_hand"],
  "a boarding costs": [/^(\d+) standing with whoever she flies for, (\d+) with whoever holds the port$/i, (f) => ({ flag: Number(f[1]), port: Number(f[2]) }), "10 standing with whoever she flies for, 5 with whoever holds the port"],
  "a boarding is fought at": [/^(.+)$/, (f) => ({ room: f[1].trim() }), "The Port Airlock"],
};
// A line the file can do without: with no room named for a boarding, it's fought aboard the freighter, in the fight
// window (src/freighters.js).
const OPTIONAL = new Set(["a boarding is fought at"]);

export function parseFreighters(text) {
  const model = { problems: [] };
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^draft:/i.test(line)) return;
    const found = line.match(/^([a-z' ]+): (.+)$/i);
    const reader = found ? LINES[found[1].toLowerCase()] : null;
    if (!reader) return model.problems.push(`world/freighters.txt, line ${i + 1}: a line here is one of: ${Object.keys(LINES).join(", ")}`);
    const read = found[2].trim().match(reader[0]);
    if (!read) return model.problems.push(`world/freighters.txt, line ${i + 1}: "${found[1]}" is written like: ${reader[2]}`);
    model[found[1].toLowerCase()] = reader[1](read);
  });
  const missing = Object.keys(LINES).filter((name) => !model[name] && !OPTIONAL.has(name));
  if (missing.length) model.problems.push(`world/freighters.txt: there's no line for ${missing.join(", ")}, so no freighter has a name`);
  for (const key of ["names begin", "names end"]) if (model[key] && model[key].length < 8) model.problems.push(`world/freighters.txt: "${key}" has ${model[key].length} words, and with so few two ships will share a name: give it eight or more`);
  model.whole = !missing.length;
  return model;
}

let read;
export function freighterRules() {
  if (read === undefined) read = fs.existsSync(FREIGHTERS_FILE) ? parseFreighters(fs.readFileSync(FREIGHTERS_FILE, "utf8")) : null;
  return read?.whole ? read : null;
}
export const forgetFreighters = () => { read = undefined; };
export const freighterFileProblems = () => (fs.existsSync(FREIGHTERS_FILE) ? (freighterRules(), read.problems) : []);

// ---- Which ship a haul is in ----------------------------------------------------------------------------

// The same number from the same words, every time: a ship's name comes from its run, not from the world's dice.
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
// The names of a run: its first ship has one, its second another, and so on, so that the same ship is back on the
// run once she's come in. Past the names the lists can make, she has a number.
const MOST_SLOTS = 60;
function nameAt(rules, from, to, slot) {
  const first = rules["names begin"];
  const second = rules["names end"];
  if (slot >= MOST_SLOTS) return `the ${first[hash(`${from}>${to}`) % first.length]} ${second[hash(`${to}>${from}`) % second.length]} ${slot - MOST_SLOTS + 2}`;
  const h = hash(`${from}>${to}/${slot}`);
  return `the ${first[h % first.length]} ${second[Math.floor(h / first.length) % second.length]}`;
}

// Every ship with what it carries: the hauls that have its number, by that number (as words, as a save keeps it).
export function loadsByShip(world) {
  const loads = new Map();
  for (const haul of world?.hauls ?? []) {
    if (haul[5] === undefined || haul[5] === null) continue;
    const id = String(haul[5]);
    const list = loads.get(id);
    if (list) list.push(haul);
    else loads.set(id, [haul]);
  }
  return loads;
}

// A ship as the rest of the game sees her, from what's kept of her and her hauls: her name, her run and how long it
// is, and who she flies for, which is whoever holds the port she sails from. memo is what the save keeps, for
// whatever happens to her to be written on. Null for a ship nobody has, or with nothing aboard.
export function shipOf(world, id, hauls, model = portsModel()) {
  const rules = freighterRules();
  const memo = world?.ships?.[id];
  if (!rules || !memo || !hauls?.length) return null;
  const [from, to] = hauls[0];
  return { id: String(id), name: nameAt(rules, from, to, memo.slot), from, to, total: model.days(from, to), flies: world.places?.[from]?.holder ?? LOCATIONS[from]?.faction ?? null, memo };
}
// Every ship on the lanes, each with her hauls.
export function shipsOn(world, model = portsModel()) {
  const out = [];
  for (const [id, hauls] of loadsByShip(world)) {
    const ship = shipOf(world, id, hauls, model);
    if (ship) out.push({ ship, hauls });
  }
  return out;
}

// Every haul that has no ship yet is given one: with the other hauls that left its port for where it's going on the
// same day, a new ship, with the first of the run's names that no ship has just now. Then whatever was kept of the
// ships that carry nothing any more is forgotten.
export function assignShips(world, model = portsModel()) {
  const rules = freighterRules();
  if (!rules || !world?.hauls) return;
  const ships = (world.ships ??= {});
  const used = new Set();
  const carrying = new Set();
  const fresh = new Map();
  for (const haul of world.hauls) {
    const id = haul[5] === undefined || haul[5] === null ? null : String(haul[5]);
    if (id !== null && ships[id]) {
      carrying.add(id);
      used.add(nameAt(rules, haul[0], haul[1], ships[id].slot));
      continue;
    }
    const key = `${haul[0]}>${haul[1]}@${haul[4]}`;
    const list = fresh.get(key);
    if (list) list.push(haul);
    else fresh.set(key, [haul]);
  }
  for (const hauls of fresh.values()) {
    const [from, to] = hauls[0];
    let slot = 0;
    while (used.has(nameAt(rules, from, to, slot))) slot += 1;
    used.add(nameAt(rules, from, to, slot));
    world.shipSeq = (world.shipSeq ?? 0) + 1;
    const id = String(world.shipSeq);
    ships[id] = { slot };
    for (const haul of hauls) haul[5] = world.shipSeq;
    carrying.add(id);
  }
  for (const id of Object.keys(ships)) if (!carrying.has(id)) delete ships[id];
}

// Where a ship is on its run, from the days its hauls have left: loading at the port it sails from, under way,
// unloading where it's bound, or waiting off a port nothing can get into.
export function shipState(ship, hauls) {
  const left = hauls.length ? Math.min(...hauls.map((haul) => haul[4])) : 0;
  const state = left <= 0 ? "waiting" : left >= ship.total ? "loading" : left === 1 ? "unloading" : "under way";
  return { left, state, at: state === "loading" ? ship.from : state === "under way" ? null : ship.to };
}
// Where that is on the chart: at one end of the run, or part of the way along it.
export function shipSpot(ship, left) {
  const a = STAR_MAP.places[ship.from];
  const b = STAR_MAP.places[ship.to];
  if (!a || !b) return null;
  const along = left <= 1 ? 1 : left >= ship.total ? 0 : (ship.total - left) / Math.max(1, ship.total - 1);
  return { x: Math.round((a.x + (b.x - a.x) * along) * 10) / 10, y: Math.round((a.y + (b.y - a.y) * along) * 10) / 10 };
}

// ---- A day on the lanes -----------------------------------------------------------------------------------

// What a freighter's coming in means to the player is told to src/freighters.js, which hands these over:
//   escorted(game, ship)                 whether the Meridian is seeing this ship in, and is there to do it
//   arrived(game, world, ship, loads, notes, tell, seen)   it came in: each load has the good, how many, and the
//                                        port's level before; seen when the Meridian saw it in
//   lost(game, world, ship, loads, notes, tell, light)   what it carried never arrived; light when the rest of it did
//   tidy(game, world)                    the day's done: whatever was promised to a ship that's gone is let go
let listener = null;
export const tellLanes = (hooks) => { listener = hooks; };

// Before the ports' day: every haul has its ship, and for each ship that comes in today, what it carries and how the
// port stood for it. A ship the Meridian is seeing in arrives whatever is taking the convoys there: what it carries
// goes into the port's stores now, ahead of the day that would have lost it.
export function lanesBefore(game, world) {
  const model = portsModel();
  if (!freighterRules() || !world?.hauls) return null;
  assignShips(world, model);
  const due = [];
  for (const { ship, hauls } of shipsOn(world, model)) {
    if (Math.min(...hauls.map((haul) => haul[4])) > 1) continue;
    const loads = hauls.map((haul) => ({ good: haul[2], n: haul[3], level: levelOf(world, ship.to, haul[2], model), loses: losingAt(world, ship.to, haul[2], model), blocks: blockedAt(world, ship.to, haul[2], model), haul }));
    const seen = Boolean(listener?.escorted?.(game, ship));
    if (seen) {
      for (const load of loads) {
        if (!load.loses || load.blocks) continue;
        portTake(world, ship.to, load.good, -load.n);
        world.hauls.splice(world.hauls.indexOf(load.haul), 1);
        load.loses = false;
        load.saved = true;
      }
    }
    due.push({ ship, loads, seen });
  }
  return due;
}

// After the ports' day: whatever was due and is no longer on its way has come in, or was lost. Then the hauls that
// were sent today get their ships.
export function lanesDay(game, world, notes, due, tell) {
  if (!freighterRules()) return;
  const model = portsModel();
  const still = new Set(world.hauls ?? []);
  for (const { ship, loads, seen } of due ?? []) {
    const gone = loads.filter((load) => load.saved || !still.has(load.haul));
    if (!gone.length) continue;
    const lost = gone.filter((load) => load.loses && !load.saved);
    const came = gone.filter((load) => !lost.includes(load));
    // With something else aboard that got in, she came in light; with nothing, she never arrived.
    if (lost.length) listener?.lost?.(game, world, ship, lost, notes, tell, came.length > 0);
    if (came.length) listener?.arrived?.(game, world, ship, came, notes, tell, seen);
  }
  assignShips(world, model);
  listener?.tidy?.(game, world);
}
