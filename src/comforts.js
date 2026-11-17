// Comforts aboard (step 12 of the logistics rework). The crew uses up drink, tea and tobacco, and clothes, a little
// every day, out of the store the ship's logistics file names for them (the comforts locker in the Long Mess). An
// item's own file says what one of it is worth: "comfort: 80 drink" for a keg, "comfort: 1 drink" for a bottle of the
// ship's beer (src/worth.js). src/logistics.js reads the file's lines; this is what they do.
//
// - Each comfort is used from what's open. When that's gone the next thing in the store that's worth some is opened,
//   the smallest first, so loose bottles go before a keg is broached. With nothing left the crew goes without, and
//   the story says so once.
// - Where morale settles (src/ship.js asks comfortsShift): while things are going wrong, every comfort the crew still
//   has steadies it by so many points, never past where a fed ship at ease settles; every comfort they've run out of
//   sours it by so many, however things are going.
// - A good table: after a hard day (a death aboard, fighting on the decks, a fire or a hole in the hull, the alarm),
//   while spirits are low, whoever decides what the stores want has the provisions in the store laid out at the first
//   evening sitting, enough hampers for everyone aboard if there are that many, and morale lifts at once: never past
//   where a fed ship at ease settles, and not more than once in three days.
// - A gift: something whose file has a gift line, handed to someone aboard, is remembered (src/command.js), the last
//   two of them, and one a week counts.
//
// Nothing here is made from nothing: what's used comes out of the store, and what the store holds was bought at a
// dock, found, or made aboard by the beer bucket and the still, which are machines in the logistics file.

import { addChecker, addOrder, addPersonActs } from "./room-hooks.js";
import { storeCounts, storeTake } from "./bag.js";
import { findCharacter } from "./campaign.js";
import { YOU, calledBy, commandOf, holderKey, lastGiftDay, lostReason, rememberGift } from "./command.js";
import { ITEMS } from "./data.js";
import { itemWords, logisticsOf, storeById } from "./logistics.js";
import { downRecord } from "./medbay.js";
import { aboardShip, isCaptain } from "./role.js";
import { removeItem } from "./rules.js";
import { SHIP_DATA } from "./world.js";
import { COMFORTS, COMFORT_IDS, comfortOf, comfortProblem, giftOf } from "./worth.js";

const SHIP = "meridian";
// What a hamper of provisions is worth: a good table, for so many.
const TABLE = "table";
// A comfort that's run out is said again only after this long, in minutes: the bucket's beer comes and goes.
const SAID_EVERY = 3 * 1440;
// A good table is a treat, and stops being one: there's one in so many days at most.
const TABLE_EVERY = 3;
// With anyone, one gift a week counts.
const GIFT_DAYS = 7;

const round1 = (n) => Math.round(n * 10) / 10;
const dayLabel = (t) => `Day ${Math.floor(t / 1440) + 1}`;
const upperFirst = (words) => (words ? words[0].toUpperCase() + words.slice(1) : words);
const aOr = (words) => `${/^[aeiou]/i.test(words) ? "an" : "a"} ${words}`;
const hearsOf = (game, place) => game.location === place || (place === SHIP && (isCaptain(game) || aboardShip(game)));

export const comfortsOf = (place) => logisticsOf(place)?.comforts ?? null;
// What the save keeps of a place's comforts: how much of each is open, which have run out and since when, and the
// last good table. A new game has it from the start (src/logistics.js), so a game from before is known by not having it.
export const newComforts = () => ({ open: {}, out: {} });

// Everyone the ship started with uses what the file says; fewer aboard use less.
function shareOf(game, place) {
  const start = SHIP_DATA.ship?.aboard || 1;
  return place === SHIP ? (game.ship?.aboard ?? start) / start : 1;
}

// The next thing in a store that's worth some of a comfort (or a good table): the one worth least, so what's loose
// goes before what's sealed. Null when there's nothing.
function nextOf(game, store, kind) {
  const counts = storeCounts(game, store.key, store.holds);
  let best = null;
  for (const id in counts) {
    if (!(counts[id] > 0)) continue;
    const worth = comfortOf(id);
    if (!worth || worth.kind !== kind) continue;
    if (!best || worth.n < best.n || (worth.n === best.n && id < best.id)) best = { id, n: worth.n };
  }
  return best;
}
// The biggest thing a store keeps of a comfort, in words, for saying what to buy: "keg of beer and spirits".
function bulkOf(store, kind) {
  let best = null;
  for (const id in store.holds) {
    const worth = comfortOf(id);
    if (worth?.kind === kind && (!best || worth.n > best.n)) best = { id, n: worth.n };
  }
  return best ? itemWords(best.id, 1) : null;
}

