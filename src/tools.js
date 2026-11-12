// The game's actions: what the written story's effects (* lines in world/scenes), conversations and computers can
// change. Each one is checked here against its shape before anything changes in the game, and the checker uses the
// same shapes to find mistakes in the files before anyone plays them.

import { ensureContactFiles, findCharacter } from "./campaign.js";
import { startCheck } from "./checks.js";
import { FACTIONS, ITEMS, LOCATIONS, STATS } from "./data.js";
import { CONDITIONS, CONTEXTS, POLES, SKILLS, TRAITS } from "./character-data.js";
import { changePlace, trackedPlaces } from "./daily.js";
import { changeCommand } from "./ship.js";
import { LORE_KINDS, hasStaticLore } from "./lore.js";
import { noteThreadEnded, noteThreadStarted, updateStory } from "./story-library.js";
import { endingOf, recordEnding } from "./record.js";
import {
  DIFFICULTY, TURN_LIMITS, addCondition, addItem, changeStanding, clamp, clockLabel, changeStress, findContact, grantXp, maxHp, passTime, practice,
  removeCondition, removeItem, shiftIdeology, startCombat, travel,
} from "./rules.js";
import { setScene } from "./walk.js";
import { startBattle } from "./battles.js";
import { tellContactDied } from "./death.js";
import { PARLEY, ROOM_KINDS, WORLD_THREADS } from "./world.js";

const obj = (properties, required = Object.keys(properties)) => ({
  type: "object", properties, required, additionalProperties: false,
});
const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "integer", description });
const bool = (description) => ({ type: "boolean", description });
const oneOf = (values, description) => ({ type: "string", enum: values, description });
const REASONS_TO_FIGHT = Object.keys(PARLEY.motives).filter((id) => !PARLEY.motives[id].fixed);
const earnableTraits = Object.keys(TRAITS).filter((id) => TRAITS[id].earnable);

