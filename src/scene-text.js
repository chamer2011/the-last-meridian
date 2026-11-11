// Reads a scene written as plain text, the way world/scenes/_how-to-write-a-scene.txt explains it, into
// the parts the game plays. Every mistake is reported with its line, in plain words, and nothing here
// touches the game: it only reads.

import { POLES, SKILLS } from "./character-data.js";
import { FACTIONS, ITEMS, LOCATIONS, STATS } from "./data.js";
import { START_LIST } from "./role.js";
import { endedWith } from "./record.js";
import { DIFFICULTY, attr, maxHp, skillRank } from "./rules.js";
import { WORLD_THREADS, endingsOf } from "./world.js";
import { partsWaitingIds, systemHolds } from "./systems.js";
import { stockOf, storeByWords, storeNames } from "./logistics.js";

// The ship whose stores "stock" counts. Spelt here rather than taken from src/ship.js, which reads scenes itself.
const SHIP_ID = "meridian";
import { MUTINY_CONDITIONS, MUTINY_OUTCOMES, commandWords, knownPerson, loyaltyFor, mutinyHolds, storyHolds } from "./command.js";

// Two people written one after the other, as in "* remember marrow tarrow -10": the first split where both are someone.
function splitPeople(words) {
  for (let i = 1; i < words.length; i += 1) {
    const one = words.slice(0, i).join(" ");
    const other = words.slice(i).join(" ");
    if (knownPerson(one) && knownPerson(other)) return [one, other];
  }
  return null;
}
import { systemIdOf } from "../public/systems-text.js";

// The place's systems, in conditions and effects: "power off in The Docks", "alarm ringing at haven", "door locked
// The Hook". What each one's state can be, asked about and made so.
const SYSTEM_STATES = {
  power: ["on", "off"], lights: ["on", "off"], air: ["good", "thin", "bad", "on", "off"], cameras: ["on", "off"], alarm: ["ringing", "quiet", "on", "off"],
  comms: ["on", "jammed", "off"], engines: ["on", "off"], navigation: ["on", "off"], docking: ["locked", "released"], door: ["locked", "open"], system: ["on", "off"],
};
const SYSTEM_SETS = {
  power: ["on", "off"], lights: ["on", "off"], air: ["on", "off"], cameras: ["on", "off"], alarm: ["ringing", "quiet", "on", "off"],
  comms: ["on", "jammed"], engines: ["on", "off"], navigation: ["on", "off"], docking: ["locked", "released"], door: ["locked", "unlocked"], system: ["on", "off"],
};
function systemWords(kind, words, raw, setting = false) {
  let system = kind === "camera" ? "cameras" : kind;
  let rest = [...words];
  if (system === "system") {
    system = systemIdOf(rest.shift() ?? "");
    if (!system) return { problem: `"system" needs the system's name, as its file has it: "${raw}"` };
  }
  const states = (setting ? SYSTEM_SETS : SYSTEM_STATES)[kind === "camera" ? "cameras" : kind] ?? ["on", "off"];
  const state = rest.shift()?.toLowerCase();
  if (!states.includes(state)) return { problem: `${kind} needs one of ${states.join(", ")}: "${raw}"` };
  let place = null;
  if (rest.length >= 2 && rest.at(-2).toLowerCase() === "at") {
    place = rest.at(-1);
    rest = rest.slice(0, -2);
    if (!LOCATIONS[place]) return { problem: `there's no place called ${place}` };
  }
  let room = null;
  if (rest[0]?.toLowerCase() === "here") {
    room = "here";
    rest.shift();
  } else if (rest[0]?.toLowerCase() === "in") {
    room = rest.slice(1).join(" ");
    rest = [];
    if (!room) return { problem: `"in" needs a room's name after it: "${raw}"` };
  } else if (system === "door" && rest.length) {
    room = rest.join(" ");
    rest = [];
  }
  if (system === "door" && !room) return { problem: `door needs the room the door leads into: "${raw}"` };
  if (rest.length) return { problem: `"${raw}" has words the game doesn't follow: ${rest.join(" ")}` };
  return { system, state, room, place };
}

const ATTITUDES = ["hostile", "wary", "neutral", "friendly", "ally"];
const QUEST_STATES = { active: "active", done: "completed", completed: "completed", failed: "failed", none: "none" };
const COMPARE = { ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, "<": (a, b) => a < b, "=": (a, b) => a === b, "==": (a, b) => a === b, "!=": (a, b) => a !== b };
const GOES_TO = ["pass", "fail", "won", "lost", "fled", "gaveUp", "talked"];
const FIGHT_FIELDS = ["enemy", "lead_in", "called", "enemy_followers", "allies", "arrivals", "why", "reason", "faction"];
const FIGHT_LISTS = ["enemy_followers", "allies"];

// ---- Conditions ----------------------------------------------------------------

