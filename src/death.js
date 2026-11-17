// When help doesn't come (health step 6). Someone whose blood runs out, or whose wound gone bad is left undressed too
// long, dies of it, at a place with a medbay that could have reached them in time (src/body.js decides when). Here is
// what a death does: it goes in game.dead, their fact goes on the record, a story person's contact is dead and the
// stories waiting on them fail, they leave their post and the watch bill, one less is aboard, morale drops by the health
// file's cost, the doctor's and the captain's duty count it, and their name goes up on the place's names, which the
// player can read. Whoever died lying down stays lying there under a blanket until someone carries them to the room
// the health file lays the dead out in (src/medbay.js), and then nobody sees them again. The player's own death is
// src/ending.js: it ends the game, and none of this follows it.
//
// game.dead holds them by body key: { who, name, place, at, day, cause, part, room }. A new object each time someone
// dies, so that whatever's remembered about the living knows it's out of date. Reading any of it writes nothing.

import { deathOf, illnessKinds } from "./body.js";
import { registerDead } from "./register.js";
import { findCharacter } from "./campaign.js";
import { afterDeath, tallyDuty } from "./command.js";
import { recordFact } from "./record.js";
import { aboardShip } from "./role.js";
import { mapFor, roomsOf } from "./walk.js";
import { WORLD_CHARACTERS, WORLD_HEALTH, WORLD_LIFE } from "./world.js";
import { MEDBAY_KEYS } from "../public/health-text.js";
import { slugOf } from "../public/command-text.js";

const lower = (text) => String(text ?? "").trim().toLowerCase();
const nowOf = (game) => game.clock?.hours ?? 0;
const PART_WORDS = { head: "head", chest: "chest", right_arm: "right arm", left_arm: "left arm", right_leg: "right leg", left_leg: "left leg" };
// The ship's own place, whose aboard count and morale a death there touches.
const SHIP = "meridian";

// What src/tools.js does with a story person's contact when they die: mark them dead and fail the stories waiting on
// them. It tells this module so, since the rules can't load the tools. Without it, the contact is only marked dead.
let contactDied = null;
export const tellContactDied = (fn) => {
  contactDied = fn;
};

// ---- The health file's lines ---------------------------------------------------------------------------

// Where the dead are laid out (a room id), the thing their names go up on (its name), and the morale a death costs.
export function deathRulesOf(place) {
  const file = WORLD_HEALTH[place];
  if (!file) return null;
  const read = (key) => (file[MEDBAY_KEYS[key].path] ? MEDBAY_KEYS[key].read(file[MEDBAY_KEYS[key].path]) : null);
  const laidOut = read("the dead are laid out in");
  const names = read("the names go up on");
  const cost = read("a death aboard costs");
  const map = mapFor(place);
  const room = laidOut && !laidOut.problem && map ? roomsOf(map).find((one) => lower(one.name) === lower(laidOut.room) || one.id === lower(laidOut.room)) ?? null : null;
  return {
    room: room?.id ?? null,
    names: names && !names.problem ? names.thing : null,
    morale: cost && !cost.problem ? cost.morale : 0,
    registerMorale: cost && !cost.problem ? cost.register ?? cost.morale : 0,
  };
}

// What's wrong with those lines, for npm run check-story.
export function deathProblems() {
  const out = [];
  for (const [place, file] of Object.entries(WORLD_HEALTH)) {
    const where = `health/${place}.txt`;
    const rules = deathRulesOf(place);
    if (file.laidOut && !rules.room) out.push(`${where}: the dead are laid out in ${file.laidOut}, which isn't a room at ${place}`);
    if (file.names) {
      const things = Object.values(mapFor(place)?.levels ?? {}).flatMap((level) => level.things ?? []);
      if (!things.some((thing) => lower(thing.name) === lower(file.names))) out.push(`${where}: the names go up on ${file.names}, which isn't a thing in any of ${place}'s rooms`);
    }
    if (file.deathCost && MEDBAY_KEYS["a death aboard costs"].read(file.deathCost).problem) out.push(`${where}: a death aboard costs ${MEDBAY_KEYS["a death aboard costs"].read(file.deathCost).problem}`);
  }
  return out;
}

