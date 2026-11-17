// Each place's own systems: power, air, lights, doors, cameras, the alarm, comms, and on ships the engines and
// navigation, on stations the docking clamps, and any system a place's file adds. None of them reaches another
// place. Every part is a thing in a room, on a wall or standing on the floor, and it can be worked by hand through
// the check windows, or from a computer that runs it. What they do: a room with no power goes dark and its cameras,
// vents, speakers and screens stop; air that stops moving goes bad over minutes, people leave, and the player is
// hurt; a locked door stops anyone walking through; a camera that sees the player tampering raises the alarm, which
// brings the guards, locks the doors the file says, and costs standing with whoever holds the place. The place's
// engineers fix what's broken, and its people switch back what the player switched off, in time.
//
// world/systems/<place>.txt is a place's own file, read by public/systems-text.js. A place without one gets what
// world/systems/_defaults.json says, worked out from its rooms and things. The save holds only what's different
// from normal, under game.systems[place], and showing the game changes nothing.

import { SKILLS } from "./character-data.js";
import { LOCATIONS } from "./data.js";
import { startCheck } from "./checks.js";
import { genericKindOf, writtenAtThing } from "./computers.js";
import { livesHere, peopleAboard } from "./life.js";
import { dropOrderOf, loadsOf, noPartsWords, powerSupply, repairPartsAboard, repairPartsWords, repairStore, takeRepairParts } from "./logistics.js";
import { boardRuns, repairHands } from "./work.js";
import { recordFact } from "./record.js";
import { YOU, countForDuty, holderKey, jobById, jobByWords, lostReason, onJob, postByWords, speedOf } from "./command.js";
import { isCaptain } from "./role.js";
import { changeStanding, changeStress, hoursNow } from "./rules.js";
import { holderOf } from "./daily.js";
import { atPost, mapFor, roomOf, roomsOf, roomsOn, thingsIn } from "./walk.js";
import { notePut } from "./puts.js";
import { addClockWork, airExtras, airSpoiled, partExtras } from "./room-hooks.js";
import { SYSTEMS_DEFAULTS, SYSTEMS_FILE_PROBLEMS, WORLD_CHARACTERS, WORLD_COMPUTERS, WORLD_LIFE, WORLD_SYSTEMS } from "./world.js";
import { KNOWN_SYSTEMS, SYSTEM_TITLES, readComputerLine, readDoorLine, readLocksLine, readPartLine, slugOf } from "../public/systems-text.js";
import { FURNITURE_BY_ID } from "../public/furniture.js";

const D = () => SYSTEMS_DEFAULTS ?? {};
const NORMAL = Object.freeze({});
// Sealed door panels (step 9, src/sealed.js, which tells this file since it can't import it): whether a computer (by
// its ref, or none for the Ship menu) may work a door whose panel is sealed, whether a door's own panel is sealed now
// (by its file or by a scene), and what that says.
export function tellSealed(fns) { tellSealed.fns = fns; }
const doorBlocked = (game, place, room, ref) => Boolean(tellSealed.fns?.blocked(game, place, room, ref));
const panelSealed = (game, place, room) => Boolean(tellSealed.fns?.panelSealed(game, place, room));
const panelWords = (game, place, room) => tellSealed.fns?.panelWords(game, place, room) ?? null;
const BIG_CLASSES = ["hard", "very_hard", "nearly_impossible"];
// Parts that work with no power: the boxes the power comes through, and the clamps' levers.
const NEEDS_NO_POWER = new Set(["junction box", "docking clamps"]);
const plain = (words) => String(words ?? "").toLowerCase().replace(/['’]/g, "").replace(/^the\s+/, "").replace(/\s+/g, " ").trim();
const lowerFirst = (text) => (text ? text[0].toLowerCase() + text.slice(1) : "");
const upperFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : "");

// ---- The kinds of part ---------------------------------------------------------------------------

const kindsTable = () => D().parts ?? {};
export function kindOf(name, system) {
  const words = plain(name);
  const table = kindsTable();
  const named = (key, spec) => [key, ...(spec.names ?? [])];
  for (const [key, spec] of Object.entries(table)) if (named(key, spec).includes(words)) return key;
  for (const [key, spec] of Object.entries(table)) if (named(key, spec).some((one) => words.endsWith(` ${one}`))) return key;
  return D().systems?.[system] ?? D().systems?.other ?? "machine";
}
const kindSpec = (kind) => kindsTable()[kind] ?? kindsTable().machine ?? {};
// Every kind of damage there is: what each kind of part's break line does to it, a forced door, and the story's
// broken. The logistics file's repair line names some of these.
export function damageKinds() {
  const kinds = new Set(["broken", "forced"]);
  for (const spec of Object.values(kindsTable())) if (spec.break?.damage) kinds.add(spec.break.damage);
  return kinds;
}
const wordFor = (kind, state) => kindSpec(kind).words?.[state] ?? state;

function numbersOf(file) {
  const base = D().numbers ?? {};
  const pick = (own, fallback, dflt) => (Number.isFinite(own) && own > 0 ? own : Number.isFinite(base[fallback]) ? base[fallback] : dflt);
  return {
    alarm: pick(file.numbers?.alarm, "alarm rings", 30),
    air: pick(file.numbers?.air, "air goes bad", 20),
    airBack: pick(null, "air comes back", 10),
    // Reserve air, in days, for a place whose own file gives it some, and the hours it takes to fill again.
    reserve: pick(file.numbers?.reserve, "reserve air", 0),
    reserveFill: pick(null, "reserve air fills in", 24),
    repair: pick(file.numbers?.repair, "repairs take", 3),
    // How often something wears out by itself, in days; none unless the place's file says.
    wear: pick(file.numbers?.wear, "a part wears out every", 0),
    back: pick(null, "switched back", 6),
  };
}
const airLimits = () => ({ thin: D().air?.thin ?? 60, bad: D().air?.bad ?? 30, stress: D().air?.stress ?? 2, health: D().air?.health ?? 2 });

// ---- Where parts can go --------------------------------------------------------------------------

// Wall squares with the room in front of them: the back walls, facing the room, and the left-hand walls. The walls
// nearest the viewer are drawn low so the room can be seen, so nothing goes on those. On a deck, area is the room
// drawn on it, and only its own walls count: the ones with its floor in front of them.
export function wallSpots(level, claimed = new Set(), area = null) {
  const spots = [];
  const inArea = (x, y) => !area || level.areaAt(x, y) === area.id;
  const walkable = (x, y) => Boolean(level.open[y]?.[x]) && !level.solid.has(`${x},${y}`) && inArea(x, y);
  const wall = (x, y) => level.layers.walls[y]?.[x] === "#";
  const nearExit = (x, y) => level.exits.some((exit) => Math.abs(exit.x - x) <= 1 && Math.abs(exit.y - y) <= 1);
  // A wall with floor behind it or to its left is one the room view cuts down to a kerb (public/iso.js): what hangs
  // on it hangs in the air. Each spot says so, and whoever shares the walls out can keep to the ones that stand.
  const floor = (x, y) => Boolean(level.open[y]?.[x]);
  const low = (x, y) => floor(x, y - 1) || floor(x - 1, y) || floor(x - 1, y - 1);
  const [x0, x1, y0, y1] = area ? [Math.max(0, area.x - 1), Math.min(level.width - 1, area.x + area.w), Math.max(0, area.y - 1), Math.min(level.height - 1, area.y + area.h)] : [0, level.width - 1, 0, level.height - 1];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) if (wall(x, y) && !nearExit(x, y) && !claimed.has(`${x},${y}`) && walkable(x, y + 1)) spots.push({ x, y, face: "back", ...(low(x, y) ? { low: true } : {}) });
  }
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) if (wall(x, y) && !nearExit(x, y) && !claimed.has(`${x},${y}`) && !walkable(x, y + 1) && walkable(x + 1, y)) spots.push({ x, y, face: "side", ...(low(x, y) ? { low: true } : {}) });
  }
  return spots;
}

// The squares of wall the deck's own fittings hang on: a window, a screen, a sign. No part of the systems goes over
// one, or the room view would have to leave the fitting out to show the part.
export function fittedSquares(level) {
  return new Set((level.furniture ?? []).filter((piece) => FURNITURE_BY_ID[piece.kind]?.wall).map((piece) => `${piece.x},${piece.y}`));
}

