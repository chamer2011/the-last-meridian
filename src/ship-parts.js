// Now and then (step 5 of the hacking rework): the ship's own things taken apart for the rig, and finds.
//
// world/rig-parts/_from-the-ship.txt names the kinds of part in a place's systems (world/systems) that can be taken
// apart, what comes out of one, the minutes, the Engineering it needs and the post it belongs to. Only a part that's
// the player's own (the Meridian's, while they're her captain) and whole. It's broken from then on, by the systems'
// own rule, until the engineers mend it with a parts crate: a junction box's rooms go dark, a camera sees nothing, the
// relay takes the comms down, the nav core leaves the jumps to be plotted by hand. Whoever sees it done (src/law.js:
// someone awake in the room, or a camera that works) means whoever holds the post it belongs to hears of it.
//
// world/rig-parts/_finds.txt names things that turn up aboard: the mutineers' belongings once the mutiny's over, Tech
// Oona's old service clip for two of the ship's parts crates. Each is taken once, under You can in the room it's in.
// game.rig.found: { find's id: true }.
//
// It registers itself with src/room-hooks.js; nothing else in the game calls it.
import fs from "node:fs";
import path from "node:path";
import { addChecker, addOrder, addPartActs, addRoomActs } from "./room-hooks.js";
import { ITEMS } from "./data.js";
import { RIG_PARTS_DIR, rigPartById } from "./rig-parts.js";
import { giveRigPart } from "./rig.js";
import { damagePart, kindOf, ownedBy, partBroken, partInReach, playerSpot, systemsOf } from "./systems.js";
import { whoSees } from "./law.js";
import { holderKey, postAndName, postByWords, rememberRequest } from "./command.js";
import { countAboard, takeAboard } from "./logistics.js";
import { isCaptain } from "./role.js";
import { addItem, passTime, practice, skillRank } from "./rules.js";
import { mapFor } from "./walk.js";

const SHIP = "meridian";
const FROM_FILE = () => path.join(RIG_PARTS_DIR, "_from-the-ship.txt");
const FINDS_FILE = () => path.join(RIG_PARTS_DIR, "_finds.txt");
// What a memory of a part taken apart weighs against the captain, for whoever holds its post.
const GUTTED = -4;

const listed = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);
const aWord = (name) => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
const plain = (text) => String(text ?? "").toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").replace(/^the /, "").trim();
const slug = (text) => plain(text).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// "fin_sink, 2 scrap": rig parts and items, one of each or a number of them.
function readGives(text, problem) {
  const out = [];
  for (const piece of text.split(",").map((one) => one.trim()).filter(Boolean)) {
    const m = /^(?:(\d+) )?([a-z0-9_]+)$/i.exec(piece);
    if (!m) {
      problem(`"${piece}" isn't something that comes out: write a rig part's or an item's id, like fin_sink, or 2 scrap`);
      continue;
    }
    out.push({ id: m[2].toLowerCase(), n: Number(m[1] ?? 1) });
  }
  return out;
}
const thingName = (id) => (rigPartById(id)?.name ?? ITEMS[id]?.name ?? id).toLowerCase();
const givesWords = (gives, cond = null) => listed(gives.map((one) => {
  if (one.id === "scrap") return `${one.n} scrap`;
  const name = `${cond && cond !== "new" && rigPartById(one.id) ? `${cond} ` : ""}${thingName(one.id)}`;
  return one.n === 1 ? aWord(name) : `${one.n} ${name}s`;
}));
// What comes out goes with the rig's spare parts, or into the pack.
function give(game, gives, from) {
  for (const one of gives) {
    if (rigPartById(one.id)) for (let i = 0; i < one.n; i += 1) giveRigPart(game, one.id, { cond: "worn", from });
    else addItem(game, one.id, one.n);
  }
}

// A file read again when it changes, looked at no more than once a second.
function readEvery(file, parse) {
  let cache = null;
  return () => {
    const now = Date.now();
    if (cache && now - cache.looked < 1000) return cache;
    let stamp = "none";
    try {
      stamp = String(fs.statSync(file()).mtimeMs);
    } catch {
      stamp = "none";
    }
    if (cache?.stamp === stamp) {
      cache.looked = now;
      return cache;
    }
    cache = { ...(stamp === "none" ? { list: [], problems: [] } : parse(fs.readFileSync(file(), "utf8"))), stamp, looked: now };
    return cache;
  };
}

// ---- Taking the ship's own things apart ------------------------------------------------------------------------

