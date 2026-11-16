// Navplot: the star map as a program on NAVCOM 7, the plot table's computer on the bridge. The owner's pick of three
// looks (2026-11-16): a window on the Navy's desktop, opened full screen, behind a loading screen. It's opened from
// the Charts icon on the desktop (public/computer.js), and takes the whole screen under the RESTRICTED bar.
//
// The game on the server says what a jump costs the ship and does Engage (view.device.charts, src/charts.js). The
// places, the news and the ship's fuel are the ones the Star Map draws from: the game's state. Nothing here needs
// typing: a place is clicked, a course plotted, and Engage asks before she goes.

import { api, el } from "./dom.js";

// The loading screen when the program is opened, and the ship on her way before the order's sent. A click skips either.
export const LOAD_MS = 3000;
const JUMP_MS = 2400;

const NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, ...kids) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, String(value));
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
  return node;
}
const calm = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// What the program remembers while the computer is open: what's picked and plotted, which page it's on.
export const newChartState = () => ({ sel: null, plotted: null, view: "chart", menu: null, rings: true, names: true, confirm: false, jump: null, note: null, holds: null });

// ---- What it knows ---------------------------------------------------------------------------------------------

// The places on the chart, each with what a jump there costs the ship. The server's numbers go over the page's own,
// which are a passenger's fare and hours for anyone who isn't the captain; "here" is where the ship is.
function chartData(ctx) {
  const { game, view } = ctx;
  const charts = view.device.charts;
  const places = game.locations
    .filter((place) => !place.ownShip && place.x !== null && charts.places[place.id])
    .map((place) => ({ ...place, ...charts.places[place.id] }));
  const at = places.find((place) => place.here) ?? null;
  return { charts, places, at, spot: at ?? game.ship.start, ship: game.ship, cols: game.ship.chart.cols, rows: game.ship.chart.rows };
}
const hoursWords = (hours) => `${hours} ${hours === 1 ? "hour" : "hours"}`;
const sortedPorts = (places) => [...places].sort((a, b) => Number(b.here) - Number(a.here) || a.fuel - b.fuel || a.hours - b.hours || a.name.localeCompare(b.name));
function dayAndTime(game) {
  const minutes = Math.floor((game.clock?.hours ?? 0) * 60 + 1e-6);
  const two = (n) => String(n).padStart(2, "0");
  return `Day ${Math.floor(minutes / 1440) + 1}, ${two(Math.floor(minutes / 60) % 24)}:${two(minutes % 60)}`;
}

// ---- The chart -------------------------------------------------------------------------------------------------

// A column of the chart is 10 across and a row 20 down, so a jump's reach, which counts rows double, is a circle.
const X = (x) => x * 10;
const Y = (y) => y * 20;

// The same scatter of faint stars as the Star Map's chart, so the sky hasn't changed.
const skies = new Map();
function starsOf(cols, rows) {
  const key = `${cols}x${rows}`;
  if (skies.has(key)) return skies.get(key);
  const stars = [];
  let seed = 12345;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const roll = (seed >>> 16) % 100;
      const edge = x === 0 || x === cols - 1 || y === 0 || y === rows - 1;
      if (!edge && !(x % 13 === 0 && y % 6 === 0) && roll <= 4) stars.push({ x, y, big: roll === 4 });
    }
  }
  skies.set(key, stars);
  return stars;
}

