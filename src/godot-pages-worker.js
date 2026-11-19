// The game's menus, for the Godot view. What's inside each menu is worked out by the page's own code (public/menus.js
// and the files it uses), so a menu in Godot can never disagree with the same menu in the browser, and a menu changed
// there is changed here. That code builds a page's elements; here it builds them on a small stand-in for a page
// (src/mini-dom.js), on a thread of its own so that nothing it needs of a browser is ever seen by the game itself, and
// the tree of elements is handed to Godot to draw (godot/scripts/page.gd). A click in Godot comes back here as the
// number of the element clicked, and the element's own listener runs, sending its order to the game as the page does.

import { parentPort, workerData } from "node:worker_threads";
import { describe, fire, makeDocument } from "./mini-dom.js";

// A page's surroundings, as far as the menus look at them. Orders go to the game this thread belongs to.
const game = `http://127.0.0.1:${workerData.port}`;
const send = globalThis.fetch;
globalThis.fetch = (url, init) => send(typeof url === "string" && url.startsWith("/") ? game + url : url, init);
globalThis.document = makeDocument();
globalThis.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), innerWidth: 1400, innerHeight: 860, devicePixelRatio: 1 };
const kept = new Map();
globalThis.localStorage = { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, String(value)), removeItem: (key) => kept.delete(key) };
globalThis.requestAnimationFrame = (run) => setTimeout(() => run(Date.now()), 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

// Only now, with a page to find, is the page's code read.
const { api, columns, el, folded } = await import("../public/dom.js");
const { MENUS, MENU_GROUPS, initMenus } = await import("../public/menus.js");
const { initMap } = await import("../public/map.js");
const { initShip } = await import("../public/ship.js");
const { initCommand } = await import("../public/command.js");
const { initWork } = await import("../public/work.js");
const { initFreight } = await import("../public/freight.js");
const { initFreighters } = await import("../public/freighters.js");
const { initRig } = await import("../public/rig.js");
const { loreCatalog, setStoryContext } = await import("../public/story-view.js");

// What the page keeps about itself (ui in public/app.js), as far as the menus read it.
const ui = { game: null, saves: [], setup: null, screen: "game", tab: "leads", sideOpen: true, streaming: false, waiting: false, menuFocus: null, peopleFilter: "all", mapSelected: null, codexSearch: "", menuMessage: null };
// Whether the menu has to be built again after what was just done, and what Godot has to do about it itself.
let stale = false;
let effects = [];
const NOT_YET = "isn't in this window yet. It's in the game's own window.";

const render = () => {
  stale = true;
};
const runAction = (run) => async (...args) => {
  ui.menuMessage = null;
  try {
    await run(...args);
  } catch (err) {
    ui.menuMessage = { ok: false, text: err.message };
  }
  render();
};
const act = (body) => runAction(async () => {
  const { game: now, message } = await api("/api/action", body);
  ui.game = now;
  if (message) ui.menuMessage = { ok: true, text: message };
});
const closeMenu = () => {
  effects.push({ type: "close" });
};
const say = (text) => {
  ui.menuMessage = { ok: false, text };
  effects = effects.filter((one) => one.type !== "close");
  render();
};
// The pages of the registry printout that were menus once, and still have their names (SHEET_PAGES in public/app.js).
const SHEET_PAGES = { char: "record", character: "record", traits: "record", skills: "skills", perks: "perks", beliefs: "beliefs", dossier: "past", past: "past" };
// What a menu's button opens: a menu drawn here, or a window of Godot's own.
const kindOf = (menu) => (menu.board ? "board" : menu.editor ? "editor" : menu.window ? "window" : "menu");
function openMenu(id, focus = null) {
  if (SHEET_PAGES[id]) return effects.push({ type: "window", id: "sheet", page: SHEET_PAGES[id] });
  const menu = MENUS[id];
  if (!menu) return null;
  if (kindOf(menu) !== "menu") return effects.push({ type: "window", id });
  ui.tab = id;
  ui.menuFocus = focus;
  ui.menuMessage = null;
  return render();
}
async function loadGame(slot) {
  const { game: now, saves } = await api("/api/load", { slot });
  ui.game = now;
  ui.saves = saves;
  effects.push({ type: "close" }, { type: "reload" });
}

initMenus({
  ui,
  act,
  runAction,
  renderMenus: render,
  reading: {},
  changeReading: () => {},
  textSizes: { min: 13, max: 26 },
  toggleFullScreen: () => effects.push({ type: "fullscreen" }),
  loreCatalog,
  loadGame,
  toTitle: () => {},
  openMenu,
  startSim: () => say(`The simulator ${NOT_YET}`),
  startPractice: () => say(`Practice ${NOT_YET}`),
  // A lead taken up is the story's to tell: Godot sends it, as it sends a choice.
  followLead: (lead) => effects.push({ type: "close" }, { type: "chat", body: { text: `I look into this: ${lead.title}`, thread: lead.id } }),
});
initMap({ ui, render, runAction, renderMenus: render, openMenu, closeMenu });
initShip({ ui, render, runAction, renderMenus: render, openMenu, closeMenu });
initCommand({ ui, render, runAction, closeMenu, openPersonSheet: () => say(`Someone's registry printout ${NOT_YET}`) });
initWork({ ui, render, runAction });
initFreight({ ui });
initFreighters({ ui, renderMenus: render, closeMenu });
initRig({ ui, runAction, renderMenus: render });

// Settings, as they are for this window: how the browser's page reads, its size and its computers' screens are the
// browser's own, so what's here is what's the game's (saved games, how hard enemies fight, the files) and Godot's.
const section = (title, ...children) => el("section", { class: "menu-section" }, title && el("h3", {}, title), children);
const fileEntry = (label, where) => el("div", { class: "menu-entry small" }, label, el("span", { class: "muted" }, where));
function settingsMenu() {
  const g = ui.game;
  return columns(
    section("Saved games",
      ["slot1", "slot2", "slot3"].map((slot) => {
        const save = ui.saves.find((one) => one.slot === slot);
        return el("div", { class: "menu-row small" },
          el("span", {}, `Slot ${slot.slice(-1)}: `, !save || save.empty ? el("span", { class: "muted" }, "empty") : `${save.name}, level ${save.level}`),
          el("span", { class: "row" },
            el("button", { onclick: runAction(async () => {
              ui.saves = (await api("/api/save", { slot })).saves;
              ui.menuMessage = { ok: true, text: `Saved to slot ${slot.slice(-1)}.` };
            }) }, "Save"),
            save && !save.empty && el("button", { onclick: runAction(() => loadGame(slot)) }, "Load")));
      }),
      el("div", { class: "muted small" }, "The game also saves by itself as you play. A new game is started from the screen this window opens on when no game is open.")),
    section("This window",
      el("div", { class: "row small" }, "Full screen:", el("button", { onclick: () => effects.push({ type: "fullscreen" }) }, "Switch")),
      el("div", { class: "row small" }, "The game's own window:", el("button", { title: "Opens the game in your browser, on the same game", onclick: () => effects.push({ type: "browser" }) }, "Open it")),
      el("div", { class: "muted small" }, "F11 switches full screen too. What isn't in this window yet is done in the game's own window, and this one follows.")),
    section("Fights",
      el("div", { class: "row small" }, "How hard enemies fight:",
        [["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]].map(([id, label]) => el("button", {
          class: g.difficulty === id ? "primary" : "",
          "aria-pressed": String(g.difficulty === id),
          disabled: Boolean(g.combat),
          onclick: act({ action: "difficulty", id }),
        }, label))),
      el("div", { class: "muted small" }, "Stronger enemies get more health, hit more often and hit harder at Normal and Hard. Your followers stay the same. It applies from your next fight.")),
    folded("settings-files", "Your files",
      el("div", { class: "small" }, "The world is kept in files on this computer, inside the game's folder. You can open them with any text editor. If you change one, restart the game to see the change."),
      fileEntry(`${g.files.worldCharacters} important characters`, `${g.files.world}\\characters`),
      fileEntry(`${g.enemiesTotal - g.files.campaignEnemies} enemy types`, `${g.files.world}\\enemies`),
      fileEntry("The written story, which you can change while the game is running", `${g.files.world}\\scenes`)),
  );
}

