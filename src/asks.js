// Questions and asks for everyone (the hands-on plan, step 3). Fourteen people had conversations of their own; the
// other three hundred said hello and what they were doing. Now anyone without written lines answers a few standard
// questions from what the game knows right now: what their job is, how their own work stands (the kettle for a cook,
// the repair list for a tech, who's waiting for a nurse, the alarm for a guard, and how short-handed they are), where
// one of the officers is, what the talk is (a mutiny brewing, empty bowls, a shortage, a death, an illness going
// round), and how they are themselves, from their own body. The sentences are in world/asks.txt.
//
// And two things anyone can be asked to do, from their right-click menu and their window: Come with me (they walk
// with the player for a couple of hours, or until told That's all; someone asleep, busy, hurt or thinking too little
// of the player says no), and Go to the medbay, for someone hurt and on their feet, who then goes now and is seen as
// soon as there's a medic there, not in the morning.
//
// It registers itself with src/room-hooks.js; nothing else in the game calls it.

import fs from "node:fs";
import path from "node:path";
import { addChecker, addClockWork, addDetour, addFightAllies, addOrder, addPersonActs, addStockAnswers } from "./room-hooks.js";
import { isIllness, keyAt, mendedByTechs, queueOf, seriousWound, woundsNow } from "./body.js";
import { findCharacter, findEnemy } from "./campaign.js";
import { YOU, commandOf, holderKey, jobById, jobOf, jobsOf, lostReason, loyaltyOf, mutinyStage, onJob, postAndName, postOf } from "./command.js";
import { inTrouble } from "./daily.js";
import { deadAt } from "./death.js";
import { whereNow } from "./life.js";
import { countOf, logisticsOf } from "./logistics.js";
import { downRecord, medbayOf, medbayView } from "./medbay.js";
import { worldDir } from "./paths.js";
import { roundsView } from "./register.js";
import { isCaptain, startOf } from "./role.js";
import { findContact } from "./rules.js";
import { shipGoingHungry } from "./ship.js";
import { alarmRinging, waitingForParts } from "./systems.js";
import { canStand, mapFor, seedFrom } from "./walk.js";

export const ASKS_FILE = process.env.GAME_ASKS_FILE ?? path.join(worldDir, "asks.txt");
const SHIP = "meridian";
// How long someone walks with the player, and how long someone sent to the medbay waits there to be seen.
const ALONG_HOURS = 2;
const SENT_HOURS = 6;
// An officer who thinks this little of the captain has work of their own.
const WILLING = 40;

const lower = (text) => String(text ?? "").trim().toLowerCase();
const upperFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const listed = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);
const fill = (text, values) => String(text).replace(/\{([a-z ]+)\}/g, (_, key) => values[key] ?? "");
const aWord = (words) => `${/^[aeiou]/i.test(words) ? "an" : "a"} ${words}`;
const nowOf = (game) => game.clock?.hours ?? 0;

// ---- The file -----------------------------------------------------------------------------------------

// Each name a line can have, with the words in braces the game fills in for it.
const QUESTIONS = ["job", "going", "where", "news", "self", "never mind"];
const ANSWERS = {
  job: ["job", "a job", "room", "keeper"], "job spare": ["keeper"],
  "going short": ["n", "keeper"], "going cook empty": [], "going cook": ["sittings"], "going tech waiting": ["n"], "going tech broken": ["n"], "going tech": [],
  "going nurse waiting": ["n"], "going nurse": [], "going guard alarm": [], "going guard": [], going: [],
  "where who": [], where: ["who", "where"], "where gone": ["who"],
  "news mutiny": [], "news hungry": [], "news short": ["what"], "news dead": ["who"], "news sick": ["illness", "n"], "news low": [], "news trouble": [], news: [],
  "self hurt": ["wounds"], "self ill": ["illness"], "self hungry": [], self: [],
};
const COME = ["yes", "yes captain", "done", "no asleep", "no busy", "no hurt", "no post", "no loyalty", "no stranger", "medbay yes", "medbay no"];
const PARTS = { questions: "questions", answers: "answers", "come with me": "come" };

