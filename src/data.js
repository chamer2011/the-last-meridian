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

export const PERKS = {
  // Career perks come from your life history and aren't for sale.
  chain_of_command: { name: "Chain of Command", desc: "Navy career: +2 Leadership.", starting: true, fx: { skills: { leadership: 2 } } },
  breach_and_clear: { name: "Breach and Clear", desc: "Marine career: +1 Firearms, +1 Athletics.", starting: true, fx: { skills: { firearms: 1, athletics: 1 } } },
  fast_talker: { name: "Fast Talker", desc: "Free trader career: +2 Deception, +1 Persuasion.", starting: true, fx: { skills: { deception: 2, persuasion: 1 } } },
  tinkerer: { name: "Tinkerer", desc: "Salvage career: +2 Engineering, +1 Hacking.", starting: true, fx: { skills: { engineering: 2, hacking: 1 } } },
  peer_review: { name: "Peer Review", desc: "Science career: +2 Science, +1 Lore.", starting: true, fx: { skills: { science: 2, lore: 1 } } },
  first_do_no_harm: { name: "First, Do No Harm", desc: "Medical career: +2 Medicine, and medkits heal 25% more.", starting: true, fx: { skills: { medicine: 2 }, healRate: 1.25 } },
  open_mind: { name: "Open Mind", desc: "Order of Ilun: +2 Attunement, +1 Manifestation.", starting: true, fx: { skills: { attunement: 2, manifestation: 1 } } },
  silver_tongue: { name: "Silver Tongue", desc: "Diplomatic career: +2 Persuasion, +1 Deception.", starting: true, fx: { skills: { persuasion: 2, deception: 1 } } },
  dead_drop: { name: "Dead Drop", desc: "Intelligence career: +1 Stealth, Deception and Hacking.", starting: true, fx: { skills: { stealth: 1, deception: 1, hacking: 1 } } },
  hegemony_doctrine: { name: "Hegemony Doctrine", desc: "Hegemony career: +1 Intimidation, Tactics and Composure.", starting: true, fx: { skills: { intimidation: 1, tactics: 1, composure: 1 } } },
  boarding_party: { name: "Boarding Party", desc: "Raider career: +2 Intimidation, +1 Melee.", starting: true, fx: { skills: { intimidation: 2, melee: 1 } } },
  homesteader: { name: "Homesteader", desc: "Frontier career: +2 Survival, +5 maximum health.", starting: true, fx: { skills: { survival: 2 }, maxHp: 5 } },
  // Buyable with perk points.
  toughened: { name: "Toughened", desc: "+10 maximum health.", fx: { maxHp: 10 } },
  deep_reserves: { name: "Deep Reserves", desc: "+5 maximum energy.", fx: { maxEnergy: 5 } },
  steady_aim: { name: "Steady Aim", desc: "+2 to attack rolls.", fx: { attack: 2 } },
  hard_target: { name: "Hard Target", desc: "+1 defense.", fx: { defense: 1 } },
  ace_pilot: { name: "Ace Pilot", desc: "+3 Piloting.", requiresSkill: { piloting: 2 }, fx: { skills: { piloting: 3 } } },
  shadow_step: { name: "Shadow Step", desc: "+3 Stealth.", requiresSkill: { stealth: 2 }, fx: { skills: { stealth: 3 } } },
  iron_will: { name: "Unbreakable", desc: "+2 Composure, and stress builds 20% slower.", requiresSkill: { composure: 2 }, fx: { skills: { composure: 2 }, stressRate: 0.8 } },
  quartermaster: { name: "Quartermaster", desc: "+1 Commerce, and market prices are 10% better.", requiresSkill: { commerce: 2 }, fx: { skills: { commerce: 1 }, priceBonus: 0.1 } },
  battle_reader: { name: "Battle Reader", desc: "+1 to attack rolls and +1 defense.", requiresSkill: { tactics: 3 }, fx: { attack: 1, defense: 1 } },
  polymath: { name: "Polymath", desc: "All skills improve 20% faster.", requiresStat: { intellect: 6 }, fx: { learnRate: 1.2 } },
  field_medic: { name: "Field Medic", desc: "Unlocks Field Patch in combat: 3 energy, heal 10 plus your Medicine rank.", requiresSkill: { medicine: 2 }, ability: "field_patch" },
  overcharge: { name: "Overcharge", desc: "Unlocks Overcharged Shot in combat: 3 energy, +6 damage.", ability: "overcharged_shot", requires: "steady_aim" },
  evasive: { name: "Evasive Maneuvers", desc: "Unlocks Evade in combat: 2 energy, +5 defense this round.", ability: "evade", requires: "hard_target" },
  resonant_push: { name: "Resonant Push", desc: "Unlocks Push in combat: 4 energy, a Manifestation attack that stuns the enemy for a round.", requiresSkill: { manifestation: 2 }, ability: "push" },
  system_spike: { name: "System Spike", desc: "Unlocks Spike in combat: 3 energy, a Hacking attack that disables a machine for a round.", requiresSkill: { hacking: 2 }, ability: "spike" },
  foresight: { name: "Foresight", desc: "Unlocks Foresight in combat: 3 energy, attack with +3 and gain +5 defense this round.", requiresSkill: { attunement: 3 }, ability: "foresight" },
  terrifying_glare: { name: "Terrifying Glare", desc: "Unlocks Glare in combat: 2 energy, an Intimidation attempt that freezes a living enemy for a round.", requiresSkill: { intimidation: 3 }, ability: "glare" },
  rally_cry: { name: "Rally", desc: "Unlocks Rally in combat: 3 energy, heal 6 plus your Leadership rank and relieve 15 stress.", requiresSkill: { leadership: 3 }, ability: "rally" },
  survivor: { name: "Survivor", desc: "Once per battle, a killing blow leaves you at 1 health instead." },
  // More of them are in world/perks.json.
  ...WORLD_PERKS,
};

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

