// The game's menus, for the Godot view. What's inside each menu is worked out by the page's own code (public/menus.js
// and the files it uses), so a menu in Godot can never disagree with the same menu in the browser, and a menu changed
// there is changed here. That code builds a page's elements; here it builds them on a small stand-in for a page
// (src/mini-dom.js), on a thread of its own so that nothing it needs of a browser is ever seen by the game itself, and
// the tree of elements is handed to Godot to draw (godot/scripts/page.gd). A click in Godot comes back here as the
// number of the element clicked, and the element's own listener runs, sending its order to the game as the page does.

import { parentPort, workerData } from "node:worker_threads";
import { describe, Element, fire, makeDocument } from "./mini-dom.js";

// A page's surroundings, as far as the menus look at them. Orders go to the game this thread belongs to.
const game = `http://127.0.0.1:${workerData.port}`;
const send = globalThis.fetch;
globalThis.fetch = (url, init) => send(typeof url === "string" && url.startsWith("/") ? game + url : url, init);
globalThis.document = makeDocument();
// Nothing here is animated (Godot does its own moving), so the page's code is told the player wants less motion.
globalThis.matchMedia = (query) => ({ matches: /reduced-motion/.test(String(query)), addEventListener() {} });
// What the page's code set listening on the window is kept: Godot's window changing size is told to it (the Map
// editor fits its deck to the room there is).
const heard = {};
globalThis.window = {
  addEventListener: (type, run) => (heard[type] ??= []).push(run),
  removeEventListener: (type, run) => {
    heard[type] = (heard[type] ?? []).filter((one) => one !== run);
  },
  matchMedia: globalThis.matchMedia, innerWidth: 1400, innerHeight: 860, devicePixelRatio: 1,
};
const kept = new Map();
globalThis.localStorage = { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, String(value)), removeItem: (key) => kept.delete(key) };
globalThis.requestAnimationFrame = (run) => setTimeout(() => run(Date.now()), 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

// Something the page's code trips over away from a real screen (in a timer, say) must never stop the menus.
process.on("uncaughtException", (err) => console.error(`A page for the Godot view tripped: ${err?.message ?? err}`));
process.on("unhandledRejection", (err) => console.error(`A page for the Godot view tripped: ${err?.message ?? err}`));
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });

