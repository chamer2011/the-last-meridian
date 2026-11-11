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

import { addWounds, beatenFor, bleedingOf, cantGetUp, deathOf, fitLimb, mendedByTechs, takeLimb, tooFarGone, handsFree, howBad, hurtAt, keyAt, queueOf, restingFrom, seriousWound, startWounds, treatmentFor, treatWound, waitingTreatment, woundKindNamed, woundsNow } from "./body.js";
import { findCharacter, fullName } from "./campaign.js";
import { calledBy, holderKey, jobByWords, lostReason, onJob, postByWords, speedOf, tallyDuty } from "./command.js";
import { hasReached, isAbout, whoIsIn } from "./life.js";
import { logisticsOf, takeAboard } from "./logistics.js";
import { passTime } from "./rules.js";
import { canStand, mapFor, roomOf, roomsOf, walkCommand } from "./walk.js";
import { doorLocked, roomPowered } from "./systems.js";
import { deathRulesOf, deathsView } from "./death.js";
import { advanceWorkshop, limbFitted, limbReady, waitsInWorkshop, workshopBedFor, workshopOf, workshopProblems } from "./workshop.js";
import { WORLD_HEALTH, WORLD_LIFE } from "./world.js";
import { MEDBAY_KEYS, readTreatmentLine } from "../public/health-text.js";

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
    // Who treats: posts and jobs, as the file names them. The medicine: the store its crates are in, by name, and the
    // doses to a crate. The treatments, by wound.
    const treaters = (file.treaters ? MEDBAY_KEYS["who treats"].read(file.treaters).who ?? [] : []).map((words) => {
      const post = postByWords(place, words.replace(/^(a|an|the) /i, ""));
      if (post) return { post };
      const job = jobByWords(place, words);
      return job ? { job } : null;
    }).filter(Boolean);
    const medicine = file.medicine ? MEDBAY_KEYS.medicine.read(file.medicine) : null;
    const store = medicine && !medicine.problem ? logisticsOf(place)?.stores.find((one) => lower(one.name) === medicine.store) ?? null : null;
    const rest = file.rest ? MEDBAY_KEYS["bed rest"].read(file.rest) : null;
    const treatments = (file.treatments ?? []).map((raw) => readTreatmentLine(raw.text)).filter((one) => !one.problem);
    found = {
      room: room?.id ?? null,
      cots: cots.filter((spot) => WORLD_LIFE[place]?.spots?.[spot]),
      answers,
      treaters,
      medicine: store ? { store: store.id, name: store.name, doses: medicine.doses } : null,
      rest: rest && !rest.problem ? rest.days : 0,
      fitting: file.fitting && !MEDBAY_KEYS["fitting a limb"].read(file.fitting).problem ? MEDBAY_KEYS["fitting a limb"].read(file.fitting) : null,
      treatments,
    };
  }
  medbays.set(place, found);
  return found;
}

