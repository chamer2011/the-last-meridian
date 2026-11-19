// The game's local server. It only accepts connections from this computer.
// It holds the game, and the browser page talks to it. Everything runs here: there's no AI, and nothing goes online.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { portNow } from "./src/daily.js";
import { boardScene, boardStories, boardStory, boardWorldItem, boardWorldList, checkBoardScene, saveBoardScene, saveBoardStory, saveBoardWorldItem, saveLayout } from "./src/board.js";
import { deckForEditing, deckLook, editableMaps, tryDeck } from "./src/map-editor.js";
import { catalogue, licensedDir, setPieces } from "./src/pieces.js";
import { furnitureForPage, setFurniture, withFurniture } from "./src/pack-furniture.js";
import { isOrder } from "./src/room-hooks.js";
import { startIsOff } from "./src/role.js";
import { ensureContactFiles, newCampaignId, saveCaptainSheet } from "./src/campaign.js";
import { SKILLS } from "./src/character-data.js";
import { checkCommand, startCheck, startChoiceCheck } from "./src/checks.js";
import { combatView, simulatorFollowers } from "./src/combat.js";
import { goLive, liveOrder, liveTick } from "./src/live-fight.js";
import { buildCharacter, createGameFromDraft, creatorSetup, randomDraft } from "./src/creator.js";
import { shipCommand } from "./src/ship.js";
import { commandCommand } from "./src/command.js";
import { workCommand } from "./src/work.js";
import { noteLoreSeen } from "./src/lore.js";
import { migrateGame } from "./src/migrate.js";
import { StoryError, writtenTurn } from "./src/scenes.js";
import { followQuest } from "./src/quests.js";
import { advanceRequests } from "./src/requests.js";
import { openWrittenTalk, writtenTalkTurn } from "./src/talks.js";
import { dataDir, projectDir } from "./src/paths.js";
import {
  buy, buyPerk, captainSheet, clockFor, combatAction, equip, notePeopleSeen, publicState, raiseSkill, raiseStat, rest, sell, setDifficulty, startCombat, useItem, workShift,
} from "./src/rules.js";
import { personSheet } from "./src/person-sheet.js";
import { closeTalk, placeLevels, standingAt, talkCommand, talkHeard, talkLineOver, talkSaid, walkCommand, walkTick, walkView } from "./src/walk.js";
import { airBadHere, controlSystem, settlePart, systemsOf } from "./src/systems.js";
import { computerCommand, screenGoesDark } from "./src/computer-use.js";
import { afterDeedFight, settleDeed } from "./src/deeds.js";
import { bagCommand } from "./src/bag.js";
import { rigCommand } from "./src/rig.js";
import { clockWords } from "./src/ending.js";
import { playerFalls } from "./src/collapse.js";

const savesDir = path.join(dataDir(), "saves");
const publicDir = path.join(projectDir, "public");
const PORT = Number(process.env.PORT) || 3210;
// "previous" keeps the last game when a new one starts, in case that was a mistake.
// "test" is the test save tools/test-save.mjs makes (src/test-mode.js).
const SAVE_SLOTS = ["autosave", "previous", "slot1", "slot2", "slot3", "test"];
// The saves the game keeps by itself, one from each of the last three mornings of the game being played, for going
// back to once the player has died (src/ending.js). They aren't on the title screen: the ending offers them.
const MORNINGS = ["morning1", "morning2", "morning3"];
// A morning begins at six.
const MORNING_HOUR = 6;
// What the server says to anything asked of a game whose player has died.
const GAME_OVER = "This game is over. Go back to a morning the game kept, or start a new one.";

fs.mkdirSync(savesDir, { recursive: true });

// ---- Saves --------------------------------------------------------------

const savePath = (slot) => path.join(savesDir, `${slot}.json`);

// Written to one side and then swapped in, so a crash or a full disk can't leave half a save.
function writeSave(slot, data) {
  if (!SAVE_SLOTS.includes(slot) && !MORNINGS.includes(slot)) throw new Error("Unknown save slot.");
  const file = savePath(slot);
  // A game, or one already written out.
  const text = typeof data === "string" ? data : JSON.stringify(data);
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
  return text;
}

// Keeps the game being left, in case leaving was a mistake. A game nobody's played yet isn't worth losing an older one
// for, and neither is one whose player has died.
function keepAsPrevious() {
  if (game && !game.over && (game.turn > 0 || !fs.existsSync(savePath("previous")))) writeSave("previous", game);
}

// ---- The mornings ---------------------------------------------------------

