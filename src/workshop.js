// The workshop (health step 7). Synthetic people are mended by the techs with parts crates, not by the nurses with
// medicine: at a place whose health file names a workshop, whoever mends (posts and jobs, there by their day) mends each
// of a synthetic's wounds in turn, the worst first, as the file's Mending part says (the parts crates it takes and how
// long, quicker the better their Engineering). A synthetic who can't get up is carried there instead of the medbay, and
// one who's hurt and on their feet comes in during the morning queue's hours. The same hands build artificial limbs: for
// anyone who's lost an arm or a leg and had the stump seen to, the file's artificial arm or leg line, built from parts
// crates in the workshop, is then fitted by the medbay (src/medbay.js), and works nearly as well. Nothing comes from
// nothing: every crate is one of the stores' own.
//
// game.workshop[place] = { at, jobs: { [id]: { kind: "mend"|"build", key, by, part, wound, at, crates, since, until } },
// ready: { [key]: { part, at } }, log, short }. Reading any of it writes nothing.

import { hurtAt, keyAt, limbOf, limbsWanted, mendedByTechs, nameOfKey, queueOf, treatWound, waitingMending, woundsNow } from "./body.js";
import { findCharacter } from "./campaign.js";
import { calledBy, holderKey, jobByWords, lostReason, onJob, postByWords, speedOf } from "./command.js";
import { isAbout } from "./life.js";
import { logisticsOf, putAboard, takeAboard, countAboard } from "./logistics.js";
import { downAt, isDown } from "./medbay.js";
import { doorLocked, roomPowered } from "./systems.js";
import { mapFor, roomsOf } from "./walk.js";
import { WORLD_HEALTH, WORLD_LIFE } from "./world.js";
import { MEDBAY_KEYS, readMendingLine } from "../public/health-text.js";

const YOU = "you";
const lower = (text) => String(text ?? "").trim().toLowerCase();
const nowOf = (game) => game.clock?.hours ?? 0;
// A walk's worth of time, as the medbay has it.
const WALK_HOURS = 0.25;
const PART_WORDS = { right_arm: "right arm", left_arm: "left arm", right_leg: "right leg", left_leg: "left leg" };

// ---- The workshop, from the place's health file --------------------------------------------------------

const shops = new Map();
export const clearWorkshops = () => shops.clear();

// A place's workshop: its room, who mends there (posts and jobs), the stores its parts crates come from, what it mends
// and how, and its recipes for an artificial arm and leg. Null for a place without one.
export function workshopOf(place) {
  if (shops.has(place)) return shops.get(place);
  const file = WORLD_HEALTH[place];
  let found = null;
  if (file?.workshop) {
    const map = mapFor(place);
    const want = lower(file.workshop);
    const room = map ? roomsOf(map).find((one) => one.id === want || lower(one.name) === want || lower(one.name) === `the ${want}`) : null;
    const menders = (file.menders ? MEDBAY_KEYS["who mends"].read(file.menders).who ?? [] : []).map((words) => {
      const post = postByWords(place, words.replace(/^(a|an|the) /i, ""));
      if (post) return { post };
      const job = jobByWords(place, words);
      return job ? { job } : null;
    }).filter(Boolean);
    const names = file.partsFrom ? MEDBAY_KEYS["parts from"].read(file.partsFrom).from ?? [] : [];
    const model = logisticsOf(place);
    const stores = names.map((name) => model?.stores.find((one) => lower(one.name) === name.replace(/^the /, "") || lower(one.name) === name)?.id).filter(Boolean);
    const lines = (file.mending ?? []).map((raw) => readMendingLine(raw.text)).filter((one) => !one.problem);
    found = {
      room: room?.id ?? null,
      roomName: room?.name ?? file.workshop,
      menders,
      stores,
      mending: lines.filter((one) => !/^artificial (arm|leg)$/.test(one.name)),
      recipes: Object.fromEntries(lines.filter((one) => /^artificial (arm|leg)$/.test(one.name)).map((one) => [one.name.split(" ")[1], one])),
    };
  }
  shops.set(place, found);
  return found;
}