// Whether a place's crew has run out of a comfort (drink, leaf or clothes): for the tea urn and the talk in the rooms.
export const comfortOut = (game, place, kind) => game.logistics?.[place]?.comforts?.out?.[kind] !== undefined;

// ---- The clock --------------------------------------------------------------------------------------------------------

// One piece of the clock: the crew uses a little of each comfort, the store says when one's run out, and at the first
// evening sitting after a hard day a good table is laid.
export function runComforts(game, place, model, state, t, minutes, notes) {
  const c = model.comforts;
  const store = storeById(model, c.store);
  const say = (text) => {
    if (place === SHIP) game.ship?.log?.push({ day: dayLabel(t), tag: "SUPPLY", text });
    if (hearsOf(game, place)) notes.push(`[SHIP] ${text}`);
  };
  if (!state.comforts) {
    // A game from before the crew had comforts is told once how it goes now.
    state.comforts = newComforts();
    if (place === SHIP) say(`From now on the crew's comforts are kept in the ${store.name} in ${store.roomName}: drink, tea and tobacco, and clothes, which everyone aboard uses up a little every day. While they last, the crew holds steadier when things go wrong; going without sours the mood, slowly. They're bought at a dock from the Ship menu, out of the ship's purse, and the beer bucket and the still make a little of the drink. The Ship menu has a Comforts line.`);
  }
  const s = state.comforts;
  const share = shareOf(game, place);
  for (const kind of COMFORT_IDS) {
    const aDay = c.uses[kind] * share;
    if (!(aDay > 0)) continue;
    const wasOut = s.out[kind] !== undefined;
    // While there's none, nothing's owed: people go without, and the store is looked at again on the hour.
    if (wasOut && !(t % 60 < minutes)) continue;
    let owed = (aDay * minutes) / 1440;
    let open = s.open[kind] ?? 0;
    while (owed > 1e-9) {
      if (open >= owed) {
        open -= owed;
        owed = 0;
        break;
      }
      owed -= open;
      open = 0;
      const next = nextOf(game, store, kind);
      if (!next) break;
      storeTake(game, store.key, store.holds, next.id, 1);
      open = next.n;
    }
    s.open[kind] = open;
    if (owed > 1e-9 && !wasOut) {
      s.out[kind] = t;
      const said = (s.said ??= {});
      if (!(t - (said[kind] ?? -Infinity) < SAID_EVERY)) {
        said[kind] = t;
        const bulk = bulkOf(store, kind);
        say(`The crew has run out of ${COMFORTS[kind]}: there's none left in the ${store.name}. Going without sours the mood aboard, a little each day.${bulk ? ` ${upperFirst(aOr(bulk))} from a port that has some would put it right: the Ship menu buys one at a dock.` : ""}`);
      }
    } else if (!(owed > 1e-9) && wasOut) delete s.out[kind];
  }
  if (place !== SHIP) return;
  // A fire or a hole in the hull at any time today makes it a hard day, whenever it's put out or patched.
  const troubles = game.emergencies;
  if (troubles) {
    let what = null;
    for (const key in troubles.fires) if (troubles.fires[key].place === place) { what = "a fire aboard"; break; }
    if (!what) for (const key in troubles.breaches) if (troubles.breaches[key].place === place) { what = "a hole in the hull"; break; }
    if (what) s.hard = { day: Math.floor(t / 1440), what };
  }
  if (c.tableLifts > 0) layTable(game, place, model, state, store, t, minutes, say);
}

// What made today a hard day, in a few words, or null for a day like any other. A kettle that ran dry isn't one: a
// table of bread and honey is for a blow, not for a ship that's short every day.
function hardDay(game, place, s, day) {
  const tally = game.command?.[place]?.tally?.[day] ?? null;
  if (tally?.deaths > 0) return "a death aboard";
  for (const id in game.battles) if (Math.floor((game.battles[id].hours ?? -1) / 24) === day) return "the fighting on her decks";
  if (s.hard?.day === day) return s.hard.what;
  if (tally?.alarms > 0) return "the alarm";
  return null;
}

// The first sitting of the evening, as a minute of the day: null where nobody sits down to eat after noon.
const eveningAt = (model) => (model.sittings?.at ?? []).find((start) => start >= 720) ?? null;