// ---- Dying ---------------------------------------------------------------------------------------------

// The key someone's day knows them by, and what they're called, from their body key. Someone with no day anywhere, such
// as a mutineer beaten in a battle, goes by the name kept on their body's record or where they lie (src/aftermath.js).
function whoOf(key, game) {
  if (key.startsWith("id:")) return { who: key.slice(3), place: null };
  const [, place, ...rest] = key.split(":");
  const name = rest.join(":");
  for (const group of WORLD_LIFE[place]?.crowd ?? []) for (const [one] of group.names) if (lower(one) === name) return { who: one, place };
  return { who: game?.bodies?.[key]?.name ?? game?.down?.[key]?.who ?? name, place };
}
const nameOf = (game, who) => {
  const person = findCharacter(game.campaign, who) ?? (WORLD_CHARACTERS[who] ? { name: WORLD_CHARACTERS[who].name } : null);
  return person && !person.crowd ? person.name : who;
};
// The fact a death leaves on the record: the person's id, or their crowd name, and _died.
export const deathFact = (who) => `${(WORLD_CHARACTERS[who] ? who : slugOf(who)).slice(0, 34)}_died`;

// How they died, in words: bled to death where they fell, on a cot, or on the medbay's floor; or of a wound gone bad.
function causeWords(died, down) {
  if (died.cause === "infection") return `of the wound in the ${PART_WORDS[died.part] ?? "body"} gone bad`;
  if (died.cause === "illness") return `of ${illnessWords(died.kind)}, with nobody to dose it`;
  if (down?.bed?.startsWith("@")) return "bled to death on the medbay's floor";
  if (down?.bed) return "bled to death on a cot in the medbay";
  if (down?.carriedBy === "you") return "bled to death in your arms";
  if (down?.carriedBy) return "bled to death on the way to help";
  if (down) return "bled to death where they fell";
  return "bled to death";
}

// Everyone src/body.js has marked as having died who hasn't been seen to yet: each one dies now, with all that follows.
// It returns lines for the story.
export function settleDeaths(game) {
  const notes = [];
  for (const [key, held] of Object.entries(game.bodies ?? {})) {
    if (!held.died || deathOf(game, key)) continue;
    notes.push(...die(game, key, held.died));
  }
  return notes;
}

// Someone dies: at a time, of a cause. Returns lines for the story.
// An illness by its id, in words: "a fever".
const illnessWords = (id) => illnessKinds().find((one) => one.id === id)?.words ?? "an illness";
// A story's death says in its own words how it happened, and comes from its scene.
export function die(game, key, { at = nowOf(game), cause = "bled", part = null, kind = null, words: told = null, from = "the medbay" } = {}) {
  if (!key || key === "you" || deathOf(game, key)) return [];
  const { who, place: crowdPlace } = whoOf(key, game);
  const down = game.down?.[key] ?? null;
  const place = down?.place ?? crowdPlace ?? WORLD_CHARACTERS[who]?.location ?? game.location;
  const rules = deathRulesOf(place) ?? { room: null, names: null, morale: 0 };
  const name = nameOf(game, who);
  const words = told ?? causeWords({ cause, part, kind }, down);
  const day = Math.floor(at / 24);
  game.dead = { ...(game.dead ?? {}), [key]: { who, name, place, at, day, cause: words, ...(part ? { part } : {}), room: rules.room } };
  const notes = [];
  const here = place === game.location;
  // Whoever died lying down stays there under a blanket until they're carried away; nobody tends them any more.
  if (down) game.down[key] = { ...down, dead: true, why: "dead", call: null, carriedBy: down.carriedBy === "you" ? "you" : null, until: Infinity };
  if (game.medbay?.[place]?.treating?.[key]) delete game.medbay[place].treating[key];
  if (here) notes.push(`[HEALTH] ${name} dies, ${words}.`);
  else if (place === SHIP && aboardShip(game)) notes.push(`[HEALTH] Word comes from the medbay: ${name} has died, ${words}.`);
  // On the record, for the stories to react to.
  try {
    recordFact(game, { id: deathFact(who), text: `${name} died on day ${day + 1}, ${words}.`, from });
  } catch {
    // The record is full: the death still happens.
  }
  // A story person's contact is dead now, and so is any story that was waiting on them.
  const person = WORLD_CHARACTERS[who];
  if (person) {
    if (contactDied) notes.push(...(contactDied(game, person.name) ?? []));
    else {
      const contact = game.contacts?.find((one) => lower(one.name) === lower(person.name));
      if (contact) contact.status = "dead";
    }
  }
  // Off the post and the watch bill, one less aboard, and the ship feels it.
  notes.push(...afterDeath(game, place, who));
  tallyDuty(game, place, day, { deaths: 1 });
  if (place === SHIP && game.ship) {
    game.ship.aboard = Math.max(0, (game.ship.aboard ?? 0) - 1);
    if (rules.morale) game.ship.morale = Math.max(0, Math.min(100, (game.ship.morale ?? 50) - rules.morale));
  }
  return notes;
}