// A condition is terms joined with "and", each of which can start with "not". What each one looks at
// is in the how-to file. This turns the words into something the game can test, and says what's wrong.
export function parseCondition(text) {
  const terms = [];
  const problems = [];
  for (const raw of String(text).split(/\s+and\s+/i)) {
    const words = raw.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      problems.push("an empty condition");
      continue;
    }
    const not = words[0].toLowerCase() === "not";
    if (not) words.shift();
    const [kind, ...rest] = words;
    const term = { not, kind: kind?.toLowerCase(), raw: raw.trim() };
    const compare = (what, name) => {
      const [id, op, amount] = rest;
      if (!id || !COMPARE[op] || !/^-?\d+$/.test(amount ?? "")) return problems.push(`${what} needs ${name ? `a ${name}, ` : ""}one of >= <= > < = !=, and a number: "${raw.trim()}"`);
      Object.assign(term, { id, op, amount: Number(amount) });
    };
    switch (term.kind) {
      case "has":
        if (!ITEMS[rest[0]]) problems.push(`there's no item called ${rest[0] ?? "nothing"}`);
        term.id = rest[0];
        break;
      case "flag":
      case "seen":
      case "met":
      case "likes":
      case "dislikes":
        if (!rest.length) problems.push(`"${term.kind}" needs a name after it`);
        term.id = rest.join(" ");
        break;
      case "ended": {
        const [story, ending, extra] = rest;
        const names = endingsOf(WORLD_THREADS[story]).map((one) => one.id);
        if (!WORLD_THREADS[story]) problems.push(`there's no story called ${story ?? "nothing"}. The ids are the file names in world/stories`);
        else if (ending && !names.includes(ending)) problems.push(`${story} has no ending called ${ending}. Its endings are ${names.join(", ")}`);
        else if (extra) problems.push(`"ended" takes a story's id and, if you want, one of its endings: "${raw.trim()}"`);
        term.id = story;
        term.ending = ending ?? null;
        break;
      }
      case "captain":
        break;
      case "life":
        if (!START_LIST[rest[0]]) problems.push(`there's no life called ${rest[0] ?? "nothing"}. The ids are in starts.json`);
        term.id = rest[0];
        break;
      case "at":
        if (!LOCATIONS[rest[0]]) problems.push(`there's no place called ${rest[0] ?? "nothing"}`);
        term.id = rest[0];
        break;
      case "quest":
        if (!rest[0] || !QUEST_STATES[rest[1]]) problems.push(`"quest" needs a quest's id and one of active, done, failed or none: "${raw.trim()}"`);
        term.id = rest[0];
        term.state = QUEST_STATES[rest[1]];
        break;
      case "skill":
        compare("skill", "skill");
        if (term.id && !SKILLS[term.id]) problems.push(`there's no skill called ${term.id}`);
        break;
      case "stat":
        compare("stat", "stat");
        if (term.id && !STATS[term.id]) problems.push(`there's no stat called ${term.id}`);
        break;
      case "faction":
        compare("faction", "faction");
        if (term.id && !FACTIONS[term.id]) problems.push(`there's no faction called ${term.id}`);
        break;
      case "belief":
        compare("belief", "belief");
        if (term.id && !POLES[term.id]) problems.push(`there's no belief called ${term.id}`);
        break;
      case "stock": {
        // How many of an item the Meridian's stores hold, all of them or one: stock medicine_crate < 2, stock
        // ration_crate < 1 in the pantry. The item by its id, as for "has"; the store by its name in the logistics file.
        const cut = rest.findIndex((word) => word.toLowerCase() === "in");
        const head = cut >= 0 ? rest.slice(0, cut) : rest;
        const store = cut >= 0 ? rest.slice(cut + 1).join(" ") : null;
        const [id, op, amount] = head;
        if (head.length !== 3 || !COMPARE[op] || !/^-?\d+$/.test(amount ?? "")) problems.push(`"stock" needs an item's id, one of >= <= > < = !=, and a number, and can end with in and a store: "${raw.trim()}"`);
        else if (!ITEMS[id]) problems.push(`there's no item called ${id}`);
        else if (store !== null && !storeByWords(SHIP_ID, store)) problems.push(`the Meridian has no store called ${store || "nothing"}: its stores are ${storeNames(SHIP_ID).join(", ")}`);
        Object.assign(term, { id, op, amount: Number(amount), store });
        break;
      }
      case "fuel":
      case "credits":
      case "stress":
      case "health":
      case "day":
      case "level":
      case "act":
      case "chance": {
        // chance 30 is true 30 times in 100: a number from 1 to 100 comes up at or under it.
        const [op, amount] = term.kind === "chance" ? ["<=", rest[0]] : rest;
        if (!COMPARE[op] || !/^-?\d+$/.test(amount ?? "")) problems.push(`"${term.kind}" needs ${term.kind === "chance" ? "a number out of 100" : "one of >= <= > < = != and a number"}: "${raw.trim()}"`);
        Object.assign(term, { op, amount: Number(amount) });
        break;
      }
      case "power":
      case "lights":
      case "air":
      case "cameras":
      case "camera":
      case "alarm":
      case "comms":
      case "engines":
      case "navigation":
      case "docking":
      case "door":
      case "system": {
        const found = systemWords(term.kind, rest, raw.trim());
        if (found.problem) problems.push(found.problem);
        else Object.assign(term, found, { kind: "system" });
        break;
      }
      case "holds": {
        // Who holds a post in the ship's chain of command: holds quartermaster odessa, holds first_officer you, holds
        // chief_engineer nobody. The post by its id, then someone by their id or name, you or nobody.
        const { posts } = commandWords();
        const post = rest[0]?.toLowerCase();
        const who = rest.slice(1).join(" ");
        if (!post || !posts.has(post)) problems.push(`"holds" is followed by a post, by its id (${[...posts].join(", ")}), then who: "${raw.trim()}"`);
        else if (!who || !knownPerson(who)) problems.push(`there's nobody called ${who || "nothing"} aboard for "holds": write their id or name, you, or nobody`);
        Object.assign(term, { id: post, who });
        break;
      }
      case "job": {
        // What someone does on the watch bill: job Cook Imre cook, job odessa spare.
        const { jobs } = commandWords();
        const job = rest.at(-1)?.toLowerCase();
        const who = rest.slice(0, -1).join(" ");
        if (!job || !jobs.has(job)) problems.push(`"job" is followed by someone, then a job by its id (${[...jobs].join(", ")}): "${raw.trim()}"`);
        else if (!who || !knownPerson(who)) problems.push(`there's nobody called ${who || "nothing"} aboard for "job"`);
        Object.assign(term, { id: job, who });
        break;
      }
      case "loyalty": {
        // How loyal someone is to the captain, from 0 to 100: loyalty marrow < 40.
        const [op, amount] = rest.slice(-2);
        const who = rest.slice(0, -2).join(" ");
        if (!COMPARE[op] || !/^-?\d+$/.test(amount ?? "")) problems.push(`"loyalty" needs someone, one of >= <= > < = !=, and a number: "${raw.trim()}"`);
        else if (!who || !knownPerson(who)) problems.push(`there's nobody called ${who || "nothing"} aboard for "loyalty"`);
        Object.assign(term, { who, op, amount: Number(amount) });
        break;
      }
      case "repairs":
        // Something aboard the Meridian is broken and the engineers can't mend it for want of a parts crate.
        if (rest.join(" ").toLowerCase() !== "waiting") problems.push(`"repairs" is followed by waiting: "${raw.trim()}"`);
        break;
      case "mutiny": {
        // The ship's chain of command: how far a mutiny's got, whether security would arrest its ringleader, and
        // whether the officers would have the player back in the chair.
        const words = rest.join(" ").toLowerCase();
        if (!MUTINY_CONDITIONS.includes(words)) problems.push(`"mutiny" is followed by one of ${MUTINY_CONDITIONS.join(", ")}: "${raw.trim()}"`);
        term.id = words;
        break;
      }
      default:
        problems.push(`"${raw.trim()}" isn't a condition the game knows`);
    }
    terms.push(term);
  }
  return { terms, problems };
}

