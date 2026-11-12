// A use for the things in the rooms (the hands-on plan, step 2). Most of what's drawn in a room had words to look at
// and nothing to do. Now a thing does something by what it's called, from world/uses.txt: a bunk is slept in, a chair
// sat in, a mess table eaten at while a sitting's on (a real sitting, out of the kettle), a tea urn drunk from, a
// basin washed at, a board read (and what it says kept in What you know, with what the ship or the port knows today
// for a few of them), a footlocker opened and things left in it, and a shrine or a viewport is somewhere to take a
// moment. The file's own lines can name one thing at one place and give it another use or none, and can stand a thing
// of their own on a free square of a room.
//
// A thing keeps whatever its own file says it does: the use is added beside it. Stores, computers and parts of a
// place's systems are left alone. It registers itself with src/room-hooks.js; nothing else in the game calls it.

import fs from "node:fs";
import path from "node:path";
import { addChecker, addMapWork, addOrder, addThingActs } from "./room-hooks.js";
import { genericKindOf, writtenAtThing } from "./computers.js";
import { placeNow } from "./daily.js";
import { LOCATIONS } from "./data.js";
import { countOf, logisticsOf, logisticsPending, mealsView } from "./logistics.js";
import { worldDir } from "./paths.js";
import { addFatigue, changeStress, passTime, rest, restCost } from "./rules.js";
import { airBadHere, claimedSquares, floorSpot, systemsOf, systemsPending } from "./systems.js";
import { mapFor } from "./walk.js";

export const USES_FILE = process.env.GAME_USES_FILE ?? path.join(worldDir, "uses.txt");
const SHIP = "meridian";
export const USE_KINDS = ["sleep", "sit", "eat", "drink", "wash", "read", "stash", "quiet"];
// What a board can show besides its own words: what the game knows today.
const SHOWS = { "the sittings": "sittings", "the supplies": "supplies" };
// Away from a kettle there are no sittings, so "once a sitting" is once in this many hours.
const MEAL_HOURS = 6;
const BUTTONS = { sleep: "Sleep here", sit: "Sit a while", eat: "Eat here", drink: "Have a cup", wash: "Wash", read: "Read it", quiet: "Take a moment here" };

