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

import { addWounds, beatenFor, bleedingOf, cantGetUp, deathOf, fitLimb, mendedByTechs, takeLimb, tooFarGone, handsFree, howBad, hurtAt, keyAt, nameOfKey, queueOf, restingFrom, seriousWound, startWounds, treatmentFor, treatWound, waitingTreatment, woundKindNamed, woundsNow } from "./body.js";
import { findCharacter, fullName } from "./campaign.js";
import { calledBy, deposedStart, holderKey, jobByWords, lostReason, onJob, postByWords, speedOf, tallyDuty } from "./command.js";
import { hasReached, isAbout, whoIsIn } from "./life.js";
import { logisticsOf, takeAboard } from "./logistics.js";
import { storeCounts, storeTake } from "./bag.js";
import { worthIn, worthOf } from "./worth.js";
import { passTime } from "./rules.js";
import { canStand, mapFor, roomOf, roomsOf, walkCommand, walkOf } from "./walk.js";
import { doorLocked, roomPowered } from "./systems.js";
import { deathRulesOf, deathsView } from "./death.js";
import { roundsView } from "./register.js";
import { advanceWorkshop, limbFitted, limbReady, waitsInWorkshop, workshopBedFor, workshopOf, workshopProblems } from "./workshop.js";
import { addMark } from "./wear.js";
import { WORLD_CHARACTERS, WORLD_HEALTH, WORLD_LIFE } from "./world.js";
import { LOCATIONS } from "./data.js";
import { noneLeft, tradedAt } from "./daily.js";
import { isCaptain, startOf } from "./role.js";
import { MEDBAY_KEYS, readTreatmentLine } from "../public/health-text.js";
import { boardRuns, busyOnBoard, callHand } from "./work.js";

const YOU = "you";
const SHIP = "meridian";
const lower = (text) => String(text ?? "").trim().toLowerCase();
const nowOf = (game) => game.clock?.hours ?? 0;
// A walk's worth of time, as the errands have it: anyone gets there by then, however a jump of the clock is cut up.
const WALK_HOURS = 0.25;
// Someone who got up makes their own way to the medbay for at most this long.
const OWN_WAY_HOURS = 1;

// ---- The medbay, from the place's health file -------------------------------------------------

const medbays = new Map();
export const clearMedbays = () => medbays.clear();

