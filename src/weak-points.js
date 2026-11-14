// Weak points, step 8 of the hacking rework: a hardened computer takes no breaker from the front, and its way in is
// written somewhere else at its place: a password in a letter, a file or a log on another computer, a session it
// leaves open through the shift change, or a service account the junction boxes still share. Reading one teaches it:
// a password lets the player straight in, a known service account lets KNOCK in, and a known open session lets SHADOW
// ride it in its hours. A hardened computer with none written gets one made up from a few patterns.
//
// world/computers/<id>.txt says "hardened: yes" and lists its "Weak points:", one a line:
//   - password in mail on haven_berth_board: From the harbor master to Mott: The office still takes TIDEWATER.
//   - service on the junction boxes: SERVICE LOGIN harbor/harbor STILL OPENS THE OFFICE MACHINE
//   - session 06:00-08:00 in logs on haven_berth_board: The harbor master leaves his session open at the shift change.
// A console in a place's systems file says ", hardened" after what it runs.

import { WORLD_COMPUTERS, WORLD_SYSTEMS } from "./world.js";
import { systemsOf } from "./systems.js";
import { addChecker } from "./room-hooks.js";

export const WEAK_KINDS = { password: "its password", service: "a service account it still shares", session: "a session it leaves open" };

// One line of a computer's Weak points, or { problem }.
export function readWeakLine(text) {
  const m = /^(password|service|session)(?:\s+(\d{1,2}:\d\d)\s*(?:-|to)\s*(\d{1,2}:\d\d))?\s+(?:in\s+(mail|files|logs)\s+on\s+([a-z0-9_]+)|on\s+the\s+junction\s+boxes)\s*:\s*(.+)$/i.exec(String(text ?? "").trim());
  if (!m) return { problem: `"${text}" is written as password, service or session (a session can have its hours, such as 06:00-08:00), then in mail, files or logs on a computer's id, or on the junction boxes, a colon, and what's written there` };
  const [, kind, from, to, where, computer, words] = m;
  return { kind: kind.toLowerCase(), hours: from && to ? [from.padStart(5, "0"), to.padStart(5, "0")] : null, where: where ? { kind: where.toLowerCase(), computer } : { kind: "bus" }, text: words.trim() };
}

// ---- Made up for a hardened computer with none written ------------------------------------------------------------

