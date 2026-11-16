// The ship's work board. Every job of carrying from one store to another is kept here, and this is the only part of
// the game that sends anyone to carry. Nobody writes the routes: each store's line in world/logistics/<place>.txt says
// what it wants kept in it, when that's urgent and who carries for it, and the board does the rest. Whenever a store
// has fewer of something than it wants, and some other store can spare it, a job comes up: the first of the store's
// carriers who's free takes it, walks to the nearest store that can spare the thing, takes what one trip carries,
// walks it over and puts it in. What they've gone for is set aside for them, so two people never go for the same
// crates, and as many go at once as the want needs. Where nothing aboard can be spared, nobody is sent to stand at
// an empty store: the Ship menu says there's nothing to bring.
//
// A want is urgent when the store is under the mark its line gives, or when whatever uses the thing up is asking: a
// machine with nothing left to work from (the generator on its last cell, the galley with a bare pantry), the medbay
// with someone waiting and no doses, a repair waiting for its spare. Urgent jobs are given out first, and one wakes
// a sleeper when nobody else is up.
//
// Nobody is counted in two places: someone the medbay, an alarm, a repair or the player has taken is given no job,
// and a carrier who's called away, or who can't go on, hands the job back with whatever they'd loaded, for the next
// free hand. A walk takes as long as the way through the decks is, at the pace of whoever's walking, whether or not
// anyone is watching.
//
// This is steps 1 and 3 of the logistics rework (docs/notes/project-logistics.md, "The rework"). What's kept in the
// save is game.logistics[place].jobs, a list: a job under way is { id, to, item, from, n, phase, since, load, by,
// took, walk }, and one set down with its load has nobody (by: null, phase "down"). A want nobody has taken up yet
// isn't kept at all: it's there whenever the store is short. A save from before step 3 kept its jobs by their
// errands (game.logistics[place].errands), and whatever those had loaded is put back in the stores the first time
// the board runs.

import { handsFree } from "./body.js";
import { storeCounts, storePut, storeTake } from "./bag.js";
import { YOU, calledBy, holderKey, lostReason, onJob, personCalled } from "./command.js";
import { hasReached, notAbout, walkMinutes } from "./life.js";
import { itemWords, logisticsOf, machineStarved, putAboard, storeById, tripOf } from "./logistics.js";
import { medbayDetour, medbayOf } from "./medbay.js";
import { detourExtras } from "./room-hooks.js";
import { dutyDetour, waitingForParts } from "./systems.js";
import { worthOf } from "./worth.js";