const attitudeRank = (attitude) => ATTITUDES.indexOf(attitude ?? "neutral");

// Whether one term is true for this game right now.
function termHolds(game, term, helpers) {
  const { attr, skillRank, maxHp } = helpers;
  const contact = (name) => game.contacts?.find((one) => one.name.toLowerCase() === name.toLowerCase() || one.name.toLowerCase().endsWith(` ${name.toLowerCase()}`));
  const beliefToward = (pole) => (POLES[pole] ? (game.ideology?.[POLES[pole].axis] ?? 0) * POLES[pole].sign : 0);
  const numbers = {
    credits: () => game.credits,
    stress: () => game.needs?.stress ?? 0,
    health: () => Math.round((game.hp / Math.max(1, maxHp(game))) * 100),
    day: () => Math.floor((game.clock?.hours ?? 0) / 24) + 1,
    level: () => game.level,
    act: () => game.story?.act ?? 1,
    // The Meridian's jump fuel, which keeping station and every jump burn.
    fuel: () => game.ship?.fuel ?? 0,
    skill: () => skillRank(game, term.id),
    stat: () => attr(game, term.id),
    faction: () => game.factions?.[term.id] ?? 0,
    belief: () => beliefToward(term.id),
    chance: () => Math.floor(Math.random() * 100) + 1,
  };
  let result;
  switch (term.kind) {
    case "has": result = (game.inventory?.[term.id] ?? 0) > 0; break;
    case "flag": result = Boolean(game.flags?.[term.id]); break;
    case "ended": result = endedWith(game, term.id, term.ending); break;
    // In a conversation, "seen" is what's been said in it; in a scene, the parts the player has been through.
    case "seen": result = Boolean((helpers.seen ?? game.scene?.seen)?.includes(term.id)); break;
    case "met": result = Boolean(contact(term.id)); break;
    case "likes": result = attitudeRank(contact(term.id)?.attitude) >= attitudeRank("friendly"); break;
    case "dislikes": result = Boolean(contact(term.id)) && attitudeRank(contact(term.id)?.attitude) <= attitudeRank("wary"); break;
    case "captain": result = game.role?.captain !== false; break;
    case "life": result = (game.role?.id ?? "captain") === term.id; break;
    case "at": result = game.location === term.id; break;
    case "system": result = systemHolds(game, term); break;
    case "stock": {
      const n = stockOf(game, SHIP_ID, term.id, term.store);
      result = n !== null && COMPARE[term.op](n, term.amount);
      break;
    }
    case "mutiny": result = mutinyHolds(game, term.id); break;
    case "repairs": result = partsWaitingIds(game, SHIP_ID).length > 0; break;
    case "holds":
    case "job": result = storyHolds(game, term); break;
    case "loyalty": result = COMPARE[term.op](loyaltyFor(game, term.who), term.amount); break;
    case "quest": {
      const quest = game.quests?.find((one) => one.id === term.id);
      result = term.state === "none" ? !quest : quest?.status === term.state;
      break;
    }
    default:
      result = numbers[term.kind] ? COMPARE[term.op](numbers[term.kind](), term.amount) : false;
  }
  return term.not ? !result : result;
}

