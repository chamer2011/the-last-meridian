// A place's chain of command: its posts, who holds each one, who chose them, and since when. It's written in
// world/command/<place>.txt (read by public/command-text.js), compiled here against the place's rooms and people, and
// kept in the save as game.command[place] once a game begins. Everything that names someone for a post (the council's
// decisions, the systems' engineers and guards, the errands, the captain's chair) asks here who holds it. The officers
// review their people every so often, warn and relieve whoever's done badly, and fill the posts left empty; people
// remember what was done to them, and the ambitious ask for their boss's post. Nothing here calls an AI, and reading
// it changes nothing.

import { SKILLS } from "./character-data.js";
import { LOCATIONS } from "./data.js";
import { isHurt } from "./deeds.js";
import { aboardShip, isCaptain, startOf } from "./role.js";
import { waitingForParts } from "./systems.js";
import { atPost, mapFor, roomsOf, seedFrom } from "./walk.js";
import { COMMAND_FILE_PROBLEMS, ROOM_TALK, WORLD_CHARACTERS, WORLD_COMMAND, WORLD_LIFE } from "./world.js";
import { BODIES, SPARE, THE_CHAIR, readHolderLine, readJobLine, readPostLine, readWorkersLine, slugOf } from "../public/command-text.js";

// The player, when they hold a post.
export const YOU = "you";

const plain = (words) => String(words ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const upperFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const lowerFirst = (text) => (text ? text[0].toLowerCase() + text.slice(1) : text);
const SMALL_WORDS = new Set(["of", "the", "and"]);
const titleCase = (words) => String(words).split(" ").map((word, i) => (i && SMALL_WORDS.has(word) ? word : upperFirst(word))).join(" ");
const listWords = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0] ?? "");
// "a cook", "an ensign".
const aJob = (title) => `${/^[aeiou]/i.test(title) ? "an" : "a"} ${title}`;
const plural = (words) => (/s$/.test(words) ? words : `${words}s`);

// ---- What a post's duty is measured by ----------------------------------------------------------

// Each one a day's score out of 100, from what the game already counts, read at midnight for the day that's ended.
// c is what's known about that day: the ship, the day's tally, and the watch bill, the sittings and the repairs.
const outOf = (c, ids) => ids.filter((id) => (c.ship.out?.[id] ?? 0) > 0).length;
export const DUTY_MEASURES = {
  "morale": (c) => c.ship.morale,
  "shortages": (c) => 100 - 25 * outOf(c, ["food", "fuel", "medicine", "parts"]),
  "deaths aboard": (c) => 100 - 5 * c.tally.deaths,
  "stations staffed": (c) => c.staffed,
  "sittings missed": (c) => c.sittings,
  "stores run dry": (c) => 100 - 34 * outOf(c, ["food", "medicine", "parts"]),
  "power short": (c) => 100 - c.tally.powerShort / 7.2,
  "repairs waiting": (c) => 100 - 30 * c.waitingParts,
  "hull worn": (c) => (100 * c.ship.hull) / (c.ship.maxHull || 100),
  "alarms": (c) => 100 - 30 * c.tally.alarms,
  "tampering seen": (c) => 100 - 30 * c.tally.tampering,
  "thefts": (c) => 100 - 25 * c.tally.thefts,
  "medicine out": (c) => (c.ship.out?.medicine ? 0 : 100),
  "errands left waiting": (c) => 100 - c.tally.errandsWaiting / 6,
};
// Words a post's duty may carry that a later step measures.
export const DUTY_LATER = ["the council's confidence"];

// The numbers a person has for the chain of command, and what they go between: ambition and temper from 1 to 5, and
// loyalty to the captain to begin with from 0 to 100. EVERYONE is what someone has without them in their file, unless
// the command file's everyone else says otherwise.
export const NATURE = { ambition: [1, 5], temper: [1, 5], loyalty: [0, 100] };
const EVERYONE = { ambition: 2, temper: 2, loyalty: 60 };

// ---- The file, compiled -------------------------------------------------------------------------

const models = new Map();

// Read again after the file changes.
export function clearCommand() {
  models.clear();
  speeds.clear();
  labels.clear();
}

export function commandOf(place) {
  if (!WORLD_COMMAND[place]) return null;
  if (!models.has(place)) models.set(place, compileCommand(place));
  return models.get(place);
}

// Everyone who could hold a post at a place: the people with days there, by their id, and the crowd, by name.
function peopleOf(place) {
  const life = WORLD_LIFE[place] ?? {};
  return [
    ...Object.keys(life.people ?? {}).map((id) => ({ key: id, id })),
    ...(life.crowd ?? []).flatMap((group) => group.names.map(([name]) => ({ key: name, id: null }))),
  ];
}

// "odessa", "Brandt", "Odessa Brandt" or "Tech Sami": the key the life engine knows them by.
function findHolder(place, words) {
  const want = plain(words);
  const people = peopleOf(place);
  const byKey = people.find((one) => plain(one.key) === want);
  if (byKey) return byKey.key;
  const named = people.find((one) => {
    const file = one.id ? WORLD_CHARACTERS[one.id] : null;
    return file && (plain(file.name) === want || plain(file.name).split(" ").includes(want) || (file.aliases ?? []).some((alias) => plain(alias) === want));
  });
  return named?.key ?? null;
}

const skillIds = () => Object.keys(SKILLS);
const skillOf = (words) => {
  const id = plain(words).replace(/ /g, "_");
  return skillIds().includes(id) ? id : null;
};

