// Everyone's body: six parts, each with the old marks of a life and the wounds of now, and their blood. Nobody's body
// is kept in the save yet. Each one is made up from the game's own seed (game.bodySeed, set when a game begins), so a
// person has the same body all game long and a different one in the next, from their species, age, job and past, and
// from whatever their own file says, which always wins. The kinds of wound and old mark are world/health/wounds.txt,
// a species' parts and what it does differently are its file's Body part, and who starts the game hurt at a place is
// world/health/<place>.txt. The player's body comes from their life story (the marks in src/life-data.js), their
// traits and their careers, and the wounds they have now (their conditions) each sit on a part. For now bodies are only
// shown, on Look, the registry printouts and the inventory's figure: nothing works differently yet. Reading a body
// writes nothing to the save.

import { findCharacter, fullName } from "./campaign.js";
import { CAREERS, FALL_CHOICES, GENERAL_EVENTS, GENERAL_MISHAPS } from "./life-data.js";
import { HEALTH_FILE_PROBLEMS, WORLD_CHARACTERS, WORLD_HEALTH, WORLD_LIFE, WORLD_PLACES, WORLD_SPECIES, WOUNDS } from "./world.js";
import { DEFAULT_HITS, PARTS, PART_WORDS, careOf, readAccidentLine, readAccidents, readBodyLine, readHitLine, readKindLine, readOldMarks, readQueue, readShare, readStartLine, readWeaponLine } from "../public/health-text.js";

const lower = (text) => String(text ?? "").trim().toLowerCase();
const normal = (text) => lower(text).replace(/^(a|an|the)\s+/, "");
const slug = (text) => lower(text).replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const upperFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);

// ---- Rolling the same dice every time -----------------------------------------------------------

