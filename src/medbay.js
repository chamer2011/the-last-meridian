// Someone down, and the medics who come for them (health step 4). Whoever can't get up (out cold, with no leg they can
// stand on, too weak from losing blood, or beaten in a fight a little while ago) lies where they fell instead of
// vanishing. At a place whose health file has a medbay the call goes out at once: whoever answers it (a nurse, then a
// spare hand, as the file says, awake, free and with a hand to carry with) walks out to them, picks them up, carries them
// back and lays them on a free cot, or on the medbay's floor when the cots are full, all walked by the life engine as
// the errands are. On a cot they stay until they can get up, and then the cot's free. Someone beaten who can still walk
// makes their own way to the medbay, slowly. The player can pick someone up and carry them, slowly, and put them down,
// on a cot when it's in the medbay. The player knocked out aboard is carried too, and comes to on a cot hours later.
// Anywhere without a medbay, until a later step, someone down comes round where they fell once they can get up.
//
// game.down holds them by the key their body is kept by: { who, place, level, x, y, since, until, why, bed, carriedBy,
// call: { by, phase, since, bed }, going }. who is the key their day knows them by (an id, or a crowd name); bed is a cot
// (a spot in the place's life file) or "@" and the medbay's room for its floor. Reading any of it writes nothing.

import { beatenFor, bleedingOf, cantGetUp, handsFree, keyAt, woundsNow } from "./body.js";
import { findCharacter, fullName } from "./campaign.js";
import { jobByWords, lostReason, onJob } from "./command.js";
import { hasReached, isAbout } from "./life.js";
import { passTime } from "./rules.js";
import { canStand, mapFor, roomsOf, walkCommand } from "./walk.js";
import { WORLD_HEALTH, WORLD_LIFE } from "./world.js";
import { MEDBAY_KEYS } from "../public/health-text.js";

const YOU = "you";
const lower = (text) => String(text ?? "").trim().toLowerCase();
const nowOf = (game) => game.clock?.hours ?? 0;
// A walk's worth of time, as the errands have it: anyone gets there by then, however a jump of the clock is cut up.
const WALK_HOURS = 0.25;
// Someone who got up makes their own way to the medbay for at most this long.
const OWN_WAY_HOURS = 1;

// ---- The medbay, from the place's health file -------------------------------------------------

const medbays = new Map();
export const clearMedbays = () => medbays.clear();

// A place's medbay: its room, its cots, and who answers a call in order (jobs on the watch bill, "spare" for the spare
// hands). Null for a place without one.
export function medbayOf(place) {
  if (medbays.has(place)) return medbays.get(place);
  const file = WORLD_HEALTH[place];
  let found = null;
  if (file?.medbay && file.cots) {
    const map = mapFor(place);
    const room = map ? roomsOf(map).find((one) => one.id === lower(file.medbay) || lower(one.name) === lower(file.medbay) || lower(one.name) === `the ${lower(file.medbay)}`) : null;
    const cots = MEDBAY_KEYS.cots.read(file.cots).spots ?? [];
    const who = file.answers ? MEDBAY_KEYS["who answers a call"].read(file.answers).who ?? [] : [];
    const answers = who.map((words) => (/spare hands?$/i.test(words) ? "spare" : jobByWords(place, words))).filter(Boolean);
    found = { room: room?.id ?? null, cots: cots.filter((spot) => WORLD_LIFE[place]?.spots?.[spot]), answers };
  }
  medbays.set(place, found);
  return found;
}

// What's wrong with a place's medbay lines, for npm run check-story.
export function medbayProblems() {
  const out = [];
  for (const [place, file] of Object.entries(WORLD_HEALTH)) {
    if (!file.medbay && !file.cots && !file.answers) continue;
    const where = `health/${place}.txt`;
    if (!file.medbay || !file.cots) {
      out.push(`${where}: a medbay needs both the medbay and cots lines`);
      continue;
    }
    const medbay = medbayOf(place);
    if (!medbay?.room) out.push(`${where}: the medbay is ${file.medbay}, which isn't a room at ${place}`);
    for (const spot of MEDBAY_KEYS.cots.read(file.cots).spots ?? []) if (!WORLD_LIFE[place]?.spots?.[spot]) out.push(`${where}: the cot ${spot} isn't a spot in world/life/${place}.json`);
    const who = file.answers ? MEDBAY_KEYS["who answers a call"].read(file.answers).who ?? [] : [];
    for (const words of who) if (!/spare hands?$/i.test(words) && !jobByWords(place, words)) out.push(`${where}: who answers a call names ${words}, which isn't a job on the watch bill in world/command/${place}.txt`);
  }
  return out;
}