// "junction box: fin_sink, 2 scrap; 25 minutes, Engineering 2; the chief engineer": one kind of part a line.
export function parseFromTheShip(text) {
  const out = { list: [], problems: [] };
  String(text ?? "").replace(/\r/g, "").split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^draft:/i.test(line)) return;
    const at = (message) => out.problems.push(`rig-parts/_from-the-ship.txt line ${i + 1}: ${message}`);
    const m = /^([a-z ]+): (.+); (\d+) minutes, engineering (\d+); (.+)$/i.exec(line);
    if (!m) return at(`a line is written like "junction box: fin_sink, 2 scrap; 25 minutes, Engineering 2; the chief engineer"`);
    out.list.push({ kind: m[1].trim().toLowerCase(), gives: readGives(m[2], at), minutes: Number(m[3]), engineering: Number(m[4]), post: plain(m[5]), line: i + 1 });
  });
  return out;
}
export const fromTheShipNow = readEvery(FROM_FILE, parseFromTheShip);
const ruleFor = (kind) => fromTheShipNow().list.find((one) => one.kind === kind) ?? null;

// Who'd mind: the post a kind of part belongs to, by its id in the place's chain of command.
const postFor = (place, rule) => postByWords(place, rule.post);

addPartActs((game, place, part) => {
  const rule = ruleFor(part.kind);
  if (!rule || !ownedBy(game, place) || partBroken(game, place, part.id)) return null;
  const short = skillRank(game, "engineering") < rule.engineering;
  return { does: [{ id: "strip-part", label: "Take it apart for your rig", detail: short ? `needs Engineering ${rule.engineering}` : `${givesWords(rule.gives)}; ${rule.minutes} minutes, and it's dead until it's mended`, ...(short ? { disabled: true } : {}) }] };
});

addOrder("strip-part", (game, body) => {
  const spot = playerSpot(game);
  if (!spot) throw new Error("There's nothing like that here.");
  const { place, room } = spot;
  const part = systemsOf(place)?.parts[String(body.key ?? "").replace(/^part:/, "")];
  if (!part || !partInReach(game, place, part)) throw new Error("That isn't here.");
  const rule = ruleFor(part.kind);
  if (!rule) throw new Error("There's nothing in that for a rig.");
  if (!ownedBy(game, place)) throw new Error("It isn't yours to take apart.");
  if (partBroken(game, place, part.id)) throw new Error("It's broken already.");
  if (skillRank(game, "engineering") < rule.engineering) throw new Error(`Taking that apart without wrecking what's in it needs Engineering ${rule.engineering}.`);
  if (game.combat || game.computer || game.check || game.talk) throw new Error("Not now.");
  // Whoever's in the room when the panel comes off sees it done.
  const seen = whoSees(game, place, room);
  const notes = passTime(game, rule.minutes / 60, "work");
  const name = `the ${part.name}`;
  const lines = damagePart(game, place, part.id, "broken", { by: "stripped" });
  give(game, rule.gives, `Taken out of the Meridian's ${part.name}.`);
  // The part's window shows its look (dead, and who'll mend it) under what's said.
  const said = [`[SHIP] ${rule.minutes} minutes with the panel off, and ${givesWords(rule.gives, "worn")} come out of ${name}. They're with your rig's spare parts${rule.gives.some((one) => !rigPartById(one.id)) ? " and in your pack" : ""}.`];
  said.push(...practice(game, "engineering", 1));
  const post = postFor(place, rule);
  const holder = post ? holderKey(game, place, post) : null;
  if (seen) {
    const who = seen.camera ? "The camera in the room" : seen.name;
    const whose = post ? postAndName(game, place, post) : null;
    const told = !whose || holder === "you" ? "" : seen.key === holder ? `, but ${who} won't forget a captain who guts the ship` : `, but ${whose} will hear of it, and won't forget a captain who guts the ship`;
    said.push(`[SHIP] ${who} saw you do it. It's all the captain's to take${told}.`);
    if (holder && holder !== "you" && place === SHIP) rememberRequest(game, holder, "story", { words: `heard you took ${name} apart for your rig`, w: GUTTED });
  }
  return { said: [...said, ...lines, ...notes].join("\n") };
});

// ---- Finds ------------------------------------------------------------------------------------------------------

