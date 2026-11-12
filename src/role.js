// Who the player is. Being captain of the Meridian is one way to start. Anyone else has a job somewhere,
// someone else has the chair, and the ship goes on without them. world/starts.json has the choices.

import { deposedStart, shiftOnWatchBill } from "./command.js";
import { STARTS } from "./world.js";

export const START_LIST = STARTS.starts ?? {};
export const START_GROUPS = STARTS.groups ?? {};
// The lives a new game can be made with: a life with off: true in the file is kept, and a game saved with it still
// opens, but it isn't offered. Since 2026-11-12 that's every life but the captain's.
export const startIsOff = (id) => Boolean(START_LIST[id]?.off);
export const OFFERED_STARTS = Object.fromEntries(Object.entries(START_LIST).filter(([, start]) => !start.off));

// A save from before there was any choice about it belongs to a captain.
export const isCaptain = (game) => game.role?.captain !== false;
export const startOf = (game) => START_LIST[game.role?.id] ?? null;

// Aboard the Meridian, or on the dock she's at. A captain's always with their ship.
export const aboardShip = (game) => isCaptain(game) || game.location === "meridian" || (Boolean(game.ship?.at) && game.location === game.ship.at);

// The work they do, if this is where they do it. Crew aboard the Meridian do the job the watch bill has them on, so a
// move there moves their shifts too, and a captain the officers relieved is crew aboard too.
export function jobHere(game) {
  const start = startOf(game)?.job ? startOf(game) : deposedStart(game);
  if (isCaptain(game) || !start?.job || start.place !== game.location) return null;
  return shiftOnWatchBill(game, start) ?? start.job;
}

// What the character files say about "your" officers is written to the captain.
export const toOutsider = (game, text) => (isCaptain(game) || !text ? text : text.replace(/\bYour\b/g, "The Meridian's").replace(/\byour\b/g, "the Meridian's"));

