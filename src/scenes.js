// The written story: scenes played from world/scenes, with no AI. A scene is made of parts. Each part
// has text in the same format the game master writes, so the page shows it the same way, and choices
// that lead to other parts. A part can open a skill check or start a fight, and where the story goes
// next depends on how that came out. Whatever a part changes in the game goes through the same tools
// the AI uses, so the rules are the same either way. The files are plain text, read again whenever the
// story needs them, so a change shows up without restarting the game. world/scenes/_how-to-write-a-scene.txt
// explains how to write one.

import fs from "node:fs";
import path from "node:path";
import { SKILLS } from "./character-data.js";
import { startChoiceCheck } from "./checks.js";
import { worldDir } from "./paths.js";
import { DIFFICULTY, attr, maxHp, skillRank } from "./rules.js";
import { conditionHolds, parseCondition, parseSceneText } from "./scene-text.js";
import { noteThreadStarted } from "./story-library.js";
import { newTurnLimits, runTool, toolProblem } from "./tools.js";
import { answerDoor } from "./walk.js";

// Something the player did that the written story has no answer to. The turn changes nothing, and they read this.
export class StoryError extends Error {}

const AI_HINT = "With an AI game master, chosen in Settings, you can type anything you like.";
const FIGHT_ENDINGS = { victory: "won", talked: "talked", defeat: "lost", fled: "fled", surrendered: "gaveUp" };
// What conditions need from the rules. A conversation adds what's been said in it, as seen.
export const HELPERS = { attr, skillRank, maxHp };
export const SCENES_DIR = path.join(worldDir, "scenes");

// ---- Loading the files ------------------------------------------------------------

const cache = new Map();

// Every scene in the folder, read fresh when a file has changed: a .txt file in the written format, or a .json
// one in the shape the game plays. Files whose names start with _ are notes, not scenes. A file with a mistake
// that stops it being read at all is left out, and problems says why, with the line.
export function loadScenes(dir = SCENES_DIR) {
  const scenes = {};
  const problems = [];
  const broken = {};
  if (!fs.existsSync(dir)) return { scenes, problems, broken };
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith("_") || !/\.(txt|json)$/.test(name)) continue;
    const file = path.join(dir, name);
    const id = name.replace(/\.(txt|json)$/, "");
    let stamp;
    try {
      stamp = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    const kept = cache.get(file);
    const entry = kept?.stamp === stamp ? kept : { stamp, ...readScene(file, name) };
    cache.set(file, entry);
    if (entry.scene) scenes[id] = entry.scene;
    else {
      const first = entry.problems[0];
      broken[id] = first ? `${first.line ? `line ${first.line}: ` : ""}${first.message}` : "can't be read";
    }
    for (const found of entry.problems) problems.push({ file: name, ...found });
  }
  return { scenes, problems, broken };
}

function readScene(file, name) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    return { scene: null, problems: [{ line: 0, message: `can't be read: ${err.message}` }] };
  }
  if (name.endsWith(".json")) {
    try {
      return { scene: JSON.parse(text), problems: [] };
    } catch (err) {
      return { scene: null, problems: [{ line: 0, message: `isn't valid JSON: ${err.message}` }] };
    }
  }
  const { scene, problems } = parseSceneText(text, name);
  return { scene: Object.keys(scene.parts).length ? scene : null, problems };
}

// How the story opens for this life: its own scene if one's written, or the one that fits anyone.
export function openingSceneId(game, scenes = loadScenes().scenes) {
  const own = `opening_${game.role?.id ?? "captain"}`;
  if (scenes[own]) return own;
  return scenes.opening ? "opening" : null;
}

// ---- Reading a part ----------------------------------------------------------------

// How a choice reads in the story: its check, its other tags, then its words.
export const choiceLine = (choice) => ["> ", choice.check ? `[${choice.check}] ` : "", ...(choice.tags ?? []).map((tag) => `[${tag}] `), choice.say].join("");

