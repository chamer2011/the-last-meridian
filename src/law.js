// What's yours and what isn't (the hands-on plan, step 5, and the loot plan's step 5). A place's file,
// world/law/<place>.txt, says who may take from each of its stores, who may be in its closed rooms, and whose the
// containers in its rooms are (src/loot.js says where they are): posts and jobs from its chain of command, everyone,
// nobody but the captain, whoever sleeps there, or whoever holds the place; the captain may always, aboard. A place
// with no file of its own goes by world/law/elsewhere.txt, where everything belongs to whoever holds the place. None of
// it matters unless it's seen, by someone awake in the same room or a camera that works, with the lights on. So the
// hour, the lights, the cameras' power and who's walking with the player decide it.
//
// Seen taking: it goes back into the store or the container, the witness remembers (aboard), it counts as a theft
// aboard, standing with whoever holds the place drops (ashore), and a second time within a few days costs credits.
// Seen in a closed room: told to leave, and walked out after a while. Unseen, the player is told once, for each store
// or container, that nobody saw.
//
// What the player takes is already counted by src/puts.js, so this only looks at those totals each time the clock
// moves. It registers itself with src/room-hooks.js; nothing else in the game calls it.

import fs from "node:fs";
import path from "node:path";
import { addChecker, addClockWork, addThingActs } from "./room-hooks.js";
import { containerPut, storePut } from "./bag.js";
import { keyAt } from "./body.js";
import { YOU, commandOf, countForDuty, jobByWords, jobOf, postByWords, postOf, rememberRequest } from "./command.js";
import { FACTIONS, ITEMS, LOCATIONS } from "./data.js";
import { peopleAboard } from "./life.js";
import { logisticsOf } from "./logistics.js";
import { lootBox, lootOf } from "./loot.js";
import { worldDir } from "./paths.js";
import { notePut, putsOf } from "./puts.js";
import { isCaptain } from "./role.js";
import { changeStanding, removeItem } from "./rules.js";
import { roomDark, watched } from "./systems.js";
import { mapFor, startInRoom } from "./walk.js";

export const LAW_DIR = process.env.GAME_LAW_DIR ?? path.join(worldDir, "law");
const SHIP = "meridian";
// The law at every place with no file of its own.
const ELSEWHERE = "elsewhere";

const plain = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ").replace(/^the /, "").trim();
const nowOf = (game) => game.clock?.hours ?? 0;
const counted = (item, n) => {
  const name = (ITEMS[item]?.name ?? item).toLowerCase();
  return `${n === 1 ? (/^[aeiou]/.test(name) ? "an" : "a") : n} ${name}${n === 1 || /(s|produce)$/.test(name) ? "" : "s"}`;
};

// ---- The file -----------------------------------------------------------------------------------------

export function parseLaw(text) {
  const model = { stores: [], rooms: [], containers: [], taking: null, room: null, standing: null, problems: [] };
  let part = null;
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    if (!line || line.startsWith("#") || /^draft:/i.test(line)) return;
    if (/^stores:$/i.test(line)) { part = "stores"; return; }
    if (/^rooms:$/i.test(line)) { part = "rooms"; return; }
    if (/^containers:$/i.test(line)) { part = "containers"; return; }
    const taking = line.match(/^seen taking: it goes back; (\d+) credits (?:docked|fined) a second time within (\d+) days$/i);
    const standing = line.match(/^seen taking costs standing: (\d+) with whoever holds the place$/i);
    const room = line.match(/^seen in a closed room: walked out after (\d+) minutes$/i);
    if (taking) { model.taking = { fine: Number(taking[1]), days: Number(taking[2]) }; return; }
    if (standing) { model.standing = Number(standing[1]); return; }
    if (room) { model.room = { minutes: Number(room[1]) }; return; }
    if (/^seen /i.test(line)) return model.problems.push(`line ${n}: the lines at the end are written like: "seen taking: it goes back; 10 credits docked a second time within 7 days", "seen taking costs standing: 3 with whoever holds the place" and "seen in a closed room: walked out after 10 minutes"`);
    const found = part ? line.match(/^- (.+?): (.+)$/) : null;
    if (!found) return model.problems.push(`line ${n}: a line here goes: a dash, the store, the room or anywhere, a colon, and who it belongs to`);
    model[part].push({ name: found[1].trim(), owners: found[2].split(",").map((one) => one.trim()).filter(Boolean), line: n });
  });
  return model;
}

