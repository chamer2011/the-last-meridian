// The browser side of the game: draws the screens and talks to the local server.

import { creatorScreen, initCreator, openCreator, resetCreator } from "./creator.js";
import { checkNode, checkOpen, focusCheck, initCheck, resetCheck, startChoiceCheck, startPractice } from "./check.js";
import { api, el, meter, readLines } from "./dom.js";
import { fightNode, fightOpen, focusFight, initFight, resetFight, startSim } from "./fight.js";
import { initMap } from "./map.js";
import { initShip } from "./ship.js";
import { initCommand } from "./command.js";
import { openBoard } from "./board.js";
import { openMapEditor } from "./mapedit.js";
import { MENUS, MENU_GROUPS, initMenus } from "./menus.js";
import { choicesFor, dropStaleTooltip, initStory, loreCatalog, optionContent, setStoryContext, storyEntryNode, thinkingNode } from "./story-view.js";
import { focusTalk, initTalk, resetTalk, startTalk, talkNode, talkOpen } from "./talk.js";
import { computerNode, computerOpen, focusComputer, initComputer, resetComputer } from "./computer.js";
import { bagNode, bagOpen, initBag, openBag, resetBag, toggleBag } from "./bag.js";
import { initSheet, openPersonSheet, openSheetAt, resetSheet, sheetNode, toggleSheet } from "./sheet.js";
import { drawQuests, initQuests, questTrackerNode, questsOpen, resetQuests } from "./quests.js";
import { beginScene, initPopups, openPopups, popupDrawn, popupNext, popupsAttached, updatePopups } from "./popups.js";
import { INTERFACE_SIZES, interfaceZoom } from "./scene.js";
import { focusThing, initWalk, keepClear, markPoint, newsBehindMenu, placeHere, popupsShown, putAwayRoomWindows, renderWalk, resetWalk, roomShownForFight, showWholeStory, thingNode, thingOpen, toggleClock, walkShown, walkViewNode } from "./walk.js";
import { bringIntoRoom, fightInRoom, initLive, liveElsewhereNode, liveOn, liveSettled, resetLive } from "./live-fight.js";
import { aimWith } from "./float.js";
import { WRITING_SPEEDS } from "./writer.js";

const app = document.getElementById("app");

const ui = {
  game: null,
  saves: [],
  setup: null,
  screen: "title",
  tab: "leads",
  sideOpen: false,
  streaming: false,
  waiting: false,
  liveEntries: [],
  followStream: true,
  renderedCount: 0,
  menuFocus: null,
  peopleFilter: "all",
  mapSelected: null,
  codexSearch: "",
  error: null,
  menuMessage: null,
  draft: "",
  consoleLines: [],
};

// ---- Reading preferences ------------------------------------------------

const READING_KEY = "meridian-reading";
const reading = { font: "book", size: 17, view: "iso", tiles: "techlab", chosen: true, story: "popups", popFont: "terminal", writing: "normal", interface: "auto" };
const textSizes = { min: 13, max: 26 };

function applyReading() {
  document.documentElement.dataset.storyFont = reading.font;
  document.documentElement.dataset.popFont = reading.popFont;
  document.documentElement.style.setProperty("--story-size", `${reading.size}px`);
  applyInterface();
}

// How big everything's drawn: it follows the size of the window, or the player's own choice.
function applyInterface() {
  const zoom = interfaceZoom(reading.interface, window.innerWidth, window.innerHeight);
  document.documentElement.style.zoom = zoom === 1 ? "" : String(zoom);
}

function loadReading() {
  try {
    const saved = JSON.parse(localStorage.getItem(READING_KEY));
    if (saved?.font === "book" || saved?.font === "terminal") reading.font = saved.font;
    if (Number.isInteger(saved?.size)) reading.size = Math.max(textSizes.min, Math.min(textSizes.max, saved.size));
    // A view picked before the game went isometric doesn't count. One picked since then does.
    if (saved?.chosen && (saved.view === "classic" || saved.view === "walk" || saved.view === "iso" || saved.view === "top")) reading.view = saved.view;
    if (saved?.tiles === "techlab" || saved?.tiles === "interior") reading.tiles = saved.tiles;
    if (saved?.story === "popups" || saved?.story === "box" || saved?.story === "panel") reading.story = saved.story;
    if (saved?.popFont === "terminal" || saved?.popFont === "book") reading.popFont = saved.popFont;
    if (saved?.writing in WRITING_SPEEDS) reading.writing = saved.writing;
    if (saved?.interface in INTERFACE_SIZES) reading.interface = saved.interface;
  } catch {
    // Without saved preferences, the defaults are fine.
  }
  applyReading();
}

