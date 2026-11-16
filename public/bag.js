// The inventory window: what the player has on them, in their pockets and in their pack, on a grid where each thing
// takes squares by its size, and beside it what's in a thing they've opened or a pile on the floor. It opens with I, or
// the Inventory button, and floats over the room like the other windows: nothing behind it dimmed, the clock running
// on, pulled aside with the mouse and sliding back, and a line to the player. Things are dragged where they go,
// double-clicked to put on, use or take, and right-clicked for the rest. The server keeps where everything is
// (src/bag.js), and this only shows it and says what the player did.

import { api, el, zoom } from "./dom.js";
import { leaderNode, pullable } from "./float.js";
import { artFor } from "./item-art.js";
import { untagged } from "./story.js";

const CELL = 26;
const KINDS = { weapon: "Weapon", armor: "Armor", consumable: "Supplies", gadget: "Gadget", goods: "Goods", story: "Story item" };
// Armor that stops nothing is clothes: a jumpsuit, a sweater, a coat (the loot's drafts wear them in the armor's place).
const kindWord = (item) => (item.type === "armor" && !item.defense ? "Clothes" : KINDS[item.type] ?? "Item");
const GEAR = ["weapon", "armor", "sidearm"];
const FIGURE = ["   .--.", "  (    )", "   `--'", " .-'  '-.", "/ |    | \\", "  |    |", "  |____|", "  /    \\", " /      \\"].join("\n");

const state = { open: false, message: null, reading: null, sending: false, drag: null, menu: null, tip: null, last: { key: null, at: 0 } };
let app;

export function initBag(hooks) {
  app = hooks;
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", (event) => {
    if (state.menu && !event.target.closest?.(".bag-menu")) closeMenu();
  }, true);
}

export const bagOpen = () => state.open && Boolean(app?.ui.game?.bag);
export function resetBag() {
  closeMenu();
  hideTip();
  Object.assign(state, { open: false, message: null, reading: null, sending: false, drag: null });
}
export function openBag() {
  state.open = true;
  state.message = null;
  app.putAway?.();
  app.render();
}
export function closeBag() {
  if (!state.open) return;
  state.open = false;
  closeMenu();
  hideTip();
  // Whatever was open beside it is shut too.
  if (app.ui.game?.bag?.open) send({ action: "close" }, { quiet: true });
  app.render();
}
export const toggleBag = () => (state.open ? closeBag() : openBag());

export function bagNode() {
  const g = app?.ui.game;
  // A fight, a check, a talk or a computer takes over from it.
  if (state.open && g && (g.combat || g.check || g.talk || g.computer)) {
    state.open = false;
    closeMenu();
    hideTip();
  }
  if (!bagOpen()) return null;
  return el("div", { class: "check-float bag-float", id: "bag" }, leaderNode("person:you"), pullable(windowNode()));
}

function draw() {
  hideTip();
  const node = bagNode();
  const current = document.getElementById("bag");
  if (current && node) current.replaceWith(node);
  else if (current) current.remove();
}

// ---- Drawing it -----------------------------------------------------------------------------------------

const keyOf = (where) => [where.at, where.x, where.y, where.i, where.id].filter((part) => part !== undefined).join(":");
const lowerFirst = (words) => (/^(The|A|An) /.test(words) ? words.charAt(0).toLowerCase() + words.slice(1) : words);
const timesWord = (n) => (n === 2 ? "twice" : `${n} times`);

function panel(title, note, ...body) {
  return el("div", { class: "check-panel bag-panel" },
    el("div", { class: "check-panel-title" }, el("span", {}, title), note && el("span", { class: "check-panel-marks" }, note)),
    el("div", { class: "bag-panel-body" }, body));
}

function itemNode(item, where, fitted = false) {
  const style = fitted ? "" : `left:${item.x * CELL + 1}px;top:${item.y * CELL + 1}px;width:${item.w * CELL - 2}px;height:${item.h * CELL - 2}px`;
  const node = el("div", { class: `bag-item no-pull${item.type === "story" ? " story" : ""}${fitted ? " fitted" : ""}`, style, "data-key": keyOf(where), "aria-label": `${item.name}${item.n > 1 ? `, ${item.n}` : ""}` },
    el("pre", {}, artFor(item).join("\n")),
    !fitted && item.w > 1 && el("span", { class: "bag-item-name" }, item.name),
    item.n > 1 && el("span", { class: "bag-item-count" }, `x${item.n}`));
  node.addEventListener("pointerdown", (event) => press(event, item, where, fitted));
  node.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMenu(event, item, where);
  });
  node.addEventListener("pointerenter", () => showTip(node, item, where));
  node.addEventListener("pointerleave", hideTip);
  return node;
}

