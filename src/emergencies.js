// Emergencies in the rooms (the hands-on plan, step 4). Three things that go wrong by themselves and can be put right
// by hand, from world/emergencies.txt:
//
// - A fire, in a room with heat in it. It grows, spoils the room's air (so people leave, by the place's own systems),
//   breaks the room's parts once it's big, and spreads once through a door that isn't locked. It shrinks while the
//   room's air is shut off, while the engineers are at it (they come by themselves after a while), and each time the
//   player fights it by hand, at the risk of a burn.
// - A breach, in a room on the hull: its air goes until it's patched, by the player with an emergency hull patch or a
//   parts crate, or by the engineers with a parts crate from the stores.
// - A brawl, at a sitting with morale low: two people come to blows, and unless someone steps between them they're
//   both hurt.
//
// They start by chance only while the clock is running in play at the place (a minute or two at a time), never during
// a skipped stretch such as a night's sleep or a shift, so nothing burns while the player couldn't have done anything.
// Whatever is already going on is played through however the time passes. It registers itself with
// src/room-hooks.js; nothing else in the game calls it.

import fs from "node:fs";
import path from "node:path";
import { addAirSpoiler, addChecker, addClockWork, addDetour, addOrder, addRoomActs } from "./room-hooks.js";
import { addWounds, keyAt, newWound, woundKindsByName } from "./body.js";
import { SKILLS } from "./character-data.js";
import { rememberRequest } from "./command.js";
import { ITEMS, LOCATIONS } from "./data.js";
import { whoIsIn } from "./life.js";
import { logisticsOf, takeAboard } from "./logistics.js";
import { worldDir } from "./paths.js";
import { changeStress, passTime, practice, removeItem, skillRank } from "./rules.js";
import { airFlows, alarmRinging, damagePart, doorLocked, foulAir, partBroken, systemsOf } from "./systems.js";
import { mapFor } from "./walk.js";

export const EMERGENCIES_FILE = process.env.GAME_EMERGENCIES_FILE ?? path.join(worldDir, "emergencies.txt");
// The clock moved by no more than this since it was last looked at: it's running in play, not being skipped.
const LIVE_HOURS = 5 / 60;
const MOST_FIRES = 3;
const PATCHES = ["emergency_patch", "parts_crate"];
const SIZES = ["out", "small", "taking hold", "burning hard", "fierce", "out of control"];

const plain = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ").replace(/^the /, "").trim();
const nowOf = (game) => game.clock?.hours ?? 0;
const minutesOf = (n, unit) => Number(n) * (/^hour/i.test(unit) ? 60 : 1);

// ---- The file -----------------------------------------------------------------------------------------

