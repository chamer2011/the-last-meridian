// The rig built from parts (step 4 of the hacking rework): its boards, casings and parts are world/rig-parts/<id>.txt,
// read again whenever one has changed (looked at no more than once a second), and what a build of them adds up to.
// A board's sockets sit on a little grid; a heat sink takes heat off the sockets beside it; a worn part gives half and
// runs a point warmer, a broken one gives nothing. The rig won't start without a core, a cell and a link that work.
// Nothing is rolled. This file reads nothing of the game's, so the rig, the computers and the pack can all read it.
// GAME_RIG_PARTS_DIR points tests at a copy. The bench's tools (step 5) are _tools.txt in the same folder.
import fs from "node:fs";
import path from "node:path";
import { addChecker } from "./room-hooks.js";
import { worldDir } from "./paths.js";

export const RIG_PARTS_DIR = process.env.GAME_RIG_PARTS_DIR ?? path.join(worldDir, "rig-parts");
export const PART_KINDS = { board: "Board", casing: "Casing", core: "Core", memory: "Memory", link: "Link", cell: "Cell", sink: "Heat sink", extra: "Extra" };
const SOCKET_KINDS = ["core", "memory", "link", "cell", "sink", "extra"];
const NUMBERS = ["order", "grade", "weight", "heat", "power", "quiet", "speed", "memory", "cools", "cooling", "echo", "worth"];
// What a link can reach: which ones a computer takes is the computers' business (step 6 of the hacking rework).
export const REACHES = { cable: "by cable", clip: "by its service port", optic: "through its optical port", radio: "by radio", navy: "by a Navy coupling" };
// What a part is worth in credits, when its file doesn't say: its grade, 35 a step.
export const WORTH_A_GRADE = 35;
export const CONDITIONS = ["new", "worn", "broken"];

// The bench's rules, my numbers to tune: mending takes a parts crate from the ship's stores and the part's grade in
// hours and Engineering; a core can be overclocked or undervolted; the lathe rebuilds a broken part as a worn one from
// scrap; taking a part apart gives scrap.
export const BENCH_RULES = {
  tunes: {
    over: { name: "overclocked", speed: 0.3, heat: 2, engineering: 1, hours: 2 },
    under: { name: "undervolted", speed: -0.2, heat: -1, engineering: 1, hours: 1 },
  },
  untune: { hours: 1 },
  lathe: { scrap: 2, hours: 2, tool: "micro_lathe" },
  apart: { hours: 1, scrap: { board: 2, casing: 2, part: 1 } },
};
// A session warms the rig a point every ten of its minutes. At 3 its fan is heard: anything noisy is one louder. At 5
// it's overheating: everything takes twice as long, and the hottest part wears when the player logs off.
export const HEAT = { minutesAPoint: 10, fan: 3, overheating: 5 };
export const heatWords = (heat) => (heat >= HEAT.overheating ? "overheating" : heat >= HEAT.fan ? "hot: the fan is heard" : heat >= 1 ? "warm" : "cool");

// "core at 1 1, extra at 5 1 from Hacking 7": the board's sockets, each named by its kind and how many of that kind
// came before it (core1, memory1, memory2...), with its column and row from 1.
function readSockets(value, problem) {
  const count = {};
  const out = [];
  for (const piece of value.split(",").map((one) => one.trim()).filter(Boolean)) {
    const m = /^(core|memory|link|cell|sink|extra) at (\d+) (\d+)(?: from hacking (\d+))?$/i.exec(piece);
    if (!m) {
      problem(`"${piece}" isn't a socket: write it like "memory at 3 1", or "extra at 5 1 from Hacking 7"`);
      continue;
    }
    const kind = m[1].toLowerCase();
    count[kind] = (count[kind] ?? 0) + 1;
    out.push({ key: `${kind}${count[kind]}`, kind, col: Number(m[2]), row: Number(m[3]), gate: Number(m[4] ?? 0) });
  }
  return out;
}