function changeReading(change) {
  Object.assign(reading, change);
  try {
    localStorage.setItem(READING_KEY, JSON.stringify(reading));
  } catch {
    // The change still applies until the page is closed.
  }
  applyReading();
  // Switching the story view changes the whole screen, not just the menu it's in.
  if (change.view || change.story || change.tiles) render();
  else renderMenus();
}

// ---- Helpers ------------------------------------------------------------

function runAction(fn) {
  return async (...args) => {
    ui.menuMessage = null;
    try {
      await fn(...args);
    } catch (err) {
      ui.menuMessage = { ok: false, text: err.message };
    }
    render();
  };
}

// ---- Playing a turn of the story ---------------------------------------------

async function sendChat(body) {
  if (ui.streaming) return;
  ui.streaming = true;
  ui.followStream = true;
  ui.error = null;
  ui.consoleLines = [];
  ui.liveEntries = body.text ? [{ role: "player", text: body.text }] : [];
  ui.draft = "";
  // Anything that moves the story on leaves a talk first, and the server does the same.
  if (ui.game) ui.game.talk = null;
  beginScene();
  render();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const { error } = await res.json();
      // This page may be behind the game, after a reload or in a second tab, so it catches up first.
      await refreshAll();
      // If what was in the way is a fight or a check, it's on screen now, and that says it all.
      if (!ui.game?.combat && !ui.game?.check) throw new Error(error ?? "Something went wrong.");
      ui.streaming = false;
      ui.liveEntries = [];
      render();
      return;
    }

    await readLines(res, (line) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      if (msg.type === "text") {
        // Narration and game messages stay in the order they happened.
        const last = ui.liveEntries.at(-1);
        if (last?.role === "narrator") last.text += msg.text;
        else ui.liveEntries.push({ role: "narrator", text: msg.text });
        updateLive();
      } else if (msg.type === "notice") {
        ui.liveEntries.push({ role: "notice", text: msg.text });
        updateLive();
      } else if (msg.type === "state") {
        ui.game = msg.state;
        setStoryContext(ui.setup, ui.game);
        renderMenus();
        renderStatus();
        renderWalk();
      } else if (msg.type === "done") {
        ui.game = msg.state;
      } else if (msg.type === "error") {
        ui.game = msg.state;
        ui.error = { message: msg.message, retry: body };
      }
    });
  } catch (err) {
    ui.error = { message: err.message, retry: body };
  }
  // If it failed, what they typed goes back in the box, so it isn't lost.
  if (ui.error && body.text) ui.draft = body.text;
  ui.streaming = false;
  ui.liveEntries = [];
  render();
}

// ---- Title screen and starting a game -----------------------------------

const SLOT_LABELS = { autosave: "Autosave", previous: "Previous game", slot1: "Slot 1", slot2: "Slot 2", slot3: "Slot 3" };

function titleScreen() {
  const saves = ui.saves.filter((s) => !s.empty);
  return el("div", { class: "screen stack" },
    el("div", {},
      el("div", { class: "boot" }, "MERIDIAN-OS 4.1 // CFS MERIDIAN\n[ OK ] Reactor: unstable but online\n[ OK ] Ship's systems: 900 souls aboard\n[WARN] Fuel: two weeks at this rate"),
      el("h1", { class: "title" }, "Almagest Explorer's"),
      el("p", { class: "subtitle" }, "Nine hundred survivors. One battered ship. The chair is yours."),
    ),
    el("div", { class: "row" },
      el("button", { class: "primary", onclick: runAction(async () => { ui.screen = "create"; await openCreator(ui.setup); }) }, "New game"),
      ui.game && el("button", { onclick: () => { ui.screen = "game"; render(); startIfUntold(); } }, `Continue as ${ui.game.name}`),
    ),
    ui.menuMessage && !ui.menuMessage.ok && el("div", { class: "notice-inline fail" }, ui.menuMessage.text),
    saves.length > 0 && el("h3", { class: "muted small" }, "Saved games"),
    saves.map((s) => el("div", { class: "card spread" },
      el("div", {}, el("strong", {}, s.name), ` · level ${s.level} · ${s.location}`,
        el("div", { class: "muted small" }, `${SLOT_LABELS[s.slot]}, ${new Date(s.savedAt).toLocaleString()}`)),
      el("button", { onclick: runAction(async () => loadGame(s.slot)) }, "Load"),
    )),
  );
}