// Which morning an hour of a game's clock belongs to: its number, counted from the game's first.
const morningOf = (hours) => Math.floor((hours - MORNING_HOUR) / 24);
// What's kept in each morning's file: whose game it is (its campaign), its clock, and when it was written. Read from
// the files once.
let mornings = null;
function morningsKept() {
  if (mornings) return mornings;
  mornings = new Map();
  for (const slot of MORNINGS) {
    try {
      const data = JSON.parse(fs.readFileSync(savePath(slot), "utf8"));
      mornings.set(slot, { campaign: data.campaign ?? null, hours: data.clock?.hours ?? 0, written: fs.statSync(savePath(slot)).mtimeMs });
    } catch {
      // Nothing kept there yet.
    }
  }
  return mornings;
}
// The mornings kept of a game, newest first: its own campaign's, and none from a time after its clock, which belong
// to a future that was left behind by going back.
function morningsFor(of) {
  return [...morningsKept()].map(([slot, one]) => ({ slot, ...one })).filter((one) => one.campaign === of.campaign && one.hours <= of.hours + 1e-9).sort((a, b) => b.hours - a.hours);
}
// A game as it was written out is kept as its morning's, in a file that holds nothing of this game's past: an empty
// one; or another game's, or one from a future that was left, whichever was written longest ago; or else this game's
// oldest morning.
function storeMorning(text, of) {
  const kept = morningsKept();
  const mine = new Set(morningsFor(of).map((one) => one.slot));
  const others = MORNINGS.filter((slot) => kept.has(slot) && !mine.has(slot)).sort((a, b) => kept.get(a).written - kept.get(b).written);
  const free = MORNINGS.find((slot) => !kept.has(slot)) ?? others[0] ?? morningsFor(of).at(-1).slot;
  writeSave(free, text);
  kept.set(free, { campaign: of.campaign, hours: of.hours, written: Date.now() });
}
// The game as it was last written to the autosave: its text, whose it is, its clock and whether its player had died.
let lastSaved = null;
// Called with the autosave just written. The first time a game is saved after six on a new day, that's its morning's
// save. If the player died in what was just done and no save of this morning was kept yet, the game as it stood
// before that is, so that going back never costs more than the day.
function keepMorning(text) {
  const now = { campaign: game.campaign ?? null, hours: game.clock?.hours ?? 0 };
  const newest = morningsFor(now)[0] ?? null;
  const due = !newest || morningOf(now.hours) > morningOf(newest.hours);
  if (!game.over) {
    if (due) storeMorning(text, now);
    return;
  }
  const before = lastSaved;
  if (due && before && !before.over && before.campaign === now.campaign && before.hours <= now.hours + 1e-9 && (!newest || before.hours > newest.hours)) storeMorning(before.text, before);
}
// The mornings a dead player can go back to, newest first, each with the clock's words for it and, for the newest one
// saved before noon on the day they died or the day before, what to call it: this morning, yesterday morning.
function morningsList() {
  if (!game) return [];
  const day = Math.floor((game.over?.at ?? game.clock.hours) / 24);
  const called = new Set();
  return morningsFor({ campaign: game.campaign ?? null, hours: game.clock.hours }).map((one) => {
    const back = day - Math.floor(one.hours / 24);
    const early = (((one.hours % 24) + 24) % 24) < 12;
    const words = !early ? null : back === 0 ? "this morning" : back === 1 ? "yesterday morning" : null;
    const fresh = words && !called.has(words);
    if (fresh) called.add(words);
    return { slot: one.slot, when: clockWords(one.hours), words: fresh ? words : null };
  });
}

function listSaves() {
  return SAVE_SLOTS.map((slot) => {
    try {
      const data = migrateGame(JSON.parse(fs.readFileSync(savePath(slot), "utf8")));
      return { slot, name: data.name, level: data.level, location: publicState(data).location.name, savedAt: fs.statSync(savePath(slot)).mtime };
    } catch {
      return { slot, empty: true };
    }
  });
}

function readSave(slot) {
  if (!SAVE_SLOTS.includes(slot) && !MORNINGS.includes(slot)) throw new Error("Unknown save slot.");
  try {
    return migrateGame(JSON.parse(fs.readFileSync(savePath(slot), "utf8")));
  } catch {
    throw new Error("That save slot is empty or unreadable.");
  }
}

// ---- The current game ---------------------------------------------------

let game = null;
try {
  const text = fs.readFileSync(savePath("autosave"), "utf8");
  game = migrateGame(JSON.parse(text));
  ensureContactFiles(game);
  // The game as it was left, for a morning's save if the first thing done in it is the last (keepMorning).
  lastSaved = { text, campaign: game.campaign ?? null, hours: game.clock?.hours ?? 0, over: Boolean(game.over) };
} catch (err) {
  // No autosave yet: the player starts on the title screen. A broken one is kept, so a new game can't overwrite it.
  if (err.code !== "ENOENT" && !game) {
    fs.copyFileSync(savePath("autosave"), `${savePath("autosave")}.broken`);
    console.error(`Your last autosave couldn't be read. A copy is at ${savePath("autosave")}.broken`);
  }
}

let busy = false;

// What the story said, and what the player did, with the scene and quest it was part of when it was the written story's.
const log = (role, text, tag = null) => game.transcript.push({ role, text, ...(tag?.scene ? { scene: tag.scene, quest: tag.quest ?? null } : {}) });

// How many times the game has been saved since it started: every change but the clock's own quiet running saves it, so
// a second window on the game (the Godot view) can tell by this that something has changed.
let saves = 0;
function autosave() {
  saves += 1;
  const text = writeSave("autosave", game);
  try {
    keepMorning(text);
  } catch (err) {
    // A morning that couldn't be kept (a full disk, a file in use) must never stop the game being saved.
    console.error(`This morning's save couldn't be kept: ${err.message}`);
  }
  lastSaved = { text, campaign: game.campaign ?? null, hours: game.clock?.hours ?? 0, over: Boolean(game.over) };
  if (game.campaign) saveCaptainSheet(game.campaign, captainSheet(game));
}

// Whether the player can still stand is looked at each time the clock moves, but not while a skill check or a fight
// is going on (src/collapse.js). So once one of those is over, or a turn of the story has been told, it's looked at
// here, and a fall that was waiting is played before anything else can be asked of someone who can't stand.
function fallNow() {
  const lines = playerFalls(game);
  if (lines.length) log("notice", lines.join("\n"));
}

