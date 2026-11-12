// Brings saved games from older versions of the game up to date, so they keep working.

import { createHash } from "node:crypto";
import { slugify } from "./campaign.js";
import { ENEMIES, LOCATIONS, STARTING_FACTIONS } from "./data.js";
import { newWorld } from "./daily.js";
import { newShipState, shipOf } from "./ship.js";
import { newBodySeed } from "./body.js";
import { newCommandState } from "./command.js";
import { startHealth } from "./medbay.js";
import { startRegister } from "./register.js";
import { sceneFileIds } from "./scene-files.js";
import { noteLoreSeen, startingLoreIds } from "./lore.js";
import { crewContacts, maxEnergy, maxHp } from "./rules.js";
import { emptyStory } from "./story-library.js";
import { walkFromOnePlan, walkFromStory } from "./walk.js";

// What each original background becomes under the deeper character system.
const LEGACY_BACKGROUNDS = {
  officer: { background: "Lieutenant, Concord Navy", career: "navy", name: "Concord Navy", rankTitle: "Lieutenant", upbringing: "service", skills: { tactics: 3, leadership: 3, piloting: 2, firearms: 2, gunnery: 1 }, tags: ["tactics", "leadership", "piloting"], ideology: { authority: -3, loyalty: -2 } },
  smuggler: { background: "Runner, Free Trader", career: "smuggler", name: "Free Trader", rankTitle: "Runner", upbringing: "undercity", skills: { piloting: 3, deception: 3, streetwise: 2, firearms: 2, commerce: 1 }, tags: ["piloting", "deception", "streetwise"], ideology: { authority: 3, loyalty: 2 } },
  adept: { background: "Listener, Order of Ilun", career: "adept", name: "Order of Ilun", rankTitle: "Listener", upbringing: "devout", skills: { attunement: 3, manifestation: 3, composure: 2, melee: 2, lore: 1 }, tags: ["attunement", "manifestation", "composure"], ideology: { belief: 4, violence: -2 } },
  engineer: { background: "Salvage Tech, Salvage Guild", career: "engineer", name: "Salvage Guild", rankTitle: "Salvage Tech", upbringing: "dockside", skills: { engineering: 3, void_ops: 2, hacking: 2, science: 2, firearms: 1 }, tags: ["engineering", "hacking", "void_ops"], ideology: { belief: -3, flesh: 2 } },
  envoy: { background: "Consular Officer, Diplomatic Corps", career: "envoy", name: "Diplomatic Corps", rankTitle: "Consular Officer", upbringing: "privilege", skills: { persuasion: 3, deception: 2, lore: 2, leadership: 2, firearms: 1 }, tags: ["persuasion", "lore", "deception"], ideology: { violence: -3, loyalty: -1 } },
};

function fromVersion1(save) {
  const legacy = LEGACY_BACKGROUNDS[save.background] ?? LEGACY_BACKGROUNDS.officer;
  const ideology = { authority: 0, loyalty: 0, violence: 0, belief: 0, flesh: 0, ...legacy.ideology };
  const known = new Set((save.contacts ?? []).map((c) => c.name.toLowerCase()));

  const migrated = {
    ...save,
    version: 2,
    character: {
      callsign: "",
      pronouns: "they/them",
      appearance: "",
      species: "human",
      homeworld: "aurelis",
      upbringing: legacy.upbringing,
      drive: "protect",
      bond: null,
      age: 30,
      background: legacy.background,
      careers: [{ career: legacy.career, name: legacy.name, terms: 2, rankTitle: legacy.rankTitle }],
      biography: [`Served in the ${legacy.name} before the Fall of the Concord, and was left in command of the Meridian when everyone above them died.`],
      hooks: [],
      learning: 1,
      legacy: true,
    },
    stats: { might: 3, endurance: 3, agility: 3, perception: 3, intellect: 3, willpower: 3, presence: 3, resonance: 1, ...save.stats },
    skills: legacy.skills,
    skillXp: {},
    skillPoints: 0,
    tags: legacy.tags,
    traits: [],
    ideology,
    needs: { stress: 15, fatigue: 10 },
    conditions: [],
    clock: { hours: 8 },
    contacts: [...crewContacts(ideology).filter((c) => !known.has(c.name.toLowerCase())), ...(save.contacts ?? [])],
    // The AI restarts from a recap, so that it picks up the new character details.
    ai: { provider: null, messages: [] },
  };
  delete migrated.background;
  // Health and energy are worked out differently now, so old values may no longer fit.
  migrated.hp = Math.min(migrated.hp, maxHp(migrated));
  migrated.energy = Math.min(migrated.energy, maxEnergy(migrated));
  return migrated;
}