const laws = new Map();
// A place's law, with its stores, rooms, containers and owners found: its own file's, or else world/law/elsewhere.txt's;
// null where there's neither.
export function lawOf(place) {
  if (laws.has(place)) return laws.get(place);
  const own = path.join(LAW_DIR, `${place}.txt`);
  const general = path.join(LAW_DIR, `${ELSEWHERE}.txt`);
  const file = place && place !== ELSEWHERE && fs.existsSync(own) ? own : place && LOCATIONS[place] && fs.existsSync(general) ? general : null;
  let law = null;
  if (file) {
    const shared = file === general;
    const named = `world/law/${shared ? ELSEWHERE : place}.txt`;
    const read = parseLaw(fs.readFileSync(file, "utf8"));
    const problems = read.problems.map((one) => `${named}, ${one}`);
    const wrong = (line, message) => problems.push(`${named}, line ${line}: ${message}`);
    const owners = (entry) => {
      const out = { everyone: false, posts: [], jobs: [], words: entry.owners };
      for (const words of entry.owners) {
        const bare = words.replace(/^the /i, "");
        if (/^everyone$/i.test(words)) out.everyone = true;
        else if (/^(nobody|the captain)$/i.test(words)) out.captain = true;
        else if (/^whoever sleeps there$/i.test(words)) out.sleepers = true;
        else if (/^whoever holds the place$/i.test(words)) out.holders = true;
        else if (!shared && postByWords(place, bare)) out.posts.push(postByWords(place, bare));
        else if (!shared && jobByWords(place, bare)) out.jobs.push(jobByWords(place, bare));
        else wrong(entry.line, shared ? `${words} isn't everyone, nobody, whoever sleeps there or whoever holds the place: this file is for every place, so it can't name a post or a job` : `${words} isn't a post or a job at ${LOCATIONS[place]?.name ?? place}, nor everyone, nobody, whoever sleeps there or whoever holds the place`);
      }
      return out;
    };
    const model = logisticsOf(place);
    const map = mapFor(place);
    law = { place, stores: [], rooms: [], containers: [], taking: read.taking, room: read.room, standing: read.standing, shared, problems };
    if (shared && (read.stores.length || read.rooms.length)) problems.push(`${named}: it's for every place, so it has Containers and none of the Stores or Rooms that a place's own file can have`);
    for (const entry of read.containers) {
      if (/^anywhere( else)?$/i.test(entry.name)) {
        law.containers.push({ anywhere: true, name: entry.name, ...owners(entry) });
        continue;
      }
      const room = Object.values(map?.rooms ?? {}).find((one) => !one.deck && plain(one.name) === plain(entry.name));
      if (room) law.containers.push({ id: room.id, name: room.name, ...owners(entry) });
      else if (!shared) wrong(entry.line, `there's no room called ${entry.name} at ${LOCATIONS[place]?.name ?? place}`);
    }
    if (read.containers.length && !read.taking) problems.push(`${named}: there's no "seen taking" line, so taking from a container costs nothing`);
    if (shared ? false : !read.stores.length && !read.rooms.length && !read.containers.length) problems.push(`${named}: it says nothing about stores, rooms or containers`);
    for (const entry of shared ? [] : read.stores) {
      const store = model?.stores.find((one) => plain(one.name) === plain(entry.name));
      if (!store) wrong(entry.line, `there's no store called ${entry.name} at ${LOCATIONS[place]?.name ?? place}`);
      else if (!store.count) law.stores.push({ key: store.key, name: store.name, holds: store.holds, room: store.room, ...owners(entry) });
    }
    for (const entry of shared ? [] : read.rooms) {
      const room = Object.values(map?.rooms ?? {}).find((one) => !one.deck && plain(one.name) === plain(entry.name));
      if (!room) wrong(entry.line, `there's no room called ${entry.name} at ${LOCATIONS[place]?.name ?? place}`);
      else law.rooms.push({ id: room.id, name: room.name, ...owners(entry) });
    }
    if (read.stores.length && !read.taking) problems.push(`${named}: there's no "seen taking" line, so taking costs nothing`);
    if (read.rooms.length && !read.room) problems.push(`${named}: there's no "seen in a closed room" line, so nobody's walked out`);
  }
  laws.set(place, law);
  return law;
}
export const forgetLaw = () => laws.clear();