// Walking can be a step per key press, so the save waits until the captain stops for a moment.
let walkSave = null;
function saveWalk() {
  walkSave = null;
  if (game && !busy) autosave();
}
function saveAfterWalking() {
  clearTimeout(walkSave);
  walkSave = setTimeout(saveWalk, 1000);
}

// The clock can run for hours, so it's saved every so often rather than at every moment.
let clockSave = null;
function saveClock() {
  clockSave = null;
  if (game && !busy) autosave();
}
function saveInAWhile() {
  clockSave ??= setTimeout(saveClock, 15000);
}

// For the app, which stops the game when its window closes, so nothing's left waiting to be saved.
export function finishSaving() {
  if (walkSave) {
    clearTimeout(walkSave);
    saveWalk();
  }
  if (clockSave) {
    clearTimeout(clockSave);
    saveClock();
  }
}

export const gameIsBusy = () => busy;

// ---- Streaming a turn of the story to the browser --------------------------

// One turn of the written story, or one line said in a written conversation. It goes out a piece at a time, the way
// the page reads it, and a turn the story can't answer puts the game back as it was.
function streamTurn(res, { playerText, event, threadId, person = null, talking = false }) {
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
  const send = (obj) => res.write(`${JSON.stringify(obj)}
`);
  const before = structuredClone(game);
  busy = true;
  try {
    if (talking) talkSaid(game, playerText);
    // Narration and game messages are kept in the order they happened.
    const pieces = [];
    const emit = (e) => {
      if (e.type === "text") {
        const last = pieces.at(-1);
        // A page of the ship's log is a piece of its own, not run on from what came before it.
        if (last?.role === "narrator" && last.scene === (e.scene ?? null) && !last.page && !e.page) last.text += e.text;
        else pieces.push({ role: "narrator", text: e.text, scene: e.scene ?? null, quest: e.quest ?? null, ...(e.page ? { page: e.page } : {}) });
        send({ type: "text", text: e.text });
      }
      if (e.type === "notice") {
        pieces.push({ role: "notice", text: e.text });
        send({ type: "notice", text: e.text });
      }
      if (e.type === "state") send({ type: "state", state: publicState(game) });
    };
    // The written story records what the player did itself, once it knows which choice they meant.
    if (talking) writtenTalkTurn({ game, playerText, emit });
    else writtenTurn({ game, playerText, event, threadId, person, emit, log });
    for (const piece of pieces) {
      const text = piece.text.trim();
      if (!text) continue;
      // What's said in a talk stays in its window. What it changes in the game goes in the story too.
      if (talking) talkHeard(game, text, piece.role);
      if (!talking || piece.role !== "narrator") log(piece.role, text, piece);
      if (piece.role === "narrator") {
        noteLoreSeen(game, text);
        notePeopleSeen(game, text);
      }
    }
    if (talking) talkLineOver(game);
    else game.turn += 1;
    fallNow();
    autosave();
    send({ type: "done", state: publicState(game) });
  } catch (err) {
    // Put the game back, so a turn the story couldn't answer changes nothing.
    game = before;
    const message = err instanceof StoryError ? err.message : `Unexpected error: ${err.message}`;
    send({ type: "error", message, state: publicState(game) });
  } finally {
    busy = false;
    res.end();
  }
}

// ---- Routes -------------------------------------------------------------

const json = (res, status, obj) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 600_000) throw new Error("Request too large.");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const requireGame = () => {
  if (!game) throw new Error("No game in progress.");
  return game;
};

// The clock stands still during a talk, so anything that could move it waits until it's over.
const TALK_WAITING = "Finish the talk first.";
// The clock stands still on a computer too.
const COMPUTER_WAITING = "Log off the computer first.";

function menuAction(body) {
  const g = requireGame();
  if (g.talk && (body.action === "rest" || body.action === "work")) throw new Error(TALK_WAITING);
  if (g.computer && (body.action === "rest" || body.action === "work")) throw new Error(COMPUTER_WAITING);
  if (body.action === "rest" && airBadHere(g)) throw new Error("You can't rest here: the air's bad. Get somewhere it's moving first.");
  switch (body.action) {
    case "equip": equip(g, body.id); return null;
    case "use": return useItem(g, body.id);
    case "buy": return buy(g, body.id);
    case "sell": return sell(g, body.id);
    case "perk": return buyPerk(g, body.id);
    case "stat": return raiseStat(g, body.id);
    case "skill": return raiseSkill(g, body.id);
    case "rest": return rest(g, { rough: Boolean(body.rough) });
    case "work": return workShift(g);
    case "difficulty": return setDifficulty(g, body.id);
    default: throw new Error("Unknown action.");
  }
}

// The story board: the stories and scenes as files the owner can change from inside the game.
async function boardApi(req, res, route) {
  const [, , , what, id] = route.split("/");
  if (what === "stories" && req.method === "GET") return json(res, 200, { stories: boardStories() });
  if (what === "layout" && req.method === "POST") {
    const body = await readBody(req);
    return json(res, 200, saveLayout(body.key, body.positions));
  }
  if (what === "story" && id) {
    if (req.method === "GET") return json(res, 200, boardStory(id));
    const body = await readBody(req);
    return json(res, 200, saveBoardStory(id, body.text));
  }
  if ((what === "scene" || what === "talk" || what === "request") && id) {
    const prefix = what === "talk" ? "talk" : what === "request" ? "request" : "thread";
    if (req.method === "GET") return json(res, 200, boardScene(id, prefix));
    const body = await readBody(req);
    return json(res, 200, body.check ? checkBoardScene(id, body.text, prefix) : saveBoardScene(id, body.text, prefix));
  }
  if (what === "world" && id) {
    const itemId = route.split("/")[5];
    if (!itemId && req.method === "GET") return json(res, 200, { items: boardWorldList(id) });
    if (req.method === "GET") return json(res, 200, boardWorldItem(id, itemId));
    const body = await readBody(req);
    return json(res, 200, saveBoardWorldItem(id, itemId, body.text));
  }
  return json(res, 404, { error: "Not found." });
}