// How big a box on the Story board is, which the board's own code asks so as to stack its boxes: worked out the way
// Godot will lay the box out (godot/scripts/page.gd: the same widths, type sizes and wrapping, in a type whose
// letters are all one width), so the boxes are stacked by the heights they're drawn at.
const LETTER = 1200 / 2048;
const wordsWide = (text, size) => Math.ceil(String(text).length * LETTER * size);
// How many lines some words take: a name joined by underscores can go on to the next line after any of them.
function linesOf(text, size, wide, { most = Infinity, anywhere = false } = {}) {
  let lines = 0;
  for (const para of String(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    lines += 1;
    let x = 0;
    for (const word of words) {
      const bits = anywhere && word.includes("_") ? word.split(/(?<=_)/) : [word];
      bits.forEach((bit, n) => {
        const w = wordsWide(bit, size), gap = x > 0 && n === 0 ? wordsWide("0", size) : 0;
        if (x > 0 && x + gap + w > wide + 0.5) {
          lines += 1;
          x = w;
        } else x += gap + w;
      });
    }
  }
  return Math.min(lines, most);
}
Element.sizeOf = (node) => {
  const has = (name) => node.classList.contains(name);
  // The room the Map editor's deck has in Godot's window: all of it but the two columns beside the deck, where the
  // window is wide enough for them (godot/scripts/page.gd lays it out so).
  if (node.id === "mapedit-view") {
    const inner = window.innerWidth - 44;
    return { w: Math.max(300, inner >= 900 ? inner - 486 : inner), h: Math.max(200, window.innerHeight - 200) };
  }
  if (!has("board-node")) return null;
  const w = has("stub") ? 150 : has("fact") || has("link") ? 210 : has("clock") || has("next") || has("react") ? 250 : 230;
  const inner = w - 16;
  const parts = node.childNodes.filter((child) => child.nodeType === 1);
  let h = 13 + 2 * Math.max(0, parts.length - 1);
  for (const part of parts) {
    // What a box is, with an ending's name after it; its name; when it holds; and its words, four lines of them
    // unless it's the box that's picked.
    if (part.classList.contains("kind")) h += 15 * linesOf(part.childNodes.map((one) => one.textContent).join(" "), 10, inner, { anywhere: true });
    else if (part.classList.contains("name")) h += 21 * linesOf(part.textContent, 14, inner, { anywhere: true });
    else if (part.classList.contains("when")) h += 14 * linesOf(part.textContent, 11, inner, { anywhere: true });
    else h += 16 * linesOf(part.textContent, 12, inner, { most: has("selected") ? 40 : 4 });
  }
  return { w, h };
};

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
const { initSheet, openPersonSheet, openSheetAt, resetSheet, sheetNode } = await import("../public/sheet.js");
const { endingNode, initEnding } = await import("../public/ending.js");
const { creatorScreen, initCreator, openCreator, resetCreator } = await import("../public/creator.js");
const { computerNode, initComputer, resetComputer } = await import("../public/computer.js");
const { fightNode, initFight, resetFight, startSim } = await import("../public/fight.js");
const { closeBoard, openBoard } = await import("../public/board.js");
const { closeMapEditor, openMapEditor } = await import("../public/mapedit.js");
const { loadPack } = await import("../public/pixel-art.js");
const { drawQuests, initQuests, openQuests, questTrackerNode, questsOpen, resetQuests } = await import("../public/quests.js");

// What the page keeps about itself (ui in public/app.js), as far as the menus read it.
const ui = { game: null, saves: [], setup: null, screen: "game", tab: "leads", sideOpen: false, streaming: false, waiting: false, menuFocus: null, peopleFilter: "all", mapSelected: null, codexSearch: "", menuMessage: null };
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

// Practising a skill opens its check window, which Godot shows as it shows any check; the printout gets out of its way.
const startPractice = (skill, difficulty = "moderate") => runAction(async () => {
  await api("/api/check/start", { practice: skill, difficulty });
  effects.push({ type: "close" });
})();

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
  toTitle: () => effects.push({ type: "close" }, { type: "title" }),
  openMenu,
  startSim: (enemy, followers) => runAction(() => startSim(enemy, followers))(),
  startPractice,
  // A lead taken up is the story's to tell: Godot sends it, as it sends a choice.
  followLead: (lead) => effects.push({ type: "close" }, { type: "chat", body: { text: `I look into this: ${lead.title}`, thread: lead.id } }),
});
initMap({ ui, render, runAction, renderMenus: render, openMenu, closeMenu });
initShip({ ui, render, runAction, renderMenus: render, openMenu, closeMenu });
initCommand({ ui, render, runAction, closeMenu, openPersonSheet: (key) => effects.push({ type: "window", id: "sheet", person: key }) });
initWork({ ui, render, runAction });
initFreight({ ui });
initFreighters({ ui, renderMenus: render, closeMenu });
initRig({ ui, runAction, renderMenus: render });
// The registry printout, the page a game ends on, and the making of a captain: the page's own, like the menus.
initSheet({ ui, render, act, openMenu, startPractice });
initEnding({ ui, render, loadGame, toTitle: () => effects.push({ type: "title" }), newGame: async () => effects.push({ type: "creator" }) });
// A fight that isn't fought in the room (the simulator's, one aboard another ship): the game's fight window. Godot
// plays a fight in the room itself (fight.gd), and only asks for this window when one isn't.
initFight({ ui, render, sendChat: (body) => effects.push({ type: "close" }, { type: "chat", body }), openMenu, closeMenu, inRoom: () => false });
// The quest log: the tracker in the room's corner, grown.
initQuests({ ui, render, placed: () => {} });
// A computer the player is at: its desktop, or a panel's own face, with the rig beside it.
initComputer({ ui, render, openMenu });
initCreator({
  render,
  begin: async (draft) => {
    const { game: now, saves } = await api("/api/new", { draft });
    ui.game = now;
    ui.saves = saves;
    resetCreator();
    effects.push({ type: "close" }, { type: "reload" });
  },
  hasGame: () => Boolean(ui.game),
  exit: () => effects.push({ type: "title" }),
});

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