function compileCommand(place) {
  const file = WORLD_COMMAND[place];
  const map = mapFor(place);
  const name = LOCATIONS[place]?.name ?? file.name ?? place;
  const problems = [];
  const at = (line, message) => problems.push({ line: line ?? null, message });
  const rooms = map ? roomsOf(map) : [];
  const findRoom = (want) => {
    const key = plain(want).replace(/^the /, "");
    return rooms.find((room) => [room.name, room.id, ...(room.aliases ?? [])].some((words) => plain(words).replace(/^the /, "") === key)) ?? null;
  };
  const readSkills = (words, line, what) => words.map((one) => {
    const id = skillOf(one);
    if (!id) at(line, `there's no skill called ${one}, for ${what}: the skills are ${skillIds().join(", ").replace(/_/g, " ")}`);
    return id;
  }).filter(Boolean);
  const model = { place, name, file, posts: [], jobs: [], start: {}, chairPost: null, problems };

  // The jobs first, so that a post can say which ones it heads.
  for (const raw of file.jobs ?? []) {
    const job = readJobLine(raw.text);
    if (job.problem) {
      at(raw.line, job.problem);
      continue;
    }
    const room = findRoom(job.room);
    if (!room) {
      at(raw.line, `${name} has no room called ${job.room}, for the ${job.title} job`);
      continue;
    }
    const id = slugOf(job.title);
    if (model.jobs.some((one) => one.id === id)) {
      at(raw.line, `the ${job.title} job is written twice`);
      continue;
    }
    model.jobs.push({ id, title: job.title, room: room.id, roomName: room.name, wanted: job.wanted, skills: readSkills(job.skills, raw.line, `the ${job.title} job`), line: raw.line });
  }
  const jobByWords = (words) => {
    const want = plain(words).replace(/s$/, "");
    return model.jobs.find((job) => plain(job.title).replace(/s$/, "") === want) ?? null;
  };

  for (const raw of file.posts ?? []) {
    const post = readPostLine(raw.text);
    if (post.problem) {
      at(raw.line, post.problem);
      continue;
    }
    const room = findRoom(post.room);
    if (!room) {
      at(raw.line, `${name} has no room called ${post.room}, for the ${post.title}`);
      continue;
    }
    const id = slugOf(post.title);
    if (model.posts.some((one) => one.id === id)) {
      at(raw.line, `the ${post.title} is written twice`);
      continue;
    }
    const heads = post.heads.map((words) => {
      const job = jobByWords(words);
      if (!job) at(raw.line, `there's no job called ${words} under Jobs, for the ${post.title} to head`);
      return job?.id ?? null;
    }).filter(Boolean);
    const measures = post.duty.filter((words) => {
      if (DUTY_MEASURES[words.toLowerCase()]) return true;
      if (!DUTY_LATER.includes(words.toLowerCase())) at(raw.line, `${words} isn't something a post's duty can be measured by: the measures are ${Object.keys(DUTY_MEASURES).join(", ")}`);
      return false;
    }).map((words) => words.toLowerCase());
    model.posts.push({ id, title: post.title, room: room.id, roomName: room.name, chosenBy: post.chosenBy, watchBill: post.watchBill, heads, poolWords: post.pool, skills: readSkills(post.skills, raw.line, `the ${post.title}`), duty: post.duty, measures, line: raw.line });
  }

  // Who chooses whoever holds each post: another post, or the council, or the civilians. Nobody chooses themselves.
  for (const post of model.posts) {
    if (BODIES.includes(post.chosenBy)) {
      post.chooser = { body: post.chosenBy };
      continue;
    }
    const chooser = model.posts.find((one) => one.title === post.chosenBy || one.id === slugOf(post.chosenBy));
    if (!chooser || chooser === post) {
      at(post.line, `the ${post.title} is chosen by ${post.chosenBy}, which isn't another post here, the council or the civilians`);
      post.chooser = { body: "council" };
    } else post.chooser = { post: chooser.id };
  }
  for (const post of model.posts) {
    const seen = new Set([post.id]);
    for (let next = post.chooser.post; next; next = model.posts.find((one) => one.id === next)?.chooser?.post) {
      if (!seen.has(next)) {
        seen.add(next);
        continue;
      }
      at(post.line, `the ${post.title}'s choosing goes round in a circle: someone has to be chosen by the council or the civilians`);
      post.chooser = { body: "council" };
      break;
    }
  }

  // Who holds each post when a game begins: someone with a day at the place, one post each, or the chair.
  for (const raw of file.holders ?? []) {
    const held = readHolderLine(raw.text);
    if (held.problem) {
      at(raw.line, held.problem);
      continue;
    }
    const post = model.posts.find((one) => one.title === held.post || one.id === slugOf(held.post));
    if (!post) {
      at(raw.line, `there's no post called ${held.post} under Posts`);
      continue;
    }
    if (model.start[post.id]) {
      at(raw.line, `the ${post.title} is given twice`);
      continue;
    }
    if (plain(held.holder) === THE_CHAIR) {
      if (model.chairPost) {
        at(raw.line, `only one post can be the chair, and the ${postTitle(model, model.chairPost)} already is`);
        continue;
      }
      model.chairPost = post.id;
      model.start[post.id] = { chair: true };
      continue;
    }
    const key = findHolder(place, held.holder);
    if (!key) {
      at(raw.line, `nobody called ${held.holder} has a day at ${name} in world/life, to hold the ${post.title}`);
      continue;
    }
    const already = Object.entries(model.start).find(([, one]) => one.key === key);
    if (already) {
      at(raw.line, `${held.holder} already holds the ${postTitle(model, already[0])}: one post each`);
      continue;
    }
    model.start[post.id] = { key };
  }
  for (const post of model.posts) if (!model.start[post.id]) at(post.line, `nobody holds the ${post.title}: give it someone under Who holds what`);

  // Who a new holder of each post is picked from: the jobs and posts its line names, or else the jobs it heads. Never
  // the post itself, nor the chair.
  for (const post of model.posts) {
    post.pool = { jobs: post.poolWords.length ? [] : [...post.heads], posts: [] };
    for (const words of post.poolWords) {
      const want = words.replace(/^the\s+/, "");
      const other = model.posts.find((one) => one.title === want || one.id === slugOf(want));
      const job = other ? null : jobByWords(want);
      if (other === post) at(post.line, `the ${post.title} can't be picked from itself`);
      else if (other && other.id === model.chairPost) at(post.line, `the ${post.title} can't be picked from the ${other.title}, who's in the chair`);
      else if (other) post.pool.posts.push(other.id);
      else if (job) post.pool.jobs.push(job.id);
      else at(post.line, `there's no job or post called ${words}, for the ${post.title} to be picked from`);
    }
  }

  // The reviews' rules, everyone else's ambition, temper and loyalty, and the numbers in the files of whoever could
  // hold a post here.
  model.reviews = readReviews(file.numbers ?? {}, (message) => at(null, message));
  model.crew = readEveryone(file.numbers?.crew, (message) => at(null, message));
  for (const one of peopleOf(place)) {
    const person = one.id ? WORLD_CHARACTERS[one.id] : null;
    for (const [what, [lo, hi]] of Object.entries(NATURE)) {
      const n = person?.[what];
      if (n !== undefined && n !== null && (typeof n !== "number" || n < lo || n > hi)) at(null, `${person.name}'s ${what}, in world/characters/${one.id}.txt, goes from ${lo} to ${hi}, not ${n}`);
    }
  }

  // Who does each job when a game begins, and the spare hands the first officer can put to work. Someone who holds a
  // post isn't on the watch bill.
  model.startJob = {};
  const officers = new Set(Object.values(model.start).map((one) => one.key).filter(Boolean));
  for (const raw of file.workers ?? []) {
    const workers = readWorkersLine(raw.text);
    if (workers.problem) {
      at(raw.line, workers.problem);
      continue;
    }
    const spare = workers.job === SPARE;
    const job = spare ? null : jobByWordsIn(model, workers.job);
    if (!spare && !job) {
      at(raw.line, `there's no job called ${workers.job} under Jobs`);
      continue;
    }
    for (const words of workers.people) {
      const key = findHolder(place, words);
      if (!key) at(raw.line, `nobody called ${words} has a day at ${name} in world/life, to be ${spare ? "a spare hand" : aJob(job.title)}`);
      else if (officers.has(key)) at(raw.line, `${words} holds a post, so they aren't on the watch bill`);
      else if (key in model.startJob) at(raw.line, `${words} is given two jobs`);
      else model.startJob[key] = spare ? null : job.id;
    }
  }
  // Each job's day: the day in world/life of the first person who starts in it, or a plain one at its room.
  for (const job of model.jobs) {
    job.first = Object.keys(model.startJob).find((key) => model.startJob[key] === job.id) ?? null;
    job.day = (job.first && dayInFile(place, job.first)) || plainDay(job);
  }
  const firstSpare = Object.keys(model.startJob).find((key) => model.startJob[key] === null);
  model.spareDay = firstSpare ? dayInFile(place, firstSpare) : null;
  return model;
}

// Someone's day as world/life writes it: their own, or their crowd's.
function dayInFile(place, key) {
  const life = WORLD_LIFE[place] ?? {};
  if (life.people?.[key]) return life.people[key];
  return (life.crowd ?? []).find((group) => group.names.some(([name]) => name === key))?.day ?? null;
}

// A day for a job nobody starts in: on duty at its room, two meals at the benches, and a bunk at night.
const plainDay = (job) => [
  { at: "06:00", doing: `on duty in ${lowerFirst(job.roomName)}`, go: `@${job.room}` },
  { at: "12:30", doing: "eating", go: "benches" },
  { at: "13:10", doing: `on duty in ${lowerFirst(job.roomName)}`, go: `@${job.room}` },
  { at: "18:30", doing: "eating", go: "benches" },
  { at: "19:10", doing: "off duty" },
  { at: "22:00", doing: "asleep", go: "racks", asleep: true },
];

// "cooks", "a cook" or "the techs", among a compiled place's jobs.
function jobByWordsIn(model, words) {
  const want = plain(words).replace(/^(a|an|the) /, "").replace(/s$/, "");
  return model.jobs.find((job) => plain(job.title).replace(/s$/, "") === want) ?? null;
}

const postTitle = (model, id) => model.posts.find((one) => one.id === id)?.title ?? id;

// Everything wrong with the files, for npm run check-story.
export function commandProblems() {
  const out = [...COMMAND_FILE_PROBLEMS];
  for (const place of Object.keys(WORLD_COMMAND)) {
    const model = commandOf(place);
    for (const one of model?.problems ?? []) out.push(`command/${place}.txt${one.line ? ` (line ${one.line})` : ""}: ${one.message}`);
  }
  return out;
}

// ---- Naming a post from elsewhere ---------------------------------------------------------------

// "the quartermaster" or "chief engineer", in a place's other files, to the post's id. It reads the file's own words,
// so the systems and the logistics can name a post while they're being put together, before this is compiled.
export function postByWords(place, words) {
  const file = WORLD_COMMAND[place];
  if (!file) return null;
  const want = slugOf(words);
  for (const raw of file.posts ?? []) {
    const post = readPostLine(raw.text);
    if (!post.problem && slugOf(post.title) === want) return want;
  }
  return null;
}

// "a cook", "the techs" or "cooks" in a place's other files, to the job's id, from the file's own words in the same way.
export function jobByWords(place, words) {
  const file = WORLD_COMMAND[place];
  if (!file) return null;
  const want = plain(words).replace(/^(a|an|the) /, "").replace(/s$/, "");
  for (const raw of file.jobs ?? []) {
    const job = readJobLine(raw.text);
    if (!job.problem && plain(job.title).replace(/s$/, "") === want) return slugOf(job.title);
  }
  return null;
}

export const postById = (place, id) => commandOf(place)?.posts.find((one) => one.id === id) ?? null;
export const jobById = (place, id) => commandOf(place)?.jobs.find((one) => one.id === id) ?? null;
export const postWords = (place, id) => (postById(place, id) ? `the ${postById(place, id).title}` : id);

// ---- Who holds what, in a game -----------------------------------------------------------------

const stateOf = (game, place) => game.command?.[place] ?? null;
const chairHolder = (game) => (isCaptain(game) ? YOU : game.ship?.chair?.id ?? null);

// Who holds a post now: their key, "you" for the player, or null if nobody does. The chair is the player while
// they're the captain, and whoever was given it otherwise. A game from before there was a chain of command reads the
// file's holders.
export function holderKey(game, place, postId) {
  const model = commandOf(place);
  if (!model) return null;
  if (model.chairPost === postId) return chairHolder(game);
  const state = stateOf(game, place);
  if (state) return state.holders?.[postId]?.key ?? null;
  return model.start[postId]?.key ?? null;
}

// The post someone holds at a place, or null.
export function postOf(game, place, key) {
  const model = commandOf(place);
  return model?.posts.find((post) => holderKey(game, place, post.id) === key)?.id ?? null;
}

// What a person is called in full: "Odessa Brandt", "Tech Sami", or the player's own name.
export function personCalled(game, key) {
  if (key === YOU) return game.name;
  return WORLD_CHARACTERS[key]?.name ?? key;
}
// What someone's called for short: the name the map shows beside them at their post ("Brandt", "Pell", "Hask"), or
// the last word of their name ("Imre", for Cook Imre). Remembered, since the maps don't change while it's asked.
const labels = new Map();
function labelOf(key) {
  if (!labels.has(key)) {
    let label = null;
    for (const place of Object.keys(WORLD_COMMAND)) {
      const home = Object.values(mapFor(place)?.levels ?? {}).flatMap((level) => level.homes ?? []).find((one) => one.id === key);
      if (home?.label) {
        label = home.label;
        break;
      }
    }
    labels.set(key, label);
  }
  return labels.get(key);
}
const shortName = (game, key) => (key !== YOU && WORLD_CHARACTERS[key] && labelOf(key)) || String(personCalled(game, key)).split(" ").at(-1);