const rooms = (text) => {
  const list = text.split(";").map((one) => one.trim()).filter(Boolean).map((one) => {
    const comma = one.indexOf(",");
    return comma < 0 ? null : { place: one.slice(0, comma).trim().toLowerCase(), name: one.slice(comma + 1).trim() };
  });
  return list.length && list.every(Boolean) ? { rooms: list } : null;
};
const after = (text) => {
  const found = text.match(/^after (\d+) (minutes?|hours?)$/i);
  return found ? { engineers: minutesOf(found[1], found[2]) } : null;
};
// Each line a kind can have: how it's read, and how it's written when it can't be.
const LINES = {
  fire: {
    rooms: [rooms, "the place, the room; the place, the room"],
    starts: [(t) => { const f = t.match(/^1 in (\d+) days a room, 1 in (\d+) with something broken in it$/i); return f ? { days: Number(f[1]), broken: Number(f[2]) } : null; }, "1 in 40 days a room, 1 in 10 with something broken in it"],
    grows: [(t) => { const f = t.match(/^every (\d+) minutes, to (\d+) at most$/i); return f ? { step: Number(f[1]), most: Number(f[2]) } : null; }, "every 15 minutes, to 5 at most"],
    burns: [(t) => { const f = t.match(/^1 in (\d+)$/); return f ? { burns: Number(f[1]) } : null; }, "1 in 3"],
    "breaks parts": [(t) => { const f = t.match(/^from (\d+)$/i); return f ? { breaks: Number(f[1]) } : null; }, "from 3"],
    spreads: [(t) => { const f = t.match(/^at (\d+)$/i); return f ? { spreads: Number(f[1]) } : null; }, "at 5"],
    "by hand": [(t) => { const f = t.match(/^(\d+) minutes, ([a-z_]+)$/i); return f && SKILLS[f[2].toLowerCase()] ? { hand: Number(f[1]), skill: f[2].toLowerCase() } : null; }, "10 minutes, engineering (a skill's name)"],
    engineers: [after, "after 30 minutes"],
  },
  breach: {
    rooms: [rooms, "the place, the room; the place, the room"],
    starts: [(t) => { const f = t.match(/^1 in (\d+) days a room, 1 in (\d+) with the hull under (\d+)$/i); return f ? { days: Number(f[1]), worn: Number(f[2]), hull: Number(f[3]) } : null; }, "1 in 80 days a room, 1 in 20 with the hull under 40"],
    "by hand": [(t) => { const f = t.match(/^(\d+) minutes$/i); return f ? { hand: Number(f[1]) } : null; }, "20 minutes"],
    engineers: [after, "after 2 hours"],
  },
  brawl: {
    rooms: [rooms, "the place, the room"],
    starts: [(t) => { const f = t.match(/^1 in (\d+) sittings, with morale under (\d+)$/i); return f ? { sittings: Number(f[1]), morale: Number(f[2]) } : null; }, "1 in 3 sittings, with morale under 40"],
    lasts: [(t) => { const f = t.match(/^(\d+) minutes$/i); return f ? { lasts: Number(f[1]) } : null; }, "20 minutes"],
    "stepping in": [(t) => { const f = t.match(/^([a-z_]+) against (\d+)$/i); return f && SKILLS[f[1].toLowerCase()] ? { skill: f[1].toLowerCase(), against: Number(f[2]) } : null; }, "persuasion against 6 (a skill's name and a number)"],
  },
};

export function parseEmergencies(text) {
  const model = { fire: null, breach: null, brawl: null, problems: [] };
  const wrong = (line, message) => model.problems.push(`world/emergencies.txt, line ${line}: ${message}`);
  const seen = { fire: new Set(), breach: new Set(), brawl: new Set() };
  let kind = null;
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    if (!line || line.startsWith("#") || /^draft:/i.test(line)) return;
    const head = line.match(/^([A-Za-z ]+):$/);
    if (head) {
      kind = LINES[head[1].toLowerCase()] ? head[1].toLowerCase() : null;
      if (!kind) wrong(n, `there's no part called "${head[1]}": the parts are Fire, Breach and Brawl`);
      else model[kind] ??= {};
      return;
    }
    if (!kind) return;
    const found = line.match(/^- ([a-z ]+): (.+)$/);
    const reader = found ? LINES[kind][found[1]] : null;
    if (!found) return wrong(n, "each line here goes: a dash, a name, a colon, and what it says");
    if (!reader) return wrong(n, `"${found[1]}" isn't a line of ${kind}: it has ${Object.keys(LINES[kind]).join(", ")}`);
    const read = reader[0](found[2].trim());
    if (!read) return wrong(n, `"${found[1]}" is written like: ${reader[1]}`);
    seen[kind].add(found[1]);
    Object.assign(model[kind], read);
  });
  // A kind with a line missing doesn't happen, and the checker says which.
  for (const [id, lines] of Object.entries(LINES)) {
    if (!model[id]) continue;
    const missing = Object.keys(lines).filter((name) => !seen[id].has(name));
    if (missing.length) {
      model.problems.push(`world/emergencies.txt: ${id} has no line for ${missing.join(", ")}, so it never happens`);
      model[id] = null;
    }
  }
  return model;
}

let read;
export function emergenciesModel() {
  if (read === undefined) read = fs.existsSync(EMERGENCIES_FILE) ? parseEmergencies(fs.readFileSync(EMERGENCIES_FILE, "utf8")) : null;
  return read;
}
export const forgetEmergencies = () => { read = undefined; };