async function loadGame(slot) {
  const { game, saves } = await api("/api/load", { slot });
  resetFight();
  resetLive();
  resetCheck();
  resetWalk();
  resetTalk();
  resetComputer();
  resetBag();
  resetSheet();
  resetQuests();
  ui.game = game;
  ui.saves = saves;
  ui.screen = "game";
  ui.sideOpen = false;
  ui.error = null;
  ui.consoleLines = [];
  render();
  startIfUntold();
}

// A game whose story hasn't begun begins it by itself: there's no button for it, and nothing at the bottom of the room.
function startIfUntold() {
  if (ui.screen === "game" && ui.game && !ui.game.transcript.length && !ui.streaming && !ui.waiting && !ui.error) sendChat({ event: "start" });
}

async function startNewGame(draft) {
  const { game, saves } = await api("/api/new", { draft });
  resetFight();
  resetLive();
  resetCheck();
  resetWalk();
  resetTalk();
  resetComputer();
  resetBag();
  resetSheet();
  resetQuests();
  ui.game = game;
  ui.saves = saves;
  ui.screen = "game";
  ui.tab = "leads";
  ui.sideOpen = false;
  ui.error = null;
  ui.consoleLines = [];
  resetCreator();
  render();
  sendChat({ event: "start" });
}

// ---- Main game screen ---------------------------------------------------

function statusNode() {
  const g = ui.game;
  return el("div", { class: "statusbar", id: "status" },
    // The player's name opens their registry printout, as C does. A star by it says there are points to spend on it.
    el("button", { class: "status-name", title: "Your registry printout (C): your record, skills, perks, beliefs and past", onclick: (event) => { event.currentTarget.blur(); toggleSheet(); } }, g.name, pointsWaiting(g) && el("span", { class: "status-alert", title: pointsWaiting(g) }, " *")),
    el("span", { class: "muted" }, `LVL ${g.level}`),
    meter("HP", g.hp, g.maxHp), meter("EN", g.energy, g.maxEnergy),
    el("span", { class: g.needs.stress >= 50 ? "meter low" : "" }, `STRESS ${g.needs.stress}`),
    el("span", { class: g.needs.fatigue >= 60 ? "meter low" : "" }, `FATIGUE ${g.needs.fatigue}`),
    // Everything wrong with them, wounds from fights included, and their blood while a wound's still open: the registry
    // printout says what and where, and a medkit or the medbay stops the bleeding.
    (g.hurt ?? g.conditions.length) > 0 && el("span", { class: "meter low", title: "What's wrong with you is on your registry printout (C), under CONDITION and BODY" }, `HURT ${g.hurt ?? g.conditions.length}`),
    g.bleeding && el("span", { class: "meter low", title: `You're losing ${g.bleeding.rate} blood an hour. Dress the wound with a medkit, or get to a medbay.` }, `BLEEDING ${g.bleeding.blood}`),
    el("span", {}, `CR ${g.credits}`),
    !g.role.captain && el("span", {}, g.role.short.toUpperCase()),
    g.role.captain && el("span", { class: g.ship.fuel < 2 ? "meter low" : "" }, `FUEL ${g.ship.fuel}`),
    g.role.captain && g.ship.shortages.length > 0 && el("span", { class: "meter low" }, `SHORT: ${g.ship.shortages.join(", ").toUpperCase()}`),
    el("span", { class: "muted" }, `${g.clock.label} @ ${g.location.name}`),
    el("button", { class: "mobile-toggle", onclick: () => openMenu(ui.tab) }, "Menu"),
  );
}

// The numbered choices on offer right now. Each can be clicked, or picked by typing its number.
function currentOptions() {
  const g = ui.game;
  // A fight, a check or a talk has its own window, with its own choices.
  if (ui.streaming || ui.waiting || g.combat || g.check || g.talk || g.computer) return [];
  // After a fight or a check, the game waits. The story only goes on when the player says to carry on.
  const carryOn = [{ label: "Continue the story", detail: "the story picks it up from here", run: () => sendChat({ event: "continue" }) }];
  if (g.storyWaiting) return carryOn;
  // A written part waiting on someone the player isn't with has nothing to answer yet: the tracker says who to go to.
  if (g.scene?.held) return [];
  // With no scene being played there's nothing to choose, whatever the story's last words were.
  if (!g.scene) return [];
  return choicesFor(g.transcript).map((choice) => ({ ...choice, run: () => takeChoice(choice) }));
}