// A stream of numbers from 0 to 1 that's the same for the same words.
export function seeded(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
const pick = (roll, list) => list[Math.floor(roll() * list.length)];
export function weighted(roll, pairs) {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  let at = roll() * total;
  for (const [value, w] of pairs) if ((at -= w) < 0) return value;
  return pairs[0][0];
}

// A new game's seed, so that each game's bodies are its own.
export const newBodySeed = () => Math.floor(Math.random() * 4294967296);

// ---- The crowd: who they are, made up from their name ---------------------------------------------

// How common each species is among people with only a name. Their registry printout uses the same.
const SPECIES_SHARE = { human: 55, korrun: 10, veshti: 12, ilari: 9, thessan: 6, synthetic: 8 };

// Someone the game knows only by name: their species, pronouns and age, the same every game, so their printout and
// their body agree. "Old Marta" is old and "Young Tam" is young.
export function crowdWho(name) {
  const roll = seeded(`${lower(name)}|who`);
  const species = weighted(roll, Object.keys(WORLD_SPECIES).map((id) => [id, SPECIES_SHARE[id] ?? 4]));
  const pronouns = pick(roll, ["she/her", "he/him", "they/them"]);
  const words = lower(name);
  const old = /^(an |the )?old\b/.test(words);
  const young = /^(the |a )?(young|little|boy|girl)\b/.test(words);
  const age = species === "thessan" ? 60 + Math.floor(roll() * 140)
    : old ? 60 + Math.floor(roll() * 25)
      : young ? 12 + Math.floor(roll() * 8)
        : 18 + Math.floor(roll() * 50);
  return { species, pronouns, age };
}

// A crowd name usually starts with the job, like Cook Imre or Mess Hand Bao: the words before the last.
export function crowdJob(name) {
  const words = String(name ?? "").trim().split(/\s+/);
  return words.length > 1 ? words.slice(0, -1).join(" ") : "";
}

// ---- The files, read once until they change ---------------------------------------------------------

let kinds = null;
let starts = null;
const made = new Map();
const MOST_MADE = 4000;

// Read again after a file changes.
export function clearBodies() {
  kinds = null;
  starts = null;
  hits = null;
  care = null;
  made.clear();
}

// The kinds of wound and old mark, from world/health/wounds.txt.
function kindsNow() {
  if (kinds) return kinds;
  const problems = [];
  const all = [];
  for (const [section, list] of [["wound", WOUNDS.wounds ?? []], ["mark", WOUNDS.marks ?? []]]) {
    for (const raw of list) {
      const kind = readKindLine(raw.text);
      if (kind.problem) {
        problems.push({ line: raw.line, message: kind.problem });
        continue;
      }
      const id = slug(kind.name);
      const clash = all.find((one) => one.id === id && one.parts.some((part) => kind.parts.includes(part)));
      if (clash) problems.push({ line: raw.line, message: `${kind.name} is written twice for the same part (the other is line ${clash.line})` });
      all.push({ ...kind, id, section, line: raw.line, key: normal(kind.name) });
    }
  }
  const old = readOldMarks(WOUNDS.oldMarks ?? "one every 20 years after 20, at most 3");
  kinds = { all, problems, oldMarks: old.problem ? { every: 20, after: 20, most: 3 } : old, rough: WOUNDS.rough ?? [] };
  return kinds;
}

// A kind the words name, on one of these parts: its name alone, or its name, a comma and more words ("deep cut, still
// raw"), so "a burn scar along one jaw" is someone's own words and not a burn.
function findKind(words, parts = null) {
  const text = normal(words);
  let best = null;
  for (const kind of kindsNow().all) {
    if (!(text === kind.key || text.startsWith(`${kind.key},`))) continue;
    if (parts && !parts.some((part) => kind.parts.includes(part))) continue;
    if (!best || kind.key.length > best.key.length) best = kind;
  }
  return best;
}
const RULE_KEYS = ["serious", "fightAttack", "goesBad", "limps", "hidden", "artificial", "notRandom", "never", "worsens", "noHand", "noStand", "bleeds", "heals", "treated", "treatment", "out", "harder", "after"];
const rulesOf = (kind) => Object.fromEntries(RULE_KEYS.filter((key) => kind[key] !== undefined).map((key) => [key, kind[key]]));

// A species' body: its parts' hit weights, and what it does differently.
export function speciesBody(id) {
  const body = WORLD_SPECIES[id]?.body ?? {};
  return {
    hits: { ...DEFAULT_HITS, ...(body.hits ?? {}) },
    breaks: body.breaks ?? 1,
    heals: body.heals ?? 1,
    bleeds: body.bleeds !== false,
    ownMarks: body.ownMarks === true,
    mendedBy: body.mendedBy ?? "the nurses",
  };
}

// Whoever "At the start" names in a place's health file, by who they are: a person with a file by their id, anyone else
// by the place and their name.
function startsNow() {
  if (starts) return starts;
  starts = new Map();
  for (const [place, file] of Object.entries(WORLD_HEALTH)) {
    for (const raw of file.start ?? []) {
      const line = readStartLine(raw.text);
      if (line.problem) continue;
      const key = keyForName(place, line.who);
      if (!starts.has(key)) starts.set(key, []);
      starts.get(key).push(line);
    }
  }
  return starts;
}
function personByWords(words) {
  const want = lower(words);
  if (WORLD_CHARACTERS[want]) return want;
  for (const [id, person] of Object.entries(WORLD_CHARACTERS)) {
    if ([person.name, fullName(person), ...(person.aliases ?? [])].some((name) => lower(name) === want)) return id;
  }
  return null;
}
const crowdKey = (place, name) => `crowd:${place}:${lower(name)}`;
function keyForName(place, words) {
  const id = personByWords(words);
  return id ? `id:${id}` : crowdKey(place, words);
}

// ---- Making a body up -------------------------------------------------------------------------------

const sideOf = (part) => (part.startsWith("right") ? "right" : part.startsWith("left") ? "left" : "");
const fill = (words, part) => String(words).replaceAll("{part}", PART_WORDS[part]).replaceAll("{side}", sideOf(part)).replace(/\s{2,}/g, " ").trim();
const pickPart = (roll, parts, hits) => (parts.length === 1 ? parts[0] : weighted(roll, parts.map((part) => [part, Math.max(0.01, hits[part] ?? 1)])));

// A mark from a line someone wrote: their file, a place's health file, a life story's marks or a trait's.
function markFrom(line, roll, hits, from) {
  const part = pickPart(roll, line.parts, hits);
  const kind = findKind(line.words, [part]);
  const exact = kind && normal(line.words) === kind.key;
  return { part, kind: kind?.id ?? null, section: kind?.section ?? "mark", words: fill(exact ? kind.words : line.words, part), template: exact ? kind.words : line.words, rules: { ...(kind ? rulesOf(kind) : {}), ...line.rules }, from };
}
function markOfKind(kind, part, from) {
  return { part, kind: kind.id, section: kind.section, words: fill(kind.words, part), template: kind.words, rules: rulesOf(kind), from };
}

function fitsSpecies(kind, id, species) {
  if (kind.only) return kind.only.includes(id);
  if (species.ownMarks) return false;
  return !kind.not?.includes(id);
}

// The old marks of a life, from its years and its work: rough work makes them come twice as often, and a kind that's
// likelier in the work is four times as likely. What's written for them counts towards the most anyone carries.
function madeUpMarks(roll, { species: id, age, job }, written) {
  const { all, oldMarks, rough } = kindsNow();
  const species = speciesBody(id);
  const work = lower(job);
  const inWork = (word) => Boolean(work) && new RegExp(`\\b${escaped(word)}`).test(work);
  const years = Math.max(0, (Number(age) || 0) - oldMarks.after);
  const often = rough.some(inWork) ? 2 : 1;
  const pool = all.filter((kind) => kind.section === "mark" && !kind.notRandom && fitsSpecies(kind, id, species));
  let count = Math.floor((years / Math.max(1, oldMarks.every)) * often + roll());
  count = Math.max(0, Math.min(count, oldMarks.most - written, pool.length));
  const marks = [];
  const left = [...pool];
  for (let i = 0; i < count; i++) {
    const kind = weighted(roll, left.map((one) => [one, (one.likelier ?? []).some(inWork) ? 4 : 1]));
    left.splice(left.indexOf(kind), 1);
    marks.push(markOfKind(kind, pickPart(roll, kind.parts, species.hits), "made up"));
  }
  return marks;
}

// A body from who someone is: written lines first, then made-up marks unless a line says nothing else.
function makeBody(seed, key, who, lines) {
  const roll = seeded(`${seed}|${key}`);
  const species = speciesBody(who.species);
  const marks = [];
  let more = true;
  for (const line of lines) {
    if (line.nothingElse) more = false;
    else if (!line.problem) marks.push(markFrom(line, roll, species.hits, line.from ?? "written"));
  }
  if (more) marks.push(...madeUpMarks(roll, who, marks.length));
  return { species: who.species, age: who.age ?? null, marks, blood: 100 };
}

// Someone with a file, or someone in the crowd at a place, by the key the room knows them by. Null for nobody.
// The same person always gets the same body in the same game.
export function bodyOf(game, who) {
  if (who === "you") return playerBody(game);
  const seed = game.bodySeed ?? 1;
  const person = who.id ? findCharacter(game.campaign, who.id) : null;
  if (who.id && !person) return null;
  const key = person ? `id:${person.id}` : crowdKey(who.place ?? game.location, who.name);
  const cached = made.get(`${seed}|${key}`);
  if (cached) return withWounds(game, key, cached);
  let body;
  if (person) {
    const roll = seeded(`${seed}|${key}|age`);
    const age = Number.isFinite(person.age) ? person.age : 25 + Math.floor(roll() * 30);
    const lines = [...(person.body ?? []).map((text) => ({ ...readBodyLine(text), from: "file" })), ...(startsNow().get(key) ?? []).map((line) => ({ ...line, from: "start" }))];
    body = makeBody(seed, key, { species: person.species ?? "human", age, job: [person.title, person.role].filter(Boolean).join(" ") }, lines);
  } else {
    if (!who.name) return null;
    body = makeBody(seed, key, { ...crowdWho(who.name), job: crowdJob(who.name) }, (startsNow().get(key) ?? []).map((line) => ({ ...line, from: "start" })));
  }
  if (made.size >= MOST_MADE) made.clear();
  made.set(`${seed}|${key}`, body);
  return withWounds(game, key, body);
}

// ---- Wounds of now: kept in the save, and lived with on the clock ------------------------------------

// The player's are game.wounds, with their blood in game.blood; anyone else's are game.bodies[key] = { wounds, blood }, by
// the key their body is made from. A wound is { part, kind, words, at, until, dressed, dressedAt, infected }: the clock's
// hours it came at and goes at (null for never), whether and when it was dressed or splinted, and whether it went bad.
// It heals at its own pace: its kind's days untreated, the file's "left alone" times its treated days for one that only
// heals once treated, its treated days once it's dressed, and longer for a species whose wounds heal slowly. A wound
// that bleeds lowers their blood until it's dressed, and blood comes back once nothing bleeds. Someone dresses a wound
// that isn't serious themselves after a while; a serious one waits for someone else (the player's medkit, and the
// medbay in a later step). A wound that can go bad goes bad when it's left undressed long enough. Nobody dies of any
// of it yet: bleeding stops at the file's line, for now.
const nowOf = (game) => game.clock?.hours ?? 0;
const lasts = (wound, now) => wound.until === null || wound.until === undefined || wound.until > now;
const storeOf = (game, key) => (key === "you" ? game.wounds : game.bodies?.[key]?.wounds) ?? [];
export const woundsNow = (game, key) => storeOf(game, key).filter((wound) => lasts(wound, nowOf(game)));
export const bloodOf = (game, key) => (key === "you" ? game.blood : game.bodies?.[key]?.blood) ?? 100;

// The lines at the top of the wounds file about living with wounds, read once until it changes.
let care = null;
const careNow = () => (care ??= careOf(WOUNDS.care ?? {}));

// A kind by its id, on that part if there's one for it.
export function kindOf(id, part) {
  const all = kindsNow().all;
  return all.find((kind) => kind.id === id && kind.parts.includes(part)) ?? all.find((kind) => kind.id === id) ?? null;
}
const rulesOfWound = (wound) => {
  const kind = kindOf(wound.kind, wound.part);
  return kind ? rulesOf(kind) : {};
};

// Whose body a key is, for how fast their wounds heal.
function speciesOfKey(game, key) {
  if (key === "you") return game.character?.species ?? "human";
  if (key.startsWith("id:")) return findCharacter(game.campaign, key.slice(3))?.species ?? "human";
  return crowdWho(key.split(":").slice(2).join(":")).species;
}

// How many hours a wound of a kind lasts left to itself, at the usual pace: its days untreated, or the file's "left alone"
// times its treated days for one that only heals once treated, or the hours it keeps them out cold.
function hoursOf(kind, roll) {
  if (kind.out) return kind.out[0] + Math.floor(roll() * (kind.out[1] - kind.out[0] + 1));
  if (kind.never) return null;
  const days = kind.heals ?? (kind.treated ? kind.treated * careNow()["left alone"].factor : null);
  return days === null ? null : days * 24;
}
// A wound of a kind on a part, before it's kept: how many hours it will last at the usual pace.
export const newWound = (kind, part, roll = Math.random) => ({ part, kind: kind.id, words: fill(kind.words, part), hours: hoursOf(kind, roll) });
const stamped = (game, key, wound, at = nowOf(game)) => {
  const heals = speciesBody(speciesOfKey(game, key)).heals || 1;
  return { part: wound.part, kind: wound.kind, words: wound.words, at, until: wound.hours === null || wound.hours === undefined ? null : at + wound.hours / heals };
};

export function addWounds(game, key, list, at = undefined) {
  if (!key || !list.length) return;
  const kept = list.map((wound) => stamped(game, key, wound, at ?? nowOf(game)));
  if (key === "you") {
    game.wounds = [...(game.wounds ?? []), ...kept];
    return;
  }
  game.bodies ??= {};
  const held = game.bodies[key] ?? { wounds: [] };
  game.bodies[key] = { ...held, wounds: [...held.wounds, ...kept] };
}

// What a wound needs: dressing for one that bleeds, can go bad, or heals faster once dressed; a splint for a bone.
const treatable = (wound) => {
  const rules = rulesOfWound(wound);
  return !wound.dressed && Boolean(rules.bleeds || rules.goesBad || rules.treated);
};
const bleedingNow = (wound) => !wound.dressed && Boolean(rulesOfWound(wound).bleeds);
const treatedWord = (wound) => (rulesOfWound(wound).treatment === "splinted" ? "splinted" : "dressed");

// Dressed or splinted at a time: it stops bleeding, won't go bad, and from then heals at its treated pace.
function dress(game, key, wound, at) {
  const kind = kindOf(wound.kind, wound.part);
  wound.dressed = true;
  wound.dressedAt = at;
  if (kind?.treated) {
    const heals = speciesBody(speciesOfKey(game, key)).heals || 1;
    const by = at + (kind.treated * 24) / heals;
    wound.until = wound.until === null || wound.until === undefined ? by : Math.min(wound.until, by);
  }
}

// The player dresses or splints their worst wounds with a medkit, as many as it says: what bleeds first, then what's
// serious, then the rest. It returns what was done, in words.
export function dressWounds(game, key, many = 1) {
  const now = nowOf(game);
  const rank = (wound) => (bleedingNow(wound) ? 2 : 0) + (rulesOfWound(wound).serious ? 1 : 0);
  const waiting = storeOf(game, key).filter((wound) => lasts(wound, now) && treatable(wound)).sort((a, b) => rank(b) - rank(a));
  const done = waiting.slice(0, many);
  for (const wound of done) dress(game, key, wound, now);
  return done.map((wound) => `${treatedWord(wound)} ${wound.words.replace(/^an? /, "the ")}`);
}

// Over the hours just gone, for everyone with wounds: whoever can dresses what isn't serious, wounds bleed until
// they're dressed, what's left undressed too long goes bad, blood comes back once nothing bleeds, and what's healed is
// gone. speed is how much faster the player's own heal, resting or with no medicine aboard. It returns what happened to
// the player's, for the story to say.
export function passWounds(game, hours, { speed = 1 } = {}) {
  const to = nowOf(game);
  const from = to - hours;
  const told = { healed: [], dressed: [], bad: [] };
  const rules = careNow();
  const infected = kindsNow().all.find((kind) => kind.id === "infected");
  const live = (key, held) => {
    const wounds = held.wounds ?? [];
    if (!wounds.length && (held.blood ?? 100) >= 100) return null;
    const added = [];
    let bled = 0;
    let stopped = from;
    for (const wound of wounds) {
      const kind = kindOf(wound.kind, wound.part);
      const own = kind ? rulesOf(kind) : {};
      // Someone dresses what isn't serious themselves, once a little time has gone by.
      const selfAt = wound.at + rules["they dress their own"].hours;
      if (!wound.dressed && !own.serious && treatable(wound) && selfAt <= to) {
        dress(game, key, wound, Math.max(wound.at, selfAt));
        if (key === "you") told.dressed.push(wound.words);
      }
      // A wound bleeds from when it came until it's dressed.
      if (own.bleeds) {
        const start = Math.max(from, wound.at);
        const end = Math.min(to, wound.dressed ? wound.dressedAt : to);
        if (end > start) bled += own.bleeds * (end - start);
        stopped = Math.max(stopped, wound.dressed ? Math.min(to, wound.dressedAt) : to);
      }
      // Left undressed too long, it goes bad.
      const badAt = wound.at + (infected?.after ?? 2) * 24;
      if (own.goesBad && infected && !wound.infected && !wound.dressed && badAt <= to) {
        wound.infected = true;
        added.push(stamped(game, key, newWound(infected, wound.part), badAt));
        if (key === "you") told.bad.push(wound.words);
      }
      // The player's own heal faster resting, and slower with no medicine aboard.
      if (key === "you" && speed !== 1 && wound.until !== null && wound.until !== undefined) wound.until -= hours * (speed - 1);
    }
    const all = [...wounds, ...added];
    const left = all.filter((wound) => lasts(wound, to));
    if (key === "you") told.healed.push(...all.filter((wound) => !lasts(wound, to)).map((wound) => wound.words));
    // Blood goes with the bleeding, never under the file's line for now, and comes back once nothing bleeds.
    const floor = rules["bleeding stops at"].floor;
    let blood = held.blood ?? 100;
    if (bled) blood = Math.max(Math.min(blood, floor), blood - bled);
    const quiet = left.some(bleedingNow) ? 0 : Math.max(0, to - stopped);
    blood = Math.min(100, blood + rules["blood comes back"].perHour * quiet);
    return { wounds: left, blood: Math.round(blood * 10) / 10 };
  };
  const mine = live("you", { wounds: game.wounds ?? [], blood: game.blood ?? 100 });
  game.wounds = mine?.wounds ?? [];
  if (mine && mine.blood < 100) game.blood = mine.blood;
  else delete game.blood;
  for (const [key, held] of Object.entries(game.bodies ?? {})) {
    const now = live(key, held);
    if (now && (now.wounds.length || now.blood < 100)) game.bodies[key] = { ...held, ...now };
    else delete game.bodies[key];
  }
  return told;
}

// ---- What wounds do, besides the fight -------------------------------------------------------------

// How fast someone walks, as a share of the usual: with a leg they can't stand on, hobbling; with a limp, slower.
export function paceOf(body) {
  if (!body) return 1;
  const rules = careNow();
  if (body.marks.some((mark) => mark.section === "wound" && mark.rules.noStand)) return rules["on a leg they can't stand on"].pace;
  if (statusOf(body) === "Walks with a limp") return rules["with a limp"].pace;
  return 1;
}

// The same, from a fighter's wounds alone: a wound on a leg is a limp.
export function woundsPace(wounds = []) {
  const rules = careNow();
  if (wounds.some((wound) => rulesOfWound(wound).noStand)) return rules["on a leg they can't stand on"].pace;
  if (wounds.some((wound) => wound.part.endsWith("_leg") || rulesOfWound(wound).limps)) return rules["with a limp"].pace;
  return 1;
}

// A person's body key at a place, from the name or id their day knows them by.
const keyAt = (place, who) => (who === "you" ? "you" : WORLD_CHARACTERS[who] ? `id:${who}` : crowdKey(place, who));
// Whether someone has a hand free to carry or work with: no wound that leaves a hand no use, kept or written for them.
export function handsFree(game, place, who) {
  const key = keyAt(place, who);
  if (woundsNow(game, key).some((wound) => rulesOfWound(wound).noHand)) return false;
  return !(startsNow().get(key) ?? []).some((line) => findKind(line.words, line.parts)?.noHand);
}
// What the player's wounds and blood do to their numbers: less in a fight, and checks harder for a knock on the head,
// a wound gone bad, or too little blood.
export function woundEffects(game) {
  const wounds = woundsNow(game, "you");
  const attack = fightAttackOf(wounds);
  const low = careNow()["low on blood"];
  const harder = fightRules(wounds).reduce((sum, rules) => sum + (rules.harder ?? 0), 0) + (bloodOf(game, "you") < low.under ? low.harder : 0);
  if (!attack && !harder) return null;
  return { ...(attack ? { attack } : {}), ...(harder ? { checks: -2 * harder } : {}) };
}
// How much stress the player's wounds add over a day: more for a serious one.
export function painADay(game) {
  const pain = careNow().pain;
  return woundsNow(game, "you").reduce((sum, wound) => sum + (rulesOfWound(wound).serious ? pain.serious : pain.wound), 0);
}

// ---- The morning queue, and accidents at work -------------------------------------------------------------

// Whoever at a place is hurt and on their feet, by the key their day knows them by: someone with a wound kept, or
// written for them, that isn't a leg they can't stand on.
export function hurtAt(game, place) {
  const keys = new Set();
  const life = WORLD_LIFE[place] ?? {};
  const people = [...Object.keys(life.people ?? {}), ...(life.crowd ?? []).flatMap((group) => group.names.map(([name]) => name))];
  for (const who of people) {
    const key = keyAt(place, who);
    const kept = woundsNow(game, key);
    const written = (startsNow().get(key) ?? []).filter((line) => findKind(line.words, line.parts)?.section === "wound");
    if (!kept.length && !written.length) continue;
    if (kept.some((wound) => rulesOfWound(wound).noStand) || written.some((line) => findKind(line.words, line.parts)?.noStand)) continue;
    keys.add(who);
  }
  return keys;
}
// The place's morning queue, as the health file has it: when, and the spot or group of spots in its life file.
export function queueOf(place) {
  const text = WORLD_HEALTH[place]?.queue;
  if (!text) return null;
  const read = readQueue(text);
  return read.problem ? null : read;
}

// Each day, now and then, someone at a place with accidents in its health file hurts themselves at their work: more
// often in rough work, and the wound likelier for the work, from the file's Accidents. It happened during the day just
// ended. Once a day, the same in every game with the same seed.
export function accidentsDay(game, day) {
  if ((game.accidentDay ?? -Infinity) >= day) return;
  game.accidentDay = day;
  const { rough } = kindsNow();
  const kinds = (WOUNDS.accidents ?? []).map((raw) => readAccidentLine(raw.text)).filter((one) => !one.problem);
  if (!kinds.length) return;
  for (const [place, file] of Object.entries(WORLD_HEALTH)) {
    if (!file.accidents) continue;
    const rates = readAccidents(file.accidents);
    if (rates.problem) continue;
    const life = WORLD_LIFE[place] ?? {};
    const people = [...Object.keys(life.people ?? {}).map((id) => ({ who: id, job: [WORLD_CHARACTERS[id]?.title, WORLD_CHARACTERS[id]?.role].filter(Boolean).join(" ") })),
      ...(life.crowd ?? []).flatMap((group) => group.names.map(([name]) => ({ who: name, job: crowdJob(name) })))];
    for (const { who, job } of people) {
      const roll = seeded(`${game.bodySeed ?? 1}|accident|${day}|${place}|${who}`);
      const work = lower(job);
      const inWork = (word) => Boolean(work) && new RegExp(`\\b${escaped(word)}`).test(work);
      if (roll() >= (rough.some(inWork) ? rates.rough : rates.anyone)) continue;
      const key = keyAt(place, who);
      const species = speciesOfKey(game, key);
      const part = weighted(roll, PARTS.map((one) => [one, speciesBody(species).hits[one] ?? 0]));
      const pickKind = weighted(roll, kinds.map((one) => [one, one.likelier.some(inWork) ? 4 : 1]));
      const kind = findKind(pickKind.name, [part]);
      if (!kind || !fitsBody(kind, species)) continue;
      addWounds(game, key, [newWound(kind, part, roll)], day * 24 - 2 - roll() * 10);
    }
  }
}

// A body as it is now: what it was made with, and the wounds and blood it has.
function withWounds(game, key, body) {
  const now = woundsNow(game, key);
  const blood = bloodOf(game, key);
  if (!now.length && blood >= 100) return body;
  return { ...body, blood, marks: [...body.marks, ...now.map((wound) => markOfWound(game, wound))] };
}
// A wound kept, as a mark: its words say whether it's still bleeding, or dressed or splinted.
const markOfWound = (game, wound) => ({
  part: wound.part, kind: wound.kind, section: "wound", template: null, rules: rulesOfWound(wound), from: "now",
  words: bleedingNow(wound) ? `${wound.words}, bleeding` : wound.dressed ? `${wound.words}, ${treatedWord(wound)}` : wound.words,
  ...(wound.until === null || wound.until === undefined ? {} : { hoursLeft: Math.max(0, wound.until - nowOf(game)) }),
});

// ---- Hits: where they land and what they leave ---------------------------------------------------------

let hits = null;
function hitsNow() {
  if (hits) return hits;
  const problems = [];
  const weapons = [];
  let rest = "blunt";
  for (const raw of WOUNDS.weapons ?? []) {
    const line = readWeaponLine(raw.text);
    if (line.problem) problems.push({ line: raw.line, message: line.problem });
    else if (line.rest) rest = line.kind;
    else weapons.push(line);
  }
  const lines = [];
  for (const raw of WOUNDS.hits ?? []) {
    const line = readHitLine(raw.text);
    if (line.problem) {
      problems.push({ line: raw.line, message: line.problem });
      continue;
    }
    lines.push({ ...line, line: raw.line });
  }
  const light = readShare(WOUNDS.light ?? "20% of their health");
  const hard = readShare(WOUNDS.hard ?? "40% of their health, or a hard hit", true);
  hits = { weapons, rest, lines, light: light.problem ? 0.2 : light.share, hard: hard.problem ? 0.4 : hard.share, critical: hard.problem ? true : hard.critical, problems };
  return hits;
}

// The kind of hit a weapon makes, by the words in its name: a plasma cutter burns, a sidearm shoots, bare hands are blunt.
export function weaponKind(name) {
  const { weapons, rest } = hitsNow();
  const words = lower(name);
  for (const line of weapons) if (line.words.some((word) => new RegExp(`\\b${escaped(word)}`).test(words))) return line.kind;
  return rest;
}

const fitsBody = (kind, species) => (kind.only ? kind.only.includes(species) : !kind.not?.includes(species));

// Where a hit lands, and the wound it leaves: a part at random by the body's sizes, never chosen by anyone, and a wound
// by how much of their health it took, what it was with, and whether it put them down. Null for a machine, which has no
// body and breaks as it always has.
export function landHit(body, { weapon = null, damage = 0, maxHp = 1, critical = false, down = false, roll = Math.random } = {}) {
  if (!body) return null;
  const species = speciesBody(body.species);
  const part = weighted(roll, PARTS.map((one) => [one, Math.max(0, species.hits[one] ?? 0)]));
  const rules = hitsNow();
  const kind = weaponKind(weapon ?? "bare hands");
  const matches = (line) => line.kind === kind || line.kind === "anything";
  const line = rules.lines.find((one) => one.species.includes(body.species) && matches(one)) ?? rules.lines.find((one) => !one.species.length && matches(one));
  const share = damage / Math.max(1, maxHp);
  const hard = share >= rules.hard || (critical && rules.critical);
  const pick = (options) => {
    for (const option of options) {
      if (!option.parts.includes(part)) continue;
      const found = findKind(option.name, [part]);
      if (found && fitsBody(found, body.species)) return found;
    }
    return null;
  };
  let wound = null;
  if (line) {
    if (down) wound = pick(line.down);
    if (!wound && hard) wound = pick(line.hard);
    if (!wound && line.light && (hard || down || share >= rules.light)) wound = pick([{ name: line.light, parts: PARTS }]);
  }
  return { part, where: PART_WORDS[part], wound: wound ? newWound(wound, part, roll) : null };
}

// ---- Fighters ----------------------------------------------------------------------------------------

// A fighter's body and the wounds they come into the fight with: someone with a file by their id, someone with only a
// name by their place and name, and an enemy that's nobody in particular a body for the fight alone, which isn't kept.
// A machine has none.
export function fighterBody(game, { id = null, name = null, place = null, machine = false, species = null } = {}) {
  if (machine) return { body: null, wounds: [] };
  const person = id ? findCharacter(game.campaign, id) : null;
  const key = person ? `id:${person.id}` : name && place ? crowdKey(place, name) : null;
  const kind = person ? person.species ?? "human" : name && place ? crowdWho(name).species : species ?? "human";
  return { body: { key, species: kind }, wounds: key ? woundsNow(game, key).map((wound) => ({ ...wound })) : [] };
}

const fightRules = (wounds = []) => wounds.map(rulesOfWound);
// What their wounds take off their attack in a fight.
export const fightAttackOf = (wounds = []) => fightRules(wounds).reduce((sum, rules) => sum + (rules.fightAttack ?? 0), 0);
// A wound that won't let them stand: they can't walk in a fight in the room, or run from one.
export const legWound = (wounds = []) => wounds.find((wound) => rulesOfWound(wound).noStand) ?? null;
// How someone down is: out cold, unable to stand, or just unable to get up.
export function downState(wounds = []) {
  const rules = fightRules(wounds);
  if (rules.some((one) => one.out)) return "out cold";
  if (rules.some((one) => one.noStand)) return "can't stand";
  return "can't get up";
}
// The wounds that matter in a fight, for the fighters' cards and the room's panel.
export const fightWords = (wounds = []) => wounds.filter((wound) => {
  const rules = rulesOfWound(wound);
  return rules.serious || rules.fightAttack || rules.noStand || rules.out;
}).map((wound) => wound.words);

// ---- The player's own body ----------------------------------------------------------------------

// Traits that are something on the body, as body lines.
const TRAIT_MARKS = {
  one_eyed: "head: an eye gone",
  old_wound: "the chest or a limb: old wound",
  cyber_arm: "an arm: cybernetic arm",
  cyber_eye: "head: cybernetic eye",
};
// The player's wounds of now, from their conditions, as body lines. An infection sits on another wound, or the chest.
const CONDITION_WOUNDS = {
  concussed: "head: concussion",
  cracked_ribs: "chest: cracked ribs",
  broken_arm: "an arm: broken bone",
  deep_burn: "any part: deep burn",
};
const BLOOD_LOST = 55;

// Every outcome in a life story that leaves a mark, with its line in the biography as a pattern: {name} is whoever
// it was, which the biography has filled in.
let past = null;
function pastOutcomes() {
  if (past) return past;
  past = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.marks) && typeof value.bio === "string") {
      past.push({ outcome: value, pattern: new RegExp(escaped(value.bio).replaceAll("\\{name\\}", ".+?")) });
    }
    for (const inner of Object.values(value)) if (inner && typeof inner === "object") visit(inner);
  };
  visit([CAREERS, GENERAL_EVENTS, GENERAL_MISHAPS, FALL_CHOICES]);
  return past;
}
// The marks a life story's outcomes and the player's traits leave, as body lines.
export function pastLines(character, traits = []) {
  const lines = [];
  const covered = new Set();
  for (const entry of character?.biography ?? []) {
    for (const { outcome, pattern } of pastOutcomes()) {
      if (!pattern.test(entry)) continue;
      for (const text of outcome.marks) lines.push({ ...readBodyLine(text), from: "past" });
      for (const trait of outcome.traits ?? []) covered.add(trait);
    }
  }
  for (const trait of traits) if (TRAIT_MARKS[trait] && !covered.has(trait)) lines.push({ ...readBodyLine(TRAIT_MARKS[trait]), from: "past" });
  return lines;
}

