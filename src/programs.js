// The programs a rig can carry: world/programs/<id>.txt, read again whenever one has changed (looked at no more than once
// a second). What each one does when it runs is in src/rig.js, by its id. GAME_PROGRAMS_DIR points tests at a copy.
import fs from "node:fs";
import path from "node:path";
import { addChecker } from "./room-hooks.js";
import { worldDir } from "./paths.js";

export const PROGRAMS_DIR = process.env.GAME_PROGRAMS_DIR ?? path.join(worldDir, "programs");
export const PROGRAM_KINDS = { in: "Getting in", doors: "Doors and systems", quiet: "Staying quiet", watcher: "The watcher", find: "Finding things", leave: "Leaving things behind" };
const NUMBERS = ["order", "hacking", "size", "power", "noise", "minutes"];
const YES = ["once", "built in", "on every rig"];

// One file, read into { id, name, kind, hacking, size, power, noise, minutes, once, builtIn, everyRig, hours, foundOn,
// soldAt, what, problems }. Every problem names its file and line.
export function parseProgram(id, text) {
  const p = { id, name: id.toUpperCase(), what: "", problems: [] };
  const at = (n, message) => p.problems.push(`programs/${id}.txt line ${n}: ${message}`);
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  let reading = null;
  const seen = new Set();
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (i === 0 && line.startsWith("#")) { p.name = line.slice(1).trim() || p.name; return; }
    if (reading === "what") { if (line) p.what = `${p.what} ${line}`.trim(); return; }
    if (!line) return;
    if (/^what it does:$/i.test(line)) { reading = "what"; return; }
    const m = /^([a-z ]+):\s*(.*)$/i.exec(line);
    if (!m) return at(i + 1, `"${line.slice(0, 40)}" isn't a line this file knows`);
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    seen.add(key);
    if (NUMBERS.includes(key)) {
      const n = Number(value);
      if (!Number.isFinite(n)) return at(i + 1, `${key} should be a number`);
      p[key] = n;
    } else if (YES.includes(key)) p[key === "built in" ? "builtIn" : key === "on every rig" ? "everyRig" : "once"] = /^yes$/i.test(value);
    else if (key === "kind") {
      if (!PROGRAM_KINDS[value]) return at(i + 1, `the kind "${value}" isn't one of ${Object.keys(PROGRAM_KINDS).join(", ")}`);
      p.kind = value;
    } else if (key === "written in") {
      const hours = /^(\d+(?:\.\d+)?)\s*hours?$/i.exec(value);
      if (!hours) return at(i + 1, "written in should say how many hours, like 3 hours");
      p.hours = Number(hours[1]);
    } else if (key === "found on") p.foundOn = value.split(",").map((one) => one.trim()).filter(Boolean);
    else if (key === "sold at") p.soldAt = value;
    else at(i + 1, `there's no line called "${key}"`);
  });
  // A line that's there but wrong has said so already.
  if (!seen.has("kind")) p.problems.push(`programs/${id}.txt: it needs a kind line`);
  if (!seen.has("hacking")) p.problems.push(`programs/${id}.txt: it needs a hacking line`);
  if (!seen.has("size") && !p.builtIn) p.problems.push(`programs/${id}.txt: it needs a size line`);
  if (!p.what) p.problems.push(`programs/${id}.txt: it needs a few words under What it does`);
  p.size = p.builtIn ? 0 : p.size ?? 1;
  p.hacking ??= 0;
  p.noise ??= 0;
  p.order ??= 99;
  return p;
}

let cache = null;
// Every program, in order, with what's wrong in their files. Read again when a file changes.
export function programsNow() {
  const now = Date.now();
  if (cache && now - cache.looked < 1000) return cache;
  let files = [];
  try {
    files = fs.readdirSync(PROGRAMS_DIR).filter((name) => name.endsWith(".txt") && !name.startsWith("_"));
  } catch {
    files = [];
  }
  const stamp = files.map((name) => {
    try {
      return `${name}:${fs.statSync(path.join(PROGRAMS_DIR, name)).mtimeMs}`;
    } catch {
      return name;
    }
  }).join("|");
  if (cache?.stamp === stamp) {
    cache.looked = now;
    return cache;
  }
  const list = files.map((name) => parseProgram(name.slice(0, -4), fs.readFileSync(path.join(PROGRAMS_DIR, name), "utf8")));
  list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  cache = { stamp, looked: now, list, byId: Object.fromEntries(list.map((p) => [p.id, p])), problems: list.flatMap((p) => p.problems) };
  return cache;
}
export const programById = (id) => programsNow().byId[String(id ?? "")] ?? null;
addChecker(() => programsNow().problems);
