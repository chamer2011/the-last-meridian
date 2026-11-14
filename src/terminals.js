// A written computer's thing, stood in its room when the map hasn't drawn one there, the way the logistics' stores and
// world/uses.txt's things are: on a free square at the edge of the room, so a computer's file alone puts a terminal
// aboard. Using it opens the computer (thing.computer, read by computerAtThing in src/computers.js).

import { addMapWork } from "./room-hooks.js";
import { WORLD_COMPUTERS } from "./world.js";
import { claimedSquares, floorSpot, systemsOf, systemsPending } from "./systems.js";
import { logisticsPending } from "./logistics.js";

const plain = (words) => String(words ?? "").toLowerCase().replace(/['’]/g, "").replace(/^the\s+/, "").replace(/\s+/g, " ").trim();

// The squares a new thing keeps off: the room's words and ways out, and the squares round what already stands there.
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

// Which computers' things were stood, by place, for the checker.
const unplaced = new Map();
export const terminalsUnplaced = (place) => unplaced.get(place) ?? [];

addMapWork((place, map) => {
  // Not before the place's parts and stores stand in the map, so nothing is stood on their squares.
  if (systemsPending(place) || logisticsPending(place)) return false;
  const missing = [];
  const rooms = Object.values(map.rooms ?? {}).filter((room) => !room.deck);
  for (const [id, c] of Object.entries(WORLD_COMPUTERS)) {
    if (c.place !== place || !c.room || !c.thing || c.door) continue;
    const room = rooms.find((one) => plain(one.name) === plain(c.room));
    if (!room) continue;
    const level = room.level;
    const inRoom = (t) => !room.area || level.areaAt?.(t.x, t.y) === room.area.id;
    if (level.things.some((t) => plain(t.name) === plain(c.thing) && inRoom(t))) continue;
    const spot = floorSpot(level, new Set(), 0, 1, keptClear(place, map, level), room.area ?? null);
    if (!spot) {
      missing.push(id);
      continue;
    }
    level.things.push({ id: `computer:${id}`, name: c.thing, x: spot.x, y: spot.y, placed: true, computer: id });
    // It stands like a thing drawn there: its square isn't floor, and you reach it from beside it.
    level.solid.add(`${spot.x},${spot.y}`);
    if (level.open[spot.y]) level.open[spot.y][spot.x] = false;
  }
  unplaced.set(place, missing);
  return true;
});
