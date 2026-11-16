// What goods are worth to the ship. An item's file can say so in a line of its own (world/items): feeds, so many
// sittings at the kettle; doses, for the medbay; spares, so many repairs. A ration crate feeds 200 and a tin feeds
// one; a medicine crate is 20 doses and a medkit four; a parts crate is one repair. Whatever uses a kind of goods
// takes any item that's worth some of it: the galley cooks any food in its store, the medbay doses from any medicine
// in its cabinet, a repair takes any spare (src/logistics.js, src/medbay.js), and the Ship menu and the asks count it
// all by its worth (src/ship.js, src/requests.js).
//
// This is step 2 of the logistics rework (docs/notes/project-logistics.md, "The rework"): the worth is the right-hand
// end of each resource's tree, where developed goods are used up.

import { ITEMS } from "./data.js";

// The kinds of goods the ship uses up, with the line of an item's file that says what one of it is worth.
export const WORTH = { food: "feeds", medicine: "doses", parts: "spares" };
export const KINDS = Object.keys(WORTH);

// What one of an item is worth of a kind: nothing for an item that isn't that kind of goods.
export const worthOf = (id, kind) => Math.max(0, Number(ITEMS[id]?.[WORTH[kind]]) || 0);
// The kind of goods an item is, if it's any: food, medicine or parts.
export const kindOf = (id) => KINDS.find((kind) => worthOf(id, kind) > 0) ?? null;

// Everything in a store that's worth something of a kind, the most worth first and then by name, so the same store
// always gives up the same things: [{ item, n, worth }], from a store's counts by item. Items in skip are left out.
export function worthIn(counts, kind, skip = []) {
  return Object.entries(counts ?? {})
    .map(([item, n]) => ({ item, n, worth: worthOf(item, kind) }))
    .filter((one) => one.n > 0 && one.worth > 0 && !skip.includes(one.item))
    .sort((a, b) => b.worth - a.worth || a.item.localeCompare(b.item));
}
// What that comes to in all.
export const worthTotal = (counts, kind, skip = []) => worthIn(counts, kind, skip).reduce((sum, one) => sum + one.n * one.worth, 0);

// Which of a store's things to take to make up so much worth, and no more than that: the biggest that fit first.
// [{ item, n, worth }] with n the number taken of each; nothing when nothing fits.
export function pickWorth(counts, kind, most, skip = []) {
  const picked = [];
  let left = most;
  for (const one of worthIn(counts, kind, skip)) {
    const n = Math.min(one.n, Math.floor(left / one.worth));
    if (n <= 0) continue;
    picked.push({ item: one.item, n, worth: one.worth });
    left -= n * one.worth;
  }
  return picked;
}

// What an item is worth to the ship, in words, for the inventory: "feeds 200 at the kettle", "4 doses for the medbay",
// "a repair's worth of spares". Null for an item that's worth nothing to her.
export function worthWords(id) {
  const feeds = worthOf(id, "food");
  if (feeds) return `feeds ${feeds} at the kettle`;
  const doses = worthOf(id, "medicine");
  if (doses) return `${doses} dose${doses === 1 ? "" : "s"} for the medbay`;
  const spares = worthOf(id, "parts");
  if (spares) return spares === 1 ? "one repair's worth of spares" : `${spares} repairs' worth of spares`;
  return null;
}