// Talking to someone: a quest whose scene is waiting on them goes on with it, and anyone else has a talk. With their
// choices already on screen, it's shown again rather than told again.
function talkTo(key) {
  const g = ui.game;
  const waiting = g.questLog?.quests.some((quest) => quest.status === "active" && quest.step?.person === key && quest.step.state === "here");
  if (!waiting) return startTalk(key);
  const last = [...g.transcript].reverse().find((entry) => entry.role === "narrator");
  if (g.scene?.with === key && g.scene.told && !g.scene.held && last?.scene === g.scene.id && popupsShown()) {
    openPopups();
    return;
  }
  return sendChat({ event: "meet", person: key });
}

// A choice with a check on it opens the check's window, and the story goes on from how it went.
function takeChoice(choice) {
  if (!choice.tags?.some((tag) => tag.kind === "check" && tag.difficulty)) return sendChat({ text: choice.label });
  return startChoiceCheck(choice.label)
    .catch(async (err) => {
      // Usually this means the page is behind the game, so it catches up, and says why nothing opened.
      await refreshAll();
      ui.consoleLines = [{ role: "error", text: err.message }];
    })
    .then(render);
}

const helpText = (g) => `Type what you want to do, or the number of a listed choice.

${Object.values(MENUS).filter((m) => !m.captainOnly || g.role.captain).map((m) => `/${m.command.padEnd(10)}${m.label}`).join("\n")}
/close     close the open menu
/clear     clear this help text
/help      show this list`;

// Points to spend on the registry printout, in words, or nothing.
function pointsWaiting(g) {
  const parts = [[g.statPoints, "attribute"], [g.skillPoints, "skill"], [g.perkPoints, "perk"]].filter(([n]) => n > 0).map(([n, word]) => `${n} ${word} point${n === 1 ? "" : "s"}`);
  return parts.length ? `${parts.join(", ")} to spend` : "";
}

// What used to be menus under You are pages of the registry printout now, and their old commands still open them.
const SHEET_PAGES = { char: "record", character: "record", traits: "record", skills: "skills", perks: "perks", beliefs: "beliefs", dossier: "past", past: "past" };

function runCommand(text) {
  const name = text.slice(1).split(/\s+/)[0].toLowerCase();
  if (SHEET_PAGES[name]) {
    ui.consoleLines = [];
    render();
    openSheetAt(SHEET_PAGES[name]);
    return;
  }
  const menu =Object.entries(MENUS).find(([, m]) => (!m.captainOnly || ui.game.role.captain) && (m.command === name || m.label.toLowerCase() === name));
  if (name === "help") ui.consoleLines = [{ role: "console", text: helpText(ui.game) }];
  else if (name === "clear") ui.consoleLines = [];
  else if (name === "close") closeMenu();
  else if (menu) {
    render();
    openMenu(menu[0]);
    return;
  } else ui.consoleLines = [{ role: "error", text: `Unknown command: ${text}. Type /help for the list.` }];
  render();
}

function submitPrompt() {
  const text = ui.draft.trim();
  if (!text) return;
  ui.draft = "";
  ui.consoleLines = [];
  if (text.startsWith("/")) return runCommand(text);

  const options = currentOptions();
  if (/^\d+$/.test(text) && options.length) {
    const option = options[Number(text) - 1];
    if (!option) ui.consoleLines = [{ role: "error", text: `There's no choice ${text}.` }];
    else if (option.disabled) ui.consoleLines = [{ role: "error", text: `${option.label}: ${option.why ?? "not available right now"}.` }];
    else return option.run();
    return render();
  }
  sendChat({ text });
}

