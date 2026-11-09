// The character sheet: what the fleet's registry prints about the player, on amber dot-matrix paper that feeds down
// out of a printer slot at the top of the map, and goes back up into it when it's torn off. It opens from the
// Character button, /char or C, takes only a corner of the room, and the clock runs on behind it. The owner picked it
// from five examples on 2026-11-08 ("the registry printout", in the map and not a menu on the right). Everything on it
// comes from the game view the menus used; the buttons do what the old Character menu's did. Anyone else's printout
// opens from the right-click menu on them (Registry), from the server's /api/person-sheet (src/person-sheet.js).

import { api, el, signed } from "./dom.js";

const FEED_MS = 520;
const RULE = "-".repeat(56);
// subject is null for the player's own printout, or { key, data } for someone else's.
const state = { open: false, openedAt: 0, closing: false, subject: null };
let app;

export function initSheet(hooks) {
  app = hooks;
  document.addEventListener("keydown", onKey);
}

export const sheetOpen = () => state.open && Boolean(app?.ui.game);
export function resetSheet() {
  Object.assign(state, { open: false, openedAt: 0, closing: false, subject: null });
}
export function openSheet(subject = null) {
  state.subject = subject;
  state.open = true;
  state.closing = false;
  state.openedAt = performance.now();
  app.render();
  // However the animation went (a hidden window doesn't play them), the paper is all the way out once it's had time.
  setTimeout(() => document.querySelector("#sheet .sheet-paper.feeding")?.classList.remove("feeding"), FEED_MS + 60);
}
export function closeSheet() {
  if (!state.open || state.closing) return;
  state.closing = true;
  const paper = document.querySelector("#sheet .sheet-paper");
  const done = () => {
    if (!state.closing) return;
    state.open = false;
    state.closing = false;
    state.subject = null;
    app.render();
  };
  if (!paper || matchMedia("(prefers-reduced-motion: reduce)").matches) return done();
  paper.classList.add("rewinding");
  paper.addEventListener("animationend", done, { once: true });
  setTimeout(done, FEED_MS + 200);
}
// C and the Character button: the player's own printout, or put away. Over someone else's, it prints the player's.
export const toggleSheet = () => (state.open && !state.closing && !state.subject ? closeSheet() : openSheet());

// The right-click menu's Registry: someone else's printout, or put away if it's theirs already showing.
export async function openPersonSheet(key) {
  if (state.open && !state.closing && state.subject?.key === key) return closeSheet();
  const data = await api("/api/person-sheet", { key });
  openSheet({ key, data });
}

// Drawn inside the map when there's a room on screen, and over the top of the story otherwise.
export function sheetNode({ inMap = false } = {}) {
  const g = app?.ui.game;
  if (!sheetOpen()) return null;
  // A fight, a check, a talk or a computer takes over from it.
  if (g.combat || g.check || g.talk || g.computer) {
    resetSheet();
    return null;
  }
  const elapsed = performance.now() - state.openedAt;
  const paper = el("div", { class: `sheet-paper${elapsed < FEED_MS ? " feeding" : ""}${state.closing ? " rewinding" : ""}` }, ...(state.subject ? personPrintout(state.subject.data) : printout(g)));
  // A redraw while it's still feeding carries on from where it was, instead of starting again.
  if (elapsed < FEED_MS) paper.style.animationDelay = `-${Math.round(elapsed)}ms`;
  setTimeout(placeSheet, 0);
  setTimeout(placeSheet, 350);
  return el("div", { class: `sheet-dock${inMap ? " in-map" : ""}`, id: "sheet" },
    el("div", { class: "sheet-slot" },
      el("span", {}, "REGISTRY PRINTER"),
      el("button", { class: "sheet-btn", title: "Put it away (C or Esc)", onclick: closeSheet }, "[ TEAR OFF ]")),
    el("div", { class: "sheet-feed" }, paper));
}

