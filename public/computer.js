// The computer window: a computer the player has got into, drawn as Keelworks 4.1, a made-up shipyard desktop of about
// 1999, on an old monitor floating over the room. The game on the server holds everything and decides everything; this
// draws what it says and sends what's clicked. What's on the computer are folders on the desktop (Systems, Files, Mail,
// Logs, Programs, Network) that open in a window; what's opened shows in a second window; a third keeps the session's
// log; the taskbar has the menu, the windows, the watcher's eye on a hacked computer, and the clock. Windows are dragged
// by their title bars. The monitor and the player's rig beside it are two windows of their own, each dragged by its
// frame: the monitor slides back when it's let go, like the game's other floating windows, and the rig stays where it's
// put, with the lead between them following. The rig starts in the player's pocket: H, or the tab down the computer's
// side, takes it out, and H again, or AWAY on it, puts it back. It slides out from behind the computer's edge and back
// in (public/rig-motion.js).
// Skin and the old screen's strength are Settings choices (desktop.css). Nothing here needs typing. Since step 6 a
// computer can look like something else: a door's panel with its keypad, a junction box's service menu and a camera's
// feed on the rig's little screen, and NAVCOM 7, the Navy's desktop, for the ship's main system.

import { api, el, zoom } from "./dom.js";
import { leaderNode } from "./float.js";
import { SPRING_MS, makePullable, pulledBy } from "./pull.js";
import { NET_MAP, layOutNetMap } from "./net-layout.js";
import { LOAD_MS, loadingLines, loadingNode, navplotNode, newChartState } from "./navplot.js";
import { rigNextChange, rigPhase, rigTurned } from "./rig-motion.js";

const comp = { id: null, view: null, sending: false, message: null, seen: 0 };

// What the window needs from the main screen. Set once, when the page loads.
let app;


export function initComputer(hooks) {
  app = hooks;
  // This listens first, so that Esc closes a menu over the window before it logs off.
  document.addEventListener("keydown", onKey, true);
}

export const computerOpen = () => Boolean(app?.ui.game?.computer);

// Where the desktop's windows start, on its 640 by 480 screen (the taskbar takes the bottom 28).
const startWindows = () => ({
  list: { x: 92, y: 12, w: 270, h: 250, open: false },
  view: { x: 250, y: 30, w: 380, h: 300, open: true },
  log: { x: 92, y: 300, w: 330, h: 140, open: true },
});

export function resetComputer() {
  Object.assign(comp, { app: null, chart: null, id: null, view: null, sending: false, message: null, seen: 0, wins: startWindows(), z: { log: 10, list: 11, view: 12 }, top: "view", folder: null, sel: null, menu: false, screenKey: "", hushed: -1, rigTab: null, rigSlide: null, wasLocked: null, logSeen: 0, boot: null, rigOut: false, rigMove: null, woke: false });
}
resetComputer();

const screenKey = (screen) => `${screen?.kind}|${screen?.id ?? ""}|${screen?.title ?? ""}`;

// A door's panel, a junction box and a camera have no screen of their own: their face, and the player's rig beside it.
const PANEL_LOOKS = ["door", "service", "camera"];

function sync() {
  const live = app.ui.game?.computer ?? null;
  if (!live) {
    resetComputer();
    forgetMoves();
    return;
  }
  if (live.id !== comp.id) {
    // Where the computer and the rig were moved to is kept while going along the network, and forgotten at a computer
    // come to afresh.
    if (!live.reach?.remote) forgetMoves();
    // Going along the network keeps the rig out of the pocket, and its page out where it was folded away, to go on from
    // there. At a computer come to afresh the rig is in the pocket until the player takes it out (H), except for
    // practice, which is only there to be hacked.
    const slid = Boolean(comp.rigSlide) && Boolean(live.reach?.remote);
    const out = (comp.rigOut && Boolean(live.reach?.remote)) || Boolean(live.practice);
    resetComputer();
    comp.id = live.id;
    comp.screenKey = screenKey(live.screen);
    comp.logSeen = live.log?.length ?? 0;
    comp.rigOut = out;
    if (slid) comp.rigSlide = live.locked ? "prog" : "net";
  }
  if (comp.boot && !comp.sending && !live.reach?.ok) comp.boot = null;
  // Getting past a logon turns the rig to what it shows best: the programs at a logon, the map once inside.
  if (live.locked !== comp.wasLocked) {
    comp.wasLocked = live.locked;
    comp.rigTab = null;
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
  rig: r(2, 4, 12, 9, "#123d22") + r(3, 5, 10, 7, "#1f6b3a") + r(4, 6, 3, 2, "#ffd84a") + r(8, 9, 4, 2, "#9fd9a8") + r(3, 13, 1, 2, "#d8b040") + r(6, 13, 1, 2, "#d8b040") + r(9, 13, 1, 2, "#d8b040") + r(12, 13, 1, 2, "#d8b040"),
  eye: r(2, 6, 12, 4, "#222") + r(3, 5, 10, 6, "#fff") + r(6, 5, 4, 6, "#2a6f9e") + r(7, 7, 2, 2, "#000") + r(4, 4, 8, 1, "#222") + r(4, 11, 8, 1, "#222"),
  chart: r(1, 2, 14, 12, "#222") + r(2, 3, 12, 10, "#0b1c33") + r(2, 8, 12, 1, "#1b3a5c") + r(8, 3, 1, 10, "#1b3a5c") + r(4, 5, 1, 1, "#8fd18f") + r(11, 6, 1, 1, "#f2c14e") + r(6, 10, 1, 1, "#8fd18f") + r(5, 6, 1, 1, "#c8d6e8") + r(6, 7, 1, 1, "#c8d6e8") + r(8, 7, 1, 1, "#c8d6e8") + r(9, 6, 1, 1, "#c8d6e8") + r(10, 6, 1, 1, "#c8d6e8"),
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
];
const NAVCOM_FOLDERS = [
  ["shiplog", "Ship's log", "log", null],
  ["crew", "Crew", "txt", null],
];
// What a folder holds: the computer's own lists, the programs it has to copy onto the rig, and on NAVCOM 7 the ship's log
// and the crew assessments. The network and the rig's own programs are on the rig beside it.
const folderItems = (view, id) => (id === "programs" ? [...view.programs, ...(view.rig?.copies ?? []).map((one) => ({ ...one, copy: true }))] : id === "shiplog" ? view.device?.shipLog ?? [] : id === "crew" ? view.device?.crew?.list ?? [] : view[id] ?? []);
const allFolders = (view) => (view.look === "navcom" ? [...FOLDERS, ...NAVCOM_FOLDERS] : FOLDERS);
// An empty folder isn't shown, except a sealed crew file, which shows that it's sealed (step 9).
const foldersHere = (view) => allFolders(view).filter(([id]) => folderItems(view, id).length > 0 || (id === "crew" && view.device?.crew?.sealed));

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
  // What's opened (a file, a letter, a log, a program's words): its title and its lines.
  const opened = () => [
    el("div", { class: "computer-screen-title" }, screen.title ?? ""),
    (screen.lines ?? []).map((entry) => el("div", { class: `check-line tone-${entry.tone ?? "info"}` }, entry.text)),
  ];
  switch (screen.kind) {
    case "home":
      return [
        el("div", { class: "computer-screen-title" }, view.name),
        el("div", {}, view.desc),
        el("div", { class: "tone-dim" }, `${view.files.length} files, ${view.mail.length} letters, ${view.logs.length} logs, ${view.programs.length} programs. Open a folder on the desktop.`),
        view.systems?.length > 0 && el("div", { class: "tone-dim" }, `It runs ${view.systems.map((one) => one.title.toLowerCase()).join(", ")} here.`),
        view.through && el("div", { class: "through" }, `Reached through ${view.through.name}, which it trusts: from there it lets you ${view.through.words}${view.through.sealed ? ", and nothing else gets in" : ""}.`),
      ];
    // The list of letters, or one letter opened, which has its id and its lines.
    case "mail": return screen.id ? opened() : listScreen("Mail", view.mail, "mail", "No letters.");
    case "logs": return listScreen("Logs", view.logs, "log", "No logs.");
    case "network": return listScreen("Network", view.network, "connect", "Nothing reachable from here.");
    case "system": return systemScreen(view, screen);
    case "register": return registerScreen(screen);
    default: return opened();
  }
}

