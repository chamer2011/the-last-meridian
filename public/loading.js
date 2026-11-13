// The loading screen: over the whole game while a place's map is being loaded (public/iso.js). Every level of the place
// is drawn whole before the room is shown, so this says which place it is and how far the drawing has got. It needs
// nothing from the player, and goes by itself.

import { el } from "./dom.js";

let screen = null;

const corners = () => ["tl", "tr", "bl", "br"].map((corner) => el("span", { class: `pop-corner ${corner}`, "aria-hidden": "true" }));

// Shows it, or brings it up to date: the place's name, how many levels it has and what they're called (decks, rooms),
// and how much of it is drawn, from 0 to 1. Nothing is known of the place yet while its levels are on their way.
export function showLoading({ name = "", levels = 0, what = "rooms", share = 0 } = {}) {
  if (!screen) {
    screen = el("div", { class: "loading-screen", id: "loading-screen", role: "status", "aria-live": "polite" },
      el("div", { class: "loading-box" },
        corners(),
        el("div", { class: "loading-tag" }, "Loading"),
        el("div", { class: "loading-name" }),
        el("div", { class: "loading-meter", "aria-hidden": "true" }, el("div", { class: "loading-fill" })),
        el("div", { class: "loading-note" }, el("span", { class: "loading-what" }), el("span", { class: "loading-share" }))));
    document.body.append(screen);
  }
  const percent = Math.max(0, Math.min(100, Math.floor(share * 100)));
  screen.querySelector(".loading-name").textContent = name || "The map";
  screen.querySelector(".loading-fill").style.width = `${percent}%`;
  screen.querySelector(".loading-what").textContent = levels ? `Drawing ${levels === 1 ? `the ${what.replace(/s$/, "")}` : `${levels} ${what}`}` : "Getting the plans";
  screen.querySelector(".loading-share").textContent = `${percent}%`;
}

export function hideLoading() {
  screen?.remove();
  screen = null;
}

export const loadingShown = () => Boolean(screen);
