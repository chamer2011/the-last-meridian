// Salvage runs (the hands-on plan, step 7), from world/salvage.txt. At the Graveyard, You can offers a run out to a
// dead ship. In this first version the wreck isn't rooms to walk through: it's played from the You can list, one job
// at a time, against the air in the suit's bottle, which runs down with the clock whatever the player does. Power at
// the junction box makes the hatch quick and wakes the bridge console; the engine room behind the hatch has the
// parts, and now and then something still aboard; what's taken comes home when the player goes back to the shuttle.
// Out of air, the shuttle's crew haul them out and what they carried is left behind.
//
// It registers itself with src/room-hooks.js; nothing else in the game calls it.

import fs from "node:fs";
import path from "node:path";
import { addChecker, addClockWork, addOrder, addRoomActs } from "./room-hooks.js";
import { SKILLS } from "./character-data.js";
import { startCombat } from "./combat.js";
import { ENEMIES, ITEMS, LOCATIONS } from "./data.js";
import { worldDir } from "./paths.js";
import { addItem, changeStress, passTime, practice, skillRank } from "./rules.js";

export const SALVAGE_FILE = process.env.GAME_SALVAGE_FILE ?? path.join(worldDir, "salvage.txt");
// What a tool roll in the pack halves.
const TOOL_JOBS = ["junction", "hatch", "engine"];

const nowOf = (game) => game.clock?.hours ?? 0;
const listed = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);
const itemName = (id) => (ITEMS[id]?.name ?? id).toLowerCase();
const aWord = (name) => `${/^[aeiou]/.test(name) ? "an" : "a"} ${name}`;

// ---- The file -----------------------------------------------------------------------------------------

const minutes = (name) => [/^(\d+) minutes(?: each way)?$/i, (f) => ({ [name]: Number(f[1]) }), "15 minutes"];
const items = (name) => [/^([a-z_, ]+)$/i, (f) => {
  const ids = f[1].split(",").map((one) => one.trim()).filter(Boolean);
  return ids.every((id) => ITEMS[id]) ? { [name]: ids } : null;
}, "item ids from world/items, with commas between"];
const LINES = {
  at: [/^([a-z_]+)$/i, (f) => (LOCATIONS[f[1].toLowerCase()] ? { at: f[1].toLowerCase() } : null), "a place's id, such as graveyard"],
  "the wreck": [/^(.+)$/, (f) => ({ wreck: f[1].trim() }), "its name"],
  air: minutes("air"),
  "the shuttle": minutes("shuttle"),
  "junction box": minutes("junction"),
  "hatch by hand": minutes("hatchByHand"),
  "hatch with power": minutes("hatchWithPower"),
  lockers: minutes("lockers"),
  "lockers hold": items("lockersHold"),
  "engine room": minutes("engine"),
  "engine room holds": items("engineHolds"),
  "bridge console": minutes("console"),
  "bridge console needs": [/^([a-z_]+) (\d+)$/i, (f) => (SKILLS[f[1].toLowerCase()] ? { consoleSkill: f[1].toLowerCase(), consoleRank: Number(f[2]) } : null), "a skill and a number, such as hacking 2"],
  "bridge console pays": [/^(\d+) credits$/i, (f) => ({ consolePays: Number(f[1]) }), "60 credits"],
  "something aboard": [/^1 in (\d+), ([a-z_]+)$/i, (f) => (ENEMIES[f[2].toLowerCase()] ? { aboardIn: Number(f[1]), aboard: f[2].toLowerCase() } : null), "1 in 4, and an enemy's id from world/enemies"],
  "out of air": [/^stress (\d+)$/i, (f) => ({ stress: Number(f[1]) }), "stress 15"],
  again: [/^after (\d+) days$/i, (f) => ({ again: Number(f[1]) }), "after 3 days"],
};

export function parseSalvage(text) {
  const model = { problems: [] };
  const seen = new Set();
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^draft:/i.test(line)) return;
    const found = line.match(/^([a-z ]+): (.+)$/i);
    const reader = found ? LINES[found[1].toLowerCase()] : null;
    if (!reader) return model.problems.push(`world/salvage.txt, line ${i + 1}: a line here is one of: ${Object.keys(LINES).join(", ")}`);
    const read = found[2].trim().match(reader[0]);
    const value = read ? reader[1](read) : null;
    if (!value) return model.problems.push(`world/salvage.txt, line ${i + 1}: "${found[1]}" is written like: ${reader[2]}`);
    seen.add(found[1].toLowerCase());
    Object.assign(model, value);
  });
  const missing = Object.keys(LINES).filter((name) => !seen.has(name));
  if (missing.length) model.problems.push(`world/salvage.txt: there's no line for ${missing.join(", ")}, so there's no salvage run`);
  model.whole = !missing.length;
  return model;
}

