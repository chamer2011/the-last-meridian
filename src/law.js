// What's yours and what isn't (the hands-on plan, step 5). A place's file, world/law/<place>.txt, says who may take
// from each of its stores and who may be in its closed rooms: posts and jobs from its chain of command, the captain
// always. None of it matters unless it's seen, by someone awake in the same room or a camera that works, with the
// lights on. So the hour, the lights, the cameras' power and who's walking with the player decide it.
//
// Seen taking: it goes back into the store, the witness remembers, it counts as a theft aboard, and a second time
// within a few days costs credits. Seen in a closed room: told to leave, and walked out after a while. Unseen, the
// player is told once, for each store, that nobody saw.
//
// What the player takes is already counted by src/puts.js, so this only looks at those totals each time the clock
// moves. It registers itself with src/room-hooks.js; nothing else in the game calls it.

import fs from "node:fs";
import path from "node:path";
import { addChecker, addClockWork } from "./room-hooks.js";
import { storePut } from "./bag.js";
import { keyAt } from "./body.js";
import { YOU, commandOf, countForDuty, jobByWords, jobOf, postByWords, postOf, rememberRequest } from "./command.js";
import { ITEMS, LOCATIONS } from "./data.js";
import { peopleAboard } from "./life.js";
import { logisticsOf } from "./logistics.js";
import { worldDir } from "./paths.js";
import { notePut, putsOf } from "./puts.js";
import { isCaptain } from "./role.js";
import { removeItem } from "./rules.js";
import { roomDark, watched } from "./systems.js";
import { mapFor, startInRoom } from "./walk.js";

export const LAW_DIR = process.env.GAME_LAW_DIR ?? path.join(worldDir, "law");
const SHIP = "meridian";

const plain = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ").replace(/^the /, "").trim();
const nowOf = (game) => game.clock?.hours ?? 0;
const counted = (item, n) => {
  const name = (ITEMS[item]?.name ?? item).toLowerCase();
  return `${n === 1 ? (/^[aeiou]/.test(name) ? "an" : "a") : n} ${name}${n === 1 || /(s|produce)$/.test(name) ? "" : "s"}`;
};

// ---- The file -----------------------------------------------------------------------------------------

export function parseLaw(text) {
  const model = { stores: [], rooms: [], taking: null, room: null, problems: [] };
  let part = null;
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    if (!line || line.startsWith("#") || /^draft:/i.test(line)) return;
    if (/^stores:$/i.test(line)) { part = "stores"; return; }
    if (/^rooms:$/i.test(line)) { part = "rooms"; return; }
    const taking = line.match(/^seen taking: it goes back; (\d+) credits docked a second time within (\d+) days$/i);
    const room = line.match(/^seen in a closed room: walked out after (\d+) minutes$/i);
    if (taking) { model.taking = { fine: Number(taking[1]), days: Number(taking[2]) }; return; }
    if (room) { model.room = { minutes: Number(room[1]) }; return; }
    if (/^seen /i.test(line)) return model.problems.push(`line ${n}: the two lines are written like: "seen taking: it goes back; 10 credits docked a second time within 7 days" and "seen in a closed room: walked out after 10 minutes"`);
    const found = part ? line.match(/^- (.+?): (.+)$/) : null;
    if (!found) return model.problems.push(`line ${n}: a line here goes: a dash, the store or the room, a colon, and who it belongs to`);
    model[part].push({ name: found[1].trim(), owners: found[2].split(",").map((one) => one.trim()).filter(Boolean), line: n });
  });
  return model;
}