const plain = (text) => String(text ?? "").toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").replace(/^the /, "").trim();
const slug = (text) => plain(text).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
const escaped = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const two = (n) => String(n).padStart(2, "0");
const clockWords = (minute) => `${two(Math.floor(minute / 60) % 24)}:${two(Math.round(minute) % 60)}`;
const listed = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);
const spell = (minutes) => (minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`);

// ---- The file -----------------------------------------------------------------------------------------

const PARTS = { uses: "uses", "buttons and lines": "words", things: "things", "put in the rooms": "put" };

function readMinutes(text) {
  const found = text.match(/^(\d+|an?|half an) (hour|minute)s?$/i);
  if (!found) return null;
  const n = /^half/i.test(found[1]) ? 0.5 : /^an?$/i.test(found[1]) ? 1 : Number(found[1]);
  return Math.round(n * (found[2].toLowerCase() === "hour" ? 60 : 1));
}

// "read, shows the sittings" or "sleep, stash" or "nothing": the uses a line gives a thing.
function readGiven(text) {
  const uses = [];
  let shows = null;
  for (const word of String(text).split(",").map((one) => one.trim().toLowerCase()).filter(Boolean)) {
    if (word === "nothing") continue;
    const shown = word.match(/^shows (.+)$/);
    if (shown) {
      if (!SHOWS[shown[1]]) return { problem: `a board can show ${listed(Object.keys(SHOWS))}, not "${shown[1]}"` };
      shows = SHOWS[shown[1]];
    } else if (USE_KINDS.includes(word)) uses.push(word);
    else return { problem: `"${word}" isn't a use: they're ${listed(USE_KINDS)}, or nothing` };
  }
  return { uses: uses.map((kind) => ({ kind, ...(kind === "read" && shows ? { shows } : {}) })) };
}

// The whole file, as what it says, with anything it says wrongly by its line.
export function parseUses(text) {
  const model = { uses: [], words: {}, things: [], put: [], problems: [] };
  const wrong = (line, message) => model.problems.push(`world/uses.txt, line ${line}: ${message}`);
  let part = null;
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    if (!line || line.startsWith("#") || /^draft:/i.test(line)) return;
    const head = line.match(/^([A-Za-z ]+):$/);
    if (head) {
      part = PARTS[head[1].toLowerCase()] ?? null;
      if (!part) wrong(n, `there's no part called "${head[1]}": the parts are Uses, Buttons and lines, Things, and Put in the rooms`);
      return;
    }
    if (!part) return;
    if (!line.startsWith("- ")) return wrong(n, "each line here starts with a dash and a space");
    const body = line.slice(2).trim();
    if (part === "uses") {
      const [kind, ...rest] = body.split(":");
      const use = { kind: kind.trim().toLowerCase(), words: [], minutes: 0, stress: 0, tiredness: 0, once: null, cost: 0, line: n };
      if (!USE_KINDS.includes(use.kind)) return wrong(n, `"${kind.trim()}" isn't a use the game knows: they're ${listed(USE_KINDS)}`);
      if (model.uses.some((one) => one.kind === use.kind)) return wrong(n, `${use.kind} is here twice`);
      const [called, ...clauses] = rest.join(":").split(";").map((one) => one.trim()).filter(Boolean);
      if (!/^called /i.test(called ?? "")) return wrong(n, `after "${use.kind}:" comes "called" and the words that mean it, with commas between`);
      use.words = called.replace(/^called /i, "").split(",").map((word) => plain(word)).filter(Boolean);
      if (!use.words.length) return wrong(n, "no words after called");
      for (const clause of clauses) {
        const minutes = readMinutes(clause);
        const once = clause.match(/^once (a sitting|a day|every (\d+) hours?)$/i);
        const cost = clause.match(/^(\d+) credits? off the ship$/i);
        if (minutes !== null) use.minutes = minutes;
        else if (once) use.once = /sitting/i.test(once[1]) ? { sitting: true } : /day/i.test(once[1]) ? { day: true } : { hours: Number(once[2]) };
        else if (cost) use.cost = Number(cost[1]);
        else {
          for (const effect of clause.split(",").map((one) => one.trim())) {
            const found = effect.match(/^(stress|tiredness) (-?\d+)$/i);
            if (!found) return wrong(n, `"${effect}" isn't something a use can say: a time (30 minutes, 1 hour), stress -4, tiredness -2, once a sitting, once a day, once every 4 hours, or 2 credits off the ship`);
            use[found[1].toLowerCase()] = Number(found[2]);
          }
        }
      }
      model.uses.push(use);
    } else if (part === "words") {
      const [kind, button, ...said] = body.split(":").map((one) => one.trim());
      if (!USE_KINDS.includes(kind.toLowerCase())) return wrong(n, `"${kind}" isn't a use the game knows`);
      if (!button) return wrong(n, "after the use comes what its button says");
      model.words[kind.toLowerCase()] = { button, said: said.join(": ") || null };
    } else if (part === "things") {
      const comma = body.indexOf(",");
      const colon = body.lastIndexOf(":");
      if (comma < 0 || colon < comma) return wrong(n, "a thing's line goes: the place, the thing's name: what it does, or nothing");
      const given = readGiven(body.slice(colon + 1));
      if (given.problem) return wrong(n, given.problem);
      model.things.push({ place: body.slice(0, comma).trim().toLowerCase(), name: body.slice(comma + 1, colon).trim(), uses: given.uses, line: n });
    } else {
      const comma = body.indexOf(",");
      const [room, name, what, ...look] = body.slice(comma + 1).split(": ").map((one) => one.trim());
      if (comma < 0 || !room || !name || !what) return wrong(n, "a line here goes: the place, the room: the thing's name: what it does: what it looks like");
      const given = readGiven(what);
      if (given.problem) return wrong(n, given.problem);
      if (!given.uses.length) return wrong(n, "a thing put in a room has to do something");
      model.put.push({ place: body.slice(0, comma).trim().toLowerCase(), room, name, uses: given.uses, look: look.join(": ") || null, line: n });
    }
  });
  for (const use of model.uses) use.pattern = new RegExp(`(?<![a-z0-9])(?:${use.words.map(escaped).join("|")})(?![a-z0-9])`, "i");
  return model;
}

