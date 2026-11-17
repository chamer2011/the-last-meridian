// The freighters, as the page shows them: the ships docked beside the Meridian, on the Market page, with a card each
// and what can be done about her (hail her, buy from her hold, see her to her next port, board her); and the ships on
// the lanes between the ports the captain knows of, for the star map. Everything is drawn from the game's state
// (ship.lanes, from src/freighters.js), and every button is one of the ship's orders.

import { el, folded } from "./dom.js";
import { shipOrder } from "./map.js";

// What this needs from the main screen. Set once, when the page loads.
let app;
export function initFreighters(hooks) {
  app = hooks;
}

const section = (title, ...children) => el("section", { class: "menu-section" }, title && el("h3", {}, title), children);
const muted = (text) => el("div", { class: "muted small" }, text);
const small = (text) => el("div", { class: "small" }, text);
const number = (n) => Number(n).toLocaleString("en-US");
const busy = () => Boolean(app?.ui.streaming || app?.ui.game.combat || app?.ui.game.check || app?.ui.game.talk);

// A place's name in the middle of a sentence: "the Graveyard", not "The Graveyard".
const mid = (name) => String(name ?? "").replace(/^The /, "the ");
// A port's name, once the captain has heard of it: from the chart, or from the ship's own master.
const called = (ship, place) => (place.known || ship.hailed !== null ? mid(place.name) : "a port you haven't heard of");
const STATES = { loading: "loading", unloading: "unloading", waiting: "waiting off the port", "under way": "under way" };

// One ship docked beside the Meridian.
function shipCard(l, ship) {
  const { ui, renderMenus, closeMenu } = app;
  const can = l.captain && !busy();
  const where = ship.state === "loading"
    ? `Loading for ${called(ship, ship.to)}. She sails tonight, ${ship.days} ${ship.days === 1 ? "day" : "days"} on the way, and is in at the end of day ${ship.due}.`
    : ship.state === "waiting" ? `In from ${called(ship, ship.from)}, and kept waiting off the port: nothing's getting in.`
      : `In from ${called(ship, ship.from)}, unloading. What she carries is in this port's stores at midnight.`;
  // Boarded once, she has nothing more to say to the Meridian: what's left aboard her, and no buttons.
  if (ship.boarded) {
    return el("div", { class: "card stack gap-small freighter" },
      el("div", { class: "spread" }, el("strong", {}, ship.name), el("span", { class: "muted small" }, `flies for ${ship.flies}`)),
      small(where),
      ship.loads.map((one) => el("div", { class: "menu-row small" }, el("span", {}, one.words))),
      el("div", { class: "small tone-bad" }, "You boarded her. Her master has nothing more to say to the Meridian."));
  }
  const load = (one) => el("div", { class: "menu-row small" },
    el("span", {}, one.words),
    l.captain && one.sells > 0 && one.price !== null
      ? el("button", {
        class: "small",
        disabled: !can || Boolean(l.comms) || one.room < 1 || l.purse < one.price,
        title: l.comms ? "The Meridian's comms are down" : one.room < 1 ? "The freight hold is full" : l.purse < one.price ? "The purse can't cover one" : `Her master will sell ${number(one.sells)} more of these. It goes into the freight hold, and never reaches where she's bound.`,
        onclick: shipOrder({ action: "ship-buy", id: ship.id, good: one.good }),
      }, `Buy 1, ${number(one.price)} cr`)
      : null);
  // Boarding is asked twice: it can't be taken back.
  const asking = ui.boardAsk === ship.id;
  const board = !l.captain ? null : asking
    ? [el("div", { class: "small tone-bad" }, `Go aboard and fight her crew of ${ship.crew} for what she carries? It costs standing with ${ship.flies}, and with whoever holds ${mid(l.here.name)}, win or lose.`),
      el("div", { class: "row" },
        el("button", { class: "small", disabled: !can, onclick: shipOrder({ action: "ship-board", id: ship.id }, () => { ui.boardAsk = null; if (app.ui.game.combat) closeMenu(); }) }, "Yes, board her"),
        el("button", { class: "small", onclick: () => { ui.boardAsk = null; renderMenus(); } }, "No"))]
    : el("button", { class: "small", disabled: !can, title: `Go across with whoever's walking with you, and fight her crew of ${ship.crew} for what she carries`, onclick: () => { ui.boardAsk = ship.id; renderMenus(); } }, "Board her...");
  return el("div", { class: "card stack gap-small freighter" },
    el("div", { class: "spread" }, el("strong", {}, ship.name), el("span", { class: "muted small" }, `flies for ${ship.flies}`)),
    small(where),
    ship.loads.map(load),
    ship.said ? muted(`Her master said: "${ship.said}"`) : null,
    ship.escort?.taken ? el("div", { class: "small tone-good" }, `You've given your word to see her in: ${number(ship.escort.fee)} credits when she comes in with the Meridian docked there.`) : null,
    l.captain ? el("div", { class: "row" },
      el("button", { class: "small", disabled: !can || Boolean(l.comms), title: l.comms ?? "Ask her master where she's been and what's short there", onclick: shipOrder({ action: "ship-hail", id: ship.id }) }, ship.hailed !== null ? "Hail her again" : "Hail her"),
      ship.escort && !ship.escort.taken
        ? el("button", { class: "small", disabled: !can || Boolean(l.comms), title: `She wants company because ${ship.escort.why}. Be docked at ${called(ship, ship.to)} when she comes in, and the fee is paid into the purse.`, onclick: shipOrder({ action: "ship-escort", id: ship.id }) }, `See her in, ${number(ship.escort.fee)} cr`)
        : null,
      asking ? null : board) : null,
    asking ? board : null);
}