// The map editor: the decks there are to change, one of them taken apart for the editor, and a change tried out or
// kept (src/map-editor.js).
async function mapApi(req, res, route) {
  const [, , , place, level] = route.split("/");
  if (!place && req.method === "GET") return json(res, 200, { maps: editableMaps() });
  if (place && level && req.method === "GET") return json(res, 200, deckForEditing(place, level));
  if (place && level && req.method === "POST") {
    const body = await readBody(req);
    return json(res, 200, tryDeck(place, level, body.doc, { keep: Boolean(body.keep), anyway: Boolean(body.anyway) }));
  }
  return json(res, 404, { error: "Not found." });
}

// The catalogue of the packs' pieces, for the Map editor's Pieces window: all of it, or what the window changed
// (src/pieces.js).
async function piecesApi(req, res) {
  if (req.method === "GET") return json(res, 200, withFurniture(catalogue()));
  if (req.method === "POST") {
    // A change can be to a piece's tick or place (the catalogue's), to what it is as furniture, or to both.
    const body = await readBody(req);
    const set = Array.isArray(body.set) ? body.set : [];
    const ticks = set.filter((change) => change && (change.on !== undefined || change.place !== undefined));
    const facts = set.filter((change) => change && "furniture" in change);
    if (!ticks.length && !facts.length) throw new Error("Nothing to change.");
    if (ticks.length) setPieces(ticks);
    if (facts.length) setFurniture(facts);
    const pieces = catalogue().pieces;
    return json(res, 200, { on: pieces.filter((piece) => piece.on).length, of: pieces.length });
  }
  return json(res, 404, { error: "Not found." });
}

// The clock running by itself while the player explores, for whichever view asks: what the tick did, and what came of
// it. quiet when the clock's waiting or stands still here; passed when something's happened that the whole screen needs.
function clockTick(body) {
  const before = Math.floor(requireGame().clock.hours / 2);
  const { notes = [], ...reply } = walkTick(game, body);
  if (reply.held || reply.still) return { reply, quiet: true };
  if (notes.length) log("notice", notes.join("\n"));
  const news = notes.length > 0;
  if (news) autosave();
  else saveInAWhile();
  // A room saved in Tiled since the view last drew it is sent again whole, so it's drawn as it is now.
  const redrawn = body.drawn !== undefined && reply.drawn !== Number(body.drawn);
  return { reply, notes, news, passed: news || redrawn || Math.floor(game.clock.hours / 2) !== before };
}

