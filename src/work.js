// The ship's work board: the one list of who's doing what for the ship, and the only part of the game that sends
// anyone to carry between her stores or to mend what's broken. Each kind of work has its own people, and all of it
// comes in one order of urgency, which the place's file gives (world/logistics/<place>.txt, its Urgency part): one
// person, one job, the most urgent first, and someone already at work drops it only for a job that's clearly more
// urgent, two lines higher or more.
//
// Carrying. Nobody writes the routes: each store's line says what it wants kept in it, when that's urgent and who
// carries for it. Whenever a store has fewer of something than it wants, and some other store can spare it, a job
// comes up: the first of the store's carriers who's free takes it, walks to the nearest store that can spare the
// thing, takes what one trip carries, walks it over and puts it in. What they've gone for is set aside for them, so
// two people never go for the same crates, and as many go at once as the want needs. Where nothing aboard can be
// spared, nobody is sent to stand at an empty store. A want is urgent when the store is under the mark its line
// gives, or when whatever uses the thing up is asking: a machine with nothing left to work from, the medbay with
// someone waiting and no doses, a repair waiting for its spare.
//
// Repairs. Something broken is mended in its last hour by an engineer the board has put on it, who fetches the spare
// and then works at it (src/systems.js walks them and says what they're doing). A repair nobody can take waits: its
// hour starts when someone does. One of the power or the air is a repair the ship can't do without.
//
// Fires and breaches. An engineer is sent to each, walks there, and is on that job until the fire's out or the
// hull's patched (src/emergencies.js says when that is: never sooner than the time its file gives, and not at all
// while nobody's got there). The guards answering an alarm are on a job too, which nothing takes them off.
//
// The medbay and the workshop. They keep their own records of who's carrying whom, who's treating whom and what's
// on the bench (src/medbay.js, src/workshop.js), and the board reads those as jobs like its own: whoever's on one is
// on a job, and can be taken off it for something clearly more urgent. Who answers a call for someone down is the
// board's choice (callHand): the first of the people the health file names, in its order, who's free or can leave
// lesser work for it. The medics and the menders start nothing with someone who's on other work for the board.
//
// The officers give the board its orders, not the captain. Whoever holds the post the file's "what comes first"
// line names (the first officer) looks at how the ship stands every so often and puts one part of her first: the
// medbay, the engines, the galley or repairs, whichever is in the most trouble, or none. Whoever holds the post its
// "what stores want" line names (the quartermaster) raises what a store wants by a trip's worth after it has run
// low, and eases it back once it's been quiet for some days. How often each looks goes by their skill for the post.
// With a post empty, or its holder laid up or locked up, nobody decides: jobs go as they come, and the stores want
// what they wanted. The player can take any job that nobody's on, and the crew leaves it to them for a while.
//
// Nobody is counted in two places: someone the medbay, an alarm or the player has taken is given no job, and whoever
// is called away, or can't go on, hands the job back, with whatever they'd loaded, for the next free hand. A walk
// takes as long as the way through the decks is, at the pace of whoever's walking, whether or not anyone is watching.
//
// Left waiting. A job that's asking for a hand and getting none, or for goods there are none of aboard, is kept
// (game.logistics[place].waiting, by the id the Work page knows it by: since when, and which of the two it wants).
// After the time the file's left waiting line gives, whoever that part of the ship belongs to (its who asks line)
// has it to bring to the player, through the requests (src/requests.js): yes takes it on, and the board then leaves
// the job to them. The written story can ask whether anything's waiting and what comes first, put a part of the ship
// first itself, and give the board a job of its own (src/work-hook.js has the words).
//
// This is steps 1, 3, 4, 5 and 6 of the logistics rework. What's kept in
// the save is game.logistics[place].jobs, a list. A carrying job is { id, kind, to, item, from, n, phase, since, load,
// by, took, walk }, and one set down with its load has nobody (by: null, phase "down"); a repair is { id, kind, ref,
// what, by, took, since }. Work nobody has taken up yet isn't kept at all: it's there whenever the store is short or
// the thing is broken. The officers' orders are game.logistics[place].orders: first ({ part, why, by, holder, since,
// looked, next }), levels (who last looked, when, and when they look next), wants (a store's want where the
// quartermaster has changed it), urgent (what's run low since they last looked) and mine (the jobs the player has
// taken). A save from before step 3 kept its jobs by their errands (game.logistics[place].errands), and whatever
// those had loaded is put back in the stores the first time the board runs.

import { handsFree } from "./body.js";
import { storeCounts, storePut, storeTake } from "./bag.js";
import { YOU, calledBy, holderKey, lostReason, onJob, postById, speedOf } from "./command.js";
import { ITEMS } from "./data.js";
import { hasReached, notAbout, walkMinutes } from "./life.js";
import { burnOn, patchBreach, troublesAt } from "./emergencies.js";
import { countAboard, countOf, itemWords, logisticsOf, machineStarved, putAboard, storeById, tripOf } from "./logistics.js";
import { downAt, downRecord, medbayCalled, medbayHands, medbayOf, medbayRows, medbayWork } from "./medbay.js";
import { workshopHands, workshopRows, workshopWork } from "./workshop.js";
import { addOrder, addRoomActs, detourExtras } from "./room-hooks.js";
import { passTime } from "./rules.js";
import { airMoves, alarmWork, anyWaitingForParts, dutyDetour, engineersOf, finishRepair, holdRepair, partsWaitingRefs, repairNow, repairsDue, repairsWaiting, waitingForParts } from "./systems.js";
import { countNote, rationLook } from "./water.js";
import { worthOf } from "./worth.js";
import { notePut, putsOf } from "./puts.js";
import { recordFact } from "./record.js";
import { storyJobFact, tellWork } from "./work-hook.js";

