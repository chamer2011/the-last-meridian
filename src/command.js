// A place's chain of command: its posts, who holds each one, who chose them, and since when. It's written in
// world/command/<place>.txt (read by public/command-text.js), compiled here against the place's rooms and people, and
// kept in the save as game.command[place] once a game begins. Everything that names someone for a post (the council's
// decisions, the systems' engineers and guards, the errands, the captain's chair) asks here who holds it. Nothing here
// calls an AI, and reading it changes nothing.

import { SKILLS } from "./character-data.js";
import { LOCATIONS } from "./data.js";
import { isHurt } from "./deeds.js";
import { aboardShip, isCaptain, startOf } from "./role.js";
import { atPost, mapFor, roomsOf } from "./walk.js";
import { COMMAND_FILE_PROBLEMS, WORLD_CHARACTERS, WORLD_COMMAND, WORLD_LIFE } from "./world.js";
import { BODIES, SPARE, THE_CHAIR, readHolderLine, readJobLine, readPostLine, readWorkersLine, slugOf } from "../public/command-text.js";

// The player, when they hold a post.
export const YOU = "you";

const plain = (words) => String(words ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const upperFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const lowerFirst = (text) => (text ? text[0].toLowerCase() + text.slice(1) : text);
const SMALL_WORDS = new Set(["of", "the", "and"]);
const titleCase = (words) => String(words).split(" ").map((word, i) => (i && SMALL_WORDS.has(word) ? word : upperFirst(word))).join(" ");
const listWords = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0] ?? "");
const plural = (words) => (/s$/.test(words) ? words : `${words}s`);

// ---- The file, compiled -------------------------------------------------------------------------

const models = new Map();

