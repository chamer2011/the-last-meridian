// The Graveyard's wrecks the rig's parts come from (step 5 of the hacking rework): world/wrecks/<id>.txt, read again
// whenever one has changed (looked at no more than once a second). At the place a wreck's file names, You can offers a
// shuttle out to it. A run takes an air bottle from the pack, and the bottle's air runs down with the clock whatever the
// player does. Each job takes its minutes and a level of Engineering: below it, the rig parts come out broken; scrap
// and anything else comes out as it is. What's done on a wreck stays done and what's taken stays taken, so a wreck is
// stripped bare over a run or two. What's carried goes home when the player goes back to the shuttle; if the air runs
// out first, the shuttle's crew haul them out, and what they carried is left by the airlock for the next run. The
// Harrow (src/salvage.js) is the ship's own salvage run and works as it did: one run at a time, wherever it's to.
//
// game.wreckRun: { at: wreck, since: hour, air: minutes, carried: { parts: [{ id, cond }], items: { id: n } } }, while
// out at one. game.wrecks: { done: { wreck: [job ids] }, left: { wreck: { parts, items } } }.
// It registers itself with src/room-hooks.js; nothing else in the game calls it. GAME_WRECKS_DIR points tests at a copy.
import fs from "node:fs";
import path from "node:path";
import { addChecker, addClockWork, addOrder, addRoomActs } from "./room-hooks.js";
import { worldDir } from "./paths.js";
import { ITEMS, LOCATIONS } from "./data.js";
import { rigPartById } from "./rig-parts.js";
import { giveRigPart } from "./rig.js";
import { dealersNow } from "./dealers.js";
import { addItem, changeStress, passTime, practice, removeItem, skillRank } from "./rules.js";

export const WRECKS_DIR = process.env.GAME_WRECKS_DIR ?? path.join(worldDir, "wrecks");
export const AIR_BOTTLE = "air_bottle";
// Picking up what was left by the airlock on a run before.
const PICK_UP = { id: "left", minutes: 5 };

const nowOf = (game) => game.clock?.hours ?? 0;
const listed = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);
const aWord = (name) => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
const inSentence = (name) => name.replace(/^The /, "the ");

// ---- The files ----------------------------------------------------------------------------------------

// "standard_cell, memory_2, 2 scrap": rig parts and items, one of each or a number of them. "nothing" is nothing.
function readGives(text, problem) {
  if (/^nothing\b/i.test(text.trim())) return [];
  const out = [];
  for (const piece of text.split(",").map((one) => one.trim()).filter(Boolean)) {
    const m = /^(?:(\d+) )?([a-z0-9_]+)$/i.exec(piece);
    if (!m) {
      problem(`"${piece}" isn't something a job gives: write a rig part's or an item's id, like memory_2, or 2 scrap`);
      continue;
    }
    out.push({ id: m[2].toLowerCase(), n: Number(m[1] ?? 1) });
  }
  return out;
}

