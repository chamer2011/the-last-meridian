// The registry printout for someone else: the same amber paper as the player's own, opened from the right-click
// menu on anyone in the room. Someone with a file in world/characters prints what their file says (never their goals
// or secrets, which no registry has). Everyone else, the crowd with only a name, gets a record made up from their name,
// the same every time, marked as thin: its fight numbers are the ones they'd really fight with (world/deeds.json's
// stand-in enemy) and its Awareness matches how hard their pocket is, so nothing on it disagrees with the rules.
// Reading it writes nothing to the save.

import { findCharacter, fullName } from "./campaign.js";
import { SKILLS } from "./character-data.js";
import { ENEMIES, FACTIONS, LOCATIONS, STATS } from "./data.js";
import { pocketDetail } from "./deeds.js";
import { toOutsider } from "./role.js";
import { findContact } from "./rules.js";
import { personHere } from "./walk.js";
import { DEEDS, WORLD_SPECIES } from "./world.js";

const watchful = (name) => (DEEDS.watchful ?? []).some((word) => new RegExp(`\\b${word}\\b`, "i").test(String(name)));
const speciesName = (id) => WORLD_SPECIES[id]?.name ?? (id ? id.charAt(0).toUpperCase() + id.slice(1) : null);

export function personSheet(game, key) {
  key = String(key ?? "").replace(/^person:/, "");
  const here = personHere(game, key);
  const id = here ? here.entry.id ?? null : findCharacter(game.campaign, key)?.id ?? null;
  if (!here && !id) throw new Error("There's no record of them to print.");
  const person = id ? findCharacter(game.campaign, id) : null;
  const name = person ? fullName(person) : here.view.name;
  const pocket = here ? here.view.pocket : pocketDetail(game, { id, name, asleep: false });
  const seen = here?.entry.doing ?? null;
  return person ? namedSheet(game, person, pocket, seen) : crowdSheet(game, name, pocket, seen);
}

function namedSheet(game, person, pocket, seen) {
  const contact = findContact(game, fullName(person)) ?? findContact(game, person.name);
  const fight = person.combat ?? {};
  return {
    key: person.id,
    thin: false,
    name: fullName(person),
    aliases: (person.aliases ?? []).filter((one) => one !== fullName(person) && one !== person.name).slice(0, 3),
    species: speciesName(person.species),
    pronouns: person.pronouns ?? null,
    age: person.age ?? null,
    post: person.role ? toOutsider(game, person.role) : null,
    faction: FACTIONS[person.faction]?.name ?? null,
    based: [LOCATIONS[person.location]?.name, person.crew ? "crew" : null].filter(Boolean).join(" · ") || null,
    status: contact?.status && contact.status !== "alive" ? contact.status : null,
    attitude: contact?.attitude ?? null,
    attributes: attributesOf(person.attributes ?? {}),
    skills: skillsOf(person.skills ?? {}),
    looks: person.appearance ?? null,
    fight: fightOf(fight),
    pocket,
    seen,
    note: person.note ? toOutsider(game, person.note) : null,
  };
}

// ---- The crowd: a record made up from the name, the same every time -----------------------------------

function seeded(text) {
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
const weighted = (roll, pairs) => {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  let at = roll() * total;
  for (const [value, w] of pairs) if ((at -= w) < 0) return value;
  return pairs[0][0];
};
const SPECIES_SHARE = { human: 55, korrun: 10, veshti: 12, ilari: 9, thessan: 6, synthetic: 8 };

function crowdSheet(game, name, pocket, seen) {
  const roll = seeded(name.toLowerCase());
  const guard = watchful(name);
  const species = weighted(roll, Object.keys(WORLD_SPECIES).map((id) => [id, SPECIES_SHARE[id] ?? 4]));
  const attributes = {};
  for (const id of Object.keys(STATS)) {
    const nudge = WORLD_SPECIES[species]?.attrs?.[id] ?? 0;
    attributes[id] = Math.max(1, Math.min(8, 2 + Math.floor(roll() * 3) + nudge + (guard && ["might", "endurance", "perception"].includes(id) ? 1 : 0)));
  }
  if (species === "synthetic") attributes.resonance = 0;
  else attributes.resonance = Math.min(attributes.resonance, 3);
  // Their Awareness says the same as their pocket: easy for anyone, moderate for someone who watches for a living.
  const skills = { awareness: guard ? 2 + Math.floor(roll() * 2) : Math.floor(roll() * 2) };
  const pool = Object.keys(SKILLS).filter((id) => !["awareness", "attunement", "manifestation"].includes(id));
  const count = 2 + Math.floor(roll() * 3);
  for (let i = 0; i < count; i++) skills[pick(roll, pool)] = 1 + Math.floor(roll() * 3);
  if (guard) skills.firearms = Math.max(skills.firearms ?? 0, 2);
  const enemy = ENEMIES[DEEDS.attack?.as?.[guard ? "watchful" : "anyone"]] ?? {};
  return {
    key: name,
    thin: true,
    name,
    aliases: [],
    species: speciesName(species),
    pronouns: pick(roll, ["she/her", "he/him", "they/them"]),
    age: species === "thessan" ? 60 + Math.floor(roll() * 140) : 18 + Math.floor(roll() * 50),
    // A crowd name usually starts with the job, like Cook Imre or Mess Hand Bao.
    post: name.trim().split(/s+/).length > 1 ? name.trim().split(/s+/).slice(0, -1).join(" ") : guard ? "Security, on watch" : null,
    faction: null,
    based: LOCATIONS[game.location]?.name ?? null,
    status: null,
    attitude: null,
    attributes: attributesOf(attributes),
    skills: skillsOf(skills),
    looks: null,
    fight: fightOf(enemy),
    pocket,
    seen,
    note: null,
  };
}

// ---- Shared ---------------------------------------------------------------------------------------

const attributesOf = (values) => Object.entries(STATS).map(([id, label]) => ({ id, label, value: Number(values[id] ?? 0) }));
const skillsOf = (ranks) => Object.entries(ranks)
  .filter(([id, rank]) => SKILLS[id] && rank > 0)
  .map(([id, rank]) => ({ id, name: SKILLS[id].name, rank }))
  .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
const fightOf = (fight) => (fight && (fight.hp || fight.weapon)
  ? { weapon: fight.weapon ?? null, attack: fight.attack ?? 0, damage: fight.damage ?? null, defense: fight.defense ?? null, hp: fight.hp ?? null }
  : null);
