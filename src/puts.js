// What the player has put into the ship's stores and tank with their own hands or their own money, kept as running
// totals in the save, for the requests people make (src/requests.js) to count what's been brought since they asked.
// Taking something back out of a store takes it off that store's total, so carrying a crate out and in again counts
// once. It imports nothing, so the ship's buying and the inventory can both write to it.
//
// The totals are keyed by where and what: a store's thing key ("thing:meridian:store:pantry") and an item id, "aboard"
// and an item id for anything bought for the ship, and "tank" and "fuel" for the jump fuel.

const keyOf = (where, item) => `${where}|${item}`;

// Whoever else needs to know the moment something is put somewhere or taken from it: a port's store in its rooms, whose
// goods are the port's own (src/port-stores.js). Each is (game, where, item, n), n below nothing for what's taken.
const listeners = [];
export const whenPut = (fn) => { listeners.push(fn); };

export function notePut(game, where, item, n) {
  if (!where || !item || !Number.isFinite(n) || n === 0) return;
  game.puts ??= {};
  const key = keyOf(where, item);
  game.puts[key] = Math.round(((game.puts[key] ?? 0) + n) * 100) / 100;
  for (const fn of listeners) fn(game, where, item, n);
}

// How much the player has put there in all, so far. Reading it changes nothing.
export const putsOf = (game, where, item) => game.puts?.[keyOf(where, item)] ?? 0;
