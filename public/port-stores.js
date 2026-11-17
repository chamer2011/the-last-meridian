// The Market's section for the port the player's standing in: its stores where they stand in its rooms, with what's
// in each against what it usually has, and who's carrying for them. Drawn from the game's state (world.stores, from
// src/port-stores.js). There's nothing to press: a store is opened by walking up to it in its room.

import { el } from "./dom.js";

const section = (title, ...children) => el("section", { class: "menu-section" }, title && el("h3", {}, title), children);
const muted = (text) => el("div", { class: "muted small" }, text);
const number = (n) => Number(n).toLocaleString("en-US");

// "12 of its usual 20": a store's line for one of the goods it keeps, with the port's word for how it stands.
function goodRow(one) {
  const short = one.n < one.usual * 0.8;
  return el("div", { class: `menu-row small${one.n < one.usual * 0.25 ? " tone-bad" : ""}`, title: `The whole port has ${one.has}: ${one.level}.` },
    el("span", {}, one.name),
    el("span", { class: short ? "" : "muted" }, `${number(one.n)} of its usual ${number(one.usual)}`));
}

function storeCard(store) {
  return el("div", { class: "card stack gap-small" },
    el("div", { class: "spread" }, el("strong", {}, store.name), el("span", { class: "muted small" }, `in ${store.room}`)),
    store.items.map(goodRow),
    store.stands ? el("div", { class: `small${store.bare ? " tone-bad" : ""}` }, store.stands) : null);
}

// Who's carrying, or why nobody is.
function boardLines(view) {
  const { jobs, hands } = view;
  const lines = jobs.map((job) => el("div", { class: "menu-row small" }, el("span", {}, `${job.who} is ${job.doing}`), el("span", { class: "muted" }, job.since > 0 ? `${job.since} min` : "just now")));
  if (lines.length) return lines;
  if (!hands.of) return [muted("Nobody's named to carry for these stores.")];
  const idle = hands.idle ? ` (${hands.idle})` : "";
  return [muted(hands.free ? `Nothing to carry just now. ${hands.free} of its ${hands.of} carriers ${hands.free === 1 ? "is" : "are"} about${idle}.` : `Nobody's about to carry${idle}. What's waiting waits for them.`)];
}

export function portStoreSections(g) {
  const view = g.world?.stores;
  if (!view?.stores?.length) return [];
  return [section(`${view.name}'s stores`,
    muted(`What ${view.name} has, where it stands in its rooms: each store holds its share of what the whole port has today, so a port that's short has bare shelves. Walk up to one and open it to see.${view.owner ? ` ${view.owner.replace(/^It belongs/, "They belong")} Taking from one is taking from the port.` : ""}`),
    view.stores.map(storeCard),
    el("h4", { class: "small" }, "Its carriers"),
    muted(`They carry between the stores and ${view.dock ? view.dock.replace(/^The /, "the ") : "the dock"}, where goods come and go. What a ship loads at the dock comes off these shelves first, and is made up after it from what the port has.`),
    boardLines(view))];
}