// Someone in a place's life file by their id, a name their file gives them, or their crowd name: the key the life
// engine knows them by. For a place without a chain of command, whose medics are named one by one (step 10).
const plainOf = (words) => lower(words).replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
export function personAt(place, words) {
  const want = plainOf(words);
  const life = WORLD_LIFE[place] ?? {};
  for (const id of Object.keys(life.people ?? {})) {
    const file = WORLD_CHARACTERS[id];
    const names = [id, file?.name, file?.title && file?.name ? `${file.title} ${file.name}` : null, ...(file?.aliases ?? [])].filter(Boolean).map(plainOf);
    if (names.includes(want)) return id;
  }
  for (const group of life.crowd ?? []) for (const [name] of group.names) if (plainOf(name) === want) return name;
  return null;
}
// What the lines call a place's medbay: the medbay, aboard the Meridian; anywhere else, the room's own name, the Long
// Ward. And the same at the start of a line.
export const medbayCalled = (place) => (place === SHIP || !medbayOf(place)?.room ? "the medbay" : roomNameOf(place, medbayOf(place).room));
const MedbayCalled = (place) => { const words = medbayCalled(place); return words.charAt(0).toUpperCase() + words.slice(1); };
// A place's medicine that isn't kept in its stores: the place's own, from what the port has (step 10).
const ownMedicine = (medicine) => Boolean(medicine && !medicine.problem && /^(the )?place['’]?s own$/i.test(medicine.store));

// A place's medbay: its room, its cots, and who answers a call in order (jobs on the watch bill, "spare" for the spare
// hands, or someone by name). Null for a place without one.
export function medbayOf(place) {
  if (medbays.has(place)) return medbays.get(place);
  const file = WORLD_HEALTH[place];
  let found = null;
  if (file?.medbay && file.cots) {
    const map = mapFor(place);
    const room = map ? roomsOf(map).find((one) => one.id === lower(file.medbay) || lower(one.name) === lower(file.medbay) || lower(one.name) === `the ${lower(file.medbay)}`) : null;
    const cots = MEDBAY_KEYS.cots.read(file.cots).spots ?? [];
    const who = file.answers ? MEDBAY_KEYS["who answers a call"].read(file.answers).who ?? [] : [];
    const answers = who.map((words) => (/spare hands?$/i.test(words) ? "spare" : jobByWords(place, words) ?? (personAt(place, words) ? { who: personAt(place, words) } : null))).filter(Boolean);
    // Who treats: posts and jobs, as the file names them. The medicine: the store its crates are in, by name, and the
    // doses to a crate. The treatments, by wound.
    const treaters = (file.treaters ? MEDBAY_KEYS["who treats"].read(file.treaters).who ?? [] : []).map((words) => {
      const post = postByWords(place, words.replace(/^(a|an|the) /i, ""));
      if (post) return { post };
      const job = jobByWords(place, words);
      if (job) return { job };
      const named = personAt(place, words);
      return named ? { who: named } : null;
    }).filter(Boolean);
    const medicine = file.medicine ? MEDBAY_KEYS.medicine.read(file.medicine) : null;
    const store = medicine && !medicine.problem ? logisticsOf(place)?.stores.find((one) => lower(one.name) === medicine.store) ?? null : null;
    const rest = file.rest ? MEDBAY_KEYS["bed rest"].read(file.rest) : null;
    const treatments = (file.treatments ?? []).map((raw) => readTreatmentLine(raw.text)).filter((one) => !one.problem);
    // What the player pays for each dose they're given, at a place that charges: nothing aboard the Meridian.
    const pays = file.pays ? MEDBAY_KEYS["you pay"].read(file.pays) : null;
    found = {
      room: room?.id ?? null,
      cots: cots.filter((spot) => WORLD_LIFE[place]?.spots?.[spot]),
      answers,
      treaters,
      medicine: store ? { store: store.id, name: store.name, doses: medicine.doses } : ownMedicine(medicine) ? { own: true, name: "the place's own stores", doses: medicine.doses } : null,
      perDose: pays && !pays.problem ? pays.perDose : 0,
      rest: rest && !rest.problem ? rest.days : 0,
      fitting: file.fitting && !MEDBAY_KEYS["fitting a limb"].read(file.fitting).problem ? MEDBAY_KEYS["fitting a limb"].read(file.fitting) : null,
      treatments,
      // The doses the doctor's rounds give a serious illness, once a day (step 8): 1 if the file doesn't say.
      rounds: file.rounds && !MEDBAY_KEYS["the doctor's rounds"].read(file.rounds).problem ? MEDBAY_KEYS["the doctor's rounds"].read(file.rounds).doses : 1,
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
    for (const words of who) if (!/spare hands?$/i.test(words) && !jobByWords(place, words) && !personAt(place, words)) out.push(`${where}: who answers a call names ${words}, which isn't a job on the watch bill in world/command/${place}.txt or someone in world/life/${place}.json`);
    const treaters = file.treaters ? MEDBAY_KEYS["who treats"].read(file.treaters).who ?? [] : [];
    for (const words of treaters) if (!postByWords(place, words.replace(/^(a|an|the) /i, "")) && !jobByWords(place, words) && !personAt(place, words)) out.push(`${where}: who treats names ${words}, which isn't a post or a job in world/command/${place}.txt or someone in world/life/${place}.json`);
    if (file.medicine && !medbay?.medicine) out.push(`${where}: the medicine is ${file.medicine}, and it should name one of the stores in world/logistics/${place}.txt, or say the place's own`);
    if (file.pays && MEDBAY_KEYS["you pay"].read(file.pays).problem) out.push(`${where}: you pay ${MEDBAY_KEYS["you pay"].read(file.pays).problem}`);
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
  // The player's own cot, while they're down on one (src/collapse.js).
  if (game.fell?.bed && game.fell.place === place) taken.add(game.fell.bed);
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
  if (d.bed) return d.place === game.location ? `out cold in ${medbayCalled(d.place)}` : `laid up in ${medbayCalled(d.place)}`;
  return d.carriedBy ? `being carried to ${medbayCalled(d.place)}` : `down, ${d.why ?? "hurt"}`;
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
export function fallDown(game, { who, place, level, x, y, why, hours = 0, stain = true }) {
  const key = keyAt(place, who);
  if (!key || key === YOU || game.down?.[key]) return false;
  game.down ??= {};
  game.down[key] = { who, place, level, x, y, since: nowOf(game), until: nowOf(game) + hours, why };
  // A stain where they fell, which the crew clean up in the days after (src/wear.js): not for someone who only fainted.
  if (stain) addMark(game, place, { kind: "fallen", level, x, y });
  const state = stateOf(game, place, who);
  if (state) Object.assign(state, { level, x, y, path: null, goal: { level, x, y }, task: null });
  return true;
}

// Everyone who'd answer a call at a place, first to last, as its health file has them. Never the player.
function answerersOf(game, place, medbay) {
  const out = [];
  for (const job of medbay.answers) {
    for (const key of typeof job === "object" ? [job.who] : onJob(game, place, job === "spare" ? null : job)) if (key && key !== YOU && !out.includes(key)) out.push(key);
  }
  return out;
}
// What kind of work a call is, in the work board's words: for someone bleeding, for someone down, or for the dead.
// Bleeding puts the place's own people first. Someone with no day there, such as a mutineer beaten in a battle
// (src/aftermath.js), is carried in their turn, after the crew, as they always were.
const ownPerson = (d) => Boolean(d.who) && (hasADayAt(d.place, d.who) || Boolean(WORLD_CHARACTERS[d.who]));
const callKind = (game, key, d) => (d.dead ? "dead" : ownPerson(d) && bleedingOf(game, key) ? "bleeding" : "fallen");

// Whoever at a place answers a call: the first, in the file's order, who's awake, free, not hurt or down themselves,
// and with a hand to carry with. Where the place has a work board (src/work.js) it's the board's choice, by the
// place's order of urgency: the first of them who's free or can leave lesser work for it, and failing that, for
// someone bleeding or down, the first who can be woken. With dry, it only says who'd come, and takes nobody off
// anything.
function answerer(game, place, medbay, hours, kind = "fallen", dry = false) {
  if (boardRuns(place)) {
    const found = callHand(game, place, answerersOf(game, place, medbay), kind, { dry });
    if (found !== undefined) return found;
  }
  const busy = new Set(Object.values(game.down ?? {}).map((d) => d.call?.by).filter(Boolean));
  // Awake first; and when nobody who could answer is awake, the call wakes the first of them who's asleep.
  for (const woken of [false, true]) {
    for (const job of medbay.answers) {
      for (const key of typeof job === "object" ? [job.who] : onJob(game, place, job === "spare" ? null : job)) {
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
        if (d.place === here) notes.push(`[HEALTH] ${nameOf(game, d)} gets up, and makes their way to ${to === medbay.room ? medbayCalled(d.place) : roomNameOf(d.place, to)}.`);
      } else {
        delete game.down[key];
        if (d.place === here) notes.push(`[HEALTH] ${nameOf(game, d)} gets up${d.bed ? ` and leaves ${medbayCalled(d.place)}` : ""}.`);
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
      const found = answerer(game, d.place, medbay, now, callKind(game, key, d));
      if (!found) continue;
      d.call = { by: found.key, phase: "going", since: now, bed: null };
      if (d.place === here) notes.push(`[HEALTH] ${found.woken ? `The call wakes ${nameOf(game, { who: found.key })}, who` : nameOf(game, { who: found.key })} sets off from ${medbayCalled(d.place)} for ${nameOf(game, d)}.`);
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
        if (d.place === here) notes.push(`[HEALTH] ${nameOf(game, { who: by })} lays ${nameOf(game, d)} ${d.bed === `@${medbay.room}` ? `on ${medbayCalled(d.place)}'s floor, the cots all taken` : d.bed.startsWith("@") ? `on the bench in ${roomNameOf(d.place, d.bed.slice(1))}` : `on a cot in ${medbayCalled(d.place)}`}.`);
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
  if (doorLocked(game, d.place, medbayRoom)) return `${medbayCalled(d.place)}'s door is locked`;
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
  const shut = (d.bed && doorLocked(game, d.place, medbay.room) ? `${medbayCalled(d.place)}'s door is locked` : shutOut(game, d, medbay.room)) ?? (doorLocked(game, d.place, room) ? `the door to ${roomNameOf(d.place, room)} is locked` : null);
  if (!d.call) {
    if (shut) return notes;
    const found = answerer(game, d.place, medbay, now, "dead");
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
// Whoever the player has told to go to the medbay now (src/asks.js): seen like the queue, at any hour, from a walk's
// worth of time after they were told, unless its door is locked.
const sentAt = (game, place, medbay, hours) => (doorLocked(game, place, medbay.room) ? [] : Object.entries(game.sent ?? {}).filter(([key, one]) => one.place === place && hours >= one.at + WALK_HOURS && hours < one.until && !game.down?.[key]).map(([key]) => key));
// Who's on the medbay's cots and floor at a place, by body key, then whoever's in the morning queue, and the player
// while they're standing in the medbay.
function patientsAt(game, place, medbay, hours = nowOf(game)) {
  const keys = [...downAt(game, place).filter(([, d]) => d.bed && !d.going && !d.dead && (!d.bed.startsWith("@") || d.bed === `@${medbay.room}`)).map(([key]) => key), ...queueAt(game, place, medbay, hours)];
  for (const key of sentAt(game, place, medbay, hours)) if (!keys.includes(key)) keys.push(key);
  return playerIn(game, place, medbay) ? [...keys, YOU] : keys;
}
// The medics at work in the medbay at a moment: whoever holds a treating post or does a treating job, there by their
// day, and not out on a call or down themselves.
function medicsAt(game, place, medbay, hours) {
  const there = new Set(whoIsIn(game, place, medbay.room, hours));
  const busy = new Set(Object.values(game.down ?? {}).map((d) => d.call?.by).filter(Boolean));
  // Where there's a work board, nobody who's carrying or mending for it is at the medbay's table as well.
  const board = boardRuns(place);
  return treatersOf(game, place, medbay).filter((key) => there.has(key) && !busy.has(key) && !isDown(game, place, key) && !lostReason(game, place, key) && !(board && busyOnBoard(game, place, key, "treat")));
}
// One more medic for a patient, where the place has a work board and none is free: whoever of the medics on watch
// can leave lesser work for it, by the place's order of urgency (src/work.js). Treating wakes nobody.
function medicFromBoard(game, place, medbay, hours, state) {
  if (!boardRuns(place)) return null;
  const there = new Set(whoIsIn(game, place, medbay.room, hours));
  const treating = new Set(Object.values(state.treating).map((job) => job.by));
  const people = treatersOf(game, place, medbay).filter((key) => there.has(key) && !treating.has(key));
  return people.length ? callHand(game, place, people, "treat", { inOrder: false })?.key ?? null : null;
}
// Who treats at a place, first to last, as its health file has them. Never the player.
function treatersOf(game, place, medbay) {
  const keys = medbay.treaters.flatMap((one) => (one.post ? [holderKey(game, place, one.post)] : one.who ? [one.who] : onJob(game, place, one.job)));
  return [...new Set(keys)].filter((key) => key && key !== YOU);
}
// Doses from what's open, opening more from the medicine's store when it runs out. False when there aren't enough.
function takeDoses(game, place, medbay, state, n, at = nowOf(game)) {
  while (state.doses < n) {
    const got = openMedicine(game, place, medbay);
    if (!got) return false;
    state.doses += got;
  }
  state.doses -= n;
  countUsed(state, at, n);
  return true;
}
// More medicine for the medbay, in doses, or none when there's none left: a crate from its store, or with no crate
// there, whatever else in it is medicine, the most doses first (src/worth.js: a medkit handed in at the cabinet is
// four doses); or at a port from the place's own, which it uses up as buying a crate would (src/daily.js).
function openMedicine(game, place, medbay) {
  if (medbay.medicine.own) {
    if (noneLeft(game, place, "medicine")) return 0;
    tradedAt(game, place, "medicine");
    return medbay.medicine.doses;
  }
  // What a crate is worth is its own file's to say, where it does; otherwise the health file's doses to a crate.
  if (takeAboard(game, place, "medicine_crate", 1, [medbay.medicine.store]) >= 1) return worthOf("medicine_crate", "medicine") || medbay.medicine.doses;
  const store = logisticsOf(place)?.stores.find((one) => one.id === medbay.medicine.store);
  const [most] = store ? worthIn(storeCounts(game, store.key, store.holds), "medicine", ["medicine_crate"]) : [];
  return most && storeTake(game, store.key, store.holds, most.item, 1) ? most.worth : 0;
}
// The player's bill for the doses a treatment took, at a place that charges: as much as they have, if that's less.
function billFor(game, place, medbay, doses, by) {
  if (!medbay.perDose || !doses) return [];
  const bill = Math.max(1, Math.ceil(doses * medbay.perDose));
  const paid = Math.min(Math.max(0, game.credits ?? 0), bill);
  game.credits = (game.credits ?? 0) - paid;
  return [`[HEALTH] ${medicName(game, place, by)} charges you ${bill} credit${bill === 1 ? "" : "s"} for the doses${paid < bill ? `, and takes the ${paid} you have` : ""}.`];
}
// Doses counted by the day they were given, for what the ship's medicine goes on (step 8).
function countUsed(state, at, n) {
  const day = Math.floor(at / 24);
  state.used = { ...Object.fromEntries(Object.entries(state.used ?? {}).filter(([d]) => Number(d) >= day - 8)), [day]: (state.used?.[day] ?? 0) + n };
}
// The doses the doctor's rounds give a serious illness, once a day, from the health file: true if there were enough.
// The rounds carry a crate of their own from the cabinet, so that what the medbay's table gets through over a long
// wait, which is worked out more roughly than hour by hour, never decides who on the rounds gets a dose.
export function roundsDose(game, place, at = nowOf(game)) {
  const medbay = medbayOf(place);
  if (!medbay?.medicine) return false;
  const n = medbay.rounds ?? 1;
  const state = stateFor(game, place);
  while ((state.rounds ?? 0) < n) {
    const got = openMedicine(game, place, medbay);
    if (!got) return false;
    state.rounds = (state.rounds ?? 0) + got;
  }
  state.rounds -= n;
  countUsed(state, at, n);
  return true;
}
// The rounds dose someone with a day of their own, or the player, for a serious illness at midnight: the doses, the
// wound treated from then, and a line in the medbay's log. False when there was no medicine to be had.
export function doseOnRounds(game, place, key, wound, at) {
  if (!roundsDose(game, place, at)) return false;
  treatWound(game, key, wound, at);
  const state = stateFor(game, place);
  const line = `On the rounds, ${key === YOU ? "you're" : `${nameOf(game, { who: whoOf(place, key) ?? nameOfKey(game, key) })} is`} dosed for ${wound.words}`;
  state.log = [...(state.log ?? []), { day: Math.floor(at / 24), line }].slice(-8);
  return true;
}
// The player treats a patient with their own hands (src/hands.js): the next wound the medbay can treat, with its
// doses, in its minutes over the player's own Medicine. It says what was done and how long it takes; the time is the
// caller's to pass. A wound gone too far is the doctor's to deal with.
export function treatByHand(game, place, key) {
  const medbay = medbayOf(place);
  if (!medbay?.room || !medbay.medicine || !medbay.treatments.length) throw new Error("There's nothing here to treat them with.");
  if (key === YOU) throw new Error("Not your own: the medics see to you.");
  if (!playerIn(game, place, medbay)) throw new Error(`They have to be treated in ${medbayCalled(place)}.`);
  const state = stateFor(game, place);
  if (state.treating[key]) throw new Error(`${medicName(game, place, state.treating[key].by)} is already seeing to them.`);
  if (!roomPowered(game, place, medbay.room)) throw new Error(`${MedbayCalled(place)} has no power.`);
  const wound = waitingTreatment(game, key, medbay.treatments)[0];
  const treatment = wound ? treatmentFor(wound, medbay.treatments) : null;
  if (!treatment) throw new Error("There's nothing more to do for them here.");
  const hours = treatment.minutes / speedOf(game, place, [YOU], "medicine") / 60;
  if (tooFarGone(wound, nowOf(game) + hours)) throw new Error("That wound has gone too far for you. It needs the doctor.");
  if (!takeDoses(game, place, medbay, state, treatment.doses)) throw new Error(medbay.medicine.own ? "There's no medicine left here." : "The medicine cabinet is empty.");
  const word = treatWound(game, key, wound, nowOf(game) + hours);
  const what = wound.kind === "lost" ? `the stump of ${whose(game, key)} ${wound.part.replace("_", " ")}` : `${whose(game, key)} ${wound.words.replace(/^(an?|the) /, "").replace(/ has gone bad$/, " gone bad")}`;
  const line = `You ${word === "splinted" && wound.kind !== "lost" ? "splint" : "dress"} ${what}`;
  state.log = [...(state.log ?? []), { day: Math.floor(nowOf(game) / 24), line }].slice(-8);
  return { line, hours, doses: treatment.doses };
}
// What the medbay could do for someone the player's standing beside, without doing it: the wound and what it takes, or
// null. Reading it changes nothing.
export function treatableByHand(game, place, key) {
  const medbay = medbayOf(place);
  if (!medbay?.room || !medbay.medicine || !medbay.treatments.length || key === YOU || !playerIn(game, place, medbay)) return null;
  if (game.medbay?.[place]?.treating?.[key]) return null;
  const wound = waitingTreatment(game, key, medbay.treatments)[0];
  const treatment = wound ? treatmentFor(wound, medbay.treatments) : null;
  return treatment ? { words: wound.words, doses: treatment.doses, minutes: Math.round(treatment.minutes / speedOf(game, place, [YOU], "medicine")) } : null;
}
// How many doses a day the medbay's been getting through, over the last week: for the ship's days of medicine left.
export function dosesADay(game, place) {
  const used = game.medbay?.[place]?.used ?? {};
  const today = Math.floor(nowOf(game) / 24);
  let sum = 0;
  for (let day = today - 7; day < today; day += 1) sum += used[day] ?? 0;
  return sum / 7;
}
// Whether the medbay takes its medicine a dose at a time, so the ship needs no daily crate of its own.
export const medbayDoses = (place) => Boolean(medbayOf(place)?.medicine);
// A medic as the ship calls them: by their post (Dr. Aduro), else their title or name.
const medicName = (game, place, key) => { const name = calledBy(game, place, key); return name.charAt(0).toUpperCase() + name.slice(1); };
const whose = (game, key) => (key === YOU ? "your" : `${nameOf(game, { who: whoOf(game.down?.[key]?.place ?? game.location, key) ?? nameOfKey(game, key) })}'s`);
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
        if (key === YOU) notes.push(...billFor(game, place, medbay, job.doses, job.by));
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
      if (key === YOU) notes.push(...billFor(game, place, medbay, job.doses, job.by));
      const line = wound.kind === "lost"
        ? `${medicName(game, place, job.by)} dresses the stump of ${whose(game, key)} ${wound.part.replace("_", " ")}`
        : `${medicName(game, place, job.by)} ${word === "splinted" ? "splints" : "dresses"} ${whose(game, key)} ${wound.words.replace(/^(an?|the) /, "").replace(/ has gone bad$/, " gone bad")}`;
      state.log = [...(state.log ?? []), { day: Math.floor(job.until / 24), line }].slice(-8);
      if (place === game.location && (playerIn(game, place, medbay) || key === YOU)) notes.push(`[HEALTH] ${line}.`);
    }
    const dark = !roomPowered(game, place, medbay.room);
    if (dark && !state.dark && place === game.location && playerIn(game, place, medbay)) notes.push(`[HEALTH] ${MedbayCalled(place)} has no power. Nobody can be treated until it comes back.`);
    state.dark = dark;
    const free = dark ? [] : medicsAt(game, place, medbay, t).filter((key) => !Object.values(state.treating).some((job) => job.by === key));
    const patients = patientsAt(game, place, medbay, t).filter((key) => !state.treating[key]);
    const waiting = patients.filter((key) => waitingTreatment(game, key, medbay.treatments).length).sort((a, b) => howBad(game, b) - howBad(game, a));
    const fitting = medbay.fitting ? patients.filter((key) => !waiting.includes(key) && limbReady(game, place, key)) : [];
    for (const key of fitting) {
      if (!free.length) break;
      if (!takeDoses(game, place, medbay, state, medbay.fitting.doses, t)) break;
      const medic = free.shift();
      const minutes = medbay.fitting.minutes / speedOf(game, place, [medic], "medicine");
      state.treating[key] = { by: medic, fit: true, part: limbReady(game, place, key), doses: medbay.fitting.doses, since: t, until: t + minutes / 60 };
      if (key === YOU && place === game.location) notes.push(`[HEALTH] ${medicName(game, place, medic)} starts fitting your new limb.`);
    }
    for (const key of waiting) {
      if (!free.length) {
        // Nobody's free: where there's a work board, a medic who can leave lesser work for a patient does, while
        // there's medicine to treat with.
        const more = dark || state.short ? null : medicFromBoard(game, place, medbay, t, state);
        if (!more) break;
        free.push(more);
      }
      const wound = waitingTreatment(game, key, medbay.treatments)[0];
      const treatment = treatmentFor(wound, medbay.treatments);
      if (!treatment) continue;
      if (!takeDoses(game, place, medbay, state, treatment.doses, t)) {
        if (!state.short) {
          state.short = true;
          if (place === game.location && playerIn(game, place, medbay)) notes.push(medbay.medicine.own ? `[HEALTH] There's no medicine left here. ${medicName(game, place, free[0])} can't treat anyone until there's more.` : `[HEALTH] The medicine cabinet is empty. ${medicName(game, place, free[0])} can't treat anyone until a crate is brought.`);
        }
        break;
      }
      state.short = false;
      const medic = free.shift();
      const minutes = treatment.minutes / speedOf(game, place, [medic], "medicine");
      state.treating[key] = { by: medic, part: wound.part, kind: wound.kind, at: wound.at, doses: treatment.doses, since: t, until: t + minutes / 60 };
      if (key === YOU && place === game.location) notes.push(`[HEALTH] ${medicName(game, place, medic)} sees to your ${wound.words.replace(/^(an?|the) /, "").replace(/ has gone bad$/, " gone bad")}.`);
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
    // The medbay's clock starts now, so that however long the first wait, they're seen to from its start.
    const state = stateFor(game, one.place);
    if (state.at === null) state.at = nowOf(game);
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
      state: job ? `being treated by ${medicName(game, place, job.by)}` : waiting.length ? `waiting for treatment (${waiting.length})` : cantGetUp(game, key) === "out cold" ? "out cold" : restingFrom(game, key, medbay.rest) ? "resting" : "getting up soon",
    };
  };
  const here = downAt(game, place).filter(([, d]) => d.bed && !d.going);
  return {
    cots: medbay.cots.map((cot) => {
      const on = here.find(([, d]) => d.bed === cot);
      return on ? patient(on) : null;
    }),
    floor: here.filter(([, d]) => d.bed === `@${medbay.room}`).sort(([a], [b]) => howBad(game, b) - howBad(game, a)).map(patient),
    medicine: medbay.medicine ? { store: medbay.medicine.name, doses: state.doses ?? 0, rounds: state.rounds ?? 0, perCrate: medbay.medicine.doses, short: Boolean(state.short) } : null,
    log: (state.log ?? []).map((one) => `Day ${one.day + 1}: ${one.line}`).reverse(),
    dead: deathsView(game, place),
    // The register's sick, seen on the doctor's rounds (src/register.js).
    rounds: roundsView(game),
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
      if (d.going) return { where: `@${d.to ?? medbay?.room}`, doing: d.to && d.to !== medbay?.room ? `making their way to ${roomNameOf(place, d.to)}, slowly` : `making their way to ${medbayCalled(place)}, slowly` };
      if (d.dead && d.carriedBy) return { where: d.call?.bed ?? `down:${key}`, spot: d, exact: true, doing: "dead, being carried away", asleep: true };
      if (d.dead) return { where: d.bed ?? `down:${key}`, spot: d.bed ? undefined : d, exact: !d.bed, doing: "dead, under a blanket", asleep: true };
      if (d.bed?.startsWith("@") && d.bed !== `@${medbay?.room}`) return { where: d.bed, doing: `lying on the bench in ${roomNameOf(place, d.bed.slice(1))}`, asleep: !awakeInMedbay(game, key) };
      if (d.bed?.startsWith("@")) return { where: d.bed, doing: `lying on ${medbayCalled(place)}'s floor`, asleep: !awakeInMedbay(game, key) };
      if (d.bed) return { where: d.bed, doing: "laid up on a cot", asleep: !awakeInMedbay(game, key) };
      return { where: `down:${key}`, spot: d, exact: true, doing: d.carriedBy ? `being carried to ${medbayCalled(place)}` : `lying where they fell, ${d.why ?? "down"}`, asleep: true };
    }
    const job = helping.get(who);
    if (job) {
      const [key, d] = job;
      if (d.call.phase === "going") return { where: `down:${key}`, spot: d, doing: helpingWords(game, d) };
      return { where: d.call.bed, doing: helpingWords(game, d) };
    }
    return null;
  };
}

// ---- For the place's work board (src/work.js) --------------------------------------------------------------

// What whoever's answering a call is doing, in words.
function helpingWords(game, d) {
  if (d.call?.phase === "going") return d.dead ? `going for ${nameOf(game, d)}'s body` : `going to help ${nameOf(game, d)}`;
  return d.dead ? `carrying ${nameOf(game, d)}'s body away` : `carrying ${nameOf(game, d)} to ${medbayCalled(d.place)}`;
}
const patientName = (game, place, key) => (key === YOU ? "you" : nameOf(game, { who: whoOf(place, key) ?? nameOfKey(game, key) }));
const woundWords = (wound) => wound.words.replace(/^(an?|the) /, "").replace(/ has gone bad$/, " gone bad");
// A call handed back: whoever was being carried is put down where they are, and the call goes out again.
function dropCall(game, key) {
  const d = game.down?.[key];
  if (!d?.call) return;
  if (d.carriedBy === d.call.by) d.carriedBy = null;
  d.call = null;
}
// A treatment handed back: the doses go back in the crate, and the patient waits for the next medic.
function dropTreatment(game, place, patient) {
  const state = game.medbay?.[place];
  const job = state?.treating?.[patient];
  if (!job) return;
  state.doses += job.doses ?? 0;
  delete state.treating[patient];
}
// Everyone the medbay's work is for: whoever answers a call, and whoever treats.
export function medbayHands(game, place) {
  const medbay = medbayOf(place);
  return medbay?.room ? [...new Set([...answerersOf(game, place, medbay), ...treatersOf(game, place, medbay)])] : [];
}
// What the medbay has people doing, as the work board sees it: whoever's answering a call, and whoever's treating
// someone. Each is { kind, by, doing, drop }, drop being how the board takes them off it for something more urgent.
const NO_WORK = Object.freeze([]);
export function medbayWork(game, place) {
  let out = null;
  for (const key in game.down ?? {}) {
    const d = game.down[key];
    if (d.place !== place || !d.call) continue;
    (out ??= []).push({ kind: callKind(game, key, d), by: d.call.by, doing: helpingWords(game, d), drop: () => dropCall(game, key) });
  }
  const treating = game.medbay?.[place]?.treating;
  for (const patient in treating ?? {}) {
    const job = treating[patient];
    if (!job.by || job.by === YOU) continue;
    (out ??= []).push({ kind: "treat", by: job.by, doing: job.fit ? `fitting ${whose(game, patient)} new limb` : `treating ${patientName(game, place, patient)}`, drop: () => dropTreatment(game, place, patient) });
  }
  return out ?? NO_WORK;
}

// The medbay's work for the Work page: every call, whoever's being treated, and whoever's waiting to be. Each is
// { id, kind, what, why, by, since, doing, stuck, people, also }: since is in hours, stuck is why nobody can do it
// whoever's free (a locked door, no medicine, no power), people are who'd do it, first to last, and also gives a
// reason more for one of them, such as a medic who's off watch. Reading this changes nothing.
export function medbayRows(game, place) {
  const medbay = medbayOf(place);
  if (!medbay?.room) return [];
  const rows = [];
  const now = nowOf(game);
  let callers = null;
  for (const [key, d] of downAt(game, place)) {
    // Whoever's lying where they fell, or dead and not yet carried out; not someone on a cot, on their feet, or in
    // the player's arms.
    const lying = d.carriedBy !== YOU && !d.going && (d.dead || !d.bed);
    if (!lying && !d.call) continue;
    const name = nameOf(game, d);
    const laidOut = deathRulesOf(place)?.room ?? null;
    if (d.dead && !laidOut) continue;
    const bench = d.dead ? null : workshopBedFor(game, place, key);
    const to = d.dead ? roomNameOf(place, laidOut) : bench ? roomNameOf(place, bench.slice(1)) : medbayCalled(place);
    const shut = d.call ? null : d.dead
      ? (d.bed && doorLocked(game, place, medbay.room) ? `${medbayCalled(place)}'s door is locked` : shutOut(game, d, medbay.room)) ?? (doorLocked(game, place, laidOut) ? `the door to ${roomNameOf(place, laidOut)} is locked` : null)
      : shutOut(game, d, medbay.room);
    rows.push({
      id: `call:${key}`, kind: callKind(game, key, d),
      what: d.dead ? `Carry ${name}'s body to ${to}` : `Carry ${name} to ${to}`,
      why: d.dead ? null : bleedingOf(game, key) ? "bleeding" : d.why ?? "down",
      by: d.call?.by ?? null, since: d.call?.since ?? null, doing: d.call ? helpingWords(game, d) : null,
      stuck: shut, people: (callers ??= answerersOf(game, place, medbay)), also: null,
    });
  }
  const state = game.medbay?.[place] ?? { treating: {} };
  const minutesLeft = (job) => { const left = Math.max(1, Math.round((job.until - now) * 60)); return `${left} minute${left === 1 ? "" : "s"} left`; };
  for (const [patient, job] of Object.entries(state.treating ?? {})) {
    const wound = job.fit ? null : woundOf(game, patient, job);
    rows.push({
      id: `treat:${patient}`, kind: "treat",
      what: job.fit ? `Fit ${whose(game, patient)} new limb` : `Treat ${whose(game, patient)} ${wound ? woundWords(wound) : "wound"}`,
      why: null, by: job.by, since: job.since, doing: `${job.fit ? "fitting it" : "seeing to it"}, ${minutesLeft(job)}`,
      stuck: null, people: [], also: null,
    });
  }
  if (medbay.treatments.length && medbay.medicine) {
    const dark = !roomPowered(game, place, medbay.room);
    const patients = patientsAt(game, place, medbay).filter((key) => !state.treating?.[key]);
    const waiting = patients.filter((key) => waitingTreatment(game, key, medbay.treatments).length).sort((a, b) => howBad(game, b) - howBad(game, a));
    const fitting = medbay.fitting ? patients.filter((key) => !waiting.includes(key) && limbReady(game, place, key)) : [];
    if (waiting.length || fitting.length) {
      const medics = treatersOf(game, place, medbay);
      // A medic treats while their day has them in the medbay.
      const onWatch = new Set(whoIsIn(game, place, medbay.room, now));
      const also = (key) => (onWatch.has(key) ? null : "off watch");
      const stuck = dark ? `${medbayCalled(place)} has no power` : state.short ? (medbay.medicine.own ? "there's no medicine left here" : "the medicine cabinet is empty") : null;
      for (const patient of waiting) {
        const wound = waitingTreatment(game, patient, medbay.treatments)[0];
        rows.push({ id: `treat:${patient}`, kind: "treat", what: `Treat ${whose(game, patient)} ${woundWords(wound)}`, why: null, by: null, since: null, doing: null, stuck, people: medics, also });
      }
      for (const patient of fitting) rows.push({ id: `treat:${patient}`, kind: "treat", what: `Fit ${whose(game, patient)} new limb`, why: null, by: null, since: null, doing: null, stuck, people: medics, also });
    }
  }
  return rows;
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
// The room someone down is lying in, by its id: their cot's, the floor they were laid on, or where they fell. Null
// while they're being carried or making their own way somewhere, and when there's no telling (src/no-air.js asks, for
// whether they can breathe there).
export function lyingRoom(place, d) {
  if (d.carriedBy || d.going) return null;
  if (d.bed?.startsWith("@")) return d.bed.slice(1);
  const at = lyingAt(place, d);
  const level = at ? mapFor(place)?.levels[at.level] : null;
  if (!level) return null;
  return level.areas?.length ? level.roomAt(at.x, at.y) : level.id;
}
// Whoever's down at a place with no day there, such as a mutineer beaten in a battle (src/aftermath.js): the life engine
// doesn't walk them, so they're drawn where their record says, on their cot, or with whoever's carrying them. Someone
// with a file is left out, since the story keeps them. Each is as the life engine would show them.
export function unlistedDown(game, place, levelId) {
  const people = game.life?.places?.[place] ?? {};
  const medbay = medbayOf(place);
  const out = [];
  for (const [, d] of downAt(game, place)) {
    if (!d.who || d.going || hasADayAt(place, d.who) || WORLD_CHARACTERS[d.who]) continue;
    const carrier = d.carriedBy === YOU ? (game.walk && !game.walk.room ? game.walk : null) : d.carriedBy ? people[d.carriedBy] : null;
    const at = d.carriedBy ? (carrier ? { level: carrier.level, x: carrier.x, y: carrier.y } : null) : lyingAt(place, d);
    if (!at || at.level !== levelId) continue;
    const doing = d.dead ? "dead, under a blanket"
      : d.carriedBy ? `being carried to ${medbayCalled(place)}`
        : d.bed?.startsWith("@") && d.bed === `@${medbay?.room}` ? `lying on ${medbayCalled(place)}'s floor`
          : d.bed ? "laid up on a cot" : `lying where they fell, ${d.why ?? "down"}`;
    out.push({ id: null, name: d.who, x: at.x, y: at.y, crowd: true, asleep: true, doing });
  }
  return out;
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
  return quiet ? null : `[HEALTH] You put ${nameOf(game, d)} down${bed ? (bed.startsWith("@") ? ` on ${medbayCalled(d.place)}'s floor, the cots all taken` : " on a cot") : ""}.`;
}

// ---- The player knocked out aboard ------------------------------------------------------------------------

// The player lost a fight at a place with a medbay: someone carries them there and they come to on a cot hours later,
// with what they had still on them. Returns the line for the story, or null where nobody comes, as anywhere without a
// medbay, so the old setback stands.
export function wakeInMedbay(game) {
  const place = game.location;
  const medbay = medbayOf(place);
  // Someone who hasn't walked a step yet still stands somewhere: where their life begins.
  if (!medbay?.room || !walkOf(game)) return null;
  const by = answerer(game, place, medbay, nowOf(game), "fallen", true)?.key;
  if (!by) return null;
  const knock = woundsNow(game, YOU).find((wound) => wound.kind === "knock");
  const hours = Math.max(knock ? knock.until - nowOf(game) : 0, beatenFor());
  // Carried there, whatever doors are between: but if the map won't have it, they come round where they fell instead,
  // because this is the end of a fight and nothing here may stop it ending.
  if (!playerToCot(game, place, medbay)) return null;
  const notes = passTime(game, hours, "rest");
  const whole = Math.round(hours * 10) / 10;
  const where = medbayCalled(place);
  return [`You come to on a cot in ${where}, ${whole < 2 ? "an hour or so" : `${Math.round(whole)} hours`} later. ${nameOf(game, { who: by })} carried you here.`, ...notes];
}
// After losing a fight (step 10): carried to the place's medbay where it has one; else, for someone whose home is the
// Meridian, at the dock she's at, across on the shuttle and into hers; else null, and they come round where they fell.
export function wakeAfterDefeat(game) {
  const here = wakeInMedbay(game);
  if (here) return here;
  const from = shuttleBringsAboard(game);
  if (!from) return null;
  const woke = wakeInMedbay(game);
  return woke ? [`The shuttle crew found you on ${LOCATIONS[from]?.name ?? from} and brought you back aboard.`, ...woke] : null;
}

// The player is moved to a place's medbay, beside a free cot, on the floor, so that they can walk away from it. It
// returns the cot, or "@" and the room when the cots are all taken; null if the map won't have them there.
function playerToCot(game, place, medbay) {
  try {
    walkCommand(game, { action: "room", to: medbay.room });
  } catch {
    return null;
  }
  const cot = freeCot(game, place);
  const spot = cot ? WORLD_LIFE[place].spots[cot] : null;
  const level = mapFor(place)?.levels[game.walk.level];
  if (spot && level) {
    const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]].map(([dx, dy]) => ({ x: spot[1] + dx, y: spot[2] + dy })).find((one) => canStand(level, one.x, one.y));
    if (near) Object.assign(game.walk, { x: near.x, y: near.y });
  }
  return cot ?? `@${medbay.room}`;
}
// Someone whose home is the Meridian, down at the dock she's at where there's no clinic: her shuttle crew bring them
// across to her, if anyone aboard could come for them. It returns where they were found, or null when it doesn't apply.
export function shuttleBringsAboard(game) {
  const from = game.location;
  const home = isCaptain(game) || startOf(game)?.place === SHIP || Boolean(deposedStart(game));
  const medbay = medbayOf(SHIP);
  if (from === SHIP || !home || game.ship?.at !== from || medbayOf(from)?.room || !medbay?.room) return null;
  if (!answerer(game, SHIP, medbay, nowOf(game), "fallen", true)) return null;
  game.location = SHIP;
  game.walk = null;
  walkOf(game);
  return from;
}

// ---- The player down for another reason (src/collapse.js) ----------------------------------------------------

// The room the player's in, at a place.
const playersRoom = (game, place) => (game.walk && !game.walk.room && game.location === place ? mapFor(place)?.levels[game.walk.level]?.roomAt(game.walk.x, game.walk.y) ?? null : null);
// Whoever would come for the player, lying where they are at a place with a medbay: { by, woken }, the key of the
// first who can and whether the call woke them; or { help }, the sentence for why nobody does. Null at a place with no
// medbay. It takes nobody off anything: the player isn't on the place's work board.
export function helpForPlayer(game, kind = "fallen") {
  const place = game.location;
  const medbay = medbayOf(place);
  if (!medbay?.room || !walkOf(game)) return null;
  const room = playersRoom(game, place);
  if (room !== medbay.room) {
    if (doorLocked(game, place, medbay.room)) return { help: `${MedbayCalled(place)}'s door was locked, and nobody could get out to you.` };
    if (room && doorLocked(game, place, room)) return { help: `The door to ${roomNameOf(place, room)} was locked, and nobody could get in to you.` };
  }
  const found = answerer(game, place, medbay, nowOf(game), kind, true);
  return found ? { by: found.key, woken: Boolean(found.woken) } : { help: "Nobody was left who could come for you." };
}
// Whoever came lays the player in the place's medbay: on a cot, or its floor. It returns which, or null.
export function layPlayerDown(game) {
  const medbay = medbayOf(game.location);
  return medbay?.room ? playerToCot(game, game.location, medbay) : null;
}
// Whether the player's in a place's medbay, and why it can't treat them there, in a sentence, or null when it can.
export function playerInMedbay(game) {
  const medbay = medbayOf(game.location);
  return Boolean(medbay?.room) && playersRoom(game, game.location) === medbay.room;
}
export function cantTreatWhy(game) {
  const place = game.location;
  const medbay = medbayOf(place);
  if (!medbay?.room) return null;
  if (!medbay.treatments.length || !medbay.medicine) return "There was nothing there to treat you with.";
  if (!roomPowered(game, place, medbay.room)) return `${MedbayCalled(place)} had no power, and nobody could be treated in it.`;
  if (game.medbay?.[place]?.short) return medbay.medicine.own ? "There was no medicine left there to treat you with." : "The medicine cabinet was empty.";
  if (!medicsAt(game, place, medbay, nowOf(game)).length && !game.medbay?.[place]?.treating?.[YOU]) return "Nobody who could treat you was there.";
  return null;
}
// What the ship calls whoever carried them.
export const carrierName = (game, key) => nameOf(game, { who: key });