// The choices this player gets to see: the ones whose conditions hold.
export const openChoices = (part, game, helpers = HELPERS) => (part.choices ?? []).filter((choice) => !choice.if || conditionHolds(game, choice.if, helpers));

// What the player reads when a part begins, in the game master's own format.
export function partText(part, game = null, helpers = HELPERS) {
  const lines = (Array.isArray(part.text) ? part.text : [part.text]).filter(Boolean);
  const choices = (game ? openChoices(part, game, helpers) : part.choices ?? []).map(choiceLine);
  return [lines.join("\n\n"), choices.join("\n")].filter(Boolean).join("\n\n");
}

// The first rule of a part that holds, if any, which sends the story somewhere else instead.
export const ruleThatHolds = (part, game, helpers = HELPERS) => (part.when ?? []).find((one) => !one.if || conditionHolds(game, one.if, helpers)) ?? null;

// ---- Finding the choice the player meant ----------------------------------

const normalize = (text) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

// Typing is forgiving: the whole choice, the start of it, or most of its words, with typos in the rest.
export function matchChoice(text, choices) {
  const wanted = normalize(text);
  if (!wanted) return null;
  const exact = choices.find((choice) => normalize(choice.say) === wanted);
  if (exact) return exact;
  const starts = choices.filter((choice) => normalize(choice.say).startsWith(wanted));
  if (starts.length === 1) return starts[0];
  const words = wanted.split(" ").filter((word) => word.length > 2);
  if (!words.length) return null;
  const scored = choices.map((choice) => {
    const have = normalize(choice.say).split(" ");
    const hits = words.filter((word) => have.some((one) => one === word || (word.length >= 4 && (one.startsWith(word) || word.startsWith(one) || sameButOne(one, word))))).length;
    return { choice, hits };
  }).filter((one) => one.hits >= Math.max(1, Math.ceil(words.length * 0.6))).sort((a, b) => b.hits - a.hits);
  if (!scored.length || (scored.length > 1 && scored[0].hits === scored[1].hits)) return null;
  return scored[0].choice;
}