// "Quartermaster Brandt", for what the ship says. Null when nobody holds the post.
export function postAndName(game, place, postId) {
  const post = postById(place, postId);
  const key = holderKey(game, place, postId);
  if (!post || !key) return null;
  return key === YOU ? "You" : `${titleCase(post.title)} ${shortName(game, key)}`;
}

// Whether someone's still with the ship: the story's people are, until their contact says otherwise, and so are the
// crowd, whom nothing kills yet.
export function stillAlive(game, key) {
  if (!key) return false;
  if (key === YOU) return true;
  const person = WORLD_CHARACTERS[key];
  if (!person) return true;
  const status = game.contacts?.find((contact) => contact.name.toLowerCase() === person.name.toLowerCase())?.status;
  return !status || status === "alive";
}

// The holders a new game starts with: the file's, with the player or the chair's captain in the chair; and the watch
// bill, with the player on it if they're crew aboard.
function freshState(game, model) {
  const holders = {};
  for (const post of model.posts) {
    const start = model.start[post.id];
    const key = start?.chair ? chairHolder(game) : start?.key;
    if (key) holders[post.id] = { key, since: null, by: null };
  }
  return { holders, jobs: startJobs(game, model), cover: {}, log: [] };
}
export function newCommandState(game) {
  const state = {};
  for (const place of Object.keys(WORLD_COMMAND)) {
    const model = commandOf(place);
    if (model) state[place] = freshState(game, model);
  }
  return state;
}

// ---- The watch bill ---------------------------------------------------------------------------------

// The player's job when a game begins, if they started as crew aboard: the job done in the room their own work's in.
function playersJob(game, model) {
  if (isCaptain(game)) return undefined;
  const start = startOf(game);
  if (!start?.job || start.place !== model.place) return undefined;
  return model.jobs.find((job) => job.room === start.room)?.id;
}
function startJobs(game, model) {
  const jobs = { ...model.startJob };
  const mine = playersJob(game, model);
  if (mine) jobs[YOU] = mine;
  return jobs;
}

// Who does which job in a game: a job's id, or null for a spare hand. A game from before there was a watch bill reads
// the file's. Reading changes nothing.
export function jobsOf(game, place) {
  const model = commandOf(place);
  if (!model) return {};
  return stateOf(game, place)?.jobs ?? startJobs(game, model);
}
// Someone's job: its id, null for a spare hand, or undefined for someone who isn't on the watch bill.
export const jobOf = (game, place, key) => jobsOf(game, place)[key];
// Everyone doing a job, in the watch bill's order: null for the spare hands.
export const onJob = (game, place, jobId) => Object.entries(jobsOf(game, place)).filter(([, job]) => job === jobId).map(([key]) => key);

// Why someone isn't at their job, or null: dead, being patched up after a beating, or not where their post is.
export function lostReason(game, place, key) {
  if (!key || key === YOU) return null;
  if (!stillAlive(game, key)) return "dead";
  if (isHurt(game, place, key)) return "being patched up";
  if (WORLD_CHARACTERS[key] && !atPost(game, key)) return "away";
  return null;
}

function commandState(game, place) {
  const model = commandOf(place);
  game.command ??= {};
  game.command[place] ??= freshState(game, model);
  const state = game.command[place];
  state.jobs ??= startJobs(game, model);
  state.cover ??= {};
  state.log ??= [];
  return state;
}
const dayNow = (game) => Math.floor((game.clock?.hours ?? 0) / 24) + 1;
function logCommand(state, game, text, day = dayNow(game)) {
  state.log.push({ day, text });
  if (state.log.length > 20) state.log.splice(0, state.log.length - 20);
}
const jobWords = (job) => (job ? aJob(job.title) : "one of the spare hands");

// The days the chain of command changes. Someone in a post the game didn't begin them in takes the day of whoever it
// began with, and goes to that one's own place at the post (home). Someone doing a job other than the one their group
// in world/life does takes that job's day, at their own shift, and someone sent to the spare hands takes theirs; an
// officer relieved of their post and put on the watch bill too. Null when nothing's changed. Remembered for as long as
// the watch bill and the holders are the same ones, since the life engine asks it every five minutes.
const movedKept = new WeakMap();
export function movedDays(game, place) {
  const model = commandOf(place);
  if (!model) return null;
  const jobs = jobsOf(game, place);
  const holders = stateOf(game, place)?.holders ?? null;
  const kept = movedKept.get(jobs);
  if (kept && kept.model === model && kept.holders === holders) return kept.moved;
  let moved = null;
  for (const post of model.posts) {
    if (post.id === model.chairPost) continue;
    const start = model.start[post.id]?.key;
    const key = holderKey(game, place, post.id);
    if (!key || key === YOU || key === start) continue;
    const day = start ? dayInFile(place, start) : null;
    if (day) (moved ??= {})[key] = { job: `post:${post.id}`, day, home: start };
  }
  for (const [key, job] of Object.entries(jobs)) {
    if (key === YOU || moved?.[key] || (key in model.startJob && model.startJob[key] === job)) continue;
    const day = job === null ? model.spareDay : model.jobs.find((one) => one.id === job)?.day;
    if (day) (moved ??= {})[key] = { job, day };
  }
  movedKept.set(jobs, { model, holders, moved });
  return moved;
}

// The work a crew member's shift is when the watch bill has moved them from the job their life began in: the same pay,
// in their new job's room. Null while they're where they started.
export function shiftOnWatchBill(game, start = startOf(game)) {
  const model = start ? commandOf(start.place) : null;
  if (!model || !start?.job) return null;
  const mine = jobOf(game, start.place, YOU);
  if (mine === undefined || mine === playersJob(game, model)) return null;
  if (mine === null) return { name: "Help wherever you're sent", pay: start.job.pay, skill: start.job.skill, done: "You spend a shift doing whatever the first officer needs doing, and nobody says thank you." };
  const job = model.jobs.find((one) => one.id === mine);
  return { name: `Work a shift as ${aJob(job.title)} in ${lowerFirst(job.roomName)}`, pay: start.job.pay, skill: job.skills[0] ?? start.job.skill, done: `You put in a shift as ${aJob(job.title)}, in ${lowerFirst(job.roomName)}.` };
}

// The captain moving someone on the watch bill: to a job, or to the spare hands. Gives the words for what was done.
export function assignJob(game, place, key, jobId, { by = YOU } = {}) {
  const model = commandOf(place);
  if (!model) throw new Error("Nobody here keeps a watch bill.");
  const jobs = jobsOf(game, place);
  if (!(key in jobs) || key === YOU) throw new Error("They aren't on the watch bill.");
  const job = jobId === null || jobId === "spare" ? null : jobById(place, jobId);
  if (jobId !== null && jobId !== "spare" && !job) throw new Error("There's no such job.");
  const to = job?.id ?? null;
  const who = personCalled(game, key);
  if (jobs[key] === to) return `${who} is already ${jobWords(job)}.`;
  const state = commandState(game, place);
  state.jobs = { ...jobs, [key]: to };
  // An order of the captain's own takes the place of any cover the first officer had them on.
  delete state.cover[key];
  logCommand(state, game, `${by === YOU ? "You" : personCalled(game, by)} put ${who} on as ${jobWords(job)}.`);
  return `${who} is ${job ? `${aJob(job.title)} now, in ${job.roomName}` : "one of the spare hands now"}.`;
}

// The Command menu's orders, from the server, which only the captain gives: moving someone on the watch bill, putting
// someone in a post, answering what's waiting on them, and holding the reviews or letting them go on. Gives the words
// for what was done, and what the story is told.
export function commandCommand(game, body) {
  const place = body.place ?? "meridian";
  if (!isCaptain(game)) {
    const keeper = keeperOf(game, place);
    throw new Error(`Only the captain gives orders here.${keeper ? ` ${upperFirst(calledBy(game, place, keeper))} keeps the watch bill.` : ""}`);
  }
  const notes = [];
  if (body.action === "assign") return { message: assignJob(game, place, body.key, body.job ?? null), notes };
  if (body.action === "replace") return { message: appoint(game, place, body.post, body.key, notes), notes };
  if (body.action === "answer") return { message: answerWaiting(game, place, body.post, body.answer, notes), notes };
  if (body.action === "hold") return { message: holdReviews(game, place, Boolean(body.held)), notes };
  throw new Error("That isn't an order the Command menu takes.");
}

