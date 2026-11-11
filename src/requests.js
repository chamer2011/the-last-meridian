// Requests: quests that come from what happens aboard, not from a story written in advance. When something goes wrong
// (the medicine cabinet nearly empty, the jump fuel low, the pantry bare), whoever it matters to has something to ask:
// a mark on their tag in the room, and when the player talks to them, they ask, and the player says yes, not now or no.
// A yes is a quest in the tracker with a goal the game counts and a day it's due by. It ends done (the player brought
// what was needed), gone (someone else put it right first: no harm done) or failed (the day came and went), each with
// the asker's line.
//
// Each kind is a scene file in world/scenes, request_<kind>.txt, with lines on top that say when it comes up, who
// asks, what puts it right, by when and when it's no longer needed; world/scenes/_how-to-write-a-scene.txt explains it
// under REQUESTS. The ask and the answers are said in the talk window (src/talks.js), and what happens after is a line
// in the story. The asker is a post ("the chief medical officer"), so whoever holds it now asks, or a job ("a cook"),
// or someone by name.
//
// game.requests, made the first time someone has something to ask, so a new game's save is unchanged until then:
//   open:  by kind, { kind, asker, at, state: "offered" or "accepted", later, base, due, quest, n }
//   rest:  by kind, the hour before which it won't be asked again
//   asked: by kind, the hour it was last asked, so the one asked longest ago comes first
//   day:   the day the last new ask came, since there's one a day at most
//   n:     how many have been taken on, for the quests' ids

import { findCharacter, fullName } from "./campaign.js";
import { ITEMS } from "./data.js";
import { YOU, calledBy, commandOf, holderKey, jobByWords, jobOf, lostReason, onJob, personByWords, postByWords, stillAlive, storyCommand } from "./command.js";
import { clearFact, recordFact } from "./record.js";
import { aboardShip } from "./role.js";
import { conditionHolds, parseCondition } from "./scene-text.js";
import { loadScenes, withStandIns } from "./scenes.js";
import { itemByWords, logisticsOf, storeByWords, storeNames } from "./logistics.js";
import { putsOf } from "./puts.js";
import { tellRequests } from "./rules.js";
import { newTurnLimits, runTool } from "./tools.js";
import { mapFor, roomOf, roomsOf } from "./walk.js";

const SHIP = "meridian";
const PREFIX = "request_";
// At most this many waiting at once, asked or taken on.
const MOST_OPEN = 3;
// How long a kind rests after it's over before it can be asked again, in hours, by how it ended.
const REST = { done: 48, gone: 48, failed: 96, no: 168, dropped: 12 };
// "Not now" puts it off this long.
const LATER = 24;
// A request ended long ago leaves the quest log after this many more have ended.
const KEEP_ENDED = 8;
// The parts every request has: the ask, the yes, and the three ways it ends. "later" and "no" are for the choices that
// lead there.
export const ANSWERS = ["yes", "later", "no"];
export const ENDINGS = ["done", "failed", "gone"];

const nowOf = (game) => game.clock?.hours ?? 0;
const dayOf = (hours) => Math.floor(hours / 24) + 1;
const upperFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

// ---- Reading a request's lines ----------------------------------------------------------------------------