function slotNode(name, label, w, h, item, left, top, where = { at: name }) {
  return el("div", { class: `bag-slot no-pull${item ? " full" : ""}`, "data-slot": name, style: `left:${left}px;top:${top}px;width:${w}px;height:${h}px` },
    item ? itemNode(item, where, true) : el("span", { class: "bag-slot-empty" }, label));
}

// Which of the body's parts each stretch of the figure is, row by row: [first column, last column, part]. It's seen
// from in front, so the right arm is on the left.
const FIGURE_PARTS = [
  [[0, 99, "head"]], [[0, 99, "head"]], [[0, 99, "head"]],
  [[0, 3, "right_arm"], [4, 5, "chest"], [6, 99, "left_arm"]],
  [[0, 0, "right_arm"], [1, 8, "chest"], [9, 99, "left_arm"]],
  [[0, 99, "chest"]], [[0, 99, "chest"]],
  [[0, 4, "right_leg"], [5, 99, "left_leg"]],
  [[0, 4, "right_leg"], [5, 99, "left_leg"]],
];
const PART_NAMES = { head: "Head", chest: "Chest", right_arm: "Right arm", left_arm: "Left arm", right_leg: "Right leg", left_leg: "Left leg" };
// The figure, each part in the colour of the worst on it (src/body.js), with what's there when the pointer's over it.
function figureNode(body) {
  const rows = FIGURE.split("\n").map((row, y) => {
    const pieces = [];
    for (const [from, to, part] of FIGURE_PARTS[y]) {
      const text = row.slice(from, to + 1);
      if (!text) continue;
      const marks = (body?.marks ?? []).filter((mark) => mark.part === part);
      pieces.push(el("span", { class: `bag-bp bag-bp-${body?.parts?.[part] ?? "ok"}`, title: `${PART_NAMES[part]}: ${marks.length ? marks.map((mark) => mark.words).join("; ") : "fine"}` }, text));
    }
    return [...pieces, "\n"];
  });
  return el("pre", { class: "bag-figure-art", "aria-hidden": "true" }, rows);
}
const bodyNote = (body) => (body ? [body.status, body.blood !== null && body.blood < 100 ? `blood ${body.blood}` : null].filter(Boolean).join(", ") : null);

// You, with the gear: the sidearm on the hip, the weapon in hand, the armor worn and the belt of supplies for a fight.
function bodyPanel(b) {
  const body = app.ui.game?.body;
  return panel("On you", bodyNote(body), el("div", { class: "bag-figure" },
    figureNode(body),
    el("span", { class: "bag-tag", style: "left:0px;top:0px" }, "Sidearm"),
    slotNode("sidearm", `${b.sidearmSquares} squares`, 58, 30, b.gear.sidearm, 0, 13),
    el("span", { class: "bag-tag", style: "left:96px;top:0px" }, "Weapon"),
    slotNode("weapon", "in hand", 118, 30, b.gear.weapon, 96, 13),
    el("span", { class: "bag-tag", style: "left:0px;top:56px" }, "Armor"),
    slotNode("armor", "worn", 70, 70, b.gear.armor, 0, 69),
    el("span", { class: "bag-tag", style: "left:0px;top:158px" }, "Belt, for a fight"),
    b.belt.map((item, i) => slotNode(`belt-${i}`, String(i + 1), 30, 30, item, i * 34, 171, { at: "belt", i }))));
}

function gridPanel(grid, name, title, note = null) {
  const used = grid.items.reduce((sum, item) => sum + item.w * item.h, 0);
  return panel(title, note ?? `${used} of ${grid.cols * grid.rows}`,
    el("div", { class: "bag-grid", "data-grid": name, style: `width:${grid.cols * CELL + 1}px;height:${grid.rows * CELL + 1}px` },
      grid.items.map((item) => itemNode(item, { at: name, x: item.x, y: item.y }))));
}

