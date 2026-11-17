// What other parts of the game add to a room, without the room's code (src/walk.js) knowing them. A part of the game
// registers what can be done to someone (shown in their window and their right-click menu), what a thing does besides
// what its file says (its Actions window and its right-click menu), what can be done in the room the player stands in
// (under You can), and the order that carries each one out, which comes in through /api/walk like carrying someone or
// giving them something.
//
// An act is { id, label, detail, disabled, ask }: id is the order's name, detail a few words beside the label, ask a
// question to put first for something that can't be taken back. This file imports nothing, so anything can import it.

const people = [];
const notes = [];
const areaStates = [];
const things = [];
const partActs = [];
const rooms = [];
const orders = new Map();
const clocks = [];
const days = [];
const maps = [];
const checkers = [];
const stocks = [];
const detours = [];
const fighters = [];
const spoilers = [];
const breathers = [];
const holds = [];

// (game, entry, key) => the acts for someone, or nothing. entry is the room's own entry for them, key their key there.
export const addPersonActs = (fn) => { people.push(fn); };
// (game, thing, level) => { does: acts, and any other fields for the page }, or nothing.
export const addThingActs = (fn) => { things.push(fn); };
// (game, place, part) => { does: acts } for a part of a place's systems (src/systems.js), or nothing.
export const addPartActs = (fn) => { partActs.push(fn); };
// (game, { place, room, level }) => the acts for the room the player's in, or nothing.
export const addRoomActs = (fn) => { rooms.push(fn); };
// (game, body, context) => { said, and whatever else the page reads }. context is { walk, map, level, spot, people, room }.
export const addOrder = (id, fn) => { orders.set(id, fn); };

// (game) => lines for the story, each time the clock has moved: after the ship's machines, before anyone asks anything.
export const addClockWork = (fn) => { clocks.push(fn); };
// (game, day) => lines for the story, once for each day that ends.
export const addDayWork = (fn) => { days.push(fn); };
// (game) => lines for the story, last of all each time the clock has moved, once everything else has caught up with
// it: whether the player can still stand (src/collapse.js). What it adds may pass more time itself.
const lasts = [];
export const addAfterClock = (fn) => { lasts.push(fn); };
export const afterClock = (game) => (lasts.length ? lasts.flatMap((fn) => fn(game) ?? []) : []);
// (game, why) => nothing: whatever the player was in the middle of that a part of the game keeps is let go of, with a
// line for why, when they can't go on with it: the computer they were on, when they go down (src/collapse.js).
const droppers = [];
export const addDropWork = (fn) => { droppers.push(fn); };
export const dropExtras = (game, why) => { for (const fn of droppers) fn(game, why); };

// (place, map) => nothing, or false for "not yet": once for each place's map, after its systems and its stores are
// stood in it. For giving the things drawn there something more, or standing something of its own on a free square.
export const addMapWork = (fn) => { maps.push(fn); };
// () => what's wrong in a file of its own, in plain words, for npm run check-story.
export const addChecker = (fn) => { checkers.push(fn); };

// Each map's work is done once. A part that says false isn't ready (the place's systems or stores are still being
// stood in the map), and is asked again the next time the map is.
const mapped = new WeakMap();
export function mapExtras(place, map) {
  const done = mapped.get(map) ?? mapped.set(map, new Set()).get(map);
  if (done.size === maps.length) return;
  for (const fn of maps) if (!done.has(fn) && fn(place, map) !== false) done.add(fn);
}
export const checkExtras = () => checkers.flatMap((fn) => fn() ?? []);

// (game, talk) => what someone with no conversation of their own can be asked besides, each
// { id, say, text, again, choices, parts }: the question, their answer, whether it can be asked again, and for one
// that leads on, the choices under the answer and the parts those go to ({ id: { text: [lines], choices } }; a part
// without choices of its own goes back to the usual questions).
export const addStockAnswers = (fn) => { stocks.push(fn); };
export const stockExtras = (game, talk) => (stocks.length ? gathered(stocks, game, talk) : []);

