// The ship's work board. Every job of carrying from one store to another is kept here, and this is the only part of
// the game that sends anyone to carry: a job comes up when the store an errand keeps up runs short
// (world/logistics/<place>.txt, its Errands lines), the first of its people who's free takes it, walks to the store
// they fetch from, takes what they can carry, walks it over and puts it in. Nobody is counted in two places: someone
// the medbay, an alarm, a repair or the player has taken is given no job, and a carrier who's called away, or who
// can't go on, hands the job back with whatever they'd loaded, for the next free hand. A walk takes as long as the
// way through the decks is, at the pace of whoever's walking, whether or not anyone is watching.
//
// This is step 1 of the logistics rework (docs/notes/project-logistics.md, "The rework"): the board does what the
// errands did, and no more. What's kept in the save is where it was, game.logistics[place].errands, by the errand's
// id: a job under way is { phase, since, load, by, took, walk }, and one set down with its load has nobody (by: null,
// phase "down"). A job nobody has taken yet isn't kept at all: it's there whenever the store is short.

import { handsFree } from "./body.js";
import { storeCounts, storePut, storeTake } from "./bag.js";
import { YOU, calledBy, holderKey, jobById, lostReason, onJob, personCalled, postAndName } from "./command.js";
import { hasReached, notAbout, walkMinutes } from "./life.js";
import { itemWords, logisticsOf, storeById } from "./logistics.js";
import { medbayDetour } from "./medbay.js";
import { detourExtras } from "./room-hooks.js";
import { dutyDetour } from "./systems.js";