// Where each place's name goes: to its right, else its left, above or below, wherever it's on the chart and clear of
// the other places and the names already put down.
const CHAR = 11.8;
const TALL = 24;
const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
function nameSpots(places, texts, taken, wide, tall) {
  const boxes = [...taken, ...places.map((p) => ({ x0: X(p.x) - 13, y0: Y(p.y) - 13, x1: X(p.x) + 13, y1: Y(p.y) + 13 }))];
  const spots = new Map();
  for (const p of [...places].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const w = texts.get(p.id).length * CHAR + 4;
    const x = X(p.x);
    const y = Y(p.y);
    const tries = [
      { x0: x + 16, y0: y - 13, anchor: "start", tx: x + 18, ty: y + 8 },
      { x0: x - 16 - w, y0: y - 13, anchor: "end", tx: x - 18, ty: y + 8 },
      { x0: x - w / 2, y0: y - 16 - TALL, anchor: "middle", tx: x, ty: y - 20 },
      { x0: x - w / 2, y0: y + 15, anchor: "middle", tx: x, ty: y + 35 },
    ].map((one) => ({ ...one, x1: one.x0 + w, y1: one.y0 + TALL }));
    const inside = (one) => one.x0 >= 2 && one.x1 <= wide - 2 && one.y0 >= 2 && one.y1 <= tall - 2;
    const spot = tries.find((one) => inside(one) && !boxes.some((box) => overlap(one, box))) ?? tries.find(inside) ?? tries[0];
    boxes.push(spot);
    spots.set(p.id, spot);
  }
  return { spots, boxes };
}

// Where a range ring's label goes: the first spot round the ring that's on the chart and clear of every name.
function ringSpot(cx, cy, r, boxes, wide, tall) {
  const w = 62;
  for (const deg of [90, 180, 270, 0, 135, 225, 45, 315]) {
    const a = (deg * Math.PI) / 180;
    const x = cx + Math.cos(a) * r + 8;
    const y = cy + Math.sin(a) * r - 6;
    const box = { x0: x, y0: y - 20, x1: x + w, y1: y + 2 };
    if (box.x0 < 4 || box.x1 > wide - 4 || box.y0 < 4 || box.y1 > tall - 4) continue;
    if (!boxes.some((other) => overlap(box, other))) return { x, y };
  }
  return null;
}

const symbolOf = (danger) => (danger >= 3
  ? svg("path", { d: "M0 -11 L10 8 L-10 8 Z", class: "nv-sym" })
  : danger === 2 ? svg("path", { d: "M0 -10 L10 0 L0 10 L-10 0 Z", class: "nv-sym" }) : svg("circle", { r: 7, class: "nv-sym" }));