// Read again after the file changes.
export function clearCommand() {
  models.clear();
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
    model.posts.push({ id, title: post.title, room: room.id, roomName: room.name, chosenBy: post.chosenBy, watchBill: post.watchBill, heads, skills: readSkills(post.skills, raw.line, `the ${post.title}`), duty: post.duty, line: raw.line });
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
      if (!key) at(raw.line, `nobody called ${words} has a day at ${name} in world/life, to be ${spare ? "a spare hand" : `a ${job.title}`}`);
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
const shortName = (game, key) => String(personCalled(game, key)).split(" ").at(-1);

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
export function newCommandState(game) {
  const state = {};
  for (const place of Object.keys(WORLD_COMMAND)) {
    const model = commandOf(place);
    if (!model) continue;
    const holders = {};
    for (const post of model.posts) {
      const start = model.start[post.id];
      const key = start?.chair ? chairHolder(game) : start?.key;
      if (key) holders[post.id] = { key, since: null, by: null };
    }
    state[place] = { holders, jobs: startJobs(game, model), cover: {}, log: [] };
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
function jobsOf(game, place) {
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
  game.command[place] ??= { holders: {} };
  const state = game.command[place];
  state.jobs ??= startJobs(game, model);
  state.cover ??= {};
  state.log ??= [];
  return state;
}
const dayNow = (game) => Math.floor((game.clock?.hours ?? 0) / 24) + 1;
function logCommand(state, game, text) {
  state.log.push({ day: dayNow(game), text });
  if (state.log.length > 20) state.log.splice(0, state.log.length - 20);
}
const jobWords = (job) => (job ? `a ${job.title}` : "one of the spare hands");

// The days the watch bill changes: someone doing a job other than the one their group in world/life does takes that
// job's day, at their own shift, and someone sent to the spare hands takes theirs. Null when nothing's changed.
export function movedDays(game, place) {
  const model = commandOf(place);
  if (!model) return null;
  let moved = null;
  for (const [key, job] of Object.entries(jobsOf(game, place))) {
    if (key === YOU || !(key in model.startJob) || model.startJob[key] === job) continue;
    const day = job === null ? model.spareDay : model.jobs.find((one) => one.id === job)?.day;
    if (day) (moved ??= {})[key] = { job, day };
  }
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
  return { name: `Work a shift as a ${job.title} in ${lowerFirst(job.roomName)}`, pay: start.job.pay, skill: job.skills[0] ?? start.job.skill, done: `You put in a shift as a ${job.title}, in ${lowerFirst(job.roomName)}.` };
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
  return `${who} is ${job ? `a ${job.title} now, in ${job.roomName}` : "one of the spare hands now"}.`;
}

// The Command menu's orders, from the server: only the captain moves people on the watch bill.
export function commandCommand(game, body) {
  if (body.action !== "assign") throw new Error("That isn't an order the watch bill takes.");
  if (!isCaptain(game)) throw new Error("Only the captain moves people on the watch bill. Commander Voss keeps it.");
  return { message: assignJob(game, body.place ?? "meridian", body.key, body.job ?? null) };
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

// Someone new in a post, from the day it happens: the story taking command away from the captain, and later, the
// officers' own choices. by is whoever chose them, or null.
export function setHolder(game, place, postId, key, { by = null } = {}) {
  if (!commandOf(place) || !postById(place, postId)) return;
  game.command ??= {};
  game.command[place] ??= { holders: {} };
  const day = Math.floor((game.clock?.hours ?? 0) / 24) + 1;
  if (key) game.command[place].holders[postId] = { key, since: day, by };
  else delete game.command[place].holders[postId];
}

// ---- What the Command menu shows ------------------------------------------------------------------

// The holder's numbers in the skills that count for a post: "commerce 7", "engineering 8, science 4".
function skillWords(game, key, skills) {
  if (!key || !skills.length) return null;
  const rank = (id) => (key === YOU ? game.skills?.[id] ?? 0 : WORLD_CHARACTERS[key]?.skills?.[id] ?? null);
  if (key !== YOU && !WORLD_CHARACTERS[key]) return "none on record";
  return skills.map((id) => `${SKILLS[id]?.name?.toLowerCase() ?? id.replace(/_/g, " ")} ${rank(id) ?? 0}`).join(", ");
}

// Every post as a card, in the file's order, grouped by who chooses them. Reading this changes nothing.
export function commandView(game, place = "meridian") {
  const model = commandOf(place);
  if (!model) return null;
  const card = (post) => {
    const key = holderKey(game, place, post.id);
    // What the save says about how they came to hold it, as long as it's about whoever holds it now.
    const kept = stateOf(game, place)?.holders?.[post.id] ?? null;
    const held = kept && kept.key === key ? kept : null;
    const chooser = post.chooser.post ? postById(place, post.chooser.post) : null;
    const chooserKey = chooser ? holderKey(game, place, chooser.id) : null;
    return {
      id: post.id,
      title: upperFirst(post.title),
      holder: key ? { key, name: key === YOU ? `You, ${game.name}` : personCalled(game, key), you: key === YOU, sheet: key !== YOU && Boolean(WORLD_CHARACTERS[key]), alive: stillAlive(game, key) } : null,
      since: held?.since ? `Since day ${held.since}${held.by ? `, chosen by ${personCalled(game, held.by)}` : ""}` : "Since before the game began",
      chosenBy: chooser ? `the ${chooser.title}` : `the ${post.chooser.body}`,
      chooser: chooserKey ? (chooserKey === YOU ? "you" : personCalled(game, chooserKey)) : null,
      station: post.roomName,
      skills: skillWords(game, key, post.skills),
      heads: post.heads.length ? listWords(post.heads.map((id) => plural(model.jobs.find((job) => job.id === id)?.title ?? id))) : null,
      watchBill: post.watchBill,
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
  const person = (key) => ({ key, name: key === YOU ? `You, ${game.name}` : personCalled(game, key), you: key === YOU, lost: lostReason(game, place, key), covering: cover[key] ? personCalled(game, cover[key]) : null });
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
  return { place, name: model.name, groups, watchBill };
}
