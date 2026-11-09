// The Command menu: the Meridian's chain of command, every post as a card with who holds it, where they're kept,
// who chose them, their skills for it, since when and what they remember, grouped by who chooses whoever holds them;
// and the watch bill, with everyone's job, which the captain changes with two clicks. The captain also answers the
// first officer's recommendations, gives a post to someone else with two clicks, and can hold the reviews. At the top,
// how things stand aboard: the officers' loyalty, the council's confidence, and how far a mutiny has got. It's drawn
// from the game's state (src/command.js), and nothing here calls the AI. A card for one of the story's people opens
// their registry printout.

import { api, el, folded, meter } from "./dom.js";

// What this screen needs from the main screen. Set once, when the page loads.
let app;

export function initCommand(hooks) {
  app = hooks;
}

const section = (title, ...children) => el("section", { class: "menu-section" }, title && el("h3", {}, title), children);
const line = (label, value) => value && el("div", { class: "post-line small" }, el("span", { class: "post-label" }, `${label} `), value);

// How the holder has done over their last week in the post, and what the last day was made of.
function duty(post) {
  const d = post.duty;
  if (!d) return null;
  if (d.score === null) return el("div", { class: "post-line small" }, el("span", { class: "post-label" }, "Duty "), `no days on record yet: ${d.measures}`);
  return [
    el("div", { class: "post-duty small" }, meter("DUTY", d.score, 100), el("span", { class: "post-label" }, `over ${d.days} ${d.days === 1 ? "day" : "days"}`)),
    el("div", { class: "post-since small" }, `Last day's marks: ${d.last}`),
  ];
}

// Every order the menu gives goes the same way: to the server, and the menu drawn again with what it says. It's given
// as soon as it's called.
const order = (body) => app.runAction(async () => {
  const { game, message } = await api("/api/command", body);
  app.ui.game = game;
  if (message) app.ui.menuMessage = { ok: true, text: message };
})();

// How loyal the holder is to the captain, and what's moved it.
function loyalty(post) {
  const l = post.loyalty;
  if (!l) return null;
  return [
    el("div", { class: "post-duty small" }, meter("LOYALTY", l.score, 100)),
    l.why && el("div", { class: "post-since small" }, `${l.why[0].toUpperCase()}${l.why.slice(1)}`),
  ];
}

function card(post) {
  const holder = post.holder;
  const body = [
    el("div", { class: "post-title" }, post.title),
    el("div", { class: `post-who${holder && !holder.alive ? " lost" : ""}` }, holder ? holder.name : "Nobody"),
    duty(post),
    loyalty(post),
    line("At", post.station),
    line("Chosen by", post.chooser ? `${post.chosenBy}, ${post.chooser}` : post.chosenBy),
    line("Skills", post.skills),
    line("Heads", post.heads),
    post.watchBill && el("div", { class: "post-line small" }, "Keeps the watch bill"),
    line("Rival", post.rival && `${post.rival}, working against them`),
    el("div", { class: "post-since small" }, post.since),
    post.memories?.length ? post.memories.map((words) => el("div", { class: "post-memory small" }, words)) : null,
  ];
  const face = holder?.sheet
    ? el("button", {
      class: "card post-card",
      title: `${holder.name}'s registry printout`,
      onclick: () => {
        app.closeMenu();
        app.openPersonSheet(holder.key);
      },
    }, body)
    : el("div", { class: "card post-card" }, body);
  if (!post.candidates) return face;
  return el("div", { class: "post-cell" }, face, givePost(post));
}

// ---- Giving a post to someone else ----------------------------------------------------------------

// The post whose candidates are open, between the click on Replace and the click on who gets it.
let replacing = null;

function givePost(post) {
  if (replacing !== post.id) {
    return el("button", { class: "post-replace small", title: `Relieve whoever holds it, and give the post of ${post.title.toLowerCase()} to someone else`, onclick: () => {
      replacing = post.id;
      app.render();
    } }, "Replace...");
  }
  return el("div", { class: "post-candidates" },
    el("div", { class: "post-label small" }, `Give the post of ${post.title.toLowerCase()} to:`),
    post.candidates.length
      ? post.candidates.map((one) => el("button", { class: "post-candidate small", title: `Relieve ${post.holder?.name ?? "nobody"}, and give the post to ${one.name}`, onclick: () => {
        replacing = null;
        order({ action: "replace", post: post.id, key: one.key });
      } }, one.skills ? `${one.name}: ${one.skills}` : one.name))
      : el("span", { class: "muted small" }, "nobody who could take it just now"),
    el("button", { class: "post-replace small", title: "Leave the post as it is", onclick: () => {
      replacing = null;
      app.render();
    } }, "Cancel"));
}