// Whether a whole condition holds. A condition with a mistake in it never holds, so a misspelt one can't open a door by accident.
export function conditionHolds(game, text, helpers = { attr, skillRank, maxHp }) {
  const { terms, problems } = parseCondition(text);
  if (problems.length) return false;
  return terms.every((term) => termHolds(game, term, helpers));
}

// ---- Effects --------------------------------------------------------------------

const signed = (text) => (/^[+-]?\d+$/.test(text) ? Number(text) : null);

// One "* ..." line, turned into one of the game's actions, or a flag for the scene to remember.
export function parseEffect(text) {
  const line = text.trim();
  const [head, ...restOfLine] = line.split(":");
  const after = restOfLine.join(":").trim();
  const words = head.trim().split(/\s+/);
  const verb = words[0]?.toLowerCase();
  const need = (ok, message) => (ok ? null : message);
  switch (verb) {
    case "journal":
      return after ? { do: { tool: "add_journal", entry: after } } : { problem: "journal needs the words to write down, after a colon" };
    case "xp": {
      const amount = signed(words[1] ?? "");
      return amount && after ? { do: { tool: "award_xp", amount, reason: after } } : { problem: "xp needs a number, then a colon and the reason: * xp 10: Your first order" };
    }
    case "credits": {
      const amount = signed(words[1] ?? "");
      return amount !== null && after ? { do: { tool: "change_credits", amount, reason: after } } : { problem: "credits needs a number, with - to charge, then a colon and the reason: * credits -20: A round of drinks" };
    }
    case "stress":
    case "health": {
      const amount = signed(words[1] ?? "");
      return amount !== null && after ? { do: { tool: verb === "stress" ? "change_stress" : "change_health", amount, reason: after } } : { problem: `${verb} needs a number, with - to lower it, then a colon and the reason` };
    }
    case "item": {
      const what = words[1] ?? "";
      const taking = what.startsWith("-");
      const id = what.replace(/^[+-]/, "");
      return ITEMS[id] ? { do: { tool: taking ? "take_item" : "give_item", item: id } } : { problem: `there's no item called ${id || "nothing"}` };
    }
    case "quest": {
      const id = words[1];
      const state = QUEST_STATES[words[2]?.toLowerCase()] ?? "active";
      if (!id || !after || state === "none") return { problem: "quest needs the quest's id, done or failed if it's over, then a colon and what the objective is now: * quest the_beacon: Find the scholar" };
      return { do: { tool: "update_quest", id, status: state, objective: after } };
    }
    case "new": {
      const [title, description, objective] = after.split("|").map((part) => part.trim());
      if (words[1]?.toLowerCase() !== "quest" || !words[2] || !title || !description || !objective) return { problem: "a new quest is written * new quest its_id: Title | what it's about | what to do first" };
      return { do: { tool: "add_quest", id: words[2], title, description, objective } };
    }
    case "contact": {
      const attitude = words.at(-1)?.toLowerCase();
      const name = words.slice(1, -1).join(" ");
      return name && ATTITUDES.includes(attitude) && after ? { do: { tool: "note_contact", name, attitude, note: after } } : { problem: "contact needs a name, how they feel (hostile, wary, neutral, friendly or ally), then a colon and a note: * contact Ilya Voss friendly: You asked her first" };
    }
    case "belief": {
      const amount = signed(words[2] ?? "");
      return POLES[words[1]] && amount > 0 && amount <= 3 && after ? { do: { tool: "shift_ideology", toward: words[1], amount, reason: after } } : { problem: `belief needs one of ${Object.keys(POLES).join(", ")}, a number from 1 to 3, then a colon and the reason` };
    }
    case "faction": {
      const amount = signed(words[2] ?? "");
      return FACTIONS[words[1]] && amount !== null && after ? { do: { tool: "change_faction", faction: words[1], amount, reason: after } } : { problem: "faction needs a faction's id, a number with - to lower it, then a colon and the reason: * faction fleet 2: They heard the truth" };
    }
    case "time": {
      const hours = signed(words[1] ?? "");
      const activity = ["active", "work", "rest"].includes(words[3]?.toLowerCase()) ? words[3].toLowerCase() : "active";
      if (hours > 72) return { problem: "time can pass at most 72 hours in one part: use another part for the rest, or let the story say it took longer" };
      return hours > 0 && /^hours?$/i.test(words[2] ?? "") && after ? { do: { tool: "pass_time", hours, activity, reason: after } } : { problem: "time is written * time 2 hours: A long talk, with work or rest after hours if that's what it was" };
    }
    case "ending": {
      // The scene's own story ends, by one of the endings named in its notes; failed marks the quest lost.
      const name = words[1]?.toLowerCase();
      const failed = words[2]?.toLowerCase() === "failed";
      if (!name || !after || words.length > (failed ? 3 : 2)) return { problem: "ending is written * ending its_name: How it ended, with a name from the story's file in world/stories, and failed before the colon if the player lost it" };
      return { do: { ending: name, ...(failed ? { failed: true } : {}), text: after } };
    }
    case "flag":
    case "unflag": {
      const name = words.slice(1).join(" ");
      if (!name) return { problem: `${verb} needs a name after it` };
      // A flag with words after a colon is a fact the player can read on the record.
      return { do: verb === "flag" ? { set: name, ...(after ? { text: after } : {}) } : { clear: name } };
    }
    case "stores": {
      // What's aboard the Meridian: * stores food 40, medicine -2: The reason. Fuel has its own line.
      const stores = {};
      const pieces = head.trim().slice(verb.length).split(",").map((piece) => piece.trim()).filter(Boolean);
      for (const piece of pieces) {
        const [name, number, ...more] = piece.split(/\s+/);
        const amount = signed(number ?? "");
        if (!["food", "medicine", "parts"].includes(name) || amount === null || amount === 0 || more.length) return { problem: "stores is written * stores food 40, medicine -2: The reason, with food, medicine or parts and a number each, and a minus sign to use some up" };
        stores[name] = amount;
      }
      return pieces.length && after ? { do: { stores, reason: after } } : { problem: "stores needs food, medicine or parts and a number each, then a colon and the reason: * stores food 40: Parcels from Kessara" };
    }
    case "fuel": {
      const amount = signed(words[1] ?? "");
      return amount !== null && amount !== 0 && after ? { do: { tool: "change_ship", hull: 0, fuel: amount, morale: 0, reason: after } } : { problem: "fuel needs a number, with - to burn it, then a colon and the reason: * fuel 6: Mother Quill's depot" };
    }
    case "appoint": {
      // Someone given a post: * appoint quartermaster tobin: reason. Whoever chooses for it appoints them.
      const { posts, chairs } = commandWords();
      const post = words[1]?.toLowerCase();
      const who = words.slice(2).join(" ");
      if (!post || !posts.has(post)) return { problem: `appoint is written * appoint a_post someone: reason, with the post by its id (${[...posts].join(", ")})` };
      if (chairs.has(post)) return { problem: "the captain's chair changes hands through the story's change of command, or a mutiny, not appoint" };
      if (!who || !knownPerson(who) || /^(you|nobody)$/i.test(who)) return { problem: `there's nobody called ${who || "nothing"} aboard to appoint: write their id or name (the player can't be given a post yet)` };
      return after ? { do: { command: "appoint", post, who, reason: after } } : { problem: "appoint needs a colon and the reason after it" };
    }
    case "relieve": {
      // Someone relieved of their post: * relieve chief_engineer: reason. Whoever chooses for it gives it to someone else.
      const { posts, chairs } = commandWords();
      const post = words[1]?.toLowerCase();
      if (!post || !posts.has(post) || words.length > 2) return { problem: `relieve is written * relieve a_post: reason, with the post by its id (${[...posts].join(", ")})` };
      if (chairs.has(post)) return { problem: "the captain's chair changes hands through the story's change of command, or a mutiny, not relieve" };
      return after ? { do: { command: "relieve", post, reason: after } } : { problem: "relieve needs a colon and the reason after it" };
    }
    case "assign": {
      // Someone moved on the watch bill: * assign Yusuf cook: reason, or spare for the spare hands.
      const { jobs } = commandWords();
      const job = words.at(-1)?.toLowerCase();
      const who = words.slice(1, -1).join(" ");
      if (!job || !jobs.has(job)) return { problem: `assign is written * assign someone a_job: reason, with the job by its id (${[...jobs].join(", ")})` };
      if (!who || !knownPerson(who) || /^nobody$/i.test(who)) return { problem: `there's nobody called ${who || "nothing"} aboard to move on the watch bill` };
      return after ? { do: { command: "assign", who, job, reason: after } } : { problem: "assign needs a colon and the reason after it" };
    }
    case "loyalty": {
      // Someone's loyalty to the captain, moved by the story: * loyalty marrow -10: reason. It fades as memories do.
      const amount = signed(words.at(-1) ?? "");
      const who = words.slice(1, -1).join(" ");
      if (amount === null || amount === 0) return { problem: "loyalty is written * loyalty someone -10: reason, with a number, a minus sign to lower it" };
      if (!who || !knownPerson(who) || /^(you|nobody)$/i.test(who)) return { problem: `there's nobody called ${who || "nothing"} aboard whose loyalty can change` };
      return after ? { do: { command: "loyalty", who, amount, reason: after } } : { problem: "loyalty needs a colon and the reason after it" };
    }
    case "remember": {
      // Someone left remembering something of someone else, for or against them: * remember marrow tarrow -10: reason.
      const amount = signed(words.at(-1) ?? "");
      const pair = splitPeople(words.slice(1, -1));
      if (amount === null || amount === 0) return { problem: "remember is written * remember someone someone_else -10: reason, with a number, a minus sign for a grudge" };
      if (!pair || /^(you|nobody)$/i.test(pair[0]) || /^nobody$/i.test(pair[1])) return { problem: "remember needs who remembers it and who it's of, each someone aboard by their id or name (or you, for who it's of)" };
      return after ? { do: { command: "remember", who: pair[0], other: pair[1], amount, reason: after } } : { problem: "remember needs a colon and the reason after it" };
    }
    case "mutiny": {
      // How a delegation, a quiet word or a captain's days in the brig end: src/command.js plays each.
      const word = words.slice(1).join(" ").toLowerCase();
      return MUTINY_OUTCOMES.includes(word) && after ? { do: { mutiny: word, reason: after } } : { problem: `mutiny needs what happens, one of ${MUTINY_OUTCOMES.join(", ")}, then a colon and the reason: * mutiny give ground: The captain heard them out` };
    }
    case "act": {
      const act = Number(words[1]);
      return Number.isInteger(act) && act >= 1 && words.length === 2 && !after ? { do: { tool: "update_story", act } } : { problem: "act needs the act's number and nothing else: * act 2" };
    }
    case "power":
    case "lights":
    case "air":
    case "cameras":
    case "camera":
    case "alarm":
    case "comms":
    case "engines":
    case "navigation":
    case "docking":
    case "system": {
      if (after) return { problem: `${verb} takes no colon: * ${verb} off in The Docks` };
      const found = systemWords(verb, words.slice(1), line, true);
      return found.problem ? { problem: found.problem } : { do: { systems: found } };
    }
    case "fix":
    case "break": {
      // * fix everything, * fix power in The Docks, * break engines at meridian
      const rest = words.slice(1);
      const what = rest[0] && !["in", "here", "at"].includes(rest[0].toLowerCase()) ? rest.shift().toLowerCase() : verb === "fix" ? "everything" : null;
      if (!what) return { problem: "break needs the system to break: * break engines" };
      const found = systemWords("system", ["x", "on", ...rest], line, true);
      if (found.problem) return { problem: found.problem.replace(/"system"/, `"${verb}"`) };
      return after ? { problem: `${verb} takes no colon` } : { do: { systems: { system: verb, what: what === "everything" ? "everything" : systemIdOf(what), room: found.room, place: found.place } } };
    }
    case "door": {
      // Locks or unlocks a door the place's systems run: * door locked The Hook.
      if (["locked", "unlocked"].includes(words[1]?.toLowerCase())) {
        const found = systemWords("door", words.slice(1), line, true);
        return found.problem ? { problem: found.problem } : { do: { systems: found } };
      }
      // Opens a door in this place: the one a computer controls, or the door to a room by its id.
      const to = words[1] ?? "here";
      return words.length <= 2 && !after ? { do: { door: to } } : { problem: "door is written * door here, or * door with the id of the room the door leads to" };
    }
    case "password": {
      // The player learns a computer's password, and gets in without a hack from then on.
      const [, computer, ...rest] = words;
      const word = rest.join(" ");
      return computer && word && !after ? { do: { password: computer, word } } : { problem: "password is written * password <the computer's id> <the word>" };
    }
    case "computer": {
      // Sits the player down at a computer, as if they'd used it.
      return words[1] && words.length === 2 && !after ? { do: { computer: words[1] } } : { problem: "computer is written * computer <the computer's id>" };
    }
    case "raw": {
      const tool = words[1];
      try {
        const input = JSON.parse(line.slice(line.indexOf("{")));
        // The fleet's old tool, in a draft written when there was one: it's the ship's stores now, and the rest of it is let go.
        if (tool === "change_fleet" && input && typeof input === "object") {
          const stores = Object.fromEntries(["food", "medicine", "parts"].filter((key) => Number.isFinite(input[key]) && input[key] !== 0).map((key) => [key, input[key]]));
          return Object.keys(stores).length ? { do: { stores, reason: String(input.reason ?? "") } } : { problem: "change_fleet is the fleet's old tool: write * stores food 40: The reason for the ship's stores, and leave the rest out" };
        }
        return tool && input && typeof input === "object" ? { do: { tool, ...input } } : { problem: "raw needs a tool's name and its fields in braces" };
      } catch {
        return { problem: "raw needs a tool's name and its fields in braces, written the way JSON is" };
      }
    }
    default:
      return { problem: `"${verb ?? ""}" isn't an effect the game knows. The how-to file lists them` };
  }
}

