// A talk: the captain talks to one person. With the story over the room, what they say comes up
// on a pane by their head and the things to say hang off it; in the other views it's a console over
// the map. The person answers from their written lines, or from stock ones, with the clock stopped.
// Everything is clicked, or picked by its number.

import { trimmedArt } from "./art.js";
import { api, el, readLines, signed } from "./dom.js";
import { shipLogNode } from "./logpage.js";
import { paneNode } from "./pane.js";
import { choicesFor, optionContent, storyEntryNode, thinkingNode } from "./story-view.js";
import { WRITING_SPEEDS, holdBack, newPen } from "./writer.js";

const talk = { sending: false, live: "", heard: null, message: null, lastId: null, logged: 0, writing: false, words: null, wordsOn: null, paneFor: null, youFor: null };

const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pen = newPen({
  speed: () => (calm() ? Infinity : WRITING_SPEEDS[app.reading.writing] ?? WRITING_SPEEDS.normal),
  draw: (count) => {
    talk.words?.show(count);
    if (!pen.busy && !talk.sending) written();
  },
});

// What the window needs from the main screen. Set once, when the page loads.
let app;

export function initTalk(hooks) {
  app = hooks;
  // This listens first, so that Esc closes a menu over the window before it closes the window.
  document.addEventListener("keydown", onKey, true);
}

export const talkOpen = () => Boolean(app?.ui.game?.talk);

export function resetTalk() {
  pen.stop();
  Object.assign(talk, { sending: false, live: "", heard: null, message: null, lastId: null, logged: 0, writing: false, words: null, wordsOn: null, paneFor: null, youFor: null });
}

// Whether the talk is on a pane by the person's head, which it is whenever the story's over the room.
const onPane = () => Boolean(app.popupsShown?.());

// What someone says is written out as it comes. It's always the newest thing they've said.
function writeThis(node) {
  node.querySelector(".cursor")?.remove();
  if (node !== talk.wordsOn) {
    talk.words = holdBack(node, { skip: ".speaker-line" });
    talk.wordsOn = node;
  }
  pen.aim(talk.words.total);
}

function writeNewest() {
  const view = app.ui.game?.talk;
  const log = document.getElementById("talk-log");
  if (!view || !log || talk.sending) return;
  if (view.log.slice(talk.logged).some((entry) => entry.role === "narrator")) {
    pen.start();
    talk.writing = true;
  }
  talk.logged = view.log.length;
  if (!talk.writing) return;
  const said = [...log.children].filter((one) => one.matches(".passage")).at(-1);
  if (said) writeThis(said);
  talk.writing = pen.busy;
}

// ---- Saying things ------------------------------------------------------

function draw() {
  const node = talkNode();
  const current = document.getElementById("talk");
  if (current && node) current.replaceWith(node);
  focusTalk();
}

function updateLive() {
  const live = document.getElementById("talk-live");
  if (!live) return;
  // On the pane, your own line is over your own head, not among their words.
  const entries = [!onPane() && talk.heard && { role: "player", text: talk.heard }, talk.live && { role: "narrator", text: talk.live }].filter(Boolean);
  const nodes = entries.map((entry, i) => storyEntryNode(entry, { streaming: talk.sending && i === entries.length - 1 && entry.role === "narrator" })).filter(Boolean);
  if (talk.sending && !talk.live) nodes.push(thinkingNode());
  live.replaceChildren(...nodes);
  const log = document.getElementById("talk-log");
  const said = talk.live && live.querySelector(".passage");
  if (said) writeThis(said);
  else if (log) log.scrollTop = log.scrollHeight;
}