function composerNode() {
  const g = ui.game;
  const options = currentOptions();
  const needsStart = g.transcript.length === 0 && !ui.streaming && !ui.waiting && !ui.error;
  // Over the room, the choices hang off the pane of whoever's being answered, so the typing line is all this has.
  const over = popupsShown();
  const hint = ui.streaming || ui.waiting ? "processing..."
    : g.storyWaiting ? "press 1 to carry on"
      : over ? "type a choice or its number, then Enter; Esc puts this away" : "type a choice, its number, or /help";
  return el("div", { class: "composer" }, el("div", { class: "composer-inner" },
    !over && options.length > 0 && el("div", { class: "options" }, options.map((o, i) => el("button", { disabled: o.disabled, onclick: o.run }, el("span", { class: "option-number" }, `${i + 1})`), optionContent(o)))),
    needsStart
      ? el("div", {}, el("button", { class: "primary", onclick: () => sendChat({ event: "start" }) }, "Start the story"))
      : el("div", { class: "prompt-line" },
        el("label", { class: "prompt", for: "composer" }, g.role.captain ? "captain@meridian:~$" : `${g.role.short.replaceAll(" ", "-")}@${g.location.id.replaceAll("_", "-")}:~$`),
        el("input", {
          id: "composer",
          type: "text",
          autocomplete: "off",
          spellcheck: "false",
          placeholder: hint,
          disabled: ui.streaming || ui.waiting || Boolean(g.combat) || Boolean(g.check) || Boolean(g.talk) || Boolean(g.computer),
          value: ui.draft,
          oninput: (e) => { ui.draft = e.target.value; },
          onkeydown: (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitPrompt();
            }
            // With nothing typed, Enter goes on to the next piece of the story.
            if (popupsShown() && e.key === "Enter" && !e.target.value.trim() && popupNext()) e.preventDefault();
            if (!walkShown()) return;
            // In a room, Esc gives the keys back to walking, and Space with nothing typed pauses the clock.
            if (e.key === "Escape") {
              e.preventDefault();
              e.target.blur();
            } else if (e.key === " " && !e.target.value.trim()) {
              e.preventDefault();
              toggleClock();
            }
          },
        })),
  ));
}

// With latest, only the newest scene is shown, for the panel under the level.
function logNode({ latest = false } = {}) {
  const inner = el("div", { class: "log-inner", id: "log-inner" });
  // Each thing the player does starts a new section, and so does the story picking up after a fight.
  // Only the latest section stands at full brightness.
  const turns = [];
  let previousRole = null;
  for (const entry of ui.game.transcript) {
    if (entry.role === "player" || !turns.length || (entry.role === "narrator" && previousRole === "combat")) turns.push([]);
    turns.at(-1).push(entry);
    previousRole = entry.role;
  }
  // Every redraw rebuilds what's shown here, so a long story keeps only its latest scenes on screen until asked.
  const hidden = latest ? Math.max(0, turns.length - 1) : ui.showWholeLog ? 0 : Math.max(0, turns.length - 150);
  if (hidden && !latest) inner.append(el("div", { class: "row" }, el("button", { onclick: () => { ui.showWholeLog = true; render(); } }, `Show the ${hidden} earlier scenes`)));
  turns.forEach((entries, i) => {
    if (i < hidden) return;
    const past = ui.streaming || i < turns.length - 1;
    inner.append(el("section", { class: `turn${past ? " past" : ""}` }, entries.map((entry) => storyEntryNode(entry))));
  });
  inner.append(el("section", { class: "turn live", id: "live" }));
  ui.consoleLines.forEach((entry) => inner.append(storyEntryNode(entry)));
  if (ui.error) {
    inner.append(el("div", { class: "entry error" }, ui.error.message, " ",
      el("div", { class: "row", style: "margin-top:8px" },
        el("button", { onclick: () => { const retry = ui.error.retry; ui.error = null; sendChat(retry); } }, "Try again"),
      )));
  }
  // Once the reader scrolls by themselves, the page stops following the text.
  const stopFollowing = () => { ui.followStream = false; };
  return el("div", { class: "log", id: "log", onwheel: stopFollowing, ontouchmove: stopFollowing }, inner);
}

function updateLive() {
  if (popupsShown()) {
    updatePopups();
    return;
  }
  const live = document.getElementById("live");
  if (!live) return;
  const nodes = ui.liveEntries.map((entry, i) => storyEntryNode(entry, { streaming: ui.streaming && i === ui.liveEntries.length - 1 }));
  const visible = nodes.filter(Boolean);
  const last = ui.liveEntries.at(-1);
  if (ui.streaming && (last?.role !== "narrator" || !nodes.at(-1))) visible.push(thinkingNode());
  live.replaceChildren(...visible);
  dropStaleTooltip();
  if (ui.streaming && ui.followStream) {
    // Keeps the start of the new text in view. The reader scrolls down when they're ready.
    const log = document.getElementById("log");
    const target = live.offsetTop - 12;
    if (log.scrollTop < target) log.scrollTop = target;
  }
}