function chartSvg(ctx, data) {
  const st = ctx.st;
  const { places, spot, cols, rows, charts } = data;
  const wide = X(cols);
  const tall = Y(rows);
  const jump = st.jump;
  const target = places.find((p) => p.id === (jump?.to ?? st.plotted)) ?? null;
  // On her way, she's part of the way along the course.
  const along = jump && target ? Math.min(1, (performance.now() - jump.at) / JUMP_MS) : 0;
  const ship = { x: spot.x + ((target?.x ?? spot.x) - spot.x) * along, y: spot.y + ((target?.y ?? spot.y) - spot.y) * along };
  const docked = Boolean(data.at) && !jump;
  const node = svg("svg", { viewBox: `0 0 ${wide} ${tall}`, class: "nv-svg", role: "group", "aria-label": "The chart" });
  node.append(svg("rect", { x: 0, y: 0, width: wide, height: tall, class: "nv-space" }));
  for (let x = 13; x < cols; x += 13) node.append(svg("line", { x1: X(x), y1: 0, x2: X(x), y2: tall, class: "nv-grid" }));
  for (let y = 6; y < rows; y += 6) node.append(svg("line", { x1: 0, y1: Y(y), x2: wide, y2: Y(y), class: "nv-grid" }));
  for (const star of starsOf(cols, rows)) node.append(svg("rect", { x: X(star.x), y: Y(star.y), width: star.big ? 4 : 2, height: star.big ? 4 : 2, class: "nv-star" }));
  // The names, with the ship's own beside her when she's in open space or on her way.
  const texts = new Map(places.map((p) => [p.id, p.here && !jump ? `${p.short} · Meridian` : p.short]));
  const taken = docked ? [] : [{ x0: X(ship.x) - 12, y0: Y(ship.y) - 14, x1: X(ship.x) + 16 + 8 * 13, y1: Y(ship.y) + 14 }];
  const { spots, boxes } = st.names ? nameSpots(places, texts, taken, wide, tall) : { spots: new Map(), boxes: taken };
  if (st.rings) {
    for (const ring of charts.rings) {
      const r = ring.reach * 10;
      node.append(svg("circle", { cx: X(ship.x), cy: Y(ship.y), r, class: "nv-ring" }));
      const at = ringSpot(X(ship.x), Y(ship.y), r, boxes, wide, tall);
      if (at) node.append(svg("text", { x: at.x, y: at.y, class: "nv-ringt" }, `${ring.fuel} fuel`));
    }
  }
  if (target) node.append(svg("line", { x1: X(ship.x), y1: Y(ship.y), x2: X(target.x), y2: Y(target.y), class: "nv-course" }));
  for (const p of places) {
    const on = st.sel === p.id;
    const pick = () => {
      if (st.jump) return;
      choose(ctx, p.id);
      ctx.draw();
    };
    const group = svg("g", {
      class: `nv-place nv-d${p.danger}${on ? " on" : ""}`,
      transform: `translate(${X(p.x)} ${Y(p.y)})`,
      role: "button",
      tabindex: 0,
      "aria-label": `${p.name}: ${p.here ? "the Meridian is here" : `${p.fuel} fuel, ${hoursWords(p.hours)}`}, ${p.dangerLabel}`,
      "data-place": p.id,
      onclick: (event) => { event.stopPropagation(); pick(); },
      onkeydown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); pick(); } },
    });
    group.append(svg("circle", { r: 24, class: "nv-hit" }), symbolOf(p.danger));
    if (on) group.append(svg("path", { d: "M-18 -9 V-18 H-9 M9 -18 H18 V-9 M18 9 V18 H9 M-9 18 H-18 V9", class: "nv-reticle" }));
    if (p.here && !jump) group.append(svg("circle", { r: 15, class: "nv-shipring" }));
    node.append(group);
    const spotOf = spots.get(p.id);
    if (spotOf) node.append(svg("text", { x: spotOf.tx, y: spotOf.ty, "text-anchor": spotOf.anchor, class: `nv-name${on ? " on" : ""}` }, texts.get(p.id)));
  }
  if (!docked) {
    const sx = X(ship.x);
    const sy = Y(ship.y);
    node.append(svg("path", { d: `M${sx} ${sy - 12} L${sx + 10} ${sy + 9} L${sx - 10} ${sy + 9} Z`, class: "nv-ship" }));
    node.append(svg("text", { x: sx + 16, y: sy + 8, class: "nv-shipt" }, "MERIDIAN"));
  }
  return node;
}

// ---- What the buttons do ---------------------------------------------------------------------------------------

function choose(ctx, id) {
  const st = ctx.st;
  st.sel = id;
  st.confirm = false;
  st.note = null;
  if (st.plotted !== id) st.plotted = null;
}
function plot(ctx, data) {
  const st = ctx.st;
  const place = data.places.find((p) => p.id === st.sel);
  if (!place || place.here) return;
  st.plotted = place.id;
  st.confirm = false;
  st.note = null;
}
function clearCourse(ctx) {
  ctx.st.plotted = null;
  ctx.st.confirm = false;
}
const blockedWhy = (data, st) => {
  const place = data.places.find((p) => p.id === st.plotted);
  return place ? place.why : "No course is plotted.";
};

