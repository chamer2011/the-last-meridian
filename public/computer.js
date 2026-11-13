// The computer window: a computer the player has got into, drawn as Keelworks 4.1, a made-up shipyard desktop of about
// 1999, on an old monitor floating over the room. The game on the server holds everything and decides everything; this
// draws what it says and sends what's clicked. What's on the computer are folders on the desktop (Systems, Files, Mail,
// Logs, Programs, Network) that open in a window; what's opened shows in a second window; a third keeps the session's
// log; the taskbar has the menu, the windows, the watcher's eye on a hacked computer, and the clock. Windows are dragged
// by their title bars; the monitor's frame pulls the whole thing aside. The advisor's hints sit beside the monitor.
// Skin and the old screen's strength are Settings choices (desktop.css). Nothing here needs typing.

import { api, el } from "./dom.js";
import { leaderNode, pullable } from "./float.js";

const comp = { id: null, view: null, sending: false, message: null, seen: 0, advisor: true };

// What the window needs from the main screen. Set once, when the page loads.
let app;

const ADVISOR_KEY = "meridian-advisor";

export function initComputer(hooks) {
  app = hooks;
  // This listens first, so that Esc closes a menu over the window before it logs off.
  document.addEventListener("keydown", onKey, true);
  try {
    comp.advisor = localStorage.getItem(ADVISOR_KEY) !== "off";
  } catch {
    comp.advisor = true;
  }
}

export const computerOpen = () => Boolean(app?.ui.game?.computer);

// Where the desktop's windows start, on its 640 by 480 screen (the taskbar takes the bottom 28).
const startWindows = () => ({
  list: { x: 92, y: 12, w: 270, h: 250, open: false },
  view: { x: 250, y: 30, w: 380, h: 300, open: true },
  log: { x: 92, y: 300, w: 330, h: 140, open: true },
});

export function resetComputer() {
  Object.assign(comp, { id: null, view: null, sending: false, message: null, seen: 0, wins: startWindows(), z: { log: 10, list: 11, view: 12 }, top: "view", folder: null, sel: null, menu: false, screenKey: "", hushed: -1 });
}
resetComputer();

const screenKey = (screen) => `${screen?.kind}|${screen?.id ?? ""}|${screen?.title ?? ""}`;

function sync() {
  const live = app.ui.game?.computer ?? null;
  if (!live) {
    resetComputer();
    return;
  }
  if (live.id !== comp.id) {
    resetComputer();
    comp.id = live.id;
    comp.screenKey = screenKey(live.screen);
  }
  // Something new opened: the viewer comes up in front with it.
  const key = screenKey(live.screen);
  if (key !== comp.screenKey) {
    comp.screenKey = key;
    comp.wins.view.open = true;
    raise("view");
  }
  comp.view = live;
}

// ---- Talking to the server ----------------------------------------------

async function send(body) {
  if (comp.sending || !comp.view) return;
  comp.sending = true;
  comp.message = null;
  comp.seen = comp.view.log.length;
  comp.menu = false;
  try {
    const reply = await api("/api/computer", body);
    app.ui.game = reply.game;
    comp.sending = false;
    if (reply.said) comp.message = reply.said;
    // The whole page, because logging off, being thrown out, or reaching for another computer changes more than this window.
    app.render();
  } catch (err) {
    comp.sending = false;
    comp.message = err.message;
    draw();
  }
}

const logOff = () => send({ action: "logoff" });

function toggleAdvisor() {
  comp.advisor = !comp.advisor;
  try {
    localStorage.setItem(ADVISOR_KEY, comp.advisor ? "on" : "off");
  } catch {
    // It still works, it just won't remember.
  }
  draw();
}

// ---- Little pictures, sixteen squares a side ------------------------------