function placeLog(previousTop, isNew) {
  const log = document.getElementById("log");
  if (!log) return;
  if (!isNew) {
    log.scrollTop = previousTop;
  } else if (ui.game.combat || ui.game.check || ui.consoleLines.length || ui.error) {
    log.scrollTop = log.scrollHeight;
  } else if (walkShown() && ui.game.transcript.at(-1)?.role === "notice") {
    // A line added under the story, such as the note a talk leaves, has to be in view in that small panel.
    log.scrollTop = log.scrollHeight;
  } else if (ui.game.storyWaiting || ui.followStream) {
    const turns = log.querySelectorAll(".turn:not(:empty)");
    if (ui.game.storyWaiting) log.scrollTop = log.scrollHeight;
    else log.scrollTop = turns.length ? turns[turns.length - 1].offsetTop - 12 : log.scrollHeight;
  } else {
    log.scrollTop = previousTop;
  }
}

// ---- Slide-over menus ---------------------------------------------------

const act = (body) => runAction(async () => {
  const { game, message } = await api("/api/action", body);
  ui.game = game;
  if (message) ui.menuMessage = { ok: true, text: message };
});

const menuAlerts = (g) => ({ ship: g.role.captain ? g.ship.shortages.length : 0 });

// The menus, in their groups, each group under its own heading, on the rail down the right edge and on the tabs of a
// narrow window. What a menu holds is on its tooltip, not on the screen.
function menuButtons(g) {
  const alerts = menuAlerts(g);
  return MENU_GROUPS.flatMap((group) => {
    const entries = group.ids.map((id) => [id, MENUS[id]]).filter(([, menu]) => !menu.captainOnly || g.role.captain);
    if (!entries.length) return [];
    return [el("div", { class: "rail-group" }, group.title), ...entries.map(([id, menu]) => el("button", {
      class: ui.sideOpen && id === ui.tab ? "active" : "",
      "aria-pressed": String(ui.sideOpen && id === ui.tab),
      title: menu.about,
      onclick: () => toggleMenu(id),
    }, menu.label, alerts[id] > 0 && el("span", { class: "badge" }, String(alerts[id]))))];
  });
}

const railNode = () => el("nav", { class: "rail", id: "rail", "aria-label": "Menus" }, menuButtons(ui.game));

function drawerNode() {
  const menu = MENUS[ui.tab];
  return el("aside", { class: `drawer${ui.sideOpen ? " open" : ""}`, id: "side", role: "dialog", "aria-label": menu.label, tabindex: "-1" },
    el("div", { class: "drawer-head" },
      el("h2", {}, menu.label),
      ui.menuMessage && el("div", { class: `notice-inline ${ui.menuMessage.ok ? "ok" : "fail"}` }, ui.menuMessage.text),
      el("button", { class: "drawer-close", onclick: closeMenu, title: "Or press Esc" }, "Close")),
    el("nav", { class: "drawer-tabs", "aria-label": "Menus" }, menuButtons(ui.game)),
    // Nothing is drawn inside a closed menu, so it costs nothing while it's hidden.
    el("div", { class: "menu-body" }, ui.sideOpen ? menu.view() : null));
}

const backdropNode = () => el("div", { class: `backdrop${ui.sideOpen ? " open" : ""}`, id: "backdrop", onclick: closeMenu });

function renderRail() {
  document.getElementById("rail")?.replaceWith(railNode());
}

// Redraws the open menu in place, keeping the reader's place in it.
function renderMenus({ animate = false } = {}) {
  if (ui.screen !== "game" || !ui.game) return;
  renderRail();
  if (!ui.sideOpen) return;
  const previous = document.getElementById("side");
  const body = previous?.querySelector(".menu-body");
  const sameMenu = previous?.getAttribute("aria-label") === MENUS[ui.tab].label;
  const top = sameMenu ? body?.scrollTop ?? 0 : 0;
  const node = drawerNode();
  previous?.replaceWith(node);
  document.getElementById("backdrop")?.classList.add("open");
  if (animate) {
    node.classList.remove("open");
    void node.offsetWidth; // Makes the browser notice the closed position, so it slides.
    node.classList.add("open");
    node.focus({ preventScroll: true });
  }
  node.querySelector(".menu-body").scrollTop = top;
}

