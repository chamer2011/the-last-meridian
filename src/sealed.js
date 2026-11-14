// Sealed systems, step 9 of the hacking rework: a sealed computer takes nothing at its own keyboard (no logon, no
// breaker, no password, not even its owner's right) and lets in only the machines it trusts, over the network; what
// can be done inside is set by the machine you came through. A computer that isn't sealed can still keep a part to the
// machines it trusts: NAVCOM 7's crew file opens only from the first officer's terminal.
//
// world/computers/<id>.txt says "sealed: yes" and lists what it trusts, one a line:
//   Trusts:
//   - meridian_security_desk: the door
//   - the comms relay: navigation
// The machine is a computer's id, or a system on the place's network by its name. What it allows from there:
// everything; reading (its files, letters and logs); programs (its own); systems (all it runs) or a system by name
// (doors, cameras, power, navigation and the rest); the door (a door panel's own buttons); the crew file (NAVCOM 7's).

import { WORLD_COMPUTERS } from "./world.js";
import { LOCATIONS } from "./data.js";
import { addChecker } from "./room-hooks.js";
import { KNOWN_SYSTEMS, systemIdOf } from "../public/systems-text.js";
import { systemsOf, tellSealed } from "./systems.js";
import { linkedTo, networkOf } from "./network.js";