// What's wrong with a place's medbay lines, for npm run check-story.
export function medbayProblems() {
  const out = [...workshopProblems(woundKindNamed)];
  for (const [place, file] of Object.entries(WORLD_HEALTH)) {
    if (file.fitting && MEDBAY_KEYS["fitting a limb"].read(file.fitting).problem) out.push(`health/${place}.txt: fitting a limb ${MEDBAY_KEYS["fitting a limb"].read(file.fitting).problem}`);
  }
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
    const treaters = file.treaters ? MEDBAY_KEYS["who treats"].read(file.treaters).who ?? [] : [];
    for (const words of treaters) if (!postByWords(place, words.replace(/^(a|an|the) /i, "")) && !jobByWords(place, words)) out.push(`${where}: who treats names ${words}, which isn't a post or a job in world/command/${place}.txt`);
    if (file.medicine && !medbay?.medicine) out.push(`${where}: the medicine is ${file.medicine}, and it should name one of the stores in world/logistics/${place}.txt`);
    for (const raw of file.treatments ?? []) {
      const line = readTreatmentLine(raw.text);
      if (line.problem) out.push(`${where} (line ${raw.line}): ${line.problem}`);
      else if (!woundKindNamed(line.name)) out.push(`${where} (line ${raw.line}): ${line.name} isn't one of the wounds in world/health/wounds.txt`);
    }
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
// Someone on a cot or the medbay's floor who isn't out cold: awake, and able to talk.
export function awakeInMedbay(game, key) {
  const d = game.down?.[key];
  return Boolean(d?.bed && !d.going && !d.carriedBy && !d.dead && cantGetUp(game, key) !== "out cold");
}
// Where someone with a file is while they're down, for a story waiting on them: null if they aren't down, or are awake
// in the medbay at the player's place; otherwise what they are, for the quest tracker to say why it waits.
export function downForStory(game, id) {
  const key = `id:${id}`;
  const d = game.down?.[key];
  if (!d || d.going) return null;
  if (d.bed && d.place === game.location && awakeInMedbay(game, key)) return null;
  if (d.bed) return d.place === game.location ? "out cold in the medbay" : "laid up in the medbay";
  return d.carriedBy ? "being carried to the medbay" : `down, ${d.why ?? "hurt"}`;
}
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
  // Awake first; and when nobody who could answer is awake, the call wakes the first of them who's asleep.
  for (const woken of [false, true]) {
    for (const job of medbay.answers) {
      for (const key of onJob(game, place, job === "spare" ? null : job)) {
        if (key === YOU || busy.has(key) || isDown(game, place, key) || lostReason(game, place, key)) continue;
        if (!handsFree(game, place, key) || (!woken && !isAbout(game, place, key, hours))) continue;
        return { key, woken };
      }
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
  // Anyone whose wounds or blood won't let them stand goes down where they are: here, where they're seen, and at any
  // other place with a medbay, where nobody sees it but the medics still come.
  for (const [key, held] of Object.entries(game.bodies ?? {})) {
    if (game.down?.[key] || held.died || deathOf(game, key)) continue;
    const place = dayPlaceOf(key, here);
    const who = place ? whoOf(place, key) : null;
    const why = who ? cantGetUp(game, key) : null;
    if (!why) continue;
    if (place === here) {
      const state = stateOf(game, here, who);
      if (state && fallDown(game, { who, place, level: state.level, x: state.x, y: state.y, why })) notes.push(`[HEALTH] ${nameOf(game, game.down[key])} goes down, ${why}.`);
    } else if (medbayOf(place)?.room) fallDown(game, { who, place, level: null, x: 0, y: 0, why });
  }
  for (const [key, d] of Object.entries(game.down ?? {})) {
    const medbay = medbayOf(d.place);
    // The dead lie under a blanket until someone carries them to where the dead are laid out.
    if (d.dead) {
      notes.push(...carryAway(game, key, d, medbay, now));
      continue;
    }
    // Getting up: once a beating's time is up, nothing keeps them down, and they've stopped bleeding. Someone beaten
    // makes their own way to the medbay, slowly, if there's one and they're hurt; anyone else goes back to their day.
    if (!d.carriedBy && !d.going && now >= (d.until ?? 0) && !cantGetUp(game, key) && !bleedingOf(game, key) && !keptIn(game, key, d, medbay)) {
      if (medbay?.room && !d.bed && woundsNow(game, key).length) {
        const to = workshopBedFor(game, d.place, key)?.slice(1) ?? medbay.room;
        game.down[key] = { ...d, going: true, since: now, call: null, to };
        if (d.place === here) notes.push(`[HEALTH] ${nameOf(game, d)} gets up, and makes their way to ${to === medbay.room ? "the medbay" : roomNameOf(d.place, to)}.`);
      } else {
        delete game.down[key];
        if (d.place === here) notes.push(`[HEALTH] ${nameOf(game, d)} gets up${d.bed ? " and leaves the medbay" : ""}.`);
      }
      continue;
    }
    if (d.going) {
      if (now - d.since >= OWN_WAY_HOURS || hasReached(game, d.place, d.who, `@${d.to ?? medbay?.room}`)) delete game.down[key];
      continue;
    }
    if (d.carriedBy === YOU || d.bed || !medbay?.room) continue;
    // A locked door between the medbay and them keeps the medics out, and whoever set off turns back.
    const shut = shutOut(game, d, medbay.room);
    if (shut) {
      if (d.call && d.call.phase === "going") {
        if (d.place === here) notes.push(`[HEALTH] ${nameOf(game, { who: d.call.by })} can't get through to ${nameOf(game, d)}: ${shut}.`);
        d.call = null;
        d.shutSaid = true;
      }
      if (!d.call && !d.shutSaid) {
        d.shutSaid = true;
        if (d.place === here) notes.push(`[HEALTH] Nobody comes for ${nameOf(game, d)}: ${shut}.`);
      }
      if (!d.call) continue;
    }
    d.shutSaid = false;
    if (!d.call) {
      const found = answerer(game, d.place, medbay, now);
      if (!found) continue;
      d.call = { by: found.key, phase: "going", since: now, bed: null };
      if (d.place === here) notes.push(`[HEALTH] ${found.woken ? `The call wakes ${nameOf(game, { who: found.key })}, who` : nameOf(game, { who: found.key })} sets off from the medbay for ${nameOf(game, d)}.`);
    }
    // A call goes on by arrivals, or by a walk's worth of time, as many steps as the time allows.
    for (let step = 0; step < 2 && d.call; step += 1) {
      const due = d.call.since + WALK_HOURS;
      if (d.call.phase === "going") {
        if (now < due && !hasReached(game, d.place, d.call.by, `down:${key}`)) break;
        d.call = { ...d.call, phase: "carrying", since: Math.min(now, due), bed: workshopBedFor(game, d.place, key) ?? freeCot(game, d.place) ?? `@${medbay.room}` };
        d.carriedBy = d.call.by;
        if (d.call.since - d.since > LATE_HOURS) tallyDuty(game, d.place, Math.floor(d.call.since / 24), { lateCalls: 1 });
      } else {
        if (shut || (now < due && !hasReached(game, d.place, d.call.by, d.call.bed))) break;
        d.bed = d.call.bed;
        d.carriedBy = null;
        const by = d.call.by;
        d.call = null;
        if (d.place === here) notes.push(`[HEALTH] ${nameOf(game, { who: by })} lays ${nameOf(game, d)} ${d.bed === `@${medbay.room}` ? "on the medbay's floor, the cots all taken" : d.bed.startsWith("@") ? `on the bench in ${roomNameOf(d.place, d.bed.slice(1))}` : "on a cot in the medbay"}.`);
      }
    }
  }
  // In each medbay, whoever's waiting on the floor moves to a cot that's come free, the worst first, and the medics
  // treat their patients.
  for (const place of new Set([...Object.values(game.down ?? {}).map((d) => d.place), here])) {
    const medbay = medbayOf(place);
    if (!medbay?.room) continue;
    const floor = downAt(game, place).filter(([, d]) => d.bed === `@${medbay.room}` && !d.going && !d.dead).sort(([a], [b]) => howBad(game, b) - howBad(game, a));
    for (const [key, d] of floor) {
      const cot = freeCot(game, place);
      if (!cot) break;
      game.down[key] = { ...d, bed: cot };
      if (place === here) notes.push(`[HEALTH] ${nameOf(game, d)} is moved from the floor to a cot.`);
    }
    notes.push(...treatOnClock(game, place, medbay, now));
    if (workshopOf(place)?.room) notes.push(...advanceWorkshop(game, place, now));
  }
  return notes;
}

// The place someone's day is at, from their body key: a crowd key's own place, or for someone with a file, here if
// they have a day here, else the first place with a medbay that has them. Null when there's none.
function dayPlaceOf(key, here) {
  if (key.startsWith("crowd:")) return key.split(":")[1];
  if (!key.startsWith("id:")) return null;
  const id = key.slice(3);
  if (WORLD_LIFE[here]?.people?.[id]) return here;
  return Object.keys(WORLD_HEALTH).find((place) => WORLD_HEALTH[place].medbay && WORLD_LIFE[place]?.people?.[id]) ?? null;
}

// Why the medics can't get to someone, or null: the medbay's door is locked, or the door of the room they're lying in.
function shutOut(game, d, medbayRoom) {
  const room = d.bed ? medbayRoom : d.level ? mapFor(d.place)?.levels[d.level]?.roomAt(d.x, d.y) : null;
  // Someone in the medbay itself can be reached from inside it.
  if (room === medbayRoom) return null;
  if (doorLocked(game, d.place, medbayRoom)) return "the medbay's door is locked";
  if (room && room !== medbayRoom && doorLocked(game, d.place, room)) return `the door to ${roomNameOf(d.place, room)} is locked`;
  return null;
}
const roomNameOf = (place, room) => (roomsOf(mapFor(place)).find((one) => one.id === room)?.name ?? room).replace(/^The /, "the ");

// Someone who died lying down is carried, by whoever answers a call as for the living, to the room the health file lays
// the dead out in, and is gone once they're there. With no such room, they're taken away at once.
function carryAway(game, key, d, medbay, now) {
  const notes = [];
  const here = d.place === game.location;
  const room = deathRulesOf(d.place)?.room ?? null;
  if (d.carriedBy === YOU) return notes;
  if (!room || !medbay) {
    delete game.down[key];
    return notes;
  }
  const to = `@${room}`;
  // Out of the medbay through its door, or in to them past theirs, and in to where the dead are laid out.
  const shut = (d.bed && doorLocked(game, d.place, medbay.room) ? "the medbay's door is locked" : shutOut(game, d, medbay.room)) ?? (doorLocked(game, d.place, room) ? `the door to ${roomNameOf(d.place, room)} is locked` : null);
  if (!d.call) {
    if (shut) return notes;
    const found = answerer(game, d.place, medbay, now);
    if (!found) return notes;
    d.call = { by: found.key, phase: "going", since: now, bed: to };
    if (here) notes.push(`[HEALTH] ${nameOf(game, { who: found.key })} comes for ${nameOf(game, d)}'s body.`);
  }
  for (let step = 0; step < 2 && d.call; step += 1) {
    const due = d.call.since + WALK_HOURS;
    if (d.call.phase === "going") {
      if (now < due && !hasReached(game, d.place, d.call.by, `down:${key}`)) break;
      d.call = { ...d.call, phase: "carrying", since: Math.min(now, due) };
      d.carriedBy = d.call.by;
      d.bed = null;
    } else {
      if (shut || (now < due && !hasReached(game, d.place, d.call.by, to))) break;
      const by = d.call.by;
      delete game.down[key];
      if (here) notes.push(`[HEALTH] ${nameOf(game, { who: by })} lays ${nameOf(game, d)} out in ${roomNameOf(d.place, room)}, under a sheet.`);
      break;
    }
  }
  return notes;
}

// Someone on a cot stays while a wound waits for the medbay's treatment, or for the bed rest after a serious one.
function keptIn(game, key, d, medbay) {
  if (!d.bed || !medbay) return false;
  if (d.bed.startsWith("@") && d.bed !== `@${medbay.room}`) return waitsInWorkshop(game, d.place, key);
  if (medbay.treatments.length && medbay.medicine && waitingTreatment(game, key, medbay.treatments).length) return true;
  return medbay.rest > 0 && restingFrom(game, key, medbay.rest);
}

// ---- Treatment ---------------------------------------------------------------------------------------

// A call answered more than this long after someone fell counts as late, against the chief medical officer's duty.
const LATE_HOURS = 0.5;
// A patient left this long with nobody treating them counts as left waiting.
const WAIT_GRACE = 1;

// The medbay's own state in the save: when it was last run, the doses left in the crate that's open, who's being
// treated now, and the last few treatments, for the Ship menu.
const stateFor = (game, place) => ((game.medbay ??= {})[place] ??= { at: null, doses: 0, treating: {}, log: [] });
// Whether the player's standing in a place's medbay.
function playerIn(game, place, medbay) {
  const walk = game.walk;
  return game.location === place && Boolean(walk) && !walk.room && mapFor(place)?.levels[walk.level]?.roomAt(walk.x, walk.y) === medbay.room;
}
// Who's waiting in the morning queue at a moment: whoever's hurt, on their feet and about, in the queue's hours, from a
// walk's worth of time after it opens or after they were hurt, whichever is later; and nobody while its door is locked.
// It goes by the clock alone, so it comes out the same however the time is cut up.
function queueAt(game, place, medbay, hours) {
  const queue = queueOf(place);
  if (!queue || doorLocked(game, place, medbay.room)) return [];
  const opens = Math.floor(hours / 24) * 24 + queue.from / 60;
  const arrived = (who) => hours >= Math.max(opens, ...woundsNow(game, keyAt(place, who)).map((wound) => wound.at)) + WALK_HOURS;
  const minute = (((hours % 24) + 24) % 24) * 60;
  if (minute < queue.from || minute >= queue.to) return [];
  return [...hurtAt(game, place)].filter((who) => isAbout(game, place, who, hours) && arrived(who)).map((who) => keyAt(place, who)).filter((key) => key && !game.down?.[key] && !mendedByTechs(game, key));
}
// Who's on the medbay's cots and floor at a place, by body key, then whoever's in the morning queue, and the player
// while they're standing in the medbay.
function patientsAt(game, place, medbay, hours = nowOf(game)) {
  const keys = [...downAt(game, place).filter(([, d]) => d.bed && !d.going && !d.dead && (!d.bed.startsWith("@") || d.bed === `@${medbay.room}`)).map(([key]) => key), ...queueAt(game, place, medbay, hours)];
  return playerIn(game, place, medbay) ? [...keys, YOU] : keys;
}
// The medics at work in the medbay at a moment: whoever holds a treating post or does a treating job, there by their
// day, and not out on a call or down themselves.
function medicsAt(game, place, medbay, hours) {
  const there = new Set(whoIsIn(game, place, medbay.room, hours));
  const busy = new Set(Object.values(game.down ?? {}).map((d) => d.call?.by).filter(Boolean));
  const keys = medbay.treaters.flatMap((one) => (one.post ? [holderKey(game, place, one.post)] : onJob(game, place, one.job)));
  return [...new Set(keys)].filter((key) => key && key !== YOU && there.has(key) && !busy.has(key) && !isDown(game, place, key) && !lostReason(game, place, key));
}
// Doses from the open crate, opening another from the medicine's store when it runs out. False when there aren't enough.
function takeDoses(game, place, medbay, state, n) {
  while (state.doses < n) {
    if (takeAboard(game, place, "medicine_crate", 1, [medbay.medicine.store]) < 1) return false;
    state.doses += medbay.medicine.doses;
  }
  state.doses -= n;
  return true;
}
// A medic as the ship calls them: by their post (Dr. Aduro), else their title or name.
const medicName = (game, place, key) => { const name = calledBy(game, place, key); return name.charAt(0).toUpperCase() + name.slice(1); };
const whose = (game, key) => (key === YOU ? "your" : `${nameOf(game, { who: whoOf(game.down?.[key]?.place ?? game.location, key) ?? key })}'s`);
const woundOf = (game, key, job) => (key === YOU ? game.wounds : game.bodies?.[key]?.wounds)?.find((wound) => wound.part === job.part && wound.kind === job.kind && wound.at === job.at && !wound.dressed) ?? null;

// The medbay over the time since it was last run, step by step: each treatment ends when its time is up, and a free
// medic starts on the worst patient still waiting, with the doses it takes, faster the better their Medicine. Lines for
// the story while the player's in the medbay or on its cot.
function treatOnClock(game, place, medbay, now) {
  const notes = [];
  if (!medbay.treatments.length || !medbay.medicine) return notes;
  const state = stateFor(game, place);
  const from = state.at === null ? now : Math.min(state.at, now);
  let t = from;
  if (state.treating[YOU] && !playerIn(game, place, medbay)) {
    state.doses += state.treating[YOU].doses ?? 0;
    delete state.treating[YOU];
  }
  for (let step = 0; step < 400; step += 1) {
    for (const [key, job] of Object.entries(state.treating)) {
      if (job.until > t) continue;
      delete state.treating[key];
      if (job.fit) {
        const words = limbReady(game, place, key) === job.part ? fitLimb(game, key, job.part, job.until) : null;
        if (!words) {
          state.doses += job.doses ?? 0;
          continue;
        }
        limbFitted(game, place, key);
        const line = `${medicName(game, place, job.by)} fits ${whose(game, key)} ${words.replace(/^(an?|the) /, "")}`;
        state.log = [...(state.log ?? []), { day: Math.floor(job.until / 24), line }].slice(-8);
        if (place === game.location && (playerIn(game, place, medbay) || key === YOU)) notes.push(`[HEALTH] ${line}. It works nearly as well.`);
        continue;
      }
      const wound = woundOf(game, key, job);
      // Dressed meanwhile by its owner, or healed: the doses go back in the crate.
      if (!wound) {
        state.doses += job.doses ?? 0;
        continue;
      }
      // A wound gone bad on a limb, and left too long, takes the limb with it.
      if (tooFarGone(wound, job.until)) {
        const lost = takeLimb(game, key, wound.part, job.until);
        const line = `${medicName(game, place, job.by)} takes ${whose(game, key)} ${lost.replace(/^the /, "").replace(/ is gone$/, "")}: the wound had gone too far`;
        state.log = [...(state.log ?? []), { day: Math.floor(job.until / 24), line }].slice(-8);
        if (place === game.location && (playerIn(game, place, medbay) || key === YOU)) notes.push(`[HEALTH] ${line}.`);
        continue;
      }
      const word = treatWound(game, key, wound, job.until);
      const line = wound.kind === "lost"
        ? `${medicName(game, place, job.by)} dresses the stump of ${whose(game, key)} ${wound.part.replace("_", " ")}`
        : `${medicName(game, place, job.by)} ${word === "splinted" ? "splints" : "dresses"} ${whose(game, key)} ${wound.words.replace(/^(an?|the) /, "").replace(/ has gone bad$/, " gone bad")}`;
      state.log = [...(state.log ?? []), { day: Math.floor(job.until / 24), line }].slice(-8);
      if (place === game.location && (playerIn(game, place, medbay) || key === YOU)) notes.push(`[HEALTH] ${line}.`);
    }
    const dark = !roomPowered(game, place, medbay.room);
    if (dark && !state.dark && place === game.location && playerIn(game, place, medbay)) notes.push("[HEALTH] The medbay has no power. Nobody can be treated until it comes back.");
    state.dark = dark;
    const free = dark ? [] : medicsAt(game, place, medbay, t).filter((key) => !Object.values(state.treating).some((job) => job.by === key));
    const patients = patientsAt(game, place, medbay, t).filter((key) => !state.treating[key]);
    const waiting = patients.filter((key) => waitingTreatment(game, key, medbay.treatments).length).sort((a, b) => howBad(game, b) - howBad(game, a));
    const fitting = medbay.fitting ? patients.filter((key) => !waiting.includes(key) && limbReady(game, place, key)) : [];
    for (const key of fitting) {
      if (!free.length) break;
      if (!takeDoses(game, place, medbay, state, medbay.fitting.doses)) break;
      const medic = free.shift();
      const minutes = medbay.fitting.minutes / speedOf(game, place, [medic], "medicine");
      state.treating[key] = { by: medic, fit: true, part: limbReady(game, place, key), doses: medbay.fitting.doses, since: t, until: t + minutes / 60 };
      if (key === YOU && place === game.location) notes.push(`[HEALTH] ${medicName(game, place, medic)} starts fitting your new limb.`);
    }
    for (const key of waiting) {
      if (!free.length) break;
      const wound = waitingTreatment(game, key, medbay.treatments)[0];
      const treatment = treatmentFor(wound, medbay.treatments);
      if (!treatment) continue;
      if (!takeDoses(game, place, medbay, state, treatment.doses)) {
        if (!state.short) {
          state.short = true;
          if (place === game.location && playerIn(game, place, medbay)) notes.push(`[HEALTH] The medicine cabinet is empty. ${medicName(game, place, free[0])} can't treat anyone until a crate is brought.`);
        }
        break;
      }
      state.short = false;
      const medic = free.shift();
      const minutes = treatment.minutes / speedOf(game, place, [medic], "medicine");
      state.treating[key] = { by: medic, part: wound.part, kind: wound.kind, at: wound.at, doses: treatment.doses, since: t, until: t + minutes / 60 };
      if (key === YOU && place === game.location) notes.push(`[HEALTH] ${medicName(game, place, medic)} sees to your ${wound.words.replace(/^(an?|the) /, "")}.`);
    }
    const next = Math.min(Infinity, ...Object.values(state.treating).map((job) => job.until));
    if (next > now) break;
    t = Math.max(t, next);
  }
  // Patients left waiting past their first hour, with nobody treating them, count against the chief medical officer.
  const gone = now - from;
  if (gone > 0) {
    const left = patientsAt(game, place, medbay).filter((key) => key !== YOU && !state.treating[key] && waitingTreatment(game, key, medbay.treatments).length && now - (game.down?.[key]?.since ?? now) > WAIT_GRACE).length;
    if (left) tallyDuty(game, place, Math.floor(now / 24), { patientHours: left * gone });
  }
  state.at = now;
  return notes;
}

// The wounds the places' health files start people with become kept wounds when a game begins, so they heal, and
// anyone with a serious one starts laid up on a free cot in the place's medbay: Vik and Hana, aboard the Meridian.
export function startHealth(game) {
  if (game.healthStarted) return;
  game.healthStarted = true;
  const laidUp = new Map();
  for (const one of startWounds()) {
    addWounds(game, one.key, [one.wound]);
    if (seriousWound(one.wound)) laidUp.set(one.key, one);
  }
  for (const [key, one] of laidUp) {
    const medbay = medbayOf(one.place);
    const who = whoOf(one.place, key);
    if (!medbay?.room || !who || game.down?.[key]) continue;
    const cot = freeCot(game, one.place);
    const spot = cot ? WORLD_LIFE[one.place].spots[cot] : null;
    game.down ??= {};
    game.down[key] = { who, place: one.place, level: spot ? roomOf(mapFor(one.place), spot[0])?.levelId ?? spot[0] : null, x: spot?.[1] ?? 0, y: spot?.[2] ?? 0, since: nowOf(game), until: nowOf(game), why: "laid up", bed: cot ?? `@${medbay.room}` };
  }
}

// ---- The medbay on the Ship menu ----------------------------------------------------------------------------

// Who's on each cot and the floor, for what and for how long; who's treating whom; the medicine; and the last
// treatments. Null at a place without a medbay. Reading it writes nothing.
export function medbayView(game, place) {
  const medbay = medbayOf(place);
  if (!medbay?.room) return null;
  const state = game.medbay?.[place] ?? { doses: 0, treating: {}, log: [] };
  const now = nowOf(game);
  const patient = ([key, d]) => {
    if (d.dead) return { who: nameOf(game, d), worst: game.dead?.[key]?.cause ?? "dead", since: "", state: "dead, waiting to be carried out" };
    const waiting = waitingTreatment(game, key, medbay.treatments);
    const worst = waiting[0] ?? [...woundsNow(game, key)].sort((a, b) => (seriousWound(b) ? 1 : 0) - (seriousWound(a) ? 1 : 0))[0];
    const job = state.treating?.[key];
    const hours = now - d.since;
    return {
      who: nameOf(game, d),
      worst: worst?.words ?? "resting",
      since: hours < 1 ? "just brought in" : hours < 24 ? `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? "" : "s"}` : `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? "" : "s"}`,
      state: job ? `being treated by ${medicName(game, place, job.by)}` : waiting.length ? `waiting for treatment (${waiting.length})` : restingFrom(game, key, medbay.rest) ? "resting" : "getting up soon",
    };
  };
  const here = downAt(game, place).filter(([, d]) => d.bed && !d.going);
  return {
    cots: medbay.cots.map((cot) => {
      const on = here.find(([, d]) => d.bed === cot);
      return on ? patient(on) : null;
    }),
    floor: here.filter(([, d]) => d.bed === `@${medbay.room}`).sort(([a], [b]) => howBad(game, b) - howBad(game, a)).map(patient),
    medicine: medbay.medicine ? { store: medbay.medicine.name, doses: state.doses ?? 0, perCrate: medbay.medicine.doses, short: Boolean(state.short) } : null,
    log: (state.log ?? []).map((one) => `Day ${one.day + 1}: ${one.line}`).reverse(),
    dead: deathsView(game, place),
  };
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
      if (d.going) return { where: `@${d.to ?? medbay?.room}`, doing: d.to && d.to !== medbay?.room ? `making their way to ${roomNameOf(place, d.to)}, slowly` : "making their way to the medbay, slowly" };
      if (d.dead && d.carriedBy) return { where: d.call?.bed ?? `down:${key}`, spot: d, exact: true, doing: "dead, being carried away", asleep: true };
      if (d.dead) return { where: d.bed ?? `down:${key}`, spot: d.bed ? undefined : d, exact: !d.bed, doing: "dead, under a blanket", asleep: true };
      if (d.bed?.startsWith("@") && d.bed !== `@${medbay?.room}`) return { where: d.bed, doing: `lying on the bench in ${roomNameOf(place, d.bed.slice(1))}`, asleep: !awakeInMedbay(game, key) };
      if (d.bed?.startsWith("@")) return { where: d.bed, doing: "lying on the medbay's floor", asleep: !awakeInMedbay(game, key) };
      if (d.bed) return { where: d.bed, doing: "laid up on a cot", asleep: !awakeInMedbay(game, key) };
      return { where: `down:${key}`, spot: d, exact: true, doing: d.carriedBy ? "being carried to the medbay" : `lying where they fell, ${d.why ?? "down"}`, asleep: true };
    }
    const job = helping.get(who);
    if (job) {
      const [key, d] = job;
      if (d.call.phase === "going") return { where: `down:${key}`, spot: d, doing: d.dead ? `going for ${nameOf(game, d)}'s body` : `going to help ${nameOf(game, d)}` };
      return { where: d.call.bed, doing: d.dead ? `carrying ${nameOf(game, d)}'s body away` : `carrying ${nameOf(game, d)} to the medbay` };
    }
    return null;
  };
}