// The whole printout is always on show, with no scroll bar: on a narrow map it hangs below the quest tracker in the
// top left corner instead of over it, it keeps above the "What do you do?" window, and when there isn't the height for
// it at the usual size its type gets smaller until it fits. If that would make it hard to read, it's printed in two
// columns side by side instead, whichever leaves the bigger type.
const SIZES = [12, 11.5, 11, 10.5, 10, 9.5, 9, 8.5, 8, 7.5];
const READABLE = 10;
function placeSheet() {
  const dock = document.getElementById("sheet");
  if (!dock) return;
  const inMap = dock.classList.contains("in-map");
  const tracker = inMap ? document.getElementById("quest-tracker") : null;
  const bottom = inMap ? document.getElementById("pop-row") : null;
  watch(inMap ? dock.parentElement : null, tracker, bottom);
  const one = layout(dock, inMap, tracker, bottom, false);
  if (one.fits && one.size >= READABLE) return;
  const two = layout(dock, inMap, tracker, bottom, true);
  if (two.fits && (!one.fits || two.size > one.size)) return;
  layout(dock, inMap, tracker, bottom, false);
}
const across = (a, b) => a?.width && b && a.right > b.left && a.left < b.right;
// Tries each type size in one or two columns, and leaves the dock at the first that fits, or the smallest.
function layout(dock, inMap, tracker, bottom, twoColumns) {
  dock.classList.toggle("two", twoColumns);
  const box = inMap ? dock.parentElement.getBoundingClientRect() : { top: 0, height: window.innerHeight };
  for (const size of SIZES) {
    dock.style.fontSize = `${size}px`;
    dock.style.top = "";
    const t = tracker?.getBoundingClientRect();
    if (across(t, dock.getBoundingClientRect())) dock.style.top = `${Math.round(t.bottom - box.top + 6)}px`;
    const placed = dock.getBoundingClientRect();
    const below = bottom?.getBoundingClientRect();
    const floor = across(below, placed) ? below.top : box.top + box.height;
    if (placed.height <= floor - placed.top - 8) return { fits: true, size };
  }
  return { fits: false, size: SIZES[SIZES.length - 1] };
}
window.addEventListener("resize", () => placeSheet());
// The map and the quest tracker settle their sizes after the page is drawn, and the tracker grows and shrinks, so it
// places itself again whenever either changes.
const watcher = typeof ResizeObserver === "function" ? new ResizeObserver(() => placeSheet()) : null;
let watching = [];
function watch(...nodes) {
  nodes = nodes.filter(Boolean);
  if (!watcher || (nodes.length === watching.length && nodes.every((node, i) => node === watching[i]))) return;
  watcher.disconnect();
  watching = nodes;
  for (const node of nodes) watcher.observe(node);
}

// ---- What's printed --------------------------------------------------------------------------------------

const bar = (n, max, width) => {
  const full = Math.max(0, Math.min(width, Math.round((n / Math.max(1, max)) * width)));
  return "█".repeat(full) + "░".repeat(width - full);
};
const hi = (text) => el("span", { class: "sheet-hi" }, text);
const dim = (text) => el("span", { class: "sheet-dim" }, text);
const red = (text) => el("span", { class: "sheet-red" }, text);
const line = (...parts) => el("div", { class: "sheet-line" }, ...parts);
const field = (label, ...value) => el("div", { class: "sheet-field" }, el("span", { class: "sheet-label" }, label), el("span", {}, ...value));
const rule = () => line(dim(RULE));
const button = (label, onclick, props = {}) => el("button", { class: "sheet-btn", onclick, ...props }, `[ ${label} ]`);

