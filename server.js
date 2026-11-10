// The game's local server. It only accepts connections from this computer.
// It holds the game, and the browser page talks to it. Everything runs here: there's no AI, and nothing goes online.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { boardScene, boardStories, boardStory, boardWorldItem, boardWorldList, checkBoardScene, saveBoardScene, saveBoardStory, saveBoardWorldItem, saveLayout } from "./src/board.js";
import { ensureContactFiles, newCampaignId, saveCaptainSheet } from "./src/campaign.js";
import { SKILLS } from "./src/character-data.js";
import { checkCommand, startCheck, startChoiceCheck } from "./src/checks.js";
import { combatView, simulatorFollowers } from "./src/combat.js";
import { goLive, liveOrder, liveTick } from "./src/live-fight.js";
import { buildCharacter, createGameFromDraft, creatorSetup, randomDraft } from "./src/creator.js";
import { shipCommand } from "./src/ship.js";
import { commandCommand } from "./src/command.js";
import { noteLoreSeen } from "./src/lore.js";
import { migrateGame } from "./src/migrate.js";
import { StoryError, writtenTurn } from "./src/scenes.js";
import { followQuest } from "./src/quests.js";
import { openWrittenTalk, writtenTalkTurn } from "./src/talks.js";
import { dataDir, projectDir } from "./src/paths.js";
import {
  buy, buyPerk, captainSheet, clockFor, combatAction, equip, notePeopleSeen, publicState, raiseSkill, raiseStat, rest, sell, setDifficulty, startCombat, useItem, workShift,
} from "./src/rules.js";
import { personSheet } from "./src/person-sheet.js";
import { closeTalk, talkCommand, talkHeard, talkLineOver, talkSaid, walkCommand, walkTick } from "./src/walk.js";
import { enterAfterHack, enterDoorPanel } from "./src/computers.js";
import { airBadHere, controlSystem, settlePart, systemsOf } from "./src/systems.js";
import { computerCommand, screenGoesDark } from "./src/computer-use.js";
import { afterDeedFight, settleDeed } from "./src/deeds.js";
import { bagCommand } from "./src/bag.js";

const savesDir = path.join(dataDir(), "saves");
const publicDir = path.join(projectDir, "public");
const PORT = Number(process.env.PORT) || 3210;
// "previous" keeps the last game when a new one starts, in case that was a mistake.
const SAVE_SLOTS = ["autosave", "previous", "slot1", "slot2", "slot3"];

fs.mkdirSync(savesDir, { recursive: true });

// ---- Saves --------------------------------------------------------------

const savePath = (slot) => path.join(savesDir, `${slot}.json`);

// Written to one side and then swapped in, so a crash or a full disk can't leave half a save.
function writeSave(slot, data) {
  if (!SAVE_SLOTS.includes(slot)) throw new Error("Unknown save slot.");
  const file = savePath(slot);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
  fs.renameSync(`${file}.tmp`, file);
}

// Keeps the game being left, in case leaving was a mistake. A game nobody's played yet isn't worth losing an older one for.
function keepAsPrevious() {
  if (game && (game.turn > 0 || !fs.existsSync(savePath("previous")))) writeSave("previous", game);
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
  if (!SAVE_SLOTS.includes(slot)) throw new Error("Unknown save slot.");
  try {
    return migrateGame(JSON.parse(fs.readFileSync(savePath(slot), "utf8")));
  } catch {
    throw new Error("That save slot is empty or unreadable.");
  }
}

// ---- The current game ---------------------------------------------------

let game = null;
try {
  game = migrateGame(JSON.parse(fs.readFileSync(savePath("autosave"), "utf8")));
  ensureContactFiles(game);
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

function autosave() {
  writeSave("autosave", game);
  if (game.campaign) saveCaptainSheet(game.campaign, captainSheet(game));
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
        if (last?.role === "narrator" && last.scene === (e.scene ?? null)) last.text += e.text;
        else pieces.push({ role: "narrator", text: e.text, scene: e.scene ?? null, quest: e.quest ?? null });
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
  if ((what === "scene" || what === "talk") && id) {
    const prefix = what === "talk" ? "talk" : "thread";
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

async function handleApi(req, res, route) {
  if (route.startsWith("/api/board/")) return boardApi(req, res, route);
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
  if (route === "/api/save") {
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
    if (notes.length) log("notice", notes.join("\n"));
    autosave();
    return json(res, 200, { game: publicState(game), message, moved });
  }
  // The Command menu's orders: the captain moving someone on the watch bill, putting someone in a post, answering the
  // first officer, or holding the reviews. It's all on this computer.
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
    // Work on a part or a door by hand is settled by the place's systems; a door panel that was hacked opens as a computer.
    const worked = reply.over ? settlePart(game, reply.outcome, (place, to, hack) => enterDoorPanel(game, place, to, hack, reply.outcome?.target ?? null)) : null;
    if (worked) reply.outcome.notes.push(...worked);
    // A pocket picked from the right-click menu: credits, or what being caught costs.
    const deed = reply.over ? settleDeed(game, reply.outcome) : null;
    if (deed) reply.outcome.notes.push(...deed);
    // A hack that got in doesn't end at the result: the screen becomes the computer's own system.
    if (worked === null && reply.over && reply.outcome?.hack && reply.outcome.success && !reply.outcome.training) {
      try {
        enterAfterHack(game, reply.outcome.hack, reply.outcome.target ?? null);
      } catch (err) {
        reply.outcome.notes.push(`[COMPUTER] ${err.message}`);
      }
    }
    if (reply.over) autosave();
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
    const before = Math.floor(requireGame().clock.hours / 2);
    const { notes = [], ...reply } = walkTick(game, body);
    if (reply.held || reply.still) return json(res, 200, reply);
    if (notes.length) log("notice", notes.join("\n"));
    const news = notes.length > 0;
    if (news) autosave();
    else saveInAWhile();
    // A room saved in Tiled since the page last drew it is sent again whole, so it's drawn as it is now.
    const redrawn = body.drawn !== undefined && reply.drawn !== Number(body.drawn);
    const passed = news || redrawn || Math.floor(game.clock.hours / 2) !== before;
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
    if (["use", "ask", "work", "pickpocket", "attack"].includes(body.action)) {
      if (reply.said) log("notice", reply.said);
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

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

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
    else serveFile(res, route);
  } catch (err) {
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