// A thing in a recipe, in words, as an id: "a fuel cell" is fuel_cell, "2 parts crates" two of parts_crate.
export const slugOf = (words) => String(words ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
function readNeed(words) {
  const m = /^(an?|\d+) (.+)$/i.exec(words.trim());
  if (!m) return null;
  const n = /^an?$/i.test(m[1]) ? 1 : Number(m[1]);
  // Two of something is written in the plural: the last word loses its s.
  const name = n > 1 ? m[2].trim().replace(/s$/i, "") : m[2].trim();
  return n > 0 ? { id: slugOf(name), n } : null;
}

// "3 scrap, Engineering 2, 2 hours, with the soldering kit": what making it at the bench takes. What goes into it comes
// first (scrap, or anything in world/items, or a parts crate from the ship's stores, joined by "and" or commas), then
// the Engineering it needs, the hours, and a tool for the bench if it takes one.
function readRecipe(value, problem) {
  const recipe = { needs: [], engineering: null, hours: null, tool: null };
  for (const piece of value.split(",").map((one) => one.trim()).filter(Boolean)) {
    let m;
    if ((m = /^engineering (\d+)$/i.exec(piece))) recipe.engineering = Number(m[1]);
    else if ((m = /^(\d+(?:\.\d+)?) hours?$/i.exec(piece))) recipe.hours = Number(m[1]);
    else if ((m = /^with (?:the |an? )?(.+)$/i.exec(piece))) recipe.tool = slugOf(m[1]);
    else {
      for (const words of piece.split(/ and /i)) {
        const need = readNeed(words);
        if (need) recipe.needs.push(need);
        else problem(`"${words}" isn't something to make it from: write it like 2 scrap, or a fuel cell`);
      }
    }
  }
  if (!recipe.needs.length || recipe.engineering === null || recipe.hours === null) {
    problem("made from should say what it takes, like 2 scrap, Engineering 1, 2 hours, and a tool at the end if it needs one, like with the soldering kit");
    return null;
  }
  // The scrap it takes, which the Rig page and the bench read first.
  recipe.scrap = recipe.needs.find((need) => need.id === "scrap")?.n ?? 0;
  return recipe;
}

// One file, read into { id, name, kind, the numbers, sockets, made, from, what, problems }. Every problem names its file
// and line.
export function parseRigPart(id, text) {
  const p = { id, name: id, what: "", sockets: [], made: null, from: "", problems: [] };
  const at = (n, message) => p.problems.push(`rig-parts/${id}.txt line ${n}: ${message}`);
  const seen = new Set();
  let reading = null;
  String(text ?? "").replace(/\r/g, "").split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (i === 0 && line.startsWith("#")) {
      p.name = line.slice(1).trim() || p.name;
      return;
    }
    if (reading === "what") {
      if (line) p.what = `${p.what} ${line}`.trim();
      return;
    }
    if (!line) return;
    if (/^what it is:$/i.test(line)) {
      reading = "what";
      return;
    }
    const m = /^([a-z ]+):\s*(.*)$/i.exec(line);
    if (!m) return at(i + 1, `"${line.slice(0, 40)}" isn't a line this file knows`);
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    seen.add(key);
    if (NUMBERS.includes(key)) {
      const n = Number(value);
      if (!Number.isFinite(n)) return at(i + 1, `${key} should be a number`);
      p[key] = n;
    } else if (key === "kind") {
      if (!PART_KINDS[value]) return at(i + 1, `the kind "${value}" isn't one of ${Object.keys(PART_KINDS).join(", ")}`);
      p.kind = value;
    } else if (key === "reaches") {
      if (!REACHES[value.toLowerCase()]) return at(i + 1, `a link reaches one of: ${Object.keys(REACHES).join(", ")}`);
      p.reaches = value.toLowerCase();
    } else if (key === "sockets") p.sockets = readSockets(value, (message) => at(i + 1, message));
    else if (key === "made from") p.made = readRecipe(value, (message) => at(i + 1, message));
    else if (key === "where from") p.from = value;
    else at(i + 1, `there's no line called "${key}"`);
  });
  if (!seen.has("kind")) p.problems.push(`rig-parts/${id}.txt: it needs a kind line`);
  if (!p.what) p.problems.push(`rig-parts/${id}.txt: it needs a few words under What it is`);
  if (p.kind === "board") {
    for (const kind of ["core", "cell", "link"]) if (!p.sockets.some((s) => s.kind === kind)) p.problems.push(`rig-parts/${id}.txt: a board needs a ${kind} socket, or the rig on it can't start`);
    const spots = p.sockets.map((s) => `${s.col} ${s.row}`);
    if (new Set(spots).size !== spots.length) p.problems.push(`rig-parts/${id}.txt: two sockets are in the same place`);
  }
  if (p.kind === "link" && !p.reaches) p.problems.push(`rig-parts/${id}.txt: a link needs a reaches line, one of ${Object.keys(REACHES).join(", ")}`);
  if (p.reaches && p.kind !== "link") p.problems.push(`rig-parts/${id}.txt: only a link has a reaches line`);
  for (const key of NUMBERS) p[key] ??= 0;
  p.grade = Math.max(1, p.grade || 1);
  p.worth = p.worth || p.grade * WORTH_A_GRADE;
  p.order = p.order || 99;
  return p;
}