function playerBody(game) {
  const seed = game.bodySeed ?? 1;
  const character = game.character ?? {};
  const species = character.species ?? "human";
  const job = [...(character.careers ?? []).map((one) => one.name), character.background].filter(Boolean).join(" ");
  const body = makeBody(seed, "you", { species, age: character.age ?? 30, job }, pastLines(character, game.traits ?? []));
  const sizes = speciesBody(species).hits;
  for (const condition of game.conditions ?? []) {
    const text = CONDITION_WOUNDS[condition.id];
    if (!text) continue;
    body.marks.push({ ...markFrom(readBodyLine(text), seeded(`${seed}|you|${condition.id}`), sizes, "now"), hoursLeft: condition.hoursLeft });
  }
  // The wounds fights have left.
  body.marks.push(...woundsNow(game, "you").map((wound) => markOfWound(game, wound)));
  if ((game.conditions ?? []).some((c) => c.id === "infected")) {
    const kind = findKind("infected");
    const under = body.marks.find((mark) => mark.section === "wound");
    if (kind) body.marks.push({ ...markOfKind(kind, under?.part ?? "chest", "now"), hoursLeft: game.conditions.find((c) => c.id === "infected").hoursLeft });
  }
  body.blood = Math.min(bloodOf(game, "you"), (game.conditions ?? []).some((c) => c.id === "blood_loss") ? BLOOD_LOST : 100);
  return body;
}