// Where someone down lies: on their cot, on the medbay's floor, or where they fell. Null when there's no telling.
function lyingAt(place, d) {
  const map = mapFor(place);
  if (!map) return null;
  if (d.bed && !d.bed.startsWith("@")) {
    const spot = WORLD_LIFE[place]?.spots?.[d.bed];
    return spot ? { level: roomOf(map, spot[0])?.levelId ?? spot[0], x: spot[1], y: spot[2] } : null;
  }
  if (d.bed) {
    const room = roomOf(map, d.bed.slice(1));
    return room?.start ? { level: room.levelId, x: room.start.x, y: room.start.y } : null;
  }
  return map.levels[d.level] ? { level: d.level, x: d.x, y: d.y } : null;
}
// Everyone at a place as their days would first put them, with whoever's down already lying where they are, so that a
// game begins with Vik and Hana on their cots instead of walking there. It returns a new set and changes nothing given.
export function laidWhereTheyAre(game, place, people) {
  const records = downAt(game, place).filter(([, d]) => !d.going && !d.carriedBy && people[d.who]);
  if (!records.length) return people;
  const out = { ...people };
  for (const [, d] of records) {
    const at = lyingAt(place, d);
    if (at) out[d.who] = { ...people[d.who], level: at.level, x: at.x, y: at.y, goal: { ...at }, path: null };
  }
  return out;
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
  const by = answerer(game, place, medbay, nowOf(game))?.key;
  if (!by) return null;
  const knock = woundsNow(game, YOU).find((wound) => wound.kind === "knock");
  const hours = Math.max(knock ? knock.until - nowOf(game) : 0, beatenFor());
  walkCommand(game, { action: "room", to: medbay.room });
  const cot = freeCot(game, place);
  const spot = cot ? WORLD_LIFE[place].spots[cot] : null;
  const level = mapFor(place)?.levels[game.walk.level];
  if (spot && level) {
    // Beside the cot, on the floor, so the player can walk away from it.
    const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]].map(([dx, dy]) => ({ x: spot[1] + dx, y: spot[2] + dy })).find((one) => canStand(level, one.x, one.y));
    if (near) Object.assign(game.walk, { x: near.x, y: near.y });
  }
  const notes = passTime(game, hours, "rest");
  const whole = Math.round(hours * 10) / 10;
  return [`You come to on a cot in the medbay, ${whole < 2 ? "an hour or so" : `${Math.round(whole)} hours`} later. ${nameOf(game, { who: by })} carried you here.`, ...notes];
}