// How long a walk is taken to be when there's no telling how far it is.
const WALK_MINUTES = 15;
// The most jobs one want raises in a piece of the clock: more than there are ever hands for.
const MOST_AT_ONCE = 8;
// The officers are asked whether it's time to look again this often, in minutes of the clock.
const LOOK_EVERY = 15;
// A want the quartermaster raised is eased back a step once it's gone this many days without running low.
const EASE_DAYS = 3;
// How long the crew leaves a job to the player who said they'd do it: less when it's urgent.
const MINE_MINUTES = 120;
const MINE_URGENT = 45;
// The parts of the ship the first officer can put first, in the order they come when two are in equal trouble.
const PARTS = ["medbay", "engines", "galley", "repairs"];
const PART_WORDS = { medbay: "the medbay", engines: "the engines", galley: "the galley", repairs: "repairs" };
const NOBODY_HELD = () => null;
const loadWords = (item, n) => `${n} ${itemWords(item, n)}`;
const clockWords = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(Math.floor(minutes) % 60).padStart(2, "0")}`;
// "09:10" today, "day 2, 09:10" for another day.
const whenWords = (minutes, now) => (Math.floor(minutes / 1440) === Math.floor(now / 1440) ? clockWords(minutes) : `day ${Math.floor(minutes / 1440) + 1}, ${clockWords(minutes)}`);
// "at 09:10" today, "on day 2" for another day.
const whenAt = (minutes, now) => (Math.floor(minutes / 1440) === Math.floor(now / 1440) ? `at ${clockWords(minutes)}` : `on day ${Math.floor(minutes / 1440) + 1}`);
const upperFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : "");
// Someone as the ship calls them, at the start of a line: by their post, their title or their name.
const nameAt = (game, place, key) => upperFirst(calledBy(game, place, key));
const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const countWords = (n) => NUMBERS[n] ?? String(n);
const jobsAt = (game, place) => game.logistics?.[place]?.jobs ?? [];
const haveOf = (game, store, item) => storeCounts(game, store.key, store.holds)[item] ?? 0;
const wantKey = (want) => `${want.store}:${want.item}`;
// What a store wants of a thing now: what the quartermaster last set, or what its line says.
const levelOf = (state, storeId, item) => state?.orders?.wants?.[`${storeId}:${item}`]?.n ?? null;
const wantsNow = (state, want) => levelOf(state, want.store, want.item) ?? want.wants;

// ---- The order of urgency ---------------------------------------------------------------------------------

// Where a kind of work comes in the place's order, the most urgent being 0.
const rankOf = (model, kind) => {
  const at = (model.urgency ?? []).indexOf(kind);
  return at < 0 ? 99 : at;
};
// Someone already at work drops it only for a job this many lines higher in the order, or more.
const CLEARLY = 2;
// The kinds of work that wake a sleeper when nobody's up.
const WAKES = new Set(["bleeding", "fire", "breach", "fallen", "alarm", "carry_urgent", "repair_critical"]);
// What a ship can't do without: whatever carries her power, and the plant that makes her air. A repair to one of
// those comes before the rest. (A vent is only its own room's air.)
const kindOfJob = (j) => j.kind ?? (j.ref ? "repair" : "carry");
const repairKind = (repair) => (repair.system === "power" || repair.part?.kind === "air plant" ? "repair_critical" : "repair");
const repairKey = (ref) => `repair:${ref}`;
// The part of the ship a repair belongs to, for what comes first: the power and the engines are the engines', what's
// in the medbay is the medbay's, what's where the cooking's done is the galley's, and the rest is plain repairs.
function partOfRepair(model, place, repair) {
  if (repair.system === "power" || repair.system === "engines") return "engines";
  if (medbayOf(place)?.room === repair.room) return "medbay";
  if (model.machines.some((m) => m.gives?.count && m.room === repair.room)) return "galley";
  return "repairs";
}
// Whether a repair is in the part of the ship that's been put first: with repairs first, all of them are.
const repairFirst = (model, place, repair, firstPart) => Boolean(firstPart) && (firstPart === "repairs" || partOfRepair(model, place, repair) === firstPart);

// Whether a place's work is given out by a board: wherever it has a logistics file. There the systems leave the
// repairs to it (src/systems.js).
export const boardRuns = (place) => Boolean(logisticsOf(place));
// Who the board has mending what, for the systems to walk them there.
export const repairHands = (game, place) => jobsAt(game, place).filter((j) => j.ref && j.by).map((j) => ({ key: j.by, ref: j.ref }));

// The spot a carrying job has its carrier at: beside the store they fetch from, or beside the one they carry to.
const whereOf = (j) => `store:${j.phase === "carrying" || j.phase === "unloading" ? j.to : j.from}`;
// What a job has whoever's on it doing, in words, from where it's got to.
function doingWords(model, j) {
  if (j.doing) return j.doing;
  if (j.ref) return `mending ${j.what ?? "what's broken"}`;
  if (j.story) return `at work in ${j.roomName}`;
  if (j.room) return j.kind === "fire" ? `fighting the fire in ${j.what}` : `patching the hull in ${j.what}`;
  const from = storeById(model, j.from);
  const to = storeById(model, j.to);
  if (j.phase === "going") return `fetching ${itemWords(j.item, 2)} from the ${from?.name ?? "stores"}`;
  if (j.phase === "loading") return `taking ${itemWords(j.item, 2)} from the ${from?.name ?? "stores"}`;
  if (j.phase === "carrying") return `carrying ${loadWords(j.load.item, j.load.n)} to the ${to?.name ?? "stores"}`;
  return `waiting at the ${to?.name ?? "stores"} for room for ${loadWords(j.load.item, j.load.n)}`;
}

// Who something outside the board has taken, with what they're doing about it: whoever's hurt and making their own
// way to the medbay (src/medbay.js), and whoever's walking with the player, sent to the medbay or in a brawl
// (src/room-hooks.js). (Whoever's down is lost to their job altogether, which the chain of command says, and
// whoever's gone to help them, or to an alarm, is on a job of the board's.) Bad air isn't one of them: a ship with
// no power has no air, and someone still has to carry the cell that brings both back.
function holdsAt(game, place) {
  const extras = detourExtras(game, place);
  let walking = false;
  for (const key in game.down ?? {}) if (game.down[key].place === place && game.down[key].going) walking = true;
  if (!extras && !walking) return NOBODY_HELD;
  return (key) => (walking && downRecord(game, place, key)?.going ? `making their own way to ${medbayCalled(place)}` : null) ?? extras?.(key, null, false)?.doing ?? null;
}

// The work other parts of the game keep their own records of, as jobs like the board's own: whoever's answering a
// call or treating someone (src/medbay.js), whoever's at the workshop's bench (src/workshop.js), and the guards
// answering an alarm (src/systems.js). Each is { kind, by, doing, drop }, drop being how they're taken off it, and
// fixed when nothing does.
const NO_OTHERS = Object.freeze([]);
function othersWork(game, place) {
  const medbay = medbayWork(game, place);
  const workshop = workshopWork(game, place);
  const alarm = alarmWork(game, place);
  return medbay.length || workshop.length || alarm.length ? [...alarm, ...medbay, ...workshop] : NO_OTHERS;
}

// The board as it stands at a moment: its own jobs, the work kept elsewhere, and who's taken by something outside
// it, each looked up once and only when someone asks.
function standing(game, place, model, hours = game.clock.hours) {
  const jobs = jobsAt(game, place);
  let holds = null;
  let others = null;
  const at = {
    game, place, model, hours, jobs,
    held: (key) => (holds ??= holdsAt(game, place))(key),
    others: () => (others ??= othersWork(game, place)),
    // What someone's on: a job of the board's own, or work kept elsewhere.
    taken: (key) => jobs.find((j) => j.by === key) ?? at.others().find((o) => o.by === key) ?? null,
    // The work kept elsewhere has changed, and is to be read again.
    stale: () => { others = null; },
  };
  return at;
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
// Who mends: the place's engineers, as its systems file has them. Never the player.
const menders = (game, place) => engineersOf(game, place).filter((key) => key && key !== YOU);

// Why someone can't take a job just now, in a few words, or null when they can: dead, in the brig or laid up, a
// hand that's no use, taken by something outside the board, already on a job, or asleep. Urgent work wakes a sleeper.
function whyNot(at, key, wake = false) {
  const { game, place, model, hours } = at;
  const lost = lostReason(game, place, key);
  if (lost) return lost;
  if (!handsFree(game, place, key)) return "hurt in the hand";
  const taken = at.held(key);
  if (taken) return taken;
  const other = at.taken(key);
  if (other) return doingWords(model, other);
  const about = notAbout(game, place, key, hours);
  return wake && about === "asleep" ? null : about;
}
// Whether nothing keeps someone but the job they're on: they could leave it, if what's asked is urgent enough.
const onlyBusy = (at, key) => !lostReason(at.game, at.place, key) && handsFree(at.game, at.place, key) && !at.held(key);

// Someone for a job, of the people who do that kind of work: the first who's free; failing that, whoever of them is
// on the least urgent job that's clearly less urgent than this one, who drops it for this; and failing that, for
// work that wakes sleepers, the first who's only asleep. (Nobody's woken while someone who's up could leave lesser
// work for it.) With inOrder the people are asked strictly first to last, and the first who's free or can leave
// what they're at is the one: for a call, where the health file's order is who ought to go. With dry nobody's taken
// off anything. It gives { key, woken }, or null.
function handFor(at, people, kind, { inOrder = false, dry = false } = {}) {
  const { model } = at;
  const rank = rankOf(model, kind);
  // What someone would leave for this: the job they're on, when it's clearly less urgent and nothing else keeps them.
  const lesser = (key) => {
    const theirs = at.taken(key);
    return theirs && !theirs.fixed && rankOf(model, kindOfJob(theirs)) - rank >= CLEARLY && onlyBusy(at, key) ? theirs : null;
  };
  const leaving = (key, job) => {
    if (!dry) at.release(job);
    return { key, woken: false };
  };
  if (inOrder) {
    for (const key of people) {
      if (!whyNot(at, key)) return { key, woken: false };
      const job = lesser(key);
      if (job) return leaving(key, job);
    }
  } else {
    const free = people.find((key) => !whyNot(at, key));
    if (free) return { key: free, woken: false };
    let worst = null;
    for (const key of people) {
      const job = lesser(key);
      if (!job) continue;
      const gap = rankOf(model, kindOfJob(job)) - rank;
      if (!worst || gap > worst.gap) worst = { key, job, gap };
    }
    if (worst) return leaving(worst.key, worst.job);
  }
  const woken = WAKES.has(kind) ? people.find((key) => !whyNot(at, key, true)) : null;
  return woken ? { key: woken, woken: true } : null;
}

// Why nobody's on a job, for the Work page: what keeps the people who'd do it, the ones kept by the same thing
// counted together, or that there's nobody to ask. Null when someone's free, which is to say it's about to be taken
// up. also gives one of them a reason of the job's own, when nothing else keeps them.
function whyNobodyOf(at, people, { wake = false, nobody = "there's nobody to do it", also = null } = {}) {
  if (!people.length) return nobody;
  const { game, place } = at;
  const kept = new Map();
  for (const key of people) {
    const why = whyNot(at, key, wake) ?? also?.(key) ?? null;
    if (!why) return null;
    kept.set(why, [...(kept.get(why) ?? []), key]);
  }
  const said = [...kept].map(([why, keys]) => ({ n: keys.length, words: keys.length === 1 ? `${calledBy(game, place, keys[0])} is ${why}` : `${keys.length} are ${why}` }));
  const shown = said.slice(0, 3);
  const more = said.slice(3).reduce((sum, one) => sum + one.n, 0);
  return `nobody free: ${shown.map((one) => one.words).join(", ")}${more ? `, and ${more} more can't come` : ""}`;
}
const whyNobody = (at, store, urgent) => whyNobodyOf(at, carriersFor(at.game, at.place, store), { wake: urgent, nobody: "there's nobody to carry for it" });

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
function sourceFor(game, place, model, state, jobs, to, item) {
  let best = null;
  for (const store of model.stores) {
    if (store.id === to.id || store.count || !(item in store.holds)) continue;
    const spare = haveOf(game, store, item) - (levelOf(state, store.id, item) ?? store.wants[item] ?? 0) - setAsideIn(jobs, store.id, item);
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
  if (model.repair?.item === item && model.repair.from.includes(store.id) && anyWaitingForParts(game, place)) return "a repair is waiting for it";
  if (game.medbay?.[place]?.short && medbayOf(place)?.medicine?.store === store.id && worthOf(item, "medicine") > 0) return "someone's waiting in the medbay";
  return null;
}

// ---- The officers' orders --------------------------------------------------------------------------------

// The part of the ship a want belongs to, for what comes first: the medbay's medicine, what the generator burns,
// what the galley cooks from, what repairs take. Null for anything else. Worked out once for each want.
const parts = new WeakMap();
function partOf(model, place, want) {
  if (!parts.has(want)) {
    const { store, item } = want;
    parts.set(want,
      medbayOf(place)?.medicine?.store === store || worthOf(item, "medicine") > 0 ? "medbay"
        : (model.generators ?? []).some((m) => m.from === store && m.takes.some((one) => one.item === item)) ? "engines"
          : model.machines.some((m) => m.gives?.count && m.from === store) || worthOf(item, "food") > 0 ? "galley"
            : model.repair?.item === item || worthOf(item, "parts") > 0 ? "repairs"
              : null);
  }
  return parts.get(want);
}

// What's pressing aboard, the worst first: each part of the ship that's in trouble, with how much and why in a few
// words. Someone lying where they fell counts for most, then a generator that's stopped or about to, then an empty
// kettle or a bare galley, then repairs waiting for parts. The first officer reads this when they look.
function pressing(game, place, model, state, t) {
  const out = [];
  const add = (part, score, why) => { if (score > 0) out.push({ part, score, why }); };
  const fallen = downAt(game, place).filter(([, d]) => !d.dead && !d.bed).length;
  const noDoses = Boolean(game.medbay?.[place]?.short);
  add("medbay", fallen * 3 + (noDoses ? 4 : 0), fallen ? `${countWords(fallen)} of the crew ${fallen === 1 ? "is" : "are"} down where they fell` : "someone's waiting in the medbay with no medicine to give them");
  const generators = model.generators ?? [];
  const stopped = generators.find((m) => (state.machines?.[m.id]?.burning ?? m.every) <= 0);
  const last = generators.find((m) => machineStarved(game, model, m));
  const low = model.wants.some((want) => partOf(model, place, want) === "engines" && haveOf(game, storeById(model, want.store), want.item) < want.urgent);
  add("engines", stopped ? 10 : last ? 6 : low ? 3 : 0, stopped ? `the ${stopped.name} has stopped` : last ? `the ${last.name} is on its last` : "there's hardly any fuel by the generator");
  const cooks = model.machines.filter((m) => m.gives?.count);
  const dry = model.kettles.length > 0 && model.kettles.every((kettle) => countOf(game, kettle) <= 0);
  const bare = cooks.find((m) => machineStarved(game, model, m));
  const hungry = (state.meals?.days?.[Math.floor(t / 1440)]?.missed ?? 0) > 0;
  add("galley", (dry ? 5 : 0) + (bare ? 4 : 0) + (hungry ? 2 : 0), dry ? "the kettle is empty" : bare ? `the ${bare.name} has nothing to cook` : "people went hungry today");
  const waiting = waitingForParts(game, place).length;
  add("repairs", waiting * 3, `${countWords(waiting)} ${waiting === 1 ? "repair is" : "repairs are"} waiting for parts`);
  return out.sort((a, b) => b.score - a.score || PARTS.indexOf(a.part) - PARTS.indexOf(b.part));
}

// Whoever holds a deciding post, and why they can't decide if they can't: nobody holds it, or its holder is dead,
// locked up or laid up. The player holds none of them: the captain's choice was to leave the board to the officers.
function deciderNow(game, place, decider) {
  const key = holderKey(game, place, decider.post);
  if (!key) return { key: null, why: `nobody is ${decider.words}` };
  if (key === YOU) return { key: null, why: `you're ${decider.words} yourself, and nobody else decides` };
  const lost = lostReason(game, place, key);
  return lost ? { key: null, why: `${calledBy(game, place, key)} is ${lost}` } : { key, why: null };
}
// How long whoever holds a deciding post goes between looks: the file's time, shorter for someone good at the post's
// own skill and longer for someone who isn't.
const paceOf = (game, place, decider, key) => decider.every / speedOf(game, place, [key], postById(place, decider.post)?.skills?.[0]);