// Engage: she's shown on her way for a moment, then the order goes to the game. Only the chart and the bar move
// meanwhile, so nothing else on the screen is drawn again.
let jumpTimer = 0;
function engage(ctx, data) {
  const st = ctx.st;
  const id = st.plotted;
  if (!id || blockedWhy(data, st) || st.jump) return;
  st.confirm = false;
  st.note = null;
  st.jump = { to: id, at: performance.now(), sent: false };
  clearInterval(jumpTimer);
  if (calm()) {
    order(ctx);
    return;
  }
  jumpTimer = setInterval(() => {
    if (!st.jump || st.jump.sent || ctx.gone(st)) {
      clearInterval(jumpTimer);
      return;
    }
    if (performance.now() - st.jump.at >= JUMP_MS) {
      clearInterval(jumpTimer);
      order(ctx);
      return;
    }
    const fresh = ctx.fresh();
    if (!fresh) return;
    document.getElementById("navplot-chart")?.replaceChildren(chartSvg(fresh, chartData(fresh)));
    document.getElementById("navplot-bar")?.replaceChildren(...barBlocks((performance.now() - st.jump.at) / JUMP_MS));
  }, 100);
}
async function order(ctx) {
  const st = ctx.st;
  if (!st.jump || st.jump.sent) return;
  const id = st.jump.to;
  st.jump.sent = true;
  const before = ctx.fresh()?.view.log?.length ?? 0;
  if (!ctx.gone(st)) ctx.draw();
  await ctx.send({ action: "device", id: `nav-course:${id}` });
  // Still at the chart afterwards: the order was refused, or it was given by someone the jump doesn't put ashore.
  st.jump = null;
  const fresh = ctx.fresh();
  const refused = ctx.message();
  if (refused) st.note = { text: refused, tone: "warn" };
  else {
    st.plotted = null;
    st.sel = id;
    const said = fresh?.view.log?.slice(before).map((entry) => entry.text).filter(Boolean).at(-1);
    st.note = said ? { text: said, tone: "good" } : null;
  }
  if (!ctx.gone(st)) ctx.draw();
}
const barBlocks = (share) => Array.from({ length: 24 }, (_, i) => el("i", { class: i < Math.round(Math.max(0, Math.min(1, share)) * 24) ? "on" : "" }));

// Everything a port holds is asked for when it's wanted, since it's a long list (the same the Star Map asks for).
async function showHolds(ctx, id) {
  const st = ctx.st;
  st.view = "holds";
  st.holds = { id, state: "asking", trees: [] };
  ctx.draw();
  try {
    const { holds } = await api(`/api/port/${id}`);
    st.holds = { id, state: "ready", trees: holds };
  } catch (err) {
    st.holds = { id, state: "failed", trees: [], error: err.message };
  }
  if (!ctx.gone(st)) ctx.draw();
}

// ---- The pages -------------------------------------------------------------------------------------------------

const DANGER_TONES = ["tone-good", "", "tone-warn", "tone-bad", "tone-bad"];

function portsPage(ctx, data) {
  const st = ctx.st;
  return el("div", { class: "nv-pane nv-list sunk scrolls" },
    el("div", { class: "nv-lrow nv-lhead" }, ["Port", "Fuel", "Time", "Hazard", "Short of"].map((text) => el("span", {}, text))),
    sortedPorts(data.places).map((p) => el("button", {
      type: "button",
      class: `nv-lrow${st.sel === p.id ? " on" : ""}`,
      "data-place": p.id,
      title: p.why ?? `${p.name}. ${p.control}.`,
      disabled: Boolean(st.jump),
      onclick: (event) => { event.stopPropagation(); st.menu = null; choose(ctx, p.id); ctx.draw(); },
    },
    el("span", {}, p.name),
    el("span", {}, p.here ? "here" : String(p.fuel)),
    el("span", {}, p.here ? "" : `${p.hours}h`),
    el("span", { class: st.sel === p.id ? "" : DANGER_TONES[p.danger] ?? "" }, p.dangerLabel),
    el("span", { class: st.sel === p.id ? "" : "tone-bad" }, (p.now?.goods ?? []).filter((good) => good.low).map((good) => good.id).join(", ")))));
}

function newsPage(ctx) {
  const news = ctx.game.world?.news ?? [];
  return el("div", { class: "nv-pane nv-news sunk scrolls" },
    el("b", {}, `News from around (${news.length})`),
    news.length
      ? news.map((entry) => el("div", { class: "nv-entry" }, el("small", {}, `Day ${entry.day}`), ` ${entry.text}`))
      : el("div", { class: "tone-dim" }, "Nothing's reached the Meridian yet. News comes in as the days go by."));
}