// The Market page's section: the ships docked beside the Meridian.
export function lanesSections(g) {
  const l = g.ship?.lanes;
  if (!l) return [];
  const out = [];
  if (l.escorts.length) {
    out.push(section("Ships you're seeing in",
      l.escorts.map((one) => el("div", { class: "stack gap-small" },
        el("div", { class: "menu-row small" }, el("span", {}, `${one.name[0].toUpperCase()}${one.name.slice(1)}, for ${mid(one.toName)}`), el("strong", {}, `${number(one.fee)} cr`)),
        muted(one.here ? `She comes in at midnight at the end of day ${one.due}, and the Meridian is docked there: stay until then.` : `She comes in at midnight at the end of day ${one.due}. Be docked at ${mid(one.toName)} by then, or her master keeps the fee.`)))));
  }
  if (!l.here) return out;
  const ships = l.here.ships;
  out.push(section(`Ships in port at ${mid(l.here.name)} (${ships.length})`,
    ships.length
      ? [muted(l.captain
        ? `Other people's ships, each loading for another port or unloading what this one sent for. A master sells up to ${l.rules.share} percent of what's aboard, out of the ship's purse (${number(l.purse)} credits) and into the freight hold.`
        : "Other people's ships, each loading for another port or unloading what this one sent for."),
        l.comms ? el("div", { class: "small tone-bad" }, l.comms) : null,
        ships.slice(0, 6).map((ship) => shipCard(l, ship)),
        ships.length > 6 ? folded("lanes-more", `${ships.length - 6} more in port`, ships.slice(6).map((ship) => shipCard(l, ship))) : null]
      : muted("No freighter is in today. They come and go with what the ports send for.")));
  return out;
}

// ---- The star map ------------------------------------------------------------------------------------------------

// The ships under way, as marks on the chart: one for each, where it is between the two ports of its run.
export function laneMarks(g) {
  const l = g.ship?.lanes;
  if (!l) return [];
  return l.lanes.filter((ship) => ship.state === "under way").map((ship) => el("div", {
    class: "map-ship",
    style: `left:${ship.x}ch;top:calc(${ship.y} * var(--map-row))`,
    title: `${ship.name}: ${mid(ship.fromName)} to ${mid(ship.toName)}, ${ship.cargo}, due ${ship.left === 1 ? "tomorrow" : `in ${ship.left} days`}`,
  }, "›"));
}

// The ships at a place and on their way to it, for the place's card on the star map.
export function lanesAt(g, place) {
  const l = g.ship?.lanes;
  if (!l) return null;
  const inPort = l.lanes.filter((ship) => (ship.state === "loading" && ship.from === place.id) || ((ship.state === "unloading" || ship.state === "waiting") && ship.to === place.id));
  const coming = l.lanes.filter((ship) => ship.to === place.id && (ship.state === "under way" || ship.state === "loading"));
  if (!inPort.length && !coming.length) return null;
  const line = (ship, words) => el("div", { class: "menu-row small" }, el("span", {}, ship.name), el("span", { class: "muted" }, words));
  return el("div", { class: "map-lanes small" },
    inPort.length ? [el("div", { class: "muted" }, "Freighters in port"), inPort.slice(0, 4).map((ship) => line(ship, ship.state === "loading" ? `loading for ${mid(ship.toName)}` : `in from ${mid(ship.fromName)}, ${ship.cargo}`)), inPort.length > 4 ? muted(`and ${inPort.length - 4} more`) : null] : null,
    coming.length ? [el("div", { class: "muted" }, "On their way here"), coming.slice(0, 4).map((ship) => line(ship, `${ship.cargo}, from ${mid(ship.fromName)}, in ${ship.left} ${ship.left === 1 ? "day" : "days"}`)), coming.length > 4 ? muted(`and ${coming.length - 4} more`) : null] : null);
}

// Every freighter between the ports the captain knows of, under the chart.
export function lanesFold(g) {
  const l = g.ship?.lanes;
  if (!l) return null;
  const total = l.lanes.length + l.more;
  const row = (ship) => el("div", { class: "menu-entry small" },
    el("span", {}, ship.name),
    el("span", { class: "muted" }, ` ${ship.fromName} to ${mid(ship.toName)}, ${ship.cargo}: ${ship.state === "under way" ? `in ${ship.left} ${ship.left === 1 ? "day" : "days"}` : STATES[ship.state] ?? ship.state}`));
  return folded("map-lanes", `Freighters on the lanes (${total})`,
    total
      ? [muted("Other people's ships, carrying what the ports send for, between the ports you know of. Where one's bound is short of what it carries until it's in. Dock where one is and the Market page has her."),
        l.lanes.map(row),
        l.more ? muted(`And ${l.more} more, further from the Meridian's business.`) : null]
      : muted("No freighter is on the lanes between the ports you know of."));
}