// The quartermaster's look: every want that's run low since the last one is raised by a trip's worth, up to what its
// store holds, and one that was raised and has been quiet for some days is eased back a step, down to what its line
// says.
function setLevels(model, state, t, by) {
  const orders = state.orders;
  const levels = (orders.wants ??= {});
  const ran = orders.urgent ?? {};
  for (const want of model.wants) {
    const key = wantKey(want);
    const store = storeById(model, want.store);
    const now = levels[key]?.n ?? want.wants;
    const step = tripOf(model, want.item);
    if (ran[key]) {
      const n = Math.min(store.holds[want.item], now + step);
      if (n > now) levels[key] = { n, from: now, since: t, by, why: ran[key].why, calm: t };
      else if (levels[key]) levels[key].calm = t;
    } else if (levels[key] && t - levels[key].calm >= EASE_DAYS * 1440) {
      const n = Math.max(want.wants, now - step);
      if (n <= want.wants) delete levels[key];
      else levels[key] = { ...levels[key], n, calm: t };
    }
  }
  orders.urgent = {};
}

// The officers, asked every quarter of an hour whether it's time to look again: when someone new has the post, who
// looks at once, or when whoever has it is due another look, which is as often as their pace allows. Someone who
// can't decide when their look comes (nobody in the post, or its holder dead, locked up or laid up) decides nothing,
// and is asked again a quarter of an hour on. Between looks the last order stands.
function officersLook(game, place, model, state, t, notes = null) {
  const orders = (state.orders ??= {});
  // An order the written story gave stands until its time is up, whoever holds the post.
  const due = (decider, was) => !was || t >= was.next || (!was.story && (holderKey(game, place, decider.post) ?? null) !== was.holder);
  const first = model.deciders.first;
  if (first && due(first, orders.first)) {
    const holder = holderKey(game, place, first.post) ?? null;
    const who = deciderNow(game, place, first);
    const was = orders.first;
    if (who.why) orders.first = { part: null, why: who.why, by: null, holder, since: was && was.by === null && was.why === who.why ? was.since : t, looked: t, next: t + LOOK_EVERY };
    else {
      const top = pressing(game, place, model, state, t)[0] ?? null;
      const part = top?.part ?? null;
      orders.first = { part, why: top?.why ?? "nothing's pressing", by: who.key, holder, since: was && was.by === who.key && was.part === part ? was.since : t, looked: t, next: t + paceOf(game, place, first, who.key) };
    }
  }
  const levels = model.deciders.levels;
  if (levels && due(levels, orders.levels)) {
    const holder = holderKey(game, place, levels.post) ?? null;
    const who = deciderNow(game, place, levels);
    if (who.why) orders.levels = { by: null, why: who.why, holder, looked: orders.levels?.looked ?? t, next: t + LOOK_EVERY };
    else {
      setLevels(model, state, t, who.key);
      // Whoever decides what the stores want decides whether water's rationed too, at the same look (src/water.js).
      if (model.water) {
        const said = rationLook(game, place, model, state, t, who.key);
        if (notes) notes.push(...said);
      }
      orders.levels = { by: who.key, why: null, holder, looked: t, next: t + paceOf(game, place, levels, who.key) };
    }
  }
}

// ---- The jobs the player has taken -----------------------------------------------------------------------

// What the player has to do for a carrying job they've taken, in a line for the corner of the screen.
function mineWords(game, place, model, state, want) {
  const store = storeById(model, want.store);
  const need = Math.max(1, wantsNow(state, want) - haveOf(game, store, want.item));
  const source = sourceFor(game, place, model, state, jobsAt(game, place), store, want.item);
  return `Bring ${loadWords(want.item, need)} to the ${store.name} in ${store.roomName}. ${source ? `The ${source.store.name} in ${source.store.roomName} ${/s$/i.test(source.store.name) ? "have" : "has"} some.` : "None of her other stores has any to spare: buy some, or bring your own."}`;
}
const questOf = (game, key) => (game.quests ?? []).find((quest) => quest.id === `work:${key}`) ?? null;
function dropQuest(game, key) {
  if (questOf(game, key)) game.quests = game.quests.filter((quest) => quest.id !== `work:${key}`);
}
// A job of the player's own goes in the corner of the screen like a quest, and is what the corner follows.
function addQuest(game, key, title, objective, now, urgent) {
  game.quests ??= [];
  dropQuest(game, key);
  game.quests.push({
    id: `work:${key}`, title, main: false, status: "active", work: true,
    desc: `You said you'd do it yourself, on day ${Math.floor(now / 1440) + 1} at ${clockWords(now)}. The crew leaves it to you for ${urgent ? `${MINE_URGENT} minutes, since it's urgent` : `${MINE_MINUTES / 60} hours`}.`,
    objective,
  });
  game.following = `work:${key}`;
}

// The jobs the player said they'd do, each piece of the clock: one is over when its store has what it wants or the
// thing is mended, and goes back to the crew when the player hasn't got to it in time.
function tendMine(game, place, model, state, t, notes) {
  const mine = state.orders?.mine;
  if (!mine) return;
  let waiting = null;
  for (const [key, held] of Object.entries(mine)) {
    const over = (line) => {
      delete mine[key];
      dropQuest(game, key);
      if (line && notes && game.location === place) notes.push(line);
    };
    // Taken through an ask (src/requests.js): the request says how it ended, and the board only keeps the crew off
    // the job until its time is up or it's done.
    if (held.ask) {
      if (t >= held.until || !jobAt(game, place, model, state, key)) delete mine[key];
      continue;
    }
    if (key.startsWith("repair:")) {
      const repair = (waiting ??= repairsWaiting(game, place)).find((one) => repairKey(one.ref) === key);
      if (!repair) over(`[WORK] ${upperFirst(held.what ?? "what was broken")} is mended. That job was yours.`);
      else if (t - held.since >= (repairKind(repair) === "repair_critical" ? MINE_URGENT : MINE_MINUTES)) over(`[WORK] ${upperFirst(repair.what)} is still broken, so the engineers take the job back.`);
      continue;
    }
    const want = model.wants.find((one) => wantKey(one) === key);
    const store = want ? storeById(model, want.store) : null;
    if (!want) {
      over(null);
      continue;
    }
    const have = haveOf(game, store, want.item);
    const plural = /s$/i.test(store.name);
    if (have >= wantsNow(state, want)) {
      over(`[WORK] The ${store.name} ${plural ? "have" : "has"} the ${itemWords(want.item, 2)} ${plural ? "they want" : "it wants"}. That job was yours.`);
      continue;
    }
    if (t - held.since >= (urgentWhy(game, place, model, store, want.item, have) ? MINE_URGENT : MINE_MINUTES)) {
      over(`[WORK] The ${store.name} ${plural ? "are" : "is"} still short of ${itemWords(want.item, 2)}, so the crew takes the job back.`);
      continue;
    }
    const quest = questOf(game, key);
    const words = mineWords(game, place, model, state, want);
    if (quest && quest.objective !== words) quest.objective = words;
  }
  if (!Object.keys(mine).length) delete state.orders.mine;
}

// The player taking a job nobody's on, or giving one back: carrying for a store (its id is <store>:<item>), or
// mending something (repair:<its part>). It gives the words for what was done.
export function workCommand(game, place, { action, id } = {}) {
  const model = logisticsOf(place);
  const state = game.logistics?.[place];
  if (!model || !state) throw new Error("There's no job like that on the board.");
  const orders = (state.orders ??= {});
  const now = Math.floor(game.clock.hours * 60 + 1e-6);
  const mending = String(id).startsWith("repair:");
  const repair = mending ? repairsWaiting(game, place).find((one) => repairKey(one.ref) === id) ?? null : null;
  const want = mending ? null : model.wants.find((one) => wantKey(one) === id);
  if (action === "leave") {
    if (!orders.mine?.[id]) throw new Error("That one isn't yours.");
    if (orders.mine[id].ask) throw new Error("You gave your word on that one: it's in your quests (J), under Requests.");
    const what = orders.mine[id].what;
    delete orders.mine[id];
    if (!Object.keys(orders.mine).length) delete orders.mine;
    dropQuest(game, id);
    if (mending) return { message: `${upperFirst(what ?? "It")} is the engineers' to mend again.` };
    const store = want ? storeById(model, want.store) : null;
    return { message: store ? `The ${store.name} ${/s$/i.test(store.name) ? "are" : "is"} the crew's to fill again.` : "It's the crew's again." };
  }
  if (action !== "mine") throw new Error("The board doesn't know that order.");
  if (!want && !repair) throw new Error("There's no job like that on the board.");
  if (game.location !== place) throw new Error(mending ? "You'd have to be aboard to mend it yourself." : "You'd have to be aboard to carry for her stores.");
  if (orders.mine?.[id]) throw new Error("That one's already yours.");
  if (mending) {
    const taken = jobsAt(game, place).find((j) => j.ref === repair.ref && j.by);
    if (taken) throw new Error(`${nameAt(game, place, taken.by)} is already on it.`);
    (orders.mine ??= {})[id] = { since: now, what: repair.what };
    const words = `Mend ${repair.what} yourself: walk up to it and fix it by hand.`;
    addQuest(game, id, `Mend the ${repair.name}`, words, now, repairKind(repair) === "repair_critical");
    return { message: `It's yours. ${words}` };
  }
  const store = storeById(model, want.store);
  if (haveOf(game, store, want.item) >= wantsNow(state, want)) throw new Error(`The ${store.name} ${/s$/i.test(store.name) ? "have what they want" : "has what it wants"}.`);
  const taken = jobsAt(game, place).find((j) => j.to === store.id && j.item === want.item && j.by);
  if (taken) throw new Error(`${nameAt(game, place, taken.by)} is already on it.`);
  (orders.mine ??= {})[id] = { since: now };
  const urgent = urgentWhy(game, place, model, store, want.item, haveOf(game, store, want.item));
  const words = mineWords(game, place, model, state, want);
  addQuest(game, id, `Carry for the ${store.name}`, words, now, Boolean(urgent));
  return { message: `It's yours. ${words}` };
}