// The cots someone's day already has them on, like Vik and Hana, laid up for good.
function cotsByDay(place, cots) {
  const life = WORLD_LIFE[place] ?? {};
  const days = [...Object.values(life.people ?? {}), ...(life.crowd ?? []).map((group) => group.day)];
  return new Set(days.flat().map((block) => block?.go).filter((go) => cots.includes(go)));
}
export function freeCot(game, place) {
  const medbay = medbayOf(place);
  if (!medbay) return null;
  const taken = new Set([...cotsByDay(place, medbay.cots), ...Object.values(game.down ?? {}).flatMap((d) => [d.bed, d.call?.bed]).filter(Boolean)]);
  return medbay.cots.find((cot) => !taken.has(cot)) ?? null;
}

// ---- Who's down -------------------------------------------------------------------------------------

export const downAt = (game, place) => Object.entries(game.down ?? {}).filter(([, d]) => d.place === place);
export const isDown = (game, place, who) => Boolean(game.down?.[keyAt(place, who)]);
export const downRecord = (game, place, who) => game.down?.[keyAt(place, who)] ?? null;
const nameOf = (game, d) => {
  const person = findCharacter(game.campaign, d.who);
  return person && !person.crowd ? person.name : d.who;
};
// Their day's state at the place the player's in, as the life engine has it.
const stateOf = (game, place, who) => (place === game.location ? game.life?.places?.[place]?.[who] : null);

// Whether someone has a day at a place, so that the life engine can lay them down where they fell.
export function hasADayAt(place, who) {
  const life = WORLD_LIFE[place];
  if (!life || !who) return false;
  return Boolean(life.people?.[who]) || (life.crowd ?? []).some((group) => group.names.some(([name]) => name === who));
}

// Someone falls where they stand: at a spot, for so many hours at least (a beating), and longer while they can't get up.
export function fallDown(game, { who, place, level, x, y, why, hours = 0 }) {
  const key = keyAt(place, who);
  if (!key || key === YOU || game.down?.[key]) return false;
  game.down ??= {};
  game.down[key] = { who, place, level, x, y, since: nowOf(game), until: nowOf(game) + hours, why };
  const state = stateOf(game, place, who);
  if (state) Object.assign(state, { level, x, y, path: null, goal: { level, x, y }, task: null });
  return true;
}

// Whoever at a place answers a call: the first, in the file's order, who's awake, free, not hurt or down themselves,
// and with a hand to carry with.
function answerer(game, place, medbay, hours) {
  const busy = new Set(Object.values(game.down ?? {}).map((d) => d.call?.by).filter(Boolean));
  for (const job of medbay.answers) {
    for (const key of onJob(game, place, job === "spare" ? null : job)) {
      if (key === YOU || busy.has(key) || isDown(game, place, key) || lostReason(game, place, key)) continue;
      if (!handsFree(game, place, key) || !isAbout(game, place, key, hours)) continue;
      return key;
    }
  }
  return null;
}

// ---- The clock --------------------------------------------------------------------------------------