export function parseAsks(text) {
  const model = { questions: {}, answers: {}, come: {}, problems: [] };
  const wrong = (line, message) => model.problems.push(`world/asks.txt, line ${line}: ${message}`);
  let part = null;
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    if (!line || line.startsWith("#") || /^draft:/i.test(line)) return;
    const head = line.match(/^([A-Za-z ]+):$/);
    if (head) {
      part = PARTS[lower(head[1])] ?? null;
      if (!part) wrong(n, `there's no part called "${head[1]}": the parts are Questions, Answers, and Come with me`);
      return;
    }
    if (!part) return;
    const found = line.match(/^- ([a-z ]+): (.+)$/);
    if (!found) return wrong(n, "each line here goes: a dash, the line's name, a colon, and what's said");
    const [, name, words] = found;
    const allowed = part === "questions" ? (QUESTIONS.includes(name) ? [] : null) : part === "answers" ? ANSWERS[name] ?? null : COME.includes(name) ? ["name"] : null;
    if (!allowed) return wrong(n, `"${name}" isn't a line the game says under ${part === "come" ? "Come with me" : upperFirst(part)}`);
    for (const [, key] of words.matchAll(/\{([^}]*)\}/g)) if (!allowed.includes(key)) wrong(n, `{${key}} isn't something the game fills in for "${name}"${allowed.length ? `: it has ${listed(allowed.map((one) => `{${one}}`))}` : ""}`);
    if (part === "questions") model.questions[name] = words;
    else (model[part][name] ??= []).push(words);
  });
  return model;
}

let read;
export function asksModel() {
  if (read === undefined) read = fs.existsSync(ASKS_FILE) ? parseAsks(fs.readFileSync(ASKS_FILE, "utf8")) : null;
  return read;
}
export const forgetAsks = () => { read = undefined; };
export const asksProblems = () => asksModel()?.problems ?? [];
addChecker(asksProblems);

// One of a name's lines, the same one for the same person, with its words filled in. Null when the file has none.
function lineOf(model, part, name, seed, values = {}) {
  const lines = model?.[part]?.[name];
  return lines?.length ? fill(lines[seed % lines.length], values) : null;
}

// ---- What they answer ---------------------------------------------------------------------------------

const keeperOf = (game, place) => {
  const post = commandOf(place)?.posts.find((one) => one.watchBill);
  const name = post ? postAndName(game, place, post.id) : null;
  return name === "You" ? "you" : name ?? "whoever keeps the watch bill";
};

// How someone's own work stands: the name of the line that says it, and the numbers in it.
function howItGoes(game, place, key) {
  const jobs = jobsOf(game, place);
  if (!(key in jobs)) return null;
  const id = jobs[key];
  const job = id ? jobById(place, id) : null;
  if (job) {
    const here = onJob(game, place, id).filter((one) => !lostReason(game, place, one)).length;
    if (job.wanted - here > 0) return ["going short", { n: job.wanted - here, keeper: keeperOf(game, place) }];
  }
  if (id === "cook") {
    const sittings = (logisticsOf(place)?.kettles ?? []).reduce((sum, kettle) => sum + countOf(game, kettle), 0);
    return sittings > 0 ? ["going cook", { sittings }] : ["going cook empty", {}];
  }
  if (id === "tech") {
    const waiting = waitingForParts(game, place).length;
    const broken = Object.values(game.systems?.[place]?.parts ?? {}).filter((part) => part?.damage).length;
    return waiting ? ["going tech waiting", { n: waiting }] : broken ? ["going tech broken", { n: broken }] : ["going tech", {}];
  }
  if (id === "nurse") {
    const view = medbayView(game, place);
    const waiting = [...(view?.cots ?? []), ...(view?.floor ?? [])].filter((one) => one && /^waiting for treatment/.test(one.state)).length;
    return waiting ? ["going nurse waiting", { n: waiting }] : ["going nurse", {}];
  }
  if (id === "guard") return alarmRinging(game, place) ? ["going guard alarm", {}] : ["going guard", {}];
  return ["going", {}];
}

