// The Market's freight sections, for the Meridian's captain: what's in her freight hold and for whom, the loads the
// port she's docked at offers, this port's goods to buy and sell by the load, and where each good is cheap and where
// it's dear among the ports the captain knows of. Everything is drawn from the game's state (ship.freight, from
// src/freight.js), and every button is one of the ship's orders.

import { el, folded } from "./dom.js";
import { shipOrder } from "./map.js";

// What this needs from the main screen. Set once, when the page loads.
let app;
export function initFreight(hooks) {
  app = hooks;
}

const section = (title, ...children) => el("section", { class: "menu-section" }, title && el("h3", {}, title), children);
const muted = (text) => el("div", { class: "muted small" }, text);
const small = (text) => el("div", { class: "small" }, text);
const number = (n) => Number(n).toLocaleString("en-US");
const busy = () => Boolean(app?.ui.streaming || app?.ui.game.combat || app?.ui.game.check || app?.ui.game.talk);

// "running low on them", "short of them": how badly a port wants a load, from the game's own word for how much it has.
const WANTS = { plenty: "has taken a liking to them", normal: "is running low on them", short: "is short of them", scarce: "has hardly any left", "almost gone": "is all but out of them" };

// The hold, and what she's carrying for a fee.
function holdSection(f) {
  const { hold } = f;
  const line = (one) => el("div", { class: "menu-row small" },
    el("span", {}, `${number(one.n)} × ${one.name}`),
    el("span", { class: "muted" }, one.own >= one.n ? "her own" : one.own > 0 ? `${number(one.own)} her own, the rest carried for a fee` : "carried for a fee"));
  const load = (one) => el("div", { class: "stack gap-small" },
    el("div", { class: `menu-row small${one.late ? " tone-bad" : ""}` }, el("span", {}, `${one.what}, for ${one.to}`), el("strong", {}, `${number(one.fee)} cr`)),
    muted(one.late ? `Due by day ${one.by}: it's late, and pays half now.` : `Due by day ${one.by}. Paid into the purse when she docks there${one.here ? ", which is here: it's unloaded as the clock moves" : ""}.`));
  return section("Freight",
    el("div", { class: "menu-row" }, el("strong", {}, `The ${hold.name}`), el("strong", {}, `${hold.squares.taken} of ${hold.squares.of} squares`)),
    muted(`In ${hold.room}. Walk up to it and open it beside your pack, like any of the ship's stores: what she carries is in it.`),
    hold.lines.length ? hold.lines.map(line) : muted("It's empty."),
    f.carrying.length ? [el("h4", { class: "small" }, "Carried for a fee"), f.carrying.map(load)] : null);
}

// The loads the port she's docked at offers.
function offersSection(f) {
  if (!f.at) return section("Freight for hire", muted("There's no freight to take on here. It's taken on at a port's dock, from what that port can spare, for a port you know of that's running low."));
  const offer = (one) => el("div", { class: "card stack gap-small" },
    el("div", { class: "spread" }, el("strong", {}, `${one.what}, for ${one.to}`), el("span", {}, `${number(one.fee)} cr`)),
    muted(`${one.to} ${WANTS[one.level] ?? "wants them"}. Paid on arrival, within ${one.days} days, and half if it's late. It takes ${one.squares} ${one.squares === 1 ? "square" : "squares"} of the hold.`),
    el("div", {}, el("button", { disabled: busy() || !one.fits, title: one.fits ? "" : "There isn't the room in the freight hold", onclick: shipOrder({ action: "freight-take", id: one.id }) }, one.fits ? "Take it" : "No room in the hold")));
  return section(`Freight for hire at ${f.at.name}`,
    f.offers.length
      ? [muted("What this port can spare, for a port that's running low on it. It leaves here when it's loaded, and goes into their stores when she docks there."), f.offers.map(offer)]
      : muted(`Nobody at ${f.at.name} has a load today for a port you know of. It changes with what each port has, so look again tomorrow, or at another dock.`));
}

// This port's goods, bought and sold by the load for the ship's own account.
function goodsSection(f) {
  if (!f.at || !f.goods.length) return null;
  const order = (action, good, n) => shipOrder({ action, id: good, n });
  const row = (one) => el("div", { class: "stack gap-small freight-good" },
    el("div", { class: "menu-row small" },
      el("span", {}, one.name, el("span", { class: "muted" }, ` ${number(one.has)} here, ${one.level}`)),
      one.own > 0 ? el("span", { class: "muted" }, `${number(one.own)} of her own aboard`) : null),
    el("div", { class: "row" },
      el("button", { class: "small", disabled: busy() || one.has < 1 || one.room < 1 || f.purse < one.buy, title: one.has < 1 ? "There are none here to sell" : one.room < 1 ? "The freight hold is full" : f.purse < one.buy ? "The purse can't cover one" : "", onclick: order("freight-buy", one.good, 1) }, `Buy 1, ${number(one.buy)} cr`),
      el("button", { class: "small", disabled: busy() || one.has < 5 || one.room < 5 || f.purse < one.buy * 5, onclick: order("freight-buy", one.good, 5) }, "Buy 5"),
      one.own > 0 ? el("button", { class: "small", disabled: busy(), onclick: order("freight-sell", one.good, 1) }, `Sell 1, ${number(one.sell)} cr`) : null,
      one.own > 1 ? el("button", { class: "small", disabled: busy(), onclick: order("freight-sell", one.good, one.own) }, `Sell all ${number(one.own)}`) : null));
  return folded("freight-goods", `Buy and sell by the load (${f.goods.length} goods here)`,
    muted(`For the ship's own account, out of her purse: ${number(f.purse)} credits. Each one bought or sold changes what ${f.at.name} has, and so its price. Selling pays about half of what buying costs, so a thing is only worth carrying from where there's plenty to where it's scarce: the list below says where.`),
    f.goods.map(row));
}

// Where each good is cheapest and dearest, among the ports the captain knows of.
function pricesSection(f) {
  if (!f.prices.length) return null;
  const sorted = [...f.prices].sort((a, b) => b.dear.price / b.cheap.price - a.dear.price / a.cheap.price);
  const row = (one) => el("div", { class: "menu-row small" },
    el("span", {}, one.name, one.here !== null ? el("span", { class: "muted" }, `, ${number(one.here)} here`) : null),
    el("span", { class: "muted" }, `cheap at ${one.cheap.name} (${number(one.cheap.price)}), dear at ${one.dear.name} (${number(one.dear.price)})`));
  return folded("freight-prices", `Where things are cheap and dear (${f.prices.length} goods)`,
    muted("What one costs to buy today at the ports you know of, the widest gaps first. A port pays about half its price for what you sell it."),
    sorted.map(row));
}

export function freightSections(g) {
  const f = g.ship?.freight;
  if (!f) return [];
  return [holdSection(f), offersSection(f), goodsSection(f), pricesSection(f)].filter(Boolean);
}