// What's wrong with a place's workshop lines, for npm run check-story.
export function workshopProblems(isWound) {
  const out = [];
  for (const [place, file] of Object.entries(WORLD_HEALTH)) {
    if (!file.workshop && !file.mending?.length) continue;
    const where = `health/${place}.txt`;
    const shop = workshopOf(place);
    if (!shop?.room) {
      out.push(`${where}: the workshop is ${file.workshop ?? "missing"}, which isn't a room at ${place}`);
      continue;
    }
    for (const words of file.menders ? MEDBAY_KEYS["who mends"].read(file.menders).who ?? [] : []) if (!postByWords(place, words.replace(/^(a|an|the) /i, "")) && !jobByWords(place, words)) out.push(`${where}: who mends names ${words}, which isn't a post or a job in world/command/${place}.txt`);
    const names = file.partsFrom ? MEDBAY_KEYS["parts from"].read(file.partsFrom).from ?? [] : [];
    if (names.length !== shop.stores.length) out.push(`${where}: parts from should name stores in world/logistics/${place}.txt, and ${names.join(", ")} aren't all of them`);
    for (const raw of file.mending ?? []) {
      const line = readMendingLine(raw.text);
      if (line.problem) out.push(`${where} (line ${raw.line}): ${line.problem}`);
      else if (!/^artificial (arm|leg)$/.test(line.name) && !isWound(line.name)) out.push(`${where} (line ${raw.line}): ${line.name} isn't one of the wounds in world/health/wounds.txt, nor an artificial arm or leg`);
    }
  }
  return out;
}

// ---- Who's there, and who mends -----------------------------------------------------------------------------

const stateFor = (game, place) => ((game.workshop ??= {})[place] ??= { at: null, jobs: {}, ready: {}, log: [] });
// The key someone's day knows them by, from their body key, at a place.
function whoOf(place, key) {
  if (key === YOU) return YOU;
  if (key.startsWith("id:")) return key.slice(3);
  const name = key.split(":").slice(2).join(":");
  for (const group of WORLD_LIFE[place]?.crowd ?? []) for (const [one] of group.names) if (lower(one) === name) return one;
  return name;
}
const nameOf = (game, place, key) => {
  if (key === YOU) return "you";
  const who = whoOf(place, key);
  const person = findCharacter(game.campaign, who);
  return person && !person.crowd ? person.name : key.startsWith("id:") ? who : nameOfKey(game, key);
};
const whose = (game, place, key) => (key === YOU ? "your" : `${nameOf(game, place, key)}'s`);
const menderName = (game, place, key) => {
  const name = calledBy(game, place, key);
  return name.charAt(0).toUpperCase() + name.slice(1);
};
// Whether the player's standing in a place's workshop.
function playerIn(game, place, shop) {
  const walk = game.walk;
  return game.location === place && Boolean(walk) && !walk.room && mapFor(place)?.levels[walk.level]?.roomAt(walk.x, walk.y) === shop.room;
}
// The synthetics waiting to be mended at a moment: whoever was carried in, whoever's hurt and on their feet in the
// morning queue's hours (from a walk's worth of time after it opens or after they were hurt, by the clock alone, and
// nobody while the workshop's door is locked), and the player standing there.
function patientsAt(game, place, shop, hours) {
  const keys = downAt(game, place).filter(([key, d]) => d.bed === `@${shop.room}` && !d.going && !d.dead && mendedByTechs(game, key)).map(([key]) => key);
  const queue = queueOf(place);
  if (queue && !doorLocked(game, place, shop.room)) {
    const minute = (((hours % 24) + 24) % 24) * 60;
    const opens = Math.floor(hours / 24) * 24 + queue.from / 60;
    if (minute >= queue.from && minute < queue.to) {
      for (const who of hurtAt(game, place)) {
        const key = keyAt(place, who);
        if (!key || game.down?.[key] || !mendedByTechs(game, key) || !isAbout(game, place, who, hours)) continue;
        if (hours >= Math.max(opens, ...woundsNow(game, key).map((wound) => wound.at)) + WALK_HOURS) keys.push(key);
      }
    }
  }
  if (playerIn(game, place, shop) && mendedByTechs(game, YOU)) keys.push(YOU);
  return keys;
}
// Whoever mends who's free at a moment: awake and about, not out on a call or at another job here, not down and at their
// post. Whoever takes a job walks to the workshop for it, and the work starts once they're there.
function mendersFree(game, place, shop, hours, state) {
  const busy = new Set([...Object.values(game.down ?? {}).map((d) => d.call?.by), ...Object.values(state.jobs).map((job) => job.by)].filter(Boolean));
  const keys = shop.menders.flatMap((one) => (one.post ? [holderKey(game, place, one.post)] : onJob(game, place, one.job)));
  return [...new Set(keys)].filter((key) => key && key !== YOU && !busy.has(key) && !isDown(game, place, key) && !lostReason(game, place, key) && isAbout(game, place, key, hours));
}
// Everyone at a place who's lost a limb, had it seen to and has nothing fitted: by body key, with the parts wanted.
function wantingLimbs(game, place) {
  const keys = new Set(Object.keys(game.bodies ?? {}).filter((key) => key.startsWith(`crowd:${place}:`) || (key.startsWith("id:") && WORLD_LIFE[place]?.people?.[key.slice(3)])));
  if (game.location === place) keys.add(YOU);
  return [...keys].flatMap((key) => (game.dead?.[key] ? [] : limbsWanted(game, key).map((part) => ({ key, part }))));
}
// Parts crates from the workshop's stores: all of them, or none.
function takeCrates(game, place, shop, n) {
  if (!n) return true;
  const got = takeAboard(game, place, "parts_crate", n, shop.stores);
  if (got >= n) return true;
  if (got) putAboard(game, place, "parts_crate", got, shop.stores);
  return false;
}
const woundOf = (game, key, job) => (key === YOU ? game.wounds : game.bodies?.[key]?.wounds)?.find((wound) => wound.part === job.part && wound.kind === job.wound && wound.at === job.at && !wound.dressed) ?? null;