// Everyone down, over the time just gone: whoever's at the player's place and too weak to stand falls where they are;
// whoever can get up does; at a place with a medbay the call goes out, and whoever answers walks out, picks them up,
// carries them back and lays them on a cot. It returns lines for the story, for what happens where the player is.
export function advanceMedbay(game) {
  const notes = [];
  const now = nowOf(game);
  const here = game.location;
  // The player put someone down by leaving the place with them.
  if (game.carrying && game.down?.[game.carrying]?.place !== here) putDown(game, { quiet: true });
  // Anyone here whose wounds or blood won't let them stand goes down where they are.
  for (const key of Object.keys(game.bodies ?? {})) {
    if (game.down?.[key] || !(key.startsWith(`crowd:${here}:`) || key.startsWith("id:"))) continue;
    const who = whoOf(here, key);
    const state = who ? stateOf(game, here, who) : null;
    const why = state ? cantGetUp(game, key) : null;
    if (why && fallDown(game, { who, place: here, level: state.level, x: state.x, y: state.y, why })) notes.push(`[HEALTH] ${nameOf(game, game.down[key])} goes down, ${why}.`);
  }
  for (const [key, d] of Object.entries(game.down ?? {})) {
    const medbay = medbayOf(d.place);
    // Getting up: once a beating's time is up, nothing keeps them down, and they've stopped bleeding. Someone beaten
    // makes their own way to the medbay, slowly, if there's one and they're hurt; anyone else goes back to their day.
    if (!d.carriedBy && !d.going && now >= (d.until ?? 0) && !cantGetUp(game, key) && !bleedingOf(game, key)) {
      if (medbay?.room && !d.bed && woundsNow(game, key).length) {
        game.down[key] = { ...d, going: true, since: now, call: null };
        if (d.place === here) notes.push(`[HEALTH] ${nameOf(game, d)} gets up, and makes their way to the medbay.`);
      } else {
        delete game.down[key];
        if (d.place === here) notes.push(`[HEALTH] ${nameOf(game, d)} gets up${d.bed ? " and leaves the medbay" : ""}.`);
      }
      continue;
    }
    if (d.going) {
      if (now - d.since >= OWN_WAY_HOURS || hasReached(game, d.place, d.who, `@${medbay?.room}`)) delete game.down[key];
      continue;
    }
    if (d.carriedBy === YOU || d.bed || !medbay?.room) continue;
    if (!d.call) {
      const by = answerer(game, d.place, medbay, now);
      if (!by) continue;
      d.call = { by, phase: "going", since: now, bed: null };
      if (d.place === here) notes.push(`[HEALTH] ${nameOf(game, { who: by })} sets off from the medbay for ${nameOf(game, d)}.`);
    }
    // A call goes on by arrivals, or by a walk's worth of time, as many steps as the time allows.
    for (let step = 0; step < 2 && d.call; step += 1) {
      const due = d.call.since + WALK_HOURS;
      if (d.call.phase === "going") {
        if (now < due && !hasReached(game, d.place, d.call.by, `down:${key}`)) break;
        d.call = { ...d.call, phase: "carrying", since: Math.min(now, due), bed: freeCot(game, d.place) ?? `@${medbay.room}` };
        d.carriedBy = d.call.by;
      } else {
        if (now < due && !hasReached(game, d.place, d.call.by, d.call.bed)) break;
        d.bed = d.call.bed;
        d.carriedBy = null;
        const by = d.call.by;
        d.call = null;
        if (d.place === here) notes.push(`[HEALTH] ${nameOf(game, { who: by })} lays ${nameOf(game, d)} ${d.bed.startsWith("@") ? "on the medbay's floor, the cots all taken" : "on a cot in the medbay"}.`);
      }
    }
  }
  return notes;
}

// The key someone's day knows them by, from their body's key, at a place.
function whoOf(place, key) {
  if (key.startsWith("id:")) return WORLD_LIFE[place]?.people?.[key.slice(3)] ? key.slice(3) : null;
  const name = key.split(":").slice(2).join(":");
  for (const group of WORLD_LIFE[place]?.crowd ?? []) for (const [one] of group.names) if (lower(one) === name) return one;
  return null;
}

// ---- What the life engine does with them --------------------------------------------------------------

// Turns someone's day aside: whoever's down lies where they fell, on their cot or on the medbay's floor; whoever's
// answering a call goes out to them and carries them back; whoever got up makes their way to the medbay. Null when
// nobody's down here.
export function medbayDetour(game, place) {
  const records = downAt(game, place);
  if (!records.length) return null;
  const medbay = medbayOf(place);
  const mine = new Map();
  const helping = new Map();
  for (const [key, d] of records) {
    mine.set(d.who, [key, d]);
    if (d.call) helping.set(d.call.by, [key, d]);
  }
  return (who) => {
    const own = mine.get(who);
    if (own) {
      const [key, d] = own;
      if (d.going) return { where: `@${medbay?.room}`, doing: "making their way to the medbay, slowly" };
      if (d.bed?.startsWith("@")) return { where: d.bed, doing: "lying on the medbay's floor", asleep: true };
      if (d.bed) return { where: d.bed, doing: "laid up on a cot", asleep: true };
      return { where: `down:${key}`, spot: d, exact: true, doing: d.carriedBy ? "being carried to the medbay" : `lying where they fell, ${d.why ?? "down"}`, asleep: true };
    }
    const job = helping.get(who);
    if (job) {
      const [key, d] = job;
      if (d.call.phase === "going") return { where: `down:${key}`, spot: d, doing: `going to help ${nameOf(game, d)}` };
      return { where: d.call.bed, doing: `carrying ${nameOf(game, d)} to the medbay` };
    }
    return null;
  };
}