// ---- How a body looks ---------------------------------------------------------------------------------

const RANK = { ok: 0, old: 1, artificial: 2, hurt: 3, bad: 4 };
export const stateOf = (mark) => (mark.section === "wound" ? (mark.rules.serious ? "bad" : "hurt") : mark.rules.artificial ? "artificial" : "old");
const fraction = (n) => ({ 0.25: "a quarter", 0.5: "half", 0.75: "three quarters", 1.5: "one and a half times", 2: "twice", 3: "three times" })[n] ?? `${Math.round(n * 100)} in a hundred`;

// Walking, or not.
export function statusOf(body) {
  const wounds = body.marks.filter((mark) => mark.section === "wound");
  if (wounds.some((mark) => mark.rules.out)) return "Out cold";
  if (wounds.some((mark) => mark.rules.noStand)) return "Can barely walk";
  if (body.marks.some((mark) => mark.rules.limps) || wounds.some((mark) => mark.part.endsWith("_leg"))) return "Walks with a limp";
  return "Walks normally";
}

// What a species does differently, in words.
function speciesNotes(id) {
  const species = speciesBody(id);
  const notes = [];
  if (species.breaks !== 1) notes.push(`Their bones break ${fraction(species.breaks)} as often as most.`);
  if (species.heals !== 1) notes.push(`Their wounds heal at ${fraction(species.heals)} the pace.`);
  if (!species.bleeds) notes.push("They don't bleed.");
  if (species.mendedBy !== "the nurses") notes.push(`Mended by ${species.mendedBy}, not the nurses.`);
  return notes;
}