// The Godot view (godot/), a second window on the same game: Godot draws and takes clicks, and everything it shows or
// does is asked here (src/godot-view.js packs a place's levels for it). It walks with the page's own /api/walk.
// When the page last ran the clock: while it's doing so, Godot's asking moves no time, or the two would run it twice.
let pageTicked = 0;
let pageFought = 0;
const PAGE_HAS_THE_CLOCK = 1500;
// What else is going on in the game that Godot doesn't play yet, so it can say so and wait.
const goingOn = () => ({ combat: Boolean(game.combat), talk: Boolean(game.talk), check: Boolean(game.check), computer: Boolean(game.computer), over: Boolean(game.over) });
// Which copy of the game this is, for Godot's screen with no game open: its folder, any save that's there but can't be
// opened (and why), and whether the bought art is in it. A copy with no saves of its own, one just downloaded, is the
// usual reason for that screen, and each copy has its own saves and its own art.
function whichCopy() {
  const unread = [];
  for (const slot of SAVE_SLOTS) {
    if (!fs.existsSync(savePath(slot))) continue;
    try {
      publicState(migrateGame(JSON.parse(fs.readFileSync(savePath(slot), "utf8"))));
    } catch (err) {
      unread.push({ slot, why: String(err?.message ?? err).split("\n")[0].slice(0, 160) });
    }
  }
  const art = ["isospace", "interiors"].some((pack) => fs.existsSync(path.join(licensedDir(), pack)));
  return { folder: projectDir, saves: savesDir, unread, art };
}
async function godotApi(req, res, route) {
  const what = route.slice("/api/godot/".length);
  if (req.method === "GET") {
    // Loaded only when Godot asks, so the game starts as it always did for everyone who never opens it.
    const { godotLevelNow, godotPlace, godotRound } = await import("./src/godot-view.js");
    const { godotStatus } = await import("./src/godot-status.js");
    const jsonShort = (obj) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(obj, godotRound));
    };
    // Every level of the place the player's at, and the room as it stands. With no game open, the saves there are,
    // and which copy of the game this is.
    if (what === "place") {
      if (!game) return json(res, 200, { ok: true, game: false, saves: listSaves(), where: whichCopy() });
      const place = godotPlace(game);
      if (!place) return json(res, 200, { ok: true, game: true, nowhere: true, state: goingOn() });
      return jsonShort({ ...place, game: true, walk: walkView(game), clock: clockFor(game), state: goingOn(), saved: saves, you: godotStatus(game) });
    }
    // The game as the page is given it, for the menus' own thread (src/godot-pages-worker.js): without the list of
    // saves, which is every save read from the disk, unless it's asked for, and without what never changes.
    if (what === "game") {
      const ask = new URL(req.url, "http://localhost").searchParams;
      return json(res, 200, { game: game ? publicState(game) : null, ...(ask.has("saves") ? { saves: listSaves() } : {}), ...(ask.has("setup") ? { setup: creatorSetup() } : {}) });
    }
    // One level again, when something on it has changed.
    if (what.startsWith("level/")) return jsonShort({ ok: true, deck: godotLevelNow(requireGame(), decodeURIComponent(what.slice("level/".length))) });
    // The story and a talk, read by the page's own readers and cut into the pieces Godot shows (src/godot-story.js).
    if (what === "story") {
      const from = new URL(req.url, "http://localhost").searchParams.get("from");
      return json(res, 200, (await import("./src/godot-story.js")).godotStory(requireGame(), { from: from === null ? null : Number(from) }));
    }
    // Godot's title screen with a game open: the saves there are, which copy of the game this is, and whose game is open.
    if (what === "saves") return json(res, 200, { ok: true, game: false, saves: listSaves(), where: whichCopy(), playing: game ? { name: game.name, over: Boolean(game.over) } : null });
    // What the player carries, as the inventory's window is shown it (godot/scripts/bag.gd).
    if (what === "bag") {
      const shown = publicState(requireGame());
      return json(res, 200, { bag: shown.bag, name: shown.name, credits: shown.credits, body: shown.body });
    }
    // A skill check, as its window is shown it, when Godot hears there's one (godot/scripts/check.gd).
    if (what === "check") {
      const shown = publicState(requireGame());
      return json(res, 200, { check: shown.check, storyWaiting: Boolean(shown.storyWaiting) });
    }
    // A fight, as the fight window and the room are shown it, when Godot hears there's one.
    if (what === "combat") return json(res, 200, { combat: combatView(requireGame()), you: { hp: game.hp, energy: game.energy }, storyWaiting: Boolean(publicState(game).storyWaiting) });
    // The room as it stands, when the player's been moved by something other than Godot.
    if (what === "walk") return json(res, 200, { walk: walkView(requireGame()), clock: clockFor(game), state: goingOn(), saved: saves, you: godotStatus(game) });
    return json(res, 404, { error: "Not found." });
  }
  if (req.method !== "POST") return json(res, 404, { error: "Not found." });
  const body = await readBody(req);
  // Godot closing the game it started itself (start-godot.bat with no game running): what's waiting to be saved is
  // saved, and the game stops. A game started any other way isn't Godot's to stop.
  if (what === "stop") {
    if (process.env.ALMAGEST_STARTED_BY_GODOT !== "1") throw new Error("This game wasn't started by the Godot view, so it isn't the Godot view's to stop.");
    finishSaving();
    json(res, 200, { stopped: true });
    setTimeout(() => process.exit(0), 100);
    return null;
  }
  // A menu, built by the page's own code on a thread of its own and handed over as a tree for Godot to draw; and a
  // click or typed words in one, which run the element's own listener there (src/godot-pages.js). Its orders come back
  // to the game by the page's own routes, so this only passes things along.
  if (what === "page") return json(res, 200, await (await import("./src/godot-pages.js")).askPages(PORT, body));
  if (busy) return json(res, 409, { error: "The story is still being told. Wait a moment." });
  if (what === "tick") {
    requireGame();
    if (game.over) return json(res, 200, { still: true, state: goingOn(), saved: saves });
    const { godotStatus } = await import("./src/godot-status.js");
    const shared = Date.now() - pageTicked < PAGE_HAS_THE_CLOCK;
    const { reply, notes = [], passed = false } = clockTick(shared ? { ...body, ms: 0 } : body);
    const at = standingAt(game);
    return json(res, 200, {
      ...reply,
      clock: clockFor(game),
      state: goingOn(),
      saved: saves,
      you: godotStatus(game),
      ...(at ? { at: { level: at.levelId, x: at.x, y: at.y } } : {}),
      ...(shared ? { shared: true } : {}),
      ...(notes.length ? { notes } : {}),
      // Something's happened that the picture may show: the room again, whole.
      ...(passed ? { walk: walkView(game) } : {}),
    });
  }
  return json(res, 404, { error: "Not found." });
}

