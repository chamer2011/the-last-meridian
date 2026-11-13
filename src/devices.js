// The computers that aren't desks (step 6 of the hacking rework): a door's panel, a junction box's service menu, a
// camera's feed, and NAVCOM 7, the ship's main system on the bridge. Each is a session like any computer's (its logon,
// its watcher, the rig plugged in) in a look of its own, with its own things to do through the place's systems: a door
// given a new code stays locked, a room whose feed is cut goes dark, a looped camera doesn't see who passes, and a line
// struck from the ship's log is gone. And which of them a rig reaches at all: each takes one kind of link (a cable, a
// service clip, an optical reader, a short radio or a Navy coupler), and the link fitted in the rig decides. A computer
// with its own keyboard and screen can be used by right or with a password without the rig; a junction box and a camera
// have neither, so they're reached only through the rig. A short radio reaches a camera in the next room too.
//
// It registers itself with src/room-hooks.js for a part's window and the room's You can; src/computers.js and
// src/computer-use.js ask it what a session looks like and what its own buttons do.
import { addOrder, addPartActs, addRoomActs } from "./room-hooks.js";
import { rigPartById, rigStats } from "./rig-parts.js";
import { MAX_LOG, line, openLogon, knowsPassword } from "./computers.js";
import { cameraFrozen, cameraLooped, cutFeed, doorLocked, endLoop, feedCut, feedsOf, loopCamera, ownedBy, partWorks, playerSpot, setDoor, switchPart, systemsOf } from "./systems.js";
import { commandOf, holderKey, loyaltyOf, postAndName, rememberRequest, YOU } from "./command.js";
import { whoSees } from "./law.js";
import { seenTampering } from "./systems.js";
import { peopleAboard } from "./life.js";
import { mapFor } from "./walk.js";

// The looks with no screen of their own: a door's panel, a junction box's service menu, a camera's feed. Beside them the
// player's rig shows the map and the programs.
export const PANEL_LOOKS = ["door", "service", "camera"];
export const LOOKS = {
  keelworks: { reach: "cable", watcher: null, name: "Keelworks 4.1", how: "Open a folder on the desktop to read or run what's in it. Log off from the Keel menu, or with Esc." },
  door: { reach: "optic", watcher: "DoorCtl", name: "DoorCtl 2.1", leave: "Unclip", how: "Open or lock the door from its panel, or give it a new code. Unclip to leave, or press Esc." },
  service: { reach: "clip", watcher: "The fault board", name: "Halden Yards service menu", leave: "Exit", how: "Pick a line of the menu. 0 EXIT unclips, and so does Esc." },
  camera: { reach: "radio", watcher: "The security desk", name: "A camera's feed", leave: "Switch off the radio", how: "Loop it, blind it, or put it back to live. Switch off the radio to leave, or press Esc." },
  navcom: { reach: "navy", watcher: "SENTRY", name: "NAVCOM 7", leave: "Log off", how: "Pick a program on the desktop. Log off from the NAVCOM menu, or with Esc." },
};
export const LINK_WORDS = { cable: "a cable jack", clip: "a service clip", optic: "an optical reader", radio: "a short radio", navy: "a Navy coupler" };
// What a camera loop shows, and for how long.
export const LOOP_MINUTES = 10;
// My numbers: a feed switched at a junction box shows on the chief engineer's fault board; a camera looped with someone
// in its picture, or blinded, is seen by whoever watches it at once; striking a line from the ship's log is heard.
const NOISE = { door: 1, recode: 1, feed: 2, clear: 2, loopSeen: 3, blind: 3, strike: 2 };

const SHIP = "meridian";
const plainRoom = (place, room) => mapFor(place)?.rooms?.[room]?.name ?? room;
const inSentence = (name) => String(name ?? "").replace(/^The /, "the ");
const lowerFirst = (text) => (text ? text[0].toLowerCase() + text.slice(1) : "");
const listed = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