// Where a door's keypad goes: on a wall beside one of the doorways into its room, the nearest free one within three
// squares, outside the room if it can be (whoever's locked out reaches it there), else inside. A room that's a level
// of its own has the ways into it in the levels around it, and its own ways out. room is the room it's in.
function panelSpot(place, map, entry, takenOn) {
  const options = [];
  const tried = [];
  const consider = (level, squares, outside) => {
    if (!squares.length) return;
    tried.push([level, squares, outside]);
    const taken = takenOn.get(level.id) ?? new Set();
    const fitted = fittedSquares(level);
    for (const spot of wallSpots(level, claimedSquares(place, map, level))) {
      if (taken.has(`${spot.x},${spot.y}`) || fitted.has(`${spot.x},${spot.y}`)) continue;
      const near = Math.min(...squares.map(([x, y]) => Math.max(Math.abs(x - spot.x), Math.abs(y - spot.y))));
      if (near > 3) continue;
      // The room it's in is the one whose floor is in front of it: a room drawn on a deck, the deck's own floor, or a
      // room that's a level of its own.
      const [fx, fy] = spot.face === "side" ? [spot.x + 1, spot.y] : [spot.x, spot.y + 1];
      const room = level.roomAt?.(fx, fy) ?? level.id;
      options.push({ ...spot, level, near, room, outside: outside ?? room !== entry.id });
    }
  };
  if (entry.area) {
    const level = entry.level;
    const doors = [...(level.doorAreas ?? new Map())].filter(([, touched]) => touched.has(entry.id)).map(([key]) => key.split(",").map(Number));
    consider(level, doors, null);
  } else {
    for (const other of Object.values(map.levels ?? {})) {
      if (other.id === entry.level?.id) continue;
      consider(other, (other.exits ?? []).filter((exit) => exit.to === entry.id).map((exit) => [exit.x, exit.y]), true);
    }
    if (!options.length && entry.level) consider(entry.level, (entry.level.exits ?? []).map((exit) => [exit.x, exit.y]), false);
  }
  // No wall near the door: a unit standing on the floor beside it, against a wall, out of the doorway and the ways
  // out, where everything can still be walked to.
  if (!options.length) {
    for (const [level, squares, outside] of tried) {
      const taken = takenOn.get(level.id) ?? new Set();
      const claimed = claimedSquares(place, map, level);
      const homes = new Set((level.homes ?? []).map((home) => `${home.x},${home.y}`));
      const seen = new Set();
      for (const [sx, sy] of squares) {
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const x = sx + dx;
            const y = sy + dy;
            const key = `${x},${y}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (!level.open[y]?.[x] || level.solid.has(key) || level.furnished?.has(key) || taken.has(key) || claimed.has(key) || homes.has(key) || level.doors?.has(key)) continue;
            if (x === level.start?.x && y === level.start?.y) continue;
            if ((level.exits ?? []).some((exit) => Math.abs(exit.x - x) + Math.abs(exit.y - y) <= 1)) continue;
            if (squares.some(([qx, qy]) => Math.abs(qx - x) + Math.abs(qy - y) <= 1)) continue;
            if (![[0, -1], [-1, 0], [1, 0], [0, 1]].some(([ax, ay]) => !level.open[y + ay]?.[x + ax])) continue;
            const room = level.roomAt?.(x, y) ?? level.id;
            const area = (level.areas ?? []).find?.((one) => one.id === room) ?? null;
            if (!staysConnected(level, taken, { x, y }, area)) continue;
            const near = Math.min(...squares.map(([qx, qy]) => Math.max(Math.abs(qx - x), Math.abs(qy - y))));
            options.push({ x, y, face: null, level, near, room, outside: outside ?? room !== entry.id });
          }
        }
      }
    }
  }
  options.sort((a, b) => Number(b.outside) - Number(a.outside) || a.near - b.near || a.y - b.y || a.x - b.x);
  return options[0] ?? null;
}

// Rooms with no such walls get a standing unit on the floor instead, at the edge, where it can't block the way.
export function floorSpot(level, taken, index, count, claimed = new Set(), area = null) {
  const inArea = (x, y) => !area || level.areaAt(x, y) === area.id;
  const walkable = (x, y) => Boolean(level.open[y]?.[x]) && !level.solid.has(`${x},${y}`) && !level.furnished?.has(`${x},${y}`) && !taken.has(`${x},${y}`) && !claimed.has(`${x},${y}`) && inArea(x, y);
  const homes = new Set(level.homes.map((home) => `${home.x},${home.y}`));
  const nearExit = (x, y) => level.exits.some((exit) => Math.abs(exit.x - x) + Math.abs(exit.y - y) <= 2);
  const candidates = [];
  const [x0, x1, y0, y1] = area ? [area.x, area.x + area.w - 1, area.y, area.y + area.h - 1] : [0, level.width - 1, 0, level.height - 1];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (!walkable(x, y) || homes.has(`${x},${y}`) || (x === level.start.x && y === level.start.y) || nearExit(x, y) || level.doors.has(`${x},${y}`)) continue;
      if ([[0, -1], [-1, 0], [1, 0], [0, 1]].some(([dx, dy]) => !level.open[y + dy]?.[x + dx])) candidates.push({ x, y });
    }
  }
  if (!candidates.length) return null;
  const first = Math.floor(((index + 0.5) * candidates.length) / Math.max(1, count));
  for (let k = 0; k < candidates.length; k += 1) {
    const spot = candidates[(first + k) % candidates.length];
    if (staysConnected(level, taken, spot, area)) return spot;
  }
  return null;
}

// Whether everywhere that could be walked to still can be, with one more square taken. On a deck, within the room
// drawn there, its doors counting as its edge.
function staysConnected(level, taken, spot, area = null) {
  const inArea = (x, y) => !area || level.areaAt(x, y) === area.id || level.doors.has(`${x},${y}`);
  const blocked = (x, y) => !level.open[y]?.[x] || level.solid.has(`${x},${y}`) || taken.has(`${x},${y}`) || (x === spot.x && y === spot.y) || !inArea(x, y);
  let total = 0;
  let from = null;
  const [x0, x1, y0, y1] = area ? [Math.max(0, area.x - 1), Math.min(level.width - 1, area.x + area.w), Math.max(0, area.y - 1), Math.min(level.height - 1, area.y + area.h)] : [0, level.width - 1, 0, level.height - 1];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (blocked(x, y)) continue;
      total += 1;
      from ??= { x, y };
    }
  }
  if (!from) return false;
  const seen = new Set([`${from.x},${from.y}`]);
  const queue = [from];
  for (let i = 0; i < queue.length; i += 1) {
    const { x, y } = queue[i];
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const key = `${x + dx},${y + dy}`;
      if (seen.has(key) || blocked(x + dx, y + dy)) continue;
      seen.add(key);
      queue.push({ x: x + dx, y: y + dy });
    }
  }
  // Exits sit in the walls, so each one needs a square beside it that can still be reached.
  const reached = (mark) => [[0, -1], [-1, 0], [1, 0], [0, 1]].some(([dx, dy]) => seen.has(`${mark.x + dx},${mark.y + dy}`));
  // The same for every thing in the room, and every part already placed, since each has to be walked up to.
  const inHere = (mark) => !area || level.areaAt(mark.x, mark.y) === area.id;
  const placed = [...taken].map((key) => key.split(",").map(Number)).map(([x, y]) => ({ x, y })).filter(inHere);
  const exits = level.exits.filter(inHere);
  const things = level.things.filter(inHere);
  return seen.size === total && exits.every(reached) && things.every(reached) && placed.every(reached);
}

// The squares names are written on: the ways out's, the room names', and the names of people at their posts or at
// the places their days take them. A part on one would cover a name.
export function claimedSquares(place, map, level) {
  const out = new Set();
  const run = (x, y, length, side = "right") => {
    for (let i = 0; i < length; i += 1) out.add(`${side === "left" ? x - i : x + i},${y}`);
  };
  for (const exit of level.exits) run(exit.x, exit.y, String(exit.label ?? "").length + 2, exit.side);
  for (const label of level.labels) run(label.x, label.y, label.text.length);
  for (const home of level.homes) run(home.x, home.y, String(home.label ?? home.id ?? "").length + 2, home.side);
  out.add(`${level.start.x},${level.start.y}`);
  for (const area of level.areas) out.add(`${area.start.x},${area.start.y}`);
  const life = WORLD_LIFE[place];
  if (life) {
    // A spot in the life file names a room, which can be one drawn on this level.
    const onLevel = (lvl) => lvl === level.id || roomOf(map, lvl)?.levelId === level.id;
    const longest = Math.max(8, ...Object.values(map?.levels ?? {}).flatMap((one) => one.homes.map((home) => String(home.label ?? "").length))) + 2;
    for (const [lvl, x, y, side] of Object.values(life.spots ?? {})) if (onLevel(lvl)) run(x, y, longest, side);
    for (const entries of Object.values(life.groups ?? {})) {
      for (const entry of entries) {
        if (Array.isArray(entry)) {
          if (onLevel(entry[0])) run(entry[1], entry[2], longest);
        } else if (onLevel(entry.level)) {
          for (let x = entry.from; x <= entry.to; x += entry.step ?? 1) run(x, entry.y, longest);
        }
      }
    }
  }
  return out;
}

// The squares one room's parts take up, for anyone placing people so their names cover nothing. Asked about a deck,
// it's the parts of every room drawn on it.
export function partSquares(place, room) {
  const model = systemsOf(place);
  if (!model) return [];
  const map = mapFor(place);
  const ids = map?.levels[room]?.areas.length ? roomsOn(map, room).flatMap((one) => model.partsIn[one.id] ?? []) : model.partsIn[room] ?? [];
  return ids.map((id) => model.parts[id]).filter((part) => part && !part.unplaced).map((part) => `${part.x},${part.y}`);
}

// ---- What a place has, from its file or the defaults --------------------------------------------

// A room by its name, id or alias: a level, or a room drawn on a deck.
function roomFinder(map) {
  const rooms = roomsOf(map);
  return (name) => {
    const want = plain(name);
    return rooms.find((room) => plain(room.name) === want || room.id === want || (room.aliases ?? []).some((alias) => plain(alias) === want)) ?? null;
  };
}
// The ways into a room: the exits that lead to it, and on a deck, the doors in its walls.
function waysInto(map, room) {
  const exits = Object.values(map.levels).flatMap((level) => level.exits.filter((exit) => exit.to === room && !exit.back));
  const area = roomOf(map, room)?.area;
  return area ? [...exits, ...area.doors.map((door) => ({ x: door.x, y: door.y, to: room, inner: true }))] : exits;
}
const storyClosedInto = (map, room) => waysInto(map, room).some((exit) => exit.closed);

// The rooms next to a room: through its doors, on a deck, and through the exits that leave it.
function neighboursOf(map, id) {
  const room = roomOf(map, id);
  if (!room) return [];
  const exits = room.area ? room.level.exits.filter((exit) => room.area.exits.includes(exit.key)) : room.level.exits;
  const beyond = exits.map((exit) => {
    const there = roomOf(map, exit.to);
    if (!there) return null;
    if (!there.level.areas.length) return there.id;
    const back = there.level.exits.find((one) => one.key === exit.via);
    return back ? there.level.roomAt(back.x, back.y) : there.id;
  }).filter(Boolean);
  return [...new Set([...(room.area?.doors.map((door) => door.to) ?? []), ...beyond])];
}

// The rooms in the order they're reached from the way in, in groups of a few, each group on one junction box.
function sectionsOf(map, ids, size) {
  const wanted = new Set(ids);
  const order = [];
  const seen = new Set([map.start]);
  const queue = [map.start];
  while (queue.length) {
    const id = queue.shift();
    if (wanted.has(id)) order.push(id);
    for (const next of neighboursOf(map, id)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  for (const id of ids) if (!order.includes(id)) order.push(id);
  const groups = [];
  for (let i = 0; i < order.length; i += size) groups.push(order.slice(i, i + size));
  return groups;
}

const classWord = (text) => String(text ?? "").trim().toLowerCase().replace(/\s+/g, "_");

// A place with no file of its own: the same shape as a file, so what's shown on the board can be saved as one.
export function defaultFileFor(place, map) {
  const d = D();
  const levels = roomsOf(map);
  const value = { name: LOCATIONS[place]?.name ?? map.name ?? place, numbers: {}, systems: [], computers: [], defaults: true };
  if ((d["no systems"] ?? []).includes(place)) return value;
  const open = (d["open air"] ?? []).includes(place);
  const inside = open ? levels.filter((room) => wallSpots(room.level, new Set(), room.area).length >= 4) : levels;
  if (!inside.length) return value;
  const names = (list) => list.map((level) => level.name).join(", ");
  const everywhere = open ? names(inside) : "every room";
  const start = roomOf(map, map.start);
  const sections = sectionsOf(map, inside.map((level) => level.id), 3).map((ids) => ids.map((id) => roomOf(map, id)));
  value.systems.push({ name: "Power", id: "power", lines: sections.map((group) => ({ text: `junction box in ${group[0].name}${group.length > 1 ? ` for ${names(group)}` : ""}` })) });
  if (!open) {
    const words = d["plant rooms"] ?? [];
    const plant = levels.find((level) => words.some((word) => level.name.toLowerCase().includes(word))) ?? levels.at(-1);
    value.systems.push({ name: "Air", id: "air", lines: [{ text: `air plant in ${plant.name}` }, { text: "vent in every room" }] });
  }
  value.systems.push({ name: "Lights", id: "lights", lines: [{ text: `light switch in ${everywhere}` }] });
  const doors = inside.filter((level) => level.id !== map.start && waysInto(map, level.id).length && !storyClosedInto(map, level.id));
  if (doors.length) value.systems.push({ name: "Doors", id: "doors", lines: doors.map((level) => ({ text: `door to ${level.name}` })) });
  const watchedEverywhere = (d["cameras everywhere"] ?? []).includes(place);
  const cameraRooms = watchedEverywhere ? inside : [inside.includes(start) ? start : inside[0]];
  value.systems.push({ name: "Cameras", id: "cameras", lines: [{ text: `camera in ${watchedEverywhere && !open ? "every room" : names(cameraRooms)}` }] });
  value.systems.push({ name: "Alarm", id: "alarm", lines: [{ text: `speaker in ${everywhere}` }] });
  // Every computer at the place runs what's in its own room, and a big one runs everything.
  for (const level of levels) {
    for (const thing of thingsIn(level)) {
      const written = writtenAtThing(place, level.id, thing);
      const generic = !written && genericKindOf(thing) && !thing.used && !thing.usedOther;
      if (!written && !generic) continue;
      const big = (written && BIG_CLASSES.includes(classWord(WORLD_COMPUTERS[written].class))) || genericKindOf(thing) === "server";
      value.computers.push({ text: `${thing.name} in ${level.name}: ${big ? "everything" : `everything in ${level.name}`}` });
    }
  }
  for (const [id, computer] of Object.entries(WORLD_COMPUTERS)) {
    if (computer.place !== place || computer.thing || computer.door) continue;
    if (BIG_CLASSES.includes(classWord(computer.class))) value.computers.push({ text: `${id}: everything` });
  }
  return value;
}

// Everyone a place's file could name as a guard or an engineer: the people with days there, and the ones at their posts.
function peopleAt(place, map) {
  const life = WORLD_LIFE[place] ?? {};
  const people = [];
  const add = (key, name) => { if (key && !people.some((one) => one.key === key)) people.push({ key, name: name ?? key }); };
  for (const id of Object.keys(life.people ?? {})) add(id, WORLD_CHARACTERS[id]?.name);
  for (const group of life.crowd ?? []) for (const [name] of group.names) add(name, name);
  for (const level of Object.values(map.levels)) for (const home of level.homes) add(home.id, home.label ?? WORLD_CHARACTERS[home.id]?.name);
  return people;
}

// The people at a place, for the board's lists of guards and engineers.
export const placePeople = (place) => (mapFor(place) ? peopleAt(place, mapFor(place)) : []);

function peopleFor(place, map, list, wordsKey, what, at) {
  const known = peopleAt(place, map);
  if (Array.isArray(list)) {
    return list.map((one) => {
      // A post in the place's chain of command ("the chief engineer"): whoever holds it, at the time. A job ("the
      // techs"): whoever does it.
      const post = postByWords(place, one);
      if (post && /^the\s/i.test(String(one).trim())) return `post:${post}`;
      const job = jobByWords(place, one);
      if (job && /^the\s/i.test(String(one).trim())) return `job:${job}`;
      const want = plain(one);
      const found = known.find((person) => plain(person.key) === want || plain(person.name) === want || plain(person.name).split(" ").includes(want));
      if (!found) at(null, `${what}: ${one} isn't anyone with a day or a post at this place`);
      return found?.key ?? null;
    }).filter(Boolean);
  }
  const words = D()[wordsKey] ?? [];
  const life = WORLD_LIFE[place] ?? {};
  const matches = (day) => day.some((block) => words.some((word) => String(block.doing ?? "").toLowerCase().includes(word)));
  const keys = Object.entries(life.people ?? {}).filter(([, day]) => matches(day)).map(([id]) => id);
  for (const group of life.crowd ?? []) if (matches(group.day)) keys.push(...group.names.map(([name]) => name));
  return keys;
}

const models = new Map();
const compiling = new Set();

// Read again after a file changes. The maps are made again too, because parts on the floor are part of the map.
export function clearSystems() {
  models.clear();
}
// One place's, once the player has left it and its map is let go of (keepOnly in src/walk.js): made again with the map.
export const forgetSystems = (place) => models.delete(place);
// Whether a place's systems are being made right now, so its map isn't whole yet (src/room-hooks.js waits for it).
export const systemsPending = (place) => compiling.has(place);
// A room's air made no better than this, for a fire or a hole in the hull (src/emergencies.js). The place's state is
// made if it isn't there yet, so that the air goes on moving from there.
export function foulAir(game, place, room, most) {
  const state = stateOf(game, place, true);
  state.air[room] = Math.min(state.air[room] ?? 100, most);
}

export function systemsOf(place) {
  if (!place) return null;
  if (models.has(place)) return models.get(place);
  if (compiling.has(place)) return null;
  compiling.add(place);
  try {
    models.set(place, compileSystems(place));
  } catch (err) {
    console.error(`The systems at ${place} can't be used: ${err.message}`);
    models.set(place, null);
  } finally {
    compiling.delete(place);
  }
  return models.get(place);
}

function compileSystems(place) {
  const map = mapFor(place);
  if (!map) return null;
  const own = WORLD_SYSTEMS[place];
  const file = own ?? defaultFileFor(place, map);
  const name = LOCATIONS[place]?.name ?? map.name ?? place;
  const problems = [];
  const at = (line, message) => problems.push({ line: line ?? null, message });
  const findRoom = roomFinder(map);
  const levels = roomsOf(map);
  const model = {
    place, name, written: Boolean(own), file, numbers: numbersOf(file),
    systems: [], parts: {}, partsIn: {}, doors: {}, circuits: {}, alarmLocks: [], computers: [], guards: [], engineers: [], problems,
  };
  const roomsFor = (list, line) => list.map((one) => findRoom(one) ?? (at(line, `${name} has no room called ${one}`), null)).filter(Boolean);
  const addPart = (system, partName, level, extra = {}) => {
    const base = `${system}:${slugOf(partName)}:${level.id}`;
    let id = base;
    for (let n = 2; model.parts[id]; n += 1) id = `${base}:${n}`;
    const part = { id, system, name: partName, kind: extra.kind ?? kindOf(partName, system), room: level.id, ...extra };
    model.parts[id] = part;
    (model.partsIn[level.id] ??= []).push(id);
    return part;
  };
  for (const system of file.systems ?? []) {
    if (model.systems.some((one) => one.id === system.id)) continue;
    const entry = { id: system.id, name: system.name, title: SYSTEM_TITLES[system.id] ?? upperFirst(system.name), known: KNOWN_SYSTEMS.includes(system.id), parts: [] };
    model.systems.push(entry);
    for (const raw of system.lines ?? []) {
      const text = typeof raw === "string" ? raw : raw.text;
      const line = raw.line ?? null;
      if (entry.id === "doors") {
        const door = readDoorLine(text);
        if (door.problem) {
          at(line, door.problem);
          continue;
        }
        for (const level of roomsFor(door.rooms, line)) {
          if (model.doors[level.id]) at(line, `the door to ${level.name} is written twice`);
          else if (!waysInto(map, level.id).length) at(line, `nothing leads into ${level.name}, so it has no door to lock`);
          else {
            model.doors[level.id] = { id: `door:${level.id}`, to: level.id, look: door.look, story: storyClosedInto(map, level.id) };
            entry.parts.push(model.doors[level.id].id);
          }
        }
        continue;
      }
      if (entry.id === "alarm") {
        const locks = readLocksLine(text);
        if (locks) {
          for (const level of roomsFor(locks.rooms, line)) model.alarmLocks.push(level.id);
          continue;
        }
      }
      const parsed = readPartLine(text);
      if (parsed.problem) {
        at(line, parsed.problem);
        continue;
      }
      if (parsed.feeds && entry.id !== "power") at(line, "only a power part has for and the rooms it powers");
      for (const level of parsed.every ? levels : roomsFor(parsed.rooms, line)) {
        const feeds = entry.id === "power" ? (parsed.feeds ? roomsFor(parsed.feeds, line) : [level]) : null;
        const part = addPart(entry.id, parsed.part, level, { look: parsed.look, ...(feeds ? { feeds: feeds.map((one) => one.id) } : {}) });
        entry.parts.push(part.id);
        for (const fed of feeds ?? []) {
          const had = model.circuits[fed.id];
          if (had) at(line, `${fed.name} is already powered by the ${model.parts[had].name} in ${roomOf(map, model.parts[had].room)?.name ?? model.parts[had].room}`);
          else model.circuits[fed.id] = part.id;
        }
      }
    }
  }
  for (const id of model.alarmLocks) if (!model.doors[id]) at(null, `the alarm locks the door to ${roomOf(map, id)?.name ?? id}, which needs to be under Doors too`);
  model.guards = peopleFor(place, map, file.guards, "guard words", "guards", at);
  model.engineers = peopleFor(place, map, file.engineers, "engineer words", "engineers", at);
  for (const raw of file.computers ?? []) {
    const text = typeof raw === "string" ? raw : raw.text;
    const line = raw.line ?? null;
    const c = readComputerLine(text);
    if (c.problem) {
      at(line, c.problem);
      continue;
    }
    for (const sid of c.systems) if (sid !== "everything" && !model.systems.some((one) => one.id === sid)) at(line, `${name} has no system called ${sid}`);
    const systems = c.systems.includes("everything") ? model.systems.map((one) => one.id) : c.systems.filter((sid) => model.systems.some((one) => one.id === sid));
    const rooms = c.rooms ? roomsFor(c.rooms, line).map((one) => one.id) : null;
    if (c.hardened && !c.room) at(line, `only a console the file puts in a room is hardened here: a written computer says "hardened: yes" in its own file`);
    if (c.classKey && !["easy", "moderate", ...BIG_CLASSES].includes(c.classKey)) at(line, `a console's class is easy, moderate, hard, very hard or nearly impossible, not ${c.classKey}`);
    let ref = null;
    if (c.room) {
      const level = findRoom(c.room);
      if (!level) {
        at(line, `${name} has no room called ${c.room}`);
        continue;
      }
      const thing = thingsIn(level).find((one) => plain(one.name) === plain(c.ref));
      if (thing) ref = { kind: "thing", thing: thing.id, room: level.id, name: thing.name };
      else {
        const part = addPart("computers", c.ref, level, { kind: "console", classKey: c.classKey ?? "moderate", ...(c.hardened ? { hardened: true } : {}) });
        ref = { kind: "console", part: part.id, room: level.id, name: part.name };
      }
    } else if (WORLD_COMPUTERS[c.ref]) ref = { kind: "written", id: c.ref, room: null, name: WORLD_COMPUTERS[c.ref].name };
    else {
      for (const level of levels) {
        const thing = thingsIn(level).find((one) => plain(one.name) === plain(c.ref));
        if (thing) {
          ref = { kind: "thing", thing: thing.id, room: level.id, name: thing.name };
          break;
        }
      }
    }
    if (!ref) {
      at(line, `"${c.ref}" isn't a computer in world/computers or a thing at ${name}. To put a new console in a room, write it as a console in and the room's name`);
      continue;
    }
    model.computers.push({ ref, systems, rooms, line });
  }
  // Every part gets its square: on a wall where there's one free, else standing on the floor where it blocks nothing.
  // On a deck, within the room drawn there, and the squares taken are the deck's, shared by all its rooms.
  const takenOn = new Map();
  for (const [room, ids] of Object.entries(model.partsIn)) {
    const entry = roomOf(map, room);
    const { level, area } = entry;
    const claimed = claimedSquares(place, map, level);
    const every = wallSpots(level, claimed, area);
    const fitted = fittedSquares(level);
    // On walls that stand full height, where the room has one free for each of its parts; else on any of its walls.
    const standing = every.filter((one) => !one.low && !fitted.has(`${one.x},${one.y}`));
    const walls = standing.length >= ids.length ? standing : every;
    if (!takenOn.has(level.id)) takenOn.set(level.id, new Set());
    const taken = takenOn.get(level.id);
    ids.forEach((id, i) => {
      const part = model.parts[id];
      let spot = null;
      if (walls.length) {
        const first = Math.floor(((i + 0.5) * walls.length) / ids.length);
        for (let k = 0; k < walls.length && !spot; k += 1) {
          const one = walls[(first + k) % walls.length];
          if (!taken.has(`${one.x},${one.y}`) && !fitted.has(`${one.x},${one.y}`)) spot = one;
        }
      }
      spot ??= floorSpot(level, taken, i, ids.length, claimed, area);
      if (!spot) {
        at(null, `there's no room left in ${entry.name} for the ${part.name}`);
        part.unplaced = true;
        return;
      }
      taken.add(`${spot.x},${spot.y}`);
      Object.assign(part, { x: spot.x, y: spot.y, mount: spot.face ? "wall" : "floor", face: spot.face ?? null });
      if (!spot.face) level.solid.add(`${spot.x},${spot.y}`);
    });
  }
  // Every door the systems run has its keypad on the wall beside it, placed after every other part has its square so
  // none of theirs moves. Using it opens the door's panel (src/devices.js).
  const doorsSystem = model.systems.find((one) => one.id === "doors");
  for (const door of Object.values(model.doors)) {
    const entry = roomOf(map, door.to);
    if (!entry?.level) continue;
    // Nowhere beside the door at all: it's left out, and the door's own panel is still there to hack when it's locked.
    const spot = panelSpot(place, map, entry, takenOn);
    if (!spot) continue;
    // On a deck it's the door's room's (listed there, on that room's power), used from the side of the wall it hangs on;
    // where rooms are levels of their own, it's the room it hangs in.
    const owner = spot.level.id === entry.level.id ? entry : roomOf(map, spot.room) ?? entry;
    const part = addPart("doors", `${String(entry.name).replace(/^The /, "")} door panel`, owner, { kind: "door panel", door: door.to, side: spot.room });
    doorsSystem?.parts.push(part.id);
    if (!takenOn.has(spot.level.id)) takenOn.set(spot.level.id, new Set());
    takenOn.get(spot.level.id).add(`${spot.x},${spot.y}`);
    Object.assign(part, { x: spot.x, y: spot.y, mount: spot.face ? "wall" : "floor", face: spot.face ?? null });
    if (!spot.face) spot.level.solid.add(`${spot.x},${spot.y}`);
  }
  return model;
}