// Version 3 added the codex.
function fromVersion2(save) {
  const migrated = { ...save, version: 3, lore: [], seenLore: startingLoreIds() };
  for (const entry of migrated.transcript) {
    if (entry.role === "narrator") noteLoreSeen(migrated, entry.text);
  }
  return migrated;
}

// Version 4 moved characters and enemies into local files, and made fights fully local.
function fromVersion3(save) {
  // The same campaign gets the same folder, whichever saved copy of it is loaded first.
  const fingerprint = createHash("sha256").update(JSON.stringify([save.name, save.character?.age, save.character?.biography])).digest("hex").slice(0, 8);
  const known = new Set(save.contacts.map((c) => c.name.toLowerCase()));
  return {
    ...save,
    version: 4,
    campaign: `${slugify(save.name) || "captain"}-${fingerprint}`,
    bestiary: {},
    pendingEvents: [],
    contacts: [
      // An earlier version gave away Commander Voss's secret in her description.
      ...save.contacts.map((c) => (c.note?.includes("hiding something about the Choir")
        ? { ...c, note: "Commander Ilya Voss. Your XO. Blunt and loyal, and doesn't talk about how she got out of the Fall." }
        : c)),
      // The crew has grown since older saves were made.
      ...crewContacts(save.ideology).filter((c) => !known.has(c.name.toLowerCase())),
    ],
    combat: save.combat
      ? { ...save.combat, guard: 0, training: false, enemy: { ...ENEMIES[save.combat.enemyId], ...save.combat.enemy } }
      : null,
  };
}

// Version 5 gave fights two sides, each of which can have several fighters.
function fromVersion4(save) {
  const old = save.combat;
  if (!old) return { ...save, version: 5 };
  const enemy = old.enemy;
  const type = ENEMIES[old.enemyId];
  // The fight's lines no longer go in the story, and a simulated fight never leaves any behind.
  const transcript = old.training && old.transcriptStart !== undefined ? save.transcript.slice(0, old.transcriptStart) : save.transcript;
  return {
    ...save,
    version: 5,
    transcript,
    combat: {
      id: Date.now(),
      round: old.round,
      guard: 0,
      survivorUsed: Boolean(old.survivorUsed),
      training: Boolean(old.training),
      nextKey: 1,
      allies: [],
      enemies: [{
        ...type,
        ...enemy,
        key: "e0",
        id: old.enemyId,
        base: enemy.name,
        prose: enemy.named ? enemy.shortName ?? enemy.name : `the ${enemy.name}`,
        maxHp: enemy.maxHp ?? type?.hp ?? enemy.hp,
        tags: enemy.tags ?? type?.tags ?? [],
        xp: enemy.xp ?? type?.xp ?? 0,
        credits: enemy.credits ?? type?.credits ?? [0, 0],
        stunned: Boolean(old.stunned),
      }],
      arrivals: [],
      notes: [],
      leadIn: null,
      intro: old.intro ?? null,
      ...(old.snapshot ? { snapshot: old.snapshot } : {}),
    },
  };
}

// Version 6 added skill check windows, more factions, and story threads.
function fromVersion5(save) {
  return {
    ...save,
    version: 6,
    check: null,
    story: emptyStory(),
    factions: { ...STARTING_FACTIONS, ...save.factions },
  };
}

// Version 7 gave the fleet real ships and supplies that run out. The fleet's gone since version 16, so a save this old
// only gets the ship's own stores there, with nothing charged for the days that went by before.
function fromVersion6(save) {
  return { ...save, version: 7 };
}

// Version 8 gave the captain a place on the deck plan, and a way to talk to whoever's there.
function fromVersion7(save) {
  return { ...save, version: 8, talk: null, walk: null };
}

// Version 9 made each room its own level, so the captain's place is now a room and a spot in it.
function fromVersion8(save) {
  return { ...save, version: 9, walk: walkFromOnePlan(save) };
}

// Version 10 gave every place a map, so a captain who's away from the Meridian needs a place on it.
function fromVersion9(save) {
  const walk = save.walk ?? walkFromStory(save);
  return { ...save, version: 10, opened: save.opened ?? {}, walk };
}

// Version 11 gave people their own days. Everyone just starts from wherever this time of day finds them.
function fromVersion10(save) {
  return { ...save, version: 11, life: null };
}

// Version 14 let the player be anyone. Everyone who's already playing is the captain, and stays that way.
function fromVersion13(save) {
  return { ...save, version: 14, role: { id: "captain", captain: true } };
}