const r = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
const PICTURES = {
  folder: r(1, 4, 6, 2, "#222") + r(1, 5, 14, 9, "#222") + r(2, 6, 12, 7, "#e8c35a") + r(2, 5, 4, 1, "#e8c35a"),
  mail: r(1, 3, 14, 10, "#222") + r(2, 4, 12, 8, "#fff") + r(3, 5, 2, 1, "#888") + r(5, 6, 2, 1, "#888") + r(7, 7, 2, 1, "#888") + r(9, 6, 2, 1, "#888") + r(11, 5, 2, 1, "#888") + r(10, 9, 3, 2, "#c33"),
  log: r(3, 1, 10, 14, "#222") + r(4, 2, 8, 12, "#f4f0d8") + r(5, 4, 6, 1, "#557") + r(5, 6, 6, 1, "#557") + r(5, 8, 5, 1, "#557") + r(5, 10, 6, 1, "#c33") + r(5, 12, 4, 1, "#557"),
  exe: r(1, 2, 14, 12, "#222") + r(2, 3, 12, 10, "#ddd") + r(2, 3, 12, 2, "#0b2a6b") + r(4, 7, 8, 1, "#888") + r(4, 9, 6, 1, "#888"),
  systems: r(2, 2, 12, 12, "#222") + r(3, 3, 10, 10, "#5a6b75") + r(4, 5, 3, 3, "#ffd84a") + r(9, 5, 3, 3, "#3c3") + r(4, 10, 8, 1, "#c33"),
  network: r(0, 3, 7, 6, "#222") + r(1, 4, 5, 4, "#3a7bd5") + r(9, 3, 7, 6, "#222") + r(10, 4, 5, 4, "#3a7bd5") + r(3, 9, 1, 3, "#222") + r(12, 9, 1, 3, "#222") + r(3, 12, 10, 1, "#222"),
  txt: r(3, 1, 10, 14, "#222") + r(4, 2, 8, 12, "#fff") + r(5, 4, 6, 1, "#999") + r(5, 6, 6, 1, "#999") + r(5, 8, 6, 1, "#999"),
  keel: r(1, 9, 14, 2, "#222") + r(2, 11, 12, 2, "#2a6f9e") + r(4, 13, 8, 1, "#1d4f73") + r(7, 2, 1, 7, "#222") + r(8, 3, 5, 5, "#f2f2f2") + r(8, 3, 1, 5, "#c33"),
  eye: r(2, 6, 12, 4, "#222") + r(3, 5, 10, 6, "#fff") + r(6, 5, 4, 6, "#2a6f9e") + r(7, 7, 2, 2, "#000") + r(4, 4, 8, 1, "#222") + r(4, 11, 8, 1, "#222"),
};
function picture(name) {
  const box = document.createElement("template");
  box.innerHTML = `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${PICTURES[name] ?? PICTURES.txt}</svg>`;
  return box.content.firstChild;
}

// ---- What's on the computer ---------------------------------------------------

// Each folder: what it's called, its picture, the view's list, and what clicking one of its things asks the server.
const FOLDERS = [
  ["systems", "Systems", "systems", "show"],
  ["files", "Files", "folder", "file"],
  ["mail", "Mail", "mail", "mail"],
  ["logs", "Logs", "log", "log"],
  ["programs", "Programs", "exe", "program"],
  ["network", "Network", "network", "connect"],
];
const foldersHere = (view) => FOLDERS.filter(([id]) => (view[id] ?? []).length > 0);

const lineNode = (entry, isNew = false) => {
  if (entry.you !== undefined) return el("div", { class: `check-line you${isNew ? " new" : ""}` }, el("span", { class: "tone-dim" }, `${comp.view?.prompt ?? ">"} `), el("span", { class: "tone-bright" }, entry.you));
  return el("div", { class: `check-line tone-${entry.tone ?? "info"}${isNew ? " new" : ""}` }, entry.text);
};