// The parts of one system, in one room or all of them.
export const partsOf = (model, system, room = null) => (model?.systems.find((one) => one.id === system)?.parts ?? [])
  .map((id) => model.parts[id])
  .filter((part) => part && !part.unplaced && (!room || part.room === room));
const hasSystem = (model, system) => Boolean(model?.systems.some((one) => one.id === system));
const roomNameOf = (place, room) => roomOf(mapFor(place), room)?.name ?? room;

// The people in a room right now: on a deck, those in the room drawn there, not the whole deck.
function peopleIn(game, place, roomId) {
  const room = roomOf(mapFor(place), roomId);
  if (!room) return [];
  const here = livesHere(place) ? peopleAboard(game, place, room.levelId) : room.level.homes.filter((home) => atPost(game, home.id));
  return room.area ? here.filter((one) => room.level.areaAt(one.x, one.y) === room.id) : here;
}

// ---- The state, in the save ------------------------------------------------------------------------

function stateOf(game, place, make = false) {
  if (!make) return game.systems?.[place] ?? null;
  game.systems ??= {};
  return (game.systems[place] ??= { at: hoursNow(game), parts: {}, doors: {}, air: {}, alarm: {}, noted: {} });
}
const partState = (game, place, id) => game.systems?.[place]?.parts?.[id] ?? NORMAL;
const doorState = (game, place, room) => game.systems?.[place]?.doors?.[room] ?? NORMAL;
const alarmState = (game, place) => game.systems?.[place]?.alarm ?? NORMAL;

// What's back to normal is dropped, and a place that's all normal leaves nothing in the save.
function tidy(game, place) {
  const state = game.systems?.[place];
  if (!state) return;
  const now = hoursNow(game);
  for (const [id, s] of Object.entries(state.parts)) {
    if (s.loopUntil !== undefined && !(s.loopUntil > now)) {
      delete s.loopUntil;
      delete s.frozen;
    }
    if (s.on !== false && !s.damage && s.loopUntil === undefined) delete state.parts[id];
  }
  for (const [room, s] of Object.entries(state.doors)) if (!s.locked && !s.forced) delete state.doors[room];
  if (state.cut && !Object.keys(state.cut).length) delete state.cut;
  for (const [room, q] of Object.entries(state.air)) if (q >= 100) delete state.air[room];
  if (!state.alarm.ringing && !state.alarm.disarmed) state.alarm = {};
  for (const key of Object.keys(state.noted)) if (state.air[key.split(":")[1]] === undefined) delete state.noted[key];
  // Who's gone short of air and by how much (src/no-air.js), and what the air did to the player that hasn't been said.
  if (state.warned && !Object.keys(state.air).length) delete state.warned;
  if (state.short && !Object.keys(state.short).length) delete state.short;
  if (state.owed && !state.owed.stress && !state.owed.health) delete state.owed;
  const empty = !Object.keys(state.parts).length && !Object.keys(state.doors).length && !Object.keys(state.air).length && !state.alarm.ringing && !state.alarm.disarmed && !state.cut && !state.short && !state.owed && !state.nowhere && !state.toll && !state.reserve;
  if (empty) delete game.systems[place];
  if (game.systems && !Object.keys(game.systems).length) delete game.systems;
}

// The captain's own ship is theirs to run, so nobody switches back what they do there.
export const ownedBy = (game, place) => place === "meridian" && isCaptain(game);

// ---- What's working --------------------------------------------------------------------------------

// The generator against the loads (world/logistics): what the place's generator gives, what each system draws, and
// which systems are let go, in the written order, when there isn't enough for them all. Null where no generator is
// written, so nothing changes at a place that hasn't one. Looked at often, so it's kept until something it hangs on
// changes: the supply, whether the ship's under way, or a part being switched or broken.
const balances = new WeakMap();
export function powerBalance(game, place) {
  const supply = powerSupply(game, place);
  const model = systemsOf(place);
  if (supply === null || !model) return null;
  const state = game.systems?.[place];
  const underWay = place === "meridian" && Boolean(game.ship?.underWay);
  const key = `${supply}|${underWay}|${JSON.stringify(state?.parts ?? {})}`;
  let mine = balances.get(game);
  if (!mine) balances.set(game, (mine = new Map()));
  if (mine.get(place)?.key === key) return mine.get(place).value;
  const live = (part) => {
    const s = partState(game, place, part.id);
    return !part.unplaced && s.on !== false && !s.damage;
  };
  const loads = [];
  for (const load of loadsOf(place)) {
    if (load.underWay && !underWay) continue;
    let count = 1;
    if (load.system === "computers") count = load.per ? model.computers.length : 1;
    else if (load.system === "doors") {
      // The doors the place's systems run aren't parts on a wall: each is a lock in a doorway.
      const doors = Object.keys(model.doors ?? {}).length;
      if (!doors) continue;
      count = load.per ? doors : 1;
    } else {
      const parts = partsOf(model, load.system).filter(live);
      if (!parts.length) continue;
      count = load.per === "room" ? new Set(parts.map((part) => part.room)).size : load.per === "each" ? parts.length : 1;
    }
    if (load.amount * count > 0) loads.push({ system: load.system, title: SYSTEM_TITLES[load.system] ?? load.words, amount: load.amount * count });
  }
  const load = loads.reduce((sum, one) => sum + one.amount, 0);
  let running = load;
  const dropped = [];
  for (const id of dropOrderOf(place)) {
    if (running <= supply) break;
    const one = loads.find((entry) => entry.system === id);
    if (!one) continue;
    dropped.push(id);
    running -= one.amount;
  }
  const value = { supply, load, loads, dropped, running, short: Math.max(0, load - supply) };
  mine.set(place, { key, value });
  return value;
}

// How the place's power stands, for the room's picture: none at all, or not enough, with the systems let go. Null
// while there's enough, or where nothing counts the power.
export function powerView(game, place) {
  const b = powerBalance(game, place);
  if (!b) return null;
  if (b.supply <= 0) return { off: true };
  return b.short > 0 ? { short: true, dropped: b.dropped } : null;
}

// The generator against the loads, in a line: for the Ship menu, a computer's screen and the reactor's readouts.
export function powerNote(game, place) {
  const b = powerBalance(game, place);
  if (!b) return null;
  const loads = b.loads.map((one) => `${one.title.toLowerCase()} ${one.amount}`).join(", ");
  if (b.supply <= 0) return `No power: the generator's stopped. The ship would draw ${b.load}: ${loads}.`;
  const names = b.dropped.map((id) => (SYSTEM_TITLES[id] ?? id).toLowerCase());
  const tail = b.dropped.length ? ` That's ${b.short} more than it gives, so ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`} ${names.length === 1 ? "is" : "are"} let go until there's more.` : " Nothing's let go.";
  return `The generator gives ${b.supply} power, and the ship draws ${b.load}: ${loads}.${tail}`;
}

// Whether a system's parts have the power for them: not when the generator's stopped, and not when the system's been
// let go for want of enough.
function starved(game, place, system) {
  const b = powerBalance(game, place);
  return Boolean(b) && (b.supply <= 0 || b.dropped.includes(system));
}

export function roomPowered(game, place, room) {
  // Only whether the generator gives anything matters here, so the whole balance isn't worked out: the ship's machines
  // ask this for every piece of the clock, and a year of it was a quarter of a long wait.
  const supply = systemsOf(place) ? powerSupply(game, place) : null;
  if (supply !== null && supply <= 0) return false;
  const box = systemsOf(place)?.circuits[room];
  if (!box) return true;
  if (game.systems?.[place]?.cut?.[room]) return false;
  const s = partState(game, place, box);
  return s.on !== false && !s.damage;
}

export function partWorks(game, place, part) {
  const s = partState(game, place, part.id);
  if (s.on === false || s.damage) return false;
  if (NEEDS_NO_POWER.has(part.kind)) return true;
  return !starved(game, place, part.system) && roomPowered(game, place, part.room);
}

export function roomDark(game, place, room) {
  const model = systemsOf(place);
  if (!model) return false;
  const switches = partsOf(model, "lights", room);
  if (switches.length) return !switches.some((part) => partWorks(game, place, part));
  return Boolean(model.circuits[room]) && !roomPowered(game, place, room);
}