// Brings a highlighted card into the middle of the open menu.
function showFocusedCard() {
  const body = document.querySelector("#side .menu-body");
  const card = body?.querySelector(".card.focused");
  if (!card) return;
  const offset = card.getBoundingClientRect().top - body.getBoundingClientRect().top;
  body.scrollTop += offset - (body.clientHeight - card.offsetHeight) / 2;
}

function openMenu(id, focus = null) {
  if (SHEET_PAGES[id]) {
    closeMenu();
    openSheetAt(SHEET_PAGES[id]);
    return;
  }
  // The story board is a whole screen of its own, not a drawer.
  if (MENUS[id]?.board) {
    closeMenu();
    openBoard();
    return;
  }
  // So is the map editor. The room behind it may have been redrawn by the time it's closed.
  if (MENUS[id]?.editor) {
    closeMenu();
    openMapEditor({ onClose: () => refreshAll() });
    return;
  }
  // The inventory is a window over the room, not a drawer. (The quest log is the tracker in the corner, grown, and the
  // registry printout opens from the player's name: neither is on the menu.)
  if (MENUS[id]?.window) {
    closeMenu();
    toggleBag();
    return;
  }
  const wasOpen = ui.sideOpen;
  ui.tab = id;
  ui.menuFocus = focus;
  ui.menuMessage = null;
  ui.sideOpen = true;
  renderMenus({ animate: !wasOpen });
  showFocusedCard();
}

function closeMenu() {
  if (!ui.sideOpen) return;
  ui.sideOpen = false;
  ui.menuFocus = null;
  ui.menuMessage = null;
  document.getElementById("side")?.classList.remove("open");
  document.getElementById("backdrop")?.classList.remove("open");
  renderRail();
  if (fightOpen()) focusFight();
  else if (checkOpen()) focusCheck();
  else if (talkOpen()) focusTalk();
  else if (computerOpen()) focusComputer();
  else if (thingOpen()) focusThing();
  else focusComposer();
  // What the clock brought while the menu was open.
  if (newsBehindMenu()) render();
}

// The typing line has the keys, unless there's a room to walk around in: there the keys walk, and the typing line is
// clicked, or Enter brings it up. Something half typed keeps it.
function focusComposer() {
  const composer = document.getElementById("composer");
  if (!composer) return;
  if (walkShown() && !ui.draft.trim()) {
    if (document.activeElement === composer) composer.blur();
    return;
  }
  composer.focus({ preventScroll: true });
}

function toggleMenu(id) {
  if (ui.sideOpen && ui.tab === id) closeMenu();
  else openMenu(id);
}

function toTitle() {
  ui.sideOpen = false;
  ui.screen = "title";
  refreshAll();
}

// ---- Drawing ------------------------------------------------------------

function renderStatus() {
  document.getElementById("status")?.replaceWith(statusNode());
}

function render() {
  if (ui.screen === "title") return app.replaceChildren(titleScreen());
  if (ui.screen === "create") return app.replaceChildren(creatorScreen());
  setStoryContext(ui.setup, ui.game);
  const previous = document.getElementById("log");
  const previousTop = previous?.scrollTop ?? 0;
  const previousMenu = document.querySelector("#side .menu-body");
  const sameMenu = document.getElementById("side")?.getAttribute("aria-label") === MENUS[ui.tab].label;
  const menuTop = sameMenu ? previousMenu?.scrollTop ?? 0 : 0;
  const count = ui.game.transcript.length + ui.consoleLines.length + (ui.error ? 1 : 0);
  const isNew = !previous || count !== ui.renderedCount;
  ui.renderedCount = count;
  app.replaceChildren(el("div", { class: "game" },
    el("main", { class: "story" }, statusNode(), walkShown() ? walkViewNode(logNode) : logNode(), !popupsShown() && !(liveOn() && walkShown()) && composerNode(), !walkShown() && questTrackerNode()),
    fightNode() ?? liveElsewhereNode(),
    checkNode(),
    talkNode(),
    computerNode(),
    bagNode(),
    !walkShown() && sheetNode(),
    thingNode(),
    railNode(),
    backdropNode(),
    drawerNode(),
  ));
  if (!popupsShown()) updateLive();
  // A fight that's just begun, with the room on screen, moves into it.
  bringIntoRoom();
  // The tracker first, since the story's panes keep out of its way, and then the room's panel, for the same reason.
  drawQuests();
  placeHere();
  popupsAttached();
  // In a fight in the room, after the story's popups have let go of the camera.
  if (liveOn()) liveSettled();
  dropStaleTooltip();
  if (!ui.streaming) placeLog(previousTop, isNew);
  if (fightOpen()) focusFight();
  if (checkOpen()) focusCheck();
  if (ui.sideOpen) {
    const body = document.querySelector("#side .menu-body");
    if (body) body.scrollTop = menuTop;
  } else if (talkOpen() && !fightOpen() && !checkOpen()) {
    focusTalk();
  } else if (computerOpen() && !fightOpen() && !checkOpen()) {
    focusComputer();
  } else if (thingOpen()) {
    focusThing();
  } else if (!fightOpen() && !checkOpen() && !ui.streaming) {
    focusComposer();
  }
}