// What Godot is handed: a tree, and the elements it can send a click or typed words to, by number. There's one for
// each thing the page draws for Godot (the open menu, the registry printout, the ending's page, the making of a
// captain), each with a number of its own for every time it's built, so a click on one that's since been built again
// is never taken for another button.
const surfaces = {};
const builders = {
  menu: () => el("div", { class: "menu-body" }, ui.tab === "settings" ? settingsMenu() : (MENUS[ui.tab] ?? MENUS.leads).view()),
  sheet: () => sheetNode(),
  ending: () => endingNode(),
  creator: () => creatorScreen(),
  computer: () => computerNode(),
  quests: () => (questsOpen() ? questTrackerNode() : null),
  fight: () => fightNode(),
  // The Story board puts itself on the page and draws itself there: what's there is what's handed over.
  board: () => document.getElementById("board"),
  // So does the Map editor, whose plan of a deck is a picture it draws a shape at a time.
  mapedit: () => document.getElementById("mapedit"),
};
// What's put right in one of them each time it's handed over, because the page's code draws it afresh.
const tidies = {
  // Choosing among the packs' pictures is a window of the page's that isn't in Godot yet.
  mapedit: () => {
    for (const id of ["mapedit-choose", "mapedit-pieces", "mapedit-look-toggle"]) {
      const button = document.getElementById(id);
      if (button) button.hidden = true;
    }
  },
};
// What's drawn into one of them only once it's on the page.
const fills = { quests: drawQuests };
// What opening each of them does first.
const opens = {
  menu: async (ask) => {
    openMenu(ask.menu, ask.focus ?? null);
    if (ui.tab === "settings") await refresh();
  },
  sheet: async (ask) => {
    resetSheet();
    if (ask.person) await openPersonSheet(ask.person);
    else openSheetAt(ask.page ?? "record");
  },
  ending: async () => {},
  computer: async () => {},
  fight: async () => {},
  board: async () => {
    closeBoard();
    await openBoard();
    // The line along the bottom says how the board is worked, and here boxes aren't dragged about or onto each other.
    document.getElementById("board")?.querySelector(".board-foot")?.replaceChildren(
      el("span", {}, "Click a box to read and change it."),
      el("span", {}, "Click the words on an arrow to change when it applies."),
      el("span", {}, "Drag the dark background, or turn the wheel, to look around."),
    );
  },
  mapedit: async () => {
    closeMapEditor();
    // The room as the game will draw it, under the plan, is a picture made in a browser: there's only the plan here.
    localStorage.setItem("meridian-mapedit-look", "off");
    // The packs' pieces that are furniture, so the ones already on a deck are on its plan.
    await loadPack();
    await openMapEditor();
  },
  quests: async () => {
    resetQuests();
    openQuests();
  },
  creator: async () => {
    resetCreator();
    await openCreator(ui.setup);
  },
};
function build(on) {
  if (ui.game) setStoryContext(ui.setup, ui.game);
  const surface = (surfaces[on] ??= { root: null, ids: [], serial: 0, last: "", holder: document.body.appendChild(document.createElement("div")) });
  surface.root = builders[on]() ?? null;
  // On the page, so that the page's own code finds its elements where it looks for them.
  surface.holder.replaceChildren(...(surface.root ? [surface.root] : []));
  if (surface.root) fills[on]?.();
  stale = false;
  return surface;
}
function handOver(on, { ifChanged = false } = {}) {
  const surface = surfaces[on];
  surface.ids = [];
  const out = effects;
  effects = [];
  // Nothing to show: it was put away, or what it was about is over.
  if (!surface.root || surface.root.hidden) return { game: Boolean(ui.game), on, closed: true, effects: out };
  tidies[on]?.();
  const tree = describe(surface.root, surface.ids);
  const menu = MENUS[ui.tab] ?? MENUS.leads;
  const page = on === "menu" ? { game: true, on, menu: ui.tab, label: menu.label, message: ui.menuMessage, tree, rail: railOf(ui.game) } : { game: Boolean(ui.game), on, tree, message: on === "sheet" ? ui.menuMessage : null };
  const text = JSON.stringify(page);
  if (ifChanged && text === surface.last && !out.length) return { game: page.game, on, same: true, of: surface.serial };
  surface.last = text;
  surface.serial += 1;
  return { ...page, of: surface.serial, effects: out };
}

