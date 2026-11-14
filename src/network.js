// Each place's network (step 7 of the hacking rework). Every system the place's systems file knows is a node: its
// terminals (the written computers there, and the consoles and things that run its systems), the door panels of the
// doors it runs, its junction boxes, its cameras and its comms relay. They're joined on two networks, worked out from
// what the file already says: the data network, from each terminal to what it runs (doors, cameras, the relay, and the
// junction boxes it runs the power through) and between written computers that name each other; and the maintenance
// bus, along the junction boxes and from each box to the door panels and the relay in the rooms it feeds. A Network
// part in the file adds links of its own ("Medbay records to the plot table", ", bus" for the bus).
//
// A session on any node can go along a link to the next (hop): two minutes and a point of noise where you leave, a
// point where you arrive, and you arrive at its logon unless it's yours or you know its password. Arriving over the
// network, the rig's link doesn't matter: it's plugged in where you started. The map is what a computer's Network
// folder shows.
import { WORLD_COMPUTERS } from "./world.js";
import { computerAtDoor, computerAtThing, consoleContent, openLogon, writtenContent } from "./computers.js";
import { cameraContent, codeOf, reachWhy, serviceContent } from "./devices.js";
import { systemsOf } from "./systems.js";
import { addChecker } from "./room-hooks.js";
import { hardenedAt, weakKnown } from "./weak-points.js";
import { nodeSeal, sealedWords, trustLine } from "./sealed.js";
import { LOCATIONS } from "./data.js";
import { mapFor } from "./walk.js";

// My numbers: what a hop costs.
export const HOP = { minutes: 2, noiseLeaving: 1, noiseArriving: 1 };
const PART_KINDS = { "junction box": "junction", camera: "camera", relay: "relay" };