// The talk of the place: the worst thing going on, as people would put it.
function theTalk(game, place) {
  if (place !== SHIP) return inTrouble(game, place) ? ["news trouble", {}] : ["news", {}];
  if (mutinyStage(game, place) >= 1) return ["news mutiny", {}];
  if (shipGoingHungry(game)) return ["news hungry", {}];
  const out = Object.keys(game.ship?.out ?? {}).find((id) => game.ship.out[id] > 0);
  if (out) return ["news short", { what: out }];
  const today = Math.floor(nowOf(game) / 24);
  const dead = deadAt(game, place).filter((one) => today - Math.floor((one.at ?? 0) / 24) <= 3).at(-1);
  if (dead?.name) return ["news dead", { who: dead.name }];
  const sick = (roundsView(game)?.byKind ?? []).sort((a, b) => b.n - a.n)[0];
  if (sick && sick.n >= 3) return ["news sick", { illness: aWord(sick.name.toLowerCase()), n: sick.n }];
  if ((game.ship?.morale ?? 50) < 35) return ["news low", {}];
  return ["news", {}];
}

// How they are, from their own body.
function howTheyAre(game, place, key) {
  const wounds = woundsNow(game, keyAt(place, key));
  const hurt = wounds.filter((wound) => !isIllness(wound));
  if (hurt.length) return ["self hurt", { wounds: upperFirst(listed(hurt.slice(0, 3).map((wound) => wound.words))) }];
  const ill = wounds.find((wound) => isIllness(wound));
  if (ill) return ["self ill", { illness: ill.words }];
  if (place === SHIP && shipGoingHungry(game)) return ["self hungry", {}];
  return ["self", {}];
}

// Who can be asked after: the ship's officers, in the order of the command file, and whoever the story is waiting on.
function askedAfter(game, place, talk) {
  const people = [];
  const add = (key, name) => {
    if (!key || key === YOU || key === talk.key || !name || people.some((one) => one.key === key) || people.length >= 6) return;
    people.push({ key, name });
  };
  const waited = game.scene?.with;
  if (waited) add(waited, findCharacter(game.campaign, waited)?.name ?? waited);
  for (const post of commandOf(place)?.posts ?? []) add(holderKey(game, place, post.id), postAndName(game, place, post.id));
  return people;
}

addStockAnswers((game, talk) => {
  const model = asksModel();
  if (!model || talk.asleep) return [];
  const place = game.location;
  const seed = seedFrom(talk.name);
  const said = (text) => `@${talk.name}: "${text}"`;
  const out = [];
  const answer = (id, part, name, values, turn = 0) => {
    const text = lineOf(model, part, name, seed + turn, values);
    if (text && model.questions[id]) out.push({ id, say: model.questions[id], text: said(text) });
  };
  const jobs = commandOf(place) ? jobsOf(game, place) : {};
  // Someone the story has given a role says that already; the crowd on the watch bill says their job.
  if (talk.key in jobs && !(talk.personId && findCharacter(game.campaign, talk.personId)?.role)) {
    const job = jobs[talk.key] ? jobById(place, jobs[talk.key]) : null;
    if (job) answer("job", "answers", "job", { job: upperFirst(job.title), "a job": aWord(job.title), room: job.roomName ?? "the ship", keeper: keeperOf(game, place) });
    else answer("job", "answers", "job spare", { keeper: keeperOf(game, place) });
  }
  const going = commandOf(place) ? howItGoes(game, place, talk.key) : null;
  if (going) answer("going", "answers", going[0], going[1], 1);
  // Where someone is: a question that leads to a name, and the name to where they were last seen.
  const after = askedAfter(game, place, talk);
  const who = lineOf(model, "answers", "where who", seed);
  if (after.length && model.questions.where && who) {
    const parts = {};
    const choices = after.map((one, i) => {
      const where = whereNow(game, one.key);
      const text = where ? lineOf(model, "answers", "where", seed + i, { who: one.name, where: upperFirst(where) }) : lineOf(model, "answers", "where gone", seed + i, { who: one.name });
      parts[`where_${i}`] = { text: [said(text ?? "...")] };
      return { say: one.name, to: `where_${i}` };
    });
    parts.where_back = { text: [] };
    choices.push({ say: model.questions["never mind"] ?? "Never mind.", to: "where_back" });
    out.push({ id: "where", say: model.questions.where, text: said(who), again: true, choices, parts });
  }
  const news = theTalk(game, place);
  answer("news", "answers", news[0], news[1], 2);
  const self = howTheyAre(game, place, talk.key);
  answer("self", "answers", self[0], self[1], 3);
  return out;
});