function loadPanel(b) {
  const width = 16;
  const filled = Math.max(0, Math.min(width, Math.round((b.load / b.maxLoad) * width)));
  return panel("Load", `${b.load} of ${b.maxLoad} kg`,
    el("div", { class: `bag-load${b.overloaded ? " heavy" : ""}` }, "[", el("span", { class: "bag-load-fill" }, "#".repeat(filled)), el("span", { class: "bag-load-rest" }, "-".repeat(width - filled)), "]"),
    el("div", { class: b.overloaded ? "bag-heavy" : "check-hint" }, b.overloaded ? `Too heavy: you tire ${timesWord(b.tiring)} as fast.` : `Over ${b.maxLoad} kg, you tire ${timesWord(b.tiring)} as fast.`));
}

// What's carried with nowhere to put it: dragged into a space, or put down.
// What's written on something the player has just read, under the grids until they're done with it.
function readingPanel() {
  return el("div", { class: "bag-reading" },
    el("div", { class: "bag-tip-name" }, state.reading.name),
    el("div", { class: "bag-reading-words" }, state.reading.words),
    el("button", { class: "bag-reading-done", onclick: () => { state.reading = null; draw(); } }, "Done reading"));
}

function loosePanel(loose) {
  return el("div", { class: "bag-loose" },
    el("span", { class: "check-hint" }, "In your hands, with no room for them:"),
    loose.map((item) => el("span", { class: "bag-loose-item" }, itemNode(item, { at: "loose", id: item.id }, true))));
}

function windowNode() {
  const g = app.ui.game;
  const b = g.bag;
  return el("div", { class: "check-window bag-window", id: "bag-window", "data-theme": "green", role: "dialog", "aria-label": "Inventory", tabindex: "-1" },
    el("header", { class: "check-title" },
      el("span", { class: "check-name" }, "Inventory"),
      el("span", { class: "check-skill" }, g.name),
      el("span", { class: "check-difficulty" }, `CR ${g.credits}`),
      el("button", { class: "bag-close", onclick: closeBag, title: "Or press I or Esc" }, "Close")),
    el("div", { class: "bag-body" },
      bodyPanel(b),
      el("div", { class: "bag-column" }, gridPanel(b.pockets, "pockets", "Pockets", "small things"), gridPanel(b.pack, "pack", "Pack"), loadPanel(b)),
      b.open && el("div", { class: "bag-column" },
        gridPanel(b.open, "open", b.open.name),
        el("button", { class: "bag-take-all", disabled: !b.open.items.length || state.sending, onclick: takeAll }, "Take everything"))),
    b.loose.length > 0 && loosePanel(b.loose),
    state.reading && readingPanel(),
    el("footer", { class: "check-taskbar" },
      el("span", { class: state.message ? "bag-said" : "check-hint" }, state.message ?? "Drag to move   double-click to put on, use or take   right-click for more"),
      el("span", { class: "check-spacer" }),
      el("span", { class: "check-hint" }, "I or Esc closes")));
}

// ---- What an item is ------------------------------------------------------------------------------------

// The rig in the pack says what's loaded on it and the memory left, and opens its page.
function rigLine() {
  const rig = app.ui.game?.rig;
  if (!rig) return null;
  const loaded = rig.programs.filter((p) => p.loaded && !p.builtIn).map((p) => p.name);
  return `${loaded.length ? `Loaded: ${loaded.join(", ")}` : "Nothing loaded"}. ${rig.memory - rig.used} of ${rig.memory} blocks free.`;
}
function openRig() {
  closeBag();
  app.openMenu?.("rig");
}

function factsOf(item) {
  if (item.id === "rig") return rigLine();
  if (item.damage) return `Damage ${item.damage[0]}-${item.damage[1]}${item.sidearm ? ", fits on the hip" : ""}`;
  if (item.defense) return `Defense +${item.defense}`;
  if (item.effect) return `${Object.entries(item.effect).map(([key, amount]) => effectWords(key, amount)).join(", ")}${item.fight ? ", usable in a fight from the belt" : ""}`;
  if (item.read) return "Something's written on it: right-click, then Read";
  return null;
}
// What a supply does, in words: stress goes down, a dressing dresses.
const effectWords = (key, amount) => (key === "stress" ? `-${amount} stress` : key === "dress" ? (amount > 1 ? `dresses ${amount} wounds` : "dresses a wound") : `+${amount} ${key === "hp" ? "health" : key}`);