const laws = new Map();
// A place's law, with its stores, rooms and owners found: null where it has no file.
export function lawOf(place) {
  if (laws.has(place)) return laws.get(place);
  const file = path.join(LAW_DIR, `${place}.txt`);
  let law = null;
  if (place && fs.existsSync(file)) {
    const read = parseLaw(fs.readFileSync(file, "utf8"));
    const problems = read.problems.map((one) => `world/law/${place}.txt, ${one}`);
    const wrong = (line, message) => problems.push(`world/law/${place}.txt, line ${line}: ${message}`);
    const owners = (entry) => {
      const out = { everyone: false, posts: [], jobs: [] };
      for (const words of entry.owners) {
        const bare = words.replace(/^the /i, "");
        if (/^everyone$/i.test(words)) out.everyone = true;
        else if (/^(nobody|the captain)$/i.test(words)) continue;
        else if (postByWords(place, bare)) out.posts.push(postByWords(place, bare));
        else if (jobByWords(place, bare)) out.jobs.push(jobByWords(place, bare));
        else wrong(entry.line, `${words} isn't a post or a job at ${LOCATIONS[place]?.name ?? place}, nor everyone or nobody`);
      }
      return out;
    };
    const model = logisticsOf(place);
    const map = mapFor(place);
    law = { place, stores: [], rooms: [], taking: read.taking, room: read.room, problems };
    for (const entry of read.stores) {
      const store = model?.stores.find((one) => plain(one.name) === plain(entry.name));
      if (!store) wrong(entry.line, `there's no store called ${entry.name} at ${LOCATIONS[place]?.name ?? place}`);
      else if (!store.count) law.stores.push({ key: store.key, name: store.name, holds: store.holds, room: store.room, ...owners(entry) });
    }
    for (const entry of read.rooms) {
      const room = Object.values(map?.rooms ?? {}).find((one) => !one.deck && plain(one.name) === plain(entry.name));
      if (!room) wrong(entry.line, `there's no room called ${entry.name} at ${LOCATIONS[place]?.name ?? place}`);
      else law.rooms.push({ id: room.id, name: room.name, ...owners(entry) });
    }
    if (read.stores.length && !read.taking) problems.push(`world/law/${place}.txt: there's no "seen taking" line, so taking costs nothing`);
    if (read.rooms.length && !read.room) problems.push(`world/law/${place}.txt: there's no "seen in a closed room" line, so nobody's walked out`);
  }
  laws.set(place, law);
  return law;
}
export const forgetLaw = () => laws.clear();

export function lawProblems() {
  if (!fs.existsSync(LAW_DIR)) return [];
  return fs.readdirSync(LAW_DIR).filter((name) => name.endsWith(".txt") && !name.startsWith("_")).flatMap((name) => {
    const place = name.slice(0, -4);
    if (!LOCATIONS[place] || !mapFor(place)) return [`world/law/${name}: there's no place called ${place} with a map`];
    return lawOf(place)?.problems ?? [];
  });
}
addChecker(lawProblems);

// ---- Whose it is, and who sees ------------------------------------------------------------------------

// Whether something that belongs to some posts and jobs is the player's to use.
export function isMine(game, place, owned) {
  if (owned.everyone || (place === SHIP && isCaptain(game))) return true;
  if (!commandOf(place)) return false;
  const post = postOf(game, place, YOU);
  const job = jobOf(game, place, YOU);
  return Boolean((post && owned.posts.includes(post)) || (job && owned.jobs.includes(job)));
}

const playerRoom = (game) => {
  const walk = game.walk;
  if (!walk || walk.room || walk.place !== game.location) return null;
  return mapFor(game.location)?.levels?.[walk.level]?.roomAt(walk.x, walk.y) ?? null;
};

// Who sees what the player does in a room right now: someone awake and on their feet in it, or a camera that works.
// Nobody does in the dark, and whoever's walking with the player looks the other way.
export function whoSees(game, place, room) {
  if (!room || roomDark(game, place, room)) return null;
  const level = mapFor(place)?.levels?.[game.walk?.level];
  if (!level) return null;
  const there = peopleAboard(game, place, level.id).find((one) => {
    const key = one.id ?? one.name;
    return !one.asleep && level.roomAt(one.x, one.y) === room && key !== game.along?.key && !game.down?.[keyAt(place, key)];
  });
  if (there) return { key: there.id ?? there.name, name: there.label ?? there.name };
  return watched(game, place, room) ? { camera: true } : null;
}