// ---- Come with me -------------------------------------------------------------------------------------

const stateOfPerson = (game, key) => game.life?.places?.[game.location]?.[key] ?? null;
const nameOf = (game, entry) => (entry.id ? findCharacter(game.campaign, entry.id)?.name : null) ?? entry.name ?? "They";
// Someone turned aside from their day by anything but walking with the player: an errand, a call, a repair, the queue.
const handsFull = (game, key) => {
  const task = String(stateOfPerson(game, key)?.task ?? "");
  return task.startsWith("systems:") && !task.startsWith("systems:with:");
};

// Whether someone will walk with the player: the name of the line that says yes or no.
export function willCome(game, entry, key) {
  const place = game.location;
  if (entry.asleep) return "no asleep";
  const bodyKey = keyAt(place, key);
  if (downRecord(game, place, key) || woundsNow(game, bodyKey).some((wound) => seriousWound(wound))) return "no hurt";
  // Someone turned aside from their day already, by an errand, a call, a repair or the queue, has their hands full.
  if (handsFull(game, key)) return "no busy";
  const person = entry.id ? findCharacter(game.campaign, entry.id) : null;
  const liked = ["friendly", "ally"].includes(findContact(game, person?.name ?? entry.name ?? "")?.attitude);
  if (place === SHIP && commandOf(place)) {
    const post = postOf(game, place, key);
    if (isCaptain(game)) return post && loyaltyOf(game, place, key) < WILLING ? "no loyalty" : "yes captain";
    if (post) return liked ? "yes" : "no post";
    // Crew go with their own: the same job, or a spare hand, or someone who likes them.
    const mine = jobOf(game, place, YOU);
    const theirs = jobOf(game, place, key);
    return liked || theirs === null || (mine && theirs === mine) ? "yes" : "no busy";
  }
  // Away from the ship: someone who likes the player, or anyone at the place the player's own life began.
  return liked || startOf(game)?.place === place ? "yes" : "no stranger";
}

const sayTo = (game, entry, name) => lineOf(asksModel(), "come", name, seedFrom(nameOf(game, entry)), { name: nameOf(game, entry) }) ?? (name.startsWith("no") || name === "medbay no" ? '"No."' : '"All right."');

function entryFor(people, body) {
  const key = String(body.key ?? "").replace(/^person:/, "");
  const entry = people.find((one) => (one.id ?? one.name) === key);
  if (!entry) throw new Error("They aren't there any more.");
  return { key, entry };
}

// Whether someone hurt would be seen at the place's medbay if they went now: on their feet, not a synthetic (the
// techs mend those), and not there already.
function couldGo(game, place, key) {
  const bodyKey = keyAt(place, key);
  if (!game.bodies?.[bodyKey]?.wounds?.length) return false;
  if (!medbayOf(place)?.room || !queueOf(place) || downRecord(game, place, key) || mendedByTechs(game, bodyKey)) return false;
  return woundsNow(game, bodyKey).some((wound) => !wound.dressed && !isIllness(wound)) && !game.sent?.[bodyKey];
}

addPersonActs((game, entry, key) => {
  if (!asksModel() || downRecord(game, game.location, key)) return null;
  const acts = [];
  if (game.along?.key === key && game.along.place === game.location) acts.push({ id: "thats-all", label: "That's all", detail: "they go back to their day" });
  else acts.push({ id: "come-along", label: "Come with me", detail: "for a couple of hours" });
  if (couldGo(game, game.location, key)) acts.push({ id: "send-medbay", label: "Go to the medbay", detail: "now, not in the morning" });
  return acts;
});

