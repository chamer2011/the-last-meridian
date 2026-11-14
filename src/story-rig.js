// The story knows your rig, step 10 of the hacking rework: what scenes, talks and people's asks can ask about the
// player's rig and what they've done on computers, what they can give and change, and the facts the player's deeds
// leave on the record for the stories to react to.
//
// Conditions, after ?:
//   rig program <id>      the program is on the rig        rig loaded <id>    it's loaded now
//   rig part <id>         the rig has that part, fitted or spare
//   rig link <link>       the link fitted reaches by cable, clip, optic, radio or navy
//   rig tool <id>         the bench has that tool
//   computer <id> in      the player has been past its logon (any way)
//   computer <id> hacked  broke in, with a breaker or a way in found       computer <id> network  reached it over the network
//   computer <id> trusted let in by a machine it trusts      computer <id> sealed   sealed now
//   computer <id> password  its password is known
//   recoded <room> [at <place>]   the door to that room has a code only the player knows, now
// Effects, after *, each with a colon and the reason:
//   rig program <id>, rig part <id> [worn|broken], rig tool <id>   given to the player
//   weak <computer> password|service|session [HH:MM-HH:MM]          the player learns that way in
//   seal <computer>, unseal <computer>                              sealed or opened again, whatever its file says
// The facts the player's deeds leave (hackFacts, for the checker): got_into_<computer>, recoded_<place>_<room>,
// looped_a_camera_at_<place>, blinded_a_camera_at_<place>, struck_from_the_ships_log.

import { WORLD_COMPUTERS, WORLD_SYSTEMS } from "./world.js";
import { LOCATIONS } from "./data.js";
import { programById } from "./programs.js";
import { CONDITIONS, REACHES, benchToolById, rigPartById } from "./rig-parts.js";
import { recordFact } from "./record.js";
import { roomIn } from "./systems.js";

export const COMPUTER_STATES = ["in", "hacked", "network", "trusted", "sealed", "password"];
const LINKS = Object.keys(REACHES);
const computerName = (id) => WORLD_COMPUTERS[id]?.name ?? id;

// ---- Asking ------------------------------------------------------------------------------------------------------

// A condition's words after "rig", "computer" or "recoded": { term fields } or { problem }.
export function readRigAsk(kind, rest) {
  const words = rest.map((one) => one.trim()).filter(Boolean);
  if (kind === "rig") {
    const [what, id, ...more] = words;
    const which = String(what ?? "").toLowerCase();
    if (more.length) return { problem: `"rig ${words.join(" ")}" has words the game doesn't follow: ${more.join(" ")}` };
    if (which === "program" || which === "loaded") return programById(id) ? { what: which, id } : { problem: `"rig ${which}" needs a program by its id, and there's no program called ${id ?? "nothing"}` };
    if (which === "part") return rigPartById(id) ? { what: which, id } : { problem: `"rig part" needs a part by its id, and there's no part called ${id ?? "nothing"}` };
    if (which === "link") return LINKS.includes(String(id ?? "").toLowerCase()) ? { what: which, id: String(id).toLowerCase() } : { problem: `"rig link" is followed by one of ${LINKS.join(", ")}` };
    if (which === "tool") return benchToolById(id) ? { what: which, id } : { problem: `"rig tool" needs one of the bench's tools by its id, and there's none called ${id ?? "nothing"}` };
    return { problem: `"rig" is followed by program, loaded, part, link or tool, and what it is` };
  }
  if (kind === "computer") {
    const [id, state, ...more] = words;
    if (!WORLD_COMPUTERS[id]) return { problem: `there's no computer called ${id ?? "nothing"}` };
    if (!COMPUTER_STATES.includes(String(state ?? "").toLowerCase()) || more.length) return { problem: `"computer ${id}" is followed by one of ${COMPUTER_STATES.join(", ")}` };
    return { id, state: state.toLowerCase() };
  }
  // recoded <room> [at <place>]
  const at = words.map((one) => one.toLowerCase()).lastIndexOf("at");
  const place = at > 0 ? words[at + 1] : null;
  const room = (at > 0 ? words.slice(0, at) : words).join(" ");
  if (place && !LOCATIONS[place]) return { problem: `there's no place called ${place}` };
  if (!room) return { problem: `"recoded" needs the room the door leads into` };
  return { room, place };
}

