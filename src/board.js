// What the story board in the game reads and writes: a story's file as boxes and arrows need it, with who reacts to
// it elsewhere and what the checker has to say, and a written scene as its parts and their choices. Saving goes
// through the same readers as the game, so a file that can't be read is never written.

import fs from "node:fs";
import path from "node:path";
import { AXES, CONTEXTS, SKILLS, refreshFactionBeliefs } from "./character-data.js";
import { ABILITIES, ENEMIES, FACTIONS, ITEMS, LOCATIONS, PERKS, STATS, refreshFactions, refreshLocations } from "./data.js";
import { dataDir } from "./paths.js";
import { writtenThreadIds } from "./scene-files.js";
import { parseSceneText } from "./scene-text.js";
import { SCENES_DIR, factsLeft, loadScenes, sceneProblems } from "./scenes.js";
import { compileRequest } from "./requests.js";
import { classKeyOf, classKeys, classNameOf, computerProblems, programOf } from "./computers.js";
import { clockProblems } from "./story-clock.js";
import { notesProblems } from "./story-library.js";
import { SHIP_EFFECT_KEYS } from "./ship.js";
import { COMPUTERS_DIR, COMPUTER_FLAVOR, ENEMIES_DIR, FACTIONS_DIR, ITEMS_DIR, PEOPLE_DIR, PERKS_DIR, PLACES_DIR, SPECIES_DIR, STORIES_DIR, STORY_CLOCK, STORY_FILE_PROBLEMS, WORLD_CHARACTERS, WORLD_COMPUTERS, WORLD_ENEMIES, WORLD_FACTIONS, WORLD_FILE_PROBLEMS, WORLD_ITEMS, WORLD_PERKS, WORLD_PLACES, WORLD_SPECIES, WORLD_THREADS, endingsOf, reloadStories, reloadWorld } from "./world.js";
import { parseStoryText, writeStoryText } from "../public/story-text.js";
import { parseSystemsText, writeSystemsText, KNOWN_SYSTEMS, SYSTEM_TITLES } from "../public/systems-text.js";
import { clearSystems, defaultFileFor, placePeople, staffWords, systemsOf, systemsProblems } from "./systems.js";
import { DUTY_MEASURES, clearCommand, commandOf, commandProblems } from "./command.js";
import { COMMAND_DIR, WORLD_COMMAND, WORLD_LIFE, reloadCommand } from "./world.js";
import { parseCommandText } from "../public/command-text.js";
import { clearLogistics, logisticsOf, logisticsProblems } from "./logistics.js";
import { clearMaps, mapFor, roomsOf } from "./walk.js";
import { clearLife } from "./life.js";
import { clearBodies, healthProblems, woundNames } from "./body.js";
import { clearMedbays, medbayProblems } from "./medbay.js";
import { clearWorkshops } from "./workshop.js";
import { clearRegister } from "./register.js";
import { HEALTH_DIR, WORLD_HEALTH, WOUNDS, reloadHealth } from "./world.js";
import { PARTS, parseHealthText, parseWoundsText } from "../public/health-text.js";
import { LOGISTICS_DIR, SYSTEMS_DEFAULTS, SYSTEMS_DIR, WORLD_LOGISTICS, WORLD_SYSTEMS, reloadLogistics, reloadSystems } from "./world.js";
import { parseLogisticsText } from "../public/logistics-text.js";
import { COMPUTER, ENEMY, FACTION, ITEM, PERK, PERSON, PLACE, PROGRAM, RIG_PART, SPECIES_SPEC, parseWorldText, writeWorldText } from "../public/world-text.js";
import { PROGRAMS_DIR, PROGRAM_KINDS, forgetPrograms, parseProgram, programsNow } from "./programs.js";
import { PART_KINDS, REACHES, RIG_PARTS_DIR, benchToolById, forgetRigParts, parseRigPart, rigPartById, rigPartsNow } from "./rig-parts.js";
import { lootLists } from "./loot.js";

const ID = /^[a-z][a-z0-9_]{1,60}$/;
function checkId(id) {
  if (!ID.test(id ?? "")) throw new Error("A story's id is lowercase letters, digits and underscores.");
  return id;
}
const lineOf = (one) => (typeof one === "string" ? one : `${one.line ? `line ${one.line}: ` : ""}${one.message}`);

// Where the boxes were moved to, by story or thing, kept in the data folder: it's the owner's own tidying, not
// part of the world's files.
const layoutFile = () => path.join(dataDir(), "board-layout.json");
export function readLayout() {
  try {
    return JSON.parse(fs.readFileSync(layoutFile(), "utf8"));
  } catch {
    return {};
  }
}
export function saveLayout(key, positions) {
  if (!/^[a-z]+\/[a-z][a-z0-9_]*$/.test(key ?? "")) throw new Error("The layout's key is the kind and the id, like story/main_two_weeks_of_fuel.");
  const all = readLayout();
  if (positions && typeof positions === "object" && Object.keys(positions).length) all[key] = positions;
  else delete all[key];
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(layoutFile(), JSON.stringify(all));
  return { saved: true };
}

