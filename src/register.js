// The register (health step 8). The Meridian carries nine hundred, and most of them have no day of their own in the life
// file: they're on the register instead, each made up from the game's own seed (a name, an age, a species and the
// quarters they sleep in, the same every time it's read), so the save keeps none of it but who's sick and who's dead.
// Once a day, illness moves among them: each of the wounds file's illnesses is caught now and then, more often among
// people sharing quarters with someone who has it, and more often again when the ship's hungry (half or reduced rations,
// or a kettle that ran dry). A serious case gets a dose from the medbay's cabinet when there's one to be had, and gets
// over it in fewer days; one left without, after so many days, dies one time in so many. The people with days of their
// own catch the same illnesses, as wounds on their bodies, and the same rounds dose theirs, at midnight, from a crate
// the rounds carry of their own, so that a long wait comes out the same as many short ones. The ship's
// health settles lower the more of the ship is sick, the deaths of hunger and sickness are people on the register with
// names, and the medbay's records terminal lists everyone.
//
// game.register = { size, day, sick: { [i]: { kind, since, ends, dosed, fated } }, dead: { [i]: { day, cause } },
// crew: { [body key]: { [illness]: the hour it ends } } }.
// Reading any of it writes nothing.

import { SPECIES_SHARE, catchIllness, crowdWho, hungerFactor, illnessKinds, illnessesOf, keyAt, mendedByTechs, seeded, weighted, woundsNow } from "./body.js";
import { findCharacter } from "./campaign.js";
import { NAMES } from "./character-data.js";
import { tallyDuty } from "./command.js";
import { deathRulesOf, die } from "./death.js";
import { mealsOfDay } from "./logistics.js";
import { doseOnRounds, roundsDose } from "./medbay.js";
import { aboardShip } from "./role.js";
import { WORLD_CHARACTERS, WORLD_HEALTH, WORLD_LIFE, WORLD_SPECIES } from "./world.js";
import { MEDBAY_KEYS } from "../public/health-text.js";

const SHIP = "meridian";
const nowOf = (game) => game.clock?.hours ?? 0;
const dayOf = (game) => Math.floor(nowOf(game) / 24);

// ---- Who's on it ----------------------------------------------------------------------------------------

// The people at the Meridian with days of their own in the life file: everyone aboard who isn't on the register.
export function lifePeople() {
  const life = WORLD_LIFE[SHIP] ?? {};
  return [...Object.keys(life.people ?? {}), ...(life.crowd ?? []).flatMap((group) => group.names.map(([name]) => name))];
}
// The quarters the register sleeps in, with their weights, from the ship's health file.
function quartersOf() {
  const text = WORLD_HEALTH[SHIP]?.quarters;
  const read = text ? MEDBAY_KEYS.quarters.read(text) : null;
  return read && !read.problem ? read.rooms : [];
}
// A new game's register: as many as are aboard less the people with days of their own. An older save gets one sized
// to who's aboard now. Nothing at a place without the quarters line.
export function startRegister(game) {
  if (game.register || !quartersOf().length || !game.ship) return;
  game.register = { size: Math.max(0, (game.ship.aboard ?? 0) - lifePeople().length), day: dayOf(game), sick: {}, dead: {} };
}

// Names: a first name and a last name from the game's own list, never one of its whole names, each pair once.
const FIRSTS = NAMES.map((name) => name.split(" ")[0]);
const LASTS = NAMES.map((name) => name.split(" ").slice(1).join(" "));
const PAIRS = FIRSTS.length * (LASTS.length - 1);
function nameOfIndex(seed, i) {
  // A step through the pairs that visits each once, from a start of the game's own.
  const q = (i * 37 + (seed % PAIRS)) % PAIRS;
  const a = Math.floor(q / (LASTS.length - 1));
  const b0 = q % (LASTS.length - 1);
  const b = b0 >= a ? b0 + 1 : b0;
  return `${FIRSTS[a]} ${LASTS[b]}${i >= PAIRS ? ` ${Math.floor(i / PAIRS) + 1}` : ""}`;
}
const made = new Map();
// Everyone on the register, made up from the seed: the same list every time for the same game.
export function registerPeople(game) {
  const reg = game.register;
  if (!reg) return [];
  const seed = game.bodySeed ?? 1;
  const key = `${seed}|${reg.size}`;
  if (made.has(key)) return made.get(key);
  const quarters = quartersOf();
  const species = Object.keys(WORLD_SPECIES).map((id) => [id, SPECIES_SHARE[id] ?? 4]);
  const people = [];
  for (let i = 0; i < reg.size; i += 1) {
    const roll = seeded(`${seed}|register|${i}`);
    const r = roll();
    const age = r < 0.12 ? 3 + Math.floor(roll() * 13) : r < 0.88 ? 16 + Math.floor(roll() * 48) : 64 + Math.floor(roll() * 26);
    const kind = weighted(roll, species);
    const quarter = quarters.length ? weighted(roll, quarters.map((one) => [one.room, one.weight])) : "";
    people.push({ i, name: nameOfIndex(seed, i), age: kind === "thessan" ? age * 2 : age, species: kind, quarters: quarter });
  }
  if (made.size > 20) made.clear();
  made.set(key, people);
  return people;
}