let cache = null;
// Every part, in order, with what's wrong in their files. Read again when a file changes.
export function rigPartsNow() {
  const now = Date.now();
  if (cache && now - cache.looked < 1000) return cache;
  let files = [];
  try {
    files = fs.readdirSync(RIG_PARTS_DIR).filter((name) => name.endsWith(".txt") && !name.startsWith("_"));
  } catch {
    files = [];
  }
  const stamp = files.map((name) => {
    try {
      return `${name}:${fs.statSync(path.join(RIG_PARTS_DIR, name)).mtimeMs}`;
    } catch {
      return name;
    }
  }).join("|");
  if (cache?.stamp === stamp) {
    cache.looked = now;
    return cache;
  }
  const list = files.map((name) => parseRigPart(name.slice(0, -4), fs.readFileSync(path.join(RIG_PARTS_DIR, name), "utf8")));
  list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  cache = { stamp, looked: now, list, byId: Object.fromEntries(list.map((p) => [p.id, p])), problems: list.flatMap((p) => p.problems) };
  return cache;
}
export const rigPartById = (id) => rigPartsNow().byId[String(id ?? "")] ?? null;
addChecker(() => [...rigPartsNow().problems, ...benchToolsNow().problems, ...recipeToolProblems()]);

// ---- The bench's tools (step 5) -------------------------------------------------------------------------------------

