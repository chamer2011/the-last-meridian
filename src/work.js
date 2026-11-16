// The ship's work board. Every job of carrying from one store to another is kept here, and this is the only part of
// the game that sends anyone to carry. Nobody writes the routes: each store's line in world/logistics/<place>.txt says
// what it wants kept in it, when that's urgent and who carries for it, and the board does the rest. Whenever a store
// has fewer of something than it wants, and some other store can spare it, a job comes up: the first of the store's
// carriers who's free takes it, walks to the nearest store that can spare the thing, takes what one trip carries,
// walks it over and puts it in. What they've gone for is set aside for them, so two people never go for the same
// crates, and as many go at once as the want needs. Where nothing aboard can be spared, nobody is sent to stand at
// an empty store: the Work page says there's nothing to bring.
//
// A want is urgent when the store is under the mark its line gives, or when whatever uses the thing up is asking: a
// machine with nothing left to work from (the generator on its last cell, the galley with a bare pantry), the medbay
// with someone waiting and no doses, a repair waiting for its spare. Urgent jobs are given out first, and one wakes
// a sleeper when nobody else is up.
//
// The officers give the board its orders, not the captain. Whoever holds the post the file's "what comes first"
// line names (the first officer) looks at how the ship stands every so often and puts one part of her first: the
// medbay, the engines, the galley or repairs, whichever is in the most trouble, or none. Whoever holds the post its
// "what stores want" line names (the quartermaster) raises what a store wants by a trip's worth after it has run
// low, and eases it back once it's been quiet for some days. How often each looks goes by their skill for the post.
// With a post empty, or its holder laid up or locked up, nobody decides: jobs go as they come, and the stores want
// what they wanted. The player can take any job that nobody's on, and the crew leaves it to them for a while.
//
// Nobody is counted in two places: someone the medbay, an alarm, a repair or the player has taken is given no job,
// and a carrier who's called away, or who can't go on, hands the job back with whatever they'd loaded, for the next
// free hand. A walk takes as long as the way through the decks is, at the pace of whoever's walking, whether or not
// anyone is watching.
//
// This is steps 1, 3 and 4 of the logistics rework (docs/notes/project-logistics.md, "The rework"). What's kept in
// the save is game.logistics[place].jobs, a list: a job under way is { id, to, item, from, n, phase, since, load, by,
// took, walk }, and one set down with its load has nobody (by: null, phase "down"). A want nobody has taken up yet
// isn't kept at all: it's there whenever the store is short. The officers' orders are game.logistics[place].orders:
// first ({ part, why, by, holder, since, looked, next }), levels (who last looked, when, and when they look next), wants (a store's want where the
// quartermaster has changed it), urgent (what's run low since they last looked) and mine (the jobs the player has
// taken). A save from before step 3 kept its jobs by their errands (game.logistics[place].errands), and whatever
// those had loaded is put back in the stores the first time the board runs.

import { handsFree } from "./body.js";
import { storeCounts, storePut, storeTake } from "./bag.js";
import { YOU, calledBy, holderKey, lostReason, onJob, personCalled, postById, speedOf } from "./command.js";
import { ITEMS } from "./data.js";
import { hasReached, notAbout, walkMinutes } from "./life.js";
import { countOf, itemWords, logisticsOf, machineStarved, putAboard, storeById, tripOf } from "./logistics.js";
import { downAt, medbayDetour, medbayOf } from "./medbay.js";
import { detourExtras } from "./room-hooks.js";
import { dutyDetour, waitingForParts } from "./systems.js";
import { worthOf } from "./worth.js";

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
const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const countWords = (n) => NUMBERS[n] ?? String(n);
const jobsAt = (game, place) => game.logistics?.[place]?.jobs ?? [];
const haveOf = (game, store, item) => storeCounts(game, store.key, store.holds)[item] ?? 0;
const wantKey = (want) => `${want.store}:${want.item}`;
// What a store wants of a thing now: what the quartermaster last set, or what its line says.
const levelOf = (state, storeId, item) => state?.orders?.wants?.[`${storeId}:${item}`]?.n ?? null;
const wantsNow = (state, want) => levelOf(state, want.store, want.item) ?? want.wants;

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

// Why nobody's on a job, for the Work page: what keeps its carriers, the ones kept by the same thing counted
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
  if (model.repair?.item === item && model.repair.from.includes(store.id) && waitingForParts(game, place).length) return "a repair is waiting for it";
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
function officersLook(game, place, model, state, t) {
  const orders = (state.orders ??= {});
  const due = (decider, was) => !was || t >= was.next || (holderKey(game, place, decider.post) ?? null) !== was.holder;
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
      orders.levels = { by: who.key, why: null, holder, looked: t, next: t + paceOf(game, place, levels, who.key) };
    }
  }
}

// ---- The jobs the player has taken -----------------------------------------------------------------------

// What the player has to do for a job they've taken, in a line for the corner of the screen.
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