// A save from before the stores said what they want kept its jobs by their errands. Whatever those had loaded goes
// back into the stores that keep it, and the wants raise their own jobs from there.
function settleOld(game, place, state) {
  if (!state.errands) return;
  for (const old of Object.values(state.errands)) if (old?.load?.n > 0) putAboard(game, place, old.load.item, old.load.n);
  delete state.errands;
}

// ---- Carrying ---------------------------------------------------------------------------------------------

// A carrying job over one piece of the clock: its carrier goes to the store they fetch from, stands there a piece of
// the clock and takes what was set aside for them, carries it over and puts it in.
function tendCarry(ctx, j) {
  const { game, place, model, t, chunk, hours, jobs } = ctx;
  const from = storeById(model, j.from);
  const to = storeById(model, j.to);
  // A job for a store the file no longer has is over, and what it had loaded goes back wherever it's kept.
  if (!from || !to) {
    if (j.load?.n > 0) putAboard(game, place, j.load.item, j.load.n);
    ctx.over(j);
    return;
  }
  if (!j.by) return;
  if (j.phase === "going") {
    if (there(game, place, j, t)) Object.assign(j, { phase: "loading", since: t });
  } else if (j.phase === "loading") {
    if (t - j.since < chunk) return;
    // What was set aside for them, or as much of it as is still there and still has somewhere to go.
    const room = Math.max(0, (to.holds[j.item] ?? 0) - haveOf(game, to, j.item) - comingTo(jobs, to.id, j.item, j));
    const took = storeTake(game, from.key, from.holds, j.item, Math.min(j.n, room));
    if (took <= 0) ctx.over(j);
    else Object.assign(j, { phase: "carrying", since: t, load: { item: j.item, n: took }, walk: walkFor(game, place, j.by, `store:${j.from}`, `store:${j.to}`, hours) });
  } else if (there(game, place, j, t)) {
    j.load.n -= storePut(game, to.key, to.holds, j.load.item, j.load.n);
    if (j.load.n > 0) j.phase = "unloading";
    else ctx.over(j);
  }
}

// A load that was set down asks for a hand: whoever picks it up carries it straight on to where it was going.
function loadAsks(ctx) {
  const { game, place, model, t, hours, jobs } = ctx;
  return jobs.filter((j) => !j.ref && !j.by && j.load).map((j) => ({
    rank: rankOf(model, kindOfJob(j)),
    order: -1,
    counts: "carrying",
    raise() {
      const who = handFor(ctx, carriersFor(game, place, storeById(model, j.to)), kindOfJob(j))?.key ?? null;
      if (who) Object.assign(j, { phase: "carrying", since: t, by: who, took: t, walk: walkFor(game, place, who, null, `store:${j.to}`, hours) });
      return 0;
    },
  }));
}

// The wants that aren't covered by what's there and what's on its way: each asks for as many carriers as it needs,
// while there's something to spare and someone to send. One the player has taken is left to them.
function carryAsks(ctx) {
  const { game, place, model, state, t, hours, jobs } = ctx;
  const firstPart = state.orders?.first?.part ?? null;
  const mine = state.orders?.mine ?? null;
  const asks = [];
  model.wants.forEach((want, order) => {
    const store = storeById(model, want.store);
    const have = haveOf(game, store, want.item);
    const wants = wantsNow(state, want);
    if (have + comingTo(jobs, store.id, want.item) >= wants) return;
    const why = urgentWhy(game, place, model, store, want.item, have);
    // What's run low is kept for the quartermaster's next look.
    if (why && model.deciders?.levels) ((state.orders ??= {}).urgent ??= {})[wantKey(want)] = { at: t, why };
    if (mine?.[wantKey(want)]) return;
    const kind = why ? "carry_urgent" : "carry";
    asks.push({
      // Within a kind, the part of the ship the first officer has put first goes before the rest.
      rank: rankOf(model, kind) - (firstPart && partOf(model, place, want) === firstPart ? 0.5 : 0),
      order,
      counts: "carrying",
      raise() {
        for (let raised = 0; raised < MOST_AT_ONCE; raised += 1) {
          const coming = comingTo(jobs, store.id, want.item);
          if (have + coming >= wants) return 0;
          const source = sourceFor(game, place, model, state, jobs, store, want.item);
          if (!source) {
            // Nothing aboard to bring, and nothing on its way: it waits for goods. What the ship makes herself (the
            // garden's produce) is only the next picking away, which is nothing to bring to anyone.
            if (!coming && !madeAboard(model, want.item)) ctx.stuck(wantKey(want), "goods");
            return 0;
          }
          const people = carriersFor(game, place, store);
          const who = handFor(ctx, people, kind)?.key ?? null;
          // An urgent want nobody can carry, though something aboard could be brought, is what the duty counts.
          if (!who) {
            if (!coming && nobodyEven(ctx, people)) ctx.stuck(wantKey(want), "hands");
            return why ? 1 : 0;
          }
          // A trip's worth, or what there's room for, or what can be spared: whichever is least.
          const n = Math.min(tripOf(model, want.item), store.holds[want.item] - have - coming, source.spare);
          jobs.push({ id: ctx.next(), kind, to: store.id, item: want.item, from: source.store.id, n, phase: "going", since: t, load: null, by: who, took: t, walk: walkFor(game, place, who, null, `store:${source.store.id}`, hours) });
        }
        return 0;
      },
    });
  });
  return asks;
}

// ---- Repairs ----------------------------------------------------------------------------------------------

// The repairs under way, over one piece of the clock: one whose engineer's hour is up by the end of it is done, if
// its spare is in the stores, and one that's been mended some other way, or is waiting for parts now, is over.
function tendRepairs(ctx) {
  const { game, place, t, chunk, jobs, notes } = ctx;
  const end = (t + chunk) / 60;
  for (const j of jobs.filter((one) => one.ref)) {
    const repair = repairNow(game, place, j.ref);
    // Mended some other way, waiting for parts, or put off till later (the engineers were told to mend something else
    // first): the job's over, and whoever was on it is free.
    if (!repair?.fixAt || repair.fixAt - t / 60 > 1 + 1e-6) ctx.over(j);
    else if (end >= repair.fixAt - 1e-9) {
      const lines = finishRepair(game, place, j.ref, j.by);
      if (notes) notes.push(...lines);
      ctx.over(j);
    }
  }
}

// What's broken and in its last hour asks for an engineer, who has that hour to fetch the spare and mend it. One
// nobody takes waits: its hour starts when someone does. One the player has taken is left to them.
function repairAsks(ctx, waiting) {
  const { game, place, model, state, t, hours, jobs } = ctx;
  const firstPart = state.orders?.first?.part ?? null;
  const mine = state.orders?.mine ?? null;
  let people = null;
  const asks = [];
  waiting.forEach((repair, order) => {
    if (repair.fixAt === null || repair.fixAt - hours > 1 || jobs.some((j) => j.ref === repair.ref)) return;
    if (mine?.[repairKey(repair.ref)]) {
      holdRepair(game, place, repair.ref, hours);
      return;
    }
    const kind = repairKind(repair);
    asks.push({
      rank: rankOf(model, kind) - (repairFirst(model, place, repair, firstPart) ? 0.5 : 0),
      order: 1000 + order,
      counts: "repairs",
      raise() {
        const who = handFor(ctx, (people ??= menders(game, place)), kind)?.key ?? null;
        if (who) jobs.push({ id: ctx.next(), kind, ref: repair.ref, what: repair.what, by: who, took: t, since: t });
        else {
          holdRepair(game, place, repair.ref, hours);
          if (nobodyEven(ctx, people)) ctx.stuck(repairKey(repair.ref), "hands");
        }
        // A repair the ship can't do without, with nobody to send to it, is what the duty counts.
        return !who && kind === "repair_critical" ? 1 : 0;
      },
    });
  });
  return asks;
}

// ---- Fires and breaches -----------------------------------------------------------------------------------

// Whoever the board sent to a fire or a breach, once they've got there: their key, or null while nobody has. What
// burns and what leaks asks this (src/emergencies.js). It goes by the time of the walk, so it comes out the same
// however the clock is cut.
export function troubleCrew(game, place, kind, room, hours) {
  const j = jobsAt(game, place).find((one) => one.kind === kind && one.room === room && one.by);
  return j && hours * 60 >= j.took + (j.walk ?? WALK_MINUTES) - 1e-6 ? j.by : null;
}

// The engineers at fires and breaches, over one piece of the clock: a job whose fire is out or whose hull is patched
// is over, and a breach is patched once whoever was sent has got there and the time the file gives has gone by
// since the plate went, if there's a parts crate aboard to do it with.
function tendTroubles(ctx, troubles) {
  const { game, place, t, chunk, jobs, notes } = ctx;
  const end = t + chunk;
  for (const j of jobs.filter(isTrouble)) {
    const trouble = troubles.find((one) => one.kind === j.kind && one.room === j.room);
    if (!trouble) ctx.over(j);
    else if (j.kind === "breach" && end >= j.took + (j.walk ?? WALK_MINUTES) && end >= trouble.since * 60 + trouble.minutes) {
      const { lines } = patchBreach(game, place, j.room, j.by);
      if (notes) notes.push(...lines);
      ctx.over(j);
    }
  }
}

// A fire or a breach with nobody on it asks for an engineer, who walks there. A breach that's waited for a parts
// crate asks again once there's one aboard.
function troubleAsks(ctx, troubles) {
  const { game, place, model, t, hours, jobs } = ctx;
  let people = null;
  let crates = null;
  const asks = [];
  troubles.forEach((trouble, order) => {
    if (jobs.some((j) => j.room === trouble.room && j.kind === trouble.kind)) return;
    if (trouble.waiting && !((crates ??= countAboard(game, place, ["parts_crate"])?.n ?? 0) > 0)) {
      ctx.stuck(`${trouble.kind}:${trouble.room}`, "goods");
      return;
    }
    asks.push({
      rank: rankOf(model, trouble.kind),
      order: 3000 + order,
      counts: "repairs",
      raise() {
        const who = handFor(ctx, (people ??= menders(game, place)), trouble.kind)?.key ?? null;
        // A fire or a breach with nobody to send to it is what the duty counts.
        if (!who) {
          ctx.stuck(`${trouble.kind}:${trouble.room}`, "hands");
          return 1;
        }
        jobs.push({ id: ctx.next(), kind: trouble.kind, room: trouble.room, what: trouble.name, by: who, took: t, since: t, walk: walkFor(game, place, who, null, `@${trouble.room}`, hours) });
        return 0;
      },
    });
  });
  return asks;
}

