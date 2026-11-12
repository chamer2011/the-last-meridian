// The story over the room, in the isometric view. A scene comes up a piece at a time, with what
// someone says on a pane by their head, and what happens over the top of the room for as long as
// it's being read. Clicking anywhere goes on to the next piece. Nothing stays along the bottom: once
// it's all been read, what the player can say hangs off the pane of whoever the story is waiting on,
// as in a talk, and the typing line only comes up when Enter is pressed. A talk comes up the same way.

import { el } from "./dom.js";
import { isoLook, isoSpot } from "./iso.js";
import { paneNode, panesPlacedBy, putPane } from "./pane.js";
import { latestSceneStart, personSpeaking, sceneOf } from "./scene.js";
import { blockNode, optionContent, sceneBlocks, speakerOf, storyEntryNode, thinkingNode, wordNodes } from "./story-view.js";
import { talkPanesNode } from "./talk.js";
import { WRITING_SPEEDS, holdBack, newPen } from "./writer.js";

// How long a note about what's happening stays up.
const NOTE_TIME = 12000;
// How long the line stays up that a saved game is opened with when its story has changed hands. A click dismisses it.
const NEWS_TIME = 60000;
const MOST_NOTES = 4;

// How long the last of what happens stays over the room once it's been read, when nothing else is to come.
const CAPTION_STAYS = 7000;

const pop = { open: false, start: null, at: 0, seen: -1, beats: [], notes: [], posted: 0, said: null, limit: 340, words: null, wordsOn: null, shownNotes: [], paneFor: null, faded: false, fadeTimer: null, fadeFor: null };

// What the popups need from the main screen. Set once, when the page loads.
let app;

const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pen = newPen({
  speed: () => (calm() ? Infinity : WRITING_SPEEDS[app.reading.writing] ?? WRITING_SPEEDS.normal),
  draw: (count) => {
    pop.words?.show(count);
    // Once the last of it is written, what the player can answer comes up beside it. (An answer that led straight to
    // more choices used to leave only the words on screen: the choices came with whatever next redrew the room.)
    if (!pen.busy && pop.open && !document.getElementById("pop-answer") && choicesNow().length) drawScene();
  },
});

export function initPopups(hooks) {
  app = hooks;
  panesPlacedBy(placeAll);
}

export function resetPopups() {
  pen.stop();
  for (const note of pop.shownNotes) clearTimeout(note.timer);
  clearTimeout(pop.fadeTimer);
  Object.assign(pop, { open: false, start: null, at: 0, seen: -1, beats: [], notes: [], posted: 0, said: null, words: null, wordsOn: null, shownNotes: [], paneFor: null, faded: false, fadeTimer: null, fadeFor: null });
}

const living = () => app.ui.streaming && !app.ui.game?.talk;

// ---- Keeping up with the story -------------------------------------------

// As much as fits on a pane by someone's head, going by the size of the room and of the text.
function limitNow() {
  const box = document.getElementById("pops");
  const width = box?.clientWidth || 800;
  const height = box?.clientHeight || 500;
  const size = Math.max(12, app.reading.size - 3);
  const letter = size * 0.6;
  const wide = Math.max(26 * letter, Math.min(width * 0.36, 34 * letter));
  const lines = Math.floor((height * 0.42) / (size * 1.45));
  return Math.max(140, Math.min(420, Math.round(((wide - 22) / letter) * lines * 0.9)));
}

function readScene() {
  const { ui } = app;
  const entries = living() ? ui.liveEntries : ui.game.transcript.slice(pop.start);
  Object.assign(pop, sceneOf(entries, { blocksOf: sceneBlocks, limit: pop.limit, streaming: living() }));
}

// Something already read: after a load, or when the story moved on somewhere else, like in another window.
function pickUpFrom(start) {
  pop.start = start;
  pop.limit = limitNow();
  readScene();
  pop.at = Math.max(0, pop.beats.length - 1);
  pop.seen = pop.at;
  // Everything here has been read before, except a line the game added when this saved game was opened, saying the
  // story has changed hands, with nothing after it yet: that one is news, and it stays up a good while.
  const news = Boolean(app.ui.game.transcript.at(-1)?.turnover);
  pop.posted = news ? Math.max(0, pop.notes.length - 1) : pop.notes.length;
  pop.newsFrom = news ? pop.posted : null;
  pop.open = pop.beats.length > 0;
  pen.start(true);
}