async function say(text) {
  const line = text.trim();
  if (!line || talk.sending) return;
  Object.assign(talk, { sending: true, heard: line, live: "", message: null, writing: true, words: null });
  pen.start();
  app.ui.streaming = true;
  app.render();
  updateLive();
  const handle = (raw) => {
    if (!raw.trim()) return;
    const msg = JSON.parse(raw);
    if (msg.type === "text") {
      talk.live += msg.text;
      updateLive();
    } else if (msg.type === "state") {
      app.ui.game = msg.state;
    } else if (msg.type === "done") {
      app.ui.game = msg.state;
    } else if (msg.type === "error") {
      app.ui.game = msg.state;
      talk.message = msg.message;
    }
  };
  try {
    const res = await fetch("/api/talk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "say", text: line }) });
    if (!res.ok) throw new Error((await res.json()).error ?? "Something went wrong.");
    await readLines(res, handle);
  } catch (err) {
    talk.message = err.message;
  }
  Object.assign(talk, { sending: false, heard: null, live: "", logged: app.ui.game?.talk?.log.length ?? 0, writing: pen.busy });
  app.ui.streaming = false;
  app.render();
}

async function order(body) {
  if (talk.sending) return;
  talk.message = null;
  try {
    const { game } = await api("/api/talk", body);
    app.ui.game = game;
  } catch (err) {
    // Without a window open, the story panel is where it can be seen.
    if (talkOpen()) talk.message = err.message;
    else app.ui.consoleLines = [{ role: "error", text: err.message }];
  }
  app.render();
}

// Walking up to someone opens this, and they speak first.
export function startTalk(key) {
  return order({ action: "open", person: key });
}

export function endTalk() {
  return order({ action: "close" });
}

// ---- The window ---------------------------------------------------------

const ATTITUDES = ["hostile", "wary", "neutral", "friendly", "ally"];
const THEMES = { hostile: "red", wary: "amber", neutral: "teal", friendly: "green", ally: "green" };

function feelingNode(view) {
  if (!view.attitude) return el("div", { class: "talk-feeling tone-dim" }, "You haven't really met.");
  const filled = (ATTITUDES.indexOf(view.attitude) + 1) * 2;
  return el("div", { class: "talk-feeling" },
    el("div", {}, `FEELS ${view.attitude.toUpperCase()}`),
    el("div", {}, `[${"#".repeat(filled)}${"-".repeat(10 - filled)}]`),
    view.relationship !== 0 && el("div", { class: "tone-dim" }, `${signed(view.relationship)} on social checks`));
}

function personPanel(view) {
  return el("section", { class: "check-panel talk-person", style: `--speaker:${view.color}` },
    el("header", { class: "check-panel-title" }, el("span", {}, "PERSONNEL"), el("span", { class: "check-panel-marks", "aria-hidden": "true" }, "_ [] X")),
    el("div", { class: "check-panel-body talk-person-body" },
      el("pre", { class: "talk-art", "aria-hidden": "true" }, trimmedArt(view.art).join("\n")),
      el("div", { class: "talk-name" }, view.name),
      view.role && el("div", { class: "tone-dim" }, view.role),
      view.doing && el("div", { class: "talk-doing tone-dim" }, `${view.doing[0].toUpperCase()}${view.doing.slice(1)}, when you came over.`),
      feelingNode(view),
      view.note && el("div", { class: "talk-note" }, view.note)));
}

function logPanel(view) {
  return el("section", { class: "check-panel terminal talk-log-panel" },
    el("header", { class: "check-panel-title" }, el("span", {}, `TALKING WITH ${view.short.toUpperCase()}`), el("span", { class: "check-panel-marks", "aria-hidden": "true" }, "_ [] X")),
    el("div", { class: "talk-log", id: "talk-log", role: "log", onclick: (event) => { if (!event.target.closest("[data-lore], summary")) pen.finish(); } },
      view.log.map((entry) => storyEntryNode(entry)),
      el("div", { id: "talk-live" })));
}

// What the person just offered comes first, then asking what they've heard, then goodbye.
function optionsFor(view) {
  const offered = view.lastReply ? choicesFor([{ role: "narrator", text: view.lastReply }]) : [];
  const withCheck = (choice) => choice.tags?.some((tag) => tag.kind === "check" && tag.difficulty);
  return [
    ...offered.map((choice) => ({ ...choice, run: () => (withCheck(choice) ? order({ action: "check", label: choice.label }) : say(choice.label)) })),
    view.rumors > 0 && { label: view.rumorLabel, run: () => order({ action: "rumor" }) },
    { label: view.goodbyeLabel, run: endTalk },
  ].filter(Boolean);
}

function optionsNode(view) {
  return el("div", { class: "options talk-options" }, optionsFor(view).map((option, i) => el("button", {
    "data-choice": String(i + 1),
    disabled: talk.sending,
    onclick: option.run,
  }, el("span", { class: "option-number" }, `${i + 1})`), optionContent(option))));
}

const TALK_HINT = "Click a line, or press its number.";

// A new talk starts its count of what's been said from nothing.
function noteTalk(view) {
  if (view.id === talk.lastId) return;
  talk.lastId = view.id;
  talk.logged = 0;
}

// The talk's own window, for the views where the story isn't over the room.
export function talkNode() {
  const view = app.ui.game?.talk;
  if (!view || onPane()) return null;
  noteTalk(view);
  if (view.page) return el("div", { class: "check-overlay ship-log-overlay", id: "talk" }, talkPageNode(view));
  return el("div", { class: "check-overlay", id: "talk" },
    el("div", { class: "check-window talk-window", id: "talk-window", "data-theme": THEMES[view.attitude] ?? "blue", role: "dialog", "aria-label": `Talking with ${view.name}`, tabindex: "-1" },
      el("header", { class: "check-title" },
        el("span", { class: "check-name" }, view.name),
        el("span", { class: "check-skill" }, view.where),
        el("span", { class: "check-difficulty" }, "THE CLOCK IS STOPPED"),
        el("button", { class: "mobile-toggle", onclick: () => app.openMenu(app.ui.tab) }, "Menu")),
      el("div", { class: "talk-desk" }, personPanel(view), logPanel(view)),
      talk.message && el("div", { class: "notice-inline fail talk-message" }, talk.message),
      el("div", { class: "check-controls" }, optionsNode(view)),
      el("footer", { class: "check-taskbar" },
        el("span", { class: "check-hint" }, TALK_HINT),
        el("span", { class: "check-spacer" }),
        view.relationship !== 0 && el("span", { class: "check-meter" }, `${signed(view.relationship)} ON SOCIAL CHECKS`))));
}

// ---- The talk by their head ---------------------------------------------

// With the story over the room, the talk is there too: what they say comes up on a pane by their
// head, your own line on one by yours while they answer, and the things you can say hang off their
// pane once their words are all there, on whichever side has the room.

// The newest thing they've said, which is what the pane shows. It goes while they're thinking of more.
function latestSaid(view) {
  if (talk.sending) return null;
  const last = view.log.at(-1);
  return last && last.role !== "player" ? last : null;
}

function lastPlayerLine(view) {
  for (let i = view.log.length - 1; i >= 0; i -= 1) if (view.log[i].role === "player") return view.log[i].text;
  return null;
}

// Once their words are all there, the choices slide in beside them, and your own line goes.
function written() {
  document.getElementById("talk-choices")?.classList.add("in");
  document.getElementById("pop-you")?.classList.add("away");
}

const feelingTag = (view) => (view.attitude ? el("span", { class: "pop-tag-note" }, `feels ${view.attitude}`) : null);

const cornerNodes = () => ["tl", "tr", "bl", "br"].map((corner) => el("span", { class: `pop-corner ${corner}`, "aria-hidden": "true" }));

function choicesPanel(view, ready) {
  return el("div", { class: `pop-choices${ready ? " in" : ""}`, id: "talk-choices" },
    cornerNodes(),
    el("div", { class: "pop-tag" }, "What do you say?"),
    optionsNode(view),
    talk.message && el("div", { class: "notice-inline fail talk-message" }, talk.message),
    el("div", { class: "pop-choices-foot" },
      el("span", {}, TALK_HINT),
      view.relationship !== 0 && el("span", {}, `${signed(view.relationship)} on social checks with them`)),
    view.log.length > 1 && el("details", { class: "pop-record" },
      el("summary", {}, "What was said"),
      el("div", { class: "pop-record-lines" }, view.log.map((entry) => storyEntryNode(entry)))));
}

// A conversation shown as a page of the ship's log (a part with a PAGE: line, src/talks.js): its words and the file's own
// answers, with their labels, and once it's been answered, what's said to that and only Close.
function talkPageNode(view) {
  const said = latestSaid(view);
  const offered = view.page.done || talk.sending || !view.lastReply ? [] : choicesFor([{ role: "narrator", text: view.lastReply }]);
  const withCheck = (choice) => choice.tags?.some((tag) => tag.kind === "check" && tag.difficulty);
  // What the answer did ("Taken on: ...", what's done with the prisoners), said since the player last spoke.
  const since = view.log.findLastIndex((entry) => entry.role === "player");
  const notes = view.page.done && since >= 0 ? view.log.slice(since + 1).filter((entry) => entry.role === "notice") : [];
  return shipLogNode({
    id: "ship-log-talk",
    page: view.page,
    text: said?.text ?? null,
    notes,
    options: offered.map((choice) => ({ ...choice, run: () => (withCheck(choice) ? order({ action: "check", label: choice.label }) : say(choice.label)) })),
    close: talk.sending ? null : endTalk,
  });
}

// The person's pane and, while they answer, yours. Both go among the popups over the room.
export function talkPanesNode() {
  const view = app.ui.game?.talk;
  if (!view || !onPane()) return null;
  if (view.page) return talkPageNode(view);
  noteTalk(view);
  const opening = view.id !== talk.paneFor && !calm();
  talk.paneFor = view.id;
  const unread = view.log.slice(talk.logged).some((entry) => entry.role === "narrator");
  const said = latestSaid(view);
  const theirs = paneNode({
    id: "talk",
    key: view.key,
    color: view.color,
    opening,
    className: "pop-talk",
    onTap: () => pen.finish(),
    tag: [el("span", { class: "pop-tag-name" }, view.name), feelingTag(view)],
    body: el("div", { class: "pop-words", id: "talk-log", role: "log" }, said && storyEntryNode(said), el("div", { id: "talk-live" })),
    extras: choicesPanel(view, !talk.sending && !talk.writing && !unread),
  });
  const mine = talk.sending ? talk.heard : talk.writing || unread ? lastPlayerLine(view) : null;
  const yours = mine && paneNode({
    id: "pop-you",
    key: "you",
    color: "var(--text)",
    opening: mine !== talk.youFor && !calm(),
    className: "pop-mine",
    tag: el("span", { class: "pop-tag-name" }, app.ui.game.name),
    body: el("div", { class: "pop-words" }, el("div", { class: "player-text" }, mine)),
  });
  talk.youFor = mine ?? null;
  return [theirs, yours];
}

// Shows the latest of what's been said.
export function focusTalk() {
  const log = document.getElementById("talk-log");
  if (log) log.scrollTop = log.scrollHeight;
  writeNewest();
}

function onKey(event) {
  if (app.ui.screen !== "game" || !talkOpen() || app.ui.sideOpen || event.ctrlKey || event.metaKey || event.altKey) return;
  if (app.ui.game.combat || app.ui.game.check) return;
  if (event.key === "Escape") {
    if (!talk.sending) endTalk();
    return;
  }
  if (talk.sending || !/^[1-9]$/.test(event.key)) return;
  const choice = document.querySelector(`#talk [data-choice="${event.key}"]`);
  if (choice) {
    event.preventDefault();
    choice.click();
  }
}