let read;
// What the file says, read once. Null where there's no file.
export function usesModel() {
  if (read === undefined) read = fs.existsSync(USES_FILE) ? parseUses(fs.readFileSync(USES_FILE, "utf8")) : null;
  return read;
}
// For the tests: the file is read again at the next map made.
export function forgetUses() {
  read = undefined;
  placing.clear();
}

// ---- What each thing does -----------------------------------------------------------------------------

// What wouldn't go where the file says, by place, for the checker.
const placing = new Map();
const roomIdOf = (level, thing) => (level.areas?.length ? level.roomAt(thing.x, thing.y) : level.id);
// Something that already hands out an item or has words of its own when used keeps to that: it's never made a stash,
// because a thing that opens does nothing else.
const canHold = (thing) => !thing.item && !thing.used && !thing.usedOther && !thing.holds && !thing.store;

// The uses of a thing drawn in a room: the file's own line for it, or the first use one of whose words is in its name.
export function usesOfThing(model, place, level, thing) {
  if (!model || thing.store || thing.pile) return [];
  const named = model.things.find((one) => one.place === place && plain(one.name) === plain(thing.name));
  if (named) return named.uses;
  // A computer is a computer, whatever it's called.
  if (genericKindOf(thing) || writtenAtThing(place, roomIdOf(level, thing), thing)) return [];
  const use = model.uses.find((one) => one.pattern.test(plain(thing.name)));
  return use ? [{ kind: use.kind }] : [];
}

// The squares a new thing leaves alone: every thing's and part's own square and the squares beside them, which is
// where you stand to reach them, and whatever the place's systems and people have claimed.
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

addMapWork((place, map) => {
  // Not before the place's parts and stores stand in the map: a store is left alone, and nothing is stood on their squares.
  if (systemsPending(place) || logisticsPending(place)) return false;
  const model = usesModel();
  if (!model) return true;
  const problems = [];
  const rooms = Object.values(map.rooms ?? {}).filter((room) => !room.deck);
  // The file's own things first, each on a free square at the edge of its room, like a store nobody has drawn.
  for (const put of model.put.filter((one) => one.place === place)) {
    const room = rooms.find((one) => plain(one.name) === plain(put.room) || one.id === plain(put.room) || (one.aliases ?? []).some((alias) => plain(alias) === plain(put.room)));
    if (!room) {
      problems.push(`world/uses.txt, line ${put.line}: there's no room called ${put.room} at ${LOCATIONS[place]?.name ?? place}`);
      continue;
    }
    const level = room.level;
    if (level.things.some((one) => plain(one.name) === plain(put.name))) continue;
    const spot = floorSpot(level, new Set(), 0, 1, keptClear(place, map, level), room.area ?? null);
    if (!spot) {
      problems.push(`world/uses.txt, line ${put.line}: there's no free square in ${room.name} to put ${put.name} on`);
      continue;
    }
    level.things.push({ id: `use:${slug(put.name)}`, name: put.name, look: put.look, x: spot.x, y: spot.y, placed: true, put: put.uses });
    // It stands like a thing drawn there: its square isn't floor, and you reach it from beside it.
    level.solid.add(`${spot.x},${spot.y}`);
    if (level.open[spot.y]) level.open[spot.y][spot.x] = false;
  }
  for (const level of Object.values(map.levels ?? {})) {
    for (const thing of level.things ?? []) {
      const uses = (thing.put ?? usesOfThing(model, place, level, thing)).filter((use) => use.kind !== "stash" || canHold(thing));
      if (!uses.length) continue;
      thing.uses = uses;
      // A stash is a thing that opens, empty until something's left in it (src/bag.js keeps what's inside).
      if (uses.some((use) => use.kind === "stash")) thing.holds = {};
    }
  }
  placing.set(place, problems);
  return true;
});

// ---- Doing it -----------------------------------------------------------------------------------------