// ---- A day of illness -----------------------------------------------------------------------------------

// Whether a synthetic, who catches nothing.
const isSynthetic = (species) => species === "synthetic";
// The share of yesterday's sittings that found the kettle empty.
function missedShare(game, day) {
  const meals = mealsOfDay(game, SHIP, day);
  return meals && meals.served + meals.missed > 0 ? meals.missed / (meals.served + meals.missed) : 0;
}

// The day just ended, once: the sick get better, are dosed or die; illness is caught and spreads, on the register and
// among the people with days of their own. It returns lines for the story, while the player's aboard.
export function registerDay(game, day) {
  const reg = game.register;
  if (!reg || (reg.day ?? -1) >= day) return [];
  reg.day = day;
  const kinds = illnessKinds();
  if (!kinds.length) return [];
  const people = registerPeople(game);
  const seed = game.bodySeed ?? 1;
  const hunger = game.ship?.out?.food ? hungerFactor("half", 1) : hungerFactor(game.ship?.rations, missedShare(game, day - 1));
  const died = [];
  // The sick: a dose for a serious case when there's one to be had, better when their days are up, and dead when a
  // serious case has gone undosed too long and it was going to kill them.
  for (const [i, s] of Object.entries(reg.sick)) {
    const kind = kinds.find((one) => one.id === s.kind);
    if (!kind || reg.dead[i]) {
      delete reg.sick[i];
      continue;
    }
    if (kind.serious && !s.dosed && kind.dosed !== null && roundsDose(game, SHIP, day * 24)) {
      s.dosed = day;
      s.ends = Math.min(s.ends, day + kind.dosed);
    }
    if (day >= s.ends) {
      delete reg.sick[i];
      continue;
    }
    if (kind.serious && !s.dosed && kind.kills !== null && s.fated && day - s.since >= kind.kills) died.push([Number(i), kind]);
  }
  // The people with days of their own, and the player while they're aboard, the same: the rounds dose a serious illness
  // caught before midnight, and one that's gone undosed too long, and was going to, kills. Here, once a day, rather than
  // in the medbay's own hours, so that a long wait and a short one come out the same.
  const midnight = day * 24;
  const notes = [];
  const crew = crewKeys(game);
  reg.crew = Object.fromEntries(Object.entries(reg.crew ?? {}).map(([key, ill]) => [key, Object.fromEntries(Object.entries(ill).filter(([, until]) => until > midnight))]).filter(([, ill]) => Object.keys(ill).length));
  for (const key of crew) {
    if (game.dead?.[key] || (key !== "you" && !game.bodies?.[key])) continue;
    for (const wound of illnessesOf(game, key)) {
      const kind = kinds.find((one) => one.id === wound.kind);
      if (!kind?.serious || wound.dressed || wound.at >= midnight || (wound.until !== null && wound.until !== undefined && wound.until <= midnight)) continue;
      if (kind.dosed !== null && doseOnRounds(game, SHIP, key, wound, midnight)) {
        reg.crew[key] = { ...(reg.crew[key] ?? {}), [wound.kind]: wound.until };
        continue;
      }
      const fated = kind.killsOneIn <= 1 || seeded(`${seed}|${key}|${wound.at}|kills`)() < 1 / kind.killsOneIn;
      if (key !== "you" && kind.kills !== null && fated && midnight >= wound.at + kind.kills * 24) {
        notes.push(...die(game, key, { at: midnight, cause: "illness", part: wound.part, kind: wound.kind }));
        break;
      }
    }
  }
  // Who's sick where, for how it spreads.
  const sickIn = Object.fromEntries(kinds.map((kind) => [kind.id, {}]));
  for (const [i, s] of Object.entries(reg.sick)) {
    const q = people[i]?.quarters;
    if (q && sickIn[s.kind]) sickIn[s.kind][q] = (sickIn[s.kind][q] ?? 0) + 1;
  }
  // New cases: one roll a person a day for each illness, so that it comes out the same however the time is cut up.
  for (const kind of kinds) {
    const roll = seeded(`${seed}|ill|${day}|${kind.id}`);
    const worse = kind.hungry ? hunger : 1;
    for (const person of people) {
      const r = roll();
      if (reg.dead[person.i] || reg.sick[person.i] || isSynthetic(person.species)) continue;
      const near = sickIn[kind.id][person.quarters] ?? 0;
      if (r >= (kind.catches + kind.spreads * near) * worse) continue;
      reg.sick[person.i] = { kind: kind.id, since: day, ends: day + kind.days, ...(kind.killsOneIn > 1 ? { fated: roll() < 1 / kind.killsOneIn } : { fated: true }) };
      if (kind.serious && kind.dosed !== null && roundsDose(game, SHIP, day * 24)) Object.assign(reg.sick[person.i], { dosed: day, ends: day + kind.dosed });
    }
    // The people with days of their own catch it too, as a wound on their body, from the ship's sick at large; not
    // while they still have it, by when it was to end, kept here, so that it doesn't matter whether the wound's been
    // cleared away yet.
    const lifeRoll = seeded(`${seed}|ill-life|${day}|${kind.id}`);
    const share = Object.values(sickIn[kind.id]).reduce((sum, n) => sum + n, 0) / Math.max(1, quartersOf().length);
    const at = midnight + 6;
    const chance = (kind.catches + kind.spreads * share) * worse;
    // The roll first: it's nearly always no, and working out someone's body isn't free.
    const catches = (key, r) => {
      if (r >= chance || game.dead?.[key] || (reg.crew[key]?.[kind.id] ?? -Infinity) > at || mendedByTechs(game, key)) return;
      if (!catchIllness(game, key, kind.id, at)) return;
      const wound = illnessesOf(game, key).find((one) => one.kind === kind.id && one.at === at);
      reg.crew[key] = { ...(reg.crew[key] ?? {}), [kind.id]: wound?.until ?? at + kind.days * 24 };
    };
    for (const key of crew) if (key !== "you") catches(key, lifeRoll());
    const mine = lifeRoll();
    if (crew.includes("you")) catches("you", mine);
  }
  for (const [i, kind] of died) notes.push(...registerDies(game, i, `of ${kind.words}, with no medicine to dose it`, day));
  return notes;
}
// The body keys of the people with days of their own aboard, in the life file's order, and the player's while they're
// aboard her.
function crewKeys(game) {
  const keys = lifePeople().map((who) => keyAt(SHIP, who)).filter(Boolean);
  return aboardShip(game) && game.location === SHIP ? [...keys, "you"] : keys;
}

