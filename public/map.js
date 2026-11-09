// The star map: the chart of known space, with each place a button in its spot, and setting course. Everything
// here is drawn from the game's state, and every button runs on this computer, without the AI.

import { api, el, folded } from "./dom.js";

// What this screen needs from the main screen. Set once, when the page loads.
let app;

export function initMap(hooks) {
  app = hooks;
}

const inFight = () => Boolean(app.ui.game.combat || app.ui.game.check || app.ui.game.talk);
const cannotAct = () => app.ui.streaming || inFight();

// Sends an order, and shows what came of it at the top of the menu.
export function shipOrder(body, after) {
  return app.runAction(async () => {
    const { game, message, moved } = await api("/api/ship", body);
    app.ui.game = game;
    if (message) app.ui.menuMessage = { ok: true, text: message };
    // A new place needs the whole screen, so the menu gets out of the way.
    if (moved) app.closeMenu();
    after?.();
  });
}

const section = (title, ...children) => el("section", { class: "menu-section" }, title && el("h3", {}, title), children);
const muted = (text) => el("div", { class: "muted small" }, text);

// A framed chart with grid marks and a scatter of faint stars. It's the same every time, so it doesn't flicker.
function chartArt(cols, rows) {
  const lines = [];
  let seed = 12345;
  for (let y = 0; y < rows; y += 1) {
    let line = "";
    for (let x = 0; x < cols; x += 1) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const roll = (seed >>> 16) % 100;
      const edgeX = x === 0 || x === cols - 1;
      const edgeY = y === 0 || y === rows - 1;
      if (edgeX && edgeY) line += "+";
      else if (edgeY) line += "-";
      else if (edgeX) line += "|";
      else if (x % 13 === 0 && y % 6 === 0) line += "+";
      else line += roll < 4 ? "." : roll === 4 ? "'" : " ";
    }
    lines.push(line);
  }
  const title = " CONCORD NAVAL CHART, SHIP'S COPY ";
  lines[0] = `${lines[0].slice(0, 3)}${title}${lines[0].slice(3 + title.length)}`;
  return lines;
}

// The line from the ship to wherever's selected, one character at a time.
function courseLine(from, to, cols, rows) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(" "));
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  for (let i = 1; i < steps; i += 1) {
    const x = Math.round(from.x + ((to.x - from.x) * i) / steps);
    const y = Math.round(from.y + ((to.y - from.y) * i) / steps);
    if (grid[y]) grid[y][x] = i % 2 ? "." : ":";
  }
  return grid.map((line) => line.join("").trimEnd()).join("\n");
}

const DANGER_MARKS = ["o", "o", "*", "!", "!"];
const DANGER_TONES = ["good", "info", "warn", "bad", "bad"];

function mapStar(place, selected) {
  const { ui, renderMenus } = app;
  // Near the right-hand edge, the name goes on the left of the star.
  const flip = place.x + place.short.length + 3 > app.ui.game.ship.chart.cols;
  return el("button", {
    class: `map-star tone-${DANGER_TONES[place.danger]}${selected ? " selected" : ""}${flip ? " flip" : ""}`,
    style: `left:${flip ? place.x - place.short.length - 1 : place.x}ch;top:calc(${place.y} * var(--map-row))`,
    "aria-pressed": String(selected),
    "aria-label": `${place.name}: ${place.fuel ? `${place.fuel} fuel, ${place.hours} hours` : "no fuel"}, ${place.dangerLabel}`,
    title: `${place.name}. ${place.fuel} fuel, ${place.hours} hours. ${place.dangerLabel}. ${place.control}.`,
    onclick: () => { ui.mapSelected = place.id; renderMenus(); },
  }, flip ? `${place.short} ${DANGER_MARKS[place.danger]}` : `${DANGER_MARKS[place.danger]} ${place.short}`);
}

function chartNode(g, places, selected) {
  const { chart, start, at } = g.ship;
  const shipSpot = places.find((place) => place.id === at) ?? start;
  // Someone who isn't the captain sets out from wherever they are.
  const mine = g.role.captain ? shipSpot : places.find((place) => place.here) ?? shipSpot;
  const course = selected && selected.x !== null && !selected.here && selected.id !== (g.role.captain ? at : null) ? courseLine(mine, selected, chart.cols, chart.rows) : "";
  return el("div", { class: "map-frame" },
    el("div", { class: "map-chart", style: `--map-cols:${chart.cols};--map-lines:${chart.rows}` },
      el("pre", { class: "map-stars", "aria-hidden": "true" }, chartArt(chart.cols, chart.rows).join("\n")),
      el("pre", { class: "map-course", "aria-hidden": "true" }, course),
      !g.role.captain && mine !== shipSpot && el("div", { class: "map-here map-here-ship", style: `left:${shipSpot.x}ch;top:calc(${shipSpot.y} * var(--map-row))`, title: "The Meridian" }, "M"),
      el("div", { class: "map-here", style: `left:${mine.x}ch;top:calc(${mine.y} * var(--map-row))`, title: g.role.captain ? "The Meridian" : "You" }, "@"),
      places.map((place) => mapStar(place, selected?.id === place.id))));
}