const nowOf = (game) => game.clock?.hours ?? 0;
const defOf = (kind) => usesModel()?.uses.find((one) => one.kind === kind) ?? null;
const wordsOf = (kind) => usesModel()?.words[kind] ?? { button: BUTTONS[kind], said: null };
const costOf = (game, def) => (def.cost && game.location !== SHIP ? def.cost : 0);

// The sitting that's on at a place with a kettle, and when the next begins.
function sittingNow(game, model) {
  const minutes = nowOf(game) * 60;
  const day = Math.floor(minutes / 1440);
  const minute = minutes - day * 1440;
  const { at, minutes: length } = model.sittings;
  const index = at.findIndex((start) => minute >= start && minute < start + length);
  return { key: index >= 0 ? `${day}:${index}` : null, next: at.find((start) => start > minute) ?? at[0] };
}
const kettlesOf = (game) => logisticsOf(game.location)?.kettles ?? [];

// Why a use can't be had right now, in a few words, or null.
function notNow(game, def) {
  const last = game.uses?.last?.[def.kind];
  const now = nowOf(game);
  if (def.once?.sitting && kettlesOf(game).length) {
    const sitting = sittingNow(game, logisticsOf(game.location));
    if (!sitting.key) return `the next sitting's at ${clockWords(sitting.next)}`;
    if (game.uses?.sitting === sitting.key) return "you've eaten with this sitting";
    if (!kettlesOf(game).some((kettle) => countOf(game, kettle) > 0)) return "the kettle's empty";
  } else if (def.once?.sitting && last !== undefined && now - last < MEAL_HOURS) return "you've eaten not long ago";
  if (def.once?.hours && last !== undefined && now - last < def.once.hours) return "not again so soon";
  if (def.once?.day && last !== undefined && Math.floor(last / 24) === Math.floor(now / 24)) return "once a day is enough";
  const cost = costOf(game, def);
  if (cost > (game.credits ?? 0)) return `it costs ${cost} credits, and you have ${game.credits ?? 0}`;
  return null;
}

function actFor(game, use) {
  const words = wordsOf(use.kind);
  if (use.kind === "stash") return null;
  if (use.kind === "sleep") {
    const cost = restCost(game);
    const why = cost === null ? "you sleep aboard the Meridian" : airBadHere(game) ? "the air's bad here" : cost > (game.credits ?? 0) ? `a bunk here is ${cost} credits` : null;
    return { id: "use-sleep", label: words.button, detail: why ?? (cost ? `8 hours, ${cost} credits` : "8 hours"), ...(why ? { disabled: true } : {}) };
  }
  const def = defOf(use.kind);
  if (!def) return null;
  const why = notNow(game, def);
  const cost = costOf(game, def);
  return { id: `use-${use.kind}`, label: words.button, detail: why ?? [def.minutes ? spell(def.minutes) : null, cost ? `${cost} credits` : null].filter(Boolean).join(", "), ...(why ? { disabled: true } : {}) };
}

addThingActs((game, thing) => {
  if (!thing.uses) return null;
  const does = thing.uses.map((use) => actFor(game, use)).filter(Boolean);
  return does.length ? { does } : null;
});

function thingFor(level, body, kind) {
  const thing = level.things.find((one) => one.id === String(body.key ?? ""));
  const use = thing?.uses?.find((one) => one.kind === kind);
  if (!use) throw new Error("That isn't here.");
  return { thing, use };
}

// What a board shows of today, where the game knows it.
function shown(game, shows) {
  const place = game.location;
  if (shows === "sittings") {
    const model = logisticsOf(place);
    const meals = mealsView(game, place);
    if (!model || !meals) return null;
    const went = meals.today.missed ? `, and ${meals.today.missed} went without` : "";
    return `The sittings are at ${listed(model.sittings.at.map(clockWords))}, about ${meals.aSitting} people at each. Right now: ${meals.now}. Today the kettle has fed ${meals.today.served}${went}.`;
  }
  if (shows === "supplies") {
    const goods = placeNow(game, place)?.goods ?? [];
    return goods.length ? `Today: ${listed(goods.map((good) => `${good.name.toLowerCase()} ${good.level}`))}.` : null;
  }
  return null;
}