const ORDER = (a, b) => RANK[stateOf(b)] - RANK[stateOf(a)] || PARTS.indexOf(a.part) - PARTS.indexOf(b.part);

// "the chest, both arms and left leg": parts in order, a pair of arms or legs as both.
function partsInWords(parts) {
  const have = new Set(parts);
  const out = [];
  for (const part of PARTS) {
    if (!have.has(part)) continue;
    const pair = part.endsWith("_arm") ? ["right_arm", "left_arm", "both arms"] : part.endsWith("_leg") ? ["right_leg", "left_leg", "both legs"] : null;
    if (pair && have.has(pair[0]) && have.has(pair[1])) {
      if (part === pair[0]) out.push(pair[2]);
    } else out.push(PART_WORDS[part]);
  }
  return out.length > 1 ? `${out.slice(0, -1).join(", ")} and ${out.at(-1)}` : out[0];
}

// The marks as lines to read, worst first: the same mark on several parts is one line, "old burn scars on the chest,
// both arms and left leg", so a long life doesn't fill the printout.
function markLines(marks) {
  const lines = [];
  for (const mark of [...marks].sort(ORDER)) {
    const joins = mark.template?.includes("{part}") && !mark.template.includes("{side}") && mark.hoursLeft === undefined;
    const same = joins && lines.find((line) => line.template === mark.template && line.state === stateOf(mark) && line.hidden === Boolean(mark.rules.hidden));
    if (same) same.parts.push(mark.part);
    else lines.push({ template: joins ? mark.template : null, words: mark.words, parts: [mark.part], state: stateOf(mark), hidden: Boolean(mark.rules.hidden), hoursLeft: mark.hoursLeft });
  }
  return lines.map((line) => ({
    words: upperFirst(line.parts.length > 1 ? line.template.replaceAll("{part}", partsInWords(line.parts)).replace(/\s{2,}/g, " ").trim() : line.words),
    state: line.state,
    ...(line.hidden ? { hidden: true } : {}),
    ...(line.hoursLeft !== undefined ? { hoursLeft: Math.ceil(line.hoursLeft) } : {}),
  }));
}