// ---- Looks and reach --------------------------------------------------------------------------------------------

export const lookOf = (content) => (LOOKS[content?.look] ? content.look : content?.door ? "door" : "keelworks");
// A computer's file can say what reaches it ("reached by: radio"); otherwise its look decides.
export const reachOf = (content) => (content?.reach && LINK_WORDS[content.reach] ? content.reach : LOOKS[lookOf(content)].reach);

// The kinds of link fitted in the rig that work, if the rig starts at all.
export function rigLinks(game) {
  const rig = game.rig;
  if (!rig?.build) return [];
  const stats = rigStats(rig, game.skills?.hacking ?? 0);
  if (stats.dead) return [];
  const byUid = Object.fromEntries(rig.parts.map((item) => [item.uid, item]));
  return [...new Set(stats.sockets.filter((s) => s.kind === "link" && s.works && s.uid).map((s) => rigPartById(byUid[s.uid]?.id)?.reaches).filter(Boolean))];
}
export const rigReaches = (game, content) => rigLinks(game).includes(reachOf(content));
// Why the rig can't reach a computer, in words, or null.
export const reachWhy = (game, content) => (rigReaches(game, content) ? null : `it takes ${LINK_WORDS[reachOf(content)]}, and your rig ${rigLinks(game).length ? `has ${rigLinks(game).map((one) => LINK_WORDS[one]).join(" and ")}` : "has no link that works"}`);

// ---- What they are ------------------------------------------------------------------------------------------------

// A part's short code, the way its makers stencilled it: JB-2 for the second junction box, CAM D2-01 for the first
// camera on deck 2.
export function codeOf(place, part) {
  const model = systemsOf(place);
  const same = Object.values(model?.parts ?? {}).filter((one) => one.kind === part.kind);
  const n = same.findIndex((one) => one.id === part.id) + 1;
  if (part.kind === "junction box") return `JB-${n}`;
  if (part.kind === "relay") return `RELAY ${n}`;
  const deck = /(\d+)$/.exec(mapFor(place)?.rooms?.[part.room]?.level?.id ?? "")?.[1];
  return `CAM ${deck ? `D${deck}-` : ""}${String(n).padStart(2, "0")}`;
}

function deviceContent(game, place, part, look) {
  const service = look === "service";
  const code = codeOf(place, part);
  const room = plainRoom(place, part.room);
  return {
    id: `${place}:${look}:${part.id}`,
    name: part.kind === "relay" ? "The comms relay" : service ? `Junction box ${code}` : `Camera ${code.replace(/^CAM /, "")}`,
    className: part.kind === "relay" ? "Comms relay" : service ? "Junction box" : "Camera",
    classKey: "easy",
    yours: ownedBy(game, place),
    owner: null,
    place,
    room,
    thing: null,
    door: null,
    user: service ? "service" : "monitor",
    password: null,
    flavor: "default",
    desc: service ? `The service menu of the junction box in ${inSentence(room)}, on your rig's little screen.` : `What the camera in ${inSentence(room)} sees, on your rig's little screen.`,
    files: [], mail: [], logs: [], programs: [], network: [],
    roomId: part.room,
    controls: [],
    look,
    part: part.id,
    code,
  };
}
export const serviceContent = (game, place, part) => deviceContent(game, place, part, "service");
export const cameraContent = (game, place, part) => deviceContent(game, place, part, "camera");

// The rooms next to a room, through a door in its walls.
const besideRoom = (place, room) => [...new Set((mapFor(place)?.rooms?.[room]?.area?.doors ?? []).map((door) => door.to).filter(Boolean))];

// Why a junction box's menu or a camera's feed can't be opened now, or null.
function deviceWhy(game, place, part, look) {
  if (!game.rig) return "you have no rig";
  if (game.computer || game.combat || game.check || game.talk) return "not now";
  if (look === "service" && game.systems?.[place]?.parts?.[part.id]?.damage) return "it's broken";
  if (look === "camera" && !partWorks(game, place, part)) return "it's off";
  const content = deviceContent(game, place, part, look);
  return rigReaches(game, content) ? null : `needs ${LINK_WORDS[reachOf(content)]} in your rig`;
}

