// The ending: a page of the ship's log over the whole game, once the player has died (src/ending.js). It says who they
// were, when and how they died and what became of the ship, with the last things the story said before it, and offers
// what the owner chose on 2026-11-16: the way back to a morning the game kept by itself (server.js keeps one from each
// of the last three), and a new game. The title screen, where their own saves are, is the third way out. Nothing behind
// the page can be reached while it's up, by the mouse or the keys: that game is over.

import { api, el } from "./dom.js";

// What the page needs from the main screen: { ui, render, loadGame, newGame, toTitle }. Set once, when the page loads.
let app = null;
// The ending being shown: whose it is, the mornings the server has for it (null while they're on their way), what's
// being done about it, and what went wrong with that.
const page = { key: null, mornings: null, busy: null, error: null };

export function initEnding(hooks) {
  app = hooks;
}

// Whether the ending is what's on screen.
export const endingShown = () => Boolean(app && app.ui.screen === "game" && app.ui.game?.over);

const corners = () => ["tl", "tr", "bl", "br"].map((corner) => el("span", { class: `pop-corner ${corner}`, "aria-hidden": "true" }));

// The mornings kept of this game, asked for once when its ending comes up.
function askMornings(key) {
  api("/api/mornings")
    .then((reply) => {
      if (page.key !== key) return;
      page.mornings = Array.isArray(reply.mornings) ? reply.mornings : [];
      app.render();
    })
    .catch(() => {
      if (page.key !== key) return;
      // Without them there's still a new game and the title screen.
      page.mornings = [];
      app.render();
    });
}

// One of the ways out, done once: the buttons wait while it's on its way, and say so if it couldn't be done.
async function leave(name, how) {
  if (page.busy) return;
  Object.assign(page, { busy: name, error: null });
  app.render();
  try {
    await how();
  } catch (err) {
    page.error = err.message;
  }
  page.busy = null;
  app.render();
}

// The page, or nothing while the player's alive.
export function endingNode() {
  const g = app?.ui.game;
  const over = g?.over;
  if (!over) {
    Object.assign(page, { key: null, mornings: null, busy: null, error: null });
    return null;
  }
  const key = `${g.name}|${over.when}|${over.line}`;
  if (page.key !== key) {
    Object.assign(page, { key, mornings: null, busy: null, error: null });
    askMornings(key);
  }
  const ways = [
    ...(page.mornings ?? []).map((one) => ({
      label: `Go back to ${one.words ?? one.when}`,
      detail: one.words ? one.when : "a save the game kept by itself",
      run: () => leave(one.slot, () => app.loadGame(one.slot)),
    })),
    { label: "New game", detail: "someone new, from the beginning", run: () => leave("new", app.newGame) },
    { label: "The title screen", detail: "your own saved games are there", run: () => leave("title", app.toTitle) },
  ];
  const note = page.mornings === null ? "Looking for the mornings the game kept..."
    : page.mornings.length ? "The game keeps a save from each of the last three mornings by itself."
      : "No morning of this game was kept. Your own saved games are on the title screen.";
  return el("div", { class: "ending-overlay", id: "ending" },
    el("section", { class: "ship-log ending-page", role: "dialog", "aria-modal": "true", "aria-label": `The ship's log: ${g.name} has died` },
      corners(),
      el("header", { class: "ship-log-bar" },
        el("span", { class: "ship-log-when" }, `Ship's log · ${over.when}`),
        el("span", { class: "ship-log-clock" }, "The clock has stopped")),
      el("div", { class: "ship-log-head" },
        el("div", { class: "ship-log-titles" },
          el("div", { class: "ship-log-title ending-name" }, g.name),
          el("div", { class: "ship-log-under" }, g.role?.title ?? ""))),
      el("div", { class: "ship-log-words ending-words", "data-scrolls": "1" },
        el("p", { class: "ending-line" }, over.line),
        over.more.map((line) => el("p", {}, line)),
        over.last.length > 0 && el("div", { class: "ending-last" },
          el("div", { class: "ending-last-title" }, "The last of the log"),
          over.last.map((line) => el("div", { class: "ending-last-line" }, line)))),
      el("div", { class: "ship-log-ask" }, "What now?"),
      el("div", { class: "options ship-log-options" }, ways.map((way, i) => el("button", {
        "data-choice": String(i + 1),
        disabled: Boolean(page.busy),
        onclick: way.run,
      }, el("span", { class: "option-number" }, `${i + 1})`), el("span", { class: "option-label" }, way.label), el("span", { class: "option-detail" }, ` ${way.detail}`)))),
      page.error && el("div", { class: "ending-error", role: "alert" }, page.error),
      el("footer", { class: "ship-log-foot" },
        el("span", {}, page.busy ? "One moment..." : "Click one, or press its number"),
        el("span", {}, note))));
}

// With the ending up, the keys do nothing behind it: only its own numbers, which the log pages' own listener takes
// (public/logpage.js), and what a button does when it has the keys.
document.addEventListener("keydown", (event) => {
  if (!document.getElementById("ending")) return;
  event.stopPropagation();
}, true);