export function airFlows(game, place, room) {
  const model = systemsOf(place);
  if (!hasSystem(model, "air")) return true;
  const all = partsOf(model, "air");
  const plants = all.filter((part) => part.kind === "air plant");
  const vents = all.filter((part) => part.kind !== "air plant" && part.room === room);
  if (plants.length && !plants.some((part) => partWorks(game, place, part))) {
    // The plant's stopped, or has no power. Where the place has reserve air, that reaches every room while there's
    // any left, power or none, unless the room's own vent has been shut or broken.
    if (reserveLeft(game, place) <= 0) return false;
    return !vents.length || vents.some((part) => {
      const s = partState(game, place, part.id);
      return s.on !== false && !s.damage;
    });
  }
  return !vents.length || vents.some((part) => partWorks(game, place, part));
}
// Whether a place's air plant is stopped: switched off, broken, or with no power to run on. Not at a place without one.
function plantStopped(game, place, model = systemsOf(place)) {
  const plants = partsOf(model, "air").filter((part) => part.kind === "air plant");
  return plants.length > 0 && !plants.some((part) => partWorks(game, place, part));
}
// A place's reserve air, in minutes: how much it has in all, and how much is left. Nothing where its file gives none.
const reserveAll = (place) => (systemsOf(place)?.numbers.reserve ?? 0) * 24 * 60;
export const reserveLeft = (game, place) => Math.max(0, reserveAll(place) - (game.systems?.[place]?.reserve ?? 0));
// The reserve in words, for a line and for a look at the air plant: "4 days and 6 hours", "9 hours", "40 minutes".
function reserveWords(minutes) {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes - days * 1440) / 60);
  if (days) return `${days} day${days === 1 ? "" : "s"}${hours ? ` and ${hours} hour${hours === 1 ? "" : "s"}` : ""}`;
  if (hours) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.max(1, Math.round(minutes))} minutes`;
}
export const airIn = (game, place, room) => game.systems?.[place]?.air?.[room] ?? 100;

export const watched = (game, place, room) => partsOf(systemsOf(place), "cameras", room).some((part) => partWorks(game, place, part) && !cameraLooped(game, place, part.id));

// ---- A junction box's feeds, a camera's loop (step 6 of the hacking rework) ------------------------------------

// The rooms a junction box feeds, by their ids.
export const feedsOf = (place, id) => Object.entries(systemsOf(place)?.circuits ?? {}).filter(([, box]) => box === id).map(([room]) => room);
export const feedCut = (game, place, room) => Boolean(game.systems?.[place]?.cut?.[room]);
// One room's feed cut, or put back, at its junction box's breakers: the room's dark, and its machines stop. At a place
// that isn't the player's, its people put it back after a while, as with anything else switched by hand.
export function cutFeed(game, place, room, cut, { by = "player" } = {}) {
  const model = systemsOf(place);
  if (!model?.circuits[room]) throw new Error("No junction box feeds that room.");
  const state = stateOf(game, place, true);
  state.cut ??= {};
  if (cut) {
    state.cut[room] = { by, since: hoursNow(game) };
    const back = backAfter(game, place, model, by);
    if (back) state.cut[room].backAt = back;
  } else delete state.cut[room];
  return settleChange(game, place);
}
export const cameraLooped = (game, place, id) => (game.systems?.[place]?.parts?.[id]?.loopUntil ?? 0) > hoursNow(game);
// What a looped camera shows: who was in its picture when the loop began.
export const cameraFrozen = (game, place, id) => game.systems?.[place]?.parts?.[id]?.frozen ?? [];
export function loopCamera(game, place, id, minutes, frozen) {
  const s = (stateOf(game, place, true).parts[id] ??= {});
  Object.assign(s, { loopUntil: hoursNow(game) + minutes / 60, frozen });
}
export function endLoop(game, place, id) {
  const s = game.systems?.[place]?.parts?.[id];
  if (!s) return;
  delete s.loopUntil;
  delete s.frozen;
  tidy(game, place);
}

export function alarmCanRing(game, place) {
  const model = systemsOf(place);
  if (!hasSystem(model, "alarm") || alarmState(game, place).disarmed) return false;
  return partsOf(model, "alarm").some((part) => partWorks(game, place, part));
}
export const alarmRinging = (game, place) => alarmState(game, place).ringing ?? null;

export function commsUp(game, place) {
  const relays = partsOf(systemsOf(place), "comms");
  return !relays.length || relays.some((part) => partWorks(game, place, part));
}

export function doorLocked(game, place, room) {
  const s = doorState(game, place, room);
  return Boolean(s.locked && !s.forced);
}

// An exit is shut when the door into the room it leads to is locked, or the door of the room it's in.
export function exitLocked(game, place, levelId, exit) {
  if (exit.back || !systemsOf(place)) return false;
  return doorLocked(game, place, exit.to) || doorLocked(game, place, levelId);
}

// Where the player is standing, if it's somewhere with systems.
export function playerSpot(game) {
  const place = game.location;
  const map = mapFor(place);
  if (!map || !systemsOf(place)) return null;
  const walk = game.walk?.place === place ? game.walk : null;
  if (walk?.room) return null;
  const level = walk?.level ? map.levels[walk.level] : null;
  return { place, room: level ? level.roomAt(walk.x, walk.y) : map.start };
}

// Whether the player can reach a part to work it: standing in its room (or, for a door's keypad, the room it hangs
// in), or right beside it on the same deck, which a part on a wall where two rooms meet needs; never from behind the
// wall it hangs on.
export function partInReach(game, place, part) {
  const spot = playerSpot(game);
  if (!spot || spot.place !== place || !part || part.unplaced) return false;
  if (part.room === spot.room || (part.side && part.side === spot.room)) return true;
  const walk = game.walk;
  const level = roomOf(mapFor(place), part.room)?.level;
  if (!walk || !level || walk.level !== level.id) return false;
  const [x, y] = [Math.round(walk.x), Math.round(walk.y)];
  if (Math.max(Math.abs(x - part.x), Math.abs(y - part.y)) > 1) return false;
  if (part.mount === "wall") return part.face === "side" ? x >= part.x : y >= part.y;
  return true;
}

// ---- Changing things ---------------------------------------------------------------------------------

const backAfter = (game, place, model, by) => (by !== "player" || ownedBy(game, place) || (!model.guards.length && !model.engineers.length) ? null : hoursNow(game) + model.numbers.back);

export function switchPart(game, place, id, on, { by = "player" } = {}) {
  const model = systemsOf(place);
  if (!model?.parts[id]) throw new Error("There's no such part.");
  const state = stateOf(game, place, true);
  const s = (state.parts[id] ??= {});
  if (on) {
    delete s.on;
    delete s.backAt;
  } else {
    Object.assign(s, { on: false, by, since: hoursNow(game) });
    const back = backAfter(game, place, model, by);
    if (back) s.backAt = back;
    else delete s.backAt;
  }
  const lines = settleChange(game, place);
  // The player's own hand stopping the air of a place that's theirs to run is said plainly, once: nobody there will
  // put it back for them, and people die without it (src/no-air.js).
  if (!on && by === "player" && ownedBy(game, place)) {
    const plants = partsOf(model, "air").filter((part) => part.kind === "air plant");
    const stopped = plants.length > 0 && !plants.some((part) => partWorks(game, place, part));
    if (stopped && !state.warned) {
      state.warned = true;
      const reserve = reserveLeft(game, place);
      lines.push(`[AIR] That stops the air for the whole ship. ${reserve > 0 ? `She has reserve air for ${reserveWords(reserve)}; after that nobody` : "Nobody"} aboard lasts more than a few hours without it, and nobody will start it again but you.`);
    }
  }
  return lines;
}

// How long the engineers take to fix something: the place's hours, quicker or slower by the best of them at engineering.
const repairHours = (game, place, model) => model.numbers.repair / speedOf(game, place, staffOf(game, place, model.engineers), "engineering");

export function damagePart(game, place, id, damage = "broken", { by = "player" } = {}) {
  const model = systemsOf(place);
  if (!model?.parts[id]) throw new Error("There's no such part.");
  const state = stateOf(game, place, true);
  const s = (state.parts[id] ??= {});
  Object.assign(s, { damage, by, since: hoursNow(game) });
  if (model.engineers.length) s.fixAt = hoursNow(game) + repairHours(game, place, model);
  else delete s.fixAt;
  return settleChange(game, place);
}

// The engineers mend what a battle broke in an order (src/aftermath.js): this puts first the parts a story's words name,
// keeping the times the engineers will be done at, so that only the order changes. The words name systems (power,
// navigation, comms, alarm, cameras), kinds of part (nav core, relay) or rooms, joined with "and" or commas. Returns lines
// for the story.
export function mendFirst(game, place, words) {
  const model = systemsOf(place);
  const parts = game.systems?.[place]?.parts ?? {};
  const waiting = Object.entries(parts).filter(([id, s]) => s.damage && s.by === "battle" && s.fixAt !== undefined && model?.parts[id]).sort((a, b) => a[1].fixAt - b[1].fixAt);
  if (!waiting.length) return [];
  const map = mapFor(place);
  const plainWords = (one) => String(one ?? "").toLowerCase().replace(/^the\s+/, "").trim();
  const wants = String(words ?? "").split(/\s*,\s*|\s+and\s+/i).map(plainWords).filter(Boolean);
  const named = (id) => {
    const part = model.parts[id];
    const names = [part.system, part.kind, part.room, plainWords(map ? roomOf(map, part.room)?.name : null)];
    return wants.some((want) => names.includes(want) || names.includes(want.replace(/s$/, "")));
  };
  const first = waiting.filter(([id]) => named(id));
  if (!first.length) return [`[SYSTEMS] Nothing of that is waiting to be mended. The engineers carry on as they were.`];
  const slots = waiting.map(([, s]) => s.fixAt);
  [...first, ...waiting.filter(([id]) => !named(id))].forEach(([, s], k) => {
    s.fixAt = slots[k];
  });
  const names = first.map(([id]) => `the ${model.parts[id].name}`);
  return [`[SYSTEMS] The engineers will mend ${names.length < 2 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`} first.`];
}