// A good table, in the piece of the clock the first evening sitting starts in, after a hard day, while morale is
// under where a fed ship at ease settles: whoever decides what the stores want has the provisions in the store laid
// out, a hamper for every so many aboard, and morale lifts at once by what the file says, or by the share of everyone
// the hampers reached, never past that mark. One in three days at most. Someone who can't decide (nobody in the
// post, or its holder dead, locked up or laid up) lays nothing.
const atEase = () => SHIP_DATA.rations?.standard?.morale ?? 60;
function layTable(game, place, model, state, store, t, minutes, say) {
  const s = state.comforts;
  const day = Math.floor(t / 1440);
  if (s.table && day - s.table.day < TABLE_EVERY) return;
  const at = eveningAt(model);
  const minute = t - day * 1440;
  if (at === null || !(minute <= at && at < minute + minutes)) return;
  const why = hardDay(game, place, s, day);
  const was = game.ship.morale ?? 0;
  if (!why || was >= atEase()) return;
  const post = model.deciders?.levels?.post ?? null;
  const key = post ? holderKey(game, place, post) : null;
  if (!key || key === YOU || lostReason(game, place, key)) return;
  const aboard = Math.max(1, game.ship?.aboard ?? 1);
  const used = {};
  let seats = 0;
  let n = 0;
  while (seats < aboard) {
    const next = nextOf(game, store, TABLE);
    if (!next) break;
    storeTake(game, store.key, store.holds, next.id, 1);
    seats += next.n;
    n += 1;
    used[next.id] = (used[next.id] ?? 0) + 1;
  }
  if (!n) return;
  const part = Math.min(1, seats / aboard);
  game.ship.morale = Math.min(atEase(), was + Math.max(1, Math.round(model.comforts.tableLifts * part)));
  const lift = game.ship.morale - was;
  s.table = { day, n, lift, why, by: key };
  const what = Object.entries(used).map(([id, k]) => `${k} ${itemWords(id, k)}`).join(" and ");
  say(`${upperFirst(calledBy(game, place, key))} had a good table laid in ${store.roomName} this evening, after ${why}: ${what}, ${part >= 1 ? "enough for everyone aboard" : `enough for about ${Math.round(seats).toLocaleString("en-US")} of the ${aboard.toLocaleString("en-US")} aboard`}.${lift > 0 ? ` Morale is up ${lift}.` : ""}`);
}

// ---- What they do to morale ----------------------------------------------------------------------------------------------

// Where morale settles, once the comforts have had their say: base is where the rations and the shortages put it, and
// fine is where a fed ship at ease settles. While base is under that, every comfort the crew still has steadies it,
// never past fine; every comfort they've run out of sours it, however things are going.
export function comfortsShift(game, base, fine, place = SHIP) {
  const c = comfortsOf(place);
  const s = game.logistics?.[place]?.comforts;
  if (!c || !s) return base;
  let had = 0;
  let out = 0;
  for (const kind of COMFORT_IDS) {
    if (!(c.uses[kind] > 0)) continue;
    if (s.out?.[kind] !== undefined) out += 1;
    else had += 1;
  }
  const steadied = base < fine ? Math.min(fine, base + c.steadies * had) : base;
  return steadied - c.sours * out;
}

// ---- What the Ship menu shows ------------------------------------------------------------------------------------------

// The crew's comforts for the Ship menu: how much of each is left in the store and open, how long it lasts, what's
// run out, and the provisions for a good table. Null where the place has none. Reading it changes nothing.
export function comfortsView(game, place = SHIP) {
  const model = logisticsOf(place);
  const c = model?.comforts;
  if (!c) return null;
  const store = storeById(model, c.store);
  const s = game.logistics?.[place]?.comforts ?? null;
  const counts = storeCounts(game, store.key, store.holds);
  const share = shareOf(game, place);
  const kinds = COMFORT_IDS.filter((kind) => c.uses[kind] > 0).map((kind) => {
    let left = s?.open?.[kind] ?? 0;
    for (const id in counts) {
      const worth = comfortOf(id);
      if (counts[id] > 0 && worth?.kind === kind) left += worth.n * counts[id];
    }
    // What the store holds of it when it's full, for a bar.
    let of = 0;
    for (const id in store.holds) {
      const worth = comfortOf(id);
      if (worth?.kind === kind) of += worth.n * store.holds[id];
    }
    const aDay = c.uses[kind] * share;
    return { id: kind, name: COMFORTS[kind], left: Math.round(left), of, aDay: round1(aDay), days: aDay > 0 ? Math.floor(left / aDay + 1e-9) : null, out: !(left > 1e-9), bulk: bulkOf(store, kind) };
  });
  let hampers = 0;
  let seats = 0;
  for (const id in counts) {
    const worth = comfortOf(id);
    if (counts[id] > 0 && worth?.kind === TABLE) {
      hampers += counts[id];
      seats += worth.n * counts[id];
    }
  }
  const last = s?.table?.n ? { day: s.table.day + 1, lift: s.table.lift, why: s.table.why, by: upperFirst(calledBy(game, place, s.table.by)) } : null;
  return {
    store: store.name,
    room: store.roomName,
    kinds,
    steadies: c.steadies,
    sours: c.sours,
    table: c.tableLifts > 0 ? { lifts: c.tableLifts, hampers, seats, last } : null,
  };
}

