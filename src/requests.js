// Requests: quests that come from what happens aboard, not from a story written in advance. When something goes wrong
// (the medicine cabinet nearly empty, the jump fuel low, the pantry bare, something broken with no parts to mend it),
// whoever it matters to has something to ask: a mark on their tag in the room, and when the player talks to them, they
// ask, and the player answers. Yes is a quest in the tracker with a goal the game counts and a day it's due by. It ends
// done (the player did it), gone (it was put right some other way first: no harm done) or failed (the day came and
// went), each with the asker's line. The captain can hand some to whoever's post it is instead, and that post's duty
// shows how they did.
//
// Each kind is a scene file in world/scenes, request_<kind>.txt, with lines on top that say when it comes up, who
// asks, what's wanted, by when, and when it's no longer needed or who it can be handed to;
// world/scenes/_how-to-write-a-scene.txt explains it under REQUESTS. What's wanted is one of: bring things aboard or
// into a store, fix a part, give someone something, talk to someone, go somewhere, or pass a check. The ask and the
// answers are said in the talk window (src/talks.js), and what happens after is a line in the story. The asker is a
// post ("the chief medical officer"), so whoever holds it now asks, or a job ("a cook"), or someone by name.
//
// game.requests, made the first time someone has something to ask, so a new game's save is unchanged until then:
//   open:  by kind, { kind, asker, at, state: "offered", "accepted" or "handed", later, base, due, quest, part, to,
//          give, holder, reminded }
//   rest:  by kind, the hour before which it won't be asked again
//   asked: by kind, the hour it was last asked, so the one asked longest ago comes first
//   day:   the day the last new ask came, since a quiet day comes between (src/requests.js's pacer)
//   last:  the kind asked last, so the same kind isn't asked twice running
//   ended: by kind, how it last ended (done, seen_to, failed, left_undone, refused or gone) and the day, for ? request
//   off:   by kind, true while the written story has turned it off (* request <kind> off)
//   n:     how many have been taken on, for the quests' ids
//
// Off the ship, at the ports: someone there by name, or someone there, asks, about what the port is short of or the
// trouble it's in (? supply, ? trouble), and can buy things from the player over the market price (needs: sell ...),
// with standing at that port, with whoever holds it ({port}), as the reward.
//
// Who's asked depends on the player's life (the for: line): the captain gets their officers' troubles to decide, crew
// get orders from the officer over their job (as: an order, which costs more to refuse), and anyone whose life began
// somewhere else is asked by the people where they are: their boss, or someone there.

import { SKILLS } from "./character-data.js";
import { findCharacter, fullName } from "./campaign.js";
import { FACTIONS, ITEMS, LOCATIONS } from "./data.js";
import { itemFactor } from "./daily.js";
import { TROUBLES, YOU, calledBy, commandOf, deposedStart, deputyFor, holderKey, jobByWords, jobOf, lostReason, onJob, personByWords, postById, postByWords, postOf, rememberRequest, stillAlive, storyCommand, tallyDuty, troublesOf } from "./command.js";
import { FACT_ID, clearFact, recordFact } from "./record.js";
import { dueWords, heldUp } from "./quests.js";
import { START_LIST, aboardShip, isCaptain, startOf } from "./role.js";
import { conditionHolds, parseCondition } from "./scene-text.js";
import { loadScenes, scenesUnderWay, withStandIns } from "./scenes.js";
import { itemByWords, logisticsOf, storeByWords, storeNames } from "./logistics.js";
import { notePut, putsOf } from "./puts.js";
import { removeItem, tellRequests } from "./rules.js";
import { applySystemsEffect, battleDamageWords, partBroken, partByWords, partWords, partsWaitingIds } from "./systems.js";
import { newTurnLimits, runTool } from "./tools.js";
import { tellStoryRequests } from "./request-hook.js";
import { mapFor, personWhere, roomOf, roomsOf } from "./walk.js";
import { WORLD_CHARACTERS, WORLD_COMPUTERS } from "./world.js";

const SHIP = "meridian";
const PREFIX = "request_";
// At most this many waiting at once, asked, taken on or handed on.
const MOST_OPEN = 3;
// How long a kind rests after it's over before it can be asked again, in hours, by how it ended.
const REST = { done: 48, gone: 48, failed: 96, no: 168, dropped: 12 };
// "Not now" puts it off this long.
const LATER = 24;
// Days with nothing new between one new ask and the next, unless it can't wait (a request given less than a day).
const QUIET_DAYS = 1;
// Nobody brings something new in the middle of the night: only between these hours, unless it can't wait.
const ASKING_HOURS = [7, 21];
// A request ended long ago leaves the quest log after this many more have ended.
const KEEP_ENDED = 8;
// What a request handed to a post does to that post's duty on the day it ends: done, a little for them; left undone,
// more against them.
const HANDED_DUTY = { done: 5, failed: -15 };
// The answers a request's parts stand for: yes takes it on; given takes it on and gives what's wanted there and then;
// handed leaves it to whoever's post it is; later puts it off a day; no turns it down.
export const ANSWERS = ["yes", "given", "handed", "later", "no"];
// A part's answer: its own name, or yes for a yes of its own (yes_locked, yes_work), when the player's answer decides
// what's done there and then, each with its own * lines.
export const answerOf = (id) => (ANSWERS.includes(id) ? id : /^yes_[a-z0-9_]+$/i.test(String(id ?? "")) ? "yes" : null);
export const ENDINGS = ["done", "failed", "gone"];

const nowOf = (game) => game.clock?.hours ?? 0;
const dayOf = (hours) => Math.floor(hours / 24) + 1;
const dueOf = (open) => dueWords(open.due, open.short);
const upperFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

// ---- Reading a request's lines ----------------------------------------------------------------------------