// What a battle broke that's still waiting to be mended, room by room, in the order the engineers will get to it:
// "the junction box in The Names Bulkhead; the nav core and the relay in The Bridge". When it's all mended, says so.
export function battleDamageWords(game, place) {
  const model = systemsOf(place);
  const map = mapFor(place);
  const byRoom = new Map();
  for (const [id, s] of Object.entries(game.systems?.[place]?.parts ?? {}).sort((a, b) => (a[1].fixAt ?? 0) - (b[1].fixAt ?? 0))) {
    const part = model?.parts[id];
    if (!part || !s.damage || s.by !== "battle") continue;
    byRoom.set(part.room, [...(byRoom.get(part.room) ?? []), `the ${part.name}`]);
  }
  if (!byRoom.size) return "nothing left to mend";
  const listed = (names) => (names.length < 2 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
  return [...byRoom].map(([room, names]) => `${listed(names)} in ${(map ? roomOf(map, room)?.name : null) ?? room}`).join("; ");
}

export function repairPart(game, place, id) {
  const s = game.systems?.[place]?.parts?.[id];
  if (s) {
    delete s.damage;
    delete s.fixAt;
    delete s.noParts;
  }
  return settleChange(game, place);
}

// Locking needs the door's panel to have power, unless it's the story doing it. A forced door won't lock at all.
export function setDoor(game, place, room, how, { by = "player", recode = false } = {}) {
  const model = systemsOf(place);
  const door = model?.doors[room];
  if (!door) throw new Error("That door isn't one the place's systems run.");
  const state = stateOf(game, place, true);
  const s = (state.doors[room] ??= {});
  const lines = [];
  const name = roomNameOf(place, room);
  if (how === "locked") {
    if (s.forced) lines.push(`[DOOR] The door to ${name} has been forced, and won't lock.`);
    else {
      Object.assign(s, { locked: true, by, since: hoursNow(game) });
      const back = recode ? null : backAfter(game, place, model, by);
      if (back) s.backAt = back;
      else delete s.backAt;
      if (recode) s.recoded = true;
      lines.push(recode ? `[DOOR] The door to ${name} is locked, with a new code nobody else has.` : `[DOOR] The door to ${name} is locked.`);
    }
  } else if (how === "unlocked") {
    delete s.locked;
    delete s.backAt;
    delete s.recoded;
    lines.push(`[DOOR] The door to ${name} is unlocked.`);
  } else if (how === "forced") {
    Object.assign(s, { forced: true, by, since: hoursNow(game) });
    delete s.locked;
    delete s.backAt;
    if (model.engineers.length) s.fixAt = hoursNow(game) + repairHours(game, place, model);
  } else if (how === "fixed") {
    delete s.forced;
    delete s.fixAt;
    delete s.noParts;
  }
  // A story door that's opened stays open for the story too.
  if (how === "opened" || (how === "unlocked" && door.story)) {
    game.opened ??= {};
    game.opened[place] ??= [];
    if (!game.opened[place].includes(room)) game.opened[place].push(room);
    if (how === "opened") lines.push(`[DOOR] The way to ${name} is open.`);
  }
  lines.push(...settleChange(game, place));
  return lines;
}

// Seen plugging into the place's own box or camera (src/devices.js): the same as being seen tampering.
export function seenTampering(game, place, who) {
  const model = systemsOf(place);
  if (!model) return [];
  return [`[SYSTEMS] ${who ? `${who[0].toUpperCase()}${who.slice(1)} saw` : "Someone saw"} you plug into ${model.name}'s systems.`, ...seenCost(game, place, model)];
}

// Whoever holds the place hears about it, and it goes on the record for the stories.
function seenCost(game, place, model) {
  const lines = [];
  countForDuty(game, place, "tampering");
  const standing = changeStanding(game, holderOf(game, place), D().seen?.standing ?? -2, `You were seen tampering with the systems at ${model.name}.`);
  if (standing) lines.push(standing);
  try {
    recordFact(game, { id: `seen_tampering_at_${place}`.slice(0, 40), text: `You were seen tampering with the systems at ${model.name}.`, from: "systems" });
  } catch {
    // A full record keeps what it has.
  }
  return lines;
}

export function soundAlarm(game, place, room, { seen = false, by = "player" } = {}) {
  const model = systemsOf(place);
  const lines = [];
  if (!model) return lines;
  if (!alarmCanRing(game, place)) {
    if (seen) lines.push(...seenCost(game, place, model));
    return lines;
  }
  const state = stateOf(game, place, true);
  const had = state.alarm.ringing;
  state.alarm.ringing = { room: room ?? had?.room ?? null, since: had?.since ?? hoursNow(game), seen: Boolean(seen || had?.seen), by };
  if (!had) {
    countForDuty(game, place, "alarms");
    lines.push(`[ALARM] The alarm is ringing at ${model.name}${room ? `, in ${roomNameOf(place, room)}` : ""}.`);
    for (const to of model.alarmLocks) {
      const s = (state.doors[to] ??= {});
      if (s.forced || s.locked || !roomPowered(game, place, to)) continue;
      Object.assign(s, { locked: true, by: "alarm", since: hoursNow(game) });
      lines.push(`[DOOR] The door to ${roomNameOf(place, to)} locks.`);
    }
  }
  if (seen && !had?.seen) lines.push(...seenCost(game, place, model));
  return lines;
}

export function silenceAlarm(game, place, { quiet = false } = {}) {
  const state = game.systems?.[place];
  if (!state?.alarm?.ringing) return [];
  delete state.alarm.ringing;
  for (const s of Object.values(state.doors)) {
    if (s.by === "alarm" && s.locked) delete s.locked;
  }
  tidy(game, place);
  return quiet ? [] : [`[ALARM] The alarm at ${systemsOf(place)?.name ?? place} stops.`];
}

export function armAlarm(game, place, armed, { by = "player" } = {}) {
  const model = systemsOf(place);
  const state = stateOf(game, place, true);
  const lines = [];
  if (armed) {
    delete state.alarm.disarmed;
    delete state.alarm.backAt;
    lines.push(`[ALARM] The alarm at ${model.name} is armed.`);
  } else {
    lines.push(...silenceAlarm(game, place, { quiet: true }));
    const again = stateOf(game, place, true);
    again.alarm.disarmed = true;
    again.alarm.by = by;
    const back = backAfter(game, place, model, by);
    if (back) again.alarm.backAt = back;
    lines.push(`[ALARM] The alarm at ${model.name} is disarmed.`);
  }
  tidy(game, place);
  return lines;
}

// Anything that has to follow at once: an alarm with nothing left to ring through stops.
function settleChange(game, place) {
  const lines = [];
  if (alarmRinging(game, place) && !alarmCanRing(game, place)) lines.push(...silenceAlarm(game, place));
  tidy(game, place);
  return lines;
}

// ---- Time going by ---------------------------------------------------------------------------------

// What the game calls someone: the short name on their post, or their name, or the crowd name they go by.
const personName = (place, key) => (key === YOU ? "You" : Object.values(mapFor(place)?.levels ?? {}).flatMap((level) => level.homes).find((home) => home.id === key)?.label ?? WORLD_CHARACTERS[key]?.name ?? key);
// The guards or engineers as they are in a game: someone named by a post is whoever holds it now, a post nobody holds
// is nobody, and a job is everyone the watch bill has doing it who's about (never the player, whose hands are their own).
export const staffOf = (game, place, list) => [...new Set((list ?? []).flatMap((ref) => {
  if (String(ref).startsWith("post:")) return [holderKey(game, place, ref.slice(5))];
  if (String(ref).startsWith("job:")) return onJob(game, place, ref.slice(4)).filter((key) => key !== YOU && !lostReason(game, place, key));
  return [ref];
}).filter(Boolean))];
// "the chief engineer" for a post and "the techs" for a job, as the files and the board write them.
export const staffWords = (place, ref) => {
  if (String(ref).startsWith("post:")) return `the ${String(ref).slice(5).replace(/_/g, " ")}`;
  if (String(ref).startsWith("job:")) return `the ${jobById(place, String(ref).slice(4))?.title ?? String(ref).slice(4)}s`;
  return ref;
};

// A repair that's due takes what the place's logistics say a repair of that damage takes, from its stores. Without
// enough there it waits, which is said once, and starts again within the hour once some comes. Gives the words for
// what it took ("a parts crate from the parts lockers", or "" for a repair that takes nothing), or null while it waits.
function repairWith(game, place, model, s, damage, what, say, who = null) {
  const took = takeRepairParts(game, place, damage, what);
  if (took !== null) {
    delete s.noParts;
    return took;
  }
  delete s.fixAt;
  if (!s.noParts) say(`[SYSTEMS] ${personName(place, who ?? staffOf(game, place, model.engineers)[0] ?? "Someone")} can't fix ${what}: ${noPartsWords(place, damage)}.`);
  s.noParts = true;
  return null;
}

// ---- Repairs, for a place's work board (src/work.js) ---------------------------------------------------------
// A repair is known to the board by its part's id, or by door: and its room for a door that was forced.
const doorRef = (room) => `door:${room}`;
function repairOf(place, model, state, ref) {
  if (String(ref).startsWith("door:")) {
    const room = ref.slice(5);
    const st = state.doors[room];
    return st?.forced ? { ref, st, damage: "forced", door: room, room, name: `door to ${roomNameOf(place, room)}`, system: "doors", what: `the door to ${roomNameOf(place, room)}` } : null;
  }
  const part = model.parts[ref];
  const st = state.parts[ref];
  return part && st?.damage ? { ref, st, damage: st.damage, part, room: part.room, name: part.name, system: part.system, what: `the ${part.name} in ${roomNameOf(place, part.room)}` } : null;
}
// Everything at a place that's waiting to be mended, the soonest due first: each with when it's due, or that it's
// waiting for parts. Reading this changes nothing.
export function repairsWaiting(game, place) {
  const model = systemsOf(place);
  const state = game.systems?.[place];
  if (!model || !state) return [];
  const refs = [...Object.keys(state.parts).filter((id) => model.parts[id] && state.parts[id].damage), ...Object.keys(state.doors).filter((room) => state.doors[room].forced).map(doorRef)];
  return refs.map((ref) => repairOf(place, model, state, ref)).filter((one) => one && (one.st.fixAt || one.st.noParts))
    .map(shown).sort((a, b) => (a.fixAt ?? Infinity) - (b.fixAt ?? Infinity));
}
// The repairs that are due by a time, the soonest first, and nothing that's waiting for parts: what the board looks
// at every few minutes, so it's kept cheap. Reading this changes nothing.
const NONE_DUE = Object.freeze([]);
const shown = ({ st, ...rest }) => ({ ...rest, fixAt: st.fixAt ?? null, noParts: Boolean(st.noParts), battle: st.by === "battle" });
export function repairsDue(game, place, by) {
  const state = game.systems?.[place];
  if (!state) return NONE_DUE;
  let refs = null;
  for (const id in state.parts) {
    const s = state.parts[id];
    if (s.fixAt && s.fixAt <= by && s.damage) (refs ??= []).push(id);
  }
  for (const room in state.doors) {
    const s = state.doors[room];
    if (s.fixAt && s.fixAt <= by && s.forced) (refs ??= []).push(doorRef(room));
  }
  if (!refs) return NONE_DUE;
  const model = systemsOf(place);
  return model ? refs.map((ref) => repairOf(place, model, state, ref)).filter(Boolean).map(shown).sort((a, b) => a.fixAt - b.fixAt) : NONE_DUE;
}
// One repair, by what the board knows it as: null when it's been mended.
export function repairNow(game, place, ref) {
  const model = systemsOf(place);
  const state = game.systems?.[place];
  const found = model && state ? repairOf(place, model, state, ref) : null;
  return found && (found.st.fixAt || found.st.noParts) ? shown(found) : null;
}
// Whether anything at a place is waiting for parts before it can be mended.
export function anyWaitingForParts(game, place) {
  const state = game.systems?.[place];
  if (!state) return false;
  for (const id in state.parts) if (state.parts[id].noParts) return true;
  for (const room in state.doors) if (state.doors[room].noParts) return true;
  return false;
}
// What's waiting for parts before it can be mended, by what the board knows each as. Cheap: it builds nothing while
// nothing's waiting.
export function partsWaitingRefs(game, place) {
  const state = game.systems?.[place];
  if (!state) return NONE_DUE;
  let refs = null;
  for (const id in state.parts) if (state.parts[id].noParts && state.parts[id].damage) (refs ??= []).push(id);
  for (const room in state.doors) if (state.doors[room].noParts && state.doors[room].forced) (refs ??= []).push(doorRef(room));
  return refs ?? NONE_DUE;
}
// A repair nobody's on can't be finished in under an hour from now: the hour starts when an engineer takes it.
export function holdRepair(game, place, ref, hours) {
  const model = systemsOf(place);
  const state = game.systems?.[place];
  const found = model && state ? repairOf(place, model, state, ref) : null;
  if (found?.st.fixAt && found.st.fixAt < hours + 1) found.st.fixAt = hours + 1;
}
// The board's engineer has had their hour at it: the repair is done, if what it takes is in the stores. Gives the
// lines for the story, said only where the player is.
export function finishRepair(game, place, ref, who) {
  const model = systemsOf(place);
  const state = game.systems?.[place];
  const lines = [];
  const found = model && state ? repairOf(place, model, state, ref) : null;
  if (!found?.st.fixAt) return lines;
  const here = place === game.location;
  const say = (...text) => { if (here) lines.push(...text); };
  const took = repairWith(game, place, model, found.st, found.damage, found.what, say, who);
  if (took !== null) {
    delete found.st[found.door ? "forced" : "damage"];
    delete found.st.fixAt;
    say(`[SYSTEMS] ${personName(place, who ?? staffOf(game, place, model.engineers)[0] ?? "Someone")} has fixed ${found.what}${took ? `, with ${took}` : ""}.`);
    tidy(game, place);
  }
  return lines;
}
// Who mends at a place, in the order they're asked.
export const engineersOf = (game, place) => (systemsOf(place) ? staffOf(game, place, systemsOf(place).engineers) : []);

// Called whenever the clock moves. Only places where something isn't normal have anything to do.
export function advanceSystems(game) {
  const lines = [];
  if (!game.systems) return lines;
  const t = hoursNow(game);
  for (const place of Object.keys(game.systems)) {
    const model = systemsOf(place);
    const state = game.systems[place];
    if (!model) {
      delete game.systems[place];
      continue;
    }
    const here = place === game.location;
    const say = (...text) => { if (here) lines.push(...text); };
    // Where a work board gives the repairs out, it finishes them too, when its engineer's hour is up (src/work.js).
    const byClock = !boardRuns(place);
    // What the place's people put right, once it's due.
    for (const [id, s] of Object.entries(state.parts)) {
      const part = model.parts[id];
      if (!part) {
        delete state.parts[id];
        continue;
      }
      const where = roomNameOf(place, part.room);
      const what = `the ${part.name} in ${where}`;
      // What it was waiting for has come aboard: an engineer fetches it and fixes it within the hour.
      if (s.noParts && s.damage && !s.fixAt && repairPartsAboard(game, place, s.damage)) {
        delete s.noParts;
        s.fixAt = t + 1;
      }
      if (byClock && s.fixAt && s.fixAt <= t) {
        const took = repairWith(game, place, model, s, s.damage, what, say);
        if (took !== null) {
          delete s.damage;
          delete s.fixAt;
          say(`[SYSTEMS] ${personName(place, staffOf(game, place, model.engineers)[0] ?? "Someone")} has fixed ${what}${took ? `, with ${took}` : ""}.`);
        }
      }
      if (s.backAt && s.backAt <= t) {
        delete s.on;
        delete s.backAt;
        say(`[SYSTEMS] Someone at ${model.name} has put the ${part.name} in ${where} back on.`);
      }
    }
    for (const [room, cut] of Object.entries(state.cut ?? {})) {
      if (cut.backAt && cut.backAt <= t) {
        delete state.cut[room];
        say(`[SYSTEMS] Someone at ${model.name} has put the power back on in ${roomNameOf(place, room)}.`);
      }
    }
    for (const [room, s] of Object.entries(state.doors)) {
      const what = `the door to ${roomNameOf(place, room)}`;
      if (s.noParts && s.forced && !s.fixAt && repairPartsAboard(game, place, "forced")) {
        delete s.noParts;
        s.fixAt = t + 1;
      }
      if (byClock && s.fixAt && s.fixAt <= t) {
        const took = repairWith(game, place, model, s, "forced", what, say);
        if (took !== null) {
          delete s.forced;
          delete s.fixAt;
          say(`[SYSTEMS] ${personName(place, staffOf(game, place, model.engineers)[0] ?? "Someone")} has fixed ${what}${took ? `, with ${took}` : ""}.`);
        }
      }
      if (s.backAt && s.backAt <= t) {
        delete s.locked;
        delete s.backAt;
        say(`[DOOR] Someone at ${model.name} has unlocked the door to ${roomNameOf(place, room)} again.`);
      }
    }
    if (state.alarm.backAt && state.alarm.backAt <= t) {
      delete state.alarm.disarmed;
      delete state.alarm.backAt;
      say(`[ALARM] Someone at ${model.name} has armed the alarm again.`);
    }
    // The alarm stops by itself after a while, or as soon as nothing can ring it.
    const ringing = state.alarm.ringing;
    if (ringing && (!alarmCanRing(game, place) || t - ringing.since >= model.numbers.alarm / 60)) say(...silenceAlarm(game, place, { quiet: !here }));
    // The air moves on to now. Where a work board runs the place, the board's own clock moves the air through anything
    // longer than a few minutes, a piece at a time (src/work.js), so that over a long wait the air follows the generator
    // and the repairs as they went, and not as they stood when the wait began.
    const lag = (t - (game.systems?.[place]?.at ?? t)) * 60;
    if (game.systems?.[place] && !(boardRuns(place) && lag > FINE_AIR)) lines.push(...airMoves(game, place, t));
    tidy(game, place);
  }
  return lines;
}

// ---- The air moving ----------------------------------------------------------------------------------

// The longest stretch, in minutes, the air is moved through in one go at a place with a work board.
const FINE_AIR = 5;
const NO_LINES = Object.freeze([]);

// Whether anything at a place could have its air doing anything but sitting good: a room whose air isn't whole, someone
// who's gone short of it, no power for the air, a feed cut, or a part of the power or the air switched off or broken.
// Asked for every few minutes of a long wait, so it looks at nothing it doesn't have to.
function airTroubled(game, place, model, state) {
  if (state.short || state.cut || state.nowhere || state.toll || state.reserve) return true;
  for (const room in state.air) return true;
  for (const id in state.parts) {
    const system = model.parts[id]?.system;
    if (system === "air" || system === "power") return true;
  }
  return starved(game, place, "air");
}

// A place's air moves on to a time, from wherever it had got to, and whoever breathes it feels it (src/no-air.js,
// through src/room-hooks.js). Called as the clock moves (advanceSystems), and by a place's work board for every piece
// of its own clock, with fine, so that a long wait is gone through a few minutes at a time; since is when that piece
// began, for a place nothing was wrong with until its power went. It returns lines for the story.
export function airMoves(game, place, until = hoursNow(game), { since = null, fine = false } = {}) {
  const model = systemsOf(place);
  if (!model || !hasSystem(model, "air")) return NO_LINES;
  let state = game.systems?.[place] ?? null;
  if (!state) {
    // Nothing's switched, cut or broken here, so the air's moving everywhere unless there's no power for it.
    if (!starved(game, place, "air")) return NO_LINES;
    state = stateOf(game, place, true);
    state.at = Math.min(since ?? until, until);
  }
  const minutes = (until - (state.at ?? until)) * 60;
  if (!(minutes > 1e-9)) return NO_LINES;
  state.at = until;
  if (!airTroubled(game, place, model, state)) return NO_LINES;
  const here = place === game.location;
  const lines = [];
  const kept = flowsNow(game, place, model, state);
  lines.push(...drawReserve(game, place, model, state, minutes, kept.stopped));
  const bad = new Map();
  const settled = driftAir(game, model, state, minutes, kept, bad);
  if (here) lines.push(...airOnPlayer(game, model, state, minutes, fine));
  // Nobody sits and smothers beside a switch: at a place that isn't the player's own to run, its people put back
  // whatever's been switched off that the air needs, soon after the air's gone bad anywhere.
  if (bad.size && !ownedBy(game, place)) {
    const soon = until + (D().numbers?.["switched back for air"] ?? 1);
    for (const id in state.parts) {
      const s = state.parts[id];
      if (s.backAt > soon && ["air", "power"].includes(model.parts[id]?.system)) s.backAt = soon;
    }
    if (state.cut) for (const room in state.cut) if (state.cut[room].backAt > soon) state.cut[room].backAt = soon;
  }
  // The rooms whose air was bad with nowhere better to get to from them: worked out once while nothing changes.
  let trapped = settled ? kept.steady.trapped : null;
  if (!trapped) {
    const way = wayToGoodAir(game, place);
    trapped = [...bad.keys()].filter((room) => !way(room));
    if (settled) kept.steady.trapped = trapped;
  }
  lines.push(...airExtras(game, place, { minutes, until, bad, trapped }));
  // Once every room's air has settled with some of it gone there's nothing to tidy away, and a long wait asks often.
  if (!settled || !bad.size) tidy(game, place);
  return lines;
}

// A place's reserve air is breathed while its air plant is stopped, and fills again once the plant runs. It says so
// to the player when it starts, when a day of it is left and when it's gone, where they'd hear of it.
function drawReserve(game, place, model, state, minutes, stopped) {
  const all = reserveAll(place);
  if (!all) return NO_LINES;
  const used = state.reserve ?? 0;
  const hears = place === game.location || ownedBy(game, place);
  const where = place === "meridian" ? "The ship" : model.name;
  if (!stopped) {
    if (!used) return NO_LINES;
    const left = Math.max(0, used - minutes * (all / (model.numbers.reserveFill * 60)));
    if (left > 0) state.reserve = left;
    else delete state.reserve;
    return left <= 0 && hears ? [`[AIR] ${where}'s reserve air is full again.`] : NO_LINES;
  }
  if (used >= all) return NO_LINES;
  const now = Math.min(all, used + minutes);
  state.reserve = now;
  if (!hears) return NO_LINES;
  if (!used) return [`[AIR] The air plant has stopped. ${where} is breathing reserve air now: there's ${reserveWords(all)} of it, and after that nobody lasts more than a few hours.`];
  if (now >= all) return [`[AIR] The reserve air has run out. With the air plant still stopped, the air's going everywhere.`];
  if (used < all - 1440 && now >= all - 1440) return [`[AIR] A day of reserve air is left, and the air plant's still stopped.`];
  return NO_LINES;
}

// What the air took from the player through a long wait, gone through a few minutes at a time, is said in a line each
// once the wait's over, and forgotten.
addClockWork((game) => {
  const state = game.systems?.[game.location];
  if (!state?.owed) return [];
  const lines = owedLines(game, state);
  tidy(game, game.location);
  return lines;
});
function owedLines(game, state) {
  const owed = state.owed;
  delete state.owed;
  const lines = [];
  if (owed?.stress) lines.push(`[STRESS] +${owed.stress}: The thin air in ${owed.room}.`);
  if (owed?.health) lines.push(`[HEALTH] -${owed.health}: The bad air in ${owed.room}.${game.hp === 1 ? " You're close to passing out." : ""}`);
  return lines;
}

// Whether each room's vents are moving its air, by room: the same until the power, a part or a feed changes, so it's
// kept until one does (a long wait asks every few minutes). What's kept with it, steady, is the rooms' air once it has
// settled, which is forgotten with it.
const flowsKept = new WeakMap();
function flowsNow(game, place, model, state) {
  // Everything the vents hang on: what the generator gives, whether the ship's under way (her engines draw then, and
  // something else may be let go), each part that's off or broken, and each feed that's cut.
  let sig = `${powerSupply(game, place)}|${place === "meridian" && game.ship?.underWay ? 1 : 0}|`;
  for (const id in state.parts) {
    const s = state.parts[id];
    sig += `${id}${s.on === false ? "-" : "+"}${s.damage ? "x" : ""},`;
  }
  if (state.cut) for (const room in state.cut) sig += `/${room}`;
  if (reserveLeft(game, place) > 0) sig += "|reserve";
  let mine = flowsKept.get(game);
  if (!mine) flowsKept.set(game, (mine = new Map()));
  const kept = mine.get(place);
  if (kept && kept.sig === sig && kept.model === model) return kept;
  const made = { sig, model, flows: new Map(roomsOf(mapFor(place)).map((room) => [room.id, airFlows(game, place, room.id)])), stopped: plantStopped(game, place, model), steady: null };
  mine.set(place, made);
  return made;
}

// Each room's air moves toward good while it's flowing and toward bad while it isn't. bad is filled with how many of
// these minutes each room's air was under the line where it's bad, for whoever was breathing it. It says whether
// every room's air has settled, at good or at none, with nothing to change it but what the vents hang on: then it's
// the same next time, and nothing's worked out again until something does change.
function driftAir(game, model, state, minutes, kept, bad) {
  const place = model.place;
  // The rooms' air as a count and a sum: enough to tell whether any of it has moved since it settled.
  let n = 0;
  let sum = 0;
  for (const room in state.air) {
    n += 1;
    sum += state.air[room];
  }
  if (kept.steady && kept.steady.n === n && kept.steady.sum === sum) {
    for (const room of kept.steady.bad) bad.set(room, minutes);
    return true;
  }
  const limits = airLimits();
  const down = 100 / model.numbers.air;
  const up = 100 / model.numbers.airBack;
  let settled = true;
  for (const level of roomsOf(mapFor(place))) {
    const q = state.air[level.id] ?? 100;
    // A fire or a hole in the hull spoils a room's air whatever its vents are doing (src/room-hooks.js).
    const moving = kept.flows.get(level.id);
    const flowing = moving && !airSpoiled(game, place, level.id);
    if (flowing !== moving) settled = false;
    if (flowing && q >= 100) continue;
    const next = flowing ? Math.min(100, q + up * minutes) : Math.max(0, q - down * minutes);
    const under = flowing ? (q < limits.bad ? Math.min(minutes, (limits.bad - q) / up) : 0) : q < limits.bad ? minutes : Math.max(0, minutes - (q - limits.bad) / down);
    if (under > 0) bad.set(level.id, under);
    if (next !== q) settled = false;
    if (next >= 100) delete state.air[level.id];
    else state.air[level.id] = Math.round(next * 10) / 10;
  }
  kept.steady = settled ? { n, sum, bad: [...bad.keys()], trapped: null } : null;
  return settled;
}

// What the air where the player's standing does to them, over so many minutes. With quiet, what it takes from them is
// kept to be said later in one line, and not every ten minutes: a long wait is gone through a few minutes at a time.
function airOnPlayer(game, model, state, minutes, quiet = false) {
  const lines = [];
  const place = model.place;
  const limits = airLimits();
  const spot = playerSpot(game);
  if (!spot) return lines;
  const q = state.air[spot.room] ?? 100;
  const name = roomNameOf(place, spot.room);
  const thinKey = `thin:${spot.room}`;
  const badKey = `bad:${spot.room}`;
  if (q < limits.bad && !state.noted[badKey]) {
    state.noted[badKey] = true;
    state.noted[thinKey] = true;
    lines.push(`[AIR] The air in ${name} is bad. Get out, or get it moving again.`);
  } else if (q < limits.thin && !state.noted[thinKey]) {
    state.noted[thinKey] = true;
    lines.push(`[AIR] The air in ${name} is getting thin.`);
  } else if (q >= limits.thin && state.noted[thinKey]) {
    delete state.noted[thinKey];
    delete state.noted[badKey];
    lines.push(`[AIR] The air in ${name} is good again.`);
  }
  if (q >= limits.thin) {
    state.harm = 0;
    return lines;
  }
  state.harm = (state.harm ?? 0) + minutes;
  const ticks = Math.floor(state.harm / 10);
  state.harm -= ticks * 10;
  if (!ticks) return lines;
  const stress = limits.stress * ticks;
  const was = game.hp;
  lines.push(...changeStress(game, stress));
  if (q < limits.bad) game.hp = Math.max(1, game.hp - limits.health * ticks);
  if (quiet) {
    // Through a long wait it adds up, to be said in a line when the wait's over.
    state.owed = { room: name, stress: (state.owed?.stress ?? 0) + stress, health: (state.owed?.health ?? 0) + (was - game.hp) };
    return lines;
  }
  lines.push(`[STRESS] +${stress}: The thin air in ${name}.`);
  if (game.hp < was) lines.push(`[HEALTH] -${was - game.hp}: The bad air in ${name}.${game.hp === 1 ? " You're close to passing out." : ""}`);
  return lines;
}

// Who a place's systems have called to their duty right now: the guards while its alarm rings and can be heard, and
// an engineer for each repair in its last hour. Null when nobody is.
function calledNow(game, place, model, state, t) {
  const ringing = state.alarm?.ringing?.room && commsUp(game, place) ? state.alarm.ringing.room : null;
  const fixing = {};
  if (boardRuns(place)) {
    // Whoever the place's work board has put on each repair (src/work.js).
    for (const hand of repairHands(game, place)) {
      const found = repairOf(place, model, state, hand.ref);
      if (found?.st.fixAt && !fixing[hand.key]) fixing[hand.key] = { part: found.part ?? { room: found.room, name: found.name }, s: found.st };
    }
    if (!ringing && !Object.keys(fixing).length) return null;
  } else {
    const due = Object.entries(state.parts).filter(([id, s]) => s.fixAt && s.fixAt - t <= 1 && model.parts[id]).sort((a, b) => a[1].fixAt - b[1].fixAt);
    if (!ringing && !due.length) return null;
    const engineers = staffOf(game, place, model.engineers);
    due.forEach(([id, s], i) => {
      const key = engineers[i % Math.max(1, engineers.length)];
      if (key && !fixing[key]) fixing[key] = { part: model.parts[id], s };
    });
  }
  return { ringing, guards: ringing ? staffOf(game, place, model.guards) : [], fixing };
}
// Where their duty has one of them, or null for anyone it hasn't called.
function dutyTurn(game, place, called, key, t) {
  if (!called) return null;
  if (called.ringing && called.guards.includes(key)) return { where: `@${called.ringing}`, doing: `answering the alarm in ${lowerFirst(roomNameOf(place, called.ringing))}` };
  if (!called.fixing[key]) return null;
  const { part, s } = called.fixing[key];
  // A repair that takes parts spends the first half of its hour fetching them from the stores.
  const store = s.fixAt - t > 0.5 ? repairStore(game, place, s.damage) : null;
  if (store) return { where: `store:${store.id}`, doing: `fetching ${repairPartsWords(place, s.damage)} from the ${store.name} for the ${part.name}` };
  return { where: `@${part.room}`, doing: `fixing the ${part.name}` };
}
// The same for the ship's work board (src/work.js), which gives nobody a job while their duty has them: the guards
// at an alarm and the engineers at a repair, and not whoever's getting out of bad air. Null when nobody's called.
// The guards answering an alarm, as work the place's board can see (src/work.js): each { kind, by, doing, room },
// fixed, since nothing takes a guard off an alarm, with a drop that does nothing.
const NO_GUARDS = Object.freeze([]);
export function alarmWork(game, place) {
  const state = game.systems?.[place];
  if (!state?.alarm?.ringing?.room) return NO_GUARDS;
  const model = systemsOf(place);
  if (!model || !commsUp(game, place)) return NO_GUARDS;
  const room = state.alarm.ringing.room;
  const doing = `answering the alarm in ${lowerFirst(roomNameOf(place, room))}`;
  return staffOf(game, place, model.guards).map((key) => ({ kind: "alarm", by: key, doing, room, name: roomNameOf(place, room), seen: Boolean(state.alarm.ringing.seen), fixed: true, drop: () => {} }));
}
// The guards answering an alarm, and nobody else: null while nothing rings.
export function alarmDetour(game, place) {
  const model = systemsOf(place);
  const state = game.systems?.[place];
  const ringing = model && state?.alarm?.ringing?.room && commsUp(game, place) ? state.alarm.ringing.room : null;
  if (!ringing) return null;
  const guards = staffOf(game, place, model.guards);
  return (key) => (guards.includes(key) ? { where: `@${ringing}`, doing: `answering the alarm in ${lowerFirst(roomNameOf(place, ringing))}` } : null);
}
export function dutyDetour(game, place) {
  const model = systemsOf(place);
  const state = game.systems?.[place];
  if (!model || !state) return null;
  const t = hoursNow(game);
  const called = calledNow(game, place, model, state, t);
  return called ? (key) => dutyTurn(game, place, called, key, t) : null;
}

// The nearest room with good air to get to from a room, by the ways between the rooms: null when there's none.
function nearestGoodAir(map, state, limits, room) {
  const seen = new Set([room]);
  const queue = [room];
  while (queue.length) {
    const id = queue.shift();
    if ((state.air[id] ?? 100) >= limits.thin && id !== room) return id;
    for (const next of neighboursOf(map, id)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return null;
}
// Which rooms of a place can be walked between, as groups: each room's id with the number of its group. A place's
// rooms never change while it's built, so this is worked out once for each map.
const groupsKept = new WeakMap();
function roomGroups(map) {
  if (!groupsKept.has(map)) {
    const group = new Map();
    let n = 0;
    for (const room of roomsOf(map)) {
      if (group.has(room.id)) continue;
      n += 1;
      const queue = [room.id];
      group.set(room.id, n);
      while (queue.length) {
        for (const next of neighboursOf(map, queue.shift())) {
          if (group.has(next)) continue;
          group.set(next, n);
          queue.push(next);
        }
      }
    }
    groupsKept.set(map, group);
  }
  return groupsKept.get(map);
}
// Whether there's anywhere with good air to get to from a room of a place, for whoever's in it (src/no-air.js): some
// other room it can be walked to from there whose air is good. Asked about one room after another at one moment.
export function wayToGoodAir(game, place) {
  const state = game.systems?.[place];
  const map = mapFor(place);
  if (!state || !map) return () => true;
  const limits = airLimits();
  const groups = roomGroups(map);
  const good = new Set();
  for (const [room, n] of groups) if ((state.air[room] ?? 100) >= limits.thin) good.add(n);
  return (room) => good.has(groups.get(room));
}
// Whether a room's air is bad: under the line where it hurts.
export const airBadIn = (game, place, room) => airIn(game, place, room) < airLimits().bad;
// Whether a place has no room left with good air in it, said once to the player when it comes to that (src/no-air.js).
export function nowhereToBreathe(game, place, yes) {
  const state = game.systems?.[place];
  if (!state) return false;
  const was = Boolean(state.nowhere);
  if (yes) state.nowhere = true;
  else delete state.nowhere;
  return yes && !was;
}

// Where someone goes instead of where their day sends them: the guards to the alarm, an engineer to what's due to be
// fixed, and anyone headed for a room with bad air to the nearest room with good air. Asleep, people only notice
// once it's bad. src/life.js asks this for each person, with the room their day has them going to.
export function detourFor(game, place) {
  const model = systemsOf(place);
  const state = game.systems?.[place];
  if (!model || !state) return null;
  const t = hoursNow(game);
  const limits = airLimits();
  const called = calledNow(game, place, model, state, t);
  const map = mapFor(place);
  const goodAirFrom = (room) => nearestGoodAir(map, state, limits, room);
  return (key, room, asleep) => {
    const duty = dutyTurn(game, place, called, key, t);
    if (duty) return duty;
    const q = room ? state.air[room] ?? 100 : 100;
    if (q >= limits.thin || (asleep && q >= limits.bad)) return null;
    const away = goodAirFrom(room);
    return away ? { where: `@${away}`, doing: `getting out of the bad air in ${lowerFirst(roomNameOf(place, room))}` } : null;
  };
}

// ---- What it does to checks and to a jump -------------------------------------------------------------

// A dark room helps a sneak and hurts a lookout, and a camera on the player makes sneaking harder.
export function roomEdge(game, skill) {
  const spot = playerSpot(game);
  if (!spot || !skill) return [];
  const parts = [];
  const dark = D().dark ?? {};
  const seen = D().watched ?? {};
  if (dark[skill] && roomDark(game, spot.place, spot.room)) parts.push({ label: "in the dark", value: dark[skill] });
  if (seen[skill] && watched(game, spot.place, spot.room)) parts.push({ label: "a camera on you", value: seen[skill] });
  return parts;
}

// The Meridian can't jump with her engines down, and she can't leave a station that has its clamps locked.
export function jumpBlocked(game, { whoever = false } = {}) {
  // For anyone who isn't the captain a journey is a passage on someone else's ship, unless it's the Meridian herself
  // they've ordered to jump, from her chart (whoever).
  if (!whoever && !isCaptain(game)) return null;
  const ship = systemsOf("meridian");
  const engines = partsOf(ship, "engines");
  if (engines.length && !engines.every((part) => partWorks(game, "meridian", part))) return "The Meridian's engines are down, so she can't jump until they're running again.";
  const at = game.ship?.at;
  const dock = at ? systemsOf(at) : null;
  if (partsOf(dock, "docking").some((part) => !partWorks(game, at, part))) return `The docking clamps at ${dock.name} are locked, so the Meridian can't leave until they're released.`;
  return null;
}

// With the Meridian's navigation down, every jump is plotted by hand: slower, and a fuel more.
export function navigationDown(game) {
  const nav = partsOf(systemsOf("meridian"), "navigation");
  return nav.length > 0 && !nav.every((part) => partWorks(game, "meridian", part));
}

export function airBadHere(game) {
  const spot = playerSpot(game);
  return Boolean(spot) && airIn(game, spot.place, spot.room) < airLimits().bad;
}

// What people say about it, for anyone without a conversation of their own.
export function systemsTalk(game) {
  const place = game.location;
  const ringing = alarmRinging(game, place);
  if (ringing) return `The alarm's going${ringing.room ? ` in ${roomNameOf(place, ringing.room)}` : ""}.${ringing.seen ? " Somebody got caught on camera, they're saying." : " Nobody's saying why."}`;
  const spot = playerSpot(game);
  if (spot && roomDark(game, place, spot.room)) return "Who put the lights out?";
  if (spot && airIn(game, place, spot.room) < airLimits().thin) return "Can you feel that? The air's going.";
  return null;
}

// ---- Working a part by hand ---------------------------------------------------------------------------

function detailOf(action) {
  if (!action.check) return "free";
  const [skill, difficulty] = action.check.split(":");
  return `${SKILLS[skill]?.name ?? skill} check, ${String(difficulty).replace("_", " ")}`;
}

export function partActions(game, place, part) {
  if (part.kind === "console") return [{ id: "use", label: "Use it" }];
  const spec = kindSpec(part.kind);
  const s = partState(game, place, part.id);
  const out = [];
  if (s.damage) {
    if (spec.fix) out.push({ id: "fix", label: spec.fix.label, check: spec.fix.check ?? null });
    return out;
  }
  if (spec.switch) out.push(s.on === false ? { id: "on", label: spec.switch.on } : { id: "off", label: spec.switch.off, tampering: Boolean(spec.switch.tampering) });
  if (spec.break) out.push({ id: "break", label: spec.break.label, check: spec.break.check ?? null, tampering: true, unseen: Boolean(spec.break.unseen) });
  return out;
}

// An alarm's part that works says it's ringing while the alarm rings, instead of saying it's quiet.
const ringingNow = (game, place, part) => part.system === "alarm" && Boolean(alarmRinging(game, place));

// What any part looks like when it was shot up in a battle (src/aftermath.js), rather than tampered with.
const SHOT_UP = "It was shot up in the fighting, and it's dead.";
// And when it was taken apart for a rig's parts (src/ship-parts.js).
const STRIPPED = "It's been taken apart for parts, and it's dead.";

export function lookAt(game, place, part) {
  const spec = kindSpec(part.kind);
  const s = partState(game, place, part.id);
  const works = partWorks(game, place, part);
  const state = s.damage ? (s.by === "wear" && spec.worn) || (s.by === "battle" && SHOT_UP) || (s.by === "stripped" && STRIPPED) || spec.damaged || "It's broken." : s.on === false ? spec.off ?? "It's off." : !works ? deadWords(game, place, part) : ringingNow(game, place, part) ? "It's ringing." : spec.on ?? "It's working.";
  const reserve = part.kind === "air plant" && reserveAll(place) > 0 ? ` The reserve air stands at ${reserveLeft(game, place) > 0 ? reserveWords(reserveLeft(game, place)) : "nothing"}${reserveLeft(game, place) >= reserveAll(place) ? ", which is all of it" : ""}.` : "";
  return `${part.look ?? spec.look ?? `The ${part.name}.`} ${state}${s.damage ? repairWords(game, place, s) : ""}${reserve}`;
}

// What a broken part's repair is waiting on, where it takes parts: " Chief Marrow will fix it with a parts crate from
// the stores.", or " Chief Marrow can't fix it until there's a parts crate in the stores."
function repairWords(game, place, s) {
  const parts = repairPartsWords(place, s.damage);
  const model = systemsOf(place);
  const engineers = model ? staffOf(game, place, model.engineers) : [];
  if (!parts || !engineers.length) return "";
  const who = personName(place, engineers[0]);
  if (s.noParts) return ` ${who} can't fix it until there's ${parts} in the stores.`;
  return s.fixAt ? ` ${who} will fix it with ${parts} from the stores.` : "";
}

// What the engineers can't fix for want of parts, in words: "the junction box in Engineering", "the door to Medbay".
export function waitingForParts(game, place) {
  const model = systemsOf(place);
  const state = game.systems?.[place];
  if (!model || !state) return [];
  return [
    ...Object.entries(state.parts).filter(([id, s]) => s.noParts && model.parts[id]).map(([id]) => `the ${model.parts[id].name} in ${roomNameOf(place, model.parts[id].room)}`),
    ...Object.entries(state.doors).filter(([, s]) => s.noParts).map(([room]) => `the door to ${roomNameOf(place, room)}`),
  ];
}

// Why a part that's on and whole does nothing: the generator's stopped, its system was let go, or its room's cut off.
function deadWords(game, place, part) {
  const b = powerBalance(game, place);
  if (b && b.supply <= 0) return "It's dead: the generator's stopped, and nothing aboard has power.";
  if (b && b.dropped.includes(part.system)) return "It's dead: there isn't the power for everything just now, and this was let go first.";
  return "It's dead. There's no power in here.";
}

function stateWord(game, place, part) {
  const s = partState(game, place, part.id);
  if (s.damage) return s.damage;
  if (s.on === false) return wordFor(part.kind, "off");
  if (!partWorks(game, place, part)) return "no power";
  if (ringingNow(game, place, part)) return "ringing";
  return wordFor(part.kind, "on");
}

// What a tampering hand does where a camera can see it: the alarm, and whoever holds the place hears about it.
function caught(game, place, room) {
  return soundAlarm(game, place, room, { seen: true });
}

function doWork(game, place, part, action, success) {
  const spec = kindSpec(part.kind);
  // On the captain's own ship, nothing the captain does is tampering.
  const seen = Boolean(action.tampering) && !ownedBy(game, place) && watched(game, place, part.room) && !(action.unseen && success);
  const lines = [];
  if (success) {
    if (action.id === "off") {
      lines.push(`[SYSTEMS] You ${lowerFirst(spec.switch.off)}. ${spec.off ?? ""}`.trim(), ...switchPart(game, place, part.id, false, { by: "player" }));
    } else if (action.id === "on") {
      lines.push(`[SYSTEMS] You ${lowerFirst(spec.switch.on)}. ${spec.on ?? ""}`.trim(), ...switchPart(game, place, part.id, true, { by: "player" }));
    } else if (action.id === "break") {
      lines.push(`[SYSTEMS] ${spec.break.done ?? "Done."}`, ...damagePart(game, place, part.id, spec.break.damage ?? "broken", { by: "player" }));
    } else if (action.id === "fix") {
      lines.push(`[SYSTEMS] ${spec.fix.done ?? "It's working again."}`, ...repairPart(game, place, part.id));
      // Fixed by the player's own hands, for anything someone's asked them to fix (src/requests.js).
      notePut(game, `fixed:${place}`, part.id, 1);
    }
  } else lines.push(`[SYSTEMS] ${(action.id === "fix" ? spec.fix?.failed : spec.break?.failed) ?? "Nothing gives."}`);
  if (seen) lines.push(...caught(game, place, part.room));
  return lines;
}

// Everything a locked door offers: forcing it, or getting into its panel.
export function doorActions(game, place, levelId, exit) {
  if (!exitLocked(game, place, levelId, exit)) return [];
  const doors = D().doors ?? {};
  const room = doorLocked(game, place, exit.to) ? exit.to : levelId;
  const out = [{ id: "force", label: doors.force?.label ?? "Force the door", check: doors.force?.check ?? "athletics:moderate", tampering: true }];
  // A sealed panel takes nothing at its own keypad (step 9): only the machine it trusts works it.
  if (roomPowered(game, place, room) && !panelSealed(game, place, room)) out.push({ id: "hack", label: doors.hack?.label ?? "Hack the door panel", check: `hacking:${doors.hack?.class ?? "easy"}`, tampering: true });
  return out.map((one) => ({ ...one, room, detail: detailOf(one) }));
}

// The locked door can be the one into the next room or the one into this room, and either way the player sees the way
// out, so it's named by where it goes. A door between two rooms drawn on a deck is already named that way, from the
// side the player stands on.
export function doorLook(game, place, levelId, exit) {
  const doors = D().doors ?? {};
  const room = doorLocked(game, place, exit.to) ? exit.to : levelId;
  const door = systemsOf(place)?.doors[room];
  const goesTo = exit.inner && exit.label ? exit.label : roomNameOf(place, exit.to);
  const sealed = panelWords(game, place, room);
  return `${door?.look ?? String(doors.look ?? "The door to {room}.").replaceAll("{room}", goesTo)} ${doors.locked ?? "It's locked."}${sealed ? ` ${sealed}` : ""}`;
}

// The player works a part in the room they're in. Something free happens at once; anything else opens a check, and
// settlePart finishes it when the check is over.
export function workOnPart(game, key, how) {
  const spot = playerSpot(game);
  if (!spot) throw new Error("There's nothing like that here.");
  const { place } = spot;
  const model = systemsOf(place);
  const part = model.parts[String(key).replace(/^part:/, "")];
  if (!part || !partInReach(game, place, part)) throw new Error("That isn't here.");
  const action = partActions(game, place, part).find((one) => one.id === how);
  if (!action) throw new Error("That can't be done to it now.");
  if (action.check) {
    const [skill, difficulty] = action.check.split(":");
    startCheck(game, { skill, difficulty, reason: `${action.label}: the ${part.name} in ${roomNameOf(place, part.room)}`, scene: lookAt(game, place, part), source: "part", target: `thing:part:${part.id}` });
    game.partAsked = { place, part: part.id, how };
    return { check: true };
  }
  const said = doWork(game, place, part, action, true);
  return { said: said.join("\n") };
}

export function workOnDoor(game, levelId, exit, how) {
  const spot = playerSpot(game);
  if (!spot) throw new Error("There's nothing like that here.");
  const action = doorActions(game, spot.place, levelId, exit).find((one) => one.id === how);
  if (!action) throw new Error("That door isn't locked.");
  const [skill, difficulty] = action.check.split(":");
  // Getting into the door's panel has no check window: the panel opens at its logon, which src/walk.js opens from
  // what this returns. A camera that sees the player at it raises the alarm all the same.
  if (skill === "hacking") {
    const seen = !ownedBy(game, spot.place) && watched(game, spot.place, spot.room) ? caught(game, spot.place, spot.room) : [];
    if (seen.length) game.transcript?.push({ role: "notice", text: seen.join("\n") });
    return { panel: { place: spot.place, door: action.room, classKey: difficulty, at: `exit:${exit.key}` }, said: seen.join("\n") || null };
  }
  startCheck(game, { skill, difficulty, reason: `${action.label}: the door to ${roomNameOf(spot.place, action.room)}`, scene: doorLook(game, spot.place, levelId, exit), source: "part", target: `exit:${exit.key}` });
  game.partAsked = { place: spot.place, door: action.room, how, from: spot.room };
  return { check: true };
}

// A check on a part or a door is over. Returns the lines it left in the story, or null if it wasn't one.
export function settlePart(game, outcome) {
  const asked = game.partAsked;
  if (!asked) return null;
  game.partAsked = null;
  if (!outcome || outcome.training) return null;
  const model = systemsOf(asked.place);
  if (!model) return null;
  let lines = [];
  if (asked.door) {
    const doors = D().doors ?? {};
    const seen = !ownedBy(game, asked.place) && watched(game, asked.place, asked.from ?? asked.door);
    if (asked.how === "force") {
      if (outcome.success) lines.push(`[SYSTEMS] ${doors.force?.done ?? "The door gives."}`, ...setDoor(game, asked.place, asked.door, "forced", { by: "player" }).filter((line) => !/^\[DOOR\] The door to .* is (un)?locked\.$/.test(line)));
      else lines.push(`[SYSTEMS] ${doors.force?.failed ?? "The door doesn't give."}`);
    }
    if (seen) lines.push(...caught(game, asked.place, asked.from ?? asked.door));
  } else {
    const part = model.parts[asked.part];
    if (!part) return null;
    const spec = kindSpec(part.kind);
    const action = asked.how === "break" ? { id: "break", tampering: true, unseen: Boolean(spec.break?.unseen) } : { id: asked.how };
    lines = doWork(game, asked.place, part, action, outcome.success);
  }
  if (lines.length) game.transcript?.push({ role: "notice", text: lines.join("\n") });
  return lines;
}

// ---- What the page gets to see --------------------------------------------------------------------------

// The parts in the room the player's in, as things they can walk up to and work.
// Damage that leaves a part's insides open and live, so the room's picture shows it sparking: cut cables, something
// broken (by a hand, a fire, a fight or wear), a pulled injector. A sealed vent or a covered lens doesn't spark.
const SPARKING = new Set(["cut", "broken", "crippled"]);

export function partThings(game, place, room) {
  const model = systemsOf(place);
  if (!model) return [];
  return (model.partsIn[room] ?? []).map((id) => model.parts[id]).filter((part) => part && !part.unplaced).map((part) => {
    const works = partWorks(game, place, part);
    const damage = partState(game, place, part.id).damage;
    return {
      id: `part:${part.id}`,
      name: upperFirst(part.kind === "console" ? part.name : `the ${part.name}`),
      look: lookAt(game, place, part),
      x: part.x,
      y: part.y,
      have: false,
      written: true,
      part: {
        kind: part.kind,
        system: part.system,
        mount: part.mount,
        face: part.face,
        works,
        word: stateWord(game, place, part),
        ...(part.system === "alarm" && alarmRinging(game, place) && works ? { ringing: true } : {}),
        // A door's keypad shows whether its door is locked.
        ...(part.kind === "door panel" ? { locked: doorLocked(game, place, part.door) } : {}),
        ...(SPARKING.has(damage) ? { sparks: true } : {}),
      },
      actions: partActions(game, place, part).map((action) => ({ id: action.id, label: action.label, detail: detailOf(action) })),
      // What else can be done to it, from the parts of the game that add to a room: taking it apart for a rig.
      ...partExtras(game, place, part),
    };
  });
}

// How the room the player's in is: dark, its air, a camera on them, the alarm.
export function roomView(game, place, room) {
  const model = systemsOf(place);
  if (!model) return null;
  const ringing = alarmRinging(game, place);
  const air = airIn(game, place, room);
  return {
    dark: roomDark(game, place, room),
    air: Math.round(air),
    thin: air < airLimits().thin,
    watched: watched(game, place, room),
    ...(ringing ? { alarm: { room: ringing.room ? roomNameOf(place, ringing.room) : null, here: ringing.room === room } } : {}),
  };
}

// ---- Computers that run systems ---------------------------------------------------------------------------

// What a computer runs, from the place's Computers lines: by its file's id, the thing it's on, the console the file
// put there, or a door's panel, which runs that door.
export function controlsFor(place, ref) {
  const model = systemsOf(place);
  if (!model) return [];
  if (ref.door) return model.doors[ref.door] ? [{ systems: ["doors"], rooms: [ref.door] }] : [];
  return model.computers.filter((c) => {
    const r = c.ref;
    if (ref.written && r.kind === "written" && r.id === ref.written) return true;
    if (ref.thing && r.kind === "thing" && r.thing === ref.thing) return true;
    if (ref.console && r.kind === "console" && r.part === ref.console) return true;
    return Boolean(ref.written && r.kind === "thing" && writtenAtThing(place, r.room, { name: r.name }) === ref.written);
  // Each keeps the computer it's for, so a sealed door's panel can say whether it trusts it (controlsView).
  }).map((c) => ({ systems: c.systems, rooms: c.rooms, ref }));
}

// Whether a thing in a room has been made a computer by the place's file, even if its map line says otherwise.
export const runsSystems = (place, thingId) => Boolean(systemsOf(place)?.computers.some((c) => c.ref.kind === "thing" && c.ref.thing === thingId));

const CONTROL_WORDS = {
  "junction box": ["Cut the power", "Restore the power"],
  "air plant": ["Shut it down", "Start it up"],
  vent: ["Close the vent", "Open the vent"],
  "light switch": ["Lights out", "Lights on"],
  camera: ["Switch it off", "Switch it on"],
  speaker: ["Switch it off", "Switch it on"],
  relay: ["Jam the comms", "Restore the comms"],
  engines: ["Shut down the engines", "Start the engines"],
  "nav core": ["Lock the navigation", "Unlock the navigation"],
  "docking clamps": ["Lock the clamps", "Release the clamps"],
  machine: ["Switch it off", "Switch it on"],
};

function peopleSeenIn(game, place, room) {
  return peopleIn(game, place, room).map((one) => one.label ?? WORLD_CHARACTERS[one.id]?.name ?? one.name).filter(Boolean);
}

function partRow(game, place, part) {
  const s = partState(game, place, part.id);
  const where = roomNameOf(place, part.room);
  const name = part.kind === "junction box" ? `Power to ${(part.feeds ?? [part.room]).map((room) => roomNameOf(place, room)).join(", ")}`
    : part.kind === "light switch" ? `Lights in ${where}`
      : part.kind === "vent" ? `Air in ${where}`
        : part.kind === "camera" ? `Camera in ${where}`
          : `${upperFirst(`the ${part.name}`)} in ${where}`;
  const words = CONTROL_WORDS[part.kind] ?? CONTROL_WORDS.machine;
  const reachable = NEEDS_NO_POWER.has(part.kind) || roomPowered(game, place, part.room);
  const actions = s.damage || !reachable ? [] : s.on === false ? [{ to: "on", label: words[1] }] : [{ to: "off", label: words[0] }];
  const row = { id: part.id, name, detail: part.kind === "junction box" ? `junction box in ${where}` : null, word: stateWord(game, place, part), works: partWorks(game, place, part), actions };
  if (part.kind === "vent") row.detail = `air ${Math.round(airIn(game, place, part.room))}%`;
  if (part.kind === "camera" && row.works) row.feed = peopleSeenIn(game, place, part.room);
  return row;
}

function doorRow(game, place, door) {
  const s = doorState(game, place, door.to);
  const name = `The door to ${roomNameOf(place, door.to)}`;
  const opened = game.opened?.[place]?.includes(door.to);
  const panel = roomPowered(game, place, door.to);
  const actions = [];
  if (!s.forced && panel) actions.push(s.locked ? { to: "unlocked", label: "Unlock it" } : { to: "locked", label: "Lock it" });
  if (door.story && !opened && panel) actions.push({ to: "opened", label: "Open it" });
  return { id: door.id, name, word: s.forced ? "forced" : s.locked ? "locked" : door.story && !opened ? "shut" : "open", works: !s.locked, actions };
}

function alarmRow(game, place, model, room) {
  const s = alarmState(game, place);
  const ringing = s.ringing;
  const can = alarmCanRing(game, place);
  const actions = [];
  if (ringing) actions.push({ to: "quiet", label: "Silence it" });
  else if (!s.disarmed && can) actions.push({ to: "ringing", label: "Sound it" });
  actions.push(s.disarmed ? { to: "armed", label: "Arm it" } : { to: "disarmed", label: "Disarm it" });
  const word = ringing ? "ringing" : s.disarmed ? "disarmed" : can ? "armed" : "dead";
  return { id: "alarm", name: `The alarm${ringing?.room ? `, ringing in ${roomNameOf(place, ringing.room)}` : ""}`, word, works: !s.disarmed && can, actions, room };
}

// The systems a computer runs, each a list of rows with the state and what can be done about it from here.
export function controlsView(game, place, controls, { room = null } = {}) {
  const model = systemsOf(place);
  if (!model || !controls?.length) return [];
  const out = [];
  for (const system of model.systems) {
    const scopes = controls.filter((c) => c.systems.includes(system.id));
    if (!scopes.length) continue;
    const inScope = (one) => scopes.some((c) => !c.rooms || c.rooms.includes(one));
    const rows = [];
    if (system.id === "doors") {
      // A door whose panel is sealed isn't any computer's to work but the ones it trusts, nor the Ship menu's (step 9).
      for (const door of Object.values(model.doors)) if (scopes.some((c) => (!c.rooms || c.rooms.includes(door.to)) && !doorBlocked(game, place, door.to, c.ref))) rows.push(doorRow(game, place, door));
    } else if (system.id === "alarm") {
      const rooms = scopes.some((c) => !c.rooms) ? null : scopes.flatMap((c) => c.rooms);
      rows.push(alarmRow(game, place, model, room && (!rooms || rooms.includes(room)) ? room : rooms?.[0] ?? room ?? partsOf(model, "alarm")[0]?.room ?? null));
    } else {
      for (const id of system.parts) {
        const part = model.parts[id];
        if (part && !part.unplaced && inScope(part.room)) rows.push(partRow(game, place, part));
      }
    }
    // The power system's screen says what the generator gives against what's drawn, and what's been let go.
    if (rows.length) out.push({ id: system.id, title: system.title, rows, ...(system.id === "power" && powerNote(game, place) ? { note: powerNote(game, place) } : {}) });
  }
  return out;
}

// Something done to a system from a computer, or from the Ship menu. It has to be one of the things the computer's
// screen offers right now.
export function controlSystem(game, place, controls, rowId, to, { by = "player", room = null } = {}) {
  const offered = controlsView(game, place, controls, { room }).flatMap((system) => system.rows).find((row) => row.id === rowId);
  const action = offered?.actions.find((one) => one.to === to);
  if (!action) throw new Error("That can't be done from here, not as things stand.");
  if (rowId === "alarm") {
    if (to === "quiet") return silenceAlarm(game, place);
    if (to === "ringing") return soundAlarm(game, place, offered.room, { by });
    return armAlarm(game, place, to === "armed", { by });
  }
  const model = systemsOf(place);
  const door = Object.values(model.doors).find((one) => one.id === rowId);
  if (door) return setDoor(game, place, door.to, to, { by });
  const part = model.parts[rowId];
  const lines = switchPart(game, place, part.id, to === "on", { by });
  return [`[SYSTEMS] ${action.label}: ${offered.name}.`, ...lines];
}

// Everything at a place, for the Ship menu: the captain runs the Meridian's systems from there.
export function shipSystemsView(game) {
  if (!isCaptain(game) || !systemsOf("meridian")) return null;
  return controlsView(game, "meridian", [{ systems: systemsOf("meridian").systems.map((one) => one.id), rooms: null }]);
}

// ---- The written story's words for it ---------------------------------------------------------------------

export function roomIn(game, place, room) {
  if (!room) return null;
  if (room === "here") return playerSpot(game)?.place === place ? playerSpot(game).room : undefined;
  const map = mapFor(place);
  return map ? roomFinder(map)(room)?.id : undefined;
}

// Whether "power off in The Docks", "alarm ringing at haven" and the rest hold now.
export function systemHolds(game, term) {
  const place = term.place ?? game.location;
  const model = systemsOf(place);
  const room = roomIn(game, place, term.room);
  if (term.room && !room) return false;
  const rooms = room ? [room] : roomsOf(mapFor(place)).map((one) => one.id);
  const limits = airLimits();
  const off = ["off", "jammed", "locked", "broken", "bad", "thin", "ringing", "dark"].includes(term.state);
  if (!model) return !off;
  switch (term.system) {
    case "power": return term.state === "off" ? rooms.some((one) => !roomPowered(game, place, one)) : rooms.every((one) => roomPowered(game, place, one));
    case "lights": return term.state === "off" || term.state === "dark" ? rooms.some((one) => roomDark(game, place, one)) : rooms.every((one) => !roomDark(game, place, one));
    case "air":
      if (term.state === "bad") return rooms.some((one) => airIn(game, place, one) < limits.bad);
      if (term.state === "thin") return rooms.some((one) => airIn(game, place, one) < limits.thin);
      if (term.state === "good") return rooms.every((one) => airIn(game, place, one) >= limits.thin);
      if (term.state === "off") return rooms.some((one) => !airFlows(game, place, one));
      return rooms.every((one) => airFlows(game, place, one));
    case "cameras": return term.state === "on" ? rooms.some((one) => watched(game, place, one)) : !rooms.some((one) => watched(game, place, one));
    case "alarm":
      if (term.state === "ringing") return Boolean(alarmRinging(game, place));
      if (term.state === "quiet") return !alarmRinging(game, place);
      if (term.state === "off") return hasSystem(model, "alarm") && Boolean(alarmState(game, place).disarmed);
      return hasSystem(model, "alarm") && !alarmState(game, place).disarmed;
    case "door": return term.state === "locked" ? Boolean(room) && doorLocked(game, place, room) : Boolean(room) && !doorLocked(game, place, room);
    case "comms": return term.state === "on" ? commsUp(game, place) : !commsUp(game, place);
    default: {
      const parts = partsOf(model, term.system, room);
      return off ? parts.some((part) => !partWorks(game, place, part)) : parts.length > 0 && parts.every((part) => partWorks(game, place, part));
    }
  }
}

// "* power off in The Docks", "* alarm ringing", "* door locked The Hook", "* fix everything" and the rest.
export function applySystemsEffect(game, effect, { by = "story" } = {}) {
  const place = effect.place ?? game.location;
  const model = systemsOf(place);
  if (!model) return [`[SYSTEMS] ${LOCATIONS[place]?.name ?? place} has no systems for that.`];
  const room = roomIn(game, place, effect.room);
  if (effect.room && !room) return [`[SYSTEMS] ${model.name} has no room called ${effect.room}.`];
  const lines = [];
  const on = ["on", "released", "open", "unlocked", "good"].includes(effect.state);
  const switchAll = (parts) => {
    for (const part of parts) lines.push(...switchPart(game, place, part.id, on, { by }));
  };
  switch (effect.system) {
    case "power": switchAll(room ? [model.parts[model.circuits[room]]].filter(Boolean) : partsOf(model, "power")); break;
    case "lights": switchAll(partsOf(model, "lights", room)); break;
    case "air": switchAll(room ? partsOf(model, "air", room).filter((part) => part.kind !== "air plant") : partsOf(model, "air").filter((part) => part.kind === "air plant")); break;
    case "cameras": switchAll(partsOf(model, "cameras", room)); break;
    case "comms": switchAll(partsOf(model, "comms", room)); break;
    case "alarm":
      if (effect.state === "ringing") lines.push(...soundAlarm(game, place, room ?? null, { by }));
      else if (effect.state === "quiet") lines.push(...silenceAlarm(game, place));
      else lines.push(...armAlarm(game, place, effect.state === "on", { by }));
      break;
    case "door":
      if (!room) return [`[SYSTEMS] Which door? Write the room it leads into.`];
      if (!model.doors[room]) return [`[SYSTEMS] The door to ${roomNameOf(place, room)} isn't one ${model.name}'s systems run.`];
      lines.push(...setDoor(game, place, room, effect.state === "locked" ? "locked" : "unlocked", { by }));
      break;
    case "fix": {
      const parts = Object.values(model.parts).filter((part) => (!effect.what || effect.what === "everything" || part.system === effect.what) && (!room || part.room === room));
      for (const part of parts) {
        repairPart(game, place, part.id);
        switchPart(game, place, part.id, true, { by });
      }
      if (!effect.what || effect.what === "everything" || effect.what === "doors") for (const door of Object.keys(model.doors)) if (!room || door === room) setDoor(game, place, door, "fixed", { by });
      if (!effect.what || effect.what === "everything" || effect.what === "alarm") {
        lines.push(...silenceAlarm(game, place, { quiet: true }));
        if (alarmState(game, place).disarmed) armAlarm(game, place, true, { by });
      }
      lines.push(`[SYSTEMS] ${effect.what && effect.what !== "everything" ? upperFirst(effect.what) : "Everything"} at ${model.name}${room ? ` in ${roomNameOf(place, room)}` : ""} is working again.`);
      break;
    }
    case "break": {
      const parts = Object.values(model.parts).filter((part) => part.system === effect.what && (!room || part.room === room));
      for (const part of parts) lines.push(...damagePart(game, place, part.id, "broken", { by }));
      lines.push(`[SYSTEMS] ${upperFirst(effect.what)} at ${model.name}${room ? ` in ${roomNameOf(place, room)}` : ""} is broken.`);
      break;
    }
    default: switchAll(partsOf(model, effect.system, room));
  }
  return lines;
}

// ---- The checker -------------------------------------------------------------------------------------------

// How many places have systems, for check-story to say.
export const placesWithSystems = () => Object.keys(LOCATIONS).filter((id) => systemsOf(id)?.systems.length).length;

export function systemsProblems() {
  const problems = [...SYSTEMS_FILE_PROBLEMS];
  for (const place of Object.keys(WORLD_SYSTEMS)) if (!mapFor(place)) problems.push(`systems/${place}.txt: there's no map of a place called ${place} in world/maps`);
  for (const place of Object.keys(LOCATIONS)) {
    const model = systemsOf(place);
    if (!model) continue;
    const file = model.written ? `systems/${place}.txt` : `the systems ${place} gets by default`;
    for (const one of model.problems) problems.push(`${file}${one.line ? ` (line ${one.line})` : ""}: ${one.message}`);
  }
  return problems;
}

// ---- Wearing out ----------------------------------------------------------------------------------------------

// A number from 0 to 1 for some words, the same every time: the same game, place and day wear the same way.
function unitOf(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  // Stirred, so that words that differ only in their last digit don't land close together.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Now and then something wears out by itself, at a place whose file says how often ("a part wears out every: 10", in
// days): one of the kinds with a worn line in world/systems/_defaults.json, picked among the parts that are working, a
// kind first so the many speakers don't crowd out the few junction boxes. It breaks the way its kind breaks, so the
// engineers mend it as they would, with a parts crate where a repair takes one. Once a day, the same way for the same
// game and day. Says what the player hears, if they're there.
export function wearDay(game, day) {
  if ((game.wearDay ?? -1) >= day) return [];
  game.wearDay = day;
  const lines = [];
  for (const place of Object.keys(WORLD_SYSTEMS)) {
    const model = systemsOf(place);
    const every = model?.numbers.wear;
    if (!every || unitOf(`${game.name}|wear|${place}|${day}`) >= 1 / every) continue;
    // What the place can't breathe without (its air plant, and the box that feeds it) never gives out while there's
    // no spare aboard to mend it with: the engineers nurse it along. Left to wear, one burnt-out breaker on a ship with
    // empty parts lockers would take everyone aboard within hours, in the middle of a wait nobody could act in.
    const plantRooms = partsOf(model, "air").filter((part) => part.kind === "air plant").map((part) => part.room);
    const forAir = (part) => part.kind === "air plant" || (part.kind === "junction box" && plantRooms.some((room) => model.circuits[room] === part.id));
    const working = Object.values(model.parts).filter((part) => {
      const spec = kindSpec(part.kind);
      const s = partState(game, place, part.id);
      if (part.unplaced || !spec.worn || !spec.break || s.damage || s.on === false) return false;
      return !(forAir(part) && !repairPartsAboard(game, place, spec.break.damage ?? "broken"));
    });
    const kinds = [...new Set(working.map((part) => part.kind))];
    if (!kinds.length) continue;
    const kind = kinds[Math.floor(unitOf(`${game.name}|wear kind|${place}|${day}`) * kinds.length)];
    const ofKind = working.filter((part) => part.kind === kind);
    const part = ofKind[Math.floor(unitOf(`${game.name}|wear part|${place}|${day}`) * ofKind.length)];
    const spec = kindSpec(kind);
    const where = roomNameOf(place, part.room);
    const what = `the ${part.name} in ${where}`;
    const said = damagePart(game, place, part.id, spec.break.damage ?? "broken", { by: "wear" });
    // The engineers replace it the same day where they have what it takes, so a day's wear is all settled on its own
    // day and it comes out the same however the time is cut up. With no parts crate aboard it stays broken, waiting.
    const s = game.systems[place].parts[part.id];
    const engineer = personName(place, staffOf(game, place, model.engineers)[0] ?? "Someone");
    const waiting = [];
    const took = model.engineers.length ? repairWith(game, place, model, s, s.damage, what, (...text) => waiting.push(...text)) : null;
    const gave = `${upperFirst(what)} ${/s$/.test(part.name) ? "have" : "has"} given out`;
    if (took !== null) {
      const mended = repairPart(game, place, part.id);
      if (place === game.location) lines.push(`[SYSTEMS] ${gave}, and ${engineer} has replaced what wore out${took ? `, with ${took}` : ""}.`, ...mended);
    } else if (place === game.location) lines.push(`[SYSTEMS] ${gave}. ${spec.worn}`, ...said, ...waiting);
  }
  return lines;
}

// ---- For the requests people make (src/requests.js) -----------------------------------------------------------

// The parts the engineers can't fix for want of a parts crate, by id.
export function partsWaitingIds(game, place) {
  const model = systemsOf(place);
  const parts = game.systems?.[place]?.parts ?? {};
  return Object.entries(parts).filter(([id, s]) => s.noParts && s.damage && model?.parts[id]).map(([id]) => id);
}
// A part by what it's called ("the air plant", "junction box in Engineering") or its id; the first that matches.
export function partByWords(place, words) {
  const model = systemsOf(place);
  if (!model) return null;
  const [name, roomWords] = String(words ?? "").split(/\s+in\s+/i);
  const want = plain(name);
  return Object.values(model.parts).find((part) => (part.id === want.replace(/ /g, "_") || plain(part.name) === want) && (!roomWords || plain(roomNameOf(place, part.room)) === plain(roomWords))) ?? null;
}
// A part's name and its room's, for what's said: { name: "speaker", room: "the Galley" }.
export function partWords(place, id) {
  const part = systemsOf(place)?.parts[id];
  return part ? { name: part.name, room: roomNameOf(place, part.room).replace(/^The /, "the ") } : null;
}
// Whether a part is broken.
export const partBroken = (game, place, id) => Boolean(game.systems?.[place]?.parts?.[id]?.damage);