// (game, place) => (key, room, asleep) => somewhere to send someone off their usual day, or nothing; or null when it
// sends nobody. As for the place's systems and errands (src/life.js): { where, doing, spot, exact }.
export const addDetour = (fn) => { detours.push(fn); };
export function detourExtras(game, place) {
  const live = detours.map((fn) => fn(game, place)).filter(Boolean);
  return live.length ? (key, room, asleep) => { for (const fn of live) { const turn = fn(key, room, asleep); if (turn) return turn; } return null; } : null;
}

// (game, place, room) => true while something spoils a room's air whatever its vents are doing: a fire, a hole.
export const addAirSpoiler = (fn) => { spoilers.push(fn); };
export const airSpoiled = (game, place, room) => spoilers.some((fn) => fn(game, place, room));

// (game, place, minutes, hours) => lines for the story, each time a place's air has moved on by so many minutes, up to
// an hour of the clock: what breathing it, or not being able to, does to the people there (src/no-air.js).
export const addAirWork = (fn) => { breathers.push(fn); };
export const airExtras = (game, place, minutes, hours) => (breathers.length ? gathered(breathers, game, place, minutes, hours) : []);

// (game, place, room) => a line more for a room's description, or nothing: who's held in the brig (src/aftermath.js).
export const addRoomNote = (fn) => { notes.push(fn); };
export const roomNotes = (game, place, room) => notes.map((fn) => fn(game, place, room)).filter(Boolean);

// (game, place, room) => what the room's picture should show of a room drawn on a deck, or nothing: a fire and how big
// it is, a hole in the hull (src/emergencies.js). Merged into that room's entry in the room view's areas.
export const addAreaState = (fn) => { areaStates.push(fn); };
export const areaExtras = (game, place, room) => Object.assign({}, ...areaStates.map((fn) => fn(game, place, room) ?? {}));

// (game, place) => true while a place's stores aren't to be refilled from nothing: something else supplies them.
export const addRefillHold = (fn) => { holds.push(fn); };
// A machine that something keeps from running, whatever else it has: why, in a few words, or null. The law, for a
// maker it doesn't allow (src/law.js).
const machineHolds = [];
export const addMachineHold = (fn) => { machineHolds.push(fn); };
export function machineHeld(game, place, m) {
  for (const fn of machineHolds) {
    const why = fn(game, place, m);
    if (why) return why;
  }
  return null;
}
export const refillsHeld = (game, place) => holds.some((fn) => fn(game, place));

// (game, place, thing) => what's in a thing the first time it's opened, as { item: how many }, or nothing for a thing
// that isn't its own: a port's store, which holds its share of what the port has that day (src/port-stores.js).
const firsts = [];
export const addFirstContents = (fn) => { firsts.push(fn); };
export function firstContents(game, place, thing) {
  for (const fn of firsts) {
    const found = fn(game, place, thing);
    if (found) return found;
  }
  return null;
}

// (game) => whoever stands with the player when a fight starts, as the fight knows them (a person's id).
export const addFightAllies = (fn) => { fighters.push(fn); };
export const fightExtras = (game) => (fighters.length ? gathered(fighters, game) : []);

export const orderFor = (id) => orders.get(String(id ?? "")) ?? null;
export const isOrder = (id) => orders.has(String(id ?? ""));

const gathered = (list, ...args) => list.flatMap((fn) => fn(...args) ?? []);

export const clockExtras = (game) => (clocks.length ? gathered(clocks, game) : []);
export const dayExtras = (game, day) => (days.length ? gathered(days, game, day) : []);

export function personExtras(game, entry, key) {
  if (!people.length) return {};
  const acts = gathered(people, game, entry, key);
  return acts.length ? { acts } : {};
}

export function thingExtras(game, thing, level) {
  let out = {};
  for (const fn of things) {
    const more = fn(game, thing, level);
    if (!more) continue;
    const does = [...(out.does ?? []), ...(more.does ?? [])];
    out = { ...out, ...more, ...(does.length ? { does } : {}) };
  }
  return out;
}

export function partExtras(game, place, part) {
  if (!partActs.length) return {};
  const does = partActs.flatMap((fn) => fn(game, place, part)?.does ?? []);
  return does.length ? { does } : {};
}

export function roomExtras(game, context) {
  if (!rooms.length) return {};
  const acts = gathered(rooms, game, context);
  return acts.length ? { acts } : {};
}