// One system: each part's state, what a camera sees, and the buttons that switch things from here.
function systemScreen(view, screen) {
  const system = view.systems?.find((one) => one.id === screen.id);
  if (!system) return [el("div", { class: "computer-screen-title" }, screen.title ?? "Systems"), el("div", { class: "tone-dim" }, "This computer doesn't run that any more.")];
  return [
    el("div", { class: "computer-screen-title" }, system.title),
    system.note && el("div", { class: `tone-${/let go|No power/.test(system.note) ? "warn" : "dim"}` }, system.note),
    el("div", { class: "computer-rows" }, system.rows.map((row) => el("div", { class: `computer-row${row.works ? "" : " down"}` },
      el("div", { class: "computer-row-head" },
        el("span", { class: "tone-bright" }, row.name),
        el("span", { class: `tone-${row.word === "ringing" ? "bad" : row.works ? "good" : "warn"}` }, row.word.toUpperCase())),
      row.detail && el("div", { class: "tone-dim" }, row.detail),
      row.feed && el("div", { class: "tone-dim" }, row.feed.length ? `On camera: ${row.feed.join(", ")}` : "On camera: nobody"),
      row.actions.length > 0 && el("div", { class: "computer-row-actions" }, row.actions.map((action) => el("button", {
        disabled: comp.sending,
        onclick: (event) => {
          event.stopPropagation();
          send({ action: "system", system: system.id, row: row.id, to: action.to });
        },
      }, action.label)))))),
  ];
}

function listScreen(title, items, kind, empty) {
  return [
    el("div", { class: "computer-screen-title" }, title),
    items.length
      ? items.map((item) => el("div", { class: "check-line" }, el("button", { disabled: comp.sending, onclick: (event) => { event.stopPropagation(); send({ action: kind, id: item.id }); } }, item.name), item.about && el("span", { class: "tone-dim" }, `  ${item.about}`)))
      : el("div", { class: "tone-dim" }, empty),
  ];
}

// The register of everyone aboard: a table, sorted by whichever heading was clicked last, the same heading again
// turning it round. How they are sorts the dead first, then the laid up, the seriously sick, the sick and the well.
function registerScreen(screen) {
  const table = screen.table;
  if (!table) return [el("div", { class: "computer-screen-title" }, screen.title ?? ""), el("div", { class: "tone-dim" }, "The register is empty.")];
  const sort = comp.registerSort ?? { column: 4, down: false };
  const key = (row) => (sort.column === 4 ? row[5] : row[sort.column]);
  const rows = [...table.rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    const by = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return (sort.down ? -by : by) || String(a[0]).localeCompare(String(b[0]));
  });
  const heading = (name, i) => el("button", {
    class: `register-heading${sort.column === i ? " sorted" : ""}`,
    title: `Sort by ${name.toLowerCase()}`,
    onclick: (event) => {
      event.stopPropagation();
      comp.registerSort = { column: i, down: sort.column === i ? !sort.down : false };
      draw();
    },
  }, `${name}${sort.column === i ? (sort.down ? " v" : " ^") : ""}`);
  const tone = (order) => ["bad", "warn", "bad", "warn", "info"][order] ?? "info";
  return [
    el("div", { class: "computer-screen-title" }, screen.title ?? ""),
    el("div", { class: "tone-dim" }, table.summary),
    el("div", { class: "register-table", role: "table" },
      el("div", { class: "register-row register-head", role: "row" }, table.columns.map(heading)),
      rows.map((row) => el("div", { class: `register-row tone-${tone(row[5])}`, role: "row" }, row.slice(0, 5).map((cell) => el("span", { role: "cell" }, String(cell)))))),
  ];
}

