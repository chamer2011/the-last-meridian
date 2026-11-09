// The Command menu: the Meridian's chain of command, every post as a card with who holds it, where they're kept,
// who chose them, their skills for it and since when, grouped by who chooses whoever holds them; and the watch bill,
// with everyone's job, which the captain changes with two clicks. It's drawn from the game's state (src/command.js),
// and nothing here calls the AI. A card for one of the story's people opens their registry printout.

import { api, el, folded } from "./dom.js";

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

// ---- The watch bill -----------------------------------------------------------------------------

// Who the captain is moving, between the click on them and the click on where they go.
let moving = null;
const choose = (key) => () => {
  moving = moving === key ? null : key;
  app.render();
};
const move = (job) => app.runAction(async () => {
  const key = moving;
  moving = null;
  const { game, message } = await api("/api/command", { action: "assign", key, job });
  app.ui.game = game;
  if (message) app.ui.menuMessage = { ok: true, text: message };
});

function watchBill(bill) {
  const everyone = [...bill.jobs.flatMap((job) => job.people), ...bill.spare];
  if (moving && !everyone.some((one) => one.key === moving)) moving = null;
  const mover = everyone.find((one) => one.key === moving);
  const person = (one) => {
    const words = `${one.name}${one.lost ? `, ${one.lost}` : ""}${one.covering ? `, for ${one.covering}` : ""}`;
    if (!bill.canMove || one.you) return el("span", { class: `watch-person${one.lost ? " lost" : ""}${one.you ? " you" : ""}` }, words);
    return el("button", { class: `watch-person${one.key === moving ? " moving" : ""}${one.lost ? " lost" : ""}`, title: one.key === moving ? "Don't move them after all" : `Move ${one.name} to another job`, "aria-pressed": String(one.key === moving), onclick: choose(one.key) }, words);
  };
  const row = (title, where, people, job, short = 0) => el("div", { class: "watch-row" },
    el("div", { class: "watch-job" }, el("div", { class: "post-title" }, title), where && el("div", { class: "post-label small" }, where)),
    el("div", { class: "watch-people" },
      people.length ? people.map(person) : el("span", { class: "muted" }, "nobody"),
      short > 0 && el("span", { class: "watch-short small" }, `${short} short`),
      mover && !people.some((one) => one.key === moving) && el("button", { class: "watch-move", title: `Put ${mover.name} here`, onclick: move(job) }, "Move here")));
  return section("The watch bill",
    el("div", { class: "post-line small" }, el("span", { class: "post-label" }, "Kept by "), bill.keeper ?? "nobody"),
    mover && el("div", { class: "watch-moving small" }, `Moving ${mover.name}: pick where they go.`),
    bill.jobs.map((job) => row(job.plural, `${job.room}, ${job.wanted} wanted`, job.people, job.id, job.short)),
    row("Spare hands", null, bill.spare, "spare"),
    bill.log.length ? folded("command-watch-log", "What's changed", bill.log.map((line) => el("div", { class: "small" }, line))) : null);
}

export function commandMenu() {
  const command = app.ui.game.command;
  if (!command) return el("div", { class: "muted small" }, "Nobody here keeps a chain of command.");
  return el("div", { class: "command-page" },
    command.groups.map((group) => section(group.title, el("div", { class: "post-grid" }, group.posts.map(card)))),
    command.watchBill && watchBill(command.watchBill));
}
