// What other parts of the game add to a room, without the room's code (src/walk.js) knowing them. A part of the game
// registers what can be done to someone (shown in their window and their right-click menu), what a thing does besides
// what its file says (its Actions window and its right-click menu), what can be done in the room the player stands in
// (under You can), and the order that carries each one out, which comes in through /api/walk like carrying someone or
// giving them something.
//
// An act is { id, label, detail, disabled, ask }: id is the order's name, detail a few words beside the label, ask a
// question to put first for something that can't be taken back. This file imports nothing, so anything can import it.

const people = [];
const things = [];
const rooms = [];
const orders = new Map();
const clocks = [];
const days = [];

// (game, entry, key) => the acts for someone, or nothing. entry is the room's own entry for them, key their key there.
export const addPersonActs = (fn) => { people.push(fn); };
// (game, thing, level) => { does: acts, and any other fields for the page }, or nothing.
export const addThingActs = (fn) => { things.push(fn); };
// (game, { place, room, level }) => the acts for the room the player's in, or nothing.
export const addRoomActs = (fn) => { rooms.push(fn); };
// (game, body, context) => { said, and whatever else the page reads }. context is { walk, map, level, spot, people, room }.
export const addOrder = (id, fn) => { orders.set(id, fn); };

// (game) => lines for the story, each time the clock has moved: after the ship's machines, before anyone asks anything.
export const addClockWork = (fn) => { clocks.push(fn); };
// (game, day) => lines for the story, once for each day that ends.
export const addDayWork = (fn) => { days.push(fn); };

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

export function roomExtras(game, context) {
  if (!rooms.length) return {};
  const acts = gathered(rooms, game, context);
  return acts.length ? { acts } : {};
}