// One file, read into { id, name, at, order, was, line, shuttle, air, stress, jobs: [{ id, label, minutes, engineering,
// behind, gives }], problems }. Every problem names its file and line.
export function parseWreck(id, text) {
  const w = { id, name: id, at: null, order: 99, was: "", line: "", shuttle: null, air: null, stress: 15, jobs: [], problems: [] };
  const at = (n, message) => w.problems.push(`wrecks/${id}.txt line ${n}: ${message}`);
  let part = null;
  String(text ?? "").replace(/\r/g, "").split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (i === 0 && line.startsWith("#")) {
      w.name = line.slice(1).trim() || w.name;
      return;
    }
    if (!line || line.startsWith("#") || /^draft:/i.test(line)) return;
    if (/^jobs:$/i.test(line)) {
      part = "jobs";
      return;
    }
    if (part === "jobs") {
      const m = /^([a-z0-9_]+): (.+?), (\d+) minutes, engineering (\d+)(?:, behind the ([a-z0-9_]+))?: (.+)$/i.exec(line);
      if (!m) return at(i + 1, `a job is written like "lockers: Empty the crew lockers, 15 minutes, Engineering 1: standard_cell, 2 scrap", with ", behind the hatch" before the colon if another job has to be done first`);
      const job = { id: m[1].toLowerCase(), label: m[2].trim(), minutes: Number(m[3]), engineering: Number(m[4]), behind: m[5]?.toLowerCase() ?? null, gives: readGives(m[6], (message) => at(i + 1, message)), line: i + 1 };
      if (w.jobs.some((one) => one.id === job.id)) return at(i + 1, `there are two jobs called ${job.id}`);
      w.jobs.push(job);
      return;
    }
    const m = /^([a-z ]+):\s*(.*)$/i.exec(line);
    if (!m) return at(i + 1, `"${line.slice(0, 40)}" isn't a line this file knows`);
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    const minutes = /^(\d+) minutes(?: each way)?$/i.exec(value);
    if (key === "at") w.at = value.toLowerCase();
    else if (key === "order") w.order = Number(value) || 99;
    else if (key === "it was") w.was = value;
    else if (key === "in a line") w.line = value;
    else if (key === "the shuttle") {
      if (!minutes) return at(i + 1, `the shuttle is written like "20 minutes each way"`);
      w.shuttle = Number(minutes[1]);
    } else if (key === "a bottle of air") {
      if (!minutes) return at(i + 1, `a bottle of air is written like "60 minutes"`);
      w.air = Number(minutes[1]);
    } else if (key === "out of air") {
      const stress = /^stress (\d+)$/i.exec(value);
      if (!stress) return at(i + 1, `out of air is written like "stress 15"`);
      w.stress = Number(stress[1]);
    } else at(i + 1, `there's no line called "${key}"`);
  });
  for (const [key, words] of [["at", "an at line, the place it's reached from"], ["shuttle", "a line for the shuttle, like the shuttle: 20 minutes each way"], ["air", "a line for the air, like a bottle of air: 60 minutes"]]) {
    if (w[key] === null) w.problems.push(`wrecks/${id}.txt: it needs ${words}`);
  }
  for (const job of w.jobs) if (job.behind && !w.jobs.some((one) => one.id === job.behind)) at(job.line, `there's no job called ${job.behind} for it to be behind`);
  if (!w.jobs.length) w.problems.push(`wrecks/${id}.txt: it needs a Jobs: line, and a job under it`);
  return w;
}

let cache = null;
// Every wreck, in order, with what's wrong in their files. Read again when a file changes.
export function wrecksNow() {
  const now = Date.now();
  if (cache && now - cache.looked < 1000) return cache;
  let files = [];
  try {
    files = fs.readdirSync(WRECKS_DIR).filter((name) => name.endsWith(".txt") && !name.startsWith("_"));
  } catch {
    files = [];
  }
  const stamp = files.map((name) => {
    try {
      return `${name}:${fs.statSync(path.join(WRECKS_DIR, name)).mtimeMs}`;
    } catch {
      return name;
    }
  }).join("|");
  if (cache?.stamp === stamp) {
    cache.looked = now;
    return cache;
  }
  const list = files.map((name) => parseWreck(name.slice(0, -4), fs.readFileSync(path.join(WRECKS_DIR, name), "utf8")));
  list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  cache = { stamp, looked: now, list, byId: Object.fromEntries(list.map((w) => [w.id, w])) };
  return cache;
}
export const wreckById = (id) => wrecksNow().byId[String(id ?? "")] ?? null;
// The wrecks that can be reached from a place, and only whole ones.
const wrecksAt = (place) => wrecksNow().list.filter((w) => w.at === place && !w.problems.length);