// Whoever's being carried goes where the one carrying them goes, the player included.
export function followCarriers(game, place, people) {
  for (const [, d] of downAt(game, place)) {
    if (!d.carriedBy || !people[d.who]) continue;
    const from = d.carriedBy === YOU ? (game.walk && !game.walk.room ? { level: game.walk.level, x: game.walk.x, y: game.walk.y } : null) : people[d.carriedBy];
    if (!from) continue;
    Object.assign(people[d.who], { level: from.level, x: from.x, y: from.y, path: null, goal: { level: from.level, x: from.x, y: from.y } });
    Object.assign(d, { level: from.level, x: from.x, y: from.y });
  }
}

// ---- The player carrying someone -----------------------------------------------------------------------

export function carry(game, who) {
  const place = game.location;
  const key = keyAt(place, who);
  const d = game.down?.[key];
  if (!d || d.place !== place) throw new Error("They're not down.");
  if (game.carrying) throw new Error("You're carrying someone already.");
  if (d.going) throw new Error("They're on their feet.");
  game.down[key] = { ...d, carriedBy: YOU, call: null, bed: null };
  game.carrying = key;
  return `[HEALTH] You pick ${nameOf(game, d)} up. It's slow going.`;
}

// Puts whoever the player's carrying down where they stand, or on a free cot in the medbay, or its floor.
export function putDown(game, { quiet = false } = {}) {
  const key = game.carrying;
  const d = key ? game.down?.[key] : null;
  delete game.carrying;
  if (!d) {
    if (quiet) return null;
    throw new Error("You're not carrying anyone.");
  }
  const medbay = medbayOf(d.place);
  const walk = game.walk;
  const inMedbay = medbay?.room && walk && d.place === game.location && !walk.room && mapFor(d.place)?.levels[walk.level]?.roomAt(walk.x, walk.y) === medbay.room;
  const bed = inMedbay ? freeCot(game, d.place) ?? `@${medbay.room}` : null;
  game.down[key] = { ...d, carriedBy: null, call: null, bed, ...(walk && !walk.room && d.place === game.location ? { level: walk.level, x: walk.x, y: walk.y } : {}) };
  const state = stateOf(game, d.place, d.who);
  if (state && !bed) Object.assign(state, { level: game.down[key].level, x: game.down[key].x, y: game.down[key].y, path: null, goal: { level: game.down[key].level, x: game.down[key].x, y: game.down[key].y }, task: null });
  return quiet ? null : `[HEALTH] You put ${nameOf(game, d)} down${bed ? (bed.startsWith("@") ? " on the medbay's floor, the cots all taken" : " on a cot") : ""}.`;
}

// ---- The player knocked out aboard ------------------------------------------------------------------------

// The player lost a fight at a place with a medbay: someone carries them there and they come to on a cot hours later,
// with what they had still on them. Returns the line for the story, or null where nobody comes, as anywhere without a
// medbay, so the old setback stands.
export function wakeInMedbay(game) {
  const place = game.location;
  const medbay = medbayOf(place);
  if (!medbay?.room || !game.walk) return null;
  const by = answerer(game, place, medbay, nowOf(game));
  if (!by) return null;
  const knock = woundsNow(game, YOU).find((wound) => wound.kind === "knock");
  const hours = Math.max(knock ? knock.until - nowOf(game) : 0, beatenFor());
  const notes = passTime(game, hours, "rest");
  walkCommand(game, { action: "room", to: medbay.room });
  const cot = freeCot(game, place);
  const spot = cot ? WORLD_LIFE[place].spots[cot] : null;
  const level = mapFor(place)?.levels[game.walk.level];
  if (spot && level) {
    // Beside the cot, on the floor, so the player can walk away from it.
    const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]].map(([dx, dy]) => ({ x: spot[1] + dx, y: spot[2] + dy })).find((one) => canStand(level, one.x, one.y));
    if (near) Object.assign(game.walk, { x: near.x, y: near.y });
  }
  const whole = Math.round(hours * 10) / 10;
  return [`You come to on a cot in the medbay, ${whole < 2 ? "an hour or so" : `${Math.round(whole)} hours`} later. ${nameOf(game, { who: by })} carried you here.`, ...notes];
}