export const TOOL_DEFS = [
  {
    name: "roll_check",
    description: "Opens a skill check in its own window. Only one check at a time. The written story picks up its result.",
    input_schema: obj({
      skill: oneOf([...Object.keys(SKILLS), "none"], 'The skill being used. Use "none" only for raw ability with no skill involved, and then set attribute.'),
      attribute: oneOf(Object.keys(STATS), "Optional. Overrides the skill's usual attribute, for example Might with Intimidation when physically looming. Required when skill is \"none\"."),
      difficulty: oneOf(Object.keys(DIFFICULTY), "How hard this is, regardless of how well the player argues for it."),
      context: { type: "array", items: oneOf(Object.keys(CONTEXTS), "A situation that applies."), description: "Optional. Situations that apply to this check. The player's traits may react to them." },
      audience: str("Optional. Who is being persuaded, deceived or led: a faction's id, or a person's id or name. Their relationship with the player and shared beliefs change the odds."),
      reason: str("Very short description shown to the player, e.g. 'Bluff past the customs officer'."),
      scene: str("Optional. One sentence the player reads as the check's window opens, setting up what they're facing."),
    }, ["skill", "difficulty", "reason"]),
  },
  {
    name: "start_combat",
    description: "Starts a fight, which the game runs by itself from its files. lead_in is what the player reads just before it. Up to four fighters on a side, counting the player.",
    input_schema: obj({
      enemy: str("What to fight: the id or name of an enemy type, including one you've just added with create_enemy, or the id or name of a character with a file. Pick something that suits the player's level."),
      lead_in: str("One to three sentences of story leading up to the first blow, in the same format as your narration. Don't describe how the fight goes."),
      called: str("Optional. What the story calls this enemy, if that's not its usual name, such as 'Syndicate Courier' for a dock thug. The fight uses this name."),
      enemy_followers: { type: "array", items: str("An enemy type or person."), description: "Optional. Others fighting on the enemy's side from the start, because they're really there in the story." },
      allies: { type: "array", items: str("A person with a file, or an enemy type fighting for the player."), description: "Optional. Followers fighting on the player's side from the start. Only people who are really with the player in the story." },
      arrivals: {
        type: "array",
        items: obj({
          who: str("An enemy type or a person."),
          side: oneOf(["ally", "enemy"], "Whose side they join."),
          round: num("The round they get there, from 2 up."),
        }),
        description: "Optional. Up to three who join partway through, if the story gives them a reason to come running.",
      },
      why: oneOf(REASONS_TO_FIGHT, "Optional. Why the enemy's side is fighting, if the story knows better than their usual reason. It decides how hard they are to talk down, threaten, pay off or lie to. It doesn't apply to animals, machines or the Choir."),
      reason: str("Optional. One short sentence the player reads in the fight window, saying why they're fighting: 'You owe the Syndicate, and they've come to collect.'"),
      faction: oneOf(Object.keys(FACTIONS), "Optional. The faction they're fighting for, if it isn't the one in their file. How that faction feels about the player changes the odds of talking to them."),
    }, ["enemy", "lead_in"]),
  },
  {
    name: "start_battle",
    description: "Starts a battle from world/battles: a fight fought by everyone on a deck at once, in the room, with no limit of four on a side. The battle's own file says who fights it, where they come in and when.",
    input_schema: obj({
      battle: str("The battle's id: the name of its file in world/battles, without .txt."),
      lead_in: str("Optional. One to three sentences of story leading up to it, in the same format as narration."),
    }, ["battle"]),
  },
  {
    name: "update_story",
    description: "Keeps track of the main story: a clue the player has found, or the act it has moved into.",
    input_schema: obj({ clue: str("Optional. The id of a clue they've just found."), act: num("Optional. The act the main story has just moved into.") }, []),
  },
  {
    name: "give_item",
    description: "Gives the player an item.",
    input_schema: obj({ item: oneOf(Object.keys(ITEMS), "The item to give.") }),
  },
  {
    name: "take_item",
    description: "Takes an item from the player.",
    input_schema: obj({ item: oneOf(Object.keys(ITEMS), "The item to remove.") }),
  },
  {
    name: "change_credits",
    description: "Pays the player, or charges them with a negative amount. Fails if they can't afford it.",
    input_schema: obj({ amount: num("Positive to give credits, negative to charge them."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "change_health",
    description: "Hurts or heals the player outside a fight. It can't kill them: they stay at 1 health at worst.",
    input_schema: obj({ amount: num("Negative for damage, positive for healing."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "change_stress",
    description: "Raises or lowers the player's stress.",
    input_schema: obj({ amount: num("Positive adds stress, negative relieves it."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "pass_time",
    description: "Moves the clock forward. Time heals injuries, builds fatigue and uses up the ship's supplies.",
    input_schema: obj({
      hours: num("Hours passing, from 1 to 72."),
      activity: oneOf(["active", "work", "rest"], "active for normal activity, work for hard labor or a demanding shift, rest for real sleep or recovery."),
      reason: str("Short description shown to the player."),
    }),
  },
  {
    name: "add_condition",
    description: "Gives the player a lasting injury or state, which heals with time or is treated.",
    input_schema: obj({ condition: oneOf(Object.keys(CONDITIONS), "The condition to apply."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "remove_condition",
    description: "Treats one of the player's conditions.",
    input_schema: obj({ condition: oneOf(Object.keys(CONDITIONS), "The condition to remove."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "shift_ideology",
    description: "Moves the player's beliefs. Acting against a strong belief causes stress, and acting on one relieves it.",
    input_schema: obj({
      toward: oneOf(Object.keys(POLES), "The belief their choice moved them toward."),
      amount: num("1 for a telling choice, 2 for a major one, 3 for a defining moment."),
      reason: str("Short reason shown to the player."),
    }),
  },
  {
    name: "grant_trait",
    description: "Gives the player a new trait for good.",
    input_schema: obj({ trait: oneOf(earnableTraits, "The trait they've earned."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "remove_trait",
    description: "Takes away one of the player's traits.",
    input_schema: obj({ trait: oneOf(Object.keys(TRAITS), "The trait to remove."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "train_skill",
    description: "Gives practice toward a skill.",
    input_schema: obj({ skill: oneOf(Object.keys(SKILLS), "The skill being trained."), amount: num("Practice points, usually 5 to 20."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "change_ship",
    description: "Changes the Meridian's hull or fuel, or the morale aboard her. Her food, medicine and parts are her stores, changed with * stores.",
    input_schema: obj({ hull: num("Change in hull, or 0."), fuel: num("Change in fuel, or 0."), morale: num("Change in morale aboard, or 0."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "change_command",
    description: "Changes who captains the Meridian. The rations, the buying and the jumps go with it.",
    input_schema: obj({ takes: bool("True if the player has just become the captain. False if they've just stopped being it."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "change_place",
    description: "Changes how things stand at a place: its supplies, where 100 is normal for that place, and how much of a say each side has.",
    input_schema: obj({
      place: oneOf(trackedPlaces(), "The place's id."),
      food: num("Optional. Change in its food level, from -60 to 60."),
      fuel: num("Optional. Change in its fuel level, from -60 to 60."),
      medicine: num("Optional. Change in its medicine level, from -60 to 60."),
      parts: num("Optional. Change in its parts level, from -60 to 60."),
      side: str("Optional. Which side gains or loses ground there, by the short name given for it in the state or read_world."),
      amount: num("Optional. How much of a say that side gains or loses, from -30 to 30. Whoever has the most holds the place."),
      news: str("Optional. One sentence, for what people will be saying about it from now on."),
      reason: str("Short reason shown to the player."),
    }, ["place", "reason"]),
  },
  {
    name: "award_xp",
    description: "Awards experience.",
    input_schema: obj({ amount: num("XP to award."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "travel",
    description: "Moves the player to another place. A captain's jump moves the Meridian and costs fuel; anyone else goes alone.",
    input_schema: obj({ destination: oneOf(Object.keys(LOCATIONS), "Where to go.") }),
  },
  {
    name: "set_scene",
    description: "Puts the player in a room, or somewhere off the map, with the people named there. It takes no time.",
    input_schema: obj({
      area: str("Where the player is now: a room from the place file, or the name of anywhere else, such as 'Section Fourteen', which gets a room of its own, kept for good."),
      people: { type: "array", items: str("A person's id or name."), description: "Optional. Who's with the player there, up to 8. Everyone else goes back to their usual post." },
      kind: oneOf(Object.keys(ROOM_KINDS), "Optional, for somewhere off the map. What sort of room to draw."),
      things: {
        type: "array",
        items: obj({ name: str("What it is, in a few words."), look: str("One or two sentences the player reads when they look at it.") }),
        description: "Optional, for somewhere off the map. Up to 4 things that make this room what it is, for the player to look at.",
      },
    }, ["area"]),
  },
  {
    name: "change_faction",
    description: "Changes how a faction regards the player.",
    input_schema: obj({ faction: oneOf(Object.keys(FACTIONS), "The faction."), amount: num("Change from -15 to 15."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "add_quest",
    description: "Adds a quest to the player's log.",
    input_schema: obj({ id: str("Short lowercase id with underscores, e.g. 'rescue_the_miners'."), title: str("Quest title."), description: str("One or two sentences of background."), objective: str("What the player should do next.") }),
  },
  {
    name: "update_quest",
    description: "Changes a quest's objective, or marks it done or failed.",
    input_schema: obj({ id: str("The quest id."), status: oneOf(["active", "completed", "failed"], "The quest's status now."), objective: str("The new current objective, or the final outcome.") }),
  },
  {
    name: "note_contact",
    description: "Adds or updates someone in the player's contacts. Their attitude changes later social checks with them.",
    input_schema: obj({
      name: str("The character's name."),
      attitude: oneOf(["ally", "friendly", "neutral", "wary", "hostile"], "How they feel about the player."),
      note: str("One sentence on what has happened between them and the player."),
      status: oneOf(["alive", "dead", "missing", "captured"], "Optional. Set this if something has happened to them."),
    }, ["name", "attitude", "note"]),
  },
  {
    name: "add_journal",
    description: "Writes an entry in the journal.",
    input_schema: obj({ entry: str("One or two sentences on what happened.") }),
  },
  {
    name: "add_lore",
    description: "Adds or updates an entry in the player's codex, so the name is highlighted in the story.",
    input_schema: obj({
      term: str("The exact name as you write it in the story, e.g. 'The Rim'."),
      kind: oneOf(LORE_KINDS, "What sort of thing this is."),
      text: str("One or two sentences, written for the player."),
    }),
  },
];

const withNotes = (first, notes = []) => [first, ...notes].filter(Boolean).join("\n");


// ---- Handlers. Each returns { result, notice }: result says what happened, and notice is what the player reads. ----

// A story waiting on someone who has just died can't go on, so its quest fails with them, and its scene is over. That's
// the rule for now, and it will make some stories too easy to lose; it's to be balanced later. Returns the notices.
function failStoriesWaitingOn(game, name) {
  const person = findCharacter(game.campaign, name);
  if (!person) return [];
  const notices = [];
  for (const scene of [game.scene, ...Object.values(game.parked ?? {})].filter((one) => one?.with === person.id)) {
    if (game.scene === scene) game.scene = null;
    else delete game.parked[scene.id];
    const quest = game.quests.find((one) => one.id === scene.quest && one.status === "active");
    if (quest) notices.push(handlers.update_quest(game, { id: quest.id, status: "failed", objective: `${person.title ? `${person.title} ` : ""}${person.name} is dead, so this can't go on.` }).notice);
  }
  return notices;
}

const handlers = {
  roll_check(game, input) {
    if (input.skill === "none" && !input.attribute) throw new Error('When skill is "none", you must set an attribute.');
    if (game.check) throw new Error("A check is already running. Ask for the next one after you've seen its result.");
    if (game.combat) throw new Error("A fight has just started, so this check can't happen. Its result comes first.");
    startCheck(game, {
      skill: input.skill === "none" ? null : input.skill,
      attribute: input.attribute ?? null,
      difficulty: input.difficulty,
      context: input.context ?? [],
      audience: input.audience && input.audience !== "none" ? input.audience : null,
      reason: input.reason,
      scene: input.scene || null,
    });
    return { result: "The player is taking this check in its own window." };
  },
  start_combat(game, input) {
    if (game.check) throw new Error("A check is already running, so this fight can't start yet. Start it after you've seen the result.");
    const notes = startCombat(game, input.enemy, {
      called: input.called,
      followers: input.enemy_followers ?? [],
      allies: input.allies ?? [],
      arrivals: input.arrivals ?? [],
      leadIn: input.lead_in,
      why: input.why,
      reason: input.reason,
      faction: input.faction,
    });
    const foes = game.combat.enemies.map((enemy) => enemy.name).join(", ");
    const friends = game.combat.allies.map((ally) => ally.name).join(", ");
    return {
      narration: input.lead_in,
      result: `The fight against ${foes} began.`,
      notice: withNotes(`[COMBAT] The fight begins: ${foes}${friends ? `, with ${friends} at your side` : ""}`, notes),
    };
  },
  start_battle(game, input) {
    if (game.check) throw new Error("A check is already running, so this battle can't start yet. Start it after you've seen the result.");
    const { notes, title, against, with: deck, coming } = startBattle(game, input.battle, { leadIn: input.lead_in ?? null });
    return {
      narration: input.lead_in,
      result: `The battle ${title} began.`,
      notice: withNotes(`[COMBAT] ${title}: ${against} against you, ${deck} with you on the deck${coming ? `, and ${coming} on the way up` : ""}`, notes),
    };
  },
  update_story(game, input) {
    return { result: updateStory(game, input) };
  },
  give_item(game, input, turn) {
    if (turn.itemsGiven >= TURN_LIMITS.itemsGiven) throw new Error("Too many items given this turn. Don't give more.");
    addItem(game, input.item);
    turn.itemsGiven += 1;
    return { result: `Given: ${ITEMS[input.item].name}.`, notice: `[ITEM] Received: ${ITEMS[input.item].name}` };
  },
  take_item(game, input) {
    removeItem(game, input.item);
    return { result: `Removed: ${ITEMS[input.item].name}.`, notice: `[ITEM] Lost: ${ITEMS[input.item].name}` };
  },
  change_credits(game, input, turn) {
    if (input.amount < 0 && game.credits + input.amount < 0) {
      throw new Error(`The player only has ${game.credits} credits and can't afford this. The deal doesn't happen.`);
    }
    let amount = input.amount;
    if (amount > 0) {
      amount = Math.min(amount, TURN_LIMITS.creditsGained - turn.creditsGained);
      if (amount <= 0) throw new Error("The credit limit for this turn has been reached.");
      turn.creditsGained += amount;
    }
    game.credits += amount;
    return { result: `Credits changed by ${amount}. The player now has ${game.credits}.`, notice: `[CREDITS] ${amount > 0 ? "+" : ""}${amount}: ${input.reason}` };
  },
  change_health(game, input, turn) {
    let amount = input.amount;
    if (amount < 0) {
      amount = -Math.min(-amount, TURN_LIMITS.damage - turn.damage);
      turn.damage += -amount;
    } else {
      amount = Math.min(amount, 30);
    }
    const before = game.hp;
    game.hp = clamp(game.hp + amount, 1, maxHp(game));
    const change = game.hp - before;
    return { result: `Health changed by ${change}, now ${game.hp}/${maxHp(game)}.`, notice: `[HEALTH] ${change >= 0 ? "+" : ""}${change}: ${input.reason}` };
  },
  change_stress(game, input, turn) {
    const room = TURN_LIMITS.stress - turn.stress;
    const amount = clamp(input.amount, -room, room);
    if (amount === 0) throw new Error("The stress limit for this turn has been reached.");
    turn.stress += Math.abs(amount);
    const before = game.needs.stress;
    const notes = changeStress(game, amount);
    // A breakdown resets stress, so the change is only meaningful without one.
    const change = notes.length ? amount : game.needs.stress - before;
    return {
      result: `Stress is now ${game.needs.stress}/100.${notes.length ? ` ${notes.join(" ")}` : ""}`,
      notice: withNotes(`[STRESS] ${change >= 0 ? "+" : ""}${change}: ${input.reason} (now ${game.needs.stress}/100)`, notes),
    };
  },
  pass_time(game, input, turn) {
    const hours = clamp(input.hours, 1, 72);
    if (turn.hours + hours > TURN_LIMITS.hours) throw new Error("Too much time has passed this turn already.");
    turn.hours += hours;
    const notes = passTime(game, hours, input.activity);
    return {
      result: `${hours} hours pass. It's now ${clockLabel(game)}. Fatigue ${game.needs.fatigue}/100.${notes.length ? ` ${notes.join(" ")}` : ""}`,
      notice: withNotes(`[TIME] ${input.reason}: ${hours}h pass. It's now ${clockLabel(game)}.`, notes),
    };
  },
  add_condition(game, input) {
    addCondition(game, input.condition);
    const c = CONDITIONS[input.condition];
    return { result: `Applied ${c.name}. It lasts about ${c.hours} hours unless treated.`, notice: `[HEALTH] ${c.name}: ${input.reason}` };
  },
  remove_condition(game, input) {
    if (!removeCondition(game, input.condition)) throw new Error(`The player doesn't have ${CONDITIONS[input.condition].name}.`);
    return { result: `Removed ${CONDITIONS[input.condition].name}.`, notice: `[HEALTH] Recovered from ${CONDITIONS[input.condition].name}: ${input.reason}` };
  },
  shift_ideology(game, input, turn) {
    if (turn.ideologyShifts >= TURN_LIMITS.ideologyShifts) throw new Error("Their beliefs have already shifted enough this turn.");
    turn.ideologyShifts += 1;
    const notes = shiftIdeology(game, input.toward, input.amount);
    return { result: notes.join(" "), notice: withNotes(`[BELIEF] ${input.reason}`, notes) };
  },
  grant_trait(game, input, turn) {
    if (turn.traitChanges >= TURN_LIMITS.traitChanges) throw new Error("Only one trait can change per turn.");
    const trait = TRAITS[input.trait];
    if (game.traits.includes(input.trait)) throw new Error(`The player already has ${trait.name}.`);
    const clash = trait.excludes?.find((id) => game.traits.includes(id));
    if (clash) throw new Error(`${trait.name} can't be combined with ${TRAITS[clash].name}.`);
    if (trait.notSpecies?.includes(game.character.species)) throw new Error(`${trait.name} doesn't apply to this character's species.`);
    turn.traitChanges += 1;
    game.traits.push(input.trait);
    for (const [id, n] of Object.entries(trait.fx?.factions ?? {})) game.factions[id] = clamp(game.factions[id] + n, -100, 100);
    return { result: `Trait gained: ${trait.name}. ${trait.gm ?? trait.desc}`, notice: `[TRAIT] New trait: ${trait.name}. ${input.reason}` };
  },
  remove_trait(game, input, turn) {
    if (turn.traitChanges >= TURN_LIMITS.traitChanges) throw new Error("Only one trait can change per turn.");
    if (!game.traits.includes(input.trait)) throw new Error(`The player doesn't have ${TRAITS[input.trait].name}.`);
    turn.traitChanges += 1;
    game.traits = game.traits.filter((id) => id !== input.trait);
    return { result: `Trait removed: ${TRAITS[input.trait].name}.`, notice: `[TRAIT] No longer: ${TRAITS[input.trait].name}. ${input.reason}` };
  },
  train_skill(game, input, turn) {
    const amount = clamp(input.amount, 1, 20);
    if (turn.training + amount > TURN_LIMITS.training) throw new Error("That's enough training for one turn.");
    turn.training += amount;
    const notes = practice(game, input.skill, amount);
    return { result: `${SKILLS[input.skill].name} practice recorded.${notes.length ? ` ${notes.join(" ")}` : ""}`, notice: withNotes(`[SKILL] Training ${SKILLS[input.skill].name}: ${input.reason}`, notes) };
  },
  change_ship(game, input) {
    const s = game.ship;
    const before = { hull: s.hull, fuel: s.fuel, morale: s.morale };
    s.hull = clamp(s.hull + clamp(input.hull, -30, 30), 1, s.maxHull);
    s.fuel = clamp(s.fuel + clamp(input.fuel, -3, 6), 0, s.maxFuel);
    s.morale = clamp(s.morale + clamp(input.morale, -15, 15), 0, 100);
    const changes = Object.keys(before)
      .filter((key) => s[key] !== before[key])
      .map((key) => `${key[0].toUpperCase()}${key.slice(1)} ${s[key] > before[key] ? "+" : ""}${s[key] - before[key]}`);
    return { result: `Ship is now hull ${s.hull}, fuel ${s.fuel}, morale ${s.morale}.`, notice: `[SHIP] ${changes.length ? `${changes.join(", ")}: ` : ""}${input.reason}` };
  },
  change_command(game, input) {
    const { summary, notice } = changeCommand(game, input);
    return { result: summary, notice };
  },
  change_place(game, input) {
    const { summary, notice } = changePlace(game, input);
    return { result: summary, notice };
  },
  award_xp(game, input, turn) {
    const amount = Math.min(Math.max(input.amount, 0), TURN_LIMITS.xp - turn.xp);
    if (amount <= 0) throw new Error("The XP limit for this turn has been reached.");
    turn.xp += amount;
    const levelUps = grantXp(game, amount);
    return { result: `Awarded ${amount} XP.${levelUps.length ? " The player leveled up." : ""}`, notice: [`[XP] +${amount}: ${input.reason}`, ...levelUps].join("\n") };
  },
  travel(game, input) {
    const { message, notes } = travel(game, input.destination);
    return { result: withNotes(message, notes), notice: withNotes(`[NAV] ${message}`, notes) };
  },
  set_scene(game, input) {
    return { result: setScene(game, input.area, input.people ?? [], { kind: input.kind ?? null, things: input.things ?? [] }) };
  },
  change_faction(game, input) {
    const notice = changeStanding(game, input.faction, clamp(input.amount, -15, 15), input.reason);
    return { result: `${FACTIONS[input.faction].name} standing is now ${game.factions[input.faction]}.`, ...(notice ? { notice } : {}) };
  },
  add_quest(game, input) {
    if (game.quests.some((q) => q.id === input.id)) throw new Error(`A quest with the id ${input.id} already exists. Use update_quest.`);
    if (game.quests.filter((q) => q.status === "active").length >= 12) throw new Error("The quest log is full. Resolve an existing quest first.");
    game.quests.push({ id: input.id, title: input.title, main: false, status: "active", desc: input.description, objective: input.objective });
    noteThreadStarted(game, input.id);
    return { result: `Quest added: ${input.title}.`, notice: `[QUEST] New: ${input.title}` };
  },
  update_quest(game, input) {
    const quest = game.quests.find((q) => q.id === input.id);
    if (!quest) throw new Error(`No quest with the id ${input.id}.`);
    // What it asked before is ticked off in the quest's steps.
    if (quest.objective && quest.objective !== input.objective) quest.done = [...(quest.done ?? []), quest.objective].slice(-20);
    quest.status = input.status;
    quest.objective = input.objective;
    if (input.status !== "active") noteThreadEnded(game, input.id);
    // A story's quest settled the old way still leaves its ending on the record, with its last line.
    if (input.status !== "active" && WORLD_THREADS[input.id] && !endingOf(game, input.id)) recordEnding(game, { id: input.id, ending: null, summary: input.objective, failed: input.status === "failed" });
    const label = input.status === "active" ? "updated" : input.status;
    return { result: `Quest ${input.id} ${label}.`, notice: `[QUEST] ${label}: ${quest.title}` };
  },
  note_contact(game, input) {
    if (input.name.trim().length > 60) throw new Error("That's too long for a name. Use what people call them, and put the rest in the note.");
    // Someone with a file is always listed under their full name, whatever the scene called them.
    const name = findCharacter(game.campaign, input.name)?.name ?? input.name;
    const existing = findContact(game, name);
    if (existing) {
      const before = existing.attitude;
      const statusBefore = existing.status ?? "alive";
      existing.attitude = input.attitude;
      existing.note = input.note;
      if (input.status) existing.status = input.status;
      const changes = [
        before !== input.attitude ? `[RELATION] ${existing.name}: ${before} -> ${input.attitude}` : null,
        input.status && input.status !== statusBefore ? `[RELATION] ${existing.name} is now ${input.status}.` : null,
        ...(input.status === "dead" && statusBefore !== "dead" ? failStoriesWaitingOn(game, name) : []),
      ].filter(Boolean);
      return { result: `Contact ${name} updated.`, ...(changes.length ? { notice: changes.join("\n") } : {}) };
    }
    game.contacts.push({ name, attitude: input.attitude, note: input.note, ...(input.status ? { status: input.status } : {}) });
    ensureContactFiles(game);
    const failed = input.status === "dead" ? failStoriesWaitingOn(game, name) : [];
    return { result: `Contact ${name} added.`, notice: [`[CONTACT] New: ${name}`, ...failed].join("\n") };
  },
  add_journal(game, input) {
    game.journal.push({ turn: game.turn, entry: input.entry });
    return { result: "Journal updated." };
  },
  add_lore(game, input, turn) {
    const term = input.term.trim();
    if (term.length < 2 || term.length > 60) throw new Error("The term must be between 2 and 60 characters.");
    if (hasStaticLore(term)) throw new Error(`${term} already has a codex entry.`);
    const existing = game.lore.find((entry) => entry.name.toLowerCase() === term.toLowerCase());
    if (existing) {
      existing.kind = input.kind;
      existing.text = input.text;
      return { result: `Codex entry updated: ${term}.` };
    }
    if (turn.loreEntries >= TURN_LIMITS.loreEntries || game.lore.length >= 300) throw new Error("That's enough new codex entries for now.");
    turn.loreEntries += 1;
    game.lore.push({ id: `custom:${game.lore.length}`, name: term, kind: input.kind, text: input.text });
    return { result: `Codex entry added: ${term}.`, notice: `[LORE] New codex entry: ${term}` };
  },
};

function checkValue(key, spec, value) {
  if (spec.type === "string" && typeof value !== "string") return `"${key}" must be text.`;
  if (spec.type === "boolean" && typeof value !== "boolean") return `"${key}" must be true or false.`;
  if (spec.type === "integer" && !Number.isInteger(value)) return `"${key}" must be a whole number.`;
  if (spec.type === "array" && !Array.isArray(value)) return `"${key}" must be a list.`;
  if (spec.type === "array") {
    for (const entry of value) {
      const problem = checkValue(key, spec.items, entry);
      if (problem) return problem;
    }
  }
  if (spec.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return `"${key}" must be an object.`;
    for (const field of spec.required ?? []) {
      if (value[field] === undefined) return `"${key}" is missing "${field}".`;
    }
    for (const [field, inner] of Object.entries(spec.properties ?? {})) {
      const problem = value[field] === undefined ? null : checkValue(field, inner, value[field]);
      if (problem) return problem;
    }
  }
  if (spec.enum && !spec.enum.includes(value)) return `"${key}" must be one of: ${spec.enum.join(", ")}.`;
  if (spec.type === "string" && value.length > 1200) return `"${key}" is too long.`;
  return null;
}

// Checks a request against its definition, because a file written by hand isn't guaranteed to be right.
function validate(def, input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "Input must be an object.";
  const { properties, required } = def.input_schema;
  for (const key of required) {
    if (input[key] === undefined) return `Missing "${key}".`;
  }
  for (const [key, spec] of Object.entries(properties)) {
    const value = input[key];
    const optional = !required.includes(key);
    if (optional && (value === undefined || value === null || value === "")) continue;
    const problem = checkValue(key, spec, value);
    if (problem) return problem;
  }
  return null;
}

export function newTurnLimits() {
  return { xp: 0, creditsGained: 0, itemsGiven: 0, damage: 0, stress: 0, ideologyShifts: 0, traitChanges: 0, hours: 0, training: 0, loreEntries: 0 };
}

// The clock stands still in a talk window, and the player stays where they are, so these can't happen there.
const NOT_IN_A_TALK = ["pass_time", "travel", "set_scene"];

// What's wrong with a call before it's made, for checking written scenes. Null means it would be accepted.
export function toolProblem(name, input) {
  const def = TOOL_DEFS.find((t) => t.name === name);
  return def ? validate(def, input) : `Unknown tool: ${name}`;
}

export function runTool(game, name, input, turn) {
  const def = TOOL_DEFS.find((t) => t.name === name);
  if (!def) return { result: `Unknown tool: ${name}`, isError: true };
  if (turn?.talking && NOT_IN_A_TALK.includes(name)) return { result: "The clock is stopped in a talk window, and the player stays where they are, so that can't happen in a conversation.", isError: true };
  const problem = validate(def, input);
  if (problem) return { result: problem, isError: true };
  try {
    return handlers[name](game, input, turn);
  } catch (err) {
    return { result: err.message, isError: true };
  }
}

// A story person who dies of their wounds (src/death.js): their contact is dead, and so is any story that was waiting on
// them. The rules can't load this file, so it tells the deaths what to do.
tellContactDied((game, name) => {
  const contact = findContact(game, name);
  const before = contact?.status ?? "alive";
  if (contact) contact.status = "dead";
  return [...(contact && before !== "dead" ? [`[RELATION] ${contact.name} is now dead.`] : []), ...failStoriesWaitingOn(game, name)];
});