export function wreckProblems() {
  const out = wrecksNow().list.flatMap((w) => w.problems);
  for (const w of wrecksNow().list) {
    if (w.at && !LOCATIONS[w.at]) out.push(`wrecks/${w.id}.txt: there's no place called ${w.at}`);
    for (const job of w.jobs) for (const one of job.gives) if (!rigPartById(one.id) && !ITEMS[one.id]) out.push(`wrecks/${w.id}.txt line ${job.line}: ${one.id} isn't a rig part or an item`);
  }
  if (wrecksNow().list.length && !ITEMS[AIR_BOTTLE]) out.push(`wrecks: a run takes an air bottle, and there's no ${AIR_BOTTLE} in world/items`);
  return out;
}
addChecker(() => (fs.existsSync(WRECKS_DIR) ? wreckProblems() : []));

// ---- Words --------------------------------------------------------------------------------------------

const thingName = (id) => (rigPartById(id)?.name ?? ITEMS[id]?.name ?? id).toLowerCase();
function givesWords(gives, cond = null) {
  return listed(gives.map((one) => {
    if (one.id === "scrap") return `${one.n} scrap`;
    const name = `${cond && rigPartById(one.id) && cond !== "new" ? `${cond} ` : ""}${thingName(one.id)}`;
    return one.n === 1 ? aWord(name) : `${one.n} ${name}s`;
  }));
}
// What's carried, or left by the airlock, in words.
function carriedWords(carried) {
  const parts = {};
  for (const one of carried?.parts ?? []) {
    const key = `${one.cond}|${one.id}`;
    parts[key] = (parts[key] ?? 0) + 1;
  }
  const words = [
    ...Object.entries(parts).map(([key, n]) => {
      const [cond, id] = key.split("|");
      const name = `${cond === "new" ? "" : `${cond} `}${thingName(id)}`;
      return n === 1 ? aWord(name) : `${n} ${name}s`;
    }),
    ...Object.entries(carried?.items ?? {}).map(([id, n]) => (id === "scrap" ? `${n} scrap` : n === 1 ? aWord(thingName(id)) : `${n} ${thingName(id)}s`)),
  ];
  return words.length ? listed(words) : "nothing";
}
const nothingIn = (carried) => !(carried?.parts?.length) && !Object.keys(carried?.items ?? {}).length;

// ---- The run ------------------------------------------------------------------------------------------

const doneOn = (game, w) => game.wrecks?.done?.[w.id] ?? [];
const leftOn = (game, w) => game.wrecks?.left?.[w.id] ?? null;
// A wreck with nothing left to take: every job that gives something done, and nothing left by the airlock.
export const strippedBare = (game, w) => w.jobs.every((job) => !job.gives.length || doneOn(game, w).includes(job.id)) && nothingIn(leftOn(game, w));
// The minutes of air left in the bottle, on a run.
export const wreckAirLeft = (game) => (game.wreckRun ? Math.max(0, Math.round(game.wreckRun.air - (nowOf(game) - game.wreckRun.since) * 60)) : null);
const bottles = (game) => game.inventory?.[AIR_BOTTLE] ?? 0;
const bottleSeller = () => dealersNow().list.find((d) => d.sells.some((one) => one.id === AIR_BOTTLE))?.name ?? null;

// Why a job can't be done now, or null.
function jobWhy(game, w, job) {
  if (job.behind && !doneOn(game, w).includes(job.behind)) return `the ${job.behind.replace(/_/g, " ")} is in the way`;
  if (job.minutes > wreckAirLeft(game)) return "not enough air left";
  return null;
}
function jobDetail(game, job) {
  const short = skillRank(game, "engineering") < job.engineering;
  const what = job.gives.length ? givesWords(job.gives) : "it opens the way on";
  return `Engineering ${job.engineering}${short && job.gives.some((one) => rigPartById(one.id)) ? `, and yours is ${skillRank(game, "engineering")}: the parts will come out broken` : ""}. ${what[0].toUpperCase()}${what.slice(1)}`;
}