function screenNode(view) {
  const { screen } = view;
  switch (screen.kind) {
    case "home":
      return [
        el("div", { class: "computer-screen-title" }, view.name),
        el("div", {}, view.desc),
        el("div", { class: "tone-dim" }, `${view.files.length} files, ${view.mail.length} letters, ${view.logs.length} logs, ${view.programs.length} programs${view.network.length ? `, ${view.network.length} on the network` : ""}. Open a folder on the desktop.`),
        view.systems?.length > 0 && el("div", { class: "tone-dim" }, `It runs ${view.systems.map((one) => one.title.toLowerCase()).join(", ")} here.`),
      ];
    case "mail": return listScreen("Mail", view.mail, "mail", "No letters.");
    case "logs": return listScreen("Logs", view.logs, "log", "No logs.");
    case "network": return listScreen("Network", view.network, "connect", "Nothing reachable from here.");
    case "system": return systemScreen(view, screen);
    case "register": return registerScreen(screen);
    default:
      return [
        el("div", { class: "computer-screen-title" }, screen.title ?? ""),
        (screen.lines ?? []).map((entry) => el("div", { class: `check-line tone-${entry.tone ?? "info"}` }, entry.text)),
      ];
  }
}

// ---- The desktop ------------------------------------------------------------------

function raise(id) {
  comp.top = id;
  comp.z[id] = Math.max(...Object.values(comp.z)) + 1;
}

function openFolder(id) {
  comp.folder = id;
  comp.wins.list.open = true;
  raise("list");
  draw();
}

function folderRows(view) {
  const folder = FOLDERS.find(([id]) => id === comp.folder);
  if (!folder) return [];
  const [id, , , kind] = folder;
  const { screen } = view;
  if (id === "systems") {
    return view.systems.map((system) => {
      const down = system.rows.filter((row) => !row.works).length;
      return el("button", { class: `row-item${screen.kind === "system" && screen.id === system.id ? " open" : ""}`, disabled: comp.sending, onclick: (event) => { event.stopPropagation(); send({ action: "show", id: system.id }); } },
        picture("systems"), el("span", {}, system.title), el("small", {}, down ? `${down} down` : `${system.rows.length} parts`));
    });
  }
  return view[id].map((item) => el("button", {
    class: `row-item${item.read || item.ran ? " done" : ""}${screen.kind === kind && screen.id === item.id ? " open" : ""}`,
    title: item.about ?? (item.ran ? "Already run" : item.read ? "Read" : item.name),
    disabled: comp.sending,
    onclick: (event) => {
      event.stopPropagation();
      send({ action: kind, id: item.id });
    },
  }, picture(id === "programs" ? "exe" : id === "mail" ? "mail" : id === "logs" ? "log" : id === "network" ? "network" : "txt"),
  el("span", {}, item.name),
  el("small", {}, item.ran ? "run" : item.read ? "read" : item.className ? `${item.className.toLowerCase()}${item.known ? ", open" : ""}` : "")));
}

function winNode(id, title, icon, body, status) {
  const w = comp.wins[id];
  if (!w.open) return null;
  return el("div", { class: `win bev${comp.top === id ? " top" : ""}`, "data-win": id, style: `left:${w.x}px;top:${w.y}px;width:${w.w}px;height:${w.h}px;z-index:${comp.z[id]}` },
    el("div", { class: "wtitle", "data-drag": id }, picture(icon), el("span", {}, title), el("button", { "aria-label": `Close ${title}`, onclick: (event) => { event.stopPropagation(); w.open = false; draw(); } }, "×")),
    el("div", { class: "body" }, body),
    status && el("div", { class: "status" }, status.map((text) => el("span", { class: "sunk" }, text))));
}