// ---- The clock --------------------------------------------------------------------------------------------

// The workshop over the time since it was last run, step by step: a job whose time is up is done; a free mender starts
// on the worst-off synthetic still waiting, then on a limb someone's waiting for, with the crates it takes, faster the
// better their Engineering. Nothing starts while the workshop has no power. Lines for the story while the player's there.
export function advanceWorkshop(game, place, now = nowOf(game)) {
  const notes = [];
  const shop = workshopOf(place);
  if (!shop?.room) return notes;
  const state = stateFor(game, place);
  const from = state.at === null ? now : Math.min(state.at, now);
  let t = from;
  const watching = () => place === game.location && playerIn(game, place, shop);
  // The player who walks out in the middle of being mended isn't mended, and the crates go back.
  const mine = state.jobs[`mend:${YOU}`];
  if (mine && !playerIn(game, place, shop)) {
    if (mine.crates) putAboard(game, place, "parts_crate", mine.crates, shop.stores);
    delete state.jobs[`mend:${YOU}`];
  }
  for (let step = 0; step < 400; step += 1) {
    for (const [id, job] of Object.entries(state.jobs)) {
      if (job.until > t) continue;
      delete state.jobs[id];
      if (job.kind === "mend") {
        const wound = woundOf(game, job.key, job);
        if (!wound || game.dead?.[job.key]) {
          if (job.crates) putAboard(game, place, "parts_crate", job.crates, shop.stores);
          continue;
        }
        treatWound(game, job.key, wound, job.until);
        const line = `${menderName(game, place, job.by)} mends ${whose(game, place, job.key)} ${wound.words.replace(/^(an?|the) /, "")}`;
        state.log = [...(state.log ?? []), { day: Math.floor(job.until / 24), line }].slice(-8);
        if (watching() || job.key === YOU) notes.push(`[HEALTH] ${line}.`);
      } else {
        state.ready = { ...(state.ready ?? {}), [job.key]: { part: job.part, at: job.until } };
        const line = `${menderName(game, place, job.by)} finishes an artificial ${PART_WORDS[job.part]} for ${nameOf(game, place, job.key)}`;
        state.log = [...(state.log ?? []), { day: Math.floor(job.until / 24), line }].slice(-8);
        if (watching()) notes.push(`[HEALTH] ${line}. It goes to the medbay to be fitted.`);
      }
    }
    const dark = !roomPowered(game, place, shop.room);
    const free = dark ? [] : mendersFree(game, place, shop, t, state);
    // Synthetics first, the worst off first.
    const waiting = patientsAt(game, place, shop, t).filter((key) => !state.jobs[`mend:${key}`] && waitingMending(game, key, shop.mending).length);
    for (const key of waiting) {
      if (!free.length) break;
      const wound = waitingMending(game, key, shop.mending)[0];
      const how = shop.mending.find((one) => one.name === wound.kind.replace(/_/g, " "));
      if (!how) continue;
      if (!takeCrates(game, place, shop, how.crates)) {
        if (!state.short && watching()) notes.push(`[HEALTH] There aren't the parts crates for it: nobody can be mended until some are brought.`);
        state.short = true;
        break;
      }
      state.short = false;
      const by = free.shift();
      const minutes = how.minutes / speedOf(game, place, [by], "engineering");
      state.jobs[`mend:${key}`] = { kind: "mend", key, by, part: wound.part, wound: wound.kind, at: wound.at, crates: how.crates, since: t, until: t + WALK_HOURS + minutes / 60 };
      if (key === YOU) notes.push(`[HEALTH] ${menderName(game, place, by)} sets to work on your ${wound.words.replace(/^(an?|the) /, "")}.`);
    }
    // Then the limbs someone's waiting for, oldest loss first.
    for (const { key, part } of wantingLimbs(game, place)) {
      if (!free.length) break;
      const recipe = shop.recipes[limbOf(part)];
      if (!recipe || state.jobs[`build:${key}:${part}`] || state.ready?.[key]) continue;
      if (!takeCrates(game, place, shop, recipe.crates)) {
        state.short = true;
        break;
      }
      const by = free.shift();
      const minutes = recipe.minutes / speedOf(game, place, [by], "engineering");
      state.jobs[`build:${key}:${part}`] = { kind: "build", key, by, part, crates: recipe.crates, since: t, until: t + WALK_HOURS + minutes / 60 };
    }
    const next = Math.min(Infinity, ...Object.values(state.jobs).map((job) => job.until));
    if (next > now) break;
    t = Math.max(t, next);
  }
  state.at = now;
  return notes;
}