// The rig's fitted link, by what it reaches.
const linkOf = (game) => {
  const rig = game.rig;
  if (!rig) return null;
  for (const uid of Object.values(rig.build?.fit ?? {})) {
    const item = rig.parts?.find((one) => one.uid === uid);
    const part = item ? rigPartById(item.id) : null;
    if (part?.kind === "link" && item.cond !== "broken") return part.reaches ?? null;
  }
  return null;
};
// Whether a rig, computer or recoded term holds.
export function rigHolds(game, term) {
  if (term.kind === "rig") {
    const rig = game.rig;
    if (!rig) return false;
    if (term.what === "program") return rig.programs.includes(term.id);
    if (term.what === "loaded") return rig.loaded.includes(term.id);
    if (term.what === "part") return rig.parts.some((one) => one.id === term.id);
    if (term.what === "link") return linkOf(game) === term.id;
    if (term.what === "tool") return (rig.tools ?? []).includes(term.id);
    return false;
  }
  if (term.kind === "computer") {
    const memory = game.computers?.[term.id] ?? {};
    if (term.state === "in") return Boolean(memory.in);
    if (term.state === "hacked") return Boolean(memory.hacked);
    if (term.state === "network") return Boolean(memory.network);
    if (term.state === "trusted") return Boolean(memory.trusted);
    if (term.state === "password") return Boolean(game.passwords?.[term.id]);
    if (term.state === "sealed") return Boolean(game.sealed?.[term.id] ?? WORLD_COMPUTERS[term.id]?.sealed);
    return false;
  }
  // recoded
  const place = term.place ?? game.location;
  const room = roomIn(game, place, term.room);
  return Boolean(room && game.systems?.[place]?.doors?.[room]?.recoded);
}

// ---- Changing ----------------------------------------------------------------------------------------------------

// An effect's words after its verb: { do } or { problem }. line is the whole effect, which a session's hours need,
// since an effect is split at its first colon.
export function readRigEffect(verb, words, after, line = null) {
  const reason = () => (after ? null : `${verb} needs a colon and the reason after it`);
  if (verb === "rig") {
    const [what, id, cond, ...more] = words;
    const which = String(what ?? "").toLowerCase();
    if (which === "program") {
      if (!programById(id) || cond) return { problem: `rig program is written * rig program an_id: reason, and there's no program called ${id ?? "nothing"}` };
      return reason() ? { problem: reason() } : { do: { command: "rig_program", id, reason: after } };
    }
    if (which === "part") {
      if (!rigPartById(id)) return { problem: `rig part is written * rig part an_id: reason, or with worn or broken after the id, and there's no part called ${id ?? "nothing"}` };
      if ((cond && !CONDITIONS.includes(cond.toLowerCase())) || more.length) return { problem: `a part given is new, ${CONDITIONS.slice(1).join(" or ")}, after its id` };
      return reason() ? { problem: reason() } : { do: { command: "rig_part", id, cond: (cond ?? "new").toLowerCase(), reason: after } };
    }
    if (which === "tool") {
      if (!benchToolById(id) || cond) return { problem: `rig tool is written * rig tool an_id: reason, and the bench has no tool called ${id ?? "nothing"}` };
      return reason() ? { problem: reason() } : { do: { command: "rig_tool", id, reason: after } };
    }
    return { problem: "rig is followed by program, part or tool, its id, a colon and the reason" };
  }
  if (verb === "weak") {
    const m = /^weak\s+(\S+)\s+(\S+)(?:\s+(\d{1,2}:\d\d)\s*-\s*(\d{1,2}:\d\d))?\s*(?::\s*(.*))?$/i.exec(String(line ?? `weak ${words.join(" ")}${after ? `: ${after}` : ""}`).trim());
    const id = m?.[1];
    if (!WORLD_COMPUTERS[id]) return { problem: `there's no computer called ${id ?? "nothing"} to know a way into` };
    const how = String(m[2] ?? "").toLowerCase();
    if (!["password", "service", "session"].includes(how)) return { problem: "weak is written * weak a_computer password, service or session (a session can have its hours, like 06:00-08:00), a colon and how the player came to know it" };
    if (m[3] && how !== "session") return { problem: "only a session has hours, written like 06:00-08:00" };
    const span = m[3] ? [m[3].padStart(5, "0"), m[4].padStart(5, "0")] : null;
    const why = String(m[5] ?? "").trim();
    return why ? { do: { command: "weak", id, kind: how, hours: span, reason: why } } : { problem: "weak needs a colon and how the player came to know it, after it" };
  }
  // seal, unseal
  const [id, ...more] = words;
  if (!WORLD_COMPUTERS[id] || more.length) return { problem: `${verb} is written * ${verb} a_computer: reason, and there's no computer called ${id ?? "nothing"}` };
  return reason() ? { problem: reason() } : { do: { command: verb, id, reason: after } };
}