function showTip(node, item) {
  if (state.drag?.moved || state.menu) return;
  hideTip();
  const win = document.getElementById("bag-window");
  if (!win) return;
  const z = zoom();
  const box = win.getBoundingClientRect();
  const at = node.getBoundingClientRect();
  const width = 220;
  let left = (at.right - box.left) / z + 6;
  if (left + width > box.width / z - 4) left = (at.left - box.left) / z - width - 6;
  const facts = factsOf(item);
  state.tip = el("div", { class: "bag-tip", style: `left:${Math.max(4, left)}px;top:${Math.max(24, (at.top - box.top) / z)}px;width:${width}px` },
    el("div", { class: "bag-tip-name" }, `${item.name}${item.n > 1 ? ` x${item.n}` : ""}`),
    el("div", { class: "check-hint" }, `${kindWord(item)}, ${item.w}x${item.h}, ${item.id === "rig" ? app.ui.game?.rig?.build?.stats?.weight ?? item.weight : item.weight} kg${item.stack > 1 ? `, ${item.stack} to a square` : ""}${item.price ? `, worth ${item.price} cr` : ""}`),
    facts && el("div", { class: "bag-tip-facts" }, facts),
    // What it's worth to the ship, and the store it has to be in for that: a tin in the pantry, a medkit in the cabinet.
    item.worth && el("div", { class: "bag-tip-facts" }, item.worth),
    item.desc && el("div", { class: "bag-tip-line" }, item.desc));
  win.append(state.tip);
}
function hideTip() {
  state.tip?.remove();
  state.tip = null;
}

// ---- Telling the server --------------------------------------------------------------------------------

// Reading something: the server keeps the words in What you know, and the window shows them until Done reading.
async function readIt(item, where) {
  if (!(await send({ action: "read", from: where }))) return;
  state.reading = { name: item.name, words: item.read };
  draw();
}

async function send(body, { quiet = false } = {}) {
  if (state.sending && !quiet) return false;
  state.sending = true;
  if (!quiet) state.reading = null;
  closeMenu();
  hideTip();
  let done = true;
  try {
    const reply = await api("/api/bag", body);
    app.ui.game = reply.game;
    if (!quiet) state.message = reply.said ? untagged(reply.said) : null;
  } catch (err) {
    done = false;
    if (!quiet) state.message = err.message;
  }
  state.sending = false;
  if (!quiet) {
    draw();
    app.renderStatus();
    // A pile put down, or emptied, shows in the room.
    app.renderWalk();
  }
  return done;
}

async function takeAll() {
  const open = app.ui.game.bag.open;
  if (!open) return;
  for (const item of [...open.items]) {
    if (!(await send({ action: "take", from: { at: "open", x: item.x, y: item.y } }))) break;
  }
}

// A second click straight after the first does what the thing is for: put it on or take it off, use it, or take it.
function clicked(item, where) {
  const key = keyOf(where);
  const now = performance.now();
  const twice = state.last.key === key && now - state.last.at < 420;
  state.last = { key: twice ? null : key, at: now };
  if (!twice) return;
  if (where.at === "open") send({ action: "take", from: where });
  else if (GEAR.includes(where.at)) send({ action: "stow", from: where });
  else if (item.type === "consumable") send({ action: "use", from: where });
  else if (item.type === "weapon" || item.type === "armor") send({ action: "equip", from: where });
  else if (item.id === "rig") openRig();
  else if (item.read) readIt(item, where);
}

// ---- Dragging ----------------------------------------------------------------------------------------------

function press(event, item, where, fitted) {
  if (event.button !== 0 || state.sending) return;
  event.preventDefault();
  // A drag of an item, not a pull of the whole window.
  event.stopPropagation();
  const box = event.currentTarget.getBoundingClientRect();
  const z = zoom();
  const grab = fitted ? { x: 0.5, y: 0.5 } : { x: (event.clientX - box.left) / (CELL * z), y: (event.clientY - box.top) / (CELL * z) };
  state.drag = { item, where, x: event.clientX, y: event.clientY, moved: false, node: event.currentTarget, grab, target: null };
  document.addEventListener("pointermove", dragMove);
  document.addEventListener("pointerup", dragEnd);
}