// Every story, for the board's list.
export function boardStories() {
  const written = writtenThreadIds();
  return Object.entries(WORLD_THREADS)
    .map(([id, story]) => ({ id, title: story.title, kind: story.kind, written: written.has(id) }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

// The checker's problems with one story: its file, its notes and its clock.
function problemsFor(id) {
  const known = factsLeft(loadScenes().scenes);
  const mine = (one) => one.startsWith(`${id},`) || one.startsWith(`${id} `) || one.startsWith(`stories/${id}.txt`);
  return [...STORY_FILE_PROBLEMS, ...notesProblems(known), ...clockProblems(known)].filter(mine);
}

// One story as the board shows it: its file and what the game read from it, who reacts to it in other stories,
// what there is to pick from, and the checker's problems with it.
export function boardStory(id) {
  checkId(id);
  const story = WORLD_THREADS[id];
  if (!story) throw new Error(`There's no story called ${id}.`);
  const clock = STORY_CLOCK.threads[id] ?? { stages: [] };
  const file = path.join(STORIES_DIR, `${id}.txt`);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : writeStoryText(story, clock);
  const mentions = (one) => typeof one === "string" && one.includes(`ended ${id}`);
  const next = [];
  for (const [other, thread] of Object.entries(WORLD_THREADS)) {
    if (other === id) continue;
    const theirs = STORY_CLOCK.threads[other] ?? {};
    for (const one of thread.gm?.reacts ?? []) if (mentions(one.to)) next.push({ story: other, title: thread.title, to: one.to, then: one.then, where: "its notes" });
    for (const stage of theirs.stages ?? []) if (mentions(stage.if)) next.push({ story: other, title: thread.title, to: stage.if, then: stage.news, where: `its clock, day ${stage.after}` });
    for (const one of theirs.consequences ?? []) if (mentions(one.of)) next.push({ story: other, title: thread.title, to: one.of, then: one.news, where: `its clock, ${one.after} days later` });
  }
  return {
    id, text, story, clock, next,
    written: writtenThreadIds().has(id),
    places: Object.entries(LOCATIONS).map(([placeId, place]) => ({ id: placeId, name: place.name })),
    facts: [...factsLeft(loadScenes().scenes)].sort(),
    stories: boardStories().map((one) => ({ id: one.id, title: one.title, endings: endingsOf(WORLD_THREADS[one.id]).map((ending) => ending.id) })),
    lists: boardLists(),
    layout: readLayout()[`story/${id}`] ?? {},
    problems: problemsFor(id),
  };
}

// Writes a story's file, if it can be read, and reads every story again so the game plays the new one.
export function saveBoardStory(id, text) {
  checkId(id);
  if (typeof text !== "string" || !text.trim()) throw new Error("There's nothing to save.");
  const { problems } = parseStoryText(text, id);
  if (problems.length) return { saved: false, problems: problems.map(lineOf) };
  fs.mkdirSync(STORIES_DIR, { recursive: true });
  fs.writeFileSync(path.join(STORIES_DIR, `${id}.txt`), text.endsWith("\n") ? text : `${text}\n`);
  reloadStories();
  return { saved: true, problems: problemsFor(id) };
}

// A scene file as the board shows it: the lines before the first part, then each part with its name, the lines
// under it as they are in the file, and what the game reads from them: the choices and where they go, the rules,
// a check or a fight, and whether it ends the scene. Put back together line for line, it's the file again.
export function sceneBoardView(text, name) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  const header = [];
  let current = null;
  lines.forEach((line, index) => {
    const start = line.match(/^==\s*(\S+)\s*$/);
    if (start) {
      current = { name: start[1], line: index + 1, lines: [] };
      blocks.push(current);
    } else if (current) current.lines.push(line);
    else header.push(line);
  });
  const { scene, problems } = parseSceneText(text, name);
  const parts = blocks.map((block) => {
    const part = scene?.parts?.[block.name] ?? {};
    const words = (part.text ?? []).filter((one) => typeof one === "string");
    const first = words.find((one) => !one.startsWith("@") && !one.startsWith("=>")) ?? words[0] ?? "";
    return {
      name: block.name,
      line: block.line,
      raw: block.lines.join("\n"),
      text: first.slice(0, 240),
      choices: (part.choices ?? []).map((one) => ({ say: one.say, to: one.to ?? null, pass: one.pass ?? null, fail: one.fail ?? null, check: one.check ?? null, if: one.if ?? null, line: one.line ?? null })),
      when: (part.when ?? []).map((one) => ({ if: one.if ?? null, to: one.to ?? null, line: one.line ?? null })),
      check: part.check ?? null, pass: part.pass ?? null, fail: part.fail ?? null,
      fight: part.fight ? part.fight.enemy ?? "a fight" : null, won: part.won ?? null, lost: part.lost ?? null, fled: part.fled ?? null, gaveUp: part.gaveUp ?? null, talked: part.talked ?? null,
      end: Boolean(part.end),
      ai: part.ai ?? null,
    };
  });
  return { header: header.join("\n"), parts, problems: (problems ?? []).map(lineOf) };
}

// A story's scene is thread_<id>.txt; a person's written lines are talk_<id>.txt.
const sceneFile = (id, prefix) => path.join(SCENES_DIR, `${prefix}_${checkId(id)}.txt`);
const sceneName = (id, prefix) => `${prefix}_${checkId(id)}`;

export function boardScene(id, prefix = "thread") {
  const file = sceneFile(id, prefix);
  if (!fs.existsSync(file)) throw new Error(prefix === "talk" ? `${WORLD_CHARACTERS[id]?.name ?? id} has no written lines yet: stock lines speak for them.` : `${WORLD_THREADS[id]?.title ?? id} has no written scene yet.`);
  const text = fs.readFileSync(file, "utf8");
  return { id, text, ...checkBoardScene(id, text, prefix) };
}

// The scene as the board would show it after a change, with the checker's problems, without saving anything.
export function checkBoardScene(id, text, prefix = "thread") {
  const name = sceneName(id, prefix);
  const view = sceneBoardView(text, name);
  const parsed = parseSceneText(text, name);
  const problems = parsed.problems?.length ? view.problems : sceneChecked(parsed.scene, id, name, prefix);
  return { ...view, problems };
}
// What the checker says about a scene file: a request's is checked as a conversation, and its lines on top as a request.
function sceneChecked(scene, id, name, prefix) {
  if (prefix !== "request") return sceneProblems(scene, name, { talk: prefix === "talk" });
  return [...sceneProblems(scene, name, { talk: true }), ...compileRequest(id, scene).problems.map((one) => `${name}: ${one}`)];
}

export function saveBoardScene(id, text, prefix = "thread") {
  const file = sceneFile(id, prefix);
  if (typeof text !== "string" || !text.trim()) throw new Error("There's nothing to save.");
  const name = sceneName(id, prefix);
  const parsed = parseSceneText(text, name);
  if (parsed.problems?.length) return { saved: false, problems: parsed.problems.map(lineOf) };
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
  return { saved: true, problems: sceneChecked(parsed.scene, id, name, prefix) };
}

// ---- Requests: world/scenes/request_<kind>.txt ------------------------------------------------------------

// Every kind, read the way the game reads them: its title, its lines on top as written, and how many things the
// checker would like changed. Grouped by the lives it's for.
const requestIds = () => (fs.existsSync(SCENES_DIR) ? fs.readdirSync(SCENES_DIR).map((name) => name.match(/^request_(.+)\.txt$/)?.[1]).filter(Boolean).sort() : []);
function requestKindsView() {
  return requestIds().map((id) => {
    const text = fs.readFileSync(sceneFile(id, "request"), "utf8");
    const { scene, problems } = parseSceneText(text, sceneName(id, "request"));
    const top = scene?.request ?? {};
    const all = problems?.length ? problems : sceneChecked(scene, id, sceneName(id, "request"), "request");
    return { id, title: scene?.title ?? id, group: top.for ? top.for.trim() : "anyone aboard", order: /^an order$/i.test(String(top.as ?? "").trim()), asks: top.asks ?? null, needs: top.needs ?? null, by: top.by ?? null, when: top.when ?? null, problems: all.length };
  });
}
function requestList() {
  return [{ id: "every", name: "Every request", kind: "all of them" }, ...requestKindsView().map((one) => ({ id: one.id, name: one.title, kind: `for ${one.group}` }))];
}
// One kind as the board shows it, the same as a scene's parts, with its title; or, for "every", each kind as a box.
function requestItem(id) {
  if (id === "every") return { id, kind: "request", text: "", value: { overview: true, title: "Every request", kinds: requestKindsView() }, links: {}, lists: boardLists(), layout: readLayout()["request/every"] ?? {}, problems: [] };
  const file = sceneFile(id, "request");
  if (!fs.existsSync(file)) throw new Error(`There's no request called ${id}. A file called request_${id}.txt in world/scenes would be one.`);
  const text = fs.readFileSync(file, "utf8");
  const view = checkBoardScene(id, text, "request");
  const title = parseSceneText(text, sceneName(id, "request")).scene?.title ?? id;
  return { id, kind: "request", text, value: { ...view, title }, links: { written: true }, lists: boardLists(), layout: readLayout()[`request/${id}`] ?? {}, problems: view.problems };
}
function saveRequestItem(id, text) {
  if (id === "every") throw new Error("The list of every request is made from their files: open one of them to change it.");
  return saveBoardScene(id, text, "request");
}

// ---- People, places and species ------------------------------------------------------------------

const WORLD_KINDS = {
  person: { dir: () => PEOPLE_DIR, spec: PERSON, all: WORLD_CHARACTERS, folder: "characters", what: "person" },
  place: { dir: () => PLACES_DIR, spec: PLACE, all: WORLD_PLACES, folder: "places", what: "place" },
  species: { dir: () => SPECIES_DIR, spec: SPECIES_SPEC, all: WORLD_SPECIES, folder: "species", what: "species" },
  enemy: { dir: () => ENEMIES_DIR, spec: ENEMY, all: WORLD_ENEMIES, folder: "enemies", what: "enemy" },
  item: { dir: () => ITEMS_DIR, spec: ITEM, all: WORLD_ITEMS, folder: "items", what: "item" },
  faction: { dir: () => FACTIONS_DIR, spec: FACTION, all: WORLD_FACTIONS, folder: "factions", what: "faction" },
  perk: { dir: () => PERKS_DIR, spec: PERK, all: WORLD_PERKS, folder: "perks", what: "perk" },
  computer: { dir: () => COMPUTERS_DIR, spec: COMPUTER, all: WORLD_COMPUTERS, folder: "computers", what: "computer" },
  // The rig's programs and parts (step 10 of the hacking rework): the game reads them itself, so the board reads
  // their files as it shows them, by the specs in public/world-text.js.
  program: { dir: () => PROGRAMS_DIR, spec: PROGRAM, get all() { return specTable(PROGRAMS_DIR, PROGRAM); }, folder: "programs", what: "program" },
  part: { dir: () => RIG_PARTS_DIR, spec: RIG_PART, get all() { return specTable(RIG_PARTS_DIR, RIG_PART); }, folder: "rig-parts", what: "rig part" },
};
// Every file in a folder, read by a spec, by id.
function specTable(dir, spec) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith(".txt") && !name.startsWith("_"));
  } catch {
    names = [];
  }
  return Object.fromEntries(names.map((name) => [name.slice(0, -4), parseWorldText(fs.readFileSync(path.join(dir, name), "utf8"), spec, name.slice(0, -4)).value]));
}
const kindOf = (kind) => {
  if (!WORLD_KINDS[kind]) throw new Error("The board knows stories, people, places, species, enemies, items, factions, perks, computers, programs, rig parts, systems, logistics, the chain of command and health.");
  return WORLD_KINDS[kind];
};
const talkIds = () => new Set(fs.existsSync(SCENES_DIR) ? fs.readdirSync(SCENES_DIR).map((name) => name.match(/^talk_(.+)\.txt$/)?.[1]).filter(Boolean) : []);

