// The Command menu: the Meridian's chain of command, every post as a card with who holds it, where they're kept,
// who chose them, their skills for it and since when, grouped by who chooses whoever holds them. It's drawn from the
// game's state (src/command.js), and nothing here calls the AI. A card for one of the story's people opens their
// registry printout.

import { el } from "./dom.js";

// What this screen needs from the main screen. Set once, when the page loads.
let app;

export function initCommand(hooks) {
  app = hooks;
}

const section = (title, ...children) => el("section", { class: "menu-section" }, title && el("h3", {}, title), children);
const line = (label, value) => value && el("div", { class: "post-line small" }, el("span", { class: "post-label" }, `${label} `), value);

function card(post) {
  const holder = post.holder;
  const body = [
    el("div", { class: "post-title" }, post.title),
    el("div", { class: `post-who${holder && !holder.alive ? " lost" : ""}` }, holder ? holder.name : "Nobody"),
    line("At", post.station),
    line("Chosen by", post.chooser ? `${post.chosenBy}, ${post.chooser}` : post.chosenBy),
    line("Skills", post.skills),
    line("Heads", post.heads),
    post.watchBill && el("div", { class: "post-line small" }, "Keeps the watch bill"),
    el("div", { class: "post-since small" }, post.since),
  ];
  if (!holder?.sheet) return el("div", { class: "card post-card" }, body);
  return el("button", {
    class: "card post-card",
    title: `${holder.name}'s registry printout`,
    onclick: () => {
      app.closeMenu();
      app.openPersonSheet(holder.key);
    },
  }, body);
}

export function commandMenu() {
  const command = app.ui.game.command;
  if (!command) return el("div", { class: "muted small" }, "Nobody here keeps a chain of command.");
  return el("div", { class: "command-page" }, command.groups.map((group) => section(group.title, el("div", { class: "post-grid" }, group.posts.map(card)))));
}