addPartActs((game, place, part) => {
  const look = part.kind === "junction box" ? "service" : part.kind === "camera" ? "camera" : null;
  if (!look) return null;
  const why = deviceWhy(game, place, part, look);
  const label = look === "service" ? "Open its service menu" : "Tap its feed";
  return { does: [{ id: `device-${look}`, label, detail: why ?? (look === "service" ? "with your rig's service clip" : "with your rig's short radio"), ...(why ? { disabled: true } : {}) }] };
});

// A short radio reaches a camera in a room beside the one the player's in, out of its sight.
addRoomActs((game, { place, room }) => {
  if (!rigLinks(game).includes("radio")) return null;
  const model = systemsOf(place);
  if (!model || !room) return null;
  const near = besideRoom(place, room);
  const cameras = Object.values(model.parts).filter((part) => part.kind === "camera" && !part.unplaced && near.includes(part.room));
  if (!cameras.length) return null;
  return cameras.map((part) => {
    const why = deviceWhy(game, place, part, "camera");
    return { id: "device-camera", key: `part:${part.id}`, label: `Tap the camera in ${inSentence(plainRoom(place, part.room))} by radio`, detail: why ?? "from here, out of its sight", ...(why ? { disabled: true } : {}) };
  });
});

function openDevice(game, body, look) {
  const spot = playerSpot(game);
  if (!spot) throw new Error("There's nothing like that here.");
  const { place, room } = spot;
  const part = systemsOf(place)?.parts[String(body.key ?? "").replace(/^part:/, "")];
  const reachable = part && (part.room === room || (look === "camera" && besideRoom(place, room).includes(part.room) && rigLinks(game).includes("radio")));
  if (!reachable || part.kind !== (look === "service" ? "junction box" : "camera")) throw new Error("That isn't here.");
  const why = deviceWhy(game, place, part, look);
  if (why) throw new Error(`You can't: ${why}.`);
  // Plugging into someone else's box or camera in front of people is seen, like any tampering (step 7).
  const seen = !ownedBy(game, place) && part.room === room ? whoSees(game, place, room) : null;
  const notes = seen ? seenTampering(game, place, seen.camera ? "a camera" : seen.name) : [];
  const content = deviceContent(game, place, part, look);
  const session = openLogon(game, content, { at: part.room === room ? `thing:part:${part.id}` : null });
  const what = look === "service" ? `You clip onto ${content.name}'s service port` : `Your radio finds the feed of ${lowerFirst(content.name)} in ${inSentence(content.room)}`;
  return { said: [`${what}${session.locked ? ": it wants a password." : "."}`, ...notes].join("\n"), computer: true };
}
addOrder("device-service", (game, body) => openDevice(game, body, "service"));
addOrder("device-camera", (game, body) => openDevice(game, body, "camera"));

// ---- Who a camera sees --------------------------------------------------------------------------------------------

// Everyone in a room now, by the names the room's view gives them, and the player if they're there.
export function peopleInRoom(game, place, room) {
  const map = mapFor(place);
  const level = map?.rooms?.[room]?.level ?? map?.levels?.[room] ?? null;
  if (!level) return [];
  const inIt = (x, y) => (level.roomAt ? level.roomAt(x, y) === room : true);
  const seen = peopleAboard(game, place, level.id).filter((one) => inIt(one.x, one.y)).map((one) => `${one.label ?? one.name ?? "someone"}${one.asleep ? ", asleep" : ""}`);
  const walk = game.walk;
  if (game.location === place && walk && !walk.room && walk.level === level.id && inIt(walk.x, walk.y)) seen.unshift("you");
  return seen;
}

// ---- What each look shows -----------------------------------------------------------------------------------------