function printout(g) {
  const d = g.dossier ?? {};
  const query = String(((g.level ?? 1) * 7919 + (g.age ?? 0) * 31) % 10000).padStart(4, "0");
  return [
    line(dim(`==== FLEET REGISTRY · QUERY ${query} `.padEnd(56, "="))),
    field("NAME", hi(`${g.name}`.toUpperCase()), d.callsign ? ` "${d.callsign}"` : ""),
    field("SPECIES", `${g.species}`, dim(`   ${g.pronouns}, age ${g.age}`)),
    (d.homeworld || d.upbringing) && field("FROM", [d.homeworld, d.upbringing].filter(Boolean).join(" · ")),
    g.background && field("TRADE", g.background),
    g.ideologyTitle && field("BELIEVES", g.ideologyTitle),
    d.drive && field("DRIVEN TO", d.drive),
    g.role && field("POST", g.role.captain ? "Captain of the CFS Meridian" : g.role.title ?? ""),
    g.role?.chair && !g.role.captain && field("", dim(`${g.role.chair} has the chair. You're not the one they ask.`)),
    rule(),
    field("LEVEL", hi(String(g.level)), `   XP ${bar(g.xp, g.xpToNext, 14)} ${g.xp}/${g.xpToNext}`),
    pointsLine(g),
    rule(),
    el("div", {}, line(hi("ATTRIBUTES"), g.statPoints > 0 ? dim(`   ${g.statPoints} point${g.statPoints === 1 ? "" : "s"} to spend`) : ""), ...attributes(g)),
    rule(),
    el("div", {}, line(hi("SKILLS"), dim("   click one to train it")), skills(g)),
    rule(),
    ...traits(g),
    ...condition(g),
    rule(),
    ...fight(g),
    carrying(g),
    rule(),
    actions(g),
    line(dim("==== END OF RECORD ".padEnd(56, "="))),
  ].filter(Boolean);
}

function pointsLine(g) {
  const parts = [
    [g.statPoints, "attribute", null],
    [g.skillPoints, "skill", "skills"],
    [g.perkPoints, "perk", "perks"],
  ];
  return field("POINTS", ...parts.map(([n, word, menu], i) => {
    const text = `${n} ${word}${i < parts.length - 1 ? "   " : ""}`;
    return n > 0 && menu ? el("button", { class: "sheet-link", title: `Spend them in ${menu === "skills" ? "Skills" : "Perks"}`, onclick: () => app.openMenu(menu) }, text) : text;
  }));
}

function attributes(g) {
  const labels = app.ui.setup?.stats ?? {};
  return Object.entries(labels).map(([id, label]) => {
    const value = g.stats?.[id] ?? 0;
    const base = g.baseStats?.[id];
    return el("div", { class: "sheet-attr", title: g.statInfo?.[id] ?? "" },
      el("span", {}, `  ${label.toUpperCase().padEnd(11)}`),
      hi(String(value).padStart(2)),
      el("span", { class: "sheet-bar" }, `  ${bar(value, 10, 16)}  `),
      el("span", {}, signed(value - 3).padStart(3)),
      base !== undefined && base !== value ? dim(` (base ${base})`) : "",
      g.statPoints > 0 ? button("+", app.act({ action: "stat", id }), { "aria-label": `Raise ${label}`, title: `Raise ${label}` }) : "");
  });
}

function skills(g) {
  const known = (g.skills ?? []).filter((s) => s.rank > 0).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
  if (!known.length) return line(dim("  None yet."));
  return el("div", { class: "sheet-skills" }, known.map((s) => el("button", {
    class: "sheet-skill",
    title: `${s.desc ?? ""} Bonus on checks ${signed(s.bonus)}.`.trim(),
    onclick: () => app.openMenu("skills"),
  }, `${s.tagged ? "*" : ""}${s.name.toUpperCase()} `.padEnd(15, ".") + String(s.rank).padStart(2))));
}

