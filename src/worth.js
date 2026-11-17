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

// ---- Comforts (step 12 of the logistics rework, src/comforts.js) ---------------------------------------------

// What the crew uses up to keep its spirits: drink, tea and tobacco, clothes. An item's comfort line says what one of
// it is worth of one of them, in the store the crew's comforts are kept in: "80 drink", "100 tea and tobacco",
// "100 clothes". A hamper of provisions says "a good table for 300": how many sit down to it.
export const COMFORTS = { drink: "drink", leaf: "tea and tobacco", clothes: "clothes" };
export const COMFORT_IDS = Object.keys(COMFORTS);
const read = new Map();
function readComfort(words) {
  const text = String(words ?? "").trim().toLowerCase();
  if (!text) return null;
  if (read.has(text)) return read.get(text);
  const table = text.match(/^a good table for (\d+)$/);
  const found = text.match(/^(\d+)\s+(.+)$/);
  const kind = found ? COMFORT_IDS.find((id) => COMFORTS[id] === found[2]) : null;
  const made = table && Number(table[1]) > 0 ? { kind: "table", n: Number(table[1]) } : kind && Number(found[1]) > 0 ? { kind, n: Number(found[1]) } : { problem: true };
  read.set(text, made);
  return made;
}
// What one of an item is worth as a comfort: { kind, n }, kind being drink, leaf, clothes or table. Null for an item
// that isn't one, or whose line can't be read.
export function comfortOf(id) {
  const made = readComfort(ITEMS[id]?.comfort);
  return made && !made.problem ? made : null;
}
// What's wrong with an item's comfort line, in plain words, or null.
export const comfortProblem = (id) => (readComfort(ITEMS[id]?.comfort)?.problem ? `comfort is written like 80 drink, 100 tea and tobacco, 100 clothes, or a good table for 300, not "${ITEMS[id].comfort}"` : null);
// How well an item is remembered when it's given to someone: nothing for an item that's no gift.
export const giftOf = (id) => Math.max(0, Number(ITEMS[id]?.gift) || 0);

// What an item is worth to the crew, in words, for the inventory: "80 of the crew's drink", "a good table for 300".
export function comfortWords(id) {
  const one = comfortOf(id);
  if (!one) return null;
  return one.kind === "table" ? `a good table for ${one.n}` : `${one.n} of the crew's ${COMFORTS[one.kind]}`;
}