// The first officer covers for anyone lost from their job with a spare hand, and sends the spare hand back once
// they're back. Called whenever the clock moves; said in the story when the player's aboard.
export function advanceCommand(game) {
  const notes = [];
  for (const place of Object.keys(WORLD_COMMAND)) {
    const model = commandOf(place);
    const keeper = model?.posts.find((one) => one.watchBill);
    const xo = keeper ? holderKey(game, place, keeper.id) : null;
    if (!xo || xo === YOU || !stillAlive(game, xo)) continue;
    const jobs = { ...jobsOf(game, place) };
    const cover = { ...(stateOf(game, place)?.cover ?? {}) };
    const said = [];
    for (const [filler, lost] of Object.entries(cover)) {
      if (lostReason(game, place, lost)) continue;
      if (jobs[filler] && jobs[filler] === jobs[lost]) {
        said.push(`${personCalled(game, lost)} is back as ${jobWords(jobById(place, jobs[lost]))}, and ${personCalled(game, filler)} goes back to the spare hands.`);
        jobs[filler] = null;
      }
      delete cover[filler];
    }
    for (const [key, job] of Object.entries(jobs)) {
      if (!job || key === YOU || key in cover || Object.values(cover).includes(key)) continue;
      const why = lostReason(game, place, key);
      if (!why) continue;
      const spare = Object.keys(jobs).find((one) => jobs[one] === null && one !== YOU && !lostReason(game, place, one));
      if (!spare) continue;
      jobs[spare] = job;
      cover[spare] = key;
      said.push(`${upperFirst(shortName(game, xo))} has put ${personCalled(game, spare)} on as ${jobWords(jobById(place, job))} while ${personCalled(game, key)} is ${why}.`);
    }
    const covered = JSON.stringify(cover) !== JSON.stringify(stateOf(game, place)?.cover ?? {});
    if (!said.length && !covered) continue;
    const state = commandState(game, place);
    state.jobs = jobs;
    state.cover = cover;
    for (const text of said) {
      logCommand(state, game, text);
      if (aboardShip(game)) notes.push(`[COMMAND] ${text}`);
    }
  }
  return notes;
}

// A new game's chain of command, or an old save's, with everyone in the post they hold now.
export function startCommand(game) {
  game.command = newCommandState(game);
  return game;
}

// Someone new in a post, from the day it happens: the story taking command away from the captain, and the officers'
// own choices. by is whoever chose them, or null. The holders are a new object each time, so that whatever's
// remembered about the old ones is known to be old.
export function setHolder(game, place, postId, key, { by = null, day = dayNow(game) } = {}) {
  if (!commandOf(place) || !postById(place, postId)) return;
  const state = commandState(game, place);
  const holders = { ...state.holders };
  if (key) holders[postId] = { key, since: day, by };
  else delete holders[postId];
  state.holders = holders;
}

// ---- Rising and falling -------------------------------------------------------------------------

// Someone's ambition and temper, from 1 to 5, and their loyalty to the captain to begin with, from 0 to 100: their
// file's, in world/characters, or the command file's everyone else (NATURE and EVERYONE, at the top).
export function natureOf(place, key) {
  const crew = commandOf(place)?.crew ?? EVERYONE;
  const file = WORLD_CHARACTERS[key];
  return Object.fromEntries(Object.entries(NATURE).map(([what, [lo, hi]]) => [what, typeof file?.[what] === "number" ? Math.max(lo, Math.min(hi, file[what])) : crew[what]]));
}

// The file's numbers for the reviews: how often, what a bad stretch is, how long a choice of the captain's own stands,
// and how fast people forget.
function readReviews(numbers, problem) {
  const days = (words, what, example) => {
    if (words === undefined || words === null || words === "") return null;
    const found = String(words).match(/^(\d+)\s+days?$/i);
    if (!found) problem(`${what} is a number of days, such as ${example}, not "${words}"`);
    return found ? Number(found[1]) : null;
  };
  const every = days(numbers.reviews, "reviews every", "7 days");
  const stretch = numbers.stretch ? String(numbers.stretch).match(/^duty\s+under\s+(\d+)\s+for\s+(\d+)\s+days?$/i) : null;
  if (numbers.stretch && !stretch) problem(`a bad stretch is written like duty under 40 for 5 days, not "${numbers.stretch}"`);
  if (stretch && Number(stretch[2]) > 7) problem("a bad stretch can't be longer than the 7 days of duty that are kept");
  const fade = numbers.fade ? String(numbers.fade).match(/^by\s+half\s+every\s+(\d+)\s+days?$/i) : null;
  if (numbers.fade && !fade) problem(`memories fade is written like by half every 30 days, not "${numbers.fade}"`);
  return {
    every: every || null,
    under: stretch ? Number(stretch[1]) : null,
    days: stretch ? Math.max(1, Math.min(7, Number(stretch[2]))) : null,
    stands: days(numbers.stands, "the captain's choices stand", "10 days") ?? 0,
    fade: fade && Number(fade[1]) > 0 ? Number(fade[1]) : 30,
  };
}

// "ambition 2, temper 2, loyalty 60": the numbers of everyone without them in a file of their own.
function readEveryone(words, problem) {
  const out = { ...EVERYONE };
  for (const piece of String(words ?? "").split(/\s*,\s*/).filter(Boolean)) {
    const found = piece.match(/^(ambition|temper|loyalty)\s+(\d+)$/i);
    if (!found) {
      problem(`everyone else is written like ambition 2, temper 2, loyalty 60, and "${piece}" isn't one of those`);
      continue;
    }
    const what = found[1].toLowerCase();
    const [lo, hi] = NATURE[what];
    const n = Number(found[2]);
    if (n < lo || n > hi) problem(`everyone else's ${what} goes from ${lo} to ${hi}, not ${n}`);
    out[what] = Math.max(lo, Math.min(hi, n));
  }
  return out;
}

// What people remember of what was done to them, kept in the save with the day, who did it, who it was for, and the
// post. Each counts for or against whoever did it, and half as much against whoever got what they lost, fading by
// half every so many days (the file's memories fade).
const MEMORY = {
  promoted: { weight: 20, words: "given the post of {title} by {by}" },
  restored: { weight: 15, words: "given back the post of {title} by {by}" },
  kept: { weight: 12, words: "kept on as {title} by {by}, against advice" },
  warned: { weight: -5, words: "warned about the work as {title} by {by}" },
  relieved: { weight: -30, words: "relieved as {title} by {by}" },
  passed_over: { weight: -12, words: "passed over for {title} by {by}, who chose {who}" },
  refused: { weight: -10, words: "refused the post of {title} by {by}" },
  asked: { weight: 0, words: "asked {by} for the post of {title}" },
};
const memoriesOf = (game, place, key) => stateOf(game, place)?.memory?.[key] ?? [];
const fadeOf = (place) => commandOf(place)?.reviews?.fade || 30;
const strengthOf = (game, place, one) => 0.5 ** (Math.max(0, dayNow(game) - one.day) / fadeOf(place));
function remember(game, place, key, kind, { by = null, about = null, post = null, day = dayNow(game) } = {}) {
  if (!key || key === YOU) return;
  const state = commandState(game, place);
  const list = memoriesOf(game, place, key).filter((one) => strengthOf(game, place, one) >= 1 / 16);
  list.push({ day, kind, by, about, post });
  state.memory = { ...(state.memory ?? {}), [key]: list.slice(-8) };
}

// How someone feels about another, from what they remember: for what was done for them, against what was done to
// them, and half as much against whoever got what they lost.
export function regardFor(game, place, key, other) {
  if (!other) return 0;
  let sum = 0;
  for (const one of memoriesOf(game, place, key)) {
    const weight = MEMORY[one.kind]?.weight ?? 0;
    if (one.by === other) sum += weight * strengthOf(game, place, one);
    else if (one.about === other && weight < 0) sum += (weight / 2) * strengthOf(game, place, one);
  }
  return Math.round(sum);
}

// Someone's loyalty to whoever's in the chair now: their own to begin with, and what they remember of them.
export function loyaltyOf(game, place, key) {
  const model = commandOf(place);
  const captain = model?.chairPost ? holderKey(game, place, model.chairPost) : null;
  return Math.max(0, Math.min(100, natureOf(place, key).loyalty + regardFor(game, place, key, captain)));
}

// Everyone a post could be given to: whoever does the jobs it's picked from and whoever holds the posts it's picked
// from, who's here and well. Never the player, whoever holds it now, or whoever's in the chair.
export function candidatesFor(game, place, postId) {
  const model = commandOf(place);
  const post = postById(place, postId);
  if (!model || !post?.pool) return [];
  const holder = holderKey(game, place, postId);
  const chair = model.chairPost ? holderKey(game, place, model.chairPost) : null;
  const keys = new Set();
  for (const job of post.pool.jobs) for (const key of onJob(game, place, job)) keys.add(key);
  for (const other of post.pool.posts) keys.add(holderKey(game, place, other));
  return [...keys].filter((key) => key && key !== YOU && key !== holder && key !== chair && !lostReason(game, place, key));
}

// Someone's best number in the skills that count for a post: a 5 for a post with none.
const bestSkill = (game, place, post, key) => (post.skills.length ? Math.max(...post.skills.map((skill) => skillOfPerson(game, place, key, skill))) : 5);

// How good a choice someone is for a post, in the eyes of whoever chooses: ten for each point of their best skill for
// it, three for each point of ambition, a tenth of their loyalty to the captain, half of how they feel about whoever
// chooses, and a little more if they've asked for it or been passed over for it lately.
export function scoreFor(game, place, post, key, chooser) {
  const fresh = memoriesOf(game, place, key).filter((one) => one.post === post.id && strengthOf(game, place, one) >= 0.5);
  const keen = (fresh.some((one) => one.kind === "asked") ? 10 : 0) + (fresh.some((one) => one.kind === "passed_over") ? 5 : 0);
  return 10 * bestSkill(game, place, post, key) + 3 * natureOf(place, key).ambition + loyaltyOf(game, place, key) / 10 + regardFor(game, place, key, chooser) / 2 + keen;
}
const ranked = (game, place, post, chooser) => candidatesFor(game, place, post.id)
  .map((key) => ({ key, score: scoreFor(game, place, post, key, chooser) }))
  .sort((a, b) => b.score - a.score || String(a.key).localeCompare(String(b.key)));