// ---- A place's systems ------------------------------------------------------------------------------

function systemsList() {
  return Object.keys(LOCATIONS).filter((id) => mapFor(id)).map((id) => ({ id, name: LOCATIONS[id].name, kind: WORLD_SYSTEMS[id] ? "its own file" : "by default", written: Boolean(WORLD_SYSTEMS[id]) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const systemsFileProblems = (id) => systemsProblems().filter((one) => one.startsWith(`systems/${id}.txt`) || one.startsWith(`the systems ${id} gets`));

function systemsItem(id) {
  checkId(id);
  const map = mapFor(id);
  if (!map) throw new Error(`There's no map of a place called ${id}.`);
  const file = path.join(SYSTEMS_DIR, `${id}.txt`);
  const own = fs.existsSync(file);
  const text = own ? fs.readFileSync(file, "utf8") : writeSystemsText(defaultFileFor(id, map));
  const { value } = parseSystemsText(text, id);
  const model = systemsOf(id);
  const rooms = Object.values(map.levels).map((level) => ({
    id: level.id,
    name: level.name,
    parts: (model?.partsIn[level.id] ?? []).map((part) => model.parts[part]).filter(Boolean).map((part) => part.name),
    door: Boolean(model?.doors[level.id]),
  }));
  const computers = [
    ...Object.entries(WORLD_COMPUTERS).filter(([, one]) => one.place === id).map(([cid, one]) => ({ id: cid, name: one.name })),
    ...Object.values(map.levels).flatMap((level) => level.things.map((thing) => ({ id: `${thing.name} in ${level.name}`, name: `${thing.name}, in ${level.name}` }))),
  ];
  return {
    id, kind: "systems", text, value,
    // The posts of the place's chain of command come first, so that a guard or an engineer can be whoever holds one.
    links: {
      place: { id, name: LOCATIONS[id].name }, own, rooms,
      people: [
        ...(commandOf(id)?.posts ?? []).map((post) => ({ key: `the ${post.title}`, name: `The ${post.title}, whoever holds the post` })),
        ...(commandOf(id)?.jobs ?? []).map((job) => ({ key: `the ${job.title}s`, name: `The ${job.title}s, whoever does the job` })),
        ...placePeople(id),
      ],
      guards: (model?.guards ?? []).map((ref) => staffWords(id, ref)),
      engineers: (model?.engineers ?? []).map((ref) => staffWords(id, ref)),
    },
    lists: { ...boardLists(), rooms: rooms.map((room) => room.name), partKinds: Object.keys(SYSTEMS_DEFAULTS?.parts ?? {}).filter((one) => one !== "console"), systemNames: KNOWN_SYSTEMS.map((sid) => ({ id: sid, name: SYSTEM_TITLES[sid] })), computers },
    layout: readLayout()[`systems/${id}`] ?? {},
    problems: systemsFileProblems(id),
  };
}

function saveSystems(id, text) {
  checkId(id);
  if (!mapFor(id)) throw new Error(`There's no map of a place called ${id}.`);
  if (typeof text !== "string" || !text.trim()) throw new Error("There's nothing to save.");
  const { problems } = parseSystemsText(text, id);
  if (problems.length) return { saved: false, problems: problems.map(lineOf) };
  fs.mkdirSync(SYSTEMS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SYSTEMS_DIR, `${id}.txt`), text.endsWith("\n") ? text : `${text}\n`);
  // The parts are placed again, the maps made again with them, and people's days told where they can stand.
  reloadSystems();
  clearSystems();
  clearMaps();
  clearLife();
  return { saved: true, problems: systemsFileProblems(id) };
}

// ---- A place's logistics ----------------------------------------------------------------------------

function logisticsList() {
  return Object.keys(WORLD_LOGISTICS).filter((id) => mapFor(id)).map((id) => ({ id, name: LOCATIONS[id]?.name ?? WORLD_LOGISTICS[id].name ?? id, kind: "its own file", written: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const logisticsFileProblems = (id) => logisticsProblems().filter((one) => one.startsWith(`logistics/${id}.txt`));

function logisticsItem(id) {
  checkId(id);
  const map = mapFor(id);
  if (!map) throw new Error(`There's no map of a place called ${id}.`);
  const file = path.join(LOGISTICS_DIR, `${id}.txt`);
  if (!fs.existsSync(file)) throw new Error(`${LOCATIONS[id]?.name ?? id} has no logistics file yet. world/logistics/_how-to-write-logistics.txt says how to write one.`);
  const text = fs.readFileSync(file, "utf8");
  const { value } = parseLogisticsText(text, id);
  const model = logisticsOf(id);
  const rooms = Object.values(map.rooms ?? {}).filter((room) => room.area || !map.levels[room.id]?.areas?.length).map((room) => room.name);
  return {
    id, kind: "logistics", text, value,
    links: {
      place: { id, name: LOCATIONS[id]?.name ?? id },
      stores: (model?.stores ?? []).map((store) => ({ id: store.id, name: store.name, room: store.roomName, placed: store.placed, holds: store.holds, count: store.count })),
    },
    lists: {
      ...boardLists(), rooms, items: Object.entries(WORLD_ITEMS).map(([itemId, one]) => ({ id: itemId, name: one.name })),
      // Who a store's line can name to carry for it: the people doing a job, whoever holds a post, the spare hands.
      carriers: [...(commandOf(id)?.jobs ?? []).map((job) => `the ${job.title}s`), ...(commandOf(id)?.posts ?? []).map((post) => `the ${post.title}`), "the spare hands"],
    },
    layout: readLayout()[`logistics/${id}`] ?? {},
    problems: logisticsFileProblems(id),
  };
}

function saveLogistics(id, text) {
  checkId(id);
  if (!mapFor(id)) throw new Error(`There's no map of a place called ${id}.`);
  if (typeof text !== "string" || !text.trim()) throw new Error("There's nothing to save.");
  const { problems } = parseLogisticsText(text, id);
  if (problems.length) return { saved: false, problems: problems.map(lineOf) };
  fs.mkdirSync(LOGISTICS_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOGISTICS_DIR, `${id}.txt`), text.endsWith("\n") ? text : `${text}\n`);
  // The stores are placed again, with the maps.
  reloadLogistics();
  clearLogistics();
  clearMaps();
  clearLife();
  return { saved: true, problems: logisticsFileProblems(id) };
}

// ---- Bodies and the medbay (health step 9) ---------------------------------------------------------------

// The wounds file, the kinds of wound and old mark everyone's body can have, and each place's health file, its medbay.
function healthList() {
  const list = fs.existsSync(path.join(HEALTH_DIR, "wounds.txt")) ? [{ id: "wounds", name: WOUNDS.name ?? "Wounds and old marks", kind: "the kinds of wound", written: true }] : [];
  for (const [id, one] of Object.entries(WORLD_HEALTH)) list.push({ id, name: LOCATIONS[id]?.name ?? one.name ?? id, kind: "a place's medbay", written: true });
  return list;
}
const healthFileProblems = (id) => [...new Set([...healthProblems(), ...medbayProblems()])].filter((one) => one.startsWith(`health/${id}.txt`));
const healthRead = (id, text) => (id === "wounds" ? parseWoundsText(text) : parseHealthText(text, id));

function healthItem(id) {
  checkId(id);
  const file = path.join(HEALTH_DIR, `${id}.txt`);
  if (!fs.existsSync(file)) throw new Error(`There's no health file called ${id}. world/health/_how-to-write-health.txt says how to write one.`);
  const text = fs.readFileSync(file, "utf8");
  const { value } = healthRead(id, text);
  return {
    id, kind: "health", text, value,
    links: id === "wounds" ? { species: Object.entries(WORLD_SPECIES).map(([speciesId, one]) => ({ id: speciesId, name: one.name })) } : { place: { id, name: LOCATIONS[id]?.name ?? id } },
    lists: { ...boardLists(), parts: PARTS, wounds: woundNames() },
    layout: readLayout()[`health/${id}`] ?? {},
    problems: healthFileProblems(id),
  };
}

// Only a file that's there already is saved, and only once it reads: the kinds of wound, the bodies made from them, the
// medbay, the workshop and the register are all worked out again from it.
function saveHealth(id, text) {
  checkId(id);
  const file = path.join(HEALTH_DIR, `${id}.txt`);
  if (!fs.existsSync(file)) throw new Error(`There's no health file called ${id} to save.`);
  if (typeof text !== "string" || !text.trim()) throw new Error("There's nothing to save.");
  const { problems } = healthRead(id, text);
  if (problems.length) return { saved: false, problems: problems.map(lineOf) };
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
  reloadHealth();
  clearBodies();
  clearMedbays();
  clearWorkshops();
  clearRegister();
  return { saved: true, problems: healthFileProblems(id) };
}

// ---- A place's chain of command --------------------------------------------------------------------

function commandList() {
  return Object.keys(WORLD_COMMAND).map((id) => ({ id, name: LOCATIONS[id]?.name ?? WORLD_COMMAND[id].name ?? id, kind: "its own file", written: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const commandFileProblems = (id) => commandProblems().filter((one) => one.startsWith(`command/${id}.txt`));

// The chain of command as the board shows it: the file and what the game read, who holds each post and who does each job
// when a game begins, and what there is to pick from: the rooms, the people with days there, the skills and the
// measures a post's duty can be marked on.
function commandItem(id) {
  checkId(id);
  const file = path.join(COMMAND_DIR, `${id}.txt`);
  if (!fs.existsSync(file)) throw new Error(`${LOCATIONS[id]?.name ?? id} has no chain of command yet. world/command/_how-to-write-command.txt says how to write one.`);
  const text = fs.readFileSync(file, "utf8");
  const { value } = parseCommandText(text, id);
  const model = commandOf(id);
  const map = mapFor(id);
  const life = WORLD_LIFE[id] ?? {};
  const people = [
    ...Object.keys(life.people ?? {}).map((key) => ({ key, name: WORLD_CHARACTERS[key]?.name ?? key })),
    ...(life.crowd ?? []).flatMap((group) => group.names.map(([name]) => ({ key: name, name }))),
  ];
  return {
    id, kind: "command", text, value,
    links: {
      place: { id, name: LOCATIONS[id]?.name ?? id },
      posts: (model?.posts ?? []).map((post) => ({ id: post.id, title: post.title, room: post.roomName })),
      jobs: (model?.jobs ?? []).map((job) => ({ id: job.id, title: job.title, room: job.roomName })),
    },
    lists: { ...boardLists(), rooms: map ? roomsOf(map).map((room) => room.name) : [], crew: people, measures: Object.keys(DUTY_MEASURES) },
    layout: readLayout()[`command/${id}`] ?? {},
    problems: commandFileProblems(id),
  };
}

function saveCommand(id, text) {
  checkId(id);
  if (typeof text !== "string" || !text.trim()) throw new Error("There's nothing to save.");
  const { problems } = parseCommandText(text, id);
  if (problems.length) return { saved: false, problems: problems.map(lineOf) };
  fs.mkdirSync(COMMAND_DIR, { recursive: true });
  fs.writeFileSync(path.join(COMMAND_DIR, `${id}.txt`), text.endsWith("\n") ? text : `${text}\n`);
  // The chain of command is read again, and people's days with it, since jobs and posts give them their days.
  reloadCommand();
  clearCommand();
  clearLife();
  return { saved: true, problems: commandFileProblems(id) };
}

export function boardWorldList(kind) {
  if (kind === "systems") return systemsList();
  if (kind === "logistics") return logisticsList();
  if (kind === "command") return commandList();
  if (kind === "request") return requestList();
  if (kind === "health") return healthList();
  const { all } = kindOf(kind);
  const written = kind === "person" ? talkIds() : new Set();
  const groupOf = (one) => (kind === "person" || kind === "place" ? one.faction ?? "none" : kind === "enemy" ? one.motive ?? "other" : kind === "item" ? one.type ?? "other" : kind === "perk" ? (one.starting ? "starting" : one.ability ? "with an ability" : "learned") : kind === "computer" ? (LOCATIONS[one.place]?.name ?? one.place ?? "anywhere") : kind === "program" ? PROGRAM_KINDS[one.kind] ?? "other" : kind === "part" ? PART_KINDS[one.kind] ?? "other" : kind);
  const ordered = Object.values(all).some((one) => one.order !== undefined);
  return Object.entries(all)
    .map(([id, one]) => ({ id, name: [one.title, one.name].filter(Boolean).join(" ") || id, kind: groupOf(one), written: written.has(id) }))
    .sort((a, b) => (ordered ? (all[a.id].order ?? 999) - (all[b.id].order ?? 999) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)));
}

// What there is to pick from on the board, by id and name.
function boardLists() {
  const named = (table, label = (one) => one.name) => Object.entries(table).map(([id, one]) => ({ id, name: label(one) ?? id }));
  return {
    people: named(WORLD_CHARACTERS, (one) => [one.title, one.name].filter(Boolean).join(" ")),
    places: named(LOCATIONS),
    species: named(WORLD_SPECIES),
    factions: named(FACTIONS),
    items: named(ITEMS),
    enemies: named(ENEMIES),
    skills: Object.keys(SKILLS),
    attributes: Object.keys(STATS),
    axes: Object.keys(AXES),
    contexts: Object.keys(CONTEXTS),
    arts: [...new Set([...Object.values(WORLD_CHARACTERS).map((one) => one.combat?.art), ...Object.values(WORLD_ENEMIES).map((one) => one.art)].filter(Boolean))].sort(),
    kinds: ["main", "crew", "dilemma", "mystery", "exploration", "survival", "politics", "job", "faction"],
    motives: [...new Set(Object.values(WORLD_ENEMIES).map((one) => one.motive).filter(Boolean))].sort(),
    itemTypes: ["weapon", "armor", "consumable", "gadget", "goods", "story"],
    perks: named(PERKS),
    abilities: named(ABILITIES),
    goods: ["food", "fuel", "medicine", "parts"],
    shipKeys: [...SHIP_EFFECT_KEYS],
    computers: named(WORLD_COMPUTERS),
    classes: classKeys().map((id) => ({ id, name: classNameOf(id) })),
    programKinds: Object.entries(PROGRAM_KINDS).map(([id, name]) => ({ id, name })),
    partKinds: Object.entries(PART_KINDS).map(([id, name]) => ({ id, name })),
    reaches: Object.entries(REACHES).map(([id, name]) => ({ id, name })),
    flavors: Object.keys(COMPUTER_FLAVOR?.motd ?? { default: 1, yours: 1 }),
    // The kinds of container an item can be found in, and how rare it is (src/loot.js).
    ...lootLists(),
  };
}

// A computer's links: where it is, what it reaches and what reaches it, and its programs read the way the game reads them.
function computerLinks(id, value) {
  const node = (cid) => ({ id: cid, name: WORLD_COMPUTERS[cid]?.name ?? cid, className: WORLD_COMPUTERS[cid] ? classNameOf(classKeyOf(WORLD_COMPUTERS[cid].class)) : "unknown" });
  return {
    place: value.place ? { id: value.place, name: LOCATIONS[value.place]?.name ?? value.place } : null,
    className: classNameOf(classKeyOf(value.class)),
    network: (value.network ?? []).map((entry) => ({ ...node(String(entry.name).trim()), about: String(entry.desc ?? "").trim() })),
    reachedFrom: Object.entries(WORLD_COMPUTERS).filter(([cid, c]) => cid !== id && (c.network ?? []).some((entry) => String(entry.name).trim() === id)).map(([cid]) => node(cid)),
    programs: (value.programs ?? []).map(programOf).map((program) => ({ id: program.id, name: program.name, text: program.text, effects: program.effects.length, condition: program.condition, problems: program.problems })),
  };
}
// The checker's problems with one file: how it reads, and for a computer what it says too.
const fileProblems = (kind, folder, id) => [...WORLD_FILE_PROBLEMS, ...(kind === "computer" ? computerProblems() : []), ...(kind === "person" || kind === "species" ? healthProblems() : []), ...(kind === "program" ? programsNow().problems : []), ...(kind === "part" ? rigPartsNow().problems : [])].filter((one) => one.startsWith(`${folder}/${id}.txt`));

// A program's links: where it's found and sold, and what the game makes of it.
function programLinks(value) {
  return {
    kindName: PROGRAM_KINDS[value.kind] ?? value.kind ?? "",
    foundOn: (value.foundOn ?? []).map((cid) => ({ id: cid, name: WORLD_COMPUTERS[cid]?.name ?? cid, known: Boolean(WORLD_COMPUTERS[cid]) })),
    soldAt: value.soldAt ? { id: value.soldAt, name: LOCATIONS[value.soldAt]?.name ?? value.soldAt } : null,
  };
}
// A part's links: its kind, what a link reaches, and what making it at the bench takes, as the game reads it.
function partLinks(id, value) {
  const made = rigPartById(id)?.made ?? null;
  return {
    kindName: PART_KINDS[value.kind] ?? value.kind ?? "",
    reaches: value.reaches ? REACHES[String(value.reaches).toLowerCase()] ?? value.reaches : null,
    made: made ? { needs: made.needs.map((need) => `${need.n} ${need.id.replace(/_/g, " ")}`), engineering: made.engineering, hours: made.hours, tool: made.tool ? benchToolById(made.tool)?.name ?? made.tool : null } : null,
    sockets: rigPartById(id)?.sockets ?? [],
  };
}

// One person, place or species as the board shows it: its file and what the game read, what it's linked to, what
// there is to pick from, and the checker's problems with the file.
export function boardWorldItem(kind, id) {
  if (kind === "systems") return systemsItem(id);
  if (kind === "logistics") return logisticsItem(id);
  if (kind === "command") return commandItem(id);
  if (kind === "request") return requestItem(id);
  if (kind === "health") return healthItem(id);
  const { all, dir, spec, folder } = kindOf(kind);
  checkId(id);
  const value = all[id];
  if (!value) throw new Error(`There's no ${kind} called ${id}.`);
  const file = path.join(dir(), `${id}.txt`);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : writeWorldText(value, spec);
  const stories = (test) => Object.entries(WORLD_THREADS).filter(([, thread]) => test(thread)).map(([storyId, thread]) => ({ id: storyId, title: thread.title }));
  const people = (test) => Object.entries(WORLD_CHARACTERS).filter(([, one]) => test(one)).map(([personId, one]) => ({ id: personId, name: [one.title, one.name].filter(Boolean).join(" "), role: one.role ?? "" }));
  const places = (test) => Object.entries(LOCATIONS).filter(([, place]) => test(place)).map(([placeId, place]) => ({ id: placeId, name: place.name }));
  const enemies = (test) => Object.entries(WORLD_ENEMIES).filter(([, one]) => test(one)).map(([enemyId, one]) => ({ id: enemyId, name: one.name }));
  const factionLink = (factionId) => (factionId ? { id: factionId, name: FACTIONS[factionId]?.name ?? factionId } : null);
  const links = kind === "place"
    ? { people: people((one) => one.location === id || (value.gm?.people ?? []).includes(one.id)), stories: stories((thread) => (thread.places ?? []).includes(id)) }
    : kind === "person"
      ? { place: value.location ? { id: value.location, name: LOCATIONS[value.location]?.name ?? value.location } : null, species: value.species ? { id: value.species, name: WORLD_SPECIES[value.species]?.name ?? value.species } : null, faction: factionLink(value.faction), stories: stories((thread) => (thread.people ?? []).includes(id)), written: talkIds().has(id) }
      : kind === "species"
        ? { people: people((one) => one.species === id) }
        : kind === "enemy"
          ? { faction: factionLink(value.faction), places: places((place) => (place.gm?.enemies ?? []).includes(id)) }
          : kind === "item"
            ? { sold: places((place) => (place.market ?? []).includes(id)), found: places((place) => (place.gm?.items ?? []).includes(id)) }
            : kind === "faction"
              ? { people: people((one) => one.faction === id), places: places((place) => place.faction === id), stories: stories((thread) => (thread.factions ?? []).includes(id)), enemies: enemies((one) => one.faction === id) }
              : kind === "computer"
                ? computerLinks(id, value)
                : kind === "program"
                  ? programLinks(value)
                  : kind === "part"
                    ? partLinks(id, value)
                    : { needs: value.requires ? { id: value.requires, name: PERKS[value.requires]?.name ?? value.requires } : null, neededBy: Object.entries(PERKS).filter(([, perk]) => perk.requires === id).map(([perkId, perk]) => ({ id: perkId, name: perk.name })), ability: value.ability ? { id: value.ability, name: ABILITIES[value.ability]?.name ?? value.ability } : null };
  return { id, kind, text, value, links, lists: boardLists(), layout: readLayout()[`${kind}/${id}`] ?? {}, problems: fileProblems(kind, folder, id) };
}

export function saveBoardWorldItem(kind, id, text) {
  if (kind === "systems") return saveSystems(id, text);
  if (kind === "logistics") return saveLogistics(id, text);
  if (kind === "command") return saveCommand(id, text);
  if (kind === "request") return saveRequestItem(id, text);
  if (kind === "health") return saveHealth(id, text);
  const { dir, spec, folder } = kindOf(kind);
  checkId(id);
  if (typeof text !== "string" || !text.trim()) throw new Error("There's nothing to save.");
  const { problems } = parseWorldText(text, spec, id);
  if (problems.length) return { saved: false, problems: problems.map(lineOf) };
  // A program or a rig part is also read the way the game reads it, and refused if the game couldn't use it.
  const own = kind === "program" ? parseProgram(id, text).problems : kind === "part" ? parseRigPart(id, text).problems : [];
  if (own.length) return { saved: false, problems: own };
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), `${id}.txt`), text.endsWith("\n") ? text : `${text}\n`);
  if (kind === "program" || kind === "part") {
    if (kind === "program") forgetPrograms();
    else forgetRigParts();
    return { saved: true, problems: fileProblems(kind, folder, id) };
  }
  reloadWorld();
  clearBodies();
  refreshLocations();
  refreshFactions();
  refreshFactionBeliefs();
  return { saved: true, problems: fileProblems(kind, folder, id) };
}
