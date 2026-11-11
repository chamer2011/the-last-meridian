// The quest tracker in the top left corner of the room, and the quest log it grows into. Small, it's the steps of the
// quest the player follows: the last one done, and what it needs now, with where, amber when it's on hold and red when
// it's failed. J, the Quests button or a click on it opens the log: the same box slides wider and taller, with the
// quest's steps staying on the left where they were, and the player's quests and what happened in them unfolding on the
// right. Picking another quest there only changes which one's shown; Follow makes it the one the tracker follows; J, Esc
// or Close slides it back. The box is kept from one drawing of the screen to the next, so it slides instead of being
// drawn again.

import { api, el } from "./dom.js";
import { storyEntryNode } from "./story-view.js";

let app;
const state = { open: false, viewing: null, node: null, message: null };

const SMALL_WIDE = 300;
const OPEN = { wide: 760, tall: 440 };

export function initQuests(hooks) {
  app = hooks;
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", () => draw());
}

export const questsOpen = () => state.open;
export function resetQuests() {
  state.open = false;
  state.viewing = null;
  state.message = null;
}

export function openQuests() {
  state.open = true;
  state.viewing = log().following ?? log().quests[0]?.id ?? null;
  state.message = null;
  draw();
}
export function closeQuests() {
  if (!state.open) return;
  state.open = false;
  draw();
}
export const toggleQuests = () => (state.open ? closeQuests() : openQuests());

// ---- What it shows ------------------------------------------------------------------------------------------

const log = () => app?.ui.game?.questLog ?? { following: null, quests: [] };
const questOf = (id) => log().quests.find((quest) => quest.id === id) ?? null;
const STEP_MARK = { here: "[>]", go: "[>]", hold: "[!]", failed: "[X]", done: "[x]" };
const toneOf = (quest) => (!quest ? "" : quest.status === "failed" || quest.step?.state === "failed" ? "failed" : quest.step?.state === "hold" ? "hold" : quest.status === "completed" ? "done" : "");

// The quest's steps: what's been done, all of them in the log and the last one in the tracker, and what it needs now.
function stepsNode(quest, { full }) {
  const done = full ? quest.done : quest.done.slice(-1);
  const step = quest.step ?? { state: "go", text: quest.objective };
  const over = quest.status !== "active";
  return el("ul", { class: "qt-steps" },
    done.map((text) => el("li", { class: "done" }, el("span", { class: "qt-box" }, "[x]"), el("span", { class: "qt-what" }, text))),
    el("li", { class: over ? (quest.status === "failed" ? "failed" : "done") : step.state },
      el("span", { class: "qt-box" }, over ? (quest.status === "failed" ? "[X]" : "[x]") : STEP_MARK[step.state] ?? "[>]"),
      el("span", { class: "qt-what" }, step.text || quest.objective),
      step.where && !over && el("span", { class: "qt-where" }, step.state === "hold" && !/^On hold/.test(step.where) ? `On hold. ${step.where}` : step.where)));
}

function headNode(quest) {
  return [
    el("span", { class: "qt-title" }, quest ? quest.title : "Quests"),
    state.open
      ? el("button", { class: "qt-close", onclick: (event) => { event.stopPropagation(); closeQuests(); }, title: "Or press J or Esc" }, "Close")
      : el("span", { class: "qt-key" }, el("kbd", {}, "J"), " quests"),
  ];
}

// The left page in the log: the quest's steps, what it's about, and Follow.
function leftNode(quest, { full }) {
  if (!quest) return el("div", { class: "qt-left-inner" }, el("p", { class: "qt-none" }, "No quests yet."));
  const following = log().following === quest.id;
  return el("div", { class: "qt-left-inner" },
    stepsNode(quest, { full }),
    full && quest.desc && el("p", { class: "qt-about" }, quest.desc),
    full && quest.status === "active" && (following
      ? el("span", { class: "qt-chip" }, "Following")
      : el("button", { class: "qt-follow", onclick: () => follow(quest.id) }, "Follow this one")),
    full && state.message && el("div", { class: "qt-message" }, state.message));
}