// Version 13 set the stories moving by themselves. Their clocks start from now, so nothing happens all at once.
function fromVersion12(save) {
  const day = Math.floor(save.clock.hours / 24);
  return { ...save, version: 13, story: { ...save.story, act: save.story?.act ?? 1, clock: { day, start: day, threads: {}, act: null, moved: [] } } };
}

// Version 12 gave every place its own supplies, prices and factions. They start from now, as they stand in the world's files.
function fromVersion11(save) {
  return { ...save, version: 12, world: newWorld(save) };
}

// A game from before there was a written story had an AI game master (and since version 19, the written story).
function fromVersion14(save) {
  return { ...save, version: 15, mode: "ai", scene: null, flags: {}, lastCheck: null, lastFight: null };
}

// Version 16 is the Meridian on her own. The fleet's part of the save goes, and what was the fleet's and is still
// the ship's carries over: where she is, whose chair it is, the day her clock has got to, the rations, her people's
// health and the log. Her stores start from the file, since the fleet's tonnes were for thirty thousand people.
function fromVersion15(save) {
  const fleet = save.fleet ?? {};
  const { fleet: _gone, ...rest } = save;
  const fresh = newShipState(save);
  const ship = {
    ...(save.ship ?? {}),
    ...fresh,
    day: fleet.day ?? fresh.day,
    at: fleet.at ?? fresh.at,
    chair: fleet.chair ? { id: fleet.chair.id, funds: fleet.chair.funds ?? fresh.chair?.funds ?? 0, lastJump: fleet.chair.lastJump ?? -99, lastBuy: fleet.chair.lastBuy ?? -99 } : fresh.chair,
    health: fleet.health ?? fresh.health,
    rations: fleet.rations ?? fresh.rations,
    log: fleet.log ?? [],
    ...(fleet.council ? { council: { off: Boolean(fleet.council.off), ordered: fleet.council.ordered ?? {}, waiting: {}, last: fleet.council.last ?? {}, setRations: fleet.council.setRations ?? null, recent: fleet.council.recent ?? [] } } : {}),
  };
  const notice = { role: "notice", text: "[SHIP] The fleet is a thing of the past: the game is about the Meridian alone now. Her stores, rations and morale are on the Ship menu, and the star map is hers." };
  return { ...rest, version: 16, ship, transcript: save.fleet ? [...(save.transcript ?? []), notice] : save.transcript ?? [] };
}

// Version 17 is the ship's logistics running on the clock. An old save has nothing to carry over: its stores are full
// and its machines start when the clock next moves, which is what the game does with a state that isn't there yet, so
// anything a save this old says about logistics is let go rather than replayed.
function fromVersion16(save) {
  const { logistics: _gone, ...rest } = save;
  return { ...rest, version: 17 };
}

// Version 18 is the ship's chain of command. An old save starts with everyone in the post they hold now: the file's
// holders, with the player or the chair's captain in the captain's post.
function fromVersion17(save) {
  shipOf(save);
  return { ...save, version: 18, command: newCommandState(save) };
}

// Version 19 is the game without an AI game master. A game the AI was running opens as a written game: what was kept
// for the AI goes (its side of the conversation, and the notes it hadn't read yet), and the story says so once, which
// also stops the AI's last choices being offered, since only it could answer them. A talk the AI was playing closes.
function fromVersion18(save) {
  const { ai: _ai, mode, pendingEvents: _events, ...rest } = save;
  const game = { ...rest, version: 19 };
  if ((mode ?? "ai") === "ai" && game.transcript?.length) {
    game.transcript = [...game.transcript, { role: "notice", text: "[STORY] The AI game master has gone from the game. From here, the written story runs it: a written scene under way carries on, and the Leads menu has the written stories.", turnover: true }];
  }
  if (game.talk && !game.talk.written) game.talk = null;
  if (game.talk) delete game.talk.unheard;
  if (game.world) delete game.world.unheard;
  if (game.ship) delete game.ship.unheard;
  return game;
}

// Version 20 gives everyone a body (src/body.js), made up from the game's own seed: an older game gets one now, and the
// wounds the player has (their conditions) show on their body's parts.
function fromVersion19(save) {
  return { ...save, version: 20, bodySeed: save.bodySeed ?? newBodySeed() };
}

// Version 21 keeps the wounds fights leave: the player's, and anyone else's by the key their body is made from.
function fromVersion20(save) {
  return { ...save, version: 21, wounds: save.wounds ?? [], bodies: save.bodies ?? {} };
}