// The buttons that open the menus, in their groups (menuButtons in public/app.js).
function railOf(g) {
  const alerts = { ship: g.role.captain ? g.ship.shortages.length : 0 };
  return MENU_GROUPS.map((group) => ({
    title: group.title,
    entries: group.ids.filter((id) => !MENUS[id].captainOnly || g.role.captain).map((id) => ({ id, label: MENUS[id].label, about: MENUS[id].about, kind: kindOf(MENUS[id]), ...(alerts[id] ? { alert: alerts[id] } : {}) })),
  })).filter((group) => group.entries.length);
}

// The game as it stands, asked of the game the way the page asks. The list of saves is every save read from the disk,
// so it's only asked for where it's shown, and what never changes is asked for once.
async function refresh() {
  const data = await api(`/api/godot/game?${ui.setup ? "" : "setup&"}${ui.tab === "settings" || !ui.saves.length ? "saves" : ""}`);
  ui.game = data.game;
  ui.saves = data.saves ?? ui.saves;
  ui.setup = data.setup ?? ui.setup;
}

// The menu as it's handed over: its tree, and the elements Godot can send a click or typed words to, by number. Each
// build has a number too, so a click on a menu that's since been built again is never taken for another button.
let root = null;
let ids = [];
let serial = 0;
let last = "";
function build() {
  setStoryContext(ui.setup, ui.game);
  const menu = MENUS[ui.tab] ?? MENUS.leads;
  root = el("div", { class: "menu-body" }, ui.tab === "settings" ? settingsMenu() : menu.view());
  stale = false;
}
function handOver({ ifChanged = false } = {}) {
  ids = [];
  const tree = describe(root, ids);
  const menu = MENUS[ui.tab] ?? MENUS.leads;
  const page = { game: true, menu: ui.tab, label: menu.label, message: ui.menuMessage, tree, rail: railOf(ui.game) };
  const text = JSON.stringify(page);
  const out = effects;
  effects = [];
  if (ifChanged && text === last && !out.length) return { game: true, same: true, of: serial };
  last = text;
  serial += 1;
  return { ...page, of: serial, effects: out };
}

async function answer(ask) {
  if (ask.op === "open" || ask.op === "look" || !ui.game) {
    await refresh();
    if (!ui.game) return { game: false };
    if (ask.op === "open") {
      openMenu(ask.menu, ask.focus ?? null);
      if (ui.tab === "settings") await refresh();
    }
    build();
    return handOver({ ifChanged: ask.op === "look" });
  }
  if (ask.op === "rail") {
    await refresh();
    return ui.game ? { game: true, rail: railOf(ui.game) } : { game: false };
  }
  const node = ask.of === serial ? ids[ask.id] : null;
  if (node && !node.disabled) {
    if (ask.op === "input") {
      node.value = String(ask.value ?? "");
      await fire(node, "input");
    } else if (ask.op === "click") {
      await fire(node, "click");
    }
  }
  if (stale || !node) build();
  return handOver();
}

// One thing at a time, in the order asked.
let turn = Promise.resolve();
parentPort.on("message", ({ n, ask }) => {
  turn = turn.then(async () => {
    let reply;
    try {
      reply = await answer(ask);
    } catch (err) {
      reply = { error: err?.message ?? String(err) };
    }
    parentPort.postMessage({ n, reply });
  });
});