export const TRUST_WORDS = ["everything", "reading", "programs", "systems", "the door", "the crew file"];
const plain = (words) => String(words ?? "").toLowerCase().replace(/['’]/g, "").replace(/^the\s+/, "").replace(/\s+/g, " ").trim();

// One line of a computer's Trusts, or { problem }.
export function readTrustLine(text) {
  const m = /^(.+?)\s*:\s*(.+)$/.exec(String(text ?? "").trim());
  if (!m) return { problem: `"${text}" is written as the machine it trusts (a computer's id, or a system on the network by its name), a colon, and what it can do from there` };
  const rights = [];
  for (const raw of m[2].split(/,|\band\b/).map((one) => one.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean)) {
    const word = raw === "door" ? "the door" : raw === "crew file" ? "the crew file" : raw;
    if (TRUST_WORDS.includes(word)) rights.push(word);
    else if (KNOWN_SYSTEMS.includes(systemIdOf(word))) rights.push(systemIdOf(word));
    else return { problem: `"${raw}" in "${text}" isn't something a machine can be trusted with: ${TRUST_WORDS.join(", ")}, or a system by its name` };
  }
  return { from: m[1].trim(), rights };
}
export const trustsOf = (lines) => (lines ?? []).map(readTrustLine).filter((one) => !one.problem);

// The network node a trust line names at a place: a computer by its id, or a system by its name.
export function trustedNode(place, from) {
  const id = String(from ?? "").trim();
  const c = WORLD_COMPUTERS[id];
  if (c) return c.place === place ? { id: c.door ? `door:${c.door}` : `c:${id}`, name: c.name ?? id } : null;
  const node = Object.values(networkOf(place)?.nodes ?? {}).find((one) => plain(one.name) === plain(id));
  return node ? { id: node.id, name: node.name } : null;
}
// The trust line a computer has for the node a session comes from, or null.
export function trustLine(place, content, nodeId) {
  if (!nodeId || !content?.trusts?.length) return null;
  return content.trusts.find((one) => trustedNode(place, one.from)?.id === nodeId) ?? null;
}
// A name in the middle of a sentence: "the security desk", "the reactor gauges", "the comms relay", but "Camera 01".
export function inSentence(name) {
  const text = String(name ?? "");
  if (/^(The|A|An) /.test(text)) return text.replace(/^(The|A|An) /, (word) => word.toLowerCase());
  return /^[A-Z][a-z]+( [a-z']+)*$/.test(text) ? `the ${text[0].toLowerCase()}${text.slice(1)}` : text;
}
// Who it answers to, in words: "the security desk", "the comms relay and the plot table".
export function trustedNames(place, content) {
  const names = (content?.trusts ?? []).map((one) => inSentence(trustedNode(place, one.from)?.name ?? one.from));
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
export const sealedWords = (content) => `${content.name} is sealed: it takes nothing at its own keyboard, and answers only to ${trustedNames(content.place, content) || "nothing at all"}.`;

// What a session let in by trust may do, in words: "run navigation", "read what's on it", "work the door".
export function rightsWords(rights) {
  if (!rights || rights.includes("everything")) return "do everything";
  const words = rights.map((one) => ({ reading: "read what's on it", programs: "run its programs", systems: "work everything it runs", "the door": "work the door", "the crew file": "open the crew file" })[one] ?? `work its ${one}`);
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

// A computer's content as a session let in by trust sees it: only what the trust allows.
export function withRights(content, session) {
  const rights = session?.rights;
  if (!content || !rights || rights.includes("everything")) return content;
  const may = (word) => rights.includes(word);
  const systems = may("systems") ? null : rights.filter((word) => KNOWN_SYSTEMS.includes(word));
  return {
    ...content,
    files: may("reading") ? content.files : [],
    mail: may("reading") ? content.mail : [],
    logs: may("reading") ? content.logs : [],
    programs: may("programs") ? content.programs : [],
    controls: systems ? (content.controls ?? []).map((c) => ({ ...c, systems: c.systems.filter((s) => systems.includes(s)) })).filter((c) => c.systems.length) : content.controls,
  };
}
// Whether a session may work a door panel's own buttons.
export const mayWorkDoor = (session) => !session?.rights || ["everything", "the door", "doors"].some((word) => session.rights.includes(word));

// A part kept to the machines that are trusted with it: open when nothing is, else only to a session they let in.
export function partOpen(content, session, part) {
  const keepers = (content?.trusts ?? []).filter((one) => one.rights.includes(part));
  return !keepers.length || Boolean(session?.trusted?.includes(part));
}
export function partSealedWords(place, content, part) {
  const keepers = (content?.trusts ?? []).filter((one) => one.rights.includes(part)).map((one) => inSentence(trustedNode(place, one.from)?.name ?? one.from));
  return `Sealed: it opens only from ${keepers.join(" or ")}.`;
}

// ---- Sealed door panels, for the place's systems ------------------------------------------------------------------

// A door's written panel, if it has one.
const panelOf = (place, room) => Object.entries(WORLD_COMPUTERS).find(([, c]) => c.place === place && c.door === room) ?? null;
// The node a computer's ref is on: a written computer, a console, a thing.
const nodeOfRef = (ref) => (ref.written ? (WORLD_COMPUTERS[ref.written]?.door ? `door:${WORLD_COMPUTERS[ref.written].door}` : `c:${ref.written}`) : ref.console ? `part:${ref.console}` : ref.thing ? `t:${ref.thing}` : null);
tellSealed({
  // The doors a computer may not work, because their panel is sealed and doesn't trust it.
  without(place, ref) {
    const model = systemsOf(place);
    if (!model) return [];
    return Object.keys(model.doors).filter((room) => {
      const panel = panelOf(place, room);
      if (!panel?.[1].sealed) return false;
      const node = nodeOfRef(ref);
      return !trustsOf(panel[1].trusts).some((one) => trustedNode(place, one.from)?.id === node);
    });
  },
  panelSealed: (place, room) => Boolean(panelOf(place, room)?.[1].sealed),
  panelWords(place, room) {
    const panel = panelOf(place, room);
    if (!panel?.[1].sealed) return null;
    return `The panel is sealed and answers only to ${trustedNames(place, { place, trusts: trustsOf(panel[1].trusts) }) || "nothing at all"}.`;
  },
});

// ---- On the map ---------------------------------------------------------------------------------------------------

// The written computer behind a node, if there is one.
export function writtenOfNode(place, node) {
  if (node.ref?.kind === "written") return node.ref.id;
  if (node.kind === "door") return panelOf(place, node.room)?.[0] ?? null;
  return null;
}
// For the map: whether a node is sealed, and whether the node you're on is a machine it trusts.
export function nodeSeal(place, node, here) {
  const id = writtenOfNode(place, node);
  const c = id ? WORLD_COMPUTERS[id] : null;
  if (!c?.sealed) return { sealed: false, trusted: false, answers: null };
  const content = { place, trusts: trustsOf(c.trusts) };
  return { sealed: true, trusted: Boolean(trustLine(place, content, here)), answers: trustedNames(place, content) };
}

// ---- Checking the files -------------------------------------------------------------------------------------------

addChecker(() => {
  const problems = [];
  for (const [id, c] of Object.entries(WORLD_COMPUTERS)) {
    const at = (message) => problems.push(`world/computers/${id}.txt: ${message}`);
    const lines = (c.trusts ?? []).map((text) => ({ text, ...readTrustLine(text) }));
    for (const line of lines) if (line.problem) at(line.problem);
    const good = lines.filter((line) => !line.problem);
    if (c.sealed && !good.length) at("it's sealed and trusts nothing, so nothing can ever get in: give it a Trusts line");
    if ((c.sealed || good.length) && !c.place) at("a computer that's sealed or trusts others needs its place");
    if (!c.place || !LOCATIONS[c.place]) continue;
    const net = networkOf(c.place);
    const self = c.door ? `door:${c.door}` : `c:${id}`;
    for (const line of good) {
      const node = trustedNode(c.place, line.from);
      if (!node) {
        at(`it trusts ${line.from}, which isn't a computer or a system on ${LOCATIONS[c.place]?.name ?? c.place}'s network`);
        continue;
      }
      if (node.id === self) at(`it trusts itself: a trusted machine is somewhere else`);
      else if (net?.nodes[self] && !linkedTo(net, self).some((one) => one.id === node.id)) at(`it trusts ${node.name}, but the two aren't linked on the network, so nothing can come from there: link them (a Network line in either file, or in world/systems/${c.place}.txt)`);
      if (line.rights.includes("the crew file") && String(c.look ?? "").toLowerCase() !== "navcom") at(`only NAVCOM 7 has a crew file to keep to ${node.name}`);
      if (line.rights.includes("the door") && !c.door) at(`it has no door for ${node.name} to work: "the door" is for a door's panel`);
    }
  }
  return problems;
});