// The jobs the player said they'd do, each piece of the clock: one is over when its store has what it wants, and
// goes back to the crew when the player hasn't got to it in time.
function tendMine(game, place, model, state, t, notes) {
  const mine = state.orders?.mine;
  if (!mine) return;
  for (const [key, held] of Object.entries(mine)) {
    const want = model.wants.find((one) => wantKey(one) === key);
    const store = want ? storeById(model, want.store) : null;
    const over = (line) => {
      delete mine[key];
      dropQuest(game, key);
      if (line && notes && game.location === place) notes.push(line);
    };
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

// The player taking a job nobody's on, or giving one back. It gives the words for what was done.
export function workCommand(game, place, { action, id } = {}) {
  const model = logisticsOf(place);
  const state = game.logistics?.[place];
  const want = model?.wants.find((one) => wantKey(one) === id);
  if (!want || !state) throw new Error("There's no job like that on the board.");
  const store = storeById(model, want.store);
  const orders = (state.orders ??= {});
  if (action === "leave") {
    if (!orders.mine?.[id]) throw new Error("That one isn't yours.");
    delete orders.mine[id];
    if (!Object.keys(orders.mine).length) delete orders.mine;
    dropQuest(game, id);
    return { message: `The ${store.name} ${/s$/i.test(store.name) ? "are" : "is"} the crew's to fill again.` };
  }
  if (action !== "mine") throw new Error("The board doesn't know that order.");
  if (game.location !== place) throw new Error("You'd have to be aboard to carry for her stores.");
  if (orders.mine?.[id]) throw new Error("That one's already yours.");
  if (haveOf(game, store, want.item) >= wantsNow(state, want)) throw new Error(`The ${store.name} ${/s$/i.test(store.name) ? "have what they want" : "has what it wants"}.`);
  const taken = jobsAt(game, place).find((j) => j.to === store.id && j.item === want.item && j.by);
  if (taken) throw new Error(`${personCalled(game, taken.by)} is already on it.`);
  const now = Math.floor(game.clock.hours * 60 + 1e-6);
  (orders.mine ??= {})[id] = { since: now };
  const urgent = urgentWhy(game, place, model, store, want.item, haveOf(game, store, want.item));
  const words = mineWords(game, place, model, state, want);
  game.quests ??= [];
  dropQuest(game, id);
  game.quests.push({
    id: `work:${id}`, title: `Carry for the ${store.name}`, main: false, status: "active", work: true,
    desc: `You said you'd do it yourself, on day ${Math.floor(now / 1440) + 1} at ${clockWords(now)}. The crew leaves it to you for ${urgent ? `${MINE_URGENT} minutes, since it's urgent` : `${MINE_MINUTES / 60} hours`}.`,
    objective: words,
  });
  game.following = `work:${id}`;
  return { message: `It's yours. ${words}` };
}

// A save from before the stores said what they want kept its jobs by their errands. Whatever those had loaded goes
// back into the stores that keep it, and the wants raise their own jobs from there.
function settleOld(game, place, state) {
  if (!state.errands) return;
  for (const old of Object.values(state.errands)) if (old?.load?.n > 0) putAboard(game, place, old.load.item, old.load.n);
  delete state.errands;
}

// The board over one piece of the clock, as long as chunk minutes: the officers look if it's time, the jobs under
// way go on, a load that was set down is taken up by the next free hand, and each want that isn't covered raises
// jobs, the urgent ones first and then the part of the ship that's been put first, for as long as there's something
// to spare and someone free. It says how many urgent wants it had to leave with nobody on them though something
// aboard could have been brought, which the posts' duty counts. Lines for the story go into notes, when it's given.
export function runBoard(game, place, model, state, t, chunk, notes = null) {
  settleOld(game, place, state);
  const jobs = (state.jobs ??= []);
  if (!jobs.length && !model.wants.length) return 0;
  const hours = t / 60;
  const deciding = Boolean(model.deciders?.first || model.deciders?.levels);
  if (deciding && Math.floor(t / LOOK_EVERY) !== Math.floor((t - chunk) / LOOK_EVERY)) officersLook(game, place, model, state, t);
  tendMine(game, place, model, state, t, notes);
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
  // The wants that aren't covered by what's there and what's on its way: the urgent ones first, then the part of
  // the ship the first officer has put first, then as the file has them. One the player has taken is left to them.
  const firstPart = state.orders?.first?.part ?? null;
  const mine = state.orders?.mine ?? null;
  const short = [];
  for (const want of model.wants) {
    const store = storeById(model, want.store);
    const have = haveOf(game, store, want.item);
    const wants = wantsNow(state, want);
    if (have + comingTo(jobs, store.id, want.item) >= wants) continue;
    const why = urgentWhy(game, place, model, store, want.item, have);
    // What's run low is kept for the quartermaster's next look.
    if (why && model.deciders?.levels) ((state.orders ??= {}).urgent ??= {})[wantKey(want)] = { at: t, why };
    if (mine?.[wantKey(want)]) continue;
    short.push({ want, store, have, wants, urgent: Boolean(why), rank: (why ? 2 : 0) + (firstPart && partOf(model, place, want) === firstPart ? 1 : 0) });
  }
  short.sort((a, b) => b.rank - a.rank);
  let left = 0;
  for (const { want, store, have, wants, urgent } of short) {
    for (let raised = 0; raised < MOST_AT_ONCE; raised += 1) {
      const coming = comingTo(jobs, store.id, want.item);
      if (have + coming >= wants) break;
      const source = sourceFor(game, place, model, state, jobs, store, want.item);
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

// What a store wants of a thing now, for whoever counts it elsewhere (src/hands.js pays by it).
export const wantedNow = (game, place, want) => wantsNow(game.logistics?.[place], want);

// Everything the stores want, a line each: what each has against what it wants, who's carrying for it and since
// when, or why nobody is. Reading this changes nothing.
export function workView(game, place) {
  const model = logisticsOf(place);
  if (!model) return [];
  const state = game.logistics?.[place] ?? null;
  const jobs = jobsAt(game, place);
  const hours = game.clock.hours;
  let holds = null;
  const held = (key) => (holds ??= holdsAt(game, place))(key);
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
    const nobody = open ? whyNobody(game, place, store, hours, jobs, model, held, Boolean(urgent) && short) : null;
    const said = [
      ...carried.map((j) => `${personCalled(game, j.by)} is ${doingWords(model, j)}, since ${clockWords(j.took ?? j.since)}`),
      ...down.map((j) => `${loadWords(j.load.item, j.load.n)} set down`),
      ...(short && yours ? [`yours since ${clockWords(yours.since)}`] : []),
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
      // The player can take it while it's short and nobody's carrying for it, and give it back once it's theirs.
      canTake: short && !yours && !carried.length && game.location === place,
    };
  });
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
  let holds = null;
  const held = (key) => (holds ??= holdsAt(game, place))(key);
  const lines = workView(game, place);
  const lineOf = (want) => lines.find((one) => one.id === wantKey(want));
  // Everyone who carries for any store, and how many of them could take a job this minute.
  const hands = [...new Set(model.stores.filter((store) => Object.keys(store.wants).length).flatMap((store) => carriersFor(game, place, store)))];
  const free = hands.filter((key) => !whyNot(game, place, key, game.clock.hours, jobs, model, held)).length;
  // An order as it stands: whose it is, or why nobody's deciding. Before anyone has looked, it's who would.
  const decided = (decider, order) => {
    if (!decider) return null;
    if (order) return { post: decider.words, by: order.by ? calledBy(game, place, order.by) : null, nobody: order.by ? null : order.why };
    return { post: decider.words, by: null, nobody: deciderNow(game, place, decider).why ?? "nobody has looked yet" };
  };
  const first = decided(model.deciders?.first, orders.first);
  const levels = decided(model.deciders?.levels, orders.levels);
  const firstPart = first?.by ? orders.first.part : null;
  const sittings = model.sittings;
  const minute = now % 1440;
  const sittingOn = sittings.at.some((start) => minute >= start && minute < start + sittings.minutes);
  const next = sittings.at.find((start) => start > minute) ?? sittings.at[0];
  const rank = (want) => {
    const line = lineOf(want);
    return (line.urgent ? 2 : 0) + (firstPart && partOf(model, place, want) === firstPart ? 1 : 0);
  };
  return {
    name: model.name,
    hands: { free, of: hands.length },
    first: first && {
      post: first.post,
      by: first.by,
      part: firstPart,
      title: firstPart ? `${upperFirst(PART_WORDS[firstPart])} first` : "As it comes",
      why: first.by ? orders.first.why : first.nobody,
      since: first.by ? whenWords(orders.first.since, now) : null,
    },
    levels: levels && { post: levels.post, by: levels.by, why: levels.by ? null : levels.nobody },
    stores: model.stores.map((store) => {
      if (store.count) {
        const n = countOf(game, store);
        return { id: store.id, name: upperFirst(store.name), room: store.roomName, count: { n, of: store.count.n, unit: store.count.unit }, note: model.kettles.includes(store) ? (sittingOn ? "a sitting is on" : `next sitting ${clockWords(next)}`) : "", rows: [] };
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
    jobs: model.wants
      .map((want, order) => ({ want, order, line: lineOf(want), rank: rank(want) }))
      .filter(({ line }) => line.short || line.busy || line.status !== "nothing to carry")
      .sort((a, b) => b.rank - a.rank || a.order - b.order)
      .map(({ want, line, rank: r }) => ({
        id: line.id,
        mark: r >= 2 ? "!!" : r === 1 ? "!" : "",
        what: `${line.store}: ${loadWords(want.item, Math.max(0, line.wants - line.has))} short of the ${line.wants} it wants`,
        why: line.urgent,
        status: line.status,
        by: line.by,
        busy: line.busy, stuck: line.stuck, mine: line.mine, canTake: line.canTake,
      })),
  };
}