const plainRoom = (words) => String(words ?? "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
function roomByWords(words) {
  const want = plainRoom(words);
  return roomsOf(mapFor(SHIP)).find((room) => plainRoom(room.name) === want || room.id === want.replace(/ /g, "_") || (room.aliases ?? []).some((one) => plainRoom(one) === want)) ?? null;
}

// Someone a request names: {asker}, a post (the quartermaster: whoever holds it), a job (a cook: one of them at work),
// or someone by name.
function readWho(words, problems, key) {
  const who = String(words ?? "").trim();
  if (/^\{asker\}$/i.test(who)) return { asker: true, words: who };
  if (/^\{about\}$/i.test(who)) return { about: true, words: who };
  // The officer over the player's job on the watch bill, and the first person of their life (Chief Marrow for an engine
  // hand, Dockmaster Jessup for a dock hand).
  if (/^your\s+officer$/i.test(who)) return { officer: true, room: null, words: who };
  if (/^your\s+boss$/i.test(who)) return { boss: true, room: null, words: who };
  const model = commandOf(SHIP);
  const post = postByWords(SHIP, who);
  if (post) return { post, room: model?.posts.find((one) => one.id === post)?.room ?? null, words: who };
  const job = jobByWords(SHIP, who);
  if (job) return { job, room: model?.jobs.find((one) => one.id === job)?.room ?? null, words: who };
  const person = personByWords(SHIP, who);
  if (person && person !== YOU && person !== "nobody") return { person, room: null, words: who };
  // Someone with a file at another place, by their name or another they go by: asked there, when the player's there.
  const plainName = (words) => String(words ?? "").trim().toLowerCase();
  const elsewhere = Object.keys(WORLD_CHARACTERS).find((one) => [WORLD_CHARACTERS[one].name, ...(WORLD_CHARACTERS[one].aliases ?? [])].some((name) => plainName(name) === plainName(who)));
  if (elsewhere && WORLD_CHARACTERS[elsewhere].location && LOCATIONS[WORLD_CHARACTERS[elsewhere].location]) return { person: elsewhere, place: WORLD_CHARACTERS[elsewhere].location, room: null, words: who };
  problems.push(`${key}: there's no post, job or person called ${who || "nothing"}`);
  return null;
}

// "the chief medical officer", "a cook" or "Dunn Marrow", with ", in the Medbay" if they're to be found somewhere else
// than where their post or job is.
function readAsks(words, problems) {
  const [who, roomWords] = String(words ?? "").split(/,\s*in\s+/i);
  if (!who?.trim()) {
    problems.push("asks: needs who asks: a post (the chief medical officer), a job (a cook) or someone by name");
    return null;
  }
  // Whoever the trouble in the about: line falls on: the one with a rival, the one relieved, the one in the brig.
  if (/^them$/i.test(who.trim())) return { them: true, room: null, words: "them" };
  // Anyone with a name at the place the player is, other than their boss.
  if (/^someone\s+here$/i.test(who.trim())) return { here: true, room: null, words: "someone here" };
  const asker = readWho(who, problems, "asks");
  if (!asker) return null;
  if (asker.asker) {
    problems.push("asks: can't be {asker}: it's who {asker} stands for");
    return null;
  }
  if (roomWords && (asker.officer || asker.boss)) problems.push("asks: your officer and your boss are found where they work, so leave out the room");
  else if (roomWords) {
    const room = roomByWords(roomWords);
    if (!room) problems.push(`asks: the Meridian has no room called ${roomWords.trim()}`);
    else asker.room = room.id;
  }
  return asker;
}

// What's wanted, one of:
//   medicine crates aboard +2, ration crates in the pantry +2, fuel in the tank +3   (bring)
//   fix a part waiting for repairs, fix the air plant, fix the speaker in The Galley   (fix)
//   give 1 medkit to {asker}                                                        (give)
//   talk to the quartermaster                                                       (talk)
//   go to haven                                                                     (go)
//   pass engineering, pass engineering at the air plant, pass persuasion with {asker} (pass)
const NEEDS_HELP = "needs: is what's wanted: sell 3 ration packs to {asker}, at half again the market price, work a shift, work 2 shifts, medicine crates aboard +2, ration crates in the pantry +2, fuel in the tank +3, fix a part waiting for repairs, fix the air plant, give 1 medkit to {asker}, talk to the quartermaster, talk to {about}, go to haven, pass engineering at the air plant, carry {about} to the medbay, or your word";
const COUNT_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
// What someone pays for what they buy from the player, against what it costs on the market where they are.
const PRICE_WORDS = { "the market price": 1, "half again the market price": 1.5, "twice the market price": 2 };
function readNeeds(words, problems) {
  const text = String(words ?? "").trim();
  let found;
  // Someone lying where they fell, carried by the player to a cot (src/medbay.js keeps game.down).
  if (/^carry\s+\{about\}\s+to\s+the\s+medbay$/i.test(text)) return { kind: "carry", n: 1 };
  // Nothing to fetch or do: the answer is the thing, settled once they've said yes.
  if (/^your\s+word$/i.test(text)) return { kind: "word", n: 1 };
  // Shifts at the player's own job, from its button in What's here (workShift in src/rules.js counts them).
  if ((found = text.match(/^work\s+(\S+)\s+shifts?$/i))) {
    const n = COUNT_WORDS[found[1].toLowerCase()] ?? Number(found[1]);
    if (!Number.isInteger(n) || n < 1) {
      problems.push(`needs: work a shift, or work 2 shifts, not ${text}`);
      return null;
    }
    return { kind: "shift", n };
  }
  if ((found = text.match(/^fix\s+(.+)$/i))) {
    if (/^a part waiting for repairs$/i.test(found[1].trim())) return { kind: "fix", waiting: true, n: 1 };
    const part = partByWords(SHIP, found[1]);
    if (!part) {
      problems.push(`needs: the Meridian has no part called ${found[1].trim()}`);
      return null;
    }
    return { kind: "fix", part: part.id, n: 1 };
  }
  if ((found = text.match(/^give\s+(\d+)\s+(.+?)\s+to\s+(.+)$/i))) {
    const n = Number(found[1]);
    const item = itemByWords(found[2]);
    if (!n) problems.push("needs: give needs a number more than 0");
    if (!item) problems.push(`needs: there's no item called ${found[2].trim()}`);
    const to = readWho(found[3], problems, "needs");
    return n && item && to ? { kind: "give", item, n, to } : null;
  }
  // Sold to someone there and then, paid at what it costs on that market, or over it.
  if ((found = text.match(/^sell\s+(\S+)\s+(.+?)\s+to\s+(.+?)(?:,\s*at\s+(.+?))?$/i))) {
    const n = COUNT_WORDS[found[1].toLowerCase()] ?? Number(found[1]);
    const item = itemByWords(found[2]);
    const factor = found[4] ? PRICE_WORDS[found[4].trim().toLowerCase()] : 1;
    if (!Number.isInteger(n) || n < 1) problems.push("needs: sell needs a number more than 0");
    if (!item) problems.push(`needs: there's no item called ${found[2].trim()}`);
    if (!factor) problems.push(`needs: sell ends with at the market price, at half again the market price or at twice the market price, not at ${found[4].trim()}`);
    const to = readWho(found[3], problems, "needs");
    return n && item && to && factor ? { kind: "sell", item, n, to, factor } : null;
  }
  if ((found = text.match(/^talk\s+to\s+(.+)$/i))) {
    const to = readWho(found[1], problems, "needs");
    return to ? { kind: "talk", to, n: 1 } : null;
  }
  if ((found = text.match(/^go\s+to\s+(.+)$/i))) {
    const want = found[1].trim().toLowerCase();
    const place = Object.keys(LOCATIONS).find((id) => id === want || String(LOCATIONS[id].name ?? "").toLowerCase() === want);
    if (!place) {
      problems.push(`needs: there's no place called ${found[1].trim()}`);
      return null;
    }
    return { kind: "go", place, n: 1 };
  }
  if ((found = text.match(/^pass\s+(\S+)(?:\s+(at|with)\s+(.+))?$/i))) {
    const skill = found[1].toLowerCase();
    if (!SKILLS[skill]) {
      problems.push(`needs: there's no skill called ${found[1]}`);
      return null;
    }
    if (found[2]?.toLowerCase() === "at") {
      const part = partByWords(SHIP, found[3]);
      if (!part) problems.push(`needs: the Meridian has no part called ${found[3].trim()}`);
      return part ? { kind: "pass", skill, at: part.id, n: 1 } : null;
    }
    if (found[2]?.toLowerCase() === "with") {
      const to = readWho(found[3], problems, "needs");
      return to ? { kind: "pass", skill, with: to, n: 1 } : null;
    }
    return { kind: "pass", skill, n: 1 };
  }
  found = text.match(/^(.*?)\s*\+\s*(\d+)$/);
  if (!found || !Number(found[2])) {
    problems.push(NEEDS_HELP);
    return null;
  }
  const what = found[1].trim();
  const n = Number(found[2]);
  if (/^fuel\s+in\s+the\s+tank$/i.test(what)) return { kind: "bring", item: "fuel", where: "tank", n, label: "fuel", into: "the tank" };
  const aboard = what.match(/^(.*?)\s+aboard$/i);
  const inside = aboard ? null : what.match(/^(.*?)\s+in\s+(.+)$/i);
  const item = itemByWords(aboard?.[1] ?? inside?.[1] ?? "");
  if (!item) {
    problems.push(`needs: there's no item called ${aboard?.[1] ?? inside?.[1] ?? what}`);
    return null;
  }
  if (aboard) return { kind: "bring", item, where: "aboard", n, label: aboard[1].trim(), into: "aboard" };
  if (!inside) {
    problems.push("needs: says where it's wanted: aboard, or in one of the stores, like in the pantry");
    return null;
  }
  const store = storeByWords(SHIP, inside[2]);
  if (!store || store.count) {
    problems.push(`needs: the Meridian has no store called ${inside[2].trim()}: its stores are ${storeNames(SHIP).join(", ")}`);
    return null;
  }
  if (!(item in store.holds)) problems.push(`needs: the ${store.name} doesn't keep ${ITEMS[item]?.name ?? item}`);
  return { kind: "bring", item, where: store.key, n, label: inside[1].trim(), into: `to the ${store.name}` };
}

function readBy(words, problems) {
  const found = String(words ?? "").trim().match(/^(\d+)\s*(days?|hours?)$/i);
  if (!found || !Number(found[1])) {
    problems.push("by: is how long they give you once you've said yes, like 5 days or 12 hours");
    return null;
  }
  return Number(found[1]) * (/^day/i.test(found[2]) ? 24 : 1);
}

// A request's conditions can name {place}, the place it was asked at: supply food >= 100 at {place}.
const placed = (text, place) => (text ? text.replaceAll("{place}", place) : text);
function readCondition(text, key, problems, needed = true) {
  if (!text) {
    if (needed) problems.push(`${key}: is missing`);
    return null;
  }
  for (const found of parseCondition(placed(text, "haven")).problems) problems.push(`${key}: ${found}`);
  return text;
}

// Whose trouble a request is about, from the chain of command (src/command.js) or the medbay: someone lying where they
// fell with nobody coming for them.
const DOWN = "someone down with nobody coming";
const ABOUTS = [...TROUBLES, DOWN];
const ABOUT_ASKS = new Set(["a rival", "someone relieved", "someone in the brig"]);
function readAbout(words, problems) {
  const want = String(words ?? "").trim().toLowerCase();
  if (!ABOUTS.includes(want)) {
    problems.push(`about: is one of ${ABOUTS.join(", ")}, not ${String(words ?? "").trim() || "nothing"}`);
    return null;
  }
  return want;
}
// Who's lying where they fell aboard with nobody on the way to them, longest first: a quarter of an hour on, so the
// medics have had their chance.
function lyingDown(game) {
  return Object.values(game.down ?? {})
    .filter((d) => d.place === SHIP && !d.bed && !d.carriedBy && !d.going && !d.dead && !d.call?.by && d.who && d.who !== YOU && nowOf(game) - (d.since ?? 0) >= 0.25)
    .sort((a, b) => (a.since ?? 0) - (b.since ?? 0))
    .map((d) => ({ asker: null, about: d.who, post: null }));
}
const troublesFor = (game, model) => (model.about === DOWN ? lyingDown(game) : troublesOf(game, model.about));
// Whether the trouble a request is about is still there: the same person in the same trouble.
const troubleStands = (game, model, open) => troublesFor(game, model).some((one) => one.about === open.about && (one.post ?? null) === (open.post ?? null));
const downOf = (game, who) => Object.values(game.down ?? {}).find((d) => d.who === who) ?? null;

// Who a request can be handed to: a post.
function readHandedTo(words, problems) {
  const post = postByWords(SHIP, words);
  if (!post) problems.push(`handed to: is a post aboard, like the chief engineer, not ${String(words ?? "").trim() || "nothing"}`);
  return post;
}

// Which lives a kind is for, from its for: line: the captain; crew (anyone who lives aboard the Meridian and isn't the
// captain, a captain the officers relieved included); outsiders (lives that begin somewhere else); anyone aboard;
// anyone; or lives by their id or name, like engine hand or dock hand. A request with no for: line is for anyone aboard.
const LIVES = ["the captain", "crew", "outsiders", "anyone aboard", "anyone"];
const FOR_HELP = "for: is the captain, crew, outsiders, anyone aboard, anyone, or a life by its name, like engine hand or dock hand; several with commas";
function lifeByWords(words) {
  const want = String(words ?? "").trim().toLowerCase().replace(/^(a|an|the)\s+/, "");
  return Object.keys(START_LIST).find((id) => id === want.replace(/\s+/g, "_") || String(START_LIST[id].short ?? "").toLowerCase() === want) ?? null;
}
function readFor(words, problems) {
  const lives = [];
  for (const one of String(words ?? "").split(/,|\bor\b/i).map((piece) => piece.trim().toLowerCase()).filter(Boolean)) {
    const plain = one === "captain" ? "the captain" : one;
    const life = LIVES.includes(plain) ? null : lifeByWords(one);
    if (LIVES.includes(plain)) lives.push(plain);
    else if (life === "captain") lives.push("the captain");
    else if (life) lives.push(`life:${life}`);
    else problems.push(`${FOR_HELP}, not ${one}`);
  }
  if (!lives.length) problems.push(FOR_HELP);
  return lives;
}
// Whether the player started as crew aboard the Meridian, or is crew there now after the officers took the chair.
const crewAboard = (game) => !isCaptain(game) && (startOf(game)?.place === SHIP || Boolean(deposedStart(game)));
// Whether a kind is for the life the player is living.
export function forLife(game, model) {
  return (model.for ?? ["anyone aboard"]).some((one) => {
    if (one === "the captain") return isCaptain(game);
    if (one === "crew") return crewAboard(game);
    if (one === "outsiders") return !isCaptain(game) && !crewAboard(game);
    if (one === "anyone aboard") return aboardShip(game);
    if (one === "anyone") return true;
    return !isCaptain(game) && one === `life:${game.role?.id}`;
  });
}
// Whether a life in a for: line is one aboard the Meridian, with an officer over their job on the watch bill.
const crewLife = (one) => one === "crew" || (one.startsWith("life:") && START_LIST[one.slice(5)]?.place === SHIP && START_LIST[one.slice(5)]?.job);
// Whether a life in a for: line has someone to call their boss: the people their life begins with.
const bossLife = (one) => one === "crew" || one === "outsiders" || (one.startsWith("life:") && (START_LIST[one.slice(5)]?.people ?? []).length > 0);

function readAs(words, problems) {
  const want = String(words ?? "").trim().toLowerCase();
  if (want === "an order") return true;
  if (want === "a request") return false;
  problems.push(`as: is an order, or a request (the same as no as: line), not ${String(words ?? "").trim() || "nothing"}`);
  return false;
}

// A request's file, made into what the game plays: the kind, its title, the conditions, the asker, what's needed, how
// long it's given and who it can be handed to. Problems say what's wrong, in plain words.
const compiled = new WeakMap();
export function compileRequest(kind, scene) {
  if (compiled.has(scene)) return compiled.get(scene);
  const problems = [];
  const top = scene?.request ?? {};
  const parts = scene?.parts ?? {};
  if (!scene?.request) problems.push("a request needs its lines on top: asks:, needs: and by:, and for:, as:, when:, about:, gone when: or handed to: if it has them");
  const model = {
    kind,
    title: scene?.title ?? kind.replaceAll("_", " "),
    when: readCondition(top.when, "when", problems, false),
    gone: readCondition(top.gone, "gone when", problems, false),
    asker: top.asks ? readAsks(top.asks, problems) : (problems.push("asks: is missing"), null),
    need: top.needs ? readNeeds(top.needs, problems) : (problems.push("needs: is missing"), null),
    hours: top.by ? readBy(top.by, problems) : (problems.push("by: is missing"), null),
    handTo: top.handed ? readHandedTo(top.handed, problems) : null,
    about: top.about ? readAbout(top.about, problems) : null,
    for: top.for !== undefined ? readFor(top.for, problems) : null,
    order: top.as !== undefined ? readAs(top.as, problems) : false,
    problems,
  };
  const lives = model.for ?? ["anyone aboard"];
  const mentions = (name) => JSON.stringify(scene?.parts ?? {}).includes(`{${name}}`) || String(top.needs ?? "").toLowerCase().includes(name);
  if (model.asker?.officer && !lives.every(crewLife)) problems.push("asks: your officer is for crew aboard the Meridian, so it needs for: crew, or lives like engine hand");
  if ((model.asker?.boss || mentions("your boss") || mentions("boss")) && !lives.every(bossLife)) problems.push("your boss and {boss} are only for lives that have one, so it needs for: crew, outsiders, or lives like dock hand");
  if (model.order && lives.some((one) => one === "the captain" || one === "anyone" || one === "anyone aboard")) problems.push("the captain takes no orders, so an order needs for: crew, outsiders, or lives like engine hand");
  if (model.need?.kind === "shift" && lives.some((one) => one === "the captain" || one === "anyone" || one === "anyone aboard")) problems.push("the captain has no shifts to work, so work a shift needs for: crew, outsiders, or lives like dock hand");
  if (model.asker?.them && model.about && !ABOUT_ASKS.has(model.about)) problems.push(`asks: them is for a trouble that falls on someone (${[...ABOUT_ASKS].join(", ")}); for ${model.about}, say who asks`);
  if (model.asker?.them && !model.about) problems.push("asks: them needs an about: line saying whose trouble it is");
  if (model.need?.kind === "carry" && model.about !== DOWN) problems.push(`carry {about} to the medbay needs about: ${DOWN}`);
  if (!model.about && JSON.stringify(scene?.parts ?? {}).includes("{about}")) problems.push("{about} is only filled in for a request with an about: line");
  for (const part of ["ask", ...ENDINGS]) if (!parts[part]) problems.push(`it needs a part called ${part}`);
  const yesParts = Object.keys(parts).filter((id) => answerOf(id) === "yes");
  if (!yesParts.length && !parts.given) problems.push("it needs a part called yes (or yes_ and a word, one for each answer that settles it), for what they say when the player takes it on");
  if (scene?.start && scene.start !== "ask" && parts.ask) problems.push("it starts at its ask, so leave out the start: line");
  if (parts.ask && !(parts.ask.choices ?? []).some((choice) => answerOf(choice.to) === "yes" || choice.to === "given")) problems.push("its ask needs a choice that goes to yes");
  if (parts.handed && !top.handed) problems.push("it has a handed part, so it needs a handed to: line saying which post it goes to");
  if (top.handed && !parts.handed) problems.push("it has a handed to: line, so it needs a handed part for what they say when it's left to them");
  if (top.handed && !top.gone && model.need && model.need.kind !== "fix") problems.push("handed to: needs a gone when: line, which is how the game knows they got it done");
  if (parts.given && model.need && !["give", "sell"].includes(model.need.kind)) problems.push("a given part is for a request that needs something given or sold");
  if (model.need?.kind === "bring" && !top.gone) problems.push("gone when: is missing: a request to bring something needs it, so it can end when someone else brings it");
  compiled.set(scene, model);
  return model;
}

// Everything wrong with the request files, for npm run check-story: what the scene checker doesn't already say.
export function requestProblems(scenes = loadScenes().scenes) {
  const out = [];
  out.push(...storyRequestProblems(scenes));
  for (const [id, scene] of Object.entries(scenes)) {
    const isRequest = id.startsWith(PREFIX);
    if (!isRequest && scene.request) out.push(`${id}: only a request (a file called request_ and its kind) has when:, asks:, needs:, by:, gone when: and handed to: lines`);
    if (!isRequest) continue;
    for (const problem of compileRequest(id.slice(PREFIX.length), scene).problems) out.push(`${id}: ${problem}`);
  }
  return out;
}

// The kinds there are, ready to play: the files that can be read, with nothing wrong in their lines on top. Looked at
// again every couple of seconds at most, since the clock asks many times a second and a long wait asks every game
// hour, and a file someone has just saved is read soon enough.
const KINDS_KEPT_MS = 2000;
let keptKinds = null;
function requestKinds() {
  const now = Date.now();
  if (keptKinds && now - keptKinds.at < KINDS_KEPT_MS) return keptKinds.kinds;
  const { scenes } = loadScenes();
  const kinds = [];
  for (const [id, scene] of Object.entries(scenes)) {
    if (!id.startsWith(PREFIX)) continue;
    const model = compileRequest(id.slice(PREFIX.length), scene);
    if (!model.problems.length) kinds.push({ model, scene });
  }
  keptKinds = { at: now, kinds };
  return kinds;
}

// ---- Who asks, and who's named --------------------------------------------------------------------------------

const free = (game, key, place = SHIP) => key && key !== YOU && stillAlive(game, key) && !["dead", "in the brig", "being patched up", "down", "laid up in the medbay"].includes(lostReason(game, place, key));

// The officer over the player's job on the watch bill: whoever holds the post that heads it, or for a spare hand whoever
// keeps the watch bill. Nobody for the captain, or for someone who isn't on the Meridian's watch bill.
function officerOf(game) {
  const model = commandOf(SHIP);
  if (!model || isCaptain(game)) return null;
  const job = jobOf(game, SHIP, YOU);
  if (job === undefined) return null;
  const post = job ? model.posts.find((one) => one.heads.includes(job)) : model.posts.find((one) => one.watchBill);
  const key = post ? holderKey(game, SHIP, post.id) : null;
  return free(game, key) ? key : null;
}
// The first of the people the player's life begins with: their boss, at the place their life is.
function bossOf(game) {
  const start = startOf(game);
  const key = isCaptain(game) ? null : start?.people?.[0];
  return key && free(game, key, start.place) ? key : null;
}
// Someone with a name at the place the player is now, found there, other than their boss: whoever asked already, or
// one of them by the day, so it's someone different now and then.
function someoneHere(game, already = null) {
  const here = (key) => key !== YOU && key !== bossOf(game) && free(game, key, game.location) && personWhere(game, key)?.room && !personWhere(game, key)?.gone;
  if (already) return here(already) ? already : null;
  const keys = Object.keys(WORLD_CHARACTERS).filter((key) => WORLD_CHARACTERS[key].location === game.location && here(key)).sort();
  return keys.length ? keys[dayOf(nowOf(game)) % keys.length] : null;
}

// Who someone named in a request is in this game: whoever's asking, whoever holds the post, the one of the job already
// named or the first of them at work, or the person. Null when there's nobody.
function whoNow(game, who, { asker = null, already = null, about = null } = {}) {
  if (!who) return null;
  if (who.asker) return asker;
  // Whoever the trouble falls on, kept from when they asked: in the brig too, as long as they're alive.
  if (who.them) return already && stillAlive(game, already) ? already : null;
  if (who.about) return about;
  if (who.officer) return officerOf(game);
  if (who.boss) return bossOf(game);
  if (who.here) return someoneHere(game, already);
  if (who.post) {
    const key = holderKey(game, SHIP, who.post);
    return free(game, key) ? key : null;
  }
  if (who.job) {
    if (already && jobOf(game, SHIP, already) === who.job && free(game, already)) return already;
    return onJob(game, SHIP, who.job).find((key) => free(game, key) && !lostReason(game, SHIP, key)) ?? onJob(game, SHIP, who.job).find((key) => free(game, key)) ?? null;
  }
  return free(game, who.person, who.place ?? SHIP) ? who.person : null;
}
const askerNow = (game, model, open = null) => whoNow(game, model.asker, { already: open?.asker ?? null });

// What the request's lines call someone: in what's said, the name the talk knows them by ("Dr. Sen Aduro", "Cook
// Imre"); in a FIGHT, a WITH line or a chain-of-command line, their key.
export function askerStandIn(game, key) {
  if (!key) return null;
  const person = findCharacter(game.campaign, key);
  return { id: key, name: person ? fullName(person) : key };
}
const askedBy = (game, key) => (key ? upperFirst(calledBy(game, SHIP, key)) : "Someone");

// Whoever holds a place, for standing there: the side that has the most say there now, if it's one of the factions,
// or else the faction the place belongs to. A place run by people who aren't one of the factions (Cinder Reach's
// company and strikers, Tessen's colonists) has no standing to gain, and a * faction {port} line there does nothing.
function portOf(game, place) {
  const holder = game.world?.places?.[place]?.holder;
  if (FACTIONS[holder]) return holder;
  return FACTIONS[LOCATIONS[place]?.faction] ? LOCATIONS[place].faction : null;
}

// The stand-ins a request's lines can use: {asker}, and for a part to fix, {part} and {room}.
function extrasFor(game, open) {
  const extra = { asker: askerStandIn(game, open.asker) };
  const boss = isCaptain(game) ? null : startOf(game)?.people?.[0];
  if (boss) extra.boss = askerStandIn(game, boss);
  // Where it was asked, and whoever holds it: in the words their names, in a * faction line the faction's id.
  const place = open.place ?? SHIP;
  extra.place = { id: place, name: LOCATIONS[place]?.name ?? place };
  const port = portOf(game, place);
  if (port) extra.port = { id: port, name: FACTIONS[port].name };
  const words = open.part ? partWords(SHIP, open.part) : null;
  if (words) Object.assign(extra, { part: { id: open.part, name: words.name }, room: { id: open.part, name: words.room } });
  if (open.about) extra.about = askerStandIn(game, open.about);
  const post = open.post ? postById(SHIP, open.post) : null;
  if (post) {
    const holder = holderKey(game, SHIP, post.id);
    Object.assign(extra, { post: { id: post.id, name: post.title }, holder: holder && holder !== YOU ? askerStandIn(game, holder) : { id: "you", name: "you" } });
    // Who the captain would give it to while its holder can't do it (a post left empty).
    const deputy = deputyFor(game, SHIP, post.id);
    if (deputy) extra.deputy = askerStandIn(game, deputy);
  }
  // What a battle broke that's still waiting to be mended, in words (src/aftermath.js).
  extra.damage = { id: "damage", name: battleDamageWords(game, SHIP) };
  // Where someone's lying, for a request to fetch them.
  const d = open.about ? downOf(game, open.about) : null;
  const map = d ? mapFor(SHIP) : null;
  const room = map ? roomOf(map, map.levels?.[d.level]?.roomAt?.(d.x, d.y)) : null;
  if (room) extra.room = { id: room.id, name: room.name.replace(/^The /, "the ") };
  return extra;
}

// The request someone has for the player now, asked or put off, if any. Reading it changes nothing.
export function requestFor(game, key) {
  if (!key) return null;
  const now = nowOf(game);
  // Nobody asks lying where they fell: someone knocked down since they first had something to ask keeps it to themselves
  // until they're up, or awake on a cot. (Someone in the brig still asks: to be let out.)
  const open = Object.values(game.requests?.open ?? {}).find((one) => one.state === "offered" && one.asker === key && !(one.later > now) && !["dead", "down"].includes(lostReason(game, one.place ?? SHIP, key)));
  return open ?? null;
}
export const asksNow = (game, key) => Boolean(requestFor(game, key));

// The request's scene, with whoever's asking in it and what it's about, for the talk window.
export function requestScene(game, open) {
  const scene = loadScenes().scenes[`${PREFIX}${open.kind}`];
  return scene ? withStandIns(game, scene, extrasFor(game, open)) : null;
}
// The same, by kind, while the talk goes on.
export function requestSceneOf(game, kind) {
  const open = game.requests?.open?.[kind];
  return open ? requestScene(game, open) : null;
}

// ---- What's wanted, and how far it's got -----------------------------------------------------------------------

const nameOf = (game, key) => (key ? upperFirst(calledBy(game, SHIP, key)) : "someone");
const itemName = (item, n) => {
  const name = (ITEMS[item]?.name ?? item).toLowerCase();
  return n === 1 ? name : `${name}s`;
};
const needWords = (need, n) => {
  if (need.item === "fuel") return `${n} more fuel`;
  return `${n} ${n === 1 ? need.label.replace(/s$/, "") : need.label}`;
};
const counted = (need, got) => (need.n > 1 ? ` (${Math.min(need.n, Math.max(0, Math.floor(got)))}/${need.n})` : "");
// "Bring 2 medicine crates aboard (1/2)", "Fix the speaker in the Galley", "Give Nurse Haru the medkit".
function objectiveOf(game, model, open, got) {
  const { need } = model;
  switch (need.kind) {
    case "fix": {
      const words = partWords(SHIP, open.part);
      return words ? `Fix the ${words.name} in ${words.room}` : "Fix what's broken";
    }
    case "sell":
      return `Sell ${nameOf(game, open.to)} ${need.n} ${itemName(need.item, need.n)} at ${open.give?.price ?? "?"} credits each${counted(need, got)}`;
    case "give":
      return need.n === 1 ? `Give ${nameOf(game, open.to)} the ${itemName(need.item, 1)}` : `Give ${nameOf(game, open.to)} ${need.n} ${itemName(need.item, need.n)}${counted(need, got)}`;
    case "talk":
      return `Talk to ${nameOf(game, open.to)}`;
    case "carry":
      return `Carry ${nameOf(game, open.about)} to the medbay`;
    case "word":
      return `Your word to ${nameOf(game, open.asker)}`;
    case "shift":
      return need.n === 1 ? "Work a shift" : `Work ${need.n} shifts${counted(need, got)}`;
    case "go":
      return `Go to ${LOCATIONS[need.place]?.name ?? need.place}`;
    case "pass": {
      const where = need.at ? ` at the ${partWords(SHIP, need.at)?.name ?? "part"}` : need.with ? ` with ${nameOf(game, open.to)}` : "";
      return `Pass a check of ${SKILLS[need.skill]?.name?.toLowerCase() ?? need.skill}${where}`;
    }
    default:
      if (need.item === "fuel") return `Put ${needWords(need, need.n)} in the tank${counted(need, got)}`;
      return `Bring ${needWords(need, need.n)} ${need.into}${counted(need, got)}`;
  }
}
const withoutCount = (text) => String(text ?? "").replace(/ \(\d+\/\d+\)$/, "");

// The running total the game counts this request by, before taking off what it was when the player said yes.
function totalOf(game, need, open) {
  switch (need.kind) {
    case "fix": return putsOf(game, `fixed:${SHIP}`, open.part);
    case "give":
    case "sell": return putsOf(game, `give:${open.to}`, need.item);
    case "talk": return putsOf(game, "talk", open.to);
    // Being there is what counts, however they got there.
    case "go":
    case "word":
    case "carry": return 0;
    case "shift": return putsOf(game, "shift", "any");
    case "pass": return putsOf(game, `check:${need.skill}`, need.at ? `at:thing:part:${need.at}` : need.with ? `with:${open.to}` : "any");
    default: return putsOf(game, need.where, need.item);
  }
}
function progressOf(game, model, open) {
  if (model.need.kind === "go") return game.location === model.need.place ? 1 : 0;
  // Their word is all it took.
  if (model.need.kind === "word") return 1;
  // Carried by the player, and laid on a cot (or up on their feet again by then).
  if (model.need.kind === "carry") {
    const d = downOf(game, open.about);
    return open.carrying && (!d || d.bed) ? 1 : 0;
  }
  return totalOf(game, model.need, open) - (open.base ?? 0);
}
// Whether what was wanted was put right without the player: the gone when: line, and for a part, its being fixed.
// For a request about someone's trouble, the trouble being over: while the player carries them, it isn't.
const putRight = (game, model, open) => (model.need.kind === "fix" && !partBroken(game, SHIP, open.part))
  || Boolean(model.gone && conditionHolds(game, placed(model.gone, open.place ?? SHIP)))
  || Boolean(model.about && !open.carrying && !troubleStands(game, model, open));

// ---- What's left behind -------------------------------------------------------------------------------------

// What a request leaves on the record, for the scenes and the stories' notes to ask about with ? flag: done (the
// player did it), failed (they said yes and the day came first), refused (they said no), seen_to and left_undone (left
// to a post, which did or didn't). The latest time is the one on the record, with its words.
export const REQUEST_FACTS = ["done", "failed", "refused", "seen_to", "left_undone"];
const factOf = (kind, what) => `${PREFIX}${kind}_${what}`;
function leaveFact(game, kind, what, text) {
  const id = factOf(kind, what);
  if (!FACT_ID.test(id)) return;
  clearFact(game, id);
  recordFact(game, { id, text, from: `${PREFIX}${kind}` });
}
// Every fact the request files can leave, for the checker: a scene can wait on these.
export function requestFacts(scenes) {
  return Object.keys(scenes ?? {}).filter((id) => id.startsWith(PREFIX)).flatMap((id) => REQUEST_FACTS.map((what) => factOf(id.slice(PREFIX.length), what))).filter((id) => FACT_ID.test(id));
}
// What it was, in a few words for a memory: "medicine for the medbay".
const aboutWords = (model) => model.title.replace(/^./, (ch) => ch.toLowerCase());

// ---- Answers -------------------------------------------------------------------------------------------------

function stateOf(game) {
  game.requests ??= {};
  game.requests.open ??= {};
  game.requests.rest ??= {};
  game.requests.asked ??= {};
  game.requests.n ??= 0;
  return game.requests;
}
// How a kind last ended, for the written story to ask about (? request medicine done).
function noteEnded(game, kind, how) {
  const state = stateOf(game);
  state.ended = { ...(state.ended ?? {}), [kind]: { how, day: dayOf(nowOf(game)) } };
}

// The quest a request taken on or handed on is, under Requests in the log.
function addQuest(game, model, open, { desc, objective }) {
  game.quests ??= [];
  game.quests.push({
    id: open.quest,
    title: model.title,
    main: false,
    status: "active",
    desc,
    objective,
    request: model.kind,
    askedBy: askedBy(game, open.asker),
    due: open.due,
    ...(open.short ? { dueShort: true } : {}),
    ...(model.order ? { order: true } : {}),
    ...(open.state === "handed" ? { handed: true } : {}),
  });
  keepFewEnded(game);
}

// The player has answered: yes takes it on, given takes it on and gives what's wanted at once, handed leaves it to
// whoever's post it is, later puts it off a day, no turns it down. Says what to tell them.
export function answerRequest(game, kind, answer) {
  const state = stateOf(game);
  const open = state.open[kind];
  if (!open || open.state !== "offered") return [];
  const now = nowOf(game);
  if (answer === "later") {
    open.later = now + LATER;
    return [];
  }
  if (answer === "no") {
    delete state.open[kind];
    state.rest[kind] = now + REST.no;
    // They remember being told no, and it's on the record.
    const model = requestKinds().find((one) => one.model.kind === kind)?.model;
    noteEnded(game, kind, "refused");
    if (model?.order) {
      // An order refused costs more than a no, and they say so for a week.
      rememberRequest(game, open.asker, "disobeyed", { words: aboutWords(model) });
      leaveFact(game, kind, "refused", `You refused ${askedBy(game, open.asker)}'s orders about ${aboutWords(model)}, on day ${dayOf(now)}.`);
    } else if (model) {
      rememberRequest(game, open.asker, "turned_down", { words: aboutWords(model) });
      leaveFact(game, kind, "refused", `You told ${askedBy(game, open.asker)} no about ${aboutWords(model)}, on day ${dayOf(now)}.`);
    }
    return [];
  }
  if (!["yes", "given", "handed"].includes(answer)) return [];
  const found = requestKinds().find((one) => one.model.kind === kind);
  if (!found) return [];
  const { model } = found;
  state.n += 1;
  open.quest = `${PREFIX}${kind}_${state.n}`;
  open.due = now + model.hours;
  if (model.hours < 24) open.short = true;
  delete open.later;
  const by = askedBy(game, open.asker);
  if (answer === "handed" && model.handTo) {
    open.state = "handed";
    open.holder = model.handTo;
    const holder = nameOf(game, holderKey(game, SHIP, model.handTo));
    addQuest(game, model, open, { desc: `${by} asked you on day ${dayOf(now)}, and you left it to ${holder}.`, objective: `${holder} is seeing to it` });
    return [`[REQUEST] Handed on: ${model.title}. ${holder} is to see to it by ${dueOf(open)}. It's in your quests (J), under Requests.`];
  }
  open.state = "accepted";
  // Who it's about, for giving, talking or a check with someone: whoever that is now, kept for the rest of it.
  const to = model.need.to ?? model.need.with ?? null;
  if (to) open.to = whoNow(game, to, { asker: open.asker, about: open.about }) ?? open.asker;
  if (model.need.kind === "give") open.give = { item: model.need.item, n: model.need.n, to: open.to };
  // What they'll pay for each, fixed now: what it costs on the market here, times what they offered.
  if (model.need.kind === "sell") open.give = { item: model.need.item, n: model.need.n, to: open.to, price: Math.max(1, Math.round((ITEMS[model.need.item]?.price ?? 0) * itemFactor(game, ITEMS[model.need.item]) * model.need.factor)) };
  open.base = totalOf(game, model.need, open);
  const objective = objectiveOf(game, model, open, 0);
  addQuest(game, model, open, { desc: model.order ? `${by} gave you the order on day ${dayOf(now)}.` : `${by} asked you on day ${dayOf(now)}.`, objective });
  const notes = [`[REQUEST] Taken on: ${model.title}. ${withoutCount(objective)}, by ${dueOf(open)}. It's in your quests (J), under Requests.`];
  // Given there and then: as many as the player has, up to what's wanted.
  if (answer === "given" && open.give) {
    const n = Math.min(open.give.n, game.inventory?.[open.give.item] ?? 0);
    if (n > 0) {
      removeItem(game, open.give.item, n);
      notePut(game, `give:${open.to}`, open.give.item, n);
      notes.push(`[ITEM] You give ${nameOf(game, open.to)} ${n === 1 ? `the ${itemName(open.give.item, 1)}` : `${n} ${itemName(open.give.item, n)}`}.`);
    }
  }
  return notes;
}

// Old requests that have ended leave the quest log once there are more than a few.
function keepFewEnded(game) {
  const ended = (game.quests ?? []).filter((quest) => quest.request && quest.status !== "active");
  if (ended.length <= KEEP_ENDED) return;
  const drop = new Set(ended.slice(0, ended.length - KEEP_ENDED));
  game.quests = game.quests.filter((quest) => !drop.has(quest));
}

// ---- Playing how it ended -------------------------------------------------------------------------------------

// What a part says, as one line for the story: speech as "Name: words", the rest as it is.
function partSays(part) {
  return (part?.text ?? []).filter(Boolean).map((line) => String(line).replace(/^@([^:]+):\s*/, "$1: ").replace(/^=>\s*/, "")).join(" ").trim();
}

// What a part changes, outside a talk or a scene: facts, the chain of command (a memory, loyalty) and the game's
// actions. A line that can't be played is said, and the rest go on, so the clock never stops for it.
function playSteps(game, part, notes, where) {
  const turn = newTurnLimits();
  for (const step of part?.do ?? []) {
    const { tool, set, clear, line, ...input } = step;
    // Standing at a place nobody of the factions holds: there's nobody to have it with.
    if (tool === "change_faction" && /^{/.test(String(input.faction ?? ""))) continue;
    try {
      if (set) recordFact(game, { id: set, text: step.text ?? null, from: where });
      else if (clear) clearFact(game, clear);
      else if (step.command) notes.push(...storyCommand(game, step));
      else if (step.request) notes.push(...storyRequestStep(game, step));
      // A system switched, or a password told (step 10 of the hacking rework).
      else if (step.systems) notes.push(...applySystemsEffect(game, step.systems, { by: "story" }));
      else if (step.password) {
        game.passwords ??= {};
        game.passwords[step.password] = step.word;
        notes.push(`[COMPUTER] You know the password to ${WORLD_COMPUTERS[step.password]?.name ?? step.password} now.`);
      }
      else if (tool) {
        const outcome = runTool(game, tool, input, turn);
        if (outcome.isError) throw new Error(outcome.result);
        if (outcome.notice) notes.push(outcome.notice);
      }
    } catch (err) {
      console.error(`${where}, line ${line ?? "?"}: ${err.message}`);
    }
  }
}

const HEADLINE = { done: "Done", gone: "No longer needed", failed: "Failed" };
// How the quest log sums it up once it's over.
const LAST_STEP = {
  gone: () => "No longer needed: it was put right without you.",
  failed: (model, open) => `Failed: ${dueOf(open)} came and went.`,
};
function doneStep(game, model, open) {
  const { need } = model;
  if (need.kind === "bring") return `Done: you brought ${needWords(need, need.n)} ${need.item === "fuel" ? "to the tank" : need.into}.`;
  if (need.kind === "sell") return `Done: you sold ${nameOf(game, open.to)} ${need.n} ${itemName(need.item, need.n)} for ${(open.paid ?? need.n) * (open.give?.price ?? 0)} credits.`;
  return `Done: ${withoutCount(objectiveOf(game, model, open, need.n)).replace(/^./, (ch) => ch.toLowerCase())}.`;
}

function closeQuest(game, open, status, objective) {
  const quest = (game.quests ?? []).find((one) => one.id === open.quest);
  if (!quest) return;
  quest.done = [...(quest.done ?? []), withoutCount(quest.objective)].slice(-20);
  quest.status = status;
  quest.objective = objective;
}

function endRequest(game, found, open, how, notes) {
  const { model } = found;
  const state = stateOf(game);
  open.asker = askerNow(game, model, open) ?? open.asker;
  const scene = withStandIns(game, found.scene, extrasFor(game, open));
  const part = scene?.parts?.[how];
  const words = partSays(part);
  notes.push(`[REQUEST] ${HEADLINE[how]}: ${model.title}.${words ? ` ${words}` : ""}`);
  playSteps(game, part, notes, `${PREFIX}${model.kind}`);
  const step = how === "done" ? doneStep(game, model, open) : LAST_STEP[how](model, open);
  closeQuest(game, open, how === "failed" ? "failed" : "completed", step);
  // Whoever asked remembers it, for or against the player, and it's on the record. Put right without them, there's
  // nothing to remember.
  const by = askedBy(game, open.asker);
  const day = dayOf(nowOf(game));
  if (how === "done") {
    rememberRequest(game, open.asker, model.order ? "obeyed" : "helped", { words: aboutWords(model) });
    leaveFact(game, model.kind, "done", `${step.replace(/^Done: you/, "You").replace(/\.$/, "")}, when ${by} asked (day ${day}).`);
  } else if (how === "failed") {
    rememberRequest(game, open.asker, "let_down", { words: aboutWords(model) });
    leaveFact(game, model.kind, "failed", `You said you'd see to ${aboutWords(model)} for ${by}, and ${dueOf(open)} came first.`);
  }
  noteEnded(game, model.kind, how);
  delete state.open[model.kind];
  state.rest[model.kind] = nowOf(game) + REST[how];
}

// A request handed to a post is over: done by them, or not by the day. It's on that post's duty for the day.
function endHanded(game, found, open, how, notes) {
  const { model } = found;
  const state = stateOf(game);
  const holder = nameOf(game, holderKey(game, SHIP, open.holder));
  notes.push(how === "done" ? `[REQUEST] Done by ${holder}: ${model.title}.` : `[REQUEST] Failed: ${model.title}. ${holder} didn't see to it by ${dueOf(open)}.`);
  tallyDuty(game, SHIP, Math.floor(nowOf(game) / 24), { [`handed:${open.holder}`]: HANDED_DUTY[how] });
  closeQuest(game, open, how === "done" ? "completed" : "failed", how === "done" ? `Done by ${holder}.` : `Failed: ${holder} didn't see to it by ${dueOf(open)}.`);
  // Whoever asked remembers that it was seen to, or that it wasn't, a little less than if the player had done it or
  // let it go themselves; and it's on the record.
  const by = askedBy(game, open.asker);
  if (how === "done") {
    rememberRequest(game, open.asker, "seen_to", { words: aboutWords(model), about: holderKey(game, SHIP, open.holder) });
    leaveFact(game, model.kind, "seen_to", `${holder} saw to ${aboutWords(model)} for ${by}, when you left it to them (day ${dayOf(nowOf(game))}).`);
  } else {
    rememberRequest(game, open.asker, "let_down", { words: aboutWords(model), w: -6 });
    leaveFact(game, model.kind, "left_undone", `You left ${aboutWords(model)} to ${holder} for ${by}, and ${dueOf(open)} came first.`);
  }
  noteEnded(game, model.kind, how === "done" ? "seen_to" : "left_undone");
  delete state.open[model.kind];
  state.rest[model.kind] = nowOf(game) + REST[how];
}

// ---- The clock ---------------------------------------------------------------------------------------------

// Whether to look for new asks: once a game hour, since the conditions don't change faster than the ship's stores do.
const lookedAt = new WeakMap();

function settleOffered(game, found, one) {
  const { model } = found;
  // Nobody's waiting to be asked about something that's been put right, or by someone who can't ask any more.
  const asker = askerNow(game, model, one);
  // One the written story started is asked whatever its when: line says, as long as there's someone to ask it, and
  // until what it's about is put right without the player (its gone when: line), if it wasn't already when asked.
  const stale = !asker || Boolean(game.requests.off?.[one.kind]) || (!one.story && !whenHolds(game, model, one)) || (model.need.kind === "fix" && !partBroken(game, SHIP, one.part)) || Boolean(model.about && !troubleStands(game, model, one))
    || Boolean(model.gone && !one.goneAtFirst && conditionHolds(game, placed(model.gone, one.place ?? SHIP)));
  if (stale) {
    delete game.requests.open[one.kind];
    game.requests.rest[one.kind] = nowOf(game) + REST.dropped;
  } else one.asker = asker;
}

// Whoever asked has died, and nobody has taken their place to ask it: the request is over, with nobody left to thank the
// player or hold it against them. (A dead chief engineer once told the captain off for the parts, five days on.)
function endWithNobody(game, found, open, notes) {
  const { model } = found;
  const state = stateOf(game);
  const name = nameOf(game, open.asker);
  notes.push(`[REQUEST] Over: ${model.title}. ${name} is dead, and nobody else is asking.`);
  closeQuest(game, open, "failed", `Over: ${name} died before it was done.`);
  noteEnded(game, model.kind, "gone");
  delete state.open[model.kind];
  state.rest[model.kind] = nowOf(game) + REST.gone;
}
const askerDied = (game, one) => Boolean(one.asker) && (!stillAlive(game, one.asker) || lostReason(game, one.place ?? SHIP, one.asker) === "dead");

function settleAccepted(game, found, one, notes) {
  const { model } = found;
  if (!askerNow(game, model, one) && askerDied(game, one)) return endWithNobody(game, found, one, notes);
  if (model.need.kind === "carry") {
    const d = downOf(game, one.about);
    if (d?.carriedBy === YOU) one.carrying = true;
    // Nobody can be brought in who's died where they lay.
    if (d?.dead) return endRequest(game, found, one, "failed", notes);
  }
  const got = progressOf(game, model, one);
  const quest = (game.quests ?? []).find((q) => q.id === one.quest);
  // What's been sold is paid for as it's handed over.
  if (model.need.kind === "sell") payFor(game, one, Math.min(model.need.n, Math.floor(got)), notes);
  if (got >= model.need.n) return endRequest(game, found, one, "done", notes);
  if (putRight(game, model, one)) return endRequest(game, found, one, got > 0 ? "done" : "gone", notes);
  if (nowOf(game) >= one.due) return endRequest(game, found, one, "failed", notes);
  const objective = objectiveOf(game, model, one, got);
  if (quest) quest.objective = objective;
  const asker = askerNow(game, model, one);
  if (asker) {
    one.asker = asker;
    if (quest) quest.askedBy = askedBy(game, asker);
  }
  // A day before it's due, the player hears once, if they were given more than a day for it.
  if (!one.reminded && model.hours > 24 && one.due - nowOf(game) <= 24) {
    one.reminded = true;
    notes.push(`[REQUEST] Due tomorrow: ${model.title}. ${objective}.`);
  }
}

function payFor(game, one, sold, notes) {
  const owed = sold - (one.paid ?? 0);
  if (owed <= 0 || !one.give?.price) return;
  const total = owed * one.give.price;
  game.credits = (game.credits ?? 0) + total;
  one.paid = (one.paid ?? 0) + owed;
  notes.push(`[REQUEST] ${nameOf(game, one.to)} pays you ${total} credits for ${owed === 1 ? `the ${itemName(one.give.item, 1)}` : `${owed} ${itemName(one.give.item, owed)}`}.`);
}

function settleHanded(game, found, one, notes) {
  if (putRight(game, found.model, one)) return endHanded(game, found, one, "done", notes);
  if (nowOf(game) >= one.due) return endHanded(game, found, one, "failed", notes);
}

// Called whenever the clock moves, and after the player buys, carries, fixes or gives something. Requests taken on are
// counted and end when they should; asked ones that aren't needed any more are dropped; and once a game hour, once a
// day at most, someone with a new trouble has something to ask. Says what the player should hear.
export function advanceRequests(game) {
  const notes = [];
  if (!game?.clock || !commandOf(SHIP) || !logisticsOf(SHIP)) return notes;
  const open = Object.values(game.requests?.open ?? {});
  const hour = Math.floor(nowOf(game));
  const look = lookedAt.get(game) !== hour;
  if (!open.length && !look) return notes;
  const kinds = requestKinds();
  const byKind = new Map(kinds.map((one) => [one.model.kind, one]));
  for (const one of open) {
    const found = byKind.get(one.kind);
    // A file that's gone or can't be read any more: what was asked is dropped, and a quest taken on stays as it was.
    if (!found) {
      if (one.state === "offered") delete game.requests.open[one.kind];
      continue;
    }
    if (one.state === "offered") settleOffered(game, found, one);
    else if (one.state === "handed") settleHanded(game, found, one, notes);
    else settleAccepted(game, found, one, notes);
  }
  if (look) {
    lookedAt.set(game, hour);
    notes.push(...newAsks(game, kinds));
  }
  return notes;
}

// The part a request to fix something is about: the one it names, or one of those waiting for a parts crate that no
// other request is about yet.
function partToFix(game, need) {
  if (need.part) return partBroken(game, SHIP, need.part) ? need.part : null;
  const taken = new Set(Object.values(game.requests?.open ?? {}).map((one) => one.part).filter(Boolean));
  return partsWaitingIds(game, SHIP).find((id) => !taken.has(id)) ?? null;
}

// Whether a kind's when: line holds now (a kind without one comes up whenever its life and its trouble allow).
// Before anyone's asked, {place} is where the player is; once they have, where it was asked.
const whenHolds = (game, model, open = null) => !model.when || conditionHolds(game, placed(model.when, open?.place ?? game.location));
// Whether the player is in the middle of something the story comes first for: a written scene being played with them
// (not one waiting for someone elsewhere), a fight, a check, or a computer.
const inTheMiddle = (game) => Boolean(game.combat || game.check || game.computer || (game.scene && !heldUp(game)));
// Where whoever asks is found: their boss where the player's life is, someone here where the player is, and everyone
// else aboard the Meridian.
function askedAt(game, model) {
  if (model.asker.place) return model.asker.place;
  if (model.asker.boss) return startOf(game)?.place ?? null;
  // Someone here who wants something of the player's boss asks where that boss is: nobody aboard the Meridian asks a
  // visiting porter to get them a word with a doctor on another ship.
  if (model.asker.here) return model.need?.to?.boss ? startOf(game)?.place ?? null : game.location;
  return SHIP;
}
// Whether the player is where a kind can be asked: aboard (or, for the captain, anywhere: they're told when they're
// back), or at the place where whoever asks is.
const reachable = (game, model) => {
  const place = askedAt(game, model);
  return place === SHIP ? aboardShip(game) : Boolean(place) && game.location === place;
};
// The room someone asking is found in, for the line that says so.
function roomWords(game, model, asker) {
  if (model.asker.room) return roomOf(mapFor(SHIP), model.asker.room)?.name ?? null;
  if (model.asker.officer) return postById(SHIP, postOf(game, SHIP, asker))?.roomName ?? null;
  if (model.asker.boss) {
    const start = startOf(game);
    return start?.room ? roomOf(mapFor(start.place), start.room)?.name ?? null : null;
  }
  if (model.asker.here || model.asker.place) return personWhere(game, asker)?.room ?? null;
  return null;
}
// How the line puts it: orders from whoever's over the player, a decision for the captain from one of their officers,
// or something to ask.
function askWords(game, model, asker) {
  if (model.order) return "has orders for you";
  if (isCaptain(game) && postOf(game, SHIP, asker)) return "has something for you to decide";
  return "has something to ask you";
}

// Someone with a new trouble has something to ask. The pacer: three waiting at most, a quiet day between one new ask and
// the next (unless it can't wait: one given less than a day), nothing while a written scene is being played, never one
// that's resting after it last ended, not the same kind twice running when there's another, and the one asked longest
// ago first. Only kinds for the player's life, asked where whoever asks is.
function newAsks(game, kinds) {
  if (!kinds.length || inTheMiddle(game)) return [];
  const now = nowOf(game);
  const today = dayOf(now);
  const waiting = Object.keys(game.requests?.open ?? {}).length;
  if (waiting >= MOST_OPEN) return [];
  const hourOfDay = now % 24;
  const night = hourOfDay < ASKING_HOURS[0] || hourOfDay >= ASKING_HOURS[1];
  const quiet = night || (game.requests?.day !== undefined && today - game.requests.day <= QUIET_DAYS);
  const asked = game.requests?.asked ?? {};
  const last = game.requests?.last ?? null;
  const ready = kinds
    .filter(({ model }) => !game.requests?.open?.[model.kind] && !game.requests?.off?.[model.kind] && !((game.requests?.rest?.[model.kind] ?? -Infinity) > now))
    .filter(({ model }) => (!quiet || model.hours < 24) && forLife(game, model) && reachable(game, model))
    .sort((a, b) => (a.model.kind === last) - (b.model.kind === last) || (asked[a.model.kind] ?? -Infinity) - (asked[b.model.kind] ?? -Infinity));
  // Someone a written scene is waiting on plays that scene when they're talked to, not a request.
  const waitedOn = new Set(scenesUnderWay(game).map((scene) => scene.with).filter(Boolean));
  for (const found of ready) {
    const { model } = found;
    if (!whenHolds(game, model)) continue;
    // Whose trouble it is, when it's about someone: the first of them with someone free to ask about it, not asking
    // about something else already (asks: them is the trouble's own person, who may be the one it's about). Otherwise,
    // whoever the asks: line says.
    const busy = (key) => Object.values(game.requests?.open ?? {}).some((one) => one.asker === key);
    const trouble = model.about
      ? troublesFor(game, model).find((one) => {
        const key = model.asker.them ? one.asker : askerNow(game, model);
        return key && (model.asker.them || key !== one.about) && !busy(key);
      })
      : null;
    if (model.about && !trouble) continue;
    const asker = model.asker.them ? trouble.asker : askerNow(game, model);
    // One thing to ask at a time each.
    if (!asker || busy(asker) || waitedOn.has(asker)) continue;
    const part = model.need.kind === "fix" ? partToFix(game, model.need) : null;
    if (model.need.kind === "fix" && !part) continue;
    const state = stateOf(game);
    state.open[model.kind] = { kind: model.kind, asker, at: now, place: askedAt(game, model), state: "offered", ...(part ? { part } : {}), ...(trouble ? { about: trouble.about, post: trouble.post ?? null } : {}) };
    state.asked[model.kind] = now;
    state.last = model.kind;
    // What can't wait doesn't take a day from the pace.
    if (model.hours >= 24) state.day = today;
    const room = roomWords(game, model, asker);
    if (game.location !== askedAt(game, model)) return [];
    return [`[REQUEST] ${askedBy(game, asker)} ${askWords(game, model, asker)}${room ? `, in ${room.replace(/^The /, "the ")}` : ""}.`];
  }
  return [];
}

// ---- The written story ---------------------------------------------------------------------------------------

// A line of a scene, a conversation or a computer's program: * request <kind> has someone ask it now, without waiting
// their turn (the pacer, its rest, and its when: line are passed over, but someone has to be there to ask it, and a
// trouble it's about has to be there); * request <kind> off turns the kind off, so a written scene can take that
// trouble over (one waiting to be asked goes, one taken on goes on), and * request <kind> on turns it on again.
function storyRequestStep(game, step) {
  const found = requestKinds().find((one) => one.model.kind === step.request);
  const title = found?.model.title ?? String(step.request).replaceAll("_", " ");
  if (!found) return [`[REQUEST] There's no request called ${step.request}: ${step.reason}`];
  const state = stateOf(game);
  const { model } = found;
  if (step.turn === "off") {
    state.off = { ...(state.off ?? {}), [model.kind]: true };
    if (state.open[model.kind]?.state === "offered") delete state.open[model.kind];
    return [];
  }
  if (step.turn === "on") {
    if (state.off) delete state.off[model.kind];
    return [];
  }
  if (state.open[model.kind]) return [];
  const busy = (key) => Object.values(state.open).some((one) => one.asker === key);
  const trouble = model.about ? troublesFor(game, model).find((one) => {
    const key = model.asker.them ? one.asker : askerNow(game, model);
    return key && (model.asker.them || key !== one.about) && !busy(key);
  }) : null;
  const asker = model.about ? (trouble && (model.asker.them ? trouble.asker : askerNow(game, model))) : askerNow(game, model);
  const part = model.need.kind === "fix" ? partToFix(game, model.need) : null;
  if (!asker || busy(asker) || (model.about && !trouble) || (model.need.kind === "fix" && !part)) return [`[REQUEST] Nobody can ask about ${title.toLowerCase()} just now.`];
  if (state.off) delete state.off[model.kind];
  const now = nowOf(game);
  // Whether what it's about was already put right when the story asked it: then that doesn't end it.
  const already = Boolean(model.gone && conditionHolds(game, placed(model.gone, askedAt(game, model))));
  state.open[model.kind] = { kind: model.kind, asker, at: now, place: askedAt(game, model), state: "offered", story: true, ...(already ? { goneAtFirst: true } : {}), ...(part ? { part } : {}), ...(trouble ? { about: trouble.about, post: trouble.post ?? null } : {}) };
  state.asked[model.kind] = now;
  state.last = model.kind;
  const room = roomWords(game, model, asker);
  return game.location === askedAt(game, model) ? [`[REQUEST] ${askedBy(game, asker)} ${askWords(game, model, asker)}${room ? `, in ${room.replace(/^The /, "the ")}` : ""}.`] : [];
}
tellStoryRequests(storyRequestStep);

// The kinds the written story names, with ? request or * request, that have no request file: for npm run check-story.
export function storyRequestProblems(scenes) {
  const kinds = new Set(Object.keys(scenes).filter((id) => id.startsWith(PREFIX)).map((id) => id.slice(PREFIX.length)));
  const out = [];
  for (const [id, scene] of Object.entries(scenes)) {
    const text = JSON.stringify(scene);
    const named = new Set([...text.matchAll(/\brequest ([a-z0-9_]+) (?:asked|taken|done|failed|refused|gone|off|none)\b/g), ...text.matchAll(/"request":"([a-z0-9_]+)"/g)].map((one) => one[1]));
    for (const kind of named) if (!kinds.has(kind)) out.push(`${id}: there's no request called ${kind}: the requests are ${[...kinds].sort().join(", ")}`);
  }
  return out;
}

// The clock moves the requests on (src/rules.js can't import this file, since it reads the scenes).
tellRequests(advanceRequests);