// ---- A job of the written story's own ----------------------------------------------------------------------

// A story's job (* work job, src/work-hook.js) is someone going to a room and working there for a while. It's kept
// with the board's own jobs as { id, kind, story, what, room, roomName, minutes, carriers, by, took, since, walk },
// counts as carrying, urgent or not, in the order of urgency, and leaves a fact on the record when it's done.
const storyJobs = (jobs) => jobs.filter((j) => j.story);
// A story's job is done: it's off the board, the story can ask about it, and it's on the record.
function storyDone(game, state, j, at, who) {
  const jobs = state.jobs ?? [];
  if (jobs.includes(j)) jobs.splice(jobs.indexOf(j), 1);
  ((state.orders ??= {}).story ??= {})[j.story] = { state: "done", what: j.what, at };
  try {
    recordFact(game, { id: storyJobFact(j.story), text: `${j.what}: done on day ${Math.floor(at / 1440) + 1}, by ${who}.`, from: "the work board" });
  } catch {
    // The record is full: the work was still done.
  }
}
function tendStory(ctx) {
  const { game, place, state, t, chunk, jobs, notes } = ctx;
  for (const j of storyJobs(jobs)) {
    if (!j.by || t + chunk < j.took + (j.walk ?? WALK_MINUTES) + j.minutes) continue;
    storyDone(game, state, j, t + chunk, calledBy(game, place, j.by));
    if (notes && game.location === place) notes.push(`[WORK] Done: ${j.what}. ${nameAt(game, place, j.by)} saw to it.`);
  }
}
function storyAsks(ctx) {
  const { game, place, model, t, hours, jobs } = ctx;
  // One the player is at with their own hands is left to them.
  return storyJobs(jobs).filter((j) => !j.by && !j.yours).map((j, order) => ({
    rank: rankOf(model, j.kind),
    order: 5000 + order,
    counts: "carrying",
    raise() {
      const people = carriersFor(game, place, j);
      const who = handFor(ctx, people, j.kind)?.key ?? null;
      if (who) Object.assign(j, { by: who, took: t, since: t, walk: walkFor(game, place, who, null, `@${j.room}`, hours) });
      else if (nobodyEven(ctx, people)) ctx.stuck(`story:${j.story}`, "hands");
      return 0;
    },
  }));
}

// ---- Jobs left waiting -------------------------------------------------------------------------------------

// What the two kinds of ask are about, in the words a request's about: line uses (src/requests.js).
export const WORK_ABOUTS = { hands: "a job nobody can do", goods: "a job with nothing to do it with" };
// What the ship can buy when there's none aboard: the only goods an ask can be for.
const BOUGHT = new Set(["ration_crate", "medicine_crate", "parts_crate"]);
const isTrouble = (j) => j.kind === "fire" || j.kind === "breach";
// What one of the place's own machines makes, as the garden grows produce: there's more of it coming without anyone
// bringing it aboard.
const madeAboard = (model, item) => model.machines.some((m) => m.gives && !m.gives.count && m.gives.item === item);
// How long a job stands before it counts as left waiting, in minutes: what the file's left waiting line says, or
// half an hour for urgent work and three hours for the rest.
const AFTER = Object.freeze({ urgent: 30, other: 180 });
const afterOf = (model) => model.asks?.after ?? AFTER;
// Whether nobody of the people who'd do a job could come even if they were woken: someone who's only asleep will
// see to it in the morning, which is no reason to bring it to the captain.
const nobodyEven = (at, people) => !people.some((key) => !whyNot(at, key, true));

// A job by the id the Work page knows it by, as it stands: what kind of work it is, whether it's urgent, the part of
// the ship it belongs to, and what it's of. Null once there's nothing left of it to do.
function jobAt(game, place, model, state, id) {
  if (id.startsWith("repair:")) {
    const repair = repairNow(game, place, id.slice(7));
    return repair ? { id, kind: "repair", urgent: repairKind(repair) === "repair_critical", part: "repairs", repair, item: model.repair?.item ?? null, n: model.repair?.n ?? 1 } : null;
  }
  if (id.startsWith("fire:") || id.startsWith("breach:")) {
    const kind = id.slice(0, id.indexOf(":"));
    const room = id.slice(kind.length + 1);
    const trouble = troublesAt(game, place).find((one) => one.kind === kind && one.room === room);
    return trouble ? { id, kind, urgent: true, part: "repairs", trouble, item: kind === "breach" ? "parts_crate" : null, n: 1 } : null;
  }
  if (id.startsWith("story:")) {
    const j = jobsAt(game, place).find((one) => one.story === id.slice(6));
    return j ? { id, kind: "story", urgent: j.kind === "carry_urgent", part: "rest", job: j, item: null, n: 0 } : null;
  }
  const want = model.wants.find((one) => wantKey(one) === id);
  if (!want) return null;
  const store = storeById(model, want.store);
  const have = haveOf(game, store, want.item);
  const wants = wantsNow(state, want);
  if (have >= wants) return null;
  return { id, kind: "carry", urgent: Boolean(urgentWhy(game, place, model, store, want.item, have)), part: partOf(model, place, want) ?? "rest", want, store, have, wants, item: want.item, n: wants - have };
}
// Whoever brings a part of the ship's work to the player: the holder of the post the file's who asks line gives it,
// if they're there to ask.
function askerFor(game, place, model, part) {
  const post = model.asks?.by?.[part] ?? model.asks?.by?.rest ?? null;
  const key = post ? holderKey(game, place, post) : null;
  return key && key !== YOU && !lostReason(game, place, key) ? { post, key } : null;
}
// The jobs that have waited long enough, for one of the two reasons or for either, the urgent ones first, then the
// longest waiting.
function waitedLong(game, place, model, state, why = null) {
  const now = Math.floor(game.clock.hours * 60 + 1e-6);
  const after = afterOf(model);
  const out = [];
  for (const [id, w] of Object.entries(state.waiting ?? {})) {
    if (why && w.why !== why) continue;
    const job = jobAt(game, place, model, state, id);
    if (job && now - w.since >= (job.urgent ? after.urgent : after.other)) out.push({ ...job, since: w.since, why: w.why });
  }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.since - b.since);
}
// What's wanted when goods are, as a request counts it: so many of a thing, aboard.
const wantOf = (item, n) => ({ item, n, where: "aboard", label: itemWords(item, 2), into: "aboard" });

// The troubles the requests can ask about (src/requests.js): for hands, each job that's waited long enough with
// nobody able to do it; for goods, each thing the ship can buy that some job has waited long enough for, with how
// many. Each names who'd bring it to the player. Reading this changes nothing.
export function workTroubles(game, about, place) {
  const model = logisticsOf(place);
  const state = game.logistics?.[place];
  const why = about === WORK_ABOUTS.hands ? "hands" : about === WORK_ABOUTS.goods ? "goods" : null;
  if (!why || !model?.asks || !state?.waiting) return [];
  const due = waitedLong(game, place, model, state, why);
  const out = [];
  if (why === "hands") {
    for (const job of due) {
      const asker = askerFor(game, place, model, job.part);
      if (asker) out.push({ about: null, work: job.id, post: asker.post, asker: asker.key });
    }
    return out;
  }
  const byItem = new Map();
  for (const job of due) {
    if (!BOUGHT.has(job.item)) continue;
    const entry = byItem.get(job.item) ?? byItem.set(job.item, { lead: job, n: 0 }).get(job.item);
    entry.n += job.n;
  }
  for (const [item, { lead, n }] of byItem) {
    const asker = askerFor(game, place, model, lead.part);
    if (asker) out.push({ about: null, work: `goods:${item}`, post: asker.post, asker: asker.key, want: wantOf(item, Math.max(1, Math.min(6, n))) });
  }
  return out;
}

// Whether a job that was brought to the player is over: the store has what it wants, the thing's mended, the fire's
// out, the hull's patched; and for goods, nothing's waiting for them any more.
export function jobOver(game, place, id) {
  const model = logisticsOf(place);
  const state = game.logistics?.[place];
  if (!model || !state) return true;
  if (id.startsWith("goods:")) {
    const item = id.slice(6);
    return !Object.entries(state.waiting ?? {}).some(([one, w]) => w.why === "goods" && jobAt(game, place, model, state, one)?.item === item);
  }
  return !jobAt(game, place, model, state, id);
}
// What the player has done toward a job with their own hands, as a running count (src/puts.js): what they've put in
// the store, the part they fixed, the goes they had at the fire, the patch they put on.
export function jobDeed(game, place, id) {
  if (id.startsWith("repair:")) return putsOf(game, `fixed:${place}`, id.slice(7));
  if (id.startsWith("fire:")) return putsOf(game, "fire", id.slice(5));
  if (id.startsWith("breach:")) return putsOf(game, "breach", id.slice(7));
  if (id.startsWith("story:")) return putsOf(game, "story", id.slice(6));
  const model = logisticsOf(place);
  const want = model?.wants.find((one) => wantKey(one) === id) ?? null;
  const store = want ? storeById(model, want.store) : null;
  return store ? putsOf(game, store.key, want.item) : 0;
}
// The player has said yes to a job brought to them: the board leaves it to them until the hour given (carrying and
// repairs; a fire or a breach is anyone's who can get there). And the same given back.
export function takeJob(game, place, id, untilHours) {
  const state = game.logistics?.[place];
  if (!state || /^(fire|breach|goods|story):/.test(id)) return;
  const now = Math.floor(game.clock.hours * 60 + 1e-6);
  const repair = id.startsWith("repair:") ? repairNow(game, place, id.slice(7)) : null;
  ((state.orders ??= {}).mine ??= {})[id] = { since: now, until: Math.round(untilHours * 60), ask: true, ...(repair ? { what: repair.what } : {}) };
}
export function leaveJob(game, place, id) {
  const orders = game.logistics?.[place]?.orders;
  if (!orders?.mine?.[id]?.ask) return;
  delete orders.mine[id];
  if (!Object.keys(orders.mine).length) delete orders.mine;
}
// A job brought to the player, in words for whoever asks: what's wrong (a sentence, without its full stop), what
// they'd do about it (to follow "I'll" or "Could you"), and for goods how many of what.
export function jobWords(game, place, id, want = null) {
  const model = logisticsOf(place);
  const state = game.logistics?.[place];
  const some = (item, n) => (n === 1 ? `${/^[aeiou]/i.test(itemWords(item, 1)) ? "an" : "a"} ${itemWords(item, 1)}` : `${n} ${itemWords(item, n)}`);
  const lowerFirst = (text) => (text ? text[0].toLowerCase() + text.slice(1) : "");
  if (id.startsWith("goods:")) {
    const item = id.slice(6);
    const wanted = some(item, want?.n ?? 1);
    const none = `there isn't ${some(item, 1)} aboard`;
    const lead = model && state ? Object.entries(state.waiting ?? {}).filter(([, w]) => w.why === "goods").map(([one, w]) => ({ job: jobAt(game, place, model, state, one), since: w.since }))
      .filter((one) => one.job?.item === item).sort((a, b) => Number(b.job.urgent) - Number(a.job.urgent) || a.since - b.since)[0]?.job ?? null : null;
    const trouble = !lead ? `We're out of ${itemWords(item, 2)}`
      : lead.kind === "carry" ? `The ${lead.store.name} ${/s$/i.test(lead.store.name) ? "are" : "is"} down to ${lead.have ? loadWords(item, lead.have) : `no ${itemWords(item, 2)}`}, and there are none aboard to bring`
        : lead.kind === "repair" ? `${upperFirst(lead.repair.what)} can't be mended: ${none}`
          : `The hull's open in ${lead.trouble.name}, and ${none} to patch it with`;
    return { trouble, task: `bring ${wanted} aboard`, wanted };
  }
  const job = model && state ? jobAt(game, place, model, state, id) : null;
  if (!job) return { trouble: "There's work nobody can get to", task: "see to it", wanted: "" };
  if (job.kind === "carry") return { trouble: `There's nobody to carry for the ${job.store.name}`, task: `carry ${loadWords(job.item, job.n)} to the ${job.store.name}`, wanted: loadWords(job.item, job.n) };
  if (job.kind === "repair") return { trouble: `There's nobody to mend ${job.repair.what}`, task: `mend ${job.repair.what}`, wanted: "" };
  if (job.kind === "fire") return { trouble: `There's a fire in ${job.trouble.name} and nobody to send to it`, task: `fight the fire in ${job.trouble.name}`, wanted: "" };
  if (job.kind === "breach") return { trouble: `The hull's open in ${job.trouble.name} and there's nobody to send`, task: `patch the hull in ${job.trouble.name}`, wanted: "" };
  return { trouble: `There's nobody for this: ${lowerFirst(job.job.what)}`, task: lowerFirst(job.job.what), wanted: "" };
}