// Two words of the same length that differ in one letter, or that are one letter apart in length.
function sameButOne(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
  let i = 0;
  let j = 0;
  let misses = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    misses += 1;
    if (misses > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return misses + (a.length - i) + (b.length - j) <= 1;
}

// ---- Playing ------------------------------------------------------------

const sceneFor = (game, scenes) => (game.scene ? scenes[game.scene.id] ?? null : null);

function partOf(scene, id, sceneId) {
  const part = scene.parts?.[id];
  if (!part) throw new Error(`The scene ${sceneId} has no part called ${id}.`);
  return part;
}

// Plays a part: its rules for going elsewhere, its text, what it changes, and whatever it opens. A check
// or a fight ends the turn, and the story picks up from its result when the player continues.
function enterPart(game, scene, id, { emit, turn }, hops = 0) {
  const part = partOf(scene, id, game.scene.id);
  // A rule that holds sends the story on without showing this part.
  const rule = ruleThatHolds(part, game);
  if (rule) {
    if (hops > 20) throw new Error(`The scene ${game.scene.id} goes round in circles from ${id}.`);
    return enterPart(game, scene, rule.to, { emit, turn }, hops + 1);
  }
  game.scene.part = id;
  game.scene.pending = null;
  game.scene.seen ??= [];
  if (!game.scene.seen.includes(id)) game.scene.seen.push(id);
  const text = partText(part, game);
  if (text) emit({ type: "text", text });
  if (part.note) emit({ type: "notice", text: part.note });
  game.flags ??= {};
  for (const step of part.do ?? []) {
    const { tool, set, clear, line: _line, ...input } = step;
    if (set) {
      game.flags[set] = true;
      continue;
    }
    if (clear) {
      delete game.flags[clear];
      continue;
    }
    const outcome = runTool(game, tool, input, turn);
    if (outcome.isError) throw new Error(`In the scene ${game.scene.id}, part ${id}, ${tool} failed: ${outcome.result}`);
    if (outcome.narration) emit({ type: "text", text: outcome.narration });
    if (outcome.notice) emit({ type: "notice", text: outcome.notice });
  }
  if (part.check) {
    const [skill, difficulty, audience] = part.check.split(":");
    const outcome = runTool(game, "roll_check", { skill, difficulty, audience, reason: part.reason ?? part.check, scene: part.scene }, turn);
    if (outcome.isError) throw new Error(`In the scene ${game.scene.id}, part ${id}, the check failed to open: ${outcome.result}`);
    game.scene.pending = { kind: "check", pass: part.pass, fail: part.fail };
  } else if (part.fight) {
    const outcome = runTool(game, "start_combat", part.fight, turn);
    if (outcome.isError) throw new Error(`In the scene ${game.scene.id}, part ${id}, the fight failed to start: ${outcome.result}`);
    if (outcome.narration) emit({ type: "text", text: outcome.narration });
    if (outcome.notice) emit({ type: "notice", text: outcome.notice });
    game.scene.pending = { kind: "fight", won: part.won, lost: part.lost, fled: part.fled, gaveUp: part.gaveUp, talked: part.talked };
  } else if (part.end) {
    game.scene = null;
  }
  emit({ type: "state" });
}

function startScene(game, id, scenes, context) {
  const scene = scenes[id];
  if (!scene) throw new StoryError("That part of the story hasn't been written yet.");
  game.scene = { id, part: null, pending: null, seen: [] };
  enterPart(game, scene, scene.start, context);
}

// Where a check's or a fight's result takes the story.
function nextAfter(game, pending) {
  if (pending.kind === "check") {
    const check = game.lastCheck;
    if (!check || check.used) return null;
    check.used = true;
    return check.success ? pending.pass : pending.fail;
  }
  const fight = game.lastFight;
  if (!fight || fight.used) return null;
  fight.used = true;
  const ending = FIGHT_ENDINGS[fight.result] ?? "lost";
  return pending[ending] ?? (ending === "talked" ? pending.won : pending.lost);
}

// The player pressed Continue after a check, a fight or something else the game did by itself.
function carryOn(game, scenes, context) {
  // The AI isn't here to read these, so the written story decides what they mean.
  game.pendingEvents.splice(0);
  // Asking at a closed door opened a check. Its result decides whether the door opens.
  if (game.lastCheck && !game.lastCheck.used && game.lastCheck.source === "door" && game.doorAsked) {
    game.lastCheck.used = true;
    context.emit({ type: "notice", text: answerDoor(game, game.lastCheck.success) });
    context.emit({ type: "state" });
    return;
  }
  // The fleet, or the player alone, has just arrived somewhere with a written arrival. A scene already under way comes first.
  if (game.arrived) {
    const place = game.arrived;
    game.arrived = null;
    if (scenes[`arrive_${place}`] && !game.scene) return startScene(game, `arrive_${place}`, scenes, context);
  }
  const scene = sceneFor(game, scenes);
  if (scene) {
    const part = partOf(scene, game.scene.part, game.scene.id);
    // A check chosen from the list opened its window straight away, so the story meets its result here.
    const chosen = game.lastCheck && !game.lastCheck.used && game.lastCheck.source === "choice"
      ? (part.choices ?? []).find((choice) => choice.check && choice.say === game.lastCheck.reason)
      : null;
    const pending = game.scene.pending ?? (chosen ? { kind: "check", pass: chosen.pass, fail: chosen.fail } : null);
    if (pending) {
      const next = nextAfter(game, pending);
      if (next) return enterPart(game, scene, next, context);
    }
  }
  context.emit({ type: "notice", text: "[STORY] Nothing more is written here for now." });
  context.emit({ type: "state" });
}

// What's wrong with the scene file the player needs, if it can't be read at all.
function brokenMessage(id, broken) {
  return broken[id] ? `The scene ${id} can't be read: ${broken[id]}. Fix the file in world\\scenes, or run npm run check-story to see every problem.` : null;
}

// One turn of the written story. emit() streams what the player reads, the same as an AI turn does,
// and log() records what the player did, before the story answers it.
export function writtenTurn({ game, playerText, event, threadId, emit, log, scenes = null, broken = {} }) {
  const loaded = scenes ? { scenes, broken } : loadScenes();
  const context = { emit, turn: newTurnLimits() };
  if (event === "start") {
    // A life's own opening that can't be read is a mistake to fix, not a reason to play the plain one instead.
    const own = brokenMessage(`opening_${game.role?.id ?? "captain"}`, loaded.broken);
    if (own) throw new StoryError(own);
    const id = openingSceneId(game, loaded.scenes);
    if (!id) throw new StoryError(brokenMessage("opening", loaded.broken) ?? "There's no written opening yet. Choose an AI game master in Settings to start the story.");
    return startScene(game, id, loaded.scenes, context);
  }
  if (event === "continue") return carryOn(game, loaded.scenes, context);
  if (threadId) {
    const id = `thread_${threadId}`;
    if (!loaded.scenes[id]) throw new StoryError(brokenMessage(id, loaded.broken) ?? `This story hasn't been written out yet. For now it plays out by itself, and the Leads menu and the news say how it's going. ${AI_HINT}`);
    log("player", playerText);
    // The story is taken up: the Leads menu lists it as followed, and it stops moving on by itself.
    noteThreadStarted(game, threadId);
    return startScene(game, id, loaded.scenes, context);
  }
  const scene = sceneFor(game, loaded.scenes);
  if (!scene) {
    if (game.scene) throw new StoryError(brokenMessage(game.scene.id, loaded.broken) ?? `The scene ${game.scene.id} has gone from world\\scenes, so the story can't go on from here.`);
    throw new StoryError(`There's no more written story here for now. You can walk around, talk to people about what they've heard, and watch the world go on. ${AI_HINT}`);
  }
  const part = partOf(scene, game.scene.part, game.scene.id);
  const choice = matchChoice(playerText, openChoices(part, game));
  if (!choice) throw new StoryError(`That isn't one of the choices here. Pick one, or type part of it. ${AI_HINT}`);
  if (choice.check) {
    // The check's window opens first, the same as when the choice is clicked, and the story goes on once it's done.
    if (!startChoiceCheck(game, choice.say)) throw new StoryError("That choice isn't on offer any more.");
    log("player", choice.say);
    emit({ type: "state" });
    return;
  }
  log("player", choice.say);
  enterPart(game, scene, choice.to, context);
}

// ---- Checking a scene --------------------------------------------------------

const GOES_TO = ["to", "pass", "fail", "won", "lost", "fled", "gaveUp", "talked"];

function checkProblem(text) {
  const [skill, difficulty, audience] = String(text).split(":");
  if (!SKILLS[skill]) return `unknown skill ${skill}`;
  if (!(difficulty in DIFFICULTY)) return `unknown difficulty ${difficulty}`;
  if (audience !== undefined && !audience) return "an empty audience";
  return null;
}

// Everything wrong with a scene, in plain words, so a mistake is found before anyone plays it. Each
// problem names the file's line when the scene came from a text file. A conversation (talk_<person>)
// has no checks or fights, and a part with nothing more to say is where it ends.
export function sceneProblems(scene, id = "the scene", { talk = false } = {}) {
  const problems = [];
  const parts = scene?.parts ?? {};
  const at = (holder, where) => (holder?.line ? `${where} (line ${holder.line})` : where);
  if (!scene?.start) problems.push(`${id} doesn't say which part it starts at`);
  else if (!parts[scene.start]) problems.push(`${id} starts at ${scene.start}, which isn't a part`);
  const reached = new Set();
  const stack = scene?.start && parts[scene.start] ? [scene.start] : [];
  while (stack.length) {
    const name = stack.pop();
    if (reached.has(name)) continue;
    reached.add(name);
    const part = parts[name];
    for (const key of GOES_TO) if (part[key] && parts[part[key]]) stack.push(part[key]);
    for (const rule of part.when ?? []) if (parts[rule.to]) stack.push(rule.to);
    for (const choice of part.choices ?? []) for (const key of GOES_TO) if (choice[key] && parts[choice[key]]) stack.push(choice[key]);
  }
  const condition = (text, what) => {
    for (const found of parseCondition(text).problems) problems.push(`${what}: ${found}`);
  };
  for (const [name, part] of Object.entries(parts)) {
    const where = at(part, `${id}, part ${name}`);
    if (!reached.has(name)) problems.push(`${where} can't be reached`);
    const text = (Array.isArray(part.text) ? part.text : [part.text]).filter(Boolean);
    const goes = (holder, what) => {
      for (const key of GOES_TO) if (holder[key] !== undefined && !parts[holder[key]]) problems.push(`${what} goes to ${holder[key]}, which isn't a part`);
    };
    goes(part, where);
    for (const rule of part.when ?? []) {
      const what = at(rule, `${where}, rule`);
      if (!parts[rule.to]) problems.push(`${what} goes to ${rule.to}, which isn't a part`);
      if (rule.if) condition(rule.if, what);
    }
    const always = (part.when ?? []).some((rule) => !rule.if);
    // A fight brings its own lead-in, and a check its own window, so those parts can stand without text.
    if (!text.length && !part.note && !always && !part.check && !part.fight) problems.push(`${where} has no text`);
    if (talk && (part.check || part.fight)) problems.push(`${where} has a ${part.check ? "check" : "fight"}, and a conversation can't open one: put it in a scene instead`);
    if (part.check && !talk) {
      const problem = checkProblem(part.check);
      if (problem) problems.push(`${where} has ${problem}`);
      if (!part.pass || !part.fail) problems.push(`${where} has a check, so it needs pass and fail`);
    }
    if (part.fight && !talk) {
      const problem = toolProblem("start_combat", part.fight);
      if (problem) problems.push(`${where}: the fight ${problem}`);
      if (!part.won || !part.lost) problems.push(`${where} has a fight, so it needs won and lost`);
    }
    if (!talk && !part.check && !part.fight && !part.end && !always && !(part.choices ?? []).length) problems.push(`${where} has no choices and doesn't end the scene`);
    for (const [i, step] of (part.do ?? []).entries()) {
      const { tool, set, clear, line: _line, ...input } = step;
      if (set || clear) continue;
      const problem = toolProblem(tool, input);
      if (problem) problems.push(`${at(step, `${where}, effect ${i + 1}`)}: ${problem}`);
    }
    for (const [i, choice] of (part.choices ?? []).entries()) {
      const what = at(choice, `${where}, choice ${i + 1}`);
      if (!choice.say) problems.push(`${what} has no words`);
      goes(choice, what);
      if (choice.if) condition(choice.if, what);
      if (choice.check && talk) problems.push(`${what} has a check, and a conversation can't open one: put it in a scene instead`);
      else if (choice.check) {
        const problem = checkProblem(choice.check);
        if (problem) problems.push(`${what} has ${problem}`);
        if (!choice.pass || !choice.fail) problems.push(`${what} has a check, so it needs pass and fail`);
      } else if (!choice.to) problems.push(`${what} doesn't say where it goes`);
    }
  }
  return problems;
}

// Every problem in the whole folder, for the checker and the tests: files that can't be read, and scenes that can.
export function allSceneProblems(dir = SCENES_DIR) {
  const { scenes, problems } = loadScenes(dir);
  const found = problems.map((one) => `${one.file}${one.line ? ` (line ${one.line})` : ""}: ${one.message}`);
  for (const [id, scene] of Object.entries(scenes)) found.push(...sceneProblems(scene, id, { talk: id.startsWith("talk_") }));
  return { count: Object.keys(scenes).length, problems: found };
}
