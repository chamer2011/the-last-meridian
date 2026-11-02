// The written story: scenes played from world/scenes, with no AI. A scene is made of parts. Each part
// has text in the same format the game master writes, so the page shows it the same way, and choices
// that lead to other parts. A part can open a skill check or start a fight, and where the story goes
// next depends on how that came out. Whatever a part changes in the game goes through the same tools
// the AI uses, so the rules are the same either way. world/scenes/opening_captain.json has the format.

import { SKILLS } from "./character-data.js";
import { startChoiceCheck } from "./checks.js";
import { DIFFICULTY } from "./rules.js";
import { newTurnLimits, runTool, toolProblem } from "./tools.js";
import { WORLD_SCENES } from "./world.js";

// Something the player did that the written story has no answer to. The turn changes nothing, and they read this.
export class StoryError extends Error {}

const AI_HINT = "With an AI game master, chosen in Settings, you can type anything you like.";
const FIGHT_ENDINGS = { victory: "won", talked: "talked", defeat: "lost", fled: "fled", surrendered: "gaveUp" };

// How the story opens for this life: its own scene if one's written, or the one that fits anyone.
export function openingSceneId(game, scenes = WORLD_SCENES) {
  const own = `opening_${game.role?.id ?? "captain"}`;
  if (scenes[own]) return own;
  return scenes.opening ? "opening" : null;
}

// How a choice reads in the story: its check, its other tags, then its words.
export const choiceLine = (choice) => ["> ", choice.check ? `[${choice.check}] ` : "", ...(choice.tags ?? []).map((tag) => `[${tag}] `), choice.say].join("");

// What the player reads when a part begins, in the game master's own format.
export function partText(part) {
  const lines = (Array.isArray(part.text) ? part.text : [part.text]).filter(Boolean);
  const choices = (part.choices ?? []).map(choiceLine);
  return [lines.join("\n\n"), choices.join("\n")].filter(Boolean).join("\n\n");
}

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

// Plays a part: its text, what it changes, and whatever it opens. A check or a fight ends the turn,
// and the story picks up from its result when the player continues.
function enterPart(game, scene, id, { emit, turn }) {
  const part = partOf(scene, id, game.scene.id);
  game.scene.part = id;
  game.scene.pending = null;
  const text = partText(part);
  if (text) emit({ type: "text", text });
  if (part.note) emit({ type: "notice", text: part.note });
  for (const step of part.do ?? []) {
    const { tool, ...input } = step;
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
  game.scene = { id, part: null, pending: null };
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

// One turn of the written story. emit() streams what the player reads, the same as an AI turn does,
// and log() records what the player did, before the story answers it.
export function writtenTurn({ game, playerText, event, threadId, emit, log, scenes = WORLD_SCENES }) {
  const context = { emit, turn: newTurnLimits() };
  if (event === "start") {
    const id = openingSceneId(game, scenes);
    if (!id) throw new StoryError("There's no written opening yet. Choose an AI game master in Settings to start the story.");
    return startScene(game, id, scenes, context);
  }
  if (event === "continue") return carryOn(game, scenes, context);
  if (threadId) {
    const id = `thread_${threadId}`;
    if (!scenes[id]) throw new StoryError(`This story hasn't been written out yet. For now it plays out by itself, and the Leads menu and the news say how it's going. ${AI_HINT}`);
    log("player", playerText);
    return startScene(game, id, scenes, context);
  }
  const scene = sceneFor(game, scenes);
  if (!scene) throw new StoryError(`There's no more written story here for now. You can walk around, talk to people about what they've heard, and watch the world go on. ${AI_HINT}`);
  const part = partOf(scene, game.scene.part, game.scene.id);
  const choice = matchChoice(playerText, part.choices ?? []);
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

// ---- Checking a scene file --------------------------------------------------

const GOES_TO = ["to", "pass", "fail", "won", "lost", "fled", "gaveUp", "talked"];

function checkProblem(text) {
  const [skill, difficulty, audience] = String(text).split(":");
  if (!SKILLS[skill]) return `unknown skill ${skill}`;
  if (!(difficulty in DIFFICULTY)) return `unknown difficulty ${difficulty}`;
  if (audience !== undefined && !audience) return "an empty audience";
  return null;
}

// Everything wrong with a scene, in plain words, so a mistake is found before anyone plays it.
export function sceneProblems(scene, id = "the scene") {
  const problems = [];
  const parts = scene?.parts ?? {};
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
    for (const choice of part.choices ?? []) for (const key of GOES_TO) if (choice[key] && parts[choice[key]]) stack.push(choice[key]);
  }
  for (const [name, part] of Object.entries(parts)) {
    const where = `${id}, part ${name}`;
    if (!reached.has(name)) problems.push(`${where} can't be reached`);
    const text = (Array.isArray(part.text) ? part.text : [part.text]).filter(Boolean);
    if (!text.length && !part.note) problems.push(`${where} has no text`);
    const goes = (holder, what) => {
      for (const key of GOES_TO) if (holder[key] !== undefined && !parts[holder[key]]) problems.push(`${what} goes to ${holder[key]}, which isn't a part`);
    };
    goes(part, where);
    if (part.check) {
      const problem = checkProblem(part.check);
      if (problem) problems.push(`${where} has ${problem}`);
      if (!part.pass || !part.fail) problems.push(`${where} has a check, so it needs pass and fail`);
    }
    if (part.fight) {
      const problem = toolProblem("start_combat", part.fight);
      if (problem) problems.push(`${where}: the fight ${problem}`);
      if (!part.won || !part.lost) problems.push(`${where} has a fight, so it needs won and lost`);
    }
    if (!part.check && !part.fight && !part.end && !(part.choices ?? []).length) problems.push(`${where} has no choices and doesn't end the scene`);
    for (const [i, step] of (part.do ?? []).entries()) {
      const { tool, ...input } = step;
      const problem = toolProblem(tool, input);
      if (problem) problems.push(`${where}, step ${i + 1}: ${problem}`);
    }
    for (const [i, choice] of (part.choices ?? []).entries()) {
      const what = `${where}, choice ${i + 1}`;
      if (!choice.say) problems.push(`${what} has no words`);
      goes(choice, what);
      if (choice.check) {
        const problem = checkProblem(choice.check);
        if (problem) problems.push(`${what} has ${problem}`);
        if (!choice.pass || !choice.fail) problems.push(`${what} has a check, so it needs pass and fail`);
      } else if (!choice.to) problems.push(`${what} doesn't say where it goes`);
    }
  }
  return problems;
}