async function handleApi(req, res, route) {
  if (route.startsWith("/api/board/")) return boardApi(req, res, route);
  if (route.startsWith("/api/godot/")) return godotApi(req, res, route);
  // The deck as the map editor has it now, described for its picture, with nothing saved or tried out. It has a
  // route of its own, apart from the editor's, so that a game started before the picture existed says it has none
  // (asked under /api/map/, it would take the deck to be tried out, which is slow, every time something was drawn).
  if (route.startsWith("/api/maplook/") && req.method === "POST") {
    const [, , , place, level] = route.split("/");
    return json(res, 200, { look: deckLook(place, level, (await readBody(req)).doc) });
  }
  if (route === "/api/map" || route.startsWith("/api/map/")) return mapApi(req, res, route);
  if (route === "/api/pieces") return piecesApi(req, res);
  // The packs' pieces as furniture, for the page's own list of it (public/furniture.js) and its pictures.
  if (route === "/api/furniture" && req.method === "GET") return json(res, 200, { furniture: furnitureForPage() });
  if (req.method === "GET" && route === "/api/state") {
    let shown = null;
    try {
      shown = game ? publicState(game) : null;
    } catch (err) {
      // Something in this save doesn't match the world's files. The title screen still has to work.
      console.error(`The current game can't be shown: ${err.message}`);
    }
    return json(res, 200, {
      busy,
      game: shown,
      saves: listSaves(),
      setup: creatorSetup(),
    });
  }
  // Every level of the place the player's at, for the page to draw the whole place at once behind its loading screen
  // (public/iso.js). It only reads.
  if (req.method === "GET" && route === "/api/levels") return json(res, 200, placeLevels(requireGame()) ?? { levels: {} });
  // Everything a port holds today, for the star map when that fold is opened. It only reads.
  if (req.method === "GET" && route.startsWith("/api/port/")) return json(res, 200, { holds: portNow(requireGame(), route.slice("/api/port/".length)) });
  // The mornings the game has kept of the game being played, for the ending to offer (public/ending.js). It only reads.
  if (req.method === "GET" && route === "/api/mornings") return json(res, 200, { mornings: morningsList() });

  if (req.method !== "POST") return json(res, 404, { error: "Not found." });
  const body = await readBody(req);

  // Someone's registry printout, opened from the right-click menu. It only reads.
  if (route === "/api/person-sheet") return json(res, 200, personSheet(requireGame(), body.key));
  if (route === "/api/creator/preview") return json(res, 200, buildCharacter(body.draft).view);
  if (route === "/api/creator/random") {
    const draft = randomDraft({ archetype: body.archetype, keep: body.keep ?? {}, anyone: Boolean(body.anyone) });
    return json(res, 200, buildCharacter(draft).view);
  }

  if (busy) return json(res, 409, { error: "The story is still being told. Wait a moment." });

  if (route === "/api/new") {
    // A life that's switched off in world/starts.json isn't offered, so it can't be asked for either.
    if (startIsOff(body.draft?.start)) throw new Error("That life is switched off for now. A new game starts in the captain's chair.");
    const created = createGameFromDraft(body.draft);
    created.campaign = newCampaignId(created.name);
    // People from the captain's past get their files now.
    ensureContactFiles(created);
    keepAsPrevious();
    game = created;
    autosave();
    return json(res, 200, { game: publicState(game), saves: listSaves() });
  }
  if (route === "/api/load") {
    const loaded = readSave(body.slot);
    ensureContactFiles(loaded);
    if (body.slot !== "autosave") keepAsPrevious();
    game = loaded;
    autosave();
    return json(res, 200, { game: publicState(game), saves: listSaves() });
  }
  // Once the player has died nothing more can be done in that game: only another one loaded or begun, above. The
  // clock's own asking, twice a second, is answered quietly.
  if (game?.over) {
    if (route === "/api/tick") return json(res, 200, { still: true });
    throw new Error(GAME_OVER);
  }
  if (route === "/api/save") {
    if (!SAVE_SLOTS.includes(body.slot)) throw new Error("Unknown save slot.");
    writeSave(body.slot, requireGame());
    return json(res, 200, { saves: listSaves() });
  }
  if (route === "/api/action") {
    if (requireGame().combat) throw new Error("Finish the fight first. You can use items from the combat buttons.");
    if (game.check) throw new Error("Finish the check first.");
    const message = menuAction(body);
    if (message) log("notice", message);
    autosave();
    return json(res, 200, { game: publicState(game), message });
  }
  // The Ship menu's orders and the star map run here.
  if (route === "/api/ship") {
    if (requireGame().combat) throw new Error("Finish the fight first.");
    if (game.check) throw new Error("Finish the check first.");
    if (game.talk) throw new Error(TALK_WAITING);
    if (game.computer) throw new Error(COMPUTER_WAITING);
    const { message, notes = [], moved = false } = shipCommand(game, body);
    // Something bought may be what someone asked for, so it's counted at once, even with the clock stopped.
    notes.push(...advanceRequests(game));
    if (notes.length) log("notice", notes.join("\n"));
    autosave();
    return json(res, 200, { game: publicState(game), message, moved });
  }
  // The Command menu's orders: the captain moving someone on the watch bill, putting someone in a post, answering the
  // first officer, or holding the reviews. It's all on this computer.
  // The rig: loading and unloading programs, and writing one at the Repair Bay's bench.
  if (route === "/api/rig") {
    const { said, notes = [] } = rigCommand(requireGame(), body);
    if (notes.length) log("notice", notes.join("\n"));
    autosave();
    return json(res, 200, { game: publicState(game), message: said });
  }
  // The work board: the player taking a job nobody's on, or giving one back.
  if (route === "/api/work") {
    const { message } = workCommand(requireGame(), "meridian", body);
    autosave();
    return json(res, 200, { game: publicState(game), message });
  }
  if (route === "/api/command") {
    const { message, notes = [] } = commandCommand(requireGame(), body);
    if (notes.length) log("notice", notes.join("\n"));
    autosave();
    return json(res, 200, { game: publicState(game), message });
  }
  // Fights happen right here. A written scene waiting on one goes on when the player continues the story.
  if (route === "/api/combat") {
    requireGame();
    // A fight in the room: moving it there, time going by while the page runs it, and the player's orders. Time going
    // by comes several times a second, so only the fight goes back, and the save waits for a quiet moment.
    if (body.action === "live") {
      goLive(game);
      autosave();
      return json(res, 200, { game: publicState(game) });
    }
    const live = Boolean(game.combat?.live);
    // A fight in the room has one clock too: while the page is running it, the Godot view's asking moves no time.
    if (body.action === "tick" && body.view !== "godot") pageFought = Date.now();
    if (body.action === "tick" && body.view === "godot" && Date.now() - pageFought < PAGE_HAS_THE_CLOCK) body.ms = 0;
    const outcome = body.action === "tick" ? liveTick(game, body) : live ? liveOrder(game, body) : combatAction(game, body);
    if ((body.action === "tick" || live) && !outcome.over) {
      if (outcome.events.length || body.action !== "tick") saveAfterWalking();
      return json(res, 200, { combat: combatView(game), you: { hp: game.hp, energy: game.energy }, outcome });
    }
    // The blow-by-blow stays in the fight window. The story only records how it ended,
    // and a simulated fight leaves no trace in the story at all.
    if (outcome.over && !outcome.training) {
      game.transcript.push({ role: "combat", tag: "COMBAT", text: outcome.summary, tone: outcome.tone, ...(outcome.math ? { math: outcome.math } : {}) });
      for (const note of outcome.notes) log("notice", note);
      // A fight the player started from the right-click menu: whoever was beaten goes off to get patched up.
      const after = afterDeedFight(game, outcome);
      if (after.length) log("notice", after.join("\n"));
    }
    if (outcome.over) fallNow();
    autosave();
    return json(res, 200, { game: publicState(game), outcome });
  }
  // A check plays out here too.
  if (route === "/api/check/start") {
    if (requireGame().talk) throw new Error(TALK_WAITING);
    if (game.computer) throw new Error(COMPUTER_WAITING);
    if (body.practice) {
      if (!SKILLS[body.practice]) throw new Error("Unknown skill.");
      startCheck(game, { skill: body.practice, difficulty: body.difficulty ?? "moderate", reason: `Practice: ${SKILLS[body.practice].name}`, source: "practice" });
    } else {
      const label = typeof body.label === "string" ? body.label : "";
      if (!startChoiceCheck(game, label)) throw new Error("That choice isn't on offer any more.");
      log("player", label);
    }
    autosave();
    return json(res, 200, { game: publicState(game) });
  }
  if (route === "/api/check") {
    const reply = checkCommand(requireGame(), body.command);
    // Work on a part or a door by hand is settled by the place's systems. (A hack has no check: it's a computer's logon.)
    const worked = reply.over ? settlePart(game, reply.outcome) : null;
    if (worked) reply.outcome.notes.push(...worked);
    // A pocket picked from the right-click menu: credits, or what being caught costs.
    const deed = reply.over ? settleDeed(game, reply.outcome) : null;
    if (deed) reply.outcome.notes.push(...deed);
    // A check passed, or a part fixed by hand, may be what someone asked for.
    if (reply.over) {
      const asked = advanceRequests(game);
      if (asked.length) game.transcript.push({ role: "notice", text: asked.join("\n") });
      fallNow();
      autosave();
    }
    return json(res, 200, { game: publicState(game), ...reply });
  }
  // The captain runs the Meridian's systems from the Ship menu: no hack, and nobody switches back what they do.
  if (route === "/api/systems") {
    if (requireGame().combat) throw new Error("Finish the fight first.");
    if (game.check) throw new Error("Finish the check first.");
    if (!systemsOf("meridian")) throw new Error("The Meridian has no systems to run.");
    if (game.role?.captain === false) throw new Error("The Meridian isn't yours to run.");
    const all = [{ systems: systemsOf("meridian").systems.map((one) => one.id), rooms: null }];
    const notes = controlSystem(game, "meridian", all, String(body.row ?? ""), String(body.to ?? ""), { by: "owner" });
    if (notes.length) log("notice", notes.join("\n"));
    screenGoesDark(game, "the power's off in here");
    autosave();
    return json(res, 200, { game: publicState(game), notes });
  }
  // The quest log: which quest the tracker in the corner follows.
  if (route === "/api/quests") {
    followQuest(requireGame(), String(body.follow ?? ""));
    autosave();
    return json(res, 200, { game: publicState(game) });
  }
  // The inventory window: moving things about, gear on and off, using, dropping, and what's in a thing that's open.
  if (route === "/api/bag") {
    const { said, quiet } = bagCommand(requireGame(), body);
    if (said && !quiet) log("notice", said.startsWith("[") ? said : `[ITEM] ${said}`);
    // Something carried into a store may be what someone asked for.
    const asked = advanceRequests(game);
    if (asked.length) log("notice", asked.join("\n"));
    autosave();
    return json(res, 200, { game: publicState(game), said });
  }
  // A computer the player is on: reading, running and logging off happen here.
  if (route === "/api/computer") {
    if (requireGame().combat) throw new Error("Finish the fight first.");
    if (game.check) throw new Error("Finish the check first.");
    const reply = computerCommand(game, body);
    autosave();
    return json(res, 200, { game: publicState(game), ...reply });
  }
  if (route === "/api/sim") {
    if (requireGame().combat) throw new Error("Finish the fight first.");
    if (game.check) throw new Error("Finish the check first.");
    if (game.talk) throw new Error(TALK_WAITING);
    if (game.computer) throw new Error(COMPUTER_WAITING);
    if (!publicState(game).location.rest) throw new Error("The simulator is aboard the Meridian.");
    startCombat(game, body.enemy, { training: true, ...(body.followers ? simulatorFollowers(game, body.enemy) : {}) });
    autosave();
    return json(res, 200, { game: publicState(game) });
  }
  // The clock running by itself while the player explores. The reply
  // is small, because this is twice a second, unless something's happened that the whole screen needs.
  if (route === "/api/tick") {
    pageTicked = Date.now();
    const { reply, news = false, passed = false, quiet = false } = clockTick(body);
    if (quiet) return json(res, 200, reply);
    return json(res, 200, { ...reply, clock: clockFor(game), ...(passed ? { game: publicState(game), news } : {}) });
  }
  // Walking runs here. The reply is small, because this can be every key press.
  if (route === "/api/walk") {
    if (requireGame().combat) throw new Error("Finish the fight first.");
    if (game.check) throw new Error("Finish the check first.");
    if (game.talk) throw new Error(TALK_WAITING);
    if (game.computer) throw new Error(COMPUTER_WAITING);
    const reply = walkCommand(game, body);
    // Using a thing or asking at a door changes more than where the player stands, and the story keeps a line about it.
    if (["use", "ask", "work", "pickpocket", "attack", "carry", "putdown", "give"].includes(body.action) || isOrder(body.action)) {
      if (reply.said) log("notice", reply.said);
      // Something fixed or given may be what someone asked for, so it's counted at once.
      const asked = advanceRequests(game);
      if (asked.length) log("notice", asked.join("\n"));
      autosave();
      return json(res, 200, { game: publicState(game), said: reply.said ?? null, check: Boolean(game.check), computer: Boolean(game.computer), combat: Boolean(game.combat) });
    }
    saveAfterWalking();
    return json(res, 200, reply);
  }
  // A talk: opening it, closing it, passing on rumors, and each thing said, from the person's written lines or stock ones.
  if (route === "/api/talk") {
    if (requireGame().combat) throw new Error("Finish the fight first.");
    if (game.check) throw new Error("Finish the check first.");
    if (body.action === "say") {
      if (!game.talk) throw new Error("You're not talking to anyone right now.");
      const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
      if (!text) throw new Error("Choose something to say.");
      return streamTurn(res, { playerText: text, talking: true });
    }
    talkCommand(game, body);
    // The person speaks first, from their written conversation or from stock lines.
    if (body.action === "open") openWrittenTalk(game);
    autosave();
    return json(res, 200, { game: publicState(game) });
  }
  if (route === "/api/chat") {
    requireGame();
    if (game.combat) throw new Error("Finish the fight first.");
    if (game.check) throw new Error("Finish the check first.");
    if (game.computer) throw new Error(COMPUTER_WAITING);
    // Anything that would move the story on leaves the talk first.
    closeTalk(game);
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
    if (body.event === "start" && !game.transcript.length) return streamTurn(res, { event: "start" });
    if (body.event === "start" || body.event === "continue") return streamTurn(res, { event: "continue" });
    // The player has gone over to someone the story is waiting on.
    if (body.event === "meet") return streamTurn(res, { event: "meet", person: typeof body.person === "string" ? body.person : null });
    if (!text) throw new Error("Type what you want to do.");
    // A lead picked from the menu comes with its story thread.
    return streamTurn(res, { playerText: text, threadId: typeof body.thread === "string" ? body.thread : null });
  }
  return json(res, 404, { error: "Not found." });
}

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