let read;
export function salvageRules() {
  if (read === undefined) read = fs.existsSync(SALVAGE_FILE) ? parseSalvage(fs.readFileSync(SALVAGE_FILE, "utf8")) : null;
  return read?.whole ? read : null;
}
export const forgetSalvage = () => { read = undefined; };
addChecker(() => (fs.existsSync(SALVAGE_FILE) ? (salvageRules(), read.problems) : []));

// ---- The run ------------------------------------------------------------------------------------------

// The minutes of air left in the bottle, on a run.
export const airLeft = (game) => (game.salvage ? Math.max(0, Math.round(game.salvage.air - (nowOf(game) - game.salvage.since) * 60)) : null);
const hasTools = (game) => (game.inventory?.tool_roll ?? 0) > 0;
const timeFor = (game, job, plain) => (TOOL_JOBS.includes(job) && hasTools(game) ? Math.ceil(plain / 2) : plain);

// What can be done on the run right now, each with how long it takes and why not, if not.
function jobs(game) {
  const rules = salvageRules();
  const run = game.salvage;
  const out = [];
  if (!run.power) out.push({ id: "junction", label: "Bring the power back at the junction box", minutes: timeFor(game, "junction", rules.junction) });
  if (!run.hatch) out.push({ id: "hatch", label: "Get the hatch to the engine room open", minutes: timeFor(game, "hatch", run.power ? rules.hatchWithPower : rules.hatchByHand), note: run.power ? "with the power on" : "by hand" });
  if (!run.done.lockers) out.push({ id: "lockers", label: "Go through the crew lockers", minutes: rules.lockers });
  if (!run.done.engine) out.push({ id: "engine", label: "Strip the engine room for parts", minutes: timeFor(game, "engine", rules.engine), why: run.hatch ? null : "the hatch is shut" });
  if (!run.done.console) {
    const why = !run.power ? "it's dead without power" : skillRank(game, rules.consoleSkill) < rules.consoleRank ? `it wants ${SKILLS[rules.consoleSkill].name} ${rules.consoleRank}` : null;
    out.push({ id: "console", label: "Pull the log from the bridge console", minutes: rules.console, why });
  }
  return out;
}

const carriedWords = (run) => {
  const things = Object.entries(run.carried).map(([id, n]) => (n === 1 ? aWord(itemName(id)) : `${n} ${itemName(id)}s`));
  if (run.credits) things.push(`a log worth ${run.credits} credits`);
  return things.length ? listed(things) : "nothing";
};

addRoomActs((game, { place }) => {
  const rules = salvageRules();
  if (!rules || place !== rules.at) return null;
  const run = game.salvage;
  if (!run) {
    const wait = (game.salvageNext ?? 0) - Math.floor(nowOf(game) / 24);
    return [{ id: "salvage-start", label: `Take the shuttle out to ${rules.wreck}`, detail: wait > 0 ? `picked over for now: try again in ${wait} day${wait === 1 ? "" : "s"}` : `a salvage run: ${rules.air} minutes of air, ${rules.shuttle} minutes each way`, ...(wait > 0 ? { disabled: true } : {}) }];
  }
  const air = airLeft(game);
  return [
    ...jobs(game).map((job) => ({ id: "salvage-job", key: job.id, label: `${job.label} (${job.minutes} minutes)`, detail: job.why ?? job.note ?? "", ...(job.why ? { disabled: true } : {}) })),
    // The air left is on the button itself, since what's beside a button here is only shown when it's pointed at.
    { id: "salvage-back", label: `Go back to the shuttle (${air} minutes of air left)`, detail: `carrying ${carriedWords(run)}` },
  ];
});

addOrder("salvage-start", (game) => {
  const rules = salvageRules();
  if (!rules || game.location !== rules.at) throw new Error("There's no wreck to go out to from here.");
  if (game.salvage) throw new Error("You're out there already.");
  if ((game.salvageNext ?? 0) > Math.floor(nowOf(game) / 24)) throw new Error("It's been picked over for now.");
  const notes = passTime(game, rules.shuttle / 60, "active");
  game.salvage = { since: nowOf(game), air: rules.air, power: false, hatch: false, done: {}, carried: {}, credits: 0 };
  return { said: [`[SALVAGE] The shuttle puts you across to ${rules.wreck}: dark, airless, and every door shut. You've ${rules.air} minutes of air in the bottle. What you do is under You can.`, ...notes].join("\n") };
});