// Turns the menders' days aside while they're at a job: to the workshop, saying what they're doing. Null when nobody is.
export function workshopDetour(game, place) {
  const shop = workshopOf(place);
  const jobs = Object.values(game.workshop?.[place]?.jobs ?? {});
  if (!shop?.room || !jobs.length) return null;
  const at = new Map(jobs.map((job) => [job.by, job]));
  const room = shop.roomName.replace(/^The /, "the ");
  return (who) => {
    const job = at.get(who);
    if (!job) return null;
    return { where: `@${shop.room}`, doing: job.kind === "mend" ? `mending ${whose(game, place, job.key)} ${job.wound.replace(/_/g, " ")} in ${room}` : `building an artificial ${PART_WORDS[job.part]} in ${room}` };
  };
}

// An artificial limb ready for someone, for the medbay to fit: its part, or null.
export const limbReady = (game, place, key) => game.workshop?.[place]?.ready?.[key]?.part ?? null;
// The medbay has fitted it.
export function limbFitted(game, place, key) {
  const state = game.workshop?.[place];
  if (state?.ready?.[key]) {
    const { [key]: _gone, ...rest } = state.ready;
    state.ready = rest;
  }
}
// Whether someone down is the workshop's to see to, and where they're carried: its room, or null.
export const workshopBedFor = (game, place, key) => (mendedByTechs(game, key) && workshopOf(place)?.room ? `@${workshopOf(place).room}` : null);
// Whether someone on the workshop's bench still waits for mending.
export const waitsInWorkshop = (game, place, key) => {
  const shop = workshopOf(place);
  return Boolean(shop) && waitingMending(game, key, shop.mending).length > 0;
};

// ---- The Ship menu ----------------------------------------------------------------------------------------

// Who's being mended or waiting, the limbs being built and ready, the crates aboard, and the last of what was done. Null
// at a place without a workshop. Reading it writes nothing.
export function workshopView(game, place) {
  const shop = workshopOf(place);
  if (!shop?.room) return null;
  const state = game.workshop?.[place] ?? { jobs: {}, ready: {}, log: [] };
  const now = nowOf(game);
  const left = (job) => {
    const minutes = Math.max(1, Math.round((job.until - now) * 60));
    return minutes >= 90 ? `${Math.round(minutes / 60)} hours left` : `${minutes} minutes left`;
  };
  const jobs = Object.values(state.jobs ?? {}).map((job) => (job.kind === "mend"
    ? `${menderName(game, place, job.by)} is mending ${whose(game, place, job.key)} ${job.wound.replace(/_/g, " ")}, ${left(job)}`
    : `${menderName(game, place, job.by)} is building an artificial ${PART_WORDS[job.part]} for ${nameOf(game, place, job.key)}, ${left(job)}`));
  const waiting = wantingLimbs(game, place).filter(({ key, part }) => !state.jobs?.[`build:${key}:${part}`] && !state.ready?.[key]).map(({ key, part }) => `${nameOf(game, place, key)} is waiting for an artificial ${PART_WORDS[part]}`);
  const ready = Object.entries(state.ready ?? {}).map(([key, one]) => `An artificial ${PART_WORDS[one.part]} for ${nameOf(game, place, key)} is ready to be fitted in the medbay`);
  return {
    room: shop.roomName,
    lines: [...jobs, ...waiting, ...ready],
    crates: countAboard(game, place, ["parts_crate"])?.n ?? 0,
    short: Boolean(state.short),
    log: (state.log ?? []).map((one) => `Day ${one.day + 1}: ${one.line}`).reverse(),
  };
}