// ---- The logon ------------------------------------------------------------------

// A computer the player isn't past yet: Keelworks' logon box, and a line for whether a rig is on its port. What gets in
// is on the rig beside it, under D:, once it's connected.
function logonNode(view) {
  const reach = view.reach ?? {};
  const port = view.look === "navcom" ? "Navy port" : "cable port";
  const away = !comp.rigOut;
  const rigWords = reach.remote ? "Your rig reaches it over the network: what gets you in is on its D: page."
    : reach.ok ? `Your rig is on the ${port}: what gets you in is on its D: page${away ? ", once you take it out (H)" : ""}.`
    : reach.fits ? `No rig on the ${port}. ${away ? "Take out your rig (H) and connect it" : "Connect your rig"} to work on this logon.`
    : `No rig on the ${port}: ${reach.why}.`;
  return el("div", { class: "logon bev", role: "dialog", "aria-label": `Log on to ${view.name}` },
    el("div", { class: "banner" }, picture("keel"), el("div", {}, "Keelworks 4.1", el("small", {}, `${String(view.className).toUpperCase()} · ${view.practice ? "PRACTICE" : "LOGON"}`))),
    el("div", { class: "body" },
      el("div", { class: "grid2" },
        el("span", {}, "User name:"), el("span", { class: "field sunk" }),
        el("span", {}, "Password:"), el("span", { class: "field sunk" }),
        el("span", {}, "Log on to:"), el("span", { class: "field sunk" }, view.name)),
      el("div", { class: `logon-rig sunk${reach.ok ? " on" : ""}` }, el("i", { class: "plugdot" }), el("span", {}, rigWords)),
      view.hardened && el("div", { class: `logon-hard sunk${view.weak?.length ? " found" : ""}` }, el("b", {}, "HARDENED"),
        el("span", {}, view.weak?.length ? `No breaker works on it from the front. You know ${view.weak.join("; ")}.` : "No breaker works on it from the front. Its way in is written somewhere else here.")),
      el("div", { class: "logon-buttons" }, el("button", { disabled: comp.sending, onclick: (event) => { event.stopPropagation(); logOff(); } }, "Log off"))));
}