function traits(g) {
  const costs = app.ui.setup?.traits ?? {};
  const bad = (t) => (costs[t.id]?.cost ?? 0) < 0;
  const list = (items, cls = "") => items.flatMap((t, i) => [i ? ", " : "", el("span", { class: cls, title: t.desc ?? "" }, t.name)]);
  const good = (g.traits ?? []).filter((t) => !bad(t));
  const flags = (g.traits ?? []).filter(bad);
  return [
    good.length && field("TRAITS", ...list(good)),
    flags.length && field("FLAGS", ...list(flags, "sheet-red")),
    g.convictions?.length && field("HOLDS TO", g.convictions.map((c) => c.name).join(", ")),
  ];
}

function condition(g) {
  const needs = g.needs ?? {};
  const strain = (n) => (n >= 75 ? red(String(n)) : n >= 50 ? el("span", { class: "sheet-warn" }, String(n)) : String(n));
  const penalties = [
    g.penalties?.stress && `stress ${g.penalties.stress}`,
    g.penalties?.fatigue && `fatigue ${g.penalties.fatigue}`,
    g.penalties?.checks && `conditions ${signed(g.penalties.checks)}`,
  ].filter(Boolean);
  return [
    field("CONDITION", `HEALTH ${g.hp}/${g.maxHp}   ENERGY ${g.energy}/${g.maxEnergy}`),
    field("", "STRESS ", strain(needs.stress ?? 0), "   FATIGUE ", strain(needs.fatigue ?? 0)),
    ...(g.conditions ?? []).map((c) => field("", el("span", { class: "sheet-red", title: c.desc ?? "" }, `${c.name}, ${Math.ceil(c.hoursLeft)}h left`))),
    penalties.length && field("", red(`On every check: ${penalties.join(", ")}`)),
  ];
}

function fight(g) {
  const p = g.combatProfile;
  if (!p) return [];
  return [
    field("ARMED", `${p.weapon}  ${signed(p.attack)}, ${p.damage[0]}-${p.damage[1]} dmg`),
    field("WEARING", `${p.armor}${p.armorDefense ? `  defense +${p.armorDefense}` : ""}`),
    field("IN A FIGHT", `defense ${p.defense}   escape ${p.escape}%`),
    g.abilities?.length && field("ABILITIES", g.abilities.map((a) => `${a.name} (${a.energy} energy)`).join(", ")),
  ];
}

function carrying(g) {
  const items = (g.inventory ?? []).filter((i) => !i.equipped);
  const shown = items.slice(0, 5).map((i) => `${i.name}${i.count > 1 ? ` (${i.count})` : ""}`);
  const more = items.length - shown.length;
  return field("CARRYING", [...shown, `${g.credits ?? 0} cr`].join(", "), more > 0 ? dim(` and ${more} more`) : "", " ",
    el("button", { class: "sheet-link", title: "Open the inventory (I)", onclick: () => app.openMenu("inventory") }, "[ BAG ]"));
}

function actions(g) {
  const busy = Boolean(g.combat || g.talk || g.check);
  const role = g.role ?? {};
  const parts = [];
  if (role.job) parts.push(button(`${role.job.name.toUpperCase()}, ~${role.job.pay} CR`, app.act({ action: "work" }), { disabled: busy, title: "Eight hours of work. It wears you out." }));
  else if (role.jobAway) parts.push(dim(`Your work's back at ${role.jobAway.place}. `));
  if (role.rest === null) parts.push(dim("You can only sleep properly aboard the Meridian."));
  else if (!role.rest) parts.push(button(role.captain ? "SLEEP ABOARD, 8H" : "SLEEP, 8H", app.act({ action: "rest" }), { disabled: busy }));
  else {
    parts.push(button(`RENT A BUNK, 8H, ${role.rest} CR`, app.act({ action: "rest" }), { disabled: busy || g.credits < role.rest, title: g.credits < role.rest ? "You can't afford it" : "" }));
    parts.push(button("SLEEP ROUGH, 8H", app.act({ action: "rest", rough: true }), { disabled: busy, title: "Free, but you won't wake up much better for it" }));
  }
  return el("div", { class: "sheet-actions" }, g.clock?.label ? dim(`${g.clock.label}  `) : "", ...parts);
}