const plainRoom = (words) => String(words ?? "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
function roomByWords(words) {
  const want = plainRoom(words);
  return roomsOf(mapFor(SHIP)).find((room) => plainRoom(room.name) === want || room.id === want.replace(/ /g, "_") || (room.aliases ?? []).some((one) => plainRoom(one) === want)) ?? null;
}

// "the chief medical officer", "a cook" or "Dunn Marrow", with ", in the Medbay" if they're to be found somewhere else
// than where their post or job is.
function readAsks(words, problems) {
  const [who, roomWords] = String(words ?? "").split(/,\s*in\s+/i);
  if (!who?.trim()) {
    problems.push("asks: needs who asks: a post (the chief medical officer), a job (a cook) or someone by name");
    return null;
  }
  const model = commandOf(SHIP);
  let asker = null;
  const post = postByWords(SHIP, who);
  const job = post ? null : jobByWords(SHIP, who);
  if (post) asker = { post, room: model?.posts.find((one) => one.id === post)?.room ?? null };
  else if (job) asker = { job, room: model?.jobs.find((one) => one.id === job)?.room ?? null };
  else {
    const key = personByWords(SHIP, who.trim());
    if (key && key !== YOU && key !== "nobody") asker = { person: key, room: null };
  }
  if (!asker) {
    problems.push(`asks: there's no post, job or person aboard called ${who.trim()}`);
    return null;
  }
  if (roomWords) {
    const room = roomByWords(roomWords);
    if (!room) problems.push(`asks: the Meridian has no room called ${roomWords.trim()}`);
    else asker.room = room.id;
  }
  return { ...asker, words: who.trim() };
}

// "medicine crates aboard +2", "ration crates in the pantry +2", "fuel in the tank +3".
function readNeeds(words, problems) {
  const found = String(words ?? "").trim().match(/^(.*?)\s*\+\s*(\d+)$/);
  if (!found || !Number(found[2])) {
    problems.push("needs: is what's wanted, where, and how many with a + before it: medicine crates aboard +2, ration crates in the pantry +2, or fuel in the tank +3");
    return null;
  }
  const what = found[1].trim();
  const n = Number(found[2]);
  if (/^fuel\s+in\s+the\s+tank$/i.test(what)) return { item: "fuel", where: "tank", n, label: "fuel", into: "the tank" };
  const aboard = what.match(/^(.*?)\s+aboard$/i);
  const inside = aboard ? null : what.match(/^(.*?)\s+in\s+(.+)$/i);
  const item = itemByWords(aboard?.[1] ?? inside?.[1] ?? "");
  if (!item) {
    problems.push(`needs: there's no item called ${aboard?.[1] ?? inside?.[1] ?? what}`);
    return null;
  }
  if (aboard) return { item, where: "aboard", n, label: aboard[1].trim(), into: "aboard" };
  if (!inside) {
    problems.push("needs: says where it's wanted: aboard, or in one of the stores, like in the pantry");
    return null;
  }
  const store = storeByWords(SHIP, inside[2]);
  if (!store || store.count) {
    problems.push(`needs: the Meridian has no store called ${inside[2].trim()}: its stores are ${storeNames(SHIP).join(", ")}`);
    return null;
  }
  if (!(item in store.holds)) problems.push(`needs: the ${store.name} doesn't keep ${ITEMS[item]?.name ?? item}`);
  return { item, where: store.key, n, label: inside[1].trim(), into: `to the ${store.name}` };
}

function readBy(words, problems) {
  const found = String(words ?? "").trim().match(/^(\d+)\s*(days?|hours?)$/i);
  if (!found || !Number(found[1])) {
    problems.push("by: is how long they give you once you've said yes, like 5 days or 12 hours");
    return null;
  }
  return Number(found[1]) * (/^day/i.test(found[2]) ? 24 : 1);
}

function readCondition(text, key, problems) {
  if (!text) {
    problems.push(`${key}: is missing`);
    return null;
  }
  for (const found of parseCondition(text).problems) problems.push(`${key}: ${found}`);
  return text;
}

// A request's file, made into what the game plays: the kind, its title, the conditions, the asker, what's needed and
// how long it's given. Problems say what's wrong, in plain words.
const compiled = new WeakMap();
export function compileRequest(kind, scene) {
  if (compiled.has(scene)) return compiled.get(scene);
  const problems = [];
  const top = scene?.request ?? {};
  if (!scene?.request) problems.push("a request needs its lines on top: when:, asks:, needs:, by: and gone when:");
  const model = {
    kind,
    title: scene?.title ?? kind.replaceAll("_", " "),
    when: readCondition(top.when, "when", problems),
    gone: readCondition(top.gone, "gone when", problems),
    asker: top.asks ? readAsks(top.asks, problems) : (problems.push("asks: is missing"), null),
    need: top.needs ? readNeeds(top.needs, problems) : (problems.push("needs: is missing"), null),
    hours: top.by ? readBy(top.by, problems) : (problems.push("by: is missing"), null),
    problems,
  };
  for (const part of ["ask", "yes", ...ENDINGS]) if (!scene?.parts?.[part]) problems.push(`it needs a part called ${part}`);
  if (scene?.start && scene.start !== "ask" && scene.parts?.ask) problems.push("it starts at its ask, so leave out the start: line");
  if (scene?.parts?.ask && !(scene.parts.ask.choices ?? []).some((choice) => choice.to === "yes")) problems.push("its ask needs a choice that goes to yes");
  compiled.set(scene, model);
  return model;
}

// Everything wrong with the request files, for npm run check-story: what the scene checker doesn't already say.
export function requestProblems(scenes = loadScenes().scenes) {
  const out = [];
  for (const [id, scene] of Object.entries(scenes)) {
    const isRequest = id.startsWith(PREFIX);
    if (!isRequest && scene.request) out.push(`${id}: only a request (a file called request_ and its kind) has when:, asks:, needs:, by: and gone when: lines`);
    if (!isRequest) continue;
    for (const problem of compileRequest(id.slice(PREFIX.length), scene).problems) out.push(`${id}: ${problem}`);
  }
  return out;
}

// The kinds there are, ready to play: the files that can be read, with nothing wrong in their lines on top.
function requestKinds() {
  const { scenes } = loadScenes();
  const kinds = [];
  for (const [id, scene] of Object.entries(scenes)) {
    if (!id.startsWith(PREFIX)) continue;
    const model = compileRequest(id.slice(PREFIX.length), scene);
    if (!model.problems.length) kinds.push({ model, scene });
  }
  return kinds;
}

// ---- Who asks ----------------------------------------------------------------------------------------------

// Who asks for a kind now: whoever holds the post, the one of the job already asking or the first of them at work, or
// the person named. Null when there's nobody to, or they can't be with the player (dead, in the brig, laid up).
function askerNow(game, model, open = null) {
  const a = model.asker;
  const free = (key) => key && key !== YOU && stillAlive(game, key) && !["dead", "in the brig", "being patched up", "down", "laid up in the medbay"].includes(lostReason(game, SHIP, key));
  if (a.post) {
    const key = holderKey(game, SHIP, a.post);
    return free(key) ? key : null;
  }
  if (a.job) {
    if (open?.asker && jobOf(game, SHIP, open.asker) === a.job && free(open.asker)) return open.asker;
    return onJob(game, SHIP, a.job).find((key) => free(key) && !lostReason(game, SHIP, key)) ?? onJob(game, SHIP, a.job).find(free) ?? null;
  }
  return free(a.person) ? a.person : null;
}

// What the request's lines call the asker: in what's said, the name the talk knows them by ("Dr. Sen Aduro", "Cook
// Imre"); in a FIGHT, a WITH line or a chain-of-command line, their key.
export function askerStandIn(game, key) {
  if (!key) return null;
  const person = findCharacter(game.campaign, key);
  return { id: key, name: person ? fullName(person) : key };
}
const askedBy = (game, key) => (key ? upperFirst(calledBy(game, SHIP, key)) : "Someone");

// The request someone has for the player now, asked or put off, if any. Reading it changes nothing.
export function requestFor(game, key) {
  if (!key) return null;
  const now = nowOf(game);
  const open = Object.values(game.requests?.open ?? {}).find((one) => one.state === "offered" && one.asker === key && !(one.later > now));
  return open ?? null;
}
export const asksNow = (game, key) => Boolean(requestFor(game, key));

// The request's scene, with whoever's asking in it, for the talk window.
export function requestScene(game, open) {
  const scene = loadScenes().scenes[`${PREFIX}${open.kind}`];
  return scene ? withStandIns(game, scene, { asker: askerStandIn(game, open.asker) }) : null;
}

// ---- What's wanted, and how far it's got -----------------------------------------------------------------------

const needWords = (need, n) => {
  if (need.item === "fuel") return `${n} more fuel`;
  return `${n} ${n === 1 ? need.label.replace(/s$/, "") : need.label}`;
};
// "Bring 2 medicine crates aboard (1/2)", "Put 3 more fuel in the tank (0/3)".
function objectiveOf(model, got) {
  const { need } = model;
  const shown = Math.min(need.n, Math.max(0, Math.floor(got)));
  if (need.item === "fuel") return `Put ${needWords(need, need.n)} in the tank (${shown}/${need.n})`;
  return `Bring ${needWords(need, need.n)} ${need.into} (${shown}/${need.n})`;
}
const progressOf = (game, model, open) => putsOf(game, model.need.where, model.need.item) - (open.base ?? 0);

// ---- Answers -------------------------------------------------------------------------------------------------

function stateOf(game) {
  game.requests ??= {};
  game.requests.open ??= {};
  game.requests.rest ??= {};
  game.requests.asked ??= {};
  game.requests.n ??= 0;
  return game.requests;
}

// The player has answered: yes takes it on, later puts it off a day, no turns it down. Says what to tell them.
export function answerRequest(game, kind, answer) {
  const state = stateOf(game);
  const open = state.open[kind];
  if (!open || open.state !== "offered") return [];
  const now = nowOf(game);
  if (answer === "later") {
    open.later = now + LATER;
    return [];
  }
  if (answer === "no") {
    delete state.open[kind];
    state.rest[kind] = now + REST.no;
    return [];
  }
  if (answer !== "yes") return [];
  const found = requestKinds().find((one) => one.model.kind === kind);
  if (!found) return [];
  const { model } = found;
  state.n += 1;
  const quest = `${PREFIX}${kind}_${state.n}`;
  Object.assign(open, { state: "accepted", base: putsOf(game, model.need.where, model.need.item), due: now + model.hours, quest });
  delete open.later;
  const by = askedBy(game, open.asker);
  game.quests ??= [];
  game.quests.push({
    id: quest,
    title: model.title,
    main: false,
    status: "active",
    desc: `${by} asked you on day ${dayOf(now)}.`,
    objective: objectiveOf(model, 0),
    request: kind,
    askedBy: by,
    due: open.due,
  });
  keepFewEnded(game);
  return [`[REQUEST] Taken on: ${model.title}. ${objectiveOf(model, 0).replace(/ \(\d+\/\d+\)$/, "")}, by day ${dayOf(open.due)}. It's in your quests (J), under Requests.`];
}

// Old requests that have ended leave the quest log once there are more than a few.
function keepFewEnded(game) {
  const ended = (game.quests ?? []).filter((quest) => quest.request && quest.status !== "active");
  if (ended.length <= KEEP_ENDED) return;
  const drop = new Set(ended.slice(0, ended.length - KEEP_ENDED));
  game.quests = game.quests.filter((quest) => !drop.has(quest));
}

// ---- Playing how it ended -------------------------------------------------------------------------------------

// What a part says, as one line for the story: speech as "Name: words", the rest as it is.
function partWords(part) {
  return (part?.text ?? []).filter(Boolean).map((line) => String(line).replace(/^@([^:]+):\s*/, "$1: ").replace(/^=>\s*/, "")).join(" ").trim();
}

// What a part changes, outside a talk or a scene: facts, the chain of command (a memory, loyalty) and the game's
// actions. A line that can't be played is said, and the rest go on, so the clock never stops for it.
function playSteps(game, part, notes, where) {
  const turn = newTurnLimits();
  for (const step of part?.do ?? []) {
    const { tool, set, clear, line, ...input } = step;
    try {
      if (set) recordFact(game, { id: set, text: step.text ?? null, from: where });
      else if (clear) clearFact(game, clear);
      else if (step.command) notes.push(...storyCommand(game, step));
      else if (tool) {
        const outcome = runTool(game, tool, input, turn);
        if (outcome.isError) throw new Error(outcome.result);
        if (outcome.notice) notes.push(outcome.notice);
      }
    } catch (err) {
      console.error(`${where}, line ${line ?? "?"}: ${err.message}`);
    }
  }
}

const HEADLINE = { done: "Done", gone: "No longer needed", failed: "Failed" };
// How the quest log sums it up once it's over.
const LAST_STEP = {
  done: (model) => `Done: you brought ${needWords(model.need, model.need.n)} ${model.need.item === "fuel" ? "to the tank" : model.need.into}.`,
  gone: () => "No longer needed: it was put right without you.",
  failed: (model, open) => `Failed: day ${dayOf(open.due)} came and went.`,
};

function endRequest(game, found, open, how, notes) {
  const { model } = found;
  const state = stateOf(game);
  const key = askerNow(game, model, open) ?? open.asker;
  const scene = withStandIns(game, found.scene, { asker: askerStandIn(game, key) });
  const part = scene?.parts?.[how];
  const words = partWords(part);
  notes.push(`[REQUEST] ${HEADLINE[how]}: ${model.title}.${words ? ` ${words}` : ""}`);
  playSteps(game, part, notes, `${PREFIX}${model.kind}`);
  const quest = (game.quests ?? []).find((one) => one.id === open.quest);
  if (quest) {
    quest.done = [...(quest.done ?? []), String(quest.objective ?? "").replace(/ \(\d+\/\d+\)$/, "")].slice(-20);
    quest.status = how === "failed" ? "failed" : "completed";
    quest.objective = LAST_STEP[how](model, open);
  }
  delete state.open[model.kind];
  state.rest[model.kind] = nowOf(game) + REST[how];
}

// ---- The clock ---------------------------------------------------------------------------------------------

// Whether to look for new asks: once a game hour, since the conditions don't change faster than the ship's stores do.
const lookedAt = new WeakMap();

// Called whenever the clock moves, and after the player buys or carries something. Requests taken on are counted and
// end when they should; asked ones that aren't needed any more are dropped; and once a game hour, once a day at most,
// someone with a new trouble has something to ask. Says what the player should hear.
export function advanceRequests(game) {
  const notes = [];
  if (!game?.clock || !commandOf(SHIP) || !logisticsOf(SHIP)) return notes;
  const open = Object.values(game.requests?.open ?? {});
  const hour = Math.floor(nowOf(game));
  const look = lookedAt.get(game) !== hour;
  if (!open.length && !look) return notes;
  const kinds = requestKinds();
  const byKind = new Map(kinds.map((one) => [one.model.kind, one]));
  for (const one of open) {
    const found = byKind.get(one.kind);
    // A file that's gone or can't be read any more: what was asked is dropped, and a quest taken on stays as it was.
    if (!found) {
      if (one.state === "offered") delete game.requests.open[one.kind];
      continue;
    }
    const { model } = found;
    if (one.state === "offered") {
      // Nobody's waiting to be asked about something that's been put right, or by someone who can't ask any more.
      const asker = askerNow(game, model, one);
      if (!conditionHolds(game, model.when) || !asker) {
        delete game.requests.open[one.kind];
        game.requests.rest[one.kind] = nowOf(game) + REST.dropped;
      } else one.asker = asker;
      continue;
    }
    const got = progressOf(game, model, one);
    const quest = (game.quests ?? []).find((q) => q.id === one.quest);
    if (got >= model.need.n) endRequest(game, found, one, "done", notes);
    else if (conditionHolds(game, model.gone)) endRequest(game, found, one, got > 0 ? "done" : "gone", notes);
    else if (nowOf(game) >= one.due) endRequest(game, found, one, "failed", notes);
    else if (quest) {
      quest.objective = objectiveOf(model, got);
      const asker = askerNow(game, model, one);
      if (asker) {
        one.asker = asker;
        quest.askedBy = askedBy(game, asker);
      }
    }
  }
  if (look) {
    lookedAt.set(game, hour);
    notes.push(...newAsks(game, kinds));
  }
  return notes;
}

// Someone with a new trouble has something to ask: one a day at most, three waiting at most, never one that's resting
// after it last ended, the one asked longest ago first, and only to someone who lives aboard.
function newAsks(game, kinds) {
  if (!aboardShip(game) || !kinds.length) return [];
  const now = nowOf(game);
  const today = dayOf(now);
  const waiting = Object.keys(game.requests?.open ?? {}).length;
  if (waiting >= MOST_OPEN || game.requests?.day === today) return [];
  const asked = game.requests?.asked ?? {};
  const ready = kinds
    .filter(({ model }) => !game.requests?.open?.[model.kind] && !((game.requests?.rest?.[model.kind] ?? -Infinity) > now))
    .sort((a, b) => (asked[a.model.kind] ?? -Infinity) - (asked[b.model.kind] ?? -Infinity));
  for (const found of ready) {
    const { model } = found;
    if (!conditionHolds(game, model.when)) continue;
    const asker = askerNow(game, model);
    // One thing to ask at a time each.
    if (!asker || Object.values(game.requests?.open ?? {}).some((one) => one.asker === asker)) continue;
    const state = stateOf(game);
    state.open[model.kind] = { kind: model.kind, asker, at: now, state: "offered" };
    state.asked[model.kind] = now;
    state.day = today;
    const room = model.asker.room ? roomOf(mapFor(SHIP), model.asker.room)?.name : null;
    if (game.location !== SHIP) return [];
    return [`[REQUEST] ${askedBy(game, asker)} has something to ask you${room ? `, in ${room.replace(/^The /, "the ")}` : ""}.`];
  }
  return [];
}

// The clock moves the requests on (src/rules.js can't import this file, since it reads the scenes).
tellRequests(advanceRequests);