const roomIdOf = (place, name) => Object.values(mapFor(place)?.rooms ?? {}).find((room) => !room.deck && (plain(room.name) === plain(name) || room.id === plain(name)))?.id ?? null;
const roomName = (place, room) => (mapFor(place)?.rooms?.[room]?.name ?? room).replace(/^The /, "the ");
// The rooms a kind can happen in, as ids, for the places that have them on their maps.
const roomsOf = (kind) => (emergenciesModel()?.[kind]?.rooms ?? []).map((one) => ({ place: one.place, room: roomIdOf(one.place, one.name) })).filter((one) => one.room);

export function emergenciesProblems() {
  const model = emergenciesModel();
  if (!model) return [];
  const problems = [...model.problems];
  for (const kind of ["fire", "breach", "brawl"]) {
    for (const one of model[kind]?.rooms ?? []) {
      if (!LOCATIONS[one.place] || !mapFor(one.place)) problems.push(`world/emergencies.txt: there's no place called ${one.place} with a map, for a ${kind}`);
      else if (!roomIdOf(one.place, one.name)) problems.push(`world/emergencies.txt: there's no room called ${one.name} at ${LOCATIONS[one.place].name}, for a ${kind}`);
    }
  }
  return problems;
}
addChecker(emergenciesProblems);

// ---- What's going on ----------------------------------------------------------------------------------

const keyOf = (place, room) => `${place}|${room}`;
const made = (game) => (game.emergencies ??= { fires: {}, breaches: {}, brawl: null });
export const fireIn = (game, place, room) => game.emergencies?.fires?.[keyOf(place, room)] ?? null;
export const breachIn = (game, place, room) => game.emergencies?.breaches?.[keyOf(place, room)] ?? null;
export const brawlAt = (game, place) => (game.emergencies?.brawl?.place === place ? game.emergencies.brawl : null);
const playerRoom = (game) => {
  const walk = game.walk;
  if (!walk || walk.room || walk.place !== game.location) return null;
  return mapFor(game.location)?.levels?.[walk.level]?.roomAt(walk.x, walk.y) ?? null;
};
const told = (game, place, lines) => (game.location === place ? lines : []);
const wound = (name, part) => newWound(woundKindsByName(name).find((kind) => kind.parts.includes(part)), part);
const pickOf = (list) => list[Math.floor(Math.random() * list.length)];

// A fire or a hole in the hull spoils the room's air whatever its vents are doing.
addAirSpoiler((game, place, room) => Boolean(fireIn(game, place, room) || breachIn(game, place, room)));

export function startFire(game, place, room, at = nowOf(game)) {
  if (!emergenciesModel()?.fire || fireIn(game, place, room)) return [];
  made(game).fires[keyOf(place, room)] = { place, room, size: 1, since: at, at };
  foulAir(game, place, room, 95);
  return told(game, place, [`[FIRE] Fire in ${roomName(place, room)}! It's ${SIZES[1]}, and it won't stay that way.`]);
}

function fireOut(game, fire, how) {
  delete game.emergencies.fires[keyOf(fire.place, fire.room)];
  return told(game, fire.place, [`[FIRE] The fire in ${roomName(fire.place, fire.room)} is out${how ? `: ${how}` : ""}.`]);
}