// ---- Someone else's printout ------------------------------------------------------------------------------

function personPrintout(p) {
  const query = String([...String(p.key)].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 10000, 7)).padStart(4, "0");
  const who = [p.pronouns, p.age !== null && p.age !== undefined ? `age ${p.age}` : null].filter(Boolean).join(", ");
  const f = p.fight;
  return [
    line(dim(`==== FLEET REGISTRY · QUERY ${query} `.padEnd(56, "="))),
    field("NAME", hi(String(p.name).toUpperCase())),
    p.aliases?.length && field("ALSO KNOWN", p.aliases.join(", ")),
    field("SPECIES", p.species ?? "Not recorded", who ? dim(`   ${who}`) : ""),
    field("POST", p.post ?? dim("None on file")),
    p.faction && field("FACTION", p.faction),
    p.based && field("BASED AT", p.based),
    p.status && field("STATUS", red(String(p.status).toUpperCase())),
    p.attitude && field("TOWARD YOU", p.attitude),
    p.seen && field("LAST SEEN", p.seen),
    rule(),
    el("div", {}, line(hi("ATTRIBUTES")), ...p.attributes.map((a) => el("div", { class: "sheet-attr" },
      el("span", {}, `  ${a.label.toUpperCase().padEnd(11)}`),
      hi(String(a.value).padStart(2)),
      el("span", { class: "sheet-bar" }, `  ${bar(a.value, 10, 16)}  `),
      el("span", {}, signed(a.value - 3).padStart(3))))),
    rule(),
    el("div", {}, line(hi("SKILLS")), p.skills.length
      ? el("div", { class: "sheet-skills" }, p.skills.map((s) => el("span", { class: "sheet-skill" }, `${s.name.toUpperCase()} `.padEnd(15, ".") + String(s.rank).padStart(2))))
      : line(dim("  None recorded."))),
    rule(),
    p.looks && field("LOOKS", p.looks),
    f && field("ARMED", `${f.weapon ?? "Bare hands"}  ${signed(f.attack ?? 0)}${f.damage ? `, ${f.damage[0]}-${f.damage[1]} dmg` : ""}`),
    f && field("IN A FIGHT", [f.defense !== null ? `defense ${f.defense}` : null, f.hp ? `health ${f.hp}` : null].filter(Boolean).join("   ")),
    p.pocket && field("POCKETS", p.pocket),
    rule(),
    p.thin
      ? field("REMARKS", dim("No full record on file. Filled in from the general roll."))
      : p.note && field("REMARKS", p.note),
    el("div", { class: "sheet-actions" }, button("YOUR OWN RECORD", () => openSheet(), { title: "Print your own (C)" })),
    line(dim("==== END OF RECORD ".padEnd(56, "="))),
  ].filter(Boolean);
}

// ---- Keys ----------------------------------------------------------------------------------------------

function onKey(event) {
  const { ui } = app;
  if (ui.screen !== "game" || !ui.game || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.closest?.("input, textarea, select") || document.getElementById("board")) return;
  if (event.key === "Escape" && state.open && !ui.sideOpen) {
    event.preventDefault();
    closeSheet();
    return;
  }
  if ((event.key === "c" || event.key === "C") && !event.repeat) {
    const g = ui.game;
    if (g.combat || g.check || g.talk || g.computer || ui.sideOpen) return;
    event.preventDefault();
    toggleSheet();
  }
}

// ---- Its look, kept here so the stylesheet isn't touched -------------------------------------------------