// What a bad stretch has been about, by the measure that's been worst: "a week of empty kettles".
const WHY = {
  "morale": "falling morale", "shortages": "shortages", "deaths aboard": "deaths aboard", "stations staffed": "empty stations",
  "sittings missed": "empty kettles", "stores run dry": "empty stores", "power short": "the power failing",
  "repairs waiting": "repairs left waiting", "hull worn": "the hull wearing thin", "alarms": "alarms going off",
  "tampering seen": "tampering under their nose", "thefts": "thefts under their nose", "medicine out": "no medicine",
  "errands left waiting": "errands left waiting",
};

// Whether a post's holder has had a bad stretch: at least as many of their days on record under the mark as the file
// says. Gives what it's been about ("five days of empty kettles", "a week of the power failing") and the measure
// that was worst, or null. A stretch that's about what the post has been excused counts for nothing.
const COUNTS = ["no", "a day", "two days", "three days", "four days", "five days", "six days", "a week"];
function badStretch(game, place, post, key, today = dayNow(game)) {
  const { under, days } = commandOf(place).reviews;
  if (!under || !days) return null;
  const bad = (stateOf(game, place)?.duty?.[post.id] ?? []).filter((one) => one.key === key && one.score < under);
  if (bad.length < days) return null;
  const totals = {};
  for (const one of bad) for (const [word, score] of Object.entries(one.parts)) totals[word] = (totals[word] ?? 0) + score;
  const worst = Object.entries(totals).sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
  if (stateOf(game, place)?.excused?.[post.id]?.measure === worst) return null;
  return { words: `${COUNTS[Math.min(7, bad.length)]} of ${WHY[worst] ?? "bad days"}`, worst };
}

// When whoever took over a post after its holder was relieved has the same bad stretch, whoever chooses for it decides
// it isn't the post's doing, and nobody's relieved over it until that trouble's over (a day it's marked at the bad
// stretch's mark or better). If it comes back within the file's memories fade of the relief or the last time, it's
// excused again, without saying so again. Gives whether it was excused.
function excuse(game, place, post, holder, bad, chooser, today, notes) {
  const state = commandState(game, place);
  const last = state.relievedFor?.[post.id];
  if (!last || last.measure !== bad.worst || last.key === holder || today - Math.max(last.day, last.excusedAt ?? -Infinity) > fadeOf(place)) return false;
  state.excused = { ...(state.excused ?? {}), [post.id]: { measure: bad.worst, day: today } };
  const again = last.excusedAt !== undefined;
  state.relievedFor = { ...state.relievedFor, [post.id]: { ...last, excusedAt: today } };
  if (chooser && !again) tell(game, place, notes, `${has(calledBy(game, place, chooser))} decided that ${WHY[bad.worst] ?? "it"} isn't the ${post.title}'s doing: it was the same under ${calledBy(game, place, last.key)}. Nobody will be relieved over it while it lasts.`, today);
  return true;
}

// What the ship calls whoever holds a post: their own title and name while they hold the post the game began with
// them in ("Dr. Aduro", "Quartermaster Brandt"), and the post's title with their name otherwise ("Quartermaster
// Imre"). Someone, when nobody holds it.
export function officerName(game, place, postId) {
  const post = postById(place, postId);
  const key = holderKey(game, place, postId);
  if (!post || !key) return "Someone";
  if (key === YOU) return "You";
  const file = WORLD_CHARACTERS[key];
  if (file?.title && commandOf(place).start[postId]?.key === key) return `${file.title} ${shortName(game, key)}`;
  return `${titleCase(post.title)} ${shortName(game, key)}`;
}

// Every post's officerName, by the post's id, for the ship's lines to fill in: {quartermaster}, {chief_engineer}.
export function officerNames(game, place) {
  return Object.fromEntries((commandOf(place)?.posts ?? []).map((post) => [post.id, officerName(game, place, post.id)]));
}

// What the ship calls someone in passing: by their post if they hold one; by the title in their file if they never
// lost a post ("Father Bastian"); and by their name otherwise ("Odessa Brandt", "Cook Imre").
export function calledBy(game, place, key) {
  if (!key) return "nobody";
  if (key === YOU) return "you";
  const held = postOf(game, place, key);
  if (held) return officerName(game, place, held);
  const file = WORLD_CHARACTERS[key];
  const began = Object.values(commandOf(place)?.start ?? {}).some((one) => one.key === key);
  return file?.title && !began ? `${file.title} ${shortName(game, key)}` : personCalled(game, key);
}
const has = (name) => (name === "you" ? "You've" : `${upperFirst(name)} has`);

// Whoever keeps the watch bill, when it isn't the player and they're still with the ship: the one who speaks and acts
// in the captain's name.
function keeperOf(game, place) {
  const keeper = commandOf(place)?.posts.find((one) => one.watchBill);
  const key = keeper ? holderKey(game, place, keeper.id) : null;
  return key && key !== YOU && stillAlive(game, key) ? key : null;
}

// Says something in the chain of command's log and, when the player's aboard or has the chair, in the story.
function tell(game, place, notes, text, day) {
  logCommand(commandState(game, place), game, text, day);
  if (aboardShip(game) || isCaptain(game)) notes.push(`[COMMAND] ${text}`);
}

// The job someone relieved goes to when the one who took their post left no job behind: the one short of hands they're
// best at, or the spare hands.
function shortJobFor(game, place, jobs, key) {
  const model = commandOf(place);
  const short = model.jobs.filter((job) => Object.entries(jobs).filter(([who, one]) => one === job.id && !lostReason(game, place, who)).length < job.wanted);
  const at = (job) => (job.skills.length ? Math.max(...job.skills.map((skill) => skillOfPerson(game, place, key, skill))) : 0);
  return short.map((job) => ({ job, skill: at(job) })).sort((a, b) => b.skill - a.skill)[0]?.job.id ?? null;
}

// How someone takes being relieved, by their temper.
const TAKES_IT = ["", "and takes it without a word", "and takes it quietly", "and isn't speaking to {them}", "and has said what they think of it, loudly, all over {room}", "and has sworn to have the post back"];

// Someone new in a post: the old holder relieved, the new one given it by whoever chose them, and everyone involved
// remembering it. The old holder takes the job the new one leaves, or one that's short of hands, or goes to the spare
// hands. Whoever came closest and wanted it remembers being passed over, and with the temper for it works against
// whoever got it. A post the new holder leaves is filled in its turn. why is "after a week of empty kettles" or "at
// Dessa's asking". Gives what happened, in words, and says it.
function changeHands(game, place, postId, newKey, { by, why = null, day = dayNow(game), notes = [], runnerUp = null, depth = 0 } = {}) {
  const post = postById(place, postId);
  const state = commandState(game, place);
  const oldKey = holderKey(game, place, postId);
  const byName = calledBy(game, place, by);
  const oldName = oldKey ? calledBy(game, place, oldKey) : null;
  const newName = calledBy(game, place, newKey);
  const leftPost = postOf(game, place, newKey);
  const leftJob = state.jobs[newKey];
  const jobs = { ...state.jobs };
  delete jobs[newKey];
  state.cover = Object.fromEntries(Object.entries(state.cover).filter(([filler, lost]) => ![newKey, oldKey].includes(filler) && ![newKey, oldKey].includes(lost)));
  if (leftPost) setHolder(game, place, leftPost, null, { day });
  // Someone given back a post they were relieved of remembers it that way.
  const back = memoriesOf(game, place, newKey).some((one) => one.kind === "relieved" && one.post === postId);
  setHolder(game, place, postId, newKey, { by, day });
  remember(game, place, newKey, back ? "restored" : "promoted", { by, about: oldKey, post: postId, day });
  let words;
  if (oldKey && oldKey !== YOU) {
    const job = leftJob !== undefined ? leftJob : shortJobFor(game, place, jobs, oldKey);
    jobs[oldKey] = job;
    remember(game, place, oldKey, "relieved", { by, about: newKey, post: postId, day });
    const them = by === YOU ? `you or to ${shortName(game, newKey)}` : "either of them";
    const takes = TAKES_IT[natureOf(place, oldKey).temper].replace("{them}", them).replace("{room}", lowerFirst(post.roomName));
    words = `${has(byName)} relieved ${oldName}${why ? ` ${why}` : ""}, and given the post to ${newName}. ${upperFirst(shortName(game, oldKey))} is ${jobWords(jobById(place, job))} now, ${takes}.`;
  } else words = `${has(byName)} made ${newName} ${post.title}${why ? ` ${why}` : ""}.`;
  state.jobs = jobs;
  if (state.rivals?.[postId]) state.rivals = Object.fromEntries(Object.entries(state.rivals).filter(([id]) => id !== postId));
  dropWaiting(game, place, postId);
  if (runnerUp && runnerUp !== newKey && natureOf(place, runnerUp).ambition >= 3) {
    remember(game, place, runnerUp, "passed_over", { by, about: newKey, post: postId, day });
    if (natureOf(place, runnerUp).ambition >= 4 && natureOf(place, runnerUp).temper >= 4) {
      startRivalry(game, place, postId, runnerUp, day);
      words += ` ${upperFirst(calledBy(game, place, runnerUp))} wanted it, and has started working against ${shortName(game, newKey)}.`;
    }
  }
  tell(game, place, notes, words, day);
  if (leftPost && depth < 3) fillPost(game, place, leftPost, { day, notes, depth: depth + 1 });
  return words;
}