addRoomActs((game, { place }) => {
  const wrecks = wrecksAt(place);
  // Out at the Harrow (src/salvage.js), these wait.
  if (!wrecks.length || game.salvage) return null;
  const run = game.wreckRun;
  if (!run) {
    return wrecks.map((w) => {
      const bare = strippedBare(game, w);
      const none = !bare && bottles(game) < 1;
      const why = bare ? "stripped bare: there's nothing left on it to take" : none ? `you've no air bottle${bottleSeller() ? `: ${bottleSeller()} sells them` : ""}` : null;
      return { id: "wreck-start", key: w.id, label: `Take the shuttle out to ${inSentence(w.name)}`, detail: why ?? `${w.was ? `${w.was}: ` : ""}an air bottle for ${w.air} minutes, ${w.shuttle} minutes each way; you have ${bottles(game)}`, ...(why ? { disabled: true } : {}) };
    });
  }
  const w = wreckById(run.at);
  if (!w || w.at !== place) return null;
  const air = wreckAirLeft(game);
  const acts = w.jobs.filter((job) => !doneOn(game, w).includes(job.id)).map((job) => {
    const why = jobWhy(game, w, job);
    return { id: "wreck-job", key: job.id, label: `${job.label} (${job.minutes} minutes)`, detail: why ?? jobDetail(game, job), ...(why ? { disabled: true } : {}) };
  });
  if (!nothingIn(leftOn(game, w))) acts.unshift({ id: "wreck-job", key: PICK_UP.id, label: `Pick up what you left by the airlock (${PICK_UP.minutes} minutes)`, detail: carriedWords(leftOn(game, w)) });
  // The air left is on the button itself, since what's beside a button here is only shown when it's pointed at.
  acts.push({ id: "wreck-back", label: `Go back to the shuttle (${air} minutes of air left)`, detail: `carrying ${carriedWords(run.carried)}` });
  return acts;
});

addOrder("wreck-start", (game, body) => {
  const w = wreckById(body.key);
  if (!w || w.at !== game.location || w.problems.length) throw new Error("There's no wreck like that to go out to from here.");
  if (game.wreckRun || game.salvage) throw new Error("You're out there already.");
  if (strippedBare(game, w)) throw new Error(`There's nothing left on ${inSentence(w.name)} to take.`);
  if (bottles(game) < 1) throw new Error(`A run out takes an air bottle, and you've none.${bottleSeller() ? ` ${bottleSeller()} sells them.` : ""}`);
  removeItem(game, AIR_BOTTLE, 1);
  const notes = passTime(game, w.shuttle / 60, "active");
  game.wreckRun = { at: w.id, since: nowOf(game), air: w.air, carried: { parts: [], items: {} } };
  const done = doneOn(game, w).length;
  return { said: [`[SALVAGE] The shuttle puts you across to ${inSentence(w.name)}${w.was ? `, ${w.was}` : ""}${done ? ", where you've been before" : ""}. You've a fresh bottle: ${w.air} minutes of air. What you do is under You can.`, ...notes].join("\n") };
});

// Out of air, or gone from the place: what was carried is left by the airlock, with anything left there before.
function leaveByTheAirlock(game, w, carried) {
  if (nothingIn(carried)) return;
  game.wrecks ??= { done: {}, left: {} };
  game.wrecks.left ??= {};
  const left = game.wrecks.left[w.id] ?? { parts: [], items: {} };
  left.parts = [...(left.parts ?? []), ...(carried.parts ?? [])];
  for (const [id, n] of Object.entries(carried.items ?? {})) left.items[id] = (left.items[id] ?? 0) + n;
  game.wrecks.left[w.id] = left;
}
function outOfAir(game) {
  const run = game.wreckRun;
  const w = wreckById(run.at);
  game.wreckRun = null;
  if (!w) return [];
  leaveByTheAirlock(game, w, run.carried);
  const what = nothingIn(run.carried) ? "you'd nothing to leave but your breath" : `what you were carrying is left by the airlock: ${carriedWords(run.carried)}. It'll be there next time`;
  return [`[SALVAGE] The bottle's empty. The shuttle's crew haul you out of ${inSentence(w.name)} by your harness, and ${what}.`, ...changeStress(game, w.stress)];
}