function sync() {
  const { ui } = app;
  const { transcript } = ui.game;
  if (!living()) {
    const latest = latestSceneStart(transcript);
    if (pop.start === null || pop.start > transcript.length || latest > pop.start) pickUpFrom(latest);
    else {
      readScene();
      // A turn that failed leaves nothing to show, so the scene before it is still the one.
      if (!pop.beats.length && !ui.error && latest < pop.start) pickUpFrom(latest);
    }
  } else readScene();
  // Anything the game has to say, it has to be seen saying.
  if (ui.error || ui.consoleLines.length) pop.open = true;
  pop.at = Math.min(pop.at, Math.max(0, pop.beats.length - 1));
  postNotes();
}

// The player's done something, so the next thing the story tells is a new scene.
export function beginScene() {
  pen.stop();
  clearTimeout(pop.fadeTimer);
  Object.assign(pop, { open: true, start: app.ui.game?.transcript.length ?? 0, at: 0, seen: -1, beats: [], notes: [], posted: 0, said: null, limit: limitNow(), words: null, wordsOn: null, faded: false, fadeTimer: null, fadeFor: null });
  pen.start();
}

// ---- What's happening ----------------------------------------------------

function notesNode() {
  const now = Date.now();
  return el("div", { class: "pop-notes", id: "pop-notes" }, pop.shownNotes.map((note) => el("div", {
    class: "pop-note",
    style: `animation-delay:${Math.max(0, note.until - now - 700)}ms`,
    title: "Click to dismiss. This is in the story too.",
    onclick: () => dropNote(note),
  }, storyEntryNode({ role: "notice", text: note.text }))));
}

const drawNotes = () => {
  document.getElementById("pop-notes")?.replaceWith(notesNode());
  placeAll();
};

function dropNote(note) {
  clearTimeout(note.timer);
  pop.shownNotes = pop.shownNotes.filter((one) => one !== note);
  drawNotes();
}

function addNote(text, time = NOTE_TIME) {
  const note = { text, until: Date.now() + time };
  note.timer = setTimeout(() => dropNote(note), time);
  pop.shownNotes.push(note);
  while (pop.shownNotes.length > MOST_NOTES) dropNote(pop.shownNotes[0]);
}

// A note comes up when the reader gets to the piece it goes with, so it doesn't give anything away.
function postNotes() {
  let posted = false;
  while (pop.posted < pop.notes.length && (pop.notes[pop.posted].at <= pop.at || !pop.open)) {
    // The line a saved game was opened with, saying the story has changed hands, stays up much longer than the rest.
    const news = pop.newsFrom !== null && pop.newsFrom !== undefined && pop.posted >= pop.newsFrom;
    addNote(pop.notes[pop.posted].text, news ? NEWS_TIME : NOTE_TIME);
    pop.posted += 1;
    posted = true;
  }
  if (!posted) return;
  pop.newsFrom = null;
  drawNotes();
}

// ---- Going through a scene -----------------------------------------------

const current = () => pop.beats[pop.at] ?? null;

// Whoever's saying this, if they're here to say it over their head. A voice over comms and a machine
// don't have a head to put it over, and neither does anyone who isn't in the room. During a talk the
// talk has the room, and the story's words stay in the window along the bottom.
function speakerHere(beat) {
  const { game } = app.ui;
  if (app.reading.story !== "popups" || beat?.type !== "speech" || beat.voice || game?.talk) return null;
  if (personSpeaking(beat.speaker, [{ name: game.name, short: game.name }])) return { key: "you" };
  return personSpeaking(beat.speaker, game.walk.people);
}

const unread = () => pen.busy || pop.at < pop.beats.length - 1;
// Until it's been read, a click on the room goes on with the story, and doesn't walk anywhere.
export const popupReading = () => pop.open && unread();

function moved() {
  pen.start(pop.at <= pop.seen);
  pop.seen = Math.max(pop.seen, pop.at);
  postNotes();
  drawScene();
}

// The next thing: the rest of what's being said, and then the next piece.
export function popupNext() {
  if (!pop.open) return false;
  if (pen.busy) {
    pen.finish();
    return true;
  }
  if (pop.at < pop.beats.length - 1) {
    pop.at += 1;
    moved();
    return true;
  }
  return false;
}

function popupBack() {
  if (pop.at <= 0) return;
  pop.faded = false;
  pop.fadeFor = null;
  pen.finish();
  pop.at -= 1;
  moved();
}

