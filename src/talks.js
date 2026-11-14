// Conversations. Someone with a file called talk_<their id>.txt in world/scenes answers in
// their own written words, in the same parts and choices as a scene. Everyone else gets stock lines, put
// together from who they are and what they're doing, from the templates in world/rooms.json. Either way
// the clock stays still, and the person's words come up in the talk window.

import { storyRequest } from "./request-hook.js";
import { findCharacter } from "./campaign.js";
import { clearFact, recordFact } from "./record.js";
import { isCaptain, toOutsider } from "./role.js";
import { HELPERS, StoryError, choiceLine, loadScenes, matchChoice, openChoices, pageOf, partText, ruleThatHolds, withStandIns } from "./scenes.js";
import { newTurnLimits, runTool } from "./tools.js";
import { seedFrom, talkHeard, walkView } from "./walk.js";
import { ROOM_TALK, WORLD_COMPUTERS } from "./world.js";
import { applySystemsEffect, systemsTalk } from "./systems.js";
import { grudgeLine, storyCommand } from "./command.js";
import { answerOf, answerRequest, requestFor, requestScene, requestSceneOf } from "./requests.js";
import { notePut } from "./puts.js";
import { stockExtras } from "./room-hooks.js";

const helpersFor = (talk) => ({ ...HELPERS, seen: talk.written?.seen ?? [] });

const pick = (list, seed) => (Array.isArray(list) && list.length ? list[seed % list.length] : null);
const lowerFirst = (text) => (text ? text[0].toLowerCase() + text.slice(1) : text);
const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
// What someone says starts with a capital, even when it starts with what they're doing: "Clearing tables, if you must know."
const upperFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);


// What a talk or a person's ask changes besides the game's actions: a system switched (* door locked The Armory,
// * navigation on), or a password the player now knows. Lines for the story, or null when the step is neither.
function playWorldStep(game, step) {
  if (step.systems) return applySystemsEffect(game, step.systems, { by: "story" });
  if (step.password) {
    game.passwords ??= {};
    game.passwords[step.password] = step.word;
    return [`[COMPUTER] You know the password to ${WORLD_COMPUTERS[step.password]?.name ?? step.password} now.`];
  }
  return null;
}

// ---- Stock lines, for anyone without a conversation of their own ---------------

// A small conversation made from what the game knows: how they feel about the player, what they do, and where this is.
export function stockTalk(game, talk) {
  const stock = ROOM_TALK.stock ?? {};
  const person = talk.personId ? findCharacter(game.campaign, talk.personId) : null;
  const seed = seedFrom(talk.name);
  const contact = game.contacts?.find((one) => one.name.toLowerCase() === (person?.name ?? talk.name).toLowerCase());
  const feeling = talk.asleep ? "neutral" : contact?.attitude ?? "unmet";
  const role = toOutsider(game, person?.role) ?? null;
  const values = { name: talk.short, role: role ? lowerFirst(role) : "", doing: talk.doing ? lowerFirst(talk.doing) : "", desc: walkView(game)?.here?.desc ?? "" };
  const asks = stock.asks ?? {};
  const answers = [];
  if (role && asks.work && stock.work) answers.push(["work", asks.work, `@${talk.name}: "${upperFirst(fill(pick(stock.work, seed), values))}"`]);
  // Nobody asleep is asked what they're up to: "Asleep in a bunk. It doesn't do itself" isn't an answer.
  if (talk.doing && !talk.asleep && asks.doing && stock.doing) answers.push(["doing", asks.doing, `@${talk.name}: "${upperFirst(fill(pick(stock.doing, seed + 1), values))}"`]);
  if (values.desc && asks.place && stock.place) answers.push(["place", asks.place, fill(pick(stock.place, seed + 2), values)]);
  // When the alarm's ringing or the lights are out, that's what everyone wants to talk about.
  const news = systemsTalk(game);
  if (news) answers.push(["systems", asks.systems ?? "What's going on?", `@${talk.name}: "${news}"`]);
  // And what the parts of the game that add to a room have them answer (src/room-hooks.js): a question, the answer,
  // and for one that leads on, choices and parts of its own.
  const more = stockExtras(game, talk);
  for (const one of more) answers.push([one.id, one.say, one.text, one]);
  const choices = answers.map(([id, say, , extra]) => ({ say, to: id, ...(extra?.again ? {} : { if: `not seen ${id}` }) }));
  // Nobody calls someone who isn't the captain "Captain": those greetings are only for the one who is.
  const greetings = (stock.greet?.[feeling] ?? stock.greet?.neutral ?? ['"Yes?"']).filter((line) => isCaptain(game) || !/\bcaptain\b/i.test(line));
  const greet = fill(pick(greetings.length ? greetings : ['"Yes?"'], seed + 3), values);
  const parts = { start: { text: [`@${talk.name}: ${greet}`], choices } };
  for (const [id, , text, extra] of answers) parts[id] = { text: [text], choices: extra?.choices ?? choices };
  for (const one of more) for (const [id, part] of Object.entries(one.parts ?? {})) parts[id] = { text: part.text, choices: part.choices ?? choices };
  return { title: `Talking with ${talk.name}`, start: "start", parts };
}

