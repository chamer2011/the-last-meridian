// Computers: what they are and how the player gets in. A computer is a plain-text file in
// world/computers, read by public/world-text.js, or a generic one the game makes for a console,
// server, panel or power board in a room, or a door with a hack on it, that nobody has written.
// The player gets in by right (the Meridian's own), with a password they've learned, or at the computer's logon,
// with a breaker off their rig that's strong enough for its class (step 3 of the hacking rework: no check window, and
// the watcher counting noise from the first try). What they can do once in is src/computer-use.js. This file is read
// by the rules and the walk, so it reads nothing that reads the tools.

import { registerTable } from "./register.js";
import { LOCATIONS } from "./data.js";
import { placeNow, worldOf } from "./daily.js";
import { DIFFICULTY, DIFFICULTY_LEARNING, practice } from "./rules.js";
import { conditionHolds, parseCondition, parseEffect } from "./scene-text.js";
import { tierFor } from "./checks.js";
import { setHackHandler } from "./hack-hook.js";
import { classOf, roomFor } from "./hack-classes.js";
import { recordFact } from "./record.js";
import { notePut } from "./puts.js";
import { fill } from "./check-games/kit.js";
import { CHECK_TEXT, COMPUTER_FLAVOR, WORLD_COMPUTERS, WORLD_MAPS } from "./world.js";
import { controlsFor, controlsView, ownedBy, partWorks, roomPowered, runsSystems } from "./systems.js";
import { rigFace, rigHeat, rigInComputer } from "./rig.js";
import { LINK_WORDS, LOOKS, THROUGH_RIG, deviceView, howOf, leaveOf, lookOf, reachOf, reachWhy, rigReaches } from "./devices.js";
import { networkView } from "./network.js";
import { contentHardened, hardenedHints, weakWords, withWeakPoints } from "./weak-points.js";
import { inSentence, rightsWords, sealedNow, sealedWords, trustLine, trustsOf, withRights } from "./sealed.js";
import { noteGotIn } from "./story-rig.js";
import "./terminals.js";


export const slug = (words) => String(words).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
export const line = (text, tone = "info") => ({ text: String(text), tone });
export const MINUTES_PER_ACTION = 2;
export const MAX_LOG = 120;

// ---- The classes of computer, shared with the hacking game ----------------------------------