function clockText() {
  const hours = (((app.ui.game?.clock?.hours ?? 0) % 24) + 24) % 24;
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function osNode(view, watch, pct) {
  const here = foldersHere(view);
  const icons = el("div", { class: "icons" }, here.map(([id, name, pic]) => el("button", {
    class: `icon${comp.sel === id ? " sel" : ""}`,
    title: `${name}: ${(view[id] ?? []).length}`,
    onclick: (event) => {
      event.stopPropagation();
      if (comp.sel === id) openFolder(id);
      else {
        comp.sel = id;
        draw();
      }
    },
    ondblclick: (event) => { event.stopPropagation(); openFolder(id); },
  }, picture(pic), el("span", {}, `${name} (${(view[id] ?? []).length})`))));
  const folder = FOLDERS.find(([id]) => id === comp.folder);
  const list = folder && winNode("list", `${folder[1]} - ${view.name}`, folder[2], el("div", { class: "pane-in sunk" }, el("div", { class: "rows" }, folderRows(view))), [`${(view[folder[0]] ?? []).length} ${folder[0] === "mail" ? "letters" : "objects"}`, comp.sending ? "Working..." : "Click one to open it"]);
  const viewer = winNode("view", view.screen.kind === "home" ? `Welcome - ${view.name}` : view.screen.title ?? view.name, "txt", el("div", { class: "pane-in sunk viewer-in", id: "computer-screen" }, screenNode(view)), [view.hacked ? "Hacked" : view.yours ? "Yours" : "Logged in", view.className]);
  const log = winNode("log", "Session log", "log", el("div", { class: "pane-in sunk", id: "computer-console", role: "log" }, view.log.map((entry, i) => lineNode(entry, i >= comp.seen))), [`${view.actions} ${view.actions === 1 ? "action" : "actions"}`, view.prompt ?? ""]);
  const named = { list: list ? `${folder[1]}` : null, view: "Viewer", log: "Session log" };
  const tasks = el("div", { class: "tasks" }, Object.entries(comp.wins).filter(([id, w]) => w.open && named[id]).map(([id]) => el("button", { class: comp.top === id ? "on" : "", onclick: (event) => { event.stopPropagation(); raise(id); draw(); } }, named[id])));
  const menu = comp.menu && el("div", { class: "menu bev" }, el("div", { class: "side" }, "KEELWORKS 4.1"), el("div", { class: "items" },
    here.map(([id, name, pic]) => el("button", { onclick: (event) => { event.stopPropagation(); comp.menu = false; openFolder(id); } }, picture(pic), name)),
    el("hr"),
    el("button", { onclick: (event) => { event.stopPropagation(); comp.menu = false; comp.wins.log.open = true; raise("log"); draw(); } }, picture("log"), "Session log"),
    el("hr"),
    el("button", { onclick: (event) => { event.stopPropagation(); logOff(); } }, picture("keel"), "Log off")));
  const balloon = watch === "tracing" && comp.hushed !== view.trace && el("div", { class: "balloon", onclick: (event) => { event.stopPropagation(); comp.hushed = view.trace; draw(); } }, el("b", {}, picture("eye"), "AuditGuard"), `This session is being traced: ${pct}%.`);
  const taskbar = el("div", { class: "taskbar bev" },
    el("button", { class: "keel", "aria-expanded": String(comp.menu), onclick: (event) => { event.stopPropagation(); comp.menu = !comp.menu; draw(); } }, picture("keel"), "Keel"),
    tasks,
    el("div", { class: "tray sunk" },
      watch && el("span", { class: `watch ${watch}`, title: `AuditGuard: the trace is at ${pct}%` }, picture("eye")),
      watch && el("span", {}, `${pct}%`),
      el("span", { title: "The ship's time" }, clockText())));
  const os = el("div", { class: "os", onclick: () => { if (comp.menu) { comp.menu = false; draw(); } } }, icons, list, viewer, log, balloon, taskbar, menu);
  os.addEventListener("pointerdown", dragWindow);
  return os;
}

// A window comes to the front when it's pressed, and moves with its title bar, without redrawing until it's let go,
// so a click on something in it still lands.
function dragWindow(event) {
  const win = event.target.closest?.("[data-win]");
  if (!win) return;
  const id = win.dataset.win;
  if (comp.top !== id) {
    raise(id);
    win.style.zIndex = comp.z[id];
    for (const other of win.parentElement.querySelectorAll("[data-win]")) other.classList.toggle("top", other === win);
  }
  const bar = event.target.closest("[data-drag]");
  if (!bar || event.target.closest("button") || event.button !== 0) return;
  event.preventDefault();
  const w = comp.wins[id];
  const glass = win.closest(".glass");
  const scale = (glass?.clientWidth ?? 640) / 640;
  const start = { x: event.clientX, y: event.clientY, wx: w.x, wy: w.y };
  bar.setPointerCapture(event.pointerId);
  const move = (m) => {
    w.x = Math.round(Math.max(-w.w + 60, Math.min(600, start.wx + (m.clientX - start.x) / scale)));
    w.y = Math.round(Math.max(0, Math.min(430, start.wy + (m.clientY - start.y) / scale)));
    win.style.left = `${w.x}px`;
    win.style.top = `${w.y}px`;
  };
  const up = () => {
    bar.removeEventListener("pointermove", move);
    bar.removeEventListener("pointerup", up);
    bar.removeEventListener("pointercancel", up);
  };
  bar.addEventListener("pointermove", move);
  bar.addEventListener("pointerup", up);
  bar.addEventListener("pointercancel", up);
}

// The desktop is drawn at 640 by 480 and scaled to fit the glass.
const fitter = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
  for (const entry of entries) entry.target.style.setProperty("--s", String(entry.target.clientWidth / 640));
});