// ---- Playing a conversation --------------------------------------------------------

function sceneOf(game, talk) {
  if (talk.written?.stock) return talk.written.stock;
  // A conversation can leave people for the game to fill in, as a scene can: {quartermaster} is whoever holds the post,
  // and in a request, {asker} is whoever's asking, and {part} and {room} what's broken.
  const scene = talk.written?.request ? requestSceneOf(game, talk.written.request) : withStandIns(game, loadScenes().scenes[talk.written?.id]);
  if (!scene) throw new StoryError(`The conversation file ${talk.written?.id} has gone, or can't be read any more. Run npm run check-story to see why.`);
  return scene;
}

// Where someone's own conversation starts, written or stock, for after they've asked what they had to ask: the part and
// the choices in it, without its first words, since they've just been speaking.
function usualStart(game, talk) {
  const { usual } = talk.written;
  const scene = usual.stock ?? withStandIns(game, loadScenes().scenes[usual.id] ?? null);
  if (!scene) return null;
  const helpers = { ...HELPERS, seen: [] };
  let id = scene.start;
  for (let hops = 0; hops < 20; hops += 1) {
    const rule = scene.parts[id] ? ruleThatHolds(scene.parts[id], game, helpers) : null;
    if (!rule) break;
    id = rule.to;
  }
  const part = scene.parts[id];
  return part ? { id, choices: openChoices(part, game, helpers) } : null;
}

// Says one part: its text and choices go in the window, and what it changes goes through the game's actions.
function enterTalkPart(game, talk, scene, id, emit, hops = 0) {
  const part = scene.parts[id];
  if (!part) throw new Error(`The conversation ${talk.written.id ?? "with " + talk.name} has no part called ${id}.`);
  const rule = ruleThatHolds(part, game, helpersFor(talk));
  if (rule) {
    if (hops > 20) throw new Error(`The conversation ${talk.written.id} goes round in circles from ${id}.`);
    return enterTalkPart(game, talk, scene, rule.to, emit, hops + 1);
  }
  talk.written.part = id;
  if (!talk.written.seen.includes(id)) talk.written.seen.push(id);
  // A part shown as a page of the ship's log keeps the talk on that page until it's over: what's said to the answer is
  // on it too, and then only closing it.
  const page = pageOf(game, part);
  if (page) talk.page = page;
  let text = partText(part, game, helpersFor(talk));
  // A request that's been answered hands the talk back to the person's own conversation: what they say to the answer,
  // then the things the player can usually say to them.
  const handBack = talk.written.request && !openChoices(part, game, helpersFor(talk)).length ? usualStart(game, talk) : null;
  if (handBack && talk.page) talk.page = { ...talk.page, done: true };
  else if (handBack) text = [text, handBack.choices.map(choiceLine).join("\n")].filter(Boolean).join("\n\n");
  // The pane by someone's head shows the newest thing said, so in a request what they say comes after what it changes
  // ("Taken on: ..."), which goes in the notes at the top as well.
  const speak = () => {
    if (text) emit({ type: "text", text });
    if (part.note) emit({ type: "notice", text: part.note });
  };
  if (!talk.written.request) speak();
  game.flags ??= {};
  const turn = { ...newTurnLimits(), talking: true };
  for (const step of part.do ?? []) {
    const { tool, set, clear, line: _line, ...input } = step;
    if (set) {
      recordFact(game, { id: set, text: step.text ?? null, from: talk.written?.id ?? null });
      continue;
    }
    if (clear) {
      clearFact(game, clear);
      continue;
    }
    // Only a story's own scene ends it, and the checker says so; a conversation's * ending line does nothing.
    if (step.ending) continue;
    // The ship's chain of command, as a conversation changes it: a memory, someone's loyalty.
    if (step.command) {
      for (const notice of storyCommand(game, step)) emit({ type: "notice", text: notice });
      continue;
    }
    // A request started now, or a kind turned off or on.
    if (step.request) {
      for (const notice of storyRequest(game, step)) emit({ type: "notice", text: notice });
      continue;
    }
    // A system switched, or a password told (step 10 of the hacking rework): as a scene plays them.
    const world = playWorldStep(game, step);
    if (world) {
      for (const notice of world) emit({ type: "notice", text: notice });
      continue;
    }
    const outcome = runTool(game, tool, input, turn);
    if (outcome.isError) throw new Error(`In the conversation ${talk.written.id}, part ${id}, ${tool} failed: ${outcome.result}`);
    if (outcome.narration) emit({ type: "text", text: outcome.narration });
    if (outcome.notice) emit({ type: "notice", text: outcome.notice });
  }
  // The player's answer to a request: yes takes it on, not now puts it off a day, no turns it down (src/requests.js).
  if (talk.written.request && answerOf(id)) for (const notice of answerRequest(game, talk.written.request, answerOf(id))) emit({ type: "notice", text: notice });
  if (talk.written.request) speak();
  if (handBack) talk.written = { id: talk.written.usual.id, part: handBack.id, seen: [handBack.id], stock: talk.written.usual.stock };
  emit({ type: "state" });
}