// For the printouts and the inventory: each part's state, every mark on it, the marks as lines to read, walking,
// blood, and the species' notes.
export function bodyView(body) {
  if (!body) return null;
  const parts = Object.fromEntries(PARTS.map((part) => [part, "ok"]));
  for (const mark of body.marks) if (RANK[stateOf(mark)] > RANK[parts[mark.part]]) parts[mark.part] = stateOf(mark);
  const bleeds = speciesBody(body.species).bleeds;
  return {
    species: WORLD_SPECIES[body.species]?.name ?? body.species,
    status: statusOf(body),
    blood: bleeds ? body.blood : null,
    parts,
    marks: [...body.marks].sort(ORDER).map((mark) => ({
      part: mark.part,
      label: upperFirst(PART_WORDS[mark.part]),
      words: upperFirst(mark.words),
      state: stateOf(mark),
      ...(mark.rules.hidden ? { hidden: true } : {}),
      ...(mark.hoursLeft !== undefined ? { hoursLeft: Math.ceil(mark.hoursLeft) } : {}),
    })),
    lines: markLines(body.marks),
    notes: speciesNotes(body.species),
  };
}

// For Look: what anyone can see at a glance, worst first, three lines at most, with how they walk if it isn't normally.
// The old marks a person's own file gives them are left out, since Look shows their appearance, which says them.
export function lookLine(body) {
  if (!body) return null;
  const seen = markLines(body.marks.filter((mark) => !mark.rules.hidden && !(mark.from === "file" && mark.section === "mark"))).slice(0, 3).map((line) => `${line.words}.`);
  const status = statusOf(body);
  const words = [status === "Walks normally" ? null : `${status}.`, ...seen].filter(Boolean);
  return words.length ? words.join(" ") : null;
}