function advisorNode(view) {
  if (!view.hints?.length) return null;
  if (!comp.advisor) return el("button", { class: "desk-hints", title: "Bring the hints back", onclick: (event) => { event.stopPropagation(); toggleAdvisor(); } }, "HINTS");
  return el("aside", { class: "desk-advisor", id: "computer-advisor", "aria-label": "Hints" },
    el("header", {}, el("span", {}, `ADVISOR: ${view.tierName.toUpperCase()}`), el("button", { title: "Put the hints away", onclick: (event) => { event.stopPropagation(); toggleAdvisor(); } }, "x")),
    el("div", { class: "lines", id: "computer-hints" }, view.hints.map((text) => el("div", {}, text))));
}

function windowNode() {
  const view = comp.view;
  const pct = view.maxTrace ? Math.round((view.trace / view.maxTrace) * 100) : 0;
  const watch = !view.hacked ? null : pct >= 75 ? "tracing" : pct >= 50 ? "noticed" : "calm";
  const glass = el("div", { class: "glass" }, el("div", { class: "desk-screen" }, osNode(view, watch, pct)), el("div", { class: "fx scan" }), el("div", { class: "fx vig" }), el("div", { class: "fx glare" }), el("div", { class: "fx band" }));
  if (fitter) fitter.observe(glass);
  const monitor = el("div", { class: "monitor", title: "Pull the frame to move it aside" },
    comp.message && el("div", { class: "desk-note" }, comp.message),
    glass,
    el("div", { class: "plate" }, el("span", {}, "VARNE 15SX"), el("span", { class: `led${watch === "tracing" ? " bad" : watch === "noticed" ? " warn" : ""}` })));
  return el("div", { class: "desk", id: "computer-window", role: "dialog", "aria-label": view.name, tabindex: "-1" }, monitor, advisorNode(view));
}

// It floats over the room the way the check window does, with nothing dimmed behind it and the clock running on, can be
// pulled aside by the monitor's frame and slides back, and a line runs from it to what the player sat down at.
export function computerNode() {
  sync();
  if (!computerOpen()) return null;
  fitter?.disconnect();
  return el("div", { class: "check-float", id: "computer" }, leaderNode(comp.view?.at), pullable(windowNode()));
}

function draw() {
  const node = computerNode();
  const current = document.getElementById("computer");
  if (current && node) current.replaceWith(node);
  focusComputer();
}

// Shows the latest in the session log. Nothing takes the keyboard: everything on the desktop is clicked.
export function focusComputer() {
  const console = document.getElementById("computer-console");
  if (console) console.scrollTop = console.scrollHeight;
}

function onKey(event) {
  if (app.ui.screen !== "game" || !computerOpen() || app.ui.sideOpen || event.ctrlKey || event.metaKey || event.altKey) return;
  if (app.ui.game.combat || app.ui.game.check) return;
  if (event.key === "Escape") {
    if (comp.menu) {
      comp.menu = false;
      draw();
      return;
    }
    if (!comp.sending) logOff();
  }
}
