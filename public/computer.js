// The computer window: a computer the player has got into, drawn as Keelworks 4.1, a made-up shipyard desktop of about
// 1999, on an old monitor floating over the room. The game on the server holds everything and decides everything; this
// draws what it says and sends what's clicked. What's on the computer are folders on the desktop (Systems, Files, Mail,
// Logs, Programs, Network) that open in a window; what's opened shows in a second window; a third keeps the session's
// log; the taskbar has the menu, the windows, the watcher's eye on a hacked computer, and the clock. Windows are dragged
// by their title bars; the monitor's frame pulls the whole thing aside. The advisor's hints sit beside the monitor.
// Skin and the old screen's strength are Settings choices (desktop.css). Nothing here needs typing. Since step 6 a
// computer can look like something else: a door's panel with its keypad, a junction box's service menu and a camera's
// feed on the rig's little screen, and NAVCOM 7, the Navy's desktop, for the ship's main system.

import { api, el } from "./dom.js";
import { leaderNode, pullable } from "./float.js";
import { NET_MAP, layOutNetMap } from "./net-layout.js";

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
  Object.assign(comp, { id: null, view: null, sending: false, message: null, seen: 0, wins: startWindows(), z: { log: 10, list: 11, view: 12 }, top: "view", folder: null, sel: null, menu: false, screenKey: "", hushed: -1, rigTab: null, hopping: false, wasLocked: null });
}
resetComputer();

const screenKey = (screen) => `${screen?.kind}|${screen?.id ?? ""}|${screen?.title ?? ""}`;

// A door's panel, a junction box and a camera have no screen of their own: their face, and the player's rig beside it.
const PANEL_LOOKS = ["door", "service", "camera"];

function sync() {
  const live = app.ui.game?.computer ?? null;
  if (!live) {
    resetComputer();
    return;
  }
  if (live.id !== comp.id) {
    // Going along the network to the next system keeps the map in front, to go on from there: a desktop opens its
    // Network folder, and beside a panel the rig shows its map anyway once past the logon.
    const onTheMap = comp.hopping;
    resetComputer();
    comp.id = live.id;
    comp.screenKey = screenKey(live.screen);
    if (onTheMap && live.netmap && !PANEL_LOOKS.includes(live.look)) {
      comp.folder = "network";
      Object.assign(comp.wins.list, netWindow(live.netmap), { open: true });
      comp.top = "list";
      comp.z.list = Math.max(...Object.values(comp.z)) + 1;
    }
  }
  // Getting past a logon turns the rig to what it shows best: the programs at a logon, the map once inside.
  if (live.locked !== comp.wasLocked) {
    comp.wasLocked = live.locked;
    comp.rigTab = null;
  }
  if (!comp.sending) comp.hopping = false;
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
  rig: r(2, 4, 12, 9, "#123d22") + r(3, 5, 10, 7, "#1f6b3a") + r(4, 6, 3, 2, "#ffd84a") + r(8, 9, 4, 2, "#9fd9a8") + r(3, 13, 1, 2, "#d8b040") + r(6, 13, 1, 2, "#d8b040") + r(9, 13, 1, 2, "#d8b040") + r(12, 13, 1, 2, "#d8b040"),
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
  ["rig", "Rig (D:)", "rig", "rig"],
];
const NAVCOM_FOLDERS = [
  ["shiplog", "Ship's log", "log", null],
  ["crew", "Crew", "txt", null],
];
// What a folder holds: the computer's own lists, the programs it has to copy, the rig's loaded programs, and on NAVCOM 7
// the ship's log and the crew assessments.
const folderItems = (view, id) => (id === "rig" ? view.rig?.loaded ?? [] : id === "programs" ? [...view.programs, ...(view.rig?.copies ?? []).map((one) => ({ ...one, copy: true }))] : id === "shiplog" ? view.device?.shipLog ?? [] : id === "crew" ? view.device?.crew?.list ?? [] : id === "network" && view.netmap ? view.netmap.nodes.filter((one) => one.linked) : view[id] ?? []);
const allFolders = (view) => (view.look === "navcom" ? [...FOLDERS, ...NAVCOM_FOLDERS] : FOLDERS);
const foldersHere = (view) => allFolders(view).filter(([id]) => folderItems(view, id).length > 0);

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

