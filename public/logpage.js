// A page of the ship's log over the room: a big moment in the story shown whole, with a drawing at its top in the game's
// console style, the words, and what the player can decide, each answer with its labels (what it costs, tests or
// gives, as the scene file tags it). It comes from a part with a PAGE: line (world/scenes/_how-to-write-a-scene.txt): a
// scene's, which public/popups.js shows, or a conversation's, which public/talk.js does. The clock stops while it's open
// (public/walk.js), and the notes and the quest tracker step aside. It can be pulled aside for a look at the room, and
// slides back. 1 to 9 pick an answer; Esc closes a page that has nothing to decide.

import { el } from "./dom.js";
import { SPRING_MS, makePullable } from "./pull.js";
import { optionContent, storyEntryNode } from "./story-view.js";

const withoutChoices = (text) => String(text ?? "").split("\n").filter((line) => !line.trim().startsWith(">")).join("\n").trim();
const corners = () => ["tl", "tr", "bl", "br"].map((corner) => el("span", { class: `pop-corner ${corner}`, "aria-hidden": "true" }));

// page: { title, under, drawing, at } from the server; text: the words; options: [{ label, tags, run }]; close: what
// Close does, for a page with nothing left to decide. A scene's page is #ship-log, a conversation's #ship-log-talk.
export function shipLogNode({ page, text, notes = [], options = [], close = null, id = "ship-log" }) {
  const answers = options.length ? options : close ? [{ label: "Close", run: close }] : [];
  const node = el("section", { class: "ship-log", id, role: "dialog", "aria-label": `The ship's log: ${page.title}` },
    corners(),
    el("header", { class: "ship-log-bar" },
      el("span", { class: "ship-log-when" }, `Ship's log · ${page.at}`),
      el("span", { class: "ship-log-clock" }, "The clock is stopped")),
    el("div", { class: "ship-log-head" },
      page.drawing && el("pre", { class: "ship-log-drawing", "aria-hidden": "true" }, page.drawing.join("\n")),
      el("div", { class: "ship-log-titles" },
        el("div", { class: "ship-log-title" }, page.title),
        page.under && el("div", { class: "ship-log-under" }, page.under))),
    el("div", { class: "ship-log-words", "data-scrolls": "1" },
      text ? storyEntryNode({ role: "narrator", text: withoutChoices(text) }) : el("div", { class: "thinking" }, "..."),
      // What the answer did, which goes in the notes too, while those are out of the way of the page.
      notes.map((entry) => storyEntryNode(entry))),
    options.length > 0 && el("div", { class: "ship-log-ask" }, "What do you decide?"),
    answers.length > 0 && el("div", { class: "options ship-log-options" }, answers.map((option, i) => el("button", {
      "data-choice": String(i + 1),
      onclick: option.run,
    }, el("span", { class: "option-number" }, `${i + 1})`), optionContent(option)))),
    el("footer", { class: "ship-log-foot" },
      el("span", {}, options.length ? "Click an answer, or press its number" : "Close it, or press 1 or Esc"),
      el("span", {}, "Pull the page aside to see the room")));
  return makePullable(node, {
    follow: (one, dx, dy) => {
      one.style.transform = `translate(${dx}px, ${dy}px)`;
    },
    back: (one) => {
      one.style.transform = "";
      setTimeout(() => one.classList.remove("springing"), SPRING_MS);
    },
  });
}

// The page's own keys, ahead of the room's: a number picks that answer, and Esc closes a page with nothing to decide.
// The newest page there is, if any: a conversation's comes after a scene's.
export const pageOpen = () => [...document.querySelectorAll(".ship-log")].at(-1) ?? null;

document.addEventListener("keydown", (event) => {
  const page = pageOpen();
  if (!page || event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.("input, textarea, select")) return;
  const pick = /^[1-9]$/.test(event.key) ? page.querySelector(`[data-choice="${event.key}"]`)
    : event.key === "Escape" && !page.querySelector(".ship-log-ask") ? page.querySelector('[data-choice="1"]') : null;
  if (!pick) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  pick.click();
}, true);