export function lawProblems() {
  if (!fs.existsSync(LAW_DIR)) return [];
  return fs.readdirSync(LAW_DIR).filter((name) => name.endsWith(".txt") && !name.startsWith("_")).flatMap((name) => {
    const place = name.slice(0, -4);
    // The law for every other place: read as the first place that goes by it would read it.
    if (place === ELSEWHERE) {
      const any = Object.keys(LOCATIONS).find((one) => !fs.existsSync(path.join(LAW_DIR, `${one}.txt`)));
      return any ? lawOf(any)?.problems ?? [] : [];
    }
    if (!LOCATIONS[place] || !mapFor(place)) return [`world/law/${name}: there's no place called ${place} with a map`];
    return lawOf(place)?.problems ?? [];
  });
}
addChecker(lawProblems);

// ---- Whose it is, and who sees ------------------------------------------------------------------------

// Whether something that belongs to some posts and jobs is the player's to use. What belongs to whoever sleeps there or
// whoever holds the place never is, nor what's the captain's alone, unless the player's the captain aboard.
export function isMine(game, place, owned) {
  if (owned.everyone || (place === SHIP && isCaptain(game))) return true;
  if (!commandOf(place)) return false;
  const post = postOf(game, place, YOU);
  const job = jobOf(game, place, YOU);
  return Boolean((post && owned.posts.includes(post)) || (job && owned.jobs.includes(job)));
}

// The room a thing stands in, on its level.
const roomOfThing = (level, thing) => (level?.areas?.length ? level.roomAt(thing.x, thing.y) : level?.id ?? null);
// Whose a container in a room is (src/loot.js says what opens): a closed room's owners, then the place's line for its
// room, then its line for anywhere; null where nothing's said, which is anyone's.
export function containerOwner(place, level, thing) {
  const law = lawOf(place);
  if (!law || !thing) return null;
  const room = roomOfThing(level, thing);
  return law.rooms.find((one) => one.id === room) ?? law.containers.find((one) => one.id === room) ?? law.containers.find((one) => one.anywhere) ?? null;
}
// Whose a port's store is (src/port-stores.js stands them in its rooms): whoever holds the place, whatever room it's in.
export const PORTS_OWN = Object.freeze({ everyone: false, holders: true, posts: [], jobs: [], words: ["whoever holds the place"] });
const both = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0] ?? "");
// Who a container belongs to, in words, for its window: "It belongs to the Salvage Guild."
export function ownerWords(place, owned) {
  if (!owned || owned.everyone) return null;
  if (owned.holders) {
    const faction = FACTIONS[LOCATIONS[place]?.faction];
    return faction ? `It belongs to the ${faction.name.replace(/^the /i, "")}.` : `It belongs to the people of ${LOCATIONS[place]?.name ?? place}.`;
  }
  if (owned.sleepers) return "It belongs to whoever sleeps here.";
  if (owned.captain && !owned.posts.length && !owned.jobs.length) return "It's the captain's.";
  const words = (owned.words ?? []).filter((one) => !/^(nobody|everyone)$/i.test(one)).map((one) => one.replace(/^the /i, "the "));
  return words.length ? `It belongs to ${both(words)}.` : null;
}

// A container's window says whose it is, when it isn't the player's.
addThingActs((game, thing, level) => {
  const place = game.location;
  if (!lootOf(place, thing)) return null;
  const on = level ?? mapFor(place)?.levels?.[game.walk?.level];
  const owned = containerOwner(place, on, thing);
  if (!owned || isMine(game, place, owned)) return null;
  const words = ownerWords(place, owned);
  return words ? { owner: words, look: `${thing.look ?? thing.name} ${words}` } : null;
});