const plain = (words) => String(words ?? "").toLowerCase().replace(/['’]/g, "").replace(/^the\s+/, "").replace(/\s+/g, " ").trim();
const upperFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : "");

// Where a node sits on the map: its deck (or the place's one band), and how far along it, from 0 to 1.
function placeOnMap(map, room) {
  const entry = map?.rooms?.[room];
  if (entry?.area && entry.level?.width) return { band: entry.level.id, bandName: entry.level.name, x: Math.min(0.97, Math.max(0.03, (entry.area.x + entry.area.w / 2) / entry.level.width)) };
  const ids = Object.keys(map?.levels ?? {});
  const i = Math.max(0, ids.indexOf(entry?.levelId ?? room));
  return { band: "all", bandName: map?.name ?? "", x: ids.length > 1 ? 0.05 + (0.9 * i) / (ids.length - 1) : 0.5 };
}

const cache = new WeakMap();
// The place's network: { nodes: { id: node }, links: [{ a, b, net }], problems }. Kept for as long as its systems model.
export function networkOf(place) {
  const model = systemsOf(place);
  if (!model) return null;
  if (cache.has(model)) return cache.get(model);
  const map = mapFor(place);
  const nodes = {};
  const links = [];
  const problems = [];
  const roomName = (room) => map?.rooms?.[room]?.name ?? room;
  const add = (id, node) => {
    if (!nodes[id]) nodes[id] = { id, ...node, ...placeOnMap(map, node.room) };
    return nodes[id];
  };
  const link = (a, b, net) => {
    if (!a || !b || a === b || !nodes[a] || !nodes[b]) return;
    if (links.some((one) => (one.a === a && one.b === b) || (one.a === b && one.b === a))) return;
    links.push({ a, b, net });
  };
  // The terminals.
  const terminals = [];
  for (const c of model.computers) {
    const ref = c.ref;
    if (ref.kind === "written") {
      const w = WORLD_COMPUTERS[ref.id];
      const room = w?.room ? Object.keys(map?.rooms ?? {}).find((id) => plain(map.rooms[id].name) === plain(w.room)) ?? null : null;
      terminals.push({ id: `c:${ref.id}`, c, node: add(`c:${ref.id}`, { kind: "terminal", name: w?.name ?? ref.id, room, ref }) });
    } else if (ref.kind === "console") terminals.push({ id: `part:${ref.part}`, c, node: add(`part:${ref.part}`, { kind: "terminal", name: upperFirst(ref.name), room: ref.room, ref }) });
    else if (ref.kind === "thing") terminals.push({ id: `t:${ref.thing}`, c, node: add(`t:${ref.thing}`, { kind: "terminal", name: upperFirst(ref.name), room: ref.room, ref }) });
  }
  // Written computers at the place that run nothing are on the data network too.
  for (const [id, w] of Object.entries(WORLD_COMPUTERS)) {
    if (w.place !== place || w.door || nodes[`c:${id}`]) continue;
    const room = w.room ? Object.keys(map?.rooms ?? {}).find((one) => plain(map.rooms[one].name) === plain(w.room)) ?? null : null;
    add(`c:${id}`, { kind: "terminal", name: w.name ?? id, room, ref: { kind: "written", id } });
  }
  // The door panels, junction boxes, cameras and relays.
  for (const room of Object.keys(model.doors)) add(`door:${room}`, { kind: "door", name: `${roomName(room).replace(/^The /, "")} door`, room, ref: { kind: "door", room } });
  for (const part of Object.values(model.parts)) {
    const kind = PART_KINDS[part.kind];
    if (!kind || part.unplaced) continue;
    add(`part:${part.id}`, { kind, name: kind === "junction" ? codeOf(place, part) : kind === "camera" ? codeOf(place, part).replace(/^CAM /, "Camera ") : "Comms relay", room: part.room, ref: { kind: "part", part: part.id } });
  }
  const partNodes = (kind, rooms = null) => Object.values(nodes).filter((n) => n.kind === kind && (!rooms || rooms.includes(n.room)));
  // The data network: each terminal to what it runs.
  for (const { id, c } of terminals) {
    const rooms = c.rooms ?? null;
    if (c.systems.includes("doors")) for (const n of Object.values(nodes).filter((one) => one.kind === "door" && (!rooms || rooms.includes(one.room)))) link(id, n.id, "data");
    if (c.systems.includes("cameras")) for (const n of partNodes("camera", rooms)) link(id, n.id, "data");
    if (c.systems.includes("comms")) for (const n of partNodes("relay", rooms)) link(id, n.id, "data");
    if (c.systems.includes("power")) for (const n of partNodes("junction", rooms)) link(id, n.id, "data");
  }
  // Written computers that name each other.
  for (const [id, w] of Object.entries(WORLD_COMPUTERS)) {
    if (w.place !== place) continue;
    for (const other of w.network ?? []) link(`c:${id}`, `c:${String(other.name).trim()}`, "data");
  }
  // The maintenance bus: along the junction boxes, deck by deck, and from each to the panels and relay it feeds.
  const boxes = partNodes("junction").sort((p, q) => p.band.localeCompare(q.band) || p.x - q.x);
  boxes.forEach((box, i) => { if (i) link(boxes[i - 1].id, box.id, "bus"); });
  for (const box of boxes) {
    const fed = Object.entries(model.circuits).filter(([, partId]) => `part:${partId}` === box.id).map(([room]) => room);
    for (const n of Object.values(nodes).filter((one) => (one.kind === "door" || one.kind === "relay") && fed.includes(one.room))) link(box.id, n.id, "bus");
  }
  // The file's own links.
  const find = (words) => {
    const w = plain(words);
    const byName = Object.values(nodes).filter((n) => plain(n.name) === w || n.id === `c:${w.replace(/ /g, "_")}`);
    if (byName.length === 1) return byName[0];
    const m = /^(junction box|camera|relay|door) (?:in|to|of) (.+)$/.exec(w);
    if (m) {
      const kind = m[1] === "junction box" ? "junction" : m[1];
      const room = Object.keys(map?.rooms ?? {}).find((id) => plain(map.rooms[id].name) === plain(m[2]));
      return Object.values(nodes).find((n) => n.kind === kind && n.room === room) ?? null;
    }
    return null;
  };
  for (const raw of model.file?.network ?? []) {
    const text = typeof raw === "string" ? raw : raw.text;
    const m = /^(.+?) to (.+?)(?:,\s*(bus|data))?$/i.exec(text.trim());
    const a = m ? find(m[1]) : null;
    const b = m ? find(m[2]) : null;
    if (!m) problems.push(`systems/${place}.txt line ${raw.line ?? "?"}: a network link is written like "Medbay records to the plot table", with ", bus" at the end for the maintenance bus`);
    else if (!a || !b) problems.push(`systems/${place}.txt line ${raw.line ?? "?"}: ${!a ? m[1] : m[2]} isn't a system on ${LOCATIONS[place]?.name ?? place}'s network`);
    else link(a.id, b.id, (m[3] ?? "data").toLowerCase());
  }
  const net = { nodes, links, problems };
  cache.set(model, net);
  return net;
}
addChecker(() => Object.keys(LOCATIONS).flatMap((place) => (systemsOf(place)?.file?.network?.length ? networkOf(place)?.problems ?? [] : [])));

export const linkedTo = (net, id) => net.links.filter((one) => one.a === id || one.b === id).map((one) => ({ id: one.a === id ? one.b : one.a, net: one.net }));

// The node a session is on, from its computer's id: a written computer, a console, a thing, a door's panel, a junction
// box's menu, a camera's feed.
export function nodeOfSession(session) {
  if (!session) return null;
  // A written door panel is its door's node.
  if (WORLD_COMPUTERS[session.id]) return WORLD_COMPUTERS[session.id].door ? `door:${WORLD_COMPUTERS[session.id].door}` : `c:${session.id}`;
  const place = session.place ?? "";
  const rest = String(session.id).startsWith(`${place}:`) ? String(session.id).slice(place.length + 1) : String(session.id);
  const m = /^(service|camera|part):(.+)$/.exec(rest);
  if (m) return `part:${m[2]}`;
  const door = /^door:(.+)$/.exec(rest);
  if (door) return `door:${door[1]}`;
  return `t:${rest}`;
}

// What a node is as a computer, to open it.
function nodeContent(game, place, node) {
  const model = systemsOf(place);
  const ref = node.ref;
  if (node.kind === "terminal") {
    if (ref.kind === "written") return writtenContent(ref.id);
    if (ref.kind === "console") return consoleContent(game, place, model.parts[ref.part]);
    const [levelId, thingId] = [ref.room, String(ref.thing).split(":").pop()];
    const target = computerAtThing(game, place, levelId, { id: thingId, name: ref.name });
    return target?.id ? writtenContent(target.id) : target?.generic ?? null;
  }
  if (node.kind === "door") {
    const target = computerAtDoor(game, place, node.room);
    return target.id ? writtenContent(target.id) : target.generic;
  }
  const part = model.parts[ref.part];
  if (!part) return null;
  return node.kind === "camera" ? cameraContent(game, place, part) : serviceContent(game, place, part);
}

// Going along a link from the session's node to the next. helpers: { act, finish }. Returns what an order returns.
export function hop(game, session, id, { act, finish, content: from = null }) {
  const net = networkOf(session.place);
  const here = nodeOfSession(session);
  if (!net?.nodes[here]) return { over: false, said: "This computer isn't on the place's network." };
  const node = net.nodes[id];
  if (!node || !linkedTo(net, here).some((one) => one.id === id)) return { over: false, said: "That isn't linked to where you are." };
  // The map is on the player's rig, which has to be connected to go on from here. Over the network it's still plugged
  // in where the player started.
  if (!session.remote && !session.plugged) {
    const why = from ? reachWhy(game, from) : null;
    return { over: false, said: `Your rig isn't connected, so it can't go on from here: ${why ?? "connect it first"}.` };
  }
  const content = nodeContent(game, session.place, node);
  if (!content) return { over: false, said: "There's nothing there to reach." };
  // A sealed one lets in only the machines it trusts (step 9): from anywhere else it refuses, and no time goes by.
  if (content.sealed && !trustLine(session.place, content, here)) return { over: false, said: sealedWords(content) };
  // Heard where you leave; if that's the end of the session, that's where you stay.
  const out = act(game, session, { noise: HOP.noiseLeaving, minutes: HOP.minutes });
  if (out) return out;
  const summary = finish(game, session, [`[COMPUTER] From ${session.name} you went on over the network to ${content.name}.`]).summary;
  openLogon(game, content, { at: session.at ?? null, remote: true, noise: HOP.noiseArriving, from: here, fromName: net.nodes[here]?.name ?? null });
  return { over: true, summary, computer: true };
}

// The map for the page: the place's bands (decks), every node with where it sits and whether it's linked to here,
// and the links. null when the session isn't on a network.
export function networkView(game, session) {
  const net = networkOf(session.place);
  const here = nodeOfSession(session);
  if (!net?.nodes[here]) return null;
  const near = new Set(linkedTo(net, here).map((one) => one.id));
  const bands = [];
  for (const node of Object.values(net.nodes)) if (!bands.some((one) => one.id === node.band)) bands.push({ id: node.band, name: node.bandName });
  bands.sort((a, b) => a.id.localeCompare(b.id));
  // Each node's place in its band, from fore to aft: the page spreads them out from that (public/net-layout.js).
  const order = {};
  for (const band of bands) {
    const list = Object.values(net.nodes).filter((node) => node.band === band.id).sort((p, q) => p.x - q.x || p.kind.localeCompare(q.kind) || p.name.localeCompare(q.name));
    list.forEach((node, i) => { order[node.id] = i; });
  }
  // Hardened ones are marked, and those whose way in the player has found (src/weak-points.js).
  const hard = new Set(hardenedAt(session.place).map((one) => one.id));
  const hardOf = (node) => hard.has(nodeContentId(session.place, node));
  const weakOf = (node) => hardOf(node) && Object.keys(weakKnown(game, nodeContentId(session.place, node))).length > 0;
  return {
    here,
    bands,
    // Sealed ones too, with whether the machine you're on is one they trust (src/sealed.js).
    nodes: Object.values(net.nodes).map((node) => {
      const seal = nodeSeal(session.place, node, here);
      return { id: node.id, name: node.name, kind: node.kind, band: node.band, i: order[node.id], here: node.id === here, linked: near.has(node.id), visited: Boolean(game.computers?.[nodeContentId(session.place, node)]), hardened: hardOf(node), weak: weakOf(node), sealed: seal.sealed, trusted: seal.trusted, answers: seal.answers };
    }),
    links: net.links,
    hop: HOP,
  };
}
// The computer id a node opens as, to know whether it's been visited.
function nodeContentId(place, node) {
  if (node.ref.kind === "written") return node.ref.id;
  if (node.kind === "door") return `${place}:door:${node.room}`;
  if (node.kind === "terminal" && node.ref.kind === "console") return `${place}:part:${node.ref.part}`;
  if (node.kind === "terminal") return `${place}:${node.ref.thing}`;
  return `${place}:${node.kind === "camera" ? "camera" : "service"}:${node.ref.part}`;
}