// A click on the room goes on to the next piece, until the scene's been read, and then it's a walk.
export function popupPressed() {
  return popupReading() ? popupNext() : false;
}

export const popupsOpen = () => pop.open;

export function closePopups() {
  if (!pop.open) return;
  pen.finish();
  pop.open = false;
  isoLook();
  postNotes();
  app.render();
}

export function openPopups() {
  pop.open = true;
  app.render();
}

// ---- Drawing -------------------------------------------------------------

const clickedWords = (event) => {
  if (!event.target.closest("button, a, input, summary, [data-lore]")) popupNext();
};

// What's being said, on a pane by whoever's saying it. It slides out from their head the first time
// it's theirs, and only then, since the pane is drawn again for every piece.
function balloonNode() {
  const beat = current();
  // Once there's something to answer, the pane it hangs off says the last words instead.
  const person = pop.open && !choicesNow().length ? speakerHere(beat) : null;
  if (!person) {
    pop.paneFor = null;
    return null;
  }
  const { color, name, voice } = speakerOf(beat);
  const still = living() && pop.at === pop.beats.length - 1;
  const more = pop.at < pop.beats.length - 1;
  const opening = pop.paneFor !== person.key && !calm();
  pop.paneFor = person.key;
  return paneNode({
    id: "pop-balloon",
    key: person.key,
    color,
    more,
    opening,
    onTap: () => popupNext(),
    tag: [el("span", { class: "pop-tag-name" }, name), voice && el("span", { class: "pop-tag-note" }, voice)],
    body: [
      el("div", { class: "pop-words", id: "pop-writing" }, wordNodes(beat.parts)),
      el("div", { class: "pop-hint" }, `${pop.at + 1} of ${pop.beats.length}${still ? "..." : ""}`, more && el("span", {}, "click to go on")),
    ],
  });
}

// What's in the window along the bottom: this piece, or if this piece is over someone's head, the
// narration it follows from.
function storyWords(beat, overHead) {
  if (!beat) return null;
  if (overHead) {
    for (let i = pop.at - 1; i >= 0; i -= 1) if (pop.beats[i].type === "narration") return el("div", { class: "pop-before" }, blockNode(pop.beats[i]));
    return null;
  }
  const node = blockNode(beat);
  if (beat.type === "speech") node.querySelector(".speech-body").id = "pop-writing";
  if (beat.type !== "speech" && living() && pop.at === pop.beats.length - 1) node.append(el("span", { class: "cursor", "aria-hidden": "true" }));
  return node;
}

// What happens, over the top of the room: the piece being read when it isn't on a pane by someone's head, words from
// someone who isn't here to have one, and what the game has to say. It goes once it's been read: as soon as the reader
// goes on, and a little after the last piece, so nothing of the story stays in the way.
function captionNode() {
  const { ui } = app;
  const beat = current();
  const overHead = Boolean(speakerHere(beat));
  const waiting = living() && (!beat || (pop.at === pop.beats.length - 1 && overHead));
  const said = ui.error || ui.consoleLines.length;
  const words = pop.open && beat && !overHead && !(pop.faded && atEnd()) ? storyWords(beat, false) : null;
  if (!said && !words && !(pop.open && waiting)) return null;
  const count = pop.beats.length;
  return el("section", { class: `pop-caption${pop.at < count - 1 ? " more" : ""}`, id: "pop-story", onclick: clickedWords },
    el("div", { class: "pop-words", "data-scrolls": "1" },
      ui.consoleLines.map((entry) => storyEntryNode(entry)),
      ui.error && el("div", { class: "entry error" }, ui.error.message,
        el("div", { class: "row", style: "margin-top:8px" },
          el("button", { onclick: app.retry }, "Try again"))),
      pop.said && pop.at === 0 && words && el("div", { class: "pop-said" }, `> ${pop.said}`),
      words,
      pop.open && waiting && thinkingNode()),
    words && count > 1 && el("div", { class: "pop-hint" },
      el("span", {}, `${pop.at + 1} of ${count}`),
      pop.at > 0 && el("button", { class: "pop-back", onclick: (event) => { event.stopPropagation(); popupBack(); } }, "Back"),
      pop.at < count - 1 && el("span", {}, "click to go on")));
}

// Whether the whole scene has been read, words and all.
const atEnd = () => !living() && !pen.busy && pop.at >= pop.beats.length - 1;