// ---- What the written story asks and changes (src/work-hook.js has the words) ------------------------------

// ? work waiting [hands|goods|<part of the ship>], ? work first <part>|none, ? work job <name> waiting|taken|done|none.
function workHolds(game, term, place = "meridian") {
  const model = logisticsOf(place);
  const state = game.logistics?.[place];
  if (!model || !state) return term.what === "job" ? term.state === "none" : term.what === "first" ? term.part === "none" : false;
  if (term.what === "first") return (state.orders?.first?.part ?? null) === (term.part === "none" ? null : term.part);
  if (term.what === "job") {
    const j = jobsAt(game, place).find((one) => one.story === term.name);
    const now = j ? (j.by ? "taken" : "waiting") : state.orders?.story?.[term.name]?.state === "done" ? "done" : "none";
    return now === term.state;
  }
  // Left waiting: asking for a hand or for goods, and getting neither for as long as the file says.
  if (!state.waiting) return false;
  const waiting = waitedLong(game, place, model, state);
  if (!term.of) return waiting.length > 0;
  if (term.of === "hands" || term.of === "goods") return waiting.some((job) => job.why === term.of);
  return waiting.some((job) => job.part === term.of);
}
// * work first <part>|none, * work job <name> ..., * work job <name> off. Gives what the player should hear.
const STORY_STANDS = 24 * 60;
function storyWork(game, step, place = "meridian") {
  const model = logisticsOf(place);
  const state = game.logistics?.[place];
  if (!model || !state) return [];
  const orders = (state.orders ??= {});
  const now = Math.floor(game.clock.hours * 60 + 1e-6);
  const here = game.location === place;
  if (step.command === "work_first") {
    const part = step.part === "none" ? null : step.part;
    const holder = model.deciders?.first ? holderKey(game, place, model.deciders.first.post) ?? null : null;
    orders.first = { part, why: step.reason, by: null, story: true, holder, since: now, looked: now, next: now + STORY_STANDS };
    return here ? [`[WORK] ${part ? `${upperFirst(PART_WORDS[part])} first` : "As it comes"}: ${step.reason}`] : [];
  }
  const jobs = (state.jobs ??= []);
  const there = jobs.find((one) => one.story === step.name) ?? null;
  if (step.command === "work_job_off") {
    if (there) jobs.splice(jobs.indexOf(there), 1);
    if (orders.story?.[step.name]) delete orders.story[step.name];
    return [];
  }
  if (step.command !== "work_job" || there) return [];
  const room = model.findRoom(step.room);
  const carriers = step.carriers.map((words) => model.findCarrier(words)).filter(Boolean);
  if (!room || !carriers.length) return [];
  jobs.push({ id: (state.jobSeq = (state.jobSeq ?? 0) + 1), kind: step.urgent ? "carry_urgent" : "carry", story: step.name, what: step.reason, room: room.id, roomName: room.name.replace(/^The /, "the "), minutes: step.minutes, carriers, by: null, since: now });
  (orders.story ??= {})[step.name] = { state: "waiting", what: step.reason, at: now };
  return here ? [`[WORK] On the board: ${step.reason}.`] : [];
}
tellWork({ holds: workHolds, step: storyWork, problem: storyJobProblem });