// Someone on the register dies, of a cause, on a day: one less aboard, the morale the health file says, the duty's
// deaths, and their name with the rest. It returns a line for the story when the player's aboard.
export function registerDies(game, i, cause, day = dayOf(game), { quiet = false } = {}) {
  const reg = game.register;
  if (!reg || reg.dead[i] || i >= reg.size) return [];
  reg.dead = { ...reg.dead, [i]: { day, cause } };
  delete reg.sick[i];
  if (game.ship) {
    game.ship.aboard = Math.max(0, (game.ship.aboard ?? 0) - 1);
    const cost = quiet ? 0 : deathRulesOf(SHIP)?.registerMorale ?? 0;
    if (cost) game.ship.morale = Math.max(0, Math.min(100, (game.ship.morale ?? 50) - cost));
  }
  tallyDuty(game, SHIP, day, { deaths: 1 });
  const person = registerPeople(game)[i];
  return !quiet && aboardShip(game) && person ? [`[SHIP] Word from the medbay: ${person.name}, from ${person.quarters.replace(/^The /, "the ")}, has died ${cause}.`] : [];
}

// So many die of hunger and the sickness that comes with it, the worst off first: the seriously sick, then the oldest.
// It returns how many died.
export function registerStarves(game, n, day = dayOf(game)) {
  const reg = game.register;
  if (!reg || n <= 0) return 0;
  const kinds = illnessKinds();
  const alive = registerPeople(game).filter((person) => !reg.dead[person.i]);
  const rank = (person) => (kinds.find((one) => one.id === reg.sick[person.i]?.kind)?.serious ? 1000 : reg.sick[person.i] ? 500 : 0) + person.age;
  const worst = alive.sort((a, b) => rank(b) - rank(a) || a.i - b.i).slice(0, n);
  for (const person of worst) registerDies(game, person.i, "of hunger, and the sickness that comes with it", day, { quiet: true });
  return worst.length;
}