// ---- The clock ----------------------------------------------------------------------------------------

addClockWork((game) => {
  const place = game.location;
  const law = lawOf(place);
  if (!law) return [];
  const lines = [];
  const now = nowOf(game);
  const room = playerRoom(game);
  // What's been taken from a store that isn't the player's, since it was last looked at.
  for (const store of law.taking ? law.stores : []) {
    if (isMine(game, place, store)) continue;
    for (const item of Object.keys(store.holds ?? {})) {
      const key = `${store.key}|${item}`;
      const taken = Math.max(0, -putsOf(game, store.key, item));
      const before = game.law?.taken?.[key] ?? 0;
      if (taken === before) continue;
      const keep = (n) => { game.law = { ...(game.law ?? {}), taken: { ...(game.law?.taken ?? {}), [key]: n } }; };
      const more = taken - before;
      const seen = more > 0 ? whoSees(game, place, room) : null;
      if (!seen) {
        keep(taken);
        // Told once for each store, so that the player knows there was something to see.
        if (more > 0 && !game.law?.told?.[store.key]) {
          game.law = { ...game.law, told: { ...(game.law.told ?? {}), [store.key]: true } };
          lines.push(`[LAW] The ${store.name} ${/s$/.test(store.name) ? "aren't" : "isn't"} yours to take from. Nobody saw.`);
        }
        continue;
      }
      // Back it goes, as much of it as the player still has.
      const back = Math.min(more, game.inventory?.[item] ?? 0);
      if (back > 0) {
        removeItem(game, item, back);
        const put = storePut(game, store.key, store.holds, item, back);
        notePut(game, store.key, item, put);
      }
      keep(Math.max(0, -putsOf(game, store.key, item)));
      const who = seen.camera ? `The camera in ${mapFor(place).rooms[room]?.name.replace(/^The /, "the ") ?? "the room"}` : seen.name;
      lines.push(`[LAW] ${who} saw you take ${counted(item, more)} from the ${store.name}${back > 0 ? `. ${back === 1 ? "It goes" : "They go"} back` : ""}.`);
      if (seen.key && place === SHIP) rememberRequest(game, seen.key, "story", { words: `saw you take from the ${store.name} what wasn't yours`, w: -5 });
      if (commandOf(place)) countForDuty(game, place, "thefts");
      const lately = (game.law.caught ?? []).filter((at) => now - at < law.taking.days * 24);
      if (lately.length) {
        const fine = Math.min(law.taking.fine, game.credits ?? 0);
        game.credits -= fine;
        lines.push(`[LAW] It's not the first time this week: ${fine} credits are docked.`);
      }
      game.law = { ...game.law, caught: [...lately, now] };
    }
  }
  // A closed room: told to leave when seen, and walked out if still there after a while.
  const closed = law.room ? law.rooms.find((one) => one.id === room && !isMine(game, place, one)) : null;
  const inRoom = game.law?.inRoom ?? null;
  if (!closed) {
    if (inRoom) game.law = { ...game.law, inRoom: null };
    return lines;
  }
  const seen = whoSees(game, place, room);
  if (!seen) return lines;
  const who = seen.camera ? "A voice from the speaker" : seen.name;
  if (!inRoom || inRoom.room !== room) {
    game.law = { ...(game.law ?? {}), inRoom: { room, since: now } };
    lines.push(`[LAW] ${who}: "You've no business in ${closed.name.replace(/^The /, "the ")}. Out."`);
  } else if ((now - inRoom.since) * 60 >= law.room.minutes) {
    const out = mapFor(place).rooms[room]?.area?.doors?.[0]?.to ?? mapFor(place).start;
    startInRoom(game, out);
    game.law = { ...game.law, inRoom: null };
    if (seen.key && place === SHIP) rememberRequest(game, seen.key, "story", { words: `had to walk you out of ${closed.name.replace(/^The /, "the ")}`, w: -3 });
    lines.push(`[LAW] You're walked out of ${closed.name.replace(/^The /, "the ")}, and not gently.`);
  }
  return lines;
});
