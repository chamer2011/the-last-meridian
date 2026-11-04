// The story board: every story as boxes and arrows, to read and change, and saved to its file in world/stories.
// Everything is done by clicking: words open in a box on the right, conditions are picked from lists, names are
// made from the words. The board is drawn again from the story each time something changes, and the file is
// written from the story by public/story-text.js, the same reader the game uses, so what's saved is what plays.
// A story's written scene, when it has one, is shown the same way: its parts, and the choices between them.

import { el } from "./dom.js";
import { writeStoryText } from "./story-text.js";

const state = {
  stories: [], id: null, story: null, clock: null, next: [], written: false, places: [], facts: [], all: [],
  problems: [], tab: "notes", selected: null, expanded: null, zoom: 1, dirty: false, message: null,
  scene: null, sceneDirty: false, positions: {},
};
let nodes = [];
let wires = [];
const $ = (id) => document.getElementById(id);
const spaced = (id) => String(id ?? "").replaceAll("_", " ");
const fill = (parent, ...children) => { for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) parent.append(child); return parent; };
const STOP = new Set("if the they she he it you someone anyone a an and or of is are that this their them its in on at for as has have then when there".split(" "));

// A name made from words, for an ending or a fact, so nobody has to type one.
export function nameFrom(text) {
  const words = String(text ?? "").toLowerCase().replace(/'/g, "").split(/[^a-z0-9]+/).filter((word) => word && !STOP.has(word)).slice(0, 5).join("_").slice(0, 40).replace(/_+$/, "");
  return /^[a-z]/.test(words) && words.length >= 2 ? words : "new_name";
}

// ---- Conditions, in words ---------------------------------------------------------
function parseCondition(text) {
  return String(text ?? "").split(/\s+and\s+/i).filter((one) => one.trim()).map((raw) => {
    const words = raw.trim().split(/\s+/);
    const not = words[0]?.toLowerCase() === "not";
    if (not) words.shift();
    const [kind, ...rest] = words;
    return { not, kind: kind?.toLowerCase(), rest, raw: raw.trim() };
  });
}
const storyTitle = (id) => state.all.find((one) => one.id === id)?.title ?? id;
function conditionWords(text) {
  if (!text) return "always";
  return parseCondition(text).map((term) => {
    const no = term.not ? "unless " : "if ";
    if (term.kind === "ended") return `${no}${storyTitle(term.rest[0])} ended${term.rest[1] ? `: ${spaced(term.rest[1])}` : ""}`;
    if (term.kind === "flag") return `${no}${spaced(term.rest[0])}`;
    if (term.kind === "captain") return `${no}the player is the captain`;
    return `${no}${term.raw}`;
  }).join(" and ");
}
const firstTerm = (text) => parseCondition(text)[0] ?? null;

// ---- Talking to the game -----------------------------------------------------------
async function call(route, body) {
  const response = await fetch(route, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

// ---- Opening and closing ---------------------------------------------------------------
export async function openBoard(id = null) {
  if ($("board")) return;
  document.body.append(boardNode());
  try {
    state.stories = (await call("/api/board/stories")).stories;
    await loadStory(id ?? state.id ?? state.stories.find((one) => one.id === "main_two_weeks_of_fuel")?.id ?? state.stories.find((one) => one.kind === "main")?.id ?? state.stories[0]?.id);
  } catch (err) {
    say(err.message, false);
  }
}
export function closeBoard() {
  if (state.dirty || state.sceneDirty) {
    say("There are changes that aren't saved. Save them, or Close again to lose them.", false);
    state.dirty = false;
    state.sceneDirty = false;
    return;
  }
  $("board")?.remove();
  document.removeEventListener("keydown", onKey);
}
function onKey(event) {
  if (event.key === "Escape" && $("board") && !event.target.closest("textarea, input, select")) closeBoard();
}

function boardNode() {
  document.addEventListener("keydown", onKey);
  return el("div", { class: "board", id: "board", role: "dialog", "aria-label": "Story board" },
    el("header", { class: "board-head" },
      el("h2", {}, "Story board"),
      el("select", { id: "board-pick", title: "Which story", onchange: (event) => loadStory(event.target.value) }),
      el("nav", { class: "board-tabs", role: "tablist" },
        ...[["notes", "The story"], ["scene", "The written scene"], ["file", "As the file"]].map(([tab, label]) => el("button", { class: "board-tab", role: "tab", "data-tab": tab, "aria-selected": "false", onclick: () => showTab(tab) }, label))),
      el("span", { class: "board-status", id: "board-status" }),
      el("button", { class: "board-save", id: "board-save", onclick: save }, "Save"),
      el("button", { class: "board-close", onclick: closeBoard, title: "Or press Esc" }, "Close")),
    el("div", { class: "board-main" },
      el("section", { class: "board-wrap" },
        el("div", { class: "board-scroll", id: "board-scroll" }, el("div", { class: "board-canvas", id: "board-canvas" }, svg("svg", { class: "board-wires", id: "board-wires" }))),
        el("pre", { class: "board-text", id: "board-text", hidden: "" }),
        el("div", { class: "board-tools", id: "board-tools" },
          el("button", { onclick: () => zoomBy(-0.1), title: "Smaller" }, "−"),
          el("button", { onclick: () => zoomBy(0.1), title: "Bigger" }, "+"),
          el("button", { onclick: fit }, "Fit"))),
      el("aside", { class: "board-inspector", id: "board-inspector" })),
    el("footer", { class: "board-foot" },
      el("span", {}, "Click a box to read and change it."),
      el("span", {}, "Drag a box to move it."),
      el("span", {}, "Click the words on an arrow to change when it applies."),
      el("span", {}, "Drag the dark background to look around.")));
}
function svg(tag, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
function say(text, ok = true) {
  const status = $("board-status");
  if (!status) return;
  status.textContent = text ?? "";
  status.className = `board-status ${ok ? "ok" : "fail"}`;
}

async function loadStory(id) {
  if (!id) return;
  if (state.dirty || state.sceneDirty) {
    if (!state.leaving) {
      state.leaving = true;
      say("There are changes that aren't saved. Save them, or pick the story again to lose them.", false);
      $("board-pick").value = state.id;
      return;
    }
  }
  state.leaving = false;
  const data = await call(`/api/board/story/${id}`);
  Object.assign(state, { id, story: data.story, clock: data.clock, next: data.next, written: data.written, places: data.places, facts: data.facts, all: data.stories, problems: data.problems, selected: null, expanded: null, dirty: false, sceneDirty: false, scene: null, positions: {} });
  const pick = $("board-pick");
  pick.replaceChildren(...["main", "crew", "dilemma", "mystery", "exploration", "survival", "politics", "job", "faction"].map((kind) => {
    const group = el("optgroup", { label: kind });
    for (const one of state.stories.filter((story) => story.kind === kind)) group.append(el("option", { value: one.id, selected: one.id === id ? "selected" : null }, `${one.title}${one.written ? " ✓" : ""}`));
    return group;
  }).filter((group) => group.children.length));
  pick.value = id;
  showTab(state.tab === "scene" && !state.written ? "notes" : state.tab);
  say(state.problems.length ? `${state.problems.length} ${state.problems.length === 1 ? "thing" : "things"} the checker would like changed. They're marked in red.` : "");
}

// ---- The boxes and arrows, from the story -------------------------------------------------
const S = () => state.story;
const C = () => state.clock;
const endingIds = () => S().gm.outcomes.map((one) => one.id);
const endNode = (ending) => (ending && endingIds().includes(ending) ? `end_${ending}` : "lead");
const UNFOLDS = ["fact", "consequence", "next"];

function notesGraph() {
  const story = S(), clock = C();
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  add({ id: "about", kind: "about", col: 0, name: story.title, text: `${story.kind}. ${story.places.join(", ")}.${story.after ? ` After ${storyTitle(story.after)}.` : ""}`, label: "About this story" });
  (story.gm.reacts ?? []).forEach((one, i) => {
    add({ id: `react${i}`, kind: "react", col: 0, name: conditionWords(one.to), text: one.then, label: "The record changes this", cond: one.to, bind: { react: i } });
    ws.push({ from: `react${i}`, to: "lead", kind: "cond" });
  });
  add({ id: "lead", kind: "lead", col: 1, name: "The lead", text: story.lead, label: "What the player hears", bind: { text: "lead" } });
  if (story.anyone !== undefined) add({ id: "anyone", kind: "truth", col: 1, name: "For anyone who isn't the captain", text: story.anyone, label: "The lead, for others", bind: { text: "anyone" } });
  add({ id: "truth", kind: "truth", col: 1, name: "What's really going on", text: story.gm.truth, label: "For the game master only", bind: { gm: "truth" } });
  ws.push({ from: "lead", to: "truth" });
  story.gm.beats.forEach((beat, i) => {
    add({ id: `beat${i}`, kind: "beat", col: 1, name: `How it might go, ${i + 1}`, text: beat, label: "A beat", bind: { list: "beats", i } });
    ws.push({ from: i ? `beat${i - 1}` : "truth", to: `beat${i}` });
  });
  add({ id: "ways", kind: "route", col: 2, name: "Ways through", text: story.gm.routes.join("\n"), label: `${story.gm.routes.length} ways`, bind: { lines: "routes" } });
  ws.push({ from: "lead", to: "ways" });
  add({ id: "checks", kind: "route", col: 2, name: "Checks and fights", text: [...story.gm.checks, ...story.gm.fights].join("\n"), label: "What the dice decide", bind: { checks: true } });
  add({ id: "rewards", kind: "truth", col: 2, name: "Rewards", text: story.gm.rewards, label: "What the player gets", bind: { gm: "rewards" } });
  story.gm.outcomes.forEach((one, i) => {
    add({ id: `end_${one.id}`, kind: "ending", col: 3, name: spaced(one.id), text: one.text, label: "An ending", ending: one.id, bind: { outcome: i } });
    ws.push({ from: "ways", to: `end_${one.id}` });
  });
  for (const [name, line] of Object.entries(story.gm.facts ?? {})) {
    add({ id: `fact_${name}`, kind: "fact", col: 4, name: spaced(name), text: line, label: "A fact it leaves", fact: name });
    ws.push({ from: endNode(story.gm.factAfter?.[name]), to: `fact_${name}` });
  }
  (clock.consequences ?? []).forEach((one, i) => {
    add({ id: `cons${i}`, kind: "consequence", col: 4, name: `${one.after} days later`, text: one.news, label: "A consequence", cond: one.of, bind: { cons: i } });
    const term = firstTerm(one.of);
    ws.push({ from: term?.kind === "ended" && !term.not ? endNode(term.rest[1]) : "lead", to: `cons${i}`, kind: "timer" });
    for (const name of Object.keys(one.facts ?? {})) if (list.some((node) => node.id === `fact_${name}`)) ws.push({ from: `cons${i}`, to: `fact_${name}`, kind: "timer" });
  });
  state.next.forEach((one, i) => {
    add({ id: `next${i}`, kind: "next", col: 4, name: `${one.title} (${one.where})`, text: one.then, label: "Another story reacts", cond: one.to, story: one.story });
    const term = firstTerm(one.to);
    ws.push({ from: term?.kind === "ended" && !term.not ? endNode(term.rest[1]) : "lead", to: `next${i}`, kind: "cond" });
  });
  clock.stages.forEach((stage, i) => {
    add({ id: `stage${i}`, kind: "clock", col: 1 + i, row: "clock", name: `Day ${stage.after}, if nobody steps in`, text: stage.news, label: "The clock", cond: stage.if ?? null, bind: { stage: i } });
    ws.push({ from: i ? `stage${i - 1}` : "lead", to: `stage${i}`, words: i ? (stage.if ? conditionWords(stage.if) : "then") : "if nobody steps in", kind: stage.if ? "cond" : "timer", stage: i });
  });
  return { list, ws };
}

function sceneGraph() {
  const scene = state.scene;
  const list = [], ws = [];
  const byName = Object.fromEntries(scene.parts.map((part) => [part.name, part]));
  const depth = { start: 0 };
  const queue = ["start"];
  const targets = (part) => [...part.choices.flatMap((one) => [one.to, one.pass, one.fail]), ...part.when.map((one) => one.to), part.pass, part.fail, part.won, part.lost, part.fled, part.gaveUp, part.talked].filter(Boolean);
  while (queue.length) {
    const name = queue.shift();
    for (const target of targets(byName[name] ?? { choices: [], when: [] })) if (depth[target] === undefined) { depth[target] = depth[name] + 1; queue.push(target); }
  }
  scene.parts.forEach((part, i) => {
    const kind = part.end ? "end" : part.check || part.fight ? "check" : "part";
    list.push({ id: `p_${part.name}`, kind, col: depth[part.name] ?? Math.max(1, ...Object.values(depth)) + 1, name: part.name, text: part.text || (part.fight ? `A fight: ${part.fight}.` : "..."), label: part.end ? "The end" : part.check ? `A check: ${part.check}` : part.fight ? `A fight: ${part.fight}` : "A part", part: i, problem: state.scene.problems.some((one) => one.includes(`part ${part.name} `) || one.includes(`part ${part.name},`)) });
  });
  const stub = (target) => { const id = `p_${target}`; if (!list.some((node) => node.id === id)) list.push({ id, kind: "stub", col: (depth[target] ?? 8), name: target, text: "There's no part with this name yet.", label: "Missing" }); return id; };
  scene.parts.forEach((part, i) => {
    part.choices.forEach((one, k) => {
      const check = one.check ? `[${one.check}] ` : "";
      if (one.to) ws.push({ from: `p_${part.name}`, to: stub(one.to), words: `${check}${one.say}`, kind: "choice", part: i, choice: k });
      if (one.pass) ws.push({ from: `p_${part.name}`, to: stub(one.pass), words: `${check}${one.say}: passed`, kind: "choice", part: i, choice: k });
      if (one.fail) ws.push({ from: `p_${part.name}`, to: stub(one.fail), words: `${check}${one.say}: failed`, kind: "choice", part: i, choice: k });
    });
    part.when.forEach((one, k) => { if (one.to) ws.push({ from: `p_${part.name}`, to: stub(one.to), words: conditionWords(one.if), kind: "cond", part: i, rule: k }); });
    for (const [key, words] of [["pass", "passed"], ["fail", "failed"], ["won", "won"], ["lost", "lost"], ["fled", "fled"], ["gaveUp", "gave up"], ["talked", "talked"]]) if (part[key]) ws.push({ from: `p_${part.name}`, to: stub(part[key]), words, kind: "choice", part: i, outcome: key });
  });
  return { list, ws };
}

function build() {
  const graph = state.tab === "scene" ? sceneGraph() : notesGraph();
  nodes = graph.list;
  wires = graph.ws;
  for (const node of nodes) node.problem ??= state.problems.some((one) => problemTouches(one, node));
}
// Whether the checker's problem is about this box, so it can be marked.
function problemTouches(problem, node) {
  const id = state.id;
  if (node.kind === "ending") return problem.includes(`outcome ${node.bind.outcome + 1}`) || problem.includes(`called ${node.ending}`);
  if (node.kind === "fact") return problem.includes(`facts: ${node.fact}`) || problem.includes(`fact ${node.fact}`);
  if (node.kind === "react") return problem.includes(`reacts ${node.bind.react + 1}`);
  if (node.kind === "consequence") return problem.includes(`${id}, consequence ${node.bind.cons + 1}`);
  if (node.kind === "clock") return problem.includes(`${id}, stage ${node.bind.stage + 1}`);
  if (node.kind === "about") return problem.startsWith(`stories/${id}.txt`);
  return false;
}

// ---- Laying it out and drawing it ------------------------------------------------------------
const GAP = 18, TOP = 20;
let COL_W = 300, LEFT = 20;
function visibleNodes() {
  if (state.tab !== "notes") return nodes;
  const focus = state.expanded ?? nodes.find((node) => node.kind === "ending")?.id;
  const shown = new Set(nodes.filter((node) => !UNFOLDS.includes(node.kind)).map((node) => node.id));
  const reach = (id) => { for (const wire of wires) if (wire.from === id && !shown.has(wire.to)) { shown.add(wire.to); reach(wire.to); } };
  if (focus) reach(focus);
  for (const wire of wires) if (wire.from === "lead" && UNFOLDS.includes(nodes.find((node) => node.id === wire.to)?.kind)) { shown.add(wire.to); reach(wire.to); }
  return nodes.filter((node) => shown.has(node.id));
}
function layout() {
  COL_W = state.tab === "scene" ? 390 : 300;
  LEFT = state.tab === "scene" ? 20 : 150;
  const visible = visibleNodes();
  for (const node of nodes) node.hidden = !visible.includes(node);
  const cols = {};
  for (const node of visible) if (node.row !== "clock") (cols[node.col] ??= []).push(node);
  let bottom = TOP;
  for (const [col, list] of Object.entries(cols)) {
    let y = TOP;
    for (const node of list) {
      const saved = state.positions[`${state.tab}:${node.id}`];
      node.x = saved?.x ?? LEFT + Number(col) * COL_W;
      node.y = saved?.y ?? y;
      y = Math.max(y, node.y) + (node.h ?? 110) + GAP;
      bottom = Math.max(bottom, y);
    }
  }
  let x = LEFT + COL_W;
  for (const node of visible.filter((one) => one.row === "clock")) {
    const saved = state.positions[`${state.tab}:${node.id}`];
    node.x = saved?.x ?? x;
    node.y = saved?.y ?? bottom + 30;
    x += COL_W;
  }
}

function render() {
  const canvas = $("board-canvas");
  if (!canvas) return;
  for (const old of canvas.querySelectorAll(".board-node, .board-label")) old.remove();
  canvas.classList.toggle("scene", state.tab === "scene");
  for (const node of nodes) node.el = null;
  for (const node of nodes.filter((one) => !one.hidden)) {
    const div = el("div", { class: `board-node ${node.kind}${node.problem ? " problem" : ""}`, "data-id": node.id, tabindex: "0", role: "button" },
      el("div", { class: "kind" }, node.label, node.kind === "ending" ? el("span", { class: "tag" }, node.ending) : null),
      el("div", { class: "name" }, node.name),
      node.cond !== undefined && node.kind !== "react" ? el("div", { class: "when" }, conditionWords(node.cond)) : null,
      el("div", { class: "words" }, node.text));
    if (state.selected?.node === node.id) div.classList.add("selected");
    div.style.left = `${node.x}px`;
    div.style.top = `${node.y}px`;
    canvas.append(div);
    node.el = div;
  }
  let changed = false;
  const drawn = nodes.filter((one) => one.el);
  for (const node of drawn) { const h = node.el.offsetHeight; if (node.h !== h) { node.h = h; changed = true; } }
  if (changed) { layout(); for (const node of drawn) { node.el.style.left = `${node.x}px`; node.el.style.top = `${node.y}px`; } }
  drawWires();
  const w = Math.max(400, ...drawn.map((node) => node.x + node.el.offsetWidth)) + 60;
  const h = Math.max(300, ...drawn.map((node) => node.y + node.h)) + 60;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const lines = $("board-wires");
  lines.setAttribute("width", w);
  lines.setAttribute("height", h);
  canvas.style.transform = `scale(${state.zoom})`;
}
function drawWires() {
  const canvas = $("board-canvas"), lines = $("board-wires");
  lines.replaceChildren();
  for (const old of canvas.querySelectorAll(".board-label")) old.remove();
  const defs = svg("defs");
  defs.innerHTML = '<marker id="board-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#5f9c75"></path></marker>';
  lines.append(defs);
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
  wires.forEach((wire, i) => {
    const a = byId[wire.from], b = byId[wire.to];
    if (!a?.el || !b?.el) return;
    const aw = a.el.offsetWidth, bw = b.el.offsetWidth;
    const margin = wire.stage === 0;
    const down = (a.row !== "clock" && b.row === "clock") || (b.y > a.y + a.h + 40 && Math.abs(b.x - a.x) < 80);
    const x1 = margin ? a.x : down ? a.x + aw / 2 : a.x + aw, y1 = margin ? a.y + a.h / 2 : down ? a.y + a.h : a.y + a.h / 2;
    const x2 = down && !margin ? b.x + bw / 2 : b.x, y2 = down && !margin ? b.y : b.y + b.h / 2;
    const d = margin ? `M${x1},${y1} L${a.x - 70},${y1} L${a.x - 70},${y2} L${x2},${y2}` : down ? `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}` : `M${x1},${y1} C${x1 + 60},${y1} ${x2 - 60},${y2} ${x2},${y2}`;
    const lit = state.selected?.wire === i || state.selected?.node === wire.from || state.selected?.node === wire.to;
    const path = svg("path", { d, class: `${wire.kind ?? ""}${lit ? " lit" : ""}`, "marker-end": "url(#board-arrow)" });
    lines.append(path);
    // On the scene board the words on arrows would pile up, so they show for the part that's selected.
    const sel = state.selected;
    const showWords = state.tab !== "scene" || (sel && (sel.wire === i || sel.node === wire.from || sel.node === wire.to));
    if (wire.words && showWords) {
      const t = margin ? 0.5 : 0.66;
      const sameTarget = wires.filter((other, k) => k < i && other.to === wire.to && other.words).length;
      const label = el("div", { class: `board-label ${wire.kind ?? ""}${state.selected?.wire === i ? " selected" : ""}`, "data-wire": i, tabindex: "0", role: "button" }, wire.words);
      label.style.left = `${margin ? a.x - 70 : x1 + (x2 - x1) * t}px`;
      label.style.top = `${margin ? (y1 + y2) / 2 : y1 + (y2 - y1) * t + sameTarget * 16}px`;
      canvas.append(label);
    }
  });
}
function redraw() {
  build();
  layout();
  render();
  layout();
  render();
  inspect();
  if (state.tab === "file") $("board-text").textContent = fileText();
}
function fileText() {
  if (state.tab === "scene" || (state.scene && state.tab === "file" && state.lastBoard === "scene")) return sceneText();
  return writeStoryText(S(), C());
}
const sceneText = () => (state.scene ? [state.scene.header, ...state.scene.parts.map((part) => `== ${part.name}\n${part.raw}`)].join("\n") : "");

// ---- Tabs, zoom and looking around ------------------------------------------------------------
async function showTab(tab) {
  if (tab === "scene" && !state.written) {
    say(`${S().title} has no written scene yet. The AI runs it from these notes.`, false);
    tab = "notes";
  }
  if (tab !== "file") state.lastBoard = tab;
  if (tab === "scene" && !state.scene) {
    try {
      state.scene = await call(`/api/board/scene/${state.id}`);
    } catch (err) {
      say(err.message, false);
      tab = "notes";
    }
  }
  state.tab = tab;
  state.selected = null;
  for (const button of document.querySelectorAll(".board-tab")) button.setAttribute("aria-selected", String(button.dataset.tab === tab));
  const text = tab === "file";
  $("board-text").hidden = !text;
  $("board-scroll").hidden = text;
  $("board-tools").hidden = text;
  redraw();
  if (!text) fit();
}
function zoomBy(amount) {
  state.zoom = Math.min(1.6, Math.max(0.4, state.zoom + amount));
  render();
}
function fit() {
  const canvas = $("board-canvas"), scroll = $("board-scroll");
  if (!canvas || !scroll) return;
  state.zoom = Math.max(0.6, Math.min(1, scroll.clientWidth / (canvas.offsetWidth + 20)));
  render();
  scroll.scrollTo(0, 0);
}

// ---- Clicking and dragging ------------------------------------------------------------------------
let drag = null, pan = null;
document.addEventListener("pointerdown", (event) => {
  const canvas = $("board-canvas");
  if (!canvas) return;
  const nodeEl = event.target.closest(".board-node");
  if (nodeEl && canvas.contains(nodeEl)) {
    const node = nodes.find((one) => one.id === nodeEl.dataset.id);
    drag = { node, startX: event.clientX, startY: event.clientY, x: node.x, y: node.y, moved: false };
    try { nodeEl.setPointerCapture(event.pointerId); } catch { /* fine without */ }
    return;
  }
  const scroll = $("board-scroll");
  if (event.target === scroll || event.target === canvas || event.target === $("board-wires")) {
    pan = { x: event.clientX, y: event.clientY, left: scroll.scrollLeft, top: scroll.scrollTop };
    scroll.classList.add("dragging");
  }
});
document.addEventListener("pointermove", (event) => {
  if (drag) {
    const dx = (event.clientX - drag.startX) / state.zoom, dy = (event.clientY - drag.startY) / state.zoom;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    drag.node.x = Math.max(0, drag.x + dx);
    drag.node.y = Math.max(0, drag.y + dy);
    state.positions[`${state.tab}:${drag.node.id}`] = { x: drag.node.x, y: drag.node.y };
    drag.node.el.style.left = `${drag.node.x}px`;
    drag.node.el.style.top = `${drag.node.y}px`;
    drawWires();
  } else if (pan) {
    const scroll = $("board-scroll");
    scroll.scrollLeft = pan.left - (event.clientX - pan.x);
    scroll.scrollTop = pan.top - (event.clientY - pan.y);
  }
});
document.addEventListener("pointerup", () => {
  if (drag) {
    const { node, moved } = drag;
    drag = null;
    if (!moved) select({ node: node.id });
    else render();
  }
  if (pan) {
    pan = null;
    $("board-scroll")?.classList.remove("dragging");
  }
});
document.addEventListener("click", (event) => {
  const label = event.target.closest(".board-label");
  if (label && $("board-canvas")?.contains(label)) select({ wire: Number(label.dataset.wire) });
});
document.addEventListener("keydown", (event) => {
  if (!$("board") || (event.key !== "Enter" && event.key !== " ")) return;
  const nodeEl = event.target.closest(".board-node"), label = event.target.closest(".board-label");
  if (nodeEl) select({ node: nodeEl.dataset.id });
  else if (label) select({ wire: Number(label.dataset.wire) });
  else return;
  event.preventDefault();
});
function select(what) {
  state.selected = what;
  const node = what.node ? nodes.find((one) => one.id === what.node) : null;
  if (node?.kind === "ending") { state.expanded = node.id; layout(); }
  render();
  inspect();
}

// ---- Changing things ---------------------------------------------------------------------------
function changed() {
  if (state.tab === "scene") state.sceneDirty = true;
  else state.dirty = true;
  redraw();
}
function textOf(node) {
  const story = S(), b = node.bind ?? {};
  if (b.text) return story[b.text] ?? "";
  if (b.gm) return story.gm[b.gm] ?? "";
  if (b.list) return story.gm[b.list][b.i];
  if (b.lines) return story.gm[b.lines].join("\n");
  if (b.outcome !== undefined) return story.gm.outcomes[b.outcome].text;
  if (node.fact) return story.gm.facts[node.fact];
  if (b.cons !== undefined) return C().consequences[b.cons].news;
  if (b.stage !== undefined) return C().stages[b.stage].news;
  if (b.react !== undefined) return story.gm.reacts[b.react].then;
  return node.text;
}
function setText(node, value) {
  const story = S(), b = node.bind ?? {};
  const text = value.trim();
  if (b.text) story[b.text] = text;
  else if (b.gm) story.gm[b.gm] = text;
  else if (b.list) story.gm[b.list][b.i] = text;
  else if (b.lines) story.gm[b.lines] = value.split("\n").map((one) => one.trim()).filter(Boolean);
  else if (b.outcome !== undefined) story.gm.outcomes[b.outcome].text = text;
  else if (node.fact) story.gm.facts[node.fact] = text;
  else if (b.cons !== undefined) C().consequences[b.cons].news = text;
  else if (b.stage !== undefined) C().stages[b.stage].news = text;
  else if (b.react !== undefined) story.gm.reacts[b.react].then = text;
}
function renameEnding(index, name) {
  const story = S();
  const old = story.gm.outcomes[index].id;
  if (!name || name === old) return;
  story.gm.outcomes[index].id = name;
  for (const [fact, after] of Object.entries(story.gm.factAfter ?? {})) if (after === old) story.gm.factAfter[fact] = name;
  const swap = (text) => (typeof text === "string" ? text.replace(new RegExp(`ended ${state.id} ${old}(?!\\w)`, "g"), `ended ${state.id} ${name}`) : text);
  for (const one of story.gm.reacts ?? []) one.to = swap(one.to);
  for (const one of C().consequences ?? []) one.of = swap(one.of);
  for (const one of C().stages) { one.if = swap(one.if); if (one.ending === old) one.ending = name; }
  state.expanded = `end_${name}`;
  state.selected = { node: `end_${name}` };
}
function renameFact(oldName, name) {
  const story = S();
  if (!name || name === oldName || story.gm.facts[name]) return;
  story.gm.facts = Object.fromEntries(Object.entries(story.gm.facts).map(([key, line]) => [key === oldName ? name : key, line]));
  if (story.gm.factAfter?.[oldName]) { story.gm.factAfter[name] = story.gm.factAfter[oldName]; delete story.gm.factAfter[oldName]; }
  state.selected = { node: `fact_${name}` };
}
function remove(node) {
  const story = S(), clock = C(), b = node.bind ?? {};
  if (b.list) story.gm[b.list].splice(b.i, 1);
  else if (b.outcome !== undefined) {
    const id = story.gm.outcomes[b.outcome].id;
    story.gm.outcomes.splice(b.outcome, 1);
    for (const [fact, after] of Object.entries(story.gm.factAfter ?? {})) if (after === id) delete story.gm.factAfter[fact];
    state.expanded = null;
  } else if (node.fact) { delete story.gm.facts[node.fact]; delete story.gm.factAfter?.[node.fact]; }
  else if (b.cons !== undefined) clock.consequences.splice(b.cons, 1);
  else if (b.stage !== undefined) clock.stages.splice(b.stage, 1);
  else if (b.react !== undefined) story.gm.reacts.splice(b.react, 1);
  state.selected = null;
  changed();
}
function addEnding() {
  const story = S();
  let name = "new_ending", n = 2;
  while (story.gm.outcomes.some((one) => one.id === name)) name = `new_ending_${n++}`;
  story.gm.outcomes.push({ id: name, text: "What's true if the story ends this way." });
  state.expanded = `end_${name}`;
  state.selected = { node: `end_${name}` };
  changed();
}
function addFact(after = null) {
  const story = S();
  story.gm.facts ??= {};
  let name = "new_fact", n = 2;
  while (story.gm.facts[name]) name = `new_fact_${n++}`;
  story.gm.facts[name] = "What's true from now on, in a line.";
  if (after) (story.gm.factAfter ??= {})[name] = after;
  state.selected = { node: `fact_${name}` };
  changed();
}
function addConsequence(ending = null) {
  const clock = C();
  clock.consequences ??= [];
  clock.consequences.push({ of: `ended ${state.id}${ending ? ` ${ending}` : ""}`, after: 7, news: "What people hear, that many days later." });
  state.selected = { node: `cons${clock.consequences.length - 1}` };
  changed();
}
function addStage() {
  const clock = C();
  const last = clock.stages.at(-1)?.after ?? 0;
  clock.stages.push({ after: last + 14, news: "What happens by itself, if nobody has stepped in.", lead: "What the lead says from then on." });
  state.selected = { node: `stage${clock.stages.length - 1}` };
  changed();
}
function addReaction() {
  const story = S();
  story.gm.reacts ??= [];
  const other = state.all.find((one) => one.id !== state.id && one.endings.length) ?? state.all[0];
  story.gm.reacts.push({ to: `ended ${other.id}${other.endings[0] ? ` ${other.endings[0]}` : ""}`, then: "What changes in this story when that's so." });
  state.selected = { node: `react${story.gm.reacts.length - 1}` };
  changed();
}
function addBeat(after) {
  S().gm.beats.splice(after + 1, 0, "What might happen next.");
  state.selected = { node: `beat${after + 1}` };
  changed();
}

// ---- The inspector: what's selected, and the ways to change it -----------------------------------
const h2 = (text) => el("h2", {}, text);
const hint = (text) => el("div", { class: "hint" }, text);
const row = (...children) => fill(el("div", { class: "row" }), ...children);
const button = (text, onclick, extra = {}) => el("button", { type: "button", onclick, ...extra }, text);
const textarea = (id, value, lines = 6) => { const area = el("textarea", { id, rows: String(lines) }); area.value = value ?? ""; return area; };
const picker = (id, options, value) => { const pick = el("select", { id }); for (const [v, label] of options) pick.append(el("option", { value: v }, label)); pick.value = value; return pick; };

function inspect() {
  const inspector = $("board-inspector");
  if (!inspector) return;
  inspector.replaceChildren();
  const sel = state.selected;
  if (state.tab === "file") return fill(inspector, h2("The file"), hint("This is the same story, written the way its file holds it. The board is read from this, and Save writes it, so the file can still be changed by hand, on GitHub or in Notepad."));
  if (!sel) return inspectNothing(inspector);
  if (sel.wire !== undefined) return inspectWire(inspector, wires[sel.wire], sel.wire);
  const node = nodes.find((one) => one.id === sel.node);
  if (!node) return inspectNothing(inspector);
  if (state.tab === "scene") return inspectPart(inspector, node);
  return inspectNode(inspector, node);
}
function inspectNothing(inspector) {
  const story = S();
  fill(inspector,
    h2(story.title),
    hint(state.tab === "notes"
      ? "The story's notes as a board: the lead and the beats, the ways through, and the endings by name. Click an ending and the facts it leaves, what follows days later, and the stories that react to it unfold beside it. Click any box to read all of it and change it."
      : "The written scene: each box is a part, each arrow a choice, a check's two ways, or a rule that moves the player on. Click a part and the words on its arrows appear; click those to change a choice."),
    el("div", { class: "legend" }, ...(state.tab === "notes"
      ? [["lead", "the lead"], ["beat", "beats"], ["route", "ways through"], ["ending", "endings"], ["fact", "facts"], ["consequence", "consequences"], ["clock", "the clock"], ["next", "other stories"]]
      : [["beat", "parts"], ["ending", "checks and fights"], ["end", "ends"], ["clock", "missing"]]).map(([kind, words]) => el("span", { class: `l-${kind}` }, words))),
    state.tab === "notes" ? row(button("+ an ending", addEnding), button("+ a fact", () => addFact()), button("+ something days later", () => addConsequence()), button("+ a stage of the clock", addStage), button("+ what changes this story", addReaction)) : null,
    state.problems.length ? el("div", { class: "problems" }, h2("The checker says"), ...state.problems.map((one) => el("div", {}, one))) : hint("The checker has nothing to say about this story."),
    hint("Save writes the file in world/stories, and the game plays the new version from the next turn."));
}

function inspectNode(inspector, node) {
  const story = S(), clock = C(), b = node.bind ?? {};
  if (node.kind === "about") return inspectAbout(inspector);
  if (node.kind === "next") {
    return fill(inspector, h2("Another story reacts"), el("h3", {}, node.name), hint(`When: ${conditionWords(node.cond)}.`), el("div", { class: "quote" }, node.text), row(button(`Open ${storyTitle(node.story)}`, () => loadStory(node.story))), hint("It's written in that story's file, so it's changed there."));
  }
  const nameBox = el("input", { id: "edit-name", type: "text", class: "name-box" });
  nameBox.value = node.ending ?? node.fact ?? "";
  const area = textarea("edit-text", textOf(node), b.lines || b.checks ? 8 : 6);
  const checksArea = b.checks ? textarea("edit-fights", story.gm.fights.join("\n"), 4) : null;
  if (b.checks) area.value = story.gm.checks.join("\n");
  const keep = () => {
    if (b.checks) {
      story.gm.checks = area.value.split("\n").map((one) => one.trim()).filter(Boolean);
      story.gm.fights = checksArea.value.split("\n").map((one) => one.trim()).filter(Boolean);
    } else setText(node, area.value);
    if (node.ending !== undefined) renameEnding(b.outcome, nameBox.value.trim() || nameFrom(area.value));
    if (node.fact !== undefined) renameFact(node.fact, nameBox.value.trim());
    changed();
  };
  fill(inspector,
    h2(node.label),
    node.ending !== undefined || node.fact !== undefined
      ? el("div", {}, el("label", { for: "edit-name" }, node.ending !== undefined ? "Its name, which other stories use. Leave it empty and it's made from the words." : "The fact's name, which conditions use"), nameBox, node.ending !== undefined ? row(button("Name it from the words", () => { nameBox.value = nameFrom(area.value); })) : null)
      : el("h3", {}, node.name),
    el("label", { for: "edit-text" }, b.lines ? "One way through on each line" : b.checks ? "Checks that fit, one on each line: a skill, a colon, easy, moderate or hard, and what it's for" : node.kind === "ending" ? "What's true if the story ends this way" : node.kind === "fact" ? "The line the player and the AI read" : node.kind === "consequence" || node.kind === "clock" ? "What people hear" : node.kind === "react" ? "What changes in this story" : "The words"),
    area,
    checksArea ? el("label", { for: "edit-fights" }, "If it comes to a fight, one on each line: enemy ids, and when") : null,
    checksArea,
    row(button("Keep", keep), button("Undo", () => inspect())),
    node.kind === "ending" ? row(button("+ a fact it leaves", () => addFact(node.ending)), button("+ something days later", () => addConsequence(node.ending))) : null,
    node.kind === "beat" ? row(button("+ a beat after this", () => addBeat(b.i))) : null,
    node.kind === "fact" ? factAfterRow(node) : null,
    node.kind === "consequence" ? [daysRow(clock.consequences[b.cons]), conditionPicker(clock.consequences[b.cons], "of", "What has to be on the record"), placeRow(clock.consequences[b.cons]), subFacts(clock.consequences[b.cons])] : null,
    node.kind === "clock" ? [daysRow(clock.stages[b.stage]), stageLeadRow(clock.stages[b.stage]), conditionPicker(clock.stages[b.stage], "if", "Only if", true), placeRow(clock.stages[b.stage]), subFacts(clock.stages[b.stage]), stageEndingRow(clock.stages[b.stage]), otherLines(clock.stages[b.stage])] : null,
    node.kind === "react" ? conditionPicker(story.gm.reacts[b.react], "to", "When this is on the record") : null,
    ["beat", "ending", "fact", "consequence", "clock", "react"].includes(node.kind) ? row(button("Remove", () => remove(node), { class: "danger" })) : null,
    node.problem ? el("div", { class: "problems" }, ...state.problems.filter((one) => problemTouches(one, node)).map((one) => el("div", {}, one))) : null,
    hint("Keep changes the box and the file together. Save writes the file."));
}
function inspectAbout(inspector) {
  const story = S(), clock = C();
  const title = el("input", { id: "edit-title", type: "text", class: "name-box" });
  title.value = story.title;
  const kind = picker("edit-kind", ["main", "crew", "dilemma", "mystery", "exploration", "survival", "politics", "job", "faction"].map((one) => [one, one]), story.kind);
  const after = picker("edit-after", [["", "nothing: it can start on its own"], ...state.all.filter((one) => one.id !== state.id).map((one) => [one.id, one.title])], story.after ?? "");
  const level = picker("edit-level", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((one) => [String(one), `level ${one}`]), String(story.minLevel ?? 1));
  const places = el("input", { id: "edit-places", type: "text", class: "name-box" });
  places.value = story.places.join(", ");
  const people = el("input", { id: "edit-people", type: "text", class: "name-box" });
  people.value = story.people.join(", ");
  const factions = el("input", { id: "edit-factions", type: "text", class: "name-box" });
  factions.value = story.factions.join(", ");
  fill(inspector,
    h2("About this story"),
    el("label", { for: "edit-title" }, "Its title"), title,
    row(el("label", { for: "edit-kind" }, "What kind of story"), kind),
    row(el("label", { for: "edit-after" }, "Comes after"), after),
    row(el("label", { for: "edit-level" }, "For a player of at least"), level),
    el("label", { for: "edit-places" }, "Where it happens: place ids, the first is where the lead comes up"), places,
    el("label", { for: "edit-people" }, "Who's in it: people's ids"), people,
    el("label", { for: "edit-factions" }, "Which factions"), factions,
    clock.waits ? hint(`Its clock waits: ${clock.waits}`) : null,
    row(button("Keep", () => {
      story.title = title.value.trim() || story.title;
      story.kind = kind.value;
      story.after = after.value || null;
      story.minLevel = Number(level.value);
      const list = (box) => box.value.split(",").map((one) => one.trim()).filter(Boolean);
      story.places = list(places);
      story.people = list(people);
      story.factions = list(factions);
      changed();
    }), button("Undo", () => inspect())),
    hint(`The file is world/stories/${state.id}.txt. Its name doesn't change here.`));
}
function daysRow(holder) {
  const days = picker("edit-days", [0, 1, 2, 3, 5, 7, 10, 14, 18, 20, 25, 30, 38, 45, 60, 75, 90, 120].map((one) => [String(one), one === 0 ? "the same day" : `${one} days`]), String(holder.after));
  if (![...days.options].some((one) => one.value === String(holder.after))) days.append(el("option", { value: String(holder.after), selected: "selected" }, `${holder.after} days`));
  days.value = String(holder.after);
  return row(el("label", { for: "edit-days" }, "After"), days, button("Keep", () => { holder.after = Number(days.value); changed(); }));
}
function placeRow(holder) {
  const place = picker("edit-place", [["", "the story's first place"], ...state.places.map((one) => [one.id, one.name])], holder.place ?? "");
  const big = el("input", { id: "edit-big", type: "checkbox" });
  big.checked = Boolean(holder.big);
  return row(el("label", { for: "edit-place" }, "Where"), place, el("label", { for: "edit-big" }, "everyone who knows the place hears it"), big, button("Keep", () => { if (place.value) holder.place = place.value; else delete holder.place; if (big.checked) holder.big = true; else delete holder.big; changed(); }));
}
function stageLeadRow(stage) {
  const area = textarea("edit-lead", stage.lead ?? "", 4);
  return fill(el("div", {}), el("label", { for: "edit-lead" }, "What the lead says from then on"), area, row(button("Keep", () => { const text = area.value.trim(); if (text) stage.lead = text; else delete stage.lead; changed(); })));
}
function stageEndingRow(stage) {
  const ending = picker("edit-ending", [["", "the story goes on"], ...endingIds().map((one) => [one, `it ends: ${spaced(one)}`])], stage.ending ?? "");
  return row(el("label", { for: "edit-ending" }, "And then"), ending, button("Keep", () => { if (ending.value) stage.ending = ending.value; else delete stage.ending; changed(); }));
}
function otherLines(holder) {
  const lines = [];
  for (const hit of holder.places ?? []) lines.push(`at ${hit.id}: ${[...Object.entries(hit.goods ?? {}), ...Object.entries(hit.sides ?? {})].map(([what, amount]) => `${what} ${amount >= 0 ? "+" : ""}${amount}`).join(", ")}`);
  const fleet = Object.entries(holder.fleet ?? {}).filter(([key]) => key !== "named");
  if (fleet.length) lines.push(`fleet: ${fleet.map(([what, amount]) => `${what} ${amount >= 0 ? "+" : ""}${amount}`).join(", ")}`);
  if (holder.fleet?.named) lines.push(`named: ${holder.fleet.named.id} ${holder.fleet.named.status}`);
  return lines.length ? hint(`Also, from the file: ${lines.join("; ")}. Those are changed in the file for now.`) : null;
}
function subFacts(holder) {
  const box = el("div", { class: "subfacts" });
  const draw = () => {
    box.replaceChildren(el("label", {}, "Facts it puts on the record"));
    for (const [name, line] of Object.entries(holder.facts ?? {})) {
      const input = el("input", { type: "text", class: "name-box" });
      input.value = line;
      box.append(row(el("span", { class: "fact-name" }, spaced(name)), button("Remove", () => { delete holder.facts[name]; if (!Object.keys(holder.facts).length) delete holder.facts; changed(); }, { class: "danger small" })), input, row(button("Keep", () => { holder.facts[name] = input.value.trim(); changed(); })));
    }
    const pick = picker("edit-subfact", [["", "a fact of this story..."], ...Object.keys(S().gm.facts ?? {}).filter((name) => !holder.facts?.[name]).map((name) => [name, spaced(name)])], "");
    box.append(row(pick, button("+ add it", () => { if (!pick.value) return; (holder.facts ??= {})[pick.value] = S().gm.facts[pick.value]; changed(); })));
  };
  draw();
  return box;
}
function factAfterRow(node) {
  const story = S();
  const after = picker("edit-after-ending", [["", "any ending, or during the story"], ...endingIds().map((one) => [one, `after ${spaced(one)}`])], story.gm.factAfter?.[node.fact] ?? "");
  return row(el("label", { for: "edit-after-ending" }, "It comes"), after, button("Keep", () => { if (after.value) (story.gm.factAfter ??= {})[node.fact] = after.value; else delete story.gm.factAfter?.[node.fact]; changed(); }));
}

// A condition is picked from lists, never typed: if or unless, what kind of thing, and which one.
function conditionPicker(holder, key, label, canBeAlways = false) {
  const current = holder[key] ?? "";
  const parsed = parseCondition(current)[0] ?? { kind: "ended", rest: [state.id], not: false };
  const box = el("div", { class: "condition" });
  const kindPick = picker("cond-kind", [...(canBeAlways ? [["always", "always"]] : []), ["ended", "how a story ended"], ["flag", "a fact on the record"], ["captain", "the player is the captain"], ["act", "the act of the main story"]], current ? (["ended", "flag", "captain", "act"].includes(parsed.kind) ? parsed.kind : "ended") : (canBeAlways ? "always" : "ended"));
  const notPick = picker("cond-not", [["", "if"], ["not", "unless"]], parsed.not ? "not" : "");
  const storyPick = picker("cond-story", state.all.map((one) => [one.id, one.title]), parsed.kind === "ended" && state.all.some((one) => one.id === parsed.rest[0]) ? parsed.rest[0] : state.id);
  const endingPick = el("select", { id: "cond-ending" });
  const fillEndings = () => { endingPick.replaceChildren(el("option", { value: "" }, "any way")); for (const id of state.all.find((one) => one.id === storyPick.value)?.endings ?? []) endingPick.append(el("option", { value: id }, spaced(id))); };
  fillEndings();
  if (parsed.kind === "ended") endingPick.value = parsed.rest[1] ?? "";
  storyPick.addEventListener("change", fillEndings);
  const factPick = picker("cond-fact", state.facts.map((name) => [name, spaced(name)]), parsed.kind === "flag" && state.facts.includes(parsed.rest[0]) ? parsed.rest[0] : state.facts[0] ?? "");
  const actPick = picker("cond-act", [1, 2, 3, 4].map((one) => [String(one), `act ${one} or later`]), parsed.kind === "act" ? String(parsed.rest[1] ?? 2) : "2");
  const rows = { ended: row(storyPick, endingPick), flag: row(factPick), captain: hint("Only when the player is the captain."), act: row(actPick), always: hint("Whatever's on the record.") };
  const showRows = () => { for (const [kind, one] of Object.entries(rows)) one.hidden = kind !== kindPick.value; notPick.hidden = kindPick.value === "always"; };
  showRows();
  kindPick.addEventListener("change", showRows);
  const text = () => {
    const not = notPick.value ? "not " : "";
    if (kindPick.value === "always") return "";
    if (kindPick.value === "ended") return `${not}ended ${storyPick.value}${endingPick.value ? ` ${endingPick.value}` : ""}`;
    if (kindPick.value === "flag") return `${not}flag ${factPick.value}`;
    if (kindPick.value === "act") return `act >= ${actPick.value}`;
    return `${not}captain`;
  };
  const preview = hint("");
  const update = () => { preview.textContent = text() ? `In the file: ${text()}` : "Always."; };
  for (const pick of [kindPick, notPick, storyPick, endingPick, factPick, actPick]) pick.addEventListener("change", update);
  update();
  fill(box, el("label", {}, `${label}. Pick it, no typing.`), row(notPick, kindPick), ...Object.values(rows), preview, row(button("Keep", () => { const value = text(); if (value) holder[key] = value; else delete holder[key]; changed(); })));
  return box;
}

function inspectWire(inspector, wire, index) {
  const from = nodes.find((one) => one.id === wire.from), to = nodes.find((one) => one.id === wire.to);
  if (state.tab === "scene") return inspectChoice(inspector, wire);
  if (wire.stage !== undefined) {
    const stage = C().stages[wire.stage];
    return fill(inspector, h2("The clock"), hint(`From ${from?.name ?? "?"} to day ${stage.after}.`), wire.stage ? conditionPicker(stage, "if", "Only if", true) : hint("The clock starts from the lead when nobody takes the story up."));
  }
  fill(inspector, h2("An arrow"), hint(`From ${from?.name ?? "?"} to ${to?.name ?? "?"}. Click a box to change it.`));
}

// ---- The written scene ------------------------------------------------------------------------------
function inspectPart(inspector, node) {
  if (node.kind === "stub") return fill(inspector, h2("Missing"), hint(`Something leads to a part called ${node.name}, and there's no part with that name in the file. Add it in the file, or point the arrow somewhere else.`));
  const part = state.scene.parts[node.part];
  const area = textarea("edit-part", part.raw, 14);
  fill(inspector,
    h2(node.label),
    el("h3", {}, part.name),
    el("label", { for: "edit-part" }, "The part, as it is in the file: its text, lines people say with @Name:, * effects, > choices and ? rules"),
    area,
    row(button("Keep", () => keepPart(node.part, area.value)), button("Undo", () => inspect())),
    row(button("+ a choice", () => keepPart(node.part, `${part.raw.replace(/\n+$/, "")}\n> Say what the player does -> ${state.scene.parts.find((one) => one.name !== part.name)?.name ?? part.name}\n`))),
    wires.some((one) => one.from === node.id) ? fill(el("div", { class: "choices" }), el("label", {}, "Where it leads"), ...wires.map((one, i) => (one.from === node.id ? button(`${one.words} → ${one.to.replace(/^p_/, "")}`, () => select({ wire: i }), { class: "small" }) : null))) : null,
    part.ai ? hint(`A note for the AI: ${part.ai}`) : null,
    node.problem ? el("div", { class: "problems" }, ...state.scene.problems.filter((one) => one.includes(`part ${part.name}`)).map((one) => el("div", {}, one))) : null,
    hint("Keep changes the part and the file together. Save writes the file, and the scene plays the new version from the next turn."));
}
async function keepPart(index, raw) {
  state.scene.parts[index].raw = raw;
  await refreshScene();
}
async function refreshScene() {
  state.sceneDirty = true;
  try {
    const view = await call(`/api/board/scene/${state.id}`, { check: true, text: sceneText() });
    state.scene = { ...state.scene, ...view };
    say(view.problems.length ? `${view.problems.length} ${view.problems.length === 1 ? "thing" : "things"} the checker would like changed. They're marked in red.` : "");
  } catch (err) {
    say(err.message, false);
  }
  redraw();
}
function inspectChoice(inspector, wire) {
  const part = state.scene.parts[wire.part];
  const to = nodes.find((one) => one.id === wire.to);
  const lineIndex = (line) => (line ? line - part.line - 1 : -1);
  const rawLines = part.raw.split("\n");
  let at = -1;
  if (wire.choice !== undefined) at = lineIndex(part.choices[wire.choice]?.line);
  else if (wire.rule !== undefined) at = lineIndex(part.when[wire.rule]?.line);
  if (at < 0 || at >= rawLines.length) return fill(inspector, h2("An arrow"), hint(`From ${part.name} to ${to?.name ?? "?"}: ${wire.words}. This one is changed in the part's own box.`));
  const line = el("input", { id: "edit-line", type: "text", class: "name-box" });
  line.value = rawLines[at];
  const parts = state.scene.parts.map((one) => [one.name, one.name]);
  const goes = wire.choice !== undefined && part.choices[wire.choice]?.check
    ? [picker("edit-pass", parts, part.choices[wire.choice].pass ?? ""), picker("edit-fail", parts, part.choices[wire.choice].fail ?? "")]
    : [picker("edit-goes", parts, wire.to.replace(/^p_/, ""))];
  const keep = () => {
    let text = line.value;
    if (goes.length === 2) text = text.replace(/->\s*\S+\s*\|\s*\S+/, `-> ${goes[0].value} | ${goes[1].value}`);
    else text = text.replace(/->\s*\S+/, `-> ${goes[0].value}`);
    rawLines[at] = text;
    keepPart(wire.part, rawLines.join("\n"));
  };
  fill(inspector,
    h2(wire.rule !== undefined ? "A rule" : "A choice"),
    hint(`From ${part.name}.`),
    el("label", { for: "edit-line" }, wire.rule !== undefined ? "The rule, as it is in the file: ? a condition -> the part it goes to" : "The choice, as it is in the file: > what the player can say or do -> the part it goes to"),
    line,
    goes.length === 2 ? [row(el("label", {}, "If the check passes, go to"), goes[0]), row(el("label", {}, "If it fails, go to"), goes[1])] : row(el("label", { for: "edit-goes" }, "Then the story goes to"), goes[0]),
    row(button("Keep", keep), button("Remove", () => { rawLines.splice(at, 1); keepPart(wire.part, rawLines.join("\n")); }, { class: "danger" })),
    hint("A check on a choice is written in brackets at the start of the line: [persuasion:hard] and the two parts, passed | failed."));
}

// ---- Saving --------------------------------------------------------------------------------------------
async function save() {
  try {
    if (state.tab === "scene" || (state.sceneDirty && !state.dirty)) {
      const result = await call(`/api/board/scene/${state.id}`, { text: sceneText() });
      if (!result.saved) return say(`Not saved: ${result.problems[0]}`, false);
      state.sceneDirty = false;
      state.scene.problems = result.problems;
      say(result.problems.length ? `Saved. ${result.problems.length} ${result.problems.length === 1 ? "thing" : "things"} the checker would like changed.` : "Saved. The scene plays the new version from the next turn.");
    } else {
      const result = await call(`/api/board/story/${state.id}`, { text: writeStoryText(S(), C()) });
      if (!result.saved) return say(`Not saved: ${result.problems[0]}`, false);
      state.dirty = false;
      state.problems = result.problems;
      state.stories = (await call("/api/board/stories")).stories;
      say(result.problems.length ? `Saved. ${result.problems.length} ${result.problems.length === 1 ? "thing" : "things"} the checker would like changed.` : "Saved. The game plays the new version from the next turn.");
    }
    redraw();
  } catch (err) {
    say(err.message, false);
  }
}
