// Wear and clutter (step 5 of the furniture plan): how worn the ship looks, by its hull, and how cluttered, by its
// morale, for the room's picture to scatter grime and rubbish by; and the marks that what happens leaves in the rooms,
// a burnt patch where a fire was, a stain where someone fell, which the crew clean up over the days after. Nothing here
// changes how the game plays: it's what the rooms look like.

import { addAreaState } from "./room-hooks.js";
import { SHIP_ID } from "./ship.js";

// How many days each kind of mark lasts before it's cleaned away, fading as it goes.
export const MARK_DAYS = { scorch: 12, fallen: 4 };
// Marks kept for a place at most, the newest.
const MOST_MARKS = 60;

const nowOf = (game) => game.clock?.hours ?? 0;
const lastsFor = (kind) => (MARK_DAYS[kind] ?? 3) * 24;
// How much of a mark is left: 1 when it's new, 0 once it's gone.
const leftOf = (game, mark) => Math.max(0, 1 - (nowOf(game) - mark.since) / lastsFor(mark.kind));
// In quarters, so the room's picture is drawn afresh only a few times as a mark fades.
const quartered = (n) => Math.ceil(n * 4) / 4;

// Leaves a mark at a place: { kind, room } for a burnt room, { kind, level, x, y } for a square.
export function addMark(game, place, mark) {
  if (!place || !MARK_DAYS[mark.kind]) return;
  game.marks ??= {};
  const now = nowOf(game);
  const kept = (game.marks[place] ?? []).filter((one) => now - one.since < lastsFor(one.kind));
  kept.push({ ...mark, since: now });
  game.marks[place] = kept.slice(-MOST_MARKS);
}

// The marks on one level of a place, for the room's picture, with how much of each is left. Reading this changes nothing.
export function marksOn(game, place, level) {
  return (game.marks?.[place] ?? [])
    .filter((one) => one.level === level && one.x !== undefined)
    .map((one) => ({ kind: one.kind, x: one.x, y: one.y, left: quartered(leftOf(game, one)) }))
    .filter((one) => one.left > 0);
}

// A room a fire burned in keeps the soot as long as the mark lasts: how big the fire got, and how much of it is left.
addAreaState((game, place, room) => {
  const scorch = (game.marks?.[place] ?? [])
    .filter((one) => one.kind === "scorch" && one.room === room)
    .map((one) => ({ size: one.size ?? 1, left: quartered(leftOf(game, one)) }))
    .filter((one) => one.left > 0)
    .sort((a, b) => b.left - a.left)[0];
  return scorch ? { scorched: scorch } : {};
});

// How worn and how cluttered the ship looks, 0 to 3 each: worn as her hull is battered, cluttered as morale falls and
// nobody tidies. As she starts (hull 70, morale 55), one of each, which is how the rooms always looked. Only aboard her.
export function wearOf(game, place) {
  if (place !== SHIP_ID || !game.ship) return null;
  const hull = ((game.ship.hull ?? 70) / (game.ship.maxHull || 100)) * 100;
  const morale = game.ship.morale ?? 55;
  return {
    grime: hull >= 85 ? 0 : hull >= 60 ? 1 : hull >= 35 ? 2 : 3,
    clutter: morale >= 75 ? 0 : morale >= 50 ? 1 : morale >= 30 ? 2 : 3,
  };
}