const style = document.createElement("style");
style.textContent = `
.sheet-dock {
  position: absolute; z-index: 27; top: 6px; right: calc(var(--rail-width, 0px) + 12px);
  width: min(62ch, calc(100% - 24px));
  display: flex; flex-direction: column; pointer-events: none; font: 12px/1.4 var(--mono);
}
.sheet-dock.in-map { right: 8px; top: 34px; }
.sheet-dock.two { width: min(118ch, calc(100% - 16px)); }
.sheet-dock.two .sheet-paper { columns: 2; column-gap: 4ch; column-rule: 1px dashed #3a2709; }
.sheet-dock.two .sheet-paper > * { break-inside: avoid; }
.sheet-slot {
  flex: none; display: flex; justify-content: space-between; align-items: center; gap: 8px;
  background: #1a1206; border: 1px solid #5a3d12; border-bottom: 3px solid #050302;
  color: #a8732c; padding: 2px 4px 2px 10px; letter-spacing: .14em; font-size: 11px; pointer-events: auto;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .6);
}
.sheet-feed { min-height: 0; overflow: hidden; display: flex; flex-direction: column; margin: 0 6px; }
.sheet-paper {
  overflow: hidden; pointer-events: auto; position: relative;
  background: #120b02; color: #ffb547; padding: 8px 26px 10px; text-shadow: 0 0 5px rgba(255, 160, 40, .3);
  border: 1px solid #3a2709; border-top: 0; box-shadow: 0 6px 14px rgba(0, 0, 0, .55);
  background-image:
    radial-gradient(circle at 9px 12px, #050302 3.5px, transparent 4.5px),
    radial-gradient(circle at calc(100% - 9px) 12px, #050302 3.5px, transparent 4.5px),
    repeating-linear-gradient(#120b02 0 2.8em, #160e03 2.8em 5.6em);
  background-size: 100% 24px, 100% 24px, 100% 5.6em;
  background-attachment: local;
  scrollbar-color: #5a3d12 #120b02; scrollbar-width: thin;
}
.sheet-paper.feeding { animation: sheet-feed ${FEED_MS}ms steps(16, end) both; }
.sheet-paper.rewinding { animation: sheet-rewind ${Math.round(FEED_MS * 0.7)}ms steps(10, end) both; }
@keyframes sheet-feed { from { transform: translateY(-100%); } to { transform: none; } }
@keyframes sheet-rewind { from { transform: none; } to { transform: translateY(-100%); } }
@media (prefers-reduced-motion: reduce) { .sheet-paper.feeding, .sheet-paper.rewinding { animation: none; } }
.sheet-line, .sheet-attr { white-space: pre; overflow: hidden; text-overflow: clip; }
.sheet-field { display: grid; grid-template-columns: 11ch 1fr; }
.sheet-label { color: #ffe0a3; white-space: pre; }
.sheet-hi { color: #ffe0a3; }
.sheet-dim { color: #a8732c; }
.sheet-red { color: #ff7b6b; }
.sheet-warn { color: #ffd36b; }
.sheet-bar { letter-spacing: -.5px; }
.sheet-skills { display: grid; grid-template-columns: repeat(auto-fill, minmax(18ch, 1fr)); column-gap: 1ch; padding-left: 2ch; }
.sheet-btn, .sheet-link, .sheet-skill {
  font: inherit; color: inherit; background: transparent; border: 0; padding: 0 2px; margin: 0; cursor: pointer;
  text-shadow: inherit; white-space: pre; text-align: left; border-radius: 0;
}
.sheet-skill { padding: 0; }
.sheet-btn::before, .sheet-btn::after, .sheet-link::before, .sheet-link::after, .sheet-skill::before, .sheet-skill::after { content: none !important; }
.sheet-btn:hover:not(:disabled), .sheet-link:hover, .sheet-skill:hover,
.sheet-btn:focus-visible, .sheet-link:focus-visible, .sheet-skill:focus-visible { background: #ffb547; color: #120b02; text-shadow: none; outline: none; }
.sheet-btn:disabled { color: #6b4a1d; cursor: default; }
.sheet-slot .sheet-btn { color: #ffb547; }
.sheet-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; padding: 2px 0; }
`;
document.head.append(style);