// A container's thing, by its id, at a place: { level, thing }.
function containerAt(place, id) {
  for (const level of Object.values(mapFor(place)?.levels ?? {})) {
    const thing = level.things.find((one) => one.id === id);
    if (thing) return { level, thing };
  }
  return null;
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
  // What's been taken from a container in a room that isn't the player's, since it was last looked at: a handful from one
  // container is one taking, however many kinds of thing were in it.
  const prefix = `thing:${place}:`;
  const stores = new Set(law.stores.map((store) => store.key));
  const keep = (entry, n) => { game.law = { ...(game.law ?? {}), taken: { ...(game.law?.taken ?? {}), [entry]: n } }; };
  const handfuls = new Map();
  for (const [entry, total] of law.taking ? Object.entries(game.puts ?? {}) : []) {
    if (!entry.startsWith(prefix)) continue;
    const [where, item] = entry.split("|");
    if (stores.has(where)) continue;
    const taken = Math.max(0, -total);
    const before = game.law?.taken?.[entry] ?? 0;
    if (taken === before) continue;
    if (!handfuls.has(where)) {
      const found = containerAt(place, where.slice(prefix.length));
      const loot = found ? lootOf(place, found.thing) : null;
      // A port's store in its rooms is taken from like a container, and is the port's.
      const owned = loot ? containerOwner(place, found.level, found.thing) : found?.thing.portStore ? PORTS_OWN : null;
      handfuls.set(where, owned ? { found, loot, owned, items: [] } : null);
    }
    const handful = handfuls.get(where);
    if (!handful) continue;
    if (isMine(game, place, handful.owned) || taken < before) keep(entry, taken);
    else handful.items.push({ entry, item, taken, more: taken - before });
  }
  for (const [where, handful] of handfuls) {
    if (!handful?.items.length) continue;
    const { found, loot, owned, items } = handful;
    const name = found.thing.name.replace(/^(A|An|The) /, (word) => word.toLowerCase());
    const room = roomOfThing(found.level, found.thing);
    const seen = whoSees(game, place, room);
    if (!seen) {
      for (const one of items) keep(one.entry, one.taken);
      if (!game.law?.told?.[where]) {
        game.law = { ...game.law, told: { ...(game.law.told ?? {}), [where]: true } };
        lines.push(`[LAW] ${found.thing.name} isn't yours: ${ownerWords(place, owned)?.replace(/^It /, "it ") ?? "it's someone else's."} Nobody saw.`);
      }
      continue;
    }
    // Back it goes, as much of it as the player still has, wherever it fits in the container.
    let back = 0;
    for (const one of items) {
      const n = Math.min(one.more, game.inventory?.[one.item] ?? 0);
      if (n > 0) {
        removeItem(game, one.item, n);
        notePut(game, where, one.item, containerPut(game, where, lootBox(loot) ?? { cols: 6, rows: 5 }, one.item, n));
        back += n;
      }
      keep(one.entry, Math.max(0, -putsOf(game, where, one.item)));
    }
    const who = seen.camera ? `The camera in ${mapFor(place).rooms[room]?.name.replace(/^The /, "the ") ?? "the room"}` : seen.name;
    const what = both(items.map((one) => counted(one.item, one.more)));
    const many = items.length > 1 || items[0].more > 1;
    lines.push(`[LAW] ${who} saw you take ${what} from ${name}${back > 0 ? `. ${many ? "They go" : "It goes"} back` : ""}.`);
    if (seen.key && place === SHIP) rememberRequest(game, seen.key, "story", { words: `saw you take from ${name} what wasn't yours`, w: -5 });
    if (commandOf(place)) countForDuty(game, place, "thefts");
    // Ashore, whoever holds the place hears of it.
    const faction = owned.holders ? LOCATIONS[place]?.faction : null;
    if (faction && law.standing) {
      const said = changeStanding(game, faction, -law.standing, `seen taking from ${name} at ${LOCATIONS[place]?.name ?? place}`);
      if (said) lines.push(said);
    }
    const lately = (game.law.caught ?? []).filter((at) => now - at < law.taking.days * 24);
    if (lately.length) {
      const fine = Math.min(law.taking.fine, game.credits ?? 0);
      game.credits -= fine;
      lines.push(place === SHIP ? `[LAW] It's not the first time this week: ${fine} credits are docked.` : `[LAW] It's not the first time this week: you're fined ${fine} credits.`);
    }
    game.law = { ...game.law, caught: [...lately, now] };
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