const hash = (text) => [...String(text)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const WORDS = ["TIDEWATER", "BALLAST", "LANTERN", "COPPER", "STARLING", "HALYARD", "BULKHEAD"];
function madeUp(place, target) {
  const others = Object.entries(WORLD_COMPUTERS).filter(([id, c]) => c.place === place && id !== target.id && !c.hardened).map(([id]) => id).sort();
  const boxes = Object.values(systemsOf(place)?.parts ?? {}).some((part) => part.kind === "junction box");
  // "A watch console" is "the watch console" in a note about it.
  const lower = /^an?\s/i.test(target.name) ? `the ${target.name.replace(/^an?\s+/i, "")}` : target.name.charAt(0).toLowerCase() + target.name.slice(1);
  const options = [];
  if (boxes) options.push({ kind: "service", hours: null, where: { kind: "bus" }, text: `SERVICE LOGIN maint/maint STILL OPENS ${lower.toUpperCase()}` });
  if (others.length) {
    const on = others[hash(target.id) % others.length];
    options.push({ kind: "password", hours: null, where: { kind: "files", computer: on }, name: "note.txt", text: `For ${lower}: the word is ${WORDS[hash(`${target.id}:word`) % WORDS.length]}. Don't leave this lying about.` });
    options.push({ kind: "session", hours: ["06:00", "08:00"], where: { kind: "logs", computer: on }, text: `The session on ${lower} is left open through the shift change, 06:00 to 08:00.` });
  }
  return options.length ? [options[hash(target.id) % options.length]] : [];
}

// ---- Where they are -----------------------------------------------------------------------------------------------

// The hardened computers at a place, each with its weak points, written or made up. One with nowhere to write a way in
// (no other computer here and no junction boxes) isn't hardened at all, and the checker says so.
export function hardenedAt(place, { all = false } = {}) {
  if (!place) return [];
  const out = [];
  for (const [id, c] of Object.entries(WORLD_COMPUTERS)) {
    if (c.place !== place || !c.hardened) continue;
    const lines = (c.weakPoints ?? []).map(readWeakLine).filter((one) => !one.problem && (one.where.kind === "bus" || (WORLD_COMPUTERS[one.where.computer]?.place === place && one.where.computer !== id)));
    out.push({ id, name: c.name, lines: lines.length ? lines : madeUp(place, { id, name: c.name }) });
  }
  for (const part of Object.values(systemsOf(place)?.parts ?? {})) {
    if (part.kind !== "console" || !part.hardened) continue;
    const id = `${place}:part:${part.id}`;
    const name = part.name.charAt(0).toUpperCase() + part.name.slice(1);
    out.push({ id, name, lines: madeUp(place, { id, name }) });
  }
  return all ? out : out.filter((one) => one.lines.length);
}
export const isHardened = (place, id) => Boolean(place && id) && hardenedAt(place).some((one) => one.id === id);
// What a computer's content says about it: hardened, with a way in somewhere at its place, and not the player's own.
export const contentHardened = (content) => Boolean(content?.hardened) && !content.yours && isHardened(content.place, content.id);

const revealsOf = (target, wp) => ({ target: target.id, name: target.name, kind: wp.kind, hours: wp.hours });
function letterOf(text) {
  const m = /^From (.+?) to (.+?):\s*(.+)$/is.exec(text);
  return m ? { from: m[1].trim(), to: m[2].trim(), text: m[3].trim() } : { from: "Someone", subject: "A letter", text };
}

// What another computer at the place holds of them: letters, files and logs to add to its own, each saying what it
// reveals when it's read.
export function weakItemsOn(place, sourceId) {
  const items = { files: [], mail: [], logs: [] };
  for (const target of hardenedAt(place)) {
    target.lines.forEach((wp, i) => {
      if (wp.where.kind === "bus" || wp.where.computer !== sourceId) return;
      const id = `weak_${hash(target.id).toString(36)}_${i}`;
      const reveals = revealsOf(target, wp);
      if (wp.where.kind === "files") items.files.push({ id, name: wp.name ?? "notes.txt", text: wp.text, reveals });
      else if (wp.where.kind === "mail") items.mail.push({ id, ...letterOf(wp.text), reveals });
      else items.logs.push({ id, name: wp.text.slice(0, 48).trim(), kind: "text", text: wp.text, reveals });
    });
  }
  return items;
}
// A computer's content with what it holds of other computers' weak points added. The content isn't changed.
export function withWeakPoints(content) {
  if (!content?.place || !content.id) return content;
  const extra = weakItemsOn(content.place, content.id);
  if (!extra.files.length && !extra.mail.length && !extra.logs.length) return content;
  return { ...content, files: [...(content.files ?? []), ...extra.files], mail: [...(content.mail ?? []), ...extra.mail], logs: [...(content.logs ?? []), ...extra.logs] };
}
// What the junction boxes' service log holds of them.
export function busWeakPoints(place) {
  return hardenedAt(place).flatMap((target) => target.lines.filter((wp) => wp.where.kind === "bus").map((wp) => ({ text: wp.text, reveals: revealsOf(target, wp) })));
}

// ---- Knowing them -------------------------------------------------------------------------------------------------

export const weakKnown = (game, id) => game.weak?.[id] ?? {};
const wayWords = (r) => (r.kind === "password" ? "its password, so it lets you straight in" : r.kind === "service" ? "a service account it still shares, so KNOCK gets in" : `a session it leaves open${r.hours ? ` from ${r.hours[0]} to ${r.hours[1]}` : ""}, so SHADOW can ride it`);
// Reading one: what it reveals goes into what the player knows. A password is a password. Returns the line to say, the
// first time.
export function learnWeak(game, reveals, from) {
  if (!reveals?.target) return null;
  game.weak ??= {};
  const known = (game.weak[reveals.target] ??= {});
  const first = !known[reveals.kind];
  known[reveals.kind] = { from, hours: reveals.hours ?? null };
  if (reveals.kind === "password") {
    game.passwords ??= {};
    game.passwords[reveals.target] ||= "found";
  }
  return first ? `You've found a way into ${reveals.name}: ${wayWords(reveals)}.` : null;
}
// For the view: what's known of one computer's weak points, in words.
export const weakWords = (game, id) => Object.entries(weakKnown(game, id)).map(([kind, w]) => `${WEAK_KINDS[kind] ?? kind}${w.hours ? ` (${w.hours[0]} to ${w.hours[1]})` : ""}, from ${w.from}`);

function inHours(game, [from, to]) {
  const now = (((game.clock?.hours ?? 0) % 24) + 24) % 24;
  const hours = (text) => {
    const [h, m] = String(text).split(":").map(Number);
    return h + (m || 0) / 60;
  };
  const a = hours(from);
  const b = hours(to);
  return a <= b ? now >= a && now < b : now >= a || now < b;
}
export const HARDENED_WHY = "it's hardened, so nothing breaks it from the front; its way in is written somewhere else";
// A breaker on a hardened computer: null when the computer isn't hardened (or it isn't a breaker), so the usual rules
// decide; { ok } when a weak point the player has found lets it in, whatever the class or the hour would say; else
// { why } it won't.
export function weakWay(game, content, p) {
  if (p?.kind !== "in" || !contentHardened(content)) return null;
  const known = weakKnown(game, content.id);
  if (p.id === "knock" && known.service) return { ok: true, kind: "service" };
  if (p.id === "shadow" && known.session) {
    if (!known.session.hours || inHours(game, known.session.hours)) return { ok: true, kind: "session" };
    return { why: `the session it leaves open is only there from ${known.session.hours[0]} to ${known.session.hours[1]}` };
  }
  return { why: HARDENED_WHY };
}
// ---- Checking the files -------------------------------------------------------------------------------------------

addChecker(() => {
  const problems = [];
  const empty = (place) => hardenedAt(place, { all: true }).filter((one) => !one.lines.length);
  for (const place of Object.keys(WORLD_SYSTEMS)) for (const one of empty(place)) if (one.id.includes(":part:")) problems.push(`world/systems/${place}.txt: ${one.name} is hardened, and there's no other computer at ${place} and no junction box to hold its way in`);
  for (const [id, c] of Object.entries(WORLD_COMPUTERS)) {
    if (c.hardened && !c.place) problems.push(`world/computers/${id}.txt: it's hardened, so it needs a place for its way in to be written at`);
    else if (c.hardened && empty(c.place).some((one) => one.id === id)) problems.push(`world/computers/${id}.txt: it's hardened, and nothing at ${c.place} holds a way in: give it a Weak points line on another computer there or on the junction boxes`);
    for (const text of c.weakPoints ?? []) {
      const wp = readWeakLine(text);
      if (wp.problem) {
        problems.push(`world/computers/${id}.txt: ${wp.problem}`);
        continue;
      }
      if (!c.hardened) problems.push(`world/computers/${id}.txt: its weak point "${text}" is for nothing, since it isn't hardened`);
      if (wp.where.kind === "bus" && !Object.values(systemsOf(c.place)?.parts ?? {}).some((part) => part.kind === "junction box")) problems.push(`world/computers/${id}.txt: "${text}" is on the junction boxes, and ${c.place} has none`);
      if (wp.where.computer && !WORLD_COMPUTERS[wp.where.computer]) problems.push(`world/computers/${id}.txt: "${text}" is on ${wp.where.computer}, and there's no computer called that`);
      else if (wp.where.computer && WORLD_COMPUTERS[wp.where.computer].place !== c.place) problems.push(`world/computers/${id}.txt: "${text}" is on ${wp.where.computer}, which is at another place`);
      else if (wp.where.computer === id) problems.push(`world/computers/${id}.txt: "${text}" is on the computer itself: a weak point is somewhere else`);
    }
  }
  return problems;
});