// ---- What the rest of the game reads -------------------------------------------------------------------

// How sick the register is, for where the ship's health settles: a point off for each in a hundred sick, three for
// each in a hundred seriously sick.
export function illnessPenalty(game) {
  const reg = game.register;
  if (!reg) return 0;
  const kinds = illnessKinds();
  const alive = reg.size - Object.keys(reg.dead).length;
  if (alive <= 0) return 0;
  let weight = 0;
  for (const s of Object.values(reg.sick)) weight += kinds.find((one) => one.id === s.kind)?.serious ? 3 : 1;
  return Math.round((100 * weight) / alive);
}
// Who's on the register's dead, as the names have them.
export function registerDead(game) {
  const reg = game.register;
  if (!reg) return [];
  const people = registerPeople(game);
  return Object.entries(reg.dead).map(([i, one]) => ({ who: null, name: people[i]?.name ?? `Number ${i}`, place: SHIP, at: one.day * 24 + 23, day: one.day, cause: one.cause }));
}
// The medbay's rounds, for the Ship menu: how many are sick, how many seriously, how many of those have been dosed, and
// how many have died this week.
export function roundsView(game) {
  const reg = game.register;
  if (!reg) return null;
  const kinds = illnessKinds();
  const sick = Object.values(reg.sick);
  const serious = sick.filter((s) => kinds.find((one) => one.id === s.kind)?.serious);
  const today = dayOf(game);
  return {
    aboard: reg.size - Object.keys(reg.dead).length,
    sick: sick.length,
    serious: serious.length,
    dosed: serious.filter((s) => s.dosed !== undefined).length,
    died: Object.values(reg.dead).filter((one) => today - one.day <= 7).length,
    byKind: kinds.map((kind) => ({ name: kind.name, n: sick.filter((s) => s.kind === kind.id).length })).filter((one) => one.n),
  };
}

// Everyone aboard, for the records terminal: the register and the people with days of their own, with how each of
// them is. Rows are [name, age, species, quarters, how they are, an order for how they are]. Reading it writes nothing.
const STATE_ORDER = { dead: 0, "laid up": 1, serious: 2, sick: 3, well: 4 };
export function registerTable(game) {
  const reg = game.register;
  if (!reg) return null;
  const kinds = illnessKinds();
  const speciesName = (id) => WORLD_SPECIES[id]?.name ?? id;
  const rows = [];
  for (const person of registerPeople(game)) {
    const dead = reg.dead[person.i];
    const s = reg.sick[person.i];
    const kind = s ? kinds.find((one) => one.id === s.kind) : null;
    const state = dead ? "dead" : kind?.serious ? "serious" : kind ? "sick" : "well";
    const words = dead ? `died on day ${dead.day + 1}, ${dead.cause}` : kind ? `${kind.words}${kind.serious ? (s.dosed !== undefined ? ", dosed" : ", no dose yet") : ""}` : "well";
    rows.push([person.name, person.age, speciesName(person.species), person.quarters.replace(/^The /, ""), words, STATE_ORDER[state]]);
  }
  for (const who of lifePeople()) {
    const key = keyAt(SHIP, who);
    const file = WORLD_CHARACTERS[who];
    const person = file ? findCharacter(game.campaign, who) : null;
    const name = person?.name ?? file?.name ?? who;
    const made = file ? { age: file.age ?? "", species: file.species ?? "human" } : crowdWho(who);
    const dead = game.dead?.[key];
    const down = game.down?.[key];
    const ill = woundsNow(game, key).find((wound) => kinds.some((one) => one.id === wound.kind));
    const illKind = ill ? kinds.find((one) => one.id === ill.kind) : null;
    const state = dead ? "dead" : down?.bed ? "laid up" : illKind?.serious ? "serious" : ill ? "sick" : "well";
    const words = dead ? `died on day ${dead.day + 1}, ${dead.cause}` : down?.bed ? "laid up in the medbay" : ill ? `${ill.words}${ill.dressed ? ", dosed" : ""}` : "well";
    rows.push([name, made.age ?? "", speciesName(made.species ?? "human"), "crew", words, STATE_ORDER[state]]);
  }
  const count = (n) => rows.filter((row) => row[5] === n).length;
  return {
    columns: ["Name", "Age", "Species", "Quarters", "How they are"],
    rows,
    summary: `${rows.length - count(0)} aboard: ${count(4)} well, ${count(3)} sick, ${count(2)} seriously, ${count(1)} laid up. ${count(0)} dead.`,
  };
}