// The right page: the player's quests, to look at another, and what happened in the one being looked at.
function listNode(viewing) {
  const { quests, following } = log();
  const g = app.ui.game;
  const record = g.story?.record ?? { endings: [], facts: [] };
  const going = quests.filter((quest) => quest.status === "active");
  const groups = [
    ["Following", going.filter((quest) => quest.id === following)],
    ["Going on", going.filter((quest) => quest.id !== following && !quest.request && quest.step?.state !== "hold")],
    // What people aboard have asked, apart from the stories (src/requests.js).
    ["Requests", going.filter((quest) => quest.id !== following && quest.request)],
    ["On hold", going.filter((quest) => quest.id !== following && !quest.request && quest.step?.state === "hold")],
    ["Failed", quests.filter((quest) => quest.status === "failed")],
    ["Finished", quests.filter((quest) => quest.status === "completed")],
  ];
  // A story that ended on the record without a quest of its own is finished too.
  const ended = record.endings.filter((ending) => !quests.some((quest) => quest.id === ending.id));
  return el("div", { class: "qt-list", role: "listbox", "aria-label": "Your quests" },
    groups.filter(([, list]) => list.length).map(([label, list]) => [
      el("div", { class: "qt-group" }, label),
      list.map((quest) => el("button", {
        class: `qt-item${quest.id === viewing ? " picked" : ""}`,
        role: "option",
        "aria-selected": String(quest.id === viewing),
        "data-tone": toneOf(quest),
        "data-quest": quest.id,
        onclick: () => view(quest.id),
      }, el("span", { class: "qt-item-name" }, quest.title, quest.request && quest.status !== "active" && el("span", { class: "qt-tag" }, "request")), el("span", { class: "qt-item-step" }, quest.status === "active" ? (quest.step?.state === "hold" ? `On hold: ${quest.step.text}` : quest.step?.text || quest.objective) : quest.objective))),
    ]),
    ended.length > 0 && [el("div", { class: "qt-group" }, "Ended without you"), ended.map((ending) => el("div", { class: "qt-item ended" }, el("span", { class: "qt-item-name" }, ending.title), el("span", { class: "qt-item-step" }, ending.summary ?? "")))]);
}

// What happened in a quest: what its scenes said and what the player did in them, the latest first.
function storyNode(quest) {
  const g = app.ui.game;
  if (!quest) return null;
  const entries = g.transcript.filter((entry) => entry.quest === quest.id && (entry.role === "narrator" || entry.role === "player")).slice(-40).reverse();
  const record = g.story?.record ?? { endings: [], facts: [] };
  const ending = record.endings.find((one) => one.id === quest.id);
  return el("div", { class: "qt-story" },
    el("div", { class: "qt-group" }, "What happened"),
    ending && el("div", { class: "qt-ending" }, ending.summary ?? ""),
    entries.length
      ? entries.map((entry) => (entry.role === "player"
        ? el("div", { class: "qt-said" }, `> ${entry.text}`)
        : el("div", { class: "qt-passage" }, storyEntryNode({ role: "narrator", text: withoutChoices(entry.text) }))))
      : el("p", { class: "qt-none" }, quest.status === "active" ? "Nothing yet. It's in the journal below as it happens." : "This one was settled away from the written story."),
    el("details", { class: "qt-fold" },
      el("summary", {}, `Journal (${g.journal.length})`),
      g.journal.length ? [...g.journal].reverse().map((entry) => el("div", { class: "qt-entry" }, entry.entry)) : el("p", { class: "qt-none" }, "Important events will be recorded here.")),
    el("details", { class: "qt-fold" },
      el("summary", {}, `Facts on record (${record.facts.length})`),
      record.facts.length ? [...record.facts].reverse().map((fact) => el("div", { class: "qt-entry" }, fact.text)) : el("p", { class: "qt-none" }, "What the stories leave behind is kept here.")));
}

const withoutChoices = (text) => String(text ?? "").split("\n").filter((line) => !line.trim().startsWith(">")).join("\n").trim();

// ---- Drawing it, in place ---------------------------------------------------------------------------------