// ---- The file ---------------------------------------------------------------------

const CHECK_TAG = /^([a-z_]+):([a-z_]+)(?::([^\]]+))?$/;

// Splits "> [tags] words -> a | b ? condition" into its pieces.
function parseChoice(text, line) {
  const problems = [];
  let rest = text.trim();
  let condition = null;
  const asked = rest.match(/^(.*?)\s\?\s+(.+)$/);
  if (asked) {
    rest = asked[1].trim();
    condition = asked[2].trim();
  }
  const arrow = rest.lastIndexOf("->");
  if (arrow < 0) problems.push({ line, message: "a choice needs -> and the part it leads to" });
  const words = arrow < 0 ? rest : rest.slice(0, arrow).trim();
  const targets = arrow < 0 ? [] : rest.slice(arrow + 2).split("|").map((one) => one.trim()).filter(Boolean);
  const tags = [];
  let check = null;
  let say = words;
  const tagged = say.match(/^((?:\[[^\]]+\]\s*)+)(.*)$/);
  if (tagged) {
    say = tagged[2].trim();
    for (const token of tagged[1].match(/\[([^\]]+)\]/g).map((one) => one.slice(1, -1).trim())) {
      const asCheck = token.match(CHECK_TAG);
      if (asCheck && SKILLS[asCheck[1]] && asCheck[2] in DIFFICULTY && !check) check = token;
      else tags.push(token);
    }
  }
  if (!say) problems.push({ line, message: "a choice needs words for the player to pick" });
  const choice = { say, line };
  if (tags.length) choice.tags = tags;
  if (condition) choice.if = condition;
  if (check) {
    choice.check = check;
    if (targets.length === 2) [choice.pass, choice.fail] = targets;
    else problems.push({ line, message: "a choice with a check needs two parts after the arrow, pass | fail" });
  } else if (targets.length === 1) {
    choice.to = targets[0];
  } else if (targets.length > 1) {
    problems.push({ line, message: "only a choice with a check leads two ways: put [skill:difficulty] at the front, or keep one part after the arrow" });
  }
  return { choice, problems };
}