// ---- The logon ------------------------------------------------------------------

// A computer the player isn't past yet: Keelworks' logon box, with the ways in off their rig. Each says whether it will
// work here and, when it won't, why; the advisor beside the monitor says what each costs.
function logonNode(view) {
  const ways = view.logon?.ways ?? [];
  const way = (one) => el("button", {
    class: `row-item logon-way${one.why ? " done" : ""}`,
    disabled: comp.sending,
    title: one.about,
    onclick: (event) => {
      event.stopPropagation();
      send({ action: "rig", id: one.id });
    },
  }, picture(one.kind === "in" ? "exe" : "eye"), el("span", {}, one.name, el("small", {}, one.why ? `Won't: ${one.why}.` : one.kind === "in" ? "Run it to get past the logon." : "Run it to read the logon first.")), el("small", {}, one.why ? "" : "run"));
  return el("div", { class: "logon bev", role: "dialog", "aria-label": `Log on to ${view.name}` },
    el("div", { class: "banner" }, picture("keel"), el("div", {}, "Keelworks 4.1", el("small", {}, `${String(view.className).toUpperCase()} · ${view.practice ? "PRACTICE" : "LOGON"}`))),
    el("div", { class: "body" },
      el("div", { class: "grid2" },
        el("span", {}, "User name:"), el("span", { class: "field sunk" }),
        el("span", {}, "Password:"), el("span", { class: "field sunk" }),
        el("span", {}, "Log on to:"), el("span", { class: "field sunk" }, view.name)),
      el("div", { class: "logon-label" }, "From your rig:"),
      ways.length
        ? el("div", { class: "rows logon-ways sunk" }, ways.map(way))
        : el("div", { class: "logon-none" }, "Nothing loaded on your rig gets past a logon. Load a breaker on the Rig page before you sit down."),
      el("div", { class: "logon-buttons" }, el("button", { disabled: comp.sending, onclick: (event) => { event.stopPropagation(); logOff(); } }, "Log off"))));
}

// The watcher's stage in words, for the tray and its balloon.
const watchWords = (watch) => (watch.stage === "tracing" ? `Tracing: ${watch.traceLeft} min` : watch.stage === "noticed" ? "Noticed" : "Calm");

// ---- The desktop ------------------------------------------------------------------

function raise(id) {
  comp.top = id;
  comp.z[id] = Math.max(...Object.values(comp.z)) + 1;
}

// The Network folder's window: wide enough for the map, and tall enough for all of it where the desktop has the room.
const netWindow = (map) => ({ x: 84, y: 6, w: 486, h: Math.min(420, layOutNetMap(map).height + 74) });

function openFolder(id) {
  comp.folder = id;
  comp.wins.list.open = true;
  if (id === "network" && comp.view?.netmap) Object.assign(comp.wins.list, netWindow(comp.view.netmap));
  raise("list");
  draw();
}