addOrder("come-along", (game, body, { people }) => {
  const { key, entry } = entryFor(people, body);
  const answer = willCome(game, entry, key);
  const words = `${nameOf(game, entry)}: ${sayTo(game, entry, answer)}`;
  if (!answer.startsWith("yes")) return { said: words };
  const fights = Boolean(entry.id && findEnemy(game.campaign, entry.id)?.named);
  game.along = { place: game.location, key, id: entry.id ?? null, name: nameOf(game, entry), until: nowOf(game) + ALONG_HOURS, ...(fights ? { fights: true } : {}) };
  return { said: `${words}\n[WITH] ${nameOf(game, entry)} is walking with you, for a couple of hours or until you say that's all.` };
});

addOrder("thats-all", (game, body, { people }) => {
  const { key, entry } = entryFor(people, body);
  if (game.along?.key !== key) throw new Error("They aren't walking with you.");
  game.along = null;
  return { said: `${nameOf(game, entry)}: ${sayTo(game, entry, "done")}` };
});

addOrder("send-medbay", (game, body, { people }) => {
  const { key, entry } = entryFor(people, body);
  const place = game.location;
  if (!couldGo(game, place, key)) throw new Error("There's nothing the medbay would do for them now.");
  // Someone asleep or with their hands full goes in the morning, like anyone.
  if (entry.asleep || handsFull(game, key)) return { said: `${nameOf(game, entry)}: ${sayTo(game, entry, "medbay no")}` };
  if (game.along?.key === key) game.along = null;
  game.sent = { ...(game.sent ?? {}), [keyAt(place, key)]: { place, who: key, at: nowOf(game), until: nowOf(game) + SENT_HOURS } };
  return { said: `${nameOf(game, entry)}: ${sayTo(game, entry, "medbay yes")}` };
});

// Where the one walking with the player goes: a square beside them, wherever they've got to on the place's map.
function besidePlayer(game, place) {
  const walk = game.walk;
  if (!walk || walk.room || walk.place !== place) return null;
  const level = mapFor(place)?.levels?.[walk.level];
  if (!level) return null;
  const step = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dx, dy]) => ({ x: walk.x + dx, y: walk.y + dy })).find((one) => canStand(level, one.x, one.y));
  return step ? { level: level.id, ...step } : null;
}

addDetour((game, place) => {
  const along = game.along?.place === place && place === game.location ? game.along : null;
  const spot = along ? besidePlayer(game, place) : null;
  const sent = Object.values(game.sent ?? {}).filter((one) => one.place === place);
  const queue = sent.length ? queueOf(place) : null;
  if (!spot && !queue) return null;
  return (key) => {
    if (spot && key === along.key) return { where: `with:${spot.level}:${spot.x},${spot.y}`, spot, doing: "walking with you" };
    if (queue && sent.some((one) => one.who === key)) return { where: queue.at, doing: "waiting at the medbay to be seen" };
    return null;
  };
});

// Time's up, the player has left the place, or they've been hurt or called away: they go back to their day. And
// someone sent to the medbay stops waiting once they've been seen to, or after a while.
addClockWork((game) => {
  const notes = [];
  const along = game.along;
  if (along) {
    const gone = game.location !== along.place || nowOf(game) >= along.until || downRecord(game, along.place, along.key) || game.dead?.[keyAt(along.place, along.key)];
    if (gone) {
      game.along = null;
      if (game.location === along.place) notes.push(`[WITH] ${along.name} goes back to their day.`);
    }
  }
  for (const [bodyKey, one] of Object.entries(game.sent ?? {})) {
    const waiting = woundsNow(game, bodyKey).some((wound) => !wound.dressed && !isIllness(wound));
    if (nowOf(game) < one.until && waiting && !game.down?.[bodyKey]) continue;
    const { [bodyKey]: _gone, ...rest } = game.sent;
    game.sent = rest;
  }
  return notes;
});

// Whoever's walking with the player, and can fight, stands with them when a fight starts in the place they're in.
addFightAllies((game) => (game.along?.fights && game.along.place === game.location && game.along.id ? [game.along.id] : []));