// How long a walk is taken to be when there's no telling how far it is.
const WALK_MINUTES = 15;
// The most jobs one want raises in a piece of the clock: more than there are ever hands for.
const MOST_AT_ONCE = 8;
const NOBODY_HELD = () => null;
const loadWords = (item, n) => `${n} ${itemWords(item, n)}`;
const clockWords = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(Math.floor(minutes) % 60).padStart(2, "0")}`;
const upperFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : "");
const jobsAt = (game, place) => game.logistics?.[place]?.jobs ?? [];
const haveOf = (game, store, item) => storeCounts(game, store.key, store.holds)[item] ?? 0;

// The spot a job has its carrier at: beside the store they fetch from, or beside the one they carry to.
const whereOf = (j) => `store:${j.phase === "carrying" || j.phase === "unloading" ? j.to : j.from}`;
// What a job's carrier is doing, in words, from where it's got to.
function doingWords(model, j) {
  const from = storeById(model, j.from);
  const to = storeById(model, j.to);
  if (j.phase === "going") return `fetching ${itemWords(j.item, 2)} from the ${from?.name ?? "stores"}`;
  if (j.phase === "loading") return `taking ${itemWords(j.item, 2)} from the ${from?.name ?? "stores"}`;
  if (j.phase === "carrying") return `carrying ${loadWords(j.load.item, j.load.n)} to the ${to?.name ?? "stores"}`;
  return `waiting at the ${to?.name ?? "stores"} for room for ${loadWords(j.load.item, j.load.n)}`;
}

// Who something more pressing has taken, with what they're doing about it, in the order the life engine goes by:
// whoever's down or gone to help them (src/medbay.js), the guards at an alarm and an engineer at a repair
// (src/systems.js), and whoever's walking with the player, sent to the medbay or in a brawl (src/room-hooks.js).
// Bad air isn't one of them: a ship with no power has no air, and someone still has to carry the cell that
// brings both back.
function holdsAt(game, place) {
  const down = medbayDetour(game, place);
  const duty = dutyDetour(game, place);
  const extras = detourExtras(game, place);
  if (!down && !duty && !extras) return NOBODY_HELD;
  return (key) => (down?.(key) ?? duty?.(key) ?? extras?.(key, null, false))?.doing ?? null;
}

// Who carries for a store, first to last, as its line has them: everyone doing each job it names, in the watch
// bill's order, whoever holds a post it names, the spare hands, or someone by name. Never the player, who carries
// when they choose to.
function carriersFor(game, place, store) {
  const out = [];
  for (const one of store.carriers ?? []) {
    const keys = one.spare ? onJob(game, place, null) : one.job ? onJob(game, place, one.job) : [one.post ? holderKey(game, place, one.post) : one.key];
    for (const key of keys) if (key && key !== YOU && !out.includes(key)) out.push(key);
  }
  return out;
}
const carriersWords = (store) => (store.carriers ?? []).map((one) => one.words).join(", then ");

// Why someone can't take a job just now, in a few words, or null when they can: dead, in the brig or laid up, a
// hand that's no use, taken by something more pressing, already carrying, or asleep. An urgent job wakes a sleeper.
function whyNot(game, place, key, hours, jobs, model, held, wake = false) {
  const lost = lostReason(game, place, key);
  if (lost) return lost;
  if (!handsFree(game, place, key)) return "hurt in the hand";
  const taken = held(key);
  if (taken) return taken;
  const other = jobs.find((j) => j.by === key);
  if (other) return doingWords(model, other);
  const about = notAbout(game, place, key, hours);
  return wake && about === "asleep" ? null : about;
}

// The first of a store's carriers who's free to take a job, or null. For an urgent one, with nobody up, the first
// who's only asleep.
function freeHand(game, place, store, hours, jobs, model, held, urgent) {
  const people = carriersFor(game, place, store);
  return people.find((key) => !whyNot(game, place, key, hours, jobs, model, held))
    ?? (urgent ? people.find((key) => !whyNot(game, place, key, hours, jobs, model, held, true)) : null)
    ?? null;
}

// Why nobody's on a job, for the Ship menu: what keeps its carriers, the ones kept by the same thing counted
// together, or that there's nobody to ask. Null when someone's free, which is to say it's about to be taken up.
function whyNobody(game, place, store, hours, jobs, model, held, urgent) {
  const people = carriersFor(game, place, store);
  if (!people.length) return "there's nobody to carry for it";
  const kept = new Map();
  for (const key of people) {
    const why = whyNot(game, place, key, hours, jobs, model, held, urgent);
    if (!why) return null;
    kept.set(why, [...(kept.get(why) ?? []), key]);
  }
  const said = [...kept].map(([why, keys]) => ({ n: keys.length, words: keys.length === 1 ? `${calledBy(game, place, keys[0])} is ${why}` : `${keys.length} are ${why}` }));
  const shown = said.slice(0, 3);
  const more = said.slice(3).reduce((sum, one) => sum + one.n, 0);
  return `nobody free: ${shown.map((one) => one.words).join(", ")}${more ? `, and ${more} more can't come` : ""}`;
}

// The minutes of a walk for a job: from where its carrier is (or from a store) to a store, by the way through the
// decks. A walk nobody can measure takes a quarter of an hour.
const walkFor = (game, place, key, from, to, hours) => walkMinutes(game, place, key, from, to, hours) ?? WALK_MINUTES;

// How far one store is from another, as minutes of an easy walk, remembered for as long as the place's file is.
const far = new WeakMap();
function farBetween(game, place, model, a, b) {
  const known = far.get(model) ?? far.set(model, new Map()).get(model);
  const key = `${a}|${b}`;
  if (!known.has(key)) known.set(key, walkMinutes(game, place, null, `store:${a}`, `store:${b}`) ?? WALK_MINUTES);
  return known.get(key);
}

// Whether a job's carrier has got where its walk was taking them: when the minutes of the walk have gone by, or
// sooner if they're being watched and their own feet have got them there.
function there(game, place, j, t) {
  if (t - j.since >= (j.walk ?? WALK_MINUTES)) return true;
  return place === game.location && Boolean(game.life?.places?.[place]?.[j.by]) && hasReached(game, place, j.by, whereOf(j));
}

// What's on its way to a store: what its jobs have loaded, or have gone for.
const comingTo = (jobs, storeId, item, besides = null) => jobs.reduce((sum, j) => (j !== besides && j.to === storeId && j.item === item ? sum + (j.load ? j.load.n : j.n) : sum), 0);
// What's set aside in a store: what the jobs on their way to it are going to take.
const setAsideIn = (jobs, storeId, item) => jobs.reduce((sum, j) => (!j.load && j.from === storeId && j.item === item ? sum + j.n : sum), 0);

// The nearest store that can spare a thing for another: one that keeps it and has more than it wants itself, less
// what's already set aside there. Null when nothing aboard can be spared.
function sourceFor(game, place, model, jobs, to, item) {
  let best = null;
  for (const store of model.stores) {
    if (store.id === to.id || store.count || !(item in store.holds)) continue;
    const spare = haveOf(game, store, item) - (store.wants[item] ?? 0) - setAsideIn(jobs, store.id, item);
    if (spare <= 0) continue;
    const minutes = farBetween(game, place, model, store.id, to.id);
    if (!best || minutes < best.minutes) best = { store, spare, minutes };
  }
  return best;
}

// Why a store's want of something is urgent, in a few words, or null when it isn't: it has fewer than the mark its
// line gives, or whatever uses the thing up is asking for it.
function urgentWhy(game, place, model, store, item, have) {
  if (have < (store.urgent[item] ?? 0)) return `under ${store.urgent[item]}`;
  for (const m of model.machines) {
    if (m.from !== store.id || !m.takes.some((one) => one.item === item)) continue;
    if (machineStarved(game, model, m)) return m.generator ? `the ${m.name} is on its last` : `the ${m.name} has nothing to work from`;
  }
  if (model.repair?.item === item && model.repair.from.includes(store.id) && waitingForParts(game, place).length) return "a repair is waiting for it";
  if (game.medbay?.[place]?.short && medbayOf(place)?.medicine?.store === store.id && worthOf(item, "medicine") > 0) return "someone's waiting in the medbay";
  return null;
}

// A save from before the stores said what they want kept its jobs by their errands. Whatever those had loaded goes
// back into the stores that keep it, and the wants raise their own jobs from there.
function settleOld(game, place, state) {
  if (!state.errands) return;
  for (const old of Object.values(state.errands)) if (old?.load?.n > 0) putAboard(game, place, old.load.item, old.load.n);
  delete state.errands;
}

// The board over one piece of the clock, as long as chunk minutes: the jobs under way go on, a load that was set down
// is taken up by the next free hand, and each want that isn't covered raises jobs, the urgent ones first, for as long
// as there's something to spare and someone free. It says how many urgent wants it had to leave with nobody on them
// though something aboard could have been brought, which the posts' duty counts.
export function runBoard(game, place, model, state, t, chunk) {
  settleOld(game, place, state);
  const jobs = (state.jobs ??= []);
  if (!jobs.length && !model.wants.length) return 0;
  const hours = t / 60;
  // Who's taken by something more pressing is looked up once, and only when a job needs to know.
  let holds = null;
  const held = (key) => (holds ??= holdsAt(game, place))(key);
  const over = (j) => jobs.splice(jobs.indexOf(j), 1);
  for (const j of [...jobs]) {
    const from = storeById(model, j.from);
    const to = storeById(model, j.to);
    // A job for a store the file no longer has is over, and what it had loaded goes back wherever it's kept.
    if (!from || !to) {
      if (j.load?.n > 0) putAboard(game, place, j.load.item, j.load.n);
      over(j);
      continue;
    }
    // Its carrier has been called to something more pressing, or can't go on: the job's handed back, and whatever
    // they'd loaded is set down for the next free hand.
    if (j.by && (lostReason(game, place, j.by) || !handsFree(game, place, j.by) || held(j.by))) {
      if (!j.load) {
        over(j);
        continue;
      }
      Object.assign(j, { phase: "down", since: t, by: null });
    }
    if (!j.by) continue;
    if (j.phase === "going") {
      if (there(game, place, j, t)) Object.assign(j, { phase: "loading", since: t });
    } else if (j.phase === "loading") {
      if (t - j.since < chunk) continue;
      // What was set aside for them, or as much of it as is still there and still has somewhere to go.
      const room = Math.max(0, (to.holds[j.item] ?? 0) - haveOf(game, to, j.item) - comingTo(jobs, to.id, j.item, j));
      const took = storeTake(game, from.key, from.holds, j.item, Math.min(j.n, room));
      if (took <= 0) over(j);
      else Object.assign(j, { phase: "carrying", since: t, load: { item: j.item, n: took }, walk: walkFor(game, place, j.by, `store:${j.from}`, `store:${j.to}`, hours) });
    } else if (there(game, place, j, t)) {
      j.load.n -= storePut(game, to.key, to.holds, j.load.item, j.load.n);
      if (j.load.n > 0) j.phase = "unloading";
      else over(j);
    }
  }
  // Whoever picks up a load that was set down carries it straight on to where it was going.
  for (const j of jobs) {
    if (j.by) continue;
    const to = storeById(model, j.to);
    const who = freeHand(game, place, to, hours, jobs, model, held, false);
    if (who) Object.assign(j, { phase: "carrying", since: t, by: who, took: t, walk: walkFor(game, place, who, null, `store:${j.to}`, hours) });
  }
  // The wants that aren't covered by what's there and what's on its way, the urgent ones first.
  const short = [];
  for (const want of model.wants) {
    const store = storeById(model, want.store);
    const have = haveOf(game, store, want.item);
    if (have + comingTo(jobs, store.id, want.item) >= want.wants) continue;
    short.push({ want, store, have, urgent: Boolean(urgentWhy(game, place, model, store, want.item, have)) });
  }
  short.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  let left = 0;
  for (const { want, store, have, urgent } of short) {
    for (let raised = 0; raised < MOST_AT_ONCE; raised += 1) {
      const coming = comingTo(jobs, store.id, want.item);
      if (have + coming >= want.wants) break;
      const source = sourceFor(game, place, model, jobs, store, want.item);
      if (!source) break;
      const who = freeHand(game, place, store, hours, jobs, model, held, urgent);
      if (!who) {
        if (urgent) left += 1;
        break;
      }
      // A trip's worth, or what there's room for, or what can be spared: whichever is least.
      const n = Math.min(tripOf(model, want.item), store.holds[want.item] - have - coming, source.spare);
      state.jobSeq = (state.jobSeq ?? 0) + 1;
      jobs.push({ id: state.jobSeq, to: store.id, item: want.item, from: source.store.id, n, phase: "going", since: t, load: null, by: who, took: t, walk: walkFor(game, place, who, null, `store:${source.store.id}`, hours) });
    }
  }
  return left;
}

// What the board has someone doing and where, for the life engine's walks: null when nobody's on a job.
export function workDetour(game, place) {
  const jobs = jobsAt(game, place);
  if (!jobs.length) return null;
  const model = logisticsOf(place);
  if (!model) return null;
  const mine = new Map();
  for (const j of jobs) if (j.by) mine.set(j.by, { where: whereOf(j), doing: doingWords(model, j) });
  return mine.size ? (key) => mine.get(key) ?? null : null;
}

// Everything the stores want, for the Ship menu: what each has against what it wants, who's carrying for it and
// since when, or why nobody is. Reading this changes nothing.
export function workView(game, place) {
  const model = logisticsOf(place);
  if (!model) return [];
  const jobs = jobsAt(game, place);
  const hours = game.clock.hours;
  let holds = null;
  const held = (key) => (holds ??= holdsAt(game, place))(key);
  return model.wants.map((want) => {
    const store = storeById(model, want.store);
    const have = haveOf(game, store, want.item);
    const mine = jobs.filter((j) => j.to === store.id && j.item === want.item);
    const carried = mine.filter((j) => j.by);
    const down = mine.filter((j) => !j.by && j.load);
    const short = have + comingTo(jobs, store.id, want.item) < want.wants;
    const urgent = have < want.wants ? urgentWhy(game, place, model, store, want.item, have) : null;
    const source = short ? sourceFor(game, place, model, jobs, store, want.item) : null;
    // A want with nobody on it, one that's come up or a load that's been set down: who'd take it, and what keeps them.
    const open = (short && Boolean(source)) || down.length > 0;
    const nobody = open ? whyNobody(game, place, store, hours, jobs, model, held, Boolean(urgent) && short) : null;
    const said = [
      ...carried.map((j) => `${personCalled(game, j.by)} is ${doingWords(model, j)}, since ${clockWords(j.took ?? j.since)}`),
      ...down.map((j) => `${loadWords(j.load.item, j.load.n)} set down`),
      ...(short && !source ? [carried.length || down.length ? "nothing more aboard to bring" : "nothing aboard to bring"] : []),
      ...(open ? [nobody ?? "about to be taken up"] : []),
    ];
    return {
      id: `${store.id}:${want.item}`,
      store: upperFirst(store.name),
      item: want.item,
      has: have,
      wants: want.wants,
      does: `${loadWords(want.item, have)}, wants ${want.wants}`,
      by: carriersWords(store),
      urgent: urgent ? `urgent: ${urgent}` : null,
      status: said.length ? said.join("; ") : "nothing to carry",
      carriers: carried.map((j) => j.by),
      busy: carried.length > 0,
      waiting: mine.some((j) => j.phase === "unloading"),
      stuck: Boolean(nobody) || (short && !source),
    };
  });
}