const clockOf = (game) => {
  const hours = game.clock?.hours ?? 0;
  const minute = Math.floor((((hours % 24) + 24) % 24) * 60);
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
};

function doorView(game, session, content) {
  const place = session.place;
  const room = content.door;
  const runs = Boolean(systemsOf(place)?.doors?.[room]);
  const s = game.systems?.[place]?.doors?.[room] ?? {};
  const locked = runs ? doorLocked(game, place, room) : !(game.opened?.[place] ?? []).includes(room);
  const label = String(plainRoom(place, room)).replace(/^The /, "").toUpperCase().slice(0, 12);
  const lcd = session.locked ? (session.scanned ? ["DOORCTL 2.1", "ADMIN LOCK"] : [label, locked ? "LOCKED" : "ENTER CODE"]) : s.recoded ? [label, "NEW CODE"] : [label, locked ? "LOCKED" : "OPEN"];
  const actions = session.locked ? [] : [
    runs && (locked ? { id: "door-unlock", label: "Open the door" } : { id: "door-lock", label: "Lock the door" }),
    runs && { id: "door-recode", label: "Give the door a new code", why: s.recoded ? "it has your code already" : null, about: "Locked with a code only you have: nobody here can open it until you do." },
  ].filter(Boolean);
  return { kind: "door", lcd, open: !locked, recoded: Boolean(s.recoded), room: plainRoom(place, room), actions };
}

function serviceView(game, session, content) {
  const place = session.place;
  const device = session.device ?? {};
  const feeds = feedsOf(place, content.part).map((room) => ({ room, name: plainRoom(place, room), on: !feedCut(game, place, room) }));
  const cleaner = (game.rig?.loaded ?? []).includes("cleaner") || knowsPassword(game, content.id);
  return { kind: "service", code: content.code, screen: device.screen ?? "menu", feeds, faults: device.faults ?? 0, lines: device.lines ?? [], cleared: Boolean(device.cleared), canClear: cleaner };
}

function cameraView(game, session, content) {
  const place = session.place;
  const part = systemsOf(place)?.parts?.[content.part];
  if (!part) return { kind: "camera", code: content.code, room: content.room, mode: "blind", people: [], loopLeft: 0, time: clockOf(game), actions: [] };
  const works = partWorks(game, place, part);
  const looped = works && cameraLooped(game, place, part.id);
  const mode = !works ? "blind" : looped ? "loop" : "live";
  const people = mode === "blind" ? [] : looped ? cameraFrozen(game, place, part.id) : peopleInRoom(game, place, part.room);
  const loopLeft = looped ? Math.max(1, Math.ceil((game.systems[place].parts[part.id].loopUntil - (game.clock?.hours ?? 0)) * 60)) : 0;
  const actions = session.locked ? [] : [
    { id: "cam-loop", label: "Loop the last minute", why: !works ? "it's off" : looped ? "it's looping already" : null, about: `For ${LOOP_MINUTES} minutes the camera shows what it saw a minute ago, over and over.` },
    { id: "cam-blind", label: "Blind it", why: !works ? "it's off" : null, about: "The picture goes to snow, and whoever watches it sees that at once." },
    { id: "cam-live", label: "Back to live", why: mode === "live" ? "it's live" : null },
  ];
  return { kind: "camera", code: content.code, room: content.room, mode, people, loopLeft, time: clockOf(game), actions };
}

// The first officer's view of the officers: their loyalty to whoever's in the chair, in a few words.
const ASSESS = [[70, "steady, loyal to the chair"], [55, "does the work, keeps their own counsel"], [40, "unhappy; worth watching"], [0, "angry, and could go either way; watch closely"]];
function assessments(game) {
  const model = commandOf(SHIP);
  if (!model) return { by: null, list: [] };
  const writer = holderKey(game, SHIP, "first_officer");
  const list = model.posts.filter((post) => post.chooser.post && post.id !== model.chairPost).map((post) => {
    const key = holderKey(game, SHIP, post.id);
    if (!key || key === YOU || key === writer) return null;
    const loyalty = loyaltyOf(game, SHIP, key);
    return { post: post.title, name: postAndName(game, SHIP, post.id), loyalty, words: ASSESS.find(([at]) => loyalty >= at)[1] };
  }).filter(Boolean);
  return { by: writer ? postAndName(game, SHIP, "first_officer") : null, list };
}

