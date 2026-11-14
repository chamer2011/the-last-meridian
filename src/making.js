// Salvage made into parts crates (step 6 of the loot plan). Each piece of salvage counts for so much, by its item file's
// salvage line (a circuit board 2, a reactor seal ring 15, scrap 1), and a place's logistics file says what its bench
// makes from how much, in which room, how long it takes and where it goes, in its salvage makes line: aboard the
// Meridian, a parts crate from 10 salvage, in the Repair Bay, in 2 hours, into the parts lockers. In that room, "You
// can" offers it, and says why not while the player hasn't enough. Making it uses up the least valuable salvage first,
// passes the hours (a tenth less for each point of Engineering, down to half), practises Engineering, and puts what's
// made into the store, or into the player's pack when the stores are full or the line names none. Nothing comes from
// nothing: what's used up is gone, and a crate made counts as one brought aboard (src/puts.js).
//
// It registers itself with src/room-hooks.js; nothing else in the game calls it.

import { addOrder, addRoomActs } from "./room-hooks.js";
import { handsFree } from "./body.js";
import { roomFor, storeCounts, storePut } from "./bag.js";
import { YOU } from "./command.js";
import { ITEMS } from "./data.js";
import { logisticsOf } from "./logistics.js";
import { notePut } from "./puts.js";
import { addItem, passTime, practice, removeItem, skillRank } from "./rules.js";

// Too tired to work, as for a shift.
const TOO_TIRED = 85;
// Each point of Engineering takes this share off the time, down to this share of it.
const SKILL_STEP = 0.1;
const QUICKEST = 0.5;

const salvageOf = (id) => Math.max(0, Number(ITEMS[id]?.salvage) || 0);
const aName = (id) => {
  const name = (ITEMS[id]?.name ?? id).toLowerCase();
  return `${/^[aeiou]/.test(name) ? "an" : "a"} ${name}`;
};
const counted = (id, n) => {
  if (n === 1) return aName(id);
  const name = (ITEMS[id]?.name ?? id).toLowerCase();
  return `${n} ${name}${/(s|scrap)$/.test(name) ? "" : "s"}`;
};
const listed = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);
const hoursWords = (hours) => {
  const minutes = Math.round(hours * 60);
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return minutes < 60 ? `${minutes} minutes` : `${Math.floor(minutes / 60)} hour${minutes < 120 ? "" : "s"} ${minutes % 60} minutes`;
};

// What the place's bench makes, if this is the room it's made in.
const makingIn = (place, room) => {
  const making = logisticsOf(place)?.making;
  return making && making.room === room ? making : null;
};
// How much salvage the player carries, in all.
export const salvageCarried = (game) => Object.entries(game.inventory ?? {}).reduce((sum, [id, n]) => sum + salvageOf(id) * Math.max(0, n), 0);
// The salvage making one takes, the least valuable for what it counts first: so many of which items, and how much they
// come to. Null when there isn't enough.
export function salvageFor(game, per) {
  const carried = Object.entries(game.inventory ?? {})
    .filter(([id, n]) => n > 0 && salvageOf(id) > 0)
    .sort(([a], [b]) => (ITEMS[a].price ?? 0) / salvageOf(a) - (ITEMS[b].price ?? 0) / salvageOf(b) || salvageOf(a) - salvageOf(b) || a.localeCompare(b));
  const used = [];
  let got = 0;
  for (const [id, n] of carried) {
    let take = 0;
    while (take < n && got < per) {
      take += 1;
      got += salvageOf(id);
    }
    if (take) used.push({ id, n: take });
    if (got >= per) return { used, got };
  }
  return null;
}
// How long it takes the player, with their Engineering.
export const makingHours = (game, making) => making.hours * Math.max(QUICKEST, 1 - SKILL_STEP * skillRank(game, "engineering"));

// Where what's made can go: one of the stores the line names with room for it, or the player's pack.
function roomForMade(game, place, making) {
  const model = logisticsOf(place);
  for (const id of making.into) {
    const store = model.stores.find((one) => one.id === id);
    if (store && (storeCounts(game, store.key, store.holds)[making.item] ?? 0) + making.n <= (store.holds[making.item] ?? 0)) return store.name;
  }
  return roomFor(game, making.item) ? "your pack" : null;
}

function cantMake(game, place, making) {
  if ((game.needs?.fatigue ?? 0) >= TOO_TIRED) return "You're too tired to work. Get some sleep first.";
  if (!handsFree(game, place, YOU)) return "You can't work with a hand that's no use. Let it heal first.";
  const have = salvageCarried(game);
  if (have < making.per) return `It takes ${making.per} salvage, and you carry ${have || "none"}.`;
  if (!roomForMade(game, place, making)) return `There's no room for ${aName(making.item)} in the ${making.into.length ? "stores or your pack" : "pack"}.`;
  return null;
}

addRoomActs((game, { place, room }) => {
  const making = makingIn(place, room);
  if (!making) return [];
  const why = cantMake(game, place, making);
  const what = making.n === 1 ? aName(making.item) : counted(making.item, making.n);
  const label = `Make ${what} from salvage (${hoursWords(makingHours(game, making))})`;
  return [{ id: "make-from-salvage", key: making.item, label, detail: why ?? `uses ${making.per} of your ${salvageCarried(game)} salvage, the least valuable first`, ...(why ? { disabled: true } : {}) }];
});

addOrder("make-from-salvage", (game, body, { room }) => {
  const place = game.location;
  const making = makingIn(place, room);
  if (!making) throw new Error("There's nothing to make here.");
  const why = cantMake(game, place, making);
  if (why) throw new Error(why);
  const plan = salvageFor(game, making.per);
  for (const { id, n } of plan.used) removeItem(game, id, n);
  const hours = makingHours(game, making);
  const notes = passTime(game, hours, "work");
  // Into the first of the stores with room, then the pack.
  const model = logisticsOf(place);
  let left = making.n;
  const into = [];
  for (const id of making.into) {
    if (left <= 0) break;
    const store = model.stores.find((one) => one.id === id);
    const put = store ? storePut(game, store.key, store.holds, making.item, left) : 0;
    if (!put) continue;
    left -= put;
    into.push(`the ${store.name}`);
    // A crate made counts as one brought aboard, for anyone who's asked for crates (src/requests.js).
    notePut(game, store.key, making.item, put);
    notePut(game, "aboard", making.item, put);
  }
  if (left > 0) {
    addItem(game, making.item, left);
    into.push("your pack");
  }
  const what = making.n === 1 ? aName(making.item) : counted(making.item, making.n);
  const used = listed(plan.used.map(({ id, n }) => counted(id, n)));
  const line = `[WORK] You spend ${hoursWords(hours)} at the bench and make ${what} from ${used}. ${making.n === 1 ? "It goes" : "They go"} into ${listed(into)}.`;
  return { said: [line, ...practice(game, "engineering", 1), ...notes].join("\n") };
});