// The last of what happens goes a little after it's been read, unless the reader goes back to it.
function fadeLater() {
  const key = `${pop.start}:${pop.beats.length}`;
  if (!pop.open || !atEnd() || pop.fadeFor === key) return;
  pop.fadeFor = key;
  clearTimeout(pop.fadeTimer);
  pop.fadeTimer = setTimeout(() => {
    pop.faded = true;
    drawScene();
  }, CAPTION_STAYS);
}

// ---- What the player can say, hanging off a pane ---------------------------------------------------------

// What the player can say or do, once the scene's all been read: off the pane of whoever the story is waiting on, or of
// the last of the people here who spoke, or of the player when nobody did.
const choicesNow = () => (pop.open && atEnd() ? app.options?.() ?? [] : []);

function answerFor() {
  const { game } = app.ui;
  const people = game.walk?.people ?? [];
  if (game.scene?.with && !game.scene.held) {
    const person = people.find((one) => one.key === game.scene.with);
    if (person) return { key: person.key, name: person.name, color: person.color };
  }
  for (let i = pop.beats.length - 1; i >= 0; i -= 1) {
    const beat = pop.beats[i];
    if (beat.type !== "speech" || beat.voice) continue;
    const person = personSpeaking(beat.speaker, people);
    if (person) return { key: person.key, name: person.name, color: person.color };
  }
  return { key: "you", name: game.name, color: "var(--text)" };
}

// What they last said in the scene, to answer.
function lastWordsOf(key) {
  const people = app.ui.game.walk?.people ?? [];
  for (let i = pop.beats.length - 1; i >= 0; i -= 1) {
    const beat = pop.beats[i];
    if (beat.type === "speech" && !beat.voice && personSpeaking(beat.speaker, people)?.key === key) return beat;
  }
  return null;
}

const cornerNodes = () => ["tl", "tr", "bl", "br"].map((corner) => el("span", { class: `pop-corner ${corner}`, "aria-hidden": "true" }));

function answerNode() {
  const options = choicesNow();
  if (!options.length) return null;
  const anchor = answerFor();
  const said = anchor.key === "you" ? null : lastWordsOf(anchor.key);
  const yours = anchor.key === "you";
  return paneNode({
    id: "pop-answer",
    key: anchor.key,
    color: anchor.color,
    className: "pop-talk",
    tag: el("span", { class: "pop-tag-name" }, yours ? "You" : anchor.name),
    body: el("div", { class: "pop-words" }, said ? wordNodes(said.parts) : el("div", { class: "pop-before" }, yours ? "What do you do?" : "")),
    extras: el("div", { class: "pop-choices in", id: "story-choices" },
      cornerNodes(),
      el("div", { class: "pop-tag" }, yours ? "What do you do?" : "What do you say?"),
      el("div", { class: "options" }, options.map((option, i) => el("button", { "data-choice": String(i + 1), disabled: option.disabled, onclick: option.run },
        el("span", { class: "option-number" }, `${i + 1})`), optionContent(option)))),
      el("div", { class: "pop-choices-foot" }, el("span", {}, "Click one, or press its number."))),
  });
}