function dragMove(event) {
  const drag = state.drag;
  if (!drag) return;
  if (!drag.moved) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
    drag.moved = true;
    hideTip();
    closeMenu();
    drag.ghost = el("div", { class: "bag-item bag-ghost", style: `width:${drag.item.w * CELL - 2}px;height:${drag.item.h * CELL - 2}px` }, el("pre", {}, artFor(drag.item).join("\n")));
    document.getElementById("bag")?.append(drag.ghost);
    drag.node.classList.add("lifted");
  }
  const layer = document.getElementById("bag")?.getBoundingClientRect();
  if (!layer) return;
  const z = zoom();
  drag.ghost.style.left = `${(event.clientX - layer.left) / z - drag.grab.x * CELL}px`;
  drag.ghost.style.top = `${(event.clientY - layer.top) / z - drag.grab.y * CELL}px`;
  showTarget(event);
}

// Where a drop would go, and whether it can: a square on a grid, or a piece of gear.
function targetAt(event) {
  const { item, where } = state.drag;
  const b = app.ui.game.bag;
  const under = document.elementsFromPoint(event.clientX, event.clientY);
  const slot = under.find((one) => one.dataset?.slot && one.closest("#bag"));
  if (slot) {
    const name = slot.dataset.slot;
    if (name.startsWith("belt-")) {
      const i = Number(name.slice(5));
      const there = b.belt[i];
      return { el: slot, to: { at: "belt", i }, ok: item.type === "consumable" && (!there || (there.id === item.id && there.n < there.stack)) && !(where.at === "belt" && where.i === i) };
    }
    const fits = name === "weapon" ? item.type === "weapon" : name === "armor" ? item.type === "armor" : item.type === "weapon" && item.w * item.h <= b.sidearmSquares;
    return { el: slot, to: { at: name }, ok: fits && where.at !== name };
  }
  const gridEl = under.find((one) => one.dataset?.grid && one.closest("#bag"));
  if (!gridEl) return null;
  const name = gridEl.dataset.grid;
  const grid = name === "open" ? b.open : b[name];
  const box = gridEl.getBoundingClientRect();
  const cell = (box.width - zoom()) / grid.cols;
  const x = Math.round((event.clientX - box.left) / cell - state.drag.grab.x);
  const y = Math.round((event.clientY - box.top) / cell - state.drag.grab.y);
  const self = where.at === name ? grid.items.find((one) => one.x === where.x && one.y === where.y) : null;
  const onto = grid.items.find((one) => one !== self && one.x === x && one.y === y && one.id === item.id && one.n < one.stack);
  const inside = x >= 0 && y >= 0 && x + item.w <= grid.cols && y + item.h <= grid.rows;
  const clear = !grid.items.some((one) => one !== self && x < one.x + one.w && one.x < x + item.w && y < one.y + one.h && one.y < y + item.h);
  const small = name !== "pockets" || item.w * item.h === 1;
  const same = self && self.x === x && self.y === y;
  return { el: gridEl, to: { at: name, x, y }, x, y, ok: !same && (Boolean(onto) || (inside && clear && small)) };
}

function showTarget(event) {
  document.querySelectorAll("#bag .bag-drop").forEach((one) => one.remove());
  document.querySelectorAll("#bag .bag-slot.ok, #bag .bag-slot.bad").forEach((one) => one.classList.remove("ok", "bad"));
  const target = targetAt(event);
  state.drag.target = target;
  if (!target) return;
  if (target.to.at === "belt" || GEAR.includes(target.to.at)) {
    target.el.classList.add(target.ok ? "ok" : "bad");
    return;
  }
  const { item } = state.drag;
  target.el.append(el("div", { class: `bag-drop${target.ok ? "" : " bad"}`, style: `left:${target.x * CELL}px;top:${target.y * CELL}px;width:${item.w * CELL + 1}px;height:${item.h * CELL + 1}px` }));
}

