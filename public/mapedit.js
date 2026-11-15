// The map editor: a deck of the ship seen from straight above, to redraw by clicking. Floors, walls, doors and
// furniture are painted on its squares; rooms are rectangles drawn round parts of it, with a name and a few words;
// things are put down, named and described; people, stairs and the spots people's days send them to are dragged to
// where they should be. Nothing is typed but names and words.
//
// The page only draws and gathers the change. The game does the rest (src/map-editor.js): it tries the deck out
// against everything else that depends on it before keeping it, keeps the file that was there, and reads the new deck
// by itself, so the room behind this window is redrawn as soon as it's saved.
//
// A square is half as wide as it's deep, as in the game's own plan of a room, so the deck here has the proportions it
// has in play.

import { el } from "./dom.js";
import { FACINGS, FACING_WORDS, FURNITURE, FURNITURE_BY_ID, footprintOf, looksOf, squaresOf } from "./furniture.js";
import { openPieces, pieceThumb } from "./pieces.js";
import { asPixelArt, loadPack, onPixelArt, pixelArtFound } from "./pixel-art.js";
import { drawPreview, previewSquare } from "./iso.js";

const state = {
  maps: [], place: null, level: null, doc: null, cells: [],
  tool: "select", paint: "wall", shape: "brush", piece: "chair",
  selected: null, hover: null, drag: null,
  zoom: 7, show: { rooms: true, spots: false },
  undo: [], redo: [], dirty: false, busy: false,
  result: null, flash: null, onClose: null,
  // The picture of the room beside the plan: whether it's shown, the deck as the game last described it (view) and
  // which telling that was (version), the square it looks at, what went wrong if the game couldn't describe the deck,
  // and whether the game that's running is too old to.
  look: { on: true, view: null, version: 0, asked: 0, timer: 0, frame: 0, again: 0, at: null, wrong: null, old: false, unhear: null },
};
const $ = (id) => document.getElementById(id);
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

// What each mark is called and drawn as, seen from above.
const LOOKS = [
  ["#", "Wall", "#9aa39c"], ["+", "Door", "#f2c14e"], ["=^<>(){}&", "Console", "#3fb7b0"], ["[]", "Crate", "#b58a52"],
  ["|/\\", "Locker", "#8a6f4e"], ["\"", "Plant bed", "#5fae5a"], ["!", "Lamp", "#ffe08a"], ["%", "Rubble", "#6d6258"],
];
const FLOOR_COLORS = ["#17281f", "#12222e", "#241f2c"];
function lookOf(ch) {
  const doc = state.doc;
  if (ch === " ") return { name: "Open space", color: null };
  const floor = doc.floors.indexOf(ch);
  if (floor >= 0) return { name: floor === 0 ? "Floor" : ch === "~" ? "Crawlway" : "Floor", color: FLOOR_COLORS[floor % FLOOR_COLORS.length], floor: true };
  for (const [marks, name, color] of LOOKS) if (marks.includes(ch)) return { name, color };
  return { name: "Bench", color: "#6f7f77" };
}

// ---- Talking to the game ---------------------------------------------------------------------------------------

