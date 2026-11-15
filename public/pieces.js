// The Pieces window: every picture in the two bought pixel-art packs, gathered into pieces and sorted by where each
// belongs on a ship, with a tick on the ones that go on her. It opens from the Map editor. A click on a piece ticks it
// or unticks it; its [+] shows all its pictures and moves it to another place. The game keeps it all in
// world/pieces.txt (src/pieces.js). It's step 1 of the map's rework: nothing on the decks reads the ticks yet.
//
// The pictures come from licensed/, which only the owner's computer has, so anywhere else the window says so.

import { el } from "./dom.js";

const state = {
  data: null, place: "bridge", show: "all", pack: "both",
  open: null, // the piece whose pictures are laid out along the bottom
  waiting: new Map(), timer: 0, sending: false, undo: [], watcher: null,
};
const $ = (id) => document.getElementById(id);
const SHOWS = [["all", "All"], ["on", "On the ship"], ["off", "Left out"]];
const PACK_WORDS = { both: "Both packs", isospace: "Space Station", interiors: "Interiors" };
// How long a change waits for the next one before it's sent, so a run of clicks is saved together.
const SAVE_AFTER = 450;

// ---- Pictures ---------------------------------------------------------------------------------------------------

// A pack's folders have spaces and brackets in their names.
const urlOf = (file) => `licensed/${file.split("/").map(encodeURIComponent).join("/")}`;
const images = new Map();
function imageOf(file) {
  if (!images.has(file)) {
    images.set(file, new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = urlOf(file);
    }));
  }
  return images.get(file);
}

// The part of a picture with anything in it. The packs leave room round what they draw, and a fork in the middle of
// an empty square would be too small to see.
const boxes = new Map();
let scratch = null;
function boxOf(image, picture) {
  const key = `${picture.file}|${picture.x ?? ""}|${picture.y ?? ""}`;
  if (boxes.has(key)) return boxes.get(key);
  const cell = picture.x !== undefined;
  const from = { x: cell ? picture.x : 0, y: cell ? picture.y : 0, w: cell ? picture.w : image.naturalWidth, h: cell ? picture.h : image.naturalHeight };
  let box = from;
  try {
    scratch ??= document.createElement("canvas");
    scratch.width = from.w;
    scratch.height = from.h;
    const ctx = scratch.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, from.w, from.h);
    ctx.drawImage(image, from.x, from.y, from.w, from.h, 0, 0, from.w, from.h);
    const data = ctx.getImageData(0, 0, from.w, from.h).data;
    let left = from.w, top = from.h, right = -1, bottom = -1;
    for (let y = 0; y < from.h; y += 1) {
      for (let x = 0; x < from.w; x += 1) {
        if (data[(y * from.w + x) * 4 + 3] < 8) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (right >= left) box = { x: from.x + left, y: from.y + top, w: right - left + 1, h: bottom - top + 1 };
  } catch {
    box = from;
  }
  boxes.set(key, box);
  return box;
}

// Draws a picture in its square: whole pixels when there's room to make it bigger (three times at most), and shrunk
// to fit when it's bigger than the square.
async function paint(canvas, picture) {
  const image = await imageOf(picture.file);
  if (!canvas.isConnected) return;
  if (!image) {
    canvas.classList.add("pieces-lost");
    return;
  }
  const box = boxOf(image, picture);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  const edge = Math.round(4 * ratio);
  const fit = Math.min((canvas.width - edge * 2) / box.w, (canvas.height - edge * 2) / box.h);
  const scale = fit >= 1 ? Math.min(Math.floor(fit), Math.max(1, Math.floor(3 * ratio))) : fit;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = scale < 1;
  const w = Math.round(box.w * scale);
  const h = Math.round(box.h * scale);
  ctx.drawImage(image, box.x, box.y, box.w, box.h, Math.round((canvas.width - w) / 2), Math.round((canvas.height - h) / 2), w, h);
  canvas.classList.add("pieces-drawn");
}

// A picture is only fetched and drawn once its square has come into sight.
const pending = new WeakMap();
function watch(canvas, picture) {
  pending.set(canvas, picture);
  if (!state.watcher) {
    state.watcher = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        state.watcher.unobserve(entry.target);
        const wanted = pending.get(entry.target);
        if (wanted) paint(entry.target, wanted);
      }
    }, { rootMargin: "400px" });
  }
  state.watcher.observe(canvas);
}
function pictureBox(picture, words) {
  const canvas = el("canvas", { class: "pieces-picture", role: "img", "aria-label": words });
  watch(canvas, picture);
  return canvas;
}