function navcomView(game, session) {
  if (session.locked || session.place !== SHIP || !game.ship) return { kind: "navcom", shipLog: [], crew: null, purse: null };
  const log = game.ship.log ?? [];
  return {
    kind: "navcom",
    shipLog: log.map((entry, i) => ({ i, day: entry.day, tag: entry.tag ?? null, text: entry.text })).slice(-12).reverse(),
    crew: assessments(game),
    purse: game.ship.purse ?? null,
    struck: game.rig?.struck ?? 0,
  };
}

export function deviceView(game, session, content) {
  const look = session.look ?? lookOf(content);
  if (look === "keelworks") return null;
  const view = look === "door" ? doorView(game, session, content) : look === "service" ? serviceView(game, session, content) : look === "camera" ? cameraView(game, session, content) : navcomView(game, session);
  return { ...view, leave: LOOKS[look].leave };
}

// ---- What their own buttons do ------------------------------------------------------------------------------------

const say = (session, text, tone = "good") => {
  session.log.push(line(text, tone));
  if (session.log.length > MAX_LOG) session.log.splice(0, session.log.length - MAX_LOG);
};
const byOf = (session) => (session.yours ? "owner" : "player");

// helpers: { act(game, session, { noise, minutes }), finish(game, session, notes) }. Returns { over } like any order.
export function deviceCommand(game, session, content, id, { act, finish }) {
  const look = session.look ?? lookOf(content);
  const place = session.place;
  const notice = (lines) => {
    const said = lines.filter(Boolean);
    if (said.length) game.transcript?.push({ role: "notice", text: said.join("\n") });
  };
  if (look === "door") {
    const room = content.door;
    if (!systemsOf(place)?.doors?.[room]) throw new Error("This panel runs no door the place's systems know.");
    const recoded = Boolean(game.systems?.[place]?.doors?.[room]?.recoded);
    if (id === "door-unlock" || id === "door-lock") {
      const lines = setDoor(game, place, room, id === "door-unlock" ? "unlocked" : "locked", { by: byOf(session) });
      say(session, id === "door-unlock" ? `The door to ${inSentence(plainRoom(place, room))} opens.` : `The door to ${inSentence(plainRoom(place, room))} locks.`);
      notice(lines);
      return act(game, session, { noise: NOISE.door }) ?? { over: false };
    }
    if (id === "door-recode") {
      if (recoded) throw new Error("It has your code already.");
      const lines = setDoor(game, place, room, "locked", { by: byOf(session), recode: true });
      game.passwords ??= {};
      game.passwords[content.id] = true;
      say(session, `You give the door a new code. Nobody else can open it now, guards or anyone, until you do.`);
      notice(lines);
      return act(game, session, { noise: NOISE.recode }) ?? { over: false };
    }
  }
  if (look === "service") {
    session.device ??= { screen: "menu", faults: 0, lines: [] };
    const [verb, arg] = id.split(":");
    if (["svc-menu", "svc-status", "svc-breakers", "svc-log"].includes(verb)) {
      session.device.screen = verb.slice(4);
      return { over: false };
    }
    if (verb === "svc-toggle") {
      const room = String(arg ?? "");
      if (!feedsOf(place, content.part).includes(room)) throw new Error("This box doesn't feed that room.");
      const cut = !feedCut(game, place, room);
      const lines = cutFeed(game, place, room, cut, { by: byOf(session) });
      session.device.faults += 1;
      session.device.lines.push(`SVC  ${String(plainRoom(place, room)).replace(/^The /, "").toUpperCase()} FEED ${cut ? "OFF" : "ON"}`);
      const name = plainRoom(place, room);
      say(session, cut ? `${name} goes dark.` : `${name} has power again.`, cut ? "warn" : "good");
      notice([cut ? `[SYSTEMS] The power's off in ${inSentence(name)}.` : `[SYSTEMS] The power's back on in ${inSentence(name)}.`, ...lines]);
      return act(game, session, { noise: NOISE.feed, minutes: 1 }) ?? { over: false };
    }
    if (verb === "svc-clear") {
      if (session.device.cleared) throw new Error("It's clear already.");
      if (!(game.rig?.loaded ?? []).includes("cleaner") && !knowsPassword(game, content.id)) throw new Error("Clearing the box's log needs the service password, or CLEANER.EXE loaded on your rig.");
      session.device.lines = ["SVC  LOG CLEARED"];
      session.device.cleared = true;
      if (!session.yours) session.noise = Math.max(0, (session.noise ?? 0) - NOISE.clear);
      say(session, "The box's own log is cleared, and its faults on the fault board with it, all but the last.");
      return act(game, session, { noise: 0, minutes: 1 }) ?? { over: false };
    }
    if (verb === "svc-exit") return finish(game, session);
  }
  if (look === "camera") {
    const part = systemsOf(place)?.parts?.[content.part];
    if (!part) throw new Error("The camera's gone.");
    const works = partWorks(game, place, part);
    if (id === "cam-loop") {
      if (!works) throw new Error("It's off.");
      if (cameraLooped(game, place, part.id)) throw new Error("It's looping already.");
      const people = peopleInRoom(game, place, part.room);
      loopCamera(game, place, part.id, LOOP_MINUTES, people);
      say(session, people.length ? `You loop the last minute, with ${listed(people)} in it, standing still for ever. Whoever watches it will notice.` : `The camera shows an empty ${lowerFirst(String(plainRoom(place, part.room)).replace(/^The /, ""))} on repeat for ${LOOP_MINUTES} minutes.`, people.length ? "warn" : "good");
      return act(game, session, { noise: people.length ? NOISE.loopSeen : 0, minutes: 1 }) ?? { over: false };
    }
    if (id === "cam-blind") {
      if (!works) throw new Error("It's off already.");
      endLoop(game, place, part.id);
      const lines = switchPart(game, place, part.id, false, { by: byOf(session) });
      say(session, "The picture goes to snow. Whoever watches it sees that at once.", "warn");
      notice(lines);
      return act(game, session, { noise: NOISE.blind, minutes: 1 }) ?? { over: false };
    }
    if (id === "cam-live") {
      const off = game.systems?.[place]?.parts?.[part.id]?.on === false;
      endLoop(game, place, part.id);
      const lines = off ? switchPart(game, place, part.id, true, { by: byOf(session) }) : [];
      say(session, "The camera shows the room as it is again.");
      notice(lines);
      return act(game, session, { noise: 0, minutes: 1 }) ?? { over: false };
    }
  }
  if (look === "navcom") {
    const [verb, arg] = id.split(":");
    if (verb === "nav-strike") {
      if (session.place !== SHIP || !game.ship?.log) throw new Error("There's no ship's log on this computer.");
      const i = Number(arg);
      const entry = game.ship.log[i];
      if (!entry) throw new Error("That line isn't in the log any more.");
      game.ship.log.splice(i, 1);
      game.rig.struck = (game.rig.struck ?? 0) + 1;
      say(session, `You strike "${entry.text}" from the ship's log.`, "warn");
      // On the captain's own system it's done under the captain's name, and the first officer reads the log.
      const first = holderKey(game, SHIP, "first_officer");
      if (session.yours && first && first !== YOU) rememberRequest(game, first, "story", { words: "saw a line struck from the ship's log under your name", w: -2 });
      return act(game, session, { noise: NOISE.strike, minutes: 1 }) ?? { over: false };
    }
  }
  throw new Error("That can't be done here.");
}