function folderRows(view) {
  const folder = allFolders(view).find(([id]) => id === comp.folder);
  if (!folder) return [];
  const [id, , , kind] = folder;
  const { screen } = view;
  if (id === "network" && view.netmap) return [netMapNode(view.netmap)];
  if (id === "shiplog") {
    return view.device.shipLog.map((entry) => el("div", { class: "row-item navcom-line" },
      el("span", {}, el("small", {}, entry.day), " ", entry.text),
      el("button", { disabled: comp.sending, title: "Strike this line from the ship's log", onclick: (event) => { event.stopPropagation(); send({ action: "device", id: `nav-strike:${entry.i}` }); } }, "Strike")));
  }
  if (id === "crew") {
    const crew = view.device.crew;
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
  if (id === "rig") {
    return view.rig.loaded.map((item) => el("button", { class: `row-item${item.why ? " done" : ""}`, title: item.why ? `It won't run here: ${item.why}` : item.about, disabled: comp.sending, onclick: (event) => { event.stopPropagation(); send({ action: "rig", id: item.id }); } },
      picture("exe"), el("span", {}, item.name), el("small", {}, item.why ? "won't run here" : "run")));
  }
  return folderItems(view, id).map((item) => item.copy ? el("button", { class: `row-item${item.why ? " done" : ""}`, title: item.why ? `Can't copy it: ${item.why}` : item.about, disabled: comp.sending || Boolean(item.why), onclick: (event) => { event.stopPropagation(); send({ action: "copy", id: item.id }); } },
    picture("rig"), el("span", {}, `Copy ${item.name} to your rig`), el("small", {}, item.why ? "can't reach" : "copy")) : el("button", {
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

function osNode(view, watch) {
  const navcom = view.look === "navcom";
  const here = view.locked ? [] : foldersHere(view);
  const icons = el("div", { class: "icons" }, here.map(([id, name, pic]) => el("button", {
    class: `icon${comp.sel === id ? " sel" : ""}`,
    title: `${name}: ${folderItems(view, id).length}`,
    onclick: (event) => {
      event.stopPropagation();
      if (comp.sel === id) openFolder(id);
      else {
        comp.sel = id;
        draw();
      }
    },
    ondblclick: (event) => { event.stopPropagation(); openFolder(id); },
  }, picture(pic), el("span", {}, `${name} (${folderItems(view, id).length})`))));
  const folder = allFolders(view).find(([id]) => id === comp.folder);
  const list = !view.locked && folder && winNode("list", `${folder[1]} - ${view.name}`, folder[2], el("div", { class: "pane-in sunk" }, el("div", { class: "rows" }, folderRows(view))), [folder[0] === "rig" ? `${view.rig.used} of ${view.rig.memory} blocks used` : `${folderItems(view, folder[0]).length} ${folder[0] === "mail" ? "letters" : "objects"}`, comp.sending ? "Working..." : folder[0] === "rig" ? "Click one to run it" : folder[0] === "shiplog" ? "Strike a line to take it out" : folder[0] === "crew" ? "Restricted: the first officer's" : folder[0] === "network" && view.netmap ? `Each hop: ${view.netmap.hop.minutes} min, heard at both ends` : "Click one to open it"]);
  const viewer = !view.locked && winNode("view", view.screen.kind === "home" ? `Welcome - ${view.name}` : view.screen.title ?? view.name, "txt", el("div", { class: "pane-in sunk viewer-in", id: "computer-screen" }, screenNode(view)), [view.hacked ? "Hacked" : view.yours ? "Yours" : "Logged in", view.className]);
  const log = winNode("log", "Session log", "log", el("div", { class: "pane-in sunk", id: "computer-console", role: "log" }, view.log.map((entry, i) => lineNode(entry, i >= comp.seen))), [`${view.actions} ${view.actions === 1 ? "action" : "actions"}`, view.prompt ?? ""]);
  const named = { list: list ? `${folder[1]}` : null, view: viewer ? "Viewer" : null, log: "Session log" };
  const tasks = el("div", { class: "tasks" }, Object.entries(comp.wins).filter(([id, w]) => w.open && named[id]).map(([id]) => el("button", { class: comp.top === id ? "on" : "", onclick: (event) => { event.stopPropagation(); raise(id); draw(); } }, named[id])));
  const menu = comp.menu && el("div", { class: "menu bev" }, el("div", { class: "side" }, navcom ? "NAVCOM 7" : "KEELWORKS 4.1"), el("div", { class: "items" },
    here.map(([id, name, pic]) => el("button", { onclick: (event) => { event.stopPropagation(); comp.menu = false; openFolder(id); } }, picture(pic), name)),
    el("hr"),
    el("button", { onclick: (event) => { event.stopPropagation(); comp.menu = false; comp.wins.log.open = true; raise("log"); draw(); } }, picture("log"), "Session log"),
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
      rigHeatNode(view),
      el("span", { title: "The ship's time" }, clockText())));
  // NAVCOM 7's bar along the top, with SENTRY's meter when it's listening.
  const bar = navcom && el("div", { class: "navcom-top" }, el("span", {}, "RESTRICTED · CFS MERIDIAN · NAVCOM 7"),
    watch && el("span", { class: `navcom-sentry ${watch.stage}`, title: `${watch.name}: ${watchWords(watch).toLowerCase()}` }, watch.name, Array.from({ length: watch.cuts }, (_, i) => el("i", { class: i < watch.noise ? "on" : "" }))));
  const os = el("div", { class: `os${navcom ? " navcom" : ""}`, onclick: () => { if (comp.menu) { comp.menu = false; draw(); } } }, bar, icons, list, viewer, view.locked && logonNode(view), log, balloon, taskbar, menu);
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

function advisorNode(view) {
  if (!view.hints?.length) return null;
  if (!comp.advisor) return el("button", { class: "desk-hints", title: "Bring the hints back", onclick: (event) => { event.stopPropagation(); toggleAdvisor(); } }, "HINTS");
  return el("aside", { class: "desk-advisor", id: "computer-advisor", "aria-label": "Hints" },
    el("header", {}, el("span", {}, `ADVISOR: ${view.tierName.toUpperCase()}`), el("button", { title: "Put the hints away", onclick: (event) => { event.stopPropagation(); toggleAdvisor(); } }, "x")),
    el("div", { class: "lines", id: "computer-hints" }, view.hints.map((text) => el("div", {}, text))));
}

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
      class: `net-node net-${node.kind}${node.here ? " here" : ""}${node.linked ? " near" : ""}${node.visited ? " seen" : ""}`,
      style: `left:${at[node.id].x}px;top:${at[node.id].y}px;max-width:${NET_MAP.box}px;max-height:${NET_MAP.boxHeight}px`,
      disabled: comp.sending || !node.linked,
      title: node.here ? `${node.name}: you're on this one` : node.linked ? `Go to ${node.name}: ${map.hop.minutes} min, heard here and there` : `${node.name}: not linked to where you are`,
      onclick: (event) => {
        event.stopPropagation();
        comp.hopping = true;
        send({ action: "hop", id: node.id });
      },
    }, el("small", {}, NET_KIND[node.kind] ?? ""), el("span", { class: "nm" }, node.name))));
}

// How hot the rig is, in the tray: nothing's plugged into the player's own computers.
const rigHeatNode = (view) => view.rigHeat && el("span", { class: `rig-heat${view.rigHeat.overheating ? " hot" : view.rigHeat.fan ? " warm" : ""}`, title: `Your rig: ${view.rigHeat.dead ? `it won't start, ${view.rigHeat.dead}` : view.rigHeat.words}` }, view.rigHeat.dead ? "Rig off" : `Rig ${view.rigHeat.words.split(":")[0]}`);

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
  const frame = el("div", { class: `device-frame device-${look}`, title: "Pull the frame to move it aside" },
    comp.message && el("div", { class: "desk-note" }, comp.message),
    head, face, seen,
    // At its logon, what gets past it is on the rig beside it; inside, the panel's own buttons (a junction box's are its menu).
    view.locked ? el("div", { class: "device-note" }, "Locked: what gets you past it is on your rig, under D:.") : look === "service" ? null : actsNode(d.actions),
    el("div", { class: "device-log", id: "computer-console", role: "log" }, log.map((entry, i) => lineNode(entry, view.log.length - log.length + i >= comp.seen))),
    el("div", { class: "device-foot" },
      el("button", { disabled: comp.sending, onclick: (event) => { event.stopPropagation(); logOff(); } }, d.leave ?? "Log off")));
  const narrow = pocketRoom() < 960;
  return el("div", { class: `desk device${narrow ? " narrow" : ""}`, id: "computer-window", role: "dialog", "aria-label": view.name, tabindex: "-1" },
    el("div", { class: "device-row" }, frame, leadNode(view), pocketNode(view, narrow)),
    advisorNode(view));
}

// ---- Your rig, beside a panel with no screen of its own ----------------------------------------------------------
// A pocket computer with your board and casing on it, its link and heat lights, wired to the panel the way it's
// plugged in, and on its screen the place's network (NET), what's loaded on it (D:) and the session (LOG).

// What the floating window has across: the screen, less the rail of menus and its own margins. When the screen changes
// size, the window beside a panel is drawn again for the room there is.
let pocketResize = 0;
if (typeof window !== "undefined") window.addEventListener("resize", () => {
  cancelAnimationFrame(pocketResize);
  pocketResize = requestAnimationFrame(() => { if (comp.view && PANEL_LOOKS.includes(comp.view.look) && document.getElementById("computer")) draw(); });
});
function pocketRoom() {
  const game = document.querySelector(".game");
  const rail = game ? parseFloat(getComputedStyle(game).getPropertyValue("--rail-width")) || 0 : 0;
  return (game?.clientWidth || window.innerWidth) - rail - 32;
}

// How wide the rig's map can be: the panel's window, the lead and the rig's case take their room first, and the map has
// the rest, from 300 to its own width. The hints stand beside them where there's room, and under them where there isn't.
function pocketMapWidth(narrow) {
  return Math.round(Math.max(300, Math.min(NET_MAP.width, pocketRoom() - (narrow ? 300 : 380) - (narrow ? 26 : 56) - 52)));
}

// The lead from the rig to the panel, by how it's plugged in: a clip lead to a junction box, the optical reader's red
// beam to a keypad, radio to a camera. Over the network it's the network, a dashed line; not plugged in, nothing.
const LEADS = {
  clip: '<svg viewBox="0 0 56 180" preserveAspectRatio="none"><path d="M56 96 C 40 96, 34 70, 22 74 S 8 92, 2 92" fill="none" stroke="#c8352c" stroke-width="3"/><path d="M56 104 C 42 104, 30 120, 18 112 S 6 98, 2 98" fill="none" stroke="#222" stroke-width="3"/><rect x="0" y="86" width="9" height="18" rx="2" fill="#9aa09b" stroke="#333"/></svg>',
  optic: '<svg viewBox="0 0 56 180" preserveAspectRatio="none"><line x1="54" y1="96" x2="4" y2="96" stroke="#ff5a4a" stroke-width="2" stroke-dasharray="3 4"/><circle cx="4" cy="96" r="4" fill="#ff5a4a" opacity=".85"/><rect x="44" y="88" width="12" height="16" rx="2" fill="#4a4d50" stroke="#111"/></svg>',
  radio: '<svg viewBox="0 0 56 180" preserveAspectRatio="none"><g fill="none" stroke="#8ff0a8" stroke-width="2" opacity=".85"><path d="M44 84 Q 36 96 44 108"/><path d="M34 78 Q 22 96 34 114"/><path d="M24 72 Q 8 96 24 120"/></g><rect x="48" y="90" width="8" height="12" rx="2" fill="#4a4d50" stroke="#111"/></svg>',
  cable: '<svg viewBox="0 0 56 180" preserveAspectRatio="none"><path d="M56 96 C 36 96, 30 110, 16 104 S 6 96, 2 96" fill="none" stroke="#1a1a1a" stroke-width="4"/><rect x="0" y="90" width="8" height="12" rx="1" fill="#777" stroke="#333"/></svg>',
  navy: '<svg viewBox="0 0 56 180" preserveAspectRatio="none"><path d="M56 96 C 36 96, 30 110, 16 104 S 6 96, 2 96" fill="none" stroke="#2d3f5c" stroke-width="6"/><rect x="0" y="88" width="10" height="16" rx="2" fill="#8ab8ff" stroke="#1d2b38"/></svg>',
  net: '<svg viewBox="0 0 56 180" preserveAspectRatio="none"><line x1="54" y1="96" x2="2" y2="96" stroke="#4fa3d9" stroke-width="2" stroke-dasharray="5 4"/></svg>',
};
function leadNode(view) {
  const kind = view.reach?.remote ? "net" : view.reach?.ok ? view.reach.link : null;
  const box = document.createElement("template");
  box.innerHTML = (kind && LEADS[kind]) || "";
  return el("div", { class: "rig-lead", "aria-hidden": "true" }, box.content.firstChild);
}

const POCKET_TABS = [["net", "NET", "The place's network: go along it from here"], ["prog", "D:", "What's loaded on your rig, to run here"], ["log", "LOG", "What's happened at this one"]];
function pocketNode(view, narrow) {
  const face = view.rigFace ?? {};
  const reach = view.reach ?? {};
  const plugged = Boolean(reach.ok);
  const heat = view.rigHeat;
  const tab = comp.rigTab ?? (view.locked ? "prog" : "net");
  const width = pocketMapWidth(narrow);
  const tall = view.netmap ? layOutNetMap(view.netmap, width).height : 0;
  const note = (text) => el("div", { class: "pocket-note" }, text);
  let page;
  if (heat?.dead) page = note(`It won't start: ${heat.dead}.`);
  else if (tab === "net") page = !plugged ? note(`Not plugged in: this takes ${reach.words}, and the map shows here once your rig has one. Fit it on the Rig page.`) : view.locked ? note("Get past its logon first: the map shows here once you're in.") : view.netmap ? netMapNode(view.netmap, width) : note("This isn't on the place's network.");
  else if (tab === "prog") page = pocketPrograms(view);
  else page = el("div", { class: "pocket-log" }, view.log.slice(-14).map((entry) => lineNode(entry)));
  const light = (cls, label, title) => el("span", { class: "pocket-light", title }, el("i", { class: `lamp${cls ? ` ${cls}` : ""}` }), label);
  const linkTitle = reach.remote ? "Over the network, from where it's plugged in" : plugged ? `Plugged in by ${reach.words}` : `Not plugged in: this takes ${reach.words}`;
  const heatTitle = heat ? `Your rig: ${heat.dead ? `it won't start, ${heat.dead}` : heat.words}` : "Your own ship's: nothing works your rig hard";
  const where = reach.remote ? "OVER THE NETWORK" : plugged ? `ON THE ${String(reach.words ?? "").replace(/^(an?|the) /i, "").toUpperCase()}` : "NOT PLUGGED IN";
  return el("div", { class: "pocket", role: "group", "aria-label": "Your rig", title: "Pull the frame to move it aside" },
    el("div", { class: "pocket-top" },
      el("span", {}, [face.board, face.casing].filter(Boolean).join(" · ").toUpperCase() || "YOUR RIG"),
      el("span", { class: "pocket-lights" },
        light(reach.remote ? "net" : plugged ? "on" : "", "LINK", linkTitle),
        light(!heat || heat.dead ? "" : heat.overheating ? "hot" : heat.fan ? "warm" : "cool", "HEAT", heatTitle))),
    el("div", { class: "pocket-screen" },
      el("div", { class: "pocket-tabs", role: "tablist", "aria-label": "Your rig's pages" },
        POCKET_TABS.map(([id, label, about]) => el("button", { role: "tab", "aria-selected": String(tab === id), title: about, onclick: (event) => { event.stopPropagation(); comp.rigTab = id; draw(); } }, label)),
        el("span", { class: "pocket-where" }, where)),
      el("div", { class: "pocket-page", style: `width:${width}px;min-height:${Math.max(tall, 120)}px` }, page)),
    el("div", { class: "pocket-bottom" },
      el("span", {}, `${view.rig?.used ?? 0} OF ${view.rig?.memory ?? 0} BLOCKS`),
      view.netmap && plugged && !view.locked && el("span", {}, `${view.netmap.hop.minutes} MIN A HOP`)));
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
  const monitor = el("div", { class: "monitor", title: "Pull the frame to move it aside" },
    comp.message && el("div", { class: "desk-note" }, comp.message),
    glass,
    el("div", { class: "plate" }, el("span", {}, "VARNE 15SX"), el("span", { class: `led${watch?.stage === "tracing" ? " bad" : watch?.stage === "noticed" ? " warn" : ""}` })));
  return el("div", { class: "desk", id: "computer-window", role: "dialog", "aria-label": view.name, tabindex: "-1" }, monitor, advisorNode(view));
}

// It floats over the room the way the check window does, with nothing dimmed behind it and the clock running on, can be
// pulled aside by the monitor's frame and slides back, and a line runs from it to what the player sat down at.
export function computerNode() {
  sync();
  if (!computerOpen()) return null;
  fitter?.disconnect();
  const node = el("div", { class: "check-float", id: "computer" }, leaderNode(comp.view?.at), pullable(windowNode()));
  // The lines that came with the last answer type out once: drawing the desktop again for a click doesn't retype them.
  comp.seen = comp.view?.log?.length ?? 0;
  return node;
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