// ---- Talking to the game ---------------------------------------------------------------------------------------

async function load() {
  const response = await fetch("/api/pieces");
  if (response.status === 404) throw new Error("The game that's running was started before this window existed. Close the game and open it again, and the pieces will be here.");
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

// Sends what's been changed since the last time. Each piece is sent as it is now, so a tick put back before it was
// sent costs nothing.
async function send() {
  clearTimeout(state.timer);
  state.timer = 0;
  if (state.sending || !state.waiting.size) return;
  const set = [...state.waiting.values()];
  state.waiting.clear();
  state.sending = true;
  try {
    const response = await fetch("/api/pieces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ set }) });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error ?? "Something went wrong.");
    state.data.saved = true;
    say(`Saved. ${result.on} of ${result.of} pieces are on the ship.`);
  } catch (err) {
    say(`That wasn't saved: ${err.message}`, false);
    try {
      state.data = await load();
      state.undo = [];
      draw();
    } catch {
      // The line above already says what went wrong.
    }
  }
  state.sending = false;
  if (state.waiting.size) send();
}

function later(piece) {
  state.waiting.set(piece.id, { id: piece.id, on: piece.on, place: piece.place });
  clearTimeout(state.timer);
  state.timer = setTimeout(send, SAVE_AFTER);
}

// ---- What's shown, and changing it --------------------------------------------------------------------------------

const inPack = (piece) => state.pack === "both" || piece.pack === state.pack;
const shown = (piece) => inPack(piece) && (state.show === "all" || (state.show === "on") === piece.on);
const piecesOf = (place) => state.data.pieces.filter((piece) => (place === "all" || piece.place === place) && inPack(piece));
const tally = (list) => `${list.filter((piece) => piece.on).length} of ${list.length}`;
const placeName = (id) => state.data.places.find((place) => place.id === id)?.name ?? id;

// Changes pieces, remembers how they were for Undo, and has the change sent.
function change(pieces, how) {
  const before = pieces.map((piece) => ({ id: piece.id, on: piece.on, place: piece.place }));
  for (const piece of pieces) how(piece);
  const moved = pieces.filter((piece, i) => piece.on !== before[i].on || piece.place !== before[i].place);
  if (!moved.length) return false;
  state.undo.push(before);
  if (state.undo.length > 60) state.undo.shift();
  for (const piece of moved) later(piece);
  return true;
}

function toggle(piece) {
  change([piece], (one) => { one.on = !one.on; });
  redrawCard(piece);
  drawCounts();
  if (state.open === piece) drawOpen();
  say(piece.on ? `${piece.name}: on the ship.` : `${piece.name}: left out.`);
}

function setAll(place, on) {
  const list = piecesOf(place).filter(shown);
  if (!change(list, (one) => { one.on = on; })) return;
  draw();
  say(on ? `Everything shown under ${placeName(place)} is on the ship. Undo takes it back.` : `Everything shown under ${placeName(place)} is left out. Undo takes it back.`);
}

function move(piece, place) {
  if (!change([piece], (one) => { one.place = place; })) return;
  draw();
  say(`${piece.name} now belongs under ${placeName(place)}.`);
}

function undo() {
  const before = state.undo.pop();
  if (!before) return;
  const byId = new Map(state.data.pieces.map((piece) => [piece.id, piece]));
  for (const was of before) {
    const piece = byId.get(was.id);
    if (!piece) continue;
    piece.on = was.on;
    piece.place = was.place;
    later(piece);
  }
  draw();
  say(before.length === 1 ? "Taken back." : `Taken back: ${before.length} pieces are as they were.`);
}

// ---- Drawing the window -----------------------------------------------------------------------------------------

function button(words, props = {}, on = null) {
  return el("button", { type: "button", ...(on === null ? {} : { "aria-pressed": on ? "true" : "false" }), ...props }, words);
}

function say(words, ok = true) {
  const line = $("pieces-says");
  if (!line) return;
  line.textContent = words;
  line.className = `pieces-says ${ok ? "ok" : "bad"}`;
}

const countWords = (piece) => (piece.missing ? "" : piece.pictures.length > 1 ? `${piece.pictures.length} pictures` : "");

function card(piece) {
  const first = piece.pictures[0];
  return el("div", { class: `pieces-card ${piece.on ? "on" : "off"}`, "data-piece": piece.id },
    el("button", { type: "button", class: "pieces-pick", "aria-pressed": piece.on ? "true" : "false", title: piece.on ? "On the ship. Click to leave it out" : "Left out. Click to put it on the ship", onclick: () => toggle(piece) },
      first ? pictureBox(first, piece.name) : el("span", { class: "pieces-picture pieces-none" }, "Its pictures aren't on this computer"),
      el("span", { class: "pieces-tick", "aria-hidden": "true" }, piece.on ? "[x]" : "[ ]"),
      el("span", { class: "pieces-name" }, piece.name),
      el("span", { class: "pieces-count" }, countWords(piece))),
    el("button", { type: "button", class: "pieces-more", title: "All its pictures, and where it belongs", "aria-label": `More about ${piece.name}`, onclick: () => openPiece(piece) }, "+"));
}

function redrawCard(piece) {
  const old = document.querySelector(`#pieces-grid [data-piece="${CSS.escape(piece.id)}"]`);
  if (!old) return;
  if (!shown(piece)) {
    // It no longer fits what's being shown (only what's on the ship, say), so it goes, and its heading's count with it.
    drawGrid();
    return;
  }
  old.replaceWith(card(piece));
}

function section(place) {
  const all = piecesOf(place.id);
  const list = all.filter(shown);
  if (!all.length) return null;
  return el("section", { class: "pieces-section", "data-place": place.id },
    el("header", { class: "pieces-section-head" },
      el("h3", {}, place.name),
      el("span", { class: "pieces-tally" }, `${tally(all)} on the ship`),
      button("All on", { title: "Put everything shown here on the ship", disabled: !list.some((piece) => !piece.on), onclick: () => setAll(place.id, true) }),
      button("All off", { title: "Leave out everything shown here", disabled: !list.some((piece) => piece.on), onclick: () => setAll(place.id, false) })),
    list.length ? el("div", { class: "pieces-cards" }, list.map(card)) : el("p", { class: "pieces-empty" }, state.show === "on" ? "Nothing here is on the ship." : "Nothing here is left out."));
}

function drawGrid() {
  const grid = $("pieces-grid");
  if (!grid || !state.data) return;
  const at = grid.scrollTop;
  state.watcher?.disconnect();
  const places = state.data.places.filter((place) => state.place === "all" || place.id === state.place);
  const parts = places.map(section).filter(Boolean);
  grid.replaceChildren(...(parts.length ? parts : [el("p", { class: "pieces-empty" }, nothingWords())]));
  grid.scrollTop = at;
}

function nothingWords() {
  const { packs } = state.data;
  if (!state.data.pieces.length) return "The two bought packs aren't on this computer, so there's nothing to show. Their pictures go in the game's folder, under licensed.";
  if (state.pack !== "both" && !packs[state.pack]) return "That pack isn't on this computer.";
  return "Nothing here.";
}

function drawCounts() {
  if (!state.data) return;
  const all = state.data.pieces.filter(inPack);
  $("pieces-total").textContent = `${tally(all)} pieces on the ship`;
  $("pieces-undo").disabled = !state.undo.length;
  $("pieces-places").replaceChildren(
    button(["Everything ", el("span", { class: "pieces-n" }, tally(all))], { onclick: () => choosePlace("all") }, state.place === "all"),
    ...state.data.places.map((place) => {
      const here = piecesOf(place.id);
      return button([`${place.name} `, el("span", { class: "pieces-n" }, tally(here))], { onclick: () => choosePlace(place.id), disabled: !here.length }, state.place === place.id);
    }));
  for (const head of document.querySelectorAll("#pieces-grid .pieces-section")) {
    const here = piecesOf(head.dataset.place);
    const list = here.filter(shown);
    head.querySelector(".pieces-tally").textContent = `${tally(here)} on the ship`;
    const [allOn, allOff] = head.querySelectorAll(".pieces-section-head button");
    allOn.disabled = !list.some((piece) => !piece.on);
    allOff.disabled = !list.some((piece) => piece.on);
  }
}

function drawFilters() {
  $("pieces-show").replaceChildren(...SHOWS.map(([id, words]) => button(words, { onclick: () => { state.show = id; draw(); } }, state.show === id)));
  $("pieces-packs").replaceChildren(...Object.entries(PACK_WORDS).map(([id, words]) => button(words, { onclick: () => { state.pack = id; draw(); } }, state.pack === id)));
}

function choosePlace(place) {
  state.place = place;
  const grid = $("pieces-grid");
  if (grid) grid.scrollTop = 0;
  draw();
}

// One piece laid out along the bottom: every picture it has, whether it's on the ship, and where it belongs.
function openPiece(piece) {
  state.open = state.open === piece ? null : piece;
  drawOpen();
}

function drawOpen() {
  const box = $("pieces-open");
  if (!box) return;
  const piece = state.open && state.data?.pieces.includes(state.open) ? state.open : null;
  state.open = piece;
  box.hidden = !piece;
  if (!piece) {
    box.replaceChildren();
    return;
  }
  const where = piece.id.split("/").slice(1).join(" / ");
  box.replaceChildren(
    el("header", { class: "pieces-open-head" },
      el("h3", {}, piece.name),
      button(piece.on ? "On the ship" : "Left out", { class: "pieces-state", title: piece.on ? "Click to leave it out" : "Click to put it on the ship", onclick: () => toggle(piece) }, piece.on),
      el("span", { class: "pieces-from" }, `${state.data.packNames[piece.pack] ?? piece.pack}: ${where}`),
      button("Close", { class: "pieces-shut", onclick: () => openPiece(piece) })),
    el("div", { class: "pieces-belongs" },
      el("span", { class: "pieces-label" }, "Belongs under:"),
      state.data.places.map((place) => button(place.name, { onclick: () => move(piece, place.id) }, piece.place === place.id))),
    piece.pictures.length
      ? el("div", { class: "pieces-all", id: "pieces-all" }, piece.pictures.map((picture, i) => pictureBox(picture, `${piece.name}, picture ${i + 1}`)))
      : el("p", { class: "pieces-empty" }, "Its pictures aren't on this computer."));
}

function draw() {
  if (!$("pieces") || !state.data) return;
  drawFilters();
  drawGrid();
  drawCounts();
  drawOpen();
}

function frame() {
  return el("div", { class: "pieces", id: "pieces", role: "dialog", "aria-label": "Pieces" },
    el("header", { class: "pieces-head" },
      el("h2", {}, "Pieces"),
      el("span", { class: "pieces-total", id: "pieces-total" }),
      el("div", { class: "pieces-row", id: "pieces-show" }),
      el("div", { class: "pieces-row", id: "pieces-packs" }),
      el("div", { class: "pieces-row pieces-end" },
        button("Undo", { id: "pieces-undo", title: "Take the last change back", disabled: true, onclick: undo }),
        button("Close", { onclick: closePieces }))),
    el("div", { class: "pieces-says", id: "pieces-says", role: "status" }),
    el("div", { class: "pieces-body" },
      el("nav", { class: "pieces-places", id: "pieces-places", "aria-label": "Where on the ship" }),
      el("div", { class: "pieces-grid", id: "pieces-grid" })),
    el("section", { class: "pieces-open", id: "pieces-open", hidden: "" }));
}

// While the window is open the keys are its own: nothing behind it walks, opens or closes, and Escape shuts what's
// laid out along the bottom first, then the window.
function onKey(event) {
  if (!$("pieces")) return;
  event.stopPropagation();
  if (event.key !== "Escape") return;
  if (state.open) openPiece(state.open);
  else closePieces();
}

export async function openPieces() {
  if ($("pieces")) return;
  document.body.append(frame());
  // Before the Map editor's own, which would close the editor underneath.
  document.addEventListener("keydown", onKey, true);
  // For the browser checks, which look at the window's state from outside.
  window.__pieces = state;
  say("Reading the packs...");
  try {
    state.data = await load();
    state.open = null;
    state.undo = [];
    if (state.place !== "all" && !piecesOf(state.place).length) state.place = "all";
    draw();
    const problems = state.data.problems.length ? ` ${state.data.problems.length === 1 ? "One line" : `${state.data.problems.length} lines`} of world/pieces.txt couldn't be read.` : "";
    if (!state.data.pieces.length) say("");
    else if (state.data.saved) say(`A click on a piece puts it on the ship or leaves it out.${problems}`, !problems);
    else say("The first ticks are a guess at what suits the ship. A click on a piece puts it on the ship or leaves it out.");
  } catch (err) {
    say(err.message, false);
  }
}

export function closePieces() {
  send();
  state.watcher?.disconnect();
  state.watcher = null;
  $("pieces")?.remove();
  document.removeEventListener("keydown", onKey, true);
}
