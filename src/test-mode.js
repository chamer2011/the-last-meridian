// A test save: a game whose `test` part switches some of the game's limits off, so things can be tried without
// working for them first. Only tools/test-save.mjs makes one; nothing in play does, and nothing in play turns it off.
//   fuel: the Meridian's tank stays full, whatever the days and the jumps take, and so do the stores that keep the
//         fuel cells her generator burns, and her water tank, which her air plant can't run without.
//   rig:  the rig counts as built with whatever a hack needs: it always starts, every link reaches (a cable, the
//         optical reader, a service clip, the short radio, the Navy coupler), it has memory for every program and the
//         most power parts give, and none of its own heat. The hacking itself (the programs, the watcher, a computer's
//         class, hardened and sealed systems) is played as usual.

import { addClockWork, addDayWork } from "./room-hooks.js";
import { putAboard } from "./logistics.js";
import { fillTank } from "./water.js";

export const testing = (game, what) => Boolean(game?.test?.[what]);

// The most a build can add up to, as rig-parts.js caps it.
const MOST_POWER = 3;
const ENOUGH_MEMORY = 99;

// What a test save's rig adds up to: its build's numbers, but it starts, and has the memory and power it would need.
export function testRig(game, stats) {
  if (!testing(game, "rig")) return stats;
  return { ...stats, dead: null, memory: Math.max(stats.memory, ENOUGH_MEMORY), power: MOST_POWER, heat: 0 };
}

// Whenever the clock moves, and at the end of every day a long wait takes, the tank is topped up again, and the
// fuel cells with it: since the ports hold real amounts they're bought at a dock like everything else.
function keepFuelFull(game) {
  if (testing(game, "fuel") && game.ship) {
    game.ship.fuel = game.ship.maxFuel;
    game.ship.fuelBurn = 0;
    putAboard(game, "meridian", "fuel_cell", 99);
    // And her water: with none the air plant stops, which would end a test as surely as a dead generator.
    fillTank(game);
  }
  return [];
}
addClockWork(keepFuelFull);
addDayWork((game) => keepFuelFull(game));
export { keepFuelFull };