// A post left empty, filled by whoever chooses for it, with the best of whoever it's picked from. The first officer
// fills one of the captain's in the captain's name, and the captain can change it.
function fillPost(game, place, postId, { day = dayNow(game), notes = [], depth = 0 } = {}) {
  const post = postById(place, postId);
  if (!post?.chooser.post || holderKey(game, place, postId)) return;
  let chooser = holderKey(game, place, post.chooser.post);
  let why = null;
  if (chooser === YOU) {
    chooser = keeperOf(game, place);
    why = "in your name";
  }
  if (!chooser || !stillAlive(game, chooser)) return;
  const [best, next] = ranked(game, place, post, chooser);
  if (best) changeHands(game, place, postId, best.key, { by: chooser, why, day, notes, runnerUp: next?.key ?? null, depth });
}

// Someone working against whoever holds a post: a deputy who wanted it, for as long as it's fresh in their mind and
// they're still among those it's picked from.
function startRivalry(game, place, postId, key, day) {
  const state = commandState(game, place);
  state.rivals = { ...(state.rivals ?? {}), [postId]: { key, since: day } };
}
function rivalOf(game, place, postId, today = dayNow(game)) {
  const rival = stateOf(game, place)?.rivals?.[postId];
  if (!rival || today - rival.since > fadeOf(place)) return null;
  return candidatesFor(game, place, postId).includes(rival.key) ? rival.key : null;
}

// Whether a choice of the captain's own still stands: someone they put in a post, or kept in one against advice, within
// the file's days.
function standsYet(game, place, postId, key, today) {
  const stands = commandOf(place).reviews.stands;
  if (!stands) return false;
  const held = stateOf(game, place)?.holders?.[postId];
  if (held?.key === key && held.by === YOU && held.since && today - held.since < stands) return true;
  return memoriesOf(game, place, key).some((one) => one.kind === "kept" && one.post === postId && one.by === YOU && today - one.day < stands);
}

// What's waiting on the captain: the first officer's recommendation to relieve someone, or a deputy asking for their
// boss's post. Kept in the save by post until it's answered, or until the next review.
function putWaiting(game, place, postId, waiting, notes) {
  const state = commandState(game, place);
  state.pending = { ...(state.pending ?? {}), [postId]: waiting };
  tell(game, place, notes, `${waitingWords(game, place, postId, waiting)} It's waiting for you on the Command menu.`, waiting.day);
}
function dropWaiting(game, place, postId) {
  const state = commandState(game, place);
  if (!state.pending?.[postId]) return;
  state.pending = Object.fromEntries(Object.entries(state.pending).filter(([id]) => id !== postId));
}
function waitingWords(game, place, postId, waiting) {
  const post = postById(place, postId);
  if (waiting.kind === "relieve") {
    const by = waiting.by ? `${upperFirst(calledBy(game, place, waiting.by))} recommends` : "The records say it's time to think about";
    return `${by} relieving ${calledBy(game, place, waiting.key)} ${waiting.why}, and giving the post to ${calledBy(game, place, waiting.candidate)}.`;
  }
  const skill = post.skills.map((id) => ({ id, theirs: skillOfPerson(game, place, waiting.candidate, id), mine: skillOfPerson(game, place, waiting.key, id) })).sort((a, b) => b.theirs - a.theirs)[0];
  const better = skill ? `: their ${SKILLS[skill.id]?.name?.toLowerCase() ?? skill.id.replace(/_/g, " ")} is ${skill.theirs} to ${shortName(game, waiting.key)}'s ${skill.mine}` : "";
  return `${upperFirst(calledBy(game, place, waiting.candidate))} asks to be made ${post.title} in place of ${calledBy(game, place, waiting.key)}${better}.`;
}

// Whoever chooses for a post settles what's waiting on it: a recommendation to relieve its holder is done, with the one
// recommended if they still can be; a deputy asking for it gets it if they'd do better than whoever holds it, and is
// told no otherwise. alone is the first officer acting on what the captain didn't answer.
function decide(game, place, postId, waiting, decider, { day = dayNow(game), notes = [], alone = false } = {}) {
  const post = postById(place, postId);
  const holder = holderKey(game, place, postId);
  const unanswered = alone ? ", in your name, since you hadn't answered" : "";
  const can = candidatesFor(game, place, postId);
  if (waiting.kind === "relieve") {
    const pick = can.includes(waiting.candidate) ? waiting.candidate : ranked(game, place, post, decider)[0]?.key;
    if (!pick) return null;
    relievedFor(game, place, postId, waiting, day);
    return changeHands(game, place, postId, pick, { by: decider, why: `${waiting.why}${unanswered}`, day, notes, runnerUp: waiting.runnerUp ?? null });
  }
  if (!can.includes(waiting.candidate)) return null;
  const record = dutyOf(game, place, post, holder);
  const keeps = scoreFor(game, place, post, holder, decider) + 10 + (record?.score != null ? (record.score - 50) / 5 : 0);
  if (scoreFor(game, place, post, waiting.candidate, decider) > keeps) return changeHands(game, place, postId, waiting.candidate, { by: decider, why: `${waiting.why}${unanswered}`, day, notes });
  return refuse(game, place, postId, waiting, decider, { day, notes });
}

// What a post's holder was last relieved over, and who it was, so that the same trouble under whoever took over can be
// seen for what it is.
function relievedFor(game, place, postId, waiting, day) {
  if (!waiting.measure) return;
  const state = commandState(game, place);
  state.relievedFor = { ...(state.relievedFor ?? {}), [postId]: { measure: waiting.measure, key: waiting.key, day } };
}

// A deputy told no: they remember it, and with the temper for it, work against whoever holds the post.
function refuse(game, place, postId, waiting, decider, { day = dayNow(game), notes = [] } = {}) {
  const post = postById(place, postId);
  const asker = waiting.candidate;
  remember(game, place, asker, "refused", { by: decider, about: waiting.key, post: postId, day });
  let words = `${has(calledBy(game, place, decider))} told ${calledBy(game, place, asker)} no: ${calledBy(game, place, waiting.key)} stays ${post.title}.`;
  if (natureOf(place, asker).temper >= 4) {
    startRivalry(game, place, postId, asker, day);
    words += ` ${upperFirst(shortName(game, asker))} hasn't taken it well, and has started working against ${shortName(game, waiting.key)}.`;
  }
  dropWaiting(game, place, postId);
  tell(game, place, notes, words, day);
  return words;
}

// A holder with a bad stretch is warned at the midnight it shows, by whoever chooses for the post (the first officer,
// in the captain's name, for the player as captain), once in the time since they took it, and again only after two
// reviews' time.
function warnPost(game, place, post, today, notes) {
  const model = commandOf(place);
  if (!post.chooser.post || post.id === model.chairPost) return;
  const holder = holderKey(game, place, post.id);
  if (!holder || holder === YOU) return;
  const chooser = holderKey(game, place, post.chooser.post);
  if (!chooser || (chooser !== YOU && !stillAlive(game, chooser))) return;
  if (standsYet(game, place, post.id, holder, today) || warnedLately(game, place, post, holder, today, today + 1)) return;
  const bad = badStretch(game, place, post, holder, today);
  if (!bad) return;
  const keeper = keeperOf(game, place);
  const advisor = chooser === YOU ? (keeper !== holder ? keeper : null) : chooser;
  if (excuse(game, place, post, holder, bad, advisor, today, notes)) return;
  remember(game, place, holder, "warned", { by: advisor ?? chooser, post: post.id, day: today });
  const words = chooser !== YOU
    ? `${has(calledBy(game, place, chooser))} warned ${calledBy(game, place, holder)} about ${bad.words}.`
    : advisor
      ? `${has(calledBy(game, place, advisor))} had a word with ${calledBy(game, place, holder)} in your name, about ${bad.words}. If it goes on, ${shortName(game, advisor)} will recommend relieving them at the review.`
      : `The records show ${bad.words} for ${calledBy(game, place, holder)}. If it goes on, it'll be time to think about relieving them.`;
  tell(game, place, notes, words, today);
}

// Whether someone's been warned about their work in a post since they took it, before a day, within two reviews' time.
function warnedLately(game, place, post, key, today, before = today) {
  const since = stateOf(game, place)?.holders?.[post.id]?.since ?? 0;
  const every = commandOf(place).reviews.every ?? 7;
  return memoriesOf(game, place, key).some((one) => one.kind === "warned" && one.post === post.id && one.day < before && one.day >= since && today - one.day <= 2 * every);
}

// One post at a review. A holder with a bad stretch who's been warned already is relieved; otherwise a deputy with two
// points more skill and the ambition for it may ask for the post. For the player as captain, it comes to them from the
// first officer.
function reviewPost(game, place, post, today, notes) {
  const model = commandOf(place);
  if (!post.chooser.post || post.id === model.chairPost) return;
  const holder = holderKey(game, place, post.id);
  if (!holder || holder === YOU) return;
  const chooser = holderKey(game, place, post.chooser.post);
  if (!chooser || (chooser !== YOU && !stillAlive(game, chooser))) return;
  if (standsYet(game, place, post.id, holder, today)) return;
  const keeper = keeperOf(game, place);
  const advisor = chooser === YOU ? (keeper !== holder ? keeper : null) : chooser;
  const bad = badStretch(game, place, post, holder, today);
  if (bad) {
    if (excuse(game, place, post, holder, bad, advisor, today, notes)) return;
    // Not warned yet: the warning comes now, and the relieving at the next review.
    if (!warnedLately(game, place, post, holder, today)) return warnPost(game, place, post, today, notes);
    const [best, next] = ranked(game, place, post, advisor ?? chooser);
    if (!best) return;
    const waiting = { kind: "relieve", day: today, key: holder, candidate: best.key, runnerUp: next?.key ?? null, why: `after ${bad.words}`, measure: bad.worst, by: advisor };
    if (chooser === YOU) putWaiting(game, place, post.id, waiting, notes);
    else decide(game, place, post.id, waiting, chooser, { day: today, notes });
    return;
  }
  const mine = bestSkill(game, place, post, holder);
  const keen = ranked(game, place, post, advisor ?? chooser).find(({ key }) => natureOf(place, key).ambition >= 4 && bestSkill(game, place, post, key) >= mine + 2
    && !memoriesOf(game, place, key).some((one) => ["asked", "refused"].includes(one.kind) && one.post === post.id && strengthOf(game, place, one) >= 0.5));
  if (!keen) return;
  remember(game, place, keen.key, "asked", { by: chooser, about: holder, post: post.id, day: today });
  const waiting = { kind: "asks", day: today, key: holder, candidate: keen.key, why: `at ${shortName(game, keen.key)}'s asking`, by: advisor };
  if (chooser === YOU) {
    putWaiting(game, place, post.id, waiting, notes);
    return;
  }
  tell(game, place, notes, `${upperFirst(calledBy(game, place, keen.key))} has asked ${calledBy(game, place, chooser)} to be made ${post.title} in place of ${calledBy(game, place, holder)}.`, today);
  decide(game, place, post.id, waiting, chooser, { day: today, notes });
}