// Where a pane by someone's head goes: up and to their right, with its corner a hand from the head,
// or up and to their left when the right has no room, and always on the screen, out from under the
// clock and the notes. This runs each time the room's drawn, so it stays with them as they move, and
// again while it's being pulled aside or sliding back. A pane with nobody to belong to, which a talk
// can be when the room can't show the person, goes in the middle.
function placePane(node, key, { choices = false, anywhere = false } = {}) {
  const box = document.getElementById("pops");
  if (!node || !box) return;
  const spot = key ? isoSpot(key) : null;
  if (!spot && !anywhere) {
    node.classList.remove("placed");
    return;
  }
  const row = document.getElementById("pop-row");
  const notes = document.getElementById("pop-notes");
  const clock = document.getElementById("walk-clock");
  // The quest tracker in the corner is in the way too, when it's small: open, it's a window of its own over the room.
  const tracker = document.querySelector(".walk-map > #quest-tracker:not([hidden]):not(.open)");
  const pane = node.querySelector(".pop-pane");
  if (pane) pane.style.maxHeight = "";
  const width = box.clientWidth - hereCover(box);
  const floor = box.clientHeight - (row?.offsetHeight ?? 0) - 12;
  const wide = node.offsetWidth;
  const head = spot ? { x: spot.x + spot.w / 2, y: spot.y + 2 } : { x: width / 2, y: floor / 2 };
  // Your own pane goes on the side away from theirs, since you're standing right beside them.
  const theirs = node.id === "pop-you" ? paneCalled("talk")?.placedAt ?? null : null;
  let side = theirs && theirs.left + theirs.wide / 2 > head.x ? "left" : "right";
  let left = side === "right" ? head.x + 28 : head.x - 28 - wide;
  if (side === "right" && left + wide > width - 6) {
    side = "left";
    left = head.x - 28 - wide;
  } else if (side === "left" && left < 6) {
    side = "right";
    left = head.x + 28;
  }
  left = Math.max(6, Math.min(width - wide - 6, left));
  // It stays out from under the clock and the notes, which are at the top. So does a talk's list of what to say, which
  // can hang beside the pane, under whatever's over the room where it hangs.
  const underFrom = (other, from, to) => (other && other.offsetHeight && to > other.offsetLeft && from < other.offsetLeft + other.offsetWidth ? other.offsetTop + other.offsetHeight + 5 : 6);
  const under = (other) => underFrom(other, left, left + wide);
  const roofFor = (from, to) => Math.max(underFrom(clock, from, to), underFrom(notes, from, to), underFrom(tracker, from, to));
  let tall = node.offsetHeight;
  let roof = Math.max(under(clock), under(notes), under(tracker));
  // The words come first. When the room's too short for them under the notes, the notes step aside until the words
  // have gone, and when it's too short even for that, the pane shrinks and its words scroll, so it never runs into
  // the story below.
  if (node.id !== "pop-you") {
    const covering = floor - roof < tall && under(notes) > under(clock);
    if (covering) roof = under(clock);
    notes?.classList.toggle("covered", covering);
  }
  if (floor - roof < tall && pane) {
    pane.style.maxHeight = `${Math.max(60, floor - roof)}px`;
    tall = node.offsetHeight;
  }
  let top = Math.max(roof, Math.min(floor - tall, head.y - 16 - tall));
  // And it keeps clear of their words: under your feet, if over your head would cover them.
  if (theirs && spot) {
    const crosses = (at) => left < theirs.left + theirs.wide && left + wide > theirs.left && at < theirs.top + theirs.tall && at + tall > theirs.top;
    const below = spot.y + spot.h + 12;
    if (crosses(top) && !crosses(below) && below + tall <= floor) top = below;
  }
  putPane(node, box, { left, top, wide, tall, side }, spot ? { x: head.x, y: top > head.y ? spot.y + spot.h + 3 : head.y - 5 } : null);
  if (choices) placeChoices(node, { left, top, wide, tall, width, floor, roofFor });
  node.classList.add("placed");
}

// The room's own panel floats over the right side of the room while it's open: the panes keep to the left of it.
function hereCover(box) {
  const here = document.getElementById("walk-here");
  if (!here || here.classList.contains("folded") || getComputedStyle(here).position !== "absolute") return 0;
  return Math.max(0, box.clientWidth - here.offsetLeft + 6);
}

// A talk's choices hang off the pane, on whichever side has the room, or under it, or over it, when
// neither side has. They line up with the top of the pane, stay out from under the clock, the notes and the tracker
// where they hang, never go past the floor, and when there are more than the room has height for, the list scrolls.
function placeChoices(node, { left, top, wide, tall, width, floor, roofFor }) {
  const panel = node.querySelector(".pop-choices");
  if (!panel) return;
  const paneRoof = roofFor(left, left + wide);
  panel.style.maxHeight = `${Math.max(80, floor - paneRoof - 12)}px`;
  const panelWide = panel.offsetWidth;
  let panelTall = panel.offsetHeight;
  let where = left + wide + 12 + panelWide <= width - 6 ? "at-right" : left - 12 - panelWide >= 6 ? "at-left" : "below";
  if (where === "below" && top + tall + 12 + panelTall > floor && top - panelTall - 12 >= paneRoof) where = "above";
  for (const one of ["at-right", "at-left", "below", "above"]) panel.classList.toggle(one, one === where);
  const from = where === "at-right" ? left + wide + 12 : where === "at-left" ? left - 12 - panelWide : left;
  const roof = Math.max(paneRoof, roofFor(from, from + panelWide));
  if (roof > paneRoof) {
    panel.style.maxHeight = `${Math.max(80, floor - roof - 12)}px`;
    panelTall = panel.offsetHeight;
  }
  const start = where === "below" ? tall + 12 : where === "above" ? -panelTall - 12 : 0;
  panel.style.top = `${Math.round(Math.max(roof - top, Math.min(start, floor - top - panelTall)))}px`;
}