function nodeNow() {
  if (state.node) return state.node;
  state.node = el("section", { class: "qt", id: "quest-tracker", role: "region", "aria-label": "Quests" },
    el("header", { class: "qt-head", onclick: () => toggleQuests() }),
    el("div", { class: "qt-left", onclick: () => { if (!state.open) openQuests(); } }),
    el("div", { class: "qt-right" }));
  return state.node;
}

// The box for the room, the same one each time the screen is drawn. What's in it is filled in once it's on the page.
export function questTrackerNode() {
  if (!app?.ui.game) return null;
  return nodeNow();
}

// Whether the tracker has anything to show: a quest to follow, or the log open.
const showing = () => state.open || Boolean(questOf(log().following));

// Once it's on the page: what's in it, and its size. Opening and closing it slides, because the box is the same one.
export function drawQuests() {
  draw();
}

function draw() {
  const node = state.node;
  if (!node?.isConnected) return;
  node.hidden = !showing();
  if (node.hidden) return;
  const viewing = state.open ? questOf(state.viewing) ?? questOf(log().following) ?? log().quests[0] ?? null : questOf(log().following);
  node.classList.toggle("open", state.open);
  node.dataset.tone = toneOf(viewing);
  node.querySelector(".qt-head").replaceChildren(...headNode(viewing));
  node.querySelector(".qt-left").replaceChildren(leftNode(viewing, { full: state.open }));
  if (state.open) {
    const right = node.querySelector(".qt-right");
    const top = right.querySelector(".qt-list")?.scrollTop ?? 0;
    right.replaceChildren(listNode(viewing?.id ?? null), storyNode(viewing));
    const list = right.querySelector(".qt-list");
    if (list) list.scrollTop = top;
  }
  size(node);
  app.placed?.();
}

// The box's size, which is what slides: the steps' own height, small; the log's size, open, within the room. In a room
// too narrow for it beside the clock, it goes under the clock.
function size(node) {
  const room = node.parentElement;
  const wide = room?.clientWidth ?? 800;
  const tall = room?.clientHeight ?? 600;
  const clock = room?.querySelector("#walk-clock");
  // Where the story has the whole window, it's under the status line, however many lines that takes.
  const status = room?.classList.contains("story") ? room.querySelector("#status") : null;
  const clash = clock && clock.offsetHeight && clock.offsetLeft < 8 + SMALL_WIDE + 8;
  node.style.top = status ? `${status.offsetTop + status.offsetHeight + 8}px` : clash ? `${clock.offsetTop + clock.offsetHeight + 6}px` : "";
  if (state.open) {
    const w = Math.max(SMALL_WIDE, Math.min(OPEN.wide, wide - 24));
    node.classList.toggle("narrow", w < 620);
    node.style.width = `${w}px`;
    node.style.height = `${Math.max(240, Math.min(OPEN.tall, tall - 70))}px`;
    return;
  }
  const head = node.querySelector(".qt-head").offsetHeight;
  const inner = node.querySelector(".qt-left-inner")?.offsetHeight ?? 0;
  const height = head + inner + 6;
  node.style.width = `${Math.min(SMALL_WIDE, wide - 24)}px`;
  node.style.height = `${height}px`;
  // The room's notes, and what happens over the room on a small screen, start under it.
  room?.style.setProperty("--qt-bottom", `${node.offsetTop + height}px`);
}

// Looking at another quest only changes what's shown, in place: the box stays as it is.
function view(id) {
  state.viewing = id;
  state.message = null;
  draw();
}

async function follow(id) {
  try {
    const { game } = await api("/api/quests", { follow: id });
    app.ui.game = game;
    state.message = null;
  } catch (err) {
    state.message = err.message;
  }
  draw();
}

// After the game has changed, the tracker says so.
export function questsChanged() {
  draw();
}

// ---- Keys ---------------------------------------------------------------------------------------------------

function onKey(event) {
  const { ui } = app;
  if (ui.screen !== "game" || !ui.game || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.closest?.("input, textarea, select") || document.getElementById("board")) return;
  if (state.open && event.key === "Escape") {
    event.preventDefault();
    closeQuests();
    return;
  }
  if ((event.key === "j" || event.key === "J") && !event.repeat) {
    if (ui.sideOpen) return;
    event.preventDefault();
    toggleQuests();
  }
}