addOrder("wreck-job", (game, body) => {
  const run = game.wreckRun;
  const w = run ? wreckById(run.at) : null;
  if (!w) throw new Error("You're not out at a wreck.");
  const key = String(body.key ?? "");
  if (key === PICK_UP.id) {
    const left = leftOn(game, w);
    if (nothingIn(left)) throw new Error("There's nothing by the airlock.");
    const notes = passTime(game, PICK_UP.minutes / 60, "work");
    if (!game.wreckRun) return { said: notes.join("\n") };
    run.carried.parts.push(...(left.parts ?? []));
    for (const [id, n] of Object.entries(left.items ?? {})) run.carried.items[id] = (run.carried.items[id] ?? 0) + n;
    delete game.wrecks.left[w.id];
    return { said: [`[SALVAGE] By the airlock, where you left them: ${carriedWords(left)}. You pick them up. ${wreckAirLeft(game)} minutes of air left.`, ...notes].join("\n") };
  }
  const job = w.jobs.find((one) => one.id === key);
  if (!job || doneOn(game, w).includes(job.id)) throw new Error("That's done.");
  const why = jobWhy(game, w, job);
  if (why) throw new Error(`Not yet: ${why}.`);
  const notes = passTime(game, job.minutes / 60, "work");
  // The air may have gone while the work was being done, and the clock's own look will have said so.
  if (!game.wreckRun) return { said: notes.join("\n") };
  game.wrecks ??= { done: {}, left: {} };
  game.wrecks.done ??= {};
  game.wrecks.done[w.id] = [...doneOn(game, w), job.id];
  const engineering = skillRank(game, "engineering");
  const cond = engineering >= job.engineering ? "worn" : "broken";
  for (const one of job.gives) {
    if (rigPartById(one.id)) for (let i = 0; i < one.n; i += 1) run.carried.parts.push({ id: one.id, cond });
    else run.carried.items[one.id] = (run.carried.items[one.id] ?? 0) + one.n;
  }
  const parts = job.gives.filter((one) => rigPartById(one.id));
  const lines = [];
  if (!job.gives.length) lines.push(`[SALVAGE] ${job.label}: done, and the way on is open.`);
  else lines.push(`[SALVAGE] ${job.label}: ${givesWords(job.gives, cond)}.${cond === "broken" && parts.length ? ` Engineering ${job.engineering} would have got ${parts.length === 1 && parts[0].n === 1 ? "it" : "them"} out whole.` : ""}`);
  if (parts.length) lines.push(...practice(game, "engineering", 1));
  lines.push(`[SALVAGE] ${wreckAirLeft(game)} minutes of air left.`);
  return { said: [...lines, ...notes].join("\n") };
});

addOrder("wreck-back", (game) => {
  const run = game.wreckRun;
  const w = run ? wreckById(run.at) : null;
  if (!w) throw new Error("You're not out at a wreck.");
  game.wreckRun = null;
  for (const one of run.carried.parts) giveRigPart(game, one.id, { cond: one.cond, from: `Salvaged from ${inSentence(w.name)}.` });
  for (const [id, n] of Object.entries(run.carried.items)) addItem(game, id, n);
  const notes = passTime(game, w.shuttle / 60, "active");
  const parts = run.carried.parts.length;
  return { said: [`[SALVAGE] The shuttle brings you back from ${inSentence(w.name)} with ${carriedWords(run.carried)}.${parts ? ` The parts are with your rig's spare parts, on the Rig page.` : ""}${strippedBare(game, w) ? ` There's nothing left on ${inSentence(w.name)} worth the air.` : ""}`, ...notes].join("\n") };
});

// The bottle runs down with the clock, whatever the player's doing; and a run ends if they're somewhere else.
addClockWork((game) => {
  const run = game.wreckRun;
  if (!run) return [];
  const w = wreckById(run.at);
  if (!w || game.location !== w.at) {
    if (w) leaveByTheAirlock(game, w, run.carried);
    game.wreckRun = null;
    return [];
  }
  return wreckAirLeft(game) <= 0 ? outOfAir(game) : [];
});