// One step of a fire's life, at a moment: it shrinks if it's starved or being fought, and grows otherwise.
function stepFire(game, fire, t, latest) {
  const rules = emergenciesModel().fire;
  const lines = [];
  const starved = !airFlows(game, fire.place, fire.room);
  const crew = (systemsOf(fire.place)?.engineers?.length ?? 0) > 0 && (t - fire.since) * 60 >= rules.engineers;
  if (crew && !fire.crew) {
    fire.crew = true;
    lines.push(`[FIRE] The engineers are at the fire in ${roomName(fire.place, fire.room)}.`);
  }
  if (starved || crew) fire.size -= (starved ? 1 : 0) + (crew ? 1 : 0);
  // A go at it by hand holds it for the step it was fought in.
  else if (fire.fought !== undefined && (t - fire.fought) * 60 < rules.step) return lines;
  else if (fire.size < rules.most) {
    fire.size += 1;
    lines.push(`[FIRE] The fire in ${roomName(fire.place, fire.room)} grows: it's ${SIZES[Math.min(fire.size, SIZES.length - 1)]}.`);
    if (fire.size >= rules.breaks) {
      const parts = (systemsOf(fire.place)?.partsIn?.[fire.room] ?? []).filter((id) => !partBroken(game, fire.place, id));
      if (parts.length) {
        const id = pickOf(parts);
        lines.push(...damagePart(game, fire.place, id, "broken", { by: "fire" }), `[FIRE] It's got to the ${systemsOf(fire.place).parts[id].name.toLowerCase()}.`);
      }
    }
    if (fire.size >= rules.spreads && !fire.spread) {
      fire.spread = true;
      const next = (mapFor(fire.place)?.rooms?.[fire.room]?.area?.doors ?? []).map((door) => door.to).find((to) => !fireIn(game, fire.place, to) && !doorLocked(game, fire.place, to) && !doorLocked(game, fire.place, fire.room));
      if (next && Object.keys(game.emergencies.fires).length < MOST_FIRES) lines.push(...startFire(game, fire.place, next, t));
    }
  }
  if (fire.size <= 0) return [...told(game, fire.place, lines), ...fireOut(game, fire, starved && !crew ? "it had no air to burn" : crew ? "the engineers put it out" : null)];
  // Whoever stands in it when it's burning may be burnt.
  if (latest && playerRoom(game) === fire.room && game.location === fire.place && Math.random() < 1 / rules.burns) {
    addWounds(game, "you", [wound("burn", pickOf(["left_arm", "right_arm", "chest"]))]);
    lines.push("[HEALTH] The fire catches you: a burn. Get out of it, or put it out.");
  }
  return told(game, fire.place, lines);
}

export function startBreach(game, place, room, at = nowOf(game)) {
  if (!emergenciesModel()?.breach || breachIn(game, place, room)) return [];
  made(game).breaches[keyOf(place, room)] = { place, room, since: at };
  foulAir(game, place, room, 90);
  return told(game, place, [`[BREACH] A plate's gone in ${roomName(place, room)}: the air's going out of it. It wants patching.`]);
}

export function startBrawl(game, place, room, at = nowOf(game)) {
  if (!emergenciesModel()?.brawl || game.emergencies?.brawl) return [];
  const here = whoIsIn(game, place, room, at).filter((name) => !game.down?.[keyAt(place, name)]);
  if (here.length < 2) return [];
  const a = pickOf(here);
  const b = pickOf(here.filter((one) => one !== a));
  made(game).brawl = { place, room, a, b, since: at };
  return told(game, place, [`[BRAWL] ${a} and ${b} have come to blows in ${roomName(place, room)}.`]);
}

// ---- The clock ----------------------------------------------------------------------------------------

