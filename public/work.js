// The Work page: the ship's work board, as the officers run it. At the top, how many hands are free, what the first
// officer has put first and why, and who decides how much each store should want. Then every store with what it has
// against what it wants and what's on its way, and every job, the most urgent first, with who's on it and since when
// or why it's stuck. A job nobody's on has I'll do it: the crew leaves it to you for a while, and it's shown in the
// corner like a quest. It's drawn from the game's state (boardView in src/work.js).

import { api, el } from "./dom.js";

// What this screen needs from the main screen. Set once, when the page loads.
let app;

export function initWork(hooks) {
  app = hooks;
}

const section = (title, ...children) => el("section", { class: "menu-section" }, title && el("h3", {}, title), children);
const muted = (text) => el("div", { class: "muted small" }, text);
const upperFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : "");

// Every order the page gives goes the same way: to the server, and the page drawn again with what it says.
const order = (body) => app.runAction(async () => {
  const { game, message } = await api("/api/work", body);
  app.ui.game = game;
  if (message) app.ui.menuMessage = { ok: true, text: message };
})();

// A row of squares for what a store has against what it wants: filled up to what it has, the rest of what it wants
// empty, and what it has beyond that in a quieter colour.
function squares(has, wants, holds) {
  const most = Math.min(holds, 12);
  const scale = holds > most ? most / holds : 1;
  const filled = Math.round(Math.min(has, holds) * scale);
  const wanted = wants === null ? 0 : Math.round(wants * scale);
  return el("span", { class: "work-squares", "aria-hidden": "true" },
    Array.from({ length: most }, (_, i) => el("i", { class: i < filled ? (i < wanted || wants === null ? "on" : "over") : i < wanted ? "want" : "" })));
}

// What the officers have decided: what comes first, and who sets what the stores want.
function orders(board) {
  const first = board.first;
  const levels = board.levels;
  if (!first && !levels) return null;
  return el("div", { class: "work-orders" },
    first && el("div", { class: "work-first" },
      el("strong", { class: first.part ? "work-part" : "" }, `${first.title}.`),
      el("span", { class: "small" }, first.by ? ` ${first.by}'s order since ${first.since}: ${first.why}.` : ` ${upperFirst(first.why)}, so nobody decides what comes first.`)),
    levels && el("div", { class: "small" },
      el("span", { class: "post-label" }, "What stores want "),
      levels.by ? `is set by ${levels.by}, who raises it after a store has run low.` : `stays as it is: ${levels.why}.`));
}

function storeRow(store) {
  if (store.count) {
    return el("div", { class: "work-row" },
      el("span", { class: "work-name" }, store.name, el("span", { class: "muted" }, `, ${store.room}`)),
      el("span", { class: "work-count" }, `${store.count.n} / ${store.count.of} ${store.count.unit}`),
      el("span", { class: "muted small" }, store.note));
  }
  return store.rows.map((row, i) => el("div", { class: "work-row" },
    el("span", { class: "work-name" }, i === 0 ? [store.name, el("span", { class: "muted" }, `, ${store.room}`)] : ""),
    el("span", { class: `work-count${row.urgent ? " tone-bad" : row.short ? " tone-warn" : ""}` },
      squares(row.has, row.wants, row.holds),
      ` ${row.has}${row.wants === null ? "" : ` / ${row.wants}`} ${row.name}${row.has === 1 || /produce$/.test(row.name) ? "" : "s"}`),
    el("span", { class: "muted small" }, row.wants === null ? (row.note || `holds ${row.holds}`) : row.note)));
}

function jobRow(job) {
  return el("div", { class: "work-job", title: `Carried by ${job.by}.` },
    el("span", { class: `work-mark${job.mark ? " tone-bad" : ""}` }, job.mark || "·"),
    el("span", { class: "work-what" }, job.what, job.why ? el("span", { class: "tone-bad" }, `, ${job.why}`) : null),
    el("span", { class: `work-status small${job.stuck ? " tone-bad" : job.busy || job.mine ? "" : " muted"}` }, job.status),
    job.canTake ? el("button", { class: "small", title: "The crew leaves it to you for a while, and it's shown in the corner", onclick: () => order({ action: "mine", id: job.id }) }, "I'll do it")
      : job.mine ? el("button", { class: "small", title: "Give it back to the crew", onclick: () => order({ action: "leave", id: job.id }) }, "Leave it to the crew")
        : null);
}

export function workMenu() {
  const board = app.ui.game.ship?.board;
  if (!board) return el("div", { class: "muted small" }, "There's no work board here.");
  return el("div", { class: "work-page" },
    el("div", { class: "work-top small" }, el("span", {}, `${board.name}`), el("span", { class: board.hands.free ? "" : "tone-bad" }, `${board.hands.free} of ${board.hands.of} hands free`)),
    orders(board),
    section("Stores, has / wants", board.stores.map(storeRow),
      muted("A filled square is something in the store, and an empty one something it still wants. A job comes up whenever a store has fewer than it wants, and it's fetched from the nearest store that can spare it.")),
    section("Jobs, the most urgent first", board.jobs.length ? board.jobs.map(jobRow) : muted("Every store has what it wants."),
      muted("!! is urgent, and ! is in the part of the ship that's been put first. Point at a job for who carries for that store. I'll do it holds a job for you: carry the things into the store yourself, and the crew takes it back if you don't get to it.")));
}