// The scene's effect, played: lines for the story. helpers: { giveRigPart, learnWeak, loadIfRoom }, from src/command.js.
export function storyRig(game, step, { giveRigPart, learnWeak, loadIfRoom }) {
  const notes = [];
  if (step.command === "rig_program") {
    const p = programById(step.id);
    if (!game.rig || !p) return notes;
    if (game.rig.programs.includes(p.id)) return notes;
    game.rig.programs.push(p.id);
    const loaded = loadIfRoom(game, p);
    notes.push(`[RIG] ${p.name} is on your rig${loaded ? ", loaded" : ", with no room to load it yet"}: ${step.reason}`);
  } else if (step.command === "rig_part") {
    const item = giveRigPart(game, step.id, { cond: step.cond, from: step.reason });
    if (item) notes.push(`[RIG] ${rigPartById(step.id)?.name ?? step.id}${step.cond !== "new" ? ` (${step.cond})` : ""} goes with your rig's spare parts: ${step.reason}`);
  } else if (step.command === "rig_tool") {
    if (!game.rig) return notes;
    game.rig.tools ??= [];
    if (!game.rig.tools.includes(step.id)) {
      game.rig.tools.push(step.id);
      notes.push(`[RIG] The bench has ${benchToolById(step.id)?.name ?? step.id} now: ${step.reason}`);
    }
  } else if (step.command === "weak") {
    const said = learnWeak(game, { target: step.id, name: computerName(step.id), kind: step.kind, hours: step.hours }, step.reason);
    notes.push(`[COMPUTER] ${said ?? `You know a way into ${computerName(step.id)}.`}`);
  } else if (step.command === "seal" || step.command === "unseal") {
    game.sealed ??= {};
    game.sealed[step.id] = step.command === "seal";
    notes.push(`[COMPUTER] ${computerName(step.id)} is ${step.command === "seal" ? "sealed, and takes nothing at its own keyboard" : "open again at its own keyboard"}: ${step.reason}`);
  }
  return notes;
}

// ---- What the player's deeds leave on the record -----------------------------------------------------------------

const factOf = (game, id, text) => {
  try {
    recordFact(game, { id, text, from: "your rig" });
  } catch {
    // The record is full: what happened, happened.
  }
};
// A computer the player got into, and how: by a breaker or a way in found (hacked), over the network, let in by trust.
export function noteGotIn(game, session, { hacked = false } = {}) {
  if (!session || session.practice) return;
  game.computers ??= {};
  const memory = (game.computers[session.id] ??= { read: [], ran: [], visits: 1 });
  memory.in = true;
  if (hacked) memory.hacked = true;
  if (session.remote) memory.network = true;
  if (session.trusted) memory.trusted = true;
  if (session.yours || !WORLD_COMPUTERS[session.id]) return;
  const how = hacked ? "breaking in" : session.trusted ? `being let in from ${String(session.fromName ?? "a machine it trusts").replace(/^The /, "the ")}` : "its password";
  factOf(game, `got_into_${session.id}`.slice(0, 40), `Got into ${computerName(session.id)}${session.remote ? " over the network" : ""}, by ${how}`);
}
export const noteRecoded = (game, place, room, name) => factOf(game, `recoded_${place}_${room}`.slice(0, 40), `Gave the door to ${name} at ${LOCATIONS[place]?.name ?? place} a code only the player knows`);
export const noteCamera = (game, place, how) => factOf(game, `${how}_a_camera_at_${place}`.slice(0, 40), `${how === "looped" ? "Looped" : "Blinded"} a camera at ${LOCATIONS[place]?.name ?? place}`);
export const noteStruck = (game) => factOf(game, "struck_from_the_ships_log", "Struck a line from the ship's log");

// Every fact those can leave, for the checker. doorsOf(place) gives the rooms whose doors a place's systems run.
export function hackFacts(doorsOf = () => []) {
  const names = new Set(["struck_from_the_ships_log"]);
  for (const id of Object.keys(WORLD_COMPUTERS)) names.add(`got_into_${id}`.slice(0, 40));
  for (const place of new Set(["meridian", ...Object.keys(WORLD_SYSTEMS)])) {
    names.add(`looped_a_camera_at_${place}`.slice(0, 40));
    names.add(`blinded_a_camera_at_${place}`.slice(0, 40));
    for (const room of doorsOf(place)) names.add(`recoded_${place}_${room}`.slice(0, 40));
  }
  return names;
}