// Version 22 treats wounds in the medbay: the wounds the places' health files start people with become kept wounds, so
// they heal, and whoever has a serious one (Vik and Hana) starts laid up on a cot there.
function fromVersion21(save) {
  const game = { ...save, version: 22 };
  startHealth(game);
  return game;
}

// Version 23 puts everyone aboard without a day of their own on the register (src/register.js), sized to who's aboard now.
function fromVersion22(save) {
  const game = { ...save, version: 23 };
  startRegister(game);
  return game;
}

// Version 24 is the game without its written main story: on 2026-11-12 the scenes of The Beacon, the main stories and
// their clock were taken out. A game from before keeps playing. The quests that only a written story moved on can't go
// anywhere now, so they're closed (what people ask, the requests, are left alone); a scene of the old story that was
// under way or waiting is dropped; a talk that was open closes, since its lines may have gone; and the story says so
// once, which also stops the old scene's last choices being offered.
export const OLD_STORY_NOTICE = "[STORY] The written main story has been taken out of the game, and its quests are closed. Everything else goes on as it was: the ship, her people, and what they ask of you.";
const CLOSED_WITH_THE_STORY = "Closed: the written story this belonged to has been taken out of the game.";
// The old story's scenes, by the names their files had. The captain's opening has a file of that name again since the
// mutiny opening (2026-11-12), a different story, so a scene of the old one is dropped by its name, not only when its
// file has gone.
const OLD_STORY_SCENES = new Set(["opening", "opening_captain", "opening_docker", "opening_engine_hand", "arrive_haven", "thread_main_the_old_scholar", "thread_main_two_weeks_of_fuel", "thread_main_visiting_hours", "thread_main_the_council", "thread_crew_naomi_under_crew", "talk_tharel"]);
function fromVersion23(save) {
  const game = { ...save, version: 24 };
  const there = sceneFileIds();
  const gone = (scene) => Boolean(scene?.id) && (!there.has(scene.id) || OLD_STORY_SCENES.has(scene.id));
  let told = false;
  if (gone(game.scene)) {
    game.scene = null;
    told = true;
  }
  if (game.parked) {
    const kept = Object.entries(game.parked).filter(([, scene]) => !gone(scene));
    if (kept.length !== Object.keys(game.parked).length) told = true;
    game.parked = Object.fromEntries(kept);
  }
  game.quests = (game.quests ?? []).map((quest) => {
    if (quest.status !== "active" || quest.request) return quest;
    told = true;
    return { ...quest, status: "completed", objective: CLOSED_WITH_THE_STORY };
  });
  if (game.following && !game.quests.some((quest) => quest.id === game.following && quest.status === "active")) game.following = null;
  if (game.talk) game.talk = null;
  if (told && game.transcript?.length) game.transcript = [...game.transcript, { role: "notice", text: OLD_STORY_NOTICE, turnover: true }];
  return game;
}

export function migrateGame(save) {
  if (!save) return save;
  let game = save;
  if ((game.version ?? 1) < 2) game = fromVersion1(game);
  if (game.version < 3) game = fromVersion2(game);
  if (game.version < 4) game = fromVersion3(game);
  if (game.version < 5) game = fromVersion4(game);
  if (game.version < 6) game = fromVersion5(game);
  if (game.version < 7) game = fromVersion6(game);
  if (game.version < 8) game = fromVersion7(game);
  if (game.version < 9) game = fromVersion8(game);
  if (game.version < 10) game = fromVersion9(game);
  if (game.version < 11) game = fromVersion10(game);
  if (game.version < 12) game = fromVersion11(game);
  if (game.version < 13) game = fromVersion12(game);
  if (game.version < 14) game = fromVersion13(game);
  if (game.version < 15) game = fromVersion14(game);
  if (game.version < 16) game = fromVersion15(game);
  if (game.version < 17) game = fromVersion16(game);
  if (game.version < 18) game = fromVersion17(game);
  if (game.version < 19) game = fromVersion18(game);
  if (game.version < 20) game = fromVersion19(game);
  if (game.version < 21) game = fromVersion20(game);
  if (game.version < 22) game = fromVersion21(game);
  if (game.version < 23) game = fromVersion22(game);
  if (game.version < 24) game = fromVersion23(game);
  // A place that's gone from the world's files can't hold anyone, and factions added since this save was made need a standing.
  if (!LOCATIONS[game.location]) game.location = "meridian";
  game.factions ??= {};
  for (const [id, start] of Object.entries(STARTING_FACTIONS)) game.factions[id] ??= start;
  shipOf(game);
  return game;
}