// Each place can also have a file in world/places, with what the game master needs to run it.
const BASE_LOCATIONS = {
  meridian: { name: "CFS Meridian", desc: "Your battered frigate and the flagship of what's left. Medbay, mess hall, one working cannon.", market: [], rest: true, fleet: true },
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

export const STARTING_QUESTS = [
  {
    id: "the_beacon",
    title: "The Beacon",
    main: true,
    status: "active",
    desc: "The Meridian received a signal from beyond known space, promising a safe harbor from the Choir. Find where it comes from.",
    objective: "Find someone who can decode the signal. Haven Station is the obvious place to start.",
  },
  {
    id: "fuel_for_the_fleet",
    title: "Fuel for the Fleet",
    main: false,
    status: "active",
    desc: "The fleet has about two weeks of fuel left. Someone at Haven or Kessara must be selling.",
    objective: "Secure a fuel supplier for the fleet.",
  },
];

export const WORLD_BIBLE = `SETTING: THE LAST MERIDIAN
Tone: hopeful exploration, swashbuckling adventure, and desperate survival, all in one original galaxy. Think thoughtful diplomacy on the bridge, scoundrels in cantinas, mystical powers, and a ragtag fleet hunted by machines. This is an ORIGINAL universe. Never use names, characters, ships or terms from existing franchises.

BACKSTORY: Six months ago the Concord, a peaceful interstellar republic, fell in a single week to the Choir: silver machines that sing to one another across space and copy the faces of the people they kill. Nobody knows who built them. The survivors formed the Refugee Fleet: 41 ships and 30,000 people, led by the frigate CFS Meridian. Its newly appointed captain has the job because everyone above them is dead. The player may be that captain, or anyone else in the galaxy: the <player_dossier> says who they are.

PEOPLES: The Concord was home to humans and to several other peoples. Korrun are broad heavy-worlders who prize plain speech. Veshti are long-limbed spacers who dislike planets. Ilari are empaths whose skin shows their feelings in patterns of light. Thessan are cold-blooded, long-lived archivists. Synthetics are free machine people, citizens under Concord law, and since the Fall they're feared and hated by many survivors.

FACTIONS:
- Refugee Fleet: exhausted, frightened and arguing. Admiral-in-all-but-name is the Meridian's captain. XO Commander Ilya Voss is loyal, blunt and hides a Choir-related secret. Chief Engineer Dunn Marrow keeps the ship running through profanity. Dr. Sen Aduro, the chief medical officer, is the ship's exhausted conscience. Lt. Kara Tarrow, the chief of security, wants every machine in the galaxy destroyed.
- The Hegemony: an authoritarian empire at Vantor Prime led by the Serene Regent. It offers refugees protection in exchange for conscription, and hunts Resonants through its Inquisitors.
- Kessara Syndicate: pirates and smugglers led by the charming and treacherous Mother Quill.
- Order of Ilun: nearly extinct monks led by Abbess Ione who study Resonance, the faint field left behind by the vanished First Builders. Resonants can feel it and bend it: sensing minds, pushing objects, glimpsing what's coming. It always has a price.

THE MYSTERY (do not reveal early; let the player uncover it over many sessions): The Beacon promises a safe harbor, but it is a First Builder warning light, not an invitation. The First Builders made the Choir as guardians against something older, and then vanished. The Choir's song is a failing attempt to keep that thing asleep, and it copies the dead because it is trying to preserve minds. The final choice will be whether to destroy the Choir, join it, or fix it, and it falls to whoever gets that far.`;