// "the mutineers' belongings: in The Brig, after the mutiny: short_radio, scrap_memory, 1 scrap; words said after":
// what it is, the room it's in, when it's there, what it costs in the ship's parts crates, what's in it.
export function parseFinds(text) {
  const out = { list: [], problems: [] };
  String(text ?? "").replace(/\r/g, "").split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^draft:/i.test(line)) return;
    const at = (message) => out.problems.push(`rig-parts/_finds.txt line ${i + 1}: ${message}`);
    const m = /^(.+?): in ([^,:]+)((?:, (?:after the mutiny|for \d+ parts crates?))*): (.+?); (.+)$/i.exec(line);
    if (!m) return at(`a find is written like "the mutineers' belongings: in The Brig, after the mutiny: short_radio, 1 scrap; what's said after", with ", for 2 parts crates" for one that costs the ship's crates`);
    const crates = /for (\d+) parts crates?/i.exec(m[3]);
    out.list.push({ id: slug(m[1]), name: m[1].trim(), room: m[2].trim(), afterMutiny: /after the mutiny/i.test(m[3]), crates: crates ? Number(crates[1]) : 0, gives: readGives(m[4], at), after: m[5].trim(), line: i + 1 });
  });
  return out;
}
export const findsNow = readEvery(FINDS_FILE, parseFinds);
const roomOfFind = (find) => {
  const rooms = Object.values(mapFor(SHIP)?.rooms ?? {});
  return rooms.find((one) => one.id === slug(find.room) || plain(one.name) === plain(find.room) || (one.aliases ?? []).some((alias) => plain(alias) === plain(find.room))) ?? null;
};
const foundOf = (game, find) => Boolean(game.rig?.found?.[find.id]);
const cratesAboard = (game) => countAboard(game, SHIP, "parts_crate")?.n ?? 0;
const findWhy = (game, find) => (find.crates && cratesAboard(game) < find.crates ? `there aren't ${find.crates} parts crates in the ship's stores` : null);
const findLabel = (find) => (find.crates ? `Give ${find.crates} parts crate${find.crates === 1 ? "" : "s"} for ${find.name}` : `Go through ${find.name}`);

addRoomActs((game, { place, room }) => {
  if (place !== SHIP || !isCaptain(game) || !game.rig) return null;
  const acts = [];
  for (const find of findsNow().list) {
    if (foundOf(game, find) || (find.afterMutiny && !game.battles?.mutiny) || roomOfFind(find)?.id !== room) continue;
    const why = findWhy(game, find);
    acts.push({ id: "find-take", key: find.id, label: findLabel(find), detail: why ?? givesWords(find.gives, "worn"), ...(why ? { disabled: true } : {}) });
  }
  return acts.length ? acts : null;
});

addOrder("find-take", (game, body) => {
  const find = findsNow().list.find((one) => one.id === String(body.key ?? ""));
  const spot = playerSpot(game);
  if (!find || !spot || spot.place !== SHIP || roomOfFind(find)?.id !== spot.room || (find.afterMutiny && !game.battles?.mutiny)) throw new Error("There's nothing like that here.");
  if (!isCaptain(game)) throw new Error("It isn't yours to take.");
  if (foundOf(game, find)) throw new Error("You've had that already.");
  const why = findWhy(game, find);
  if (why) throw new Error(`Not yet: ${why}.`);
  if (find.crates) takeAboard(game, SHIP, "parts_crate", find.crates);
  give(game, find.gives, `${find.name[0].toUpperCase()}${find.name.slice(1)}.`);
  game.rig.found = { ...(game.rig.found ?? {}), [find.id]: true };
  return { said: `[SHIP] ${find.name[0].toUpperCase()}${find.name.slice(1)}: ${givesWords(find.gives, "worn")}. ${find.after}` };
});

// ---- The checker ------------------------------------------------------------------------------------------------

addChecker(() => {
  const out = [...fromTheShipNow().problems, ...findsNow().problems];
  for (const rule of fromTheShipNow().list) {
    if (kindOf(rule.kind) !== rule.kind) out.push(`rig-parts/_from-the-ship.txt line ${rule.line}: there's no kind of part called ${rule.kind} in world/systems`);
    if (!postByWords(SHIP, rule.post)) out.push(`rig-parts/_from-the-ship.txt line ${rule.line}: there's no post called ${rule.post} in world/command/meridian.txt`);
    for (const one of rule.gives) if (!rigPartById(one.id) && !ITEMS[one.id]) out.push(`rig-parts/_from-the-ship.txt line ${rule.line}: ${one.id} isn't a rig part or an item`);
  }
  for (const find of findsNow().list) {
    if (!roomOfFind(find)) out.push(`rig-parts/_finds.txt line ${find.line}: there's no room called ${find.room} aboard the Meridian`);
    for (const one of find.gives) if (!rigPartById(one.id) && !ITEMS[one.id]) out.push(`rig-parts/_finds.txt line ${find.line}: ${one.id} isn't a rig part or an item`);
  }
  return out;
});