export const classKeys = () => Object.keys(DIFFICULTY);
export const classKeyOf = (text) => {
  const key = String(text ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return classKeys().includes(key) ? key : "moderate";
};
export const classNameOf = (classKey) => classOf(CHECK_TEXT.skills?.hacking, classKey).name;

// The watcher's numbers for a class, with what the player's training adds: the noise at which it notices them, starts
// a trace, and cuts them off, and the minutes a trace takes to find them. mark is whether being found or cut off leaves
// a fact on the record.
export function watchFor(game, classKey) {
  const text = CHECK_TEXT.skills?.hacking;
  const c = classOf(text, classKey);
  const room = roomFor(text, tierFor(game, "hacking"));
  return { notices: c.notices + room, traces: c.traces + room, finds: c.finds, cuts: c.cuts + room, mark: Boolean(c.mark), name: "AuditGuard" };
}
// The watcher, by the name it goes by on this kind of computer: AuditGuard, a door's own log, a junction box's fault
// board, a camera's security desk, SENTRY.
export function watcherOf(game, session) {
  const watch = watchFor(game, session.classKey);
  const name = LOOKS[session.look]?.watcher;
  return name ? { ...watch, name } : watch;
}
// Where the watcher stands: calm, noticed (everything one louder), or tracing.
export const watchStage = (session) => (session.traceLeft !== null && session.traceLeft !== undefined ? "tracing" : session.noticed ? "noticed" : "calm");

// ---- Reading a computer's file --------------------------------------------------------------

// A program's text is what it says when it runs, then -> and the effects separated by ;, then ? and a condition.
export function programOf(entry) {
  const problems = [];
  let text = String(entry.desc ?? "").trim();
  let condition = null;
  const ask = text.lastIndexOf(" ? ");
  if (ask >= 0) {
    condition = text.slice(ask + 3).trim();
    text = text.slice(0, ask).trim();
  }
  const effects = [];
  const arrow = text.indexOf("->");
  if (arrow >= 0) {
    const tail = text.slice(arrow + 2);
    text = text.slice(0, arrow).trim();
    for (const piece of tail.split(";").map((one) => one.trim().replace(/^\*\s*/, "")).filter(Boolean)) {
      const parsed = parseEffect(piece);
      if (parsed.problem) problems.push(`in the program "${entry.name}", ${parsed.problem}`);
      else effects.push(parsed.do);
    }
  }
  if (condition) {
    const parsed = parseCondition(condition);
    if (parsed?.problem) problems.push(`in the program "${entry.name}", the condition ${parsed.problem}`);
  }
  return { id: slug(entry.name), name: String(entry.name).trim(), text, effects, condition, problems };
}

// "From someone to someone: the letter" or just a subject and the letter.
export function mailOf(entry) {
  const found = String(entry.name).match(/^from\s+(.+?)\s+to\s+(.+)$/i);
  return { from: found ? found[1].trim() : String(entry.name).trim(), to: found ? found[2].trim() : null, subject: found ? null : String(entry.name).trim(), text: String(entry.desc ?? "").trim() };
}

const LOG_KINDS = { berths: "The berth log", prices: "Today's prices", people: "Who's here", news: "What's been heard", readouts: "The ship's readouts", manifest: "The lighter's manifest", register: "The register of everyone aboard" };
const logOf = (text, i) => {
  const key = String(text).trim().toLowerCase();
  return LOG_KINDS[key] ? { id: key, name: LOG_KINDS[key], kind: key } : { id: `log_${i + 1}`, name: String(text).trim().slice(0, 48), kind: "text", text: String(text).trim() };
};

export function writtenContent(id) {
  const c = WORLD_COMPUTERS[id];
  if (!c) return null;
  const yours = Boolean(c.yours);
  return {
    id,
    name: c.name,
    classKey: classKeyOf(c.class),
    yours,
    owner: c.owner ?? null,
    place: c.place ?? null,
    room: c.room ?? null,
    thing: c.thing ?? null,
    door: c.door ?? null,
    user: c.user || (yours ? "captain" : "admin"),
    password: c.password || null,
    flavor: c.flavor || (yours ? "yours" : "default"),
    desc: c.desc ?? "",
    files: (c.files ?? []).map((file) => ({ id: slug(file.name), name: String(file.name).trim(), text: String(file.desc ?? "").trim() })),
    mail: (c.mail ?? []).map((entry, i) => ({ id: `mail_${i + 1}`, ...mailOf(entry) })),
    logs: (c.logs ?? []).map(logOf),
    programs: (c.programs ?? []).map(programOf),
    network: (c.network ?? []).map((entry) => ({ id: String(entry.name).trim(), desc: String(entry.desc ?? "").trim() })),
    roomId: c.place && c.room ? roomIdNamed(c.place, c.room) : null,
    controls: c.place ? controlsFor(c.place, { written: id }) : [],
    look: c.look ? String(c.look).trim().toLowerCase() : null,
    reach: c.reach ? String(c.reach).trim().toLowerCase() : null,
    // No breaker works on it from the front: its way in is written somewhere else at its place (src/weak-points.js).
    hardened: Boolean(c.hardened),
    // Sealed: it takes nothing at its own keyboard, and lets in only the machines it trusts (src/sealed.js).
    sealed: Boolean(c.sealed),
    trusts: trustsOf(c.trusts),
  };
}

// The rooms of a place, from its files: the levels that are rooms, and the rooms drawn on a deck, each with the
// deck's things, since those are the deck's.
export const roomsOfPlace = (place) => Object.entries(WORLD_MAPS[place]?.levels ?? {}).flatMap(([id, level]) => (level.areas?.length ? level.areas.map((area) => ({ ...area, things: level.things ?? {}, people: level.people ?? {} })) : [{ id, ...level }]));

// A room's id from its name, at a place.
function roomIdNamed(place, name) {
  return roomsOfPlace(place).find((room) => String(room.name).toLowerCase() === String(name).toLowerCase())?.id ?? null;
}

// ---- Computers nobody has written -----------------------------------------------------------

const GENERIC_KINDS = [
  [/\b(server|mainframe|archive)\b/i, "server"],
  [/\b(console|terminal|repeater|readout|relay|transmitter)\b/i, "console"],
  [/\b(keypad|panel)\b/i, "panel"],
  [/\b(power board|restart board|breakers?|power meter)\b/i, "power"],
];
// What a thing in a room is, as a computer, if it's one at all. Things that are items to pick up aren't.
export function genericKindOf(thing) {
  if (!thing || thing.item || /\bdead\b/i.test(thing.name ?? "")) return null;
  for (const [pattern, kind] of GENERIC_KINDS) if (pattern.test(thing.name ?? "")) return kind;
  return null;
}

// The same generic computer comes out the same way every time, from its key.
function seeded(key) {
  let n = 7;
  for (const ch of String(key)) n = (Math.imul(n, 31) + ch.codePointAt(0)) >>> 0;
  return () => {
    n = (Math.imul(n, 1103515245) + 12345) >>> 0;
    return n / 4294967296;
  };
}

const levelsOf = (place) => Object.entries(WORLD_MAPS[place]?.levels ?? {}).map(([id, level]) => ({ id, ...level }));
export const peopleAt = (place) => [...new Set(levelsOf(place).flatMap((level) => Object.values(level.people ?? {}).map((home) => home.label).filter(Boolean)))];

function genericContent(game, { key, name, kind, place, room = null, roomId = null, door = null, classKey = null, ref = null }) {
  const flavor = COMPUTER_FLAVOR ?? {};
  const spec = flavor.kinds?.[kind] ?? flavor.kinds?.console ?? {};
  const roll = seeded(key);
  const pick = (list) => (list?.length ? list[Math.floor(roll() * list.length)] : "");
  const yours = place === "meridian";
  const placeName = LOCATIONS[place]?.name ?? place ?? "here";
  const people = peopleAt(place);
  const person = people.length ? people[Math.floor(roll() * people.length)] : "the night shift";
  const other = people.filter((one) => one !== person)[0] ?? "the day shift";
  worldOf(game);
  const now = placeNow(game, place);
  const goods = now?.goods?.length ? now.goods.map((good) => `${good.name} ${good.level}`).join(", ") : "nothing counted";
  const holder = now?.holder ?? "the management";
  const user = yours ? "captain" : pick(flavor.users ?? ["admin"]) || "admin";
  const values = { place: place ?? "here", placeName, room: room ?? "", holder, person, other, user, goods, people: people.length ? people.join(", ") : "nobody by name", note: fill(pick(flavor.notes ?? ["Nothing of note."]), { person, other }) };
  const files = (spec.files ?? []).map((id) => flavor.files?.[id]).filter(Boolean).map((file) => ({ id: slug(file.name), name: file.name, text: fill(file.text, values) }));
  const mail = (flavor.mail ?? []).slice(0, spec.mail ?? 0).map((entry, i) => ({ id: `mail_${i + 1}`, from: fill(entry.from, values), to: fill(entry.to, values), subject: entry.subject ?? null, text: fill(entry.text, values) }));
  const logs = (spec.logs ?? []).map(logOf);
  const programs = (spec.programs ?? []).map((program) => programOf({ name: program.name, desc: fill(program.text, values) }));
  return {
    id: key, name, classKey: classKey ?? classKeyOf(spec.class), yours, owner: null, place, room, thing: null, door, user, password: null, flavor: yours ? "yours" : "default",
    desc: spec.desc ?? "A terminal.", files, mail, logs, programs, network: [],
    roomId, controls: ref ? controlsFor(place, ref) : [],
  };
}

// ---- Where computers are: things, doors and places -------------------------------------------

export const sameName = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
export const levelNamed = (place, id) => roomsOfPlace(place).find((room) => room.id === id) ?? null;
const roomOf = (place, levelId) => levelNamed(place, levelId)?.name ?? null;

// A written computer attached to a thing in a room, by the names in its file.
export function writtenAtThing(place, levelId, thing) {
  const room = roomOf(place, levelId);
  return Object.entries(WORLD_COMPUTERS).find(([, c]) => c.place === place && sameName(c.room, room) && sameName(c.thing, thing?.name))?.[0] ?? null;
}
export function writtenAtDoor(place, to) {
  return Object.entries(WORLD_COMPUTERS).find(([, c]) => c.place === place && c.door === to)?.[0] ?? null;
}

// What a thing in a room is, as a computer: a written one, a generic one, or nothing. A thing whose map file
// already says what using it does keeps that, so generic is false for those.
export function computerAtThing(game, place, levelId, thing, { generic = true } = {}) {
  if (!thing) return null;
  const written = thing.computer ?? writtenAtThing(place, levelId, thing);
  if (written && WORLD_COMPUTERS[written]) return { id: written };
  // The walk names a thing level:id and the map file just id; the same thing gets the same computer either way.
  const shortId = String(thing.id ?? "").split(":").pop();
  const runs = runsSystems(place, `${levelId}:${shortId}`);
  const kind = genericKindOf(thing) ?? (runs ? "console" : null);
  if (!kind || (!generic && !runs)) return null;
  const hack = typeof thing.check === "string" ? thing.check.split(":") : null;
  const classKey = hack?.[0] === "hacking" && hack[1] ? classKeyOf(hack[1]) : null;
  return { generic: genericContent(game, { key: `${place}:${levelId}:${shortId}`, name: thing.name, kind, place, room: roomOf(place, levelId), roomId: levelId, classKey, ref: { thing: `${levelId}:${shortId}` } }) };
}

// The computer a door answers to: a written one, or a generic panel for that door.
export function computerAtDoor(game, place, to, classKey = "easy") {
  const written = writtenAtDoor(place, to);
  if (written) return { id: written };
  const room = levelNamed(place, to)?.name ?? to;
  return { generic: genericContent(game, { key: `${place}:door:${to}`, name: `${room} door panel`, kind: "panel", place, room: roomOf(place, game.walk?.level), roomId: to, door: to, classKey, ref: { door: to } }) };
}

// A console the place's systems file puts in a room: it runs what the file says, at the class it gives.
export function consoleContent(game, place, part) {
  const name = part.name.charAt(0).toUpperCase() + part.name.slice(1);
  return { ...genericContent(game, { key: `${place}:part:${part.id}`, name, kind: "console", place, room: roomOf(place, part.room), roomId: part.room, classKey: classKeyOf(part.classKey ?? "moderate"), ref: { console: part.id } }), hardened: Boolean(part.hardened) };
}

// Using one of those consoles: straight in when it's the player's own, else its logon. No power, no screen.
// (A console the systems file stands is never sealed: only a computer with a file of its own is.)
export function useConsolePart(game, place, part) {
  if (!partWorks(game, place, part)) return { said: "Its screen is dark. There's no power to it." };
  const content = consoleContent(game, place, part);
  const session = openLogon(game, content, { at: `thing:part:${part.id}` });
  return { said: session.locked ? `${content.name} wants a logon.` : `You sit down at ${content.name}.`, computer: true };
}

// A locked door's panel, worked from the door itself: it opens at its logon (or straight in, when it's the player's),
// and from inside it runs that door. doorRule is a map file's door that opens once the player gets in.
export function openDoorPanel(game, place, to, { classKey = "easy", at = null, doorRule = null } = {}) {
  const target = computerAtDoor(game, place, to, classKey);
  const content = target.id ? writtenContent(target.id) : target.generic;
  if (sealedNow(game, content)) throw new Error(sealedWords(content));
  return openLogon(game, content, { at, doorRule });
}

// The computer a hack at this place lands on when nothing says which: a written one of that class here,
// or a generic one of the class. Never a hardened one (src/weak-points.js): a scene that wants one names it.
export function computerForPlace(game, classKey) {
  const place = game.location;
  const written = Object.entries(WORLD_COMPUTERS).find(([, c]) => c.place === place && classKeyOf(c.class) === classKey && !c.yours && !c.hardened && !c.sealed)?.[0];
  if (written) return { id: written };
  const kind = classKey === "easy" ? "panel" : classKey === "moderate" ? "console" : "server";
  return { generic: genericContent(game, { key: `${place}:${classKey}`, name: classNameOf(classKey), kind, place, room: roomOf(place, game.walk?.level), classKey }) };
}

// ---- Getting in -------------------------------------------------------------------------------

export const knowsPassword = (game, id) => Boolean(id && game.passwords?.[id]);

// at is what the player sat down at, as the room's marks name it, for the window's line to point at. locked is a
// session still at the computer's logon; practice is one that counts for nothing; story is the scene's check it's for
// ({ id, reason, source, difficulty }); doorRule is a map file's door that opens when the player gets in.
export function openSession(game, content, { hacked = false, locked = false, noise = 0, how = "sat down", at = null, practice: practising = false, story = null, doorRule = null, remote = false, from = null, fromName = null, trusted = null, rights = null, byHand = false }) {
  if (game.combat) throw new Error("Finish the fight first.");
  if (game.computer) throw new Error("Log off the computer you're on first.");
  game.computers ??= {};
  game.computers[content.id] ??= { read: [], ran: [], visits: 0 };
  game.computers[content.id].visits += 1;
  const yours = Boolean(content.yours);
  game.computer = {
    id: content.id,
    name: content.name,
    classKey: content.classKey,
    className: content.className ?? classNameOf(content.classKey),
    // What it looks like (src/devices.js): Keelworks, a door's panel, a junction box's menu, a camera's feed, NAVCOM 7.
    look: lookOf(content),
    user: content.user,
    place: content.place,
    yours,
    hacked: Boolean(hacked) && !yours && !locked,
    locked: Boolean(locked) && !yours,
    noise: yours ? 0 : Math.max(0, Number(noise) || 0),
    noticed: false,
    traceLeft: null,
    minutes: 0,
    practice: Boolean(practising),
    story,
    doorRule,
    how,
    generic: WORLD_COMPUTERS[content.id] ? null : content,
    screen: { kind: "home" },
    log: [],
    actions: 0,
    read: [],
    ran: [],
    startedAt: game.clock?.hours ?? 0,
    roomId: content.roomId ?? null,
    at,
    // Reached over the network from another system (src/network.js), not plugged into here.
    remote: Boolean(remote),
    // Keyed into by hand where it hangs, as a door's keypad is (src/devices.js): it's stepped away from, not unclipped.
    byHand: Boolean(byHand),
    // Whether the player's rig is plugged into this one: they connect it before they hack (devices.js, plugIn). A hack
    // that got in already went through it, and a practice computer has it plugged in from the start.
    plugged: Boolean(hacked) || Boolean(practising),
    rigMinutes: 0,
    // The node it was reached from over the network, and what a machine this one trusts lets it do (src/sealed.js):
    // trusted is what the trust gives, rights what the session may do (null for everything).
    from,
    fromName,
    trusted,
    rights,
  };
  const session = game.computer;
  if (!yours) session.noticed = session.noise >= watchFor(game, session.classKey).notices;
  const flavor = COMPUTER_FLAVOR?.motd?.[content.flavor] ?? COMPUTER_FLAVOR?.motd?.default ?? [];
  if (session.locked) {
    session.log.push(line(`${LOOKS[session.look].name}. ${content.name} wants ${session.look === "keelworks" || session.look === "navcom" ? "a user name and a password" : session.look === "door" ? "its code" : "a password"}.`, "info"));
    session.log.push(line(`${session.plugged || THROUGH_RIG.includes(session.look) ? "Run something from your rig" : "Connect your rig and run something from it"} to get past the logon, or ${(leaveOf(session) ?? "log off").toLowerCase()}. ${watcherOf(game, session).name === "AuditGuard" ? "The watcher" : watcherOf(game, session).name} hears everything from here on.`, "dim"));
    return session;
  }
  // In past the logon: the record knows, and the story can ask (src/story-rig.js).
  noteGotIn(game, session);
  const greeting = how === "trusted" ? `ACCESS GRANTED: it trusts ${inSentence(fromName ?? "where you came from")}.` : hacked && !yours ? "ACCESS GRANTED." : yours ? "Logged in." : "Logged in with the password.";
  session.log.push(line(`${content.name}: ${greeting} Welcome, ${content.user}.`, "good"));
  if (flavor.length) session.log.push(line(flavor[Math.floor(seeded(content.id)() * flavor.length)], "dim"));
  session.log.push(line(howOf(session), "dim"));
  if (how === "trusted") session.log.push(line(rights ? `From ${inSentence(fromName ?? "there")} it lets you ${rightsWords(rights)}, and nothing more.` : `From ${inSentence(fromName ?? "there")} it also lets you ${rightsWords(trusted)}.`, "dim"));
  // A password, or the player's own computer, gets them straight in: whatever asked for the hack has its answer now.
  if (story || doorRule) settleHack(game, session, true);
  return session;
}

// Opening a computer the player wants to get into: straight in when it's theirs or they know its password, else at
// its logon. A computer to practise on is never theirs.
export function openLogon(game, content, { at = null, practice: practising = false, story = null, doorRule = null, remote = false, noise = 0, from = null, fromName = null, byHand = false } = {}) {
  // A machine it trusts lets the player straight in, with what that trust allows (src/sealed.js); on a sealed computer
  // that's all, and on another the player's own right or password still gives everything. A sealed one takes nothing else.
  const trust = practising ? null : trustLine(content.place, content, from);
  const sealed = !practising && sealedNow(game, content);
  if (sealed && !trust) throw new Error(sealedWords(content));
  const own = !practising && (content.yours || knowsPassword(game, content.id));
  if (trust) return openSession(game, content, { how: "trusted", at, story, doorRule, remote, noise, from, fromName, trusted: trust.rights, rights: sealed || !own ? trust.rights : null, byHand });
  if (own) return openSession(game, content, { how: content.yours ? "sat down" : "the password", at, story, doorRule, remote, noise, from, byHand });
  return openSession(game, practising ? { ...content, yours: false } : content, { locked: true, how: "logon", at, practice: practising, story, doorRule, remote, noise, from, byHand });
}

// The player is past the logon: as whom, and how. What asked for the hack hears that it worked.
export function gotIn(game, session, { user = null, via = null } = {}) {
  session.locked = false;
  session.hacked = !session.yours;
  if (user) session.user = user;
  session.via = via;
  session.log.push(line(`ACCESS GRANTED. Welcome, ${session.user}.`, "good"));
  session.log.push(line(howOf(session), "dim"));
  noteGotIn(game, session, { hacked: !session.yours });
  settleHack(game, session, true);
}

// How a hack went, once: the skill learns from a hack that was tried (not in practice), a pass counts for anything
// someone's asked the player to pass, a scene that asked for it reads the result, and a map file's door opens or stays
// shut. how says why it failed: traced, cut (off), or left.
export function settleHack(game, session, success, how = "left") {
  if (session.settled) return;
  session.settled = true;
  if (session.practice) return;
  const notes = [];
  if (!session.yours && (session.via || !success)) notes.push(...practice(game, "hacking", (success ? 3 : 2) * (DIFFICULTY_LEARNING[session.classKey] ?? 1)));
  if (success) {
    notePut(game, "check:hacking", "any", 1);
    if (session.at) notePut(game, "check:hacking", `at:${session.at}`, 1);
  }
  const label = success ? "ACCESS GRANTED" : { traced: "TRACED", cut: "CUT OFF" }[how] ?? "NOT IN";
  if (session.story) {
    const asked = session.story;
    game.lastCheck = { id: asked.id, skill: "hacking", difficulty: asked.difficulty ?? session.classKey, success, reason: asked.reason, source: asked.source, used: false };
    game.transcript?.push({ role: "notice", text: [`[HACK] ${asked.reason}: ${label}`, ...notes].join("\n") });
  } else if (notes.length) game.transcript?.push({ role: "notice", text: notes.join("\n") });
  const rule = session.doorRule;
  if (rule) {
    if (success) {
      game.opened ??= {};
      game.opened[rule.place] ??= [];
      if (!game.opened[rule.place].includes(rule.to)) game.opened[rule.place].push(rule.to);
      if (rule.flag) recordFact(game, { id: rule.flag });
    }
    game.transcript?.push({ role: "notice", text: `[DOOR] ${success ? rule.pass : rule.fail}` });
  }
}

// The player sits down at a computer by its id: theirs, or one they know the password to, or any, when a scene says so.
export function enterComputer(game, { id = null, generic = null, hacked = false, locked = false, noise = 0, how = "sat down" } = {}) {
  const content = id ? writtenContent(id) : generic;
  if (!content) throw new Error(`There's no computer called ${id}.`);
  return openSession(game, content, { hacked, locked, noise, how });
}

// Using a thing that's a computer: straight in when it's theirs or the password's known, else its logon.
export function useComputer(game, { place, levelId, thing, generic = true }) {
  const target = computerAtThing(game, place, levelId, thing, { generic });
  if (!target) return null;
  const content = target.id ? writtenContent(target.id) : target.generic;
  if (!roomPowered(game, place, levelId)) return { said: "The screen's dead. There's no power in here." };
  // A sealed one takes nothing here: it answers only to the machines it trusts, over the network.
  if (sealedNow(game, content)) return { said: sealedWords(content) };
  const session = openLogon(game, content, { at: `thing:${thing.id}` });
  return { said: session.locked ? `${content.name} wants a logon.` : `You sit down at ${content.name}.`, computer: true };
}

// A computer to practise on: a made-up one of that class here, with nothing on it that runs anything or reaches
// anywhere, so nothing done on it reaches the game.
function practiceContent(game, classKey) {
  const kind = classKey === "easy" ? "panel" : classKey === "moderate" ? "console" : "server";
  const content = genericContent(game, { key: `practice:${classKey}`, name: `A ${classNameOf(classKey).toLowerCase()} to practise on`, kind, place: game.location, room: roomOf(game.location, game.walk?.level), classKey });
  const users = COMPUTER_FLAVOR?.users?.length ? COMPUTER_FLAVOR.users : ["admin"];
  return { ...content, yours: false, user: users[classKeys().indexOf(classKey) % users.length], controls: [], network: [] };
}

// A check that asks for hacking (a scene's, a practice button's) opens a computer's logon instead of a window: the
// computer it names, or this place's of that class, or one to practise on. Returns the session.
function hackFromCheck(game, { difficulty, reason, source, computer = null, target = null }) {
  const classKey = classKeyOf(difficulty);
  if (source === "practice") return openLogon(game, practiceContent(game, classKey), { practice: true });
  const found = computer && WORLD_COMPUTERS[computer] ? { id: computer } : computerForPlace(game, classKey);
  const content = found.id ? writtenContent(found.id) : found.generic;
  const story = source === "choice" || source === "tool" ? { id: Date.now(), reason: reason || `Get into ${content.name}`, source, difficulty: classKey } : null;
  return openLogon(game, content, { at: target, story });
}
setHackHandler(hackFromCheck);

// Whether plugging a rig in here can be seen as tampering: not at the player's own computers, nor anywhere aboard
// their own ship, where even a private terminal is the captain's to touch (src/devices.js, plugIn).
export const plugSeen = (game, session) => !session.yours && !session.practice && !ownedBy(game, session.place);

// ---- What a session is looking at --------------------------------------------------------------

// What's on it, with the letters, files and logs it holds of other computers' weak points (src/weak-points.js), as a
// session let in by a machine it trusts may see it (src/sealed.js).
export const contentOf = (game, session) => withRights(withWeakPoints(session.generic ? session.generic : writtenContent(session.id)), session);
export const memoryOf = (game, session) => {
  game.computers ??= {};
  game.computers[session.id] ??= { read: [], ran: [], visits: 1 };
  return game.computers[session.id];
};

export const programOffered = (game, program) => !program.condition || conditionHolds(game, program.condition);


// ---- What the browser sees ---------------------------------------------------------------------

// What reading something for the first time costs: nothing, except on a Ministry or Navy server or worse.
export const readNoise = (session) => (classKeys().indexOf(session.classKey) >= classKeys().indexOf("very_hard") ? 1 : 0);

// The noise left before the watcher's next step, and what that step is.
function nextStep(session, watch) {
  if (session.noise < watch.notices && !session.noticed) return { left: watch.notices - session.noise, next: "notices you" };
  if (session.traceLeft === null && session.noise < watch.traces) return { left: watch.traces - session.noise, next: "starts a trace" };
  return { left: Math.max(0, watch.cuts - session.noise), next: "cuts you off" };
}

// What a way in would do to the watcher: the noise after it, and the step that brings.
function afterWay(session, watch, noise) {
  const heard = noise > 0 && session.noticed ? noise + 1 : noise;
  const after = session.noise + heard;
  const words = after >= watch.cuts ? "it cuts you off" : after >= watch.traces ? "it starts a trace" : after >= watch.notices && !session.noticed ? "it notices you" : session.noticed ? "it's watching already" : "it stays calm";
  return { after, words };
}

// The advisor at a logon: each way in off the rig and what it costs, saying more the more training the player has.
function logonHints(game, session, content, ways, watch) {
  const tier = tierFor(game, "hacking");
  const lines = [];
  // Before the rig's connected, that comes first; the ways in are weighed as they would be once it's plugged in.
  if (!session.plugged && !session.remote) {
    const why = reachWhy(game, content);
    lines.push(why ? `Your rig can't connect to it: ${why}.` : `Connect your rig first: it takes a minute${plugSeen(game, session) ? ", and anyone in the room can see you plug in" : ""}.`);
  }
  // A hardened one: what's known of its way in, and where to look for the rest.
  lines.push(...hardenedHints(game, content, tier));
  const whyOf = (way) => ("whyIn" in way ? way.whyIn : way.why);
  const working = ways.filter((way) => !whyOf(way) && way.kind === "in");
  if (!working.length) lines.push(`Nothing on your rig gets into ${contentHardened(content) ? "it" : `a ${String(session.className).toLowerCase()}`} as things stand.`);
  for (const way of ways) {
    if (whyOf(way)) {
      lines.push(`${way.name} won't: ${whyOf(way)}.`);
      continue;
    }
    const cost = tier >= 1 ? `, ${way.noise} noise and ${way.minutes} ${way.minutes === 1 ? "minute" : "minutes"}` : way.noise >= 3 ? ", and it's loud" : way.noise ? "" : ", and it's quiet";
    const then = tier >= 3 ? `: after it ${afterWay(session, watch, way.noise).words}` : "";
    lines.push(`${way.name} ${way.kind === "in" ? "gets you in" : "runs here"}${cost}${then}.`);
  }
  lines.push("The watcher hears everything from the first try. A found password gets you straight in, with nothing to hear.");
  if (tier >= 2) lines.push(`${watch.name} notices you at ${watch.notices} noise, starts a trace at ${watch.traces} that finds you in ${watch.finds} minutes, and cuts you off at ${watch.cuts}. You're at ${session.noise}.`);
  if (tier >= 4 && working.length) lines.push(`The quietest way in you have is ${[...working].sort((a, b) => a.noise - b.noise || a.minutes - b.minutes)[0].name}.`);
  if (!working.length && tier >= 1 && !contentHardened(content)) lines.push("KNOCK gets into door panels; DICTIONARY into anything up to a crew terminal; SKELETON into a ship's main system, once Scope has read the logon; MIMIC with a lifted keycard in your pockets.");
  return lines;
}

function hintsFor(game, session, content, view) {
  if (session.locked) return logonHints(game, session, content, view.logon?.ways ?? [], view.watch);
  const texts = COMPUTER_FLAVOR?.hints ?? {};
  const tier = tierFor(game, "hacking");
  const unread = view.files.filter((one) => !one.read).length;
  const unreadMail = view.mail.filter((one) => !one.read).length;
  const watch = view.watch;
  const step = watch ? nextStep(session, watch) : { left: 0, next: "" };
  const values = {
    unread,
    unreadMail,
    programs: view.programs.length ? view.programs.map((one) => `${one.name}${one.ran ? " (done)" : ""}`).join(", ") : "none",
    read: readNoise(session),
    noise: session.noise ?? 0,
    notices: watch?.notices ?? 0,
    traces: watch?.traces ?? 0,
    cuts: watch?.cuts ?? 0,
    finds: watch?.finds ?? 0,
    left: step.left,
    next: step.next,
    network: view.network.length ? view.network.map((one) => `${one.name} (${one.className.toLowerCase()})`).join(", ") : "nothing reachable from here",
  };
  const lines = [];
  for (let level = 0; level <= tier; level += 1) {
    for (const text of texts[level] ?? texts[String(level)] ?? []) {
      // Nobody watches the player's own computers.
      if (!watch && /noise|watcher|AuditGuard|trace/i.test(text)) continue;
      lines.push(fill(text, values));
    }
  }
  return lines;
}

export function computerView(game) {
  const session = game.computer;
  if (!session) return null;
  const content = contentOf(game, session);
  if (!content) return null;
  const memory = memoryOf(game, session);
  // Nothing on a computer reaches the page before the player is past its logon.
  const inside = !session.locked;
  const watch = session.yours ? null : watcherOf(game, session);
  const rig = rigInComputer(game, session, content);
  const view = {
    id: session.id,
    name: session.name,
    className: session.className,
    classKey: session.classKey,
    user: session.locked ? null : session.user,
    prompt: session.locked ? "logon:" : `${session.user}@${slug(session.name) || "node"}:~$`,
    yours: session.yours,
    hacked: session.hacked,
    locked: Boolean(session.locked),
    practice: Boolean(session.practice),
    // The watcher, AuditGuard: how much noise the player has made, its numbers for this computer, and where it stands.
    watch: watch ? { name: watch.name, stage: watchStage(session), noise: session.noise ?? 0, notices: watch.notices, traces: watch.traces, cuts: watch.cuts, finds: watch.finds, traceLeft: session.traceLeft ?? null } : null,
    theme: session.yours ? "green" : session.hacked ? "cyan" : "teal",
    at: session.at ?? null,
    desc: content.desc,
    files: inside ? content.files.map((one) => ({ id: one.id, name: one.name, read: memory.read.includes(`file:${one.id}`) })) : [],
    mail: inside ? content.mail.map((one) => ({ id: one.id, name: one.to ? `From ${one.from} to ${one.to}` : one.subject ?? one.from, read: memory.read.includes(`mail:${one.id}`) })) : [],
    logs: inside ? content.logs.map((one) => ({ id: one.id, name: one.name })) : [],
    programs: inside ? content.programs.filter((one) => programOffered(game, one)).map((one) => ({ id: one.id, name: one.name, about: one.text, ran: memory.ran.includes(one.id) })) : [],
    network: inside ? content.network.filter((one) => WORLD_COMPUTERS[one.id]).map((one) => ({ id: one.id, name: WORLD_COMPUTERS[one.id].name, about: one.desc, className: classNameOf(classKeyOf(WORLD_COMPUTERS[one.id].class)), known: Boolean(WORLD_COMPUTERS[one.id].yours) || knowsPassword(game, one.id) })) : [],
    screen: session.screen?.kind === "register" ? { ...session.screen, table: registerTable(game) } : session.screen,
    log: session.log,
    actions: session.actions,
    minutes: session.minutes ?? 0,
    tier: tierFor(game, "hacking"),
    tierName: (CHECK_TEXT.tierNames ?? ["untrained", "novice", "trained", "expert", "master"])[tierFor(game, "hacking")],
    // The place's systems this computer runs, each with what can be done about it from here.
    systems: inside ? controlsView(game, session.place, content.controls ?? [], { room: session.roomId }) : [],
    // The player's rig: what's loaded on it to run here, and what this computer has to copy onto it.
    rig: inside ? rig : rig && { ...rig, copies: [] },
    // How hot the rig is: nothing's plugged into the player's own computers.
    rigHeat: session.yours || !(session.plugged || session.remote) ? null : rigHeat(game, session),
    // At the logon: the ways in off the rig, each with why it won't work, if it won't.
    logon: session.locked ? { ways: rig?.ways ?? [], keycard: Boolean(game.inventory?.keycard) } : null,
    // Its look, what reaches it and whether the rig does, and what the look shows and offers (src/devices.js).
    look: session.look ?? lookOf(content),
    // Whether it's connected (plugged in here, or reached over the network), and whether the rig's link fits it at all.
    reach: { link: reachOf(content), words: LINK_WORDS[reachOf(content)], fits: rigReaches(game, content), why: reachWhy(game, content), plugged: Boolean(session.plugged), remote: Boolean(session.remote), ok: Boolean(session.plugged || session.remote), seen: plugSeen(game, session) },
    // Beside every computer the player's rig shows the map, the programs and the log: its board and casing.
    rigFace: rigFace(game),
    device: deviceView(game, session, content),
    // The place's network as a map, once past the logon (src/network.js).
    netmap: inside ? networkView(game, session) : null,
    // Hardened: no breaker works on it from the front (src/weak-points.js). weak is what's known of its way in.
    hardened: contentHardened(content),
    weak: contentHardened(content) ? weakWords(game, session.id) : [],
    // Reached through a machine it trusts, and what that lets the player do here (src/sealed.js).
    through: session.trusted ? { name: inSentence(session.fromName ?? "another machine"), words: rightsWords(session.trusted), sealed: Boolean(content.sealed) } : null,
  };
  view.hints = hintsFor(game, session, content, view);
  return view;
}

// Every fact a written computer's programs can leave, for the checker: a scene can wait on what was done at a computer.
export function computerFacts() {
  const names = new Set();
  for (const c of Object.values(WORLD_COMPUTERS)) for (const program of (c.programs ?? []).map(programOf)) for (const step of program.effects) if (step.set) names.add(step.set);
  return names;
}

// ---- Checking the files -----------------------------------------------------------------------

export function computerProblems() {
  const problems = [];
  for (const [id, c] of Object.entries(WORLD_COMPUTERS)) {
    const at = (message) => problems.push(`computers/${id}.txt: ${message}`);
    if (c.class && !classKeys().includes(String(c.class).trim().toLowerCase().replace(/\s+/g, "_"))) at(`the class "${c.class}" isn't one of ${classKeys().join(", ")}`);
    if (c.look && !LOOKS[String(c.look).trim().toLowerCase()]) at(`the look "${c.look}" isn't one of ${Object.keys(LOOKS).join(", ")}`);
    if (c.reach && !LINK_WORDS[String(c.reach).trim().toLowerCase()]) at(`"reached by" is one of ${Object.keys(LINK_WORDS).join(", ")}, not "${c.reach}"`);
    if (c.place && !LOCATIONS[c.place] && !WORLD_MAPS[c.place]) at(`there's no place with the id ${c.place}`);
    const levels = c.place ? roomsOfPlace(c.place) : [];
    const level = c.room ? levels.find((one) => sameName(one.name, c.room)) : null;
    if (c.room && c.place && WORLD_MAPS[c.place] && !level) at(`${LOCATIONS[c.place]?.name ?? c.place} has no room called ${c.room}`);
    if (c.thing && !c.room) at("a thing needs its room: add a room line");
    // A thing that isn't drawn in its room is stood there by the game (src/terminals.js).
    if (c.door && c.place && WORLD_MAPS[c.place] && !levels.some((one) => one.id === c.door)) at(`${c.place} has no room with the id ${c.door} for the door to lead to`);
    for (const program of (c.programs ?? []).map(programOf)) for (const message of program.problems) at(message);
    for (const entry of c.network ?? []) if (!WORLD_COMPUTERS[String(entry.name).trim()]) at(`the network names ${String(entry.name).trim()}, and there's no computer with that id`);
  }
  return problems;
}