addClockWork((game) => {
  const model = emergenciesModel();
  if (!model) return [];
  const now = nowOf(game);
  const lines = [];
  const state = game.emergencies;
  // What's burning burns on, a step at a time, however much time went by.
  for (const fire of Object.values(state?.fires ?? {})) {
    const step = model.fire.step / 60;
    for (let i = 0; i < 400 && fire.at + step <= now && fireIn(game, fire.place, fire.room) === fire; i += 1) {
      fire.at += step;
      lines.push(...stepFire(game, fire, fire.at, fire.at + step > now));
    }
  }
  // The engineers patch a breach in time, with a parts crate out of the stores; with none, it waits.
  for (const breach of Object.values(state?.breaches ?? {})) {
    if (!model.breach || (now - breach.since) * 60 < model.breach.engineers || !(systemsOf(breach.place)?.engineers?.length > 0)) continue;
    if (takeAboard(game, breach.place, "parts_crate", 1) < 1) {
      if (!breach.waiting) lines.push(...told(game, breach.place, [`[BREACH] The engineers can't patch ${roomName(breach.place, breach.room)}: there isn't a parts crate aboard.`]));
      breach.waiting = true;
      continue;
    }
    delete state.breaches[keyOf(breach.place, breach.room)];
    lines.push(...told(game, breach.place, [`[BREACH] The engineers have patched the hull in ${roomName(breach.place, breach.room)}, with a parts crate.`]));
  }
  // A brawl nobody stopped ends with both of them hurt.
  const brawl = state?.brawl;
  if (brawl && model.brawl && (now - brawl.since) * 60 >= model.brawl.lasts) {
    for (const who of [brawl.a, brawl.b]) addWounds(game, keyAt(brawl.place, who), [wound("bruise", pickOf(["head", "chest", "left_arm", "right_arm"]))]);
    if (game.ship && brawl.place === "meridian") game.ship.morale = Math.max(0, game.ship.morale - 1);
    state.brawl = null;
    lines.push(...told(game, brawl.place, [`[BRAWL] ${brawl.a} and ${brawl.b} are pulled apart at last, both of them bleeding. Nobody feels better for it.`]));
  }
  // New trouble, only while the clock's running in play where the player is.
  const place = game.location;
  const gap = now - (state?.seen ?? now);
  if (state?.seen !== now) made(game).seen = now;
  if (gap <= 0 || gap > LIVE_HOURS) return lines;
  const days = gap / 24;
  if (model.fire && Object.keys(game.emergencies.fires).length < MOST_FIRES) {
    for (const one of roomsOf("fire")) {
      if (one.place !== place || fireIn(game, place, one.room)) continue;
      const broken = (systemsOf(place)?.partsIn?.[one.room] ?? []).some((id) => partBroken(game, place, id));
      if (Math.random() < days / (broken ? model.fire.broken : model.fire.days)) lines.push(...startFire(game, place, one.room));
    }
  }
  if (model.breach) {
    const worn = place === "meridian" && (game.ship?.hull ?? 100) < model.breach.hull;
    for (const one of roomsOf("breach")) {
      if (one.place !== place || breachIn(game, place, one.room)) continue;
      if (Math.random() < days / (worn ? model.breach.worn : model.breach.days)) lines.push(...startBreach(game, place, one.room));
    }
  }
  // A brawl starts as a sitting does, when morale's low.
  const sittings = logisticsOf(place)?.sittings;
  if (model.brawl && sittings && !game.emergencies.brawl && place === "meridian" && (game.ship?.morale ?? 100) < model.brawl.morale) {
    const minute = (((now % 24) + 24) % 24) * 60;
    const began = sittings.at.some((start) => minute >= start && minute - gap * 60 < start);
    const room = roomsOf("brawl").find((one) => one.place === place)?.room;
    if (began && room && Math.random() < 1 / model.brawl.sittings) lines.push(...startBrawl(game, place, room));
  }
  return lines;
});

// The two of them stay where they are, at it.
addDetour((game, place) => {
  const brawl = brawlAt(game, place);
  if (!brawl) return null;
  return (key) => (key === brawl.a || key === brawl.b ? { where: `@${brawl.room}`, doing: `coming to blows with ${key === brawl.a ? brawl.b : brawl.a}` } : null);
});

// ---- By hand ------------------------------------------------------------------------------------------

const patchOf = (game) => PATCHES.find((id) => (game.inventory?.[id] ?? 0) > 0) ?? null;
const stepChance = (game, rules) => Math.max(1, Math.min(6, skillRank(game, rules.skill) + 7 - rules.against)) / 6;

