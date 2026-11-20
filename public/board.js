// The story board: every story, place, person and species as boxes and arrows, to read and change, and saved to
// its file in world/. Everything is done by clicking: words open in a box on the right, conditions are picked from
// lists, names are made from the words. The board is drawn again from the file's contents each time something
// changes, and the file is written by the same readers the game uses (public/story-text.js and
// public/world-text.js), so what's saved is what plays. A story's written scene, and a person's written lines,
// are shown the same way: parts, and the choices between them.

import { el } from "./dom.js";
import { writeStoryText } from "./story-text.js";
import { LINE_PHRASES, PERK_NUMBERS, SPECS, writeWorldText } from "./world-text.js";
import { KNOWN_SYSTEMS, readComputerLine, systemIdOf, writeSystemsText } from "./systems-text.js";
import { LOGISTICS_PARTS, PART_TITLES, WORK_KINDS, readAskers, readCarriers, readDecider, readLoadsLine, readMachineLine, readMaking, readRefillLine, readRepair, readSittings, readStoreLine, readTrip, readUrgencyLine, readWaiting, workKindWords, writeAskers, writeLogisticsText, writeMaking, writeRepair, writeDecider, writeSittings, writeStoreLine, writeTrip, writeWaiting, readCrewUses, writeCrewUses } from "./logistics-text.js";
import { NEEDS, PORT_PARTS, PORT_TITLES, STEPS, STEP_TITLES, numberWords, readCarriedBy, readGoodLine, readGroundLine, readHoldLine, readMakeLine, readPortStoreLine, readStands, readUseLine, writeCarriedBy, writeGoodLine, writeGoodsText, writePortStoreLine, writePortText, writeStands } from "./ports-text.js";
import { COMMAND_HEADER, SPARE, readHolderLine, readJobLine, readPostLine, readWorkersLine, slugOf, writeCommandText, writeJobLine, writePostLine } from "./command-text.js";
import { CARE, MEDBAY_KEYS, PARTS, readAccidentLine, readAccidents, readHitLine, readKindLine, readMendingLine, readOldMarks, readQueue, readShare, readStartLine, readTreatmentLine, readWeaponLine, writeHealthText, writeWoundsText } from "./health-text.js";

const state = {
  kind: "story", id: null, lists: {},
  stories: [], items: [], story: null, clock: null, next: [], written: false, places: [], facts: [], all: [],
  item: null, links: {},
  problems: [], tab: "notes", selected: null, expanded: null, zoom: 1, dirty: false,
  scene: null, scenePrefix: "thread", sceneDirty: false, positions: {}, layoutKey: null, layoutTimer: null,
};
let nodes = [];
let wires = [];
const $ = (id) => document.getElementById(id);
const spaced = (id) => String(id ?? "").replaceAll("_", " ");
const fill = (parent, ...children) => { for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) parent.append(child); return parent; };
const STOP = new Set("if the they she he it you someone anyone a an and or of is are that this their them its in on at for as has have then when there".split(" "));
const KIND_WORDS = { story: "The story", place: "The place", person: "The person", species: "The species", enemy: "The enemy", item: "The item", faction: "The faction", perk: "The perk", computer: "The computer", program: "The program", part: "The part", systems: "The systems", logistics: "The logistics", port: "The port", goods: "The goods", command: "The chain of command", request: "The request", health: "Health" };
const FOLDERS = { story: "stories", person: "characters", place: "places", species: "species", enemy: "enemies", item: "items", faction: "factions", perk: "perks", computer: "computers", program: "programs", part: "rig-parts", systems: "systems", logistics: "logistics", port: "ports", goods: "goods", command: "command", health: "health", request: "scenes" };

// A name made from words, for an ending or a fact, so nobody has to type one.
export function nameFrom(text) {
  const words = String(text ?? "").toLowerCase().replace(/'/g, "").split(/[^a-z0-9]+/).filter((word) => word && !STOP.has(word)).slice(0, 5).join("_").slice(0, 40).replace(/_+$/, "");
  return /^[a-z]/.test(words) && words.length >= 2 ? words : "new_name";
}
const get = (obj, path) => path.split(".").reduce((holder, key) => (holder == null ? undefined : holder[key]), obj);
function setPath(obj, path, value) {
  const keys = path.split(".");
  let holder = obj;
  for (const key of keys.slice(0, -1)) holder = holder[key] ??= {};
  if (value === undefined) delete holder[keys.at(-1)];
  else holder[keys.at(-1)] = value;
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
export async function openBoard() {
  if ($("board")) return;
  document.body.append(boardNode());
  // For the browser checks, which look at the board's state from outside.
  window.__board = state;
  try {
    state.stories = (await call("/api/board/stories")).stories;
    await load(state.kind, state.id ?? state.stories.find((one) => one.id === "main_two_weeks_of_fuel")?.id ?? state.stories.find((one) => one.kind === "main")?.id ?? state.stories[0]?.id);
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
      el("select", { id: "board-what", title: "Stories, places, people or species", onchange: (event) => changeKind(event.target.value) },
        ...[["story", "Stories"], ["place", "Places"], ["person", "People"], ["species", "Species"], ["enemy", "Enemies"], ["item", "Items"], ["faction", "Factions"], ["perk", "Perks"], ["computer", "Computers"], ["program", "Programs"], ["part", "Rig parts"], ["systems", "Systems"], ["logistics", "Logistics"], ["port", "Ports"], ["goods", "Goods"], ["command", "Command"], ["request", "Requests"], ["health", "Health"]].map(([kind, label]) => el("option", { value: kind }, label))),
      el("select", { id: "board-pick", title: "Which one", onchange: (event) => load(state.kind, event.target.value) }),
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
          el("button", { onclick: fit }, "Fit"),
          el("button", { onclick: tidy, title: "Puts every box back in its column, and forgets where they were moved" }, "Tidy up"))),
      el("aside", { class: "board-inspector", id: "board-inspector" })),
    el("footer", { class: "board-foot" },
      el("span", {}, "Click a box to read and change it."),
      el("span", {}, "Drag a box to move it."),
      el("span", {}, "Click the words on an arrow to change when it applies."),
      el("span", {}, "Drop a box on another to link them."),
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
const unsaved = () => {
  if (!(state.dirty || state.sceneDirty)) return false;
  if (state.leaving) { state.leaving = false; return false; }
  state.leaving = true;
  say("There are changes that aren't saved. Save them, or pick again to lose them.", false);
  return true;
};

async function changeKind(kind) {
  if (unsaved()) { $("board-what").value = state.kind; return; }
  const items = kind === "story" ? state.stories : (await call(`/api/board/world/${kind}`)).items;
  state.items = items;
  state.itemsKind = kind;
  await load(kind, items[0]?.id);
}

// Loads one story, place, person or species onto the board.
async function load(kind, id) {
  if (!id) return;
  if (unsaved()) { $("board-pick").value = state.id; return; }
  state.leaving = false;
  if (kind === "story") {
    const data = await call(`/api/board/story/${id}`);
    Object.assign(state, { kind, id, story: data.story, clock: data.clock, next: data.next, written: data.written, places: data.places, facts: data.facts, all: data.stories, lists: data.lists, problems: data.problems, item: null, links: {}, scenePrefix: "thread", layoutKey: `story/${id}`, layout: data.layout ?? {} });
    state.items = state.stories;
    state.itemsKind = "story";
  } else {
    const data = await call(`/api/board/world/${kind}/${id}`);
    Object.assign(state, { kind, id, item: data.value, links: data.links, lists: data.lists, problems: data.problems, written: Boolean(data.links.written), story: null, clock: null, next: [], scenePrefix: "talk", layoutKey: `${kind}/${id}`, layout: data.layout ?? {} });
    // The list at the top is of the kind shown, which a link from another board may have changed.
    if (state.itemsKind !== kind) {
      state.items = (await call(`/api/board/world/${kind}`)).items;
      state.itemsKind = kind;
    }
  }
  Object.assign(state, { selected: null, expanded: null, dirty: false, sceneDirty: false, scene: null, positions: state.layout });
  // A request is a scene file with lines on top: the request's board and the board of every part read the same parts.
  if (kind === "request" && state.item && !state.item.overview) Object.assign(state, { scene: state.item, written: true, scenePrefix: "request" });
  $("board-what").value = kind;
  const pick = $("board-pick");
  const groups = kind === "story" ? ["main", "crew", "dilemma", "mystery", "exploration", "survival", "politics", "job", "faction"] : [...new Set(state.items.map((one) => one.kind))];
  pick.replaceChildren(...groups.map((group) => {
    const box = el("optgroup", { label: group });
    for (const one of state.items.filter((item) => item.kind === group)) box.append(el("option", { value: one.id, selected: one.id === id ? "selected" : null }, `${one.title ?? one.name}${one.written ? " ✓" : ""}`));
    return box;
  }).filter((box) => box.children.length));
  pick.value = id;
  for (const button of document.querySelectorAll(".board-tab")) {
    if (button.dataset.tab === "notes") button.textContent = KIND_WORDS[kind];
    if (button.dataset.tab === "scene") { button.textContent = kind === "person" ? "The written lines" : kind === "request" ? "Every part" : "The written scene"; button.hidden = !["story", "person", "request"].includes(kind) || Boolean(state.item?.overview); }
    // The list of every request is made from the files: there's no file of its own to show.
    if (button.dataset.tab === "file") { button.hidden = Boolean(state.item?.overview); }
  }
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

// ---- The boxes and arrows, from a place, a person or a species --------------------------------
const linkNode = (id, kind, name, text, label) => ({ id, kind: "link", col: 4, name, text, label, link: { kind, id: id.replace(/^link_[a-z]+_/, "") }, linkKind: kind });
function placeGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `${P.faction ? `Held by ${P.faction}. ` : ""}${P.aliases?.length ? `Also called ${P.aliases.join(", ")}. ` : ""}${[P.rest && "a place to rest", P.dangerous && "dangerous", P.hidden && "hidden"].filter(Boolean).join(", ")}`, label: "About this place" });
  add({ id: "desc", kind: "lead", col: 1, name: "In a line", text: P.desc ?? "", label: "What the player sees", bind: { path: "desc" } });
  add({ id: "feel", kind: "truth", col: 1, name: "The feel of it", text: P.gm?.feel ?? "", label: "For the game master", bind: { path: "gm.feel" } });
  ws.push({ from: "desc", to: "feel" });
  (P.gm?.districts ?? []).forEach((one, i) => {
    add({ id: `district${i}`, kind: "beat", col: 2, name: one.name, text: one.desc, label: "A district", bind: { district: i } });
    ws.push({ from: "desc", to: `district${i}` });
  });
  for (const [key, path, label] of [["complications", "gm.complications", "Complications"], ["secrets", "gm.secrets", "Secrets"], ["encounters", "encounters", "Encounters"], ["rumors", "rumors", "Rumors"]]) {
    const items = get(P, path) ?? [];
    add({ id: key, kind: "route", col: 3, name: `${label} (${items.length})`, text: items.join("\n"), label: key === "rumors" ? "What people say" : key === "encounters" ? "What can happen" : "For the game master", bind: { items: path } });
    ws.push({ from: "feel", to: key });
  }
  for (const one of L.people ?? []) { add(linkNode(`link_person_${one.id}`, "person", one.name, one.role, "Someone here")); ws.push({ from: "desc", to: `link_person_${one.id}` }); }
  for (const one of L.stories ?? []) { add(linkNode(`link_story_${one.id}`, "story", one.title, "A story set here.", "A story here")); ws.push({ from: "desc", to: `link_story_${one.id}` }); }
  return { list, ws };
}
function personGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  add({ id: "about", kind: "about", col: 0, name: [P.title, P.name].filter(Boolean).join(" "), text: `${P.role ?? ""}. ${P.pronouns ?? ""}${P.species ? `, ${P.species}` : ""}${P.age ? `, ${P.age}` : ""}. ${P.faction ? `${P.faction}. ` : ""}${P.crew ? "Crew. " : ""}`, label: "About this person" });
  add({ id: "note", kind: "lead", col: 1, name: "In a line", text: P.note ?? "", label: "How the game sees them", bind: { path: "note" } });
  for (const [key, label] of [["appearance", "Appearance"], ["personality", "Personality"], ["voice", "Voice"], ["goals", "Goals"], ["secrets", "Secrets"]]) {
    add({ id: key, kind: "truth", col: 1, name: label, text: P[key] ?? "", label: key === "secrets" ? "For the game master only" : "For the game master", bind: { path: key } });
    ws.push({ from: "note", to: key });
  }
  add({ id: "numbers", kind: "route", col: 2, name: "Their numbers", text: ["beliefs", "attributes", "skills"].map((key) => `${key}: ${Object.entries(P[key] ?? {}).map(([name, amount]) => `${name} ${amount}`).join(", ") || "none"}`).join("\n"), label: "Beliefs, attributes and skills", bind: { numbers: true } });
  ws.push({ from: "note", to: "numbers" });
  const c = P.combat ?? {};
  // What's always true of their body, one line each (the part, a colon and what's there); the game makes up the rest.
  add({ id: "body", kind: "route", col: 2, name: `Body (${(P.body ?? []).length})`, text: (P.body ?? []).join("\n"), label: "What's always true of their body", bind: { items: "body" } });
  ws.push({ from: "note", to: "body" });
  add({ id: "fight", kind: "ending", col: 2, name: "In a fight", text: `threat ${c.threat ?? 0}, hp ${c.hp ?? 0}, attack ${c.attack ?? 0}, defense ${c.defense ?? 0}${c.weapon ? `, ${c.weapon}` : ""}${c.lines ? `. ${Object.values(c.lines).flat().length} lines.` : ""}`, label: "What the dice decide", bind: { fight: true } });
  ws.push({ from: "note", to: "fight" });
  if (L.place) { add(linkNode(`link_place_${L.place.id}`, "place", L.place.name, "Where they are.", "Their place")); ws.push({ from: "note", to: `link_place_${L.place.id}` }); }
  if (L.species) { add(linkNode(`link_species_${L.species.id}`, "species", L.species.name, "What they are.", "Their species")); ws.push({ from: "note", to: `link_species_${L.species.id}` }); }
  for (const one of L.stories ?? []) { add(linkNode(`link_story_${one.id}`, "story", one.title, "A story they're in.", "A story")); ws.push({ from: "note", to: `link_story_${one.id}` }); }
  add({ id: "lines", kind: L.written ? "fact" : "stub", col: 4, name: "Written lines", text: L.written ? "What they say in a talk, written out. Open the tab to see and change it." : "Not written yet: stock lines speak for them.", label: "Talking", lines: true });
  ws.push({ from: "note", to: "lines" });
  return { list, ws };
}
function speciesGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `Shown ${P.order ?? "?"}${P.order === 1 ? "st" : P.order === 2 ? "nd" : P.order === 3 ? "rd" : "th"} in the character creator.${P.bonusAttrPoints ? ` ${P.bonusAttrPoints} extra attribute points.` : ""}${P.bonusTraitPoints ? ` ${P.bonusTraitPoints} extra trait points.` : ""}${P.agelessTerms ? ` Ages after ${P.agelessTerms} terms.` : ""}`, label: "About this species" });
  add({ id: "desc", kind: "lead", col: 1, name: "In a line", text: P.desc ?? "", label: "What the player reads", bind: { path: "desc" } });
  add({ id: "gm", kind: "truth", col: 1, name: "For the game master", text: P.gm ?? "", label: "How to play them", bind: { path: "gm" } });
  ws.push({ from: "desc", to: "gm" });
  const fx = P.fx ?? {};
  add({ id: "numbers", kind: "route", col: 2, name: "Their numbers", text: [["attrs", "attributes"], ["attrCaps", "caps"], ["skills", "skills"]].map(([key, label]) => `${label}: ${Object.entries(P[key] ?? {}).map(([name, amount]) => `${name} ${amount}`).join(", ") || "none"}`).join("\n"), label: "Attributes and skills", bind: { speciesNumbers: true } });
  ws.push({ from: "desc", to: "numbers" });
  add({ id: "effects", kind: "ending", col: 2, name: "Effects", text: Object.entries(fx).map(([key, value]) => `${spaced(key)}: ${typeof value === "object" ? Object.entries(value).map(([name, amount]) => `${name} ${amount}`).join(", ") : value}`).join("\n") || "none", label: "What's different for them", bind: { effects: true } });
  ws.push({ from: "desc", to: "effects" });
  // Their bodies: how often a hit lands on each part, and what they do differently.
  const body = P.body ?? {};
  add({ id: "body", kind: "route", col: 2, name: "Body", text: [`hit: ${Object.entries(body.hits ?? {}).map(([part, n]) => `${part.replace(/_/g, " ")} ${n}`).join(", ") || "as most"}`, body.breaks !== undefined && `bones break: ${body.breaks}`, body.heals !== undefined && `wounds heal: ${body.heals}`, body.bleeds === false && "bleeds: no", body.ownMarks && "own marks only: yes", body.mendedBy && `mended by: ${body.mendedBy}`].filter(Boolean).join("\n"), label: "Their bodies", bind: { speciesBody: true } });
  ws.push({ from: "desc", to: "body" });
  for (const one of L.people ?? []) { add(linkNode(`link_person_${one.id}`, "person", one.name, one.role, "One of them")); ws.push({ from: "desc", to: `link_person_${one.id}` }); }
  return { list, ws };
}

function enemyGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `threat ${P.threat ?? 0}, hp ${P.hp ?? 0}, attack ${P.attack ?? 0}, defense ${P.defense ?? 0}${P.weapon ? `, ${P.weapon}` : ""}${P.motive ? `. Fights for ${P.motive}.` : ""}${P.boss ? " A boss." : ""}${P.machine ? " A machine." : ""}`, label: "About this enemy" });
  add({ id: "desc", kind: "lead", col: 1, name: "In a line", text: P.desc ?? "", label: "What the player sees", bind: { path: "desc" } });
  add({ id: "lines", kind: "route", col: 2, name: "What they say", text: LINE_PHRASES.filter(([key]) => P.lines?.[key]?.length).map(([key, phrase]) => `${phrase}: ${P.lines[key].length}`).join("\n") || "No lines yet.", label: "In a fight", bind: { enemyLines: true } });
  ws.push({ from: "desc", to: "lines" });
  if (L.faction) { add(linkNode(`link_faction_${L.faction.id}`, "faction", L.faction.name, "Who they fight for.", "Their faction")); ws.push({ from: "desc", to: `link_faction_${L.faction.id}` }); }
  for (const one of L.places ?? []) { add(linkNode(`link_place_${one.id}`, "place", one.name, "Where they turn up.", "A place")); ws.push({ from: "desc", to: `link_place_${one.id}` }); }
  return { list, ws };
}
function itemGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `${P.type ?? "an item"}, ${P.price ?? 0} credits.${P.size ? ` ${P.size} squares in the inventory, ${P.weight ?? 0} kg${P.stack > 1 ? `, ${P.stack} to a square` : ""}.` : ""}${P.damage ? ` ${P.damage[0]} to ${P.damage[1]} damage, ${P.stat ?? ""} and ${P.skill ?? ""}.` : ""}${P.defense ? ` Defense ${P.defense}.` : ""}${P.effect ? ` ${Object.entries(P.effect).map(([k, v]) => `${k} ${v}`).join(", ")}.` : ""}${P.restricted ? " Restricted." : ""}${P.keepsake ? " A keepsake: whoever it was taken from asks after it." : ""}${P.salvage ? ` Salvage: counts for ${P.salvage} toward what the bench makes.` : ""}${P.feeds ? ` Feeds ${P.feeds} at the kettle, from the pantry.` : ""}${P.comfort ? ` A comfort for the crew: ${P.comfort}, from the store their comforts are kept in.` : ""}${P.gift ? ` A gift: remembered for ${P.gift} when it's given to someone aboard.` : ""}${P.doses ? ` ${P.doses} dose${P.doses === 1 ? "" : "s"} for the medbay, from its cabinet.` : ""}${P.spares ? ` Worth ${P.spares === 1 ? "a repair" : `${P.spares} repairs`}, as a spare.` : ""}${P.foundIn?.length ? ` Found in ${P.foundIn.join(", ")}, ${P.rarity ?? "common"}.` : " Not found in containers."}${P.draft ? ` Draft: ${P.draft}.` : ""}`, label: "About this item" });
  add({ id: "desc", kind: "lead", col: 1, name: "In a line", text: P.desc ?? "", label: "What the player reads", bind: { path: "desc" } });
  // What's written on it, which Read in the inventory shows and keeps in What you know; empty, it has nothing to read.
  add({ id: "read", kind: "beat", col: 1, name: "When read", text: P.read || "Nothing written on it.", label: "Words on it", bind: { path: "read", optional: true } });
  ws.push({ from: "desc", to: "read" });
  add({ id: "effects", kind: "ending", col: 2, name: "Effects", text: Object.entries(P.fx ?? {}).map(([key, value]) => `${spaced(key)}: ${Object.entries(value).map(([name, amount]) => `${name} ${amount}`).join(", ")}`).join("\n") || "none", label: "While it's worn or carried", bind: { effects: true } });
  ws.push({ from: "desc", to: "effects" });
  // Its little picture in the inventory, its spaces kept (they'd be squeezed together in a box otherwise).
  add({ id: "drawing", kind: "beat", col: 2, name: "Drawing", text: (P.art ?? []).map((one) => one.replace(/ /g, " ")).join("\n") || "None of its own: it's drawn as its kind.", label: "In the inventory", bind: { drawing: true } });
  ws.push({ from: "about", to: "drawing" });
  for (const one of L.sold ?? []) { add(linkNode(`link_place_${one.id}`, "place", one.name, "Sold here.", "A market")); ws.push({ from: "desc", to: `link_place_${one.id}` }); }
  for (const one of L.found ?? []) if (!list.some((node) => node.id === `link_place_${one.id}`)) { add(linkNode(`link_place_${one.id}`, "place", one.name, "Can turn up here.", "A place")); ws.push({ from: "desc", to: `link_place_${one.id}` }); }
  return { list, ws };
}
function factionGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `${P.aliases?.length ? `Also called ${P.aliases.join(", ")}. ` : ""}A new captain starts at ${P.start ?? 0} with them.`, label: "About this faction" });
  add({ id: "desc", kind: "lead", col: 1, name: "In a line", text: P.desc ?? "", label: "What the player reads", bind: { path: "desc" } });
  add({ id: "beliefs", kind: "route", col: 2, name: "What they believe", text: Object.entries(P.beliefs ?? {}).map(([name, amount]) => `${name} ${amount}`).join(", ") || "nothing in particular", label: "Beliefs", bind: { beliefs: true } });
  ws.push({ from: "desc", to: "beliefs" });
  for (const one of L.people ?? []) { add(linkNode(`link_person_${one.id}`, "person", one.name, one.role, "One of theirs")); ws.push({ from: "desc", to: `link_person_${one.id}` }); }
  for (const one of L.places ?? []) { add(linkNode(`link_place_${one.id}`, "place", one.name, "Held by them.", "A place")); ws.push({ from: "desc", to: `link_place_${one.id}` }); }
  for (const one of L.enemies ?? []) { add(linkNode(`link_enemy_${one.id}`, "enemy", one.name, "Fights for them.", "An enemy")); ws.push({ from: "desc", to: `link_enemy_${one.id}` }); }
  for (const one of L.stories ?? []) { add(linkNode(`link_story_${one.id}`, "story", one.title, "A story they're in.", "A story")); ws.push({ from: "desc", to: `link_story_${one.id}` }); }
  return { list, ws };
}

function perkGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  const needs = [...Object.entries(P.requiresSkill ?? {}).map(([name, amount]) => `${spaced(name)} ${amount}`), ...Object.entries(P.requiresStat ?? {}).map(([name, amount]) => `${spaced(name)} ${amount}`)];
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `${P.starting ? "A starting perk, from a career. " : ""}${needs.length ? `Needs ${needs.join(", ")}. ` : ""}${L.needs ? `Needs ${L.needs.name} first. ` : ""}${L.ability ? `Gives the ability ${L.ability.name}.` : ""}`, label: "About this perk" });
  add({ id: "desc", kind: "lead", col: 1, name: "In a line", text: P.desc ?? "", label: "What the player reads", bind: { path: "desc" } });
  const fx = P.fx ?? {};
  add({ id: "effects", kind: "ending", col: 2, name: "Effects", text: Object.entries(fx).map(([key, value]) => `${PERK_NUMBERS.find(([path]) => path === key)?.[1] ?? spaced(key)}: ${typeof value === "object" ? Object.entries(value).map(([name, amount]) => `${name} ${amount}`).join(", ") : value}`).join("\n") || "none", label: "What it changes", bind: { effects: true } });
  ws.push({ from: "desc", to: "effects" });
  if (L.needs) { add(linkNode(`link_perk_${L.needs.id}`, "perk", L.needs.name, "Learned first.", "Needs")); ws.push({ from: `link_perk_${L.needs.id}`, to: "desc" }); }
  for (const one of L.neededBy ?? []) { add(linkNode(`link_perk_${one.id}`, "perk", one.name, "Needs this one first.", "Leads to")); ws.push({ from: "desc", to: `link_perk_${one.id}` }); }
  return { list, ws };
}