// "soldering_kit: Soldering kit, 60 credits: what it's for": one line a tool, in _tools.txt beside the parts. A tool
// bought for the bench stays on it (game.rig.tools); a recipe that needs one says "with the soldering kit".
export function parseBenchTools(text) {
  const out = { list: [], byId: {}, problems: [] };
  String(text ?? "").replace(/\r/g, "").split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^draft:/i.test(line)) return;
    const m = /^([a-z0-9_]+): ([^,]+), (\d+) credits: (.+)$/i.exec(line);
    if (!m) return out.problems.push(`rig-parts/_tools.txt line ${i + 1}: a tool is written like "micro_lathe: Micro lathe, 150 credits: what it's for"`);
    const tool = { id: m[1].toLowerCase(), name: m[2].trim(), price: Number(m[3]), what: m[4].trim() };
    if (out.byId[tool.id]) return out.problems.push(`rig-parts/_tools.txt line ${i + 1}: ${tool.id} is written twice`);
    out.list.push(tool);
    out.byId[tool.id] = tool;
  });
  return out;
}
let toolsCache = null;
export function benchToolsNow() {
  const now = Date.now();
  if (toolsCache && now - toolsCache.looked < 1000) return toolsCache;
  const file = path.join(RIG_PARTS_DIR, "_tools.txt");
  let stamp = "";
  try {
    stamp = String(fs.statSync(file).mtimeMs);
  } catch {
    stamp = "none";
  }
  if (toolsCache?.stamp === stamp) {
    toolsCache.looked = now;
    return toolsCache;
  }
  const read = stamp === "none" ? { list: [], byId: {}, problems: [] } : parseBenchTools(fs.readFileSync(file, "utf8"));
  toolsCache = { ...read, stamp, looked: now };
  return toolsCache;
}
export const benchToolById = (id) => benchToolsNow().byId[String(id ?? "")] ?? null;
// A recipe's tool, and the lathe's, have to be tools the file names.
function recipeToolProblems() {
  const out = rigPartsNow().list.filter((p) => p.made?.tool && !benchToolById(p.made.tool)).map((p) => `rig-parts/${p.id}.txt: it's made with the ${p.made.tool.replace(/_/g, " ")}, which isn't a tool in rig-parts/_tools.txt`);
  if (BENCH_RULES.lathe.tool && !benchToolById(BENCH_RULES.lathe.tool) && fs.existsSync(path.join(RIG_PARTS_DIR, "_tools.txt"))) out.push(`rig-parts/_tools.txt: the bench's lathe is the ${BENCH_RULES.lathe.tool.replace(/_/g, " ")}, which needs a line here`);
  return out;
}
// What a part is worth in credits.
export const worthOf = (id) => rigPartById(id)?.worth ?? 0;

const half = (v) => (v > 0 ? Math.floor(v / 2) : Math.ceil(v / 2));
const tenth = (v) => Math.round(v * 10) / 10;

// A fitted part's own numbers once its condition and tuning are counted.
export function partNumbers(item) {
  const p = rigPartById(item?.id);
  if (!p || item.cond === "broken") return { works: false, heat: 0, cools: 0, fx: { speed: 0, power: 0, quiet: 0, memory: 0, echo: 0 } };
  const fx = { speed: p.speed, power: p.power, quiet: p.quiet, memory: p.memory, echo: p.echo };
  let heat = p.heat;
  let cools = p.cools;
  if (item.cond === "worn") {
    for (const key of Object.keys(fx)) fx[key] = key === "speed" ? tenth(fx[key] / 2) : half(fx[key]);
    heat += 1;
    cools = Math.floor(cools / 2);
  }
  const tune = item.tune ? BENCH_RULES.tunes[item.tune] : null;
  if (tune) {
    fx.speed = tenth(fx.speed + tune.speed);
    heat = Math.max(0, heat + tune.heat);
  }
  return { works: true, heat, cools, fx };
}

const weightOf = (item) => rigPartById(item?.id)?.weight ?? 0;
// What the rig weighs: its board, casing, the parts in it and the spare ones with it.
export const rigWeight = (rig) => Math.round((rig?.parts ?? []).reduce((sum, item) => sum + weightOf(item), 0) * 100) / 100;