// How long a walk is taken to be when there's no telling how far it is.
const WALK_MINUTES = 15;
const NOBODY_HELD = () => null;
const loadWords = (item, n) => `${n} ${itemWords(item, n)}`;
const clockWords = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(Math.floor(minutes) % 60).padStart(2, "0")}`;
const boardOf = (game, place) => game.logistics?.[place]?.errands ?? null;

// The spot a job has its carrier at: beside the store they fetch from, or beside the one they carry to.
const whereOf = (e, s) => `store:${s.phase === "carrying" || s.phase === "unloading" ? e.to : e.from}`;
// What a job's carrier is doing, in words, from where it's got to.
function doingWords(model, e, s) {
  const from = storeById(model, e.from);
  const to = storeById(model, e.to);
  if (s.phase === "going") return `fetching ${itemWords(e.item, 2)} from the ${from.name}`;
  if (s.phase === "loading") return `taking ${itemWords(e.item, 2)} from the ${from.name}`;
  if (s.phase === "waiting") return `waiting at the ${from.name} for ${itemWords(e.item, 2)}`;
  if (s.phase === "carrying") return `carrying ${loadWords(s.load.item, s.load.n)} to the ${to.name}`;
  return `waiting at the ${to.name} for room for ${loadWords(s.load.item, s.load.n)}`;
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

// Who could take a job: everyone doing the job its errand names, in the watch bill's order, whoever holds the post
// it names, or the person it names. Never the player, who carries when they choose to.
const couldTake = (game, place, e) => (e.job ? onJob(game, place, e.job) : [e.post ? holderKey(game, place, e.post) : e.key]).filter((key) => key && key !== YOU);
// Who's on a job: whoever took it. A job kept by the errands of an older save could name nobody, and is then
// whoever its errand names, by post or by name; one set down with its load has nobody until someone takes it up.
const carrierOf = (game, place, e, s) => s.by ?? (s.phase !== "down" && !e.job ? couldTake(game, place, e)[0] ?? null : null);

// Why someone can't take a job just now, in a few words, or null when they can: dead, in the brig or laid up, a
// hand that's no use, taken by something more pressing, already carrying, or asleep.
function whyNot(game, place, key, hours, board, model, held) {
  const lost = lostReason(game, place, key);
  if (lost) return lost;
  if (!handsFree(game, place, key)) return "hurt in the hand";
  const taken = held(key);
  if (taken) return taken;
  const other = model.errands.find((one) => board[one.id]?.by === key);
  if (other) return doingWords(model, other, board[other.id]);
  return notAbout(game, place, key, hours);
}

// Why nobody's on a job, for the Ship menu: each of its people with what keeps them, or that there's nobody to ask.
// Null when someone's free, which is to say it's about to be taken up.
function whyNobody(game, place, e, hours, board, model, held) {
  const people = couldTake(game, place, e);
  if (!people.length) return e.post ? "nobody holds the post" : e.job ? "nobody does this job" : "there's nobody of that name";
  const reasons = people.map((key) => [key, whyNot(game, place, key, hours, board, model, held)]);
  if (reasons.some(([, why]) => !why)) return null;
  return `nobody free: ${reasons.map(([key, why]) => `${calledBy(game, place, key)} is ${why}`).join(", ")}`;
}

// The minutes of a walk for a job: from where its carrier is (or from a store) to a store, by the way through the
// decks. A walk nobody can measure takes a quarter of an hour.
const walkFor = (game, place, key, from, to, hours) => walkMinutes(game, place, key, from, to, hours) ?? WALK_MINUTES;

// Whether a job's carrier has got where its walk was taking them: when the minutes of the walk have gone by, or
// sooner if they're being watched and their own feet have got them there.
function there(game, place, s, where, t) {
  if (t - s.since >= (s.walk ?? WALK_MINUTES)) return true;
  return place === game.location && Boolean(game.life?.places?.[place]?.[s.by]) && hasReached(game, place, s.by, where);
}

// The board over one piece of the clock, as long as chunk minutes. A job comes up when the store an errand keeps up
// is short, and the first of its people who's free takes it: they go to the store they fetch from, stand there a
// piece of the clock and take what they can carry, or wait there when there's nothing, carry it over and put it in,
// and go back to their day; and again while the store's still short.
export function runBoard(game, place, model, state, t, chunk) {
  const board = (state.errands ??= {});
  const hours = t / 60;
  // Who's taken by something more pressing is looked up once, and only when a job needs to know.
  let holds = null;
  const held = (key) => (holds ??= holdsAt(game, place))(key);
  for (const e of model.errands) {
    const from = storeById(model, e.from);
    const to = storeById(model, e.to);
    const have = () => storeCounts(game, to.key, to.holds)[e.item] ?? 0;
    const room = () => Math.max(0, (to.holds[e.item] ?? 0) - have());
    let s = board[e.id];
    // A job from a save of before the board named nobody: it's whoever its errand names, or it's over.
    if (s && !s.by && s.phase !== "down") {
      s.by = carrierOf(game, place, e, s);
      if (!s.by) {
        delete board[e.id];
        s = undefined;
      }
    }
    // Its carrier has been called to something more pressing, or can't go on: the job's handed back, and whatever
    // they'd loaded is set down for the next free hand.
    if (s?.by && (lostReason(game, place, s.by) || !handsFree(game, place, s.by) || held(s.by))) {
      if (s.load) Object.assign(s, { phase: "down", since: t, by: null });
      else {
        delete board[e.id];
        s = undefined;
      }
    }
    if (!s?.by) {
      if (!s && have() >= e.under) continue;
      const who = couldTake(game, place, e).find((key) => !whyNot(game, place, key, hours, board, model, held)) ?? null;
      if (!who) continue;
      // Whoever picks up a load that was set down carries it straight on to where it was going.
      board[e.id] = s
        ? { ...s, phase: "carrying", since: t, by: who, took: t, walk: walkFor(game, place, who, null, `store:${e.to}`, hours) }
        : { phase: "going", since: t, load: null, by: who, took: t, walk: walkFor(game, place, who, null, `store:${e.from}`, hours) };
      continue;
    }
    if (s.phase === "going") {
      if (there(game, place, s, whereOf(e, s), t)) Object.assign(s, { phase: "loading", since: t });
    } else if (s.phase === "loading" || s.phase === "waiting") {
      if (s.phase === "loading" && t - s.since < chunk) continue;
      const want = Math.min(e.each, room());
      if (want <= 0) {
        delete board[e.id];
        continue;
      }
      const took = storeTake(game, from.key, from.holds, e.item, want);
      if (took <= 0) {
        s.phase = "waiting";
        continue;
      }
      Object.assign(s, { phase: "carrying", since: t, load: { item: e.item, n: took }, walk: walkFor(game, place, s.by, `store:${e.from}`, `store:${e.to}`, hours) });
    } else if (there(game, place, s, whereOf(e, s), t)) {
      s.load.n -= storePut(game, to.key, to.holds, s.load.item, s.load.n);
      if (s.load.n > 0) s.phase = "unloading";
      else delete board[e.id];
    }
  }
}

// What the board has someone doing and where, for the life engine's walks: null when nobody's on a job.
export function workDetour(game, place) {
  const model = logisticsOf(place);
  const board = boardOf(game, place);
  if (!model?.errands?.length || !board) return null;
  const mine = new Map();
  for (const e of model.errands) {
    const s = board[e.id];
    const by = s ? carrierOf(game, place, e, s) : null;
    if (by) mine.set(by, { where: whereOf(e, s), doing: doingWords(model, e, s) });
  }
  return mine.size ? (key) => mine.get(key) ?? null : null;
}

// Every job the board knows of, for the Ship menu: what's carried and by what rule, who's on it and since when, or
// why nobody is. Reading this changes nothing.
export function workView(game, place) {
  const model = logisticsOf(place);
  if (!model) return [];
  const board = boardOf(game, place) ?? {};
  const hours = game.clock.hours;
  let holds = null;
  const held = (key) => (holds ??= holdsAt(game, place))(key);
  return model.errands.map((e) => {
    const from = storeById(model, e.from);
    const to = storeById(model, e.to);
    const kept = board[e.id] ?? null;
    const by = kept ? carrierOf(game, place, e, kept) : null;
    // A job is someone carrying, or a load that's been set down; anything else that's kept is over.
    const s = kept && (by || kept.load) ? kept : null;
    const short = !s && (storeCounts(game, to.key, to.holds)[e.item] ?? 0) < e.under;
    // A job with nobody on it, one that's come up or one that's been set down: who'd take it, and what keeps them.
    const open = short || Boolean(s && !by);
    const nobody = open ? whyNobody(game, place, e, hours, board, model, held) : null;
    const waits = nobody ?? "about to be taken up";
    return {
      id: e.id,
      who: e.post ? postAndName(game, place, e.post) ?? `Nobody: ${e.who} is nobody's post`
        : e.job ? (by ? personCalled(game, by) : `A ${jobById(place, e.job)?.title ?? e.job}`)
        : e.who,
      does: `${itemWords(e.item, 2)} from the ${from.name} to the ${to.name} when under ${e.under}, ${e.each} at a time`,
      status: by ? doingWords(model, e, s) : s ? `${loadWords(s.load.item, s.load.n)} set down, ${waits}` : short ? waits : "nothing to carry",
      since: by ? clockWords(s.took ?? s.since) : null,
      busy: Boolean(by),
      waiting: Boolean(s && (s.phase === "waiting" || s.phase === "unloading")),
      stuck: Boolean(nobody),
    };
  });
}