// ---- How things stand aboard --------------------------------------------------------------------------

const STAGE_LINES = ["Calm.", "Grumbling in the mess.", "Orders going astray.", "A delegation's coming.", "The ship's been taken."];

function mood(m) {
  if (!m) return null;
  const rule = m.brews.morale !== null ? `A mutiny brews while morale is under ${m.brews.morale} and the officers' loyalty is under ${m.brews.loyalty}.` : "";
  return el("div", { class: "command-mood small" },
    m.deposed && el("div", { class: "command-deposed" }, m.deposed),
    el("div", { class: "command-meters" },
      m.officers !== null && el("span", { class: "post-duty", title: "The officers' loyalty to the captain, on average" }, meter("OFFICERS", m.officers, 100)),
      el("span", { class: "post-duty", title: "The council's confidence in the captain" }, meter("COUNCIL", m.confidence, 100))),
    el("div", { title: rule }, el("span", { class: "post-label" }, "Aboard: "), STAGE_LINES[m.stage] ?? m.words),
    m.due && el("div", { class: "command-due" }, m.due),
    m.brig.length ? el("div", {}, el("span", { class: "post-label" }, "In the brig: "), m.brig.join("; ")) : null);
}

// ---- The reviews, and what's waiting on the captain ------------------------------------------------

function reviews(r) {
  if (!r) return null;
  const words = r.held ? "The reviews are held, at your word: nobody's warned, relieved or given a post unless you do it." : `The officers review their people every ${r.every} days. The next review is on day ${r.next}.`;
  return el("div", { class: "command-reviews small" },
    el("span", {}, words),
    r.canHold && el("button", {
      class: "watch-move",
      title: r.held ? "Let the officers warn, relieve and promote people again" : "Stop anyone being warned, relieved or given a post unless you do it",
      onclick: () => order({ action: "hold", held: !r.held }),
    }, r.held ? "Let them go on" : "Hold the reviews"));
}

function waiting(list) {
  if (!list?.length) return null;
  return section("Waiting on you", list.map((one) => el("div", { class: "command-waiting" },
    el("div", { class: "small" }, `Day ${one.day}. ${one.text}`),
    el("div", { class: "command-answers" },
      el("button", { title: one.kind === "asks" ? `Give the post to ${one.candidate}` : `Relieve ${one.holder}, and give the post to ${one.candidate}`, onclick: () => order({ action: "answer", post: one.post, answer: "accept" }) }, one.kind === "asks" ? `Give it to ${one.candidate}` : "Do it"),
      el("button", { title: one.kind === "asks" ? `Tell ${one.candidate} no` : `Keep ${one.holder} in the post, and your choice stands a while`, onclick: () => order({ action: "answer", post: one.post, answer: "keep" }) }, one.kind === "asks" ? "Refuse" : `Keep ${one.holder}`),
      one.by && el("button", { title: `Let ${one.by} decide, now`, onclick: () => order({ action: "answer", post: one.post, answer: "leave" }) }, `Leave it to ${one.by}`)))));
}

// ---- The watch bill -----------------------------------------------------------------------------

// Who the captain is moving, between the click on them and the click on where they go.
let moving = null;
const choose = (key) => () => {
  moving = moving === key ? null : key;
  app.render();
};
const move = (job) => () => {
  const key = moving;
  moving = null;
  order({ action: "assign", key, job });
};

function watchBill(bill) {
  const everyone = [...bill.jobs.flatMap((job) => job.people), ...bill.spare];
  if (moving && !everyone.some((one) => one.key === moving)) moving = null;
  const mover = everyone.find((one) => one.key === moving);
  const person = (one) => {
    const words = `${one.name}${one.lost ? `, ${one.lost}` : ""}${one.covering ? `, for ${one.covering}` : ""}${one.past ? ` (${one.past})` : ""}`;
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
  if (replacing && !command.groups.some((group) => group.posts.some((post) => post.id === replacing && post.candidates))) replacing = null;
  return el("div", { class: "command-page" },
    mood(command.mood),
    reviews(command.reviews),
    waiting(command.waiting),
    command.groups.map((group) => section(group.title, el("div", { class: "post-grid" }, group.posts.map(card)))),
    command.watchBill && watchBill(command.watchBill));
}