// At each midnight a holder with a bad stretch is warned; and every review day (every so many days, from the file),
// the officers review their people, post by post. What the player as captain left unanswered since the last review,
// the first officer acts on first. Nothing happens while the captain holds the reviews. Called from the day's loop
// after the posts' duty is settled.
export function reviewDay(game, day) {
  const notes = [];
  for (const place of Object.keys(WORLD_COMMAND)) {
    const model = commandOf(place);
    const every = model?.reviews?.every;
    if (!every || !game.ship || !game.command?.[place]) continue;
    const state = commandState(game, place);
    if ((state.reviewAt ?? -1) >= day) continue;
    state.reviewAt = day;
    if (day <= 0 || (state.held && isCaptain(game))) continue;
    const today = day + 1;
    if (day % every !== 0) {
      for (const post of model.posts) warnPost(game, place, post, today, notes);
      continue;
    }
    const settled = new Set();
    for (const [postId, waiting] of Object.entries(state.pending ?? {})) {
      if (holderKey(game, place, postId) !== waiting.key) {
        dropWaiting(game, place, postId);
        continue;
      }
      settled.add(postId);
      if (!waiting.by || !stillAlive(game, waiting.by)) continue;
      dropWaiting(game, place, postId);
      decide(game, place, postId, waiting, waiting.by, { day: today, notes, alone: true });
    }
    for (const post of model.posts) if (!settled.has(post.id)) reviewPost(game, place, post, today, notes);
  }
  return notes;
}

// The captain putting someone in a post themselves: whoever held it relieved, whoever came closest passed over, and the
// choice standing a while. Only posts another post chooses for, and only someone it's picked from.
export function appoint(game, place, postId, key, notes = []) {
  const model = commandOf(place);
  const post = postById(place, postId);
  if (!post || !post.chooser.post || post.id === model.chairPost) throw new Error("That post isn't one the captain gives.");
  if (!candidatesFor(game, place, postId).includes(key)) throw new Error(`${upperFirst(calledBy(game, place, key))} can't be given the post of ${post.title} just now.`);
  const runnerUp = ranked(game, place, post, YOU).find((one) => one.key !== key)?.key ?? null;
  return changeHands(game, place, postId, key, { by: YOU, notes, runnerUp });
}

// The captain answering what's waiting on them: do it, keep whoever holds the post (or refuse whoever asked), or leave
// it to whoever advised.
export function answerWaiting(game, place, postId, answer, notes = []) {
  const waiting = stateOf(game, place)?.pending?.[postId];
  const post = postById(place, postId);
  if (!waiting || !post) throw new Error("There's nothing waiting on that post.");
  if (holderKey(game, place, postId) !== waiting.key) {
    dropWaiting(game, place, postId);
    return "That's out of date: someone else holds the post now.";
  }
  if (answer === "accept") {
    if (!candidatesFor(game, place, postId).includes(waiting.candidate)) {
      dropWaiting(game, place, postId);
      return `${upperFirst(calledBy(game, place, waiting.candidate))} can't take the post just now.`;
    }
    if (waiting.kind === "relieve") relievedFor(game, place, postId, waiting, dayNow(game));
    return changeHands(game, place, postId, waiting.candidate, { by: YOU, why: waiting.why, notes, runnerUp: waiting.runnerUp ?? null });
  }
  if (answer === "keep") {
    if (waiting.kind === "asks") return refuse(game, place, postId, waiting, YOU, { notes });
    remember(game, place, waiting.key, "kept", { by: YOU, post: postId });
    dropWaiting(game, place, postId);
    const stands = commandOf(place).reviews.stands;
    const words = `You've kept ${calledBy(game, place, waiting.key)} on as ${post.title}, against ${waiting.by ? `${calledBy(game, place, waiting.by)}'s advice` : "the records"}.${stands ? ` Your choice stands for ${stands} days.` : ""}`;
    tell(game, place, notes, words, dayNow(game));
    return words;
  }
  if (answer === "leave") {
    if (!waiting.by || !stillAlive(game, waiting.by)) throw new Error("There's nobody to leave it to.");
    dropWaiting(game, place, postId);
    return decide(game, place, postId, waiting, waiting.by, { notes }) ?? "Nothing has changed.";
  }
  throw new Error("That isn't an answer to what's waiting.");
}

// The captain's switch: while the reviews are held, nobody's warned, relieved or given a post by anyone but the captain.
export function holdReviews(game, place, held) {
  const model = commandOf(place);
  const state = commandState(game, place);
  state.held = held;
  return held ? "The reviews are held: nobody will be warned, relieved or given a post unless you do it." : `The reviews will go on, every ${model.reviews.every ?? "few"} days.`;
}

// The first thing someone says when the player talks to them, while something's fresh in their mind: being relieved,
// passed over, refused, warned, given a post or kept on in one. The lines are world/rooms.json's talk.stock.grudge, by
// what it was and whether the player did it, and each person says the same one about the same thing. Null if nothing.
export function grudgeLine(game, key) {
  const lines = ROOM_TALK.stock?.grudge;
  if (!lines || !key) return null;
  for (const place of Object.keys(WORLD_COMMAND)) {
    const fresh = memoriesOf(game, place, key).filter((one) => one.kind !== "asked" && strengthOf(game, place, one) >= 0.5).at(-1);
    if (!fresh) continue;
    const list = (fresh.by === YOU && lines[`${fresh.kind}_by_you`]) || lines[fresh.kind];
    if (!Array.isArray(list) || !list.length) return null;
    const post = postById(place, fresh.post);
    const values = { title: post?.title ?? "", post: post ? `the ${post.title}'s post` : "the post", by: calledBy(game, place, fresh.by), who: calledBy(game, place, fresh.about) };
    return list[seedFrom(`${key}/${fresh.day}/${fresh.kind}`) % list.length].replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
  }
  return null;
}

// What someone remembers, in words, freshest first: "Day 15: relieved as quartermaster by Commander Voss".
function memoryLines(game, place, key, kinds = null) {
  return memoriesOf(game, place, key)
    .filter((one) => (!kinds || kinds.includes(one.kind)) && strengthOf(game, place, one) >= 0.25 && MEMORY[one.kind])
    .slice(-3).reverse()
    .map((one) => `Day ${one.day}: ${MEMORY[one.kind].words.replace(/\{(\w+)\}/g, (_, name) => ({ title: postById(place, one.post)?.title ?? "a post", by: calledBy(game, place, one.by), who: calledBy(game, place, one.about) })[name] ?? "")}`);
}

// ---- Skill in the work ------------------------------------------------------------------------------

// How much each point of skill either side of 5 speeds the work or slows it, from the file's "each point of skill".
const skillStep = (place) => {
  const n = parseFloat(String(WORLD_COMMAND[place]?.numbers?.skill ?? ""));
  return Number.isFinite(n) ? n / 100 : 0;
};

// Someone's number in a skill: their file's, or the player's own. Someone without a file is a 5 in the skills of the
// job the file starts them in, and a 2 in everything else, so a cook put in engineering is slow at it.
export function skillOfPerson(game, place, key, skill) {
  if (key === YOU) return game.skills?.[skill] ?? 0;
  const file = WORLD_CHARACTERS[key];
  if (file) return file.skills?.[skill] ?? 0;
  const model = commandOf(place);
  const own = model?.startJob?.[key];
  const job = own ? model.jobs.find((one) => one.id === own) : null;
  return job?.skills.includes(skill) ? 5 : 2;
}

// How much quicker the best of some people does work that needs a skill: 1 for a 5, a step quicker or slower for each
// point either side, never under a half nor over half again. 1 where the file says nothing about skill. Remembered,
// since the machines ask it every five minutes of the clock: only the player's own skill can change.
const speeds = new Map();
export function speedOf(game, place, keys, skill) {
  const step = skillStep(place);
  if (!step || !skill || !keys.length) return 1;
  const remember = !keys.includes(YOU);
  const key = `${place}|${skill}|${keys.join(",")}`;
  if (remember && speeds.has(key)) return speeds.get(key);
  const best = Math.max(...keys.map((one) => skillOfPerson(game, place, one, skill)));
  const speed = Math.min(1.5, Math.max(0.5, 1 + step * (best - 5)));
  if (remember) {
    if (speeds.size > 500) speeds.clear();
    speeds.set(key, speed);
  }
  return speed;
}

// ---- Duty: counted through the day, settled at midnight ------------------------------------------

const dayIndex = (game) => Math.floor((game.clock?.hours ?? 0) / 24);