// The watcher's stage in words, for the tray and its balloon.
const watchWords = (watch) => (watch.stage === "tracing" ? `Tracing: ${watch.traceLeft} min` : watch.stage === "noticed" ? "Noticed" : "Calm");

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
  const folder = allFolders(view).find(([id]) => id === comp.folder);
  if (!folder) return [];
  const [id, , , kind] = folder;
  const { screen } = view;
  if (id === "shiplog") {
    return view.device.shipLog.map((entry) => el("div", { class: "row-item navcom-line" },
      el("span", {}, el("small", {}, entry.day), " ", entry.text),
      el("button", { disabled: comp.sending, title: "Strike this line from the ship's log", onclick: (event) => { event.stopPropagation(); send({ action: "device", id: `nav-strike:${entry.i}` }); } }, "Strike")));
  }
  if (id === "crew") {
    const crew = view.device.crew;
    if (crew.sealed) return [el("div", { class: "row-item navcom-head" }, el("span", {}, "CREW ASSESSMENTS · SEALED")), el("div", { class: "row-item sealed-note" }, el("span", {}, crew.sealed))];
    return [
      el("div", { class: "row-item navcom-head" }, el("span", {}, `CREW ASSESSMENTS · ${String(crew.by ?? "the first officer").toUpperCase()} · RESTRICTED`)),
      ...crew.list.map((one) => el("div", { class: "row-item" }, el("span", {}, one.name, el("small", {}, ` ${one.words}`)), el("small", {}, String(one.loyalty)))),
    ];
  }
  if (id === "systems") {
    return view.systems.map((system) => {
      const down = system.rows.filter((row) => !row.works).length;
      return el("button", { class: `row-item${screen.kind === "system" && screen.id === system.id ? " open" : ""}`, disabled: comp.sending, onclick: (event) => { event.stopPropagation(); send({ action: "show", id: system.id }); } },
        picture("systems"), el("span", {}, system.title), el("small", {}, down ? `${down} down` : `${system.rows.length} parts`));
    });
  }
  return folderItems(view, id).map((item) => item.copy ? el("button", { class: `row-item${item.why ? " done" : ""}`, title: item.why ? `Can't copy it: ${item.why}` : item.about, disabled: comp.sending || Boolean(item.why), onclick: (event) => { event.stopPropagation(); send({ action: "copy", id: item.id }); } },
    picture("rig"), el("span", {}, `Copy ${item.name} to your rig`), el("small", {}, item.why ? (/connected/.test(item.why) ? "connect first" : "can't reach") : "copy")) : el("button", {
    class: `row-item${item.read || item.ran ? " done" : ""}${screen.kind === kind && screen.id === item.id ? " open" : ""}`,
    title: item.about ?? (item.ran ? "Already run" : item.read ? "Read" : item.name),
    disabled: comp.sending,
    onclick: (event) => {
      event.stopPropagation();
      send({ action: kind, id: item.id });
    },
  }, picture(id === "programs" ? "exe" : id === "mail" ? "mail" : id === "logs" ? "log" : "txt"),
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

// ---- The chart program (public/navplot.js) ---------------------------------------------------------------------

// NAVCOM 7 on the plot table carries the ship's chart, the star map as a program. A Charts icon on its desktop opens
// it, behind a loading screen of about three seconds that a click skips, over the whole screen under the RESTRICTED
// bar. What's picked and plotted is kept while the computer stays open.
const hasCharts = (view) => !view.locked && Boolean(view.device?.charts);
const chartLoading = () => Boolean(comp.app) && !comp.app.ready && performance.now() - comp.app.at < LOAD_MS;
let loadTimer = 0;
function chartCtx(view = comp.view) {
  return {
    view,
    game: app.ui.game,
    st: comp.chart,
    sending: comp.sending,
    picture,
    draw,
    send,
    close: closeCharts,
    message: () => comp.message,
    // The same as it stands now, for what's drawn again a moment later, and whether this is still the program open.
    fresh: () => (comp.view && comp.app && hasCharts(comp.view) ? chartCtx(comp.view) : null),
    gone: (st) => !comp.app || comp.chart !== st || !document.getElementById("computer"),
  };
}
function openCharts() {
  comp.chart ??= newChartState();
  comp.app = { id: "charts", at: performance.now(), ready: false };
  comp.sel = null;
  clearInterval(loadTimer);
  loadTimer = setInterval(() => {
    if (!comp.app || comp.app.ready) {
      clearInterval(loadTimer);
      return;
    }
    if (!chartLoading()) {
      clearInterval(loadTimer);
      comp.app.ready = true;
      if (document.getElementById("computer")) draw();
      return;
    }
    const box = document.getElementById("navplot-load");
    if (box && comp.view && hasCharts(comp.view)) box.replaceChildren(...loadingLines(chartCtx(), performance.now() - comp.app.at));
  }, 100);
  draw();
}
function skipLoading() {
  if (!comp.app) return;
  comp.app.ready = true;
  clearInterval(loadTimer);
  draw();
}
function closeCharts() {
  comp.app = null;
  clearInterval(loadTimer);
  if (comp.chart) Object.assign(comp.chart, { menu: null, confirm: false, jump: null });
  draw();
}
function chartsIcon(view) {
  if (!hasCharts(view)) return null;
  return el("button", {
    class: `icon${comp.sel === "charts" ? " sel" : ""}`,
    title: "Navplot, the ship's chart: plot a course and order a jump",
    onclick: (event) => {
      event.stopPropagation();
      if (comp.sel === "charts") openCharts();
      else {
        comp.sel = "charts";
        draw();
      }
    },
    ondblclick: (event) => { event.stopPropagation(); openCharts(); },
  }, picture("chart"), el("span", {}, "Charts"));
}
function programNode(view) {
  if (!comp.app) return null;
  // Back at the logon, or let in for less than its programs: the program isn't there any more.
  if (!hasCharts(view)) {
    comp.app = null;
    return null;
  }
  comp.chart ??= newChartState();
  const ctx = chartCtx(view);
  return chartLoading() ? loadingNode(ctx, performance.now() - comp.app.at, skipLoading) : navplotNode(ctx);
}

function osNode(view, watch) {
  const navcom = view.look === "navcom";
  const here = view.locked ? [] : foldersHere(view);
  // How many are in a folder, or that it's sealed.
  const countOf = (id) => (id === "crew" && view.device?.crew?.sealed ? "sealed" : folderItems(view, id).length);
  const icons = el("div", { class: "icons" }, here.map(([id, name, pic]) => el("button", {
    class: `icon${comp.sel === id ? " sel" : ""}`,
    title: `${name}: ${countOf(id)}`,
    onclick: (event) => {
      event.stopPropagation();
      if (comp.sel === id) openFolder(id);
      else {
        comp.sel = id;
        draw();
      }
    },
    ondblclick: (event) => { event.stopPropagation(); openFolder(id); },
  }, picture(pic), el("span", {}, `${name} (${countOf(id)})`))), chartsIcon(view));
  const folder = allFolders(view).find(([id]) => id === comp.folder);
  const list = !view.locked && folder && winNode("list", `${folder[1]} - ${view.name}`, folder[2], el("div", { class: "pane-in sunk" }, el("div", { class: "rows" }, folderRows(view))), [`${folderItems(view, folder[0]).length} ${folder[0] === "mail" ? "letters" : "objects"}`, comp.sending ? "Working..." : folder[0] === "shiplog" ? "Strike a line to take it out" : folder[0] === "crew" ? (view.device?.crew?.sealed ? "Sealed" : "Restricted: the first officer's") : "Click one to open it"]);
  const viewer = !view.locked && winNode("view", view.screen.kind === "home" ? `Welcome - ${view.name}` : view.screen.title ?? view.name, "txt", el("div", { class: "pane-in sunk viewer-in", id: "computer-screen" }, screenNode(view)), [view.hacked ? "Hacked" : view.yours ? "Yours" : "Logged in", view.className]);
  const named = { list: list ? `${folder[1]}` : null, view: viewer ? "Viewer" : null };
  const tasks = el("div", { class: "tasks" }, Object.entries(comp.wins).filter(([id, w]) => w.open && named[id]).map(([id]) => el("button", { class: comp.top === id ? "on" : "", onclick: (event) => { event.stopPropagation(); raise(id); draw(); } }, named[id])));
  const menu = comp.menu && el("div", { class: "menu bev" }, el("div", { class: "side" }, navcom ? "NAVCOM 7" : "KEELWORKS 4.1"), el("div", { class: "items" },
    here.map(([id, name, pic]) => el("button", { onclick: (event) => { event.stopPropagation(); comp.menu = false; openFolder(id); } }, picture(pic), name)),
    hasCharts(view) && el("button", { onclick: (event) => { event.stopPropagation(); comp.menu = false; openCharts(); } }, picture("chart"), "Charts"),
    el("hr"),
    el("button", { onclick: (event) => { event.stopPropagation(); logOff(); } }, picture("keel"), "Log off")));
  // The watcher speaks up once for each step, noticing and tracing, until it's clicked away.
  const stage = watch?.stage ?? "calm";
  const balloon = stage !== "calm" && comp.hushed !== stage && el("div", { class: "balloon", onclick: (event) => { event.stopPropagation(); comp.hushed = stage; draw(); } }, el("b", {}, picture("eye"), watch.name), stage === "tracing" ? `This session is being traced. It finds you in ${watch.traceLeft} min.` : "Unusual activity in this session. It is being logged.");
  const taskbar = el("div", { class: "taskbar bev" },
    el("button", { class: "keel", "aria-expanded": String(comp.menu), onclick: (event) => { event.stopPropagation(); comp.menu = !comp.menu; draw(); } }, picture("keel"), navcom ? "NAVCOM" : "Keel"),
    tasks,
    el("div", { class: "tray sunk" },
      watch && el("span", { class: `watch ${watch.stage}`, title: `${watch.name}: ${watchWords(watch).toLowerCase()}` }, picture("eye")),
      watch && el("span", {}, watchWords(watch)),
      el("span", { title: "The ship's time" }, clockText())));
  // NAVCOM 7's bar along the top, with SENTRY's meter when it's listening.
  const bar = navcom && el("div", { class: "navcom-top" }, el("span", {}, "RESTRICTED · CFS MERIDIAN · NAVCOM 7"),
    watch && el("span", { class: `navcom-sentry ${watch.stage}`, title: `${watch.name}: ${watchWords(watch).toLowerCase()}` }, watch.name, Array.from({ length: watch.cuts }, (_, i) => el("i", { class: i < watch.noise ? "on" : "" }))));
  const os = el("div", { class: `os${navcom ? " navcom" : ""}`, onclick: () => { if (comp.menu) { comp.menu = false; draw(); } } }, bar, icons, list, viewer, view.locked && logonNode(view), balloon, taskbar, menu, programNode(view));
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

// The desktop is drawn at 640 by 480 and scaled to fit the glass. Every redraw makes a new glass, which starts at the
// last scale measured, so a click that comes before the new one is measured still lands where the desktop is seen.
let lastScale = 0;
const fitter = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
  for (const entry of entries) {
    const scale = entry.target.clientWidth / 640;
    if (scale > 0) lastScale = scale;
    entry.target.style.setProperty("--s", String(scale));
  }
});

// ---- The place's network, as a map (step 7) ------------------------------------------------------------------

const NET_KIND = { terminal: "TERM", door: "DOOR", junction: "BUS", camera: "CAM", relay: "RELAY" };
// Each band (a deck, or the whole place) is a strip; each node a button at its place in it (public/net-layout.js); the
// links are drawn behind. A node linked to the one you're on can be clicked to go there.
function netMapNode(map, width = NET_MAP.width) {
  const { bands, at, height } = layOutNetMap(map, width);
  const lines = map.links.map((one) => `<line x1="${at[one.a].x}" y1="${at[one.a].y}" x2="${at[one.b].x}" y2="${at[one.b].y}" class="net-${one.net}${one.a === map.here || one.b === map.here ? " net-near" : ""}"/>`).join("");
  const box = document.createElement("template");
  box.innerHTML = `<svg class="net-lines" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${lines}</svg>`;
  return el("div", { class: "netmap", style: `width:${width}px;height:${height}px`, role: "group", "aria-label": "The network" },
    bands.map((band) => el("div", { class: "net-band", style: `top:${band.y}px;height:${band.height}px` }, el("span", {}, band.name))),
    box.content.firstChild,
    map.nodes.map((node) => el("button", {
      class: `net-node net-${node.kind}${node.here ? " here" : ""}${node.linked ? " near" : ""}${node.visited ? " seen" : ""}${node.hardened ? " hard" : ""}${node.weak ? " weak" : ""}${node.sealed ? " sealed" : ""}${node.trusted ? " trusted" : ""}`,
      style: `left:${at[node.id].x}px;top:${at[node.id].y}px;max-width:${NET_MAP.box}px;max-height:${NET_MAP.boxHeight}px`,
      disabled: comp.sending || !node.linked,
      title: `${node.here ? `${node.name}: you're on this one` : node.linked ? `Go to ${node.name}: ${map.hop.minutes} min, heard here and there` : `${node.name}: not linked to where you are`}${node.hardened ? `. Hardened: no breaker works on it from the front${node.weak ? ", and you've found a way in" : ""}` : ""}${node.sealed ? `. Sealed: it answers only to ${node.answers}${node.trusted ? ", which is where you are" : ""}` : ""}`,
      onclick: (event) => {
        event.stopPropagation();
        send({ action: "hop", id: node.id });
      },
    }, el("small", {}, `${NET_KIND[node.kind] ?? ""}${node.sealed ? (node.trusted ? " · TRUSTED" : " · SEALED") : node.hardened ? (node.weak ? " · WAY IN" : " · HARD") : ""}`), el("span", { class: "nm" }, node.name))));
}

// How hot the rig is, in the tray: nothing's plugged into the player's own computers.

// ---- A door's panel, a junction box's service menu, a camera's feed ---------------------

const sendDevice = (id) => (event) => {
  event?.stopPropagation();
  send({ action: "device", id });
};
const shortName = (name) => String(name ?? "").replace(/^The /, "").toUpperCase();

function actsNode(actions) {
  if (!actions?.length) return null;
  return el("div", { class: "device-acts" }, actions.map((one) => el("button", { disabled: comp.sending || Boolean(one.why), title: one.why ?? one.about ?? "", onclick: sendDevice(one.id) }, one.label, one.why && el("small", {}, ` · ${one.why}`))));
}

function doorPlate(view) {
  const d = view.device;
  return el("div", { class: "door-plate" },
    el("div", { class: "lcd" }, el("span", {}, d.lcd[0]), el("span", {}, d.lcd[1])),
    el("div", { class: "keys", "aria-hidden": "true" }, "123456789*0#".split("").map((key) => el("i", {}, key))),
    el("div", { class: "slot" }, el("i", { class: `led${d.open ? " on" : ""}` }), "card"));
}

function serviceScreen(view) {
  const d = view.device;
  const item = (n, label, id, off = false) => el("button", { class: "svc-line", disabled: comp.sending || off, onclick: sendDevice(id) }, `${n}  ${label}`);
  let body;
  if (view.locked) body = [el("div", {}, "PASSWORD: ________")];
  else if (d.screen === "status") body = [el("div", {}, `FEEDS: ${d.feeds.map((feed) => `${shortName(feed.name)} ${feed.on ? "OK" : "OFF"}`).join("  ")}`), el("div", {}, `FAULTS REPORTED TO ENG BOARD: ${d.faults}`), item(9, "BACK", "svc-menu")];
  else if (d.screen === "breakers") body = [...d.feeds.map((feed, i) => item(i + 1, `${shortName(feed.name).padEnd(14, " ")}[${feed.on ? " ON" : "OFF"}]`, `svc-toggle:${feed.room}`)), item(9, "BACK", "svc-menu")];
  else if (d.screen === "log") body = [...(d.lines.length ? d.lines : ["(EMPTY)"]).map((text) => el("div", {}, text)), item(9, "BACK", "svc-menu")];
  else body = [item(1, "STATUS", "svc-status"), item(2, "BREAKERS", "svc-breakers"), item(3, "LOG", "svc-log"), item(4, `CLEAR LOG${d.cleared ? "  (DONE)" : d.canClear ? "" : "  (NEEDS SERVICE PASSWORD)"}`, "svc-clear", !d.canClear || d.cleared), item(0, "EXIT", "svc-exit")];
  return el("div", { class: "svc", role: "group", "aria-label": `${view.name}: service menu` }, el("div", {}, `HALDEN YARDS  ${d.code} SERVICE  v1.4`), el("div", {}, "================================"), body);
}

function cameraPicture(view) {
  const d = view.device;
  const figures = d.mode === "blind" ? [] : (d.people ?? []).slice(0, 6).map((who, i) => el("i", { class: `fig${who === "you" ? " you" : ""}`, style: `left:${14 + i * 13}%`, title: who }));
  return el("div", { class: `cam ${d.mode}`, role: "img", "aria-label": `${d.code}, ${d.room}` },
    el("div", { class: "cam-scene" }, el("i", { class: "cam-door" }), figures),
    el("div", { class: "cam-osd" }, el("span", {}, `${d.code} · ${shortName(d.room)}`), el("span", {}, `${d.time} ${d.mode === "loop" ? "LOOP" : d.mode === "blind" ? "NO SIGNAL" : "REC"}`)));
}

function deviceWindow(view) {
  const watch = view.watch ?? null;
  const d = view.device ?? {};
  const look = view.look;
  const face = look === "door" ? doorPlate(view) : look === "service" ? serviceScreen(view) : cameraPicture(view);
  const seen = look === "camera" && el("div", { class: "device-note" }, d.mode === "blind" ? "In the picture: snow." : `In the picture: ${d.people?.length ? d.people.join(", ") : "nobody"}.${d.mode === "loop" ? ` The loop runs ${d.loopLeft} more ${d.loopLeft === 1 ? "minute" : "minutes"}.` : ""}`);
  const head = el("div", { class: "device-head" }, el("strong", {}, view.name), el("span", { class: "device-tray" },
    watch && el("span", { class: `device-watch ${watch.stage}`, title: `${watch.name}: ${watchWords(watch).toLowerCase()}` }, `${watch.name}: ${watchWords(watch)}`),
    el("span", { title: "The ship's time" }, clockText())));
  const log = view.log.slice(-4);
  const frame = el("div", { class: `device-frame device-${look}`, id: "computer-window", title: "Drag the frame to move it" },
    comp.message && el("div", { class: "desk-note" }, comp.message),
    head, face, seen,
    // At its logon, what gets past it is on the rig beside it; inside, the panel's own buttons (a junction box's are its menu).
    view.locked ? el("div", { class: "device-note" }, view.reach?.ok ? `Locked: what gets you past it is on your rig, under D:${comp.rigOut ? "" : " (take it out with H)"}.` : comp.rigOut ? "Locked: connect your rig to work on it." : "Locked: take out your rig (H) and connect it to work on it.") : look === "service" ? null : actsNode(d.actions),
    el("div", { class: "device-log", id: "computer-console", role: "log" }, log.map((entry, i) => lineNode(entry, view.log.length - log.length + i >= comp.seen))),
    el("div", { class: "device-foot" },
      el("button", { disabled: comp.sending, onclick: (event) => { event.stopPropagation(); logOff(); } }, d.leave ?? "Log off")));
  const narrow = pocketRoom() < 960;
  const wide = pocketMapWidth(narrow);
  // The rig is drawn while it's out, and while it's still on its way back into the pocket.
  const rig = rigShown()
    ? [el("div", { class: "rig-gap", "aria-hidden": "true" }), movable(el("div", { class: "rig-case", id: "computer-rig" }, pocketNode(view, wide)), "rig", { stays: true })]
    : [rigPocketTab(view)];
  return el("div", { ...deskLook(`desk device${narrow ? " narrow" : ""}`, wide + RIG_CASE), id: "computer-desk", role: "dialog", "aria-label": view.name, tabindex: "-1" },
    el("div", { class: "device-row" }, movable(frame, "window"), rig));
}

// ---- Your rig, beside a panel with no screen of its own ----------------------------------------------------------
// A pocket computer with your board and casing on it, its link and heat lights, wired to the panel the way it's
// plugged in, and on its screen the place's network (NET), what's loaded on it (D:) and the session (LOG).

// What the floating window has across: the screen, less the rail of menus and its own margins. When the screen changes
// size, the computer and the rig beside it are drawn again for the room there is.
let pocketResize = 0;
if (typeof window !== "undefined") window.addEventListener("resize", () => {
  cancelAnimationFrame(pocketResize);
  pocketResize = requestAnimationFrame(() => {
    forgetMoves();
    if (comp.view && document.getElementById("computer")) draw();
  });
});
function pocketRoom() {
  const game = document.querySelector(".game");
  // The window can be drawn before the game's box is on the page: then the rail is there above 860 wide, as the
  // stylesheet has it.
  const rail = game?.isConnected ? parseFloat(getComputedStyle(game).getPropertyValue("--rail-width")) || 0 : window.innerWidth > 860 ? 124 : 0;
  return (game?.isConnected && game.clientWidth ? game.clientWidth : window.innerWidth) - rail - 32;
}

// How wide the rig's map can be: the panel's window, the lead and the rig's case take their room first, and the map has
// the rest, from 300 to its own width.
function pocketMapWidth(narrow) {
  return Math.round(Math.max(300, Math.min(NET_MAP.width, pocketRoom() - (narrow ? 300 : 380) - (narrow ? 26 : 56) - 52)));
}

// ---- The computer and the rig, each moved on its own ----------------------------------------------------------------
// The computer (its monitor, or a panel's own window) and the rig beside it start side by side, and each is pulled by
// its frame on its own. The computer slides back when it's let go, like the game's other floating windows; the rig
// stays where it's let go, kept on the screen. Where the rig was moved to lasts while going along the network and is
// forgotten at a computer come to afresh, when the computer closes, and when the screen changes size.

const moved = { rig: null };
function forgetMoves() {
  moved.rig = null;
}

// The lead drawn again every frame for a while, as the computer slides home.
let leadUntil = 0;
function followLead(ms) {
  const going = leadUntil > performance.now();
  leadUntil = Math.max(leadUntil, performance.now() + ms);
  if (going) return;
  const frame = () => {
    drawLead();
    if (performance.now() < leadUntil) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function movable(node, key, { stays = false } = {}) {
  const at = () => (stays && moved[key]) || { x: 0, y: 0 };
  const put = (win, x, y) => {
    win.style.transform = x || y ? `translate(${x}px, ${y}px)` : "";
  };
  // How far the pull under way has gone: its last move, read when it's let go.
  let last = null;
  node.classList.add("movable");
  makePullable(node, {
    follow: (win, dx, dy) => {
      last = { dx, dy };
      put(win, at().x + dx, at().y + dy);
      drawLead();
    },
    back: (win) => {
      const pulled = last;
      last = null;
      if (!stays) {
        // Home, the way the other floating windows go, with the lead following it there.
        put(win, 0, 0);
        setTimeout(() => win.classList.remove("springing"), SPRING_MS);
        followLead(SPRING_MS + 60);
        win.addEventListener("transitionend", drawLead, { once: true });
        return;
      }
      win.classList.remove("springing");
      if (pulled) moved[key] = keptOnScreen(win, { x: at().x + pulled.dx, y: at().y + pulled.dy });
      put(win, at().x, at().y);
      win.classList.toggle("moved", Boolean(at().x || at().y));
      drawLead();
    },
  });
  const pulled = pulledBy(node.id);
  put(node, at().x + (pulled?.x ?? 0), at().y + (pulled?.y ?? 0));
  node.classList.toggle("moved", Boolean(at().x || at().y));
  return node;
}

// Where a window let go would sit, moved back far enough that its top and a good piece of it stay on the screen.
function keptOnScreen(win, at) {
  const layer = document.getElementById("computer");
  if (!layer) return at;
  const z = zoom();
  const box = win.getBoundingClientRect();
  const room = layer.getBoundingClientRect();
  const keep = 80;
  let { x, y } = at;
  const left = (box.left - room.left) / z;
  const right = (box.right - room.left) / z;
  const top = (box.top - room.top) / z;
  const width = room.width / z;
  const height = room.height / z;
  if (right < keep) x += keep - right;
  else if (left > width - keep) x -= left - (width - keep);
  if (top < 0) y -= top;
  else if (top > height - 48) y -= top - (height - 48);
  return { x: Math.round(x), y: Math.round(y) };
}

// The lead from the rig to what it's plugged into, drawn between the two wherever they are: a cable to a computer, a
// clip lead to a junction box, the optical reader's red beam to a keypad, radio to a camera, a dashed line over the
// network, and nothing when it isn't plugged in or the two are touching. It plugs in a little below the top of each.
const leadPoints = (rig, desk) => {
  const gapX = Math.max(rig.l - desk.r, desk.l - rig.r);
  const gapY = Math.max(rig.t - desk.b, desk.t - rig.b);
  if (gapX < 6 && gapY < 6) return null;
  const socket = (box, side) => (side === "x" ? box.t + Math.min(96, (box.b - box.t) / 2) : (box.l + box.r) / 2);
  if (gapX >= gapY) {
    const right = rig.l >= desk.r;
    return { across: "x", rig: { x: right ? rig.l : rig.r, y: socket(rig, "x") }, desk: { x: right ? desk.r : desk.l, y: socket(desk, "x") } };
  }
  const below = rig.t >= desk.b;
  return { across: "y", rig: { x: socket(rig, "y"), y: below ? rig.t : rig.b }, desk: { x: socket(desk, "y"), y: below ? desk.b : desk.t } };
};
const n = (v) => Math.round(v * 10) / 10;
// A cable hanging between them, its ends leaving each square on.
function hanging(a, b, across, shift = 0) {
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  const reach = Math.max(18, (across === "x" ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y)) * 0.42);
  const sag = Math.min(60, span * 0.18);
  const ox = across === "x" ? 0 : shift;
  const oy = across === "x" ? shift : 0;
  if (across === "x") {
    const dir = Math.sign(b.x - a.x) || 1;
    return `M${n(a.x + ox)} ${n(a.y + oy)} C${n(a.x + dir * reach + ox)} ${n(a.y + sag + oy)}, ${n(b.x - dir * reach + ox)} ${n(b.y + sag + oy)}, ${n(b.x + ox)} ${n(b.y + oy)}`;
  }
  const dir = Math.sign(b.y - a.y) || 1;
  return `M${n(a.x + ox)} ${n(a.y + oy)} C${n(a.x + sag * 0.4 + ox)} ${n(a.y + dir * reach + oy)}, ${n(b.x + sag * 0.4 + ox)} ${n(b.y - dir * reach + oy)}, ${n(b.x + ox)} ${n(b.y + oy)}`;
}
const plugAt = (p, across, fill, long = 14, thin = 9) => (across === "x"
  ? `<rect x="${n(p.x - thin / 2)}" y="${n(p.y - long / 2)}" width="${thin}" height="${long}" rx="2" fill="${fill}" stroke="#222"/>`
  : `<rect x="${n(p.x - long / 2)}" y="${n(p.y - thin / 2)}" width="${long}" height="${thin}" rx="2" fill="${fill}" stroke="#222"/>`);
const straight = (a, b) => `M${n(a.x)} ${n(a.y)} L${n(b.x)} ${n(b.y)}`;
function radioArcs(at, to) {
  const angle = Math.atan2(to.y - at.y, to.x - at.x);
  const point = (r, a) => `${n(at.x + r * Math.cos(a))} ${n(at.y + r * Math.sin(a))}`;
  return [9, 16, 23].map((r) => `<path d="M${point(r, angle - 0.6)} A${r} ${r} 0 0 1 ${point(r, angle + 0.6)}" fill="none" stroke="#8ff0a8" stroke-width="2" opacity=".85"/>`).join("");
}
const LEADS = {
  cable: ({ rig, desk, across }) => `<path d="${hanging(rig, desk, across)}" fill="none" stroke="#6a706c" stroke-width="6" stroke-linecap="round"/><path d="${hanging(rig, desk, across)}" fill="none" stroke="#26292a" stroke-width="3" stroke-linecap="round"/>${plugAt(desk, across, "#9aa09b")}${plugAt(rig, across, "#4a4d50", 12, 8)}`,
  navy: ({ rig, desk, across }) => `<path d="${hanging(rig, desk, across)}" fill="none" stroke="#2d3f5c" stroke-width="6" stroke-linecap="round"/>${plugAt(desk, across, "#8ab8ff", 16, 10)}${plugAt(rig, across, "#4a4d50", 12, 8)}`,
  clip: ({ rig, desk, across }) => `<path d="${hanging(rig, desk, across, -3)}" fill="none" stroke="#c8352c" stroke-width="3"/><path d="${hanging(rig, desk, across, 3)}" fill="none" stroke="#222" stroke-width="3"/>${plugAt(desk, across, "#9aa09b", 18, 9)}`,
  optic: ({ rig, desk, across }) => `<path d="${straight(rig, desk)}" fill="none" stroke="#ff5a4a" stroke-width="2" stroke-dasharray="3 4"/><circle cx="${n(desk.x)}" cy="${n(desk.y)}" r="4" fill="#ff5a4a" opacity=".85"/>${plugAt(rig, across, "#4a4d50", 16, 12)}`,
  radio: ({ rig, desk, across }) => `<path d="${straight(rig, desk)}" fill="none" stroke="#8ff0a8" stroke-width="1.5" stroke-dasharray="2 7" opacity=".45"/>${radioArcs(rig, desk)}${plugAt(rig, across, "#4a4d50", 12, 8)}`,
  net: ({ rig, desk }) => `<path d="${straight(rig, desk)}" fill="none" stroke="#4fa3d9" stroke-width="2" stroke-dasharray="5 4"/>`,
};
function drawLead() {
  const svg = document.getElementById("rig-lead");
  if (!svg) return;
  const reach = comp.view?.reach;
  const kind = reach?.remote ? "net" : reach?.ok ? reach.link : null;
  const desk = document.getElementById("computer-window");
  const rig = document.querySelector("#computer-rig > .rig-strip") ?? document.getElementById("computer-rig");
  const layer = svg.parentElement;
  // No lead while the rig is on its way out of the pocket or back into it: it's drawn once the rig has arrived.
  if (!kind || !LEADS[kind] || !desk || !rig || !layer || rigDoing()) {
    svg.innerHTML = "";
    return;
  }
  const z = zoom();
  const base = layer.getBoundingClientRect();
  const boxOf = (node) => {
    const r = node.getBoundingClientRect();
    return { l: (r.left - base.left) / z, t: (r.top - base.top) / z, r: (r.right - base.left) / z, b: (r.bottom - base.top) / z };
  };
  const points = leadPoints(boxOf(rig), boxOf(desk));
  svg.innerHTML = points ? LEADS[kind](points) : "";
}

// ---- The rig in the pocket ----------------------------------------------------------------------------------------
// The rig stays in the player's pocket until it's taken out: H, or the tab down the computer's side. H again, or AWAY on
// the rig, puts it back. Putting it away only puts its window away: a rig that's plugged in stays plugged in (UNPLUG
// takes it off), and the tab's lights say so. At a junction box or a camera, which the rig connects to as they open, it
// wakes up the first time it's taken out.
function toggleRig() {
  const view = comp.view;
  if (!view) return;
  comp.rigOut = !comp.rigOut;
  // It comes out and goes back by an animation, and the same press in the middle turns it round from where it is.
  comp.rigMove = rigStill() ? null : rigTurned(comp.rigMove, performance.now(), comp.rigOut ? "out" : "away");
  if (comp.rigOut && !comp.woke && view.reach?.plugged && !view.reach?.remote && THROUGH_RIG.includes(view.look)) startBoot();
  if (comp.rigOut) comp.woke = true;
  else comp.rigSlide = null;
  draw();
  followRigMove();
}

// ---- The rig coming out and going back -------------------------------------------------------------------------------
// Taken out, the rig slides out from behind the computer's edge, where its tab was, and the computer slides over to make
// room, since the two sit in the middle together. Put away, it slides back in, and its tab slides out again. A rig that
// was dragged away from the computer has no edge to come from, and grows and shrinks where it is. The times and what's
// happening when are public/rig-motion.js's; the pictures are the stylesheet's animations, each started as far in as
// the move has got, so that drawing the window again in the middle of one carries on with it. Nothing moves when the
// player's computer is set to show no animations: the rig is there, or it isn't, as it was before.

// How much wider than its screen's page the rig's case is, and how wide its tab is until one's been measured.
const RIG_CASE = 52;
const STRIP_WIDE = 64;
let rigTabWide = 50;
const rigStill = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const rigDoing = () => rigPhase(comp.rigMove, performance.now());
const rigShown = () => comp.rigOut || rigDoing()?.phase === "away";

// The window's own box says what the rig is doing and how far in it is, for the stylesheet, and how wide the rig is,
// for how far the computer has to slide until that's been measured.
function deskLook(cls, wide) {
  const doing = rigDoing();
  return { class: doing ? `${cls} rig-${doing.phase}` : cls, style: `--rig-wide:${wide}px${doing ? `;--rig-at:-${Math.round(doing.ms)}ms` : ""}` };
}

// How far the computer slides over: half of what the row grows by when the rig takes its tab's place, since the row
// sits in the middle. Measured on the row as it's drawn with the rig in it, which is how it's drawn both ways.
function fitRigShift() {
  const desk = document.getElementById("computer-desk");
  if (!desk) return;
  const tab = desk.querySelector(".rig-pocket");
  if (tab?.offsetWidth) rigTabWide = tab.offsetWidth;
  const row = desk.querySelector(".device-row");
  const win = document.getElementById("computer-window");
  if (!rigDoing() || !row || !win || !document.getElementById("computer-rig")) return;
  desk.style.setProperty("--rig-shift", `${Math.round((row.offsetWidth - win.offsetWidth - rigTabWide) / 2)}px`);
}

// What has to be drawn again as a move goes on: the row without the rig, and its tab coming out, once it's gone in;
// and the lead, once it's out.
let rigTimer = 0;
function followRigMove() {
  clearTimeout(rigTimer);
  const before = rigDoing();
  if (!before) {
    comp.rigMove = null;
    return;
  }
  rigTimer = setTimeout(() => {
    if (!rigDoing()) comp.rigMove = null;
    if (document.getElementById("computer")) {
      if (before.phase === "away") draw();
      else drawLead();
    }
    followRigMove();
  }, rigNextChange(comp.rigMove, performance.now()) + 16);
}
const rigToggle = (event) => {
  event.stopPropagation();
  toggleRig();
};
const AWAY = "Put your rig back in your pocket (H)";
function rigPocketTab(view) {
  const reach = view.reach ?? {};
  const on = reach.ok || reach.remote;
  return el("button", { class: "rig-pocket", title: on ? "Take out your rig (H): it's still plugged in" : "Take out your rig (H)", "aria-label": "Take out your rig (H)", onclick: rigToggle },
    picture("rig"), el("span", {}, "RIG"), el("kbd", {}, "H"),
    on && el("span", { class: "rig-pocket-lights" }, linkLight(reach), heatLight(view.rigHeat)));
}

const POCKET_TABS = [["net", "NET", "The place's network: go along it from here"], ["prog", "D:", "What's loaded on your rig, to run here"], ["log", "LOG", "What's happened at this one"]];
const THROUGH_RIG = ["service", "camera"];
const linkName = (words) => String(words ?? "").replace(/^(an?|the) /i, "").toUpperCase();
const capital = (text) => (text ? `${text[0].toUpperCase()}${text.slice(1)}` : "");
const rigLight = (cls, label, title) => el("span", { class: "pocket-light", title }, el("i", { class: `lamp${cls ? ` ${cls}` : ""}` }), label);
const linkLight = (reach) => (booting() ? rigLight("busy", "LINK", "Connecting: the rig is waking up") : rigLight(reach.remote ? "net" : reach.ok ? "on" : "", "LINK", reach.remote ? "Over the network, from where it's plugged in" : reach.ok ? `Plugged in by ${reach.words}` : `Not connected: this takes ${reach.words}`));
const heatLight = (heat) => rigLight(!heat || heat.dead ? "" : heat.overheating ? "hot" : heat.fan ? "warm" : "cool", "HEAT", heat ? `Your rig: ${heat.dead ? `it won't start, ${heat.dead}` : heat.words}` : "Not working: it warms while it works someone else's computer");
// New lines in the session since the player last looked at LOG.
const unseenLog = (view, tab) => tab !== "log" && (view.log?.length ?? 0) > (comp.logSeen ?? 0);
const plug = (event) => {
  event.stopPropagation();
  startBoot();
  send({ action: "plug" });
};

// Until the rig is plugged in, its screen says so and offers to connect it by the link this one takes.
function plugPage(view) {
  const reach = view.reach ?? {};
  const desk = !PANEL_LOOKS.includes(view.look);
  return el("div", { class: "pocket-plug" },
    el("b", {}, "NOT CONNECTED"),
    el("span", {}, desk ? "Plug your rig in to hack it, see the network or run your programs here." : "Connect your rig to work on it, or to go on along the network."),
    el("button", { class: "go", disabled: comp.sending || !reach.fits, onclick: plug }, `CONNECT BY ${linkName(reach.words)}`),
    reach.fits
      ? el("small", {}, `Takes a minute.${view.reach?.seen ? " Anyone in the room can see you plug in." : ""}`)
      : el("small", { class: "why" }, `${capital(reach.why ?? "")}. Fit the right link on the Rig page first.`));
}

function pocketNode(view, width, { closeable = false } = {}) {
  const face = view.rigFace ?? {};
  const reach = view.reach ?? {};
  const heat = view.rigHeat;
  const tab = comp.rigTab ?? (view.locked ? "prog" : "net");
  const tall = view.netmap ? layOutNetMap(view.netmap, width).height : 0;
  const note = (text) => el("div", { class: "pocket-note" }, text);
  if (tab === "log") comp.logSeen = view.log?.length ?? 0;
  let page;
  if (booting()) page = bootPage(view);
  else if (heat?.dead) page = note(`It won't start: ${heat.dead}.`);
  else if (!reach.ok && tab !== "log") page = plugPage(view);
  else if (tab === "net") page = view.locked ? note("Get past its logon first: the map shows here once you're in.") : view.netmap ? netMapNode(view.netmap, width) : note("This isn't on the place's network.");
  else if (tab === "prog") page = pocketPrograms(view);
  else page = el("div", { class: "pocket-log", id: "rig-log", role: "log" }, view.log.slice(-14).map((entry) => lineNode(entry)));
  const where = reach.remote ? "OVER THE NETWORK" : reach.ok ? `ON THE ${linkName(reach.words)}` : "NOT CONNECTED";
  return el("div", { class: "pocket", role: "group", "aria-label": "Your rig", title: "Drag the rig's case to move it" },
    closeable && el("button", { class: "pocket-close", title: "Fold the rig away", "aria-label": "Fold the rig away", onclick: (event) => { event.stopPropagation(); comp.rigSlide = null; draw(); } }, "×"),
    el("div", { class: "pocket-top" },
      el("span", {}, [face.board, face.casing].filter(Boolean).join(" · ").toUpperCase() || "YOUR RIG"),
      el("span", { class: "pocket-lights" }, linkLight(reach), heatLight(heat), el("button", { class: "pocket-away", title: AWAY, "aria-label": AWAY, onclick: rigToggle }, "AWAY"))),
    el("div", { class: "pocket-screen" },
      el("div", { class: "pocket-tabs", role: "tablist", "aria-label": "Your rig's pages" },
        POCKET_TABS.map(([id, label, about]) => el("button", { role: "tab", "aria-selected": String(tab === id), title: about, onclick: (event) => { event.stopPropagation(); comp.rigTab = id; if (comp.rigSlide) comp.rigSlide = id; draw(); } }, label, id === "log" && unseenLog(view, tab) && el("i", { class: "pocket-dot", title: "Something new" }))),
        el("span", { class: "pocket-where" }, where)),
      el("div", { class: "pocket-page", style: `width:${width}px;min-height:${Math.max(tall, 150)}px` }, page)),
    el("div", { class: "pocket-bottom" },
      el("span", {}, `${view.rig?.used ?? 0} OF ${view.rig?.memory ?? 0} BLOCKS`),
      reach.plugged && !reach.remote && !THROUGH_RIG.includes(view.look) && el("button", { disabled: comp.sending, title: "Take your rig off this one", onclick: (event) => { event.stopPropagation(); send({ action: "unplug" }); } }, "UNPLUG"),
      el("span", {}, view.netmap && reach.ok && !view.locked ? `${view.netmap.hop.minutes} MIN A HOP` : "")));
}

// ---- The rig waking up as it connects ----------------------------------------------------------------------------
// Connecting takes the rig three seconds to wake: its board, a memory count, the link, then D:. It plays when Connect is
// pressed, and at a junction box or a camera, which connect the rig as they open, the first time it's taken out of the
// pocket there. A click on its screen skips it.
const BOOT_MS = 3000;
let bootTimer = 0;
const booting = () => Boolean(comp.boot) && comp.boot.id === comp.id && performance.now() - comp.boot.at < BOOT_MS;
function startBoot() {
  comp.boot = { at: performance.now(), id: comp.id };
  clearInterval(bootTimer);
  bootTimer = setInterval(() => {
    if (!booting()) {
      clearInterval(bootTimer);
      comp.boot = null;
      if (document.getElementById("computer")) draw();
      return;
    }
    const box = document.getElementById("rig-boot");
    if (box && comp.view) box.replaceChildren(...bootLines(comp.view, performance.now() - comp.boot.at));
  }, 100);
}
// What's on the screen so many milliseconds in.
function bootLines(view, ms) {
  const board = String(view.rigFace?.board ?? "Yard board").toUpperCase();
  const maker = /navy/i.test(board) ? "NAVAL ARSENAL" : "HALDEN YARDS";
  const blocks = view.rig?.memory ?? 4;
  const link = linkName(view.reach?.words) || "LINK";
  const lines = [];
  const row = (text, cls = "") => lines.push(el("div", { class: cls }, text));
  if (ms >= 150) row(`${board}  BIOS 2.1`, "head");
  if (ms >= 400) row(`(C) ${maker}`);
  if (ms >= 650) {
    const counted = Math.min(blocks, Math.floor(((ms - 650) / 900) * blocks));
    row(`MEMORY: ${counted} OF ${blocks} BLOCKS${counted >= blocks ? "  OK" : ""}`);
  }
  if (ms >= 1750) row(`LINK: ${link} ...... OK`);
  if (ms >= 2200) row("D: MOUNTED");
  if (ms >= 2550) row("READY", "head");
  lines.push(el("span", { class: "boot-cursor" }));
  return lines;
}
function bootPage(view) {
  return el("div", { class: "pocket-boot", id: "rig-boot", title: "Click to skip", onclick: (event) => { event.stopPropagation(); comp.boot = null; clearInterval(bootTimer); draw(); } }, bootLines(view, performance.now() - comp.boot.at));
}

// Where there isn't room beside the monitor, the rig folds to a strip down its side: its lights, its pages, and PLUG IN
// until it's connected. Picking a page slides the rig out over the monitor.
function stripNode(view) {
  const reach = view.reach ?? {};
  const open = comp.rigSlide;
  const tab = comp.rigTab ?? (view.locked ? "prog" : "net");
  return el("div", { class: "rig-strip", role: "group", "aria-label": "Your rig, folded", title: "Drag the rig to move it" },
    el("div", { class: "strip-lights" }, linkLight(reach), heatLight(view.rigHeat)),
    POCKET_TABS.map(([id, label, about]) => el("button", { "aria-pressed": String(open === id), title: about, onclick: (event) => { event.stopPropagation(); comp.rigSlide = open === id ? null : id; comp.rigTab = id; draw(); } }, label, id === "log" && unseenLog(view, open ? tab : null) && el("i", { class: "pocket-dot", title: "Something new" }))),
    !reach.ok && el("button", { class: "go", disabled: comp.sending || !reach.fits, title: reach.fits ? `Connect by ${reach.words}: a minute` : `${capital(reach.why ?? "")}`, onclick: plug }, "PLUG IN"),
    el("button", { class: "away", title: AWAY, "aria-label": AWAY, onclick: rigToggle }, "AWAY"));
}

// D: on the rig: at a logon, what gets past it; inside, what's loaded; each with why it won't run here, if it won't.
function pocketPrograms(view) {
  const list = view.locked ? view.logon?.ways ?? [] : view.rig?.loaded ?? [];
  if (!list.length) return el("div", { class: "pocket-note" }, view.locked ? "Nothing loaded on your rig gets past this logon. Load a breaker on the Rig page first." : "Nothing's loaded on your rig. Load programs on the Rig page.");
  return el("div", { class: "pocket-list" }, list.map((one) => el("div", { class: `pocket-row${one.why ? " no" : ""}` },
    el("span", {}, el("b", {}, one.name), el("small", {}, one.why ? ` won't: ${one.why}` : ` ${one.about ?? ""}`)),
    el("button", { disabled: comp.sending || Boolean(one.why), title: one.why ? `Won't: ${one.why}.` : one.about ?? "", onclick: (event) => { event.stopPropagation(); send({ action: "rig", id: one.id }); } }, view.locked && one.kind !== "in" ? "READ" : "RUN"))));
}

function windowNode() {
  const view = comp.view;
  // A door's panel, a junction box and a camera have no desktop: their own face, and the buttons under it.
  if (PANEL_LOOKS.includes(view.look)) return deviceWindow(view);
  // Nobody watches the player's own computers; any other has AuditGuard listening, from the logon on.
  const watch = view.watch ?? null;
  const glass = el("div", lastScale ? { class: "glass", style: `--s:${lastScale}` } : { class: "glass" }, el("div", { class: "desk-screen" }, osNode(view, watch)), el("div", { class: "fx scan" }), el("div", { class: "fx vig" }), el("div", { class: "fx glare" }), el("div", { class: "fx band" }));
  if (fitter) fitter.observe(glass);
  const lay = computerLayout();
  const monitor = el("div", { class: "monitor", id: "computer-window", title: "Drag the frame to move it", style: `width:min(${lay.monitor}px, calc((100vh - 16em) * 1.3))` },
    comp.message && el("div", { class: "desk-note" }, comp.message),
    glass,
    el("div", { class: "plate" }, el("span", {}, "VARNE 15SX"), el("span", { class: `led${watch?.stage === "tracing" ? " bad" : watch?.stage === "noticed" ? " warn" : ""}` })));
  // In the pocket, the rig is a tab down the monitor's side. Out and folded, it's the strip down the monitor's side, and
  // the page that slides out of it goes where it goes. It's drawn while it's out, and while it's still on its way back in.
  const shown = rigShown();
  const rig = !shown ? [rigPocketTab(view)]
    : lay.strip
      ? [movable(el("div", { class: "rig-folded", id: "computer-rig" }, stripNode(view), comp.rigSlide && el("div", { class: "rig-slide" }, pocketNode(view, lay.map, { closeable: true }))), "rig", { stays: true })]
      : [el("div", { class: "rig-gap", "aria-hidden": "true" }), movable(el("div", { class: "rig-case", id: "computer-rig" }, pocketNode(view, lay.map)), "rig", { stays: true })];
  return el("div", { ...deskLook(`desk computer${lay.strip && shown ? " folded" : ""}`, lay.strip ? STRIP_WIDE : lay.map + RIG_CASE), id: "computer-desk", role: "dialog", "aria-label": view.name, tabindex: "-1" },
    el("div", { class: "device-row" }, movable(monitor, "window"), rig));
}

// How a computer and the rig share the room: side by side where the monitor keeps 600 or more beside the rig at its
// narrowest, the map as wide as it can be; else the rig folds to a strip down the monitor's side, and its pages slide
// out over the monitor.
function computerLayout() {
  const room = pocketRoom();
  if (room >= 600 + 56 + 352) {
    const map = Math.round(Math.max(300, Math.min(NET_MAP.width, room - 56 - 52 - 696)));
    return { strip: false, map, monitor: Math.min(980, room - 56 - (map + 52)) };
  }
  const monitor = Math.min(980, room - 66);
  return { strip: true, map: Math.round(Math.max(300, Math.min(400, monitor - 140))), monitor };
}

// It floats over the room the way the check window does, with nothing dimmed behind it and the clock running on, and a
// line runs from it to what the player sat down at. The lead between the computer and the rig is drawn under both.
export function computerNode() {
  sync();
  if (!computerOpen()) return null;
  fitter?.disconnect();
  const lead = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  lead.setAttribute("class", "rig-lead");
  lead.setAttribute("id", "rig-lead");
  lead.setAttribute("aria-hidden", "true");
  const node = el("div", { class: "check-float", id: "computer" }, leaderNode(comp.view?.at), lead, windowNode());
  requestAnimationFrame(drawLead);
  // While the rig is on its way out or back, how far the computer slides is measured once the window's on the page.
  if (comp.rigMove) requestAnimationFrame(fitRigShift);
  // The lines that came with the last answer type out once: drawing the desktop again for a click doesn't retype them.
  comp.seen = comp.view?.log?.length ?? 0;
  return node;
}

function draw() {
  const node = computerNode();
  const current = document.getElementById("computer");
  if (current && node) current.replaceWith(node);
  // Measured at once, before anything's painted, so the computer never jumps as the rig comes out or goes back.
  fitRigShift();
  focusComputer();
}

// Shows the latest in the session log. Nothing takes the keyboard: everything on the desktop is clicked.
export function focusComputer() {
  for (const id of ["computer-console", "rig-log"]) {
    const log = document.getElementById(id);
    if (log) log.scrollTop = log.scrollHeight;
  }
}

function onKey(event) {
  if (app.ui.screen !== "game" || !computerOpen() || app.ui.sideOpen || event.ctrlKey || event.metaKey || event.altKey) return;
  if (app.ui.game.combat || app.ui.game.check) return;
  // H takes the rig out of the pocket and puts it back, unless something's being typed into.
  if ((event.key === "h" || event.key === "H") && !event.repeat) {
    if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
    event.preventDefault();
    event.stopPropagation();
    toggleRig();
    return;
  }
  if (event.key === "Escape") {
    if (comp.menu) {
      comp.menu = false;
      draw();
      return;
    }
    // The chart program closes before the computer does, and its own menus and boxes before it.
    if (comp.app) {
      const st = comp.chart;
      if (st?.jump) return;
      if (st && (st.menu || st.confirm)) Object.assign(st, { menu: null, confirm: false });
      else comp.app = null;
      draw();
      return;
    }
    if (!comp.sending) logOff();
  }
}