// A pane is only placed when it's one of ours, and not the talk's own window in another view.
const paneCalled = (id) => {
  const node = document.getElementById(id);
  return node?.classList.contains("pop-balloon") ? node : null;
};

// The notes at the top left keep out from under the story's words over the room. With a quest tracker in the corner
// they're under it and the words are beside it; with none (a game with no quest yet) they'd be at the top, right where
// the words go, so they go under the words instead, for as long as the words are there.
function placeNotes() {
  const notes = document.getElementById("pop-notes");
  if (!notes) return;
  notes.style.top = "";
  const caption = document.getElementById("pop-story");
  if (!caption?.offsetHeight || !notes.offsetHeight) return;
  const a = notes.getBoundingClientRect();
  const b = caption.getBoundingClientRect();
  if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) notes.style.top = `${notes.offsetTop + (b.bottom - a.top) + 6}px`;
}

function placeAll() {
  const { game } = app.ui;
  placeNotes();
  placePane(paneCalled("pop-balloon"), speakerHere(current())?.key ?? null);
  placePane(paneCalled("pop-answer"), document.getElementById("pop-answer")?.dataset.key ?? null, { choices: true, anywhere: true });
  placePane(paneCalled("talk"), game?.talk?.key ?? null, { choices: true, anywhere: true });
  placePane(paneCalled("pop-you"), "you");
}

export const popupDrawn = placeAll;

// Puts the words in the window that's writing them, picks up the writing where it was, and tells
// the camera who to keep in view and how much of the room the windows are covering.
function settle() {
  const writing = pop.open ? document.getElementById("pop-writing") : null;
  if (writing !== pop.wordsOn) {
    pop.words = writing ? holdBack(writing) : null;
    pop.wordsOn = writing;
  }
  if (pop.words) pen.aim(pop.words.total);
  const beat = current();
  const row = document.getElementById("pop-row");
  // The camera keeps whoever's talking in view: the person in a talk, whoever the story has speaking, or whoever the
  // player has to answer.
  const talking = app.ui.game?.talk?.key ?? null;
  const answering = document.getElementById("pop-answer")?.dataset.key ?? null;
  isoLook({ person: talking ?? (pop.open ? speakerHere(beat)?.key ?? (answering !== "you" ? answering : null) : null), bottom: row?.offsetHeight ? row.offsetHeight + 12 : 0 });
  placeAll();
  fadeLater();
}

function drawScene() {
  const root = document.getElementById("pops");
  if (!root) return;
  root.classList.toggle("pop-open", pop.open);
  document.getElementById("pop-balloon")?.remove();
  const balloon = balloonNode();
  if (balloon) root.prepend(balloon);
  document.getElementById("pop-answer")?.remove();
  const answer = answerNode();
  if (answer) root.prepend(answer);
  document.getElementById("pop-story")?.remove();
  const caption = captionNode();
  if (caption) root.append(caption);
  document.getElementById("pop-waiting")?.remove();
  const waiting = waitingChip();
  if (waiting) root.append(waiting);
  settle();
}

// With the story put away and something waiting to be answered, one small line at the top brings it back.
function waitingChip() {
  if (pop.open || app.ui.streaming || !app.options?.().length) return null;
  return el("button", { class: "pop-waiting", id: "pop-waiting", onclick: openPopups, title: "Or click whoever it's waiting on" }, "The story is waiting for you");
}

// As the story's words arrive.
export function updatePopups() {
  if (!document.getElementById("pops")) return;
  sync();
  drawScene();
}

// Call this once the screen's been drawn, so the windows can be measured.
export function popupsAttached() {
  if (document.getElementById("pops")) settle();
  else isoLook();
}

export function popsNode(legend, clock) {
  // This comes first, because what's on the typing line depends on whether the story's open.
  sync();
  return el("div", { class: `pops${pop.open ? " pop-open" : ""}`, id: "pops" },
    answerNode(),
    balloonNode(),
    talkPanesNode(),
    notesNode(),
    captionNode(),
    waitingChip(),
    legend,
    clock,
    // Nothing sits along the bottom of the room any more: the choices hang off whoever's answered, and the story
    // starts by itself. The row stays, empty, for what measures it.
    el("div", { class: "pop-row", id: "pop-row" }));
}