addRoomActs((game, { place, room }) => {
  const model = emergenciesModel();
  if (!model || !room) return null;
  const acts = [];
  const fire = model.fire ? fireIn(game, place, room) : null;
  if (fire) acts.push({ id: "fight-fire", label: `Fight the fire (${model.fire.hand} minutes)`, detail: `it's ${SIZES[Math.min(fire.size, SIZES.length - 1)]}` });
  const breach = model.breach ? breachIn(game, place, room) : null;
  if (breach) {
    const patch = patchOf(game);
    acts.push({ id: "patch-breach", label: `Patch the breach (${model.breach.hand} minutes)`, detail: patch ? `with ${/^[aeiou]/i.test(ITEMS[patch].name) ? "an" : "a"} ${ITEMS[patch].name.toLowerCase()}` : "you need an emergency hull patch or a parts crate", ...(patch ? {} : { disabled: true }) });
  }
  const brawl = model.brawl ? brawlAt(game, place) : null;
  if (brawl && brawl.room === room) acts.push({ id: "stop-brawl", label: "Step between them", detail: `${brawl.a} and ${brawl.b}: your ${SKILLS[model.brawl.skill].name}, ${Math.round(stepChance(game, model.brawl) * 100)}%` });
  return acts;
});

addOrder("fight-fire", (game, body, { room }) => {
  const rules = emergenciesModel()?.fire;
  const fire = rules ? fireIn(game, game.location, room) : null;
  if (!fire) throw new Error("There's no fire here.");
  // Better at it, more of it out at a go.
  fire.size -= skillRank(game, rules.skill) >= 4 ? 2 : 1;
  fire.fought = nowOf(game);
  const lines = [];
  if (fire.size <= 0) lines.push(...fireOut(game, fire, "you put it out"));
  else lines.push(`[FIRE] You beat it back: it's ${SIZES[Math.min(fire.size, SIZES.length - 1)]} now.`);
  // The nearer the end of it, the less it bites; the better at it, the less still.
  if (Math.random() < (1 / rules.burns) * Math.max(0.2, 1 - 0.15 * skillRank(game, rules.skill))) {
    addWounds(game, "you", [wound("burn", pickOf(["left_arm", "right_arm"]))]);
    lines.push("[HEALTH] It catches your arm on the way: a burn.");
  }
  const notes = passTime(game, rules.hand / 60, "work");
  return { said: [...lines, ...practice(game, rules.skill, 1), ...notes].join("\n") };
});

addOrder("patch-breach", (game, body, { room }) => {
  const rules = emergenciesModel()?.breach;
  const breach = rules ? breachIn(game, game.location, room) : null;
  if (!breach) throw new Error("There's nothing to patch here.");
  const patch = patchOf(game);
  if (!patch) throw new Error("You need an emergency hull patch or a parts crate to patch it with.");
  removeItem(game, patch, 1);
  delete game.emergencies.breaches[keyOf(breach.place, breach.room)];
  const notes = passTime(game, rules.hand / 60, "work");
  return { said: [`[BREACH] You patch the hull in ${roomName(breach.place, breach.room)} with the ${ITEMS[patch].name.toLowerCase()}. The air will come back.`, ...practice(game, "engineering", 1), ...notes].join("\n") };
});

addOrder("stop-brawl", (game, body, { room }) => {
  const rules = emergenciesModel()?.brawl;
  const brawl = rules ? brawlAt(game, game.location) : null;
  if (!brawl || brawl.room !== room) throw new Error("There's no fight here to stop.");
  const lines = [];
  if (Math.random() < stepChance(game, rules)) {
    game.emergencies.brawl = null;
    for (const who of [brawl.a, brawl.b]) if (brawl.place === "meridian") rememberRequest(game, who, "story", { words: "was pulled out of a fight by you, before it went too far", w: 4 });
    lines.push(`[BRAWL] You step between ${brawl.a} and ${brawl.b}, and say what needs saying. They let go of each other.`);
  } else {
    addWounds(game, "you", [wound("bruise", pickOf(["head", "chest"]))]);
    lines.push(`[BRAWL] You step between ${brawl.a} and ${brawl.b} and catch an elbow for it. They're still at it.`, ...changeStress(game, 3));
  }
  const notes = passTime(game, 5 / 60, "active");
  return { said: [...lines, ...practice(game, rules.skill, 1), ...notes].join("\n") };
});