// What was read is kept in What you know, once, under the thing's name (with the place's, if the name's taken).
function keepRead(game, thing) {
  if (!thing.look) return null;
  game.lore ??= [];
  const id = `read:${game.location}:${thing.id}`;
  if (game.lore.some((entry) => entry.id === id)) return null;
  const where = LOCATIONS[game.location]?.name ?? game.location;
  const taken = game.lore.some((entry) => entry.name.toLowerCase() === thing.name.toLowerCase());
  const name = taken ? `${thing.name}, ${where}` : thing.name;
  if (game.lore.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) return null;
  game.lore.push({ id, name, kind: "concept", text: `At ${where}: ${String(thing.look).slice(0, 300)}` });
  return name;
}

function spend(game, def) {
  const cost = costOf(game, def);
  if (cost) game.credits -= cost;
  const notes = def.minutes ? passTime(game, def.minutes / 60, "routine") : [];
  if (def.tiredness) addFatigue(game, def.tiredness);
  if (def.stress) notes.push(...changeStress(game, def.stress));
  game.uses = { ...(game.uses ?? {}), last: { ...(game.uses?.last ?? {}), [def.kind]: nowOf(game) } };
  return { cost, notes };
}

addOrder("use-sleep", (game, body, { level }) => {
  thingFor(level, body, "sleep");
  if (airBadHere(game)) throw new Error("You can't sleep here: the air's bad. Get somewhere it's moving first.");
  return { said: rest(game) };
});

for (const kind of ["sit", "eat", "drink", "wash", "quiet", "read"]) {
  addOrder(`use-${kind}`, (game, body, { level }) => {
    const { thing, use } = thingFor(level, body, kind);
    const def = defOf(kind);
    if (!def) throw new Error("Nothing comes of it.");
    const why = notNow(game, def);
    if (why) throw new Error(`Not now: ${why}.`);
    const lines = [];
    // A meal aboard is a real one, out of the kettle, with the sitting that's on.
    if (kind === "eat" && def.once?.sitting && kettlesOf(game).length) {
      const kettle = kettlesOf(game).find((one) => countOf(game, one) > 0);
      game.stores = { ...(game.stores ?? {}), [kettle.key]: { ...(game.stores?.[kettle.key] ?? {}), count: countOf(game, kettle) - 1 } };
      game.uses = { ...(game.uses ?? {}), sitting: sittingNow(game, logisticsOf(game.location)).key };
    }
    const { cost, notes } = spend(game, def);
    lines.push(`${wordsOf(kind).said ?? "Done."}${cost ? ` It costs you ${cost} credit${cost === 1 ? "" : "s"}.` : ""}`);
    if (kind === "read") {
      const live = use.shows ? shown(game, use.shows) : null;
      if (live) lines.push(live);
      const kept = keepRead(game, thing);
      if (kept) lines.push(`It's in What you know now, under ${kept}.`);
    }
    return { said: [...lines, ...notes].join("\n") };
  });
}

// ---- For the checker ----------------------------------------------------------------------------------

export function usesProblems() {
  const model = usesModel();
  if (!model) return [];
  const problems = [...model.problems];
  for (const kind of USE_KINDS) if (!model.uses.some((use) => use.kind === kind)) problems.push(`world/uses.txt: there's no line for ${kind} under Uses, so nothing is ever one`);
  const places = new Set([...model.things, ...model.put].map((one) => one.place));
  for (const place of places) {
    const map = LOCATIONS[place] ? mapFor(place) : null;
    const lines = [...model.things, ...model.put].filter((one) => one.place === place);
    if (!map) {
      for (const one of lines) problems.push(`world/uses.txt, line ${one.line}: there's no place called ${place} with a map`);
      continue;
    }
    problems.push(...(placing.get(place) ?? []));
    const names = new Set(Object.values(map.levels).flatMap((level) => level.things.map((thing) => plain(thing.name))));
    for (const one of model.things.filter((line) => line.place === place)) {
      if (!names.has(plain(one.name))) problems.push(`world/uses.txt, line ${one.line}: there's nothing called ${one.name} at ${LOCATIONS[place].name}`);
    }
  }
  return problems;
}
addChecker(usesProblems);