function dragEnd() {
  document.removeEventListener("pointermove", dragMove);
  document.removeEventListener("pointerup", dragEnd);
  const ended = state.drag;
  state.drag = null;
  if (!ended) return;
  if (!ended.moved) {
    clicked(ended.item, ended.where);
    return;
  }
  ended.ghost?.remove();
  ended.node.classList.remove("lifted");
  document.querySelectorAll("#bag .bag-drop").forEach((one) => one.remove());
  const target = ended.target;
  if (!target) return draw();
  if (!target.ok) {
    state.message = `The ${ended.item.name} doesn't go there.`;
    return draw();
  }
  send({ action: "move", from: ended.where, to: target.to });
}

// ---- The right-click menu, in the game's console look -------------------------------------------------------

function choicesFor(item, where) {
  const b = app.ui.game.bag;
  if (where.at === "open") return [["Take", () => send({ action: "take", from: where })], ...(item.read ? [["Read", () => readIt(item, where)]] : []), ["Look", () => look(item)]];
  const list = [];
  if (item.id === "rig") list.push(["Open the rig", openRig]);
  if (GEAR.includes(where.at)) list.push(["Take off", () => send({ action: "stow", from: where })]);
  else if (item.type === "weapon" || item.type === "armor") list.push(["Put on", () => send({ action: "equip", from: where })]);
  if (item.read) list.push(["Read", () => readIt(item, where)]);
  if (item.type === "consumable") {
    list.push(["Use", () => send({ action: "use", from: where })]);
    list.push(where.at === "belt" ? ["Off the belt", () => send({ action: "stow", from: where })] : ["To the belt", () => send({ action: "equip", from: where })]);
  }
  if (item.n > 1 && (where.at === "pockets" || where.at === "pack")) list.push(["Split the stack", () => send({ action: "split", from: where })]);
  if (!(item.type === "story" && !item.price)) list.push([b.open ? `Put in ${lowerFirst(b.open.name)}` : "Put it down", () => send({ action: "drop", from: where })]);
  list.push(["Look", () => look(item)]);
  return list;
}

function look(item) {
  state.message = `${item.name}: ${item.desc}${item.id === "rig" && rigLine() ? ` ${rigLine()}` : ""}`;
  draw();
}

function openMenu(event, item, where) {
  closeMenu();
  hideTip();
  const layer = document.getElementById("bag");
  if (!layer) return;
  const z = zoom();
  const box = layer.getBoundingClientRect();
  const choices = choicesFor(item, where);
  state.menu = el("div", { class: "walk-menu bag-menu placed", "data-theme": "green", role: "menu", style: `left:${(event.clientX - box.left) / z + 4}px;top:${(event.clientY - box.top) / z + 4}px` },
    el("header", { class: "check-title" }, el("span", { class: "check-name" }, item.name)),
    el("div", { class: "options" }, choices.map(([label, run], i) => el("button", { role: "menuitem", "data-choice": i + 1, onclick: (click) => { click.stopPropagation(); run(); } },
      el("span", { class: "option-number" }, `${i + 1})`), el("span", { class: "option-label" }, label)))));
  layer.append(state.menu);
  // Kept inside the room.
  const menu = state.menu.getBoundingClientRect();
  if (menu.right > box.right) state.menu.style.left = `${(box.right - box.left - menu.width) / z - 4}px`;
  if (menu.bottom > box.bottom) state.menu.style.top = `${(box.bottom - box.top - menu.height) / z - 4}px`;
}
function closeMenu() {
  state.menu?.remove();
  state.menu = null;
}

// ---- Keys --------------------------------------------------------------------------------------------------

function onKey(event) {
  const { ui } = app;
  if (ui.screen !== "game" || !ui.game || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.closest?.("input, textarea, select") || document.getElementById("board")) return;
  if (state.menu) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    const pick = /^[1-9]$/.test(event.key) ? state.menu.querySelector(`[data-choice="${event.key}"]`) : null;
    if (pick) {
      event.preventDefault();
      pick.click();
      return;
    }
  }
  if (event.key === "Escape" && state.open && !ui.sideOpen) {
    event.preventDefault();
    closeBag();
    return;
  }
  if ((event.key === "i" || event.key === "I") && !event.repeat) {
    const g = ui.game;
    if (g.combat || g.check || g.talk || g.computer || ui.sideOpen) return;
    event.preventDefault();
    toggleBag();
  }
}