// Art bought for this computer alone (public/pixel-art.js): its pictures, from licensed/, which git leaves out and
// nothing public copies, since the licence lets the game use them but not give the files away.
function serveLicensed(res, route) {
  // A pack's folders can have spaces and brackets in their names, which arrive made safe for a link.
  let asked = "";
  try {
    asked = decodeURIComponent(route.slice("/licensed/".length));
  } catch {
    asked = "";
  }
  const folder = path.resolve(licensedDir());
  const file = path.resolve(folder, asked);
  if (!asked || !file.startsWith(folder + path.sep) || path.extname(file) !== ".png" || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    return res.end("Not found");
  }
  res.writeHead(200, { "content-type": "image/png" });
  fs.createReadStream(file).pipe(res);
}

function serveFile(res, route) {
  const relative = route === "/" ? "index.html" : route.slice(1);
  const file = path.resolve(publicDir, relative);
  if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    return res.end("Not found");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  // Refuse requests that come from other websites open in your browser.
  const host = req.headers.host ?? "";
  const allowed = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
  const origin = req.headers.origin;
  if (!allowed.includes(host) || (origin && !allowed.includes(origin.replace(/^https?:\/\//, "")))) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  const route = new URL(req.url, `http://${host}`).pathname;
  try {
    if (route.startsWith("/api/")) await handleApi(req, res, route);
    else if (route.startsWith("/licensed/")) serveLicensed(res, route);
    else serveFile(res, route);
  } catch (err) {
    // A mistake in the game's own code, not something the player did wrong: where it happened goes in this window, so
    // it can be found. The player still gets its words, as for anything refused.
    if (err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError) console.error(`${route}: ${err.stack}`);
    if (res.headersSent) return res.end();
    json(res, 400, { error: err.message });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`The game seems to be running already. Open http://localhost:${PORT} in your browser.`);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Almagest Explorer's is running at http://localhost:${PORT}`);
  console.log("Leave this window open while you play. Close it to stop the game.");
});