// The talk window has just opened. The person speaks first, in their written words or in stock ones. Says whether
// anyone spoke.
export function openWrittenTalk(game) {
  const talk = game.talk;
  if (!talk) return false;
  // Talking to someone counts for anything someone's asked the player to do that by (src/requests.js).
  notePut(game, "talk", talk.key, 1);
  const id = talk.personId ? `talk_${talk.personId}` : null;
  const { scenes, broken } = loadScenes();
  const own = id ? withStandIns(game, scenes[id] ?? null) : null;
  talk.written = { id: own ? id : null, part: null, seen: [], stock: own ? null : stockTalk(game, talk) };
  if (id && broken[id]) talkHeard(game, `[STORY] The conversation file ${id} can't be read: ${broken[id]}. Stock lines are used instead.`, "notice");
  // Someone with something to ask the player asks it first, and their own conversation goes on once it's answered.
  const asking = requestFor(game, talk.key);
  const request = asking ? requestScene(game, asking) : null;
  if (request) talk.written = { id: `request_${asking.kind}`, request: asking.kind, asker: asking.asker, part: null, seen: [], stock: null, usual: talk.written };
  // Being relieved, passed over or promoted is the first thing on someone's mind while it's fresh. It's said with
  // their first words, so that the pane by their head, which shows the newest thing said, has both.
  const grudge = grudgeLine(game, talk.personId ?? talk.name);
  let first = grudge ? `@${talk.name}: "${grudge}"` : null;
  const emit = (e) => {
    if (e.type === "text") {
      talkHeard(game, first ? `${first}\n${e.text}` : e.text);
      first = null;
    }
    if (e.type === "notice") talkHeard(game, e.text, "notice");
  };
  const opening = request ?? own ?? talk.written.stock;
  enterTalkPart(game, talk, opening, opening.start, emit);
  if (first) talkHeard(game, first);
  return true;
}

// One thing said in a written conversation. emit() streams the answer.
export function writtenTalkTurn({ game, playerText, emit }) {
  const talk = game.talk;
  if (!talk?.written) throw new StoryError("This conversation didn't start in writing. Close it and open it again.");
  const scene = sceneOf(game, talk);
  const part = scene.parts[talk.written.part];
  if (!part) throw new StoryError("The conversation has lost its place. Close it and open it again.");
  const choice = matchChoice(playerText, openChoices(part, game, helpersFor(talk)));
  if (!choice) throw new StoryError("That isn't one of the things to say here. Pick one from the list.");
  if (choice.check) throw new StoryError("A conversation can't open a check. That's a mistake in the file: run npm run check-story.");
  enterTalkPart(game, talk, scene, choice.to, emit);
}