function placeDetails(place, g) {
  const { captain } = g.role;
  const facts = [
    captain ? ["Fuel", place.fuel ? String(place.fuel) : "None"] : ["Fare", place.jump ? `${place.fare} credits` : "None"],
    ["Time", `${place.hours} ${place.hours === 1 ? "hour" : "hours"}`],
    ["Danger", place.dangerLabel],
    ["Controlled by", place.control],
  ];
  return el("div", { class: "card stack gap-small map-details" },
    el("div", { class: "spread" },
      el("strong", {}, place.name),
      el("span", { class: "row" },
        place.here && el("span", { class: "tag on" }, "you are here"),
        place.shipIsHere && !place.here && el("span", { class: "tag on" }, "the Meridian is here"))),
    muted(place.desc),
    !place.here && facts.map(([label, value]) => el("div", { class: "menu-row small" }, el("span", { class: "muted" }, label), el("span", {}, value))),
    place.here && el("div", { class: "menu-row small" }, el("span", { class: "muted" }, "Danger"), el("span", {}, place.dangerLabel)),
    place.here && el("div", { class: "menu-row small" }, el("span", { class: "muted" }, "Controlled by"), el("span", {}, place.control)),
    place.now?.shares.length > 0 && el("div", { class: "map-shares small" },
      el("div", { class: "muted" }, "Who has a say"),
      place.now.shares.map((side) => el("div", { class: "menu-row" }, el("span", {}, side.name), el("span", {}, String(side.share))))),
    place.now?.goods.length > 0 && el("div", { class: "map-goods small" }, place.now.goods.map((good) => el("div", { class: "menu-row" },
      el("span", { class: "muted" }, good.name),
      el("span", { class: good.low ? "tone-bad" : good.high ? "tone-good" : "" }, good.level)))),
    place.now?.going.map((text) => el("div", { class: "small map-going" }, text)),
    captain && place.sells.length > 0 && muted(`Sells to the ship: ${place.sells.join(", ")}.`),
    place.hasMarket && muted("Has a market."),
    !place.here && place.why && el("div", { class: "small tone-bad" }, place.why),
    !place.here && el("div", {}, el("button", {
      class: "primary",
      disabled: cannotAct() || !place.canGo,
      onclick: shipOrder({ action: "course", id: place.id }),
    }, captain ? "Set course" : place.jump ? "Book passage" : "Cross over")));
}

function placeTable(places) {
  const { ui, renderMenus } = app;
  const { captain } = ui.game.role;
  const sorted = places.filter((place) => !place.here).sort((a, b) => a.fuel - b.fuel || a.fare - b.fare || a.hours - b.hours || a.name.localeCompare(b.name));
  return section("Known places",
    el("div", { class: "map-table" },
      el("div", { class: "map-row map-head small muted" }, ["Place", captain ? "Fuel" : "Fare", "Time", "Danger", "Controlled by", "Short of", ""].map((label) => el("span", {}, label))),
      sorted.map((place) => el("div", { class: `map-row small${ui.mapSelected === place.id ? " selected" : ""}` },
        el("button", { class: "map-name", onclick: () => { ui.mapSelected = place.id; renderMenus(); } }, place.name),
        el("span", {}, String(captain ? place.fuel : place.fare)),
        el("span", {}, `${place.hours}h`),
        el("span", { class: `tone-${DANGER_TONES[place.danger]}` }, place.dangerLabel),
        el("span", { class: "map-control muted" }, place.control),
        el("span", { class: "map-short tone-bad" }, (place.now?.goods ?? []).filter((good) => good.low).map((good) => good.id).join(", ")),
        el("button", { disabled: cannotAct() || !place.canGo, title: place.why ?? "", onclick: shipOrder({ action: "course", id: place.id }) }, captain ? "Set course" : place.jump ? "Book passage" : "Cross over")))));
}

export function mapMenu() {
  const { ui } = app;
  const g = ui.game;
  const s = g.ship;
  // The Meridian herself is the @ on the chart, not a star.
  const onChart = g.locations.filter((place) => !place.ownShip && place.x !== null);
  const selected = g.locations.find((place) => place.id === ui.mapSelected) ?? g.locations.find((place) => (g.role.captain ? place.id === s.at : place.here)) ?? null;
  const ship = g.locations.find((place) => place.ownShip);
  return [
    el("div", { class: "menu-intro small" }, g.role.captain
      ? `The Meridian is ${s.atText}, with ${s.fuel} fuel.`
      : `You're at ${g.location.name}, with ${g.credits} credits, and the Meridian is ${s.atText}.`),
    el("div", { class: "map-layout" },
      chartNode(g, onChart, selected),
      el("div", { class: "map-side" },
        selected ? placeDetails(selected, g) : el("div", { class: "card muted small" }, "Click a star for its details."),
        el("div", { class: "small muted map-legend" }, g.role.captain ? "@ the Meridian   o quiet   * risky   ! dangerous" : "@ you   M the Meridian   o quiet   * risky   ! dangerous"),
        ship && section("The ship",
          el("div", { class: "menu-row small" },
            el("span", {}, ship.name),
            ship.here
              ? el("span", { class: "tag on" }, "you are here")
              : el("button", { disabled: cannotAct() || !ship.canGo, title: ship.why ?? "", onclick: shipOrder({ action: "course", id: ship.id }) }, g.role.captain || !ship.jump ? "Go aboard" : `Go aboard, ${ship.fare} cr`))))),
    placeTable(g.locations.filter((place) => !place.ownShip)),
    folded("map-news", `News from around (${g.world?.news.length ?? 0})`,
      g.world?.news.length
        ? g.world.news.map((entry) => el("div", { class: "menu-entry small" }, el("span", { class: "muted" }, `Day ${entry.day}`), el("span", {}, ` ${entry.text}`)))
        : muted(`Nothing's reached ${g.role.captain ? "the Meridian" : "you"} yet. News comes in as the days go by.`)),
  ];
}