// What a build adds up to, in the numbers a session reads: memory, power, speed, quiet, heat before a session warms it,
// the echo CLEANER gets, the weight, why it won't start (or null), and each socket with what's in it and its heat.
// hacking is the player's skill, which opens a board's gated sockets.
export function rigStats(rig, hacking = 0) {
  const byUid = Object.fromEntries((rig?.parts ?? []).map((item) => [item.uid, item]));
  const out = { memory: 0, power: 0, quiet: 0, speed: 1, heat: 0, echo: 0, weight: rigWeight(rig), dead: null, sockets: [] };
  const board = byUid[rig?.build?.board];
  const casing = byUid[rig?.build?.casing];
  const bd = rigPartById(board?.id);
  const cs = rigPartById(casing?.id);
  if (!bd) {
    out.dead = "it has no board";
    return out;
  }
  const worn = (item) => item?.cond === "worn";
  const scaled = (item, v) => (worn(item) ? half(v) : v);
  out.power += scaled(board, bd.power);
  out.quiet += scaled(board, bd.quiet);
  let heat = bd.heat + (worn(board) ? 1 : 0);
  let cooling = 0;
  if (cs && casing.cond !== "broken") {
    out.speed += worn(casing) ? tenth(cs.speed / 2) : cs.speed;
    out.quiet += scaled(casing, cs.quiet);
    cooling = cs.cooling - (worn(casing) ? 1 : 0);
  }
  const placed = [];
  for (const socket of bd.sockets) {
    const open = socket.gate <= hacking;
    const item = open ? byUid[rig.build.fit?.[socket.key]] : null;
    placed.push({ ...socket, open, item: item ?? null, n: item ? partNumbers(item) : null, cooled: 0 });
  }
  // A heat sink takes heat off the sockets beside it (left, right, above and below).
  for (const sink of placed) {
    if (sink.kind !== "sink" || !sink.n?.works) continue;
    for (const other of placed) if (other !== sink && other.n && Math.abs(other.col - sink.col) + Math.abs(other.row - sink.row) === 1) other.cooled += sink.n.cools;
  }
  for (const here of placed) {
    const left = here.n ? Math.max(0, here.n.heat - here.cooled) : 0;
    heat += left;
    if (here.n?.works) for (const [key, value] of Object.entries(here.n.fx)) out[key] += value;
    out.sockets.push({ key: here.key, kind: here.kind, col: here.col, row: here.row, gate: here.gate, open: here.open, uid: here.item?.uid ?? null, heat: left, cooled: here.n ? Math.min(here.cooled, here.n.heat) : 0, works: Boolean(here.n?.works) });
  }
  out.heat = Math.max(0, heat - cooling);
  out.speed = tenth(Math.min(2.5, Math.max(0.4, out.speed)));
  out.power = Math.min(3, Math.max(-1, out.power));
  out.quiet = Math.min(3, Math.max(-1, out.quiet));
  out.memory = Math.max(0, out.memory);
  const first = (kind) => placed.find((here) => here.kind === kind && here.item);
  if (board.cond === "broken") out.dead = "its board is broken";
  else {
    for (const kind of ["core", "cell", "link"]) {
      const here = first(kind);
      const name = PART_KINDS[kind].toLowerCase();
      if (!here) out.dead ??= `there's no ${name} in it`;
      else if (!here.n.works) out.dead ??= `its ${rigPartById(here.item.id)?.name.toLowerCase() ?? name} is broken`;
    }
  }
  return out;
}

// What the noise of one action comes to through the rig: a quiet rig takes some off (3 is silent, 2 one off, 1 one off
// anything that's at least 2), a loud one adds one, and the fan of a hot rig is heard on anything that makes a sound.
export function rigNoise(stats, noise, fanOn) {
  if (noise <= 0) return 0;
  let n = noise;
  if (stats.quiet >= 3) n = 0;
  else if (stats.quiet === 2 || (stats.quiet === 1 && n >= 2)) n -= 1;
  else if (stats.quiet < 0) n += 1;
  return Math.max(0, n) + (fanOn ? 1 : 0);
}
// What an action's minutes come to through the rig: its speed divides them, and overheating doubles them.
export const rigMinutes = (stats, minutes, overheating) => (minutes > 0 ? Math.max(1, Math.ceil((minutes / stats.speed) * (overheating ? 2 : 1))) : 0);
// How hot the rig is after so many of a session's minutes.
export const sessionHeat = (stats, minutes) => stats.heat + Math.floor((minutes ?? 0) / HEAT.minutesAPoint);