// What's counted through a day for the posts' duty: minutes of power short and of errands left waiting, and alarms,
// tampering seen, thefts and deaths aboard. Kept a couple of days back.
export function tallyDuty(game, place, day, adds) {
  if (!commandOf(place) || !Object.values(adds).some(Boolean)) return;
  const state = commandState(game, place);
  state.tally ??= {};
  const tally = (state.tally[day] ??= {});
  for (const [what, n] of Object.entries(adds)) if (n) tally[what] = (tally[what] ?? 0) + n;
  for (const key of Object.keys(state.tally)) if (Number(key) < day - 2) delete state.tally[key];
}
export const countForDuty = (game, place, what, n = 1) => tallyDuty(game, place, dayIndex(game), { [what]: n });

// How much of what the watch bill wants is being done, out of 100: each job counts up to what it wants.
function staffedScore(game, place, model) {
  let wanted = 0;
  let filled = 0;
  for (const job of model.jobs) {
    wanted += job.wanted;
    filled += Math.min(job.wanted, onJob(game, place, job.id).filter((key) => !lostReason(game, place, key)).length);
  }
  return wanted ? (100 * filled) / wanted : null;
}

// At each midnight, the duty of whoever holds each post for the day that's ended: each of its measures out of 100,
// and their average, kept a week back for each post. Called from the day's loop after the ship's own day.
export function dutyDay(game, day) {
  for (const place of Object.keys(WORLD_COMMAND)) {
    const model = commandOf(place);
    if (!model || !game.ship) continue;
    const state = commandState(game, place);
    if ((state.dutyAt ?? -1) >= day) continue;
    state.dutyAt = day;
    const ended = day - 1;
    const meals = game.logistics?.[place]?.meals?.days?.[ended];
    const c = {
      ship: game.ship,
      tally: { powerShort: 0, errandsWaiting: 0, alarms: 0, tampering: 0, thefts: 0, deaths: 0, ...(state.tally?.[ended] ?? {}) },
      staffed: staffedScore(game, place, model),
      sittings: meals && meals.served + meals.missed > 0 ? (100 * meals.served) / (meals.served + meals.missed) : null,
      waitingParts: waitingForParts(game, place).length,
    };
    state.duty ??= {};
    for (const post of model.posts) {
      const key = holderKey(game, place, post.id);
      if (!post.measures.length || !key) continue;
      const parts = {};
      for (const word of post.measures) {
        const value = DUTY_MEASURES[word](c);
        if (Number.isFinite(value)) parts[word] = Math.round(Math.max(0, Math.min(100, value)));
      }
      const values = Object.values(parts);
      if (!values.length) continue;
      // A rival working against them takes ten off the day.
      const rival = rivalOf(game, place, post.id, day + 1);
      const score = Math.round(values.reduce((sum, one) => sum + one, 0) / values.length) - (rival ? 10 : 0);
      const list = (state.duty[post.id] ??= []);
      list.push({ day: ended, key, score: Math.max(0, score), parts, ...(rival ? { against: rival } : {}) });
      if (list.length > 7) list.splice(0, list.length - 7);
      // What the post was excused is over once a day's marked well on it again.
      const excused = state.excused?.[post.id];
      if (excused && (parts[excused.measure] ?? 100) >= (model.reviews?.under ?? 0)) state.excused = Object.fromEntries(Object.entries(state.excused).filter(([id]) => id !== post.id));
    }
  }
  return [];
}

// How a post's holder has done: the average of their days on record, up to a week, and the last day's measures.
function dutyOf(game, place, post, key) {
  if (!post.measures.length) return null;
  const days = (stateOf(game, place)?.duty?.[post.id] ?? []).filter((one) => one.key === key);
  if (!days.length) return { score: null, days: 0, measures: post.measures.join(", ") };
  const last = days.at(-1);
  const marks = Object.entries(last.parts).map(([word, score]) => `${word} ${score}/100`);
  if (last.against) marks.push(`10 off for ${calledBy(game, place, last.against)} working against them`);
  return { score: Math.round(days.reduce((sum, one) => sum + one.score, 0) / days.length), days: days.length, last: marks.join(", ") };
}

// ---- What the Command menu shows ------------------------------------------------------------------

// Someone's numbers in the skills that count for a post, as the game counts them: "commerce 7", "engineering 8,
// science 4"; someone without a file is a 5 at their own job and a 2 at anything else.
function skillWords(game, place, key, skills) {
  if (!key || !skills.length) return null;
  return skills.map((id) => `${SKILLS[id]?.name?.toLowerCase() ?? id.replace(/_/g, " ")} ${skillOfPerson(game, place, key, id)}`).join(", ");
}

// The day of the next review, as the game counts days, or null.
function nextReview(game, model) {
  const every = model.reviews?.every;
  if (!every) return null;
  const index = Math.floor((game.clock?.hours ?? 0) / 24);
  return (Math.floor(index / every) + 1) * every + 1;
}

// Every post as a card, in the file's order, grouped by who chooses them. Reading this changes nothing.
export function commandView(game, place = "meridian") {
  const model = commandOf(place);
  if (!model) return null;
  const captain = isCaptain(game);
  const state = stateOf(game, place);
  const card = (post) => {
    const key = holderKey(game, place, post.id);
    // What the save says about how they came to hold it, as long as it's about whoever holds it now.
    const kept = stateOf(game, place)?.holders?.[post.id] ?? null;
    const held = kept && kept.key === key ? kept : null;
    const chooser = post.chooser.post ? postById(place, post.chooser.post) : null;
    const chooserKey = chooser ? holderKey(game, place, chooser.id) : null;
    const rival = key ? rivalOf(game, place, post.id) : null;
    // The captain can give any post another post chooses for, to anyone it's picked from.
    const givable = captain && Boolean(post.chooser.post) && post.id !== model.chairPost;
    return {
      id: post.id,
      title: upperFirst(post.title),
      holder: key ? { key, name: key === YOU ? `You, ${game.name}` : personCalled(game, key), you: key === YOU, sheet: key !== YOU && Boolean(WORLD_CHARACTERS[key]), alive: stillAlive(game, key) } : null,
      since: held?.since ? `Since day ${held.since}${held.by ? `, chosen by ${held.by === YOU ? "you" : personCalled(game, held.by)}` : ""}` : "Since before the game began",
      chosenBy: chooser ? `the ${chooser.title}` : `the ${post.chooser.body}`,
      chooser: chooserKey ? (chooserKey === YOU ? "you" : personCalled(game, chooserKey)) : null,
      station: post.roomName,
      skills: skillWords(game, place, key, post.skills),
      heads: post.heads.length ? listWords(post.heads.map((id) => plural(model.jobs.find((job) => job.id === id)?.title ?? id))) : null,
      watchBill: post.watchBill,
      duty: key ? dutyOf(game, place, post, key) : null,
      memories: key && key !== YOU ? memoryLines(game, place, key) : [],
      rival: rival ? calledBy(game, place, rival) : null,
      candidates: givable ? ranked(game, place, post, YOU).slice(0, 8).map((one) => ({ key: one.key, name: calledBy(game, place, one.key), skills: skillWords(game, place, one.key, post.skills) ?? "" })) : null,
    };
  };
  const groups = [];
  for (const post of model.posts) {
    const by = post.chooser.post ? `Chosen by the ${postById(place, post.chooser.post).title}` : `Chosen by the ${post.chooser.body}`;
    const group = groups.find((one) => one.title === by) ?? groups[groups.push({ title: by, posts: [] }) - 1];
    group.posts.push(card(post));
  }
  // The watch bill: each job with who's on it and how many it's short, the spare hands, and what's changed lately.
  const cover = stateOf(game, place)?.cover ?? {};
  const keeper = model.posts.find((one) => one.watchBill);
  const keeperKey = keeper ? holderKey(game, place, keeper.id) : null;
  const person = (key) => ({ key, name: key === YOU ? `You, ${game.name}` : personCalled(game, key), you: key === YOU, lost: lostReason(game, place, key), covering: cover[key] ? personCalled(game, cover[key]) : null, past: key === YOU ? null : memoryLines(game, place, key, ["relieved"])[0]?.replace(/^Day (\d+): relieved as (.+?) by .*$/, "relieved as $2 on day $1") ?? null });
  const watchBill = {
    keeper: keeperKey ? (keeperKey === YOU ? "you" : personCalled(game, keeperKey)) : null,
    canMove: isCaptain(game),
    jobs: model.jobs.map((job) => {
      const people = onJob(game, place, job.id).map(person);
      return { id: job.id, title: upperFirst(job.title), plural: upperFirst(plural(job.title)), room: job.roomName, wanted: job.wanted, people, short: Math.max(0, job.wanted - people.filter((one) => !one.lost).length) };
    }),
    spare: onJob(game, place, null).map(person),
    log: (stateOf(game, place)?.log ?? []).slice(-8).reverse().map((one) => `Day ${one.day}: ${one.text}`),
  };
  // The reviews: how often, the next one, and whether the captain's holding them; and what's waiting on the captain.
  const reviews = model.reviews?.every ? { every: model.reviews.every, next: nextReview(game, model), held: captain && Boolean(state?.held), canHold: captain } : null;
  const waiting = captain ? Object.entries(state?.pending ?? {}).map(([postId, one]) => ({
    post: postId,
    kind: one.kind,
    day: one.day,
    text: waitingWords(game, place, postId, one),
    holder: shortName(game, one.key),
    candidate: shortName(game, one.candidate),
    by: one.by ? shortName(game, one.by) : null,
  })) : [];
  return { place, name: model.name, groups, watchBill, reviews, waiting };
}