// ---- What's wrong with the files, for npm run check-story ------------------------------------------------

export function healthProblems() {
  const out = [...HEALTH_FILE_PROBLEMS];
  const { all, problems } = kindsNow();
  for (const one of problems) out.push(`health/wounds.txt (line ${one.line}): ${one.message}`);
  for (const kind of all) {
    for (const id of [...(kind.only ?? []), ...(kind.not ?? [])]) {
      if (!WORLD_SPECIES[id]) out.push(`health/wounds.txt (line ${kind.line}): ${kind.name} names ${id}, which isn't one of the species in world/species`);
    }
  }
  // The hits: kinds the weapons make, wounds the file has, species there are.
  const rules = hitsNow();
  for (const one of rules.problems) out.push(`health/wounds.txt (line ${one.line}): ${one.message}`);
  const kindsOfHit = new Set([...rules.weapons.map((one) => one.kind), rules.rest, "anything"]);
  for (const line of rules.lines) {
    const where = `health/wounds.txt (line ${line.line})`;
    if (!kindsOfHit.has(line.kind)) out.push(`${where}: ${line.kind} isn't a kind of hit under Weapons, or anything`);
    for (const id of line.species) if (!WORLD_SPECIES[id]) out.push(`${where}: ${id} isn't one of the species in world/species`);
    for (const option of [...(line.light ? [{ name: line.light, parts: PARTS }] : []), ...line.hard, ...line.down]) {
      if (!all.some((kind) => kind.section === "wound" && kind.key === normal(option.name))) out.push(`${where}: ${option.name} isn't one of the wounds under Wounds`);
      else if (!all.some((kind) => kind.section === "wound" && kind.key === normal(option.name) && kind.parts.some((part) => option.parts.includes(part)))) out.push(`${where}: ${option.name} can't be on the parts it's given`);
    }
  }
  for (const raw of WOUNDS.accidents ?? []) {
    const line = readAccidentLine(raw.text);
    if (line.problem) out.push(`health/wounds.txt (line ${raw.line}): ${line.problem}`);
    else if (!all.some((kind) => kind.section === "wound" && kind.key === normal(line.name))) out.push(`health/wounds.txt (line ${raw.line}): ${line.name} isn't one of the wounds under Wounds`);
  }
  for (const [place, file] of Object.entries(WORLD_HEALTH)) {
    if (!WORLD_PLACES[place]) out.push(`health/${place}.txt: there's no place called ${place} in world/places`);
    const queue = file.queue ? readQueue(file.queue) : null;
    if (queue && !queue.problem && !WORLD_LIFE[place]?.spots?.[queue.at] && !WORLD_LIFE[place]?.groups?.[queue.at]) out.push(`health/${place}.txt: the morning queue is at ${queue.at}, which isn't a spot or a group of spots in world/life/${place}.json`);
    const crowd = new Set((WORLD_LIFE[place]?.crowd ?? []).flatMap((group) => group.names.map(([name]) => lower(name))));
    for (const raw of file.start ?? []) {
      const line = readStartLine(raw.text);
      if (line.problem) {
        out.push(`health/${place}.txt (line ${raw.line}): ${line.problem}`);
        continue;
      }
      if (!personByWords(line.who) && !crowd.has(lower(line.who))) out.push(`health/${place}.txt (line ${raw.line}): nobody called ${line.who} has a day at ${place} in world/life, or a file in world/characters`);
    }
  }
  for (const [id, species] of Object.entries(WORLD_SPECIES)) {
    const body = species.body ?? {};
    for (const [part, weight] of Object.entries(body.hits ?? {})) {
      if (!PARTS.includes(part)) out.push(`species/${id}.txt: its Body part's hit names ${part.replace(/_/g, " ")}, and the parts are head, chest, right arm, left arm, right leg and left leg`);
      else if (!(weight >= 0)) out.push(`species/${id}.txt: its Body part's hit gives the ${part.replace(/_/g, " ")} ${weight}, and it should be 0 or more`);
    }
    for (const [key, words] of [["breaks", "bones break"], ["heals", "wounds heal"]]) {
      if (body[key] !== undefined && body[key] !== null && !(body[key] > 0)) out.push(`species/${id}.txt: its Body part's ${words} is ${body[key]}, and it should be more than 0 (0.5 is half as often)`);
    }
    if (body.mendedBy !== undefined && !["the nurses", "the techs"].includes(lower(body.mendedBy))) out.push(`species/${id}.txt: its Body part's mended by is ${body.mendedBy}, and it should be the nurses or the techs`);
  }
  for (const [id, person] of Object.entries(WORLD_CHARACTERS)) {
    for (const text of person.body ?? []) {
      const line = readBodyLine(text);
      if (line.problem) out.push(`characters/${id}.txt: in its Body part, ${line.problem}`);
    }
  }
  return out;
}
export const healthFiles = () => Object.keys(WORLD_HEALTH).length;