// A computer: what the player sees, then its files, letters and logs, its programs, and the computers and place it's linked to.
function computerGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  const where = [P.room, P.thing].filter(Boolean).join(", ") || (P.door ? `the door to ${P.door}` : "no room in particular");
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `${L.className ?? P.class ?? "Crew terminal"}. ${P.yours ? "The player's own: no hack, no trace. " : ""}${P.hardened ? "Hardened: no breaker works on it from the front. " : ""}${P.sealed ? "Sealed: it takes nothing at its own keyboard. " : ""}${P.owner ? `Belongs to ${spaced(P.owner)}. ` : ""}At ${L.place?.name ?? P.place ?? "no place"}: ${where}. Login ${P.user ?? (P.yours ? "captain" : "admin")}${P.password ? ", with a password the story can hand out" : ""}.`, label: "About this computer" });
  add({ id: "desc", kind: "lead", col: 1, name: "What the player sees", text: P.desc ?? "", label: "What they see when they sit down", bind: { path: "desc" } });
  (P.files ?? []).forEach((one, i) => { add({ id: `file${i}`, kind: "beat", col: 2, name: one.name, text: one.desc ?? "", label: "A file", bind: { entry: "files", i } }); ws.push({ from: "desc", to: `file${i}` }); });
  (P.mail ?? []).forEach((one, i) => { add({ id: `mail${i}`, kind: "fact", col: 2, name: one.name, text: one.desc ?? "", label: "A letter", bind: { entry: "mail", i } }); ws.push({ from: "desc", to: `mail${i}` }); });
  add({ id: "logs", kind: "beat", col: 2, name: "Logs", text: (P.logs ?? []).join("\n") || "none", label: "The logs: berths, prices, people, news, or a line of your own", bind: { items: "logs" } });
  ws.push({ from: "desc", to: "logs" });
  (P.programs ?? []).forEach((one, i) => {
    const info = L.programs?.[i];
    add({ id: `program${i}`, kind: "route", col: 3, name: one.name, text: `${info?.text ?? one.desc ?? ""}${info?.effects ? `\n-> ${info.effects} ${info.effects === 1 ? "effect" : "effects"}` : ""}${info?.condition ? `\n? ${info.condition}` : ""}`, label: "A program", bind: { entry: "programs", i } });
    ws.push({ from: "desc", to: `program${i}` });
  });
  // Its ways in, written somewhere else, and the machines it lets in (steps 8 and 9 of the hacking rework).
  if (P.hardened || (P.weakPoints ?? []).length) { add({ id: "weak", kind: "beat", col: 3, name: "Weak points", text: (P.weakPoints ?? []).join("\n") || "None written: the game makes one up.", label: "Its ways in, written somewhere else", bind: { items: "weakPoints" } }); ws.push({ from: "about", to: "weak" }); }
  if (P.sealed || (P.trusts ?? []).length) { add({ id: "trusts", kind: "route", col: 3, name: "Trusts", text: (P.trusts ?? []).join("\n") || "Nothing: nothing can get in.", label: "The machines it lets in, and what each may do", bind: { items: "trusts" } }); ws.push({ from: "about", to: "trusts" }); }
  for (const one of L.network ?? []) { add(linkNode(`link_computer_${one.id}`, "computer", one.name, `${one.className}. ${one.about}`, "On the network")); ws.push({ from: "desc", to: `link_computer_${one.id}` }); }
  for (const one of L.reachedFrom ?? []) if (!list.some((node) => node.id === `link_computer_${one.id}`)) { add(linkNode(`link_computer_${one.id}`, "computer", one.name, "Reaches this one over its network.", "Reached from")); ws.push({ from: `link_computer_${one.id}`, to: "about" }); }
  if (L.place) { add(linkNode(`link_place_${L.place.id}`, "place", L.place.name, "Where it is.", "The place")); ws.push({ from: `link_place_${L.place.id}`, to: "about" }); }
  return { list, ws };
}
// A program for the rig: what it is and what writing it takes, what it does, its numbers when it runs, and the
// computers it's found on and the place that sells it.
function programGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  const flags = [P.builtIn && "built into every rig", P.everyRig && "on every rig from the start", P.once && "runs once a session"].filter(Boolean);
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `${L.kindName || "A program"}. Hacking ${P.hacking ?? 0} to write it${P.written ? `, in ${P.written} at the bench` : ""}. ${P.builtIn ? "It takes no memory." : `${P.size ?? 1} ${P.size === 1 ? "block" : "blocks"} of memory.`}${flags.length ? ` ${flags.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : ""}`, label: "About this program" });
  add({ id: "desc", kind: "lead", col: 1, name: "What it does", text: P.what ?? "", label: "What the player reads", bind: { path: "what" } });
  add({ id: "numbers", kind: "route", col: 2, name: "When it runs", text: [`power ${P.power ?? "none"}`, `noise ${P.noise ?? 0}`, `${P.minutes ?? 1} ${P.minutes === 1 ? "minute" : "minutes"}`].join("\n"), label: "Its power against a computer's class, the noise the watcher hears, the minutes it takes", readOnly: "Change them in About this program, the first box." });
  ws.push({ from: "desc", to: "numbers" });
  for (const one of L.foundOn ?? []) { add(linkNode(`link_computer_${one.id}`, "computer", one.name, one.known ? "It can be copied off this computer." : "There's no computer with this id.", "Found on")); ws.push({ from: `link_computer_${one.id}`, to: "desc" }); }
  if (L.soldAt) { add(linkNode(`link_place_${L.soldAt.id}`, "place", L.soldAt.name, `Sold here, for ${P.price ?? "no price yet"} credits.`, "Sold at")); ws.push({ from: `link_place_${L.soldAt.id}`, to: "desc" }); }
  return { list, ws };
}
// A part of a rig: what it is, what it adds to the build, a board's sockets, where it comes from and what making it at
// the bench takes.
function partGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  const numbers = ["memory", "cooling", "cools", "echo", "heat", "power", "quiet", "speed"].filter((key) => P[key] !== undefined && P[key] !== null).map((key) => `${key} ${P[key]}`);
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `${L.kindName || "A part"}, grade ${P.grade ?? 1}, ${P.weight ?? 0} kg, worth ${P.worth ?? "its grade in"} credits.${L.reaches ? ` It reaches a computer ${L.reaches}.` : ""}`, label: "About this part" });
  add({ id: "desc", kind: "lead", col: 1, name: "What it is", text: P.what ?? "", label: "What the player reads", bind: { path: "what" } });
  add({ id: "numbers", kind: "route", col: 2, name: "What it adds", text: numbers.join("\n") || "Nothing to the numbers.", label: "What it adds to the rig's build", readOnly: "Change them in About this part, the first box." });
  ws.push({ from: "desc", to: "numbers" });
  if (P.sockets) { add({ id: "sockets", kind: "beat", col: 2, name: "Sockets", text: (L.sockets ?? []).map((one) => `${one.key} at ${one.col} ${one.row}${one.gate ? `, from Hacking ${one.gate}` : ""}`).join("\n") || P.sockets, label: "A board's sockets: like core at 1 1, extra at 5 1 from Hacking 7", bind: { path: "sockets" } }); ws.push({ from: "desc", to: "sockets" }); }
  add({ id: "from", kind: "beat", col: 3, name: "Where it comes from", text: P.from ?? "", label: "Where the player can come by one", bind: { path: "from" } });
  ws.push({ from: "desc", to: "from" });
  if (P.made) { add({ id: "made", kind: "route", col: 3, name: "Made at the bench", text: L.made ? `${L.made.needs.join(", ")}\nEngineering ${L.made.engineering}, ${L.made.hours} ${L.made.hours === 1 ? "hour" : "hours"}${L.made.tool ? `\nwith the ${L.made.tool.toLowerCase()}` : ""}` : P.made, label: "What making it takes: like 2 scrap, Engineering 1, 2 hours, with the soldering kit", bind: { path: "made" } }); ws.push({ from: "desc", to: "made" }); }
  return { list, ws };
}

// A place's systems: who keeps it running, each system with its parts, each computer with arrows to what it runs,
// and the rooms with what's in each.
function systemsGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  const numbers = P.numbers ?? {};
  const names = (keys) => keys.map((key) => (L.people ?? []).find((one) => one.key === key)?.name ?? key).join(", ") || "nobody";
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `${L.own ? "Its own file." : "No file of its own yet: this is what it gets by default, and Save makes it its own."} Guards: ${names(L.guards ?? [])}. Engineers: ${names(L.engineers ?? [])}.${numbers.alarm ? ` The alarm rings ${numbers.alarm} minutes.` : ""}${numbers.air ? ` Air goes bad in ${numbers.air} minutes.` : ""}${numbers.repair ? ` Repairs take ${numbers.repair} hours.` : ""}${numbers.reserve ? ` Reserve air for ${numbers.reserve} days.` : ""}`, label: "Who keeps it running" });
  (P.systems ?? []).forEach((system, i) => add({ id: `system${i}`, kind: KNOWN_SYSTEMS.includes(system.id) ? "beat" : "route", col: 1, name: system.name, text: system.lines.map((one) => one.text ?? one).join("\n") || "no parts yet", label: KNOWN_SYSTEMS.includes(system.id) ? "A system" : "A system of the place's own", bind: { system: i } }));
  (P.computers ?? []).forEach((one, i) => {
    const text = one.text ?? one;
    const c = readComputerLine(text);
    const id = add({ id: `computer${i}`, kind: "fact", col: 2, name: c.problem ? "A computer" : c.room ? `${c.ref}, in ${c.room}` : c.ref, text, label: "A computer, and what it runs", bind: { computer: i } });
    if (c.problem) return;
    const runs = c.systems.includes("everything") ? P.systems.map((_, j) => j) : c.systems.map((sid) => P.systems.findIndex((system) => system.id === sid)).filter((j) => j >= 0);
    for (const j of runs) ws.push({ from: id, to: `system${j}` });
  });
  for (const room of L.rooms ?? []) add({ id: `room_${room.id}`, kind: "clock", col: 3, name: room.name, text: room.parts.length ? room.parts.join(", ") : "nothing", label: room.door ? "A room, with a door its systems run" : "A room", readOnly: "The rooms come from the place's map. What's in each is changed in the systems' own boxes." });
  if (L.place) add(linkNode(`link_place_${L.place.id}`, "place", L.place.name, "The place itself.", "The place"));
  return { list, ws };
}
// A place's logistics: each store a box with what it holds, what it wants kept in it and who carries for it, with an
// arrow from every store that could supply it; and the machines, loads and refills as boxes with arrows to the stores
// their words name: from a store into the box, out of the box into a store.
const sameThing = (a, b) => plainWords(a).replace(/s$/, "") === plainWords(b).replace(/s$/, "");
const marksWords = (list, holds) => list.map((one) => (one.what ? `${one.n} ${one.what}` : holds.length === 1 ? `${one.n} ${holds[0].what}` : `${one.n} of each`)).join(", ");
const plainWords = (words) => String(words ?? "").toLowerCase().replace(/['’]/g, "").replace(/^the\s+/, "").replace(/\s+/g, " ").trim();
function logisticsGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  const numbers = P.numbers ?? {};
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `${numbers.eats ? `Everyone aboard eats ${numbers.eats} sittings a day. ` : ""}${numbers.crateFeeds ? `A crate feeds ${numbers.crateFeeds} sittings. ` : ""}${numbers.drinks ? `Everyone aboard drinks ${numbers.drinks} measures of water a day${numbers.rationUnder ? `, rationed under ${numbers.rationUnder}` : ""}. ` : ""}${P.uses ? `The crew uses ${writeCrewUses(P.uses)}. ` : ""}${P.sittings ? `Sittings at ${writeSittings(P.sittings)}. ` : "Four sittings a day unless this says otherwise. "}${P.repair?.n ? `A repair takes ${writeRepair(P.repair)}.` : "A repair takes nothing."}${P.making?.n ? ` Salvage makes ${writeMaking(P.making)}.` : ""}${P.carriers?.list?.length ? ` A store that doesn't say is carried for by ${P.carriers.list.join(", then ")}.` : ""}${P.trip?.list?.length ? ` A trip carries ${writeTrip(P.trip)}.` : ""}${P.first ? ` What comes first is decided by ${writeDecider(P.first)}.` : ""}${P.levels ? ` What the stores want is set by ${writeDecider(P.levels)}.` : ""}${P.waiting && P.askers ? ` A job left waiting ${writeWaiting(P.waiting)}, is brought to the player: by ${writeAskers(P.askers)}.` : ""}`, label: "The numbers at the top" });
  const stores = (P.stores ?? []).map((one, i) => {
    const read = readStoreLine(one.text ?? one);
    const placed = (L.stores ?? []).find((s) => s.name === read.name);
    return { i, read, id: add({ id: `store${i}`, kind: "beat", col: 1, name: read.problem ? "A store" : `${read.name}, in ${read.room}`, text: read.problem ? read.problem : `${read.freight ? "Holds freight: whatever she's carrying" : read.reserve ? "Holds the reserve air: as many days of it as the place's systems file gives" : `Holds ${read.holds.map((h) => `${h.n} ${h.what}`).join(", ")}`}.${read.wants.length ? ` Wants ${marksWords(read.wants, read.holds)}${read.urgent.length ? `, urgent under ${marksWords(read.urgent, read.holds)}` : ""}, carried by ${(read.carriers.length ? read.carriers : P.carriers?.list ?? ["nobody yet"]).join(", then ")}.` : ""}${placed ? placed.placed ? " The game puts it in the room, since the map hasn't drawn one." : " It's the thing of that name in the room." : ""}${read.look ? ` ${read.look}` : ""}`, label: "A store", bind: { store: i }, problem: Boolean(read.problem) }) };
  });
  // What a store wants can come from any other store that holds the same thing: the board works the route out.
  for (const store of stores) {
    if (store.read.problem || !store.read.wants.length) continue;
    const wanted = store.read.wants.some((one) => !one.what) ? store.read.holds.map((h) => h.what) : store.read.wants.map((one) => one.what);
    for (const other of stores) {
      if (other === store || other.read.problem) continue;
      if (other.read.holds.some((h) => wanted.some((what) => sameThing(h.what, what)))) ws.push({ from: other.id, to: store.id });
    }
  }
  const cols = { machines: 2, loads: 3, refills: 2 };
  const kinds = { machines: "route", loads: "clock", refills: "consequence" };
  const labels = { machines: "A machine", loads: "What draws power", refills: "A refill" };
  for (const part of ["machines", "loads", "refills"]) {
    (P[part] ?? []).forEach((one, i) => {
      const words = one.text ?? one;
      const read = part === "machines" ? readMachineLine(words) : part === "loads" ? readLoadsLine(words) : part === "refills" ? readRefillLine(words) : null;
      const id = add({ id: `${part}${i}`, kind: kinds[part], col: cols[part], name: read?.drop ? "When short, drop" : words.split(":")[0].trim().slice(0, 40), text: read?.problem ?? words, label: read && !read.gives && read.power ? "The generator" : read?.drop ? "The order they're let go in" : labels[part], bind: { logLine: [part, i] }, problem: Boolean(read?.problem) });
      const lower = plainWords(words);
      for (const store of stores) {
        if (store.read.problem) continue;
        const name = plainWords(store.read.name);
        if (!lower.includes(name)) continue;
        const outOf = new RegExp(`\\bfrom (the )?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(lower);
        if (outOf) ws.push({ from: store.id, to: id });
        else ws.push({ from: id, to: store.id });
      }
      // A machine whose line says it needs water takes it from the store that holds measures of water.
      if (part === "machines" && read?.needs?.water) {
        const tank = stores.find((store) => !store.read.problem && store.read.holds.some((h) => /^measures? of water$/i.test(h.what)));
        if (tank) ws.push({ from: tank.id, to: id });
      }
    });
  }
  // The order the board's work comes in: one box, the most urgent first.
  const order = urgencyOrder(P);
  add({ id: "urgency", kind: "clock", col: 3, name: "The order of urgency", text: order.kinds.map((kind, i) => `${i + 1}. ${workKindWords(kind)}`).join("; ") + (order.problems.length ? `. ${order.problems.join(". ")}.` : "."), label: "Which work comes before which", bind: { urgency: true }, problem: order.problems.length > 0 });
  if (L.place) add(linkNode(`link_place_${L.place.id}`, "place", L.place.name, "The place itself.", "The place"));
  return { list, ws };
}
// The kinds of work in the order a logistics file gives them, with any it leaves out after the rest, as the game
// takes them; and what's wrong with its lines, if anything.
function urgencyOrder(P) {
  const kinds = [], problems = [];
  for (const one of P.urgency ?? []) {
    const read = readUrgencyLine(one.text ?? one);
    if (read.problem) problems.push(read.problem);
    else if (kinds.includes(read.kind)) problems.push(`${workKindWords(read.kind)} is written twice`);
    else kinds.push(read.kind);
  }
  return { kinds: [...kinds, ...WORK_KINDS.map(([kind]) => kind).filter((kind) => !kinds.includes(kind))], problems };
}
// A place's chain of command: each post a box with who holds it when a game begins, with an arrow from whoever chooses
// it (another post, the council or the civilians), and each job a box with who does it, with an arrow from the post
// that heads it, and the spare hands.
const firstUpper = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const pluralOf = (words) => (/s$/.test(words) ? words : `${words}s`);
const holderLines = (P) => (P.holders ?? []).map((one, i) => ({ i, read: readHolderLine(one.text ?? one) })).filter((one) => !one.read.problem);
const workersLines = (P) => (P.workers ?? []).map((one, i) => ({ i, read: readWorkersLine(one.text ?? one) })).filter((one) => !one.read.problem);
const sameJob = (a, b) => slugOf(a).replace(/s$/, "") === slugOf(b).replace(/s$/, "");
function crewName(key) {
  const want = String(key).toLowerCase();
  return (state.lists.crew ?? []).find((one) => one.key.toLowerCase() === want || one.name.toLowerCase() === want)?.name ?? key;
}
function commandGraph() {
  const P = state.item;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  const n = P.numbers ?? {};
  add({ id: "about", kind: "about", col: 0, name: P.name, text: [n.reviews && `Reviews every ${n.reviews}.`, n.stretch && `A bad stretch: ${n.stretch}.`, n.mutiny && `A mutiny brews: ${n.mutiny}.`, n.brig && `The brig: ${n.brig}.`].filter(Boolean).join(" ") || "The numbers at the top.", label: "The numbers at the top" });
  const posts = (P.posts ?? []).map((one, i) => ({ i, read: readPostLine(one.text ?? one) }));
  const byTitle = (words) => posts.find((one) => !one.read.problem && slugOf(one.read.title) === slugOf(words));
  const depth = (one, seen = new Set()) => {
    if (one.read.problem || ["council", "civilians"].includes(one.read.chosenBy)) return 2;
    const chooser = byTitle(one.read.chosenBy);
    if (!chooser || seen.has(chooser.i)) return 2;
    seen.add(chooser.i);
    return depth(chooser, seen) + 1;
  };
  const holders = Object.fromEntries(holderLines(P).map(({ read }) => [slugOf(read.post), read.holder]));
  for (const body of ["council", "civilians"]) {
    if (posts.some((one) => !one.read.problem && one.read.chosenBy === body)) add({ id: `body_${body}`, kind: "lead", col: 1, name: `The ${body}`, text: body === "council" ? "The civil council, who choose the captain." : "The civilians aboard, who choose their speaker.", label: "Who chooses" });
  }
  for (const one of posts) {
    const { read, i } = one;
    const holder = read.problem ? null : holders[slugOf(read.title)];
    const said = read.problem ? read.problem : [
      `In ${read.room}.`, `Chosen by the ${read.chosenBy}.`, read.watchBill && "Keeps the watch bill.", read.brig && "Keeps the brig.",
      read.heads.length && `Heads ${read.heads.join(", ")}.`, read.pool.length && `Picked from ${read.pool.join(", ")}.`,
      read.skills.length && `Skills: ${read.skills.join(", ")}.`, read.duty.length && `Duty: ${read.duty.join(", ")}.`,
    ].filter(Boolean).join(" ");
    const id = add({ id: `post${i}`, kind: "beat", col: Math.min(4, depth(one)), name: read.problem ? "A post" : `${firstUpper(read.title)}: ${holder ? (holder === "the chair" ? "the chair" : crewName(holder)) : "nobody"}`, text: said, label: "A post", bind: { post: i }, problem: Boolean(read.problem) });
    if (read.problem) continue;
    const from = ["council", "civilians"].includes(read.chosenBy) ? `body_${read.chosenBy}` : byTitle(read.chosenBy) ? `post${byTitle(read.chosenBy).i}` : null;
    if (from) ws.push({ from, to: id });
  }
  const workers = Object.fromEntries(workersLines(P).map(({ read }) => [slugOf(read.job), read.people]));
  (P.jobs ?? []).forEach((one, i) => {
    const read = readJobLine(one.text ?? one);
    const who = read.problem ? [] : workers[slugOf(read.title)] ?? [];
    const id = add({ id: `job${i}`, kind: "route", col: 5, name: read.problem ? "A job" : `${firstUpper(pluralOf(read.title))}, ${read.wanted} wanted`, text: read.problem ?? `In ${read.room}.${read.skills.length ? ` Skills: ${read.skills.join(", ")}.` : ""} ${who.length ? `Done by ${who.join(", ")}.` : "Nobody does it when a game begins."}`, label: "A job", bind: { job: i }, problem: Boolean(read.problem) });
    if (read.problem) return;
    for (const post of posts) if (!post.read.problem && post.read.heads.some((words) => sameJob(words, read.title))) ws.push({ from: `post${post.i}`, to: id });
  });
  const spare = workers[slugOf(SPARE)] ?? [];
  add({ id: "spare", kind: "fact", col: 5, name: "Spare hands", text: spare.length ? spare.join(", ") : "Nobody.", label: "Spare hands, for the first officer to put to work", bind: { spare: true } });
  return { list, ws };
}
function sceneGraph() {
  const scene = state.scene;
  const list = [], ws = [];
  const byName = Object.fromEntries(scene.parts.map((part) => [part.name, part]));
  const first = state.kind === "request" ? "ask" : "start";
  const depth = { [first]: 0 };
  const queue = [first];
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
  const builders = { story: notesGraph, place: placeGraph, person: personGraph, species: speciesGraph, enemy: enemyGraph, item: itemGraph, faction: factionGraph, perk: perkGraph, computer: computerGraph, program: programGraph, part: partGraph, systems: systemsGraph, logistics: logisticsGraph, port: portGraph, goods: goodsGraph, command: commandGraph, request: requestGraph, health: healthGraph };
  const graph = state.tab === "scene" ? sceneGraph() : builders[state.kind]();
  nodes = graph.list;
  wires = graph.ws;
  for (const node of nodes) node.problem ??= state.problems.some((one) => problemTouches(one, node));
}
// Whether the checker's problem is about this box, so it can be marked.
function problemTouches(problem, node) {
  const id = state.id;
  if (state.kind === "computer" && node.bind?.entry === "programs") return problem.includes(`in the program "${node.name}"`);
  if (state.kind === "computer") return node.kind === "about" && !/in the program "/.test(problem);
  if (state.kind !== "story") return node.kind === "about";
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
  if (state.tab !== "notes" || state.kind !== "story") return nodes;
  const focus = state.expanded ?? nodes.find((node) => node.kind === "ending")?.id;
  const shown = new Set(nodes.filter((node) => !UNFOLDS.includes(node.kind)).map((node) => node.id));
  const reach = (id) => { for (const wire of wires) if (wire.from === id && !shown.has(wire.to)) { shown.add(wire.to); reach(wire.to); } };
  if (focus) reach(focus);
  for (const wire of wires) if (wire.from === "lead" && UNFOLDS.includes(nodes.find((node) => node.id === wire.to)?.kind)) { shown.add(wire.to); reach(wire.to); }
  return nodes.filter((node) => shown.has(node.id));
}
// A remembered position belongs to a board, the notes or the scene, whichever tab is showing it or was last.
const posKey = (node) => `${state.tab === "file" ? state.lastBoard ?? "notes" : state.tab}:${node.id}`;
function layout() {
  COL_W = state.tab === "scene" ? 390 : 300;
  LEFT = state.tab === "scene" ? 20 : state.kind === "story" ? 150 : 20;
  const visible = visibleNodes();
  for (const node of nodes) node.hidden = !visible.includes(node);
  const cols = {};
  for (const node of visible) if (node.row !== "clock") (cols[node.col] ??= []).push(node);
  let bottom = TOP;
  for (const [col, list] of Object.entries(cols)) {
    let y = TOP;
    for (const node of list) {
      const saved = state.positions[posKey(node)];
      node.x = saved?.x ?? LEFT + Number(col) * COL_W;
      node.y = saved?.y ?? y;
      y = Math.max(y, node.y) + (node.h ?? 110) + GAP;
      bottom = Math.max(bottom, y);
    }
  }
  let x = LEFT + COL_W;
  for (const node of visible.filter((one) => one.row === "clock")) {
    const saved = state.positions[posKey(node)];
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
      el("div", { class: "kind" }, node.label, node.kind === "ending" && node.ending ? el("span", { class: "tag" }, node.ending) : null),
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
  if (state.kind === "story") return writeStoryText(S(), C());
  if (state.kind === "systems") return writeSystemsText(state.item);
  if (state.kind === "logistics") return writeLogisticsText(state.item);
  if (state.kind === "port") return writePortText(state.item);
  if (state.kind === "goods") return writeGoodsText(state.item);
  if (state.kind === "request") return sceneText();
  if (state.kind === "command") return writeCommandText(state.item);
  if (state.kind === "health") return writeHealthOf();
  return writeWorldText(state.item, SPECS[state.kind]);
}
const sceneText = () => (state.scene ? [state.scene.header, ...state.scene.parts.map((part) => `== ${part.name}\n${part.raw}`)].join("\n") : "");
const sceneRoute = () => `/api/board/${state.scenePrefix === "talk" ? "talk" : state.scenePrefix === "request" ? "request" : "scene"}/${state.id}`;

// ---- Tabs, zoom and looking around ------------------------------------------------------------
async function showTab(tab) {
  if (tab === "scene" && !state.written) {
    say(state.kind === "person" ? `${state.item.name} has no written lines yet: stock lines speak for them.` : `${S().title} has no written scene yet. Until it has, it plays out by itself on the story clock.`, false);
    tab = "notes";
  }
  if (tab !== "file") state.lastBoard = tab;
  if (tab === "scene" && !state.scene) {
    try {
      state.scene = await call(sceneRoute());
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
// Where boxes were moved to is kept by the game, per story or thing, so it's the same next time.
function saveLayoutSoon() {
  clearTimeout(state.layoutTimer);
  state.layoutTimer = setTimeout(() => { call("/api/board/layout", { key: state.layoutKey, positions: state.positions }).catch((err) => say(err.message, false)); }, 400);
}
function tidy() {
  state.positions = {};
  saveLayoutSoon();
  layout();
  render();
  fit();
}

// ---- New arrows, by dragging one box onto another ---------------------------------------------------
// What dropping one box on another means: a fact comes after an ending, a consequence follows an ending, and in a
// written scene a part gets a choice that leads to the other part.
function canConnect(from, to) {
  if (state.tab === "scene") return ["part", "check", "end"].includes(from.kind) && ["part", "check", "end"].includes(to.kind) && from !== to;
  if (state.kind !== "story") return false;
  return to.kind === "ending" && (from.kind === "fact" || from.kind === "consequence");
}
function connect(from, to) {
  if (state.tab === "scene") {
    const part = state.scene.parts[from.part];
    state.selected = { node: from.id };
    keepPart(from.part, `${part.raw.replace(/\n+$/, "")}\n> Say what the player does -> ${to.name}\n`);
    say(`${from.name} now has a choice that leads to ${to.name}. Click its words to say what the player does.`);
    return;
  }
  const story = S();
  if (from.kind === "fact") (story.gm.factAfter ??= {})[from.fact] = to.ending;
  else C().consequences[from.bind.cons].of = `ended ${state.id} ${to.ending}`;
  state.expanded = to.id;
  state.selected = { node: from.id };
  changed();
}
// Dropping the words on an arrow onto a part sends the choice there instead.
function retarget(wire, to) {
  const part = state.scene.parts[wire.part];
  const rawLines = part.raw.split("\n");
  const line = wire.choice !== undefined ? part.choices[wire.choice]?.line : wire.rule !== undefined ? part.when[wire.rule]?.line : null;
  const at = line ? line - part.line - 1 : -1;
  if (at < 0 || at >= rawLines.length) return say("That arrow is changed in the part's own box.", false);
  if (wire.choice !== undefined && part.choices[wire.choice]?.check) return say("A check's two ways are picked in the box on the right, passed and failed.", false);
  rawLines[at] = rawLines[at].replace(/->\s*\S+/, `-> ${to.name}`);
  state.selected = { node: wire.from };
  keepPart(wire.part, rawLines.join("\n"));
}

// ---- Clicking and dragging ------------------------------------------------------------------------
let drag = null, pan = null;
// The box under the pointer that the dragged thing could be dropped on, lit up while it's there.
function dropTarget(event, from) {
  const over = document.elementFromPoint(event.clientX, event.clientY)?.closest(".board-node");
  const target = over && over !== from.el ? nodes.find((one) => one.id === over.dataset.id) : null;
  for (const lit of document.querySelectorAll(".board-node.target")) lit.classList.remove("target");
  if (target && canConnect(from, target)) {
    target.el.classList.add("target");
    return target;
  }
  return null;
}
document.addEventListener("pointerdown", (event) => {
  const canvas = $("board-canvas");
  if (!canvas) return;
  const nodeEl = event.target.closest(".board-node");
  if (nodeEl && canvas.contains(nodeEl)) {
    const node = nodes.find((one) => one.id === nodeEl.dataset.id);
    drag = { node, startX: event.clientX, startY: event.clientY, x: node.x, y: node.y, moved: false, target: null };
    try { nodeEl.setPointerCapture(event.pointerId); } catch { /* fine without */ }
    return;
  }
  const labelEl = event.target.closest(".board-label");
  if (labelEl && canvas.contains(labelEl) && state.tab === "scene") {
    drag = { label: wires[Number(labelEl.dataset.wire)], el: labelEl, startX: event.clientX, startY: event.clientY, left: parseFloat(labelEl.style.left), top: parseFloat(labelEl.style.top), moved: false, target: null };
    try { labelEl.setPointerCapture(event.pointerId); } catch { /* fine without */ }
    return;
  }
  const scroll = $("board-scroll");
  if (event.target === scroll || event.target === canvas || event.target === $("board-wires")) {
    pan = { x: event.clientX, y: event.clientY, left: scroll.scrollLeft, top: scroll.scrollTop };
    scroll.classList.add("dragging");
  }
});
document.addEventListener("pointermove", (event) => {
  if (drag?.label) {
    const dx = (event.clientX - drag.startX) / state.zoom, dy = (event.clientY - drag.startY) / state.zoom;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    drag.el.classList.add("dragging");
    drag.el.style.left = `${drag.left + dx}px`;
    drag.el.style.top = `${drag.top + dy}px`;
    const from = nodes.find((one) => one.id === drag.label.from);
    drag.target = dropTarget(event, { el: drag.el, kind: from?.kind ?? "part" });
  } else if (drag) {
    const dx = (event.clientX - drag.startX) / state.zoom, dy = (event.clientY - drag.startY) / state.zoom;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    drag.node.el.classList.add("dragging");
    drag.node.x = Math.max(0, drag.x + dx);
    drag.node.y = Math.max(0, drag.y + dy);
    drag.node.el.style.left = `${drag.node.x}px`;
    drag.node.el.style.top = `${drag.node.y}px`;
    drag.target = dropTarget(event, drag.node);
    drawWires();
  } else if (pan) {
    const scroll = $("board-scroll");
    scroll.scrollLeft = pan.left - (event.clientX - pan.x);
    scroll.scrollTop = pan.top - (event.clientY - pan.y);
  }
});
document.addEventListener("pointerup", () => {
  if (drag?.label) {
    const { label, moved, target, el: labelEl } = drag;
    drag = null;
    labelEl.classList.remove("dragging");
    for (const lit of document.querySelectorAll(".board-node.target")) lit.classList.remove("target");
    if (moved && target) retarget(label, target);
    else if (moved) drawWires();
    return;
  }
  if (drag) {
    const { node, moved, target } = drag;
    drag = null;
    node.el?.classList.remove("dragging");
    for (const lit of document.querySelectorAll(".board-node.target")) lit.classList.remove("target");
    if (!moved) select({ node: node.id });
    else if (target) {
      // Dropped on another box: that's a link, and the box goes back to its column when the board is drawn again.
      connect(node, target);
    } else {
      state.positions[posKey(node)] = { x: node.x, y: node.y };
      saveLayoutSoon();
      render();
    }
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
  if (node?.kind === "ending" && state.kind === "story") { state.expanded = node.id; layout(); }
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
  if (b.path) return get(state.item, b.path) ?? "";
  if (b.district !== undefined) return state.item.gm.districts[b.district].desc;
  if (b.items) return (get(state.item, b.items) ?? []).join("\n");
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
  if (b.path) setPath(state.item, b.path, text || (b.optional ? undefined : text));
  else if (b.district !== undefined) state.item.gm.districts[b.district].desc = text;
  else if (b.items) setPath(state.item, b.items, value.split("\n").map((one) => one.trim()).filter(Boolean));
  else if (b.text) story[b.text] = text;
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
  if (b.district !== undefined) state.item.gm.districts.splice(b.district, 1);
  else if (b.entry) state.item[b.entry].splice(b.i, 1);
  else if (b.system !== undefined) state.item.systems.splice(b.system, 1);
  else if (b.computer !== undefined) state.item.computers.splice(b.computer, 1);
  else if (b.store !== undefined) state.item.stores.splice(b.store, 1);
  else if (b.logLine) state.item[b.logLine[0]].splice(b.logLine[1], 1);
  else if (b.portLine) state.item[b.portLine[0]].splice(b.portLine[1], 1);
  else if (b.goodLine) state.item.steps[b.goodLine[0]].splice(b.goodLine[1], 1);
  else if (b.healthLine) state.item[b.healthLine[0]].splice(b.healthLine[1], 1);
  else if (b.post !== undefined) {
    // A post goes with the line that says who holds it.
    const read = readPostLine(state.item.posts[b.post]?.text ?? state.item.posts[b.post]);
    state.item.posts.splice(b.post, 1);
    if (!read.problem) state.item.holders = (state.item.holders ?? []).filter((one) => { const held = readHolderLine(one.text ?? one); return held.problem || slugOf(held.post) !== slugOf(read.title); });
  } else if (b.job !== undefined) {
    // And a job with the line that says who does it.
    const read = readJobLine(state.item.jobs[b.job]?.text ?? state.item.jobs[b.job]);
    state.item.jobs.splice(b.job, 1);
    if (!read.problem) state.item.workers = (state.item.workers ?? []).filter((one) => { const who = readWorkersLine(one.text ?? one); return who.problem || slugOf(who.job) !== slugOf(read.title); });
  }
  else if (b.list) story.gm[b.list].splice(b.i, 1);
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
function addDistrict() {
  const P = state.item;
  (P.gm ??= {}).districts ??= [];
  P.gm.districts.push({ name: "A new district", desc: "What it's like, and who's there." });
  state.selected = { node: `district${P.gm.districts.length - 1}` };
  changed();
}

// A computer's new file, letter or program, ready to be written.
function addEntry(key) {
  const P = state.item;
  P[key] ??= [];
  P[key].push(key === "files" ? { name: "a_new_file.txt", desc: "What the player reads in it." } : key === "mail" ? { name: "From someone to someone", desc: "The letter." } : { name: "A new program", desc: "What the screen says when it runs." });
  state.selected = { node: `${key === "files" ? "file" : key === "mail" ? "mail" : "program"}${P[key].length - 1}` };
  changed();
}

// A new system, named after the first known one the place hasn't got, or a system of its own.
function addSystem() {
  const P = state.item;
  const known = KNOWN_SYSTEMS.find((sid) => !P.systems.some((one) => one.id === sid));
  const name = known ? known[0].toUpperCase() + known.slice(1) : "Water";
  P.systems.push({ name, id: systemIdOf(name), lines: [] });
  state.selected = { node: `system${P.systems.length - 1}` };
  changed();
}
function addComputerLine() {
  const P = state.item;
  P.computers ??= [];
  P.computers.push({ text: `a console in ${state.lists.rooms?.[0] ?? "a room"}: lights` });
  state.selected = { node: `computer${P.computers.length - 1}` };
  changed();
}

// ---- The inspector: what's selected, and the ways to change it -----------------------------------
const h2 = (text) => el("h2", {}, text);
const hint = (text) => el("div", { class: "hint" }, text);
const row = (...children) => fill(el("div", { class: "row" }), ...children);
const button = (text, onclick, extra = {}) => el("button", { type: "button", onclick, ...extra }, text);
const textarea = (id, value, lines = 6) => { const area = el("textarea", { id, rows: String(lines) }); area.value = value ?? ""; return area; };
const picker = (id, options, value) => { const pick = el("select", { id }); for (const [v, label] of options) pick.append(el("option", { value: v }, label)); pick.value = value; return pick; };
const numberBox = (id, value, step = 1) => { const box = el("input", { id, type: "number", step: String(step), class: "number-box" }); box.value = value ?? ""; return box; };
const textBox = (id, value) => { const box = el("input", { id, type: "text", class: "name-box" }); box.value = value ?? ""; return box; };
const checkBox = (id, value) => { const box = el("input", { id, type: "checkbox" }); box.checked = Boolean(value); return box; };

function inspect() {
  const inspector = $("board-inspector");
  if (!inspector) return;
  inspector.replaceChildren();
  const sel = state.selected;
  if (state.tab === "file") return fill(inspector, h2("The file"), hint("This is the same thing, written the way its file holds it. The board is read from this, and Save writes it, so the file can still be changed by hand, on GitHub or in Notepad."));
  if (!sel) return inspectNothing(inspector);
  if (sel.wire !== undefined) return inspectWire(inspector, wires[sel.wire], sel.wire);
  const node = nodes.find((one) => one.id === sel.node);
  if (!node) return inspectNothing(inspector);
  if (state.tab === "scene") return inspectPart(inspector, node);
  if (state.kind === "request") return inspectRequestNode(inspector, node);
  if (node.kind === "link") return inspectLink(inspector, node);
  // A box that only shows what's changed elsewhere.
  if (node.readOnly) return fill(inspector, h2(node.label), el("h3", {}, node.name), el("div", { class: "quote" }, node.text), hint(node.readOnly));
  if (node.lines) return fill(inspector, h2("Written lines"), hint(node.text), state.written ? row(button("Open the written lines", () => showTab("scene"))) : hint("A file called talk_<id>.txt in world/scenes gives them written lines; the how-to there explains it."));
  if (node.kind === "about" && state.kind === "port") return inspectPortAbout(inspector);
  if (node.kind === "about" && state.kind === "goods") return inspectGoodsAbout(inspector);
  if (node.bind?.portLine) return inspectPortLine(inspector, node);
  if (node.bind?.goodLine) return inspectGoodLine(inspector, node);
  if (node.kind === "about") return state.kind === "story" ? inspectAbout(inspector) : state.kind === "systems" ? inspectSystemsAbout(inspector) : state.kind === "logistics" ? inspectLogisticsAbout(inspector) : state.kind === "command" ? inspectCommandAbout(inspector) : state.kind === "health" ? inspectHealthAbout(inspector) : inspectWorldAbout(inspector);
  if (node.bind?.post !== undefined) return inspectPostLine(inspector, node);
  if (node.bind?.job !== undefined) return inspectJobLine(inspector, node);
  if (node.bind?.spare) return inspectSpareLine(inspector);
  if (node.bind?.store !== undefined) return inspectStoreLine(inspector, node);
  if (node.bind?.logLine) return inspectLogisticsLine(inspector, node);
  if (node.bind?.urgency) return inspectUrgency(inspector);
  if (node.bind?.healthTop) return inspectHealthTop(inspector, node);
  if (node.bind?.healthLine) return inspectHealthLine(inspector, node);
  if (node.bind?.speciesBody) return inspectSpeciesBody(inspector);
  if (node.bind?.numbers) return inspectNumbers(inspector, node);
  if (node.bind?.fight) return inspectFight(inspector, node);
  if (node.bind?.speciesNumbers) return inspectSpeciesNumbers(inspector, node);
  if (node.bind?.effects) return inspectEffects(inspector, node);
  if (node.bind?.drawing) return inspectDrawing(inspector);
  if (node.bind?.enemyLines) return inspectEnemyLines(inspector, node);
  if (node.bind?.beliefs) return inspectBeliefs(inspector, node);
  if (node.bind?.district !== undefined) return inspectDistrict(inspector, node);
  if (node.bind?.entry) return inspectEntry(inspector, node);
  if (node.bind?.system !== undefined) return inspectSystemLines(inspector, node);
  if (node.bind?.computer !== undefined) return inspectComputerLine(inspector, node);
  return inspectNode(inspector, node);
}
function inspectNothing(inspector) {
  const title = state.kind === "story" ? S().title : [state.item.title, state.item.name].filter(Boolean).join(" ");
  fill(inspector,
    h2(title),
    hint(state.tab === "scene"
      ? "The written parts: each box is a part, each arrow a choice, a check's two ways, or a rule that moves the player on. Click a part and the words on its arrows appear; click those to change a choice."
      : state.kind === "story" ? "The story's notes as a board: the lead and the beats, the ways through, and the endings by name. Click an ending and the facts it leaves, what follows days later, and the stories that react to it unfold beside it. Click any box to read all of it and change it."
        : state.kind === "place" ? "The place as a board: what the player sees, the feel of it, its districts, what can happen there, and the people and stories here. Click any box to read all of it and change it."
          : state.kind === "person" ? "The person as a board: how the game sees them, their looks, personality, voice, goals and secrets, their numbers, how they fight, and where they belong. Click any box to read all of it and change it."
            : state.kind === "species" ? "The species as a board: what the player reads, the notes on how they play, their numbers, and the people who are one. Click any box to read all of it and change it."
              : state.kind === "enemy" ? "The enemy as a board: what the player sees, what they say in a fight, who they fight for, and where they turn up. Their numbers are in the box on the left."
                : state.kind === "item" ? "The item as a board: what the player reads, its effects, and where it's sold or found. Its numbers are in the box on the left."
                  : state.kind === "faction" ? "The faction as a board: what the player reads, what they believe, and their people, places, enemies and stories, each a box that opens."
                    : state.kind === "perk" ? "The perk as a board: what the player reads, what it changes, and the perks it needs or leads to. What it needs is in the box on the left."
                      : state.kind === "systems" ? "A place's systems as a board: who keeps it running, each system with its parts and the rooms they're in, each computer with arrows to what it runs, and the rooms with what's in each. Click any box to read it and change it."
                      : state.kind === "logistics" ? "The ship's logistics as a board: each store with what it holds, what it wants kept in it and who carries for it, with an arrow from every store that could supply it, and the machines, loads and refills, each with arrows to the stores its words name. Click any box to read it and change it."
                      : state.kind === "port" ? "A port as a board: what it usually holds of each good and where it sends for more, what it makes in a day, and what it uses. The ports it sends to are on the left and the ports that send to it on the right, each a box that opens. Click any box to read its line and change it."
                      : state.kind === "goods" ? "A tree of goods as a board: each good at its step of the tree, with the ports that make it. Click any box to read its line and change it."
                      : state.kind === "health" && state.id === "wounds" ? "The kinds of wound and old mark as a board: the lines at the top that say how blood, healing, walking and pain go, every wound and old mark, the weapons and the hits, with arrows from a weapon to the hits it makes and from a hit or an accident to the wounds it leaves, and the species, whose Body parts say how often each part is hit. Click any box to read it and change it."
                      : state.kind === "health" ? "A place's medbay as a board: the lines at the top that say where it is and how it works, each treatment and each kind of mending, and who starts the game hurt. Click any box to read it and change it."
                      : state.kind === "request" && state.item?.overview ? "Every kind of request as a box, in a column for the lives it's for, with who asks, what's wanted and how long they give. An order is in its own colour. Click one to open it."
                      : state.kind === "request" ? "A request as a board: its lines on top, which say who it's for, when it comes up, who asks and what's wanted; what they ask, with an arrow for each answer the player can give; and how it ends, done, failed or no longer needed. Click a line or a part to read it and change it. Every part shows the file's parts the way a written scene's are."
                      : state.kind === "program" ? "A program for the rig as a board: what writing it takes and what memory it needs, what it does, its numbers when it runs, and the computers it can be copied off and the market that sells it, each a box that opens. Its numbers are in the box on the left."
                      : state.kind === "part" ? "A part of a rig as a board: what it is and what it adds to the build, a board's sockets, where it comes from, and what making it at the bench takes. Its numbers are in the box on the left."
                      : state.kind === "command" ? "The chain of command as a board: each post with who holds it when a game begins, and an arrow from whoever chooses it; each job with who does it, and an arrow from the post that heads it; and the spare hands. Click any box to read it and change it."
                      : "The computer as a board: what the player sees when they sit down, its files, letters, logs and programs, and the computers it reaches over its network. Click any box to read all of it and change it; its class, place and login are in the box on the left."),
    el("div", { class: "legend" }, ...(state.tab === "scene" ? [["beat", "parts"], ["ending", "checks and fights"], ["end", "ends"], ["clock", "missing"]]
      : state.kind === "story" ? [["lead", "the lead"], ["beat", "beats"], ["route", "ways through"], ["ending", "endings"], ["fact", "facts"], ["consequence", "consequences"], ["clock", "the clock"], ["next", "other stories"]]
        : state.kind === "systems" ? [["beat", "systems"], ["route", "its own systems"], ["fact", "computers"], ["clock", "rooms"], ["next", "links to open"]]
        : state.kind === "logistics" ? [["beat", "stores"], ["route", "machines"], ["clock", "loads"], ["consequence", "refills"], ["next", "links to open"]]
        : state.kind === "port" ? [["beat", "what it holds"], ["route", "what it makes"], ["clock", "what it uses"], ["next", "links to open"]]
        : state.kind === "goods" ? [["beat", "developed"], ["ending", "advanced"], ["route", "refined"], ["lead", "basic"]]
        : state.kind === "request" && state.item?.overview ? [["beat", "requests"], ["route", "orders"]]
        : state.kind === "request" ? [["lead", "lines on top"], ["beat", "what they ask"], ["route", "the answers"], ["ending", "how it ends"], ["clock", "not written"]]
        : state.kind === "command" ? [["lead", "who chooses"], ["beat", "posts"], ["route", "jobs"], ["fact", "spare hands"]]
        : state.kind === "health" && state.id === "wounds" ? [["lead", "lines at the top"], ["beat", "wounds"], ["fact", "weapons"], ["route", "hits"], ["clock", "accidents"], ["consequence", "old marks"], ["next", "links to open"]]
        : state.kind === "health" ? [["lead", "lines at the top"], ["beat", "treatments"], ["route", "mending"], ["fact", "hurt at the start"], ["next", "links to open"]]
        : state.kind === "computer" ? [["lead", "what they see"], ["beat", "files"], ["fact", "letters"], ["clock", "logs"], ["route", "programs"], ["next", "links to open"]]
          : [["lead", "for the player"], ["beat", "for the game master"], ["route", "lists and numbers"], ["ending", "the dice"], ["next", "links to open"]]).map(([kind, words]) => el("span", { class: `l-${kind}` }, words))),
    state.tab === "notes" && state.kind === "story" ? row(button("+ an ending", addEnding), button("+ a fact", () => addFact()), button("+ something days later", () => addConsequence()), button("+ a stage of the clock", addStage), button("+ what changes this story", addReaction)) : null,
    state.tab === "notes" && state.kind === "place" ? row(button("+ a district", addDistrict)) : null,
    state.tab === "notes" && state.kind === "systems" ? row(button("+ a system", addSystem), button("+ a computer", addComputerLine)) : null,
    state.tab === "notes" && state.kind === "logistics" ? row(button("+ a store", addStore), ...["machines", "loads", "refills"].map((part) => button(`+ ${PART_TITLES[part].toLowerCase().replace(/s$/, "")}`, () => addLogisticsLine(part)))) : null,
    state.tab === "notes" && state.kind === "port" ? row(...PORT_PARTS.map((part) => button(`+ a line under ${PORT_TITLES[part]}`, () => addPortLine(part)))) : null,
    state.tab === "notes" && state.kind === "goods" ? row(...STEPS.filter((step) => state.item.steps?.[step]).map((step) => button(`+ a ${step} good`, () => addGoodLine(step)))) : null,
    state.tab === "notes" && state.kind === "command" ? row(button("+ a post", addPost), button("+ a job", addJob)) : null,
    state.tab === "notes" && state.kind === "health" ? row(...healthParts().map(([part, , label]) => button(`+ ${label.toLowerCase()}`, () => addHealthLine(part)))) : null,
    state.tab === "notes" && state.kind === "computer" ? row(button("+ a file", () => addEntry("files")), button("+ a letter", () => addEntry("mail")), button("+ a program", () => addEntry("programs"))) : null,
    state.problems.length ? el("div", { class: "problems" }, h2("The checker says"), ...state.problems.map((one) => el("div", {}, one))) : hint("The checker has nothing to say about this one."),
    hint(`Save writes the file in world/${FOLDERS[state.kind]}, and the game uses the new version from the next turn.`));
}
function inspectEnemyLines(inspector, node) {
  const P = state.item;
  const boxes = LINE_PHRASES.map(([key, phrase]) => {
    const area = textarea(`edit-lines-${key}`, (P.lines?.[key] ?? []).join("\n"), 2);
    return fill(el("div", {}), el("label", { for: area.id }, `${phrase}, one line each`), area, row(button("Keep", () => { const items = area.value.split("\n").map((one) => one.trim()).filter(Boolean); if (items.length) (P.lines ??= {})[key] = items; else if (P.lines) { delete P.lines[key]; if (!Object.keys(P.lines).length) delete P.lines; } changed(); }, { class: "small" })));
  });
  fill(inspector, h2("What they say"), hint("One is picked at random each time it happens. A box left empty means the plain line is used."), ...boxes);
}
function inspectBeliefs(inspector, node) {
  fill(inspector, h2("What they believe"), hint("How far they lean on each axis, from -10 to 10. The game compares them with the player's own beliefs when it works out how they get on."), pairsEditor(state.item, "beliefs", "Beliefs", state.lists.axes));
}

function inspectNode(inspector, node) {
  const story = S(), clock = C(), b = node.bind ?? {};
  if (node.kind === "next") {
    return fill(inspector, h2("Another story reacts"), el("h3", {}, node.name), hint(`When: ${conditionWords(node.cond)}.`), el("div", { class: "quote" }, node.text), row(button(`Open ${storyTitle(node.story)}`, () => load("story", node.story))), hint("It's written in that story's file, so it's changed there."));
  }
  const nameBox = textBox("edit-name", node.ending ?? node.fact ?? "");
  const area = textarea("edit-text", textOf(node), b.lines || b.checks || b.items ? 8 : 6);
  const checksArea = b.checks ? textarea("edit-fights", story.gm.fights.join("\n"), 4) : null;
  if (b.checks) area.value = story.gm.checks.join("\n");
  const keep = () => {
    if (b.checks) {
      story.gm.checks = area.value.split("\n").map((one) => one.trim()).filter(Boolean);
      story.gm.fights = area.value && checksArea.value.split("\n").map((one) => one.trim()).filter(Boolean);
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
    el("label", { for: "edit-text" }, b.lines ? "One way through on each line" : b.items ? "One on each line" : b.checks ? "Checks that fit, one on each line: a skill, a colon, easy, moderate or hard, and what it's for" : node.kind === "ending" ? "What's true if the story ends this way" : node.kind === "fact" ? "The line the player reads" : node.kind === "consequence" || node.kind === "clock" ? "What people hear" : node.kind === "react" ? "What changes in this story" : "The words"),
    area,
    checksArea ? el("label", { for: "edit-fights" }, "If it comes to a fight, one on each line: enemy ids, and when") : null,
    checksArea,
    row(button("Keep", keep), button("Undo", () => inspect())),
    node.kind === "ending" ? row(button("+ a fact it leaves", () => addFact(node.ending)), button("+ something days later", () => addConsequence(node.ending))) : null,
    node.kind === "beat" && b.list ? row(button("+ a beat after this", () => addBeat(b.i))) : null,
    node.kind === "fact" ? factAfterRow(node) : null,
    node.kind === "consequence" ? [daysRow(clock.consequences[b.cons]), conditionPicker(clock.consequences[b.cons], "of", "What has to be on the record"), placeRow(clock.consequences[b.cons]), subFacts(clock.consequences[b.cons]), placeHitsEditor(clock.consequences[b.cons]), shipEditor(clock.consequences[b.cons])] : null,
    node.kind === "clock" ? [daysRow(clock.stages[b.stage]), stageLeadRow(clock.stages[b.stage]), conditionPicker(clock.stages[b.stage], "if", "Only if", true), placeRow(clock.stages[b.stage]), subFacts(clock.stages[b.stage]), stageEndingRow(clock.stages[b.stage]), placeHitsEditor(clock.stages[b.stage]), shipEditor(clock.stages[b.stage])] : null,
    node.kind === "react" ? conditionPicker(story.gm.reacts[b.react], "to", "When this is on the record") : null,
    ["ending", "fact", "consequence", "clock", "react"].includes(node.kind) || b.list ? row(button("Remove", () => remove(node), { class: "danger" })) : null,
    node.problem ? el("div", { class: "problems" }, ...state.problems.filter((one) => problemTouches(one, node)).map((one) => el("div", {}, one))) : null,
    hint("Keep changes the box and the file together. Save writes the file."));
}
function inspectAbout(inspector) {
  const story = S(), clock = C();
  const title = textBox("edit-title", story.title);
  const kind = picker("edit-kind", ["main", "crew", "dilemma", "mystery", "exploration", "survival", "politics", "job", "faction"].map((one) => [one, one]), story.kind);
  const after = picker("edit-after", [["", "nothing: it can start on its own"], ...state.all.filter((one) => one.id !== state.id).map((one) => [one.id, one.title])], story.after ?? "");
  const level = picker("edit-level", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((one) => [String(one), `level ${one}`]), String(story.minLevel ?? 1));
  const places = textBox("edit-places", story.places.join(", "));
  const people = textBox("edit-people", story.people.join(", "));
  const factions = textBox("edit-factions", story.factions.join(", "));
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

// The lines at the top of a person's, a place's or a species' file, each with the right kind of box.
function inspectWorldAbout(inspector) {
  const spec = SPECS[state.kind], item = state.item, lists = state.lists;
  const boxes = [];
  const optionsFor = (path) => (path === "species" ? lists.species : path === "location" ? lists.places : path === "faction" ? lists.factions
    : path === "stat" ? lists.attributes.map((one) => ({ id: one, name: one })) : path === "skill" ? lists.skills.map((one) => ({ id: one, name: one }))
      : path === "type" ? lists.itemTypes.map((one) => ({ id: one, name: one })) : path === "art" ? lists.arts.map((one) => ({ id: one, name: one })) : path === "motive" ? lists.motives.map((one) => ({ id: one, name: one }))
        : path === "rarity" ? (lists.rarities ?? []).map((one) => ({ id: one, name: one }))
        : path === "requires" ? lists.perks.filter((one) => one.id !== state.id) : path === "ability" ? lists.abilities
          : path === "class" ? lists.classes : path === "place" ? lists.places : path === "flavor" ? (lists.flavors ?? []).map((one) => ({ id: one, name: one }))
            : path === "kind" ? (state.kind === "program" ? lists.programKinds : state.kind === "part" ? lists.partKinds : null) : path === "soldAt" ? lists.places : path === "reaches" ? lists.reaches : null);
  const title = textBox("edit-title", item[spec.title]);
  for (const field of spec.header) {
    const value = get(item, field.path);
    const id = `edit-${field.path.replaceAll(".", "-")}`;
    let box;
    if (field.type === "pairs") {
      // Numbers with names, like on hit: stress 2, have an editor of their own, with Keep buttons of its own.
      const names = field.path === "onHit" ? ["stress", "energy"] : field.path === "loot" ? lists.items.map((one) => one.id) : field.path === "effect" ? ["hp", "energy", "stress", "dress", "hull", "fuel"] : field.path === "requiresSkill" ? lists.skills : field.path === "requiresStat" ? lists.attributes : lists.axes;
      boxes.push({ field, box: pairsEditor(item, field.path, field.key, names), own: true });
      continue;
    }
    // Where an item turns up as loot: a tick for each kind of container in world/loot/containers.txt.
    if (field.path === "foundIn" && lists.containerKinds?.length) {
      const picked = new Set((value ?? []).map((one) => String(one).toLowerCase()));
      const checks = lists.containerKinds.map((name, i) => ({ name, box: checkBox(`${id}-${i}`, picked.has(name.toLowerCase())) }));
      boxes.push({ field, checks, box: el("div", { class: "subfacts" }, el("label", {}, "Found in: the containers it turns up in"), ...checks.map(({ name, box }) => row(box, el("label", { for: box.id }, name)))) });
      continue;
    }
    if (field.type === "range") {
      const low = numberBox(`${id}-low`, value?.[0] ?? ""), high = numberBox(`${id}-high`, value?.[1] ?? "");
      boxes.push({ field, box: row(el("label", { for: low.id }, field.key), low, el("span", {}, "to"), high), low, high });
      continue;
    }
    if ((field.type === "name" || field.type === "string") && optionsFor(field.path)) box = picker(id, [["", "none"], ...optionsFor(field.path).map((one) => [one.id, one.name])], value ?? "");
    else if (field.type === "flag") box = checkBox(id, value);
    else if (field.type === "number") box = numberBox(id, value ?? "");
    else if (field.type === "list") box = textBox(id, (value ?? []).join(", "));
    else box = textBox(id, value ?? "");
    boxes.push({ field, box });
  }
  fill(inspector,
    h2(`About this ${state.kind}`),
    el("label", { for: "edit-title" }, "The name"), title,
    ...boxes.map(({ field, box, own, low, checks }) => (own || low || checks ? box : field.type === "flag" || box.tagName === "SELECT" || field.type === "number" ? row(el("label", { for: box.id }, field.key), box) : [el("label", { for: box.id }, field.type === "list" ? `${field.key}, separated by commas` : field.key), box])),
    row(button("Keep", () => {
      item[spec.title] = title.value.trim() || item[spec.title];
      for (const { field, box, own, low, high, checks } of boxes) {
        if (own) continue;
        if (checks) {
          const ticked = checks.filter((one) => one.box.checked).map((one) => one.name);
          // None ticked leaves the line out: the item isn't found in containers.
          setPath(item, field.path, ticked.length ? ticked : undefined);
          continue;
        }
        let value;
        if (field.type === "range") value = low.value === "" && high.value === "" ? undefined : [Number(low.value || 0), Number(high.value || 0)];
        else if (field.type === "flag") value = box.checked ? true : (get(item, field.path) === undefined && !box.checked ? undefined : false);
        else if (field.type === "number") value = box.value === "" ? (get(item, field.path) === undefined ? undefined : null) : Number(box.value);
        else if (field.type === "list") value = box.value.split(",").map((one) => one.trim()).filter(Boolean);
        else if (field.type === "name") value = box.value || null;
        else if (box.tagName === "SELECT") value = box.value || undefined;
        else value = box.value.trim() || (get(item, field.path) === undefined || field.path === "draft" ? undefined : "");
        if (field.type === "list" && !value.length && get(item, field.path) === undefined) value = undefined;
        setPath(item, field.path, value);
      }
      changed();
    }), button("Undo", () => inspect())),
    hint(`The file is world/${FOLDERS[state.kind]}/${state.id}.txt. Its name doesn't change here.`));
}
// A computer's file, letter or program: its name and its text, and for a program the arrow and the question mark too.
function inspectEntry(inspector, node) {
  const P = state.item, b = node.bind;
  const entry = (P[b.entry] ?? [])[b.i];
  if (!entry) return inspectNothing(inspector);
  const what = b.entry === "files" ? "file" : b.entry === "mail" ? "letter" : "program";
  const nameBox = textBox("edit-name", entry.name ?? "");
  const area = textarea("edit-text", entry.desc ?? "", 8);
  fill(inspector, h2(node.label),
    el("label", { for: "edit-name" }, what === "program" ? "The program's name, which the player clicks" : what === "letter" ? "Who to whom: From someone to someone" : "The file's name"), nameBox,
    el("label", { for: "edit-text" }, what === "program" ? "What the screen says when it runs" : what === "letter" ? "The letter" : "What the player reads in it"), area,
    what === "program" ? hint("After the words, -> and what it does, separated by ;, written like a scene's effects: * flag a_name: words on the record; * credits 10: why; * door here; * password another_computer theword. Then ? and a condition, if it's only offered sometimes. The checker marks the box red if the game can't read it.") : null,
    row(button("Keep", () => { entry.name = nameBox.value.trim() || entry.name; entry.desc = area.value.trim(); changed(); }), button("Undo", () => inspect())),
    row(button(`+ another ${what}`, () => addEntry(b.entry)), button("Remove", () => remove(node), { class: "danger" })),
    node.problem ? el("div", { class: "problems" }, ...state.problems.filter((one) => problemTouches(one, node)).map((one) => el("div", {}, one))) : null,
    hint("Keep changes the box and the file together. Save writes the file."));
}
// Who guards the place and who keeps it running, picked from its people, and its numbers in boxes with arrows.
function inspectSystemsAbout(inspector) {
  const P = state.item, L = state.links;
  const people = L.people ?? [];
  const name = textBox("edit-title", P.name ?? "");
  const draft = textBox("edit-draft", P.draft ?? "");
  const choose = (key, label) => {
    const own = P[key];
    const auto = checkBox(`edit-${key}-auto`, own === undefined);
    const boxes = people.map((one, i) => ({ one, box: checkBox(`edit-${key}-${i}`, (own ?? []).some((pick) => [one.key, one.name].some((word) => String(word).toLowerCase() === String(pick).toLowerCase()))) }));
    return { key, auto, boxes, node: el("div", { class: "subfacts" }, el("label", {}, label), row(auto, el("label", { for: auto.id }, "Go by what people do in their days")), ...boxes.map(({ one, box }) => row(box, el("label", { for: box.id }, one.name)))) };
  };
  const guards = choose("guards", "Guards: who come when the alarm rings");
  const engineers = choose("engineers", "Engineers: who fix what's broken");
  const numbers = [["alarm", "alarm rings, in minutes"], ["air", "air goes bad, in minutes"], ["reserve", "reserve air, in days, for when the air plant is stopped"], ["repair", "repairs take, in hours"], ["wear", "a part wears out every so many days"]].map(([key, label]) => ({ key, box: numberBox(`edit-${key}`, P.numbers?.[key] ?? ""), label }));
  fill(inspector, h2("Who keeps it running"),
    el("label", { for: "edit-title" }, "The place's name"), name,
    el("label", { for: "edit-draft" }, "Who wrote it (the game doesn't read this)"), draft,
    guards.node, engineers.node,
    ...numbers.map(({ box, label }) => row(el("label", { for: box.id }, label), box)),
    hint("Leave a number empty to use the one every place starts from, in world/systems/_defaults.json: no reserve air, and nothing wearing out."),
    row(button("Keep", () => {
      P.name = name.value.trim() || P.name;
      if (draft.value.trim()) P.draft = draft.value.trim();
      else delete P.draft;
      for (const pick of [guards, engineers]) {
        if (pick.auto.checked) delete P[pick.key];
        else P[pick.key] = pick.boxes.filter(({ box }) => box.checked).map(({ one }) => one.key);
      }
      P.numbers = {};
      for (const { key, box } of numbers) if (box.value !== "") P.numbers[key] = Number(box.value);
      changed();
    }), button("Undo", () => inspect())),
    hint(`The file is world/systems/${state.id}.txt.`));
}

// The numbers a logistics file gives for water and reserve air, in the file's order, with what each box is called.
const WATER_NUMBERS = [
  ["drinks", "everyone aboard drinks, in measures of water a day"],
  ["tankFills", "a tank of water fills, in measures"],
  ["pumpsStopped", "with the pumps stopped, how many times as much water goes"],
  ["rationUnder", "water is rationed under, in measures"],
  ["tankAir", "a reserve tank gives, in hours of air"],
  ["airTakes", "a day of reserve air takes, in measures of water"],
  ["breachAir", "a breached room takes, in hours of reserve air"],
  ["breachSlow", "a breached room fills in, in hours with no reserve air"],
];
// And for the crew's comforts (step 12).
const COMFORT_NUMBERS = [
  ["steadies", "each comfort steadies morale, in points when things go wrong"],
  ["sours", "going without one sours it, in points"],
  ["tableLifts", "a good table lifts morale, in points after a hard day"],
];
// The ship's logistics: the numbers at the top.
function inspectLogisticsAbout(inspector) {
  const P = state.item;
  const name = textBox("edit-title", P.name ?? "");
  const draft = textBox("edit-draft", P.draft ?? "");
  const eats = numberBox("edit-eats", P.numbers?.eats ?? "");
  const feeds = numberBox("edit-feeds", P.numbers?.crateFeeds ?? "");
  // Water and reserve air (step 11): each a number, and a line that's left empty isn't written.
  const water = WATER_NUMBERS.map(([key, words]) => ({ key, words, box: numberBox(`edit-water-${key}`, P.numbers?.[key] ?? "") }));
  // The crew's comforts (step 12): what they use in a day and from which store, and three numbers.
  const uses = textBox("edit-uses", P.uses ? writeCrewUses(P.uses) : "");
  const comforts = COMFORT_NUMBERS.map(([key, words]) => ({ key, words, box: numberBox(`edit-comfort-${key}`, P.numbers?.[key] ?? "") }));
  const sittings = textBox("edit-sittings", P.sittings ? writeSittings(P.sittings) : "");
  const repair = textBox("edit-repair", P.repair ? writeRepair(P.repair) : "");
  const making = textBox("edit-making", P.making ? writeMaking(P.making) : "");
  const carriers = textBox("edit-carriers", P.carriers?.list?.join(", ") ?? "");
  const trip = textBox("edit-trip", P.trip ? writeTrip(P.trip) : "");
  const first = textBox("edit-first", P.first ? writeDecider(P.first) : "");
  const levels = textBox("edit-levels", P.levels ? writeDecider(P.levels) : "");
  const waits = textBox("edit-waiting", P.waiting ? writeWaiting(P.waiting) : "");
  const askers = textBox("edit-askers", P.askers ? writeAskers(P.askers) : "");
  const trouble = el("div", { class: "hint tone-bad" });
  fill(inspector, h2("The numbers at the top"),
    el("label", { for: "edit-title" }, "The place's name"), name,
    el("label", { for: "edit-draft" }, "Who wrote it (the game doesn't read this)"), draft,
    row(el("label", { for: "edit-eats" }, "everyone aboard eats, in sittings a day"), eats),
    row(el("label", { for: "edit-feeds" }, "a crate feeds, in sittings"), feeds),
    el("label", { for: "edit-sittings" }, "sittings at: the times the whole ship eats, and how long each lasts (empty for four of 90 minutes, at 06:00, 07:30, 18:00 and 19:30)"), sittings,
    el("label", { for: "edit-repair" }, "a repair takes: what the engineers use up each time they fix something, the stores they fetch it from, and the kinds of damage that need it (empty for nothing)"), repair,
    el("label", { for: "edit-making" }, "salvage makes: what the bench makes from how much salvage, the room it's made in, how long it takes, and the store it goes into (empty for nothing)"), making,
    el("label", { for: "edit-carriers" }, "carried by: who carries for a store whose own line doesn't say, first to last (jobs, posts, the spare hands)"), carriers,
    el("label", { for: "edit-trip" }, "a trip carries: how many of each thing one person carries at a time (anything not named goes one at a time)"), trip,
    el("label", { for: "edit-first" }, "what comes first: the post that decides which part of the ship the work board sees to first, and how often they look (empty for nobody: jobs go as they come)"), first,
    el("label", { for: "edit-levels" }, "what stores want: the post that raises what a store wants after it has run low, and how often they look (empty for nobody: stores want what their lines say)"), levels,
    el("label", { for: "edit-waiting" }, "left waiting: how long a job stands with nobody able to do it, or nothing aboard to do it with, before it's brought to the player, for urgent work and for the rest (empty, with the next line empty too, for never)"), waits,
    el("label", { for: "edit-askers" }, "who asks: the post that brings such a job to the player, for each part of the ship: the medbay, the engines, the galley, repairs, and the rest"), askers,
    el("h3", {}, "Water and reserve air"),
    hint("For a place with a store that holds measures of water (its water tank) and one that holds the reserve air. Leave a box empty and its line isn't written."),
    ...water.map((one) => row(el("label", { for: `edit-water-${one.key}` }, one.words), one.box)),
    el("h3", {}, "The crew's comforts"),
    hint("Drink, tea and tobacco, and clothes, which the crew uses up a little every day out of one of the stores. An item's own file says what one of it is worth, with a line such as comfort: 80 drink. Leave the first box empty and the crew uses none."),
    el("label", { for: "edit-uses" }, "the crew uses: how much of each comfort the whole crew uses in a day, and the store they're kept in"), uses,
    ...comforts.map((one) => row(el("label", { for: `edit-comfort-${one.key}` }, one.words), one.box)),
    trouble,
    row(button("Keep", () => {
      const read = sittings.value.trim() ? readSittings(sittings.value) : null;
      if (read?.problem) {
        trouble.textContent = read.problem;
        return;
      }
      const fix = repair.value.trim() ? readRepair(repair.value) : null;
      if (fix?.problem) {
        trouble.textContent = fix.problem;
        return;
      }
      const made = making.value.trim() ? readMaking(making.value) : null;
      if (made?.problem) {
        trouble.textContent = made.problem;
        return;
      }
      const load = trip.value.trim() ? readTrip(trip.value) : null;
      if (load?.problem) {
        trouble.textContent = load.problem;
        return;
      }
      const who = readCarriers(carriers.value);
      const leads = first.value.trim() ? readDecider(first.value) : null;
      const sets = levels.value.trim() ? readDecider(levels.value) : null;
      if (leads?.problem || sets?.problem) {
        trouble.textContent = leads?.problem ?? sets.problem;
        return;
      }
      const left = waits.value.trim() ? readWaiting(waits.value) : null;
      const bring = askers.value.trim() ? readAskers(askers.value) : null;
      if (left?.problem || bring?.problem) {
        trouble.textContent = left?.problem ?? bring.problem;
        return;
      }
      const used = uses.value.trim() ? readCrewUses(uses.value) : null;
      if (used?.problem) {
        trouble.textContent = used.problem;
        return;
      }
      if (Boolean(left) !== Boolean(bring)) {
        trouble.textContent = "left waiting and who asks go together: one says after how long a job is brought to the player, the other who brings it. Fill in both, or neither.";
        return;
      }
      P.name = name.value.trim() || P.name;
      if (draft.value.trim()) P.draft = draft.value.trim();
      else delete P.draft;
      P.numbers = {};
      if (eats.value !== "") P.numbers.eats = Number(eats.value);
      if (feeds.value !== "") P.numbers.crateFeeds = Number(feeds.value);
      for (const one of [...water, ...comforts]) if (one.box.value !== "") P.numbers[one.key] = Number(one.box.value);
      if (used) P.uses = used;
      else delete P.uses;
      if (read) P.sittings = read;
      else delete P.sittings;
      if (fix) P.repair = fix;
      else delete P.repair;
      if (made?.n) P.making = made;
      else delete P.making;
      if (who.length) P.carriers = { list: who };
      else delete P.carriers;
      if (load) P.trip = load;
      else delete P.trip;
      if (leads) P.first = leads;
      else delete P.first;
      if (sets) P.levels = sets;
      else delete P.levels;
      if (left) P.waiting = left;
      else delete P.waiting;
      if (bring) P.askers = bring;
      else delete P.askers;
      changed();
    }), button("Undo", () => inspect())),
    hint(`The file is world/logistics/${state.id}.txt. Every part of it is played: the stores and what they want, the machines, the sittings, the loads, the refills, the repairs, what salvage makes and the order of urgency. The how-to there says how each is written.`));
}
// A store: its line, with the room, what it holds, what it wants and who carries for it picked from lists to write it.
function inspectStoreLine(inspector, node) {
  const P = state.item, lists = state.lists;
  const entry = P.stores[node.bind.store];
  if (!entry) return inspectNothing(inspector);
  const box = textBox("edit-line", entry.text ?? entry);
  const read = readStoreLine(box.value);
  const room = picker("edit-room", (lists.rooms ?? []).map((one) => [one, one]), read.problem ? (lists.rooms ?? [])[0] : (lists.rooms ?? []).find((one) => one.toLowerCase() === read.room.toLowerCase()) ?? (lists.rooms ?? [])[0]);
  // The picker starts on what the store already holds, so adding more of the same is one click.
  const firstHeld = read.problem || !read.holds.length ? "" : read.holds[0].what.toLowerCase().replace(/s$/, "");
  const held = (lists.items ?? []).find((one) => one.name.toLowerCase().replace(/s$/, "") === firstHeld || one.id === firstHeld.replace(/ /g, "_"));
  const item = picker("edit-item", [...(lists.items ?? []).map((one) => [one.name, one.name]), ["sittings", "sittings (a count, not things)"], ["measures of water", "measures of water (a count: the water tank)"]], held?.name ?? (firstHeld === "sitting" ? "sittings" : firstHeld === "measures of water" ? "measures of water" : (lists.items ?? [])[0]?.name ?? "sittings"));
  const count = numberBox("edit-count", 6);
  // What it wants, and when that's urgent: a number for one of the things it holds, or for all of them.
  const heldNow = () => { const now = readStoreLine(box.value); return now.problem ? [] : now.holds.map((h) => h.what); };
  const things = () => [["", "everything it holds"], ...heldNow().map((what) => [what, what])];
  const wantOf = picker("edit-want-of", things(), "");
  const wantN = numberBox("edit-want-n", read.problem ? 2 : read.wants[0]?.n ?? 2);
  const urgentOf = picker("edit-urgent-of", things(), "");
  const urgentN = numberBox("edit-urgent-n", read.problem ? 1 : read.urgent[0]?.n ?? 1);
  const carrier = picker("edit-carrier", (lists.carriers ?? []).map((one) => [one, one]), (lists.carriers ?? [])[0] ?? "");
  // One mark set in a list of them: for one thing, or for everything (which takes the place of the rest); none at 0.
  const marked = (list, what, n) => {
    const rest = what ? list.filter((one) => one.what && !sameThing(one.what, what)) : [];
    const spelt = what ? list.filter((one) => !one.what).flatMap((one) => heldNow().filter((each) => !sameThing(each, what)).map((each) => ({ n: one.n, what: each }))) : [];
    return n > 0 ? [...spelt, ...rest, { n, what: what || null }] : [...spelt, ...rest];
  };
  const rewrite = (change) => {
    const now = readStoreLine(box.value);
    if (now.problem) return;
    change(now);
    box.value = writeStoreLine(now);
  };
  fill(inspector, h2(node.label), el("label", { for: "edit-line" }, "The store, in, its room, a colon, holds and what it holds; then wants, urgent under and carried by, each after a semicolon; and after another colon how it looks"), box,
    row(el("span", {}, "in"), room, button("Put it there", () => rewrite((now) => { now.room = room.value; }))),
    row(count, item, button("+ add to what it holds", () => {
      const n = Math.max(1, Number(count.value) || 1);
      const words = item.value === "sittings" ? "sittings" : item.value.toLowerCase();
      if (readStoreLine(box.value).problem) box.value = `new store in ${room.value}: holds ${n} ${words}`;
      else rewrite((now) => { now.freight = false; now.reserve = false; now.holds.push({ n, what: words }); });
    })),
    hint("Items are named the way their files name them, plural or not; the plural with an s is written in the file. The store starts full, with this much, and never holds more. A store that holds measures of water is the place's water tank, and one written holds the reserve air is its reserve tanks, with as much as its systems file gives."),
    row(el("span", {}, "wants"), wantN, el("span", {}, "of"), wantOf, button("Set what it wants", () => rewrite((now) => { now.wants = marked(now.wants, wantOf.value, Number(wantN.value) || 0); }))),
    row(el("span", {}, "urgent under"), urgentN, el("span", {}, "of"), urgentOf, button("Set when it's urgent", () => rewrite((now) => { now.urgent = marked(now.urgent, urgentOf.value, Number(urgentN.value) || 0); }))),
    row(el("span", {}, "carried by"), carrier, button("+ add a carrier", () => rewrite((now) => { if (carrier.value && !now.carriers.includes(carrier.value)) now.carriers.push(carrier.value); })), button("Start the carriers again", () => rewrite((now) => { now.carriers = []; }))),
    hint("A job of carrying comes up whenever the store has fewer of a thing than it wants, and is fetched from the nearest store that can spare it. Under the urgent mark the job comes before the others, and wakes someone if nobody's up. Carriers are asked in the order written, and a store that names none uses the carried by line at the top. Set a number to 0 to take it away."),
    row(button("Keep", () => { P.stores[node.bind.store] = { text: box.value.trim() }; changed(); }), button("Undo", () => inspect())),
    row(button("+ another store", addStore), button("Remove", () => remove(node), { class: "danger" })));
}
// A line of the other parts, kept as words until its step is built.
function inspectLogisticsLine(inspector, node) {
  const P = state.item;
  const [part, i] = node.bind.logLine;
  const entry = P[part]?.[i];
  if (!entry) return inspectNothing(inspector);
  const box = textarea("edit-line", entry.text ?? entry, 3);
  fill(inspector, h2(node.label), el("label", { for: "edit-line" }, `The line, under ${PART_TITLES[part]}`), box,
    part === "machines"
      ? hint("A machine: its name, in and its room if the room isn't named like it, a colon, then what it does. It takes so many of an item (or one of two, with or between them) from a store, and puts so many of an item or of sittings into a store, every so long, with power and someone there if it needs them, and so much water for each go: galley: cooks 1 produce or 1 ration crate from the pantry into 200 sittings in the soup kettle every hour, with power, a cook there and 1 water. One that only gives power is the generator. One that only takes water from the water tank uses it up as it runs, and in the room of the place's air plant it is the air plant: with no water it makes no air.")
      : part === "loads"
          ? hint("The loads: each system and what it draws from the generator, with a room or each to count them, and while under way for what only draws on a jump: air plant 20, engines 30 while under way, lights 1 a room, computers 2 each. Another line says the order they're let go in when the generator hasn't enough: when short, drop: cameras, comms, lights, doors, navigation, air.")
          : hint("A refill: the store, a colon, what comes into it, where from, how often, and how far it's filled: the shuttle stores: ration crates and fuel cells from the dock, every 6 hours, up to full. From the dock, it's bought at whatever port the ship is docked at, out of the port's own stores and the ship's purse, and in open space nothing comes. From nothing, it comes from nowhere. Each refill is written in the manifest. The water tank is filled the same way, by the tank: the water tank: water from the dock, every 6 hours, up to full."),
    row(button("Keep", () => { P[part][i] = { text: box.value.trim().replace(/\n+/g, " ") }; changed(); }), button("Undo", () => inspect())),
    row(button(`+ another under ${PART_TITLES[part]}`, () => addLogisticsLine(part)), button("Remove", () => remove(node), { class: "danger" })));
}
// The order of urgency: every kind of work the board gives out, the most urgent first, each with buttons to move it.
function inspectUrgency(inspector, order = null) {
  const P = state.item;
  const kinds = order ?? urgencyOrder(P).kinds;
  const move = (i, by) => {
    const next = [...kinds];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    inspectUrgency(inspector, next);
  };
  inspector.replaceChildren();
  fill(inspector, h2("The order of urgency"),
    hint("Every kind of work the crew is sent to, the most urgent first. Someone who's free takes the most urgent job they can do. Someone already at work leaves it only for a job two lines higher or more, so a line's place matters twice: for what's taken up first, and for what's dropped for what."),
    ...kinds.map((kind, i) => row(el("span", { class: "board-order" }, `${i + 1}. ${workKindWords(kind)}`),
      i > 0 ? button("Up", () => move(i, -1), { title: `Move ${workKindWords(kind)} up a line` }) : null,
      i < kinds.length - 1 ? button("Down", () => move(i, 1), { title: `Move ${workKindWords(kind)} down a line` }) : null)),
    row(button("Keep", () => { P.urgency = kinds.map((kind) => ({ text: workKindWords(kind) })); changed(); }), button("Undo", () => inspect())),
    hint("Urgent carrying is for a store under its urgent mark, or one a machine, the medbay or a repair is waiting on. A repair the ship can't do without is one to what carries her power, or to the air plant. The kinds that wake someone when nobody's up are the first seven as the game first has them: someone bleeding or down, a fire, a breach, the alarm, urgent carrying and a repair the ship can't do without."));
}
// ---- The ports and the goods (step 7 of the logistics rework) ------------------------------------------------------
const PORT_KINDS = { holds: "beat", ground: "lead", makes: "route", uses: "clock", stores: "fact" };
const PORT_LABELS = { holds: "What it holds", ground: "Out of the ground", makes: "What it makes", uses: "What it uses", stores: "A store in its rooms" };
const PORT_READERS = { holds: readHoldLine, ground: readGroundLine, makes: readMakeLine, uses: readUseLine, stores: readPortStoreLine };
// A port: a box for each line of its file, the ports it sends to on the left and the ports that send to it on the right.
function portGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  const carried = P.carriers?.list?.length ? ` Carried by ${P.carriers.list.join(", ")}${P.dock?.room ? `, by way of ${P.dock.room}` : ""}.` : "";
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `${P.people ? `${numberWords(P.people)} people. ` : ""}${(P.holds ?? []).length} goods held, ${(P.ground ?? []).length} out of the ground here, ${(P.makes ?? []).length} made here, ${(P.stores ?? []).length} ${(P.stores ?? []).length === 1 ? "store" : "stores"} in its rooms.${carried}${P.draft ? ` Written by ${P.draft}.` : ""}`, label: "The port" });
  const sameGood = (a, b) => plainWords(a).replace(/s$/, "") === plainWords(b).replace(/s$/, "");
  const holds = (P.holds ?? []).map((one, i) => {
    const read = readHoldLine(one.text ?? one);
    const through = read.problem ? null : L.through?.[Object.keys(L.through ?? {}).find((name) => sameGood(name, read.good))];
    return { read, id: add({ id: `holds${i}`, kind: "beat", col: 2, name: read.problem ? "A good it holds" : read.good, text: read.problem ?? `Usually ${numberWords(read.usual)}.${read.from.length ? ` From ${read.from.join(" or ")}.` : " Its own."}${through ? ` About ${numberWords(through)} go through in a day.` : ""}`, label: PORT_LABELS.holds, bind: { portLine: ["holds", i] }, problem: Boolean(read.problem) }) };
  });
  // What comes out of the ground here, above the makers that work it up.
  (P.ground ?? []).forEach((one, i) => {
    const read = readGroundLine(one.text ?? one);
    const id = add({ id: `ground${i}`, kind: "lead", col: 1, name: read.problem ? "Ground" : read.name, text: read.problem ?? `Up to ${numberWords(read.n)} ${read.good} a day, to the hands there are.`, label: PORT_LABELS.ground, bind: { portLine: ["ground", i] }, problem: Boolean(read.problem) });
    const into = read.problem ? null : holds.find((hold) => !hold.read.problem && sameGood(hold.read.good, read.good));
    if (into) ws.push({ from: id, to: into.id });
  });
  (P.makes ?? []).forEach((one, i) => {
    const read = readMakeLine(one.text ?? one);
    const id = add({ id: `makes${i}`, kind: "route", col: 1, name: read.problem ? "A maker" : read.name, text: read.problem ?? `${numberWords(read.n)} ${read.good} a day${read.from.length ? `, from ${read.from.map((entry) => `${numberWords(entry.n)} ${entry.good}`).join(" and ")}` : ""}.`, label: PORT_LABELS.makes, bind: { portLine: ["makes", i] }, problem: Boolean(read.problem) });
    const into = read.problem ? null : holds.find((hold) => !hold.read.problem && sameGood(hold.read.good, read.good));
    if (into) ws.push({ from: id, to: into.id });
    // And what it makes them from comes to it from what the port holds.
    for (const entry of read.problem ? [] : read.from) {
      const out = holds.find((hold) => !hold.read.problem && sameGood(hold.read.good, entry.good));
      if (out) ws.push({ from: out.id, to: id });
    }
  });
  (P.uses ?? []).forEach((one, i) => {
    const read = readUseLine(one.text ?? one);
    add({ id: `uses${i}`, kind: "clock", col: 3, name: read.problem ? "Who uses it" : read.who, text: read.problem ?? `${read.list.map((entry) => `${numberWords(entry.n)} ${entry.good}`).join(", ")} a day.`, label: PORT_LABELS.uses, bind: { portLine: ["uses", i] }, problem: Boolean(read.problem) });
  });
  // Its stores, where its goods stand in its rooms, each fed from the goods it keeps.
  (P.stores ?? []).forEach((one, i) => {
    const read = readPortStoreLine(one.text ?? one);
    const id = add({ id: `stores${i}`, kind: "fact", col: 3, name: read.problem ? "A store" : read.name, text: read.problem ?? `In ${read.room}. Usually ${read.list.map((entry) => `${numberWords(entry.n)} ${entry.good}`).join(", ")}: its share of what the port has.`, label: PORT_LABELS.stores, bind: { portLine: ["stores", i] }, problem: Boolean(read.problem) });
    for (const entry of read.problem ? [] : read.list) {
      const out = holds.find((hold) => !hold.read.problem && sameGood(hold.read.good, entry.good));
      if (out) ws.push({ from: out.id, to: id });
    }
  });
  // Where it sends for things, and who sends to it for them.
  for (const other of L.from ?? []) {
    const id = add({ ...linkNode(`link_port_${other.id}`, "port", other.name, `Sends it ${other.goods.join(", ")}: ${other.days} days away.`, "It sends to"), col: 0 });
    for (const hold of holds) if (!hold.read.problem && other.goods.some((good) => sameGood(good, hold.read.good))) ws.push({ from: id, to: hold.id });
  }
  for (const other of L.to ?? []) add({ ...linkNode(`link_port_${other.id}`, "port", other.name, `Sends here for ${other.goods.join(", ")}: ${other.days} days away.`, "Sends to it"), id: `link_port_${other.id}`, col: 4 });
  return { list: list.filter((node, i) => list.findIndex((one) => one.id === node.id) === i), ws };
}
function inspectPortAbout(inspector) {
  const P = state.item;
  const name = textBox("edit-title", P.name ?? "");
  const draft = textBox("edit-draft", P.draft ?? "");
  const people = textBox("edit-people", P.people ? numberWords(P.people) : "");
  // For its stores in its rooms: who carries, and the room where goods come and go.
  const carriers = textBox("edit-carriers", writeCarriedBy(P.carriers?.list ?? []));
  const dock = textBox("edit-dock", P.dock?.room ?? "");
  const addName = (words) => { carriers.value = carriers.value.trim() ? `${carriers.value.trim().replace(/,$/, "")}, ${words}` : words; };
  const trouble = el("div", { class: "hint tone-bad" });
  fill(inspector, h2("The port"),
    el("label", { for: "edit-title" }, "The port's name"), name,
    el("label", { for: "edit-draft" }, "Who wrote it (the game doesn't read this)"), draft,
    el("label", { for: "edit-people" }, "people: how many live there (for whoever writes the lines: the game plays what the lines say)"), people,
    el("label", { for: "edit-carriers" }, "carried by: who carries for its stores, with commas between"), carriers,
    (state.lists.locals ?? []).length ? el("div", { class: "subfacts" }, el("label", {}, "Someone with a day here"), row(...state.lists.locals.map((who) => button(who, () => addName(who))))) : null,
    el("label", { for: "edit-dock" }, "goods come and go by: the room they come into the port by (left empty, the room people arrive in)"), dock,
    (state.lists.rooms ?? []).length ? el("div", { class: "subfacts" }, el("label", {}, "A room here"), row(...state.lists.rooms.map((room) => button(room, () => { dock.value = room; })))) : null,
    trouble,
    row(button("Keep", () => {
      const n = people.value.trim() ? Number(people.value.replaceAll(",", "")) : null;
      if (people.value.trim() && !(n > 0)) {
        trouble.textContent = "people is a number, such as 6,000";
        return;
      }
      P.name = name.value.trim() || P.name;
      if (draft.value.trim()) P.draft = draft.value.trim();
      else delete P.draft;
      if (n) P.people = n;
      else delete P.people;
      const list = readCarriedBy(carriers.value);
      if (list.length) P.carriers = { list };
      else delete P.carriers;
      if (dock.value.trim()) P.dock = { room: dock.value.trim() };
      else delete P.dock;
      changed();
    }), button("Undo", () => inspect())),
    hint(`The file is world/ports/${state.id}.txt. Each midnight the port makes what its Makes lines say, never past what it usually holds and no more than it has the goods, the hands and the power for, uses what its Uses lines say, and sends for what it's running short of to the ports its Holds lines name. What's sent takes days to arrive, by the distance on the star map. The how-to in that folder says how each line is written.`));
}
function inspectPortLine(inspector, node) {
  const P = state.item;
  const [part, i] = node.bind.portLine;
  const entry = P[part]?.[i];
  if (!entry) return inspectNothing(inspector);
  const box = textarea("edit-line", entry.text ?? entry, 3);
  const trouble = el("div", { class: "hint tone-bad" });
  const goods = state.lists.goods ?? [];
  // A good or a port put into the line with a click, so that nobody has to type a name.
  const put = (words) => { box.value = `${box.value.trim()}${/[:,]$/.test(box.value.trim()) || !box.value.trim() ? " " : part === "holds" && /from\s+\S/.test(box.value) ? " or " : part === "holds" ? ", from " : ", "}${words}`; box.focus(); };
  fill(inspector, h2(node.label), el("label", { for: "edit-line" }, `The line, under ${PORT_TITLES[part]}`), box,
    part === "holds"
      ? hint("What it holds: the good, a colon, usually and how many it has when things are as usual, then from and the ports it sends to for more: ration crates: usually 1,500, from Tessen Colony or Maris Deep. Leave the from out for a good it makes itself.")
      : part === "ground"
        ? hint("What comes out of the ground here: where, a colon, how many of what at the most, and a day: the Long Fields: 660 grain a day. Only a basic good comes out of the ground, and the port has to hold it. The ground gives to whatever hands there are, with or without power, and stops when the port has as many as it usually holds. Nothing else in the game is made from nothing.")
      : part === "makes"
        ? hint("What it makes: who makes it, a colon, how many of what, and a day, then from and what goes into that many, with commas between: the kitchens: 72 ration packs a day, from 36 meal. The port has to hold the good, and everything it's made from. Its makers stop when it has as many as it usually holds, make less when there isn't enough of what they make it from, and take that much less. Change how many it makes and change what goes into it too, or one of them will take more or less than before.")
        : part === "stores"
          ? hint("One of its stores in its rooms: its name, in and the room, a colon, usually and how many of each good are in it when the port has what it usually holds, with commas between, then a colon and a few words about it: the granary in The Manifest Docks: usually 20 ration crates, 8 meal: A cage of crates and sacks. What's in it is its share of what the port has that day, for whoever's standing in the port. It holds thirty squares, the port has to hold each good, and whole numbers only.")
          : hint("What it uses: who uses it, a colon, how many of each thing with commas between, and a day: its people: 60 ration crates, 30 drinking water a day. The port has to hold each of them."),
    part === "holds" ? el("div", { class: "subfacts" }, el("label", {}, "A port it comes from"), row(...(state.lists.ports ?? []).map((name) => button(name, () => put(name))))) : null,
    part !== "holds" ? el("div", { class: "subfacts" }, el("label", {}, part === "ground" ? "A basic good" : part === "stores" ? "A good it holds, that can be carried" : "A good"), row(...(part === "ground" ? state.lists.basics ?? goods : part === "stores" ? state.lists.carried ?? goods : goods).map((name) => button(name, () => {
      // In a store's line a good joins what it usually has, six of it to begin with; anywhere else it's added at the end.
      const read = part === "stores" ? readPortStoreLine(box.value.trim()) : null;
      box.value = read && !read.problem ? writePortStoreLine({ ...read, list: [...read.list, { n: 6, good: name }] }) : `${box.value.trim()} ${name}`;
      box.focus();
    })))) : null,
    part === "stores" && (state.lists.rooms ?? []).length ? el("div", { class: "subfacts" }, el("label", {}, "A room here"), row(...state.lists.rooms.map((room) => button(room, () => {
      // The room goes where the line has one: after the store's name and its in.
      const read = readPortStoreLine(box.value.trim());
      box.value = read.problem ? `${box.value.trim()} in ${room}` : writePortStoreLine({ ...read, room });
      box.focus();
    })))) : null,
    trouble,
    row(button("Keep", () => {
      const words = box.value.trim().replace(/\n+/g, " ");
      const read = PORT_READERS[part](words);
      if (read.problem) {
        trouble.textContent = read.problem;
        return;
      }
      P[part][i] = { text: words };
      changed();
    }), button("Undo", () => inspect())),
    row(button(`+ another under ${PORT_TITLES[part]}`, () => addPortLine(part)), button("Remove", () => remove(node), { class: "danger" })));
}
function addPortLine(part) {
  const good = (state.lists.goods ?? ["ration crates"])[0];
  const basic = (state.lists.basics ?? ["grain"])[0];
  const made = (state.lists.made ?? [good])[0];
  const room = (state.lists.rooms ?? ["a room"])[0];
  const carriedGood = (state.lists.carried ?? [good])[0];
  (state.item[part] ??= []).push({ text: part === "holds" ? `${good}: usually 100` : part === "ground" ? `a new field: 1 ${basic} a day` : part === "makes" ? `a new maker: 1 ${made} a day, from 1 ${basic}` : part === "stores" ? `a new store in ${room}: usually 6 ${carriedGood}: What it looks like.` : `its people: 1 ${good} a day` });
  state.selected = { node: `${part}${state.item[part].length - 1}` };
  changed();
}

// A tree of goods: each good a box at its step of the tree, with who makes it.
const STEP_KINDS = { basic: "lead", refined: "route", developed: "beat", advanced: "ending" };
function goodsGraph() {
  const P = state.item, L = state.links;
  const list = [];
  const needs = NEEDS.filter((need) => P.needs?.[need]?.good).map((need) => (need === "hands" ? `A port short of ${P.needs[need].good} has fewer hands at its makers. ` : need === "sick" ? `A port short of ${P.needs[need].good} has more of its people laid up. ` : `Every maker runs on ${P.needs[need].good}, but this tree's own. `)).join("");
  list.push({ id: "about", kind: "about", col: 0, name: P.name, text: `${P.stands ? `Stands for ${writeStands(P.stands)}: that good's amount is the word a port has for its ${P.stands.supply}. ` : "No supply stands on this tree. "}${needs}${P.draft ? `Written by ${P.draft}.` : ""}`, label: "The tree" });
  const ws = [];
  const boxOf = {};
  // The steps that have goods stand side by side, the first of them next to the tree's own box.
  const present = STEPS.filter((step) => (P.steps?.[step] ?? []).length);
  STEPS.forEach((step) => {
    const col = present.indexOf(step);
    (P.steps?.[step] ?? []).forEach((one, i) => {
      const read = readGoodLine(one.text ?? one);
      const where = read.problem ? null : L.where?.[read.name];
      const makers = where?.makers?.length ? ` ${step === "basic" ? "Out of the ground at" : "Made at"} ${where.makers.map((maker) => `${maker.name.replace(/^The /, "the ")} (${numberWords(maker.n)} a day)`).join(", ")}.` : where ? (step === "basic" ? " No port has ground for it yet." : " Nobody makes it yet.") : "";
      const sums = where ? ` ${where.holders} ${where.holders === 1 ? "port holds" : "ports hold"} it; ${numberWords(where.used)} used a day${where.taken ? `, ${numberWords(where.taken)} go into other things` : ""} and ${numberWords(where.made)} made at the most.` : "";
      const from = read.problem || !read.from.length ? "" : ` Made from ${read.from.join(", ")}.`;
      list.push({ id: `${step}${i}`, kind: STEP_KINDS[step], col: col + 1, name: read.problem ? "A good" : read.name, text: read.problem ?? `${read.words || ""}${read.unit ? ` Counted by the ${read.unit}.` : ""}${read.item ? ` The game's own ${read.item}.` : ""}${from}${makers}${sums}`.trim(), label: `${STEP_TITLES[step]}`, bind: { goodLine: [step, i] }, problem: Boolean(read.problem) });
      if (!read.problem) boxOf[plainWords(read.name)] = { id: `${step}${i}`, from: read.from };
    });
  });
  // An arrow up the tree from each good to what's made from it. What comes from another tree is in the words only.
  for (const box of Object.values(boxOf)) for (const name of box.from) if (boxOf[plainWords(name)]) ws.push({ from: boxOf[plainWords(name)].id, to: box.id });
  return { list, ws };
}
function inspectGoodsAbout(inspector) {
  const P = state.item;
  const name = textBox("edit-title", P.name ?? "");
  const draft = textBox("edit-draft", P.draft ?? "");
  const stands = textBox("edit-stands", P.stands ? writeStands(P.stands) : "");
  const needs = Object.fromEntries(NEEDS.map((need) => [need, textBox(`edit-need-${need}`, P.needs?.[need]?.good ?? "")]));
  const NEED_HELP = {
    hands: "hands need: one of this tree's goods. A port that's short of it has fewer hands at its makers, down to three quarters of their work with none (empty for none)",
    sick: "the sick need: one of this tree's goods. A port that's scarce of it has more of its people laid up, and its makers do a little less (empty for none)",
    power: "power is: one of this tree's goods. Every port's makers run on it, but this tree's own: with it scarce they do less, down to four tenths with none (empty for none)",
  };
  const trouble = el("div", { class: "hint tone-bad" });
  fill(inspector, h2("The tree"),
    el("label", { for: "edit-title" }, "The tree's name"), name,
    el("label", { for: "edit-draft" }, "Who wrote it (the game doesn't read this)"), draft,
    el("label", { for: "edit-stands" }, "stands for: which of the supplies every port has a word for (food, fuel, medicine, parts) this tree stands behind, and by which of its goods, like food, by its ration crates (empty for none)"), stands,
    ...NEEDS.flatMap((need) => [el("label", { for: `edit-need-${need}` }, NEED_HELP[need]), needs[need]]),
    trouble,
    row(button("Keep", () => {
      const read = stands.value.trim() ? readStands(stands.value) : null;
      if (read?.problem) {
        trouble.textContent = read.problem;
        return;
      }
      P.name = name.value.trim() || P.name;
      if (draft.value.trim()) P.draft = draft.value.trim();
      else delete P.draft;
      if (read) P.stands = read;
      else delete P.stands;
      for (const need of NEEDS) {
        const good = needs[need].value.trim();
        if (good) (P.needs ??= {})[need] = { good };
        else if (P.needs) delete P.needs[need];
      }
      changed();
    }), button("Undo", () => inspect())),
    hint(`The file is world/goods/${state.id}.txt. A good that a supply stands on is what the star map and the Market count for that supply: how many of it a port has, against what it usually holds, is its plenty, normal, short or scarce.`));
}
function inspectGoodLine(inspector, node) {
  const P = state.item;
  const [step, i] = node.bind.goodLine;
  const entry = P.steps?.[step]?.[i];
  if (!entry) return inspectNothing(inspector);
  const box = textarea("edit-line", entry.text ?? entry, 3);
  const trouble = el("div", { class: "hint tone-bad" });
  fill(inspector, h2(node.label), el("label", { for: "edit-line" }, `The line, under ${STEP_TITLES[step]}`), box,
    hint("A good: its name as it's counted (ration crates), then how it's counted if its name isn't a count (drinking water, by the cask), then the game's own item in square brackets if it's one ([ration_crate]), then made from and the goods it's made from, with commas between (made from meal, kelp cake), then a colon and a few words about it. A port's file names a good by this name, and a maker can only make it from the goods named here."),
    el("div", { class: "subfacts" }, el("label", {}, "Made from: click a good to add it to the line"), row(...(state.lists.goods ?? []).map((name) => button(name, () => {
      const read = readGoodLine(box.value.trim().replace(/\n+/g, " "));
      if (read.problem || read.from.includes(name) || read.name === name) return;
      box.value = writeGoodLine({ ...read, from: [...read.from, name] });
    })))),
    trouble,
    row(button("Keep", () => {
      const words = box.value.trim().replace(/\n+/g, " ");
      const read = readGoodLine(words);
      if (read.problem) {
        trouble.textContent = read.problem;
        return;
      }
      P.steps[step][i] = { text: words };
      changed();
    }), button("Undo", () => inspect())),
    row(button(`+ another ${step} good`, () => addGoodLine(step)), button("Remove", () => remove(node), { class: "danger" })),
    hint("Taking a good out, or changing its name, leaves the ports' files naming something that isn't there: the checker says which, and they're changed on the Ports pages."));
}
function addGoodLine(step) {
  ((state.item.steps ??= {})[step] ??= []).push({ text: "a new good, by the crate: What it is, in a few words." });
  state.selected = { node: `${step}${state.item.steps[step].length - 1}` };
  changed();
}

function addStore() {
  const room = (state.lists.rooms ?? [])[0] ?? "a room";
  state.item.stores.push({ text: `new store in ${room}: holds 6 ration crates` });
  state.selected = { node: `store${state.item.stores.length - 1}` };
  changed();
}
// ---- Bodies and the medbay (health step 9) -------------------------------------------------------------
// The parts of a health file that are lists of lines: the wounds file's, or a place's. [part, heading, a box's label, reader]
const WOUNDS_PARTS = [["wounds", "Wounds", "A wound", readKindLine], ["weapons", "Weapons", "A weapon's hit", readWeaponLine], ["hits", "Hits", "What a hit leaves", readHitLine], ["accidents", "Accidents", "An accident at work", readAccidentLine], ["marks", "Old marks", "An old mark", readKindLine]];
const PLACE_HEALTH_PARTS = [["treatments", "Treatments", "A treatment", readTreatmentLine], ["mending", "Mending", "Mending", readMendingLine], ["start", "At the start", "Someone hurt at the start", readStartLine]];
const healthParts = () => (state.id === "wounds" ? WOUNDS_PARTS : PLACE_HEALTH_PARTS);
const writeHealthOf = () => (state.id === "wounds" ? writeWoundsText(state.item) : writeHealthText(state.item));
// How each line at the top is read, so the board can say what's wrong with it and how it's written.
function healthTopReader(key) {
  if (state.id === "wounds") {
    if (key === "old marks") return readOldMarks;
    if (key === "a wound from a hit") return (text) => readShare(text);
    if (key === "a hard wound") return (text) => readShare(text, true);
    return CARE[key] ? (text) => CARE[key].read(text) : null;
  }
  if (MEDBAY_KEYS[key]) return (text) => MEDBAY_KEYS[key].read(text);
  if (key === "the morning queue") return readQueue;
  if (key === "accidents at work") return readAccidents;
  return null;
}
// The lines at the top, with what each says now: [key, words].
function healthTops() {
  const P = state.item;
  if (state.id === "wounds") return [["old marks", P.oldMarks ?? ""], ["a wound from a hit", P.light ?? ""], ["a hard wound", P.hard ?? ""], ...Object.keys(CARE).map((key) => [key, P.care?.[key] ?? ""]), ["rough work", (P.rough ?? []).join(", ")]];
  return [...Object.entries(MEDBAY_KEYS).map(([key, one]) => [key, P[one.path] ?? ""]), ["the morning queue", P.queue ?? ""], ["accidents at work", P.accidents ?? ""]];
}
function setHealthTop(key, words) {
  const P = state.item;
  if (state.id === "wounds") {
    if (key === "old marks") P.oldMarks = words || undefined;
    else if (key === "a wound from a hit") P.light = words || undefined;
    else if (key === "a hard wound") P.hard = words || undefined;
    else if (key === "rough work") P.rough = words.split(/\s*,\s*/).filter(Boolean);
    else if (words) (P.care ??= {})[key] = words;
    else delete P.care?.[key];
    return;
  }
  const path = MEDBAY_KEYS[key]?.path ?? (key === "the morning queue" ? "queue" : "accidents");
  if (words) P[path] = words;
  else delete P[path];
}
function healthGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  add({ id: "about", kind: "about", col: 0, name: P.name ?? state.id, text: P.draft ? `Written by ${P.draft}.` : "", label: "The file" });
  healthTops().forEach(([key, words], i) => {
    const read = healthTopReader(key);
    const problem = words && read ? read(words).problem : null;
    add({ id: `top${i}`, kind: "lead", col: 0, name: key, text: problem ? `${words}\n${problem}` : words || "Not in the file: as the game has it.", label: "A line at the top", bind: { healthTop: key }, problem: Boolean(problem) });
  });
  const cols = state.id === "wounds" ? { wounds: 1, weapons: 2, hits: 2, accidents: 3, marks: 3 } : { treatments: 1, mending: 2, start: 3 };
  const kinds = { wounds: "beat", weapons: "fact", hits: "route", accidents: "clock", marks: "consequence", treatments: "beat", mending: "route", start: "fact" };
  const woundBoxes = {};
  for (const [part, , label, read] of healthParts()) {
    (P[part] ?? []).forEach((one, i) => {
      const words = one.text ?? one;
      const problem = read(words)?.problem;
      const name = words.split(/[:;]/)[0].trim().slice(0, 40);
      add({ id: `${part}${i}`, kind: kinds[part], col: cols[part], name, text: problem ? `${words}\n${problem}` : words, label, bind: { healthLine: [part, i] }, problem: Boolean(problem) });
      if (part === "wounds") (woundBoxes[plainWords(name.split(",")[0])] ??= []).push(`${part}${i}`);
    });
  }
  if (state.id === "wounds") {
    // From a hit or an accident to each wound it leaves, the longest names first so that a deep cut isn't a cut too;
    // and from a weapon's kind of hit to the hits of that kind.
    const names = Object.keys(woundBoxes).sort((a, b) => b.length - a.length);
    for (const part of ["hits", "accidents"]) (P[part] ?? []).forEach((one, i) => {
      const words = plainWords(one.text ?? one);
      let rest = ` ${part === "hits" ? words.slice(words.indexOf(":") + 1) : words.split(":")[0]} `;
      for (const name of names) {
        const at = new RegExp(`[^a-z]${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z]`);
        if (!at.test(rest)) continue;
        for (const to of woundBoxes[name]) ws.push({ from: `${part}${i}`, to });
        rest = rest.replace(new RegExp(at, "g"), " ");
      }
    });
    (P.weapons ?? []).forEach((one, i) => {
      const kind = plainWords((one.text ?? one).split(":")[0]);
      (P.hits ?? []).forEach((hit, k) => { if (plainWords((hit.text ?? hit).split(":")[0]).split(" ")[0] === kind) ws.push({ from: `weapons${i}`, to: `hits${k}` }); });
    });
    for (const one of L.species ?? []) add(linkNode(`link_species_${one.id}`, "species", one.name, "Its Body part says how often each part is hit, and what its people do differently.", "A species"));
  } else if (L.place) add(linkNode(`link_place_${L.place.id}`, "place", L.place.name, "The place itself.", "The place"));
  return { list, ws };
}
function inspectHealthAbout(inspector) {
  const P = state.item;
  const name = textBox("edit-title", P.name ?? "");
  const draft = textBox("edit-draft", P.draft ?? "");
  fill(inspector, h2("The file"),
    el("label", { for: "edit-title" }, "Its name, on the first line"), name,
    el("label", { for: "edit-draft" }, "Who wrote it (the game doesn't read this)"), draft,
    row(button("Keep", () => { P.name = name.value.trim() || P.name; P.draft = draft.value.trim() || null; changed(); }), button("Undo", () => inspect())));
}
function inspectHealthTop(inspector, node) {
  const key = node.bind.healthTop;
  const now = healthTops().find(([one]) => one === key)?.[1] ?? "";
  const read = healthTopReader(key);
  const like = read ? read("?").problem : null;
  const said = like ? (like.startsWith(key) ? like : `${key} ${like}`) : "rough work: the words in a job that make old marks come twice as often, with commas between them. A word counts when a job has a word starting with it, so engine counts for Engine Hand.";
  const box = textBox("edit-line", now);
  const trouble = el("div", { class: "hint tone-bad" });
  fill(inspector, h2(key), el("label", { for: "edit-line" }, `${key}:`), box,
    hint(`${said}${said.endsWith(".") ? "" : "."} ${state.id === "wounds" ? "Leave it empty for what the game has without it." : "Leave it empty to take the line out."}`),
    trouble,
    row(button("Keep", () => {
      const words = box.value.trim();
      const problem = words && read ? read(words).problem : null;
      if (problem) {
        trouble.textContent = problem.startsWith(key) ? problem : `${key} ${problem}`;
        return;
      }
      setHealthTop(key, words);
      changed();
    }), button("Undo", () => inspect())));
}
const HEALTH_LINE_HINTS = {
  wounds: "A wound: its name, a comma, where it can be (any part, the head, the chest, an arm, a leg, a limb, or right arm, left arm, right leg or left leg, joined with or), a colon, what it looks like ({part} is the part it's on), and its rules after semicolons, like serious; bleeds 4 an hour; can go bad; heals in 4 days, 2 once dressed. world/health/_how-to-write-health.txt has all the rules.",
  marks: "An old mark, written as a wound is: its name, a comma, where it can be, a colon, what it looks like, and its rules after semicolons, like likelier in: dock, engine, or never at random.",
  weapons: "A kind of hit, a colon, and the words in a weapon's name that make it: burn: laser, plasma, cutter. The kinds are yours to name; the line that says anything else is for every weapon the others don't name.",
  hits: "A kind of hit (or anything, and for and a species), a colon, the wound a light hit leaves; then hard: the wounds a hard hit leaves, each with on and where; and down: the wound the hit that puts them down leaves.",
  accidents: "A wound people get at their work, a colon, likelier in: and the words of the work it's likelier in.",
  treatments: "A wound the medbay treats, by its name in the wounds file, a colon, the doses and the time it takes someone with a Medicine of 5: deep cut: 2 doses, 30 minutes. A wound with no line isn't treated in the medbay.",
  mending: "A synthetic's wound, or an artificial arm or leg, a colon, the parts crates and the time it takes someone with an Engineering of 5: cracked casing: 1 parts crate, an hour.",
  start: "Someone at the place, a comma, and a body line: Vik, right leg: broken bone. A wound from the wounds file is one they start the game with, and a serious one starts them laid up; anything else is an old mark.",
};
function inspectHealthLine(inspector, node) {
  const P = state.item;
  const [part, i] = node.bind.healthLine;
  const entry = P[part]?.[i];
  if (!entry) return inspectNothing(inspector);
  const [, title, , read] = healthParts().find(([one]) => one === part);
  const box = textarea("edit-line", entry.text ?? entry, 3);
  const trouble = el("div", { class: "hint tone-bad" });
  fill(inspector, h2(node.label), el("label", { for: "edit-line" }, `The line, under ${title}`), box, hint(HEALTH_LINE_HINTS[part]), trouble,
    row(button("Keep", () => {
      const words = box.value.trim().replace(/\n+/g, " ");
      const problem = read(words)?.problem;
      if (problem) {
        trouble.textContent = problem;
        return;
      }
      P[part][i] = { ...(typeof entry === "object" ? entry : {}), text: words };
      changed();
    }), button("Undo", () => inspect())),
    row(button(`+ another under ${title}`, () => addHealthLine(part)), button("Remove", () => remove(node), { class: "danger" })));
}
function addHealthLine(part) {
  const fresh = { wounds: "graze, any part: a graze on the {part}; heals in 1 day", marks: "old graze, any part: an old graze on the {part}", weapons: "blunt: club", hits: "blunt: bruise", accidents: "bruise: likelier in: dock", treatments: "cut: 1 dose, 10 minutes", mending: "dent: 20 minutes", start: "Vik, chest: bruise" };
  (state.item[part] ??= []).push({ text: fresh[part] });
  state.selected = { node: `${part}${state.item[part].length - 1}` };
  changed();
}
// A species' Body part: how often a hit lands on each part, and what its people do differently.
function inspectSpeciesBody(inspector) {
  const P = state.item;
  const body = P.body ?? {};
  const hits = textBox("edit-hits", Object.entries(body.hits ?? {}).map(([part, n]) => `${part.replace(/_/g, " ")} ${n}`).join(", "));
  const breaks = numberBox("edit-breaks", body.breaks ?? "", 0.05);
  const heals = numberBox("edit-heals", body.heals ?? "", 0.05);
  const bleeds = picker("edit-bleeds", [["yes", "yes, as usual"], ["no", "no"]], body.bleeds === false ? "no" : "yes");
  const own = picker("edit-own", [["no", "no, the usual ones too"], ["yes", "yes"]], body.ownMarks ? "yes" : "no");
  const mended = picker("edit-mended", [["the nurses", "the nurses, with medicine, as usual"], ["the techs", "the techs, with parts crates"]], /tech/i.test(body.mendedBy ?? "") ? "the techs" : "the nurses");
  const trouble = el("div", { class: "hint tone-bad" });
  const partNames = PARTS.map((part) => part.replace(/_/g, " "));
  fill(inspector, h2("Their bodies"), hint("How often a hit lands on each part, out of the total, and what this species' people do differently. Leave a box empty for what's usual."),
    el("label", { for: "edit-hits" }, `hit: how often each part is hit, like head 10, chest 34, right arm 14, left arm 14, right leg 14, left leg 14 (empty for as most are)`), hits,
    row(el("label", { for: "edit-breaks" }, "bones break, as a share of the usual (0.5 is half as often)"), breaks),
    row(el("label", { for: "edit-heals" }, "wounds heal, as a share of the usual pace"), heals),
    row(el("label", { for: "edit-bleeds" }, "bleeds"), bleeds),
    row(el("label", { for: "edit-own" }, "own marks only (only the old marks that say only for them)"), own),
    row(el("label", { for: "edit-mended" }, "mended by"), mended),
    trouble,
    row(button("Keep", () => {
      const next = {};
      const words = hits.value.trim();
      if (words) {
        const found = {};
        for (const piece of words.split(/\s*,\s*/)) {
          const got = piece.toLowerCase().match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);
          const part = got ? got[1].trim().replace(/\s+/g, "_") : null;
          if (!part || !PARTS.includes(part)) {
            trouble.textContent = `"${piece}" isn't a part and a number: the parts are ${partNames.join(", ")}`;
            return;
          }
          found[part] = Number(got[2]);
        }
        next.hits = found;
      }
      if (breaks.value !== "") next.breaks = Number(breaks.value);
      if (heals.value !== "") next.heals = Number(heals.value);
      if (bleeds.value === "no") next.bleeds = false;
      if (own.value === "yes") next.ownMarks = true;
      if (mended.value === "the techs") next.mendedBy = /tech/i.test(body.mendedBy ?? "") ? body.mendedBy : "the techs";
      if (Object.keys(next).length) P.body = next;
      else delete P.body;
      changed();
    }), button("Undo", () => inspect())));
}
function addLogisticsLine(part) {
  (state.item[part] ??= []).push({ text: `new ${PART_TITLES[part].toLowerCase().replace(/s$/, "")}: what it does, in words` });
  state.selected = { node: `${part}${state.item[part].length - 1}` };
  changed();
}

// The chain of command: the numbers at the top, one box each, with what the line says in its label.
const COMMAND_NUMBER_WORDS = {
  "each point of skill": "each point of skill: how much quicker or slower each point of skill either side of 5 makes the work, like 8% quicker or slower",
  "reviews every": "reviews every: how often the officers review their people, like 7 days",
  "a bad stretch": "a bad stretch: when someone's warned, and then relieved at a review, like duty under 60 for 5 days",
  "the captain's choices stand": "the captain's choices stand: how long nobody reviews someone the captain chose or kept on, like 10 days",
  "memories fade": "memories fade: how fast people forget, like by half every 30 days",
  "everyone else": "everyone else: the numbers of whoever has none in their own file, like ambition 2, temper 2, loyalty 60",
  "mutiny brews": "mutiny brews: when, like morale under 30, loyalty under 35",
  "the mutiny builds": "the mutiny builds: like grumbling after 1 day, orders refused after 4, a delegation after 7, the mutiny after 10",
  "the council's confidence": "the council's confidence: when a game begins, like 60 to begin with",
  "the brig": "the brig: the room, and how long someone's kept there, like The Brig, for 7 days",
};
function inspectCommandAbout(inspector) {
  const P = state.item;
  const name = textBox("edit-title", P.name ?? "");
  const draft = textBox("edit-draft", P.draft ?? "");
  const fields = COMMAND_HEADER.filter((one) => one.path.startsWith("numbers.")).map((one, i) => ({ one, box: textBox(`edit-number-${i}`, P.numbers?.[one.path.slice("numbers.".length)] ?? "") }));
  fill(inspector, h2("The numbers at the top"),
    el("label", { for: "edit-title" }, "The place's name"), name,
    el("label", { for: "edit-draft" }, "Who wrote it (the game doesn't read this)"), draft,
    ...fields.flatMap(({ one, box }) => [el("label", { for: box.id }, COMMAND_NUMBER_WORDS[one.key] ?? one.key), box]),
    row(button("Keep", () => {
      P.name = name.value.trim() || P.name;
      if (draft.value.trim()) P.draft = draft.value.trim();
      else delete P.draft;
      P.numbers = {};
      for (const { one, box } of fields) if (box.value.trim()) P.numbers[one.path.slice("numbers.".length)] = box.value.trim();
      changed();
    }), button("Undo", () => inspect())),
    hint(`The file is world/command/${state.id}.txt. The how-to there says what each line does in the game.`));
}
// A post: its line, with its room, who chooses it, whether it keeps the watch bill or the brig, the jobs it heads, who
// it's picked from, its skills, what its duty's marked on, and who holds it when a game begins, picked from lists.
function inspectPostLine(inspector, node) {
  const P = state.item, lists = state.lists;
  const i = node.bind.post;
  const entry = P.posts[i];
  if (!entry) return inspectNothing(inspector);
  const box = textarea("edit-line", entry.text ?? entry, 3);
  const first = readPostLine(box.value);
  const titles = (P.posts ?? []).map((one) => readPostLine(one.text ?? one)).filter((one) => !one.problem && (first.problem || one.title !== first.title)).map((one) => one.title);
  const jobs = (P.jobs ?? []).map((one) => readJobLine(one.text ?? one)).filter((one) => !one.problem).map((one) => one.title);
  const rewrite = (change) => {
    const now = readPostLine(box.value);
    if (now.problem) return;
    change(now);
    box.value = writePostLine(now);
  };
  const addTo = (list, words) => { if (!list.includes(words)) list.push(words); };
  const rooms = lists.rooms ?? [];
  const room = picker("edit-room", rooms.map((one) => [one, one]), first.problem ? rooms[0] : rooms.find((one) => one.toLowerCase() === first.room.toLowerCase()) ?? rooms[0]);
  const choosers = [...titles.map((one) => [one, `the ${one}`]), ["council", "the council"], ["civilians", "the civilians"]];
  const chooser = picker("edit-chooser", choosers, first.problem ? choosers[0]?.[0] : first.chosenBy);
  const jobPick = picker("edit-job", jobs.map((one) => [one, pluralOf(one)]), jobs[0]);
  const pools = [...jobs.map((one) => [pluralOf(one), `${pluralOf(one)} (a job)`]), ...titles.map((one) => [`the ${one}`, `the ${one} (a post)`])];
  const poolPick = picker("edit-pool", pools, pools[0]?.[0]);
  const skillPick = picker("edit-skill", (lists.skills ?? []).map((id) => [id.replace(/_/g, " "), id.replace(/_/g, " ")]), (lists.skills ?? [])[0]?.replace(/_/g, " "));
  const dutyPick = picker("edit-duty", (lists.measures ?? []).map((one) => [one, one]), (lists.measures ?? [])[0]);
  const held = first.problem ? null : holderLines(P).find(({ read }) => slugOf(read.post) === slugOf(first.title));
  const holderPick = picker("edit-holder", [["the chair", "the chair: the player, or whoever the game gives it"], ...(lists.crew ?? []).map((one) => [one.key, one.name])], held?.read.holder ?? "the chair");
  fill(inspector, h2(node.label),
    el("label", { for: "edit-line" }, "The post, in or on its room, a colon, then what's said about it, each after a semicolon"), box,
    row(el("span", {}, "in"), room, button("Put it there", () => rewrite((now) => { now.room = room.value; }))),
    row(el("span", {}, "chosen by"), chooser, button("Chosen by them", () => rewrite((now) => { now.chosenBy = chooser.value; }))),
    row(button("Keeps the watch bill, or not", () => rewrite((now) => { now.watchBill = !now.watchBill; })), button("Keeps the brig, or not", () => rewrite((now) => { now.brig = !now.brig; }))),
    row(jobPick, button("+ heads them", () => rewrite((now) => addTo(now.heads, pluralOf(jobPick.value))))),
    row(poolPick, button("+ picked from them", () => rewrite((now) => addTo(now.pool, poolPick.value)))),
    row(skillPick, button("+ a skill", () => rewrite((now) => addTo(now.skills, skillPick.value)))),
    row(dutyPick, button("+ marked on it", () => rewrite((now) => addTo(now.duty, dutyPick.value)))),
    row(el("span", {}, "held by"), holderPick, button("Give it to them", () => {
      const now = readPostLine(box.value);
      if (now.problem) return;
      P.posts[i] = { text: box.value.trim().replace(/\n+/g, " ") };
      const line = { text: `${now.title}: ${holderPick.value}` };
      const at = holderLines(P).find(({ read }) => slugOf(read.post) === slugOf(now.title));
      if (at) P.holders[at.i] = line;
      else (P.holders ??= []).push(line);
      changed();
    })),
    hint("Who holds it when a game begins: someone with a day aboard, one post each, or the chair, for the captain. In a game, posts change hands at the reviews, and the Command menu shows who has each one."),
    row(button("Keep", () => { P.posts[i] = { text: box.value.trim().replace(/\n+/g, " ") }; changed(); }), button("Undo", () => inspect())),
    row(button("+ another post", addPost), button("Remove", () => remove(node), { class: "danger" })));
}
// A job: its line, with its room, how many it wants and its skills, and who does it when a game begins.
function inspectJobLine(inspector, node) {
  const P = state.item, lists = state.lists;
  const i = node.bind.job;
  const entry = P.jobs[i];
  if (!entry) return inspectNothing(inspector);
  const box = textBox("edit-line", entry.text ?? entry);
  const first = readJobLine(box.value);
  const rewrite = (change) => {
    const now = readJobLine(box.value);
    if (now.problem) return;
    change(now);
    box.value = writeJobLine(now);
  };
  const rooms = lists.rooms ?? [];
  const room = picker("edit-room", rooms.map((one) => [one, one]), first.problem ? rooms[0] : rooms.find((one) => one.toLowerCase() === first.room.toLowerCase()) ?? rooms[0]);
  const wanted = numberBox("edit-wanted", first.problem ? 2 : first.wanted);
  const skillPick = picker("edit-skill", (lists.skills ?? []).map((id) => [id.replace(/_/g, " "), id.replace(/_/g, " ")]), (lists.skills ?? [])[0]?.replace(/_/g, " "));
  const line = first.problem ? null : workersLines(P).find(({ read }) => slugOf(read.job) === slugOf(first.title));
  const workers = textBox("edit-workers", line ? (line.read.people.length ? line.read.people.join(", ") : "nobody") : "");
  const person = picker("edit-person", (lists.crew ?? []).map((one) => [one.key, one.name]), (lists.crew ?? [])[0]?.key);
  fill(inspector, h2(node.label),
    el("label", { for: "edit-line" }, "The job, in or on the room it's done in, a colon, how many it wants, and its skills after a semicolon"), box,
    row(el("span", {}, "in"), room, button("Put it there", () => rewrite((now) => { now.room = room.value; }))),
    row(wanted, el("span", {}, "wanted"), button("Set it", () => rewrite((now) => { now.wanted = Math.max(0, Number(wanted.value) || 0); }))),
    row(skillPick, button("+ a skill", () => rewrite((now) => { if (!now.skills.includes(skillPick.value)) now.skills.push(skillPick.value); }))),
    el("label", { for: "edit-workers" }, "Who does it when a game begins, by their names with commas between, or nobody"), workers,
    row(person, button("+ add them", () => {
      const names = workers.value.split(",").map((one) => one.trim()).filter((one) => one && !/^nobody$/i.test(one));
      if (!names.includes(person.value)) names.push(person.value);
      workers.value = names.join(", ");
    })),
    row(button("Keep", () => {
      P.jobs[i] = { text: box.value.trim() };
      const now = readJobLine(box.value);
      if (!now.problem && workers.value.trim()) {
        const said = { text: `${now.title}: ${workers.value.trim()}` };
        const at = workersLines(P).find(({ read }) => slugOf(read.job) === slugOf(now.title));
        if (at) P.workers[at.i] = said;
        else (P.workers ??= []).push(said);
      }
      changed();
    }), button("Undo", () => inspect())),
    row(button("+ another job", addJob), button("Remove", () => remove(node), { class: "danger" })));
}
// The spare hands: the people the first officer can put to work, by name.
function inspectSpareLine(inspector) {
  const P = state.item, lists = state.lists;
  const line = workersLines(P).find(({ read }) => slugOf(read.job) === slugOf(SPARE));
  const workers = textBox("edit-workers", line ? line.read.people.join(", ") : "");
  const person = picker("edit-person", (lists.crew ?? []).map((one) => [one.key, one.name]), (lists.crew ?? [])[0]?.key);
  fill(inspector, h2("Spare hands"),
    el("label", { for: "edit-workers" }, "The spare hands when a game begins, by their names with commas between: people the first officer can put to work where a job's short"), workers,
    row(person, button("+ add them", () => {
      const names = workers.value.split(",").map((one) => one.trim()).filter(Boolean);
      if (!names.includes(person.value)) names.push(person.value);
      workers.value = names.join(", ");
    })),
    row(button("Keep", () => {
      const names = workers.value.trim();
      if (line && names) P.workers[line.i] = { text: `${SPARE}: ${names}` };
      else if (line) P.workers.splice(line.i, 1);
      else if (names) (P.workers ??= []).push({ text: `${SPARE}: ${names}` });
      changed();
    }), button("Undo", () => inspect())));
}
function addPost() {
  const room = (state.lists.rooms ?? [])[0] ?? "The Bridge";
  (state.item.posts ??= []).push({ text: `new post in ${room}: chosen by the captain` });
  state.selected = { node: `post${state.item.posts.length - 1}` };
  changed();
}
function addJob() {
  const room = (state.lists.rooms ?? [])[0] ?? "The Bridge";
  (state.item.jobs ??= []).push({ text: `new job in ${room}: 1 wanted` });
  state.selected = { node: `job${state.item.jobs.length - 1}` };
  changed();
}

// A system: its name and its parts, one to a line, with a part and a room picked from lists to add one.
function inspectSystemLines(inspector, node) {
  const P = state.item, lists = state.lists;
  const system = P.systems[node.bind.system];
  if (!system) return inspectNothing(inspector);
  const name = textBox("edit-name", system.name);
  const area = textarea("edit-text", system.lines.map((one) => one.text ?? one).join("\n"), 8);
  const part = picker("edit-part", [...(lists.partKinds ?? []).map((one) => [one, one]), ["door", "door (under Doors)"]], system.id === "doors" ? "door" : (lists.partKinds ?? [])[0] ?? "machine");
  const room = picker("edit-room", [["every room", "every room"], ...(lists.rooms ?? []).map((one) => [one, one])], "every room");
  fill(inspector, h2(node.label), el("label", { for: "edit-name" }, "Its name: Power, Air, Lights, Doors, Cameras, Alarm, Comms, Engines, Navigation, Docking, or one of its own"), name,
    el("label", { for: "edit-text" }, "Its parts, one to a line: the part, in, and the room. For power, for and the rooms it feeds. After a colon, how it looks."), area,
    row(part, el("span", {}, "in"), room, button("+ add it", () => {
      const line = part.value === "door" ? `door to ${room.value === "every room" ? (lists.rooms ?? [])[1] ?? "a room" : room.value}` : `${part.value} in ${room.value}`;
      area.value = area.value.trim() ? `${area.value.trim()}\n${line}` : line;
    })),
    row(button("Keep", () => {
      system.name = name.value.trim() || system.name;
      system.id = systemIdOf(system.name);
      system.lines = area.value.split("\n").map((one) => one.trim().replace(/^-\s*/, "")).filter(Boolean).map((text) => ({ text }));
      changed();
    }), button("Undo", () => inspect())),
    row(button("+ another system", addSystem), button("Remove", () => remove(node), { class: "danger" })),
    hint("Keep changes the box and the file together. Save writes the file, and the parts are put in the rooms again."));
}

// A computer and what it runs: the line itself, and a computer, a system and a room picked from lists to write it.
function inspectComputerLine(inspector, node) {
  const P = state.item, lists = state.lists;
  const entry = P.computers[node.bind.computer];
  if (!entry) return inspectNothing(inspector);
  const box = textBox("edit-line", entry.text ?? entry);
  const who = picker("edit-computer", [...(lists.computers ?? []).map((one) => [one.id, one.name]), ...(lists.rooms ?? []).map((one) => [`a console in ${one}`, `a new console in ${one}`])], (lists.computers ?? [])[0]?.id ?? "");
  const runs = picker("edit-runs", [["everything", "everything"], ...P.systems.map((one) => [one.id, one.name])], "everything");
  const where = picker("edit-where", [["", "everywhere"], ...(lists.rooms ?? []).map((one) => [one, `only in ${one}`])], "");
  fill(inspector, h2(node.label), el("label", { for: "edit-line" }, "The computer, a colon, what it runs, and in and rooms if only there"), box,
    row(who, el("span", {}, "runs"), runs, where, button("Write it", () => { box.value = `${who.value}: ${runs.value}${where.value ? ` in ${where.value}` : ""}`; })),
    hint("A computer in world/computers by its id, a thing by its name and room, or a new console in a room, which can end with class easy, moderate, hard, very hard or nearly impossible."),
    row(button("Keep", () => { P.computers[node.bind.computer] = { text: box.value.trim() }; changed(); }), button("Undo", () => inspect())),
    row(button("+ another computer", addComputerLine), button("Remove", () => remove(node), { class: "danger" })));
}

function inspectDistrict(inspector, node) {
  const district = state.item.gm.districts[node.bind.district];
  const name = textBox("edit-name", district.name);
  const area = textarea("edit-text", district.desc, 6);
  fill(inspector, h2("A district"), el("label", { for: "edit-name" }, "Its name"), name, el("label", { for: "edit-text" }, "What it's like, and who's there"), area,
    row(button("Keep", () => { district.name = name.value.trim() || district.name; district.desc = area.value.trim(); changed(); }), button("Undo", () => inspect())),
    row(button("+ a district", addDistrict), button("Remove", () => remove(node), { class: "danger" })));
}
function inspectLink(inspector, node) {
  fill(inspector, h2(node.label), el("h3", {}, node.name), hint(node.text), row(button(`Open ${node.name}`, () => load(node.link.kind, node.link.id))), hint("It has a board of its own, and it's changed there."));
}

// Numbers are picked in boxes with arrows, never typed, and a new one is chosen from a list. "after" runs before
// the board is drawn again, for an editor that works on a copy.
function pairsEditor(holder, key, label, names, step = 1, after = null) {
  const box = el("div", { class: "subfacts" });
  const done = () => { after?.(); changed(); };
  const draw = () => {
    const pairs = holder[key] ?? {};
    box.replaceChildren(el("label", {}, label));
    for (const [name, amount] of Object.entries(pairs)) {
      const number = numberBox(`edit-${key}-${name}`, amount, step);
      box.append(row(el("span", { class: "fact-name" }, spaced(name)), number, button("Keep", () => { holder[key][name] = Number(number.value); done(); }, { class: "small" }), button("Remove", () => { delete holder[key][name]; if (!Object.keys(holder[key]).length && key !== "attributes") delete holder[key]; done(); }, { class: "danger small" })));
    }
    const left = names.filter((name) => !(name in pairs));
    if (left.length) {
      const pick = picker(`edit-${key}-new`, [["", "add one..."], ...left.map((name) => [name, spaced(name)])], "");
      box.append(row(pick, button("+ add it", () => { if (!pick.value) return; (holder[key] ??= {})[pick.value] = 0; done(); })));
    }
  };
  draw();
  return box;
}
// What a stage or a consequence changes at a place: how much there is of a good, or who holds it, picked by name.
function placeHitsEditor(holder) {
  const box = el("div", { class: "subfacts" });
  box.append(el("label", {}, "What changes at a place"));
  const goods = state.lists.goods ?? ["food", "fuel", "medicine", "parts"];
  const sides = (state.lists.factions ?? []).map((one) => one.id);
  (holder.places ?? []).forEach((hit, i) => {
    const place = picker(`edit-hit-${i}`, state.places.map((one) => [one.id, one.name]), hit.id);
    place.addEventListener("change", () => { hit.id = place.value; changed(); });
    const view = { all: { ...(hit.goods ?? {}), ...(hit.sides ?? {}) } };
    box.append(fill(el("div", { class: "hit" }),
      row(place, button("Remove", () => { holder.places.splice(i, 1); if (!holder.places.length) delete holder.places; changed(); }, { class: "danger small" })),
      pairsEditor(view, "all", "Goods there, or who holds it", [...goods, ...sides], 1, () => {
        delete hit.goods;
        delete hit.sides;
        for (const [name, amount] of Object.entries(view.all ?? {})) (goods.includes(name) ? (hit.goods ??= {}) : (hit.sides ??= {}))[name] = amount;
      })));
  });
  box.append(row(button("+ a place", () => { (holder.places ??= []).push({ id: state.places[0]?.id ?? "haven", goods: { fuel: -5 } }); changed(); })));
  return box;
}
// What a stage or a consequence changes aboard the Meridian: the morale of her people, her stores and her fuel. The
// file still writes it as "fleet:", from when there was one, and anything else written there (other ships, the
// Choir's pursuit) is kept in the file but not offered, since the game no longer reads it.
function shipEditor(holder) {
  const box = el("div", { class: "subfacts" });
  box.append(el("label", {}, "What changes aboard the ship"));
  const keys = state.lists.shipKeys ?? ["morale", "food", "medicine", "parts", "fuel"];
  const view = { numbers: Object.fromEntries(Object.entries(holder.fleet ?? {}).filter(([key]) => keys.includes(key))) };
  const rest = Object.fromEntries(Object.entries(holder.fleet ?? {}).filter(([key]) => !keys.includes(key)));
  const put = () => {
    holder.fleet = { ...(view.numbers ?? {}), ...rest };
    if (!Object.keys(holder.fleet).length) delete holder.fleet;
  };
  box.append(pairsEditor(view, "numbers", "Morale aboard, food, medicine, parts and fuel", keys, 1, put));
  const leftovers = Object.keys(rest);
  if (leftovers.length) box.append(hint(`Also written here, from when there was a fleet, and no longer read by the game: ${leftovers.join(", ")}.`));
  return box;
}
function inspectNumbers(inspector, node) {
  const P = state.item, lists = state.lists;
  fill(inspector, h2("Their numbers"), hint("Beliefs run from -10 to 10, attributes from 1 to 10, skills from 0 to 10."),
    pairsEditor(P, "beliefs", "Beliefs", lists.axes), pairsEditor(P, "attributes", "Attributes", lists.attributes), pairsEditor(P, "skills", "Skills", lists.skills));
}
function inspectSpeciesNumbers(inspector, node) {
  const P = state.item, lists = state.lists;
  fill(inspector, h2("Their numbers"), hint("What this species adds or takes from a new character's attributes and skills."),
    pairsEditor(P, "attrs", "Attributes", lists.attributes), pairsEditor(P, "attrCaps", "Attribute caps", lists.attributes), pairsEditor(P, "skills", "Skills", lists.skills));
}
// An item's drawing for the inventory: one row to a line, spaces kept.
function inspectDrawing(inspector) {
  const P = state.item;
  const area = textarea("edit-drawing", (P.art ?? []).join("\n"), 6);
  area.classList.add("board-drawing");
  fill(inspector, h2("Its drawing in the inventory"),
    el("label", { for: "edit-drawing" }, "One row to a line, in plain characters. Spaces count, and it's drawn in the squares the item takes."), area,
    row(button("Keep", () => {
      const rows = area.value.replace(/\r\n?/g, "\n").split("\n").map((one) => one.replace(/\s+$/, ""));
      while (rows.length && !rows.at(-1)) rows.pop();
      P.art = rows.length ? rows : undefined;
      changed();
    }), button("Undo", () => inspect())),
    hint("Leave it empty and the item is drawn as its kind: a weapon, armor, a supply, a gadget or a story piece. Keep changes the box and the file together. Save writes the file."));
}
function inspectEffects(inspector, node) {
  const P = state.item, lists = state.lists;
  P.fx ??= {};
  const fx = P.fx;
  const numberList = state.kind === "species" ? [["maxHp", "max hp", 1], ["fatigueRate", "fatigue rate", 0.05], ["healRate", "heal rate", 0.05], ["stressRate", "stress rate", 0.05]]
    : state.kind === "perk" ? PERK_NUMBERS.map(([key, label]) => [key, label, /Rate|Recovery|Bonus/.test(key) ? 0.05 : 1]) : [];
  const numbers = numberList.map(([key, label, step]) => {
    const box = numberBox(`edit-fx-${key}`, fx[key] ?? "", step);
    return row(el("label", { for: box.id }, label), box, button("Keep", () => { if (box.value === "") delete fx[key]; else fx[key] = Number(box.value); changed(); }, { class: "small" }));
  });
  fill(inspector, h2("Effects"), hint(state.kind === "species" ? "Leave a number empty for none. Rates are fractions of the usual: 0.5 is half." : state.kind === "perk" ? "Leave a number empty for none. Rates are fractions of the usual: 1.25 is a quarter more." : "While it's worn or carried: a bonus or a penalty in a setting, or to a skill."), ...numbers,
    pairsEditor(fx, "skills", "Skills", lists.skills), state.kind === "perk" ? pairsEditor(fx, "windowTier", "Better tools in check windows", lists.skills) : null,
    pairsEditor(fx, "context", "In a setting", lists.contexts), state.kind === "species" ? pairsEditor(fx, "factions", "Standing with", lists.factions.map((one) => one.id)) : null);
}
function inspectFight(inspector, node) {
  const P = state.item, lists = state.lists;
  P.combat ??= {};
  const c = P.combat;
  const fields = [["threat", "threat"], ["hp", "hp"], ["attack", "attack"], ["defense", "defense"], ["xp", "xp"]].map(([key, label]) => {
    const box = numberBox(`edit-fight-${key}`, c[key] ?? "");
    return row(el("label", { for: box.id }, label), box, button("Keep", () => { if (box.value === "") delete c[key]; else c[key] = Number(box.value); changed(); }, { class: "small" }));
  });
  const range = (key, label) => {
    const low = numberBox(`edit-fight-${key}-low`, c[key]?.[0] ?? ""), high = numberBox(`edit-fight-${key}-high`, c[key]?.[1] ?? "");
    return row(el("label", { for: low.id }, label), low, el("span", {}, "to"), high, button("Keep", () => { if (low.value === "" && high.value === "") delete c[key]; else c[key] = [Number(low.value || 0), Number(high.value || 0)]; changed(); }, { class: "small" }));
  };
  const weapon = textBox("edit-fight-weapon", c.weapon ?? "");
  const art = picker("edit-fight-art", [["", "none"], ...lists.arts.map((one) => [one, one])], c.art ?? "");
  const tags = textBox("edit-fight-tags", (c.tags ?? []).join(", "));
  const machine = checkBox("edit-fight-machine", c.machine), boss = checkBox("edit-fight-boss", c.boss);
  const linesBoxes = [["intro", "When the fight starts"], ["hit", "When they hit"], ["miss", "When they miss"], ["crit", "When they hit hard"], ["defeated", "When they're beaten"]].map(([key, label]) => {
    const area = textarea(`edit-lines-${key}`, (c.lines?.[key] ?? []).join("\n"), 3);
    return fill(el("div", {}), el("label", { for: area.id }, `${label}, one line each`), area, row(button("Keep", () => { const items = area.value.split("\n").map((one) => one.trim()).filter(Boolean); if (items.length) (c.lines ??= {})[key] = items; else if (c.lines) { delete c.lines[key]; if (!Object.keys(c.lines).length) delete c.lines; } changed(); }, { class: "small" })));
  });
  fill(inspector, h2("In a fight"), ...fields, range("damage", "damage"), range("credits", "credits"),
    el("label", { for: "edit-fight-weapon" }, "weapon"), weapon,
    row(el("label", { for: "edit-fight-art" }, "drawn as"), art),
    el("label", { for: "edit-fight-tags" }, "tags, separated by commas"), tags,
    row(el("label", { for: "edit-fight-machine" }, "a machine"), machine, el("label", { for: "edit-fight-boss" }, "a boss"), boss),
    row(button("Keep these", () => { if (weapon.value.trim()) c.weapon = weapon.value.trim(); else delete c.weapon; if (art.value) c.art = art.value; else delete c.art; c.tags = tags.value.split(",").map((one) => one.trim()).filter(Boolean); if (machine.checked) c.machine = true; else delete c.machine; if (boss.checked) c.boss = true; else delete c.boss; changed(); })),
    pairsEditor(c, "onHit", "When they hit, the player also gets", ["stress", "energy"]),
    pairsEditor(c, "loot", "What they leave on the floor when they're beaten, each with its chance in 100", lists.items.map((one) => one.id)),
    ...linesBoxes);
}
function daysRow(holder) {
  const days = picker("edit-days", [0, 1, 2, 3, 5, 7, 10, 14, 18, 20, 25, 30, 38, 45, 60, 75, 90, 120].map((one) => [String(one), one === 0 ? "the same day" : `${one} days`]), String(holder.after));
  if (![...days.options].some((one) => one.value === String(holder.after))) days.append(el("option", { value: String(holder.after), selected: "selected" }, `${holder.after} days`));
  days.value = String(holder.after);
  return row(el("label", { for: "edit-days" }, "After"), days, button("Keep", () => { holder.after = Number(days.value); changed(); }));
}
function placeRow(holder) {
  const place = picker("edit-place", [["", "the story's first place"], ...state.places.map((one) => [one.id, one.name])], holder.place ?? "");
  const big = checkBox("edit-big", holder.big);
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

function subFacts(holder) {
  const box = el("div", { class: "subfacts" });
  const draw = () => {
    box.replaceChildren(el("label", {}, "Facts it puts on the record"));
    for (const [name, line] of Object.entries(holder.facts ?? {})) {
      const input = textBox(`edit-subfact-${name}`, line);
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

// ---- The written scene, or a person's written lines --------------------------------------------------
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
    part.ai ? hint(`A note for whoever writes: ${part.ai}`) : null,
    node.problem ? el("div", { class: "problems" }, ...state.scene.problems.filter((one) => one.includes(`part ${part.name}`)).map((one) => el("div", {}, one))) : null,
    hint("Keep changes the part and the file together. Save writes the file, and it plays the new version from the next turn."));
}
// ---- A request (world/scenes/request_<kind>.txt), and every request -----------------------------------------------
const REQUEST_LINES = [
  ["for", "For", "Which lives it's for: the captain, crew, outsiders, anyone aboard, anyone, or lives by name, like engine hand or dock hand. Several with commas. Without it, anyone aboard."],
  ["as", "As", "an order, for one that crew are ordered to do by the officer over them. Without it, it's a request."],
  ["when", "When", "A condition, as in a scene: while it holds, they ask. Without it, the life and the trouble decide."],
  ["about", "About", "Whose trouble it is: a rival, someone relieved, someone in the brig, the least loyal officer, a post left empty, someone down with nobody coming, a keepsake you took, or a job the work board has left waiting: a job nobody can do, or a job with nothing to do it with."],
  ["asks", "Asks", "Who asks: a post (the chief medical officer), a job (a cook), someone by name, your officer, your boss, someone here, or them (with about:)."],
  ["needs", "Needs", "What's wanted: medicine crates aboard +2, ration crates in the pantry +2, fix a part waiting for repairs, give 1 medkit to {asker} (or give 1 {thing} to {asker}, for a keepsake you took), sell 3 ration packs to {asker}, at half again the market price, talk to the quartermaster, go to haven, pass engineering, work a shift, your word, carry {about} to the medbay, see to it yourself (for a job nobody can do), or bring what's wanted (for a job with nothing to do it with)."],
  ["by", "By", "How long they give once the player says yes: 5 days, or 12 hours."],
  ["gone when", "Gone when", "A condition that means it's been put right without the player: supply food >= 100 at {place}, or stock medicine_crate >= 4."],
  ["handed to", "Handed to", "A post the captain can leave it to instead, like the chief engineer. It needs a part called handed."],
];
const REQUEST_ANSWERS = { yes: "Yes", given: "Given there and then", handed: "Left to a post", later: "Not now", no: "No" };
const REQUEST_ENDINGS = { done: "Done", failed: "Failed", gone: "No longer needed" };
const topPattern = (key) => new RegExp(`^\\s*${key.replace(" ", "\\s+")}:\\s*(.*)$`, "i");
function topLineOf(key) {
  for (const line of String(state.scene?.header ?? "").split("\n")) {
    const found = line.match(topPattern(key));
    if (found) return found[1].trim();
  }
  return null;
}
// A line on top written, changed or taken out: after the others, in the order they're explained, or after the title.
function setTopLine(key, words) {
  const lines = String(state.scene.header ?? "").split("\n");
  const at = lines.findIndex((line) => topPattern(key).test(line));
  if (at >= 0 && !words) lines.splice(at, 1);
  else if (at >= 0) lines[at] = `${key}: ${words}`;
  else if (words) {
    const others = lines.map((line, i) => (REQUEST_LINES.some(([one]) => topPattern(one).test(line)) ? i : -1)).filter((i) => i >= 0);
    const after = others.length ? others.at(-1) : Math.max(0, ...lines.map((line, i) => (/^\s*(#|\/\/)/.test(line) ? i : 0)));
    lines.splice(after + 1, 0, `${key}: ${words}`);
  }
  state.scene.header = lines.join("\n");
}
function requestGraph() {
  if (state.item?.overview) return requestsOverviewGraph();
  const scene = state.scene;
  const list = [], ws = [];
  const problems = scene.problems ?? [];
  REQUEST_LINES.forEach(([key, label], i) => {
    const words = topLineOf(key);
    list.push({ id: `top_${i}`, kind: words === null ? "clock" : "lead", col: 0, name: `${label}:`, text: words ?? "Not written. Click to write it.", label: "A line on top", bind: { requestTop: key }, problem: problems.some((one) => one.includes(` ${key}: `) || one.includes(`: ${key}:`)) });
  });
  const add = (name, kind, col, title) => {
    const i = scene.parts.findIndex((one) => one.name === name);
    if (i < 0) return null;
    const part = scene.parts[i];
    const label = REQUEST_ANSWERS[name] ? `What they say to ${REQUEST_ANSWERS[name] === "Yes" ? "a yes" : REQUEST_ANSWERS[name].toLowerCase()}` : REQUEST_ENDINGS[name] ? `How it ends: ${REQUEST_ENDINGS[name].toLowerCase()}` : name === "ask" ? "What they ask" : "A part";
    list.push({ id: `p_${name}`, kind, col, name: title, text: part.text || "...", label, part: i, bind: { requestPart: name }, problem: problems.some((one) => one.includes(`part ${name} `) || one.includes(`part ${name},`) || one.includes(`part called ${name}`)) });
    return `p_${name}`;
  };
  const ask = add("ask", "beat", 1, "What they ask");
  for (const [name, title] of Object.entries(REQUEST_ANSWERS)) add(name, "route", 2, title);
  for (const [name, title] of Object.entries(REQUEST_ENDINGS)) add(name, "ending", 3, title);
  scene.parts.forEach((part) => { if (part.name !== "ask" && !REQUEST_ANSWERS[part.name] && !REQUEST_ENDINGS[part.name]) add(part.name, "fact", 2, part.name); });
  const has = (id) => list.some((one) => one.id === id);
  if (ask && has("top_4")) ws.push({ from: "top_4", to: ask, words: "asks" });
  const askPart = scene.parts.find((one) => one.name === "ask");
  for (const one of askPart?.choices ?? []) if (one.to && has(`p_${one.to}`)) ws.push({ from: ask, to: `p_${one.to}`, words: one.say });
  for (const [to, words] of [["done", "it's done"], ["failed", "the day comes first"], ["gone", "put right without the player"]]) if (has("p_yes") && has(`p_${to}`)) ws.push({ from: "p_yes", to: `p_${to}`, words });
  for (const from of ["given", "handed"]) if (has(`p_${from}`) && has("p_done")) ws.push({ from: `p_${from}`, to: "p_done", words: "it's done" });
  return { list, ws };
}
function requestsOverviewGraph() {
  const list = [];
  const groups = [...new Set(state.item.kinds.map((one) => one.group))];
  for (const one of state.item.kinds) {
    const said = [one.asks && `${/^them$/i.test(one.asks.trim()) ? "Whoever it's about" : firstUp(one.asks)} asks.`, one.needs && `Wanted: ${one.needs}.`, one.by && `By ${one.by}.`, one.when && `When ${one.when}.`].filter(Boolean).join(" ");
    list.push({ id: `kind_${one.id}`, kind: one.order ? "route" : "beat", col: groups.indexOf(one.group), name: one.title, text: said || "...", label: `For ${one.group}${one.order ? ", an order" : ""}`, bind: { requestKind: one.id }, problem: one.problems > 0 });
  }
  return { list, ws: [] };
}
const firstUp = (text) => String(text ?? "").replace(/^./, (ch) => ch.toUpperCase());
// Words that can be picked with a click, for the lines on top that have only a few answers.
const REQUEST_PICKS = {
  for: ["the captain", "crew", "outsiders", "anyone aboard", "anyone"],
  as: ["an order"],
  about: ["a rival", "someone relieved", "someone in the brig", "the least loyal officer", "a post left empty", "someone down with nobody coming", "a keepsake you took", "a job nobody can do", "a job with nothing to do it with"],
  by: ["3 hours", "12 hours", "1 day", "2 days", "3 days", "5 days", "7 days"],
};
function inspectRequestNode(inspector, node) {
  if (node.bind?.requestKind) {
    const one = state.item.kinds.find((kind) => kind.id === node.bind.requestKind);
    return fill(inspector, h2(one.title), hint(node.label), hint(node.text), one.problems ? el("div", { class: "problems" }, el("div", {}, `The checker would like ${one.problems} ${one.problems === 1 ? "thing" : "things"} changed in it.`)) : null, row(button("Open it", () => load("request", one.id))), hint(`Its file is world/scenes/request_${one.id}.txt.`));
  }
  if (node.bind?.requestTop) {
    const key = node.bind.requestTop;
    const [, label, help] = REQUEST_LINES.find(([one]) => one === key);
    const now = topLineOf(key);
    const box = textBox("edit-top", now ?? "");
    const keep = async () => {
      setTopLine(key, box.value.trim());
      await refreshScene();
    };
    const optional = !["asks", "needs", "by"].includes(key);
    return fill(inspector,
      h2(`${label}:`),
      hint(help),
      el("label", { for: "edit-top" }, now === null ? "Write it here, and Keep adds the line" : "The words after it"),
      box,
      REQUEST_PICKS[key] ? fill(el("div", { class: "choices" }), el("label", {}, "Or pick, then Keep"), ...REQUEST_PICKS[key].map((words) => button(words, () => { box.value = words; }, { class: "small" }))) : null,
      row(button("Keep", keep), button("Undo", () => inspect()), optional && now !== null ? button("Take it out", async () => { setTopLine(key, ""); await refreshScene(); }) : null),
      node.problem ? el("div", { class: "problems" }, ...(state.scene.problems ?? []).filter((one) => one.includes(`${key}:`)).map((one) => el("div", {}, one))) : null,
      hint("Keep changes the line and the file together. Save writes the file, and the game uses the new version from the next time it's asked."));
  }
  if (node.bind?.requestPart) return inspectPart(inspector, node);
  return inspectNode(inspector, node);
}

async function keepPart(index, raw) {
  state.scene.parts[index].raw = raw;
  await refreshScene();
}
async function refreshScene() {
  state.sceneDirty = true;
  try {
    const view = await call(sceneRoute(), { check: true, text: sceneText() });
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
  const line = textBox("edit-line", rawLines[at]);
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
      const result = await call(sceneRoute(), { text: sceneText() });
      if (!result.saved) return say(`Not saved: ${result.problems[0]}`, false);
      state.sceneDirty = false;
      state.scene.problems = result.problems;
      say(result.problems.length ? `Saved. ${result.problems.length} ${result.problems.length === 1 ? "thing" : "things"} the checker would like changed.` : "Saved. It plays the new version from the next turn.");
    } else if (state.kind === "story") {
      const result = await call(`/api/board/story/${state.id}`, { text: writeStoryText(S(), C()) });
      if (!result.saved) return say(`Not saved: ${result.problems[0]}`, false);
      state.dirty = false;
      state.problems = result.problems;
      state.stories = (await call("/api/board/stories")).stories;
      state.items = state.stories;
      say(result.problems.length ? `Saved. ${result.problems.length} ${result.problems.length === 1 ? "thing" : "things"} the checker would like changed.` : "Saved. The game plays the new version from the next turn.");
    } else {
      const result = await call(`/api/board/world/${state.kind}/${state.id}`, { text: state.kind === "request" ? sceneText() : state.kind === "systems" ? writeSystemsText(state.item) : state.kind === "logistics" ? writeLogisticsText(state.item) : state.kind === "port" ? writePortText(state.item) : state.kind === "goods" ? writeGoodsText(state.item) : state.kind === "command" ? writeCommandText(state.item) : state.kind === "health" ? writeHealthOf() : writeWorldText(state.item, SPECS[state.kind]) });
      if (!result.saved) return say(`Not saved: ${result.problems[0]}`, false);
      state.dirty = false;
      state.problems = result.problems;
      say(result.problems.length ? `Saved. ${result.problems.length} ${result.problems.length === 1 ? "thing" : "things"} the checker would like changed.` : "Saved. The game uses the new version from the next turn.");
    }
    redraw();
  } catch (err) {
    say(err.message, false);
  }
}
