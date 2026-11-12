// All the game's world content lives here. You can safely edit names, prices and
// descriptions in this file without touching the rules. Characters are in character-data.js,
// and each important person and enemy has their own file in the world folder.

import { WORLD_ENEMIES, WORLD_FACTIONS, WORLD_ITEMS, WORLD_PERKS, WORLD_PLACES } from "./world.js";

export const STATS = {
  might: "Might",
  endurance: "Endurance",
  agility: "Agility",
  perception: "Perception",
  intellect: "Intellect",
  willpower: "Willpower",
  presence: "Presence",
  resonance: "Resonance",
};

export const STAT_INFO = {
  might: "Raw strength. Melee, athletics and a little extra health.",
  endurance: "Toughness. The main source of health. Void ops and survival.",
  agility: "Speed and coordination. Firearms, piloting, stealth and defense.",
  perception: "Noticing things. Awareness, gunnery, streetwise and long rifles.",
  intellect: "Reasoning. Technical skills and tactics. Earns extra skill points.",
  willpower: "Mental strength. Composure, and a bigger pool of energy.",
  presence: "Force of personality. All the social skills.",
  resonance: "Sensitivity to the field the First Builders left behind. Rare and feared.",
};

// The items are files in world/items, read by src/world.js: weapons (damage is min to max, and stat and skill both add
// to the attack roll), armor, consumables, gadgets and story items.
export const ITEMS = WORLD_ITEMS;

// The perks are files in world/perks, read by src/world.js. The abilities some of them give are below.
export const PERKS = WORLD_PERKS;

export const ABILITIES = {
  field_patch: { name: "Field Patch", energy: 3 },
  overcharged_shot: { name: "Overcharged Shot", energy: 3 },
  evade: { name: "Evade", energy: 2 },
  push: { name: "Resonant Push", energy: 4 },
  spike: { name: "System Spike", energy: 3 },
  foresight: { name: "Foresight", energy: 3 },
  glare: { name: "Terrifying Glare", energy: 2 },
  rally: { name: "Rally", energy: 3 },
};

// Each type of enemy has a file in world/enemies, with its stats and the lines used in fights.
export const ENEMIES = WORLD_ENEMIES;

// Each place can also have a file in world/places, with the writer's notes on it.
const BASE_LOCATIONS = {
  meridian: { name: "CFS Meridian", desc: "Your battered frigate and the flagship of what's left. Medbay, mess hall, one working cannon.", market: [], rest: true },
  haven: { name: "Haven Station", desc: "A neutral trade hub where every faction drinks in the same bar and pretends not to notice.", market: ["medkit", "stim", "energy_cell", "repair_kit", "fuel_cell", "sidearm", "heavy_carbine", "flak_vest", "marine_plate", "forged_papers", "lockbreaker", "data_chip"] },
  kessara: { name: "Kessara Drift", desc: "A lawless asteroid warren of smugglers, raiders and very good noodle stalls.", market: ["stim", "energy_cell", "fuel_cell", "needle_rifle", "smugglers_coat", "ghostweave", "lockbreaker", "forged_papers"] },
  ilun: { name: "Ruins of Ilun", desc: "A silent monastery world, carved by the First Builders. The stones hum at night.", market: [] },
  vantor: { name: "Vantor Prime", desc: "Capital of the Hegemony: gleaming towers, surveillance, and a very polite secret police.", market: ["medkit", "energy_cell", "repair_kit", "marine_plate", "heavy_carbine"] },
  graveyard: { name: "The Graveyard", desc: "The wreckage of the Concord's last battle, drifting in silence. Full of salvage and ghosts.", market: [] },
  frontier: { name: "Tessen Colony", desc: "A struggling farm colony beyond patrol range. They have food, and they have a problem.", market: ["medkit", "fuel_cell", "flak_vest"] },
  nest: { name: "The Choir Nest", desc: "A dead star wrapped in silver machinery. Nobody has come back from here. Yet.", market: [], dangerous: true },
};

export const LOCATIONS = {};
// Filled in place, so that a place saved from the story board shows at once wherever the game looks places up.
export function refreshLocations() {
  for (const key of Object.keys(LOCATIONS)) delete LOCATIONS[key];
  for (const id of new Set([...Object.keys(BASE_LOCATIONS), ...Object.keys(WORLD_PLACES)])) LOCATIONS[id] = { market: [], ...BASE_LOCATIONS[id], ...WORLD_PLACES[id] };
}
refreshLocations();

// The ones every captain already knows about. The rest come up as the story goes on.
export const CORE_FACTIONS = ["fleet", "hegemony", "drift", "ilun"];

// The factions are files in world/factions, read by src/world.js.
export const FACTIONS = WORLD_FACTIONS;

export const STARTING_FACTIONS = {};
// Filled in place, so a faction saved from the story board counts at once.
export function refreshFactions() {
  for (const key of Object.keys(STARTING_FACTIONS)) delete STARTING_FACTIONS[key];
  for (const [id, faction] of Object.entries(WORLD_FACTIONS)) STARTING_FACTIONS[id] = faction.start ?? 0;
}
refreshFactions();

// The quests a captain's game begins with. There are none since 2026-11-12, when the written main story (The Beacon,
// and Fuel for the Ship beside it) was taken out of the game: what there is to do comes from the ship and from what
// people ask (src/requests.js). A game saved before then has those two closed when it's opened (src/migrate.js).
export const STARTING_QUESTS = [];