function holdsPage(ctx, data) {
  const holds = ctx.st.holds;
  const place = data.places.find((p) => p.id === holds?.id);
  return el("div", { class: "nv-pane nv-news sunk scrolls" },
    el("b", {}, `Everything ${place?.name ?? "it"} holds`),
    !holds || holds.state === "asking" ? el("div", { class: "tone-dim" }, "Reading...")
      : holds.state === "failed" ? el("div", { class: "tone-bad" }, holds.error)
        : !holds.trees.length ? el("div", { class: "tone-dim" }, "Nobody counts what's held here.")
          : holds.trees.map((tree) => [
            el("div", { class: "nv-tree" }, tree.name),
            tree.goods.map((good) => [
              el("div", { class: "nv-line" }, el("span", {}, good.counted), el("span", { class: good.low ? "tone-bad" : good.high ? "tone-good" : "tone-dim" }, good.level)),
              el("div", { class: "nv-why" }, [
                good.made ? `made here, ${good.made} a day as a rule` : good.from.length ? `from ${good.from.join(" or ")}` : "its own",
                good.coming ? `, ${good.coming} on the way` : "",
                good.why ? `. ${good.why}` : "",
                ".",
              ].join("")),
            ]),
          ]));
}

function destination(ctx, data) {
  const st = ctx.st;
  const p = data.places.find((one) => one.id === st.sel);
  if (!p) return el("div", { class: "nv-group nv-dest" }, el("b", { class: "nv-legend" }, "Destination"), el("div", { class: "tone-dim" }, "Click a place on the chart, or pick one from the port list."));
  const fact = (label, value, cls = "") => el("div", { class: "nv-fact" }, el("span", {}, label), el("span", { class: cls }, value));
  const amounts = p.now?.goods?.some((good) => good.has);
  return el("div", { class: "nv-group nv-dest" }, el("b", { class: "nv-legend" }, "Destination"),
    el("div", { class: "nv-scroll" },
      el("div", { class: "nv-pname" }, p.name),
      p.here && el("div", { class: "tone-good" }, "The Meridian is here."),
      el("div", { class: "nv-desc" }, p.desc),
      fact("Hazard", p.dangerLabel, DANGER_TONES[p.danger] ?? ""),
      fact("Held by", p.control),
      p.now?.shares?.length > 0 && [
        el("div", { class: "nv-sub" }, "Who has a say"),
        p.now.shares.map((side) => el("div", { class: "nv-line" }, el("span", {}, side.name), el("span", {}, String(side.share)))),
      ],
      p.now?.goods?.length > 0 && [
        el("div", { class: "nv-sub" }, "Supplies"),
        p.now.goods.map((good) => [
          el("div", { class: "nv-line nv-good" }, el("span", {}, good.name), el("span", { class: good.low ? "tone-bad" : good.high ? "tone-good" : "" }, good.has ? `${good.has}, ${good.level}` : good.level)),
          good.why && el("div", { class: "nv-why" }, `${good.why}.`),
        ]),
      ],
      (p.now?.going ?? []).map((text) => el("div", { class: "nv-going" }, text)),
      p.sells?.length > 0 && el("div", { class: "tone-dim" }, `Sells to the ship: ${p.sells.join(", ")}.`),
      p.hasMarket && el("div", { class: "tone-dim" }, "Has a market."),
      amounts && el("div", {}, el("button", { type: "button", disabled: Boolean(st.jump), onclick: (event) => { event.stopPropagation(); st.menu = null; showHolds(ctx, p.id); } }, "Everything it holds..."))));
}

// ---- The program -----------------------------------------------------------------------------------------------

