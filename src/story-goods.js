// The story and the ports' goods (the logistics rework, step 9): a scene, a talk, a request or a computer's program
// can ask how many of a good a port holds, and change it.
//
//   ? goods ration crates < 200 at haven          how many it holds, in the good's own count
//   * goods ration crates -150 at haven: The convoy never came.      so many taken out of its stores, or put in
//
// The good is named as its tree names it (world/goods), the port by its id or its name (it has to have a file in
// world/ports and hold that good), and the number is so many crates, sacks or casks. A change can't take more than
// the port has. The supplies' words (plenty, short) and the prices follow by themselves, since they're worked out from
// the amounts.

import { LOCATIONS } from "./data.js";
import { amountOf, counted, portTake, portsModel } from "./ports.js";

const OPS = { ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, "<": (a, b) => a < b, "=": (a, b) => a === b, "==": (a, b) => a === b, "!=": (a, b) => a !== b };
const HOW = "a good, a number, then at and a port";

// The good and the port a line names: "ration crates" and "haven", or what's wrong with them.
function named(goodWords, placeWords) {
  const model = portsModel();
  const place = model.placeByWords?.(placeWords) ?? (LOCATIONS[placeWords] ? placeWords : null);
  if (!place || !model.ports[place]) return { problem: `there's no port called ${placeWords || "nothing"} with a file in world/ports` };
  const good = model.goodByWords(goodWords);
  if (!good) return { problem: `there's no good called ${goodWords || "nothing"} in world/goods` };
  if (!model.ports[place].holds[good.id]) return { problem: `${LOCATIONS[place]?.name ?? place} doesn't hold ${good.name}: its file in world/ports says what it holds` };
  return { place, good };
}

// "ration crates < 200 at haven": the words after goods in a condition.
export function readGoodsAsk(rest) {
  const cut = rest.findIndex((word) => word.toLowerCase() === "at");
  const head = cut >= 0 ? rest.slice(0, cut) : rest;
  const opAt = head.findIndex((word) => OPS[word]);
  if (cut < 0 || opAt < 1 || head.length !== opAt + 2 || !/^\d+$/.test(head[opAt + 1])) return { problem: `"goods" needs a good, one of >= <= > < = !=, a number, then at and a port, like goods ration crates < 200 at haven` };
  const found = named(head.slice(0, opAt).join(" "), rest.slice(cut + 1).join(" "));
  if (found.problem) return found;
  return { kind: "goods", id: found.good.id, op: head[opAt], amount: Number(head[opAt + 1]), place: found.place };
}
// Whether it holds: whole ones are counted, as the star map counts them.
export function goodsHolds(game, term) {
  if (!game.world) return false;
  return OPS[term.op](Math.floor(amountOf(game.world, term.place, term.id) + 1e-6), term.amount);
}

// "ration crates -150 at haven", and the reason after the colon: the words after goods in an effect.
export function readGoodsEffect(words, after) {
  const cut = words.findIndex((word) => word.toLowerCase() === "at");
  const head = cut >= 0 ? words.slice(0, cut) : words;
  const number = head.at(-1) ?? "";
  if (cut < 0 || head.length < 2 || !/^[+-]?\d+$/.test(number) || Number(number) === 0) return { problem: `goods is written * goods ${HOW}, then a colon and the reason: * goods ration crates -150 at haven: The convoy never came` };
  if (!after) return { problem: "goods needs a colon and the reason after it" };
  const found = named(head.slice(0, -1).join(" "), words.slice(cut + 1).join(" "));
  if (found.problem) return found;
  return { do: { command: "goods", good: found.good.id, n: Number(number), place: found.place, reason: after } };
}
// The change itself, and the line the player reads.
export function storyGoods(game, step) {
  const model = portsModel();
  const good = model.goods[step.good];
  if (!game.world || !good || !model.ports[step.place]?.holds[step.good]) return [];
  const moved = Math.abs(portTake(game.world, step.place, step.good, -step.n));
  const name = LOCATIONS[step.place]?.name ?? step.place;
  return [`[WORLD] ${name}: ${counted(good, Math.round(moved))} ${step.n < 0 ? "gone from its stores" : "more in its stores"}. ${step.reason}`];
}