// ---- The names -----------------------------------------------------------------------------------------

// The dead of a place, oldest first.
export const deadAt = (game, place) => [...Object.values(game.dead ?? {}), ...registerDead(game)].filter((one) => one.place === place).sort((a, b) => a.at - b.at);

// Whether a thing is where a place's dead have their names put up.
function isNamesThing(place, thing) {
  const rules = deathRulesOf(place);
  return Boolean(rules?.names && thing && lower(thing.name) === lower(rules.names));
}

// The words for the names that have gone up since the game began, newest last, or null when nobody's died.
function namesWords(game, place) {
  const dead = deadAt(game, place);
  if (!dead.length) return null;
  const line = (one) => `${one.name}, day ${one.day + 1}`;
  const shown = dead.slice(-6);
  return `Newest, low down and still sharp: ${shown.map(line).join("; ")}.${dead.length > shown.length ? ` ${dead.length - shown.length} more since you came aboard, further up.` : ""}`;
}

// A thing's look, with the names that have gone up on it if it's the place's names.
export function namesLook(game, place, thing, look) {
  if (!isNamesThing(place, thing)) return look;
  const words = namesWords(game, place);
  return words ? `${look ?? ""} ${words}`.trim() : look;
}

// Using the place's names reads them: who, when and how. Null for any other thing.
export function readNames(game, place, thing) {
  if (!isNamesThing(place, thing)) return null;
  const dead = deadAt(game, place);
  if (!dead.length) return "You read down the names, all of them from before your time. Nobody's added one since you came aboard.";
  const shown = dead.slice(-12);
  return `You read the newest names, chalked low on the bulkhead:\n${shown.map((one) => `- ${one.name}, day ${one.day + 1}: ${one.cause}.`).join("\n")}${dead.length > shown.length ? `\nAnd ${dead.length - shown.length} more since you came aboard.` : ""}`;
}

// ---- What the checker needs ----------------------------------------------------------------------------

// Every fact a death can leave: one for each person at a place with a medbay, so a scene or a story's reaction can ask
// for it. And what else happens to a body that goes on the record (step 9): a limb lost, and a story's own wounds and
// heals, for everyone there, every story person and the player.
export function deathFacts() {
  const names = new Set();
  const more = (base) => { for (const what of ["wounded", "healed", "lost_a_limb"]) names.add(`${base.slice(0, 39 - what.length)}_${what}`); };
  for (const [place, file] of Object.entries(WORLD_HEALTH)) {
    if (!file.medbay) continue;
    const life = WORLD_LIFE[place] ?? {};
    for (const id of Object.keys(life.people ?? {})) {
      names.add(deathFact(id));
      more(id);
    }
    for (const group of life.crowd ?? []) for (const [name] of group.names) {
      names.add(deathFact(name));
      more(slugOf(name));
    }
  }
  for (const id of Object.keys(WORLD_CHARACTERS)) {
    names.add(deathFact(id));
    more(id);
  }
  more("you");
  return names;
}

// The dead of a place, newest first, for the Ship menu's medbay.
export const deathsView = (game, place) => deadAt(game, place).reverse().slice(0, 8).map((one) => ({ name: one.name, day: one.day + 1, cause: one.cause }));