export function navplotNode(ctx) {
  const st = ctx.st;
  const data = chartData(ctx);
  // A place that's left the chart isn't picked any more, and a course to where she already is isn't one.
  if (st.sel && !data.places.some((p) => p.id === st.sel)) st.sel = null;
  if (st.plotted && !st.jump && (!data.places.some((p) => p.id === st.plotted) || data.at?.id === st.plotted)) st.plotted = null;
  const sel = data.places.find((p) => p.id === st.sel) ?? null;
  const plotted = data.places.find((p) => p.id === st.plotted) ?? null;
  const busy = Boolean(st.jump) || ctx.sending;
  // Every button puts the menus away, does its thing and draws the program again.
  const press = (fn) => (event) => {
    event.stopPropagation();
    st.menu = null;
    fn();
    ctx.draw();
  };
  const button = (label, fn, { off = false, down = false, title = "" } = {}) => el("button", { type: "button", class: down ? "down" : "", disabled: off || busy, title, onclick: press(fn) }, label);
  const page = (id) => () => { st.view = id; st.confirm = false; };
  const canPlot = Boolean(sel) && !sel.here;
  const cantEngage = !plotted || Boolean(plotted.why);

  const menus = [
    ["chart", "Chart", [["Chart", page("chart")], ["Port list", page("ports")], ["News", page("news")], null, ["Close Navplot", () => ctx.close()]]],
    ["course", "Course", [["Plot course", () => plot(ctx, data), !canPlot], ["Clear course", () => clearCourse(ctx), !plotted], ["Engage jump...", () => { st.confirm = true; }, cantEngage]]],
    ["view", "View", [[`${st.rings ? "✓" : "  "} Range rings`, () => { st.rings = !st.rings; }], [`${st.names ? "✓" : "  "} Names`, () => { st.names = !st.names; }]]],
  ];
  const mbar = el("div", { class: "nv-mbar" }, menus.map(([id, label, items]) => el("div", { class: "nv-mi" },
    el("button", { type: "button", class: st.menu === id ? "down" : "", "aria-expanded": String(st.menu === id), disabled: busy, onclick: (event) => { event.stopPropagation(); st.menu = st.menu === id ? null : id; ctx.draw(); } }, label),
    st.menu === id && el("div", { class: "nv-drop bev" }, items.map((item) => (item ? button(item[0], item[1], { off: Boolean(item[2]) }) : el("hr")))))));
  const tbar = el("div", { class: "nv-tbar" },
    button("Chart", page("chart"), { down: st.view === "chart" }),
    button("Ports", page("ports"), { down: st.view === "ports" }),
    button("News", page("news"), { down: st.view === "news" }),
    el("i"),
    button("Plot", () => plot(ctx, data), { off: !canPlot }),
    button("Clear", () => clearCourse(ctx), { off: !plotted }),
    button("Engage", () => { st.confirm = true; }, { off: cantEngage, title: plotted?.why ?? "" }));

  const pane = st.view === "ports" ? portsPage(ctx, data)
    : st.view === "news" ? newsPage(ctx)
      : st.view === "holds" ? holdsPage(ctx, data)
        : el("div", { class: "nv-pane sunk", id: "navplot-chart" }, chartSvg(ctx, data));

  // The course: where from, where to, what the run takes, and why it can't be made, if it can't.
  const shown = plotted ?? sel;
  const from = data.at ? data.at.name : "Open space";
  const rows = [["Course", !shown ? "Nothing picked" : shown.here ? `Docked at ${shown.name}` : `${from} → ${shown.name}${plotted ? "" : " (not plotted)"}`]];
  if (shown && !shown.here) rows.push(["Run", `${shown.fuel} fuel, ${hoursWords(shown.hours)}${data.charts.byHand ? ", by hand" : ""} · ${shown.dangerLabel}`]);
  const why = shown && !shown.here ? shown.why : null;
  const course = el("div", { class: "nv-group" }, el("b", { class: "nv-legend" }, "Course"),
    rows.map(([label, value]) => el("div", { class: "nv-row" }, el("span", {}, label), el("span", {}, value))),
    why ? el("div", { class: "tone-warn" }, why) : st.note ? el("div", { class: `tone-${st.note.tone}` }, st.note.text) : null,
    el("div", { class: "nv-btns" },
      button("Plot course", () => plot(ctx, data), { off: !canPlot }),
      button("Clear", () => clearCourse(ctx), { off: !plotted }),
      button("Engage jump...", () => { st.confirm = true; }, { off: cantEngage })));

  const sbar = el("div", { class: "nv-sbar" },
    el("span", { class: "sunk" }, `Fuel ${data.ship.fuel} of ${data.ship.maxFuel}`),
    el("span", { class: "sunk" }, st.jump ? `Under way to ${data.places.find((p) => p.id === st.jump.to)?.name ?? "somewhere"}` : data.at ? `Docked at ${data.at.name}` : "In open space"),
    el("span", { class: `sunk${data.charts.byHand ? " tone-warn" : ""}` }, data.charts.byHand ? "Core down: by hand" : "Core online"),
    el("span", { class: "sunk" }, dayAndTime(ctx.game)));

  let dialog = null;
  if (st.jump) {
    const going = data.places.find((p) => p.id === st.jump.to);
    dialog = el("div", { class: "nv-dlg low bev", role: "status" },
      el("div", { class: "nv-title" }, el("span", {}, "Under way")),
      el("div", { class: "nv-dbody" },
        el("div", {}, `Jumping to ${going?.name ?? "somewhere"}: ${hoursWords(going?.hours ?? 0)}.`),
        el("div", { class: "nv-bar sunk", id: "navplot-bar" }, barBlocks(st.jump.sent ? 1 : (performance.now() - st.jump.at) / JUMP_MS))));
  } else if (st.confirm && plotted && !plotted.why) {
    dialog = el("div", { class: "nv-dlg bev", role: "alertdialog", "aria-label": "Engage jump" },
      el("div", { class: "nv-title" }, el("span", {}, "Engage jump")),
      el("div", { class: "nv-dbody" },
        el("div", {}, `Jump to ${plotted.name}? ${plotted.fuel} fuel, ${hoursWords(plotted.hours)}${data.charts.byHand ? ", plotted by hand" : ""}. Hazard: ${plotted.dangerLabel}.`),
        data.charts.ashore && el("div", { class: "tone-dim" }, "You'll go ashore there when she arrives, as with the Star Map."),
        el("div", { class: "nv-btns end" }, button("Engage", () => engage(ctx, data)), button("Cancel", () => { st.confirm = false; }))));
  }

  return el("div", { class: "navplot bev", id: "navplot", role: "group", "aria-label": "Navplot, the ship's chart", onclick: () => { if (st.menu) { st.menu = null; ctx.draw(); } } },
    el("div", { class: "nv-title" }, ctx.picture("chart"), el("span", {}, "Navplot · Concord naval chart, ship's copy"),
      el("button", { type: "button", "aria-label": "Close Navplot", title: "Close Navplot", disabled: Boolean(st.jump), onclick: (event) => { event.stopPropagation(); ctx.close(); } }, "×")),
    mbar, tbar,
    el("div", { class: "nv-body" }, el("div", { class: "nv-left" }, pane, course), destination(ctx, data)),
    sbar, dialog);
}