async function answer(ask) {
  const on = builders[ask.on] ? ask.on : "menu";
  // How big Godot's window is, when it says: what's fitted to the window is fitted again.
  if (ask.wide && ask.high && (ask.wide !== window.innerWidth || ask.high !== window.innerHeight)) {
    Object.assign(window, { innerWidth: Number(ask.wide), innerHeight: Number(ask.high) });
    for (const run of heard.resize ?? []) {
      try {
        run({ type: "resize" });
      } catch {
        // Not this listener's window.
      }
    }
  }
  if (ask.op === "rail") {
    // A game opened or begun in Godot: what the page's code remembered of the one before is let go, as the page does.
    if (ask.reset) {
      resetComputer();
      resetSheet();
      resetCreator();
      resetQuests();
      resetFight();
      Object.assign(ui, { menuMessage: null, menuFocus: null, mapSelected: null });
      for (const surface of Object.values(surfaces)) Object.assign(surface, { root: null, ids: [], last: "" });
    }
    await refresh();
    return ui.game ? { game: true, rail: railOf(ui.game) } : { game: false };
  }
  if (ask.op === "open" || ask.op === "look" || (!ui.game && on !== "creator")) {
    await refresh();
    if (!ui.game && on !== "creator") return { game: false };
    if (ask.op === "open") await opens[on](ask);
    build(on);
    return handOver(on, { ifChanged: ask.op === "look" });
  }
  const surface = surfaces[on];
  // A key, for the page's own listeners (H takes the rig out at a computer, Esc logs off).
  if (ask.op === "key" && surface) {
    await document.press({ key: String(ask.key) });
    // What a key sets going (an order to the game) is waited for a moment before the page is handed back.
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (stale) build(on);
    else surface.root = surface.holder.childNodes[0] ?? null;
    return handOver(on);
  }
  const node = surface && ask.of === surface.serial ? surface.ids[ask.id] : null;
  if (node && !node.disabled) {
    if (ask.op === "input") {
      node.value = String(ask.value ?? "");
      node.checked = ask.value === "true";
      // A list to pick from and a box to tick say they've changed; a box to type in says so as it's typed in.
      for (const type of ["input", "change"]) if (node.listeners[type]?.length) await fire(node, type, { target: node });
    } else if (ask.op === "pointer") {
      // The pointer on a picture the page draws (the Map editor's deck): down, across it, and up again.
      for (const [how, x, y] of ask.events ?? []) await fire(node, `pointer${how}`, { clientX: Number(x), clientY: Number(y), button: 0, pointerId: 1 });
    } else if (ask.op === "click" && on === "board") {
      // The Story board listens on the page itself for the pointer going down on a box and coming up again.
      await document.send("pointerdown", { target: node });
      await document.send("pointerup", { target: node });
      await fire(node, "click");
      await document.send("click", { target: node });
    } else if (ask.op === "click") {
      // What the page opens on a double click (an icon on a desktop), Godot opens on one.
      await fire(node, node.listeners.dblclick?.length ? "dblclick" : "click");
    }
  }
  if (stale || !node) build(on);
  // What the page's own code has drawn again in place (a computer redraws itself) is what's there now.
  else surface.root = surface.holder.childNodes[0] ?? null;
  return handOver(on);
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