// ---- Gifts ---------------------------------------------------------------------------------------------------------------

const GIFT_ACTS = ["give-gift", "give-gift-2", "give-gift-3"];
const today = (game) => Math.floor((game.clock?.hours ?? 0) / 24) + 1;
// The gifts in the pack, the best first: as many as there are buttons for.
function giftsCarried(game) {
  const out = [];
  // Not what the player's wearing or holding: the one coat on their back isn't offered.
  const worn = (id) => ["weapon", "armor", "sidearm"].filter((slot) => game.equipped?.[slot] === id).length;
  for (const id in game.inventory) if (game.inventory[id] > worn(id) && giftOf(id) > 0) out.push({ id, w: giftOf(id) });
  return out.sort((a, b) => b.w - a.w || a.id.localeCompare(b.id)).slice(0, GIFT_ACTS.length);
}
// Why someone can't be given a gift just now, or null: they've had one from the player this week.
function giftWait(game, key) {
  const last = lastGiftDay(game, key);
  return last !== null && today(game) - last < GIFT_DAYS ? "they've had a gift from you this week" : null;
}
// What a gift is called when it's handed over: "a vantor red wine", "a case of fine things", "some smuggled cigars".
function giftWords(id) {
  const name = (ITEMS[id]?.name ?? id).toLowerCase();
  const head = name.includes(" of ") ? name.slice(0, name.indexOf(" of ")) : name;
  return /(?:[^s]s|ginger)$/.test(head) ? `some ${name}` : aOr(name);
}

// Aboard the Meridian, where what people remember is kept, anyone awake and on their feet can be given something
// from the pack whose file says it's a gift: the best three are offered.
addPersonActs((game, entry, key) => {
  if (game.location !== SHIP) return null;
  // Asked for everyone in sight twice a second, and most packs hold no gift.
  let any = false;
  for (const id in game.inventory) if (game.inventory[id] > 0 && ITEMS[id]?.gift > 0) { any = true; break; }
  if (!any || !commandOf(SHIP) || entry.asleep || downRecord(game, SHIP, key)) return null;
  const wait = giftWait(game, key);
  return giftsCarried(game).map((gift, i) => ({ id: GIFT_ACTS[i], label: `Give ${giftWords(gift.id)}`, detail: wait ?? "a gift: they'll remember it", ...(wait ? { disabled: true } : {}) }));
});

GIFT_ACTS.forEach((id, i) => addOrder(id, (game, body, { people }) => {
  const key = String(body.key ?? "").replace(/^person:/, "");
  const entry = people.find((one) => (one.id ?? one.name) === key);
  if (!entry) throw new Error("They aren't there any more.");
  if (game.location !== SHIP || !commandOf(SHIP)) throw new Error("A gift is only remembered aboard the Meridian.");
  if (entry.asleep) throw new Error("They're asleep.");
  if (downRecord(game, SHIP, key)) throw new Error("They're in no state to be given anything.");
  const gift = giftsCarried(game)[i];
  if (!gift) throw new Error("You've nothing like that to give.");
  if (giftWait(game, key)) throw new Error("They've had a gift from you this week. Another so soon would only embarrass them.");
  removeItem(game, gift.id, 1);
  const words = giftWords(gift.id);
  rememberGift(game, key, words, gift.w);
  const name = (entry.id ? findCharacter(game.campaign, entry.id)?.name : null) ?? entry.name ?? "them";
  const thanks = gift.w >= 5 ? "There's a moment with no words in it, and then you're thanked twice." : gift.w >= 3 ? "You're thanked, and it's meant." : "You get a nod and a thank you.";
  return { said: `[GIFT] You give ${name} ${words}. ${thanks}` };
}));

// ---- The checker ---------------------------------------------------------------------------------------------------------

// An item's comfort line has to be one the game can read, and its gift line a number above nothing.
addChecker(() => Object.keys(ITEMS).flatMap((id) => {
  const problems = [];
  const comfort = comfortProblem(id);
  if (comfort) problems.push(`world/items/${id}.txt: ${comfort}`);
  if (ITEMS[id].gift !== undefined && !(Number(ITEMS[id].gift) > 0)) problems.push(`world/items/${id}.txt: gift is a number above nothing, such as gift: 4, for how well it's remembered when it's given to someone`);
  return problems;
}));