// ---- The loading screen ----------------------------------------------------------------------------------------

// What's on it so many milliseconds in: the program's name, then what it reads, a line at a time, over a bar.
export function loadingLines(ctx, ms) {
  const data = chartData(ctx);
  const dots = ".".repeat(Math.max(0, Math.min(16, Math.floor(((ms - 500) / 600) * 16))));
  const lines = [];
  const row = (text, cls = "") => lines.push(el("div", { class: cls }, text));
  lines.push(el("div", { class: "nv-load-head" }, ctx.picture("chart"), el("div", {}, el("b", {}, "NAVPLOT 7"), el("small", {}, "Concord Naval Cartography Office · ship's copy"))));
  if (ms >= 500) row(`Reading chart CNC-7 ${dots}${ms >= 1100 ? " OK" : ""}`);
  if (ms >= 1300) row(`Ports on file: ${data.places.length}`);
  if (ms >= 1700) row(`Ship's position: ${data.at ? data.at.name : "open space"}`);
  if (ms >= 2100) row(`Fuel state: ${data.ship.fuel} of ${data.ship.maxFuel}`);
  if (ms >= 2400) row(data.charts.byHand ? "Navigation core: DOWN. Jumps are plotted by hand." : "Navigation core: online", data.charts.byHand ? "tone-warn" : "");
  if (ms >= 2750) row("READY", "nv-ready");
  lines.push(el("div", { class: "nv-bar sunk nv-load-bar" }, barBlocks(ms / LOAD_MS)));
  lines.push(el("div", { class: "nv-load-skip" }, "Click to skip"));
  return lines;
}
export function loadingNode(ctx, ms, skip) {
  return el("div", { class: "navplot nv-load", id: "navplot-load", role: "status", "aria-label": "Navplot is loading", title: "Click to skip", onclick: (event) => { event.stopPropagation(); skip(); } }, loadingLines(ctx, ms));
}