async function refreshAll() {
  const data = await api("/api/state");
  ui.game = data.game;
  ui.saves = data.saves;
  ui.setup = data.setup;
  ui.waiting = Boolean(data.busy) && !ui.streaming;
  if (!ui.game && ui.screen === "game") ui.screen = "title";
  render();
  // A turn was already being played when this page loaded, so this looks again until it's done.
  if (ui.waiting) setTimeout(() => refreshAll().catch(() => {}), 1500);
}

loadReading();

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !ui.sideOpen) return;
  closeMenu();
  // That's all this press of Esc was for.
  e.preventDefault();
});
window.addEventListener("resize", applyInterface);
document.addEventListener("fullscreenchange", () => renderMenus());

initStory({
  // Clicking a highlighted word opens more about it in a menu.
  openEntry: (entry) => openMenu(entry.kind === "person" ? "people" : "codex", entry.id),
});

initMenus({
  ui,
  act,
  runAction,
  renderMenus,
  reading,
  changeReading,
  textSizes,
  toggleFullScreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
  loreCatalog,
  loadGame,
  toTitle,
  openMenu,
  startSim: (enemy, followers) => runAction(() => startSim(enemy, followers))(),
  startPractice: (skill, difficulty) => runAction(() => startPractice(skill, difficulty))(),
  followLead: (lead) => {
    closeMenu();
    sendChat({ text: `I look into this: ${lead.title}`, thread: lead.id });
  },
});

initFight({ ui, render, sendChat, openMenu, closeMenu, inRoom: fightInRoom });
initLive({ ui, render, renderStatus, sendChat, roomShown: roomShownForFight, showRoom: () => changeReading({ view: "iso", chosen: true }) });
initCheck({ ui, render, sendChat, openMenu, closeMenu });
initMap({ ui, render, runAction, renderMenus, openMenu, closeMenu });
initShip({ ui, render, runAction, renderMenus, openMenu, closeMenu });
initCommand({ ui, render, runAction, closeMenu, openPersonSheet });
initWalk({
  ui,
  reading,
  render,
  renderStatus,
  sendChat,
  startTalk,
  act,
  openBag,
  bagOpen,
  talkTo,
  questTracker: questTrackerNode,
  sheet: () => sheetNode({ inMap: true }),
  openPersonSheet,
  questsOpen,
  // A number key picks one of the story's choices, when there's nothing to type it into.
  pickOption: (n) => {
    const option = currentOptions()[n - 1];
    if (!option || option.disabled) return false;
    option.run();
    return true;
  },
});
initPopups({
  ui,
  reading,
  render,
  showWholeStory,
  // What can be said or done once a scene's been read.
  options: currentOptions,
  retry: () => {
    const { retry } = ui.error;
    ui.error = null;
    sendChat(retry);
  },
});
initTalk({ ui, reading, render, openMenu, popupsShown });
initComputer({ ui, render, openMenu });
initBag({ ui, render, renderStatus, renderWalk, putAway: putAwayRoomWindows });
initSheet({ ui, render, act, openMenu, startPractice: (skill, difficulty) => runAction(() => startPractice(skill, difficulty))() });
initQuests({ ui, render, placed: popupDrawn });
aimWith(markPoint, keepClear);

initCreator({
  render,
  begin: startNewGame,
  hasGame: () => Boolean(ui.game),
  exit: () => {
    ui.screen = "title";
    render();
  },
});

refreshAll().catch((err) => {
  app.replaceChildren(el("div", { class: "screen" }, `The game server isn't responding: ${err.message}`));
});