// Out of air: the shuttle's crew haul the player out, and what they carried stays behind.
function outOfAir(game) {
  const rules = salvageRules();
  const run = game.salvage;
  game.salvage = null;
  game.salvageNext = Math.floor(nowOf(game) / 24) + rules.again;
  return [`[SALVAGE] The bottle's empty. The shuttle's crew haul you out by your harness, and ${carriedWords(run) === "nothing" ? "you'd nothing to lose but your breath" : `what you were carrying stays behind: ${carriedWords(run)}`}.`, ...changeStress(game, rules.stress)];
}

addOrder("salvage-job", (game, body) => {
  const rules = salvageRules();
  const run = game.salvage;
  if (!rules || !run) throw new Error("You're not out at a wreck.");
  const job = jobs(game).find((one) => one.id === String(body.key ?? ""));
  if (!job) throw new Error("That's done.");
  if (job.why) throw new Error(`Not yet: ${job.why}.`);
  const notes = passTime(game, job.minutes / 60, "work");
  // The air may have gone while the work was being done, and the clock's own look will have said so.
  if (!game.salvage) return { said: notes.join("\n") };
  const lines = [];
  const take = (ids) => { for (const id of ids) run.carried[id] = (run.carried[id] ?? 0) + 1; };
  if (job.id === "junction") {
    run.power = true;
    lines.push("[SALVAGE] The junction box coughs, and a few lights come up red. The hatch will answer now, and so will the bridge.", ...practice(game, "engineering", 1));
  } else if (job.id === "hatch") {
    run.hatch = true;
    lines.push(`[SALVAGE] The hatch to the engine room gives${run.power ? "" : ", a finger's width at a time"}.`);
  } else if (job.id === "lockers") {
    run.done.lockers = true;
    take(rules.lockersHold);
    lines.push(`[SALVAGE] The crew lockers: ${listed(rules.lockersHold.map((id) => aWord(itemName(id))))}, and things nobody will come back for.`);
  } else if (job.id === "engine") {
    run.done.engine = true;
    take(rules.engineHolds);
    lines.push(`[SALVAGE] You strip the engine room: ${carriedWordsOf(rules.engineHolds)}.`, ...practice(game, "engineering", 1));
    // Now and then something's still aboard.
    if (Math.random() < 1 / rules.aboardIn) {
      startCombat(game, rules.aboard, { reason: `Something was still aboard ${rules.wreck}` });
      lines.push(`[SALVAGE] You're not the only one in here.`);
    }
  } else if (job.id === "console") {
    run.done.console = true;
    run.credits += rules.consolePays;
    lines.push(`[SALVAGE] The bridge console gives up its log. Someone at ${LOCATIONS[rules.at]?.name.replace(/^The /, "the ") ?? "the dock"} will pay ${rules.consolePays} credits for it.`, ...practice(game, rules.consoleSkill, 1));
  }
  lines.push(`[SALVAGE] ${airLeft(game)} minutes of air left.`);
  return { said: [...lines, ...notes].join("\n") };
});
const carriedWordsOf = (ids) => {
  const counts = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  return listed(Object.entries(counts).map(([id, n]) => (n === 1 ? aWord(itemName(id)) : `${n} ${itemName(id)}s`)));
};

addOrder("salvage-back", (game) => {
  const rules = salvageRules();
  const run = game.salvage;
  if (!rules || !run) throw new Error("You're not out at a wreck.");
  game.salvage = null;
  game.salvageNext = Math.floor(nowOf(game) / 24) + rules.again;
  for (const [id, n] of Object.entries(run.carried)) addItem(game, id, n);
  game.credits += run.credits;
  const notes = passTime(game, rules.shuttle / 60, "active");
  return { said: [`[SALVAGE] The shuttle brings you back with ${carriedWords(run)}.`, ...notes].join("\n") };
});

// The bottle runs down with the clock, whatever the player's doing; and a run ends if they're somewhere else.
addClockWork((game) => {
  const rules = salvageRules();
  if (!rules || !game.salvage) return [];
  if (game.location !== rules.at) {
    game.salvage = null;
    return [];
  }
  return airLeft(game) <= 0 ? outOfAir(game) : [];
});