async function call(route, body) {
  const response = await fetch(route, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

// ---- The picture of the room, beside the plan --------------------------------------------------------------------
// The deck as it is here, unsaved, drawn the way the game will show it (public/iso.js, drawPreview), in the bought
// packs' pictures whatever view the game is in. A moment after each change the game is asked to describe the deck
// afresh (src/map-editor.js, deckLook), which saves nothing, and the picture is drawn from that, looking at the square
// last clicked on the plan, with a ring round the square the mouse is over.

const LOOK_KEPT = "meridian-mapedit-look";

// Asks for the deck's description soon: once for however many changes come before it's sent.
function lookSoon(wait = 160) {
  const { look } = state;
  if (!state.doc || !look.on || look.old || look.timer) return;
  look.timer = setTimeout(askLook, wait);
}

async function askLook() {
  const { look } = state;
  look.timer = 0;
  if (!state.doc || !look.on || !$("mapedit")) return;
  look.asked += 1;
  const asked = look.asked;
  try {
    const response = await fetch(`/api/maplook/${state.place}/${state.level}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doc: parcel() }) });
    if (asked !== look.asked) return;
    if (response.status === 404) {
      // A game started before the picture existed: it stays the plan alone until the game's opened again.
      look.old = true;
      drawLook();
      return;
    }
    const data = await response.json();
    if (asked !== look.asked) return;
    if (!response.ok || !data.look) throw new Error(data.error ?? "Something went wrong.");
    Object.assign(look, { view: data.look, version: look.version + 1, wrong: null });
  } catch (err) {
    if (asked !== look.asked) return;
    look.wrong = err.message;
  }
  drawLook();
}

// What's said under the picture: only when something's amiss.
function lookWords() {
  const { look } = state;
  if (look.old) return "The game that's running was started before this picture existed. Close the game and open it again, and the room will be drawn here.";
  if (look.wrong) return `${look.wrong} The picture is of the deck as it was before that.`;
  if (pixelArtFound() === false) return "The bought packs aren't on this computer, so this is the game's own drawing.";
  return "";
}

// Draws the picture from the description in hand. The tiles of it that aren't drawn yet take a few frames.
function drawLook() {
  const { look } = state;
  cancelAnimationFrame(look.frame);
  look.frame = 0;
  const box = $("mapedit-look");
  const canvas = $("mapedit-look-canvas");
  if (!box || !canvas) return;
  box.hidden = !look.on;
  $("mapedit-middle")?.classList.toggle("with-look", look.on);
  const toggle = $("mapedit-look-toggle");
  if (toggle) toggle.setAttribute("aria-pressed", look.on ? "true" : "false");
  if (!look.on) return;
  $("mapedit-look-says").textContent = lookWords();
  if (!look.view || look.old) return;
  const ring = state.hover && inDeck(state.hover.x, state.hover.y) ? state.hover : null;
  const whole = asPixelArt(() => drawPreview(canvas, look.view, { version: look.version, focus: look.at, ring }));
  if (!whole) look.frame = requestAnimationFrame(drawLook);
}

// Draws it again at the next frame: for the ring following the mouse, which changes nothing else.
function lookAgain() {
  const { look } = state;
  if (!look.on || !look.view || look.again) return;
  look.again = requestAnimationFrame(() => {
    look.again = 0;
    drawLook();
  });
}

// A click in the picture looks there, and shows the square on the plan for a moment.
function lookClicked(event) {
  const at = previewSquare(event.currentTarget, event.clientX, event.clientY);
  if (!at || !state.doc) return;
  state.look.at = at;
  state.flash = at;
  drawDeck();
  drawLook();
  clearTimeout(state.look.flashed);
  state.look.flashed = setTimeout(() => {
    state.flash = null;
    if (state.doc) drawDeck();
  }, 1500);
}

function toggleLook() {
  const { look } = state;
  look.on = !look.on;
  try {
    localStorage.setItem(LOOK_KEPT, look.on ? "on" : "off");
  } catch {
    // It's only for this visit, then.
  }
  drawLook();
  // The plan has more room, or less: it's fitted again.
  if (state.doc) {
    fitZoom();
    drawDeck();
  }
  if (look.on) lookSoon(0);
}

function onResize() {
  if (!state.doc) return;
  fitZoom();
  drawDeck();
  drawLook();
}

// ---- Opening, closing, and the deck in hand ---------------------------------------------------------------------

export async function openMapEditor({ onClose = null } = {}) {
  if ($("mapedit")) return;
  state.onClose = onClose;
  try {
    state.look.on = localStorage.getItem(LOOK_KEPT) !== "off";
  } catch {
    state.look.on = true;
  }
  Object.assign(state.look, { view: null, wrong: null, old: false, asked: state.look.asked + 1 });
  document.body.append(frame());
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);
  // The picture is drawn again when a picture of the packs that it was waiting for has come.
  state.look.unhear = onPixelArt(() => lookAgain());
  drawLook();
  // For the browser checks, which look at the editor's state from outside.
  window.__mapedit = state;
  try {
    state.maps = (await call("/api/map")).maps;
    const first = state.maps[0];
    if (!first) throw new Error("There's no deck to change yet.");
    await load(state.place ?? first.place, state.level ?? first.decks[0].id);
  } catch (err) {
    say(err.message, false);
  }
}

export function closeMapEditor() {
  if (state.dirty) {
    say("There are changes that aren't saved. Save them, or Close again to lose them.", false);
    state.dirty = false;
    return;
  }
  $("mapedit")?.remove();
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", onResize);
  state.look.unhear?.();
  clearTimeout(state.look.timer);
  cancelAnimationFrame(state.look.frame);
  cancelAnimationFrame(state.look.again);
  Object.assign(state.look, { timer: 0, frame: 0, again: 0, unhear: null, view: null });
  state.doc = null;
  state.onClose?.();
}

function onKey(event) {
  if (event.key === "Escape" && $("mapedit") && !event.target.closest("textarea, input, select")) closeMapEditor();
}

async function load(place, level) {
  const doc = await call(`/api/map/${place}/${level}`);
  Object.assign(state, { place, level, doc, cells: doc.grid.map((row) => [...row]), selected: null, drag: null, undo: [], redo: [], dirty: false, result: null });
  if (!doc.paints.some((paint) => paint.id === state.paint)) state.paint = "wall";
  // The picture starts where someone arriving on the deck stands, and is asked for at once.
  Object.assign(state.look, { view: null, wrong: null, at: doc.start ? { x: doc.start.x, y: doc.start.y } : null });
  clearTimeout(state.look.timer);
  state.look.timer = 0;
  fitZoom();
  drawAll();
  lookSoon(0);
}

function fitZoom() {
  const room = $("mapedit-view")?.clientWidth ?? 900;
  state.zoom = clamp(Math.floor((room - 4) / state.doc.width), 4, 14);
}

// What's sent to be tried or kept: the squares, and everything on them.
function parcel() {
  const { doc } = state;
  return {
    grid: state.cells.map((row) => row.join("")),
    people: doc.people.map(({ mark, x, y }) => ({ mark, x, y })),
    things: doc.things,
    exits: doc.exits.map(({ mark, x, y }) => ({ mark, x, y })),
    start: doc.start,
    writing: doc.writing,
    labels: doc.labels,
    areas: doc.areas,
    furniture: doc.furniture,
    spots: doc.spots.map(({ name, x, y }) => ({ name, x, y })),
  };
}

// ---- Undo: the deck as it was before each change -----------------------------------------------------------------

const KEPT = ["people", "things", "exits", "start", "writing", "labels", "areas", "furniture", "spots"];
const picture = () => JSON.stringify({ cells: state.cells.map((row) => row.join("")), ...Object.fromEntries(KEPT.map((key) => [key, state.doc[key]])) });
function restore(text) {
  const was = JSON.parse(text);
  state.cells = was.cells.map((row) => [...row]);
  for (const key of KEPT) state.doc[key] = was[key];
  state.selected = null;
}
// Call before changing anything, so the change can be taken back.
function remember() {
  state.undo.push(picture());
  if (state.undo.length > 150) state.undo.shift();
  state.redo = [];
  state.dirty = true;
  state.result = null;
  lookSoon();
}
function step(from, to) {
  if (!from.length) return;
  to.push(picture());
  restore(from.pop());
  state.dirty = true;
  drawAll();
  lookSoon();
}

// ---- The squares -------------------------------------------------------------------------------------------------

const inDeck = (x, y) => x >= 0 && y >= 0 && x < state.doc.width && y < state.doc.height;
const paintNow = () => state.doc.paints.find((paint) => paint.id === state.paint) ?? state.doc.paints[0];

// Paints one square. A crate is two squares wide, and fills the pair the square is half of.
function setCell(x, y, paint) {
  if (!inDeck(x, y)) return;
  if (paint.mark.length === 2) {
    const left = x - (x % 2);
    if (inDeck(left + 1, y)) {
      state.cells[y][left] = paint.mark[0];
      state.cells[y][left + 1] = paint.mark[1];
    }
    return;
  }
  // Half a crate left behind would be drawn as a machine: the other half goes back to floor.
  const was = state.cells[y][x];
  if (was === "[" && state.cells[y][x + 1] === "]") state.cells[y][x + 1] = state.doc.floor;
  if (was === "]" && state.cells[y][x - 1] === "[") state.cells[y][x - 1] = state.doc.floor;
  state.cells[y][x] = paint.mark;
}

function fillBox(a, b, paint, outline) {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const wall = state.doc.paints.find((one) => one.id === "wall");
  const floor = state.doc.paints.find((one) => one.id === "floor");
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
    const edge = x === x0 || x === x1 || y === y0 || y === y1;
    setCell(x, y, outline ? (edge ? wall : floor) : paint);
  }
}

// ---- What's on the deck, and what's under the pointer --------------------------------------------------------------

const KIND_WORDS = { person: "Someone's post", thing: "A thing", exit: "Stairs", start: "The start flag", writing: "Words on a wall", label: "A name on the deck", spot: "Where someone stands", area: "A room", furniture: "Furniture" };
function listOf(kind) {
  const { doc } = state;
  return { person: doc.people, thing: doc.things, exit: doc.exits, writing: doc.writing, label: doc.labels, spot: doc.spots, area: doc.areas, furniture: doc.furniture ??= [], start: doc.start ? [doc.start] : [] }[kind];
}
const lengthOf = (kind, one) => (kind === "writing" || kind === "label" ? Math.max(1, one.text.length) : kind === "furniture" ? footprintOf(one).across : 1);
const heightOf = (kind, one) => (kind === "furniture" ? footprintOf(one).down : 1);
// Whether something on the deck is on a square: a piece of furniture covers all of its own.
const covers = (kind, one, x, y) => (kind === "furniture" ? squaresOf(one).some(([sx, sy]) => sx === x && sy === y) : one.y === y && x >= one.x && x < one.x + lengthOf(kind, one));
const itemOf = (sel) => (sel ? listOf(sel.kind)[sel.index] ?? null : null);

// The smallest room drawn over a square.
function areaAt(x, y) {
  let best = -1;
  state.doc.areas.forEach((area, index) => {
    if (x < area.x || y < area.y || x >= area.x + area.w || y >= area.y + area.h) return;
    if (best < 0 || area.w * area.h < state.doc.areas[best].w * state.doc.areas[best].h) best = index;
  });
  return best;
}

// What a click on a square picks up: whatever stands there first, then a room's name tag, then the room itself.
function pick(x, y) {
  const order = ["thing", "person", "exit", "start", "furniture", "writing", "label", ...(state.show.spots ? ["spot"] : [])];
  for (const kind of order) {
    const index = listOf(kind).findIndex((one) => covers(kind, one, x, y));
    if (index >= 0) return { kind, index };
  }
  if (!state.show.rooms) return null;
  const index = areaAt(x, y);
  return index >= 0 ? { kind: "area", index } : null;
}

function describe(x, y) {
  if (!inDeck(x, y)) return "";
  const found = pick(x, y);
  const room = areaAt(x, y);
  const where = room >= 0 ? state.doc.areas[room].name : "the deck's passages";
  const on = found && found.kind !== "area" ? `${KIND_WORDS[found.kind]}${nameOf(found) ? `: ${nameOf(found)}` : ""}, on ` : "";
  return `${on}${lookOf(state.cells[y][x]).name.toLowerCase()} in ${where}`;
}
function nameOf(sel) {
  const one = itemOf(sel);
  if (!one) return "";
  if (sel.kind === "person" || sel.kind === "thing" || sel.kind === "area" || sel.kind === "spot") return one.name;
  if (sel.kind === "exit") return one.label ?? "";
  if (sel.kind === "writing" || sel.kind === "label") return one.text;
  if (sel.kind === "furniture") return FURNITURE_BY_ID[one.kind]?.name ?? one.kind;
  return "";
}

// ---- Drawing the deck --------------------------------------------------------------------------------------------

function drawDeck() {
  const canvas = $("mapedit-canvas");
  const { doc } = state;
  if (!canvas || !doc) return;
  const cw = state.zoom;
  const ch = cw * 2;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(doc.width * cw * ratio);
  canvas.height = Math.round(doc.height * ch * ratio);
  canvas.style.width = `${doc.width * cw}px`;
  canvas.style.height = `${doc.height * ch}px`;
  const g = canvas.getContext("2d");
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  g.fillStyle = "#020503";
  g.fillRect(0, 0, doc.width * cw, doc.height * ch);
  state.cells.forEach((row, y) => row.forEach((mark, x) => {
    const look = lookOf(mark);
    if (!look.color) return;
    g.fillStyle = look.color;
    g.fillRect(x * cw, y * ch, cw, ch);
    if (look.floor && cw >= 6) {
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(x * cw, y * ch, cw, 1);
      if (x % 2 === 0) g.fillRect(x * cw, y * ch, 1, ch);
    }
  }));
  // Rooms, as outlines with their names.
  if (state.show.rooms) {
    g.font = `${clamp(Math.round(ch * 0.62), 9, 13)}px Consolas, monospace`;
    g.textBaseline = "top";
    doc.areas.forEach((area, index) => {
      const chosen = state.selected?.kind === "area" && state.selected.index === index;
      g.strokeStyle = chosen ? "#ffffff" : "rgba(157,245,180,0.55)";
      g.lineWidth = chosen ? 2 : 1;
      g.setLineDash(chosen ? [] : [4, 3]);
      g.strokeRect(area.x * cw + 0.5, area.y * ch + 0.5, area.w * cw - 1, area.h * ch - 1);
      g.setLineDash([]);
      const wide = g.measureText(area.name).width + 8;
      g.fillStyle = chosen ? "#ffffff" : "rgba(8,17,12,0.88)";
      g.fillRect(area.x * cw + 1, area.y * ch + 1, wide, clamp(Math.round(ch * 0.62), 9, 13) + 5);
      g.fillStyle = chosen ? "#050a07" : "#9df5b4";
      g.fillText(area.name, area.x * cw + 5, area.y * ch + 3);
      if (chosen) {
        g.fillStyle = "#ffffff";
        g.fillRect((area.x + area.w) * cw - 9, (area.y + area.h) * ch - 9, 9, 9);
      }
    });
  }
  // Words, a letter to a square, the way the game paints them.
  g.font = `${Math.max(8, Math.round(ch * 0.7))}px Consolas, monospace`;
  g.textBaseline = "middle";
  g.textAlign = "center";
  const letters = (list, color) => list.forEach((one) => {
    g.fillStyle = color;
    [...one.text].forEach((letter, i) => g.fillText(letter, (one.x + i + 0.5) * cw, (one.y + 0.5) * ch));
  });
  letters(doc.writing, "#ffe0a8");
  letters(doc.labels, "#8ec5ff");
  // Furniture: the floor it takes, a bright edge along its front, and its first letter. A window or a screen is a
  // bar along the side of its wall the room is on.
  for (const piece of doc.furniture ?? []) {
    const kind = FURNITURE_BY_ID[piece.kind];
    if (!kind) continue;
    if (kind.wall) {
      g.fillStyle = piece.kind === "window" ? "#bcd8ff" : "#86dcff";
      if (lookOf(state.cells[piece.y + 1]?.[piece.x] ?? " ").floor) g.fillRect(piece.x * cw + 1, (piece.y + 1) * ch - 4, cw - 2, 4);
      else g.fillRect((piece.x + 1) * cw - 4, piece.y * ch + 2, 4, ch - 4);
      continue;
    }
    const { across, down } = footprintOf(piece);
    const [x0, y0, w, h] = [piece.x * cw + 1, piece.y * ch + 1, across * cw - 2, down * ch - 2];
    g.fillStyle = kind.blocks ? "rgba(196,160,110,0.78)" : "rgba(140,165,205,0.7)";
    g.fillRect(x0, y0, w, h);
    g.strokeStyle = "rgba(255,240,210,0.65)";
    g.lineWidth = 1;
    g.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    const edge = Math.max(2, Math.round(cw * 0.22));
    g.fillStyle = "#fff6dc";
    if (piece.facing === "n") g.fillRect(x0, y0, w, edge);
    else if (piece.facing === "e") g.fillRect(x0 + w - edge, y0, edge, h);
    else if (piece.facing === "w") g.fillRect(x0, y0, edge, h);
    else g.fillRect(x0, y0 + h - edge, w, edge);
    if (cw >= 7) {
      g.fillStyle = "#1a140c";
      g.font = `bold ${Math.max(8, Math.round(cw * 0.95))}px Consolas, monospace`;
      g.fillText(kind.name[0], x0 + w / 2, y0 + h / 2 + 0.5);
    }
  }
  // Whoever and whatever stands on the deck.
  const mid = (one) => [(one.x + 0.5) * cw, (one.y + 0.5) * ch];
  const size = Math.max(4, cw * 0.9);
  for (const thing of doc.things) {
    const [x, y] = mid(thing);
    g.fillStyle = "#ffcc4d";
    g.beginPath();
    g.moveTo(x, y - size);
    g.lineTo(x + size * 0.7, y);
    g.lineTo(x, y + size);
    g.lineTo(x - size * 0.7, y);
    g.fill();
  }
  for (const exit of doc.exits) {
    const [x, y] = mid(exit);
    g.fillStyle = "#4fd0d0";
    g.beginPath();
    g.moveTo(x, y - size);
    g.lineTo(x + size * 0.8, y + size * 0.8);
    g.lineTo(x - size * 0.8, y + size * 0.8);
    g.fill();
  }
  for (const person of doc.people) {
    const [x, y] = mid(person);
    g.fillStyle = "#f4acc7";
    g.beginPath();
    g.arc(x, y, size * 0.8, 0, Math.PI * 2);
    g.fill();
    if (cw >= 6) {
      g.fillStyle = "#050a07";
      g.font = `bold ${Math.max(8, Math.round(size * 1.1))}px Consolas, monospace`;
      g.fillText((person.name ?? "?")[0], x, y + 0.5);
    }
  }
  if (doc.start) {
    const [x, y] = mid(doc.start);
    g.strokeStyle = "#ffffff";
    g.lineWidth = 2;
    g.strokeRect(x - size * 0.6, y - size * 0.6, size * 1.2, size * 1.2);
  }
  if (state.show.spots) for (const spot of doc.spots) {
    const [x, y] = mid(spot);
    g.fillStyle = "#c9a6ff";
    g.fillRect(x - 2, y - 2, 4, 4);
  }
  // What's chosen, what's being dragged out, and what a problem points at.
  g.lineWidth = 2;
  const ring = (x, y, w, color, h = 1) => {
    g.strokeStyle = color;
    g.strokeRect(x * cw - 1, y * ch - 1, w * cw + 2, h * ch + 2);
  };
  const sel = itemOf(state.selected);
  if (sel && state.selected.kind !== "area") ring(sel.x, sel.y, lengthOf(state.selected.kind, sel), "#ffffff", heightOf(state.selected.kind, sel));
  if (state.drag?.box) {
    const { from, to } = state.drag.box;
    g.strokeStyle = "#ffffff";
    g.setLineDash([3, 3]);
    g.strokeRect(Math.min(from.x, to.x) * cw, Math.min(from.y, to.y) * ch, (Math.abs(to.x - from.x) + 1) * cw, (Math.abs(to.y - from.y) + 1) * ch);
    g.setLineDash([]);
  }
  if (state.flash) ring(state.flash.x, state.flash.y, 1, "#ff7b6b");
  if (state.hover && !state.drag && inDeck(state.hover.x, state.hover.y)) {
    g.strokeStyle = "rgba(255,255,255,0.5)";
    g.lineWidth = 1;
    g.strokeRect(state.hover.x * cw + 0.5, state.hover.y * ch + 0.5, cw - 1, ch - 1);
  }
}

// ---- The pointer on the deck -------------------------------------------------------------------------------------

function squareAt(event) {
  const box = $("mapedit-canvas").getBoundingClientRect();
  return { x: Math.floor((event.clientX - box.left) / state.zoom), y: Math.floor((event.clientY - box.top) / (state.zoom * 2)) };
}

function pressed(event) {
  if (event.button !== 0 || !state.doc || state.busy) return;
  const at = squareAt(event);
  if (!inDeck(at.x, at.y)) return;
  // The picture beside the plan looks at whatever square is clicked.
  state.look.at = { x: at.x, y: at.y };
  lookAgain();
  // So a drag that leaves the deck still ends on it. A pointer that can't be held (some pens) just isn't.
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // Nothing to do.
  }
  const { tool } = state;
  if (tool === "paint") {
    remember();
    if (state.shape === "brush") {
      setCell(at.x, at.y, paintNow());
      state.drag = { brush: true };
    } else state.drag = { box: { from: at, to: at } };
  } else if (tool === "room") state.drag = { box: { from: at, to: at }, room: true };
  else if (tool === "thing" || tool === "writing" || tool === "label") {
    addAt(tool, at);
    return;
  } else if (tool === "furniture") {
    addFurniture(at);
    return;
  } else {
    // Choosing and moving. The white corner of a chosen room pulls its far corner.
    const chosen = state.selected?.kind === "area" ? itemOf(state.selected) : null;
    if (chosen && at.x >= chosen.x + chosen.w - 2 && at.x <= chosen.x + chosen.w && at.y === chosen.y + chosen.h - 1) {
      state.drag = { resize: true, moved: false };
    } else {
      state.selected = pick(at.x, at.y);
      const one = itemOf(state.selected);
      state.drag = one ? { move: true, dx: at.x - one.x, dy: at.y - one.y, moved: false } : null;
    }
    drawSide();
  }
  drawDeck();
}

function movedOver(event) {
  if (!state.doc) return;
  const at = squareAt(event);
  state.hover = at;
  const drag = state.drag;
  // The picture's ring follows the mouse, and what's being painted or dragged shows in it as it goes.
  if (drag) lookSoon();
  lookAgain();
  if (drag?.brush) setCell(at.x, at.y, paintNow());
  else if (drag?.box) drag.box.to = { x: clamp(at.x, 0, state.doc.width - 1), y: clamp(at.y, 0, state.doc.height - 1) };
  else if (drag?.move || drag?.resize) {
    const one = itemOf(state.selected);
    if (one) {
      const before = drag.resize ? [one.w, one.h] : [one.x, one.y];
      if (drag.resize) {
        const w = clamp(at.x - one.x + 1, 2, state.doc.width - one.x);
        const h = clamp(at.y - one.y + 1, 1, state.doc.height - one.y);
        if (w !== one.w || h !== one.h) {
          if (!drag.moved) remember();
          drag.moved = true;
          one.w = w;
          one.h = h;
        }
      } else {
        const wide = state.selected.kind === "area" ? one.w : lengthOf(state.selected.kind, one);
        const tall = state.selected.kind === "area" ? one.h : heightOf(state.selected.kind, one);
        const x = clamp(at.x - drag.dx, 0, state.doc.width - wide);
        const y = clamp(at.y - drag.dy, 0, state.doc.height - tall);
        if ((x !== before[0] || y !== before[1]) && free(state.selected, x, y)) {
          if (!drag.moved) remember();
          drag.moved = true;
          one.x = x;
          one.y = y;
        }
      }
    }
  }
  $("mapedit-where").textContent = describe(at.x, at.y);
  drawDeck();
}

// Whether something can stand on a square: two of whoever and whatever stands on the deck can't share one.
function free(sel, x, y) {
  if (!["person", "thing", "exit", "start"].includes(sel.kind)) return true;
  return !["person", "thing", "exit", "start"].some((kind) => listOf(kind).some((one, index) => one.x === x && one.y === y && !(kind === sel.kind && index === sel.index)));
}

function released() {
  const drag = state.drag;
  state.drag = null;
  if (drag) lookSoon();
  if (drag?.box) {
    const { from, to } = drag.box;
    if (drag.room) {
      const x = Math.min(from.x, to.x);
      const y = Math.min(from.y, to.y);
      const w = Math.abs(to.x - from.x) + 1;
      const h = Math.abs(to.y - from.y) + 1;
      if (w >= 2 && h >= 2) {
        remember();
        state.doc.areas.push({ name: freshName("New room", state.doc.areas.map((area) => area.name)), x, y, w, h, desc: "" });
        state.selected = { kind: "area", index: state.doc.areas.length - 1 };
        setTool("select");
      }
    } else fillBox(from, to, paintNow(), state.shape === "walls");
  }
  drawAll();
}

const freshName = (base, taken) => {
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!taken.includes(name)) return name;
  }
};

function addAt(kind, at) {
  const { doc } = state;
  if (kind === "thing") {
    const used = new Set([...doc.things.map((one) => one.mark), ...state.cells.flat()]);
    const mark = [..."abcdefghijklmnopqrstuvwxyz"].find((letter) => !used.has(letter));
    if (!mark) return say("This deck has as many things as it can hold. Take one away first.", false);
    if (!free({ kind: "thing", index: -1 }, at.x, at.y)) return say("Something's standing there already.", false);
    remember();
    doc.things.push({ mark, x: at.x, y: at.y, name: freshName("New thing", doc.things.map((one) => one.name)), look: "", use: "" });
    state.selected = { kind: "thing", index: doc.things.length - 1 };
  } else {
    remember();
    const list = kind === "writing" ? doc.writing : doc.labels;
    list.push({ x: at.x, y: at.y, text: kind === "writing" ? "WORDS" : "A NAME" });
    state.selected = { kind, index: list.length - 1 };
  }
  setTool("select");
  drawAll();
  $("mapedit-name")?.select();
}

// A seat put down beside a console, a desk or a table faces it; anything else faces the camera, until it's turned.
const MACHINES = "=^<>(){}&[]";
function facingFor(kind, at) {
  // A chair turns to the console or the table it's put beside, and so does a seat of the packs.
  if (kind !== "chair" && kind !== "command-chair" && !(FURNITURE_BY_ID[kind]?.pack && FURNITURE_BY_ID[kind].seat)) return "s";
  const toward = (x, y) => MACHINES.includes(state.cells[y]?.[x] ?? " ") || (state.doc.furniture ?? []).some((one) => (["table", "long-table", "desk", "plot-table"].includes(one.kind) || FURNITURE_BY_ID[one.kind]?.what === "table") && squaresOf(one).some(([sx, sy]) => sx === x && sy === y));
  for (const [facing, dx, dy] of [["n", 0, -1], ["s", 0, 1], ["e", 1, 0], ["w", -1, 0]]) if (toward(at.x + dx, at.y + dy)) return facing;
  return "n";
}

// The pieces of the bought packs chosen lately, newest first, kept from one visit to the next: the ones the game
// still knows as furniture.
const RECENT = "meridian-mapedit-pieces";
function recentPieces() {
  if (!state.recent) {
    try {
      state.recent = JSON.parse(localStorage.getItem(RECENT) ?? "[]").filter((id) => typeof id === "string").slice(0, 8);
    } catch {
      state.recent = [];
    }
  }
  return state.recent.map((id) => FURNITURE_BY_ID[id]).filter((kind) => kind?.pack);
}

// Opens the Pieces window to choose one of the packs' pieces that are on the ship, and makes it the furniture that a
// click on the deck puts down.
function choosePackPiece() {
  openPieces({
    pick: async (piece) => {
      if (!FURNITURE_BY_ID[piece.id]) await loadPack();
      const kind = FURNITURE_BY_ID[piece.id];
      if (!kind) {
        say("The game doesn't know that piece as furniture yet. Close the game and open it again, then choose it.", false);
        return;
      }
      state.recent = [piece.id, ...(state.recent ?? []).filter((id) => id !== piece.id)].slice(0, 8);
      try {
        localStorage.setItem(RECENT, JSON.stringify(state.recent));
      } catch {
        // It's only remembered for this visit, then.
      }
      state.piece = piece.id;
      setTool("furniture");
      say(`${kind.name} chosen. Click a ${kind.wall ? "wall" : "square"} of the deck to put one there.`);
    },
  });
}

// Puts a piece of the furniture chosen on the left down where it's clicked, and keeps the tool, so a row of chairs is a
// row of clicks.
function addFurniture(at) {
  const kind = FURNITURE_BY_ID[state.piece];
  if (!kind) return;
  remember();
  const list = listOf("furniture");
  list.push({ kind: kind.id, x: at.x, y: at.y, facing: facingFor(kind.id, at) });
  state.selected = { kind: "furniture", index: list.length - 1 };
  say(kind.wall ? `${kind.name} put on the wall. It shows on the side of the wall the room is on.` : `${kind.name} put down. Turn it on the right, or drag it with Choose and move.`);
  drawAll();
}

// Turns what's chosen a quarter round, to its right: a piece of furniture, or a thing drawn as one.
function turnSelected() {
  const one = itemOf(state.selected);
  if (!one) return;
  remember();
  const now = FACINGS.indexOf(one.facing ?? "s");
  one.facing = FACINGS[(now + 1) % FACINGS.length];
  drawAll();
}

function removeSelected() {
  const sel = state.selected;
  if (!sel || !["thing", "writing", "label", "area", "furniture"].includes(sel.kind)) return;
  remember();
  listOf(sel.kind).splice(sel.index, 1);
  state.selected = null;
  drawAll();
}

// ---- The two sides of the window ---------------------------------------------------------------------------------

function setTool(tool) {
  state.tool = tool;
  drawTools();
}

function button(words, props = {}, on = false) {
  return el("button", { type: "button", "aria-pressed": on ? "true" : "false", ...props }, words);
}

function drawTools() {
  const box = $("mapedit-tools");
  if (!box || !state.doc) return;
  const tool = (id, words, title) => button(words, { title, onclick: () => setTool(id) }, state.tool === id);
  const swatch = (paint) => {
    const color = lookOf(paint.mark[0]).color ?? "#020503";
    return el("button", { type: "button", class: "mapedit-paint", title: paint.about, "aria-pressed": state.tool === "paint" && state.paint === paint.id ? "true" : "false", onclick: () => { state.paint = paint.id; setTool("paint"); } },
      el("span", { class: "mapedit-swatch", style: `background:${color}` }), paint.name);
  };
  const shape = (id, words, title) => button(words, { title, onclick: () => { state.shape = id; setTool("paint"); } }, state.tool === "paint" && state.shape === id);
  box.replaceChildren(
    el("h3", {}, "Choose"),
    tool("select", "Choose and move", "Click a room, a thing or a person to choose it, and drag it to move it"),
    el("h3", {}, "Paint"),
    el("div", { class: "mapedit-paints" }, state.doc.paints.map(swatch)),
    el("div", { class: "mapedit-row" },
      shape("brush", "Brush", "Paint square by square: hold the mouse button down and drag"),
      shape("box", "Block", "Drag out a block, filled with what you're painting"),
      shape("walls", "Room", "Drag out a room: walls all round, floor inside. Add a door afterwards")),
    el("h3", {}, "Add"),
    tool("room", "A room's outline", "Drag a rectangle round part of the deck, to make it a room with a name"),
    tool("thing", "A thing", "Click a square to put down something to look at and use"),
    tool("writing", "Words on a wall", "Click where the words begin"),
    tool("label", "A name on the deck", "Click where the name begins"),
    el("h3", {}, "From the packs"),
    el("div", { class: "mapedit-packs" },
      button("Choose a piece...", { id: "mapedit-choose", title: "Any piece of the two packs that's on the ship, to put down like the furniture above", onclick: choosePackPiece }),
      recentPieces().map((kind) => el("button", { type: "button", class: "mapedit-pack", title: `${kind.about}. Click a ${kind.wall ? "wall" : "square"} to put one there`, "aria-pressed": state.tool === "furniture" && state.piece === kind.id ? "true" : "false", onclick: () => { state.piece = kind.id; setTool("furniture"); } },
        kind.faces?.s ?? kind.picture ? pieceThumb(kind.faces?.s ?? kind.picture, kind.name) : el("span", { class: "mapedit-swatch", style: `background:${kind.wall ? "#86dcff" : kind.blocks ? "#c4a06e" : "#8ca5cd"}` }),
        el("span", {}, kind.name)))),
    el("h3", {}, "Furniture"),
    el("div", { class: "mapedit-paints" }, FURNITURE.map((kind) => el("button", { type: "button", class: "mapedit-paint", title: `${kind.about}. Click a ${kind.wall ? "wall" : "square"} to put one there`, "aria-pressed": state.tool === "furniture" && state.piece === kind.id ? "true" : "false", onclick: () => { state.piece = kind.id; setTool("furniture"); } },
      el("span", { class: "mapedit-swatch", style: `background:${kind.wall ? "#86dcff" : kind.blocks ? "#c4a06e" : "#8ca5cd"}` }), kind.name))),
    el("h3", {}, "Show"),
    el("label", { class: "mapedit-tick" }, el("input", { type: "checkbox", checked: state.show.rooms, onchange: (event) => { state.show.rooms = event.target.checked; drawDeck(); } }), "Rooms"),
    el("label", { class: "mapedit-tick", title: "The spots people's days send them to: where they work, eat and sleep" }, el("input", { type: "checkbox", checked: state.show.spots, onchange: (event) => { state.show.spots = event.target.checked; drawDeck(); } }), "Where people stand"),
    el("div", { class: "mapedit-key" },
      [["#ffcc4d", "a thing"], ["#f4acc7", "someone's post"], ["#4fd0d0", "stairs"], ["#ffffff", "where the deck starts"], ["#c9a6ff", "where people stand"], ["#c4a06e", "furniture in the way"], ["#8ca5cd", "a seat or a bed"]].map(([color, words]) => el("div", {}, el("span", { class: "mapedit-swatch", style: `background:${color}` }), words))),
  );
}

// A box of words that changes what's chosen as it's typed in.
function field(label, value, onInput, { id = null, tall = false } = {}) {
  const props = { ...(id ? { id } : {}), oninput: (event) => { edit(() => onInput(event.target.value)); drawDeck(); } };
  const box = tall ? el("textarea", { rows: "3", ...props }, value ?? "") : el("input", { type: "text", value: value ?? "", ...props });
  return el("label", { class: "mapedit-field" }, el("span", {}, label), box);
}
// Typing in a box is one change to take back, however many letters.
let typing = null;
function edit(change) {
  const key = `${state.selected?.kind}:${state.selected?.index}`;
  if (typing !== key) remember();
  typing = key;
  state.dirty = true;
  change();
  // A thing's name can change what it's drawn as, so the picture is asked for again.
  lookSoon();
}

function drawSide() {
  const box = $("mapedit-side");
  if (!box || !state.doc) return;
  typing = null;
  const sel = state.selected;
  const one = itemOf(sel);
  const parts = [];
  if (!one) parts.push(el("p", { class: "mapedit-hint" }, state.tool === "paint" ? "Hold the mouse button down on the deck to paint." : state.tool === "furniture" ? `Click a ${FURNITURE_BY_ID[state.piece]?.wall ? "wall" : "square"} on the deck to put the ${FURNITURE_BY_ID[state.piece]?.name.toLowerCase() ?? "furniture"} there.` : "Click something on the deck to choose it."));
  else {
    parts.push(el("h3", {}, KIND_WORDS[sel.kind]));
    if (sel.kind === "area") {
      parts.push(field("Name", one.name, (value) => { one.name = value; }, { id: "mapedit-name" }));
      parts.push(field("What you see there", one.desc, (value) => { one.desc = value; }, { tall: true }));
      parts.push(el("p", { class: "mapedit-hint" }, "Drag it to move it. Drag its white corner to make it bigger or smaller."));
    } else if (sel.kind === "thing") {
      parts.push(field("Name", one.name, (value) => { one.name = value; }, { id: "mapedit-name" }));
      parts.push(field("What Look says", one.look, (value) => { one.look = value; }, { tall: true }));
      parts.push(field("What you do with it (\"I ...\")", one.use, (value) => { one.use = value; }, { tall: true }));
      // What it's drawn as in the room: what its name says, a piece of furniture, or the plain box.
      const named = looksOf({ name: one.name });
      const choices = [["", named ? `As its name says: ${FURNITURE_BY_ID[named].name.toLowerCase()}` : "As its name says: a box"], ...FURNITURE.filter((kind) => !kind.wall).map((kind) => [kind.id, kind.name]), ["box", "A plain box"]];
      parts.push(el("label", { class: "mapedit-field" }, el("span", {}, "Drawn in the room as"),
        el("select", { onchange: (event) => { edit(() => { if (event.target.value) one.looks = event.target.value; else delete one.looks; }); drawSide(); } },
          choices.map(([value, words]) => el("option", { value, ...((one.looks ?? "") === value ? { selected: true } : {}) }, words)))));
      if (looksOf(one)) parts.push(el("div", { class: "mapedit-row" }, button("Turn it", { title: "A quarter turn to its right", onclick: turnSelected }), el("span", { class: "mapedit-hint" }, one.facing ? `Facing ${FACING_WORDS[one.facing]}` : "Turned by the game: away from a wall beside it, or a seat toward the bow")));
    } else if (sel.kind === "furniture") {
      const kind = FURNITURE_BY_ID[one.kind];
      parts.push(el("p", {}, kind?.name ?? one.kind), el("p", { class: "mapedit-hint" }, kind?.about ?? ""));
      if (kind?.wall) parts.push(el("p", { class: "mapedit-hint" }, "It shows on the side of the wall the room is on. Drag it to move it along the wall."));
      else {
        parts.push(el("div", { class: "mapedit-row" }, button("Turn it", { title: "A quarter turn to its right", onclick: turnSelected }), el("span", { class: "mapedit-hint" }, `Facing ${FACING_WORDS[one.facing ?? "s"]}`)));
        parts.push(el("p", { class: "mapedit-hint" }, kind?.blocks ? "People walk round it. Drag it to move it." : "People can stand on it: sit, or lie down. Drag it to move it."));
      }
    } else if (sel.kind === "writing" || sel.kind === "label") {
      parts.push(field("The words", one.text, (value) => { one.text = value.toUpperCase(); }, { id: "mapedit-name" }));
    } else if (sel.kind === "person") parts.push(el("p", {}, one.name), el("p", { class: "mapedit-hint" }, "This is where they stand at their post. Drag them to move it."));
    else if (sel.kind === "exit") parts.push(el("p", {}, one.label ?? "Stairs"), el("p", { class: "mapedit-hint" }, "Drag the stairs to move them. Where they lead stays the same."));
    else if (sel.kind === "start") parts.push(el("p", { class: "mapedit-hint" }, "Where someone arriving on this deck stands. Drag it to move it."));
    else if (sel.kind === "spot") parts.push(el("p", {}, one.name.replaceAll("-", " ")), el("p", { class: "mapedit-hint" }, "Somewhere a person's day sends them. Drag it to move it."));
    if (["thing", "writing", "label", "area", "furniture"].includes(sel.kind)) parts.push(button(sel.kind === "area" ? "Take this room away" : "Take it away", { class: "mapedit-remove", onclick: removeSelected }));
  }
  const result = state.result;
  if (result) {
    const lines = [...result.problems, ...result.elsewhere.map((words) => ({ words }))];
    parts.push(el("h3", {}, result.kept ? "Saved" : lines.length ? "Before you save" : "Checked"));
    for (const note of result.notes) parts.push(el("p", { class: "mapedit-note" }, note));
    if (!lines.length) parts.push(el("p", { class: "mapedit-note" }, result.kept ? "The game has the new deck." : "Nothing's wrong with it."));
    else {
      parts.push(el("p", { class: "mapedit-hint" }, result.kept ? "Kept, with these still to put right:" : "These would go wrong. Click one to see where."));
      parts.push(el("ul", { class: "mapedit-problems" }, lines.map((line) => el("li", { class: line.x === undefined ? "" : "pointed", onclick: () => pointAt(line) }, line.words))));
      if (!result.kept && result.asked) parts.push(button("Save it anyway", { class: "mapedit-remove", onclick: () => send(true, true) }));
    }
  }
  box.replaceChildren(...parts);
}

function pointAt(line) {
  if (line.x === undefined) return;
  state.flash = { x: line.x, y: line.y };
  const view = $("mapedit-view");
  view.scrollTo({ left: line.x * state.zoom - view.clientWidth / 2, top: line.y * state.zoom * 2 - view.clientHeight / 2, behavior: "smooth" });
  drawDeck();
  setTimeout(() => { state.flash = null; drawDeck(); }, 2500);
}

function drawHead() {
  const box = $("mapedit-decks");
  if (!box) return;
  const decks = state.maps.find((one) => one.place === state.place)?.decks ?? [];
  box.replaceChildren(...decks.map((deck) => button(deck.name, { onclick: () => changeDeck(deck.id) }, deck.id === state.level)));
  $("mapedit-undo").disabled = !state.undo.length;
  $("mapedit-redo").disabled = !state.redo.length;
  $("mapedit-save").textContent = state.dirty ? "Save *" : "Save";
}

function drawAll() {
  drawHead();
  drawTools();
  drawSide();
  drawDeck();
}

async function changeDeck(level) {
  if (level === state.level) return;
  if (state.dirty) {
    say("This deck has changes that aren't saved. Save them, or choose the other deck again to lose them.", false);
    state.dirty = false;
    drawHead();
    return;
  }
  try {
    await load(state.place, level);
    say("", true);
  } catch (err) {
    say(err.message, false);
  }
}

function say(words, ok = true) {
  const line = $("mapedit-says");
  if (!line) return;
  line.textContent = words;
  line.className = `mapedit-says ${ok ? "ok" : "bad"}`;
}

// Tries the deck out, and keeps it if it's sound, or if the owner says to keep it anyway.
async function send(keep, anyway = false) {
  if (state.busy || !state.doc) return;
  state.busy = true;
  say(keep ? "Saving: the game is trying the deck out first..." : "Checking the deck against the rest of the game...");
  try {
    const result = await call(`/api/map/${state.place}/${state.level}`, { doc: parcel(), keep, anyway });
    state.result = { ...result, asked: keep };
    if (result.kept) {
      const undo = state.undo;
      await load(state.place, state.level);
      state.undo = undo;
      state.result = { ...result, asked: keep };
      say("Saved. The room behind this window is the new one.");
    } else say(result.problems.length + result.elsewhere.length ? (keep ? "Not saved yet: see what would go wrong, in the list beside the deck." : "See what would go wrong, in the list beside the deck.") : "Nothing's wrong with it.", !(result.problems.length + result.elsewhere.length));
  } catch (err) {
    say(err.message, false);
  }
  state.busy = false;
  drawAll();
}

function zoomBy(step) {
  state.zoom = clamp(state.zoom + step, 4, 16);
  drawDeck();
}

function frame() {
  return el("div", { class: "mapedit", id: "mapedit", role: "dialog", "aria-label": "Map editor" },
    el("header", { class: "mapedit-head" },
      el("h2", {}, "Map editor"),
      el("div", { class: "mapedit-decks", id: "mapedit-decks" }),
      el("div", { class: "mapedit-row" },
        button("Undo", { id: "mapedit-undo", title: "Take the last change back", onclick: () => step(state.undo, state.redo) }),
        button("Redo", { id: "mapedit-redo", title: "Put it back again", onclick: () => step(state.redo, state.undo) }),
        button("-", { title: "Smaller", onclick: () => zoomBy(-1) }),
        button("+", { title: "Bigger", onclick: () => zoomBy(1) }),
        button("Pieces", { id: "mapedit-pieces", title: "Every picture in the two bought packs, and which of them go on the ship", onclick: () => openPieces() }),
        button("Picture", { id: "mapedit-look-toggle", title: "The room as the game will draw it, beside the plan, drawn again as you change the deck", onclick: toggleLook }, state.look.on)),
      el("div", { class: "mapedit-row mapedit-end" },
        button("Check", { title: "See whether anything in the game would go wrong, without saving", onclick: () => send(false) }),
        button("Save", { id: "mapedit-save", class: "mapedit-save", title: "Keep the deck as it is here. The one before is kept in your data folder", onclick: () => send(true) }),
        button("Close", { onclick: closeMapEditor }))),
    el("div", { class: "mapedit-says", id: "mapedit-says", role: "status" }),
    el("div", { class: "mapedit-body" },
      el("aside", { class: "mapedit-tools", id: "mapedit-tools" }),
      el("div", { class: "mapedit-middle", id: "mapedit-middle" }, el("div", { class: "mapedit-view", id: "mapedit-view" },
        el("canvas", { id: "mapedit-canvas", onpointerdown: pressed, onpointermove: movedOver, onpointerup: released, onpointercancel: released, onpointerleave: () => { state.hover = null; lookAgain(); if (!state.drag) drawDeck(); } })),
        el("div", { class: "mapedit-look", id: "mapedit-look", hidden: "" },
          el("canvas", { id: "mapedit-look-canvas", role: "img", "aria-label": "The room as the game will draw it", title: "The room as the game will draw it, with what you've changed. Click the plan, or here, to look somewhere else", onclick: lookClicked }),
          el("div", { class: "mapedit-look-says", id: "mapedit-look-says", role: "status" }))),
      el("aside", { class: "mapedit-side", id: "mapedit-side" })),
    el("footer", { class: "mapedit-where", id: "mapedit-where" }));
}