// A job the story gave the board can be done by the player while nobody's on it: in its room, under You can, for as
// long as it takes anyone. Nobody's sent to it while they're at it.
const spanOf = (minutes) => (minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`);
const storyJobsIn = (game, place, room) => jobsAt(game, place).filter((j) => j.story && j.room === room);
const noHandsWhy = (game, place) => (handsFree(game, place, YOU) ? null : "you can't work with a hand that's no use");
addRoomActs((game, { place, room }) => {
  if (!room || !game.logistics?.[place]?.jobs?.length) return null;
  return storyJobsIn(game, place, room).map((j) => {
    const why = j.by ? `${nameAt(game, place, j.by)} is on it` : noHandsWhy(game, place);
    return { id: "work-story", key: j.story, label: `${j.what} (${spanOf(j.minutes)})`, detail: why ?? "a job on the work board, with your own hands", ...(why ? { disabled: true } : {}) };
  });
});
addOrder("work-story", (game, body, { room }) => {
  const place = game.location;
  const state = game.logistics?.[place];
  const j = storyJobsIn(game, place, room).find((one) => one.story === String(body.key ?? ""));
  if (!state || !j) throw new Error("There's no job of that kind in this room.");
  if (j.by) throw new Error(`${nameAt(game, place, j.by)} is already on it.`);
  const why = noHandsWhy(game, place);
  if (why) throw new Error(`${upperFirst(why)}. Let it heal first.`);
  j.yours = true;
  let notes = [];
  try {
    notes = passTime(game, j.minutes / 60, "work");
  } finally {
    delete j.yours;
  }
  // Taken off the board while they were at it: there's nothing to finish.
  if (!(state.jobs ?? []).includes(j)) return { said: notes.join("\n") };
  storyDone(game, state, j, Math.floor(game.clock.hours * 60 + 1e-6), "you");
  // Their own doing, counted for whoever asked them to see to it (src/requests.js).
  notePut(game, "story", j.story, 1);
  return { said: [`[WORK] Done: ${j.what}. You saw to it yourself.`, ...notes].join("\n") };
});
// What's wrong with a story's job, for the checker: a room the ship hasn't got, or people the board can't send.
export function storyJobProblem(step, place = "meridian") {
  const model = logisticsOf(place);
  if (!model) return null;
  if (!model.findRoom(step.room)) return `the Meridian has no room called ${step.room}`;
  const unknown = step.carriers.find((words) => !model.findCarrier(words));
  return unknown ? `nobody called ${unknown} is a job or a post aboard, or has a day there, to do it` : null;
}

// ---- The board's clock ------------------------------------------------------------------------------------

// The board over one piece of the clock, as long as chunk minutes: the officers look if it's time, whoever can't go
// on hands their job back, the jobs under way go on, and then everything that's asking for a hand is given one, in
// the place's order of urgency, for as long as there's someone to send. It says what it had to leave with nobody on
// it, which the posts' duty counts: carrying, the urgent wants nobody could carry for though something aboard could
// have been brought, and repairs, the ones the ship can't do without that nobody could be sent to. Lines for the
// story go into notes, when it's given.
const NOTHING_LEFT = Object.freeze({ carrying: 0, repairs: 0 });
// The board as it stands, with what it takes to change it: a job over, a job handed back, and the next job's number.
function acting(game, place, model, state, t, chunk, notes) {
  const jobs = (state.jobs ??= []);
  const hours = t / 60;
  const ctx = Object.assign(standing(game, place, model, hours), {
    state, t, chunk, notes,
    over: (j) => { if (jobs.includes(j)) jobs.splice(jobs.indexOf(j), 1); },
    // A job handed back. Work kept elsewhere is handed back the way its keeper says. Of the board's own, whatever
    // was loaded is set down for the next free hand, and anything else is simply open again; whoever takes up a
    // repair someone else left has their own hour at it.
    release: (j) => {
      if (j.drop) {
        j.drop();
        ctx.stale();
        return;
      }
      // A job of the story's stays on the board, for whoever's free next.
      if (j.story) {
        Object.assign(j, { by: null, since: t });
        return;
      }
      if (j.load) Object.assign(j, { phase: "down", since: t, by: null });
      else ctx.over(j);
      if (j.ref) holdRepair(game, place, j.ref, hours);
    },
    next: () => (state.jobSeq = (state.jobSeq ?? 0) + 1),
    // A job that's asking for a hand or for goods and getting neither: kept, with since when.
    seen: null,
    stuck: (id, why) => {
      const waiting = (state.waiting ??= {});
      if (waiting[id]?.why !== why) waiting[id] = { since: t, why };
      (ctx.seen ??= new Set()).add(id);
    },
  });
  return ctx;
}
// What's no longer stuck is forgotten, once everything that asks has had its turn.
function settleWaiting(state, ctx) {
  if (!state.waiting) return;
  for (const id of Object.keys(state.waiting)) if (!ctx.seen?.has(id)) delete state.waiting[id];
  if (!Object.keys(state.waiting).length) delete state.waiting;
}
export function runBoard(game, place, model, state, t, chunk, notes = null) {
  settleOld(game, place, state);
  const jobs = (state.jobs ??= []);
  const systems = Boolean(game.systems?.[place]);
  const hours = t / 60;
  const ctx = acting(game, place, model, state, t, chunk, notes);
  // Whoever's lost to their work, or called to something outside the board, hands back what the medbay or the
  // workshop had them at, as they do a job of the board's own.
  const kept = ctx.others();
  for (const o of kept) if (!o.fixed && (lostReason(game, place, o.by) || ctx.held(o.by))) ctx.release(o);
  // What's burning burns on as the board's clock moves, so that whoever's at a fire is free the moment it's out.
  const burning = Boolean(game.emergencies) && (Object.keys(game.emergencies.fires ?? {}).length > 0 || Object.keys(game.emergencies.breaches ?? {}).length > 0);
  if (burning) {
    const lines = burnOn(game, (t + chunk) / 60, place);
    if (notes) notes.push(...lines);
  }
  // The place's air moves on with the board's clock too, a piece at a time, so that through a long wait it follows the
  // generator and the repairs as they went, and whoever can't breathe is counted by the minute (src/systems.js).
  const aired = airMoves(game, place, (t + chunk) / 60, { since: hours, fine: true });
  if (notes && aired.length) notes.push(...aired);
  let troubles = burning ? troublesAt(game, place) : [];
  if (!jobs.length && !model.wants.length && !systems && !troubles.length) {
    settleWaiting(state, ctx);
    return NOTHING_LEFT;
  }
  const deciding = Boolean(model.deciders?.first || model.deciders?.levels);
  if (deciding && Math.floor(t / LOOK_EVERY) !== Math.floor((t - chunk) / LOOK_EVERY)) officersLook(game, place, model, state, t, notes);
  tendMine(game, place, model, state, t, notes);
  // Whoever has been called to something outside the board, or can't go on, hands their job back; and so does
  // whoever another part of the game has taken for work of its own, as the alarm takes its guards.
  for (const j of [...jobs]) if (j.by && (lostReason(game, place, j.by) || !handsFree(game, place, j.by) || ctx.held(j.by) || ctx.others().some((o) => o.by === j.by))) ctx.release(j);
  for (const j of [...jobs]) if (j.to) tendCarry(ctx, j);
  if (jobs.some((j) => j.ref)) tendRepairs(ctx);
  if (troubles.length || jobs.some(isTrouble)) {
    tendTroubles(ctx, troubles);
    if (burning) troubles = troublesAt(game, place);
  }
  const stories = jobs.some((j) => j.story);
  if (stories) tendStory(ctx);
  // What's broken and due within the hour, once whatever was finished just now is out of the way.
  const due = systems ? repairsDue(game, place, hours + 1) : [];
  const asks = [...loadAsks(ctx), ...carryAsks(ctx), ...(due.length ? repairAsks(ctx, due) : []), ...(troubles.length ? troubleAsks(ctx, troubles) : []), ...(stories ? storyAsks(ctx) : [])];
  if (asks.length > 1) asks.sort((a, b) => a.rank - b.rank || a.order - b.order);
  let left = null;
  for (const ask of asks) {
    const n = ask.raise();
    if (n) (left ??= { carrying: 0, repairs: 0 })[ask.counts] += n;
  }
  // What's broken with no spare aboard to mend it with waits for goods.
  if (systems) for (const ref of partsWaitingRefs(game, place)) ctx.stuck(repairKey(ref), "goods");
  settleWaiting(state, ctx);
  return left ?? NOTHING_LEFT;
}

// What the board has someone carrying and where, or which fire or breach it's sent them to, for the life engine's
// walks: null when it's sent nobody anywhere. (Whoever's mending is walked by the systems, which know where the
// spare and the part are.)
export function workDetour(game, place) {
  const jobs = jobsAt(game, place);
  if (!jobs.length) return null;
  const model = logisticsOf(place);
  if (!model) return null;
  const mine = new Map();
  for (const j of jobs) {
    if (!j.by || j.ref) continue;
    mine.set(j.by, { where: j.room ? `@${j.room}` : whereOf(j), doing: doingWords(model, j) });
  }
  return mine.size ? (key) => mine.get(key) ?? null : null;
}

// What a store wants of a thing now, for whoever counts it elsewhere (src/hands.js pays by it).
export const wantedNow = (game, place, want) => wantsNow(game.logistics?.[place], want);

// Someone to answer a call from another part of the game, such as the medbay's for someone down: of the people
// given, in their order, the first who's free or can leave lesser work for it, and failing that, for a kind of work
// that wakes sleepers, the first who's only asleep. Whoever leaves a job hands it back as the board has it handed
// back. It gives { key, woken }, null when nobody can come, and nothing at all (undefined) where there's no board to
// ask, so that the caller chooses as it used to. With dry it only says who'd come. Without inOrder, anyone free
// comes before anyone's taken off anything, as for the board's own jobs: for a patient, who any medic can see to.
export function callHand(game, place, people, kind, { dry = false, inOrder = true } = {}) {
  const model = logisticsOf(place);
  const state = game.logistics?.[place];
  if (!model || !state) return undefined;
  const at = acting(game, place, model, state, Math.floor(game.clock.hours * 60 + 1e-6), 0, null);
  return handFor(at, people.filter((key) => key && key !== YOU), kind, { inOrder, dry });
}
// What someone's doing for the board, in words, or null: for the parts of the game that choose their own people (the
// medbay's medics, the workshop's menders) to leave alone whoever's on other work. The kind given is their own, and
// isn't counted.
export function busyOnBoard(game, place, key, but = null) {
  const mine = jobsAt(game, place).find((j) => j.by === key);
  if (mine) return doingWords(logisticsOf(place), mine);
  // Nor anyone something outside the board has taken: the board would only take them off the work again.
  return othersWork(game, place).find((o) => o.by === key && o.kind !== but)?.doing ?? holdsAt(game, place)(key);
}

// ---- What the player sees ---------------------------------------------------------------------------------

// Everything the stores want, a line each: what each has against what it wants, who's carrying for it and since
// when, or why nobody is. Reading this changes nothing.
export function workView(game, place) {
  const model = logisticsOf(place);
  if (!model) return [];
  const state = game.logistics?.[place] ?? null;
  const jobs = jobsAt(game, place);
  const at = standing(game, place, model);
  return model.wants.map((want) => {
    const store = storeById(model, want.store);
    const have = haveOf(game, store, want.item);
    const wants = wantsNow(state, want);
    const yours = state?.orders?.mine?.[wantKey(want)] ?? null;
    const mine = jobs.filter((j) => j.to === store.id && j.item === want.item);
    const carried = mine.filter((j) => j.by);
    const down = mine.filter((j) => !j.by && j.load);
    const short = have + comingTo(jobs, store.id, want.item) < wants;
    const urgent = have < wants ? urgentWhy(game, place, model, store, want.item, have) : null;
    const source = short ? sourceFor(game, place, model, state, jobs, store, want.item) : null;
    // A want with nobody on it, one that's come up or a load that's been set down: who'd take it, and what keeps them.
    const open = (short && Boolean(source) && !yours) || down.length > 0;
    const nobody = open ? whyNobody(at, store, Boolean(urgent) && short) : null;
    const said = [
      ...carried.map((j) => `${nameAt(game, place, j.by)} is ${doingWords(model, j)}, since ${clockWords(j.took ?? j.since)}`),
      ...down.map((j) => `${loadWords(j.load.item, j.load.n)} set down`),
      ...(short && yours ? [`yours since ${clockWords(yours.since)}${yours.ask ? ", as you said you'd see to it" : ""}`] : []),
      ...(short && !source && !yours ? [carried.length || down.length ? "nothing more aboard to bring" : "nothing aboard to bring"] : []),
      ...(open ? [nobody ?? "about to be taken up"] : []),
    ];
    return {
      id: wantKey(want),
      store: upperFirst(store.name),
      item: want.item,
      has: have,
      wants,
      does: `${loadWords(want.item, have)}, wants ${wants}`,
      by: carriersWords(store),
      urgent: urgent ? `urgent: ${urgent}` : null,
      status: said.length ? said.join("; ") : "nothing to carry",
      carriers: carried.map((j) => j.by),
      busy: carried.length > 0,
      waiting: mine.some((j) => j.phase === "unloading"),
      stuck: Boolean(nobody) || (short && !source && !yours),
      short,
      mine: Boolean(yours),
      // Taken on through an ask (src/requests.js): the request holds it, so it isn't handed back from the board.
      promised: Boolean(yours?.ask),
      // The player can take it while it's short and nobody's carrying for it, and give it back once it's theirs.
      canTake: short && !yours && !carried.length && game.location === place,
    };
  });
}

// The medbay's and the workshop's work as the Work page's rows: who's on each and since when, or why nobody is.
const KEPT_BY = { bleeding: "whoever answers a call", fallen: "whoever answers a call", dead: "whoever answers a call", treat: "the medics", workshop: "whoever mends at the bench" };
const KEPT_TIP = { bleeding: "Carried by a nurse, and then by a spare hand.", fallen: "Carried by a nurse, and then by a spare hand.", dead: "Carried by a nurse, and then by a spare hand.", treat: "Treated by the medics, while they're on watch in the medbay.", workshop: "Mended or built by the workshop's hands, the first of them who's free." };
function keptRows(at, kept, firstPart, now) {
  const { game, place, model } = at;
  return kept.map((row, order) => {
    const inFirst = firstPart === "medbay" && row.kind !== "workshop";
    const nobody = row.by || row.stuck ? null : whyNobodyOf(at, row.people, { wake: WAKES.has(row.kind), nobody: "there's nobody to do it", also: row.also });
    return {
      rank: rankOf(model, row.kind) - (inFirst ? 0.5 : 0), order: 2000 + order,
      id: row.id, mark: WAKES.has(row.kind) ? "!!" : inFirst ? "!" : "",
      what: row.what, why: row.why,
      status: row.by ? `${nameAt(game, place, row.by)} is ${row.doing}${row.since === null ? "" : `, since ${clockWords(row.since * 60)}`}` : row.stuck ?? nobody ?? "about to be taken up",
      by: KEPT_BY[row.kind] ?? "the crew", tip: KEPT_TIP[row.kind] ?? null,
      busy: Boolean(row.by), stuck: !row.by && Boolean(row.stuck ?? nobody), mine: false, canTake: false,
    };
  });
}

// The fires and the breaches as the Work page's rows: who's been sent to each, or why nobody has.
function troubleRows(at, engineers) {
  const { game, place, model, jobs } = at;
  let crates = null;
  return troublesAt(game, place).map((trouble, order) => {
    const j = jobs.find((one) => one.kind === trouble.kind && one.room === trouble.room && one.by) ?? null;
    const noCrate = !j && trouble.waiting && !((crates ??= countAboard(game, place, ["parts_crate"])?.n ?? 0) > 0);
    const nobody = j || noCrate ? null : whyNobodyOf(at, engineers, { wake: true, nobody: "there's nobody to send" });
    return {
      rank: rankOf(model, trouble.kind), order: 3000 + order,
      id: `${trouble.kind}:${trouble.room}`, mark: "!!",
      what: trouble.kind === "fire" ? `Fight the fire in ${trouble.name}` : `Patch the hull in ${trouble.name}`,
      why: trouble.kind === "fire" ? `it's ${trouble.words}` : "the air's going out of it",
      status: j ? `${nameAt(game, place, j.by)} is ${doingWords(model, j)}, since ${clockWords(j.took)}` : noCrate ? "waiting for a parts crate: there's none aboard" : nobody ?? "about to be taken up",
      by: "the engineers", tip: "Seen to by the engineers, the first of them who's free; anyone's woken for it.",
      busy: Boolean(j), stuck: !j && Boolean(noCrate || nobody), mine: false, canTake: false,
    };
  });
}
// The written story's own jobs as the Work page's rows.
function storyRows(at) {
  const { game, place, model, jobs } = at;
  return storyJobs(jobs).map((j, order) => {
    const people = carriersFor(game, place, j);
    const nobody = j.by ? null : whyNobodyOf(at, people, { wake: WAKES.has(j.kind), nobody: "there's nobody to do it" });
    return {
      rank: rankOf(model, j.kind), order: 5000 + order,
      id: `story:${j.story}`, mark: WAKES.has(j.kind) ? "!!" : "",
      what: j.what, why: j.kind === "carry_urgent" ? "urgent" : null,
      status: j.by ? `${nameAt(game, place, j.by)} is ${doingWords(model, j)}, since ${clockWords(j.took)}` : nobody ?? "about to be taken up",
      by: carriersWords(j), tip: `Done by ${carriersWords(j)}. You can do it yourself in ${j.roomName}, while nobody's on it.`,
      busy: Boolean(j.by), stuck: Boolean(nobody), mine: false, canTake: false,
    };
  });
}
// An alarm as the Work page's row: the guards answering it.
function alarmRows(at) {
  const { game, place, model } = at;
  const guards = alarmWork(game, place);
  const ringing = game.systems?.[place]?.alarm?.ringing ?? null;
  if (!guards.length && !ringing?.room) return [];
  const names = guards.map((one) => nameAt(game, place, one.by));
  const listed = names.length < 2 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const room = guards[0]?.name ?? null;
  return [{
    rank: rankOf(model, "alarm"), order: 4000,
    id: `alarm:${guards[0]?.room ?? ringing.room}`, mark: "!!",
    what: room ? `Answer the alarm in ${room}` : "Answer the alarm",
    why: guards[0]?.seen || ringing?.seen ? "someone was caught on camera" : null,
    status: guards.length ? `${listed} ${guards.length === 1 ? "is" : "are"} answering it` : "nobody hears it: there's nobody to answer, or the relay's down",
    by: "the guards", tip: "Answered by the guards, all of them.",
    busy: guards.length > 0, stuck: !guards.length, mine: false, canTake: false,
  }];
}