// The lines on top of a request, and what each is kept as.
const REQUEST_KEYS = { when: "when", asks: "asks", needs: "needs", by: "by", "gone when": "gone", "handed to": "handed" };
const REQUEST_LINE = /^(when|asks|needs|by|gone\s+when|handed\s+to):\s*(.*)$/i;

// Reads one file's text. parts come out in the shape src/scenes.js plays, and problems say what to fix.

export function parseSceneText(text, name = "the scene") {
  const scene = { title: null, start: null, parts: {} };
  const problems = [];
  const lines = String(text).replaceAll("\r\n", "\n").split("\n");
  let part = null;
  let partId = null;
  let paragraph = [];
  let block = null;
  const problem = (line, message) => problems.push({ line, message });
  const flush = () => {
    if (paragraph.length) part.text.push(paragraph.join(" "));
    paragraph = [];
  };
  const closeBlock = () => {
    if (!block) return;
    const { kind, fields, outcomes, line } = block;
    if (kind === "CHECK") {
      part.check = fields.check;
      if (fields.reason) part.reason = fields.reason;
      if (fields.scene) part.scene = fields.scene;
      for (const key of ["pass", "fail"]) if (outcomes[key]) part[key] = outcomes[key];
      for (const key of Object.keys(outcomes)) if (!["pass", "fail"].includes(key)) problem(line, `a CHECK only has pass and fail, not ${key}`);
    } else {
      const fight = {};
      for (const [key, value] of Object.entries(fields)) {
        if (!FIGHT_FIELDS.includes(key)) {
          problem(line, `a FIGHT doesn't have ${key}. It has ${FIGHT_FIELDS.join(", ")}`);
          continue;
        }
        if (FIGHT_LISTS.includes(key)) fight[key] = value.split(",").map((one) => one.trim()).filter(Boolean);
        else if (key === "arrivals") {
          fight.arrivals = value.split(",").map((one) => one.trim()).filter(Boolean).map((one) => {
            const [who, side, round] = one.split(/\s+/);
            return { who, side, round: Number(round) };
          });
        } else fight[key] = value;
      }
      part.fight = fight;
      for (const key of GOES_TO) if (outcomes[key]) part[key] = outcomes[key];
      for (const key of Object.keys(outcomes)) if (!["won", "lost", "fled", "gaveUp", "talked"].includes(key)) problem(line, `a FIGHT ends won, lost, fled, gaveUp or talked, not ${key}`);
    }
    block = null;
  };

  lines.forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed.startsWith("//")) return;

    // Inside a CHECK or FIGHT block, indented lines belong to it, until a blank line or something else.
    if (block) {
      if (/^\s+\S/.test(raw) && trimmed) {
        const outcome = trimmed.match(/^([A-Za-z]+)\s*->\s*(\S+)$/);
        const field = trimmed.match(/^([a-z_]+):\s*(.*)$/);
        if (outcome) block.outcomes[outcome[1]] = outcome[2];
        else if (field) block.fields[field[1]] = field[2].trim();
        else problem(line, `inside a ${block.kind}, each line is either a field like reason: ..., or an ending like pass -> part`);
        return;
      }
      closeBlock();
    }

    const header = trimmed.match(/^==\s*([A-Za-z0-9_]+)\s*$/);
    if (header) {
      if (part) flush();
      partId = header[1];
      if (scene.parts[partId]) problem(line, `there are two parts called ${partId}`);
      part = { line, text: [] };
      scene.parts[partId] = part;
      return;
    }
    if (!part) {
      if (!trimmed) return;
      const top = trimmed.match(REQUEST_LINE);
      if (trimmed.startsWith("#")) scene.title = trimmed.replace(/^#+\s*/, "");
      else if (/^start:/i.test(trimmed)) scene.start = trimmed.replace(/^start:\s*/i, "").trim();
      // A request (request_<kind>.txt) says on top when it comes up, who asks, what puts it right, by when, and when it's
      // no longer needed. src/requests.js reads these, and the checker says when one's wrong or missing.
      else if (top) {
        scene.request ??= { line };
        const key = REQUEST_KEYS[top[1].toLowerCase().replace(/\s+/g, " ")];
        if (scene.request[key] !== undefined) problem(line, `${top[1]}: is written twice`);
        scene.request[key] = top[2].trim();
      } else problem(line, "before the first part, only a # title, a start: line and // comments go here, and in a request the when:, asks:, needs:, by:, gone when: and handed to: lines. A part starts with == and its name");
      return;
    }
    if (!trimmed) {
      flush();
      return;
    }
    if (trimmed.startsWith("==")) {
      problem(line, "a part's name can only have letters, numbers and underscores, like == voss_answer");
      return;
    }
    if (trimmed.startsWith(">")) {
      flush();
      const { choice, problems: found } = parseChoice(trimmed.slice(1), line);
      problems.push(...found);
      (part.choices ??= []).push(choice);
      return;
    }
    if (trimmed.startsWith("*")) {
      flush();
      const { do: step, problem: wrong } = parseEffect(trimmed.slice(1));
      if (wrong) problem(line, wrong);
      else (part.do ??= []).push({ ...step, line });
      return;
    }
    if (trimmed.startsWith("?") || trimmed.startsWith("->")) {
      flush();
      const rule = trimmed.match(/^(\?\s*)?(.*?)\s*->\s*(\S+)\s*$/);
      if (!rule || Boolean(rule[1]) !== Boolean(rule[2])) problem(line, "a rule is written ? condition -> part, or just -> part for where to go otherwise");
      else (part.when ??= []).push({ ...(rule[2] ? { if: rule[2] } : {}), to: rule[3], line });
      return;
    }
    if (/^NOTE:/i.test(trimmed)) {
      flush();
      part.note = trimmed.replace(/^NOTE:\s*/i, "");
      return;
    }
    // Who the part waits for, when it isn't whoever speaks last in it: a name, or nobody for a part that plays anywhere.
    if (/^WITH:/i.test(trimmed)) {
      flush();
      const who = trimmed.replace(/^WITH:\s*/i, "").trim();
      if (!who) problem(line, "WITH: needs the name of who this part waits for, or nobody, like WITH: Commander Ilya Voss");
      else part.with = /^nobody$/i.test(who) ? "nobody" : who;
      return;
    }
    // A note for whoever writes, about what the people here would and wouldn't do. The player never sees it.
    if (/^AI:/i.test(trimmed)) {
      flush();
      part.ai = [part.ai, trimmed.replace(/^AI:\s*/i, "")].filter(Boolean).join(" ");
      return;
    }
    if (/^END\b/i.test(trimmed)) {
      flush();
      part.end = true;
      return;
    }
    const opening = trimmed.match(/^(CHECK|FIGHT)\b\s*(.*)$/i);
    if (opening) {
      flush();
      const kind = opening[1].toUpperCase();
      block = { kind, line, fields: {}, outcomes: {} };
      if (kind === "CHECK") {
        if (!opening[2]) problem(line, "CHECK needs the skill and difficulty after it, like CHECK persuasion:moderate:voss");
        block.fields.check = opening[2].trim();
      } else {
        const [enemy, ...leadIn] = opening[2].split(":");
        if (!enemy.trim()) problem(line, "FIGHT needs the enemy after it, like FIGHT dock_thug");
        block.fields.enemy = enemy.trim();
        if (leadIn.length) block.fields.lead_in = leadIn.join(":").trim();
      }
      return;
    }
    // Speech and consequences stand on their own line. Anything else joins the paragraph it's in.
    if (trimmed.startsWith("@") || trimmed.startsWith("=>")) {
      flush();
      part.text.push(trimmed);
      return;
    }
    paragraph.push(trimmed);
  });
  if (block) closeBlock();
  if (part) flush();
  if (!scene.start) scene.start = Object.keys(scene.parts)[0] ?? null;
  if (!Object.keys(scene.parts).length) problem(1, `${name} has no parts. A part starts with == and its name`);
  return { scene, problems };
}