// The Work page: the officers' orders, every store with what it has against what it wants and what's on its way,
// and every job, the most urgent first, with who's on it or why it's stuck. Reading this changes nothing.
export function boardView(game, place) {
  const model = logisticsOf(place);
  if (!model?.wants.length) return null;
  const state = game.logistics?.[place] ?? null;
  const orders = state?.orders ?? {};
  const jobs = jobsAt(game, place);
  const now = Math.floor(game.clock.hours * 60 + 1e-6);
  const hours = game.clock.hours;
  const at = standing(game, place, model);
  const lines = workView(game, place);
  const lineOf = (want) => lines.find((one) => one.id === wantKey(want));
  const engineers = menders(game, place);
  // What the medbay and the workshop have on, and who they'd send.
  const kept = [...medbayRows(game, place), ...workshopRows(game, place)];
  // Everyone the board's work is for, and how many of them could take a job this minute: whoever carries for a
  // store, mends, answers a call, treats or works at the bench.
  const hands = [...new Set([...model.stores.filter((store) => Object.keys(store.wants).length).flatMap((store) => carriersFor(game, place, store)), ...engineers, ...medbayHands(game, place), ...workshopHands(game, place)])];
  const free = hands.filter((key) => !whyNot(at, key)).length;
  // An order as it stands: whose it is, or why nobody's deciding. Before anyone has looked, it's who would.
  const decided = (decider, order) => {
    if (!decider) return null;
    if (order) return { post: decider.words, by: order.by ? calledBy(game, place, order.by) : null, nobody: order.by ? null : order.why };
    return { post: decider.words, by: null, nobody: deciderNow(game, place, decider).why ?? "nobody has looked yet" };
  };
  // An order the written story gave stands as the first officer's would, with its own words for why.
  const storyFirst = Boolean(orders.first?.story);
  const first = decided(model.deciders?.first, orders.first) ?? (storyFirst ? { post: null, by: null, nobody: null } : null);
  const levels = decided(model.deciders?.levels, orders.levels);
  const firstPart = first?.by || storyFirst ? orders.first.part : null;
  const sittings = model.sittings;
  const minute = now % 1440;
  const sittingOn = sittings.at.some((start) => minute >= start && minute < start + sittings.minutes);
  const next = sittings.at.find((start) => start > minute) ?? sittings.at[0];
  const mark = (kind, inFirst) => (WAKES.has(kind) ? "!!" : inFirst ? "!" : "");
  // The carrying, a job a want that's short or being carried for.
  const carrying = model.wants.map((want, order) => ({ want, order, line: lineOf(want) }))
    .filter(({ line }) => line.short || line.busy || line.status !== "nothing to carry")
    .map(({ want, order, line }) => {
      const kind = line.urgent ? "carry_urgent" : "carry";
      const inFirst = Boolean(firstPart) && partOf(model, place, want) === firstPart;
      return {
        rank: rankOf(model, kind) - (inFirst ? 0.5 : 0), order,
        id: line.id, mark: mark(kind, inFirst),
        what: `${line.store}: ${loadWords(want.item, Math.max(0, line.wants - line.has))} short of the ${line.wants} it wants`,
        why: line.urgent, status: line.status, by: line.by, tip: `Carried by ${line.by}.`, busy: line.busy, stuck: line.stuck, mine: line.mine, promised: line.promised, canTake: line.canTake,
      };
    });
  // The repairs: what's being mended, what's waiting for an engineer or a spare, and what they'll get to later.
  const duty = jobs.some((j) => j.ref) ? dutyDetour(game, place) : null;
  const mending = repairsWaiting(game, place).map((repair, order) => {
    const kind = repairKind(repair);
    const inFirst = repairFirst(model, place, repair, firstPart);
    const j = jobs.find((one) => one.ref === repair.ref && one.by) ?? null;
    const yours = orders.mine?.[repairKey(repair.ref)] ?? null;
    const due = repair.fixAt !== null && repair.fixAt - hours <= 1;
    const nobody = due && !j && !yours ? whyNobodyOf(at, engineers, { wake: WAKES.has(kind), nobody: "there's nobody to mend it" }) : null;
    return {
      rank: rankOf(model, kind) - (inFirst ? 0.5 : 0), order: 1000 + order,
      id: repairKey(repair.ref), mark: mark(kind, inFirst),
      what: `Mend ${repair.what}`,
      why: kind === "repair_critical" ? "the ship can't do without it" : null,
      status: j ? `${nameAt(game, place, j.by)} is ${duty?.(j.by)?.doing ?? `mending ${repair.what}`}, since ${clockWords(j.took)}`
        : yours ? `yours since ${clockWords(yours.since)}${yours.ask ? ", as you said you'd see to it" : ""}`
          : repair.noParts ? "waiting for a spare: there's none aboard"
            : due ? nobody ?? "about to be taken up"
              : `the engineers start on it at ${clockWords(repair.fixAt * 60 - 60)}`,
      by: "the engineers", tip: "Mended by the engineers, the first of them who's free.", busy: Boolean(j), stuck: Boolean(nobody) || (repair.noParts && !yours), mine: Boolean(yours), promised: Boolean(yours?.ask),
      canTake: !j && !yours && game.location === place,
    };
  });
  return {
    name: model.name,
    hands: { free, of: hands.length },
    first: first && {
      post: first.post,
      by: first.by,
      part: firstPart,
      title: firstPart ? `${upperFirst(PART_WORDS[firstPart])} first` : "As it comes",
      story: storyFirst,
      why: first.by || storyFirst ? orders.first.why : first.nobody,
      since: first.by || storyFirst ? whenWords(orders.first.since, now) : null,
    },
    levels: levels && { post: levels.post, by: levels.by, why: levels.by ? null : levels.nobody },
    // Not the freight hold: what's in it is cargo, and nobody on the board carries for it.
    stores: model.stores.filter((store) => !store.freight).map((store) => {
      if (store.count) {
        const n = countOf(game, store);
        return { id: store.id, name: upperFirst(store.name), room: store.roomName, count: { n, of: store.count.n, unit: store.count.unit }, note: model.kettles.includes(store) ? (sittingOn ? "a sitting is on" : `next sitting ${clockWords(next)}`) : countNote(game, place, store), rows: [] };
      }
      const counts = storeCounts(game, store.key, store.holds);
      return {
        id: store.id, name: upperFirst(store.name), room: store.roomName, count: null, note: "",
        rows: Object.keys(store.holds).map((item) => {
          const want = model.wants.find((one) => one.store === store.id && one.item === item) ?? null;
          const line = want ? lineOf(want) : null;
          const level = want ? orders.wants?.[wantKey(want)] ?? null : null;
          const coming = comingTo(jobs, store.id, item);
          const aside = setAsideIn(jobs, store.id, item);
          const notes = [];
          if (coming) notes.push(`${coming} on ${coming === 1 ? "its" : "their"} way`);
          if (aside) notes.push(`${aside} set aside to go`);
          if (level) notes.push(`raised from ${want.wants} by ${calledBy(game, place, level.by)} ${whenAt(level.since, now)}, after it ran low`);
          return {
            item, name: (ITEMS[item]?.name ?? item).toLowerCase(), has: counts[item] ?? 0, holds: store.holds[item],
            wants: want ? line.wants : null, written: want ? want.wants : null,
            urgent: Boolean(line?.urgent), short: Boolean(line?.short), note: notes.join("; "),
          };
        }),
      };
    }),
    jobs: [...carrying, ...mending, ...keptRows(at, kept, firstPart, now), ...troubleRows(at, engineers), ...alarmRows(at), ...storyRows(at)].sort((a, b) => a.rank - b.rank || a.order - b.order).map(({ rank, order, ...job }) => job),
  };
}
